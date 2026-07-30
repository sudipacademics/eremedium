"""Phase 85c — Activate Franchisee Profile + opening hub wallet from a paid RFMS application.

HMAC-authenticated bridge: RFMS calls after a verified paid milestone.
Does not change Phase 80 lead-only handoff or ingest_onboarding_result.
"""

from __future__ import annotations

import json
import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import cstr, flt

from health_ecosystem_core.health_ecosystem_core.clinical_franchisee_import import (
	FRANCHISEE_FEE,
	_credit_opening_wallet,
	_ensure_user,
	_find_existing_by_name,
	_slug_branch,
	wallet_recharge_from_deposit,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
	verify_rfms_bridge_signature,
)


def canonical_rfms_activate_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "activate_rfms_paid_franchisee",
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"deposit_amount": _amount_canonical(payload.get("deposit_amount")),
		"district": cstr(payload.get("district") or ""),
		"email": cstr(payload.get("email") or "").lower(),
		"franchise_model": cstr(payload.get("franchise_model") or "").upper(),
		"franchisee_profile": cstr(payload.get("franchisee_profile") or ""),
		"full_name": cstr(payload.get("full_name") or ""),
		"mobile": cstr(payload.get("mobile") or ""),
		"payment_key": cstr(payload.get("payment_key") or ""),
		"pincode": cstr(payload.get("pincode") or ""),
		"preferred_location": cstr(payload.get("preferred_location") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def _amount_canonical(value: Any) -> str:
	n = flt(value or 0)
	if abs(n - int(n)) < 1e-9:
		return str(int(n))
	return f"{n:.2f}".rstrip("0").rstrip(".")


def _address_from_payload(payload: dict[str, Any]) -> str:
	parts = [
		cstr(payload.get("preferred_location") or "").strip(),
		cstr(payload.get("district") or "").strip(),
		cstr(payload.get("pincode") or "").strip(),
		"West Bengal",
	]
	return ", ".join([part for part in parts if part])


def activate_rfms_paid_franchisee_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_rfms_activate_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	full_name = cstr(payload.get("full_name") or "").strip()
	if not full_name:
		frappe.throw(_("Applicant full name is required"))

	franchise_model = cstr(payload.get("franchise_model") or "").upper()
	email = cstr(payload.get("email") or "").strip()
	mobile = re.sub(r"\D", "", cstr(payload.get("mobile") or ""))
	deposit = flt(payload.get("deposit_amount") or 0)
	fee = FRANCHISEE_FEE
	recharge = wallet_recharge_from_deposit(deposit, fee)
	existing_name = cstr(payload.get("franchisee_profile") or "").strip()

	doc = None
	action = "updated"
	if existing_name and frappe.db.exists("Franchisee Profile", existing_name):
		doc = frappe.get_doc("Franchisee Profile", existing_name)
	else:
		by_name = _find_existing_by_name(full_name)
		if by_name:
			doc = frappe.get_doc("Franchisee Profile", by_name)
		else:
			used = set(frappe.get_all("Franchisee Profile", pluck="name"))
			branch_code = _slug_branch(full_name, used)
			doc = frappe.get_doc(
				{
					"doctype": "Franchisee Profile",
					"franchise_name": full_name,
					"branch_code": branch_code,
					"owner_name": full_name,
					"commission_percentage_rate": 30,
					"active_status": "Active",
					"franchisee_type": "Pulse",
					"commission_base": "Franchisee Rate",
				}
			)
			action = "created"

	doc.franchise_name = full_name
	doc.owner_name = full_name
	doc.category = franchise_model or doc.category or ""
	doc.ownership = franchise_model or doc.ownership or ""
	doc.active_status = doc.active_status or "Active"
	doc.contact_phone = mobile or doc.contact_phone
	if email and "@" in email and not email.endswith("@franchise.health.local"):
		doc.contact_email = email
	doc.deposit_amount = deposit if deposit > 0 else flt(doc.deposit_amount)
	doc.franchisee_fee = fee
	address = _address_from_payload(payload)
	if address:
		doc.address = address

	linked = _ensure_user(email, mobile, full_name)
	if linked:
		doc.linked_user = linked

	if action == "created":
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup

		ensure_franchisee_b2b_setup(doc.name)
	except Exception:
		frappe.log_error(title="activate_rfms_paid_franchisee_b2b", message=frappe.get_traceback())

	wallet_entry = _credit_opening_wallet(doc.name, recharge, deposit, fee)
	frappe.db.commit()

	return {
		"action": action,
		"franchisee_id": doc.name,
		"branch_code": doc.branch_code,
		"franchise_name": doc.franchise_name,
		"wallet_recharge": recharge,
		"wallet_entry": wallet_entry,
		"deposit_amount": deposit,
		"franchisee_fee": fee,
		"linked_user": linked,
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"payment_key": cstr(payload.get("payment_key") or ""),
	}
