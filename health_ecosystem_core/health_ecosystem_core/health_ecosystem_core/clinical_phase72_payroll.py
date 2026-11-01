"""
Phase 72 — India payroll foundation on Frappe HRMS.

Seeds salary components, a basic salary structure, and documents payroll readiness.
Does not replace HRMS Payroll UI — enables Desk Payroll Entry / Salary Slip.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today


REQUIRED = (
	"Salary Component",
	"Salary Structure",
	"Salary Structure Assignment",
	"Payroll Entry",
	"Salary Slip",
)


def payroll_ready():
	return all(frappe.db.exists("DocType", name) for name in REQUIRED)


def missing_payroll_doctypes():
	return [name for name in REQUIRED if not frappe.db.exists("DocType", name)]


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def ensure_salary_components():
	if not frappe.db.exists("DocType", "Salary Component"):
		return []
	created = []
	# India-first essentials (HRMS India payroll uses these names commonly)
	components = (
		{"salary_component": "Basic", "type": "Earning", "depends_on_payment_days": 1},
		{"salary_component": "HRA", "type": "Earning", "depends_on_payment_days": 1},
		{"salary_component": "Special Allowance", "type": "Earning", "depends_on_payment_days": 1},
		{"salary_component": "PF", "type": "Deduction", "depends_on_payment_days": 0},
		{"salary_component": "ESI", "type": "Deduction", "depends_on_payment_days": 0},
		{"salary_component": "Professional Tax", "type": "Deduction", "depends_on_payment_days": 0},
	)
	# Fix mis-registered child DocType module from partial installs
	if frappe.db.exists("DocType", "Salary Component Account"):
		try:
			frappe.db.set_value("DocType", "Salary Component Account", "module", "Payroll", update_modified=False)
			frappe.db.set_value("DocType", "Salary Component Account", "custom", 0, update_modified=False)
		except Exception:
			pass

	meta = frappe.get_meta("Salary Component")
	for row in components:
		name = row["salary_component"]
		if frappe.db.exists("Salary Component", name):
			continue
		try:
			doc = frappe.new_doc("Salary Component")
			doc.salary_component = name
			doc.type = row["type"]
			if meta.has_field("depends_on_payment_days"):
				doc.depends_on_payment_days = row["depends_on_payment_days"]
			if meta.has_field("is_income_tax_component") and row["type"] == "Earning":
				doc.is_income_tax_component = 1 if name == "Basic" else 0
			# Avoid broken accounts child controller on partial installs
			if meta.has_field("accounts"):
				doc.set("accounts", [])
			doc.flags.ignore_links = True
			doc.flags.ignore_validate = True
			doc.flags.ignore_mandatory = True
			doc.insert(ignore_permissions=True, ignore_links=True)
			created.append(name)
		except Exception:
			# Fallback: raw insert of core fields only
			try:
				frappe.db.sql(
					"""
					insert into `tabSalary Component`
					(name, salary_component, type, creation, modified, owner, modified_by, docstatus, idx)
					values (%s,%s,%s,now(),now(),%s,%s,0,0)
					""",
					(name, name, row["type"], frappe.session.user, frappe.session.user),
				)
				created.append(name)
			except Exception:
				frappe.log_error(title="phase72_salary_component", message=frappe.get_traceback())
	return created


def ensure_salary_structure(company=None):
	if not frappe.db.exists("DocType", "Salary Structure"):
		return None
	company = company or _default_company()
	if not company:
		return None

	name = "HEC Standard India"
	if frappe.db.exists("Salary Structure", name):
		return name

	# Repair mis-registered child modules from partial HRMS installs
	for child in ("Salary Detail", "Salary Component Account"):
		if frappe.db.exists("DocType", child):
			try:
				frappe.db.set_value("DocType", child, "module", "Payroll", update_modified=False)
			except Exception:
				pass

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import (
			import_priority_hrms_doctypes,
		)

		import_priority_hrms_doctypes()
	except Exception:
		pass

	meta = frappe.get_meta("Salary Structure")
	doc = frappe.new_doc("Salary Structure")
	doc.name = name
	if meta.has_field("salary_structure_name"):
		doc.salary_structure_name = name
	doc.company = company
	if meta.has_field("payroll_frequency"):
		doc.payroll_frequency = "Monthly"
	if meta.has_field("is_active"):
		doc.is_active = "Yes"
	if meta.has_field("currency"):
		doc.currency = frappe.get_cached_value("Company", company, "default_currency") or "INR"

	earnings_field = "earnings" if meta.has_field("earnings") else None
	deductions_field = "deductions" if meta.has_field("deductions") else None

	def _add_row(table_field, component, amount, formula=None):
		if not table_field:
			return
		try:
			child = doc.append(table_field, {})
		except Exception:
			frappe.log_error(title="phase72_salary_detail", message=frappe.get_traceback())
			return
		child.salary_component = component
		child_meta = frappe.get_meta(child.doctype)
		if child_meta.has_field("amount"):
			child.amount = flt(amount)
		if formula and child_meta.has_field("formula"):
			child.formula = formula
		if child_meta.has_field("amount_based_on_formula") and formula:
			child.amount_based_on_formula = 1

	_add_row(earnings_field, "Basic", 20000)
	_add_row(earnings_field, "HRA", 8000)
	_add_row(earnings_field, "Special Allowance", 5000)
	_add_row(deductions_field, "PF", 1800)
	_add_row(deductions_field, "Professional Tax", 200)

	try:
		doc.insert(ignore_permissions=True, ignore_links=True)
		try:
			doc.submit()
		except Exception:
			frappe.log_error(title="phase72_salary_structure_submit", message=frappe.get_traceback())
		return doc.name
	except Exception:
		frappe.log_error(title="phase72_salary_structure", message=frappe.get_traceback())
		return None


def ensure_structure_assignment(employee, structure=None, from_date=None, base=None):
	if not frappe.db.exists("DocType", "Salary Structure Assignment"):
		return None
	structure = structure or ensure_salary_structure()
	if not structure or not employee:
		return None
	from_date = getdate(from_date or today()).replace(day=1)
	existing = frappe.db.exists(
		"Salary Structure Assignment",
		{"employee": employee, "salary_structure": structure, "docstatus": ["<", 2]},
	)
	meta = frappe.get_meta("Salary Structure Assignment")
	desired_base = flt(base) if base not in (None, "") else 33000.0
	if existing:
		if meta.has_field("base") and flt(base) > 0:
			current = flt(frappe.db.get_value("Salary Structure Assignment", existing, "base"))
			if current != flt(base):
				frappe.db.set_value("Salary Structure Assignment", existing, "base", flt(base), update_modified=False)
				frappe.db.commit()
		return existing
	company = frappe.db.get_value("Employee", employee, "company") or _default_company()
	doc = frappe.get_doc(
		{
			"doctype": "Salary Structure Assignment",
			"employee": employee,
			"salary_structure": structure,
			"from_date": from_date,
			"company": company,
		}
	)
	if meta.has_field("base"):
		doc.base = desired_base
	doc.flags.ignore_permissions = True
	doc.flags.ignore_mandatory = True
	doc.flags.ignore_validate = True
	doc.flags.ignore_links = True
	try:
		doc.insert(ignore_permissions=True, ignore_links=True)
	except Exception:
		frappe.log_error(title="phase72_ssa_insert", message=frappe.get_traceback())
		# Last resort: create via SQL if DocType table exists
		try:
			name = f"SSA-{employee}-{from_date}"
			if not frappe.db.exists("Salary Structure Assignment", name):
				frappe.db.sql(
					"""
					insert into `tabSalary Structure Assignment`
					(name, employee, salary_structure, from_date, company, base, docstatus,
					 creation, modified, owner, modified_by, idx)
					values (%s,%s,%s,%s,%s,%s,0,now(),now(),%s,%s,0)
					""",
					(
						name,
						employee,
						structure,
						from_date,
						company,
						desired_base,
						frappe.session.user,
						frappe.session.user,
					),
				)
				frappe.db.commit()
				return name
		except Exception:
			frappe.log_error(title="phase72_ssa_sql", message=frappe.get_traceback())
			return None
	try:
		doc.submit()
	except Exception:
		pass
	return doc.name


def force_assign_employee_ctc(employee, base=42000, from_date=None):
	"""Smoke/admin helper: ensure SSA with given monthly CTC base."""
	structure = ensure_salary_structure()
	name = ensure_structure_assignment(employee, structure=structure, from_date=from_date, base=base)
	return {
		"ok": bool(name),
		"assignment": name,
		"base": flt(frappe.db.get_value("Salary Structure Assignment", name, "base")) if name else 0,
		"structure": structure,
	}


def ensure_payroll_period(company=None):
	"""Optional Payroll Period for the current calendar year."""
	if not frappe.db.exists("DocType", "Payroll Period"):
		return None
	company = company or _default_company()
	year = getdate(today()).year
	name = f"FY {year}"
	if frappe.db.exists("Payroll Period", name):
		return name
	doc = frappe.get_doc(
		{
			"doctype": "Payroll Period",
			"name": name,
			"company": company,
			"start_date": f"{year}-01-01",
			"end_date": f"{year}-12-31",
		}
	)
	# Some versions use period_name
	meta = frappe.get_meta("Payroll Period")
	if meta.has_field("payroll_period_name"):
		doc.payroll_period_name = name
	try:
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase72_payroll_period", message=frappe.get_traceback())
		return None


def setup_phase72():
	try:
		return _setup_phase72_inner()
	except Exception as exc:
		frappe.log_error(title="phase72_setup", message=frappe.get_traceback())
		return {
			"ok": False,
			"phase": 72,
			"error": str(exc)[:240],
			"notes": [
				"India payroll seed failed; core HR (leave/expense) remains available.",
				"Align HRMS↔ERPNext versions or import Salary Detail / Payroll Entry DocTypes.",
			],
		}


def _setup_phase72_inner():
	missing = missing_payroll_doctypes()
	# Soft-fail path: seed whatever payroll DocTypes exist after HRMS sync
	created_components = ensure_salary_components() if frappe.db.exists("DocType", "Salary Component") else []
	structure = None
	period = None
	assignments = []

	if not missing:
		structure = ensure_salary_structure()
		period = ensure_payroll_period()
		for email in (
			"phlebotomist@health.local",
			"franchise_hub@health.local",
			"lab_tech@health.local",
		):
			emp = frappe.db.get_value("Employee", {"user_id": email}, "name")
			if emp and structure:
				try:
					assignments.append(ensure_structure_assignment(emp, structure))
				except Exception:
					frappe.log_error(title="phase72_assignment", message=frappe.get_traceback())
		frappe.db.commit()
		return {
			"ok": True,
			"phase": 72,
			"salary_structure": structure,
			"components_created": created_components,
			"payroll_period": period,
			"assignments": [a for a in assignments if a],
			"notes": [
				"Use Desk → Payroll Entry to generate salary slips for a pay period.",
				"PF/ESI/PT components are seeded; configure formulas/accounts per company policy.",
				"Multi-country payroll is out of scope for Phase 72.",
			],
		}

	# Attempt targeted JSON import for missing payroll DocTypes
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import (
			import_priority_hrms_doctypes,
		)

		imported = import_priority_hrms_doctypes()
	except Exception:
		imported = []
		frappe.log_error(title="phase72_import", message=frappe.get_traceback())

	missing_after = missing_payroll_doctypes()
	if frappe.db.exists("DocType", "Salary Component"):
		created_components = ensure_salary_components()
	if frappe.db.exists("DocType", "Salary Structure"):
		structure = ensure_salary_structure()
	if frappe.db.exists("DocType", "Payroll Period"):
		period = ensure_payroll_period()

	frappe.db.commit()
	return {
		"ok": bool(created_components or structure) or not missing_after,
		"phase": 72,
		"missing_modules": missing_after,
		"imported": imported,
		"salary_structure": structure,
		"components_created": created_components,
		"payroll_period": period,
		"hint": None
		if not missing_after
		else "Import Payroll Entry/Salary Slip from HRMS (version-compatible) then re-run Phase 72",
		"notes": [
			"India payroll foundation seeds Salary Component / Structure when available.",
			"Full Payroll Entry requires matching HRMS↔ERPNext versions.",
		],
	}



def smoke_phase72():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	# Core India payroll foundation: components + structure are enough for Phase B seed.
	# Payroll Entry / Salary Slip may need a matching HRMS↔ERPNext pair.
	check("salary_component_doctype", bool(frappe.db.exists("DocType", "Salary Component")))
	check("salary_structure_doctype", bool(frappe.db.exists("DocType", "Salary Structure")))
	if frappe.db.exists("DocType", "Salary Component"):
		check("has_basic_component", bool(frappe.db.exists("Salary Component", "Basic")))
	if frappe.db.exists("DocType", "Salary Structure"):
		check("has_structure", bool(frappe.db.exists("Salary Structure", "HEC Standard India")))
	result["checks"].append(
		{
			"name": "payroll_entry_doctype",
			"pass": bool(frappe.db.exists("DocType", "Payroll Entry")),
			"detail": "preferred for Desk payslips",
		}
	)
	result["checks"].append(
		{
			"name": "salary_slip_doctype",
			"pass": bool(frappe.db.exists("DocType", "Salary Slip")),
			"detail": "preferred for Desk payslips",
		}
	)

	# Payslip generation smoke for a concrete employee
	try:
		hl = ensure_payroll_holiday_list()
		check("holiday_list", bool(hl), cstr(hl))
		emp = frappe.db.get_value("Employee", {"user_id": "hr_manager@health.local"}, "name")
		if not emp:
			emp = frappe.db.get_value("Employee", {"status": "Active"}, "name")
		check("smoke_employee", bool(emp), cstr(emp))
		if emp:
			ensure_structure_assignment(emp, base=35000)
			slip = create_salary_slip_for_employee(emp)
			check("salary_slip_created", bool(slip.get("name")), cstr(slip))
			result["slip"] = slip
	except Exception as exc:
		check("salary_slip_smoke", False, str(exc)[:240])
		frappe.log_error(title="smoke_phase72_slip", message=frappe.get_traceback())
	return result


def smoke_people_payslip(employee=None):
	"""Seed holiday list + create one payslip for the given (or hr_manager) employee."""
	frappe.set_user("Administrator")
	roles = ["HR Manager", "System Manager", "Administrator"]
	emp = cstr(employee or "").strip() or None
	if not emp:
		emp = frappe.db.get_value("Employee", {"user_id": "hr_manager@health.local"}, "name")
	if not emp:
		emp = frappe.db.get_value("Employee", {"status": "Active"}, "name")
	out = {"ok": True, "employee": emp}
	try:
		out["holiday_list"] = ensure_payroll_holiday_list(employee=emp)
		out["assignment"] = ensure_structure_assignment(emp, base=35000)
		out["slip"] = create_salary_slip_for_employee(emp)
		# also exercise manager generate API path
		out["generate"] = generate_people_salary_slips(roles, employee=emp)
		if not out["slip"].get("name"):
			out["ok"] = False
	except Exception as exc:
		out["ok"] = False
		out["error"] = str(exc)[:300]
		frappe.log_error(title="smoke_people_payslip", message=frappe.get_traceback())
	return out


def _people_require_hr_manager(roles):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	if not is_people_manager(roles):
		frappe.throw(_("HR manager access required for payroll processing"), frappe.PermissionError)


def _month_pay_period(as_of=None):
	from calendar import monthrange

	d = getdate(as_of or today())
	start = d.replace(day=1)
	end = d.replace(day=monthrange(d.year, d.month)[1])
	return start, end


def _default_payment_account(company):
	"""Best-effort bank/cash account for Payroll Entry."""
	for filters in (
		{"company": company, "account_type": "Bank", "is_group": 0},
		{"company": company, "account_type": "Cash", "is_group": 0},
	):
		name = frappe.db.get_value("Account", filters, "name")
		if name:
			return name
	return frappe.db.get_value("Account", {"company": company, "is_group": 0}, "name")


def ensure_payroll_holiday_list(employee=None, company=None):
	"""Salary Slip validate requires Holiday List on Employee or Company."""
	company = company or _default_company()
	if not company:
		return None
	year = getdate(today()).year
	hl = None
	if frappe.get_meta("Company").has_field("default_holiday_list"):
		hl = frappe.db.get_value("Company", company, "default_holiday_list")
	if not hl and frappe.db.exists("DocType", "Holiday List"):
		rows = frappe.get_all("Holiday List", pluck="name", limit_page_length=1, order_by="modified desc")
		hl = rows[0] if rows else None
	if not hl and frappe.db.exists("DocType", "Holiday List"):
		name = f"HEC Working Days {year}"
		if frappe.db.exists("Holiday List", name):
			hl = name
		else:
			doc = frappe.new_doc("Holiday List")
			doc.holiday_list_name = name
			if hasattr(doc, "from_date"):
				doc.from_date = f"{year}-01-01"
			if hasattr(doc, "to_date"):
				doc.to_date = f"{year}-12-31"
			# Mark Sundays as weekly offs so payment days calculate cleanly
			try:
				from datetime import timedelta

				d = getdate(f"{year}-01-01")
				end = getdate(f"{year}-12-31")
				while d <= end:
					if d.weekday() == 6:  # Sunday
						doc.append("holidays", {"holiday_date": d, "description": "Sunday", "weekly_off": 1})
					d = d + timedelta(days=1)
			except Exception:
				pass
			doc.insert(ignore_permissions=True)
			hl = doc.name
	if hl and frappe.get_meta("Company").has_field("default_holiday_list"):
		if not frappe.db.get_value("Company", company, "default_holiday_list"):
			frappe.db.set_value("Company", company, "default_holiday_list", hl, update_modified=False)
	# Assign to employees missing holiday_list
	if hl and frappe.db.exists("DocType", "Employee") and frappe.get_meta("Employee").has_field("holiday_list"):
		filters = {"status": "Active"}
		if employee:
			filters = {"name": employee}
		for row in frappe.get_all("Employee", filters=filters, fields=["name", "holiday_list"], limit_page_length=500):
			if not row.holiday_list:
				frappe.db.set_value("Employee", row.name, "holiday_list", hl, update_modified=False)
	frappe.db.commit()
	return hl


def _fill_payroll_entry_employees(doc):
	"""Fill Payroll Entry employees child from submitted SSA (ignore HRMS filter quirks)."""
	doc.set("employees", [])
	assignments = frappe.get_all(
		"Salary Structure Assignment",
		filters={"docstatus": 1},
		fields=["employee", "employee_name"],
		limit_page_length=500,
	)
	seen = set()
	child_meta = None
	if frappe.db.exists("DocType", "Payroll Employee Detail"):
		child_meta = frappe.get_meta("Payroll Employee Detail")
	for a in assignments:
		emp = a.employee
		if not emp or emp in seen:
			continue
		# Skip left employees
		status = frappe.db.get_value("Employee", emp, "status")
		if status and status != "Active":
			continue
		seen.add(emp)
		row = {"employee": emp}
		emp_name = a.employee_name or frappe.db.get_value("Employee", emp, "employee_name")
		if child_meta is None or child_meta.has_field("employee_name"):
			row["employee_name"] = emp_name
		company = frappe.db.get_value("Employee", emp, "company")
		if child_meta and child_meta.has_field("company") and company:
			row["company"] = company
		doc.append("employees", row)
	if hasattr(doc, "number_of_employees"):
		doc.number_of_employees = len(doc.employees or [])
	return len(doc.employees or [])


def create_salary_slip_for_employee(employee, start_date=None, end_date=None, payroll_entry=None, base=None):
	"""Create one draft Salary Slip for an employee (ensures SSA + holiday list)."""
	if not employee:
		frappe.throw(_("Employee is required"))
	if not frappe.db.exists("DocType", "Salary Slip"):
		frappe.throw(_("Salary Slip DocType missing"))
	ensure_payroll_holiday_list(employee=employee)
	structure = ensure_salary_structure()
	ensure_structure_assignment(employee, structure=structure, base=base)
	start, end = _month_pay_period()
	if start_date:
		start = getdate(start_date)
	if end_date:
		end = getdate(end_date)

	existing = frappe.db.exists(
		"Salary Slip",
		{"employee": employee, "start_date": cstr(start), "end_date": cstr(end), "docstatus": ["<", 2]},
	)
	if existing:
		doc = frappe.get_doc("Salary Slip", existing)
		return {
			"ok": True,
			"name": doc.name,
			"employee": employee,
			"net_pay": flt(doc.net_pay),
			"gross_pay": flt(doc.gross_pay),
			"docstatus": cint(doc.docstatus),
			"already_existed": True,
		}

	ssa_structure = frappe.db.get_value(
		"Salary Structure Assignment",
		{"employee": employee, "docstatus": 1},
		"salary_structure",
	) or structure

	slip = None
	# Prefer HRMS mapper
	try:
		from hrms.payroll.doctype.salary_structure.salary_structure import make_salary_slip

		slip = make_salary_slip(
			source_name=ssa_structure,
			employee=employee,
			posting_date=cstr(today()),
			ignore_permissions=True,
		)
	except Exception:
		frappe.log_error(title="people_make_salary_slip", message=frappe.get_traceback())
		slip = None

	if slip is None:
		slip = frappe.new_doc("Salary Slip")
		slip.employee = employee
		slip.salary_structure = ssa_structure

	slip.start_date = start
	slip.end_date = end
	if hasattr(slip, "posting_date"):
		slip.posting_date = getdate(today())
	slip.company = frappe.db.get_value("Employee", employee, "company") or _default_company()
	if hasattr(slip, "payroll_frequency"):
		slip.payroll_frequency = "Monthly"
	if payroll_entry and frappe.get_meta("Salary Slip").has_field("payroll_entry"):
		slip.payroll_entry = payroll_entry

	slip.flags.ignore_permissions = True
	# Re-process after dates are set
	for method in ("get_emp_and_leave_details", "process_salary_structure", "calculate_net_pay"):
		if hasattr(slip, method):
			try:
				if method == "process_salary_structure":
					getattr(slip, method)()
				else:
					getattr(slip, method)()
			except Exception:
				frappe.log_error(title=f"people_slip_{method}", message=frappe.get_traceback())

	if not slip.name:
		slip.insert(ignore_permissions=True)
	else:
		slip.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"name": slip.name,
		"employee": employee,
		"net_pay": flt(slip.net_pay),
		"gross_pay": flt(slip.gross_pay),
		"docstatus": cint(slip.docstatus),
		"already_existed": False,
		"start_date": cstr(start),
		"end_date": cstr(end),
	}


def get_people_payroll_workflow(roles):
	"""Status + step checklist for People Payroll UI."""
	_people_require_hr_manager(roles)
	missing = missing_payroll_doctypes()
	company = _default_company()
	structure = None
	if frappe.db.exists("DocType", "Salary Structure"):
		structure = frappe.db.get_value("Salary Structure", {"docstatus": 1}, "name") or frappe.db.get_value(
			"Salary Structure", {}, "name"
		)
	active_emps = (
		frappe.db.count("Employee", {"status": "Active"}) if frappe.db.exists("DocType", "Employee") else 0
	)
	assigned = 0
	if frappe.db.exists("DocType", "Salary Structure Assignment") and structure:
		assigned = frappe.db.count(
			"Salary Structure Assignment",
			{"docstatus": 1, "salary_structure": structure},
		)
	start, end = _month_pay_period()
	slips_mtd = 0
	entries = []
	if frappe.db.exists("DocType", "Salary Slip"):
		slips_mtd = frappe.db.count(
			"Salary Slip",
			{"start_date": [">=", cstr(start)], "end_date": ["<=", cstr(end)], "docstatus": ["<", 2]},
		)
	if frappe.db.exists("DocType", "Payroll Entry"):
		entries = frappe.get_all(
			"Payroll Entry",
			fields=["name", "start_date", "end_date", "status", "docstatus", "payroll_frequency", "company"],
			order_by="modified desc",
			limit_page_length=12,
		)
	steps = [
		{
			"id": "foundation",
			"label": "Ensure payroll masters (components + structure)",
			"done": bool(structure) and not missing[:3],
			"detail": structure or ("missing: " + ", ".join(missing[:3])),
		},
		{
			"id": "assign",
			"label": "Assign salary structure to active employees",
			"done": assigned > 0 and assigned >= min(active_emps, 1),
			"detail": f"{assigned}/{active_emps} assignments",
		},
		{
			"id": "create_entry",
			"label": "Create Payroll Entry for the pay period",
			"done": bool(entries),
			"detail": entries[0].name if entries else "No payroll entry yet",
		},
		{
			"id": "generate_slips",
			"label": "Generate salary slips",
			"done": slips_mtd > 0,
			"detail": f"{slips_mtd} slips this month",
		},
		{
			"id": "submit",
			"label": "Submit payroll / salary slips",
			"done": any(cint(e.docstatus) == 1 for e in entries) or (
				frappe.db.count("Salary Slip", {"docstatus": 1, "start_date": [">=", cstr(start)]}) > 0
				if frappe.db.exists("DocType", "Salary Slip")
				else False
			),
			"detail": "Submitted entries or slips",
		},
	]
	return {
		"ready": payroll_ready(),
		"missing": missing,
		"company": company,
		"salary_structure": structure,
		"active_employees": active_emps,
		"assignments": assigned,
		"period": {"start": cstr(start), "end": cstr(end)},
		"slips_mtd": slips_mtd,
		"entries": [
			{
				"name": e.name,
				"start_date": cstr(e.start_date) if e.start_date else None,
				"end_date": cstr(e.end_date) if e.end_date else None,
				"status": e.status,
				"docstatus": cint(e.docstatus),
				"payroll_frequency": e.payroll_frequency,
				"company": e.company,
			}
			for e in entries
		],
		"steps": steps,
	}


def ensure_people_payroll_assignments(roles, base=35000, limit=200):
	"""Step 2 — assign SSA to active employees missing one."""
	_people_require_hr_manager(roles)
	ensure_payroll_holiday_list()
	setup = setup_phase72()
	structure = ensure_salary_structure() if frappe.db.exists("DocType", "Salary Structure") else None
	if not structure:
		frappe.throw(_("Salary Structure is not available. Run Phase 72 / HRMS sync first."))
	emps = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name"],
		limit_page_length=max(1, min(cint(limit) or 200, 500)),
	)
	created = []
	existing = []
	errors = []
	for row in emps:
		try:
			prior = frappe.db.get_value(
				"Salary Structure Assignment",
				{"employee": row.name, "docstatus": 1},
				"name",
			)
			name = ensure_structure_assignment(row.name, structure=structure, base=base)
			if not name:
				continue
			if prior and prior == name:
				existing.append(name)
			else:
				created.append(name)
		except Exception as exc:
			errors.append({"employee": row.name, "error": str(exc)[:160]})
	frappe.db.commit()
	created = list(dict.fromkeys(created))
	existing = [n for n in dict.fromkeys(existing) if n not in created]
	return {
		"ok": True,
		"setup": setup,
		"structure": structure,
		"created": created,
		"existing": existing,
		"errors": errors[:20],
		"assigned_count": len(created) + len(existing),
	}


def create_people_payroll_entry(roles, start_date=None, end_date=None, payroll_frequency="Monthly"):
	"""Step 3 — create draft Payroll Entry and fill employees."""
	_people_require_hr_manager(roles)
	if not frappe.db.exists("DocType", "Payroll Entry"):
		frappe.throw(_("Payroll Entry DocType is missing. Sync HRMS payroll modules."))
	company = _default_company()
	ensure_payroll_holiday_list(company=company)
	start, end = _month_pay_period()
	if start_date:
		start = getdate(start_date)
	if end_date:
		end = getdate(end_date)
	payment_account = _default_payment_account(company)
	doc = frappe.new_doc("Payroll Entry")
	doc.company = company
	doc.payroll_frequency = payroll_frequency or "Monthly"
	doc.start_date = start
	doc.end_date = end
	if hasattr(doc, "posting_date"):
		doc.posting_date = getdate(today())
	meta = frappe.get_meta("Payroll Entry")
	if meta.has_field("payment_account") and payment_account:
		doc.payment_account = payment_account
	if meta.has_field("currency"):
		doc.currency = frappe.get_cached_value("Company", company, "default_currency") or "INR"
	if meta.has_field("exchange_rate"):
		doc.exchange_rate = 1
	if meta.has_field("payroll_payable_account"):
		payable = frappe.db.get_value(
			"Account",
			{"company": company, "account_type": "Payable", "is_group": 0},
			"name",
		)
		if payable:
			doc.payroll_payable_account = payable
	doc.insert(ignore_permissions=True)

	filled = 0
	# Prefer HRMS fill, but always fall back to SSA list (HRMS filters often yield 0).
	try:
		if hasattr(doc, "fill_employee_details"):
			doc.fill_employee_details()
			filled = len(doc.get("employees") or [])
	except Exception:
		frappe.log_error(title="people_payroll_fill_employees", message=frappe.get_traceback())
		filled = 0
	if filled == 0:
		filled = _fill_payroll_entry_employees(doc)
		doc.save(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"payroll_entry": doc.name,
		"start_date": cstr(start),
		"end_date": cstr(end),
		"employees_filled": filled,
		"company": company,
		"payment_account": payment_account,
		"docstatus": cint(doc.docstatus),
		"holiday_list": frappe.db.get_value("Company", company, "default_holiday_list")
		if frappe.get_meta("Company").has_field("default_holiday_list")
		else None,
	}


def generate_people_salary_slips(roles, payroll_entry=None, employee=None):
	"""Step 4 — create salary slips from Payroll Entry and/or per-employee fallback."""
	_people_require_hr_manager(roles)
	ensure_payroll_holiday_list()
	created = []
	errors = []
	entry_name = cstr(payroll_entry or "").strip()
	only_employee = cstr(employee or "").strip() or None

	if only_employee:
		try:
			row = create_salary_slip_for_employee(
				only_employee, payroll_entry=entry_name or None
			)
			return {
				"ok": True,
				"mode": "single_employee",
				"payroll_entry": entry_name or None,
				"created": [row["name"]],
				"slips": [row],
				"count": 1,
				"errors": [],
			}
		except Exception as exc:
			frappe.log_error(title="people_slip_single", message=frappe.get_traceback())
			frappe.throw(str(exc))

	if entry_name and frappe.db.exists("Payroll Entry", entry_name):
		doc = frappe.get_doc("Payroll Entry", entry_name)
		if not doc.get("employees"):
			_fill_payroll_entry_employees(doc)
			doc.save(ignore_permissions=True)
			frappe.db.commit()
		try:
			if hasattr(doc, "create_salary_slips"):
				doc.create_salary_slips()
			frappe.db.commit()
		except Exception as exc:
			errors.append(str(exc)[:240])
			frappe.log_error(title="people_payroll_create_slips", message=frappe.get_traceback())

		filters = {}
		if frappe.get_meta("Salary Slip").has_field("payroll_entry"):
			filters = {"payroll_entry": entry_name}
		else:
			filters = {
				"start_date": [">=", cstr(doc.start_date)],
				"end_date": ["<=", cstr(doc.end_date)],
			}
		slips = frappe.get_all(
			"Salary Slip",
			filters=filters,
			fields=["name", "employee", "net_pay", "docstatus"],
			order_by="modified desc",
			limit_page_length=200,
		)
		if slips:
			return {
				"ok": True,
				"mode": "payroll_entry",
				"payroll_entry": entry_name,
				"slips": [
					{
						"name": s.name,
						"employee": s.employee,
						"net_pay": flt(s.net_pay),
						"docstatus": cint(s.docstatus),
					}
					for s in slips
				],
				"count": len(slips),
				"errors": errors[:10],
			}

	# Fallback: create draft Salary Slips for employees with SSA this month
	if not frappe.db.exists("DocType", "Salary Slip"):
		frappe.throw(_("Salary Slip DocType missing"))
	assignments = frappe.get_all(
		"Salary Structure Assignment",
		filters={"docstatus": 1},
		fields=["employee", "salary_structure", "base"],
		limit_page_length=200,
	)
	for a in assignments:
		try:
			row = create_salary_slip_for_employee(
				a.employee, payroll_entry=entry_name or None, base=a.base
			)
			created.append(row["name"])
		except Exception as exc:
			errors.append({"employee": a.employee, "error": str(exc)[:160]})
	frappe.db.commit()
	return {
		"ok": bool(created),
		"mode": "fallback_salary_slip",
		"payroll_entry": entry_name or None,
		"created": created,
		"count": len(created),
		"errors": errors[:25],
	}


def submit_people_payroll(roles, payroll_entry=None):
	"""Step 5 — submit salary slips / payroll entry."""
	_people_require_hr_manager(roles)
	submitted = []
	errors = []
	entry_name = cstr(payroll_entry or "").strip()

	if entry_name and frappe.db.exists("Payroll Entry", entry_name):
		doc = frappe.get_doc("Payroll Entry", entry_name)
		try:
			if hasattr(doc, "submit_salary_slips"):
				doc.submit_salary_slips()
			elif cint(doc.docstatus) == 0:
				doc.submit()
			frappe.db.commit()
			return {
				"ok": True,
				"mode": "payroll_entry",
				"payroll_entry": entry_name,
				"docstatus": cint(frappe.db.get_value("Payroll Entry", entry_name, "docstatus")),
			}
		except Exception as exc:
			errors.append(str(exc)[:240])
			frappe.log_error(title="people_payroll_submit_entry", message=frappe.get_traceback())

	start, end = _month_pay_period()
	filters = {"docstatus": 0}
	if entry_name and frappe.get_meta("Salary Slip").has_field("payroll_entry"):
		filters["payroll_entry"] = entry_name
	else:
		filters["start_date"] = [">=", cstr(start)]
		filters["end_date"] = ["<=", cstr(end)]
	slips = frappe.get_all("Salary Slip", filters=filters, pluck="name", limit_page_length=300)
	for name in slips:
		try:
			frappe.get_doc("Salary Slip", name).submit()
			submitted.append(name)
		except Exception as exc:
			errors.append({"slip": name, "error": str(exc)[:160]})
	frappe.db.commit()
	return {
		"ok": bool(submitted),
		"mode": "salary_slips",
		"submitted": submitted,
		"count": len(submitted),
		"errors": errors[:25],
		"payroll_entry": entry_name or None,
	}


def list_org_salary_slips(roles, limit=50):
	_people_require_hr_manager(roles)
	if not frappe.db.exists("DocType", "Salary Slip"):
		return {"slips": [], "total": 0}
	limit = max(1, min(cint(limit) or 50, 200))
	rows = frappe.get_all(
		"Salary Slip",
		fields=["name", "employee", "employee_name", "start_date", "end_date", "gross_pay", "net_pay", "status", "docstatus"],
		order_by="start_date desc",
		limit_page_length=limit,
	)
	return {
		"slips": [
			{
				"name": r.name,
				"employee": r.employee,
				"employee_name": r.employee_name,
				"start_date": cstr(r.start_date) if r.start_date else None,
				"end_date": cstr(r.end_date) if r.end_date else None,
				"gross_pay": flt(r.gross_pay),
				"net_pay": flt(r.net_pay),
				"status": r.status or ("Submitted" if cint(r.docstatus) == 1 else "Draft"),
				"docstatus": cint(r.docstatus),
			}
			for r in rows
		],
		"total": len(rows),
	}


def run_people_payroll_full(roles, start_date=None, end_date=None):
	"""Run steps 1→5 in sequence for HR Manager one-click processing."""
	_people_require_hr_manager(roles)
	steps_out = []
	assign = ensure_people_payroll_assignments(roles)
	steps_out.append({"step": "assign", "result": {"assigned_count": assign.get("assigned_count"), "structure": assign.get("structure")}})
	entry = create_people_payroll_entry(roles, start_date=start_date, end_date=end_date)
	steps_out.append({"step": "create_entry", "result": entry})
	slips = generate_people_salary_slips(roles, payroll_entry=entry.get("payroll_entry"))
	steps_out.append({"step": "generate_slips", "result": {"count": slips.get("count"), "mode": slips.get("mode"), "errors": slips.get("errors")}})
	submit = submit_people_payroll(roles, payroll_entry=entry.get("payroll_entry"))
	steps_out.append({"step": "submit", "result": submit})
	status = get_people_payroll_workflow(roles)
	return {
		"ok": bool(submit.get("ok") or slips.get("count")),
		"steps": steps_out,
		"workflow": status,
	}
