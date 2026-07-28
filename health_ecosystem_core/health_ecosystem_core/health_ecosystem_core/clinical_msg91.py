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
        get_sms_dlt_template_id,
        get_sms_sender_id,
    )

    authkey = get_sms_auth_key()
    mobiles = _msg91_mobile(phone)
    if not authkey or not mobiles:
        return False

    sender = get_sms_sender_id() or "HECLAB"
    message = (message or "").strip()[:480]
    dlt_te_id = get_sms_dlt_template_id()
    # DLT operators expect a numeric TE id from the DLT portal — not MSG91's hex template id.
    if dlt_te_id and not dlt_te_id.isdigit():
        frappe.logger("hec_msg91").error(
            f"sms_dlt_template_id looks like MSG91 panel id ({dlt_te_id[:12]}…) — "
            "use numeric DLT Template Id, or set sms_msg91_template_id for Flow API"
        )
        return False
    url = (
        "https://control.msg91.com/api/sendhttp.php?"
        f"authkey={quote(authkey)}&mobiles={mobiles}&message={quote(message)}"
        f"&sender={quote(sender)}&route=4&country=91"
    )
    if dlt_te_id:
        url += f"&DLT_TE_ID={quote(dlt_te_id)}"
    else:
        frappe.logger("hec_msg91").warning(
            "MSG91 SMS sent without DLT_TE_ID — India delivery will likely fail scrubbing"
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


def send_msg91_flow_otp(phone, otp_code):
    """Send OTP via MSG91 Flow/v5 using a panel template (DLT mapped in MSG91)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
        get_sms_auth_key,
        get_sms_msg91_template_id,
    )

    authkey = get_sms_auth_key()
    mobiles = _msg91_mobile(phone)
    template_id = get_sms_msg91_template_id()
    if not authkey or not mobiles or not template_id:
        return False

    payload = {
        "template_id": template_id,
        "short_url": "0",
        "recipients": [
            {
                "mobiles": mobiles,
                # MSG91 template Remedium_OTP_Final uses ##var##
                "var": str(otp_code),
            }
        ],
    }
    req = Request(
        "https://control.msg91.com/api/v5/flow/",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "authkey": authkey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
        frappe.logger("hec_msg91").info(f"Flow OTP {mobiles}: {raw[:300]}")
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {"raw": raw}
        # Success shapes vary: type=success | message=… | request_id
        if isinstance(body, dict):
            typ = str(body.get("type") or "").lower()
            if typ in ("success", "ok"):
                return True
            if body.get("request_id") or body.get("message") in ("SMS sent successfully.", "success"):
                return True
            err = str(body.get("message") or body.get("error") or raw)[:400]
            if "error" in err.lower() or typ == "error":
                frappe.log_error(title="MSG91 Flow OTP", message=err)
                return False
        return bool(raw) and "error" not in raw.lower()
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="MSG91 Flow OTP", message=err)
        return False
    except Exception:
        frappe.log_error(title="MSG91 Flow OTP", message=frappe.get_traceback())
        return False


def send_msg91_otp(phone, otp_code):
    """Prefer Flow template (MSG91 hex id); fall back to SendHTTP + numeric DLT TE id."""
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_msg91_template_id

    if get_sms_msg91_template_id():
        return send_msg91_flow_otp(phone, otp_code)

    message = (
        f"Your E-Remedium Smilecure Lifestyle Verification OTP is {otp_code} "
        f"Do not share with anyone."
    )
    return send_msg91_sms(phone, message)


def _msg91_email_otp_template_id():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_msg91_email_otp_template_id

    return get_msg91_email_otp_template_id()


def send_msg91_email_otp(email):
    """Ask MSG91 SendOTP to create and email an OTP (template must include email delivery)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key

    authkey = get_sms_auth_key()
    template_id = _msg91_email_otp_template_id()
    recipient = str(email or "").strip().lower()
    if not authkey or not template_id or "@" not in recipient:
        return False

    # MSG91 SendOTP v5 — OTP is generated by MSG91 when email channel is enabled on the template.
    url = (
        "https://control.msg91.com/api/v5/otp"
        f"?template_id={quote(template_id)}&otp_length=6&otp_expiry=5&realTimeResponse=1"
    )
    payload = {"email": recipient}
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "authkey": authkey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
        frappe.logger("hec_msg91").info(f"Email OTP {recipient}: {raw[:300]}")
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {"raw": raw}
        if isinstance(body, dict):
            typ = str(body.get("type") or "").lower()
            if typ in ("success", "ok"):
                return True
            if body.get("request_id") or str(body.get("message") or "").lower() in (
                "otp sent successfully",
                "success",
                "otp sent successfully.",
            ):
                return True
            err = str(body.get("message") or body.get("error") or raw)[:400]
            if "error" in err.lower() or typ == "error":
                frappe.log_error(title="MSG91 Email OTP", message=err)
                return False
        return bool(raw) and "error" not in raw.lower()
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="MSG91 Email OTP", message=err)
        return False
    except Exception:
        frappe.log_error(title="MSG91 Email OTP", message=frappe.get_traceback())
        return False


def verify_msg91_email_otp(email, otp_code):
    """Verify an OTP that MSG91 emailed via SendOTP."""
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key

    authkey = get_sms_auth_key()
    recipient = str(email or "").strip().lower()
    code = str(otp_code or "").strip()
    if not authkey or "@" not in recipient or not re.fullmatch(r"\d{4,8}", code):
        return False

    url = (
        "https://control.msg91.com/api/v5/otp/verify"
        f"?otp={quote(code)}&email={quote(recipient)}"
    )
    req = Request(
        url,
        headers={
            "authkey": authkey,
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
        frappe.logger("hec_msg91").info(f"Email OTP verify {recipient}: {raw[:300]}")
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {"raw": raw}
        if isinstance(body, dict):
            typ = str(body.get("type") or "").lower()
            msg = str(body.get("message") or "").lower()
            if typ in ("success", "ok"):
                return True
            if "verified" in msg or msg in ("otp verified successfully", "success"):
                return True
            err = str(body.get("message") or body.get("error") or raw)[:400]
            if "error" in err.lower() or typ == "error":
                frappe.log_error(title="MSG91 Email OTP Verify", message=err)
                return False
        return bool(raw) and "error" not in raw.lower() and "invalid" not in raw.lower()
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="MSG91 Email OTP Verify", message=err)
        return False
    except Exception:
        frappe.log_error(title="MSG91 Email OTP Verify", message=frappe.get_traceback())
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
