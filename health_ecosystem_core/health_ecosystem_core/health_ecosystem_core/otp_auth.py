"""Guest OTP login APIs — Phase 13."""

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_otp import (
    ensure_patient_user_for_mobile,
    normalize_mobile,
    otp_test_mode,
    send_otp_to_mobile,
    verify_otp_code,
)


@frappe.whitelist(allow_guest=True)
def send_otp(mobile=None):
    """Send a one-time password to the patient's mobile."""
    frappe.flags.ignore_csrf = True
    mobile = _parse_request_value("mobile", mobile)
    sent_to, err = send_otp_to_mobile(mobile)
    if err:
        return _error(err)

    payload = {
        "mobile": sent_to,
        "expires_in": 300,
        "test_mode": otp_test_mode(),
    }
    if otp_test_mode():
        payload["hint"] = "Test mode: use OTP 123456"

    return _success(payload, message="OTP sent")


@frappe.whitelist(allow_guest=True)
def verify_otp_and_login(mobile=None, otp=None):
    """Verify OTP and start a Frappe session (patient portal)."""
    frappe.flags.ignore_csrf = True
    mobile = _parse_request_value("mobile", mobile)
    otp = _parse_request_value("otp", otp)

    ok, err = verify_otp_code(mobile, otp)
    if not ok:
        return _error(err, 401)

    mobile = normalize_mobile(mobile)
    user_id = ensure_patient_user_for_mobile(mobile)

    try:
        login_manager = frappe.local.login_manager
        login_manager.login_as(user_id)
        login_manager.post_login()
    except Exception:
        frappe.log_error(title="verify_otp_and_login", message=frappe.get_traceback())
        return _error(_("Login failed after OTP verification"), 500)

    user = frappe.get_doc("User", user_id)
    roles = [r.role for r in user.roles]

    return _success(
        {
            "user": user_id,
            "username": user.username or user_id,
            "full_name": user.full_name,
            "roles": roles,
            "sid": frappe.session.sid,
            "must_change_password": False,
            "franchisee": None,
            "mobile": mobile,
        },
        message="Authenticated",
    )
