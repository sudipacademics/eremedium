"""Phase 24 — Lab reagent batch rotation: open pack quotas and auto-decrement on test completion."""

from __future__ import annotations

import os

import frappe
from frappe import _
from frappe.utils import cint, flt, today

REAGENT_ITEM_GROUP = "Consumables"
LOW_STOCK_RATIO = 0.1
LOW_STOCK_ABSOLUTE = 5
LAB_OPS_ROLES = ("Lab Technician", "Pathologist", "Health System Admin", "System Manager")

PHASE24_DOCTYPES = (
    ("lab_reagent_batch", "Lab Reagent Batch"),
    ("lab_test_reagent_rule", "Lab Test Reagent Rule"),
)

DEFAULT_REAGENT_ITEMS = (
    ("REAGENT-CBC", "CBC Reagent Kit"),
    ("REAGENT-LFT", "LFT Reagent Kit"),
    ("REAGENT-TSH", "TSH Reagent Kit"),
)

DEFAULT_RULES = (
    ("CBC-001 → CBC Reagent", "CBC-001", "REAGENT-CBC", 1),
    ("LFT-001 → LFT Reagent", "LFT-001", "REAGENT-LFT", 1),
    ("TSH-001 → TSH Reagent", "TSH-001", "REAGENT-TSH", 1),
    ("HBA1C-001 → LFT Reagent", "HBA1C-001", "REAGENT-LFT", 1),
    ("LIPID-001 → LFT Reagent", "LIPID-001", "REAGENT-LFT", 1),
)


def is_lab_ops_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    roles = set(frappe.get_roles(user))
    return bool(roles.intersection(LAB_OPS_ROLES))


def _import_doctype(folder, doctype_name):
    if frappe.db.exists("DocType", doctype_name):
        return
    from frappe.modules.import_file import import_file_by_path

    candidates = []
    app_path = frappe.get_app_path("health_ecosystem_core")
    candidates.append(
        os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json")
    )
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
    except Exception:
        pass

    for json_path in candidates:
        if os.path.isfile(json_path):
            import_file_by_path(json_path, force=True)
            frappe.db.commit()
            frappe.clear_cache(doctype=doctype_name)
            if frappe.db.exists("DocType", doctype_name):
                return
    frappe.throw(_("Could not install {0} doctype").format(doctype_name))


def ensure_phase24_doctypes():
    for folder, doctype_name in PHASE24_DOCTYPES:
        _import_doctype(folder, doctype_name)


def ensure_phase24_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    ensure_phase24_doctypes()
    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "reagents_consumed",
                    "label": "Reagents Consumed",
                    "fieldtype": "Check",
                    "default": "0",
                    "insert_after": "platform_billed",
                    "read_only": 1,
                },
            ],
        },
        update=True,
    )


def _ensure_item_group(name):
    if frappe.db.exists("Item Group", name):
        return name
    parent = frappe.db.get_value("Item Group", {"is_group": 1}, "name") or "All Item Groups"
    frappe.get_doc(
        {"doctype": "Item Group", "item_group_name": name, "parent_item_group": parent, "is_group": 0}
    ).insert(ignore_permissions=True)
    return name


def _ensure_reagent_item(item_code, item_name):
    if frappe.db.exists("Item", item_code):
        return item_code
    _ensure_item_group(REAGENT_ITEM_GROUP)
    frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_name,
            "item_group": REAGENT_ITEM_GROUP,
            "stock_uom": "Nos",
            "is_stock_item": 1,
            "include_item_in_manufacturing": 0,
        }
    ).insert(ignore_permissions=True)
    return item_code


def seed_reagent_rules():
    for item_code, item_name in DEFAULT_REAGENT_ITEMS:
        _ensure_reagent_item(item_code, item_name)

    seeded = []
    for rule_name, test_item, reagent_item, qty in DEFAULT_RULES:
        if not frappe.db.exists("Item", test_item):
            continue
        _ensure_reagent_item(reagent_item, dict(DEFAULT_REAGENT_ITEMS).get(reagent_item, reagent_item))
        if frappe.db.exists("Lab Test Reagent Rule", rule_name):
            continue
        frappe.get_doc(
            {
                "doctype": "Lab Test Reagent Rule",
                "rule_name": rule_name,
                "lab_test_item": test_item,
                "reagent_item": reagent_item,
                "tests_per_consumption": qty,
                "active": 1,
            }
        ).insert(ignore_permissions=True)
        seeded.append(rule_name)
    return seeded


def _trf_test_items(trf):
    items = []
    if trf.get("test_required"):
        items.append(trf.test_required)
    for row in trf.get("tests") or []:
        code = row.get("item") if isinstance(row, dict) else getattr(row, "item", None)
        if code and code not in items:
            items.append(code)
    return items


def _rules_for_test_item(test_item):
    fields = ["name", "reagent_item", "tests_per_consumption"]
    if frappe.get_meta("Lab Test Reagent Rule").has_field("parameter_code"):
        fields.append("parameter_code")
    return frappe.get_all(
        "Lab Test Reagent Rule",
        filters={"lab_test_item": test_item, "active": 1},
        fields=fields,
    )


def _find_open_batch(reagent_item, franchisee_id=None):
    filters = {"reagent_item": reagent_item, "status": "Open", "tests_remaining": (">", 0)}
    if franchisee_id:
        batches = frappe.get_all(
            "Lab Reagent Batch",
            filters={**filters, "franchisee_id": franchisee_id},
            fields=["name", "tests_remaining", "tests_per_pack", "lot_number", "opened_on"],
            order_by="opened_on asc, creation asc",
            limit=1,
        )
        if batches:
            return batches[0]
    batches = frappe.get_all(
        "Lab Reagent Batch",
        filters=filters,
        fields=["name", "tests_remaining", "tests_per_pack", "lot_number", "opened_on"],
        order_by="opened_on asc, creation asc",
        limit=1,
    )
    return batches[0] if batches else None


def _batch_low_stock(batch):
    remaining = cint(batch.get("tests_remaining"))
    pack = cint(batch.get("tests_per_pack")) or remaining
    if remaining <= 0:
        return True
    if remaining <= LOW_STOCK_ABSOLUTE:
        return True
    return remaining <= max(1, int(pack * LOW_STOCK_RATIO))


def serialize_batch(row):
    if isinstance(row, str):
        row = frappe.get_doc("Lab Reagent Batch", row)
    pack = cint(row.tests_per_pack)
    remaining = cint(row.tests_remaining)
    return {
        "batch_id": row.name,
        "reagent_item": row.reagent_item,
        "reagent_name": frappe.db.get_value("Item", row.reagent_item, "item_name") or row.reagent_item,
        "lot_number": row.lot_number,
        "franchisee_id": row.get("franchisee_id"),
        "status": row.status,
        "verification_status": getattr(row, "verification_status", None) or "Pending",
        "verified_on": str(row.verified_on) if getattr(row, "verified_on", None) else None,
        "tests_per_pack": pack,
        "tests_remaining": remaining,
        "opened_on": str(row.opened_on) if row.opened_on else None,
        "expiry_date": str(row.expiry_date) if row.expiry_date else None,
        "low_stock": _batch_low_stock(row),
        "usage_percent": round((1 - remaining / pack) * 100, 1) if pack else 0,
    }


def get_reagent_dashboard_payload(user=None):
    if not is_lab_ops_user(user):
        return {"available": False, "reason": "lab_ops_required"}

    batches = frappe.get_all(
        "Lab Reagent Batch",
        filters={"status": ("in", ["Open", "Sealed"])},
        fields=["name"],
        order_by="modified desc",
        limit=100,
    )
    serialized = [serialize_batch(row.name) for row in batches]
    low_stock = [b for b in serialized if b["low_stock"] and b["status"] == "Open"]
    rules_count = frappe.db.count("Lab Test Reagent Rule", {"active": 1})

    return {
        "available": True,
        "batches": serialized,
        "low_stock_alerts": low_stock,
        "rules_count": rules_count,
        "reagent_items": [
            {"item_code": code, "item_name": name} for code, name in DEFAULT_REAGENT_ITEMS
        ],
    }


def register_reagent_batch(
    user,
    reagent_item,
    lot_number,
    tests_per_pack,
    expiry_date=None,
    franchisee_id=None,
    remarks=None,
):
    if not is_lab_ops_user(user):
        frappe.throw(_("Lab operations access required"))
    if not frappe.db.exists("Item", reagent_item):
        frappe.throw(_("Invalid reagent item"))
    tests_per_pack = cint(tests_per_pack)
    if tests_per_pack <= 0:
        frappe.throw(_("Tests per pack must be positive"))

    doc = frappe.get_doc(
        {
            "doctype": "Lab Reagent Batch",
            "reagent_item": reagent_item,
            "lot_number": lot_number,
            "tests_per_pack": tests_per_pack,
            "tests_remaining": 0,
            "status": "Sealed",
            "verification_status": "Pending",
            "franchisee_id": franchisee_id,
            "expiry_date": expiry_date,
            "remarks": remarks,
        }
    )
    doc.insert(ignore_permissions=True)
    return serialize_batch(doc)


def open_reagent_batch(user, batch_id):
    if not is_lab_ops_user(user):
        frappe.throw(_("Lab operations access required"))
    if not frappe.db.exists("Lab Reagent Batch", batch_id):
        frappe.throw(_("Batch not found"))

    batch = frappe.get_doc("Lab Reagent Batch", batch_id)
    if batch.status != "Sealed":
        frappe.throw(_("Only sealed packs can be opened"))
    if batch.expiry_date and str(batch.expiry_date) < today():
        batch.status = "Expired"
        batch.save(ignore_permissions=True)
        frappe.throw(_("This pack is past expiry"))

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_nabl_release_gates import (
            assert_batch_may_open,
        )

        assert_batch_may_open(batch)
    except ImportError:
        pass

    batch.status = "Open"
    batch.tests_remaining = cint(batch.tests_per_pack)
    batch.opened_on = today()
    batch.opened_by = user
    batch.save(ignore_permissions=True)
    return serialize_batch(batch)


def _decrement_batch(batch_id, quantity):
    batch = frappe.get_doc("Lab Reagent Batch", batch_id)
    remaining = cint(batch.tests_remaining) - cint(quantity)
    if remaining < 0:
        frappe.throw(
            _("Insufficient tests in batch {0} (lot {1})").format(batch.name, batch.lot_number),
            frappe.ValidationError,
        )
    batch.tests_remaining = remaining
    if remaining == 0:
        batch.status = "Depleted"
    batch.save(ignore_permissions=True)
    return batch


def consume_reagents_for_completed_trf(trf_name):
    """Debit open reagent batches when a TRF completes. Idempotent per TRF.

    Prefer Real-parameter reagent links / parameter-scoped rules (Phase 59).
    Calculated (derived) parameters never consume reagents.
    """
    if not frappe.db.exists("Customer TRF", trf_name):
        return {"ok": False, "reason": "trf_not_found"}

    meta = frappe.get_meta("Customer TRF")
    if meta.has_field("reagents_consumed") and frappe.db.get_value(
        "Customer TRF", trf_name, "reagents_consumed"
    ):
        return {"ok": True, "skipped": True, "reason": "already_consumed"}

    trf = frappe.get_doc("Customer TRF", trf_name)
    if trf.order_status != "Completed":
        return {"ok": False, "reason": "trf_not_completed", "status": trf.order_status}

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase59_parameter_inventory import (
            collect_real_parameter_consumptions,
        )

        planned, alerts = collect_real_parameter_consumptions(trf)
    except Exception:
        frappe.log_error(title="phase59_reagent_plan", message=frappe.get_traceback())
        planned, alerts = [], []

    # No Lab Report / Real results yet → fall back to whole-test Lab Test Reagent Rules
    if not planned and not alerts:
        franchisee_id = trf.get("franchisee_id")
        for test_item in _trf_test_items(trf):
            rules = _rules_for_test_item(test_item)
            for rule in rules:
                if rule.get("parameter_code"):
                    continue
                qty = cint(rule.tests_per_consumption) or 1
                batch = _find_open_batch(rule.reagent_item, franchisee_id=franchisee_id)
                if not batch:
                    alerts.append(
                        {
                            "test_item": test_item,
                            "reagent_item": rule.reagent_item,
                            "message": _("No open batch for {0}").format(rule.reagent_item),
                        }
                    )
                    continue
                planned.append(
                    {
                        "batch_id": batch.name,
                        "lot_number": batch.lot_number,
                        "reagent_item": rule.reagent_item,
                        "test_item": test_item,
                        "quantity": qty,
                    }
                )

    if alerts:
        return {"ok": False, "consumptions": [], "alerts": alerts}

    if not planned:
        return {"ok": True, "skipped": True, "reason": "no_reagent_rules", "consumptions": []}

    consumptions = []
    for row in planned:
        _decrement_batch(row["batch_id"], row["quantity"])
        consumptions.append(row)

    if meta.has_field("reagents_consumed"):
        frappe.db.set_value("Customer TRF", trf_name, "reagents_consumed", 1)

    frappe.db.commit()
    return {"ok": True, "consumptions": consumptions, "alerts": []}


def maybe_consume_reagents_on_trf_complete(trf_name):
    """Safe entry point — call whenever a TRF may have just reached Completed."""
    try:
        return consume_reagents_for_completed_trf(trf_name)
    except Exception:
        frappe.log_error(title="phase24_reagent_consume", message=frappe.get_traceback())
        return {"ok": False, "reason": "exception"}


def repair_completed_trf_reagent_consumption(limit=100):
    """Backfill reagent deductions for Completed TRFs not yet consumed."""
    meta = frappe.get_meta("Customer TRF")
    filters = {"order_status": "Completed"}
    if meta.has_field("reagents_consumed"):
        filters["reagents_consumed"] = 0

    names = frappe.get_all("Customer TRF", filters=filters, pluck="name", limit=cint(limit))
    results = []
    for name in names:
        results.append({"trf": name, **maybe_consume_reagents_on_trf_complete(name)})
    return results


def setup_phase24():
    ensure_phase24_custom_fields()
    seeded_rules = seed_reagent_rules()
    demo_batches = seed_demo_reagent_batches()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 24, "rules_seeded": seeded_rules, "demo_batches": demo_batches}


def seed_demo_reagent_batches():
    """Seed open + sealed demo packs for lab tech training."""
    seed_reagent_rules()
    created = []
    demos = (
        ("REAGENT-CBC", "DEMO-CBC-001", 50, "Open"),
        ("REAGENT-LFT", "DEMO-LFT-001", 80, "Sealed"),
    )
    for reagent_item, lot, pack_size, target_status in demos:
        existing = frappe.db.get_value("Lab Reagent Batch", {"lot_number": lot}, "name")
        if existing:
            continue
        doc = frappe.get_doc(
            {
                "doctype": "Lab Reagent Batch",
                "reagent_item": reagent_item,
                "lot_number": lot,
                "tests_per_pack": pack_size,
                "tests_remaining": pack_size if target_status == "Open" else 0,
                "status": target_status,
                "opened_on": today() if target_status == "Open" else None,
                "opened_by": "lab_tech@health.local" if target_status == "Open" else None,
                "remarks": "Phase 24 demo seed",
            }
        )
        doc.insert(ignore_permissions=True)
        created.append(doc.name)
    return created


def smoke_phase24_reagents():
    """Register → open → consume on Completed TRF → dashboard."""
    setup_phase24()
    user = "lab_tech@health.local"
    if not frappe.db.exists("User", user):
        user = frappe.session.user

    # Prefer CBC rule; else any active rule + matching reagent batch
    rule = frappe.db.get_value(
        "Lab Test Reagent Rule",
        {"reagent_item": "REAGENT-CBC", "active": 1},
        ["lab_test_item", "reagent_item"],
        as_dict=True,
    )
    if not rule:
        rule = frappe.db.get_value(
            "Lab Test Reagent Rule",
            {"active": 1},
            ["lab_test_item", "reagent_item"],
            as_dict=True,
        )
    test_item = rule.lab_test_item if rule else None
    reagent_item = (rule.reagent_item if rule else None) or "REAGENT-CBC"
    franchisee_id = frappe.db.get_value(
        "Franchisee Profile", {"active_status": "Active"}, "name"
    ) or frappe.db.get_value("Franchisee Profile", {}, "name")

    lot = f"SMOKE-{frappe.utils.now_datetime().strftime('%H%M%S')}"
    registered = register_reagent_batch(
        user, reagent_item, lot, 25, franchisee_id=franchisee_id
    )
    opened = open_reagent_batch(user, registered["batch_id"])
    before = cint(opened.get("tests_remaining"))

    consume_result = {"ok": False, "skipped_reason": "no_rule"}
    after = before
    if test_item and franchisee_id:
        trf = frappe.get_doc(
            {
                "doctype": "Customer TRF",
                "patient_name": "Reagent Smoke Patient",
                "patient_phone": "9000000024",
                "age": 35,
                "gender": "Female",
                "test_required": test_item,
                "tests": [{"item": test_item, "amount": 100}],
                "franchisee_id": franchisee_id,
                "collection_address": "Smoke Lab",
                "amount": 100,
                "payment_method": "Pay at Hub",
                "razorpay_payment_status": "Paid",
                "order_status": "Booked",
            }
        )
        trf.insert(ignore_permissions=True)
        # Avoid on_update auto-consume racing the explicit smoke call
        frappe.db.set_value("Customer TRF", trf.name, "order_status", "Completed")
        if frappe.get_meta("Customer TRF").has_field("reagents_consumed"):
            frappe.db.set_value("Customer TRF", trf.name, "reagents_consumed", 0)
        consume_result = consume_reagents_for_completed_trf(trf.name)
        after = cint(frappe.db.get_value("Lab Reagent Batch", registered["batch_id"], "tests_remaining"))
        consume_result["tests_remaining_after"] = after
        consume_result["decremented"] = after < before
        try:
            frappe.delete_doc("Customer TRF", trf.name, force=1, ignore_permissions=True)
        except Exception:
            pass
        frappe.db.commit()
    else:
        after = before

    dashboard = get_reagent_dashboard_payload(user)

    passed = (
        dashboard.get("available")
        and opened.get("status") == "Open"
        and before == 25
        and len(dashboard.get("batches") or []) > 0
        and (
            not test_item
            or (
                consume_result.get("ok")
                and consume_result.get("decremented")
            )
        )
    )
    return {
        "pass": passed,
        "registered": registered.get("batch_id"),
        "opened_status": opened.get("status"),
        "tests_remaining_before": before,
        "tests_remaining_after": after if test_item else before,
        "consume": consume_result,
        "batch_count": len(dashboard.get("batches") or []),
        "rules_count": dashboard.get("rules_count"),
        "low_stock_alerts": len(dashboard.get("low_stock_alerts") or []),
    }
