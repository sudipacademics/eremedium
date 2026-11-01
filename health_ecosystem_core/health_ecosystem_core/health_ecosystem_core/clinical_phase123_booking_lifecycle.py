"""Phase 123 — Booking lifecycle (All Bookings) derived from existing records.

`Customer TRF` stays the single source of truth for a booking. The lifecycle
status is computed on read from the records the lab already writes:

    Customer TRF (order_status, sample_rejected)
    TRF Collection Tube (Drawn / Received / Rejected + timestamps)
    Lab Test Result / Lab Report Parameter (results entered)
    Lab Report (Draft / In Progress / Verified / Authorized / Printed)
    Patient Care Journey (Report Review / Authorized / Dispatched)
    Sample Rejection Record

Nothing here writes booking data.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, getdate

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)

STAGES = (
    "Booked",
    "Sample Collected",
    "In Lab",
    "Processing",
    "Result Ready",
    "Authorized",
    "Dispatched",
    "Delivered",
)
TERMINAL_STATUSES = ("Rejected", "Cancelled")
ALL_STATUSES = STAGES + TERMINAL_STATUSES
STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}

STAFF_ROLES = {"Health System Admin", "System Manager", "Lab Technician", "Pathologist"}
FRANCHISEE_ROLE = "Franchisee Operator"

CANDIDATE_CAP = 3000


def _str(value):
    return str(value) if value else None


def _in_params(names):
    return tuple(names) if names else ("",)


# ---------------------------------------------------------------------------
# Shared derivation
# ---------------------------------------------------------------------------


def _load_signals(trf_rows):
    """Batch-load every record that feeds the lifecycle for the given TRF rows."""
    names = [r["name"] for r in trf_rows]
    keys = _in_params(names)
    signals = {
        n: {
            "tubes": [],
            "reports": [],
            "journey": None,
            "rejections": [],
            "results_count": 0,
            "results_first_at": None,
            "params_filled": 0,
        }
        for n in names
    }
    if not names:
        return signals

    for t in frappe.db.sql(
        """select parent, status, drawn_at, received_at, rejected_reason, tube_code
        from `tabTRF Collection Tube`
        where parenttype='Customer TRF' and parent in %(keys)s""",
        {"keys": keys},
        as_dict=True,
    ):
        signals[t.parent]["tubes"].append(t)

    for lr in frappe.db.sql(
        """select name, customer_trf, report_status, department, creation, modified,
            sample_date, lab_receipt_date, report_date, printed_on
        from `tabLab Report` where customer_trf in %(keys)s""",
        {"keys": keys},
        as_dict=True,
    ):
        signals[lr.customer_trf]["reports"].append(lr)

    report_to_trf = {
        lr.name: trf for trf, sig in signals.items() for lr in sig["reports"]
    }
    if report_to_trf:
        for p in frappe.db.sql(
            """select parent, count(*) as filled from `tabLab Report Parameter`
            where parenttype='Lab Report' and parent in %(reports)s
              and ifnull(result_value, '') != ''
            group by parent""",
            {"reports": tuple(report_to_trf.keys())},
            as_dict=True,
        ):
            signals[report_to_trf[p.parent]]["params_filled"] += cint(p.filled)

    for r in frappe.db.sql(
        """select customer_trf, count(*) as cnt, min(creation) as first_at
        from `tabLab Test Result` where customer_trf in %(keys)s group by customer_trf""",
        {"keys": keys},
        as_dict=True,
    ):
        signals[r.customer_trf]["results_count"] = cint(r.cnt)
        signals[r.customer_trf]["results_first_at"] = r.first_at

    journey_names = {r["care_journey"] for r in trf_rows if r.get("care_journey")}
    journeys = {}
    for j in frappe.db.sql(
        """select name, customer_trf, status, authorized_on, modified
        from `tabPatient Care Journey`
        where customer_trf in %(keys)s or name in %(jn)s""",
        {"keys": keys, "jn": _in_params(list(journey_names))},
        as_dict=True,
    ):
        journeys[j.name] = j
    by_trf = {}
    for j in journeys.values():
        if j.customer_trf in signals:
            prev = by_trf.get(j.customer_trf)
            if not prev or str(j.modified or "") > str(prev.modified or ""):
                by_trf[j.customer_trf] = j
    for r in trf_rows:
        j = journeys.get(r.get("care_journey")) if r.get("care_journey") else None
        signals[r["name"]]["journey"] = j or by_trf.get(r["name"])

    if frappe.db.exists("DocType", "Sample Rejection Record"):
        for s in frappe.db.sql(
            """select name, customer_trf, reason, rejected_on, creation
            from `tabSample Rejection Record` where customer_trf in %(keys)s
            order by creation asc""",
            {"keys": keys},
            as_dict=True,
        ):
            signals[s.customer_trf]["rejections"].append(s)

    return signals


def _min_ts(values):
    vals = [v for v in values if v]
    return min(vals) if vals else None


def derive_lifecycle(trf_row, sig):
    """Return {lifecycle_status, stage_index, timeline, ...} for one TRF.

    The furthest stage backed by any record wins (monotonic), except Cancelled /
    Rejected which are terminal.
    """
    order_status = trf_row.get("order_status") or "Booked"
    tubes = sig["tubes"]
    reports = sig["reports"]
    journey = sig["journey"]
    jstatus = (journey or {}).get("status") or ""
    report_statuses = [lr.report_status or "Draft" for lr in reports]

    reached = {s: False for s in STAGES}
    at = {s: None for s in STAGES}
    source = {s: None for s in STAGES}

    def mark(stage, ts=None, src=None):
        reached[stage] = True
        if ts and not at[stage]:
            at[stage] = ts
        if src and not source[stage]:
            source[stage] = src

    mark("Booked", trf_row.get("hec_bill_datetime") or trf_row.get("creation"), "Customer TRF")

    drawn = [t for t in tubes if t.status in ("Drawn", "Received")]
    received = [t for t in tubes if t.status == "Received"]
    if order_status in ("Sample Collected", "In Lab", "Completed") or drawn or jstatus in (
        "Sample Collected", "In Lab", "Report Review", "Authorized", "Dispatched"
    ):
        mark(
            "Sample Collected",
            _min_ts(
                [t.drawn_at for t in drawn]
                + [t.received_at for t in received]
                + [lr.sample_date for lr in reports]
            ),
            "TRF Collection Tube" if drawn else ("Customer TRF" if order_status != "Booked" else "Patient Care Journey"),
        )
    if order_status in ("In Lab", "Completed") or received or jstatus in (
        "In Lab", "Report Review", "Authorized", "Dispatched"
    ):
        mark(
            "In Lab",
            _min_ts([t.received_at for t in received] + [lr.lab_receipt_date for lr in reports]),
            "TRF Collection Tube" if received else "Customer TRF",
        )
    if sig["results_count"] or sig["params_filled"] or "In Progress" in report_statuses:
        mark(
            "Processing",
            sig["results_first_at"]
            or _min_ts([lr.modified for lr in reports if lr.report_status == "In Progress"]),
            "Lab Test Result" if sig["results_count"] else "Lab Report",
        )
    ready_reports = [lr for lr in reports if lr.report_status in ("Verified", "Authorized", "Printed")]
    if ready_reports or order_status == "Completed" or jstatus in ("Report Review", "Authorized", "Dispatched"):
        mark(
            "Result Ready",
            _min_ts([lr.report_date for lr in ready_reports]),
            "Lab Report" if ready_reports else ("Customer TRF" if order_status == "Completed" else "Patient Care Journey"),
        )
    auth_reports = [lr for lr in reports if lr.report_status in ("Authorized", "Printed")]
    all_reports_authorized = bool(reports) and len(auth_reports) == len(reports)
    if jstatus in ("Authorized", "Dispatched") or all_reports_authorized:
        mark(
            "Authorized",
            (journey or {}).get("authorized_on") or _min_ts([lr.printed_on for lr in auth_reports]),
            "Patient Care Journey" if jstatus in ("Authorized", "Dispatched") else "Lab Report",
        )
    if jstatus == "Dispatched":
        mark("Dispatched", journey.get("modified"), "Patient Care Journey")
    printed = [lr for lr in reports if lr.report_status == "Printed"]
    if printed and (jstatus == "Dispatched" or all_reports_authorized):
        mark("Delivered", _min_ts([lr.modified for lr in printed]), "Lab Report (Printed)")

    # Fill gaps: a later stage implies earlier stages were passed.
    furthest = max(i for i, s in enumerate(STAGES) if reached[s])
    for i in range(furthest):
        reached[STAGES[i]] = True

    lifecycle = STAGES[furthest]
    terminal = None
    terminal_at = None
    terminal_reason = None
    rejected_tubes = [t for t in tubes if t.status == "Rejected"]
    if order_status == "Cancelled":
        terminal = "Cancelled"
        terminal_at = trf_row.get("modified")
    elif cint(trf_row.get("sample_rejected")) or (tubes and len(rejected_tubes) == len(tubes)):
        terminal = "Rejected"
        rej = sig["rejections"][-1] if sig["rejections"] else None
        terminal_at = (rej and (rej.rejected_on or rej.creation)) or trf_row.get("modified")
        terminal_reason = (
            (rej and rej.reason)
            or trf_row.get("sample_rejection_note")
            or (rejected_tubes and rejected_tubes[0].rejected_reason)
            or None
        )
    if terminal:
        lifecycle = terminal

    timeline = [
        {
            "stage": s,
            "reached": reached[s],
            "at": _str(at[s]),
            "source": source[s],
            "current": (not terminal and s == STAGES[furthest]),
        }
        for s in STAGES
    ]
    if terminal:
        timeline.append(
            {
                "stage": terminal,
                "reached": True,
                "at": _str(terminal_at),
                "source": "Customer TRF" if terminal == "Cancelled" else "Sample Rejection Record",
                "current": True,
                "reason": terminal_reason,
            }
        )

    report_summary = None
    if reports:
        counts = defaultdict(int)
        for st in report_statuses:
            counts[st] += 1
        report_summary = ", ".join(f"{k} {v}" if len(reports) > 1 else k for k, v in counts.items())

    return {
        "lifecycle_status": lifecycle,
        "stage_index": furthest,
        "progress_stage": STAGES[furthest],
        "is_terminal": bool(terminal),
        "terminal_reason": terminal_reason,
        "timeline": timeline,
        "journey_id": (journey or {}).get("name"),
        "journey_status": jstatus or None,
        "report_status": report_summary,
        "lab_reports": [lr.name for lr in reports],
        "tubes_total": len(tubes),
        "tubes_received": len(received),
        "tubes_rejected": len(rejected_tubes),
        "results_count": sig["results_count"] + sig["params_filled"],
    }


LIFECYCLE_TRF_FIELDS = (
    "name",
    "order_status",
    "creation",
    "modified",
    "care_journey",
    "sample_rejected",
    "sample_rejection_note",
    "hec_bill_datetime",
)


def compute_booking_lifecycle(trf_names):
    """Shared helper: {trf_name: lifecycle dict} for a list of Customer TRF names."""
    names = [n for n in dict.fromkeys(trf_names or []) if n]
    if not names:
        return {}
    cols = _existing_trf_columns(LIFECYCLE_TRF_FIELDS)
    rows = frappe.db.sql(
        f"select {', '.join('`' + c + '`' for c in cols)} from `tabCustomer TRF` where name in %(keys)s",
        {"keys": tuple(names)},
        as_dict=True,
    )
    signals = _load_signals(rows)
    return {r.name: derive_lifecycle(r, signals[r.name]) for r in rows}


# ---------------------------------------------------------------------------
# Row presentation helpers
# ---------------------------------------------------------------------------

_TRF_COLUMNS_CACHE = {}


def _existing_trf_columns(wanted):
    key = frappe.local.site
    cols = _TRF_COLUMNS_CACHE.get(key)
    if cols is None:
        cols = set(frappe.db.get_table_columns("Customer TRF"))
        _TRF_COLUMNS_CACHE[key] = cols
    return [c for c in wanted if c in cols]


def _partner_maps():
    profiles = frappe.get_all(
        "Franchisee Profile",
        fields=["name", "franchise_name", "branch_code", "linked_user"],
        limit_page_length=0,
    )
    names = {p.name: (p.franchise_name or p.name) for p in profiles}
    linked = {p.linked_user: p.name for p in profiles if p.linked_user}
    return names, linked


def _owner_roles(owners):
    owners = [o for o in set(owners) if o]
    roles = defaultdict(set)
    if not owners:
        return roles
    for r in frappe.db.sql(
        """select parent, role from `tabHas Role`
        where parenttype='User' and parent in %(owners)s
          and role in ('Franchisee Operator','Patient','Lab Technician','Pathologist',
                       'Health System Admin','System Manager','Phlebotomist')""",
        {"owners": tuple(owners)},
        as_dict=True,
    ):
        roles[r.parent].add(r.role)
    return roles


def booking_source(row, partner_users, owner_roles):
    """Where the booking was created. Partner Portal = TRF owned by a franchisee's portal user."""
    owner = row.get("owner") or ""
    channel = (row.get("sample_intake_channel") or "").strip()
    roles = owner_roles.get(owner, set())
    if owner in partner_users or (FRANCHISEE_ROLE in roles and not (roles & STAFF_ROLES)):
        return "Partner Portal"
    if channel in ("Direct to Mother Lab", "Online / Courier Sample"):
        return "Mother Lab Bill"
    if channel == "Hub Walk-in":
        return "Hub Bill"
    if roles & STAFF_ROLES or owner == "Administrator":
        return "Lab / Staff Desk"
    if "Phlebotomist" in roles:
        return "Phlebotomist"
    return "Patient Web / App"


def collection_type(row, source):
    channel = (row.get("sample_intake_channel") or "").strip()
    if channel == "Home Collection":
        return "Home Collection"
    if channel == "Hub Walk-in":
        return "Centre Walk-in"
    if channel == "Direct to Mother Lab":
        return "Lab Walk-in"
    if channel == "Online / Courier Sample" or cint(row.get("hec_outside_sample")):
        return "Courier / Outside Sample"
    if row.get("collection_slot") or row.get("collection_latitude"):
        return "Home Collection"
    if source == "Partner Portal":
        return "Centre Walk-in"
    if source == "Patient Web / App":
        return "Home Collection" if row.get("collection_address") else "Walk-in"
    return "Walk-in"


def payment_status(row):
    rz = (row.get("razorpay_payment_status") or "").strip()
    hec = (row.get("hec_patient_payment_status") or "").strip()
    if rz == "Refunded":
        return "Refunded"
    if rz == "Paid" or hec == "Paid":
        return "Paid"
    if hec == "Partially Paid":
        return "Partially Paid"
    if rz == "Failed":
        return "Failed"
    return "Pending"


LIST_FIELDS = (
    "name",
    "patient_name",
    "age",
    "age_months",
    "age_days",
    "gender",
    "patient_phone",
    "unique_barcode",
    "test_required",
    "order_status",
    "razorpay_payment_status",
    "hec_patient_payment_status",
    "payment_method",
    "amount",
    "collection_slot",
    "collection_address",
    "collection_latitude",
    "franchisee_id",
    "owner",
    "creation",
    "modified",
    "care_journey",
    "sample_rejected",
    "sample_rejection_note",
    "sample_intake_channel",
    "hec_outside_sample",
    "hec_bill_datetime",
)


def _test_lines(names):
    lines = defaultdict(list)
    if not names:
        return lines
    for t in frappe.db.sql(
        """select ti.parent, ti.item, coalesce(nullif(ti.item_name, ''), i.item_name, ti.item) as item_name
        from `tabTRF Test Item` ti left join `tabItem` i on i.name = ti.item
        where ti.parenttype='Customer TRF' and ti.parent in %(keys)s and ifnull(ti.item, '') != ''
        order by ti.parent, ti.idx""",
        {"keys": tuple(names)},
        as_dict=True,
    ):
        lines[t.parent].append({"item_code": t.item, "item_name": t.item_name})
    return lines


def _item_names(codes):
    codes = [c for c in set(codes) if c]
    if not codes:
        return {}
    return {
        r.name: r.item_name
        for r in frappe.db.sql(
            "select name, item_name from `tabItem` where name in %(c)s", {"c": tuple(codes)}, as_dict=True
        )
    }


def _scope_for_user():
    """('staff', None) | ('franchisee', franchisee_id) | (None, None)."""
    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    if roles & STAFF_ROLES:
        return "staff", None
    if FRANCHISEE_ROLE in roles:
        from health_ecosystem_core.health_ecosystem_core.clinical_iam import franchisee_id_for_user

        return "franchisee", franchisee_id_for_user(user)
    return None, None


def _clean(value):
    if value is None:
        return ""
    value = str(value).strip()
    return "" if value.lower() in ("all", "undefined", "null", "none") else value


# ---------------------------------------------------------------------------
# Whitelisted endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_all_bookings(
    status=None,
    from_date=None,
    to_date=None,
    franchisee_id=None,
    q=None,
    patient=None,
    booking=None,
    test=None,
    collection_type_filter=None,
    source=None,
    payment=None,
    page=1,
    page_size=25,
    sid=None,
):
    """All bookings (Customer TRF) with derived lifecycle status, server-side filters and paging."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    scope, scoped_franchisee = _scope_for_user()
    if not scope:
        return _error(_("Not permitted"), 403)

    status = _clean(_parse_request_value("status", status))
    from_date = _clean(_parse_request_value("from_date", from_date))
    to_date = _clean(_parse_request_value("to_date", to_date))
    franchisee_id = _clean(_parse_request_value("franchisee_id", franchisee_id))
    q = _clean(_parse_request_value("q", q))
    patient = _clean(_parse_request_value("patient", patient))
    booking = _clean(_parse_request_value("booking", booking))
    test = _clean(_parse_request_value("test", test))
    ctype = _clean(_parse_request_value("collection_type_filter", collection_type_filter))
    source = _clean(_parse_request_value("source", source))
    payment = _clean(_parse_request_value("payment", payment))
    page = max(cint(_parse_request_value("page", page) or 1), 1)
    page_size = min(max(cint(_parse_request_value("page_size", page_size) or 25), 1), 100)

    if scope == "franchisee":
        if not scoped_franchisee:
            return _success({"bookings": [], "total": 0, "counts": {}, "partners": [], "stages": list(STAGES)})
        franchisee_id = scoped_franchisee

    conds = ["1=1"]
    params = {}
    if from_date:
        conds.append("date(t.creation) >= %(from_date)s")
        params["from_date"] = str(getdate(from_date))
    if to_date:
        conds.append("date(t.creation) <= %(to_date)s")
        params["to_date"] = str(getdate(to_date))
    if franchisee_id:
        conds.append("t.franchisee_id = %(franchisee_id)s")
        params["franchisee_id"] = franchisee_id
    if patient:
        conds.append("(t.patient_name like %(patient)s or t.patient_phone like %(patient)s)")
        params["patient"] = f"%{patient}%"
    if booking:
        conds.append("(t.name like %(booking)s or t.unique_barcode like %(booking)s)")
        params["booking"] = f"%{booking}%"
    test_subq = """(t.test_required like {p} or exists (select 1 from `tabTRF Test Item` ti
        where ti.parenttype='Customer TRF' and ti.parent = t.name
          and (ti.item like {p} or ti.item_name like {p})))"""
    if test:
        conds.append(test_subq.format(p="%(test)s"))
        params["test"] = f"%{test}%"
    if q:
        conds.append(
            "(t.name like %(q)s or t.unique_barcode like %(q)s or t.patient_name like %(q)s "
            "or t.patient_phone like %(q)s or " + test_subq.format(p="%(q)s") + ")"
        )
        params["q"] = f"%{q}%"

    cols = _existing_trf_columns(LIST_FIELDS)
    rows = frappe.db.sql(
        f"""select {', '.join('t.`' + c + '`' for c in cols)} from `tabCustomer TRF` t
        where {' and '.join(conds)} order by t.creation desc limit {CANDIDATE_CAP}""",
        params,
        as_dict=True,
    )

    partner_names, partner_users = _partner_maps()
    roles = _owner_roles([r.owner for r in rows])
    signals = _load_signals(rows)

    enriched = []
    for r in rows:
        src = booking_source(r, partner_users, roles)
        r["_source"] = src
        r["_collection"] = collection_type(r, src)
        r["_payment"] = payment_status(r)
        r["_life"] = derive_lifecycle(r, signals[r.name])
        enriched.append(r)

    def passes_secondary(r):
        if ctype and r["_collection"] != ctype:
            return False
        if source and r["_source"] != source:
            return False
        if payment and r["_payment"] != payment:
            return False
        return True

    base = [r for r in enriched if passes_secondary(r)]
    counts = {s: 0 for s in ALL_STATUSES}
    for r in base:
        counts[r["_life"]["lifecycle_status"]] += 1
    counts["All"] = len(base)
    counts["Active"] = sum(counts[s] for s in ("Booked", "Sample Collected", "In Lab", "Processing"))
    counts["Partner Portal"] = sum(1 for r in base if r["_source"] == "Partner Portal")

    if status == "Active":
        filtered = [r for r in base if r["_life"]["lifecycle_status"] in ("Booked", "Sample Collected", "In Lab", "Processing")]
    elif status:
        filtered = [r for r in base if r["_life"]["lifecycle_status"] == status]
    else:
        filtered = base

    total = len(filtered)
    start = (page - 1) * page_size
    page_rows = filtered[start : start + page_size]

    lines = _test_lines([r.name for r in page_rows])
    fallback_names = _item_names([r.test_required for r in page_rows if not lines.get(r.name)])

    bookings = []
    for r in page_rows:
        tests = lines.get(r.name) or (
            [{"item_code": r.test_required, "item_name": fallback_names.get(r.test_required) or r.test_required}]
            if r.test_required
            else []
        )
        life = r["_life"]
        bookings.append(
            {
                "trf_id": r.name,
                "barcode": r.get("unique_barcode"),
                "patient_name": r.get("patient_name"),
                "age": r.get("age"),
                "age_months": r.get("age_months"),
                "age_days": r.get("age_days"),
                "gender": r.get("gender"),
                "patient_phone": r.get("patient_phone"),
                "tests": tests,
                "test_labels": [t["item_name"] for t in tests],
                "booking_date": _str(r.get("creation")),
                "bill_datetime": _str(r.get("hec_bill_datetime")),
                "modified": _str(r.get("modified")),
                "franchisee_id": r.get("franchisee_id"),
                "partner_name": partner_names.get(r.get("franchisee_id")) or r.get("franchisee_id"),
                "booking_source": r["_source"],
                "intake_channel": r.get("sample_intake_channel") or None,
                "collection_type": r["_collection"],
                "collection_slot": _str(r.get("collection_slot")),
                "payment_status": r["_payment"],
                "payment_method": r.get("payment_method"),
                "razorpay_payment_status": r.get("razorpay_payment_status"),
                "amount": r.get("amount"),
                "order_status": r.get("order_status"),
                **life,
            }
        )

    partners = [
        {"franchisee_id": p.franchisee_id, "name": partner_names.get(p.franchisee_id) or p.franchisee_id, "count": p.cnt}
        for p in frappe.db.sql(
            """select franchisee_id, count(*) as cnt from `tabCustomer TRF`
            where ifnull(franchisee_id, '') != '' {extra} group by franchisee_id order by cnt desc""".format(
                extra="and franchisee_id = %(f)s" if scope == "franchisee" else ""
            ),
            {"f": scoped_franchisee} if scope == "franchisee" else {},
            as_dict=True,
        )
    ]

    return _success(
        {
            "bookings": bookings,
            "total": total,
            "page": page,
            "page_size": page_size,
            "counts": counts,
            "partners": partners,
            "stages": list(STAGES),
            "statuses": list(ALL_STATUSES),
            "truncated": len(rows) >= CANDIDATE_CAP,
            "scope": scope,
        }
    )


@frappe.whitelist()
def get_booking_lifecycle_detail(trf_id=None, sid=None):
    """Single booking with full lifecycle timeline and the records behind each stage."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    scope, scoped_franchisee = _scope_for_user()
    if not scope:
        return _error(_("Not permitted"), 403)
    trf_id = _clean(_parse_request_value("trf_id", trf_id))
    if not trf_id:
        return _error(_("Booking ID is required"))
    if not frappe.db.exists("Customer TRF", trf_id):
        trf_id = frappe.db.get_value("Customer TRF", {"unique_barcode": trf_id}, "name")
    if not trf_id:
        return _error(_("Booking not found"), 404)

    cols = _existing_trf_columns(LIST_FIELDS + ("collection_address", "referred_doctor", "discount_amount"))
    row = frappe.db.sql(
        f"select {', '.join('`' + c + '`' for c in dict.fromkeys(cols))} from `tabCustomer TRF` where name=%(n)s",
        {"n": trf_id},
        as_dict=True,
    )[0]
    if scope == "franchisee" and row.get("franchisee_id") != scoped_franchisee:
        return _error(_("Not permitted"), 403)

    partner_names, partner_users = _partner_maps()
    roles = _owner_roles([row.owner])
    sig = _load_signals([row])[trf_id]
    life = derive_lifecycle(row, sig)
    src = booking_source(row, partner_users, roles)

    journey_log = []
    jid = life.get("journey_id")
    if jid:
        for c in frappe.get_all(
            "Comment",
            filters={"reference_doctype": "Patient Care Journey", "reference_name": jid, "comment_type": "Info"},
            fields=["content", "creation", "owner"],
            order_by="creation asc",
            limit_page_length=50,
        ):
            journey_log.append({"message": frappe.utils.strip_html(c.content or ""), "at": _str(c.creation), "by": c.owner})
        dispatched = [e for e in journey_log if "→ Dispatched" in e["message"]]
        if dispatched:
            for step in life["timeline"]:
                if step["stage"] == "Dispatched":
                    step["at"] = dispatched[-1]["at"]
                    step["source"] = "Journey activity log"

    alerts = frappe.get_all(
        "Lab Critical Value Alert",
        filters={"customer_trf": trf_id},
        fields=["name", "parameter", "result_value", "unit", "abnormal_flag", "alert_status", "creation"],
        order_by="creation desc",
        limit_page_length=20,
    ) if frappe.db.exists("DocType", "Lab Critical Value Alert") else []

    tests = _test_lines([trf_id]).get(trf_id) or (
        [{"item_code": row.test_required, "item_name": _item_names([row.test_required]).get(row.test_required) or row.test_required}]
        if row.get("test_required")
        else []
    )

    return _success(
        {
            "booking": {
                "trf_id": row.name,
                "barcode": row.get("unique_barcode"),
                "patient_name": row.get("patient_name"),
                "age": row.get("age"),
                "age_months": row.get("age_months"),
                "age_days": row.get("age_days"),
                "gender": row.get("gender"),
                "patient_phone": row.get("patient_phone"),
                "tests": tests,
                "test_labels": [t["item_name"] for t in tests],
                "booking_date": _str(row.get("creation")),
                "bill_datetime": _str(row.get("hec_bill_datetime")),
                "franchisee_id": row.get("franchisee_id"),
                "partner_name": partner_names.get(row.get("franchisee_id")) or row.get("franchisee_id"),
                "booking_source": src,
                "intake_channel": row.get("sample_intake_channel") or None,
                "collection_type": collection_type(row, src),
                "collection_slot": _str(row.get("collection_slot")),
                "collection_address": row.get("collection_address"),
                "payment_status": payment_status(row),
                "payment_method": row.get("payment_method"),
                "amount": row.get("amount"),
                "order_status": row.get("order_status"),
                "created_by": row.get("owner"),
                **life,
            },
            "tubes": [
                {
                    "tube_code": t.tube_code,
                    "status": t.status,
                    "drawn_at": _str(t.drawn_at),
                    "received_at": _str(t.received_at),
                    "rejected_reason": t.rejected_reason,
                }
                for t in sig["tubes"]
            ],
            "reports": [
                {
                    "name": lr.name,
                    "report_status": lr.report_status,
                    "department": lr.department,
                    "report_date": _str(lr.report_date),
                    "printed_on": _str(lr.printed_on),
                }
                for lr in sig["reports"]
            ],
            "rejections": [
                {"name": s.name, "reason": s.reason, "rejected_on": _str(s.rejected_on or s.creation)}
                for s in sig["rejections"]
            ],
            "critical_alerts": [
                {**a, "creation": _str(a.creation)} for a in alerts
            ],
            "journey_log": journey_log,
        }
    )


@frappe.whitelist()
def get_booking_lifecycle_status(trf_ids=None, sid=None):
    """Lifecycle for a set of bookings (comma/JSON list) — reusable by Partner Portal and other queues."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    scope, scoped_franchisee = _scope_for_user()
    if not scope:
        return _error(_("Not permitted"), 403)
    raw = _parse_request_value("trf_ids", trf_ids) or ""
    if isinstance(raw, str):
        raw = raw.strip()
        if raw.startswith("["):
            raw = frappe.parse_json(raw)
        else:
            raw = raw.split(",")
    names = [str(n).strip() for n in raw if str(n).strip()][:500]
    if scope == "franchisee":
        names = frappe.get_all(
            "Customer TRF",
            filters={"name": ["in", names or [""]], "franchisee_id": scoped_franchisee or ""},
            pluck="name",
        )
    data = compute_booking_lifecycle(names)
    return _success(
        {
            "lifecycle": {
                k: {
                    "lifecycle_status": v["lifecycle_status"],
                    "stage_index": v["stage_index"],
                    "timeline": v["timeline"],
                }
                for k, v in data.items()
            },
            "stages": list(STAGES),
        }
    )


def smoke_counts():
    """bench execute helper: lifecycle + source distribution over every booking."""
    frappe.set_user("Administrator")
    res = get_all_bookings(page_size=100)
    data = res.get("data") or {}
    by_source = defaultdict(int)
    by_ctype = defaultdict(int)
    names = frappe.get_all("Customer TRF", pluck="name", limit_page_length=0)
    rows = list(data.get("bookings") or [])
    for p in range(2, (len(names) // 100) + 2):
        rows += get_all_bookings(page_size=100, page=p).get("data", {}).get("bookings", [])
    for b in rows:
        by_source[b["booking_source"]] += 1
        by_ctype[b["collection_type"]] += 1
    return {
        "status": res.get("status"),
        "total": data.get("total"),
        "trf_count": len(names),
        "counts": {k: v for k, v in (data.get("counts") or {}).items() if v},
        "by_source": dict(by_source),
        "by_collection_type": dict(by_ctype),
    }
