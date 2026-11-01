"""One-off OTP smoke — bench execute health_ecosystem_core.health_ecosystem_core.smoke_otp_login.run"""
from __future__ import annotations

import frappe

from health_ecosystem_core.health_ecosystem_core.clinical_otp import send_otp_to_mobile
from health_ecosystem_core.health_ecosystem_core.otp_auth import verify_otp_and_login


def run(mobile="7585004905"):
	mobile = str(mobile).strip()
	sent, err = send_otp_to_mobile(mobile)
	if err:
		return {"ok": False, "step": "send", "error": str(err)}
	cached = frappe.cache().get_value(f"hec_otp:{sent}") or {}
	code = cached.get("code")
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import (
		ensure_patient_user_for_mobile,
		verify_otp_code,
	)

	ok, verr = verify_otp_code(mobile, code)
	if not ok:
		return {"ok": False, "step": "verify", "error": str(verr)}
	try:
		user_id = ensure_patient_user_for_mobile(mobile)
	except Exception as exc:
		frappe.log_error(title="smoke_otp_user", message=frappe.get_traceback())
		return {"ok": False, "step": "user", "error": str(exc), "trace": frappe.get_traceback()[-1200:]}
	info = frappe.db.get_value(
		"User",
		user_id,
		["enabled", "user_type", "mobile_no"],
		as_dict=True,
	)
	try:
		login_manager = frappe.local.login_manager
		login_manager.login_as(user_id)
		login_manager.post_login()
	except Exception as exc:
		frappe.log_error(title="smoke_otp_login", message=frappe.get_traceback())
		return {
			"ok": False,
			"step": "login",
			"user_id": user_id,
			"user": info,
			"error": str(exc),
			"trace": frappe.get_traceback()[-1500:],
		}
	return {
		"ok": True,
		"user_id": user_id,
		"sid": (frappe.session.sid or "")[:20],
		"user": info,
	}
