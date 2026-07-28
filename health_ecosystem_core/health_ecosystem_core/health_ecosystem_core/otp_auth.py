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


@frappe.whitelist(allow_guest=True)
def verify_otp(mobile=None, otp=None):
    """Verify OTP only (no Frappe session). Used by RFMS/FFMS login after MSG91 delivery."""
    frappe.flags.ignore_csrf = True
    mobile = _parse_request_value("mobile", mobile)
    otp = _parse_request_value("otp", otp)

    ok, err = verify_otp_code(mobile, otp)
    if not ok:
        return _error(err, 401)

    return _success(
        {
            "mobile": normalize_mobile(mobile),
            "verified": True,
            "test_mode": otp_test_mode(),
        },
        message="OTP verified",
    )


def _normalize_email(raw):
    email = (raw or "").strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return None
    return email


def _email_otp_send_rate_key(email):
    return f"hec_email_otp_send:{email}"


@frappe.whitelist(allow_guest=True)
def send_email_otp(email=None):
    """Send MSG91 Email OTP (officer / RFMS). MSG91 generates the code when not in test mode."""
    frappe.flags.ignore_csrf = True
    email = _normalize_email(_parse_request_value("email", email))
    if not email:
        return _error(_("Enter a valid email address"))

    send_count = frappe.cache().get_value(_email_otp_send_rate_key(email)) or 0
    if int(send_count) >= 5:
        return _error(_("Too many OTP requests. Try again in an hour."))

    payload = {
        "email": email,
        "expires_in": 300,
        "test_mode": otp_test_mode(),
        "channel": "email",
    }

    if otp_test_mode():
        from health_ecosystem_core.health_ecosystem_core.clinical_otp import TEST_OTP_CODE

        frappe.cache().set_value(
            f"hec_email_otp:{email}",
            {"code": TEST_OTP_CODE, "attempts": 0},
            expires_in_sec=300,
        )
        frappe.cache().set_value(_email_otp_send_rate_key(email), int(send_count) + 1, expires_in_sec=3600)
        frappe.logger("hec_otp").info(f"Test email OTP for {email}: {TEST_OTP_CODE}")
        payload["hint"] = "Test mode: use OTP 123456"
        return _success(payload, message="OTP sent")

    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_msg91_email_otp
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_msg91_email_otp_template_id

    if not get_msg91_email_otp_template_id():
        return _error(_("MSG91 Email OTP template is not configured"))

    if not send_msg91_email_otp(email):
        return _error(_("Could not send email OTP. Try again later."))

    frappe.cache().set_value(_email_otp_send_rate_key(email), int(send_count) + 1, expires_in_sec=3600)
    return _success(payload, message="OTP sent")


@frappe.whitelist(allow_guest=True)
def verify_email_otp(email=None, otp=None):
    """Verify MSG91 Email OTP (no Frappe session)."""
    frappe.flags.ignore_csrf = True
    email = _normalize_email(_parse_request_value("email", email))
    otp = (_parse_request_value("otp", otp) or "").strip()
    if not email:
        return _error(_("Enter a valid email address"), 401)
    if not otp:
        return _error(_("Enter the OTP"), 401)

    if otp_test_mode():
        from health_ecosystem_core.health_ecosystem_core.clinical_otp import TEST_OTP_CODE

        cached = frappe.cache().get_value(f"hec_email_otp:{email}") or {}
        code = cached.get("code") if isinstance(cached, dict) else None
        if otp != (code or TEST_OTP_CODE):
            return _error(_("Invalid or expired OTP"), 401)
        frappe.cache().delete_value(f"hec_email_otp:{email}")
        return _success(
            {"email": email, "verified": True, "test_mode": True, "channel": "email"},
            message="OTP verified",
        )

    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import verify_msg91_email_otp

    if not verify_msg91_email_otp(email, otp):
        return _error(_("Invalid or expired OTP"), 401)

    return _success(
        {"email": email, "verified": True, "test_mode": False, "channel": "email"},
        message="OTP verified",
    )
