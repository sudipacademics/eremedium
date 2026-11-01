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
		"business_name": cstr(payload.get("business_name") or ""),
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
		"registered_address": cstr(payload.get("registered_address") or ""),
		"territory_region": cstr(payload.get("territory_region") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def _amount_canonical(value: Any) -> str:
	n = flt(value or 0)
	if abs(n - int(n)) < 1e-9:
		return str(int(n))
	return f"{n:.2f}".rstrip("0").rstrip(".")


def _address_from_payload(payload: dict[str, Any]) -> str:
	registered = cstr(payload.get("registered_address") or "").strip()
	if registered:
		return registered
	parts = [
		cstr(payload.get("preferred_location") or "").strip(),
		cstr(payload.get("district") or "").strip(),
		cstr(payload.get("pincode") or "").strip(),
		"West Bengal",
	]
	return ", ".join([part for part in parts if part])


def _hub_business_name(payload: dict[str, Any], full_name: str) -> str:
	return cstr(payload.get("business_name") or "").strip() or full_name


def _apply_directory_hub_fields(doc, payload: dict[str, Any], *, full_name: str) -> None:
	"""Map Franchise Directory / onboarding certificate fields onto Franchisee Profile."""
	business_name = _hub_business_name(payload, full_name)
	doc.franchise_name = business_name
	doc.owner_name = full_name or doc.owner_name or business_name

	franchise_model = cstr(payload.get("franchise_model") or "").upper()
	if franchise_model:
		doc.category = franchise_model
		doc.ownership = franchise_model

	territory = cstr(payload.get("territory_region") or "").strip()
	if not territory:
		territory = cstr(payload.get("district") or "").strip()
	if territory:
		doc.territory_region = territory

	mobile = re.sub(r"\D", "", cstr(payload.get("mobile") or ""))
	if mobile:
		doc.contact_phone = mobile

	email = cstr(payload.get("email") or "").strip()
	if email and "@" in email and not email.endswith("@franchise.health.local"):
		doc.contact_email = email

	address = _address_from_payload(payload)
	if address:
		doc.address = address

	doc.active_status = doc.active_status or "Active"


def activate_rfms_paid_franchisee_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_rfms_activate_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	full_name = cstr(payload.get("full_name") or "").strip()
	if not full_name:
		frappe.throw(_("Applicant full name is required"))

	business_name = _hub_business_name(payload, full_name)
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
		by_name = _find_existing_by_name(full_name) or _find_existing_by_name(business_name)
		if by_name:
			doc = frappe.get_doc("Franchisee Profile", by_name)
		else:
			used = set(frappe.get_all("Franchisee Profile", pluck="name"))
			branch_code = _slug_branch(business_name or full_name, used)
			doc = frappe.get_doc(
				{
					"doctype": "Franchisee Profile",
					"franchise_name": business_name,
					"branch_code": branch_code,
					"owner_name": full_name,
					"commission_percentage_rate": 30,
					"active_status": "Active",
					"franchisee_type": "Pulse",
					"commission_base": "Franchisee Rate",
				}
			)
			action = "created"

	_apply_directory_hub_fields(doc, payload, full_name=full_name)
	doc.deposit_amount = deposit if deposit > 0 else flt(doc.deposit_amount)
	doc.franchisee_fee = fee
	if franchise_model:
		doc.category = franchise_model or doc.category or ""
		doc.ownership = franchise_model or doc.ownership or ""

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
	from health_ecosystem_core.health_ecosystem_core.clinical_phase121_wallet_books import book_wallet_credit

	book_wallet_credit(wallet_entry, "activation")
	frappe.db.commit()

	return {
		"action": action,
		"franchisee_id": doc.name,
		"branch_code": doc.branch_code,
		"franchise_name": doc.franchise_name,
		"territory_region": doc.territory_region,
		"address": doc.address,
		"wallet_recharge": recharge,
		"wallet_entry": wallet_entry,
		"deposit_amount": deposit,
		"franchisee_fee": fee,
		"linked_user": linked,
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"payment_key": cstr(payload.get("payment_key") or ""),
	}


def _generate_partner_password() -> str:
	import secrets

	alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	return "Rp" + "".join(secrets.choice(alphabet) for _ in range(10))


def canonical_rfms_partner_portal_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "provision_partner_portal_credentials",
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"business_name": cstr(payload.get("business_name") or ""),
		"district": cstr(payload.get("district") or ""),
		"email": cstr(payload.get("email") or "").lower(),
		"franchise_model": cstr(payload.get("franchise_model") or "").upper(),
		"franchisee_profile": cstr(payload.get("franchisee_profile") or ""),
		"full_name": cstr(payload.get("full_name") or ""),
		"login_url": cstr(payload.get("login_url") or "https://partners.e-remedium.in").rstrip("/"),
		"mobile": cstr(payload.get("mobile") or ""),
		"password": cstr(payload.get("password") or ""),
		"pincode": cstr(payload.get("pincode") or ""),
		"preferred_location": cstr(payload.get("preferred_location") or ""),
		"registered_address": cstr(payload.get("registered_address") or ""),
		"territory_region": cstr(payload.get("territory_region") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def provision_partner_portal_credentials_payload(
	payload: dict[str, Any], *, signature: str | None = None
) -> dict[str, Any]:
	"""Create/link Franchisee Operator user and set Partner Portal password (onboarded)."""
	canonical = canonical_rfms_partner_portal_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	full_name = cstr(payload.get("full_name") or "").strip()
	if not full_name:
		frappe.throw(_("Applicant full name is required"))

	business_name = _hub_business_name(payload, full_name)
	franchise_model = cstr(payload.get("franchise_model") or "").upper()
	email = cstr(payload.get("email") or "").strip()
	mobile = re.sub(r"\D", "", cstr(payload.get("mobile") or ""))
	existing_name = cstr(payload.get("franchisee_profile") or "").strip()
	password = cstr(payload.get("password") or "").strip() or _generate_partner_password()
	login_url = cstr(payload.get("login_url") or "https://partners.e-remedium.in").rstrip("/") or "https://partners.e-remedium.in"

	doc = None
	action = "updated"
	if existing_name and frappe.db.exists("Franchisee Profile", existing_name):
		doc = frappe.get_doc("Franchisee Profile", existing_name)
	else:
		by_name = _find_existing_by_name(full_name) or _find_existing_by_name(business_name)
		if by_name:
			doc = frappe.get_doc("Franchisee Profile", by_name)
		else:
			used = set(frappe.get_all("Franchisee Profile", pluck="name"))
			branch_code = _slug_branch(business_name or full_name, used)
			doc = frappe.get_doc(
				{
					"doctype": "Franchisee Profile",
					"franchise_name": business_name,
					"branch_code": branch_code,
					"owner_name": full_name,
					"commission_percentage_rate": 30,
					"active_status": "Active",
					"franchisee_type": "Pulse",
					"commission_base": "Franchisee Rate",
				}
			)
			action = "created"

	_apply_directory_hub_fields(doc, payload, full_name=full_name)
	if franchise_model:
		doc.category = franchise_model or doc.category or ""
		doc.ownership = franchise_model or doc.ownership or ""

	linked = _ensure_user(email, mobile, full_name)
	if not linked:
		frappe.throw(_("Unable to create Partner Portal user from email or mobile"))

	from frappe.utils.password import update_password

	update_password(linked, password, logout_all_sessions=False)
	doc.linked_user = linked

	if action == "created":
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup

		ensure_franchisee_b2b_setup(doc.name)
	except Exception:
		frappe.log_error(title="provision_partner_portal_b2b", message=frappe.get_traceback())

	frappe.db.commit()

	return {
		"action": action,
		"franchisee_id": doc.name,
		"branch_code": doc.branch_code,
		"franchise_name": doc.franchise_name,
		"territory_region": doc.territory_region,
		"address": doc.address,
		"user_id": linked,
		"password": password,
		"login_url": login_url,
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
	}


def canonical_rfms_sync_hub_directory_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "sync_rfms_hub_from_directory",
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"business_name": cstr(payload.get("business_name") or ""),
		"district": cstr(payload.get("district") or ""),
		"email": cstr(payload.get("email") or "").lower(),
		"franchise_model": cstr(payload.get("franchise_model") or "").upper(),
		"franchisee_profile": cstr(payload.get("franchisee_profile") or ""),
		"full_name": cstr(payload.get("full_name") or ""),
		"mobile": cstr(payload.get("mobile") or ""),
		"pincode": cstr(payload.get("pincode") or ""),
		"preferred_location": cstr(payload.get("preferred_location") or ""),
		"registered_address": cstr(payload.get("registered_address") or ""),
		"territory_region": cstr(payload.get("territory_region") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def sync_rfms_hub_from_directory_payload(
	payload: dict[str, Any], *, signature: str | None = None
) -> dict[str, Any]:
	"""Refresh Franchisee Profile hub name/branch details from Franchise Directory (no password change)."""
	canonical = canonical_rfms_sync_hub_directory_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	full_name = cstr(payload.get("full_name") or "").strip()
	business_name = _hub_business_name(payload, full_name)
	if not full_name and not business_name:
		frappe.throw(_("Applicant or business name is required"))

	existing_name = cstr(payload.get("franchisee_profile") or "").strip()
	email = cstr(payload.get("email") or "").strip()
	mobile = re.sub(r"\D", "", cstr(payload.get("mobile") or ""))

	doc = None
	action = "synced"
	if existing_name and frappe.db.exists("Franchisee Profile", existing_name):
		doc = frappe.get_doc("Franchisee Profile", existing_name)
	elif full_name:
		by_name = _find_existing_by_name(full_name)
		if by_name:
			doc = frappe.get_doc("Franchisee Profile", by_name)
	if not doc and business_name:
		by_biz = _find_existing_by_name(business_name)
		if by_biz:
			doc = frappe.get_doc("Franchisee Profile", by_biz)
	if not doc and email:
		linked_name = frappe.db.get_value(
			"Franchisee Profile",
			{"contact_email": email, "active_status": "Active"},
			"name",
		)
		if linked_name:
			doc = frappe.get_doc("Franchisee Profile", linked_name)
	if not doc and mobile:
		linked_name = frappe.db.get_value(
			"Franchisee Profile",
			{"contact_phone": ("like", f"%{mobile[-10:]}%"), "active_status": "Active"},
			"name",
		)
		if linked_name:
			doc = frappe.get_doc("Franchisee Profile", linked_name)
	if not doc:
		used = set(frappe.get_all("Franchisee Profile", pluck="name"))
		branch_code = _slug_branch(business_name or full_name, used)
		doc = frappe.get_doc(
			{
				"doctype": "Franchisee Profile",
				"franchise_name": business_name or full_name,
				"branch_code": branch_code,
				"owner_name": full_name or business_name,
				"commission_percentage_rate": 30,
				"active_status": "Active",
				"franchisee_type": "Pulse",
				"commission_base": "Franchisee Rate",
			}
		)
		action = "created"

	_apply_directory_hub_fields(doc, payload, full_name=full_name or cstr(doc.owner_name or ""))

	linked = None
	if email and frappe.db.exists("User", email):
		linked = email
	elif mobile:
		linked = frappe.db.get_value(
			"User",
			{"mobile_no": ("like", f"%{mobile[-10:]}%")},
			"name",
		)
	if not linked and (email or mobile):
		try:
			linked = _ensure_user(email, mobile, full_name or business_name)
		except Exception:
			frappe.log_error(title="sync_rfms_hub_directory_user", message=frappe.get_traceback())
	if linked:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_franchisee_import import ROLE_FRANCHISEE

			roles = frappe.get_roles(linked)
			if ROLE_FRANCHISEE not in roles:
				frappe.get_doc("User", linked).add_roles(ROLE_FRANCHISEE)
		except Exception:
			frappe.log_error(title="sync_rfms_hub_directory_role", message=frappe.get_traceback())
		doc.linked_user = linked

	if action == "created":
		doc.insert(ignore_permissions=True)
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup

			ensure_franchisee_b2b_setup(doc.name)
		except Exception:
			frappe.log_error(title="sync_rfms_hub_directory_b2b", message=frappe.get_traceback())
	else:
		doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"action": action,
		"franchisee_id": doc.name,
		"branch_code": doc.branch_code,
		"franchise_name": doc.franchise_name,
		"territory_region": doc.territory_region,
		"address": doc.address,
		"contact_phone": doc.contact_phone,
		"contact_email": doc.contact_email,
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"linked_user": doc.linked_user,
	}
