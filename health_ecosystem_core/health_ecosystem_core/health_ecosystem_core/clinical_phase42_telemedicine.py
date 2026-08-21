"""Phase 42 — Online teleconsultation sessions and follow-ups."""

from __future__ import annotations

import hashlib

import frappe
from frappe import _
from frappe.utils import add_days, getdate, get_url, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.appointments import book_patient_appointment


def ensure_telemedicine_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Doctor Appointment": [
                {
                    "fieldname": "consultation_mode",
                    "label": "Consultation Mode",
                    "fieldtype": "Select",
                    "options": "In-person\nOnline",
                    "insert_after": "consultation_type",
                    "default": "In-person",
                    "in_list_view": 1,
                },
                {
                    "fieldname": "meeting_link",
                    "label": "Meeting Link",
                    "fieldtype": "Data",
                    "insert_after": "consultation_mode",
                    "read_only": 1,
                },
                {
                    "fieldname": "parent_appointment",
                    "label": "Parent Appointment",
                    "fieldtype": "Link",
                    "options": "Doctor Appointment",
                    "insert_after": "meeting_link",
                },
                {
                    "fieldname": "follow_up_date",
                    "label": "Follow-up Date",
                    "fieldtype": "Date",
                    "insert_after": "parent_appointment",
                },
                {
                    "fieldname": "follow_up_notes",
                    "label": "Follow-up Notes",
                    "fieldtype": "Small Text",
                    "insert_after": "follow_up_date",
                },
            ]
        },
        update=True,
    )


def _portal_base():
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_email import portal_base_url

        return (portal_base_url() or "").rstrip("/")
    except Exception:
        return ""


def _meeting_link(appointment_id):
    base = _portal_base() or get_url()
    token = hashlib.sha256(f"{appointment_id}-{frappe.local.site}".encode()).hexdigest()[:16]
    jitsi = f"https://meet.jit.si/HEC-{appointment_id}-{token}"
    return jitsi, f"{base}/teleconsult/join/{appointment_id}?t={token}"


def _serialize_tele_session(doc):
    link, portal_link = _meeting_link(doc.name)
    return {
        "appointment_id": doc.name,
        "patient_name": doc.patient_name,
        "doctor_name": doc.doctor_name,
        "appointment_date": str(doc.appointment_date),
        "appointment_time": str(doc.appointment_time or ""),
        "status": doc.status,
        "consultation_mode": getattr(doc, "consultation_mode", None) or "Online",
        "meeting_link": getattr(doc, "meeting_link", None) or link,
        "portal_join_url": portal_link,
        "follow_up_date": str(getattr(doc, "follow_up_date", "") or "") or None,
        "follow_up_notes": getattr(doc, "follow_up_notes", None),
        "parent_appointment": getattr(doc, "parent_appointment", None),
        "doctor": doc.doctor,
        "amount": doc.amount,
        "razorpay_payment_status": doc.razorpay_payment_status,
    }


@frappe.whitelist(allow_guest=True)
def book_teleconsult_appointment(
    patient_name=None,
    patient_phone=None,
    gender=None,
    practitioner=None,
    appointment_type=None,
    appointment_date=None,
    appointment_time=None,
    department=None,
    notes=None,
    payment_method=None,
    amount=None,
    sid=None,
):
    """Book an online consultation — sets mode Online and generates meeting link."""
    tele_type = appointment_type or frappe.db.get_value(
        "Consultation Type", {"consultation_type": ["like", "%Teleconsult%"]}, "name"
    )
    if not tele_type:
        tele_type = appointment_type

    result = book_patient_appointment(
        patient_name=patient_name,
        patient_phone=patient_phone,
        gender=gender,
        practitioner=practitioner,
        appointment_type=tele_type,
        appointment_date=appointment_date,
        appointment_time=appointment_time,
        department=department,
        notes=notes or "Teleconsultation booking",
        payment_method=payment_method or "Online",
        amount=amount,
        sid=sid,
    )
    if result.get("status") != "success":
        return result

    apt_id = (result.get("data") or {}).get("appointment_id")
    if apt_id and frappe.db.exists("Doctor Appointment", apt_id):
        link, _ = _meeting_link(apt_id)
        frappe.db.set_value(
            "Doctor Appointment",
            apt_id,
            {"consultation_mode": "Online", "meeting_link": link},
            update_modified=True,
        )
        frappe.db.commit()
        data = result.get("data") or {}
        data["meeting_link"] = link
        data["consultation_mode"] = "Online"
        result["data"] = data
    return result


@frappe.whitelist(allow_guest=True)
def get_teleconsult_session(appointment_id=None, sid=None, token=None):
    """Patient/staff session payload. Guest allowed when valid join token is presented."""
    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    token = (_parse_request_value("token", token) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)

    expected = hashlib.sha256(f"{appointment_id}-{frappe.local.site}".encode()).hexdigest()[:16]
    authed = False
    try:
        if _require_mobile_auth(sid):
            authed = True
    except Exception:
        authed = False
    if not authed and token != expected:
        return _error(_("Not authenticated"), 401)

    doc = frappe.get_doc("Doctor Appointment", appointment_id)
    mode = getattr(doc, "consultation_mode", None) or "In-person"
    if mode != "Online" and not getattr(doc, "meeting_link", None):
        # Auto-upgrade if meeting was never stamped
        link, _ = _meeting_link(appointment_id)
        frappe.db.set_value(
            "Doctor Appointment",
            appointment_id,
            {"consultation_mode": "Online", "meeting_link": link},
            update_modified=True,
        )
        doc.reload()

    return _success({"session": _serialize_tele_session(doc)})


@frappe.whitelist(allow_guest=True)
def join_video_session(appointment_id=None, token=None, sid=None):
    """Return embeddable Jitsi URL for teleconsult / yoga / online wellness."""
    res = get_teleconsult_session(appointment_id=appointment_id, sid=sid, token=token)
    if res.get("status") != "success":
        return res
    session = (res.get("data") or {}).get("session") or {}
    return _success(
        {
            "appointment_id": session.get("appointment_id"),
            "meeting_link": session.get("meeting_link"),
            "portal_join_url": session.get("portal_join_url"),
            "patient_name": session.get("patient_name"),
            "doctor_name": session.get("doctor_name"),
            "appointment_date": session.get("appointment_date"),
            "appointment_time": session.get("appointment_time"),
            "provider": "jitsi",
        }
    )


@frappe.whitelist()
def schedule_appointment_followup(
    appointment_id=None,
    follow_up_date=None,
    follow_up_notes=None,
    book_slot=None,
    appointment_time=None,
    sid=None,
):
    """Record follow-up on completed consult; optionally book follow-up appointment."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)

    parent = frappe.get_doc("Doctor Appointment", appointment_id)
    follow_up_date = _parse_request_value("follow_up_date", follow_up_date)
    follow_up_notes = _parse_request_value("follow_up_notes", follow_up_notes)

    updates = {}
    if follow_up_date:
        updates["follow_up_date"] = getdate(follow_up_date)
    if follow_up_notes:
        updates["follow_up_notes"] = follow_up_notes
    if updates:
        frappe.db.set_value("Doctor Appointment", appointment_id, updates, update_modified=True)

    follow_up_apt = None
    if book_slot and follow_up_date:
        res = book_patient_appointment(
            patient_name=parent.patient_name,
            practitioner=parent.doctor,
            appointment_type=parent.consultation_type,
            appointment_date=follow_up_date,
            appointment_time=appointment_time,
            department=parent.department,
            notes=f"Follow-up for {appointment_id}. {follow_up_notes or ''}".strip(),
            payment_method=parent.payment_method,
            amount=parent.amount,
            sid=sid,
        )
        if res.get("status") == "success":
            follow_up_apt = (res.get("data") or {}).get("appointment_id")
            if follow_up_apt:
                mode = getattr(parent, "consultation_mode", None) or "In-person"
                extra = {"parent_appointment": appointment_id}
                if mode == "Online":
                    link, _ = _meeting_link(follow_up_apt)
                    extra["consultation_mode"] = "Online"
                    extra["meeting_link"] = link
                frappe.db.set_value("Doctor Appointment", follow_up_apt, extra, update_modified=True)

    frappe.db.commit()
    return _success(
        {
            "parent_appointment": appointment_id,
            "follow_up_date": str(follow_up_date) if follow_up_date else None,
            "follow_up_appointment": follow_up_apt,
        },
        message=_("Follow-up scheduled"),
    )


def setup_phase42_telemedicine():
    ensure_telemedicine_fields()
    frappe.clear_cache(doctype="Doctor Appointment")
    return {"ok": True, "phase": "42", "feature": "teleconsultation"}
