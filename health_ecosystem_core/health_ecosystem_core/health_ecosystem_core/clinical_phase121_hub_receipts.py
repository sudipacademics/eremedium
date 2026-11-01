"""
Phase 121.6 — hub counter receipts.

Money a patient pays at a franchise hub (walk-in, hub bill, or an online "Pay at Hub" / COD booking handled by the
hub) belongs to the franchisee. The company books only the platform fee: a Sales Invoice to the hub's platform
customer, settled from the prepaid B2B wallet (Dr Franchisee Wallet Liability, Cr Debtors against the invoice).
COD cash collected for a booking with no hub stays company cash (Payment Entry, as before).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import _offline_date, payment_settings

HUB_PAYMENT_METHODS = ("Pay at Hub", "Cash on Delivery")
RETRY_BATCH = 100


def hub_owns_collection(doc):
	"""True when an offline collection on this document is the franchisee's money."""
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import normalize_payment_method

	if doc.doctype != "Customer TRF" or not cstr(doc.get("franchisee_id")):
		return False
	return normalize_payment_method(doc.get("payment_method")) in HUB_PAYMENT_METHODS


def settle_platform_invoice_from_wallet(sales_invoice, wallet_txn=None):
	"""Journal Entry clearing a platform-fee invoice against the franchisee wallet liability. Idempotent."""
	key = f"PLATFORMFEE-{sales_invoice}"
	existing = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
	if existing:
		return existing
	si = frappe.db.get_value(
		"Sales Invoice",
		sales_invoice,
		["name", "company", "customer", "debit_to", "outstanding_amount", "docstatus"],
		as_dict=True,
	)
	if not si or si.docstatus != 1 or flt(si.outstanding_amount) <= 0:
		return None
	if wallet_txn:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_wallet_books import excluded_hubs

		if frappe.db.get_value("Franchisee Wallet Transaction", wallet_txn, "franchisee") in excluded_hubs():
			return None
	liability = payment_settings().get("franchisee_wallet_account")
	if not liability or frappe.db.get_value("Account", liability, "company") != si.company:
		return None
	amount = flt(si.outstanding_amount, 2)
	if wallet_txn:
		amount = min(amount, flt(frappe.db.get_value("Franchisee Wallet Transaction", wallet_txn, "amount"), 2))
	if amount <= 0:
		return None
	cost_center = frappe.db.get_value("Company", si.company, "cost_center")
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": si.company,
			"posting_date": getdate(today()),
			"user_remark": f"Platform fee {si.name} paid from franchisee wallet ({wallet_txn or 'wallet'})",
			"hec_payment_key": key,
			"accounts": [
				{"account": liability, "debit_in_account_currency": amount, "cost_center": cost_center},
				{
					"account": si.debit_to,
					"party_type": "Customer",
					"party": si.customer,
					"credit_in_account_currency": amount,
					"reference_type": "Sales Invoice",
					"reference_name": si.name,
					"cost_center": cost_center,
				},
			],
		}
	)
	je.flags.ignore_permissions = True
	je.insert()
	je.submit()
	return je.name


def _close_patient_order(trf):
	so = cstr(trf.get("sales_order"))
	if not so:
		return None
	row = frappe.db.get_value("Sales Order", so, ["docstatus", "status"], as_dict=True)
	if not row or row.docstatus != 1 or row.status in ("Closed", "Completed"):
		return None
	frappe.get_doc("Sales Order", so).update_status("Closed")
	return so


def bill_hub_collection(trf_name):
	"""Platform-bill an online hub booking once the hub has collected from the patient.

	The wallet must cover the platform fee; when it does not, the booking stays unbilled and
	`bill_pending_hub_collections` retries after the hub tops up.
	"""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import finalize_hub_b2b_settlement

	trf = frappe.get_doc("Customer TRF", trf_name)
	closed = _close_patient_order(trf)
	if cint(trf.get("platform_billed")):
		return {"status": "already_billed", "closed_sales_order": closed}
	try:
		result = finalize_hub_b2b_settlement(trf.name, trf.franchisee_id)
	except frappe.ValidationError as exc:
		frappe.clear_messages()
		return {"status": "pending", "reason": cstr(exc), "closed_sales_order": closed}
	return {
		"status": "billed",
		"closed_sales_order": closed,
		"platform_invoice": result.get("platform_invoice"),
		"wallet_transaction": result.get("wallet_transaction"),
		"wholesale_amount": result.get("wholesale_amount"),
		"invoice_errors": result.get("invoice_errors") or [],
	}


def bill_pending_hub_collections():
	"""Hourly: platform-bill hub collections the wallet could not cover at collection time."""
	cutoff = payment_settings().get("hub_receipts_from")
	if not cutoff:
		return {"billed": 0}
	cutoff = getdate(cutoff)
	rows = frappe.get_all(
		"Customer TRF",
		filters={
			"franchisee_id": ["is", "set"],
			"payment_method": ["in", HUB_PAYMENT_METHODS],
			"razorpay_payment_status": "Paid",
			"platform_billed": 0,
			"payment_id": ["like", "offline-%"],
		},
		fields=["name", "payment_id"],
		order_by="modified asc",
		limit=RETRY_BATCH,
	)
	billed = 0
	previous_user = frappe.session.user
	frappe.set_user("Administrator")
	try:
		for row in rows:
			collected = _offline_date(row.payment_id)
			if not collected or getdate(collected) < cutoff:
				continue
			try:
				if bill_hub_collection(row.name).get("status") == "billed":
					billed += 1
				frappe.db.commit()
			except Exception:
				frappe.db.rollback()
				frappe.log_error(title="bill_pending_hub_collections", message=frappe.get_traceback())
	finally:
		frappe.set_user(previous_user)
	return {"billed": billed, "checked": len(rows)}
