"""Phase 81 — Import Franchise sheet rows into Franchisee Profile + opening wallet recharge.

Wallet rule (from ops): wallet_recharge = max(0, deposit_amount - FRANCHISEE_FEE)
where FRANCHISEE_FEE defaults to 80000.

Ledger: Phase 23 ``Franchisee Wallet Transaction`` (payment_reference=OPENING-RECHARGE).
GPS: geocode Location via OpenStreetMap Nominatim when the string looks like a real address.
"""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import frappe
from frappe.utils import cint, flt, validate_email_address

FRANCHISEE_FEE = 80000.0
OPENING_REF = "OPENING-RECHARGE"
ROLE_FRANCHISEE = "Franchisee Operator"
DEFAULT_PASSWORD = "HubChangeMe@123"

_BAD_LOCATIONS = {
	"",
	"place",
	"remedium",
	"remedium labs",
	"remedium lab",
	"n/a",
	"na",
	"-",
}


def _parse_money(raw) -> float:
	if raw is None:
		return 0.0
	text = str(raw).strip()
	if not text or text.upper() in {"NO DUE", "N/A", "NA", "-"}:
		return 0.0
	text = text.replace(",", "").replace("/-", "").replace("₹", "").replace("Rs", "")
	text = re.sub(r"[^\d.\-]", "", text)
	if not text or text in {".", "-", "-."}:
		return 0.0
	try:
		return float(text)
	except ValueError:
		return 0.0


def _parse_percent(raw) -> float:
	if raw is None:
		return 0.0
	text = str(raw).strip().replace("%", "")
	try:
		return float(text)
	except ValueError:
		return 0.0


def _map_status(sheet_status: str) -> str:
	s = (sheet_status or "").strip().lower()
	if s in {"active", "partially active"}:
		return "Active"
	if s in {"blocked"}:
		return "Suspended"
	return "Inactive"


def _slug_branch(name: str, used: set[str]) -> str:
	base = re.sub(r"[^A-Za-z0-9]+", "", (name or "").upper())[:16] or "HUB"
	code = base
	n = 2
	while code in used or frappe.db.exists("Franchisee Profile", code):
		suffix = str(n)
		code = base[: 16 - len(suffix)] + suffix
		n += 1
	used.add(code)
	return code


def _row_get(row: dict, *keys: str) -> str:
	for key in keys:
		for rk, rv in row.items():
			if rk and rk.strip().lower() == key.lower():
				return (rv or "").strip() if isinstance(rv, str) else (str(rv).strip() if rv is not None else "")
	return ""


def geocode_address(address: str, country: str = "India") -> tuple[float | None, float | None, str | None]:
	"""Return (lat, lng, display_name) via Nominatim. Soft-fails on errors."""
	query = (address or "").strip()
	if not query or query.lower() in _BAD_LOCATIONS:
		return None, None, None
	if "india" not in query.lower() and "west bengal" not in query.lower():
		query = f"{query}, India"

	params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1, "addressdetails": 0})
	url = f"https://nominatim.openstreetmap.org/search?{params}"
	req = urllib.request.Request(
		url,
		headers={
			"User-Agent": "MyLabSystem-FranchiseeImport/1.0 (ops@e-remedium.in)",
			"Accept": "application/json",
		},
	)
	try:
		with urllib.request.urlopen(req, timeout=20) as resp:
			payload = json.loads(resp.read().decode("utf-8"))
		if not payload:
			return None, None, None
		hit = payload[0]
		return float(hit["lat"]), float(hit["lon"]), hit.get("display_name")
	except Exception as exc:
		frappe.log_error(f"geocode failed for {address}: {exc}", "Franchisee Geocode")
		return None, None, None


def wallet_recharge_from_deposit(deposit_amount: float, franchisee_fee: float = FRANCHISEE_FEE) -> float:
	return max(0.0, flt(deposit_amount) - flt(franchisee_fee))


def _ensure_role():
	if not frappe.db.exists("Role", ROLE_FRANCHISEE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE_FRANCHISEE, "desk_access": 1}).insert(
			ignore_permissions=True
		)


def _normalize_email(email: str, mobile: str) -> str | None:
	email = (email or "").strip()
	if email and "@" in email:
		try:
			validate_email_address(email, throw=True)
			return email
		except Exception:
			pass
	mobile_digits = re.sub(r"\D", "", mobile or "")
	if len(mobile_digits) >= 10:
		return f"{mobile_digits[-10:]}@franchise.health.local"
	return None


def _ensure_user(email: str, mobile: str, full_name: str) -> str | None:
	email = _normalize_email(email, mobile)
	if not email:
		return None

	_ensure_role()
	from frappe.utils.password import update_password

	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
		roles = {r.role for r in user.roles}
		if ROLE_FRANCHISEE not in roles:
			user.add_roles(ROLE_FRANCHISEE)
		if mobile and not user.mobile_no:
			user.db_set("mobile_no", mobile)
		return email

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": (full_name or email.split("@")[0])[:140],
			"enabled": 1,
			"send_welcome_email": 0,
			"user_type": "System User",
			"mobile_no": mobile or None,
		}
	)
	user.insert(ignore_permissions=True)
	user.add_roles(ROLE_FRANCHISEE)
	update_password(email, DEFAULT_PASSWORD, logout_all_sessions=False)
	return email


def _find_existing_by_name(franchise_name: str) -> str | None:
	return frappe.db.get_value("Franchisee Profile", {"franchise_name": franchise_name}, "name")


def _credit_opening_wallet(franchisee: str, amount: float, deposit: float, fee: float):
	"""Credit opening balance via Phase 23 ledger (bypasses public min-recharge gate)."""
	if amount <= 0:
		return None
	existing = frappe.db.exists(
		"Franchisee Wallet Transaction",
		{"franchisee": franchisee, "payment_reference": OPENING_REF},
	)
	if existing:
		return existing

	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _record_wallet_transaction

	profile = frappe.get_doc("Franchisee Profile", franchisee)
	balance = flt(profile.wallet_balance)
	new_balance = round(balance + flt(amount), 2)
	profile.wallet_balance = new_balance
	profile.save(ignore_permissions=True)
	return _record_wallet_transaction(
		franchisee,
		"Recharge",
		amount,
		new_balance,
		payment_reference=OPENING_REF,
		remarks=f"Opening wallet = deposit {deposit} - franchisee fee {fee}",
	)


def upsert_franchisee_from_row(row: dict, used_codes: set[str], geocode: bool = True) -> dict:
	name = _row_get(row, "Name")
	if not name:
		return {"skipped": True, "reason": "empty name"}

	category = _row_get(row, "Category")
	sheet_status = _row_get(row, "Status")
	ownership = _row_get(row, "Ownership")
	commission = _parse_percent(_row_get(row, "Commission", "% Commission"))
	bank = _row_get(row, "Bank Ac")
	ifsc = _row_get(row, "IFSC")
	location = _row_get(row, "Location")
	local_agent = _row_get(row, "Local Agent")
	pdd = _row_get(row, "PDD")
	agreement = _row_get(row, "Agreement")
	email = _row_get(row, "Email Id", "Email")
	mobile = _row_get(row, "Mobile No", "Mobile")
	deposit = _parse_money(_row_get(row, "Deposit Amount"))
	total_amt = _parse_money(_row_get(row, "Total Amount"))
	due_raw = _row_get(row, "Due Amount")
	due_amt = 0.0 if due_raw.upper() == "NO DUE" else _parse_money(due_raw)
	docs = _row_get(row, "Final Documentation")

	fee = FRANCHISEE_FEE
	recharge = wallet_recharge_from_deposit(deposit, fee)
	active_status = _map_status(sheet_status)
	owner_name = local_agent or name

	existing = _find_existing_by_name(name)
	if existing:
		doc = frappe.get_doc("Franchisee Profile", existing)
		branch_code = doc.branch_code
		used_codes.add(branch_code)
	else:
		branch_code = _slug_branch(name, used_codes)
		doc = frappe.get_doc(
			{
				"doctype": "Franchisee Profile",
				"franchise_name": name,
				"branch_code": branch_code,
				"owner_name": owner_name,
				"commission_percentage_rate": commission or 30,
				"active_status": active_status,
				"franchisee_type": "Pulse",
				"commission_base": "Franchisee Rate",
			}
		)

	doc.franchise_name = name
	doc.owner_name = owner_name
	doc.category = category
	doc.ownership = ownership
	doc.commission_percentage_rate = commission or doc.commission_percentage_rate or 30
	doc.active_status = active_status
	doc.sheet_status = sheet_status
	doc.contact_phone = mobile or doc.contact_phone
	normalized_email = _normalize_email(email, mobile)
	if normalized_email and not normalized_email.endswith("@franchise.health.local"):
		doc.contact_email = normalized_email
	elif email and "@" in email:
		try:
			validate_email_address(email, throw=True)
			doc.contact_email = email
		except Exception:
			pass
	doc.local_agent = local_agent
	doc.final_documentation = docs
	doc.bank_account = bank
	doc.ifsc = ifsc
	doc.deposit_amount = deposit
	doc.franchisee_fee = fee
	doc.total_amount = total_amt
	doc.due_amount = due_amt
	doc.pdd_url = pdd
	doc.agreement_url = agreement
	if location:
		doc.address = location

	lat = lng = None
	geo_display = None
	if geocode and location and location.lower() not in _BAD_LOCATIONS:
		lat, lng, geo_display = geocode_address(location)
		time.sleep(1.1)
		if lat is not None:
			doc.latitude = lat
			doc.longitude = lng
			if geo_display and (not doc.address or doc.address.lower() in _BAD_LOCATIONS):
				doc.address = geo_display

	linked = None
	if email or mobile:
		linked = _ensure_user(email, mobile, owner_name)
		if linked:
			doc.linked_user = linked

	if existing:
		doc.save(ignore_permissions=True)
		action = "updated"
	else:
		doc.insert(ignore_permissions=True)
		action = "created"

	wallet_entry = _credit_opening_wallet(doc.name, recharge, deposit, fee)

	return {
		"action": action,
		"name": doc.name,
		"branch_code": doc.branch_code,
		"franchise_name": name,
		"active_status": active_status,
		"deposit": deposit,
		"franchisee_fee": fee,
		"wallet_recharge": recharge,
		"wallet_entry": wallet_entry,
		"linked_user": linked,
		"latitude": lat,
		"longitude": lng,
		"geocoded": bool(lat is not None),
	}


def import_franchise_csv(csv_path: str | None = None, geocode: bool = True) -> dict:
	"""Import franchise CSV. Default path: /tmp/franchise-sheet.csv inside container."""
	path = Path(csv_path or "/tmp/franchise-sheet.csv")
	if not path.exists():
		frappe.throw(f"CSV not found: {path}")

	used_codes: set[str] = set(frappe.get_all("Franchisee Profile", pluck="name"))
	results = []
	with path.open("r", encoding="utf-8-sig", newline="") as fh:
		reader = csv.DictReader(fh)
		for row in reader:
			try:
				results.append(upsert_franchisee_from_row(row, used_codes, geocode=geocode))
				frappe.db.commit()
			except Exception as exc:
				frappe.db.rollback()
				results.append(
					{
						"action": "error",
						"franchise_name": _row_get(row, "Name"),
						"error": str(exc),
					}
				)
				frappe.log_error(frappe.get_traceback(), "Franchisee Import Row")

	created = sum(1 for r in results if r.get("action") == "created")
	updated = sum(1 for r in results if r.get("action") == "updated")
	errors = [r for r in results if r.get("action") == "error"]
	return {
		"ok": True,
		"path": str(path),
		"created": created,
		"updated": updated,
		"errors": len(errors),
		"error_rows": errors,
		"rows": results,
	}


def import_franchise_sheet(geocode: int = 1):
	"""bench execute entrypoint."""
	return import_franchise_csv(geocode=bool(cint(geocode)))
