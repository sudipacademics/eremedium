"""Remedium Aesthetic patient feedback links.

The aesthetic sessions API (aes-api, care_portal/server/feedback.mjs) creates one feedback link per completed
session and calls aesthetic_feedback_send with the signed-in staff member's session. The message text is built
here from a few fields and always carries a remediumaesthetics.in/feedback/ link, so this endpoint cannot be used
to send arbitrary messages. WhatsApp goes first (send_whatsapp: Meta Cloud or Gupshup); SMS is the fallback and
needs an MSG91 Flow template with ##name## and ##link## variables, set as aesthetic_feedback_sms_template_id in
site_config (free-text SMS is dropped by DLT scrubbing in India).
"""

from __future__ import annotations

import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, cstr

LEVELS = {"none": 0, "view": 1, "create": 2, "edit": 3, "approve": 4, "manage": 5}
LINK_RE = re.compile(r"^https://remediumaesthetics\.in/feedback/[A-Za-z0-9_-]{32}$")
CHANNELS = ("whatsapp_sms", "whatsapp", "sms")
SENDS_PER_HOUR = 6


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_mobile_auth, _success

	return _error, _parse_request_value, _require_mobile_auth, _success


def _level(module):
	from health_ecosystem_core.health_ecosystem_core.clinical_people_access import my_permissions

	perms = my_permissions()
	if perms.get("exempt"):
		return LEVELS["manage"]
	own = (perms.get("portal_modules") or {}).get("aesthetics")
	if own:
		return LEVELS.get((own.get(module) or {}).get("level", "none"), 0)
	roles = set(frappe.get_roles())
	if "Aesthetic Manager" in roles:
		return LEVELS["manage"]
	if "Aesthetic Staff" in roles:
		return LEVELS["edit"]
	return 0


def _need(*rules):
	if any(_level(module) >= LEVELS[level] for module, level in rules):
		return
	labels = " or ".join(f"{module} ({level})" for module, level in rules)
	raise frappe.PermissionError(_("Your Aesthetic Backend access does not allow this. Needed: {0}").format(labels))


def _mobile(value):
	digits = re.sub(r"\D", "", cstr(value))[-10:]
	return digits if re.fullmatch(r"[6-9]\d{9}", digits) else ""


def _text(value, limit):
	text = re.sub(r"https?://\S+|www\.\S+", "", cstr(value))
	return re.sub(r"\s+", " ", text).strip()[:limit]


def _message(data, link):
	first = (_text(data.get("name"), 60).split(" ") or [""])[0] or "there"
	service = _text(data.get("service"), 80) or "treatment"
	branch = _text(data.get("branch"), 40)
	session = cint(data.get("session_no"))
	days = min(max(cint(data.get("valid_days")) or 7, 1), 30)
	where = f", {branch}" if branch else ""
	which = f" (session {session})" if session > 0 else ""
	return (
		f"Hi {first}, thank you for visiting Remedium Aesthetic{where}. "
		f"How was your {service}{which}? Please rate your visit here: {link} "
		f"This link works for {days} day{'s' if days != 1 else ''}."
	), first


def _throttle(mobile):
	key = f"aes_feedback_send:{mobile}"
	count = cint(frappe.cache().get_value(key))
	if count >= SENDS_PER_HOUR:
		raise frappe.ValidationError(_("Too many feedback messages to this number in the last hour. Try again later."))
	frappe.cache().set_value(key, count + 1, expires_in_sec=3600)


def _sms_template():
	return cstr(frappe.conf.get("aesthetic_feedback_sms_template_id")).strip()


def _flow_sms(mobile, template_id, first, link):
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key

	authkey = get_sms_auth_key()
	if not authkey:
		return False
	payload = {
		"template_id": template_id,
		"short_url": "0",
		"recipients": [{"mobiles": f"91{mobile}", "name": first, "link": link}],
	}
	req = Request(
		"https://control.msg91.com/api/v5/flow/",
		data=json.dumps(payload).encode("utf-8"),
		headers={"authkey": authkey, "Content-Type": "application/json", "Accept": "application/json"},
		method="POST",
	)
	try:
		with urlopen(req, timeout=20) as resp:
			raw = resp.read().decode("utf-8", errors="replace").strip()
		frappe.logger("hec_msg91").info(f"Aesthetic feedback SMS {mobile}: {raw[:300]}")
		try:
			body = json.loads(raw) if raw else {}
		except Exception:
			body = {}
		if isinstance(body, dict) and str(body.get("type") or "").lower() in ("success", "ok"):
			return True
		return bool(raw) and "error" not in raw.lower()
	except HTTPError as exc:
		frappe.log_error(title="Aesthetic feedback SMS", message=exc.read().decode("utf-8", errors="replace"))
		return False
	except Exception:
		frappe.log_error(title="Aesthetic feedback SMS", message=frappe.get_traceback())
		return False


def send(data):
	_need(("Bookings", "edit"), ("Services", "edit"))
	from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import whatsapp_test_mode

	mobile = _mobile(data.get("mobile"))
	if not mobile:
		raise frappe.ValidationError(_("The patient has no valid 10-digit mobile number"))
	link = cstr(data.get("link")).strip()
	if not LINK_RE.match(link):
		raise frappe.ValidationError(_("Not a Remedium Aesthetic feedback link"))
	channel = cstr(data.get("channel")) if cstr(data.get("channel")) in CHANNELS else "whatsapp_sms"
	_throttle(mobile)
	message, first = _message(data, link)

	result = {"channel": None, "test_mode": False, "whatsapp": None, "sms": None}
	if channel in ("whatsapp_sms", "whatsapp"):
		test = bool(whatsapp_test_mode())
		ok = send_whatsapp(mobile, message)
		result["whatsapp"] = "test" if ok and test else "sent" if ok else "failed"
		if ok and not test:
			result["channel"] = "whatsapp"
			return result
	if channel in ("whatsapp_sms", "sms"):
		template = _sms_template()
		if template:
			ok = _flow_sms(mobile, template, first, link)
			result["sms"] = "sent" if ok else "failed"
			if ok:
				result["channel"] = "sms"
				return result
		else:
			result["sms"] = "not_configured"
	if result["whatsapp"] == "test":
		result["channel"] = "whatsapp"
		result["test_mode"] = True
		return result
	reasons = []
	if result["whatsapp"] == "failed":
		reasons.append(_("WhatsApp could not be sent"))
	if result["sms"] == "failed":
		reasons.append(_("SMS could not be sent"))
	if result["sms"] == "not_configured":
		reasons.append(_("SMS has no feedback template set up"))
	raise frappe.ValidationError("; ".join(reasons) or _("The message could not be sent"))


def status(_data):
	_need(("Bookings", "view"), ("Services", "view"))
	from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import sms_configured
	from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import whatsapp_delivery_ready
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_whatsapp_provider, whatsapp_test_mode

	return {
		"whatsapp_ready": bool(whatsapp_delivery_ready()),
		"whatsapp_test_mode": bool(whatsapp_test_mode()),
		"whatsapp_provider": cstr(get_whatsapp_provider()) or None,
		"sms_ready": bool(sms_configured() and _sms_template()),
	}


def _call(fn, sid, data):
	_error, _parse, _require, _success = _api()
	if not _require(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	raw = _parse("data", data) or "{}"
	try:
		payload = frappe.parse_json(raw) if isinstance(raw, str) else dict(raw)
	except Exception:
		return _error(_("Invalid request data"))
	try:
		return _success(fn(payload or {}))
	except frappe.PermissionError as exc:
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.log_error(title="aesthetic_feedback", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def aesthetic_feedback_send(sid=None, data=None):
	return _call(send, sid, data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def aesthetic_feedback_status(sid=None, data=None):
	return _call(status, sid, data)
