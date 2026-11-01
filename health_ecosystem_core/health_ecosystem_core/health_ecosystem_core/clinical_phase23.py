"""Phase 23 — B2B franchise portal: dual pricing, wallet, and walk-in orders."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, today

LAB_ITEM_GROUPS = ("Lab Tests", "Services", "Laboratory", "Diagnostics", "Lab")
MIN_WALLET_RECHARGE = 500


def _ensure_wallet_doctype():
    if frappe.db.exists("DocType", "Franchisee Wallet Transaction"):
        return
    import os

    from frappe.modules.import_file import import_file_by_path

    candidates = []
    app_path = frappe.get_app_path("health_ecosystem_core")
    candidates.append(
        os.path.join(
            app_path,
            "health_ecosystem_core",
            "doctype",
            "franchisee_wallet_transaction",
            "franchisee_wallet_transaction.json",
        )
    )
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(
            os.path.join(
                pkg_root,
                "doctype",
                "franchisee_wallet_transaction",
                "franchisee_wallet_transaction.json",
            )
        )
    except Exception:
        pass

    for json_path in candidates:
        if os.path.isfile(json_path):
            import_file_by_path(json_path, force=True)
            frappe.db.commit()
            frappe.clear_cache(doctype="Franchisee Wallet Transaction")
            if frappe.db.exists("DocType", "Franchisee Wallet Transaction"):
                return

    frappe.throw(_("Could not install Franchisee Wallet Transaction doctype"))


def ensure_phase23_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    _ensure_wallet_doctype()

    create_custom_fields(
        {
            "Franchisee Profile": [
                {
                    "fieldname": "platform_customer",
                    "label": "Platform Customer",
                    "fieldtype": "Link",
                    "options": "Customer",
                    "insert_after": "address",
                },
                {
                    "fieldname": "retail_price_list",
                    "label": "Retail Price List (MRP)",
                    "fieldtype": "Link",
                    "options": "Price List",
                    "insert_after": "platform_customer",
                },
                {
                    "fieldname": "wholesale_price_list",
                    "label": "Wholesale Price List",
                    "fieldtype": "Link",
                    "options": "Price List",
                    "insert_after": "retail_price_list",
                },
                {
                    "fieldname": "wallet_balance",
                    "label": "Wallet Balance",
                    "fieldtype": "Currency",
                    "default": "0",
                    "insert_after": "wholesale_price_list",
                    "read_only": 1,
                },
            ],
            "Customer TRF": [
                {
                    "fieldname": "wholesale_amount",
                    "label": "Wholesale Amount (platform)",
                    "fieldtype": "Currency",
                    "insert_after": "amount",
                },
                {
                    "fieldname": "platform_billed",
                    "label": "Platform Billed",
                    "fieldtype": "Check",
                    "default": "0",
                    "insert_after": "wholesale_amount",
                },
                {
                    "fieldname": "platform_sales_invoice",
                    "label": "Platform Sales Invoice",
                    "fieldtype": "Link",
                    "options": "Sales Invoice",
                    "insert_after": "sales_invoice",
                    "read_only": 1,
                },
            ],
        },
        update=True,
    )


def _default_company():
    company = frappe.defaults.get_global_default("company")
    if company:
        return company
    rows = frappe.get_all("Company", limit=1, pluck="name")
    return rows[0] if rows else None


def _default_selling_price_list():
    return (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        or "Standard Selling"
    )


def _price_from_list(item_code, price_list):
    if not item_code:
        return 0
    if price_list:
        rate = frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list},
            "price_list_rate",
        )
        if rate:
            return flt(rate)
    return flt(frappe.db.get_value("Item", item_code, "standard_rate"))


def _lab_items(limit=5000):
    # Match ERP Lab Tests / public catalog — do not include Services (consultations).
    lab_groups = tuple(g for g in LAB_ITEM_GROUPS if g != "Services")
    rows = frappe.get_all(
        "Item",
        filters={"disabled": 0, "is_sales_item": 1, "item_group": ("in", list(lab_groups))},
        fields=["name", "item_name", "item_group", "standard_rate"],
        order_by="item_name asc",
        limit=limit,
    )
    if rows:
        return rows
    return frappe.get_all(
        "Item",
        filters={"disabled": 0, "standard_rate": (">", 0)},
        or_filters=[
            ["item_group", "in", list(LAB_ITEM_GROUPS)],
            ["name", "like", "%-001"],
        ],
        fields=["name", "item_name", "item_group", "standard_rate"],
        order_by="item_name asc",
        limit=limit,
    )


def resolve_franchisee_for_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    name = frappe.db.get_value("Franchisee Profile", {"linked_user": user}, "name")
    if name and frappe.db.get_value("Franchisee Profile", name, "active_status") == "Active":
        return name
    return None


def _ensure_price_list(name, currency="INR"):
    if frappe.db.exists("Price List", name):
        doc = frappe.get_doc("Price List", name)
        if not doc.enabled:
            doc.enabled = 1
            doc.save(ignore_permissions=True)
        return name
    frappe.get_doc(
        {
            "doctype": "Price List",
            "price_list_name": name,
            "currency": currency,
            "enabled": 1,
            "selling": 1,
        }
    ).insert(ignore_permissions=True)
    return name


def _upsert_item_price(item_code, price_list, rate):
    rate = flt(rate)
    if rate <= 0:
        return
    existing = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list},
        "name",
    )
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
        return
    frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": price_list,
            "price_list_rate": rate,
            "selling": 1,
        }
    ).insert(ignore_permissions=True)


def _seed_franchisee_price_lists(profile):
    """Assign shared company MRP + Vector/Pulse rate lists (no per-branch MRP clones)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        assign_shared_price_lists,
    )

    result = assign_shared_price_lists(profile)
    return result["retail_price_list"], result["wholesale_price_list"]


def _ensure_platform_customer(profile):
    if profile.get("platform_customer") and frappe.db.exists("Customer", profile.platform_customer):
        return profile.platform_customer

    from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import sales_company

    company = sales_company() or _default_company()
    customer_name = f"{profile.franchise_name} ({profile.branch_code})"
    existing = frappe.db.get_value("Customer", {"customer_name": customer_name}, "name")
    if existing:
        profile.db_set("platform_customer", existing)
        return existing

    customer = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": "Company",
            "customer_group": (
                frappe.db.get_value("Customer Group", {"name": "Commercial"}, "name")
                or frappe.db.get_single_value("Selling Settings", "customer_group")
                or "All Customer Groups"
            ),
            "territory": frappe.db.get_value("Territory", {}, "name") or "All Territories",
        }
    )
    if company:
        customer.append("companies", {"company": company})
    customer.insert(ignore_permissions=True)
    profile.db_set("platform_customer", customer.name)
    return customer.name


def ensure_franchisee_b2b_setup(franchisee_id=None):
    franchisee_id = franchisee_id or resolve_franchisee_for_user()
    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        return {"ok": False, "error": "Franchisee not found"}

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    customer = _ensure_platform_customer(profile)
    retail_pl, wholesale_pl = _seed_franchisee_price_lists(profile)
    frappe.db.commit()
    return {
        "ok": True,
        "franchisee_id": franchisee_id,
        "platform_customer": customer,
        "retail_price_list": retail_pl,
        "wholesale_price_list": wholesale_pl,
    }


def serialize_franchisee_b2b(profile):
    if isinstance(profile, str):
        profile = frappe.get_doc("Franchisee Profile", profile)
    ftype = profile.get("franchisee_type") or "Pulse"
    rate_label = "Vector wholesale" if ftype == "Vector" else "FOCO − commission"
    credit_limit = flt(profile.get("credit_limit")) if ftype == "Vector" else 0
    wallet_balance = flt(profile.get("wallet_balance"))
    return {
        "name": profile.name,
        "franchise_name": profile.franchise_name,
        "branch_code": profile.branch_code,
        "franchisee_type": ftype,
        "commission_base": profile.get("commission_base") or "Franchisee Rate",
        "commission_percentage_rate": flt(profile.commission_percentage_rate),
        "retail_price_list": profile.get("retail_price_list"),
        "wholesale_price_list": profile.get("wholesale_price_list"),
        "franchisee_rate_label": rate_label,
        "platform_customer": profile.get("platform_customer"),
        "wallet_balance": wallet_balance,
        "credit_limit": credit_limit,
        "available_to_bill": round(wallet_balance + credit_limit, 2),
        "parent_foco": (profile.get("parent_foco") or "").strip(),
        "override_upsell_commission": flt(profile.get("override_upsell_commission") or 20),
        "address": (profile.get("address") or "").strip(),
        "contact_phone": (profile.get("contact_phone") or "").strip(),
        "contact_email": (profile.get("contact_email") or "").strip(),
    }


def get_wallet_balance(franchisee_id):
    return flt(frappe.db.get_value("Franchisee Profile", franchisee_id, "wallet_balance"))


def _record_wallet_transaction(
    franchisee_id,
    transaction_type,
    amount,
    balance_after,
    reference_doctype=None,
    reference_name=None,
    payment_reference=None,
    remarks=None,
):
    doc = frappe.get_doc(
        {
            "doctype": "Franchisee Wallet Transaction",
            "franchisee": franchisee_id,
            "transaction_type": transaction_type,
            "amount": flt(amount),
            "balance_after": flt(balance_after),
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "payment_reference": payment_reference,
            "remarks": remarks,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def credit_b2b_wallet(franchisee_id, amount, payment_reference=None, remarks=None):
    amount = flt(amount)
    if amount < MIN_WALLET_RECHARGE:
        frappe.throw(
            _("Minimum wallet recharge is ₹{0}").format(MIN_WALLET_RECHARGE),
            frappe.ValidationError,
        )

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    balance = flt(profile.wallet_balance)
    new_balance = round(balance + amount, 2)
    profile.wallet_balance = new_balance
    profile.save(ignore_permissions=True)

    txn_id = _record_wallet_transaction(
        franchisee_id,
        "Recharge",
        amount,
        new_balance,
        payment_reference=payment_reference,
        remarks=remarks or _("Wallet recharge"),
    )
    return {
        "transaction_id": txn_id,
        "amount": amount,
        "wallet_balance": new_balance,
    }


def wallet_available_to_bill(franchisee_id, profile=None):
    """Pulse: prepaid wallet only. Vector: wallet + Franchisee Profile credit_limit."""
    if profile is None:
        profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    ftype = (profile.get("franchisee_type") or "Pulse").strip()
    balance = flt(profile.get("wallet_balance"))
    credit_limit = flt(profile.get("credit_limit")) if ftype == "Vector" else 0
    return {
        "franchisee_type": ftype,
        "wallet_balance": balance,
        "credit_limit": credit_limit,
        "available_to_bill": round(balance + credit_limit, 2),
    }


def assert_wallet_covers_platform_fee(franchisee_id, platform_fee, profile=None):
    info = wallet_available_to_bill(franchisee_id, profile)
    fee = flt(platform_fee)
    if info["available_to_bill"] + 1e-9 < fee:
        if info["credit_limit"]:
            frappe.throw(
                _(
                    "Billing stopped: platform fee ₹{0} exceeds wallet ₹{1} plus credit limit ₹{2}."
                ).format(fee, info["wallet_balance"], info["credit_limit"]),
                frappe.ValidationError,
            )
        frappe.throw(
            _(
                "Insufficient wallet balance. Platform fee is ₹{0} but wallet has ₹{1}. "
                "Recharge your wallet to book tests."
            ).format(fee, info["wallet_balance"]),
            frappe.ValidationError,
        )
    return info


def debit_b2b_wallet_platform_fee(franchisee_id, amount, trf_id):
    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Invalid platform fee amount"), frappe.ValidationError)

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    assert_wallet_covers_platform_fee(franchisee_id, amount, profile)

    balance = flt(profile.wallet_balance)
    new_balance = round(balance - amount, 2)
    profile.wallet_balance = new_balance
    profile.save(ignore_permissions=True)

    txn_id = _record_wallet_transaction(
        franchisee_id,
        "Platform Fee",
        amount,
        new_balance,
        reference_doctype="Customer TRF",
        reference_name=trf_id,
        remarks=_("Platform fee for walk-in order {0}").format(trf_id),
    )
    return txn_id


def get_b2b_wallet_payload(franchisee_id, limit=30):
    balance = get_wallet_balance(franchisee_id)
    rows = frappe.get_all(
        "Franchisee Wallet Transaction",
        filters={"franchisee": franchisee_id},
        fields=[
            "name",
            "transaction_type",
            "amount",
            "balance_after",
            "reference_name",
            "payment_reference",
            "remarks",
            "creation",
        ],
        order_by="creation desc",
        limit=cint(limit),
    )
    transactions = [
        {
            "id": row.name,
            "type": row.transaction_type,
            "amount": flt(row.amount),
            "balance_after": flt(row.balance_after),
            "reference": row.reference_name,
            "payment_reference": row.payment_reference,
            "remarks": row.remarks,
            "created": str(row.creation),
        }
        for row in rows
    ]
    headroom = wallet_available_to_bill(franchisee_id)
    payload = {
        "wallet_balance": balance,
        "credit_limit": headroom["credit_limit"],
        "available_to_bill": headroom["available_to_bill"],
        "franchisee_type": headroom["franchisee_type"],
        "min_recharge": MIN_WALLET_RECHARGE,
        "transactions": transactions,
        "razorpay_recharge_enabled": True,
    }
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
            foco_pending_and_profit,
        )

        payload.update(foco_pending_and_profit(franchisee_id))
    except Exception:
        payload["pending_fofo_earnings"] = 0
        payload["profit_from_centre"] = 0
    return payload


def prepare_wallet_recharge(user, amount):
    """Validate franchisee + amount for a Razorpay wallet top-up."""
    franchisee_id = resolve_franchisee_for_user(user)
    if not franchisee_id:
        frappe.throw(_("Franchisee access required"))
    amount = flt(amount)
    if amount < MIN_WALLET_RECHARGE:
        frappe.throw(
            _("Minimum wallet recharge is ₹{0}").format(MIN_WALLET_RECHARGE),
            frappe.ValidationError,
        )
    return {
        "franchisee_id": franchisee_id,
        "amount": amount,
        "amount_paise": int(round(amount * 100)),
    }


def stash_wallet_razorpay_order(order_id, franchisee_id, amount):
    frappe.cache().set_value(
        f"b2b_wallet_order:{order_id}",
        {"franchisee_id": franchisee_id, "amount": flt(amount)},
        expires_in_sec=86400,
    )


def load_wallet_razorpay_order(order_id):
    return frappe.cache().get_value(f"b2b_wallet_order:{order_id}")


def clear_wallet_razorpay_order(order_id):
    try:
        frappe.cache().delete_value(f"b2b_wallet_order:{order_id}")
    except Exception:
        pass


def complete_wallet_razorpay_credit(franchisee_id, amount, payment_id, order_id=None):
    """Idempotent credit after Razorpay verify (keyed by payment_id)."""
    if not payment_id:
        frappe.throw(_("Payment id required"))
    frappe.db.get_value("Franchisee Profile", franchisee_id, "name", for_update=True)
    existing = frappe.db.get_value(
        "Franchisee Wallet Transaction",
        {"payment_reference": payment_id, "transaction_type": "Recharge"},
        ["name", "amount", "balance_after"],
        as_dict=True,
    )
    if existing:
        return {
            "transaction_id": existing.name,
            "amount": flt(existing.amount),
            "wallet_balance": get_wallet_balance(franchisee_id),
            "already_credited": True,
            "order_id": order_id,
        }

    row = credit_b2b_wallet(
        franchisee_id,
        amount,
        payment_reference=payment_id,
        remarks=_("Razorpay wallet recharge{0}").format(f" ({order_id})" if order_id else ""),
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import book_wallet_topup

    row["journal_entry"] = book_wallet_topup("b2b", franchisee_id, amount, payment_id, source="razorpay")
    if order_id:
        clear_wallet_razorpay_order(order_id)
    row["already_credited"] = False
    row["order_id"] = order_id
    return row


def get_b2b_catalog(franchisee_id):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        company_mrp_price_list,
        line_settlement,
    )

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile.get("retail_price_list") or not profile.get("wholesale_price_list"):
        ensure_franchisee_b2b_setup(franchisee_id)
        profile.reload()

    retail_pl = company_mrp_price_list()
    ftype = profile.get("franchisee_type") or "Pulse"
    wholesale_pl = profile.get("wholesale_price_list")
    rate_label = "Vector wholesale" if ftype == "Vector" else "FOCO − commission"
    patient_label = "MRP" if ftype == "Vector" else "FOCO rate"

    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import circuit_catalog_items

    # Circuit partners (FOCO / Master FOCO / Orange FOCO / mapped Vector) see only tests priced in the master chart.
    chart_items = circuit_catalog_items(franchisee_id)
    items = []
    for row in _lab_items():
        if chart_items is not None and row.name not in chart_items:
            continue
        settled = line_settlement(row.name, franchisee_id=franchisee_id, franchisee_type=ftype)
        patient = flt(settled["rate"])
        if not patient and not flt(settled["mrp"]):
            continue
        items.append(
            {
                "item_code": row.name,
                "item_name": row.item_name,
                "item_group": row.item_group,
                "retail_rate": patient,
                "wholesale_rate": flt(settled["platform_fee"]),
                "margin": flt(settled["commission_value"]),
                "mrp": flt(settled["mrp"]),
                "foco_rate": flt(settled["foco_rate"]),
                "platform_fee": flt(settled["platform_fee"]),
                "commission_value": flt(settled["commission_value"]),
                "show_mrp_slash": bool(settled["show_mrp_slash"]),
                "price_basis": settled["price_basis"],
                "patient_rate_label": patient_label,
                "mrp_price_list": retail_pl,
                "franchisee_price_list": wholesale_pl,
                "franchisee_type": ftype,
                "franchisee_rate_label": rate_label,
            }
        )
    return items


def repair_b2b_catalogs():
    """Re-sync custom fields, price lists, and verify catalog counts."""
    ensure_phase23_custom_fields()
    frappe.clear_cache(doctype="Franchisee Profile")
    results = []
    for name in frappe.get_all(
        "Franchisee Profile",
        filters={"active_status": "Active"},
        pluck="name",
    ):
        ensure_franchisee_b2b_setup(name)
        count = len(get_b2b_catalog(name))
        results.append({"franchisee": name, "catalog_items": count})
    frappe.db.commit()
    frappe.clear_cache()
    return results


def get_b2b_portal_payload(user=None):
    franchisee_id = resolve_franchisee_for_user(user)
    if not franchisee_id:
        return {"b2b_available": False, "reason": "not_a_franchisee_operator"}

    setup = ensure_franchisee_b2b_setup(franchisee_id)
    profile = frappe.get_doc("Franchisee Profile", franchisee_id)

    today_start = f"{today()} 00:00:00"
    trfs = frappe.get_all(
        "Customer TRF",
        filters={"franchisee_id": franchisee_id, "creation": (">=", today_start)},
        fields=["amount", "wholesale_amount", "platform_billed", "razorpay_payment_status"],
    )
    retail_today = sum(flt(t.amount) for t in trfs)
    wholesale_today = sum(flt(t.wholesale_amount) for t in trfs)
    pending_platform = sum(
        flt(t.wholesale_amount)
        for t in frappe.get_all(
            "Customer TRF",
            filters={"franchisee_id": franchisee_id, "platform_billed": 0},
            fields=["wholesale_amount"],
        )
        if flt(t.wholesale_amount) > 0
    )

    payload = {
        "b2b_available": True,
        "franchisee": serialize_franchisee_b2b(profile),
        "setup": setup,
        "wallet": get_b2b_wallet_payload(franchisee_id, limit=5),
        "stats": {
            "orders_today": len(trfs),
            "retail_collected_today": retail_today,
            "wholesale_due_today": wholesale_today,
            "margin_today": round(retail_today - wholesale_today, 2),
            "pending_platform_charges": pending_platform,
            "wallet_balance": get_wallet_balance(franchisee_id),
        },
    }
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
            foco_pending_and_profit,
        )

        extra = foco_pending_and_profit(franchisee_id)
        payload["stats"].update(extra)
        payload["franchisee"]["profit_from_centre"] = extra["profit_from_centre"]
        payload["franchisee"]["pending_fofo_earnings"] = extra["pending_fofo_earnings"]
    except Exception:
        pass
    return payload


def get_b2b_statements(franchisee_id, limit=50):
    rows = frappe.get_all(
        "Customer TRF",
        filters={"franchisee_id": franchisee_id},
        fields=[
            "name",
            "patient_name",
            "test_required",
            "amount",
            "wholesale_amount",
            "platform_billed",
            "payment_method",
            "order_status",
            "creation",
        ],
        order_by="creation desc",
        limit=cint(limit),
    )
    lines = []
    for row in rows:
        retail = flt(row.amount)
        wholesale = flt(row.wholesale_amount)
        lines.append(
            {
                "trf_id": row.name,
                "patient_name": row.patient_name,
                "test": row.test_required,
                "retail_amount": retail,
                "wholesale_amount": wholesale,
                "margin": round(retail - wholesale, 2) if wholesale else 0,
                "platform_billed": bool(row.platform_billed),
                "payment_method": row.payment_method,
                "order_status": row.order_status,
                "created": str(row.creation),
            }
        )
    summary = {
        "total_retail": sum(l["retail_amount"] for l in lines),
        "total_wholesale": sum(l["wholesale_amount"] for l in lines),
        "total_margin": sum(l["margin"] for l in lines),
        "unbilled_wholesale": sum(
            l["wholesale_amount"] for l in lines if not l["platform_billed"] and l["wholesale_amount"]
        ),
    }
    return {"lines": lines, "summary": summary}


def _ensure_patient_customer(patient_name, phone=None):
    customer_name = (patient_name or "").strip()
    if not customer_name:
        frappe.throw(_("Patient name required for invoice"))
    if frappe.db.exists("Customer", customer_name):
        return customer_name
    customer = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": "Individual",
            "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
            or "Individual",
            "territory": frappe.db.get_single_value("Selling Settings", "territory") or "All Territories",
            "mobile_no": phone,
        }
    )
    customer.insert(ignore_permissions=True)
    return customer.name


def _submit_sales_invoice(customer, item_code, rate, remarks, price_list=None, discount_amount=0):
	return _submit_sales_invoice_items(
		customer,
		[{"item_code": item_code, "qty": 1, "rate": flt(rate)}],
		remarks,
		price_list=price_list,
		discount_amount=discount_amount,
	)


def _submit_sales_invoice_items(customer, items, remarks, price_list=None, discount_amount=0):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import sales_company

	company = sales_company() or _default_company()
	if not company:
		frappe.throw(_("Company not configured"))
	if not items:
		frappe.throw(_("At least one invoice item is required"))
	allowed = frappe.get_all("Allowed To Transact With", filters={"parent": customer, "parenttype": "Customer"}, pluck="company")
	if allowed and company not in allowed:
		customer_doc = frappe.get_doc("Customer", customer)
		customer_doc.append("companies", {"company": company})
		customer_doc.save(ignore_permissions=True)
	invoice_data = {
		"doctype": "Sales Invoice",
		"customer": customer,
		"company": company,
		"due_date": today(),
		"items": [
			{
				"item_code": row["item_code"],
				"qty": flt(row.get("qty") or 1),
				"rate": flt(row.get("rate") or 0),
				"description": remarks,
			}
			for row in items
		],
		"remarks": remarks,
	}
	discount = flt(discount_amount or 0)
	if discount > 0:
		invoice_data["additional_discount_amount"] = discount
		if frappe.get_meta("Sales Invoice").has_field("apply_discount_on"):
			invoice_data["apply_discount_on"] = "Grand Total"
	if price_list and frappe.get_meta("Sales Invoice").has_field("selling_price_list"):
		invoice_data["selling_price_list"] = price_list
	if frappe.get_meta("Sales Invoice").has_field("service_unit"):
		invoice_data["service_unit"] = None
	si = frappe.get_doc(invoice_data)
	si.insert(ignore_permissions=True)
	si.submit()
	return si.name


def create_b2b_dual_invoices(trf, profile, retail, wholesale, line_items=None, discount_amount=0, wallet_txn=None):
	"""Platform SI to the franchisee Customer at wholesale, settled from the wallet when `wallet_txn` is given.

	The patient pays the franchisee, so no patient Sales Invoice is booked in the company's books; the
	hub prints the patient bill from the TRF. Soft-fails so wallet debit / TRF booking still succeed if
	accounting masters are incomplete.
	"""
	result = {"patient_invoice": None, "platform_invoice": None, "platform_settlement": None, "errors": []}
	rows = line_items or []
	if not rows:
		item_code = trf.test_required
		if not item_code:
			result["errors"].append("no_item")
			return result
		rows = [{"item_code": item_code, "retail": flt(retail), "wholesale": flt(wholesale)}]

	platform_items = [
		{"item_code": r["item_code"], "qty": 1, "rate": flt(r.get("wholesale") or 0)}
		for r in rows
		if flt(r.get("wholesale") or 0) > 0
	]

	platform_customer = profile.get("platform_customer") or _ensure_platform_customer(profile)
	meta = frappe.get_meta("Customer TRF")
	existing_platform = (
		trf.get("platform_sales_invoice") if meta.has_field("platform_sales_invoice") else None
	)
	if not existing_platform and platform_customer and platform_items and flt(wholesale) > 0:
		try:
			psi_name = _submit_sales_invoice_items(
				platform_customer,
				platform_items,
				f"B2B wholesale TRF {trf.name} — {profile.branch_code}",
				price_list=profile.get("wholesale_price_list"),
			)
			if meta.has_field("platform_sales_invoice"):
				trf.db_set("platform_sales_invoice", psi_name)
			result["platform_invoice"] = psi_name
		except Exception:
			frappe.log_error(title="phase23_platform_invoice", message=frappe.get_traceback())
			result["errors"].append("platform_invoice_failed")

	platform_invoice = result["platform_invoice"] or existing_platform
	if wallet_txn and platform_invoice:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_hub_receipts import (
			settle_platform_invoice_from_wallet,
		)

		try:
			result["platform_settlement"] = settle_platform_invoice_from_wallet(platform_invoice, wallet_txn)
		except Exception:
			frappe.log_error(title="phase121_platform_settlement", message=frappe.get_traceback())
			result["errors"].append("platform_settlement_failed")

	return result


def _parse_walk_in_item_codes(item_code=None, item_codes=None):
	codes = []
	if item_codes is not None:
		raw = item_codes
		if isinstance(raw, str):
			text = raw.strip()
			if text.startswith("["):
				try:
					parsed = json.loads(text)
					if isinstance(parsed, list):
						codes = [cstr(c).strip() for c in parsed if cstr(c).strip()]
				except Exception:
					codes = []
			if not codes:
				codes = [part.strip() for part in text.split(",") if part.strip()]
		elif isinstance(raw, (list, tuple)):
			codes = [cstr(c).strip() for c in raw if cstr(c).strip()]
	if not codes and item_code:
		codes = [cstr(item_code).strip()]
	# Preserve order, drop duplicates.
	return list(dict.fromkeys([c for c in codes if c]))


def create_b2b_walk_in_order(
	user,
	patient_name,
	patient_phone,
	age,
	gender,
	item_code,
	payment_method=None,
	item_codes=None,
	discount_amount=0,
	age_months=0,
	age_days=0,
):
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
		PAYMENT_METHOD_HUB,
		normalize_patient_age,
		normalize_payment_method,
	)

	franchisee_id = resolve_franchisee_for_user(user)
	if not franchisee_id:
		frappe.throw(_("Franchisee access required"))

	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
		assert_can_bill_patient,
		vector_entry,
	)

	assert_can_bill_patient(franchisee_id)
	if vector_entry(franchisee_id):
		frappe.throw(_("This Vector enters the partner circuit; create the bill from Walk-in bill entry."))

	codes = _parse_walk_in_item_codes(item_code=item_code, item_codes=item_codes)
	if not codes:
		frappe.throw(_("Select at least one lab test"))

	for code in codes:
		if not frappe.db.exists("Item", code):
			frappe.throw(_("Invalid test item: {0}").format(code))

	profile = frappe.get_doc("Franchisee Profile", franchisee_id)
	if not profile.get("retail_price_list"):
		ensure_franchisee_b2b_setup(franchisee_id)
		profile.reload()

	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
		line_settlement,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
		partner_circuit,
		record_circuit_bill,
		tier_settlement,
	)

	circuit = partner_circuit(franchisee_id)
	tier_lines = []
	priced_lines = []
	total_retail = 0.0
	total_wholesale = 0.0
	for code in codes:
		settled = line_settlement(code, franchisee_id=franchisee_id)
		retail = flt(settled["rate"])
		wholesale = flt(settled["platform_fee"])
		tier = tier_settlement(code, franchisee_id, 1, circuit=circuit)
		if tier:
			tier_lines.append(tier)
			wholesale = tier["debit_per_unit"]
		if not retail:
			frappe.throw(_("Item {0} has no patient selling price").format(code))
		if not wholesale:
			frappe.throw(
				_("Item {0} has no platform fee rate for this franchisee").format(code)
			)
		item_name = frappe.db.get_value("Item", code, "item_name") or code
		priced_lines.append(
			{
				"item_code": code,
				"item_name": item_name,
				"retail": retail,
				"wholesale": wholesale,
				"margin": flt(settled["commission_value"]),
			}
		)
		total_retail += retail
		total_wholesale += wholesale

	discount = min(max(flt(discount_amount or 0), 0.0), total_retail)
	payable = round(total_retail - discount, 2)

	assert_wallet_covers_platform_fee(franchisee_id, total_wholesale, profile)

	payment_method = normalize_payment_method(payment_method or PAYMENT_METHOD_HUB)
	hub_address = profile.address or f"{profile.franchise_name}, {profile.branch_code}"
	age_y, age_m, age_d = normalize_patient_age(age, age_months, age_days)

	trf = frappe.get_doc(
		{
			"doctype": "Customer TRF",
			"patient_name": patient_name,
			"patient_phone": patient_phone,
			"age": age_y,
			"age_months": age_m,
			"age_days": age_d,
			"gender": gender,
			"test_required": codes[0],
			"tests": [
				{
					"item": row["item_code"],
					"qty": 1,
					"rate": row["retail"],
					"amount": row["retail"],
				}
				for row in priced_lines
			],
			"franchisee_id": franchisee_id,
			"collection_address": hub_address,
			"amount": payable,
			"discount_amount": discount,
			"wholesale_amount": total_wholesale,
			"platform_billed": 0,
			"payment_method": payment_method,
			"razorpay_payment_status": "Paid",
			"order_status": "Booked",
		}
	)
	trf.insert(ignore_permissions=True)

	try:
		txn_id = debit_b2b_wallet_platform_fee(franchisee_id, total_wholesale, trf.name)
	except frappe.ValidationError:
		frappe.delete_doc("Customer TRF", trf.name, force=1, ignore_permissions=True)
		raise

	record_circuit_bill(trf.name, franchisee_id, tier_lines, txn_id)
	trf.db_set("platform_billed", 1)
	invoices = create_b2b_dual_invoices(
		trf,
		profile,
		total_retail,
		total_wholesale,
		line_items=priced_lines,
		discount_amount=discount,
		wallet_txn=txn_id,
	)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_iam import auto_assign_phlebotomist_for_trf

		auto_assign_phlebotomist_for_trf(trf.name)
	except Exception:
		pass

	frappe.db.commit()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
			accrue_fofo_foco_commission,
		)

		accrue_fofo_foco_commission(trf.name)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="phase111_accrue_walkin", message=frappe.get_traceback())
	return {
		"trf_id": trf.name,
		"barcode": trf.unique_barcode,
		"item_codes": codes,
		"line_items": [
			{
				"item_code": row["item_code"],
				"item_name": row["item_name"],
				"retail_amount": row["retail"],
				"wholesale_amount": row["wholesale"],
				"margin": row["margin"],
			}
			for row in priced_lines
		],
		"retail_amount": total_retail,
		"discount_amount": discount,
		"payable_amount": payable,
		"wholesale_amount": total_wholesale,
		"margin": round(total_retail - total_wholesale, 2),
		"payment_method": payment_method,
		"wallet_balance": get_wallet_balance(franchisee_id),
		"wallet_transaction": txn_id,
		"patient_invoice": invoices.get("patient_invoice"),
		"platform_invoice": invoices.get("platform_invoice"),
		"invoice_errors": invoices.get("errors") or [],
	}


def setup_phase23():
    ensure_phase23_custom_fields()
    seeded = []
    for row in frappe.get_all(
        "Franchisee Profile",
        filters={"active_status": "Active"},
        pluck="name",
    ):
        try:
            ensure_franchisee_b2b_setup(row)
            seeded.append(row)
        except Exception:
            frappe.log_error(title="phase23_b2b_setup", message=frappe.get_traceback())
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 23, "franchisees_configured": seeded}


def smoke_phase23():
    """Catalog + wallet + dual-invoice helpers (no live walk-in if wallet empty)."""
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase23()
    check("setup", setup.get("ok"), str(len(setup.get("franchisees_configured") or [])))
    check("wallet_doctype", frappe.db.exists("DocType", "Franchisee Wallet Transaction"))
    check(
        "platform_si_field",
        frappe.get_meta("Customer TRF").has_field("platform_sales_invoice"),
    )

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_portal", hasattr(api_mod, "get_b2b_portal"))
    check("api_catalog", hasattr(api_mod, "get_b2b_catalog"))
    check("api_wallet", hasattr(api_mod, "get_b2b_wallet"))
    check("api_wallet_rzp_order", hasattr(api_mod, "create_b2b_wallet_razorpay_order"))
    check("api_wallet_rzp_verify", hasattr(api_mod, "verify_b2b_wallet_razorpay_payment"))
    check("api_walk_in", hasattr(api_mod, "create_b2b_walk_in_order"))

    franchisee_id = frappe.db.get_value(
        "Franchisee Profile", {"active_status": "Active"}, "name"
    )
    check("active_franchisee", bool(franchisee_id), franchisee_id or "")
    if franchisee_id:
        ensure_franchisee_b2b_setup(franchisee_id)
        profile = frappe.get_doc("Franchisee Profile", franchisee_id)
        check("platform_customer", bool(profile.get("platform_customer")))
        check("retail_pl", bool(profile.get("retail_price_list")))
        check("wholesale_pl", bool(profile.get("wholesale_price_list")))
        catalog = get_b2b_catalog(franchisee_id)
        items = catalog if isinstance(catalog, list) else []
        check("catalog_items", isinstance(items, list) and len(items) > 0, str(len(items or [])))
        # Prefer franchisee-linked user for portal shape checks
        franchise_user = (
            frappe.db.get_value("User", {"email": ("like", "%franchise%")}, "name")
            or frappe.session.user
        )
        portal = get_b2b_portal_payload(franchise_user)
        # Portal may be unavailable if smoke user isn't a franchisee — still OK if catalog works
        check(
            "portal_or_catalog",
            (isinstance(portal, dict) and portal.get("b2b_available")) or len(items) > 0,
            str(portal.get("reason") if isinstance(portal, dict) else ""),
        )

        priced = next(
            (
                i
                for i in (items or [])
                if flt(i.get("retail_rate")) > 0 and flt(i.get("wholesale_rate")) > 0
            ),
            None,
        )
        if priced:
            retail = flt(priced["retail_rate"])
            wholesale = flt(priced["wholesale_rate"])
            trf = frappe.get_doc(
                {
                    "doctype": "Customer TRF",
                    "patient_name": "B2B Smoke Patient",
                    "patient_phone": "9000000023",
                    "age": 30,
                    "gender": "Male",
                    "test_required": priced["item_code"],
                    "tests": [{"item": priced["item_code"], "amount": retail}],
                    "franchisee_id": franchisee_id,
                    "collection_address": "Smoke",
                    "amount": retail,
                    "wholesale_amount": wholesale,
                    "payment_method": "Pay at Hub",
                    "razorpay_payment_status": "Pending",
                    "order_status": "Booked",
                }
            )
            trf.insert(ignore_permissions=True)
            invoices = create_b2b_dual_invoices(trf, profile, retail, wholesale)
            check("no_patient_invoice", not invoices.get("patient_invoice"))
            check(
                "platform_invoice",
                bool(invoices.get("platform_invoice")),
                invoices.get("platform_invoice") or ",".join(invoices.get("errors") or []),
            )
            # Cancel smoke invoices + delete TRF to keep site clean
            for key in ("patient_invoice", "platform_invoice"):
                name = invoices.get(key)
                if name and frappe.db.exists("Sales Invoice", name):
                    try:
                        si = frappe.get_doc("Sales Invoice", name)
                        if si.docstatus == 1:
                            si.cancel()
                        frappe.delete_doc("Sales Invoice", name, force=1, ignore_permissions=True)
                    except Exception:
                        pass
            frappe.delete_doc("Customer TRF", trf.name, force=1, ignore_permissions=True)
            frappe.db.commit()
        else:
            check("priced_catalog_item", False, "no dual-priced item for invoice smoke")

    return result
