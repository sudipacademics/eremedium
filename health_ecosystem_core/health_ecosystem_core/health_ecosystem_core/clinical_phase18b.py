"""Phase 18b — Google / social sign-in for patient web (Frappe Social Login Key)."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, quote, urlparse
import base64

import frappe
from frappe import _
from frappe.utils import get_url

from health_ecosystem_core.health_ecosystem_core.api import (
    _ensure_mobile_session,
    _error,
    _parse_request_value,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_email import (
    mark_user_email_verified,
    portal_base_url,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
    PATIENT_ROLE,
    ensure_patient_portal_role,
    link_user_to_health_patient,
)

STAFF_ROLES = {
    "Health System Admin",
    "System Manager",
    "Franchisee Operator",
    "Lab Technician",
    "Phlebotomist",
    "Pathologist",
    "Physician",
    "Nurse",
    "Sales Representative",
    "Sales Manager",
}

GOOGLE_PROVIDER_NAMES = ("google", "Google")
# Must match Google Cloud Console — standard Frappe path (overridden to SPA handoff).
GOOGLE_OAUTH_REDIRECT_PATH = "/api/method/frappe.integrations.oauth2_logins.login_via_google"
CANONICAL_PORTAL_ORIGIN = "https://www.e-remedium.in"


def _google_oauth_provider_key():
    return _social_login_key_name("Google") or "google"


def _decode_oauth_state(state_b64):
    if not state_b64:
        return {}
    try:
        raw = state_b64.strip()
        padding = "=" * (-len(raw) % 4)
        return json.loads(base64.b64decode(raw + padding).decode("utf-8"))
    except Exception:
        return {}


def _oauth_redirect_target(state_b64):
    """Always hand off to the SPA OAuth callback — never the bare portal home."""
    state_data = _decode_oauth_state(state_b64)
    redirect_to = (state_data.get("redirect_to") or "").strip()
    next_path = None
    if redirect_to:
        parsed = urlparse(redirect_to)
        if parsed.path.rstrip("/") == "/oauth/callback":
            next_vals = parse_qs(parsed.query).get("next") or []
            if next_vals and str(next_vals[0]).startswith("/"):
                next_path = str(next_vals[0])
    return oauth_callback_path(next_path=next_path)


def _redirect_portal(location):
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = location


def _redirect_oauth_error(message):
    target = oauth_callback_path()
    sep = "&" if "?" in target else "?"
    _redirect_portal(f"{target}{sep}oauth_error={quote(str(message))}")


def _redirect_with_login_token(redirect_to, login_token):
    target = redirect_to or oauth_callback_path()
    sep = "&" if "?" in target else "?"
    sid = getattr(getattr(frappe.local, "session", None), "sid", None) or ""
    url = f"{target}{sep}login_token={quote(login_token)}"
    if sid and sid not in ("Guest", "None"):
        url = f"{url}&sid={quote(sid)}"
    _redirect_portal(url)


def _oauth_public_base(redirect_to=None):
    """Public origin for OAuth links — align with browser when redirect_to is HTTPS."""
    redirect_to = (redirect_to or "").strip()
    if redirect_to:
        parsed = urlparse(redirect_to)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return portal_base_url()


def _canonical_portal_origin(redirect_to=None):
    redirect_to = (redirect_to or "").strip()
    if redirect_to:
        parsed = urlparse(redirect_to)
        if parsed.netloc and parsed.netloc.endswith("e-remedium.in"):
            return CANONICAL_PORTAL_ORIGIN
    configured = portal_base_url()
    if configured and "e-remedium.in" in configured:
        return CANONICAL_PORTAL_ORIGIN
    return configured or CANONICAL_PORTAL_ORIGIN


def oauth_callback_path(next_path=None, redirect_to=None):
    base = f"{_canonical_portal_origin(redirect_to)}/oauth/callback"
    if next_path and next_path.startswith("/"):
        return f"{base}?next={quote(next_path, safe='')}"
    return base


def frappe_oauth_callback_url():
    """Redirect URI registered in Google Cloud Console."""
    return f"{portal_base_url()}{GOOGLE_OAUTH_REDIRECT_PATH}"


def _social_login_key_name(provider_name):
    provider_name = (provider_name or "").strip()
    if not provider_name:
        return ""
    return (
        frappe.db.get_value("Social Login Key", {"provider_name": provider_name}, "name")
        or frappe.db.get_value("Social Login Key", provider_name, "name")
        or frappe.scrub(provider_name)
    )


def build_oauth_login_url(provider_name, redirect_to=None):
    """Build Google authorize URL using Frappe's native OAuth helper."""
    from frappe.utils.oauth import get_oauth2_authorize_url

    redirect_to = redirect_to or oauth_callback_path(redirect_to=redirect_to)
    key_name = _social_login_key_name(provider_name)
    if not key_name:
        frappe.throw(_("Social login provider is not configured."))
    return get_oauth2_authorize_url(key_name, redirect_to)


def _google_credentials():
    client_id = (
        frappe.conf.get("hec_google_client_id")
        or frappe.conf.get("google_client_id")
        or frappe.conf.get("google_oauth_client_id")
    )
    client_secret = (
        frappe.conf.get("hec_google_client_secret")
        or frappe.conf.get("google_client_secret")
        or frappe.conf.get("google_oauth_client_secret")
    )
    return (client_id or "").strip(), (client_secret or "").strip()


def _google_provider_template():
    """Frappe-required OAuth endpoints for Google (authorize URL etc.)."""
    try:
        from frappe.integrations.doctype.social_login_key.social_login_key import SocialLoginKey

        providers = SocialLoginKey.get_social_login_providers()
        template = providers.get("Google") or providers.get("google")
        if template:
            return dict(template)
    except Exception:
        pass

    return {
        "social_login_provider": "Google",
        "provider_name": "Google",
        "enable_social_login": 1,
        "base_url": "https://www.googleapis.com",
        "custom_base_url": 0,
        "icon": "fa fa-google",
        "authorize_url": "https://accounts.google.com/o/oauth2/auth",
        "access_token_url": "https://accounts.google.com/o/oauth2/token",
        "redirect_url": GOOGLE_OAUTH_REDIRECT_PATH,
        "api_endpoint": "oauth2/v2/userinfo",
        "sign_ups": "Allow",
        "auth_url_data": json.dumps(
            {
                "scope": (
                    "https://www.googleapis.com/auth/userinfo.profile "
                    "https://www.googleapis.com/auth/userinfo.email"
                ),
                "response_type": "code",
            }
        ),
    }


def ensure_google_social_login_key():
    """Create or update Google Social Login Key from site_config when credentials exist."""
    if not frappe.db.exists("DocType", "Social Login Key"):
        return {"configured": False, "reason": "Social Login Key DocType missing"}

    client_id, client_secret = _google_credentials()
    if not client_id or not client_secret:
        existing = frappe.db.get_value(
            "Social Login Key",
            {"provider_name": ["in", list(GOOGLE_PROVIDER_NAMES)]},
            ["name", "enable_social_login", "client_id", "authorize_url"],
            as_dict=True,
        )
        return {
            "configured": bool(
                existing
                and existing.enable_social_login
                and existing.client_id
                and existing.authorize_url
            ),
            "provider": existing.name if existing else None,
            "source": "desk",
        }

    redirect_url = frappe_oauth_callback_url()
    name = (
        frappe.db.get_value(
            "Social Login Key",
            {"provider_name": ["in", list(GOOGLE_PROVIDER_NAMES)]},
            "name",
        )
        or frappe.db.get_value("Social Login Key", "google", "name")
    )

    values = _google_provider_template()
    values.update(
        {
            "doctype": "Social Login Key",
            "enable_social_login": 1,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_url": GOOGLE_OAUTH_REDIRECT_PATH,
            "sign_ups": "Allow",
        }
    )
    if name:
        doc = frappe.get_doc("Social Login Key", name)
        doc.update(values)
        doc.save(ignore_permissions=True)
    else:
        frappe.get_doc(values).insert(ignore_permissions=True)

    return {
        "configured": True,
        "provider": values.get("provider_name") or "Google",
        "redirect_url": redirect_url,
        "authorize_url": values.get("authorize_url"),
        "source": "site_config",
    }


def _allow_website_signup():
    if not frappe.db.exists("DocType", "Website Settings"):
        return
    ws = frappe.get_single("Website Settings")
    if getattr(ws, "disable_signup", None):
        ws.disable_signup = 0
        ws.save(ignore_permissions=True)


def finalize_oauth_user(user_id):
    """Link new social users to Health Patient and mark email verified."""
    ensure_patient_portal_role()
    roles = frappe.get_roles(user_id)
    is_staff = bool(set(roles) & STAFF_ROLES)

    if not is_staff and PATIENT_ROLE not in roles:
        user_doc = frappe.get_doc("User", user_id)
        user_doc.append("roles", {"role": PATIENT_ROLE})
        user_doc.save(ignore_permissions=True)
        roles = frappe.get_roles(user_id)

    if PATIENT_ROLE in roles or not is_staff:
        link_user_to_health_patient(user_id)

    mark_user_email_verified(user_id)
    frappe.db.commit()
    return roles


def _session_payload(user_id):
    from health_ecosystem_core.health_ecosystem_core.api import _user_must_change_password

    user = frappe.get_doc("User", user_id)
    roles = [r.role for r in user.roles]

    franchisee = None
    if "Franchisee Operator" in roles:
        franchisee = frappe.db.get_value(
            "Franchisee Profile",
            {"linked_user": user_id, "active_status": "Active"},
            ["name", "branch_code", "franchise_name", "commission_percentage_rate"],
            as_dict=True,
        )

    return {
        "user": user_id,
        "username": user.username or user_id,
        "full_name": user.full_name,
        "roles": roles,
        "sid": frappe.session.sid,
        "must_change_password": _user_must_change_password(user_id),
        "franchisee": franchisee,
    }


def list_oauth_providers(redirect_to=None):
    providers = []
    if not frappe.db.exists("DocType", "Social Login Key"):
        return providers

    rows = frappe.get_all(
        "Social Login Key",
        filters={"enable_social_login": 1},
        fields=["provider_name", "client_id", "social_login_provider"],
        order_by="modified desc",
    )
    callback = redirect_to or oauth_callback_path(redirect_to=redirect_to)
    for row in rows:
        label = (row.social_login_provider or row.provider_name or "Social").strip()
        providers.append(
            {
                "provider": row.provider_name,
                "label": label,
                "client_id": row.client_id,
                "login_url": build_oauth_login_url(row.provider_name, callback),
            }
        )
    return providers


@frappe.whitelist(allow_guest=True)
def get_oauth_providers(redirect_to=None):
    """Enabled social providers with ready-to-open login URLs."""
    frappe.flags.ignore_csrf = True
    redirect_to = _parse_request_value("redirect_to", redirect_to)
    providers = list_oauth_providers(redirect_to=redirect_to)
    return _success(
        {
            "providers": providers,
            "callback_url": oauth_callback_path(redirect_to=redirect_to),
            "google_redirect_uri": frappe_oauth_callback_url(),
        }
    )


@frappe.whitelist(allow_guest=True)
def portal_google_oauth_callback(code=None, state=None):
    """Google OAuth callback — complete login and hand off a one-time token to the SPA."""
    from frappe.auth import LoginManager
    from frappe.integrations.oauth2_logins import decoder_compat
    from frappe.utils.oauth import get_email, get_info_via_oauth, update_oauth_user

    frappe.flags.ignore_csrf = True
    code = (_parse_request_value("code", code) or "").strip()
    state = (_parse_request_value("state", state) or "").strip()
    if not code or not state:
        return _redirect_oauth_error(_("Google sign-in was cancelled or incomplete."))

    redirect_to = _oauth_redirect_target(state)
    provider_key = _google_oauth_provider_key()

    try:
        state_data = _decode_oauth_state(state)
        if not state_data.get("token"):
            return _redirect_oauth_error(_("Invalid OAuth state."))

        info = get_info_via_oauth(provider_key, code, decoder=decoder_compat)
        user_email = get_email(info)
        if not user_email:
            return _redirect_oauth_error(_("Your Google account must have a verified email."))

        if update_oauth_user(user_email, info, "google" if provider_key.lower() == "google" else provider_key) is False:
            return _redirect_oauth_error(_("Google sign-up is disabled. Contact support."))

        frappe.local.login_manager = LoginManager()
        frappe.local.login_manager.login_as(user_email)
        frappe.db.commit()

        login_token = frappe.generate_hash(length=32)
        frappe.cache.set_value(
            f"login_token:{login_token}",
            frappe.local.session.sid,
            expires_in_sec=300,
        )
        return _redirect_with_login_token(redirect_to, login_token)
    except Exception as exc:
        frappe.log_error(title="portal_google_oauth_callback", message=frappe.get_traceback())
        detail = str(exc).strip()
        if detail and len(detail) < 120:
            return _redirect_oauth_error(_("Google sign-in failed: {0}").format(detail))
        return _redirect_oauth_error(_("Google sign-in failed. Please try again."))


@frappe.whitelist(allow_guest=True)
def complete_oauth_login():
    """Exchange OAuth cookie or one-time login_token for a mobile-style sid payload."""
    frappe.flags.ignore_csrf = True
    login_token = (_parse_request_value("login_token") or "").strip()
    sid = (_parse_request_value("sid") or "").strip()

    user_id = _ensure_mobile_session(sid)
    if not user_id and login_token:
        cached_sid = frappe.cache.get_value(f"login_token:{login_token}")
        if cached_sid:
            user_id = _ensure_mobile_session(cached_sid)
            if user_id:
                sid = cached_sid

    if not user_id:
        return _error(_("Google sign-in did not complete. Try again from the login page."), 401)

    if not frappe.db.get_value("User", user_id, "enabled"):
        return _error(_("User account is disabled. Contact your administrator."), 401)

    try:
        finalize_oauth_user(user_id)
        if login_token:
            frappe.cache.delete_value(f"login_token:{login_token}")
        return _success(_session_payload(user_id), message=_("Signed in with Google"))
    except Exception:
        frappe.log_error(title="complete_oauth_login", message=frappe.get_traceback())
        return _error(_("Sign-in failed. Please try again."), 500)


@frappe.whitelist()
def smoke_oauth_login_token(user="Administrator"):
    """bench execute smoke helper — returns a one-time login_token for /oauth/callback testing."""
    from frappe.auth import LoginManager

    frappe.set_user("Administrator")
    frappe.local.login_manager = LoginManager()
    frappe.local.login_manager.login_as(user)
    token = frappe.generate_hash(length=32)
    frappe.cache.set_value(f"login_token:{token}", frappe.session.sid, expires_in_sec=300)
    callback = f"{oauth_callback_path()}?login_token={token}"
    return {"ok": True, "user": user, "login_token": token, "callback_url": callback}


def oauth_status():
    providers = list_oauth_providers()
    creds = _google_credentials()
    return {
        "enabled": bool(providers),
        "provider_count": len(providers),
        "portal_base_url": portal_base_url(),
        "callback_url": oauth_callback_path(),
        "google_redirect_uri": frappe_oauth_callback_url(),
        "site_config_credentials": bool(creds[0] and creds[1]),
        "providers": [p["provider"] for p in providers],
    }


def setup_phase18b():
    """bench execute — patient role + optional Google key from site_config."""
    from health_ecosystem_core.health_ecosystem_core.clinical_email import _normalize_portal_scheme
    from health_ecosystem_core.health_ecosystem_core.clinical_phase30_domain import default_portal_base_url

    ensure_patient_portal_role()
    _allow_website_signup()

    portal = _normalize_portal_scheme(portal_base_url()) or default_portal_base_url(https=True)
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        frappe.db.set_single_value("Health Ecosystem Settings", "patient_portal_base_url", portal)
    from frappe.installer import update_site_config

    update_site_config("hec_patient_portal_url", portal)

    google = ensure_google_social_login_key()

    settings = frappe.get_single("Health Ecosystem Settings") if frappe.db.exists(
        "DocType", "Health Ecosystem Settings"
    ) else None
    if settings and not getattr(settings, "patient_portal_base_url", None):
        settings.patient_portal_base_url = portal
        settings.save(ignore_permissions=True)

    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": "18b", "google": google, "oauth": oauth_status()}


def smoke_phase18b_oauth():
    setup_phase18b()
    status = oauth_status()
    providers = list_oauth_providers()
    return {
        "ok": True,
        "oauth_enabled": status["enabled"],
        "providers": providers,
        "status": status,
        "portal_google_callback": frappe_oauth_callback_url(),
        "note": (
            "Configure Google Cloud OAuth client with redirect URI "
            f"{status['google_redirect_uri']}"
        ),
    }
