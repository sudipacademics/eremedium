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

GRAPH_VERSION = "v26.0"


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


def _ensure_conversation_read_field():
	"""Shared CRM inbox: when any executive opens a chat, unread clears for everyone."""
	if not frappe.db.exists("DocType", "HEC WhatsApp Conversation"):
		return
	try:
		if frappe.get_meta("HEC WhatsApp Conversation").has_field("crm_last_read_at"):
			return
	except Exception:
		return
	try:
		doc = frappe.get_doc("DocType", "HEC WhatsApp Conversation")
		doc.append(
			"fields",
			{
				"fieldname": "crm_last_read_at",
				"label": "CRM Last Read At",
				"fieldtype": "Datetime",
			},
		)
		doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="HEC WhatsApp Conversation")
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="wa_ensure_crm_last_read_at", message=frappe.get_traceback())


def _ensure_conversation_channel_field():
	"""Franchise vs Service Meta numbers — separate unread / inbox streams."""
	if not frappe.db.exists("DocType", "HEC WhatsApp Conversation"):
		return
	try:
		if frappe.get_meta("HEC WhatsApp Conversation").has_field("crm_channel"):
			return
	except Exception:
		return
	try:
		doc = frappe.get_doc("DocType", "HEC WhatsApp Conversation")
		doc.append(
			"fields",
			{
				"fieldname": "crm_channel",
				"label": "CRM Channel",
				"fieldtype": "Select",
				"options": "franchise\nservice",
				"default": "franchise",
				"in_standard_filter": 1,
				"insert_after": "crm_wing",
			},
		)
		doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="HEC WhatsApp Conversation")
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="wa_ensure_crm_channel", message=frappe.get_traceback())


def ensure_phase87_whatsapp():
	"""Ensure DocTypes exist (hot path) + Settings custom fields."""
	try:
		_ensure_doctypes()
	except Exception:
		frappe.log_error(title="phase87_ensure_doctypes", message=frappe.get_traceback())
		# Re-raise so CRM callers see a clear failure instead of a missing DocType later.
		raise
	try:
		_ensure_conversation_read_field()
	except Exception:
		frappe.log_error(title="phase87_ensure_read_field", message=frappe.get_traceback())
	try:
		_ensure_conversation_channel_field()
	except Exception:
		frappe.log_error(title="phase87_ensure_channel_field", message=frappe.get_traceback())
	try:
		_ensure_message_media_fields()
	except Exception:
		frappe.log_error(title="phase87_ensure_media_fields", message=frappe.get_traceback())
	try:
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


def _ensure_hec_module():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def

		ensure_hec_module_def()
	except Exception:
		try:
			from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

			ensure_module_def()
		except Exception:
			if not frappe.db.exists("Module Def", "Health Ecosystem Core"):
				frappe.get_doc(
					{
						"doctype": "Module Def",
						"module_name": "Health Ecosystem Core",
						"app_name": "health_ecosystem_core",
						"custom": 1,
					}
				).insert(ignore_permissions=True)


def _wa_permissions():
	return [
		{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
		{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
		{"role": "CRM Staff", "read": 1, "write": 1, "create": 1},
		{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
		{"role": "Sales Representative", "read": 1, "write": 1, "create": 1},
		{"role": "All", "read": 1, "write": 1, "create": 1},
	]


def _ensure_doctypes():
	"""Create WhatsApp DocTypes inline when JSON fixtures are missing (production hot path)."""
	import os

	_ensure_hec_module()
	base = os.path.join(os.path.dirname(__file__), "doctype")
	for folder, name in (
		("hec_whatsapp_conversation", "HEC WhatsApp Conversation"),
		("hec_whatsapp_message", "HEC WhatsApp Message"),
	):
		if frappe.db.exists("DocType", name):
			continue
		path = os.path.join(base, folder, f"{folder}.json")
		if os.path.isfile(path):
			with open(path, encoding="utf-8") as handle:
				payload = json.load(handle)
			doc = frappe.get_doc(payload)
			doc.insert(ignore_permissions=True)
			frappe.db.commit()
			continue
		if name == "HEC WhatsApp Conversation":
			frappe.get_doc(
				{
					"doctype": "DocType",
					"name": name,
					"module": "Health Ecosystem Core",
					"custom": 1,
					"istable": 0,
					"editable_grid": 0,
					"track_changes": 0,
					"engine": "InnoDB",
					"naming_rule": "Expression",
					"autoname": "format:HWC-{#####}",
					"fields": [
						{"fieldname": "phone", "label": "Phone", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
						{"fieldname": "wa_id", "label": "WhatsApp ID", "fieldtype": "Data"},
						{"fieldname": "contact_name", "label": "Contact Name", "fieldtype": "Data", "in_list_view": 1},
						{
							"fieldname": "crm_wing",
							"label": "CRM Wing",
							"fieldtype": "Select",
							"options": "\nlab\naesthetic\ncare\nnexilab\nfranchise",
							"in_standard_filter": 1,
						},
						{
							"fieldname": "crm_channel",
							"label": "CRM Channel",
							"fieldtype": "Select",
							"options": "franchise\nservice",
							"default": "franchise",
							"in_standard_filter": 1,
						},
						{"fieldname": "crm_lead_id", "label": "CRM Lead ID", "fieldtype": "Data"},
						{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Open\nClosed", "default": "Open", "in_list_view": 1},
						{"fieldname": "last_message_at", "label": "Last Message At", "fieldtype": "Datetime", "in_list_view": 1},
						{"fieldname": "crm_last_read_at", "label": "CRM Last Read At", "fieldtype": "Datetime"},
						{"fieldname": "rfms_lead_id", "label": "RFMS Lead ID", "fieldtype": "Data"},
						{"fieldname": "franchise_sales_lead", "label": "Franchise Sales Lead", "fieldtype": "Data"},
						{"fieldname": "auto_ack_sent", "label": "Auto Ack Sent", "fieldtype": "Check", "default": "0"},
					],
					"permissions": _wa_permissions(),
				}
			).insert(ignore_permissions=True)
			frappe.db.commit()
			continue
		if name == "HEC WhatsApp Message":
			frappe.get_doc(
				{
					"doctype": "DocType",
					"name": name,
					"module": "Health Ecosystem Core",
					"custom": 1,
					"istable": 0,
					"editable_grid": 0,
					"track_changes": 0,
					"engine": "InnoDB",
					"naming_rule": "Expression",
					"autoname": "format:HWM-{#####}",
					"fields": [
						{
							"fieldname": "conversation",
							"label": "Conversation",
							"fieldtype": "Link",
							"options": "HEC WhatsApp Conversation",
							"reqd": 1,
							"in_list_view": 1,
							"in_standard_filter": 1,
						},
						{
							"fieldname": "direction",
							"label": "Direction",
							"fieldtype": "Select",
							"options": "In\nOut",
							"reqd": 1,
							"in_list_view": 1,
						},
						{"fieldname": "body", "label": "Body", "fieldtype": "Long Text"},
						{"fieldname": "media_kind", "label": "Media Kind", "fieldtype": "Data"},
						{"fieldname": "media_id", "label": "Media ID", "fieldtype": "Data"},
						{"fieldname": "media_mime", "label": "Media MIME", "fieldtype": "Data"},
						{"fieldname": "media_url", "label": "Media URL", "fieldtype": "Data"},
						{"fieldname": "media_error", "label": "Media Error", "fieldtype": "Data"},
						{"fieldname": "meta_message_id", "label": "Meta Message ID", "fieldtype": "Data"},
						{"fieldname": "status", "label": "Status", "fieldtype": "Data", "in_list_view": 1},
						{"fieldname": "message_at", "label": "Message At", "fieldtype": "Datetime", "in_list_view": 1},
						{"fieldname": "raw_payload", "label": "Raw Payload", "fieldtype": "Long Text"},
					],
					"permissions": _wa_permissions(),
				}
			).insert(ignore_permissions=True)
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
	"""Unified outbound WhatsApp. Returns truthy on success (message id or True).

	CRM WhatsApp Centre / force_live skips notification-channel test mode when Meta credentials exist.
	"""
	context = context or {}
	if not phone or not message:
		return False
	force_live = bool(context.get("force_live") or context.get("source") == "crm_portal")
	override_token = cstr(context.get("meta_token") or "").strip()
	override_phone = cstr(context.get("meta_phone_id") or "").strip()
	override_ready = bool(override_token and override_phone)
	meta_ready = bool(get_meta_whatsapp_access_token() and get_whatsapp_phone_number_id()) or override_ready
	if whatsapp_test_mode() and not (force_live and meta_ready):
		frappe.logger("hec_whatsapp").info(f"WhatsApp test [{phone}]: {message}")
		if context.get("persist") or context.get("conversation") or context.get("franchise"):
			try:
				_persist_outbound(phone, message, meta_id=f"test-{now_datetime()}", status="test", context=context)
			except Exception:
				frappe.log_error(title="phase87_persist_outbound", message=frappe.get_traceback())
		return True

	provider = get_whatsapp_provider()
	if provider == "Meta" or (force_live and meta_ready):
		result, err = _send_meta_cloud(
			phone,
			message,
			template=context.get("template"),
			language=context.get("language"),
			template_params=context.get("template_params"),
			token=override_token or None,
			phone_id=override_phone or None,
			api_version=context.get("meta_api_version"),
		)
		if not result:
			context["last_error"] = err or "Meta Cloud send failed"
			if context.get("persist") or context.get("conversation") or context.get("franchise"):
				try:
					_persist_outbound(phone, message, meta_id="", status="failed", context=context)
				except Exception:
					frappe.log_error(title="phase87_persist_outbound", message=frappe.get_traceback())
			return False
	else:
		from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_gupshup_whatsapp

		result = send_gupshup_whatsapp(phone, message)
		if not result:
			return False

	if result and (context.get("persist") or context.get("conversation") or context.get("franchise")):
		try:
			meta_id = result if isinstance(result, str) else cstr(result)
			_persist_outbound(phone, message, meta_id=meta_id if meta_id and meta_id != "True" else "", status="sent", context=context)
		except Exception:
			frappe.log_error(title="phase87_persist_outbound", message=frappe.get_traceback())
	return result


def _send_meta_cloud(
	phone,
	message,
	*,
	template=None,
	language=None,
	template_params=None,
	token=None,
	phone_id=None,
	api_version=None,
):
	"""Return (message_id_or_True, error_message_or_None)."""
	token = cstr(token or "").strip() or get_meta_whatsapp_access_token()
	phone_id = cstr(phone_id or "").strip() or get_whatsapp_phone_number_id()
	to = _e164_in(phone)
	if not token or not phone_id or not to:
		return False, "Meta WhatsApp token or phone number ID is missing"
	ver = cstr(api_version or GRAPH_VERSION).strip() or GRAPH_VERSION
	url = f"https://graph.facebook.com/{ver}/{phone_id}/messages"
	tpl = cstr(template or "").strip()
	if tpl:
		tpl_body = {
			"name": tpl,
			"language": {"code": cstr(language or "en")},
		}
		params = template_params
		if isinstance(params, str):
			params = [params]
		if params:
			tpl_body["components"] = [
				{
					"type": "body",
					"parameters": [{"type": "text", "text": cstr(p)[:1024]} for p in params if cstr(p).strip()],
				}
			]
		payload = {
			"messaging_product": "whatsapp",
			"to": to,
			"type": "template",
			"template": tpl_body,
		}
	else:
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
			err = data.get("error") or {}
			msg = cstr(err.get("error_user_msg") or err.get("message") or data)[:500]
			frappe.log_error(title="phase87_meta_whatsapp_send", message=cstr(data)[:1000])
			return False, msg or f"Meta HTTP {resp.status_code}"
		messages = data.get("messages") or []
		mid = (messages[0] or {}).get("id") if messages else True
		return mid or True, None
	except Exception as exc:
		frappe.log_error(title="phase87_meta_whatsapp_send", message=frappe.get_traceback())
		return False, cstr(exc)[:300]


def _persist_outbound(phone, message, *, meta_id="", status="sent", context=None):
	context = context or {}
	ensure_phase87_whatsapp()
	ch = _normalize_crm_channel(context.get("channel"), franchise=bool(context.get("franchise")))
	conv = context.get("conversation") or get_or_create_conversation(
		phone,
		contact_name=context.get("contact_name"),
		crm_wing=context.get("crm_wing") or context.get("wing"),
		crm_lead_id=context.get("crm_lead_id"),
		franchise=ch == "franchise",
		channel=ch,
	)
	if not conv:
		return
	_apply_crm_meta(
		conv,
		crm_wing=context.get("crm_wing") or context.get("wing"),
		crm_lead_id=context.get("crm_lead_id"),
		contact_name=context.get("contact_name"),
		franchise=ch == "franchise",
		channel=ch,
	)
	_append_message(
		conv.name if hasattr(conv, "name") else conv,
		direction="Out",
		body=message,
		meta_message_id=meta_id,
		status=status,
	)


def _normalize_crm_wing(wing, *, franchise=False):
	value = cstr(wing or "").strip().lower()
	if value in ("lab", "aesthetic", "care", "nexilab", "franchise"):
		return value
	if franchise:
		return "franchise"
	return ""


def _normalize_crm_channel(channel=None, *, franchise=False):
	ch = cstr(channel or "").strip().lower()
	if ch == "service":
		return "service"
	if ch == "franchise":
		return "franchise"
	return "franchise" if franchise else "franchise"


def _conversation_channel(row) -> str:
	raw = cstr(getattr(row, "crm_channel", None) or (row.get("crm_channel") if isinstance(row, dict) else "") or "").strip().lower()
	if raw in ("service", "franchise"):
		return raw
	# Legacy rows (pre dual-channel) are Franchise Meta inbox.
	return "franchise"


def _has_crm_channel_field() -> bool:
	try:
		return bool(frappe.get_meta("HEC WhatsApp Conversation").has_field("crm_channel"))
	except Exception:
		return False


def _apply_crm_meta(conv, *, crm_wing="", crm_lead_id="", contact_name="", franchise=False, channel=None):
	if not conv:
		return
	wing = _normalize_crm_wing(crm_wing, franchise=franchise)
	ch = _normalize_crm_channel(channel, franchise=franchise)
	changed = False
	if wing and cstr(getattr(conv, "crm_wing", "") or "") != wing:
		conv.crm_wing = wing
		changed = True
	if _has_crm_channel_field() and cstr(getattr(conv, "crm_channel", "") or "").strip().lower() != ch:
		conv.crm_channel = ch
		changed = True
	lead_id = cstr(crm_lead_id or "").strip()[:80]
	if lead_id and cstr(getattr(conv, "crm_lead_id", "") or "") != lead_id:
		conv.crm_lead_id = lead_id
		changed = True
	name = cstr(contact_name or "").strip()[:120]
	if name and not cstr(getattr(conv, "contact_name", "") or "").strip():
		conv.contact_name = name
		changed = True
	if changed:
		conv.save(ignore_permissions=True)
		frappe.db.commit()


def get_or_create_conversation(
	phone,
	*,
	contact_name=None,
	wa_id=None,
	crm_wing=None,
	crm_lead_id=None,
	franchise=False,
	channel=None,
):
	ensure_phase87_whatsapp()
	digits = _digits(phone)
	if not digits:
		return None
	want_channel = _normalize_crm_channel(channel, franchise=franchise)
	# Match last 10 digits within the same Franchise/Service channel (separate Meta numbers).
	existing = None
	fields = ["name", "phone"]
	if _has_crm_channel_field():
		fields.append("crm_channel")
	for row in frappe.get_all("HEC WhatsApp Conversation", fields=fields, limit=500):
		if _digits(row.phone)[-10:] != digits[-10:]:
			continue
		if _conversation_channel(row) != want_channel:
			continue
		existing = row.name
		break
	if existing:
		doc = frappe.get_doc("HEC WhatsApp Conversation", existing)
		if contact_name and not doc.contact_name:
			doc.contact_name = cstr(contact_name)[:120]
		if wa_id:
			doc.wa_id = cstr(wa_id)
		doc.save(ignore_permissions=True)
		_apply_crm_meta(
			doc,
			crm_wing=crm_wing,
			crm_lead_id=crm_lead_id,
			contact_name=contact_name,
			franchise=franchise,
			channel=want_channel,
		)
		return doc
	payload = {
		"doctype": "HEC WhatsApp Conversation",
		"phone": digits[-10:] if len(digits) >= 10 else digits,
		"wa_id": cstr(wa_id or ""),
		"status": "Open",
		"contact_name": cstr(contact_name or ""),
		"last_message_at": now_datetime(),
	}
	if _has_crm_channel_field():
		payload["crm_channel"] = want_channel
	wing = _normalize_crm_wing(crm_wing, franchise=franchise)
	if wing:
		payload["crm_wing"] = wing
	lead_id = cstr(crm_lead_id or "").strip()[:80]
	if lead_id:
		payload["crm_lead_id"] = lead_id
	doc = frappe.get_doc(payload)
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


def _ensure_message_media_fields():
	"""Store downloaded WhatsApp image/video/audio/document on the message row."""
	if not frappe.db.exists("DocType", "HEC WhatsApp Message"):
		return
	wanted = (
		("media_kind", "Media Kind"),
		("media_id", "Media ID"),
		("media_mime", "Media MIME"),
		("media_url", "Media URL"),
		("media_error", "Media Error"),
	)
	try:
		meta = frappe.get_meta("HEC WhatsApp Message")
	except Exception:
		return
	missing = [pair for pair in wanted if not meta.has_field(pair[0])]
	if not missing:
		return
	try:
		doc = frappe.get_doc("DocType", "HEC WhatsApp Message")
		for fieldname, label in missing:
			doc.append("fields", {"fieldname": fieldname, "label": label, "fieldtype": "Data", "insert_after": "body"})
		doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="HEC WhatsApp Message")
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="wa_ensure_message_media", message=frappe.get_traceback())


def _message_has_media_fields() -> bool:
	try:
		return bool(frappe.get_meta("HEC WhatsApp Message").has_field("media_url"))
	except Exception:
		return False


def _token_for_channel(channel: str) -> str:
	ch = _normalize_crm_channel(channel)
	if ch == "service":
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
				get_crm_service_whatsapp_access_token,
			)

			return cstr(get_crm_service_whatsapp_access_token() or "").strip()
		except Exception:
			return ""
	return cstr(get_meta_whatsapp_access_token() or "").strip()


def _media_parts(msg: dict):
	"""Pull Meta media id/caption from an inbound webhook message."""
	if not isinstance(msg, dict):
		return None
	kind = cstr(msg.get("type") or "").strip().lower()
	block = msg.get(kind) if isinstance(msg.get(kind), dict) else {}
	media_id = cstr((block or {}).get("id") or "").strip()
	if kind not in ("image", "video", "audio", "document", "sticker") or not media_id:
		return None
	return {
		"kind": kind,
		"id": media_id[:140],
		"mime": cstr((block or {}).get("mime_type") or "").split(";")[0].strip().lower(),
		"caption": cstr((block or {}).get("caption") or "").strip(),
		"filename": cstr((block or {}).get("filename") or "").strip(),
	}


def _ext_for_mime(mime: str, kind: str) -> str:
	table = {
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"video/3gpp": "3gp",
		"audio/ogg": "ogg",
		"audio/mpeg": "mp3",
		"audio/mp4": "m4a",
		"audio/aac": "aac",
		"application/pdf": "pdf",
	}
	if mime in table:
		return table[mime]
	if kind == "image":
		return "jpg"
	if kind == "video":
		return "mp4"
	if kind == "audio":
		return "ogg"
	if kind == "sticker":
		return "webp"
	return "bin"


def _download_meta_media(media_id: str, token: str):
	info = requests.get(
		f"https://graph.facebook.com/{GRAPH_VERSION}/{media_id}",
		headers={"Authorization": f"Bearer {token}"},
		timeout=30,
	)
	info.raise_for_status()
	payload = info.json() if info.content else {}
	url = cstr(payload.get("url") or "").strip()
	mime = cstr(payload.get("mime_type") or "").split(";")[0].strip().lower()
	size = int(payload.get("file_size") or 0)
	if not url:
		raise ValueError("Meta media URL missing")
	if size and size > 16 * 1024 * 1024:
		raise ValueError("WhatsApp media is larger than 16 MB")
	blob = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
	blob.raise_for_status()
	content = blob.content or b""
	if len(content) > 16 * 1024 * 1024:
		raise ValueError("WhatsApp media is larger than 16 MB")
	if not mime:
		mime = cstr(blob.headers.get("Content-Type") or "").split(";")[0].strip().lower()
	return content, mime


def _attach_whatsapp_media(message_name, *, media_id, kind, mime="", filename="", caption="", channel="franchise"):
	"""Download a Meta media id and store a public /files URL on the message."""
	if not message_name or not media_id or not frappe.db.exists("HEC WhatsApp Message", message_name):
		return ""
	_ensure_message_media_fields()
	if not _message_has_media_fields():
		return ""
	current = frappe.db.get_value(
		"HEC WhatsApp Message",
		message_name,
		["media_url", "media_id", "media_error"],
		as_dict=True,
	) or {}
	if cstr(current.get("media_url") or "").strip():
		return cstr(current.get("media_url"))
	if cstr(current.get("media_error") or "").strip() and cstr(current.get("media_id") or "") == media_id:
		return ""
	token = _token_for_channel(channel)
	if not token:
		frappe.db.set_value(
			"HEC WhatsApp Message",
			message_name,
			{"media_id": media_id, "media_kind": kind, "media_error": "WhatsApp token missing"},
			update_modified=False,
		)
		frappe.db.commit()
		return ""
	try:
		content, got_mime = _download_meta_media(media_id, token)
		use_mime = got_mime or mime or "application/octet-stream"
		ext = _ext_for_mime(use_mime, kind)
		safe_name = filename or f"wa-{kind}-{media_id[-10:]}.{ext}"
		if "." not in safe_name:
			safe_name = f"{safe_name}.{ext}"
		from frappe.utils.file_manager import save_file

		file_doc = save_file(
			safe_name[:140],
			content,
			"HEC WhatsApp Message",
			message_name,
			is_private=0,
			decode=False,
		)
		file_url = cstr(getattr(file_doc, "file_url", "") or "").strip()
		values = {
			"media_id": media_id,
			"media_kind": kind,
			"media_mime": use_mime[:140],
			"media_url": file_url[:240],
			"media_error": "",
		}
		if caption:
			values["body"] = caption[:8000]
		frappe.db.set_value("HEC WhatsApp Message", message_name, values, update_modified=False)
		frappe.db.commit()
		return file_url
	except Exception as exc:
		frappe.db.set_value(
			"HEC WhatsApp Message",
			message_name,
			{
				"media_id": media_id,
				"media_kind": kind,
				"media_mime": (mime or "")[:140],
				"media_error": cstr(exc)[:140],
			},
			update_modified=False,
		)
		frappe.db.commit()
		frappe.log_error(title="wa_attach_media", message=frappe.get_traceback())
		return ""


def _hydrate_message_media(rows, channel="franchise"):
	"""Download media for older [image] rows the first time a thread is opened."""
	if not rows or not _message_has_media_fields():
		return
	for row in rows:
		if cstr(getattr(row, "media_url", "") or "").strip():
			continue
		raw = cstr(getattr(row, "raw_payload", "") or "")
		try:
			payload = json.loads(raw) if raw else {}
		except Exception:
			payload = {}
		parts = _media_parts(payload if isinstance(payload, dict) else {})
		if not parts:
			continue
		_attach_whatsapp_media(
			row.name,
			media_id=parts["id"],
			kind=parts["kind"],
			mime=parts["mime"],
			filename=parts["filename"],
			caption=parts["caption"],
			channel=channel,
		)
		fresh = frappe.db.get_value(
			"HEC WhatsApp Message",
			row.name,
			["media_url", "media_kind", "media_mime", "body"],
			as_dict=True,
		)
		if fresh:
			row.media_url = fresh.media_url
			row.media_kind = fresh.media_kind
			row.media_mime = fresh.media_mime
			if fresh.body:
				row.body = fresh.body


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
			meta = value.get("metadata") or {}
			phone_number_id = cstr(meta.get("phone_number_id") or "")
			channel = _channel_from_meta_phone_id(phone_number_id)
			for status in value.get("statuses") or []:
				_apply_status(status)
			contacts = {c.get("wa_id"): c for c in (value.get("contacts") or []) if c.get("wa_id")}
			for msg in value.get("messages") or []:
				created.append(
					_ingest_inbound_message(msg, contacts.get(msg.get("from")) or {}, channel=channel)
				)
	return _success({"messages": created, "count": len(created)})


def _channel_from_meta_phone_id(phone_number_id: str) -> str:
	"""Map inbound Meta phone_number_id to Franchise vs Service channel."""
	pid = cstr(phone_number_id or "").strip()
	if not pid:
		return "franchise"
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
			get_crm_service_whatsapp_phone_number_id,
			get_whatsapp_phone_number_id,
		)

		svc = cstr(get_crm_service_whatsapp_phone_number_id() or "").strip()
		if svc and pid == svc:
			return "service"
		fr = cstr(get_whatsapp_phone_number_id() or "").strip()
		if fr and pid == fr:
			return "franchise"
	except Exception:
		pass
	return "franchise"


def _apply_status(status: dict):
	mid = cstr(status.get("id") or "")
	st = cstr(status.get("status") or "").lower()
	if not mid or not st:
		return
	name = frappe.db.get_value("HEC WhatsApp Message", {"meta_message_id": mid}, "name")
	if name and st in ("sent", "delivered", "read", "failed"):
		frappe.db.set_value("HEC WhatsApp Message", name, "status", st)


def _ingest_inbound_message(msg: dict, contact: dict, *, channel: str = "franchise") -> dict:
	from_phone = cstr(msg.get("from") or "")
	msg_id = cstr(msg.get("id") or "")
	ch = _normalize_crm_channel(channel)
	text = ""
	parts = _media_parts(msg)
	if msg.get("type") == "text":
		text = cstr((msg.get("text") or {}).get("body") or "")
	elif msg.get("type") == "button":
		text = cstr((msg.get("button") or {}).get("text") or "")
	elif parts:
		text = parts["caption"] or f"[{parts['kind']}]"
	else:
		text = f"[{msg.get('type') or 'message'}]"
	contact_name = cstr(((contact.get("profile") or {}).get("name")) or "")
	fields = ["phone"]
	if _has_crm_channel_field():
		fields.append("crm_channel")
	is_new = not any(
		_digits(row.phone)[-10:] == _digits(from_phone)[-10:] and _conversation_channel(row) == ch
		for row in frappe.get_all("HEC WhatsApp Conversation", fields=fields, limit=500)
	)
	conv = get_or_create_conversation(
		from_phone,
		contact_name=contact_name,
		wa_id=from_phone,
		franchise=ch == "franchise",
		channel=ch,
	)
	msg_name = _append_message(conv.name, direction="In", body=text, meta_message_id=msg_id, status="received", raw=msg)
	if parts and msg_name:
		_attach_whatsapp_media(
			msg_name,
			media_id=parts["id"],
			kind=parts["kind"],
			mime=parts["mime"],
			filename=parts["filename"],
			caption=parts["caption"],
			channel=ch,
		)
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
	if is_new and ch == "franchise" and whatsapp_franchise_auto_ack_enabled() and not conv.auto_ack_sent:
		ack = get_whatsapp_franchise_auto_ack_message()
		send_whatsapp(
			conv.phone,
			ack,
			context={"conversation": conv, "franchise": True, "channel": "franchise", "persist": True},
		)
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


def _conversation_wing(row) -> str:
	wing = cstr(getattr(row, "crm_wing", None) or (row.get("crm_wing") if isinstance(row, dict) else "") or "").strip().lower()
	if wing in ("lab", "aesthetic", "care", "nexilab", "franchise"):
		return wing
	if cstr(getattr(row, "franchise_sales_lead", None) or (row.get("franchise_sales_lead") if isinstance(row, dict) else "") or "").strip():
		return "franchise"
	if cstr(getattr(row, "rfms_lead_id", None) or (row.get("rfms_lead_id") if isinstance(row, dict) else "") or "").strip():
		return "franchise"
	return ""


def _as_dt(value):
	from frappe.utils import get_datetime

	if not value:
		return None
	try:
		return get_datetime(value)
	except Exception:
		return None


def _conversation_is_unread(last_direction, last_message_at, crm_last_read_at) -> bool:
	"""Unread only when the latest message is inbound and newer than the shared CRM read stamp.

	A viewed chat stays read. Timestamp skew (read stamp a moment before message_at) must not
	bring a viewed chat back as unread.
	"""
	if cstr(last_direction or "").strip().lower() not in ("in", "inbound", "incoming"):
		return False
	if not last_message_at:
		return False
	if not crm_last_read_at:
		return True
	msg_dt = _as_dt(last_message_at)
	read_dt = _as_dt(crm_last_read_at)
	if not msg_dt or not read_dt:
		# Read stamp exists — do not treat a viewed chat as unread when clocks cannot be parsed.
		return False
	return msg_dt > read_dt


def mark_crm_whatsapp_conversation_read(conversation_id=None):
	"""Mark a WhatsApp chat as read for the whole CRM team (shared inbox)."""
	ensure_phase87_whatsapp()
	_ensure_conversation_read_field()
	cid = cstr(conversation_id or "").strip()
	if not cid or not frappe.db.exists("HEC WhatsApp Conversation", cid):
		return {"ok": False}
	from frappe.utils import add_to_date

	now = _as_dt(now_datetime()) or now_datetime()
	latest = None
	try:
		latest = frappe.db.sql(
			"select max(message_at) from `tabHEC WhatsApp Message` where conversation=%s",
			cid,
		)
		latest = latest[0][0] if latest else None
	except Exception:
		latest = None
	stamp = now
	msg_dt = _as_dt(latest)
	if msg_dt and msg_dt > stamp:
		stamp = msg_dt
	# Sit just after the latest message so a viewed chat cannot compare as still unread.
	try:
		stamp = add_to_date(stamp, seconds=2, as_datetime=True)
	except Exception:
		pass
	frappe.db.set_value(
		"HEC WhatsApp Conversation",
		cid,
		"crm_last_read_at",
		stamp,
		update_modified=False,
	)
	frappe.db.commit()
	return {"ok": True, "id": cid, "crm_last_read_at": str(stamp)}


def list_crm_whatsapp_conversations(wing=None, q=None, limit=100, channel=None):
	"""Smilecure CRM WhatsApp Centre — inbox rows filtered by wing and Franchise/Service channel."""
	ensure_phase87_whatsapp()
	_ensure_conversation_read_field()
	_ensure_conversation_channel_field()
	want = cstr(wing or "all").strip().lower()
	want_channel = cstr(channel or "all").strip().lower() or "all"
	if want_channel not in ("", "all", "franchise", "service"):
		want_channel = "all"
	needle = cstr(q or "").strip().lower()
	cap = max(1, min(cint_safe(limit, 100), 300))
	fields = [
		"name",
		"phone",
		"status",
		"contact_name",
		"last_message_at",
		"rfms_lead_id",
		"franchise_sales_lead",
		"crm_wing",
		"crm_lead_id",
	]
	if frappe.get_meta("HEC WhatsApp Conversation").has_field("crm_last_read_at"):
		fields.append("crm_last_read_at")
	if _has_crm_channel_field():
		fields.append("crm_channel")
	rows = frappe.get_all(
		"HEC WhatsApp Conversation",
		fields=fields,
		order_by="last_message_at desc",
		limit_page_length=500,
	)
	latest_by_conv = _latest_message_by_conversation([r.name for r in rows])
	out = []
	counts = {"all": 0, "lab": 0, "aesthetic": 0, "care": 0, "nexilab": 0, "franchise": 0, "unassigned": 0}
	for row in rows:
		crm_wing = _conversation_wing(row)
		crm_channel = _conversation_channel(row)
		if want_channel in ("franchise", "service") and crm_channel != want_channel:
			continue
		counts["all"] += 1
		if crm_wing:
			counts[crm_wing] = counts.get(crm_wing, 0) + 1
		else:
			counts["unassigned"] += 1
		if want not in ("", "all"):
			if want == "unassigned":
				if crm_wing:
					continue
			elif crm_wing != want:
				continue
		if needle:
			blob = " ".join(
				[
					cstr(row.contact_name or ""),
					cstr(row.phone or ""),
					cstr(row.crm_lead_id or ""),
					cstr(row.name or ""),
				]
			).lower()
			if needle not in blob:
				continue
		preview = ""
		last_direction = ""
		last_msg_at = row.last_message_at
		last = latest_by_conv.get(row.name)
		if last:
			preview = cstr(last.get("body") or "")[:160]
			last_direction = cstr(last.get("direction") or "")
			last_msg_at = last.get("message_at") or last_msg_at
		read_at = getattr(row, "crm_last_read_at", None)
		unread = _conversation_is_unread(last_direction, last_msg_at, read_at)
		out.append(
			{
				"id": row.name,
				"phone": row.phone,
				"status": row.status or "Open",
				"contact_name": row.contact_name or "",
				"crm_wing": crm_wing or "unassigned",
				"crm_channel": crm_channel,
				"channel": crm_channel,
				"crm_lead_id": row.crm_lead_id or "",
				"rfms_lead_id": row.rfms_lead_id or "",
				"last_message_at": str(last_msg_at or row.last_message_at or ""),
				"last_direction": last_direction,
				"crm_last_read_at": str(read_at or ""),
				"unread": unread,
				"preview": preview,
			}
		)
		if len(out) >= cap:
			break
	return {
		"conversations": out,
		"counts": counts,
		"wing": want or "all",
		"channel": want_channel or "all",
	}


def _latest_message_by_conversation(names):
	"""One query for the newest message per chat. Per-row lookups made inbox sync miss read updates."""
	names = [cstr(n).strip() for n in (names or []) if cstr(n).strip()]
	if not names:
		return {}
	try:
		fetched = frappe.db.sql(
			"""
			SELECT m.conversation, m.body, m.direction, m.message_at
			FROM `tabHEC WhatsApp Message` m
			INNER JOIN (
				SELECT conversation, MAX(message_at) AS message_at
				FROM `tabHEC WhatsApp Message`
				WHERE conversation IN %(names)s
				GROUP BY conversation
			) t ON t.conversation = m.conversation AND t.message_at = m.message_at
			""",
			{"names": tuple(names)},
			as_dict=True,
		)
	except Exception:
		frappe.log_error(title="wa_latest_message_batch", message=frappe.get_traceback())
		return {}
	out = {}
	for row in fetched or []:
		out.setdefault(row.conversation, row)
	return out


def cint_safe(value, default=0):
	try:
		return int(value)
	except Exception:
		return default


def get_crm_whatsapp_thread(
	conversation_id=None,
	phone=None,
	crm_wing=None,
	crm_lead_id=None,
	contact_name=None,
	channel=None,
):
	"""Smilecure CRM WhatsApp Centre — one conversation + messages."""
	ensure_phase87_whatsapp()
	conv = None
	cid = cstr(conversation_id or "").strip()
	phone_digits = _digits(phone)
	wing = _normalize_crm_wing(crm_wing)
	ch = _normalize_crm_channel(channel, franchise=wing in ("franchise", "nexilab") or not channel)
	if cid and frappe.db.exists("HEC WhatsApp Conversation", cid):
		conv = frappe.get_doc("HEC WhatsApp Conversation", cid)
	elif phone_digits:
		conv = get_or_create_conversation(
			phone_digits,
			contact_name=contact_name,
			crm_wing=wing,
			crm_lead_id=crm_lead_id,
			franchise=ch == "franchise",
			channel=ch,
		)
	if not conv:
		return {"conversation": None, "messages": []}
	_apply_crm_meta(
		conv,
		crm_wing=wing,
		crm_lead_id=crm_lead_id,
		contact_name=contact_name,
		franchise=ch == "franchise",
		channel=_conversation_channel(conv) if cid else ch,
	)
	# Opening a thread marks it read for every CRM executive (shared counter).
	try:
		mark_crm_whatsapp_conversation_read(conv.name)
		conv.reload()
	except Exception:
		frappe.log_error(title="wa_mark_read_on_open", message=frappe.get_traceback())
	msg_fields = ["name", "direction", "body", "meta_message_id", "status", "message_at"]
	if _message_has_media_fields():
		msg_fields.extend(["media_url", "media_kind", "media_mime", "media_id", "raw_payload"])
	rows = frappe.get_all(
		"HEC WhatsApp Message",
		filters={"conversation": conv.name},
		fields=msg_fields,
		order_by="message_at asc",
		limit=300,
	)
	try:
		_hydrate_message_media(rows, channel=_conversation_channel(conv))
	except Exception:
		frappe.log_error(title="wa_hydrate_media", message=frappe.get_traceback())
	return {
		"conversation": {
			"id": conv.name,
			"phone": conv.phone,
			"status": conv.status,
			"contact_name": conv.contact_name,
			"crm_wing": _conversation_wing(conv) or "unassigned",
			"crm_channel": _conversation_channel(conv),
			"channel": _conversation_channel(conv),
			"crm_lead_id": cstr(getattr(conv, "crm_lead_id", "") or ""),
			"rfms_lead_id": cstr(getattr(conv, "rfms_lead_id", "") or ""),
			"last_message_at": str(conv.last_message_at or ""),
			"crm_last_read_at": str(getattr(conv, "crm_last_read_at", "") or ""),
			"unread": False,
		},
		"messages": [
			{
				"id": r.name,
				"direction": r.direction,
				"body": r.body,
				"meta_message_id": r.meta_message_id,
				"status": r.status,
				"created_at": str(r.message_at or ""),
				"media_url": cstr(getattr(r, "media_url", "") or ""),
				"media_kind": cstr(getattr(r, "media_kind", "") or ""),
				"media_mime": cstr(getattr(r, "media_mime", "") or ""),
			}
			for r in rows
		],
	}


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
