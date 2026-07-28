"""Phase 80 — Franchisee e-Aadhaar / e-agreement onboarding bridge (FFMS ↔ Reach).

Creates signed one-time session URLs for the FFMS applicant portal and ingests
completion callbacks (signed PDF + Aadhaar ref) onto Franchisee Profile.

Secrets (site_config.json):
  onboard_hmac_secret: shared HMAC secret with RFMS ONBOARD_HMAC_SECRET
  onboard_base_url: https://www.e-remedium.in/onboard
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import frappe
from frappe import _
from frappe.installer import update_site_config
from frappe.utils import cint, cstr, now_datetime


DEFAULT_ONBOARD_BASE_URL = "https://www.e-remedium.in/onboard"
DEFAULT_TTL_SECONDS = 7 * 24 * 3600
CANONICAL_KEYS = (
	"franchisee_id",
	"session_id",
	"aadhaar_ref",
	"status",
	"agreement_pdf_b64",
	"agreement_filename",
	"notes",
)


def _b64url_encode(raw: bytes) -> str:
	return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _hmac_secret() -> str:
	secret = cstr(frappe.conf.get("onboard_hmac_secret") or "").strip()
	if not secret:
		frappe.throw(_("onboard_hmac_secret is not configured in site_config.json"))
	return secret


def _onboard_base_url() -> str:
	return cstr(frappe.conf.get("onboard_base_url") or DEFAULT_ONBOARD_BASE_URL).rstrip("/")


def ensure_phase80_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"Franchisee Profile": [
				{
					"fieldname": "section_e_onboarding",
					"label": "E-Onboarding (FFMS)",
					"fieldtype": "Section Break",
					"collapsible": 1,
					"insert_after": "primary_sample_manual_ref",
				},
				{
					"fieldname": "e_agreement_status",
					"label": "E-Agreement Status",
					"fieldtype": "Select",
					"options": "\nPending\nIn Progress\nCompleted\nFailed",
					"default": "Pending",
					"insert_after": "section_e_onboarding",
				},
				{
					"fieldname": "onboarding_session_id",
					"label": "Onboarding Session Id",
					"fieldtype": "Data",
					"read_only": 1,
					"insert_after": "e_agreement_status",
				},
				{
					"fieldname": "aadhaar_ref",
					"label": "Aadhaar Reference",
					"fieldtype": "Data",
					"insert_after": "onboarding_session_id",
				},
				{
					"fieldname": "e_agreement_completed_at",
					"label": "E-Agreement Completed At",
					"fieldtype": "Datetime",
					"read_only": 1,
					"insert_after": "aadhaar_ref",
				},
				{
					"fieldname": "e_agreement_notes",
					"label": "E-Agreement Notes",
					"fieldtype": "Small Text",
					"insert_after": "e_agreement_completed_at",
				},
				{
					"fieldname": "e_agreement_file",
					"label": "Signed Agreement",
					"fieldtype": "Attach",
					"insert_after": "e_agreement_notes",
				},
			]
		},
		update=True,
	)


def setup_phase80(secret: str | None = None, base_url: str | None = None):
	"""Persist HMAC secret + base URL and ensure Franchisee Profile fields."""
	ensure_phase80_custom_fields()
	updates: dict[str, Any] = {}
	if secret:
		updates["onboard_hmac_secret"] = cstr(secret).strip()
	elif not cstr(frappe.conf.get("onboard_hmac_secret") or "").strip():
		updates["onboard_hmac_secret"] = "hec-onboard-dev-secret-change-me"
	desired_base = cstr(base_url or "").rstrip("/") or DEFAULT_ONBOARD_BASE_URL
	current_base = cstr(frappe.conf.get("onboard_base_url") or "").rstrip("/")
	if base_url or not current_base or "localhost" in current_base or "8090" in current_base:
		updates["onboard_base_url"] = desired_base
	if updates:
		for key, value in updates.items():
			update_site_config(key, value, validate=False)
			frappe.conf[key] = value
	# Keep sales catalog franchise link on live FFMS paths when still pointing at WordPress.
	try:
		if frappe.db.exists("DocType", "Health Ecosystem Settings"):
			settings = frappe.get_single("Health Ecosystem Settings")
			changed = False
			if hasattr(settings, "franchise_portal_url"):
				current = cstr(getattr(settings, "franchise_portal_url", "") or "")
				if (not current) or ("lab.remediumhealth.co.in" in current) or ("wordpress" in current.lower()):
					settings.franchise_portal_url = "https://www.e-remedium.in/franchise/"
					changed = True
			if hasattr(settings, "company_public_site_url"):
				current = cstr(getattr(settings, "company_public_site_url", "") or "")
				if (not current) or ("lab.remediumhealth.co.in" in current):
					settings.company_public_site_url = "https://www.e-remedium.in/"
					changed = True
			if changed:
				settings.save(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="phase80_catalog_urls", message=frappe.get_traceback())
	frappe.db.commit()
	frappe.clear_cache()
	return {
		"ok": True,
		"phase": "80",
		"onboard_base_url": _onboard_base_url(),
		"secret_configured": bool(cstr(frappe.conf.get("onboard_hmac_secret") or "").strip()),
	}


def mint_onboarding_token(
	*,
	franchisee_id: str,
	lead_id: str = "",
	ttl_seconds: int | None = None,
	session_id: str | None = None,
) -> dict[str, Any]:
	franchisee_id = cstr(franchisee_id).strip()
	if not franchisee_id:
		frappe.throw(_("franchisee_id is required"))
	if not frappe.db.exists("Franchisee Profile", franchisee_id):
		frappe.throw(_("Franchisee Profile {0} not found").format(franchisee_id))

	doc = frappe.get_doc("Franchisee Profile", franchisee_id)
	ttl = cint(ttl_seconds) if ttl_seconds is not None else DEFAULT_TTL_SECONDS
	ttl = max(300, min(ttl, 30 * 24 * 3600))
	sid = cstr(session_id or "").strip() or str(uuid.uuid4())
	exp = int(time.time()) + ttl
	claims = {
		"fp": franchisee_id,
		"sid": sid,
		"lead": cstr(lead_id or "").strip(),
		"phone": cstr(getattr(doc, "contact_phone", "") or ""),
		"email": cstr(getattr(doc, "contact_email", "") or ""),
		"name": cstr(getattr(doc, "owner_name", "") or getattr(doc, "franchise_name", "") or franchisee_id),
		"branch": cstr(getattr(doc, "branch_code", "") or franchisee_id),
		"exp": exp,
	}
	body = _b64url_encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8"))
	sig = hmac.new(_hmac_secret().encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
	token = f"{body}.{sig}"
	url = f"{_onboard_base_url()}/hec-session?token={token}"

	meta = frappe.get_meta("Franchisee Profile")
	updates = {}
	if meta.has_field("onboarding_session_id"):
		updates["onboarding_session_id"] = sid
	if meta.has_field("e_agreement_status"):
		current = cstr(getattr(doc, "e_agreement_status", "") or "")
		if current in ("", "Pending", "Failed"):
			updates["e_agreement_status"] = "In Progress"
	if updates:
		frappe.db.set_value("Franchisee Profile", franchisee_id, updates, update_modified=True)
		frappe.db.commit()

	return {
		"session_id": sid,
		"token": token,
		"url": url,
		"expires_at": exp,
		"franchisee_id": franchisee_id,
	}


def canonical_onboarding_payload(payload: dict[str, Any]) -> str:
	"""Must match apps_external/ffms/.../hec-frappe-bridge.mjs canonicalOnboardingPayload."""
	ordered = {
		"franchisee_id": cstr(payload.get("franchisee_id") or ""),
		"session_id": cstr(payload.get("session_id") or ""),
		"aadhaar_ref": cstr(payload.get("aadhaar_ref") or ""),
		"status": cstr(payload.get("status") or "Completed"),
		"agreement_pdf_b64": cstr(payload.get("agreement_pdf_b64") or ""),
		"agreement_filename": cstr(payload.get("agreement_filename") or "signed-agreement.pdf"),
		"notes": cstr(payload.get("notes") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"))


def _parse_ingest_payload(hec_payload=None, **kwargs) -> dict[str, Any]:
	raw = hec_payload
	if raw is None:
		raw = frappe.form_dict.get("hec_payload")
	if isinstance(raw, (bytes, bytearray)):
		raw = raw.decode("utf-8", errors="replace")
	if isinstance(raw, str) and raw.strip():
		try:
			parsed = json.loads(raw)
			if isinstance(parsed, dict):
				return parsed
		except Exception:
			frappe.throw(_("hec_payload must be canonical JSON"))
	# Fallback: individual form fields (tests / older clients)
	return {key: kwargs.get(key, frappe.form_dict.get(key)) for key in CANONICAL_KEYS}


def verify_onboard_signature(canonical: str, signature: str | None = None) -> None:
	signature = cstr(signature or frappe.get_request_header("X-Onboard-Signature") or "").strip()
	if not signature:
		frappe.throw(_("Missing X-Onboard-Signature"), frappe.AuthenticationError)
	expected = hmac.new(_hmac_secret().encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
	if not hmac.compare_digest(expected, signature):
		frappe.throw(_("Invalid onboarding signature"), frappe.AuthenticationError)


def _attach_agreement_pdf(franchisee_id: str, pdf_b64: str, filename: str) -> str:
	pdf_b64 = cstr(pdf_b64 or "").strip()
	if not pdf_b64:
		return ""
	try:
		content = base64.b64decode(pdf_b64, validate=False)
	except Exception:
		frappe.throw(_("agreement_pdf_b64 is not valid base64"))
	if not content:
		return ""
	safe_name = cstr(filename or "signed-agreement.pdf").replace("/", "-").replace("\\", "-")
	if not safe_name.lower().endswith(".pdf"):
		safe_name = f"{safe_name}.pdf"
	try:
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"{franchisee_id}-{safe_name}",
				"attached_to_doctype": "Franchisee Profile",
				"attached_to_name": franchisee_id,
				"attached_to_field": "e_agreement_file",
				"is_private": 1,
				"content": content,
			}
		)
		file_doc.insert(ignore_permissions=True)
		return file_doc.file_url or ""
	except Exception:
		# Keep status ingest successful even if PDF bytes fail Frappe PDF validation.
		frappe.log_error(title="phase80_attach_agreement", message=frappe.get_traceback())
		return ""


def ingest_onboarding_result_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	canonical = canonical_onboarding_payload(payload)
	verify_onboard_signature(canonical, signature)

	franchisee_id = cstr(payload.get("franchisee_id") or "").strip()
	if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
		frappe.throw(_("Franchisee Profile {0} not found").format(franchisee_id or "(empty)"))

	status_raw = cstr(payload.get("status") or "Completed").strip()
	status_map = {
		"completed": "Completed",
		"complete": "Completed",
		"success": "Completed",
		"in_progress": "In Progress",
		"pending": "Pending",
		"failed": "Failed",
		"error": "Failed",
	}
	status = status_map.get(status_raw.lower(), status_raw if status_raw in ("Pending", "In Progress", "Completed", "Failed") else "Completed")

	ensure_phase80_custom_fields()
	meta = frappe.get_meta("Franchisee Profile")
	updates: dict[str, Any] = {}
	if meta.has_field("e_agreement_status"):
		updates["e_agreement_status"] = status
	if meta.has_field("onboarding_session_id") and payload.get("session_id"):
		updates["onboarding_session_id"] = cstr(payload.get("session_id"))
	if meta.has_field("aadhaar_ref") and payload.get("aadhaar_ref"):
		updates["aadhaar_ref"] = cstr(payload.get("aadhaar_ref"))
	if meta.has_field("e_agreement_notes") and payload.get("notes") is not None:
		updates["e_agreement_notes"] = cstr(payload.get("notes"))
	if status == "Completed" and meta.has_field("e_agreement_completed_at"):
		updates["e_agreement_completed_at"] = now_datetime()

	file_url = ""
	if meta.has_field("e_agreement_file") and payload.get("agreement_pdf_b64"):
		file_url = _attach_agreement_pdf(
			franchisee_id,
			cstr(payload.get("agreement_pdf_b64")),
			cstr(payload.get("agreement_filename") or "signed-agreement.pdf"),
		)
		if file_url:
			updates["e_agreement_file"] = file_url

	if updates:
		frappe.db.set_value("Franchisee Profile", franchisee_id, updates, update_modified=True)
	frappe.db.commit()
	return {
		"franchisee_id": franchisee_id,
		"status": status,
		"session_id": cstr(payload.get("session_id") or ""),
		"aadhaar_ref": cstr(payload.get("aadhaar_ref") or ""),
		"agreement_file": file_url,
	}


def smoke_phase80(franchisee_id: str | None = None) -> dict[str, Any]:
	"""Local mint + ingest round-trip without FFMS."""
	ensure_phase80_custom_fields()
	franchisee_id = cstr(franchisee_id or "").strip()
	if not franchisee_id:
		franchisee_id = frappe.db.get_value("Franchisee Profile", {}, "name", order_by="modified desc")
	if not franchisee_id:
		frappe.throw(_("No Franchisee Profile available for Phase 80 smoke"))
	minted = mint_onboarding_token(franchisee_id=franchisee_id, ttl_seconds=600)
	payload = {
		"franchisee_id": franchisee_id,
		"session_id": minted["session_id"],
		"aadhaar_ref": "SMOKE-AADHAAR-REF",
		"status": "Completed",
		"agreement_pdf_b64": "",
		"agreement_filename": "smoke-agreement.pdf",
		"notes": "Phase 80 smoke ingest",
	}
	canonical = canonical_onboarding_payload(payload)
	signature = hmac.new(_hmac_secret().encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
	result = ingest_onboarding_result_payload(payload, signature=signature)
	return {"ok": True, "minted": {k: minted[k] for k in ("session_id", "url", "expires_at", "franchisee_id")}, "ingest": result}
