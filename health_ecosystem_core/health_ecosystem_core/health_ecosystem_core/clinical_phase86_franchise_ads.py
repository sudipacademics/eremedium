"""
Phase 86 — Franchise ads lead closed loop (Meta Lead Ads + Google Lead Forms → Reach + RFMS).

Guest webhook ingest_franchise_ad_lead:
  - Meta verify challenge + leadgen POST (Graph enrich when token present)
  - Google Lead Form / generic JSON lead POST
Upserts Franchise Sales Lead (unassigned) and pushes to RFMS CRM via shared secret.
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

from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
	get_franchise_ads_webhook_secret,
	get_hiring_ads_webhook_secret,
	get_meta_access_token,
	meta_ads_configured,
)

SOURCE_META = "Meta Ads"
SOURCE_GOOGLE = "Google Ads"
SOURCE_WHATSAPP = "WhatsApp Ads"
SOURCE_MANUAL = "Manual"

RFMS_SOURCE_MAP = {
	SOURCE_META: "meta_ads",
	SOURCE_GOOGLE: "google_ads",
	SOURCE_WHATSAPP: "whatsapp_ads",
}


def _franchise_ads_secret() -> str | None:
	return get_franchise_ads_webhook_secret() or get_hiring_ads_webhook_secret()


def get_rfms_api_base_url() -> str:
	return cstr(
		frappe.conf.get("rfms_api_base_url")
		or frappe.db.get_single_value("Health Ecosystem Settings", "rfms_api_base_url")
		or "https://www.e-remedium.in/rfms-api/v1"
	).rstrip("/")


def get_franchise_ads_page_allowlist() -> set[str]:
	raw = cstr(
		frappe.conf.get("franchise_ads_page_ids")
		or frappe.db.get_single_value("Health Ecosystem Settings", "franchise_ads_page_ids")
		or ""
	)
	return {part.strip() for part in raw.replace(";", ",").split(",") if part.strip()}


def ensure_phase86_fields():
	"""Hot-path custom fields when DocType sync is delayed."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	def missing_meta(doctype, fieldname):
		if frappe.get_meta(doctype).has_field(fieldname):
			return False
		return not frappe.db.exists("Custom Field", {"dt": doctype, "fieldname": fieldname})

	def ensure_db_column(doctype, fieldname, fieldtype="Data", options=None, default=None):
		"""DocType JSON may list a field before migrate created the SQL column."""
		if frappe.db.has_column(doctype, fieldname):
			return
		# Prefer Custom Field creation (also adds SQL column); else raw add.
		if not frappe.db.exists("Custom Field", {"dt": doctype, "fieldname": fieldname}):
			try:
				create_custom_fields(
					{
						doctype: [
							{
								"fieldname": fieldname,
								"fieldtype": fieldtype,
								"label": fieldname.replace("_", " ").title(),
								"options": options or "",
								"default": default or "",
								"insert_after": "franchisee",
							}
						]
					},
					update=True,
				)
			except Exception:
				frappe.log_error(title=f"ensure_cf_{doctype}_{fieldname}", message=frappe.get_traceback())
		if not frappe.db.has_column(doctype, fieldname):
			sql_type = "varchar(140)"
			if fieldtype == "Select":
				sql_type = "varchar(140)"
			elif fieldtype == "Small Text":
				sql_type = "text"
			elif fieldtype == "Check":
				sql_type = "int(1)"
			frappe.db.sql(
				f"ALTER TABLE `tab{doctype}` ADD COLUMN `{fieldname}` {sql_type} NULL"
			)
			frappe.db.commit()

	# Critical leads columns used by REACH list API
	for fname, ftype, opts, default in (
		("lead_source", "Select", "Manual\nMeta Ads\nGoogle Ads\nWhatsApp Ads\nWebsite\nReach", "Manual"),
		("platform", "Data", None, None),
		("external_lead_id", "Data", None, None),
		("campaign_name", "Data", None, None),
		("campaign_id", "Data", None, None),
		("ad_id", "Data", None, None),
		("form_id", "Data", None, None),
		("rfms_lead_id", "Data", None, None),
		("district", "Data", None, None),
		("subdivision", "Data", None, None),
		("pincode", "Data", None, None),
	):
		ensure_db_column("Franchise Sales Lead", fname, ftype, opts, default)

	lead_fields = []
	settings_fields = []

	lead_defs = [
		{"fieldname": "section_ads_attribution", "fieldtype": "Section Break", "label": "Ads Attribution", "insert_after": "franchisee", "collapsible": 1},
		{"fieldname": "lead_source", "fieldtype": "Select", "label": "Lead Source", "options": "Manual\nMeta Ads\nGoogle Ads\nWhatsApp Ads\nWebsite\nReach", "default": "Manual", "insert_after": "section_ads_attribution"},
		{"fieldname": "platform", "fieldtype": "Data", "label": "Platform", "insert_after": "lead_source"},
		{"fieldname": "external_lead_id", "fieldtype": "Data", "label": "External Lead ID", "unique": 1, "insert_after": "platform"},
		{"fieldname": "campaign_name", "fieldtype": "Data", "label": "Campaign Name", "insert_after": "external_lead_id"},
		{"fieldname": "campaign_id", "fieldtype": "Data", "label": "Campaign ID", "insert_after": "campaign_name"},
		{"fieldname": "ad_id", "fieldtype": "Data", "label": "Ad ID", "insert_after": "campaign_id"},
		{"fieldname": "form_id", "fieldtype": "Data", "label": "Form ID", "insert_after": "ad_id"},
		{"fieldname": "rfms_lead_id", "fieldtype": "Data", "label": "RFMS Lead ID", "insert_after": "form_id"},
	]
	for df in lead_defs:
		if missing_meta("Franchise Sales Lead", df["fieldname"]):
			lead_fields.append(df)

	settings_defs = [
		{"fieldname": "section_franchise_ads", "fieldtype": "Section Break", "label": "Franchise Ads CRM", "insert_after": "hiring_ads_webhook_secret", "collapsible": 1},
		{"fieldname": "franchise_ads_webhook_secret", "fieldtype": "Password", "label": "Franchise Ads Webhook Secret", "insert_after": "section_franchise_ads"},
		{"fieldname": "franchise_ads_page_ids", "fieldtype": "Small Text", "label": "Franchise Meta Page IDs", "description": "Comma-separated page IDs allowed for franchise leadgen (blank = allow all).", "insert_after": "franchise_ads_webhook_secret"},
		{"fieldname": "rfms_api_base_url", "fieldtype": "Data", "label": "RFMS API Base URL", "default": "https://www.e-remedium.in/rfms-api/v1", "insert_after": "franchise_ads_page_ids"},
	]
	for df in settings_defs:
		if missing_meta("Health Ecosystem Settings", df["fieldname"]):
			settings_fields.append(df)

	payload = {}
	if lead_fields:
		payload["Franchise Sales Lead"] = lead_fields
	if settings_fields:
		payload["Health Ecosystem Settings"] = settings_fields
	if payload:
		create_custom_fields(payload, update=True)
	frappe.clear_cache(doctype="Franchise Sales Lead")


def _check_webhook_secret():
	# Meta hub challenge does not send secret; verified separately.
	secret = _franchise_ads_secret()
	if not secret:
		# Allow open ingest only in developer/test when explicitly configured
		if cstr(frappe.conf.get("franchise_ads_allow_open_webhook") or "") in ("1", "true", "True"):
			return
		frappe.throw(_("Franchise ads webhook secret is not configured"), frappe.AuthenticationError)
	provided = cstr(frappe.get_request_header("X-Franchise-Ads-Secret") or frappe.form_dict.get("secret") or "").strip()
	if not provided or provided != secret:
		frappe.throw(_("Invalid franchise ads webhook secret"), frappe.AuthenticationError)


def _normalize_source(value: Any) -> str:
	raw = cstr(value or "").strip().lower()
	if raw in ("facebook", "fb", "meta", "instagram", "ig", "meta_ads"):
		return SOURCE_META
	if raw in ("google", "google ads", "google_ads", "gads"):
		return SOURCE_GOOGLE
	if raw in ("whatsapp", "whatsapp_ads", "ctwa"):
		return SOURCE_WHATSAPP
	if raw in ("website",):
		return "Website"
	return SOURCE_META if not raw else cstr(value)


def _digits(value: Any) -> str:
	return re.sub(r"\D", "", cstr(value or ""))[-15:]


def _fetch_meta_lead(lead_id: str) -> dict[str, Any]:
	token = get_meta_access_token()
	if not token or not lead_id:
		return {}
	try:
		resp = requests.get(
			f"https://graph.facebook.com/v19.0/{lead_id}",
			params={"access_token": token, "fields": "created_time,field_data,campaign_id,ad_id,adset_id,form_id"},
			timeout=30,
		)
		return resp.json() if resp.ok else {}
	except Exception:
		frappe.log_error(title="phase86_fetch_meta_lead", message=frappe.get_traceback())
		return {}


def _field_map(detail: dict[str, Any]) -> dict[str, str]:
	out: dict[str, str] = {}
	for row in detail.get("field_data") or []:
		name = cstr(row.get("name") or "").strip().lower()
		values = row.get("values") or []
		out[name] = cstr(values[0] if values else "")
	return out


@frappe.whitelist(allow_guest=True)
def ingest_franchise_ad_lead(
	hub_mode=None,
	hub_challenge=None,
	hub_verify_token=None,
	payload=None,
	**kwargs,
):
	"""Meta verify + Meta/Google franchise lead ingest webhook."""
	frappe.flags.ignore_csrf = True

	# Meta webhook verification (GET)
	mode = _parse_request_value("hub.mode", hub_mode) or frappe.form_dict.get("hub.mode")
	challenge = _parse_request_value("hub.challenge", hub_challenge) or frappe.form_dict.get("hub.challenge")
	verify_token = _parse_request_value("hub.verify_token", hub_verify_token) or frappe.form_dict.get("hub.verify_token")
	if mode == "subscribe" and challenge:
		expected = cstr(_franchise_ads_secret() or frappe.conf.get("franchise_ads_verify_token") or "")
		if expected and cstr(verify_token) != expected:
			frappe.throw(_("Invalid Meta verify token"), frappe.AuthenticationError)
		frappe.local.response["type"] = "text"
		frappe.local.response["message"] = cstr(challenge)
		return cstr(challenge)

	_check_webhook_secret()

	if payload and isinstance(payload, str):
		try:
			payload = json.loads(payload)
		except Exception:
			payload = {}
	if not isinstance(payload, dict):
		payload = dict(frappe.request_dict or {}) if hasattr(frappe, "request_dict") else {}
	if not payload:
		try:
			raw = frappe.request.get_data(as_text=True) if frappe.request else ""
			payload = json.loads(raw) if raw else {}
		except Exception:
			payload = {}

	# Meta leadgen envelope
	if payload.get("entry") and payload.get("object") in (None, "page"):
		return _success(_ingest_meta_leadgen_payload(payload))

	# Generic / Google Lead Form style body
	result = upsert_franchise_ad_lead(
		lead_name=_parse_request_value("lead_name", kwargs.get("lead_name")) or payload.get("lead_name") or payload.get("full_name") or payload.get("name"),
		email=_parse_request_value("email", kwargs.get("email")) or payload.get("email"),
		phone=_parse_request_value("phone", kwargs.get("phone")) or payload.get("phone") or payload.get("mobile") or payload.get("phone_number"),
		source=_parse_request_value("source", kwargs.get("source")) or payload.get("source") or payload.get("utm_source") or SOURCE_GOOGLE,
		campaign_name=payload.get("campaign_name") or payload.get("campaign"),
		campaign_id=payload.get("campaign_id") or payload.get("campaign_external_id"),
		ad_id=payload.get("ad_id"),
		form_id=payload.get("form_id") or payload.get("form_id"),
		external_lead_id=payload.get("external_lead_id") or payload.get("lead_id") or payload.get("id") or payload.get("gcl_id"),
		platform=payload.get("platform") or "google",
		notes=payload.get("notes") or payload.get("message"),
		city=payload.get("city") or payload.get("territory") or payload.get("location"),
		district=payload.get("district"),
		pincode=payload.get("pincode") or payload.get("postal_code"),
		raw_payload=payload,
	)
	return _success(result)


def _ingest_meta_leadgen_payload(payload: dict[str, Any]) -> dict[str, Any]:
	allow = get_franchise_ads_page_allowlist()
	created = []
	for entry in payload.get("entry") or []:
		page_id = cstr(entry.get("id") or "")
		if allow and page_id and page_id not in allow:
			continue
		for change in entry.get("changes") or []:
			value = change.get("value") or {}
			lead_id = cstr(value.get("leadgen_id") or "")
			if not lead_id:
				continue
			detail = _fetch_meta_lead(lead_id) if meta_ads_configured() else {}
			fields = _field_map(detail)
			name = fields.get("full_name") or " ".join(filter(None, [fields.get("first_name"), fields.get("last_name")])).strip() or f"Lead {lead_id}"
			platform = SOURCE_WHATSAPP if "whatsapp" in cstr(value.get("leadgen_id") or "").lower() else SOURCE_META
			# CTWA forms still arrive as leadgen; detect via form/question hints
			joined = " ".join(fields.keys())
			if "whatsapp" in joined:
				platform = SOURCE_WHATSAPP
			created.append(
				upsert_franchise_ad_lead(
					lead_name=name,
					email=fields.get("email"),
					phone=fields.get("phone_number") or fields.get("phone") or fields.get("mobile"),
					source=platform,
					campaign_name=cstr(value.get("campaign_name") or ""),
					campaign_id=cstr(value.get("campaign_id") or detail.get("campaign_id") or ""),
					ad_id=cstr(value.get("ad_id") or detail.get("ad_id") or ""),
					form_id=cstr(value.get("form_id") or detail.get("form_id") or ""),
					external_lead_id=lead_id,
					platform="meta",
					notes="meta_leadgen",
					city=fields.get("city") or fields.get("preferred_location") or fields.get("territory"),
					raw_payload={"value": value, "detail": detail},
				)
			)
	return {"leads": created, "count": len(created)}


def upsert_franchise_ad_lead(
	*,
	lead_name: str | None,
	email: str | None = None,
	phone: str | None = None,
	source: str = SOURCE_META,
	campaign_name: str | None = None,
	campaign_id: str | None = None,
	ad_id: str | None = None,
	form_id: str | None = None,
	external_lead_id: str | None = None,
	platform: str | None = None,
	notes: str | None = None,
	city: str | None = None,
	district: str | None = None,
	pincode: str | None = None,
	raw_payload: Any = None,
) -> dict[str, Any]:
	ensure_phase86_fields()
	lead_name = cstr(lead_name or "").strip()
	phone_digits = _digits(phone)
	email = cstr(email or "").strip().lower()
	if not email and phone_digits:
		email = f"{phone_digits}@ads.franchise.local"
	if not lead_name:
		frappe.throw(_("lead_name is required"))
	if not phone_digits:
		frappe.throw(_("phone is required"))

	source_label = _normalize_source(source)
	external_lead_id = cstr(external_lead_id or "").strip()

	existing = None
	if external_lead_id and frappe.db.exists("Franchise Sales Lead", {"external_lead_id": external_lead_id}):
		existing = frappe.db.get_value("Franchise Sales Lead", {"external_lead_id": external_lead_id}, "name")
	if not existing and email and not email.endswith("@ads.franchise.local"):
		existing = frappe.db.get_value("Franchise Sales Lead", {"email": email}, "name")
	if not existing and phone_digits:
		# soft match last 10 digits
		for row in frappe.get_all("Franchise Sales Lead", fields=["name", "phone"], limit=500):
			if _digits(row.phone)[-10:] == phone_digits[-10:]:
				existing = row.name
				break

	action = "updated"
	if existing:
		doc = frappe.get_doc("Franchise Sales Lead", existing)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Franchise Sales Lead",
				"lead_name": lead_name,
				"phone": phone_digits,
				"status": "New",
				"state": "West Bengal",
			}
		)
		action = "created"

	doc.lead_name = lead_name
	doc.phone = phone_digits
	doc.email = email or doc.email
	doc.city = cstr(city or doc.city or "")
	doc.district = cstr(district or doc.district or "")
	doc.pincode = cstr(pincode or doc.pincode or "")
	doc.lead_source = source_label
	doc.platform = cstr(platform or source_label)
	doc.external_lead_id = external_lead_id or doc.external_lead_id
	doc.campaign_name = cstr(campaign_name or doc.campaign_name or "")
	doc.campaign_id = cstr(campaign_id or doc.campaign_id or "")
	doc.ad_id = cstr(ad_id or doc.ad_id or "")
	doc.form_id = cstr(form_id or doc.form_id or "")
	if notes:
		doc.notes = cstr(notes)[:1000]
	# Leave assigned_rep blank for unassigned ads pool
	if action == "created":
		doc.insert(ignore_permissions=True, ignore_mandatory=True)
	else:
		doc.save(ignore_permissions=True, ignore_mandatory=True)
	frappe.db.commit()

	rfms = _push_lead_to_rfms(
		{
			"name": lead_name,
			"email": email,
			"mobile": phone_digits,
			"territory_query": cstr(city or district or ""),
			"source": RFMS_SOURCE_MAP.get(source_label, "meta_ads"),
			"platform": cstr(platform or source_label),
			"campaign_name": cstr(campaign_name or ""),
			"campaign_id": cstr(campaign_id or ""),
			"ad_id": cstr(ad_id or ""),
			"form_id": cstr(form_id or ""),
			"external_lead_id": external_lead_id or doc.name,
			"hec_lead_id": doc.name,
			"notes": cstr(notes or ""),
			"raw_source_payload": raw_payload if isinstance(raw_payload, str) else json.dumps(raw_payload or {})[:4000],
			"assigned_to": "Unassigned",
		}
	)
	if rfms.get("lead_id"):
		frappe.db.set_value("Franchise Sales Lead", doc.name, "rfms_lead_id", rfms["lead_id"])
		frappe.db.commit()

	return {
		"action": action,
		"franchise_sales_lead": doc.name,
		"external_lead_id": external_lead_id or doc.name,
		"rfms": rfms,
	}


def _push_lead_to_rfms(payload: dict[str, Any]) -> dict[str, Any]:
	base = get_rfms_api_base_url()
	secret = _franchise_ads_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
	if not base:
		return {"ok": False, "error": "rfms_api_base_url missing"}
	body = json.dumps({"leads": [payload]}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
	headers = {
		"Content-Type": "application/json",
		"Accept": "application/json",
	}
	if secret:
		headers["X-Franchise-Ads-Secret"] = secret
	req = Request(f"{base}/leads/ingest/ad", data=body, headers=headers, method="POST")
	try:
		with urlopen(req, timeout=25) as resp:
			text = resp.read().decode("utf-8", errors="replace")
			data = json.loads(text) if text else {}
			inner = data.get("data") if isinstance(data, dict) else {}
			lead = None
			if isinstance(inner, dict):
				leads = inner.get("leads") or []
				lead = leads[0] if leads else None
			return {
				"ok": True,
				"lead_id": (lead or {}).get("id") if isinstance(lead, dict) else "",
				"imported_count": (inner or {}).get("imported_count"),
				"updated_count": (inner or {}).get("updated_count"),
			}
	except HTTPError as exc:
		err = exc.read().decode("utf-8", errors="replace")[:500]
		frappe.log_error(title="phase86_rfms_push", message=err)
		return {"ok": False, "error": err}
	except URLError as exc:
		frappe.log_error(title="phase86_rfms_push", message=str(exc))
		return {"ok": False, "error": str(exc)}


@frappe.whitelist(allow_guest=True)
def franchise_ads_status():
	"""Lightweight status for RFMS Connected sources strip (no secrets)."""
	frappe.flags.ignore_csrf = True
	_check_webhook_secret()
	return _success(
		{
			"webhook_configured": bool(_franchise_ads_secret()),
			"meta_token_configured": meta_ads_configured(),
			"rfms_api_base_url": get_rfms_api_base_url(),
			"page_allowlist_count": len(get_franchise_ads_page_allowlist()),
			"checked_at": str(now_datetime()),
		}
	)
