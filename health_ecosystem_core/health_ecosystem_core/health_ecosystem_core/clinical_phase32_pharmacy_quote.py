"""Phase 32 — Chronic pharmacy quote ops: staff price → patient notify → pay online."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

STAFF_QUOTE_ROLES = {
    "Health System Admin",
    "System Manager",
    "Franchisee Operator",
}


def ensure_phase32_custom_fields():
    """Legacy hook — fields now live on Pharmacy Order DocType JSON."""
    meta = frappe.get_meta("Pharmacy Order")
    if meta.has_field("quote_sent_on") and meta.has_field("pharmacist_notes"):
        return
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Pharmacy Order": [
                {
                    "fieldname": "quote_sent_on",
                    "label": "Quote Sent On",
                    "fieldtype": "Datetime",
                    "insert_after": "order_kind",
                    "read_only": 1,
                },
                {
                    "fieldname": "pharmacist_notes",
                    "label": "Pharmacist Notes",
                    "fieldtype": "Small Text",
                    "insert_after": "quote_sent_on",
                },
            ],
        },
        update=True,
    )


def _can_send_quote(roles=None):
    roles = roles or _user_roles()
    return bool(set(roles) & STAFF_QUOTE_ROLES) or is_staff(roles)


def _parse_quote_items(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    text = str(raw).strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception as exc:
        frappe.throw(_("Items must be valid JSON: {0}").format(exc))
    if not isinstance(parsed, list):
        frappe.throw(_("Items must be a JSON array"))
    cleaned = []
    for row in parsed:
        if not isinstance(row, dict):
            continue
        if row.get("_request_type") == "chronic_quote":
            continue
        name = (row.get("item_name") or row.get("name") or "").strip()
        if not name:
            continue
        qty = flt(row.get("qty") or 1) or 1
        rate = flt(row.get("rate") or 0)
        cleaned.append(
            {
                "item_name": name,
                "item_code": (row.get("item_code") or name)[:140],
                "qty": qty,
                "rate": rate,
                "amount": flt(row.get("amount") or qty * rate),
            }
        )
    return cleaned


def _merge_quote_items(existing_json, quoted_items):
    meta = []
    try:
        existing = json.loads(existing_json or "[]")
        if isinstance(existing, list):
            meta = [i for i in existing if isinstance(i, dict) and i.get("_request_type") == "chronic_quote"]
    except Exception:
        meta = []
    return json.dumps(meta + quoted_items)


def notify_pharmacy_quote_ready(order):
    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import queue_patient_notification

    queue_patient_notification(
        "pharmacy_quote_ready",
        patient_name=order.customer_name,
        patient_phone=order.customer_phone,
        order_id=order.name,
        order_total=flt(order.order_total),
        duration_months=str(getattr(order, "duration_months", None) or ""),
    )


@frappe.whitelist()
def list_pharmacy_quote_queue(limit=50, sid=None):
    """Staff queue: chronic pack quotes awaiting pricing or recently sent."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_send_quote():
        return _error(_("Only pharmacy staff can view the quote queue"), 403)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50

    fields = [
        "name",
        "customer_name",
        "customer_phone",
        "delivery_address",
        "order_total",
        "delivery_status",
        "duration_months",
        "desired_discount_slab",
        "order_kind",
        "pharmacist_notes",
        "quote_sent_on",
        "uploaded_prescription_url",
        "modified",
        "creation",
    ]

    pending = frappe.get_all(
        "Pharmacy Order",
        filters={"delivery_status": "Quotation Pending"},
        fields=fields,
        order_by="modified desc",
        limit=limit,
    )
    sent = frappe.get_all(
        "Pharmacy Order",
        filters={"delivery_status": "Quote Sent"},
        fields=fields,
        order_by="modified desc",
        limit=min(limit, 20),
    )

    from health_ecosystem_core.health_ecosystem_core.api import _enrich_pharmacy_order_items

    pending = _enrich_pharmacy_order_items(pending)
    sent = _enrich_pharmacy_order_items(sent)

    return _success(
        {
            "pending": pending,
            "sent_recent": sent,
            "pending_count": len(pending),
            "sent_count": len(sent),
        }
    )


@frappe.whitelist()
def send_pharmacy_quote(
    order_id=None,
    order_total=None,
    items_json=None,
    pharmacist_notes=None,
    sid=None,
):
    """Staff sends priced quote to patient (Quotation Pending → Quote Sent)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not _can_send_quote():
        return _error(_("Only pharmacy staff can send quotes"), 403)

    order_id = (_parse_request_value("order_id", order_id) or "").strip()
    if not order_id or not frappe.db.exists("Pharmacy Order", order_id):
        return _error(_("Pharmacy order not found"), 404)

    order = frappe.get_doc("Pharmacy Order", order_id)
    if order.delivery_status not in ("Quotation Pending", "Quote Sent"):
        return _error(_("Order is not awaiting a quote ({0})").format(order.delivery_status))

    total = flt(_parse_request_value("order_total", order_total))
    if total <= 0:
        return _error(_("Enter a quote total greater than zero"))

    quoted_items = _parse_quote_items(_parse_request_value("items_json", items_json))
    if not quoted_items:
        return _error(_("Add at least one medicine line item"))

    notes = (_parse_request_value("pharmacist_notes", pharmacist_notes) or "").strip()
    order.order_total = total
    order.items_json = _merge_quote_items(order.items_json, quoted_items)
    order.delivery_status = "Quote Sent"
    if frappe.get_meta("Pharmacy Order").has_field("quote_sent_on"):
        order.quote_sent_on = now_datetime()
    if frappe.get_meta("Pharmacy Order").has_field("pharmacist_notes"):
        order.pharmacist_notes = notes
    order.save(ignore_permissions=True)
    frappe.db.commit()

    notify_pharmacy_quote_ready(order)

    return _success(
        {
            "order_id": order.name,
            "delivery_status": order.delivery_status,
            "order_total": total,
            "item_count": len(quoted_items),
        },
        message=_("Quote sent to patient"),
    )


@frappe.whitelist()
def accept_pharmacy_quote(order_id=None, sid=None):
    """Patient acknowledges quote — ready for online payment."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    order_id = (_parse_request_value("order_id", order_id) or "").strip()
    if not order_id or not frappe.db.exists("Pharmacy Order", order_id):
        return _error(_("Pharmacy order not found"), 404)

    order = frappe.get_doc("Pharmacy Order", order_id)
    if order.delivery_status != "Quote Sent":
        return _error(_("No open quote on this order"))
    if flt(order.order_total) <= 0:
        return _error(_("Quote total is missing"))

    return _success(
        {
            "order_id": order.name,
            "order_total": flt(order.order_total),
            "delivery_status": order.delivery_status,
            "razorpay_payment_status": order.razorpay_payment_status,
        },
        message=_("Quote accepted — proceed to payment"),
    )


def setup_phase32_pharmacy_quote():
    ensure_phase32_custom_fields()
    _patch_delivery_status_options()
    frappe.db.commit()
    frappe.clear_cache(doctype="Pharmacy Order")
    return {"ok": True, "phase": "32", "feature": "pharmacy_quote_ops"}


def _patch_delivery_status_options():
    """Ensure Quote Sent is available on Pharmacy Order delivery_status."""
    doc = frappe.get_doc("DocType", "Pharmacy Order")
    for field in doc.fields:
        if field.fieldname != "delivery_status":
            continue
        options = [o.strip() for o in (field.options or "").split("\n") if o.strip()]
        if "Quote Sent" not in options:
            idx = options.index("Quotation Pending") + 1 if "Quotation Pending" in options else len(options)
            options.insert(idx, "Quote Sent")
            field.options = "\n".join(options)
            doc.save(ignore_permissions=True)
        break
