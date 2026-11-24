"""Remedium Care as a collection centre on the partner lab workflow.

care.e-remedium.in books lab tests exactly like a partner hub (Customer TRF, sample_intake_channel "Hub Walk-in",
draw plan, patient payment history) for the company-owned centre REMEDIUMCARE. The mother lab then accessions,
reports and authorises those bookings in the Lab Tech portal as usual; the care portal tracks status, collects
balances and downloads authorised reports from the same records.

Differences from api_save_hub_lab_bill: the centre is company-owned, so no wallet debit, no platform invoice and no
FOCO commission accrual. Its patient rates follow the profile's Franchisee Type (Pulse = FOCO rate, Vector = MRP),
which is changed in the ERP. Callers are care portal users (Care Staff / Care Manager); access follows their
Care Backend module levels ("Test & Lab", "Billing & Invoice").
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

CENTRE = "REMEDIUMCARE"
CENTRE_NAME = "Remedium Care"
INTAKE = "Hub Walk-in"
LEVELS = {"none": 0, "view": 1, "create": 2, "edit": 3, "approve": 4, "manage": 5}
PAY_MODES = {"CASH": "CASH", "CARD": "CARD", "UPI": "UPI", "NEFT": "NEFT", "BANK TRANSFER": "NEFT", "CHEQUE": "NEFT", "INSURANCE": "NEFT", "ONLINE": "UPI"}


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_mobile_auth, _success

	return _error, _parse_request_value, _require_mobile_auth, _success


def _p95():
	from health_ecosystem_core.health_ecosystem_core import clinical_phase95_hub_lab_bill as p95

	return p95


def _p123():
	from health_ecosystem_core.health_ecosystem_core import clinical_phase123_booking_lifecycle as p123

	return p123


# ---------------------------------------------------------------- access


def _level(module):
	from health_ecosystem_core.health_ecosystem_core.clinical_people_access import my_permissions

	perms = my_permissions()
	if perms.get("exempt"):
		return LEVELS["manage"]
	level = ((perms.get("portal_modules") or {}).get("care") or {}).get(module, {}).get("level", "none")
	return LEVELS.get(level, 0)


def _need(*rules):
	"""rules: (module, level) pairs; any one is enough."""
	if any(_level(module) >= LEVELS[level] for module, level in rules):
		return
	labels = " or ".join(f"{module} ({level})" for module, level in rules)
	raise frappe.PermissionError(_("Your Care Backend access does not allow this. Needed: {0}").format(labels))


# ---------------------------------------------------------------- centre


def ensure_centre():
	"""Create the company-owned Remedium Care centre once. Never touches an existing profile's settings."""
	_p95().ensure_hub_lab_bill_fields()
	if not frappe.db.exists("Franchisee Profile", CENTRE):
		frappe.get_doc(
			{
				"doctype": "Franchisee Profile",
				"branch_code": CENTRE,
				"franchise_name": CENTRE_NAME,
				"owner_name": CENTRE_NAME,
				"franchisee_type": "Pulse",
				"commission_base": "Franchisee Rate",
				"commission_percentage_rate": 0,
				"credit_limit": 0,
				"franchisee_fee": 0,
				"wallet_balance": 0,
				"active_status": "Active",
			}
		).insert(ignore_permissions=True)
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup

			ensure_franchisee_b2b_setup(CENTRE)
		except Exception:
			frappe.log_error(title="care_lab_centre_setup", message=frappe.get_traceback())
		frappe.db.commit()
	return CENTRE


def _centre_info():
	row = frappe.db.get_value(
		"Franchisee Profile", CENTRE, ["name", "franchise_name", "franchisee_type", "active_status"], as_dict=True
	) or {}
	ftype = (row.get("franchisee_type") or "Pulse").strip()
	return {
		"centre": CENTRE,
		"centre_name": row.get("franchise_name") or CENTRE_NAME,
		"franchisee_type": ftype,
		"active": row.get("active_status") == "Active",
		"pricing_rule": "Patient pays the MRP (Vector centre)" if ftype == "Vector" else "Patient pays the FOCO rate (Pulse centre)",
		"intake_channel": INTAKE,
	}


def _assert_active():
	if frappe.db.get_value("Franchisee Profile", CENTRE, "active_status") != "Active":
		frappe.throw(_("The Remedium Care collection centre is not active in the ERP"))


def _own_trf(trf_id):
	trf_id = cstr(trf_id).strip()
	if trf_id and not frappe.db.exists("Customer TRF", trf_id):
		trf_id = frappe.db.get_value("Customer TRF", {"unique_barcode": trf_id}, "name") or ""
	if not trf_id or frappe.db.get_value("Customer TRF", trf_id, "franchisee_id") != CENTRE:
		frappe.throw(_("Booking not found for Remedium Care"), frappe.DoesNotExistError)
	return trf_id


# ---------------------------------------------------------------- pricing


def _priced_lines(codes):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
		apply_patient_bill_rates_to_lines,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import _sample_requirements

	seen = []
	for code in codes or []:
		code = cstr(code.get("item") if isinstance(code, dict) else code).strip()
		if code and code not in seen:
			seen.append(code)
	if not seen:
		frappe.throw(_("Choose at least one test"))
	missing = [c for c in seen if not frappe.db.exists("Item", c)]
	if missing:
		frappe.throw(_("Not a billable lab test in the ERP: {0}").format(", ".join(missing)))
	lines = apply_patient_bill_rates_to_lines([{"item": c, "qty": 1} for c in seen], franchisee_id=CENTRE, intake_channel=INTAKE)
	out = []
	for ln in lines:
		req = {}
		try:
			req = _sample_requirements(ln["item"], ln.get("item_name")) or {}
		except Exception:
			req = {}
		out.append(
			{
				"item": ln["item"],
				"item_name": ln.get("item_name") or ln["item"],
				"rate": flt(ln.get("rate")),
				"mrp": flt(ln.get("mrp")) or None,
				"platform_fee": flt(ln.get("platform_fee")),
				"sample_type": req.get("sample_type") or None,
			}
		)
	return out


def quote(data):
	_need(("Test & Lab", "view"))
	ensure_centre()
	lines = _priced_lines(data.get("tests"))
	for ln in lines:
		ln.pop("platform_fee", None)
	return {**_centre_info(), "tests": lines, "subtotal": round(sum(ln["rate"] for ln in lines), 2)}


# ---------------------------------------------------------------- booking


def book(data):
	_need(("Test & Lab", "create"))
	ensure_centre()
	_assert_active()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import api_save_hec_lab_bill

	patient_name = cstr(data.get("patient_name")).strip()
	if not patient_name:
		frappe.throw(_("Patient name is required"))
	phone = re.sub(r"\D", "", cstr(data.get("patient_phone")))[-10:]
	lines = _priced_lines(data.get("tests"))
	subtotal = round(sum(ln["rate"] for ln in lines), 2)
	discount = min(max(flt(data.get("discount")), 0), subtotal)
	net = round(subtotal - discount, 2)
	paid = min(max(flt(data.get("paid")), 0), net)
	mode = PAY_MODES.get(cstr(data.get("mode")).strip().upper(), "CASH")
	user_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	remarks = " · ".join(
		x
		for x in (
			"Remedium Care",
			cstr(data.get("branch")).strip()[:80],
			cstr(data.get("care_ref")).strip()[:40],
			f"booked by {user_name}",
			cstr(data.get("remarks")).strip()[:300],
		)
		if x
	)
	payload = {
		"patient_name": patient_name[:140],
		"age": data.get("age"),
		"age_months": data.get("age_months"),
		"age_days": data.get("age_days"),
		"gender": data.get("gender") if data.get("gender") in ("Male", "Female", "Other") else "Other",
		"patient_phone": phone,
		"hec_whatsapp": phone,
		"hec_email": cstr(data.get("email")).strip()[:140],
		"collection_address": cstr(data.get("address")).strip()[:500],
		"referred_doctor": cstr(data.get("referred_by")).strip()[:140] or "Self",
		"hec_lab_remarks": remarks[:1000],
		"tests": [{"item": ln["item"], "item_name": ln["item_name"], "qty": 1, "rate": ln["rate"]} for ln in lines],
		"adjustments": [{"adjustment": "Discount", "amount": discount, "remark": "Care portal"}] if discount else [],
		"hec_receipt_mode": mode,
		"hec_received": paid,
		"hec_amount_paid": paid,
		"hec_receipt_amount": paid,
		"franchisee_id": CENTRE,
		"coll_centre": CENTRE,
		"sample_intake_channel": INTAKE,
		"hec_outside_sample": 0,
		"order_status": "Booked",
		"payment_method": "Pay at Hub" if mode == "CASH" else "Online",
	}
	saved = api_save_hec_lab_bill(data=payload) or {}
	trf_name = saved.get("name")
	if not trf_name:
		frappe.throw(_("The lab booking could not be saved"))
	frappe.db.set_value(
		"Customer TRF",
		trf_name,
		{"wholesale_amount": round(sum(ln["platform_fee"] for ln in lines), 2), "platform_billed": 0},
		update_modified=False,
	)
	_p95()._append_payment_event(
		trf_name, amount=paid, mode=mode, notes="Opening receipt at Remedium Care", event_type="opening"
	)
	frappe.db.commit()
	return detail({"trf_id": trf_name}, checked=True)


def pay(data):
	_need(("Billing & Invoice", "create"), ("Test & Lab", "create"))
	trf_name = _own_trf(data.get("trf_id"))
	p95 = _p95()
	amount = flt(data.get("amount"))
	if amount <= 0:
		frappe.throw(_("Enter a received amount greater than zero"))
	snap = p95._bill_payment_snapshot(frappe.get_doc("Customer TRF", trf_name))
	due = flt(snap["hec_due_amount"])
	if due <= 0.009:
		frappe.throw(_("This lab booking is already fully paid"))
	if amount - due > 0.5:
		frappe.throw(_("Received amount ₹{0} is more than the due ₹{1}").format(amount, due))
	mode = PAY_MODES.get(cstr(data.get("mode")).strip().upper(), "CASH")
	p95._append_payment_event(
		trf_name, amount=amount, mode=mode, notes=cstr(data.get("notes")).strip()[:300] or "Balance collected at Remedium Care", event_type="payment"
	)
	return detail({"trf_id": trf_name}, checked=True)


def _fit_payment_history(history, new_paid, net, status):
	"""Reduce the latest receipts so the history sums to the revised amount received."""
	excess = round(sum(flt(h.get("amount") or 0) for h in history) - flt(new_paid), 2)
	if excess > 0.009:
		for entry in reversed(history):
			if excess <= 0.009:
				break
			amt = flt(entry.get("amount") or 0)
			if amt <= 0.009:
				continue
			take = min(amt, excess)
			entry["amount"] = round(amt - take, 2)
			note = cstr(entry.get("notes"))
			if "bill revised" not in note.lower():
				entry["notes"] = (note + " · bill revised").strip(" ·")[:500]
			excess = round(excess - take, 2)
		history = [h for h in history if abs(flt(h.get("amount") or 0)) > 0.009]
	running = 0.0
	for entry in history:
		running = round(running + flt(entry.get("amount") or 0), 2)
		entry["running_paid"] = running
		entry["running_due"] = round(max(flt(net) - running, 0), 2)
		entry["bill_total"] = flt(net)
		entry["status_after"] = status
	return history


def revise(data):
	"""Manager edit of a Remedium Care lab bill. Rates are the ones the manager entered.
	Money already received is capped at the new total; any shortfall stays due."""
	_need(("Billing & Invoice", "approve"))
	ensure_centre()
	trf_name = _own_trf(data.get("trf_id"))
	doc = frappe.get_doc("Customer TRF", trf_name)
	life = _p123().compute_booking_lifecycle([trf_name]).get(trf_name) or {}
	if life.get("journey_status") in ("Authorized", "Dispatched"):
		frappe.throw(_("This report is already authorised, so the bill can no longer be changed"))
	if cstr(doc.order_status) in ("Cancelled", "Rejected") or life.get("lifecycle_status") in ("Cancelled", "Rejected"):
		frappe.throw(_("This lab booking is closed"))
	clean = []
	for raw in data.get("tests") or []:
		code = cstr(raw.get("item")).strip()
		if not code or not frappe.db.exists("Item", code):
			frappe.throw(_("Choose each test from the lab catalogue"))
		qty = flt(raw.get("qty") or 1)
		rate = flt(raw.get("rate"))
		if qty <= 0:
			frappe.throw(_("Quantity must be more than zero"))
		if rate < 0:
			frappe.throw(_("Rate cannot be negative"))
		if rate <= 0:
			frappe.throw(_("Enter a rate for {0}").format(cstr(raw.get("item_name")) or code))
		name = cstr(raw.get("item_name") or frappe.db.get_value("Item", code, "item_name") or code).strip()[:140]
		clean.append({"item": code, "item_name": name, "qty": qty, "rate": rate, "amount": round(qty * rate, 2)})
	if not clean:
		frappe.throw(_("Add at least one test"))
	subtotal = round(sum(row["amount"] for row in clean), 2)
	discount = min(max(flt(data.get("discount")), 0), subtotal)
	coll = flt(getattr(doc, "hec_coll_charge", 0))
	addition = flt(getattr(doc, "hec_addition", 0))
	net = round(subtotal + coll + addition - discount, 2)
	if net < -0.001:
		frappe.throw(_("Discount cannot be more than the bill amount"))
	snap = _p95()._bill_payment_snapshot(doc)
	old_paid = flt(snap["hec_amount_paid"])
	paid = round(min(old_paid, max(net, 0)), 2)
	status, due = _p95()._payment_status_from_amounts(net, paid)
	doc.set("tests", [])
	for row in clean:
		doc.append("tests", row)
	doc.discount_amount = discount
	doc.amount = net
	doc.test_required = clean[0]["item"]
	for field, value in (
		("hec_test_amount", subtotal),
		("hec_deduction", discount),
		("hec_net_amount", net),
		("hec_amount_paid", paid),
		("hec_received", paid),
		("hec_receipt_amount", paid),
		("hec_due_amount", due),
		("hec_balance_return", 0),
		("hec_patient_payment_status", status),
	):
		if hasattr(doc, field):
			setattr(doc, field, value)
	if hasattr(doc, "razorpay_payment_status"):
		doc.razorpay_payment_status = "Paid" if status == "Paid" else "Pending"
	doc.save(ignore_permissions=True)
	for saved, src in zip(doc.tests or [], clean):
		if abs(flt(saved.rate) - src["rate"]) > 0.001 or abs(flt(saved.qty) - src["qty"]) > 0.001:
			frappe.db.set_value(saved.doctype, saved.name, {"qty": src["qty"], "rate": src["rate"], "amount": src["amount"]})
	meta = frappe.get_meta("Customer TRF")
	header = {
		"discount_amount": discount,
		"hec_test_amount": subtotal,
		"hec_deduction": discount,
		"hec_net_amount": net,
		"hec_amount_paid": paid,
		"hec_received": paid,
		"hec_receipt_amount": paid,
		"hec_due_amount": due,
		"hec_balance_return": 0,
		"hec_patient_payment_status": status,
		"razorpay_payment_status": "Paid" if status == "Paid" else "Pending",
	}
	frappe.db.set_value("Customer TRF", trf_name, {k: v for k, v in header.items() if meta.has_field(k)}, update_modified=True)
	history = _fit_payment_history(_p95()._load_payment_history(doc), paid, net, status)
	_p95()._save_payment_history(trf_name, history)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import rebuild_trf_draw_plan

		rebuild_trf_draw_plan(trf_id=trf_name, preserve_received=1)
	except Exception:
		frappe.log_error(title="care_lab_revise_draw_plan", message=frappe.get_traceback())
	frappe.db.commit()
	try:
		return detail({"trf_id": trf_name}, checked=True)
	except Exception:
		frappe.log_error(title="care_lab_revise_detail", message=frappe.get_traceback())
		return {
			"trf_id": trf_name,
			"lines": clean,
			"net_amount": net,
			"paid_amount": paid,
			"due_amount": due,
			"payment_status": status,
			"discount": discount,
		}


# ---------------------------------------------------------------- tracking

TRF_FIELDS = (
	"name", "unique_barcode", "patient_name", "age", "age_months", "age_days", "gender", "patient_phone",
	"order_status", "creation", "modified", "hec_bill_datetime", "amount", "hec_net_amount", "hec_amount_paid",
	"hec_received", "hec_receipt_amount", "hec_due_amount", "hec_patient_payment_status", "razorpay_payment_status",
	"referred_doctor", "hec_lab_remarks", "discount_amount", "collection_address", "care_journey", "sample_rejected",
	"sample_rejection_note",
)


def _rows(names=None, q=None, limit=50, start=0):
	p123 = _p123()
	cols = p123._existing_trf_columns(TRF_FIELDS)
	conds = ["franchisee_id = %(c)s"]
	params = {"c": CENTRE}
	if names is not None:
		if not names:
			return []
		conds.append("name in %(names)s")
		params["names"] = tuple(names)
	if q:
		conds.append("(name like %(q)s or unique_barcode like %(q)s or patient_name like %(q)s or patient_phone like %(q)s)")
		params["q"] = f"%{q}%"
	return frappe.db.sql(
		f"select {', '.join('`' + c + '`' for c in cols)} from `tabCustomer TRF` where {' and '.join(conds)} "
		f"order by creation desc limit {cint(limit)} offset {cint(start)}",
		params,
		as_dict=True,
	)


def _journeys(ids):
	ids = [i for i in ids if i]
	if not ids:
		return {}
	return {
		j.name: j
		for j in frappe.get_all(
			"Patient Care Journey",
			filters={"name": ["in", ids]},
			fields=["name", "status", "report_pdf", "authorized_on"],
			ignore_permissions=True,
		)
	}


def _present(rows):
	p123 = _p123()
	p95 = _p95()
	names = [r.name for r in rows]
	life = p123.compute_booking_lifecycle(names)
	tests = p123._test_lines(names)
	journeys = _journeys([(life.get(n) or {}).get("journey_id") for n in names])
	out = []
	for r in rows:
		lf = life.get(r.name) or {}
		snap = p95._bill_payment_snapshot(r)
		journey = journeys.get(lf.get("journey_id")) or {}
		report_ready = journey.get("status") in ("Authorized", "Dispatched") and bool(journey.get("report_pdf"))
		out.append(
			{
				"trf_id": r.name,
				"barcode": r.get("unique_barcode"),
				"patient_name": r.get("patient_name"),
				"age": r.get("age"),
				"gender": r.get("gender"),
				"patient_phone": r.get("patient_phone"),
				"tests": tests.get(r.name) or [],
				"booking_date": cstr(r.get("hec_bill_datetime") or r.get("creation")),
				"modified": cstr(r.get("modified")),
				"order_status": r.get("order_status"),
				"lifecycle_status": lf.get("lifecycle_status") or r.get("order_status"),
				"stage_index": lf.get("stage_index", 0),
				"is_terminal": bool(lf.get("is_terminal")),
				"terminal_reason": lf.get("terminal_reason"),
				"timeline": lf.get("timeline") or [],
				"journey_id": lf.get("journey_id"),
				"journey_status": lf.get("journey_status"),
				"report_status": lf.get("report_status"),
				"report_ready": report_ready,
				"authorized_on": cstr(journey.get("authorized_on") or "") or None,
				"tubes_total": lf.get("tubes_total", 0),
				"tubes_received": lf.get("tubes_received", 0),
				"tubes_rejected": lf.get("tubes_rejected", 0),
				"net_amount": flt(snap["hec_net_amount"]),
				"paid_amount": flt(snap["hec_amount_paid"]),
				"due_amount": flt(snap["hec_due_amount"]),
				"payment_status": snap["hec_patient_payment_status"],
				"referred_doctor": r.get("referred_doctor") or "Self",
			}
		)
	return out


def bookings(data):
	_need(("Test & Lab", "view"), ("Billing & Invoice", "view"))
	ensure_centre()
	raw = data.get("trf_ids")
	if raw:
		if isinstance(raw, str):
			raw = frappe.parse_json(raw) if raw.strip().startswith("[") else raw.split(",")
		names = [cstr(n).strip() for n in raw if cstr(n).strip()][:200]
		rows = _rows(names=names, limit=200)
	else:
		page_size = min(max(cint(data.get("page_size") or 30), 1), 100)
		page = max(cint(data.get("page") or 1), 1)
		rows = _rows(q=cstr(data.get("q")).strip()[:80] or None, limit=page_size, start=(page - 1) * page_size)
	items = _present(rows)
	status = cstr(data.get("status")).strip()
	if status == "Active":
		items = [b for b in items if b["lifecycle_status"] in ("Booked", "Sample Collected", "In Lab", "Processing", "Result Ready")]
	elif status == "Report Ready":
		items = [b for b in items if b["report_ready"]]
	elif status:
		items = [b for b in items if b["lifecycle_status"] == status]
	return {**_centre_info(), "bookings": items, "stages": list(_p123().STAGES)}


def detail(data, checked=False):
	if not checked:
		_need(("Test & Lab", "view"), ("Billing & Invoice", "view"))
	trf_name = _own_trf(data.get("trf_id"))
	booking = _present(_rows(names=[trf_name], limit=1))[0]
	doc = frappe.get_doc("Customer TRF", trf_name)
	sig = _p123()._load_signals([frappe._dict({f: doc.get(f) for f in ("name", "care_journey", "creation")})])[trf_name]
	booking.update(
		{
			"lines": [
				{"item": t.item, "item_name": t.item_name or t.item, "qty": flt(t.qty) or 1, "rate": flt(t.rate), "amount": flt(t.amount)}
				for t in doc.get("tests") or []
			],
			"subtotal": flt(doc.get("hec_test_amount")) or round(sum(flt(t.amount) for t in doc.get("tests") or []), 2),
			"discount": flt(doc.get("hec_deduction")) or flt(doc.get("discount_amount")),
			"remarks": doc.get("hec_lab_remarks"),
			"address": doc.get("collection_address"),
			"payment_history": _p95()._load_payment_history(doc),
			"tubes": [
				{
					"tube_code": t.tube_code,
					"status": t.status,
					"drawn_at": cstr(t.drawn_at or "") or None,
					"received_at": cstr(t.received_at or "") or None,
					"rejected_reason": t.rejected_reason,
				}
				for t in sig["tubes"]
			],
			"reports": [
				{"name": lr.name, "report_status": lr.report_status, "department": lr.department, "report_date": cstr(lr.report_date or "") or None}
				for lr in sig["reports"]
			],
		}
	)
	return booking


def _report_file(trf_name):
	journey_id = (_p123().compute_booking_lifecycle([trf_name]).get(trf_name) or {}).get("journey_id")
	journey = frappe.db.get_value("Patient Care Journey", journey_id, ["name", "status", "report_pdf"], as_dict=True) if journey_id else None
	if not journey or journey.status not in ("Authorized", "Dispatched") or not journey.report_pdf:
		frappe.throw(_("The report is not authorised yet"))
	from health_ecosystem_core.health_ecosystem_core.api import _resolve_file_doc

	file_doc = _resolve_file_doc(journey.report_pdf)
	if not file_doc:
		frappe.throw(_("Report file not found on the server"))
	return file_doc


# ---------------------------------------------------------------- endpoints


def _run(fn, *args):
	_error, _parse, _require, _success = _api()
	try:
		return _success(fn(*args))
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.DoesNotExistError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not found"), 404)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="care_lab", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _call(fn, sid, data):
	_error, _parse, _require, _success = _api()
	if not _require(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	raw = _parse("data", data) or "{}"
	try:
		payload = frappe.parse_json(raw) if isinstance(raw, str) else dict(raw)
	except Exception:
		return _error(_("Invalid request data"))
	return _run(fn, payload or {})


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_quote(sid=None, data=None):
	return _call(quote, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_book(sid=None, data=None):
	return _call(book, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_bookings(sid=None, data=None):
	return _call(bookings, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_booking(sid=None, data=None):
	return _call(detail, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_payment(sid=None, data=None):
	return _call(pay, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def care_lab_revise(sid=None, data=None):
	return _call(revise, sid, data)


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def care_lab_report(sid=None, trf_id=None):
	"""Authorised report PDF for a Remedium Care booking (binary)."""
	_error, _parse, _require, _success = _api()
	if not _require(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	try:
		_need(("Test & Lab", "view"), ("Billing & Invoice", "view"))
		trf_name = _own_trf(_parse("trf_id", trf_id))
		file_doc = _report_file(trf_name)
	except frappe.PermissionError as exc:
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.DoesNotExistError as exc:
		return _error(cstr(exc), 404)
	except frappe.ValidationError as exc:
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)), 409)
	frappe.local.response.filename = file_doc.file_name or f"{trf_name}.pdf"
	frappe.local.response.filecontent = file_doc.get_content()
	frappe.local.response.type = "download"
	frappe.local.response["content_type"] = "application/pdf"


def setup_care_lab():
	"""bench execute health_ecosystem_core.health_ecosystem_core.clinical_care_lab.setup_care_lab"""
	ensure_centre()
	return {**_centre_info(), "at": str(now_datetime())}
