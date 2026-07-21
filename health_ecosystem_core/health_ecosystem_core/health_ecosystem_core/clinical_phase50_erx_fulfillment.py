"""Phase 50 — E-Rx pharmacy fulfillment queue + patient notifications."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

STAFF_ERX_ROLES = {
    "Health System Admin",
    "System Manager",
    "Franchisee Operator",
}

ACTIVE_ERX_STATUSES = ("Pending", "Confirmed", "Packed", "Out for Delivery")
DONE_ERX_STATUSES = ("Delivered", "Cancelled")


def ensure_phase50_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Pharmacy Order": [
                {
                    "fieldname": "clinical_prescription",
                    "label": "Clinical Prescription",
                    "fieldtype": "Link",
                    "options": "Clinical Prescription",
                    "insert_after": "order_kind",
                },
            ],
        },
        update=True,
    )


def _can_manage_erx(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & STAFF_ERX_ROLES) or is_staff(roles)


def _serialize_erx_items(raw_items):
    try:
        parsed = json.loads(raw_items or "[]")
    except Exception:
        parsed = []
    if not isinstance(parsed, list):
        return []
    rows = []
    for row in parsed:
        if not isinstance(row, dict) or row.get("_request_type"):
            continue
        item_code = row.get("item_code") or row.get("medicine_item")
        if not item_code:
            continue
        rows.append(
            {
                "item_code": item_code,
                "item_name": row.get("item_name")
                or frappe.db.get_value("Item", item_code, "item_name")
                or item_code,
                "qty": row.get("qty", 1),
                "rate": row.get("rate"),
                "dosage": row.get("dosage"),
                "frequency": row.get("frequency"),
                "duration": row.get("duration"),
            }
        )
    return rows


def _serialize_erx_order(name):
    doc = frappe.get_doc("Pharmacy Order", name)
    rx = getattr(doc, "clinical_prescription", None)
    return {
        "name": doc.name,
        "customer_name": doc.customer_name,
        "customer_phone": doc.customer_phone,
        "delivery_address": doc.delivery_address,
        "order_total": doc.order_total,
        "delivery_status": doc.delivery_status,
        "razorpay_payment_status": doc.razorpay_payment_status,
        "payment_method": getattr(doc, "payment_method", None),
        "order_kind": getattr(doc, "order_kind", None),
        "clinical_prescription": rx,
        "doctor_name": frappe.db.get_value("Clinical Prescription", rx, "doctor") if rx else None,
        "pharmacist_notes": getattr(doc, "pharmacist_notes", None),
        "creation": str(doc.creation),
        "modified": str(doc.modified),
        "items": _serialize_erx_items(doc.items_json),
    }


def link_pharmacy_order_to_prescription(order_id, prescription_id, order_kind="E-Rx"):
    """Called after patient orders medicines from an e-prescription."""
    ensure_phase50_fields()
    if not order_id or not frappe.db.exists("Pharmacy Order", order_id):
        return
    updates = {}
    meta = frappe.get_meta("Pharmacy Order")
    if meta.has_field("clinical_prescription") and prescription_id:
        updates["clinical_prescription"] = prescription_id
    if meta.has_field("order_kind"):
        updates["order_kind"] = order_kind
    if updates:
        frappe.db.set_value("Pharmacy Order", order_id, updates, update_modified=True)


@frappe.whitelist()
def list_erx_pharmacy_queue(limit=50, sid=None):
    """Staff queue for pharmacy orders created from clinical e-prescriptions."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_manage_erx():
        return _error(_("Only pharmacy staff can view the e-Rx queue"), 403)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50

    pending_names = frappe.get_all(
        "Pharmacy Order",
        filters={
            "clinical_prescription": ["is", "set"],
            "delivery_status": ["in", list(ACTIVE_ERX_STATUSES)],
        },
        pluck="name",
        order_by="modified desc",
        limit=limit,
    )
    recent_names = frappe.get_all(
        "Pharmacy Order",
        filters={
            "clinical_prescription": ["is", "set"],
            "delivery_status": ["in", list(DONE_ERX_STATUSES)],
        },
        pluck="name",
        order_by="modified desc",
        limit=min(limit, 20),
    )

    return _success(
        {
            "pending": [_serialize_erx_order(n) for n in pending_names],
            "recent": [_serialize_erx_order(n) for n in recent_names],
            "summary": {
                "pending_count": len(pending_names),
                "awaiting_payment": frappe.db.count(
                    "Pharmacy Order",
                    {
                        "clinical_prescription": ["is", "set"],
                        "delivery_status": ["in", list(ACTIVE_ERX_STATUSES)],
                        "razorpay_payment_status": "Pending",
                    },
                ),
            },
        }
    )


@frappe.whitelist()
def update_erx_pharmacy_order(
    order_id=None,
    delivery_status=None,
    pharmacist_notes=None,
    notify=1,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_manage_erx():
        return _error(_("Not authorized"), 403)

    order_id = (_parse_request_value("order_id", order_id) or "").strip()
    if not order_id or not frappe.db.exists("Pharmacy Order", order_id):
        return _error(_("Order not found"), 404)

    order = frappe.get_doc("Pharmacy Order", order_id)
    if not getattr(order, "clinical_prescription", None):
        return _error(_("Not an e-prescription pharmacy order"), 400)

    status = (_parse_request_value("delivery_status", delivery_status) or "").strip()
    allowed = set(ACTIVE_ERX_STATUSES) | set(DONE_ERX_STATUSES)
    if status and status not in allowed:
        return _error(_("Invalid delivery status"))

    if status:
        order.delivery_status = status
    notes = _parse_request_value("pharmacist_notes", pharmacist_notes)
    if notes is not None and frappe.get_meta("Pharmacy Order").has_field("pharmacist_notes"):
        order.pharmacist_notes = notes
    order.save(ignore_permissions=True)
    frappe.db.commit()

    if str(notify) in ("1", "true", "True") and status:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
                notify_erx_pharmacy_status,
            )

            notify_erx_pharmacy_status(order.name)
        except Exception:
            pass

    return _success({"order": _serialize_erx_order(order.name)}, message=_("Order updated"))


def setup_phase50_erx_fulfillment():
    ensure_phase50_fields()
    frappe.clear_cache(doctype="Pharmacy Order")
    return {"ok": True, "phase": "50", "feature": "erx_fulfillment"}
