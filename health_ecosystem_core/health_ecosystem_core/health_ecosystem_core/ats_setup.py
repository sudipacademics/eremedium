"""
ATS module setup — Job Requisition + Job Applicant custom fields + Web Form.

Relationship
------------
- **Job Requisition** (this app): internal headcount / ATS requisition.
- **Job Opening** (HRMS): public Careers portal openings (Phase 73b).
- **Job Applicant** (HRMS): extended with ATS fields; Hired → draft Employee.

Run::
    bench --site <site> migrate
    bench --site <site> execute health_ecosystem_core.health_ecosystem_core.ats_setup.setup_ats
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint


ATS_APPLICANT_STATUSES = (
	"New",
	"Screening",
	"Interview 1",
	"Interview 2",
	"Offer Extended",
	"Hired",
	"Rejected",
)

WEB_FORM_NAME = "job-application"
WEB_FORM_ROUTE = "job-application"


def setup_ats():
	"""Idempotent: custom fields, web form, sample open requisition."""
	# Careers pipeline fields (hec_employee, hec_mobile, …) used by Hired → Employee link
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
			_ensure_custom_fields as ensure_careers_fields,
		)

		ensure_careers_fields()
	except Exception:
		frappe.log_error(title="ats_setup_careers_fields", message=frappe.get_traceback())

	ensure_ats_custom_fields()
	ensure_job_application_web_form()
	seeded = ensure_sample_requisition()
	frappe.clear_cache()
	return {
		"ok": True,
		"module": "ATS",
		"web_form_route": f"/{WEB_FORM_ROUTE}",
		"sample_requisition": seeded,
	}


def ensure_ats_custom_fields():
	"""Extend HRMS Job Applicant (and Job Opening headcount) for ATS."""
	specs = {
		"Job Applicant": [
			{
				"fieldname": "hec_ats_section",
				"label": "ATS",
				"fieldtype": "Section Break",
				"insert_after": "status",
			},
			{
				"fieldname": "hec_first_name",
				"label": "First Name",
				"fieldtype": "Data",
				"insert_after": "hec_ats_section",
			},
			{
				"fieldname": "hec_last_name",
				"label": "Last Name",
				"fieldtype": "Data",
				"insert_after": "hec_first_name",
			},
			{
				"fieldname": "hec_applicant_status",
				"label": "Applicant Status",
				"fieldtype": "Select",
				"options": "\n".join(ATS_APPLICANT_STATUSES),
				"default": "New",
				"in_list_view": 1,
				"in_standard_filter": 1,
				"insert_after": "hec_last_name",
			},
			{
				"fieldname": "hec_applied_for",
				"label": "Applied For",
				"fieldtype": "Link",
				"options": "Job Requisition",
				"insert_after": "hec_applicant_status",
			},
			{
				"fieldname": "custom_assessment_score",
				"label": "Custom Assessment Score",
				"fieldtype": "Int",
				"insert_after": "hec_applied_for",
			},
			{
				"fieldname": "operational_route_experience",
				"label": "Operational Route Experience",
				"fieldtype": "Text",
				"description": "For roles such as B2B Logistics Managers.",
				"insert_after": "custom_assessment_score",
			},
			{
				"fieldname": "hec_employee",
				"label": "Hired Employee",
				"fieldtype": "Link",
				"options": "Employee",
				"read_only": 1,
				"insert_after": "operational_route_experience",
				"description": "Set automatically when Applicant Status becomes Hired (draft Employee).",
			},
		],
		"Job Opening": [
			{
				"fieldname": "hec_target_headcount",
				"label": "Target Headcount",
				"fieldtype": "Int",
				"default": "1",
				"insert_after": "status",
				"description": "Mirrors Job Requisition headcount when an opening is published from ATS.",
			},
		],
	}

	module = _module_name()
	for dt, fields in specs.items():
		if not frappe.db.exists("DocType", dt):
			continue
		for field in fields:
			_ensure_custom_field(dt, field, module)


def _ensure_custom_field(dt: str, field: dict, module: str | None):
	exists = frappe.db.exists("Custom Field", {"dt": dt, "fieldname": field["fieldname"]})
	if exists:
		# Keep Select options / labels up to date for ATS status
		if field["fieldname"] == "hec_applicant_status" and field.get("options"):
			cf = frappe.get_doc("Custom Field", exists)
			if cf.options != field["options"]:
				cf.options = field["options"]
				cf.save(ignore_permissions=True)
		return

	payload = {"doctype": "Custom Field", "dt": dt, **field}
	if module:
		payload["module"] = module
	doc = frappe.get_doc(payload)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)


def _module_name():
	for candidate in ("Health Ecosystem Core", "Health Ecosystem", "HRMS", "HR"):
		if frappe.db.exists("Module Def", candidate):
			return candidate
	return None


def ensure_job_application_web_form():
	"""Public web form → Job Applicant with Applicant Status = New."""
	if not frappe.db.exists("DocType", "Job Applicant"):
		return None
	if not frappe.db.exists("DocType", "Web Form"):
		return None

	# Ensure custom fields exist so web form fieldnames resolve
	ensure_ats_custom_fields()

	fields = [
		_wf("hec_first_name", "Data", "First Name", reqd=1),
		_wf("hec_last_name", "Data", "Last Name", reqd=1),
		_wf("email_id", "Data", "Email", reqd=1, options="Email"),
		_wf("phone_number", "Data", "Phone"),
		_wf("hec_applied_for", "Link", "Applied For", options="Job Requisition", reqd=1),
		_wf("resume_attachment", "Attach", "Resume"),
		_wf(
			"operational_route_experience",
			"Text",
			"Operational Route Experience",
		),
		_wf(
			"hec_applicant_status",
			"Select",
			"Applicant Status",
			options="\n".join(ATS_APPLICANT_STATUSES),
			default="New",
			hidden=1,
			read_only=1,
		),
	]

	if frappe.db.exists("Web Form", WEB_FORM_NAME):
		doc = frappe.get_doc("Web Form", WEB_FORM_NAME)
		doc.web_form_fields = []
		for f in fields:
			doc.append("web_form_fields", f)
		doc.published = 1
		doc.login_required = 0
		doc.allow_comments = 0
		doc.allow_edit = 0
		doc.allow_delete = 0
		doc.allow_multiple = 1
		doc.anonymous = 1
		doc.route = WEB_FORM_ROUTE
		doc.title = "Job Application"
		doc.success_message = "Thank you. Your application has been received."
		doc.success_url = ""
		doc.doc_type = "Job Applicant"
		doc.save(ignore_permissions=True)
		return doc.name

	doc = frappe.get_doc(
		{
			"doctype": "Web Form",
			"name": WEB_FORM_NAME,
			"title": "Job Application",
			"route": WEB_FORM_ROUTE,
			"doc_type": "Job Applicant",
			"module": _module_name() or "Health Ecosystem Core",
			"is_standard": 0,
			"published": 1,
			"login_required": 0,
			"allow_comments": 0,
			"allow_edit": 0,
			"allow_delete": 0,
			"allow_multiple": 1,
			"anonymous": 1,
			"success_message": "Thank you. Your application has been received.",
			"web_form_fields": fields,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _wf(
	fieldname,
	fieldtype,
	label,
	reqd=0,
	options=None,
	default=None,
	hidden=0,
	read_only=0,
):
	row = {
		"fieldname": fieldname,
		"fieldtype": fieldtype,
		"label": label,
		"reqd": cint_safe(reqd),
		"hidden": cint_safe(hidden),
		"read_only": cint_safe(read_only),
	}
	if options is not None:
		row["options"] = options
	if default is not None:
		row["default"] = default
	return row


def cint_safe(v):
	return 1 if cint(v) else 0


def ensure_sample_requisition():
	if not frappe.db.exists("DocType", "Job Requisition"):
		return None
	title = "B2B Logistics Manager"
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring import (
			_jr_build_seed_doc,
			_jr_find_open_by_title,
		)

		existing = _jr_find_open_by_title(title)
		if existing:
			return existing
		doc = _jr_build_seed_doc(
			{
				"job_title": title,
				"department": "Logistics",
				"location": "Astra Tower",
				"target_headcount": 2,
				"description": "<p>Sample ATS requisition for operational route roles.</p>",
				"volume_role": 0,
			}
		)
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="ats_sample_requisition", message=frappe.get_traceback())
		return None


@frappe.whitelist()
def schedule_interview_note(applicant: str, scheduled_on: str, notes: str | None = None):
	"""Desk helper: add timeline comment for scheduled interview."""
	if not applicant or not frappe.db.exists("Job Applicant", applicant):
		frappe.throw(_("Job Applicant not found"), frappe.DoesNotExistError)
	if not scheduled_on:
		frappe.throw(_("Interview date/time is required"), frappe.ValidationError)

	frappe.has_permission("Job Applicant", "write", doc=applicant, throw=True)

	msg = _("Interview scheduled for {0}").format(scheduled_on)
	if notes:
		msg = f"{msg}<br>{frappe.utils.cstr(notes)}"

	doc = frappe.get_doc("Job Applicant", applicant)
	doc.add_comment("Comment", msg)

	# Optional: mirror into HEC Interview Schedule when available
	interview_name = None
	if frappe.db.exists("DocType", "HEC Interview Schedule"):
		iv = frappe.get_doc(
			{
				"doctype": "HEC Interview Schedule",
				"job_applicant": applicant,
				"interview_type": "HR",
				"scheduled_on": scheduled_on,
				"status": "Scheduled",
				"notes": notes or "",
				"interviewer": frappe.session.user,
			}
		)
		iv.insert(ignore_permissions=True)
		interview_name = iv.name

	return {"ok": True, "comment": msg, "interview": interview_name}
