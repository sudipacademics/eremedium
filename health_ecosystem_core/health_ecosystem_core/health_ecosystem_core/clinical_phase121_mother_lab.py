"""
Phase 121.10 — mother lab billed like a franchise.

The mother lab keeps what its reception collects; the company bills it the platform fee for every new bill, taken
from its wallet. It is a Vector profile (patients pay MRP, fee = Vector wholesale) with a credit limit, so the wallet
may go negative up to that limit; past it, the reception cannot save new bills until the wallet is recharged.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt

MOTHER_LAB_CODE = "MOTHERLAB"
MOTHER_LAB_NAME = "Remedium Mother Lab"
MOTHER_LAB_CREDIT_LIMIT = 50000


def setup_mother_lab():
	"""Create and pin the mother lab profile. Idempotent; never changes an existing profile's money fields."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup
	from health_ecosystem_core.health_ecosystem_core.clinical_phase94_mother_lab_bill import ensure_mother_lab_bill_fields

	ensure_mother_lab_bill_fields()
	created = False
	if not frappe.db.exists("Franchisee Profile", MOTHER_LAB_CODE):
		frappe.get_doc(
			{
				"doctype": "Franchisee Profile",
				"branch_code": MOTHER_LAB_CODE,
				"franchise_name": MOTHER_LAB_NAME,
				"owner_name": MOTHER_LAB_NAME,
				"franchisee_type": "Vector",
				"commission_base": "Franchisee Rate",
				"commission_percentage_rate": 0,
				"credit_limit": MOTHER_LAB_CREDIT_LIMIT,
				"franchisee_fee": 0,
				"wallet_balance": 0,
				"active_status": "Active",
			}
		).insert(ignore_permissions=True)
		created = True
	setup = ensure_franchisee_b2b_setup(MOTHER_LAB_CODE)
	if frappe.db.get_single_value("Health Ecosystem Settings", "mother_lab_franchisee") != MOTHER_LAB_CODE:
		frappe.db.set_single_value("Health Ecosystem Settings", "mother_lab_franchisee", MOTHER_LAB_CODE)
	frappe.db.commit()
	profile = frappe.db.get_value(
		"Franchisee Profile",
		MOTHER_LAB_CODE,
		["franchisee_type", "credit_limit", "wallet_balance", "active_status", "platform_customer"],
		as_dict=True,
	)
	return {"created": created, "profile": profile, "b2b_setup": setup}


def mother_lab():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase94_mother_lab_bill import resolve_mother_lab_franchisee

	return resolve_mother_lab_franchisee()


def assert_mother_lab_can_bill(payload):
	"""Refuse a new mother lab bill before it is saved when wallet plus credit cannot cover its platform fee."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import assert_wallet_covers_platform_fee
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import line_settlement
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import _expand_panel_lines
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
		partner_circuit,
		tier_settlement,
		vector_debit_for_lines,
	)

	centre = (payload.get("franchisee_id") or "").strip()
	if not centre or centre != mother_lab():
		return None
	vector = vector_debit_for_lines(centre, _expand_panel_lines(payload.get("tests") or payload.get("items") or []))
	if vector:
		# Mapped Vector: the entry partner's deposit carries the adjustment, not the Vector's.
		if vector["debit"] > 0:
			assert_wallet_covers_platform_fee(vector["entry_partner"], vector["debit"])
		return vector["debit"]
	channel = (payload.get("sample_intake_channel") or "").strip() or None
	circuit = partner_circuit(centre)
	fee = 0.0
	for row in _expand_panel_lines(payload.get("tests") or payload.get("items") or []):
		code = (row.get("item") or row.get("item_code") or row.get("code") or "").strip()
		if code and frappe.db.exists("Item", code):
			qty = flt(row.get("qty")) or 1
			tier = tier_settlement(code, centre, qty, circuit=circuit)
			if tier:
				fee += tier["debit_amount"]
			else:
				fee += flt(line_settlement(code, franchisee_id=centre, intake_channel=channel, qty=qty)["platform_fee_amount"])
	if fee > 0:
		assert_wallet_covers_platform_fee(centre, fee)
	return fee


def settle_new_mother_lab_bill(trf_name):
	"""Charge the platform fee for a bill just saved at the mother lab desk.

	Raises frappe.ValidationError when wallet plus credit cannot cover the fee; the caller removes the bill.
	"""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import finalize_hub_b2b_settlement

	trf = frappe.db.get_value("Customer TRF", trf_name, ["franchisee_id", "platform_billed"], as_dict=True)
	if not trf or trf.franchisee_id != mother_lab() or cint(trf.platform_billed):
		return None
	return finalize_hub_b2b_settlement(trf_name, trf.franchisee_id)


def mother_lab_wallet_status():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import wallet_available_to_bill

	name = mother_lab()
	if not name or not frappe.db.exists("Franchisee Profile", name):
		return None
	info = wallet_available_to_bill(name)
	return {"franchisee": name, **{k: flt(v) if k != "franchisee_type" else v for k, v in info.items()}}
