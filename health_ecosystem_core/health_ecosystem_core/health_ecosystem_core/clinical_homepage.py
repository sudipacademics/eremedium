"""Consumer homepage content — desk-editable DocTypes + Settings."""

import re
from urllib.parse import quote

import frappe
from frappe.utils import cint

DEFAULT_TRUST_BADGES = [
    {"title": "Home sample collection", "subtitle": "Phlebotomist visits your address"},
    {"title": "NABL-ready reports", "subtitle": "Authorized PDFs in your care journey"},
    {"title": "Pay your way", "subtitle": "Online, COD, or at collection centre"},
    {"title": "Live order tracking", "subtitle": "TRF status synced from ERPNext"},
]

DEFAULT_HEALTH_CATEGORIES = [
    {"label": "Full body", "query": "full body", "icon": "🩺", "panel_hint": "Essential Full Body"},
    {"label": "Diabetes", "query": "diabetes", "icon": "🩸", "panel_hint": "Diabetes Care"},
    {"label": "Thyroid", "query": "thyroid", "icon": "🦋", "panel_hint": "Thyroid Care"},
    {"label": "Vitamins", "query": "vitamin", "icon": "💊", "panel_hint": "Vitamin Check"},
    {"label": "Women's health", "query": "women", "icon": "👩", "panel_hint": "Women Wellness"},
    {"label": "Fever & infection", "query": "fever", "icon": "🌡️", "panel_hint": "Fever Panel"},
    {"label": "Heart", "query": "heart", "icon": "❤️", "panel_hint": "Heart Health"},
    {"label": "Men's health", "query": "men", "icon": "👨", "panel_hint": "Men Health"},
    {"label": "Senior care", "query": "senior", "icon": "🧓", "panel_hint": "Senior Citizen"},
    {"label": "Anemia & iron", "query": "iron", "icon": "💉", "panel_hint": "Anemia"},
]


def load_health_categories():
    """Return a full Apollo-style category strip (merge Desk rows with defaults)."""
    rows = _enabled_rows("Home Health Category", ["label", "search_query", "icon"])
    by_label = {}
    for r in rows or []:
        by_label[(r.label or "").strip().lower()] = {
            "label": r.label,
            "query": r.search_query,
            "icon": r.icon or "",
        }
    out = []
    seen = set()
    for default in DEFAULT_HEALTH_CATEGORIES:
        key = default["label"].strip().lower()
        if key in by_label:
            out.append(by_label[key])
        else:
            out.append({"label": default["label"], "query": default["query"], "icon": default["icon"]})
        seen.add(key)
    for key, row in by_label.items():
        if key not in seen:
            out.append(row)
    return out


DEFAULT_COLLECTION_STEPS = [
    {"step": 1, "title": "Book online", "description": "Pick tests, slot, and payment method"},
    {"step": 2, "title": "Phlebo assigned", "description": "Your hub assigns a home visit"},
    {"step": 3, "title": "Sample collected", "description": "Barcode scanned at your doorstep"},
    {"step": 4, "title": "Lab processing", "description": "Results entered and reviewed"},
    {"step": 5, "title": "Report ready", "description": "Download NABL PDF from My orders"},
]

DEFAULT_QUICK_LINKS = [
    {"title": "Book Lab Test", "route": "lab"},
    {"title": "Chronic medicines", "route": "pharmacy"},
    {"title": "Book Doctor", "route": "appointments"},
    {"title": "My Orders", "route": "orders"},
]

DEFAULT_RADIOLOGY = [
    {"title": "X-Ray", "description": "Chest, spine, joints", "query": "x-ray", "icon": "🩻"},
    {"title": "Ultrasound", "description": "Abdomen, pelvis, pregnancy", "query": "ultrasound", "icon": "📡"},
    {"title": "MRI", "description": "Brain, spine, joints", "query": "mri", "icon": "🧲"},
    {"title": "CT Scan", "description": "Head, chest, abdomen", "query": "ct scan", "icon": "💿"},
]

ROUTE_MAP = {
    "lab": "/diagnostics",
    "pharmacy": "/pharmacy",
    "appointments": "/appointments/book",
    "orders": "/bookings",
}


def _settings_value(fieldname, default=None):
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return default
    try:
        val = frappe.db.get_single_value("Health Ecosystem Settings", fieldname)
        return val if val not in (None, "") else default
    except Exception:
        return default


def _enabled_rows(doctype, fields, order_by="display_order asc, name asc"):
    if not frappe.db.exists("DocType", doctype):
        return []
    return frappe.get_all(
        doctype,
        filters={"enabled": 1},
        fields=fields,
        order_by=order_by,
    )


def load_trust_badges():
    rows = _enabled_rows("Home Trust Badge", ["title", "subtitle"])
    if rows:
        return [{"title": r.title, "subtitle": r.subtitle or ""} for r in rows]
    return list(DEFAULT_TRUST_BADGES)


def load_collection_steps():
    rows = _enabled_rows(
        "Home Collection Step",
        ["step_number", "title", "description"],
        order_by="display_order asc, step_number asc",
    )
    if rows:
        return [
            {
                "step": int(r.step_number),
                "title": r.title,
                "description": r.description or "",
            }
            for r in rows
        ]
    return list(DEFAULT_COLLECTION_STEPS)


def load_quick_links():
    rows = _enabled_rows("Home Quick Link", ["title", "route_key", "custom_url"])
    if rows:
        links = []
        for r in rows:
            route = (r.route_key or "lab").strip().lower()
            if route == "custom" and r.custom_url:
                links.append({"title": r.title, "route": "custom", "url": r.custom_url})
            else:
                links.append({"title": r.title, "route": route})
        return links
    return list(DEFAULT_QUICK_LINKS)


def load_radiology_services():
    rows = _enabled_rows("Home Radiology Service", ["title", "description", "search_query", "icon"])
    if rows:
        return [
            {
                "title": r.title,
                "description": r.description or "",
                "query": r.search_query,
                "icon": r.icon or "",
            }
            for r in rows
        ]
    return list(DEFAULT_RADIOLOGY)


def load_health_packages():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import panel_catalog_payload

    return panel_catalog_payload()


def load_home_headers():
    defaults = {
        "home_title": "Book lab tests online",
        "home_subtitle": "Trusted diagnostics, doctor visits, and pharmacy — with home sample collection.",
        "lab_title": "Diagnostic Tests",
        "pharmacy_title": "Medicine Store",
        "search_placeholder": "Search tests & packages (e.g. CBC, thyroid, diabetes)",
        "section_packages_title": "Health packages",
        "section_radiology_title": "Radiology & imaging",
        "section_popular_title": "Popular diagnostics",
    }
    return {
        "home_title": _settings_value("mobile_home_title", defaults["home_title"]),
        "home_subtitle": _settings_value("mobile_home_subtitle", defaults["home_subtitle"]),
        "lab_title": _settings_value("lab_catalog_title", defaults["lab_title"]),
        "pharmacy_title": _settings_value("pharmacy_catalog_title", defaults["pharmacy_title"]),
        "search_placeholder": _settings_value("home_search_placeholder", defaults["search_placeholder"]),
        "section_packages_title": _settings_value(
            "home_section_packages_title", defaults["section_packages_title"]
        ),
        "section_radiology_title": _settings_value(
            "home_section_radiology_title", defaults["section_radiology_title"]
        ),
        "section_popular_title": _settings_value(
            "home_section_popular_title", defaults["section_popular_title"]
        ),
    }


def _whatsapp_digits(number):
    digits = re.sub(r"\D", "", str(number or ""))
    if len(digits) > 10:
        digits = digits[-10:]
    return digits if len(digits) == 10 else None


def load_whatsapp_cta():
    enabled = bool(cint(_settings_value("enable_whatsapp_cta", 1)))
    label = _settings_value("whatsapp_cta_label", "Book on WhatsApp")
    number = _whatsapp_digits(_settings_value("whatsapp_business_number"))
    message = _settings_value("whatsapp_prefill_message", "Hi, I would like to book a lab test.")
    url = None
    if number:
        url = f"https://wa.me/91{number}?text={quote(message or '')}"
    return {
        "enabled": enabled and bool(url),
        "label": label,
        "phone": number,
        "url": url,
    }


def home_content_extras():
    """Sections beyond banners/promotions/popular tests."""
    return {
        "trust_badges": load_trust_badges(),
        "health_categories": load_health_categories(),
        "collection_steps": load_collection_steps(),
        "quick_actions": load_quick_links(),
        "health_packages": load_health_packages(),
        "radiology_services": load_radiology_services(),
        "whatsapp_cta": load_whatsapp_cta(),
        "headers": load_home_headers(),
    }
