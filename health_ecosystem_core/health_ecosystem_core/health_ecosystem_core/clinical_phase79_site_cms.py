"""Phase 79 — Full Desk-editable Site CMS (pages, blocks, SEO, nav, roles).

Run:
  bench --site health.localhost execute \\
    health_ecosystem_core.health_ecosystem_core.clinical_phase79_site_cms.setup_phase79
"""

from __future__ import annotations

import json
import os

import frappe
from frappe.utils import cint, now_datetime

PHASE79_DOCTYPES = (
    "site_cms_block/site_cms_block.json",
    "site_cms_page/site_cms_page.json",
)

CONTENT_EDITOR_ROLE = "Website Content Editor"

CACHE_TTL = 300

LEGAL_SEEDS = (
    {
        "page_key": "legal-privacy-policy",
        "route": "legal/privacy-policy",
        "title": "Privacy Policy",
        "nav_group": "Legal",
        "nav_order": 10,
        "subtitle": "How Remedium collects, uses, stores, and protects personal information.",
        "meta_description": "Remedium Privacy Policy — data collection, use, sharing and your rights.",
        "body": (
            "<p>Remedium (a unit of Smilecure Lifestyle Pvt. Ltd) operates the Remedium digital "
            "health platform at https://www.e-remedium.in.</p>"
            "<p>We collect identity, contact, health-related, account, payment, device and "
            "(with consent) location data to fulfil bookings, process payments, send "
            "transactional notifications, and meet legal obligations.</p>"
            "<p>We do not sell personal data. Limited sharing occurs with franchisee centres, "
            "labs, payment gateways and regulators as required.</p>"
            "<p>Contact <a href=\"mailto:support@e-remedium.in\">support@e-remedium.in</a> "
            "for privacy questions. Edit this page in Desk → Site CMS Page.</p>"
        ),
    },
    {
        "page_key": "legal-disclaimer",
        "route": "legal/disclaimer",
        "title": "Disclaimer",
        "nav_group": "Legal",
        "nav_order": 20,
        "subtitle": "Important limits on advice, availability and third-party content.",
        "meta_description": "Remedium Disclaimer — clinical advice limits and platform availability.",
        "body": (
            "<p>Content on Remedium is for general information and does not replace "
            "professional medical advice, diagnosis or treatment.</p>"
            "<p>Service availability, turnaround times and centre coverage may vary. "
            "Always consult a qualified clinician for personal health decisions.</p>"
            "<p>Edit this page in Desk → Site CMS Page.</p>"
        ),
    },
    {
        "page_key": "legal-terms",
        "route": "legal/terms-and-conditions",
        "title": "Terms & Conditions",
        "nav_group": "Legal",
        "nav_order": 30,
        "subtitle": "Rules for using Remedium websites, apps and related services.",
        "meta_description": "Remedium Terms & Conditions for use of the platform.",
        "body": (
            "<p>By using Remedium you agree to these Terms. Accounts must use accurate "
            "details. Bookings, payments, cancellations and refunds follow the policies "
            "published on this site.</p>"
            "<p>You must not misuse the platform, attempt unauthorised access, or upload "
            "unlawful content. We may suspend accounts that violate these Terms.</p>"
            "<p>Governing law: India. Edit this page in Desk → Site CMS Page.</p>"
        ),
    },
    {
        "page_key": "legal-refund",
        "route": "legal/refund-policy",
        "title": "Refund Policy",
        "nav_group": "Legal",
        "nav_order": 40,
        "subtitle": "When and how refunds or credits apply to Remedium orders.",
        "meta_description": "Remedium Refund Policy for labs, pharmacy and related orders.",
        "body": (
            "<p>Refunds or wallet credits may apply when a service cannot be fulfilled, "
            "is cancelled within the allowed window, or fails quality checks that make "
            "the result unusable.</p>"
            "<p>Payment gateway fees and completed clinical services are generally "
            "non-refundable. Contact support@e-remedium.in with your booking / TRF ID.</p>"
            "<p>Edit this page in Desk → Site CMS Page.</p>"
        ),
    },
    {
        "page_key": "legal-data-use",
        "route": "legal/data-use-policy",
        "title": "Data Use Policy",
        "nav_group": "Legal",
        "nav_order": 50,
        "subtitle": "How operational and analytics data supports care delivery.",
        "meta_description": "Remedium Data Use Policy for operations and analytics.",
        "body": (
            "<p>We use operational data to route collections, generate reports, improve "
            "turnaround, and monitor quality. Aggregated insights may inform capacity "
            "planning without identifying individual patients where possible.</p>"
            "<p>Sensitive health data is processed only as needed to deliver booked "
            "services and meet regulatory / audit requirements.</p>"
            "<p>Edit this page in Desk → Site CMS Page.</p>"
        ),
    },
)


def sync_phase79_doctypes(force=True):
    from frappe.modules.import_file import import_file_by_path

    app_path = frappe.get_app_path("health_ecosystem_core")
    base = os.path.join(app_path, "health_ecosystem_core", "health_ecosystem_core", "doctype")
    for rel in PHASE79_DOCTYPES:
        path = os.path.join(base, rel)
        if os.path.exists(path):
            import_file_by_path(path, force=force)
    try:
        frappe.reload_doc("Health Ecosystem Core", "doctype", "site_cms_block", force=True)
    except Exception:
        frappe.log_error(title="Phase 79 reload block", message=frappe.get_traceback())
    try:
        frappe.reload_doc("Health Ecosystem Core", "doctype", "site_cms_page", force=True)
    except Exception:
        frappe.log_error(title="Phase 79 reload page", message=frappe.get_traceback())
    # Create missing MariaDB columns from DocType meta (no full bench migrate)
    for dt in ("Site CMS Block", "Site CMS Page"):
        try:
            if frappe.db.exists("DocType", dt):
                frappe.db.updatedb(dt)
        except Exception:
            frappe.log_error(title=f"Phase 79 updatedb {dt}", message=frappe.get_traceback())
    try:
        frappe.model.sync.sync_for("health_ecosystem_core", force=force)
    except Exception:
        frappe.log_error(title="Phase 79 sync_for", message=frappe.get_traceback())
    frappe.clear_cache()


def ensure_website_content_editor_role():
    if not frappe.db.exists("Role", CONTENT_EDITOR_ROLE):
        frappe.get_doc(
            {"doctype": "Role", "role_name": CONTENT_EDITOR_ROLE, "desk_access": 1}
        ).insert(ignore_permissions=True)

    for doctype in ("Site CMS Page", "Site Footer Link"):
        if not frappe.db.exists("DocType", doctype):
            continue
        existing = frappe.get_all(
            "Custom DocPerm",
            filters={"parent": doctype, "role": CONTENT_EDITOR_ROLE},
            pluck="name",
        )
        # DocType permissions are in DocPerm; ensure via DocType if Custom DocPerm empty
        has_perm = frappe.db.exists(
            "DocPerm", {"parent": doctype, "role": CONTENT_EDITOR_ROLE}
        )
        if has_perm or existing:
            continue
        try:
            dt = frappe.get_doc("DocType", doctype)
            roles = {p.role for p in (dt.permissions or [])}
            if CONTENT_EDITOR_ROLE not in roles:
                dt.append(
                    "permissions",
                    {
                        "role": CONTENT_EDITOR_ROLE,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "export": 1,
                        "print": 1,
                        "report": 1,
                    },
                )
                dt.save(ignore_permissions=True)
        except Exception:
            frappe.log_error(title="Phase 79 role perm", message=frappe.get_traceback())

    # File upload for Attach Image fields
    if frappe.db.exists("DocType", "File"):
        if not frappe.db.exists("DocPerm", {"parent": "File", "role": CONTENT_EDITOR_ROLE}):
            try:
                frappe.get_doc(
                    {
                        "doctype": "Custom DocPerm",
                        "parent": "File",
                        "parenttype": "DocType",
                        "parentfield": "permissions",
                        "role": CONTENT_EDITOR_ROLE,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 0,
                    }
                ).insert(ignore_permissions=True)
            except Exception:
                pass


def ensure_cms_workspace_links():
    if not frappe.db.exists("Workspace", "Clinical"):
        return
    ws = frappe.get_doc("Workspace", "Clinical")
    existing = {link.label for link in (ws.links or [])}
    for label, link_to in (
        ("Site CMS Pages", "Site CMS Page"),
        ("Site Footer Links", "Site Footer Link"),
    ):
        if label in existing:
            continue
        ws.append(
            "links",
            {
                "label": label,
                "type": "Link",
                "link_type": "DocType",
                "link_to": link_to,
            },
        )
    ws.save(ignore_permissions=True)


def _public_url(path: str) -> str:
    path = (path or "").strip()
    if not path:
        return "/"
    if path.startswith("http://") or path.startswith("https://") or path.startswith("/"):
        return path
    return f"/{path}"


def _block_row(row) -> dict:
    return {
        "block_type": row.block_type or "Rich Text",
        "heading": row.heading or "",
        "content": row.content or "",
        "image": row.image or "",
        "link_label": row.link_label or "",
        "link_url": row.link_url or "",
        "columns": cint(row.columns) or 1,
        "display_order": cint(row.display_order),
    }


def _page_payload(doc) -> dict:
    blocks = []
    for row in sorted(doc.get("blocks") or [], key=lambda r: cint(r.display_order)):
        if cint(row.enabled) == 0:
            continue
        blocks.append(_block_row(row))
    route = (doc.route or doc.page_key or "").strip().lower().lstrip("/")
    return {
        "page_key": doc.page_key,
        "route": route,
        "title": doc.title,
        "subtitle": doc.subtitle or "",
        "body": doc.body or "",
        "status": doc.status or "Published",
        "published_on": str(doc.published_on) if doc.published_on else "",
        "hero_image": doc.hero_image or "",
        "seo_title": doc.seo_title or doc.title,
        "meta_description": doc.meta_description or "",
        "og_image": doc.og_image or "",
        "noindex": bool(cint(doc.noindex)),
        "nav_group": doc.nav_group or "",
        "nav_order": cint(doc.nav_order),
        "blocks": blocks,
        "contact_email": doc.contact_email or "",
        "contact_phone": doc.contact_phone or "",
        "contact_whatsapp": doc.contact_whatsapp or "",
        "contact_address": doc.contact_address or "",
        "support_hours": doc.support_hours or "",
        "url": _public_url(route),
    }


def _gen_key(base: str) -> str:
    try:
        from health_ecosystem_core.health_ecosystem_core.doctype.site_cms_page.site_cms_page import (
            cms_cache_gen,
        )

        return f"{base}:g{cms_cache_gen()}"
    except Exception:
        return base


def _cache_get(key: str):
    try:
        raw = frappe.cache().get_value(_gen_key(key))
        if raw:
            return json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        pass
    return None


def _cache_set(key: str, value):
    try:
        frappe.cache().set_value(_gen_key(key), json.dumps(value), expires_in_sec=CACHE_TTL)
    except Exception:
        pass


def _find_cms_doc(route_or_key: str):
    key = (route_or_key or "").strip().lower().lstrip("/")
    if not key or not frappe.db.exists("DocType", "Site CMS Page"):
        return None

    meta = frappe.get_meta("Site CMS Page")
    name = None
    # Prefer exact route match when column exists
    if meta.has_field("route"):
        try:
            name = frappe.db.get_value("Site CMS Page", {"route": key}, "name")
        except Exception:
            name = None
    if not name:
        name = frappe.db.get_value("Site CMS Page", {"page_key": key}, "name")
    if not name and "/" not in key:
        # page_key == name for autoname field:page_key
        if frappe.db.exists("Site CMS Page", key):
            name = key
    if not name and key.startswith("legal/"):
        slug = key.replace("/", "-")
        name = frappe.db.get_value("Site CMS Page", {"page_key": slug}, "name")
        if not name and frappe.db.exists("Site CMS Page", slug):
            name = slug
    if not name:
        return None
    return frappe.get_doc("Site CMS Page", name)


def load_cms_page(route_or_key: str, *, published_only: bool = True):
    """Public page payload by route or page_key (with cache)."""
    key = (route_or_key or "").strip().lower().lstrip("/")
    if not key:
        return None

    cache_key = f"hec:cms:page:{key}:{'pub' if published_only else 'any'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    doc = _find_cms_doc(key)
    if not doc:
        # Fall back to phase76 defaults for about/contact
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase76_site_footer import (
                DEFAULT_CMS_PAGES,
            )

            for spec in DEFAULT_CMS_PAGES:
                if spec["page_key"] == key or spec["page_key"] == key.split("/")[-1]:
                    payload = {
                        "page_key": spec["page_key"],
                        "route": spec["page_key"],
                        "title": spec["title"],
                        "subtitle": spec.get("subtitle") or "",
                        "body": spec.get("body") or "",
                        "status": "Published",
                        "published_on": "",
                        "hero_image": "",
                        "seo_title": spec["title"],
                        "meta_description": "",
                        "og_image": "",
                        "noindex": False,
                        "nav_group": "Company",
                        "nav_order": 0,
                        "blocks": [],
                        "contact_email": spec.get("contact_email") or "",
                        "contact_phone": spec.get("contact_phone") or "",
                        "contact_whatsapp": spec.get("contact_whatsapp") or "",
                        "contact_address": spec.get("contact_address") or "",
                        "support_hours": spec.get("support_hours") or "",
                        "url": _public_url(spec["page_key"]),
                    }
                    _cache_set(cache_key, payload)
                    return payload
        except Exception:
            pass
        return None

    if published_only:
        if cint(doc.enabled) == 0:
            return None
        if (doc.status or "Published") != "Published":
            return None

    payload = _page_payload(doc)
    _cache_set(cache_key, payload)
    return payload


def list_cms_pages(nav_group: str | None = None, *, published_only: bool = True):
    """List published CMS pages, optionally filtered by nav_group."""
    group = (nav_group or "").strip()
    cache_key = f"hec:cms:list:{group or 'all'}:{'pub' if published_only else 'any'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    if not frappe.db.exists("DocType", "Site CMS Page"):
        return []

    meta = frappe.get_meta("Site CMS Page")
    filters = {}
    if published_only:
        filters["enabled"] = 1
        if meta.has_field("status"):
            filters["status"] = "Published"
    if group and group != "all" and meta.has_field("nav_group"):
        filters["nav_group"] = group

    fields = ["page_key", "title", "subtitle"]
    for f in ("route", "nav_group", "nav_order", "published_on", "hero_image", "meta_description", "seo_title"):
        if meta.has_field(f):
            fields.append(f)

    order = "title asc"
    if meta.has_field("nav_order"):
        order = "nav_order asc, title asc"

    rows = frappe.get_all(
        "Site CMS Page",
        filters=filters,
        fields=fields,
        order_by=order,
    )
    out = []
    for r in rows:
        route = (getattr(r, "route", None) or r.page_key or "").strip().lower().lstrip("/")
        out.append(
            {
                "page_key": r.page_key,
                "route": route,
                "title": r.title,
                "subtitle": r.subtitle or "",
                "nav_group": getattr(r, "nav_group", None) or "",
                "nav_order": cint(getattr(r, "nav_order", 0)),
                "published_on": str(getattr(r, "published_on", "") or ""),
                "hero_image": getattr(r, "hero_image", None) or "",
                "seo_title": getattr(r, "seo_title", None) or r.title,
                "meta_description": getattr(r, "meta_description", None) or "",
                "url": _public_url(route),
            }
        )
    _cache_set(cache_key, out)
    return out


def load_legal_nav_links():
    """Footer legal column from CMS pages with nav_group=Legal."""
    cache_key = "hec:cms:footer_legal"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    pages = list_cms_pages("Legal", published_only=True)
    links = [{"title": p["title"], "url": p["url"]} for p in pages]
    if not links:
        links = [
            {"title": "Privacy Policy", "url": "/legal/privacy-policy"},
            {"title": "Disclaimer", "url": "/legal/disclaimer"},
            {"title": "Terms & Conditions", "url": "/legal/terms-and-conditions"},
            {"title": "Refund Policy", "url": "/legal/refund-policy"},
            {"title": "Data Use Policy", "url": "/legal/data-use-policy"},
        ]
    _cache_set(cache_key, links)
    return links


def migrate_existing_cms_pages():
    """Fill route/status/nav_group on existing about/contact pages."""
    if not frappe.db.exists("DocType", "Site CMS Page"):
        return
    meta = frappe.get_meta("Site CMS Page")
    has_route = meta.has_field("route")
    if not has_route:
        return

    for key, nav_group, nav_order in (("about", "Company", 10), ("contact", "Company", 20)):
        if not frappe.db.exists("Site CMS Page", key):
            continue
        doc = frappe.get_doc("Site CMS Page", key)
        changed = False
        if not doc.get("route"):
            doc.route = key
            changed = True
        if not doc.get("status"):
            doc.status = "Published"
            changed = True
        if not doc.get("published_on") and doc.status == "Published":
            doc.published_on = now_datetime()
            changed = True
        if not doc.get("nav_group"):
            doc.nav_group = nav_group
            changed = True
        if cint(doc.get("nav_order")) == 0 and nav_order:
            doc.nav_order = nav_order
            changed = True
        if changed:
            doc.save(ignore_permissions=True)


def seed_legal_cms_pages():
    if not frappe.db.exists("DocType", "Site CMS Page"):
        return
    meta = frappe.get_meta("Site CMS Page")
    if not meta.has_field("route"):
        return

    for spec in LEGAL_SEEDS:
        key = spec["page_key"]
        if frappe.db.exists("Site CMS Page", key):
            doc = frappe.get_doc("Site CMS Page", key)
            # Only fill empty fields so Desk edits are preserved
            changed = False
            for field in (
                "route",
                "title",
                "subtitle",
                "body",
                "nav_group",
                "nav_order",
                "meta_description",
                "status",
            ):
                current = doc.get(field)
                value = spec.get(field)
                if field == "status":
                    value = "Published"
                if field == "nav_order":
                    value = spec.get("nav_order", 0)
                if current in (None, "") and value not in (None, ""):
                    doc.set(field, value)
                    changed = True
            if not doc.get("published_on"):
                doc.published_on = now_datetime()
                changed = True
            if cint(doc.enabled) == 0:
                doc.enabled = 1
                changed = True
            if changed:
                doc.save(ignore_permissions=True)
            continue

        frappe.get_doc(
            {
                "doctype": "Site CMS Page",
                "page_key": key,
                "route": spec["route"],
                "title": spec["title"],
                "subtitle": spec.get("subtitle") or "",
                "body": spec.get("body") or "",
                "status": "Published",
                "published_on": now_datetime(),
                "enabled": 1,
                "nav_group": spec.get("nav_group") or "Legal",
                "nav_order": cint(spec.get("nav_order")),
                "meta_description": spec.get("meta_description") or "",
                "seo_title": spec["title"],
            }
        ).insert(ignore_permissions=True)


def setup_phase79(seed=True):
    sync_phase79_doctypes(force=True)
    ensure_website_content_editor_role()
    try:
        ensure_cms_workspace_links()
    except Exception:
        frappe.log_error(title="Phase 79 workspace", message=frappe.get_traceback())

    # Re-seed phase76 about/contact if missing, then migrate fields
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase76_site_footer import (
            seed_site_footer_content,
        )

        if seed:
            seed_site_footer_content()
    except Exception:
        frappe.log_error(title="Phase 79 reseed76", message=frappe.get_traceback())

    migrate_existing_cms_pages()
    if seed:
        seed_legal_cms_pages()

    frappe.db.commit()
    frappe.clear_cache()
    about = None
    contact = None
    legal_count = 0
    try:
        about = load_cms_page("about")
        contact = load_cms_page("contact")
        legal_count = len(list_cms_pages("Legal"))
    except Exception:
        frappe.log_error(title="Phase 79 post-load", message=frappe.get_traceback())
    return {
        "ok": True,
        "phase": 79,
        "about": about,
        "contact": contact,
        "legal_count": legal_count,
        "role": CONTENT_EDITOR_ROLE,
        "has_route": frappe.get_meta("Site CMS Page").has_field("route"),
    }


def smoke_phase79():
    about = load_cms_page("about")
    legal = list_cms_pages("Legal")
    footer_legal = load_legal_nav_links()
    return {
        "ok": bool(about and legal and footer_legal),
        "about_title": (about or {}).get("title"),
        "legal_pages": len(legal),
        "footer_legal": len(footer_legal),
        "has_blocks_field": frappe.get_meta("Site CMS Page").has_field("blocks"),
        "has_role": frappe.db.exists("Role", CONTENT_EDITOR_ROLE),
    }
