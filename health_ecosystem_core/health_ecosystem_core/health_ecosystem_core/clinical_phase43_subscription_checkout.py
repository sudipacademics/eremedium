"""Phase 43 — Health subscription Razorpay checkout (cart → pay → activate)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_months, add_years, flt, getdate, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import (
    _linked_patient,
    _plan_end_date,
    get_active_subscription,
    get_pending_subscription,
    serialize_subscription,
    subscriptions_ready,
)


def create_subscription_checkout(user, plan_code):
    """Create Pending Health Subscription ready for Razorpay order."""
    if not subscriptions_ready():
        frappe.throw(_("Subscriptions are not available yet"))

    plan_code = (plan_code or "").strip().upper()
    if not plan_code or not frappe.db.exists("Health Subscription Plan", plan_code):
        frappe.throw(_("Invalid subscription plan"))

    plan = frappe.get_doc("Health Subscription Plan", plan_code)
    if not plan.enabled:
        frappe.throw(_("This plan is not available"))

    if get_active_subscription(user):
        frappe.throw(_("You already have an active subscription"))

    pending = get_pending_subscription(user)
    if pending:
        return pending

    start = today()
    end = _plan_end_date(start, plan.billing_interval)
    amount = flt(plan.monthly_price)

    doc = frappe.get_doc(
        {
            "doctype": "Health Subscription",
            "user": user,
            "patient": _linked_patient(user),
            "plan": plan.name,
            "status": "Pending",
            "start_date": start,
            "end_date": end,
            "amount": amount,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return serialize_subscription(doc)


def activate_subscription_after_payment(subscription_name, payment_id=None):
    """Mark subscription Active after Razorpay verify."""
    doc = frappe.get_doc("Health Subscription", subscription_name)
    if doc.status == "Active":
        return serialize_subscription(doc)

    doc.status = "Active"
    if payment_id:
        doc.razorpay_subscription_id = payment_id
    elif not doc.razorpay_subscription_id:
        plan_code = frappe.db.get_value("Health Subscription Plan", doc.plan, "plan_code") or doc.plan
        doc.razorpay_subscription_id = f"sub_paid_{str(plan_code).lower()}"

    if not doc.start_date:
        doc.start_date = today()
    if not doc.end_date:
        billing = frappe.db.get_value("Health Subscription Plan", doc.plan, "billing_interval")
        doc.end_date = _plan_end_date(doc.start_date, billing)

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return serialize_subscription(doc)


def setup_phase43_subscription_checkout():
    return {"ok": True, "phase": "43", "feature": "subscription_razorpay_checkout"}
