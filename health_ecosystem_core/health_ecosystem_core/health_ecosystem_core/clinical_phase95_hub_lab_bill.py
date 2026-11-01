"""Phase 95 — Referring Doctor master, commission ledger, hub walk-in lab bill."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import flt, getdate, now_datetime

HUB_INTAKE_CHANNEL = "Hub Walk-in"

FRANCHISEE_ROLES = (
    "Franchisee Operator",
    "Health System Admin",
    "System Manager",
    "Administrator",
)


def setup_phase95():
    ensure_referring_doctor_fields()
    ensure_hub_lab_bill_fields()
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
            ensure_franchisee_profile_rate_fields,
        )

        ensure_franchisee_profile_rate_fields()
    except Exception:
        frappe.log_error(title="phase95_rate_fields", message=frappe.get_traceback())
    frappe.clear_cache()
    return {"ok": True, "phase": 95}


def ensure_referring_doctor_fields():
    """TRF links to Referring Doctor + optional commission snapshot."""
    trf_fields = []
    meta = frappe.get_meta("Customer TRF")
    if not meta.has_field("referring_doctor_id"):
        trf_fields.append(
            {
                "fieldname": "referring_doctor_id",
                "label": "Referring Doctor",
                "fieldtype": "Link",
                "options": "Referring Doctor",
                "insert_after": "referred_doctor",
            }
        )
    if not meta.has_field("ref_doctor_commission_percent"):
        trf_fields.append(
            {
                "fieldname": "ref_doctor_commission_percent",
                "label": "Ref. Doctor Commission %",
                "fieldtype": "Percent",
                "insert_after": "referring_doctor_id",
            }
        )
    if not meta.has_field("ref_doctor_commission_amount"):
        trf_fields.append(
            {
                "fieldname": "ref_doctor_commission_amount",
                "label": "Ref. Doctor Commission Amount",
                "fieldtype": "Currency",
                "insert_after": "ref_doctor_commission_percent",
                "read_only": 1,
            }
        )
    if trf_fields:
        create_custom_fields({"Customer TRF": trf_fields}, update=True)
        frappe.db.commit()
    return True


def ensure_hub_lab_bill_fields():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase94_mother_lab_bill import (
        ensure_mother_lab_bill_fields,
    )

    ensure_mother_lab_bill_fields()
    ensure_referring_doctor_fields()
    ensure_patient_payment_fields()
    return True


def ensure_patient_payment_fields():
    """Patient-side payment tracking (separate from wallet platform fee)."""
    meta = frappe.get_meta("Customer TRF")
    fields = []
    if not meta.has_field("hec_patient_payment_status"):
        fields.append(
            {
                "fieldname": "hec_patient_payment_status",
                "label": "Patient Payment Status",
                "fieldtype": "Select",
                "options": "\nUnpaid\nPartially Paid\nPaid",
                "default": "Unpaid",
                "insert_after": "hec_due_amount" if meta.has_field("hec_due_amount") else "amount",
            }
        )
    else:
        # Keep options in sync for existing sites.
        try:
            cf = frappe.db.get_value(
                "Custom Field",
                {"dt": "Customer TRF", "fieldname": "hec_patient_payment_status"},
                "name",
            )
            if cf:
                frappe.db.set_value(
                    "Custom Field",
                    cf,
                    "options",
                    "\nUnpaid\nPartially Paid\nPaid",
                )
        except Exception:
            pass
    if not meta.has_field("hec_payment_history"):
        fields.append(
            {
                "fieldname": "hec_payment_history",
                "label": "Patient Payment History (JSON)",
                "fieldtype": "Long Text",
                "insert_after": "hec_patient_payment_status",
            }
        )
    if fields:
        create_custom_fields({"Customer TRF": fields}, update=True)
        frappe.db.commit()
    return True


def _payment_status_from_amounts(total, paid):
    total = flt(total)
    paid = flt(paid)
    due = max(round(total - paid, 2), 0.0)
    if total <= 0 and paid <= 0:
        return "Unpaid", due
    if paid <= 0:
        return "Unpaid", due
    if due <= 0.009:
        return "Paid", 0.0
    return "Partially Paid", due


def _bill_payment_snapshot(source):
    """Always derive total / paid / due / status from amounts (ignore stale status)."""
    if isinstance(source, dict):
        get = source.get
    else:
        get = lambda k, d=None: getattr(source, k, d)

    net = flt(get("hec_net_amount") or 0)
    amount = flt(get("amount") or 0)
    total = net if net > 0 else amount
    if total <= 0:
        tests = get("tests") or []
        if isinstance(tests, list) and tests:
            try:
                total = sum(
                    flt(
                        (t.get("hec_r_amount") if isinstance(t, dict) else getattr(t, "hec_r_amount", None))
                        or (
                            flt((t.get("qty") if isinstance(t, dict) else getattr(t, "qty", 1)) or 1)
                            * flt((t.get("rate") if isinstance(t, dict) else getattr(t, "rate", 0)) or 0)
                        )
                    )
                    for t in tests
                )
                coll = flt(get("hec_coll_charge") or 0)
                total = round(total + coll, 2)
            except Exception:
                pass
    paid = max(
        flt(get("hec_amount_paid") or 0),
        flt(get("hec_received") or 0),
        flt(get("hec_receipt_amount") or 0),
    )
    status, due = _payment_status_from_amounts(total, paid)
    return {
        "hec_net_amount": total,
        "hec_amount_paid": paid,
        "hec_due_amount": due,
        "hec_patient_payment_status": status,
    }


def _load_payment_history(trf):
    raw = getattr(trf, "hec_payment_history", None) or ""
    if isinstance(raw, list):
        return list(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def _save_payment_history(trf_name, history):
    if not frappe.get_meta("Customer TRF").has_field("hec_payment_history"):
        return
    frappe.db.set_value(
        "Customer TRF",
        trf_name,
        "hec_payment_history",
        json.dumps(history, ensure_ascii=False, default=str),
    )


def _append_payment_event(trf_name, *, amount, mode, notes, event_type, actor=None):
    """Append a payment history row and sync totals/status. Does NOT touch wallet."""
    ensure_patient_payment_fields()
    trf = frappe.get_doc("Customer TRF", trf_name)
    snap = _bill_payment_snapshot(trf)
    total = flt(snap["hec_net_amount"])
    # Persist corrected net when amount field holds the real total.
    if total > 0 and flt(getattr(trf, "hec_net_amount", None) or 0) <= 0:
        if frappe.get_meta("Customer TRF").has_field("hec_net_amount"):
            frappe.db.set_value("Customer TRF", trf_name, "hec_net_amount", total)
    prev_paid = flt(snap["hec_amount_paid"])
    add = flt(amount)
    if add < 0:
        frappe.throw(_("Received amount cannot be negative"))
    if event_type == "opening":
        new_paid = round(add, 2)
        prev_before = 0.0
    elif event_type == "payment":
        new_paid = round(prev_paid + add, 2)
        prev_before = prev_paid
    else:
        new_paid = round(add, 2)
        prev_before = prev_paid
    status, due = _payment_status_from_amounts(total, new_paid)
    history = _load_payment_history(trf)
    entry = {
        "id": frappe.generate_hash(length=10),
        "at": str(now_datetime()),
        "event": event_type,
        "amount": add if event_type == "payment" else new_paid,
        "previous_paid": prev_before,
        "mode": (mode or "CASH").upper()[:20],
        "notes": (notes or "")[:500],
        "running_paid": new_paid,
        "running_due": due,
        "bill_total": total,
        "status_after": status,
        "by": actor or frappe.session.user,
    }
    history.append(entry)
    updates = {
        "hec_amount_paid": new_paid,
        "hec_received": new_paid,
        "hec_receipt_amount": new_paid,
        "hec_due_amount": due,
        "hec_patient_payment_status": status,
    }
    if total > 0 and frappe.get_meta("Customer TRF").has_field("hec_net_amount"):
        updates["hec_net_amount"] = total
    if mode and frappe.get_meta("Customer TRF").has_field("hec_receipt_mode"):
        updates["hec_receipt_mode"] = (mode or "CASH").upper()[:20]
    if status == "Paid":
        updates["razorpay_payment_status"] = "Paid"
    else:
        updates["razorpay_payment_status"] = "Pending"
    frappe.db.set_value("Customer TRF", trf_name, updates)
    _save_payment_history(trf_name, history)
    frappe.db.commit()
    return {
        "trf": trf_name,
        "hec_net_amount": total,
        "hec_amount_paid": new_paid,
        "hec_due_amount": due,
        "hec_patient_payment_status": status,
        "previous_paid": prev_before,
        "new_payment": add if event_type == "payment" else new_paid,
        "payment_entry": entry,
        "payment_history": history,
    }


def _parse_json(value):
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return None


def _ok(data=None, message="OK"):
    return {"status": "success", "message": message, "data": data or {}}


RECEPTION_ROLES = (
    "Lab Technician",
    "Pathologist",
    "Health System Admin",
    "System Manager",
    "Administrator",
    "Franchisee Operator",
    "Laboratory User",
)


def _assert_referring_doctor_write():
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles.intersection(set(FRANCHISEE_ROLES) | set(RECEPTION_ROLES)):
        frappe.throw(
            _("Not permitted: franchisee or lab reception access required."),
            frappe.PermissionError,
        )


def _assert_franchisee_role():
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles.intersection(FRANCHISEE_ROLES):
        frappe.throw(_("Not permitted: Franchisee Operator access required."), frappe.PermissionError)


def _resolve_hub_franchisee():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    if not franchisee_id:
        frappe.throw(_("Franchisee access required"))
    return franchisee_id


def _franchise_label(franchisee):
    if not franchisee:
        return None
    try:
        meta = frappe.get_meta("Franchisee Profile")
        for field in ("franchise_name", "franchisee_name", "lab_name", "centre_name"):
            if meta.has_field(field):
                val = frappe.db.get_value("Franchisee Profile", franchisee, field)
                if val:
                    return val
    except Exception:
        pass
    return franchisee


@frappe.whitelist()
def api_search_referring_doctors(txt=None, limit=30):
    """Search Referring Doctor master (+ Self walk-in)."""
    txt = (txt or frappe.form_dict.get("txt") or "").strip()
    limit = frappe.utils.cint(limit) or 30
    out = [{"name": "Self", "doctor_name": "Self", "label": "Self", "commission_percent": 0}]
    if not frappe.db.exists("DocType", "Referring Doctor"):
        return _ok({"doctors": out})
    or_filters = None
    if txt:
        or_filters = [
            ["name", "like", f"%{txt}%"],
            ["doctor_name", "like", f"%{txt}%"],
            ["mobile", "like", f"%{txt}%"],
            ["whatsapp", "like", f"%{txt}%"],
            ["clinic_name", "like", f"%{txt}%"],
        ]
    rows = frappe.get_all(
        "Referring Doctor",
        filters={"status": "Active"},
        or_filters=or_filters,
        fields=["name", "doctor_name", "mobile", "whatsapp", "commission_percent", "speciality", "clinic_name"],
        limit_page_length=limit,
        order_by="doctor_name asc",
        ignore_permissions=True,
    )
    for row in rows:
        dname = row.get("doctor_name") or row.name
        out.append(
            {
                "name": row.name,
                "doctor_name": dname,
                "mobile": row.get("mobile") or "",
                "whatsapp": row.get("whatsapp") or "",
                "commission_percent": flt(row.get("commission_percent")),
                "speciality": row.get("speciality") or "",
                "clinic_name": row.get("clinic_name") or "",
                "label": dname,
            }
        )
    return _ok({"doctors": out[: limit + 1]})


@frappe.whitelist()
def api_upsert_referring_doctor(data=None):
    """Create or update Referring Doctor from partners / reception bill entry."""
    _assert_referring_doctor_write()
    payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or frappe.form_dict or {}
    name = (payload.get("name") or "").strip()
    doctor_name = (payload.get("doctor_name") or "").strip()
    if not doctor_name:
        frappe.throw(_("Doctor name required"))
    if name and name != "Self" and frappe.db.exists("Referring Doctor", name):
        doc = frappe.get_doc("Referring Doctor", name)
    else:
        existing = frappe.db.get_value("Referring Doctor", {"doctor_name": doctor_name}, "name")
        if existing:
            doc = frappe.get_doc("Referring Doctor", existing)
        else:
            doc = frappe.new_doc("Referring Doctor")
            doc.doctor_name = doctor_name
    if payload.get("mobile") is not None:
        doc.mobile = (payload.get("mobile") or "").strip()
    if payload.get("whatsapp") is not None:
        doc.whatsapp = (payload.get("whatsapp") or "").strip()
    if payload.get("commission_percent") not in (None, ""):
        doc.commission_percent = flt(payload.get("commission_percent"))
    if payload.get("speciality"):
        doc.speciality = payload.get("speciality")
    if payload.get("clinic_name"):
        doc.clinic_name = payload.get("clinic_name")
    doc.status = payload.get("status") or doc.get("status") or "Active"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _ok(
        {
            "name": doc.name,
            "doctor_name": doc.doctor_name,
            "mobile": doc.mobile,
            "whatsapp": doc.whatsapp,
            "commission_percent": flt(doc.commission_percent),
            "label": doc.doctor_name,
        }
    )


def resolve_referring_doctor_from_payload(payload):
    """Return (referring_doctor_id, referred_doctor_name, commission_percent)."""
    ref_id = (payload.get("referring_doctor_id") or "").strip()
    referred = (payload.get("referred_doctor") or "").strip()
    commission_pct = payload.get("ref_doctor_commission_percent")
    if commission_pct in (None, ""):
        commission_pct = payload.get("referring_doctor_commission_percent")
    commission_pct = flt(commission_pct) if commission_pct not in (None, "") else None

    if ref_id and ref_id != "Self" and frappe.db.exists("Referring Doctor", ref_id):
        doc = frappe.get_doc("Referring Doctor", ref_id)
        referred = doc.doctor_name or referred or ref_id
        if commission_pct is None:
            commission_pct = flt(doc.commission_percent)
        return ref_id, referred, commission_pct or 0

    if referred and referred.lower() != "self":
        existing = frappe.db.get_value("Referring Doctor", {"doctor_name": referred}, "name")
        if existing:
            default_pct = flt(frappe.db.get_value("Referring Doctor", existing, "commission_percent"))
            if commission_pct is None:
                commission_pct = default_pct
            return existing, referred, commission_pct or 0

    return None, referred or "Self", commission_pct or 0


def apply_referring_doctor_to_trf_doc(doc, payload):
    """Set TRF referring doctor fields from save payload."""
    ensure_referring_doctor_fields()
    ref_id, referred, commission_pct = resolve_referring_doctor_from_payload(payload)
    doc.referred_doctor = referred or "Self"
    if hasattr(doc, "referring_doctor_id"):
        doc.referring_doctor_id = ref_id or None
    if hasattr(doc, "ref_doctor_commission_percent"):
        doc.ref_doctor_commission_percent = commission_pct if ref_id else 0
    net = flt(getattr(doc, "hec_net_amount", None) or doc.amount or 0)
    comm_amt = round(net * flt(commission_pct) / 100, 2) if ref_id and commission_pct else 0
    if hasattr(doc, "ref_doctor_commission_amount"):
        doc.ref_doctor_commission_amount = comm_amt
    return ref_id, referred, commission_pct, comm_amt


def accrue_referring_doctor_commission(trf_name):
    """Create ledger row for referring doctor commission (idempotent per TRF)."""
    ensure_referring_doctor_fields()
    if not frappe.db.exists("DocType", "Referring Doctor Commission Ledger"):
        return None
    meta = frappe.get_meta("Customer TRF")
    if not meta.has_field("referring_doctor_id"):
        return None

    trf = frappe.get_doc("Customer TRF", trf_name)
    ref_id = getattr(trf, "referring_doctor_id", None)
    comm_amt = flt(getattr(trf, "ref_doctor_commission_amount", 0))
    if not ref_id or comm_amt <= 0:
        return None

    existing = frappe.db.exists(
        "Referring Doctor Commission Ledger",
        {"customer_trf": trf.name, "referring_doctor": ref_id, "status": ["!=", "Reversed"]},
    )
    if existing:
        return existing

    bill_dt = getattr(trf, "hec_bill_datetime", None) or trf.creation
    doc = frappe.get_doc(
        {
            "doctype": "Referring Doctor Commission Ledger",
            "referring_doctor": ref_id,
            "customer_trf": trf.name,
            "franchisee": trf.franchisee_id,
            "bill_date": bill_dt,
            "invoice_amount": flt(getattr(trf, "hec_net_amount", None) or trf.amount or 0),
            "commission_percent": flt(getattr(trf, "ref_doctor_commission_percent", 0)),
            "commission_amount": comm_amt,
            "status": "Accrued",
            "posting_date": getdate(bill_dt),
            "patient_name": trf.patient_name,
            "notes": _("Auto-accrued from walk-in / hub bill {0}").format(trf.name),
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


def finalize_hub_b2b_settlement(trf_name, franchisee_id, billed_by=None):
    """Debit wallet + dual invoices after Phase 70 hub bill save."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        settle_vector_bill,
        vector_entry,
    )

    if vector_entry(franchisee_id):
        # Mapped Vector: dummy MRP patient bill (no books); the entry partner's deposit is adjusted instead.
        return settle_vector_bill(trf_name, franchisee_id, billed_by=billed_by)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        create_b2b_dual_invoices,
        debit_b2b_wallet_platform_fee,
        ensure_franchisee_b2b_setup,
        get_wallet_balance,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
        line_settlement,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        partner_circuit,
        record_circuit_bill,
        tier_settlement,
    )

    trf = frappe.get_doc("Customer TRF", trf_name)
    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    if not profile.get("retail_price_list"):
        ensure_franchisee_b2b_setup(franchisee_id)
        profile.reload()

    circuit = partner_circuit(franchisee_id)
    tier_lines = []
    priced_lines = []
    total_retail = 0.0
    total_wholesale = 0.0
    for row in trf.get("tests") or []:
        code = row.item
        qty = flt(row.qty or 1) or 1
        settled = line_settlement(code, franchisee_id=franchisee_id, qty=qty)
        retail = flt(row.rate) or flt(settled["rate"])
        wholesale = flt(settled["platform_fee"])
        tier = tier_settlement(code, franchisee_id, qty, circuit=circuit)
        if tier:
            tier_lines.append(tier)
            wholesale = tier["debit_per_unit"]
        if not wholesale:
            frappe.throw(
                _("Item {0} has no platform fee rate for this franchisee").format(code),
                frappe.ValidationError,
            )
        priced_lines.append(
            {
                "item_code": code,
                "item_name": row.item_name or code,
                "retail": retail,
                "wholesale": wholesale,
            }
        )
        total_retail += retail * qty
        total_wholesale += wholesale * qty

    discount = flt(trf.discount_amount or 0)
    payable = flt(getattr(trf, "hec_net_amount", None) or trf.amount or total_retail - discount)

    txn_id = debit_b2b_wallet_platform_fee(franchisee_id, total_wholesale, trf.name)
    record_circuit_bill(trf.name, franchisee_id, tier_lines, txn_id)
    trf.db_set(
        {
            "wholesale_amount": total_wholesale,
            "platform_billed": 1,
            "amount": payable,
            "discount_amount": discount,
        }
    )
    if flt(getattr(trf, "hec_due_amount", 0)) <= 0 and flt(getattr(trf, "hec_amount_paid", 0)) > 0:
        trf.db_set("razorpay_payment_status", "Paid")

    invoices = create_b2b_dual_invoices(
        trf,
        profile,
        total_retail,
        total_wholesale,
        line_items=priced_lines,
        discount_amount=discount,
        wallet_txn=txn_id,
    )
    frappe.db.commit()
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
            accrue_fofo_foco_commission,
        )

        accrue_fofo_foco_commission(trf.name)
        frappe.db.commit()
    except Exception:
        frappe.log_error(title="phase111_accrue_hub_bill", message=frappe.get_traceback())
    return {
        "wallet_transaction": txn_id,
        "wholesale_amount": total_wholesale,
        "partner_tier": circuit.get("tier") if tier_lines else None,
        "wallet_balance": get_wallet_balance(franchisee_id),
        "patient_invoice": invoices.get("patient_invoice"),
        "platform_invoice": invoices.get("platform_invoice"),
        "invoice_errors": invoices.get("errors") or [],
    }


@frappe.whitelist()
def api_get_hub_lab_bill_defaults():
    """Partners SPA bootstrap: pinned hub franchisee + pricing rules."""
    _assert_franchisee_role()
    ensure_hub_lab_bill_fields()
    franchisee = _resolve_hub_franchisee()
    label = _franchise_label(franchisee)
    franchisee_type = (
        frappe.db.get_value("Franchisee Profile", franchisee, "franchisee_type") or "Pulse"
    ).strip()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        get_wallet_balance,
        wallet_available_to_bill,
    )

    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        TIERS,
        has_foco_module,
        partner_circuit,
        vector_bill_to_options,
        vector_entry,
        vector_entry_public,
    )

    headroom = wallet_available_to_bill(franchisee)
    circuit = partner_circuit(franchisee)
    can_bill_patient = circuit.get("tier") not in TIERS or has_foco_module(circuit)
    v_entry = vector_entry(franchisee)
    if v_entry:
        pricing_rule = (
            f"Your tests enter the circuit through {v_entry['entry_name']} ({v_entry['entry_tier']}). "
            "The patient bill is a dummy full-MRP bill (no books). You are billed the B2B amount by "
            f"{v_entry['entry_name']}, settled directly with them; your deposit is not charged."
        )
    elif circuit.get("tier") in TIERS:
        pricing_rule = (
            f"{circuit['tier']} partner circuit: tests with partner tier rates adjust your deposit by the "
            "fixed tier platform fee on save. Master FOCO and lab shares post when the sample reaches "
            "the lab and when the report is authorized."
        )
    elif franchisee_type == "Vector":
        pricing_rule = (
            "Patient bill is unsashed MRP. Platform fee is Vector wholesale "
            "(mother list, editable per franchisee). Commission % is on wholesale. "
            "Billing stops if wallet + credit limit cannot cover the platform fee."
        )
    else:
        pricing_rule = (
            "Patient bill is FOCO rate (MRP slashed when higher). "
            "Platform fee is FOCO minus commission value, debited from wallet on save."
        )

    return _ok(
        {
            "hub_franchisee": franchisee,
            "hub_label": label,
            "franchisee_type": franchisee_type,
            "intake_channel": HUB_INTAKE_CHANNEL,
            "wallet_balance": get_wallet_balance(franchisee),
            "credit_limit": headroom["credit_limit"],
            "available_to_bill": headroom["available_to_bill"],
            "pricing_rule": pricing_rule,
            "partner_circuit": circuit if circuit.get("tier") in TIERS else None,
            "can_bill_patient": can_bill_patient,
            "vector_entry": vector_entry_public(franchisee),
            "bill_to_vectors": vector_bill_to_options(franchisee),
        }
    )


@frappe.whitelist()
def api_search_hub_lab_tests(txt=None, limit=30):
    _assert_franchisee_role()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
        api_search_hec_lab_tests,
    )

    franchisee = _resolve_hub_franchisee()
    raw = api_search_hec_lab_tests(
        txt=txt,
        limit=limit,
        franchisee_id=franchisee,
        intake_channel=HUB_INTAKE_CHANNEL,
    ) or {}
    tests = raw.get("tests") if isinstance(raw, dict) else []
    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import circuit_catalog_items

    chart_items = circuit_catalog_items(franchisee)
    if chart_items is not None:
        tests = [t for t in (tests or []) if (t.get("item_code") or t.get("item")) in chart_items]
    return _ok({"tests": tests or [], "count": len(tests or [])})


@frappe.whitelist()
def api_reprice_hub_lab_bill_lines(data=None):
    _assert_franchisee_role()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
        api_apply_patient_bill_rates,
    )

    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        tier_preview_for_lines,
    )

    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        assert_foco_can_bill_vector,
    )

    payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
    payload = dict(payload or {})
    franchisee = _resolve_hub_franchisee()
    bill_to_vector = (payload.pop("bill_to_vector", None) or "").strip()
    if bill_to_vector:
        assert_foco_can_bill_vector(franchisee, bill_to_vector)
        franchisee = bill_to_vector
    payload["franchisee_id"] = franchisee
    payload["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    raw = api_apply_patient_bill_rates(data=payload) or {}
    tests, tier_summary = tier_preview_for_lines(raw.get("tests") or [], franchisee)
    return _ok({"tests": tests, "partner_tier": tier_summary})


@frappe.whitelist()
def api_list_hub_lab_bills(limit=40, txt=None, payment_status=None):
    _assert_franchisee_role()
    franchisee = _resolve_hub_franchisee()
    limit = frappe.utils.cint(limit) or 40
    txt = (txt or frappe.form_dict.get("txt") or "").strip()
    filters = {"franchisee_id": franchisee}
    if frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
        filters["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    or_filters = None
    if txt:
        or_filters = [
            ["name", "like", f"%{txt}%"],
            ["patient_name", "like", f"%{txt}%"],
            ["unique_barcode", "like", f"%{txt}%"],
            ["patient_phone", "like", f"%{txt}%"],
        ]
    fields = [
        "name",
        "unique_barcode",
        "patient_name",
        "age",
        "gender",
        "patient_phone",
        "order_status",
        "creation",
        "amount",
        "referred_doctor",
    ]
    for f in (
        "hec_bill_datetime",
        "hec_net_amount",
        "hec_amount_paid",
        "hec_received",
        "hec_receipt_amount",
        "hec_due_amount",
        "hec_receipt_mode",
        "hec_patient_payment_status",
        "razorpay_payment_status",
        "referring_doctor_id",
        "ref_doctor_commission_amount",
        "unique_barcode",
        "age_months",
        "age_days",
    ):
        if frappe.get_meta("Customer TRF").has_field(f) and f not in fields:
            fields.append(f)
    rows = frappe.get_all(
        "Customer TRF",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        limit_page_length=limit,
        order_by="creation desc",
        ignore_permissions=True,
    )
    raw_filter = (payment_status or frappe.form_dict.get("payment_status") or "").strip()
    payment_filter = raw_filter.title() if raw_filter.lower() != "partially paid" else "Partially Paid"
    if payment_filter in ("Partial", "Partially"):
        payment_filter = "Partially Paid"
    bills = []
    for row in rows:
        snap = _bill_payment_snapshot(row)
        pstatus = snap["hec_patient_payment_status"]
        # Heal stale stored status so list stays correct next time.
        stored = (getattr(row, "hec_patient_payment_status", None) or "").strip()
        if stored in ("Partial",) or (stored and stored != pstatus):
            try:
                frappe.db.set_value(
                    "Customer TRF",
                    row.name,
                    {
                        "hec_patient_payment_status": pstatus,
                        "hec_due_amount": snap["hec_due_amount"],
                        "hec_amount_paid": snap["hec_amount_paid"],
                        "hec_net_amount": snap["hec_net_amount"],
                    },
                    update_modified=False,
                )
            except Exception:
                pass
        if payment_filter and payment_filter not in ("All", "") and pstatus != payment_filter:
            continue
        bills.append(
            {
                "name": row.name,
                "unique_barcode": row.unique_barcode,
                "patient_name": row.patient_name,
                "age": row.age,
                "age_months": frappe.utils.cint(getattr(row, "age_months", 0) or 0),
                "age_days": frappe.utils.cint(getattr(row, "age_days", 0) or 0),
                "gender": row.gender,
                "patient_phone": row.patient_phone or "",
                "order_status": row.order_status,
                "creation": str(row.creation or ""),
                "hec_bill_datetime": str(getattr(row, "hec_bill_datetime", "") or row.creation or ""),
                "hec_net_amount": snap["hec_net_amount"],
                "hec_amount_paid": snap["hec_amount_paid"],
                "hec_due_amount": snap["hec_due_amount"],
                "hec_receipt_mode": getattr(row, "hec_receipt_mode", None) or "",
                "hec_patient_payment_status": pstatus,
                "razorpay_payment_status": getattr(row, "razorpay_payment_status", None) or "",
                "referred_doctor": row.referred_doctor or "Self",
                "ref_doctor_commission_amount": float(getattr(row, "ref_doctor_commission_amount", None) or 0),
            }
        )
    return _ok({"bills": bills, "count": len(bills), "hub_franchisee": franchisee})


@frappe.whitelist()
def api_get_hub_lab_bill(name=None):
    _assert_franchisee_role()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
        api_get_hec_lab_bill,
    )

    name = (name or frappe.form_dict.get("name") or "").strip()
    franchisee = _resolve_hub_franchisee()
    raw = api_get_hec_lab_bill(name=name) or {}
    bill = raw.get("bill")
    if not bill:
        frappe.throw(_("Bill not found"))
    allowed = {bill.get("franchisee_id")}
    trf_meta = frappe.get_meta("Customer TRF")
    circuit_fields = [f for f in ("circuit_billed_by", "circuit_entry_partner") if trf_meta.has_field(f)]
    if circuit_fields:
        # A FOCO that raised the bill for a Vector (and the entry partner) may open it too.
        allowed.update((frappe.db.get_value("Customer TRF", name, circuit_fields, as_dict=True) or {}).values())
    if franchisee not in allowed:
        frappe.throw(_("Bill not found for your hub"), frappe.PermissionError)
    bill["hub_label"] = _franchise_label(bill.get("franchisee_id") or franchisee)
    bill["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    history = []
    raw_hist = bill.get("hec_payment_history")
    if isinstance(raw_hist, list):
        history = raw_hist
    elif isinstance(raw_hist, str) and raw_hist.strip():
        try:
            parsed = json.loads(raw_hist)
            history = parsed if isinstance(parsed, list) else []
        except Exception:
            history = []
    bill["payment_history"] = history
    snap = _bill_payment_snapshot(bill)
    bill["hec_net_amount"] = snap["hec_net_amount"]
    bill["hec_amount_paid"] = snap["hec_amount_paid"]
    bill["hec_due_amount"] = snap["hec_due_amount"]
    bill["hec_patient_payment_status"] = snap["hec_patient_payment_status"]
    return _ok({"bill": bill})


@frappe.whitelist()
def api_save_hub_lab_bill(data=None):
    """Full desk-style walk-in bill at partner hub — Phase 70 save + wallet settlement."""
    _assert_franchisee_role()
    ensure_hub_lab_bill_fields()

    from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
        api_save_hec_lab_bill,
    )

    payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
    if not payload:
        frappe.throw(_("Bill data required"))

    franchisee = _resolve_hub_franchisee()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        assert_can_bill_patient,
        assert_foco_can_bill_vector,
    )

    assert_can_bill_patient(franchisee)
    payload = dict(payload)
    billed_by = None
    bill_to_vector = (payload.get("bill_to_vector") or "").strip()
    if bill_to_vector:
        # FOCO raising the bill for a Vector (doctor / pharmacy) that enters through it: the bill belongs to the Vector.
        assert_foco_can_bill_vector(franchisee, bill_to_vector)
        billed_by = franchisee
        franchisee = bill_to_vector
    payload.pop("bill_to_vector", None)
    payload["franchisee_id"] = franchisee
    payload["coll_centre"] = franchisee
    payload["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    payload["hec_outside_sample"] = 0
    payload["order_status"] = payload.get("order_status") or "Booked"
    if not payload.get("payment_method"):
        mode = (payload.get("hec_receipt_mode") or "CASH").upper()
        payload["payment_method"] = "Pay at Hub" if mode == "CASH" else "Online"

    # Normalize patient payment snapshot before save (wallet fee is separate).
    net = flt(payload.get("hec_net_amount") or payload.get("amount") or 0)
    received = payload.get("hec_received")
    if received is None:
        received = payload.get("hec_amount_paid")
    if received is None or received == "":
        received = net
    received = flt(received)
    status, due = _payment_status_from_amounts(net, received)
    payload["hec_received"] = received
    payload["hec_amount_paid"] = received
    payload["hec_receipt_amount"] = received
    payload["hec_due_amount"] = due
    payload["hec_patient_payment_status"] = status

    result = api_save_hec_lab_bill(data=payload)
    if not isinstance(result, dict):
        result = {"ok": True, "raw": result}

    trf_name = result.get("name") or (result.get("bill") or {}).get("name")
    if not trf_name:
        frappe.throw(_("Bill save failed"))

    # Wallet + invoices (Phase 70 save already persisted referring doctor + commission ledger)
    try:
        settlement = finalize_hub_b2b_settlement(trf_name, franchisee, billed_by=billed_by)
        result.update(settlement)
    except Exception as exc:
        frappe.log_error(title="phase95_hub_settlement", message=frappe.get_traceback())
        try:
            frappe.delete_doc("Customer TRF", trf_name, force=1, ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            pass
        frappe.throw(str(exc))

    # Opening payment history (patient money only — never wallet).
    try:
        opening = _append_payment_event(
            trf_name,
            amount=received,
            mode=payload.get("hec_receipt_mode") or "CASH",
            notes="Opening receipt at walk-in billing",
            event_type="opening",
        )
        result["hec_patient_payment_status"] = opening["hec_patient_payment_status"]
        result["hec_due_amount"] = opening["hec_due_amount"]
        result["hec_amount_paid"] = opening["hec_amount_paid"]
        result["payment_history"] = opening["payment_history"]
    except Exception:
        frappe.log_error(title="phase95_payment_history", message=frappe.get_traceback())

    result["hub_franchisee"] = billed_by or franchisee
    result["bill_to_vector"] = franchisee if billed_by else None
    result["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    return _ok(result)


@frappe.whitelist()
def api_update_hub_patient_payment(data=None):
    """Record an additional patient payment against a hub bill. Wallet fee is untouched."""
    _assert_franchisee_role()
    ensure_patient_payment_fields()
    payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
    if not payload:
        payload = {
            "trf_name": frappe.form_dict.get("trf_name") or frappe.form_dict.get("name"),
            "amount_received": frappe.form_dict.get("amount_received"),
            "payment_mode": frappe.form_dict.get("payment_mode"),
            "notes": frappe.form_dict.get("notes"),
        }
    trf_name = (payload.get("trf_name") or payload.get("name") or "").strip()
    if not trf_name or not frappe.db.exists("Customer TRF", trf_name):
        frappe.throw(_("Bill not found"))
    franchisee = _resolve_hub_franchisee()
    owner = frappe.db.get_value("Customer TRF", trf_name, "franchisee_id")
    if owner != franchisee:
        frappe.throw(_("Bill not found for your hub"), frappe.PermissionError)

    amount = flt(payload.get("amount_received") or payload.get("amount") or 0)
    if amount <= 0:
        frappe.throw(_("Enter a received amount greater than zero"))
    mode = (payload.get("payment_mode") or payload.get("hec_receipt_mode") or "CASH").upper()
    notes = payload.get("notes") or "Balance collected"

    snap = _bill_payment_snapshot(frappe.get_doc("Customer TRF", trf_name))
    total = flt(snap["hec_net_amount"])
    paid = flt(snap["hec_amount_paid"])
    due = flt(snap["hec_due_amount"])
    if due <= 0.009:
        frappe.throw(_("This bill is already fully paid"))
    if amount - due > 0.5:
        frappe.throw(_("Received amount ₹{0} exceeds due ₹{1}").format(amount, due))

    updated = _append_payment_event(
        trf_name,
        amount=amount,
        mode=mode,
        notes=notes,
        event_type="payment",
    )
    # Refresh full bill for print/receipt
    from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
        api_get_hec_lab_bill,
    )

    raw = api_get_hec_lab_bill(name=trf_name) or {}
    bill = raw.get("bill") or {}
    bill["payment_history"] = updated["payment_history"]
    bill["hec_net_amount"] = updated["hec_net_amount"]
    bill["hec_amount_paid"] = updated["hec_amount_paid"]
    bill["hec_due_amount"] = updated["hec_due_amount"]
    bill["hec_patient_payment_status"] = updated["hec_patient_payment_status"]
    bill["hub_label"] = _franchise_label(franchisee)
    receipt = {
        "bill_total": updated["hec_net_amount"],
        "previous_payment": updated["previous_paid"],
        "new_payment": updated["new_payment"],
        "total_received": updated["hec_amount_paid"],
        "remaining_due": updated["hec_due_amount"],
        "payment_mode": mode,
        "payment_date": (updated.get("payment_entry") or {}).get("at"),
        "status": updated["hec_patient_payment_status"],
    }
    return _ok(
        {
            **updated,
            "bill": bill,
            "receipt": receipt,
            "receipt_ready": True,
        },
        message=_("Payment updated"),
    )


@frappe.whitelist()
def api_list_hub_download_reports(limit=50, txt=None):
    """List lab reports ready for download for this hub's patients."""
    _assert_franchisee_role()
    franchisee = _resolve_hub_franchisee()
    limit = frappe.utils.cint(limit) or 50
    txt = (txt or frappe.form_dict.get("txt") or "").strip()

    trf_filters = {"franchisee_id": franchisee}
    if frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
        trf_filters["sample_intake_channel"] = HUB_INTAKE_CHANNEL
    trfs = frappe.get_all(
        "Customer TRF",
        filters=trf_filters,
        fields=["name", "patient_name", "patient_phone", "unique_barcode", "order_status", "creation"],
        limit_page_length=300,
        order_by="creation desc",
        ignore_permissions=True,
    )
    if txt:
        q = txt.lower()
        trfs = [
            t
            for t in trfs
            if q in (t.name or "").lower()
            or q in (t.patient_name or "").lower()
            or q in (t.unique_barcode or "").lower()
            or q in (t.patient_phone or "")
        ]
    trf_ids = [t.name for t in trfs]
    by_trf = {t.name: t for t in trfs}
    reports = []
    if trf_ids and frappe.db.exists("DocType", "Patient Care Journey"):
        journeys = frappe.get_all(
            "Patient Care Journey",
            filters={
                "customer_trf": ("in", trf_ids),
                "status": ("in", ["Authorized", "Dispatched"]),
            },
            fields=["name", "customer_trf", "patient_name", "status", "report_pdf", "modified"],
            limit_page_length=limit,
            order_by="modified desc",
            ignore_permissions=True,
        )
        for j in journeys:
            if not j.report_pdf:
                continue
            trf = by_trf.get(j.customer_trf) or {}
            reports.append(
                {
                    "journey_id": j.name,
                    "trf_id": j.customer_trf,
                    "patient_name": j.patient_name or trf.get("patient_name"),
                    "barcode": trf.get("unique_barcode"),
                    "phone": trf.get("patient_phone"),
                    "status": j.status,
                    "report_pdf": j.report_pdf,
                    "updated_at": str(j.modified or ""),
                    "order_status": trf.get("order_status"),
                }
            )
            if len(reports) >= limit:
                break
    return _ok({"reports": reports, "count": len(reports), "hub_franchisee": franchisee})


@frappe.whitelist()
def api_download_hub_report(journey_id=None):
    """Stream report PDF for a hub-owned patient journey."""
    _assert_franchisee_role()
    journey_id = (journey_id or frappe.form_dict.get("journey_id") or "").strip()
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        frappe.throw(_("Report not found"))
    journey = frappe.db.get_value(
        "Patient Care Journey",
        journey_id,
        ["name", "customer_trf", "status", "report_pdf", "patient_name"],
        as_dict=True,
    )
    if not journey or journey.status not in ("Authorized", "Dispatched") or not journey.report_pdf:
        frappe.throw(_("Report is not ready for download"))
    franchisee = _resolve_hub_franchisee()
    owner = frappe.db.get_value("Customer TRF", journey.customer_trf, "franchisee_id")
    if owner != franchisee:
        frappe.throw(_("Not permitted to download this report"), frappe.PermissionError)

    from health_ecosystem_core.health_ecosystem_core.api import _resolve_file_doc

    file_doc = _resolve_file_doc(journey.report_pdf)
    if not file_doc:
        frappe.throw(_("Report file not found on server"))
    frappe.local.response.filename = file_doc.file_name or f"{journey_id}.pdf"
    frappe.local.response.filecontent = file_doc.get_content()
    frappe.local.response.type = "download"
    frappe.local.response["content_type"] = "application/pdf"
