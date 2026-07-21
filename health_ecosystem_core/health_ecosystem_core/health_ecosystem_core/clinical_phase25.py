"""Phase 25 — Sales / field force (MR-style): leads, visits, onboarding, GPS, closing reports."""

from __future__ import annotations

import json
import os
from calendar import monthrange
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

SALES_REP_ROLE = "Sales Representative"
SALES_MANAGER_ROLE = "Sales Manager"
SALES_ROLES = (SALES_REP_ROLE, SALES_MANAGER_ROLE, "Health System Admin", "System Manager")
LOCATION_CACHE_KEY = "hec_sales_rep_locations"

PHASE25_DOCTYPES = (
    ("sales_rep_profile", "Sales Rep Profile"),
    ("franchise_sales_lead", "Franchise Sales Lead"),
    ("field_sales_visit", "Field Sales Visit"),
    ("franchise_onboarding_request", "Franchise Onboarding Request"),
    ("sales_closing_report", "Sales Closing Report"),
)


def is_sales_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    return bool(set(frappe.get_roles(user)) & set(SALES_ROLES))


def is_sales_manager(user=None):
    roles = set(frappe.get_roles(user or frappe.session.user))
    return SALES_MANAGER_ROLE in roles or "Health System Admin" in roles or "System Manager" in roles


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
    """Reps visible to user: self, or self + team if manager."""
    rep_id = get_or_create_sales_rep(user or frappe.session.user)
    if not rep_id:
        return []
    if is_sales_manager(user):
        return _subordinate_rep_ids(rep_id)
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
    rep_ids = scoped_rep_ids(user)
    rows = frappe.get_all(
        "Franchise Sales Lead",
        filters={"assigned_rep": ("in", rep_ids)},
        fields=[
            "name",
            "lead_name",
            "company_name",
            "phone",
            "city",
            "status",
            "assigned_rep",
            "franchisee",
            "latitude",
            "longitude",
            "modified",
        ],
        order_by="modified desc",
        limit=cint(limit),
    )
    return rows


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
            "state": data.get("state"),
            "latitude": flt(data.get("latitude")) or None,
            "longitude": flt(data.get("longitude")) or None,
            "status": data.get("status") or "New",
            "assigned_rep": rep_id,
            "notes": data.get("notes"),
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def log_field_visit(user, data):
    rep_id = get_or_create_sales_rep(user)
    if not rep_id:
        frappe.throw(_("Sales rep profile required"))
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
        }
    )
    doc.insert(ignore_permissions=True)
    if data.get("lead_id") and data.get("lead_status"):
        frappe.db.set_value("Franchise Sales Lead", data["lead_id"], "status", data["lead_status"])
    frappe.db.commit()
    return doc.name


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


def list_closing_reports(user, limit=30):
    rep_ids = scoped_rep_ids(user)
    return frappe.get_all(
        "Sales Closing Report",
        filters={"sales_rep": ("in", rep_ids)},
        fields=[
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
            "creation",
        ],
        order_by="creation desc",
        limit=cint(limit),
    )


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

    return {
        "report_type": report_type,
        "period_date": str(period_date),
        "visits_count": visits,
        "new_leads": new_leads,
        "qualified_leads": qualified,
        "onboardings": onboardings,
        "franchise_revenue": revenue,
    }


def submit_closing_report(user, data):
    rep_id = get_or_create_sales_rep(user)
    draft = build_closing_report_draft(user, data.get("report_type") or "Daily", data.get("period_date"))
    doc = frappe.get_doc(
        {
            "doctype": "Sales Closing Report",
            "sales_rep": rep_id,
            "report_type": draft["report_type"],
            "period_date": draft["period_date"],
            "visits_count": cint(data.get("visits_count", draft["visits_count"])),
            "new_leads": cint(data.get("new_leads", draft["new_leads"])),
            "qualified_leads": cint(data.get("qualified_leads", draft["qualified_leads"])),
            "onboardings": cint(data.get("onboardings", draft["onboardings"])),
            "franchise_revenue": flt(data.get("franchise_revenue", draft["franchise_revenue"])),
            "km_traveled": flt(data.get("km_traveled")),
            "notes": data.get("notes"),
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


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
        fields=["name", "lead_name", "latitude", "longitude", "status", "city"],
        limit=100,
    )
    return {"reps": pins, "leads": [l for l in leads if l.latitude and l.longitude]}


def list_field_visits(user, limit=50):
    rep_ids = scoped_rep_ids(user)
    return frappe.get_all(
        "Field Sales Visit",
        filters={"sales_rep": ("in", rep_ids)},
        fields=[
            "name",
            "sales_rep",
            "lead",
            "franchisee",
            "visit_date",
            "purpose",
            "outcome",
            "latitude",
            "longitude",
            "notes",
            "creation",
        ],
        order_by="creation desc",
        limit=cint(limit),
    )


def seed_sales_team():
    ensure_sales_roles()
    seeds = [
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
    ]
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
    from frappe.utils.password import update_password

    if not frappe.db.exists("User", spec["email"]):
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
    update_password(spec["email"], spec["password"], logout_all_sessions=False)


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

