"""Native clinical appointment APIs (Health Ecosystem Core — no Marley)."""

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import flt, get_time, getdate

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)


def _clinical_ready():
    return frappe.db.exists("DocType", "Doctor Appointment")


def consultation_fee_for_type(consultation_type):
    """Resolve billable fee from Consultation Type → Item standard rate."""
    from frappe.utils import flt

    if not consultation_type or not frappe.db.exists("Consultation Type", consultation_type):
        return 0
    item = frappe.db.get_value("Consultation Type", consultation_type, "item")
    if not item or not frappe.db.exists("Item", item):
        return 0
    return flt(frappe.db.get_value("Item", item, "standard_rate"))


@frappe.whitelist(allow_guest=True)
def get_appointment_types():
    if not frappe.db.exists("DocType", "Consultation Type"):
        return _success({"types": []})
    types = frappe.get_all(
        "Consultation Type",
        fields=["name", "consultation_type", "default_duration", "item"],
        order_by="name asc",
        limit=100,
    )
    for row in types:
        row["consultation_fee"] = consultation_fee_for_type(row.name)
    return _success({"types": types})


@frappe.whitelist(allow_guest=True)
def get_healthcare_departments():
    if not frappe.db.exists("DocType", "Clinical Department"):
        return _success({"departments": []})
    departments = frappe.get_all(
        "Clinical Department",
        filters={"is_active": 1},
        fields=["name", "department_name"],
        order_by="department_name asc",
        limit=100,
    )
    return _success({"departments": departments})


@frappe.whitelist(allow_guest=True)
def get_healthcare_practitioners(department=None):
    if not frappe.db.exists("DocType", "Doctor"):
        return _success({"practitioners": []})

    department = (_parse_request_value("department", department) or "").strip()
    if department:
        doctors = frappe.db.sql(
            """
            SELECT DISTINCT d.name, d.doctor_name AS practitioner_name, d.primary_department AS department
            FROM `tabDoctor` d
            LEFT JOIN `tabDoctor Speciality` s ON s.parent = d.name
            WHERE d.status = 'Active'
              AND (d.primary_department = %(dept)s OR s.department = %(dept)s)
            ORDER BY d.doctor_name
            """,
            {"dept": department},
            as_dict=True,
        )
    else:
        doctors = frappe.get_all(
            "Doctor",
            filters={"status": "Active"},
            fields=["name", "doctor_name as practitioner_name", "primary_department as department"],
            order_by="doctor_name asc",
            limit=200,
        )
    return _success({"practitioners": doctors})


@frappe.whitelist(allow_guest=True)
def get_doctor_schedule_slots(doctor=None, appointment_date=None, department=None):
    if not frappe.db.exists("DocType", "Doctor Schedule Slot"):
        return _success({"slots": []})

    doctor = (_parse_request_value("doctor", doctor) or "").strip()
    department = (_parse_request_value("department", department) or "").strip()
    appointment_date = _parse_request_value("appointment_date", appointment_date)
    if not doctor or not appointment_date:
        return _error(_("Doctor and appointment date are required"))

    day_name = getdate(appointment_date).strftime("%A")
    filters = {"doctor": doctor, "day_of_week": day_name, "is_active": 1}
    if department:
        filters["department"] = department

    schedules = frappe.get_all(
        "Doctor Schedule Slot",
        filters=filters,
        fields=["name", "from_time", "to_time", "slot_duration", "consultation_type", "department"],
    )

    booked = {
        str(r.appointment_time)
        for r in frappe.get_all(
            "Doctor Appointment",
            filters={
                "doctor": doctor,
                "appointment_date": getdate(appointment_date),
                "status": ["not in", ["Cancelled", "No Show"]],
            },
            fields=["appointment_time"],
        )
        if r.appointment_time
    }

    slots = []
    for sch in schedules:
        duration = int(sch.slot_duration or 15)
        start = datetime.combine(getdate(appointment_date), get_time(sch.from_time))
        end = datetime.combine(getdate(appointment_date), get_time(sch.to_time))
        cursor = start
        while cursor + timedelta(minutes=duration) <= end:
            slot_time = cursor.time().strftime("%H:%M:%S")
            if slot_time not in booked:
                slots.append(
                    {
                        "time": slot_time,
                        "consultation_type": sch.consultation_type,
                        "department": sch.department,
                        "schedule": sch.name,
                    }
                )
            cursor += timedelta(minutes=duration)

    return _success({"slots": slots, "day": day_name})


def _ensure_patient(patient_name, patient_phone=None, gender=None, age=None):
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

    return ensure_patient(
        patient_name=patient_name,
        phone=patient_phone,
        gender=gender,
        age=age,
        user=frappe.session.user if frappe.session.user != "Guest" else None,
    )


def _normalize_appointment_time(value):
    if not value:
        return None
    value = str(value).strip()
    try:
        return str(get_time(value))
    except Exception:
        pass
    for fmt in ("%I:%M %p", "%I:%M%p", "%I:%M:%S %p", "%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).strftime("%H:%M:%S")
        except ValueError:
            continue
    return None


@frappe.whitelist(allow_guest=True)
def book_patient_appointment(
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
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _clinical_ready():
        return _error(_("Clinical module is not installed on this server"))

    patient_name = _parse_request_value("patient_name", patient_name)
    patient_phone = _parse_request_value("patient_phone", patient_phone)
    gender = _parse_request_value("gender", gender)
    practitioner = _parse_request_value("practitioner", practitioner)
    appointment_type = _parse_request_value("appointment_type", appointment_type)
    appointment_date = _parse_request_value("appointment_date", appointment_date)
    appointment_time = _parse_request_value("appointment_time", appointment_time)
    department = _parse_request_value("department", department)
    notes = _parse_request_value("notes", notes)
    payment_method = _parse_request_value("payment_method", payment_method)
    amount = _parse_request_value("amount", amount)

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import normalize_payment_method

    payment_method = normalize_payment_method(payment_method)
    consultation_fee = flt(amount) or consultation_fee_for_type(appointment_type)

    pricing = None
    if frappe.session.user and frappe.session.user != "Guest" and consultation_fee > 0:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase47_complete_care import (
                apply_consult_checkout_pricing,
                persist_consult_membership,
            )

            pricing = apply_consult_checkout_pricing(frappe.session.user, consultation_fee)
            consultation_fee = flt(pricing.get("final_total", consultation_fee))
        except Exception:
            frappe.log_error(title="consult_membership_pricing", message=frappe.get_traceback())

    if not all([patient_name, appointment_type, appointment_date]):
        return _error(_("Patient name, consultation type and date are required"))

    patient = _ensure_patient(patient_name, patient_phone, gender)
    if not patient:
        return _error(_("Health Patient could not be created"))

    company = frappe.defaults.get_global_default("company") or frappe.get_all("Company", limit=1)[0].name
    doc = {
        "doctype": "Doctor Appointment",
        "patient": patient,
        "patient_name": patient_name,
        "consultation_type": appointment_type,
        "appointment_date": getdate(appointment_date),
        "company": company,
        "status": "Scheduled",
        "notes": notes,
        "amount": consultation_fee,
        "razorpay_payment_status": "Pending",
        "payment_method": payment_method,
    }
    if practitioner and frappe.db.exists("Doctor", practitioner):
        doc["doctor"] = practitioner
        doc["doctor_name"] = frappe.db.get_value("Doctor", practitioner, "doctor_name")
    if department:
        doc["department"] = department
    if appointment_time:
        normalized = _normalize_appointment_time(appointment_time)
        if not normalized:
            return _error(_("Invalid appointment time format. Use 24-hour time e.g. 18:06:00"))
        if practitioner:
            slots_resp = get_doctor_schedule_slots(
                doctor=practitioner,
                appointment_date=appointment_date,
                department=department,
            )
            available = {(s.get("time") or "") for s in (slots_resp.get("data") or {}).get("slots", [])}
            if available and normalized not in available:
                return _error(_("Selected time is not available for this doctor"))
        doc["appointment_time"] = normalized

    if pricing:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase47_complete_care import (
                persist_consult_membership,
            )

            persist_consult_membership(doc, pricing)
        except Exception:
            pass

    appointment = frappe.get_doc(doc)
    appointment.insert(ignore_permissions=True)

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import ensure_journey_for_patient

    journey = ensure_journey_for_patient(
        patient,
        status="Doctor Consultation",
        appointment=appointment.name,
    )
    frappe.db.commit()
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_appointment_booked

        notify_appointment_booked(appointment.name)
    except Exception:
        frappe.log_error(title="notify_appointment_booked", message=frappe.get_traceback())
    return _success(
        {
            "appointment_id": appointment.name,
            "status": appointment.status,
            "appointment_date": str(appointment.appointment_date),
            "amount": consultation_fee,
            "payment_method": payment_method,
            "care_journey": journey,
            "membership_discount": flt((pricing or {}).get("membership_discount")),
            "membership_plan_title": (pricing or {}).get("membership_plan_title"),
        },
        message="Appointment booked",
    )


@frappe.whitelist(allow_guest=True)
def cancel_patient_appointment(appointment_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    appointment_id = _parse_request_value("appointment_id", appointment_id)
    if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
        return _error(_("Appointment not found"), 404)
    frappe.db.set_value("Doctor Appointment", appointment_id, "status", "Cancelled", update_modified=True)
    frappe.db.commit()
    return _success({"appointment_id": appointment_id, "status": "Cancelled"})


@frappe.whitelist(allow_guest=True)
def get_my_appointments(patient_phone=None, limit=50, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _clinical_ready():
        return _success({"appointments": []})

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    limit = int(limit or 50)
    order_fields = [
        "name",
        "patient_name",
        "doctor_name as practitioner_name",
        "consultation_type as appointment_type",
        "appointment_date",
        "appointment_time",
        "status",
        "department",
        "amount",
        "razorpay_payment_status",
        "payment_method",
    ]

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

    roles = frappe.get_roles(frappe.session.user)
    if "Franchisee Operator" in roles or is_staff(roles):
        appointments = frappe.get_all(
            "Doctor Appointment",
            fields=order_fields,
            order_by="appointment_date desc",
            limit=limit,
        )
        return _success({"appointments": appointments})

    filters = {}
    profile = patient_profile_for_user()
    if profile and profile.get("patient_id"):
        filters["patient"] = profile["patient_id"]
    else:
        phone = _parse_request_value("patient_phone", patient_phone) or frappe.db.get_value(
            "User", frappe.session.user, "mobile_no"
        )
        if phone:
            patient_ids = frappe.get_all("Health Patient", filters={"mobile": phone}, pluck="name")
            if patient_ids:
                filters["patient"] = ["in", patient_ids]
            else:
                return _success({"appointments": []})
        else:
            return _success({"appointments": []})

    appointments = frappe.get_all(
        "Doctor Appointment",
        filters=filters,
        fields=order_fields,
        order_by="appointment_date desc",
        limit=limit,
    )
    return _success({"appointments": appointments})


# Allied health (Phase 31)
from health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health import (  # noqa: E402
    book_allied_health_appointment,
    get_allied_health_service,
    get_allied_health_services,
    get_allied_health_wings,
    setup_allied_health_masters,
)
