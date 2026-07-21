"""
Phase 73 — Talent lifecycle: recruitment + onboarding/offboarding checklists.

Uses HRMS Job Opening / Job Applicant when available, plus HEC ToDo checklists
(reuse ops patterns) for onboarding and offboarding.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, getdate, today

ONBOARDING_TASKS = (
	"Collect ID proof and address proof",
	"Create ERPNext User + assign roles",
	"Link Employee to User",
	"Assign leave policy / allocation",
	"Assign salary structure (if applicable)",
	"Issue laptop / kit / ID badge",
	"Schedule orientation with reporting manager",
)

OFFBOARDING_TASKS = (
	"Revoke system access / disable User",
	"Collect assets (laptop, badge, SIM)",
	"Final attendance / leave settlement",
	"Exit interview notes",
	"Process final settlement / F&F",
)


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def ensure_sample_job_opening():
	if not frappe.db.exists("DocType", "Job Opening"):
		return None
	title = "Lab Technician — RemeLab"
	existing = frappe.db.exists("Job Opening", {"job_title": title}) if frappe.get_meta("Job Opening").has_field("job_title") else None
	if existing:
		return existing
	# Some versions use naming by job_title field as name
	if frappe.db.exists("Job Opening", title):
		return title

	company = _default_company()
	doc = frappe.new_doc("Job Opening")
	meta = frappe.get_meta("Job Opening")
	if meta.has_field("job_title"):
		doc.job_title = title
	if meta.has_field("company"):
		doc.company = company
	if meta.has_field("status"):
		doc.status = "Open"
	if meta.has_field("description"):
		doc.description = "Sample opening seeded by Phase 73. Edit or close in Desk."
	if meta.has_field("publish"):
		doc.publish = 0
	try:
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase73_job_opening", message=frappe.get_traceback())
		return None


def _todo_exists(description, reference_name=None):
	filters = {"description": description, "status": ["!=", "Cancelled"]}
	if reference_name:
		filters["reference_name"] = reference_name
	return bool(frappe.db.exists("ToDo", filters))


def ensure_checklist_todos(employee, kind="onboarding"):
	"""Create ToDo checklist items for an employee (onboarding or offboarding)."""
	if not employee or not frappe.db.exists("Employee", employee):
		return []
	if not frappe.db.exists("DocType", "ToDo"):
		return []

	tasks = ONBOARDING_TASKS if kind == "onboarding" else OFFBOARDING_TASKS
	user = frappe.db.get_value("Employee", employee, "user_id") or frappe.session.user
	created = []
	due = add_days(getdate(today()), 7 if kind == "onboarding" else 3)
	for task in tasks:
		desc = f"[HEC {kind.title()}] {task} — {employee}"
		if _todo_exists(desc, employee):
			continue
		doc = frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": desc,
				"allocated_to": user if frappe.db.exists("User", user) else frappe.session.user,
				"reference_type": "Employee",
				"reference_name": employee,
				"priority": "Medium",
				"status": "Open",
				"date": due,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	return created


def ensure_hr_workspace_shortcuts():
	"""Add HR talent shortcuts to Company Ops workspace when present."""
	ws_name = "Company Ops KPIs"
	if not frappe.db.exists("Workspace", ws_name):
		return False
	try:
		ws = frappe.get_doc("Workspace", ws_name)
		existing = {(l.get("link_type"), l.get("link_to") or l.get("label")) for l in (ws.links or [])}
		added = False
		for doctype, label in (
			("Job Opening", "Job Openings"),
			("Job Applicant", "Job Applicants"),
			("Employee Onboarding", "Employee Onboarding"),
			("Employee Separation", "Employee Separation"),
			("Appraisal", "Appraisals"),
		):
			if not frappe.db.exists("DocType", doctype):
				continue
			key = ("DocType", doctype)
			if key in existing or ("DocType", label) in existing:
				continue
			ws.append(
				"links",
				{
					"label": label,
					"link_type": "DocType",
					"link_to": doctype,
					"type": "Link",
				},
			)
			added = True
		if added:
			ws.save(ignore_permissions=True)
		return True
	except Exception:
		frappe.log_error(title="phase73_workspace", message=frappe.get_traceback())
		return False


@frappe.whitelist()
def api_start_employee_checklist(employee=None, kind="onboarding"):
	"""Create onboarding/offboarding ToDos for an employee."""
	frappe.only_for(("System Manager", "HR Manager", "HR User", "Health System Admin"))
	kind = (kind or "onboarding").strip().lower()
	if kind not in ("onboarding", "offboarding"):
		frappe.throw(_("kind must be onboarding or offboarding"))
	if not employee:
		frappe.throw(_("employee is required"))
	created = ensure_checklist_todos(employee, kind)
	frappe.db.commit()
	return {"ok": True, "employee": employee, "kind": kind, "todos": created}


def setup_phase73():
	job = ensure_sample_job_opening()
	ensure_hr_workspace_shortcuts()

	# Seed onboarding checklist for demo phlebotomist if employee exists
	emp = frappe.db.get_value("Employee", {"user_id": "phlebotomist@health.local"}, "name")
	todos = []
	if emp:
		try:
			todos = ensure_checklist_todos(emp, "onboarding")
		except Exception:
			frappe.log_error(title="phase73_checklist", message=frappe.get_traceback())

	frappe.db.commit()
	return {
		"ok": True,
		"phase": 73,
		"job_opening": job,
		"sample_onboarding_todos": todos,
		"doctypes": {
			"Job Opening": bool(frappe.db.exists("DocType", "Job Opening")),
			"Job Applicant": bool(frappe.db.exists("DocType", "Job Applicant")),
			"Employee Onboarding": bool(frappe.db.exists("DocType", "Employee Onboarding")),
			"Appraisal": bool(frappe.db.exists("DocType", "Appraisal")),
		},
		"notes": [
			"Recruitment: use Desk Job Opening / Job Applicant / Interview.",
			"Onboarding/Offboarding: ToDo checklists via api_start_employee_checklist.",
			"Performance: HRMS Appraisal cycles (light touch). Succession deferred.",
		],
	}


def smoke_phase73():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	check("todo_doctype", bool(frappe.db.exists("DocType", "ToDo")))
	# Job Opening is preferred but not hard-required if HRMS recruitment not synced
	has_job = bool(frappe.db.exists("DocType", "Job Opening"))
	result["checks"].append({"name": "job_opening_doctype", "pass": has_job, "detail": "optional if HRMS partial"})
	return result
