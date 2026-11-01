"""Remedium-style lab report formatting, formulas, and PDF HTML."""

import re
from collections import OrderedDict
from html import escape

import frappe
from frappe.utils import cint, cstr, flt, get_datetime, get_url

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


# Geometry taken from the supplied full-page A4 NABL / Non-NABL designs (723×1024px ≡ 210×297mm).
# Header rule ends at y=126 (127px → 36.83mm). Footer rule starts at y=940 (84px → 24.36mm).
A4_WIDTH_MM = 210
A4_HEIGHT_MM = 297
LETTERHEAD_HEADER_MM = 36.83
LETTERHEAD_FOOTER_MM = 24.36
LETTERHEAD_SIDE_MM = 8
LETTERHEAD_GAP_MM = 1.5
LETTERHEAD_BODY_TOP_MM = round(LETTERHEAD_HEADER_MM + LETTERHEAD_GAP_MM, 2)
LETTERHEAD_BODY_BOTTOM_MM = round(LETTERHEAD_FOOTER_MM + LETTERHEAD_GAP_MM, 2)


def _absolute_asset(path):
    if not path:
        return ""
    if str(path).startswith("http"):
        return path
    try:
        return get_url(path)
    except Exception:
        return path


def _pdf_asset(path):
    """Prefer a local file:// URL so wkhtmltopdf can paint letterhead without HTTP."""
    import os

    raw = cstr(path or "")
    if not raw:
        return ""
    try:
        fname = raw.rsplit("/", 1)[-1].split("?")[0]
        if raw.startswith("/private/files/") or "/private/files/" in raw:
            local = frappe.get_site_path("private", "files", fname)
        else:
            local = frappe.get_site_path("public", "files", fname)
        if local and os.path.isfile(local):
            return "file://" + local.replace("\\", "/")
    except Exception:
        pass
    return _absolute_asset(path)


def _local_letterhead_path(url):
    """Resolve a branding File URL to a disk path wkhtmltopdf can read."""
    import os

    raw = cstr(url or "")
    if not raw:
        return ""
    if raw.startswith("file://"):
        path = raw[7:]
        return path if os.path.isfile(path) else ""
    fname = raw.rsplit("/", 1)[-1].split("?")[0]
    if not fname:
        return ""
    candidates = []
    try:
        if "/private/files/" in raw:
            candidates.append(frappe.get_site_path("private", "files", fname))
        candidates.append(frappe.get_site_path("public", "files", fname))
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(here, "report_assets", fname))
    alias = {
        "remedium-nabl-header.png": "nabl-header.png",
        "remedium-non-nabl-header.png": "non-nabl-header.png",
        "remedium-report-footer.png": "report-footer.png",
        "remedium-nabl-page.png": "nabl-page.png",
        "remedium-non-nabl-page.png": "non-nabl-page.png",
    }
    if fname in alias:
        candidates.append(os.path.join(here, "report_assets", alias[fname]))
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return ""


def _image_data_uri(path):
    """Embed a local image so wkhtmltopdf does not need file:// (ProtocolUnknownError)."""
    import base64
    import os

    if not path or not os.path.isfile(path):
        return ""
    ext = os.path.splitext(path)[1].lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(ext, "image/png")
    with open(path, "rb") as fh:
        payload = base64.b64encode(fh.read()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def _letterhead_band_document(image_path, height_mm):
    src = _image_data_uri(image_path)
    if not src:
        src = "file://" + cstr(image_path).replace("\\", "/")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
html, body {{ margin: 0; padding: 0; width: {A4_WIDTH_MM}mm; height: {height_mm}mm; overflow: hidden; }}
img {{ width: {A4_WIDTH_MM}mm; height: {height_mm}mm; display: block; border: 0; }}
</style></head>
<body><img src="{src}" alt="" /></body></html>"""


def _stamp_letterhead_in_html(html, header_path, footer_path):
    header_uri = _image_data_uri(header_path)
    footer_uri = _image_data_uri(footer_path)
    header_html = (
        f'<div class="report-chrome-header"><img class="header-banner header-banner-full" src="{header_uri}" alt="" /></div>'
        if header_uri
        else ""
    )
    footer_html = (
        f'<div class="report-chrome-footer"><img class="footer-banner footer-banner-full" src="{footer_uri}" alt="" /></div>'
        if footer_uri
        else ""
    )
    if header_html:
        html = re.sub(r"(<body[^>]*>)", r"\1" + header_html, html, count=1, flags=re.I)
    if footer_html:
        html = re.sub(r"</body>", footer_html + "</body>", html, count=1, flags=re.I)
    return html


CONTENT_MARGIN_MM = 12


def html_to_lab_report_pdf(html, chrome_mode=None):
    """A4 portrait PDF. Header/footer bands are wkhtmltopdf chrome so they pin to every page."""
    import os
    import tempfile

    from frappe.utils.pdf import get_pdf

    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

    mode = normalize_report_chrome_mode(chrome_mode, 0)
    if mode == "none":
        options = {
            "page-size": "A4",
            "orientation": "Portrait",
            "margin-top": f"{CONTENT_MARGIN_MM}mm",
            "margin-bottom": f"{CONTENT_MARGIN_MM}mm",
            "margin-left": f"{CONTENT_MARGIN_MM}mm",
            "margin-right": f"{CONTENT_MARGIN_MM}mm",
            "disable-smart-shrinking": None,
            "print-media-type": None,
            "enable-local-file-access": None,
            "encoding": "UTF-8",
            "quiet": None,
            "load-error-handling": "ignore",
            "load-media-error-handling": "ignore",
        }
        return get_pdf(html, options=options)

    branding = get_report_branding()
    header_src = ""
    footer_src = branding.get("footer_banner") or ""
    if mode == "nabl":
        header_src = branding.get("nabl_header_banner") or branding.get("header_banner") or ""
    elif mode == "non_nabl":
        header_src = branding.get("non_nabl_header_banner") or ""

    header_path = _local_letterhead_path(header_src)
    footer_path = _local_letterhead_path(footer_src)
    here = os.path.dirname(os.path.abspath(__file__))
    if not header_path:
        fallback = "nabl-header.png" if mode == "nabl" else "non-nabl-header.png"
        cand = os.path.join(here, "report_assets", fallback)
        if os.path.isfile(cand):
            header_path = cand
    if not footer_path:
        cand = os.path.join(here, "report_assets", "report-footer.png")
        if os.path.isfile(cand):
            footer_path = cand

    def _write_band(img_path, height_mm, kind):
        name = os.path.join(tempfile.gettempdir(), f"hec-letterhead-{kind}.html")
        with open(name, "w", encoding="utf-8") as fh:
            fh.write(_letterhead_band_document(img_path, height_mm))
        return name

    options = {
        "page-size": "A4",
        "orientation": "Portrait",
        "margin-top": f"{LETTERHEAD_HEADER_MM}mm",
        "margin-bottom": f"{LETTERHEAD_FOOTER_MM}mm",
        "margin-left": "0mm",
        "margin-right": "0mm",
        "header-spacing": "0",
        "footer-spacing": "0",
        "disable-smart-shrinking": None,
        "print-media-type": None,
        "enable-local-file-access": None,
        "background": None,
        "images": None,
        "encoding": "UTF-8",
        "quiet": None,
        "load-error-handling": "ignore",
        "load-media-error-handling": "ignore",
    }
    if header_path:
        options["header-html"] = _write_band(header_path, LETTERHEAD_HEADER_MM, "header")
    if footer_path:
        options["footer-html"] = _write_band(footer_path, LETTERHEAD_FOOTER_MM, "footer")
    try:
        return get_pdf(html, options=options)
    except Exception:
        frappe.log_error(title="lab_report_pdf_letterhead", message=frappe.get_traceback())
        fallback = {
            "page-size": "A4",
            "orientation": "Portrait",
            "margin-top": "0mm",
            "margin-bottom": "0mm",
            "margin-left": "0mm",
            "margin-right": "0mm",
            "disable-smart-shrinking": None,
            "print-media-type": None,
            "enable-local-file-access": None,
            "encoding": "UTF-8",
            "quiet": None,
            "load-error-handling": "ignore",
            "load-media-error-handling": "ignore",
        }
        return get_pdf(_stamp_letterhead_in_html(html, header_path, footer_path), options=fallback)


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
        row = frappe._dict(row) if not isinstance(row, frappe._dict) else row
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
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase59_parameter_inventory import (
            expand_formula_aliases,
        )

        variables = expand_formula_aliases(variables)
    except Exception:
        pass
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
        ref_text = getattr(row, "reference_range_label", None) or reference_label(row.lower_range, row.upper_range)
        groups[key]["parameters"].append(
            {
                "analyte_test_name": row.description,
                "numeric_result_value": row.result_value,
                "unit_of_measure": row.unit,
                "reference_range": ref_text,
                "method": row.method,
                "machine_name": getattr(row, "machine_name", None) or "",
                "abnormal_flag": flag,
                "clinical_category": getattr(row, "clinical_category", None) or "",
                "is_abnormal": is_abnormal(flag),
                "interpretation": row.interpretation or "",
                "result_input_type": getattr(row, "result_input_type", None) or "Numeric",
                "print_style": getattr(row, "print_style", None) or "Normal",
                "before_heading": getattr(row, "before_heading", None) or "",
                "linked_info_role": getattr(row, "linked_info_role", None) or "None",
            }
        )
        if row.method and not groups[key]["machine_method"]:
            machine = getattr(row, "machine_name", None) or ""
            groups[key]["machine_method"] = (
                f"{row.method} · {machine}" if machine else row.method
            )
        elif getattr(row, "machine_name", None) and groups[key].get("machine_method") and " · " not in (
            groups[key].get("machine_method") or ""
        ):
            groups[key]["machine_method"] = f"{groups[key]['machine_method']} · {row.machine_name}"
        if row.interpretation and not groups[key]["interpretation"]:
            groups[key]["interpretation"] = row.interpretation
        # Graph meta from Lab Report
        if not groups[key].get("graph_attachment") and getattr(doc, "allow_graph_upload", 0):
            groups[key]["allow_graph_upload"] = 1
            groups[key]["graph_label"] = getattr(doc, "graph_label", None) or "Graph"
            groups[key]["graph_attachment"] = getattr(doc, "graph_attachment", None) or ""
            groups[key]["graph_notes"] = getattr(doc, "graph_notes", None) or ""
    sections = list(groups.values())
    for section in sections:
        # Keep master order; don't re-sort headings away from linked fields
        pass
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
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import format_patient_age

    age_label = format_patient_age(
        doc.age or getattr(trf, "age", None),
        getattr(trf, "age_months", None),
        getattr(trf, "age_days", None),
    )
    gender_age = " / ".join([p for p in (age_label, (gender[:1].upper() if gender else "")) if p])
    return {
        "lab_report": doc.name,
        "patient_name": doc.patient_name or trf.patient_name,
        "gender_age": gender_age or gender,
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


def normalize_report_chrome_mode(chrome_mode=None, letterhead_plain=0):
    """nabl | non_nabl | none — none also used for pre-printed letterhead."""
    mode = (cstr(chrome_mode) or "").strip().lower().replace("-", "_").replace(" ", "_")
    if cint(letterhead_plain) or mode in ("none", "plain", "headerless", "no_header", "without_header", "without_header_footer"):
        return "none"
    if mode in ("non_nabl", "nonnabl"):
        return "non_nabl"
    return "nabl"


def render_remedium_lab_report_html(payload, letterhead_plain=0, chrome_mode=None, for_pdf=0):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

    branding = get_report_branding()
    lab_name = escape(branding.get("lab_name") or "REMEDIUM DIAGNOSTICS")
    tagline = escape(branding.get("lab_tagline") or "")
    lab_address = escape(branding.get("lab_address") or "")
    lab_phone = escape(branding.get("lab_phone") or "")
    lab_website = escape(branding.get("lab_website") or "")
    accent = branding.get("report_primary_color") or "#0b5cab"
    accent_safe = escape(accent)
    footer = escape(branding.get("report_footer") or "")
    nabl_line = escape(
        branding.get("nabl_accreditation") or "NABL Accredited Laboratory | ISO 15189:2022"
    )
    nabl_cert = escape(branding.get("nabl_certificate_no") or "")
    mode = normalize_report_chrome_mode(chrome_mode, letterhead_plain)
    pdf_mode = cint(for_pdf)
    asset = _pdf_asset if pdf_mode else _absolute_asset
    logo = asset(branding.get("lab_logo") or "")
    nabl_logo = asset(branding.get("nabl_logo") or "")
    nabl_header = asset(
        branding.get("nabl_header_banner") or branding.get("header_banner") or ""
    )
    non_nabl_header = asset(branding.get("non_nabl_header_banner") or "")
    footer_banner = asset(branding.get("footer_banner") or "")
    show_auth_badge = cint(branding.get("show_authorized_badge") if branding.get("show_authorized_badge") is not None else 1)

    logo_html = (
        f'<img src="{escape(logo)}" alt="Lab logo" class="lab-logo" />' if logo else f'<div class="lab-logo-fallback">{lab_name[:1]}</div>'
    )
    nabl_logo_html = (
        f'<img src="{escape(nabl_logo)}" alt="NABL" class="nabl-logo" />'
        if nabl_logo
        else f'<div class="nabl-logo-fallback">NABL</div>'
    )
    contact_bits = " · ".join([b for b in (lab_phone, lab_website) if b])
    contact_html = f"<div class='lab-contact'>{contact_bits}</div>" if contact_bits else ""
    address_html = f"<div class='lab-address'>{lab_address}</div>" if lab_address else ""
    nabl_cert_html = f" | Cert. No. {nabl_cert}" if nabl_cert else ""
    footer_banner_html = (
        f'<img src="{escape(footer_banner)}" alt="" class="footer-banner footer-banner-full" />' if footer_banner else ""
    )

    header_banner_html = ""
    constructed_header = True
    nabl_strip_html = f"<div class='nabl-strip'>{nabl_line}{nabl_cert_html}</div>"
    if mode == "none":
        header_banner_html = ""
        constructed_header = False
        nabl_strip_html = ""
        footer_banner_html = ""
    elif mode == "nabl" and nabl_header:
        header_banner_html = (
            f'<img src="{escape(nabl_header)}" alt="" class="header-banner header-banner-full" />'
        )
        constructed_header = False
        nabl_strip_html = ""
    elif mode == "non_nabl" and non_nabl_header:
        header_banner_html = (
            f'<img src="{escape(non_nabl_header)}" alt="" class="header-banner header-banner-full" />'
        )
        constructed_header = False
        nabl_strip_html = ""
    elif mode == "non_nabl":
        nabl_strip_html = ""
        nabl_logo_html = ""
    elif nabl_header:
        header_banner_html = (
            f'<img src="{escape(nabl_header)}" alt="" class="header-banner" />'
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
            rtype = (row.get("result_input_type") or "Numeric").strip()
            if rtype == "Spacer":
                rows += "<tr class='param-spacer'><td colspan='5'>&nbsp;</td></tr>"
                continue
            name = escape(str(row.get("analyte_test_name") or ""))
            style = (row.get("print_style") or "Normal").strip()
            style_cls = {
                "Bold": "style-bold",
                "Underline": "style-underline",
                "Bold Underline": "style-bold style-underline",
            }.get(style, "")
            if row.get("before_heading"):
                rows += (
                    f"<tr class='param-before'><td colspan='5'>"
                    f"<strong>{escape(str(row.get('before_heading')))}</strong></td></tr>"
                )
            if rtype == "Heading":
                rows += f"<tr class='param-heading'><td colspan='5' class='{style_cls}'>{name}</td></tr>"
                continue
            abnormal = row.get("is_abnormal")
            ref_text = str(row.get("reference_range") or "")
            ref_html = escape(ref_text).replace("\n", "<br>")
            category = (row.get("clinical_category") or "").strip()
            flag_display = category or row.get("abnormal_flag")
            rows += (
                "<tr>"
                f"<td class='param-name {style_cls}'>{name}</td>"
                f"<td class='param-result'>{_result_cell(row.get('numeric_result_value'), abnormal)}</td>"
                f"<td class='param-unit'>{escape(str(row.get('unit_of_measure') or ''))}</td>"
                f"<td class='param-ref'>{ref_html}</td>"
                f"<td class='param-flag'>{_flag_cell(flag_display)}</td>"
                "</tr>"
            )
        method = escape(str(section.get("machine_method") or ""))
        interpretation = section.get("interpretation") or ""
        graph_html = ""
        if section.get("allow_graph_upload") and section.get("graph_attachment"):
            glabel = escape(str(section.get("graph_label") or "Graph"))
            gurl = escape(str(section.get("graph_attachment")))
            gnotes = escape(str(section.get("graph_notes") or ""))
            graph_html = (
                f"<div class='graph-box'><div class='graph-title'>{glabel}</div>"
                f"<img class='graph-img' src='{gurl}' alt='{glabel}' />"
            )
            if gnotes:
                graph_html += f"<div class='graph-notes'>{gnotes}</div>"
            graph_html += "</div>"
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
          {graph_html}
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

    sig_cells = ""
    for sig in signatories[:5]:
        sig_cells += f"""
    <td class="sig-cell" width="20%">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">{escape(str(sig.get("name") or " "))}&nbsp;</div>
      <div class="sig-qual">{escape(str(sig.get("qualification") or ""))}&nbsp;</div>
      <div class="sig-role">{escape(str(sig.get("role") or ""))}</div>
      <div class="sig-dept">{escape(str(sig.get("department") or ""))}</div>
    </td>"""

    title_line = f"<div class='report-title'>{report_title}</div>" if report_title else ""
    dept_line = f"<div class='dept-badge'>{department}</div>" if department else ""
    auth_badge = (
        "<td class='auth-cell'><div class='authorized-badge'>FINAL REPORT</div></td>"
        if (authorized and show_auth_badge)
        else "<td class='auth-cell'></td>"
    )
    plain = 1 if mode == "none" else 0
    body_classes = ["report-a4"]
    if pdf_mode:
        body_classes.append("pdf-mode")
    if plain:
        body_classes.append("letterhead-plain")
    body_classes.append(f"chrome-{mode}")
    body_class = f' class="{" ".join(body_classes)}"'
    toggle_checked = " checked" if plain else ""
    if pdf_mode:
        page_margin = f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: 0; }}"
    elif plain:
        page_margin = (
            f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: {LETTERHEAD_HEADER_MM}mm {LETTERHEAD_SIDE_MM}mm {LETTERHEAD_FOOTER_MM}mm {LETTERHEAD_SIDE_MM}mm; }}"
        )
    else:
        page_margin = f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: 0; }}"
    header_table_html = ""
    if constructed_header:
        header_table_html = f"""<table class="header-table" cellpadding="0" cellspacing="0">
  <tr>
    <td width="18%" align="left">{logo_html}</td>
    <td width="54%" align="center" class="brand-block">
      <h1>{lab_name}</h1>
      {f"<div class='tagline'>{tagline}</div>" if tagline else ""}
      {address_html}
      {contact_html}
    </td>
    <td width="18%" align="right">{nabl_logo_html}</td>
    {auth_badge}
  </tr>
</table>"""
    toolbar_html = ""
    if not pdf_mode:
        toolbar_html = f"""<div class="print-toolbar" id="print-toolbar">
  <label>
    <input type="checkbox" id="letterhead-toggle"{toggle_checked} />
    Headerless / footerless — print on Remedium letterhead
  </label>
  <button type="button" onclick="window.print()">Print</button>
  <span style="opacity:.9">Leaves space for the pre-printed header and footer.</span>
</div>"""
    script_html = ""
    if not pdf_mode:
        script_html = f"""<script>
(function () {{
  var KEY = "hec_nabl_letterhead_plain";
  var box = document.getElementById("letterhead-toggle");
  var pageStyle = document.getElementById("letterhead-page-style");
  function apply(on) {{
    document.body.classList.toggle("letterhead-plain", !!on);
    if (pageStyle) {{
      pageStyle.textContent = on
        ? "@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: {LETTERHEAD_HEADER_MM}mm {LETTERHEAD_SIDE_MM}mm {LETTERHEAD_FOOTER_MM}mm {LETTERHEAD_SIDE_MM}mm; }}"
        : "@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: 0; }}";
    }}
    try {{ localStorage.setItem(KEY, on ? "1" : "0"); }} catch (e) {{}}
  }}
  var start = {str(plain).lower()};
  try {{
    if (localStorage.getItem(KEY) === "1") start = true;
    if (localStorage.getItem(KEY) === "0" && !{str(plain).lower()}) start = false;
  }} catch (e) {{}}
  if (box) {{
    box.checked = !!start;
    box.addEventListener("change", function () {{ apply(box.checked); }});
  }}
  apply(start);
}})();
</script>"""
    footer_extra = ""
    if mode != "none" and not footer_banner_html and footer:
        footer_extra = f'<div class="footer-fallback">{footer}</div>'

    # PDF letterhead is painted by wkhtmltopdf header/footer HTML.
    # Without Header/Footer must omit every chrome band, banner, and disclaimer.
    show_in_body_chrome = (not pdf_mode) and mode != "none"
    chrome_header_html = ""
    chrome_footer_html = ""
    if show_in_body_chrome:
        chrome_header_html = f"""<div class="report-chrome-header">
{header_banner_html}
{header_table_html}
{nabl_strip_html}
</div>"""
        chrome_footer_html = f"""<div class="report-chrome-footer">
{footer_banner_html}
{footer_extra}
</div>"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{lab_name} — Lab Report</title>
<style>
@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: 0; }}
* {{ box-sizing: border-box; }}
html, body {{ width: {A4_WIDTH_MM}mm; margin: 0; padding: 0; }}
body {{ font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; line-height: 1.35; background: #fff; }}
.report-chrome-header, .report-chrome-footer {{ width: {A4_WIDTH_MM}mm; overflow: hidden; }}
.report-chrome-header {{ height: {LETTERHEAD_HEADER_MM}mm; }}
.report-chrome-footer {{ height: {LETTERHEAD_FOOTER_MM}mm; }}
.header-banner, .header-banner-full {{
  width: {A4_WIDTH_MM}mm; height: {LETTERHEAD_HEADER_MM}mm; display: block; margin: 0; padding: 0; border: 0;
}}
.footer-banner, .footer-banner-full {{
  width: {A4_WIDTH_MM}mm; height: {LETTERHEAD_FOOTER_MM}mm; display: block; margin: 0; padding: 0; border: 0;
}}
.report-sheet {{
  padding: {LETTERHEAD_BODY_TOP_MM}mm {LETTERHEAD_SIDE_MM}mm {LETTERHEAD_BODY_BOTTOM_MM}mm {LETTERHEAD_SIDE_MM}mm;
}}
body.pdf-mode .report-sheet {{
  padding: 2mm {LETTERHEAD_SIDE_MM}mm 3mm {LETTERHEAD_SIDE_MM}mm;
}}
body.pdf-mode.letterhead-plain .report-sheet {{ padding: 0; }}
body.letterhead-plain .report-chrome-header,
body.letterhead-plain .report-chrome-footer,
body.letterhead-plain .footer-banner,
body.letterhead-plain .footer-fallback,
body.letterhead-plain .header-banner,
body.chrome-none .report-chrome-header,
body.chrome-none .report-chrome-footer,
body.chrome-none .footer-banner,
body.chrome-none .footer-fallback,
body.chrome-none .header-banner {{ display: none !important; }}
body.letterhead-plain .report-sheet {{
  padding: 0 {LETTERHEAD_SIDE_MM}mm;
}}
body.pdf-mode.chrome-none .report-sheet,
body.pdf-mode.letterhead-plain .report-sheet {{
  padding: 0;
}}
body:not(.pdf-mode) {{ background: #e8eef2; }}
body:not(.pdf-mode) .report-a4-frame {{
  width: {A4_WIDTH_MM}mm; min-height: {A4_HEIGHT_MM}mm; margin: 12px auto; background: #fff;
  position: relative; box-shadow: 0 4px 18px rgba(15,23,42,.12);
}}
body:not(.pdf-mode) .report-chrome-header {{ position: absolute; top: 0; left: 0; }}
body:not(.pdf-mode) .report-chrome-footer {{ position: absolute; bottom: 0; left: 0; }}
.header-table {{ width: 100%; height: {LETTERHEAD_HEADER_MM}mm; border-collapse: collapse; }}
.header-table td {{ vertical-align: middle; padding: 4px 8px; }}
.lab-logo, .nabl-logo {{ max-height: 28mm; max-width: 42mm; }}
.lab-logo-fallback, .nabl-logo-fallback {{
  width: 56px; height: 56px; line-height: 56px; text-align: center; font-weight: 700;
  background: {accent_safe}; color: #fff; font-size: 22px;
}}
.nabl-logo-fallback {{ background: #b45309; font-size: 14px; letter-spacing: 1px; }}
.brand-block h1 {{ margin: 0; font-size: 20px; font-weight: 700; color: {accent_safe}; letter-spacing: 0.3px; }}
.brand-block .tagline {{ margin: 2px 0 0; font-size: 11px; color: #475569; }}
.lab-address, .lab-contact {{ margin-top: 2px; font-size: 9px; color: #64748b; }}
.nabl-strip {{
  background: #fffbeb; color: #92400e; text-align: center; font-size: 10px; font-weight: 700;
  padding: 5px 8px; border-bottom: 1px solid #f59e0b; letter-spacing: 0.3px;
}}
.authorized-badge {{
  background: #dcfce7; color: #166534; border: 1px solid #86efac; font-size: 10px; font-weight: 700;
  padding: 6px 8px; text-align: center; letter-spacing: 1px; white-space: nowrap;
}}
.patient-info-box {{ margin: 4px 0 8px; border: 1.5px solid {accent_safe}; }}
.meta-grid, .ts-grid {{ width: 100%; border-collapse: collapse; }}
.meta-grid td {{ padding: 4px 8px; border: 1px solid #cbd5e1; font-size: 10.5px; vertical-align: middle; }}
.meta-grid .meta-label {{ background: #f1f5f9; color: #475569; font-weight: 600; width: 16%; white-space: nowrap; }}
.meta-grid .meta-value {{ color: #0f172a; font-weight: 600; width: 34%; }}
.ts-grid {{ background: #f8fafc; border-top: 1.5px solid {accent_safe}; }}
.ts-grid td {{ padding: 4px 8px; border: 1px solid #cbd5e1; font-size: 10px; }}
.ts-grid .ts-label {{ color: #64748b; font-weight: 600; width: 16%; white-space: nowrap; }}
.ts-grid .ts-value {{ color: #0f172a; font-weight: 700; width: 34%; }}
.report-title {{ text-align: center; font-size: 13px; font-weight: 700; color: {accent_safe}; margin: 4px 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }}
.dept-badge {{ text-align: center; font-size: 10px; color: #64748b; margin-bottom: 6px; }}
.test-section {{ margin-top: 12px; page-break-inside: avoid; }}
.category-bar {{ background: {accent_safe}; color: #fff; text-align: center; font-weight: 700; font-size: 11px; padding: 6px 10px; letter-spacing: 0.8px; }}
.test-heading {{ text-align: center; font-size: 13px; font-weight: 700; margin: 0; padding: 8px; color: #0f172a; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }}
.results-table {{ width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; }}
.results-table th {{ background: #334155; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 600; }}
.results-table td {{ padding: 5px 8px; border-bottom: 1px solid #eef2f7; font-size: 10.5px; }}
.results-table tbody tr:nth-child(even) {{ background: #f8fafc; }}
.param-result {{ font-weight: 600; text-align: center; }}
.param-unit, .param-ref, .param-flag {{ text-align: center; color: #475569; }}
.param-name {{ font-weight: 500; }}
.style-bold {{ font-weight: 800; }}
.style-underline {{ text-decoration: underline; }}
.param-heading td {{ padding-top: 8px; font-size: 12px; border-bottom: 1px solid #cbd5e1; }}
.graph-box {{ margin: 10px 0 6px; padding: 8px; border: 1px solid #dbe3ea; background: #f8fafc; }}
.graph-title {{ font-weight: 700; margin-bottom: 6px; font-size: 12px; color: #0f766e; }}
.graph-img {{ max-width: 100%; height: auto; display: block; margin: 0 auto; }}
.graph-notes {{ margin-top: 4px; font-size: 10px; color: #64748b; }}
.result-abnormal {{ color: #b91c1c; font-weight: 700; }}
.flag-high {{ color: #b91c1c; font-weight: 800; }}
.flag-low {{ color: #1d4ed8; font-weight: 800; }}
.flag-normal {{ color: #16a34a; }}
.empty {{ text-align: center; color: #94a3b8; font-style: italic; }}
.method-line {{ font-size: 10px; color: #475569; padding: 5px 10px; background: #f1f5f9; border: 1px solid #e2e8f0; border-top: none; }}
.interpretation-box {{ font-size: 10px; line-height: 1.45; padding: 8px 10px; margin-top: 6px; background: #fffbeb; border-left: 4px solid #f59e0b; }}
.interpretation-title {{ font-weight: 700; font-size: 11px; margin-bottom: 4px; }}
.interpretation-body p {{ margin: 0 0 4px; }}
.notes-box {{ margin-top: 10px; padding: 8px 10px; background: #f0f9ff; border-left: 4px solid {accent_safe}; font-size: 10px; }}
.notes-box.subtle {{ background: #f8fafc; border-left-color: #94a3b8; }}
.end-report {{ text-align: center; margin: 18px 0 12px; font-weight: 700; letter-spacing: 2px; color: {accent_safe}; font-size: 11px; }}
.sig-table {{ width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: avoid; }}
.sig-cell {{ text-align: center; vertical-align: top; padding: 0 4px; }}
.sig-line {{ border-top: 2px solid {accent_safe}; margin: 28px 6px 6px; height: 0; font-size: 1px; line-height: 1px; }}
.sig-name {{ font-weight: 700; font-size: 10px; min-height: 14px; }}
.sig-qual {{ font-size: 9px; color: #64748b; margin-top: 2px; min-height: 12px; }}
.sig-role {{ font-size: 9px; color: {accent_safe}; font-weight: 600; margin-top: 3px; }}
.sig-dept {{ font-size: 8px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.3px; }}
.footer-fallback {{ text-align: center; font-size: 8px; color: #64748b; padding: 4px 8px; }}
.legend {{ font-size: 9px; color: #64748b; text-align: right; margin: 6px 2px 0; }}
.auth-cell {{ width: 110px; text-align: right; }}
.print-toolbar {{
  position: sticky; top: 0; z-index: 40;
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
  background: {accent_safe}; color: #fff; padding: 8px 12px; font-size: 13px;
}}
.print-toolbar label {{ display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }}
.print-toolbar button {{
  background: #fff; color: {accent_safe}; border: 0; border-radius: 4px;
  padding: 6px 12px; font-weight: 700; cursor: pointer;
}}
@media print {{
  .print-toolbar {{ display: none !important; }}
  body {{ background: #fff; }}
  body:not(.letterhead-plain) .report-chrome-header,
  body:not(.letterhead-plain) .report-chrome-footer {{
    position: fixed; left: 0; z-index: 10;
  }}
  body:not(.letterhead-plain) .report-chrome-header {{ top: 0; }}
  body:not(.letterhead-plain) .report-chrome-footer {{ bottom: 0; }}
  body:not(.pdf-mode) .report-a4-frame {{ margin: 0; box-shadow: none; }}
}}
</style>
<style id="letterhead-page-style">{page_margin}</style>
</head><body{body_class}>
{toolbar_html}
<div class="report-a4-frame">
{chrome_header_html}
<div class="report-sheet">
{title_line}{dept_line}
<div class="patient-info-box">
  <table class="meta-grid"><tbody>{meta_html}</tbody></table>
  <table class="ts-grid"><tbody>{ts_html}</tbody></table>
</div>
<div class="legend">H = High · L = Low · • = Within range</div>
{sections_html}
{notes_html}
<div class="end-report">*** End Of Report ***</div>
<table class="sig-table"><tr>{sig_cells}</tr></table>
</div>
{chrome_footer_html}
</div>
{script_html}
</body></html>"""


def smoke_letterhead_plain_html():
    """Verify NABL HTML can hide chrome and keep letterhead-safe page margins."""
    payload = {
        "patient_name": "Letterhead Smoke",
        "gender_age": "30 Y / M",
        "lab_no": "SMOKE-LH",
        "test_sections": [],
    }
    html_full = render_remedium_lab_report_html(payload, letterhead_plain=0)
    html_plain = render_remedium_lab_report_html(payload, letterhead_plain=1)
    html_pdf = render_remedium_lab_report_html(payload, chrome_mode="nabl", for_pdf=1)
    html_none_pdf = render_remedium_lab_report_html(payload, chrome_mode="none", for_pdf=1)
    ok = bool(
        "letterhead-toggle" in html_full
        and "report-chrome-header" in html_full
        and "report-chrome-footer" in html_full
        and "letterhead-plain" in html_plain
        and f"{LETTERHEAD_HEADER_MM}mm" in html_plain
        and "pdf-mode" in html_pdf
        and "report-sheet" in html_pdf
        and "This is a computer-generated report" not in html_pdf
        and "This is a computer-generated report" not in html_none_pdf
        and 'class="report-chrome-header"' not in html_pdf
        and 'class="report-chrome-header"' not in html_none_pdf
        and 'class="report-chrome-footer"' not in html_none_pdf
        and 'class="footer-banner' not in html_none_pdf
        and 'class="footer-fallback' not in html_none_pdf
        and 'class="header-banner' not in html_none_pdf
    )
    print("RESULT " + ("SMOKE_OK" if ok else "SMOKE_FAIL"))
    return {
        "ok": ok,
        "full_has_toggle": "letterhead-toggle" in html_full,
        "plain_class": "letterhead-plain" in html_plain,
        "plain_margins": f"{LETTERHEAD_HEADER_MM}mm" in html_plain,
        "pdf_omits_in_body_chrome": 'class="report-chrome-header"' not in html_pdf,
        "none_pdf_omits_chrome": 'class="report-chrome-header"' not in html_none_pdf,
        "header_mm": LETTERHEAD_HEADER_MM,
        "footer_mm": LETTERHEAD_FOOTER_MM,
    }
