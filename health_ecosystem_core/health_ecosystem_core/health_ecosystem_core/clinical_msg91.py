"""MSG91 SMS + Gupshup WhatsApp delivery helpers."""

import json
import re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import frappe


def _digits_mobile(phone):
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) > 10:
        digits = digits[-10:]
    return digits if len(digits) == 10 else None


def _msg91_mobile(phone):
    mobile = _digits_mobile(phone)
    return f"91{mobile}" if mobile else None


def sms_configured():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key

    return bool(get_sms_auth_key())


def send_msg91_sms(phone, message):
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
        get_sms_auth_key,
        get_sms_sender_id,
    )

    authkey = get_sms_auth_key()
    mobiles = _msg91_mobile(phone)
    if not authkey or not mobiles:
        return False

    sender = get_sms_sender_id() or "HECLAB"
    message = (message or "").strip()[:480]
    url = (
        "https://control.msg91.com/api/sendhttp.php?"
        f"authkey={quote(authkey)}&mobiles={mobiles}&message={quote(message)}"
        f"&sender={quote(sender)}&route=4&country=91"
    )
    try:
        with urlopen(Request(url, method="GET"), timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace").strip()
        frappe.logger("hec_msg91").info(f"SMS {mobiles}: {body}")
        return body and "error" not in body.lower()
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="MSG91 SMS", message=err)
        return False
    except Exception:
        frappe.log_error(title="MSG91 SMS", message=frappe.get_traceback())
        return False


def send_gupshup_whatsapp(phone, message):
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
        get_whatsapp_api_key,
        get_whatsapp_source_number,
    )

    api_key = get_whatsapp_api_key()
    destination = _msg91_mobile(phone)
    source = get_whatsapp_source_number()
    if not api_key or not destination or not source:
        return False

    payload = (
        f"channel=whatsapp&source={quote(source)}&destination={destination}"
        f"&message={quote(message)}&src.name=HealthEcosystem"
    ).encode("utf-8")
    req = Request(
        "https://api.gupshup.io/wa/api/v1/msg",
        data=payload,
        headers={
            "apikey": api_key,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        frappe.logger("hec_whatsapp").info(f"WhatsApp {destination}: {body}")
        return body.get("status") == "submitted" or body.get("messageId")
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="Gupshup WhatsApp", message=err)
        return False
    except Exception:
        frappe.log_error(title="Gupshup WhatsApp", message=frappe.get_traceback())
        return False
