"""Phase 48 — Provider e-prescriptions from consultations + patient order-to-pharmacy."""

from __future__ import annotations

import json

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


def ensure_phase48_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Clinical Prescription": [
                {
                    "fieldname": "doctor_appointment",
                    "label": "Doctor Appointment",
                    "fieldtype": "Link",
                    "options": "Doctor Appointment",
                    "insert_after": "care_journey",
                },
            ],
        },
        update=True,
    )


def _resolve_doctor_for_user(user=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase46_provider_portal import (
        resolve_doctor_for_user,
    )

    return resolve_doctor_for_user(user)


def _pharmacy_item_groups():
    from health_ecosystem_core.health_ecosystem_core.api import PHARMACY_ITEM_GROUPS

    return list(PHARMACY_ITEM_GROUPS)


@frappe.whitelist()
def search_prescription_medicines(q=None, limit=25, sid=None):
    """Autocomplete medicine items for the provider prescription form."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if "Physician" not in _user_roles() and not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)

    q = (_parse_request_value("q", q) or "").strip()
    filters = {"is_sales_item": 1, "disabled": 0, "item_group": ["in", _pharmacy_item_groups()]}
    or_filters = None
    if q:
        or_filters = [
            ["name", "like", f"%{q}%"],
            ["item_name", "like", f"%{q}%"],
            ["description", "like", f"%{q}%"],
        ]

    items = frappe.get_all(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_name", "standard_rate", "item_group"],
        order_by="item_name asc",
        limit=int(limit or 25),
    )
    return _success({"medicines": items})


def _serialize_prescription(name, include_lines=True):
    doc = frappe.get_doc("Clinical Prescription", name)
    data = {
        "name": doc.name,
        "patient": doc.patient,
        "patient_name": doc.patient_name,
        "doctor": doc.doctor,
        "department": doc.department,
        "status": doc.status,
        "diagnosis": doc.diagnosis,
        "clinical_notes": doc.clinical_notes,
        "encounter_date": str(doc.encounter_date),
        "care_journey": doc.care_journey,
        "doctor_appointment": getattr(doc, "doctor_appointment", None),
        "medicine_count": len(doc.medicines or []),
        "diagnostic_count": len(doc.diagnostics or []),
    }
    if include_lines:
        data["medicines"] = [
            {
                "medicine_item": row.medicine_item,
                "item_name": frappe.db.get_value("Item", row.medicine_item, "item_name"),
                "dosage": row.dosage,
                "duration": row.duration,
                "frequency": row.frequency,
                "instructions": row.instructions,
            }
            for row in (doc.medicines or [])
        ]
        data["diagnostics"] = [
            {
                "diagnostic_test": row.diagnostic_test,
                "test_name": frappe.db.get_value(
                    "Diagnostic Test Master", row.diagnostic_test, "test_name"
                )
                if row.diagnostic_test
                else None,
                "item": row.item,
                "item_name": frappe.db.get_value("Item", row.item, "item_name") if row.item else None,
                "notes": row.notes,
            }
            for row in (doc.diagnostics or [])
        ]
    return data


@frappe.whitelist()
def provider_issue_prescription(
    appointment_id=None,
    diagnosis=None,
    clinical_notes=None,
    medicines=None,
    diagnostics=None,
    submit=1,
    sid=None,
):
    """Provider/staff writes a prescription tied to a consultation appointment."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Only providers can write prescriptions"), 403)

    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)

    apt = frappe.get_doc("Doctor Appointment", appointment_id)

    # Providers may only prescribe for their own appointments; staff unrestricted.
    if not is_staff(roles):
        my_doctor = _resolve_doctor_for_user()
        if not my_doctor or apt.doctor != my_doctor:
            return _error(_("You can only prescribe for your own consultations"), 403)

    if not apt.patient:
        return _error(_("Appointment has no linked patient"))

    lines = medicines
    if isinstance(lines, str):
        try:
            lines = json.loads(lines)
        except Exception:
            lines = []
    lines = lines or []
    clean = []
    for row in lines:
        item = (row.get("medicine_item") or "").strip()
        if not item:
            continue
        clean.append(
            {
                "medicine_item": item,
                "dosage": row.get("dosage"),
                "duration": row.get("duration"),
                "frequency": row.get("frequency"),
                "instructions": row.get("instructions"),
            }
        )
    diag_lines = diagnostics
    if isinstance(diag_lines, str):
        try:
            diag_lines = json.loads(diag_lines)
        except Exception:
            diag_lines = []
    diag_lines = diag_lines or []
    clean_diag = []
    for row in diag_lines:
        test = (row.get("diagnostic_test") or "").strip()
        item = (row.get("item") or "").strip()
        if not test and not item:
            continue
        if test and not item:
            item = frappe.db.get_value("Diagnostic Test Master", test, "item") or ""
        clean_diag.append(
            {
                "diagnostic_test": test or None,
                "item": item or None,
                "notes": row.get("notes"),
            }
        )

    if not clean and not clean_diag:
        return _error(_("Add at least one medicine or diagnostic test"))

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import (
        advance_journey,
        ensure_journey_for_patient,
    )

    care_journey = apt.get("care_journey") if apt.get("care_journey") else None
    if not care_journey:
        care_journey = ensure_journey_for_patient(
            apt.patient, status="Doctor Consultation", appointment=apt.name
        )

    doc = frappe.get_doc(
        {
            "doctype": "Clinical Prescription",
            "patient": apt.patient,
            "doctor": apt.doctor,
            "department": apt.department,
            "diagnosis": _parse_request_value("diagnosis", diagnosis),
            "clinical_notes": _parse_request_value("clinical_notes", clinical_notes),
            "encounter_date": frappe.utils.today(),
            "status": "Submitted" if str(submit) in ("1", "true", "True") else "Draft",
            "care_journey": care_journey,
            "doctor_appointment": apt.name,
            "medicines": clean,
            "diagnostics": clean_diag,
        }
    )
    doc.insert(ignore_permissions=True)
    if care_journey:
        advance_journey(care_journey, "Prescription Issued", prescription=doc.name)
    frappe.db.commit()

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
            notify_prescription_issued,
        )

        notify_prescription_issued(doc.name)
    except Exception:
        pass

    return _success(
        {"prescription": _serialize_prescription(doc.name)},
        message=_("Prescription issued"),
    )


@frappe.whitelist()
def get_appointment_prescriptions(appointment_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)

    names = frappe.get_all(
        "Clinical Prescription",
        filters={"doctor_appointment": appointment_id},
        pluck="name",
        order_by="creation desc",
    )
    return _success({"prescriptions": [_serialize_prescription(n) for n in names]})


@frappe.whitelist()
def get_my_prescriptions(limit=50, sid=None):
    """Patient view — prescriptions with medicine counts for the web portal."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    patient = profile.get("patient_id") if profile else None
    if not patient:
        return _success({"prescriptions": []})

    names = frappe.get_all(
        "Clinical Prescription",
        filters={"patient": patient, "status": ["!=", "Cancelled"]},
        pluck="name",
        order_by="encounter_date desc, creation desc",
        limit=int(limit or 50),
    )
    return _success({"prescriptions": [_serialize_prescription(n) for n in names]})


def setup_phase48_eprescribe():
    ensure_phase48_fields()
    frappe.clear_cache(doctype="Clinical Prescription")
    return {"ok": True, "phase": "48", "feature": "e_prescriptions"}
