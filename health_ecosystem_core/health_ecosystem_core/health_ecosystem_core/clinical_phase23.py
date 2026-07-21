"""Phase 23 — B2B franchise portal: dual pricing, wallet, and walk-in orders."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, today

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


def _lab_items(limit=200):
    rows = frappe.get_all(
        "Item",
        filters={"disabled": 0, "item_group": ("in", list(LAB_ITEM_GROUPS))},
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

    company = _default_company()
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
    rate_label = "Vector wholesale" if ftype == "Vector" else "FOCO rate"
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
        "wallet_balance": flt(profile.get("wallet_balance")),
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


def debit_b2b_wallet_platform_fee(franchisee_id, amount, trf_id):
    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Invalid platform fee amount"), frappe.ValidationError)

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    balance = flt(profile.wallet_balance)
    if balance < amount:
        frappe.throw(
            _(
                "Insufficient wallet balance. Platform fee is ₹{0} but wallet has ₹{1}. "
                "Recharge your wallet to book tests."
            ).format(amount, balance),
            frappe.ValidationError,
        )

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
    return {
        "wallet_balance": balance,
        "min_recharge": MIN_WALLET_RECHARGE,
        "transactions": transactions,
        "razorpay_recharge_enabled": True,
    }


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
        expires_in_sec=3600,
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
    if order_id:
        clear_wallet_razorpay_order(order_id)
    row["already_credited"] = False
    row["order_id"] = order_id
    return row


def get_b2b_catalog(franchisee_id):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        company_mrp_price_list,
        franchisee_rate,
        franchisee_rate_price_list,
        mrp_rate,
    )

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile.get("retail_price_list") or not profile.get("wholesale_price_list"):
        ensure_franchisee_b2b_setup(franchisee_id)
        profile.reload()

    # Always display shared company MRP — never a per-branch MRP list
    retail_pl = company_mrp_price_list()
    ftype = profile.get("franchisee_type") or "Pulse"
    wholesale_pl = franchisee_rate_price_list(ftype)
    rate_label = "Vector wholesale" if ftype == "Vector" else "FOCO rate"

    items = []
    for row in _lab_items():
        retail = mrp_rate(row.name) or flt(row.standard_rate)
        if not retail:
            continue
        wholesale = franchisee_rate(row.name, franchisee_type=ftype)
        if not wholesale:
            # Missing franchisee-list rate: leave 0 (do not invent a new MRP clone)
            wholesale = 0
        items.append(
            {
                "item_code": row.name,
                "item_name": row.item_name,
                "item_group": row.item_group,
                "retail_rate": retail,
                "wholesale_rate": wholesale,
                "margin": round(retail - wholesale, 2) if wholesale else 0,
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

    return {
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


def _submit_sales_invoice(customer, item_code, rate, remarks, price_list=None):
    company = _default_company()
    if not company:
        frappe.throw(_("Company not configured"))
    invoice_data = {
        "doctype": "Sales Invoice",
        "customer": customer,
        "company": company,
        "due_date": today(),
        "items": [
            {
                "item_code": item_code,
                "qty": 1,
                "rate": flt(rate),
                "description": remarks,
            }
        ],
        "remarks": remarks,
    }
    if price_list and frappe.get_meta("Sales Invoice").has_field("selling_price_list"):
        invoice_data["selling_price_list"] = price_list
    if frappe.get_meta("Sales Invoice").has_field("service_unit"):
        invoice_data["service_unit"] = None
    si = frappe.get_doc(invoice_data)
    si.insert(ignore_permissions=True)
    si.submit()
    return si.name


def create_b2b_dual_invoices(trf, profile, retail, wholesale):
    """Patient SI at MRP + platform SI to franchisee Customer at wholesale.

    Soft-fails individually so wallet debit / TRF booking still succeed if
    accounting masters are incomplete.
    """
    result = {"patient_invoice": None, "platform_invoice": None, "errors": []}
    item_code = trf.test_required
    if not item_code:
        result["errors"].append("no_item")
        return result

    if not trf.get("sales_invoice"):
        try:
            patient_customer = _ensure_patient_customer(trf.patient_name, trf.patient_phone)
            si_name = _submit_sales_invoice(
                patient_customer,
                item_code,
                retail,
                f"B2B retail TRF {trf.name} — {trf.patient_name}",
                price_list=profile.get("retail_price_list"),
            )
            trf.db_set("sales_invoice", si_name)
            result["patient_invoice"] = si_name
        except Exception:
            frappe.log_error(title="phase23_patient_invoice", message=frappe.get_traceback())
            result["errors"].append("patient_invoice_failed")

    platform_customer = profile.get("platform_customer") or _ensure_platform_customer(profile)
    meta = frappe.get_meta("Customer TRF")
    existing_platform = (
        trf.get("platform_sales_invoice") if meta.has_field("platform_sales_invoice") else None
    )
    if not existing_platform and platform_customer and flt(wholesale) > 0:
        try:
            psi_name = _submit_sales_invoice(
                platform_customer,
                item_code,
                wholesale,
                f"B2B wholesale TRF {trf.name} — {profile.branch_code}",
                price_list=profile.get("wholesale_price_list"),
            )
            if meta.has_field("platform_sales_invoice"):
                trf.db_set("platform_sales_invoice", psi_name)
            result["platform_invoice"] = psi_name
        except Exception:
            frappe.log_error(title="phase23_platform_invoice", message=frappe.get_traceback())
            result["errors"].append("platform_invoice_failed")

    return result


def create_b2b_walk_in_order(
    user,
    patient_name,
    patient_phone,
    age,
    gender,
    item_code,
    payment_method=None,
):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        PAYMENT_METHOD_HUB,
        normalize_payment_method,
    )

    franchisee_id = resolve_franchisee_for_user(user)
    if not franchisee_id:
        frappe.throw(_("Franchisee access required"))

    if not frappe.db.exists("Item", item_code):
        frappe.throw(_("Invalid test item"))

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile.get("retail_price_list"):
        ensure_franchisee_b2b_setup(franchisee_id)
        profile.reload()

    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        franchisee_rate,
        mrp_rate,
    )

    retail = mrp_rate(item_code)
    wholesale = franchisee_rate(item_code, franchisee_id=franchisee_id)
    if not retail:
        frappe.throw(_("Item has no company MRP (Standard Selling Rate)"))
    if not wholesale:
        frappe.throw(
            _("Item has no {0} rate in the franchisee price list").format(
                profile.get("franchisee_type") or "Pulse"
            )
        )
    wallet_balance = get_wallet_balance(franchisee_id)
    if wallet_balance < wholesale:
        frappe.throw(
            _(
                "Insufficient wallet balance. Platform fee is ₹{0} but wallet has ₹{1}. "
                "Recharge your wallet to book this test."
            ).format(wholesale, wallet_balance),
            frappe.ValidationError,
        )

    payment_method = normalize_payment_method(payment_method or PAYMENT_METHOD_HUB)
    hub_address = profile.address or f"{profile.franchise_name}, {profile.branch_code}"

    trf = frappe.get_doc(
        {
            "doctype": "Customer TRF",
            "patient_name": patient_name,
            "patient_phone": patient_phone,
            "age": cint(age),
            "gender": gender,
            "test_required": item_code,
            "tests": [{"item": item_code, "amount": retail}],
            "franchisee_id": franchisee_id,
            "collection_address": hub_address,
            "amount": retail,
            "wholesale_amount": wholesale,
            "platform_billed": 0,
            "payment_method": payment_method,
            "razorpay_payment_status": "Paid",
            "order_status": "Booked",
        }
    )
    trf.insert(ignore_permissions=True)

    try:
        txn_id = debit_b2b_wallet_platform_fee(franchisee_id, wholesale, trf.name)
    except frappe.ValidationError:
        frappe.delete_doc("Customer TRF", trf.name, force=1, ignore_permissions=True)
        raise

    trf.db_set("platform_billed", 1)
    invoices = create_b2b_dual_invoices(trf, profile, retail, wholesale)

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_iam import auto_assign_phlebotomist_for_trf

        auto_assign_phlebotomist_for_trf(trf.name)
    except Exception:
        pass

    frappe.db.commit()
    return {
        "trf_id": trf.name,
        "barcode": trf.unique_barcode,
        "retail_amount": retail,
        "wholesale_amount": wholesale,
        "margin": round(retail - wholesale, 2),
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
            check(
                "patient_invoice",
                bool(invoices.get("patient_invoice")),
                invoices.get("patient_invoice") or ",".join(invoices.get("errors") or []),
            )
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
