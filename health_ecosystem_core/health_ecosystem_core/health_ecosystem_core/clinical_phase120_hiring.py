"""
Phase 120 — Simple hiring desk for the HR Manager dashboard (/people/recruitment).

One self-contained store (HEC Hire Job / Posting / Candidate / Activity). No ERPNext
Job Opening / Job Applicant dependency and no Desk steps. Job portals (Naukri,
WorkIndia) are assisted: the desk writes the ad, tracks posting slots, and imports
the applicant export the operator downloads from the portal.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, get_datetime, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_require_mobile_auth,
	_success,
	_user_roles,
)

JOB_DT = "HEC Hire Job"
POSTING_DT = "HEC Hire Posting"
CANDIDATE_DT = "HEC Hire Candidate"
ACTIVITY_DT = "HEC Hire Activity"

HR_ROLES = frozenset({"Administrator", "System Manager", "Health System Admin", "HR Manager", "HR User"})
HR_ADMIN_ROLES = frozenset({"Administrator", "System Manager", "Health System Admin", "HR Manager"})

JOB_STATUSES = ("Draft", "Open", "Paused", "Closed")
EMPLOYMENT_TYPES = ("Full Time", "Part Time", "Contract", "Internship")
SOURCES = ("Naukri", "WorkIndia", "Careers", "Referral", "Walk-in", "Other")
STAGES = ("New", "Screening", "Interview", "Offer", "Hired", "Rejected", "Withdrawn")
OPEN_STAGES = ("New", "Screening", "Interview", "Offer")

STAGE_FLOW = {
	"New": {"Screening", "Rejected", "Withdrawn"},
	"Screening": {"Interview", "Rejected", "Withdrawn"},
	"Interview": {"Offer", "Screening", "Rejected", "Withdrawn"},
	"Offer": {"Interview", "Rejected", "Withdrawn"},
	"Rejected": {"Screening"},
	"Withdrawn": {"Screening"},
	"Hired": set(),
}

PORTALS = {
	"Naukri": {
		"default_slots": 5,
		"conf_key": "hec_hiring_naukri_slots",
		"validity_days": 30,
		"employer_url": "https://recruit.naukri.com/",
	},
	"WorkIndia": {
		"default_slots": None,
		"conf_key": "hec_hiring_workindia_slots",
		"validity_days": 30,
		"employer_url": "https://www.workindia.in/employers/",
	},
}

MAX_RESUME_BYTES = 2 * 1024 * 1024
RESUME_EXT = {"pdf", "doc", "docx", "jpg", "jpeg", "png"}
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2000
PUBLIC_APPLY_PER_HOUR = 10

LEGACY_DEMO_CAMPAIGNS = (
	"Hiring - Marketing Executive",
	"Hiring - Lab Technician",
	"Hiring - Receptionist",
	"Hiring - Phlebotomist",
)
LEGACY_DEMO_LEADS = ("Rahul Kumar", "Priya Sharma", "Amit Das", "Sneha Roy", "Vikram Singh", "Ananya Ghosh", "Demo Hire Person")
DEMO_EMAIL_SUFFIXES = ("@health.local", "@example.com", "@example.org", "@test.com", "@mailinator.com")


# --------------------------------------------------------------------------- schema


def _ensure_doctype(name, fields, autoname, permissions):
	if frappe.db.exists("DocType", name):
		return False
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": name,
			"module": "Health Ecosystem Core",
			"custom": 0,
			"autoname": autoname,
			"naming_rule": "Expression" if autoname.startswith("format:") else "Random",
			"engine": "InnoDB",
			"track_changes": 1,
			"fields": fields,
			"permissions": permissions,
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def _hr_permissions(allow_delete_for_admins=True):
	perms = [
		{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
		{"role": "HR Manager", "read": 1, "write": 1, "create": 1, "delete": 1 if allow_delete_for_admins else 0, "export": 1, "report": 1},
		{"role": "HR User", "read": 1, "write": 1, "create": 1, "report": 1},
		{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "report": 1},
	]
	return perms


def ensure_hiring_doctypes():
	created = []
	if _ensure_doctype(
		JOB_DT,
		[
			{"fieldname": "title", "label": "Job Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(JOB_STATUSES), "default": "Draft", "in_list_view": 1},
			{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
			{"fieldname": "location", "label": "Location", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "employment_type", "label": "Employment Type", "fieldtype": "Select", "options": "\n".join(EMPLOYMENT_TYPES), "default": "Full Time"},
			{"fieldname": "openings", "label": "Openings", "fieldtype": "Int", "default": "1"},
			{"fieldname": "salary_min", "label": "Monthly Salary Min", "fieldtype": "Currency"},
			{"fieldname": "salary_max", "label": "Monthly Salary Max", "fieldtype": "Currency"},
			{"fieldname": "experience_min", "label": "Experience Min (yrs)", "fieldtype": "Float"},
			{"fieldname": "experience_max", "label": "Experience Max (yrs)", "fieldtype": "Float"},
			{"fieldname": "qualification", "label": "Qualification", "fieldtype": "Data"},
			{"fieldname": "skills", "label": "Key Skills", "fieldtype": "Small Text"},
			{"fieldname": "description", "label": "Description", "fieldtype": "Text"},
			{"fieldname": "is_public", "label": "Show on Careers Page", "fieldtype": "Check", "default": "1"},
			{"fieldname": "closes_on", "label": "Closes On", "fieldtype": "Date"},
			{"fieldname": "legacy_ref", "label": "Legacy Job Opening", "fieldtype": "Data", "read_only": 1},
		],
		"format:JOB-{YYYY}-{####}",
		_hr_permissions(),
	):
		created.append(JOB_DT)

	if _ensure_doctype(
		POSTING_DT,
		[
			{"fieldname": "job", "label": "Job", "fieldtype": "Link", "options": JOB_DT, "reqd": 1, "in_list_view": 1},
			{"fieldname": "portal", "label": "Portal", "fieldtype": "Select", "options": "\n".join(PORTALS), "reqd": 1, "in_list_view": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nExpired\nClosed", "default": "Active", "in_list_view": 1},
			{"fieldname": "posted_on", "label": "Posted On", "fieldtype": "Date"},
			{"fieldname": "expires_on", "label": "Expires On", "fieldtype": "Date", "in_list_view": 1},
			{"fieldname": "external_url", "label": "Portal Job URL", "fieldtype": "Data"},
			{"fieldname": "external_ref", "label": "Portal Job ID", "fieldtype": "Data"},
			{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			{"fieldname": "posted_by", "label": "Posted By", "fieldtype": "Link", "options": "User"},
		],
		"format:POST-{YYYY}-{#####}",
		_hr_permissions(),
	):
		created.append(POSTING_DT)

	if _ensure_doctype(
		CANDIDATE_DT,
		[
			{"fieldname": "full_name", "label": "Full Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "job", "label": "Job", "fieldtype": "Link", "options": JOB_DT, "in_list_view": 1},
			{"fieldname": "stage", "label": "Stage", "fieldtype": "Select", "options": "\n".join(STAGES), "default": "New", "in_list_view": 1},
			{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": "\n".join(SOURCES), "default": "Other", "in_list_view": 1},
			{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data"},
			{"fieldname": "mobile_key", "label": "Mobile Key", "fieldtype": "Data", "read_only": 1, "search_index": 1},
			{"fieldname": "email", "label": "Email", "fieldtype": "Data", "search_index": 1},
			{"fieldname": "city", "label": "City", "fieldtype": "Data"},
			{"fieldname": "experience_years", "label": "Experience (yrs)", "fieldtype": "Float"},
			{"fieldname": "qualification", "label": "Qualification", "fieldtype": "Data"},
			{"fieldname": "current_company", "label": "Current Company", "fieldtype": "Data"},
			{"fieldname": "current_ctc", "label": "Current Monthly Salary", "fieldtype": "Currency"},
			{"fieldname": "expected_ctc", "label": "Expected Monthly Salary", "fieldtype": "Currency"},
			{"fieldname": "notice_period", "label": "Notice Period", "fieldtype": "Data"},
			{"fieldname": "rating", "label": "Rating", "fieldtype": "Int", "default": "0"},
			{"fieldname": "resume", "label": "Resume", "fieldtype": "Attach"},
			{"fieldname": "resume_url", "label": "Portal Resume Link", "fieldtype": "Data"},
			{"fieldname": "interview_at", "label": "Interview At", "fieldtype": "Datetime"},
			{"fieldname": "interview_mode", "label": "Interview Mode", "fieldtype": "Select", "options": "\nIn person\nPhone\nVideo"},
			{"fieldname": "offered_ctc", "label": "Offered Monthly Salary", "fieldtype": "Currency"},
			{"fieldname": "joining_date", "label": "Joining Date", "fieldtype": "Date"},
			{"fieldname": "reject_reason", "label": "Reject / Withdraw Reason", "fieldtype": "Data"},
			{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "read_only": 1},
			{"fieldname": "last_activity", "label": "Last Activity", "fieldtype": "Datetime", "read_only": 1},
			{"fieldname": "import_batch", "label": "Import Batch", "fieldtype": "Data", "read_only": 1},
			{"fieldname": "consent", "label": "Consent Given", "fieldtype": "Check", "default": "0"},
			{"fieldname": "legacy_ref", "label": "Legacy Job Applicant", "fieldtype": "Data", "read_only": 1},
		],
		"format:CAN-{YYYY}-{#####}",
		_hr_permissions(),
	):
		created.append(CANDIDATE_DT)

	if _ensure_doctype(
		ACTIVITY_DT,
		[
			{"fieldname": "candidate", "label": "Candidate", "fieldtype": "Link", "options": CANDIDATE_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
			{"fieldname": "kind", "label": "Kind", "fieldtype": "Select", "options": "Note\nStage\nCall\nImport\nSystem", "default": "Note", "in_list_view": 1},
			{"fieldname": "body", "label": "Details", "fieldtype": "Small Text", "in_list_view": 1},
			{"fieldname": "from_stage", "label": "From Stage", "fieldtype": "Data"},
			{"fieldname": "to_stage", "label": "To Stage", "fieldtype": "Data"},
			{"fieldname": "actor", "label": "By", "fieldtype": "Link", "options": "User"},
			{"fieldname": "logged_at", "label": "At", "fieldtype": "Datetime", "in_list_view": 1},
		],
		"format:HACT-{#########}",
		_hr_permissions(allow_delete_for_admins=False),
	):
		created.append(ACTIVITY_DT)

	if created:
		frappe.db.commit()
	return created


# --------------------------------------------------------------------------- guards / helpers


def _session_roles(sid=None):
	if sid:
		_require_mobile_auth(sid)
	if frappe.session.user in (None, "Guest"):
		return set()
	return set(_user_roles() or [])


def _require_hr(sid=None, admin=False):
	roles = _session_roles(sid)
	if not roles:
		frappe.throw(_("Please sign in"), frappe.PermissionError)
	needed = HR_ADMIN_ROLES if admin else HR_ROLES
	if not roles & needed:
		frappe.throw(_("HR Manager access required"), frappe.PermissionError)
	ensure_hiring_doctypes()


def _api(fn):
	"""Run fn and wrap into the standard envelope with clean error codes."""
	try:
		return _success(fn())
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"), 400)
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase120_hiring", message=frappe.get_traceback())
		return _error(_("Something went wrong. The error was logged for the admin."), 500)


def _val(key, explicit=None):
	value = _parse_request_value(key, explicit)
	return value.strip() if isinstance(value, str) else value


def _json_val(key, explicit=None):
	raw = _parse_request_value(key, explicit)
	if raw in (None, ""):
		return {}
	if isinstance(raw, dict):
		return raw
	try:
		parsed = json.loads(raw)
	except (TypeError, ValueError):
		frappe.throw(_("{0} must be valid JSON").format(key))
	if not isinstance(parsed, dict):
		frappe.throw(_("{0} must be an object").format(key))
	return parsed


def normalize_mobile(value):
	digits = re.sub(r"\D", "", cstr(value))
	if len(digits) >= 10:
		digits = digits[-10:]
	return digits if len(digits) == 10 and digits[0] in "6789" else ""


def _clean_email(value):
	email = cstr(value).strip().lower()
	if not email:
		return ""
	if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
		return ""
	return email


def parse_experience(value):
	text = cstr(value).strip().lower()
	if not text:
		return None
	if "fresher" in text:
		return 0.0
	years = re.search(r"(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)", text)
	months = re.search(r"(\d+)\s*(?:m|mo|mon|month|months)", text)
	if years or months:
		total = flt(years.group(1)) if years else 0.0
		if months:
			total += cint(months.group(1)) / 12.0
		return round(total, 2)
	number = re.search(r"\d+(?:\.\d+)?", text)
	return flt(number.group(0)) if number else None


def parse_salary(value):
	"""Monthly rupees from strings like '25,000', '3.5 Lacs', '4 LPA', '₹ 18000/month'."""
	text = cstr(value).strip().lower().replace(",", "")
	if not text:
		return None
	number = re.search(r"\d+(?:\.\d+)?", text)
	if not number:
		return None
	amount = flt(number.group(0))
	annual = any(tok in text for tok in ("lpa", "lac", "lakh", "per annum", "p.a", "/year", "annual", "ctc"))
	if any(tok in text for tok in ("lac", "lakh", "lpa")):
		amount *= 100000
	if annual or amount >= 150000:
		amount = amount / 12.0
	return round(amount, 0)


def _log_activity(candidate, kind, body, from_stage=None, to_stage=None):
	frappe.get_doc(
		{
			"doctype": ACTIVITY_DT,
			"candidate": candidate,
			"kind": kind,
			"body": cstr(body)[:2000],
			"from_stage": from_stage,
			"to_stage": to_stage,
			"actor": frappe.session.user if frappe.session.user != "Guest" else None,
			"logged_at": now_datetime(),
		}
	).insert(ignore_permissions=True)
	frappe.db.set_value(CANDIDATE_DT, candidate, "last_activity", now_datetime(), update_modified=False)


def _save_resume(candidate, filename, content_b64):
	if not filename or not content_b64:
		return None
	ext = cstr(filename).rsplit(".", 1)[-1].lower() if "." in cstr(filename) else ""
	if ext not in RESUME_EXT:
		frappe.throw(_("Resume must be PDF, Word or an image"))
	try:
		content = base64.b64decode(content_b64, validate=False)
	except Exception:
		frappe.throw(_("Resume file could not be read"))
	if len(content) > MAX_RESUME_BYTES:
		frappe.throw(_("Resume must be 2 MB or smaller"))
	safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", cstr(filename))[-80:]
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{candidate}-{safe_name}",
			"attached_to_doctype": CANDIDATE_DT,
			"attached_to_name": candidate,
			"attached_to_field": "resume",
			"is_private": 1,
			"content": content,
		}
	)
	file_doc.save(ignore_permissions=True)
	frappe.db.set_value(CANDIDATE_DT, candidate, "resume", file_doc.file_url, update_modified=False)
	return file_doc.file_url


def _portal_slots(portal):
	spec = PORTALS[portal]
	override = frappe.conf.get(spec["conf_key"])
	if override not in (None, ""):
		return cint(override) or None
	return spec["default_slots"]


def _expire_postings():
	frappe.db.sql(
		f"""update `tab{POSTING_DT}` set status='Expired'
		where status='Active' and expires_on is not null and expires_on < %s""",
		today(),
	)


def _active_postings(portal=None):
	_expire_postings()
	filters = {"status": "Active"}
	if portal:
		filters["portal"] = portal
	return frappe.get_all(
		POSTING_DT,
		filters=filters,
		fields=["name", "job", "portal", "posted_on", "expires_on", "external_url", "external_ref"],
		order_by="expires_on asc",
		limit_page_length=500,
	)


def _slot_summary():
	out = []
	for portal, spec in PORTALS.items():
		active = _active_postings(portal)
		limit = _portal_slots(portal)
		out.append(
			{
				"portal": portal,
				"limit": limit,
				"used": len(active),
				"available": None if limit is None else max(limit - len(active), 0),
				"employer_url": spec["employer_url"],
				"validity_days": spec["validity_days"],
			}
		)
	return out


def _find_duplicate(job, mobile_key, email):
	for field, value in (("mobile_key", mobile_key), ("email", email)):
		if not value:
			continue
		filters = {field: value}
		if job:
			filters["job"] = job
		existing = frappe.db.get_value(CANDIDATE_DT, filters, "name")
		if existing:
			return existing
	return None


CANDIDATE_EDITABLE = (
	"full_name",
	"email",
	"city",
	"experience_years",
	"qualification",
	"current_company",
	"current_ctc",
	"expected_ctc",
	"notice_period",
	"rating",
	"resume_url",
)


def _upsert_candidate(data, *, source, job=None, activity_kind="System", activity_note=None, import_batch=None):
	"""Create or merge a candidate. Returns (name, created_bool)."""
	full_name = cstr(data.get("full_name")).strip()
	if not full_name:
		frappe.throw(_("Candidate name is required"))
	mobile_key = normalize_mobile(data.get("mobile"))
	email = _clean_email(data.get("email"))
	if not mobile_key and not email:
		frappe.throw(_("A valid 10-digit mobile or an email is required"))
	if source not in SOURCES:
		source = "Other"
	if job and not frappe.db.exists(JOB_DT, job):
		frappe.throw(_("Job {0} not found").format(job))

	existing = _find_duplicate(job, mobile_key, email)
	if existing:
		doc = frappe.get_doc(CANDIDATE_DT, existing)
		changed = []
		for field in CANDIDATE_EDITABLE:
			incoming = data.get(field)
			if incoming in (None, "") or doc.get(field):
				continue
			doc.set(field, incoming)
			changed.append(field)
		if mobile_key and not doc.mobile_key:
			doc.mobile, doc.mobile_key = mobile_key, mobile_key
			changed.append("mobile")
		if changed:
			doc.save(ignore_permissions=True)
		_log_activity(existing, activity_kind, activity_note or _("Duplicate application from {0} merged").format(source))
		return existing, False

	payload = {"doctype": CANDIDATE_DT, "full_name": full_name[:140], "job": job, "source": source, "stage": "New"}
	for field in CANDIDATE_EDITABLE:
		if data.get(field) not in (None, ""):
			payload[field] = data.get(field)
	payload["full_name"] = full_name[:140]
	payload["email"] = email or None
	payload["mobile"] = mobile_key or None
	payload["mobile_key"] = mobile_key or None
	payload["consent"] = cint(data.get("consent"))
	payload["import_batch"] = import_batch
	payload["rating"] = min(max(cint(payload.get("rating")), 0), 5)
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	_log_activity(doc.name, activity_kind, activity_note or _("Added from {0}").format(source), to_stage="New")
	return doc.name, True


def _job_row(doc_or_row):
	r = doc_or_row
	return {
		"name": r.name,
		"title": r.title,
		"status": r.status,
		"department": r.department,
		"location": r.location,
		"employment_type": r.employment_type,
		"openings": cint(r.openings),
		"salary_min": flt(r.salary_min),
		"salary_max": flt(r.salary_max),
		"experience_min": flt(r.experience_min),
		"experience_max": flt(r.experience_max),
		"qualification": r.qualification,
		"skills": r.skills,
		"description": r.description,
		"is_public": cint(r.is_public),
		"closes_on": cstr(r.closes_on) if r.closes_on else None,
	}


JOB_FIELDS = [
	"name",
	"title",
	"status",
	"department",
	"location",
	"employment_type",
	"openings",
	"salary_min",
	"salary_max",
	"experience_min",
	"experience_max",
	"qualification",
	"skills",
	"description",
	"is_public",
	"closes_on",
	"modified",
]

CANDIDATE_LIST_FIELDS = [
	"name",
	"full_name",
	"job",
	"stage",
	"source",
	"mobile",
	"email",
	"city",
	"experience_years",
	"expected_ctc",
	"rating",
	"interview_at",
	"employee",
	"last_activity",
	"creation",
]


def _candidate_row(r, job_titles=None):
	return {
		"name": r.name,
		"full_name": r.full_name,
		"job": r.job,
		"job_title": (job_titles or {}).get(r.job) if r.job else None,
		"stage": r.stage,
		"source": r.source,
		"mobile": r.mobile,
		"email": r.email,
		"city": r.city,
		"experience_years": flt(r.experience_years) if r.experience_years is not None else None,
		"expected_ctc": flt(r.expected_ctc) if r.expected_ctc else None,
		"rating": cint(r.rating),
		"interview_at": cstr(r.interview_at) if r.interview_at else None,
		"employee": r.employee,
		"last_activity": cstr(r.last_activity) if r.last_activity else None,
		"created": cstr(r.creation),
	}


def _job_titles(names):
	names = [n for n in set(names) if n]
	if not names:
		return {}
	return dict(frappe.get_all(JOB_DT, filters={"name": ["in", names]}, fields=["name", "title"], as_list=True))


# --------------------------------------------------------------------------- job ads


def _salary_text(job, monthly=True):
	lo, hi = flt(job.salary_min), flt(job.salary_max)
	if not lo and not hi:
		return ""
	fmt = lambda v: f"₹{int(v):,}"
	if lo and hi:
		return f"{fmt(lo)} – {fmt(hi)} per month"
	return f"{fmt(lo or hi)} per month"


def _experience_text(job):
	lo, hi = flt(job.experience_min), flt(job.experience_max)
	if not lo and not hi:
		return "Freshers welcome"
	if lo and hi:
		return f"{lo:g}–{hi:g} years"
	return f"{(lo or hi):g}+ years"


def _public_description(text):
	"""Drop lines HR marked as internal (e.g. staff-planning CTC bands) before anything leaves the building."""
	lines = [line for line in cstr(text).splitlines() if "(internal)" not in line.lower()]
	return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def build_job_ads(job):
	job = frappe._dict(job.as_dict() if hasattr(job, "as_dict") else job)
	job.description = _public_description(job.description)
	skills = [s.strip() for s in re.split(r"[,\n]", cstr(job.skills)) if s.strip()]
	salary = _salary_text(job)
	experience = _experience_text(job)
	apply_url = f"https://www.e-remedium.in/jobs/{job.name}/apply"

	naukri_lines = [
		f"Job Title: {job.title}",
		f"Company: Remedium (a unit of Smilecure Lifestyle Pvt. Ltd.)",
		f"Location: {job.location or 'Kolkata, West Bengal'}",
		f"Employment Type: {job.employment_type or 'Full Time'}",
		f"Experience: {experience}",
	]
	if salary:
		naukri_lines.append(f"Salary: {salary}")
	if job.qualification:
		naukri_lines.append(f"Qualification: {job.qualification}")
	if cint(job.openings) > 1:
		naukri_lines.append(f"Openings: {cint(job.openings)}")
	naukri_lines += ["", "Job Description:", cstr(job.description).strip() or f"We are hiring a {job.title} to join our healthcare team."]
	if skills:
		naukri_lines += ["", "Key Skills: " + ", ".join(skills)]
	naukri_lines += ["", "About Remedium: a diagnostics and healthcare network focused on transparency, accuracy and speed."]

	workindia_lines = [
		f"{job.title} – {job.location or 'Kolkata'}",
		f"Salary: {salary}" if salary else None,
		f"Experience: {experience}",
		f"Education: {job.qualification}" if job.qualification else None,
		f"Job type: {job.employment_type or 'Full Time'}",
		"",
		(cstr(job.description).strip() or f"Hiring {job.title} for Remedium healthcare centres.")[:600],
		"",
		"Call / WhatsApp HR after applying. Joining immediately preferred.",
	]
	return {
		"Naukri": {
			"title": job.title,
			"body": "\n".join(naukri_lines),
			"key_skills": skills,
			"employer_url": PORTALS["Naukri"]["employer_url"],
		},
		"WorkIndia": {
			"title": job.title,
			"body": "\n".join(line for line in workindia_lines if line is not None),
			"key_skills": skills,
			"employer_url": PORTALS["WorkIndia"]["employer_url"],
		},
		"Careers": {"title": job.title, "apply_url": apply_url},
	}


# --------------------------------------------------------------------------- import


HEADER_SYNONYMS = {
	"full_name": ("name", "candidatename", "fullname", "applicantname", "jobseekername", "candidate"),
	"mobile": ("mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber", "contactnumber", "contactno", "contact"),
	"email": ("email", "emailid", "emailaddress", "mail"),
	"city": ("city", "location", "currentlocation", "preferredlocation", "area"),
	"experience_years": ("experience", "totalexperience", "workexperience", "exp", "totalexp"),
	"qualification": ("qualification", "education", "highestqualification", "ugcourse", "degree"),
	"current_company": ("currentcompany", "company", "currentemployer", "employer"),
	"current_ctc": ("currentctc", "ctc", "annualsalary", "currentsalary", "salary"),
	"expected_ctc": ("expectedctc", "expectedsalary"),
	"notice_period": ("noticeperiod", "notice"),
	"resume_url": ("resumelink", "resumeurl", "cvlink", "resume", "profilelink"),
}


def _norm_header(value):
	return re.sub(r"[^a-z0-9]", "", cstr(value).lower())


def _map_headers(headers):
	mapping = {}
	normalized = [_norm_header(h) for h in headers]
	for field, synonyms in HEADER_SYNONYMS.items():
		for idx, header in enumerate(normalized):
			if idx in mapping.values():
				continue
			if header in synonyms:
				mapping[field] = idx
				break
	return mapping


def _read_table(filename, content):
	ext = cstr(filename).rsplit(".", 1)[-1].lower() if "." in cstr(filename) else ""
	if ext in ("xlsx", "xlsm"):
		from openpyxl import load_workbook

		wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
		ws = wb.worksheets[0]
		rows = [[cstr(c) if c is not None else "" for c in row] for row in ws.iter_rows(values_only=True)]
	elif ext in ("csv", "txt"):
		text = None
		for encoding in ("utf-8-sig", "utf-16", "cp1252"):
			try:
				text = content.decode(encoding)
				break
			except UnicodeDecodeError:
				continue
		if text is None:
			frappe.throw(_("Could not read the CSV file encoding"))
		try:
			dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
		except csv.Error:
			dialect = csv.excel
		rows = list(csv.reader(io.StringIO(text), dialect))
	else:
		frappe.throw(_("Upload the portal export as .xlsx or .csv"))
	# Portal exports often have title rows above the header — pick the first row with a name column.
	for idx, row in enumerate(rows[:15]):
		mapping = _map_headers(row)
		if "full_name" in mapping and ("mobile" in mapping or "email" in mapping):
			return row, mapping, rows[idx + 1 :]
	frappe.throw(_("Could not find Name and Mobile/Email columns in the file"))


def import_candidates(job=None, source=None, filename=None, content_b64=None, dry_run=1):
	if source not in ("Naukri", "WorkIndia", "Referral", "Walk-in", "Other"):
		frappe.throw(_("Choose where these candidates came from"))
	if job and not frappe.db.exists(JOB_DT, job):
		frappe.throw(_("Job {0} not found").format(job))
	if not filename or not content_b64:
		frappe.throw(_("Choose the exported file to import"))
	try:
		content = base64.b64decode(content_b64, validate=False)
	except Exception:
		frappe.throw(_("File could not be read"))
	if len(content) > MAX_IMPORT_BYTES:
		frappe.throw(_("Import file must be 5 MB or smaller"))

	header, mapping, data_rows = _read_table(filename, content)
	data_rows = [r for r in data_rows if any(cstr(c).strip() for c in r)]
	if len(data_rows) > MAX_IMPORT_ROWS:
		frappe.throw(_("Import at most {0} rows at a time").format(MAX_IMPORT_ROWS))

	def cell(row, field):
		idx = mapping.get(field)
		return cstr(row[idx]).strip() if idx is not None and idx < len(row) else ""

	batch = f"IMP-{now_datetime().strftime('%Y%m%d%H%M%S')}"
	result = {
		"dry_run": bool(cint(dry_run)),
		"columns": {field: header[idx] for field, idx in mapping.items()},
		"total_rows": len(data_rows),
		"created": 0,
		"merged": 0,
		"skipped": 0,
		"errors": [],
		"preview": [],
		"batch": None if cint(dry_run) else batch,
	}
	seen = set()
	for line_no, row in enumerate(data_rows, start=2):
		record = {
			"full_name": cell(row, "full_name"),
			"mobile": cell(row, "mobile"),
			"email": cell(row, "email"),
			"city": cell(row, "city"),
			"experience_years": parse_experience(cell(row, "experience_years")),
			"qualification": cell(row, "qualification"),
			"current_company": cell(row, "current_company"),
			"current_ctc": parse_salary(cell(row, "current_ctc")),
			"expected_ctc": parse_salary(cell(row, "expected_ctc")),
			"notice_period": cell(row, "notice_period"),
			"resume_url": cell(row, "resume_url") if cell(row, "resume_url").startswith("http") else "",
		}
		key = normalize_mobile(record["mobile"]) or _clean_email(record["email"])
		problem = None
		if not record["full_name"]:
			problem = "missing name"
		elif not key:
			problem = "no valid mobile or email"
		elif key in seen:
			problem = "duplicate row in file"
		if problem:
			result["skipped"] += 1
			if len(result["errors"]) < 50:
				result["errors"].append({"row": line_no, "name": record["full_name"], "reason": problem})
			continue
		seen.add(key)
		if len(result["preview"]) < 10:
			result["preview"].append({k: v for k, v in record.items() if v not in (None, "")})
		if cint(dry_run):
			if _find_duplicate(job, normalize_mobile(record["mobile"]), _clean_email(record["email"])):
				result["merged"] += 1
			else:
				result["created"] += 1
			continue
		try:
			_candidate, created = _upsert_candidate(
				record,
				source=source,
				job=job,
				activity_kind="Import",
				activity_note=_("Imported from {0} file {1}").format(source, filename),
				import_batch=batch,
			)
			result["created" if created else "merged"] += 1
		except frappe.ValidationError as exc:
			result["skipped"] += 1
			if len(result["errors"]) < 50:
				result["errors"].append({"row": line_no, "name": record["full_name"], "reason": cstr(exc)})
	if not cint(dry_run):
		frappe.db.commit()
	return result


# --------------------------------------------------------------------------- core operations


def overview():
	_expire_postings()
	stage_counts = dict(
		frappe.db.sql(f"select stage, count(*) from `tab{CANDIDATE_DT}` group by stage")
	)
	source_counts = dict(
		frappe.db.sql(
			f"select source, count(*) from `tab{CANDIDATE_DT}` where creation >= %s group by source",
			add_days(today(), -30),
		)
	)
	start_month = getdate(today()).replace(day=1)
	upcoming = frappe.get_all(
		CANDIDATE_DT,
		filters={"stage": "Interview", "interview_at": ["between", [now_datetime(), add_days(now_datetime(), 7)]]},
		fields=CANDIDATE_LIST_FIELDS,
		order_by="interview_at asc",
		limit_page_length=20,
	)
	titles = _job_titles([r.job for r in upcoming])
	recent = frappe.get_all(
		ACTIVITY_DT,
		fields=["candidate", "kind", "body", "to_stage", "actor", "logged_at"],
		order_by="logged_at desc",
		limit_page_length=12,
	)
	names = dict(
		frappe.get_all(
			CANDIDATE_DT,
			filters={"name": ["in", [r.candidate for r in recent] or ["-"]]},
			fields=["name", "full_name"],
			as_list=True,
		)
	)
	return {
		"kpis": {
			"open_jobs": frappe.db.count(JOB_DT, {"status": "Open"}),
			"active_candidates": sum(cint(stage_counts.get(s)) for s in OPEN_STAGES),
			"new_today": frappe.db.count(CANDIDATE_DT, {"creation": [">=", today()]}),
			"new_7d": frappe.db.count(CANDIDATE_DT, {"creation": [">=", add_days(today(), -7)]}),
			"interviews_7d": len(upcoming),
			"hired_month": frappe.db.count(CANDIDATE_DT, {"stage": "Hired", "modified": [">=", start_month]}),
		},
		"stages": [{"stage": s, "count": cint(stage_counts.get(s))} for s in STAGES],
		"sources_30d": [{"source": s, "count": cint(source_counts.get(s))} for s in SOURCES],
		"slots": _slot_summary(),
		"upcoming_interviews": [_candidate_row(r, titles) for r in upcoming],
		"recent_activity": [
			{
				"candidate": r.candidate,
				"candidate_name": names.get(r.candidate),
				"kind": r.kind,
				"body": r.body,
				"to_stage": r.to_stage,
				"actor": r.actor,
				"at": cstr(r.logged_at),
			}
			for r in recent
		],
	}


def list_jobs(status=None):
	filters = {"status": status} if status in JOB_STATUSES else {}
	rows = frappe.get_all(JOB_DT, filters=filters, fields=JOB_FIELDS, order_by="modified desc", limit_page_length=300)
	status_rank = {"Open": 0, "Paused": 1, "Draft": 2, "Closed": 3}
	rows.sort(key=lambda r: status_rank.get(r.status, 9))
	counts = {}
	for job, stage, n in frappe.db.sql(f"select job, stage, count(*) from `tab{CANDIDATE_DT}` group by job, stage"):
		counts.setdefault(job, {})[stage] = n
	postings = {}
	for p in _active_postings():
		postings.setdefault(p.job, []).append(p.portal)
	out = []
	for r in rows:
		row = _job_row(r)
		c = counts.get(r.name, {})
		row["candidates"] = sum(c.values())
		row["active_candidates"] = sum(cint(c.get(s)) for s in OPEN_STAGES)
		row["hired"] = cint(c.get("Hired"))
		row["active_portals"] = sorted(set(postings.get(r.name, [])))
		out.append(row)
	return {"jobs": out, "slots": _slot_summary()}


def save_job(data):
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Job title is required"))
	status = data.get("status") or "Draft"
	if status not in JOB_STATUSES:
		frappe.throw(_("Invalid job status"))
	employment_type = data.get("employment_type") or "Full Time"
	if employment_type not in EMPLOYMENT_TYPES:
		frappe.throw(_("Invalid employment type"))
	salary_min, salary_max = flt(data.get("salary_min")), flt(data.get("salary_max"))
	if salary_min < 0 or salary_max < 0 or (salary_max and salary_min > salary_max):
		frappe.throw(_("Salary range is invalid"))
	exp_min, exp_max = flt(data.get("experience_min")), flt(data.get("experience_max"))
	if exp_min < 0 or exp_max < 0 or (exp_max and exp_min > exp_max):
		frappe.throw(_("Experience range is invalid"))
	values = {
		"title": title[:140],
		"status": status,
		"department": cstr(data.get("department")).strip()[:140] or None,
		"location": cstr(data.get("location")).strip()[:140] or None,
		"employment_type": employment_type,
		"openings": max(cint(data.get("openings")) or 1, 1),
		"salary_min": salary_min or None,
		"salary_max": salary_max or None,
		"experience_min": exp_min or None,
		"experience_max": exp_max or None,
		"qualification": cstr(data.get("qualification")).strip()[:140] or None,
		"skills": cstr(data.get("skills")).strip() or None,
		"description": cstr(data.get("description")).strip() or None,
		"is_public": 1 if cint(data.get("is_public", 1)) else 0,
		"closes_on": getdate(data.get("closes_on")) if data.get("closes_on") else None,
	}
	name = cstr(data.get("name")).strip()
	if name:
		if not frappe.db.exists(JOB_DT, name):
			frappe.throw(_("Job {0} not found").format(name))
		doc = frappe.get_doc(JOB_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": JOB_DT, **values})
		doc.insert(ignore_permissions=True)
	if doc.status == "Closed":
		_close_postings_for_job(doc.name, _("Job closed"))
	frappe.db.commit()
	return _job_row(doc)


def _close_postings_for_job(job, reason):
	for p in frappe.get_all(POSTING_DT, filters={"job": job, "status": "Active"}, pluck="name"):
		frappe.db.set_value(POSTING_DT, p, {"status": "Closed", "notes": reason})


def get_job_ads(job):
	if not frappe.db.exists(JOB_DT, job):
		frappe.throw(_("Job {0} not found").format(job))
	doc = frappe.get_doc(JOB_DT, job)
	postings = frappe.get_all(
		POSTING_DT,
		filters={"job": job},
		fields=["name", "portal", "status", "posted_on", "expires_on", "external_url", "external_ref", "notes"],
		order_by="creation desc",
		limit_page_length=50,
	)
	return {
		"job": _job_row(doc),
		"ads": build_job_ads(doc),
		"slots": _slot_summary(),
		"postings": [
			{
				**p,
				"posted_on": cstr(p.posted_on) if p.posted_on else None,
				"expires_on": cstr(p.expires_on) if p.expires_on else None,
			}
			for p in postings
		],
	}


def record_posting(job, portal, external_url=None, external_ref=None, posted_on=None, expires_on=None):
	if portal not in PORTALS:
		frappe.throw(_("Choose Naukri or WorkIndia"))
	if not frappe.db.exists(JOB_DT, job):
		frappe.throw(_("Job {0} not found").format(job))
	status = frappe.db.get_value(JOB_DT, job, "status")
	if status != "Open":
		frappe.throw(_("Open the job before posting it on a portal"))
	if frappe.db.exists(POSTING_DT, {"job": job, "portal": portal, "status": "Active"}):
		frappe.throw(_("This job already has an active {0} posting").format(portal))
	limit = _portal_slots(portal)
	used = len(_active_postings(portal))
	if limit is not None and used >= limit:
		frappe.throw(
			_("All {0} {1} slots are in use. Close or let a posting expire first.").format(limit, portal)
		)
	url = cstr(external_url).strip()
	if url and not url.startswith(("http://", "https://")):
		frappe.throw(_("Portal job URL must start with https://"))
	posted = getdate(posted_on) if posted_on else getdate(today())
	expires = getdate(expires_on) if expires_on else add_days(posted, PORTALS[portal]["validity_days"])
	if expires < posted:
		frappe.throw(_("Expiry date must be after the posting date"))
	doc = frappe.get_doc(
		{
			"doctype": POSTING_DT,
			"job": job,
			"portal": portal,
			"status": "Active",
			"posted_on": posted,
			"expires_on": expires,
			"external_url": url or None,
			"external_ref": cstr(external_ref).strip()[:140] or None,
			"posted_by": frappe.session.user,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"posting": doc.name, "slots": _slot_summary()}


def close_posting(posting, reason=None):
	if not frappe.db.exists(POSTING_DT, posting):
		frappe.throw(_("Posting {0} not found").format(posting))
	frappe.db.set_value(POSTING_DT, posting, {"status": "Closed", "notes": cstr(reason)[:500] or None})
	frappe.db.commit()
	return {"posting": posting, "slots": _slot_summary()}


def list_candidates(job=None, stage=None, source=None, q=None, limit=100, start=0):
	filters = {}
	if job:
		filters["job"] = job
	if stage == "Active":
		filters["stage"] = ["in", list(OPEN_STAGES)]
	elif stage in STAGES:
		filters["stage"] = stage
	if source in SOURCES:
		filters["source"] = source
	or_filters = None
	q = cstr(q).strip()
	if q:
		like = f"%{q}%"
		or_filters = [["full_name", "like", like], ["email", "like", like], ["city", "like", like], ["name", "like", like]]
		mobile_key = re.sub(r"\D", "", q)
		if len(mobile_key) >= 4:
			or_filters.append(["mobile_key", "like", f"%{mobile_key}%"])
	limit = min(max(cint(limit) or 100, 1), 500)
	rows = frappe.get_all(
		CANDIDATE_DT,
		filters=filters,
		or_filters=or_filters,
		fields=CANDIDATE_LIST_FIELDS,
		order_by="last_activity desc, creation desc",
		limit_start=max(cint(start), 0),
		limit_page_length=limit,
	)
	titles = _job_titles([r.job for r in rows])
	total = len(rows) if or_filters else frappe.db.count(CANDIDATE_DT, filters)
	return {"candidates": [_candidate_row(r, titles) for r in rows], "total": cint(total)}


def get_candidate(name):
	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	doc = frappe.get_doc(CANDIDATE_DT, name)
	activities = frappe.get_all(
		ACTIVITY_DT,
		filters={"candidate": name},
		fields=["kind", "body", "from_stage", "to_stage", "actor", "logged_at"],
		order_by="logged_at desc",
		limit_page_length=100,
	)
	data = {f: doc.get(f) for f in (
		"name", "full_name", "job", "stage", "source", "mobile", "email", "city", "experience_years",
		"qualification", "current_company", "current_ctc", "expected_ctc", "notice_period", "rating",
		"resume_url", "interview_mode", "offered_ctc", "reject_reason", "employee", "import_batch",
	)}
	data["interview_at"] = cstr(doc.interview_at) if doc.interview_at else None
	data["joining_date"] = cstr(doc.joining_date) if doc.joining_date else None
	data["has_resume"] = bool(doc.resume)
	data["job_title"] = frappe.db.get_value(JOB_DT, doc.job, "title") if doc.job else None
	data["allowed_stages"] = sorted(STAGE_FLOW.get(doc.stage, set()), key=STAGES.index)
	data["can_hire"] = doc.stage == "Offer" and not doc.employee
	data["created"] = cstr(doc.creation)
	data["activities"] = [
		{"kind": a.kind, "body": a.body, "from_stage": a.from_stage, "to_stage": a.to_stage, "actor": a.actor, "at": cstr(a.logged_at)}
		for a in activities
	]
	return data


def save_candidate(data, resume_filename=None, resume_b64=None):
	name = cstr(data.get("name")).strip()
	if not name:
		source = data.get("source") or "Other"
		if source == "Careers":
			frappe.throw(_("Careers applications come from the public form"))
		new_name, created = _upsert_candidate(
			data, source=source, job=data.get("job") or None, activity_kind="System", activity_note=_("Added by HR ({0})").format(source)
		)
		if resume_filename and resume_b64:
			_save_resume(new_name, resume_filename, resume_b64)
		frappe.db.commit()
		return {"name": new_name, "created": created}

	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	doc = frappe.get_doc(CANDIDATE_DT, name)
	changed = []
	for field in CANDIDATE_EDITABLE:
		if field not in data:
			continue
		value = data.get(field)
		if field == "email":
			value = _clean_email(value) or None
			if data.get(field) and not value:
				frappe.throw(_("Email address is not valid"))
		elif field == "rating":
			value = min(max(cint(value), 0), 5)
		elif field in ("experience_years", "current_ctc", "expected_ctc"):
			value = flt(value) if value not in (None, "") else None
		elif isinstance(value, str):
			value = value.strip() or None
		if field == "full_name" and not value:
			frappe.throw(_("Candidate name is required"))
		if doc.get(field) != value:
			doc.set(field, value)
			changed.append(field)
	if "mobile" in data:
		mobile_key = normalize_mobile(data.get("mobile"))
		if data.get("mobile") and not mobile_key:
			frappe.throw(_("Mobile must be a valid 10-digit Indian number"))
		if mobile_key != doc.mobile_key:
			doc.mobile, doc.mobile_key = mobile_key or None, mobile_key or None
			changed.append("mobile")
	if "job" in data and (data.get("job") or None) != doc.job:
		if data.get("job") and not frappe.db.exists(JOB_DT, data.get("job")):
			frappe.throw(_("Job not found"))
		doc.job = data.get("job") or None
		changed.append("job")
	if not doc.mobile_key and not doc.email:
		frappe.throw(_("Keep at least a mobile number or an email"))
	if changed:
		doc.save(ignore_permissions=True)
		_log_activity(name, "System", _("Updated: {0}").format(", ".join(changed)))
	if resume_filename and resume_b64:
		_save_resume(name, resume_filename, resume_b64)
		_log_activity(name, "System", _("Resume uploaded"))
	frappe.db.commit()
	return {"name": name, "changed": changed}


def move_stage(name, to_stage, note=None, interview_at=None, interview_mode=None, offered_ctc=None, joining_date=None, reason=None):
	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	doc = frappe.get_doc(CANDIDATE_DT, name)
	current = doc.stage or "New"
	if to_stage == "Hired":
		frappe.throw(_("Use Hire to convert the candidate into an employee"))
	if to_stage not in STAGE_FLOW.get(current, set()):
		frappe.throw(_("Cannot move from {0} to {1}").format(current, to_stage))
	detail = []
	if to_stage == "Interview":
		if not interview_at:
			frappe.throw(_("Pick the interview date and time"))
		when = get_datetime(interview_at)
		doc.interview_at = when
		doc.interview_mode = interview_mode if interview_mode in ("In person", "Phone", "Video") else "In person"
		detail.append(_("Interview {0} ({1})").format(when.strftime("%d %b %Y %I:%M %p"), doc.interview_mode))
	if to_stage == "Offer":
		if flt(offered_ctc) <= 0 or not joining_date:
			frappe.throw(_("Offered monthly salary and joining date are required"))
		if getdate(joining_date) < getdate(today()):
			frappe.throw(_("Joining date cannot be in the past"))
		doc.offered_ctc = flt(offered_ctc)
		doc.joining_date = getdate(joining_date)
		detail.append(_("Offer ₹{0:,.0f}/month, joining {1}").format(doc.offered_ctc, doc.joining_date))
	if to_stage in ("Rejected", "Withdrawn"):
		if not cstr(reason).strip():
			frappe.throw(_("Give a short reason"))
		doc.reject_reason = cstr(reason).strip()[:140]
		detail.append(doc.reject_reason)
	if cstr(note).strip():
		detail.append(cstr(note).strip())
	doc.stage = to_stage
	doc.save(ignore_permissions=True)
	_log_activity(name, "Stage", " · ".join(detail) or _("Moved to {0}").format(to_stage), from_stage=current, to_stage=to_stage)
	frappe.db.commit()
	return get_candidate(name)


def add_note(name, body, kind="Note"):
	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	if not cstr(body).strip():
		frappe.throw(_("Write a note first"))
	_log_activity(name, kind if kind in ("Note", "Call") else "Note", cstr(body).strip())
	frappe.db.commit()
	return get_candidate(name)


def hire(name, work_email, department=None, designation=None, joining_date=None, monthly_salary=None):
	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	doc = frappe.get_doc(CANDIDATE_DT, name)
	if doc.employee:
		frappe.throw(_("Already hired as {0}").format(doc.employee))
	if doc.stage != "Offer":
		frappe.throw(_("Move the candidate to Offer before hiring"))
	email = _clean_email(work_email) or doc.email
	if not email:
		frappe.throw(_("A work email is needed to create the employee login"))
	job = frappe.get_doc(JOB_DT, doc.job) if doc.job else None
	salary = flt(monthly_salary) or flt(doc.offered_ctc)
	if salary <= 0:
		frappe.throw(_("Monthly salary is required"))

	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import create_people_employee

	result = create_people_employee(
		list(_session_roles()),
		full_name=doc.full_name,
		email=email,
		mobile=doc.mobile,
		department=department or (job.department if job else None),
		designation=designation or (job.title if job else None),
		joining_date=cstr(getdate(joining_date or doc.joining_date or today())),
		salary_offered=salary,
	)
	employee = (result or {}).get("employee")
	if not employee:
		frappe.throw(_("Employee could not be created"))
	doc.employee = employee
	doc.stage = "Hired"
	doc.save(ignore_permissions=True)
	_log_activity(name, "Stage", _("Hired as employee {0} (login {1})").format(employee, email), from_stage="Offer", to_stage="Hired")

	filled = None
	if job:
		filled = frappe.db.count(CANDIDATE_DT, {"job": job.name, "stage": "Hired"})
		if filled >= cint(job.openings or 1) and job.status == "Open":
			frappe.db.set_value(JOB_DT, job.name, "status", "Closed")
			_close_postings_for_job(job.name, _("All openings filled"))
	frappe.db.commit()
	return {
		"candidate": name,
		"employee": employee,
		"user": (result or {}).get("user"),
		"temporary_password": (result or {}).get("temporary_password"),
		"job_closed": bool(job and filled is not None and filled >= cint(job.openings or 1)),
	}


def resume_payload(name):
	if not frappe.db.exists(CANDIDATE_DT, name):
		frappe.throw(_("Candidate {0} not found").format(name))
	url = frappe.db.get_value(CANDIDATE_DT, name, "resume")
	if not url:
		frappe.throw(_("No resume uploaded"))
	file_name = frappe.db.get_value("File", {"file_url": url}, "name")
	if not file_name:
		frappe.throw(_("Resume file is missing"))
	file_doc = frappe.get_doc("File", file_name)
	return file_doc.get_content(), file_doc.file_name


# --------------------------------------------------------------------------- public careers


def public_jobs():
	today_d = getdate(today())
	rows = frappe.get_all(
		JOB_DT,
		filters={"status": "Open", "is_public": 1},
		fields=JOB_FIELDS,
		order_by="modified desc",
		limit_page_length=100,
	)
	out = []
	for r in rows:
		if r.closes_on and getdate(r.closes_on) < today_d:
			continue
		row = _job_row(r)
		row.update(
			{
				"description": _public_description(r.description) or None,
				"job_title": r.title,
				"salary_text": _salary_text(r),
				"experience_text": _experience_text(r),
			}
		)
		out.append(row)
	return out


def public_apply(data, resume_filename=None, resume_b64=None):
	if cstr(data.get("website")).strip():
		# Honeypot field — pretend success for bots.
		return {"reference": "RECEIVED"}
	ip = cstr(getattr(frappe.local, "request_ip", "") or "unknown")
	cache_key = f"hec_hire_apply:{ip}:{now_datetime().strftime('%Y%m%d%H')}"
	hits = cint(frappe.cache().get_value(cache_key))
	if hits >= PUBLIC_APPLY_PER_HOUR:
		frappe.throw(_("Too many applications from this network. Please try again later."))
	frappe.cache().set_value(cache_key, hits + 1, expires_in_sec=3600)

	job = cstr(data.get("job")).strip()
	if not job or not frappe.db.exists(JOB_DT, {"name": job, "status": "Open", "is_public": 1}):
		frappe.throw(_("This job is no longer accepting applications"))
	if not cint(data.get("consent")):
		frappe.throw(_("Please accept the consent to be contacted"))
	if not normalize_mobile(data.get("mobile")):
		frappe.throw(_("Enter a valid 10-digit mobile number"))
	if data.get("email") and not _clean_email(data.get("email")):
		frappe.throw(_("Enter a valid email address"))
	record = {
		"full_name": cstr(data.get("full_name")).strip(),
		"mobile": data.get("mobile"),
		"email": data.get("email"),
		"city": cstr(data.get("city")).strip()[:140],
		"experience_years": flt(data.get("experience_years")) if data.get("experience_years") not in (None, "") else None,
		"qualification": cstr(data.get("qualification")).strip()[:140],
		"expected_ctc": flt(data.get("expected_ctc")) or None,
		"consent": 1,
	}
	name, _created = _upsert_candidate(record, source="Careers", job=job, activity_note=_("Applied on careers page"))
	if resume_filename and resume_b64:
		_save_resume(name, resume_filename, resume_b64)
	frappe.db.commit()
	return {"reference": name}


# --------------------------------------------------------------------------- legacy clean-up


def _is_demo_email(email):
	email = cstr(email).strip().lower()
	# OTP sign-ups get <mobile>@otp.health.local and are real applicants.
	if email.endswith("@otp.health.local"):
		return False
	return bool(email) and email.endswith(DEMO_EMAIL_SUFFIXES)


def _delete_all(doctype, names):
	deleted = 0
	for name in names:
		try:
			frappe.delete_doc(doctype, name, ignore_permissions=True, force=True, delete_permanently=True)
			deleted += 1
		except Exception:
			frappe.log_error(title=f"phase120_purge_{doctype}", message=frappe.get_traceback())
	return deleted


def _plain_text(html):
	return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", cstr(html))).strip().lower()


def _seeded_demo_openings():
	"""Job Openings created by the old sample seeder: demo title AND the seeder's exact description."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import SAMPLE_OPENINGS
	except Exception:
		return []
	seeded = {s["job_title"]: _plain_text(s.get("description")) for s in SAMPLE_OPENINGS}
	rows = frappe.get_all(
		"Job Opening",
		filters={"job_title": ["in", list(seeded) or ["-"]]},
		fields=["name", "job_title", "description"],
	)
	return [r.name for r in rows if seeded.get(r.job_title) and _plain_text(r.description) == seeded[r.job_title]]


def purge_legacy_demo(dry_run=1):
	"""Remove seeded demo hiring data only. Real applicants, employees and hr_manager stay."""
	dry = bool(cint(dry_run))
	plan = {}

	def exists(dt):
		return bool(frappe.db.exists("DocType", dt))

	demo_applicants = []
	if exists("Job Applicant"):
		for row in frappe.get_all("Job Applicant", fields=["name", "email_id"], limit_page_length=20000):
			if _is_demo_email(row.email_id):
				demo_applicants.append(row.name)
	plan["Job Applicant"] = demo_applicants

	for child_dt in ("HEC Interview Schedule", "HEC Application Note"):
		if exists(child_dt) and demo_applicants:
			plan[child_dt] = frappe.get_all(child_dt, filters={"job_applicant": ["in", demo_applicants]}, pluck="name", limit_page_length=50000)
		else:
			plan[child_dt] = []

	offers = []
	if exists("HEC Job Offer"):
		meta = frappe.get_meta("HEC Job Offer")
		fields = ["name"] + [f for f in ("job_applicant", "recipient_email") if meta.has_field(f)]
		for row in frappe.get_all("HEC Job Offer", fields=fields, limit_page_length=50000):
			applicant = row.get("job_applicant")
			if (
				_is_demo_email(row.get("recipient_email"))
				or (applicant and applicant in demo_applicants)
				or (applicant and not frappe.db.exists("Job Applicant", applicant))
			):
				offers.append(row.name)
	plan["HEC Job Offer"] = offers

	plan["HEC Hiring Campaign"] = (
		frappe.get_all("HEC Hiring Campaign", filters={"campaign_name": ["in", list(LEGACY_DEMO_CAMPAIGNS)]}, pluck="name")
		if exists("HEC Hiring Campaign")
		else []
	)
	plan["HEC Hiring Lead"] = (
		frappe.get_all("HEC Hiring Lead", filters={"lead_name": ["in", list(LEGACY_DEMO_LEADS)]}, pluck="name")
		if exists("HEC Hiring Lead")
		else []
	)

	openings_delete, openings_close = [], []
	if exists("Job Opening"):
		for name in _seeded_demo_openings():
			real = [
				a
				for a in frappe.get_all("Job Applicant", filters={"job_title": name}, pluck="name", limit_page_length=5000)
				if a not in demo_applicants
			]
			(openings_close if real else openings_delete).append(name)
	plan["Job Opening"] = openings_delete

	summary = {dt: len(names) for dt, names in plan.items()}
	summary["Job Opening (closed, has real applicants)"] = len(openings_close)
	if dry:
		return {"dry_run": True, "would_delete": summary}

	deleted = {}
	for dt in ("HEC Interview Schedule", "HEC Application Note", "HEC Job Offer", "HEC Hiring Lead", "HEC Hiring Campaign", "Job Applicant", "Job Opening"):
		deleted[dt] = _delete_all(dt, plan.get(dt, []))
	for name in openings_close:
		frappe.db.set_value("Job Opening", name, {"status": "Closed", "publish": 0} if frappe.get_meta("Job Opening").has_field("publish") else {"status": "Closed"})
	frappe.db.commit()
	deleted["Job Opening (closed)"] = len(openings_close)
	return {"dry_run": False, "deleted": deleted}


LEGACY_STAGE_MAP = {
	"Received": "New",
	"Screening": "Screening",
	"Interview": "Interview",
	"Assessment": "Interview",
	"Offer": "Offer",
	"Onboarding": "Hired",
	"Rejected": "Rejected",
}

LEGACY_SOURCE_MAP = {"naukri": "Naukri", "workindia": "WorkIndia", "career website": "Careers", "careers": "Careers", "referral": "Referral", "walk-in": "Walk-in"}


def migrate_legacy(dry_run=1):
	"""Copy real (non-demo) Job Openings / Job Applicants into the hiring desk. Idempotent."""
	ensure_hiring_doctypes()
	dry = bool(cint(dry_run))
	out = {"dry_run": dry, "jobs": 0, "candidates": 0, "skipped_demo": 0, "already_migrated": 0}
	if not frappe.db.exists("DocType", "Job Opening"):
		return out
	job_map = dict(frappe.get_all(JOB_DT, filters={"legacy_ref": ["is", "set"]}, fields=["legacy_ref", "name"], as_list=True))
	jo_meta = frappe.get_meta("Job Opening")
	for jo in frappe.get_all("Job Opening", fields=["name", "job_title", "status", "description", "department"], limit_page_length=5000):
		if jo.name in job_map:
			continue
		out["jobs"] += 1
		if dry:
			continue
		location = frappe.db.get_value("Job Opening", jo.name, "hec_location") if jo_meta.has_field("hec_location") else None
		doc = frappe.get_doc(
			{
				"doctype": JOB_DT,
				"title": jo.job_title or jo.name,
				"status": "Open" if jo.status == "Open" else "Closed",
				"department": jo.department,
				"location": location,
				"description": re.sub(r"<[^>]+>", " ", cstr(jo.description)).strip() or None,
				"is_public": 1 if jo.status == "Open" else 0,
				"legacy_ref": jo.name,
			}
		)
		doc.insert(ignore_permissions=True)
		job_map[jo.name] = doc.name

	if frappe.db.exists("DocType", "Job Applicant"):
		ja_meta = frappe.get_meta("Job Applicant")
		fields = ["name", "applicant_name", "email_id", "job_title", "status"]
		fields += [f for f in ("hec_mobile", "phone_number", "hec_pipeline_stage", "hec_source", "hec_employee") if ja_meta.has_field(f)]
		migrated = set(frappe.get_all(CANDIDATE_DT, filters={"legacy_ref": ["is", "set"]}, pluck="legacy_ref"))
		for ja in frappe.get_all("Job Applicant", fields=fields, limit_page_length=20000):
			if _is_demo_email(ja.email_id):
				out["skipped_demo"] += 1
				continue
			if ja.name in migrated:
				out["already_migrated"] += 1
				continue
			email = _clean_email(ja.email_id)
			otp_mobile = email.split("@")[0] if email and email.endswith("@otp.health.local") else None
			if otp_mobile:
				email = None
			mobile_key = normalize_mobile(ja.get("hec_mobile") or ja.get("phone_number") or otp_mobile)
			if not mobile_key and not email:
				out["skipped_demo"] += 1
				continue
			out["candidates"] += 1
			if dry:
				continue
			stage = LEGACY_STAGE_MAP.get(cstr(ja.get("hec_pipeline_stage")), "New")
			if stage == "Hired" and not ja.get("hec_employee"):
				stage = "Offer"
			doc = frappe.get_doc(
				{
					"doctype": CANDIDATE_DT,
					"full_name": ja.applicant_name or email or ja.name,
					"job": job_map.get(ja.job_title),
					"stage": stage,
					"source": LEGACY_SOURCE_MAP.get(cstr(ja.get("hec_source")).strip().lower(), "Other"),
					"mobile": mobile_key or None,
					"mobile_key": mobile_key or None,
					"email": email or None,
					"employee": ja.get("hec_employee") or None,
					"legacy_ref": ja.name,
				}
			)
			doc.insert(ignore_permissions=True)
			_log_activity(doc.name, "System", _("Migrated from legacy applicant {0}").format(ja.name))
	if not dry:
		frappe.db.commit()
	return out


# --------------------------------------------------------------------------- bench entry points


def setup_hiring():
	created = ensure_hiring_doctypes()
	return {"ok": True, "phase": 120, "doctypes_created": created, "slots": _slot_summary()}


def smoke_hiring():
	"""End-to-end smoke on throwaway records (cleaned up afterwards)."""
	frappe.set_user("Administrator")
	ensure_hiring_doctypes()
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:300]})
		if not cond:
			result["ok"] = False

	job = candidate = None
	try:
		job = save_job(
			{
				"title": "SMOKE Phlebotomist",
				"status": "Open",
				"location": "Kolkata",
				"salary_min": 15000,
				"salary_max": 18000,
				"experience_min": 1,
				"skills": "Venipuncture, Sample labelling",
				"is_public": 0,
			}
		)["name"]
		check("job_created", bool(job), job)
		ads = get_job_ads(job)["ads"]
		check("naukri_ad", "SMOKE Phlebotomist" in ads["Naukri"]["body"] and "₹15,000" in ads["Naukri"]["body"])

		csv_text = "Report generated on portal\nCandidate Name,Mobile No.,Email ID,Total Experience,Current Location,Annual Salary\n" \
			"Smoke One,+91 98765 43210,smoke.one@example.net,2 Year(s) 6 Month(s),Kolkata,2.4 Lacs\n" \
			"Smoke One Dup,9876543210,,1 yr,Howrah,\n" \
			"No Contact,,,,,\n"
		b64 = base64.b64encode(csv_text.encode()).decode()
		preview = import_candidates(job, "Naukri", "smoke.csv", b64, dry_run=1)
		check("import_preview", preview["created"] == 1 and preview["skipped"] == 2, preview)
		done = import_candidates(job, "Naukri", "smoke.csv", b64, dry_run=0)
		check("import_commit", done["created"] == 1, done)
		candidate = frappe.db.get_value(CANDIDATE_DT, {"job": job, "mobile_key": "9876543210"}, "name")
		row = frappe.db.get_value(CANDIDATE_DT, candidate, ["experience_years", "current_ctc"], as_dict=True)
		check("parsed_fields", flt(row.experience_years) == 2.5 and flt(row.current_ctc) == 20000, row)

		again = import_candidates(job, "Naukri", "smoke.csv", b64, dry_run=0)
		check("import_idempotent", again["created"] == 0 and again["merged"] == 1, again)

		try:
			move_stage(candidate, "Offer")
			check("stage_guard", False, "skipped straight to Offer")
		except frappe.ValidationError:
			check("stage_guard", True)
		move_stage(candidate, "Screening")
		move_stage(candidate, "Interview", interview_at=cstr(add_days(now_datetime(), 1)), interview_mode="Phone")
		detail = move_stage(candidate, "Offer", offered_ctc=17000, joining_date=cstr(add_days(today(), 7)))
		check("stage_offer", detail["stage"] == "Offer" and detail["can_hire"], detail["stage"])
		check("activity_log", len(detail["activities"]) >= 4, len(detail["activities"]))

		slots = {s["portal"]: s for s in _slot_summary()}
		check("naukri_slot_limit", slots["Naukri"]["limit"] == 5, slots["Naukri"])
		check("workindia_unlimited", slots["WorkIndia"]["limit"] is None, slots["WorkIndia"])
		posting = record_posting(job, "WorkIndia", external_ref="SMOKE")["posting"]
		try:
			record_posting(job, "WorkIndia")
			check("posting_duplicate_guard", False)
		except frappe.ValidationError:
			check("posting_duplicate_guard", True)
		close_posting(posting)
	except Exception as exc:
		check("exception", False, f"{exc}\n{frappe.get_traceback()[-800:]}")
		frappe.db.rollback()
	finally:
		if candidate:
			frappe.db.delete(ACTIVITY_DT, {"candidate": candidate})
			frappe.db.delete(CANDIDATE_DT, {"name": candidate})
		if job:
			frappe.db.delete(POSTING_DT, {"job": job})
			frappe.db.delete(JOB_DT, {"name": job})
		frappe.db.commit()
	return result


# --------------------------------------------------------------------------- whitelisted API


@frappe.whitelist(allow_guest=True)
def get_hiring_overview(sid=None):
	def run():
		_require_hr(sid)
		return overview()

	return _api(run)


@frappe.whitelist(allow_guest=True)
def list_hire_jobs(status=None, sid=None):
	def run():
		_require_hr(sid)
		return list_jobs(_val("status", status))

	return _api(run)


@frappe.whitelist(allow_guest=True)
def save_hire_job(job=None, sid=None):
	def run():
		_require_hr(sid)
		return save_job(_json_val("job", job))

	return _api(run)


@frappe.whitelist(allow_guest=True)
def get_hire_job_ads(job=None, sid=None):
	def run():
		_require_hr(sid)
		return get_job_ads(_val("job", job))

	return _api(run)


@frappe.whitelist(allow_guest=True)
def record_hire_posting(job=None, portal=None, external_url=None, external_ref=None, posted_on=None, expires_on=None, sid=None):
	def run():
		_require_hr(sid)
		return record_posting(
			_val("job", job),
			_val("portal", portal),
			_val("external_url", external_url),
			_val("external_ref", external_ref),
			_val("posted_on", posted_on),
			_val("expires_on", expires_on),
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def close_hire_posting(posting=None, reason=None, sid=None):
	def run():
		_require_hr(sid)
		return close_posting(_val("posting", posting), _val("reason", reason))

	return _api(run)


@frappe.whitelist(allow_guest=True)
def list_hire_candidates(job=None, stage=None, source=None, q=None, limit=None, start=None, sid=None):
	def run():
		_require_hr(sid)
		return list_candidates(
			_val("job", job), _val("stage", stage), _val("source", source), _val("q", q), _val("limit", limit), _val("start", start)
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def get_hire_candidate(candidate=None, sid=None):
	def run():
		_require_hr(sid)
		return get_candidate(_val("candidate", candidate))

	return _api(run)


@frappe.whitelist(allow_guest=True)
def save_hire_candidate(candidate=None, resume_filename=None, resume_b64=None, sid=None):
	def run():
		_require_hr(sid)
		return save_candidate(
			_json_val("candidate", candidate), _val("resume_filename", resume_filename), _parse_request_value("resume_b64", resume_b64)
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def move_hire_candidate(candidate=None, to_stage=None, note=None, interview_at=None, interview_mode=None, offered_ctc=None, joining_date=None, reason=None, sid=None):
	def run():
		_require_hr(sid)
		return move_stage(
			_val("candidate", candidate),
			_val("to_stage", to_stage),
			note=_val("note", note),
			interview_at=_val("interview_at", interview_at),
			interview_mode=_val("interview_mode", interview_mode),
			offered_ctc=_val("offered_ctc", offered_ctc),
			joining_date=_val("joining_date", joining_date),
			reason=_val("reason", reason),
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def add_hire_note(candidate=None, body=None, kind=None, sid=None):
	def run():
		_require_hr(sid)
		return add_note(_val("candidate", candidate), _val("body", body), _val("kind", kind) or "Note")

	return _api(run)


@frappe.whitelist(allow_guest=True)
def hire_candidate(candidate=None, work_email=None, department=None, designation=None, joining_date=None, monthly_salary=None, sid=None):
	def run():
		_require_hr(sid, admin=True)
		return hire(
			_val("candidate", candidate),
			_val("work_email", work_email),
			department=_val("department", department),
			designation=_val("designation", designation),
			joining_date=_val("joining_date", joining_date),
			monthly_salary=_val("monthly_salary", monthly_salary),
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def import_hire_candidates(job=None, source=None, filename=None, content_b64=None, dry_run=None, sid=None):
	def run():
		_require_hr(sid)
		return import_candidates(
			_val("job", job) or None,
			_val("source", source),
			_val("filename", filename),
			_parse_request_value("content_b64", content_b64),
			dry_run=cint(_val("dry_run", dry_run) if _val("dry_run", dry_run) not in (None, "") else 1),
		)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def download_hire_resume(candidate=None, sid=None):
	try:
		_require_hr(sid)
		content, file_name = resume_payload(_val("candidate", candidate))
	except (frappe.PermissionError, frappe.ValidationError) as exc:
		return _error(cstr(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)
	frappe.local.response.filename = file_name
	frappe.local.response.filecontent = content
	frappe.local.response.type = "download"


@frappe.whitelist(allow_guest=True)
def list_public_hire_jobs():
	def run():
		ensure_hiring_doctypes()
		return {"jobs": public_jobs()}

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def apply_public_hire_job(application=None, resume_filename=None, resume_b64=None):
	def run():
		ensure_hiring_doctypes()
		return public_apply(
			_json_val("application", application), _val("resume_filename", resume_filename), _parse_request_value("resume_b64", resume_b64)
		)

	return _api(run)
