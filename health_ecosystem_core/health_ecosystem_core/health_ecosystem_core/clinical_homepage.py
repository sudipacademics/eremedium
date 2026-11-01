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
        "footer": build_site_footer(),
    }


DEFAULT_FOOTER_SUBDOMAINS = [
    {"code": "SUB-WWW", "title": "Patient Portal", "url": "https://www.remediumlabs.in", "open_in_new_tab": 0},
    {"code": "SUB-CAREERS", "title": "Careers", "url": "https://career.e-remedium.in", "open_in_new_tab": 1},
    {"code": "SUB-PARTNERS", "title": "Partners (B2B)", "url": "https://partners.remediumlabs.in", "open_in_new_tab": 1},
    {"code": "SUB-REACH", "title": "Sales Reach", "url": "https://reach.e-remedium.in", "open_in_new_tab": 1},
    {"code": "SUB-COLLECT", "title": "Home Collection", "url": "https://collect.remediumlabs.in", "open_in_new_tab": 1},
    {"code": "SUB-ERP", "title": "ERP Desk", "url": "https://erp.e-remedium.in", "open_in_new_tab": 1},
]

DEFAULT_FOOTER_COMPANY = [
    {"code": "CO-LABS", "title": "Lab Tests", "url": "/diagnostics", "open_in_new_tab": 0},
    {"code": "CO-CENTRES", "title": "Centres", "url": "/centres", "open_in_new_tab": 0},
    {"code": "CO-WELLNESS", "title": "Wellness", "url": "/wellness", "open_in_new_tab": 0},
    {"code": "CO-BLOG", "title": "Blog", "url": "/blog", "open_in_new_tab": 0},
    {"code": "CO-CONTACT", "title": "Contact Us", "url": "/insurance", "open_in_new_tab": 0},
]

DEFAULT_FOOTER_SOCIAL = [
    {"code": "SOC-FACEBOOK", "title": "Facebook", "url": "https://www.facebook.com/remedium.health", "icon": "facebook", "open_in_new_tab": 1},
    {"code": "SOC-INSTAGRAM", "title": "Instagram", "url": "https://www.instagram.com/remedium.health", "icon": "instagram", "open_in_new_tab": 1},
    {"code": "SOC-YOUTUBE", "title": "YouTube", "url": "https://www.youtube.com/@remediumhealth", "icon": "youtube", "open_in_new_tab": 1},
    {"code": "SOC-LINKEDIN", "title": "LinkedIn", "url": "https://www.linkedin.com/company/remedium-health", "icon": "linkedin", "open_in_new_tab": 1},
]

DEFAULT_FOOTER_LEGAL = [
    {"title": "Privacy Policy", "url": "/legal/privacy-policy"},
    {"title": "Disclaimer", "url": "/legal/disclaimer"},
    {"title": "Terms & Conditions", "url": "/legal/terms-and-conditions"},
    {"title": "Refund Policy", "url": "/legal/refund-policy"},
    {"title": "Data Use Policy", "url": "/legal/data-use-policy"},
]

DEFAULT_HOME_COLLECTION_HELPLINE = "+91 8100149230"


def ensure_home_collection_helpline_field():
    """Desk-editable home collection phone for the public footer CTA."""
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return
    try:
        from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

        create_custom_fields(
            {
                "Health Ecosystem Settings": [
                    {
                        "fieldname": "home_collection_helpline",
                        "label": "Home Collection Helpline",
                        "fieldtype": "Data",
                        "default": DEFAULT_HOME_COLLECTION_HELPLINE,
                        "description": "Shown on www footer as Home Collection Call. Update here without redeploying the website.",
                        "insert_after": "whatsapp_prefill_message",
                    },
                    {
                        "fieldname": "home_collection_hours",
                        "label": "Home Collection Hours",
                        "fieldtype": "Data",
                        "default": "9:00 AM – 8:00 PM",
                        "insert_after": "home_collection_helpline",
                    },
                ]
            },
            update=True,
        )
    except Exception:
        frappe.log_error(title="ensure_home_collection_helpline_field", message=frappe.get_traceback())


def load_home_collection_helpline():
    ensure_home_collection_helpline_field()
    value = _settings_value("home_collection_helpline", DEFAULT_HOME_COLLECTION_HELPLINE)
    return str(value or DEFAULT_HOME_COLLECTION_HELPLINE).strip() or DEFAULT_HOME_COLLECTION_HELPLINE


def first_tel_href(helpline):
    """Build tel: link from the first phone number in a helpline string."""
    digits = re.sub(r"\D", "", str(helpline or "").split("/")[0].split(",")[0])
    if len(digits) >= 10:
        if len(digits) == 10:
            digits = f"91{digits}"
        return f"tel:+{digits}"
    return ""


def build_site_footer():
    """Public marketing footer payload (guest-safe)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase76_site_footer import build_footer_payload

        return build_footer_payload()
    except Exception:
        frappe.log_error(title="build_site_footer", message=frappe.get_traceback())
        helpline = load_home_collection_helpline()
        hours = _settings_value("home_collection_hours", "9:00 AM – 8:00 PM")
        brand = _settings_value("public_brand_name", "Remedium") or "Remedium"
        tagline = _settings_value("public_brand_tagline", "a unit of Smilecure Lifestyle Pvt. Ltd") or (
            "a unit of Smilecure Lifestyle Pvt. Ltd"
        )
        return {
            "brand": brand,
            "tagline": tagline,
            "subdomains": list(DEFAULT_FOOTER_SUBDOMAINS),
            "company": list(DEFAULT_FOOTER_COMPANY),
            "resources": [
                {"code": "RES-ACCR", "title": "Accreditations & Certifications", "url": "/accreditations", "open_in_new_tab": False},
                {"code": "RES-POL", "title": "Policies", "url": "/policies", "open_in_new_tab": False},
                {"code": "RES-PRESS", "title": "News & Press", "url": "/press", "open_in_new_tab": False},
                {"code": "RES-KNOW", "title": "Knowledge Centre", "url": "/knowledge", "open_in_new_tab": False},
            ],
            "social": list(DEFAULT_FOOTER_SOCIAL),
            "legal": list(DEFAULT_FOOTER_LEGAL),
            "home_collection_helpline": helpline,
            "home_collection_hours": hours or "",
            "home_collection_tel": first_tel_href(helpline),
            "home_collection_cta_label": f"Home Collection Call {helpline}",
        }
