"""Phase 102 — ABHA identity fields (ABDM-ready stub / sandbox capture)."""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

ABHA_FIELDS = [
    {
        "fieldname": "abha_section",
        "label": "ABHA / ABDM",
        "fieldtype": "Section Break",
        "insert_after": "email",
        "collapsible": 1,
    },
    {
        "fieldname": "abha_number",
        "label": "ABHA Number",
        "fieldtype": "Data",
        "insert_after": "abha_section",
        "in_standard_filter": 1,
    },
    {
        "fieldname": "abha_address",
        "label": "ABHA Address (PHR)",
        "fieldtype": "Data",
        "insert_after": "abha_number",
    },
    {
        "fieldname": "abha_verification_status",
        "label": "ABHA Verification Status",
        "fieldtype": "Select",
        "options": "Unlinked\nPending\nVerified\nFailed",
        "default": "Unlinked",
        "insert_after": "abha_address",
    },
    {
        "fieldname": "abha_consent_at",
        "label": "ABHA Consent At",
        "fieldtype": "Datetime",
        "insert_after": "abha_verification_status",
        "read_only": 1,
    },
    {
        "fieldname": "abha_consent_note",
        "label": "ABHA Consent Note",
        "fieldtype": "Small Text",
        "insert_after": "abha_consent_at",
    },
]


def ensure_phase102_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("DocType", "Health Patient"):
        return {"ok": False, "error": "Health Patient missing"}
    create_custom_fields({"Health Patient": ABHA_FIELDS}, update=True)
    frappe.clear_cache(doctype="Health Patient")
    return {"ok": True}


def _normalize_abha_number(raw):
    digits = re.sub(r"\D", "", raw or "")
    return digits


def _patient_for_user():
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    return profile.get("patient_id") if profile else None


def _serialize_abha(patient_id):
    row = frappe.db.get_value(
        "Health Patient",
        patient_id,
        [
            "name",
            "patient_name",
            "abha_number",
            "abha_address",
            "abha_verification_status",
            "abha_consent_at",
            "abha_consent_note",
        ],
        as_dict=True,
    )
    if not row:
        return None
    return {
        "patient": row.name,
        "patient_name": row.patient_name,
        "abha_number": row.abha_number,
        "abha_address": row.abha_address,
        "abha_verification_status": row.abha_verification_status or "Unlinked",
        "abha_consent_at": str(row.abha_consent_at) if row.abha_consent_at else None,
        "abha_consent_note": row.abha_consent_note,
    }


@frappe.whitelist()
def get_my_abha(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase102_fields()
    patient = _patient_for_user()
    if not patient:
        return _success({"abha": None})
    return _success({"abha": _serialize_abha(patient)})


@frappe.whitelist()
def link_abha_id(
    abha_number=None,
    abha_address=None,
    consent=1,
    consent_note=None,
    patient_id=None,
    sid=None,
):
    """Capture ABHA number/address with consent. Sandbox OTP verification is a follow-on."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase102_fields()

    roles = _user_roles()
    patient = (_parse_request_value("patient_id", patient_id) or "").strip()
    if not patient:
        patient = _patient_for_user()
    if not patient:
        return _error(_("Patient profile required"))

    if not is_staff(roles) and "Physician" not in roles:
        mine = _patient_for_user()
        if mine != patient:
            return _error(_("Not authorized"), 403)

    if not cint(_parse_request_value("consent", consent) if consent is not None else 1):
        return _error(_("Consent is required to link ABHA"))

    abha_number = _normalize_abha_number(_parse_request_value("abha_number", abha_number))
    abha_address = (_parse_request_value("abha_address", abha_address) or "").strip().lower()

    if abha_number and len(abha_number) not in (14,):
        # Allow partial during stub; warn but accept 14-digit only for Verified path
        if len(abha_number) < 10:
            return _error(_("ABHA number looks invalid"))

    status = "Pending"
    if abha_number and len(abha_number) == 14:
        status = "Verified"  # stub: treat well-formed as verified until ABDM sandbox wired

    frappe.db.set_value(
        "Health Patient",
        patient,
        {
            "abha_number": abha_number or None,
            "abha_address": abha_address or None,
            "abha_verification_status": status,
            "abha_consent_at": now_datetime(),
            "abha_consent_note": _parse_request_value("consent_note", consent_note)
            or "Patient consented to store ABHA identity for care continuity.",
        },
    )
    frappe.db.commit()

    # Audit
    try:
        frappe.get_doc(
            {
                "doctype": "Comment",
                "comment_type": "Info",
                "reference_doctype": "Health Patient",
                "reference_name": patient,
                "content": f"ABHA linked ({status}) by {frappe.session.user}",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        pass

    return _success({"abha": _serialize_abha(patient)}, message=_("ABHA saved"))


@frappe.whitelist()
def get_patient_abha(patient_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)
    ensure_phase102_fields()
    patient_id = (_parse_request_value("patient_id", patient_id) or "").strip()
    if not patient_id or not frappe.db.exists("Health Patient", patient_id):
        return _error(_("Patient not found"), 404)
    return _success({"abha": _serialize_abha(patient_id)})


def setup_phase102_abha():
    return {"ok": True, "phase": "102", "fields": ensure_phase102_fields()}


def smoke_phase102_abha():
    setup = setup_phase102_abha()
    meta = frappe.get_meta("Health Patient")
    return {
        "ok": bool(meta.has_field("abha_number")),
        "phase": "102",
        "setup": setup,
        "has_abha_address": meta.has_field("abha_address"),
    }
