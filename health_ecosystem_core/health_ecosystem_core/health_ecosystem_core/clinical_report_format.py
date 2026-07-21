"""Remedium-style lab report formatting, formulas, and PDF HTML."""

import re
from collections import OrderedDict
from html import escape

import frappe
from frappe.utils import cint, flt, get_datetime, get_url

# Department / category sort order (Agilus / Pulse / Radcliffe style grouping).
CATEGORY_RANK = {
    "HAEMATOLOGY": 10,
    "HEMATOLOGY": 10,
    "BIOCHEMISTRY": 20,
    "CLINICAL BIOCHEMISTRY": 20,
    "LIPID": 25,
    "LIVER": 26,
    "RENAL": 27,
    "THYROID": 30,
    "HORMONE": 30,
    "ENDOCRINOLOGY": 30,
    "SEROLOGY": 40,
    "IMMUNOLOGY": 45,
    "MICROBIOLOGY": 50,
    "CLINICAL PATHOLOGY": 60,
    "URINE": 70,
    "URINALYSIS": 70,
    "COAGULATION": 80,
    "OTHER": 90,
    "LABORATORY REPORT": 85,
}


def _category_rank(category):
    key = (category or "").upper().strip()
    if key in CATEGORY_RANK:
        return CATEGORY_RANK[key]
    for label, rank in CATEGORY_RANK.items():
        if label in key or key in label:
            return rank
    return 85


def _absolute_asset(path):
    if not path:
        return ""
    if str(path).startswith("http"):
        return path
    try:
        return get_url(path)
    except Exception:
        return path


def fmt_report_datetime(value):
    if not value:
        return ""
    try:
        dt = get_datetime(value)
        hour = dt.strftime("%I").lstrip("0") or "12"
        return f"{dt.strftime('%d-%b-%Y')} {hour}:{dt.strftime('%M %p')}"
    except Exception:
        return str(value)


def reference_label(lower, upper):
    if lower is not None and upper is not None:
        return f"{flt(lower):g} - {flt(upper):g}"
    if lower is not None:
        return f"> {flt(lower):g}"
    if upper is not None:
        return f"< {flt(upper):g}"
    return ""


def abnormal_flag_for_value(value, lower, upper):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""
    if lower is not None and num < float(lower):
        return "L"
    if upper is not None and num > float(upper):
        return "H"
    if lower is not None or upper is not None:
        return "N"
    return ""


def is_abnormal(flag):
    return (flag or "").upper() in ("H", "L", "HIGH", "LOW", "CRITICAL")


def _formula_variables(parameters):
    variables = {}
    for row in parameters:
        keys = set()
        if row.get("parameter_code"):
            keys.add(str(row.parameter_code).strip().upper())
        if row.get("description"):
            keys.add(_slug(row.description))
        value = row.get("result_value")
        if value in (None, ""):
            continue
        try:
            num = flt(value)
        except Exception:
            continue
        for key in keys:
            if key:
                variables[key] = num
    return variables


def _slug(text):
    return re.sub(r"[^A-Z0-9]+", "_", (text or "").upper()).strip("_")


def safe_eval_formula(formula, variables):
    import math

    if not formula:
        return None
    expr = str(formula).strip()
    for key, value in sorted(variables.items(), key=lambda kv: -len(kv[0])):
        expr = re.sub(r"\{" + re.escape(key) + r"\}", str(flt(value)), expr, flags=re.IGNORECASE)
        expr = re.sub(r"\b" + re.escape(key) + r"\b", str(flt(value)), expr, flags=re.IGNORECASE)
    # Allow digits/operators plus a small set of math helpers (log10, abs, sqrt)
    if not re.match(r"^(?:log10|abs|sqrt|[\d\.\+\-\*/\(\)\s,])+$", expr, flags=re.IGNORECASE):
        raise ValueError(f"Unsafe formula after substitution: {expr}")
    return flt(
        eval(
            expr,
            {"__builtins__": {}},
            {"log10": math.log10, "abs": abs, "sqrt": math.sqrt},
        )
    )


def _row_is_calculated(row) -> bool:
    kind = (getattr(row, "parameter_kind", None) or "").strip()
    if kind == "Calculated":
        return True
    if kind == "Real":
        return False
    return bool(cint(getattr(row, "is_calculated", 0)))


def apply_calculated_parameters(doc, force=True):
    """Fill Calculated (derived) parameter rows from Derivation Equation.

    Runs on every Lab Report Save (Desk validate, web save, LIS import).
    When ``force`` is True (default), recalculates even if a prior value exists
    so Real-parameter edits refresh derived results.
    """
    rows = [row.as_dict() for row in (doc.parameters or [])]
    for _ in range(5):
        variables = _formula_variables(rows)
        changed = False
        for row in doc.parameters:
            if not _row_is_calculated(row) or not row.formula:
                continue
            if not force and row.result_value not in (None, ""):
                continue
            try:
                value = safe_eval_formula(row.formula, variables)
                if value is None:
                    continue
                # Round to 2 dp for display stability
                new_val = str(round(flt(value), 2))
                if str(row.result_value or "") != new_val:
                    row.result_value = new_val
                    changed = True
            except Exception:
                frappe.log_error(
                    title="Lab report formula",
                    message=f"{doc.name}: {row.description} = {row.formula}",
                )
        if changed:
            rows = [row.as_dict() for row in doc.parameters]
        else:
            break

    for row in doc.parameters:
        if row.result_value in (None, ""):
            continue
        from health_ecosystem_core.health_ecosystem_core.clinical_utils import abnormal_flag_for_lab_row

        row.abnormal_flag = abnormal_flag_for_lab_row(row) or abnormal_flag_for_value(
            row.result_value, row.lower_range, row.upper_range
        )


def investigator_signature(user_id):
    if not user_id:
        return {}
    user = frappe.db.get_value("User", user_id, ["full_name", "email"], as_dict=True)
    if not user:
        return {}
    qual = frappe.db.get_value("User", user_id, "bio") or ""
    return {"name": user.full_name or user_id, "qualification": qual}


def group_parameters_for_print(doc):
    groups = OrderedDict()
    for row in doc.parameters:
        if not row.include_in_report:
            continue
        master = row.diagnostic_test
        key = master or row.erp_item_code or row.test_name or row.description
        if key not in groups:
            meta = {}
            if master and frappe.db.exists("Diagnostic Test Master", master):
                meta = frappe.db.get_value(
                    "Diagnostic Test Master",
                    master,
                    ["test_name", "report_category", "interpretation", "machine_method"],
                    as_dict=True,
                ) or {}
            groups[key] = {
                "test_name": meta.get("test_name") or row.test_name or row.description,
                "report_category": meta.get("report_category") or doc.report_title_1 or "LABORATORY REPORT",
                "interpretation": meta.get("interpretation") or "",
                "machine_method": meta.get("machine_method") or "",
                "parameters": [],
            }
            # Prefer Item-level interpretation if master text is empty
            if not groups[key]["interpretation"] and row.erp_item_code:
                item_interp = frappe.db.get_value("Item", row.erp_item_code, "hec_lab_interpretation")
                if item_interp:
                    groups[key]["interpretation"] = item_interp
                else:
                    try:
                        from health_ecosystem_core.health_ecosystem_core.clinical_phase57_lab_interpretations import (
                            build_interpretation,
                        )

                        groups[key]["interpretation"] = build_interpretation(
                            groups[key]["test_name"]
                        )
                    except Exception:
                        pass
        flag = row.abnormal_flag or abnormal_flag_for_value(
            row.result_value, row.lower_range, row.upper_range
        )
        groups[key]["parameters"].append(
            {
                "analyte_test_name": row.description,
                "numeric_result_value": row.result_value,
                "unit_of_measure": row.unit,
                "reference_range": reference_label(row.lower_range, row.upper_range),
                "method": row.method,
                "abnormal_flag": flag,
                "is_abnormal": is_abnormal(flag),
                "interpretation": row.interpretation or "",
            }
        )
        if row.method and not groups[key]["machine_method"]:
            groups[key]["machine_method"] = row.method
        if row.interpretation and not groups[key]["interpretation"]:
            groups[key]["interpretation"] = row.interpretation
    sections = list(groups.values())
    for section in sections:
        section["parameters"].sort(key=lambda r: (r.get("analyte_test_name") or "").lower())
    sections.sort(
        key=lambda s: (
            _category_rank(s.get("report_category")),
            (s.get("test_name") or "").lower(),
        )
    )
    return sections


def build_print_payload(doc, trf):
    apply_calculated_parameters(doc)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
        normalize_referred_doctor,
        referred_doctor_from_trf,
        resolve_signatories,
    )

    referral = (
        getattr(doc, "referral_doctor", None)
        or referred_doctor_from_trf(trf)
        or getattr(doc, "advised_by", None)
        or "Self"
    )
    referral = normalize_referred_doctor(referral)
    gender = doc.gender or trf.gender or ""
    age = doc.age or trf.age
    return {
        "lab_report": doc.name,
        "patient_name": doc.patient_name or trf.patient_name,
        "gender_age": f"{age} Y / {gender[:1].upper()}" if age and gender else (str(age or "") or gender),
        "referral_doctor": referral,
        "appointment_no": getattr(doc, "appointment_no", None) or doc.bill_no or doc.lab_no or trf.name,
        "lab_no": doc.lab_no or doc.name,
        "report_no": doc.report_no or doc.name,
        "collection_center": getattr(doc, "collection_center", None) or "",
        "department": doc.department or "",
        "specimen": doc.specimen or "Serum",
        "auto_verified": cint(getattr(doc, "auto_verified", 0) or 0),
        "sample_date": doc.sample_date,
        "lab_receipt_date": doc.lab_receipt_date,
        "report_date": doc.report_date,
        "dispatch_date": getattr(doc, "dispatch_date", None),
        "printed_on": getattr(doc, "printed_on", None),
        "barcode": trf.unique_barcode,
        "report_title_1": doc.report_title_1,
        "report_title_2": doc.report_title_2,
        "report_note": doc.report_note,
        "comments": doc.comments,
        "signatories": resolve_signatories(doc),
        "test_sections": group_parameters_for_print(doc),
    }


def _flag_cell(flag):
    f = (flag or "").upper()
    if f in ("H", "HIGH", "CRITICAL"):
        return f'<span class="flag-high">{escape(f)}</span>'
    if f in ("L", "LOW"):
        return f'<span class="flag-low">{escape(f)}</span>'
    if f == "N":
        return '<span class="flag-normal">•</span>'
    return escape(f or "—")


def _result_cell(value, is_abnormal):
    text = escape(str(value or "—"))
    if is_abnormal:
        return f'<span class="result-abnormal">{text}</span>'
    return text


def render_remedium_lab_report_html(payload):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

    branding = get_report_branding()
    lab_name = escape(branding.get("lab_name") or "REMEDIUM DIAGNOSTICS")
    tagline = escape(branding.get("lab_tagline") or "")
    accent = branding.get("report_primary_color") or "#0b5cab"
    accent_safe = escape(accent)
    footer = escape(branding.get("report_footer") or "")
    nabl_line = escape(
        branding.get("nabl_accreditation") or "NABL Accredited Laboratory | ISO 15189:2022"
    )
    logo = _absolute_asset(branding.get("lab_logo") or "")
    logo_html = (
        f'<img src="{escape(logo)}" alt="Lab logo" class="lab-logo" />' if logo else ""
    )

    patient = escape(str(payload.get("patient_name") or ""))
    gender_age = escape(str(payload.get("gender_age") or ""))
    referral = escape(str(payload.get("referral_doctor") or "Self"))
    appt = escape(str(payload.get("appointment_no") or ""))
    lab_no = escape(str(payload.get("lab_no") or ""))
    report_no = escape(str(payload.get("report_no") or ""))
    barcode = escape(str(payload.get("barcode") or ""))
    collection_center = escape(str(payload.get("collection_center") or ""))
    specimen = escape(str(payload.get("specimen") or "Serum"))
    department = escape(str(payload.get("department") or ""))
    report_title = escape(str(payload.get("report_title_1") or payload.get("report_title_2") or ""))
    auto_verified = cint(payload.get("auto_verified") or 0)

    meta_items = [
        ("Patient Name", patient),
        ("Lab No.", lab_no),
        ("Age / Sex", gender_age),
        ("Report No.", report_no),
        ("Referred Doctor", referral),
        ("Barcode", barcode),
        ("Specimen", specimen),
        ("Collection Centre", collection_center),
        ("Release", "Auto verified" if auto_verified else ""),
    ]
    meta_items = [(label, val) for label, val in meta_items if val]

    meta_html = ""
    for i in range(0, len(meta_items), 2):
        left_label, left_val = meta_items[i]
        if i + 1 < len(meta_items):
            right_label, right_val = meta_items[i + 1]
        else:
            right_label, right_val = "", ""
        meta_html += (
            "<tr>"
            f"<td class='meta-label'>{escape(left_label)}</td>"
            f"<td class='meta-value'>{left_val}</td>"
            f"<td class='meta-label'>{escape(right_label)}</td>"
            f"<td class='meta-value'>{right_val}</td>"
            "</tr>"
        )

    timestamps = [
        ("Sample Collected", fmt_report_datetime(payload.get("sample_date"))),
        ("Received in Lab", fmt_report_datetime(payload.get("lab_receipt_date"))),
        ("Report Prepared", fmt_report_datetime(payload.get("report_date"))),
        ("Report Dispatched", fmt_report_datetime(payload.get("dispatch_date"))),
        ("Authorized / Printed", fmt_report_datetime(payload.get("printed_on"))),
    ]
    ts_items = [(label, val) for label, val in timestamps if val]
    ts_html = ""
    for i in range(0, len(ts_items), 2):
        left_label, left_val = ts_items[i]
        if i + 1 < len(ts_items):
            right_label, right_val = ts_items[i + 1]
        else:
            right_label, right_val = "", ""
        ts_html += (
            "<tr>"
            f"<td class='ts-label'>{escape(left_label)}</td>"
            f"<td class='ts-value'>{escape(left_val)}</td>"
            f"<td class='ts-label'>{escape(right_label)}</td>"
            f"<td class='ts-value'>{escape(right_val)}</td>"
            "</tr>"
        )
    if not ts_html:
        ts_html = "<tr><td class='ts-label'>Report</td><td class='ts-value' colspan='3'>Pending</td></tr>"

    sections_html = ""
    for section in payload.get("test_sections") or []:
        category = escape(str(section.get("report_category") or "LABORATORY").upper())
        test_name = escape(str(section.get("test_name") or ""))
        rows = ""
        for row in section.get("parameters") or []:
            abnormal = row.get("is_abnormal")
            rows += (
                "<tr>"
                f"<td class='param-name'>{escape(str(row.get('analyte_test_name') or ''))}</td>"
                f"<td class='param-result'>{_result_cell(row.get('numeric_result_value'), abnormal)}</td>"
                f"<td class='param-unit'>{escape(str(row.get('unit_of_measure') or ''))}</td>"
                f"<td class='param-ref'>{escape(str(row.get('reference_range') or ''))}</td>"
                f"<td class='param-flag'>{_flag_cell(row.get('abnormal_flag'))}</td>"
                "</tr>"
            )
        method = escape(str(section.get("machine_method") or ""))
        interpretation = section.get("interpretation") or ""
        sections_html += f"""
        <div class="test-section">
          <div class="category-bar">{category}</div>
          <div class="test-heading">{test_name}</div>
          <table class="results-table">
            <thead>
              <tr>
                <th>Test Parameter</th>
                <th>Result</th>
                <th>Unit</th>
                <th>Biological Ref. Interval</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>{rows or "<tr><td colspan='5' class='empty'>No results recorded</td></tr>"}</tbody>
          </table>
          {f"<div class='method-line'><strong>Method:</strong> {method}</div>" if method else ""}
          {f"<div class='interpretation-box'><div class='interpretation-title'>Interpretation</div><div class='interpretation-body'>{interpretation}</div></div>" if interpretation else ""}
        </div>
        """

    comments = payload.get("comments") or ""
    report_note = escape(str(payload.get("report_note") or ""))
    notes_html = ""
    if comments:
        notes_html += f"<div class='notes-box'><strong>Comments</strong><div>{comments}</div></div>"
    if report_note:
        notes_html += f"<div class='notes-box subtle'><strong>Note</strong><div>{report_note}</div></div>"

    inv1 = escape(str(payload.get("investigator_1") or ""))
    inv1q = escape(str(payload.get("investigator_1_qualification") or ""))
    inv2 = escape(str(payload.get("investigator_2") or ""))
    inv2q = escape(str(payload.get("investigator_2_qualification") or ""))
    authorized = bool(payload.get("printed_on") or payload.get("dispatch_date"))

    signatories = payload.get("signatories") or []
    if not signatories:
        signatories = [
            {"department": "Pathology", "role": "Consultant Pathologist", "name": inv1, "qualification": inv1q},
            {"department": "Biochemistry", "role": "Consultant Biochemist", "name": inv2, "qualification": inv2q},
            {"department": "Haematology", "role": "Consultant Haematologist", "name": "", "qualification": ""},
            {"department": "Microbiology", "role": "Consultant Microbiologist", "name": "", "qualification": ""},
            {"department": "Clinical Pathology", "role": "Clinical Pathologist", "name": "", "qualification": ""},
        ]

    sig_html = ""
    for sig in signatories[:5]:
        sig_html += f"""
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-name">{escape(str(sig.get("name") or " "))}</div>
    <div class="sig-qual">{escape(str(sig.get("qualification") or ""))}</div>
    <div class="sig-role">{escape(str(sig.get("role") or ""))}</div>
    <div class="sig-dept">{escape(str(sig.get("department") or ""))}</div>
  </div>"""

    title_line = f"<div class='report-title'>{report_title}</div>" if report_title else ""
    dept_line = f"<div class='dept-badge'>{department}</div>" if department else ""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{lab_name} — Lab Report</title>
<style>
@page {{ size: A4; margin: 10mm 12mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; margin: 0; line-height: 1.35; }}
.top-bar {{ background: {accent_safe}; color: #fff; padding: 14px 18px; display: flex; align-items: center; gap: 16px; }}
.lab-logo {{ max-height: 52px; max-width: 120px; object-fit: contain; background: #fff; padding: 4px 8px; border-radius: 4px; }}
.brand-block {{ flex: 1; }}
.brand-block h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.3px; }}
.brand-block .tagline {{ margin: 3px 0 0; font-size: 11px; opacity: 0.92; }}
.nabl-strip {{ background: #fef3c7; color: #92400e; text-align: center; font-size: 10px; font-weight: 600; padding: 5px 10px; letter-spacing: 0.4px; border-bottom: 2px solid {accent_safe}; }}
.authorized-badge {{ background: #dcfce7; color: #166534; border: 1px solid #86efac; font-size: 10px; font-weight: 700; padding: 6px 10px; border-radius: 4px; text-align: center; letter-spacing: 1px; }}
.patient-info-box {{ margin: 10px 0 8px; border: 1.5px solid {accent_safe}; border-radius: 4px; overflow: hidden; }}
.meta-grid {{ width: 100%; border-collapse: collapse; }}
.meta-grid td {{ padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 10.5px; vertical-align: middle; }}
.meta-grid .meta-label {{ background: #f1f5f9; color: #475569; font-weight: 600; width: 16%; white-space: nowrap; }}
.meta-grid .meta-value {{ color: #0f172a; font-weight: 600; width: 34%; }}
.ts-grid {{ width: 100%; border-collapse: collapse; border-top: 1.5px solid {accent_safe}; background: #f8fafc; }}
.ts-grid td {{ padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 10px; }}
.ts-grid .ts-label {{ color: #64748b; font-weight: 600; width: 16%; white-space: nowrap; }}
.ts-grid .ts-value {{ color: #0f172a; font-weight: 700; width: 34%; }}
.report-title {{ text-align: center; font-size: 13px; font-weight: 700; color: {accent_safe}; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }}
.dept-badge {{ text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }}
.test-section {{ margin-top: 16px; page-break-inside: avoid; }}
.category-bar {{ background: {accent_safe}; color: #fff; text-align: center; font-weight: 700; font-size: 11px; padding: 6px 10px; letter-spacing: 0.8px; border-radius: 4px 4px 0 0; }}
.test-heading {{ text-align: center; font-size: 14px; font-weight: 700; margin: 0; padding: 10px 8px 8px; color: #0f172a; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }}
.results-table {{ width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; }}
.results-table th {{ background: #334155; color: #fff; text-align: left; padding: 7px 8px; font-size: 10px; font-weight: 600; }}
.results-table td {{ padding: 6px 8px; border-bottom: 1px solid #eef2f7; font-size: 10.5px; }}
.results-table tbody tr:nth-child(even) {{ background: #f8fafc; }}
.param-result {{ font-weight: 600; text-align: center; }}
.param-unit, .param-ref, .param-flag {{ text-align: center; color: #475569; }}
.param-name {{ font-weight: 500; }}
.result-abnormal {{ color: #b91c1c; font-weight: 700; }}
.flag-high {{ color: #b91c1c; font-weight: 800; }}
.flag-low {{ color: #1d4ed8; font-weight: 800; }}
.flag-normal {{ color: #16a34a; }}
.empty {{ text-align: center; color: #94a3b8; font-style: italic; }}
.method-line {{ font-size: 10px; color: #475569; padding: 6px 10px; background: #f1f5f9; border: 1px solid #e2e8f0; border-top: none; }}
.interpretation-box {{ font-size: 10px; line-height: 1.45; padding: 10px 12px; margin-top: 8px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 0 4px 4px 0; }}
.interpretation-title {{ font-weight: 700; font-size: 11px; margin-bottom: 6px; color: #111827; }}
.interpretation-body p {{ margin: 0 0 6px; }}
.interpretation-body p:last-child {{ margin-bottom: 0; }}
.interpretation-body em {{ font-style: italic; color: #4b5563; }}
.notes-box {{ margin-top: 12px; padding: 10px 12px; background: #f0f9ff; border-left: 4px solid {accent_safe}; font-size: 10px; line-height: 1.45; }}
.notes-box.subtle {{ background: #f8fafc; border-left-color: #94a3b8; }}
.end-report {{ text-align: center; margin: 22px 0 16px; font-weight: 700; letter-spacing: 2px; color: {accent_safe}; font-size: 11px; }}
.signatures {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 10px; page-break-inside: avoid; align-items: end; }}
.sig-box {{ text-align: center; min-height: 88px; padding: 0 4px; }}
.sig-line {{ border-top: 2px solid {accent_safe}; margin: 0 4px 8px; height: 0; }}
.sig-name {{ font-weight: 700; font-size: 10px; min-height: 14px; }}
.sig-qual {{ font-size: 9px; color: #64748b; margin-top: 2px; min-height: 12px; }}
.sig-role {{ font-size: 9px; color: {accent_safe}; font-weight: 600; margin-top: 4px; }}
.sig-dept {{ font-size: 8px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.3px; }}
.footer {{ text-align: center; font-size: 9px; color: #64748b; margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; line-height: 1.4; }}
.legend {{ font-size: 9px; color: #64748b; text-align: right; margin: 8px 2px 0; }}
@media print {{
  .signatures {{ grid-template-columns: repeat(5, 1fr); }}
}}
@media screen and (max-width: 900px) {{
  .signatures {{ grid-template-columns: repeat(2, 1fr); }}
}}
</style></head><body>
<div class="top-bar">
  {logo_html}
  <div class="brand-block">
    <h1>{lab_name}</h1>
    {f"<div class='tagline'>{tagline}</div>" if tagline else ""}
  </div>
  {f"<div class='authorized-badge'>AUTHORIZED</div>" if authorized else ""}
</div>
<div class="nabl-strip">{nabl_line}</div>
{title_line}{dept_line}
<div class="patient-info-box">
  <table class="meta-grid"><tbody>{meta_html}</tbody></table>
  <table class="ts-grid"><tbody>{ts_html}</tbody></table>
</div>
<div class="legend">H = High · L = Low · • = Within range</div>
{sections_html}
{notes_html}
<div class="end-report">— — — END OF REPORT — — —</div>
<div class="signatures">
{sig_html}
</div>
<div class="footer">{footer}<br/>This is a computer-generated report. Correlation with clinical findings is advised.</div>
</body></html>"""
