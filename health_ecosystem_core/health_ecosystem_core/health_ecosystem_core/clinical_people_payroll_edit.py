"""HR / admin payroll edits from the People portal: draft salary slips and structure assignments."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cstr, flt, getdate, money_in_words, nowdate


def _helpers():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles, is_people_manager


def _guard(sid):
	_error, _parse, _require, _success, _roles, is_people_manager = _helpers()
	denied = _require(sid)
	if denied:
		return denied
	if not is_people_manager(_roles()):
		return _error(_("HR manager access required"), 403)
	return None


def _lines(doc, field):
	return [
		{"row": r.name, "component": r.salary_component, "amount": flt(r.amount)}
		for r in (doc.get(field) or [])
	]


def _slip_payload(doc):
	return {
		"slip": doc.name,
		"employee": doc.employee,
		"employee_name": doc.employee_name,
		"docstatus": doc.docstatus,
		"status": doc.status,
		"start_date": cstr(doc.start_date),
		"end_date": cstr(doc.end_date),
		"payment_days": flt(doc.payment_days),
		"working_days": flt(doc.total_working_days),
		"earnings": _lines(doc, "earnings"),
		"deductions": _lines(doc, "deductions"),
		"gross": flt(doc.gross_pay),
		"total_deduction": flt(doc.total_deduction),
		"net": flt(doc.net_pay),
		"components": {
			"Earning": frappe.get_all("Salary Component", filters={"type": "Earning", "disabled": 0}, pluck="name", order_by="name asc"),
			"Deduction": frappe.get_all("Salary Component", filters={"type": "Deduction", "disabled": 0}, pluck="name", order_by="name asc"),
		},
	}


@frappe.whitelist(allow_guest=True)
def get_people_salary_slip(slip=None, sid=None):
	denied = _guard(sid)
	if denied:
		return denied
	_error, _parse, _require, _success, _roles, _mgr = _helpers()
	slip = _parse("slip", slip)
	if not slip or not frappe.db.exists("Salary Slip", slip):
		return _error(_("Salary slip not found"))
	return _success(_slip_payload(frappe.get_doc("Salary Slip", slip)))


def _apply_lines(doc, field, rows):
	existing = {r.name: r for r in (doc.get(field) or [])}
	keep = set()
	for item in rows or []:
		amount = flt(item.get("amount"))
		row_name = cstr(item.get("row"))
		if row_name and row_name in existing:
			row = existing[row_name]
			row.amount = amount
			if hasattr(row, "default_amount"):
				row.default_amount = amount
			row.db_update()
			keep.add(row_name)
			continue
		component = cstr(item.get("component")).strip()
		if not component or not frappe.db.exists("Salary Component", component):
			continue
		abbr = frappe.db.get_value("Salary Component", component, "salary_component_abbr") or ""
		row = doc.append(field, {"salary_component": component, "abbr": abbr, "amount": amount, "default_amount": amount})
		row.db_insert()
		keep.add(row.name)
	for name, row in existing.items():
		if name not in keep:
			frappe.db.delete(row.doctype, {"name": name})


@frappe.whitelist(allow_guest=True)
def update_people_salary_slip(slip=None, earnings=None, deductions=None, sid=None):
	denied = _guard(sid)
	if denied:
		return denied
	_error, _parse, _require, _success, _roles, _mgr = _helpers()
	slip = _parse("slip", slip)
	if not slip or not frappe.db.exists("Salary Slip", slip):
		return _error(_("Salary slip not found"))
	doc = frappe.get_doc("Salary Slip", slip)
	if doc.docstatus != 0:
		return _error(_("Only draft salary slips can be edited. Cancel and amend the submitted slip first."))
	try:
		earn = json.loads(_parse("earnings", earnings) or "[]")
		ded = json.loads(_parse("deductions", deductions) or "[]")
		_apply_lines(doc, "earnings", earn)
		_apply_lines(doc, "deductions", ded)
		doc = frappe.get_doc("Salary Slip", slip)
		gross = sum(flt(r.amount) for r in doc.earnings)
		total_ded = sum(flt(r.amount) for r in doc.deductions)
		net = gross - total_ded
		rate = flt(doc.get("exchange_rate")) or 1
		values = {
			"gross_pay": gross,
			"total_deduction": total_ded,
			"net_pay": net,
			"rounded_total": round(net),
		}
		meta = frappe.get_meta("Salary Slip")
		for key, value in (("base_gross_pay", gross * rate), ("base_total_deduction", total_ded * rate), ("base_net_pay", net * rate), ("base_rounded_total", round(net) * rate)):
			if meta.has_field(key):
				values[key] = value
		if meta.has_field("total_in_words"):
			values["total_in_words"] = money_in_words(round(net), doc.currency)
		doc.db_set(values, update_modified=True)
		doc.add_comment("Edit", _("Earnings and deductions updated from People HRMS by {0}").format(frappe.session.user))
		frappe.db.commit()
		return _success(_slip_payload(frappe.get_doc("Salary Slip", slip)), message=_("Salary slip updated"))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="update_people_salary_slip", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Could not update salary slip"))


@frappe.whitelist(allow_guest=True)
def get_people_salary_structures(employee=None, sid=None):
	denied = _guard(sid)
	if denied:
		return denied
	_error, _parse, _require, _success, _roles, _mgr = _helpers()
	employee = _parse("employee", employee)
	company = frappe.db.get_value("Employee", employee, "company") if employee else None
	filters = {"docstatus": 1, "is_active": "Yes"}
	if company:
		filters["company"] = company
	structures = frappe.get_all("Salary Structure", filters=filters, fields=["name", "company", "currency"], order_by="name asc")
	current = None
	if employee:
		rows = frappe.get_all(
			"Salary Structure Assignment",
			filters={"employee": employee, "docstatus": 1},
			fields=["name", "salary_structure", "from_date", "base", "variable"],
			order_by="from_date desc",
			limit_page_length=1,
		)
		current = rows[0] if rows else None
	return _success(
		{
			"employee": employee,
			"employee_name": frappe.db.get_value("Employee", employee, "employee_name") if employee else "",
			"structures": structures,
			"current": current,
		}
	)


@frappe.whitelist(allow_guest=True)
def assign_people_salary_structure(employee=None, salary_structure=None, from_date=None, base=None, variable=None, sid=None):
	denied = _guard(sid)
	if denied:
		return denied
	_error, _parse, _require, _success, _roles, _mgr = _helpers()
	employee = _parse("employee", employee)
	structure = _parse("salary_structure", salary_structure)
	from_date = _parse("from_date", from_date) or nowdate()
	if not employee or not frappe.db.exists("Employee", employee):
		return _error(_("Employee not found"))
	if not structure or not frappe.db.exists("Salary Structure", structure):
		return _error(_("Choose a salary structure"))
	try:
		company = frappe.db.get_value("Employee", employee, "company") or frappe.db.get_value("Salary Structure", structure, "company")
		doc = frappe.get_doc(
			{
				"doctype": "Salary Structure Assignment",
				"employee": employee,
				"salary_structure": structure,
				"company": company,
				"currency": frappe.db.get_value("Salary Structure", structure, "currency"),
				"from_date": getdate(from_date),
				"base": flt(_parse("base", base)),
				"variable": flt(_parse("variable", variable)),
			}
		)
		doc.insert(ignore_permissions=True)
		doc.submit()
		frappe.db.commit()
		return _success({"assignment": doc.name}, message=_("Salary structure assigned"))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="assign_people_salary_structure", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Could not assign salary structure"))
