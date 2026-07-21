"""Phase 46 — Provider portal: approved doctors manage profile and schedule."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)


def ensure_provider_portal_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Doctor": [
                {
                    "fieldname": "provider_bio",
                    "label": "Provider Bio",
                    "fieldtype": "Small Text",
                    "insert_after": "email",
                },
            ]
        },
        update=True,
    )


def resolve_doctor_for_user(user=None):
    """Return Doctor name linked to portal user, repairing stale links when possible."""
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None

    doctor = frappe.db.get_value("Doctor", {"user": user, "status": "Active"}, "name")
    if doctor:
        return doctor

    email = frappe.db.get_value("User", user, "email")
    if email:
        doctor = frappe.db.get_value("Doctor", {"email": email, "status": "Active"}, "name")
        if doctor:
            frappe.db.set_value("Doctor", doctor, "user", user, update_modified=False)
            return doctor

    candidates = frappe.get_all(
        "Service Provider Application",
        filters={"application_status": "Approved", "linked_doctor": ["is", "set"]},
        fields=["name", "linked_doctor", "applicant_user", "email", "linked_user"],
        order_by="modified desc",
        limit=20,
    )
    for row in candidates:
        if row.applicant_user == user or row.linked_user == user or (email and row.email == email):
            if row.linked_doctor:
                frappe.db.set_value("Doctor", row.linked_doctor, "user", user, update_modified=False)
                if not row.linked_user:
                    frappe.db.set_value(
                        "Service Provider Application",
                        row.name,
                        "linked_user",
                        user,
                        update_modified=False,
                    )
                return row.linked_doctor
    return None


def provider_profile_for_user(user=None):
    doctor_id = resolve_doctor_for_user(user)
    if not doctor_id:
        return None
    doc = frappe.get_doc("Doctor", doctor_id)
    dept_name = None
    if doc.primary_department:
        dept_name = frappe.db.get_value("Clinical Department", doc.primary_department, "department_name")
    bio = getattr(doc, "provider_bio", None)
    if not bio:
        bio = frappe.db.get_value(
            "Service Provider Application",
            {"linked_doctor": doctor_id, "application_status": "Approved"},
            "bio",
            order_by="modified desc",
        )
    return {
        "doctor_id": doc.name,
        "doctor_name": doc.doctor_name,
        "email": doc.email,
        "mobile": doc.mobile,
        "primary_department": doc.primary_department,
        "department_name": dept_name,
        "status": doc.status,
        "bio": bio,
    }


def _require_my_doctor(sid=None):
    if not _require_mobile_auth(sid):
        return None, _error(_("Not authenticated"), 401)
    doctor_id = resolve_doctor_for_user()
    if not doctor_id:
        return None, _error(_("No provider profile linked to this account"), 403)
    return doctor_id, None


def _serialize_schedule_slot(row):
    return {
        "name": row.name,
        "day_of_week": row.day_of_week,
        "from_time": str(row.from_time or ""),
        "to_time": str(row.to_time or ""),
        "slot_duration": int(row.slot_duration or 15),
        "consultation_type": row.consultation_type,
        "department": row.department,
        "is_active": bool(row.is_active),
    }


def _serialize_appointment(row):
    mode = getattr(row, "consultation_mode", None) or "In-person"
    meeting_link = getattr(row, "meeting_link", None)
    return {
        "appointment_id": row.name,
        "patient_name": row.patient_name,
        "appointment_date": str(row.appointment_date),
        "appointment_time": str(row.appointment_time or ""),
        "status": row.status,
        "consultation_mode": mode,
        "meeting_link": meeting_link,
        "department": row.department,
        "amount": row.amount,
        "razorpay_payment_status": row.razorpay_payment_status,
    }


@frappe.whitelist()
def get_my_provider_portal(sid=None):
    doctor_id, err = _require_my_doctor(sid)
    if err:
        return err

    doctor = frappe.get_doc("Doctor", doctor_id)
    slots = frappe.get_all(
        "Doctor Schedule Slot",
        filters={"doctor": doctor_id},
        fields=[
            "name",
            "day_of_week",
            "from_time",
            "to_time",
            "slot_duration",
            "consultation_type",
            "department",
            "is_active",
        ],
        order_by="day_of_week asc, from_time asc",
    )
    horizon = add_days(today(), 14)
    appointments = frappe.get_all(
        "Doctor Appointment",
        filters={
            "doctor": doctor_id,
            "appointment_date": ["between", [today(), horizon]],
            "status": ["not in", ["Cancelled", "No Show"]],
        },
        fields=[
            "name",
            "patient_name",
            "appointment_date",
            "appointment_time",
            "status",
            "department",
            "amount",
            "razorpay_payment_status",
        ],
        order_by="appointment_date asc, appointment_time asc",
        limit=50,
    )
    for apt in appointments:
        apt["consultation_mode"] = frappe.db.get_value("Doctor Appointment", apt.name, "consultation_mode")
        apt["meeting_link"] = frappe.db.get_value("Doctor Appointment", apt.name, "meeting_link")

    return _success(
        {
            "profile": provider_profile_for_user(),
            "schedule_slots": [_serialize_schedule_slot(frappe._dict(s)) for s in slots],
            "upcoming_appointments": [_serialize_appointment(frappe._dict(a)) for a in appointments],
            "doctor_status": doctor.status,
        }
    )


@frappe.whitelist()
def update_my_provider_profile(mobile=None, email=None, bio=None, sid=None):
    doctor_id, err = _require_my_doctor(sid)
    if err:
        return err

    doctor = frappe.get_doc("Doctor", doctor_id)
    mobile = _parse_request_value("mobile", mobile)
    email = _parse_request_value("email", email)
    bio = _parse_request_value("bio", bio)

    if mobile is not None:
        doctor.mobile = (mobile or "").strip()
    if email is not None:
        doctor.email = (email or "").strip()
    if bio is not None:
        if hasattr(doctor, "provider_bio"):
            doctor.provider_bio = bio
    doctor.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"profile": provider_profile_for_user()}, message=_("Profile updated"))


@frappe.whitelist()
def save_my_schedule_slot(
    slot_id=None,
    day_of_week=None,
    from_time=None,
    to_time=None,
    slot_duration=None,
    consultation_type=None,
    department=None,
    is_active=None,
    sid=None,
):
    doctor_id, err = _require_my_doctor(sid)
    if err:
        return err

    slot_id = (_parse_request_value("slot_id", slot_id) or "").strip()
    day_of_week = (_parse_request_value("day_of_week", day_of_week) or "").strip()
    from_time = _parse_request_value("from_time", from_time)
    to_time = _parse_request_value("to_time", to_time)

    if slot_id:
        if not frappe.db.exists("Doctor Schedule Slot", slot_id):
            return _error(_("Schedule slot not found"), 404)
        slot = frappe.get_doc("Doctor Schedule Slot", slot_id)
        if slot.doctor != doctor_id:
            return _error(_("Not authorized"), 403)
    else:
        if not all([day_of_week, from_time, to_time]):
            return _error(_("Day, from time and to time are required"))
        doctor = frappe.get_doc("Doctor", doctor_id)
        slot = frappe.get_doc(
            {
                "doctype": "Doctor Schedule Slot",
                "doctor": doctor_id,
                "department": department or doctor.primary_department,
                "day_of_week": day_of_week,
                "from_time": from_time,
                "to_time": to_time,
                "slot_duration": int(slot_duration or 15),
                "consultation_type": consultation_type,
                "is_active": 1,
            }
        )

    if day_of_week:
        slot.day_of_week = day_of_week
    if from_time:
        slot.from_time = from_time
    if to_time:
        slot.to_time = to_time
    if slot_duration:
        slot.slot_duration = int(slot_duration)
    if consultation_type:
        slot.consultation_type = consultation_type
    if department:
        slot.department = department
    if is_active is not None:
        slot.is_active = 1 if str(is_active).lower() in ("1", "true", "yes") else 0

    if slot_id:
        slot.save(ignore_permissions=True)
    else:
        slot.insert(ignore_permissions=True)

    frappe.db.commit()
    return _success({"slot": _serialize_schedule_slot(slot)}, message=_("Schedule saved"))


@frappe.whitelist()
def set_my_schedule_slot_active(slot_id=None, is_active=1, sid=None):
    doctor_id, err = _require_my_doctor(sid)
    if err:
        return err

    slot_id = (_parse_request_value("slot_id", slot_id) or "").strip()
    if not slot_id or not frappe.db.exists("Doctor Schedule Slot", slot_id):
        return _error(_("Schedule slot not found"), 404)

    slot = frappe.get_doc("Doctor Schedule Slot", slot_id)
    if slot.doctor != doctor_id:
        return _error(_("Not authorized"), 403)

    slot.is_active = 1 if str(is_active).lower() in ("1", "true", "yes") else 0
    slot.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"slot": _serialize_schedule_slot(slot)}, message=_("Schedule updated"))


def link_provider_user_on_approval(doc, doctor_id):
    """Called from phase 41 approval — attach portal user + Physician role."""
    user_id = doc.applicant_user or doc.linked_user
    if not user_id and doc.email:
        user_id = frappe.db.get_value("User", {"email": doc.email}, "name")
        if not user_id:
            user_id = frappe.db.get_value("User", doc.email, "name")

    if not user_id or not frappe.db.exists("User", user_id):
        return None

    frappe.db.set_value("Doctor", doctor_id, "user", user_id, update_modified=True)
    doc.linked_user = user_id

    roles = frappe.get_roles(user_id)
    if "Physician" not in roles:
        user = frappe.get_doc("User", user_id)
        user.add_roles("Physician")
    return user_id


def setup_phase46_provider_portal():
    ensure_provider_portal_fields()
    return {
        "ok": True,
        "phase": "46",
        "feature": "provider_portal",
        "route": "/dashboard/provider",
    }
