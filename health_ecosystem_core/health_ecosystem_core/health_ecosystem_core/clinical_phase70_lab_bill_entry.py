"""
Phase 70 — RemeLab-style single-window Lab Bill Entry on Customer TRF.

- Custom fields: discount lines, receipt, coll charge, totals cache
- Child tables: TRF Bill Adjustment, TRF Bill Staff
- APIs: search tests, expand panel, compute totals, save bill
"""

from __future__ import annotations

import json
import re
import secrets
from collections import defaultdict
from datetime import datetime

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, get_datetime, getdate, now_datetime, nowdate

from health_ecosystem_core.health_ecosystem_core.clinical_utils import format_patient_age, normalize_patient_age

MODULE = "Health Ecosystem Core"
LAB_ITEM_GROUPS = (
	"Lab Tests",
	"Laboratory",
	"Lab Services",
	"Diagnostics",
	"Pathology",
	"Services",
)


def setup_phase70():
	ensure_phase70_child_doctypes()
	ensure_phase70_bill_entry_fields()
	frappe.clear_cache()
	return {"ok": True, "phase": 70}


def ensure_phase70_child_doctypes():
	"""Create istable DocTypes used by Bill Entry if missing."""
	_ensure_child_doctype(
		"TRF Bill Adjustment",
		[
			{"fieldname": "adjustment", "fieldtype": "Data", "label": "Adjustment", "in_list_view": 1, "reqd": 1},
			{"fieldname": "percentage", "fieldtype": "Float", "label": "Percentage %", "in_list_view": 1, "precision": "3"},
			{"fieldname": "amount", "fieldtype": "Currency", "label": "Amount", "in_list_view": 1},
			{"fieldname": "remark", "fieldtype": "Data", "label": "Remark", "in_list_view": 1},
			{"fieldname": "conf_by", "fieldtype": "Data", "label": "Conf By", "in_list_view": 1},
		],
	)
	_ensure_child_doctype(
		"TRF Bill Staff",
		[
			{"fieldname": "staff_name", "fieldtype": "Data", "label": "Staff Name", "in_list_view": 1, "reqd": 1},
			{"fieldname": "amount", "fieldtype": "Currency", "label": "Amt", "in_list_view": 1},
		],
	)
	return True


def _ensure_child_doctype(name, fields):
	if frappe.db.exists("DocType", name):
		# Keep JSON-defined fields in sync lightly via Property Setter not needed for v1
		return name
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": name,
			"module": MODULE,
			"custom": 1,
			"istable": 1,
			"editable_grid": 1,
			"engine": "InnoDB",
			"fields": fields,
			"permissions": [],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return name


def ensure_phase70_bill_entry_fields():
	"""Custom fields on TRF Test Item + Customer TRF for Bill Entry."""
	ensure_phase70_child_doctypes()
	if getattr(frappe.local, "hec_phase70_fields_ready", False):
		return True

	trf_item_fields = [
		{
			"fieldname": "hec_disc_percent",
			"label": "Disc %",
			"fieldtype": "Float",
			"insert_after": "amount",
			"precision": "3",
			"in_list_view": 1,
		},
		{
			"fieldname": "hec_disc_amount",
			"label": "Disc Amt",
			"fieldtype": "Currency",
			"insert_after": "hec_disc_percent",
			"in_list_view": 1,
		},
		{
			"fieldname": "hec_r_amount",
			"label": "R. Amount",
			"fieldtype": "Currency",
			"insert_after": "hec_disc_amount",
			"in_list_view": 1,
			"read_only": 1,
		},
		{
			"fieldname": "hec_remark",
			"label": "Remark",
			"fieldtype": "Data",
			"insert_after": "hec_r_amount",
			"in_list_view": 1,
		},
	]

	has_health_patient = frappe.db.exists("DocType", "Health Patient")
	patient_link = {
		"fieldname": "hec_patient_id",
		"label": "Patient Id",
		"fieldtype": "Link" if has_health_patient else "Data",
		"insert_after": "patient_name",
	}
	if has_health_patient:
		patient_link["options"] = "Health Patient"

	trf_header_fields = [
		patient_link,
		{
			"fieldname": "hec_guardian",
			"label": "Guardian",
			"fieldtype": "Data",
			"insert_after": "hec_patient_id",
		},
		{
			"fieldname": "hec_whatsapp",
			"label": "WhatsApp",
			"fieldtype": "Data",
			"insert_after": "patient_phone",
		},
		{
			"fieldname": "hec_email",
			"label": "Email",
			"fieldtype": "Data",
			"insert_after": "hec_whatsapp",
		},
		{
			"fieldname": "hec_organization",
			"label": "Organization",
			"fieldtype": "Data",
			"insert_after": "franchisee_id",
		},
		{
			"fieldname": "hec_outside_sample",
			"label": "Outside Sample",
			"fieldtype": "Check",
			"insert_after": "hec_organization",
			"default": "0",
		},
		{
			"fieldname": "sample_intake_channel",
			"label": "Sample Intake Channel",
			"fieldtype": "Select",
			"options": "\nHome Collection\nHub Walk-in\nDirect to Mother Lab\nOnline / Courier Sample",
			"insert_after": "hec_outside_sample",
		},
		{
			"fieldname": "hec_coll_charge",
			"label": "Sample Collection Charge",
			"fieldtype": "Currency",
			"insert_after": "sample_intake_channel",
			"default": "0",
		},
		{
			"fieldname": "hec_lab_remarks",
			"label": "Lab Remarks",
			"fieldtype": "Small Text",
			"insert_after": "hec_coll_charge",
		},
		{
			"fieldname": "hec_bill_datetime",
			"label": "Bill DateTime",
			"fieldtype": "Datetime",
			"insert_after": "hec_lab_remarks",
		},
		# Receipt
		{
			"fieldname": "hec_receipt_section",
			"label": "Receipt",
			"fieldtype": "Section Break",
			"insert_after": "discount_amount",
			"collapsible": 1,
		},
		{
			"fieldname": "hec_receipt_amount",
			"label": "Receipt Amount",
			"fieldtype": "Currency",
			"insert_after": "hec_receipt_section",
		},
		{
			"fieldname": "hec_receipt_mode",
			"label": "Receipt Mode",
			"fieldtype": "Select",
			"options": "CASH\nCARD\nUPI\nCHEQUE\nNEFT\nOTHER",
			"default": "CASH",
			"insert_after": "hec_receipt_amount",
		},
		{
			"fieldname": "hec_receipt_no",
			"label": "Receipt No",
			"fieldtype": "Data",
			"insert_after": "hec_receipt_mode",
			"read_only": 1,
		},
		{
			"fieldname": "hec_cheque_ref",
			"label": "Cheque / Ref No",
			"fieldtype": "Data",
			"insert_after": "hec_receipt_no",
		},
		{
			"fieldname": "hec_cheque_date",
			"label": "Cheque / Ref Date",
			"fieldtype": "Date",
			"insert_after": "hec_cheque_ref",
		},
		{
			"fieldname": "hec_bank",
			"label": "Bank",
			"fieldtype": "Data",
			"insert_after": "hec_cheque_date",
		},
		# Totals cache
		{
			"fieldname": "hec_totals_section",
			"label": "Bill Totals",
			"fieldtype": "Section Break",
			"insert_after": "hec_bank",
			"collapsible": 1,
		},
		{
			"fieldname": "hec_test_amount",
			"label": "Test Amount",
			"fieldtype": "Currency",
			"insert_after": "hec_totals_section",
			"read_only": 1,
		},
		{
			"fieldname": "hec_addition",
			"label": "Addition",
			"fieldtype": "Currency",
			"insert_after": "hec_test_amount",
			"read_only": 1,
		},
		{
			"fieldname": "hec_deduction",
			"label": "Deduction",
			"fieldtype": "Currency",
			"insert_after": "hec_addition",
			"read_only": 1,
		},
		{
			"fieldname": "hec_net_amount",
			"label": "Net Amount",
			"fieldtype": "Currency",
			"insert_after": "hec_deduction",
			"read_only": 1,
		},
		{
			"fieldname": "hec_received",
			"label": "Received",
			"fieldtype": "Currency",
			"insert_after": "hec_net_amount",
		},
		{
			"fieldname": "hec_refund",
			"label": "Refund",
			"fieldtype": "Currency",
			"insert_after": "hec_received",
			"default": "0",
		},
		{
			"fieldname": "hec_written_off",
			"label": "Written Off",
			"fieldtype": "Currency",
			"insert_after": "hec_refund",
			"default": "0",
		},
		{
			"fieldname": "hec_due_amount",
			"label": "Due Amount",
			"fieldtype": "Currency",
			"insert_after": "hec_written_off",
			"read_only": 1,
		},
		{
			"fieldname": "hec_amount_paid",
			"label": "Amount Paid",
			"fieldtype": "Currency",
			"insert_after": "hec_due_amount",
		},
		{
			"fieldname": "hec_balance_return",
			"label": "Balance To Return",
			"fieldtype": "Currency",
			"insert_after": "hec_amount_paid",
			"read_only": 1,
		},
		{
			"fieldname": "hec_adjustments",
			"label": "Adjustments",
			"fieldtype": "Table",
			"options": "TRF Bill Adjustment",
			"insert_after": "tests",
		},
		{
			"fieldname": "hec_staff_share",
			"label": "Staff Share",
			"fieldtype": "Table",
			"options": "TRF Bill Staff",
			"insert_after": "hec_adjustments",
		},
	]

	create_custom_fields(
		{
			"TRF Test Item": trf_item_fields,
			"Customer TRF": trf_header_fields,
		},
		update=True,
	)
	frappe.db.commit()
	frappe.local.hec_phase70_fields_ready = True
	return True


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------


def _parse_json(value):
	if value is None:
		return None
	if isinstance(value, (dict, list)):
		return value
	if isinstance(value, str):
		try:
			return json.loads(value)
		except Exception:
			return None
	return None


def compute_line(row):
	"""Normalize one test line with disc math.

	RemeLab rule: Amount = Rate × Qty; DiscAmt from Disc% (or reverse);
	R.Amount = Amount − DiscAmt.
	When Disc% is set it always drives DiscAmt (avoids stale DiscAmt after qty/rate change).
	"""
	qty = flt(row.get("qty") or row.get("no") or 1) or 1
	rate = flt(row.get("rate") or 0)
	gross = qty * rate
	disc_pct = flt(row.get("hec_disc_percent") or row.get("disc_percent") or 0)
	disc_amt = flt(row.get("hec_disc_amount") or row.get("disc_amount") or 0)
	source = (row.get("_disc_source") or row.get("disc_source") or "").strip().lower()
	if source == "amt" and disc_amt and gross:
		disc_pct = disc_amt * 100.0 / gross
	elif disc_pct:
		disc_amt = gross * disc_pct / 100.0
	elif disc_amt and gross:
		disc_pct = disc_amt * 100.0 / gross
	else:
		disc_pct = 0
		disc_amt = 0
	r_amount = max(gross - disc_amt, 0)
	return {
		"item": (row.get("item") or row.get("item_code") or row.get("code") or "").strip(),
		"item_name": row.get("item_name") or row.get("test_name") or "",
		"qty": qty,
		"rate": rate,
		"amount": gross,
		"hec_disc_percent": disc_pct,
		"hec_disc_amount": disc_amt,
		"hec_r_amount": r_amount,
		"hec_remark": row.get("hec_remark") or row.get("remark") or "",
	}


def compute_bill_totals(tests=None, adjustments=None, coll_charge=0, received=0, refund=0, written_off=0, amount_paid=0):
	"""Roll up RemeLab-style bill totals."""
	lines = [compute_line(r) for r in (tests or []) if (r.get("item") or r.get("item_code") or r.get("code"))]
	test_amount = sum(flt(r["hec_r_amount"]) for r in lines)
	no_of_test = len(lines)

	addition = 0.0
	deduction = 0.0
	for adj in adjustments or []:
		amt = flt(adj.get("amount") or 0)
		pct = flt(adj.get("percentage") or 0)
		if not amt and pct:
			amt = test_amount * pct / 100.0
		name = (adj.get("adjustment") or "").strip().lower()
		# Positive amount = addition unless name suggests discount/deduction
		if any(k in name for k in ("disc", "deduct", "less", "concession")):
			deduction += abs(amt)
		elif amt < 0:
			deduction += abs(amt)
		else:
			addition += abs(amt)

	coll = flt(coll_charge)
	net = test_amount + coll + addition - deduction
	recv = flt(received) or flt(amount_paid)
	due = max(net - recv - flt(written_off) + flt(refund), 0)
	paid = flt(amount_paid) or recv
	balance_return = max(paid - net, 0) if paid > net else 0

	return {
		"lines": lines,
		"no_of_test": no_of_test,
		"hec_test_amount": test_amount,
		"hec_coll_charge": coll,
		"hec_addition": addition,
		"hec_deduction": deduction,
		"hec_net_amount": net,
		"hec_received": recv,
		"hec_refund": flt(refund),
		"hec_written_off": flt(written_off),
		"hec_due_amount": due,
		"hec_amount_paid": paid,
		"hec_balance_return": balance_return,
		"amount": net,
		"discount_amount": sum(flt(r["hec_disc_amount"]) for r in lines) + deduction,
	}


@frappe.whitelist()
def api_apply_patient_bill_rates(data=None):
	"""Re-price bill test rows from company MRP / FOCO mother lists (Phase 54)."""
	payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or frappe.form_dict or {}
	franchisee = (payload.get("franchisee_id") or payload.get("coll_centre") or "").strip() or None
	intake_channel = (
		payload.get("sample_intake_channel") or payload.get("intake_channel") or ""
	).strip() or None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
			apply_patient_bill_rates_to_lines,
		)

		tests = apply_patient_bill_rates_to_lines(
			payload.get("tests") or payload.get("items") or [],
			franchisee_id=franchisee,
			intake_channel=intake_channel,
		)
		tests = [
			{
				**row,
				**_sample_requirements(
					(row.get("item") or row.get("item_code") or "").strip(),
					row.get("item_name"),
				),
			}
			for row in tests
		]
	except Exception:
		frappe.log_error(title="phase70_apply_patient_bill_rates", message=frappe.get_traceback())
		tests = payload.get("tests") or payload.get("items") or []
	return {"ok": True, "tests": tests}


@frappe.whitelist()
def api_compute_hec_bill_totals(data=None):
	payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or frappe.form_dict
	totals = compute_bill_totals(
		tests=payload.get("tests") or payload.get("items") or [],
		adjustments=payload.get("adjustments") or payload.get("hec_adjustments") or [],
		coll_charge=payload.get("hec_coll_charge") or payload.get("coll_charge") or 0,
		received=payload.get("hec_received") or payload.get("received") or 0,
		refund=payload.get("hec_refund") or payload.get("refund") or 0,
		written_off=payload.get("hec_written_off") or payload.get("written_off") or 0,
		amount_paid=payload.get("hec_amount_paid") or payload.get("amount_paid") or 0,
	)
	return {"ok": True, "totals": totals}


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


def _item_rate(item_code, franchisee_id=None, franchisee_type=None, intake_channel=None):
	"""Patient bill rate — Vector=MRP, Pulse/Online=FOCO (Phase 54 mother lists)."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
			patient_bill_pricing,
		)

		return flt(
			patient_bill_pricing(
				item_code,
				franchisee_id=franchisee_id,
				franchisee_type=franchisee_type,
				intake_channel=intake_channel,
			)["rate"]
		)
	except Exception:
		try:
			from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

			return flt(_resolve_selling_rate(item_code))
		except Exception:
			return flt(frappe.db.get_value("Item", item_code, "standard_rate") or 0)


def _search_pricing(item_code, franchisee_id=None, franchisee_type=None, intake_channel=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
			patient_bill_pricing,
		)

		return patient_bill_pricing(
			item_code,
			franchisee_id=franchisee_id,
			franchisee_type=franchisee_type,
			intake_channel=intake_channel,
		)
	except Exception:
		rate = _item_rate(item_code)
		return {
			"rate": rate,
			"mrp": rate,
			"foco_rate": rate,
			"show_mrp_slash": False,
			"price_basis": "mrp",
		}


def _item_department(item_code):
	if not frappe.db.exists("DocType", "Diagnostic Test Master"):
		return ""
	dept = frappe.db.get_value(
		"Diagnostic Test Master",
		{"item": item_code},
		"department",
	)
	return dept or ""


def _sample_requirements(item_code, item_name=None):
	sample_type = ""
	requirements = []
	master = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item

		master_name = find_test_master_for_item(item_code) if item_code else None
		master = frappe.get_doc("Diagnostic Test Master", master_name) if master_name else None
	except Exception:
		master = None

	if master:
		sample_type = (getattr(master, "specimen_material", None) or "").strip()
	if not sample_type and frappe.db.exists("Item", item_code):
		try:
			if frappe.get_meta("Item").has_field("hec_lab_sample_type"):
				sample_type = (frappe.db.get_value("Item", item_code, "hec_lab_sample_type") or "").strip()
		except Exception:
			pass

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
			_preferred_tube_reqs,
		)

		reqs = _preferred_tube_reqs(master)
	except Exception:
		reqs = []

	for req in reqs or []:
		tube_code = (getattr(req, "tube", None) or "").strip()
		if not tube_code or not frappe.db.exists("HEC Collection Tube", tube_code):
			continue
		tube = frappe.get_doc("HEC Collection Tube", tube_code)
		requirements.append(
			{
				"tube_code": tube.tube_code or tube_code,
				"cap_color": tube.cap_color or "",
				"volume_ml": flt(getattr(req, "min_volume_ml", 0) or 0),
				"draw_order": cint(getattr(tube, "clsi_draw_order", 0) or 0),
				"specimen": getattr(tube, "specimen_class", "") or sample_type or "",
			}
		)

	requirements.sort(key=lambda row: (cint(row.get("draw_order") or 0), row.get("tube_code") or ""))
	return {
		"sample_type": sample_type,
		"collection_tubes": requirements,
		"sample_requirement_label": ", ".join(
			filter(
				None,
				[
					f"{row['tube_code']} {row['volume_ml']} ml".strip()
					for row in requirements
				],
			)
		),
	}


@frappe.whitelist()
def api_search_hec_lab_tests(txt=None, limit=30, franchisee_id=None, intake_channel=None):
	"""Search lab Items (+ Diagnostic Test Master names) for Bill Entry picker."""
	try:
		ensure_phase70_bill_entry_fields()
	except Exception:
		# Search must not fail for Lab Tech / roles that cannot mutate Custom Fields.
		frappe.log_error(title="phase70_ensure_on_search", message=frappe.get_traceback())
	txt = (txt or frappe.form_dict.get("txt") or "").strip()
	limit = cint(limit) or 30
	franchisee_id = (franchisee_id or frappe.form_dict.get("franchisee_id") or "").strip() or None
	intake_channel = (intake_channel or frappe.form_dict.get("intake_channel") or frappe.form_dict.get("sample_intake_channel") or "").strip() or None
	franchisee_type = None
	if franchisee_id and frappe.db.exists("Franchisee Profile", franchisee_id):
		franchisee_type = frappe.db.get_value("Franchisee Profile", franchisee_id, "franchisee_type")
	filters = {"disabled": 0, "is_sales_item": 1}
	or_filters = None
	if txt:
		or_filters = [
			["item_code", "like", f"%{txt}%"],
			["item_name", "like", f"%{txt}%"],
		]

	# Prefer lab-ish item groups when present
	group_exists = [
		g
		for g in LAB_ITEM_GROUPS
		if frappe.db.exists("Item Group", g)
	]
	items = []
	if group_exists:
		items = frappe.get_all(
			"Item",
			filters={**filters, "item_group": ["in", group_exists]},
			or_filters=or_filters,
			fields=["name", "item_code", "item_name", "item_group", "standard_rate"],
			limit_page_length=limit,
			order_by="item_name asc",
			ignore_permissions=True,
		)
	if len(items) < limit:
		extra = frappe.get_all(
			"Item",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "item_code", "item_name", "item_group", "standard_rate"],
			limit_page_length=limit,
			order_by="item_name asc",
			ignore_permissions=True,
		)
		seen = {r.name for r in items}
		for row in extra:
			if row.name not in seen:
				items.append(row)
				seen.add(row.name)
			if len(items) >= limit:
				break

	out = []
	seen_codes = set()
	for row in items[:limit]:
		code = row.item_code or row.name
		seen_codes.add(code)
		pricing = _search_pricing(
			code,
			franchisee_id=franchisee_id,
			franchisee_type=franchisee_type,
			intake_channel=intake_channel,
		)
		out.append(
			{
				"item_code": code,
				"item_name": row.item_name or code,
				"item_group": row.item_group,
				"department": _item_department(code),
				"rate": pricing["rate"],
				"mrp": pricing["mrp"],
				"foco_rate": pricing.get("foco_rate"),
				"show_mrp_slash": pricing.get("show_mrp_slash"),
				"price_basis": pricing.get("price_basis"),
				"kind": "test",
				**_sample_requirements(code, row.item_name or code),
			}
		)

	# Diagnostic Test Master fallback (common when Items are not sales-visible)
	if txt and frappe.db.exists("DocType", "Diagnostic Test Master") and len(out) < limit:
		dtm_or = [["name", "like", f"%{txt}%"]]
		if frappe.get_meta("Diagnostic Test Master").has_field("test_name"):
			dtm_or.append(["test_name", "like", f"%{txt}%"])
		if frappe.get_meta("Diagnostic Test Master").has_field("item"):
			dtm_or.append(["item", "like", f"%{txt}%"])
		dtm_fields = ["name"]
		for f in ("test_name", "item", "standard_rate", "rate"):
			if frappe.get_meta("Diagnostic Test Master").has_field(f):
				dtm_fields.append(f)
		dtm_rows = frappe.get_all(
			"Diagnostic Test Master",
			or_filters=dtm_or,
			fields=dtm_fields,
			limit_page_length=limit,
			ignore_permissions=True,
		)
		for row in dtm_rows:
			code = (row.get("item") or row.name or "").strip()
			if not code or code in seen_codes:
				continue
			seen_codes.add(code)
			pricing = _search_pricing(
				code,
				franchisee_id=franchisee_id,
				franchisee_type=franchisee_type,
				intake_channel=intake_channel,
			)
			out.append(
				{
					"item_code": code,
					"item_name": row.get("test_name") or code,
					"item_group": "Diagnostic Test",
					"department": _item_department(code),
					"rate": pricing["rate"],
					"mrp": pricing["mrp"],
					"foco_rate": pricing.get("foco_rate"),
					"show_mrp_slash": pricing.get("show_mrp_slash"),
					"price_basis": pricing.get("price_basis"),
					"kind": "test",
					**_sample_requirements(code, row.get("test_name") or code),
				}
			)
			if len(out) >= limit:
				break

	# Also surface panels when query matches
	if frappe.db.exists("DocType", "Lab Test Panel"):
		if txt:
			panels = frappe.get_all(
				"Lab Test Panel",
				or_filters=[
					["name", "like", f"%{txt}%"],
					["panel_name", "like", f"%{txt}%"],
				],
				fields=["name", "panel_name", "panel_rate", "description"],
				limit_page_length=10,
				ignore_permissions=True,
			)
		else:
			panels = frappe.get_all(
				"Lab Test Panel",
				fields=["name", "panel_name", "panel_rate", "description"],
				limit_page_length=10,
				order_by="panel_name asc",
				ignore_permissions=True,
			)
		for p in panels:
			out.append(
				{
					"item_code": p.name,
					"item_name": p.panel_name or p.name,
					"item_group": "Panel",
					"department": "",
					"rate": flt(p.panel_rate),
					"kind": "panel",
					"panel_id": p.name,
				}
			)

	return {"ok": True, "tests": out}


@frappe.whitelist()
def api_search_hec_doctors(txt=None, limit=30):
	"""Search Referring Doctor master for Refr. By picker (+ Self)."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import (
			api_search_referring_doctors,
		)

		raw = api_search_referring_doctors(txt=txt, limit=limit) or {}
		data = raw.get("data") if isinstance(raw, dict) else {}
		doctors = data.get("doctors") if isinstance(data, dict) else raw.get("doctors")
		if doctors:
			return {"ok": True, "doctors": doctors}
	except Exception:
		frappe.log_error(title="phase70_search_ref_doctors", message=frappe.get_traceback())

	txt = (txt or frappe.form_dict.get("txt") or "").strip()
	limit = cint(limit) or 30
	out = [{"name": "Self", "doctor_name": "Self", "label": "Self"}]
	if not frappe.db.exists("DocType", "Doctor"):
		return {"ok": True, "doctors": out}
	filters = {}
	or_filters = None
	if txt:
		or_filters = [["name", "like", f"%{txt}%"]]
		if frappe.get_meta("Doctor").has_field("doctor_name"):
			or_filters.append(["doctor_name", "like", f"%{txt}%"])
		if frappe.get_meta("Doctor").has_field("mobile"):
			or_filters.append(["mobile", "like", f"%{txt}%"])
	fields = ["name"]
	for f in ("doctor_name", "mobile", "primary_department", "status"):
		if frappe.get_meta("Doctor").has_field(f):
			fields.append(f)
	rows = frappe.get_all(
		"Doctor",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		limit_page_length=limit,
		order_by="modified desc",
		ignore_permissions=True,
	)
	for row in rows:
		dname = row.get("doctor_name") or row.name
		if txt and txt.lower() == "self":
			continue
		out.append(
			{
				"name": row.name,
				"doctor_name": dname,
				"mobile": row.get("mobile") or "",
				"department": row.get("primary_department") or "",
				"label": f"{dname} ({row.name})",
			}
		)
	if txt and "self".startswith(txt.lower()):
		pass  # Self already first
	elif txt:
		out = [out[0]] + [d for d in out[1:] if True]
	return {"ok": True, "doctors": out[: limit + 1]}


@frappe.whitelist()
def api_search_hec_collection_centres(txt=None, limit=30):
	"""Search Franchisee Profile for Coll Centre picker."""
	txt = (txt or frappe.form_dict.get("txt") or "").strip()
	limit = cint(limit) or 30
	if not frappe.db.exists("DocType", "Franchisee Profile"):
		return {"ok": True, "centres": []}
	or_filters = None
	if txt:
		or_filters = [
			["name", "like", f"%{txt}%"],
		]
		meta = frappe.get_meta("Franchisee Profile")
		if meta.has_field("franchise_name"):
			or_filters.append(["franchise_name", "like", f"%{txt}%"])
		if meta.has_field("branch_code"):
			or_filters.append(["branch_code", "like", f"%{txt}%"])
	fields = ["name"]
	for f in ("franchise_name", "branch_code"):
		if frappe.get_meta("Franchisee Profile").has_field(f):
			fields.append(f)
	rows = frappe.get_all(
		"Franchisee Profile",
		or_filters=or_filters,
		fields=fields,
		limit_page_length=limit,
		order_by="name asc",
	)
	out = []
	for row in rows:
		fname = row.get("franchise_name") or row.name
		branch = row.get("branch_code") or ""
		label = f"{fname} [{row.name}]" + (f" · {branch}" if branch else "")
		out.append(
			{
				"name": row.name,
				"franchise_name": fname,
				"branch_code": branch,
				"label": label,
			}
		)
	return {"ok": True, "centres": out}


@frappe.whitelist()
def api_expand_hec_lab_panel(panel_id=None):
	"""Expand a Lab Test Panel into bill lines."""
	panel_id = panel_id or frappe.form_dict.get("panel_id")
	if not panel_id or not frappe.db.exists("Lab Test Panel", panel_id):
		frappe.throw(_("Lab panel not found"))
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_diagnostics import _panel_test_items

		raw = _panel_test_items(panel_id) or []
	except Exception:
		doc = frappe.get_doc("Lab Test Panel", panel_id)
		raw = []
		for row in doc.get("tests") or doc.get("items") or []:
			code = getattr(row, "item", None) or getattr(row, "item_code", None)
			if code:
				raw.append({"item_code": code, "item": code, "qty": 1})

	lines = []
	for entry in raw:
		code = (entry.get("item_code") or entry.get("item") or "").strip()
		if not code:
			continue
		rate = flt(entry.get("rate")) or _item_rate(code)
		lines.append(
			compute_line(
				{
					"item": code,
					"item_name": entry.get("item_name")
					or frappe.db.get_value("Item", code, "item_name")
					or code,
					"qty": flt(entry.get("qty") or 1) or 1,
					"rate": rate,
				}
			)
		)
	return {"ok": True, "panel_id": panel_id, "tests": lines}


def _expand_panel_lines(tests_in):
	"""Replace Lab Test Panel lines with their component Items.

	TRF Test Item.item links to Item; a panel name there fails link validation on save.
	The panel line's Disc% is applied to each component.
	"""
	if not tests_in or not frappe.db.exists("DocType", "Lab Test Panel"):
		return tests_in

	def _code(r):
		return (r.get("item") or r.get("item_code") or r.get("code") or "").strip()

	def _is_panel(code):
		return bool(code) and not frappe.db.exists("Item", code) and frappe.db.exists("Lab Test Panel", code)

	seen = {_code(r) for r in tests_in if not _is_panel(_code(r))}
	out = []
	for row in tests_in:
		code = _code(row)
		if not _is_panel(code):
			out.append(row)
			continue
		panel_line = compute_line(row)
		children = (api_expand_hec_lab_panel(panel_id=code) or {}).get("tests") or []
		if not children:
			frappe.throw(_("Panel '{0}' has no tests configured").format(code))
		for child in children:
			if child["item"] in seen:
				continue
			seen.add(child["item"])
			out.append(
				{
					"item": child["item"],
					"item_name": child.get("item_name") or child["item"],
					"qty": child.get("qty") or 1,
					"rate": child.get("rate") or 0,
					"hec_disc_percent": panel_line["hec_disc_percent"],
					"_disc_source": "pct" if panel_line["hec_disc_percent"] else "",
					"hec_remark": panel_line["hec_remark"],
				}
			)
	return out


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------


def _default_franchisee():
	name = frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")
	return name


def _make_barcode(franchisee_id=None):
	"""Deprecated wrapper — all paths must use DocType barcode mint."""
	from health_ecosystem_core.health_ecosystem_core.doctype.customer_trf.customer_trf import (
		generate_unique_customer_trf_barcode,
	)

	return generate_unique_customer_trf_barcode(franchisee_id)


def _parse_bill_datetime(value):
	"""Accept system (YYYY-MM-DD) or user (DD-MM-YYYY) datetime strings from Bill Entry UI.

	Ambiguous values like 03-08-2026 must be treated as DD-MM-YYYY (user format from
	frappe.datetime.str_to_user), not US MM-DD-YYYY — get_datetime alone misparses them.
	"""
	if value in (None, ""):
		return now_datetime()
	if isinstance(value, datetime):
		return value
	raw = str(value).strip()
	if not raw:
		return now_datetime()

	# ISO / system first
	if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
		try:
			return get_datetime(raw)
		except Exception:
			pass

	# User format from Bill Entry UI (dd-mm-yyyy …)
	for fmt in (
		"%d-%m-%Y %H:%M:%S",
		"%d-%m-%Y %H:%M",
		"%d/%m/%Y %H:%M:%S",
		"%d/%m/%Y %H:%M",
		"%d-%m-%Y",
		"%d/%m/%Y",
	):
		try:
			parsed = datetime.strptime(raw, fmt)
			if fmt in ("%d-%m-%Y", "%d/%m/%Y"):
				return get_datetime(parsed.strftime("%Y-%m-%d 00:00:00"))
			return get_datetime(parsed.strftime("%Y-%m-%d %H:%M:%S"))
		except ValueError:
			continue

	try:
		return get_datetime(raw)
	except Exception:
		pass
	frappe.throw(_("Invalid Bill Date: {0}").format(raw))


def _parse_bill_date(value):
	"""Accept system or DD-MM-YYYY date strings (cheque date)."""
	if value in (None, ""):
		return None
	raw = str(value).strip()
	if not raw:
		return None
	if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
		try:
			return getdate(raw)
		except Exception:
			pass
	for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
		try:
			return getdate(datetime.strptime(raw, fmt).date())
		except ValueError:
			continue
	try:
		return getdate(raw)
	except Exception:
		pass
	frappe.throw(_("Invalid date: {0}").format(raw))


@frappe.whitelist()
def api_save_hec_lab_bill(data=None):
	"""Create or update Customer TRF from Bill Entry payload."""
	ensure_phase70_bill_entry_fields()
	payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
	if not payload:
		frappe.throw(_("Bill data required"))

	tests_in = payload.get("tests") or payload.get("items") or []
	adjustments_in = payload.get("adjustments") or payload.get("hec_adjustments") or []
	staff_in = payload.get("staff") or payload.get("hec_staff_share") or []

	franchisee = (payload.get("franchisee_id") or payload.get("coll_centre") or "").strip()
	if not franchisee:
		franchisee = _default_franchisee()
	if not franchisee or not frappe.db.exists("Franchisee Profile", franchisee):
		frappe.throw(_("Collection Centre / Franchisee is required"))
	intake_channel = (payload.get("sample_intake_channel") or payload.get("intake_channel") or "").strip() or None

	tests_in = _expand_panel_lines(tests_in)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
			apply_patient_bill_rates_to_lines,
		)

		tests_in = apply_patient_bill_rates_to_lines(
			tests_in,
			franchisee_id=franchisee,
			intake_channel=intake_channel,
		)
	except Exception:
		frappe.log_error(title="phase70_apply_mother_rates", message=frappe.get_traceback())

	totals = compute_bill_totals(
		tests=tests_in,
		adjustments=adjustments_in,
		coll_charge=payload.get("hec_coll_charge") or 0,
		received=payload.get("hec_received") or payload.get("hec_receipt_amount") or 0,
		refund=payload.get("hec_refund") or 0,
		written_off=payload.get("hec_written_off") or 0,
		amount_paid=payload.get("hec_amount_paid") or payload.get("hec_receipt_amount") or 0,
	)
	lines = totals["lines"]
	if not lines:
		frappe.throw(_("Add at least one test"))
	unknown = [ln["item"] for ln in lines if not frappe.db.exists("Item", ln["item"])]
	if unknown:
		frappe.throw(
			_("Test '{0}' is not a billable Item - remove it and add it again from search").format(
				"', '".join(unknown)
			)
		)

	patient_name = (payload.get("patient_name") or "").strip()
	if not patient_name:
		frappe.throw(_("Patient Name is required"))

	age, age_months, age_days = normalize_patient_age(
		payload.get("age"),
		payload.get("age_months"),
		payload.get("age_days"),
	)

	gender = (payload.get("gender") or "Other").strip()
	if gender not in ("Male", "Female", "Other"):
		gender = "Other"

	name = (payload.get("name") or payload.get("trf_id") or "").strip()

	is_new = not name or not frappe.db.exists("Customer TRF", name)

	if is_new:
		doc = frappe.new_doc("Customer TRF")
		# Leave blank unless caller overrides — CustomerTRF.before_insert mints via
		# generate_unique_customer_trf_barcode (single ERP-owned format).
		doc.unique_barcode = (payload.get("unique_barcode") or "").strip()
		doc.order_status = payload.get("order_status") or "Booked"
		doc.razorpay_payment_status = payload.get("razorpay_payment_status") or "Pending"
	else:
		doc = frappe.get_doc("Customer TRF", name)

	doc.patient_name = patient_name
	doc.age = age
	if hasattr(doc, "age_months"):
		doc.age_months = age_months
	if hasattr(doc, "age_days"):
		doc.age_days = age_days
	doc.gender = gender
	if hasattr(doc, "lmp_date") and payload.get("lmp_date"):
		doc.lmp_date = payload.get("lmp_date")
	if hasattr(doc, "menstrual_cycle_day") and payload.get("menstrual_cycle_day") not in (None, ""):
		doc.menstrual_cycle_day = cint(payload.get("menstrual_cycle_day"))
	doc.patient_phone = payload.get("patient_phone") or ""
	doc.collection_address = payload.get("collection_address") or ""
	doc.referred_doctor = payload.get("referred_doctor") or "Self"
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import (
			accrue_referring_doctor_commission,
			apply_referring_doctor_to_trf_doc,
		)

		apply_referring_doctor_to_trf_doc(doc, payload)
	except Exception:
		frappe.log_error(title="phase70_ref_doctor", message=frappe.get_traceback())
	doc.franchisee_id = franchisee
	if payload.get("collection_slot"):
		doc.collection_slot = payload.get("collection_slot")
	doc.promo_code = payload.get("promo_code") or ""
	doc.discount_amount = totals["discount_amount"]
	doc.amount = totals["amount"]
	doc.test_required = lines[0]["item"]

	# Optional custom header fields
	for field in (
		"hec_patient_id",
		"hec_guardian",
		"hec_whatsapp",
		"hec_email",
		"hec_organization",
		"hec_lab_remarks",
		"hec_receipt_mode",
		"hec_cheque_ref",
		"hec_bank",
	):
		if hasattr(doc, field) and field in payload:
			setattr(doc, field, payload.get(field) or "")

	if hasattr(doc, "hec_outside_sample"):
		doc.hec_outside_sample = cint(payload.get("hec_outside_sample") or 0)
	if hasattr(doc, "sample_intake_channel") and payload.get("sample_intake_channel"):
		doc.sample_intake_channel = (payload.get("sample_intake_channel") or "").strip()
	if hasattr(doc, "payment_method") and payload.get("payment_method"):
		doc.payment_method = payload.get("payment_method")
	if hasattr(doc, "hec_coll_charge"):
		doc.hec_coll_charge = totals["hec_coll_charge"]
	if hasattr(doc, "hec_bill_datetime"):
		doc.hec_bill_datetime = _parse_bill_datetime(payload.get("hec_bill_datetime"))
	if hasattr(doc, "hec_cheque_date") and payload.get("hec_cheque_date"):
		doc.hec_cheque_date = _parse_bill_date(payload.get("hec_cheque_date"))

	# Totals + receipt
	for field in (
		"hec_test_amount",
		"hec_addition",
		"hec_deduction",
		"hec_net_amount",
		"hec_received",
		"hec_refund",
		"hec_written_off",
		"hec_due_amount",
		"hec_amount_paid",
		"hec_balance_return",
	):
		if hasattr(doc, field):
			setattr(doc, field, totals.get(field) or 0)

	if hasattr(doc, "hec_receipt_amount"):
		doc.hec_receipt_amount = flt(payload.get("hec_receipt_amount") or totals["hec_amount_paid"])
	if hasattr(doc, "hec_receipt_no") and is_new and not doc.hec_receipt_no:
		doc.hec_receipt_no = f"RCPT-{secrets.token_hex(3).upper()}"

	# Rebuild tests
	doc.set("tests", [])
	for line in lines:
		row = {
			"item": line["item"],
			"item_name": line["item_name"],
			"qty": line["qty"],
			"rate": line["rate"],
			"amount": line["amount"],
		}
		if frappe.get_meta("TRF Test Item").has_field("hec_disc_percent"):
			row["hec_disc_percent"] = line["hec_disc_percent"]
			row["hec_disc_amount"] = line["hec_disc_amount"]
			row["hec_r_amount"] = line["hec_r_amount"]
			row["hec_remark"] = line["hec_remark"]
		doc.append("tests", row)

	if frappe.get_meta("Customer TRF").has_field("hec_adjustments"):
		doc.set("hec_adjustments", [])
		for adj in adjustments_in:
			if not (adj.get("adjustment") or adj.get("amount") or adj.get("percentage")):
				continue
			doc.append(
				"hec_adjustments",
				{
					"adjustment": adj.get("adjustment") or "Adjustment",
					"percentage": flt(adj.get("percentage")),
					"amount": flt(adj.get("amount")),
					"remark": adj.get("remark") or "",
					"conf_by": adj.get("conf_by") or "",
				},
			)

	if frappe.get_meta("Customer TRF").has_field("hec_staff_share"):
		doc.set("hec_staff_share", [])
		for st in staff_in:
			if not (st.get("staff_name") or st.get("amount")):
				continue
			doc.append(
				"hec_staff_share",
				{
					"staff_name": st.get("staff_name") or "",
					"amount": flt(st.get("amount")),
				},
			)

	if totals["hec_amount_paid"] > 0 and hasattr(doc, "razorpay_payment_status"):
		if totals["hec_due_amount"] <= 0:
			doc.razorpay_payment_status = "Paid"

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import (
			accrue_referring_doctor_commission,
		)

		accrue_referring_doctor_commission(doc.name)
	except Exception:
		frappe.log_error(title="phase70_ref_doctor_ledger", message=frappe.get_traceback())

	draw_plan = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
			rebuild_trf_draw_plan,
		)

		draw_plan = rebuild_trf_draw_plan(trf_id=doc.name, preserve_received=1)
	except Exception:
		frappe.log_error(title="phase89_draw_plan_bill_save", message=frappe.get_traceback())

	return {
		"ok": True,
		"name": doc.name,
		"unique_barcode": doc.unique_barcode,
		"totals": totals,
		"is_new": is_new,
		"draw_plan": (draw_plan or {}).get("tubes") if isinstance(draw_plan, dict) else None,
	}


@frappe.whitelist()
def api_get_hec_lab_bill(name=None):
	"""Load Bill Entry payload from an existing Customer TRF."""
	try:
		ensure_phase70_bill_entry_fields()
	except Exception:
		frappe.log_error(title="phase70_ensure_on_get_bill", message=frappe.get_traceback())
	name = name or frappe.form_dict.get("name")
	if not name:
		frappe.throw(_("name required"))
	doc = frappe.get_doc("Customer TRF", name)
	intake_channel = None
	if frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
		intake_channel = (getattr(doc, "sample_intake_channel", None) or "").strip() or None
	tests = []
	for row in doc.get("tests") or []:
		line = {
			"item": row.item,
			"item_name": row.item_name,
			"qty": row.qty,
			"rate": row.rate,
			"hec_disc_percent": getattr(row, "hec_disc_percent", 0),
			"hec_disc_amount": getattr(row, "hec_disc_amount", 0),
			"hec_remark": getattr(row, "hec_remark", "") or "",
		}
		pricing = _search_pricing(
			row.item,
			franchisee_id=doc.franchisee_id,
			intake_channel=intake_channel,
		)
		line["rate"] = pricing["rate"]
		line["mrp"] = pricing.get("mrp")
		line["foco_rate"] = pricing.get("foco_rate")
		line["show_mrp_slash"] = pricing.get("show_mrp_slash")
		line["price_basis"] = pricing.get("price_basis")
		line.update(_sample_requirements(row.item, row.item_name))
		tests.append(compute_line(line))
	adjustments = []
	for row in doc.get("hec_adjustments") or []:
		adjustments.append(
			{
				"adjustment": row.adjustment,
				"percentage": row.percentage,
				"amount": row.amount,
				"remark": row.remark,
				"conf_by": row.conf_by,
			}
		)
	staff = []
	for row in doc.get("hec_staff_share") or []:
		staff.append({"staff_name": row.staff_name, "amount": row.amount})

	return {
		"ok": True,
		"bill": {
			"name": doc.name,
			"unique_barcode": doc.unique_barcode,
			"patient_name": doc.patient_name,
			"age": doc.age,
			"age_months": cint(getattr(doc, "age_months", 0) or 0),
			"age_days": cint(getattr(doc, "age_days", 0) or 0),
			"age_label": format_patient_age(doc.age, getattr(doc, "age_months", 0), getattr(doc, "age_days", 0)),
			"lmp_date": str(getattr(doc, "lmp_date", "") or "") or "",
			"menstrual_cycle_day": getattr(doc, "menstrual_cycle_day", None),
			"gender": doc.gender,
			"patient_phone": doc.patient_phone,
			"collection_address": doc.collection_address,
			"referred_doctor": doc.referred_doctor,
			"franchisee_id": doc.franchisee_id,
			"collection_slot": str(doc.collection_slot) if doc.collection_slot else "",
			"promo_code": doc.promo_code,
			"order_status": doc.order_status,
			"hec_patient_id": getattr(doc, "hec_patient_id", "") or "",
			"hec_guardian": getattr(doc, "hec_guardian", "") or "",
			"hec_whatsapp": getattr(doc, "hec_whatsapp", "") or "",
			"hec_email": getattr(doc, "hec_email", "") or "",
			"hec_organization": getattr(doc, "hec_organization", "") or "",
			"hec_outside_sample": cint(getattr(doc, "hec_outside_sample", 0)),
			"hec_coll_charge": flt(getattr(doc, "hec_coll_charge", 0)),
			"hec_lab_remarks": getattr(doc, "hec_lab_remarks", "") or "",
			"hec_bill_datetime": str(getattr(doc, "hec_bill_datetime", "") or ""),
			"hec_receipt_amount": flt(getattr(doc, "hec_receipt_amount", 0)),
			"hec_receipt_mode": getattr(doc, "hec_receipt_mode", "CASH") or "CASH",
			"hec_receipt_no": getattr(doc, "hec_receipt_no", "") or "",
			"hec_cheque_ref": getattr(doc, "hec_cheque_ref", "") or "",
			"hec_cheque_date": str(getattr(doc, "hec_cheque_date", "") or ""),
			"hec_bank": getattr(doc, "hec_bank", "") or "",
			"hec_received": flt(getattr(doc, "hec_received", 0)),
			"hec_refund": flt(getattr(doc, "hec_refund", 0)),
			"hec_written_off": flt(getattr(doc, "hec_written_off", 0)),
			"hec_amount_paid": flt(getattr(doc, "hec_amount_paid", 0)),
			"tests": tests,
			"adjustments": adjustments,
			"staff": staff,
			"collection_tubes": (
				__import__(
					"health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession",
					fromlist=["get_trf_draw_plan_payload"],
				).get_trf_draw_plan_payload(doc.name)
				if frappe.db.exists("DocType", "TRF Collection Tube")
				else []
			),
		},
	}


def diagnose_customer_trf_form():
	"""Diagnose why Customer TRF Desk form can render blank (esp. New)."""
	import os

	from frappe.model.base_document import import_controller

	out = {
		"controllers": {},
		"field_count": 0,
		"hidden_fields": [],
		"property_hidden": [],
		"broken_links": [],
		"client_scripts": [],
		"assets": {},
		"can_new_doc": False,
		"new_doc_error": None,
	}

	for dt in (
		"Customer TRF",
		"TRF Collection Tube",
		"TRF Test Item",
		"TRF Bill Adjustment",
		"TRF Bill Staff",
	):
		try:
			out["controllers"][dt] = {"ok": True, "module": getattr(import_controller(dt), "__module__", "")}
		except Exception as exc:
			out["controllers"][dt] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

	meta = frappe.get_meta("Customer TRF")
	out["field_count"] = len(meta.fields)
	out["hidden_fields"] = [
		{"fieldname": f.fieldname, "fieldtype": f.fieldtype, "label": f.label}
		for f in meta.fields
		if cint(getattr(f, "hidden", 0))
	]
	out["property_hidden"] = frappe.get_all(
		"Property Setter",
		filters={"doc_type": "Customer TRF", "property": "hidden"},
		fields=["name", "field_name", "value"],
		limit=80,
	)
	out["client_scripts"] = frappe.get_all(
		"Client Script",
		filters={"dt": "Customer TRF", "enabled": 1},
		fields=["name", "view"],
	)

	for f in meta.fields:
		if f.fieldtype == "Link" and f.options and not frappe.db.exists("DocType", f.options):
			out["broken_links"].append({"fieldname": f.fieldname, "options": f.options})
		if f.fieldtype == "Table" and f.options and not frappe.db.exists("DocType", f.options):
			out["broken_links"].append({"fieldname": f.fieldname, "options": f.options, "kind": "Table"})

	for p in (
		"/home/frappe/frappe-bench/sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js",
		"/home/frappe/frappe-bench/sites/assets/health_ecosystem_core/js/customer_trf.js",
		"/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js",
	):
		out["assets"][os.path.basename(p) + ":" + ("assets" if "/assets/" in p else "app")] = {
			"exists": os.path.exists(p),
			"size": os.path.getsize(p) if os.path.exists(p) else 0,
		}

	try:
		doc = frappe.new_doc("Customer TRF")
		out["can_new_doc"] = True
		out["new_doc_name"] = doc.name
	except Exception as exc:
		out["new_doc_error"] = f"{type(exc).__name__}: {exc}"

	return out


def repair_customer_trf_form_visibility():
	"""Unhide Customer TRF fields + ensure Phase 70/89 dependants so Desk form paints."""
	ensure_phase70_bill_entry_fields()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
			repair_customer_trf_draw_plan_field,
		)

		repair_customer_trf_draw_plan_field()
	except Exception:
		frappe.log_error(title="repair_trf_phase89", message=frappe.get_traceback())

	# Clear Property Setters that hide important fields
	keep_visible = {
		"patient_name",
		"age",
		"gender",
		"tests",
		"unique_barcode",
		"franchisee_id",
		"order_status",
		"referred_doctor",
		"collection_tubes",
		"section_draw_plan",
		"test_required",
		"patient_phone",
		"collection_address",
	}
	for row in frappe.get_all(
		"Property Setter",
		filters={"doc_type": "Customer TRF", "property": "hidden", "value": "1"},
		fields=["name", "field_name"],
	):
		if not row.field_name or row.field_name in keep_visible:
			frappe.delete_doc("Property Setter", row.name, ignore_permissions=True, force=True)

	frappe.db.sql(
		"""
		UPDATE `tabDocField`
		SET hidden=0
		WHERE parent=%s AND fieldname IN %s
		""",
		("Customer TRF", tuple(sorted(keep_visible))),
	)
	frappe.db.sql(
		"""
		UPDATE `tabCustom Field`
		SET hidden=0
		WHERE dt=%s AND fieldname IN %s
		""",
		("Customer TRF", tuple(sorted(keep_visible))),
	)
	frappe.db.commit()
	frappe.clear_cache(doctype="Customer TRF")
	frappe.flags.hec_phase70_fields_ready = False
	return diagnose_customer_trf_form()

