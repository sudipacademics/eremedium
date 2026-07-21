"""
Phase 15: Consumer homepage — desk-editable content DocTypes.

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase15.setup_phase15
"""

import os

import frappe

from health_ecosystem_core.health_ecosystem_core.clinical_homepage import (
    DEFAULT_COLLECTION_STEPS,
    DEFAULT_HEALTH_CATEGORIES,
    DEFAULT_QUICK_LINKS,
    DEFAULT_RADIOLOGY,
    DEFAULT_TRUST_BADGES,
)

PHASE15_DOCTYPES = (
    "home_trust_badge/home_trust_badge.json",
    "home_health_category/home_health_category.json",
    "home_collection_step/home_collection_step.json",
    "home_quick_link/home_quick_link.json",
    "home_radiology_service/home_radiology_service.json",
)


def sync_phase15_doctypes(force=False):
    from frappe.modules.import_file import import_file_by_path

    app_path = frappe.get_app_path("health_ecosystem_core")
    base = os.path.join(app_path, "health_ecosystem_core", "health_ecosystem_core", "doctype")
    for rel in PHASE15_DOCTYPES:
        path = os.path.join(base, rel)
        if os.path.exists(path):
            import_file_by_path(path, force=force)

    try:
        frappe.model.sync.sync_for("health_ecosystem_core", force=force)
    except Exception:
        frappe.log_error(title="Phase 15 sync_for", message=frappe.get_traceback())
    frappe.clear_cache()


def _insert_if_missing(doctype, name_field, spec):
    if not frappe.db.exists("DocType", doctype):
        return
    key = spec[name_field]
    if frappe.db.exists(doctype, key):
        return
    frappe.get_doc({"doctype": doctype, "enabled": 1, **spec}).insert(ignore_permissions=True)


def seed_homepage_content():
    if not frappe.db.exists("DocType", "Home Trust Badge"):
        return

    for idx, badge in enumerate(DEFAULT_TRUST_BADGES, start=1):
        _insert_if_missing(
            "Home Trust Badge",
            "title",
            {"title": badge["title"], "subtitle": badge["subtitle"], "display_order": idx},
        )

    for idx, cat in enumerate(DEFAULT_HEALTH_CATEGORIES, start=1):
        _insert_if_missing(
            "Home Health Category",
            "label",
            {
                "label": cat["label"],
                "search_query": cat["query"],
                "icon": cat.get("icon"),
                "display_order": idx,
            },
        )

    for step in DEFAULT_COLLECTION_STEPS:
        docname = f"STEP-{step['step']}"
        if frappe.db.exists("Home Collection Step", docname):
            continue
        frappe.get_doc(
            {
                "doctype": "Home Collection Step",
                "enabled": 1,
                "step_number": step["step"],
                "title": step["title"],
                "description": step["description"],
                "display_order": step["step"],
            }
        ).insert(ignore_permissions=True)

    for idx, link in enumerate(DEFAULT_QUICK_LINKS, start=1):
        _insert_if_missing(
            "Home Quick Link",
            "title",
            {"title": link["title"], "route_key": link["route"], "display_order": idx},
        )

    for idx, svc in enumerate(DEFAULT_RADIOLOGY, start=1):
        _insert_if_missing(
            "Home Radiology Service",
            "title",
            {
                "title": svc["title"],
                "description": svc["description"],
                "search_query": svc["query"],
                "icon": svc.get("icon"),
                "display_order": idx,
            },
        )


def ensure_consumer_workspace_links():
    """Add Consumer Website card to Clinical workspace."""
    if not frappe.db.exists("Workspace", "Clinical"):
        return

    ws = frappe.get_doc("Workspace", "Clinical")
    card_name = "Consumer Website"
    existing = {link.label for link in (ws.links or [])}
    links = [
        ("Home Trust Badges", "Home Trust Badge"),
        ("Home Categories", "Home Health Category"),
        ("Home Quick Links", "Home Quick Link"),
        ("Home Collection Steps", "Home Collection Step"),
        ("Radiology Services", "Home Radiology Service"),
        ("Mobile Banners", "Mobile Home Banner"),
        ("Health Packages", "Lab Test Panel"),
        ("Website Settings", "Health Ecosystem Settings"),
    ]
    for label, link_to in links:
        if label in existing:
            continue
        ws.append("links", {"label": label, "type": "Link", "link_type": "DocType", "link_to": link_to})

    import json

    content = json.loads(ws.content or "[]")
    card_names = {block.get("data", {}).get("card_name") for block in content if block.get("type") == "card"}
    if card_name not in card_names:
        content.append(
            {
                "id": frappe.generate_hash(length=10),
                "type": "card",
                "data": {"card_name": card_name, "col": 4},
            }
        )
        ws.content = json.dumps(content)

    if not any(l.label == card_name for l in (ws.links or [])):
        ws.append("links", {"label": card_name, "type": "Card Break"})

    for label, link_to in links:
        if label in {l.label for l in ws.links}:
            continue
        ws.append(
            "links",
            {
                "label": label,
                "type": "Link",
                "link_type": "DocType",
                "link_to": link_to,
                "parent": card_name,
            },
        )

    ws.save(ignore_permissions=True)


def setup_phase15(seed=True):
    sync_phase15_doctypes(force=True)
    if seed:
        seed_homepage_content()
    try:
        ensure_consumer_workspace_links()
    except Exception:
        frappe.log_error(title="Phase 15 workspace", message=frappe.get_traceback())
    frappe.db.commit()
    frappe.clear_cache()
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import home_content_extras

    return {"ok": True, "phase": 15, "homepage": home_content_extras()}
