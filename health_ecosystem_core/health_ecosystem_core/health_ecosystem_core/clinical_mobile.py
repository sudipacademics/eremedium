"""Mobile-friendly clinical API bundle for Flutter / patient app."""

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)


@frappe.whitelist(allow_guest=True)
def get_clinical_home(sid=None):
    """Single call for departments, consultation types, journey, and catalog."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.appointments import (
        get_appointment_types,
        get_healthcare_departments,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_diagnostics import get_diagnostic_catalog
    from health_ecosystem_core.health_ecosystem_core.clinical_journey import get_patient_journey
    from health_ecosystem_core.health_ecosystem_core.clinical_prescriptions import list_clinical_prescriptions

    departments = (get_healthcare_departments() or {}).get("data") or {}
    types = (get_appointment_types() or {}).get("data") or {}
    journey = (get_patient_journey(sid=sid) or {}).get("data") or {}
    catalog = (get_diagnostic_catalog() or {}).get("data") or {}
    prescriptions = (list_clinical_prescriptions(sid=sid, limit=5) or {}).get("data") or {}

    return _success(
        {
            "departments": departments.get("departments") or [],
            "appointment_types": types.get("types") or [],
            "journey": journey.get("journey"),
            "diagnostic_catalog": catalog.get("catalog") or [],
            "recent_prescriptions": prescriptions.get("prescriptions") or [],
        }
    )


@frappe.whitelist(allow_guest=True)
def get_doctor_availability(doctor=None, appointment_date=None, department=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.appointments import get_doctor_schedule_slots

    doctor = _parse_request_value("doctor", doctor)
    appointment_date = _parse_request_value("appointment_date", appointment_date)
    department = _parse_request_value("department", department)
    return get_doctor_schedule_slots(
        doctor=doctor,
        appointment_date=appointment_date,
        department=department,
    )
