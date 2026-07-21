"""Phase 52 — Staff gamification dashboard on web portal (leaderboards + my points)."""

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

WEB_GAMIFICATION_ROLES = frozenset(
    {
        "System Manager",
        "Health System Admin",
        "Healthcare Administrator",
        "HR Manager",
        "Lab Technician",
        "Pathologist",
        "Phlebotomist",
        "Franchisee Operator",
        "Physician",
        "Nurse",
        "Sales Representative",
        "Sales Manager",
    }
)


def _can_view_gamification(roles):
    if is_staff(roles):
        return True
    return bool(set(roles or []) & WEB_GAMIFICATION_ROLES)


@frappe.whitelist()
def get_staff_gamification_dashboard(limit=10, sid=None):
    """Web/mobile session API for employee leaderboard and personal stats."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    roles = _user_roles()
    if not _can_view_gamification(roles):
        return _error(_("Not authorized"), 403)

    if not frappe.db.exists("DocType", "Employee Gamification Rule"):
        return _error(_("Gamification module not installed"), 503)

    limit = int(_parse_request_value("limit", limit) or 10)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification import (
        build_gamification_dashboard,
        get_my_gamification_stats,
    )

    payload = build_gamification_dashboard(limit=limit)
    payload["my_stats"] = get_my_gamification_stats()
    payload["desk_url"] = "/app/employee-gamification"
    return _success(payload)


def setup_phase52_staff_gamification_web():
    return {"ok": True, "phase": "52", "feature": "staff_gamification_web"}
