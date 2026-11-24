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
                "fieldtype": "Small Text",
                "insert_after": name_field,
            }
        )
        insert_after = qual_field

    create_custom_fields({"Lab Report": fields}, ignore_validate=True, update=True)


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
        image_field = f"report_sig_{key}_image"
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
                "fieldtype": "Small Text",
                "insert_after": name_field,
            }
        )
        fields.append(
            {
                "fieldname": image_field,
                "label": f"Default {label} Signature Image",
                "fieldtype": "Attach Image",
                "insert_after": qual_field,
            }
        )
        insert_after = image_field

    create_custom_fields({"Health Ecosystem Settings": fields}, ignore_validate=True, update=True)


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


def _public_sig_url(value):
    url = (value or "").strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://") or url.startswith("data:") or url.startswith("/"):
        return url
    return "/" + url.lstrip("/")


def _employee_signature_for_user(user_id):
    """Pathologist / lab signer image from Employee.hec_pathologist_signature."""
    user_id = (user_id or "").strip()
    if not user_id or not frappe.db.exists("DocType", "Employee"):
        return ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import EMP_SIG_FIELD

        if not frappe.get_meta("Employee").has_field(EMP_SIG_FIELD):
            return ""
        url = frappe.db.get_value("Employee", {"user_id": user_id}, EMP_SIG_FIELD) or ""
        return _public_sig_url(url)
    except Exception:
        return ""


def _employee_signature_for_name(display_name):
    """Match printed signatory name to an Employee signature image."""
    name = (display_name or "").strip()
    if not name or not frappe.db.exists("DocType", "Employee"):
        return ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import EMP_SIG_FIELD

        if not frappe.get_meta("Employee").has_field(EMP_SIG_FIELD):
            return ""
        # Exact then loose match on active employees with a signature on file.
        row = frappe.db.get_value(
            "Employee",
            {"employee_name": name, "status": "Active"},
            [EMP_SIG_FIELD],
            as_dict=True,
        )
        if not row:
            rows = frappe.get_all(
                "Employee",
                filters={"status": "Active", EMP_SIG_FIELD: ("is", "set")},
                fields=["employee_name", EMP_SIG_FIELD],
                limit_page_length=200,
            )
            needle = name.lower().replace("dr ", "").replace("dr.", "").strip()
            for r in rows:
                hay = (r.employee_name or "").lower().replace("dr ", "").replace("dr.", "").strip()
                if needle and (needle in hay or hay in needle):
                    row = r
                    break
        if not row:
            return ""
        return _public_sig_url(row.get(EMP_SIG_FIELD))
    except Exception:
        return ""


def resolve_signatories(lab_report_doc=None):
    """Return 5 signatory dicts: department, role, name, qualification, signature_url."""
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        investigator_signature,
    )

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
            ensure_labtech_settings_fields,
        )

        ensure_labtech_settings_fields()
    except Exception:
        pass

    approver_user = ""
    if lab_report_doc:
        approver_user = (lab_report_doc.get("approved_by_user") or "").strip()
        if not approver_user:
            journey = (lab_report_doc.get("care_journey") or "").strip()
            if journey and frappe.db.exists("Patient Care Journey", journey):
                approver_user = (
                    frappe.db.get_value("Patient Care Journey", journey, "pathologist") or ""
                ).strip()

    rows = []
    for label, key, role in SIGNATORY_DEPARTMENTS:
        name = ""
        qual = ""
        image = ""
        if lab_report_doc:
            name = (lab_report_doc.get(f"signatory_{key}_name") or "").strip()
            qual = (lab_report_doc.get(f"signatory_{key}_qual") or "").strip()
            # Backward compat: Pathology ← investigator_1, Biochemistry ← investigator_2
            if not name and key == "pathology" and lab_report_doc.get("investigator_1"):
                sig = investigator_signature(lab_report_doc.investigator_1)
                name = sig.get("name") or ""
                qual = qual or sig.get("qualification") or ""
                image = image or _public_sig_url(sig.get("signature") or sig.get("signature_url") or "")
                image = image or _employee_signature_for_user(lab_report_doc.investigator_1)
            if not name and key == "biochemistry" and lab_report_doc.get("investigator_2"):
                sig = investigator_signature(lab_report_doc.investigator_2)
                name = sig.get("name") or ""
                qual = qual or sig.get("qualification") or ""
                image = image or _public_sig_url(sig.get("signature") or sig.get("signature_url") or "")
                image = image or _employee_signature_for_user(lab_report_doc.investigator_2)

        if not name:
            name = (_settings_value(f"report_sig_{key}_name") or "").strip()
        if not qual:
            qual = (_settings_value(f"report_sig_{key}_qual") or "").strip()
        if not image:
            image = _public_sig_url(_settings_value(f"report_sig_{key}_image"))
        if not image and name:
            image = _employee_signature_for_name(name)
        # Authorising Lab Manager / QC Manager / Pathologist signature on Pathology block.
        if not image and key == "pathology" and approver_user:
            image = _employee_signature_for_user(approver_user)

        rows.append(
            {
                "key": key,
                "department": label,
                "role": role,
                "name": name,
                "qualification": qual,
                "signature_url": image,
            }
        )
    return rows


def setup_phase58():
    ensure_trf_referred_doctor_field()
    ensure_lab_report_signatory_fields()
    ensure_settings_signatory_defaults()
    frappe.clear_cache()
    return {"ok": True, "phase": 58, "signatory_departments": [d[0] for d in SIGNATORY_DEPARTMENTS]}
