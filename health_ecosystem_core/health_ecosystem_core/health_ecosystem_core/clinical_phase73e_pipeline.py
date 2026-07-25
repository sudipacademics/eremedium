"""
Phase 73e — Deeper recruitment pipeline: interviews, notes, offers, onboarding.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, now_datetime, today

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
		offers = frappe.get_all(
			"HEC Job Offer",
			filters={"job_applicant": application},
			fields=[
				"name",
				"designation",
				"department",
				"offer_date",
				"joining_date",
				"status",
				"salary_offered",
				"notes",
			],
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

	application = _parse_request_value("application", application)
	if not application or not frappe.db.exists("Job Applicant", application):
		return _error(_("Application not found"), 404)

	applicant = frappe.get_doc("Job Applicant", application)
	opening_title = getattr(applicant, "job_title", None)
	designation = (_parse_request_value("designation", designation) or "").strip()
	if not designation and opening_title and frappe.db.exists("Job Opening", opening_title):
		designation = frappe.db.get_value("Job Opening", opening_title, "job_title") or opening_title

	send_flag = cint(_parse_request_value("send", send) or 0)
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
			"status": "Sent" if send_flag else "Draft",
		}
	)
	doc.insert(ignore_permissions=True)
	_set_pipeline(application, "Offer")
	_add_note(
		application,
		f"Offer {doc.name} created ({doc.status})" + (f" — {designation}" if designation else ""),
		"Activity",
	)
	frappe.db.commit()
	return _success({"offer_id": doc.name, "status": doc.status, "pipeline_stage": "Offer"})


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
