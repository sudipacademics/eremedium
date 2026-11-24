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
# Clear space under footer artwork on every page (above the physical page edge).
FOOTER_EDGE_GAP_MM = 1.0
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


def _letterhead_file_mtime(url):
    """mtime of a letterhead file on disk, or 0 if missing."""
    import os

    path = _local_letterhead_path(url)
    if not path:
        return 0.0
    try:
        return float(os.path.getmtime(path))
    except Exception:
        return 0.0


def _pick_letterhead_url(*candidates):
    """Prefer the first existing file; later candidates are fallbacks only."""
    fallback = ""
    for raw in candidates:
        url = cstr(raw or "").strip().split("?", 1)[0]
        if not url:
            continue
        if _letterhead_file_mtime(url) > 0:
            return url
        if not fallback:
            fallback = url
    return fallback


def _resolve_with_header_band_urls(mode, geo, branding):
    """NABL / Non-NABL header+footer URLs for With Header downloads.

    Test Master ``is_nabl`` already chose ``mode``. Template Management for that
    mode wins when its file exists on disk. A Non-NABL report never borrows the
    NABL letterhead, even when the Non-NABL slot is still the bundled file.
    """
    geo = geo or {}
    branding = branding or {}
    layout_header = cstr(geo.get("header_image") or "")
    layout_footer = cstr(geo.get("footer_image") or "")
    brand_footer = cstr(branding.get("footer_banner") or "")
    non_nabl = mode == "non_nabl" or str(mode).endswith("_non_nabl")
    if non_nabl:
        brand_header = cstr(branding.get("non_nabl_header_banner") or "")
    else:
        brand_header = cstr(
            branding.get("nabl_header_banner") or branding.get("header_banner") or ""
        )
    header = _pick_letterhead_url(layout_header, brand_header)
    footer = _pick_letterhead_url(layout_footer, brand_footer)
    return header, footer


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


def _letterhead_natural_height_mm(image_path, fallback_mm):
    """Keep strip aspect (e.g. 723×127 → ~36.8mm) so wkhtmltopdf does not crop the logo row."""
    import os

    try:
        from PIL import Image

        if image_path and os.path.isfile(image_path):
            with Image.open(image_path) as im:
                w, h = im.size
            if w > 0 and h > 0:
                return round((float(h) / float(w)) * A4_WIDTH_MM, 2)
    except Exception:
        pass
    return float(fallback_mm or LETTERHEAD_HEADER_MM)


# wkhtmltopdf header-html / footer-html viewports clip a few mm at the outer edge.
# Reserve this slack in --margin-top/--margin-bottom and pad the band document so the
# Remedium logo row is not chopped off.
LETTERHEAD_CHROME_SLACK_MM = 2.5


def _pdf_pt(mm):
    """PDF points. wkhtmltopdf header HTML maps 1 CSS pixel to 1 point, so a
    96dpi pixel size paints about a third larger than the millimetre margin."""
    return max(1, int(round(float(mm) * 72.0 / 25.4)))


# Print raster. The source artwork is ~723px, and a 144dpi resize shows as
# blocks when the PDF is opened. 300dpi with a smooth resample stays the same
# millimetre size on the page.
LETTERHEAD_PRINT_DPI = 300


def _fitted_png_data_uri(image_path, height_mm):
    """Raster the band at print resolution. Display size is still the margin."""
    import base64
    import io

    from PIL import Image, ImageFilter

    width_px = max(1, int(round(float(A4_WIDTH_MM) / 25.4 * LETTERHEAD_PRINT_DPI)))
    height_px = max(1, int(round(float(height_mm) / 25.4 * LETTERHEAD_PRINT_DPI)))
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
    with Image.open(image_path) as im:
        im = im.convert("RGBA")
        source_smaller = im.size[0] < width_px or im.size[1] < height_px
        fitted = im.resize((width_px, height_px), resample)
        if source_smaller:
            fitted = fitted.filter(ImageFilter.UnsharpMask(radius=0.6, percent=40, threshold=2))
        bg = Image.new("RGB", (width_px, height_px), (255, 255, 255))
        bg.paste(fitted, mask=fitted.split()[-1])
        buf = io.BytesIO()
        bg.save(buf, format="PNG")
    payload = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{payload}", _pdf_pt(A4_WIDTH_MM), _pdf_pt(height_mm)


def _letterhead_band_document(image_path, height_mm, kind="header"):
    """Full-bleed A4 strip pinned by wkhtmltopdf header/footer HTML.

    The image is given in millimetres and in PDF points. Header documents treat
    CSS pixels as points, so a 96dpi pixel width overflows the A4 margin and
    the outer edge of the artwork is clipped.
    """
    height_mm = max(1.0, float(height_mm or LETTERHEAD_HEADER_MM))
    width_pt = _pdf_pt(A4_WIDTH_MM)
    height_pt = _pdf_pt(height_mm)
    try:
        src, width_pt, height_pt = _fitted_png_data_uri(image_path, height_mm)
    except Exception:
        src = _image_data_uri(image_path)
    if not src:
        src = "file://" + cstr(image_path).replace("\\", "/")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{kind}</title></head>
<body style="margin:0;padding:0;background:#fff;overflow:hidden;">
<img src="{src}" width="{width_pt}" height="{height_pt}" alt=""
 style="display:block;width:{A4_WIDTH_MM}mm;height:{height_mm:.2f}mm;max-width:none;border:0;margin:0;padding:0;" />
</body></html>"""


def _inject_fixed_bands(html, header_uri, footer_uri, header_mm, footer_mm):
    """Pin letterhead to the A4 edges in the same document as the body.

    wkhtmltopdf header-html / footer-html use a separate viewport that crops the
    outer edge (logo row and footer address). Fixed bands share the page scale,
    repeat on every page, and stay the editor's millimetre size.
    """
    header_mm = float(header_mm or 0)
    footer_mm = float(footer_mm or 0)
    css = [
        ".hec-pdf-header,.hec-pdf-footer{position:fixed;left:0;margin:0;padding:0;z-index:1000;background:#fff;}",
        f".hec-pdf-header{{top:0;width:{A4_WIDTH_MM}mm;height:{header_mm}mm;}}",
        f".hec-pdf-footer{{bottom:0;width:{A4_WIDTH_MM}mm;height:{footer_mm}mm;}}",
        ".hec-pdf-header img,.hec-pdf-footer img{display:block;width:100%;height:100%;border:0;margin:0;padding:0;}",
    ]
    if header_mm > 0:
        css.append(f"body{{padding-top:{header_mm}mm !important;}}")
    if footer_mm > 0:
        css.append(f"body{{padding-bottom:{footer_mm}mm !important;}}")
    style = "<style>" + "".join(css) + "</style>"
    bands = ""
    img_style = "display:block;border:0;margin:0;padding:0;"
    if header_uri and header_mm > 0:
        bands += (
            f'<div class="hec-pdf-header"><img src="{header_uri}" alt="" '
            f'style="{img_style}width:{A4_WIDTH_MM}mm !important;height:{header_mm}mm !important;" /></div>'
        )
    if footer_uri and footer_mm > 0:
        bands += (
            f'<div class="hec-pdf-footer"><img src="{footer_uri}" alt="" '
            f'style="{img_style}width:{A4_WIDTH_MM}mm !important;height:{footer_mm}mm !important;" /></div>'
        )
    if re.search(r"</head>", html, flags=re.I):
        html = re.sub(r"</head>", style + "</head>", html, count=1, flags=re.I)
    else:
        html = style + html
    if re.search(r"<body[^>]*>", html, flags=re.I):
        html = re.sub(r"(<body[^>]*>)", r"\1" + bands, html, count=1, flags=re.I)
    else:
        html = bands + html
    return html


def _inject_blank_letterhead_bands(html, header_mm, footer_mm):
    """Reserve empty header/footer bands on every PDF page for pre-printed letterhead.

    position:fixed repeats in wkhtmltopdf; body padding keeps results clear of the bands.
    Engine top/bottom margins stay 0 so we do not double-count space.
    """
    header_mm = max(0.0, float(header_mm or 0))
    footer_mm = max(0.0, float(footer_mm or 0))
    if header_mm <= 0 and footer_mm <= 0:
        return html
    css = [
        "html,body{width:100%!important;max-width:100%!important;}",
        ".hec-blank-header,.hec-blank-footer{"
        "position:fixed;left:0;right:0;width:100%;margin:0;padding:0;"
        "background:#fff!important;z-index:1000;pointer-events:none;}",
        f".hec-blank-header{{top:0;height:{header_mm:.2f}mm;min-height:{header_mm:.2f}mm;}}",
        f".hec-blank-footer{{bottom:0;height:{footer_mm:.2f}mm;min-height:{footer_mm:.2f}mm;}}",
        # Kill any leftover @page top/bottom so only these bands reserve the artwork area.
        f"@page{{size:{A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm;margin:0 {LETTERHEAD_SIDE_MM}mm;}}",
    ]
    if header_mm > 0:
        css.append(f"body,body.pdf-mode{{padding-top:{header_mm:.2f}mm !important;}}")
    if footer_mm > 0:
        css.append(f"body,body.pdf-mode{{padding-bottom:{footer_mm:.2f}mm !important;}}")
    css.append(
        "body.pdf-mode .report-sheet,"
        "body.pdf-mode.letterhead-plain .report-sheet,"
        "body.pdf-mode.chrome-remedium_without_header .report-sheet{padding:0 !important;}"
    )
    style = "<style id=\"hec-blank-letterhead\">" + "".join(css) + "</style>"
    bands = ""
    if header_mm > 0:
        bands += f'<div class="hec-blank-header" aria-hidden="true"></div>'
    if footer_mm > 0:
        bands += f'<div class="hec-blank-footer" aria-hidden="true"></div>'
    if re.search(r"</head>", html, flags=re.I):
        html = re.sub(r"</head>", style + "</head>", html, count=1, flags=re.I)
    else:
        html = style + html
    if re.search(r"<body[^>]*>", html, flags=re.I):
        html = re.sub(r"(<body[^>]*>)", r"\1" + bands, html, count=1, flags=re.I)
    else:
        html = bands + html
    return html


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


def _write_letterhead_file(image_path, height_mm, kind):
    import tempfile

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=".html", mode="w", encoding="utf-8")
    try:
        handle.write(_letterhead_band_document(image_path, height_mm, kind))
    finally:
        handle.close()
    return handle.name


def _blank_band_document(height_mm, kind="header"):
    """White strip for wkhtmltopdf --header-html / --footer-html (repeats every page)."""
    height_mm = max(1.0, float(height_mm or LETTERHEAD_HEADER_MM))
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{kind}</title>
<style>
html,body{{margin:0;padding:0;background:#fff;overflow:hidden;}}
.band{{display:block;width:{A4_WIDTH_MM}mm;height:{height_mm:.2f}mm;background:#fff;}}
</style></head>
<body><div class="band" aria-hidden="true"></div></body></html>"""


def _write_blank_band_file(height_mm, kind="header"):
    import tempfile

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=".html", mode="w", encoding="utf-8")
    try:
        handle.write(_blank_band_document(height_mm, kind))
    finally:
        handle.close()
    return handle.name


def _prepare_body_html(html, top_mm, bottom_mm, left_mm=0, right_mm=0):
    """Keep body images working, and make @page use the same band margins as the engine."""
    try:
        from frappe.utils import scrub_urls

        html = scrub_urls(html)
    except Exception:
        pass
    try:
        from frappe.utils.pdf import inline_private_images

        html = inline_private_images(html)
    except Exception:
        pass
    rule = (
        f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; "
        f"margin: {float(top_mm):.2f}mm {float(right_mm):.2f}mm {float(bottom_mm):.2f}mm {float(left_mm):.2f}mm; }}"
    )
    # Replace EVERY @page rule. A later `#letterhead-page-style { margin: 0 }` used to
    # override the first rule and wipe blank letterhead bands on without-header PDFs.
    if re.search(r"@page\s*\{", html):
        html = re.sub(r"@page\s*\{[^}]*\}", rule, html)
    else:
        html = html.replace("</head>", f"<style>{rule}</style></head>", 1) if "</head>" in html else html
    # Final lock so no stylesheet can zero the letterhead bands again.
    lock = (
        "<style>"
        f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; "
        f"margin: {float(top_mm):.2f}mm {float(right_mm):.2f}mm {float(bottom_mm):.2f}mm {float(left_mm):.2f}mm !important; }}"
        "html,body,body.pdf-mode{width:100%!important;max-width:100%!important;}"
        "body.pdf-mode .report-a4-frame,body.pdf-mode .report-sheet,"
        "body.pdf-mode .patient-info-box,body.pdf-mode .results-table,"
        "body.pdf-mode .meta-grid,body.pdf-mode .ts-grid,body.pdf-mode .sig-table,"
        "body.pdf-mode .test-section,body.pdf-mode .interpretation-box,"
        "body.pdf-mode .report-attribution{width:100%!important;max-width:100%!important;}"
        "body.pdf-mode .report-sheet,"
        "body.pdf-mode.letterhead-plain .report-sheet,"
        "body.pdf-mode.chrome-none .report-sheet,"
        "body.pdf-mode.chrome-remedium_without_header .report-sheet{padding:0 !important;}"
        "</style>"
    )
    if "</head>" in html:
        html = html.replace("</head>", lock + "</head>", 1)
    return html


def _letterhead_pdf_options(top_mm, bottom_mm, header_file, footer_file, left_mm=0, right_mm=0):
    options = {
        "page-size": "A4",
        "orientation": "Portrait",
        "margin-top": f"{float(top_mm):.2f}mm",
        "margin-bottom": f"{float(bottom_mm):.2f}mm",
        "margin-left": f"{float(left_mm):.2f}mm",
        "margin-right": f"{float(right_mm):.2f}mm",
        "header-spacing": "0",
        "footer-spacing": "0",
        "encoding": "UTF-8",
        "quiet": "",
        "dpi": "96",
        "zoom": "1",
        "disable-smart-shrinking": "",
        "enable-local-file-access": "",
        "image-dpi": "600",
        "image-quality": "100",
        "background": "",
        "images": "",
        "load-error-handling": "ignore",
        "load-media-error-handling": "ignore",
    }
    if header_file:
        options["header-html"] = header_file
    if footer_file:
        options["footer-html"] = footer_file
    return options


def _image_xobject(writer, image_path):
    """Embed the file's own pixels. The page scales them; nothing is resampled first."""
    import zlib

    from PIL import Image, ImageOps
    from pypdf.generic import NameObject, NumberObject, StreamObject

    with Image.open(image_path) as im:
        # Match browser <img> orientation when EXIF is present.
        im = ImageOps.exif_transpose(im) or im
        if im.mode == "P":
            im = im.convert("RGBA")
        if im.mode == "RGBA":
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        width, height = im.size
        payload = zlib.compress(im.tobytes(), 6)
    stream = StreamObject()
    stream._data = payload
    stream.update(
        {
            NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(width),
            NameObject("/Height"): NumberObject(height),
            NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
            NameObject("/BitsPerComponent"): NumberObject(8),
            NameObject("/Filter"): NameObject("/FlateDecode"),
            NameObject("/Length"): NumberObject(len(payload)),
        }
    )
    return writer._add_object(stream), width, height


def _fit_artwork(img_w, img_h, box_w, box_h, align):
    """Scale uniformly into the band (contain). Do not stretch the artwork."""
    if img_w <= 0 or img_h <= 0 or box_w <= 0 or box_h <= 0:
        return 0, 0, box_w, box_h
    scale = min(box_w / float(img_w), box_h / float(img_h))
    draw_w = img_w * scale
    draw_h = img_h * scale
    side = (align or "center").lower()
    if side == "left":
        x = 0
    elif side == "right":
        x = box_w - draw_w
    else:
        x = (box_w - draw_w) / 2.0
    y = (box_h - draw_h) / 2.0
    return x, y, draw_w, draw_h


def _nabl_map_marker(sections):
    """Hidden list of printed test names and their Test Master NABL marks."""
    from urllib.parse import quote

    parts = []
    seen = set()
    for section in sections or []:
        name = cstr(section.get("test_name") or section.get("diagnostic_test") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        flag = "1" if cint(section.get("is_nabl")) else "0"
        parts.append(quote(name, safe="") + "=" + flag)
    if not parts:
        return ""
    return "<!--HEC-NABL-MAP:" + "|".join(parts) + "-->"


def _nabl_map_from_html(html):
    from urllib.parse import unquote

    text = cstr(html or "")
    key = "<!--HEC-NABL-MAP:"
    start = text.find(key)
    if start < 0:
        return {}
    end = text.find("-->", start)
    if end < 0:
        return {}
    mapping = {}
    for part in text[start + len(key) : end].split("|"):
        if "=" not in part:
            continue
        encoded, flag = part.rsplit("=", 1)
        name = unquote(encoded).strip()
        if name:
            mapping[name] = 1 if flag.strip() == "1" else 0
    return mapping


def _name_on_page(text, name):
    """True when the printed test heading is on this page."""
    import re

    needle = " ".join(cstr(name or "").lower().split())
    if not needle:
        return False
    hay = " ".join(cstr(text or "").lower().split())
    if len(needle) < 6:
        return re.search(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])", hay) is not None
    return needle in hay


def _pad_modes_for_pdf(pdf_bytes, nabl_map, default_mode):
    """NABL pad on pages whose tests are all NABL-marked. Any Non-NABL test keeps that page off the NABL pad."""
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    names = sorted((nabl_map or {}), key=len, reverse=True)
    modes = []
    last = "nabl" if default_mode == "nabl" else "non_nabl"
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        seen_nabl = False
        seen_non = False
        for name in names:
            if not _name_on_page(text, name):
                continue
            if nabl_map.get(name):
                seen_nabl = True
            else:
                seen_non = True
        if seen_non:
            mode = "non_nabl"
        elif seen_nabl:
            mode = "nabl"
        else:
            mode = last
        last = mode
        modes.append(mode)
    return modes


def _pad_files_for_chrome(mode, brand, branding):
    """Header and footer files for one letterhead, from Template Management."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
            parse_chrome_to_layout,
            pdf_options_from_layout,
        )

        layout = parse_chrome_to_layout(mode, brand=brand) or {}
        geo = pdf_options_from_layout(layout) or {}
        header_src, footer_src = _resolve_with_header_band_urls(mode, geo, branding or {})
        return _local_letterhead_path(header_src), _local_letterhead_path(footer_src)
    except Exception:
        frappe.log_error(title="pad_files_for_chrome", message=frappe.get_traceback())
        return "", ""


def _stamp_letterhead_pages(
    pdf_bytes,
    header_path,
    footer_path,
    header_mm,
    footer_mm,
    header_align="center",
    footer_align="center",
    page_header_paths=None,
    page_footer_paths=None,
):
    """Place the original artwork on the top and bottom of every page.

    wkhtmltopdf leaves a page CTM with a negative Y scale (HTML-style). Stamping
    after that stream inherits the flip. Wrap the body in q/Q, then draw the
    letterhead in identity PDF space so orientation matches the live preview.
    """
    import io

    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject

    if not pdf_bytes or (not header_path and not footer_path and not page_header_paths and not page_footer_paths):
        return pdf_bytes
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    cache = {}

    def _xobj(path):
        if not path:
            return None
        if path not in cache:
            cache[path] = _image_xobject(writer, path)
        return cache[path]

    for path in [header_path, footer_path]:
        _xobj(path)
    for path in list(page_header_paths or []) + list(page_footer_paths or []):
        _xobj(path)
    header_pt = float(header_mm or 0) * 72.0 / 25.4
    footer_pt = float(footer_mm or 0) * 72.0 / 25.4
    for index, page in enumerate(reader.pages):
        writer.add_page(page)
        dest = writer.pages[-1]
        box = dest.mediabox
        page_w = float(box.right) - float(box.left)
        page_h = float(box.top) - float(box.bottom)
        resources = dest.get("/Resources")
        if resources is None:
            resources = DictionaryObject()
            dest[NameObject("/Resources")] = resources
        elif hasattr(resources, "get_object"):
            resources = resources.get_object()
        xobjects = resources.get("/XObject")
        if xobjects is None:
            xobjects = DictionaryObject()
            resources[NameObject("/XObject")] = xobjects
        elif hasattr(xobjects, "get_object"):
            xobjects = xobjects.get_object()
        h_path = header_path
        f_path = footer_path
        if page_header_paths and index < len(page_header_paths) and page_header_paths[index]:
            h_path = page_header_paths[index]
        if page_footer_paths and index < len(page_footer_paths) and page_footer_paths[index]:
            f_path = page_footer_paths[index]
        header_art = cache.get(h_path) if h_path else None
        footer_art = cache.get(f_path) if f_path else None
        ops = []
        if header_art is not None and header_pt > 0:
            header_ref, header_pw, header_ph = header_art
            xobjects[NameObject("/LabHdr")] = header_ref
            ox, oy, dw, dh = _fit_artwork(header_pw, header_ph, page_w, header_pt, header_align)
            band_y = page_h - header_pt
            ops.append(
                f"q 0 {band_y:.4f} {page_w:.4f} {header_pt:.4f} re W n "
                f"{dw:.4f} 0 0 {dh:.4f} {ox:.4f} {band_y + oy:.4f} cm /LabHdr Do Q"
            )
        if footer_art is not None and footer_pt > 0:
            footer_ref, footer_pw, footer_ph = footer_art
            xobjects[NameObject("/LabFtr")] = footer_ref
            gap_pt = float(FOOTER_EDGE_GAP_MM) * 72.0 / 25.4
            art_h = max(1.0, footer_pt - gap_pt)
            ox, oy, dw, dh = _fit_artwork(footer_pw, footer_ph, page_w, art_h, footer_align)
            # 1mm clear gap under the footer artwork on every template/page.
            ops.append(
                f"q 0 {gap_pt:.4f} {page_w:.4f} {art_h:.4f} re W n "
                f"{dw:.4f} 0 0 {dh:.4f} {ox:.4f} {gap_pt + oy:.4f} cm /LabFtr Do Q"
            )
        if not ops:
            continue
        save = DecodedStreamObject()
        save.set_data(b"q\n")
        save_ref = writer._add_object(save)
        restore = DecodedStreamObject()
        restore.set_data(b"Q\n")
        restore_ref = writer._add_object(restore)
        draw = DecodedStreamObject()
        draw.set_data(("\n".join(ops) + "\n").encode("ascii"))
        draw_ref = writer._add_object(draw)
        contents = dest.get("/Contents")
        if contents is None:
            dest[NameObject("/Contents")] = draw_ref
            continue
        contents_obj = contents.get_object() if hasattr(contents, "get_object") else contents
        if isinstance(contents_obj, ArrayObject):
            contents_obj.insert(0, save_ref)
            contents_obj.append(restore_ref)
            contents_obj.append(draw_ref)
        else:
            dest[NameObject("/Contents")] = ArrayObject(
                [save_ref, contents, restore_ref, draw_ref]
            )
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _signature_urls_from_html(html):
    """Column order of signature files embedded for the PDF stamp."""
    text = cstr(html or "")
    key = "<!--HEC-SIG-URLS:"
    start = text.find(key)
    if start < 0:
        return []
    end = text.find("-->", start)
    if end < 0:
        return []
    return [part.strip() for part in text[start + len(key) : end].split("|")]


def _pdf_content_tokens(raw):
    import re

    return [
        match.group().decode("latin1")
        for match in re.finditer(
            rb"/(?:[^\s\[\]()<>/]+)|[+-]?(?:\d+\.\d*|\.\d+|\d+)|[A-Za-z\*]+",
            raw or b"",
        )
    ]


def _pdf_page_raw(page):
    contents = page.get_contents()
    if contents is None:
        return b""
    if isinstance(contents, list):
        return b"\n".join(item.get_data() for item in contents)
    return contents.get_data()


def _signature_line_rows(page):
    """Blue signature rules, in identity space, grouped into rows of columns.

    wkhtmltopdf sometimes omits the signature <img> entirely. The blue line is
    still drawn, so the stamp can sit in the empty slot above it.
    """
    tokens = _pdf_content_tokens(_pdf_page_raw(page))
    stack = [((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    fill = None
    lines = []
    images = []

    def _num(token):
        try:
            return float(token)
        except Exception:
            return None

    def _point(px, py):
        (a1, b1, _c1), (d1, e1, _f1), (g1, h1, _i1) = stack[-1]
        return (a1 * px + d1 * py + g1, b1 * px + e1 * py + h1)

    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token == "q":
            stack.append(stack[-1])
        elif token == "Q" and len(stack) > 1:
            stack.pop()
        elif token == "cm":
            nums = []
            cursor = index - 1
            while cursor >= 0 and _num(tokens[cursor]) is not None and len(nums) < 6:
                nums.append(_num(tokens[cursor]))
                cursor -= 1
            if len(nums) == 6:
                nums.reverse()
                a, b, c, d, e, f = nums
                (a1, b1, c1), (d1, e1, f1), (g1, h1, i1) = stack[-1]
                stack[-1] = (
                    (a * a1 + b * d1, a * b1 + b * e1, a * c1 + b * f1),
                    (c * a1 + d * d1, c * b1 + d * e1, c * c1 + d * f1),
                    (e * a1 + f * d1 + g1, e * b1 + f * e1 + h1, e * c1 + f * f1 + i1),
                )
        elif token in ("rg", "scn"):
            nums = []
            cursor = index - 1
            while cursor >= 0 and _num(tokens[cursor]) is not None and len(nums) < 4:
                nums.append(_num(tokens[cursor]))
                cursor -= 1
            nums.reverse()
            if len(nums) >= 3:
                fill = tuple(nums[-3:])
        elif token == "re":
            nums = []
            cursor = index - 1
            while cursor >= 0 and _num(tokens[cursor]) is not None and len(nums) < 4:
                nums.append(_num(tokens[cursor]))
                cursor -= 1
            if len(nums) == 4 and fill and abs(fill[0] - 0.043) < 0.08 and abs(fill[1] - 0.361) < 0.08 and abs(fill[2] - 0.671) < 0.08:
                nums.reverse()
                x, y, w, h = nums
                corners = [_point(x, y), _point(x + w, y), _point(x, y + h), _point(x + w, y + h)]
                xs = [pt[0] for pt in corners]
                ys = [pt[1] for pt in corners]
                rw = max(xs) - min(xs)
                rh = max(ys) - min(ys)
                if 70 <= rw <= 140 and 0.6 <= rh <= 4:
                    lines.append((min(xs), min(ys), rw, rh))
        elif token == "Do":
            cursor = index - 1
            while cursor >= 0 and not tokens[cursor].startswith("/"):
                cursor -= 1
            if cursor >= 0 and tokens[cursor].startswith("/"):
                corners = [_point(0, 0), _point(1, 0), _point(0, 1), _point(1, 1)]
                xs = [pt[0] for pt in corners]
                ys = [pt[1] for pt in corners]
                images.append(
                    (tokens[cursor], min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
                )
        index += 1

    unique = []
    for line in sorted(lines, key=lambda item: (item[1], item[0])):
        if any(abs(line[0] - kept[0]) < 4 and abs(line[1] - kept[1]) < 4 for kept in unique):
            continue
        unique.append(line)
    rows = []
    for line in sorted(unique, key=lambda item: item[1]):
        if rows and abs(line[1] - rows[-1][0][1]) <= 8:
            rows[-1].append(line)
        else:
            rows.append([line])
    signature_rows = []
    for row in rows:
        if len(row) < 4:
            continue
        signature_rows.append(sorted(row, key=lambda item: item[0]))
    return signature_rows, images


def _signature_image_has_ink(page, name):
    """A transparent or all-white signature XObject still looks blank on the page."""
    try:
        from PIL import Image

        resources = page["/Resources"].get_object()
        xobjects = resources["/XObject"].get_object()
        wanted = name if str(name).startswith("/") else "/" + str(name)
        obj = None
        for key, value in xobjects.items():
            if str(key) == wanted:
                obj = value.get_object()
                break
        if obj is None:
            return False
        if str(obj.get("/Subtype")) != "/Image":
            return False
        width, height = int(obj.get("/Width")), int(obj.get("/Height"))
        if width > 800 or height > 400:
            return False
        # Soft-masked PNG ink is what wkhtmltopdf was dropping on the page.
        smask = obj.get("/SMask")
        if smask is not None:
            mask = smask.get_object()
            mask_raw = mask.get_data()
            if mask_raw:
                opaque = sum(1 for value in mask_raw if value > 40)
                if opaque / float(len(mask_raw)) < 0.01:
                    return False
        raw = obj.get_data()
        mode = "L" if "Gray" in str(obj.get("/ColorSpace")) else "RGB"
        if mode == "RGB" and len(raw) < width * height * 3:
            return False
        image = Image.frombytes(mode, (width, height), raw)
        pixels = list(image.getdata())
        if mode == "RGB":
            dark = sum(1 for px in pixels if px[0] < 80 and px[1] < 80 and px[2] < 80)
        else:
            dark = sum(1 for px in pixels if px < 80)
        return dark / float(max(1, width * height)) >= 0.01
    except Exception:
        return False


def _signature_slot_occupied(page, images, x, y, w, h):
    """True only when visible signature ink is already in this slot."""
    for name, ix, iy, iw, ih in images:
        if iw > 180 or ih > 80 or ih < 8:
            continue
        if ix + iw < x + 2 or ix > x + w - 2:
            continue
        if iy + ih < y + 2 or iy > y + h - 2:
            continue
        if _signature_image_has_ink(page, name):
            return True
    return False


def _stamp_signature_images(pdf_bytes, urls, already_identity=False):
    """Paint saved signatures above the blue lines when the HTML image was dropped.

    Letterhead is already stamped in identity space. This only fills an empty
    signature slot; it does not move text, the barcode, or the letterhead.
    """
    import io
    import os
    import tempfile

    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject

    urls = list(urls or [])
    if not pdf_bytes or not any(urls):
        return pdf_bytes
    paths = []
    temp_paths = []
    try:
        for url in urls:
            path = _local_letterhead_path(url) if url else ""
            if not path:
                paths.append("")
                continue
            try:
                image = _trimmed_signature_image(path)
                handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                temp_paths.append(handle.name)
                handle.close()
                image.save(handle.name, format="PNG")
                paths.append(handle.name)
            except Exception:
                frappe.log_error(title="signature_stamp_prepare", message=frappe.get_traceback())
                paths.append("")
        if not any(paths):
            return pdf_bytes
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()
        image_refs = {}
        for index, path in enumerate(paths):
            if not path:
                continue
            image_refs[index] = _image_xobject(writer, path)
        stamped = False
        for page in reader.pages:
            writer.add_page(page)
            dest = writer.pages[-1]
            try:
                rows, images = _signature_line_rows(page)
            except Exception:
                frappe.log_error(title="signature_stamp_scan", message=frappe.get_traceback())
                continue
            ops = []
            for row in rows:
                bottoms = sorted(line[1] + line[3] for line in row)
                line_top = bottoms[len(bottoms) // 2]
                span = row[-1][0] - row[0][0]
                pitch = span / float(max(1, len(urls) - 1)) if len(urls) > 1 else span or 1
                for line in row:
                    column = int(round((line[0] - row[0][0]) / pitch)) if pitch else 0
                    column = max(0, min(len(paths) - 1, column))
                    ref = image_refs.get(column)
                    if not ref:
                        continue
                    _ref, pixel_w, pixel_h = ref
                    slot_w = max(8.0, line[2] - 8.0)
                    slot_h = 31.0
                    if _signature_slot_occupied(page, images, line[0], line_top, line[2], slot_h):
                        continue
                    scale = min(slot_w / float(pixel_w), slot_h / float(pixel_h))
                    draw_w = pixel_w * scale
                    draw_h = pixel_h * scale
                    draw_x = line[0] + (line[2] - draw_w) / 2.0
                    draw_y = line_top + 0.6
                    ops.append(
                        f"q {draw_w:.3f} 0 0 {draw_h:.3f} {draw_x:.3f} {draw_y:.3f} cm /SigInk{column} Do Q"
                    )
            if not ops:
                continue
            resources = dest.get("/Resources")
            if resources is not None and hasattr(resources, "get_object"):
                resources = resources.get_object()
            if resources is None:
                continue
            xobjects = resources.get("/XObject")
            if xobjects is not None and hasattr(xobjects, "get_object"):
                xobjects = xobjects.get_object()
            if xobjects is None:
                continue
            for column, ref in image_refs.items():
                xobjects[NameObject(f"/SigInk{column}")] = ref[0]
            draw = DecodedStreamObject()
            draw.set_data(("\n".join(ops) + "\n").encode("ascii"))
            draw_ref = writer._add_object(draw)
            contents = dest.get("/Contents")
            contents_obj = contents.get_object() if hasattr(contents, "get_object") else contents
            if isinstance(contents_obj, ArrayObject):
                if not already_identity:
                    save = DecodedStreamObject()
                    save.set_data(b"q\n")
                    restore = DecodedStreamObject()
                    restore.set_data(b"Q\n")
                    contents_obj.insert(0, writer._add_object(save))
                    contents_obj.append(writer._add_object(restore))
                contents_obj.append(draw_ref)
            else:
                save = DecodedStreamObject()
                save.set_data(b"q\n")
                restore = DecodedStreamObject()
                restore.set_data(b"Q\n")
                dest[NameObject("/Contents")] = ArrayObject(
                    [writer._add_object(save), contents, writer._add_object(restore), draw_ref]
                )
            stamped = True
        if not stamped:
            return pdf_bytes
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except Exception:
                pass


def _pdfkit_bytes(html, options):
    import pdfkit

    data = pdfkit.from_string(html, False, options=options)
    if isinstance(data, str):
        data = data.encode("latin1")
    return data or b""


def html_to_lab_report_pdf(html, chrome_mode=None, page_layout=None, brand=None, branch=None):
    """A4 portrait PDF. Header/footer bands are wkhtmltopdf chrome so they pin to every page.

    Signature files are read here, before URL rewriting, so a dropped <img> can
    still be stamped above the blue line.

    Uses Report Page Management layouts when available (SLPL/Remedium × with/without header),
    while keeping legacy chrome_mode values (nabl / non_nabl / none) working.
    """
    import os

    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

    sig_urls = _signature_urls_from_html(html)

    layout = page_layout
    if layout is None:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
                parse_chrome_to_layout,
                pdf_options_from_layout,
            )

            layout = parse_chrome_to_layout(chrome_mode, brand=brand, branch=branch)
            geo = pdf_options_from_layout(layout)
        except Exception:
            frappe.log_error(title="lab_report_pdf_layout_resolve", message=frappe.get_traceback())
            layout = None
            geo = None
    else:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
                pdf_options_from_layout,
            )

            geo = pdf_options_from_layout(layout)
        except Exception:
            geo = None

    mode = normalize_report_chrome_mode(chrome_mode, 0)
    plain = bool(geo and geo.get("chrome") in ("none", "plain")) or (mode == "none" and not geo)

    branding = get_report_branding()
    # Template Management is the source of truth. Do not rewrite its images while printing.

    explicit_layout = geo is not None
    header_src = ""
    footer_src = ""
    header_mm = LETTERHEAD_HEADER_MM
    footer_mm = LETTERHEAD_FOOTER_MM
    if explicit_layout:
        header_mm = float(geo.get("header_height_mm") or geo.get("margin_top_mm") or LETTERHEAD_HEADER_MM)
        footer_mm = float(geo.get("footer_height_mm") or geo.get("margin_bottom_mm") or LETTERHEAD_FOOTER_MM)
        if plain:
            header_src = ""
            footer_src = ""
        else:
            # Newest of Page Management + LabTech branding pads (avoids stale 03.png etc.).
            header_src, footer_src = _resolve_with_header_band_urls(mode, geo, branding)
    else:
        if plain:
            header_src = ""
            footer_src = ""
        else:
            header_src, footer_src = _resolve_with_header_band_urls(mode, geo or {}, branding)

    header_path = _local_letterhead_path(header_src) if header_src else ""
    footer_path = _local_letterhead_path(footer_src) if footer_src else ""
    here = os.path.dirname(os.path.abspath(__file__))
    # Last-resort bundled assets only when Page Management + branding have no file on disk.
    if not header_path and not plain:
        if mode == "non_nabl" or str(mode).endswith("_non_nabl"):
            for name in (
                cstr(branding.get("non_nabl_header_banner") or ""),
                "non-nabl-header.png",
            ):
                header_path = _local_letterhead_path(name) if name else ""
                if not header_path and name.endswith(".png"):
                    cand = os.path.join(here, "report_assets", name)
                    if os.path.isfile(cand):
                        header_path = cand
                if header_path:
                    break
        else:
            for name in (
                cstr(branding.get("nabl_header_banner") or branding.get("header_banner") or ""),
                "nabl-header.png",
            ):
                header_path = _local_letterhead_path(name) if name else ""
                if not header_path and name.endswith(".png"):
                    cand = os.path.join(here, "report_assets", name)
                    if os.path.isfile(cand):
                        header_path = cand
                if header_path:
                    break
    if not footer_path and not plain:
        footer_path = _local_letterhead_path(cstr(branding.get("footer_banner") or ""))
        if not footer_path:
            cand = os.path.join(here, "report_assets", "report-footer.png")
            if os.path.isfile(cand):
                footer_path = cand

    # The content box stays the letterhead bands even when the pictures are omitted.
    if header_mm <= 0:
        header_mm = LETTERHEAD_HEADER_MM
    if footer_mm <= 0:
        footer_mm = LETTERHEAD_FOOTER_MM
    if plain:
        header_path = ""
        footer_path = ""
        # Physical / without-header always uses Remedium letterhead band sizes so
        # pre-printed pads align, even if the stored without_header template drifted.
        try:
            band_h, band_f, band_s = _remedium_without_header_bands()
            header_mm = float(band_h or header_mm)
            footer_mm = float(band_f or footer_mm)
            if band_s:
                left_mm_override = float(band_s)
            else:
                left_mm_override = None
        except Exception:
            left_mm_override = None
    else:
        left_mm_override = None

    # Body first, with the bands left empty. Artwork is stamped afterwards from
    # the original file so wkhtmltopdf never resamples it, and every page gets it.
    left_mm = float(
        left_mm_override
        if left_mm_override is not None
        else ((geo or {}).get("margin_left_mm") or LETTERHEAD_SIDE_MM)
    )
    right_mm = float((geo or {}).get("margin_right_mm") or left_mm)
    header_align = cstr((geo or {}).get("header_align") or "center")
    footer_align = cstr((geo or {}).get("footer_align") or "center")
    blank_header_file = ""
    blank_footer_file = ""
    if plain:
        # Every page needs a blank letterhead band. position:fixed / body padding only
        # affects page 1 in wkhtmltopdf — use real --header-html / --footer-html instead.
        blank_header_file = _write_blank_band_file(header_mm, "header")
        blank_footer_file = _write_blank_band_file(footer_mm, "footer")
        html = _prepare_body_html(html, header_mm, footer_mm, left_mm, right_mm)
        options = _letterhead_pdf_options(
            header_mm, footer_mm, blank_header_file, blank_footer_file, left_mm, right_mm
        )
    else:
        html = _prepare_body_html(html, header_mm, footer_mm, left_mm, right_mm)
        options = _letterhead_pdf_options(header_mm, footer_mm, "", "", left_mm, right_mm)
    try:
        try:
            pdf = _pdfkit_bytes(html, options)
        except Exception:
            frappe.log_error(title="lab_report_pdf_letterhead", message=frappe.get_traceback())
            options.pop("dpi", None)
            options.pop("zoom", None)
            pdf = _pdfkit_bytes(html, options)
        if header_path or footer_path:
            try:
                page_header_paths = None
                page_footer_paths = None
                nabl_map = _nabl_map_from_html(html)
                mixed = bool(nabl_map) and any(nabl_map.values()) and any(not flag for flag in nabl_map.values())
                if mixed:
                    default_mode = (
                        "non_nabl"
                        if mode == "non_nabl" or str(mode).endswith("_non_nabl")
                        else "nabl"
                    )
                    page_modes = _pad_modes_for_pdf(pdf, nabl_map, default_mode)
                    if any(item == "nabl" for item in page_modes) and any(item != "nabl" for item in page_modes):
                        nabl_header, nabl_footer = _pad_files_for_chrome("nabl", brand or "remedium", branding)
                        non_header, non_footer = _pad_files_for_chrome("non_nabl", brand or "remedium", branding)
                        if default_mode == "non_nabl":
                            non_header = header_path or non_header
                            non_footer = footer_path or non_footer
                        else:
                            nabl_header = header_path or nabl_header
                            nabl_footer = footer_path or nabl_footer
                        page_header_paths = [
                            (nabl_header if item == "nabl" else non_header) or header_path
                            for item in page_modes
                        ]
                        page_footer_paths = [
                            (nabl_footer if item == "nabl" else non_footer) or footer_path
                            for item in page_modes
                        ]
                pdf = _stamp_letterhead_pages(
                    pdf,
                    header_path,
                    footer_path,
                    header_mm,
                    footer_mm,
                    header_align,
                    footer_align,
                    page_header_paths=page_header_paths,
                    page_footer_paths=page_footer_paths,
                )
            except Exception:
                frappe.log_error(title="lab_report_pdf_stamp", message=frappe.get_traceback())
                raise
        if any(sig_urls):
            try:
                pdf = _stamp_signature_images(
                    pdf,
                    sig_urls,
                    already_identity=bool(header_path or footer_path),
                )
            except Exception:
                frappe.log_error(title="lab_report_pdf_signature", message=frappe.get_traceback())
        return pdf
    finally:
        for path in (blank_header_file, blank_footer_file):
            if not path:
                continue
            try:
                os.unlink(path)
            except Exception:
                pass


def fmt_report_datetime(value):
    if not value:
        return ""
    try:
        dt = get_datetime(value)
        hour = dt.strftime("%I").lstrip("0") or "12"
        return f"{dt.strftime('%d-%b-%Y')} {hour}:{dt.strftime('%M %p')}"
    except Exception:
        return str(value)


def _bound_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _open_bounds(lower, upper):
    """Drop the 0–0 Float default so it is not treated as a real interval."""
    lo = _bound_number(lower)
    hi = _bound_number(upper)
    if lo == 0 and hi == 0:
        return None, None
    return lo, hi


def reference_label(lower, upper):
    lo, hi = _open_bounds(lower, upper)
    if lo is not None and hi is not None:
        return f"{flt(lo):g} - {flt(hi):g}"
    if lo is not None:
        return f"> {flt(lo):g}"
    if hi is not None:
        return f"< {flt(hi):g}"
    return ""


def abnormal_flag_for_value(value, lower, upper):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""
    lo, hi = _open_bounds(lower, upper)
    if lo is not None and num < lo:
        return "L"
    if hi is not None and num > hi:
        return "H"
    if lo is not None or hi is not None:
        return "N"
    return ""


def is_abnormal(flag):
    return (flag or "").upper() in ("H", "L", "HIGH", "LOW", "CRITICAL", "A", "ABNORMAL")


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


_NORMAL_CHOICES = frozenset(
    {
        "negative",
        "neg",
        "neg.",
        "non reactive",
        "non-reactive",
        "nonreactive",
        "pale yellow",
        "clear",
        "nil",
        "nil.",
        "absent",
        "not found",
        "not seen",
        "normal",
        "not detected",
        "none",
        "not present",
    }
)
_ZERO_RESULTS = _NORMAL_CHOICES | {"0", "0.0"}


def _norm_result_text(value):
    return re.sub(r"\s+", " ", cstr(value or "").strip().lower())


def _result_span(value):
    """Number, count band such as 2-3, or a nil/negative word as zero."""
    text = _norm_result_text(value)
    if not text:
        return None
    if text in _ZERO_RESULTS:
        return (0.0, 0.0)
    raw = cstr(value).strip().replace(",", "")
    try:
        number = float(raw)
        return (number, number)
    except (TypeError, ValueError):
        pass
    match = re.match(
        r"^([+-]?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*([+-]?\d+(?:\.\d+)?)$",
        raw,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    left = float(match.group(1))
    right = float(match.group(2))
    return (min(left, right), max(left, right))


def _flag_for_span(span, low, high):
    if span is None or (low is None and high is None):
        return ""
    start, end = span
    if low is not None and end < low:
        return "L"
    if high is not None and start > high:
        return "H"
    if low is not None and start < low:
        return "L"
    if high is not None and end > high:
        return "H"
    return "N"


def _configured_normal_text(default_value, choice_options):
    """Normal qualitative result from Test Master.

    An explicit default is the normal value. Otherwise the first choice is used
    only when it is a known normal token (Negative, Clear, Pale Yellow), so a
    blood-group list is not treated as having one normal result.
    """
    default = cstr(default_value or "").strip()
    if default:
        return default
    choices = [part.strip() for part in cstr(choice_options or "").splitlines() if part.strip()]
    if choices and _norm_result_text(choices[0]) in _NORMAL_CHOICES:
        return choices[0]
    return ""


def _placeholder_range_label(label):
    text = "".join(cstr(label or "").lower().split())
    if not text:
        return False
    head = text.split("/", 1)[0]
    sep = "–" if "–" in head else "-"
    if sep not in head:
        return False
    left, right = head.split(sep, 1)
    try:
        return float(left) == 0 and float(right) == 0
    except ValueError:
        return False


def _patient_range_context(doc):
    age_years = getattr(doc, "age", None)
    gender = getattr(doc, "gender", None)
    age_months = None
    age_days = None
    cycle_day = None
    trf_name = cstr(getattr(doc, "customer_trf", None) or "").strip()
    if trf_name and frappe.db.exists("Customer TRF", trf_name):
        meta = frappe.get_meta("Customer TRF")
        fields = [
            name
            for name in ("age", "age_months", "age_days", "gender", "menstrual_cycle_day")
            if meta.has_field(name)
        ]
        trf = frappe.db.get_value("Customer TRF", trf_name, fields, as_dict=True) or {}
        if age_years in (None, ""):
            age_years = trf.get("age")
        if not gender:
            gender = trf.get("gender")
        age_months = trf.get("age_months")
        age_days = trf.get("age_days")
        cycle_day = trf.get("menstrual_cycle_day")
    return {
        "age_years": age_years,
        "gender": gender,
        "age_months": age_months,
        "age_days": age_days,
        "menstrual_cycle_day": cycle_day,
    }


def _master_parameter(master_doc, row):
    if not master_doc:
        return None
    code = cstr(getattr(row, "parameter_code", None) or "").strip().lower()
    name = cstr(getattr(row, "description", None) or "").strip().lower()
    params = list(master_doc.parameters or [])
    if code:
        for param in params:
            if cstr(param.parameter_code or "").strip().lower() == code:
                return param
    if name:
        for param in params:
            if cstr(param.parameter_name or "").strip().lower() == name:
                return param
    return None


def _print_range_from_master(row, master_doc, ctx):
    """Reference text and H/L/A flag from the current Test Master, not a stale 0–0 snapshot."""
    param = _master_parameter(master_doc, row)
    label = ""
    low, high = None, None
    if param is not None and master_doc is not None:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                format_range_label,
                resolve_parameter_bounds,
            )

            bounds = resolve_parameter_bounds(
                master_doc,
                param,
                age_years=ctx.get("age_years"),
                gender=ctx.get("gender"),
                age_months=ctx.get("age_months"),
                age_days=ctx.get("age_days"),
                menstrual_cycle_day=ctx.get("menstrual_cycle_day"),
            )
            label = format_range_label(bounds, getattr(param, "unit", None) or getattr(row, "unit", None))
            low, high = _open_bounds(bounds.get("normal_min"), bounds.get("normal_max"))
        except Exception:
            frappe.log_error(title="print_range_from_master", message=frappe.get_traceback())
            low, high = _open_bounds(getattr(row, "lower_range", None), getattr(row, "upper_range", None))
        normal_text = _configured_normal_text(
            getattr(param, "default_value", None),
            getattr(param, "choice_options", None),
        )
    else:
        low, high = _open_bounds(getattr(row, "lower_range", None), getattr(row, "upper_range", None))
        normal_text = _configured_normal_text("", getattr(row, "choice_options", None))

    if _placeholder_range_label(label):
        label = ""
    if not label and (low is not None or high is not None):
        label = reference_label(low, high)
        unit = cstr(getattr(row, "unit", None) or "").strip()
        if label and unit and unit.lower() not in label.lower():
            label = f"{label} {unit}".strip()
    stored = cstr(getattr(row, "reference_range_label", None) or "").strip()
    if _placeholder_range_label(stored):
        stored = ""
    if not label and not normal_text:
        label = stored
    if not label and normal_text and low is None and high is None:
        label = normal_text

    value = getattr(row, "result_value", None)
    flag = _flag_for_span(_result_span(value), low, high) if (low is not None or high is not None) else ""
    if not flag and normal_text and cstr(value or "").strip():
        flag = "" if _norm_result_text(value) == _norm_result_text(normal_text) else "A"
    return label, flag


def group_parameters_for_print(doc):
    groups = OrderedDict()
    range_ctx = _patient_range_context(doc)
    master_docs = {}
    for row in doc.parameters:
        if not row.include_in_report:
            continue
        master = row.diagnostic_test
        if master and master not in master_docs:
            master_docs[master] = (
                frappe.get_doc("Diagnostic Test Master", master)
                if frappe.db.exists("Diagnostic Test Master", master)
                else None
            )
        ref_text, flag = _print_range_from_master(row, master_docs.get(master), range_ctx)
        key = master or row.erp_item_code or row.test_name or row.description
        if key not in groups:
            meta = {}
            if master and frappe.db.exists("Diagnostic Test Master", master):
                fields = ["test_name", "report_category", "interpretation", "machine_method"]
                if frappe.db.has_column("Diagnostic Test Master", "is_nabl"):
                    fields.append("is_nabl")
                meta = frappe.db.get_value(
                    "Diagnostic Test Master",
                    master,
                    fields,
                    as_dict=True,
                ) or {}
            groups[key] = {
                "test_name": meta.get("test_name") or row.test_name or row.description,
                "diagnostic_test": master or "",
                "is_nabl": cint(meta.get("is_nabl")) if meta else 0,
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
    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
        resolve_lab_report_attribution,
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
    attribution = resolve_lab_report_attribution(doc)
    barcode = getattr(doc, "unique_barcode", None) or getattr(trf, "unique_barcode", None) or ""
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
        "barcode": barcode,
        "typed_by": attribution.get("typed_by") or "",
        "approved_by": attribution.get("approved_by") or "",
        "report_title_1": doc.report_title_1,
        "report_title_2": doc.report_title_2,
        "report_note": doc.report_note,
        "comments": doc.comments,
        "signatories": resolve_signatories(doc),
        "test_sections": group_parameters_for_print(doc),
    }


def _report_barcode_svg(code):
    code = cstr(code or "").strip()
    if not code:
        return ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import code128_svg

        return code128_svg(code, module=1, height=40, quiet=10, show_text=False, font_size=11)
    except Exception:
        frappe.log_error(title="report_barcode_svg", message=frappe.get_traceback())
        return ""


def _report_barcode_png_data_uri(code):
    code = cstr(code or "").strip()
    if not code:
        return ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import code128_png_data_uri

        return code128_png_data_uri(code, module=2, height=36, quiet=8)
    except Exception:
        frappe.log_error(title="report_barcode_png", message=frappe.get_traceback())
        return ""


def _embed_report_image_url(url):
    """Inline /files/... (and private) images so wkhtmltopdf always paints stamps/signatures."""
    raw = cstr(url or "").strip()
    if not raw:
        return ""
    if raw.startswith("data:"):
        return raw
    path = _local_letterhead_path(raw)
    if path:
        uri = _image_data_uri(path)
        if uri:
            return uri
    return raw


def _trimmed_signature_image(path):
    """Crop white/transparent margins so the ink fills the signature slot."""
    from PIL import Image, ImageChops

    with Image.open(path) as source:
        image = source.convert("RGBA")
    bbox = image.split()[-1].getbbox()
    if not bbox:
        background = Image.new("RGBA", image.size, (255, 255, 255, 255))
        bbox = ImageChops.difference(image, background).getbbox()
    if not bbox:
        return image
    pad = 6
    left, top, right, bottom = bbox
    image = image.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(image.width, right + pad),
            min(image.height, bottom + pad),
        )
    )
    return image


def _signature_img_html(url):
    """Opaque signature mark. wkhtmltopdf drops transparent PNG ink, so it looked blank."""
    raw = cstr(url or "").strip()
    if not raw:
        return '<div class="sig-image empty">&nbsp;</div>'
    path = _local_letterhead_path(raw)
    src = _embed_report_image_url(raw) if raw else ""
    width, height = 100, 40
    slot = 44
    if path:
        try:
            import base64
            import io

            from PIL import Image

            image = _trimmed_signature_image(path)
            flat = Image.new("RGB", image.size, (255, 255, 255))
            flat.paste(image, mask=image.split()[-1])
            scale = min(110 / float(flat.width), slot / float(flat.height), 1)
            width = max(1, int(round(flat.width * scale)))
            height = max(1, int(round(flat.height * scale)))
            resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            raster = flat.resize((width * 2, height * 2), resample)
            buffer = io.BytesIO()
            raster.save(buffer, format="PNG")
            payload = base64.b64encode(buffer.getvalue()).decode("ascii")
            src = f"data:image/png;base64,{payload}"
        except Exception:
            frappe.log_error(title="signature_img_html", message=frappe.get_traceback())
            src = _embed_report_image_url(raw)
    src = escape(src)
    top = max(0, slot - height)
    return (
        f'<div class="sig-image" style="height:{slot}px">'
        f'<img src="{src}" width="{width}" height="{height}" '
        f'style="display:block;margin:{top}px auto 0 auto;width:{width}px;height:{height}px" alt="" />'
        f"</div>"
    )


def render_report_attribution_html(payload, for_pdf=0):
    """Barcode on the left; Approved by / Typed by beside it (table layout for wkhtmltopdf)."""
    barcode = cstr(payload.get("barcode") or "").strip()
    approved = cstr(payload.get("approved_by") or "").strip()
    typed = cstr(payload.get("typed_by") or "").strip()
    code_line = f'<div class="attr-barcode-code">* {escape(barcode)}</div>' if barcode else ""
    bar_line = ""
    if barcode:
        if cint(for_pdf):
            png = _report_barcode_png_data_uri(barcode)
            if png:
                bar_line = f'<img class="attr-barcode-img" src="{png}" alt="barcode" />'
        if not bar_line:
            svg = _report_barcode_svg(barcode)
            if svg:
                bar_line = f'<div class="attr-barcode">{svg}</div>'
    return f"""<table class="report-attribution" cellpadding="0" cellspacing="0">
  <tr>
    <td class="attr-barcode-col" valign="bottom">{code_line}{bar_line}</td>
    <td class="attr-meta-col" valign="bottom">
      <div class="attr-line"><span class="attr-label">Approved by :</span> <span class="attr-value">{escape(approved)}</span></div>
      <div class="attr-line"><span class="attr-label">Typed by :</span> <span class="attr-value">{escape(typed)}</span></div>
    </td>
  </tr>
</table>"""


def _flag_cell(flag):
    f = (flag or "").upper()
    if f in ("H", "HIGH", "CRITICAL"):
        return f'<span class="flag-high">{escape(f)}</span>'
    if f in ("L", "LOW"):
        return f'<span class="flag-low">{escape(f)}</span>'
    if f in ("A", "ABNORMAL"):
        return '<span class="flag-high">•</span>'
    if f == "N":
        return '<span class="flag-normal">•</span>'
    return escape(f or "—")


def _result_cell(value, is_abnormal):
    text = escape(str(value or "—"))
    if is_abnormal:
        return f'<span class="result-abnormal">{text}</span>'
    return text


def normalize_report_chrome_mode(chrome_mode=None, letterhead_plain=0):
    """nabl | non_nabl | none | {brand}_with_header | {brand}_without_header."""
    mode = (cstr(chrome_mode) or "").strip().lower().replace("-", "_").replace(" ", "_")
    if cint(letterhead_plain) or mode in (
        "none",
        "plain",
        "headerless",
        "no_header",
        "without_header",
        "without_header_footer",
    ):
        return "none"
    if mode in ("non_nabl", "nonnabl", "remedium_non_nabl"):
        return "non_nabl"
    if mode in (
        "slpl_with_header",
        "slpl_without_header",
        "slpl_non_nabl",
        "remedium_with_header",
        "remedium_without_header",
    ):
        return mode
    if mode.endswith("_without_header"):
        return mode
    if mode.endswith("_with_header"):
        return mode
    if mode in ("with_header", "digital_header", "letterhead"):
        # Delivery choice only — NABL vs Non-NABL pad is resolved from Test Master.
        return "with_header"
    if mode in ("nabl", "with_nabl", ""):
        return "nabl"
    return "nabl"


def remedium_chrome_for_diagnostic_tests(masters):
    """Page Management pad: NABL (with_header) if every test is NABL-marked, else Non-NABL."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_lab_test_master import (
            ensure_lab_test_master_fields,
        )

        ensure_lab_test_master_fields()
    except Exception:
        frappe.log_error(title="remedium_chrome_ensure_is_nabl", message=frappe.get_traceback())

    names = []
    seen = set()
    for raw in masters or []:
        name = cstr(raw).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    if not names:
        return "non_nabl"
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return "non_nabl"
    if not frappe.db.has_column("Diagnostic Test Master", "is_nabl"):
        return "non_nabl"
    rows = frappe.db.get_all(
        "Diagnostic Test Master",
        filters={"name": ["in", names]},
        fields=["name", "is_nabl", "test_name"],
    )
    found = {cstr(r.name) for r in rows}
    # Also resolve by test_name when the lab report stored a display label.
    missing = [n for n in names if n not in found]
    if missing:
        extra = frappe.db.get_all(
            "Diagnostic Test Master",
            filters={"test_name": ["in", missing]},
            fields=["name", "is_nabl", "test_name"],
        )
        rows = list(rows) + list(extra)
    if not rows:
        return "non_nabl"
    # NABL letterhead only when every ordered test is marked NABL in Test Master.
    if all(cint(r.get("is_nabl")) for r in rows):
        return "nabl"
    return "non_nabl"


def remedium_chrome_for_lab_report(lab_report=None, payload=None):
    """Pick Remedium NABL / Non-NABL pad from Test Master checkboxes on this report."""
    masters = []
    if payload and isinstance(payload, dict):
        for section in payload.get("test_sections") or []:
            if section.get("diagnostic_test"):
                masters.append(section.get("diagnostic_test"))
            elif section.get("is_nabl") is not None and not section.get("diagnostic_test"):
                # Payload already carries flags without master ids.
                pass
        flags = [
            cint(section.get("is_nabl"))
            for section in (payload.get("test_sections") or [])
            if "is_nabl" in section
        ]
        if flags and not masters:
            return "nabl" if flags and all(flags) else "non_nabl"
    if lab_report and frappe.db.exists("Lab Report", lab_report):
        masters.extend(
            frappe.db.sql_list(
                """
                SELECT DISTINCT diagnostic_test
                FROM `tabLab Report Parameter`
                WHERE parent = %s
                  AND IFNULL(include_in_report, 1) = 1
                  AND IFNULL(diagnostic_test, '') != ''
                """,
                lab_report,
            )
            or []
        )
    return remedium_chrome_for_diagnostic_tests(masters)


def resolve_remedium_report_chrome(requested=None, lab_report=None, payload=None):
    """Resolve Remedium chrome from delivery choice + Test Master NABL marks.

    - without_header / none → blank letterhead bands (physical print)
    - with_header / nabl / non_nabl / anything else → NABL or Non-NABL pad from
      Test Master ``is_nabl`` (operator does not pick NABL vs Non-NABL)
    """
    mode = normalize_report_chrome_mode(requested, 0)
    if mode == "none" or str(mode).endswith("_without_header"):
        return "remedium_without_header"
    return remedium_chrome_for_lab_report(lab_report=lab_report, payload=payload)


def _remedium_without_header_bands():
    """Header/footer/side gaps from Report Template Management → Remedium → Without letterhead."""
    header_mm = LETTERHEAD_HEADER_MM
    footer_mm = LETTERHEAD_FOOTER_MM
    side_mm = LETTERHEAD_SIDE_MM
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
            get_effective_layout,
        )

        layout = get_effective_layout("remedium", "without_header", "") or {}
        wh = get_effective_layout("remedium", "with_header", "") or {}
        header_mm = float(
            layout.get("header_height_mm")
            or layout.get("margin_top_mm")
            or wh.get("header_height_mm")
            or header_mm
        )
        footer_mm = float(
            layout.get("footer_height_mm")
            or layout.get("margin_bottom_mm")
            or wh.get("footer_height_mm")
            or footer_mm
        )
        side_mm = float(
            layout.get("margin_left_mm")
            or layout.get("side_mm")
            or wh.get("side_mm")
            or side_mm
        )
        # Physical pads need the full letterhead band, not the old 15mm default.
        if header_mm < 30.0:
            header_mm = float(wh.get("header_height_mm") or LETTERHEAD_HEADER_MM)
        if footer_mm < 20.0:
            footer_mm = float(wh.get("footer_height_mm") or LETTERHEAD_FOOTER_MM)
    except Exception:
        frappe.log_error(title="remedium_without_header_bands", message=frappe.get_traceback())
    return header_mm, footer_mm, side_mm


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
    # letterhead_plain must resolve to the Remedium without_header template, not a bare "none".
    if cint(letterhead_plain) and not cstr(chrome_mode or "").strip():
        chrome_mode = "remedium_without_header"
    mode = normalize_report_chrome_mode(chrome_mode, 0 if cstr(chrome_mode or "").endswith("_without_header") else letterhead_plain)
    if cint(letterhead_plain) and mode == "none":
        mode = "remedium_without_header"
    pdf_mode = cint(for_pdf)
    asset = _pdf_asset if pdf_mode else _absolute_asset
    blank_letterhead = mode == "none" or str(mode).endswith("_without_header")
    band_header_mm, band_footer_mm, band_side_mm = (
        _remedium_without_header_bands() if blank_letterhead else (LETTERHEAD_HEADER_MM, LETTERHEAD_FOOTER_MM, LETTERHEAD_SIDE_MM)
    )
    band_body_top_mm = round(band_header_mm + LETTERHEAD_GAP_MM, 2)
    band_body_bottom_mm = round(band_footer_mm + LETTERHEAD_GAP_MM, 2)
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
    if blank_letterhead:
        # Without-header template: blank bands only — never paint letterhead artwork.
        header_banner_html = ""
        constructed_header = False
        nabl_strip_html = ""
        footer_banner_html = ""
        logo_html = ""
        nabl_logo_html = ""
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

    test_sections = payload.get("test_sections") or []
    section_count = len(test_sections)
    sections_html = ""
    for section_index, section in enumerate(test_sections, start=1):
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
        break_cls = " test-break" if section_index > 1 else ""
        # Last test: End Of Report sits under the interpretation, then the signatures.
        close_mark = "<!--ENDSIG-->" if section_index == section_count else "<!--SIG-->"
        sections_html += f"""
        <div class="test-section{break_cls}">
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
          {close_mark}
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
    sig_urls = []
    for sig in signatories[:5]:
        sig_urls.append(cstr(sig.get("signature_url") or "").strip())
        sig_img = _signature_img_html(sig.get("signature_url"))
        name_html = escape(str(sig.get("name") or "").strip()) or "&nbsp;"
        qual_html = escape(str(sig.get("qualification") or "").strip()) or "&nbsp;"
        # Always emit name/qual slots so the blue line and labels stay on one baseline.
        sig_cells += f"""
    <td class="sig-cell" width="20%">
      {sig_img}
      <div class="sig-line">&nbsp;</div>
      <div class="sig-name">{name_html}</div>
      <div class="sig-qual">{qual_html}</div>
      <div class="sig-role">{escape(str(sig.get("role") or ""))}</div>
      <div class="sig-dept">{escape(str(sig.get("department") or ""))}</div>
    </td>"""

    sig_marker = ""
    if pdf_mode:
        # Invisible. The PDF stamper reads this if wkhtmltopdf drops the <img>.
        sig_marker = "<!--HEC-SIG-URLS:" + "|".join(sig_urls) + "-->" + _nabl_map_marker(test_sections)
    sig_table_html = sig_marker + f'<table class="sig-table"><tr>{sig_cells}</tr></table>'
    attribution_html = render_report_attribution_html(payload, for_pdf=pdf_mode)
    end_then_sig = (
        '<div class="end-report">*** End Of Report ***</div>'
        + sig_table_html
        + f'<div class="report-close">{attribution_html}</div>'
    )
    if "<!--ENDSIG-->" in sections_html:
        sections_html = sections_html.replace("<!--ENDSIG-->", end_then_sig, 1)
        sections_html = sections_html.replace("<!--SIG-->", sig_table_html)
    elif "<!--SIG-->" in sections_html:
        sections_html = sections_html.replace("<!--SIG-->", sig_table_html)
    else:
        sections_html += end_then_sig

    title_line = f"<div class='report-title'>{report_title}</div>" if report_title else ""
    dept_line = f"<div class='dept-badge'>{department}</div>" if department else ""
    auth_badge = (
        "<td class='auth-cell'><div class='authorized-badge'>FINAL REPORT</div></td>"
        if (authorized and show_auth_badge)
        else "<td class='auth-cell'></td>"
    )
    plain = 1 if blank_letterhead else 0
    body_classes = ["report-a4"]
    if pdf_mode:
        body_classes.append("pdf-mode")
    if plain:
        body_classes.append("letterhead-plain")
    body_classes.append(f"chrome-{mode}")
    body_class = f' class="{" ".join(body_classes)}"'
    toggle_checked = " checked" if plain else ""
    # Screen/print preview: @page margin 0 + fixed chrome bands / sheet padding.
    # PDF: blank letterhead bands come from @page + wkhtmltopdf margins (no in-body chrome).
    if pdf_mode:
        page_margin = (
            f"@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; "
            f"margin: {band_header_mm}mm {band_side_mm}mm {band_footer_mm}mm {band_side_mm}mm; }}"
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
  function stripArt(on) {{
    document.querySelectorAll(".chrome-art").forEach(function (el) {{
      el.hidden = !!on;
      el.style.setProperty("display", on ? "none" : "", "important");
      el.style.visibility = on ? "hidden" : "";
    }});
    document.querySelectorAll(".chrome-art img, .header-banner, .footer-banner, .nabl-strip, .header-table, .footer-fallback").forEach(function (el) {{
      if (on) {{
        if (el.tagName === "IMG") {{
          if (el.getAttribute("src") && !el.getAttribute("data-lh-src")) {{
            el.setAttribute("data-lh-src", el.getAttribute("src"));
          }}
          el.removeAttribute("src");
        }}
        el.style.setProperty("display", "none", "important");
      }} else {{
        if (el.tagName === "IMG") {{
          var s = el.getAttribute("data-lh-src");
          if (s) el.setAttribute("src", s);
        }}
        el.style.removeProperty("display");
      }}
    }});
  }}
  function apply(on) {{
    document.body.classList.toggle("letterhead-plain", !!on);
    stripArt(on);
    if (pageStyle) {{
      pageStyle.textContent = "@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: 0; }}";
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
    if not blank_letterhead and not footer_banner_html and footer:
        footer_extra = f'<div class="footer-fallback">{footer}</div>'

    # Always keep blank band spacers. Artwork sits in .chrome-art and is stripped when headerless.
    # PDF without_header: omit in-body chrome; blank bands come from page margins in html_to_lab_report_pdf.
    chrome_header_html = ""
    chrome_footer_html = ""
    if not pdf_mode:
        blank_hdr = '<div class="letterhead-blank-band" aria-hidden="true"></div>'
        blank_ftr = '<div class="letterhead-blank-band" aria-hidden="true"></div>'
        art_header = ""
        art_footer = ""
        if not blank_letterhead:
            art_header = f'<div class="chrome-art">{header_banner_html}{header_table_html}{nabl_strip_html}</div>'
            art_footer = f'<div class="chrome-art">{footer_banner_html}{footer_extra}</div>'
        chrome_header_html = f'<div class="report-chrome-header">{blank_hdr}{art_header}</div>'
        chrome_footer_html = f'<div class="report-chrome-footer">{blank_ftr}{art_footer}</div>'

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{lab_name} — Lab Report</title>
<style>
@page {{ size: {A4_WIDTH_MM}mm {A4_HEIGHT_MM}mm; margin: {"0" if not pdf_mode else f"{band_header_mm}mm {band_side_mm}mm {band_footer_mm}mm {band_side_mm}mm"}; }}
* {{ box-sizing: border-box; }}
html, body {{ width: {A4_WIDTH_MM}mm; margin: 0; padding: 0; }}
/* PDF body fills the wkhtmltopdf content box (page minus letterhead margins). */
body.pdf-mode, html.pdf-mode {{ width: 100% !important; max-width: 100% !important; }}
body {{ font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; line-height: 1.35; background: #fff; }}
.report-chrome-header, .report-chrome-footer {{
  width: {A4_WIDTH_MM}mm; overflow: hidden; background: #fff; position: relative;
}}
body.pdf-mode .report-chrome-header, body.pdf-mode .report-chrome-footer {{ width: 100%; }}
.report-chrome-header {{ height: {band_header_mm}mm; min-height: {band_header_mm}mm; }}
.report-chrome-footer {{ height: {band_footer_mm}mm; min-height: {band_footer_mm}mm; }}
.letterhead-blank-band {{
  position: absolute; inset: 0; width: 100%; height: 100%;
  background: #fff; z-index: 0; pointer-events: none;
}}
.chrome-art {{ position: absolute; inset: 0; z-index: 1; }}
.header-banner, .header-banner-full {{
  width: {A4_WIDTH_MM}mm; height: {band_header_mm}mm; display: block; margin: 0; padding: 0; border: 0;
}}
.footer-banner, .footer-banner-full {{
  width: {A4_WIDTH_MM}mm; height: {band_footer_mm}mm; display: block; margin: 0; padding: 0; border: 0;
}}
body.pdf-mode .header-banner, body.pdf-mode .header-banner-full,
body.pdf-mode .footer-banner, body.pdf-mode .footer-banner-full {{ width: 100%; }}
.report-sheet {{
  padding: {band_body_top_mm}mm {band_side_mm}mm {band_body_bottom_mm}mm {band_side_mm}mm;
}}
body.pdf-mode .report-sheet {{
  padding: 2mm {band_side_mm}mm 3mm {band_side_mm}mm;
  width: 100%; max-width: 100%;
}}
body.pdf-mode.letterhead-plain .report-sheet {{ padding: 0; }}
/* Headerless: blank bands stay; artwork never paints. */
body.letterhead-plain .chrome-art,
body.chrome-none .chrome-art,
body.chrome-remedium_without_header .chrome-art,
body.letterhead-plain .header-banner,
body.letterhead-plain .footer-banner,
body.letterhead-plain .header-table,
body.letterhead-plain .nabl-strip,
body.letterhead-plain .footer-fallback,
body.chrome-remedium_without_header .header-banner,
body.chrome-remedium_without_header .footer-banner {{
  display: none !important; visibility: hidden !important;
}}
body.letterhead-plain .report-chrome-header,
body.letterhead-plain .report-chrome-footer,
body.chrome-none .report-chrome-header,
body.chrome-none .report-chrome-footer,
body.chrome-remedium_without_header .report-chrome-header,
body.chrome-remedium_without_header .report-chrome-footer {{
  display: block !important;
  background: #fff !important;
  overflow: hidden;
}}
body.letterhead-plain .letterhead-blank-band,
body.chrome-none .letterhead-blank-band,
body.chrome-remedium_without_header .letterhead-blank-band {{
  display: block !important; background: #fff !important;
}}
body.letterhead-plain .report-sheet,
body.chrome-none .report-sheet,
body.chrome-remedium_without_header .report-sheet {{
  padding: {band_body_top_mm}mm {band_side_mm}mm {band_body_bottom_mm}mm {band_side_mm}mm;
}}
body.pdf-mode.chrome-none .report-sheet,
body.pdf-mode.chrome-remedium_without_header .report-sheet,
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
.header-table {{ width: 100%; height: {band_header_mm}mm; border-collapse: collapse; }}
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
.patient-info-box {{ margin: 4px 0 8px; border: 1.5px solid {accent_safe}; max-width: 100%; overflow: hidden; }}
.meta-grid, .ts-grid {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
.meta-grid td {{ padding: 4px 8px; border: 1px solid #cbd5e1; font-size: 10.5px; vertical-align: middle; word-wrap: break-word; overflow-wrap: anywhere; }}
.meta-grid .meta-label {{ background: #f1f5f9; color: #475569; font-weight: 600; width: 16%; white-space: nowrap; }}
.meta-grid .meta-value {{ color: #0f172a; font-weight: 600; width: 34%; }}
.ts-grid {{ background: #f8fafc; border-top: 1.5px solid {accent_safe}; }}
.ts-grid td {{ padding: 4px 8px; border: 1px solid #cbd5e1; font-size: 10px; word-wrap: break-word; overflow-wrap: anywhere; }}
.ts-grid .ts-label {{ color: #64748b; font-weight: 600; width: 18%; white-space: normal; }}
.ts-grid .ts-value {{ color: #0f172a; font-weight: 700; width: 32%; }}
.report-title {{ text-align: center; font-size: 13px; font-weight: 700; color: {accent_safe}; margin: 4px 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }}
.dept-badge {{ text-align: center; font-size: 10px; color: #64748b; margin-bottom: 6px; }}
.test-section {{ margin-top: 8px; max-width: 100%; }}
/* Each test after the first starts on its own page. overflow:hidden blocks this in wkhtmltopdf. */
.test-break {{ page-break-before: always; break-before: page; }}
body.pdf-mode .report-a4-frame,
body.pdf-mode .report-sheet,
body.pdf-mode .test-section {{ overflow: visible; }}
.category-bar {{ background: {accent_safe}; color: #fff; text-align: center; font-weight: 700; font-size: 11px; padding: 6px 10px; letter-spacing: 0.8px; }}
.test-heading {{ text-align: center; font-size: 13px; font-weight: 700; margin: 0; padding: 8px; color: #0f172a; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }}
.results-table {{ width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; table-layout: fixed; }}
.results-table th {{ background: #334155; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 600; }}
.results-table td {{ padding: 5px 8px; border-bottom: 1px solid #eef2f7; font-size: 10.5px; word-wrap: break-word; overflow-wrap: anywhere; }}
.results-table th:nth-child(1), .results-table td.param-name {{ width: 34%; }}
.results-table th:nth-child(2), .results-table td.param-result {{ width: 14%; }}
.results-table th:nth-child(3), .results-table td.param-unit {{ width: 12%; }}
.results-table th:nth-child(4), .results-table td.param-ref {{ width: 28%; }}
.results-table th:nth-child(5), .results-table td.param-flag {{ width: 12%; }}
.results-table tbody tr:nth-child(even) {{ background: #f8fafc; }}
.param-result {{ text-align: center; font-weight: 400; }}
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
.interpretation-box {{
  font-size: 10px; line-height: 1.45; padding: 8px 10px; margin-top: 6px;
  background: #fffbeb; border-left: 4px solid #f59e0b;
  max-width: 100%; overflow: hidden; word-wrap: break-word; overflow-wrap: anywhere;
}}
.interpretation-title {{ font-weight: 700; font-size: 11px; margin-bottom: 4px; }}
.interpretation-body, .interpretation-body p, .interpretation-body * {{
  margin: 0 0 4px; max-width: 100%; word-wrap: break-word; overflow-wrap: anywhere;
}}
.notes-box {{ margin-top: 10px; padding: 8px 10px; background: #f0f9ff; border-left: 4px solid {accent_safe}; font-size: 10px; max-width: 100%; word-wrap: break-word; overflow-wrap: anywhere; }}
.notes-box.subtle {{ background: #f8fafc; border-left-color: #94a3b8; }}
.end-report {{ text-align: center; margin: 2px 0 1px; font-weight: 700; letter-spacing: 2px; color: {accent_safe}; font-size: 11px; }}
.report-close {{
  margin-top: 1px; page-break-inside: avoid; page-break-before: avoid;
}}
.report-attribution {{
  width: 100%; margin: 0; padding: 0; page-break-inside: avoid; page-break-before: avoid;
  font-family: "Times New Roman", Times, serif; color: #111; border-collapse: collapse;
}}
.attr-barcode-col {{ width: 46%; padding-right: 8px; vertical-align: middle; }}
.attr-meta-col {{ width: 54%; vertical-align: middle; }}
.attr-barcode-code {{
  font-family: "Courier New", Courier, monospace; font-size: 9px; letter-spacing: 0.3px;
  margin-bottom: 1px;
}}
.attr-barcode {{ margin: 0; }}
.attr-barcode svg, .attr-barcode-img {{
  width: auto; max-width: 100%; height: 36px; max-height: none; display: block;
}}
.attr-line {{ font-size: 9px; line-height: 1.2; margin: 0; white-space: nowrap; }}
.attr-label {{ font-family: "Times New Roman", Times, serif; }}
.attr-value {{ font-family: "Courier New", Courier, monospace; font-weight: 600; }}
.sig-table {{ width: 100%; border-collapse: collapse; margin-top: 2px; margin-bottom: 1px; page-break-inside: avoid; page-break-before: avoid; table-layout: fixed; }}
.sig-cell {{ text-align: center; vertical-align: top; padding: 0 3px; overflow: visible; }}
.sig-image {{ height: 44px; display: block; text-align: center; margin: 0; overflow: visible; }}
.sig-image img {{ display: block; }}
.sig-image.empty {{ height: 44px; }}
.sig-line {{ border-top: 2px solid {accent_safe}; margin: 0 4px 2px; height: 0; font-size: 1px; line-height: 1px; }}
.sig-name {{ font-weight: 700; font-size: 9px; line-height: 1.2; word-wrap: break-word; overflow-wrap: anywhere; }}
.sig-qual {{ font-size: 8px; color: #64748b; margin-top: 1px; line-height: 1.2; word-wrap: break-word; overflow-wrap: anywhere; white-space: normal; }}
.sig-role {{ font-size: 8px; color: {accent_safe}; font-weight: 700; margin-top: 1px; line-height: 1.15; word-wrap: break-word; overflow-wrap: anywhere; }}
.sig-dept {{ font-size: 7px; color: #94a3b8; margin-top: 1px; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.15; word-wrap: break-word; overflow-wrap: anywhere; }}
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
  /* Pin header/footer bands on every printed page (artwork or blank letterhead space). */
  .report-chrome-header, .report-chrome-footer {{
    position: fixed !important; left: 0; z-index: 10;
    display: block !important; background: #fff !important;
  }}
  .report-chrome-header {{ top: 0; height: {band_header_mm}mm !important; }}
  .report-chrome-footer {{ bottom: 0; height: {band_footer_mm}mm !important; }}
  body.letterhead-plain .chrome-art,
  body.chrome-remedium_without_header .chrome-art {{ display: none !important; }}
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
    plain_body = html_plain.split("<body", 1)[-1]
    plain_markup = plain_body.split("<script", 1)[0]
    band_h, band_f, _band_s = _remedium_without_header_bands()
    ok = bool(
        "letterhead-toggle" in html_full
        and "report-chrome-header" in html_full
        and "report-chrome-footer" in html_full
        and "letterhead-blank-band" in html_full
        and "letterhead-plain" in html_plain
        and "letterhead-blank-band" in html_plain
        and 'class="chrome-art"' not in plain_markup
        and "header-banner" not in plain_markup
        and "footer-banner" not in plain_markup
        and f"{band_h}mm" in html_plain
        and f"{band_f}mm" in html_plain
        and "position: fixed !important" in html_plain
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
        "plain_margins": f"{band_h}mm" in html_plain and f"{band_f}mm" in html_plain,
        "pdf_omits_in_body_chrome": 'class="report-chrome-header"' not in html_pdf,
        "none_pdf_omits_chrome": 'class="report-chrome-header"' not in html_none_pdf,
        "header_mm": band_h,
        "footer_mm": band_f,
    }
