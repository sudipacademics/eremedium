"""Phase 78 — Referring doctors on franchisee hub bill entry (Self / select / append).

Used for referral commission disbursement: each referred case links a Doctor with
phone, address, and territory.

Setup:
    bench --site SITE execute \\
        health_ecosystem_core.health_ecosystem_core.clinical_phase78_referring_doctors.setup_phase78
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint


def ensure_doctor_referral_fields():
    """Address / territory / referring flag on Doctor (idempotent via custom fields if migrate skipped)."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    meta = frappe.get_meta("Doctor")
    payload = {"Doctor": []}
    specs = [
        {
            "fieldname": "address",
            "label": "Address",
            "fieldtype": "Small Text",
            "insert_after": "column_break_1",
            "description": "Clinic / chamber address for referral commission payouts",
        },
        {
            "fieldname": "territory",
            "label": "Territory",
            "fieldtype": "Data",
            "insert_after": "address",
            "description": "Area used when disbursing referral commissions",
        },
        {
            "fieldname": "is_referring_doctor",
            "label": "Referring Doctor (external)",
            "fieldtype": "Check",
            "insert_after": "territory",
            "default": "0",
        },
    ]
    for spec in specs:
        if not meta.has_field(spec["fieldname"]):
            payload["Doctor"].append(spec)

    if payload["Doctor"]:
        create_custom_fields(payload, update=True)
        return f"added {[f['fieldname'] for f in payload['Doctor']]}"
    return "already present"


def ensure_trf_referred_doctor_link():
    """Link Customer TRF → Doctor for commission reports (keeps text referred_doctor for print)."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("DocType", "Customer TRF"):
        return "Customer TRF missing"
    meta = frappe.get_meta("Customer TRF")
    if meta.has_field("referred_doctor_id"):
        return "referred_doctor_id already present"

    insert_after = "referred_doctor" if meta.has_field("referred_doctor") else "patient_phone"
    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "referred_doctor_id",
                    "label": "Referred Doctor (link)",
                    "fieldtype": "Link",
                    "options": "Doctor",
                    "insert_after": insert_after,
                    "description": "Linked doctor master for referral commission disbursement",
                }
            ]
        },
        update=True,
    )
    return "referred_doctor_id created"


def ensure_doctor_franchisee_perms():
    """Franchisee Operators need to search and append referring doctors while booking."""
    if not frappe.db.exists("DocType", "Doctor"):
        return "Doctor missing"
    if not frappe.db.exists("Role", "Franchisee Operator"):
        return "role missing"

    existing = frappe.db.exists(
        "Custom DocPerm",
        {"parent": "Doctor", "role": "Franchisee Operator", "permlevel": 0},
    )
    if existing:
        return "perm already present"

    # Prefer DocType permission row via get_doc if role already listed
    doc = frappe.get_doc("DocType", "Doctor")
    roles = {p.role for p in doc.permissions}
    if "Franchisee Operator" not in roles:
        doc.append(
            "permissions",
            {
                "role": "Franchisee Operator",
                "read": 1,
                "write": 1,
                "create": 1,
                "export": 1,
                "report": 1,
            },
        )
        doc.save(ignore_permissions=True)
        return "Franchisee Operator perm added"
    return "role already on DocType"


def normalize_self(value):
    text = (value or "").strip()
    if not text or text.lower() in ("self", "na", "n/a", "none", "-"):
        return "Self"
    return text


@frappe.whitelist()
def api_create_hec_doctor(
    doctor_name=None,
    mobile=None,
    address=None,
    territory=None,
    email=None,
):
    """Append a referring doctor from franchisee hub bill entry."""
    doctor_name = (doctor_name or frappe.form_dict.get("doctor_name") or "").strip()
    mobile = (mobile or frappe.form_dict.get("mobile") or "").strip()
    address = (address or frappe.form_dict.get("address") or "").strip()
    territory = (territory or frappe.form_dict.get("territory") or "").strip()
    email = (email or frappe.form_dict.get("email") or "").strip()

    if not doctor_name:
        frappe.throw(_("Doctor name is required"))
    if doctor_name.lower() == "self":
        frappe.throw(_("Use Self from the picker — do not create a doctor named Self"))
    if not mobile:
        frappe.throw(_("Phone number is required for referral commission payouts"))

    if not frappe.db.exists("DocType", "Doctor"):
        frappe.throw(_("Doctor master is not available"))

    # Reuse an Active doctor with same name + mobile when possible
    meta = frappe.get_meta("Doctor")
    filters = {}
    if meta.has_field("doctor_name"):
        filters["doctor_name"] = doctor_name
    if meta.has_field("mobile"):
        filters["mobile"] = mobile
    if filters:
        existing = frappe.db.get_value("Doctor", filters, "name")
        if existing:
            doc = frappe.get_doc("Doctor", existing)
            changed = False
            if meta.has_field("address") and address and doc.get("address") != address:
                doc.address = address
                changed = True
            if meta.has_field("territory") and territory and doc.get("territory") != territory:
                doc.territory = territory
                changed = True
            if meta.has_field("is_referring_doctor") and not cint(doc.get("is_referring_doctor")):
                doc.is_referring_doctor = 1
                changed = True
            if changed:
                doc.save(ignore_permissions=True)
            return {
                "ok": True,
                "created": False,
                "doctor": _doctor_payload(doc),
            }

    doc = frappe.new_doc("Doctor")
    doc.doctor_name = doctor_name
    if meta.has_field("mobile"):
        doc.mobile = mobile
    if meta.has_field("email") and email:
        doc.email = email
    if meta.has_field("address"):
        doc.address = address
    if meta.has_field("territory"):
        doc.territory = territory
    if meta.has_field("status"):
        doc.status = "Active"
    if meta.has_field("is_referring_doctor"):
        doc.is_referring_doctor = 1
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "created": True, "doctor": _doctor_payload(doc)}


def _doctor_payload(doc):
    dname = doc.get("doctor_name") or doc.name
    return {
        "name": doc.name,
        "doctor_name": dname,
        "mobile": doc.get("mobile") or "",
        "address": doc.get("address") or "",
        "territory": doc.get("territory") or "",
        "is_referring_doctor": cint(doc.get("is_referring_doctor")),
        "label": f"{dname} ({doc.name})",
    }


def setup_phase78():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
        ensure_trf_referred_doctor_field,
    )

    results = {}
    trf_meta = frappe.get_meta("Customer TRF") if frappe.db.exists("DocType", "Customer TRF") else None
    if trf_meta and trf_meta.has_field("referred_doctor"):
        results["trf_text"] = "referred_doctor already present"
    else:
        try:
            results["trf_text"] = ensure_trf_referred_doctor_field()
        except Exception as exc:
            results["trf_text"] = f"skipped: {exc}"

    try:
        results["trf_link"] = ensure_trf_referred_doctor_link()
    except Exception as exc:
        results["trf_link"] = f"error: {exc}"

    try:
        results["doctor_fields"] = ensure_doctor_referral_fields()
    except Exception as exc:
        results["doctor_fields"] = f"error: {exc}"

    try:
        results["doctor_perms"] = ensure_doctor_franchisee_perms()
    except Exception as exc:
        results["doctor_perms"] = f"error: {exc}"

    frappe.clear_cache(doctype="Doctor")
    frappe.clear_cache(doctype="Customer TRF")
    frappe.db.commit()
    return results


def smoke_phase78():
    result = {"checks": [], "ok": True}

    def check(name, passed, detail=None):
        result["checks"].append({"name": name, "pass": bool(passed), "detail": detail})
        if not passed:
            result["ok"] = False

    meta = frappe.get_meta("Doctor") if frappe.db.exists("DocType", "Doctor") else None
    check("doctor_doctype", bool(meta))
    check("doctor_address", bool(meta and meta.has_field("address")))
    check("doctor_territory", bool(meta and meta.has_field("territory")))
    check("doctor_mobile", bool(meta and meta.has_field("mobile")))
    trf_meta = frappe.get_meta("Customer TRF") if frappe.db.exists("DocType", "Customer TRF") else None
    check("trf_referred_text", bool(trf_meta and trf_meta.has_field("referred_doctor")))
    check("trf_referred_link", bool(trf_meta and trf_meta.has_field("referred_doctor_id")))

    from health_ecosystem_core.health_ecosystem_core import clinical_phase70_lab_bill_entry as bill

    check("search_api", hasattr(bill, "api_search_hec_doctors"))
    check("create_api", hasattr(bill, "api_create_hec_doctor"))
    return result
