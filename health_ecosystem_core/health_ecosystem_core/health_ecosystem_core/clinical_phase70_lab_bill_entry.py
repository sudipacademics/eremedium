"""
Phase 70 — RemeLab-style single-window Lab Bill Entry on Customer TRF.

- Custom fields: discount lines, receipt, coll charge, totals cache
- Child tables: TRF Bill Adjustment, TRF Bill Staff
- APIs: search tests, expand panel, compute totals, save bill
"""

from __future__ import annotations

import json
import secrets
from collections import defaultdict

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, getdate, now_datetime, nowdate

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
			"fieldname": "hec_coll_charge",
			"label": "Sample Collection Charge",
			"fieldtype": "Currency",
			"insert_after": "hec_outside_sample",
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


def _item_rate(item_code):
	try:
		from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

		return flt(_resolve_selling_rate(item_code))
	except Exception:
		return flt(frappe.db.get_value("Item", item_code, "standard_rate") or 0)


def _item_department(item_code):
	if not frappe.db.exists("DocType", "Diagnostic Test Master"):
		return ""
	dept = frappe.db.get_value(
		"Diagnostic Test Master",
		{"item": item_code},
		"department",
	)
	return dept or ""


@frappe.whitelist()
def api_search_hec_lab_tests(txt=None, limit=30):
	"""Search lab Items (+ Diagnostic Test Master names) for Bill Entry picker."""
	ensure_phase70_bill_entry_fields()
	txt = (txt or frappe.form_dict.get("txt") or "").strip()
	limit = cint(limit) or 30
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
		)
	if len(items) < limit:
		extra = frappe.get_all(
			"Item",
			filters=filters,
			or_filters=or_filters,
			fields=["name", "item_code", "item_name", "item_group", "standard_rate"],
			limit_page_length=limit,
			order_by="item_name asc",
		)
		seen = {r.name for r in items}
		for row in extra:
			if row.name not in seen:
				items.append(row)
				seen.add(row.name)
			if len(items) >= limit:
				break

	out = []
	for row in items[:limit]:
		code = row.item_code or row.name
		rate = flt(row.standard_rate) or _item_rate(code)
		out.append(
			{
				"item_code": code,
				"item_name": row.item_name or code,
				"item_group": row.item_group,
				"department": _item_department(code),
				"rate": rate,
				"kind": "test",
			}
		)

	# Also surface panels when query matches
	if frappe.db.exists("DocType", "Lab Test Panel"):
		panel_filters = {}
		if txt:
			panels = frappe.get_all(
				"Lab Test Panel",
				or_filters=[
					["name", "like", f"%{txt}%"],
					["panel_name", "like", f"%{txt}%"],
				],
				fields=["name", "panel_name", "panel_rate", "description"],
				limit_page_length=10,
			)
		else:
			panels = frappe.get_all(
				"Lab Test Panel",
				fields=["name", "panel_name", "panel_rate", "description"],
				limit_page_length=10,
				order_by="panel_name asc",
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
	"""Search Doctor master for Refr. By picker (+ allow Self)."""
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


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------


def _default_franchisee():
	name = frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")
	return name


def _make_barcode():
	return f"HEC{nowdate().replace('-', '')}{secrets.token_hex(3).upper()}"


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

	patient_name = (payload.get("patient_name") or "").strip()
	if not patient_name:
		frappe.throw(_("Patient Name is required"))

	age = cint(payload.get("age") or 0)
	if age <= 0:
		frappe.throw(_("Age is required"))

	gender = (payload.get("gender") or "Other").strip()
	if gender not in ("Male", "Female", "Other"):
		gender = "Other"

	franchisee = (payload.get("franchisee_id") or payload.get("coll_centre") or "").strip()
	if not franchisee:
		franchisee = _default_franchisee()
	if not franchisee or not frappe.db.exists("Franchisee Profile", franchisee):
		frappe.throw(_("Collection Centre / Franchisee is required"))

	name = (payload.get("name") or payload.get("trf_id") or "").strip()
	is_new = not name or not frappe.db.exists("Customer TRF", name)

	if is_new:
		doc = frappe.new_doc("Customer TRF")
		doc.unique_barcode = (payload.get("unique_barcode") or "").strip() or _make_barcode()
		doc.order_status = payload.get("order_status") or "Booked"
		doc.razorpay_payment_status = payload.get("razorpay_payment_status") or "Pending"
	else:
		doc = frappe.get_doc("Customer TRF", name)

	doc.patient_name = patient_name
	doc.age = age
	doc.gender = gender
	doc.patient_phone = payload.get("patient_phone") or ""
	doc.collection_address = payload.get("collection_address") or ""
	doc.referred_doctor = payload.get("referred_doctor") or "Self"
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
	if hasattr(doc, "hec_coll_charge"):
		doc.hec_coll_charge = totals["hec_coll_charge"]
	if hasattr(doc, "hec_bill_datetime"):
		doc.hec_bill_datetime = payload.get("hec_bill_datetime") or now_datetime()
	if hasattr(doc, "hec_cheque_date") and payload.get("hec_cheque_date"):
		doc.hec_cheque_date = getdate(payload.get("hec_cheque_date"))

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

	return {
		"ok": True,
		"name": doc.name,
		"unique_barcode": doc.unique_barcode,
		"totals": totals,
		"is_new": is_new,
	}


@frappe.whitelist()
def api_get_hec_lab_bill(name=None):
	"""Load Bill Entry payload from an existing Customer TRF."""
	ensure_phase70_bill_entry_fields()
	name = name or frappe.form_dict.get("name")
	if not name:
		frappe.throw(_("name required"))
	doc = frappe.get_doc("Customer TRF", name)
	tests = []
	for row in doc.get("tests") or []:
		tests.append(
			compute_line(
				{
					"item": row.item,
					"item_name": row.item_name,
					"qty": row.qty,
					"rate": row.rate,
					"hec_disc_percent": getattr(row, "hec_disc_percent", 0),
					"hec_disc_amount": getattr(row, "hec_disc_amount", 0),
					"hec_remark": getattr(row, "hec_remark", "") or "",
				}
			)
		)
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
		},
	}
