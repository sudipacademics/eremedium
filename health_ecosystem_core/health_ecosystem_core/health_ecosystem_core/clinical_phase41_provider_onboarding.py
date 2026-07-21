"""Phase 41 — Doctor & wellness provider self-signup with proposed schedule."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

WELLNESS_WINGS = ("psychology", "aesthetics", "physiotherapy", "chiropractic", "ayurvedic", "yoga")


def _ready():
    return frappe.db.exists("DocType", "Service Provider Application")


def _sync_doctypes():
    from frappe.modules.import_file import import_file_by_path
    import os

    bases = []
    try:
        bases.append(os.path.join(
            frappe.get_app_path("health_ecosystem_core"),
            "health_ecosystem_core",
            "health_ecosystem_core",
            "doctype",
        ))
    except Exception:
        pass
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        bases.append(os.path.join(os.path.dirname(api_mod.__file__), "doctype"))
    except Exception:
        pass

    for base in bases:
        if not os.path.isdir(base):
            continue
        for rel in (
            "provider_schedule_proposal/provider_schedule_proposal.json",
            "service_provider_application/service_provider_application.json",
        ):
            path = os.path.join(base, rel)
            if os.path.isfile(path):
                import_file_by_path(path, force=True)
    frappe.clear_cache()


def _parse_schedule(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _serialize_application(doc):
    if isinstance(doc, str):
        doc = frappe.get_doc("Service Provider Application", doc)
    return {
        "name": doc.name,
        "provider_type": doc.provider_type,
        "application_status": doc.application_status,
        "full_name": doc.full_name,
        "email": doc.email,
        "phone": doc.phone,
        "registration_number": doc.registration_number,
        "speciality": doc.speciality,
        "department": doc.department,
        "wellness_wing": doc.wellness_wing,
        "consultation_fee": flt(doc.consultation_fee),
        "supports_online": bool(doc.supports_online),
        "supports_in_person": bool(doc.supports_in_person),
        "city": doc.city,
        "linked_doctor": doc.linked_doctor,
        "schedule_count": len(doc.schedule_proposal or []),
        "modified": str(doc.modified),
    }


@frappe.whitelist(allow_guest=True)
def submit_service_provider_application(body=None, sid=None):
    """Provider onboarding — doctor or wellness practitioner (guest apply via login page)."""
    if not _ready():
        return _error(_("Provider onboarding is not available yet"), 503)

    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    body = body or {}

    provider_type = (_parse_request_value("provider_type", body.get("provider_type")) or "").strip()
    if provider_type not in ("Doctor", "Wellness"):
        return _error(_("provider_type must be Doctor or Wellness"))

    full_name = (_parse_request_value("full_name", body.get("full_name")) or "").strip()
    email = (_parse_request_value("email", body.get("email")) or "").strip()
    phone = (_parse_request_value("phone", body.get("phone")) or "").strip()
    registration_number = (
        _parse_request_value("registration_number", body.get("registration_number")) or ""
    ).strip()
    if not all([full_name, email, phone]):
        return _error(_("Full name, email and mobile are required"))
    if not registration_number:
        return _error(_("Medical council / license registration number is required"))

    user = _require_mobile_auth(sid) if sid or frappe.session.user != "Guest" else frappe.session.user
    applicant = user if user and user != "Guest" else None

    schedule = _parse_schedule(body.get("schedule_proposal") or body.get("schedule"))
    if not schedule:
        return _error(_("Add at least one weekly schedule slot"))

    doc = frappe.get_doc(
        {
            "doctype": "Service Provider Application",
            "provider_type": provider_type,
            "application_status": "Submitted",
            "applicant_user": applicant,
            "full_name": full_name,
            "email": email,
            "phone": phone,
            "gender": body.get("gender"),
            "qualification": body.get("qualification"),
            "registration_number": registration_number,
            "speciality": body.get("speciality"),
            "department": body.get("department"),
            "wellness_wing": body.get("wellness_wing") if provider_type == "Wellness" else None,
            "consultation_fee": flt(body.get("consultation_fee")),
            "supports_online": 1 if body.get("supports_online", True) else 0,
            "supports_in_person": 1 if body.get("supports_in_person", True) else 0,
            "clinic_address": body.get("clinic_address"),
            "city": body.get("city"),
            "bio": body.get("bio"),
            "schedule_proposal": [
                {
                    "day_of_week": row.get("day_of_week"),
                    "from_time": row.get("from_time"),
                    "to_time": row.get("to_time"),
                    "slot_duration": int(row.get("slot_duration") or 15),
                    "consultation_mode": row.get("consultation_mode") or "Both",
                }
                for row in schedule
                if row.get("day_of_week") and row.get("from_time") and row.get("to_time")
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {"application": _serialize_application(doc)},
        message=_("Application submitted — our team will review within 2–3 business days"),
    )


@frappe.whitelist()
def get_my_provider_application(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _ready():
        return _success({"application": None})

    name = frappe.db.get_value(
        "Service Provider Application",
        {"applicant_user": frappe.session.user},
        "name",
        order_by="creation desc",
    )
    if not name:
        name = frappe.db.get_value(
            "Service Provider Application",
            {"email": frappe.session.user},
            "name",
            order_by="creation desc",
        )
    return _success({"application": _serialize_application(name) if name else None})


@frappe.whitelist()
def list_provider_applications(status=None, limit=50, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)
    if not _ready():
        return _success({"applications": []})

    filters = {}
    status = (_parse_request_value("status", status) or "").strip()
    if status:
        filters["application_status"] = status

    rows = frappe.get_all(
        "Service Provider Application",
        filters=filters,
        fields=["name"],
        order_by="modified desc",
        limit=int(limit or 50),
    )
    return _success({"applications": [_serialize_application(r.name) for r in rows]})


def _approve_application(doc):
    """Create Doctor + schedule slots from approved application."""
    if doc.linked_doctor:
        return doc.linked_doctor

    dept = doc.department
    if doc.provider_type == "Wellness" and doc.wellness_wing:
        dept_name = frappe.db.get_value(
            "Clinical Department", {"department_name": ["like", f"%{doc.wellness_wing}%"]}, "name"
        )
        if dept_name:
            dept = dept_name

    doctor = frappe.get_doc(
        {
            "doctype": "Doctor",
            "doctor_name": doc.full_name,
            "email": doc.email,
            "mobile": doc.phone,
            "primary_department": dept,
            "status": "Active",
        }
    )
    doctor.insert(ignore_permissions=True)

    consult_type = None
    if doc.supports_online:
        consult_type = frappe.db.get_value("Consultation Type", {"consultation_type": "Teleconsultation"}, "name")
    if not consult_type:
        consult_type = frappe.db.get_value("Consultation Type", {}, "name")

    for row in doc.schedule_proposal or []:
        frappe.get_doc(
            {
                "doctype": "Doctor Schedule Slot",
                "doctor": doctor.name,
                "department": dept,
                "day_of_week": row.day_of_week,
                "from_time": row.from_time,
                "to_time": row.to_time,
                "slot_duration": row.slot_duration or 15,
                "consultation_type": consult_type,
                "is_active": 1,
            }
        ).insert(ignore_permissions=True)

    doc.linked_doctor = doctor.name
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase46_provider_portal import (
            link_provider_user_on_approval,
        )

        link_provider_user_on_approval(doc, doctor.name)
    except Exception:
        frappe.log_error(title="link_provider_user_on_approval", message=frappe.get_traceback())
    return doctor.name


@frappe.whitelist()
def review_provider_application(application_id=None, action=None, review_notes=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)

    application_id = (_parse_request_value("application_id", application_id) or "").strip()
    action = (_parse_request_value("action", action) or "").strip().lower()
    if not application_id or not frappe.db.exists("Service Provider Application", application_id):
        return _error(_("Application not found"), 404)

    doc = frappe.get_doc("Service Provider Application", application_id)
    review_notes = _parse_request_value("review_notes", review_notes)

    if action == "approve":
        doc.application_status = "Approved"
        doc.review_notes = review_notes
        _approve_application(doc)
        doc.save(ignore_permissions=True)
        msg = _("Provider approved and schedule created")
    elif action == "reject":
        doc.application_status = "Rejected"
        doc.review_notes = review_notes
        doc.save(ignore_permissions=True)
        msg = _("Application rejected")
    else:
        return _error(_("action must be approve or reject"))

    frappe.db.commit()
    return _success({"application": _serialize_application(doc)}, message=msg)


def setup_phase41_provider_onboarding():
    _sync_doctypes()
    return {"ok": True, "phase": "41", "feature": "provider_onboarding", "wellness_wings": list(WELLNESS_WINGS)}
