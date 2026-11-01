"""Phase 54 — Shared company MRP + Vector/Pulse franchisee rate model.

Hard rules:
- Pulse (FFMS) → patient bill = FOCO; platform fee = FOCO − commission value;
  commission value = FOCO × commission %. MRP slashed when FOCO < MRP.
- Vector (Reach) → patient bill = unsashed MRP; platform fee = Vector B2B wholesale
  (mother list, overridable per franchisee via Item Price.customer or custom wholesale list);
  commission % is calculated on that wholesale rate.
- Vector billing stops when wallet + credit_limit cannot cover the platform fee.
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
ONLINE_INTAKE_CHANNEL = "Online / Courier Sample"


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


def price_from_list(item_code, price_list, customer=None):
    """Mother list rate, with optional per-customer (per-franchisee) override."""
    if not item_code:
        return 0
    if price_list:
        if customer:
            row = frappe.db.sql(
                """
                select price_list_rate from `tabItem Price`
                where item_code=%s and price_list=%s and customer=%s
                order by modified desc
                limit 1
                """,
                (item_code, price_list, customer),
            )
            if row and flt(row[0][0]):
                return flt(row[0][0])
        row = frappe.db.sql(
            """
            select price_list_rate from `tabItem Price`
            where item_code=%s and price_list=%s and ifnull(customer, '') = ''
            order by modified desc
            limit 1
            """,
            (item_code, price_list),
        )
        if row and flt(row[0][0]):
            return flt(row[0][0])
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


def _franchisee_rate_context(franchisee_id=None, franchisee_type=None):
    ftype = (franchisee_type or "").strip()
    wholesale_pl = None
    customer = None
    if franchisee_id and frappe.db.exists("Franchisee Profile", franchisee_id):
        row = frappe.db.get_value(
            "Franchisee Profile",
            franchisee_id,
            ["franchisee_type", "wholesale_price_list", "platform_customer"],
            as_dict=True,
        )
        if row:
            if not ftype:
                ftype = (row.franchisee_type or "").strip()
            wholesale_pl = row.wholesale_price_list
            if (ftype or row.franchisee_type) == "Vector":
                customer = row.platform_customer
    if ftype not in FRANCHISEE_TYPES:
        ftype = "Pulse"
    return ftype, wholesale_pl, customer


def franchisee_rate(item_code, franchisee_type=None, franchisee_id=None):
    """Pulse FOCO, or Vector wholesale (franchisee override then mother list)."""
    ftype, wholesale_pl, customer = _franchisee_rate_context(franchisee_id, franchisee_type)
    mother = franchisee_rate_price_list(ftype)
    if ftype == "Vector" and wholesale_pl and wholesale_pl not in (mother, PULSE_PRICE_LIST):
        rate = price_from_list(item_code, wholesale_pl, customer=customer)
        if rate:
            return rate
    return price_from_list(item_code, mother, customer=customer if ftype == "Vector" else None)


def foco_rate(item_code):
    """FOCO / Pulse wholesale rate."""
    return franchisee_rate(item_code, franchisee_type="Pulse")


def patient_bill_pricing(item_code, franchisee_id=None, franchisee_type=None, intake_channel=None):
    """Canonical patient bill line rate.

    Pulse (FFMS) → FOCO, MRP slashed when higher.
    Vector (Reach) → unsashed MRP. Online/courier does not override Vector.
    """
    ensure_shared_rate_price_lists()
    mrp = mrp_rate(item_code)
    foco = foco_rate(item_code)
    vector = franchisee_rate(item_code, franchisee_type="Vector", franchisee_id=franchisee_id)

    ftype = (franchisee_type or "").strip()
    if not ftype and franchisee_id:
        ftype = (frappe.db.get_value("Franchisee Profile", franchisee_id, "franchisee_type") or "Pulse").strip()
    if ftype not in FRANCHISEE_TYPES:
        ftype = "Pulse"

    channel = (intake_channel or "").strip()
    if ftype == "Pulse":
        bill_rate = foco or mrp
        show_mrp_slash = bool(mrp and bill_rate and mrp > bill_rate)
        price_basis = "foco"
    else:
        bill_rate = mrp or vector
        show_mrp_slash = False
        price_basis = "mrp"

    return {
        "rate": flt(bill_rate),
        "mrp": flt(mrp),
        "foco_rate": flt(foco),
        "vector_rate": flt(vector),
        "show_mrp_slash": show_mrp_slash,
        "price_basis": price_basis,
        "franchisee_type": ftype,
        "intake_channel": channel,
    }


def _partner_tier_line(item_code, franchisee_id, qty):
    """Phase 126 circuit pricing for this line, or None (not on the circuit / no tier rates / unmapped)."""
    if not franchisee_id:
        return None
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
            tier_settlement,
            vector_tier_settlement,
        )

        vector = vector_tier_settlement(item_code, franchisee_id, qty)
        if vector:
            # Mapped Vector: patient bill stays MRP (dummy); the fee shown is the B2B amount owed to the entry partner.
            return {"vector": True, "debit_per_unit": vector["b2b_rate"], "patient_rate": None}
        return tier_settlement(item_code, franchisee_id, qty)
    except frappe.ValidationError:
        # Unmapped circuit: billing itself refuses; pricing falls back so catalogs still load.
        return None
    except Exception:
        frappe.log_error(title="phase54_partner_tier_line", message=frappe.get_traceback())
        return None


def line_settlement(item_code, franchisee_id=None, franchisee_type=None, intake_channel=None, qty=1):
    """Patient rate + platform fee + commission for one test line.

    Pulse: patient = FOCO; commission = FOCO × %; platform fee = FOCO − commission.
    Vector: patient = MRP; platform fee = wholesale; commission = wholesale × %.
    """
    pricing = patient_bill_pricing(
        item_code,
        franchisee_id=franchisee_id,
        franchisee_type=franchisee_type,
        intake_channel=intake_channel,
    )
    ftype = pricing["franchisee_type"]
    qty = flt(qty) or 1
    comm_pct = 0.0
    if franchisee_id and frappe.db.exists("Franchisee Profile", franchisee_id):
        comm_pct = flt(frappe.db.get_value("Franchisee Profile", franchisee_id, "commission_percentage_rate"))

    if ftype == "Pulse":
        patient = pricing["foco_rate"] or pricing["rate"]
        commission_value = round(patient * comm_pct / 100.0, 2)
        platform_fee = max(round(patient - commission_value, 2), 0)
        show_slash = bool(pricing["mrp"] and patient and pricing["mrp"] > patient)
        price_basis = "foco"
    else:
        patient = pricing["mrp"] or pricing["rate"]
        wholesale = franchisee_rate(item_code, franchisee_type="Vector", franchisee_id=franchisee_id)
        commission_value = round(wholesale * comm_pct / 100.0, 2)
        platform_fee = wholesale
        show_slash = False
        price_basis = "mrp"

    tier = _partner_tier_line(item_code, franchisee_id, qty)
    if tier:
        if tier.get("patient_rate"):
            # FOCO module (FOCO, or Master / Orange FOCO with Phlebotomist Service) bills patients the FOCO rate.
            patient = tier["patient_rate"]
            show_slash = bool(pricing["mrp"] and patient and pricing["mrp"] > patient)
            price_basis = "partner_tier"
        if tier.get("vector"):
            price_basis = "vector_b2b"
        platform_fee = tier["debit_per_unit"]
        commission_value = max(round(flt(patient) - platform_fee, 2), 0)

    return {
        **pricing,
        "rate": flt(patient),
        "show_mrp_slash": show_slash,
        "price_basis": price_basis,
        "platform_fee": flt(platform_fee),
        "commission_value": flt(commission_value),
        "commission_percent": flt(comm_pct),
        "qty": qty,
        "platform_fee_amount": round(platform_fee * qty, 2),
        "commission_amount": round(commission_value * qty, 2),
    }


def apply_patient_bill_rates_to_lines(tests, franchisee_id=None, franchisee_type=None, intake_channel=None):
    """Re-price bill test rows using Pulse/Vector settlement (ignores client-supplied rate)."""
    out = []
    for row in tests or []:
        code = (row.get("item") or row.get("item_code") or row.get("code") or "").strip()
        if not code:
            continue
        qty = flt(row.get("qty")) or 1
        pricing = line_settlement(
            code,
            franchisee_id=franchisee_id,
            franchisee_type=franchisee_type,
            intake_channel=intake_channel,
            qty=qty,
        )
        merged = dict(row)
        merged["item"] = code
        merged["item_code"] = code
        merged["rate"] = pricing["rate"]
        merged["mrp"] = pricing["mrp"]
        merged["foco_rate"] = pricing["foco_rate"]
        merged["show_mrp_slash"] = pricing["show_mrp_slash"]
        merged["price_basis"] = pricing["price_basis"]
        merged["platform_fee"] = pricing["platform_fee"]
        merged["commission_value"] = pricing["commission_value"]
        merged["commission_percent"] = pricing["commission_percent"]
        merged["franchisee_type"] = pricing["franchisee_type"]
        if not merged.get("item_name"):
            merged["item_name"] = frappe.db.get_value("Item", code, "item_name") or code
        out.append(merged)
    return out


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
                "description": "Pulse commission is on FOCO; Vector commission is on wholesale. Kept for legacy reports.",
            }
        )
    if not meta.has_field("credit_limit"):
        fields.append(
            {
                "fieldname": "credit_limit",
                "label": "Credit Limit",
                "fieldtype": "Currency",
                "default": "0",
                "insert_after": "wallet_balance",
                "description": "Vector only: billing stops when wallet + credit limit cannot cover the platform fee.",
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
    mother_pl = franchisee_rate_price_list(ftype)

    # Always shared company MRP — overwrite any per-branch B2B-*-MRP leftovers
    if profile.get("retail_price_list") != mrp_pl:
        profile.db_set("retail_price_list", mrp_pl)

    current_ws = (profile.get("wholesale_price_list") or "").strip()
    if ftype == "Pulse":
        rate_pl = PULSE_PRICE_LIST
        if current_ws != rate_pl:
            profile.db_set("wholesale_price_list", rate_pl)
    else:
        # Keep a dedicated Vector wholesale list if already assigned; else mother list.
        # Per-franchisee edits also live as Item Price.customer on the mother list.
        if current_ws and current_ws != PULSE_PRICE_LIST:
            rate_pl = current_ws
        else:
            rate_pl = VECTOR_PRICE_LIST
            if current_ws != rate_pl:
                profile.db_set("wholesale_price_list", rate_pl)

    return {
        "retail_price_list": mrp_pl,
        "wholesale_price_list": rate_pl,
        "franchisee_type": ftype,
        "commission_base": profile.get("commission_base") or "Franchisee Rate",
        "mother_wholesale_list": mother_pl,
    }


def commission_base_amount_for_trf(trf, profile=None):
    """Pulse commission on FOCO; Vector commission on wholesale (not on MRP / platform fee)."""
    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)
    franchisee_id = getattr(trf, "franchisee_id", None)
    if not profile and franchisee_id:
        profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile:
        return flt(trf.amount)

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    ftype = (profile.get("franchisee_type") or "Pulse").strip()
    total = 0.0
    lines = get_trf_test_lines(trf)
    for line in lines:
        if ftype == "Vector":
            rate = franchisee_rate(
                line["item_code"],
                franchisee_type="Vector",
                franchisee_id=profile.name,
            )
        else:
            rate = foco_rate(line["item_code"])
        qty = flt(line.get("qty")) or 1
        total += rate * qty
    if total > 0:
        return total
    if ftype == "Pulse":
        return flt(trf.amount)
    wholesale = flt(getattr(trf, "wholesale_amount", None) or 0)
    if wholesale > 0:
        return wholesale
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
    """Disable legacy B2B-{branch}-MRP lists. Keep wholesale lists still assigned to a Vector."""
    assigned = set(
        frappe.get_all(
            "Franchisee Profile",
            filters={"wholesale_price_list": ("like", "B2B-%")},
            pluck="wholesale_price_list",
        )
        or []
    )
    orphan = frappe.get_all(
        "Price List",
        filters={"name": ("like", "B2B-%")},
        fields=["name", "enabled"],
    )
    disabled = []
    skipped = []
    for row in orphan:
        if row.name in assigned:
            skipped.append(row.name)
            continue
        if dry_run:
            disabled.append(row.name)
            continue
        if row.enabled:
            frappe.db.set_value("Price List", row.name, "enabled", 0)
            disabled.append(row.name)
    if not dry_run:
        frappe.db.commit()
    return {"dry_run": dry_run, "orphans": disabled, "kept_assigned": skipped, "count": len(disabled)}


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
