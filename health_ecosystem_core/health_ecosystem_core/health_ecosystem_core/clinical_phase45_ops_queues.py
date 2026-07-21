"""Phase 45 — Staff operations queues for provider onboarding, insurance, telemedicine."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


def _staff_only():
    if not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)
    return None


def _serialize_application_detail(doc):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase41_provider_onboarding import (
        _serialize_application,
    )

    if isinstance(doc, str):
        doc = frappe.get_doc("Service Provider Application", doc)
    data = _serialize_application(doc)
    data.update(
        {
            "gender": doc.gender,
            "qualification": doc.qualification,
            "registration_number": doc.registration_number,
            "clinic_address": doc.clinic_address,
            "bio": doc.bio,
            "review_notes": doc.review_notes,
            "creation": str(doc.creation),
            "schedule_proposal": [
                {
                    "day_of_week": row.day_of_week,
                    "from_time": str(row.from_time or ""),
                    "to_time": str(row.to_time or ""),
                    "slot_duration": row.slot_duration or 15,
                    "consultation_mode": row.consultation_mode or "Both",
                }
                for row in doc.schedule_proposal or []
            ],
        }
    )
    return data


def _serialize_insurance_request(name):
    doc = frappe.get_doc("Insurance Quote Request", name)
    product_name = frappe.db.get_value("Health Insurance Product", doc.product, "product_name")
    return {
        "name": doc.name,
        "customer_name": doc.customer_name,
        "phone": doc.phone,
        "email": doc.email,
        "product": doc.product,
        "product_name": product_name,
        "insurer": doc.insurer,
        "sum_insured": doc.sum_insured,
        "status": doc.status,
        "notes": doc.notes,
        "creation": str(doc.creation),
        "modified": str(doc.modified),
    }


def _serialize_tele_row(row):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase42_telemedicine import (
        _serialize_tele_session,
    )

    doc = frappe.get_doc("Doctor Appointment", row.name)
    return _serialize_tele_session(doc)


@frappe.whitelist()
def get_ops_hub_summary(sid=None):
    """Counts for staff dashboard cards."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if err := _staff_only():
        return err

    provider_pending = 0
    if frappe.db.exists("DocType", "Service Provider Application"):
        provider_pending = frappe.db.count(
            "Service Provider Application",
            {"application_status": ["in", ["Submitted", "Under Review"]]},
        )

    insurance_pending = 0
    if frappe.db.exists("DocType", "Insurance Quote Request"):
        insurance_pending = frappe.db.count(
            "Insurance Quote Request",
            {"status": ["in", ["New", "Contacted"]]},
        )

    tele_upcoming = 0
    if frappe.db.table_exists("tabDoctor Appointment"):
        tele_upcoming = frappe.db.count(
            "Doctor Appointment",
            {
                "consultation_mode": "Online",
                "appointment_date": [">=", today()],
                "status": ["not in", ["Cancelled", "No Show"]],
            },
        )

    return _success(
        {
            "provider_applications_pending": provider_pending,
            "insurance_quotes_pending": insurance_pending,
            "teleconsults_upcoming": tele_upcoming,
        }
    )


@frappe.whitelist()
def get_provider_application_detail(application_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if err := _staff_only():
        return err

    application_id = (_parse_request_value("application_id", application_id) or "").strip()
    if not application_id or not frappe.db.exists("Service Provider Application", application_id):
        return _error(_("Application not found"), 404)

    return _success({"application": _serialize_application_detail(application_id)})


@frappe.whitelist()
def list_insurance_quote_queue(limit=50, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if err := _staff_only():
        return err
    if not frappe.db.exists("DocType", "Insurance Quote Request"):
        return _success({"pending": [], "recent": []})

    lim = int(limit or 50)
    pending_rows = frappe.get_all(
        "Insurance Quote Request",
        filters={"status": ["in", ["New", "Contacted"]]},
        fields=["name"],
        order_by="creation asc",
        limit=lim,
    )
    recent_rows = frappe.get_all(
        "Insurance Quote Request",
        filters={"status": ["in", ["Quote Sent", "Policy Issued", "Closed"]]},
        fields=["name"],
        order_by="modified desc",
        limit=lim,
    )
    return _success(
        {
            "pending": [_serialize_insurance_request(r.name) for r in pending_rows],
            "recent": [_serialize_insurance_request(r.name) for r in recent_rows],
        }
    )


@frappe.whitelist()
def update_insurance_quote_request(
    request_id=None,
    status=None,
    notes=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if err := _staff_only():
        return err

    request_id = (_parse_request_value("request_id", request_id) or "").strip()
    if not request_id or not frappe.db.exists("Insurance Quote Request", request_id):
        return _error(_("Quote request not found"), 404)

    status = (_parse_request_value("status", status) or "").strip()
    allowed = {"New", "Contacted", "Quote Sent", "Policy Issued", "Closed"}
    if status and status not in allowed:
        return _error(_("Invalid status"), 400)

    doc = frappe.get_doc("Insurance Quote Request", request_id)
    if status:
        doc.status = status
    notes_val = _parse_request_value("notes", notes)
    if notes_val is not None:
        doc.notes = notes_val
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {"request": _serialize_insurance_request(doc.name)},
        message=_("Insurance quote request updated"),
    )


@frappe.whitelist()
def list_teleconsult_queue(days=7, limit=50, sid=None):
    """Upcoming online consultations for staff / coordinators."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if err := _staff_only():
        return err
    if not frappe.db.table_exists("tabDoctor Appointment"):
        return _success({"sessions": []})

    horizon = add_days(today(), int(days or 7))
    rows = frappe.get_all(
        "Doctor Appointment",
        filters={
            "consultation_mode": "Online",
            "appointment_date": ["between", [today(), horizon]],
            "status": ["not in", ["Cancelled", "No Show"]],
        },
        fields=["name"],
        order_by="appointment_date asc, appointment_time asc",
        limit=int(limit or 50),
    )
    return _success({"sessions": [_serialize_tele_row(r) for r in rows]})


def setup_phase45_ops_queues():
    return {
        "ok": True,
        "phase": "45",
        "feature": "staff_ops_queues",
        "routes": [
            "/dashboard/provider-applications",
            "/dashboard/insurance-quotes",
            "/dashboard/teleconsults",
        ],
    }
