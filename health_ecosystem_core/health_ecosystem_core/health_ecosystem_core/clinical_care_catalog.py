"""Remedium Care service catalogue: diagnostic test master (X-ray, USG, ECG, NCV, ...) plus the
physiotherapy and consultation items the care portal (care.e-remedium.in) bills.

Each HEC Diagnostic Test is backed by a sales Item in the "Diagnostics" item-group tree, so it can be
billed anywhere in ERPNext; its price lives in the default selling price list. The care portal creates
and edits tests through save_care_diagnostic_test and reads everything through get_care_service_catalog.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

DIAG_DT = "HEC Diagnostic Test"
ROOT_GROUP = "All Item Groups"
DIAG_GROUP = "Diagnostics"
PHYSIO_GROUP = "Physiotherapy & Rehabilitation"
CONSULT_GROUP = "Services"

# Modality -> department (department doubles as the Item Group under "Diagnostics").
MODALITIES = {
	"X-Ray": "Radiology & Imaging",
	"Ultrasound (USG)": "Radiology & Imaging",
	"Doppler": "Radiology & Imaging",
	"CT Scan": "Radiology & Imaging",
	"MRI": "Radiology & Imaging",
	"Mammography": "Radiology & Imaging",
	"DEXA / BMD": "Radiology & Imaging",
	"OPG / Dental X-Ray": "Radiology & Imaging",
	"ECG": "Cardiology",
	"2D Echo": "Cardiology",
	"TMT": "Cardiology",
	"Holter": "Cardiology",
	"ABPM": "Cardiology",
	"NCV": "Neurology",
	"EMG": "Neurology",
	"EEG": "Neurology",
	"Evoked Potentials (VEP / BERA)": "Neurology",
	"PFT / Spirometry": "Pulmonology",
	"Audiometry": "Other Diagnostics",
	"Other": "Other Diagnostics",
}
DEPARTMENTS = ("Radiology & Imaging", "Cardiology", "Neurology", "Pulmonology", "Other Diagnostics")
EDIT_LEVELS = {"create": 2, "edit": 3, "approve": 4, "manage": 5}


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_mobile_auth, _success

	return _error, _parse_request_value, _require_mobile_auth, _success


def _ensure_setup():
	if not frappe.db.exists("Item Group", DIAG_GROUP):
		frappe.get_doc({"doctype": "Item Group", "item_group_name": DIAG_GROUP, "parent_item_group": ROOT_GROUP, "is_group": 1}).insert(ignore_permissions=True)
	for dept in DEPARTMENTS:
		if not frappe.db.exists("Item Group", dept):
			frappe.get_doc({"doctype": "Item Group", "item_group_name": dept, "parent_item_group": DIAG_GROUP, "is_group": 0}).insert(ignore_permissions=True)
	if frappe.db.exists("DocType", DIAG_DT):
		return
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": DIAG_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"autoname": "field:code",
			"naming_rule": "By fieldname",
			"engine": "InnoDB",
			"track_changes": 1,
			"title_field": "test_name",
			"search_fields": "test_name,modality,department",
			"fields": [
				{"fieldname": "test_name", "label": "Test Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "code", "label": "Code", "fieldtype": "Data", "reqd": 1, "unique": 1},
				{"fieldname": "modality", "label": "Modality", "fieldtype": "Select", "options": "\n".join(MODALITIES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "department", "label": "Department", "fieldtype": "Select", "options": "\n".join(DEPARTMENTS), "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "body_part", "label": "Body Part / Region", "fieldtype": "Data"},
				{"fieldname": "item", "label": "Billing Item", "fieldtype": "Link", "options": "Item", "read_only": 1},
				{"fieldname": "rate", "label": "Rate", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "mrp", "label": "MRP", "fieldtype": "Currency"},
				{"fieldname": "tat_hours", "label": "Report Turnaround (hours)", "fieldtype": "Int"},
				{"fieldname": "duration_min", "label": "Procedure Time (minutes)", "fieldtype": "Int"},
				{"fieldname": "needs_reporting_doctor", "label": "Reported by Doctor / Radiologist", "fieldtype": "Check", "default": "1"},
				{"fieldname": "preparation", "label": "Patient Preparation", "fieldtype": "Small Text"},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "disabled", "label": "Disabled", "fieldtype": "Check", "default": "0", "in_standard_filter": 1},
				{"fieldname": "source_portal", "label": "Created From", "fieldtype": "Data", "read_only": 1},
			],
			"permissions": [
				{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
				for role in ("System Manager", "Care Manager")
			]
			+ [{"role": "Care Staff", "read": 1}],
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=DIAG_DT)
	frappe.db.commit()


def _price_list():
	return frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"


def _item_rate(item_code, fallback):
	price = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": _price_list(), "selling": 1}, "price_list_rate")
	return flt(price) if price is not None else flt(fallback)


def _set_item_price(item_code, rate):
	price_list = _price_list()
	name = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": price_list})
	if name:
		frappe.db.set_value("Item Price", name, "price_list_rate", rate)
	else:
		frappe.get_doc({"doctype": "Item Price", "item_code": item_code, "price_list": price_list, "price_list_rate": rate, "selling": 1}).insert(ignore_permissions=True)


def _slug(text):
	return re.sub(r"-+", "-", re.sub(r"[^A-Z0-9]+", "-", cstr(text).upper())).strip("-")[:100]


def _row(d):
	return {
		"code": d.name,
		"item": d.item,
		"test_name": d.test_name,
		"modality": d.modality,
		"department": d.department,
		"body_part": d.body_part,
		"rate": _item_rate(d.item, d.rate) if d.item else flt(d.rate),
		"mrp": flt(d.mrp) or None,
		"tat_hours": cint(d.tat_hours) or None,
		"duration_min": cint(d.duration_min) or None,
		"needs_reporting_doctor": cint(d.needs_reporting_doctor),
		"preparation": d.preparation,
		"description": d.description,
		"disabled": cint(d.disabled),
	}


def catalog():
	fields = ["name", "item", "test_name", "modality", "department", "body_part", "rate", "mrp", "tat_hours", "duration_min", "needs_reporting_doctor", "preparation", "description", "disabled"]
	diagnostics = []
	if frappe.db.exists("DocType", DIAG_DT):
		diagnostics = [_row(d) for d in frappe.get_all(DIAG_DT, fields=fields, order_by="department asc, test_name asc", limit_page_length=0)]

	def items(filters):
		rows = frappe.get_all("Item", filters={"disabled": 0, "is_sales_item": 1, **filters}, fields=["name", "item_name", "item_group", "standard_rate", "description"], order_by="item_name asc", limit_page_length=0)
		return [{"code": r.name, "name": r.item_name, "group": r.item_group, "rate": _item_rate(r.name, r.standard_rate), "description": r.description} for r in rows]

	return {
		"diagnostics": diagnostics,
		"physiotherapy": items({"item_group": PHYSIO_GROUP}),
		"consultation": items({"item_group": CONSULT_GROUP, "item_name": ("like", "%consult%")}),
		"modalities": MODALITIES,
		"departments": list(DEPARTMENTS),
		"price_list": _price_list(),
	}


def _can_edit(level_needed):
	from health_ecosystem_core.health_ecosystem_core.clinical_people_access import my_permissions

	perms = my_permissions()
	if perms.get("exempt"):
		return True
	level = ((perms.get("portal_modules") or {}).get("care") or {}).get("Diagnostics", {}).get("level", "none")
	return EDIT_LEVELS.get(level, 0) >= EDIT_LEVELS[level_needed]


def save_test(data):
	_ensure_setup()
	code = cstr(data.get("code")).strip()
	existing = frappe.get_doc(DIAG_DT, code) if code and frappe.db.exists(DIAG_DT, code) else None
	if not _can_edit("edit" if existing else "create"):
		raise frappe.PermissionError(_("You need Diagnostics access in the Care Backend portal to change the test master"))

	name = cstr(data.get("test_name")).strip()
	if not name:
		frappe.throw(_("Test name is required"))
	modality = cstr(data.get("modality")).strip()
	if modality not in MODALITIES:
		frappe.throw(_("Choose a valid modality"))
	department = cstr(data.get("department")).strip() or MODALITIES[modality]
	if department not in DEPARTMENTS:
		department = MODALITIES[modality]
	rate = flt(data.get("rate"))
	if rate < 0:
		frappe.throw(_("Rate cannot be negative"))
	values = {
		"test_name": name[:140],
		"modality": modality,
		"department": department,
		"body_part": cstr(data.get("body_part")).strip()[:140],
		"rate": rate,
		"mrp": flt(data.get("mrp")) or None,
		"tat_hours": cint(data.get("tat_hours")) or None,
		"duration_min": cint(data.get("duration_min")) or None,
		"needs_reporting_doctor": 1 if cint(data.get("needs_reporting_doctor", 1)) else 0,
		"preparation": cstr(data.get("preparation")).strip()[:1000],
		"description": cstr(data.get("description")).strip()[:1000],
		"disabled": 1 if cint(data.get("disabled")) else 0,
	}

	if existing:
		doc = existing
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		base = "DX-" + _slug(f"{modality} {name}")
		code = base
		n = 2
		while frappe.db.exists(DIAG_DT, code) or frappe.db.exists("Item", code):
			code = f"{base}-{n}"
			n += 1
		doc = frappe.get_doc({"doctype": DIAG_DT, "code": code, "source_portal": "care.e-remedium.in", **values})
		doc.insert(ignore_permissions=True)

	item_values = {
		"item_name": values["test_name"],
		"item_group": department,
		"description": values["description"] or f"{modality}{' – ' + values['body_part'] if values['body_part'] else ''}",
		"disabled": values["disabled"],
		"standard_rate": rate,
	}
	if doc.item and frappe.db.exists("Item", doc.item):
		item = frappe.get_doc("Item", doc.item)
		item.update(item_values)
		item.save(ignore_permissions=True)
		_set_item_price(item.name, rate)
	else:
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": doc.name,
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
				"include_item_in_manufacturing": 0,
				**item_values,
			}
		)
		item.insert(ignore_permissions=True)
		_set_item_price(item.name, rate)
		frappe.db.set_value(DIAG_DT, doc.name, "item", item.name, update_modified=False)
	frappe.db.commit()
	return _row(frappe.get_doc(DIAG_DT, doc.name))


def _run(fn, *args):
	_error, _parse, _require, _success = _api()
	try:
		return _success(fn(*args))
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="care_catalog", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


@frappe.whitelist(allow_guest=True)
def get_care_service_catalog():
	"""Published diagnostic, physiotherapy and consultation price list (read-only, like the lab test catalogue)."""
	return _run(catalog)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_care_diagnostic_test(sid=None, test=None):
	_error, _parse, _require, _success = _api()
	if not _require(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	raw = _parse("test", test) or "{}"
	try:
		data = frappe.parse_json(raw) if isinstance(raw, str) else dict(raw)
	except Exception:
		return _error(_("Invalid test data"))
	return _run(save_test, data or {})


def setup_care_catalog():
	"""bench execute health_ecosystem_core.health_ecosystem_core.clinical_care_catalog.setup_care_catalog"""
	_ensure_setup()
	return {"doctype": DIAG_DT, "groups": [DIAG_GROUP, *DEPARTMENTS], "at": str(now_datetime())}
