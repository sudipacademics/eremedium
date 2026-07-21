"""Phase 58 — Lab report signatories (5 dept) + TRF referred doctor."""

from __future__ import annotations

import frappe
from frappe import _

SIGNATORY_DEPARTMENTS = (
    ("Pathology", "pathology", "Consultant Pathologist"),
    ("Biochemistry", "biochemistry", "Consultant Biochemist"),
    ("Haematology", "haematology", "Consultant Haematologist"),
    ("Microbiology", "microbiology", "Consultant Microbiologist"),
    ("Clinical Pathology", "clinical_pathology", "Clinical Pathologist"),
)


def ensure_trf_referred_doctor_field():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "referred_doctor",
                    "label": "Referred Doctor",
                    "fieldtype": "Data",
                    "insert_after": "gender",
                    "default": "Self",
                    "in_list_view": 1,
                    "description": "Referring clinician name, or Self if walk-in / self-requested",
                }
            ]
        }
    )


def ensure_lab_report_signatory_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    fields = []
    insert_after = "investigator_2"
    for label, key, _role in SIGNATORY_DEPARTMENTS:
        name_field = f"signatory_{key}_name"
        qual_field = f"signatory_{key}_qual"
        fields.append(
            {
                "fieldname": name_field,
                "label": f"{label} Signatory",
                "fieldtype": "Data",
                "insert_after": insert_after,
                "description": f"Printed name for {label} signature block",
            }
        )
        fields.append(
            {
                "fieldname": qual_field,
                "label": f"{label} Qualification",
                "fieldtype": "Data",
                "insert_after": name_field,
            }
        )
        insert_after = qual_field

    create_custom_fields({"Lab Report": fields})


def ensure_settings_signatory_defaults():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return

    fields = [
        {
            "fieldname": "section_break_report_signatories",
            "fieldtype": "Section Break",
            "label": "Lab Report Signatories (Footer)",
            "insert_after": "critical_alert_level",
        }
    ]
    insert_after = "section_break_report_signatories"
    for label, key, _role in SIGNATORY_DEPARTMENTS:
        name_field = f"report_sig_{key}_name"
        qual_field = f"report_sig_{key}_qual"
        fields.append(
            {
                "fieldname": name_field,
                "label": f"Default {label} Name",
                "fieldtype": "Data",
                "insert_after": insert_after,
            }
        )
        fields.append(
            {
                "fieldname": qual_field,
                "label": f"Default {label} Qualification",
                "fieldtype": "Data",
                "insert_after": name_field,
            }
        )
        insert_after = qual_field

    create_custom_fields({"Health Ecosystem Settings": fields})


def normalize_referred_doctor(value):
    text = (value or "").strip()
    if not text or text.lower() in ("self", "na", "n/a", "none", "-"):
        return "Self"
    return text


def referred_doctor_from_trf(trf):
    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)
    if hasattr(trf, "referred_doctor") and trf.get("referred_doctor"):
        return normalize_referred_doctor(trf.referred_doctor)
    # Legacy / Lab Report may already hold referral
    return "Self"


def _settings_value(fieldname):
    try:
        return frappe.db.get_single_value("Health Ecosystem Settings", fieldname) or ""
    except Exception:
        return ""


def resolve_signatories(lab_report_doc=None):
    """Return 5 signatory dicts: department, role, name, qualification."""
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        investigator_signature,
    )

    rows = []
    for label, key, role in SIGNATORY_DEPARTMENTS:
        name = ""
        qual = ""
        if lab_report_doc:
            name = (lab_report_doc.get(f"signatory_{key}_name") or "").strip()
            qual = (lab_report_doc.get(f"signatory_{key}_qual") or "").strip()
            # Backward compat: Pathology ← investigator_1, Biochemistry ← investigator_2
            if not name and key == "pathology" and lab_report_doc.get("investigator_1"):
                sig = investigator_signature(lab_report_doc.investigator_1)
                name = sig.get("name") or ""
                qual = qual or sig.get("qualification") or ""
            if not name and key == "biochemistry" and lab_report_doc.get("investigator_2"):
                sig = investigator_signature(lab_report_doc.investigator_2)
                name = sig.get("name") or ""
                qual = qual or sig.get("qualification") or ""

        if not name:
            name = (_settings_value(f"report_sig_{key}_name") or "").strip()
        if not qual:
            qual = (_settings_value(f"report_sig_{key}_qual") or "").strip()

        rows.append(
            {
                "department": label,
                "role": role,
                "name": name,
                "qualification": qual,
            }
        )
    return rows


def setup_phase58():
    ensure_trf_referred_doctor_field()
    ensure_lab_report_signatory_fields()
    ensure_settings_signatory_defaults()
    frappe.clear_cache()
    return {"ok": True, "phase": 58, "signatory_departments": [d[0] for d in SIGNATORY_DEPARTMENTS]}
