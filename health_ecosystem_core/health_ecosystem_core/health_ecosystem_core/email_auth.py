"""Email signup, verification, and forgot-password APIs — Phase 18."""

import re

import frappe
from frappe import _
from frappe.utils.password import update_password

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _resolve_user_id,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_email import (
    consume_email_token,
    email_signup_enabled,
    is_real_email,
    mark_user_email_verified,
    send_password_reset_notice,
    send_verification_email,
    user_requires_email_verification,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE, link_user_to_health_patient
from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile


def _validate_password(password):
    password = (password or "").strip()
    if len(password) < 8:
        return _("Password must be at least 8 characters")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return _("Password must include letters and numbers")
    return None


@frappe.whitelist(allow_guest=True)
def register_patient(
    email=None,
    password=None,
    full_name=None,
    mobile=None,
):
    """Create a Website User patient account and send email verification."""
    frappe.flags.ignore_csrf = True
    if not email_signup_enabled():
        return _error(_("Email signup is not enabled on this site"))

    email = (_parse_request_value("email", email) or "").strip().lower()
    password = _parse_request_value("password", password) or ""
    full_name = (_parse_request_value("full_name", full_name) or "").strip()
    mobile = _parse_request_value("mobile", mobile)

    if not is_real_email(email):
        return _error(_("Enter a valid email address"))
    pwd_err = _validate_password(password)
    if pwd_err:
        return _error(pwd_err)
    if not full_name or len(full_name) < 2:
        return _error(_("Full name is required"))

    if frappe.db.exists("User", email):
        return _error(_("An account with this email already exists. Try signing in or reset your password."))

    mobile_norm = normalize_mobile(mobile) if mobile else None

    from health_ecosystem_core.health_ecosystem_core.clinical_email import ensure_user_email_fields

    ensure_user_email_fields()
    parts = full_name.split(None, 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else ""

    user = frappe.get_doc(
        {
            "doctype": "User",
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "mobile_no": mobile_norm,
            "user_type": "Website User",
            "send_welcome_email": 0,
            "enabled": 1,
            "hec_email_verified": 0,
        }
    )
    user.append("roles", {"role": PATIENT_ROLE})
    user.insert(ignore_permissions=True)
    update_password(email, password, logout_all_sessions=False)

    link_user_to_health_patient(email, patient_name=full_name, phone=mobile_norm)

    sent, err = send_verification_email(email, full_name=full_name)
    if not sent:
        frappe.delete_doc("User", email, force=1, ignore_permissions=True)
        frappe.db.commit()
        return _error(err or _("Could not send verification email"))

    frappe.db.commit()
    return _success(
        {"email": email, "verification_sent": True},
        message=_("Account created. Check your email to verify before signing in."),
    )


@frappe.whitelist(allow_guest=True)
def verify_email(token=None):
    """Activate account from email verification link."""
    frappe.flags.ignore_csrf = True
    token = (_parse_request_value("token", token) or "").strip()
    data, err = consume_email_token(token, purpose="signup")
    if err:
        return _error(err)

    email = data.get("email")
    user = data.get("payload", {}).get("user") or frappe.db.get_value("User", {"email": email}, "name")
    if not user or not frappe.db.exists("User", user):
        return _error(_("User not found"))

    mark_user_email_verified(user)
    frappe.db.commit()

    return _success(
        {"email": email, "user": user, "verified": True},
        message=_("Email verified. You can sign in now."),
    )


@frappe.whitelist(allow_guest=True)
def resend_verification_email(email=None):
    """Resend signup verification email."""
    frappe.flags.ignore_csrf = True
    email = (_parse_request_value("email", email) or "").strip().lower()
    if not is_real_email(email):
        return _error(_("Enter a valid email address"))

    user = frappe.db.get_value("User", {"email": email}, "name")
    if user and not user_requires_email_verification(user):
        return _success({}, message=_("If the account exists, a verification email was sent."))

    if user:
        full_name = frappe.db.get_value("User", user, "full_name")
        send_verification_email(email, full_name=full_name)

    return _success({}, message=_("If the account exists, a verification email was sent."))


@frappe.whitelist(allow_guest=True)
def forgot_password_email(email=None):
    """Send ERPNext password reset email (wrapper with audit notice)."""
    frappe.flags.ignore_csrf = True
    email = (_parse_request_value("email", email) or "").strip().lower()
    if not email:
        return _error(_("Email is required"))

    user = _resolve_user_id(email)
    if user and frappe.db.exists("User", user):
        try:
            from frappe.core.doctype.user.user import reset_password

            reset_password(user)
            send_password_reset_notice(email)
        except Exception:
            frappe.log_error(title="forgot_password_email", message=frappe.get_traceback())

    return _success({}, message=_("If the account exists, a password reset email was sent."))
