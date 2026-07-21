"""Phase 33 — Care journey workflow polish: guided transitions, activity log, ops board."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import now_datetime, pretty_date

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_journey import (
    JOURNEY_STATES,
    advance_journey,
    journey_report_payload,
)

# Roles allowed to move a journey through the pipeline.
JOURNEY_STAFF_ROLES = {
    "Health System Admin",
    "System Manager",
    "Franchisee Operator",
    "Lab Technician",
    "Physician",
    "Nurse",
    "Phlebotomist",
    "Pathologist",
}

# Only these roles can jump/skip stages or move a journey backward.
JOURNEY_ADMIN_ROLES = {"Health System Admin", "System Manager"}

ACTIVE_STATES = [s for s in JOURNEY_STATES if s not in ("Authorized", "Dispatched")]


def _journey_index(status):
    try:
        return JOURNEY_STATES.index(status)
    except ValueError:
        return -1


def _can_manage_journeys(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & JOURNEY_STAFF_ROLES)


def _is_journey_admin(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & JOURNEY_ADMIN_ROLES)


def log_journey_activity(journey_name, message, from_status=None, to_status=None):
    """Append a lightweight audit note to a journey (rendered as a timeline)."""
    if not journey_name:
        return
    if from_status and to_status:
        content = f"{message}: {from_status} → {to_status}"
    else:
        content = message
    try:
        frappe.get_doc(
            {
                "doctype": "Comment",
                "comment_type": "Info",
                "reference_doctype": "Patient Care Journey",
                "reference_name": journey_name,
                "content": content,
            }
        ).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="log_journey_activity", message=frappe.get_traceback())


def next_journey_status(current):
    idx = _journey_index(current)
    if idx < 0 or idx >= len(JOURNEY_STATES) - 1:
        return None
    return JOURNEY_STATES[idx + 1]


@frappe.whitelist()
def journey_transition(journey_id=None, to_status=None, phlebotomist=None, notes=None, sid=None):
    """Guided journey transition with role checks and activity logging.

    - Forward by exactly one stage: any journey staff role.
    - Skipping stages or moving backward: admin only.
    - Entering "Phlebotomist Assigned" requires a phlebotomist.
    """
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not _can_manage_journeys(roles):
        return _error(_("You are not allowed to manage care journeys"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    to_status = _parse_request_value("to_status", to_status)
    phlebotomist = _parse_request_value("phlebotomist", phlebotomist)
    notes = _parse_request_value("notes", notes)

    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return _error(_("Journey not found"), 404)
    if to_status not in JOURNEY_STATES:
        return _error(_("Invalid target status"))

    current = frappe.db.get_value("Patient Care Journey", journey_id, "status")
    cur_idx = _journey_index(current)
    tgt_idx = _journey_index(to_status)

    if tgt_idx == cur_idx:
        return _error(_("Journey is already at {0}").format(to_status))

    is_admin = _is_journey_admin(roles)
    if not is_admin and tgt_idx != cur_idx + 1:
        if tgt_idx < cur_idx:
            return _error(_("Only an administrator can move a journey backward"), 403)
        return _error(_("Complete the pipeline one step at a time"), 403)

    updates = {}
    if to_status == "Phlebotomist Assigned":
        if not phlebotomist:
            return _error(_("Select a phlebotomist to assign"))
        if not frappe.db.exists("User", phlebotomist):
            return _error(_("Phlebotomist user not found"), 404)
        updates["phlebotomist"] = phlebotomist
    if notes:
        updates["pathologist_notes"] = notes

    advance_journey(journey_id, to_status, **updates)

    actor = frappe.session.user
    verb = "Moved" if tgt_idx > cur_idx else "Reverted"
    log_journey_activity(
        journey_id,
        f"{verb} by {actor}",
        from_status=current,
        to_status=to_status,
    )
    if updates.get("phlebotomist"):
        log_journey_activity(journey_id, f"Phlebotomist assigned: {updates['phlebotomist']}")
        _notify_phlebotomist_assignment(journey_id, updates["phlebotomist"])

    frappe.db.commit()
    return _success(
        {"journey": journey_report_payload(journey_id)},
        message=_("Journey moved to {0}").format(to_status),
    )


@frappe.whitelist()
def assign_journey_phlebotomist(journey_id=None, phlebotomist=None, sid=None):
    """Assign a phlebotomist and advance the journey to Phlebotomist Assigned."""
    return journey_transition(
        journey_id=journey_id,
        to_status="Phlebotomist Assigned",
        phlebotomist=phlebotomist,
        sid=sid,
    )


def _notify_phlebotomist_assignment(journey_id, phlebotomist):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
            notify_phlebotomist_assigned,
            queue_patient_notification,
        )

        journey = frappe.db.get_value(
            "Patient Care Journey",
            journey_id,
            ["patient_name", "customer_trf"],
            as_dict=True,
        )
        trf = journey.customer_trf if journey else None
        if trf:
            notify_phlebotomist_assigned(trf, phlebotomist)
            return

        queue_patient_notification(
            "phlebo_assigned_patient",
            patient_name=journey.patient_name if journey else "",
            patient_phone="",
            trf_id=journey_id,
            collection_slot="",
            collection_address="",
        )
    except Exception:
        frappe.log_error(title="notify_phlebo_assignment", message=frappe.get_traceback())


@frappe.whitelist()
def list_active_phlebotomists(sid=None):
    """Enabled users with the Phlebotomist role — for assignment dropdowns."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_manage_journeys():
        return _error(_("Not authorized"), 403)

    rows = frappe.get_all(
        "Has Role",
        filters={"role": "Phlebotomist", "parenttype": "User"},
        fields=["parent as user"],
    )
    users = []
    seen = set()
    for row in rows:
        if row.user in seen:
            continue
        seen.add(row.user)
        info = frappe.db.get_value("User", row.user, ["full_name", "enabled"], as_dict=True)
        if info and info.enabled:
            users.append({"user": row.user, "full_name": info.full_name or row.user})
    return _success({"phlebotomists": users})


@frappe.whitelist()
def get_journey_activity(journey_id=None, sid=None):
    """Timeline of transitions/notes for a journey."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    journey_id = _parse_request_value("journey_id", journey_id)
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return _error(_("Journey not found"), 404)

    rows = frappe.get_all(
        "Comment",
        filters={
            "reference_doctype": "Patient Care Journey",
            "reference_name": journey_id,
            "comment_type": "Info",
        },
        fields=["content", "owner", "creation"],
        order_by="creation desc",
        limit=50,
    )
    activity = [
        {
            "content": row.content,
            "owner": row.owner,
            "creation": str(row.creation),
            "ago": pretty_date(row.creation),
        }
        for row in rows
    ]
    return _success({"activity": activity})


@frappe.whitelist()
def get_journey_ops_board(limit=200, sid=None):
    """Active journeys grouped by stage for the staff web queue."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not _can_manage_journeys(roles):
        return _error(_("Not authorized"), 403)

    filters = {"status": ["in", ACTIVE_STATES]}
    # Phlebotomists (without admin/ops rights) only see their own assignments.
    if "Phlebotomist" in roles and not (set(roles) & (JOURNEY_ADMIN_ROLES | {"Franchisee Operator", "Lab Technician"})):
        filters["phlebotomist"] = frappe.session.user

    rows = frappe.get_all(
        "Patient Care Journey",
        filters=filters,
        fields=[
            "name",
            "patient_name",
            "status",
            "customer_trf",
            "appointment",
            "prescription",
            "pharmacy_order",
            "phlebotomist",
            "modified",
        ],
        order_by="modified desc",
        limit=int(limit or 200),
    )
    for row in rows:
        row["next_status"] = next_journey_status(row["status"])
        row["ago"] = pretty_date(row["modified"])

    counts = {state: 0 for state in ACTIVE_STATES}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    return _success(
        {
            "journeys": rows,
            "stage_counts": counts,
            "stages": ACTIVE_STATES,
            "can_admin": _is_journey_admin(roles),
        }
    )


def setup_phase33_journey_ops():
    """No schema changes — journey activity uses the standard Comment doctype."""
    return {"ok": True, "phase": "33", "feature": "journey_ops_workflow"}
