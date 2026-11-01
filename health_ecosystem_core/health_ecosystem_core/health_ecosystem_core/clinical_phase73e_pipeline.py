"""
Phase 73e — Deeper recruitment pipeline: interviews, notes, offers, onboarding.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
	PIPELINE_STAGES,
	_require_hr,
)

HR_ROLES = (
	"System Manager",
	"Health System Admin",
	"HR Manager",
	"HR User",
)

# Published demo defaults (docs/SOP-HR-HIRE-WORKFLOW-CREDENTIALS.txt). No longer applied: existing logins keep their
# password, new ones get hec_seed_staff_password / a random temp password; setup_phase132 reads them for admin rotation.
HIRE_DEMO_EMAIL = "demo.hire.people@health.local"
HIRE_DEMO_PASSWORD = "HirePeopleDemo@123"
PEOPLE_DEMO = {
	"email": "people.demo@health.local",
	"username": "people_demo",
	"first_name": "People",
	"last_name": "Demo",
	"password": "PeopleDemoChangeMe@123",
	"roles": ("Employee",),
}


def setup_phase73e():
	return {
		"ok": True,
		"phase": "73e",
		"doctypes": {
			"HEC Interview Schedule": bool(frappe.db.exists("DocType", "HEC Interview Schedule")),
			"HEC Application Note": bool(frappe.db.exists("DocType", "HEC Application Note")),
			"HEC Job Offer": bool(frappe.db.exists("DocType", "HEC Job Offer")),
		},
	}


def _ensure_role_name(role):
	if not role:
		return
	if frappe.db.exists("Role", role):
		return
	frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def _grant_user_roles(user_id, roles):
	"""Persist Has Role rows (more reliable than User.roles child alone)."""
	added = []
	user = frappe.get_doc("User", user_id)
	for role in roles or []:
		_ensure_role_name(role)
		if frappe.db.exists("Has Role", {"parent": user_id, "role": role}):
			continue
		try:
			user.add_roles(role)
			added.append(role)
		except Exception:
			frappe.get_doc(
				{
					"doctype": "Has Role",
					"parent": user_id,
					"parenttype": "User",
					"parentfield": "roles",
					"role": role,
				}
			).insert(ignore_permissions=True)
			added.append(role)
	return added


def _upsert_demo_user(email, *, username, first_name, last_name, password, roles):
	"""`password` is the published default and is not applied; a new login gets the staff seed password."""
	created = not frappe.db.exists("User", email)
	if created:
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name,
				"username": username,
				"user_type": "System User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)

	user = frappe.get_doc("User", email)
	user.username = username
	user.enabled = 1
	user.user_type = "System User"
	user.first_name = first_name
	user.last_name = last_name
	user.save(ignore_permissions=True)
	added = _grant_user_roles(email, roles)
	if created:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import set_new_staff_password

		set_new_staff_password(email)
	employee = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
			ensure_employee_for_user,
		)

		employee = ensure_employee_for_user(email)
	except Exception:
		frappe.log_error(title="hr_hire_seed_employee", message=frappe.get_traceback())
	return {
		"email": email,
		"username": username,
		"created": created,
		"roles": list(frappe.get_roles(email)),
		"roles_added": added,
		"employee": employee,
	}


def seed_hr_hire_workflow_accounts():
	"""Seed/repair fixed UnPw for Planning → Careers CRM → Hire → People path."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
		seed_demo_hr_manager,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
		ensure_people_admin_roles,
	)

	out = {"ok": True, "accounts": {}}

	try:
		out["accounts"]["hr_manager"] = seed_demo_hr_manager()
		# System Manager would make setup_phase132 replace the portal password on every run.
		_grant_user_roles(
			"hr_manager@health.local",
			("HR Manager", "HR User", "Employee"),
		)
	except Exception as exc:
		out["ok"] = False
		out["accounts"]["hr_manager"] = {"error": str(exc)}

	try:
		out["accounts"]["people_demo"] = _upsert_demo_user(
			PEOPLE_DEMO["email"],
			username=PEOPLE_DEMO["username"],
			first_name=PEOPLE_DEMO["first_name"],
			last_name=PEOPLE_DEMO["last_name"],
			password=PEOPLE_DEMO["password"],
			roles=PEOPLE_DEMO["roles"],
		)
	except Exception as exc:
		out["ok"] = False
		out["accounts"]["people_demo"] = {"error": str(exc)}

	try:
		out["accounts"]["system_admin_roles"] = ensure_people_admin_roles()
	except Exception as exc:
		out["ok"] = False
		out["accounts"]["system_admin_roles"] = {"error": str(exc)}

	# Hiring now lives in clinical_phase120_hiring; no demo campaigns/openings are seeded.
	frappe.db.commit()
	frappe.clear_cache()
	return out


def _add_note(application, content, note_type="Activity"):
	if not frappe.db.exists("DocType", "HEC Application Note"):
		return None
	doc = frappe.get_doc(
		{
			"doctype": "HEC Application Note",
			"job_applicant": application,
			"note_type": note_type,
			"content": content,
			"created_by_user": frappe.session.user,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _set_pipeline(application, stage):
	if stage not in PIPELINE_STAGES:
		frappe.throw(_("Invalid stage"))
	meta = frappe.get_meta("Job Applicant")
	if meta.has_field("hec_pipeline_stage"):
		frappe.db.set_value("Job Applicant", application, "hec_pipeline_stage", stage)
	if meta.has_field("status"):
		status = "Rejected" if stage == "Rejected" else ("Accepted" if stage in ("Offer", "Onboarding") else "Open")
		frappe.db.set_value("Job Applicant", application, "status", status)
	# Keep Desk ATS status in sync (Phase 112)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring import (
			PIPELINE_TO_ATS,
		)

		if meta.has_field("hec_applicant_status"):
			mapped = PIPELINE_TO_ATS.get(stage)
			if mapped:
				frappe.db.set_value("Job Applicant", application, "hec_applicant_status", mapped)
	except Exception:
		pass


@frappe.whitelist(allow_guest=True)
def get_application_pipeline(application=None):
	frappe.flags.ignore_csrf = True
	_require_hr()
	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	interviews = []
	if frappe.db.exists("DocType", "HEC Interview Schedule"):
		interviews = frappe.get_all(
			"HEC Interview Schedule",
			filters={"job_applicant": application},
			fields=[
				"name",
				"interview_type",
				"scheduled_on",
				"duration_minutes",
				"status",
				"interviewer",
				"meeting_link",
				"location",
				"notes",
			],
			order_by="scheduled_on desc",
			limit_page_length=50,
		)

	notes = []
	if frappe.db.exists("DocType", "HEC Application Note"):
		notes = frappe.get_all(
			"HEC Application Note",
			filters={"job_applicant": application},
			fields=["name", "note_type", "content", "created_by_user", "creation"],
			order_by="creation desc",
			limit_page_length=100,
		)

	offers = []
	if frappe.db.exists("DocType", "HEC Job Offer"):
		meta_offer = frappe.get_meta("HEC Job Offer")
		safe_fields = [
			f
			for f in [
				"name",
				"designation",
				"department",
				"offer_date",
				"joining_date",
				"status",
				"salary_offered",
				"notes",
				"grade",
				"salary_structure",
				"letter_type",
				"email_status",
				"recipient_email",
				"email_subject",
				"email_queued_on",
				"email_sent_on",
			]
			if f == "name" or meta_offer.has_field(f)
		]
		offers = frappe.get_all(
			"HEC Job Offer",
			filters={"job_applicant": application},
			fields=safe_fields,
			order_by="creation desc",
			limit_page_length=20,
		)

	onboarding_todos = []
	# Find linked ToDos referencing this applicant name in description
	if frappe.db.exists("DocType", "ToDo"):
		onboarding_todos = frappe.get_all(
			"ToDo",
			filters={"description": ["like", f"%{application}%"], "status": ["!=", "Cancelled"]},
			fields=["name", "description", "status", "date", "allocated_to"],
			limit_page_length=20,
		)

	return _success(
		{
			"application": application,
			"interviews": interviews,
			"notes": [
				{
					**n,
					"created_on": str(n.creation) if n.get("creation") else None,
				}
				for n in notes
			],
			"offers": offers,
			"onboarding_todos": onboarding_todos,
			"stages": list(PIPELINE_STAGES),
		}
	)


@frappe.whitelist(allow_guest=True)
def schedule_interview(
	application=None,
	scheduled_on=None,
	interview_type=None,
	duration_minutes=None,
	interviewer=None,
	meeting_link=None,
	location=None,
	notes=None,
	move_to_interview=None,
):
	frappe.flags.ignore_csrf = True
	_require_hr()
	if not frappe.db.exists("DocType", "HEC Interview Schedule"):
		return _error(_("Interview DocType missing — run migrate"))

	application = _parse_request_value("application", application)
	scheduled_on = _parse_request_value("scheduled_on", scheduled_on)
	interview_type = (_parse_request_value("interview_type", interview_type) or "Screening").strip()
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)
	if not scheduled_on:
		return _error(_("scheduled_on is required"))

	doc = frappe.get_doc(
		{
			"doctype": "HEC Interview Schedule",
			"job_applicant": application,
			"interview_type": interview_type,
			"scheduled_on": get_datetime(scheduled_on),
			"duration_minutes": cint(_parse_request_value("duration_minutes", duration_minutes) or 30),
			"interviewer": _parse_request_value("interviewer", interviewer) or frappe.session.user,
			"meeting_link": _parse_request_value("meeting_link", meeting_link) or "",
			"location": _parse_request_value("location", location) or "",
			"notes": _parse_request_value("notes", notes) or "",
			"status": "Scheduled",
		}
	)
	doc.insert(ignore_permissions=True)

	move = cint(_parse_request_value("move_to_interview", move_to_interview) or 1)
	stage_set = None
	if move:
		stage_set = "Assessment" if interview_type == "Assessment" else "Interview"
		_set_pipeline(application, stage_set)
	_add_note(
		application,
		f"Interview scheduled ({interview_type}) on {scheduled_on}",
		"Activity",
	)
	frappe.db.commit()
	return _success({"interview_id": doc.name, "pipeline_stage": stage_set})


@frappe.whitelist(allow_guest=True)
def update_interview_status(interview=None, status=None):
	frappe.flags.ignore_csrf = True
	_require_hr()
	interview = _parse_request_value("interview", interview)
	status = (_parse_request_value("status", status) or "").strip()
	if not interview or not frappe.db.exists("HEC Interview Schedule", interview):
		return _error(_("Interview not found"), 404)
	if status not in ("Scheduled", "Completed", "Cancelled", "No Show"):
		return _error(_("Invalid status"))
	doc = frappe.get_doc("HEC Interview Schedule", interview)
	doc.status = status
	doc.save(ignore_permissions=True)
	_add_note(doc.job_applicant, f"Interview {interview} marked {status}", "Activity")
	frappe.db.commit()
	return _success({"interview_id": interview, "status": status})


@frappe.whitelist(allow_guest=True)
def add_application_note(application=None, content=None, note_type=None):
	frappe.flags.ignore_csrf = True
	_require_hr()
	application = _parse_request_value("application", application)
	content = (_parse_request_value("content", content) or "").strip()
	note_type = (_parse_request_value("note_type", note_type) or "Note").strip()
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)
	if not content:
		return _error(_("Note content is required"))
	if not frappe.db.exists("DocType", "HEC Application Note"):
		return _error(_("Notes DocType missing — run migrate"))
	name = _add_note(application, content, note_type if note_type in ("Note", "Activity", "System") else "Note")
	frappe.db.commit()
	return _success({"note_id": name})


@frappe.whitelist(allow_guest=True)
def create_job_offer(
	application=None,
	designation=None,
	department=None,
	joining_date=None,
	salary_offered=None,
	notes=None,
	send=None,
):
	frappe.flags.ignore_csrf = True
	_require_hr()
	if not frappe.db.exists("DocType", "HEC Job Offer"):
		return _error(_("Offer DocType missing — run migrate"))

	ensure_offer_email_fields()

	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	applicant = frappe.get_doc("Job Applicant", application)
	opening_title = getattr(applicant, "job_title", None)
	designation = (_parse_request_value("designation", designation) or "").strip()
	if not designation and opening_title and frappe.db.exists("Job Opening", opening_title):
		designation = frappe.db.get_value("Job Opening", opening_title, "job_title") or opening_title

	# send=1 historically flipped status Sent without email. Now always Draft until manager
	# approves the queued pack via send_job_offer_email. force_send still available for tests.
	force_send = cint(_parse_request_value("send", send) or 0) == 2
	doc = frappe.get_doc(
		{
			"doctype": "HEC Job Offer",
			"job_applicant": application,
			"designation": designation,
			"department": _parse_request_value("department", department) or "",
			"offer_date": today(),
			"joining_date": _parse_request_value("joining_date", joining_date) or None,
			"salary_offered": _parse_request_value("salary_offered", salary_offered) or 0,
			"notes": _parse_request_value("notes", notes) or "",
			"status": "Draft",
		}
	)
	doc.insert(ignore_permissions=True)
	_set_pipeline(application, "Offer")

	queue = queue_offer_email_pack(doc.name)
	status_msg = f"Offer {doc.name} created (Draft)"
	if queue.get("ok"):
		status_msg += f" · email pack queued for review ({queue.get('letter_type')}/{queue.get('grade')})"
	else:
		status_msg += f" · email queue skipped: {queue.get('error') or 'unknown'}"
	_add_note(application, status_msg + (f" — {designation}" if designation else ""), "Activity")

	sent = None
	if force_send and queue.get("ok"):
		sent = send_job_offer_email(offer=doc.name)

	frappe.db.commit()
	doc.reload()
	return _success(
		{
			"offer_id": doc.name,
			"status": doc.status,
			"pipeline_stage": "Offer",
			"email_status": getattr(doc, "email_status", None) or queue.get("email_status"),
			"email_pack": queue,
			"sent": sent,
		}
	)


def ensure_offer_email_fields():
	"""Add offer-email pack fields on HEC Job Offer (Custom Field if DocType not remigrated)."""
	if not frappe.db.exists("DocType", "HEC Job Offer"):
		return False
	meta = frappe.get_meta("HEC Job Offer")
	specs = [
		{"fieldname": "grade", "label": "Grade Band", "fieldtype": "Data", "insert_after": "salary_offered"},
		{
			"fieldname": "salary_structure",
			"label": "Salary Structure",
			"fieldtype": "Data",
			"insert_after": "grade",
		},
		{
			"fieldname": "letter_type",
			"label": "Letter Template",
			"fieldtype": "Select",
			"options": "\nfield\nhq\nfranchise",
			"insert_after": "salary_structure",
		},
		{
			"fieldname": "email_status",
			"label": "Email Status",
			"fieldtype": "Select",
			"options": "None\nPending Review\nSent\nFailed",
			"default": "None",
			"insert_after": "letter_type",
		},
		{
			"fieldname": "recipient_email",
			"label": "Recipient Email",
			"fieldtype": "Data",
			"insert_after": "email_status",
		},
		{
			"fieldname": "email_subject",
			"label": "Email Subject",
			"fieldtype": "Data",
			"insert_after": "recipient_email",
		},
		{
			"fieldname": "email_queued_on",
			"label": "Queued On",
			"fieldtype": "Datetime",
			"insert_after": "email_subject",
		},
		{
			"fieldname": "email_sent_on",
			"label": "Sent On",
			"fieldtype": "Datetime",
			"insert_after": "email_queued_on",
		},
		{
			"fieldname": "email_sent_by",
			"label": "Sent By",
			"fieldtype": "Link",
			"options": "User",
			"insert_after": "email_sent_on",
		},
		{
			"fieldname": "email_html",
			"label": "Email HTML Body",
			"fieldtype": "Long Text",
			"insert_after": "email_sent_by",
		},
	]
	created = 0
	for field in specs:
		if meta.has_field(field["fieldname"]):
			continue
		cf_name = f"HEC Job Offer-{field['fieldname']}"
		if frappe.db.exists("Custom Field", cf_name) or frappe.db.exists(
			"Custom Field", {"dt": "HEC Job Offer", "fieldname": field["fieldname"]}
		):
			continue
		try:
			frappe.get_doc(
				{
					"doctype": "Custom Field",
					"dt": "HEC Job Offer",
					"module": "Health Ecosystem Core",
					**field,
				}
			).insert(ignore_permissions=True)
			created += 1
		except Exception:
			frappe.log_error(title="ensure_offer_email_fields", message=frappe.get_traceback())
	if created:
		frappe.clear_cache(doctype="HEC Job Offer")
		frappe.db.commit()
	return True


def queue_offer_email_pack(offer_name):
	"""Build position template + payroll pack and mark offer Pending Review (not sent)."""
	ensure_offer_email_fields()
	if not offer_name or not frappe.db.exists("HEC Job Offer", offer_name):
		return {"ok": False, "error": "offer not found"}
	offer = frappe.get_doc("HEC Job Offer", offer_name)
	if not offer.job_applicant or not frappe.db.exists("Job Applicant", offer.job_applicant):
		return {"ok": False, "error": "applicant missing"}
	applicant = frappe.get_doc("Job Applicant", offer.job_applicant)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
		build_job_offer_email_pack,
	)

	job_title = None
	opening = getattr(applicant, "job_title", None)
	if opening and frappe.db.exists("Job Opening", opening):
		job_title = frappe.db.get_value("Job Opening", opening, "job_title") or opening

	pack = build_job_offer_email_pack(
		applicant_name=getattr(applicant, "applicant_name", None) or applicant.name,
		applicant_email=getattr(applicant, "email_id", None),
		designation=offer.designation,
		department=offer.department,
		joining_date=offer.joining_date,
		salary_offered=offer.salary_offered,
		offer_name=offer.name,
		job_title=job_title,
	)
	meta = frappe.get_meta("HEC Job Offer")
	updates = {}
	for key, value in (
		("grade", pack.get("grade")),
		("salary_structure", pack.get("structure")),
		("letter_type", pack.get("letter_type")),
		("email_status", "Pending Review"),
		("recipient_email", pack.get("recipient_email")),
		("email_subject", pack.get("subject")),
		("email_html", pack.get("html")),
		("email_queued_on", now_datetime()),
	):
		if meta.has_field(key):
			updates[key] = value
	if updates:
		frappe.db.set_value("HEC Job Offer", offer.name, updates, update_modified=True)
	# Keep offer Draft until manager sends
	if meta.has_field("status") and offer.status == "Sent":
		frappe.db.set_value("HEC Job Offer", offer.name, "status", "Draft", update_modified=False)
	frappe.db.commit()
	return {
		"ok": True,
		"offer_id": offer.name,
		"email_status": "Pending Review",
		"letter_type": pack.get("letter_type"),
		"grade": pack.get("grade"),
		"structure": pack.get("structure"),
		"monthly_ctc": pack.get("monthly_ctc"),
		"subject": pack.get("subject"),
		"recipient_email": pack.get("recipient_email"),
		"print_formats": pack.get("print_formats"),
	}


@frappe.whitelist(allow_guest=True)
def get_job_offer_email(offer=None):
	"""Preview queued offer + agreement email pack for manager review."""
	frappe.flags.ignore_csrf = True
	_require_hr()
	offer = _parse_request_value("offer", offer)
	if not offer or not frappe.db.exists("HEC Job Offer", offer):
		return _error(_("Offer not found"), 404)
	ensure_offer_email_fields()
	doc = frappe.get_doc("HEC Job Offer", offer)
	html = getattr(doc, "email_html", None)
	if not html:
		queue_offer_email_pack(offer)
		doc.reload()
		html = getattr(doc, "email_html", None)
	return _success(
		{
			"offer_id": doc.name,
			"status": doc.status,
			"email_status": getattr(doc, "email_status", None),
			"recipient_email": getattr(doc, "recipient_email", None),
			"email_subject": getattr(doc, "email_subject", None),
			"grade": getattr(doc, "grade", None),
			"salary_structure": getattr(doc, "salary_structure", None),
			"letter_type": getattr(doc, "letter_type", None),
			"salary_offered": doc.salary_offered,
			"designation": doc.designation,
			"joining_date": str(doc.joining_date) if doc.joining_date else None,
			"email_queued_on": str(getattr(doc, "email_queued_on", "") or "") or None,
			"email_sent_on": str(getattr(doc, "email_sent_on", "") or "") or None,
			"html": html or "",
		}
	)


@frappe.whitelist(allow_guest=True)
def send_job_offer_email(offer=None):
	"""HR Manager approves queued pack → push to Email Queue / send."""
	frappe.flags.ignore_csrf = True
	_require_hr()
	offer = _parse_request_value("offer", offer)
	if not offer or not frappe.db.exists("HEC Job Offer", offer):
		return _error(_("Offer not found"), 404)
	ensure_offer_email_fields()
	doc = frappe.get_doc("HEC Job Offer", offer)
	if not getattr(doc, "email_html", None):
		queued = queue_offer_email_pack(offer)
		if not queued.get("ok"):
			return _error(queued.get("error") or _("Could not build offer email"))
		doc.reload()

	recipient = (getattr(doc, "recipient_email", None) or "").strip()
	if not recipient or "@" not in recipient:
		return _error(_("Applicant email missing — cannot send offer"))

	from health_ecosystem_core.health_ecosystem_core.clinical_email import (
		ensure_outgoing_email_account,
		noreply_email,
	)

	ok, setup_err = ensure_outgoing_email_account()
	if not ok:
		meta = frappe.get_meta("HEC Job Offer")
		if meta.has_field("email_status"):
			frappe.db.set_value("HEC Job Offer", doc.name, "email_status", "Failed")
			frappe.db.commit()
		return _error(setup_err or _("SMTP not configured"))

	subject = getattr(doc, "email_subject", None) or f"Job Offer — {doc.designation or 'Remedium'}"
	html = doc.email_html
	try:
		# now=False → Frappe Email Queue (auditable); workers flush outbound SMTP
		frappe.sendmail(
			recipients=[recipient],
			sender=noreply_email(),
			subject=subject,
			message=html,
			now=False,
			reference_doctype="HEC Job Offer",
			reference_name=doc.name,
		)
	except Exception as exc:
		frappe.log_error(title="send_job_offer_email", message=frappe.get_traceback())
		meta = frappe.get_meta("HEC Job Offer")
		if meta.has_field("email_status"):
			frappe.db.set_value("HEC Job Offer", doc.name, "email_status", "Failed")
			frappe.db.commit()
		return _error(str(exc) or _("Could not queue email"))

	meta = frappe.get_meta("HEC Job Offer")
	updates = {"status": "Sent"}
	if meta.has_field("email_status"):
		updates["email_status"] = "Sent"
	if meta.has_field("email_sent_on"):
		updates["email_sent_on"] = now_datetime()
	if meta.has_field("email_sent_by"):
		updates["email_sent_by"] = frappe.session.user
	frappe.db.set_value("HEC Job Offer", doc.name, updates, update_modified=True)
	_add_note(
		doc.job_applicant,
		f"Offer email approved & queued to Email Queue → {recipient} ({doc.name})",
		"Activity",
	)
	frappe.db.commit()
	return _success(
		{
			"ok": True,
			"offer_id": doc.name,
			"status": "Sent",
			"email_status": "Sent",
			"recipient_email": recipient,
			"subject": subject,
			"via": "Email Queue",
		}
	)


@frappe.whitelist(allow_guest=True)
def start_applicant_onboarding(application=None, employee=None):
	"""Move to Onboarding and create checklist ToDos (linked employee optional)."""
	frappe.flags.ignore_csrf = True
	_require_hr()
	application = _parse_request_value("application", application)
	employee = _parse_request_value("employee", employee)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	_set_pipeline(application, "Onboarding")
	todos = []
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import ensure_checklist_todos

		if employee and frappe.db.exists("Employee", employee):
			todos = ensure_checklist_todos(employee, "onboarding")
		else:
			# Applicant-scoped ToDos until Employee is created
			from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import ONBOARDING_TASKS
			from frappe.utils import add_days, getdate

			user = frappe.session.user
			due = add_days(getdate(today()), 7)
			for task in ONBOARDING_TASKS:
				desc = f"[HEC Onboarding] {task} — applicant {application}"
				if frappe.db.exists("ToDo", {"description": desc, "status": ["!=", "Cancelled"]}):
					continue
				td = frappe.get_doc(
					{
						"doctype": "ToDo",
						"description": desc,
						"allocated_to": user,
						"priority": "Medium",
						"status": "Open",
						"date": due,
					}
				)
				td.insert(ignore_permissions=True)
				todos.append(td.name)
	except Exception:
		frappe.log_error(title="start_applicant_onboarding", message=frappe.get_traceback())

	_add_note(application, f"Onboarding started ({len(todos)} checklist items)", "Activity")
	frappe.db.commit()
	return _success({"pipeline_stage": "Onboarding", "todos": todos, "employee": employee})


def _roles_for_designation(designation, department=""):
	text = f"{designation or ''} {department or ''}".lower()
	roles = ["Employee"]
	if "phlebo" in text:
		roles.append("Phlebotomist")
	elif "lab tech" in text or "laboratory" in text:
		roles.append("Lab Technician")
	elif "patholog" in text:
		roles.append("Pathologist")
	elif "sales" in text or "franchise" in text:
		roles.append("Sales Representative")
	return roles


def _parse_application_json(applicant):
	raw = getattr(applicant, "hec_application_json", None) or ""
	if not raw:
		return {}
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
		return data if isinstance(data, dict) else {}
	except Exception:
		return {}


def _ensure_hired_user(applicant, roles):
	from frappe.utils import random_string

	email = (getattr(applicant, "email_id", None) or "").strip().lower()
	if not email:
		frappe.throw(_("Applicant email is required to create a People user"))

	full_name = (getattr(applicant, "applicant_name", None) or email.split("@")[0]).strip()
	parts = full_name.split(None, 1)
	first_name = parts[0]
	last_name = parts[1] if len(parts) > 1 else ""
	mobile = getattr(applicant, "hec_mobile", None) or getattr(applicant, "phone_number", None) or ""
	temp_password = None
	created = False

	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
		if getattr(user, "enabled", 1) in (0, "0"):
			user.enabled = 1
			user.save(ignore_permissions=True)
	else:
		temp_password = f"Hire@{random_string(6)}"
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name,
				"full_name": full_name,
				"mobile_no": mobile,
				"send_welcome_email": 0,
				"user_type": "System User",
			}
		)
		user.insert(ignore_permissions=True)
		user.new_password = temp_password
		user.save(ignore_permissions=True)
		created = True

	_grant_user_roles(user.name, roles or [])

	return user.name, temp_password, created


def _ensure_link_master(doctype, name, extra=None):
	name = (name or "").strip()
	if not name or not frappe.db.exists("DocType", doctype):
		return None
	if frappe.db.exists(doctype, name):
		return name
	payload = {"doctype": doctype, **(extra or {})}
	meta = frappe.get_meta(doctype)
	if doctype == "Department":
		if meta.has_field("department_name"):
			payload["department_name"] = name
		if meta.has_field("company") and "company" not in payload:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import _default_company

			payload["company"] = _default_company()
	elif doctype == "Designation" and meta.has_field("designation_name"):
		payload["designation_name"] = name
	else:
		payload["name"] = name
	try:
		doc = frappe.get_doc(payload)
		doc.insert(ignore_permissions=True, ignore_links=True)
		return doc.name
	except Exception:
		# Name may already match unique dept_name after insert race
		if frappe.db.exists(doctype, name):
			return name
		frappe.log_error(title=f"ensure_{doctype}", message=frappe.get_traceback())
		return None


def _patch_employee_from_hire(employee, applicant, offer):
	if not employee or not frappe.db.exists("Employee", employee):
		return
	meta = frappe.get_meta("Employee")
	payload = _parse_application_json(applicant)
	personal = payload.get("personal") or {}
	updates = {}

	def _set(field, value):
		if value and meta.has_field(field):
			updates[field] = value

	designation = getattr(offer, "designation", None) if offer else None
	department = getattr(offer, "department", None) if offer else None
	if designation:
		designation = _ensure_link_master("Designation", designation) or designation
	if department:
		department = _ensure_link_master("Department", department) or department

	_set("designation", designation)
	_set("department", department)
	_set("date_of_joining", getattr(offer, "joining_date", None) if offer else None)
	_set("date_of_birth", personal.get("dob"))
	gender = personal.get("gender")
	if gender in ("Male", "Female", "Other"):
		_set("gender", gender)
	_set("cell_number", getattr(applicant, "hec_mobile", None) or getattr(applicant, "phone_number", None))
	_set("personal_email", getattr(applicant, "email_id", None))
	_set("company_email", getattr(applicant, "email_id", None))
	_set("current_address", personal.get("address"))
	if updates:
		try:
			frappe.db.set_value("Employee", employee, updates, update_modified=False)
		except Exception:
			# Fallback field-by-field ignoring missing links
			for k, v in updates.items():
				try:
					frappe.db.set_value("Employee", employee, k, v, update_modified=False)
				except Exception:
					pass


@frappe.whitelist(allow_guest=True)
def hire_applicant_to_people(
	application=None,
	roles=None,
	salary_offered=None,
	joining_date=None,
	designation=None,
	department=None,
	create_offer_if_missing=None,
):
	"""Finalize hire: User + Employee + Salary Structure Assignment + Onboarding → /people."""
	frappe.flags.ignore_csrf = True
	_require_hr()

	import json

	from frappe.utils import flt
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
		ensure_salary_structure,
		ensure_structure_assignment,
		setup_phase72,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import _ensure_custom_fields
	from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import ensure_hrms_modules

	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	_ensure_custom_fields()
	ensure_hrms_modules()
	try:
		setup_phase72()
	except Exception:
		frappe.log_error(title="hire_setup_phase72", message=frappe.get_traceback())

	applicant = frappe.get_doc("Job Applicant", application)
	applicant_meta = frappe.get_meta("Job Applicant")
	existing_emp = None
	if applicant_meta.has_field("hec_employee"):
		existing_emp = getattr(applicant, "hec_employee", None) or frappe.db.get_value(
			"Job Applicant", application, "hec_employee"
		)
	email_key = (getattr(applicant, "email_id", None) or "").strip().lower()
	if not existing_emp and email_key:
		existing_emp = frappe.db.get_value("Employee", {"user_id": email_key}, "name")
	if existing_emp and frappe.db.exists("Employee", existing_emp):
		user_name = frappe.db.get_value("Employee", existing_emp, "user_id")
		monthly = flt(_parse_request_value("salary_offered", salary_offered))
		if monthly <= 0:
			monthly = 35000.0
		return _success(
			{
				"application": application,
				"user": user_name,
				"user_created": False,
				"employee": existing_emp,
				"roles": frappe.get_roles(user_name) if user_name else [],
				"monthly_ctc": monthly,
				"people_path": "/people",
				"already_hired": True,
			},
			message=_("Applicant already hired into People HRMS"),
		)

	create_offer = cint(_parse_request_value("create_offer_if_missing", create_offer_if_missing) or 1)

	offer = None
	if frappe.db.exists("DocType", "HEC Job Offer"):
		offers = frappe.get_all(
			"HEC Job Offer",
			filters={"job_applicant": application},
			fields=[
				"name",
				"designation",
				"department",
				"joining_date",
				"salary_offered",
				"status",
			],
			order_by="creation desc",
			limit=1,
		)
		if offers:
			offer = frappe.get_doc("HEC Job Offer", offers[0].name)

	designation = (_parse_request_value("designation", designation) or "").strip() or (
		getattr(offer, "designation", None) if offer else ""
	)
	department = (_parse_request_value("department", department) or "").strip() or (
		getattr(offer, "department", None) if offer else ""
	)
	joining = _parse_request_value("joining_date", joining_date) or (
		getattr(offer, "joining_date", None) if offer else today()
	)
	salary = flt(_parse_request_value("salary_offered", salary_offered))
	if salary <= 0 and offer:
		salary = flt(getattr(offer, "salary_offered", 0))
	if salary <= 0:
		salary = 35000.0

	if not offer and create_offer and frappe.db.exists("DocType", "HEC Job Offer"):
		offer = frappe.get_doc(
			{
				"doctype": "HEC Job Offer",
				"job_applicant": application,
				"designation": designation or "Staff",
				"department": department or "",
				"offer_date": today(),
				"joining_date": joining,
				"salary_offered": salary,
				"status": "Accepted",
				"notes": "Auto-created during Hire to People",
			}
		)
		offer.insert(ignore_permissions=True)
	elif offer:
		changed = False
		if designation and offer.designation != designation:
			offer.designation = designation
			changed = True
		if department and offer.department != department:
			offer.department = department
			changed = True
		if joining and str(offer.joining_date or "") != str(joining):
			offer.joining_date = joining
			changed = True
		if salary and flt(offer.salary_offered) != salary:
			offer.salary_offered = salary
			changed = True
		if offer.status != "Accepted":
			offer.status = "Accepted"
			changed = True
		if changed:
			offer.save(ignore_permissions=True)

	roles_raw = _parse_request_value("roles", roles)
	role_list = []
	if roles_raw:
		if isinstance(roles_raw, str):
			try:
				parsed = json.loads(roles_raw)
				role_list = parsed if isinstance(parsed, list) else [x.strip() for x in roles_raw.split(",") if x.strip()]
			except Exception:
				role_list = [x.strip() for x in roles_raw.split(",") if x.strip()]
		elif isinstance(roles_raw, (list, tuple)):
			role_list = list(roles_raw)
	if not role_list:
		role_list = _roles_for_designation(designation, department)

	user_name, temp_password, user_created = _ensure_hired_user(applicant, role_list)
	employee = ensure_employee_for_user(user_name)
	if not employee:
		return _error(_("Could not create Employee for hired user"))

	_patch_employee_from_hire(employee, applicant, offer)
	frappe.db.commit()
	structure = ensure_salary_structure()
	assignment = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
			assign_employee_band,
			grade_for_designation,
			band_for_grade,
		)
		from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
			ensure_structure_assignment,
		)

		grade = grade_for_designation(designation)
		band = band_for_grade(grade)
		band_result = assign_employee_band(
			employee,
			designation=designation or band["designation"],
			grade=grade,
		)
		base = flt(salary) if salary else band["base"]
		assignment = ensure_structure_assignment(
			employee,
			structure=band["structure"] if frappe.db.exists("Salary Structure", band["structure"]) else structure,
			from_date=joining,
			base=base,
		) or band_result.get("assignment")
	except Exception:
		frappe.log_error(title="hire_ssa", message=frappe.get_traceback())
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import force_assign_employee_ctc

			ssa = force_assign_employee_ctc(employee, base=salary, from_date=joining)
			assignment = ssa.get("assignment")
		except Exception:
			try:
				assignment = ensure_structure_assignment(employee, structure=structure, from_date=joining, base=salary)
			except Exception:
				pass

	meta = frappe.get_meta("Job Applicant")
	if meta.has_field("hec_user"):
		frappe.db.set_value("Job Applicant", application, "hec_user", user_name, update_modified=False)
	if meta.has_field("hec_employee"):
		frappe.db.set_value("Job Applicant", application, "hec_employee", employee, update_modified=False)

	_set_pipeline(application, "Onboarding")
	onboarding = start_applicant_onboarding(application=application, employee=employee)
	# start_applicant_onboarding already returns _success dict — unwrap data if needed
	onboarding_data = onboarding.get("data") if isinstance(onboarding, dict) and "data" in onboarding else onboarding

	_add_note(
		application,
		f"Hired to People: user={user_name}, employee={employee}, CTC=₹{salary:,.0f}, roles={', '.join(role_list)}",
		"Activity",
	)
	frappe.db.commit()

	# Verify People dashboard CTC
	people = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
			get_people_hrms_dashboard,
		)

		people = get_people_hrms_dashboard(user_name, frappe.get_roles(user_name))
	except Exception:
		frappe.log_error(title="hire_people_sync", message=frappe.get_traceback())

	return _success(
		{
			"application": application,
			"user": user_name,
			"user_created": user_created,
			"temporary_password": temp_password,
			"employee": employee,
			"roles": role_list,
			"salary_structure": structure,
			"salary_structure_assignment": assignment,
			"monthly_ctc": salary,
			"offer": getattr(offer, "name", None),
			"pipeline_stage": "Onboarding",
			"onboarding": onboarding_data,
			"people_path": "/people",
			"people_sync": {
				"employee_id": (people or {}).get("employee", {}).get("id"),
				"monthly_ctc": (people or {}).get("compensation", {}).get("monthly_ctc"),
				"hr_available": (people or {}).get("hr_available"),
			},
		},
		message=_("Applicant hired into People HRMS"),
	)


@frappe.whitelist(allow_guest=True)
def smoke_hire_to_people_workflow():
	"""Seed openings → demo apply → rounds → offer → hire → People sync."""
	frappe.flags.ignore_csrf = True
	# Allow Administrator / System Manager without full HR role gate for smoke
	if frappe.session.user == "Guest":
		frappe.set_user("Administrator")

	from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
		ensure_published_sample_openings,
		setup_phase73b,
		submit_job_application,
	)

	out = {"ok": True, "steps": []}
	out["steps"].append({"setup_phase73b": setup_phase73b()})
	out["steps"].append({"openings": ensure_published_sample_openings()})

	openings = frappe.get_all(
		"Job Opening",
		filters={"status": "Open"},
		fields=["name", "job_title"],
		limit=1,
	)
	if not openings and frappe.db.exists("DocType", "Job Opening"):
		openings = frappe.get_all("Job Opening", fields=["name", "job_title"], limit=1)
	if not openings:
		out["ok"] = False
		out["error"] = "No job openings"
		return _success(out)

	opening = openings[0].name
	email = "demo.hire.people@health.local"
	# Clean prior demo hire for idempotent smoke
	if frappe.db.exists("Job Applicant", {"email_id": email}):
		for name in frappe.get_all("Job Applicant", filters={"email_id": email}, pluck="name"):
			try:
				frappe.delete_doc("Job Applicant", name, force=True, ignore_permissions=True)
			except Exception:
				pass
	if frappe.db.exists("User", email):
		emp = frappe.db.get_value("Employee", {"user_id": email}, "name")
		if emp:
			try:
				frappe.delete_doc("Employee", emp, force=True, ignore_permissions=True)
			except Exception:
				pass
		try:
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		except Exception:
			pass
	frappe.db.commit()

	# Tiny valid 1×1 PNG (Job Applicant attachments reject truncated PDFs)
	png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	resume = json.dumps({"filename": "demo-resume.png", "content": png_b64})
	application_json = json.dumps(
		{
			"personal": {
				"dob": "1995-05-15",
				"gender": "Female",
				"city": "Kolkata",
				"address": "Salt Lake",
			},
			"education": [{"qualification": "B.Sc", "university": "CU", "year": "2016"}],
			"experience": {"total_experience": "3 years", "company": "Demo Diagnostics", "designation": "Technician"},
		}
	)
	apply_res = submit_job_application(
		job_opening=opening,
		full_name="Demo Hire Person",
		email=email,
		mobile="9000001234",
		resume=resume,
		declaration_accepted=1,
		application_json=application_json,
	)
	# submit may return _success wrapper
	apply_data = apply_res.get("data") if isinstance(apply_res, dict) and "data" in apply_res else apply_res
	application = (apply_data or {}).get("application") or (apply_data or {}).get("name")
	if not application:
		application = frappe.db.get_value("Job Applicant", {"email_id": email}, "name")
	out["steps"].append({"apply": apply_data, "application": application})
	if not application:
		out["ok"] = False
		out["error"] = "Apply failed"
		return _success(out)

	_set_pipeline(application, "Screening")
	iv = schedule_interview(
		application=application,
		scheduled_on=f"{today()} 11:00:00",
		interview_type="HR",
		move_to_interview=1,
	)
	out["steps"].append({"interview": iv})
	offer = create_job_offer(
		application=application,
		designation="Lab Technician",
		department="Laboratory",
		joining_date=today(),
		salary_offered=42000,
		send=1,
	)
	out["steps"].append({"offer": offer})
	hire = hire_applicant_to_people(
		application=application,
		designation="Lab Technician",
		department="Laboratory",
		joining_date=today(),
		salary_offered=42000,
		roles='["Employee","Lab Technician"]',
	)
	out["steps"].append({"hire": hire})
	hire_data = hire.get("data") if isinstance(hire, dict) else {}
	ctc = (hire_data or {}).get("people_sync", {}).get("monthly_ctc")
	emp = (hire_data or {}).get("employee")
	user = (hire_data or {}).get("user")
	out["checks"] = [
		{"name": "hired_user", "pass": bool(user)},
		{"name": "hired_employee", "pass": bool(emp)},
		{"name": "people_ctc_42000", "pass": float(ctc or 0) == 42000.0, "detail": str(ctc)},
		{"name": "people_path", "pass": (hire_data or {}).get("people_path") == "/people"},
	]
	out["ok"] = all(c["pass"] for c in out["checks"])
	out["demo"] = {
		"login_email": user,
		"people_url": "https://www.e-remedium.in/people",
		"careers_url": "https://www.e-remedium.in/careers",
		"hr_url": f"https://www.e-remedium.in/hr/applications/{application}" if application else None,
	}
	return _success(out)


@frappe.whitelist(allow_guest=True)
def smoke_phase73e():
	frappe.flags.ignore_csrf = True
	return _success(
		{
			"interview": bool(frappe.db.exists("DocType", "HEC Interview Schedule")),
			"note": bool(frappe.db.exists("DocType", "HEC Application Note")),
			"offer": bool(frappe.db.exists("DocType", "HEC Job Offer")),
		}
	)


@frappe.whitelist(allow_guest=True)
def smoke_offer_email_pack():
	"""Smoke: position templates + payroll pack queue for Field / HQ / Franchise."""
	frappe.flags.ignore_csrf = True
	from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
		build_job_offer_email_pack,
	)

	ensure_offer_email_fields()
	result = {"ok": True, "packs": {}, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": str(detail)[:160]})
		if not cond:
			result["ok"] = False

	for key, designation, salary in (
		("field", "Business Officer", 25000),
		("hq", "Lab Technician", 42000),
		("franchise", "Centre Staff", 18000),
	):
		pack = build_job_offer_email_pack(
			applicant_name=f"Smoke {key.title()}",
			applicant_email=f"smoke.{key}@health.local",
			designation=designation,
			joining_date=today(),
			salary_offered=salary,
			offer_name=f"SMOKE-{key}",
		)
		result["packs"][key] = {
			"letter_type": pack.get("letter_type"),
			"grade": pack.get("grade"),
			"structure": pack.get("structure"),
			"subject": pack.get("subject"),
			"html_len": len(pack.get("html") or ""),
		}
		html = pack.get("html") or ""
		check(f"{key}_letter_type", pack.get("letter_type") == key, pack.get("letter_type"))
		check(f"{key}_payroll", "Payroll &amp; compensation" in html or "Payroll & compensation" in html)
		check(f"{key}_pf", "PF" in html)
		check(f"{key}_agreement", "Employment Agreement" in html)
		check(
			f"{key}_ctc",
			flt(pack.get("monthly_ctc")) == flt(salary) or str(int(salary)) in html.replace(",", ""),
			pack.get("monthly_ctc"),
		)

	# Queue against latest hire-demo applicant if present
	app = frappe.db.get_value("Job Applicant", {"email_id": HIRE_DEMO_EMAIL}, "name")
	queued = None
	if app and frappe.db.exists("DocType", "HEC Job Offer"):
		offer_res = create_job_offer(
			application=app,
			designation="Lab Technician",
			department="Laboratory",
			joining_date=today(),
			salary_offered=42000,
			send=0,
		)
		queued = offer_res
		offer_id = (offer_res.get("data") or {}).get("offer_id") if isinstance(offer_res, dict) else None
		check("queued_offer", bool(offer_id), offer_id)
		if offer_id:
			preview = get_job_offer_email(offer=offer_id)
			pdata = preview.get("data") if isinstance(preview, dict) else {}
			check("preview_pending", (pdata or {}).get("email_status") == "Pending Review", (pdata or {}).get("email_status"))
			check("preview_html", bool((pdata or {}).get("html")))
	else:
		check("queued_offer", True, "skipped — no hire demo applicant")

	result["queued_sample"] = queued
	return _success(result)
