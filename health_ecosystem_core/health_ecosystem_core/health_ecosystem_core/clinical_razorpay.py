"""Phase 121.0 — server-side Razorpay lookups used to bind a checkout callback to the document being paid."""

import base64
import hashlib
import hmac
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe
from frappe.utils import cint, cstr

API_BASE = "https://api.razorpay.com/v1"


class RazorpayUnreachable(Exception):
	"""Razorpay API could not be reached; callers decide whether to fall back to signature-only."""


def _auth_header():
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_razorpay_key_id,
		get_razorpay_key_secret,
	)

	key_id = get_razorpay_key_id() or ""
	key_secret = get_razorpay_key_secret() or ""
	return "Basic " + base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")


def _get(path):
	req = Request(f"{API_BASE}{path}", headers={"Authorization": _auth_header()}, method="GET")
	try:
		with urlopen(req, timeout=15) as resp:
			return json.loads(resp.read().decode("utf-8"))
	except HTTPError as exc:
		body = exc.read().decode("utf-8", errors="replace")
		if exc.code in (400, 404):
			return None
		frappe.log_error(title="razorpay_lookup", message=f"{path}: {exc.code} {body}")
		raise RazorpayUnreachable(str(exc)) from exc
	except (URLError, TimeoutError, OSError) as exc:
		frappe.log_error(title="razorpay_lookup", message=f"{path}: {exc}")
		raise RazorpayUnreachable(str(exc)) from exc


def signature_valid(order_id, payment_id, signature):
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_razorpay_key_secret

	key_secret = get_razorpay_key_secret() or ""
	if not key_secret or not signature:
		return False
	expected = hmac.new(
		key_secret.encode("utf-8"),
		f"{order_id}|{payment_id}".encode("utf-8"),
		hashlib.sha256,
	).hexdigest()
	return hmac.compare_digest(expected, cstr(signature))


def confirm_payment(order_id, payment_id, *, expected_receipt=None, expected_amount_paise=None):
	"""Fetch payment + order from Razorpay and check they match what we expect.

	Returns {"ok": bool, "reason": str, "amount_paise": int, "checked": bool}. When Razorpay is unreachable
	"checked" is False and "ok" is True, so a genuinely paid customer is not blocked by a network blip
	(the HMAC signature has already proven the payment belongs to the order).
	"""
	try:
		payment = _get(f"/payments/{payment_id}")
		if not payment:
			return {"ok": False, "reason": "payment_not_found", "checked": True}
		if cstr(payment.get("order_id")) != cstr(order_id):
			return {"ok": False, "reason": "order_mismatch", "checked": True}
		if cstr(payment.get("status")) not in ("captured", "authorized"):
			return {"ok": False, "reason": f"payment_{payment.get('status')}", "checked": True}
		amount_paise = cint(payment.get("amount"))
		if expected_amount_paise is not None and amount_paise != cint(expected_amount_paise):
			return {"ok": False, "reason": "amount_mismatch", "amount_paise": amount_paise, "checked": True}
		if expected_receipt:
			order = _get(f"/orders/{order_id}") or {}
			if cstr(order.get("receipt")) != cstr(expected_receipt)[:40]:
				return {"ok": False, "reason": "receipt_mismatch", "amount_paise": amount_paise, "checked": True}
		return {"ok": True, "reason": "", "amount_paise": amount_paise, "checked": True}
	except RazorpayUnreachable:
		return {"ok": True, "reason": "razorpay_unreachable", "checked": False}
