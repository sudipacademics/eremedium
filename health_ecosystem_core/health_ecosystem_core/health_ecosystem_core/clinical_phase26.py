"""Phase 26 — Health Circle membership: checkout entitlements + Apollo-style benefits."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import (
    get_entitlements,
    list_subscription_plans,
    subscriptions_ready,
)


def ensure_phase26_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "membership_discount",
                    "label": "Membership Discount",
                    "fieldtype": "Currency",
                    "insert_after": "discount_amount",
                },
                {
                    "fieldname": "membership_plan_code",
                    "label": "Membership Plan",
                    "fieldtype": "Data",
                    "insert_after": "membership_discount",
                },
            ],
            "Pharmacy Order": [
                {
                    "fieldname": "membership_discount",
                    "label": "Membership Discount",
                    "fieldtype": "Currency",
                    "insert_after": "discount_amount",
                },
                {
                    "fieldname": "membership_plan_code",
                    "label": "Membership Plan",
                    "fieldtype": "Data",
                    "insert_after": "membership_discount",
                },
            ],
        },
        update=True,
    )


def _discount_percent(entitlements, context):
    if not entitlements.get("active"):
        return 0
    ctx = (context or "lab").strip().lower()
    if ctx in ("consult", "consultation", "doctor", "appointment"):
        return flt(entitlements.get("consultation_discount_percent"))
    if ctx == "pharmacy":
        return flt(entitlements.get("pharmacy_discount_percent"))
    return flt(entitlements.get("lab_discount_percent"))


def apply_checkout_pricing(user, subtotal, context="lab", promo_code=None, use_wallet=False):
    """Membership discount first, then coupon on the reduced amount, then wallet."""
    subtotal = flt(subtotal)
    if subtotal <= 0:
        frappe.throw(_("Order total must be greater than zero"))

    context = (context or "lab").strip().lower()
    if context in ("diagnostics", "lab diagnostics"):
        context = "lab"
    if context in ("consult", "consultation", "doctor", "appointment"):
        context = "consult"

    entitlements = get_entitlements(user) if user and user != "Guest" else {"active": False}
    pct = _discount_percent(entitlements, context)
    membership_discount = round(subtotal * pct / 100.0, 2) if pct > 0 else 0.0
    after_membership = round(subtotal - membership_discount, 2)

    coupon_discount = 0.0
    applied_code = ""
    final_total = after_membership

    if promo_code:
        from health_ecosystem_core.health_ecosystem_core.clinical_coupons import apply_promo_to_amount

        final_total, coupon_discount, applied_code = apply_promo_to_amount(
            promo_code, after_membership, context
        )

    pricing = {
        "subtotal": subtotal,
        "membership_active": bool(entitlements.get("active")),
        "membership_plan_code": entitlements.get("plan_code") or "",
        "membership_plan_title": entitlements.get("plan_title") or "",
        "membership_discount": membership_discount,
        "membership_discount_percent": pct,
        "after_membership": after_membership,
        "coupon_discount": flt(coupon_discount),
        "promo_code": applied_code,
        "discount_amount": round(membership_discount + flt(coupon_discount), 2),
        "final_total": flt(final_total),
        "free_home_collection": bool(entitlements.get("free_home_collection")),
        "entitlements": entitlements,
    }
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
            apply_wallet_to_pricing,
        )

        pricing = apply_wallet_to_pricing(user, pricing, use_wallet=use_wallet)
    except Exception:
        frappe.log_error(title="apply_wallet_to_pricing", message=frappe.get_traceback())
        pricing.setdefault("wallet_balance", 0)
        pricing.setdefault("wallet_credit", 0)
    return pricing


def preview_checkout(user, subtotal, context="lab", promo_code=None, use_wallet=False):
    return apply_checkout_pricing(user, subtotal, context, promo_code, use_wallet=use_wallet)


def persist_membership_on_doc(doc_data, pricing, meta_doctype):
    """Attach membership fields when custom fields exist."""
    meta = frappe.get_meta(meta_doctype)
    if meta.has_field("membership_discount"):
        doc_data["membership_discount"] = flt(pricing.get("membership_discount"))
    if meta.has_field("membership_plan_code") and pricing.get("membership_plan_code"):
        doc_data["membership_plan_code"] = pricing["membership_plan_code"]


def seed_circle_plans():
    """Apollo Circle–style plan names and benefit tiers."""
    if not subscriptions_ready():
        return []
    specs = [
        {
            "plan_code": "CIRCLE_3M",
            "title": "Health Circle · 3 months",
            "description": "Free home collection · 10% off lab tests · 5% off pharmacy",
            "monthly_price": 99,
            "billing_interval": "Month",
            "free_home_collection": 1,
            "lab_discount_percent": 10,
            "pharmacy_discount_percent": 5,
            "consultation_discount_percent": 5,
            "display_order": 1,
        },
        {
            "plan_code": "CIRCLE_12M",
            "title": "Health Circle · 12 months",
            "description": "Best value — 15% labs, 10% pharmacy, priority home collection",
            "monthly_price": 299,
            "billing_interval": "Year",
            "free_home_collection": 1,
            "lab_discount_percent": 15,
            "pharmacy_discount_percent": 10,
            "consultation_discount_percent": 8,
            "display_order": 2,
        },
        {
            "plan_code": "CIRCLE_FAMILY",
            "title": "Health Circle · Family",
            "description": "20% lab discount · 12% pharmacy · unlimited free home visits",
            "monthly_price": 499,
            "billing_interval": "Month",
            "free_home_collection": 1,
            "lab_discount_percent": 20,
            "pharmacy_discount_percent": 12,
            "consultation_discount_percent": 10,
            "display_order": 3,
        },
    ]
    created = []
    for spec in specs:
        code = spec["plan_code"]
        if frappe.db.exists("Health Subscription Plan", code):
            doc = frappe.get_doc("Health Subscription Plan", code)
            for key, value in spec.items():
                doc.set(key, value)
            doc.enabled = 1
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc({"doctype": "Health Subscription Plan", "enabled": 1, **spec}).insert(
                ignore_permissions=True
            )
            created.append(code)
    return created


def circle_landing_payload():
    plans = list_subscription_plans()
    return {
        "brand": "Health Circle",
        "tagline": "Premium care membership — like Apollo 24|7 Circle",
        "hero_points": [
            "Up to 20% off lab tests & health packages",
            "Up to 12% off pharmacy orders",
            "Free home sample collection on every visit",
            "Member prices applied automatically at checkout",
        ],
        "benefit_cards": [
            {
                "icon": "lab",
                "title": "Lab & packages",
                "text": "Flat member discount on diagnostics and health packages — no coupon needed.",
            },
            {
                "icon": "pharmacy",
                "title": "Pharmacy savings",
                "text": "Extra savings on medicines when you checkout with a prescription.",
            },
            {
                "icon": "home",
                "title": "Free home collection",
                "text": "Phlebotomist visits at no extra charge for Circle members.",
            },
            {
                "icon": "priority",
                "title": "Priority care",
                "text": "Faster booking slots and member support on the Health Ecosystem app.",
            },
        ],
        "comparison": [
            {"feature": "Lab test discount", "guest": "—", "circle": "10–20%"},
            {"feature": "Pharmacy discount", "guest": "—", "circle": "5–12%"},
            {"feature": "Doctor consult discount", "guest": "—", "circle": "5–10%"},
            {"feature": "Home collection fee", "guest": "As per centre", "circle": "Free"},
            {"feature": "Checkout", "guest": "MRP only", "circle": "Auto member price"},
        ],
        "plans": plans,
        "plans_available": bool(plans),
    }


def setup_phase26():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import setup_phase19, repair_pending_subscriptions

    setup_phase19()
    ensure_phase26_custom_fields()
    circle = seed_circle_plans()
    repaired = repair_pending_subscriptions()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 26,
        "circle_plans": circle,
        "repaired_subscriptions": repaired,
        "plan_count": frappe.db.count("Health Subscription Plan") if subscriptions_ready() else 0,
    }
