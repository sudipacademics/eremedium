"""Phase 21 — HR self-service: Expense Claim + Leave Application for field staff."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, today

HR_ELIGIBLE_ROLES = frozenset(
    {
        "Phlebotomist",
        "Franchisee Operator",
        "Lab Technician",
        "Health System Admin",
        "System Manager",
        "Pathologist",
        "Sales Representative",
        "Sales Manager",
    }
)

REQUIRED_HR_DOCTYPES = (
    "Employee",
    "Expense Claim",
    "Leave Application",
    "Leave Type",
    "Expense Claim Type",
)


def hr_module_ready():
    return all(frappe.db.exists("DocType", name) for name in REQUIRED_HR_DOCTYPES)


def missing_hr_doctypes():
    return [name for name in REQUIRED_HR_DOCTYPES if not frappe.db.exists("DocType", name)]


def is_hr_eligible(roles):
    return bool(set(roles or []) & HR_ELIGIBLE_ROLES)


def _default_company():
    company = frappe.defaults.get_global_default("company")
    if company:
        return company
    rows = frappe.get_all("Company", limit=1, pluck="name")
    return rows[0] if rows else None


def ensure_hr_settings():
    if not frappe.db.exists("DocType", "HR Settings"):
        return
    try:
        doc = frappe.get_single("HR Settings")
        if getattr(doc, "employee_naming_by", None) in (None, "", "Full Name"):
            doc.employee_naming_by = "Naming Series"
        if getattr(doc, "employee_naming_series", None) in (None, ""):
            doc.employee_naming_series = "HR-EMP-.#####"
        doc.save(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="ensure_hr_settings", message=frappe.get_traceback())


def ensure_employee_for_user(user):
    if not frappe.db.exists("DocType", "Employee"):
        return None

    existing = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if existing:
        return existing

    profile = frappe.db.get_value(
        "User",
        user,
        ["full_name", "first_name", "last_name", "mobile_no", "gender"],
        as_dict=True,
    ) or {}
    full_name = (profile.get("full_name") or user).strip()
    parts = full_name.split(None, 1)
    first_name = profile.get("first_name") or parts[0]
    last_name = profile.get("last_name") or (parts[1] if len(parts) > 1 else "")

    company = _default_company()
    if not company:
        return None

    ensure_hr_settings()

    gender = profile.get("gender") or "Male"
    if gender not in ("Male", "Female", "Other"):
        gender = "Male"

    doc = frappe.get_doc(
        {
            "doctype": "Employee",
            "naming_series": "HR-EMP-.#####",
            "first_name": first_name,
            "last_name": last_name,
            "employee_name": full_name,
            "user_id": user,
            "company": company,
            "status": "Active",
            "gender": gender,
            "date_of_birth": "1990-01-01",
            "date_of_joining": today(),
            "cell_number": profile.get("mobile_no"),
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def ensure_leave_types():
    if not frappe.db.exists("DocType", "Leave Type"):
        return
    company = _default_company()
    for name, max_days in (
        ("Casual Leave", 12),
        ("Sick Leave", 10),
        ("Privilege Leave", 15),
    ):
        if frappe.db.exists("Leave Type", name):
            continue
        frappe.get_doc(
            {
                "doctype": "Leave Type",
                "leave_type_name": name,
                "max_leaves_allowed": max_days,
                "is_carry_forward": 0,
                "is_lwp": 0,
                "include_holiday": 0,
            }
        ).insert(ignore_permissions=True)


def _allocation_covers_dates(employee, leave_type, from_date, to_date):
    """Return submitted Leave Allocation name if it fully covers the date range."""
    if not frappe.db.exists("DocType", "Leave Allocation"):
        return None
    rows = frappe.get_all(
        "Leave Allocation",
        filters={
            "employee": employee,
            "leave_type": leave_type,
            "docstatus": 1,
            "from_date": ("<=", from_date),
            "to_date": (">=", to_date),
        },
        pluck="name",
        limit=1,
    )
    return rows[0] if rows else None


def ensure_leave_allocation(employee, leave_type, from_date, to_date, leaves=None):
    """Create a submitted Leave Allocation covering from_date..to_date if missing."""
    if not frappe.db.exists("DocType", "Leave Allocation"):
        return None

    from_date = getdate(from_date)
    to_date = getdate(to_date)
    existing = _allocation_covers_dates(employee, leave_type, from_date, to_date)
    if existing:
        return existing

    if leaves is None:
        leaves = flt(
            frappe.db.get_value("Leave Type", leave_type, "max_leaves_allowed") or 12
        )

    company = _default_company()
    doc = frappe.get_doc(
        {
            "doctype": "Leave Allocation",
            "employee": employee,
            "leave_type": leave_type,
            "from_date": from_date,
            "to_date": to_date,
            "new_leaves_allocated": leaves,
            "company": company,
        }
    )
    doc.insert(ignore_permissions=True)
    try:
        doc.submit()
    except Exception:
        frappe.log_error(title="leave_allocation_submit", message=frappe.get_traceback())
    return doc.name


def ensure_leave_allocations_for_staff(year=None):
    """Seed calendar-year leave allocations for linked field staff."""
    if not frappe.db.exists("DocType", "Leave Allocation"):
        return []

    year = cint(year) or getdate(today()).year
    period_start = getdate(f"{year}-01-01")
    period_end = getdate(f"{year}-12-31")
    created = []

    for email in (
        "phlebotomist@health.local",
        "franchise_hub@health.local",
        "lab_tech@health.local",
    ):
        if not frappe.db.exists("User", email):
            continue
        employee = ensure_employee_for_user(email)
        if not employee:
            continue
        for leave_type in ("Casual Leave", "Sick Leave"):
            if not frappe.db.exists("Leave Type", leave_type):
                continue
            name = ensure_leave_allocation(
                employee, leave_type, period_start, period_end
            )
            if name:
                created.append({"employee": employee, "leave_type": leave_type, "allocation": name})

    frappe.db.commit()
    return created


def ensure_expense_claim_types():
    if not frappe.db.exists("DocType", "Expense Claim Type"):
        return
    for name in ("Travel", "Food", "Medical", "Fuel", "Other"):
        if frappe.db.exists("Expense Claim Type", name):
            continue
        frappe.get_doc({"doctype": "Expense Claim Type", "expense_type": name}).insert(ignore_permissions=True)


def ensure_hr_role_permissions():
    from frappe.permissions import add_permission

    perm_sets = {
        "Expense Claim": ["read", "write", "create"],
        "Leave Application": ["read", "write", "create"],
        "Employee": ["read"],
        "Leave Type": ["read"],
        "Expense Claim Type": ["read"],
    }
    for doctype, ptypes in perm_sets.items():
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in HR_ELIGIBLE_ROLES:
            for ptype in ptypes:
                try:
                    add_permission(doctype, role, permlevel=0, ptype=ptype)
                except Exception:
                    pass


def serialize_leave_application(row):
    if isinstance(row, str):
        row = frappe.db.get_value(
            "Leave Application",
            row,
            [
                "name",
                "leave_type",
                "from_date",
                "to_date",
                "status",
                "description",
                "total_leave_days",
                "creation",
                "modified",
            ],
            as_dict=True,
        )
    if not row:
        return None
    return {
        "name": row.name,
        "leave_type": row.leave_type,
        "from_date": str(row.from_date),
        "to_date": str(row.to_date),
        "status": row.status,
        "description": row.description,
        "total_leave_days": flt(row.total_leave_days),
        "creation": str(row.creation),
        "modified": str(row.modified),
    }


def serialize_expense_claim(row):
    if isinstance(row, str):
        row = frappe.db.get_value(
            "Expense Claim",
            row,
            [
                "name",
                "approval_status",
                "total_claimed_amount",
                "posting_date",
                "remark",
                "creation",
                "modified",
            ],
            as_dict=True,
        )
    if not row:
        return None
    expenses = frappe.get_all(
        "Expense Claim Detail",
        filters={"parent": row.name},
        fields=["expense_type", "description", "amount", "sanctioned_amount"],
        order_by="idx asc",
    )
    return {
        "name": row.name,
        "approval_status": row.approval_status,
        "total_claimed_amount": flt(row.total_claimed_amount),
        "posting_date": str(row.posting_date) if row.posting_date else None,
        "remark": row.remark,
        "expenses": expenses,
        "creation": str(row.creation),
        "modified": str(row.modified),
    }


def get_hr_self_service_payload(user):
    ready = hr_module_ready()
    employee = ensure_employee_for_user(user) if ready else None

    leave_types = []
    expense_types = []
    leave_applications = []
    expense_claims = []

    if ready and employee:
        leave_types = frappe.get_all(
            "Leave Type",
            filters={"is_lwp": 0},
            fields=["name", "leave_type_name", "max_leaves_allowed"],
            order_by="leave_type_name asc",
            limit=50,
        )
        expense_types = frappe.get_all(
            "Expense Claim Type",
            fields=["name", "expense_type"],
            order_by="expense_type asc",
            limit=50,
        )
        leave_applications = [
            serialize_leave_application(r)
            for r in frappe.get_all(
                "Leave Application",
                filters={"employee": employee},
                fields=[
                    "name",
                    "leave_type",
                    "from_date",
                    "to_date",
                    "status",
                    "description",
                    "total_leave_days",
                    "creation",
                    "modified",
                ],
                order_by="creation desc",
                limit=30,
            )
        ]
        expense_claims = [
            serialize_expense_claim(r)
            for r in frappe.get_all(
                "Expense Claim",
                filters={"employee": employee},
                fields=[
                    "name",
                    "approval_status",
                    "total_claimed_amount",
                    "posting_date",
                    "remark",
                    "creation",
                    "modified",
                ],
                order_by="creation desc",
                limit=30,
            )
        ]

    return {
        "hr_available": ready,
        "missing_modules": missing_hr_doctypes() if not ready else [],
        "employee": employee,
        "leave_types": leave_types,
        "expense_types": expense_types,
        "leave_applications": [x for x in leave_applications if x],
        "expense_claims": [x for x in expense_claims if x],
    }


def submit_leave_application(user, leave_type, from_date, to_date, description=None):
    if not hr_module_ready():
        frappe.throw(_("HR module is not installed. Ask admin to run Phase 21 setup."))

    employee = ensure_employee_for_user(user)
    if not employee:
        frappe.throw(_("No employee profile linked to your user account"))

    if not frappe.db.exists("Leave Type", leave_type):
        frappe.throw(_("Invalid leave type"))

    from_date = getdate(from_date)
    to_date = getdate(to_date)
    if to_date < from_date:
        frappe.throw(_("To date cannot be before from date"))

    if not _allocation_covers_dates(employee, leave_type, from_date, to_date):
        year_start = getdate(f"{from_date.year}-01-01")
        year_end = getdate(f"{from_date.year}-12-31")
        ensure_leave_allocation(employee, leave_type, year_start, year_end)

    # HRMS: Leave Application is submitted only when Approved/Rejected.
    # ESS creates Open applications for manager approval in Desk.
    payload = {
        "doctype": "Leave Application",
        "employee": employee,
        "leave_type": leave_type,
        "from_date": from_date,
        "to_date": to_date,
        "description": description or "",
        "company": _default_company(),
    }
    meta = frappe.get_meta("Leave Application")
    if meta.has_field("status"):
        payload["status"] = "Open"
    if meta.has_field("leave_approver"):
        leave_approver = frappe.db.get_value("Employee", employee, "leave_approver")
        if leave_approver:
            payload["leave_approver"] = leave_approver

    doc = frappe.get_doc(payload)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return serialize_leave_application(doc)


def submit_expense_claim(user, expense_type, amount, description=None, expense_date=None):
    if not hr_module_ready():
        frappe.throw(_("HR module is not installed. Ask admin to run Phase 21 setup."))

    employee = ensure_employee_for_user(user)
    if not employee:
        frappe.throw(_("No employee profile linked to your user account"))

    if not frappe.db.exists("Expense Claim Type", expense_type):
        frappe.throw(_("Invalid expense type"))

    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero"))

    company = _default_company()
    doc = frappe.get_doc(
        {
            "doctype": "Expense Claim",
            "employee": employee,
            "company": company,
            "posting_date": getdate(expense_date) if expense_date else today(),
            "remark": description or "",
            "expenses": [
                {
                    "expense_type": expense_type,
                    "description": description or expense_type,
                    "amount": amount,
                    "sanctioned_amount": amount,
                }
            ],
        }
    )
    # Keep as draft/Open for approver; HRMS may reject submit until Approved.
    meta = frappe.get_meta("Expense Claim")
    if meta.has_field("approval_status"):
        doc.approval_status = "Draft"
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return serialize_expense_claim(doc)


def attach_receipt_to_expense_claim(expense_claim_name, user, filename, content_b64):
    if not frappe.db.exists("Expense Claim", expense_claim_name):
        frappe.throw(_("Expense claim not found"))

    employee = ensure_employee_for_user(user)
    owner_employee = frappe.db.get_value("Expense Claim", expense_claim_name, "employee")
    if employee != owner_employee:
        frappe.throw(_("Not permitted"))

    import base64

    from frappe.utils.file_manager import save_file

    content = base64.b64decode(content_b64)
    save_file(filename, content, "Expense Claim", expense_claim_name, decode=False, is_private=1)
    frappe.db.commit()
    return {"ok": True, "expense_claim": expense_claim_name}


def setup_phase21():
    missing = missing_hr_doctypes()
    if missing:
        return {
            "ok": False,
            "phase": 21,
            "missing_modules": missing,
            "hint": "Install HRMS: bench get-app hrms && bench --site SITE install-app hrms",
        }

    ensure_leave_types()
    ensure_expense_claim_types()
    ensure_hr_settings()
    ensure_hr_role_permissions()
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import repair_hrms_employee_fields

        repair_hrms_employee_fields()
    except Exception:
        frappe.log_error(title="phase21_hrms_repair", message=frappe.get_traceback())

    # Link demo staff to employees
    for email in (
        "phlebotomist@health.local",
        "franchise_hub@health.local",
        "lab_tech@health.local",
    ):
        if frappe.db.exists("User", email):
            try:
                ensure_employee_for_user(email)
            except Exception:
                frappe.log_error(title="phase21_employee", message=frappe.get_traceback())

    try:
        ensure_leave_allocations_for_staff()
    except Exception:
        frappe.log_error(title="phase21_leave_allocation", message=frappe.get_traceback())

    frappe.db.commit()
    return {"ok": True, "phase": 21, "hr_available": True}


def smoke_phase21():
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase21()
    check("setup", setup.get("ok"), str(setup.get("missing_modules") or setup.get("hr_available")))
    check("hr_module_ready", hr_module_ready(), str(missing_hr_doctypes()))

    for dt in REQUIRED_HR_DOCTYPES:
        check(f"doctype_{dt}", frappe.db.exists("DocType", dt))

    check("leave_types", frappe.db.count("Leave Type") >= 1 if frappe.db.exists("DocType", "Leave Type") else False)
    check(
        "expense_types",
        frappe.db.count("Expense Claim Type") >= 1 if frappe.db.exists("DocType", "Expense Claim Type") else False,
    )

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_get_hr", hasattr(api_mod, "get_hr_self_service"))
    check("api_leave", hasattr(api_mod, "submit_leave_application"))
    check("api_expense", hasattr(api_mod, "submit_expense_claim"))

    user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
    try:
        emp = ensure_employee_for_user(user)
        check("employee_link", bool(emp), str(emp))
        payload = get_hr_self_service_payload(user)
        check("hr_payload", isinstance(payload, dict), str(list(payload.keys())[:8]))
    except Exception as exc:
        check("employee_link", False, str(exc)[:160])

    return result

