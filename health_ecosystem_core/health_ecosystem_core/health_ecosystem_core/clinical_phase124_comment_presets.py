"""Phase 124 — Lab Result Entry comment / note preset library.

Technicians save reusable Comments / Notes snippets. Each user owns their
library; starters are seeded once per user on first list.
"""

from __future__ import annotations

import re
from html import unescape

import frappe
from frappe import _
from frappe.utils import cint

from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
from health_ecosystem_core.health_ecosystem_core.clinical_iam import require_roles

DOCTYPE = "HEC Comment Preset"
CATEGORIES = ("General", "Technical", "Interpretation", "Critical", "Sample issue")
STARTERS = (
    {"category": "General", "title": "Within normal range", "text": "Result is within normal reference range."},
    {"category": "Interpretation", "title": "Suggestive of hypothyroidism", "text": "Results are suggestive of hypothyroidism."},
    {"category": "Interpretation", "title": "Suggestive of hyperthyroidism", "text": "Results are suggestive of hyperthyroidism."},
    {"category": "General", "title": "Correlate clinically", "text": "Please correlate clinically."},
    {"category": "Sample issue", "title": "Repeat sample recommended", "text": "Repeat sample is recommended."},
    {"category": "Sample issue", "title": "Unsatisfactory sample", "text": "Sample is unsatisfactory for analysis."},
    {"category": "Sample issue", "title": "Hemolyzed sample", "text": "Hemolyzed sample. Repeat sample recommended."},
)


def _staff_guard():
    if frappe.session.user == "Guest":
        return _error("Not authenticated", 401)
    return require_roles("Lab Technician", "Pathologist", "Health System Admin", "System Manager")


def _html_to_plain(value):
    text = unescape(str(value or ""))
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n", text)
    text = re.sub(r"(?i)</li>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).replace("\xa0", " ").strip()


def _normalize_category(raw, fallback="General"):
    value = (raw or "").strip()
    return value if value in CATEGORIES else fallback


def _derive_title(title, plain):
    title = (title or "").strip()
    if title:
        return title[:140]
    first = (plain or "").splitlines()[0].strip() if plain else ""
    return (first or "Untitled preset")[:140]


def _ensure_doctype():
    fields = [
        {
            "fieldname": "owner_user",
            "label": "Owner",
            "fieldtype": "Data",
            "reqd": 1,
            "in_list_view": 1,
            "in_standard_filter": 1,
        },
        {
            "fieldname": "title",
            "label": "Title",
            "fieldtype": "Data",
            "reqd": 1,
            "in_list_view": 1,
        },
        {
            "fieldname": "category",
            "label": "Category",
            "fieldtype": "Select",
            "options": "\n".join(CATEGORIES),
            "default": "General",
            "in_list_view": 1,
            "in_standard_filter": 1,
        },
        {
            "fieldname": "comment_html",
            "label": "Comment HTML",
            "fieldtype": "Long Text",
        },
        {
            "fieldname": "comment_text",
            "label": "Comment Text",
            "fieldtype": "Long Text",
        },
        {
            "fieldname": "is_starter",
            "label": "Starter",
            "fieldtype": "Check",
            "default": "0",
        },
    ]
    if frappe.db.exists("DocType", DOCTYPE):
        doc = frappe.get_doc("DocType", DOCTYPE)
        existing = {row.fieldname for row in doc.fields}
        added = False
        for field in fields:
            if field["fieldname"] not in existing:
                doc.append("fields", field)
                added = True
        if added:
            doc.save(ignore_permissions=True)
            frappe.clear_cache(doctype=DOCTYPE)
        return False
    doc = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": DOCTYPE,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "autoname": "hash",
            "naming_rule": "Random",
            "engine": "InnoDB",
            "track_changes": 1,
            "title_field": "title",
            "search_fields": "title,category,comment_text",
            "fields": fields,
            "permissions": [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Health System Admin",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Lab Technician",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                },
                {
                    "role": "Pathologist",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                },
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.clear_cache(doctype=DOCTYPE)
    return True


def setup_phase124():
    created = _ensure_doctype()
    frappe.db.commit()
    return {"ok": True, "doctype": DOCTYPE, "created": bool(created)}


def _serialize(doc):
    html = (doc.comment_html or "").strip() or (doc.comment_text or "")
    plain = (doc.comment_text or "").strip() or _html_to_plain(html)
    return {
        "id": doc.name,
        "name": doc.name,
        "title": doc.title or _derive_title("", plain),
        "category": _normalize_category(doc.category),
        "text": html,
        "plain": plain,
        "is_starter": cint(doc.is_starter),
        "owner": doc.owner_user,
        "can_edit": 1,
    }


def _get_own(preset_id):
    if not preset_id or not frappe.db.exists(DOCTYPE, preset_id):
        return None
    doc = frappe.get_doc(DOCTYPE, preset_id)
    if (doc.owner_user or "") != frappe.session.user:
        return None
    return doc


def _insert_preset(*, title, category, html, plain, is_starter=0):
    doc = frappe.get_doc(
        {
            "doctype": DOCTYPE,
            "owner_user": frappe.session.user,
            "title": _derive_title(title, plain),
            "category": _normalize_category(category),
            "comment_html": html,
            "comment_text": plain,
            "is_starter": 1 if is_starter else 0,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


def _seed_starters(user):
    if frappe.db.exists(DOCTYPE, {"owner_user": user}):
        return 0
    count = 0
    for row in STARTERS:
        _insert_preset(
            title=row["title"],
            category=row["category"],
            html=row["text"],
            plain=row["text"],
            is_starter=1,
        )
        count += 1
    return count


def _matches_query(row, q):
    if not q:
        return True
    hay = " ".join([row.get("title") or "", row.get("plain") or "", row.get("text") or "", row.get("category") or ""])
    return q in hay.lower()


@frappe.whitelist()
def list_comment_presets(q=None):
    guard = _staff_guard()
    if guard:
        return guard
    _ensure_doctype()
    user = frappe.session.user
    seeded = _seed_starters(user)
    if seeded:
        frappe.db.commit()
    q = (_parse_request_value("q", q) or "").strip().lower()
    names = frappe.get_all(
        DOCTYPE,
        filters={"owner_user": user},
        pluck="name",
        order_by="modified desc",
        limit_page_length=500,
    )
    presets = [_serialize(frappe.get_doc(DOCTYPE, name)) for name in names]
    if q:
        presets = [row for row in presets if _matches_query(row, q)]
    return _success({"presets": presets, "categories": list(CATEGORIES)})


@frappe.whitelist()
def save_comment_preset(title=None, category=None, text=None):
    guard = _staff_guard()
    if guard:
        return guard
    _ensure_doctype()
    title = _parse_request_value("title", title) or ""
    category = _parse_request_value("category", category)
    text = _parse_request_value("text", text) or ""
    plain = _html_to_plain(text)
    if not plain:
        return _error("Write a comment before saving it as a preset")
    doc = _insert_preset(title=title, category=category, html=text.strip(), plain=plain, is_starter=0)
    frappe.db.commit()
    return _success(_serialize(doc), message="Preset saved")


@frappe.whitelist()
def update_comment_preset(preset_id=None, title=None, category=None, text=None):
    guard = _staff_guard()
    if guard:
        return guard
    _ensure_doctype()
    preset_id = _parse_request_value("preset_id", preset_id)
    doc = _get_own(preset_id)
    if not doc:
        return _error("Preset not found", 404)
    title = _parse_request_value("title", title)
    category = _parse_request_value("category", category)
    text = _parse_request_value("text", text)
    if text is not None:
        plain = _html_to_plain(text)
        if not plain:
            return _error("Preset text cannot be empty")
        doc.comment_html = str(text).strip()
        doc.comment_text = plain
    else:
        plain = doc.comment_text or _html_to_plain(doc.comment_html)
    if title is not None:
        doc.title = _derive_title(title, plain)
    if category is not None:
        doc.category = _normalize_category(category, doc.category or "General")
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success(_serialize(doc), message="Preset updated")


@frappe.whitelist()
def delete_comment_preset(preset_id=None):
    guard = _staff_guard()
    if guard:
        return guard
    _ensure_doctype()
    preset_id = _parse_request_value("preset_id", preset_id)
    doc = _get_own(preset_id)
    if not doc:
        return _error("Preset not found", 404)
    name = doc.name
    frappe.delete_doc(DOCTYPE, name, ignore_permissions=True, force=1)
    frappe.db.commit()
    return _success({"id": name}, message="Preset deleted")


def smoke_comment_presets():
    setup = setup_phase124()
    assert frappe.db.exists("DocType", DOCTYPE), "HEC Comment Preset DocType missing"
    print("SMOKE_OK comment_presets")
    return {"ok": True, "doctype": DOCTYPE, "created": setup.get("created")}
