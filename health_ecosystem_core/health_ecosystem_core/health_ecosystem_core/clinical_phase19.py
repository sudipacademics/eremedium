"""Phase 19 — Health subscription plans and member entitlements."""

from __future__ import annotations

import os
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import add_months, add_years, flt, getdate, today


def sync_phase19_doctypes(force=True):
    from frappe.modules.import_file import import_file_by_path

    bases = []
    try:
        app_path = frappe.get_app_path("health_ecosystem_core")
        bases.append(os.path.join(app_path, "health_ecosystem_core", "health_ecosystem_core", "doctype"))
    except Exception:
        pass
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg = os.path.dirname(api_mod.__file__)
        bases.append(os.path.join(pkg, "doctype"))
    except Exception:
        pass

    imported = []
    for base in bases:
        if not os.path.isdir(base):
            continue
        for rel in (
            "health_subscription_plan/health_subscription_plan.json",
            "health_subscription/health_subscription.json",
        ):
            path = os.path.join(base, rel)
            if os.path.isfile(path):
                import_file_by_path(path, force=force)
                imported.append(rel)
    for dt in ("Health Subscription Plan", "Health Subscription"):
        if frappe.db.exists("DocType", dt):
            try:
                frappe.db.updatedb(dt)
            except Exception:
                frappe.log_error(title="phase19_updatedb", message=frappe.get_traceback())
    frappe.clear_cache()


def subscriptions_ready():
    return bool(
        frappe.db.exists("DocType", "Health Subscription Plan")
        and frappe.db.exists("DocType", "Health Subscription")
    )


def seed_subscription_plans():
    if not subscriptions_ready():
        return []
    created = []
    plans = [
        {
            "plan_code": "FAMILY_MONTHLY",
            "title": "Family Care Monthly",
            "description": "Free home sample collection + 10% off lab tests",
            "monthly_price": 299,
            "billing_interval": "Month",
            "free_home_collection": 1,
            "lab_discount_percent": 10,
            "pharmacy_discount_percent": 0,
            "display_order": 1,
        },
        {
            "plan_code": "WELLNESS_PLUS",
            "title": "Wellness Plus",
            "description": "15% off labs, 5% pharmacy, unlimited phlebo visits",
            "monthly_price": 499,
            "billing_interval": "Month",
            "free_home_collection": 1,
            "lab_discount_percent": 15,
            "pharmacy_discount_percent": 5,
            "display_order": 2,
        },
        {
            "plan_code": "ANNUAL_FAMILY",
            "title": "Family Annual",
            "description": "Best value — 20% lab discount for 12 months",
            "monthly_price": 2999,
            "billing_interval": "Year",
            "free_home_collection": 1,
            "lab_discount_percent": 20,
            "pharmacy_discount_percent": 10,
            "display_order": 3,
        },
    ]
    for spec in plans:
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
        frappe.get_doc(
            {"doctype": "Health Subscription Plan", "enabled": 1, **spec}
        ).insert(ignore_permissions=True)
        created.append(code)
    return created


def serialize_plan(row):
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
            ],
            as_dict=True,
        )
    if not row:
        return None
    return {
        "plan_code": row.plan_code or row.name,
        "title": row.title,
        "description": row.description,
        "monthly_price": flt(row.monthly_price),
        "billing_interval": row.billing_interval or "Month",
        "free_home_collection": bool(row.free_home_collection),
        "lab_discount_percent": flt(row.lab_discount_percent),
        "pharmacy_discount_percent": flt(row.pharmacy_discount_percent),
        "consultation_discount_percent": flt(getattr(row, "consultation_discount_percent", 0)),
    }


def serialize_subscription(row):
    if isinstance(row, str):
        row = frappe.db.get_value(
            "Health Subscription",
            row,
            [
                "name",
                "plan",
                "status",
                "start_date",
                "end_date",
                "amount",
                "razorpay_subscription_id",
            ],
            as_dict=True,
        )
    if not row:
        return None
    plan = serialize_plan(row.plan) if row.plan else None
    return {
        "name": row.name,
        "status": row.status,
        "start_date": str(row.start_date) if row.start_date else None,
        "end_date": str(row.end_date) if row.end_date else None,
        "amount": flt(row.amount),
        "razorpay_subscription_id": row.razorpay_subscription_id,
        "plan": plan,
    }


def list_subscription_plans(category=None):
    if not subscriptions_ready():
        return []
    filters = {"enabled": 1}
    meta = frappe.get_meta("Health Subscription Plan")
    if category:
        if meta.has_field("plan_category"):
            filters["plan_category"] = category
    elif meta.has_field("plan_category"):
        filters["plan_category"] = ["!=", "Yoga"]
    rows = frappe.get_all(
        "Health Subscription Plan",
        filters=filters,
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
        ],
        order_by="display_order asc, title asc",
    )
    return [serialize_plan(r) for r in rows if r]


def _linked_patient(user):
    if not frappe.db.exists("DocType", "Health Patient"):
        return None
    return frappe.db.get_value("Health Patient", {"linked_user": user}, "name")


def get_active_subscription(user):
    if not subscriptions_ready():
        return None
    name = frappe.db.get_value(
        "Health Subscription",
        {
            "user": user,
            "status": "Active",
            "end_date": (">=", today()),
        },
        "name",
        order_by="end_date desc",
    )
    if not name:
        return None
    return serialize_subscription(name)


def get_pending_subscription(user):
    if not subscriptions_ready():
        return None
    name = frappe.db.get_value(
        "Health Subscription",
        {"user": user, "status": "Pending"},
        "name",
        order_by="creation desc",
    )
    if not name:
        return None
    return serialize_subscription(name)


def repair_pending_subscriptions(activate_all=True):
    """Activate Pending subscriptions created before payment gate was wired."""
    if not subscriptions_ready():
        return {"activated": 0}
    pending = frappe.get_all("Health Subscription", filters={"status": "Pending"}, pluck="name")
    activated = []
    for name in pending:
        doc = frappe.get_doc("Health Subscription", name)
        if activate_all or not doc.razorpay_subscription_id:
            doc.status = "Active"
            if not doc.razorpay_subscription_id:
                plan_code = frappe.db.get_value("Health Subscription Plan", doc.plan, "plan_code") or doc.plan
                doc.razorpay_subscription_id = f"sub_web_{str(plan_code).lower()}"
            doc.save(ignore_permissions=True)
            activated.append(name)
    if activated:
        frappe.db.commit()
    return {"activated": len(activated), "ids": activated}


def _plan_end_date(start, billing_interval):
    start = getdate(start)
    if (billing_interval or "Month").lower() == "year":
        return add_years(start, 1) - timedelta(days=1)
    return add_months(start, 1) - timedelta(days=1)


def subscribe_user(user, plan_code):
    if not subscriptions_ready():
        frappe.throw(_("Subscriptions are not available yet"))

    plan_code = (plan_code or "").strip().upper()
    if not plan_code or not frappe.db.exists("Health Subscription Plan", plan_code):
        frappe.throw(_("Invalid subscription plan"))

    plan = frappe.get_doc("Health Subscription Plan", plan_code)
    if not plan.enabled:
        frappe.throw(_("This plan is not available"))

    existing = get_active_subscription(user)
    if existing:
        frappe.throw(_("You already have an active subscription"))

    pending = get_pending_subscription(user)
    if pending:
        frappe.throw(_("You already have a subscription awaiting activation"))

    start = today()
    end = _plan_end_date(start, plan.billing_interval)

    # Web subscribe does not collect Razorpay recurring payment yet (Phase 26b).
    # Always activate so Circle entitlements apply at checkout immediately.
    status = "Active"
    razorpay_sub_id = f"sub_web_{plan_code.lower()}"

    doc = frappe.get_doc(
        {
            "doctype": "Health Subscription",
            "user": user,
            "patient": _linked_patient(user),
            "plan": plan.name,
            "status": status,
            "start_date": start,
            "end_date": end,
            "amount": flt(plan.monthly_price),
            "razorpay_subscription_id": razorpay_sub_id,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return serialize_subscription(doc)


def get_entitlements(user):
    """Active plan benefits for checkout / booking."""
    sub = get_active_subscription(user)
    if not sub or not sub.get("plan"):
        return {
            "active": False,
            "free_home_collection": False,
            "lab_discount_percent": 0,
            "pharmacy_discount_percent": 0,
            "consultation_discount_percent": 0,
        }
    plan = sub["plan"]
    return {
        "active": True,
        "plan_code": plan.get("plan_code"),
        "plan_title": plan.get("title"),
        "free_home_collection": plan.get("free_home_collection"),
        "lab_discount_percent": flt(plan.get("lab_discount_percent")),
        "pharmacy_discount_percent": flt(plan.get("pharmacy_discount_percent")),
        "consultation_discount_percent": flt(plan.get("consultation_discount_percent")),
        "subscription": sub,
    }


def setup_phase19():
    sync_phase19_doctypes(force=True)
    created = seed_subscription_plans()
    frappe.db.commit()
    frappe.clear_cache()
    plan_count = 0
    if subscriptions_ready() and frappe.db.table_exists("Health Subscription Plan"):
        plan_count = frappe.db.count("Health Subscription Plan")
    return {
        "ok": subscriptions_ready(),
        "phase": 19,
        "plans_seeded": created,
        "plan_count": plan_count,
    }


def smoke_phase19():
    """Plans + DocTypes + entitlements API smoke (no paid Razorpay call)."""
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase19()
    check("setup", setup.get("ok"), f"plans={setup.get('plan_count')}")
    check("doctypes", subscriptions_ready())
    check(
        "plan_count",
        int(setup.get("plan_count") or 0) >= 3,
        str(setup.get("plan_count")),
    )
    check("family_plan", bool(frappe.db.exists("Health Subscription Plan", "FAMILY_MONTHLY")))

    plans = list_subscription_plans()
    check("list_plans", isinstance(plans, list) and len(plans) >= 3, str(len(plans) if isinstance(plans, list) else plans))

    user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
    ents = get_entitlements(user)
    check(
        "entitlements_shape",
        isinstance(ents, dict) and "active" in ents and "lab_discount_percent" in ents,
        str(list(ents.keys())[:8]),
    )

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_list_plans", hasattr(api_mod, "get_health_subscription_plans"))
    check("api_my_sub", hasattr(api_mod, "get_my_health_subscription"))
    check("api_subscribe", hasattr(api_mod, "subscribe_health_plan"))

    return result
