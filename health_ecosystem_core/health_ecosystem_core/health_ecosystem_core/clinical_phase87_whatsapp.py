"""
Phase 87 — Meta WhatsApp Cloud adapter + franchise CRM inbox.

- send_whatsapp: routes Meta Cloud vs Gupshup
- ingest_whatsapp_cloud_webhook: Meta verify + inbound messages/statuses
- Franchise conversation/message DocTypes; optional one-shot auto-ack
- Bridge helpers for RFMS lead thread reply
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe
import requests
from frappe import _
from frappe.utils import cstr, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import _parse_request_value, _success
from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
	get_meta_whatsapp_access_token,
	get_whatsapp_cloud_webhook_secret,
	get_whatsapp_franchise_auto_ack_message,
	get_whatsapp_phone_number_id,
	get_whatsapp_provider,
	get_whatsapp_webhook_verify_token,
	whatsapp_franchise_auto_ack_enabled,
	whatsapp_test_mode,
)

GRAPH_VERSION = "v19.0"


def get_rfms_api_base_url_safe() -> str:
	"""Prefer Phase 86 helper; fall back to conf."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import get_rfms_api_base_url

		return get_rfms_api_base_url()
	except Exception:
		return cstr(
			frappe.conf.get("rfms_api_base_url")
			or frappe.db.get_single_value("Health Ecosystem Settings", "rfms_api_base_url")
			or "https://www.e-remedium.in/rfms-api/v1"
		).rstrip("/")


def _rfms_base() -> str:
	return get_rfms_api_base_url_safe()


def ensure_phase87_whatsapp():
	"""Ensure DocTypes exist (hot path) + Settings custom fields."""
	try:
		_ensure_doctypes()
	except Exception:
		frappe.log_error(title="phase87_ensure_doctypes", message=frappe.get_traceback())
		return
	try:
		if frappe.session.user not in ("Administrator", "Guest") and "System Manager" not in frappe.get_roles():
			return
		from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

		create_custom_fields(
			{
				"Health Ecosystem Settings": [
					{"fieldname": "section_whatsapp_cloud", "fieldtype": "Section Break", "label": "WhatsApp Cloud (Phase 87)", "insert_after": "whatsapp_source_number", "collapsible": 1},
					{"fieldname": "whatsapp_provider", "fieldtype": "Select", "label": "WhatsApp Provider", "options": "\nMeta\nGupshup", "insert_after": "section_whatsapp_cloud"},
					{"fieldname": "meta_whatsapp_access_token", "fieldtype": "Password", "label": "Meta WhatsApp Access Token", "insert_after": "whatsapp_provider"},
					{"fieldname": "whatsapp_phone_number_id", "fieldtype": "Data", "label": "WhatsApp Phone Number ID", "insert_after": "meta_whatsapp_access_token"},
					{"fieldname": "whatsapp_business_account_id", "fieldtype": "Data", "label": "WhatsApp Business Account ID", "insert_after": "whatsapp_phone_number_id"},
					{"fieldname": "whatsapp_cloud_webhook_secret", "fieldtype": "Password", "label": "WhatsApp Cloud Webhook Secret", "insert_after": "whatsapp_business_account_id"},
					{"fieldname": "whatsapp_webhook_verify_token", "fieldtype": "Data", "label": "WhatsApp Webhook Verify Token", "insert_after": "whatsapp_cloud_webhook_secret"},
					{"fieldname": "whatsapp_reuse_meta_ads_token", "fieldtype": "Check", "label": "Reuse Meta Ads Token for WhatsApp", "default": "0", "insert_after": "whatsapp_webhook_verify_token"},
					{"fieldname": "whatsapp_franchise_auto_ack", "fieldtype": "Check", "label": "Franchise Auto-Ack New Conversations", "default": "0", "insert_after": "whatsapp_reuse_meta_ads_token"},
					{"fieldname": "whatsapp_franchise_auto_ack_message", "fieldtype": "Small Text", "label": "Franchise Auto-Ack Message", "insert_after": "whatsapp_franchise_auto_ack"},
				],
			},
			update=True,
		)
	except Exception:
		frappe.clear_messages()
		frappe.log_error(title="phase87_ensure_custom_fields", message=frappe.get_traceback())


def _ensure_doctypes():
	import os

	base = os.path.join(os.path.dirname(__file__), "doctype")
	for folder, name in (
		("hec_whatsapp_conversation", "HEC WhatsApp Conversation"),
		("hec_whatsapp_message", "HEC WhatsApp Message"),
	):
		if frappe.db.exists("DocType", name):
			continue
		path = os.path.join(base, folder, f"{folder}.json")
		if not os.path.isfile(path):
			continue
		with open(path, encoding="utf-8") as handle:
			payload = json.load(handle)
		doc = frappe.get_doc(payload)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()


def _digits(value: Any) -> str:
	return re.sub(r"\D", "", cstr(value or ""))[-15:]


def _e164_in(phone: Any) -> str:
	digits = _digits(phone)
	if len(digits) == 10:
		return f"91{digits}"
	return digits


def whatsapp_delivery_ready():
	"""True when a WhatsApp provider is usable (including test mode)."""
	if whatsapp_test_mode():
		return True
	provider = (get_whatsapp_provider() or "").strip()
	if provider == "Meta":
		return bool(get_meta_whatsapp_access_token() and get_whatsapp_phone_number_id())
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_whatsapp_api_key,
		get_whatsapp_source_number,
	)

	return bool(get_whatsapp_api_key() and get_whatsapp_source_number())


def send_whatsapp(phone, message, *, context=None):
	"""Unified outbound WhatsApp. Returns truthy on success (message id or True)."""
	context = context or {}
	if not phone or not message:
		return False
	if whatsapp_test_mode():
		frappe.logger("hec_whatsapp").info(f"WhatsApp test [{phone}]: {message}")
		if context.get("persist") or context.get("conversation") or context.get("franchise"):
			try:
				_persist_outbound(phone, message, meta_id=f"test-{now_datetime()}", status="sent", context=context)
			except Exception:
				frappe.log_error(title="phase87_persist_outbound", message=frappe.get_traceback())
		return True

	provider = get_whatsapp_provider()
	if provider == "Meta":
		result = _send_meta_cloud(phone, message)
	else:
		from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_gupshup_whatsapp

		result = send_gupshup_whatsapp(phone, message)

	if result and (context.get("persist") or context.get("conversation") or context.get("franchise")):
		try:
			meta_id = result if isinstance(result, str) else cstr(result)
			_persist_outbound(phone, message, meta_id=meta_id if meta_id and meta_id != "True" else "", status="sent", context=context)
		except Exception:
			frappe.log_error(title="phase87_persist_outbound", message=frappe.get_traceback())
	return result


def _send_meta_cloud(phone, message):
	token = get_meta_whatsapp_access_token()
	phone_id = get_whatsapp_phone_number_id()
	to = _e164_in(phone)
	if not token or not phone_id or not to:
		return False
	url = f"https://graph.facebook.com/{GRAPH_VERSION}/{phone_id}/messages"
	payload = {
		"messaging_product": "whatsapp",
		"to": to,
		"type": "text",
		"text": {"preview_url": False, "body": cstr(message)[:4096]},
	}
	try:
		resp = requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=30)
		data = resp.json() if resp.content else {}
		if not resp.ok:
			frappe.log_error(title="phase87_meta_whatsapp_send", message=cstr(data)[:1000])
			return False
		messages = data.get("messages") or []
		return (messages[0] or {}).get("id") if messages else True
	except Exception:
		frappe.log_error(title="phase87_meta_whatsapp_send", message=frappe.get_traceback())
		return False


def _persist_outbound(phone, message, *, meta_id="", status="sent", context=None):
	context = context or {}
	ensure_phase87_whatsapp()
	conv = context.get("conversation") or get_or_create_conversation(phone, contact_name=context.get("contact_name"))
	if not conv:
		return
	_append_message(
		conv.name if hasattr(conv, "name") else conv,
		direction="Out",
		body=message,
		meta_message_id=meta_id,
		status=status,
	)


def get_or_create_conversation(phone, *, contact_name=None, wa_id=None):
	ensure_phase87_whatsapp()
	digits = _digits(phone)
	if not digits:
		return None
	# Match last 10 digits
	existing = None
	for row in frappe.get_all("HEC WhatsApp Conversation", fields=["name", "phone"], limit=500):
		if _digits(row.phone)[-10:] == digits[-10:]:
			existing = row.name
			break
	if existing:
		doc = frappe.get_doc("HEC WhatsApp Conversation", existing)
		if contact_name and not doc.contact_name:
			doc.contact_name = cstr(contact_name)[:120]
		if wa_id:
			doc.wa_id = cstr(wa_id)
		doc.save(ignore_permissions=True)
		return doc
	doc = frappe.get_doc(
		{
			"doctype": "HEC WhatsApp Conversation",
			"phone": digits[-10:] if len(digits) >= 10 else digits,
			"wa_id": cstr(wa_id or ""),
			"status": "Open",
			"contact_name": cstr(contact_name or ""),
			"last_message_at": now_datetime(),
		}
	)
	doc.insert(ignore_permissions=True, ignore_mandatory=True)
	frappe.db.commit()
	_link_conversation_to_leads(doc)
	return doc


def _link_conversation_to_leads(conv):
	phone = _digits(conv.phone)
	if not phone:
		return
	lead_name = None
	for row in frappe.get_all("Franchise Sales Lead", fields=["name", "phone"], limit=500):
		if _digits(row.phone)[-10:] == phone[-10:]:
			lead_name = row.name
			break
	if lead_name:
		frappe.db.set_value("HEC WhatsApp Conversation", conv.name, "franchise_sales_lead", lead_name)
		conv.franchise_sales_lead = lead_name
	rfms = _lookup_or_notify_rfms(phone=phone, conversation_id=conv.name, franchise_sales_lead=lead_name or "")
	if rfms.get("lead_id"):
		frappe.db.set_value("HEC WhatsApp Conversation", conv.name, "rfms_lead_id", rfms["lead_id"])
		conv.rfms_lead_id = rfms["lead_id"]
	frappe.db.commit()


def _append_message(conversation_name, *, direction, body, meta_message_id="", status="received", raw=None):
	ensure_phase87_whatsapp()
	if meta_message_id and frappe.db.exists("HEC WhatsApp Message", {"meta_message_id": meta_message_id}):
		return frappe.db.get_value("HEC WhatsApp Message", {"meta_message_id": meta_message_id}, "name")
	doc = frappe.get_doc(
		{
			"doctype": "HEC WhatsApp Message",
			"conversation": conversation_name,
			"direction": direction,
			"body": cstr(body)[:8000],
			"status": status,
			"message_at": now_datetime(),
			"raw_payload": json.dumps(raw)[:4000] if raw is not None else "",
		}
	)
	mid = cstr(meta_message_id or "").strip()
	if mid:
		doc.meta_message_id = mid[:140]
	doc.insert(ignore_permissions=True)
	frappe.db.set_value("HEC WhatsApp Conversation", conversation_name, "last_message_at", now_datetime())
	frappe.db.commit()
	return doc.name


def _check_webhook_secret_optional():
	"""POST may authenticate via Meta signature later; for now require shared secret when configured."""
	secret = get_whatsapp_cloud_webhook_secret()
	if not secret:
		return
	provided = cstr(frappe.get_request_header("X-WhatsApp-Cloud-Secret") or frappe.form_dict.get("secret") or "").strip()
	# Meta does not send our secret; allow open POST when only verify token is set for hub challenge.
	# For operator-proxied posts, secret may be present.
	if provided and provided != secret:
		frappe.throw(_("Invalid WhatsApp Cloud webhook secret"), frappe.AuthenticationError)


@frappe.whitelist(allow_guest=True)
def ingest_whatsapp_cloud_webhook(
	hub_mode=None,
	hub_challenge=None,
	hub_verify_token=None,
	payload=None,
	**kwargs,
):
	frappe.flags.ignore_csrf = True
	mode = _parse_request_value("hub.mode", hub_mode) or frappe.form_dict.get("hub.mode")
	challenge = _parse_request_value("hub.challenge", hub_challenge) or frappe.form_dict.get("hub.challenge")
	verify_token = _parse_request_value("hub.verify_token", hub_verify_token) or frappe.form_dict.get("hub.verify_token")
	if mode == "subscribe" and challenge:
		expected = cstr(get_whatsapp_webhook_verify_token() or "")
		if expected and cstr(verify_token) != expected:
			frappe.throw(_("Invalid WhatsApp verify token"), frappe.AuthenticationError)
		frappe.local.response["type"] = "text"
		frappe.local.response["message"] = cstr(challenge)
		return cstr(challenge)

	_check_webhook_secret_optional()
	ensure_phase87_whatsapp()

	if payload and isinstance(payload, str):
		try:
			payload = json.loads(payload)
		except Exception:
			payload = {}
	if not isinstance(payload, dict) or not payload:
		try:
			raw = frappe.request.get_data(as_text=True) if frappe.request else ""
			payload = json.loads(raw) if raw else {}
		except Exception:
			payload = {}

	created = []
	for entry in payload.get("entry") or []:
		for change in entry.get("changes") or []:
			value = change.get("value") or {}
			for status in value.get("statuses") or []:
				_apply_status(status)
			contacts = {c.get("wa_id"): c for c in (value.get("contacts") or []) if c.get("wa_id")}
			for msg in value.get("messages") or []:
				created.append(_ingest_inbound_message(msg, contacts.get(msg.get("from")) or {}))
	return _success({"messages": created, "count": len(created)})


def _apply_status(status: dict):
	mid = cstr(status.get("id") or "")
	st = cstr(status.get("status") or "").lower()
	if not mid or not st:
		return
	name = frappe.db.get_value("HEC WhatsApp Message", {"meta_message_id": mid}, "name")
	if name and st in ("sent", "delivered", "read", "failed"):
		frappe.db.set_value("HEC WhatsApp Message", name, "status", st)


def _ingest_inbound_message(msg: dict, contact: dict) -> dict:
	from_phone = cstr(msg.get("from") or "")
	msg_id = cstr(msg.get("id") or "")
	text = ""
	if msg.get("type") == "text":
		text = cstr((msg.get("text") or {}).get("body") or "")
	elif msg.get("type") == "button":
		text = cstr((msg.get("button") or {}).get("text") or "")
	else:
		text = f"[{msg.get('type') or 'message'}]"
	contact_name = cstr(((contact.get("profile") or {}).get("name")) or "")
	is_new = not any(
		_digits(row.phone)[-10:] == _digits(from_phone)[-10:]
		for row in frappe.get_all("HEC WhatsApp Conversation", fields=["phone"], limit=500)
	)
	conv = get_or_create_conversation(from_phone, contact_name=contact_name, wa_id=from_phone)
	msg_name = _append_message(conv.name, direction="In", body=text, meta_message_id=msg_id, status="received", raw=msg)
	_push_rfms_thread_event(
		{
			"phone": conv.phone,
			"rfms_lead_id": conv.rfms_lead_id,
			"conversation_id": conv.name,
			"direction": "In",
			"body": text,
			"meta_message_id": msg_id,
			"contact_name": contact_name or conv.contact_name,
		}
	)
	if is_new and whatsapp_franchise_auto_ack_enabled() and not conv.auto_ack_sent:
		ack = get_whatsapp_franchise_auto_ack_message()
		send_whatsapp(conv.phone, ack, context={"conversation": conv, "franchise": True, "persist": True})
		frappe.db.set_value("HEC WhatsApp Conversation", conv.name, "auto_ack_sent", 1)
		frappe.db.commit()

	# Phase 112 — hiring biodata / knockout (dedicated path; does not merge franchise CRM)
	hiring_result = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring import (
			handle_hiring_whatsapp_inbound,
		)

		hiring_result = handle_hiring_whatsapp_inbound(from_phone, text, raw_msg=msg)
	except Exception:
		frappe.log_error(title="wb_hiring_whatsapp_inbound", message=frappe.get_traceback())

	return {
		"conversation": conv.name,
		"message": msg_name,
		"phone": conv.phone,
		"hiring": hiring_result,
	}


def _lookup_or_notify_rfms(*, phone, conversation_id, franchise_sales_lead=""):
	base = _rfms_base()
	secret = get_whatsapp_cloud_webhook_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
	body = json.dumps(
		{
			"phone": phone,
			"conversation_id": conversation_id,
			"franchise_sales_lead": franchise_sales_lead,
			"action": "link",
		},
		separators=(",", ":"),
	).encode("utf-8")
	headers = {"Content-Type": "application/json", "Accept": "application/json"}
	if secret:
		headers["X-WhatsApp-Cloud-Secret"] = secret
	try:
		req = Request(f"{base}/leads/whatsapp/link", data=body, headers=headers, method="POST")
		with urlopen(req, timeout=20) as resp:
			data = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
			inner = data.get("data") if isinstance(data, dict) else {}
			return {"ok": True, "lead_id": (inner or {}).get("lead_id") or ""}
	except Exception as exc:
		frappe.log_error(title="phase87_rfms_link", message=str(exc)[:500])
		return {"ok": False, "lead_id": ""}


def _push_rfms_thread_event(payload: dict):
	base = _rfms_base()
	secret = get_whatsapp_cloud_webhook_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
	body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
	headers = {"Content-Type": "application/json", "Accept": "application/json"}
	if secret:
		headers["X-WhatsApp-Cloud-Secret"] = secret
	try:
		req = Request(f"{base}/leads/whatsapp/inbound", data=body, headers=headers, method="POST")
		with urlopen(req, timeout=20) as resp:
			resp.read()
	except Exception as exc:
		frappe.log_error(title="phase87_rfms_inbound", message=str(exc)[:500])


@frappe.whitelist(allow_guest=True)
def get_franchise_whatsapp_thread(phone=None, conversation_id=None, rfms_lead_id=None, **kwargs):
	"""Return conversation + messages for RFMS proxy (secret-gated when configured)."""
	frappe.flags.ignore_csrf = True
	_require_cloud_secret_or_user()
	ensure_phase87_whatsapp()
	conv = None
	cid = cstr(conversation_id or kwargs.get("conversation_id") or "").strip()
	rid = cstr(rfms_lead_id or kwargs.get("rfms_lead_id") or "").strip()
	phone_digits = _digits(phone or kwargs.get("phone"))
	if cid and frappe.db.exists("HEC WhatsApp Conversation", cid):
		conv = frappe.get_doc("HEC WhatsApp Conversation", cid)
	elif rid:
		name = frappe.db.get_value("HEC WhatsApp Conversation", {"rfms_lead_id": rid}, "name")
		if name:
			conv = frappe.get_doc("HEC WhatsApp Conversation", name)
	elif phone_digits:
		for row in frappe.get_all("HEC WhatsApp Conversation", fields=["name", "phone"], limit=500):
			if _digits(row.phone)[-10:] == phone_digits[-10:]:
				conv = frappe.get_doc("HEC WhatsApp Conversation", row.name)
				break
	if not conv:
		return _success({"conversation": None, "messages": []})
	rows = frappe.get_all(
		"HEC WhatsApp Message",
		filters={"conversation": conv.name},
		fields=["name", "direction", "body", "meta_message_id", "status", "message_at"],
		order_by="message_at asc",
		limit=200,
	)
	return _success(
		{
			"conversation": {
				"id": conv.name,
				"phone": conv.phone,
				"status": conv.status,
				"rfms_lead_id": conv.rfms_lead_id,
				"franchise_sales_lead": conv.franchise_sales_lead,
				"contact_name": conv.contact_name,
				"last_message_at": str(conv.last_message_at or ""),
			},
			"messages": [
				{
					"id": r.name,
					"direction": r.direction,
					"body": r.body,
					"meta_message_id": r.meta_message_id,
					"status": r.status,
					"created_at": str(r.message_at or ""),
				}
				for r in rows
			],
		}
	)


@frappe.whitelist(allow_guest=True)
def send_franchise_whatsapp_reply(phone=None, message=None, rfms_lead_id=None, conversation_id=None, **kwargs):
	frappe.flags.ignore_csrf = True
	_require_cloud_secret_or_user()
	body = cstr(message or kwargs.get("message") or "").strip()
	if not body:
		frappe.throw(_("message is required"))
	phone_digits = _digits(phone or kwargs.get("phone"))
	cid = cstr(conversation_id or kwargs.get("conversation_id") or "").strip()
	rid = cstr(rfms_lead_id or kwargs.get("rfms_lead_id") or "").strip()
	conv = None
	if cid and frappe.db.exists("HEC WhatsApp Conversation", cid):
		conv = frappe.get_doc("HEC WhatsApp Conversation", cid)
	elif rid:
		name = frappe.db.get_value("HEC WhatsApp Conversation", {"rfms_lead_id": rid}, "name")
		if name:
			conv = frappe.get_doc("HEC WhatsApp Conversation", name)
	elif phone_digits:
		conv = get_or_create_conversation(phone_digits)
	if not conv:
		frappe.throw(_("Unable to resolve WhatsApp conversation"))
	if rid and not conv.rfms_lead_id:
		frappe.db.set_value("HEC WhatsApp Conversation", conv.name, "rfms_lead_id", rid)
		conv.rfms_lead_id = rid
	result = send_whatsapp(conv.phone, body, context={"conversation": conv, "franchise": True, "persist": True})
	if not result:
		frappe.throw(_("WhatsApp send failed"))
	return _success({"conversation_id": conv.name, "rfms_lead_id": conv.rfms_lead_id, "sent": True, "meta_id": cstr(result)})


def _require_cloud_secret_or_user():
	if frappe.session.user and frappe.session.user != "Guest":
		return
	secret = get_whatsapp_cloud_webhook_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
	if not secret:
		if cstr(frappe.conf.get("whatsapp_cloud_allow_open") or "") in ("1", "true"):
			return
		frappe.throw(_("WhatsApp Cloud secret is not configured"), frappe.AuthenticationError)
	provided = cstr(frappe.get_request_header("X-WhatsApp-Cloud-Secret") or frappe.form_dict.get("secret") or "").strip()
	if not provided or provided != secret:
		frappe.throw(_("Invalid WhatsApp Cloud secret"), frappe.AuthenticationError)
