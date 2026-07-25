"""
Phase 6: multi-test TRF panels, branded lab reports, workflow polish.

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase6.setup_phase6
"""

import json

import frappe
from frappe.utils import cint, flt

from health_ecosystem_core.health_ecosystem_core.clinical_workflow import setup_journey_kanban


def sync_phase6_doctypes(force=False):
    """Import Phase 6 child/parent DocTypes (restores tables deleted as orphans)."""
    import os

    from frappe.modules.import_file import import_file_by_path

    app_path = frappe.get_app_path("health_ecosystem_core")
    base = os.path.join(app_path, "health_ecosystem_core", "health_ecosystem_core", "doctype")
    for rel in (
        "trf_test_item/trf_test_item.json",
        "lab_test_panel_item/lab_test_panel_item.json",
        "lab_test_panel/lab_test_panel.json",
        "customer_trf/customer_trf.json",
    ):
        path = os.path.join(base, rel)
        if not os.path.exists(path):
            frappe.log_error(title="Phase 6 sync missing file", message=path)
            continue
        import_file_by_path(path, force=force)

    for dt in ("TRF Test Item", "Lab Test Panel Item", "Lab Test Panel"):
        if frappe.db.exists("DocType", dt):
            frappe.db.set_value("DocType", dt, "module", "Health Ecosystem Core")
            frappe.db.set_value("DocType", dt, "app", "health_ecosystem_core")

    try:
        frappe.model.sync.sync_for("health_ecosystem_core", force=force)
    except Exception:
        frappe.log_error(title="Phase 6 sync_for", message=frappe.get_traceback())

    frappe.clear_cache()
    for dt in ("Customer TRF", "Lab Test Panel", "TRF Test Item", "Lab Test Panel Item"):
        frappe.clear_cache(doctype=dt)


def _phase6_child_tables_ready():
    for dt in ("TRF Test Item", "Lab Test Panel Item"):
        if not frappe.db.exists("DocType", dt):
            return False
        if frappe.db.get_value("DocType", dt, "module") != "Health Ecosystem Core":
            return False
    return True


def setup_phase6(seed_panels=True):
    sync_phase6_doctypes(force=True)
    ensure_report_branding_fields()
    ensure_lab_result_item_field()
    if seed_panels and _phase6_child_tables_ready():
        try:
            seed_lab_test_panels()
        except Exception:
            frappe.log_error(title="seed_lab_test_panels", message=frappe.get_traceback())
    setup_journey_kanban()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 6, "child_tables": _phase6_child_tables_ready()}


def ensure_report_branding_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "lab_brand_section",
                    "label": "Lab Report Branding",
                    "fieldtype": "Section Break",
                    "insert_after": "pharmacy_catalog_title",
                },
                {
                    "fieldname": "lab_name",
                    "label": "Lab / Hospital Name",
                    "fieldtype": "Data",
                    "insert_after": "lab_brand_section",
                    "default": "Health Ecosystem Diagnostics",
                },
                {
                    "fieldname": "lab_tagline",
                    "label": "Report Tagline",
                    "fieldtype": "Data",
                    "insert_after": "lab_name",
                },
                {
                    "fieldname": "lab_logo",
                    "label": "Report Logo",
                    "fieldtype": "Attach Image",
                    "insert_after": "lab_tagline",
                },
                {
                    "fieldname": "report_primary_color",
                    "label": "Report Accent Color",
                    "fieldtype": "Color",
                    "insert_after": "lab_logo",
                    "default": "#0d9488",
                },
                {
                    "fieldname": "report_footer",
                    "label": "Report Footer Text",
                    "fieldtype": "Small Text",
                    "insert_after": "report_primary_color",
                },
                {
                    "fieldname": "nabl_accreditation",
                    "label": "NABL / Accreditation Line",
                    "fieldtype": "Data",
                    "insert_after": "report_footer",
                    "default": "NABL Accredited Laboratory | ISO 15189:2022",
                },
            ]
        },
        update=True,
    )


def ensure_lab_result_item_field():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Lab Test Result": [
                {
                    "fieldname": "erp_item_code",
                    "label": "ERP Test Item",
                    "fieldtype": "Link",
                    "options": "Item",
                    "insert_after": "customer_trf",
                }
            ]
        },
        update=True,
    )


def seed_lab_test_panels():
    if not frappe.db.exists("DocType", "Lab Test Panel"):
        return

    lab_items = frappe.get_all(
        "Item",
        filters={"item_group": ["in", ("Lab Tests", "Laboratory", "Diagnostics", "Lab")], "disabled": 0},
        fields=["name", "item_name"],
        limit=8,
    )
    if len(lab_items) < 2:
        return

    panels = [
        ("Basic Health Panel", lab_items[:2]),
        ("Comprehensive Panel", lab_items[: min(4, len(lab_items))]),
    ]
    for panel_name, items in panels:
        if frappe.db.exists("Lab Test Panel", panel_name):
            continue
        doc = frappe.get_doc(
            {
                "doctype": "Lab Test Panel",
                "panel_name": panel_name,
                "description": f"Auto-seeded panel with {len(items)} test(s)",
                "is_active": 1,
                "show_on_mobile": 1,
                "tests": [{"item": row.name, "item_name": row.item_name} for row in items],
            }
        )
        doc.insert(ignore_permissions=True)


def get_report_branding():
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return {}
    return {
        "lab_name": frappe.db.get_single_value("Health Ecosystem Settings", "lab_name")
        or "Health Ecosystem Diagnostics",
        "lab_tagline": frappe.db.get_single_value("Health Ecosystem Settings", "lab_tagline") or "",
        "lab_logo": frappe.db.get_single_value("Health Ecosystem Settings", "lab_logo") or "",
        "report_primary_color": frappe.db.get_single_value("Health Ecosystem Settings", "report_primary_color")
        or "#0d9488",
        "report_footer": frappe.db.get_single_value("Health Ecosystem Settings", "report_footer") or "",
        "nabl_accreditation": frappe.db.get_single_value("Health Ecosystem Settings", "nabl_accreditation")
        or "NABL Accredited Laboratory | ISO 15189:2022",
    }


def parse_trf_test_items(test_required=None, test_items=None, amount=None):
    """Normalize API input into TRF child-table rows."""
    from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

    rows = []
    parsed = test_items
    if isinstance(parsed, str):
        try:
            parsed = json.loads(parsed)
        except Exception:
            parsed = None

    if parsed:
        for entry in parsed:
            if isinstance(entry, str):
                code = entry.strip()
                if code:
                    rows.append({"item": code, "qty": 1, "rate": _resolve_selling_rate(code)})
                continue
            code = (entry.get("item_code") or entry.get("item") or entry.get("test_required") or "").strip()
            if not code:
                continue
            qty = flt(entry.get("qty", 1)) or 1
            rate = flt(entry.get("rate")) or _resolve_selling_rate(code)
            rows.append({"item": code, "qty": qty, "rate": rate, "amount": qty * rate})

    if not rows and test_required:
        codes = [c.strip() for c in str(test_required).split(",") if c.strip()]
        for code in codes:
            rows.append({"item": code, "qty": 1, "rate": _resolve_selling_rate(code)})

    if rows and flt(amount) and len(rows) == 1 and not flt(rows[0].get("rate")):
        rows[0]["rate"] = flt(amount)
        rows[0]["amount"] = flt(amount)

    for row in rows:
        row["amount"] = flt(row.get("qty", 1)) * flt(row.get("rate"))
        row["item_name"] = frappe.db.get_value("Item", row["item"], "item_name") or row["item"]

    return rows


def render_branded_lab_report_html(payload):
    from html import escape

    branding = get_report_branding()
    accent = escape(branding.get("report_primary_color") or "#0d9488")
    lab_name = escape(branding.get("lab_name") or "Laboratory Report")
    tagline = escape(branding.get("lab_tagline") or "")
    footer = escape(branding.get("report_footer") or "")
    logo = branding.get("lab_logo") or ""
    logo_html = f'<img src="{escape(logo)}" alt="logo" style="max-height:56px;margin-right:16px;" />' if logo else ""

    patient = escape(str(payload.get("patient_name") or ""))
    journey_id = escape(str(payload.get("journey_id") or ""))
    trf_id = escape(str(payload.get("trf_id") or ""))
    status = escape(str(payload.get("status") or ""))
    authorized_on = escape(str(payload.get("authorized_on") or ""))
    pathologist_notes = escape(str(payload.get("pathologist_notes") or ""))

    structured = payload.get("structured") or {}
    test_sections = structured.get("tests") or []
    if not test_sections and payload.get("results"):
        test_sections = [{"test_name": "Laboratory Results", "parameters": payload.get("results") or []}]

    sections_html = ""
    for section in test_sections:
        title = escape(str(section.get("test_name") or section.get("test") or "Test"))
        rows = ""
        for row in section.get("parameters") or []:
            flag = row.get("abnormal_flag") or ""
            flag_style = "color:#b91c1c;font-weight:bold;" if flag in ("H", "L", "High", "Low", "Critical") else ""
            rows += (
                f"<tr><td>{escape(str(row.get('analyte_test_name') or ''))}</td>"
                f"<td>{row.get('numeric_result_value', '')}</td>"
                f"<td>{escape(str(row.get('unit_of_measure') or ''))}</td>"
                f"<td>{escape(str(row.get('reference_range') or ''))}</td>"
                f"<td style='{flag_style}'>{escape(str(flag))}</td></tr>"
            )
        sections_html += f"""
        <h2 style="color:{accent};font-size:16px;margin-top:24px;">{title}</h2>
        <table>
          <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
          <tbody>{rows or "<tr><td colspan='5'>No results recorded</td></tr>"}</tbody>
        </table>
        """

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{lab_name} — Lab Report</title>
<style>
body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0; color: #1f2937; }}
.header {{ display:flex; align-items:center; padding: 24px 28px; border-bottom: 4px solid {accent}; background:#f8fafc; }}
.header h1 {{ margin: 0; font-size: 22px; color: {accent}; }}
.header p {{ margin: 4px 0 0; color: #64748b; font-size: 13px; }}
.content {{ padding: 24px 28px; }}
.meta {{ display:grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; background:#f1f5f9; padding:16px; border-radius:8px; }}
.meta p {{ margin: 0; font-size: 13px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }}
th, td {{ border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }}
th {{ background: {accent}; color: white; }}
.footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align:center; }}
.notes {{ margin-top: 16px; padding: 12px; background: #fffbeb; border-left: 4px solid #f59e0b; font-size: 13px; }}
</style></head><body>
<div class="header">{logo_html}<div><h1>{lab_name}</h1>{f"<p>{tagline}</p>" if tagline else ""}</div></div>
<div class="content">
<div class="meta">
  <p><strong>Patient:</strong> {patient}</p>
  <p><strong>Journey:</strong> {journey_id}</p>
  <p><strong>TRF:</strong> {trf_id}</p>
  <p><strong>Status:</strong> {status}</p>
  {f"<p><strong>Authorized:</strong> {authorized_on}</p>" if authorized_on else ""}
</div>
{sections_html}
{f'<div class="notes"><strong>Pathologist Notes:</strong> {pathologist_notes}</div>' if pathologist_notes else ''}
</div>
<div class="footer">{footer or 'This is a computer-generated report.'}</div>
</body></html>"""


def panel_catalog_payload():
    if not frappe.db.exists("DocType", "Lab Test Panel"):
        return []
    from health_ecosystem_core.health_ecosystem_core.api import (
        _is_lab_item_group,
        _is_reagent_or_excluded_item,
        _list_selling_rate,
        _patient_offer_pricing,
        _subscription_coupon_tag,
    )
    import health_ecosystem_core.health_ecosystem_core.api as hec_api

    fallback_discount = float(getattr(hec_api, "PATIENT_FALLBACK_DISCOUNT", 0.10) or 0.10)
    wallet_earn = float(getattr(hec_api, "WALLET_EARN_ON_PURCHASE", 0.10) or 0.10)

    # Prefer curated customer packages first
    preferred_order = (
        "Basic Health Screening",
        "Essential Full Body Checkup",
        "Comprehensive Silver Full Body Checkup",
        "Comprehensive Gold Full Body Checkup",
        "Diabetes Care Package",
        "Heart Health Package",
        "Thyroid Care Package",
        "Women Wellness Package",
        "Men Health Package",
        "Fever Panel",
        "Vitamin Check Package",
        "Anemia & Iron Package",
        "Senior Citizen Health Package",
        "Comprehensive Platinum Full Body Checkup",
    )

    panels = []
    user = frappe.session.user if getattr(frappe, "session", None) else None
    for row in frappe.get_all(
        "Lab Test Panel",
        filters={"is_active": 1, "show_on_mobile": 1},
        fields=["name", "panel_name", "description", "panel_rate"],
        order_by="panel_name asc",
        limit=50,
    ):
        doc = frappe.get_doc("Lab Test Panel", row.name)
        tests = []
        offer_total = 0
        mrp_total = 0
        for line in doc.tests or []:
            item_code = line.item
            if not item_code:
                continue
            group = frappe.db.get_value("Item", item_code, "item_group")
            item_name = line.item_name or frappe.db.get_value("Item", item_code, "item_name")
            if not _is_lab_item_group(group) or _is_reagent_or_excluded_item(item_code, group, item_name):
                continue
            offer = _patient_offer_pricing(item_code)
            rate = offer["rate"]
            offer_total += rate
            mrp_total += offer["mrp"] or _list_selling_rate(item_code) or rate
            tests.append(
                {
                    "item_code": item_code,
                    "item_name": item_name,
                    "rate": rate,
                    "mrp": offer["mrp"] or None,
                    "price_basis": offer["price_basis"],
                }
            )
        if len(tests) < 2:
            continue
        panel_list = flt(doc.panel_rate) or offer_total
        # Package sell: FOCO-sum when cheaper, else 10% off panel list
        rate = offer_total if offer_total and offer_total < panel_list else round(
            panel_list * (1.0 - fallback_discount), 2
        )
        mrp = max(mrp_total, panel_list)
        if mrp <= rate:
            mrp = round(rate / (1.0 - fallback_discount), 2)
        panels.append(
            {
                "panel_id": doc.name,
                "panel_name": doc.panel_name,
                "description": doc.description,
                "rate": rate,
                "mrp": mrp if mrp > rate else None,
                "discount_percent": round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0,
                "price_basis": "foco" if offer_total and offer_total < panel_list else "ten_percent",
                "wallet_earn_percent": int(wallet_earn * 100),
                "wallet_earn_amount": round(rate * wallet_earn, 2) if rate else 0,
                "member_tag": _subscription_coupon_tag("Lab Tests", user),
                "coupon_label": "Circle coupon",
                "tests": tests,
                "test_count": len(tests),
            }
        )

    rank = {name: idx for idx, name in enumerate(preferred_order)}
    panels.sort(key=lambda p: (rank.get(p["panel_name"], 100), p["panel_name"]))
    return panels
