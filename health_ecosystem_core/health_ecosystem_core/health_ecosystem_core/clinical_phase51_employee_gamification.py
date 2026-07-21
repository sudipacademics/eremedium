"""Phase 51 — Employee gamification (Energy Point style rules, ledger, desk leaderboard)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, today

PAYMENT_VALUES = frozenset({"captured", "paid", "success", "completed"})
PERIOD_KEYS = ("daily", "weekly", "monthly", "annual")

DEFAULT_RULES = [
    {
        "rule_code": "TRF_BOOKED",
        "title": "Lab TRF booked",
        "reference_doctype": "Customer TRF",
        "trigger_event": "After Insert",
        "base_points": 5,
        "points_per_1000_revenue": 0,
        "revenue_field": "amount",
        "assign_points_to": "Document Owner",
        "description": "Award when a new Customer TRF is created from desk or portal.",
    },
    {
        "rule_code": "TRF_PAID",
        "title": "Lab TRF payment received",
        "reference_doctype": "Customer TRF",
        "trigger_event": "Payment Received",
        "watch_field": "razorpay_payment_status",
        "watch_value": "captured",
        "base_points": 10,
        "points_per_1000_revenue": 2,
        "revenue_field": "amount",
        "assign_points_to": "Document Owner",
        "description": "Base points plus revenue bonus when TRF payment is captured.",
    },
    {
        "rule_code": "TRF_COMPLETED",
        "title": "Lab TRF completed",
        "reference_doctype": "Customer TRF",
        "trigger_event": "Field Changed",
        "watch_field": "order_status",
        "watch_value": "Completed",
        "base_points": 15,
        "points_per_1000_revenue": 1,
        "revenue_field": "amount",
        "assign_points_to": "Session User",
        "description": "Award when sample processing is marked completed.",
    },
    {
        "rule_code": "APPOINTMENT_BOOKED",
        "title": "Doctor appointment booked",
        "reference_doctype": "Doctor Appointment",
        "trigger_event": "After Insert",
        "base_points": 8,
        "points_per_1000_revenue": 0,
        "revenue_field": "amount",
        "assign_points_to": "Document Owner",
    },
    {
        "rule_code": "APPOINTMENT_COMPLETED",
        "title": "Doctor appointment completed",
        "reference_doctype": "Doctor Appointment",
        "trigger_event": "Field Changed",
        "watch_field": "status",
        "watch_value": "Completed",
        "base_points": 12,
        "points_per_1000_revenue": 3,
        "revenue_field": "amount",
        "assign_points_to": "Linked Doc User",
        "assign_user_field": "doctor",
        "description": "Points go to the doctor linked on the appointment.",
    },
    {
        "rule_code": "PHARMACY_ORDER",
        "title": "Pharmacy order created",
        "reference_doctype": "Pharmacy Order",
        "trigger_event": "After Insert",
        "base_points": 6,
        "points_per_1000_revenue": 0,
        "revenue_field": "order_total",
        "assign_points_to": "Document Owner",
    },
    {
        "rule_code": "PHARMACY_PAID",
        "title": "Pharmacy order paid",
        "reference_doctype": "Pharmacy Order",
        "trigger_event": "Payment Received",
        "watch_field": "razorpay_payment_status",
        "watch_value": "captured",
        "base_points": 10,
        "points_per_1000_revenue": 2.5,
        "revenue_field": "order_total",
        "assign_points_to": "Document Owner",
    },
    {
        "rule_code": "SALES_INVOICE",
        "title": "Sales invoice submitted",
        "reference_doctype": "Sales Invoice",
        "trigger_event": "On Submit",
        "base_points": 5,
        "points_per_1000_revenue": 5,
        "revenue_field": "grand_total",
        "assign_points_to": "Document Owner",
        "description": "Revenue-linked points when a sales invoice is submitted.",
    },
]


def _employee_doctype_exists():
    return frappe.db.exists("DocType", "Employee")


def employee_for_user(user):
    if not user or user in ("Administrator", "Guest"):
        return None
    if not _employee_doctype_exists():
        return None
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name")


def resolve_employee_for_rule(doc, rule):
    assign = rule.assign_points_to or "Document Owner"
    user = None
    employee = None

    if assign == "Employee Field" and rule.assign_employee_field:
        employee = doc.get(rule.assign_employee_field)
    elif assign == "User Field" and rule.assign_user_field:
        user = doc.get(rule.assign_user_field)
    elif assign == "Linked Doc User" and rule.assign_user_field:
        link_name = doc.get(rule.assign_user_field)
        field = frappe.get_meta(doc.doctype).get_field(rule.assign_user_field)
        link_doctype = field.options if field else None
        if link_name and link_doctype and frappe.db.exists(link_doctype, link_name):
            user = frappe.db.get_value(link_doctype, link_name, "user")
    elif assign == "Session User":
        user = frappe.session.user
    else:
        user = doc.owner

    if not employee and user:
        employee = employee_for_user(user)
    if employee and not frappe.db.exists("Employee", employee):
        employee = None
    return employee, user


def calculate_points(rule, revenue_amount):
    base = flt(rule.base_points)
    bonus = (flt(revenue_amount) / 1000.0) * flt(rule.points_per_1000_revenue)
    return round(base + bonus, 2)


def _revenue_from_doc(doc, rule):
    field = (rule.revenue_field or "amount").strip()
    if not field:
        return 0
    meta = frappe.get_meta(doc.doctype)
    if not meta.has_field(field):
        return 0
    return flt(doc.get(field) or 0)


def _trigger_matches(rule, doc, event_name):
    trigger = rule.trigger_event or "After Insert"
    if trigger == "After Insert":
        return event_name == "after_insert"
    if trigger == "On Submit":
        return event_name == "on_submit"
    if trigger in ("Field Changed", "Payment Received"):
        if event_name != "on_update":
            return False
        watch_field = (rule.watch_field or "").strip()
        if not watch_field or not doc.has_value_changed(watch_field):
            return False
        current = (doc.get(watch_field) or "").strip().lower()
        if trigger == "Payment Received":
            expected = (rule.watch_value or "").strip().lower()
            if expected:
                return current == expected
            return current in PAYMENT_VALUES
        expected = (rule.watch_value or "").strip()
        if not expected:
            return True
        return (doc.get(watch_field) or "") == expected
    return False


def _entry_exists(rule_name, reference_doctype, reference_name):
    return frappe.db.exists(
        "Employee Gamification Entry",
        {
            "rule": rule_name,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
        },
    )


def award_gamification_points(rule_doc, doc, revenue_amount=None):
    if frappe.flags.in_import or frappe.flags.in_migrate:
        return None
    if not rule_doc.enabled:
        return None
    if not _employee_doctype_exists():
        return None

    employee, user = resolve_employee_for_rule(doc, rule_doc)
    if not employee:
        return None

    if _entry_exists(rule_doc.name, doc.doctype, doc.name):
        return None

    revenue_amount = flt(revenue_amount if revenue_amount is not None else _revenue_from_doc(doc, rule_doc))
    points = calculate_points(rule_doc, revenue_amount)
    if points <= 0:
        return None

    entry = frappe.get_doc(
        {
            "doctype": "Employee Gamification Entry",
            "employee": employee,
            "user": user,
            "rule": rule_doc.name,
            "rule_code": rule_doc.rule_code,
            "points": points,
            "revenue_amount": revenue_amount,
            "reference_doctype": doc.doctype,
            "reference_name": doc.name,
            "activity_date": getdate(today()),
            "reason": rule_doc.title or rule_doc.rule_code,
        }
    )
    entry.insert(ignore_permissions=True)
    return entry.name


def process_doc_gamification(doc, event_name):
    if frappe.flags.in_import or frappe.flags.in_migrate:
        return
    if not frappe.db.exists("DocType", "Employee Gamification Rule"):
        return

    rules = frappe.get_all(
        "Employee Gamification Rule",
        filters={"reference_doctype": doc.doctype, "enabled": 1},
        fields=[
            "name",
            "rule_code",
            "title",
            "trigger_event",
            "watch_field",
            "watch_value",
            "base_points",
            "points_per_1000_revenue",
            "revenue_field",
            "assign_points_to",
            "assign_employee_field",
            "assign_user_field",
            "enabled",
        ],
    )
    for row in rules:
        rule = frappe._dict(row)
        if not _trigger_matches(rule, doc, event_name):
            continue
        try:
            award_gamification_points(rule, doc)
        except Exception:
            frappe.log_error(title=f"Gamification award failed ({rule.rule_code})", message=frappe.get_traceback())


def on_doc_after_insert(doc, method=None):
    process_doc_gamification(doc, "after_insert")


def on_doc_on_update(doc, method=None):
    process_doc_gamification(doc, "on_update")


def on_doc_on_submit(doc, method=None):
    process_doc_gamification(doc, "on_submit")


def _period_bounds(period):
    from datetime import date

    today_date = getdate(today())
    if period == "daily":
        return today_date, today_date, _("Today")
    if period == "weekly":
        start = add_days(today_date, -6)
        return start, today_date, _("Last 7 days")
    if period == "monthly":
        start = add_days(today_date, -29)
        return start, today_date, _("Last 30 days")
    start = date(today_date.year, 1, 1)
    return start, today_date, _("Year to date")


def get_leaderboard(period="daily", limit=10):
    period = (period or "daily").strip().lower()
    if period not in PERIOD_KEYS:
        period = "daily"
    start, end, label = _period_bounds(period)

    rows = frappe.db.sql(
        """
        SELECT
            e.employee,
            e.employee_name,
            SUM(e.points) AS total_points,
            SUM(COALESCE(e.revenue_amount, 0)) AS total_revenue,
            COUNT(*) AS activity_count
        FROM `tabEmployee Gamification Entry` e
        WHERE e.activity_date BETWEEN %s AND %s
        GROUP BY e.employee, e.employee_name
        ORDER BY total_points DESC, total_revenue DESC
        LIMIT %s
        """,
        (start, end, int(limit)),
        as_dict=True,
    )

    for idx, row in enumerate(rows, start=1):
        row["rank"] = idx
        row["total_points"] = flt(row.total_points, 2)
        row["total_revenue"] = flt(row.total_revenue, 2)

    return {
        "period": period,
        "label": label,
        "start_date": str(start),
        "end_date": str(end),
        "leaders": rows,
    }


DASHBOARD_ROLES = (
    "System Manager",
    "Health System Admin",
    "Healthcare Administrator",
    "HR Manager",
    "Physician",
    "Lab Technician",
    "Phlebotomist",
    "Nurse",
    "Franchisee Operator",
)


def build_gamification_dashboard(limit=10):
    limit = int(limit or 10)
    leaderboards = {key: get_leaderboard(key, limit) for key in PERIOD_KEYS}

    recent = frappe.get_all(
        "Employee Gamification Entry",
        fields=[
            "name",
            "employee",
            "employee_name",
            "points",
            "rule_code",
            "revenue_amount",
            "reference_doctype",
            "reference_name",
            "activity_date",
            "creation",
        ],
        order_by="creation desc",
        limit=20,
    )

    rules = frappe.get_all(
        "Employee Gamification Rule",
        filters={"enabled": 1},
        fields=[
            "name",
            "rule_code",
            "title",
            "reference_doctype",
            "trigger_event",
            "base_points",
            "points_per_1000_revenue",
        ],
        order_by="rule_code asc",
    )

    totals = frappe.db.sql(
        """
        SELECT
            SUM(points) AS all_time_points,
            SUM(COALESCE(revenue_amount, 0)) AS all_time_revenue,
            COUNT(*) AS all_time_entries
        FROM `tabEmployee Gamification Entry`
        """,
        as_dict=True,
    )
    summary = totals[0] if totals else {}

    return {
        "leaderboards": leaderboards,
        "recent_entries": recent,
        "active_rules": rules,
        "summary": {
            "all_time_points": flt(summary.get("all_time_points"), 2),
            "all_time_revenue": flt(summary.get("all_time_revenue"), 2),
            "all_time_entries": int(summary.get("all_time_entries") or 0),
        },
    }


def get_my_gamification_stats(user=None):
    user = user or frappe.session.user
    employee = employee_for_user(user)
    if not employee:
        return {
            "employee": None,
            "employee_name": None,
            "linked": False,
            "period_points": {},
        }

    employee_name = frappe.db.get_value("Employee", employee, "employee_name")
    period_points = {}
    for key in PERIOD_KEYS:
        start, end, label = _period_bounds(key)
        row = frappe.db.sql(
            """
            SELECT SUM(points) AS total_points, SUM(COALESCE(revenue_amount, 0)) AS total_revenue
            FROM `tabEmployee Gamification Entry`
            WHERE employee = %s AND activity_date BETWEEN %s AND %s
            """,
            (employee, start, end),
            as_dict=True,
        )
        period_points[key] = {
            "label": label,
            "total_points": flt((row[0] or {}).get("total_points"), 2),
            "total_revenue": flt((row[0] or {}).get("total_revenue"), 2),
        }

    return {
        "employee": employee,
        "employee_name": employee_name,
        "linked": True,
        "period_points": period_points,
    }


@frappe.whitelist()
def get_gamification_leaderboard(period="daily", limit=10):
    frappe.only_for(DASHBOARD_ROLES)
    return get_leaderboard(period=period, limit=limit)


@frappe.whitelist()
def get_gamification_dashboard(limit=10):
    frappe.only_for(DASHBOARD_ROLES)
    return build_gamification_dashboard(limit=limit)


def seed_default_gamification_rules():
    """Insert missing default rules only — never overwrite customized point values."""
    created = []
    skipped = []
    for spec in DEFAULT_RULES:
        name = spec["rule_code"]
        if frappe.db.exists("Employee Gamification Rule", name):
            skipped.append(name)
            continue
        doc = frappe.get_doc({"doctype": "Employee Gamification Rule", **spec, "enabled": 1})
        doc.insert(ignore_permissions=True)
        created.append(name)
    frappe.db.commit()
    return {"created": created, "skipped": skipped}


def ensure_gamification_desk_page():
    page_slug = "employee-gamification"
    folder = "employee_gamification"
    if not frappe.db.exists("Page", page_slug):
        page = frappe.get_doc(
            {
                "doctype": "Page",
                "page_name": page_slug,
                "title": "Employee Gamification",
                "module": "Health Ecosystem Core",
            }
        )
        for role in (
            "System Manager",
            "Health System Admin",
            "Healthcare Administrator",
            "HR Manager",
            "Physician",
            "Lab Technician",
            "Phlebotomist",
            "Nurse",
        ):
            page.append("roles", {"role": role})
        page.insert(ignore_permissions=True)
    try:
        frappe.reload_doc("health_ecosystem_core", "page", folder)
    except Exception:
        pass
    return page_slug


def ensure_gamification_workspace_link():
    if not frappe.db.exists("Workspace", "Clinical"):
        return False

    ws = frappe.get_doc("Workspace", "Clinical")
    labels = {s.label for s in (ws.shortcuts or [])}
    if "Employee Gamification" not in labels:
        ws.append(
            "shortcuts",
            {
                "label": "Employee Gamification",
                "type": "Page",
                "link_to": "employee-gamification",
                "color": "Orange",
            },
        )
    link_labels = {l.label for l in (ws.links or []) if getattr(l, "type", "") != "Card Break"}
    if "Gamification Rules" not in link_labels:
        ws.append(
            "links",
            {
                "label": "Gamification Rules",
                "type": "Link",
                "link_type": "DocType",
                "link_to": "Employee Gamification Rule",
            },
        )
    if "Gamification Ledger" not in link_labels:
        ws.append(
            "links",
            {
                "label": "Gamification Ledger",
                "type": "Link",
                "link_type": "DocType",
                "link_to": "Employee Gamification Entry",
            },
        )
    ws.save(ignore_permissions=True)
    return True


def setup_phase51_employee_gamification():
    if not frappe.db.exists("Module Def", "Health Ecosystem Core"):
        from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

        ensure_module_def()

    seed = seed_default_gamification_rules()
    page = ensure_gamification_desk_page()
    workspace = ensure_gamification_workspace_link()
    frappe.db.commit()
    return {
        "ok": True,
        "phase": "51",
        "feature": "employee_gamification",
        "page": page,
        "workspace_updated": workspace,
        "rules": seed,
    }
