"""
Central secrets loader for LIS, Razorpay, and integration status.

Priority (highest first):
  1. site_config / bench common_site_config.json  (health_api_key, health_api_secret, …)
  2. Health Ecosystem Settings single DocType      (desk UI — recommended for operators)
  3. Built-in dev placeholders                     (change_me — test mode only)
"""

import hmac
import secrets

import frappe
from frappe import _
from frappe.utils import cstr


def get_health_settings():
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return None
    return frappe.get_single("Health Ecosystem Settings")


def get_lis_api_key():
    return frappe.conf.get("health_api_key") or _settings_value("api_key")


def get_lis_api_secret():
    conf_secret = frappe.conf.get("health_api_secret")
    if conf_secret:
        return conf_secret
    settings = get_health_settings()
    if settings:
        try:
            secret = settings.get_password("api_secret", raise_exception=False)
        except Exception:
            secret = None
        if secret:
            return secret
    return None


def get_razorpay_key_id():
    return frappe.conf.get("razorpay_key_id") or _settings_value("razorpay_key_id")


def get_razorpay_key_secret():
    conf_secret = frappe.conf.get("razorpay_key_secret")
    if conf_secret:
        return conf_secret
    settings = get_health_settings()
    if settings:
        try:
            secret = settings.get_password("razorpay_key_secret", raise_exception=False)
        except Exception:
            secret = None
        if secret:
            return secret
    return None


def get_backend_base_url():
    settings = get_health_settings()
    if settings and getattr(settings, "backend_base_url", None):
        return settings.backend_base_url.rstrip("/")
    return (frappe.conf.get("health_backend_url") or "http://167.233.108.90:8080").rstrip("/")


def lis_requires_payment():
    settings = get_health_settings()
    if settings and hasattr(settings, "lis_requires_payment"):
        return bool(settings.lis_requires_payment)
    return bool(frappe.conf.get("lis_requires_payment", 0))


def _settings_value(fieldname):
    settings = get_health_settings()
    if not settings:
        return None
    return getattr(settings, fieldname, None) or None


def get_sms_auth_key():
    conf = frappe.conf.get("sms_auth_key")
    if conf:
        return conf
    settings = get_health_settings()
    if settings:
        try:
            secret = settings.get_password("sms_auth_key", raise_exception=False)
        except Exception:
            secret = None
        if secret:
            return secret
    return None


def get_otp_provider():
    return frappe.conf.get("otp_provider") or _settings_value("otp_provider") or "Test"


def otp_test_mode():
    provider = (get_otp_provider() or "Test").strip().lower()
    if provider in ("", "test", "none", "mock"):
        return True
    return not bool(get_sms_auth_key())


def get_whatsapp_api_key():
    conf = frappe.conf.get("whatsapp_api_key")
    if conf:
        return conf
    settings = get_health_settings()
    if settings:
        try:
            return settings.get_password("whatsapp_api_key", raise_exception=False)
        except Exception:
            pass
    return None


def get_sms_sender_id():
    return frappe.conf.get("sms_sender_id") or _settings_value("sms_sender_id") or "HECLAB"


def get_sms_dlt_template_id():
    return (
        frappe.conf.get("sms_dlt_template_id")
        or _settings_value("sms_dlt_template_id")
        or ""
    ).strip()


def get_sms_msg91_template_id():
    return (
        frappe.conf.get("sms_msg91_template_id")
        or _settings_value("sms_msg91_template_id")
        or ""
    ).strip()


def get_msg91_email_otp_template_id():
    """MSG91 SendOTP template with email delivery enabled (falls back to Flow template id)."""
    return (
        frappe.conf.get("msg91_email_otp_template_id")
        or _settings_value("msg91_email_otp_template_id")
        or get_sms_msg91_template_id()
    ).strip()


def get_notification_channel():
    return frappe.conf.get("notification_channel") or _settings_value("notification_channel") or "Test"


def get_whatsapp_source_number():
    return frappe.conf.get("whatsapp_source_number") or _settings_value("whatsapp_source_number")


def get_whatsapp_provider():
    """Return Meta | Gupshup. Auto-select Meta when Cloud credentials are present."""
    from frappe.utils import cstr

    explicit = cstr(frappe.conf.get("whatsapp_provider") or _settings_value("whatsapp_provider") or "").strip()
    if explicit.lower() in ("meta", "gupshup"):
        return explicit.title() if explicit.lower() == "meta" else "Gupshup"
    if get_whatsapp_phone_number_id() and get_meta_whatsapp_access_token():
        return "Meta"
    return "Gupshup"


def get_meta_whatsapp_access_token():
    conf = frappe.conf.get("meta_whatsapp_access_token")
    if conf:
        return cstr(conf).strip() or None
    settings = get_health_settings()
    if settings:
        try:
            token = settings.get_password("meta_whatsapp_access_token", raise_exception=False)
            if token:
                return token
        except Exception:
            pass
    # Optional fall-back to Meta ads token when explicitly allowed
    allow = cstr(frappe.conf.get("whatsapp_reuse_meta_ads_token") or _settings_value("whatsapp_reuse_meta_ads_token") or "")
    if allow.lower() in ("1", "true", "yes"):
        return get_meta_access_token()
    return None


def get_whatsapp_phone_number_id():
    return cstr(frappe.conf.get("whatsapp_phone_number_id") or _settings_value("whatsapp_phone_number_id") or "").strip() or None


def get_whatsapp_business_account_id():
    return cstr(frappe.conf.get("whatsapp_business_account_id") or _settings_value("whatsapp_business_account_id") or "").strip() or None


def get_whatsapp_cloud_webhook_secret():
    conf = frappe.conf.get("whatsapp_cloud_webhook_secret")
    if conf:
        return cstr(conf).strip() or None
    settings = get_health_settings()
    if settings:
        try:
            return settings.get_password("whatsapp_cloud_webhook_secret", raise_exception=False)
        except Exception:
            pass
    # Fall back to verify token field if password unset
    return cstr(_settings_value("whatsapp_webhook_verify_token") or "").strip() or None


def get_whatsapp_webhook_verify_token():
    return (
        cstr(frappe.conf.get("whatsapp_webhook_verify_token") or _settings_value("whatsapp_webhook_verify_token") or "").strip()
        or get_whatsapp_cloud_webhook_secret()
    )


def whatsapp_franchise_auto_ack_enabled():
    raw = frappe.conf.get("whatsapp_franchise_auto_ack")
    if raw is None:
        raw = _settings_value("whatsapp_franchise_auto_ack")
    if raw is None:
        return False
    return cstr(raw).strip().lower() in ("1", "true", "yes", "on")


def get_whatsapp_franchise_auto_ack_message():
    return cstr(
        frappe.conf.get("whatsapp_franchise_auto_ack_message")
        or _settings_value("whatsapp_franchise_auto_ack_message")
        or "Thank you for contacting Remedium Lab franchise team. An officer will reply shortly."
    ).strip()


def sms_test_mode():
    channel = (get_notification_channel() or "Test").strip().lower()
    if channel in ("", "test", "none"):
        return True
    if channel in ("sms", "sms and whatsapp"):
        return not bool(get_sms_auth_key())
    return True


def whatsapp_test_mode():
    channel = (get_notification_channel() or "Test").strip().lower()
    if channel not in ("whatsapp", "sms and whatsapp"):
        return True
    provider = get_whatsapp_provider()
    if provider == "Meta":
        return not bool(get_meta_whatsapp_access_token()) or not bool(get_whatsapp_phone_number_id())
    return not bool(get_whatsapp_api_key()) or not bool(get_whatsapp_source_number())


def get_site_api_credentials():
    """Backward-compatible dict used by api.py."""
    return {
        "api_key": get_lis_api_key(),
        "api_secret": get_lis_api_secret(),
        "razorpay_key_id": get_razorpay_key_id(),
        "razorpay_key_secret": get_razorpay_key_secret(),
    }


def is_placeholder(value):
    if not value:
        return True
    lower = str(value).lower()
    return "change_me" in lower or lower in ("test", "placeholder")


def razorpay_test_mode():
    key_id = get_razorpay_key_id() or ""
    key_secret = get_razorpay_key_secret() or ""
    return is_placeholder(key_id) or is_placeholder(key_secret) or not key_secret


def get_google_maps_api_key():
    """Browser Maps JS key for RFMS admin (HTTP-referrer restricted in GCP)."""
    return (
        frappe.conf.get("google_maps_api_key")
        or _settings_value("google_maps_api_key")
        or ""
    ).strip()


def google_maps_configured():
    key = get_google_maps_api_key()
    return bool(key) and not is_placeholder(key)


def get_cgpey_api_key():
    return cstr(frappe.conf.get("cgpey_api_key") or _settings_value("cgpey_api_key") or "").strip()


def get_cgpey_api_secret():
    conf_secret = frappe.conf.get("cgpey_api_secret")
    if conf_secret:
        return cstr(conf_secret).strip()
    settings = get_health_settings()
    if settings:
        try:
            secret = settings.get_password("cgpey_api_secret", raise_exception=False)
        except Exception:
            secret = None
        if secret:
            return cstr(secret).strip()
    return ""


def get_cgpey_merchant_id():
    return cstr(frappe.conf.get("cgpey_merchant_id") or _settings_value("cgpey_merchant_id") or "").strip()


def get_cgpey_base_url():
    """Agreement eSign API host is verify.cgpey.com (IDTOAI). docs/www are not eSign hosts."""
    raw = cstr(
        frappe.conf.get("cgpey_base_url")
        or _settings_value("cgpey_base_url")
        or "https://verify.cgpey.com"
    ).strip().rstrip("/")
    host = ""
    try:
        from urllib.parse import urlparse

        host = (urlparse(raw).hostname or "").lower()
    except Exception:
        host = ""
    if host in {"www.cgpey.com", "cgpey.com", "api.cgpey.com", "docs.cgpey.com"} or not raw:
        return "https://verify.cgpey.com"
    lowered = raw.lower()
    for marker in ("/api/v1/esign", "/api/kyc"):
        if marker in lowered:
            raw = raw[: lowered.index(marker)].rstrip("/")
            break
    return raw or "https://verify.cgpey.com"


def _truthy(value):
    if value is True or value == 1:
        return True
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def cgpey_simulate():
    conf = frappe.conf.get("cgpey_simulate")
    if conf is not None and conf != "":
        return _truthy(conf)
    settings = get_health_settings()
    if settings and hasattr(settings, "cgpey_simulate"):
        return bool(settings.cgpey_simulate)
    return False


def cgpey_configured():
    if cgpey_simulate():
        return True
    return bool(get_cgpey_api_key() and get_cgpey_api_secret() and get_cgpey_merchant_id())


def get_cgpey_credentials():
    """Server-side only — never expose via public browser APIs."""
    return {
        "api_key": get_cgpey_api_key(),
        "api_secret": get_cgpey_api_secret(),
        "merchant_id": get_cgpey_merchant_id(),
        "base_url": get_cgpey_base_url(),
        "simulate": bool(cgpey_simulate()),
        "configured": bool(cgpey_configured()),
    }


def diag_cgpey_credentials():
    """Masked credential shape + live generate-otp auth probe. Never returns secrets."""
    import hashlib
    import json
    import ssl
    import urllib.error
    import urllib.request

    def fingerprint(value):
        raw = cstr(value or "").strip()
        return {
            "set": bool(raw),
            "len": len(raw),
            "prefix": raw[:6] if raw else "",
            "suffix": raw[-4:] if len(raw) >= 4 else "",
            "has_space": any(ch.isspace() for ch in raw),
            "sha12": hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12] if raw else "",
        }

    key = get_cgpey_api_key()
    secret = get_cgpey_api_secret()
    merchant = get_cgpey_merchant_id()
    base = get_cgpey_base_url()
    meta = frappe.get_meta("Health Ecosystem Settings") if frappe.db.exists("DocType", "Health Ecosystem Settings") else None
    field_types = {}
    for f in ("cgpey_api_key", "cgpey_api_secret", "cgpey_merchant_id", "cgpey_base_url"):
        field_types[f] = meta.get_field(f).fieldtype if meta and meta.get_field(f) else None

    result = {
        "base_url": base,
        "field_types": field_types,
        "key": fingerprint(key),
        "secret": fingerprint(secret),
        "merchant": fingerprint(merchant),
        "configured": bool(cgpey_configured()),
        "simulate": bool(cgpey_simulate()),
    }

    def probe(headers):
        body = json.dumps({"merchantId": merchant, "aadhaarNumber": "123412341234"}).encode("utf-8")
        req = urllib.request.Request(
            f"{base}/api/kyc/aadhaar/generate-otp",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "RFMS-CGPEY-Diag/1.0",
                **headers,
            },
        )
        ctx = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                return {"status": resp.status, "body": resp.read().decode("utf-8", errors="replace")[:300]}
        except urllib.error.HTTPError as err:
            return {"status": err.code, "body": err.read().decode("utf-8", errors="replace")[:300]}
        except Exception as exc:
            return {"status": 0, "body": str(exc)}

    result["probe"] = probe({"x-api-key": key, "x-api-secret": secret})
    result["probe_swapped"] = probe({"x-api-key": secret, "x-api-secret": key})
    # Common alternate header names some CGPEY builds accept
    result["probe_authorization_basic_style"] = probe(
        {"x-api-key": key, "x-api-secret": secret, "Authorization": f"Bearer {key}"}
    )
    return result


def ensure_cgpey_esign_fields():
    """Ensure CGPEY Agreement eSign fields exist even if DocType JSON reload is delayed."""
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return
    meta = frappe.get_meta("Health Ecosystem Settings")
    if meta.has_field("cgpey_api_key") and meta.has_field("cgpey_api_secret") and meta.has_field("cgpey_merchant_id"):
        return
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "section_break_cgpey_esign",
                    "fieldtype": "Section Break",
                    "label": "CGPEY Aadhaar OTP (Agreement eSign)",
                    "insert_after": "ffms_maps_notes",
                    "collapsible": 1,
                },
                {
                    "fieldname": "cgpey_api_key",
                    "label": "CGPEY API Key",
                    "fieldtype": "Data",
                    "insert_after": "section_break_cgpey_esign",
                    "description": "CGPEY x-api-key for Agreement Accept / Aadhaar OTP eSign in RFMS.",
                },
                {
                    "fieldname": "cgpey_api_secret",
                    "label": "CGPEY API Secret",
                    "fieldtype": "Password",
                    "insert_after": "cgpey_api_key",
                    "description": "CGPEY x-api-secret. Stored encrypted.",
                },
                {
                    "fieldname": "cgpey_merchant_id",
                    "label": "CGPEY Merchant ID",
                    "fieldtype": "Data",
                    "insert_after": "cgpey_api_secret",
                    "description": "CGPEY merchantId sent in Aadhaar OTP request body.",
                },
                {
                    "fieldname": "column_break_cgpey",
                    "fieldtype": "Column Break",
                    "insert_after": "cgpey_merchant_id",
                },
                {
                    "fieldname": "cgpey_base_url",
                    "label": "CGPEY Base URL",
                    "fieldtype": "Data",
                    "insert_after": "column_break_cgpey",
                    "default": "https://docs.cgpey.com",
                },
                {
                    "fieldname": "cgpey_simulate",
                    "label": "Simulate CGPEY Aadhaar OTP",
                    "fieldtype": "Check",
                    "insert_after": "cgpey_base_url",
                    "default": "0",
                },
                {
                    "fieldname": "cgpey_esign_notes",
                    "label": "CGPEY eSign Notes",
                    "fieldtype": "Small Text",
                    "insert_after": "cgpey_simulate",
                    "read_only": 1,
                    "default": "Paste CGPEY credentials here. RFMS Agreement Accept uses Aadhaar OTP via the ERP bridge.",
                },
            ]
        },
        update=True,
    )


def get_meta_ad_account_id():
	return frappe.conf.get("meta_ad_account_id") or _settings_value("meta_ad_account_id")


def get_meta_access_token():
	conf = frappe.conf.get("meta_access_token")
	if conf:
		return conf
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("meta_access_token", raise_exception=False)
		except Exception:
			pass
	return None


def get_hiring_ads_webhook_secret():
	conf = frappe.conf.get("hiring_ads_webhook_secret")
	if conf:
		return conf
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("hiring_ads_webhook_secret", raise_exception=False)
		except Exception:
			pass
	return None


def get_franchise_ads_webhook_secret():
	conf = frappe.conf.get("franchise_ads_webhook_secret")
	if conf:
		return cstr(conf).strip() or None
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("franchise_ads_webhook_secret", raise_exception=False)
		except Exception:
			pass
	return None


def get_google_ads_customer_id():
	return frappe.conf.get("google_ads_customer_id") or _settings_value("google_ads_customer_id")


def get_google_ads_developer_token():
	conf = frappe.conf.get("google_ads_developer_token")
	if conf:
		return conf
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("google_ads_developer_token", raise_exception=False)
		except Exception:
			pass
	return None


def get_google_ads_refresh_token():
	conf = frappe.conf.get("google_ads_refresh_token")
	if conf:
		return conf
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("google_ads_refresh_token", raise_exception=False)
		except Exception:
			pass
	return None


def get_google_ads_client_id():
	return frappe.conf.get("google_ads_client_id") or _settings_value("google_ads_client_id")


def get_google_ads_client_secret():
	conf = frappe.conf.get("google_ads_client_secret")
	if conf:
		return conf
	settings = get_health_settings()
	if settings:
		try:
			return settings.get_password("google_ads_client_secret", raise_exception=False)
		except Exception:
			pass
	return None


def hiring_ads_sync_enabled():
	conf = frappe.conf.get("hiring_ads_sync_enabled")
	if conf is not None:
		return bool(conf)
	settings = get_health_settings()
	return bool(settings and getattr(settings, "hiring_ads_sync_enabled", 0))


def meta_ads_configured():
	return bool(get_meta_ad_account_id() and get_meta_access_token())


def google_ads_configured():
	return bool(
		get_google_ads_customer_id()
		and get_google_ads_developer_token()
		and get_google_ads_refresh_token()
		and get_google_ads_client_id()
		and get_google_ads_client_secret()
	)


def lis_configured():
    key = get_lis_api_key()
    secret = get_lis_api_secret()
    return bool(key and secret and not is_placeholder(key) and not is_placeholder(secret))


def validate_machine_headers(api_key, api_secret):
    expected_key = get_lis_api_key()
    expected_secret = get_lis_api_secret()
    if not expected_key or not expected_secret:
        frappe.throw(_("LIS API credentials are not configured"), frappe.AuthenticationError)
    if is_placeholder(expected_key) or is_placeholder(expected_secret):
        frappe.throw(_("LIS API credentials still use placeholder values"), frappe.AuthenticationError)
    if not api_key or not api_secret:
        return False
    return hmac.compare_digest(api_key, expected_key) and hmac.compare_digest(
        api_secret, expected_secret
    )


def integration_status_payload():
    """Admin-safe status — never returns raw secrets."""
    creds = get_site_api_credentials()
    settings = get_health_settings()
    return {
        "lis": {
            "configured": lis_configured(),
            "key_prefix": _mask(creds.get("api_key")),
            "source": _secret_source("health_api_key", "api_key"),
        },
        "razorpay": {
            "configured": not razorpay_test_mode(),
            "test_mode": razorpay_test_mode(),
            "key_id": creds.get("razorpay_key_id") or "",
            "source": _secret_source("razorpay_key_id", "razorpay_key_id"),
        },
        "otp": {
            "configured": not otp_test_mode(),
            "test_mode": otp_test_mode(),
            "provider": get_otp_provider() or "Test",
        },
        "google_maps": {
            "configured": google_maps_configured(),
            "key_prefix": _mask(get_google_maps_api_key(), show=8) if get_google_maps_api_key() else "",
            "source": _secret_source("google_maps_api_key", "google_maps_api_key"),
        },
        "cgpey_aadhaar_otp": {
            "configured": cgpey_configured(),
            "simulate": cgpey_simulate(),
            "merchant_id": get_cgpey_merchant_id() or "",
            "base_url": get_cgpey_base_url(),
            "key_prefix": _mask(get_cgpey_api_key(), show=6) if get_cgpey_api_key() else "",
            "source": _secret_source("cgpey_api_key", "cgpey_api_key"),
        },
        "notifications": {
            "enabled": True,
            "channel": get_notification_channel(),
            "sms_test_mode": sms_test_mode(),
            "whatsapp_test_mode": whatsapp_test_mode(),
        },
        "lis_requires_payment": lis_requires_payment(),
        "backend_base_url": get_backend_base_url(),
        "site_name": frappe.local.site,
        "mobile_home_title": getattr(settings, "mobile_home_title", None) if settings else None,
        "hiring_ads": {
            "sync_enabled": hiring_ads_sync_enabled(),
            "meta_configured": meta_ads_configured(),
            "google_configured": google_ads_configured(),
            "meta_account": _mask(get_meta_ad_account_id(), show=4) if get_meta_ad_account_id() else "",
            "google_customer": _mask(get_google_ads_customer_id(), show=4)
            if get_google_ads_customer_id()
            else "",
        },
    }


def _secret_source(conf_key, settings_field):
    if frappe.conf.get(conf_key):
        return "site_config"
    val = _settings_value(settings_field)
    if val:
        return "health_ecosystem_settings"
    return "unset"


def _mask(value, show=6):
    if not value:
        return ""
    value = str(value)
    if len(value) <= show:
        return "*" * len(value)
    return value[:show] + "…" + "*" * 4


def generate_lis_keypair():
    """Return a new random LIS API key + secret for rotation."""
    key = "hec_" + secrets.token_hex(12)
    secret = secrets.token_hex(24)
    return key, secret


@frappe.whitelist()
def get_integration_status():
    if frappe.session.user == "Guest":
        return {"status": "error", "message": _("Not authenticated")}
    roles = set(frappe.get_roles())
    if not roles.intersection({"System Manager", "Health System Admin"}):
        return {"status": "error", "message": _("Not authorized")}
    return {"status": "success", "data": integration_status_payload()}


@frappe.whitelist()
def export_lis_bridge_snippet():
    """Return copy-paste CONFIG block for lis_bridge.py (admin only)."""
    if frappe.session.user == "Guest":
        return {"status": "error", "message": _("Not authenticated")}
    if "System Manager" not in frappe.get_roles() and "Health System Admin" not in frappe.get_roles():
        return {"status": "error", "message": _("Not authorized")}
    if not lis_configured():
        return {"status": "error", "message": _("Configure LIS keys in Health Ecosystem Settings first")}

    snippet = f'''CONFIG = {{
    "BACKEND_BASE_URL": "{get_backend_base_url()}",
    "SITE_NAME": "{frappe.local.site}",
    "API_KEY": "{get_lis_api_key()}",
    "API_SECRET": "{get_lis_api_secret()}",
    "LISTEN_HOST": "127.0.0.1",
    "LISTEN_PORT": 8000,
}}'''
    return {"status": "success", "data": {"snippet": snippet}}


@frappe.whitelist()
def rotate_lis_api_keys():
    if frappe.session.user == "Guest":
        return {"status": "error", "message": _("Not authenticated")}
    if "System Manager" not in frappe.get_roles():
        return {"status": "error", "message": _("Only System Manager can rotate keys")}

    settings = get_health_settings()
    if not settings:
        return {"status": "error", "message": _("Health Ecosystem Settings not found")}

    key, secret = generate_lis_keypair()
    settings.api_key = key
    settings.api_secret = secret
    settings.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "success",
        "message": _("LIS keys rotated — update lis_bridge.py on the lab PC"),
        "data": {"api_key": key, "api_key_prefix": _mask(key)},
    }
