"""Phase 105 — ABDM foundation: settings, txn log, OTP stub, DHIS claim pack.

Wave A scaffolding. Real NHA gateway calls activate only when credentials exist.
"""

from __future__ import annotations

import json
import random
import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

SETTINGS_DT = "ABDM Integration Settings"
TXN_DT = "ABDM Transaction Log"
OTP_CACHE_PREFIX = "hec:abdm:otp:"


def _ensure_doctype(name, fields, autoname="hash", is_single=0, permissions=None):
    if frappe.db.exists("DocType", name):
        return False
    doc = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "issingle": cint(is_single),
            "autoname": None if is_single else autoname,
            "naming_rule": None if is_single else ("Expression" if str(autoname).startswith("format:") else "Random"),
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": fields,
            "permissions": permissions
            or [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Health System Admin",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "export": 1,
                    "report": 1,
                },
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.clear_cache(doctype=name)
    return True


def ensure_phase105_doctypes():
    created = []
    if _ensure_doctype(
        SETTINGS_DT,
        [
            {"fieldname": "enabled", "label": "Enabled", "fieldtype": "Check", "default": "0"},
            {
                "fieldname": "environment",
                "label": "Environment",
                "fieldtype": "Select",
                "options": "Sandbox\nProduction",
                "default": "Sandbox",
            },
            {"fieldname": "facility_id", "label": "HFR Facility ID", "fieldtype": "Data"},
            {"fieldname": "hip_id", "label": "HIP ID", "fieldtype": "Data"},
            {"fieldname": "client_id", "label": "Client ID", "fieldtype": "Data"},
            {
                "fieldname": "client_secret",
                "label": "Client Secret",
                "fieldtype": "Password",
            },
            {
                "fieldname": "otp_stub_mode",
                "label": "OTP Stub Mode (dev)",
                "fieldtype": "Check",
                "default": "1",
                "description": "When on (or credentials missing), OTP is logged/stubbed — not live NHA.",
            },
            {
                "fieldname": "certification_status",
                "label": "Certification Status",
                "fieldtype": "Select",
                "options": "Not Started\nSandbox\nMilestone 1\nMilestone 2\nProduction",
                "default": "Not Started",
            },
            {
                "fieldname": "marketing_claim_allowed",
                "label": "Allow Marketing ABDM Claim",
                "fieldtype": "Check",
                "default": "0",
            },
        ],
        is_single=1,
    ):
        created.append(SETTINGS_DT)

    if _ensure_doctype(
        TXN_DT,
        [
            {
                "fieldname": "txn_type",
                "label": "Type",
                "fieldtype": "Select",
                "options": "OTP Request\nOTP Verify\nABHA Link\nCare Context\nShare Record\nDHIS Pack\nOther",
                "reqd": 1,
                "in_list_view": 1,
            },
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Pending\nSuccess\nFailed\nStubbed",
                "default": "Pending",
                "in_list_view": 1,
            },
            {
                "fieldname": "patient",
                "label": "Patient",
                "fieldtype": "Link",
                "options": "Health Patient",
                "in_list_view": 1,
            },
            {"fieldname": "doctor", "label": "Doctor", "fieldtype": "Link", "options": "Doctor"},
            {"fieldname": "reference_doctype", "label": "Reference DocType", "fieldtype": "Data"},
            {"fieldname": "reference_name", "label": "Reference Name", "fieldtype": "Data"},
            {"fieldname": "environment", "label": "Environment", "fieldtype": "Data"},
            {"fieldname": "message", "label": "Message", "fieldtype": "Small Text"},
            {"fieldname": "payload_json", "label": "Payload JSON", "fieldtype": "Long Text"},
            {
                "fieldname": "txn_at",
                "label": "Timestamp",
                "fieldtype": "Datetime",
                "default": "Now",
                "in_list_view": 1,
            },
        ],
        autoname="format:HEC-ABDM-{YYYY}-{#####}",
    ):
        created.append(TXN_DT)

    # Ensure Phase 102 ABHA fields exist
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase102_abha import (
            ensure_phase102_fields,
        )

        ensure_phase102_fields()
    except Exception:
        pass

    return created


def _settings():
    ensure_phase105_doctypes()
    if not frappe.db.exists(SETTINGS_DT):
        return None
    return frappe.get_single(SETTINGS_DT)


def _log_txn(txn_type, status, patient=None, doctor=None, message=None, payload=None, ref_dt=None, ref_name=None):
    ensure_phase105_doctypes()
    s = _settings()
    doc = frappe.get_doc(
        {
            "doctype": TXN_DT,
            "txn_type": txn_type,
            "status": status,
            "patient": patient,
            "doctor": doctor,
            "message": (message or "")[:140],
            "payload_json": json.dumps(payload or {}),
            "environment": getattr(s, "environment", None) or "Sandbox",
            "reference_doctype": ref_dt,
            "reference_name": ref_name,
            "txn_at": now_datetime(),
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


def _patient_for_user():
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    return profile.get("patient_id") if profile else None


def _credentials_ready(s):
    if not s or not cint(s.enabled):
        return False
    if cint(getattr(s, "otp_stub_mode", 1)):
        return False
    secret = ""
    try:
        secret = s.get_password("client_secret", raise_exception=False) or ""
    except Exception:
        secret = ""
    return bool((s.client_id or "").strip() and secret.strip() and (s.hip_id or "").strip())


@frappe.whitelist()
def get_abdm_status(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    s = _settings()
    if not s:
        return _success(
            {
                "enabled": False,
                "environment": "Sandbox",
                "credentials_ready": False,
                "otp_stub_mode": True,
                "certification_status": "Not Started",
                "marketing_claim_allowed": False,
            }
        )
    return _success(
        {
            "enabled": cint(s.enabled),
            "environment": s.environment or "Sandbox",
            "facility_id": s.facility_id,
            "hip_id": s.hip_id,
            "credentials_ready": _credentials_ready(s),
            "otp_stub_mode": cint(s.otp_stub_mode) or not _credentials_ready(s),
            "certification_status": s.certification_status or "Not Started",
            "marketing_claim_allowed": cint(s.marketing_claim_allowed),
        }
    )


@frappe.whitelist()
def request_abha_otp(mobile=None, abha_number=None, sid=None):
    """Request ABHA OTP. Stubbed until NHA credentials configured."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase105_doctypes()
    s = _settings()
    patient = _patient_for_user()
    mobile = re.sub(r"\D", "", _parse_request_value("mobile", mobile) or "")
    abha_number = re.sub(r"\D", "", _parse_request_value("abha_number", abha_number) or "")

    if not mobile and patient:
        mobile = re.sub(r"\D", "", frappe.db.get_value("Health Patient", patient, "mobile") or "")

    if len(mobile) < 10 and len(abha_number) != 14:
        return _error(_("Provide mobile or 14-digit ABHA number"))

    stub = True if not s else (cint(s.otp_stub_mode) or not _credentials_ready(s))
    if stub:
        otp = "123456"
        key = f"{OTP_CACHE_PREFIX}{frappe.session.user}"
        frappe.cache().set_value(
            key,
            {"otp": otp, "mobile": mobile, "abha_number": abha_number, "patient": patient},
            expires_in_sec=600,
        )
        txn = _log_txn(
            "OTP Request",
            "Stubbed",
            patient=patient,
            message="Stub OTP issued (dev/sandbox). Live NHA not called.",
            payload={"mobile_suffix": mobile[-4:] if mobile else None},
        )
        return _success(
            {
                "stub": True,
                "txn": txn,
                "hint": "Use OTP 123456 in stub mode",
                "expires_in_sec": 600,
            },
            message=_("OTP sent (stub)"),
        )

    # Placeholder for live NHA call — log and fail closed until adapter implemented
    txn = _log_txn(
        "OTP Request",
        "Failed",
        patient=patient,
        message="Live NHA OTP adapter not wired — keep otp_stub_mode or implement gateway.",
    )
    return _error(_("Live ABDM OTP not configured yet (txn {0})").format(txn), 503)


@frappe.whitelist()
def verify_abha_otp(otp=None, abha_number=None, abha_address=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase105_doctypes()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase102_abha import (
        ensure_phase102_fields,
        link_abha_id,
    )

    ensure_phase102_fields()
    otp = (_parse_request_value("otp", otp) or "").strip()
    key = f"{OTP_CACHE_PREFIX}{frappe.session.user}"
    cached = frappe.cache().get_value(key) or {}
    expected = (cached.get("otp") or "").strip()
    if not otp or not expected or otp != expected:
        _log_txn("OTP Verify", "Failed", patient=cached.get("patient"), message="OTP mismatch")
        return _error(_("Invalid or expired OTP"))

    abha_number = (_parse_request_value("abha_number", abha_number) or cached.get("abha_number") or "").strip()
    abha_address = (_parse_request_value("abha_address", abha_address) or "").strip()
    if not abha_number:
        abha_number = "12345678901234"  # stub default only when missing

    res = link_abha_id(
        abha_number=abha_number,
        abha_address=abha_address or None,
        consent=1,
        consent_note="Verified via ABDM OTP flow (stub or live).",
    )
    frappe.cache().delete_value(key)
    _log_txn(
        "OTP Verify",
        "Success" if isinstance(res, dict) and res.get("status") == "success" else "Failed",
        patient=_patient_for_user(),
        message="ABHA linked after OTP",
        payload={"abha_number_len": len(re.sub(r"\D", "", abha_number))},
    )
    return res


@frappe.whitelist()
def build_dhis_claim_pack(month=None, year=None, sid=None):
    """Monthly pack of digital Rx / encounters eligible for DHIS-style reporting."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not is_staff(roles) and "Physician" not in roles:
        return _error(_("Not authorized"), 403)

    ensure_phase105_doctypes()
    y = cint(_parse_request_value("year", year) or getdate(today()).year)
    m = cint(_parse_request_value("month", month) or getdate(today()).month)
    start = getdate(f"{y}-{m:02d}-01")
    if m == 12:
        end = getdate(f"{y + 1}-01-01")
    else:
        end = getdate(f"{y}-{m + 1:02d}-01")

    rx_filters = {
        "status": "Submitted",
        "encounter_date": ["between", [start, getdate(end) - timedelta(days=1)]],
    }
    prescriptions = frappe.get_all(
        "Clinical Prescription",
        filters=rx_filters,
        fields=["name", "doctor", "patient", "encounter_date", "clinical_encounter"],
    )

    with_abha = 0
    rows = []
    for rx in prescriptions:
        abha_status = frappe.db.get_value("Health Patient", rx.patient, "abha_verification_status")
        verified = (abha_status or "") == "Verified"
        if verified:
            with_abha += 1
        rows.append(
            {
                "prescription": rx.name,
                "doctor": rx.doctor,
                "patient": rx.patient,
                "encounter_date": str(rx.encounter_date) if rx.encounter_date else None,
                "clinical_encounter": rx.clinical_encounter,
                "abha_verified": verified,
            }
        )

    enc_count = 0
    if frappe.db.exists("DocType", "Clinical Encounter"):
        enc_count = frappe.db.count(
            "Clinical Encounter",
            {
                "status": "Final",
                "creation": ["between", [str(start), str(getdate(end) - timedelta(days=1)) + " 23:59:59"]],
            },
        )

    pack = {
        "period": f"{y}-{m:02d}",
        "submitted_prescriptions": len(prescriptions),
        "abha_verified_prescriptions": with_abha,
        "final_encounters": enc_count,
        "rows": rows[:500],
        "disclaimer": (
            "Operational claim pack only. Filing under NHA DHIS requires certified facility "
            "and current circular rules — finance must validate before submission."
        ),
    }
    txn = _log_txn(
        "DHIS Pack",
        "Success",
        message=f"Pack {pack['period']}: rx={len(prescriptions)} abha={with_abha}",
        payload={"period": pack["period"], "rx": len(prescriptions), "abha": with_abha},
    )
    pack["txn"] = txn
    return _success({"pack": pack})


def setup_phase105_abdm():
    created = ensure_phase105_doctypes()
    if frappe.db.exists("DocType", SETTINGS_DT):
        s = frappe.get_single(SETTINGS_DT)
        if not s.environment:
            s.environment = "Sandbox"
        if s.otp_stub_mode is None:
            s.otp_stub_mode = 1
        s.save(ignore_permissions=True)
        frappe.db.commit()
    return {"ok": True, "phase": "105", "wave": "A", "created": created}


def smoke_phase105_abdm():
    setup = setup_phase105_abdm()
    status = get_abdm_status()
    pack = None
    frappe.set_user("Administrator")
    try:
        # staff path
        from health_ecosystem_core.health_ecosystem_core.clinical_iam import STAFF_ROLES  # noqa: F401

        pack = build_dhis_claim_pack()
    except Exception as exc:
        pack = {"status": "error", "message": str(exc)}
    return {
        "ok": True,
        "phase": "105",
        "setup": setup,
        "status": status.get("data") if isinstance(status, dict) else status,
        "dhis_pack_ok": isinstance(pack, dict) and pack.get("status") == "success",
        "txn_doctype": frappe.db.exists("DocType", TXN_DT),
    }
