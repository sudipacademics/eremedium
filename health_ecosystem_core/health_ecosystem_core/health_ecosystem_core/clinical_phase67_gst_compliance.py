"""Phase 67 — GST compliance (HSN/SAC, GSTR-1/2/3B, reconciliation) + MCA calendar."""

from __future__ import annotations

import csv
import io
import json
from calendar import monthrange
from datetime import date

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from health_ecosystem_core.health_ecosystem_core.api import (
    LAB_ITEM_GROUPS,
    PHARMACY_ITEM_GROUPS,
    _error,
    _is_reagent_or_excluded_item,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

MODULE = "Health Ecosystem Core"

WELLNESS_ITEM_GROUPS = (
    "Psychology & Mental Health",
    "Aesthetic Dermatology",
    "Physiotherapy & Rehabilitation",
    "Chiropractic & Osteopathy",
    "Ayurveda & Naturopathy",
    "Yoga & Mindfulness",
    "Services",
)

# class_key → (hsn_sac, tax_category Goods|Service, gst_rate, label)
HSN_SEED_RULES = (
    ("lab_tests", "999312", "Service", 18.0, "Medical laboratory / diagnostic services (SAC)", list(LAB_ITEM_GROUPS)),
    ("wellness", "999319", "Service", 18.0, "Other human health services (SAC)", list(WELLNESS_ITEM_GROUPS)),
    ("reagents", "3822", "Goods", 18.0, "Diagnostic / laboratory reagents (HSN)", ["Consumables", "Raw Material"]),
    ("pharmacy", "3004", "Goods", 12.0, "Medicaments (HSN)", list(PHARMACY_ITEM_GROUPS)),
    ("fallback_goods", "3822", "Goods", 18.0, "Fallback goods HSN", []),
    ("fallback_service", "999799", "Service", 18.0, "Fallback other services SAC", []),
)

MCA_FILING_TYPES = (
    ("AOC-4", "Financial statements"),
    ("MGT-7", "Annual return"),
    ("MGT-7A", "Annual return (OPC/small)"),
    ("DIR-3 KYC", "Director KYC"),
    ("MSME-1", "Outstanding dues to MSME"),
    ("ADT-1", "Auditor appointment"),
    ("DPT-3", "Return of deposits"),
)


def _accounts_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    roles = set(frappe.get_roles(user))
    return bool(
        roles
        & {
            "Accounts Manager",
            "Accounts User",
            "System Manager",
            "Health System Admin",
            "Administrator",
        }
    ) or is_staff(user)


def _require_accounts():
    _require_mobile_auth()
    if not _accounts_user():
        frappe.throw(_("Accounts / staff access required"), frappe.PermissionError)


def _field(fieldname, fieldtype, label=None, **kw):
    row = {"fieldname": fieldname, "fieldtype": fieldtype, "label": label or fieldname.replace("_", " ").title()}
    row.update(kw)
    return row


def _ensure_doctype(name, *, fields, istable=0, autoname=None, naming_series=None, is_single=0, title_field=None):
    if frappe.db.exists("DocType", name):
        # Add any missing fields (non-destructive)
        meta = frappe.get_meta(name)
        existing = {f.fieldname for f in meta.fields}
        doc = frappe.get_doc("DocType", name)
        changed = False
        for f in fields:
            if f["fieldname"] not in existing and f.get("fieldtype") not in ("Section Break", "Column Break"):
                doc.append("fields", f)
                changed = True
        if changed:
            doc.save(ignore_permissions=True)
            frappe.clear_cache(doctype=name)
        return name

    payload = {
        "doctype": "DocType",
        "name": name,
        "module": MODULE,
        "custom": 0,
        "istable": istable,
        "issingle": is_single,
        "engine": "InnoDB",
        "fields": fields,
        "permissions": [
            {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "submit": 0},
            {"role": "Accounts Manager", "read": 1, "write": 1, "create": 1, "delete": 0},
            {"role": "Accounts User", "read": 1, "write": 1, "create": 1, "delete": 0},
        ],
    }
    if istable:
        payload["permissions"] = []
    if is_single:
        payload["issingle"] = 1
    if autoname:
        payload["autoname"] = autoname
        if autoname == "naming_series:" and naming_series:
            payload["naming_rule"] = 'By "Naming Series" field'
    if title_field:
        payload["title_field"] = title_field
    frappe.get_doc(payload).insert(ignore_permissions=True)
    frappe.clear_cache(doctype=name)
    return name


def ensure_phase67_doctypes():
    _ensure_doctype(
        "HEC HSN Rule",
        autoname="field:rule_key",
        title_field="rule_key",
        fields=[
            _field("rule_key", "Data", "Rule Key", reqd=1, unique=1, in_list_view=1),
            _field("label", "Data", "Label", in_list_view=1),
            _field("hsn_sac", "Data", "HSN / SAC", reqd=1, in_list_view=1),
            _field("tax_category", "Select", "Tax Category", options="Goods\nService", reqd=1, default="Service"),
            _field("gst_rate", "Percent", "GST %", reqd=1, default="18"),
            _field("item_groups", "Small Text", "Item Groups (comma-separated)"),
            _field("match_reagent", "Check", "Match Reagents", default=0),
            _field("is_fallback", "Check", "Fallback Rule", default=0),
            _field("active", "Check", "Active", default=1),
            _field("item_tax_template", "Link", "Item Tax Template", options="Item Tax Template"),
        ],
    )

    _ensure_doctype(
        "GST Return Line",
        istable=1,
        fields=[
            _field("form_type", "Select", "Form", options="GSTR-1\nGSTR-2\nGSTR-3B", in_list_view=1),
            _field("invoice", "Data", "Invoice", in_list_view=1),
            _field("invoice_date", "Date", "Invoice Date"),
            _field("party", "Data", "Party"),
            _field("party_gstin", "Data", "Party GSTIN"),
            _field("place_of_supply", "Data", "Place of Supply"),
            _field("hsn_sac", "Data", "HSN/SAC", in_list_view=1),
            _field("taxable_value", "Currency", "Taxable", in_list_view=1),
            _field("cgst_amount", "Currency", "CGST"),
            _field("sgst_amount", "Currency", "SGST"),
            _field("igst_amount", "Currency", "IGST"),
            _field("cess_amount", "Currency", "Cess"),
            _field("reverse_charge", "Check", "RCM", default=0),
            _field("match_status", "Select", "Match", options="\nMatched\nMismatch\nMissing in Books\nMissing in 2B"),
            _field("notes", "Small Text", "Notes"),
        ],
    )

    _ensure_doctype(
        "GST Return Period",
        autoname="naming_series:",
        naming_series="GSTR-.#####",
        title_field="period_label",
        fields=[
            _field("naming_series", "Select", "Series", options="GSTR-.#####", default="GSTR-.#####", reqd=1),
            _field("company", "Link", "Company", options="Company", reqd=1, in_list_view=1),
            _field("fiscal_year", "Data", "Fiscal Year", in_list_view=1),
            _field("period_month", "Int", "Month (1-12)", reqd=1, in_list_view=1),
            _field("period_year", "Int", "Year", reqd=1, in_list_view=1),
            _field("period_label", "Data", "Period Label", read_only=1),
            _field("from_date", "Date", "From Date", reqd=1),
            _field("to_date", "Date", "To Date", reqd=1),
            _field(
                "status",
                "Select",
                "Status",
                options="Draft\nGenerated\nFiled\nReconciled",
                default="Draft",
                in_list_view=1,
            ),
            _field("gstr1_taxable", "Currency", "GSTR-1 Taxable", read_only=1),
            _field("gstr1_tax", "Currency", "GSTR-1 Tax", read_only=1),
            _field("gstr2_taxable", "Currency", "GSTR-2 Taxable", read_only=1),
            _field("gstr2_tax", "Currency", "GSTR-2 Tax", read_only=1),
            _field("gstr3b_json", "Long Text", "GSTR-3B Summary JSON", read_only=1),
            _field("lines", "Table", "Lines", options="GST Return Line"),
            _field("filed_on", "Date", "Filed On"),
            _field("remarks", "Small Text", "Remarks"),
        ],
    )

    _ensure_doctype(
        "GST Reconciliation Entry",
        autoname="naming_series:",
        naming_series="GSTREC-.#####",
        fields=[
            _field("naming_series", "Select", "Series", options="GSTREC-.#####", default="GSTREC-.#####", reqd=1),
            _field("gst_return_period", "Link", "GST Return Period", options="GST Return Period", reqd=1, in_list_view=1),
            _field("source", "Select", "Source", options="GSTR-2B Upload\nManual", default="GSTR-2B Upload"),
            _field("invoice_no", "Data", "Invoice No", in_list_view=1),
            _field("supplier_gstin", "Data", "Supplier GSTIN", in_list_view=1),
            _field("invoice_date", "Date", "Invoice Date"),
            _field("taxable_value", "Currency", "Taxable"),
            _field("tax_amount", "Currency", "Tax"),
            _field(
                "match_status",
                "Select",
                "Match Status",
                options="Pending\nMatched\nMismatch\nMissing in Books\nMissing in 2B",
                default="Pending",
                in_list_view=1,
            ),
            _field("books_invoice", "Data", "Books Invoice"),
            _field("variance_amount", "Currency", "Variance"),
            _field("raw_payload", "Long Text", "Raw Row JSON"),
        ],
    )

    _ensure_doctype(
        "MCA Company Profile",
        is_single=1,
        fields=[
            _field("company_name", "Data", "Company Name"),
            _field("cin", "Data", "CIN"),
            _field("pan", "Data", "PAN"),
            _field("gstin", "Data", "GSTIN"),
            _field("registered_office", "Small Text", "Registered Office"),
            _field("authorized_capital", "Currency", "Authorized Capital"),
            _field("paid_up_capital", "Currency", "Paid-up Capital"),
            _field("incorporation_date", "Date", "Incorporation Date"),
            _field("financial_year_end", "Select", "FY End Month", options="\nMarch\nDecember", default="March"),
        ],
    )

    _ensure_doctype(
        "MCA Director Register",
        autoname="field:din",
        title_field="full_name",
        fields=[
            _field("din", "Data", "DIN", reqd=1, unique=1, in_list_view=1),
            _field("full_name", "Data", "Full Name", reqd=1, in_list_view=1),
            _field("designation", "Data", "Designation", in_list_view=1),
            _field("appointment_date", "Date", "Appointment Date"),
            _field("cessation_date", "Date", "Cessation Date"),
            _field("active", "Check", "Active", default=1),
            _field("email", "Data", "Email"),
            _field("pan", "Data", "PAN"),
        ],
    )

    _ensure_doctype(
        "MCA Filing Calendar",
        autoname="naming_series:",
        naming_series="MCA-.#####",
        fields=[
            _field("naming_series", "Select", "Series", options="MCA-.#####", default="MCA-.#####", reqd=1),
            _field("filing_type", "Select", "Filing Type", options="\n".join(t[0] for t in MCA_FILING_TYPES), reqd=1, in_list_view=1),
            _field("description", "Data", "Description"),
            _field("due_date", "Date", "Due Date", reqd=1, in_list_view=1),
            _field("period_label", "Data", "Period"),
            _field(
                "status",
                "Select",
                "Status",
                options="Upcoming\nIn Progress\nFiled\nOverdue",
                default="Upcoming",
                in_list_view=1,
            ),
            _field("filed_on", "Date", "Filed On"),
            _field("attachment_url", "Data", "Attachment / Drive Link"),
            _field("remarks", "Small Text", "Remarks"),
        ],
    )


def ensure_item_tax_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_hsn_sac",
                    "label": "HEC HSN / SAC",
                    "fieldtype": "Data",
                    "insert_after": "stock_uom",
                    "in_list_view": 0,
                },
                {
                    "fieldname": "hec_gst_rate",
                    "label": "HEC GST Rate %",
                    "fieldtype": "Percent",
                    "insert_after": "hec_hsn_sac",
                },
                {
                    "fieldname": "hec_tax_category",
                    "label": "HEC Tax Category",
                    "fieldtype": "Select",
                    "options": "\nGoods\nService",
                    "insert_after": "hec_gst_rate",
                },
            ]
        },
        update=True,
    )


def _company_abbr():
    company = frappe.defaults.get_global_default("company") or frappe.db.get_single_value("Global Defaults", "default_company")
    if not company:
        company = frappe.db.get_value("Company", {}, "name")
    return company, (frappe.db.get_value("Company", company, "abbr") if company else "HEC")


def _ensure_tax_account(company, account_name, account_type="Tax"):
    existing = frappe.db.get_value("Account", {"account_name": account_name, "company": company}, "name")
    if existing:
        return existing
    parent = frappe.db.get_value(
        "Account",
        {"company": company, "account_type": "Tax", "is_group": 1},
        "name",
    ) or frappe.db.get_value(
        "Account",
        {"company": company, "account_name": ["like", "%Duties and Taxes%"], "is_group": 1},
        "name",
    )
    if not parent:
        return None
    abbr = frappe.db.get_value("Company", company, "abbr") or "HEC"
    name = f"{account_name} - {abbr}"
    if frappe.db.exists("Account", name):
        return name
    try:
        doc = frappe.get_doc(
            {
                "doctype": "Account",
                "account_name": account_name,
                "parent_account": parent,
                "company": company,
                "account_type": account_type,
                "is_group": 0,
                "account_currency": frappe.db.get_value("Company", company, "default_currency") or "INR",
            }
        )
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception:
        frappe.log_error(title="phase67_tax_account", message=frappe.get_traceback())
        return None


def _find_item_tax_template(title_prefix, company=None):
    company = company or _company_abbr()[0]
    name = frappe.db.get_value(
        "Item Tax Template",
        {"title": title_prefix, "company": company},
        "name",
    )
    if name:
        return name
    return frappe.db.get_value(
        "Item Tax Template",
        {"title": ["like", f"{title_prefix}%"], "company": company},
        "name",
    )


def ensure_item_tax_templates():
    """Create Output (sales) Item Tax Templates for 12%/18% InState & InterState."""
    company, _abbr = _company_abbr()
    if not company:
        return {}
    created = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        for kind, splits in (
            ("InState", (("CGST", half), ("SGST", half))),
            ("InterState", (("IGST", rate),)),
        ):
            template_title = f"HEC GST {rate:g}% {kind}"
            existing = _find_item_tax_template(template_title, company)
            if existing:
                created[f"{rate}_{kind}"] = existing
                continue
            taxes = []
            for tax_label, tax_rate in splits:
                acc = _ensure_tax_account(company, f"Output {tax_label} {tax_rate:g}% - HEC")
                if not acc:
                    continue
                taxes.append({"tax_type": acc, "tax_rate": tax_rate})
            if not taxes or len(taxes) < len(splits):
                continue
            try:
                doc = frappe.get_doc(
                    {
                        "doctype": "Item Tax Template",
                        "title": template_title,
                        "company": company,
                        "taxes": taxes,
                    }
                )
                doc.insert(ignore_permissions=True)
                created[f"{rate}_{kind}"] = doc.name
            except Exception:
                frappe.log_error(title="phase67_item_tax_template", message=frappe.get_traceback())
    return created


def ensure_input_item_tax_templates():
    """Create Input (purchase) Item Tax Templates — used for item-wise PINV GST."""
    company, _abbr = _company_abbr()
    if not company:
        return {}
    created = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        for kind, splits in (
            ("InState", (("CGST", half), ("SGST", half))),
            ("InterState", (("IGST", rate),)),
        ):
            template_title = f"HEC Input GST {rate:g}% {kind}"
            existing = _find_item_tax_template(template_title, company)
            if existing:
                created[f"input_{rate}_{kind}"] = existing
                continue
            taxes = []
            for tax_label, tax_rate in splits:
                acc = _ensure_tax_account(company, f"Input {tax_label} {tax_rate:g}% - HEC")
                if not acc:
                    continue
                taxes.append({"tax_type": acc, "tax_rate": tax_rate})
            if not taxes or len(taxes) < len(splits):
                continue
            try:
                doc = frappe.get_doc(
                    {
                        "doctype": "Item Tax Template",
                        "title": template_title,
                        "company": company,
                        "taxes": taxes,
                    }
                )
                doc.insert(ignore_permissions=True)
                created[f"input_{rate}_{kind}"] = doc.name
            except Exception:
                frappe.log_error(title="phase67_input_item_tax_template", message=frappe.get_traceback())
    return created


def _normalized_gst_rate(item_code):
    rate = flt(frappe.db.get_value("Item", item_code, "hec_gst_rate") or 0)
    if rate <= 0:
        rule = resolve_hsn_for_item(item_code)
        rate = flt(rule.get("gst_rate") or 18)
    # Bucket to supported templates
    if rate <= 5:
        return 5.0  # no 5% template yet — fall through to 12
    if rate <= 12:
        return 12.0
    return 18.0


def resolve_item_tax_template(item_code, direction="sales", interstate=False):
    """Pick Item Tax Template for this item's GST rate (sales=Output, purchase=Input)."""
    ensure_item_tax_templates()
    if direction == "purchase":
        ensure_input_item_tax_templates()
    rate = _normalized_gst_rate(item_code)
    if rate not in (12.0, 18.0):
        rate = 18.0
    kind = "InterState" if interstate else "InState"
    if direction == "purchase":
        title = f"HEC Input GST {rate:g}% {kind}"
    else:
        title = f"HEC GST {rate:g}% {kind}"
    tmpl = _find_item_tax_template(title)
    if not tmpl:
        frappe.throw(_("Item Tax Template missing: {0}").format(title))
    return tmpl


def sync_item_master_taxes(item_code, force=True):
    """Write Item.taxes so desk/invoice fetch picks the correct sales template."""
    if not frappe.get_meta("Item").has_field("taxes"):
        return None
    apply_hsn_to_item(item_code, force=False)
    tmpl = resolve_item_tax_template(item_code, direction="sales")
    doc = frappe.get_doc("Item", item_code)
    existing = [r.item_tax_template for r in (doc.taxes or [])]
    if not force and tmpl in existing:
        return tmpl
    doc.set("taxes", [])
    doc.append("taxes", {"item_tax_template": tmpl})
    doc.flags.ignore_validate = True
    doc.save(ignore_permissions=True)
    return tmpl


def _item_tax_rate_for_template(company, template_name):
    from erpnext.stock.get_item_details import get_item_tax_map

    return get_item_tax_map(company, template_name, as_json=True)


def _tax_map_dict(company, template_name):
    from erpnext.stock.get_item_details import get_item_tax_map

    raw = get_item_tax_map(company, template_name, as_json=False) or {}
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    return {k: flt(v) for k, v in (raw or {}).items()}


def build_tabulated_taxes_from_templates(company, templates):
    """
    Union of tax accounts across item templates → invoice taxes table.
    Rate on each tax row is 0 — actual GST comes from each line's item_tax_rate
    so a 12% item is never charged on an 18% account (and vice versa).
    """
    accounts = {}
    for tmpl in templates:
        if not tmpl:
            continue
        for acc, rate in _tax_map_dict(company, tmpl).items():
            accounts[acc] = flt(rate)
    rows = []
    for acc, _rate in sorted(accounts.items(), key=lambda x: x[0]):
        desc = acc
        for token in ("Input ", "Output "):
            if token in acc:
                desc = acc.split(" - ")[0]
                break
        rows.append(
            {
                "category": "Total",
                "add_deduct_tax": "Add",
                "charge_type": "On Net Total",
                "account_head": acc,
                "description": desc,
                "rate": 0,
            }
        )
    return rows


def _decorate_invoice_items_with_itemwise_tax(company, items, direction="sales"):
    """Set item_tax_template + item_tax_rate on each line from that item's GST rate."""
    templates_used = []
    out = []
    for row in items:
        row = dict(row)
        code = row.get("item_code")
        tmpl = resolve_item_tax_template(code, direction=direction)
        # Keep Item.taxes aligned to sales (Output) for catalog; PINV overrides per line
        if direction == "sales":
            sync_item_master_taxes(code, force=False)
        row["item_tax_template"] = tmpl
        row["item_tax_rate"] = _item_tax_rate_for_template(company, tmpl)
        templates_used.append(tmpl)
        out.append(row)
    return out, templates_used


def ensure_purchase_gst_masters():
    """Input GST accounts + doc-level purchase templates + input item tax templates."""
    company, abbr = _company_abbr()
    if not company:
        return {}

    ensure_item_tax_templates()
    input_itt = ensure_input_item_tax_templates()

    accounts = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        accounts[f"input_cgst_{half:g}"] = _ensure_tax_account(company, f"Input CGST {half:g}% - HEC")
        accounts[f"input_sgst_{half:g}"] = _ensure_tax_account(company, f"Input SGST {half:g}% - HEC")
        accounts[f"input_igst_{rate:g}"] = _ensure_tax_account(company, f"Input IGST {rate:g}% - HEC")

    templates = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        cgst = accounts.get(f"input_cgst_{half:g}")
        sgst = accounts.get(f"input_sgst_{half:g}")
        igst = accounts.get(f"input_igst_{rate:g}")

        in_title = f"HEC GST Purchase InState {rate:g}%"
        inter_title = f"HEC GST Purchase InterState {rate:g}%"

        if cgst and sgst:
            templates[f"purchase_in_{rate:g}"] = _ensure_purchase_tax_template(
                company,
                in_title,
                [
                    ("On Net Total", cgst, half, f"Input CGST {half:g}%"),
                    ("On Net Total", sgst, half, f"Input SGST {half:g}%"),
                ],
            )
        if igst:
            templates[f"purchase_inter_{rate:g}"] = _ensure_purchase_tax_template(
                company,
                inter_title,
                [("On Net Total", igst, rate, f"Input IGST {rate:g}%")],
            )

    return {
        "accounts": accounts,
        "templates": templates,
        "input_item_tax_templates": input_itt,
        "company": company,
        "abbr": abbr,
    }


def ensure_sales_gst_masters():
    """Sales Taxes and Charges Templates (Output) for tabulated GST."""
    company, abbr = _company_abbr()
    if not company:
        return {}
    ensure_item_tax_templates()
    accounts = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        accounts[f"output_cgst_{half:g}"] = _ensure_tax_account(company, f"Output CGST {half:g}% - HEC")
        accounts[f"output_sgst_{half:g}"] = _ensure_tax_account(company, f"Output SGST {half:g}% - HEC")
        accounts[f"output_igst_{rate:g}"] = _ensure_tax_account(company, f"Output IGST {rate:g}% - HEC")

    templates = {}
    for rate in (12.0, 18.0):
        half = rate / 2.0
        cgst = accounts.get(f"output_cgst_{half:g}")
        sgst = accounts.get(f"output_sgst_{half:g}")
        title = f"HEC GST Sales InState {rate:g}%"
        if cgst and sgst:
            templates[f"sales_in_{rate:g}"] = _ensure_sales_tax_template(
                company,
                title,
                [
                    ("On Net Total", cgst, half, f"Output CGST {half:g}%"),
                    ("On Net Total", sgst, half, f"Output SGST {half:g}%"),
                ],
            )
    return {"accounts": accounts, "templates": templates, "company": company, "abbr": abbr}


def _ensure_sales_tax_template(company, title, rows):
    existing = frappe.db.get_value(
        "Sales Taxes and Charges Template",
        {"title": title, "company": company},
        "name",
    ) or frappe.db.get_value(
        "Sales Taxes and Charges Template",
        {"title": ["like", f"{title}%"], "company": company},
        "name",
    )
    if existing:
        return existing
    taxes = []
    for charge_type, account_head, rate, description in rows:
        if not account_head:
            continue
        taxes.append(
            {
                "charge_type": charge_type,
                "account_head": account_head,
                "description": description,
                "rate": flt(rate),
            }
        )
    if not taxes:
        return None
    doc = frappe.get_doc(
        {
            "doctype": "Sales Taxes and Charges Template",
            "title": title,
            "company": company,
            "taxes": taxes,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_purchase_tax_template(company, title, rows):
    existing = frappe.db.get_value(
        "Purchase Taxes and Charges Template",
        {"title": title, "company": company},
        "name",
    )
    if existing:
        return existing
    like = frappe.db.get_value(
        "Purchase Taxes and Charges Template",
        {"title": ["like", f"{title}%"], "company": company},
        "name",
    )
    if like:
        return like

    taxes = []
    for charge_type, account_head, rate, description in rows:
        if not account_head:
            continue
        taxes.append(
            {
                "category": "Total",
                "add_deduct_tax": "Add",
                "charge_type": charge_type,
                "account_head": account_head,
                "description": description,
                "rate": flt(rate),
            }
        )
    if not taxes:
        return None
    doc = frappe.get_doc(
        {
            "doctype": "Purchase Taxes and Charges Template",
            "title": title,
            "company": company,
            "taxes": taxes,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _default_warehouse(company):
    wh = frappe.db.get_value("Warehouse", {"company": company, "warehouse_name": "Stores", "is_group": 0}, "name")
    if wh:
        return wh
    return frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")


def _default_cost_center(company):
    return frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")


def _default_income_account(company):
    return frappe.db.get_value(
        "Company", company, "default_income_account"
    ) or frappe.db.get_value("Account", {"company": company, "account_type": "Income Account", "is_group": 0}, "name")


def _ensure_smoke_supplier(company):
    name = "HEC GST Smoke Supplier"
    if frappe.db.exists("Supplier", name):
        return name
    group = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name")
    if not group:
        group = frappe.db.get_value("Supplier Group", {}, "name")
    doc = frappe.get_doc(
        {
            "doctype": "Supplier",
            "supplier_name": name,
            "supplier_group": group or "All Supplier Groups",
            "supplier_type": "Company",
        }
    )
    if frappe.get_meta("Supplier").has_field("gstin"):
        doc.gstin = "29AABCT1332L1ZV"
    if frappe.get_meta("Supplier").has_field("tax_id"):
        doc.tax_id = "AABCT1332L"
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_smoke_customer(company):
    name = "HEC GST Smoke Customer"
    if frappe.db.exists("Customer", name):
        return name
    group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name") or "All Customer Groups"
    territory = frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories"
    doc = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": name,
            "customer_type": "Individual",
            "customer_group": group,
            "territory": territory,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _swap_item_taxes_for_purchase(item_codes, company):
    """
    Temporarily point Item.taxes at Input GST templates so PINV validate/fetch
    keeps item-wise Input rates. Returns restore payload.
    """
    restore = []
    for code in item_codes:
        if not frappe.get_meta("Item").has_field("taxes"):
            continue
        doc = frappe.get_doc("Item", code)
        prev = [r.as_dict() for r in (doc.taxes or [])]
        input_tmpl = resolve_item_tax_template(code, direction="purchase")
        doc.set("taxes", [])
        doc.append("taxes", {"item_tax_template": input_tmpl})
        doc.flags.ignore_validate = True
        doc.flags.ignore_permissions = True
        doc.save(ignore_permissions=True)
        restore.append((code, prev))
    frappe.db.commit()
    return restore


def _restore_item_taxes(restore):
    for code, prev in restore or []:
        doc = frappe.get_doc("Item", code)
        doc.set("taxes", [])
        for row in prev:
            doc.append(
                "taxes",
                {
                    "item_tax_template": row.get("item_tax_template"),
                    "tax_category": row.get("tax_category"),
                    "valid_from": row.get("valid_from"),
                },
            )
        if not prev:
            # Restore sales Output default
            try:
                sync_item_master_taxes(code, force=True)
                continue
            except Exception:
                pass
        doc.flags.ignore_validate = True
        doc.save(ignore_permissions=True)
    frappe.db.commit()


def _serialize_invoice_tax_breakup(doc):
    lines = []
    for item in doc.items or []:
        tax_map = {}
        if item.item_tax_rate:
            try:
                tax_map = json.loads(item.item_tax_rate) if isinstance(item.item_tax_rate, str) else dict(item.item_tax_rate)
            except Exception:
                tax_map = {}
        line_tax = 0.0
        base_amt = flt(item.net_amount if item.net_amount is not None else item.amount)
        for _acc, r in (tax_map or {}).items():
            line_tax += base_amt * flt(r) / 100.0
        lines.append(
            {
                "item_code": item.item_code,
                "qty": flt(item.qty),
                "rate": flt(item.rate),
                "amount": flt(item.amount),
                "net_amount": flt(item.net_amount) if item.net_amount is not None else flt(item.amount),
                "discount_percentage": flt(getattr(item, "discount_percentage", 0) or 0),
                "discount_amount": flt(getattr(item, "discount_amount", 0) or 0),
                "is_free_item": cint(getattr(item, "is_free_item", 0)),
                "item_tax_template": getattr(item, "item_tax_template", None),
                "item_tax_rate": tax_map,
                "expected_line_tax": round(line_tax, 2),
                "gst_rate": _normalized_gst_rate(item.item_code),
                "hsn": frappe.db.get_value("Item", item.item_code, "hec_hsn_sac"),
            }
        )
    tax_rows = [
        {
            "account_head": t.account_head,
            "description": t.description,
            "rate": flt(t.rate),
            "tax_amount": flt(t.tax_amount or t.base_tax_amount),
        }
        for t in (doc.taxes or [])
    ]
    return {
        "lines": lines,
        "tax_rows": tax_rows,
        "total_tax": sum(r["tax_amount"] for r in tax_rows),
        "expected_total_tax": sum(l["expected_line_tax"] for l in lines),
        "net_total": flt(doc.net_total or doc.base_net_total),
        "grand_total": flt(doc.grand_total or doc.base_grand_total),
        "additional_discount_percentage": flt(getattr(doc, "additional_discount_percentage", 0) or 0),
        "discount_amount": flt(getattr(doc, "discount_amount", 0) or getattr(doc, "base_discount_amount", 0) or 0),
        "apply_discount_on": getattr(doc, "apply_discount_on", None),
        "free_qty_total": sum(flt(l["qty"]) for l in lines if l["is_free_item"]),
        "paid_qty_total": sum(flt(l["qty"]) for l in lines if not l["is_free_item"]),
    }


def parse_lot_scheme(scheme):
    """Parse '9:1' → (paid_ratio=9, free_ratio=1)."""
    if not scheme:
        return None
    text = str(scheme).strip().lower().replace(" ", "")
    if ":" not in text:
        frappe.throw(_("Lot scheme must look like 9:1 (paid:free), got {0}").format(scheme))
    left, right = text.split(":", 1)
    paid, free = cint(left), cint(right)
    if paid <= 0 or free < 0:
        frappe.throw(_("Invalid lot scheme {0}").format(scheme))
    return paid, free


def split_lot_qty(received_qty, scheme):
    """
    Volume / lot discount: for scheme 9:1, every 10 units received → 9 paid + 1 free.
    received_qty is the physical qty delivered.
    """
    paid_ratio, free_ratio = parse_lot_scheme(scheme)
    batch = paid_ratio + free_ratio
    received = cint(round(flt(received_qty)))
    if received <= 0:
        return 0, 0
    free_qty = (received // batch) * free_ratio
    paid_qty = received - free_qty
    return paid_qty, free_qty


def expand_purchase_discount_lines(items):
    """
    Expand logical purchase lines into PO/PINV rows:
    - lot_scheme / volume_scheme e.g. '9:1' → paid line + is_free_item line
    - discount_percentage / discount_amount on paid lines
    - is_free_item passthrough
    """
    if isinstance(items, str):
        items = json.loads(items or "[]")
    expanded = []
    for raw in items or []:
        row = dict(raw)
        code = row.get("item_code")
        if not code:
            continue
        qty = flt(row.get("qty") or 0)
        rate = flt(row.get("rate") or 0)
        scheme = row.get("lot_scheme") or row.get("volume_scheme") or row.get("lot_discount")
        disc_pct = flt(row.get("discount_percentage") or 0)
        disc_amt = flt(row.get("discount_amount") or 0)
        price_list_rate = flt(row.get("price_list_rate") or rate)

        base = {
            "item_code": code,
            "price_list_rate": price_list_rate,
            "_is_stock": row.get("_is_stock"),
            "warehouse": row.get("warehouse"),
            "cost_center": row.get("cost_center"),
            "notes": row.get("notes"),
        }

        if scheme and qty > 0:
            paid_qty, free_qty = split_lot_qty(qty, scheme)
            if paid_qty > 0:
                expanded.append(
                    {
                        **base,
                        "qty": paid_qty,
                        "rate": rate,
                        "discount_percentage": disc_pct,
                        "discount_amount": disc_amt,
                        "is_free_item": 0,
                        "lot_scheme": scheme,
                        "description": f"{code} — lot {scheme} (paid)",
                    }
                )
            if free_qty > 0:
                expanded.append(
                    {
                        **base,
                        "qty": free_qty,
                        "rate": rate,
                        "price_list_rate": price_list_rate or rate,
                        # FOC: 100% line discount so billed amount is zero
                        "discount_percentage": 100,
                        "discount_amount": 0,
                        "is_free_item": 1,
                        "lot_scheme": scheme,
                        "description": f"{code} — lot {scheme} (FOC / free)",
                    }
                )
            continue

        expanded.append(
            {
                **base,
                "qty": qty,
                "rate": rate,
                "discount_percentage": disc_pct,
                "discount_amount": disc_amt,
                "is_free_item": cint(row.get("is_free_item") or 0),
                "lot_scheme": None,
                "description": row.get("description") or code,
            }
        )
    return expanded


def _line_fields_for_purchase(row, warehouse, cost_center, po_name=None, po_detail=None):
    """Common PO/PINV item fields including discounts + free goods."""
    out = {
        "item_code": row["item_code"],
        "qty": flt(row["qty"]),
        "rate": flt(row["rate"]),
        "price_list_rate": flt(row.get("price_list_rate") or row["rate"]),
        "schedule_date": nowdate(),
        "warehouse": warehouse if row.get("_is_stock") else None,
        "cost_center": cost_center,
        "discount_percentage": flt(row.get("discount_percentage") or 0),
        "discount_amount": flt(row.get("discount_amount") or 0),
        "is_free_item": cint(row.get("is_free_item") or 0),
        "description": row.get("description") or row["item_code"],
    }
    if po_name:
        out["purchase_order"] = po_name
    if po_detail:
        out["po_detail"] = po_detail
    if row.get("item_tax_template"):
        out["item_tax_template"] = row["item_tax_template"]
    if row.get("item_tax_rate"):
        out["item_tax_rate"] = row["item_tax_rate"]
    return out


def run_purchase_cycle_with_gst(
    qty=10,
    rate=100.0,
    item_code=None,
    items=None,
    invoice_discount=None,
):
    """
    Purchase cycle with ITEM-WISE GST + purchase discounts:
    - lot_scheme e.g. 9:1 (volume / FOC)
    - line discount_percentage / discount_amount
    - invoice_discount: {apply_discount_on, additional_discount_percentage, discount_amount}
    """
    ensure_item_tax_fields()
    seed_hsn_rules()
    masters = ensure_purchase_gst_masters()
    company = masters.get("company") or _company_abbr()[0]
    if not company:
        frappe.throw(_("No company configured"))

    if items is None:
        if item_code:
            items = [{"item_code": item_code, "qty": qty, "rate": rate}]
        else:
            if not frappe.db.exists("Item", "REAGENT-CBC"):
                from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import _ensure_reagent_item

                _ensure_reagent_item("REAGENT-CBC", "CBC Reagent Kit")
            pharma = frappe.db.get_value(
                "Item",
                {"item_group": ["in", list(PHARMACY_ITEM_GROUPS)], "disabled": 0, "is_purchase_item": 1},
                "name",
            ) or frappe.db.get_value(
                "Item",
                {"item_group": ["in", list(PHARMACY_ITEM_GROUPS)], "disabled": 0},
                "name",
            )
            items = [{"item_code": "REAGENT-CBC", "qty": 10, "rate": 100.0}]
            if pharma:
                frappe.db.set_value("Item", pharma, {"is_purchase_item": 1, "disabled": 0}, update_modified=False)
                items.append({"item_code": pharma, "qty": 5, "rate": 200.0})

    if isinstance(items, str):
        items = json.loads(items or "[]")
    if isinstance(invoice_discount, str):
        invoice_discount = json.loads(invoice_discount or "{}")

    for row in items:
        code = row["item_code"]
        if not frappe.db.exists("Item", code):
            frappe.throw(_("Item {0} not found").format(code))
        apply_hsn_to_item(code, force=True)
        frappe.db.set_value(
            "Item",
            code,
            {"is_purchase_item": 1, "disabled": 0},
            update_modified=False,
        )
        row["_is_stock"] = cint(frappe.db.get_value("Item", code, "is_stock_item"))

    # Expand lot schemes + keep line discounts before tax decoration
    items = expand_purchase_discount_lines(items)

    supplier = _ensure_smoke_supplier(company)
    warehouse = _default_warehouse(company)
    cost_center = _default_cost_center(company)

    decorated, templates_used = _decorate_invoice_items_with_itemwise_tax(company, items, direction="purchase")
    tabulated = build_tabulated_taxes_from_templates(company, templates_used)

    # 1) Purchase Order (mirrors paid + free + line discounts)
    po_items = [_line_fields_for_purchase(row, warehouse, cost_center) for row in decorated]
    po = frappe.get_doc(
        {
            "doctype": "Purchase Order",
            "supplier": supplier,
            "company": company,
            "schedule_date": nowdate(),
            "transaction_date": nowdate(),
            "items": po_items,
        }
    )
    po.insert(ignore_permissions=True)
    po.submit()

    restore_taxes = _swap_item_taxes_for_purchase([r["item_code"] for r in decorated], company)
    inv_disc = invoice_discount or {}
    try:
        decorated, templates_used = _decorate_invoice_items_with_itemwise_tax(
            company, items, direction="purchase"
        )
        tabulated = build_tabulated_taxes_from_templates(company, templates_used)

        pi_items = []
        for idx, row in enumerate(decorated):
            pi_items.append(
                _line_fields_for_purchase(
                    row,
                    warehouse,
                    cost_center,
                    po_name=po.name,
                    po_detail=po.items[idx].name,
                )
            )

        any_stock = any(r.get("_is_stock") for r in decorated)
        pi_payload = {
            "doctype": "Purchase Invoice",
            "supplier": supplier,
            "company": company,
            "posting_date": nowdate(),
            "due_date": nowdate(),
            "update_stock": 1 if any_stock else 0,
            "items": pi_items,
            "taxes": tabulated,
        }
        # Invoice-level / final discount
        inv_disc = invoice_discount or {}
        if inv_disc.get("additional_discount_percentage") or inv_disc.get("discount_amount"):
            pi_payload["apply_discount_on"] = inv_disc.get("apply_discount_on") or "Net Total"
            if inv_disc.get("additional_discount_percentage"):
                pi_payload["additional_discount_percentage"] = flt(inv_disc.get("additional_discount_percentage"))
            if inv_disc.get("discount_amount"):
                pi_payload["discount_amount"] = flt(inv_disc.get("discount_amount"))

        pi = frappe.get_doc(pi_payload)
        pi.insert(ignore_permissions=True)
        for idx, row in enumerate(decorated):
            pi.items[idx].item_tax_template = row["item_tax_template"]
            pi.items[idx].item_tax_rate = row["item_tax_rate"]
            pi.items[idx].discount_percentage = flt(row.get("discount_percentage") or 0)
            pi.items[idx].discount_amount = flt(row.get("discount_amount") or 0)
            pi.items[idx].is_free_item = cint(row.get("is_free_item") or 0)
            if cint(row.get("is_free_item")):
                pi.items[idx].discount_percentage = 100
                pi.items[idx].is_free_item = 1
        pi.set("taxes", [])
        for tax in tabulated:
            pi.append("taxes", tax)
        if inv_disc.get("additional_discount_percentage"):
            pi.additional_discount_percentage = flt(inv_disc.get("additional_discount_percentage"))
        if inv_disc.get("discount_amount"):
            pi.discount_amount = flt(inv_disc.get("discount_amount"))
        if inv_disc.get("apply_discount_on") or inv_disc.get("additional_discount_percentage") or inv_disc.get(
            "discount_amount"
        ):
            pi.apply_discount_on = inv_disc.get("apply_discount_on") or "Net Total"
        pi.calculate_taxes_and_totals()
        # Hard-zero any FOC residue ERPNext left on free lines, then retotal
        dirty = False
        for item in pi.items:
            if cint(item.is_free_item) and flt(item.amount):
                item.discount_percentage = 100
                item.rate = flt(item.price_list_rate) or flt(item.rate)
                dirty = True
        if dirty:
            pi.calculate_taxes_and_totals()
        pi.save(ignore_permissions=True)
        # Final FOC enforce at DB if validate restored amounts
        for item in pi.items:
            if cint(item.is_free_item) and flt(item.amount):
                frappe.db.set_value(
                    "Purchase Invoice Item",
                    item.name,
                    {
                        "discount_percentage": 100,
                        "amount": 0,
                        "net_amount": 0,
                        "base_amount": 0,
                        "base_net_amount": 0,
                        "is_free_item": 1,
                    },
                    update_modified=False,
                )
        pi.reload()
        pi.calculate_taxes_and_totals()
        pi.save(ignore_permissions=True)
        pi.submit()
    finally:
        _restore_item_taxes(restore_taxes)

    breakup = _serialize_invoice_tax_breakup(pi)
    return {
        "company": company,
        "supplier": supplier,
        "purchase_order": po.name,
        "purchase_invoice": pi.name,
        "templates_used": list(dict.fromkeys(templates_used)),
        "item_wise": True,
        "discounts_applied": {
            "lot_or_line": True,
            "invoice": inv_disc or {},
        },
        **breakup,
    }


def run_purchase_cycle_with_discounts_smoke():
    """
    Explicit discount smoke:
    - REAGENT 10 units @ 9:1 lot → 9 paid + 1 free
    - Pharmacy line with 10% line discount
    - Invoice-level 5% additional discount on Net Total
    """
    if not frappe.db.exists("Item", "REAGENT-CBC"):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import _ensure_reagent_item

        _ensure_reagent_item("REAGENT-CBC", "CBC Reagent Kit")
    pharma = frappe.db.get_value(
        "Item",
        {"item_group": ["in", list(PHARMACY_ITEM_GROUPS)], "disabled": 0},
        "name",
    )
    items = [
        {
            "item_code": "REAGENT-CBC",
            "qty": 10,
            "rate": 100.0,
            "lot_scheme": "9:1",
        }
    ]
    if pharma:
        items.append(
            {
                "item_code": pharma,
                "qty": 10,
                "rate": 50.0,
                "discount_percentage": 10,
            }
        )
    return run_purchase_cycle_with_gst(
        items=items,
        invoice_discount={
            "apply_discount_on": "Net Total",
            "additional_discount_percentage": 5,
        },
    )


def run_sales_invoice_with_itemwise_gst(items=None):
    """Sales Invoice with item-wise Output GST (lab 18% + pharmacy 12% by default)."""
    ensure_item_tax_fields()
    seed_hsn_rules()
    ensure_sales_gst_masters()
    company = _company_abbr()[0]
    if not company:
        frappe.throw(_("No company configured"))

    if items is None:
        lab = frappe.db.get_value(
            "Item",
            {"item_group": ["in", list(LAB_ITEM_GROUPS)], "disabled": 0, "is_sales_item": 1},
            "name",
        )
        pharma = frappe.db.get_value(
            "Item",
            {"item_group": ["in", list(PHARMACY_ITEM_GROUPS)], "disabled": 0, "is_sales_item": 1},
            "name",
        )
        items = []
        if lab:
            apply_hsn_to_item(lab, force=True)
            items.append({"item_code": lab, "qty": 2, "rate": 500.0})
        if pharma:
            apply_hsn_to_item(pharma, force=True)
            items.append({"item_code": pharma, "qty": 3, "rate": 100.0})
        if not items:
            frappe.throw(_("No sales items available for GST smoke"))

    for row in items:
        apply_hsn_to_item(row["item_code"], force=True)
        frappe.db.set_value("Item", row["item_code"], {"is_sales_item": 1, "disabled": 0}, update_modified=False)

    customer = _ensure_smoke_customer(company)
    cost_center = _default_cost_center(company)
    income = _default_income_account(company)
    decorated, templates_used = _decorate_invoice_items_with_itemwise_tax(company, items, direction="sales")
    tabulated = build_tabulated_taxes_from_templates(company, templates_used)

    si_items = []
    for row in decorated:
        line = {
            "item_code": row["item_code"],
            "qty": flt(row["qty"]),
            "rate": flt(row["rate"]),
            "cost_center": cost_center,
            "item_tax_template": row["item_tax_template"],
            "item_tax_rate": row["item_tax_rate"],
        }
        if income and not cint(frappe.db.get_value("Item", row["item_code"], "is_stock_item")):
            line["income_account"] = income
        si_items.append(line)

    si = frappe.get_doc(
        {
            "doctype": "Sales Invoice",
            "customer": customer,
            "company": company,
            "posting_date": nowdate(),
            "due_date": nowdate(),
            "items": si_items,
            "taxes": tabulated,
        }
    )
    si.insert(ignore_permissions=True)
    for idx, row in enumerate(decorated):
        si.items[idx].item_tax_template = row["item_tax_template"]
        si.items[idx].item_tax_rate = row["item_tax_rate"]
    si.set("taxes", [])
    for tax in tabulated:
        si.append("taxes", tax)
    si.calculate_taxes_and_totals()
    si.save(ignore_permissions=True)
    si.submit()

    breakup = _serialize_invoice_tax_breakup(si)
    return {
        "company": company,
        "customer": customer,
        "sales_invoice": si.name,
        "templates_used": list(dict.fromkeys(templates_used)),
        "item_wise": True,
        **breakup,
    }


def seed_hsn_rules():
    ensure_phase67_doctypes()
    templates = ensure_item_tax_templates()
    for key, hsn, cat, rate, label, groups in HSN_SEED_RULES:
        tmpl = templates.get(f"{rate}_InState") or templates.get(f"{int(rate)}_InState")
        if tmpl and not frappe.db.exists("Item Tax Template", tmpl):
            tmpl = None
        vals = {
            "label": label,
            "hsn_sac": hsn,
            "tax_category": cat,
            "gst_rate": rate,
            "item_groups": ", ".join(groups),
            "match_reagent": 1 if key == "reagents" else 0,
            "is_fallback": 1 if key.startswith("fallback") else 0,
            "active": 1,
        }
        if tmpl:
            vals["item_tax_template"] = tmpl
        if frappe.db.exists("HEC HSN Rule", key):
            doc = frappe.get_doc("HEC HSN Rule", key)
            doc.update(vals)
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc({"doctype": "HEC HSN Rule", "rule_key": key, **vals}).insert(ignore_permissions=True)
    return frappe.db.count("HEC HSN Rule", {"active": 1})


def _classify_item(item_code, item_group=None, item_name=None, is_stock_item=None):
    if not item_group or item_name is None or is_stock_item is None:
        row = frappe.db.get_value(
            "Item",
            item_code,
            ["item_group", "item_name", "is_stock_item"],
            as_dict=True,
        ) or {}
        item_group = item_group or row.get("item_group")
        item_name = item_name if item_name is not None else row.get("item_name")
        is_stock_item = is_stock_item if is_stock_item is not None else row.get("is_stock_item")

    if _is_reagent_or_excluded_item(item_code, item_group, item_name):
        return "reagents"
    if (item_group or "") in LAB_ITEM_GROUPS:
        return "lab_tests"
    if (item_group or "") in WELLNESS_ITEM_GROUPS:
        return "wellness"
    if (item_group or "") in PHARMACY_ITEM_GROUPS:
        return "pharmacy"
    if cint(is_stock_item):
        return "fallback_goods"
    return "fallback_service"


def resolve_hsn_for_item(item_code):
    key = _classify_item(item_code)
    rule = frappe.db.get_value(
        "HEC HSN Rule",
        {"rule_key": key, "active": 1},
        ["hsn_sac", "gst_rate", "tax_category", "item_tax_template", "rule_key"],
        as_dict=True,
    )
    if not rule:
        rule = frappe.db.get_value(
            "HEC HSN Rule",
            {"is_fallback": 1, "active": 1, "tax_category": "Goods" if key == "fallback_goods" else "Service"},
            ["hsn_sac", "gst_rate", "tax_category", "item_tax_template", "rule_key"],
            as_dict=True,
        )
    return rule or {"hsn_sac": "999799", "gst_rate": 18, "tax_category": "Service", "rule_key": "fallback"}


def apply_hsn_to_item(item_code, force=False):
    rule = resolve_hsn_for_item(item_code)
    if not rule:
        return None
    updates = {}
    meta = frappe.get_meta("Item")
    current = frappe.db.get_value(
        "Item",
        item_code,
        ["hec_hsn_sac", "hec_gst_rate", "hec_tax_category"]
        + (["gst_hsn_code"] if meta.has_field("gst_hsn_code") else []),
        as_dict=True,
    ) or {}
    if force or not current.get("hec_hsn_sac"):
        updates["hec_hsn_sac"] = rule["hsn_sac"]
    if force or not flt(current.get("hec_gst_rate")):
        updates["hec_gst_rate"] = flt(rule["gst_rate"])
    if force or not current.get("hec_tax_category"):
        updates["hec_tax_category"] = rule["tax_category"]
    if meta.has_field("gst_hsn_code") and (force or not current.get("gst_hsn_code")):
        updates["gst_hsn_code"] = rule["hsn_sac"]
    if updates:
        frappe.db.set_value("Item", item_code, updates, update_modified=False)
    return {**rule, "item_code": item_code, "applied": updates}


def seed_hsn_on_items(limit=5000, force=False):
    seed_hsn_rules()
    items = frappe.get_all(
        "Item",
        filters={"disabled": 0},
        fields=["name", "item_group", "item_name", "is_stock_item"],
        limit=limit,
    )
    counts = {}
    for row in items:
        key = _classify_item(row.name, row.item_group, row.item_name, row.is_stock_item)
        apply_hsn_to_item(row.name, force=force)
        counts[key] = counts.get(key, 0) + 1
    return {"items": len(items), "by_class": counts}


def _period_dates(year, month):
    month = cint(month)
    year = cint(year)
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def _fiscal_year_label(d):
    d = getdate(d)
    if d.month >= 4:
        return f"{d.year}-{str(d.year + 1)[2:]}"
    return f"{d.year - 1}-{str(d.year)[2:]}"


def get_or_create_gst_period(period_month=None, period_year=None, company=None):
    ensure_phase67_doctypes()
    company = company or _company_abbr()[0]
    if not company:
        frappe.throw(_("No company configured"))
    today = getdate(nowdate())
    period_month = cint(period_month) or today.month
    period_year = cint(period_year) or today.year
    from_date, to_date = _period_dates(period_year, period_month)
    label = f"{from_date.strftime('%b %Y')}"
    existing = frappe.db.get_value(
        "GST Return Period",
        {"company": company, "period_month": period_month, "period_year": period_year},
        "name",
    )
    if existing:
        return frappe.get_doc("GST Return Period", existing)
    doc = frappe.get_doc(
        {
            "doctype": "GST Return Period",
            "company": company,
            "period_month": period_month,
            "period_year": period_year,
            "period_label": label,
            "fiscal_year": _fiscal_year_label(from_date),
            "from_date": from_date,
            "to_date": to_date,
            "status": "Draft",
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


def _invoice_tax_split(doc):
    taxable = flt(doc.base_net_total or doc.net_total)
    cgst = sgst = igst = 0.0
    for t in doc.get("taxes") or []:
        desc = (t.get("description") or t.get("account_head") or "").upper()
        amt = flt(t.get("base_tax_amount_after_discount_amount") or t.get("tax_amount"))
        if "IGST" in desc:
            igst += amt
        elif "CGST" in desc:
            cgst += amt
        elif "SGST" in desc or "UTGST" in desc:
            sgst += amt
    if not (cgst or sgst or igst) and taxable:
        # Estimate from item HSN rates when taxes not posted
        rate = 18.0
        first_item = (doc.get("items") or [None])[0]
        if first_item and first_item.get("item_code"):
            rate = flt(frappe.db.get_value("Item", first_item.item_code, "hec_gst_rate") or 18)
        half = taxable * rate / 100.0 / 2.0
        cgst = half
        sgst = half
    return taxable, cgst, sgst, igst


def _line_hsn_from_invoice(doc):
    for row in doc.get("items") or []:
        if not row.get("item_code"):
            continue
        hsn = frappe.db.get_value("Item", row.item_code, "hec_hsn_sac")
        if hsn:
            return hsn
        rule = resolve_hsn_for_item(row.item_code)
        return rule.get("hsn_sac")
    return ""


def generate_gstr1(period_name):
    doc = frappe.get_doc("GST Return Period", period_name)
    # clear existing GSTR-1 lines
    doc.lines = [l for l in (doc.lines or []) if l.form_type != "GSTR-1"]
    invoices = frappe.get_all(
        "Sales Invoice",
        filters={
            "docstatus": 1,
            "company": doc.company,
            "posting_date": ["between", [doc.from_date, doc.to_date]],
        },
        pluck="name",
    )
    taxable_sum = tax_sum = 0.0
    for name in invoices:
        inv = frappe.get_doc("Sales Invoice", name)
        taxable, cgst, sgst, igst = _invoice_tax_split(inv)
        taxable_sum += taxable
        tax_sum += cgst + sgst + igst
        party_gstin = ""
        if inv.customer and frappe.get_meta("Customer").has_field("gstin"):
            party_gstin = frappe.db.get_value("Customer", inv.customer, "gstin") or ""
        doc.append(
            "lines",
            {
                "form_type": "GSTR-1",
                "invoice": inv.name,
                "invoice_date": inv.posting_date,
                "party": inv.customer,
                "party_gstin": party_gstin,
                "place_of_supply": getattr(inv, "place_of_supply", None) or "",
                "hsn_sac": _line_hsn_from_invoice(inv),
                "taxable_value": taxable,
                "cgst_amount": cgst,
                "sgst_amount": sgst,
                "igst_amount": igst,
                "reverse_charge": cint(getattr(inv, "is_reverse_charge", 0)),
            },
        )
    doc.gstr1_taxable = taxable_sum
    doc.gstr1_tax = tax_sum
    if doc.status == "Draft":
        doc.status = "Generated"
    doc.save(ignore_permissions=True)
    return {"period": doc.name, "invoices": len(invoices), "taxable": taxable_sum, "tax": tax_sum}


def generate_gstr2(period_name):
    doc = frappe.get_doc("GST Return Period", period_name)
    doc.lines = [l for l in (doc.lines or []) if l.form_type != "GSTR-2"]
    invoices = frappe.get_all(
        "Purchase Invoice",
        filters={
            "docstatus": 1,
            "company": doc.company,
            "posting_date": ["between", [doc.from_date, doc.to_date]],
        },
        pluck="name",
    )
    taxable_sum = tax_sum = 0.0
    for name in invoices:
        inv = frappe.get_doc("Purchase Invoice", name)
        taxable, cgst, sgst, igst = _invoice_tax_split(inv)
        taxable_sum += taxable
        tax_sum += cgst + sgst + igst
        party_gstin = ""
        if inv.supplier and frappe.get_meta("Supplier").has_field("gstin"):
            party_gstin = frappe.db.get_value("Supplier", inv.supplier, "gstin") or ""
        doc.append(
            "lines",
            {
                "form_type": "GSTR-2",
                "invoice": inv.name,
                "invoice_date": inv.posting_date,
                "party": inv.supplier,
                "party_gstin": party_gstin,
                "place_of_supply": getattr(inv, "place_of_supply", None) or "",
                "hsn_sac": _line_hsn_from_invoice(inv),
                "taxable_value": taxable,
                "cgst_amount": cgst,
                "sgst_amount": sgst,
                "igst_amount": igst,
                "reverse_charge": cint(getattr(inv, "is_reverse_charge", 0)),
            },
        )
    doc.gstr2_taxable = taxable_sum
    doc.gstr2_tax = tax_sum
    if doc.status == "Draft":
        doc.status = "Generated"
    doc.save(ignore_permissions=True)
    return {"period": doc.name, "invoices": len(invoices), "taxable": taxable_sum, "tax": tax_sum}


def generate_gstr3b(period_name):
    doc = frappe.get_doc("GST Return Period", period_name)
    if not any(l.form_type == "GSTR-1" for l in (doc.lines or [])):
        generate_gstr1(period_name)
        doc.reload()
    if not any(l.form_type == "GSTR-2" for l in (doc.lines or [])):
        generate_gstr2(period_name)
        doc.reload()

    out_taxable = flt(doc.gstr1_taxable)
    out_cgst = sum(flt(l.cgst_amount) for l in doc.lines if l.form_type == "GSTR-1")
    out_sgst = sum(flt(l.sgst_amount) for l in doc.lines if l.form_type == "GSTR-1")
    out_igst = sum(flt(l.igst_amount) for l in doc.lines if l.form_type == "GSTR-1")
    in_taxable = flt(doc.gstr2_taxable)
    in_cgst = sum(flt(l.cgst_amount) for l in doc.lines if l.form_type == "GSTR-2")
    in_sgst = sum(flt(l.sgst_amount) for l in doc.lines if l.form_type == "GSTR-2")
    in_igst = sum(flt(l.igst_amount) for l in doc.lines if l.form_type == "GSTR-2")
    rcm = [
        {
            "invoice": l.invoice,
            "taxable": flt(l.taxable_value),
            "tax": flt(l.cgst_amount) + flt(l.sgst_amount) + flt(l.igst_amount),
        }
        for l in doc.lines
        if l.form_type in ("GSTR-1", "GSTR-2") and cint(l.reverse_charge)
    ]
    summary = {
        "period": doc.period_label,
        "outward": {
            "taxable": out_taxable,
            "cgst": out_cgst,
            "sgst": out_sgst,
            "igst": out_igst,
            "total_tax": out_cgst + out_sgst + out_igst,
        },
        "inward_itc": {
            "taxable": in_taxable,
            "cgst": in_cgst,
            "sgst": in_sgst,
            "igst": in_igst,
            "total_tax": in_cgst + in_sgst + in_igst,
        },
        "net_payable": {
            "cgst": max(0, out_cgst - in_cgst),
            "sgst": max(0, out_sgst - in_sgst),
            "igst": max(0, out_igst - in_igst),
        },
        "reverse_charge": rcm,
    }
    # Replace 3B lines with one summary row
    doc.lines = [l for l in (doc.lines or []) if l.form_type != "GSTR-3B"]
    doc.append(
        "lines",
        {
            "form_type": "GSTR-3B",
            "invoice": "SUMMARY",
            "taxable_value": out_taxable,
            "cgst_amount": summary["net_payable"]["cgst"],
            "sgst_amount": summary["net_payable"]["sgst"],
            "igst_amount": summary["net_payable"]["igst"],
            "notes": "Auto-generated 3B net payable",
        },
    )
    doc.gstr3b_json = json.dumps(summary, default=str)
    if doc.status in ("Draft", "Generated"):
        doc.status = "Generated"
    doc.save(ignore_permissions=True)
    return summary


def export_gstr_json(period_name, form="GSTR-1"):
    doc = frappe.get_doc("GST Return Period", period_name)
    form = (form or "GSTR-1").upper()
    if form == "GSTR-3B":
        return json.loads(doc.gstr3b_json or "{}") or generate_gstr3b(period_name)
    lines = [l for l in (doc.lines or []) if l.form_type == form]
    return {
        "form": form,
        "period": doc.period_label,
        "company": doc.company,
        "from_date": str(doc.from_date),
        "to_date": str(doc.to_date),
        "count": len(lines),
        "rows": [
            {
                "invoice": l.invoice,
                "invoice_date": str(l.invoice_date) if l.invoice_date else None,
                "party": l.party,
                "party_gstin": l.party_gstin,
                "place_of_supply": l.place_of_supply,
                "hsn_sac": l.hsn_sac,
                "taxable_value": flt(l.taxable_value),
                "cgst": flt(l.cgst_amount),
                "sgst": flt(l.sgst_amount),
                "igst": flt(l.igst_amount),
                "reverse_charge": cint(l.reverse_charge),
            }
            for l in lines
        ],
    }


def export_gstr_csv(period_name, form="GSTR-1"):
    data = export_gstr_json(period_name, form=form)
    if form.upper() == "GSTR-3B":
        return json.dumps(data, indent=2)
    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=[
            "invoice",
            "invoice_date",
            "party",
            "party_gstin",
            "place_of_supply",
            "hsn_sac",
            "taxable_value",
            "cgst",
            "sgst",
            "igst",
            "reverse_charge",
        ],
    )
    writer.writeheader()
    for row in data.get("rows") or []:
        writer.writerow(row)
    return buf.getvalue()


def reconcile_gst_period(period_name, upload_rows=None):
    """Match purchase books (GSTR-2 lines) vs uploaded 2B rows."""
    doc = frappe.get_doc("GST Return Period", period_name)
    if not any(l.form_type == "GSTR-2" for l in (doc.lines or [])):
        generate_gstr2(period_name)
        doc.reload()

    if isinstance(upload_rows, str):
        try:
            upload_rows = json.loads(upload_rows)
        except Exception:
            # CSV: invoice_no,supplier_gstin,taxable_value,tax_amount
            reader = csv.DictReader(io.StringIO(upload_rows))
            upload_rows = list(reader)

    upload_rows = upload_rows or []
    # Clear prior recon entries for period
    for name in frappe.get_all("GST Reconciliation Entry", filters={"gst_return_period": period_name}, pluck="name"):
        frappe.delete_doc("GST Reconciliation Entry", name, ignore_permissions=True, force=True)

    books = {
        ((l.invoice or "").strip().upper(), (l.party_gstin or "").strip().upper()): l
        for l in doc.lines
        if l.form_type == "GSTR-2"
    }
    matched_keys = set()
    results = []

    for raw in upload_rows:
        inv = (raw.get("invoice_no") or raw.get("invoice") or "").strip()
        gstin = (raw.get("supplier_gstin") or raw.get("gstin") or "").strip()
        key = (inv.upper(), gstin.upper())
        taxable = flt(raw.get("taxable_value") or raw.get("taxable"))
        tax = flt(raw.get("tax_amount") or raw.get("tax"))
        book = books.get(key)
        if not book and inv:
            # fallback match on invoice only
            for bk, bl in books.items():
                if bk[0] == inv.upper():
                    book = bl
                    key = bk
                    break
        status = "Missing in Books"
        variance = taxable
        books_invoice = None
        if book:
            matched_keys.add(key)
            books_invoice = book.invoice
            book_tax = flt(book.cgst_amount) + flt(book.sgst_amount) + flt(book.igst_amount)
            variance = abs(taxable - flt(book.taxable_value)) + abs(tax - book_tax)
            status = "Matched" if variance < 1.0 else "Mismatch"
            book.match_status = status
        entry = frappe.get_doc(
            {
                "doctype": "GST Reconciliation Entry",
                "gst_return_period": period_name,
                "source": "GSTR-2B Upload",
                "invoice_no": inv,
                "supplier_gstin": gstin,
                "invoice_date": raw.get("invoice_date"),
                "taxable_value": taxable,
                "tax_amount": tax,
                "match_status": status,
                "books_invoice": books_invoice,
                "variance_amount": variance,
                "raw_payload": json.dumps(raw, default=str),
            }
        )
        entry.insert(ignore_permissions=True)
        results.append({"invoice_no": inv, "status": status, "variance": variance})

    for key, book in books.items():
        if key in matched_keys:
            continue
        if upload_rows:
            book.match_status = "Missing in 2B"
            entry = frappe.get_doc(
                {
                    "doctype": "GST Reconciliation Entry",
                    "gst_return_period": period_name,
                    "source": "GSTR-2B Upload",
                    "invoice_no": book.invoice,
                    "supplier_gstin": book.party_gstin,
                    "invoice_date": book.invoice_date,
                    "taxable_value": book.taxable_value,
                    "tax_amount": flt(book.cgst_amount) + flt(book.sgst_amount) + flt(book.igst_amount),
                    "match_status": "Missing in 2B",
                    "books_invoice": book.invoice,
                    "variance_amount": flt(book.taxable_value),
                }
            )
            entry.insert(ignore_permissions=True)
            results.append({"invoice_no": book.invoice, "status": "Missing in 2B"})

    doc.status = "Reconciled" if upload_rows else doc.status
    doc.save(ignore_permissions=True)
    return {
        "period": period_name,
        "uploaded": len(upload_rows),
        "results": results,
        "summary": {
            "matched": sum(1 for r in results if r["status"] == "Matched"),
            "mismatch": sum(1 for r in results if r["status"] == "Mismatch"),
            "missing_in_books": sum(1 for r in results if r["status"] == "Missing in Books"),
            "missing_in_2b": sum(1 for r in results if r["status"] == "Missing in 2B"),
        },
    }


def seed_mca_calendar(year=None):
    ensure_phase67_doctypes()
    year = cint(year) or getdate(nowdate()).year
    # Typical India due dates (illustrative defaults)
    defaults = [
        ("AOC-4", date(year, 10, 29), f"FY {year - 1}-{str(year)[2:]}"),
        ("MGT-7", date(year, 11, 28), f"FY {year - 1}-{str(year)[2:]}"),
        ("DIR-3 KYC", date(year, 9, 30), str(year)),
        ("MSME-1", date(year, 4, 30), f"H2 {year - 1}"),
        ("MSME-1", date(year, 10, 31), f"H1 {year}"),
        ("ADT-1", date(year, 10, 14), f"FY {year - 1}-{str(year)[2:]}"),
    ]
    created = 0
    for filing_type, due, period_label in defaults:
        exists = frappe.db.exists(
            "MCA Filing Calendar",
            {"filing_type": filing_type, "due_date": due, "period_label": period_label},
        )
        if exists:
            continue
        desc = dict(MCA_FILING_TYPES).get(filing_type, filing_type)
        status = "Overdue" if due < getdate(nowdate()) else "Upcoming"
        frappe.get_doc(
            {
                "doctype": "MCA Filing Calendar",
                "filing_type": filing_type,
                "description": desc,
                "due_date": due,
                "period_label": period_label,
                "status": status,
            }
        ).insert(ignore_permissions=True)
        created += 1
    return created


def ensure_mca_profile():
    ensure_phase67_doctypes()
    company, _ = _company_abbr()
    doc = frappe.get_single("MCA Company Profile")
    if not doc.company_name and company:
        doc.company_name = company
        if frappe.get_meta("Company").has_field("tax_id"):
            doc.pan = frappe.db.get_value("Company", company, "tax_id") or doc.pan
        doc.save(ignore_permissions=True)
    return doc.as_dict()


def get_mca_dashboard():
    ensure_mca_profile()
    profile = frappe.get_single("MCA Company Profile").as_dict()
    directors = frappe.get_all(
        "MCA Director Register",
        filters={"active": 1},
        fields=["name", "din", "full_name", "designation", "appointment_date", "email"],
    )
    today = getdate(nowdate())
    filings = frappe.get_all(
        "MCA Filing Calendar",
        fields=["name", "filing_type", "description", "due_date", "period_label", "status", "filed_on"],
        order_by="due_date asc",
        limit=50,
    )
    due_soon = []
    for f in filings:
        due = getdate(f.due_date)
        days = (due - today).days
        f["days_to_due"] = days
        if f.status in ("Upcoming", "In Progress", "Overdue") and days <= 30:
            due_soon.append(f)
    return {
        "profile": profile,
        "directors": directors,
        "filings": filings,
        "due_soon": due_soon,
        "counts": {
            "directors": len(directors),
            "upcoming": sum(1 for f in filings if f.status == "Upcoming"),
            "overdue": sum(1 for f in filings if f.status == "Overdue" or (f.get("days_to_due") or 0) < 0 and f.status != "Filed"),
        },
    }


def upsert_mca_filing(filing_type, due_date, status=None, period_label=None, attachment_url=None, remarks=None, name=None):
    ensure_phase67_doctypes()
    if name and frappe.db.exists("MCA Filing Calendar", name):
        doc = frappe.get_doc("MCA Filing Calendar", name)
    else:
        doc = frappe.get_doc({"doctype": "MCA Filing Calendar"})
    doc.filing_type = filing_type or doc.filing_type
    doc.due_date = due_date or doc.due_date
    if status:
        doc.status = status
    if period_label is not None:
        doc.period_label = period_label
    if attachment_url is not None:
        doc.attachment_url = attachment_url
    if remarks is not None:
        doc.remarks = remarks
    doc.description = doc.description or dict(MCA_FILING_TYPES).get(doc.filing_type, doc.filing_type)
    if doc.status == "Filed" and not doc.filed_on:
        doc.filed_on = nowdate()
    if doc.name:
        doc.save(ignore_permissions=True)
    else:
        doc.insert(ignore_permissions=True)
    return doc.as_dict()


def setup_phase67():
    ensure_phase67_doctypes()
    ensure_item_tax_fields()
    rules = seed_hsn_rules()
    seeded = seed_hsn_on_items(force=False)
    purchase_gst = ensure_purchase_gst_masters()
    sales_gst = ensure_sales_gst_masters()
    ensure_mca_profile()
    mca = seed_mca_calendar()
    frappe.db.commit()
    return {
        "ok": True,
        "phase": 67,
        "hsn_rules": rules,
        "items_seeded": seeded,
        "mca_filings_created": mca,
        "tax_templates": ensure_item_tax_templates(),
        "input_item_tax_templates": ensure_input_item_tax_templates(),
        "purchase_gst": purchase_gst,
        "sales_gst": sales_gst,
    }


def smoke_phase67():
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase67()
    check("setup", setup.get("ok"))
    check("hsn_rules", cint(setup.get("hsn_rules")) >= 4, str(setup.get("hsn_rules")))
    check(
        "purchase_tax_template",
        bool((setup.get("purchase_gst") or {}).get("templates")),
        str((setup.get("purchase_gst") or {}).get("templates")),
    )
    check(
        "input_item_tax_templates",
        bool(setup.get("input_item_tax_templates")),
        str(setup.get("input_item_tax_templates")),
    )

    if not frappe.db.exists("Item", "REAGENT-CBC"):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import _ensure_reagent_item

        _ensure_reagent_item("REAGENT-CBC", "CBC Reagent Kit")
    lab_item = frappe.db.get_value("Item", {"item_group": ["in", LAB_ITEM_GROUPS], "disabled": 0}, "name")
    if not lab_item:
        if not frappe.db.exists("Item Group", "Lab Tests"):
            frappe.get_doc(
                {"doctype": "Item Group", "item_group_name": "Lab Tests", "parent_item_group": "All Item Groups"}
            ).insert(ignore_permissions=True)
        frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": "HEC-SMOKE-CBC",
                "item_name": "Smoke CBC",
                "item_group": "Lab Tests",
                "stock_uom": "Nos",
                "is_stock_item": 0,
                "is_sales_item": 1,
            }
        ).insert(ignore_permissions=True)
        lab_item = "HEC-SMOKE-CBC"

    apply_hsn_to_item("REAGENT-CBC", force=True)
    apply_hsn_to_item(lab_item, force=True)
    sync_item_master_taxes("REAGENT-CBC")
    sync_item_master_taxes(lab_item)
    reag_hsn = frappe.db.get_value("Item", "REAGENT-CBC", "hec_hsn_sac")
    lab_hsn = frappe.db.get_value("Item", lab_item, "hec_hsn_sac")
    check("reagent_hsn_3822", str(reag_hsn).startswith("3822"), str(reag_hsn))
    check("lab_sac_999312", str(lab_hsn) == "999312", f"{lab_item}={lab_hsn}")

    # --- Item-wise purchase cycle (18% + 12%) ---
    try:
        cycle = run_purchase_cycle_with_gst()
        frappe.db.commit()
    except Exception as exc:
        cycle = {"error": str(exc)}
        frappe.db.rollback()
        frappe.log_error(title="phase67_purchase_cycle", message=frappe.get_traceback())

    check("purchase_cycle_ok", "purchase_invoice" in cycle, str(cycle.get("error") or cycle.get("purchase_invoice")))
    lines = cycle.get("lines") or []
    templates = {l.get("item_tax_template") for l in lines if l.get("item_tax_template")}
    check(
        "pinv_itemwise_templates",
        len(lines) >= 2
        and len(templates) >= 2
        and all("Input" in (l.get("item_tax_template") or "") for l in lines),
        json.dumps({"lines": lines, "templates": list(templates)}, default=str),
    )
    check(
        "pinv_has_gst_bills",
        flt(cycle.get("total_tax")) > 0 and len(cycle.get("tax_rows") or []) >= 2,
        json.dumps({"total_tax": cycle.get("total_tax"), "tax_rows": cycle.get("tax_rows")}, default=str),
    )
    # Expected = sum of per-line GST; allow ₹1 rounding
    check(
        "pinv_tax_matches_itemwise_sum",
        abs(flt(cycle.get("total_tax")) - flt(cycle.get("expected_total_tax"))) < 1.5,
        f"total={cycle.get('total_tax')} expected={cycle.get('expected_total_tax')}",
    )
    rates = sorted({flt(l.get("gst_rate")) for l in lines})
    check("pinv_multi_gst_rates", 12.0 in rates and 18.0 in rates, str(rates))

    # --- Purchase discounts: lot 9:1 + line % + invoice % ---
    try:
        disc = run_purchase_cycle_with_discounts_smoke()
        frappe.db.commit()
    except Exception as exc:
        disc = {"error": str(exc)}
        frappe.db.rollback()
        frappe.log_error(title="phase67_purchase_discounts", message=frappe.get_traceback())

    check("discount_cycle_ok", "purchase_invoice" in disc, str(disc.get("error") or disc.get("purchase_invoice")))
    d_lines = disc.get("lines") or []
    check(
        "lot_scheme_free_line",
        flt(disc.get("free_qty_total")) >= 1
        and any(l.get("is_free_item") and l.get("item_code") == "REAGENT-CBC" for l in d_lines),
        json.dumps(
            {
                "free_qty_total": disc.get("free_qty_total"),
                "paid_qty_total": disc.get("paid_qty_total"),
                "lines": [
                    {
                        "item_code": l.get("item_code"),
                        "qty": l.get("qty"),
                        "is_free_item": l.get("is_free_item"),
                        "net_amount": l.get("net_amount"),
                        "discount_percentage": l.get("discount_percentage"),
                    }
                    for l in d_lines
                ],
            },
            default=str,
        ),
    )
    check(
        "line_discount_applied",
        any(flt(l.get("discount_percentage")) >= 10 for l in d_lines if not l.get("is_free_item")),
        json.dumps([{"item": l.get("item_code"), "disc%": l.get("discount_percentage")} for l in d_lines], default=str),
    )
    check(
        "invoice_discount_applied",
        flt(disc.get("additional_discount_percentage")) >= 5 or flt(disc.get("discount_amount")) > 0,
        json.dumps(
            {
                "additional_discount_percentage": disc.get("additional_discount_percentage"),
                "discount_amount": disc.get("discount_amount"),
                "apply_discount_on": disc.get("apply_discount_on"),
                "net_total": disc.get("net_total"),
                "grand_total": disc.get("grand_total"),
            },
            default=str,
        ),
    )
    # Lot 9:1 on 10 units @100 → paid amount 900, free amount 0 (FOC rate 0)
    reagent_paid_amt = sum(
        flt(l.get("amount"))
        for l in d_lines
        if l.get("item_code") == "REAGENT-CBC" and not l.get("is_free_item")
    )
    reagent_free_amt = sum(
        flt(l.get("amount"))
        for l in d_lines
        if l.get("item_code") == "REAGENT-CBC" and l.get("is_free_item")
    )
    reagent_paid_qty = sum(
        flt(l.get("qty"))
        for l in d_lines
        if l.get("item_code") == "REAGENT-CBC" and not l.get("is_free_item")
    )
    reagent_free_qty = sum(
        flt(l.get("qty"))
        for l in d_lines
        if l.get("item_code") == "REAGENT-CBC" and l.get("is_free_item")
    )
    check(
        "lot_paid_vs_free_amounts",
        abs(reagent_paid_amt - 900.0) < 1.0
        and reagent_free_amt < 1.0
        and abs(reagent_paid_qty - 9.0) < 0.1
        and abs(reagent_free_qty - 1.0) < 0.1,
        f"paid_amt={reagent_paid_amt} free_amt={reagent_free_amt} paid_qty={reagent_paid_qty} free_qty={reagent_free_qty}",
    )

    # --- Item-wise sales invoice ---
    try:
        sales = run_sales_invoice_with_itemwise_gst()
        frappe.db.commit()
    except Exception as exc:
        sales = {"error": str(exc)}
        frappe.db.rollback()
        frappe.log_error(title="phase67_sales_itemwise", message=frappe.get_traceback())

    check("sales_cycle_ok", "sales_invoice" in sales, str(sales.get("error") or sales.get("sales_invoice")))
    s_lines = sales.get("lines") or []
    s_tmpls = {l.get("item_tax_template") for l in s_lines if l.get("item_tax_template")}
    check(
        "sinv_itemwise_templates",
        len(s_lines) >= 1 and len(s_tmpls) >= 1,
        json.dumps({"lines": s_lines, "templates": list(s_tmpls)}, default=str),
    )
    check(
        "sinv_has_gst_bills",
        flt(sales.get("total_tax")) > 0 and len(sales.get("tax_rows") or []) >= 1,
        json.dumps({"total_tax": sales.get("total_tax"), "tax_rows": sales.get("tax_rows")}, default=str),
    )
    check(
        "sinv_tax_matches_itemwise_sum",
        abs(flt(sales.get("total_tax")) - flt(sales.get("expected_total_tax"))) < 1.5
        if sales.get("sales_invoice")
        else False,
        f"total={sales.get('total_tax')} expected={sales.get('expected_total_tax')}",
    )

    period = get_or_create_gst_period()
    g1 = generate_gstr1(period.name)
    g2 = generate_gstr2(period.name)
    g3 = generate_gstr3b(period.name)
    check("gstr1", "period" in g1)
    check("gstr2", "period" in g2)
    check("gstr3b", "outward" in g3)
    if cycle.get("purchase_invoice"):
        g2_invoices = {
            l.invoice
            for l in frappe.get_doc("GST Return Period", period.name).lines
            if l.form_type == "GSTR-2"
        }
        check(
            "gstr2_includes_pinv",
            cycle["purchase_invoice"] in g2_invoices,
            f"pinv={cycle.get('purchase_invoice')} lines={len(g2_invoices)}",
        )
        line = next(
            (
                l
                for l in frappe.get_doc("GST Return Period", period.name).lines
                if l.form_type == "GSTR-2" and l.invoice == cycle["purchase_invoice"]
            ),
            None,
        )
        line_tax = (
            flt(getattr(line, "cgst_amount", 0))
            + flt(getattr(line, "sgst_amount", 0))
            + flt(getattr(line, "igst_amount", 0))
            if line
            else 0
        )
        check("gstr2_pinv_tax", line_tax > 0, f"line_tax={line_tax}")

    exported = export_gstr_json(period.name, "GSTR-1")
    check("export_gstr1", exported.get("form") == "GSTR-1")
    recon = reconcile_gst_period(period.name, upload_rows=[])
    check("reconcile", "summary" in recon)

    dash = get_mca_dashboard()
    check("mca_dashboard", "profile" in dash and "filings" in dash)
    check(
        "doctypes",
        frappe.db.exists("DocType", "GST Return Period") and frappe.db.exists("DocType", "MCA Filing Calendar"),
    )
    result["purchase_cycle"] = {
        k: cycle.get(k)
        for k in (
            "purchase_order",
            "purchase_invoice",
            "templates_used",
            "total_tax",
            "expected_total_tax",
            "net_total",
            "grand_total",
            "lines",
            "tax_rows",
        )
        if k in cycle
    }
    result["discount_cycle"] = {
        k: disc.get(k)
        for k in (
            "purchase_order",
            "purchase_invoice",
            "free_qty_total",
            "paid_qty_total",
            "additional_discount_percentage",
            "discount_amount",
            "net_total",
            "grand_total",
            "total_tax",
            "lines",
        )
        if k in disc
    }
    result["sales_cycle"] = {
        k: sales.get(k)
        for k in (
            "sales_invoice",
            "templates_used",
            "total_tax",
            "expected_total_tax",
            "net_total",
            "grand_total",
            "lines",
            "tax_rows",
        )
        if k in sales
    }
    return result


# ---------------------------------------------------------------------------
# Whitelisted API wrappers
# ---------------------------------------------------------------------------


@frappe.whitelist()
def api_seed_hsn(force=0):
    _require_accounts()
    return _success(seed_hsn_on_items(force=cint(force)))


@frappe.whitelist()
def api_get_or_create_gst_period(period_month=None, period_year=None):
    _require_accounts()
    period_month = _parse_request_value("period_month", period_month)
    period_year = _parse_request_value("period_year", period_year)
    doc = get_or_create_gst_period(period_month, period_year)
    return _success({"name": doc.name, "period_label": doc.period_label, "status": doc.status})


@frappe.whitelist()
def api_generate_gstr1(period=None):
    _require_accounts()
    period = _parse_request_value("period", period)
    return _success(generate_gstr1(period))


@frappe.whitelist()
def api_generate_gstr2(period=None):
    _require_accounts()
    period = _parse_request_value("period", period)
    return _success(generate_gstr2(period))


@frappe.whitelist()
def api_generate_gstr3b(period=None):
    _require_accounts()
    period = _parse_request_value("period", period)
    return _success(generate_gstr3b(period))


@frappe.whitelist()
def api_export_gstr(period=None, form="GSTR-1", as_csv=0):
    _require_accounts()
    period = _parse_request_value("period", period)
    form = _parse_request_value("form", form) or "GSTR-1"
    if cint(as_csv) or cint(_parse_request_value("as_csv", as_csv)):
        return _success({"csv": export_gstr_csv(period, form)})
    return _success(export_gstr_json(period, form))


@frappe.whitelist()
def api_reconcile_gst(period=None, upload_rows=None):
    _require_accounts()
    period = _parse_request_value("period", period)
    upload_rows = _parse_request_value("upload_rows", upload_rows)
    return _success(reconcile_gst_period(period, upload_rows=upload_rows))


@frappe.whitelist()
def api_mca_dashboard():
    _require_accounts()
    return _success(get_mca_dashboard())


@frappe.whitelist()
def api_upsert_mca_filing(body=None):
    _require_accounts()
    body = _parse_request_value("body", body) or {}
    if isinstance(body, str):
        body = json.loads(body or "{}")
    return _success(
        upsert_mca_filing(
            body.get("filing_type"),
            body.get("due_date"),
            status=body.get("status"),
            period_label=body.get("period_label"),
            attachment_url=body.get("attachment_url"),
            remarks=body.get("remarks"),
            name=body.get("name"),
        )
    )


@frappe.whitelist()
def api_run_purchase_cycle_gst(qty=10, rate=100, item_code=None, body=None):
    """
    Staff API: PO → PINV with item-wise GST + discounts.
    body may include:
      items: [{item_code, qty, rate, lot_scheme, discount_percentage, discount_amount}]
      invoice_discount: {apply_discount_on, additional_discount_percentage, discount_amount}
    """
    _require_accounts()
    body = _parse_request_value("body", body)
    if isinstance(body, str):
        body = json.loads(body or "{}")
    body = body or {}
    qty = flt(_parse_request_value("qty", qty) or body.get("qty") or 10)
    rate = flt(_parse_request_value("rate", rate) or body.get("rate") or 100)
    item_code = _parse_request_value("item_code", item_code) or body.get("item_code")
    items = body.get("items")
    invoice_discount = body.get("invoice_discount")
    try:
        if items or invoice_discount:
            out = run_purchase_cycle_with_gst(items=items, invoice_discount=invoice_discount)
        elif item_code:
            out = run_purchase_cycle_with_gst(qty=qty, rate=rate, item_code=item_code)
        else:
            out = run_purchase_cycle_with_gst()
        frappe.db.commit()
        return _success(out)
    except Exception as exc:
        frappe.db.rollback()
        frappe.log_error(title="api_run_purchase_cycle_gst", message=frappe.get_traceback())
        return _error(str(exc))


@frappe.whitelist()
def api_run_sales_itemwise_gst(body=None):
    """Staff API: Sales Invoice with item-wise Output GST."""
    _require_accounts()
    body = _parse_request_value("body", body)
    if isinstance(body, str):
        body = json.loads(body or "{}")
    items = (body or {}).get("items") if isinstance(body, dict) else None
    try:
        out = run_sales_invoice_with_itemwise_gst(items=items)
        frappe.db.commit()
        return _success(out)
    except Exception as exc:
        frappe.db.rollback()
        frappe.log_error(title="api_run_sales_itemwise_gst", message=frappe.get_traceback())
        return _error(str(exc))
