"""Phase 104 — Research lite (Evalus-adjacent) + specialty SOAP templates."""

from __future__ import annotations

import json

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

STUDY_DT = "Care Study Protocol"

SPECIALTY_TEMPLATES = (
    {
        "code": "general_medicine",
        "title": "General Medicine",
        "chief_complaint_hint": "Presenting complaint and duration",
        "examination_hint": "General exam, vitals, system findings",
        "plan_hint": "Investigations, medicines, follow-up interval",
    },
    {
        "code": "endocrinology",
        "title": "Endocrinology / Diabetes",
        "chief_complaint_hint": "Glycemic symptoms, weight change, complications",
        "examination_hint": "BMI, foot exam, thyroid, neuropathy screen",
        "plan_hint": "HbA1c/labs, meds titration, lifestyle goals",
    },
    {
        "code": "hepatology",
        "title": "Hepatology / NAFLD",
        "chief_complaint_hint": "Fatigue, abdominal discomfort, metabolic history",
        "examination_hint": "BMI, waist, stigmata of liver disease",
        "plan_hint": "LFT/USG, weight target, diet/exercise plan",
    },
    {
        "code": "pulmonology",
        "title": "Pulmonology / COPD-Asthma",
        "chief_complaint_hint": "Dyspnea, cough, wheeze, exacerbations",
        "examination_hint": "Respiratory exam, SpO2, inhaler technique",
        "plan_hint": "Spirometry, inhalers, pulmonary rehab tasks",
    },
    {
        "code": "gynaecology",
        "title": "Gynaecology / PCOS",
        "chief_complaint_hint": "Cycle irregularity, hirsutism, fertility goals",
        "examination_hint": "BMI, acne/hirsutism score, BP",
        "plan_hint": "Hormonal labs, metabolic labs, lifestyle plan",
    },
)


def ensure_phase104_doctypes():
    created = False
    if not frappe.db.exists("DocType", STUDY_DT):
        frappe.get_doc(
            {
                "doctype": "DocType",
                "name": STUDY_DT,
                "module": "Health Ecosystem Core",
                "custom": 0,
                "autoname": "field:protocol_code",
                "naming_rule": "By fieldname",
                "engine": "InnoDB",
                "track_changes": 1,
                "fields": [
                    {
                        "fieldname": "protocol_code",
                        "label": "Protocol Code",
                        "fieldtype": "Data",
                        "reqd": 1,
                        "unique": 1,
                        "in_list_view": 1,
                    },
                    {
                        "fieldname": "title",
                        "label": "Title",
                        "fieldtype": "Data",
                        "reqd": 1,
                        "in_list_view": 1,
                    },
                    {
                        "fieldname": "condition",
                        "label": "Condition",
                        "fieldtype": "Data",
                        "in_list_view": 1,
                    },
                    {
                        "fieldname": "enabled",
                        "label": "Enabled",
                        "fieldtype": "Check",
                        "default": "1",
                    },
                    {
                        "fieldname": "description",
                        "label": "Description",
                        "fieldtype": "Small Text",
                    },
                    {
                        "fieldname": "care_program",
                        "label": "Linked Care Program",
                        "fieldtype": "Link",
                        "options": "Care Program Template",
                    },
                    {
                        "fieldname": "pro_survey_json",
                        "label": "PRO Survey JSON",
                        "fieldtype": "Long Text",
                    },
                    {
                        "fieldname": "ethics_note",
                        "label": "Ethics / EC Note",
                        "fieldtype": "Small Text",
                    },
                ],
                "permissions": [
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
                    {"role": "Physician", "read": 1, "report": 1},
                ],
            }
        ).insert(ignore_permissions=True)
        frappe.clear_cache(doctype=STUDY_DT)
        created = True

    # Upgrade Care Enrollment study_protocol to Link when possible
    if frappe.db.exists("DocType", "Care Enrollment") and frappe.db.exists("DocType", STUDY_DT):
        meta = frappe.get_meta("Care Enrollment")
        df = meta.get_field("study_protocol")
        if df and df.fieldtype == "Data":
            from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

            # Keep Data field; add optional link mirror via custom field
            create_custom_fields(
                {
                    "Care Enrollment": [
                        {
                            "fieldname": "study_protocol_link",
                            "label": "Study Protocol Link",
                            "fieldtype": "Link",
                            "options": STUDY_DT,
                            "insert_after": "study_protocol",
                        }
                    ]
                },
                update=True,
            )
    return {"created": created}


def seed_study_protocols():
    ensure_phase104_doctypes()
    if not frappe.db.exists("DocType", "Care Program Template"):
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase101_care_programs import (
                setup_phase101_care_programs,
            )

            setup_phase101_care_programs()
        except Exception:
            pass

    specs = [
        {
            "protocol_code": "GLIDE-LITE",
            "title": "GLIDE-lite Diabetes Observational",
            "condition": "Diabetes",
            "care_program": "DIABETES" if frappe.db.exists("Care Program Template", "DIABETES") else None,
            "description": "Lightweight observational tracking for diabetes care program outcomes.",
            "pro_survey_json": json.dumps(
                [
                    {"id": "energy", "label": "Energy level 1-10", "type": "number"},
                    {"id": "med_adherence", "label": "Took medicines today?", "type": "yesno"},
                ]
            ),
            "ethics_note": "Internal observational use only — not a CTRI-registered trial.",
            "enabled": 1,
        },
        {
            "protocol_code": "RESET-LITE",
            "title": "RESET-lite NAFLD Observational",
            "condition": "NAFLD",
            "care_program": "NAFLD" if frappe.db.exists("Care Program Template", "NAFLD") else None,
            "description": "Observational lifestyle outcomes for fatty liver care program.",
            "pro_survey_json": json.dumps(
                [
                    {"id": "bloating", "label": "Bloating this week?", "type": "yesno"},
                    {"id": "activity_days", "label": "Active days this week", "type": "number"},
                ]
            ),
            "ethics_note": "Internal observational use only.",
            "enabled": 1,
        },
    ]
    seeded = []
    for spec in specs:
        code = spec["protocol_code"]
        payload = {k: v for k, v in spec.items() if v is not None}
        if frappe.db.exists(STUDY_DT, code):
            doc = frappe.get_doc(STUDY_DT, code)
            for k, v in payload.items():
                doc.set(k, v)
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc({"doctype": STUDY_DT, **payload}).insert(ignore_permissions=True)
        seeded.append(code)
    frappe.db.commit()
    return seeded


@frappe.whitelist()
def list_specialty_templates(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)
    return _success({"templates": list(SPECIALTY_TEMPLATES)})


@frappe.whitelist()
def list_study_protocols(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase104_doctypes()
    rows = frappe.get_all(
        STUDY_DT,
        filters={"enabled": 1},
        fields=["name", "protocol_code", "title", "condition", "care_program", "description"],
        order_by="title asc",
    )
    return _success({"protocols": rows})


@frappe.whitelist()
def attach_study_consent(enrollment_id=None, protocol_code=None, consent=1, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase104_doctypes()
    enrollment_id = (_parse_request_value("enrollment_id", enrollment_id) or "").strip()
    protocol_code = (_parse_request_value("protocol_code", protocol_code) or "").strip()
    if not enrollment_id or not frappe.db.exists("Care Enrollment", enrollment_id):
        return _error(_("Enrollment not found"), 404)
    if not protocol_code or not frappe.db.exists(STUDY_DT, protocol_code):
        return _error(_("Protocol not found"), 404)

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    patient = profile.get("patient_id") if profile else None
    enc = frappe.get_doc("Care Enrollment", enrollment_id)
    if patient and enc.patient != patient and not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)

    if not int(_parse_request_value("consent", consent) or 0):
        return _error(_("Consent required"))

    enc.study_protocol = protocol_code
    enc.study_consent = 1
    if enc.meta.has_field("study_protocol_link"):
        enc.study_protocol_link = protocol_code
    enc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"enrollment_id": enc.name, "study_protocol": protocol_code})


def setup_phase104_research_lite():
    dt = ensure_phase104_doctypes()
    seeded = seed_study_protocols()
    return {
        "ok": True,
        "phase": "104",
        "doctype": dt,
        "seeded_protocols": seeded,
        "specialty_templates": len(SPECIALTY_TEMPLATES),
    }


def smoke_phase104_research_lite():
    setup = setup_phase104_research_lite()
    exists = frappe.db.exists("DocType", STUDY_DT)
    return {
        "ok": bool(exists),
        "phase": "104",
        "setup": setup,
        "templates": [t["code"] for t in SPECIALTY_TEMPLATES],
    }
