"""Phase 80 — Franchisee e-Aadhaar / e-agreement onboarding bridge.

Creates signed one-time session URLs for the onboarding container and ingests
completion callbacks (signed PDF + Aadhaar ref) onto Franchisee Profile.

Secrets (site_config.json):
  onboard_hmac_secret: shared HMAC secret with the onboarding app
  onboard_base_url:    https://onboard.e-remedium.in  (optional)

Run:
  bench --site health.localhost execute \\
    health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge.setup_phase80
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import frappe
from frappe.utils import cint, cstr, now_datetime

CUSTOM_FIELDS = (
    {
        "dt": "Franchisee Profile",
        "fieldname": "section_onboarding",
        "label": "E-Onboarding",
        "fieldtype": "Section Break",
        "insert_after": "primary_sample_manual_ref",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "onboarding_status",
        "label": "Onboarding Status",
        "fieldtype": "Select",
        "options": "Not Started\nIn Progress\nAadhaar Verified\nAgreement Signed\nCompleted\nFailed",
        "default": "Not Started",
        "insert_after": "section_onboarding",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "aadhaar_ref",
        "label": "Aadhaar Reference",
        "fieldtype": "Data",
        "insert_after": "onboarding_status",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "onboarding_session_id",
        "label": "Last Onboarding Session",
        "fieldtype": "Data",
        "read_only": 1,
        "insert_after": "aadhaar_ref",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "column_break_onb",
        "fieldtype": "Column Break",
        "insert_after": "onboarding_session_id",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "agreement_file",
        "label": "Signed Agreement",
        "fieldtype": "Attach",
        "insert_after": "column_break_onb",
    },
    {
        "dt": "Franchisee Profile",
        "fieldname": "onboarding_completed_on",
        "label": "Onboarding Completed On",
        "fieldtype": "Datetime",
        "read_only": 1,
        "insert_after": "agreement_file",
    },
)


def _conf(key: str, default: str = "") -> str:
    return cstr(frappe.conf.get(key) or default)


def _hmac_secret() -> str:
    secret = _conf("onboard_hmac_secret")
    if not secret:
        # Dev fallback — rotate in production via site_config.json
        secret = _conf("encryption_key") or "hec-onboard-dev-secret-change-me"
    return secret


def _onboard_base_url() -> str:
    return (_conf("onboard_base_url") or "https://onboard.e-remedium.in").rstrip("/")


def _sign(payload: str) -> str:
    return hmac.new(_hmac_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def ensure_onboarding_fields():
    for spec in CUSTOM_FIELDS:
        dt = spec["dt"]
        fieldname = spec["fieldname"]
        if frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname}):
            continue
        try:
            doc = frappe.get_doc(
                {
                    "doctype": "Custom Field",
                    "dt": dt,
                    "fieldname": fieldname,
                    "label": spec.get("label") or fieldname,
                    "fieldtype": spec["fieldtype"],
                    "insert_after": spec.get("insert_after"),
                    "options": spec.get("options"),
                    "default": spec.get("default"),
                    "read_only": cint(spec.get("read_only")),
                }
            )
            doc.insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(title="Phase 80 custom field", message=frappe.get_traceback())


def create_onboarding_token(
    franchisee_id: str,
    *,
    lead_id: str | None = None,
    ttl_seconds: int = 3600,
) -> dict[str, Any]:
    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        frappe.throw("Valid franchisee_id is required")

    fp = frappe.get_doc("Franchisee Profile", franchisee_id)
    now = int(time.time())
    session_id = frappe.generate_hash(length=16)
    claims = {
        "sid": session_id,
        "fp": franchisee_id,
        "lead": lead_id or "",
        "name": fp.owner_name or fp.franchise_name,
        "phone": fp.contact_phone or "",
        "email": fp.contact_email or "",
        "branch": fp.branch_code,
        "iat": now,
        "exp": now + int(ttl_seconds),
    }
    body = _b64url(json.dumps(claims, separators=(",", ":")).encode())
    sig = _sign(body)
    token = f"{body}.{sig}"

    if frappe.get_meta("Franchisee Profile").has_field("onboarding_status"):
        fp.onboarding_status = "In Progress"
        fp.onboarding_session_id = session_id
        fp.save(ignore_permissions=True)
        frappe.db.commit()

    url = f"{_onboard_base_url()}/hec-session?token={token}"
    return {
        "session_id": session_id,
        "token": token,
        "url": url,
        "expires_at": claims["exp"],
        "franchisee_id": franchisee_id,
    }


def verify_callback_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(_hmac_secret().encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


def decode_session_token(token: str) -> dict:
    try:
        body, sig = token.rsplit(".", 1)
    except ValueError:
        frappe.throw("Invalid token format")
    if not hmac.compare_digest(_sign(body), sig):
        frappe.throw("Invalid token signature")
    claims = json.loads(_b64url_decode(body))
    if int(claims.get("exp") or 0) < int(time.time()):
        frappe.throw("Token expired")
    return claims


def ingest_onboarding_result(
    *,
    franchisee_id: str,
    session_id: str = "",
    aadhaar_ref: str = "",
    status: str = "Completed",
    agreement_pdf_b64: str = "",
    agreement_filename: str = "signed-agreement.pdf",
    notes: str = "",
) -> dict:
    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        frappe.throw("franchisee_id not found")

    fp = frappe.get_doc("Franchisee Profile", franchisee_id)
    meta = frappe.get_meta("Franchisee Profile")

    file_url = ""
    if agreement_pdf_b64:
        raw = base64.b64decode(agreement_pdf_b64)
        fname = agreement_filename or f"agreement-{franchisee_id}.pdf"
        file_doc = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": fname,
                "content": raw,
                "is_private": 1,
                "attached_to_doctype": "Franchisee Profile",
                "attached_to_name": franchisee_id,
                "attached_to_field": "agreement_file" if meta.has_field("agreement_file") else None,
            }
        )
        file_doc.save(ignore_permissions=True)
        file_url = file_doc.file_url

    if meta.has_field("aadhaar_ref") and aadhaar_ref:
        fp.aadhaar_ref = aadhaar_ref
    if meta.has_field("agreement_file") and file_url:
        fp.agreement_file = file_url
    if meta.has_field("onboarding_session_id") and session_id:
        fp.onboarding_session_id = session_id
    if meta.has_field("onboarding_status"):
        allowed = {
            "Not Started",
            "In Progress",
            "Aadhaar Verified",
            "Agreement Signed",
            "Completed",
            "Failed",
        }
        fp.onboarding_status = status if status in allowed else "Completed"
    if meta.has_field("onboarding_completed_on") and fp.onboarding_status == "Completed":
        fp.onboarding_completed_on = now_datetime()
    if notes:
        fp.add_comment("Comment", text=f"Onboarding: {notes}")

    fp.save(ignore_permissions=True)
    frappe.db.commit()
    return {
        "ok": True,
        "franchisee_id": franchisee_id,
        "onboarding_status": getattr(fp, "onboarding_status", None),
        "agreement_file": file_url or getattr(fp, "agreement_file", None),
        "aadhaar_ref": getattr(fp, "aadhaar_ref", None),
    }


def setup_phase80():
    ensure_onboarding_fields()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 80,
        "onboard_base_url": _onboard_base_url(),
        "has_secret": bool(_conf("onboard_hmac_secret")),
        "fields": [c["fieldname"] for c in CUSTOM_FIELDS],
    }


def smoke_phase80():
    meta = frappe.get_meta("Franchisee Profile")
    return {
        "ok": meta.has_field("onboarding_status") and meta.has_field("agreement_file"),
        "onboarding_status": meta.has_field("onboarding_status"),
        "aadhaar_ref": meta.has_field("aadhaar_ref"),
        "agreement_file": meta.has_field("agreement_file"),
        "base_url": _onboard_base_url(),
    }


def mint_smoke_onboarding_url(franchisee_id: str | None = None) -> dict[str, Any]:
    """Ops helper: mint a HEC session URL for the first (or given) Franchisee Profile."""
    if not franchisee_id:
        names = frappe.get_all("Franchisee Profile", limit=1, pluck="name")
        franchisee_id = names[0] if names else ""
    if not franchisee_id:
        frappe.throw("No Franchisee Profile available for smoke mint")
    return create_onboarding_token(franchisee_id)


def read_onboarding_fields(franchisee_id: str) -> dict[str, Any]:
    fp = frappe.get_doc("Franchisee Profile", franchisee_id)
    return {
        "franchisee_id": franchisee_id,
        "onboarding_status": getattr(fp, "onboarding_status", None),
        "aadhaar_ref": getattr(fp, "aadhaar_ref", None),
        "agreement_file": getattr(fp, "agreement_file", None),
        "onboarding_session_id": getattr(fp, "onboarding_session_id", None),
    }
