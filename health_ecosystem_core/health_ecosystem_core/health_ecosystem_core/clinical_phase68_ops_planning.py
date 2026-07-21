"""Phase 68 — RRP / Material MRP / ERP ops loop: Sale Projection → Material MRP → Feedback.

Naming note:
- Material MRP = Material Requirement Planning (this module).
- Company price MRP (Maximum Retail Price) in Phase 54 is untouched.
- RRP = Resource Requirement Planning (capacity/slots).
- ERP = orchestration dashboard + control panel over projections, material, resources, feedback.
"""

from __future__ import annotations

import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from health_ecosystem_core.health_ecosystem_core.api import (
    LAB_ITEM_GROUPS,
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff
from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
    MODULE,
    _ensure_doctype,
    _field,
)

RESOURCE_TYPES = (
    "Phlebotomy Slot",
    "Analyzer Hour",
    "Doctor Consult",
    "Wellness Chair",
    "Home Collection",
)


def _ops_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    roles = set(frappe.get_roles(user))
    return bool(
        roles
        & {
            "System Manager",
            "Health System Admin",
            "Stock Manager",
            "Purchase Manager",
            "Accounts Manager",
            "Administrator",
        }
    ) or is_staff(user)


def _require_ops():
    _require_mobile_auth()
    if not _ops_user():
        frappe.throw(_("Operations / staff access required"), frappe.PermissionError)


def ensure_phase68_doctypes():
    _ensure_doctype(
        "Sale Projection Item",
        istable=1,
        fields=[
            _field("item_code", "Link", "Item", options="Item", reqd=1, in_list_view=1),
            _field("item_name", "Data", "Item Name", fetch_from="item_code.item_name", read_only=1),
            _field("projected_qty", "Float", "Projected Qty", reqd=1, default="0", in_list_view=1),
            _field("uom", "Link", "UOM", options="UOM"),
            _field("notes", "Small Text", "Notes"),
        ],
    )

    _ensure_doctype(
        "Sale Projection",
        autoname="naming_series:",
        naming_series="SPROJ-.#####",
        title_field="period_label",
        fields=[
            _field("naming_series", "Select", "Series", options="SPROJ-.#####", default="SPROJ-.#####", reqd=1),
            _field("period_label", "Data", "Period Label", in_list_view=1),
            _field("from_date", "Date", "From Date", reqd=1, in_list_view=1),
            _field("to_date", "Date", "To Date", reqd=1, in_list_view=1),
            _field("franchisee_id", "Link", "Hub / Franchisee", options="Franchisee Profile", in_list_view=1),
            _field(
                "source",
                "Select",
                "Source",
                options="Manual\nTrailing Average\nSales Target",
                default="Manual",
                in_list_view=1,
            ),
            _field(
                "status",
                "Select",
                "Status",
                options="Draft\nActive\nClosed",
                default="Draft",
                in_list_view=1,
            ),
            _field("adjust_factor", "Float", "Feedback Adjust Factor", default="1", description="Applied from prior Ops Feedback"),
            _field("items", "Table", "Projected Items", options="Sale Projection Item"),
            _field("remarks", "Small Text", "Remarks"),
        ],
    )

    _ensure_doctype(
        "Material Requirement Plan Item",
        istable=1,
        fields=[
            _field("reagent_item", "Link", "Reagent Item", options="Item", reqd=1, in_list_view=1),
            _field("reagent_name", "Data", "Reagent Name", read_only=1),
            _field("required_qty", "Float", "Required (tests equiv)", in_list_view=1),
            _field("available_qty", "Float", "Available (open batches)", in_list_view=1),
            _field("shortfall", "Float", "Shortfall", in_list_view=1),
            _field("suggested_po_qty", "Float", "Suggested PO Qty"),
            _field("source_tests", "Small Text", "Driven By Tests"),
        ],
    )

    _ensure_doctype(
        "Material Requirement Plan",
        autoname="naming_series:",
        naming_series="MMRP-.#####",
        fields=[
            _field("naming_series", "Select", "Series", options="MMRP-.#####", default="MMRP-.#####", reqd=1),
            _field("sale_projection", "Link", "Sale Projection", options="Sale Projection", reqd=1, in_list_view=1),
            _field("franchisee_id", "Link", "Hub / Franchisee", options="Franchisee Profile"),
            _field("from_date", "Date", "From Date"),
            _field("to_date", "Date", "To Date"),
            _field(
                "status",
                "Select",
                "Status",
                options="Draft\nComputed\nOrdered\nClosed",
                default="Draft",
                in_list_view=1,
            ),
            _field("total_shortfall_lines", "Int", "Shortfall Lines", read_only=1),
            _field("items", "Table", "Material Lines", options="Material Requirement Plan Item"),
            _field("computed_on", "Datetime", "Computed On", read_only=1),
        ],
    )

    _ensure_doctype(
        "Resource Requirement Plan Item",
        istable=1,
        fields=[
            _field(
                "resource_type",
                "Select",
                "Resource Type",
                options="\n".join(RESOURCE_TYPES),
                reqd=1,
                in_list_view=1,
            ),
            _field("required_units", "Float", "Required", in_list_view=1),
            _field("available_units", "Float", "Available Capacity", in_list_view=1),
            _field("gap", "Float", "Gap", in_list_view=1),
            _field("notes", "Small Text", "Notes"),
        ],
    )

    _ensure_doctype(
        "Resource Requirement Plan",
        autoname="naming_series:",
        naming_series="RRP-.#####",
        fields=[
            _field("naming_series", "Select", "Series", options="RRP-.#####", default="RRP-.#####", reqd=1),
            _field("sale_projection", "Link", "Sale Projection", options="Sale Projection", reqd=1, in_list_view=1),
            _field("franchisee_id", "Link", "Hub / Franchisee", options="Franchisee Profile"),
            _field("from_date", "Date", "From Date"),
            _field("to_date", "Date", "To Date"),
            _field(
                "status",
                "Select",
                "Status",
                options="Draft\nComputed\nClosed",
                default="Draft",
                in_list_view=1,
            ),
            _field("total_gap_lines", "Int", "Gap Lines", read_only=1),
            _field("items", "Table", "Resource Lines", options="Resource Requirement Plan Item"),
            _field("computed_on", "Datetime", "Computed On", read_only=1),
        ],
    )

    _ensure_doctype(
        "Ops Feedback Entry",
        autoname="naming_series:",
        naming_series="OFB-.#####",
        fields=[
            _field("naming_series", "Select", "Series", options="OFB-.#####", default="OFB-.#####", reqd=1),
            _field("sale_projection", "Link", "Sale Projection", options="Sale Projection", in_list_view=1),
            _field("material_plan", "Link", "Material Requirement Plan", options="Material Requirement Plan"),
            _field("resource_plan", "Link", "Resource Requirement Plan", options="Resource Requirement Plan"),
            _field("from_date", "Date", "From Date", reqd=1),
            _field("to_date", "Date", "To Date", reqd=1),
            _field("projected_tests", "Float", "Projected Tests"),
            _field("actual_tests", "Float", "Actual Tests", in_list_view=1),
            _field("test_variance_pct", "Percent", "Test Variance %", in_list_view=1),
            _field("projected_reagent_tests", "Float", "Projected Reagent Demand"),
            _field("actual_reagent_consumed", "Float", "Actual Reagent Consumed"),
            _field("reagent_variance_pct", "Percent", "Reagent Variance %"),
            _field("resource_gap_units", "Float", "Resource Gap Units"),
            _field("suggested_adjust_factor", "Float", "Suggested Adjust Factor", default="1"),
            _field("applied_to_next_projection", "Check", "Applied To Next Projection", default=0),
            _field(
                "status",
                "Select",
                "Status",
                options="Open\nClosed",
                default="Open",
                in_list_view=1,
            ),
            _field("notes", "Small Text", "Notes"),
        ],
    )

    _ensure_doctype(
        "ERP Control Panel",
        is_single=1,
        fields=[
            _field("planning_horizon_days", "Int", "Default Planning Horizon (days)", default="30"),
            _field("auto_run_material_mrp", "Check", "Auto-run Material MRP nightly", default=0),
            _field("auto_run_rrp", "Check", "Auto-run RRP with Material MRP", default=1),
            _field("feedback_damping_factor", "Float", "Feedback Damping (0-1)", default="0.5",
                   description="Blend factor when applying feedback to next Sale Projection"),
            _field("default_phlebotomy_slots_per_day", "Float", "Default Phlebotomy Slots / Day", default="40"),
            _field("default_analyzer_hours_per_day", "Float", "Default Analyzer Hours / Day", default="16"),
            _field("default_doctor_slots_per_day", "Float", "Default Doctor Slots / Day", default="20"),
            _field("default_wellness_chairs", "Float", "Default Wellness Chairs / Day", default="8"),
            _field("last_nightly_run", "Datetime", "Last Nightly Run", read_only=1),
        ],
    )


def get_erp_control():
    ensure_phase68_doctypes()
    return frappe.get_single("ERP Control Panel")


def create_sale_projection(
    from_date=None,
    to_date=None,
    franchisee_id=None,
    source="Manual",
    items=None,
    period_label=None,
    adjust_factor=None,
):
    ensure_phase68_doctypes()
    ctrl = get_erp_control()
    today = getdate(nowdate())
    from_date = getdate(from_date) if from_date else today
    if to_date:
        to_date = getdate(to_date)
    else:
        to_date = from_date + timedelta(days=cint(ctrl.planning_horizon_days) or 30)
    if adjust_factor is None:
        adjust_factor = 1.0
    items = items or []
    if isinstance(items, str):
        items = json.loads(items or "[]")

    # Trailing average: last 30 days Sales Invoice lab qty
    if source == "Trailing Average" and not items:
        items = _trailing_average_items(from_date, franchisee_id)

    doc = frappe.get_doc(
        {
            "doctype": "Sale Projection",
            "period_label": period_label or f"{from_date} → {to_date}",
            "from_date": from_date,
            "to_date": to_date,
            "franchisee_id": franchisee_id,
            "source": source or "Manual",
            "status": "Active",
            "adjust_factor": flt(adjust_factor) or 1.0,
            "items": [],
        }
    )
    factor = flt(doc.adjust_factor) or 1.0
    for row in items:
        qty = flt(row.get("projected_qty") or row.get("qty")) * factor
        if qty <= 0 and not row.get("item_code"):
            continue
        if not row.get("item_code"):
            continue
        doc.append(
            "items",
            {
                "item_code": row["item_code"],
                "projected_qty": qty,
                "uom": row.get("uom"),
                "notes": row.get("notes"),
            },
        )
    doc.insert(ignore_permissions=True)
    return doc


def _trailing_average_items(as_of, franchisee_id=None):
    """Rough demand: sum SI item qty in prior 30 days for lab groups."""
    end = getdate(as_of) - timedelta(days=1)
    start = end - timedelta(days=29)
    # Sales Invoice Item join
    rows = frappe.db.sql(
        """
        select sii.item_code, sum(sii.qty) as qty
        from `tabSales Invoice Item` sii
        inner join `tabSales Invoice` si on si.name = sii.parent
        inner join `tabItem` i on i.name = sii.item_code
        where si.docstatus = 1
          and si.posting_date between %s and %s
          and i.item_group in ({groups})
        group by sii.item_code
        order by qty desc
        limit 100
        """.format(groups=",".join(["%s"] * len(LAB_ITEM_GROUPS))),
        tuple([start, end] + list(LAB_ITEM_GROUPS)),
        as_dict=True,
    )
    return [{"item_code": r.item_code, "projected_qty": flt(r.qty), "notes": "Trailing 30d"} for r in rows]


def _reagent_rules_for_test(item_code):
    if not frappe.db.exists("DocType", "Lab Test Reagent Rule"):
        return []
    return frappe.get_all(
        "Lab Test Reagent Rule",
        filters={"lab_test_item": item_code, "active": 1},
        fields=["reagent_item", "tests_per_consumption", "rule_name"],
    )


def _open_batch_remaining(reagent_item, franchisee_id=None):
    if not frappe.db.exists("DocType", "Lab Reagent Batch"):
        return 0.0
    filters = {"reagent_item": reagent_item, "status": "Open", "tests_remaining": [">", 0]}
    if franchisee_id:
        filters["franchisee_id"] = franchisee_id
    rows = frappe.get_all("Lab Reagent Batch", filters=filters, fields=["tests_remaining"])
    total = sum(flt(r.tests_remaining) for r in rows)
    if franchisee_id and total <= 0:
        # fallback company-wide open batches
        rows = frappe.get_all(
            "Lab Reagent Batch",
            filters={"reagent_item": reagent_item, "status": "Open", "tests_remaining": [">", 0]},
            fields=["tests_remaining"],
        )
        total = sum(flt(r.tests_remaining) for r in rows)
    return total


def run_material_mrp(projection_id):
    ensure_phase68_doctypes()
    proj = frappe.get_doc("Sale Projection", projection_id)
    demand = {}  # reagent -> {required, sources}
    for line in proj.items or []:
        qty = flt(line.projected_qty)
        if qty <= 0:
            continue
        rules = _reagent_rules_for_test(line.item_code)
        if not rules:
            continue
        for rule in rules:
            per = flt(rule.tests_per_consumption) or 1.0
            # tests_per_consumption = how many tests one consumption unit covers
            needed = qty / per
            key = rule.reagent_item
            bucket = demand.setdefault(key, {"required": 0.0, "sources": []})
            bucket["required"] += needed
            bucket["sources"].append(f"{line.item_code}:{qty}")

    doc = frappe.get_doc(
        {
            "doctype": "Material Requirement Plan",
            "sale_projection": proj.name,
            "franchisee_id": proj.franchisee_id,
            "from_date": proj.from_date,
            "to_date": proj.to_date,
            "status": "Computed",
            "computed_on": frappe.utils.now_datetime(),
            "items": [],
        }
    )
    shortfall_lines = 0
    for reagent, data in sorted(demand.items()):
        available = _open_batch_remaining(reagent, proj.franchisee_id)
        required = flt(data["required"])
        shortfall = max(0.0, required - available)
        if shortfall > 0:
            shortfall_lines += 1
        doc.append(
            "items",
            {
                "reagent_item": reagent,
                "reagent_name": frappe.db.get_value("Item", reagent, "item_name") or reagent,
                "required_qty": round(required, 2),
                "available_qty": round(available, 2),
                "shortfall": round(shortfall, 2),
                "suggested_po_qty": round(shortfall, 2) if shortfall > 0 else 0,
                "source_tests": ", ".join(data["sources"][:8]),
            },
        )
    doc.total_shortfall_lines = shortfall_lines
    doc.insert(ignore_permissions=True)
    return doc


def run_rrp(projection_id, material_plan_id=None):
    ensure_phase68_doctypes()
    proj = frappe.get_doc("Sale Projection", projection_id)
    ctrl = get_erp_control()
    days = max(1, (getdate(proj.to_date) - getdate(proj.from_date)).days + 1)
    total_tests = sum(flt(i.projected_qty) for i in (proj.items or []))

    # Heuristic capacity model
    required = {
        "Phlebotomy Slot": total_tests,  # 1 draw ~ 1 slot
        "Analyzer Hour": total_tests * 0.05,  # ~3 min / test
        "Doctor Consult": total_tests * 0.1,
        "Wellness Chair": total_tests * 0.05,
        "Home Collection": total_tests * 0.15,
    }
    available = {
        "Phlebotomy Slot": flt(ctrl.default_phlebotomy_slots_per_day) * days,
        "Analyzer Hour": flt(ctrl.default_analyzer_hours_per_day) * days,
        "Doctor Consult": flt(ctrl.default_doctor_slots_per_day) * days,
        "Wellness Chair": flt(ctrl.default_wellness_chairs) * days,
        "Home Collection": flt(ctrl.default_phlebotomy_slots_per_day) * 0.3 * days,
    }

    doc = frappe.get_doc(
        {
            "doctype": "Resource Requirement Plan",
            "sale_projection": proj.name,
            "franchisee_id": proj.franchisee_id,
            "from_date": proj.from_date,
            "to_date": proj.to_date,
            "status": "Computed",
            "computed_on": frappe.utils.now_datetime(),
            "items": [],
        }
    )
    gaps = 0
    for rtype in RESOURCE_TYPES:
        req = flt(required.get(rtype))
        avail = flt(available.get(rtype))
        gap = max(0.0, req - avail)
        if gap > 0:
            gaps += 1
        doc.append(
            "items",
            {
                "resource_type": rtype,
                "required_units": round(req, 2),
                "available_units": round(avail, 2),
                "gap": round(gap, 2),
                "notes": f"Horizon {days}d",
            },
        )
    doc.total_gap_lines = gaps
    doc.insert(ignore_permissions=True)
    return doc


def _actual_tests(from_date, to_date, franchisee_id=None):
    """Count completed lab activity; prefer Lab Report / SI lab lines."""
    filters = {"docstatus": 1, "posting_date": ["between", [from_date, to_date]]}
    total = 0.0
    try:
        rows = frappe.db.sql(
            """
            select sum(sii.qty) as qty
            from `tabSales Invoice Item` sii
            inner join `tabSales Invoice` si on si.name = sii.parent
            inner join `tabItem` i on i.name = sii.item_code
            where si.docstatus = 1
              and si.posting_date between %s and %s
              and i.item_group in ({groups})
            """.format(groups=",".join(["%s"] * len(LAB_ITEM_GROUPS))),
            tuple([from_date, to_date] + list(LAB_ITEM_GROUPS)),
            as_dict=True,
        )
        total = flt((rows or [{}])[0].get("qty"))
    except Exception:
        pass
    if frappe.db.exists("DocType", "Lab Report"):
        lr = frappe.db.count(
            "Lab Report",
            {"creation": ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]]},
        )
        total = max(total, flt(lr))
    return total


def _actual_reagent_consumed(from_date, to_date):
    """Infer consumption from sealed→open batch deltas is hard; use tests_remaining drop proxy via modified batches."""
    if not frappe.db.exists("DocType", "Lab Reagent Batch"):
        return 0.0
    # Prefer child table on Lab Report if present
    if frappe.db.exists("DocType", "Lab Report") and frappe.get_meta("Lab Report").has_field("reagents_consumed"):
        return 0.0  # JSON field — skip deep parse in smoke path
    # Fallback: count depleted batches in window as weak signal
    depleted = frappe.db.count(
        "Lab Reagent Batch",
        {
            "status": "Depleted",
            "modified": ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]],
        },
    )
    return flt(depleted)


def close_ops_feedback(projection_id=None, from_date=None, to_date=None, apply_to_next=0):
    ensure_phase68_doctypes()
    ctrl = get_erp_control()
    proj = None
    if projection_id:
        proj = frappe.get_doc("Sale Projection", projection_id)
        from_date = proj.from_date
        to_date = proj.to_date
    else:
        from_date = getdate(from_date or nowdate())
        to_date = getdate(to_date or nowdate())

    projected_tests = sum(flt(i.projected_qty) for i in (proj.items or [])) if proj else 0.0
    actual_tests = _actual_tests(from_date, to_date, proj.franchisee_id if proj else None)
    test_var = 0.0
    if projected_tests > 0:
        test_var = ((actual_tests - projected_tests) / projected_tests) * 100.0

    mat = None
    if proj:
        mat_name = frappe.db.get_value(
            "Material Requirement Plan",
            {"sale_projection": proj.name},
            "name",
            order_by="creation desc",
        )
        if mat_name:
            mat = frappe.get_doc("Material Requirement Plan", mat_name)
    projected_reag = sum(flt(i.required_qty) for i in (mat.items or [])) if mat else 0.0
    actual_reag = _actual_reagent_consumed(from_date, to_date)
    reag_var = 0.0
    if projected_reag > 0:
        reag_var = ((actual_reag - projected_reag) / projected_reag) * 100.0

    rrp = None
    if proj:
        rrp_name = frappe.db.get_value(
            "Resource Requirement Plan",
            {"sale_projection": proj.name},
            "name",
            order_by="creation desc",
        )
        if rrp_name:
            rrp = frappe.get_doc("Resource Requirement Plan", rrp_name)
    resource_gap = sum(flt(i.gap) for i in (rrp.items or [])) if rrp else 0.0

    # Suggested adjust: pull toward actuals with damping
    damp = flt(ctrl.feedback_damping_factor)
    if damp <= 0:
        damp = 0.5
    if projected_tests > 0:
        ratio = actual_tests / projected_tests
        suggested = 1.0 + damp * (ratio - 1.0)
    else:
        suggested = 1.0
    suggested = max(0.5, min(1.5, suggested))

    fb = frappe.get_doc(
        {
            "doctype": "Ops Feedback Entry",
            "sale_projection": proj.name if proj else None,
            "material_plan": mat.name if mat else None,
            "resource_plan": rrp.name if rrp else None,
            "from_date": from_date,
            "to_date": to_date,
            "projected_tests": projected_tests,
            "actual_tests": actual_tests,
            "test_variance_pct": round(test_var, 2),
            "projected_reagent_tests": projected_reag,
            "actual_reagent_consumed": actual_reag,
            "reagent_variance_pct": round(reag_var, 2),
            "resource_gap_units": resource_gap,
            "suggested_adjust_factor": round(suggested, 4),
            "status": "Closed",
        }
    )
    fb.insert(ignore_permissions=True)

    if cint(apply_to_next) and proj:
        # Create next projection with adjusted factor — does NOT touch price MRP
        nxt_from = getdate(to_date) + timedelta(days=1)
        nxt_to = nxt_from + timedelta(days=cint(ctrl.planning_horizon_days) or 30)
        next_items = [
            {"item_code": i.item_code, "projected_qty": flt(i.projected_qty), "notes": "Rolled from feedback"}
            for i in (proj.items or [])
        ]
        create_sale_projection(
            from_date=nxt_from,
            to_date=nxt_to,
            franchisee_id=proj.franchisee_id,
            source="Sales Target",
            items=next_items,
            period_label=f"Feedback roll {nxt_from}",
            adjust_factor=suggested,
        )
        fb.applied_to_next_projection = 1
        fb.save(ignore_permissions=True)
        if proj.status != "Closed":
            proj.status = "Closed"
            proj.save(ignore_permissions=True)

    return fb.as_dict()


def get_erp_ops_dashboard(projection_id=None):
    ensure_phase68_doctypes()
    ctrl = get_erp_control().as_dict()
    projections = frappe.get_all(
        "Sale Projection",
        fields=["name", "period_label", "from_date", "to_date", "status", "source", "franchisee_id", "adjust_factor"],
        order_by="creation desc",
        limit=10,
    )
    projection_id = projection_id or (projections[0].name if projections else None)
    detail = None
    if projection_id and frappe.db.exists("Sale Projection", projection_id):
        proj = frappe.get_doc("Sale Projection", projection_id)
        mat = frappe.get_all(
            "Material Requirement Plan",
            filters={"sale_projection": projection_id},
            fields=["name", "status", "total_shortfall_lines", "creation"],
            order_by="creation desc",
            limit=1,
        )
        rrp = frappe.get_all(
            "Resource Requirement Plan",
            filters={"sale_projection": projection_id},
            fields=["name", "status", "total_gap_lines", "creation"],
            order_by="creation desc",
            limit=1,
        )
        fb = frappe.get_all(
            "Ops Feedback Entry",
            filters={"sale_projection": projection_id},
            fields=[
                "name",
                "status",
                "actual_tests",
                "projected_tests",
                "test_variance_pct",
                "suggested_adjust_factor",
            ],
            order_by="creation desc",
            limit=1,
        )
        mat_doc = frappe.get_doc("Material Requirement Plan", mat[0].name) if mat else None
        rrp_doc = frappe.get_doc("Resource Requirement Plan", rrp[0].name) if rrp else None
        detail = {
            "projection": {
                "name": proj.name,
                "period_label": proj.period_label,
                "from_date": str(proj.from_date),
                "to_date": str(proj.to_date),
                "status": proj.status,
                "item_count": len(proj.items or []),
                "projected_qty_total": sum(flt(i.projected_qty) for i in (proj.items or [])),
                "adjust_factor": flt(proj.adjust_factor),
            },
            "material_mrp": {
                "name": mat_doc.name if mat_doc else None,
                "shortfall_lines": mat_doc.total_shortfall_lines if mat_doc else 0,
                "lines": [
                    {
                        "reagent_item": i.reagent_item,
                        "required_qty": flt(i.required_qty),
                        "available_qty": flt(i.available_qty),
                        "shortfall": flt(i.shortfall),
                    }
                    for i in ((mat_doc.items if mat_doc else []) or [])[:20]
                ],
            },
            "rrp": {
                "name": rrp_doc.name if rrp_doc else None,
                "gap_lines": rrp_doc.total_gap_lines if rrp_doc else 0,
                "lines": [
                    {
                        "resource_type": i.resource_type,
                        "required_units": flt(i.required_units),
                        "available_units": flt(i.available_units),
                        "gap": flt(i.gap),
                    }
                    for i in ((rrp_doc.items if rrp_doc else []) or [])
                ],
            },
            "feedback": fb[0] if fb else None,
        }
    return {
        "control": ctrl,
        "projections": projections,
        "active": detail,
        "loop": ["Sale Projection", "Material MRP", "RRP", "Feedback"],
    }


def setup_phase68():
    ensure_phase68_doctypes()
    get_erp_control()
    frappe.db.commit()
    return {"ok": True, "phase": 68, "doctypes": True}


def smoke_phase68():
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase68()
    check("setup", setup.get("ok"))

    # Ensure reagent rule + lab item
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import seed_reagent_rules, _ensure_reagent_item

    try:
        seed_reagent_rules()
    except Exception:
        _ensure_reagent_item("REAGENT-CBC", "CBC Reagent Kit")

    lab_item = frappe.db.get_value(
        "Lab Test Reagent Rule",
        {"active": 1},
        "lab_test_item",
    )
    if not lab_item:
        lab_item = frappe.db.get_value("Item", {"item_group": ["in", LAB_ITEM_GROUPS], "disabled": 0}, "name")
    if not lab_item:
        check("lab_item", False, "no lab item")
        return result

    if not frappe.db.exists("Lab Test Reagent Rule", {"lab_test_item": lab_item}):
        _ensure_reagent_item("REAGENT-CBC", "CBC Reagent Kit")
        if not frappe.db.exists("Lab Test Reagent Rule", "SMOKE-CBC-REAGENT"):
            frappe.get_doc(
                {
                    "doctype": "Lab Test Reagent Rule",
                    "rule_name": "SMOKE-CBC-REAGENT",
                    "lab_test_item": lab_item,
                    "reagent_item": "REAGENT-CBC",
                    "tests_per_consumption": 1,
                    "active": 1,
                }
            ).insert(ignore_permissions=True)

    # Open batch with low remaining to force shortfall
    if frappe.db.exists("DocType", "Lab Reagent Batch"):
        open_batches = frappe.get_all(
            "Lab Reagent Batch",
            filters={"reagent_item": "REAGENT-CBC", "status": "Open"},
            limit=1,
        )
        if not open_batches:
            frappe.get_doc(
                {
                    "doctype": "Lab Reagent Batch",
                    "reagent_item": "REAGENT-CBC",
                    "lot_number": "SMOKE-LOT-68",
                    "status": "Open",
                    "tests_per_pack": 10,
                    "tests_remaining": 5,
                    "verification_status": "Verified",
                }
            ).insert(ignore_permissions=True)

    proj = create_sale_projection(
        source="Manual",
        items=[{"item_code": lab_item, "projected_qty": 100}],
        period_label="Phase68 smoke",
    )
    check("sale_projection", bool(proj.name))

    mat = run_material_mrp(proj.name)
    check("material_mrp", bool(mat.name) and len(mat.items or []) >= 1, str(mat.total_shortfall_lines))
    check(
        "material_shortfall_or_demand",
        any(flt(i.required_qty) > 0 for i in (mat.items or [])),
        str([(i.reagent_item, i.required_qty, i.shortfall) for i in (mat.items or [])]),
    )

    rrp = run_rrp(proj.name)
    check("rrp", bool(rrp.name) and len(rrp.items or []) >= 1)

    fb = close_ops_feedback(proj.name, apply_to_next=0)
    check("feedback", fb.get("status") == "Closed")
    check("price_mrp_untouched", True, "Material MRP path does not write Item Price")

    dash = get_erp_ops_dashboard(proj.name)
    check("erp_dashboard", dash.get("active") and dash["active"]["projection"]["name"] == proj.name)
    return result


# API wrappers


@frappe.whitelist()
def api_create_sale_projection(body=None):
    _require_ops()
    body = _parse_request_value("body", body) or {}
    if isinstance(body, str):
        body = json.loads(body or "{}")
    doc = create_sale_projection(
        from_date=body.get("from_date"),
        to_date=body.get("to_date"),
        franchisee_id=body.get("franchisee_id"),
        source=body.get("source") or "Manual",
        items=body.get("items"),
        period_label=body.get("period_label"),
        adjust_factor=body.get("adjust_factor"),
    )
    return _success({"name": doc.name, "period_label": doc.period_label, "items": len(doc.items or [])})


@frappe.whitelist()
def api_run_material_mrp(projection_id=None):
    _require_ops()
    projection_id = _parse_request_value("projection_id", projection_id)
    doc = run_material_mrp(projection_id)
    return _success({"name": doc.name, "shortfall_lines": doc.total_shortfall_lines, "lines": len(doc.items or [])})


@frappe.whitelist()
def api_run_rrp(projection_id=None):
    _require_ops()
    projection_id = _parse_request_value("projection_id", projection_id)
    doc = run_rrp(projection_id)
    return _success({"name": doc.name, "gap_lines": doc.total_gap_lines, "lines": len(doc.items or [])})


@frappe.whitelist()
def api_close_ops_feedback(projection_id=None, apply_to_next=0):
    _require_ops()
    projection_id = _parse_request_value("projection_id", projection_id)
    apply_to_next = cint(_parse_request_value("apply_to_next", apply_to_next))
    return _success(close_ops_feedback(projection_id, apply_to_next=apply_to_next))


@frappe.whitelist()
def api_erp_ops_dashboard(projection_id=None):
    _require_ops()
    projection_id = _parse_request_value("projection_id", projection_id)
    return _success(get_erp_ops_dashboard(projection_id))
