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


def _user_ok_for_patient_otp(user_id):
	"""True when this User may sign in via patient mobile OTP (not staff/desk accounts)."""
	if not user_id or not frappe.db.exists("User", user_id):
		return False
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE, is_staff

	roles = set(frappe.get_roles(user_id))
	if is_staff(roles):
		return False
	if roles & {"System Manager", "Administrator", "Health System Admin", "Lab Technician", "Pathologist"}:
		return False
	if str(user_id).endswith("@otp.health.local"):
		return True
	if frappe.db.get_value("User", user_id, "user_type") == "Website User":
		return True
	return PATIENT_ROLE in roles


def _release_mobile_from_blocked_user(mobile, keep_user=None):
	"""Drop mobile_no from staff/desk users so patient OTP can claim the number."""
	for row in frappe.get_all("User", filters={"mobile_no": mobile}, fields=["name"]):
		if keep_user and row.name == keep_user:
			continue
		if _user_ok_for_patient_otp(row.name):
			continue
		frappe.db.set_value("User", row.name, "mobile_no", "", update_modified=False)


def _prepare_patient_portal_user(user_id, mobile):
	"""Enable and normalize a portal user for OTP login."""
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE

	_release_mobile_from_blocked_user(mobile, keep_user=user_id)
	doc = frappe.get_doc("User", user_id)
	if not doc.enabled:
		doc.enabled = 1
	if doc.user_type != "Website User":
		doc.user_type = "Website User"
	roles = {r.role for r in doc.roles}
	if PATIENT_ROLE not in roles:
		doc.append("roles", {"role": PATIENT_ROLE})
	if doc.mobile_no != mobile:
		doc.mobile_no = mobile
	doc.save(ignore_permissions=True)
	return user_id


def ensure_patient_user_for_mobile(mobile, referral_code=None):
	"""Find or create a Website User linked to Health Patient for this phone.

	Elevates to Administrator while creating/updating User so Frappe core
	Notification Settings hooks do not fail under Guest (mobile OTP signup).

	Skips staff/desk accounts that share the same mobile_no — uses a dedicated
	p{mobile}@otp.health.local portal user instead (fixes disabled System User collisions).
	"""
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE, link_user_to_health_patient

	mobile = normalize_mobile(mobile)
	referral_code = (referral_code or "").strip() or None
	previous_user = frappe.session.user
	try:
		frappe.set_user("Administrator")
		otp_email = f"p{mobile}@otp.health.local"
		user = None
		created = False
		linked = None
		try:
			from health_ecosystem_core.health_ecosystem_core.patient_bridge import find_patient, patient_doctype

			patient_id = find_patient(phone=mobile)
			if patient_id:
				meta = frappe.get_meta(patient_doctype())
				if meta.has_field("linked_user"):
					linked = frappe.db.get_value(patient_doctype(), patient_id, "linked_user")
				elif meta.has_field("user"):
					linked = frappe.db.get_value(patient_doctype(), patient_id, "user")
		except Exception:
			linked = None

		for candidate in (
			otp_email if frappe.db.exists("User", otp_email) else None,
			linked,
			frappe.db.get_value("User", {"mobile_no": mobile}, "name"),
		):
			if candidate and _user_ok_for_patient_otp(candidate):
				user = candidate
				break

		if user:
			_prepare_patient_portal_user(user, mobile)
		elif frappe.db.exists("User", otp_email):
			user = _prepare_patient_portal_user(otp_email, mobile)
		else:
			_release_mobile_from_blocked_user(mobile)
			doc = frappe.get_doc(
				{
					"doctype": "User",
					"email": otp_email,
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
			user = otp_email
			created = True

		link_user_to_health_patient(
			user,
			patient_name=f"Patient {mobile[-4:]}",
			phone=mobile,
			referral_code=referral_code if created else None,
		)
		return user
	finally:
		try:
			frappe.set_user(previous_user or "Guest")
		except Exception:
			frappe.set_user("Guest")


def get_cached_otp(mobile):
	"""Return cached OTP for deploy smoke (does not consume the code)."""
	mobile = normalize_mobile(mobile)
	cached = frappe.cache().get_value(_otp_cache_key(mobile)) or {}
	return cached.get("code")

