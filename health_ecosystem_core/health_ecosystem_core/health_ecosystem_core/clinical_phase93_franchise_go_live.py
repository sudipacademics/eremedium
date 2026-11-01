"""Phase 93 — Franchise go-live automations.

1) On franchisee onboard: schedule Meta + WhatsApp campaigns for
   Phlebotomist / Receptionist hiring and local blood-test booking.
2) On FOCO Phase-1 payment verified: create Reach B2B Collection Centre
   (FOCO code series B2BC-.#####).

RFMS calls the HMAC whitelisted API methods in api.py.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import add_days, cint, cstr, flt, getdate, now_datetime, today


HIRING_ROLES = ("Phlebotomist", "Receptionist")
BOOKING_ROLE = "Blood Test Booking"


def ensure_phase93():
	"""Custom fields + DocType option tweaks for go-live automation."""
	create_custom_fields(
		{
			"B2B Collection Centre": [
				{
					"fieldname": "section_ffms_foco",
					"fieldtype": "Section Break",
					"label": "FFMS / FOCO Link",
					"insert_after": "remarks",
					"collapsible": 1,
				},
				{
					"fieldname": "ffms_application_id",
					"fieldtype": "Data",
					"label": "FFMS Application Id",
					"insert_after": "section_ffms_foco",
					"read_only": 1,
				},
				{
					"fieldname": "ffms_application_number",
					"fieldtype": "Data",
					"label": "FFMS Application Number",
					"insert_after": "ffms_application_id",
					"read_only": 1,
				},
				{
					"fieldname": "franchise_model",
					"fieldtype": "Select",
					"label": "Franchise Model",
					"options": "\nFOCO\nFOFO",
					"insert_after": "ffms_application_number",
					"read_only": 1,
				},
				{
					"fieldname": "foco_phase1_created_at",
					"fieldtype": "Datetime",
					"label": "FOCO Code Created At (Phase 1)",
					"insert_after": "franchise_model",
					"read_only": 1,
				},
			],
			"HEC Hiring Campaign": [
				{
					"fieldname": "franchisee_profile",
					"fieldtype": "Link",
					"label": "Franchisee Profile",
					"options": "Franchisee Profile",
					"insert_after": "notes",
				},
				{
					"fieldname": "ffms_application_id",
					"fieldtype": "Data",
					"label": "FFMS Application Id",
					"insert_after": "franchisee_profile",
				},
				{
					"fieldname": "target_area",
					"fieldtype": "Data",
					"label": "Target Area / Geo",
					"insert_after": "ffms_application_id",
				},
				{
					"fieldname": "target_pincode",
					"fieldtype": "Data",
					"label": "Target Pincode",
					"insert_after": "target_area",
				},
				{
					"fieldname": "landing_url",
					"fieldtype": "Data",
					"label": "Landing URL",
					"insert_after": "target_pincode",
				},
				{
					"fieldname": "scheduled_launch_on",
					"fieldtype": "Date",
					"label": "Scheduled Launch On",
					"insert_after": "landing_url",
				},
				{
					"fieldname": "whatsapp_outreach_status",
					"fieldtype": "Select",
					"label": "WhatsApp Outreach",
					"options": "\nPending\nQueued\nSent\nSkipped",
					"insert_after": "scheduled_launch_on",
				},
			],
		},
		update=True,
	)

	# Allow Scheduled status on hiring campaigns
	try:
		frappe.db.sql(
			"""
			UPDATE `tabDocField`
			SET options=%s
			WHERE parent=%s AND fieldname=%s
			""",
			("Scheduled\nActive\nPaused\nCompleted", "HEC Hiring Campaign", "status"),
		)
	except Exception:
		pass
	frappe.db.commit()
	return {"ok": True, "phase": 93}


def _graph_post(path: str, payload: dict[str, Any], *, under_ad_account: bool = False) -> dict[str, Any]:
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_meta_access_token,
		get_meta_ad_account_id,
		meta_ads_configured,
	)

	if not meta_ads_configured():
		return {"ok": False, "skipped": True, "reason": "meta_credentials_missing"}
	token = get_meta_access_token()
	account = (get_meta_ad_account_id() or "").strip().replace("act_", "")
	body = dict(payload)
	body["access_token"] = token
	path = cstr(path or "").lstrip("/")
	if under_ad_account:
		url = f"https://graph.facebook.com/v19.0/act_{account}/{path}"
	else:
		url = f"https://graph.facebook.com/v19.0/{path}"

	data = urlencode(body).encode("utf-8")
	req = Request(url, data=data, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
	try:
		with urlopen(req, timeout=30) as resp:
			raw = resp.read().decode("utf-8", errors="replace")
			parsed = json.loads(raw) if raw else {}
			return {"ok": True, "data": parsed}
	except HTTPError as exc:
		detail = exc.read().decode("utf-8", errors="replace")[:800]
		frappe.log_error(title="phase93_meta_graph", message=detail)
		return {"ok": False, "error": detail or str(exc)}
	except (URLError, TimeoutError, json.JSONDecodeError) as exc:
		frappe.log_error(title="phase93_meta_graph", message=frappe.get_traceback())
		return {"ok": False, "error": str(exc)}


def _create_meta_campaign(*, name: str, objective: str, special_ad_categories: list[str] | None = None) -> dict[str, Any]:
	"""Create a PAUSED Meta campaign (operator/creative attach later)."""
	payload = {
		"name": name[:200],
		"objective": objective,
		"status": "PAUSED",
		"special_ad_categories": json.dumps(special_ad_categories or []),
	}
	return _graph_post("campaigns", payload, under_ad_account=True)


def _upsert_local_campaign(
	*,
	campaign_name: str,
	job_role_label: str,
	platform: str = "Facebook Ads",
	status: str = "Scheduled",
	franchisee_profile: str = "",
	ffms_application_id: str = "",
	target_area: str = "",
	target_pincode: str = "",
	landing_url: str = "",
	scheduled_launch_on=None,
	external_campaign_id: str = "",
	notes: str = "",
) -> str:
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync import upsert_hiring_campaign

	name = upsert_hiring_campaign(
		campaign_name=campaign_name,
		platform=platform,
		external_campaign_id=external_campaign_id or None,
		status=status,
		job_role_label=job_role_label,
		from_date=scheduled_launch_on or today(),
		to_date=add_days(scheduled_launch_on or today(), 30),
		mark_from_ads=bool(external_campaign_id),
	)
	doc = frappe.get_doc("HEC Hiring Campaign", name)
	if franchisee_profile and hasattr(doc, "franchisee_profile"):
		doc.franchisee_profile = franchisee_profile
	if hasattr(doc, "ffms_application_id"):
		doc.ffms_application_id = ffms_application_id
	if hasattr(doc, "target_area"):
		doc.target_area = target_area
	if hasattr(doc, "target_pincode"):
		doc.target_pincode = target_pincode
	if hasattr(doc, "landing_url"):
		doc.landing_url = landing_url
	if hasattr(doc, "scheduled_launch_on"):
		doc.scheduled_launch_on = getdate(scheduled_launch_on or today())
	if hasattr(doc, "whatsapp_outreach_status") and not doc.whatsapp_outreach_status:
		doc.whatsapp_outreach_status = "Pending"
	if notes:
		doc.notes = ((doc.notes or "") + "\n" + notes).strip()
	doc.save(ignore_permissions=True)
	return doc.name


def _queue_whatsapp_franchisee_notify(*, mobile: str, message: str, context: str) -> dict[str, Any]:
	mobile = cstr(mobile or "").strip()
	if not mobile:
		return {"ok": False, "skipped": True, "reason": "no_mobile"}
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		result = send_whatsapp(mobile, message, context={"kind": "phase93_franchise_campaign", "context": context})
		return {"ok": True, "result": result}
	except Exception:
		frappe.log_error(title="phase93_whatsapp", message=frappe.get_traceback())
		return {"ok": False, "error": "whatsapp_send_failed"}


def canonical_schedule_campaigns_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "schedule_franchise_onboard_campaigns",
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"business_name": cstr(payload.get("business_name") or ""),
		"district": cstr(payload.get("district") or ""),
		"franchisee_id": cstr(payload.get("franchisee_id") or ""),
		"franchisee_profile": cstr(payload.get("franchisee_profile") or ""),
		"full_name": cstr(payload.get("full_name") or ""),
		"landing_url": cstr(payload.get("landing_url") or ""),
		"mobile": cstr(payload.get("mobile") or ""),
		"pincode": cstr(payload.get("pincode") or ""),
		"preferred_location": cstr(payload.get("preferred_location") or ""),
		"territory_region": cstr(payload.get("territory_region") or ""),
		"webpage_url": cstr(payload.get("webpage_url") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def canonical_phase1_foco_b2b_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "create_reach_foco_b2b_on_phase1",
		"application_fee_amount": cstr(payload.get("application_fee_amount") or "10000"),
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"business_name": cstr(payload.get("business_name") or ""),
		"centre_name": cstr(payload.get("centre_name") or ""),
		"created_by_reach_user": cstr(payload.get("created_by_reach_user") or ""),
		"franchise_model": cstr(payload.get("franchise_model") or "").upper(),
		"full_name": cstr(payload.get("full_name") or ""),
		"google_map_location": cstr(payload.get("google_map_location") or ""),
		"mobile": cstr(payload.get("mobile") or ""),
		"preferred_location": cstr(payload.get("preferred_location") or ""),
		"reach_user": cstr(payload.get("reach_user") or ""),
		"registered_address": cstr(payload.get("registered_address") or ""),
		"sales_rep_id": cstr(payload.get("sales_rep_id") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def schedule_franchise_onboard_campaigns_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	"""HMAC entry: schedule hiring + local booking campaigns after franchisee onboard."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
		verify_rfms_bridge_signature,
	)

	canonical = canonical_schedule_campaigns_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	ensure_phase93()

	application_id = cstr(payload.get("application_id") or "").strip()
	application_number = cstr(payload.get("application_number") or "").strip()
	franchisee_id = cstr(payload.get("franchisee_id") or "").strip()  # RFMS ####/FOCO/...
	franchisee_profile = cstr(payload.get("franchisee_profile") or "").strip()
	business_name = cstr(payload.get("business_name") or payload.get("full_name") or "Franchise").strip()
	district = cstr(payload.get("district") or "").strip()
	pincode = cstr(payload.get("pincode") or "").strip()
	preferred_location = cstr(payload.get("preferred_location") or "").strip()
	territory = cstr(payload.get("territory_region") or preferred_location or district).strip()
	mobile = cstr(payload.get("mobile") or "").strip()
	landing_url = cstr(payload.get("landing_url") or payload.get("webpage_url") or "https://www.e-remedium.in").strip()
	launch_on = getdate(payload.get("launch_on") or today())
	area_label = territory or district or pincode or "Local"

	# Idempotency: already scheduled for this application
	existing = []
	if application_id and frappe.db.exists("DocType", "HEC Hiring Campaign"):
		existing = frappe.get_all(
			"HEC Hiring Campaign",
			filters={"ffms_application_id": application_id},
			pluck="name",
		)
	if existing:
		return {
			"ok": True,
			"idempotent": True,
			"campaigns": existing,
			"application_id": application_id,
			"message": "Campaigns already scheduled for this application",
		}

	created = []
	meta_results = []

	for role in HIRING_ROLES:
		cname = f"Hiring - {role} · {area_label} · {application_number or franchisee_id or application_id}"
		meta = _create_meta_campaign(
			name=cname,
			objective="OUTCOME_LEADS",
			special_ad_categories=["EMPLOYMENT"],
		)
		meta_results.append({"role": role, "meta": meta})
		ext_id = ""
		if meta.get("ok"):
			ext_id = cstr((meta.get("data") or {}).get("id") or "")
		docname = _upsert_local_campaign(
			campaign_name=cname[:140],
			job_role_label=role,
			status="Scheduled",
			franchisee_profile=franchisee_profile,
			ffms_application_id=application_id,
			target_area=area_label,
			target_pincode=pincode,
			landing_url=landing_url,
			scheduled_launch_on=launch_on,
			external_campaign_id=ext_id,
			notes=(
				f"Auto-scheduled on franchisee onboard. "
				f"Franchisee ID {franchisee_id or '-'}; hub {franchisee_profile or '-'}; "
				f"business {business_name}."
			),
		)
		created.append({"role": role, "campaign": docname, "kind": "hiring", "meta_campaign_id": ext_id})

	# Local blood-test booking campaign (patient acquisition in FOCO area)
	booking_name = f"Booking - Blood Tests · {area_label} · {application_number or franchisee_id or application_id}"
	meta_book = _create_meta_campaign(
		name=booking_name,
		objective="OUTCOME_TRAFFIC",
		special_ad_categories=[],
	)
	meta_results.append({"role": BOOKING_ROLE, "meta": meta_book})
	ext_book = ""
	if meta_book.get("ok"):
		ext_book = cstr((meta_book.get("data") or {}).get("id") or "")
	booking_doc = _upsert_local_campaign(
		campaign_name=booking_name[:140],
		job_role_label=BOOKING_ROLE,
		platform="Facebook Ads",
		status="Scheduled",
		franchisee_profile=franchisee_profile,
		ffms_application_id=application_id,
		target_area=area_label,
		target_pincode=pincode,
		landing_url=landing_url,
		scheduled_launch_on=launch_on,
		external_campaign_id=ext_book,
		notes=(
			f"Local blood-test booking campaign for FOCO catchment ({area_label} / PIN {pincode or '-'}). "
			f"Landing: {landing_url}"
		),
	)
	created.append(
		{"role": BOOKING_ROLE, "campaign": booking_doc, "kind": "booking", "meta_campaign_id": ext_book}
	)

	# WhatsApp: notify franchisee that local campaigns are scheduled + careers/booking copy
	wa_msg = (
		f"Remedium Lab: Welcome! Your franchise at {area_label} is onboarded. "
		f"We have scheduled Meta campaigns for Phlebotomist & Receptionist hiring "
		f"and local blood-test booking. Landing: {landing_url}"
	)
	wa = _queue_whatsapp_franchisee_notify(mobile=mobile, message=wa_msg, context=application_id or franchisee_id)
	for row in created:
		try:
			doc = frappe.get_doc("HEC Hiring Campaign", row["campaign"])
			if hasattr(doc, "whatsapp_outreach_status"):
				doc.whatsapp_outreach_status = "Sent" if wa.get("ok") else ("Skipped" if wa.get("skipped") else "Pending")
				doc.save(ignore_permissions=True)
		except Exception:
			pass

	frappe.db.commit()
	return {
		"ok": True,
		"application_id": application_id,
		"application_number": application_number,
		"franchisee_id": franchisee_id,
		"area": area_label,
		"launch_on": str(launch_on),
		"campaigns": created,
		"meta": meta_results,
		"whatsapp": wa,
	}


def create_reach_foco_b2b_on_phase1_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	"""HMAC entry: mint Reach B2B Collection Centre (FOCO code) after Phase-1 payment."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
		verify_rfms_bridge_signature,
	)

	canonical = canonical_phase1_foco_b2b_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)

	ensure_phase93()
	if not frappe.db.exists("DocType", "B2B Collection Centre"):
		frappe.throw(_("B2B Collection Centre DocType is not installed"))

	application_id = cstr(payload.get("application_id") or "").strip()
	application_number = cstr(payload.get("application_number") or "").strip()
	if not application_id and not application_number:
		frappe.throw(_("application_id or application_number is required"))

	# Idempotent lookup
	existing_name = None
	if application_id and frappe.get_meta("B2B Collection Centre").has_field("ffms_application_id"):
		existing_name = frappe.db.get_value(
			"B2B Collection Centre", {"ffms_application_id": application_id}, "name"
		)
	if not existing_name and application_number:
		existing_name = frappe.db.get_value(
			"B2B Collection Centre",
			{"remarks": ("like", f"%FFMS:{application_number}%")},
			"name",
		)
	if existing_name:
		doc = frappe.get_doc("B2B Collection Centre", existing_name)
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import centre_row

		return {
			"ok": True,
			"idempotent": True,
			"foco_code": doc.name,
			"centre": centre_row(doc),
			"message": "FOCO B2B code already exists for this Phase-1 payment",
		}

	business_name = cstr(payload.get("business_name") or payload.get("full_name") or "FOCO Centre").strip()
	centre_name = cstr(payload.get("centre_name") or "").strip() or f"FOCO · {business_name}"[:140]
	mobile = cstr(payload.get("mobile") or "").strip()
	address = cstr(payload.get("registered_address") or payload.get("preferred_location") or "").strip()
	map_loc = cstr(payload.get("google_map_location") or "").strip()
	reach_user = cstr(payload.get("reach_user") or payload.get("created_by_reach_user") or "Administrator").strip()
	sales_rep = cstr(payload.get("sales_rep_id") or "").strip()
	franchise_model = cstr(payload.get("franchise_model") or "FOCO").strip().upper() or "FOCO"

	doc = frappe.get_doc(
		{
			"doctype": "B2B Collection Centre",
			"naming_series": "B2BC-.#####",
			"centre_name": centre_name,
			"status": "Draft",
			"wallet_amount": 0,
			"total_deposit": flt(payload.get("application_fee_amount") or 10000),
			"contact_number": mobile[:40],
			"manual_address": address[:1000],
			"google_map_location": map_loc[:500],
			"created_by_reach_user": reach_user[:140],
			"remarks": (
				f"Auto-created on FOCO Phase-1 payment. FFMS:{application_number or application_id}. "
				f"Model {franchise_model}. Sales rep {sales_rep or '-'}."
			)[:1000],
		}
	)
	if frappe.get_meta("B2B Collection Centre").has_field("ffms_application_id"):
		doc.ffms_application_id = application_id
	if frappe.get_meta("B2B Collection Centre").has_field("ffms_application_number"):
		doc.ffms_application_number = application_number
	if frappe.get_meta("B2B Collection Centre").has_field("franchise_model"):
		doc.franchise_model = franchise_model if franchise_model in ("FOCO", "FOFO") else "FOCO"
	if frappe.get_meta("B2B Collection Centre").has_field("foco_phase1_created_at"):
		doc.foco_phase1_created_at = now_datetime()

	doc.insert(ignore_permissions=True)

	# Sync to RFMS B2B centres store (best effort)
	rfms = {"ok": False}
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import _sync_centre_to_rfms

		rfms = _sync_centre_to_rfms(doc) or {"ok": False}
		if rfms.get("ok") and isinstance(rfms.get("data"), dict):
			centre_id = cstr((rfms["data"].get("centre") or {}).get("id") or rfms["data"].get("id") or "")
			if centre_id:
				doc.db_set("rfms_centre_id", centre_id, update_modified=False)
	except Exception:
		frappe.log_error(title="phase93_b2b_rfms_sync", message=frappe.get_traceback())

	frappe.db.commit()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import centre_row

	return {
		"ok": True,
		"foco_code": doc.name,
		"centre": centre_row(doc.reload()),
		"rfms": rfms,
		"application_id": application_id,
		"application_number": application_number,
	}


def activate_due_scheduled_campaigns(limit=40):
	"""Daily: flip Scheduled → Active on launch date; attempt Meta status ACTIVE if linked."""
	if not frappe.db.exists("DocType", "HEC Hiring Campaign"):
		return {"ok": True, "activated": []}
	ensure_phase93()
	names = frappe.get_all(
		"HEC Hiring Campaign",
		filters={"status": "Scheduled", "scheduled_launch_on": ("<=", today())},
		pluck="name",
		limit=cint(limit) or 40,
	)
	activated = []
	for name in names:
		doc = frappe.get_doc("HEC Hiring Campaign", name)
		doc.status = "Active"
		if doc.external_campaign_id:
			meta = _graph_post(doc.external_campaign_id, {"status": "ACTIVE"}, under_ad_account=False)
			if not meta.get("ok"):
				# keep Active in ERP; Meta may need manual enable
				doc.notes = ((doc.notes or "") + f"\nMeta activate: {meta.get('error') or meta}").strip()[:2000]
		doc.save(ignore_permissions=True)
		activated.append(name)
	frappe.db.commit()
	return {"ok": True, "activated": activated}


def run_daily_franchise_campaign_launches():
	return activate_due_scheduled_campaigns()
