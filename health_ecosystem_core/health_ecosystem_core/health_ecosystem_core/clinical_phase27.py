"""Phase 27 — Scheduled reminders: appointments, home collection, phlebo assignment."""

from __future__ import annotations

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, getdate, now_datetime, today


REMINDER_WINDOWS = (
    ("day", 24, 23, 25),
    ("hour", 2, 1.5, 2.5),
)


def ensure_phase27_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "hec_reminder_day_sent",
                    "label": "24h Reminder Sent",
                    "fieldtype": "Check",
                    "insert_after": "collection_slot",
                },
                {
                    "fieldname": "hec_reminder_hour_sent",
                    "label": "2h Reminder Sent",
                    "fieldtype": "Check",
                    "insert_after": "hec_reminder_day_sent",
                },
            ],
            "Doctor Appointment": [
                {
                    "fieldname": "hec_reminder_day_sent",
                    "label": "24h Reminder Sent",
                    "fieldtype": "Check",
                    "insert_after": "appointment_time",
                },
                {
                    "fieldname": "hec_reminder_hour_sent",
                    "label": "2h Reminder Sent",
                    "fieldtype": "Check",
                    "insert_after": "hec_reminder_day_sent",
                },
            ],
        },
        update=True,
    )


def _hours_until(target_dt):
    if not target_dt:
        return None
    try:
        target = get_datetime(target_dt)
    except Exception:
        return None
    if not target:
        return None
    delta = target - now_datetime()
    return delta.total_seconds() / 3600.0


def _in_window(hours_until, low, high):
    if hours_until is None:
        return False
    return low <= hours_until <= high


def _appointment_datetime(row):
    if not row.get("appointment_date"):
        return None
    date_part = str(row.appointment_date)
    time_part = str(row.appointment_time or "09:00:00")
    if len(time_part) == 5:
        time_part = f"{time_part}:00"
    return f"{date_part} {time_part}"


def _mark_reminder(doctype, name, fieldname):
    meta = frappe.get_meta(doctype)
    if meta.has_field(fieldname):
        frappe.db.set_value(doctype, name, fieldname, 1, update_modified=False)


def send_appointment_reminders():
    if not frappe.db.exists("DocType", "Doctor Appointment"):
        return {"appointments": 0}

    sent = 0
    rows = frappe.get_all(
        "Doctor Appointment",
        filters={
            "status": ("in", ["Scheduled", "Confirmed", "Open", "Booked"]),
            "appointment_date": (">=", today()),
        },
        fields=[
            "name",
            "patient_name",
            "patient",
            "doctor_name",
            "appointment_date",
            "appointment_time",
            "consultation_type",
            "hec_reminder_day_sent",
            "hec_reminder_hour_sent",
        ],
        limit=200,
    )

    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        notify_appointment_reminder,
    )

    for row in rows:
        hours = _hours_until(_appointment_datetime(row))
        for kind, _, low, high in REMINDER_WINDOWS:
            flag = f"hec_reminder_{kind}_sent"
            if getattr(row, flag, 0):
                continue
            if not _in_window(hours, low, high):
                continue
            phone = None
            if row.patient:
                phone = frappe.db.get_value("Health Patient", row.patient, "mobile")
            notify_appointment_reminder(
                row.name,
                reminder_type=kind,
                patient_name=row.patient_name,
                phone=phone,
                doctor_name=row.doctor_name,
                appointment_date=str(row.appointment_date),
                appointment_time=str(row.appointment_time or ""),
            )
            _mark_reminder("Doctor Appointment", row.name, flag)
            sent += 1
    if sent:
        frappe.db.commit()
    return {"appointments": sent}


def send_collection_reminders():
    sent = 0
    meta = frappe.get_meta("Customer TRF")
    if not meta.has_field("collection_slot"):
        return {"collections": 0}

    fields = [
        "name",
        "patient_name",
        "patient_phone",
        "collection_slot",
        "collection_address",
        "order_status",
    ]
    if meta.has_field("hec_reminder_day_sent"):
        fields.extend(["hec_reminder_day_sent", "hec_reminder_hour_sent"])

    rows = frappe.get_all(
        "Customer TRF",
        filters={
            "order_status": ("in", ["Booked", "Scheduled"]),
            "collection_slot": (">=", now_datetime()),
        },
        fields=fields,
        limit=200,
    )

    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        notify_collection_reminder,
    )

    for row in rows:
        hours = _hours_until(row.collection_slot)
        for kind, _, low, high in REMINDER_WINDOWS:
            flag = f"hec_reminder_{kind}_sent"
            if meta.has_field(flag) and getattr(row, flag, 0):
                continue
            if not _in_window(hours, low, high):
                continue
            notify_collection_reminder(
                row.name,
                reminder_type=kind,
                patient_name=row.patient_name,
                phone=row.patient_phone,
                collection_slot=str(row.collection_slot),
                collection_address=row.collection_address or "",
            )
            if meta.has_field(flag):
                _mark_reminder("Customer TRF", row.name, flag)
            sent += 1
    if sent:
        frappe.db.commit()
    return {"collections": sent}


def notify_phlebo_assignment(trf_name, phlebotomist_user):
    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        notify_phlebotomist_assigned,
    )

    notify_phlebotomist_assigned(trf_name, phlebotomist_user)


def run_hourly_reminders():
    """Frappe scheduler entry — hourly cron."""
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return {"skipped": True}
    settings = frappe.get_single("Health Ecosystem Settings")
    if hasattr(settings, "enable_scheduled_reminders") and not settings.enable_scheduled_reminders:
        return {"skipped": True, "reason": "disabled"}

    appt = send_appointment_reminders()
    coll = send_collection_reminders()
    return {"ok": True, "phase": 27, **appt, **coll}


def smoke_scheduled_reminders():
    """Dry-run reminder templates (test mode logs only)."""
    ensure_phase27_custom_fields()
    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        dispatch_notification,
        notify_appointment_reminder,
        notify_collection_reminder,
    )

    notify_appointment_reminder(
        "SMOKE-APT",
        reminder_type="hour",
        patient_name="Smoke Patient",
        phone="9876543210",
        doctor_name="Dr Smoke",
        appointment_date=str(today()),
        appointment_time="10:00:00",
    )
    notify_collection_reminder(
        "SMOKE-TRF",
        reminder_type="day",
        patient_name="Smoke Patient",
        phone="9876543210",
        collection_slot=str(add_to_date(now_datetime(), hours=24)),
        collection_address="Test address",
    )
    dispatch_notification(
        "phlebo_assigned_patient",
        context={
            "phone": "9876543210",
            "patient_name": "Smoke Patient",
            "trf_id": "SMOKE-TRF",
            "collection_slot": "Tomorrow 10:00",
        },
    )
    dispatch_notification(
        "phlebo_assigned_staff",
        context={
            "phone": "9876543211",
            "email": "phlebotomist@health.local",
            "user": "phlebotomist@health.local",
            "trf_id": "SMOKE-TRF",
            "patient_name": "Smoke Patient",
            "patient_phone": "9876543210",
            "collection_slot": "Tomorrow 10:00",
            "collection_address": "Test address",
        },
    )
    return {"ok": True, "phase": 27, "smoke": "dispatched"}


def setup_phase27():
    ensure_phase27_custom_fields()
    _ensure_settings_flag()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 27}


def _ensure_settings_flag():
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "enable_scheduled_reminders",
                    "label": "Enable Scheduled Reminders",
                    "fieldtype": "Check",
                    "default": "1",
                    "insert_after": "enable_patient_notifications",
                },
            ],
        },
        update=True,
    )
    settings = frappe.get_single("Health Ecosystem Settings")
    if hasattr(settings, "enable_scheduled_reminders") and not settings.enable_scheduled_reminders:
        settings.enable_scheduled_reminders = 1
        settings.save(ignore_permissions=True)
