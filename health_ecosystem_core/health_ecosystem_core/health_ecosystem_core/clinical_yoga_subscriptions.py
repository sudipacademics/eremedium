"""Yoga & Mindfulness subscription plans and catalog integration."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import (
    list_subscription_plans,
    serialize_plan,
    subscriptions_ready,
)

YOGA_WING = {
    "id": "yoga",
    "title": "Yoga & Mindfulness",
    "subtitle": "Group classes, breathwork & guided meditation",
    "item_group": "Yoga & Mindfulness",
    "department_name": "Yoga & Mindfulness",
    "consultation_type": "Allied Yoga Session",
    "icon": "🧘‍♀️",
    "color": "#8B5CF6",
    "image": "/wellness/yoga.svg",
}

YOGA_PLANS = [
    {
        "plan_code": "YOGA_STARTER",
        "title": "Yoga Starter",
        "description": "4 live group classes per month + on-demand meditation library",
        "monthly_price": 499,
        "billing_interval": "Month",
        "plan_category": "Yoga",
        "wellness_wing": "yoga",
        "included_sessions_per_month": 4,
        "online_access": 1,
        "display_order": 10,
    },
    {
        "plan_code": "YOGA_UNLIMITED",
        "title": "Yoga Unlimited",
        "description": "Unlimited group classes + 2 private yoga sessions every month",
        "monthly_price": 999,
        "billing_interval": "Month",
        "plan_category": "Yoga",
        "wellness_wing": "yoga",
        "included_sessions_per_month": 0,
        "online_access": 1,
        "display_order": 11,
    },
    {
        "plan_code": "YOGA_ANNUAL",
        "title": "Yoga Annual Pass",
        "description": "Unlimited classes all year + quarterly wellness check-in with instructor",
        "monthly_price": 8999,
        "billing_interval": "Year",
        "plan_category": "Yoga",
        "wellness_wing": "yoga",
        "included_sessions_per_month": 0,
        "online_access": 1,
        "display_order": 12,
    },
]


def ensure_yoga_plan_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Subscription Plan": [
                {
                    "fieldname": "plan_category",
                    "label": "Plan Category",
                    "fieldtype": "Select",
                    "options": "Health\nYoga",
                    "default": "Health",
                    "insert_after": "billing_interval",
                    "in_list_view": 1,
                },
                {
                    "fieldname": "wellness_wing",
                    "label": "Wellness Wing",
                    "fieldtype": "Data",
                    "insert_after": "plan_category",
                },
                {
                    "fieldname": "included_sessions_per_month",
                    "label": "Included Sessions / Month",
                    "fieldtype": "Int",
                    "description": "0 = unlimited for yoga memberships",
                    "insert_after": "wellness_wing",
                },
                {
                    "fieldname": "online_access",
                    "label": "Online class access",
                    "fieldtype": "Check",
                    "default": "0",
                    "insert_after": "included_sessions_per_month",
                },
            ],
        },
        update=True,
    )


def seed_yoga_subscription_plans():
    if not subscriptions_ready():
        return []
    ensure_yoga_plan_fields()
    created = []
    for spec in YOGA_PLANS:
        code = spec["plan_code"]
        if frappe.db.exists("Health Subscription Plan", code):
            doc = frappe.get_doc("Health Subscription Plan", code)
            changed = False
            for key, value in spec.items():
                if doc.get(key) != value:
                    doc.set(key, value)
                    changed = True
            if not doc.enabled:
                doc.enabled = 1
                changed = True
            if changed:
                doc.save(ignore_permissions=True)
            continue
        frappe.get_doc({"doctype": "Health Subscription Plan", "enabled": 1, **spec}).insert(
            ignore_permissions=True
        )
        created.append(code)
    return created


def tag_health_plans_category():
    """Ensure Circle / family plans stay in Health category."""
    if not subscriptions_ready():
        return
    for row in frappe.get_all("Health Subscription Plan", pluck="name"):
        if not frappe.db.get_value("Health Subscription Plan", row, "plan_category"):
            frappe.db.set_value("Health Subscription Plan", row, "plan_category", "Health", update_modified=False)


def serialize_yoga_plan(row):
    if isinstance(row, str):
        row = frappe.db.get_value(
            "Health Subscription Plan",
            row,
            [
                "name",
                "plan_code",
                "title",
                "description",
                "monthly_price",
                "billing_interval",
                "free_home_collection",
                "lab_discount_percent",
                "pharmacy_discount_percent",
                "consultation_discount_percent",
                "plan_category",
                "wellness_wing",
                "included_sessions_per_month",
                "online_access",
            ],
            as_dict=True,
        )
    base = serialize_plan(row)
    if not base:
        return None
    sessions = int(getattr(row, "included_sessions_per_month", None) or 0)
    base["plan_category"] = getattr(row, "plan_category", None) or "Yoga"
    base["wellness_wing"] = getattr(row, "wellness_wing", None)
    base["included_sessions_per_month"] = sessions
    base["online_access"] = bool(getattr(row, "online_access", None))
    base["unlimited_sessions"] = sessions == 0
    return base


def list_yoga_subscription_plans():
    if not subscriptions_ready():
        return []
    rows = frappe.get_all(
        "Health Subscription Plan",
        filters={"enabled": 1, "plan_category": "Yoga"},
        fields=[
            "name",
            "plan_code",
            "title",
            "description",
            "monthly_price",
            "billing_interval",
            "free_home_collection",
            "lab_discount_percent",
            "pharmacy_discount_percent",
            "consultation_discount_percent",
            "plan_category",
            "wellness_wing",
            "included_sessions_per_month",
            "online_access",
        ],
        order_by="display_order asc, title asc",
    )
    return [serialize_yoga_plan(r) for r in rows if r]


@frappe.whitelist(allow_guest=True)
def get_yoga_subscription_plans(sid=None):
    plans = list_yoga_subscription_plans()
    return _success(
        {
            "plans": plans,
            "wing": YOGA_WING,
            "subscriptions_available": bool(plans),
        }
    )


@frappe.whitelist(allow_guest=True)
def get_my_yoga_subscription(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import serialize_subscription

    name = frappe.db.get_value(
        "Health Subscription",
        {
            "user": frappe.session.user,
            "status": "Active",
        },
        "name",
        order_by="end_date desc",
    )
    if not name:
        return _success({"subscription": None})

    plan = sub.get("plan") if sub else None
    if not plan:
        return _success({"subscription": None})
    plan_code = plan.get("plan_code")
    category = (
        frappe.db.get_value("Health Subscription Plan", plan_code, "plan_category") if plan_code else None
    )
    if category != "Yoga":
        return _success({"subscription": None})
    sub["plan"] = serialize_yoga_plan(plan_code)
    return _success({"subscription": sub})


def setup_yoga_subscriptions():
    ensure_yoga_plan_fields()
    tag_health_plans_category()
    created = seed_yoga_subscription_plans()
    frappe.clear_cache(doctype="Health Subscription Plan")
    return {"ok": True, "feature": "yoga_subscriptions", "plans_created": created, "wing": YOGA_WING["id"]}
