"""Delete a WDD master (Wing, Division, Department, Designation, Unit/Centre, Position).

Only the People Org Master row is removed. ERPNext Department / Designation / Branch
records stay because other HRMS documents may link to them.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr

MASTER_DT = "People Org Master"


def _children(row):
	if frappe.get_meta(MASTER_DT).has_field("parent_master"):
		return frappe.db.count(MASTER_DT, {"parent_master": row.name})
	title = row.title
	if row.kind == "Wing":
		return frappe.db.count(MASTER_DT, {"wing": title, "kind": ("!=", "Wing")})
	if row.kind == "Division":
		return frappe.db.count(MASTER_DT, {"wing": row.wing or "", "division": title, "kind": ("in", ["Department", "Designation", "Unit", "Position"])})
	dept_keys = [k for k in {row.erp_name, title} if k]
	if row.kind == "Department":
		return frappe.db.count(MASTER_DT, {"department": ("in", dept_keys), "kind": ("in", ["Designation", "Unit", "Position"])})
	if row.kind == "Designation":
		meta = frappe.get_meta(MASTER_DT)
		if not meta.has_field("designation"):
			return 0
		return frappe.db.count(MASTER_DT, {"department": row.department or "", "designation": ("in", [k for k in {title, row.erp_name} if k]), "kind": ("in", ["Unit", "Position"])})
	if row.kind == "Unit":
		meta = frappe.get_meta(MASTER_DT)
		if not meta.has_field("unit"):
			return 0
		return frappe.db.count(MASTER_DT, {"unit": title, "kind": "Position"})
	return 0


def _employees(row):
	meta = frappe.get_meta("Employee")
	filters = {"status": ("!=", "Left")}
	title = row.title
	if row.kind == "Wing":
		if row.area == "Corporate" or not meta.has_field("people_wing"):
			return 0
		filters["people_wing"] = title
	elif row.kind == "Division":
		if not meta.has_field("people_division"):
			return 0
		filters["people_division"] = title
		if row.wing and meta.has_field("people_wing"):
			filters["people_wing"] = row.wing
	elif row.kind == "Department":
		filters["department"] = row.erp_name or title
	elif row.kind == "Designation":
		filters["designation"] = row.erp_name or title
		if row.department:
			filters["department"] = row.department
	elif row.kind == "Unit":
		if not meta.has_field("people_unit"):
			return 0
		filters["people_unit"] = title
	elif row.kind == "Position":
		if not meta.has_field("people_position"):
			return 0
		filters["people_position"] = title
	return frappe.db.count("Employee", filters)


@frappe.whitelist(allow_guest=True)
def delete_people_org_master(name=None, sid=None):
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
	name = _parse_request_value("name", name)
	if not name or not frappe.db.exists(MASTER_DT, name):
		return _error(_("Item not found"))
	fields = ["name", "kind", "title", "wing", "division", "department", "area", "erp_name"]
	row = frappe.db.get_value(MASTER_DT, name, fields, as_dict=True)
	try:
		children = _children(row)
		if children:
			return _error(_("{0} has {1} item(s) under it. Delete or move those first.").format(row.title, children))
		people = _employees(row)
		if people:
			return _error(_("{0} is assigned to {1} employee(s). Reassign them first, or deactivate instead.").format(row.title, people))
		frappe.delete_doc(MASTER_DT, name, ignore_permissions=True, force=True)
		frappe.db.commit()
		return _success({"name": name, "kind": row.kind, "title": row.title}, message=_("Deleted"))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="delete_people_org_master", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Could not delete"))
