"""REACH Flutter app API compatibility — smoke + method matrix.

Maps gap-report names (Flutter v0.3.1) to live whitelisted methods on
`health_ecosystem_core.health_ecosystem_core.api`.
"""

from __future__ import annotations

import frappe
from frappe import _

# Flutter gap-report name → canonical (or alias) method on api.py
REACH_APP_METHOD_MATRIX = (
    # Working on web already
    ("get_sales_portal", "get_sales_portal", "canonical"),
    ("get_sales_profile_dashboard", "get_sales_profile_dashboard", "canonical"),
    ("get_sales_leads", "get_sales_leads", "canonical"),
    ("create_sales_lead", "create_sales_lead", "canonical"),
    ("log_sales_visit", "log_sales_visit", "canonical"),
    ("get_sales_visits", "get_sales_visits", "canonical"),
    ("get_sales_catalog", "get_sales_catalog", "canonical"),
    ("get_sales_commissions", "get_sales_commissions", "canonical"),
    ("get_sales_team_map", "get_sales_team_map", "canonical"),
    ("get_sales_franchisee_stats", "get_sales_franchisee_stats", "canonical"),
    ("submit_sales_onboarding", "submit_sales_onboarding", "canonical"),
    ("draft_sales_closing_report", "draft_sales_closing_report", "canonical"),
    ("get_sales_closing_reports", "get_sales_closing_reports", "canonical"),
    ("submit_sales_closing_report", "submit_sales_closing_report", "canonical"),
    ("list_b2b_collection_centres", "list_b2b_collection_centres", "canonical"),
    ("list_b2b_sales_entries", "list_b2b_sales_entries", "canonical"),
    ("submit_b2b_sales_entry", "submit_b2b_sales_entry", "canonical"),
    # Flutter aliases (were 417)
    ("get_b2b_centre", "get_b2b_centre", "alias→list_b2b_collection_centres"),
    ("get_daily_sales_entry", "get_daily_sales_entry", "alias→list_b2b_sales_entries"),
    ("submit_daily_sales", "submit_daily_sales", "alias→submit_b2b_sales_entry"),
    ("get_sales_closing", "get_sales_closing", "alias→get_sales_closing_reports"),
    ("submit_sales_closing", "submit_sales_closing", "alias→submit_sales_closing_report"),
    ("get_sales_onboarding", "get_sales_onboarding", "new list API"),
    ("get_sales_franchisee_list", "get_sales_franchisee_list", "new list API"),
    ("update_sales_lead", "update_sales_lead", "new update API"),
)


def smoke_reach_app_api_compat(as_user=None):
    """Verify aliases exist and return 200-shaped payloads for a sales user."""
    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    as_user = as_user or "sales_rep1@health.local"
    out = {
        "ok": True,
        "as_user": as_user,
        "matrix": [],
        "probes": [],
    }

    for gap_name, method, note in REACH_APP_METHOD_MATRIX:
        exists = hasattr(api_mod, method)
        out["matrix"].append(
            {
                "gap_report_name": gap_name,
                "live_method": f"health_ecosystem_core.health_ecosystem_core.api.{method}",
                "note": note,
                "whitelisted": exists,
            }
        )
        if not exists:
            out["ok"] = False

    if not frappe.db.exists("User", as_user):
        out["ok"] = False
        out["probes"].append({"error": f"user {as_user} missing"})
        return out

    frappe.set_user(as_user)
    try:
        probes = [
            ("get_sales_portal", lambda: api_mod.get_sales_portal()),
            ("get_sales_closing", lambda: api_mod.get_sales_closing(limit=5)),
            ("get_b2b_centre", lambda: api_mod.get_b2b_centre(limit=20)),
            ("get_daily_sales_entry", lambda: api_mod.get_daily_sales_entry(limit=20)),
            ("get_sales_onboarding", lambda: api_mod.get_sales_onboarding(limit=20)),
            ("get_sales_franchisee_list", lambda: api_mod.get_sales_franchisee_list(period="month")),
            ("draft_sales_closing_report", lambda: api_mod.draft_sales_closing_report(report_type="Daily")),
            ("get_sales_leads", lambda: api_mod.get_sales_leads(limit=5)),
        ]
        for name, fn in probes:
            try:
                res = fn()
                # _success envelope: {"success": True, "data": ...} or similar
                ok = bool(res) and not (isinstance(res, dict) and res.get("success") is False)
                if isinstance(res, dict) and res.get("exc_type"):
                    ok = False
                status = None
                if isinstance(res, dict):
                    status = res.get("http_status") or (200 if res.get("success", True) else res.get("status_code"))
                out["probes"].append(
                    {
                        "method": name,
                        "ok": ok,
                        "keys": list((res.get("data") or res).keys())
                        if isinstance(res, dict) and isinstance(res.get("data") or res, dict)
                        else type(res).__name__,
                        "message": (res.get("message") if isinstance(res, dict) else None),
                        "status": status,
                    }
                )
                if not ok:
                    out["ok"] = False
            except Exception as exc:
                out["ok"] = False
                out["probes"].append({"method": name, "ok": False, "error": str(exc)})
    finally:
        frappe.set_user("Administrator")

    return out
