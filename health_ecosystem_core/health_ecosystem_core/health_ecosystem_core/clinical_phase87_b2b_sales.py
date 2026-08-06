"""Phase 87 — REACH B2B Collection Centre master + daily B2B sales sync to FFMS / Closing."""

from __future__ import annotations

import json
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today


def _sales_rep_for_user(user):
    user = cstr(user or frappe.session.user)
    if not user or user == "Guest":
        return None
    if frappe.db.exists("Sales Rep Profile", {"user": user}):
        return frappe.db.get_value("Sales Rep Profile", {"user": user}, "name")
    return None


def _require_sales_user(user=None):
    user = cstr(user or frappe.session.user)
    if user in ("", "Guest"):
        frappe.throw(_("Sign in required"), frappe.AuthenticationError)
    return user


def _rfms_post(path, payload):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            get_rfms_api_base_url,
            _franchise_ads_secret,
        )
    except Exception:
        return {"ok": False, "error": "rfms_bridge_unavailable"}
    base = get_rfms_api_base_url()
    if not base:
        return {"ok": False, "error": "rfms_api_base_url missing"}
    secret = _franchise_ads_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if secret:
        headers["X-Franchise-Ads-Secret"] = secret
    try:
        req = Request(f"{base}{path}", data=body, headers=headers, method="POST")
        with urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            data = json.loads(text) if text else {}
            return {"ok": True, "data": data.get("data") if isinstance(data, dict) else data}
    except Exception:
        frappe.log_error(title="b2b_rfms_sync", message=frappe.get_traceback())
        return {"ok": False, "error": "rfms_request_failed"}


def centre_row(doc):
    logistics = []
    for row in doc.get("logistics_assignments") or []:
        logistics.append(
            {
                "person_name": cstr(row.person_name or ""),
                "contact_number": cstr(row.contact_number or ""),
                "pickup_point": cstr(row.pickup_point or ""),
                "logistics_cost": flt(row.logistics_cost),
            }
        )
    return {
        "name": doc.name,
        "centre_name": cstr(doc.centre_name or ""),
        "status": cstr(doc.status or "Active"),
        "wallet_amount": flt(doc.wallet_amount),
        "total_deposit": flt(doc.total_deposit),
        "contact_number": cstr(doc.contact_number or ""),
        "manual_address": cstr(doc.manual_address or ""),
        "google_map_location": cstr(doc.google_map_location or ""),
        "trade_licence": cstr(doc.trade_licence or ""),
        "approved_rate_chart": cstr(doc.approved_rate_chart or ""),
        "created_by_reach_user": cstr(doc.created_by_reach_user or ""),
        "rfms_centre_id": cstr(doc.rfms_centre_id or ""),
        "remarks": cstr(doc.remarks or ""),
        "logistics_assignments": logistics,
        "modified": cstr(doc.modified),
    }


def sales_row(doc):
    return {
        "name": doc.name,
        "sales_date": cstr(doc.sales_date or ""),
        "b2b_collection_centre": cstr(doc.b2b_collection_centre or ""),
        "centre_name": cstr(doc.centre_name or ""),
        "number_of_samples": cint(doc.number_of_samples),
        "business_value": flt(doc.business_value),
        "assigned_logistics_person": cstr(doc.assigned_logistics_person or ""),
        "status": cstr(doc.status or "Submitted"),
        "reach_user": cstr(doc.reach_user or ""),
        "sales_rep": cstr(doc.sales_rep or ""),
        "rfms_sales_id": cstr(doc.rfms_sales_id or ""),
        "closing_report": cstr(doc.closing_report or ""),
        "remarks": cstr(doc.remarks or ""),
        "modified": cstr(doc.modified),
    }


def list_b2b_collection_centres(user=None, limit=100):
    _require_sales_user(user)
    if not frappe.db.exists("DocType", "B2B Collection Centre"):
        return []
    names = frappe.get_all(
        "B2B Collection Centre",
        fields=["name"],
        order_by="modified desc",
        limit=cint(limit) or 100,
    )
    return [centre_row(frappe.get_doc("B2B Collection Centre", row.name)) for row in names]


def create_b2b_collection_centre(user=None, **data):
    user = _require_sales_user(user)
    if not frappe.db.exists("DocType", "B2B Collection Centre"):
        frappe.throw(_("B2B Collection Centre DocType is not installed. Run migrate."))
    centre_name = cstr(data.get("centre_name") or "").strip()
    if not centre_name:
        frappe.throw(_("Collection Centre Name is required"))
    logistics = data.get("logistics_assignments") or data.get("logistics") or []
    if isinstance(logistics, str):
        try:
            logistics = json.loads(logistics)
        except Exception:
            logistics = []
    doc = frappe.get_doc(
        {
            "doctype": "B2B Collection Centre",
            "centre_name": centre_name[:140],
            "status": cstr(data.get("status") or "Active"),
            "wallet_amount": flt(data.get("wallet_amount")),
            "total_deposit": flt(data.get("total_deposit")),
            "contact_number": cstr(data.get("contact_number") or "")[:40],
            "manual_address": cstr(data.get("manual_address") or "")[:1000],
            "google_map_location": cstr(data.get("google_map_location") or "")[:500],
            "trade_licence": cstr(data.get("trade_licence") or ""),
            "approved_rate_chart": cstr(data.get("approved_rate_chart") or ""),
            "created_by_reach_user": user,
            "remarks": cstr(data.get("remarks") or "")[:1000],
            "logistics_assignments": [
                {
                    "person_name": cstr(item.get("person_name") or "")[:140],
                    "contact_number": cstr(item.get("contact_number") or "")[:40],
                    "pickup_point": cstr(item.get("pickup_point") or "")[:200],
                    "logistics_cost": flt(item.get("logistics_cost")),
                }
                for item in logistics
                if isinstance(item, dict) and cstr(item.get("person_name") or "").strip()
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    rfms = _sync_centre_to_rfms(doc)
    if rfms.get("ok") and isinstance(rfms.get("data"), dict):
        centre_id = cstr((rfms["data"].get("centre") or {}).get("id") or rfms["data"].get("id") or "")
        if centre_id:
            doc.db_set("rfms_centre_id", centre_id, update_modified=False)
    frappe.db.commit()
    return {"centre": centre_row(doc.reload()), "rfms": rfms}


def list_b2b_sales_entries(user=None, limit=100, sales_date=None):
    user = _require_sales_user(user)
    if not frappe.db.exists("DocType", "B2B Sales Entry"):
        return []
    filters = {}
    if sales_date:
        filters["sales_date"] = getdate(sales_date)
    # Non-managers see own entries; managers see all
    is_manager = "Sales Manager" in frappe.get_roles(user) or "System Manager" in frappe.get_roles(user)
    if not is_manager:
        filters["reach_user"] = user
    names = frappe.get_all(
        "B2B Sales Entry",
        filters=filters,
        fields=["name"],
        order_by="sales_date desc, modified desc",
        limit=cint(limit) or 100,
    )
    return [sales_row(frappe.get_doc("B2B Sales Entry", row.name)) for row in names]


def submit_b2b_sales_entry(user=None, **data):
    user = _require_sales_user(user)
    if not frappe.db.exists("DocType", "B2B Sales Entry"):
        frappe.throw(_("B2B Sales Entry DocType is not installed. Run migrate."))
    centre_id = cstr(data.get("b2b_collection_centre") or data.get("centre_id") or "").strip()
    if not centre_id or not frappe.db.exists("B2B Collection Centre", centre_id):
        frappe.throw(_("Choose a valid B2B Collection Centre"))
    samples = cint(data.get("number_of_samples") or data.get("samples"))
    value = flt(data.get("business_value") or data.get("total_b2b_business_value"))
    if samples < 0:
        frappe.throw(_("Number of Samples cannot be negative"))
    sales_date = getdate(data.get("sales_date") or data.get("date") or today())
    rep_id = _sales_rep_for_user(user)
    doc = frappe.get_doc(
        {
            "doctype": "B2B Sales Entry",
            "sales_date": sales_date,
            "b2b_collection_centre": centre_id,
            "number_of_samples": samples,
            "business_value": value,
            "assigned_logistics_person": cstr(data.get("assigned_logistics_person") or "")[:140],
            "status": "Submitted",
            "reach_user": user,
            "sales_rep": rep_id,
            "remarks": cstr(data.get("remarks") or "")[:1000],
        }
    )
    doc.insert(ignore_permissions=True)
    closing = attach_b2b_sales_to_closing_draft(user=user, sales_entry=doc)
    if closing.get("report_id"):
        doc.db_set("closing_report", closing["report_id"], update_modified=False)
    rfms = _sync_sales_to_rfms(doc)
    if rfms.get("ok") and isinstance(rfms.get("data"), dict):
        sales_id = cstr((rfms["data"].get("entry") or {}).get("id") or rfms["data"].get("id") or "")
        if sales_id:
            doc.db_set("rfms_sales_id", sales_id, update_modified=False)
    frappe.db.commit()
    return {"entry": sales_row(doc.reload()), "closing": closing, "rfms": rfms}


def _sync_centre_to_rfms(doc):
    return _rfms_post(
        "/b2b-centres/ingest",
        {
            "centres": [
                {
                    "hec_centre_id": doc.name,
                    **{k: v for k, v in centre_row(doc).items() if k != "name"},
                    "name": doc.centre_name,
                }
            ]
        },
    )


def _sync_sales_to_rfms(doc):
    return _rfms_post(
        "/b2b-sales/ingest",
        {
            "entries": [
                {
                    "hec_sales_id": doc.name,
                    "hec_centre_id": cstr(doc.b2b_collection_centre or ""),
                    **{k: v for k, v in sales_row(doc).items() if k != "name"},
                }
            ]
        },
    )


def attach_b2b_sales_to_closing_draft(*, user, sales_entry):
    """Sync submitted B2B sales into the user's Daily Closing draft for expense upload."""
    if not frappe.db.exists("DocType", "Sales Closing Report"):
        return {"ok": False, "reason": "closing_doctype_missing"}
    user = cstr(user or frappe.session.user)
    rep_id = _sales_rep_for_user(user) or cstr(getattr(sales_entry, "sales_rep", None) or "")
    if not rep_id:
        return {"ok": False, "reason": "sales_rep_missing"}
    period = getdate(sales_entry.sales_date or today())
    existing = frappe.db.get_value(
        "Sales Closing Report",
        {"sales_rep": rep_id, "report_type": "Daily", "period_date": period},
        "name",
    )
    note_line = (
        f"B2B sales {sales_entry.name}: {cint(sales_entry.number_of_samples)} samples, "
        f"₹{flt(sales_entry.business_value):.2f} at {cstr(sales_entry.centre_name or sales_entry.b2b_collection_centre)}"
    )
    if existing:
        doc = frappe.get_doc("Sales Closing Report", existing)
        # Locked if docstatus submitted — append note only when draft
        notes = cstr(doc.notes or "")
        if note_line not in notes:
            doc.notes = f"{notes}\n{note_line}".strip()[:4000]
        if hasattr(doc, "franchise_revenue"):
            doc.franchise_revenue = flt(doc.franchise_revenue) + flt(sales_entry.business_value)
        # custom json bag for B2B lines if expense_json used as freeform store
        try:
            bag = json.loads(cstr(doc.expense_json or "") or "{}")
            if not isinstance(bag, dict):
                bag = {"expenses": bag if isinstance(bag, list) else [], "b2b_sales": []}
        except Exception:
            bag = {"expenses": [], "b2b_sales": []}
        bag.setdefault("b2b_sales", [])
        bag["b2b_sales"].append(sales_row(sales_entry))
        doc.expense_json = json.dumps(bag, ensure_ascii=False)[:100000]
        doc.save(ignore_permissions=True)
        return {"ok": True, "report_id": doc.name, "created": False}

    # Create draft daily closing so expense upload can attach on same submission path
    doc = frappe.get_doc(
        {
            "doctype": "Sales Closing Report",
            "sales_rep": rep_id,
            "report_type": "Daily",
            "period_date": period,
            "visits_count": 0,
            "new_leads": 0,
            "qualified_leads": 0,
            "onboardings": 0,
            "franchise_revenue": flt(sales_entry.business_value),
            "notes": note_line,
            "expense_json": json.dumps({"expenses": [], "b2b_sales": [sales_row(sales_entry)]}, ensure_ascii=False),
        }
    )
    doc.insert(ignore_permissions=True)
    return {"ok": True, "report_id": doc.name, "created": True}


def b2b_closing_summary_for_draft(user, period_date=None):
    """Used by closing draft UI to show auto-synced B2B totals."""
    user = _require_sales_user(user)
    if not frappe.db.exists("DocType", "B2B Sales Entry"):
        return {"samples": 0, "business_value": 0, "entries": 0, "new_centres": 0}
    period = getdate(period_date or today())
    filters = {"sales_date": period, "reach_user": user, "status": ("in", ["Submitted", "Verified"])}
    rows = frappe.get_all(
        "B2B Sales Entry",
        filters=filters,
        fields=["number_of_samples", "business_value"],
    )
    centres = 0
    if frappe.db.exists("DocType", "B2B Collection Centre"):
        centres = frappe.db.count(
            "B2B Collection Centre",
            {"created_by_reach_user": user, "creation": ("between", [f"{period} 00:00:00", f"{period} 23:59:59"])},
        )
    return {
        "samples": sum(cint(r.number_of_samples) for r in rows),
        "business_value": sum(flt(r.business_value) for r in rows),
        "entries": len(rows),
        "new_centres": centres,
    }


def ffms_update_b2b_sales_status(*, hec_sales_id=None, status=None, assigned_logistics_person=None, remarks=None):
    sales_id = cstr(hec_sales_id or "").strip()
    if not sales_id or not frappe.db.exists("B2B Sales Entry", sales_id):
        return {"ok": False, "skipped": True}
    values = {}
    if status:
        values["status"] = cstr(status)[:40]
    if assigned_logistics_person is not None:
        values["assigned_logistics_person"] = cstr(assigned_logistics_person)[:140]
    if remarks is not None:
        values["remarks"] = cstr(remarks)[:1000]
    if values:
        frappe.db.set_value("B2B Sales Entry", sales_id, values)
        frappe.db.commit()
    return {"ok": True, "sales_id": sales_id, **values}


def ffms_update_b2b_centre(*, hec_centre_id=None, status=None, logistics_assignments=None):
    centre_id = cstr(hec_centre_id or "").strip()
    if not centre_id or not frappe.db.exists("B2B Collection Centre", centre_id):
        return {"ok": False, "skipped": True}
    doc = frappe.get_doc("B2B Collection Centre", centre_id)
    if status:
        doc.status = cstr(status)[:40]
    if logistics_assignments is not None:
        if isinstance(logistics_assignments, str):
            try:
                logistics_assignments = json.loads(logistics_assignments)
            except Exception:
                logistics_assignments = []
        doc.set("logistics_assignments", [])
        for item in logistics_assignments or []:
            if not isinstance(item, dict):
                continue
            if not cstr(item.get("person_name") or "").strip():
                continue
            doc.append(
                "logistics_assignments",
                {
                    "person_name": cstr(item.get("person_name"))[:140],
                    "contact_number": cstr(item.get("contact_number") or "")[:40],
                    "pickup_point": cstr(item.get("pickup_point") or "")[:200],
                    "logistics_cost": flt(item.get("logistics_cost")),
                },
            )
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "centre": centre_row(doc)}
