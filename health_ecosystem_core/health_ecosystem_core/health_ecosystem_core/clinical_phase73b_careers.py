"""
Phase 73b — Public careers portal APIs on HRMS Job Opening / Job Applicant.

Guest: list/get published openings, submit applications with documents.
HR: list/get applications, update pipeline stage.
"""

from __future__ import annotations

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
)

PIPELINE_STAGES = (
	"Received",
	"Screening",
	"Interview",
	"Assessment",
	"Offer",
	"Onboarding",
	"Rejected",
)

MAX_ATTACH_BYTES = 2 * 1024 * 1024
ALLOWED_ATTACH_EXT = {"pdf", "jpg", "jpeg", "png"}

HR_ROLES = (
	"System Manager",
	"Health System Admin",
	"HR Manager",
	"HR User",
)

SAMPLE_OPENINGS = (
	{
		"job_title": "Marketing Executive",
		"department": "Marketing",
		"location": "Kolkata, West Bengal",
		"employment_type": "Full Time",
		"description": "Drive hiring and brand campaigns for Remedium across digital and field channels.",
	},
	{
		"job_title": "Lab Technician",
		"department": "Laboratory",
		"location": "Multiple Locations",
		"employment_type": "Full Time",
		"description": "Perform sample processing, QC, and LIS documentation in NABL-aligned labs.",
	},
	{
		"job_title": "Receptionist",
		"department": "Front Office",
		"location": "Kolkata, West Bengal",
		"employment_type": "Full Time",
		"description": "Welcome patients, manage appointments, and support centre operations.",
	},
	{
		"job_title": "Phlebotomist",
		"department": "Collections",
		"location": "Multiple Locations",
		"employment_type": "Full Time",
		"description": "Home and centre collections with accurate labeling and patient care.",
	},
)


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def _require_hrms():
	if not frappe.db.exists("DocType", "Job Opening") or not frappe.db.exists("DocType", "Job Applicant"):
		frappe.throw(_("HRMS Job Opening / Job Applicant is not installed"), frappe.ValidationError)


def _is_hr_user(user=None):
	user = user or frappe.session.user
	if user in ("Guest", None):
		return False
	roles = set(frappe.get_roles(user))
	return bool(roles.intersection(HR_ROLES))


def _require_hr():
	if frappe.session.user in ("Guest", None) or not _is_hr_user():
		frappe.throw(_("HR login required"), frappe.PermissionError)


DEMO_HR_MANAGER = {
	"email": "hr_manager@health.local",
	"username": "hr_manager",
	"first_name": "Demo",
	"last_name": "HR Manager",
	"password": "HrManagerChangeMe@123",
	"roles": ("HR Manager", "HR User", "Employee"),
}


def seed_demo_hr_manager():
	"""Upsert demo HR Manager for careers / marketing / pipeline portals."""
	from frappe.utils.password import update_password

	spec = DEMO_HR_MANAGER
	email = spec["email"]
	for role in spec["roles"]:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)

	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": spec["first_name"],
				"last_name": spec["last_name"],
				"user_type": "System User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)

	user = frappe.get_doc("User", email)
	user.username = spec["username"]
	user.enabled = 1
	user.user_type = "System User"
	existing = {r.role for r in user.roles}
	for role in spec["roles"]:
		if role not in existing:
			user.append("roles", {"role": role})
	user.save(ignore_permissions=True)
	update_password(email, spec["password"], logout_all_sessions=False)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
			ensure_employee_for_user,
		)

		ensure_employee_for_user(email)
	except Exception:
		frappe.log_error(title="seed_demo_hr_manager employee")

	frappe.db.commit()
	return {
		"email": email,
		"password": spec["password"],
		"roles": list(spec["roles"]),
	}


def setup_phase73b():
	_require_hrms()
	_ensure_custom_fields()
	seeded = ensure_published_sample_openings()
	hr = seed_demo_hr_manager()
	return {"ok": True, "phase": "73b", "seeded_openings": seeded, "demo_hr_manager": hr}


def _ensure_custom_fields():
	"""Create HEC fields without create_custom_fields (avoids missing Module Def 'HR')."""
	specs = {
		"Job Opening": [
			{
				"fieldname": "hec_location",
				"label": "Portal Location",
				"fieldtype": "Data",
				"insert_after": "status",
			},
			{
				"fieldname": "hec_employment_type",
				"label": "Employment Type",
				"fieldtype": "Select",
				"options": "\nFull Time\nPart Time\nContract\nInternship",
				"insert_after": "hec_location",
			},
			{
				"fieldname": "hec_department_label",
				"label": "Portal Department",
				"fieldtype": "Data",
				"insert_after": "hec_employment_type",
			},
		],
		"Job Applicant": [
			{
				"fieldname": "hec_pipeline_stage",
				"label": "Pipeline Stage",
				"fieldtype": "Select",
				"options": "\n" + "\n".join(PIPELINE_STAGES),
				"default": "Received",
				"insert_after": "status",
			},
			{
				"fieldname": "hec_source",
				"label": "Application Source",
				"fieldtype": "Data",
				"default": "Career Website",
				"insert_after": "hec_pipeline_stage",
			},
			{
				"fieldname": "hec_application_json",
				"label": "Application Payload JSON",
				"fieldtype": "Long Text",
				"insert_after": "hec_source",
			},
			{
				"fieldname": "hec_photo",
				"label": "Passport Photo",
				"fieldtype": "Attach Image",
				"insert_after": "resume_attachment",
			},
			{
				"fieldname": "hec_aadhaar",
				"label": "Aadhaar Document",
				"fieldtype": "Attach",
				"insert_after": "hec_photo",
			},
			{
				"fieldname": "hec_other_document",
				"label": "Other Document",
				"fieldtype": "Attach",
				"insert_after": "hec_aadhaar",
			},
			{
				"fieldname": "hec_mobile",
				"label": "Mobile Number",
				"fieldtype": "Data",
				"insert_after": "phone_number",
			},
			{
				"fieldname": "hec_declaration_accepted",
				"label": "Declaration Accepted",
				"fieldtype": "Check",
				"insert_after": "hec_other_document",
			},
			{
				"fieldname": "hec_user",
				"label": "Portal User",
				"fieldtype": "Link",
				"options": "User",
				"insert_after": "hec_declaration_accepted",
			},
		],
		"User": [
			{
				"fieldname": "hec_career_profile",
				"label": "Career Profile JSON",
				"fieldtype": "Long Text",
				"insert_after": "mobile_no",
			},
		],
	}
	module = None
	for candidate in ("Health Ecosystem Core", "Health Ecosystem", "HRMS", "HR"):
		if frappe.db.exists("Module Def", candidate):
			module = candidate
			break

	for dt, fields in specs.items():
		if not frappe.db.exists("DocType", dt):
			continue
		for field in fields:
			exists = frappe.db.exists("Custom Field", {"dt": dt, "fieldname": field["fieldname"]})
			if exists:
				continue
			payload = {
				"doctype": "Custom Field",
				"dt": dt,
				**field,
			}
			if module:
				payload["module"] = module
			try:
				frappe.get_doc(payload).insert(ignore_permissions=True)
			except Exception:
				frappe.log_error(title="phase73b_custom_field", message=frappe.get_traceback())
	frappe.clear_cache()



def _ensure_designation(title="Staff"):
	if not frappe.db.exists("DocType", "Designation"):
		return None
	if frappe.db.exists("Designation", title):
		return title
	existing = frappe.get_all("Designation", limit=1, pluck="name")
	if existing:
		return existing[0]
	try:
		doc = frappe.get_doc({"doctype": "Designation", "designation_name": title})
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase73b_designation", message=frappe.get_traceback())
		return None


def ensure_published_sample_openings():
	if not frappe.db.exists("DocType", "Job Opening"):
		return []
	company = _default_company()
	designation = _ensure_designation("Staff")
	if not company:
		frappe.log_error(title="phase73b_seed", message="No Company found — cannot seed Job Openings")
		return []
	meta = frappe.get_meta("Job Opening")
	created = []
	for sample in SAMPLE_OPENINGS:
		title = sample["job_title"]
		existing = frappe.db.exists("Job Opening", {"job_title": title}) if meta.has_field("job_title") else None
		if not existing and frappe.db.exists("Job Opening", title):
			existing = title
		if existing:
			doc = frappe.get_doc("Job Opening", existing)
		else:
			doc = frappe.new_doc("Job Opening")
			if meta.has_field("job_title"):
				doc.job_title = title
		if meta.has_field("company"):
			doc.company = company
		if meta.has_field("designation") and designation:
			doc.designation = designation
		if meta.has_field("status"):
			doc.status = "Open"
		if meta.has_field("description"):
			doc.description = sample["description"]
		if meta.has_field("publish"):
			doc.publish = 1
		if meta.has_field("hec_location"):
			doc.hec_location = sample["location"]
		if meta.has_field("hec_employment_type"):
			doc.hec_employment_type = sample["employment_type"]
		if meta.has_field("hec_department_label"):
			doc.hec_department_label = sample["department"]
		try:
			if existing:
				doc.save(ignore_permissions=True)
			else:
				doc.insert(ignore_permissions=True)
			if meta.has_field("publish"):
				frappe.db.set_value("Job Opening", doc.name, "publish", 1, update_modified=False)
			created.append(doc.name)
		except Exception:
			# Fallback: raw SQL insert path not used; log and continue other samples
			frappe.log_error(title="phase73b_job_opening_seed", message=frappe.get_traceback())
			# Try insert with staffing validation skipped via db_insert after minimal fields
			try:
				if not existing and not frappe.db.exists("Job Opening", {"job_title": title}):
					name = frappe.generate_hash(length=10)
					# Use new_doc + db_insert bypassing validate
					row = frappe.new_doc("Job Opening")
					if meta.has_field("job_title"):
						row.job_title = title
					row.company = company
					if designation and meta.has_field("designation"):
						row.designation = designation
					if meta.has_field("status"):
						row.status = "Open"
					if meta.has_field("description"):
						row.description = sample["description"]
					if meta.has_field("publish"):
						row.publish = 1
					row.flags.ignore_validate = True
					row.flags.ignore_mandatory = True
					row.insert(ignore_permissions=True, ignore_mandatory=True)
					frappe.db.set_value("Job Opening", row.name, "publish", 1, update_modified=False)
					created.append(row.name)
			except Exception:
				frappe.log_error(title="phase73b_job_opening_seed2", message=frappe.get_traceback())
	frappe.db.commit()
	return created


def _opening_row(doc):
	meta = frappe.get_meta("Job Opening")
	title = doc.job_title if meta.has_field("job_title") else doc.name
	return {
		"name": doc.name,
		"job_title": title,
		"department": getattr(doc, "hec_department_label", None) or getattr(doc, "department", None),
		"location": getattr(doc, "hec_location", None) or getattr(doc, "location", None) or "",
		"employment_type": getattr(doc, "hec_employment_type", None) or "Full Time",
		"description": getattr(doc, "description", None) or "",
		"status": getattr(doc, "status", None),
		"posted_on": str(doc.creation.date()) if getattr(doc, "creation", None) else None,
	}


@frappe.whitelist(allow_guest=True)
def list_published_job_openings(search=None, location=None, limit=50):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	search = (_parse_request_value("search", search) or "").strip()
	location = (_parse_request_value("location", location) or "").strip()
	limit = cint(_parse_request_value("limit", limit) or 50)

	meta = frappe.get_meta("Job Opening")
	filters = {}
	if meta.has_field("publish"):
		filters["publish"] = 1
	if meta.has_field("status"):
		filters["status"] = "Open"

	fields = ["name", "creation"]
	for f in ("job_title", "description", "status", "department", "publish", "hec_location", "hec_employment_type", "hec_department_label"):
		if meta.has_field(f):
			fields.append(f)

	rows = frappe.get_all("Job Opening", filters=filters, fields=fields, order_by="creation desc", limit_page_length=limit)
	out = []
	for r in rows:
		title = (r.get("job_title") or r.get("name") or "").lower()
		loc = (r.get("hec_location") or "").lower()
		if search and search.lower() not in title and search.lower() not in (r.get("description") or "").lower():
			continue
		if location and location.lower() not in loc and location.lower() != "all locations":
			continue
		out.append(
			{
				"name": r.name,
				"job_title": r.get("job_title") or r.name,
				"department": r.get("hec_department_label") or r.get("department"),
				"location": r.get("hec_location") or "",
				"employment_type": r.get("hec_employment_type") or "Full Time",
				"description": r.get("description") or "",
				"status": r.get("status"),
				"posted_on": str(r.creation.date()) if r.get("creation") else None,
			}
		)
	return _success({"openings": out, "count": len(out)})


@frappe.whitelist(allow_guest=True)
def get_published_job_opening(job_opening=None):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	job_opening = _parse_request_value("job_opening", job_opening)
	if not job_opening or not frappe.db.exists("Job Opening", job_opening):
		return _error(_("Job opening not found"), 404)
	doc = frappe.get_doc("Job Opening", job_opening)
	meta = frappe.get_meta("Job Opening")
	if meta.has_field("publish") and not cint(doc.publish):
		return _error(_("Job opening is not published"), 404)
	if meta.has_field("status") and doc.status and doc.status != "Open":
		return _error(_("Job opening is closed"), 404)
	return _success(_opening_row(doc))


def _decode_attachment(payload, field_label):
	"""Accept {filename, content_b64, content_type?} or empty."""
	if not payload:
		return None
	if isinstance(payload, str):
		try:
			payload = json.loads(payload)
		except Exception:
			return None
	if not isinstance(payload, dict):
		return None
	filename = (payload.get("filename") or "upload.bin").strip()
	content_b64 = payload.get("content_b64") or payload.get("content") or ""
	if not content_b64:
		return None
	ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
	if ext not in ALLOWED_ATTACH_EXT:
		frappe.throw(_("{0}: only PDF, JPG, PNG allowed").format(field_label))
	try:
		raw = base64.b64decode(content_b64)
	except Exception:
		frappe.throw(_("{0}: invalid file encoding").format(field_label))
	if len(raw) > MAX_ATTACH_BYTES:
		frappe.throw(_("{0}: max size is 2MB").format(field_label))
	return {"filename": filename, "content": raw}


def _save_file(filename, content, attached_to_doctype, attached_to_name, is_private=1):
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"content": content,
			"is_private": is_private,
			"attached_to_doctype": attached_to_doctype,
			"attached_to_name": attached_to_name,
		}
	)
	file_doc.save(ignore_permissions=True)
	return file_doc.file_url


@frappe.whitelist(allow_guest=True)
def submit_job_application(
	job_opening=None,
	full_name=None,
	email=None,
	mobile=None,
	application_json=None,
	resume=None,
	photo=None,
	aadhaar=None,
	other_document=None,
	declaration_accepted=None,
	utm_source=None,
):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_ensure_custom_fields()

	job_opening = _parse_request_value("job_opening", job_opening)
	full_name = (_parse_request_value("full_name", full_name) or "").strip()
	email = (_parse_request_value("email", email) or "").strip().lower()
	mobile = (_parse_request_value("mobile", mobile) or "").strip()
	declaration_accepted = cint(_parse_request_value("declaration_accepted", declaration_accepted) or 0)
	application_json = _parse_request_value("application_json", application_json)
	utm_source = (_parse_request_value("utm_source", utm_source) or "").strip()

	if not job_opening or not frappe.db.exists("Job Opening", job_opening):
		return _error(_("Invalid job opening"))
	opening = frappe.get_doc("Job Opening", job_opening)
	ometa = frappe.get_meta("Job Opening")
	if ometa.has_field("publish") and not cint(opening.publish):
		return _error(_("This job is not open for applications"))
	if not full_name or not email or not mobile:
		return _error(_("Full name, email, and mobile are required"))
	if not declaration_accepted:
		return _error(_("Please accept the declaration"))
	if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
		return _error(_("Invalid email address"))

	resume_file = _decode_attachment(_parse_request_value("resume", resume), "Resume")
	photo_file = _decode_attachment(_parse_request_value("photo", photo), "Photo")
	aadhaar_file = _decode_attachment(_parse_request_value("aadhaar", aadhaar), "Aadhaar")
	other_file = _decode_attachment(_parse_request_value("other_document", other_document), "Other document")
	if not resume_file:
		return _error(_("Resume / CV is required"))

	payload = application_json
	if isinstance(payload, str):
		try:
			payload = json.loads(payload) if payload else {}
		except Exception:
			payload = {"raw": payload}
	if not isinstance(payload, dict):
		payload = {}

	meta = frappe.get_meta("Job Applicant")
	doc = frappe.new_doc("Job Applicant")
	if meta.has_field("applicant_name"):
		doc.applicant_name = full_name
	if meta.has_field("email_id"):
		doc.email_id = email
	if meta.has_field("phone_number"):
		doc.phone_number = mobile
	if meta.has_field("job_title"):
		# HRMS often links via job_title (Link to Job Opening)
		doc.job_title = job_opening
	if meta.has_field("status"):
		doc.status = "Open"
	if meta.has_field("hec_pipeline_stage"):
		doc.hec_pipeline_stage = "Received"
	if meta.has_field("hec_source"):
		# Prefer UTM / ad source when present; default career site
		if utm_source:
			mapped = {
				"facebook": "Facebook Ads",
				"fb": "Facebook Ads",
				"instagram": "Instagram Ads",
				"ig": "Instagram Ads",
				"google": "Google Ads",
				"linkedin": "LinkedIn Ads",
			}
			key = utm_source.lower().replace(" ", "")
			doc.hec_source = mapped.get(key) or (
				utm_source if utm_source in mapped.values() else "Career Website"
			)
		else:
			doc.hec_source = "Career Website"
	if meta.has_field("hec_mobile"):
		doc.hec_mobile = mobile
	if meta.has_field("hec_declaration_accepted"):
		doc.hec_declaration_accepted = 1
	if meta.has_field("hec_application_json"):
		doc.hec_application_json = json.dumps(payload, ensure_ascii=False)

	session_user = frappe.session.user
	if session_user and session_user not in ("Guest",) and meta.has_field("hec_user"):
		doc.hec_user = session_user

	doc.insert(ignore_permissions=True)

	# Attach files after insert so attached_to_name exists
	if resume_file and meta.has_field("resume_attachment"):
		url = _save_file(resume_file["filename"], resume_file["content"], "Job Applicant", doc.name)
		doc.resume_attachment = url
	if photo_file and meta.has_field("hec_photo"):
		url = _save_file(photo_file["filename"], photo_file["content"], "Job Applicant", doc.name)
		doc.hec_photo = url
	if aadhaar_file and meta.has_field("hec_aadhaar"):
		url = _save_file(aadhaar_file["filename"], aadhaar_file["content"], "Job Applicant", doc.name)
		doc.hec_aadhaar = url
	if other_file and meta.has_field("hec_other_document"):
		url = _save_file(other_file["filename"], other_file["content"], "Job Applicant", doc.name)
		doc.hec_other_document = url
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	# Mirror into marketing Recent Leads (UTM or career website)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync import (
			_mirror_applicant_as_lead,
		)

		_mirror_applicant_as_lead(doc.name, utm_source=utm_source or getattr(doc, "hec_source", None))
	except Exception:
		frappe.log_error(title="mirror_applicant_as_lead")

	return _success(
		{
			"application_id": doc.name,
			"job_opening": job_opening,
			"pipeline_stage": "Received",
			"submitted_at": str(now_datetime()),
		},
		message="Application submitted",
	)


def _applicant_summary(r):
	return {
		"name": r.name,
		"applicant_name": r.get("applicant_name"),
		"email_id": r.get("email_id"),
		"phone_number": r.get("hec_mobile") or r.get("phone_number"),
		"job_opening": r.get("job_title"),
		"status": r.get("status"),
		"pipeline_stage": r.get("hec_pipeline_stage") or "Received",
		"source": r.get("hec_source") or "",
		"applied_on": str(r.creation.date()) if r.get("creation") else None,
	}


@frappe.whitelist(allow_guest=True)
def list_job_applications(job_opening=None, stage=None, source=None, limit=100):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_hr()
	_ensure_custom_fields()

	job_opening = _parse_request_value("job_opening", job_opening)
	stage = _parse_request_value("stage", stage)
	source = _parse_request_value("source", source)
	limit = cint(_parse_request_value("limit", limit) or 100)

	meta = frappe.get_meta("Job Applicant")
	filters = {}
	if job_opening and meta.has_field("job_title"):
		filters["job_title"] = job_opening
	if stage and meta.has_field("hec_pipeline_stage"):
		filters["hec_pipeline_stage"] = stage
	if source and meta.has_field("hec_source"):
		filters["hec_source"] = source

	fields = ["name", "creation"]
	for f in (
		"applicant_name",
		"email_id",
		"phone_number",
		"job_title",
		"status",
		"hec_pipeline_stage",
		"hec_source",
		"hec_mobile",
	):
		if meta.has_field(f):
			fields.append(f)

	rows = frappe.get_all(
		"Job Applicant",
		filters=filters,
		fields=fields,
		order_by="creation desc",
		limit_page_length=limit,
	)
	return _success({"applications": [_applicant_summary(r) for r in rows], "stages": list(PIPELINE_STAGES)})


@frappe.whitelist(allow_guest=True)
def get_job_application(application=None):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_hr()
	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	doc = frappe.get_doc("Job Applicant", application)
	payload = {}
	raw = getattr(doc, "hec_application_json", None)
	if raw:
		try:
			payload = json.loads(raw)
		except Exception:
			payload = {}

	opening = None
	job_ref = getattr(doc, "job_title", None)
	if job_ref and frappe.db.exists("Job Opening", job_ref):
		opening = _opening_row(frappe.get_doc("Job Opening", job_ref))

	return _success(
		{
			"name": doc.name,
			"applicant_name": doc.applicant_name,
			"email_id": getattr(doc, "email_id", None),
			"phone_number": getattr(doc, "hec_mobile", None) or getattr(doc, "phone_number", None),
			"job_opening": job_ref,
			"opening": opening,
			"status": getattr(doc, "status", None),
			"pipeline_stage": getattr(doc, "hec_pipeline_stage", None) or "Received",
			"source": getattr(doc, "hec_source", None) or "",
			"applied_on": str(doc.creation.date()) if doc.creation else None,
			"documents": {
				"resume": getattr(doc, "resume_attachment", None),
				"photo": getattr(doc, "hec_photo", None),
				"aadhaar": getattr(doc, "hec_aadhaar", None),
				"other": getattr(doc, "hec_other_document", None),
			},
			"application": payload,
			"stages": list(PIPELINE_STAGES),
		}
	)


@frappe.whitelist(allow_guest=True)
def update_application_stage(application=None, stage=None, reject=None):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_hr()
	_ensure_custom_fields()

	application = _parse_request_value("application", application)
	stage = (_parse_request_value("stage", stage) or "").strip()
	reject = cint(_parse_request_value("reject", reject) or 0)

	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	doc = frappe.get_doc("Job Applicant", application)
	meta = frappe.get_meta("Job Applicant")

	if reject:
		stage = "Rejected"
	if not stage:
		# Move to next stage
		current = getattr(doc, "hec_pipeline_stage", None) or "Received"
		ordered = [s for s in PIPELINE_STAGES if s != "Rejected"]
		try:
			idx = ordered.index(current)
			stage = ordered[min(idx + 1, len(ordered) - 1)]
		except ValueError:
			stage = "Screening"

	if stage not in PIPELINE_STAGES:
		return _error(_("Invalid pipeline stage"))

	if meta.has_field("hec_pipeline_stage"):
		doc.hec_pipeline_stage = stage
	if meta.has_field("status"):
		if stage == "Rejected":
			doc.status = "Rejected"
		elif stage in ("Offer", "Onboarding"):
			doc.status = "Accepted"
		else:
			doc.status = "Open"
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"application_id": doc.name, "pipeline_stage": stage, "status": getattr(doc, "status", None)})


@frappe.whitelist(allow_guest=True)
def smoke_phase73b():
	frappe.flags.ignore_csrf = True
	has_jo = frappe.db.exists("DocType", "Job Opening")
	has_ja = frappe.db.exists("DocType", "Job Applicant")
	published = 0
	if has_jo:
		filters = {"publish": 1} if frappe.get_meta("Job Opening").has_field("publish") else {}
		published = frappe.db.count("Job Opening", filters)
	hr_email = DEMO_HR_MANAGER["email"]
	hr_ok = bool(frappe.db.exists("User", hr_email))
	hr_roles = []
	if hr_ok:
		hr_roles = frappe.get_roles(hr_email)
	return _success(
		{
			"job_opening": bool(has_jo),
			"job_applicant": bool(has_ja),
			"published_openings": published,
			"custom_pipeline": bool(
				frappe.db.exists("Custom Field", {"dt": "Job Applicant", "fieldname": "hec_pipeline_stage"})
			),
			"hec_user_field": bool(
				frappe.db.exists("Custom Field", {"dt": "Job Applicant", "fieldname": "hec_user"})
			),
			"demo_hr_manager": hr_email if hr_ok else None,
			"demo_hr_has_role": "HR Manager" in hr_roles,
		}
	)


def _require_login():
	if frappe.session.user in ("Guest", None):
		frappe.throw(_("Please sign in"), frappe.PermissionError)


def _parse_profile_json(raw):
	if not raw:
		return {}
	if isinstance(raw, dict):
		return raw
	try:
		data = json.loads(raw)
		return data if isinstance(data, dict) else {}
	except Exception:
		return {}


def _claim_applications_for_user(user):
	"""Attach orphan Job Applicants that match this user's email/mobile."""
	_ensure_custom_fields()
	if not frappe.db.exists("DocType", "Job Applicant"):
		return 0
	meta = frappe.get_meta("Job Applicant")
	if not meta.has_field("hec_user"):
		return 0

	udoc = frappe.get_doc("User", user)
	email = (udoc.email or "").strip().lower()
	mobile = (udoc.mobile_no or "").strip()
	# OTP users often use p{mobile}@otp.health.local
	if not mobile and email.startswith("p") and email.endswith("@otp.health.local"):
		mobile = email[1 : email.index("@")]

	claimed = 0
	names = set()
	if email and meta.has_field("email_id"):
		for name in frappe.get_all(
			"Job Applicant",
			filters={"email_id": email, "hec_user": ["in", ["", None]]},
			pluck="name",
		):
			names.add(name)
		# also unlinked with empty hec_user via or — Frappe null filters are awkward; fetch and filter
		for row in frappe.get_all(
			"Job Applicant",
			filters={"email_id": email},
			fields=["name", "hec_user"],
			limit_page_length=50,
		):
			if not row.get("hec_user"):
				names.add(row.name)

	if mobile:
		filters_list = []
		if meta.has_field("hec_mobile"):
			filters_list.append({"hec_mobile": mobile})
		if meta.has_field("phone_number"):
			filters_list.append({"phone_number": mobile})
		for fl in filters_list:
			for row in frappe.get_all("Job Applicant", filters=fl, fields=["name", "hec_user"], limit_page_length=50):
				if not row.get("hec_user"):
					names.add(row.name)

	for name in names:
		frappe.db.set_value("Job Applicant", name, "hec_user", user, update_modified=False)
		claimed += 1
	if claimed:
		frappe.db.commit()
	return claimed


def _my_application_filters(user):
	"""Return (filters, or_filters) for this applicant's Job Applicants."""
	meta = frappe.get_meta("Job Applicant")
	email = (frappe.db.get_value("User", user, "email") or "").strip().lower()
	mobile = (frappe.db.get_value("User", user, "mobile_no") or "").strip()
	or_filters = []
	if meta.has_field("hec_user"):
		or_filters.append(["hec_user", "=", user])
	if email and meta.has_field("email_id"):
		or_filters.append(["email_id", "=", email])
	if mobile and meta.has_field("hec_mobile"):
		or_filters.append(["hec_mobile", "=", mobile])
	if mobile and meta.has_field("phone_number"):
		or_filters.append(["phone_number", "=", mobile])
	if not or_filters:
		return {"name": "__none__"}, None
	return None, or_filters


@frappe.whitelist(allow_guest=True)
def claim_my_applications():
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_login()
	claimed = _claim_applications_for_user(frappe.session.user)
	return _success({"claimed": claimed})


@frappe.whitelist(allow_guest=True)
def get_my_career_hub():
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_login()
	_ensure_custom_fields()
	user = frappe.session.user
	claimed = _claim_applications_for_user(user)

	udoc = frappe.get_doc("User", user)
	profile = _parse_profile_json(getattr(udoc, "hec_career_profile", None))
	profile.setdefault("full_name", udoc.full_name or udoc.first_name)
	profile.setdefault("email", udoc.email)
	profile.setdefault("mobile", udoc.mobile_no)

	filters, or_filters = _my_application_filters(user)
	apps = frappe.get_all(
		"Job Applicant",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"applicant_name",
			"job_title",
			"status",
			"creation",
			"hec_pipeline_stage",
			"hec_source",
		]
		if frappe.get_meta("Job Applicant").has_field("hec_pipeline_stage")
		else ["name", "applicant_name", "job_title", "status", "creation"],
		order_by="creation desc",
		limit_page_length=50,
	)
	applications = [
		{
			"name": a.name,
			"applicant_name": a.get("applicant_name"),
			"job_opening": a.get("job_title"),
			"status": a.get("status"),
			"pipeline_stage": a.get("hec_pipeline_stage") or "Received",
			"source": a.get("hec_source") or "",
			"applied_on": str(a.creation.date()) if a.get("creation") else None,
		}
		for a in apps
	]
	return _success(
		{
			"profile": profile,
			"applications": applications,
			"claimed": claimed,
			"user": user,
		}
	)


@frappe.whitelist(allow_guest=True)
def update_my_career_profile(profile_json=None):
	frappe.flags.ignore_csrf = True
	_require_login()
	_ensure_custom_fields()
	raw = _parse_request_value("profile_json", profile_json)
	if isinstance(raw, str):
		try:
			data = json.loads(raw) if raw else {}
		except Exception:
			return _error(_("Invalid profile JSON"))
	elif isinstance(raw, dict):
		data = raw
	else:
		data = {}

	user = frappe.session.user
	udoc = frappe.get_doc("User", user)
	full_name = (data.get("full_name") or "").strip()
	if full_name:
		parts = full_name.split(None, 1)
		udoc.first_name = parts[0]
		udoc.last_name = parts[1] if len(parts) > 1 else ""
	email = (data.get("email") or "").strip().lower()
	# Don't change OTP synthetic emails unless a real email is provided and different domain
	if email and "@" in email and not email.endswith("@otp.health.local"):
		# Keep login email stable; store contact email in profile only if different
		data["contact_email"] = email
	mobile = (data.get("mobile") or "").strip()
	if mobile and frappe.get_meta("User").has_field("mobile_no"):
		udoc.mobile_no = mobile
	if frappe.get_meta("User").has_field("hec_career_profile"):
		udoc.hec_career_profile = json.dumps(data, ensure_ascii=False)
	udoc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"profile": data})


@frappe.whitelist(allow_guest=True)
def list_my_applications(limit=50):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_login()
	_ensure_custom_fields()
	_claim_applications_for_user(frappe.session.user)
	limit = cint(_parse_request_value("limit", limit) or 50)
	meta = frappe.get_meta("Job Applicant")
	fields = ["name", "applicant_name", "job_title", "status", "creation"]
	for f in ("hec_pipeline_stage", "hec_source", "hec_mobile", "email_id"):
		if meta.has_field(f):
			fields.append(f)
	filters, or_filters = _my_application_filters(frappe.session.user)
	rows = frappe.get_all(
		"Job Applicant",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="creation desc",
		limit_page_length=limit,
	)
	return _success({"applications": [_applicant_summary(r) for r in rows]})


@frappe.whitelist(allow_guest=True)
def get_my_application(application=None):
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_login()
	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)
	doc = frappe.get_doc("Job Applicant", application)
	user = frappe.session.user
	owner = getattr(doc, "hec_user", None)
	email = (frappe.db.get_value("User", user, "email") or "").lower()
	if owner and owner != user:
		return _error(_("Not your application"), 403)
	if not owner and getattr(doc, "email_id", None) and str(doc.email_id).lower() != email:
		# allow if mobile matches
		umobile = frappe.db.get_value("User", user, "mobile_no") or ""
		amobile = getattr(doc, "hec_mobile", None) or getattr(doc, "phone_number", None) or ""
		if not umobile or str(umobile) != str(amobile):
			return _error(_("Not your application"), 403)

	# Reuse HR detail shape without requiring HR role
	payload = {}
	raw = getattr(doc, "hec_application_json", None)
	if raw:
		try:
			payload = json.loads(raw)
		except Exception:
			payload = {}
	opening = None
	job_ref = getattr(doc, "job_title", None)
	if job_ref and frappe.db.exists("Job Opening", job_ref):
		opening = _opening_row(frappe.get_doc("Job Opening", job_ref))
	return _success(
		{
			"name": doc.name,
			"applicant_name": doc.applicant_name,
			"email_id": getattr(doc, "email_id", None),
			"phone_number": getattr(doc, "hec_mobile", None) or getattr(doc, "phone_number", None),
			"job_opening": job_ref,
			"opening": opening,
			"status": getattr(doc, "status", None),
			"pipeline_stage": getattr(doc, "hec_pipeline_stage", None) or "Received",
			"source": getattr(doc, "hec_source", None) or "",
			"applied_on": str(doc.creation.date()) if doc.creation else None,
			"documents": {
				"resume": getattr(doc, "resume_attachment", None),
				"photo": getattr(doc, "hec_photo", None),
				"aadhaar": getattr(doc, "hec_aadhaar", None),
				"other": getattr(doc, "hec_other_document", None),
			},
			"application": payload,
			"stages": list(PIPELINE_STAGES),
			"read_only": True,
		}
	)


@frappe.whitelist(allow_guest=True)
def list_my_career_documents():
	frappe.flags.ignore_csrf = True
	_require_hrms()
	_require_login()
	_ensure_custom_fields()
	_claim_applications_for_user(frappe.session.user)
	docs = []
	meta = frappe.get_meta("Job Applicant")
	fields = ["name", "job_title", "applicant_name"]
	for f in ("resume_attachment", "hec_photo", "hec_aadhaar", "hec_other_document"):
		if meta.has_field(f):
			fields.append(f)
	filters, or_filters = _my_application_filters(frappe.session.user)
	for row in frappe.get_all(
		"Job Applicant",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="creation desc",
		limit_page_length=50,
	):
		for key, label in (
			("resume_attachment", "Resume"),
			("hec_photo", "Photo"),
			("hec_aadhaar", "Aadhaar"),
			("hec_other_document", "Other"),
		):
			url = row.get(key)
			if url:
				docs.append(
					{
						"application": row.name,
						"job_opening": row.get("job_title"),
						"label": label,
						"url": url,
					}
				)
	return _success({"documents": docs})
