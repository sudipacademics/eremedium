"""Phase 39 — Franchisee KPI dashboard: date-range revenue, pipeline, top tests."""

from __future__ import annotations

from collections import Counter

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

# period key -> (label, days back). "today" is a special case (start = today).
PERIODS = {
    "today": ("Today", 0),
    "7d": ("Last 7 days", 6),
    "30d": ("Last 30 days", 29),
    "90d": ("Last 90 days", 89),
}

PIPELINE_STAGES = ("Booked", "Sample Collected", "In Lab", "Completed", "Cancelled")


def _resolve_franchisee(franchisee_id, roles):
    """Franchisee operators are locked to their own hub; staff/admin may pass any id."""
    if franchisee_id and (is_staff(roles) or "System Manager" in roles or "Health System Admin" in roles):
        return franchisee_id if frappe.db.exists("Franchisee Profile", franchisee_id) else None
    own = frappe.db.get_value("Franchisee Profile", {"linked_user": frappe.session.user}, "name")
    if own:
        return own
    if franchisee_id and frappe.db.exists("Franchisee Profile", franchisee_id):
        return franchisee_id
    return None


@frappe.whitelist()
def get_franchisee_kpis(franchisee_id=None, period="30d", sid=None):
    """Aggregate KPIs for a franchisee hub over a chosen period."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    roles = _user_roles()
    franchisee_id = _resolve_franchisee(_parse_request_value("franchisee_id", franchisee_id), roles)
    if not franchisee_id:
        return _error(_("Franchisee profile not found"), 403)

    period = (_parse_request_value("period", period) or "30d").strip()
    if period not in PERIODS:
        period = "30d"
    label, days_back = PERIODS[period]
    start_date = getdate(today()) if period == "today" else add_days(getdate(today()), -days_back)

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    commission_rate = flt(profile.commission_percentage_rate) / 100

    trfs = frappe.get_all(
        "Customer TRF",
        filters={
            "franchisee_id": franchisee_id,
            "creation": [">=", f"{start_date} 00:00:00"],
        },
        fields=[
            "name",
            "patient_name",
            "test_required",
            "order_status",
            "razorpay_payment_status",
            "amount",
            "wholesale_amount",
            "creation",
        ],
        order_by="creation desc",
        limit=2000,
    )

    total_bookings = len(trfs)
    paid = [t for t in trfs if t.razorpay_payment_status == "Paid"]
    revenue_paid = sum(flt(t.amount) for t in paid)
    revenue_pending = sum(
        flt(t.amount) for t in trfs if t.razorpay_payment_status != "Paid" and t.order_status != "Cancelled"
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        sum_commission_for_trfs,
    )

    commission_earned = sum_commission_for_trfs(paid, profile)
    completed = [t for t in trfs if t.order_status == "Completed"]
    cancelled = [t for t in trfs if t.order_status == "Cancelled"]

    pipeline = {stage: 0 for stage in PIPELINE_STAGES}
    for t in trfs:
        if t.order_status in pipeline:
            pipeline[t.order_status] += 1

    # Top tests by frequency (test_required is a code / comma list).
    test_counter: Counter[str] = Counter()
    for t in trfs:
        raw = (t.test_required or "").strip()
        if not raw:
            continue
        for token in raw.split(","):
            token = token.strip()
            if token:
                test_counter[token] += 1
    top_tests = [{"test": name, "count": count} for name, count in test_counter.most_common(8)]

    # Daily revenue trend (paid amount per day) for the range.
    trend_map: dict[str, float] = {}
    for t in paid:
        day = str(getdate(t.creation))
        trend_map[day] = trend_map.get(day, 0) + flt(t.amount)
    span = 1 if period == "today" else days_back + 1
    trend = []
    for i in range(span):
        day = str(add_days(start_date, i))
        trend.append({"date": day, "revenue": round(trend_map.get(day, 0), 2)})

    avg_order = round(revenue_paid / len(paid), 2) if paid else 0

    return _success(
        {
            "franchisee": {
                "name": profile.name,
                "franchise_name": profile.franchise_name,
                "branch_code": profile.branch_code,
                "territory_region": getattr(profile, "territory_region", None),
                "commission_rate": profile.commission_percentage_rate,
                "franchisee_type": profile.get("franchisee_type") or "Pulse",
                "commission_base": profile.get("commission_base") or "Franchisee Rate",
            },
            "period": period,
            "period_label": label,
            "start_date": str(start_date),
            "kpis": {
                "total_bookings": total_bookings,
                "revenue_paid": round(revenue_paid, 2),
                "revenue_pending": round(revenue_pending, 2),
                "commission_earned": round(commission_earned, 2),
                "completed": len(completed),
                "cancelled": len(cancelled),
                "avg_order_value": avg_order,
                "conversion_rate": round(len(paid) / total_bookings * 100, 1) if total_bookings else 0,
            },
            "pipeline": pipeline,
            "top_tests": top_tests,
            "revenue_trend": trend,
            "periods": [{"key": k, "label": v[0]} for k, v in PERIODS.items()],
        }
    )


def setup_phase39_franchisee_kpi():
    return {"ok": True, "phase": "39", "feature": "franchisee_kpi_dashboard"}
