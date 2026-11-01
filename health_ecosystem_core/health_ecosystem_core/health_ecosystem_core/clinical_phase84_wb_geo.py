"""
Phase 84: West Bengal geographic master (postal / administrative directory).

ERPNext stores the full district → subdivision → block → PIN directory.
RFMS uses it for territory picklists; Reach uses it for territorial sales analysis.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import frappe
from frappe import _
from frappe.utils import cstr, today


DOCTYPE = "HEC WB Postal Locality"


def _geo_key(district: str, subdivision: str, block_area: str, pincode: str) -> str:
	return "|".join(
		[
			cstr(district).strip(),
			cstr(subdivision).strip(),
			cstr(block_area).strip(),
			cstr(pincode).strip(),
		]
	)


def ensure_wb_postal_locality_doctype() -> None:
	"""Create DocType on hot-deploy when migrate is blocked."""
	if frappe.db.exists("DocType", DOCTYPE):
		return
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": DOCTYPE,
			"module": "Health Ecosystem Core",
			"custom": 0,
			"autoname": "hash",
			"naming_rule": "Random",
			"engine": "InnoDB",
			"track_changes": 1,
			"allow_import": 1,
			"fields": [
				{"fieldname": "state", "label": "State", "fieldtype": "Data", "reqd": 1, "default": "West Bengal", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "district", "label": "District", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "subdivision", "label": "Subdivision", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "block_area", "label": "Block / Administrative Area", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "column_break_1", "fieldtype": "Column Break"},
				{"fieldname": "pincode", "label": "PIN Code", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "post_office", "label": "Primary Post Office", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "is_active", "label": "Active", "fieldtype": "Check", "default": "1"},
				{"fieldname": "geo_key", "label": "Geo Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
				{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
				{"role": "Sales Manager", "read": 1, "export": 1, "report": 1},
				{"role": "Sales Representative", "read": 1, "export": 1, "report": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.clear_cache(doctype=DOCTYPE)


def ensure_lead_geo_fields() -> None:
	"""Add district/subdivision/pincode on Franchise Sales Lead if missing."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	meta = frappe.get_meta("Franchise Sales Lead")
	needed = []
	if not meta.has_field("district"):
		needed.append(
			{
				"fieldname": "district",
				"label": "District",
				"fieldtype": "Data",
				"insert_after": "city",
				"in_standard_filter": 1,
			}
		)
	if not meta.has_field("subdivision"):
		needed.append(
			{
				"fieldname": "subdivision",
				"label": "Subdivision",
				"fieldtype": "Data",
				"insert_after": "district",
			}
		)
	if not meta.has_field("pincode"):
		needed.append(
			{
				"fieldname": "pincode",
				"label": "PIN Code",
				"fieldtype": "Data",
				"insert_after": "subdivision",
				"in_standard_filter": 1,
			}
		)
	if needed:
		create_custom_fields({"Franchise Sales Lead": needed}, update=True)


def _default_json_paths() -> list[Path]:
	here = Path(__file__).resolve()
	candidates = [
		Path("/opt/health-ecosystem/docker/data/wb-postal-directory-v2.json"),
		Path("/tmp/wb-postal-directory-v2.json"),
		here.parents[3] / "docker" / "data" / "wb-postal-directory-v2.json",
		here.parents[4] / "docker" / "data" / "wb-postal-directory-v2.json",
	]
	env = cstr(frappe.conf.get("wb_postal_directory_json") or os.environ.get("WB_POSTAL_DIRECTORY_JSON") or "").strip()
	if env:
		candidates.insert(0, Path(env))
	return candidates


def load_directory_rows(path: str | None = None) -> list[dict[str, Any]]:
	paths = [Path(path)] if path else _default_json_paths()
	for candidate in paths:
		try:
			if candidate and candidate.is_file():
				payload = json.loads(candidate.read_text(encoding="utf-8"))
				rows = payload.get("rows") if isinstance(payload, dict) else payload
				if isinstance(rows, list) and rows:
					return [r for r in rows if isinstance(r, dict)]
		except Exception:
			continue
	frappe.throw(_("WB postal directory JSON not found. Place wb-postal-directory-v2.json under docker/data/."))


def import_wb_postal_directory(path: str | None = None) -> dict[str, Any]:
	ensure_wb_postal_locality_doctype()
	rows = load_directory_rows(path)
	created = updated = skipped = 0
	for row in rows:
		district = cstr(row.get("district")).strip()
		subdivision = cstr(row.get("subdivision")).strip()
		block_area = cstr(row.get("block_area")).strip()
		pincode = cstr(row.get("pincode")).strip()
		if not (district and subdivision and block_area and pincode):
			skipped += 1
			continue
		key = _geo_key(district, subdivision, block_area, pincode)
		existing = frappe.db.get_value(DOCTYPE, {"geo_key": key}, "name")
		values = {
			"state": cstr(row.get("state") or "West Bengal").strip() or "West Bengal",
			"district": district,
			"subdivision": subdivision,
			"block_area": block_area,
			"pincode": pincode,
			"post_office": cstr(row.get("post_office") or "").strip(),
			"is_active": 1 if row.get("is_active", 1) else 0,
			"geo_key": key,
		}
		if existing:
			doc = frappe.get_doc(DOCTYPE, existing)
			changed = False
			for field, value in values.items():
				if doc.get(field) != value:
					doc.set(field, value)
					changed = True
			if changed:
				doc.save(ignore_permissions=True)
				updated += 1
			else:
				skipped += 1
		else:
			doc = frappe.get_doc({"doctype": DOCTYPE, **values})
			doc.insert(ignore_permissions=True)
			created += 1
	frappe.db.commit()
	return {
		"ok": True,
		"created": created,
		"updated": updated,
		"skipped": skipped,
		"total_rows": len(rows),
		"db_count": frappe.db.count(DOCTYPE),
	}


def get_wb_geo_hierarchy_payload() -> dict[str, Any]:
	ensure_wb_postal_locality_doctype()
	rows = frappe.get_all(
		DOCTYPE,
		filters={"is_active": 1},
		fields=["district", "subdivision", "block_area", "pincode", "post_office"],
		order_by="district asc, subdivision asc, block_area asc, pincode asc",
		limit_page_length=10000,
	)
	districts: dict[str, Any] = {}
	for row in rows:
		d = row.district
		s = row.subdivision
		districts.setdefault(d, {"name": d, "subdivisions": {}})
		subs = districts[d]["subdivisions"]
		subs.setdefault(s, {"name": s, "localities": []})
		subs[s]["localities"].append(
			{
				"block_area": row.block_area,
				"pincode": row.pincode,
				"post_office": row.post_office or "",
			}
		)
	hierarchy = []
	for dname in sorted(districts.keys()):
		dnode = districts[dname]
		sub_list = []
		for sname in sorted(dnode["subdivisions"].keys()):
			snode = dnode["subdivisions"][sname]
			sub_list.append({"name": sname, "localities": snode["localities"]})
		hierarchy.append({"name": dname, "subdivisions": sub_list})
	return {
		"state": "West Bengal",
		"districts": hierarchy,
		"count": len(rows),
	}


def resolve_wb_pincode_payload(pincode: str) -> dict[str, Any]:
	ensure_wb_postal_locality_doctype()
	pin = cstr(pincode).strip()
	if not pin:
		frappe.throw(_("pincode is required"))
	rows = frappe.get_all(
		DOCTYPE,
		filters={"pincode": pin, "is_active": 1},
		fields=["district", "subdivision", "block_area", "pincode", "post_office", "state"],
		order_by="district asc, subdivision asc",
		limit_page_length=50,
	)
	return {"pincode": pin, "matches": rows, "count": len(rows)}


def get_territorial_sales_summary_payload(user: str | None = None, period: str = "month") -> dict[str, Any]:
	from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
		_franchisee_ids_for_reps,
		is_sales_user,
		scoped_rep_ids,
	)
	from frappe.utils import getdate

	user = user or frappe.session.user
	if not is_sales_user(user):
		return {"available": False, "reason": "sales_access_required"}

	rep_ids = scoped_rep_ids(user)
	period = cstr(period or "month").lower()
	filters_extra = {}
	if period == "month":
		month_end = getdate(today())
		month_start = month_end.replace(day=1)
		filters_extra = {"creation": ("between", [str(month_start), f"{month_end} 23:59:59"])}

	lead_filters = {"assigned_rep": ("in", rep_ids)}
	lead_filters.update(filters_extra)
	leads = frappe.get_all(
		"Franchise Sales Lead",
		filters=lead_filters,
		fields=["name", "district", "subdivision", "pincode", "city", "status", "latitude", "longitude"],
		limit_page_length=2000,
	)

	visit_filters = {"sales_rep": ("in", rep_ids)}
	if period == "month":
		visit_filters["visit_date"] = ("between", [str(month_start), str(month_end)])
	visits = frappe.get_all(
		"Field Sales Visit",
		filters=visit_filters,
		fields=["name", "lead", "visit_date"],
		limit_page_length=2000,
	)
	lead_district = {l.name: (l.district or l.city or "Unspecified") for l in leads}

	franchisee_ids = _franchisee_ids_for_reps(rep_ids)
	franchisees = []
	if franchisee_ids:
		franchisees = frappe.get_all(
			"Franchisee Profile",
			filters={"name": ("in", franchisee_ids)},
			fields=["name", "franchise_name", "territory_region", "latitude", "longitude"],
			limit_page_length=2000,
		)

	by_district: dict[str, dict[str, Any]] = {}

	def bucket(district: str) -> dict[str, Any]:
		key = cstr(district).strip() or "Unspecified"
		if key not in by_district:
			by_district[key] = {
				"district": key,
				"leads": 0,
				"leads_won": 0,
				"visits": 0,
				"franchisees": 0,
			}
		return by_district[key]

	for lead in leads:
		b = bucket(lead.district or lead.city or "Unspecified")
		b["leads"] += 1
		if lead.status == "Won":
			b["leads_won"] += 1
	for visit in visits:
		b = bucket(lead_district.get(visit.lead, "Unspecified"))
		b["visits"] += 1
	for fr in franchisees:
		b = bucket(fr.territory_region or "Unspecified")
		b["franchisees"] += 1

	rows = sorted(by_district.values(), key=lambda r: (-r["leads"], r["district"]))
	return {
		"available": True,
		"period": period,
		"by_district": rows,
		"totals": {
			"leads": sum(r["leads"] for r in rows),
			"leads_won": sum(r["leads_won"] for r in rows),
			"visits": sum(r["visits"] for r in rows),
			"franchisees": sum(r["franchisees"] for r in rows),
		},
	}


def setup_phase84(path: str | None = None) -> dict[str, Any]:
	ensure_wb_postal_locality_doctype()
	ensure_lead_geo_fields()
	imported = import_wb_postal_directory(path)
	frappe.clear_cache()
	hierarchy = get_wb_geo_hierarchy_payload()
	return {
		"ok": True,
		"phase": 84,
		"import": imported,
		"hierarchy_districts": len(hierarchy.get("districts") or []),
		"hierarchy_count": hierarchy.get("count") or 0,
	}
