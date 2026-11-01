"""Phase 103 — Provider practice analytics + OPD visit-pack memberships."""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


def ensure_phase103_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Subscription Plan": [
                {
                    "fieldname": "opd_visit_pack",
                    "label": "OPD Visit Pack",
                    "fieldtype": "Check",
                    "default": "0",
                    "insert_after": "consultation_discount_percent",
                },
                {
                    "fieldname": "included_opd_visits",
                    "label": "Included OPD Visits",
                    "fieldtype": "Int",
                    "default": "0",
                    "insert_after": "opd_visit_pack",
                },
                {
                    "fieldname": "linked_doctor",
                    "label": "Linked Doctor (OPD pack)",
                    "fieldtype": "Link",
                    "options": "Doctor",
                    "insert_after": "included_opd_visits",
                },
            ],
            "Health Subscription": [
                {
                    "fieldname": "opd_visits_remaining",
                    "label": "OPD Visits Remaining",
                    "fieldtype": "Int",
                    "default": "0",
                    "insert_after": "status",
                },
                {
                    "fieldname": "opd_visits_total",
                    "label": "OPD Visits Total",
                    "fieldtype": "Int",
                    "default": "0",
                    "insert_after": "opd_visits_remaining",
                },
                {
                    "fieldname": "linked_doctor",
                    "label": "Linked Doctor",
                    "fieldtype": "Link",
                    "options": "Doctor",
                    "insert_after": "opd_visits_total",
                },
            ],
        },
        update=True,
    )


def seed_opd_visit_packs():
    ensure_phase103_fields()
    if not frappe.db.exists("DocType", "Health Subscription Plan"):
        return []
    specs = [
        {
            "plan_code": "OPD-PACK-6",
            "title": "OPD Visit Pack (6 consults)",
            "description": "Six zero-charge consultations with lab/pharmacy member discounts.",
            "monthly_price": 2999,
            "billing_interval": "Year",
            "enabled": 1,
            "opd_visit_pack": 1,
            "included_opd_visits": 6,
            "lab_discount_percent": 20,
            "pharmacy_discount_percent": 10,
            "consultation_discount_percent": 100,
        },
        {
            "plan_code": "OPD-PACK-12",
            "title": "OPD Visit Pack (12 consults)",
            "description": "Twelve zero-charge consultations with stronger member discounts.",
            "monthly_price": 4999,
            "billing_interval": "Year",
            "enabled": 1,
            "opd_visit_pack": 1,
            "included_opd_visits": 12,
            "lab_discount_percent": 30,
            "pharmacy_discount_percent": 15,
            "consultation_discount_percent": 100,
        },
    ]
    seeded = []
    for spec in specs:
        code = spec["plan_code"]
        if frappe.db.exists("Health Subscription Plan", code):
            doc = frappe.get_doc("Health Subscription Plan", code)
            for k, v in spec.items():
                if doc.meta.has_field(k):
                    doc.set(k, v)
            doc.save(ignore_permissions=True)
        else:
            # Minimal create — extra fields may already exist via custom fields
            payload = {"doctype": "Health Subscription Plan", **spec}
            frappe.get_doc(payload).insert(ignore_permissions=True)
        seeded.append(code)
    frappe.db.commit()
    return seeded


def _resolve_doctor_for_user(user=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase46_provider_portal import (
        resolve_doctor_for_user,
    )

    return resolve_doctor_for_user(user)


@frappe.whitelist()
def get_my_practice_analytics(days=30, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)

    days = cint(_parse_request_value("days", days) or 30)
    since = getdate(today()) - timedelta(days=max(days, 1))
    doctor = _resolve_doctor_for_user()
    if not doctor and not is_staff(roles):
        return _error(_("Doctor profile not linked"), 404)

    apt_filters = {"appointment_date": [">=", since], "status": ["!=", "Cancelled"]}
    rx_filters = {"encounter_date": [">=", since], "status": ["!=", "Cancelled"]}
    if doctor:
        apt_filters["doctor"] = doctor
        rx_filters["doctor"] = doctor

    appointments = frappe.get_all(
        "Doctor Appointment",
        filters=apt_filters,
        fields=["name", "status", "consultation_mode", "amount", "appointment_date"],
    )
    prescriptions = frappe.get_all(
        "Clinical Prescription",
        filters=rx_filters,
        fields=["name"],
    )

    encounters = []
    if frappe.db.exists("DocType", "Clinical Encounter"):
        enc_filters = {"creation": [">=", str(since)]}
        if doctor:
            enc_filters["doctor"] = doctor
        encounters = frappe.get_all("Clinical Encounter", filters=enc_filters, fields=["name", "status"])

    care_enrollments = 0
    if frappe.db.exists("DocType", "Care Enrollment") and doctor:
        care_enrollments = frappe.db.count(
            "Care Enrollment", {"assigned_doctor": doctor, "status": "Active"}
        )

    tele = [a for a in appointments if (a.consultation_mode or "").lower() in ("online", "tele", "teleconsult")]
    revenue = sum(flt(a.amount) for a in appointments)
    completed = [a for a in appointments if (a.status or "") in ("Completed", "Checked In", "Closed")]

    return _success(
        {
            "doctor": doctor,
            "days": days,
            "kpis": {
                "appointments": len(appointments),
                "completed_visits": len(completed),
                "teleconsults": len(tele),
                "prescriptions": len(prescriptions),
                "encounters": len(encounters),
                "encounters_final": len([e for e in encounters if e.status == "Final"]),
                "care_program_enrollments": care_enrollments,
                "consult_revenue": revenue,
                "follow_up_rate": round((len(prescriptions) / len(appointments) * 100.0), 1)
                if appointments
                else 0.0,
            },
        }
    )


@frappe.whitelist()
def list_opd_visit_packs(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase103_fields()
    if not frappe.db.exists("DocType", "Health Subscription Plan"):
        return _success({"plans": []})
    meta = frappe.get_meta("Health Subscription Plan")
    filters = {"enabled": 1}
    if meta.has_field("opd_visit_pack"):
        filters["opd_visit_pack"] = 1
    rows = frappe.get_all(
        "Health Subscription Plan",
        filters=filters,
        fields=[
            "name",
            "plan_code",
            "title",
            "description",
            "monthly_price",
            "lab_discount_percent",
            "pharmacy_discount_percent",
            "included_opd_visits",
            "linked_doctor",
        ],
        order_by="monthly_price asc",
    )
    return _success({"plans": rows})


@frappe.whitelist()
def activate_opd_visit_pack_entitlement(subscription_id=None, sid=None):
    """When a Health Subscription is activated for an OPD pack plan, stamp visit counters."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not is_staff(_user_roles()):
        return _error(_("Staff only"), 403)
    ensure_phase103_fields()
    subscription_id = (_parse_request_value("subscription_id", subscription_id) or "").strip()
    if not subscription_id or not frappe.db.exists("Health Subscription", subscription_id):
        return _error(_("Subscription not found"), 404)
    sub = frappe.get_doc("Health Subscription", subscription_id)
    plan = frappe.get_doc("Health Subscription Plan", sub.plan)
    visits = cint(getattr(plan, "included_opd_visits", 0) or 0)
    if not cint(getattr(plan, "opd_visit_pack", 0)):
        return _error(_("Plan is not an OPD visit pack"))
    sub.opd_visits_total = visits
    sub.opd_visits_remaining = visits
    if getattr(plan, "linked_doctor", None):
        sub.linked_doctor = plan.linked_doctor
    sub.save(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {
            "subscription": sub.name,
            "opd_visits_remaining": sub.opd_visits_remaining,
            "opd_visits_total": sub.opd_visits_total,
        }
    )


@frappe.whitelist()
def consume_opd_visit_entitlement(appointment_id=None, sid=None):
    """Decrement OPD visit pack when booking a zero-charge consult."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase103_fields()
    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)
    apt = frappe.get_doc("Doctor Appointment", appointment_id)
    if not apt.patient:
        return _error(_("No patient on appointment"))

    # Find active OPD pack subscription for patient user / patient
    user = frappe.db.get_value("Health Patient", apt.patient, "user")
    filters = {"status": "Active"}
    if user:
        filters["user"] = user
    else:
        # fallback: match via custom patient field if present
        if frappe.get_meta("Health Subscription").has_field("patient"):
            filters["patient"] = apt.patient
        else:
            return _error(_("No active OPD pack found"))

    subs = frappe.get_all(
        "Health Subscription",
        filters=filters,
        fields=["name", "opd_visits_remaining", "plan", "linked_doctor"],
        order_by="creation desc",
    )
    chosen = None
    for s in subs:
        if cint(s.opd_visits_remaining) <= 0:
            continue
        plan_is_pack = cint(
            frappe.db.get_value("Health Subscription Plan", s.plan, "opd_visit_pack") or 0
        )
        if not plan_is_pack:
            continue
        if s.linked_doctor and apt.doctor and s.linked_doctor != apt.doctor:
            continue
        chosen = s
        break
    if not chosen:
        return _error(_("No OPD visit entitlement remaining"))

    remaining = cint(chosen.opd_visits_remaining) - 1
    frappe.db.set_value("Health Subscription", chosen.name, "opd_visits_remaining", remaining)
    # Zero out consult charge
    try:
        apt.amount = 0
        if apt.meta.has_field("membership_plan_code"):
            apt.membership_plan_code = chosen.plan
        if apt.meta.has_field("membership_discount"):
            apt.membership_discount = flt(
                frappe.db.get_value("Doctor", apt.doctor, "consultation_fee") or 0
            )
        apt.save(ignore_permissions=True)
    except Exception:
        frappe.db.set_value("Doctor Appointment", apt.name, "amount", 0)
    frappe.db.commit()
    return _success(
        {
            "appointment_id": apt.name,
            "subscription": chosen.name,
            "opd_visits_remaining": remaining,
            "amount": 0,
        }
    )


def setup_phase103_practice_analytics():
    ensure_phase103_fields()
    seeded = seed_opd_visit_packs()
    return {"ok": True, "phase": "103", "seeded_plans": seeded}


def smoke_phase103_practice_analytics():
    setup = setup_phase103_practice_analytics()
    packs = []
    if frappe.db.exists("DocType", "Health Subscription Plan"):
        packs = frappe.get_all(
            "Health Subscription Plan",
            filters={"opd_visit_pack": 1} if frappe.get_meta("Health Subscription Plan").has_field("opd_visit_pack") else {},
            pluck="name",
        )
    return {"ok": True, "phase": "103", "setup": setup, "opd_packs": packs}
