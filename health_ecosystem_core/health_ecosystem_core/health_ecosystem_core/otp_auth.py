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

    return _success(payload, message="OTP sent")


@frappe.whitelist(allow_guest=True)
def verify_otp_and_login(mobile=None, otp=None, referral_code=None):
    """Verify OTP and start a Frappe session (patient portal)."""
    frappe.flags.ignore_csrf = True
    mobile = _parse_request_value("mobile", mobile)
    otp = _parse_request_value("otp", otp)
    referral_code = (_parse_request_value("referral_code", referral_code) or "").strip() or None

    ok, err = verify_otp_code(mobile, otp)
    if not ok:
        return _error(err, 401)

    mobile = normalize_mobile(mobile)
    try:
        user_id = ensure_patient_user_for_mobile(mobile, referral_code=referral_code)
    except Exception:
        frappe.log_error(title="verify_otp_and_login_user", message=frappe.get_traceback())
        return _error(_("Could not create or open your patient account. Please try again."), 500)

    try:
        login_manager = frappe.local.login_manager
        login_manager.login_as(user_id)
        login_manager.post_login()
    except Exception:
        frappe.log_error(title="verify_otp_and_login", message=frappe.get_traceback())
        enabled = frappe.db.get_value("User", user_id, "enabled")
        if not enabled:
            return _error(
                _("This mobile number is linked to a disabled account. Contact support or sign in with email."),
                403,
            )
        return _error(_("Login failed after OTP verification. Try again or use Google / email sign-in."), 500)

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
    """Send Email OTP for RFMS contact verification.

    Prefer MSG91 Email OTP when configured; otherwise (or on MSG91 failure)
    generate a code and deliver via ERP SMTP (Frappe sendmail).
    """
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
            {"code": TEST_OTP_CODE, "attempts": 0, "provider": "test"},
            expires_in_sec=300,
        )
        frappe.cache().set_value(_email_otp_send_rate_key(email), int(send_count) + 1, expires_in_sec=3600)
        frappe.logger("hec_otp").info(f"Test email OTP for {email}: {TEST_OTP_CODE}")
        return _success(payload, message="OTP sent")

    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_msg91_email_otp
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_msg91_email_otp_template_id

    # 1) MSG91 Email OTP (MSG91 generates the code) when a template is configured.
    if get_msg91_email_otp_template_id() and send_msg91_email_otp(email):
        frappe.cache().set_value(
            f"hec_email_otp:{email}",
            {"provider": "msg91", "attempts": 0},
            expires_in_sec=300,
        )
        frappe.cache().set_value(_email_otp_send_rate_key(email), int(send_count) + 1, expires_in_sec=3600)
        payload["provider"] = "msg91"
        return _success(payload, message="OTP sent")

    # 2) SMTP fallback — generate OTP locally and email via ERP outgoing account.
    import random

    from health_ecosystem_core.health_ecosystem_core.clinical_email import send_hec_email

    code = f"{random.randint(0, 999999):06d}"
    subject = "Remedium Lab verification code"
    body = (
        f"Your Remedium Lab email verification code is {code}.\n\n"
        f"This code expires in 5 minutes. If you did not request it, ignore this email."
    )
    html = (
        f"<p>Your Remedium Lab email verification code is "
        f"<strong style='font-size:20px;letter-spacing:2px'>{code}</strong>.</p>"
        f"<p>This code expires in 5 minutes. If you did not request it, ignore this email.</p>"
    )
    ok, err = send_hec_email([email], subject, body, html=html)
    if not ok:
        frappe.logger("hec_otp").error(f"Email OTP SMTP fallback failed for {email}: {err}")
        return _error(err or _("Could not send email OTP. Try again later."))

    frappe.cache().set_value(
        f"hec_email_otp:{email}",
        {"code": code, "attempts": 0, "provider": "smtp"},
        expires_in_sec=300,
    )
    frappe.cache().set_value(_email_otp_send_rate_key(email), int(send_count) + 1, expires_in_sec=3600)
    payload["provider"] = "smtp"
    return _success(payload, message="OTP sent")


@frappe.whitelist(allow_guest=True)
def verify_email_otp(email=None, otp=None):
    """Verify Email OTP (MSG91 or SMTP/local cache)."""
    frappe.flags.ignore_csrf = True
    email = _normalize_email(_parse_request_value("email", email))
    otp = (_parse_request_value("otp", otp) or "").strip()
    if not email:
        return _error(_("Enter a valid email address"), 401)
    if not otp:
        return _error(_("Enter the OTP"), 401)

    cached = frappe.cache().get_value(f"hec_email_otp:{email}") or {}
    provider = str(cached.get("provider") or "").lower() if isinstance(cached, dict) else ""

    if otp_test_mode() or provider in ("test", "smtp", "local") or (isinstance(cached, dict) and cached.get("code")):
        from health_ecosystem_core.health_ecosystem_core.clinical_otp import TEST_OTP_CODE

        code = cached.get("code") if isinstance(cached, dict) else None
        expected = code or (TEST_OTP_CODE if otp_test_mode() else None)
        attempts = int(cached.get("attempts") or 0) if isinstance(cached, dict) else 0
        if attempts >= 5:
            frappe.cache().delete_value(f"hec_email_otp:{email}")
            return _error(_("Too many incorrect attempts. Request a new OTP."), 401)
        if not expected or otp != str(expected):
            if isinstance(cached, dict):
                cached["attempts"] = attempts + 1
                frappe.cache().set_value(f"hec_email_otp:{email}", cached, expires_in_sec=300)
            return _error(_("Invalid or expired OTP"), 401)
        frappe.cache().delete_value(f"hec_email_otp:{email}")
        return _success(
            {
                "email": email,
                "verified": True,
                "test_mode": otp_test_mode(),
                "channel": "email",
                "provider": provider or "local",
            },
            message="OTP verified",
        )

    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import verify_msg91_email_otp

    if not verify_msg91_email_otp(email, otp):
        return _error(_("Invalid or expired OTP"), 401)

    frappe.cache().delete_value(f"hec_email_otp:{email}")
    return _success(
        {"email": email, "verified": True, "test_mode": False, "channel": "email", "provider": "msg91"},
        message="OTP verified",
    )
