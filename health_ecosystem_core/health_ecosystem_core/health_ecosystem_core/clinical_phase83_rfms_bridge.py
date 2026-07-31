"""
Phase 83: RFMS ↔ ERPNext integration bridge.

HMAC-authenticated APIs for RFMS to read safe public config and create/verify
Razorpay franchise payments. MSG91 authkey and Razorpay secret never leave ERP.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cstr, flt


def verify_rfms_bridge_signature(canonical: str, signature: str | None = None) -> None:
	from health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge import verify_onboard_signature

	verify_onboard_signature(canonical, signature)


def _parse_hec_payload(**kwargs) -> dict[str, Any]:
	raw = kwargs.get("hec_payload")
	if raw is None:
		raw = frappe.form_dict.get("hec_payload")
	if isinstance(raw, (bytes, bytearray)):
		raw = raw.decode("utf-8", errors="replace")
	if isinstance(raw, str) and raw.strip():
		try:
			parsed = json.loads(raw)
			if isinstance(parsed, dict):
				return parsed
		except Exception:
			frappe.throw(_("hec_payload must be canonical JSON"))
	# Fallback individual fields
	return {key: kwargs.get(key, frappe.form_dict.get(key)) for key in kwargs if key != "hec_payload"}


def canonical_rfms_config_payload(payload: dict[str, Any] | None = None) -> str:
	source = payload if isinstance(payload, dict) else {}
	ordered = {
		"action": "get_rfms_integration_config",
		"ts": cstr(source.get("ts") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def _amount_canonical(value: Any) -> str:
	"""Match RFMS bridge: String(Number(amount)) — whole numbers without .0."""
	n = flt(value or 0)
	if abs(n - int(n)) < 1e-9:
		return str(int(n))
	return f"{n:.2f}".rstrip("0").rstrip(".")


def canonical_rfms_order_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "create_rfms_razorpay_order",
		"amount": _amount_canonical(payload.get("amount")),
		"application_id": cstr(payload.get("application_id") or ""),
		"currency": cstr(payload.get("currency") or "INR"),
		"payment_key": cstr(payload.get("payment_key") or ""),
		"receipt": cstr(payload.get("receipt") or "")[:40],
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def canonical_rfms_verify_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "verify_rfms_razorpay_payment",
		"application_id": cstr(payload.get("application_id") or ""),
		"razorpay_order_id": cstr(payload.get("razorpay_order_id") or ""),
		"razorpay_payment_id": cstr(payload.get("razorpay_payment_id") or ""),
		"razorpay_signature": cstr(payload.get("razorpay_signature") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def rfms_integration_config_payload() -> dict[str, Any]:
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		ensure_cgpey_esign_fields,
		get_cgpey_credentials,
		get_google_maps_api_key,
		get_otp_provider,
		get_razorpay_key_id,
		google_maps_configured,
		otp_test_mode,
		razorpay_test_mode,
	)

	ensure_cgpey_esign_fields()
	otp_provider = get_otp_provider() or "Test"
	maps_key = get_google_maps_api_key()
	cgpey = get_cgpey_credentials()
	return {
		"razorpay_key_id": get_razorpay_key_id() or "",
		"razorpay_test_mode": bool(razorpay_test_mode()),
		"razorpay_configured": not razorpay_test_mode(),
		"otp_provider": otp_provider,
		"otp_test_mode": bool(otp_test_mode()),
		"contact_otp_via_erp": (otp_provider or "").strip().lower() not in ("", "test", "none", "mock"),
		"google_maps_api_key": maps_key if google_maps_configured() else "",
		"google_maps_configured": google_maps_configured(),
		# CGPEY secrets: HMAC server-to-server only (stripped from RFMS public-config).
		"cgpey_api_key": cgpey.get("api_key") or "",
		"cgpey_api_secret": cgpey.get("api_secret") or "",
		"cgpey_merchant_id": cgpey.get("merchant_id") or "",
		"cgpey_base_url": cgpey.get("base_url") or "https://verify.cgpey.com",
		"cgpey_simulate": bool(cgpey.get("simulate")),
		"cgpey_configured": bool(cgpey.get("configured")),
	}


def get_rfms_integration_config_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_rfms_config_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)
	return rfms_integration_config_payload()


def _create_live_razorpay_order(amount_inr: float, receipt: str) -> dict[str, Any]:
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_razorpay_key_id,
		get_razorpay_key_secret,
		razorpay_test_mode,
	)

	amount_paise = int(round(flt(amount_inr) * 100))
	if amount_paise <= 0:
		frappe.throw(_("Invalid payment amount"))

	key_id = get_razorpay_key_id() or ""
	key_secret = get_razorpay_key_secret() or ""

	if razorpay_test_mode() or not key_secret:
		return {
			"order_id": f"order_rfms_{cstr(receipt).replace('-', '_')[:40]}",
			"amount": flt(amount_inr),
			"amount_paise": amount_paise,
			"currency": "INR",
			"razorpay_key_id": key_id,
			"test_mode": True,
		}

	auth_header = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
	body = json.dumps(
		{
			"amount": amount_paise,
			"currency": "INR",
			"receipt": cstr(receipt)[:40],
			"payment_capture": 1,
			"notes": {"source": "rfms_franchise"},
		}
	).encode("utf-8")
	req = Request(
		"https://api.razorpay.com/v1/orders",
		data=body,
		headers={
			"Authorization": f"Basic {auth_header}",
			"Content-Type": "application/json",
		},
		method="POST",
	)
	try:
		with urlopen(req, timeout=20) as resp:
			order_data = json.loads(resp.read().decode("utf-8"))
	except HTTPError as exc:
		err_body = exc.read().decode("utf-8", errors="replace")
		frappe.log_error(title="create_rfms_razorpay_order", message=err_body)
		frappe.throw(_("Razorpay order creation failed"))

	return {
		"order_id": order_data.get("id"),
		"amount": flt(amount_inr),
		"amount_paise": amount_paise,
		"currency": order_data.get("currency", "INR"),
		"razorpay_key_id": key_id,
		"test_mode": False,
	}


def create_rfms_razorpay_order_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_rfms_order_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)
	amount = flt(payload.get("amount") or 0)
	receipt = cstr(payload.get("receipt") or payload.get("application_id") or "RFMS")[:40]
	result = _create_live_razorpay_order(amount, receipt)
	result["application_id"] = cstr(payload.get("application_id") or "")
	result["payment_key"] = cstr(payload.get("payment_key") or "")
	return result


def verify_rfms_razorpay_payment_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_rfms_verify_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	order_id = cstr(payload.get("razorpay_order_id") or "").strip()
	payment_id = cstr(payload.get("razorpay_payment_id") or "").strip()
	rzp_signature = cstr(payload.get("razorpay_signature") or "").strip()
	if not order_id or not payment_id:
		frappe.throw(_("Missing Razorpay order or payment id"))

	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_razorpay_key_secret,
		razorpay_test_mode,
	)

	if razorpay_test_mode():
		return {
			"verified": True,
			"test_mode": True,
			"razorpay_order_id": order_id,
			"razorpay_payment_id": payment_id,
		}

	if not rzp_signature:
		frappe.throw(_("Missing Razorpay signature"))
	key_secret = get_razorpay_key_secret() or ""
	if not key_secret:
		frappe.throw(_("Razorpay secret not configured on server"))
	expected = hmac.new(
		key_secret.encode("utf-8"),
		f"{order_id}|{payment_id}".encode("utf-8"),
		hashlib.sha256,
	).hexdigest()
	if not hmac.compare_digest(expected, rzp_signature):
		frappe.throw(_("Payment signature verification failed"), frappe.AuthenticationError)

	return {
		"verified": True,
		"test_mode": False,
		"razorpay_order_id": order_id,
		"razorpay_payment_id": payment_id,
	}


def ensure_phase83_maps_fields() -> None:
	"""Ensure google_maps_api_key exists even if DocType JSON reload is delayed."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	# Prefer native DocType field; custom field is a safety net for hot-deploy without migrate.
	meta = frappe.get_meta("Health Ecosystem Settings")
	if meta.has_field("google_maps_api_key"):
		return
	create_custom_fields(
		{
			"Health Ecosystem Settings": [
				{
					"fieldname": "section_break_ffms_maps",
					"label": "FFMS / Google Maps",
					"fieldtype": "Section Break",
					"insert_after": "razorpay_key_secret",
					"collapsible": 1,
				},
				{
					"fieldname": "google_maps_api_key",
					"label": "Google Maps API Key",
					"fieldtype": "Data",
					"insert_after": "section_break_ffms_maps",
					"description": "Browser Maps JavaScript API key for RFMS admin territory maps.",
				},
			]
		},
		update=True,
	)


def setup_phase83() -> dict[str, Any]:
	ensure_phase83_maps_fields()
	frappe.clear_cache()
	return {"ok": True, "phase": 83, "config": rfms_integration_config_payload()}
