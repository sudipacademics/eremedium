"""
Phase 93 — Patient portal blog CMS.

Administrators author rich posts (HTML Text Editor + images/video) in ERP Desk
on DocType "HEC Blog Post". Guest APIs feed the public /blog routes.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import _error, _success

BLOG_DOCTYPE = "HEC Blog Post"


def _slugify(text: str) -> str:
	value = (text or "").strip().lower()
	value = re.sub(r"[^a-z0-9\s-]", "", value)
	value = re.sub(r"[\s_-]+", "-", value).strip("-")
	return value[:140] or "post"


def ensure_blog_doctype():
	"""Create or patch HEC Blog Post DocType at runtime (safe to call repeatedly)."""
	if frappe.db.exists("DocType", BLOG_DOCTYPE):
		_ensure_blog_fields()
		return

	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": BLOG_DOCTYPE,
			"module": "Health Ecosystem Core",
			"custom": 0,
			"autoname": "format:BLOG-{#####}",
			"naming_rule": "Expression",
			"title_field": "title",
			"search_fields": "title,slug,category,status",
			"sort_field": "published_on",
			"sort_order": "DESC",
			"track_changes": 1,
			"fields": _blog_field_defs(),
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
				{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "Website Manager", "read": 1, "write": 1, "create": 1, "delete": 0},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def _blog_field_defs():
	return [
		{"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1},
		{"fieldname": "slug", "fieldtype": "Data", "label": "Slug", "reqd": 1, "unique": 1, "in_list_view": 1},
		{"fieldname": "column_break_status", "fieldtype": "Column Break"},
		{
			"fieldname": "status",
			"fieldtype": "Select",
			"label": "Status",
			"options": "Draft\nPublished\nArchived",
			"default": "Draft",
			"reqd": 1,
			"in_list_view": 1,
		},
		{"fieldname": "published_on", "fieldtype": "Datetime", "label": "Published On", "in_list_view": 1},
		{"fieldname": "author_name", "fieldtype": "Data", "label": "Author Name"},
		{"fieldname": "section_content", "fieldtype": "Section Break", "label": "Content"},
		{"fieldname": "excerpt", "fieldtype": "Small Text", "label": "Excerpt"},
		{"fieldname": "featured_image", "fieldtype": "Attach Image", "label": "Featured Image"},
		{"fieldname": "featured_video_url", "fieldtype": "Data", "label": "Featured Video URL"},
		{"fieldname": "content", "fieldtype": "Text Editor", "label": "Body", "reqd": 1},
		{"fieldname": "section_seo", "fieldtype": "Section Break", "label": "SEO & Google Index"},
		{"fieldname": "meta_title", "fieldtype": "Data", "label": "Meta Title"},
		{"fieldname": "meta_description", "fieldtype": "Small Text", "label": "Meta Description"},
		{"fieldname": "meta_keywords", "fieldtype": "Small Text", "label": "Meta Keywords"},
		{"fieldname": "column_break_seo", "fieldtype": "Column Break"},
		{"fieldname": "og_image", "fieldtype": "Attach Image", "label": "OG Image"},
		{"fieldname": "canonical_url", "fieldtype": "Data", "label": "Canonical URL"},
		{
			"fieldname": "allow_google_index",
			"fieldtype": "Check",
			"label": "Allow Google Index",
			"default": "1",
		},
		{"fieldname": "section_publish", "fieldtype": "Section Break", "label": "Listing"},
		{"fieldname": "display_order", "fieldtype": "Int", "label": "Display Order", "default": "0"},
		{"fieldname": "category", "fieldtype": "Data", "label": "Category"},
	]


def _ensure_blog_fields():
	meta = frappe.get_meta(BLOG_DOCTYPE)
	needed = {f["fieldname"]: f for f in _blog_field_defs() if f.get("fieldtype") not in ("Section Break", "Column Break")}
	missing = [f for name, f in needed.items() if not meta.has_field(name)]
	if not missing:
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({BLOG_DOCTYPE: missing}, ignore_validate=True)
	frappe.clear_cache(doctype=BLOG_DOCTYPE)


def ensure_portal_seo_settings_fields():
	"""Add Google Analytics / Tag Manager fields on Health Ecosystem Settings."""
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		return
	meta = frappe.get_meta("Health Ecosystem Settings")
	defs = [
		{
			"fieldname": "section_portal_seo",
			"fieldtype": "Section Break",
			"label": "Patient Portal SEO & Analytics",
			"insert_after": "critical_alert_level",
		},
		{
			"fieldname": "google_analytics_id",
			"fieldtype": "Data",
			"label": "Google Analytics Measurement ID",
			"description": "e.g. G-XXXXXXXXXX — injected on the patient portal.",
			"insert_after": "section_portal_seo",
		},
		{
			"fieldname": "google_tag_manager_id",
			"fieldtype": "Data",
			"label": "Google Tag Manager Container ID",
			"description": "e.g. GTM-XXXXXXX — optional; used when GA ID is empty.",
			"insert_after": "google_analytics_id",
		},
		{
			"fieldname": "enable_google_indexing_default",
			"fieldtype": "Check",
			"label": "Default Allow Google Index for New Posts",
			"default": "1",
			"insert_after": "google_tag_manager_id",
		},
	]
	to_add = [d for d in defs if not meta.has_field(d["fieldname"])]
	if not to_add:
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"Health Ecosystem Settings": to_add}, ignore_validate=True)
	frappe.clear_cache(doctype="Health Ecosystem Settings")


def _settings_str(field, default=""):
	try:
		return cstr(frappe.db.get_single_value("Health Ecosystem Settings", field) or default).strip()
	except Exception:
		return default


def _public_file_url(path):
	if not path:
		return ""
	path = cstr(path).strip()
	if path.startswith("http://") or path.startswith("https://"):
		return path
	return path if path.startswith("/") else f"/{path}"


def _serialize_list_row(row):
	return {
		"name": row.name,
		"title": row.title,
		"slug": row.slug,
		"excerpt": cstr(row.excerpt or ""),
		"featured_image": _public_file_url(row.featured_image),
		"featured_video_url": cstr(row.featured_video_url or ""),
		"author_name": cstr(row.author_name or ""),
		"category": cstr(row.category or ""),
		"published_on": cstr(row.published_on or ""),
		"meta_title": cstr(row.meta_title or row.title or ""),
		"meta_description": cstr(row.meta_description or row.excerpt or ""),
		"allow_google_index": cint(row.allow_google_index) if row.allow_google_index is not None else 1,
	}


def _serialize_detail(doc):
	data = _serialize_list_row(doc)
	data.update(
		{
			"content": cstr(doc.content or ""),
			"meta_keywords": cstr(doc.meta_keywords or ""),
			"og_image": _public_file_url(doc.og_image or doc.featured_image),
			"canonical_url": cstr(doc.canonical_url or ""),
			"status": cstr(doc.status or ""),
		}
	)
	return data


@frappe.whitelist(allow_guest=True)
def list_blog_posts(limit=20, offset=0, category=None):
	"""Public list of published blog posts for the patient portal."""
	ensure_blog_doctype()
	limit = max(1, min(cint(limit) or 20, 50))
	offset = max(0, cint(offset) or 0)
	filters = {"status": "Published"}
	category = cstr(category or frappe.form_dict.get("category") or "").strip()
	if category:
		filters["category"] = category

	rows = frappe.get_all(
		BLOG_DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"title",
			"slug",
			"excerpt",
			"featured_image",
			"featured_video_url",
			"author_name",
			"category",
			"published_on",
			"meta_title",
			"meta_description",
			"allow_google_index",
			"display_order",
		],
		order_by="ifnull(display_order, 0) asc, ifnull(published_on, creation) desc",
		limit_start=offset,
		limit_page_length=limit,
	)
	total = frappe.db.count(BLOG_DOCTYPE, filters)
	return _success({"posts": [_serialize_list_row(r) for r in rows], "total": total, "limit": limit, "offset": offset})


@frappe.whitelist(allow_guest=True)
def get_blog_post(slug=None):
	"""Public single published post by slug."""
	ensure_blog_doctype()
	slug = _slugify(cstr(slug or frappe.form_dict.get("slug") or ""))
	if not slug:
		return _error(_("Slug is required"), 400)
	name = frappe.db.get_value(BLOG_DOCTYPE, {"slug": slug, "status": "Published"}, "name")
	if not name:
		return _error(_("Post not found"), 404)
	doc = frappe.get_doc(BLOG_DOCTYPE, name)
	return _success(_serialize_detail(doc))


@frappe.whitelist(allow_guest=True)
def get_portal_seo_settings():
	"""Guest-safe Google Analytics / Tag Manager IDs for the patient portal."""
	ensure_portal_seo_settings_fields()
	return _success(
		{
			"google_analytics_id": _settings_str("google_analytics_id"),
			"google_tag_manager_id": _settings_str("google_tag_manager_id"),
			"enable_google_indexing_default": cint(_settings_str("enable_google_indexing_default", "1") or 1),
		}
	)


@frappe.whitelist()
def bootstrap_blog_module():
	"""Admin helper: ensure DocType + SEO settings fields exist."""
	if "System Manager" not in frappe.get_roles() and "Health System Admin" not in frappe.get_roles():
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	ensure_blog_doctype()
	ensure_portal_seo_settings_fields()
	return _success({"doctype": BLOG_DOCTYPE}, message=_("Blog module ready"))


def _load_fair_price_blog_seed():
	import json
	import os

	path = frappe.get_app_path("health_ecosystem_core", "data", "remedium_fair_price_blog.json")
	if not os.path.exists(path):
		return None
	with open(path, encoding="utf-8") as fh:
		return json.load(fh)


def seed_default_blog_posts():
	"""Seed or update the Remedium Lab fair-price SEO/GEO article from data/remedium_fair_price_blog.json."""
	ensure_blog_doctype()
	spec = _load_fair_price_blog_seed()
	if not spec:
		return []
	slug = _slugify(spec.get("slug") or spec.get("title") or "")
	if not slug:
		return []
	name = frappe.db.get_value(BLOG_DOCTYPE, {"slug": slug}, "name")
	payload = {
		"title": spec.get("title"),
		"slug": slug,
		"status": "Published",
		"published_on": spec.get("published_on") or now_datetime(),
		"author_name": spec.get("author_name") or "Remedium Editorial Team",
		"excerpt": spec.get("excerpt") or "",
		"content": spec.get("content") or "",
		"meta_title": spec.get("meta_title") or spec.get("title"),
		"meta_description": spec.get("meta_description") or spec.get("excerpt") or "",
		"meta_keywords": (spec.get("meta_keywords") or "")[:500],
		"canonical_url": spec.get("canonical_url") or f"https://www.e-remedium.in/blog/{slug}",
		"allow_google_index": cint(spec.get("allow_google_index", 1)),
		"display_order": cint(spec.get("display_order") or 0),
		"category": spec.get("category") or "Knowledge",
	}
	if name:
		doc = frappe.get_doc(BLOG_DOCTYPE, name)
		doc.update(payload)
		doc.save(ignore_permissions=True)
		return [doc.name]
	doc = frappe.get_doc({"doctype": BLOG_DOCTYPE, **payload})
	doc.insert(ignore_permissions=True)
	return [doc.name]
