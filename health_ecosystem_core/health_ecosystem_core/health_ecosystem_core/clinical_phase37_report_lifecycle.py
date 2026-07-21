"""Phase 37 — Report authorize → dispatch lifecycle for web staff + patient download."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import pretty_date

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase33_journey_ops import (
    JOURNEY_STAFF_ROLES,
)

REPORT_STAFF_ROLES = JOURNEY_STAFF_ROLES | {"Pathologist"}


def _can_view_report_lifecycle(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & REPORT_STAFF_ROLES)


def _journey_row(doc_fields):
    row = dict(doc_fields)
    row["journey_id"] = row.pop("name", None)
    row["ago"] = pretty_date(row.get("modified"))
    trf = row.get("customer_trf")
    if trf:
        row["lab_report"] = frappe.db.get_value("Lab Report", {"customer_trf": trf}, "name")
        row["report_status"] = frappe.db.get_value("Lab Report", {"customer_trf": trf}, "report_status")
    else:
        row["lab_report"] = None
        row["report_status"] = None
    return row


@frappe.whitelist()
def get_report_lifecycle_queue(limit=50, sid=None):
    """Staff queue: Report Review → Authorized → recently Dispatched."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not _can_view_report_lifecycle(roles):
        return _error(_("Not authorized"), 403)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50

    review_fields = [
        "name",
        "patient_name",
        "status",
        "customer_trf",
        "modified",
        "pathologist_notes",
        "authorized_on",
        "report_pdf",
    ]

    review = [
        _journey_row(r)
        for r in frappe.get_all(
            "Patient Care Journey",
            filters={"status": "Report Review"},
            fields=review_fields,
            order_by="modified desc",
            limit=limit,
        )
    ]

    authorized = [
        _journey_row(r)
        for r in frappe.get_all(
            "Patient Care Journey",
            filters={"status": "Authorized"},
            fields=review_fields,
            order_by="modified desc",
            limit=limit,
        )
    ]

    dispatched = [
        _journey_row(r)
        for r in frappe.get_all(
            "Patient Care Journey",
            filters={"status": "Dispatched"},
            fields=review_fields,
            order_by="modified desc",
            limit=min(limit, 20),
        )
    ]

    verified_reports = frappe.get_all(
        "Lab Report",
        filters={"report_status": "Verified"},
        fields=["name", "customer_trf", "care_journey", "report_status", "modified"],
        order_by="modified desc",
        limit=limit,
    )
    verified_rows = []
    for r in verified_reports:
        journey_id = r.get("care_journey") or frappe.db.get_value(
            "Customer TRF", r["customer_trf"], "care_journey"
        )
        verified_rows.append(
            {
                "lab_report": r["name"],
                "trf_id": r["customer_trf"],
                "journey_id": journey_id,
                "report_status": r["report_status"],
                "patient_name": frappe.db.get_value("Customer TRF", r["customer_trf"], "patient_name"),
                "modified": r["modified"],
                "ago": pretty_date(r["modified"]),
            }
        )

    return _success(
        {
            "pending_review": review,
            "verified_reports": verified_rows,
            "authorized": authorized,
            "dispatched": dispatched,
            "counts": {
                "pending_review": len(review),
                "verified_reports": len(verified_rows),
                "authorized": len(authorized),
                "dispatched_recent": len(dispatched),
            },
            "can_authorize": bool(set(roles) & {"Pathologist", "Health System Admin", "System Manager"}),
        }
    )


def setup_phase37_report_lifecycle():
    return {"ok": True, "phase": "37", "feature": "report_lifecycle_web"}
