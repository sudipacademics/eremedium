"""Smilecure organizational masters: Wing, Division, Department, Designation, Unit.

ERPNext Department, Designation, Branch, and Employee stay the records other HRMS
modules already read. This module keeps those records aligned with the editable
Smilecure hierarchy.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr

MASTER_DT = "People Org Master"
BUSINESS_WINGS = ("LAB", "AESTHETIC", "CARE")
DIVISIONS = ("COCO", "FOCO", "BACKOFFICE")
CORPORATE = "Corporate / Back Office"
KINDS = ("Wing", "Division", "Department", "Designation", "Unit", "Position")
KIND_OPTIONS = "\n".join(KINDS)

# (wing, short department name, designations). Empty wing = corporate, no division.
ORG_TREE = (
	("LAB", "Laboratory Operations", ("Technician", "Junior Technician", "Senior Technician")),
	("LAB", "Patient Collection", ("Phlebotomist",)),
	("LAB", "Front Office", ("Receptionist",)),
	("LAB", "CRM / Sales", ("CRM Executive",)),
	("LAB", "Marketing", ("Marketing Executive",)),
	("AESTHETIC", "Aesthetic Services", ("Cosmetologist", "Junior Cosmetologist", "Assistant Cosmetologist")),
	("AESTHETIC", "Front Office", ("Receptionist",)),
	("AESTHETIC", "CRM / Sales", ("CRM Executive",)),
	("AESTHETIC", "Marketing", ("Marketing Executive",)),
	("CARE", "Physiotherapy", ("Physiotherapist", "Junior Physiotherapist")),
	("CARE", "Pharmacy", ("Pharmacy Staff",)),
	("CARE", "Front Office", ("Receptionist",)),
	("CARE", "CRM / Sales", ("CRM Executive",)),
	("CARE", "Marketing", ("Marketing Executive",)),
	("", "HR", ()),
	("", "Finance & Accounts", ()),
	("", "CRM", ()),
	("", "Sales", ()),
	("", "Marketing", ()),
	("", "Operations", ()),
	("", "IT", ()),
	("", "Administration", ()),
	("", "Legal & Compliance", ()),
)


def _company():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import _default_company

	return _default_company()


def ensure_people_org_doctypes():
	if frappe.db.exists("DocType", MASTER_DT):
		return False
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": MASTER_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"autoname": "hash",
			"naming_rule": "Random",
			"engine": "InnoDB",
			"track_changes": 1,
			"fields": [
				{"fieldname": "kind", "label": "Kind", "fieldtype": "Select", "options": KIND_OPTIONS, "reqd": 1, "in_list_view": 1},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "wing", "label": "Wing", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "division", "label": "Division", "fieldtype": "Data"},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "area", "label": "Area", "fieldtype": "Select", "options": "Business\nCorporate", "default": "Business"},
				{"fieldname": "erp_name", "label": "ERP Name", "fieldtype": "Data"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			],
			"permissions": [
				{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
				for role in ("System Manager", "HR Manager", "HR User", "Health System Admin")
			],
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return True


def ensure_people_org_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	specs = {
		"Employee": [
			{"fieldname": "people_wing", "label": "Wing", "fieldtype": "Data", "insert_after": "department"},
			{"fieldname": "people_division", "label": "Division", "fieldtype": "Data", "insert_after": "department"},
			{"fieldname": "people_unit", "label": "Unit / Centre", "fieldtype": "Data", "insert_after": "department"},
			{"fieldname": "people_position", "label": "Position", "fieldtype": "Data", "insert_after": "people_unit"},
		],
		"Department": [
			{"fieldname": "people_wing", "label": "Wing", "fieldtype": "Data", "insert_after": "department_name"},
			{"fieldname": "people_area", "label": "Org Area", "fieldtype": "Data", "insert_after": "department_name"},
			{"fieldname": "people_label", "label": "Short Name", "fieldtype": "Data", "insert_after": "department_name"},
		],
	}
	pending = {}
	for doctype, fields in specs.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		meta = frappe.get_meta(doctype)
		missing = [field for field in fields if not meta.has_field(field["fieldname"])]
		if missing:
			pending[doctype] = missing
	if pending:
		create_custom_fields(pending, update=True)
		for doctype in pending:
			frappe.clear_cache(doctype=doctype)
	return True


def ensure_master_schema():
	"""Keep the live master able to store the full WDD chain, including Position."""
	ensure_people_org_doctypes()
	ensure_people_org_fields()
	current = frappe.db.get_value("DocField", {"parent": MASTER_DT, "fieldname": "kind"}, "options")
	if current != KIND_OPTIONS:
		frappe.db.set_value("DocField", {"parent": MASTER_DT, "fieldname": "kind"}, "options", KIND_OPTIONS)
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	meta = frappe.get_meta(MASTER_DT)
	missing = []
	if not meta.has_field("designation"):
		missing.append({"fieldname": "designation", "label": "Designation", "fieldtype": "Data", "insert_after": "department"})
	if not meta.has_field("unit"):
		missing.append({"fieldname": "unit", "label": "Unit / Centre", "fieldtype": "Data", "insert_after": "designation"})
	if not meta.has_field("parent_master"):
		missing.append({"fieldname": "parent_master", "label": "Parent", "fieldtype": "Data", "insert_after": "kind"})
	if missing:
		create_custom_fields({MASTER_DT: missing}, update=True)
	frappe.db.commit()
	frappe.clear_cache(doctype=MASTER_DT)
	_backfill_parents()
	return True


def _backfill_parents():
	"""Give legacy rows an explicit parent so the tree never matches items by name alone."""
	if not frappe.db.count(MASTER_DT, {"parent_master": ("is", "not set"), "kind": ("!=", "Wing")}):
		return
	rows = frappe.get_all(
		MASTER_DT,
		fields=["name", "kind", "title", "wing", "division", "department", "designation", "unit", "area", "erp_name", "parent_master"],
		limit_page_length=5000,
	)
	wings = {r.title: r.name for r in rows if r.kind == "Wing"}
	corporate = next((r.name for r in rows if r.kind == "Wing" and (r.area == "Corporate" or r.title == CORPORATE)), None)

	def one(items):
		return items[0].name if len(items) == 1 else None

	for r in rows:
		if r.parent_master or r.kind == "Wing":
			continue
		parent = None
		if r.kind == "Division":
			parent = wings.get(r.wing)
		elif r.kind == "Department":
			if r.wing and r.division:
				parent = one([x for x in rows if x.kind == "Division" and x.wing == r.wing and x.title == r.division])
			elif r.wing:
				parent = wings.get(r.wing)
			else:
				parent = corporate
		elif r.kind == "Designation":
			depts = [x for x in rows if x.kind == "Department" and r.department and (x.erp_name == r.department) and (x.wing or "") == (r.wing or "")]
			if len(depts) > 1 and r.division:
				depts = [x for x in depts if x.division == r.division] or depts
			parent = depts[0].name if depts else None
		elif r.kind == "Unit":
			if r.designation:
				parent = one([x for x in rows if x.kind == "Designation" and x.title == r.designation and x.department == r.department])
			if not parent:
				parent = one([x for x in rows if x.kind == "Department" and x.erp_name == r.department])
		elif r.kind == "Position":
			parent = one([x for x in rows if x.kind == "Unit" and x.title == r.unit and (not r.department or x.department == r.department)])
		if parent:
			frappe.db.set_value(MASTER_DT, r.name, "parent_master", parent, update_modified=False)
	frappe.db.commit()


def _chain(name):
	"""Walk parents and return the wing/division/department/designation/unit context of a master."""
	ctx = {"wing": "", "division": "", "department": "", "department_title": "", "designation": "", "unit": "", "area": "Business"}
	seen = set()
	while name and name not in seen:
		seen.add(name)
		row = frappe.db.get_value(MASTER_DT, name, ["name", "kind", "title", "erp_name", "area", "parent_master"], as_dict=True)
		if not row:
			break
		if row.kind == "Wing":
			if row.area == "Corporate" or row.title == CORPORATE:
				ctx["area"] = "Corporate"
			else:
				ctx["wing"] = row.title
		elif row.kind == "Division":
			ctx["division"] = row.title
		elif row.kind == "Department":
			ctx["department"] = row.erp_name or row.title
			ctx["department_title"] = row.title
		elif row.kind == "Designation":
			ctx["designation"] = row.title
		elif row.kind == "Unit":
			ctx["unit"] = row.title
		name = row.parent_master
	return ctx


CHILD_KIND = {"Wing": ("Division", "Department"), "Division": ("Department",), "Department": ("Designation",), "Designation": ("Unit",), "Unit": ("Position",)}


def save_master_with_parent(kind, title, parent_master="", active=1, name=None):
	"""Create or edit one WDD item under an explicit parent. Never merges into another item."""
	ensure_master_schema()
	kind = _normalise_kind(kind)
	title = cstr(title).strip()
	if kind not in KINDS:
		frappe.throw(_("Unknown organizational master"))
	if not title:
		frappe.throw(_("Name is required"))
	current = frappe.db.get_value(MASTER_DT, name, ["name", "kind", "title", "parent_master", "erp_name", "wing", "division", "department", "designation", "unit"], as_dict=True) if name else None
	if name and not current:
		frappe.throw(_("Item not found"))
	if current:
		kind = current.kind
		parent_master = current.parent_master or ""
	parent_master = cstr(parent_master).strip()
	if kind != "Wing":
		if not parent_master or not frappe.db.exists(MASTER_DT, parent_master):
			frappe.throw(_("Choose where this {0} belongs").format(kind.lower()))
		parent_kind = frappe.db.get_value(MASTER_DT, parent_master, "kind")
		if kind not in CHILD_KIND.get(parent_kind, ()):
			frappe.throw(_("A {0} cannot be added under a {1}").format(kind.lower(), cstr(parent_kind).lower()))
	dup_filters = {"kind": kind, "parent_master": parent_master or ("is", "not set"), "name": ("!=", name or "")}
	dup = [r for r in frappe.get_all(MASTER_DT, filters=dup_filters, fields=["name", "title"], limit_page_length=1000) if cstr(r.title).strip().lower() == title.lower()]
	if dup:
		frappe.throw(_("{0} \"{1}\" already exists here").format(kind, title))
	ctx = _chain(parent_master) if parent_master else {"wing": "", "division": "", "department": "", "department_title": "", "designation": "", "unit": "", "area": "Corporate" if title == CORPORATE else "Business"}
	area = ctx["area"]
	wing = ctx["wing"]
	values = {
		"kind": kind,
		"title": title,
		"parent_master": parent_master,
		"wing": wing,
		"division": ctx["division"] if kind != "Division" else "",
		"department": ctx["department"] if kind in ("Designation", "Unit", "Position") else "",
		"designation": ctx["designation"] if kind in ("Unit", "Position") else "",
		"unit": ctx["unit"] if kind == "Position" else "",
		"area": area,
		"active": 1 if cint(active) else 0,
	}
	if kind == "Wing" and title != CORPORATE:
		values["area"] = "Business"
	if current and current.erp_name:
		values["erp_name"] = current.erp_name
	elif kind == "Department":
		values["erp_name"] = _erp_department(title, wing, area, ctx["division"])
	elif kind == "Designation":
		values["erp_name"] = _erp_designation(title)
	elif kind == "Unit":
		values["erp_name"] = _erp_unit(title, wing)
	else:
		values["erp_name"] = title
	if current:
		frappe.db.set_value(MASTER_DT, name, values, update_modified=True)
		if current.title != title:
			_cascade_rename(current, title)
		saved = name
	else:
		doc = frappe.get_doc({"doctype": MASTER_DT, **values})
		doc.insert(ignore_permissions=True)
		saved = doc.name
	if kind == "Department" and values.get("erp_name") and frappe.db.exists("Department", values["erp_name"]) and frappe.get_meta("Department").has_field("disabled"):
		frappe.db.set_value("Department", values["erp_name"], "disabled", 0 if cint(active) else 1, update_modified=False)
	frappe.db.commit()
	return {"name": saved, "kind": kind, "title": title, "active": values["active"]}


def _descendants(name):
	out = []
	queue = [name]
	while queue:
		current = queue.pop()
		kids = frappe.get_all(MASTER_DT, filters={"parent_master": current}, pluck="name")
		out.extend(kids)
		queue.extend(kids)
	return out


def _cascade_rename(old, new_title):
	"""Keep descendants and assigned employees pointing at a renamed wing, division, unit or position."""
	field = {"Wing": "wing", "Division": "division", "Designation": "designation", "Unit": "unit"}.get(old.kind)
	if field:
		for child in _descendants(old.name):
			if frappe.db.get_value(MASTER_DT, child, field) == old.title:
				frappe.db.set_value(MASTER_DT, child, field, new_title, update_modified=False)
	emp_field = {"Wing": "people_wing", "Division": "people_division", "Unit": "people_unit", "Position": "people_position"}.get(old.kind)
	if emp_field and frappe.get_meta("Employee").has_field(emp_field):
		filters = {emp_field: old.title}
		if old.kind == "Division" and old.wing:
			filters["people_wing"] = old.wing
		for emp in frappe.get_all("Employee", filters=filters, pluck="name"):
			frappe.db.set_value("Employee", emp, emp_field, new_title, update_modified=False)


def _find_master(kind, title, wing="", division="", department="", designation="", unit=""):
	filters = {"kind": kind, "title": title}
	if kind in ("Division", "Department", "Unit", "Position"):
		filters["wing"] = wing or ""
	if kind == "Department" and division:
		filters["division"] = division
	if kind in ("Designation", "Unit", "Position"):
		filters["department"] = department or ""
	if kind in ("Unit", "Position") and division:
		filters["division"] = division
	if kind in ("Unit", "Position") and designation:
		filters["designation"] = designation
	if kind == "Position":
		filters["unit"] = unit or ""
	return frappe.db.get_value(MASTER_DT, filters, "name")


def _upsert_master(kind, title, wing="", division="", department="", designation="", unit="", area="Business", erp_name="", active=1):
	ensure_people_org_doctypes()
	title = cstr(title).strip()
	if not title:
		return None
	name = _find_master(kind, title, wing=wing, division=division, department=department, designation=designation, unit=unit)
	values = {
		"kind": kind,
		"title": title,
		"wing": wing or "",
		"division": division or "",
		"department": department or "",
		"designation": designation or "",
		"unit": unit or "",
		"area": area or "Business",
		"erp_name": erp_name or "",
		"active": 1 if cint(active) else 0,
	}
	if name:
		frappe.db.set_value(MASTER_DT, name, values, update_modified=True)
		return name
	doc = frappe.get_doc({"doctype": MASTER_DT, **values})
	doc.insert(ignore_permissions=True)
	return doc.name


def _erp_department(label, wing, area, division=""):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import _ensure_link_master

	full = " — ".join(p for p in (wing, division, label) if p) if wing else label
	erp_name = _ensure_link_master("Department", full)
	if erp_name and frappe.get_meta("Department").has_field("people_wing"):
		frappe.db.set_value(
			"Department",
			erp_name,
			{"people_wing": wing or "", "people_area": area, "people_label": label},
			update_modified=False,
		)
	return erp_name or full


def _erp_designation(title):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import _ensure_link_master

	return _ensure_link_master("Designation", title) or title


def _erp_unit(title, wing):
	if not frappe.db.exists("DocType", "Branch"):
		return title
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import _ensure_link_master

	return _ensure_link_master("Branch", title) or title


def seed_people_org():
	"""Create the official Smilecure structure once. Existing masters are left in place."""
	ensure_master_schema()
	created = {"wings": 0, "divisions": 0, "departments": 0, "designations": 0}
	for wing in BUSINESS_WINGS:
		if not _find_master("Wing", wing):
			created["wings"] += 1
		_upsert_master("Wing", wing, area="Business", active=1)
		for division in DIVISIONS:
			if not _find_master("Division", division, wing=wing):
				created["divisions"] += 1
			_upsert_master("Division", division, wing=wing, area="Business", active=1)
	if not _find_master("Wing", CORPORATE):
		created["wings"] += 1
	_upsert_master("Wing", CORPORATE, area="Corporate", active=1)

	for wing, label, designations in ORG_TREE:
		area = "Corporate" if not wing else "Business"
		erp_name = _erp_department(label, wing, area)
		if not _find_master("Department", label, wing=wing):
			created["departments"] += 1
		_upsert_master("Department", label, wing=wing, area=area, erp_name=erp_name, active=1)
		dept_key = erp_name or (f"{wing} — {label}" if wing else label)
		for designation in designations:
			erp_designation = _erp_designation(designation)
			if not _find_master("Designation", designation, department=dept_key):
				created["designations"] += 1
			_upsert_master(
				"Designation",
				designation,
				wing=wing,
				department=dept_key,
				area=area,
				erp_name=erp_designation,
				active=1,
			)
	frappe.db.commit()
	return {"ok": True, "created": created}


def _rows(kind=None, active_only=False):
	filters = {}
	if kind:
		filters["kind"] = kind
	if active_only:
		filters["active"] = 1
	fields = ["name", "kind", "title", "wing", "division", "department", "area", "erp_name", "active"]
	meta = frappe.get_meta(MASTER_DT)
	for extra in ("designation", "unit", "parent_master"):
		if meta.has_field(extra):
			fields.append(extra)
	return frappe.get_all(
		MASTER_DT,
		filters=filters,
		fields=fields,
		order_by="area asc, wing asc, title asc",
		limit_page_length=2000,
	)


def org_tree():
	ensure_master_schema()
	rows = _rows()
	titles = {r.title for r in rows if r.kind == "Wing"}
	if not rows or any(wing not in titles for wing in BUSINESS_WINGS):
		seed_people_org()
		rows = _rows()
	return {
		"company": "Smilecure Lifestyle Pvt. Ltd.",
		"business_wings": list(BUSINESS_WINGS),
		"hierarchy": ["Wing", "Division", "Department", "Designation", "Unit/Centre", "Position"],
		"masters": rows,
		"wings": [r for r in rows if r.kind == "Wing"],
		"divisions": [r for r in rows if r.kind == "Division"],
		"departments": [r for r in rows if r.kind == "Department"],
		"designations": [r for r in rows if r.kind == "Designation"],
		"units": [r for r in rows if r.kind == "Unit"],
		"positions": [r for r in rows if r.kind == "Position"],
	}


def _require_org_editor():
	from health_ecosystem_core.health_ecosystem_core.api import _require_people_hrms_access, _success, _error, _user_roles
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	return _require_people_hrms_access, _success, _error, _user_roles, is_people_manager


def _normalise_kind(kind):
	kind = cstr(kind).strip()
	aliases = {"Unit/Centre": "Unit", "Unit / Centre": "Unit", "Centre": "Unit", "Business Wing": "Wing"}
	kind = aliases.get(kind, kind)
	if kind.lower() == "unit":
		return "Unit"
	return kind[:1].upper() + kind[1:] if kind else kind


def save_org_master(kind, title, wing="", division="", department="", designation="", unit="", active=1, name=None):
	ensure_master_schema()
	kind = _normalise_kind(kind)
	if kind not in KINDS:
		frappe.throw(_("Unknown organizational master"))
	title = cstr(title).strip()
	if not title:
		frappe.throw(_("Name is required"))
	wing = cstr(wing).strip()
	division = cstr(division).strip()
	department = cstr(department).strip()
	designation = cstr(designation).strip()
	unit = cstr(unit).strip()
	area = "Corporate" if (kind == "Wing" and title == CORPORATE) or (kind != "Wing" and not wing) else "Business"
	if kind == "Division" and not wing:
		frappe.throw(_("A division belongs to a business wing"))
	if kind == "Department" and wing == CORPORATE:
		wing = ""
		area = "Corporate"
	if kind == "Designation" and not department:
		frappe.throw(_("Choose the department this designation belongs to"))
	if kind == "Unit" and not department:
		frappe.throw(_("Choose the department this unit / centre belongs to"))
	if kind == "Position" and not unit:
		frappe.throw(_("Choose the unit / centre this position belongs to"))
	erp_name = ""
	if kind == "Department":
		erp_name = _erp_department(title, wing, area)
	elif kind == "Designation":
		erp_name = _erp_designation(title)
	elif kind == "Unit":
		erp_name = _erp_unit(title, wing)
	elif kind == "Position":
		erp_name = title
	if name and frappe.db.exists(MASTER_DT, name):
		current = frappe.db.get_value(MASTER_DT, name, ["kind", "title", "wing", "department", "division", "designation", "unit"], as_dict=True)
		if current and (current.kind != kind or current.title != title or (current.wing or "") != wing or (current.department or "") != department or (current.unit or "") != unit):
			other = _find_master(kind, title, wing=wing, division=division, department=department, designation=designation, unit=unit)
			if other and other != name:
				frappe.throw(_("That {0} already exists").format(kind.lower()))
		_upsert_existing(name, kind, title, wing, division, department, designation, unit, area, erp_name, active)
		saved = name
	else:
		existing = _find_master(kind, title, wing=wing, division=division, department=department, designation=designation, unit=unit)
		if existing and not cint(active):
			frappe.db.set_value(MASTER_DT, existing, "active", 0)
			saved = existing
		elif existing:
			frappe.db.set_value(MASTER_DT, existing, {"active": 1 if cint(active) else 0, "erp_name": erp_name or frappe.db.get_value(MASTER_DT, existing, "erp_name"), "division": division, "designation": designation, "unit": unit})
			saved = existing
		else:
			saved = _upsert_master(kind, title, wing=wing, division=division, department=department, designation=designation, unit=unit, area=area, erp_name=erp_name, active=active)
	if kind == "Department" and erp_name and frappe.db.exists("Department", erp_name) and frappe.get_meta("Department").has_field("disabled"):
		frappe.db.set_value("Department", erp_name, "disabled", 0 if cint(active) else 1, update_modified=False)
	frappe.db.commit()
	return {"name": saved, "kind": kind, "title": title, "active": 1 if cint(active) else 0}


def _upsert_existing(name, kind, title, wing, division, department, designation, unit, area, erp_name, active):
	frappe.db.set_value(
		MASTER_DT,
		name,
		{
			"kind": kind,
			"title": title,
			"wing": wing or "",
			"division": division or "",
			"department": department or "",
			"designation": designation or "",
			"unit": unit or "",
			"area": area,
			"erp_name": erp_name or frappe.db.get_value(MASTER_DT, name, "erp_name") or "",
			"active": 1 if cint(active) else 0,
		},
	)


def _employee_scope(user, roles):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	if is_people_manager(roles):
		return None
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if not employee:
		return {"reports_to": user}
	return {"reports_to": employee}


def list_org_employees(user, roles):
	ensure_people_org_fields()
	if not frappe.db.exists("DocType", "Employee"):
		return []
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "reports_to", "status"]
	if meta.has_field("branch"):
		fields.append("branch")
	for extra in ("people_wing", "people_division", "people_unit", "people_position", "company_email", "user_id"):
		if meta.has_field(extra):
			fields.append(extra)
	filters = {"status": ("!=", "Left")}
	scope = _employee_scope(user, roles)
	if scope and scope.get("reports_to"):
		filters["reports_to"] = scope["reports_to"]
	rows = frappe.get_all("Employee", filters=filters, fields=fields, order_by="employee_name asc", limit_page_length=500)
	names = {r.name: r.employee_name for r in rows}
	extra_managers = [r.reports_to for r in rows if r.reports_to and r.reports_to not in names]
	if extra_managers:
		for item in frappe.get_all("Employee", filters={"name": ("in", extra_managers)}, fields=["name", "employee_name"]):
			names[item.name] = item.employee_name
	return [
		{
			"id": r.name,
			"name": r.employee_name or r.name,
			"wing": r.get("people_wing") or "",
			"division": r.get("people_division") or "",
			"department": r.department or "",
			"designation": r.designation or "",
			"unit": r.get("people_unit") or r.get("branch") or "",
			"position": r.get("people_position") or "",
			"reports_to": r.reports_to or "",
			"reports_to_name": names.get(r.reports_to) or "",
			"status": r.status,
		}
		for r in rows
	]


def assign_employee_org(employee, wing="", division="", department="", designation="", unit="", position="", reports_to=""):
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	ensure_people_org_fields()
	meta = frappe.get_meta("Employee")
	updates = {}
	wing = cstr(wing).strip()
	division = cstr(division).strip()
	department = cstr(department).strip()
	designation = cstr(designation).strip()
	unit = cstr(unit).strip()
	position = cstr(position).strip()
	reports_to = cstr(reports_to).strip()
	if wing == CORPORATE:
		wing = ""
		division = ""
	if meta.has_field("people_wing"):
		updates["people_wing"] = wing
	if meta.has_field("people_division"):
		updates["people_division"] = division
	if department and meta.has_field("department"):
		updates["department"] = department
	if designation and meta.has_field("designation"):
		updates["designation"] = designation
	if meta.has_field("people_unit"):
		updates["people_unit"] = unit
	if meta.has_field("people_position"):
		updates["people_position"] = position
	if unit and meta.has_field("branch") and frappe.db.exists("Branch", unit):
		updates["branch"] = unit
	if meta.has_field("reports_to"):
		if reports_to and reports_to != employee and frappe.db.exists("Employee", reports_to):
			updates["reports_to"] = reports_to
		elif not reports_to:
			updates["reports_to"] = ""
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=True)
	frappe.db.commit()
	return {"employee": employee, **{k: updates.get(k, "") for k in ("people_wing", "people_division", "department", "designation", "people_unit", "people_position", "reports_to")}}


def employee_org_for_user(user):
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name") if user else None
	if not employee:
		return {}
	ensure_people_org_fields()
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "reports_to", "branch"]
	for extra in ("people_wing", "people_division", "people_unit", "people_position"):
		if meta.has_field(extra):
			fields.append(extra)
	row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	manager = ""
	if row.get("reports_to"):
		manager = frappe.db.get_value("Employee", row.reports_to, "employee_name") or ""
	return {
		"id": row.get("name") or employee,
		"name": row.get("employee_name") or "",
		"wing": row.get("people_wing") or "",
		"division": row.get("people_division") or "",
		"department": row.get("department") or "",
		"designation": row.get("designation") or "",
		"unit": row.get("people_unit") or row.get("branch") or "",
		"position": row.get("people_position") or "",
		"reports_to_name": manager,
	}


EDITABLE_EMPLOYEE_FIELDS = (
	"first_name",
	"middle_name",
	"last_name",
	"gender",
	"date_of_birth",
	"date_of_joining",
	"status",
	"blood_group",
	"marital_status",
	"cell_number",
	"personal_email",
	"company_email",
	"current_address",
	"permanent_address",
	"person_to_be_contacted",
	"emergency_phone_number",
	"relation",
)


def employee_detail(employee):
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	ensure_people_org_fields()
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "reports_to", "image"]
	for extra in EDITABLE_EMPLOYEE_FIELDS + ("people_wing", "people_division", "people_unit", "people_position", "branch"):
		if meta.has_field(extra) and extra not in fields:
			fields.append(extra)
	fields = [f for f in fields if f == "name" or meta.has_field(f)]
	row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	manager = frappe.db.get_value("Employee", row.get("reports_to"), "employee_name") if row.get("reports_to") else ""
	out = {k: (cstr(row.get(k)) if row.get(k) is not None else "") for k in fields}
	out.update(
		{
			"id": row.get("name") or employee,
			"name": row.get("employee_name") or employee,
			"photo": row.get("image") or "",
			"wing": row.get("people_wing") or "",
			"division": row.get("people_division") or "",
			"unit": row.get("people_unit") or row.get("branch") or "",
			"position": row.get("people_position") or "",
			"reports_to_name": manager or "",
		}
	)
	return out


def update_employee_detail(employee, values, photo_name=None, photo_data=None):
	import base64

	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	meta = frappe.get_meta("Employee")
	updates = {}
	for key in EDITABLE_EMPLOYEE_FIELDS:
		if key in values and meta.has_field(key):
			value = cstr(values.get(key)).strip()
			if key in ("date_of_birth", "date_of_joining") and not value:
				continue
			if key == "first_name" and not value:
				frappe.throw(_("First name is required"))
			updates[key] = value or None
	if any(k in updates for k in ("first_name", "middle_name", "last_name")):
		current = frappe.db.get_value("Employee", employee, ["first_name", "middle_name", "last_name"], as_dict=True) or {}
		parts = [updates.get(k, current.get(k)) for k in ("first_name", "middle_name", "last_name")]
		updates["employee_name"] = " ".join(p for p in parts if p)
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=True)
	if any(k in values for k in ("wing", "division", "department", "designation", "unit", "position", "reports_to")):
		assign_employee_org(
			employee,
			wing=values.get("wing") or "",
			division=values.get("division") or "",
			department=values.get("department") or "",
			designation=values.get("designation") or "",
			unit=values.get("unit") or "",
			position=values.get("position") or "",
			reports_to=values.get("reports_to") or "",
		)
	if photo_name and photo_data:
		raw = cstr(photo_data)
		if raw.startswith("data:") and "," in raw:
			raw = raw.split(",", 1)[1]
		content = base64.b64decode(raw)
		if len(content) > 2 * 1024 * 1024:
			frappe.throw(_("Photo must be 2 MB or less"))
		ext = (cstr(photo_name).rsplit(".", 1)[-1] or "").lower()
		if ext not in ("jpg", "jpeg", "png", "webp"):
			frappe.throw(_("Use a JPG or PNG photo"))
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"emp-photo-{employee}.{ext}",
				"content": content,
				"is_private": 0,
				"attached_to_doctype": "Employee",
				"attached_to_name": employee,
				"attached_to_field": "image",
			}
		)
		file_doc.insert(ignore_permissions=True)
		frappe.db.set_value("Employee", employee, "image", file_doc.file_url, update_modified=True)
	frappe.db.commit()
	return employee_detail(employee)


@frappe.whitelist(allow_guest=True)
def get_people_employee_detail(employee=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	if not is_people_manager(_user_roles()):
		return _error(_("HR manager access required"), 403)
	try:
		return _success(employee_detail(_parse_request_value("employee", employee)))
	except frappe.ValidationError as exc:
		return _error(cstr(exc))


@frappe.whitelist(allow_guest=True)
def update_people_employee_detail(employee=None, values=None, photo_name=None, photo_data=None, sid=None):
	import json

	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	if not is_people_manager(_user_roles()):
		return _error(_("HR manager access required"), 403)
	try:
		raw = _parse_request_value("values", values) or "{}"
		data = json.loads(raw) if isinstance(raw, str) else dict(raw)
		saved = update_employee_detail(
			_parse_request_value("employee", employee),
			data,
			photo_name=_parse_request_value("photo_name", photo_name),
			photo_data=_parse_request_value("photo_data", photo_data),
		)
		return _success(saved, message=_("Employee updated"))
	except (frappe.ValidationError, ValueError) as exc:
		return _error(cstr(exc))
	except Exception as exc:
		frappe.log_error(title="update_people_employee_detail", message=frappe.get_traceback())
		return _error(f"{type(exc).__name__}: {exc}")


@frappe.whitelist(allow_guest=True)
def get_people_org(sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _require_people_hrms_access, _success, _user_roles

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

		roles = _user_roles()
		try:
			data = org_tree()
		except Exception as exc:
			frappe.log_error(title="get_people_org", message=frappe.get_traceback())
			data = {"masters": [], "wings": [], "divisions": [], "departments": [], "designations": [], "units": [], "positions": [], "note": f"{type(exc).__name__}: {exc}"}
		data["can_edit"] = bool(is_people_manager(roles))
		try:
			data["employees"] = list_org_employees(frappe.session.user, roles)
		except Exception as exc:
			frappe.log_error(title="get_people_org employees", message=frappe.get_traceback())
			data["employees"] = []
			data["note"] = f"{type(exc).__name__}: {exc}"
		try:
			data["me"] = employee_org_for_user(frappe.session.user)
		except Exception:
			data["me"] = {}
		return _success(data)
	except Exception as exc:
		frappe.log_error(title="get_people_org", message=frappe.get_traceback())
		return _error(f"{type(exc).__name__}: {exc}" or "Could not load WDD")


@frappe.whitelist(allow_guest=True)
def save_people_org_master(kind=None, title=None, wing=None, division=None, department=None, designation=None, unit=None, active=1, name=None, parent_master=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	if not is_people_manager(_user_roles()):
		return _error(_("HR manager access required"), 403)
	try:
		parent = _parse_request_value("parent_master", parent_master) or ""
		row_name = _parse_request_value("name", name) or None
		kind_value = _parse_request_value("kind", kind)
		if row_name or parent or _normalise_kind(kind_value) == "Wing":
			saved = save_master_with_parent(
				kind_value,
				_parse_request_value("title", title),
				parent_master=parent,
				active=_parse_request_value("active", active),
				name=row_name,
			)
			return _success(saved, message=_("Saved"))
		saved = save_org_master(
			_parse_request_value("kind", kind),
			_parse_request_value("title", title),
			wing=_parse_request_value("wing", wing) or "",
			division=_parse_request_value("division", division) or "",
			department=_parse_request_value("department", department) or "",
			designation=_parse_request_value("designation", designation) or "",
			unit=_parse_request_value("unit", unit) or "",
			active=_parse_request_value("active", active),
			name=_parse_request_value("name", name) or None,
		)
		return _success(saved, message=_("Saved"))
	except frappe.ValidationError as exc:
		return _error(cstr(exc))


@frappe.whitelist(allow_guest=True)
def assign_people_employee_org(employee=None, wing=None, division=None, department=None, designation=None, unit=None, position=None, reports_to=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	if not is_people_manager(_user_roles()):
		return _error(_("HR manager access required"), 403)
	try:
		saved = assign_employee_org(
			_parse_request_value("employee", employee),
			wing=_parse_request_value("wing", wing) or "",
			division=_parse_request_value("division", division) or "",
			department=_parse_request_value("department", department) or "",
			designation=_parse_request_value("designation", designation) or "",
			unit=_parse_request_value("unit", unit) or "",
			position=_parse_request_value("position", position) or "",
			reports_to=_parse_request_value("reports_to", reports_to) or "",
		)
		return _success(saved, message=_("Employee organization updated"))
	except frappe.ValidationError as exc:
		return _error(cstr(exc))
