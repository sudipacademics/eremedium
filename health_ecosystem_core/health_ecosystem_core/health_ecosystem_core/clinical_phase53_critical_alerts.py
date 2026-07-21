"""Phase 53D — Critical / abnormal lab value alerts with SMS, WhatsApp & email."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
    abnormal_flag_for_lab_row,
    is_alert_worthy_flag,
)


def critical_alerts_enabled():
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return True
    settings = frappe.get_single("Health Ecosystem Settings")
    if hasattr(settings, "enable_critical_value_alerts"):
        return bool(settings.enable_critical_value_alerts)
    return True


def alert_level_filter():
    """Critical Only | All Abnormal"""
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return "All Abnormal"
    return getattr(frappe.get_single("Health Ecosystem Settings"), "critical_alert_level", None) or "All Abnormal"


def _flag_matches_alert_policy(flag):
    flag = (flag or "").upper()
    if alert_level_filter() == "Critical Only":
        return flag == "CRITICAL"
    return flag in ("H", "L", "CRITICAL", "HIGH", "LOW")


def _reference_label(lower, upper):
    if lower is not None and upper is not None:
        return f"{flt(lower):g} - {flt(upper):g}"
    if lower is not None:
        return f"> {flt(lower):g}"
    if upper is not None:
        return f"< {flt(upper):g}"
    return ""


def scan_lab_report_alerts(lab_report):
    if isinstance(lab_report, str):
        lab_report = frappe.get_doc("Lab Report", lab_report)
    alerts = []
    for row in lab_report.parameters or []:
        if row.result_value in (None, ""):
            continue
        flag = row.abnormal_flag or abnormal_flag_for_lab_row(row)
        if not flag or not _flag_matches_alert_policy(flag):
            continue
        if not is_alert_worthy_flag(flag):
            continue
        alerts.append(
            {
                "parameter": row.description,
                "result_value": str(row.result_value),
                "unit": row.unit or "",
                "abnormal_flag": flag if flag != "Critical" else "Critical",
                "reference_range": _reference_label(row.lower_range, row.upper_range),
            }
        )
    return alerts


def _resolve_report_context(lab_report_name, journey_id=None):
    lab_report = frappe.get_doc("Lab Report", lab_report_name)
    trf = lab_report.customer_trf or getattr(lab_report, "trf_id", None)
    patient = None
    patient_name = lab_report.patient_name
    phone = None
    if trf:
        trf_row = frappe.db.get_value(
            "Customer TRF",
            trf,
            ["health_patient", "patient_name", "patient_phone"],
            as_dict=True,
        )
        if trf_row:
            patient_name = patient_name or trf_row.patient_name
            phone = trf_row.patient_phone
            patient = trf_row.health_patient
    if not journey_id and trf:
        journey_id = frappe.db.get_value("Patient Care Journey", {"customer_trf": trf}, "name")
    if patient and not patient_name:
        patient_name = frappe.db.get_value("Health Patient", patient, "patient_name")
    return lab_report, trf, patient, patient_name, phone, journey_id


def process_lab_report_critical_alerts(lab_report_name, journey_id=None):
    if frappe.flags.in_import or frappe.flags.in_migrate:
        return []
    if not critical_alerts_enabled():
        return []
    if not frappe.db.exists("DocType", "Lab Critical Value Alert"):
        return []

    lab_report, trf, patient, patient_name, phone, journey_id = _resolve_report_context(lab_report_name, journey_id)
    alert_rows = scan_lab_report_alerts(lab_report)
    if not alert_rows:
        return []

    created = []
    for spec in alert_rows:
        exists = frappe.db.exists(
            "Lab Critical Value Alert",
            {
                "lab_report": lab_report.name,
                "parameter": spec["parameter"],
                "abnormal_flag": spec["abnormal_flag"],
            },
        )
        if exists:
            continue
        doc = frappe.get_doc(
            {
                "doctype": "Lab Critical Value Alert",
                "patient": patient,
                "patient_name": patient_name,
                "lab_report": lab_report.name,
                "customer_trf": trf,
                "care_journey": journey_id,
                "parameter": spec["parameter"],
                "result_value": spec["result_value"],
                "unit": spec["unit"],
                "abnormal_flag": spec["abnormal_flag"],
                "reference_range": spec["reference_range"],
                "alert_status": "Open",
            }
        )
        doc.insert(ignore_permissions=True)
        created.append(doc.name)

    if created:
        frappe.db.commit()
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_critical_lab_values

            notify_critical_lab_values(lab_report.name, journey_id=journey_id, alert_names=created)
        except Exception:
            frappe.log_error(title="critical_value_notify", message=frappe.get_traceback())
    return created


@frappe.whitelist()
def get_critical_alerts_queue(status="Open", limit=50, sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import (
        _error,
        _parse_request_value,
        _require_mobile_auth,
        _success,
        _user_roles,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not (
        is_staff(roles)
        or "Pathologist" in roles
        or "Lab Technician" in roles
        or "System Manager" in roles
    ):
        return _error(_("Not authorized"), 403)

    status = (_parse_request_value("status", status) or "Open").strip()
    filters = {}
    if status and status != "All":
        filters["alert_status"] = status

    rows = frappe.get_all(
        "Lab Critical Value Alert",
        filters=filters,
        fields=[
            "name",
            "patient_name",
            "lab_report",
            "customer_trf",
            "parameter",
            "result_value",
            "unit",
            "abnormal_flag",
            "reference_range",
            "alert_status",
            "notified_patient",
            "notified_staff",
            "creation",
        ],
        order_by="creation desc",
        limit=int(limit or 50),
    )
    return _success({"alerts": rows, "count": len(rows)})


@frappe.whitelist()
def acknowledge_critical_alert(alert_name, sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import (
        _error,
        _parse_request_value,
        _require_mobile_auth,
        _success,
        _user_roles,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not (is_staff(roles) or "Pathologist" in roles or "Lab Technician" in roles):
        return _error(_("Not authorized"), 403)

    alert_name = _parse_request_value("alert_name", alert_name)
    if not alert_name or not frappe.db.exists("Lab Critical Value Alert", alert_name):
        return _error(_("Alert not found"), 404)
    frappe.db.set_value("Lab Critical Value Alert", alert_name, "alert_status", "Acknowledged")
    frappe.db.commit()
    return _success({"name": alert_name, "alert_status": "Acknowledged"})


def setup_phase53_critical_alerts():
    return {"ok": True, "phase": "53D", "feature": "critical_value_alerts"}
