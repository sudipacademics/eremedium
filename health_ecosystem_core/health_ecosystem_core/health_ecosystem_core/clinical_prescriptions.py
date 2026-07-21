"""Clinical prescription and therapeutic template APIs."""

import json

import frappe
from frappe import _
from frappe.utils import getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _is_staff_user,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_journey import advance_journey, ensure_journey_for_patient
from health_ecosystem_core.health_ecosystem_core.doctype.clinical_prescription.clinical_prescription import (
    _resolve_salt,
)


def _clinical_ready():
    return frappe.db.exists("DocType", "Clinical Prescription")


@frappe.whitelist(allow_guest=True)
def get_therapeutic_templates(department=None):
    if not frappe.db.exists("DocType", "Therapeutic Template"):
        return _success({"templates": []})
    department = (_parse_request_value("department", department) or "").strip()
    filters = {}
    if department:
        filters["department"] = department
    templates = frappe.get_all(
        "Therapeutic Template",
        filters=filters,
        fields=["name", "template_name", "department", "description"],
        order_by="template_name asc",
        limit=100,
    )
    return _success({"templates": templates})


@frappe.whitelist(allow_guest=True)
def get_therapeutic_template(template_name=None):
    template_name = _parse_request_value("template_name", template_name)
    if not template_name or not frappe.db.exists("Therapeutic Template", template_name):
        return _error(_("Template not found"), 404)
    doc = frappe.get_doc("Therapeutic Template", template_name)
    medicines = [
        {
            "medicine_item": row.medicine_item,
            "item_name": frappe.db.get_value("Item", row.medicine_item, "item_name"),
            "dosage": row.dosage,
            "duration": row.duration,
            "frequency": row.frequency,
            "instructions": row.instructions,
            "salt": _resolve_salt(row.medicine_item),
        }
        for row in (doc.medicines or [])
    ]
    return _success(
        {
            "template": {
                "name": doc.name,
                "template_name": doc.template_name,
                "department": doc.department,
                "description": doc.description,
                "medicines": medicines,
            }
        }
    )


def _parse_lines(value, default=None):
    if value is None:
        return default or []
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default or []
    return value


@frappe.whitelist()
def create_clinical_prescription(
    patient=None,
    doctor=None,
    department=None,
    therapeutic_template=None,
    diagnosis=None,
    clinical_notes=None,
    medicines=None,
    diagnostics=None,
    care_journey=None,
):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _clinical_ready():
        return _error(_("Clinical prescription module not available"))
    if "Physician" not in frappe.get_roles() and not _is_staff_user():
        return _error(_("Only physicians can write prescriptions"), 403)

    patient = _parse_request_value("patient", patient)
    doctor = _parse_request_value("doctor", doctor)
    if not patient or not doctor:
        return _error(_("Patient and doctor are required"))

    medicines = _parse_lines(medicines)
    diagnostics = _parse_lines(diagnostics)

    if therapeutic_template and not medicines:
        tpl = frappe.get_doc("Therapeutic Template", therapeutic_template)
        medicines = [
            {
                "medicine_item": row.medicine_item,
                "dosage": row.dosage,
                "duration": row.duration,
                "frequency": row.frequency,
                "instructions": row.instructions,
            }
            for row in (tpl.medicines or [])
        ]

    care_journey = _parse_request_value("care_journey", care_journey) or ensure_journey_for_patient(
        patient, status="Doctor Consultation"
    )

    doc = frappe.get_doc(
        {
            "doctype": "Clinical Prescription",
            "patient": patient,
            "doctor": doctor,
            "department": _parse_request_value("department", department),
            "therapeutic_template": _parse_request_value("therapeutic_template", therapeutic_template),
            "diagnosis": _parse_request_value("diagnosis", diagnosis),
            "clinical_notes": _parse_request_value("clinical_notes", clinical_notes),
            "encounter_date": today(),
            "status": "Draft",
            "care_journey": care_journey,
            "medicines": medicines,
            "diagnostics": diagnostics,
        }
    )
    doc.insert(ignore_permissions=True)
    if care_journey:
        advance_journey(care_journey, "Prescription Issued", prescription=doc.name)
    frappe.db.commit()
    return _success({"prescription_id": doc.name, "care_journey": care_journey})


@frappe.whitelist()
def submit_clinical_prescription(prescription_id=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    prescription_id = _parse_request_value("prescription_id", prescription_id)
    if not prescription_id or not frappe.db.exists("Clinical Prescription", prescription_id):
        return _error(_("Prescription not found"), 404)
    doc = frappe.get_doc("Clinical Prescription", prescription_id)
    doc.status = "Submitted"
    doc.save(ignore_permissions=True)
    if doc.care_journey:
        advance_journey(doc.care_journey, "Prescription Issued", prescription=doc.name)
    frappe.db.commit()
    return _success({"prescription_id": doc.name, "status": doc.status})


@frappe.whitelist(allow_guest=True)
def get_clinical_prescription(prescription_id=None, sid=None):
    if not _require_mobile_auth(sid) and frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    prescription_id = _parse_request_value("prescription_id", prescription_id)
    if not prescription_id:
        return _error(_("Prescription ID is required"))
    if not frappe.db.exists("Clinical Prescription", prescription_id):
        return _error(_("Prescription not found"), 404)
    doc = frappe.get_doc("Clinical Prescription", prescription_id)
    return _success(
        {
            "prescription": {
                "name": doc.name,
                "patient": doc.patient,
                "patient_name": doc.patient_name,
                "doctor": doc.doctor,
                "department": doc.department,
                "status": doc.status,
                "diagnosis": doc.diagnosis,
                "clinical_notes": doc.clinical_notes,
                "encounter_date": str(doc.encounter_date),
                "care_journey": doc.care_journey,
                "medicines": [
                    {
                        "medicine_item": row.medicine_item,
                        "salt": row.salt or _resolve_salt(row.medicine_item),
                        "dosage": row.dosage,
                        "duration": row.duration,
                        "frequency": row.frequency,
                        "route": row.route,
                        "instructions": row.instructions,
                    }
                    for row in (doc.medicines or [])
                ],
                "diagnostics": [
                    {
                        "diagnostic_test": row.diagnostic_test,
                        "test_name": frappe.db.get_value(
                            "Diagnostic Test Master", row.diagnostic_test, "test_name"
                        )
                        if row.diagnostic_test
                        else None,
                        "item": row.item,
                        "item_name": frappe.db.get_value("Item", row.item, "item_name") if row.item else None,
                        "notes": row.notes,
                    }
                    for row in (doc.diagnostics or [])
                ],
            }
        }
    )


@frappe.whitelist(allow_guest=True)
def list_clinical_prescriptions(patient=None, limit=50, sid=None):
    if not _require_mobile_auth(sid) and frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    patient = _parse_request_value("patient", patient)
    if not patient:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

        profile = patient_profile_for_user()
        patient = profile.get("patient_id") if profile else None
    if not patient:
        return _success({"prescriptions": []})
    rows = frappe.get_all(
        "Clinical Prescription",
        filters={"patient": patient},
        fields=["name", "doctor", "department", "status", "encounter_date", "diagnosis"],
        order_by="encounter_date desc",
        limit=int(limit or 50),
    )
    return _success({"prescriptions": rows})


@frappe.whitelist(allow_guest=True)
def create_pharmacy_order_from_prescription(
    prescription_id=None,
    delivery_address=None,
    customer_phone=None,
    sid=None,
):
    """Create Pharmacy Order lines from a submitted clinical prescription."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    prescription_id = _parse_request_value("prescription_id", prescription_id)
    if not prescription_id or not frappe.db.exists("Clinical Prescription", prescription_id):
        return _error(_("Prescription not found"), 404)

    rx = frappe.get_doc("Clinical Prescription", prescription_id)
    if not rx.medicines:
        return _error(_("Prescription has no medicines"))

    items_json = []
    total = 0
    from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

    for row in rx.medicines:
        rate = _resolve_selling_rate(row.medicine_item)
        total += rate
        items_json.append(
            {
                "item_code": row.medicine_item,
                "qty": 1,
                "rate": rate,
                "dosage": row.dosage,
                "duration": row.duration,
                "frequency": row.frequency,
                "salt": row.salt,
            }
        )

    from health_ecosystem_core.health_ecosystem_core.api import create_pharmacy_order

    result = create_pharmacy_order(
        customer_name=rx.patient_name,
        delivery_address=delivery_address or "OPD Counter",
        uploaded_prescription_url=f"/app/clinical-prescription/{rx.name}",
        order_total=total,
        customer_phone=customer_phone,
        items_json=json.dumps(items_json),
        sid=sid,
    )
    if result.get("status") == "success" and rx.care_journey:
        order_id = (result.get("data") or {}).get("order_id")
        if order_id:
            advance_journey(rx.care_journey, "Medicine Ordered", pharmacy_order=order_id)
            try:
                from health_ecosystem_core.health_ecosystem_core.clinical_phase50_erx_fulfillment import (
                    link_pharmacy_order_to_prescription,
                )

                link_pharmacy_order_to_prescription(order_id, rx.name)
            except Exception:
                pass
            try:
                from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
                    notify_erx_pharmacy_ordered,
                )

                notify_erx_pharmacy_ordered(order_id, rx.name)
            except Exception:
                pass
            frappe.db.commit()
    return result
