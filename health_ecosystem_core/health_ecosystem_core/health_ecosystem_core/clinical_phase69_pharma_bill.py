"""
Phase 69 — Marg/Busy-style landscape GST bill print + pharma item/invoice entry.

- Custom fields: pack, free qty, batch, expiry, MRP, GST rates, transport
- Print Format: HEC Landscape GST Bill (Sales + Purchase)
- APIs: upsert item, item defaults, create SI/PINV from Marg-style grid
- Desk page: hec-pharma-billing
"""

from __future__ import annotations

import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, nowdate

MODULE = "Health Ecosystem Core"
PRINT_SI = "HEC Landscape GST Bill"
PRINT_PINV = "HEC Landscape GST Bill Purchase"
PAGE_NAME = "hec-pharma-billing"


# ---------------------------------------------------------------------------
# Custom fields
# ---------------------------------------------------------------------------


def ensure_phase69_custom_fields():
    """Item + SI/PINV line + invoice header fields for Marg-style bills."""
    if getattr(frappe.local, "hec_phase69_fields_ready", False):
        return True
    invoice_item_fields = [
        {
            "fieldname": "hec_free_qty",
            "label": "Free Qty",
            "fieldtype": "Float",
            "insert_after": "qty",
            "precision": "3",
        },
        {
            "fieldname": "hec_pack_size",
            "label": "Pack Size",
            "fieldtype": "Data",
            "insert_after": "hec_free_qty",
        },
        {
            "fieldname": "hec_batch_no",
            "label": "Batch No",
            "fieldtype": "Data",
            "insert_after": "hec_pack_size",
        },
        {
            "fieldname": "hec_expiry_date",
            "label": "Expiry Date",
            "fieldtype": "Date",
            "insert_after": "hec_batch_no",
        },
        {
            "fieldname": "hec_item_mrp",
            "label": "Item MRP",
            "fieldtype": "Currency",
            "insert_after": "hec_expiry_date",
        },
        {
            "fieldname": "hec_sgst_rate",
            "label": "SGST %",
            "fieldtype": "Float",
            "insert_after": "hec_item_mrp",
            "precision": "3",
        },
        {
            "fieldname": "hec_cgst_rate",
            "label": "CGST %",
            "fieldtype": "Float",
            "insert_after": "hec_sgst_rate",
            "precision": "3",
        },
        {
            "fieldname": "hec_igst_rate",
            "label": "IGST %",
            "fieldtype": "Float",
            "insert_after": "hec_cgst_rate",
            "precision": "3",
        },
    ]
    invoice_header_fields = [
        {
            "fieldname": "hec_transport",
            "label": "Transport",
            "fieldtype": "Data",
            "insert_after": "apply_discount_on",
            "hidden": 1,
        },
        {
            "fieldname": "hec_lr_no",
            "label": "L.R. No",
            "fieldtype": "Data",
            "insert_after": "hec_transport",
            "hidden": 1,
        },
        {
            "fieldname": "hec_lr_date",
            "label": "L.R. Date",
            "fieldtype": "Date",
            "insert_after": "hec_lr_no",
            "hidden": 1,
        },
        {
            "fieldname": "hec_cases",
            "label": "Cases",
            "fieldtype": "Data",
            "insert_after": "hec_lr_date",
            "hidden": 1,
        },
        {
            "fieldname": "hec_eway_bill",
            "label": "E-Way Bill",
            "fieldtype": "Data",
            "insert_after": "hec_cases",
            "hidden": 1,
        },
    ]

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_pack_size",
                    "label": "Pack Size",
                    "fieldtype": "Data",
                    "insert_after": "hec_tax_category",
                },
                {
                    "fieldname": "hec_item_mrp",
                    "label": "Item MRP",
                    "fieldtype": "Currency",
                    "insert_after": "hec_pack_size",
                },
            ],
            "Batch": [
                {
                    "fieldname": "hec_mrp",
                    "label": "Batch MRP",
                    "fieldtype": "Currency",
                    "insert_after": "expiry_date",
                },
                {
                    "fieldname": "hec_purchase_rate",
                    "label": "Batch Purchase Rate",
                    "fieldtype": "Currency",
                    "insert_after": "hec_mrp",
                },
            ],
            "Sales Invoice Item": invoice_item_fields,
            "Purchase Invoice Item": invoice_item_fields,
            "Sales Invoice": invoice_header_fields,
            "Purchase Invoice": invoice_header_fields,
        },
        update=True,
    )
    frappe.local.hec_phase69_fields_ready = True
    return True


# ---------------------------------------------------------------------------
# Print format (Jinja)
# ---------------------------------------------------------------------------


def _landscape_css():
    """Marg-style compact continuous bill — footer follows items, no full-page gap."""
    return """
@page { size: A4 landscape; margin: 4mm; }
html, body {
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
.print-format,
.print-format-gutter,
.page-break,
.page-container,
.print-wrapper {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  page-break-after: auto !important;
}
.hec-bill-root {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8px;
  color: #111;
  width: 100%;
  padding: 0 !important;
  margin: 0 !important;
}
.hec-bill-root table { page-break-inside: auto; }
.hec-bill { width: 100%; border-collapse: collapse; }
.hec-bill td, .hec-bill th { border: 1px solid #222; padding: 1px 3px; vertical-align: top; line-height: 1.15; }
.hec-head { width: 100%; border-collapse: collapse; margin: 0 0 2px 0; }
.hec-head td { border: 1px solid #222; padding: 2px 4px; vertical-align: top; }
.hec-company { font-size: 11px; font-weight: 700; text-transform: uppercase; line-height: 1.2; }
.hec-muted { color: #222; font-size: 7.5px; line-height: 1.2; }
.hec-title { font-size: 10px; font-weight: 700; margin: 0 0 2px 0; text-align: center; }
.hec-center { text-align: center; }
.hec-right { text-align: right; }
.hec-items { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; }
.hec-items th {
  background: #e8e8e8;
  font-size: 7.5px;
  text-align: center;
  padding: 1px 2px;
  line-height: 1.1;
  white-space: nowrap;
}
.hec-items td {
  font-size: 7.5px;
  padding: 1px 2px;
  line-height: 1.15;
  vertical-align: middle;
}
.hec-items tbody tr { page-break-inside: avoid; }
.hec-items .col-sn { width: 3%; }
.hec-items .col-qty { width: 4.5%; }
.hec-items .col-free { width: 4%; }
.hec-items .col-pack { width: 5%; }
.hec-items .col-name { width: 18%; }
.hec-items .col-batch { width: 7%; }
.hec-items .col-exp { width: 4.5%; }
.hec-items .col-hsn { width: 5%; }
.hec-items .col-mrp { width: 5.5%; }
.hec-items .col-rate { width: 5.5%; }
.hec-items .col-dis { width: 4%; }
.hec-items .col-sgst { width: 4.5%; }
.hec-items .col-cgst { width: 4.5%; }
.hec-items .col-gstv { width: 6%; }
.hec-items .col-amt { width: 7%; }
.hec-foot {
  width: 100%;
  border-collapse: collapse;
  margin-top: 3px;
  page-break-inside: avoid;
  page-break-before: avoid;
}
.hec-foot td { border: 1px solid #222; padding: 2px 4px; vertical-align: top; }
.hec-grand { font-size: 10px; font-weight: 700; }
.hec-words { font-style: italic; margin-top: 2px; font-size: 7.5px; line-height: 1.2; }
.hec-bottom {
  margin-top: 4px;
  width: 100%;
  border-collapse: collapse;
  page-break-inside: avoid;
}
.hec-bottom td { border: none; padding: 2px 4px; vertical-align: top; font-size: 7.5px; }
.hec-sign { text-align: right; }
.hec-sign-line { margin-top: 22px; }
"""


def _safe_get(doctype, name, fields):
    """Fetch fields that exist on the DocType; ignore missing columns (e.g. gstin)."""
    if not name or not frappe.db.exists(doctype, name):
        return None
    meta = frappe.get_meta(doctype)
    wanted = [f for f in fields if meta.has_field(f)]
    if not wanted:
        return frappe._dict()
    if len(wanted) == 1:
        val = frappe.db.get_value(doctype, name, wanted[0])
        return frappe._dict({wanted[0]: val})
    row = frappe.db.get_value(doctype, name, wanted, as_dict=True)
    return row or frappe._dict()


def build_landscape_bill_context(doc):
    """Prepare Marg-style row + tax-class summary for print (called from Jinja)."""
    is_sales = doc.doctype == "Sales Invoice"
    company = frappe.get_doc("Company", doc.company)
    party = doc.customer if is_sales else doc.supplier
    party_name = getattr(doc, "customer_name", None) if is_sales else getattr(doc, "supplier_name", None)
    party_doctype = "Customer" if is_sales else "Supplier"
    gstin_company = ""
    if frappe.get_meta("Company").has_field("gstin"):
        gstin_company = getattr(company, "gstin", None) or ""
    addr = None
    if getattr(company, "company_address", None):
        addr = _safe_get(
            "Address",
            company.company_address,
            ["address_line1", "address_line2", "city", "state", "pincode", "phone", "gstin"],
        )
        if addr and addr.get("gstin"):
            gstin_company = addr.gstin
    party_gstin = ""
    if party and frappe.get_meta(party_doctype).has_field("gstin"):
        party_gstin = frappe.db.get_value(party_doctype, party, "gstin") or ""
    paddr = None
    paddr_name = getattr(doc, "customer_address", None) if is_sales else getattr(doc, "supplier_address", None)
    if paddr_name:
        paddr = _safe_get(
            "Address",
            paddr_name,
            ["address_line1", "address_line2", "city", "state", "pincode", "phone", "gstin"],
        )
        if paddr and paddr.get("gstin") and not party_gstin:
            party_gstin = paddr.gstin

    free_map = defaultdict(float)
    for it in doc.items:
        if cint(it.is_free_item):
            key = f"{it.item_code}|{getattr(it, 'hec_batch_no', None) or getattr(it, 'batch_no', None) or ''}"
            free_map[key] += flt(it.qty)

    rows = []
    class_map = defaultdict(lambda: {"taxable": 0.0, "disc": 0.0, "sgst": 0.0, "cgst": 0.0, "gst": 0.0})
    total_qty = 0.0
    for it in doc.items:
        if cint(it.is_free_item):
            continue
        key = f"{it.item_code}|{getattr(it, 'hec_batch_no', None) or getattr(it, 'batch_no', None) or ''}"
        free_q = flt(getattr(it, "hec_free_qty", 0) or 0) or free_map.get(key) or 0
        sgst = flt(getattr(it, "hec_sgst_rate", 0) or 0)
        cgst = flt(getattr(it, "hec_cgst_rate", 0) or 0)
        igst = flt(getattr(it, "hec_igst_rate", 0) or 0)
        gst_rate = sgst + cgst + igst
        if not gst_rate and it.item_tax_rate:
            tax_dict = it.item_tax_rate
            if isinstance(tax_dict, str):
                tax_dict = json.loads(tax_dict or "{}")
            if isinstance(tax_dict, dict):
                gst_rate = sum(flt(v) for v in tax_dict.values())
                if not igst:
                    sgst = gst_rate / 2.0
                    cgst = gst_rate / 2.0
        line_tax = flt(it.net_amount) * gst_rate / 100.0
        exp = ""
        if getattr(it, "hec_expiry_date", None):
            try:
                exp = frappe.utils.formatdate(it.hec_expiry_date, "MM/yy")
            except Exception:
                exp = str(it.hec_expiry_date)
        hsn = getattr(it, "gst_hsn_code", None) or frappe.db.get_value("Item", it.item_code, "hec_hsn_sac") or ""
        row = {
            "item_name": it.item_name or it.item_code,
            "pack": getattr(it, "hec_pack_size", None) or "",
            "batch": getattr(it, "hec_batch_no", None) or getattr(it, "batch_no", None) or "",
            "exp": exp,
            "hsn": hsn,
            "mrp": flt(getattr(it, "hec_item_mrp", 0) or 0),
            "qty": flt(it.qty),
            "free": free_q,
            "rate": flt(it.rate),
            "disc": flt(it.discount_percentage),
            "sgst": sgst,
            "cgst": cgst,
            "gst_val": line_tax,
            "amount": flt(it.net_amount) + line_tax,
            "gst_class": gst_rate,
            "taxable": flt(it.net_amount),
            "disc_amt": flt(it.discount_amount),
        }
        rows.append(row)
        total_qty += row["qty"] + row["free"]
        cls = f"{gst_rate:g}"
        class_map[cls]["taxable"] += row["taxable"]
        class_map[cls]["disc"] += row["disc_amt"]
        class_map[cls]["sgst"] += row["taxable"] * sgst / 100.0
        class_map[cls]["cgst"] += row["taxable"] * cgst / 100.0
        class_map[cls]["gst"] += line_tax

    sgst_pay = cgst_pay = 0.0
    for t in doc.taxes or []:
        head = f"{t.account_head or ''} {t.description or ''}"
        if "SGST" in head:
            sgst_pay += flt(t.tax_amount)
        elif "CGST" in head:
            cgst_pay += flt(t.tax_amount)

    return {
        "company": company,
        "is_sales": is_sales,
        "party": party,
        "party_name": party_name or party,
        "gstin_company": gstin_company,
        "party_gstin": party_gstin or (paddr.get("gstin") if paddr else ""),
        "addr": addr,
        "paddr": paddr,
        "rows": rows,
        "class_map": dict(class_map),
        "total_items": len(rows),
        "total_qty": total_qty,
        "sgst_pay": sgst_pay,
        "cgst_pay": cgst_pay,
        "disc_total": flt(doc.discount_amount),
    }


def _landscape_html():
    """Jinja HTML — Marg compact continuous bill (footer directly under items)."""
    return r"""
{%- set ctx = build_landscape_bill_context(doc) -%}
<div class="hec-bill-root">
<table class="hec-head">
<tr>
  <td style="width:30%">
    <div class="hec-company">{{ ctx.company.company_name or doc.company }}</div>
    <div class="hec-muted">
      {% if ctx.addr %}
        {{ ctx.addr.address_line1 or "" }}{% if ctx.addr.address_line2 %}, {{ ctx.addr.address_line2 }}{% endif %}
        {{ ctx.addr.city or "" }}{% if ctx.addr.state %}, {{ ctx.addr.state }}{% endif %} {{ ctx.addr.pincode or "" }}
        {% if ctx.addr.phone %} | Ph: {{ ctx.addr.phone }}{% endif %}
        {% if ctx.gstin_company %} | GSTIN: {{ ctx.gstin_company }}{% endif %}
      {% else %}
        {{ doc.company }}{% if ctx.gstin_company %} | GSTIN: {{ ctx.gstin_company }}{% endif %}
      {% endif %}
    </div>
  </td>
  <td style="width:40%" class="hec-center">
    <div class="hec-title">{{ _("GST INVOICE") if ctx.is_sales else _("PURCHASE GST INVOICE") }}</div>
    <table class="hec-bill" style="width:100%">
      <tr>
        <td>{{ _("Inv No") }}: <b>{{ doc.name }}</b></td>
        <td>{{ _("Date") }}: <b>{{ frappe.utils.formatdate(doc.posting_date) }}</b></td>
        <td>{{ _("Order/Bill") }}: <b>{{ doc.po_no if ctx.is_sales else (doc.bill_no or "") }}</b></td>
      </tr>
      {% if doc.hec_transport or doc.hec_lr_no or doc.hec_cases or doc.hec_eway_bill %}
      <tr>
        <td>{{ _("Transport") }}: {{ doc.hec_transport or "" }}</td>
        <td>{{ _("L.R.") }}: {{ doc.hec_lr_no or "" }}{% if doc.hec_lr_date %} {{ frappe.utils.formatdate(doc.hec_lr_date) }}{% endif %}</td>
        <td>{{ _("Cases") }}: {{ doc.hec_cases or "" }} {% if doc.hec_eway_bill %}| E-Way: {{ doc.hec_eway_bill }}{% endif %}</td>
      </tr>
      {% endif %}
    </table>
  </td>
  <td style="width:30%">
    <div style="font-weight:700;font-size:8.5px;">{{ _("Party") }}: {{ ctx.party_name }}</div>
    <div class="hec-muted">
      {% if ctx.paddr %}
        {{ ctx.paddr.address_line1 or "" }}{% if ctx.paddr.address_line2 %}, {{ ctx.paddr.address_line2 }}{% endif %}
        {{ ctx.paddr.city or "" }}{% if ctx.paddr.state %}, {{ ctx.paddr.state }}{% endif %} {{ ctx.paddr.pincode or "" }}
        {% if ctx.paddr.phone %} | Ph: {{ ctx.paddr.phone }}{% endif %}
      {% endif %}
      {% if ctx.party_gstin %} | GSTIN: {{ ctx.party_gstin }}{% endif %}
    </div>
  </td>
</tr>
</table>

<table class="hec-items">
<thead>
<tr>
  <th class="col-sn">S.N</th>
  <th class="col-qty">Qty</th>
  <th class="col-free">Free</th>
  <th class="col-pack">Pack</th>
  <th class="col-name">Product Name</th>
  <th class="col-batch">Batch</th>
  <th class="col-exp">Exp</th>
  <th class="col-hsn">HSN</th>
  <th class="col-mrp">M.R.P</th>
  <th class="col-rate">Rate</th>
  <th class="col-dis">DIS%</th>
  <th class="col-sgst">SGST%</th>
  <th class="col-cgst">CGST%</th>
  <th class="col-gstv">GST Value</th>
  <th class="col-amt">Amount</th>
</tr>
</thead>
<tbody>
{% for r in ctx.rows %}
<tr>
  <td class="hec-center">{{ loop.index }}</td>
  <td class="hec-right">{{ "%.2f"|format(r.qty) }}</td>
  <td class="hec-right">{% if r.free %}{{ "%.2f"|format(r.free) }}{% endif %}</td>
  <td class="hec-center">{{ r.pack }}</td>
  <td>{{ r.item_name }}</td>
  <td class="hec-center">{{ r.batch }}</td>
  <td class="hec-center">{{ r.exp }}</td>
  <td class="hec-center">{{ r.hsn }}</td>
  <td class="hec-right">{% if r.mrp %}{{ "%.2f"|format(r.mrp) }}{% endif %}</td>
  <td class="hec-right">{{ "%.2f"|format(r.rate) }}</td>
  <td class="hec-right">{% if r.disc %}{{ "%.2f"|format(r.disc) }}{% endif %}</td>
  <td class="hec-right">{% if r.sgst %}{{ "%.2f"|format(r.sgst) }}{% endif %}</td>
  <td class="hec-right">{% if r.cgst %}{{ "%.2f"|format(r.cgst) }}{% endif %}</td>
  <td class="hec-right">{{ "%.2f"|format(r.gst_val) }}</td>
  <td class="hec-right">{{ "%.2f"|format(r.amount) }}</td>
</tr>
{% endfor %}
</tbody>
</table>

<table class="hec-foot">
<tr>
  <td style="width:48%">
    <table class="hec-bill" style="width:100%">
      <tr>
        <th>CLASS</th><th>Total</th><th>Scheme</th><th>Disc</th><th>SGST</th><th>CGST</th><th>Total GST</th>
      </tr>
      {% for cls, cur in ctx.class_map.items() %}
      <tr>
        <td class="hec-center">{{ cls }}%</td>
        <td class="hec-right">{{ "%.2f"|format(cur.taxable) }}</td>
        <td class="hec-right">0.00</td>
        <td class="hec-right">{{ "%.2f"|format(cur.disc) }}</td>
        <td class="hec-right">{{ "%.2f"|format(cur.sgst) }}</td>
        <td class="hec-right">{{ "%.2f"|format(cur.cgst) }}</td>
        <td class="hec-right">{{ "%.2f"|format(cur.gst) }}</td>
      </tr>
      {% endfor %}
    </table>
    <div class="hec-words">{{ _("Amount in Words") }}: {{ doc.in_words or "" }}</div>
  </td>
  <td style="width:18%" class="hec-center">
    <div>{{ _("Items") }}: <b>{{ ctx.total_items }}</b></div>
    <div>{{ _("Qty") }}: <b>{{ "%.2f"|format(ctx.total_qty) }}</b></div>
  </td>
  <td style="width:34%">
    <table class="hec-bill" style="width:100%">
      <tr><td>TOTAL</td><td class="hec-right">{{ "%.2f"|format(doc.net_total or 0) }}</td></tr>
      <tr><td>DIS AMT</td><td class="hec-right">{{ "%.2f"|format(ctx.disc_total) }}</td></tr>
      <tr><td>SGST PAYABLE</td><td class="hec-right">{{ "%.2f"|format(ctx.sgst_pay) }}</td></tr>
      <tr><td>CGST PAYABLE</td><td class="hec-right">{{ "%.2f"|format(ctx.cgst_pay) }}</td></tr>
      <tr><td class="hec-grand">Grand Total</td><td class="hec-right hec-grand">{{ "%.2f"|format(doc.rounded_total or doc.grand_total or 0) }}</td></tr>
    </table>
  </td>
</tr>
</table>

<table class="hec-bottom">
<tr>
  <td style="width:60%">
    <b>{{ _("Terms") }}:</b>
    {{ doc.terms or _("Goods once sold will not be taken back. Subject to local jurisdiction.") }}
  </td>
  <td class="hec-sign" style="width:40%">
    <b>FOR {{ ctx.company.company_name or doc.company }}</b>
    <div class="hec-sign-line">{{ _("Authorised Signatory") }}</div>
  </td>
</tr>
</table>
</div>
"""


def _ensure_print_format(name, doc_type):
    html = _landscape_html()
    css = _landscape_css()
    if frappe.db.exists("Print Format", name):
        pf = frappe.get_doc("Print Format", name)
        pf.doc_type = doc_type
        pf.module = MODULE
        pf.standard = "No"
        pf.custom_format = 1
        if hasattr(pf, "print_format_type"):
            pf.print_format_type = "Jinja"
        # Compact Marg bill: no letterhead chrome, zero extra page margins
        for field, value in (
            ("margin_top", 0),
            ("margin_bottom", 0),
            ("margin_left", 0),
            ("margin_right", 0),
            ("page_number", "Hide"),
            ("align_labels_right", 0),
            ("show_section_headings", 0),
            ("line_breaks", 0),
            ("absolute_value", 0),
        ):
            if hasattr(pf, field):
                setattr(pf, field, value)
        pf.html = html
        pf.css = css
        pf.save(ignore_permissions=True)
        return name
    doc = {
        "doctype": "Print Format",
        "name": name,
        "doc_type": doc_type,
        "module": MODULE,
        "standard": "No",
        "custom_format": 1,
        "html": html,
        "css": css,
    }
    if frappe.get_meta("Print Format").has_field("print_format_type"):
        doc["print_format_type"] = "Jinja"
    for field, value in (
        ("margin_top", 0),
        ("margin_bottom", 0),
        ("margin_left", 0),
        ("margin_right", 0),
        ("page_number", "Hide"),
    ):
        if frappe.get_meta("Print Format").has_field(field):
            doc[field] = value
    frappe.get_doc(doc).insert(ignore_permissions=True)
    return name


def sanitize_letter_heads_for_pdf():
    """Strip broken / relative image tags from Letter Heads that break wkhtmltopdf."""
    import re

    fixed = []
    for name in frappe.get_all("Letter Head", pluck="name"):
        lh = frappe.get_doc("Letter Head", name)
        changed = False
        for field in ("content", "footer", "header"):
            if not hasattr(lh, field):
                continue
            raw = getattr(lh, field) or ""
            if not raw or "<img" not in raw.lower():
                continue
            # Drop img tags with relative /files or /private paths that PDF engine cannot fetch
            cleaned = re.sub(
                r"<img[^>]+src=[\"'](?!https?:|data:)[^\"']+[\"'][^>]*>",
                "",
                raw,
                flags=re.I,
            )
            if cleaned != raw:
                setattr(lh, field, cleaned)
                changed = True
        if changed:
            lh.save(ignore_permissions=True)
            fixed.append(name)
    if fixed:
        frappe.db.commit()
    return fixed


def fix_pinv_blank_form():
    """
    Repair Purchase/Sales Invoice Desk layout.

    Header transport custom fields (Section/Column Breaks with fragile insert_after)
    have been observed to blank the Desk form. Hide them and disable any
    third-party Client Scripts on these doctypes that may throw on refresh.
    """
    repair_invoice_transport_fields()

    # Hide header transport block — keeps print fields in DB but removes layout risk
    header_fields = (
        "hec_transport_section",
        "hec_transport",
        "hec_lr_no",
        "hec_lr_date",
        "column_break_hec_transport",
        "hec_cases",
        "hec_eway_bill",
    )
    for dt in ("Purchase Invoice", "Sales Invoice"):
        for fn in header_fields:
            cf = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": fn}, "name")
            if cf:
                # Delete Section/Column breaks that blank Desk forms; keep Data fields hidden
                ft = frappe.db.get_value("Custom Field", cf, "fieldtype")
                if ft in ("Section Break", "Column Break"):
                    frappe.delete_doc("Custom Field", cf, force=1, ignore_permissions=True)
                else:
                    frappe.db.set_value(
                        "Custom Field",
                        cf,
                        {"hidden": 1, "report_hide": 1},
                        update_modified=False,
                    )

        # Re-anchor free qty after qty on item table (safe native field)
        free_cf = frappe.db.get_value(
            "Custom Field", {"dt": f"{dt} Item", "fieldname": "hec_free_qty"}, "name"
        )
        if free_cf:
            frappe.db.set_value("Custom Field", free_cf, "insert_after", "qty", update_modified=False)

        # Disable non-HEC client scripts that can blank the form
        for cs in frappe.get_all(
            "Client Script",
            filters={"dt": dt, "enabled": 1},
            fields=["name", "view"],
        ):
            # Keep enabled only if name/script clearly HEC — otherwise disable
            title = (cs.name or "").lower()
            if "hec" in title or "marg" in title:
                continue
            frappe.db.set_value("Client Script", cs.name, "enabled", 0, update_modified=False)

        frappe.clear_cache(doctype=dt)
        frappe.clear_cache(doctype=f"{dt} Item")

    frappe.db.commit()
    return {"ok": True, "repaired": True, "transport_hidden": True}


def ensure_print_formats():
    si = _ensure_print_format(PRINT_SI, "Sales Invoice")
    pinv = _ensure_print_format(PRINT_PINV, "Purchase Invoice")
    _ensure_default_print("Sales Invoice", PRINT_SI)
    _ensure_default_print("Purchase Invoice", PRINT_PINV)
    return {"sales": si, "purchase": pinv}


def _ensure_default_print(doctype, print_name):
    """Set default print format only if unset or already an HEC format."""
    meta = frappe.get_meta(doctype)
    current = getattr(meta, "default_print_format", None) or frappe.db.get_value(
        "Property Setter",
        {"doc_type": doctype, "property": "default_print_format", "field_name": ""},
        "value",
    )
    if current and not str(current).startswith("HEC "):
        return
    existing = frappe.db.exists(
        "Property Setter",
        {"doc_type": doctype, "property": "default_print_format", "field_name": ["in", ["", None]]},
    )
    if existing:
        frappe.db.set_value("Property Setter", existing, "value", print_name)
    else:
        frappe.get_doc(
            {
                "doctype": "Property Setter",
                "doctype_or_field": "DocType",
                "doc_type": doctype,
                "property": "default_print_format",
                "property_type": "Data",
                "value": print_name,
            }
        ).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Desk page + workspace
# ---------------------------------------------------------------------------


def ensure_pharma_billing_page():
    roles = [
        "System Manager",
        "Health System Admin",
        "Accounts User",
        "Accounts Manager",
        "Purchase User",
        "Purchase Manager",
        "Sales User",
        "Sales Manager",
        "Stock User",
    ]
    if frappe.db.exists("Page", PAGE_NAME):
        page = frappe.get_doc("Page", PAGE_NAME)
        page.title = "HEC Pharma Billing"
        page.module = MODULE
        page.roles = []
        for role in roles:
            if frappe.db.exists("Role", role):
                page.append("roles", {"role": role})
        page.save(ignore_permissions=True)
        return PAGE_NAME

    page = frappe.get_doc(
        {
            "doctype": "Page",
            "page_name": PAGE_NAME,
            "title": "HEC Pharma Billing",
            "module": MODULE,
            "standard": "Yes",
        }
    )
    for role in roles:
        if frappe.db.exists("Role", role):
            page.append("roles", {"role": role})
    page.insert(ignore_permissions=True)
    return PAGE_NAME


def ensure_workspace_links():
    if not frappe.db.exists("Workspace", "Clinical"):
        return False
    ws = frappe.get_doc("Workspace", "Clinical")
    labels = {s.label for s in (ws.shortcuts or [])}
    changed = False
    if "HEC Pharma Billing" not in labels:
        ws.append(
            "shortcuts",
            {
                "label": "HEC Pharma Billing",
                "type": "Page",
                "link_to": PAGE_NAME,
                "color": "Blue",
            },
        )
        changed = True
    if changed:
        ws.save(ignore_permissions=True)
    return True


# ---------------------------------------------------------------------------
# Item Quick Entry
# ---------------------------------------------------------------------------


def sanitize_hec_item_code(raw_code, item_name=None):
    """ERPNext Item.name cannot contain spaces / special chars.

    Returns (item_code, item_name) where item_code is safe for DocType naming
    and item_name keeps the human-readable label (spaces allowed).
    """
    import re

    raw = (raw_code or "").strip()
    display = (item_name or raw or "").strip() or raw
    if not raw:
        return "", display
    # If an Item already exists under the exact typed code, keep it
    if frappe.db.exists("Item", raw):
        return raw, display or raw
    # Prefer matching a previously sanitized code
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", raw)
    safe = re.sub(r"-{2,}", "-", safe).strip("-._")
    if not safe:
        frappe.throw(_("Item code must contain letters or numbers"))
    # Cap length (ERPNext name limit is generous; keep codes practical)
    if len(safe) > 140:
        safe = safe[:140].rstrip("-._")
    return safe, display or safe


def get_hec_pharma_item_defaults(item_code):
    """Autofill defaults for billing grid."""
    if not item_code or not frappe.db.exists("Item", item_code):
        return {}
    it = frappe.get_doc("Item", item_code)
    price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "selling": 1},
        "price_list_rate",
        order_by="modified desc",
    ) or frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "buying": 1},
        "price_list_rate",
        order_by="modified desc",
    )
    gst = flt(getattr(it, "hec_gst_rate", 0) or 0)
    half = gst / 2.0 if gst else 0
    return {
        "item_code": it.name,
        "item_name": it.item_name,
        "hec_pack_size": getattr(it, "hec_pack_size", None) or "",
        "hec_item_mrp": flt(getattr(it, "hec_item_mrp", 0) or 0),
        "hec_hsn_sac": getattr(it, "hec_hsn_sac", None) or "",
        "hec_gst_rate": gst,
        "hec_sgst_rate": half,
        "hec_cgst_rate": half,
        "hec_igst_rate": 0,
        "price_list_rate": flt(price or 0),
        "rate": flt(price or 0),
        "has_batch_no": cint(it.has_batch_no),
        "has_expiry_date": cint(it.has_expiry_date),
        "stock_uom": it.stock_uom,
        "is_stock_item": cint(it.is_stock_item),
    }


def upsert_hec_pharma_item(data=None):
    """Create/update Item with pack, MRP, HSN, GST, batch flags, price list rate.

    Mandatory ERPNext Item fields always set: item_code, item_name, item_group, stock_uom.
    Also mirrors stock_uom onto sales_uom / purchase_uom so invoice lines resolve UOM.
    Spaces in typed codes (e.g. "New Item 1") are sanitized to "New-Item-1";
    the original text is kept as item_name.
    """
    if isinstance(data, str):
        data = json.loads(data or "{}")
    data = data or {}
    raw_code = (data.get("item_code") or "").strip()
    if not raw_code:
        frappe.throw(_("item_code is required"))
    code, name = sanitize_hec_item_code(raw_code, data.get("item_name"))
    if not name:
        name = code

    from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
        apply_hsn_to_item,
        ensure_item_tax_fields,
        ensure_item_tax_templates,
    )

    ensure_phase69_custom_fields()
    ensure_item_tax_fields()
    ensure_item_tax_templates()

    item_group = data.get("item_group") or "Products"
    if not frappe.db.exists("Item Group", item_group):
        item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"

    uom = (data.get("stock_uom") or data.get("uom") or "Nos").strip() or "Nos"
    if not frappe.db.exists("UOM", uom):
        frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)

    vals = {
        "item_name": name,
        "item_group": item_group,
        "stock_uom": uom,
        "sales_uom": uom,
        "purchase_uom": uom,
        "is_stock_item": cint(data.get("is_stock_item", 1)),
        "is_sales_item": cint(data.get("is_sales_item", 1)),
        "is_purchase_item": cint(data.get("is_purchase_item", 1)),
        "has_batch_no": cint(data.get("has_batch_no") or 0),
        "has_expiry_date": cint(data.get("has_expiry_date") or 0),
        "disabled": 0,
        "include_item_in_manufacturing": 0,
    }
    if data.get("hec_pack_size") is not None:
        vals["hec_pack_size"] = data.get("hec_pack_size")
    if data.get("hec_item_mrp") is not None:
        vals["hec_item_mrp"] = flt(data.get("hec_item_mrp"))
    if data.get("hec_hsn_sac"):
        vals["hec_hsn_sac"] = data.get("hec_hsn_sac")
    if data.get("hec_gst_rate") is not None:
        vals["hec_gst_rate"] = flt(data.get("hec_gst_rate"))

    if frappe.db.exists("Item", code):
        doc = frappe.get_doc("Item", code)
        if not (doc.item_name or "").strip():
            vals["item_name"] = name
        if not doc.stock_uom:
            vals["stock_uom"] = uom
            vals["sales_uom"] = uom
            vals["purchase_uom"] = uom
        doc.update(vals)
        doc.save(ignore_permissions=True)
        created = False
    else:
        doc = frappe.get_doc({"doctype": "Item", "item_code": code, **vals})
        doc.insert(ignore_permissions=True)
        created = True

    if data.get("hec_hsn_sac") or data.get("hec_gst_rate") is not None:
        apply_hsn_to_item(code, force=False)

    pl_rate = data.get("price_list_rate")
    if pl_rate is None and data.get("rate") is not None:
        pl_rate = data.get("rate")
    if pl_rate is not None and flt(pl_rate) >= 0:
        _upsert_item_price(code, flt(pl_rate), selling=1)
        _upsert_item_price(code, flt(pl_rate), buying=1)

    return {
        "ok": True,
        "created": created,
        "item_code": code,
        "defaults": get_hec_pharma_item_defaults(code),
    }


def _upsert_item_price(item_code, rate, selling=0, buying=0, batch_no=None):
    company = frappe.defaults.get_global_default("company")
    currency = frappe.db.get_value("Company", company, "default_currency") if company else "INR"
    pl_filters = {"selling": 1} if selling else {"buying": 1}
    price_list = frappe.db.get_value("Price List", {**pl_filters, "enabled": 1}, "name")
    if not price_list:
        price_list = frappe.db.get_value("Price List", pl_filters, "name")
    if not price_list:
        return None
    filters = {"item_code": item_code, "price_list": price_list}
    has_batch_field = frappe.get_meta("Item Price").has_field("batch_no")
    if batch_no and has_batch_field:
        filters["batch_no"] = batch_no
    existing = frappe.db.get_value("Item Price", filters, "name")
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
        return existing
    doc = {
        "doctype": "Item Price",
        "item_code": item_code,
        "price_list": price_list,
        "price_list_rate": rate,
        "currency": currency or "INR",
    }
    if batch_no and has_batch_field:
        doc["batch_no"] = batch_no
    return frappe.get_doc(doc).insert(ignore_permissions=True).name


def _last_purchase_rate(item_code, batch_no=None):
    """Latest Purchase Invoice Item rate for item (prefer matching batch)."""
    if not item_code:
        return 0.0
    filters = {"item_code": item_code, "docstatus": 1, "parenttype": "Purchase Invoice"}
    rows = frappe.get_all(
        "Purchase Invoice Item",
        filters=filters,
        fields=["rate", "hec_batch_no", "batch_no", "modified", "parent"],
        order_by="modified desc",
        limit_page_length=40,
    )
    if not rows:
        rows = frappe.get_all(
            "Purchase Invoice Item",
            filters={"item_code": item_code, "parenttype": "Purchase Invoice"},
            fields=["rate", "hec_batch_no", "batch_no", "modified", "parent"],
            order_by="modified desc",
            limit_page_length=40,
        )
    batch_no = (batch_no or "").strip()
    if batch_no:
        for r in rows:
            b = (r.get("hec_batch_no") or r.get("batch_no") or "").strip()
            if b == batch_no and flt(r.rate) > 0:
                return flt(r.rate)
    for r in rows:
        if flt(r.rate) > 0:
            return flt(r.rate)
    # Batch custom field fallback
    if batch_no and frappe.db.exists("Batch", batch_no):
        return flt(frappe.db.get_value("Batch", batch_no, "hec_purchase_rate") or 0)
    return 0.0


def _batch_mrp(item_code, batch_no=None):
    """MRP / standard selling: Batch.hec_mrp → Item Price (batch) → Item.hec_item_mrp → selling Item Price."""
    batch_no = (batch_no or "").strip()
    if batch_no and frappe.db.exists("Batch", batch_no):
        mrp = flt(frappe.db.get_value("Batch", batch_no, "hec_mrp") or 0)
        if mrp:
            return mrp
    if item_code and batch_no and frappe.get_meta("Item Price").has_field("batch_no"):
        pl = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        if pl:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": pl, "batch_no": batch_no},
                "price_list_rate",
            )
            if flt(rate):
                return flt(rate)
    if item_code and frappe.db.exists("Item", item_code):
        mrp = flt(frappe.db.get_value("Item", item_code, "hec_item_mrp") or 0)
        if mrp:
            return mrp
        pl = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        if pl:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": pl},
                "price_list_rate",
                order_by="modified desc",
            )
            return flt(rate or 0)
    return 0.0


def sanitize_hec_batch_no(raw):
    """Batch document name cannot contain spaces / special chars."""
    import re

    raw = (raw or "").strip()
    if not raw:
        return ""
    if frappe.db.exists("Batch", raw):
        return raw
    safe = re.sub(r"[^A-Za-z0-9._\-]+", "-", raw)
    safe = re.sub(r"-{2,}", "-", safe).strip("-._")
    if not safe:
        frappe.throw(_("Batch No must contain letters or numbers"))
    if len(safe) > 140:
        safe = safe[:140].rstrip("-._")
    return safe


def ensure_hec_batch(
    item_code,
    batch_no,
    expiry_date=None,
    mrp=None,
    purchase_rate=None,
):
    """Create/update ERPNext Batch for item; store MRP + purchase rate on Batch (+ Item Price)."""
    ensure_phase69_custom_fields()
    item_code = (item_code or "").strip()
    raw_batch = (batch_no or "").strip()
    if not item_code:
        frappe.throw(_("item_code is required for Batch"))
    if not raw_batch:
        frappe.throw(_("batch_no is required"))
    if not frappe.db.exists("Item", item_code):
        frappe.throw(_("Item {0} does not exist").format(item_code))

    # Item must allow batches
    it = frappe.get_doc("Item", item_code)
    dirty_item = False
    if not cint(it.has_batch_no):
        it.has_batch_no = 1
        dirty_item = True
    if expiry_date and not cint(it.has_expiry_date):
        it.has_expiry_date = 1
        dirty_item = True
    if mrp is not None and flt(mrp) > 0:
        it.hec_item_mrp = flt(mrp)
        dirty_item = True
    if dirty_item:
        it.save(ignore_permissions=True)

    batch_id = sanitize_hec_batch_no(raw_batch)
    created = False
    if frappe.db.exists("Batch", batch_id):
        b = frappe.get_doc("Batch", batch_id)
        if b.item and b.item != item_code:
            frappe.throw(
                _("Batch {0} already belongs to Item {1}").format(batch_id, b.item)
            )
        if not b.item:
            b.item = item_code
        if expiry_date:
            b.expiry_date = expiry_date
        if mrp is not None and flt(mrp) >= 0 and b.meta.has_field("hec_mrp"):
            b.hec_mrp = flt(mrp)
        if purchase_rate is not None and flt(purchase_rate) >= 0 and b.meta.has_field("hec_purchase_rate"):
            b.hec_purchase_rate = flt(purchase_rate)
        b.save(ignore_permissions=True)
    else:
        doc = {
            "doctype": "Batch",
            "batch_id": batch_id,
            "item": item_code,
        }
        # Some sites use `name` = batch_id via autoname
        if expiry_date:
            doc["expiry_date"] = expiry_date
        b = frappe.get_doc(doc)
        if mrp is not None and flt(mrp) >= 0 and b.meta.has_field("hec_mrp"):
            b.hec_mrp = flt(mrp)
        if purchase_rate is not None and flt(purchase_rate) >= 0 and b.meta.has_field("hec_purchase_rate"):
            b.hec_purchase_rate = flt(purchase_rate)
        b.insert(ignore_permissions=True)
        batch_id = b.name
        created = True

    if mrp is not None and flt(mrp) >= 0:
        _upsert_item_price(item_code, flt(mrp), selling=1, batch_no=batch_id)
        _upsert_item_price(item_code, flt(mrp), selling=1)  # item-level standard selling
    if purchase_rate is not None and flt(purchase_rate) >= 0:
        _upsert_item_price(item_code, flt(purchase_rate), buying=1, batch_no=batch_id)

    return {
        "ok": True,
        "created": created,
        "batch_no": batch_id,
        "item_code": item_code,
        "expiry_date": frappe.db.get_value("Batch", batch_id, "expiry_date"),
        "hec_item_mrp": _batch_mrp(item_code, batch_id),
        "last_purchase_rate": _last_purchase_rate(item_code, batch_id)
        or flt(purchase_rate or 0)
        or flt(frappe.db.get_value("Batch", batch_id, "hec_purchase_rate") or 0),
        "sanitized_from": raw_batch if raw_batch != batch_id else None,
    }


def get_hec_batch_line_defaults(batch_no=None, item_code=None):
    """Defaults for Marg row keyed by batch (preferred) or item."""
    batch_no = (batch_no or "").strip()
    item_code = (item_code or "").strip()
    out = {
        "hec_batch_no": batch_no or "",
        "item_code": item_code or "",
        "item_name": "",
        "hec_expiry_date": "",
        "hec_item_mrp": 0.0,
        "rate": 0.0,
        "last_purchase_rate": 0.0,
        "selling_rate": 0.0,
        "hec_pack_size": "",
        "hec_gst_rate": 0.0,
        "stock_uom": "Nos",
    }
    if batch_no and frappe.db.exists("Batch", batch_no):
        b = frappe.get_doc("Batch", batch_no)
        item_code = b.item or item_code
        out["hec_batch_no"] = b.name
        out["item_code"] = item_code
        out["hec_expiry_date"] = str(b.expiry_date) if b.expiry_date else ""
        if b.meta.has_field("hec_mrp"):
            out["hec_item_mrp"] = flt(b.hec_mrp or 0)
        if b.meta.has_field("hec_purchase_rate"):
            out["last_purchase_rate"] = flt(b.hec_purchase_rate or 0)
    if item_code and frappe.db.exists("Item", item_code):
        d = get_hec_pharma_item_defaults(item_code)
        out["item_code"] = d.get("item_code") or item_code
        out["item_name"] = d.get("item_name") or item_code
        out["hec_pack_size"] = d.get("hec_pack_size") or ""
        out["hec_gst_rate"] = flt(d.get("hec_gst_rate") or 0)
        out["stock_uom"] = d.get("stock_uom") or "Nos"
        if not out["hec_item_mrp"]:
            out["hec_item_mrp"] = _batch_mrp(item_code, out["hec_batch_no"] or None)
        purchase = _last_purchase_rate(item_code, out["hec_batch_no"] or None)
        if purchase:
            out["last_purchase_rate"] = purchase
        out["selling_rate"] = out["hec_item_mrp"] or flt(d.get("rate") or 0)
        # Default trade rate: last purchase if any, else selling/MRP
        out["rate"] = out["last_purchase_rate"] or out["selling_rate"] or flt(d.get("rate") or 0)
    return out


def search_hec_marg_catalog(txt=None, search_by=None, limit=20):
    """Typeahead: Batch first, then Item. Returns MRP + last purchase rate per row."""
    ensure_phase69_custom_fields()
    txt = (txt or "").strip()
    search_by = (search_by or "batch").strip().lower()
    limit = cint(limit) or 20
    results = []
    like = f"%{txt}%"

    if search_by in ("batch", "both", "") and txt:
        has_mrp = frappe.get_meta("Batch").has_field("hec_mrp")
        has_pr = frappe.get_meta("Batch").has_field("hec_purchase_rate")
        mrp_col = "b.hec_mrp" if has_mrp else "0"
        pr_col = "b.hec_purchase_rate" if has_pr else "0"
        batches = frappe.db.sql(
            f"""
            select b.name as batch_no, b.item as item_code, b.expiry_date,
                   {mrp_col} as hec_mrp, {pr_col} as hec_purchase_rate,
                   i.item_name, i.hec_pack_size, i.hec_gst_rate, i.stock_uom
            from `tabBatch` b
            left join `tabItem` i on i.name = b.item
            where b.name like %(like)s
               or ifnull(b.batch_id,'') like %(like)s
            order by b.modified desc
            limit %(limit)s
            """,
            {"like": like, "limit": limit},
            as_dict=True,
        )
        for b in batches:
            mrp = flt(b.hec_mrp or 0) or _batch_mrp(b.item_code, b.batch_no)
            purchase = flt(b.hec_purchase_rate or 0) or _last_purchase_rate(b.item_code, b.batch_no)
            results.append(
                {
                    "hec_batch_no": b.batch_no,
                    "item_code": b.item_code,
                    "item_name": b.item_name or b.item_code,
                    "hec_expiry_date": str(b.expiry_date) if b.expiry_date else "",
                    "hec_item_mrp": mrp,
                    "last_purchase_rate": purchase,
                    "rate": purchase or mrp,
                    "hec_pack_size": b.hec_pack_size or "",
                    "hec_gst_rate": flt(b.hec_gst_rate or 0),
                    "stock_uom": b.stock_uom or "Nos",
                    "source": "batch",
                }
            )

    if search_by in ("item", "both") and txt:
        items = frappe.db.sql(
            """
            select name, item_name, hec_pack_size, hec_item_mrp, hec_gst_rate, stock_uom
            from `tabItem`
            where disabled = 0 and (name like %(like)s or item_name like %(like)s)
            order by modified desc
            limit %(limit)s
            """,
            {"like": like, "limit": limit},
            as_dict=True,
        )
        seen_items = {r["item_code"] for r in results if r.get("item_code")}
        for it in items:
            if it.name in seen_items and search_by == "both":
                continue
            mrp = _batch_mrp(it.name, None) or flt(it.hec_item_mrp or 0)
            purchase = _last_purchase_rate(it.name, None)
            latest_batch = frappe.db.get_value(
                "Batch", {"item": it.name}, "name", order_by="modified desc"
            )
            exp = ""
            if latest_batch:
                exp_val = frappe.db.get_value("Batch", latest_batch, "expiry_date")
                exp = str(exp_val) if exp_val else ""
            results.append(
                {
                    "hec_batch_no": latest_batch or "",
                    "item_code": it.name,
                    "item_name": it.item_name or it.name,
                    "hec_expiry_date": exp,
                    "hec_item_mrp": mrp,
                    "last_purchase_rate": purchase,
                    "rate": purchase or mrp,
                    "hec_pack_size": it.hec_pack_size or "",
                    "hec_gst_rate": flt(it.hec_gst_rate or 0),
                    "stock_uom": it.stock_uom or "Nos",
                    "source": "item",
                }
            )
    return results[:limit]


def ensure_hec_item_with_batch(data=None):
    """Create/update Item + Batch + MRP (selling) + purchase rate + expiry in one step."""
    if isinstance(data, str):
        data = json.loads(data or "{}")
    data = data or {}
    raw_item = (data.get("item_code") or "").strip()
    raw_batch = (data.get("hec_batch_no") or data.get("batch_no") or "").strip()
    if not raw_batch:
        frappe.throw(_("Batch No is required"))
    if not raw_item:
        frappe.throw(_("Item is required"))

    code, display_name = sanitize_hec_item_code(raw_item, data.get("item_name"))
    batch_id = sanitize_hec_batch_no(raw_batch)
    mrp = data.get("hec_item_mrp")
    if mrp is None:
        mrp = data.get("mrp")
    purchase_rate = data.get("rate")
    if purchase_rate is None:
        purchase_rate = data.get("purchase_rate")

    # Fast path: existing item+batch — only patch fields that actually changed
    item_exists = frappe.db.exists("Item", code)
    batch_exists = frappe.db.exists("Batch", batch_id)
    if item_exists and batch_exists:
        exp_in = data.get("hec_expiry_date") or data.get("expiry_date")
        b = frappe.db.get_value(
            "Batch",
            batch_id,
            ["item", "expiry_date", "hec_mrp", "hec_purchase_rate"],
            as_dict=True,
        ) or frappe._dict()
        if b.item and b.item != code:
            frappe.throw(_("Batch {0} already belongs to Item {1}").format(batch_id, b.item))
        dirty = False
        updates = {}
        if exp_in and str(b.expiry_date or "")[:10] != str(exp_in)[:10]:
            updates["expiry_date"] = exp_in
            dirty = True
        if mrp is not None and flt(mrp) > 0 and flt(b.hec_mrp or 0) != flt(mrp):
            if frappe.get_meta("Batch").has_field("hec_mrp"):
                updates["hec_mrp"] = flt(mrp)
                dirty = True
        if purchase_rate is not None and flt(purchase_rate) > 0 and flt(b.hec_purchase_rate or 0) != flt(
            purchase_rate
        ):
            if frappe.get_meta("Batch").has_field("hec_purchase_rate"):
                updates["hec_purchase_rate"] = flt(purchase_rate)
                dirty = True
        if dirty and updates:
            frappe.db.set_value("Batch", batch_id, updates, update_modified=False)
            if mrp is not None and flt(mrp) > 0:
                _upsert_item_price(code, flt(mrp), selling=1, batch_no=batch_id)
            if purchase_rate is not None and flt(purchase_rate) > 0:
                _upsert_item_price(code, flt(purchase_rate), buying=1, batch_no=batch_id)
        defaults = get_hec_batch_line_defaults(batch_id, code)
        if purchase_rate is not None and flt(purchase_rate) > 0:
            defaults["rate"] = flt(purchase_rate)
            defaults["last_purchase_rate"] = flt(purchase_rate)
        elif not flt(defaults.get("rate")) and flt(defaults.get("last_purchase_rate")):
            defaults["rate"] = defaults["last_purchase_rate"]
        if mrp is not None and flt(mrp) > 0:
            defaults["hec_item_mrp"] = flt(mrp)
        return {
            "ok": True,
            "item": {"ok": True, "created": False, "item_code": code},
            "batch": {"ok": True, "created": False, "batch_no": batch_id, "patched": dirty},
            "item_code": code,
            "hec_batch_no": batch_id,
            "sanitized_from": raw_item if raw_item != code else None,
            "defaults": defaults,
            "fast_path": True,
        }

    item_out = upsert_hec_pharma_item(
        {
            "item_code": code,
            "item_name": display_name or code,
            "stock_uom": data.get("stock_uom") or data.get("uom") or "Nos",
            "price_list_rate": flt(mrp) if mrp is not None else flt(purchase_rate or 0),
            "hec_pack_size": data.get("hec_pack_size"),
            "hec_item_mrp": mrp,
            "hec_hsn_sac": data.get("hec_hsn_sac"),
            "hec_gst_rate": data.get("hec_gst_rate"),
            "has_batch_no": 1,
            "has_expiry_date": 1,
            "is_stock_item": data.get("is_stock_item", 1),
            "is_purchase_item": 1,
            "is_sales_item": 1,
        }
    )
    batch_out = ensure_hec_batch(
        item_code=code,
        batch_no=raw_batch,
        expiry_date=data.get("hec_expiry_date") or data.get("expiry_date"),
        mrp=mrp,
        purchase_rate=purchase_rate,
    )
    defaults = get_hec_batch_line_defaults(batch_out["batch_no"], code)
    if mrp is not None and flt(mrp) > 0:
        defaults["hec_item_mrp"] = flt(mrp)
    if purchase_rate is not None and flt(purchase_rate) > 0:
        defaults["rate"] = flt(purchase_rate)
        defaults["last_purchase_rate"] = flt(purchase_rate)
    elif defaults.get("last_purchase_rate"):
        defaults["rate"] = defaults["last_purchase_rate"]
    return {
        "ok": True,
        "item": item_out,
        "batch": batch_out,
        "item_code": code,
        "hec_batch_no": batch_out["batch_no"],
        "sanitized_from": item_out.get("sanitized_from") or (raw_item if raw_item != code else None),
        "defaults": defaults,
    }


def _item_total_stock(item_code):
    if not item_code:
        return 0.0
    val = frappe.db.sql(
        "select sum(actual_qty) from `tabBin` where item_code=%s",
        item_code,
    )
    return flt(val[0][0] if val else 0)


def _batch_stock_qty(item_code, batch_no):
    if not item_code or not batch_no:
        return 0.0
    if frappe.db.exists("DocType", "Batch") and frappe.get_meta("Batch").has_field("batch_qty"):
        bq = frappe.db.get_value("Batch", batch_no, "batch_qty")
        if bq is not None:
            return flt(bq)
    val = frappe.db.sql(
        """
        select sum(actual_qty) from `tabStock Ledger Entry`
        where item_code=%s and batch_no=%s and ifnull(is_cancelled,0)=0
        """,
        (item_code, batch_no),
    )
    return flt(val[0][0] if val else 0)


def get_hec_party_history(party=None, direction="purchase"):
    """Supplier/Customer context for Marg-style entry header."""
    from frappe.utils import date_diff, getdate

    direction = (direction or "purchase").lower()
    party = (party or "").strip()
    if not party:
        return {"ok": False, "message": _("party is required")}

    doctype = "Supplier" if direction == "purchase" else "Customer"
    if not frappe.db.exists(doctype, party):
        return {"ok": False, "message": _("{0} {1} not found").format(doctype, party)}

    doc = frappe.get_doc(doctype, party)
    party_type = doctype
    balance = 0.0
    try:
        bal = frappe.db.sql(
            """
            select sum(debit) - sum(credit)
            from `tabGL Entry`
            where party_type=%s and party=%s and ifnull(is_cancelled,0)=0
            """,
            (party_type, party),
        )
        balance = flt(bal[0][0] if bal else 0)
    except Exception:
        balance = 0.0

    gstin = ""
    if doc.meta.has_field("gstin"):
        gstin = getattr(doc, "gstin", None) or ""
    dl_no = ""
    for fld in ("hec_dl_no", "drug_license_number", "custom_dl_no"):
        if doc.meta.has_field(fld):
            dl_no = getattr(doc, fld, None) or ""
            if dl_no:
                break

    addr_name = frappe.db.get_value(
        "Dynamic Link",
        {"link_doctype": doctype, "link_name": party, "parenttype": "Address"},
        "parent",
    )
    address = {}
    if addr_name:
        address = _safe_get(
            "Address",
            addr_name,
            ["address_line1", "address_line2", "city", "state", "pincode", "phone", "gstin"],
        ) or {}
        if address.get("gstin") and not gstin:
            gstin = address.get("gstin")

    inv_dt = "Purchase Invoice" if direction == "purchase" else "Sales Invoice"
    party_field = "supplier" if direction == "purchase" else "customer"
    bills = frappe.get_all(
        inv_dt,
        filters={party_field: party, "docstatus": ["<", 2]},
        fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"],
        order_by="posting_date desc",
        limit_page_length=10,
    )
    today = getdate(nowdate())
    bill_rows = []
    for b in bills:
        days = date_diff(today, getdate(b.posting_date)) if b.posting_date else 0
        bill_rows.append(
            {
                "bill": b.name,
                "date": str(b.posting_date) if b.posting_date else "",
                "amount": flt(b.grand_total),
                "outstanding": flt(b.outstanding_amount),
                "days": days,
                "status": b.status,
            }
        )

    last_purc = bills[0] if bills else None
    return {
        "ok": True,
        "party": party,
        "party_name": doc.supplier_name if doctype == "Supplier" else doc.customer_name,
        "doctype": doctype,
        "gstin": gstin,
        "dl_no": dl_no,
        "balance": balance,
        "address": {
            "line1": address.get("address_line1") or "",
            "line2": address.get("address_line2") or "",
            "city": address.get("city") or "",
            "state": address.get("state") or "",
            "pincode": address.get("pincode") or "",
            "phone": address.get("phone") or "",
        },
        "bills": bill_rows,
        "bill_count": len(bill_rows),
        "last_purchase": {
            "name": last_purc.name if last_purc else "",
            "date": str(last_purc.posting_date) if last_purc and last_purc.posting_date else "",
            "amount": flt(last_purc.grand_total) if last_purc else 0,
        },
    }


def search_hec_items(txt=None, limit=25):
    """Marg ITEMS popup: description, packing, stock, MRP, last purchase rate."""
    ensure_phase69_custom_fields()
    txt = (txt or "").strip()
    limit = cint(limit) or 25
    like = f"%{txt}%" if txt else "%"
    items = frappe.db.sql(
        """
        select name, item_name, hec_pack_size, hec_item_mrp, hec_gst_rate, stock_uom, has_batch_no
        from `tabItem`
        where disabled = 0
          and (name like %(like)s or item_name like %(like)s or ifnull(hec_pack_size,'') like %(like)s)
        order by modified desc
        limit %(limit)s
        """,
        {"like": like, "limit": limit},
        as_dict=True,
    )
    out = []
    for it in items:
        mrp = _batch_mrp(it.name, None) or flt(it.hec_item_mrp or 0)
        purchase = _last_purchase_rate(it.name, None)
        stock = _item_total_stock(it.name)
        out.append(
            {
                "item_code": it.name,
                "item_name": it.item_name or it.name,
                "hec_pack_size": it.hec_pack_size or "",
                "stock": stock,
                "hec_item_mrp": mrp,
                "selling_rate": mrp,
                "last_purchase_rate": purchase,
                "rate": purchase or mrp,
                "hec_gst_rate": flt(it.hec_gst_rate or 0),
                "stock_uom": it.stock_uom or "Nos",
                "has_batch_no": cint(it.has_batch_no),
            }
        )
    return out


def list_item_batches(item_code=None, limit=40):
    """Marg AVAILABLE STOCKS popup for an item."""
    ensure_phase69_custom_fields()
    item_code = (item_code or "").strip()
    if not item_code:
        return []
    limit = cint(limit) or 40
    has_mrp = frappe.get_meta("Batch").has_field("hec_mrp")
    has_pr = frappe.get_meta("Batch").has_field("hec_purchase_rate")
    mrp_col = "hec_mrp" if has_mrp else "0"
    pr_col = "hec_purchase_rate" if has_pr else "0"
    batches = frappe.db.sql(
        f"""
        select name as batch_no, expiry_date, {mrp_col} as hec_mrp, {pr_col} as hec_purchase_rate
        from `tabBatch`
        where item=%(item)s
        order by modified desc
        limit %(limit)s
        """,
        {"item": item_code, "limit": limit},
        as_dict=True,
    )
    out = []
    for b in batches:
        mrp = flt(b.hec_mrp or 0) or _batch_mrp(item_code, b.batch_no)
        purchase = flt(b.hec_purchase_rate or 0) or _last_purchase_rate(item_code, b.batch_no)
        out.append(
            {
                "hec_batch_no": b.batch_no,
                "item_code": item_code,
                "hec_expiry_date": str(b.expiry_date) if b.expiry_date else "",
                "stock": _batch_stock_qty(item_code, b.batch_no),
                "hec_item_mrp": mrp,
                "selling_rate": mrp,
                "last_purchase_rate": purchase,
                "rate": purchase or mrp,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Invoice create from Marg grid
# ---------------------------------------------------------------------------


def _company():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import _company_abbr

    return _company_abbr()[0]


def _expand_grid_lines(items):
    """
    Marg grid row → paid line (with hec_free_qty) + optional FOC stock line.
    Also supports lot_scheme 9:1 when free_qty not set.
    """
    from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import split_lot_qty

    if isinstance(items, str):
        items = json.loads(items or "[]")
    out = []
    for raw in items or []:
        row = dict(raw)
        code = row.get("item_code")
        if not code:
            continue
        qty = flt(row.get("qty") or 0)
        free = flt(row.get("free_qty") or row.get("hec_free_qty") or 0)
        scheme = row.get("lot_scheme") or row.get("volume_scheme")
        if scheme and free <= 0 and qty > 0:
            paid, free = split_lot_qty(qty, scheme)
            qty = paid
        rate = flt(row.get("rate") or 0)
        if rate <= 0 and code:
            rate = _last_purchase_rate(code, row.get("hec_batch_no") or row.get("batch_no"))
            if rate <= 0:
                rate = _batch_mrp(code, row.get("hec_batch_no") or row.get("batch_no"))
        plr = flt(row.get("price_list_rate") or rate)
        gst = flt(row.get("hec_gst_rate") or row.get("gst_rate") or 0)
        sgst = flt(row.get("hec_sgst_rate") if row.get("hec_sgst_rate") is not None else (gst / 2 if gst else 0))
        cgst = flt(row.get("hec_cgst_rate") if row.get("hec_cgst_rate") is not None else (gst / 2 if gst else 0))
        igst = flt(row.get("hec_igst_rate") or 0)
        meta = {
            "hec_pack_size": row.get("hec_pack_size") or row.get("pack_size") or "",
            "hec_batch_no": row.get("hec_batch_no") or row.get("batch_no") or "",
            "hec_expiry_date": row.get("hec_expiry_date") or row.get("expiry_date"),
            "hec_item_mrp": flt(row.get("hec_item_mrp") or row.get("mrp") or 0),
            "hec_sgst_rate": sgst,
            "hec_cgst_rate": cgst,
            "hec_igst_rate": igst,
            "warehouse": row.get("warehouse"),
            "notes": row.get("notes"),
        }
        if qty > 0:
            out.append(
                {
                    "item_code": code,
                    "qty": qty,
                    "rate": rate,
                    "price_list_rate": plr,
                    "discount_percentage": flt(row.get("discount_percentage") or 0),
                    "discount_amount": flt(row.get("discount_amount") or 0),
                    "is_free_item": 0,
                    "hec_free_qty": free,
                    **meta,
                }
            )
        if free > 0:
            out.append(
                {
                    "item_code": code,
                    "qty": free,
                    "rate": rate,
                    "price_list_rate": plr or rate,
                    "discount_percentage": 100,
                    "discount_amount": 0,
                    "is_free_item": 1,
                    "hec_free_qty": 0,
                    **meta,
                }
            )
    return out


def _apply_line_meta(doc, decorated_rows):
    for idx, row in enumerate(decorated_rows):
        if idx >= len(doc.items):
            break
        item = doc.items[idx]
        for key in (
            "hec_free_qty",
            "hec_pack_size",
            "hec_batch_no",
            "hec_expiry_date",
            "hec_item_mrp",
            "hec_sgst_rate",
            "hec_cgst_rate",
            "hec_igst_rate",
        ):
            if key in row and hasattr(item, key):
                setattr(item, key, row.get(key))
        if cint(row.get("is_free_item")):
            item.is_free_item = 1
            item.discount_percentage = 100


def _apply_transport(doc, header):
    header = header or {}
    for key in ("hec_transport", "hec_lr_no", "hec_lr_date", "hec_cases", "hec_eway_bill"):
        if key in header and hasattr(doc, key):
            setattr(doc, key, header.get(key))


def create_hec_pharma_invoice(data=None):
    """
    Create Sales or Purchase Invoice from Marg-style payload:
    {
      direction: "sales"|"purchase",
      party: customer/supplier name,
      items: [{item_code, qty, free_qty, pack, batch, expiry, mrp, rate, discount_percentage, gst_rate}],
      invoice_discount: {...},
      transport: {...},
      submit: 1/0,
      update_stock: 1/0
    }
    """
    from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
        _decorate_invoice_items_with_itemwise_tax,
        _default_cost_center,
        _default_income_account,
        _default_warehouse,
        _restore_item_taxes,
        _serialize_invoice_tax_breakup,
        _swap_item_taxes_for_purchase,
        apply_hsn_to_item,
        build_tabulated_taxes_from_templates,
        ensure_item_tax_fields,
        ensure_purchase_gst_masters,
        ensure_sales_gst_masters,
        seed_hsn_rules,
    )

    if isinstance(data, str):
        data = json.loads(data or "{}")
    data = data or {}
    ensure_phase69_custom_fields()
    # Skip heavy GST master seeding on every bill — only once per request
    if not getattr(frappe.local, "hec_gst_masters_ready", False):
        ensure_item_tax_fields()
        seed_hsn_rules()
        frappe.local.hec_gst_masters_ready = True

    direction = (data.get("direction") or "sales").lower()
    company = data.get("company") or _company()
    if not company:
        frappe.throw(_("No company configured"))

    items = _expand_grid_lines(data.get("items") or [])
    if not items:
        frappe.throw(_("At least one item is required"))

    for row in items:
        if row.get("hec_batch_no"):
            ensured = ensure_hec_item_with_batch(
                {
                    "item_code": row["item_code"],
                    "item_name": row.get("item_name") or row["item_code"],
                    "hec_batch_no": row.get("hec_batch_no"),
                    "hec_expiry_date": row.get("hec_expiry_date"),
                    "hec_item_mrp": row.get("hec_item_mrp"),
                    "rate": row.get("rate"),
                    "hec_pack_size": row.get("hec_pack_size"),
                    "hec_gst_rate": row.get("hec_gst_rate") or row.get("gst_rate"),
                }
            )
            row["item_code"] = ensured.get("item_code") or row["item_code"]
            row["hec_batch_no"] = ensured.get("hec_batch_no") or row.get("hec_batch_no")
        if not frappe.db.exists("Item", row["item_code"]):
            frappe.throw(_("Item {0} not found").format(row["item_code"]))
        # Only apply HSN when missing (avoid slow rewrite every save)
        if not frappe.db.get_value("Item", row["item_code"], "hec_hsn_sac"):
            apply_hsn_to_item(row["item_code"], force=False)
        row["_is_stock"] = cint(frappe.db.get_value("Item", row["item_code"], "is_stock_item"))
        flags = {}
        if row.get("hec_batch_no") and not cint(frappe.db.get_value("Item", row["item_code"], "has_batch_no")):
            flags["has_batch_no"] = 1
        if row.get("hec_expiry_date") and not cint(
            frappe.db.get_value("Item", row["item_code"], "has_expiry_date")
        ):
            flags["has_expiry_date"] = 1
        if flags:
            frappe.db.set_value("Item", row["item_code"], flags, update_modified=False)

    warehouse = data.get("warehouse") or _default_warehouse(company)
    cost_center = _default_cost_center(company)
    inv_disc = data.get("invoice_discount") or {}
    transport = data.get("transport") or {}
    do_submit = cint(data.get("submit", 0))

    if direction == "purchase":
        if not getattr(frappe.local, "hec_purchase_gst_ready", False):
            ensure_purchase_gst_masters()
            frappe.local.hec_purchase_gst_ready = True
        party = data.get("party") or data.get("supplier")
        if not party:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
                _ensure_smoke_supplier,
            )

            party = _ensure_smoke_supplier(company)
        for row in items:
            frappe.db.set_value(
                "Item",
                row["item_code"],
                {"is_purchase_item": 1, "disabled": 0},
                update_modified=False,
            )
            if not row.get("warehouse"):
                row["warehouse"] = warehouse

        decorated, templates_used = _decorate_invoice_items_with_itemwise_tax(
            company, items, direction="purchase"
        )
        tabulated = build_tabulated_taxes_from_templates(company, templates_used)
        restore = _swap_item_taxes_for_purchase([r["item_code"] for r in decorated], company)
        try:
            pi_items = []
            for row in decorated:
                line = {
                    "item_code": row["item_code"],
                    "qty": flt(row["qty"]),
                    "rate": flt(row["rate"]),
                    "price_list_rate": flt(row.get("price_list_rate") or row["rate"]),
                    "warehouse": row.get("warehouse") if row.get("_is_stock") else None,
                    "cost_center": cost_center,
                    "discount_percentage": flt(row.get("discount_percentage") or 0),
                    "discount_amount": flt(row.get("discount_amount") or 0),
                    "is_free_item": cint(row.get("is_free_item") or 0),
                    "item_tax_template": row.get("item_tax_template"),
                    "item_tax_rate": row.get("item_tax_rate"),
                    "hec_free_qty": flt(row.get("hec_free_qty") or 0),
                    "hec_pack_size": row.get("hec_pack_size"),
                    "hec_batch_no": row.get("hec_batch_no"),
                    "hec_expiry_date": row.get("hec_expiry_date"),
                    "hec_item_mrp": flt(row.get("hec_item_mrp") or 0),
                    "hec_sgst_rate": flt(row.get("hec_sgst_rate") or 0),
                    "hec_cgst_rate": flt(row.get("hec_cgst_rate") or 0),
                    "hec_igst_rate": flt(row.get("hec_igst_rate") or 0),
                }
                if cint(row.get("is_free_item")):
                    line["discount_percentage"] = 100
                if row.get("hec_batch_no") and frappe.get_meta("Purchase Invoice Item").has_field("batch_no"):
                    line["batch_no"] = row.get("hec_batch_no")
                pi_items.append(line)

            any_stock = any(r.get("_is_stock") for r in decorated)
            # Marg-style: update stock when warehouse available unless explicitly disabled
            upd_stock = data.get("update_stock")
            if upd_stock is None:
                upd_stock = 1 if (any_stock and warehouse) else 0
            payload = {
                "doctype": "Purchase Invoice",
                "supplier": party,
                "company": company,
                "posting_date": data.get("posting_date") or data.get("bill_date") or nowdate(),
                "bill_date": data.get("bill_date") or data.get("posting_date") or nowdate(),
                "due_date": data.get("due_date") or nowdate(),
                "update_stock": cint(upd_stock),
                "items": pi_items,
                "taxes": tabulated,
            }
            if data.get("bill_no"):
                payload["bill_no"] = data.get("bill_no")
            if data.get("hec_bill_type") and frappe.get_meta("Purchase Invoice").has_field("hec_bill_type"):
                payload["hec_bill_type"] = data.get("hec_bill_type")
            if inv_disc.get("additional_discount_percentage") or inv_disc.get("discount_amount"):
                payload["apply_discount_on"] = inv_disc.get("apply_discount_on") or "Net Total"
                if inv_disc.get("additional_discount_percentage"):
                    payload["additional_discount_percentage"] = flt(inv_disc["additional_discount_percentage"])
                if inv_disc.get("discount_amount"):
                    payload["discount_amount"] = flt(inv_disc["discount_amount"])

            pi = frappe.get_doc(payload)
            _apply_transport(pi, transport)
            pi.insert(ignore_permissions=True)
            _apply_line_meta(pi, decorated)
            has_free = any(cint(r.get("is_free_item")) for r in decorated)
            if has_free:
                for idx, row in enumerate(decorated):
                    pi.items[idx].item_tax_template = row.get("item_tax_template")
                    pi.items[idx].item_tax_rate = row.get("item_tax_rate")
                    if cint(row.get("is_free_item")):
                        pi.items[idx].discount_percentage = 100
                        pi.items[idx].is_free_item = 1
                pi.set("taxes", [])
                for tax in tabulated:
                    pi.append("taxes", tax)
                pi.calculate_taxes_and_totals()
                for item in pi.items:
                    if cint(item.is_free_item) and flt(item.amount):
                        item.discount_percentage = 100
                pi.calculate_taxes_and_totals()
                pi.save(ignore_permissions=True)
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
            else:
                for idx, row in enumerate(decorated):
                    pi.items[idx].item_tax_template = row.get("item_tax_template")
                    pi.items[idx].item_tax_rate = row.get("item_tax_rate")
                pi.set("taxes", [])
                for tax in tabulated:
                    pi.append("taxes", tax)
                pi.calculate_taxes_and_totals()
                pi.save(ignore_permissions=True)
            if do_submit:
                pi.submit()
            breakup = _serialize_invoice_tax_breakup(pi)
            return {
                "ok": True,
                "direction": "purchase",
                "invoice": pi.name,
                "doctype": "Purchase Invoice",
                "print_format": PRINT_PINV,
                "docstatus": pi.docstatus,
                **breakup,
            }
        finally:
            _restore_item_taxes(restore)

    # Sales
    ensure_sales_gst_masters()
    party = data.get("party") or data.get("customer")
    if not party:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
            _ensure_smoke_customer,
        )

        party = _ensure_smoke_customer(company)
    income = _default_income_account(company)
    for row in items:
        frappe.db.set_value(
            "Item",
            row["item_code"],
            {"is_sales_item": 1, "disabled": 0},
            update_modified=False,
        )

    decorated, templates_used = _decorate_invoice_items_with_itemwise_tax(
        company, items, direction="sales"
    )
    tabulated = build_tabulated_taxes_from_templates(company, templates_used)
    si_items = []
    for row in decorated:
        line = {
            "item_code": row["item_code"],
            "qty": flt(row["qty"]),
            "rate": flt(row["rate"]),
            "price_list_rate": flt(row.get("price_list_rate") or row["rate"]),
            "cost_center": cost_center,
            "discount_percentage": flt(row.get("discount_percentage") or 0),
            "discount_amount": flt(row.get("discount_amount") or 0),
            "is_free_item": cint(row.get("is_free_item") or 0),
            "item_tax_template": row.get("item_tax_template"),
            "item_tax_rate": row.get("item_tax_rate"),
            "hec_free_qty": flt(row.get("hec_free_qty") or 0),
            "hec_pack_size": row.get("hec_pack_size"),
            "hec_batch_no": row.get("hec_batch_no"),
            "hec_expiry_date": row.get("hec_expiry_date"),
            "hec_item_mrp": flt(row.get("hec_item_mrp") or 0),
            "hec_sgst_rate": flt(row.get("hec_sgst_rate") or 0),
            "hec_cgst_rate": flt(row.get("hec_cgst_rate") or 0),
            "hec_igst_rate": flt(row.get("hec_igst_rate") or 0),
        }
        if cint(row.get("is_free_item")):
            line["discount_percentage"] = 100
        if income and not cint(frappe.db.get_value("Item", row["item_code"], "is_stock_item")):
            line["income_account"] = income
        if cint(data.get("update_stock")) and row.get("_is_stock"):
            line["warehouse"] = row.get("warehouse") or warehouse
        si_items.append(line)

    payload = {
        "doctype": "Sales Invoice",
        "customer": party,
        "company": company,
        "posting_date": data.get("posting_date") or nowdate(),
        "due_date": data.get("due_date") or nowdate(),
        "update_stock": cint(data.get("update_stock") or 0),
        "items": si_items,
        "taxes": tabulated,
    }
    if inv_disc.get("additional_discount_percentage") or inv_disc.get("discount_amount"):
        payload["apply_discount_on"] = inv_disc.get("apply_discount_on") or "Net Total"
        if inv_disc.get("additional_discount_percentage"):
            payload["additional_discount_percentage"] = flt(inv_disc["additional_discount_percentage"])
        if inv_disc.get("discount_amount"):
            payload["discount_amount"] = flt(inv_disc["discount_amount"])

    si = frappe.get_doc(payload)
    _apply_transport(si, transport)
    si.insert(ignore_permissions=True)
    _apply_line_meta(si, decorated)
    for idx, row in enumerate(decorated):
        si.items[idx].item_tax_template = row.get("item_tax_template")
        si.items[idx].item_tax_rate = row.get("item_tax_rate")
        if cint(row.get("is_free_item")):
            si.items[idx].discount_percentage = 100
            si.items[idx].is_free_item = 1
    si.set("taxes", [])
    for tax in tabulated:
        si.append("taxes", tax)
    si.calculate_taxes_and_totals()
    for item in si.items:
        if cint(item.is_free_item) and flt(item.amount):
            item.discount_percentage = 100
    si.calculate_taxes_and_totals()
    si.save(ignore_permissions=True)
    if do_submit:
        si.submit()
    breakup = _serialize_invoice_tax_breakup(si)
    return {
        "ok": True,
        "direction": "sales",
        "invoice": si.name,
        "doctype": "Sales Invoice",
        "print_format": PRINT_SI,
        "docstatus": si.docstatus,
        **breakup,
    }


# ---------------------------------------------------------------------------
# Whitelisted API helpers (called from api.py / Desk)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def api_upsert_hec_pharma_item(data=None, body=None):
    payload = data or body
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    out = upsert_hec_pharma_item(payload)
    frappe.db.commit()
    return out


@frappe.whitelist()
def api_ensure_hec_item(data=None, body=None):
    """Ensure Item exists; if batch provided, also create Batch + MRP + expiry + rates."""
    payload = data or body
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    payload = payload or {}
    if (payload.get("hec_batch_no") or payload.get("batch_no") or "").strip():
        out = ensure_hec_item_with_batch(payload)
        frappe.db.commit()
        return out
    raw = (payload.get("item_code") or "").strip()
    if not raw:
        frappe.throw(_("item_code is required"))
    code, display_name = sanitize_hec_item_code(raw, payload.get("item_name"))
    if not frappe.db.exists("Item", code):
        out = upsert_hec_pharma_item(
            {
                "item_code": code,
                "item_name": display_name or code,
                "stock_uom": payload.get("stock_uom") or payload.get("uom") or "Nos",
                "price_list_rate": payload.get("price_list_rate")
                or payload.get("hec_item_mrp")
                or payload.get("rate")
                or 0,
                "hec_pack_size": payload.get("hec_pack_size"),
                "hec_item_mrp": payload.get("hec_item_mrp"),
                "hec_hsn_sac": payload.get("hec_hsn_sac"),
                "hec_gst_rate": payload.get("hec_gst_rate"),
                "has_batch_no": payload.get("has_batch_no", 1),
                "has_expiry_date": payload.get("has_expiry_date", 1),
                "is_stock_item": payload.get("is_stock_item", 1),
                "is_purchase_item": 1,
                "is_sales_item": 1,
            }
        )
        frappe.db.commit()
        out["sanitized_from"] = raw if raw != code else None
        return out
    it = frappe.get_doc("Item", code)
    dirty = False
    if not (it.item_name or "").strip():
        it.item_name = display_name or code
        dirty = True
    if not it.stock_uom:
        it.stock_uom = payload.get("stock_uom") or "Nos"
        it.sales_uom = it.stock_uom
        it.purchase_uom = it.stock_uom
        dirty = True
    if dirty:
        it.save(ignore_permissions=True)
        frappe.db.commit()
    defaults = get_hec_pharma_item_defaults(code)
    defaults["last_purchase_rate"] = _last_purchase_rate(code)
    defaults["hec_item_mrp"] = _batch_mrp(code) or flt(defaults.get("hec_item_mrp") or 0)
    defaults["rate"] = defaults["last_purchase_rate"] or defaults["hec_item_mrp"] or flt(
        defaults.get("rate") or 0
    )
    return {
        "ok": True,
        "created": False,
        "item_code": code,
        "sanitized_from": raw if raw != code else None,
        "defaults": defaults,
    }


@frappe.whitelist()
def api_ensure_hec_item_batch(data=None, body=None):
    payload = data or body
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    out = ensure_hec_item_with_batch(payload or {})
    frappe.db.commit()
    return out


@frappe.whitelist()
def api_search_hec_marg_catalog(txt=None, search_by=None, limit=20):
    return search_hec_marg_catalog(txt=txt, search_by=search_by, limit=limit)


@frappe.whitelist()
def api_get_hec_batch_defaults(batch_no=None, item_code=None):
    return get_hec_batch_line_defaults(batch_no=batch_no, item_code=item_code)


@frappe.whitelist()
def api_get_hec_pharma_item_defaults(item_code=None):
    d = get_hec_pharma_item_defaults(item_code)
    if d:
        d["last_purchase_rate"] = _last_purchase_rate(item_code)
        d["hec_item_mrp"] = _batch_mrp(item_code) or flt(d.get("hec_item_mrp") or 0)
        d["rate"] = d["last_purchase_rate"] or d["hec_item_mrp"] or flt(d.get("rate") or 0)
        d["stock"] = _item_total_stock(item_code)
    return d


@frappe.whitelist()
def api_get_hec_party_history(party=None, direction="purchase"):
    return get_hec_party_history(party=party, direction=direction)


@frappe.whitelist()
def api_search_hec_items(txt=None, limit=25):
    return search_hec_items(txt=txt, limit=limit)


@frappe.whitelist()
def api_list_item_batches(item_code=None, limit=40):
    return list_item_batches(item_code=item_code, limit=limit)


@frappe.whitelist()
def api_create_hec_pharma_invoice(data=None, body=None):
    payload = data or body
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    out = create_hec_pharma_invoice(payload)
    frappe.db.commit()
    return out


@frappe.whitelist()
def api_render_landscape_print(doctype=None, name=None, as_pdf=0):
    """Smoke/helper: return print HTML (and optional PDF) with no letterhead to avoid broken images."""
    if not doctype or not name:
        frappe.throw(_("doctype and name required"))
    fmt = PRINT_SI if doctype == "Sales Invoice" else PRINT_PINV
    html = frappe.get_print(doctype, name, print_format=fmt, no_letterhead=1)
    out = {"ok": True, "print_format": fmt, "html_len": len(html or ""), "has_qty": "Qty" in (html or "")}
    if cint(as_pdf):
        from frappe.utils.pdf import get_pdf

        # Strip any remaining relative img tags before PDF
        import re

        safe_html = re.sub(
            r"<img[^>]+src=[\"'](?!https?:|data:)[^\"']+[\"'][^>]*>",
            "",
            html or "",
            flags=re.I,
        )
        pdf = get_pdf(safe_html)
        frappe.local.response.filename = f"{name}.pdf"
        frappe.local.response.filecontent = pdf
        frappe.local.response.type = "pdf"
        return
    return out


# ---------------------------------------------------------------------------
# Setup + smoke
# ---------------------------------------------------------------------------


def repair_invoice_transport_fields():
    """Fix transport custom fields if insert_after target broke the Desk form layout."""
    for dt in ("Purchase Invoice", "Sales Invoice"):
        meta = frappe.get_meta(dt)
        preferred = None
        for candidate in ("ignore_pricing_rule", "apply_discount_on", "additional_discount_percentage", "terms", "remarks"):
            if meta.has_field(candidate):
                preferred = candidate
                break
        name = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": "hec_transport_section"}, "name")
        if name and preferred:
            frappe.db.set_value("Custom Field", name, "insert_after", preferred)
    frappe.clear_cache(doctype="Purchase Invoice")
    frappe.clear_cache(doctype="Sales Invoice")
    return True


def diagnose_pinv_form(invoice="ACC-PINV-2026-00020"):
    """Return diagnostics for blank PINV form + broken PDF image links."""
    import re

    out = {
        "invoice": invoice,
        "exists": bool(frappe.db.exists("Purchase Invoice", invoice)),
        "custom_fields": [],
        "bad_insert_after": [],
        "images": [],
        "letter_heads": [],
        "client_scripts": [],
        "property_setters": [],
    }
    rows = frappe.get_all(
        "Custom Field",
        filters={"dt": "Purchase Invoice"},
        fields=["name", "fieldname", "insert_after", "fieldtype"],
        order_by="idx",
    )
    out["custom_fields"] = rows
    meta = frappe.get_meta("Purchase Invoice")
    names = {f.fieldname for f in meta.fields}
    out["field_count"] = len(meta.fields)
    out["bad_insert_after"] = [
        {"fieldname": r.fieldname, "insert_after": r.insert_after}
        for r in rows
        if r.insert_after and r.insert_after not in names
    ]
    if out["exists"]:
        try:
            h = frappe.get_print(
                "Purchase Invoice",
                invoice,
                print_format=PRINT_PINV,
                no_letterhead=1,
            )
            out["print_html_len_no_lh"] = len(h or "")
            out["images_no_lh"] = re.findall(r"src=[\"']([^\"']+)[\"']", h or "", flags=re.I)
        except Exception as e:
            out["print_err_no_lh"] = f"{type(e).__name__}: {e}"
        try:
            h2 = frappe.get_print("Purchase Invoice", invoice, print_format=PRINT_PINV)
            out["print_html_len"] = len(h2 or "")
            out["images"] = re.findall(r"src=[\"']([^\"']+)[\"']", h2 or "", flags=re.I)
        except Exception as e:
            out["print_err"] = f"{type(e).__name__}: {e}"
    for lh in frappe.get_all("Letter Head", fields=["name", "is_default", "content"], limit=10):
        c = lh.get("content") or ""
        out["letter_heads"].append(
            {
                "name": lh.name,
                "is_default": lh.is_default,
                "srcs": re.findall(r"src=[\"']([^\"']+)[\"']", c, flags=re.I),
            }
        )
    out["client_scripts"] = frappe.get_all(
        "Client Script", filters={"dt": "Purchase Invoice"}, fields=["name", "enabled"]
    )
    out["property_setters"] = frappe.get_all(
        "Property Setter",
        filters={"doc_type": "Purchase Invoice"},
        fields=["name", "property", "value", "field_name"],
        limit=100,
    )
    return out


def prepare_html_for_pdf(html):
    """Strip external CSS/img that wkhtmltopdf cannot fetch; force compact continuous layout."""
    import re

    if not html:
        return html
    html = re.sub(r"<link[^>]*>", "", html, flags=re.I)
    html = re.sub(
        r"<script[^>]+src=[\"'][^\"']+[\"'][^>]*>\s*</script>",
        "",
        html,
        flags=re.I | re.S,
    )
    html = re.sub(r"<img\b[^>]*>", "", html, flags=re.I)
    html = re.sub(
        r"background-image\s*:\s*url\([^)]+\)\s*;?",
        "",
        html,
        flags=re.I,
    )
    # ERPNext default print CSS often sets min-height:100% / page-break wrappers
    # that push the footer to the bottom and leave Marg-unlike white gaps.
    compact = (
        "<style>"
        + _landscape_css()
        + "html,body,.print-format,.print-format-gutter,.page-break,"
        ".page-container,.print-wrapper{height:auto!important;min-height:0!important;"
        "max-height:none!important}"
        ".print-format{page-break-after:auto!important}"
        "</style>"
    )
    return compact + html


def get_pdf_without_remote_assets(html):
    """PDF via pdfkit without Frappe header/footer wrappers (those embed broken asset URLs)."""
    import pdfkit

    html = prepare_html_for_pdf(html)
    options = {
        "encoding": "UTF-8",
        "page-size": "A4",
        "orientation": "Landscape",
        "margin-top": "4mm",
        "margin-bottom": "4mm",
        "margin-left": "4mm",
        "margin-right": "4mm",
        "disable-javascript": None,
        "enable-local-file-access": None,
        "quiet": None,
        "load-error-handling": "ignore",
        "load-media-error-handling": "ignore",
        "print-media-type": None,
    }
    return pdfkit.from_string(html, False, options=options)


def get_hec_invoice_pdf(doctype, name, print_format=None, no_letterhead=1):
    """Generate PDF for HEC landscape bill without broken external assets."""
    if not print_format:
        print_format = PRINT_SI if doctype == "Sales Invoice" else PRINT_PINV
    html = frappe.get_print(
        doctype,
        name,
        print_format=print_format,
        no_letterhead=cint(no_letterhead),
    )
    return get_pdf_without_remote_assets(html)


@frappe.whitelist()
def api_download_hec_pdf(doctype=None, name=None, print_format=None, no_letterhead=1):
    """Desk/API: download landscape GST PDF that does not depend on remote CSS/images."""
    if not doctype or not name:
        frappe.throw(_("doctype and name required"))
    pdf = get_hec_invoice_pdf(doctype, name, print_format=print_format, no_letterhead=no_letterhead)
    frappe.local.response.filename = f"{name}.pdf"
    frappe.local.response.filecontent = pdf
    frappe.local.response.type = "pdf"


@frappe.whitelist(allow_guest=True)
def safe_download_pdf(
    doctype=None,
    name=None,
    format=None,
    doc=None,
    no_letterhead=0,
    letterhead=None,
    settings=None,
    **kwargs,
):
    """
    Drop-in replacement for frappe.utils.print_format.download_pdf.
    Strips remote CSS/img that cause wkhtmltopdf ContentNotFoundError when host_name
    points at a domain that cannot serve /assets.
    """
    if isinstance(doc, str):
        import json as _json

        try:
            doc = frappe.get_doc(_json.loads(doc))
        except Exception:
            doc = None
    if not doc:
        if not doctype or not name:
            frappe.throw(_("doctype and name required"))
        doc = frappe.get_doc(doctype, name)

    try:
        from frappe.utils.print_format import validate_print_permission

        validate_print_permission(doc)
    except ImportError:
        frappe.has_permission(doc.doctype, "print", doc=doc, throw=True)

    html = frappe.get_print(
        doctype=doc.doctype,
        name=doc.name,
        print_format=format,
        doc=doc,
        no_letterhead=cint(no_letterhead),
        letterhead=letterhead,
        settings=frappe.parse_json(settings) if isinstance(settings, str) else settings,
    )
    frappe.local.response.filename = "{0}.pdf".format(doc.name)
    frappe.local.response.filecontent = get_pdf_without_remote_assets(html)
    frappe.local.response.type = "pdf"


def test_pinv_pdf(invoice="ACC-PINV-2026-00020"):
    """Try PDF generation; return image URLs and success/failure."""
    import re

    from frappe.utils.pdf import get_pdf

    out = {
        "host": frappe.utils.get_url(),
        "host_name": frappe.conf.get("host_name"),
        "company_logo": None,
    }
    company = frappe.db.get_value("Purchase Invoice", invoice, "company")
    if company and frappe.get_meta("Company").has_field("company_logo"):
        out["company_logo"] = frappe.db.get_value("Company", company, "company_logo")

    for label, kwargs in (
        ("hec_no_lh", {"print_format": PRINT_PINV, "no_letterhead": 1}),
        ("hec_lh", {"print_format": PRINT_PINV, "no_letterhead": 0}),
        ("standard_no_lh", {"print_format": "Standard", "no_letterhead": 1}),
        ("standard_lh", {"print_format": "Standard", "no_letterhead": 0}),
    ):
        try:
            html = frappe.get_print("Purchase Invoice", invoice, **kwargs)
            imgs = re.findall(r"src=[\"']([^\"']+)[\"']", html or "", flags=re.I)
            links = re.findall(r"<link[^>]+href=[\"']([^\"']+)[\"']", html or "", flags=re.I)
            entry = {"html_len": len(html or ""), "imgs": imgs, "links": links[:10]}
            try:
                pdf = get_pdf(html)
                entry["pdf_ok"] = True
                entry["pdf_len"] = len(pdf or b"")
            except Exception as e:
                entry["pdf_ok"] = False
                entry["pdf_err"] = f"{type(e).__name__}: {str(e)[:400]}"
                try:
                    pdf2 = get_pdf_without_remote_assets(html)
                    entry["pdf_ok_prepared"] = True
                    entry["pdf_len_prepared"] = len(pdf2 or b"")
                except Exception as e2:
                    entry["pdf_ok_prepared"] = False
                    entry["pdf_err_prepared"] = f"{type(e2).__name__}: {str(e2)[:300]}"
            out[label] = entry
        except Exception as e:
            out[label] = {"error": f"{type(e).__name__}: {e}"}

    try:
        pdf = get_hec_invoice_pdf("Purchase Invoice", invoice, no_letterhead=1)
        out["hec_api_pdf"] = {"ok": True, "len": len(pdf or b"")}
    except Exception as e:
        out["hec_api_pdf"] = {"ok": False, "err": f"{type(e).__name__}: {str(e)[:400]}"}
    return out


def setup_phase69():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import (
        ensure_item_tax_fields,
    )

    ensure_item_tax_fields()
    ensure_phase69_custom_fields()
    fix_pinv_blank_form()
    lh_fixed = sanitize_letter_heads_for_pdf()
    prints = ensure_print_formats()
    page = ensure_pharma_billing_page()
    ws = ensure_workspace_links()
    frappe.db.commit()
    return {
        "ok": True,
        "phase": 69,
        "print_formats": prints,
        "page": page,
        "workspace": ws,
        "transport_fields_repaired": True,
        "letter_heads_sanitized": lh_fixed,
    }


def smoke_phase69():
    checks = []

    def add(name, ok, detail=""):
        checks.append({"name": name, "pass": bool(ok), "detail": str(detail)[:500]})

    setup = setup_phase69()
    add("setup", setup.get("ok"), setup)

    add(
        "custom_field_item_pack",
        frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "hec_pack_size"}),
    )
    add(
        "custom_field_si_free",
        frappe.db.exists("Custom Field", {"dt": "Sales Invoice Item", "fieldname": "hec_free_qty"}),
    )
    add(
        "custom_field_pinv_batch",
        frappe.db.exists("Custom Field", {"dt": "Purchase Invoice Item", "fieldname": "hec_batch_no"}),
    )
    add("print_si", frappe.db.exists("Print Format", PRINT_SI))
    add("print_pinv", frappe.db.exists("Print Format", PRINT_PINV))
    add("page", frappe.db.exists("Page", PAGE_NAME))

    item_out = upsert_hec_pharma_item(
        {
            "item_code": "HEC-PHARMA-SMOKE",
            "item_name": "HEC Pharma Smoke Tab",
            "hec_pack_size": "1*10",
            "hec_item_mrp": 50,
            "hec_hsn_sac": "3004",
            "hec_gst_rate": 12,
            "price_list_rate": 40,
            "has_batch_no": 1,
            "has_expiry_date": 1,
            "is_stock_item": 1,
        }
    )
    add("upsert_item", item_out.get("ok") and item_out.get("item_code") == "HEC-PHARMA-SMOKE", item_out)
    defaults = get_hec_pharma_item_defaults("HEC-PHARMA-SMOKE")
    add("item_defaults", defaults.get("hec_pack_size") == "1*10", defaults)

    # Prefer existing stock items for purchase smoke if present
    reagent = "REAGENT-CBC" if frappe.db.exists("Item", "REAGENT-CBC") else "HEC-PHARMA-SMOKE"
    if reagent == "REAGENT-CBC":
        from health_ecosystem_core.health_ecosystem_core.clinical_phase67_gst_compliance import apply_hsn_to_item

        apply_hsn_to_item(reagent, force=True)

    pinv = create_hec_pharma_invoice(
        {
            "direction": "purchase",
            "submit": 1,
            "update_stock": 0,
            "items": [
                {
                    "item_code": reagent,
                    "qty": 9,
                    "free_qty": 1,
                    "rate": 100,
                    "hec_pack_size": "1*10",
                    "hec_batch_no": "B69-001",
                    "hec_expiry_date": "2027-12-31",
                    "hec_item_mrp": 120,
                    "discount_percentage": 0,
                }
            ],
            "transport": {
                "hec_transport": "SELF",
                "hec_lr_no": "LR69",
                "hec_cases": "1",
                "hec_eway_bill": "EWAY69",
            },
            "invoice_discount": {"additional_discount_percentage": 0},
        }
    )
    add("create_pinv", pinv.get("ok") and pinv.get("invoice"), pinv.get("invoice"))
    if pinv.get("invoice"):
        pi = frappe.get_doc("Purchase Invoice", pinv["invoice"])
        free_line = any(cint(i.is_free_item) for i in pi.items)
        paid = next((i for i in pi.items if not cint(i.is_free_item)), None)
        add("pinv_free_line", free_line)
        add("pinv_free_qty_field", paid and flt(paid.hec_free_qty) == 1, paid.hec_free_qty if paid else None)
        add("pinv_batch", paid and paid.hec_batch_no == "B69-001", paid.hec_batch_no if paid else None)
        try:
            html = frappe.get_print("Purchase Invoice", pi.name, print_format=PRINT_PINV)
            add(
                "pinv_print",
                html and ("GST" in html or "Invoice" in html) and ("B69-001" in html or "Qty" in html),
                len(html or 0),
            )
        except Exception as e:
            add("pinv_print", False, str(e))

    sinv = create_hec_pharma_invoice(
        {
            "direction": "sales",
            "submit": 1,
            "update_stock": 0,
            "items": [
                {
                    "item_code": "HEC-PHARMA-SMOKE",
                    "qty": 10,
                    "free_qty": 1,
                    "rate": 40,
                    "hec_pack_size": "1*10",
                    "hec_batch_no": "S69-001",
                    "hec_expiry_date": "2027-06-30",
                    "hec_item_mrp": 50,
                    "discount_percentage": 5,
                    "hec_gst_rate": 12,
                }
            ],
            "transport": {"hec_transport": "COURIER", "hec_eway_bill": "SEWAY69"},
        }
    )
    add("create_sinv", sinv.get("ok") and sinv.get("invoice"), sinv.get("invoice"))
    if sinv.get("invoice"):
        try:
            html = frappe.get_print("Sales Invoice", sinv["invoice"], print_format=PRINT_SI)
            add(
                "sinv_print",
                html and "Qty" in html and ("S69-001" in html or "HEC" in html),
                len(html or 0),
            )
        except Exception as e:
            add("sinv_print", False, str(e))

    ok = all(c["pass"] for c in checks)
    frappe.db.commit()
    return {"ok": ok, "phase": 69, "checks": checks, "purchase": pinv, "sales": sinv}
