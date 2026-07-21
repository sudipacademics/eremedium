"""Email helpers — verification tokens, portal links, GoDaddy/ERPNext sendmail."""

import re
import secrets

import frappe
from frappe import _
from frappe.utils import get_url, now_datetime

VERIFY_TTL_SECONDS = 86400
TOKEN_PURPOSES = ("signup", "email_login")


def _settings():
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return frappe.get_single("Health Ecosystem Settings")
    return None


def _normalize_portal_scheme(url):
    """Use HTTPS for public patient portal hosts (production TLS at nginx)."""
    url = str(url or "").rstrip("/")
    if not url:
        return url
    if url.startswith("http://") and "e-remedium.in" in url:
        return "https://" + url[len("http://") :]
    return url


def portal_base_url():
    settings = _settings()
    configured = None
    if settings and getattr(settings, "patient_portal_base_url", None):
        configured = str(settings.patient_portal_base_url).rstrip("/")
    else:
        conf = frappe.conf.get("hec_patient_portal_url") or frappe.conf.get("hec_portal_url")
        if conf:
            configured = str(conf).rstrip("/")
        else:
            configured = get_url().rstrip("/")

    try:
        if getattr(frappe.local, "request", None):
            host = (frappe.get_request_header("Host") or "").split(":")[0].strip().lower()
            proto = (frappe.get_request_header("X-Forwarded-Proto") or frappe.request.scheme or "").lower()
            if host and proto == "https":
                return f"https://{host}"
    except Exception:
        pass

    return _normalize_portal_scheme(configured)


def support_email():
    settings = _settings()
    if settings and getattr(settings, "support_email", None):
        return settings.support_email.strip()
    return (frappe.conf.get("hec_support_email") or "support@healthecosystem.local").strip()


def noreply_email():
    settings = _settings()
    if settings and getattr(settings, "noreply_email", None):
        return settings.noreply_email.strip()
    return (frappe.conf.get("hec_noreply_email") or support_email()).strip()


def email_signup_enabled():
    settings = _settings()
    if settings and hasattr(settings, "enable_email_signup"):
        return bool(settings.enable_email_signup)
    return bool(frappe.conf.get("hec_enable_email_signup", 1))


def is_real_email(email):
    if not email or "@" not in email:
        return False
    email = email.strip().lower()
    if email.endswith("@otp.health.local") or email.endswith("@health.local"):
        return False
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


def email_configured():
    if frappe.db.exists("Email Account", {"default_outgoing": 1, "enable_outgoing": 1}):
        return True
    return bool(frappe.conf.get("mail_server") and frappe.conf.get("mail_login"))


def ensure_outgoing_email_account():
    """Create default outgoing Email Account from site_config when missing."""
    if email_configured():
        return True, None

    email = frappe.conf.get("hec_noreply_email") or frappe.conf.get("hec_support_email")
    password = frappe.conf.get("hec_noreply_password") or frappe.conf.get("hec_smtp_password")
    if not email or not password:
        return False, _("Gmail not configured. Run patch-gmail-site-config.sh on the server.")

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_email_setup import (
            setup_godaddy_email_from_site_config,
        )

        setup_godaddy_email_from_site_config()
        frappe.db.commit()
        if email_configured():
            return True, None
        return False, _("Email Account was created but default outgoing is still missing.")
    except Exception as exc:
        frappe.log_error(title="ensure_outgoing_email_account", message=frappe.get_traceback())
        return False, str(exc)


def send_hec_email(recipients, subject, message, html=None):
    recipients = [r for r in (recipients or []) if r and "@" in r]
    if not recipients:
        return False, _("No recipient email")

    ok, setup_err = ensure_outgoing_email_account()
    if not ok:
        return False, setup_err or _("SMTP not configured")

    try:
        frappe.sendmail(
            recipients=recipients,
            sender=noreply_email(),
            subject=subject,
            message=html or message.replace("\n", "<br>"),
            now=True,
        )
        return True, None
    except Exception as exc:
        frappe.log_error(title="HEC email send", message=frappe.get_traceback())
        detail = str(exc).strip()
        if "default Email Account" in detail:
            detail = _("No default Email Account. Run: bash setup-email-gmail.sh on the server.")
        elif "Authentication" in detail or "authentication" in detail:
            detail = _("Gmail rejected login. Use a 16-character App Password, not your normal password.")
        return False, detail or _("Could not send email")


def _token_cache_key(token):
    return f"hec_email_token:{token}"


def issue_email_token(email, purpose, payload=None):
    token = secrets.token_urlsafe(32)
    data = {
        "email": email.strip().lower(),
        "purpose": purpose,
        "payload": payload or {},
        "issued_at": str(now_datetime()),
    }
    frappe.cache().set_value(_token_cache_key(token), data, expires_in_sec=VERIFY_TTL_SECONDS)
    return token


def consume_email_token(token, purpose=None):
    if not token:
        return None, _("Invalid or expired link")
    data = frappe.cache().get_value(_token_cache_key(token))
    if not data:
        return None, _("Invalid or expired link")
    if purpose and data.get("purpose") != purpose:
        return None, _("Invalid verification link")
    frappe.cache().delete_value(_token_cache_key(token))
    return data, None


def send_verification_email(email, full_name=None):
    user = frappe.db.get_value("User", {"email": email}, "name")
    if not user:
        return False, _("User not found")

    token = issue_email_token(email, "signup", {"user": user})
    link = f"{portal_base_url()}/verify-email?token={token}"
    name = full_name or frappe.db.get_value("User", user, "full_name") or "there"
    subject = "Verify your Health Ecosystem account"
    body = (
        f"Hi {name},\n\n"
        f"Please verify your email to activate your patient account:\n{link}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you did not sign up, ignore this email.\n"
    )
    sent, err = send_hec_email([email], subject, body)
    if not sent:
        return False, err or _("Could not send verification email. SMTP may not be configured yet.")
    return True, None


def send_password_reset_notice(email):
    subject = "Password reset requested"
    body = (
        "We received a request to reset your Health Ecosystem password.\n"
        "If an account exists, you will receive a separate email from ERPNext with a reset link.\n"
        "If you did not request this, you can ignore this message."
    )
    send_hec_email([email], subject, body)
    return True


def mark_user_email_verified(user):
    ensure_user_email_fields()
    frappe.db.set_value("User", user, "hec_email_verified", 1, update_modified=False)


def user_requires_email_verification(user):
    ensure_user_email_fields()
    email = (frappe.db.get_value("User", user, "email") or "").lower()
    if not is_real_email(email):
        return False
    verified = frappe.db.get_value("User", user, "hec_email_verified")
    return not bool(verified)


def ensure_user_email_fields():
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_email_verified"}):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "User",
            "fieldname": "hec_email_verified",
            "label": "HEC Email Verified",
            "fieldtype": "Check",
            "default": "0",
            "insert_after": "email",
            "hidden": 1,
        }
    ).insert(ignore_permissions=True)
    frappe.clear_cache(doctype="User")


def smoke_test_email():
    target = support_email()
    ok, err = send_hec_email(
        [target],
        "Health Ecosystem email test",
        f"SMTP test from {frappe.local.site} at {now_datetime()}",
    )
    return {
        "ok": ok,
        "error": err,
        "configured": email_configured(),
        "support_email": target,
        "noreply_email": noreply_email(),
        "portal_url": portal_base_url(),
    }
