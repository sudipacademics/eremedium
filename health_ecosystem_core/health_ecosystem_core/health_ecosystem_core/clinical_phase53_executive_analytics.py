"""Phase 53B — Executive analytics: cross-hub revenue, funnel, CAC/LTV proxies."""

from __future__ import annotations

from collections import Counter, defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

PERIODS = {
    "7d": ("Last 7 days", 6),
    "30d": ("Last 30 days", 29),
    "90d": ("Last 90 days", 89),
    "365d": ("Last 12 months", 364),
}


def _period_bounds(period):
    period = (period or "30d").strip()
    if period not in PERIODS:
        period = "30d"
    label, days_back = PERIODS[period]
    end = getdate(today())
    start = end if period == "today" else add_days(end, -days_back)
    return period, label, start, end


def _admin_roles(roles):
    return bool(
        set(roles or [])
        & {"System Manager", "Health System Admin", "Healthcare Administrator"}
    ) or is_staff(roles)


def _marketing_spend_for_period(start, end):
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return 0
    settings = frappe.get_single("Health Ecosystem Settings")
    monthly = flt(getattr(settings, "monthly_marketing_spend", 0))
    if not monthly:
        return 0
    days = (getdate(end) - getdate(start)).days + 1
    return round(monthly * days / 30.0, 2)


def _lab_funnel(start, end):
    filters = {"creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]}
    trfs = frappe.get_all(
        "Customer TRF",
        filters=filters,
        fields=["name", "order_status", "razorpay_payment_status", "amount", "franchisee_id"],
        limit=5000,
    )
    funnel = {
        "trf_booked": len(trfs),
        "trf_paid": sum(1 for t in trfs if (t.razorpay_payment_status or "").lower() in ("paid", "captured")),
        "sample_collected": sum(1 for t in trfs if t.order_status in ("Sample Collected", "In Lab", "Completed")),
        "in_lab": sum(1 for t in trfs if t.order_status in ("In Lab", "Completed")),
        "completed": sum(1 for t in trfs if t.order_status == "Completed"),
        "cancelled": sum(1 for t in trfs if t.order_status == "Cancelled"),
    }
    lab_revenue = sum(
        flt(t.amount)
        for t in trfs
        if (t.razorpay_payment_status or "").lower() in ("paid", "captured")
    )
    hub_map = defaultdict(lambda: {"bookings": 0, "revenue": 0.0, "paid": 0})
    for t in trfs:
        hub = t.franchisee_id or "Unassigned"
        hub_map[hub]["bookings"] += 1
        if (t.razorpay_payment_status or "").lower() in ("paid", "captured"):
            hub_map[hub]["paid"] += 1
            hub_map[hub]["revenue"] += flt(t.amount)
    return funnel, round(lab_revenue, 2), hub_map


def _report_authorized_count(start, end):
    if not frappe.db.exists("DocType", "Patient Care Journey"):
        return 0
    return frappe.db.count(
        "Patient Care Journey",
        {
            "status": ["in", ["Authorized", "Dispatched"]],
            "modified": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]],
        },
    )


def _pharmacy_revenue(start, end):
    if not frappe.db.exists("DocType", "Pharmacy Order"):
        return 0
    orders = frappe.get_all(
        "Pharmacy Order",
        filters={"creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]},
        fields=["order_total", "razorpay_payment_status"],
        limit=3000,
    )
    return round(
        sum(
            flt(o.order_total)
            for o in orders
            if (o.razorpay_payment_status or "").lower() in ("paid", "captured")
        ),
        2,
    )


def _appointment_revenue(start, end):
    if not frappe.db.exists("DocType", "Doctor Appointment"):
        return 0
    rows = frappe.get_all(
        "Doctor Appointment",
        filters={"creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]},
        fields=["amount", "razorpay_payment_status"],
        limit=3000,
    )
    return round(
        sum(
            flt(r.amount)
            for r in rows
            if (r.razorpay_payment_status or "").lower() in ("paid", "captured")
        ),
        2,
    )


def _subscription_revenue(start, end):
    if not frappe.db.exists("DocType", "Health Subscription"):
        return 0
    rows = frappe.get_all(
        "Health Subscription",
        filters={
            "status": "Active",
            "creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]],
        },
        fields=["amount"],
        limit=2000,
    )
    return round(sum(flt(r.amount) for r in rows), 2)


def _patient_metrics(start, end):
    if not frappe.db.exists("DocType", "Health Patient"):
        return {"new_patients": 0, "repeat_patients": 0, "unique_active": 0}
    new_patients = frappe.db.count(
        "Health Patient",
        {"creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]},
    )
    trf_patients = frappe.get_all(
        "Customer TRF",
        filters={"creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]], "health_patient": ["is", "set"]},
        fields=["health_patient"],
        limit=5000,
    )
    counter = Counter(t.health_patient for t in trf_patients if t.health_patient)
    repeat = sum(1 for _, c in counter.items() if c > 1)
    return {
        "new_patients": new_patients,
        "repeat_patients": repeat,
        "unique_active": len(counter),
    }


def _revenue_trend(start, end):
    trend = []
    day = getdate(start)
    end_d = getdate(end)
    while day <= end_d:
        d = str(day)
        lab = frappe.db.sql(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM `tabCustomer TRF`
            WHERE DATE(creation) = %s
              AND LOWER(COALESCE(razorpay_payment_status, '')) IN ('paid', 'captured')
            """,
            (d,),
        )[0][0]
        trend.append({"date": d, "lab_revenue": round(flt(lab), 2)})
        day = add_days(day, 1)
    return trend


@frappe.whitelist()
def get_executive_analytics(period="30d", sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not _admin_roles(roles):
        return _error(_("Executive analytics requires admin access"), 403)

    period, label, start, end = _period_bounds(_parse_request_value("period", period))
    funnel, lab_revenue, hub_map = _lab_funnel(start, end)
    funnel["report_authorized"] = _report_authorized_count(start, end)
    pharmacy_revenue = _pharmacy_revenue(start, end)
    appointment_revenue = _appointment_revenue(start, end)
    subscription_revenue = _subscription_revenue(start, end)
    total_revenue = round(lab_revenue + pharmacy_revenue + appointment_revenue + subscription_revenue, 2)

    patient_metrics = _patient_metrics(start, end)
    marketing_spend = _marketing_spend_for_period(start, end)
    new_patients = patient_metrics["new_patients"] or patient_metrics["unique_active"] or 1
    estimated_cac = round(marketing_spend / new_patients, 2) if marketing_spend else None
    unique_active = patient_metrics["unique_active"] or 1
    avg_ltv = round(total_revenue / unique_active, 2)

    hub_breakdown = []
    for hub_id, stats in sorted(hub_map.items(), key=lambda kv: -kv[1]["revenue"])[:15]:
        name = hub_id
        if hub_id != "Unassigned" and frappe.db.exists("Franchisee Profile", hub_id):
            name = frappe.db.get_value("Franchisee Profile", hub_id, "franchise_name") or hub_id
        bookings = stats["bookings"]
        hub_breakdown.append(
            {
                "franchisee_id": hub_id,
                "franchise_name": name,
                "bookings": bookings,
                "paid_bookings": stats["paid"],
                "revenue": round(stats["revenue"], 2),
                "conversion_rate": round(stats["paid"] / bookings * 100, 1) if bookings else 0,
            }
        )

    critical_open = 0
    if frappe.db.exists("DocType", "Lab Critical Value Alert"):
        critical_open = frappe.db.count("Lab Critical Value Alert", {"alert_status": "Open"})

    return _success(
        {
            "period": period,
            "period_label": label,
            "start_date": str(start),
            "end_date": str(end),
            "summary": {
                "total_revenue": total_revenue,
                "lab_revenue": lab_revenue,
                "pharmacy_revenue": pharmacy_revenue,
                "appointment_revenue": appointment_revenue,
                "subscription_revenue": subscription_revenue,
                "marketing_spend": marketing_spend,
                "estimated_cac": estimated_cac,
                "avg_ltv_proxy": avg_ltv,
                "new_patients": patient_metrics["new_patients"],
                "repeat_patients": patient_metrics["repeat_patients"],
                "unique_active_patients": patient_metrics["unique_active"],
                "critical_alerts_open": critical_open,
            },
            "funnel": funnel,
            "hub_breakdown": hub_breakdown,
            "revenue_trend": _revenue_trend(start, end),
            "periods": [{"key": k, "label": v[0]} for k, v in PERIODS.items()],
        }
    )


def setup_phase53_executive_analytics():
    return {"ok": True, "phase": "53B", "feature": "executive_analytics"}
