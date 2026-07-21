"""Phase 49 — Diagnostic workup on e-prescriptions + patient lab booking from Rx."""

from __future__ import annotations

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


@frappe.whitelist()
def search_prescription_diagnostics(q=None, limit=25, sid=None):
    """Autocomplete diagnostic tests for the provider prescription form."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if "Physician" not in _user_roles() and not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)

    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return _success({"diagnostics": []})

    q = (_parse_request_value("q", q) or "").strip()
    filters = {}
    or_filters = None
    if q:
        or_filters = [
            ["name", "like", f"%{q}%"],
            ["test_name", "like", f"%{q}%"],
            ["description", "like", f"%{q}%"],
        ]

    rows = frappe.get_all(
        "Diagnostic Test Master",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "test_name", "department", "item", "description"],
        order_by="test_name asc",
        limit=int(limit or 25),
    )
    for row in rows:
        if row.item:
            row["item_name"] = frappe.db.get_value("Item", row.item, "item_name")
    return _success({"diagnostics": rows})


def setup_phase49_rx_diagnostics():
    frappe.clear_cache(doctype="Clinical Prescription")
    return {"ok": True, "phase": "49", "feature": "rx_diagnostics"}
