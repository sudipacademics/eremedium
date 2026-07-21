"""Phase 54 — Shared company MRP + Vector/Pulse franchisee rate model.

Rules:
- Company MRP (Standard Selling Rate / selling price list) is singular for all franchisees.
- Never create per-franchisee MRP Item Price rows.
- Franchisee types:
  - Vector → Remedium Vector Wholesale (B2B wholesale)
  - Pulse  → Remedium FOCO Wholesale (FOCO rate)
- Patient-facing display always uses company MRP.
- Franchisee commission is calculated on the franchisee rate by default,
  with an admin toggle to use MRP instead.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

VECTOR_PRICE_LIST = "Remedium Vector Wholesale"
PULSE_PRICE_LIST = "Remedium FOCO Wholesale"
FRANCHISEE_TYPES = ("Vector", "Pulse")
COMMISSION_BASES = ("Franchisee Rate", "MRP")


def company_mrp_price_list():
    return (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        or "Standard Selling"
    )


def _ensure_price_list(name, currency="INR"):
    if frappe.db.exists("Price List", name):
        doc = frappe.get_doc("Price List", name)
        if not doc.enabled:
            doc.enabled = 1
            doc.save(ignore_permissions=True)
        return name
    frappe.get_doc(
        {
            "doctype": "Price List",
            "price_list_name": name,
            "currency": currency,
            "enabled": 1,
            "selling": 1,
        }
    ).insert(ignore_permissions=True)
    return name


def ensure_shared_rate_price_lists():
    """Ensure company MRP + singular Vector + Pulse price lists exist."""
    mrp = company_mrp_price_list()
    _ensure_price_list(mrp)
    _ensure_price_list(VECTOR_PRICE_LIST)
    _ensure_price_list(PULSE_PRICE_LIST)
    _bootstrap_vector_from_pulse_if_empty()
    return {
        "mrp_price_list": mrp,
        "vector_price_list": VECTOR_PRICE_LIST,
        "pulse_price_list": PULSE_PRICE_LIST,
    }


def _bootstrap_vector_from_pulse_if_empty():
    """If Vector list has no rates yet, copy Pulse/FOCO as a starter (editable thereafter)."""
    vector_count = frappe.db.count("Item Price", {"price_list": VECTOR_PRICE_LIST})
    if vector_count:
        return 0
    pulse_rows = frappe.get_all(
        "Item Price",
        filters={"price_list": PULSE_PRICE_LIST},
        fields=["item_code", "price_list_rate"],
        limit=5000,
    )
    if not pulse_rows:
        return 0
    created = 0
    for row in pulse_rows:
        if not flt(row.price_list_rate):
            continue
        if frappe.db.exists("Item Price", {"item_code": row.item_code, "price_list": VECTOR_PRICE_LIST}):
            continue
        frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": row.item_code,
                "price_list": VECTOR_PRICE_LIST,
                "price_list_rate": flt(row.price_list_rate),
                "selling": 1,
            }
        ).insert(ignore_permissions=True)
        created += 1
    return created


def franchisee_rate_price_list(franchisee_type):
    franchisee_type = (franchisee_type or "Pulse").strip()
    if franchisee_type == "Vector":
        return VECTOR_PRICE_LIST
    return PULSE_PRICE_LIST


def price_from_list(item_code, price_list):
    if not item_code:
        return 0
    if price_list:
        rate = frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list},
            "price_list_rate",
        )
        if rate:
            return flt(rate)
    return flt(frappe.db.get_value("Item", item_code, "standard_rate"))


def mrp_rate(item_code):
    """Company MRP — Standard Selling price list, then Item.standard_rate."""
    return price_from_list(item_code, company_mrp_price_list())


def franchisee_rate(item_code, franchisee_type=None, franchisee_id=None):
    """Singular Vector or Pulse rate for an item."""
    ftype = franchisee_type
    if not ftype and franchisee_id:
        ftype = frappe.db.get_value("Franchisee Profile", franchisee_id, "franchisee_type")
    return price_from_list(item_code, franchisee_rate_price_list(ftype or "Pulse"))


def ensure_franchisee_profile_rate_fields():
    """Custom fields for sites that already migrated Franchisee Profile without JSON update."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    meta = frappe.get_meta("Franchisee Profile")
    needed = {}
    fields = []
    if not meta.has_field("franchisee_type"):
        fields.append(
            {
                "fieldname": "franchisee_type",
                "label": "Franchisee Type",
                "fieldtype": "Select",
                "options": "\n".join(FRANCHISEE_TYPES),
                "default": "Pulse",
                "insert_after": "commission_percentage_rate",
                "reqd": 1,
            }
        )
    if not meta.has_field("commission_base"):
        fields.append(
            {
                "fieldname": "commission_base",
                "label": "Commission Base",
                "fieldtype": "Select",
                "options": "\n".join(COMMISSION_BASES),
                "default": "Franchisee Rate",
                "insert_after": "franchisee_type",
                "description": "Calculate franchisee commission on Franchisee Rate (Vector/Pulse) or company MRP",
            }
        )
    if fields:
        create_custom_fields({"Franchisee Profile": fields}, update=True)
    return needed


def assign_shared_price_lists(profile):
    """Point franchisee at shared MRP + Vector/Pulse lists — never clone MRP per branch."""
    if isinstance(profile, str):
        profile = frappe.get_doc("Franchisee Profile", profile)

    lists = ensure_shared_rate_price_lists()
    ftype = (profile.get("franchisee_type") or "Pulse").strip()
    if ftype not in FRANCHISEE_TYPES:
        ftype = "Pulse"
        profile.db_set("franchisee_type", ftype)

    if not profile.get("commission_base") or profile.get("commission_base") not in COMMISSION_BASES:
        profile.db_set("commission_base", "Franchisee Rate")

    mrp_pl = lists["mrp_price_list"]
    rate_pl = franchisee_rate_price_list(ftype)

    # Always shared company MRP — overwrite any per-branch B2B-*-MRP leftovers
    if profile.get("retail_price_list") != mrp_pl:
        profile.db_set("retail_price_list", mrp_pl)
    if profile.get("wholesale_price_list") != rate_pl:
        profile.db_set("wholesale_price_list", rate_pl)

    return {
        "retail_price_list": mrp_pl,
        "wholesale_price_list": rate_pl,
        "franchisee_type": ftype,
        "commission_base": profile.get("commission_base") or "Franchisee Rate",
    }


def commission_base_amount_for_trf(trf, profile=None):
    """Amount used for franchisee commission % — franchisee rate or MRP per toggle."""
    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)
    franchisee_id = getattr(trf, "franchisee_id", None)
    if not profile and franchisee_id:
        profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile:
        return flt(trf.amount)

    base = (profile.get("commission_base") or "Franchisee Rate").strip()
    if base == "MRP":
        return flt(trf.amount)

    # Prefer stored wholesale (platform / franchisee rate) when present
    wholesale = flt(getattr(trf, "wholesale_amount", None) or 0)
    if wholesale > 0:
        return wholesale

    # Resolve from Vector/Pulse price list for test lines
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    ftype = profile.get("franchisee_type") or "Pulse"
    total = 0.0
    lines = get_trf_test_lines(trf)
    for line in lines:
        rate = franchisee_rate(line["item_code"], franchisee_type=ftype)
        qty = flt(line.get("qty")) or 1
        total += rate * qty
    if total > 0:
        return total
    # Fallback: if franchisee list missing rates, do not use MRP unless toggle says so
    return flt(trf.amount)


def calculate_franchisee_commission(trf, profile=None):
    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)
    franchisee_id = getattr(trf, "franchisee_id", None)
    if not profile and franchisee_id:
        profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile:
        return 0
    rate = flt(profile.commission_percentage_rate) / 100.0
    base = commission_base_amount_for_trf(trf, profile)
    return round(base * rate, 2)


def sum_commission_for_trfs(trfs, profile):
    total = 0.0
    for trf in trfs:
        total += calculate_franchisee_commission(trf, profile)
    return round(total, 2)


def migrate_all_franchisees_to_shared_lists():
    ensure_franchisee_profile_rate_fields()
    lists = ensure_shared_rate_price_lists()
    updated = []
    for name in frappe.get_all("Franchisee Profile", pluck="name"):
        profile = frappe.get_doc("Franchisee Profile", name)
        if not profile.get("franchisee_type"):
            profile.db_set("franchisee_type", "Pulse")
        if not profile.get("commission_base"):
            profile.db_set("commission_base", "Franchisee Rate")
        result = assign_shared_price_lists(profile)
        updated.append({"franchisee": name, **result})
    frappe.db.commit()
    return {"ok": True, "lists": lists, "franchisees": updated}


def disable_orphan_branch_price_lists(dry_run=True):
    """Disable legacy B2B-{branch}-MRP / Wholesale lists that were wrongly cloned."""
    orphan = frappe.get_all(
        "Price List",
        filters={"name": ("like", "B2B-%")},
        fields=["name", "enabled"],
    )
    disabled = []
    for row in orphan:
        if dry_run:
            disabled.append(row.name)
            continue
        if row.enabled:
            frappe.db.set_value("Price List", row.name, "enabled", 0)
            disabled.append(row.name)
    if not dry_run:
        frappe.db.commit()
    return {"dry_run": dry_run, "orphans": disabled, "count": len(disabled)}


@frappe.whitelist()
def update_franchisee_commission_settings(franchisee_id=None, commission_base=None, franchisee_type=None, sid=None):
    """Franchisee admin can toggle commission base; staff can also set type."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    roles = _user_roles()
    franchisee_id = _parse_request_value("franchisee_id", franchisee_id)
    if not franchisee_id:
        franchisee_id = frappe.db.get_value("Franchisee Profile", {"linked_user": frappe.session.user}, "name")
    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        return _error(_("Franchisee profile not found"), 404)

    own = frappe.db.get_value("Franchisee Profile", {"linked_user": frappe.session.user}, "name")
    staff = is_staff(roles) or "System Manager" in roles or "Health System Admin" in roles
    if not staff and own != franchisee_id:
        return _error(_("Not authorized"), 403)

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    commission_base = (_parse_request_value("commission_base", commission_base) or "").strip()
    franchisee_type = (_parse_request_value("franchisee_type", franchisee_type) or "").strip()

    if commission_base:
        if commission_base not in COMMISSION_BASES:
            return _error(_("Invalid commission base"), 400)
        profile.db_set("commission_base", commission_base)

    if franchisee_type:
        if not staff:
            return _error(_("Only admins can change franchisee type"), 403)
        if franchisee_type not in FRANCHISEE_TYPES:
            return _error(_("Invalid franchisee type"), 400)
        profile.db_set("franchisee_type", franchisee_type)

    assign_shared_price_lists(profile.name)
    profile.reload()
    frappe.db.commit()
    return _success(
        {
            "franchisee_id": profile.name,
            "franchisee_type": profile.get("franchisee_type"),
            "commission_base": profile.get("commission_base"),
            "retail_price_list": profile.get("retail_price_list"),
            "wholesale_price_list": profile.get("wholesale_price_list"),
            "commission_percentage_rate": flt(profile.commission_percentage_rate),
        }
    )


def setup_phase54_franchisee_rate_model():
    ensure_franchisee_profile_rate_fields()
    result = migrate_all_franchisees_to_shared_lists()
    orphans = disable_orphan_branch_price_lists(dry_run=False)
    return {
        "ok": True,
        "phase": "54",
        "feature": "franchisee_rate_model",
        "migration": result,
        "orphans_disabled": orphans,
    }
