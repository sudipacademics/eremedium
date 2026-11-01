"""Password-confirmed employee delete for HR / admin in the People portal.

mode="delete" removes the Employee record. Past attendance, leave and payroll documents
that name the employee are kept as history. mode="archive" marks the employee Left.
Either way the employee's portal login is disabled.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cstr, nowdate

PROTECTED_ROLES = {"System Manager", "Administrator"}


def _disable_login(user):
	if not user or user in ("Administrator", "Guest", frappe.session.user):
		return False
	if PROTECTED_ROLES & set(frappe.get_roles(user)):
		return False
	if frappe.db.get_value("User", user, "enabled"):
		frappe.db.set_value("User", user, "enabled", 0, update_modified=True)
		return True
	return False


def _mark_left(name):
	values = {"status": "Left"}
	meta = frappe.get_meta("Employee")
	if meta.has_field("relieving_date") and not frappe.db.get_value("Employee", name, "relieving_date"):
		values["relieving_date"] = nowdate()
	frappe.db.set_value("Employee", name, values, update_modified=True)


def _detach_reportees(name):
	for reportee in frappe.get_all("Employee", filters={"reports_to": name}, pluck="name"):
		frappe.db.set_value("Employee", reportee, "reports_to", None, update_modified=False)


def _force_delete(name):
	"""Remove the Employee even when old attendance / leave / payroll documents still name it.
	Those documents are kept untouched; they already store the employee name for history."""
	_detach_reportees(name)
	frappe.delete_doc("Employee", name, ignore_permissions=True, force=True)


def delete_employees(names, reason="", mode="delete"):
	me = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	results = []
	for name in names:
		name = cstr(name).strip()
		if not name:
			continue
		if not frappe.db.exists("Employee", name):
			results.append({"employee": name, "result": "not_found"})
			continue
		row = frappe.db.get_value("Employee", name, ["employee_name", "user_id"], as_dict=True) or {}
		label = row.get("employee_name") or name
		if name == me:
			results.append({"employee": name, "name": label, "result": "skipped", "message": _("You cannot delete your own employee record")})
			continue
		if row.get("user_id") and PROTECTED_ROLES & set(frappe.get_roles(row.user_id)):
			results.append({"employee": name, "name": label, "result": "skipped", "message": _("Admin accounts cannot be deleted here")})
			continue
		if mode == "archive":
			_mark_left(name)
			_disable_login(row.get("user_id"))
			results.append({"employee": name, "name": label, "result": "archived"})
		else:
			frappe.db.savepoint("people_emp_delete")
			_detach_reportees(name)
			try:
				frappe.delete_doc("Employee", name, ignore_permissions=True)
				results.append({"employee": name, "name": label, "result": "deleted"})
			except (frappe.LinkExistsError, frappe.ValidationError):
				frappe.db.rollback(save_point="people_emp_delete")
				try:
					_force_delete(name)
					results.append({"employee": name, "name": label, "result": "deleted", "history_kept": True})
				except Exception as exc:
					frappe.db.rollback(save_point="people_emp_delete")
					results.append({"employee": name, "name": label, "result": "skipped", "message": cstr(exc)[:200]})
					continue
			_disable_login(row.get("user_id"))
		frappe.get_doc(
			{
				"doctype": "Comment",
				"comment_type": "Info",
				"reference_doctype": "User",
				"reference_name": frappe.session.user,
				"content": f"People HRMS: employee {name} ({label}) {results[-1]['result']} by {frappe.session.user}" + (f" — {reason}" if reason else ""),
			}
		).insert(ignore_permissions=True)
	frappe.db.commit()
	return {
		"results": results,
		"deleted": sum(1 for r in results if r["result"] == "deleted"),
		"history_kept": sum(1 for r in results if r.get("history_kept")),
		"archived": sum(1 for r in results if r["result"] == "archived"),
		"skipped": sum(1 for r in results if r["result"] in ("skipped", "not_found")),
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def delete_people_employees(employees=None, password=None, reason=None, mode=None, sid=None):
	from frappe.utils.password import check_password

	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	if not is_people_manager(_user_roles()):
		return _error(_("HR manager access required"), 403)
	password = cstr(_parse_request_value("password", password))
	if not password:
		return _error(_("Enter your password to confirm"))
	try:
		check_password(frappe.session.user, password)
	except frappe.AuthenticationError:
		return _error(_("Incorrect password. Nothing was deleted."), 403)
	raw = _parse_request_value("employees", employees) or "[]"
	try:
		names = json.loads(raw) if isinstance(raw, str) else list(raw)
	except ValueError:
		return _error(_("Invalid employee list"))
	if not names:
		return _error(_("Select at least one employee"))
	if len(names) > 200:
		return _error(_("Delete at most 200 employees at a time"))
	try:
		mode = "archive" if cstr(_parse_request_value("mode", mode)) == "archive" else "delete"
		return _success(delete_employees(names, cstr(_parse_request_value("reason", reason)), mode), message=_("Done"))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="delete_people_employees", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Could not delete employees"))
