"""Phase 108 — Study ops / RWE foundation (sites, subjects, PRO, export)."""

from __future__ import annotations

import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

SITE_DT = "Study Site"
SUBJECT_DT = "Study Subject"
PRO_DT = "Study PRO Response"
PROTOCOL_DT = "Care Study Protocol"
ENROLL_DT = "Care Enrollment"


def _ensure_doctype(name, fields, autoname, permissions=None):
    if frappe.db.exists("DocType", name):
        return False
    frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "autoname": autoname,
            "naming_rule": (
                "Expression"
                if str(autoname).startswith("format:")
                else ("By fieldname" if str(autoname).startswith("field:") else "Random")
            ),
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": fields,
            "permissions": permissions
            or [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Health System Admin",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "export": 1,
                    "report": 1,
                },
                {"role": "Physician", "read": 1, "write": 1, "create": 1, "report": 1},
            ],
        }
    ).insert(ignore_permissions=True)
    frappe.clear_cache(doctype=name)
    return True


def ensure_phase108_doctypes():
    # Ensure protocol exists from phase 104
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase104_research_lite import (
            setup_phase104_research_lite,
        )

        setup_phase104_research_lite()
    except Exception:
        pass

    created = []
    if _ensure_doctype(
        SITE_DT,
        [
            {
                "fieldname": "site_code",
                "label": "Site Code",
                "fieldtype": "Data",
                "reqd": 1,
                "unique": 1,
                "in_list_view": 1,
            },
            {
                "fieldname": "protocol",
                "label": "Protocol",
                "fieldtype": "Link",
                "options": PROTOCOL_DT,
                "reqd": 1,
                "in_list_view": 1,
            },
            {"fieldname": "site_name", "label": "Site Name", "fieldtype": "Data", "reqd": 1},
            {"fieldname": "principal_investigator", "label": "PI Doctor", "fieldtype": "Link", "options": "Doctor"},
            {"fieldname": "franchisee", "label": "Franchisee / Hub", "fieldtype": "Link", "options": "Franchisee Profile"},
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Active\nPaused\nClosed",
                "default": "Active",
                "in_list_view": 1,
            },
            {"fieldname": "target_n", "label": "Target N", "fieldtype": "Int", "default": "30"},
        ],
        "field:site_code",
    ):
        created.append(SITE_DT)

    if _ensure_doctype(
        SUBJECT_DT,
        [
            {
                "fieldname": "protocol",
                "label": "Protocol",
                "fieldtype": "Link",
                "options": PROTOCOL_DT,
                "reqd": 1,
                "in_list_view": 1,
            },
            {"fieldname": "site", "label": "Site", "fieldtype": "Link", "options": SITE_DT},
            {
                "fieldname": "care_enrollment",
                "label": "Care Enrollment",
                "fieldtype": "Link",
                "options": ENROLL_DT,
                "in_list_view": 1,
            },
            {
                "fieldname": "patient",
                "label": "Patient",
                "fieldtype": "Link",
                "options": "Health Patient",
                "reqd": 1,
            },
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Screening\nEnrolled\nWithdrawn\nCompleted",
                "default": "Screening",
                "in_list_view": 1,
            },
            {"fieldname": "econsent", "label": "eConsent", "fieldtype": "Check", "default": "0"},
            {"fieldname": "econsent_at", "label": "eConsent At", "fieldtype": "Datetime"},
            {"fieldname": "screened_on", "label": "Screened On", "fieldtype": "Date", "default": "Today"},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
        ],
        "format:HEC-SUBJ-{YYYY}-{#####}",
    ):
        created.append(SUBJECT_DT)

    if _ensure_doctype(
        PRO_DT,
        [
            {
                "fieldname": "subject",
                "label": "Subject",
                "fieldtype": "Link",
                "options": SUBJECT_DT,
                "reqd": 1,
                "in_list_view": 1,
            },
            {"fieldname": "protocol", "label": "Protocol", "fieldtype": "Link", "options": PROTOCOL_DT},
            {"fieldname": "survey_code", "label": "Survey Code", "fieldtype": "Data", "default": "baseline"},
            {
                "fieldname": "answered_at",
                "label": "Answered At",
                "fieldtype": "Datetime",
                "default": "Now",
                "in_list_view": 1,
            },
            {"fieldname": "answers_json", "label": "Answers JSON", "fieldtype": "Long Text"},
        ],
        "format:HEC-PRO-{YYYY}-{#####}",
    ):
        created.append(PRO_DT)

    return created


def seed_default_study_sites():
    ensure_phase108_doctypes()
    seeded = []
    for protocol in ("GLIDE-LITE", "RESET-LITE"):
        if not frappe.db.exists(PROTOCOL_DT, protocol):
            continue
        code = f"{protocol}-HQ"
        if frappe.db.exists(SITE_DT, code):
            seeded.append(code)
            continue
        doctor = frappe.db.get_value("Doctor", {"email": "physician@health.local"}, "name")
        if not doctor:
            doctor = frappe.db.get_value("Doctor", {"status": "Active"}, "name")
        frappe.get_doc(
            {
                "doctype": SITE_DT,
                "site_code": code,
                "protocol": protocol,
                "site_name": f"{protocol} HQ Site",
                "principal_investigator": doctor,
                "status": "Active",
                "target_n": 30,
            }
        ).insert(ignore_permissions=True)
        seeded.append(code)
    frappe.db.commit()
    return seeded


def _require_research_access():
    if not _require_mobile_auth():
        return None, _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not is_staff(roles) and "Physician" not in roles:
        return None, _error(_("Not authorized"), 403)
    return roles, None


@frappe.whitelist()
def list_study_ops_protocols(sid=None):
    roles, err = _require_research_access()
    if err:
        return err
    ensure_phase108_doctypes()
    rows = frappe.get_all(
        PROTOCOL_DT,
        filters={"enabled": 1} if frappe.get_meta(PROTOCOL_DT).has_field("enabled") else {},
        fields=["name", "protocol_code", "title", "condition", "description", "care_program"],
        order_by="title asc",
    )
    return _success({"protocols": rows})


@frappe.whitelist()
def get_study_funnel(protocol_code=None, sid=None):
    roles, err = _require_research_access()
    if err:
        return err
    ensure_phase108_doctypes()
    protocol_code = (_parse_request_value("protocol_code", protocol_code) or "").strip()
    if not protocol_code or not frappe.db.exists(PROTOCOL_DT, protocol_code):
        return _error(_("Protocol not found"), 404)

    subjects = frappe.get_all(
        SUBJECT_DT,
        filters={"protocol": protocol_code},
        fields=["name", "status", "econsent", "patient", "care_enrollment", "site"],
    )
    funnel = {"Screening": 0, "Enrolled": 0, "Withdrawn": 0, "Completed": 0}
    for s in subjects:
        funnel[s.status] = funnel.get(s.status, 0) + 1

    sites = frappe.get_all(
        SITE_DT,
        filters={"protocol": protocol_code},
        fields=["name", "site_code", "site_name", "target_n", "status"],
    )
    return _success(
        {
            "protocol": protocol_code,
            "funnel": funnel,
            "subject_count": len(subjects),
            "sites": sites,
            "disclaimer": (
                "Observational study ops only. CTRI / ethics registration remains sponsor/PI duty."
            ),
        }
    )


@frappe.whitelist()
def enroll_study_subject(
    protocol_code=None,
    care_enrollment=None,
    site_code=None,
    econsent=1,
    sid=None,
):
    roles, err = _require_research_access()
    if err:
        return err
    ensure_phase108_doctypes()
    protocol_code = (_parse_request_value("protocol_code", protocol_code) or "").strip()
    care_enrollment = (_parse_request_value("care_enrollment", care_enrollment) or "").strip()
    site_code = (_parse_request_value("site_code", site_code) or "").strip()

    if not protocol_code or not frappe.db.exists(PROTOCOL_DT, protocol_code):
        return _error(_("Invalid protocol"))
    if not care_enrollment or not frappe.db.exists(ENROLL_DT, care_enrollment):
        return _error(_("Care enrollment required"))

    enc = frappe.get_doc(ENROLL_DT, care_enrollment)
    existing = frappe.db.exists(
        SUBJECT_DT, {"protocol": protocol_code, "care_enrollment": care_enrollment}
    )
    if existing:
        return _success({"subject": existing, "already": True})

    site = site_code if site_code and frappe.db.exists(SITE_DT, site_code) else None
    if not site:
        site = frappe.db.get_value(SITE_DT, {"protocol": protocol_code, "status": "Active"}, "name")

    subject = frappe.get_doc(
        {
            "doctype": SUBJECT_DT,
            "protocol": protocol_code,
            "site": site,
            "care_enrollment": care_enrollment,
            "patient": enc.patient,
            "status": "Enrolled" if cint(_parse_request_value("econsent", econsent)) else "Screening",
            "econsent": cint(_parse_request_value("econsent", econsent)),
            "econsent_at": now_datetime() if cint(_parse_request_value("econsent", econsent)) else None,
            "screened_on": today(),
        }
    )
    subject.insert(ignore_permissions=True)

    # Mirror consent onto care enrollment
    try:
        enc.study_protocol = protocol_code
        enc.study_consent = 1 if subject.econsent else enc.study_consent
        enc.save(ignore_permissions=True)
    except Exception:
        pass

    frappe.db.commit()
    return _success({"subject": subject.name, "status": subject.status})


@frappe.whitelist()
def submit_study_pro(subject_id=None, survey_code=None, answers=None, sid=None):
    roles, err = _require_research_access()
    if err:
        return err
    # Also allow patient of the subject
    ensure_phase108_doctypes()
    subject_id = (_parse_request_value("subject_id", subject_id) or "").strip()
    if not subject_id or not frappe.db.exists(SUBJECT_DT, subject_id):
        return _error(_("Subject not found"), 404)

    subject = frappe.get_doc(SUBJECT_DT, subject_id)
    roles = _user_roles()
    if not is_staff(roles) and "Physician" not in roles:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

        profile = patient_profile_for_user()
        if not profile or profile.get("patient_id") != subject.patient:
            return _error(_("Not authorized"), 403)

    answers = answers if not isinstance(answers, str) else json.loads(answers or "{}")
    if _parse_request_value("answers", None) and not answers:
        raw = _parse_request_value("answers", answers)
        if isinstance(raw, str):
            try:
                answers = json.loads(raw)
            except Exception:
                answers = {"raw": raw}
        else:
            answers = raw or {}

    row = frappe.get_doc(
        {
            "doctype": PRO_DT,
            "subject": subject_id,
            "protocol": subject.protocol,
            "survey_code": _parse_request_value("survey_code", survey_code) or "baseline",
            "answered_at": now_datetime(),
            "answers_json": json.dumps(answers or {}),
        }
    )
    row.insert(ignore_permissions=True)
    frappe.db.commit()
    return _success({"pro": row.name})


@frappe.whitelist()
def export_study_dataset(protocol_code=None, sid=None):
    """De-identified observational export (no phone / email)."""
    roles, err = _require_research_access()
    if err:
        return err
    if not is_staff(roles):
        return _error(_("Staff only for dataset export"), 403)

    ensure_phase108_doctypes()
    protocol_code = (_parse_request_value("protocol_code", protocol_code) or "").strip()
    if not protocol_code or not frappe.db.exists(PROTOCOL_DT, protocol_code):
        return _error(_("Protocol not found"), 404)

    subjects = frappe.get_all(
        SUBJECT_DT,
        filters={"protocol": protocol_code},
        fields=["name", "status", "econsent", "site", "care_enrollment", "screened_on", "patient"],
    )
    rows = []
    for s in subjects:
        health_score = None
        adherence = None
        if s.care_enrollment and frappe.db.exists(ENROLL_DT, s.care_enrollment):
            health_score = frappe.db.get_value(ENROLL_DT, s.care_enrollment, "health_score")
            adherence = frappe.db.get_value(ENROLL_DT, s.care_enrollment, "adherence_percent")
        pro_n = frappe.db.count(PRO_DT, {"subject": s.name})
        rows.append(
            {
                "subject_id": s.name,
                "status": s.status,
                "econsent": cint(s.econsent),
                "site": s.site,
                "screened_on": str(s.screened_on) if s.screened_on else None,
                "health_score": flt(health_score) if health_score is not None else None,
                "adherence_percent": flt(adherence) if adherence is not None else None,
                "pro_responses": pro_n,
                # intentionally omit patient name/phone/email/abha
            }
        )

    package = {
        "protocol": protocol_code,
        "exported_at": str(now_datetime()),
        "version": "108.1",
        "data_dictionary": {
            "subject_id": "Study Subject name",
            "status": "Screening|Enrolled|Withdrawn|Completed",
            "health_score": "From Care Enrollment (0-100)",
            "adherence_percent": "Task adherence %",
            "pro_responses": "Count of PRO submissions",
        },
        "subjects": rows,
        "disclaimer": "De-identified observational extract. Not a locked clinical study database.",
    }
    return _success({"package": package})


def setup_phase108_study_ops():
    created = ensure_phase108_doctypes()
    sites = seed_default_study_sites()
    return {"ok": True, "phase": "108", "wave": "D", "created": created, "sites": sites}


def smoke_phase108_study_ops():
    setup = setup_phase108_study_ops()
    ok = frappe.db.exists("DocType", SUBJECT_DT) and frappe.db.exists("DocType", SITE_DT)
    sites = frappe.get_all(SITE_DT, pluck="name") if ok else []
    return {"ok": bool(ok), "phase": "108", "setup": setup, "sites": sites}


def smoke_waves_a_c_d():
    """Combined smoke for Waves A (105), C (107), D (108)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase105_abdm import smoke_phase105_abdm
    from health_ecosystem_core.health_ecosystem_core.clinical_phase107_knowledge import (
        smoke_phase107_knowledge,
    )

    a = smoke_phase105_abdm()
    c = smoke_phase107_knowledge()
    d = smoke_phase108_study_ops()
    return {
        "ok": bool(a.get("ok") and c.get("ok") and d.get("ok")),
        "waves": {"A": a, "C": c, "D": d},
        "skipped": "B (hardware SmartSync pen)",
    }
