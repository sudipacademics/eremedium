"""Transactional patient notifications — email + WhatsApp (Phase 14)."""

import frappe
from frappe import _
from frappe.utils import flt

EVENT_TEMPLATES = {
    "trf_booked": {
        "subject": "Lab test booked — {trf_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "Your diagnostic booking {trf_id} is confirmed.\n"
            "Test: {test_name}\n"
            "Collection: {collection_slot}\n"
            "Payment: {payment_method} ({payment_status})\n"
            "Amount: ₹{amount}\n\n"
            "Track your order in the Health Ecosystem app."
        ),
        "whatsapp": (
            "Lab test booked: {trf_id}. "
            "{test_name}. Slot: {collection_slot}. "
            "Payment: {payment_method}."
        ),
    },
    "payment_success": {
        "subject": "Payment received — {reference}",
        "body": (
            "Hi {patient_name},\n\n"
            "We received ₹{amount} for {reference}.\n"
            "Thank you for your payment."
        ),
        "whatsapp": "Payment of ₹{amount} received for {reference}. Thank you!",
    },
    "report_ready": {
        "subject": "Lab report ready — {journey_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "Your lab report for {trf_id} is authorized and ready.\n"
            "{report_link_line}"
            "Open My orders → Care journey to view and download your NABL PDF."
        ),
        "whatsapp": (
            "Your lab report for {trf_id} is ready."
            "{whatsapp_link_suffix}"
        ),
    },
    "appointment_booked": {
        "subject": "Doctor appointment confirmed",
        "body": (
            "Hi {patient_name},\n\n"
            "Appointment with {doctor_name} on {appointment_date} at {appointment_time}.\n"
            "Type: {appointment_type}\n"
            "Payment: {payment_method}"
        ),
        "whatsapp": (
            "Appointment confirmed: {doctor_name} on {appointment_date} {appointment_time}."
        ),
    },
    "appointment_reminder": {
        "subject": "Reminder: doctor appointment {when}",
        "body": (
            "Hi {patient_name},\n\n"
            "Reminder: your appointment with {doctor_name} is {when}.\n"
            "Date: {appointment_date} at {appointment_time}\n"
            "Please arrive on time or join the teleconsult as instructed."
        ),
        "whatsapp": (
            "Reminder: appointment with {doctor_name} {when} ({appointment_date} {appointment_time})."
        ),
    },
    "collection_reminder": {
        "subject": "Reminder: home sample collection {when}",
        "body": (
            "Hi {patient_name},\n\n"
            "Your home sample collection is scheduled {when}.\n"
            "Slot: {collection_slot}\n"
            "Address: {collection_address}\n"
            "Our phlebotomist will contact you before arrival."
        ),
        "whatsapp": (
            "Home collection reminder {when}. Slot: {collection_slot}. Address: {collection_address}."
        ),
    },
    "phlebo_assigned_patient": {
        "subject": "Phlebotomist assigned for your sample collection",
        "body": (
            "Hi {patient_name},\n\n"
            "A phlebotomist has been assigned for booking {trf_id}.\n"
            "Collection slot: {collection_slot}\n"
            "You will be contacted before the visit."
        ),
        "whatsapp": (
            "Phlebotomist assigned for {trf_id}. Collection: {collection_slot}."
        ),
    },
    "pharmacy_quote_ready": {
        "subject": "Your medicine quote is ready — {order_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "Our pharmacist prepared your {duration_months}-month chronic medicine pack quote.\n"
            "Order: {order_id}\n"
            "Total: ₹{order_total}\n\n"
            "Open My orders on www.e-remedium.in to review and pay."
        ),
        "whatsapp": (
            "Medicine quote ready: {order_id} — ₹{order_total}. "
            "Pay from My orders on e-remedium.in."
        ),
    },
    "prescription_issued": {
        "subject": "New e-prescription from your doctor — {prescription_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "Dr. {doctor_name} issued prescription {prescription_id}.\n"
            "Medicines: {medicine_count} · Lab tests: {diagnostic_count}\n\n"
            "Open Prescriptions on www.e-remedium.in to order medicines and book tests."
        ),
        "whatsapp": (
            "New prescription {prescription_id} from Dr. {doctor_name}. "
            "View at e-remedium.in/prescriptions"
        ),
    },
    "erx_pharmacy_status": {
        "subject": "Medicine order update — {order_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "Your e-prescription medicine order {order_id} is now: {delivery_status}.\n"
            "{notes_line}"
            "Track in My orders on www.e-remedium.in."
        ),
        "whatsapp": (
            "Medicine order {order_id}: {delivery_status}."
            "{whatsapp_notes_suffix}"
        ),
    },
    "erx_pharmacy_ordered": {
        "subject": "Medicine order placed from prescription — {order_id}",
        "body": (
            "Hi {patient_name},\n\n"
            "We received your medicine order {order_id} from prescription {prescription_id}.\n"
            "Total: ₹{order_total}\n"
            "Our pharmacy team will prepare your order shortly."
        ),
        "whatsapp": (
            "Medicine order {order_id} received (₹{order_total}). "
            "Our pharmacy will prepare it soon."
        ),
    },
    "phlebo_assigned_staff": {
        "subject": "New home collection assigned — {trf_id}",
        "body": (
            "New home collection assigned.\n"
            "TRF: {trf_id}\n"
            "Patient: {patient_name} ({patient_phone})\n"
            "Slot: {collection_slot}\n"
            "Address: {collection_address}"
        ),
        "whatsapp": (
            "New collection {trf_id}: {patient_name} at {collection_slot}. {collection_address}"
        ),
    },
    "critical_value_patient": {
        "subject": "Important lab result — {parameter} ({trf_id})",
        "body": (
            "Hi {patient_name},\n\n"
            "Your lab report {trf_id} has an abnormal result that needs attention:\n"
            "{parameter}: {result_value} {unit} ({abnormal_flag})\n"
            "Reference: {reference_range}\n\n"
            "A Remedium clinician may contact you. For urgent symptoms, seek immediate medical care."
        ),
        "whatsapp": (
            "Important lab result on {trf_id}: {parameter} = {result_value} {unit} ({abnormal_flag}). "
            "Reference {reference_range}. Contact Remedium if you need help."
        ),
    },
    "critical_value_staff": {
        "subject": "Abnormal lab alert — {patient_name} / {parameter}",
        "body": (
            "Abnormal lab value detected on report {lab_report}.\n"
            "Patient: {patient_name} ({phone})\n"
            "TRF: {trf_id}\n"
            "{parameter}: {result_value} {unit} — flag {abnormal_flag}\n"
            "Reference: {reference_range}\n\n"
            "Review in ERPNext Lab Critical Value Alert queue."
        ),
        "whatsapp": (
            "Lab alert {trf_id}: {parameter} {result_value} {unit} ({abnormal_flag}) for {patient_name}."
        ),
    },
}


def notifications_enabled():
    settings = frappe.get_single("Health Ecosystem Settings") if frappe.db.exists(
        "DocType", "Health Ecosystem Settings"
    ) else None
    if settings and hasattr(settings, "enable_patient_notifications"):
        return bool(settings.enable_patient_notifications)
    return True


def sms_test_mode():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import sms_test_mode as _mode

    return _mode()


def whatsapp_test_mode():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import whatsapp_test_mode as _mode

    return _mode()


def _format_template(event, context):
    tpl = EVENT_TEMPLATES.get(event, {})
    ctx = {k: ("" if v is None else v) for k, v in (context or {}).items()}
    return {
        "subject": tpl.get("subject", "Health Ecosystem update").format(**ctx),
        "body": tpl.get("body", "").format(**ctx),
        "whatsapp": tpl.get("whatsapp", "").format(**ctx),
    }


def _resolve_email(phone=None, email=None, user=None):
    if email:
        return email
    if user and user != "Guest":
        return frappe.db.get_value("User", user, "email")
    if phone:
        patient = frappe.db.get_value("Health Patient", {"mobile": phone}, ["email", "linked_user"], as_dict=True)
        if patient:
            if patient.email:
                return patient.email
            if patient.linked_user:
                return frappe.db.get_value("User", patient.linked_user, "email")
    return None


def _send_email(recipient, subject, body):
    if not recipient or "@" not in recipient:
        return False
    try:
        frappe.sendmail(
            recipients=[recipient],
            subject=subject,
            message=body.replace("\n", "<br>"),
            now=True,
        )
        return True
    except Exception:
        frappe.log_error(title="Patient notification email", message=frappe.get_traceback())
        return False


def _send_sms(phone, message):
    if not phone:
        return False
    if sms_test_mode():
        frappe.logger("hec_notify").info(f"SMS [{phone}]: {message}")
        return True
    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_msg91_sms

    return send_msg91_sms(phone, message)


def _send_whatsapp(phone, message):
    if not phone:
        return False
    if whatsapp_test_mode():
        frappe.logger("hec_notify").info(f"WhatsApp [{phone}]: {message}")
        return True
    from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import send_gupshup_whatsapp

    return send_gupshup_whatsapp(phone, message)


def _log_notification(event, phone, email, channels, preview):
    frappe.get_doc(
        {
            "doctype": "Comment",
            "comment_type": "Info",
            "reference_doctype": "Health Ecosystem Settings",
            "reference_name": "Health Ecosystem Settings",
            "content": f"[{event}] to {phone or email} via {','.join(channels)} — {preview[:200]}",
        }
    ).insert(ignore_permissions=True)


def dispatch_notification(event, context=None):
    if not notifications_enabled():
        return

    context = context or {}
    phone = context.get("phone") or context.get("patient_phone")
    email = _resolve_email(phone=phone, email=context.get("email"), user=context.get("user"))
    messages = _format_template(event, context)
    channels = []

    if _send_email(email, messages["subject"], messages["body"]):
        channels.append("email")
    if _send_sms(phone, messages["whatsapp"]):
        channels.append("sms")
    if _send_whatsapp(phone, messages["whatsapp"]):
        channels.append("whatsapp")

    if channels:
        try:
            _log_notification(event, phone, email, channels, messages["whatsapp"] or messages["subject"])
        except Exception:
            pass


def queue_patient_notification(event, **context):
    """Enqueue notification after API response (non-blocking)."""
    if not notifications_enabled():
        return
    try:
        frappe.enqueue(
            "health_ecosystem_core.health_ecosystem_core.clinical_notifications.dispatch_notification",
            event=event,
            context=context,
            queue="short",
            timeout=120,
        )
    except Exception:
        dispatch_notification(event, context)


def notify_trf_booked(trf_name):
    trf = frappe.get_doc("Customer TRF", trf_name)
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    tests = get_trf_test_lines(trf_name)
    test_name = ", ".join(t["item_name"] for t in tests) or trf.test_required
    queue_patient_notification(
        "trf_booked",
        patient_name=trf.patient_name,
        phone=trf.patient_phone,
        trf_id=trf.name,
        test_name=test_name,
        collection_slot=str(trf.collection_slot or "TBD"),
        payment_method=getattr(trf, "payment_method", None) or "Online",
        payment_status=trf.razorpay_payment_status or "Pending",
        amount=flt(trf.amount),
    )


def notify_payment_success(reference_doctype, reference_name, amount=None):
    doc = frappe.get_doc(reference_doctype, reference_name)
    patient_name = getattr(doc, "patient_name", None) or getattr(doc, "customer_name", None)
    phone = getattr(doc, "patient_phone", None) or getattr(doc, "customer_phone", None)
    amount = flt(amount or getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    queue_patient_notification(
        "payment_success",
        patient_name=patient_name,
        phone=phone,
        reference=reference_name,
        amount=amount,
    )


def notify_report_ready(journey_id):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import journey_report_payload

    payload = journey_report_payload(journey_id)
    trf_id = payload.get("trf_id")
    phone = _resolve_patient_phone(trf_id=trf_id, patient=payload.get("patient"))

    report_pdf_url = ""
    if payload.get("report_pdf"):
        try:
            report_pdf_url = frappe.utils.get_url(payload["report_pdf"])
        except Exception:
            report_pdf_url = payload["report_pdf"]

    journey_url = ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_email import portal_base_url

        base = (portal_base_url() or "").rstrip("/")
        if base:
            journey_url = f"{base}/journey/{journey_id}"
    except Exception:
        pass

    report_link_line = f"Download PDF: {report_pdf_url}\n" if report_pdf_url else ""
    whatsapp_link_suffix = f" PDF: {report_pdf_url}" if report_pdf_url else " Open My orders in the app."

    queue_patient_notification(
        "report_ready",
        patient_name=payload.get("patient_name"),
        phone=phone,
        journey_id=journey_id,
        trf_id=trf_id,
        report_pdf_url=report_pdf_url,
        journey_url=journey_url,
        report_link_line=report_link_line,
        whatsapp_link_suffix=whatsapp_link_suffix,
    )


def _resolve_patient_phone(trf_id=None, patient=None, phone=None):
    """Best-effort mobile for SMS/WhatsApp from TRF, Health Patient, or explicit phone."""
    if phone:
        return phone
    if trf_id:
        trf = frappe.db.get_value(
            "Customer TRF",
            trf_id,
            ["patient_phone", "patient", "customer_phone"],
            as_dict=True,
        )
        if trf:
            for field in ("patient_phone", "customer_phone"):
                if trf.get(field):
                    return trf[field]
            if trf.patient:
                patient = trf.patient
    if patient:
        mobile = frappe.db.get_value("Health Patient", patient, "mobile")
        if mobile:
            return mobile
    return None


def notify_appointment_booked(appointment_id):
    apt = frappe.get_doc("Doctor Appointment", appointment_id)
    queue_patient_notification(
        "appointment_booked",
        patient_name=apt.patient_name,
        phone=frappe.db.get_value("Health Patient", apt.patient, "mobile") if apt.patient else None,
        doctor_name=apt.doctor_name or "Doctor",
        appointment_date=str(apt.appointment_date),
        appointment_time=str(apt.appointment_time or ""),
        appointment_type=apt.consultation_type,
        payment_method=getattr(apt, "payment_method", None) or "Online",
    )


def _reminder_when_label(reminder_type):
    return "in about 24 hours" if reminder_type == "day" else "in about 2 hours"


def notify_appointment_reminder(
    appointment_id,
    reminder_type="day",
    patient_name=None,
    phone=None,
    doctor_name=None,
    appointment_date=None,
    appointment_time=None,
):
    when = _reminder_when_label(reminder_type)
    queue_patient_notification(
        "appointment_reminder",
        patient_name=patient_name or "Patient",
        phone=phone,
        doctor_name=doctor_name or "Doctor",
        appointment_date=appointment_date or "",
        appointment_time=appointment_time or "",
        when=when,
    )


def notify_collection_reminder(
    trf_id,
    reminder_type="day",
    patient_name=None,
    phone=None,
    collection_slot=None,
    collection_address=None,
):
    when = _reminder_when_label(reminder_type)
    queue_patient_notification(
        "collection_reminder",
        patient_name=patient_name or "Patient",
        phone=phone,
        collection_slot=collection_slot or "",
        collection_address=collection_address or "",
        when=when,
        trf_id=trf_id,
    )


def notify_phlebotomist_assigned(trf_id, phlebotomist_user):
    trf = frappe.get_doc("Customer TRF", trf_id)
    queue_patient_notification(
        "phlebo_assigned_patient",
        patient_name=trf.patient_name,
        phone=trf.patient_phone,
        trf_id=trf_id,
        collection_slot=str(trf.collection_slot or "TBD"),
    )
    phlebo_phone = frappe.db.get_value("User", phlebotomist_user, "mobile_no")
    phlebo_email = frappe.db.get_value("User", phlebotomist_user, "email")
    dispatch_notification(
        "phlebo_assigned_staff",
        context={
            "phone": phlebo_phone,
            "email": phlebo_email,
            "user": phlebotomist_user,
            "trf_id": trf_id,
            "patient_name": trf.patient_name,
            "patient_phone": trf.patient_phone,
            "collection_slot": str(trf.collection_slot or "TBD"),
            "collection_address": trf.collection_address or "",
        },
    )


def notify_prescription_issued(prescription_id):
    if not frappe.db.exists("Clinical Prescription", prescription_id):
        return
    rx = frappe.get_doc("Clinical Prescription", prescription_id)
    phone = frappe.db.get_value("Health Patient", rx.patient, "mobile") if rx.patient else None
    doctor_name = frappe.db.get_value("Doctor", rx.doctor, "doctor_name") if rx.doctor else "Doctor"
    queue_patient_notification(
        "prescription_issued",
        patient_name=rx.patient_name,
        phone=phone,
        prescription_id=rx.name,
        doctor_name=doctor_name or rx.doctor,
        medicine_count=len(rx.medicines or []),
        diagnostic_count=len(rx.diagnostics or []),
    )


def notify_erx_pharmacy_ordered(order_id, prescription_id=None):
    if not frappe.db.exists("Pharmacy Order", order_id):
        return
    order = frappe.get_doc("Pharmacy Order", order_id)
    rx_id = prescription_id or getattr(order, "clinical_prescription", None)
    queue_patient_notification(
        "erx_pharmacy_ordered",
        patient_name=order.customer_name,
        phone=order.customer_phone,
        order_id=order.name,
        prescription_id=rx_id or "",
        order_total=order.order_total,
    )


def notify_erx_pharmacy_status(order_id):
    if not frappe.db.exists("Pharmacy Order", order_id):
        return
    order = frappe.get_doc("Pharmacy Order", order_id)
    notes = getattr(order, "pharmacist_notes", None) or ""
    notes_line = f"Note: {notes}\n\n" if notes else ""
    whatsapp_notes_suffix = f" {notes}" if notes else ""
    queue_patient_notification(
        "erx_pharmacy_status",
        patient_name=order.customer_name,
        phone=order.customer_phone,
        order_id=order.name,
        delivery_status=order.delivery_status,
        notes_line=notes_line,
        whatsapp_notes_suffix=whatsapp_notes_suffix,
    )


def notify_critical_lab_values(lab_report_name, journey_id=None, alert_names=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase53_critical_alerts import (
        _resolve_report_context,
    )

    lab_report, trf, patient, patient_name, phone, journey_id = _resolve_report_context(
        lab_report_name, journey_id
    )
    alert_names = alert_names or frappe.get_all(
        "Lab Critical Value Alert",
        filters={"lab_report": lab_report.name, "alert_status": "Open"},
        pluck="name",
    )
    if not alert_names:
        return

    staff_email = None
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        settings = frappe.get_single("Health Ecosystem Settings")
        staff_email = getattr(settings, "support_email", None) or getattr(settings, "noreply_email", None)

    summary_parts = []
    primary = None
    for alert_name in alert_names[:8]:
        alert = frappe.get_doc("Lab Critical Value Alert", alert_name)
        if not primary:
            primary = alert
        summary_parts.append(
            f"{alert.parameter}: {alert.result_value} {alert.unit or ''} ({alert.abnormal_flag})"
        )

    if primary and phone and not primary.notified_patient:
        combined = "; ".join(summary_parts)
        queue_patient_notification(
            "critical_value_patient",
            patient_name=patient_name,
            phone=phone,
            trf_id=trf or lab_report.name,
            parameter="Abnormal result(s)" if len(summary_parts) > 1 else primary.parameter,
            result_value=combined[:220] if len(summary_parts) > 1 else primary.result_value,
            unit=primary.unit or "",
            abnormal_flag=primary.abnormal_flag,
            reference_range=primary.reference_range or "",
        )
        for alert_name in alert_names:
            frappe.db.set_value("Lab Critical Value Alert", alert_name, "notified_patient", 1)

    if primary and staff_email and not primary.notified_staff:
        dispatch_notification(
            "critical_value_staff",
            context={
                "email": staff_email,
                "patient_name": patient_name or "Patient",
                "phone": phone or "",
                "trf_id": trf or "",
                "lab_report": lab_report.name,
                "parameter": primary.parameter if len(summary_parts) == 1 else "Multiple",
                "result_value": "; ".join(summary_parts)[:220],
                "unit": primary.unit or "",
                "abnormal_flag": primary.abnormal_flag,
                "reference_range": primary.reference_range or "",
            },
        )
        for alert_name in alert_names:
            frappe.db.set_value("Lab Critical Value Alert", alert_name, "notified_staff", 1)
    frappe.db.commit()


def smoke_test_notifications():
    """Bench execute smoke test — logs in test mode, sends via MSG91/Gupshup when configured."""
    dispatch_notification(
        "payment_success",
        context={
            "phone": "9876543210",
            "patient_name": "Notification Smoke",
            "reference": "SMOKE-TEST",
            "amount": 100,
        },
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import integration_status_payload

    return {
        "ok": True,
        "notifications_enabled": notifications_enabled(),
        "integration": integration_status_payload().get("notifications"),
    }
