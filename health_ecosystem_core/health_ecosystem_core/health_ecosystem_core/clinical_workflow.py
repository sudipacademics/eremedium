"""Auto-link TRF, appointments, and pharmacy orders to Patient Care Journey."""

import frappe

from health_ecosystem_core.health_ecosystem_core.clinical_journey import (
    JOURNEY_STATES,
    advance_journey,
    ensure_journey_for_patient,
    get_active_journey,
    sync_journey_from_trf,
)


def _journey_index(status):
    try:
        return JOURNEY_STATES.index(status)
    except ValueError:
        return -1


def advance_journey_forward(journey_name, status, **updates):
    """Auto-sync only moves the pipeline forward, never backward."""
    if not journey_name or not status:
        return journey_name
    current = frappe.db.get_value("Patient Care Journey", journey_name, "status")
    if current and _journey_index(status) < _journey_index(current):
        for key, value in updates.items():
            if value:
                frappe.db.set_value("Patient Care Journey", journey_name, key, value, update_modified=True)
        return journey_name
    return advance_journey(journey_name, status, **updates)


def resolve_trf_health_patient(trf):
    """Ensure Customer TRF has health_patient set from phone or demographics."""
    meta = frappe.get_meta("Customer TRF")
    if not meta.has_field("health_patient"):
        return None

    patient_id = trf.get("health_patient")
    if patient_id and frappe.db.exists("Health Patient", patient_id):
        return patient_id

    phone = (trf.get("patient_phone") or "").strip()
    if phone:
        patient_id = frappe.db.get_value("Health Patient", {"mobile": phone}, "name")
        if patient_id:
            frappe.db.set_value("Customer TRF", trf.name, "health_patient", patient_id, update_modified=False)
            return patient_id

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

    patient_id = ensure_patient(
        patient_name=trf.patient_name,
        phone=trf.patient_phone,
        age=trf.age,
        gender=trf.gender,
    )
    if patient_id:
        frappe.db.set_value("Customer TRF", trf.name, "health_patient", patient_id, update_modified=False)
    return patient_id


def on_customer_trf_after_insert(doc, method=None):
    if frappe.flags.in_import:
        return
    patient_id = resolve_trf_health_patient(doc)
    if patient_id:
        sync_journey_from_trf(doc.name, doc.order_status)
    frappe.db.commit()


def on_customer_trf_on_update(doc, method=None):
    if frappe.flags.in_import:
        return
    if doc.has_value_changed("order_status") or doc.has_value_changed("health_patient"):
        patient_id = resolve_trf_health_patient(doc)
        if patient_id or doc.get("care_journey"):
            sync_journey_from_trf(doc.name, doc.order_status)
            frappe.db.commit()


def on_doctor_appointment_after_insert(doc, method=None):
    if not doc.patient or not frappe.db.exists("DocType", "Patient Care Journey"):
        return
    journey = ensure_journey_for_patient(
        doc.patient,
        status="Doctor Consultation",
        appointment=doc.name,
    )
    if journey:
        advance_journey_forward(journey, "Doctor Consultation", appointment=doc.name)
    frappe.db.commit()


def on_pharmacy_order_after_insert(doc, method=None):
    if not frappe.db.exists("DocType", "Patient Care Journey"):
        return
    patient_id = None
    if frappe.get_meta("Pharmacy Order").has_field("health_patient"):
        patient_id = doc.get("health_patient")
    if not patient_id:
        phone = getattr(doc, "customer_phone", None)
        if phone:
            patient_id = frappe.db.get_value("Health Patient", {"mobile": phone}, "name")
    if not patient_id:
        return
    journey = get_active_journey(patient_id) or ensure_journey_for_patient(patient_id)
    if journey:
        advance_journey_forward(journey, "Medicine Ordered", pharmacy_order=doc.name)
    frappe.db.commit()


def on_nursing_assessment_after_insert(doc, method=None):
    if not doc.patient or not frappe.db.exists("DocType", "Patient Care Journey"):
        return
    journey = doc.care_journey or ensure_journey_for_patient(doc.patient, status="Nursing Intake")
    if journey:
        if not doc.care_journey:
            frappe.db.set_value("Nursing Assessment", doc.name, "care_journey", journey, update_modified=False)
        advance_journey_forward(journey, "Nursing Intake")
    frappe.db.commit()


def setup_journey_kanban():
    """Kanban board grouped by journey status for desk workflow."""
    if not frappe.db.exists("DocType", "Patient Care Journey"):
        return
    if frappe.db.exists("Kanban Board", "Patient Care Pipeline"):
        return

    columns = [{"column_name": state, "status": "Active"} for state in JOURNEY_STATES]
    frappe.get_doc(
        {
            "doctype": "Kanban Board",
            "kanban_board_name": "Patient Care Pipeline",
            "reference_doctype": "Patient Care Journey",
            "field_name": "status",
            "private": 0,
            "columns": columns,
        }
    ).insert(ignore_permissions=True)
