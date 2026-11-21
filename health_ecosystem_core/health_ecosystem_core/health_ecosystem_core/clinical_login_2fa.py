"""SMS second step for staff password logins (admin and manager roles).

authenticate_user checks the password, then calls start_challenge before any session exists.
The session is only created by verify_login_code once the SMS code matches.
"""

import hashlib
import hmac
import secrets

import frappe
from frappe import _

CODE_TTL = 300
MAX_TRIES = 5
SENDS_PER_HOUR = 5
VERIFY_METHOD = "health_ecosystem_core.health_ecosystem_core.clinical_login_2fa.verify_login_code"


def _ok(data, message="OK"):
	return {"status": "success", "message": message, "data": data or {}}


def _fail(message, code=400):
	frappe.local.response["http_status_code"] = code
	return {"status": "error", "message": message, "data": {}}


def _digest(token, code):
	return hashlib.sha256(f"{token}:{code}".encode()).hexdigest()


def _key(token):
	return f"hec_login_2fa:{token}"


def needs_second_step(user_id):
	if not user_id or user_id in ("Administrator", "Guest"):
		return False
	return any("Manager" in role or "Admin" in role for role in frappe.get_roles(user_id))


def staff_mobile(user_id):
	"""HRMS employee mobile first (User.mobile_no can be released to a patient OTP account)."""
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile

	for row in frappe.get_all("Employee", filters={"user_id": user_id, "status": "Active"}, fields=["cell_number"], limit=3):
		mobile = normalize_mobile(row.cell_number)
		if mobile:
			return mobile
	return normalize_mobile(frappe.db.get_value("User", user_id, "mobile_no"))


def _send(token, entry):
	from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_msg91_otp
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import otp_test_mode

	rate_key = f"hec_login_2fa_send:{entry['user']}"
	sent = int(frappe.cache().get_value(rate_key) or 0)
	if sent >= SENDS_PER_HOUR:
		return _("Too many verification codes were requested. Try again in an hour.")
	code = f"{secrets.randbelow(1000000):06d}"
	if otp_test_mode():
		frappe.logger("hec_2fa").warning(f"OTP provider is in test mode; login code for {entry['user']} not sent by SMS")
		return _("SMS is not configured, so the verification code cannot be sent.")
	if not send_msg91_otp(entry["mobile"], code):
		return _("Could not send the verification code. Try again in a minute.")
	entry["digest"] = _digest(token, code)
	entry["tries"] = 0
	frappe.cache().set_value(_key(token), entry, expires_in_sec=CODE_TTL)
	frappe.cache().set_value(rate_key, sent + 1, expires_in_sec=3600)
	return None


def _hint(mobile):
	return "******" + mobile[-4:]


def start_challenge(user_id, must_change_password=False, partner=False):
	"""Return a response asking for the SMS code, or None when this login needs no second step."""
	if not needs_second_step(user_id):
		return None
	mobile = staff_mobile(user_id)
	if not mobile:
		frappe.logger("hec_2fa").warning(f"{user_id} has an admin/manager role but no mobile on Employee or User; second step skipped")
		return None
	if not partner:
		from health_ecosystem_core.health_ecosystem_core.clinical_email import user_requires_email_verification

		if user_requires_email_verification(user_id):
			return _fail(_("Please verify your email before signing in. Check your inbox or request a new link."), 401)
	token = secrets.token_urlsafe(24)
	entry = {"user": user_id, "mobile": mobile, "must_change_password": bool(must_change_password)}
	problem = _send(token, entry)
	if problem:
		return _fail(problem, 429 if "Too many" in problem else 503)
	return _ok(
		{
			"two_factor": True,
			"tfa_token": token,
			"mobile_hint": _hint(mobile),
			"expires_in": CODE_TTL,
			"verify_method": VERIFY_METHOD,
		},
		message="Verification code sent",
	)


def _session_payload(user_id, must_change_password):
	user = frappe.get_doc("User", user_id)
	roles = list(frappe.get_roles(user_id))
	franchisee = None
	if "Franchisee Operator" in roles:
		franchisee = frappe.db.get_value(
			"Franchisee Profile",
			{"linked_user": user_id, "active_status": "Active"},
			[
				"name",
				"branch_code",
				"franchise_name",
				"territory_region",
				"address",
				"contact_phone",
				"contact_email",
				"commission_percentage_rate",
			],
			as_dict=True,
		)
	return {
		"user": user_id,
		"username": user.username or user_id,
		"full_name": user.full_name,
		"roles": roles,
		"sid": frappe.session.sid,
		"must_change_password": must_change_password,
		"franchisee": franchisee,
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def verify_login_code(token=None, code=None):
	frappe.flags.ignore_csrf = True
	token = str(token or frappe.form_dict.get("token") or "").strip()
	code = str(code or frappe.form_dict.get("code") or "").strip()
	if not token:
		return _fail(_("Sign in again to get a new code."), 401)
	entry = frappe.cache().get_value(_key(token))
	if not entry:
		return _fail(_("This code has expired. Sign in again."), 401)
	if len(code) != 6 or not code.isdigit():
		return _fail(_("Enter the 6-digit code."), 400)
	tries = int(entry.get("tries") or 0) + 1
	if not hmac.compare_digest(entry.get("digest") or "", _digest(token, code)):
		if tries >= MAX_TRIES:
			frappe.cache().delete_value(_key(token))
			return _fail(_("Too many wrong codes. Sign in again."), 401)
		entry["tries"] = tries
		frappe.cache().set_value(_key(token), entry, expires_in_sec=CODE_TTL)
		return _fail(_("That code is not right. {0} tries left.").format(MAX_TRIES - tries), 401)
	frappe.cache().delete_value(_key(token))
	user_id = entry["user"]
	if not frappe.db.get_value("User", user_id, "enabled"):
		return _fail(_("User account is disabled. Contact your administrator."), 401)
	try:
		frappe.local.login_manager.login_as(user_id)
		return _ok(_session_payload(user_id, entry.get("must_change_password")), message="Authenticated")
	except Exception:
		frappe.log_error(title="verify_login_code", message=frappe.get_traceback())
		return _fail(_("Login failed. Please try again."), 500)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def resend_login_code(token=None):
	frappe.flags.ignore_csrf = True
	token = str(token or frappe.form_dict.get("token") or "").strip()
	entry = frappe.cache().get_value(_key(token)) if token else None
	if not entry:
		return _fail(_("This code has expired. Sign in again."), 401)
	problem = _send(token, entry)
	if problem:
		return _fail(problem, 429 if "Too many" in problem else 503)
	return _ok({"mobile_hint": _hint(entry["mobile"]), "expires_in": CODE_TTL}, message="Verification code sent")
