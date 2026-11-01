"""Phase 97 — Lab analyzer Item master, ERPNext Asset bridge, periodic PM.

Maps machine models (EM200, BC-6200, …) to:
- Item (Lab Equipment group, fixed asset)
- Lab Equipment registry (NABL QC layer from Phase 62)
- ERPNext Asset (when Asset doctype is available)

Periodic maintenance is tracked via Equipment Maintenance records and
next_maintenance_due on Lab Equipment (default every 3 months).
"""

from __future__ import annotations

import os
import re

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, getdate, today

EQUIPMENT_ITEM_GROUP = "Lab Equipment"
ASSET_CATEGORY = "Lab Analyzers"
DEFAULT_PM_INTERVAL_MONTHS = 3
DEFAULT_CAL_INTERVAL_MONTHS = 12

PM_CHECKLIST_ANALYZER = (
	"Probe / cuvette wash cycle verified\n"
	"Waste bottle levels checked\n"
	"Reagent cooler temperature verified\n"
	"Optical / photometer blank check\n"
	"Software version & LIS connectivity logged"
)

PM_CHECKLIST_HAEM = (
	"Sheath fluid / diluent levels checked\n"
	"Waste container emptied\n"
	"Optics / flow cell inspection\n"
	"QC material run logged\n"
	"LIS bidirectional check"
)

# Catalog aligned with clinical_phase96_method_machine machine names.
MACHINE_CATALOG = (
	{
		"machine_name": "EM200",
		"item_code": "EQP-EM200",
		"item_name": "Erba EM200 Clinical Chemistry Analyzer",
		"manufacturer": "Erba Mannheim",
		"model": "EM200",
		"asset_tag": "BIO-EM200",
		"equipment_name": "Biochemistry Analyzer (EM200)",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.5 Analyzer/Simulator",
		"location": "Biochemistry Bay",
		"lis_aliases": ("EM200", "EM 200"),
		"calibration_interval_months": 12,
		"maintenance_interval_months": 3,
		"pm_checklist": PM_CHECKLIST_ANALYZER,
		"purchase_rate": 850000,
	},
	{
		"machine_name": "BC-6200",
		"item_code": "EQP-BC6200",
		"item_name": "Mindray BC-6200 Haematology Analyzer",
		"manufacturer": "Mindray",
		"model": "BC-6200",
		"asset_tag": "HEM-BC6200",
		"equipment_name": "Haematology Analyzer (BC-6200)",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.5 Analyzer/Simulator",
		"location": "Haematology Bay",
		"lis_aliases": ("BC-6200", "BC6200"),
		"calibration_interval_months": 12,
		"maintenance_interval_months": 3,
		"pm_checklist": PM_CHECKLIST_HAEM,
		"purchase_rate": 650000,
	},
	{
		"machine_name": "D-10",
		"item_code": "EQP-D10",
		"item_name": "Bio-Rad D-10 HbA1c Analyzer",
		"manufacturer": "Bio-Rad",
		"model": "D-10",
		"asset_tag": "BIO-D10",
		"equipment_name": "HbA1c Analyzer (D-10)",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.5 Analyzer/Simulator",
		"location": "Biochemistry Bay",
		"lis_aliases": ("D-10", "D10"),
		"calibration_interval_months": 12,
		"maintenance_interval_months": 6,
		"pm_checklist": PM_CHECKLIST_ANALYZER,
		"purchase_rate": 450000,
	},
	{
		"machine_name": "Cobas e411",
		"item_code": "EQP-COBAS-E411",
		"item_name": "Roche Cobas e411 Immunoassay Analyzer",
		"manufacturer": "Roche",
		"model": "Cobas e411",
		"asset_tag": "IMM-E411",
		"equipment_name": "Immunoassay Analyzer (Cobas e411)",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.5 Analyzer/Simulator",
		"location": "Immunology Bay",
		"lis_aliases": ("Cobas e411", "e411", "COBAS E411"),
		"calibration_interval_months": 12,
		"maintenance_interval_months": 3,
		"pm_checklist": PM_CHECKLIST_ANALYZER,
		"purchase_rate": 1200000,
	},
	{
		"machine_name": "Clinitek Status+",
		"item_code": "EQP-CLINITEK",
		"item_name": "Siemens Clinitek Status+ Urine Analyzer",
		"manufacturer": "Siemens",
		"model": "Clinitek Status+",
		"asset_tag": "URI-CLINITEK",
		"equipment_name": "Urine Analyzer (Clinitek Status+)",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.5 Analyzer/Simulator",
		"location": "Clinical Pathology",
		"lis_aliases": ("Clinitek Status+", "Clinitek"),
		"calibration_interval_months": 12,
		"maintenance_interval_months": 6,
		"pm_checklist": "Strip reader optics cleaned\nControl strip run logged\nPrinter / label check",
		"purchase_rate": 180000,
	},
)


def _norm(text):
	return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _import_doctype(folder, doctype_name, force=True):
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	app_path = frappe.get_app_path("health_ecosystem_core")
	candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg_root = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
	except Exception:
		pass
	for json_path in candidates:
		if os.path.isfile(json_path):
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype=doctype_name)
			if frappe.db.exists("DocType", doctype_name):
				return True
	return False


def _ensure_table(doctype):
	tab = f"tab{doctype}"
	if frappe.db.table_exists(tab):
		return True
	try:
		frappe.db.updatedb(doctype)
		if frappe.db.table_exists(tab):
			return True
	except Exception:
		frappe.log_error(title=f"updatedb_{doctype}", message=frappe.get_traceback())
	try:
		from frappe.model.meta import get_meta

		meta = get_meta(doctype)
		frappe.db.create_table(doctype, meta)
		return frappe.db.table_exists(tab)
	except Exception:
		frappe.log_error(title=f"create_table_{doctype}", message=frappe.get_traceback())
	return False


def ensure_calibration_record_type_field():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"Equipment Calibration": [
				{
					"fieldname": "record_type",
					"label": "Record Type",
					"fieldtype": "Select",
					"insert_after": "equipment",
					"default": "Calibration",
					"options": "Calibration\nPreventive Maintenance\nCorrective Maintenance",
					"in_list_view": 1,
				}
			]
		},
		update=True,
	)
	if not frappe.db.has_column("Equipment Calibration", "record_type"):
		frappe.db.add_column("Equipment Calibration", "record_type", "Data")
	frappe.clear_cache(doctype="Equipment Calibration")


def ensure_phase97_doctypes():
	_import_doctype("lab_equipment", "Lab Equipment", force=True)
	_import_doctype("equipment_maintenance", "Equipment Maintenance", force=True)
	ensure_calibration_record_type_field()
	for dt in ("Lab Equipment", "Equipment Maintenance"):
		try:
			frappe.reload_doctype(dt, force=True)
		except Exception:
			frappe.log_error(title=f"reload_{dt}", message=frappe.get_traceback())
	try:
		from frappe.model.sync import sync_for

		sync_for("equipment_maintenance", force=1)
	except Exception:
		frappe.log_error(title="sync_equipment_maintenance", message=frappe.get_traceback())
	for dt in ("Lab Equipment", "Equipment Maintenance"):
		_ensure_table(dt)
	frappe.db.commit()
	frappe.clear_cache()


def ensure_equipment_item_group():
	if frappe.db.exists("Item Group", EQUIPMENT_ITEM_GROUP):
		return EQUIPMENT_ITEM_GROUP
	parent = "All Item Groups"
	if not frappe.db.exists("Item Group", parent):
		parent = None
	doc = frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": EQUIPMENT_ITEM_GROUP,
			"parent_item_group": parent,
			"is_group": 0,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return EQUIPMENT_ITEM_GROUP


def ensure_asset_category():
	if not frappe.db.exists("DocType", "Asset Category"):
		return None
	if frappe.db.exists("Asset Category", ASSET_CATEGORY):
		return ASSET_CATEGORY
	# Reuse any existing category — creating one needs company GL accounts configured.
	existing = frappe.get_all("Asset Category", pluck="name", limit=1)
	if existing:
		return existing[0]
	company = _default_company()
	if not company:
		return None
	try:
		company_doc = frappe.get_doc("Company", company)
		accounts = []
		for field in (
			"fixed_asset_account",
			"accumulated_depreciation_account",
			"depreciation_expense_account",
		):
			acct = company_doc.get(field)
			if acct:
				accounts.append(
					{
						"company_name": company,
						"fixed_asset_account": acct,
						"accumulated_depreciation_account": acct,
						"depreciation_expense_account": acct,
					}
				)
				break
		if not accounts:
			return None
		doc = frappe.get_doc(
			{
				"doctype": "Asset Category",
				"asset_category_name": ASSET_CATEGORY,
				"accounts": accounts,
			}
		)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return ASSET_CATEGORY
	except Exception:
		frappe.log_error(title="ensure_asset_category", message=frappe.get_traceback())
		fallback = frappe.get_all("Asset Category", pluck="name", limit=1)
		return fallback[0] if fallback else None


def ensure_equipment_item(catalog_row):
	"""Create or update fixed-asset Item for an analyzer model."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	ensure_equipment_item_group()
	create_custom_fields(
		{
			"Item": [
				{
					"fieldname": "hec_machine_name",
					"label": "Analyzer Model",
					"fieldtype": "Data",
					"insert_after": "item_group",
					"description": "Lab analyzer model token (e.g. EM200) linked to Lab Equipment registry",
				}
			]
		},
		update=True,
	)
	code = catalog_row["item_code"]
	name = catalog_row["item_name"]
	rate = flt(catalog_row.get("purchase_rate") or 0) or 1
	fields = {
		"item_name": name,
		"item_group": EQUIPMENT_ITEM_GROUP,
		"stock_uom": "Nos",
		"is_stock_item": 0,
		"is_purchase_item": 1,
		"is_sales_item": 0,
		"description": f"{catalog_row.get('manufacturer')} {catalog_row.get('model')} — lab analyzer fixed asset",
	}
	meta = frappe.get_meta("Item")
	category = ensure_asset_category()
	if meta.has_field("is_fixed_asset") and category:
		fields["is_fixed_asset"] = 1
	if meta.has_field("asset_category") and category:
		fields["asset_category"] = category
	if meta.has_field("hec_machine_name"):
		fields["hec_machine_name"] = catalog_row["machine_name"]

	if frappe.db.exists("Item", code):
		frappe.db.set_value("Item", code, fields, update_modified=True)
		return code

	doc = frappe.get_doc({"doctype": "Item", "item_code": code, **fields})
	doc.insert(ignore_permissions=True)
	# Standard buying price for asset capitalization reference
	if frappe.db.exists("DocType", "Item Price"):
		company = _default_company()
		if company and not frappe.db.exists(
			"Item Price", {"item_code": code, "buying": 1, "price_list": "Standard Buying"}
		):
			try:
				frappe.get_doc(
					{
						"doctype": "Item Price",
						"item_code": code,
						"price_list": "Standard Buying",
						"buying": 1,
						"currency": frappe.defaults.get_global_default("currency") or "INR",
						"price_list_rate": rate,
					}
				).insert(ignore_permissions=True)
			except Exception:
				pass
	frappe.db.commit()
	return code


def _default_company():
	return frappe.defaults.get_global_default("company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)


def ensure_erp_asset_for_equipment(equipment_name):
	"""Create ERPNext Asset from Lab Equipment + Item when possible."""
	if not frappe.db.exists("DocType", "Asset"):
		return None
	eq = frappe.get_doc("Lab Equipment", equipment_name)
	if eq.erp_asset and frappe.db.exists("Asset", eq.erp_asset):
		return eq.erp_asset
	if not eq.item or not frappe.db.exists("Item", eq.item):
		return None
	company = _default_company()
	if not company:
		return None
	category = ensure_asset_category()
	existing = frappe.db.get_value("Asset", {"item_code": eq.item, "company": company}, "name")
	if existing:
		frappe.db.set_value("Lab Equipment", eq.name, "erp_asset", existing, update_modified=False)
		return existing
	purchase_date = getdate(eq.iq_date or today())
	amount = flt(
		frappe.db.get_value(
			"Item Price",
			{"item_code": eq.item, "buying": 1},
			"price_list_rate",
		)
		or 1
	)
	payload = {
		"doctype": "Asset",
		"asset_name": eq.equipment_name,
		"item_code": eq.item,
		"company": company,
		"location": eq.location or "",
		"purchase_date": purchase_date,
		"available_for_use_date": purchase_date,
		"gross_purchase_amount": amount,
		"is_existing_asset": 1,
	}
	if category:
		payload["asset_category"] = category
	if eq.serial_no:
		payload["serial_no"] = eq.serial_no
	try:
		asset = frappe.get_doc(payload)
		asset.insert(ignore_permissions=True)
		frappe.db.set_value("Lab Equipment", eq.name, "erp_asset", asset.name, update_modified=False)
		frappe.db.commit()
		return asset.name
	except Exception:
		frappe.log_error(title=f"ensure_erp_asset_{equipment_name}", message=frappe.get_traceback())
		return None


def sync_lab_equipment_from_catalog(force=False):
	"""Create/update Lab Equipment rows linked to Item master for each catalog model."""
	ensure_phase97_doctypes()
	created = []
	updated = []
	for row in MACHINE_CATALOG:
		item_code = ensure_equipment_item(row)
		existing = (
			frappe.db.get_value("Lab Equipment", {"asset_tag": row["asset_tag"]}, "name")
			or frappe.db.get_value("Lab Equipment", {"machine_name_alias": row["machine_name"]}, "name")
		)
		cal_on = getdate(today())
		cal_due = add_months(cal_on, cint(row.get("calibration_interval_months") or DEFAULT_CAL_INTERVAL_MONTHS))
		pm_due = add_months(cal_on, cint(row.get("maintenance_interval_months") or DEFAULT_PM_INTERVAL_MONTHS))
		lis_ref = (row.get("lis_aliases") or (row["machine_name"],))[0]
		payload = {
			"equipment_name": row["equipment_name"],
			"asset_tag": row["asset_tag"],
			"equipment_type": row.get("equipment_type") or "Analyzer",
			"nabl_product_group": row.get("nabl_product_group") or "2.7.5 Analyzer/Simulator",
			"location": row.get("location") or "",
			"status": "In Service",
			"safety_label": "Green",
			"manufacturer": row.get("manufacturer") or "",
			"model": row.get("model") or row["machine_name"],
			"item": item_code,
			"machine_name_alias": row["machine_name"],
			"lis_machine_reference": lis_ref,
			"calibration_interval_months": cint(row.get("calibration_interval_months") or DEFAULT_CAL_INTERVAL_MONTHS),
			"maintenance_interval_months": cint(row.get("maintenance_interval_months") or DEFAULT_PM_INTERVAL_MONTHS),
		}
		if existing:
			doc = frappe.get_doc("Lab Equipment", existing)
			changed = False
			for key, val in payload.items():
				cur = doc.get(key)
				should_set = force
				if not should_set:
					if isinstance(val, str):
						should_set = not (cur or "").strip()
					else:
						should_set = cur in (None, "", 0)
				if should_set and cur != val:
					doc.set(key, val)
					changed = True
			if not doc.last_calibration_on:
				doc.last_calibration_on = cal_on
				doc.next_calibration_due = cal_due
				changed = True
			if not doc.last_maintenance_on:
				doc.last_maintenance_on = cal_on
				doc.next_maintenance_due = pm_due
				changed = True
			if changed:
				doc.save(ignore_permissions=True)
				updated.append(doc.name)
			ensure_erp_asset_for_equipment(doc.name)
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Lab Equipment",
				**payload,
				"iq_date": cal_on,
				"oq_date": cal_on,
				"pq_date": cal_on,
				"last_calibration_on": cal_on,
				"next_calibration_due": cal_due,
				"last_maintenance_on": cal_on,
				"next_maintenance_due": pm_due,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
		ensure_erp_asset_for_equipment(doc.name)
		_seed_pm_record(doc.name, row)
	frappe.db.commit()
	return {"created": created, "updated": updated, "items": [r["item_code"] for r in MACHINE_CATALOG]}


def _seed_pm_record(equipment_name, catalog_row):
	if frappe.db.table_exists("tabEquipment Maintenance"):
		if frappe.get_all("Equipment Maintenance", filters={"equipment": equipment_name}, limit=1):
			return
		pm_on = getdate(today())
		pm_due = add_months(pm_on, cint(catalog_row.get("maintenance_interval_months") or DEFAULT_PM_INTERVAL_MONTHS))
		frappe.get_doc(
			{
				"doctype": "Equipment Maintenance",
				"equipment": equipment_name,
				"maintenance_date": pm_on,
				"due_date": pm_due,
				"maintenance_type": "Preventive",
				"outcome": "Completed",
				"performed_by": "System Seed",
				"checklist": catalog_row.get("pm_checklist") or PM_CHECKLIST_ANALYZER,
				"notes": "Phase 97 initial PM / commissioning",
			}
		).insert(ignore_permissions=True)
		return
	seed_pm_via_calibration(equipment_name, catalog_row)


def resolve_equipment_for_machine_name(machine_name):
	"""Return Lab Equipment name for a parameter machine_name token."""
	token = (machine_name or "").strip()
	if not token:
		return None
	by_alias = frappe.db.get_value("Lab Equipment", {"machine_name_alias": token}, "name")
	if by_alias:
		return by_alias
	by_model = frappe.db.get_value("Lab Equipment", {"model": token}, "name")
	if by_model:
		return by_model
	by_lis = frappe.db.get_value("Lab Equipment", {"lis_machine_reference": token}, "name")
	if by_lis:
		return by_lis
	norm = _norm(token)
	for row in MACHINE_CATALOG:
		if _norm(row["machine_name"]) == norm:
			return frappe.db.get_value("Lab Equipment", {"asset_tag": row["asset_tag"]}, "name")
		for alias in row.get("lis_aliases") or ():
			if _norm(alias) == norm:
				return frappe.db.get_value("Lab Equipment", {"asset_tag": row["asset_tag"]}, "name")
	return None


def apply_calibration_to_equipment(cal_doc):
	"""Roll Lab Equipment calibration dates forward from a calibration record."""
	if not cal_doc.equipment:
		return
	eq = frappe.get_doc("Lab Equipment", cal_doc.equipment)
	cal_on = getdate(cal_doc.calibration_date or today())
	due = getdate(cal_doc.due_date) if cal_doc.due_date else add_months(
		cal_on, cint(eq.calibration_interval_months or DEFAULT_CAL_INTERVAL_MONTHS)
	)
	frappe.db.set_value(
		"Lab Equipment",
		eq.name,
		{"last_calibration_on": cal_on, "next_calibration_due": due},
		update_modified=True,
	)


def apply_maintenance_to_equipment_from_calibration(cal_doc):
	"""Treat Equipment Calibration PM rows as periodic maintenance logs."""
	if not cal_doc.equipment:
		return
	eq = frappe.get_doc("Lab Equipment", cal_doc.equipment)
	pm_on = getdate(cal_doc.calibration_date or today())
	due = getdate(cal_doc.due_date) if cal_doc.due_date else add_months(
		pm_on, cint(eq.maintenance_interval_months or DEFAULT_PM_INTERVAL_MONTHS)
	)
	frappe.db.set_value(
		"Lab Equipment",
		eq.name,
		{"last_maintenance_on": pm_on, "next_maintenance_due": due},
		update_modified=True,
	)


def seed_pm_via_calibration(equipment_name, catalog_row):
	"""Fallback PM seed using Equipment Calibration when PM doctype table unavailable."""
	if frappe.get_all(
		"Equipment Calibration",
		filters={"equipment": equipment_name, "record_type": "Preventive Maintenance"},
		limit=1,
	):
		return
	pm_on = getdate(today())
	pm_due = add_months(pm_on, cint(catalog_row.get("maintenance_interval_months") or DEFAULT_PM_INTERVAL_MONTHS))
	frappe.get_doc(
		{
			"doctype": "Equipment Calibration",
			"equipment": equipment_name,
			"record_type": "Preventive Maintenance",
			"calibration_date": pm_on,
			"due_date": pm_due,
			"outcome": "Accepted",
			"calibrating_cab": "In-house",
			"notes": catalog_row.get("pm_checklist") or PM_CHECKLIST_ANALYZER,
		}
	).insert(ignore_permissions=True)


def apply_maintenance_to_equipment(pm_doc):
	"""Roll Lab Equipment PM dates forward from a maintenance record."""
	if not pm_doc.equipment:
		return
	eq = frappe.get_doc("Lab Equipment", pm_doc.equipment)
	pm_on = getdate(pm_doc.maintenance_date or today())
	due = getdate(pm_doc.due_date) if pm_doc.due_date else add_months(
		pm_on, cint(eq.maintenance_interval_months or DEFAULT_PM_INTERVAL_MONTHS)
	)
	frappe.db.set_value(
		"Lab Equipment",
		eq.name,
		{"last_maintenance_on": pm_on, "next_maintenance_due": due},
		update_modified=True,
	)


def list_overdue_maintenance():
	if not frappe.db.exists("DocType", "Lab Equipment"):
		return []
	if not frappe.get_meta("Lab Equipment").has_field("next_maintenance_due"):
		return []
	rows = frappe.get_all(
		"Lab Equipment",
		filters={"status": "In Service"},
		fields=[
			"name",
			"equipment_name",
			"asset_tag",
			"next_maintenance_due",
			"machine_name_alias",
			"item",
			"erp_asset",
		],
	)
	out = []
	today_d = getdate(today())
	for r in rows:
		if r.next_maintenance_due and getdate(r.next_maintenance_due) < today_d:
			out.append({**r, "reason": "PM overdue"})
	return out


def list_equipment_compliance():
	"""Merge calibration + PM overdue lists for dashboards and gates."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase62_nabl_112a_qc import (
		list_overdue_equipment,
	)

	cal = list_overdue_equipment()
	pm = list_overdue_maintenance()
	seen = set()
	merged = []
	for row in cal + pm:
		key = row.get("name")
		if key in seen:
			continue
		seen.add(key)
		merged.append(row)
	return merged


def run_daily_equipment_asset_reminders():
	"""Daily job — ToDo for admins when calibration or PM is due within 7 days or overdue."""
	if not frappe.db.exists("DocType", "Lab Equipment"):
		return {"ok": True, "todos": 0}
	if not frappe.db.exists("DocType", "ToDo"):
		return {"ok": True, "todos": 0}
	from frappe.utils import add_days

	soon = add_days(today(), 7)
	rows = frappe.get_all(
		"Lab Equipment",
		filters={"status": "In Service"},
		fields=["name", "equipment_name", "next_calibration_due", "next_maintenance_due"],
	)
	todos = 0
	for r in rows:
		alerts = []
		if r.next_calibration_due and getdate(r.next_calibration_due) <= getdate(soon):
			alerts.append(f"cal due {r.next_calibration_due}")
		if r.next_maintenance_due and getdate(r.next_maintenance_due) <= getdate(soon):
			alerts.append(f"PM due {r.next_maintenance_due}")
		if not alerts:
			continue
		subject = f"Lab equipment: {r.equipment_name} — {', '.join(alerts)}"
		if frappe.db.exists("ToDo", {"reference_type": "Lab Equipment", "reference_name": r.name, "status": "Open"}):
			continue
		try:
			frappe.get_doc(
				{
					"doctype": "ToDo",
					"description": subject,
					"reference_type": "Lab Equipment",
					"reference_name": r.name,
					"priority": "Medium",
					"status": "Open",
					"allocated_to": _maintenance_owner(),
				}
			).insert(ignore_permissions=True)
			todos += 1
		except Exception:
			frappe.log_error(title="equipment_todo", message=frappe.get_traceback())
	frappe.db.commit()
	return {"ok": True, "todos": todos}


def _maintenance_owner():
	for role in ("Health System Admin", "Lab Technician", "System Manager"):
		user = frappe.db.get_value("Has Role", {"role": role, "parenttype": "User"}, "parent")
		if user and user != "Guest":
			return user
	return None


def setup_phase97(force=False):
	ensure_phase97_doctypes()
	ensure_equipment_item_group()
	try:
		ensure_asset_category()
	except Exception:
		frappe.log_error(title="setup_phase97_asset_category", message=frappe.get_traceback())
	sync = sync_lab_equipment_from_catalog(force=force)
	frappe.clear_cache()
	return {"ok": True, "phase": 97, "sync": sync}


def smoke_phase97():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase97()
	check("setup", setup.get("ok"), str(setup))
	check("equipment_maintenance_dt", frappe.db.exists("DocType", "Equipment Maintenance"))
	em200_item = frappe.db.exists("Item", "EQP-EM200")
	check("em200_item", em200_item)
	eq = resolve_equipment_for_machine_name("EM200")
	check("resolve_em200", bool(eq), eq or "")
	if eq:
		item = frappe.db.get_value("Lab Equipment", eq, "item")
		check("em200_item_link", item == "EQP-EM200", item or "")
		if frappe.db.table_exists("tabEquipment Maintenance"):
			pm = frappe.db.count("Equipment Maintenance", {"equipment": eq})
			check("em200_pm_rows", pm >= 1, f"count={pm}")
		else:
			pm = frappe.db.count(
				"Equipment Calibration",
				{"equipment": eq, "record_type": "Preventive Maintenance"},
			)
			check("em200_pm_rows", pm >= 1, f"cal_pm_count={pm}")
	return result


@frappe.whitelist()
def run_phase97_setup(force=0):
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(setup_phase97(force=cint(force)))


@frappe.whitelist()
def run_phase97_smoke():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(smoke_phase97())


@frappe.whitelist()
def submit_equipment_maintenance(
	equipment=None,
	maintenance_type=None,
	checklist=None,
	notes=None,
	performed_by=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	equipment = _parse_request_value("equipment", equipment)
	if not equipment:
		return _error("equipment required")
	pm_on = getdate(today())
	eq = frappe.get_doc("Lab Equipment", equipment)
	due = add_months(pm_on, cint(eq.maintenance_interval_months or DEFAULT_PM_INTERVAL_MONTHS))
	doc = frappe.get_doc(
		{
			"doctype": "Equipment Maintenance",
			"equipment": equipment,
			"maintenance_date": pm_on,
			"due_date": due,
			"maintenance_type": _parse_request_value("maintenance_type", maintenance_type) or "Preventive",
			"outcome": "Completed",
			"performed_by": _parse_request_value("performed_by", performed_by) or frappe.session.user,
			"checklist": _parse_request_value("checklist", checklist) or PM_CHECKLIST_ANALYZER,
			"notes": _parse_request_value("notes", notes),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"maintenance": doc.name, "next_due": str(due)})
