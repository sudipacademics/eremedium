"""Patient care journey orchestration and APIs."""

import json
from html import escape

import frappe
from frappe import _
from frappe.utils import now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _is_staff_user,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_utils import journey_report_payload, build_lab_report_json

JOURNEY_STATES = [
    "Nursing Intake",
    "Doctor Consultation",
    "Prescription Issued",
    "Medicine Ordered",
    "Diagnostics Booked",
    "Phlebotomist Assigned",
    "Sample Collected",
    "In Lab",
    "Report Review",
    "Authorized",
    "Dispatched",
]

TRF_STATUS_TO_JOURNEY = {
    "Booked": "Diagnostics Booked",
    "Sample Collected": "Sample Collected",
    "In Lab": "In Lab",
    "Completed": "Report Review",
}


def _journey_ready():
    return frappe.db.exists("DocType", "Patient Care Journey")


def create_journey(patient, status="Nursing Intake", **links):
    if not _journey_ready():
        return None
    patient_name = frappe.db.get_value("Health Patient", patient, "patient_name")
    doc = frappe.get_doc(
        {
            "doctype": "Patient Care Journey",
            "patient": patient,
            "patient_name": patient_name,
            "status": status,
            **{k: v for k, v in links.items() if v},
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def advance_journey(journey_name, status, **updates):
    if not journey_name or not frappe.db.exists("Patient Care Journey", journey_name):
        return None
    if status not in JOURNEY_STATES:
        frappe.throw(_("Invalid journey status: {0}").format(status))
    doc = frappe.get_doc("Patient Care Journey", journey_name)
    doc.status = status
    for key, value in updates.items():
        if hasattr(doc, key) and value is not None:
            setattr(doc, key, value)
    doc.save(ignore_permissions=True)
    return doc.name


def get_active_journey(patient_id):
    if not patient_id or not _journey_ready():
        return None
    return frappe.db.get_value(
        "Patient Care Journey",
        {
            "patient": patient_id,
            "status": ["not in", ["Authorized", "Dispatched"]],
        },
        "name",
        order_by="creation desc",
    )


def ensure_journey_for_patient(patient_id, status=None, **links):
    journey = get_active_journey(patient_id)
    if journey:
        if status or links:
            advance_journey(journey, status or frappe.db.get_value("Patient Care Journey", journey, "status"), **links)
        return journey
    return create_journey(patient_id, status=status or "Nursing Intake", **links)


def sync_journey_from_trf(trf_name, order_status=None):
    if not _journey_ready():
        return
    trf = frappe.get_doc("Customer TRF", trf_name)
    patient_id = None
    if frappe.get_meta("Customer TRF").has_field("health_patient"):
        patient_id = trf.get("health_patient")
    journey_name = trf.get("care_journey") or (patient_id and get_active_journey(patient_id))
    if not journey_name and patient_id:
        journey_name = ensure_journey_for_patient(patient_id, status="Diagnostics Booked", customer_trf=trf_name)
    elif journey_name and not trf.get("care_journey"):
        frappe.db.set_value("Customer TRF", trf_name, "care_journey", journey_name, update_modified=False)

    status = order_status or trf.order_status
    mapped = TRF_STATUS_TO_JOURNEY.get(status)
    if journey_name and mapped:
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import advance_journey_forward

        advance_journey_forward(journey_name, mapped, customer_trf=trf_name)


def _render_lab_report_html(payload):
    rows = ""
    for row in payload.get("results") or []:
        flag = row.get("abnormal_flag") or ""
        rows += (
            f"<tr><td>{escape(str(row.get('analyte_test_name') or ''))}</td>"
            f"<td>{row.get('numeric_result_value', '')}</td>"
            f"<td>{escape(str(row.get('unit_of_measure') or ''))}</td>"
            f"<td>{escape(str(row.get('reference_range') or ''))}</td>"
            f"<td>{escape(str(flag))}</td></tr>"
        )
    patient = escape(str(payload.get("patient_name") or ""))
    journey_id = escape(str(payload.get("journey_id") or ""))
    status = escape(str(payload.get("status") or ""))
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Lab Report</title>
<style>
body {{ font-family: Arial, sans-serif; margin: 24px; color: #222; }}
h1 {{ font-size: 20px; margin-bottom: 4px; }}
.meta {{ margin-bottom: 16px; color: #555; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; }}
th {{ background: #f5f5f5; }}
</style></head><body>
<h1>Laboratory Report</h1>
<div class="meta">
<p><strong>Patient:</strong> {patient}</p>
<p><strong>Journey:</strong> {journey_id}</p>
<p><strong>Status:</strong> {status}</p>
</div>
<table>
<thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
<tbody>{rows or '<tr><td colspan="5">No results recorded</td></tr>'}</tbody>
</table>
</body></html>"""


def generate_lab_report_pdf(journey_name):
    from frappe.utils.pdf import get_pdf

    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
        journey_pdf_payload,
        render_nabl_lab_report_html,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import render_branded_lab_report_html

    payload = journey_pdf_payload(journey_name)
    if payload.get("nabl_report"):
        html = render_nabl_lab_report_html(payload["nabl_report"])
    else:
        html = render_branded_lab_report_html(payload)
    pdf_content = get_pdf(html)
    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": f"Lab_Report_{journey_name}.pdf",
            "content": pdf_content,
            "is_private": 0,
            "attached_to_doctype": "Patient Care Journey",
            "attached_to_name": journey_name,
            "folder": "Home/Attachments",
        }
    )
    file_doc.insert(ignore_permissions=True)
    return file_doc.file_url


@frappe.whitelist()
def start_patient_journey(patient=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    patient = _parse_request_value("patient", patient)
    if not patient or not frappe.db.exists("Health Patient", patient):
        return _error(_("Patient not found"), 404)
    journey = ensure_journey_for_patient(patient, status="Nursing Intake")
    frappe.db.commit()
    return _success({"journey_id": journey, "journey": journey_report_payload(journey)})


@frappe.whitelist(allow_guest=True)
def get_patient_journey(journey_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _journey_ready():
        return _success({"journey": None})
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    journey_id = _parse_request_value("journey_id", journey_id)
    if journey_id:
        if not frappe.db.exists("Patient Care Journey", journey_id):
            return _error(_("Journey not found"), 404)
        return _success({"journey": journey_report_payload(journey_id)})

    if not profile or not profile.get("patient_id"):
        return _success({"journey": None})
    name = get_active_journey(profile["patient_id"]) or frappe.db.get_value(
        "Patient Care Journey",
        {"patient": profile["patient_id"]},
        "name",
        order_by="modified desc",
    )
    if not name:
        return _success({"journey": None})
    return _success({"journey": journey_report_payload(name)})


@frappe.whitelist(allow_guest=True)
def list_patient_journeys(limit=20, sid=None):
    """Return all care journeys for the logged-in patient (newest activity first)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _journey_ready():
        return _success({"journeys": []})

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    if not profile or not profile.get("patient_id"):
        return _success({"journeys": []})

    limit = int(limit or 20)
    rows = frappe.get_all(
        "Patient Care Journey",
        filters={"patient": profile["patient_id"]},
        fields=["name"],
        order_by="modified desc",
        limit=limit,
    )
    journeys = [journey_report_payload(row.name) for row in rows]
    return _success({"journeys": journeys})


@frappe.whitelist()
def advance_patient_journey(journey_id=None, status=None, phlebotomist=None, pathologist=None, notes=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _is_staff_user() and "Physician" not in frappe.get_roles() and "Nurse" not in frappe.get_roles():
        return _error(_("Not authorized"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    status = _parse_request_value("status", status)
    if not journey_id or not status:
        return _error(_("Journey ID and status are required"))

    updates = {}
    if phlebotomist:
        updates["phlebotomist"] = phlebotomist
    if pathologist:
        updates["pathologist"] = pathologist
    if notes:
        updates["pathologist_notes"] = notes

    advance_journey(journey_id, status, **updates)
    frappe.db.commit()
    return _success({"journey": journey_report_payload(journey_id)})


@frappe.whitelist(allow_guest=True)
def create_nursing_assessment(
    patient=None,
    care_journey=None,
    blood_pressure=None,
    pulse=None,
    temperature=None,
    spo2=None,
    weight_kg=None,
    height_cm=None,
    nursing_history=None,
    vitals_notes=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not frappe.db.exists("DocType", "Nursing Assessment"):
        return _error(_("Nursing module not available"))

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    patient = _parse_request_value("patient", patient)
    profile = patient_profile_for_user()
    if not patient and profile:
        patient = profile.get("patient_id")
    if not patient:
        return _error(_("Patient is required"))

    care_journey = _parse_request_value("care_journey", care_journey) or ensure_journey_for_patient(
        patient, status="Nursing Intake"
    )

    doc = frappe.get_doc(
        {
            "doctype": "Nursing Assessment",
            "patient": patient,
            "care_journey": care_journey,
            "blood_pressure": _parse_request_value("blood_pressure", blood_pressure),
            "pulse": _parse_request_value("pulse", pulse),
            "temperature": _parse_request_value("temperature", temperature),
            "spo2": _parse_request_value("spo2", spo2),
            "weight_kg": _parse_request_value("weight_kg", weight_kg),
            "height_cm": _parse_request_value("height_cm", height_cm),
            "nursing_history": _parse_request_value("nursing_history", nursing_history),
            "vitals_notes": _parse_request_value("vitals_notes", vitals_notes),
        }
    )
    doc.insert(ignore_permissions=True)
    if care_journey:
        advance_journey(care_journey, "Nursing Intake", nursing_assessment=doc.name)
    frappe.db.commit()
    return _success({"assessment_id": doc.name, "care_journey": care_journey})


@frappe.whitelist()
def authorize_lab_report(journey_id=None, pathologist_notes=None, report_pdf=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    roles = set(frappe.get_roles())
    if "Pathologist" not in roles and "Health System Admin" not in roles and "System Manager" not in roles:
        return _error(_("Only pathologists can authorize reports"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return _error(_("Journey not found"), 404)

    journey = frappe.get_doc("Patient Care Journey", journey_id)

    # Phase 61 — competence check (soft warn or hard block via Settings)
    competence_warning = ""
    if journey.customer_trf and frappe.db.exists("DocType", "Lab Report"):
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import _existing_lab_report
            from health_ecosystem_core.health_ecosystem_core.clinical_nabl_release_gates import (
                evaluate_release_gates,
                user_competent_for_disciplines,
            )

            lab_name = _existing_lab_report(journey.customer_trf)
            if lab_name:
                gates = evaluate_release_gates(frappe.get_doc("Lab Report", lab_name))
                ok, msg = user_competent_for_disciplines(frappe.session.user, gates.get("disciplines") or set())
                if not ok:
                    return _error(_(msg or "Competence check failed"), 403)
                competence_warning = msg or ""
        except Exception:
            frappe.log_error(title="authorize competence check", message=frappe.get_traceback())

    if journey.customer_trf:
        journey.lab_report_json = json.dumps(build_lab_report_json(journey.customer_trf))
    journey.pathologist = frappe.session.user
    journey.pathologist_notes = _parse_request_value("pathologist_notes", pathologist_notes)
    if report_pdf:
        journey.report_pdf = report_pdf
    else:
        journey.report_pdf = generate_lab_report_pdf(journey_id)
    journey.authorized_on = now_datetime()
    prev_status = journey.status
    journey.status = "Authorized"
    journey.save(ignore_permissions=True)
    _log_journey_activity(journey_id, f"Report authorized by {frappe.session.user}", prev_status, "Authorized")

    if journey.customer_trf and frappe.db.exists("DocType", "Lab Report"):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import _existing_lab_report

        lab_report = _existing_lab_report(journey.customer_trf)
        if lab_report:
            frappe.db.set_value("Lab Report", lab_report, {"report_status": "Authorized", "printed_on": now_datetime()})
    frappe.db.commit()
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_report_ready

        notify_report_ready(journey_id)
    except Exception:
        frappe.log_error(title="notify_report_ready", message=frappe.get_traceback())
    if journey.customer_trf and frappe.db.exists("DocType", "Lab Report"):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import _existing_lab_report
        from health_ecosystem_core.health_ecosystem_core.clinical_phase53_critical_alerts import (
            process_lab_report_critical_alerts,
        )

        lab_report_name = _existing_lab_report(journey.customer_trf)
        if lab_report_name:
            try:
                process_lab_report_critical_alerts(lab_report_name, journey_id=journey_id)
            except Exception:
                frappe.log_error(title="authorize critical alerts", message=frappe.get_traceback())

    # Phase 24 — also consume reagents on pathologist authorize (ROADMAP)
    if journey.customer_trf and frappe.db.exists("DocType", "Lab Reagent Batch"):
        try:
            trf_status = frappe.db.get_value("Customer TRF", journey.customer_trf, "order_status")
            if trf_status != "Completed":
                frappe.db.set_value("Customer TRF", journey.customer_trf, "order_status", "Completed")
            from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
                maybe_consume_reagents_on_trf_complete,
            )

            maybe_consume_reagents_on_trf_complete(journey.customer_trf)
        except Exception:
            frappe.log_error(title="authorize_reagent_consume", message=frappe.get_traceback())

    return _success(
        {"journey": journey_report_payload(journey_id), "competence_warning": competence_warning},
        message="Report authorized",
    )


@frappe.whitelist(allow_guest=True)
def get_journey_report(journey_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    journey_id = _parse_request_value("journey_id", journey_id)
    if not journey_id:
        return _error(_("Journey ID is required"))
    if not frappe.db.exists("Patient Care Journey", journey_id):
        return _error(_("Journey not found"), 404)
    journey = frappe.db.get_value("Patient Care Journey", journey_id, ["status", "patient"], as_dict=True)
    if journey.status not in ("Authorized", "Dispatched"):
        return _error(_("Report not yet authorized"), 403)
    return _success({"report": journey_report_payload(journey_id)})


@frappe.whitelist()
def dispatch_journey_report(journey_id=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _is_staff_user():
        return _error(_("Not authorized"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return _error(_("Journey not found"), 404)

    status = frappe.db.get_value("Patient Care Journey", journey_id, "status")
    if status not in ("Authorized", "Dispatched"):
        return _error(_("Report must be authorized before dispatch"), 400)

    advance_journey(journey_id, "Dispatched")
    _log_journey_activity(journey_id, f"Report dispatched by {frappe.session.user}", status, "Dispatched")
    frappe.db.commit()
    return _success({"journey": journey_report_payload(journey_id)}, message="Report dispatched")


def _log_journey_activity(journey_id, message, from_status=None, to_status=None):
    """Lazy import to avoid circular dependency with phase 33 ops module."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase33_journey_ops import (
            log_journey_activity,
        )

        log_journey_activity(journey_id, message, from_status=from_status, to_status=to_status)
    except Exception:
        frappe.log_error(title="_log_journey_activity", message=frappe.get_traceback())
