"""Diagnostic test masters, workup ordering, and catalog APIs."""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _is_staff_user,
    _parse_request_value,
    _require_mobile_auth,
    _resolve_selling_rate,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_journey import advance_journey, ensure_journey_for_patient
from health_ecosystem_core.health_ecosystem_core.clinical_utils import create_customer_trf_booking


@frappe.whitelist(allow_guest=True)
def get_diagnostic_test_masters(department=None):
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return _success({"tests": []})
    department = (_parse_request_value("department", department) or "").strip()
    filters = {}
    if department:
        filters["department"] = department
    if frappe.get_meta("Diagnostic Test Master").has_field("disabled"):
        filters["disabled"] = 0
    tests = frappe.get_all(
        "Diagnostic Test Master",
        filters=filters,
        fields=["name", "test_name", "department", "item", "lis_code", "description"],
        order_by="test_name asc",
        limit=200,
    )
    return _success({"tests": tests})


@frappe.whitelist(allow_guest=True)
def get_diagnostic_test_master(test_name=None):
    test_name = _parse_request_value("test_name", test_name)
    if not test_name or not frappe.db.exists("Diagnostic Test Master", test_name):
        return _error(_("Diagnostic test not found"), 404)
    doc = frappe.get_doc("Diagnostic Test Master", test_name)
    if getattr(doc, "disabled", 0):
        return _error(_("Diagnostic test is disabled"), 404)
    return _success(
        {
            "test": {
                "name": doc.name,
                "test_name": doc.test_name,
                "department": doc.department,
                "item": doc.item,
                "lis_code": doc.lis_code,
                "description": doc.description,
                "disabled": cint(getattr(doc, "disabled", 0)),
                "parameters": [
                    {
                        "parameter_code": row.parameter_code,
                        "parameter_name": row.parameter_name,
                        "unit": row.unit,
                        "normal_min": row.normal_min,
                        "normal_max": row.normal_max,
                        "is_calculated": cint(row.is_calculated),
                        "description": row.description,
                    }
                    for row in (doc.parameters or [])
                ],
            }
        }
    )


@frappe.whitelist(allow_guest=True)
def get_diagnostic_catalog(department=None):
    """Mobile-friendly catalog merging Diagnostic Test Master with ERP Items."""
    masters = []
    if frappe.db.exists("DocType", "Diagnostic Test Master"):
        department = (_parse_request_value("department", department) or "").strip()
        filters = {}
        if department:
            filters["department"] = department
        if frappe.get_meta("Diagnostic Test Master").has_field("disabled"):
            filters["disabled"] = 0
        for row in frappe.get_all(
            "Diagnostic Test Master",
            filters=filters,
            fields=["name", "test_name", "department", "item", "lis_code"],
            order_by="test_name asc",
            limit=200,
        ):
            item_code = row.item
            masters.append(
                {
                    "test_master": row.name,
                    "test_name": row.test_name,
                    "department": row.department,
                    "item_code": item_code,
                    "item_name": frappe.db.get_value("Item", item_code, "item_name") if item_code else row.test_name,
                    "rate": _resolve_selling_rate(item_code) if item_code else 0,
                    "lis_code": row.lis_code,
                }
            )
    if masters:
        return _success({"catalog": masters})

    from health_ecosystem_core.health_ecosystem_core.api import get_lab_test_catalog

    return get_lab_test_catalog()


@frappe.whitelist()
def order_diagnostics_from_prescription(
    prescription_id=None,
    franchisee_id=None,
    collection_address=None,
    collection_slot=None,
    sid=None,
):
    """Create Customer TRF per prescribed diagnostic test."""
    if not _require_mobile_auth(sid) and frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)

    prescription_id = _parse_request_value("prescription_id", prescription_id)
    franchisee_id = _parse_request_value("franchisee_id", franchisee_id)
    if not prescription_id or not franchisee_id:
        return _error(_("Prescription ID and franchisee are required"))
    if not frappe.db.exists("Clinical Prescription", prescription_id):
        return _error(_("Prescription not found"), 404)

    rx = frappe.get_doc("Clinical Prescription", prescription_id)
    if not rx.diagnostics:
        return _error(_("No diagnostics on this prescription"))

    patient = frappe.get_doc("Health Patient", rx.patient)
    age = patient.age
    if not age and patient.dob:
        from frappe.utils import date_diff, today

        age = int(date_diff(today(), patient.dob) / 365)

    created = []
    journey = rx.care_journey or ensure_journey_for_patient(rx.patient, status="Diagnostics Booked")

    test_items = []
    for row in rx.diagnostics:
        item_code = row.item
        if not item_code and row.diagnostic_test:
            item_code = frappe.db.get_value("Diagnostic Test Master", row.diagnostic_test, "item")
        if item_code:
            test_items.append({"item_code": item_code})

    if not test_items:
        return _error(_("No billable diagnostics on this prescription"))

    result = create_customer_trf_booking(
        patient_name=patient.patient_name,
        age=age or 30,
        gender=patient.gender or "Male",
        test_items=test_items,
        franchisee_id=franchisee_id,
        patient_phone=patient.mobile,
        collection_address=_parse_request_value("collection_address", collection_address),
        collection_slot=_parse_request_value("collection_slot", collection_slot),
    )
    if result.get("success"):
        data = result.get("data") or {}
        trf_id = data.get("trf_id")
        if trf_id and journey:
            frappe.db.set_value("Customer TRF", trf_id, "care_journey", journey, update_modified=False)
        created.append(data)

    if journey:
        advance_journey(journey, "Diagnostics Booked", prescription=rx.name)
    frappe.db.commit()
    return _success({"trfs": created, "care_journey": journey}, message=f"{len(created)} diagnostic order(s) created")


@frappe.whitelist()
def assign_phlebotomist(journey_id=None, phlebotomist=None, trf_id=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _is_staff_user():
        return _error(_("Not authorized"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    phlebotomist = _parse_request_value("phlebotomist", phlebotomist)
    trf_id = _parse_request_value("trf_id", trf_id)
    if not phlebotomist:
        return _error(_("Phlebotomist user is required"))

    if not journey_id and trf_id:
        journey_id = frappe.db.get_value("Customer TRF", trf_id, "care_journey")
    if not journey_id:
        return _error(_("Journey ID is required"))

    advance_journey(journey_id, "Phlebotomist Assigned", phlebotomist=phlebotomist)
    frappe.db.commit()
    return _success({"journey_id": journey_id, "phlebotomist": phlebotomist})


def _panel_test_items(panel_id):
    if not panel_id or not frappe.db.exists("Lab Test Panel", panel_id):
        return []
    doc = frappe.get_doc("Lab Test Panel", panel_id)
    if not doc.is_active:
        return []
    return [{"item_code": row.item} for row in (doc.tests or []) if row.item]


@frappe.whitelist(allow_guest=True)
def get_lab_test_panels():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import panel_catalog_payload

    return _success({"panels": panel_catalog_payload()})


@frappe.whitelist(allow_guest=True)
def book_lab_panel(
    panel_id=None,
    patient_name=None,
    age=None,
    gender=None,
    franchisee_id=None,
    patient_phone=None,
    collection_address=None,
    collection_slot=None,
    payment_method=None,
    promo_code=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    panel_id = _parse_request_value("panel_id", panel_id)
    test_items = _panel_test_items(panel_id)
    if not test_items:
        return _error(_("Lab panel not found"), 404)
    panel_rate = flt(frappe.db.get_value("Lab Test Panel", panel_id, "panel_rate"))
    return create_customer_trf_booking(
        patient_name=_parse_request_value("patient_name", patient_name),
        age=_parse_request_value("age", age),
        gender=_parse_request_value("gender", gender),
        test_items=test_items,
        franchisee_id=_parse_request_value("franchisee_id", franchisee_id),
        patient_phone=_parse_request_value("patient_phone", patient_phone),
        collection_address=_parse_request_value("collection_address", collection_address),
        collection_slot=_parse_request_value("collection_slot", collection_slot),
        amount=panel_rate or None,
        payment_method=_parse_request_value("payment_method", payment_method),
        promo_code=_parse_request_value("promo_code", promo_code),
    )
