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
        "qualified": "Qualified",
        "follow_up": "Negotiation",
        "negotiation": "Negotiation",
        "won": "Won",
        "lost": "Lost",
        "disqualified": "Lost",
        "completed": "Won",
    }
    return mapping.get(cstr(stage or "").strip().lower().replace(" ", "_"), None)


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
    if data.get("lead_id") and data.get("lead_status"):
        frappe.db.set_value("Franchise Sales Lead", data["lead_id"], "status", data["lead_status"])
        if frappe.db.exists("Franchise Sales Lead", data["lead_id"]):
            lead_doc = frappe.get_doc("Franchise Sales Lead", data["lead_id"])
            _sync_sales_lead_to_rfms(lead_doc, lead_doc.assigned_rep)
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
        if doc.lead and frappe.db.exists("Franchise Sales Lead", doc.lead):
            lead = frappe.db.get_value(
                "Franchise Sales Lead",
                doc.lead,
                ["lead_name", "phone", "rfms_lead_id"],
                as_dict=True,
            )
            if lead:
                lead_name = cstr(lead.lead_name or "")
                lead_phone = cstr(lead.phone or "")
                rfms_lead_id = cstr(lead.rfms_lead_id or "")
        photos = _visit_photo_payload(doc)
        payload = {
            "visits": [
                {
                    "hec_visit_id": doc.name,
                    "hec_lead_id": cstr(doc.lead or ""),
                    "rfms_lead_id": rfms_lead_id,
                    "lead_name": lead_name,
                    "lead_phone": lead_phone,
                    "reach_user": rep_name,
                    "sales_rep_id": cstr(rep_id or ""),
                    "visit_date": cstr(doc.visit_date or ""),
                    "visit_time": cstr(doc.visit_time or ""),
                    "purpose": cstr(doc.purpose or ""),
                    "outcome": cstr(doc.outcome or ""),
                    "visit_status": cstr(getattr(doc, "visit_status", None) or "Completed"),
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
    for optional in ("rep_code", "designation", "territory_region", "user", "phone", "active"):
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
    return rows


def create_assigned_log_visit(lead_id, sales_rep_id, *, assigned_from="FFMS", notes=None, purpose="Meet Lead"):
    """Create a pending Log Visit so it appears immediately in REACH + FFMS."""
    ensure_reach_ffms_visit_fields()
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


def assign_sales_lead_rep(user, lead_id, sales_rep_id, *, create_visit=True, assigned_from=None):
    if user and not is_sales_manager(user) and "System Manager" not in frappe.get_roles(user):
        frappe.throw(_("Only sales managers can assign REACH users"))
    if not frappe.db.exists("Franchise Sales Lead", lead_id):
        frappe.throw(_("Lead not found"))
    if not frappe.db.exists("Sales Rep Profile", sales_rep_id):
        frappe.throw(_("REACH user / sales rep not found"))
    frappe.db.set_value("Franchise Sales Lead", lead_id, "assigned_rep", sales_rep_id)
    frappe.db.commit()
    lead_doc = frappe.get_doc("Franchise Sales Lead", lead_id)
    _sync_sales_lead_to_rfms(lead_doc, sales_rep_id)
    visit_id = None
    if create_visit:
        visit_id = create_assigned_log_visit(
            lead_id,
            sales_rep_id,
            assigned_from=assigned_from or (user or "FFMS"),
        )
    return {"lead_id": lead_id, "assigned_rep": sales_rep_id, "visit_id": visit_id}


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
):
    """FFMS → REACH assignment bridge (HMAC guest caller)."""
    lead_id = resolve_franchise_sales_lead_id(hec_lead_id=hec_lead_id, rfms_lead_id=rfms_lead_id)
    if not lead_id:
        frappe.throw(_("Lead not found on REACH / ERP"))
    role = cstr(assignee_role or "reach").strip().lower().replace(" ", "_")
    if role in ("reach", "sales_rep", "log_visit"):
        if not sales_rep_id:
            frappe.throw(_("sales_rep_id is required for REACH Log Visit assignment"))
        return assign_sales_lead_rep(
            None,
            lead_id,
            sales_rep_id,
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

