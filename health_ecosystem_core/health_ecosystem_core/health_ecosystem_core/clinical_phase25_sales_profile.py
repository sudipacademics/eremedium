"""REACH sales rep Profile dashboard — KPIs, ERP employee/CTC/target, seeded if missing."""

from __future__ import annotations

import json
from calendar import monthrange
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today


def ensure_sales_rep_profile_kpi_fields():
    """Add KPI / target fields on Sales Rep Profile when missing."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("DocType", "Sales Rep Profile"):
        return
    create_custom_fields(
        {
            "Sales Rep Profile": [
                {
                    "fieldname": "monthly_target",
                    "label": "Monthly Sales Target",
                    "fieldtype": "Currency",
                    "insert_after": "active",
                },
                {
                    "fieldname": "fofo_created_seed",
                    "label": "FOFO Created (Seed)",
                    "fieldtype": "Int",
                    "insert_after": "monthly_target",
                },
                {
                    "fieldname": "foco_created_seed",
                    "label": "FOCO Created (Seed)",
                    "fieldtype": "Int",
                    "insert_after": "fofo_created_seed",
                },
                {
                    "fieldname": "b2b_created_seed",
                    "label": "B2B Centres Created (Seed)",
                    "fieldtype": "Int",
                    "insert_after": "foco_created_seed",
                },
                {
                    "fieldname": "expenses_mtd_seed",
                    "label": "Expenses MTD (Seed)",
                    "fieldtype": "Currency",
                    "insert_after": "b2b_created_seed",
                },
                {
                    "fieldname": "profile_seeded_at",
                    "label": "Profile Seeded At",
                    "fieldtype": "Datetime",
                    "insert_after": "expenses_mtd_seed",
                    "read_only": 1,
                },
            ],
        },
        update=True,
    )


def _month_bounds(as_of=None):
    d = getdate(as_of or today())
    start = d.replace(day=1)
    end = d.replace(day=monthrange(d.year, d.month)[1])
    return start, end, d


def _designation_defaults(designation):
    designation = cstr(designation or "")
    if "National" in designation or "Regional" in designation or "Area Manager" in designation:
        return {"ctc": 75000.0, "target": 1_500_000.0, "fofo": 2, "foco": 3, "b2b": 2}
    return {"ctc": 42000.0, "target": 600_000.0, "fofo": 1, "foco": 1, "b2b": 1}


def _link_employee(rep_doc):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user

    user = cstr(rep_doc.user or "").strip()
    if not user:
        return None
    employee = ensure_employee_for_user(user)
    if not employee:
        return None
    if getattr(rep_doc, "employee", None) != employee and frappe.get_meta("Sales Rep Profile").has_field("employee"):
        frappe.db.set_value("Sales Rep Profile", rep_doc.name, "employee", employee, update_modified=False)
    return employee


def _ensure_ctc(employee, designation):
    defaults = _designation_defaults(designation)
    ctc = defaults["ctc"]
    if not employee or not frappe.db.exists("DocType", "Salary Structure Assignment"):
        return ctc, True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
            ensure_structure_assignment,
            ensure_salary_structure,
        )

        structure = ensure_salary_structure()
        assignment = ensure_structure_assignment(employee, structure=structure)
        if assignment and frappe.db.exists("Salary Structure Assignment", assignment):
            meta = frappe.get_meta("Salary Structure Assignment")
            if meta.has_field("base"):
                current = flt(frappe.db.get_value("Salary Structure Assignment", assignment, "base"))
                if current <= 0:
                    frappe.db.set_value("Salary Structure Assignment", assignment, "base", ctc)
                    frappe.db.commit()
                    return ctc, True
                return current, False
    except Exception:
        frappe.log_error(title="reach_profile_ctc_seed", message=frappe.get_traceback())
    return ctc, True


def _seed_expense_claim_mtd(employee, user, amount=3500.0):
    if not employee or not frappe.db.exists("DocType", "Expense Claim"):
        return None
    try:
        start, end, today_d = _month_bounds()
        existing = frappe.db.count(
            "Expense Claim",
            {
                "employee": employee,
                "posting_date": ("between", [cstr(start), cstr(end)]),
            },
        )
        if existing:
            return None
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
                ensure_expense_claim_types,
            )

            ensure_expense_claim_types()
        except Exception:
            pass
        expense_type = "Travel"
        if frappe.db.exists("DocType", "Expense Claim Type"):
            types = frappe.get_all("Expense Claim Type", pluck="name", limit=1)
            if types:
                expense_type = types[0]
            elif not frappe.db.exists("Expense Claim Type", expense_type):
                try:
                    frappe.get_doc({"doctype": "Expense Claim Type", "expense_type": expense_type}).insert(
                        ignore_permissions=True
                    )
                except Exception:
                    pass
        company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
            "Company", {}, "name"
        )
        if not company:
            return None
        doc = frappe.get_doc(
            {
                "doctype": "Expense Claim",
                "employee": employee,
                "company": company,
                "posting_date": cstr(today_d),
                "expenses": [
                    {
                        "expense_type": expense_type,
                        "amount": amount,
                        "sanctioned_amount": amount,
                        "description": "Seeded travel / field expense for REACH profile demo",
                    }
                ],
            }
        )
        if frappe.get_meta("Expense Claim").has_field("approval_status"):
            doc.approval_status = "Approved"
        doc.insert(ignore_permissions=True)
        try:
            doc.submit()
        except Exception:
            pass
        frappe.db.commit()
        return doc.name
    except Exception:
        frappe.log_error(title="reach_profile_expense_seed", message=frappe.get_traceback())
        return None


def ensure_reach_profile_seed_for_rep(rep_id):
    """Ensure employee, CTC, target and seed KPI counters for one REACH user."""
    ensure_sales_rep_profile_kpi_fields()
    if not rep_id or not frappe.db.exists("Sales Rep Profile", rep_id):
        return {"ok": False, "reason": "missing_rep"}
    rep = frappe.get_doc("Sales Rep Profile", rep_id)
    defaults = _designation_defaults(rep.designation)
    seeded = []

    employee = None
    try:
        employee = _link_employee(rep)
        if employee:
            seeded.append("employee")
    except Exception:
        frappe.log_error(title="reach_profile_employee_seed", message=frappe.get_traceback())

    ctc = defaults["ctc"]
    try:
        ctc, ctc_seeded = _ensure_ctc(employee, rep.designation)
        if ctc_seeded:
            seeded.append("ctc")
    except Exception:
        frappe.log_error(title="reach_profile_ctc_seed", message=frappe.get_traceback())

    meta = frappe.get_meta("Sales Rep Profile")
    updates = {}
    if meta.has_field("monthly_target") and flt(getattr(rep, "monthly_target", 0)) <= 0:
        updates["monthly_target"] = defaults["target"]
        seeded.append("monthly_target")
    if meta.has_field("fofo_created_seed") and cint(getattr(rep, "fofo_created_seed", 0)) <= 0:
        updates["fofo_created_seed"] = defaults["fofo"]
        seeded.append("fofo_seed")
    if meta.has_field("foco_created_seed") and cint(getattr(rep, "foco_created_seed", 0)) <= 0:
        updates["foco_created_seed"] = defaults["foco"]
        seeded.append("foco_seed")
    if meta.has_field("b2b_created_seed") and cint(getattr(rep, "b2b_created_seed", 0)) <= 0:
        updates["b2b_created_seed"] = defaults["b2b"]
        seeded.append("b2b_seed")
    if meta.has_field("expenses_mtd_seed") and flt(getattr(rep, "expenses_mtd_seed", 0)) <= 0:
        updates["expenses_mtd_seed"] = round(ctc * 0.08, 0)
        seeded.append("expenses_seed")
    if updates:
        if meta.has_field("profile_seeded_at"):
            updates["profile_seeded_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        frappe.db.set_value("Sales Rep Profile", rep_id, updates, update_modified=False)
        frappe.db.commit()

    if employee:
        claim = _seed_expense_claim_mtd(employee, rep.user, amount=round(ctc * 0.08, 0))
        if claim:
            seeded.append("expense_claim")

    return {"ok": True, "rep_id": rep_id, "employee": employee, "ctc": ctc, "seeded": seeded}


def ensure_reach_profiles_seed_all():
    ensure_sales_rep_profile_kpi_fields()
    rows = frappe.get_all("Sales Rep Profile", filters={"active": 1}, pluck="name")
    results = []
    for rep_id in rows:
        results.append(ensure_reach_profile_seed_for_rep(rep_id))
    return {"ok": True, "count": len(results), "results": results}


def _expenses_mtd(employee, rep_id, start, end):
    total = 0.0
    sources = []
    if employee and frappe.db.exists("DocType", "Expense Claim"):
        claims = frappe.get_all(
            "Expense Claim",
            filters={"employee": employee, "posting_date": ("between", [cstr(start), cstr(end)])},
            fields=["name", "total_claimed_amount", "total_sanctioned_amount", "docstatus"],
        )
        for claim in claims:
            amount = flt(claim.get("total_sanctioned_amount") or claim.get("total_claimed_amount"))
            total += amount
            sources.append({"type": "expense_claim", "id": claim.name, "amount": amount})
    if frappe.db.exists("DocType", "Sales Closing Report"):
        reports = frappe.get_all(
            "Sales Closing Report",
            filters={"sales_rep": rep_id, "period_date": ("between", [cstr(start), cstr(end)])},
            fields=["name", "total_expenses", "other_expenses", "expense_json"],
        )
        for report in reports:
            amount = flt(report.get("total_expenses") or report.get("other_expenses"))
            if amount <= 0 and report.get("expense_json"):
                try:
                    lines = json.loads(report.expense_json) if isinstance(report.expense_json, str) else report.expense_json
                    if isinstance(lines, list):
                        amount = sum(flt(item.get("amount")) for item in lines if isinstance(item, dict))
                except Exception:
                    amount = 0
            if amount:
                total += amount
                sources.append({"type": "closing_report", "id": report.name, "amount": amount})
    return total, sources


def _b2b_metrics(user, start, end):
    centres = 0
    sales_value = 0.0
    sales_count = 0
    if frappe.db.exists("DocType", "B2B Collection Centre"):
        centres = frappe.db.count("B2B Collection Centre", {"created_by_reach_user": user})
    if frappe.db.exists("DocType", "B2B Sales Entry"):
        filters = {"reach_user": user, "sales_date": ("between", [cstr(start), cstr(end)])}
        rows = frappe.get_all("B2B Sales Entry", filters=filters, fields=["business_value"])
        sales_count = len(rows)
        sales_value = sum(flt(r.business_value) for r in rows)
    return centres, sales_count, sales_value


def _franchise_model_counts(rep_ids):
    """Count FOFO / FOCO from acquired franchisees + onboarding requests."""
    fofo = 0
    foco = 0
    if not rep_ids:
        return fofo, foco
    meta = frappe.get_meta("Franchisee Profile")
    if meta.has_field("acquired_by_sales_rep"):
        fields = ["name"]
        if meta.has_field("franchisee_type"):
            fields.append("franchisee_type")
        if meta.has_field("franchise_model"):
            fields.append("franchise_model")
        rows = frappe.get_all(
            "Franchisee Profile",
            filters={"acquired_by_sales_rep": ("in", rep_ids)},
            fields=fields,
        )
        for row in rows:
            model = cstr(row.get("franchise_model") or row.get("franchisee_type") or "").upper()
            if "FOCO" in model or model == "PULSE":
                foco += 1
            elif "FOFO" in model or model == "VECTOR":
                fofo += 1
            else:
                # Unlabeled franchisee acquisition → FOFO pathway default for field sell
                fofo += 1
    if frappe.db.exists("DocType", "Franchise Onboarding Request"):
        onboardings = frappe.db.count("Franchise Onboarding Request", {"sales_rep": ("in", rep_ids)})
        if fofo + foco == 0 and onboardings:
            # Split onboardings evenly when model not stored
            fofo = onboardings // 2
            foco = onboardings - fofo
    return fofo, foco


def _sales_series(rep_ids, user, start, end, today_d):
    """Daily sales earned series for current month (franchise TRF + B2B)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import _franchisee_ids_for_reps

    days = today_d.day
    series = [{"day": i, "label": str(i), "amount": 0.0} for i in range(1, days + 1)]
    franchisee_ids = _franchisee_ids_for_reps(rep_ids)
    if franchisee_ids and frappe.db.exists("DocType", "Customer TRF"):
        trfs = frappe.get_all(
            "Customer TRF",
            filters={
                "franchisee_id": ("in", franchisee_ids),
                "razorpay_payment_status": "Paid",
                "creation": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"]),
            },
            fields=["amount", "creation"],
        )
        for trf in trfs:
            created = getdate(trf.creation)
            if created.month == today_d.month and created.year == today_d.year and 1 <= created.day <= days:
                series[created.day - 1]["amount"] += flt(trf.amount)
    if frappe.db.exists("DocType", "B2B Sales Entry"):
        entries = frappe.get_all(
            "B2B Sales Entry",
            filters={"reach_user": user, "sales_date": ("between", [cstr(start), cstr(end)])},
            fields=["business_value", "sales_date"],
        )
        for entry in entries:
            d = getdate(entry.sales_date)
            if d.month == today_d.month and d.year == today_d.year and 1 <= d.day <= days:
                series[d.day - 1]["amount"] += flt(entry.business_value)
    # If completely empty, seed a gentle ramp for chart readability
    if sum(item["amount"] for item in series) <= 0:
        for item in series:
            item["amount"] = round(2500 + item["day"] * 180 + (item["day"] % 3) * 400, 0)
            item["seeded"] = True
    return series


def get_sales_profile_dashboard(user=None, seed_if_missing=True):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
        get_or_create_sales_rep,
        is_sales_user,
        serialize_rep,
        scoped_rep_ids,
        _franchisee_ids_for_reps,
        _franchisee_stats,
    )

    user = user or frappe.session.user
    if not is_sales_user(user):
        return {"available": False, "reason": "sales_access_required"}

    ensure_sales_rep_profile_kpi_fields()
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        return {"available": False, "reason": "sales_rep_missing"}

    seed_info = {"seeded": []}
    if seed_if_missing:
        seed_info = ensure_reach_profile_seed_for_rep(rep_id)

    rep_doc = frappe.get_doc("Sales Rep Profile", rep_id)
    rep = serialize_rep(rep_id)
    rep_ids = scoped_rep_ids(user) or [rep_id]
    start, end, today_d = _month_bounds()
    days_covered = max(1, today_d.day)
    days_in_month = monthrange(today_d.year, today_d.month)[1]

    employee_id = cstr(getattr(rep_doc, "employee", None) or "")
    if not employee_id:
        employee_id = cstr(_link_employee(rep_doc) or "")

    employee = {}
    if employee_id and frappe.db.exists("Employee", employee_id):
        employee = frappe.db.get_value(
            "Employee",
            employee_id,
            [
                "name",
                "employee_name",
                "department",
                "designation",
                "cell_number",
                "company_email",
                "date_of_joining",
                "status",
                "company",
                "branch",
                "grade",
            ],
            as_dict=True,
        ) or {}

    monthly_ctc, _ = _ensure_ctc(employee_id, rep_doc.designation)
    monthly_target = flt(getattr(rep_doc, "monthly_target", 0))
    if monthly_target <= 0:
        monthly_target = _designation_defaults(rep_doc.designation)["target"]

    leads_uploaded = frappe.db.count("Franchise Sales Lead", {"assigned_rep": ("in", rep_ids)})
    visits_logged = frappe.db.count("Field Sales Visit", {"sales_rep": ("in", rep_ids)})
    fofo_actual, foco_actual = _franchise_model_counts(rep_ids)
    b2b_centres, b2b_sales_count, b2b_sales_value = _b2b_metrics(user, start, end)

    fofo_seed = cint(getattr(rep_doc, "fofo_created_seed", 0))
    foco_seed = cint(getattr(rep_doc, "foco_created_seed", 0))
    b2b_seed = cint(getattr(rep_doc, "b2b_created_seed", 0))
    fofo_created = fofo_actual if fofo_actual else fofo_seed
    foco_created = foco_actual if foco_actual else foco_seed
    b2b_created = b2b_centres if b2b_centres else b2b_seed

    franchisee_ids = _franchisee_ids_for_reps(rep_ids)
    franchise_stats = _franchisee_stats(franchisee_ids, start, end)
    total_sales = flt(franchise_stats.get("total_revenue")) + flt(b2b_sales_value)

    expenses_mtd, expense_sources = _expenses_mtd(employee_id, rep_id, start, end)
    if expenses_mtd <= 0:
        seeded_expense = flt(getattr(rep_doc, "expenses_mtd_seed", 0))
        if seeded_expense > 0:
            expenses_mtd = seeded_expense
            expense_sources.append({"type": "seed", "id": "expenses_mtd_seed", "amount": seeded_expense})
    ctc_prorated = monthly_ctc * (days_covered / float(days_in_month))
    net_expense_total = ctc_prorated + expenses_mtd
    net_expense_per_day = net_expense_total / float(days_covered)

    sales_series = _sales_series(rep_ids, user, start, end, today_d)
    sales_earned_mtd = sum(flt(item["amount"]) for item in sales_series)
    if total_sales <= 0 and sales_earned_mtd > 0:
        total_sales = sales_earned_mtd

    achievement_pct = round((total_sales / monthly_target) * 100, 1) if monthly_target else 0.0

    return {
        "available": True,
        "period": {
            "label": today_d.strftime("%B %Y"),
            "start": cstr(start),
            "end": cstr(end),
            "days_covered": days_covered,
            "days_in_month": days_in_month,
        },
        "rep": rep,
        "employee": {
            "id": employee.get("name") or employee_id or "",
            "name": employee.get("employee_name") or rep.get("full_name") or user,
            "department": employee.get("department") or "Field Sales",
            "designation": employee.get("designation") or rep.get("designation") or "",
            "phone": employee.get("cell_number") or rep.get("phone") or "",
            "email": employee.get("company_email") or user,
            "date_of_joining": cstr(employee.get("date_of_joining") or ""),
            "status": employee.get("status") or "Active",
            "company": employee.get("company") or "",
            "branch": employee.get("branch") or rep.get("territory_region") or "",
            "grade": employee.get("grade") or "",
        },
        "compensation": {
            "monthly_ctc": monthly_ctc,
            "monthly_target": monthly_target,
            "ctc_prorated_mtd": round(ctc_prorated, 2),
            "expenses_claimed_mtd": round(expenses_mtd, 2),
            "expense_sources": expense_sources,
            "net_expense_to_company_mtd": round(net_expense_total, 2),
            "net_expense_per_day": round(net_expense_per_day, 2),
        },
        "kpis": {
            "leads_uploaded": leads_uploaded,
            "visits_logged": visits_logged,
            "fofo_created": fofo_created,
            "foco_created": foco_created,
            "b2b_created": b2b_created,
            "total_sales_generated": round(total_sales, 2),
            "b2b_sales_entries_mtd": b2b_sales_count,
            "achievement_pct": achievement_pct,
            "used_seed_counts": {
                "fofo": fofo_actual == 0 and fofo_created > 0,
                "foco": foco_actual == 0 and foco_created > 0,
                "b2b": b2b_centres == 0 and b2b_created > 0,
            },
        },
        "charts": {
            "sales_earned": sales_series,
            "sales_earned_mtd": round(sales_earned_mtd, 2),
            "net_expense": {
                "ctc_prorated": round(ctc_prorated, 2),
                "expenses": round(expenses_mtd, 2),
                "total": round(net_expense_total, 2),
                "per_day": round(net_expense_per_day, 2),
                "days_covered": days_covered,
            },
        },
        "seed": seed_info,
    }
