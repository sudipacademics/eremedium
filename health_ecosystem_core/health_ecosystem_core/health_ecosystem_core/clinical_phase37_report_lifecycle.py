"""Phase 37 — Report authorize → dispatch lifecycle for web staff + patient download."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, now_datetime, nowdate, pretty_date, time_diff_in_hours

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

REPORT_STAFF_ROLES = JOURNEY_STAFF_ROLES | {
    "Pathologist",
    "Lab Manager",
    "Quality Control Manager",
}
# Sign & finalize: Lab Manager + QC Manager (HR LabTech user types) and legacy Pathologist / admins.
PATHOLOGIST_ACT_ROLES = {
    "Lab Manager",
    "Quality Control Manager",
    "Pathologist",
    "Health System Admin",
    "System Manager",
}

READY_PREFIX = "[PATH-DRAFT]"
SEND_BACK_PREFIX = "[PATH-SEND-BACK]"


def _can_view_report_lifecycle(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & REPORT_STAFF_ROLES)


def _trf_tests(trf_id):
    if not trf_id:
        return None
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

        labels = [t.get("item_name") for t in get_trf_test_lines(trf_id) if t.get("item_name")]
        return ", ".join(labels) or None
    except Exception:
        return None


def _journey_row(doc_fields):
    row = dict(doc_fields)
    row["journey_id"] = row.pop("name", None)
    row["ago"] = pretty_date(row.get("modified"))
    trf = row.get("customer_trf")
    row["tests"] = _trf_tests(trf)
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
                "tests": _trf_tests(r["customer_trf"]),
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
                "dispatched_7d": frappe.db.count(
                    "Patient Care Journey",
                    {"status": "Dispatched", "modified": [">=", add_days(nowdate(), -7)]},
                ),
            },
            "can_authorize": bool(set(roles) & PATHOLOGIST_ACT_ROLES),
        }
    )


def _can_act_pathologist(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & PATHOLOGIST_ACT_ROLES)


def _strip_stage_notes(notes):
    text = (notes or "").strip()
    for prefix in (READY_PREFIX, SEND_BACK_PREFIX):
        if text.startswith(prefix):
            return text[len(prefix) :].lstrip("\n :")
    return text


def _tat_hours(since):
    if not since:
        return None
    try:
        return max(0.0, float(time_diff_in_hours(now_datetime(), since)))
    except Exception:
        return None


def _tat_label(hours):
    if hours is None:
        return None
    if hours < 1:
        mins = max(1, int(round(hours * 60)))
        return f"{mins}m"
    total_h = int(hours)
    mins = int(round((hours - total_h) * 60))
    if total_h >= 24:
        days = total_h // 24
        rem = total_h % 24
        return f"{days}d {rem}h" if rem else f"{days}d"
    if mins:
        return f"{total_h}h {mins}m"
    return f"{total_h}h"


def _priority_for(hours, overdue):
    if overdue or (hours is not None and hours >= 24):
        return "STAT"
    if hours is not None and hours >= 12:
        return "High"
    return "Routine"


def _review_stage(journey_status, notes, report_status):
    notes = notes or ""
    if journey_status in ("Authorized", "Dispatched"):
        return "signed"
    if journey_status == "In Lab" and notes.startswith(SEND_BACK_PREFIX):
        return "sent_back"
    if journey_status == "Report Review" or report_status == "Verified":
        if notes.startswith(READY_PREFIX):
            return "ready_for_sign"
        return "pending_review"
    return None


def _age_gender(trf):
    if not trf:
        return None
    years = trf.get("age")
    months = trf.get("age_months")
    gender = (trf.get("gender") or "").strip()
    parts = []
    try:
        if years not in (None, ""):
            parts.append(str(int(years)))
        elif months not in (None, "") and int(months):
            parts.append(f"{int(months)}m")
    except (TypeError, ValueError):
        if years not in (None, ""):
            parts.append(str(years))
    if gender:
        parts.append(gender[:1].upper() if len(gender) > 1 else gender.upper())
    return " / ".join(parts) if parts else None


def _pathologist_row(journey=None, report=None, trf=None):
    journey = journey or {}
    report = report or {}
    trf = trf or {}
    journey_id = journey.get("name") or journey.get("journey_id") or report.get("care_journey")
    trf_id = journey.get("customer_trf") or report.get("customer_trf") or trf.get("name")
    notes = journey.get("pathologist_notes") or ""
    status = journey.get("status")
    report_status = report.get("report_status")
    stage = _review_stage(status, notes, report_status)
    sample_date = report.get("sample_date") or trf.get("collection_slot") or report.get("modified") or journey.get("modified")
    hours = _tat_hours(sample_date) or _tat_hours(report.get("modified") or journey.get("modified"))
    overdue = bool(hours is not None and hours >= 24 and stage in ("pending_review", "ready_for_sign"))
    tests = _trf_tests(trf_id)
    modified = report.get("modified") or journey.get("modified")
    return {
        "journey_id": journey_id,
        "lab_report": report.get("name") or report.get("lab_report"),
        "trf_id": trf_id,
        "patient_name": journey.get("patient_name") or trf.get("patient_name") or report.get("patient_name"),
        "age_gender": _age_gender(trf) or report.get("age_gender"),
        "gender": trf.get("gender") or report.get("gender"),
        "tests": tests,
        "sample_date": str(sample_date) if sample_date else None,
        "status": status,
        "report_status": report_status,
        "stage": stage,
        "stage_label": {
            "pending_review": "Pending Review",
            "ready_for_sign": "Ready for Sign",
            "sent_back": "Sent Back",
            "signed": "Signed",
        }.get(stage) or report_status or status,
        "tat": _tat_label(hours),
        "tat_hours": round(hours, 2) if hours is not None else None,
        "overdue": overdue,
        "priority": _priority_for(hours, overdue),
        "pathologist_notes": _strip_stage_notes(notes),
        "send_back_reason": _strip_stage_notes(notes) if notes.startswith(SEND_BACK_PREFIX) else None,
        "authorized_on": str(journey.get("authorized_on")) if journey.get("authorized_on") else None,
        "modified": str(modified) if modified else None,
        "ago": pretty_date(modified) if modified else None,
        "signed_today": bool(
            journey.get("authorized_on") and str(journey.get("authorized_on"))[:10] == nowdate()
        ),
    }


def _trf_map(ids):
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = frappe.get_all(
        "Customer TRF",
        filters={"name": ["in", ids]},
        fields=["name", "patient_name", "age", "age_months", "age_days", "gender", "collection_slot", "care_journey"],
    )
    return {r["name"]: r for r in rows}


def _report_map(trf_ids=None, names=None):
    filters = {}
    if trf_ids:
        filters["customer_trf"] = ["in", [i for i in trf_ids if i] or [""]]
    if names:
        filters["name"] = ["in", [i for i in names if i] or [""]]
    if not filters:
        return {}
    rows = frappe.get_all(
        "Lab Report",
        filters=filters,
        fields=[
            "name",
            "customer_trf",
            "care_journey",
            "report_status",
            "sample_date",
            "modified",
            "patient_name",
            "age",
            "gender",
        ],
    )
    by_trf = {}
    by_name = {}
    for r in rows:
        by_name[r["name"]] = r
        if r.get("customer_trf"):
            by_trf[r["customer_trf"]] = r
    return {"by_trf": by_trf, "by_name": by_name}


@frappe.whitelist()
def get_pathologist_queue(limit=200, sid=None):
    """Pathologist worklist: pending review, ready for sign, sent back, signed, overdue."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if not _can_view_report_lifecycle(roles):
        return _error(_("Not authorized"), 403)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 200
    limit = min(max(limit, 1), 400)

    journey_fields = [
        "name",
        "patient_name",
        "status",
        "customer_trf",
        "modified",
        "pathologist_notes",
        "authorized_on",
    ]
    journeys = []
    for status, cap in (
        ("Report Review", limit),
        ("In Lab", limit),
        ("Authorized", limit),
        ("Dispatched", min(limit, 50)),
    ):
        journeys.extend(
            frappe.get_all(
                "Patient Care Journey",
                filters={"status": status},
                fields=journey_fields,
                order_by="modified desc",
                limit=cap,
            )
        )
    verified = frappe.get_all(
        "Lab Report",
        filters={"report_status": "Verified"},
        fields=[
            "name",
            "customer_trf",
            "care_journey",
            "report_status",
            "sample_date",
            "modified",
            "patient_name",
            "age",
            "gender",
        ],
        order_by="modified desc",
        limit=limit,
    )

    trf_ids = [j.get("customer_trf") for j in journeys] + [r.get("customer_trf") for r in verified]
    trfs = _trf_map(trf_ids)
    reports = _report_map(trf_ids=trf_ids)
    by_trf = reports["by_trf"]
    for r in verified:
        by_trf[r["customer_trf"]] = r
        reports["by_name"][r["name"]] = r

    items = []
    seen = set()

    def _add(row):
        if not row or not row.get("stage"):
            return
        key = row.get("journey_id") or row.get("lab_report") or row.get("trf_id")
        if not key or key in seen:
            return
        seen.add(key)
        items.append(row)

    for j in journeys:
        report = by_trf.get(j.get("customer_trf")) or {}
        trf = trfs.get(j.get("customer_trf")) or {}
        _add(_pathologist_row(journey=j, report=report, trf=trf))

    for r in verified:
        key = r.get("care_journey") or r.get("customer_trf") or r["name"]
        if key in seen:
            continue
        journey = {}
        if r.get("care_journey") and frappe.db.exists("Patient Care Journey", r["care_journey"]):
            journey = frappe.db.get_value(
                "Patient Care Journey",
                r["care_journey"],
                journey_fields,
                as_dict=True,
            ) or {}
        trf = trfs.get(r.get("customer_trf")) or {}
        _add(_pathologist_row(journey=journey, report=r, trf=trf))

    items.sort(key=lambda r: r.get("modified") or "", reverse=True)
    items = items[:limit]

    counts = {
        "pending_review": 0,
        "ready_for_sign": 0,
        "sent_back": 0,
        "signed": 0,
        "signed_today": 0,
        "overdue": 0,
    }
    for row in items:
        stage = row.get("stage")
        if stage in counts:
            counts[stage] += 1
        if row.get("signed_today"):
            counts["signed_today"] += 1
        if row.get("overdue"):
            counts["overdue"] += 1

    return _success(
        {
            "items": items,
            "counts": counts,
            "can_act": _can_act_pathologist(roles),
        }
    )


def _load_journey_for_review(journey_id=None, lab_report=None):
    journey_id = _parse_request_value("journey_id", journey_id)
    lab_report = _parse_request_value("lab_report", lab_report)
    if not journey_id and lab_report:
        journey_id = frappe.db.get_value("Lab Report", lab_report, "care_journey")
        if not journey_id:
            trf = frappe.db.get_value("Lab Report", lab_report, "customer_trf")
            if trf:
                journey_id = frappe.db.get_value("Customer TRF", trf, "care_journey")
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return None, _error(_("Journey not found"), 404)
    return frappe.get_doc("Patient Care Journey", journey_id), None


def _persist_report_remarks(lab_report, remarks):
    """Write pathologist remarks onto Lab Report.comments so preview/PDF stay in sync."""
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return None
    status = frappe.db.get_value("Lab Report", lab_report, "report_status")
    if status in ("Authorized", "Printed"):
        return lab_report
    frappe.db.set_value("Lab Report", lab_report, "comments", remarks or "")
    return lab_report


def _ensure_review_journey(journey_id=None, lab_report=None, trf_id=None):
    """Resolve the care journey for a report, linking/creating it when the TRF has one missing."""
    doc, err = _load_journey_for_review(journey_id, lab_report)
    if doc:
        return doc, None

    lab_report = _parse_request_value("lab_report", lab_report)
    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id and lab_report and frappe.db.exists("Lab Report", lab_report):
        trf_id = frappe.db.get_value("Lab Report", lab_report, "customer_trf")
    if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
        return None, err or _error(_("Journey not found"), 404)

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import (
        advance_journey,
        sync_journey_from_trf,
    )

    try:
        sync_journey_from_trf(trf_id, "Completed")
    except Exception:
        frappe.log_error(title="pathologist ensure journey", message=frappe.get_traceback())

    journey_id = frappe.db.get_value("Customer TRF", trf_id, "care_journey")
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return None, _error(_("No care journey is linked to this report. Open Report Lifecycle or Result Entry first."), 404)

    status = frappe.db.get_value("Patient Care Journey", journey_id, "status")
    if status not in ("Authorized", "Dispatched", "Report Review"):
        try:
            advance_journey(journey_id, "Report Review")
        except Exception:
            frappe.log_error(title="pathologist advance review", message=frappe.get_traceback())

    if lab_report and frappe.db.exists("Lab Report", lab_report):
        frappe.db.set_value("Lab Report", lab_report, "care_journey", journey_id, update_modified=False)

    return frappe.get_doc("Patient Care Journey", journey_id), None


@frappe.whitelist()
def pathologist_save_draft(journey_id=None, lab_report=None, remarks=None, sid=None):
    """Keep pathologist remarks and mark the report ready for digital sign."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_act_pathologist():
        return _error(_("Only Lab Manager or Quality Control Manager can save review drafts"), 403)

    lab_report = _parse_request_value("lab_report", lab_report)
    remarks = (_parse_request_value("remarks", remarks) or "").strip()
    saved_report = _persist_report_remarks(lab_report, remarks)

    doc, err = _ensure_review_journey(journey_id, lab_report)
    if err:
        if saved_report:
            frappe.db.commit()
            return _success(
                {"journey_id": None, "lab_report": saved_report, "stage": "pending_review"},
                message="Remarks saved with the report",
            )
        return err
    if doc.status in ("Authorized", "Dispatched"):
        return _error(_("Report is already signed"), 409)

    doc.pathologist_notes = f"{READY_PREFIX}\n{remarks}".strip()
    doc.save(ignore_permissions=True)
    _log_pathologist_activity(doc.name, "Pathologist saved review draft", doc.status, doc.status)
    frappe.db.commit()
    return _success(
        {
            "journey_id": doc.name,
            "lab_report": lab_report or frappe.db.get_value("Lab Report", {"customer_trf": doc.customer_trf}, "name"),
            "stage": "ready_for_sign",
        },
        message="Remarks saved with the report",
    )


@frappe.whitelist()
def pathologist_send_back(journey_id=None, lab_report=None, reason=None, sid=None):
    """Return a report to lab technicians for correction. Reason is required."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_act_pathologist():
        return _error(_("Only Lab Manager or Quality Control Manager can send reports back"), 403)

    reason = (_parse_request_value("reason", reason) or "").strip()
    if not reason:
        return _error(_("A send-back reason is required"), 400)

    doc, err = _ensure_review_journey(journey_id, lab_report)
    if err:
        return err
    if doc.status in ("Authorized", "Dispatched"):
        return _error(_("Signed reports cannot be sent back"), 409)

    prev = doc.status
    doc.pathologist_notes = f"{SEND_BACK_PREFIX}\n{reason}"
    doc.status = "In Lab"
    doc.save(ignore_permissions=True)

    trf = doc.customer_trf
    if trf and frappe.db.exists("Customer TRF", trf):
        frappe.db.set_value("Customer TRF", trf, "order_status", "In Lab")
        lab_name = frappe.db.get_value("Lab Report", {"customer_trf": trf}, "name")
        if lab_name:
            frappe.db.set_value("Lab Report", lab_name, "report_status", "In Progress")

    _log_pathologist_activity(
        doc.name,
        f"Pathologist sent report back: {reason}",
        prev,
        "In Lab",
    )
    frappe.db.commit()
    return _success({"journey_id": doc.name, "stage": "sent_back"}, message="Report sent back to lab")


@frappe.whitelist()
def pathologist_finalize(journey_id=None, lab_report=None, remarks=None, sid=None):
    """Sign and finalize: persist remarks, authorize journey, lock Lab Report as Authorized."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_act_pathologist():
        return _error(_("Only Lab Manager or Quality Control Manager can sign and finalize reports"), 403)

    lab_report = _parse_request_value("lab_report", lab_report)
    remarks = (_parse_request_value("remarks", remarks) or "").strip()
    _persist_report_remarks(lab_report, remarks)

    doc, err = _ensure_review_journey(journey_id, lab_report)
    if err:
        return err
    if doc.status in ("Authorized", "Dispatched"):
        return _error(_("Report is already signed"), 409)

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import authorize_lab_report

    result = authorize_lab_report(journey_id=doc.name, pathologist_notes=remarks)
    if isinstance(result, dict) and result.get("status") == "error":
        return result
    return _success(
        {
            "journey_id": doc.name,
            "lab_report": lab_report or frappe.db.get_value("Lab Report", {"customer_trf": doc.customer_trf}, "name"),
            "stage": "signed",
            "report_status": "Authorized",
            "status": "Authorized",
        },
        message="Report signed and finalized",
    )


def _log_pathologist_activity(journey_id, message, from_status=None, to_status=None):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_journey import _log_journey_activity

        _log_journey_activity(journey_id, message, from_status, to_status)
    except Exception:
        frappe.log_error(title="pathologist activity", message=frappe.get_traceback())


def setup_phase37_report_lifecycle():
    return {"ok": True, "phase": "37", "feature": "report_lifecycle_web"}
