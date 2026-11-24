"""Phase 25 — Sales / field force (MR-style): leads, visits, onboarding, GPS, closing reports."""

from __future__ import annotations

import json
import os
import re
from calendar import monthrange
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, now_datetime, today

SALES_REP_ROLE = "Sales Representative"
SALES_MANAGER_ROLE = "Sales Manager"
SALES_ROLES = (SALES_REP_ROLE, SALES_MANAGER_ROLE, "Health System Admin", "System Manager")
LOCATION_CACHE_KEY = "hec_sales_rep_locations"
# Director / national leadership sees the full Reach field force (not only reports_to tree).
ORG_WIDE_SALES_DESIGNATIONS = (
    "director",
    "managing director",
    "national head",
    "sales director",
    "ceo",
    "owner",
    "founder",
)

PHASE25_DOCTYPES = (
    ("sales_rep_profile", "Sales Rep Profile"),
    ("franchise_sales_lead", "Franchise Sales Lead"),
    ("field_sales_visit", "Field Sales Visit"),
    ("franchise_onboarding_request", "Franchise Onboarding Request"),
    ("sales_closing_report", "Sales Closing Report"),
    ("sales_team_performance_report", "Sales Team Performance Report"),
)

HEC_MODULE = "Health Ecosystem Core"


def ensure_hec_module_def():
    """Prevent 'Module Health Ecosystem Core not found' on DocType / custom field ops."""
    try:
        from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

        ensure_module_def()
    except Exception:
        if frappe.db.exists("Module Def", HEC_MODULE):
            return
        try:
            frappe.get_doc(
                {
                    "doctype": "Module Def",
                    "module_name": HEC_MODULE,
                    "app_name": "health_ecosystem_core",
                    "custom": 0,
                }
            ).insert(ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.log_error(title="ensure_hec_module_def", message=frappe.get_traceback())


def is_sales_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    return bool(set(frappe.get_roles(user)) & set(SALES_ROLES))


def is_sales_manager(user=None):
    roles = set(frappe.get_roles(user or frappe.session.user))
    return SALES_MANAGER_ROLE in roles or "Health System Admin" in roles or "System Manager" in roles


def is_org_wide_sales_viewer(user=None):
    """Director / System Admin / National Head — full Reach team, not just reports_to children."""
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    roles = set(frappe.get_roles(user))
    if "System Manager" in roles or "Health System Admin" in roles or "Administrator" in roles:
        return True
    if user == "Administrator":
        return True
    rep_id = resolve_sales_rep(user)
    if not rep_id:
        return False
    designation = cstr(frappe.db.get_value("Sales Rep Profile", rep_id, "designation") or "").strip().lower()
    if not designation:
        return False
    return any(token in designation for token in ORG_WIDE_SALES_DESIGNATIONS)


def all_active_sales_rep_ids():
    return frappe.get_all("Sales Rep Profile", filters={"active": 1}, pluck="name") or []


def _import_doctype(folder, doctype_name):
    if frappe.db.exists("DocType", doctype_name):
        return
    from frappe.modules.import_file import import_file_by_path

    candidates = []
    app_path = frappe.get_app_path("health_ecosystem_core")
    candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
    except Exception:
        pass
    for json_path in candidates:
        if os.path.isfile(json_path):
            import_file_by_path(json_path, force=True)
            frappe.db.commit()
            if frappe.db.exists("DocType", doctype_name):
                return
    frappe.throw(_("Could not install {0}").format(doctype_name))


def ensure_phase25_doctypes():
    ensure_hec_module_def()
    for folder, name in PHASE25_DOCTYPES:
        _import_doctype(folder, name)


def ensure_phase25_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    ensure_phase25_doctypes()
    create_custom_fields(
        {
            "Franchisee Profile": [
                {
                    "fieldname": "acquired_by_sales_rep",
                    "label": "Acquired By (Sales Rep)",
                    "fieldtype": "Link",
                    "options": "Sales Rep Profile",
                    "insert_after": "address",
                },
            ],
        },
        update=True,
    )


def ensure_sales_roles():
    for role_name, desk in (
        (SALES_REP_ROLE, 0),
        (SALES_MANAGER_ROLE, 1),
    ):
        if not frappe.db.exists("Role", role_name):
            frappe.get_doc(
                {
                    "doctype": "Role",
                    "role_name": role_name,
                    "desk_access": desk,
                    "description": f"Phase 25 field sales — {role_name}",
                }
            ).insert(ignore_permissions=True)


def resolve_sales_rep(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    rep = frappe.db.get_value(
        "Sales Rep Profile",
        {"user": user, "active": 1},
        "name",
    )
    return rep


def get_or_create_sales_rep(user):
    existing = resolve_sales_rep(user)
    if existing:
        return existing
    if not is_sales_user(user):
        return None
    profile = frappe.db.get_value("User", user, ["full_name", "mobile_no"], as_dict=True) or {}
    rep_code = frappe.db.get_value("User", user, "username") or user.split("@")[0]
    rep_code = rep_code.upper().replace(".", "")[:12]
    suffix = 1
    base = rep_code
    while frappe.db.exists("Sales Rep Profile", {"rep_code": rep_code}):
        rep_code = f"{base}{suffix}"
        suffix += 1
    doc = frappe.get_doc(
        {
            "doctype": "Sales Rep Profile",
            "rep_code": rep_code,
            "user": user,
            "full_name": profile.get("full_name") or user,
            "phone": profile.get("mobile_no"),
            "designation": "Area Manager" if is_sales_manager(user) else "Sales Representative",
            "active": 1,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _subordinate_rep_ids(rep_id, collected=None):
    collected = collected or set()
    if not rep_id or rep_id in collected:
        return list(collected)
    collected.add(rep_id)
    for child in frappe.get_all("Sales Rep Profile", filters={"reports_to": rep_id, "active": 1}, pluck="name"):
        _subordinate_rep_ids(child, collected)
    return list(collected)


def scoped_rep_ids(user=None):
    """Reps visible to user: self, hierarchy if manager, or full Reach team if director/admin."""
    user = user or frappe.session.user
    if is_org_wide_sales_viewer(user):
        return all_active_sales_rep_ids()
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        return []
    if is_sales_manager(user):
        team = _subordinate_rep_ids(rep_id)
        # Sales Manager role is widely granted; if nobody reports to this profile, keep self only
        # (org-wide viewers are handled above via designation / System Admin).
        return team or [rep_id]
    return [rep_id]


def serialize_rep(rep_id):
    doc = frappe.get_doc("Sales Rep Profile", rep_id)
    manager = None
    if doc.reports_to:
        manager = frappe.db.get_value("Sales Rep Profile", doc.reports_to, ["full_name", "rep_code"], as_dict=True)
    team = frappe.get_all(
        "Sales Rep Profile",
        filters={"reports_to": rep_id, "active": 1},
        fields=["name", "rep_code", "full_name", "designation", "territory_region"],
    )
    return {
        "rep_id": doc.name,
        "rep_code": doc.rep_code,
        "full_name": doc.full_name,
        "designation": doc.designation,
        "territory_region": doc.territory_region,
        "phone": doc.phone,
        "hq_latitude": flt(doc.hq_latitude),
        "hq_longitude": flt(doc.hq_longitude),
        "reports_to": doc.reports_to,
        "manager": manager,
        "team": team,
    }


def _period_bounds(report_type, period_date):
    d = getdate(period_date)
    if report_type == "Monthly":
        start = d.replace(day=1)
        end_day = monthrange(d.year, d.month)[1]
        end = d.replace(day=end_day)
        return start, end
    return d, d


def _franchisee_ids_for_reps(rep_ids):
    if not rep_ids:
        return []
    meta = frappe.get_meta("Franchisee Profile")
    if meta.has_field("acquired_by_sales_rep"):
        return frappe.get_all(
            "Franchisee Profile",
            filters={"acquired_by_sales_rep": ("in", rep_ids)},
            pluck="name",
        )
    return []


def _franchisee_stats(franchisee_ids, start_date=None, end_date=None):
    if not franchisee_ids:
        return {"franchisees": [], "total_trfs": 0, "total_revenue": 0}
    franchisees = []
    total_trfs = 0
    total_revenue = 0
    filters = {"franchisee_id": ("in", franchisee_ids)}
    if start_date and end_date:
        filters["creation"] = ("between", [f"{start_date} 00:00:00", f"{end_date} 23:59:59"])

    for fid in franchisee_ids:
        row = frappe.db.get_value(
            "Franchisee Profile",
            fid,
            ["name", "franchise_name", "branch_code", "territory_region", "active_status"],
            as_dict=True,
        )
        if not row:
            continue
        trf_filters = {"franchisee_id": fid}
        if start_date and end_date:
            trf_filters["creation"] = ("between", [f"{start_date} 00:00:00", f"{end_date} 23:59:59"])
        trfs = frappe.get_all("Customer TRF", filters=trf_filters, fields=["amount", "razorpay_payment_status"])
        paid = [t for t in trfs if t.razorpay_payment_status == "Paid"]
        revenue = sum(flt(t.amount) for t in paid)
        total_trfs += len(trfs)
        total_revenue += revenue
        franchisees.append(
            {
                "franchisee_id": fid,
                "franchise_name": row.franchise_name,
                "branch_code": row.branch_code,
                "territory_region": row.territory_region,
                "active_status": row.active_status,
                "trf_count": len(trfs),
                "revenue": revenue,
            }
        )
    return {"franchisees": franchisees, "total_trfs": total_trfs, "total_revenue": total_revenue}


def get_sales_portal_payload(user=None):
    user = user or frappe.session.user
    if not is_sales_user(user):
        return {"available": False, "reason": "sales_access_required"}

    ensure_hec_module_def()
    rep_id = get_or_create_sales_rep(user)
    rep = serialize_rep(rep_id)
    rep_ids = scoped_rep_ids(user)
    today_start = f"{today()} 00:00:00"

    visits_today = frappe.db.count("Field Sales Visit", {"sales_rep": ("in", rep_ids), "visit_date": today()})
    leads_open = frappe.db.count(
        "Franchise Sales Lead",
        {"assigned_rep": ("in", rep_ids), "status": ("not in", ["Won", "Lost"])},
    )
    franchisee_ids = _franchisee_ids_for_reps(rep_ids)
    month_end = getdate(today())
    month_start = month_end.replace(day=1)
    stats = _franchisee_stats(franchisee_ids, month_start, month_end)

    commission = {"available": False}
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import get_commission_summary

        commission = get_commission_summary(user)
    except Exception:
        pass

    return {
        "available": True,
        "rep": rep,
        "is_manager": is_sales_manager(user),
        "team_rep_ids": rep_ids,
        "stats": {
            "visits_today": visits_today,
            "open_leads": leads_open,
            "franchisees_count": len(franchisee_ids),
            "month_trfs": stats["total_trfs"],
            "month_revenue": stats["total_revenue"],
            "month_commission": commission.get("month_accrued", 0),
            "accrued_commission": commission.get("accrued_total", 0),
        },
        "commission": commission,
        "hr_available": True,
    }


def list_sales_leads(user=None, limit=50):
    # Ads attribution columns may be missing until Phase 86 ensure / migrate.
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            ensure_phase86_fields,
        )

        ensure_phase86_fields()
    except Exception:
        frappe.log_error(title="ensure_phase86_fields_list_leads", message=frappe.get_traceback())

    rep_ids = scoped_rep_ids(user)
    fields = [
        "name",
        "lead_name",
        "company_name",
        "phone",
        "email",
        "city",
        "district",
        "subdivision",
        "pincode",
        "status",
        "assigned_rep",
        "franchisee",
        "lead_source",
        "platform",
        "external_lead_id",
        "campaign_name",
        "campaign_id",
        "ad_id",
        "form_id",
        "rfms_lead_id",
        "latitude",
        "longitude",
        "modified",
    ]
    meta = frappe.get_meta("Franchise Sales Lead")
    fields = [f for f in fields if f == "name" or meta.has_field(f)]
    # Managers see team leads + unassigned ads pool; reps see only their assigned leads.
    fetch_limit = cint(limit) * 3 if is_sales_manager(user) else cint(limit)
    rows = frappe.get_all(
        "Franchise Sales Lead",
        fields=fields,
        order_by="modified desc",
        limit=max(fetch_limit, cint(limit)),
    )
    if is_sales_manager(user):
        allowed = set(rep_ids or [])
        rows = [
            row
            for row in rows
            if (not row.get("assigned_rep")) or (row.get("assigned_rep") in allowed)
        ][: cint(limit)]
    else:
        allowed = set(rep_ids or [])
        rows = [row for row in rows if row.get("assigned_rep") in allowed][: cint(limit)]
    for row in rows:
        row.setdefault("lead_source", "Manual")
    return rows


def update_sales_lead(user, lead_id, data):
    """Sales app: update status / contact fields on an owned Franchise Sales Lead."""
    lead_id = cstr(lead_id or "").strip()
    if not lead_id or not frappe.db.exists("Franchise Sales Lead", lead_id):
        frappe.throw(_("Lead not found"))
    doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    rep_ids = set(scoped_rep_ids(user) or [])
    if not is_sales_manager(user):
        if doc.assigned_rep and doc.assigned_rep not in rep_ids:
            frappe.throw(_("You can only update leads assigned to you"), frappe.PermissionError)

    meta = frappe.get_meta("Franchise Sales Lead")
    editable = (
        "lead_name",
        "company_name",
        "contact_person",
        "phone",
        "email",
        "address",
        "city",
        "district",
        "subdivision",
        "pincode",
        "state",
        "status",
        "notes",
        "latitude",
        "longitude",
        "lead_source",
    )
    changed = {}
    for key in editable:
        if key not in data or data.get(key) is None:
            continue
        if not meta.has_field(key):
            continue
        val = data.get(key)
        if key in ("latitude", "longitude"):
            val = flt(val) if val not in ("", None) else None
        else:
            val = cstr(val).strip() if isinstance(val, str) else val
        if key == "status" and val:
            options = (meta.get_field("status").options or "").split("\n")
            if val not in options:
                frappe.throw(_("Invalid lead status: {0}").format(val))
        setattr(doc, key, val)
        changed[key] = val
    if not changed:
        frappe.throw(_("No updatable fields provided"))
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    try:
        _sync_sales_lead_to_rfms(doc, doc.assigned_rep)
    except Exception:
        frappe.log_error(title="update_sales_lead_rfms_sync", message=frappe.get_traceback())
    return {
        "lead_id": doc.name,
        "status": doc.status,
        "changed": list(changed.keys()),
        "lead": {
            "name": doc.name,
            "lead_name": doc.lead_name,
            "phone": doc.phone,
            "status": doc.status,
            "city": getattr(doc, "city", None),
            "assigned_rep": doc.assigned_rep,
        },
    }


def list_sales_onboarding(user=None, limit=50):
    """Franchise onboarding requests for the rep / manager scope."""
    if not frappe.db.exists("DocType", "Franchise Onboarding Request"):
        return []
    rep_ids = scoped_rep_ids(user)
    filters = {}
    if rep_ids:
        filters["sales_rep"] = ("in", list(rep_ids))
    rows = frappe.get_all(
        "Franchise Onboarding Request",
        filters=filters,
        fields=[
            "name",
            "sales_rep",
            "lead",
            "franchise_name",
            "owner_name",
            "proposed_branch_code",
            "territory_region",
            "phone",
            "email",
            "status",
            "franchisee_id",
            "commission_percentage_rate",
            "notes",
            "creation",
            "modified",
        ],
        order_by="modified desc",
        limit=cint(limit) or 50,
    )
    for row in rows:
        row["onboarding_id"] = row.get("name")
        row["timeline"] = [
            {"label": "Created", "at": str(row.get("creation") or "")},
            {"label": row.get("status") or "Status", "at": str(row.get("modified") or "")},
        ]
        if row.get("franchisee_id"):
            row["timeline"].append(
                {"label": "Franchisee linked", "at": str(row.get("modified") or ""), "franchisee_id": row["franchisee_id"]}
            )
    return rows


def list_sales_franchisees(user=None, period=None):
    """Franchisee list for REACH app (alias of stats.franchisees + counts)."""
    from frappe.utils import getdate, today

    rep_ids = scoped_rep_ids(user)
    fids = _franchisee_ids_for_reps(rep_ids)
    if period == "month":
        month_end = getdate(today())
        start = month_end.replace(day=1)
        stats = _franchisee_stats(fids, start, month_end)
    else:
        stats = _franchisee_stats(fids)
    stats["onboardings"] = list_sales_onboarding(user, limit=50)
    return stats


def create_sales_lead(user, data):
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        frappe.throw(_("Sales rep profile required"))
    doc = frappe.get_doc(
        {
            "doctype": "Franchise Sales Lead",
            "lead_name": data.get("lead_name"),
            "company_name": data.get("company_name"),
            "contact_person": data.get("contact_person"),
            "phone": data.get("phone"),
            "email": data.get("email"),
            "address": data.get("address"),
            "city": data.get("city"),
            "district": data.get("district"),
            "subdivision": data.get("subdivision"),
            "pincode": data.get("pincode"),
            "state": data.get("state") or "West Bengal",
            "latitude": flt(data.get("latitude")) or None,
            "longitude": flt(data.get("longitude")) or None,
            "status": data.get("status") or "New",
            "assigned_rep": rep_id,
            "lead_source": data.get("lead_source") or "Manual",
            "notes": data.get("notes"),
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    _sync_sales_lead_to_rfms(doc, rep_id)
    return doc.name


def _sync_sales_lead_to_rfms(doc, rep_id=None):
    """Push REACH / ERP Franchise Sales Lead into FFMS Admin CRM in real time."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _push_lead_to_rfms,
        )

        phone_digits = re.sub(r"\D", "", cstr(doc.phone or ""))
        email = cstr(doc.email or "").strip().lower()
        # RFMS ingest requires name + 10-digit mobile + email
        if not phone_digits or len(phone_digits) < 10:
            digits_from_name = re.sub(r"\D", "", cstr(doc.name or ""))
            phone_digits = (digits_from_name + "9000000000")[-10:]
        if not email:
            email = f"{phone_digits}@reach.franchise.local"
        territory = ", ".join(
            [
                part
                for part in [
                    cstr(doc.district or "").strip(),
                    cstr(doc.subdivision or "").strip(),
                    cstr(doc.city or "").strip(),
                    cstr(doc.pincode or "").strip(),
                ]
                if part
            ]
        )
        assigned_to = "Unassigned"
        reach_user_email = ""
        reach_user_id = cstr(rep_id or doc.get("assigned_rep") or "").strip()
        if reach_user_id and frappe.db.exists("Sales Rep Profile", reach_user_id):
            assigned_to = cstr(frappe.db.get_value("Sales Rep Profile", reach_user_id, "full_name") or "").strip() or "Unassigned"
            # Optional enrichment — never block sync if columns differ by site.
            try:
                meta = frappe.get_meta("Sales Rep Profile")
                if meta.has_field("linked_user"):
                    reach_user_email = cstr(frappe.db.get_value("Sales Rep Profile", reach_user_id, "linked_user") or "")
                if not territory and meta.has_field("territory_region"):
                    region = cstr(frappe.db.get_value("Sales Rep Profile", reach_user_id, "territory_region") or "")
                    if region:
                        territory = region
            except Exception:
                pass
        lead_source = "Manual"
        try:
            if frappe.get_meta("Franchise Sales Lead").has_field("lead_source"):
                lead_source = cstr(doc.get("lead_source") or "Manual").strip() or "Manual"
        except Exception:
            lead_source = "Manual"
        created_at = cstr(getattr(doc, "creation", None) or "") or None
        rfms = _push_lead_to_rfms(
            {
                "name": cstr(doc.lead_name or doc.company_name or "REACH lead"),
                "email": email,
                "mobile": phone_digits,
                "territory_query": territory or cstr(doc.address or "") or "West Bengal",
                "source": "reach_sales",
                "platform": "reach",
                "campaign_name": "REACH Portal",
                "external_lead_id": doc.name,
                "hec_lead_id": doc.name,
                "rfms_lead_id": cstr(doc.get("rfms_lead_id") or ""),
                "id": cstr(doc.get("rfms_lead_id") or ""),
                "notes": cstr(doc.notes or "")[:1000],
                "assigned_to": assigned_to,
                "assignee_role": "reach" if reach_user_id else "",
                "sales_rep_id": reach_user_id,
                "reach_user_name": assigned_to if reach_user_id else "",
                "reach_user_email": reach_user_email,
                "reach_lead_source": lead_source,
                "stage": _reach_status_to_rfms_stage(doc.status),
                "priority": "normal",
                "created_at": created_at,
            }
        )
        if rfms.get("lead_id"):
            frappe.db.set_value("Franchise Sales Lead", doc.name, "rfms_lead_id", rfms["lead_id"])
            frappe.db.commit()
        elif not rfms.get("ok"):
            return rfms
        return rfms
    except Exception:
        frappe.log_error(title="reach_lead_rfms_sync", message=frappe.get_traceback())
        return {"ok": False, "error": "exception", "trace": frappe.get_traceback()[:1500]}


def _reach_status_to_rfms_stage(status):
    mapping = {
        "New": "new",
        "Contacted": "contacted",
        "Meeting Done": "contacted",
        "Qualified": "qualified",
        "Negotiation": "follow_up",
        "Won": "won",
        "Lost": "lost",
    }
    return mapping.get(cstr(status or "").strip(), "new")


def _rfms_stage_to_reach_status(stage):
    mapping = {
        "new": "New",
        "contacted": "Contacted",
        "meeting_done": "Meeting Done",
        "qualified": "Qualified",
        "follow_up": "Negotiation",
        "negotiation": "Negotiation",
        "won": "Won",
        "lost": "Lost",
        "disqualified": "Lost",
        "completed": "Won",
    }
    return mapping.get(cstr(stage or "").strip().lower().replace(" ", "_"), None)


def resolve_sales_rep_profile_id(identifier):
    """Resolve Sales Rep Profile by name (rep_code), employee ID, linked user email, or full name."""
    key = cstr(identifier or "").strip()
    if not key:
        return None
    if frappe.db.exists("Sales Rep Profile", key):
        return key
    meta = frappe.get_meta("Sales Rep Profile")
    if meta.has_field("employee"):
        by_emp = frappe.db.get_value("Sales Rep Profile", {"employee": key}, "name")
        if by_emp:
            return by_emp
        # Employee DocType may store company employee_number separately
        if frappe.db.exists("DocType", "Employee"):
            emp_name = frappe.db.get_value("Employee", {"employee_number": key}, "name") or frappe.db.get_value(
                "Employee", {"name": key}, "name"
            )
            if emp_name:
                by_emp = frappe.db.get_value("Sales Rep Profile", {"employee": emp_name}, "name")
                if by_emp:
                    return by_emp
    if meta.has_field("user"):
        by_user = frappe.db.get_value("Sales Rep Profile", {"user": key}, "name")
        if by_user:
            return by_user
    if meta.has_field("rep_code"):
        by_code = frappe.db.get_value("Sales Rep Profile", {"rep_code": key}, "name")
        if by_code:
            return by_code
    # Desk / FFMS sometimes stores display name in assigned_rep.
    if meta.has_field("full_name"):
        by_name = frappe.db.get_value("Sales Rep Profile", {"full_name": key}, "name")
        if by_name:
            return by_name
        # Case-insensitive / trimmed match for a small active roster.
        for row in frappe.get_all(
            "Sales Rep Profile",
            fields=["name", "full_name"],
            limit=300,
        ):
            if cstr(row.get("full_name") or "").strip().lower() == key.lower():
                return row.name
    return None


def ensure_reach_ffms_visit_fields():
    """Ensure Field Sales Visit has visit_status + photo columns for FFMS sync."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    for fieldname, fieldtype, options, insert_after in (
        ("visit_status", "Select", "Assigned\nIn Progress\nCompleted\nCancelled", "notes"),
        ("photo", "Attach Image", None, "visit_status"),
        ("assigned_from", "Data", None, "photo"),
    ):
        if frappe.get_meta("Field Sales Visit").has_field(fieldname) and frappe.db.has_column(
            "Field Sales Visit", fieldname
        ):
            continue
        if not frappe.db.exists("Custom Field", {"dt": "Field Sales Visit", "fieldname": fieldname}):
            try:
                create_custom_fields(
                    {
                        "Field Sales Visit": [
                            {
                                "fieldname": fieldname,
                                "label": fieldname.replace("_", " ").title(),
                                "fieldtype": fieldtype,
                                "options": options,
                                "insert_after": insert_after,
                            }
                        ]
                    },
                    update=True,
                )
            except Exception:
                frappe.log_error(title="reach_ffms_visit_cf", message=frappe.get_traceback())
        if not frappe.db.has_column("Field Sales Visit", fieldname):
            sql_type = "text" if fieldtype == "Attach Image" else "varchar(140)"
            frappe.db.sql(f"ALTER TABLE `tabField Sales Visit` ADD COLUMN `{fieldname}` {sql_type} NULL")
            frappe.db.commit()
    frappe.clear_cache(doctype="Field Sales Visit")


def _attach_visit_photo(doc, photo_base64, photo_filename=None):
    """Decode data-URL / raw base64 and attach as visit photo."""
    ensure_reach_ffms_visit_fields()
    raw = cstr(photo_base64 or "").strip()
    if not raw:
        return
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        import base64

        content = base64.b64decode(raw, validate=False)
    except Exception:
        frappe.throw(_("Invalid visit photo payload"))
    if len(content) > 4_000_000:
        frappe.throw(_("Visit photo must be under 4 MB"))
    fname = cstr(photo_filename or f"visit-{doc.name or 'new'}.jpg").replace("/", "_")[:120]
    from frappe.utils.file_manager import save_file

    file_doc = save_file(fname, content, "Field Sales Visit", doc.name, is_private=0)
    doc.db_set("photo", file_doc.file_url)
    return file_doc.file_url


def log_field_visit(user, data):
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        frappe.throw(_("Sales rep profile required"))
    ensure_reach_ffms_visit_fields()
    visit_id = cstr(data.get("visit_id") or "").strip()
    if visit_id and frappe.db.exists("Field Sales Visit", visit_id):
        doc = frappe.get_doc("Field Sales Visit", visit_id)
        if doc.sales_rep != rep_id and not is_sales_manager(user):
            frappe.throw(_("Not allowed to update this visit"))
        doc.visit_date = data.get("visit_date") or doc.visit_date or today()
        doc.visit_time = data.get("visit_time") or datetime.now().strftime("%H:%M:%S")
        doc.latitude = flt(data.get("latitude"))
        doc.longitude = flt(data.get("longitude"))
        if data.get("purpose"):
            doc.purpose = data.get("purpose")
        if data.get("outcome") is not None:
            doc.outcome = data.get("outcome")
        if data.get("duration_minutes") is not None:
            doc.duration_minutes = cint(data.get("duration_minutes"))
        if data.get("notes") is not None:
            doc.notes = data.get("notes")
        if data.get("lead_id"):
            doc.lead = data.get("lead_id")
        doc.visit_status = "Completed"
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Field Sales Visit",
                "sales_rep": rep_id,
                "lead": data.get("lead_id"),
                "franchisee": data.get("franchisee_id"),
                "visit_date": data.get("visit_date") or today(),
                "visit_time": data.get("visit_time") or datetime.now().strftime("%H:%M:%S"),
                "latitude": flt(data.get("latitude")),
                "longitude": flt(data.get("longitude")),
                "purpose": data.get("purpose") or "Meet Lead",
                "outcome": data.get("outcome"),
                "duration_minutes": cint(data.get("duration_minutes")),
                "notes": data.get("notes"),
                "visit_status": "Completed",
            }
        )
        doc.insert(ignore_permissions=True)
    if data.get("photo_base64"):
        _attach_visit_photo(doc, data.get("photo_base64"), data.get("photo_filename"))
        doc.reload()
    # Keep lead assignment + stage in sync with FFMS after every completed visit.
    lead_id = cstr(data.get("lead_id") or getattr(doc, "lead", None) or "").strip()
    if lead_id and frappe.db.exists("Franchise Sales Lead", lead_id):
        next_status = cstr(data.get("lead_status") or "").strip()
        if not next_status:
            # Completing an assigned Log Visit implies the lead was contacted.
            current = cstr(frappe.db.get_value("Franchise Sales Lead", lead_id, "status") or "New")
            if current in ("", "New"):
                next_status = "Contacted"
        if next_status:
            frappe.db.set_value("Franchise Sales Lead", lead_id, "status", next_status)
        # Ensure assigned_rep matches the rep who logged the visit (prevents orphan leads).
        assigned = cstr(frappe.db.get_value("Franchise Sales Lead", lead_id, "assigned_rep") or "")
        if not assigned:
            frappe.db.set_value("Franchise Sales Lead", lead_id, "assigned_rep", rep_id)
        lead_doc = frappe.get_doc("Franchise Sales Lead", lead_id)
        _sync_sales_lead_to_rfms(lead_doc, lead_doc.assigned_rep or rep_id)
    frappe.db.commit()
    _sync_field_visit_to_rfms(doc, rep_id)
    return doc.name


def _visit_photo_payload(doc):
    """Public URL + optional inline data for FFMS when file is small."""
    photo = cstr(getattr(doc, "photo", None) or "")
    out = {"photo_url": "", "photo_data_url": ""}
    if not photo:
        return out
    site = cstr(frappe.utils.get_url()).rstrip("/")
    out["photo_url"] = photo if photo.startswith("http") else f"{site}{photo}"
    try:
        import os
        import base64

        path = frappe.get_site_path("public", photo.lstrip("/"))
        if os.path.isfile(path) and os.path.getsize(path) <= 350_000:
            with open(path, "rb") as handle:
                encoded = base64.b64encode(handle.read()).decode("ascii")
            ext = photo.rsplit(".", 1)[-1].lower() if "." in photo else "jpeg"
            mime = "image/png" if ext == "png" else "image/webp" if ext == "webp" else "image/jpeg"
            out["photo_data_url"] = f"data:{mime};base64,{encoded}"
    except Exception:
        pass
    return out


def _sync_field_visit_to_rfms(doc, rep_id=None):
    """Mirror REACH field visits into FFMS Admin Log Visit module."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            get_rfms_api_base_url,
            _franchise_ads_secret,
        )
        from urllib.request import Request, urlopen
        import json

        base = get_rfms_api_base_url()
        if not base:
            return {"ok": False, "error": "rfms_api_base_url missing"}
        secret = _franchise_ads_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
        rep_name = ""
        if rep_id and frappe.db.exists("Sales Rep Profile", rep_id):
            rep_name = cstr(frappe.db.get_value("Sales Rep Profile", rep_id, "full_name") or "")
        lead_name = ""
        lead_phone = ""
        rfms_lead_id = ""
        lead_status = ""
        if doc.lead and frappe.db.exists("Franchise Sales Lead", doc.lead):
            lead = frappe.db.get_value(
                "Franchise Sales Lead",
                doc.lead,
                ["lead_name", "phone", "rfms_lead_id", "status"],
                as_dict=True,
            )
            if lead:
                lead_name = cstr(lead.lead_name or "")
                lead_phone = cstr(lead.phone or "")
                rfms_lead_id = cstr(lead.rfms_lead_id or "")
                lead_status = cstr(lead.status or "")
        photos = _visit_photo_payload(doc)
        visit_status = cstr(getattr(doc, "visit_status", None) or "").strip()
        if not visit_status:
            # Never default pending assignments to Completed — that hides them in Reach.
            if flt(doc.latitude) or flt(doc.longitude) or cstr(doc.outcome or "").strip():
                visit_status = "Completed"
            else:
                visit_status = "Assigned"
        payload = {
            "visits": [
                {
                    "hec_visit_id": doc.name,
                    "hec_lead_id": cstr(doc.lead or ""),
                    "rfms_lead_id": rfms_lead_id,
                    "lead_name": lead_name,
                    "lead_phone": lead_phone,
                    "lead_status": lead_status,
                    "reach_user": rep_name,
                    "sales_rep_id": cstr(rep_id or ""),
                    "visit_date": cstr(doc.visit_date or ""),
                    "visit_time": cstr(doc.visit_time or ""),
                    "purpose": cstr(doc.purpose or ""),
                    "outcome": cstr(doc.outcome or ""),
                    "visit_status": visit_status,
                    "duration_minutes": cint(doc.duration_minutes),
                    "latitude": flt(doc.latitude),
                    "longitude": flt(doc.longitude),
                    "notes": cstr(doc.notes or "")[:2000],
                    "photo_url": photos["photo_url"],
                    "photo_data_url": photos["photo_data_url"],
                    "assigned_from": cstr(getattr(doc, "assigned_from", None) or ""),
                    "source": "reach",
                }
            ]
        }
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if secret:
            headers["X-Franchise-Ads-Secret"] = secret
        req = Request(f"{base}/sales-visits/ingest", data=body, headers=headers, method="POST")
        with urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            data = json.loads(text) if text else {}
            return {"ok": True, "data": data.get("data") if isinstance(data, dict) else data}
    except Exception:
        frappe.log_error(title="reach_visit_rfms_sync", message=frappe.get_traceback())
        return {"ok": False}


def list_field_visits(user, limit=50, *, all_team=False):
    ensure_reach_ffms_visit_fields()
    if all_team and is_sales_manager(user):
        filters = {}
    else:
        rep_ids = scoped_rep_ids(user)
        filters = {"sales_rep": ("in", rep_ids)}
    fields = [
        "name",
        "sales_rep",
        "lead",
        "franchisee",
        "visit_date",
        "visit_time",
        "purpose",
        "outcome",
        "duration_minutes",
        "latitude",
        "longitude",
        "notes",
        "creation",
    ]
    meta = frappe.get_meta("Field Sales Visit")
    for optional in ("visit_status", "photo", "assigned_from"):
        if meta.has_field(optional):
            fields.append(optional)
    rows = frappe.get_all(
        "Field Sales Visit",
        filters=filters,
        fields=fields,
        order_by="creation desc",
        limit=cint(limit),
    )
    for row in rows:
        if row.get("sales_rep"):
            row["reach_user"] = frappe.db.get_value("Sales Rep Profile", row["sales_rep"], "full_name")
        if row.get("lead"):
            lead = frappe.db.get_value(
                "Franchise Sales Lead",
                row["lead"],
                ["lead_name", "phone", "status", "rfms_lead_id"],
                as_dict=True,
            )
            if lead:
                row["lead_name"] = lead.lead_name
                row["lead_phone"] = lead.phone
                row["lead_status"] = lead.status
                row["rfms_lead_id"] = lead.rfms_lead_id
        if not row.get("visit_status"):
            row["visit_status"] = "Completed"
    return rows


def list_sales_reps_for_manager(user=None):
    """List active REACH users. When user is set, enforce manager role."""
    if user and not is_sales_manager(user) and "System Manager" not in frappe.get_roles(user):
        frappe.throw(_("Only sales managers can list REACH users"))
    meta = frappe.get_meta("Sales Rep Profile")
    fields = ["name", "full_name"]
    for optional in ("rep_code", "designation", "territory_region", "user", "phone", "active", "employee"):
        if meta.has_field(optional):
            fields.append(optional)
    rows = frappe.get_all(
        "Sales Rep Profile",
        fields=fields,
        order_by="full_name asc",
        limit=200,
    )
    if meta.has_field("active"):
        rows = [r for r in rows if cint(r.get("active", 1)) == 1]
    # Normalize payload for FFMS (linked_user alias kept for older clients).
    for row in rows:
        row["linked_user"] = cstr(row.get("user") or "")
        row["reach_user_id"] = cstr(row.get("name") or "")
        row["display_name"] = cstr(row.get("full_name") or row.get("name") or "")
        emp = cstr(row.get("employee") or "")
        row["employee_id"] = emp
        if emp and frappe.db.exists("DocType", "Employee") and frappe.db.exists("Employee", emp):
            emp_no = frappe.db.get_value("Employee", emp, "employee_number")
            if emp_no:
                row["employee_number"] = cstr(emp_no)
    return rows


def create_assigned_log_visit(lead_id, sales_rep_id, *, assigned_from="FFMS", notes=None, purpose="Meet Lead"):
    """Upsert a pending Log Visit so it appears immediately in REACH + FFMS (no duplicates)."""
    ensure_reach_ffms_visit_fields()
    # Cancel open Assigned visits for this lead assigned to a different rep (re-assignment).
    other_open = frappe.get_all(
        "Field Sales Visit",
        filters={"lead": lead_id, "visit_status": "Assigned", "sales_rep": ("!=", sales_rep_id)},
        pluck="name",
    )
    for old_id in other_open:
        frappe.db.set_value(
            "Field Sales Visit",
            old_id,
            {
                "visit_status": "Cancelled",
                "notes": (
                    cstr(frappe.db.get_value("Field Sales Visit", old_id, "notes") or "")
                    + f"\nReassigned away from this rep via {assigned_from}."
                ).strip()[:2000],
            },
        )
        try:
            old_doc = frappe.get_doc("Field Sales Visit", old_id)
            _sync_field_visit_to_rfms(old_doc, old_doc.sales_rep)
        except Exception:
            frappe.log_error(title="reach_reassign_cancel_sync", message=frappe.get_traceback())

    # Reuse existing open Assigned visit for same lead + rep.
    existing = frappe.db.get_value(
        "Field Sales Visit",
        {"lead": lead_id, "sales_rep": sales_rep_id, "visit_status": "Assigned"},
        "name",
    )
    if existing:
        updates = {
            "visit_date": today(),
            "visit_time": datetime.now().strftime("%H:%M:%S"),
            "purpose": purpose or "Meet Lead",
            "assigned_from": assigned_from,
            "notes": notes or f"Assigned from {assigned_from} for field Log Visit.",
        }
        frappe.db.set_value("Field Sales Visit", existing, updates)
        frappe.db.commit()
        doc = frappe.get_doc("Field Sales Visit", existing)
        _sync_field_visit_to_rfms(doc, sales_rep_id)
        return doc.name

    doc = frappe.get_doc(
        {
            "doctype": "Field Sales Visit",
            "sales_rep": sales_rep_id,
            "lead": lead_id,
            "visit_date": today(),
            "visit_time": datetime.now().strftime("%H:%M:%S"),
            "purpose": purpose or "Meet Lead",
            "notes": notes or f"Assigned from {assigned_from} for field Log Visit.",
            "visit_status": "Assigned",
            "assigned_from": assigned_from,
            "latitude": 0,
            "longitude": 0,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    _sync_field_visit_to_rfms(doc, sales_rep_id)
    return doc.name


def on_franchise_sales_lead_update(doc, method=None):
    """When assigned_rep is set in Desk/form, create pending Log Visit + sync to FFMS/Reach."""
    if frappe.flags.get("in_import") or frappe.flags.get("skip_reach_log_visit_hook"):
        return
    rep = cstr(doc.get("assigned_rep") or "").strip()
    if not rep:
        return
    if method == "after_insert":
        changed = True
    else:
        changed = bool(getattr(doc, "has_value_changed", lambda *_: False)("assigned_rep"))
    if not changed:
        return
    status = cstr(doc.get("status") or "").strip()
    if status in ("Lost", "Won", "Cancelled"):
        return
    try:
        frappe.flags.skip_reach_log_visit_hook = True
        resolved = resolve_sales_rep_profile_id(rep)
        if not resolved:
            frappe.log_error(
                title="reach_assigned_rep_unresolved",
                message=f"Lead {doc.name}: assigned_rep={rep!r} could not be resolved to Sales Rep Profile",
            )
            return
        if resolved != rep:
            doc.db_set("assigned_rep", resolved, update_modified=False)
        actor = cstr(frappe.session.user or "").strip() or "Desk"
        if actor == "Guest":
            actor = "Desk / ERP"
        create_assigned_log_visit(
            doc.name,
            resolved,
            assigned_from=f"ERP assigned_rep ({actor})",
        )
        try:
            _sync_sales_lead_to_rfms(doc, resolved)
        except Exception:
            frappe.log_error(title="reach_lead_rfms_sync_hook", message=frappe.get_traceback())
    except Exception:
        frappe.log_error(title="reach_assigned_rep_visit_hook", message=frappe.get_traceback())
    finally:
        frappe.flags.skip_reach_log_visit_hook = False


def assign_sales_lead_rep(user, lead_id, sales_rep_id, *, create_visit=True, assigned_from=None):
    if user and not is_sales_manager(user) and "System Manager" not in frappe.get_roles(user):
        frappe.throw(_("Only sales managers can assign REACH users"))
    if not frappe.db.exists("Franchise Sales Lead", lead_id):
        frappe.throw(_("Lead not found"))
    resolved = resolve_sales_rep_profile_id(sales_rep_id)
    if not resolved:
        frappe.throw(_("REACH user / sales rep not found (id or employee)"))
    sales_rep_id = resolved
    visit_id = None
    frappe.flags.skip_reach_log_visit_hook = True
    try:
        frappe.db.set_value("Franchise Sales Lead", lead_id, "assigned_rep", sales_rep_id)
        frappe.db.commit()
        lead_doc = frappe.get_doc("Franchise Sales Lead", lead_id)
        _sync_sales_lead_to_rfms(lead_doc, sales_rep_id)
        if create_visit:
            visit_id = create_assigned_log_visit(
                lead_id,
                sales_rep_id,
                assigned_from=assigned_from or (user or "FFMS"),
            )
            if not visit_id:
                frappe.throw(_("Failed to create Assigned Log Visit for REACH"))
    finally:
        frappe.flags.skip_reach_log_visit_hook = False
    return {"lead_id": lead_id, "assigned_rep": sales_rep_id, "visit_id": visit_id, "already_had_visit": False}


def resolve_franchise_sales_lead_id(*, hec_lead_id=None, rfms_lead_id=None):
    hec = cstr(hec_lead_id or "").strip()
    if hec and frappe.db.exists("Franchise Sales Lead", hec):
        return hec
    rfms = cstr(rfms_lead_id or "").strip()
    if rfms:
        found = frappe.db.get_value("Franchise Sales Lead", {"rfms_lead_id": rfms}, "name")
        if found:
            return found
    return None


def _ffms_source_to_reach_lead_source(source):
    mapping = {
        "manual": "Manual",
        "website": "Website",
        "meta_ads": "Meta Ads",
        "google_ads": "Google Ads",
        "whatsapp_ads": "WhatsApp Ads",
        "csv_upload": "Manual",
        "csv_import": "Manual",
        "appointment": "Manual",
        "reach_sales": "REACH",
        "reach": "REACH",
        "telecaller": "Manual",
        "portal": "Website",
        "smilecure_crm": "Manual",
        "crm": "Manual",
        "field_marketing": "Manual",
        "partner": "Manual",
        "referral": "Manual",
        "walk-in": "Manual",
        "walk_in": "Manual",
    }
    key = cstr(source or "").strip().lower().replace(" ", "_")
    return mapping.get(key, "Manual")


def _crm_status_to_reach(status):
    mapping = {
        "New": "New",
        "Contacted": "Contacted",
        "Connected": "Contacted",
        "Not Reachable": "Contacted",
        "Interested": "Qualified",
        "Not Interested": "Lost",
        "Qualified": "Qualified",
        "Proposal Required": "Negotiation",
        "Discussion Ongoing": "Negotiation",
        "Ready to Proceed": "Negotiation",
        "Won": "Won",
        "Lost": "Lost",
    }
    return mapping.get(cstr(status or "").strip(), "New")


def _reach_status_to_crm(status):
    mapping = {
        "New": "New",
        "Contacted": "Contacted",
        "Meeting Done": "Connected",
        "Qualified": "Qualified",
        "Negotiation": "Discussion Ongoing",
        "Won": "Won",
        "Lost": "Lost",
        "Cancelled": "Lost",
        "Disqualified": "Lost",
        "Closed": "Lost",
    }
    return mapping.get(cstr(status or "").strip(), None)


def crm_external_lead_key(crm_lead_id):
    return f"crm-{cstr(crm_lead_id or '').strip()}"


def crm_list_reach_reps():
    """Active REACH / Sales Rep Profiles for Smilecure CRM assignment."""
    return list_sales_reps_for_manager(user=None)


def crm_get_reach_lead(*, crm_lead_id=None, hec_lead_id=None):
    """Pull REACH Franchise Sales Lead linked to a Smilecure CRM lead."""
    rfms = crm_external_lead_key(crm_lead_id) if crm_lead_id else None
    lead_id = resolve_franchise_sales_lead_id(hec_lead_id=hec_lead_id, rfms_lead_id=rfms)
    if not lead_id:
        return None
    doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    rep_id = cstr(doc.get("assigned_rep") or "")
    rep_name = ""
    if rep_id and frappe.db.exists("Sales Rep Profile", rep_id):
        rep_name = cstr(frappe.db.get_value("Sales Rep Profile", rep_id, "full_name") or rep_id)
    return {
        "lead_id": lead_id,
        "crm_lead_id": cstr(crm_lead_id or "").strip(),
        "rfms_lead_id": cstr(doc.get("rfms_lead_id") or ""),
        "status": cstr(doc.get("status") or ""),
        "crm_status": _reach_status_to_crm(doc.get("status")),
        "assigned_rep": rep_id,
        "assigned_rep_name": rep_name,
        "notes": cstr(doc.get("notes") or ""),
        "phone": cstr(doc.get("phone") or ""),
        "email": cstr(doc.get("email") or ""),
        "modified": cstr(doc.get("modified") or ""),
    }


def crm_assign_lead_to_reach(
    *,
    crm_lead_id,
    sales_rep_id,
    lead=None,
    followups=None,
    create_visit=True,
    assigned_from=None,
    assigned_to_name=None,
):
    """Create/upsert REACH lead from Smilecure CRM and assign to REACH user + Log Visit."""
    crm_id = cstr(crm_lead_id or "").strip()
    if not crm_id:
        frappe.throw(_("crm_lead_id is required"))
    if not sales_rep_id:
        frappe.throw(_("sales_rep_id is required"))

    lead_payload = lead if isinstance(lead, dict) else {}
    if isinstance(lead, str) and lead.strip():
        try:
            parsed = json.loads(lead)
            if isinstance(parsed, dict):
                lead_payload = parsed
        except Exception:
            lead_payload = {}

    fu_rows = followups if isinstance(followups, list) else []
    if isinstance(followups, str) and followups.strip():
        try:
            parsed_fu = json.loads(followups)
            if isinstance(parsed_fu, list):
                fu_rows = parsed_fu
        except Exception:
            fu_rows = []

    fu_lines = []
    for row in fu_rows[:12]:
        if not isinstance(row, dict):
            continue
        when = cstr(row.get("dueAt") or row.get("due_at") or row.get("when") or "")[:40]
        title = cstr(row.get("title") or row.get("type") or "Follow-up")[:80]
        outcome = cstr(row.get("outcome") or row.get("notes") or "")[:120]
        owner = cstr(row.get("owner") or "")[:40]
        done = "done" if row.get("done") else "open"
        bit = f"- [{done}] {when} · {title}"
        if owner:
            bit += f" · {owner}"
        if outcome:
            bit += f" · {outcome}"
        fu_lines.append(bit)

    existing_notes = cstr(lead_payload.get("notes") or "").strip()
    blocks = []
    if existing_notes:
        blocks.append(existing_notes)
    blocks.append(f"Synced from Smilecure CRM lead {crm_id}")
    if fu_lines:
        blocks.append("Follow-ups:\n" + "\n".join(fu_lines))
    lead_payload["notes"] = "\n\n".join(blocks)[:2000]
    lead_payload.setdefault("lead_name", lead_payload.get("name") or crm_id)
    lead_payload.setdefault("source", lead_payload.get("lead_source") or "smilecure_crm")
    if lead_payload.get("status") and not lead_payload.get("stage"):
        lead_payload["status"] = _crm_status_to_reach(lead_payload.get("status"))

    result = ffms_assign_reach_lead(
        hec_lead_id=None,
        rfms_lead_id=crm_external_lead_key(crm_id),
        sales_rep_id=sales_rep_id,
        assigned_to_name=assigned_to_name,
        assignee_role="reach",
        create_visit=bool(create_visit),
        assigned_from=assigned_from or "Smilecure CRM",
        lead=lead_payload,
    )
    snap = crm_get_reach_lead(crm_lead_id=crm_id, hec_lead_id=result.get("lead_id"))
    out = dict(result or {})
    out["crm_lead_id"] = crm_id
    out["rfms_lead_id"] = crm_external_lead_key(crm_id)
    if snap:
        out["reach"] = snap
        out["assigned_rep_name"] = snap.get("assigned_rep_name")
    return out


def crm_sync_lead_status_to_reach(*, crm_lead_id, status=None, stage=None):
    """Push Smilecure CRM status onto the linked REACH Franchise Sales Lead."""
    crm_id = cstr(crm_lead_id or "").strip()
    if not crm_id:
        frappe.throw(_("crm_lead_id is required"))
    reach_status = _crm_status_to_reach(status) if status else None
    return ffms_update_lead_status(
        rfms_lead_id=crm_external_lead_key(crm_id),
        stage=stage,
        status=reach_status,
    )


def ensure_franchise_sales_lead_from_ffms(*, hec_lead_id=None, rfms_lead_id=None, lead=None, assigned_rep=None):
    """Find or create REACH Franchise Sales Lead for an FFMS CRM lead (no duplicates)."""
    lead_id = resolve_franchise_sales_lead_id(hec_lead_id=hec_lead_id, rfms_lead_id=rfms_lead_id)
    if lead_id:
        return lead_id

    data = lead if isinstance(lead, dict) else {}
    phone_digits = re.sub(r"\D", "", cstr(data.get("phone") or data.get("mobile") or ""))[-10:]
    email = cstr(data.get("email") or "").strip().lower()
    rfms = cstr(rfms_lead_id or data.get("rfms_lead_id") or data.get("id") or "").strip()

    # Prefer exact rfms_lead_id match before phone/email heuristics.
    if rfms:
        by_rfms = frappe.db.get_value("Franchise Sales Lead", {"rfms_lead_id": rfms}, "name")
        if by_rfms:
            return by_rfms

    if phone_digits:
        for row in frappe.get_all(
            "Franchise Sales Lead",
            fields=["name", "phone", "email", "rfms_lead_id"],
            limit=500,
            order_by="modified desc",
        ):
            row_rfms = cstr(row.get("rfms_lead_id") or "").strip()
            row_phone = re.sub(r"\D", "", cstr(row.get("phone") or ""))[-10:]
            row_email = cstr(row.get("email") or "").strip().lower()
            if rfms and row_rfms == rfms:
                return row.name
            # Phone/email merge only when the existing row is unlinked or already this RFMS lead.
            if phone_digits and row_phone == phone_digits and (not row_rfms or row_rfms == rfms):
                if rfms and not row_rfms:
                    frappe.db.set_value("Franchise Sales Lead", row.name, "rfms_lead_id", rfms)
                    frappe.db.commit()
                return row.name
            if (
                email
                and row_email == email
                and not email.endswith("@ads.franchise.local")
                and not email.endswith("@ffms.franchise.local")
                and (not row_rfms or row_rfms == rfms)
            ):
                if rfms and not row_rfms:
                    frappe.db.set_value("Franchise Sales Lead", row.name, "rfms_lead_id", rfms)
                    frappe.db.commit()
                return row.name

    lead_name = cstr(data.get("lead_name") or data.get("name") or "").strip()
    if not lead_name:
        frappe.throw(_("Lead name is required to sync FFMS lead into REACH"))
    if not phone_digits:
        frappe.throw(_("Lead mobile/phone is required to sync FFMS lead into REACH"))
    if not email:
        email = f"{phone_digits}@ffms.franchise.local"

    status = _rfms_stage_to_reach_status(data.get("stage")) or cstr(data.get("status") or "New").strip() or "New"
    territory = cstr(data.get("territory_query") or data.get("address") or data.get("city") or "").strip()
    doc_dict = {
        "doctype": "Franchise Sales Lead",
        "lead_name": lead_name[:140],
        "company_name": cstr(data.get("company_name") or "")[:140],
        "contact_person": cstr(data.get("contact_person") or "")[:140],
        "phone": phone_digits,
        "email": email[:140],
        "address": territory[:500],
        "city": cstr(data.get("city") or "")[:140],
        "district": cstr(data.get("district") or "")[:140],
        "pincode": cstr(data.get("pincode") or "")[:20],
        "state": cstr(data.get("state") or "West Bengal"),
        "status": status,
        "notes": cstr(data.get("notes") or "")[:2000],
    }
    meta = frappe.get_meta("Franchise Sales Lead")
    if meta.has_field("lead_source"):
        doc_dict["lead_source"] = _ffms_source_to_reach_lead_source(data.get("source") or data.get("lead_source"))
    if meta.has_field("rfms_lead_id") and rfms:
        doc_dict["rfms_lead_id"] = rfms
    if meta.has_field("campaign_name") and data.get("campaign_name"):
        doc_dict["campaign_name"] = cstr(data.get("campaign_name"))[:180]
    # assigned_rep is mandatory on this DocType — set when known; otherwise insert with ignore_mandatory.
    resolved_rep = resolve_sales_rep_profile_id(assigned_rep or data.get("assigned_rep") or data.get("sales_rep_id"))
    if meta.has_field("assigned_rep") and resolved_rep:
        doc_dict["assigned_rep"] = resolved_rep

    doc = frappe.get_doc(doc_dict)
    doc.insert(ignore_permissions=True, ignore_mandatory=not bool(resolved_rep))
    frappe.db.commit()
    return doc.name


def ffms_list_reach_reps():
    """Service listing of REACH users for FFMS Log Visit assignment."""
    return list_sales_reps_for_manager(user=None)


def ffms_assign_reach_lead(
    *,
    hec_lead_id=None,
    rfms_lead_id=None,
    sales_rep_id=None,
    assigned_to_name=None,
    assignee_role="reach",
    create_visit=True,
    assigned_from="FFMS Admin",
    lead=None,
):
    """FFMS → REACH assignment bridge (HMAC guest caller)."""
    lead_payload = lead if isinstance(lead, dict) else {}
    if isinstance(lead, str) and lead.strip():
        try:
            parsed = json.loads(lead)
            if isinstance(parsed, dict):
                lead_payload = parsed
        except Exception:
            lead_payload = {}

    role = cstr(assignee_role or "reach").strip().lower().replace(" ", "_")
    lead_id = ensure_franchise_sales_lead_from_ffms(
        hec_lead_id=hec_lead_id,
        rfms_lead_id=rfms_lead_id,
        lead=lead_payload,
        assigned_rep=sales_rep_id if role in ("reach", "sales_rep", "log_visit") else None,
    )
    if role in ("reach", "sales_rep", "log_visit"):
        if not sales_rep_id:
            frappe.throw(_("sales_rep_id is required for REACH Log Visit assignment"))
        resolved = resolve_sales_rep_profile_id(sales_rep_id)
        if not resolved:
            frappe.throw(_("REACH user not found for sales_rep_id / employee_id: {0}").format(sales_rep_id))
        return assign_sales_lead_rep(
            None,
            lead_id,
            resolved,
            create_visit=bool(create_visit),
            assigned_from=assigned_from,
        )
    note_bit = f"[{role}] {cstr(assigned_to_name or 'FFMS')}"
    existing = cstr(frappe.db.get_value("Franchise Sales Lead", lead_id, "notes") or "")
    stamped = f"{existing}\nAssigned via FFMS to {note_bit}".strip()
    frappe.db.set_value("Franchise Sales Lead", lead_id, "notes", stamped[:2000])
    frappe.db.commit()
    lead_doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    rfms = _sync_sales_lead_to_rfms(lead_doc, lead_doc.assigned_rep)
    return {
        "lead_id": lead_id,
        "assignee_role": role,
        "assigned_to_name": assigned_to_name,
        "rfms": rfms,
        "visit_id": None,
    }


def ffms_update_lead_status(*, hec_lead_id=None, rfms_lead_id=None, stage=None, status=None):
    """FFMS CRM stage → REACH Franchise Sales Lead.status."""
    lead_id = resolve_franchise_sales_lead_id(hec_lead_id=hec_lead_id, rfms_lead_id=rfms_lead_id)
    if not lead_id:
        frappe.throw(_("Lead not found on REACH / ERP"))
    next_status = cstr(status or "").strip() or _rfms_stage_to_reach_status(stage)
    if not next_status:
        frappe.throw(_("Unrecognized stage/status"))
    frappe.db.set_value("Franchise Sales Lead", lead_id, "status", next_status)
    frappe.db.commit()
    lead_doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    _sync_sales_lead_to_rfms(lead_doc, lead_doc.assigned_rep)
    return {"lead_id": lead_id, "status": next_status, "stage": _reach_status_to_rfms_stage(next_status)}


def ffms_archive_reach_lead(*, hec_lead_id=None, rfms_lead_id=None, reason=None):
    """FFMS hard-delete cascade — mark REACH Franchise Sales Lead Lost/Cancelled."""
    lead_id = resolve_franchise_sales_lead_id(hec_lead_id=hec_lead_id, rfms_lead_id=rfms_lead_id)
    if not lead_id:
        return {"ok": True, "skipped": True, "reason": "lead_not_found"}
    note = cstr(reason or "Archived from FFMS Admin").strip()[:500]
    status_candidates = ("Lost", "Cancelled", "Disqualified", "Closed")
    meta = frappe.get_meta("Franchise Sales Lead")
    next_status = "Lost"
    if meta.has_field("status"):
        options = (meta.get_field("status").options or "").split("\n")
        for candidate in status_candidates:
            if candidate in options:
                next_status = candidate
                break
    values = {"status": next_status}
    if meta.has_field("notes"):
        existing = cstr(frappe.db.get_value("Franchise Sales Lead", lead_id, "notes") or "")
        values["notes"] = f"{existing}\n{note}".strip()[:2000]
    frappe.db.set_value("Franchise Sales Lead", lead_id, values)
    frappe.db.commit()
    return {"ok": True, "lead_id": lead_id, "status": next_status}


def ffms_archive_field_visit(*, hec_visit_id=None, reason=None):
    """FFMS hard-delete cascade — cancel Field Sales Visit."""
    visit_id = cstr(hec_visit_id or "").strip()
    if not visit_id or not frappe.db.exists("Field Sales Visit", visit_id):
        return {"ok": True, "skipped": True, "reason": "visit_not_found"}
    note = cstr(reason or "Archived from FFMS Admin").strip()[:500]
    meta = frappe.get_meta("Field Sales Visit")
    values = {}
    if meta.has_field("visit_status"):
        values["visit_status"] = "Cancelled"
    if meta.has_field("notes"):
        existing = cstr(frappe.db.get_value("Field Sales Visit", visit_id, "notes") or "")
        values["notes"] = f"{existing}\n{note}".strip()[:2000]
    if values:
        frappe.db.set_value("Field Sales Visit", visit_id, values)
        frappe.db.commit()
    return {"ok": True, "visit_id": visit_id}


def ffms_disable_partner_portal(*, franchisee_profile=None, user_id=None, franchisee_id=None, reason=None):
    """Disable Partner Portal User and optionally mark Franchisee Profile Inactive."""
    profile_name = cstr(franchisee_profile or "").strip()
    if not profile_name and franchisee_id:
        profile_name = frappe.db.get_value(
            "Franchisee Profile",
            {"branch_code": cstr(franchisee_id).strip()},
            "name",
        ) or frappe.db.get_value(
            "Franchisee Profile",
            {"name": cstr(franchisee_id).strip()},
            "name",
        ) or ""
    disabled_users = []
    user_name = cstr(user_id or "").strip()
    if user_name and frappe.db.exists("User", user_name):
        frappe.db.set_value("User", user_name, "enabled", 0)
        disabled_users.append(user_name)
    if profile_name and frappe.db.exists("Franchisee Profile", profile_name):
        profile = frappe.get_doc("Franchisee Profile", profile_name)
        if hasattr(profile, "active_status"):
            profile.active_status = "Inactive"
        operator = cstr(getattr(profile, "user", None) or getattr(profile, "operator_user", None) or "")
        if operator and frappe.db.exists("User", operator) and operator not in disabled_users:
            frappe.db.set_value("User", operator, "enabled", 0)
            disabled_users.append(operator)
        email = cstr(getattr(profile, "email", None) or "")
        if email and frappe.db.exists("User", email) and email not in disabled_users:
            frappe.db.set_value("User", email, "enabled", 0)
            disabled_users.append(email)
        profile.add_comment("Comment", cstr(reason or "Partner portal disabled from FFMS")[:400])
        profile.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "franchisee_profile": profile_name, "disabled_users": disabled_users}


def ffms_deboard_franchisee(*, franchisee_profile=None, franchisee_id=None, reason=None):
    """Deboard franchisee: Inactive hub + disable linked users."""
    result = ffms_disable_partner_portal(
        franchisee_profile=franchisee_profile,
        franchisee_id=franchisee_id,
        reason=cstr(reason or "Deboarded from FFMS Admin"),
    )
    profile_name = result.get("franchisee_profile") or ""
    if profile_name and frappe.db.exists("Franchisee Profile", profile_name):
        frappe.db.set_value("Franchisee Profile", profile_name, "active_status", "Inactive")
        frappe.db.commit()
    return {**result, "deboarded": True}

def backfill_sales_leads_to_rfms(limit=50):
    """Push Franchise Sales Leads missing rfms_lead_id into FFMS CRM."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
        get_rfms_api_base_url,
    )

    base = get_rfms_api_base_url()
    rows = frappe.get_all(
        "Franchise Sales Lead",
        fields=["name", "lead_name", "rfms_lead_id", "assigned_rep"],
        order_by="creation asc",
        limit=cint(limit) or 50,
    )
    ok = fail = skipped = 0
    details = []
    for row in rows:
        if row.get("rfms_lead_id"):
            skipped += 1
            continue
        doc = frappe.get_doc("Franchise Sales Lead", row.name)
        try:
            res = _sync_sales_lead_to_rfms(doc, doc.assigned_rep)
        except Exception as exc:
            res = {"ok": False, "error": str(exc), "trace": frappe.get_traceback()}
        doc.reload()
        entry = {
            "name": row.name,
            "lead_name": row.lead_name,
            "rfms_lead_id": doc.get("rfms_lead_id"),
            "result": res,
        }
        details.append(entry)
        if doc.get("rfms_lead_id"):
            ok += 1
        else:
            fail += 1
    return {
        "rfms_base": base,
        "ok": ok,
        "fail": fail,
        "skipped": skipped,
        "details": details,
    }


def debug_sync_one_sales_lead(lead_id=None):
    """Return uncaught sync result/trace for a single Franchise Sales Lead."""
    lead_id = cstr(lead_id or "").strip()
    if not lead_id:
        latest = frappe.get_all("Franchise Sales Lead", fields=["name"], order_by="creation desc", limit=1)
        lead_id = latest[0].name if latest else ""
    if not lead_id:
        return {"ok": False, "error": "no leads"}
    doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            get_rfms_api_base_url,
            _franchise_ads_secret,
            _push_lead_to_rfms,
        )

        phone_digits = re.sub(r"\D", "", cstr(doc.phone or ""))
        email = cstr(doc.email or "").strip().lower()
        if not email and phone_digits:
            email = f"{phone_digits}@reach.franchise.local"
        if not phone_digits:
            phone_digits = re.sub(r"\D", "", lead_id)[-10:] or "9000000000"
            if len(phone_digits) < 10:
                phone_digits = (phone_digits + "0000000000")[:10]
        payload = {
            "name": cstr(doc.lead_name or doc.company_name or "REACH lead"),
            "email": email or f"{lead_id.lower()}@reach.franchise.local",
            "mobile": phone_digits,
            "territory_query": cstr(doc.district or doc.city or doc.address or "West Bengal"),
            "source": "reach_sales",
            "platform": "reach",
            "campaign_name": "REACH Portal",
            "external_lead_id": doc.name,
            "hec_lead_id": doc.name,
            "notes": cstr(doc.notes or "")[:1000],
            "assigned_to": "Unassigned",
            "stage": _reach_status_to_rfms_stage(doc.status),
            "priority": "normal",
        }
        push = _push_lead_to_rfms(payload)
        sync = _sync_sales_lead_to_rfms(doc, doc.assigned_rep)
        doc.reload()
        return {
            "ok": True,
            "lead_id": lead_id,
            "phone": phone_digits,
            "email": payload["email"],
            "rfms_base": get_rfms_api_base_url(),
            "secret_set": bool(_franchise_ads_secret() or frappe.conf.get("onboard_hmac_secret")),
            "direct_push": push,
            "sync": sync,
            "rfms_lead_id": doc.get("rfms_lead_id"),
        }
    except Exception as exc:
        return {"ok": False, "lead_id": lead_id, "error": str(exc), "trace": frappe.get_traceback()}


def submit_franchise_onboarding(user, data):
    rep_id = get_or_create_sales_rep(user)
    branch = (data.get("proposed_branch_code") or "").strip().upper()
    if not branch:
        frappe.throw(_("Branch code is required"))
    if frappe.db.exists("Franchisee Profile", branch):
        frappe.throw(_("Branch code {0} already exists").format(branch))

    doc = frappe.get_doc(
        {
            "doctype": "Franchise Onboarding Request",
            "sales_rep": rep_id,
            "lead": data.get("lead_id"),
            "franchise_name": data.get("franchise_name"),
            "owner_name": data.get("owner_name"),
            "proposed_branch_code": branch,
            "territory_region": data.get("territory_region"),
            "address": data.get("address"),
            "phone": data.get("phone"),
            "email": data.get("email"),
            "commission_percentage_rate": flt(data.get("commission_percentage_rate") or 12.5),
            "status": "Submitted",
            "notes": data.get("notes"),
        }
    )
    doc.insert(ignore_permissions=True)

    franchisee = frappe.get_doc(
        {
            "doctype": "Franchisee Profile",
            "franchise_name": data.get("franchise_name"),
            "branch_code": branch,
            "owner_name": data.get("owner_name"),
            "territory_region": data.get("territory_region"),
            "address": data.get("address"),
            "commission_percentage_rate": flt(data.get("commission_percentage_rate") or 12.5),
            "franchisee_type": (data.get("franchisee_type") or "Pulse").strip() or "Pulse",
            "commission_base": (data.get("commission_base") or "Franchisee Rate").strip() or "Franchisee Rate",
            "contact_phone": data.get("phone"),
            "contact_email": data.get("email"),
            "active_status": "Active",
        }
    )
    if frappe.get_meta("Franchisee Profile").has_field("acquired_by_sales_rep"):
        franchisee.acquired_by_sales_rep = rep_id
    franchisee.insert(ignore_permissions=True)

    doc.db_set("franchisee_id", franchisee.name)
    doc.db_set("status", "Approved")

    if data.get("lead_id"):
        frappe.db.set_value("Franchise Sales Lead", data["lead_id"], {"status": "Won", "franchisee": franchisee.name})

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import ensure_franchisee_b2b_setup

        ensure_franchisee_b2b_setup(franchisee.name)
    except Exception:
        frappe.log_error(title="phase25_b2b_setup", message=frappe.get_traceback())

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import accrue_onboarding_commission

        accrue_onboarding_commission(franchisee.name, doc.name)
    except Exception:
        frappe.log_error(title="phase27b_onboarding_commission", message=frappe.get_traceback())

    frappe.db.commit()
    return {"onboarding_id": doc.name, "franchisee_id": franchisee.name}


def get_sales_catalog_payload():
    offerings = []
    brochure_url = "https://lab.remediumhealth.co.in/wp-content/uploads/2026/02/Foco-Brochure-2026_compressed.pdf"
    franchise_portal_url = "https://lab.remediumhealth.co.in/franchise/"
    company = {}
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import (
            get_brochure_url,
            get_catalog_offerings,
            get_franchise_portal_url,
            get_remedium_catalog_meta,
        )

        offerings = get_catalog_offerings()
        brochure_url = get_brochure_url()
        franchise_portal_url = get_franchise_portal_url()
        company = get_remedium_catalog_meta()
    except Exception:
        pass

    panels = []
    if frappe.db.exists("DocType", "Lab Test Panel"):
        panels = frappe.get_all(
            "Lab Test Panel",
            filters={"show_on_mobile": 1, "is_active": 1},
            fields=["name", "panel_name", "description", "panel_rate"],
            order_by="modified desc",
            limit=12,
        )
        for row in panels:
            row["rate"] = row.get("panel_rate")

    packages = [
        {
            "title": deck["title"],
            "points": deck.get("points") or [],
            "category": deck.get("category"),
            "investment_from": deck.get("investment_from"),
            "investment_to": deck.get("investment_to"),
            "mrp_reference": deck.get("mrp_reference"),
            "wholesale_reference": deck.get("wholesale_reference"),
        }
        for deck in offerings
        if deck.get("category") in ("Remedium Franchise", "FOCO Franchise", "Revenue Model")
    ]
    if not packages:
        packages = [
            {
                "title": "Franchise Health Hub",
                "points": [
                    "Dual-price lab catalog (MRP vs wholesale)",
                    "B2B wallet + walk-in patient billing",
                    "Phlebo GPS + home collection",
                    "NABL-grade reports via ERPNext",
                ],
            },
            {
                "title": "Revenue model",
                "points": [
                    "Bill patients at MRP at your centre",
                    "Platform fee debited from prepaid wallet",
                    "Your margin = MRP − wholesale",
                    "Subscription & pharmacy upsell (roadmap)",
                ],
            },
        ]

    health_packages = [deck for deck in offerings if deck.get("category") == "Health Package"]
    addons = [deck for deck in offerings if deck.get("category") == "Add-on Service"]
    diagnostic_services = [deck for deck in offerings if deck.get("category") == "Diagnostic Service"]

    tests = frappe.get_all(
        "Item",
        filters={"disabled": 0, "item_group": ("in", ["Lab Tests", "Services", "Laboratory", "Diagnostics"])},
        fields=["name", "item_name", "standard_rate"],
        order_by="item_name asc",
        limit=24,
    )
    return {
        "panels": panels,
        "pitch_decks": packages,
        "health_packages": health_packages,
        "addons": addons,
        "diagnostic_services": diagnostic_services,
        "offerings": offerings,
        "brochure_url": brochure_url,
        "franchise_portal_url": franchise_portal_url,
        "company": company,
        "popular_tests": tests,
    }


def ensure_closing_report_expense_fields():
    """Hot-add expense fields when migrate has not run yet."""
    try:
        from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
    except Exception:
        return
    meta = frappe.get_meta("Sales Closing Report")
    fields = []
    if not meta.has_field("period_end"):
        fields.append(
            {
                "fieldname": "period_end",
                "label": "Period End",
                "fieldtype": "Date",
                "insert_after": "period_date",
            }
        )
    if not meta.has_field("other_expenses"):
        fields.append(
            {
                "fieldname": "other_expenses",
                "label": "Other Expenses",
                "fieldtype": "Currency",
                "insert_after": "km_traveled",
                "default": "0",
            }
        )
    if not meta.has_field("total_expenses"):
        fields.append(
            {
                "fieldname": "total_expenses",
                "label": "Total Expenses",
                "fieldtype": "Currency",
                "insert_after": "other_expenses",
                "default": "0",
            }
        )
    if not meta.has_field("expense_json"):
        fields.append(
            {
                "fieldname": "expense_json",
                "label": "Expense Lines JSON",
                "fieldtype": "Long Text",
                "insert_after": "total_expenses",
            }
        )
    if fields:
        create_custom_fields({"Sales Closing Report": fields}, update=True)


def _closing_report_list_fields():
    meta = frappe.get_meta("Sales Closing Report")
    fields = [
        "name",
        "sales_rep",
        "report_type",
        "period_date",
        "visits_count",
        "new_leads",
        "qualified_leads",
        "onboardings",
        "franchise_revenue",
        "km_traveled",
        "notes",
        "creation",
    ]
    for extra in ("period_end", "other_expenses", "total_expenses", "expense_json"):
        if meta.has_field(extra):
            fields.append(extra)
    return fields


def list_closing_reports(user, limit=30):
    rep_ids = scoped_rep_ids(user)
    rows = frappe.get_all(
        "Sales Closing Report",
        filters={"sales_rep": ("in", rep_ids)},
        fields=_closing_report_list_fields(),
        order_by="creation desc",
        limit=cint(limit),
    )
    for row in rows:
        raw = row.get("expense_json")
        if isinstance(raw, str) and raw.strip():
            try:
                row["expenses"] = json.loads(raw)
            except Exception:
                row["expenses"] = []
        else:
            row["expenses"] = []
    return rows


def build_closing_report_draft(user, report_type="Daily", period_date=None):
    rep_id = get_or_create_sales_rep(user)
    period_date = getdate(period_date or today())
    start, end = _period_bounds(report_type, period_date)

    visits = frappe.db.count(
        "Field Sales Visit",
        {"sales_rep": rep_id, "visit_date": ("between", [start, end])},
    )
    new_leads = frappe.db.count(
        "Franchise Sales Lead",
        {
            "assigned_rep": rep_id,
            "creation": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"]),
        },
    )
    qualified = frappe.db.count(
        "Franchise Sales Lead",
        {
            "assigned_rep": rep_id,
            "status": ("in", ["Qualified", "Negotiation", "Won"]),
            "modified": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"]),
        },
    )
    onboardings = frappe.db.count(
        "Franchise Onboarding Request",
        {
            "sales_rep": rep_id,
            "creation": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"]),
        },
    )
    franchisee_ids = _franchisee_ids_for_reps([rep_id])
    revenue = _franchisee_stats(franchisee_ids, start, end)["total_revenue"]

    b2b = {"samples": 0, "business_value": 0, "entries": 0, "new_centres": 0}
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (
            b2b_closing_summary_for_draft,
        )

        b2b = b2b_closing_summary_for_draft(user, period_date=period_date)
    except Exception:
        frappe.log_error(title="b2b_closing_draft", message=frappe.get_traceback())

    already = frappe.db.exists(
        "Sales Closing Report",
        {
            "sales_rep": rep_id,
            "report_type": report_type,
            "period_date": start if report_type == "Monthly" else period_date,
        },
    )

    return {
        "report_type": report_type,
        "period_date": str(start if report_type == "Monthly" else period_date),
        "period_end": str(end),
        "visits_count": visits,
        "new_leads": new_leads,
        "qualified_leads": qualified,
        "onboardings": onboardings,
        "franchise_revenue": revenue,
        "already_submitted": 1 if already else 0,
        "existing_report_id": already or "",
        "b2b_samples": b2b.get("samples") or 0,
        "b2b_business_value": b2b.get("business_value") or 0,
        "b2b_entries": b2b.get("entries") or 0,
        "b2b_new_centres": b2b.get("new_centres") or 0,
    }


def _parse_expense_lines(data):
    raw = data.get("expenses_json") or data.get("expense_json") or data.get("expenses")
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            raw = json.loads(raw)
        except Exception:
            frappe.throw(_("Invalid expense lines JSON"))
    if not isinstance(raw, list):
        return []
    lines = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        amount = flt(item.get("amount"))
        expense_type = (item.get("expense_type") or item.get("type") or "Other").strip() or "Other"
        remarks = (item.get("remarks") or item.get("description") or "").strip()
        filename = (item.get("filename") or item.get("receipt_name") or "").strip()
        lines.append(
            {
                "expense_type": expense_type[:80],
                "amount": amount,
                "remarks": remarks[:500],
                "filename": filename[:140],
            }
        )
    return lines


def _parse_closing_attachments(data):
    raw = data.get("attachments_json") or data.get("attachments")
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            raw = json.loads(raw)
        except Exception:
            frappe.throw(_("Invalid attachments JSON"))
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        filename = (item.get("filename") or "receipt.pdf").strip() or "receipt.pdf"
        content = item.get("file_content") or item.get("content") or ""
        if not content:
            continue
        if isinstance(content, str) and "," in content and content.strip().startswith("data:"):
            content = content.split(",", 1)[1]
        out.append({"filename": filename[:140], "file_content": content})
    return out


def _attach_closing_files(report_name, attachments):
    if not attachments:
        return
    import base64

    from frappe.utils.file_manager import save_file

    for item in attachments[:20]:
        try:
            content = base64.b64decode(item["file_content"])
        except Exception:
            frappe.throw(_("Invalid receipt file encoding for {0}").format(item.get("filename")))
        if len(content) > 5 * 1024 * 1024:
            frappe.throw(_("Receipt {0} exceeds 5MB limit").format(item.get("filename")))
        save_file(
            item["filename"],
            content,
            "Sales Closing Report",
            report_name,
            decode=False,
            is_private=1,
        )


def submit_closing_report(user, data):
    ensure_closing_report_expense_fields()
    rep_id = get_or_create_sales_rep(user)
    draft = build_closing_report_draft(user, data.get("report_type") or "Daily", data.get("period_date"))
    if draft.get("already_submitted"):
        frappe.throw(
            _("A {0} closing report for {1} is already submitted and cannot be edited.").format(
                draft["report_type"], draft["period_date"]
            )
        )

    expense_lines = _parse_expense_lines(data)
    other_expenses = flt(data.get("other_expenses"))
    if not other_expenses and expense_lines:
        other_expenses = sum(flt(x.get("amount")) for x in expense_lines)
    km = flt(data.get("km_traveled"))
    total_expenses = flt(data.get("total_expenses"))
    if not total_expenses:
        total_expenses = other_expenses

    payload = {
        "doctype": "Sales Closing Report",
        "sales_rep": rep_id,
        "report_type": draft["report_type"],
        "period_date": draft["period_date"],
        "visits_count": cint(data.get("visits_count", draft["visits_count"])),
        "new_leads": cint(data.get("new_leads", draft["new_leads"])),
        "qualified_leads": cint(data.get("qualified_leads", draft["qualified_leads"])),
        "onboardings": cint(data.get("onboardings", draft["onboardings"])),
        "franchise_revenue": flt(data.get("franchise_revenue", draft["franchise_revenue"])),
        "km_traveled": km,
        "notes": (data.get("notes") or "")[:2000],
    }
    meta = frappe.get_meta("Sales Closing Report")
    if meta.has_field("period_end"):
        payload["period_end"] = draft.get("period_end")
    if meta.has_field("other_expenses"):
        payload["other_expenses"] = other_expenses
    if meta.has_field("total_expenses"):
        payload["total_expenses"] = total_expenses
    if meta.has_field("expense_json"):
        payload["expense_json"] = json.dumps(expense_lines, ensure_ascii=False)

    doc = frappe.get_doc(payload)
    doc.insert(ignore_permissions=True)
    _attach_closing_files(doc.name, _parse_closing_attachments(data))
    frappe.db.commit()
    return doc.name


def ensure_team_performance_doctype():
    """Install Sales Team Performance Report via JSON import, or create it in place for hot deploys."""
    ensure_hec_module_def()
    if frappe.db.exists("DocType", "Sales Team Performance Report"):
        return
    try:
        _import_doctype("sales_team_performance_report", "Sales Team Performance Report")
    except Exception:
        frappe.log_error(title="import_team_performance_doctype", message=frappe.get_traceback())
    if frappe.db.exists("DocType", "Sales Team Performance Report"):
        return
    doc = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": "Sales Team Performance Report",
            "module": HEC_MODULE,
            "custom": 0,
            "autoname": "naming_series:",
            "naming_rule": 'By "Naming Series" field',
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": [
                {
                    "fieldname": "naming_series",
                    "label": "Series",
                    "fieldtype": "Select",
                    "options": "STPR-.#####",
                    "default": "STPR-.#####",
                    "reqd": 1,
                },
                {
                    "fieldname": "sales_rep",
                    "label": "Sales Rep",
                    "fieldtype": "Link",
                    "options": "Sales Rep Profile",
                    "reqd": 1,
                    "in_list_view": 1,
                },
                {
                    "fieldname": "activity_date",
                    "label": "Activity Date",
                    "fieldtype": "Date",
                    "reqd": 1,
                    "in_list_view": 1,
                },
                {"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
                {"fieldname": "doctors_met", "label": "Doctors Met", "fieldtype": "Int", "default": "0"},
                {"fieldname": "visits_done", "label": "Visits Done", "fieldtype": "Int", "default": "0"},
                {
                    "fieldname": "samples_collected",
                    "label": "Samples / Orders",
                    "fieldtype": "Int",
                    "default": "0",
                },
                {"fieldname": "km_traveled", "label": "KM Traveled", "fieldtype": "Float", "default": "0"},
                {"fieldname": "location_note", "label": "Area / Location", "fieldtype": "Data"},
                {
                    "fieldname": "activity_summary",
                    "label": "Daily Activity Summary",
                    "fieldtype": "Long Text",
                    "reqd": 1,
                },
                {
                    "fieldname": "attachment_meta",
                    "label": "Attachment Meta JSON",
                    "fieldtype": "Long Text",
                },
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
                {"role": "Sales Representative", "read": 1, "write": 1, "create": 1},
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    frappe.clear_cache(doctype="Sales Team Performance Report")


def _parse_performance_attachments(data):
    raw = data.get("attachments_json") or data.get("attachments")
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            raw = json.loads(raw)
        except Exception:
            frappe.throw(_("Invalid attachments JSON"))
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        filename = (item.get("filename") or "activity.pdf").strip() or "activity.pdf"
        content = item.get("file_content") or item.get("content") or ""
        if not content:
            continue
        if isinstance(content, str) and "," in content and content.strip().startswith("data:"):
            content = content.split(",", 1)[1]
        out.append({"filename": filename[:140], "file_content": content})
    return out[:10]


def _attach_performance_files(report_name, attachments):
    if not attachments:
        return []
    import base64

    from frappe.utils.file_manager import save_file

    saved = []
    for item in attachments:
        try:
            content = base64.b64decode(item["file_content"])
        except Exception:
            frappe.throw(_("Invalid file encoding for {0}").format(item.get("filename")))
        if len(content) > 8 * 1024 * 1024:
            frappe.throw(_("File {0} exceeds 8MB limit").format(item.get("filename")))
        file_doc = save_file(
            item["filename"],
            content,
            "Sales Team Performance Report",
            report_name,
            decode=False,
            is_private=1,
        )
        saved.append(
            {
                "file_name": file_doc.file_name,
                "file_url": file_doc.file_url,
                "name": file_doc.name,
            }
        )
    return saved


def _performance_attachments_for(report_name):
    rows = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Sales Team Performance Report",
            "attached_to_name": report_name,
        },
        fields=["name", "file_name", "file_url", "file_size"],
        order_by="creation asc",
    )
    return rows


def _can_access_performance_report(user, report_name):
    rep_ids = scoped_rep_ids(user)
    sales_rep = frappe.db.get_value("Sales Team Performance Report", report_name, "sales_rep")
    return bool(sales_rep and sales_rep in rep_ids)


def serialize_team_performance_report(row):
    meta = row.get("attachment_meta")
    files = []
    if isinstance(meta, str) and meta.strip():
        try:
            files = json.loads(meta) or []
        except Exception:
            files = []
    if not files:
        files = _performance_attachments_for(row.get("name"))
    rep = frappe.db.get_value(
        "Sales Rep Profile",
        row.get("sales_rep"),
        ["full_name", "rep_code", "designation"],
        as_dict=True,
    ) or {}
    return {
        "name": row.get("name"),
        "sales_rep": row.get("sales_rep"),
        "rep_code": rep.get("rep_code") or "",
        "full_name": rep.get("full_name") or "",
        "designation": rep.get("designation") or "",
        "activity_date": str(row.get("activity_date") or ""),
        "title": row.get("title") or "",
        "doctors_met": cint(row.get("doctors_met")),
        "visits_done": cint(row.get("visits_done")),
        "samples_collected": cint(row.get("samples_collected")),
        "km_traveled": flt(row.get("km_traveled")),
        "location_note": row.get("location_note") or "",
        "activity_summary": row.get("activity_summary") or "",
        "creation": str(row.get("creation") or ""),
        "attachments": files,
    }


def _rep_label_map(rep_ids):
    if not rep_ids:
        return {}
    rows = frappe.get_all(
        "Sales Rep Profile",
        filters={"name": ("in", list(rep_ids))},
        fields=["name", "full_name", "rep_code", "designation"],
    )
    return {
        r.name: {
            "full_name": r.full_name or "",
            "rep_code": r.rep_code or "",
            "designation": r.designation or "",
        }
        for r in rows
    }


def _parse_activity_range(activity_date=None, date_from=None, date_to=None, default_days=14, max_days=366):
    """Resolve inclusive date range. Single activity_date wins over from/to."""
    from datetime import timedelta

    today_d = getdate(today())
    if activity_date:
        day = getdate(activity_date)
        return day, day
    start = getdate(date_from) if date_from else (today_d - timedelta(days=max(cint(default_days), 1) - 1))
    end = getdate(date_to) if date_to else today_d
    if start > end:
        start, end = end, start
    # Hard cap range length to keep payloads manageable.
    cap = max(cint(max_days) or 366, 31)
    if (end - start).days > cap:
        start = end - timedelta(days=cap)
    return start, end


def _fmt_activity_day(value):
    """Normalize creation / visit_date / datetime / string → YYYY-MM-DD."""
    if value is None or value == "":
        return ""
    try:
        return str(getdate(value))
    except Exception:
        text = cstr(value).strip()
        if not text:
            return ""
        # "2026-10-03 09:50:16.252723" or "2026-10-03"
        return text[:10] if len(text) >= 10 and text[4] == "-" else text


def _excel_text(value):
    """Keep phone / ids as text in Excel (avoid scientific notation)."""
    text = cstr(value or "").strip()
    if not text:
        return ""
    return f"'{text}"


def _fmt_visit_time(value):
    if value is None or value == "":
        return ""
    try:
        from datetime import timedelta

        if isinstance(value, timedelta):
            total = int(value.total_seconds())
            hh = (total // 3600) % 24
            mm = (total % 3600) // 60
            ss = total % 60
            return f"{hh:02d}:{mm:02d}:{ss:02d}"
    except Exception:
        pass
    text = str(value)
    if text.startswith("0:"):
        # timedelta str like "0:06:37.123"
        parts = text.split(":")
        if len(parts) >= 3:
            return f"{int(parts[0]):02d}:{parts[1]}:{parts[2][:2]}"
    return text[:8]


def get_team_portal_activity(
    user,
    activity_date=None,
    date_from=None,
    date_to=None,
    limit=500,
    sales_rep=None,
):
    """Leads / visits / onboardings for the team, date-ranged and grouped day-by-day per employee."""
    from datetime import timedelta

    rep_ids = scoped_rep_ids(user)
    sales_rep = cstr(sales_rep or "").strip()
    if sales_rep:
        # Force single-employee scope when requested (director may pass any active rep).
        if sales_rep in (rep_ids or []) or (
            is_org_wide_sales_viewer(user) and frappe.db.exists("Sales Rep Profile", sales_rep)
        ):
            rep_ids = [sales_rep]
        else:
            rep_ids = []
    labels = _rep_label_map(rep_ids)
    start, end = _parse_activity_range(activity_date, date_from, date_to, default_days=14, max_days=366)
    start_s, end_s = str(start), str(end)
    limit = min(max(cint(limit) or 500, 50), 5000)

    leads = []
    if rep_ids and frappe.db.exists("DocType", "Franchise Sales Lead"):
        lead_fields = [
            "name",
            "lead_name",
            "company_name",
            "contact_person",
            "phone",
            "email",
            "address",
            "city",
            "district",
            "subdivision",
            "pincode",
            "status",
            "assigned_rep",
            "lead_source",
            "notes",
            "latitude",
            "longitude",
            "creation",
            "modified",
        ]
        meta = frappe.get_meta("Franchise Sales Lead")
        lead_fields = [f for f in lead_fields if f == "name" or meta.has_field(f)]
        for row in frappe.get_all(
            "Franchise Sales Lead",
            filters={
                "assigned_rep": ("in", list(rep_ids)),
                "creation": ("between", [f"{start_s} 00:00:00", f"{end_s} 23:59:59"]),
            },
            fields=lead_fields,
            order_by="creation desc",
            limit=limit,
        ):
            info = labels.get(row.get("assigned_rep")) or {}
            activity_day = _fmt_activity_day(row.get("creation"))
            leads.append(
                {
                    "name": row.get("name"),
                    "activity_date": activity_day,
                    "lead_name": row.get("lead_name") or "",
                    "company_name": row.get("company_name") or "",
                    "contact_person": row.get("contact_person") or "",
                    "phone": row.get("phone") or "",
                    "email": row.get("email") or "",
                    "address": row.get("address") or "",
                    "city": row.get("city") or "",
                    "district": row.get("district") or "",
                    "subdivision": row.get("subdivision") or "",
                    "pincode": row.get("pincode") or "",
                    "status": row.get("status") or "",
                    "lead_source": row.get("lead_source") or "Manual",
                    "notes": (row.get("notes") or "")[:500],
                    "latitude": flt(row.get("latitude")),
                    "longitude": flt(row.get("longitude")),
                    "sales_rep": row.get("assigned_rep") or "",
                    "full_name": info.get("full_name") or "",
                    "rep_code": info.get("rep_code") or "",
                    "creation": cstr(row.get("creation") or "")[:19],
                    "modified": cstr(row.get("modified") or "")[:19],
                }
            )

    visits = []
    if rep_ids and frappe.db.exists("DocType", "Field Sales Visit"):
        ensure_reach_ffms_visit_fields()
        visit_fields = [
            "name",
            "sales_rep",
            "lead",
            "visit_date",
            "visit_time",
            "purpose",
            "outcome",
            "duration_minutes",
            "latitude",
            "longitude",
            "notes",
            "creation",
        ]
        meta = frappe.get_meta("Field Sales Visit")
        for optional in ("visit_status", "photo"):
            if meta.has_field(optional):
                visit_fields.append(optional)
        for row in frappe.get_all(
            "Field Sales Visit",
            filters={
                "sales_rep": ("in", list(rep_ids)),
                "visit_date": ("between", [start_s, end_s]),
            },
            fields=visit_fields,
            order_by="visit_date desc, creation desc",
            limit=limit,
        ):
            info = labels.get(row.get("sales_rep")) or {}
            lead_name = ""
            if row.get("lead"):
                lead_name = frappe.db.get_value("Franchise Sales Lead", row.get("lead"), "lead_name") or ""
            activity_day = _fmt_activity_day(row.get("visit_date") or row.get("creation"))
            visits.append(
                {
                    "name": row.get("name"),
                    "activity_date": activity_day,
                    "sales_rep": row.get("sales_rep") or "",
                    "full_name": info.get("full_name") or "",
                    "rep_code": info.get("rep_code") or "",
                    "lead": row.get("lead") or "",
                    "lead_name": lead_name,
                    "visit_date": _fmt_activity_day(row.get("visit_date")),
                    "visit_time": _fmt_visit_time(row.get("visit_time")),
                    "purpose": row.get("purpose") or "",
                    "outcome": row.get("outcome") or "",
                    "duration_minutes": cint(row.get("duration_minutes")),
                    "latitude": flt(row.get("latitude")),
                    "longitude": flt(row.get("longitude")),
                    "visit_status": row.get("visit_status") or "Completed",
                    "notes": (row.get("notes") or "")[:500],
                    "photo": row.get("photo") or "",
                    "creation": cstr(row.get("creation") or "")[:19],
                }
            )

    onboardings = []
    if rep_ids and frappe.db.exists("DocType", "Franchise Onboarding Request"):
        for row in frappe.get_all(
            "Franchise Onboarding Request",
            filters={
                "sales_rep": ("in", list(rep_ids)),
                "creation": ("between", [f"{start_s} 00:00:00", f"{end_s} 23:59:59"]),
            },
            fields=[
                "name",
                "sales_rep",
                "lead",
                "franchise_name",
                "owner_name",
                "proposed_branch_code",
                "territory_region",
                "address",
                "phone",
                "email",
                "status",
                "franchisee_id",
                "notes",
                "creation",
                "modified",
            ],
            order_by="creation desc",
            limit=limit,
        ):
            info = labels.get(row.get("sales_rep")) or {}
            activity_day = _fmt_activity_day(row.get("creation"))
            onboardings.append(
                {
                    "name": row.get("name"),
                    "activity_date": activity_day,
                    "sales_rep": row.get("sales_rep") or "",
                    "full_name": info.get("full_name") or "",
                    "rep_code": info.get("rep_code") or "",
                    "franchise_name": row.get("franchise_name") or "",
                    "owner_name": row.get("owner_name") or "",
                    "proposed_branch_code": row.get("proposed_branch_code") or "",
                    "territory_region": row.get("territory_region") or "",
                    "address": row.get("address") or "",
                    "phone": row.get("phone") or "",
                    "email": row.get("email") or "",
                    "status": row.get("status") or "",
                    "franchisee_id": row.get("franchisee_id") or "",
                    "lead": row.get("lead") or "",
                    "notes": (row.get("notes") or "")[:500],
                    "creation": str(row.get("creation") or "")[:19],
                    "modified": str(row.get("modified") or "")[:19],
                }
            )

    # Day-by-day → employee buckets
    daily_map = {}
    employee_map = {}

    def bucket(day, rep_id, kind, item):
        if not day:
            return
        info = labels.get(rep_id) or {}
        day_entry = daily_map.setdefault(day, {})
        emp = day_entry.setdefault(
            rep_id or "_unassigned",
            {
                "sales_rep": rep_id or "",
                "full_name": info.get("full_name") or "Unassigned",
                "rep_code": info.get("rep_code") or "",
                "leads": [],
                "visits": [],
                "onboardings": [],
                "leads_count": 0,
                "visits_count": 0,
                "onboardings_count": 0,
            },
        )
        emp[kind].append(item)
        emp[f"{kind}_count"] = len(emp[kind])

        roll = employee_map.setdefault(
            rep_id or "_unassigned",
            {
                "sales_rep": rep_id or "",
                "full_name": info.get("full_name") or "Unassigned",
                "rep_code": info.get("rep_code") or "",
                "leads_count": 0,
                "visits_count": 0,
                "onboardings_count": 0,
                "days_active": set(),
            },
        )
        roll[f"{kind}_count"] += 1
        roll["days_active"].add(day)

    for item in leads:
        bucket(item.get("activity_date"), item.get("sales_rep"), "leads", item)
    for item in visits:
        bucket(item.get("activity_date"), item.get("sales_rep"), "visits", item)
    for item in onboardings:
        bucket(item.get("activity_date"), item.get("sales_rep"), "onboardings", item)

    # Ensure every scoped employee appears even with zero activity in range.
    for rid in rep_ids or []:
        info = labels.get(rid) or {}
        employee_map.setdefault(
            rid,
            {
                "sales_rep": rid,
                "full_name": info.get("full_name") or "",
                "rep_code": info.get("rep_code") or "",
                "leads_count": 0,
                "visits_count": 0,
                "onboardings_count": 0,
                "days_active": set(),
            },
        )

    daily = []
    cursor = end
    while cursor >= start:
        day_s = str(cursor)
        employees = list((daily_map.get(day_s) or {}).values())
        employees.sort(key=lambda e: ((e.get("full_name") or "").lower(), e.get("rep_code") or ""))
        daily.append(
            {
                "date": day_s,
                "leads_count": sum(e.get("leads_count") or 0 for e in employees),
                "visits_count": sum(e.get("visits_count") or 0 for e in employees),
                "onboardings_count": sum(e.get("onboardings_count") or 0 for e in employees),
                "employees": employees,
            }
        )
        cursor = cursor - timedelta(days=1)

    by_employee = []
    for row in employee_map.values():
        days_active = row.pop("days_active", set()) or set()
        by_employee.append(
            {
                **row,
                "days_active": len(days_active),
                "total": (row.get("leads_count") or 0)
                + (row.get("visits_count") or 0)
                + (row.get("onboardings_count") or 0),
            }
        )
    by_employee.sort(key=lambda e: (-(e.get("total") or 0), (e.get("full_name") or "").lower()))

    counts = {
        "leads": len(leads),
        "visits": len(visits),
        "onboardings": len(onboardings),
        "employees": len(by_employee),
        "days": len(daily),
    }
    today_s = today()
    today_counts = {
        "leads": sum(1 for r in leads if r.get("activity_date") == today_s),
        "visits": sum(1 for r in visits if r.get("activity_date") == today_s),
        "onboardings": sum(1 for r in onboardings if r.get("activity_date") == today_s),
    }

    return {
        "is_manager": is_sales_manager(user),
        "activity_date": start_s if start_s == end_s else "",
        "date_from": start_s,
        "date_to": end_s,
        "counts": counts,
        "today_counts": today_counts,
        "leads": leads,
        "visits": visits,
        "onboardings": onboardings,
        "daily": daily,
        "by_employee": by_employee,
        "prefill": {
            "visits_done": today_counts.get("visits") or 0,
            "doctors_met": today_counts.get("visits") or 0,
            "samples_collected": today_counts.get("leads") or 0,
            "leads_uploaded": today_counts.get("leads") or 0,
            "onboardings_done": today_counts.get("onboardings") or 0,
        },
    }


def _csv_entry_date(*candidates):
    for value in candidates:
        day = _fmt_activity_day(value)
        if day:
            return day
    return ""


def team_portal_activity_csv(user, activity_date=None, date_from=None, date_to=None):
    """One CSV row per lead / visit / onboarding with full field set."""
    payload = get_team_portal_activity(
        user,
        activity_date=activity_date,
        date_from=date_from,
        date_to=date_to,
        limit=5000,
    )
    import csv
    import io

    buf = io.StringIO()
    # Excel-friendly UTF-8 BOM
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Entry Type",
            "Date",
            "Employee",
            "Rep Code",
            "Record ID",
            "Lead Name",
            "Company / Franchise",
            "Contact Person / Owner",
            "Phone",
            "Email",
            "Address",
            "City",
            "District",
            "Subdivision",
            "Pincode",
            "Territory / Area",
            "Branch Code",
            "Purpose",
            "Outcome",
            "Duration Minutes",
            "Visit Time",
            "Visit Status",
            "Status",
            "Lead Source",
            "Linked Lead ID",
            "Latitude",
            "Longitude",
            "Photo URL",
            "Notes",
            "Created At",
            "Sales Rep ID",
        ]
    )

    def _row(entry_type, date_val, emp_name, rep_code, record_id, **cols):
        writer.writerow(
            [
                entry_type,
                date_val or "",
                emp_name or "",
                rep_code or "",
                record_id or "",
                cols.get("lead_name") or "",
                cols.get("company") or "",
                cols.get("contact") or "",
                cols.get("phone") or "",
                cols.get("email") or "",
                cols.get("address") or "",
                cols.get("city") or "",
                cols.get("district") or "",
                cols.get("subdivision") or "",
                cols.get("pincode") or "",
                cols.get("territory") or "",
                cols.get("branch") or "",
                cols.get("purpose") or "",
                cols.get("outcome") or "",
                cols.get("duration") or "",
                cols.get("visit_time") or "",
                cols.get("visit_status") or "",
                cols.get("status") or "",
                cols.get("lead_source") or "",
                cols.get("lead_id") or "",
                cols.get("latitude") or "",
                cols.get("longitude") or "",
                cols.get("photo") or "",
                cols.get("notes") or "",
                cols.get("created") or "",
                cols.get("sales_rep") or "",
            ]
        )

    for row in payload.get("leads") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("creation"))
        _row(
            "Lead",
            day,
            row.get("full_name"),
            row.get("rep_code"),
            row.get("name"),
            lead_name=row.get("lead_name"),
            company=row.get("company_name"),
            contact=row.get("contact_person"),
            phone=_excel_text(row.get("phone")),
            email=row.get("email"),
            address=row.get("address"),
            city=row.get("city"),
            district=row.get("district"),
            subdivision=row.get("subdivision"),
            pincode=_excel_text(row.get("pincode")),
            status=row.get("status"),
            lead_source=row.get("lead_source"),
            latitude=row.get("latitude"),
            longitude=row.get("longitude"),
            notes=row.get("notes"),
            created=row.get("creation") or day,
            sales_rep=row.get("sales_rep"),
        )
    for row in payload.get("visits") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("visit_date"), row.get("creation"))
        _row(
            "Visit",
            day,
            row.get("full_name"),
            row.get("rep_code"),
            row.get("name"),
            lead_name=row.get("lead_name"),
            purpose=row.get("purpose"),
            outcome=row.get("outcome"),
            duration=row.get("duration_minutes"),
            visit_time=row.get("visit_time"),
            visit_status=row.get("visit_status"),
            lead_id=row.get("lead"),
            latitude=row.get("latitude"),
            longitude=row.get("longitude"),
            photo=row.get("photo"),
            notes=row.get("notes"),
            created=row.get("creation") or day,
            sales_rep=row.get("sales_rep"),
        )
    for row in payload.get("onboardings") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("creation"))
        _row(
            "Onboarding",
            day,
            row.get("full_name"),
            row.get("rep_code"),
            row.get("name"),
            company=row.get("franchise_name"),
            contact=row.get("owner_name"),
            phone=_excel_text(row.get("phone")),
            email=row.get("email"),
            address=row.get("address"),
            territory=row.get("territory_region"),
            branch=row.get("proposed_branch_code"),
            status=row.get("status"),
            lead_id=row.get("lead"),
            notes=row.get("notes"),
            created=row.get("creation") or day,
            sales_rep=row.get("sales_rep"),
        )

    count = (
        len(payload.get("leads") or [])
        + len(payload.get("visits") or [])
        + len(payload.get("onboardings") or [])
    )
    return {
        "is_manager": payload.get("is_manager"),
        "filename": f"team-portal-activity-{payload.get('date_from')}-to-{payload.get('date_to')}.csv",
        "csv": buf.getvalue(),
        "count": count,
        "counts": payload.get("counts") or {},
        "date_from": payload.get("date_from"),
        "date_to": payload.get("date_to"),
    }


def _read_visit_photo_bytes(visit_name, photo_url=None):
    """Return (filename, bytes) for a visit photo, or None."""
    rows = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Field Sales Visit",
            "attached_to_name": visit_name,
        },
        fields=["name", "file_name", "file_url"],
        order_by="creation desc",
        limit=5,
    )
    if not rows and photo_url:
        rows = frappe.get_all(
            "File",
            filters={"file_url": photo_url},
            fields=["name", "file_name", "file_url"],
            limit=1,
        )
    for row in rows:
        try:
            file_doc = frappe.get_doc("File", row.name)
            content = file_doc.get_content()
            if content:
                fname = cstr(row.file_name or f"{visit_name}.jpg").replace("/", "_")
                return fname, content
        except Exception:
            frappe.log_error(title="team_employee_photo_read", message=frappe.get_traceback())
    return None


def download_team_employee_pack(user, sales_rep, activity_date=None, date_from=None, date_to=None):
    """ZIP pack for one employee: full-field CSV of leads/visits/onboarding + visit photos."""
    import base64
    import csv
    import io
    import zipfile

    sales_rep = cstr(sales_rep or "").strip()
    if not sales_rep:
        frappe.throw(_("sales_rep is required"))
    allowed = set(scoped_rep_ids(user) or [])
    if sales_rep not in allowed and not is_org_wide_sales_viewer(user):
        frappe.throw(_("Not permitted to download this employee"), frappe.PermissionError)
    if sales_rep not in allowed and is_org_wide_sales_viewer(user):
        # still require an existing active profile
        if not frappe.db.exists("Sales Rep Profile", sales_rep):
            frappe.throw(_("Employee not found"))

    payload = get_team_portal_activity(
        user,
        activity_date=activity_date,
        date_from=date_from,
        date_to=date_to,
        limit=5000,
        sales_rep=sales_rep,
    )
    labels = _rep_label_map([sales_rep])
    info = labels.get(sales_rep) or {}
    emp_name = info.get("full_name") or sales_rep
    rep_code = info.get("rep_code") or sales_rep
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", emp_name).strip("_") or "employee"

    # Build CSV directly from filtered payload (same columns as team export + photo file path).
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Entry Type",
            "Date",
            "Employee",
            "Rep Code",
            "Record ID",
            "Lead Name",
            "Company / Franchise",
            "Contact Person / Owner",
            "Phone",
            "Email",
            "Address",
            "City",
            "District",
            "Subdivision",
            "Pincode",
            "Territory / Area",
            "Branch Code",
            "Purpose",
            "Outcome",
            "Duration Minutes",
            "Visit Time",
            "Visit Status",
            "Status",
            "Lead Source",
            "Linked Lead ID",
            "Latitude",
            "Longitude",
            "Photo URL",
            "Photo File",
            "Notes",
            "Created At",
            "Sales Rep ID",
        ]
    )

    photo_index = []
    for row in payload.get("leads") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("creation"))
        if not day and row.get("name"):
            day = _fmt_activity_day(frappe.db.get_value("Franchise Sales Lead", row.get("name"), "creation"))
        writer.writerow(
            [
                "Lead",
                day,
                row.get("full_name") or emp_name,
                row.get("rep_code") or rep_code,
                row.get("name") or "",
                row.get("lead_name") or "",
                row.get("company_name") or "",
                row.get("contact_person") or "",
                _excel_text(row.get("phone")),
                row.get("email") or "",
                row.get("address") or "",
                row.get("city") or "",
                row.get("district") or "",
                row.get("subdivision") or "",
                _excel_text(row.get("pincode")),
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                row.get("status") or "",
                row.get("lead_source") or "",
                "",
                row.get("latitude") or "",
                row.get("longitude") or "",
                "",
                "",
                row.get("notes") or "",
                row.get("creation") or day,
                row.get("sales_rep") or sales_rep,
            ]
        )

    for row in payload.get("visits") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("visit_date"), row.get("creation"))
        if not day and row.get("name"):
            day = _fmt_activity_day(
                frappe.db.get_value("Field Sales Visit", row.get("name"), "visit_date")
                or frappe.db.get_value("Field Sales Visit", row.get("name"), "creation")
            )
        photo_file = ""
        photo_url = row.get("photo") or ""
        if photo_url or row.get("name"):
            got = _read_visit_photo_bytes(row.get("name"), photo_url)
            if got:
                fname, content = got
                stored = f"photos/{row.get('name')}_{fname}"
                photo_index.append((stored, content))
                photo_file = stored
        writer.writerow(
            [
                "Visit",
                day,
                row.get("full_name") or emp_name,
                row.get("rep_code") or rep_code,
                row.get("name") or "",
                row.get("lead_name") or "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                row.get("purpose") or "",
                row.get("outcome") or "",
                row.get("duration_minutes") or "",
                row.get("visit_time") or "",
                row.get("visit_status") or "",
                "",
                "",
                row.get("lead") or "",
                row.get("latitude") or "",
                row.get("longitude") or "",
                photo_url,
                photo_file,
                row.get("notes") or "",
                row.get("creation") or day,
                row.get("sales_rep") or sales_rep,
            ]
        )

    for row in payload.get("onboardings") or []:
        day = _csv_entry_date(row.get("activity_date"), row.get("creation"))
        if not day and row.get("name"):
            day = _fmt_activity_day(
                frappe.db.get_value("Franchise Onboarding Request", row.get("name"), "creation")
            )
        writer.writerow(
            [
                "Onboarding",
                day,
                row.get("full_name") or emp_name,
                row.get("rep_code") or rep_code,
                row.get("name") or "",
                "",
                row.get("franchise_name") or "",
                row.get("owner_name") or "",
                _excel_text(row.get("phone")),
                row.get("email") or "",
                row.get("address") or "",
                "",
                "",
                "",
                "",
                row.get("territory_region") or "",
                row.get("proposed_branch_code") or "",
                "",
                "",
                "",
                "",
                "",
                row.get("status") or "",
                "",
                row.get("lead") or "",
                "",
                "",
                "",
                "",
                row.get("notes") or "",
                row.get("creation") or day,
                row.get("sales_rep") or sales_rep,
            ]
        )

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{safe_name}_entries.csv", buf.getvalue().encode("utf-8"))
        # Employee summary
        summary = io.StringIO()
        summary.write("\ufeff")
        sw = csv.writer(summary)
        sw.writerow(["Field", "Value"])
        sw.writerow(["Employee", emp_name])
        sw.writerow(["Rep Code", rep_code])
        sw.writerow(["Sales Rep ID", sales_rep])
        sw.writerow(["Date From", payload.get("date_from") or ""])
        sw.writerow(["Date To", payload.get("date_to") or ""])
        sw.writerow(["Leads", (payload.get("counts") or {}).get("leads") or 0])
        sw.writerow(["Visits", (payload.get("counts") or {}).get("visits") or 0])
        sw.writerow(["Onboardings", (payload.get("counts") or {}).get("onboardings") or 0])
        sw.writerow(["Photos included", len(photo_index)])
        zf.writestr(f"{safe_name}_summary.csv", summary.getvalue().encode("utf-8"))
        for path, content in photo_index:
            zf.writestr(path, content)

    raw = zip_buf.getvalue()
    count = (
        len(payload.get("leads") or [])
        + len(payload.get("visits") or [])
        + len(payload.get("onboardings") or [])
    )
    return {
        "filename": f"{safe_name}_{payload.get('date_from')}_to_{payload.get('date_to')}.zip",
        "content_type": "application/zip",
        "file_content": base64.b64encode(raw).decode("ascii"),
        "count": count,
        "photo_count": len(photo_index),
        "employee": emp_name,
        "rep_code": rep_code,
        "sales_rep": sales_rep,
        "date_from": payload.get("date_from"),
        "date_to": payload.get("date_to"),
        "counts": payload.get("counts") or {},
    }


def list_team_performance_reports(
    user, limit=50, activity_date=None, date_from=None, date_to=None, sales_rep=None
):
    ensure_team_performance_doctype()
    rep_ids = scoped_rep_ids(user)
    if not rep_ids:
        return {"is_manager": is_sales_manager(user), "reports": []}
    filters = {"sales_rep": ("in", rep_ids)}
    if activity_date:
        filters["activity_date"] = getdate(activity_date)
    elif date_from or date_to:
        start, end = _parse_activity_range(None, date_from, date_to, default_days=14)
        filters["activity_date"] = ("between", [str(start), str(end)])
    if sales_rep and sales_rep in rep_ids:
        filters["sales_rep"] = sales_rep
    rows = frappe.get_all(
        "Sales Team Performance Report",
        filters=filters,
        fields=[
            "name",
            "sales_rep",
            "activity_date",
            "title",
            "doctors_met",
            "visits_done",
            "samples_collected",
            "km_traveled",
            "location_note",
            "activity_summary",
            "attachment_meta",
            "creation",
        ],
        order_by="activity_date desc, creation desc",
        limit=cint(limit) or 50,
    )
    return {
        "is_manager": is_sales_manager(user),
        "my_rep_id": get_or_create_sales_rep(user),
        "reports": [serialize_team_performance_report(r) for r in rows],
    }


def submit_team_performance_report(user, data):
    ensure_team_performance_doctype()
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        frappe.throw(_("Sales rep profile required"))
    title = (data.get("title") or "Daily activity").strip()[:140]
    summary = (data.get("activity_summary") or data.get("notes") or "").strip()
    if not summary:
        frappe.throw(_("Daily activity summary is required"))
    activity_date = getdate(data.get("activity_date") or today())
    attachments = _parse_performance_attachments(data)
    doc = frappe.get_doc(
        {
            "doctype": "Sales Team Performance Report",
            "sales_rep": rep_id,
            "activity_date": activity_date,
            "title": title or "Daily activity",
            "doctors_met": cint(data.get("doctors_met")),
            "visits_done": cint(data.get("visits_done")),
            "samples_collected": cint(data.get("samples_collected")),
            "km_traveled": flt(data.get("km_traveled")),
            "location_note": (data.get("location_note") or "")[:140],
            "activity_summary": summary[:5000],
        }
    )
    doc.insert(ignore_permissions=True)
    saved = _attach_performance_files(doc.name, attachments)
    if saved:
        doc.db_set("attachment_meta", json.dumps(saved, ensure_ascii=False))
    frappe.db.commit()
    return serialize_team_performance_report(doc.as_dict())


def team_performance_reports_csv(user, activity_date=None, sales_rep=None):
    payload = list_team_performance_reports(user, limit=500, activity_date=activity_date, sales_rep=sales_rep)
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Report ID",
            "Date",
            "Rep Code",
            "Employee",
            "Designation",
            "Title",
            "Doctors Met",
            "Visits Done",
            "Samples / Orders",
            "KM Traveled",
            "Area / Location",
            "Activity Summary",
            "Attachments",
            "Submitted At",
        ]
    )
    for row in payload.get("reports") or []:
        files = ", ".join(
            (f.get("file_name") or f.get("filename") or "") for f in (row.get("attachments") or [])
        )
        writer.writerow(
            [
                row.get("name") or "",
                row.get("activity_date") or "",
                row.get("rep_code") or "",
                row.get("full_name") or "",
                row.get("designation") or "",
                row.get("title") or "",
                row.get("doctors_met") or 0,
                row.get("visits_done") or 0,
                row.get("samples_collected") or 0,
                row.get("km_traveled") or 0,
                row.get("location_note") or "",
                (row.get("activity_summary") or "").replace("\n", " ").strip(),
                files,
                (row.get("creation") or "")[:19],
            ]
        )
    return {
        "is_manager": payload.get("is_manager"),
        "filename": f"team-performance-{activity_date or 'all'}.csv",
        "csv": buf.getvalue(),
        "count": len(payload.get("reports") or []),
    }


def get_team_performance_attachment(user, report_name, file_name=None):
    ensure_team_performance_doctype()
    if not report_name or not _can_access_performance_report(user, report_name):
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    filters = {
        "attached_to_doctype": "Sales Team Performance Report",
        "attached_to_name": report_name,
    }
    if file_name:
        filters["name"] = file_name
    file_row = frappe.get_all(
        "File",
        filters=filters,
        fields=["name", "file_name", "file_url", "is_private"],
        limit=1,
    )
    if not file_row:
        frappe.throw(_("Attachment not found"))
    file_doc = frappe.get_doc("File", file_row[0].name)
    content = file_doc.get_content()
    import base64

    return {
        "file_name": file_doc.file_name,
        "content_type": "application/octet-stream",
        "file_content": base64.b64encode(content).decode("ascii"),
    }


def update_sales_rep_location(user, latitude, longitude, on_duty=1):
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        frappe.throw(_("Sales rep profile required"))
    payload = {
        "rep_id": rep_id,
        "user": user,
        "latitude": flt(latitude),
        "longitude": flt(longitude),
        "on_duty": cint(on_duty),
        "updated": str(now_datetime()),
    }
    cache = _load_location_cache()
    cache[user] = payload
    frappe.cache().set_value(LOCATION_CACHE_KEY, cache, expires_in_sec=86400)
    return payload


def _load_location_cache():
    cache = frappe.cache().get_value(LOCATION_CACHE_KEY)
    if isinstance(cache, str):
        try:
            cache = json.loads(cache)
        except Exception:
            cache = {}
    return cache if isinstance(cache, dict) else {}


def get_sales_team_map(user=None):
    user = user or frappe.session.user
    rep_ids = scoped_rep_ids(user)
    users = frappe.get_all(
        "Sales Rep Profile",
        filters={"name": ("in", rep_ids), "active": 1},
        fields=["name", "user", "full_name", "rep_code", "hq_latitude", "hq_longitude", "designation"],
    )
    cache = _load_location_cache()
    pins = []
    for row in users:
        live = cache.get(row.user) or {}
        pins.append(
            {
                "rep_id": row.name,
                "rep_code": row.rep_code,
                "full_name": row.full_name,
                "designation": row.designation,
                "hq_latitude": flt(row.hq_latitude),
                "hq_longitude": flt(row.hq_longitude),
                "latitude": flt(live.get("latitude")) or flt(row.hq_latitude),
                "longitude": flt(live.get("longitude")) or flt(row.hq_longitude),
                "on_duty": bool(live.get("on_duty", 0)),
                "updated": live.get("updated"),
            }
        )
    leads = frappe.get_all(
        "Franchise Sales Lead",
        filters={"assigned_rep": ("in", rep_ids), "status": ("not in", ["Lost"])},
        fields=["name", "lead_name", "latitude", "longitude", "status", "city", "district", "subdivision", "pincode"],
        limit=100,
    )
    return {"reps": pins, "leads": [l for l in leads if l.latitude and l.longitude]}


# "password" is the published demo default: never applied (new users get hec_seed_staff_password or a random one);
# setup_phase132 reads it to rotate admin accounts still using it.
SALES_SEED_USERS = (
    {
        "email": "sales_mgr@health.local",
        "username": "sales_mgr",
        "first_name": "Sales",
        "last_name": "Manager",
        "password": "SalesMgrChangeMe@123",
        "roles": [SALES_MANAGER_ROLE],
        "rep_code": "SMGR001",
        "designation": "Regional Manager",
    },
    {
        "email": "sales_rep1@health.local",
        "username": "sales_rep1",
        "first_name": "Field",
        "last_name": "Rep One",
        "password": "SalesRepChangeMe@123",
        "roles": [SALES_REP_ROLE],
        "rep_code": "REP001",
        "designation": "Sales Representative",
    },
)


def seed_sales_team():
    ensure_sales_roles()
    seeds = SALES_SEED_USERS
    mgr_rep = None
    created = []
    for spec in seeds:
        _upsert_sales_user(spec)
        rep_id = get_or_create_sales_rep(spec["email"])
        frappe.db.set_value(
            "Sales Rep Profile",
            rep_id,
            {
                "rep_code": spec["rep_code"],
                "designation": spec["designation"],
                "territory_region": "East India",
                "hq_latitude": 22.5726,
                "hq_longitude": 88.3639,
            },
        )
        if SALES_MANAGER_ROLE in spec["roles"]:
            mgr_rep = rep_id
        created.append(spec["email"])
    if mgr_rep:
        for rep in frappe.get_all(
            "Sales Rep Profile",
            filters={"designation": "Sales Representative"},
            pluck="name",
        ):
            frappe.db.set_value("Sales Rep Profile", rep, "reports_to", mgr_rep)
    frappe.db.commit()
    return created


def _upsert_sales_user(spec):
    created = not frappe.db.exists("User", spec["email"])
    if created:
        frappe.get_doc(
            {
                "doctype": "User",
                "email": spec["email"],
                "first_name": spec["first_name"],
                "last_name": spec["last_name"],
                "send_welcome_email": 0,
                "enabled": 1,
            }
        ).insert(ignore_permissions=True)
    user = frappe.get_doc("User", spec["email"])
    user.username = spec["username"]
    user.enabled = 1
    existing = {r.role for r in user.roles}
    for role in spec["roles"]:
        if role not in existing:
            user.append("roles", {"role": role})
    user.save(ignore_permissions=True)
    if created:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import set_new_staff_password

        set_new_staff_password(spec["email"])


def setup_phase25():
    ensure_phase25_custom_fields()
    ensure_sales_roles()
    users = seed_sales_team()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 25, "sales_users": users}


def smoke_phase25():
    """Roles, DocTypes, portal API, seed users."""
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase25()
    check("setup", setup.get("ok"), str(setup.get("sales_users")))
    for dt in (
        "Sales Rep Profile",
        "Franchise Sales Lead",
        "Field Sales Visit",
        "Franchise Onboarding Request",
        "Sales Closing Report",
        "Sales Team Performance Report",
    ):
        check(f"doctype_{dt}", frappe.db.exists("DocType", dt))

    check("role_rep", frappe.db.exists("Role", SALES_REP_ROLE))
    check("role_mgr", frappe.db.exists("Role", SALES_MANAGER_ROLE))
    check("user_rep", frappe.db.exists("User", "sales_rep1@health.local"))
    check("user_mgr", frappe.db.exists("User", "sales_mgr@health.local"))

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    for method in (
        "get_sales_portal",
        "get_sales_leads",
        "create_sales_lead",
        "log_sales_visit",
        "submit_sales_onboarding",
        "get_sales_team_map",
    ):
        check(f"api_{method}", hasattr(api_mod, method))

    # Portal as seeded rep
    prev = frappe.session.user
    try:
        frappe.set_user("sales_rep1@health.local")
        portal = get_sales_portal_payload("sales_rep1@health.local")
        check(
            "portal_payload",
            isinstance(portal, dict) and portal.get("available"),
            str(list(portal.keys())[:8] if isinstance(portal, dict) else portal),
        )
    except Exception as exc:
        check("portal_payload", False, str(exc))
    finally:
        frappe.set_user(prev)

    return result

