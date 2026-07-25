"""OTP generation, storage, rate limits, and patient user provisioning."""

import random
import re

import frappe
from frappe import _

OTP_TTL_SECONDS = 300
OTP_SEND_LIMIT_PER_HOUR = 5
OTP_VERIFY_MAX_ATTEMPTS = 5
TEST_OTP_CODE = "123456"


def normalize_mobile(raw):
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw).strip())
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) != 10 or digits[0] not in "6789":
        return None
    return digits


def otp_provider():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_otp_provider

    return get_otp_provider()


def otp_test_mode():
    provider = (otp_provider() or "Test").strip().lower()
    return provider in ("", "test", "none", "mock")


def _otp_cache_key(mobile):
    return f"hec_otp:{mobile}"


def _send_rate_key(mobile):
    return f"hec_otp_send:{mobile}"


def _generate_code():
    if otp_test_mode():
        return TEST_OTP_CODE
    return f"{random.randint(0, 999999):06d}"


def _dispatch_sms(mobile, code):
    if otp_test_mode():
        frappe.logger("hec_otp").info(f"Test OTP for {mobile}: {code}")
        return True

    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_msg91_otp

    if send_msg91_otp(mobile, code):
        return True
    frappe.throw(_("Could not send OTP. Try again later."))


def send_otp_to_mobile(mobile):
    mobile = normalize_mobile(mobile)
    if not mobile:
        return None, _("Enter a valid 10-digit mobile number")

    send_count = frappe.cache().get_value(_send_rate_key(mobile)) or 0
    if int(send_count) >= OTP_SEND_LIMIT_PER_HOUR:
        return None, _("Too many OTP requests. Try again in an hour.")

    code = _generate_code()
    frappe.cache().set_value(
        _otp_cache_key(mobile),
        {"code": code, "attempts": 0},
        expires_in_sec=OTP_TTL_SECONDS,
    )
    frappe.cache().set_value(_send_rate_key(mobile), int(send_count) + 1, expires_in_sec=3600)

    try:
        _dispatch_sms(mobile, code)
    except Exception:
        frappe.log_error(title="send_otp", message=frappe.get_traceback())
        return None, _("Could not send OTP. Try again later.")

    return mobile, None


def verify_otp_code(mobile, otp):
    mobile = normalize_mobile(mobile)
    if not mobile:
        return False, _("Invalid mobile number")

    otp = (otp or "").strip()
    if not otp or len(otp) != 6 or not otp.isdigit():
        return False, _("Enter the 6-digit OTP")

    cached = frappe.cache().get_value(_otp_cache_key(mobile))
    if not cached:
        return False, _("OTP expired or not requested. Request a new code.")

    attempts = int(cached.get("attempts") or 0) + 1
    if attempts > OTP_VERIFY_MAX_ATTEMPTS:
        frappe.cache().delete_value(_otp_cache_key(mobile))
        return False, _("Too many wrong attempts. Request a new OTP.")

    if str(cached.get("code")) != otp:
        cached["attempts"] = attempts
        frappe.cache().set_value(_otp_cache_key(mobile), cached, expires_in_sec=OTP_TTL_SECONDS)
        return False, _("Incorrect OTP")

    frappe.cache().delete_value(_otp_cache_key(mobile))
    return True, None


def ensure_patient_user_for_mobile(mobile, referral_code=None):
    """Find or create a Website User linked to Health Patient for this phone."""
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE, link_user_to_health_patient

    mobile = normalize_mobile(mobile)
    referral_code = (referral_code or "").strip() or None
    user = frappe.db.get_value("User", {"mobile_no": mobile}, "name")
    created = False
    if not user:
        email = f"p{mobile}@otp.health.local"
        if frappe.db.exists("User", email):
            user = email
            frappe.db.set_value("User", user, "mobile_no", mobile, update_modified=False)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Patient",
                    "last_name": mobile[-4:],
                    "mobile_no": mobile,
                    "user_type": "Website User",
                    "send_welcome_email": 0,
                    "enabled": 1,
                }
            )
            doc.append("roles", {"role": PATIENT_ROLE})
            doc.insert(ignore_permissions=True)
            user = email
            created = True

    roles = {r.role for r in frappe.get_doc("User", user).roles}
    if PATIENT_ROLE not in roles:
        user_doc = frappe.get_doc("User", user)
        user_doc.append("roles", {"role": PATIENT_ROLE})
        user_doc.save(ignore_permissions=True)

    link_user_to_health_patient(
        user,
        patient_name=f"Patient {mobile[-4:]}",
        phone=mobile,
        referral_code=referral_code if created else None,
    )
    return user
