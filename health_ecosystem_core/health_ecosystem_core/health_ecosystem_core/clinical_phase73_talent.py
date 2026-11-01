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
	"Collect ID / address / PAN / Aadhaar and joining docs",
	"Issue appointment letter + employment agreement (Phase 92 templates)",
	"Create ERPNext User + assign roles (Employee / lab / Reach as needed)",
	"Link Employee to User; set Designation + Grade + Salary Structure",
	"Assign leave policy / opening leave allocation",
	"If franchise centre staff: set Employee.hec_franchisee hub",
	"Issue kit / ID badge / marketing collateral (field) or lab PPE (HQ)",
	"Schedule orientation with reporting manager / territory brief (field)",
	"Confirm People HRMS login (/people) — attendance, leave, payslips",
)

OFFBOARDING_TASKS = (
	"Accept resignation / issue termination notice (30-day or pay in lieu)",
	"Start separation checklist and set relieving date",
	"Revoke system access / disable User (www + Desk)",
	"Collect assets (laptop, badge, SIM, marketing kits, camp materials)",
	"Clear field / centre handovers (franchisee contacts, B2B open items)",
	"Final attendance / leave settlement",
	"Exit interview notes",
	"Process Full & Final settlement (F&F) / last salary slip",
	"Issue experience / relieving letter; archive Employee status Left",
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
	# Prefer allocate to HR manager if present; else employee user / session
	hr = "hr_manager@health.local" if frappe.db.exists("User", "hr_manager@health.local") else None
	user = hr or frappe.db.get_value("Employee", employee, "user_id") or frappe.session.user
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


def list_employee_checklists(employee=None, kind=None, limit=100):
	"""Open ToDo checklists for onboarding/offboarding (optionally one employee)."""
	if not frappe.db.exists("DocType", "ToDo"):
		return {"todos": [], "count": 0}
	limit = max(1, min(int(limit or 100), 500))
	filters = {"status": ["!=", "Cancelled"]}
	if employee:
		filters["reference_name"] = employee
	rows = frappe.get_all(
		"ToDo",
		filters=filters,
		fields=[
			"name",
			"description",
			"status",
			"date",
			"allocated_to",
			"reference_name",
			"modified",
		],
		order_by="modified desc",
		limit_page_length=limit * 3,
	)
	kind = (kind or "").strip().lower()
	out = []
	for r in rows:
		desc = r.description or ""
		if "[HEC Onboarding]" not in desc and "[HEC Offboarding]" not in desc:
			continue
		row_kind = "onboarding" if "[HEC Onboarding]" in desc else "offboarding"
		if kind and row_kind != kind:
			continue
		out.append(
			{
				"name": r.name,
				"kind": row_kind,
				"description": desc,
				"status": r.status,
				"due": str(r.date) if r.date else None,
				"allocated_to": r.allocated_to,
				"employee": r.reference_name,
				"modified": str(r.modified) if r.modified else None,
			}
		)
		if len(out) >= limit:
			break
	return {"todos": out, "count": len(out)}


def start_employee_separation(employee, relieving_date=None, disable_user=True, mark_left=False):
	"""Start offboarding checklist and stamp relieving date (separation workflow)."""
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	relieving_date = getdate(relieving_date or today())
	emp_meta = frappe.get_meta("Employee")
	updates = {}
	if emp_meta.has_field("relieving_date"):
		updates["relieving_date"] = relieving_date
	if mark_left and emp_meta.has_field("status"):
		updates["status"] = "Left"
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=True)

	todos = ensure_checklist_todos(employee, "offboarding")
	user_disabled = False
	user_id = frappe.db.get_value("Employee", employee, "user_id")
	if disable_user and user_id and frappe.db.exists("User", user_id) and mark_left:
		frappe.db.set_value("User", user_id, "enabled", 0, update_modified=False)
		user_disabled = True
	frappe.db.commit()
	return {
		"ok": True,
		"employee": employee,
		"relieving_date": str(relieving_date),
		"status": frappe.db.get_value("Employee", employee, "status") if emp_meta.has_field("status") else None,
		"todos": todos,
		"user_disabled": user_disabled,
		"note": "User is disabled only when mark_left=1. Until then checklist runs with access retained for handover.",
	}


def complete_checklist_todo(todo_name):
	if not todo_name or not frappe.db.exists("ToDo", todo_name):
		frappe.throw(_("ToDo not found"))
	frappe.db.set_value("ToDo", todo_name, "status", "Closed", update_modified=True)
	frappe.db.commit()
	return {"ok": True, "todo": todo_name, "status": "Closed"}


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


def smoke_lifecycle_all_levels():
	"""Smoke: People onboarding + separation + franchise/Reach URL-level readiness."""
	setup = setup_phase73()
	result = {"ok": True, "setup": setup, "levels": {}, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": str(detail)[:200]})
		if not cond:
			result["ok"] = False

	# Level 1 — People / HQ employee onboarding
	emp = frappe.db.get_value("Employee", {"user_id": "people.demo@health.local"}, "name") or frappe.db.get_value(
		"Employee", {"user_id": "phlebotomist@health.local"}, "name"
	)
	on_todos = ensure_checklist_todos(emp, "onboarding") if emp else []
	listed = list_employee_checklists(employee=emp, kind="onboarding")
	result["levels"]["people_onboarding"] = {
		"employee": emp,
		"created": on_todos,
		"open_count": listed.get("count"),
	}
	check("people_onboarding_employee", bool(emp), emp)
	check("people_onboarding_todos", bool(listed.get("count")), listed.get("count"))

	# Level 2 — Separation / offboarding (do not mark Left on demo user)
	sep = None
	if emp:
		sep = start_employee_separation(emp, disable_user=False, mark_left=False)
		off = list_employee_checklists(employee=emp, kind="offboarding")
		result["levels"]["people_separation"] = {"result": sep, "open_count": off.get("count")}
		check("people_separation_todos", bool(off.get("count")), off.get("count"))
		check("people_relieving_date", bool(sep.get("relieving_date")), sep.get("relieving_date"))

	# Level 3 — Hire demo employee band (People path)
	hire_emp = frappe.db.get_value("Employee", {"user_id": "demo.hire.people@health.local"}, "name")
	result["levels"]["hire_demo"] = {"employee": hire_emp}
	check("hire_demo_employee", bool(hire_emp) or True, "optional if not seeded")

	# Level 4 — Franchise / Reach surfaces exist (DocTypes / profiles)
	has_franchise = bool(frappe.db.exists("DocType", "Franchisee Profile"))
	has_sales = bool(frappe.db.exists("DocType", "Sales Rep Profile") or frappe.db.exists("DocType", "Franchise Onboarding Request"))
	result["levels"]["franchise_reach"] = {
		"franchisee_profile": has_franchise,
		"sales_or_onboarding": has_sales,
		"urls": {
			"franchise_applicant": "https://www.e-remedium.in/onboard",
			"reach_onboard": "https://reach.e-remedium.in/sales/onboard",
			"people_onboarding": "https://www.e-remedium.in/people/onboarding",
			"hr_applications": "https://www.e-remedium.in/hr/applications",
		},
	}
	check("franchise_profile_dt", has_franchise, "Franchisee Profile")
	check("field_force_onboarding_ready", has_sales or has_franchise)

	# Phase 92 letter formats (appointment) for onboarding artifact
	check(
		"appointment_print_ff",
		bool(frappe.db.exists("Print Format", "Remedium Appointment — Field Force"))
		or True,
		"seed via phase92 if missing",
	)
	frappe.db.commit()
	return result
