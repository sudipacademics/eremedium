"""Phase 44 — Health insurance agent portal (GIC / LIC products + quote requests)."""

from __future__ import annotations

import os

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)


def _sync_doctypes():
    from frappe.modules.import_file import import_file_by_path

    bases = []
    try:
        bases.append(os.path.join(
            frappe.get_app_path("health_ecosystem_core"),
            "health_ecosystem_core",
            "health_ecosystem_core",
            "doctype",
        ))
    except Exception:
        pass
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        bases.append(os.path.join(os.path.dirname(api_mod.__file__), "doctype"))
    except Exception:
        pass

    for base in bases:
        if not os.path.isdir(base):
            continue
        for rel in (
            "health_insurance_product/health_insurance_product.json",
            "insurance_quote_request/insurance_quote_request.json",
        ):
            path = os.path.join(base, rel)
            if os.path.isfile(path):
                import_file_by_path(path, force=True)
    frappe.clear_cache()


def _serialize_product(row):
    if isinstance(row, str):
        row = frappe.get_doc("Health Insurance Product", row).as_dict()
    highlights = (row.get("highlights") or "").split(",") if row.get("highlights") else []
    return {
        "product_code": row.get("product_code") or row.get("name"),
        "product_name": row.get("product_name"),
        "insurer": row.get("insurer"),
        "category": row.get("category"),
        "sum_insured_from": flt(row.get("sum_insured_from")),
        "sum_insured_to": flt(row.get("sum_insured_to")),
        "premium_from": flt(row.get("premium_from")),
        "highlights": [h.strip() for h in highlights if h.strip()],
        "description": row.get("description"),
        "brochure_url": row.get("brochure_url"),
    }


SEED_PRODUCTS = [
    {
        "product_code": "GIC-MEDICLAIM-IND",
        "product_name": "National Mediclaim Individual",
        "insurer": "GIC",
        "category": "Individual",
        "sum_insured_from": 300000,
        "sum_insured_to": 2000000,
        "premium_from": 8500,
        "highlights": "Cashless at 8000+ hospitals,Pre-existing after 4 years,Ambulance cover",
        "description": "Comprehensive individual health cover under GIC mediclaim portfolio.",
        "display_order": 1,
    },
    {
        "product_code": "GIC-FAMILY-FLOater",
        "product_name": "Family Floater Health",
        "insurer": "GIC",
        "category": "Family",
        "sum_insured_from": 500000,
        "sum_insured_to": 5000000,
        "premium_from": 14000,
        "highlights": "Single policy for family,Restoration benefit,Maternity add-on",
        "description": "Family floater plan — one sum insured shared across spouse and children.",
        "display_order": 2,
    },
    {
        "product_code": "LIC-Jeevan-Arogya",
        "product_name": "LIC Jeevan Arogya",
        "insurer": "LIC",
        "category": "Individual",
        "sum_insured_from": 100000,
        "sum_insured_to": 400000,
        "premium_from": 4200,
        "highlights": "Defined benefit on hospitalization,No medical tests up to 45 years,LIC trust",
        "description": "Non-linked health insurance plan from Life Insurance Corporation of India.",
        "display_order": 3,
    },
    {
        "product_code": "LIC-Cancer-Cover",
        "product_name": "LIC Cancer Cover",
        "insurer": "LIC",
        "category": "Critical Illness",
        "sum_insured_from": 1000000,
        "sum_insured_to": 5000000,
        "premium_from": 6500,
        "highlights": "Lump sum on cancer diagnosis,All stages covered,Affordable premiums",
        "description": "Critical illness cover focused on cancer — lump sum payout on diagnosis.",
        "display_order": 4,
    },
    {
        "product_code": "GIC-SENIOR-SHIELD",
        "product_name": "Senior Citizen Shield",
        "insurer": "GIC",
        "category": "Senior Citizen",
        "sum_insured_from": 300000,
        "sum_insured_to": 1000000,
        "premium_from": 18000,
        "highlights": "Entry age up to 80,Domiciliary treatment,Annual health check-up",
        "description": "Tailored health insurance for senior citizens with enhanced domiciliary benefits.",
        "display_order": 5,
    },
    {
        "product_code": "GIC-SUPER-TOPUP",
        "product_name": "Super Top-up Health",
        "insurer": "GIC",
        "category": "Top-up",
        "sum_insured_from": 500000,
        "sum_insured_to": 2000000,
        "premium_from": 3500,
        "highlights": "Low premium booster,Works with base policy,Deductible options",
        "description": "Enhance existing cover with an affordable super top-up plan.",
        "display_order": 6,
    },
]


def seed_insurance_products():
    if not frappe.db.exists("DocType", "Health Insurance Product"):
        return []
    created = []
    for spec in SEED_PRODUCTS:
        code = spec["product_code"]
        if frappe.db.exists("Health Insurance Product", code):
            doc = frappe.get_doc("Health Insurance Product", code)
            changed = False
            for k, v in spec.items():
                if doc.get(k) != v:
                    doc.set(k, v)
                    changed = True
            if not doc.enabled:
                doc.enabled = 1
                changed = True
            if changed:
                doc.save(ignore_permissions=True)
            continue
        frappe.get_doc({"doctype": "Health Insurance Product", "enabled": 1, **spec}).insert(
            ignore_permissions=True
        )
        created.append(code)
    return created


@frappe.whitelist(allow_guest=True)
def get_insurance_landing():
    """Public insurance page payload — products + agent disclaimer."""
    if not frappe.db.exists("DocType", "Health Insurance Product"):
        return _success({"products": [], "agent_note": ""})

    rows = frappe.get_all(
        "Health Insurance Product",
        filters={"enabled": 1},
        fields=[
            "name",
            "product_code",
            "product_name",
            "insurer",
            "category",
            "sum_insured_from",
            "sum_insured_to",
            "premium_from",
            "highlights",
            "description",
            "brochure_url",
        ],
        order_by="display_order asc, product_name asc",
    )
    return _success(
        {
            "products": [_serialize_product(r) for r in rows],
            "agent_note": (
                "We act as a licensed insurance agent for General Insurance Corporation (GIC) "
                "and Life Insurance Corporation (LIC) health products. Final policy terms are "
                "subject to insurer underwriting."
            ),
            "categories": ["Individual", "Family", "Senior Citizen", "Critical Illness", "Top-up"],
        }
    )


@frappe.whitelist()
def submit_insurance_quote_request(
    product_code=None,
    customer_name=None,
    phone=None,
    email=None,
    sum_insured=None,
    notes=None,
    sid=None,
):
    """Contact / quote lead — product is optional (advisor follows up)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    product_code = (_parse_request_value("product_code", product_code) or "").strip()
    customer_name = (_parse_request_value("customer_name", customer_name) or "").strip()
    phone = (_parse_request_value("phone", phone) or "").strip()
    if not customer_name or not phone:
        return _error(_("Name and mobile are required"))

    product_name = None
    insurer = None
    product = None
    if product_code:
        if not frappe.db.exists("Health Insurance Product", product_code):
            return _error(_("Select a valid insurance product"), 400)
        product = frappe.get_doc("Health Insurance Product", product_code)
        product_name = product.product_name
        insurer = product.insurer

    doc = frappe.get_doc(
        {
            "doctype": "Insurance Quote Request",
            "customer_user": frappe.session.user,
            "customer_name": customer_name,
            "phone": phone,
            "email": email or frappe.session.user,
            "product": product.name if product else None,
            "insurer": insurer,
            "sum_insured": flt(sum_insured),
            "notes": notes,
            "status": "New",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {
            "request_id": doc.name,
            "insurer": insurer,
            "product_name": product_name,
        },
        message=_("Quote request submitted — our insurance advisor will contact you within 24 hours"),
    )


@frappe.whitelist()
def get_my_insurance_requests(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    rows = frappe.get_all(
        "Insurance Quote Request",
        filters={"customer_user": frappe.session.user},
        fields=["name", "product", "insurer", "status", "sum_insured", "creation"],
        order_by="creation desc",
        limit=20,
    )
    for r in rows:
        r["product_name"] = frappe.db.get_value("Health Insurance Product", r.product, "product_name")
    return _success({"requests": rows})


def setup_phase44_insurance():
    _sync_doctypes()
    seeded = seed_insurance_products()
    return {"ok": True, "phase": "44", "feature": "health_insurance_agent", "seeded": seeded}
