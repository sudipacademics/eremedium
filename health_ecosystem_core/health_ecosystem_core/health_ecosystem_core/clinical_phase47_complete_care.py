"""Phase 47 — Teleconsult follow-ups, consultation entitlements, appointment billing."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


def ensure_phase47_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Subscription Plan": [
                {
                    "fieldname": "consultation_discount_percent",
                    "label": "Consultation discount %",
                    "fieldtype": "Float",
                    "insert_after": "pharmacy_discount_percent",
                    "default": "0",
                },
            ],
            "Doctor Appointment": [
                {
                    "fieldname": "membership_discount",
                    "label": "Membership Discount",
                    "fieldtype": "Currency",
                    "insert_after": "amount",
                },
                {
                    "fieldname": "membership_plan_code",
                    "label": "Membership Plan",
                    "fieldtype": "Data",
                    "insert_after": "membership_discount",
                },
                {
                    "fieldname": "sales_invoice",
                    "label": "Sales Invoice",
                    "fieldtype": "Link",
                    "options": "Sales Invoice",
                    "insert_after": "payment_id",
                    "read_only": 1,
                },
            ],
        },
        update=True,
    )


def upgrade_circle_consult_discounts():
    if not frappe.db.exists("DocType", "Health Subscription Plan"):
        return []
    tiers = {
        "CIRCLE_3M": 5,
        "CIRCLE_12M": 8,
        "CIRCLE_FAMILY": 10,
        "FAMILY_MONTHLY": 5,
        "WELLNESS_PLUS": 8,
        "ANNUAL_FAMILY": 10,
    }
    updated = []
    meta = frappe.get_meta("Health Subscription Plan")
    if not meta.has_field("consultation_discount_percent"):
        return updated
    for code, pct in tiers.items():
        if frappe.db.exists("Health Subscription Plan", code):
            frappe.db.set_value(
                "Health Subscription Plan",
                code,
                "consultation_discount_percent",
                pct,
                update_modified=True,
            )
            updated.append(code)
    return updated


def apply_consult_checkout_pricing(user, subtotal, promo_code=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import apply_checkout_pricing

    return apply_checkout_pricing(user, subtotal, "consult", promo_code)


def persist_consult_membership(doc_data, pricing):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import persist_membership_on_doc

    persist_membership_on_doc(doc_data, pricing, "Doctor Appointment")
    if pricing.get("final_total") is not None:
        doc_data["amount"] = flt(pricing["final_total"])


def resolve_doctor_for_user(user=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase46_provider_portal import (
        resolve_doctor_for_user as _resolve,
    )

    return _resolve(user)


def can_manage_consult_followup(appointment_id, user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    if is_staff(_user_roles(user)):
        return True
    doctor_id = resolve_doctor_for_user(user)
    if doctor_id and frappe.db.get_value("Doctor Appointment", appointment_id, "doctor") == doctor_id:
        return True
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user(user)
    if profile and profile.get("patient_id"):
        return frappe.db.get_value("Doctor Appointment", appointment_id, "patient") == profile["patient_id"]
    return False


def can_complete_consult_billing(appointment_id, user=None):
    user = user or frappe.session.user
    if is_staff(_user_roles(user)):
        return True
    doctor_id = resolve_doctor_for_user(user)
    if not doctor_id:
        return False
    return frappe.db.get_value("Doctor Appointment", appointment_id, "doctor") == doctor_id


def _serialize_followup_row(name):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase42_telemedicine import (
        _serialize_tele_session,
    )

    doc = frappe.get_doc("Doctor Appointment", name)
    data = _serialize_tele_session(doc)
    data["needs_followup"] = not bool(getattr(doc, "follow_up_date", None))
    data["sales_invoice"] = getattr(doc, "sales_invoice", None)
    return data


@frappe.whitelist()
def list_consult_followup_queue(limit=50, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not is_staff(_user_roles()) and not resolve_doctor_for_user():
        return _error(_("Not authorized"), 403)
    if not frappe.db.table_exists("tabDoctor Appointment"):
        return _success({"sessions": []})

    filters = {
        "consultation_mode": "Online",
        "appointment_date": ["<=", today()],
        "status": ["in", ["Scheduled", "Confirmed", "Checked In", "Completed"]],
    }
    doctor_filter = resolve_doctor_for_user() if not is_staff(_user_roles()) else None
    if doctor_filter:
        filters["doctor"] = doctor_filter

    rows = frappe.get_all(
        "Doctor Appointment",
        filters=filters,
        fields=["name"],
        order_by="appointment_date desc, appointment_time desc",
        limit=int(limit or 50),
    )
    return _success({"sessions": [_serialize_followup_row(r.name) for r in rows]})


@frappe.whitelist()
def schedule_consult_followup(
    appointment_id=None,
    follow_up_date=None,
    follow_up_notes=None,
    book_slot=None,
    appointment_time=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)
    if not can_manage_consult_followup(appointment_id):
        return _error(_("Not authorized"), 403)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase42_telemedicine import (
        schedule_appointment_followup,
    )

    return schedule_appointment_followup(
        appointment_id=appointment_id,
        follow_up_date=follow_up_date,
        follow_up_notes=follow_up_notes,
        book_slot=book_slot,
        appointment_time=appointment_time,
        sid=sid,
    )


def _consultation_item_code(appointment):
    item = None
    if appointment.consultation_type:
        item = frappe.db.get_value("Consultation Type", appointment.consultation_type, "item")
    if item and frappe.db.exists("Item", item):
        return item
    fallback = frappe.db.get_value("Item", {"item_name": ["like", "%Consult%"]}, "name")
    return fallback or frappe.db.get_value("Item", {}, "name")


def _create_sales_invoice_for_appointment(appointment):
    from health_ecosystem_core.health_ecosystem_core.api import (
        _ensure_customer,
        _ensure_healthcare_invoice_fields,
    )

    _ensure_healthcare_invoice_fields()
    existing = getattr(appointment, "sales_invoice", None)
    if existing and frappe.db.exists("Sales Invoice", existing):
        return existing

    amount = flt(appointment.amount)
    if amount <= 0:
        return None

    company = appointment.company or frappe.defaults.get_global_default("company")
    if not company:
        companies = frappe.get_all("Company", limit=1)
        if not companies:
            frappe.throw(_("No company configured"))
        company = companies[0].name

    phone = None
    if appointment.patient:
        phone = frappe.db.get_value("Health Patient", appointment.patient, "mobile")

    customer = _ensure_customer(appointment.patient_name, phone)
    item_code = _consultation_item_code(appointment)
    if not item_code:
        frappe.throw(_("No billable item configured for consultations"))

    invoice_data = {
        "doctype": "Sales Invoice",
        "customer": customer,
        "company": company,
        "due_date": today(),
        "items": [
            {
                "item_code": item_code,
                "qty": 1,
                "rate": amount,
                "description": f"Consultation {appointment.name} — {appointment.patient_name}",
            }
        ],
        "remarks": f"Consultation billing for {appointment.name}",
    }
    if frappe.get_meta("Sales Invoice").has_field("service_unit"):
        invoice_data["service_unit"] = None

    si = frappe.get_doc(invoice_data)
    si.insert(ignore_permissions=True)
    si.submit()
    return si.name


@frappe.whitelist()
def complete_consultation_billing(appointment_id=None, completion_notes=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)
    if not can_complete_consult_billing(appointment_id):
        return _error(_("Not authorized"), 403)

    doc = frappe.get_doc("Doctor Appointment", appointment_id)
    if doc.status in ("Cancelled", "No Show"):
        return _error(_("Cannot complete a cancelled appointment"))

    completion_notes = _parse_request_value("completion_notes", completion_notes)
    if completion_notes:
        doc.notes = ((doc.notes or "") + f"\n{completion_notes}").strip()

    doc.status = "Completed"
    sales_invoice = None
    try:
        sales_invoice = _create_sales_invoice_for_appointment(doc)
        if sales_invoice and frappe.get_meta("Doctor Appointment").has_field("sales_invoice"):
            doc.sales_invoice = sales_invoice
    except Exception:
        frappe.log_error(title="complete_consultation_billing_si", message=frappe.get_traceback())

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {
            "appointment_id": doc.name,
            "status": doc.status,
            "sales_invoice": sales_invoice or getattr(doc, "sales_invoice", None),
            "amount": flt(doc.amount),
        },
        message=_("Consultation marked complete"),
    )


@frappe.whitelist()
def preview_consult_checkout(subtotal=None, promo_code=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    subtotal = flt(_parse_request_value("subtotal", subtotal) or 0)
    if subtotal <= 0:
        return _error(_("Consultation fee must be greater than zero"))
    promo_code = _parse_request_value("promo_code", promo_code)
    return _success(apply_consult_checkout_pricing(frappe.session.user, subtotal, promo_code))


def setup_phase47_complete_care():
    ensure_phase47_fields()
    upgraded = upgrade_circle_consult_discounts()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": "47",
        "feature": "followup_entitlements_billing",
        "circle_plans_upgraded": upgraded,
    }
