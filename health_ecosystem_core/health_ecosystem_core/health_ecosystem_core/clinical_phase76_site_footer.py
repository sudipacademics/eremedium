"""
Phase 76 — Site footer links + CMS pages (desk-editable for www SEO/footer).

Desk: HEC Site Footer Link, HEC Site CMS Page
Run: bench --site SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase76_site_footer.setup_phase76
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr

from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

FOOTER_DOCTYPE = "HEC Site Footer Link"
CMS_DOCTYPE = "HEC Site CMS Page"
FAQ_DOCTYPE = "HEC Site FAQ"

DEFAULT_SEO_KEYWORDS = (
	"Remedium, Remedium Lab, Remedium Aesthetic, Remedium Care, "
	"India's First fair price Diagnostic Lab, diagnostics Kolkata, NABL lab"
)
DEFAULT_SEO_TAGLINE = "India's First Fair Price Diagnostic Lab"

DEFAULT_SEO_GEO = {
	"public_website_title": "Remedium — India's First Fair Price Diagnostic Lab",
	"public_meta_title": "Remedium Lab | Fair Price Diagnostics & Home Collection",
	"public_meta_description": (
		"Remedium Lab — affordable blood tests, pathology, home sample collection and digital reports. "
		"Transparent pricing across participating centres in India."
	),
	"public_canonical_url": "https://www.e-remedium.in",
	"public_robots_index": 1,
	"public_robots_follow": 1,
	"public_og_title": "Remedium Lab | Fair Price Diagnostic Lab India",
	"public_og_description": (
		"Book affordable blood tests and health checkups with Remedium Lab — transparent pricing, "
		"home collection and digital reports."
	),
	"public_org_name": "Smilecure Lifestyle Pvt. Ltd.",
	"public_org_display_name": "Remedium",
	"public_contact_phone": "+91-8100149230",
	"public_contact_email": "support@e-remedium.in",
	"public_street_address": "ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani",
	"public_city": "Kolkata",
	"public_state": "West Bengal",
	"public_pin_code": "700156",
	"public_country": "India",
	"public_latitude": "22.5726",
	"public_longitude": "88.3639",
	"public_google_maps_url": "",
	"public_sitemap_url": "https://www.e-remedium.in/sitemap.xml",
	"public_gsc_verification": "",
	"public_twitter_card": "summary_large_image",
}

DEFAULT_FOOTER_RESOURCES = (
	{
		"link_code": "RES-ACCR",
		"title": "Accreditations & Certifications",
		"link_group": "Resources",
		"url": "/accreditations",
		"open_in_new_tab": 0,
		"display_order": 10,
	},
	{
		"link_code": "RES-POL",
		"title": "Policies",
		"link_group": "Resources",
		"url": "/policies",
		"open_in_new_tab": 0,
		"display_order": 20,
	},
	{
		"link_code": "RES-PRESS",
		"title": "News & Press",
		"link_group": "Resources",
		"url": "/press",
		"open_in_new_tab": 0,
		"display_order": 30,
	},
	{
		"link_code": "RES-KNOW",
		"title": "Knowledge Centre",
		"link_group": "Resources",
		"url": "/knowledge",
		"open_in_new_tab": 0,
		"display_order": 40,
	},
	{
		"link_code": "RES-FAQ",
		"title": "FAQs",
		"link_group": "Resources",
		"url": "/faq",
		"open_in_new_tab": 0,
		"display_order": 50,
	},
)

DEFAULT_FOOTER_COMPANY_SEO = (
	{
		"link_code": "CO-REMEDIUM",
		"title": "Remedium",
		"link_group": "Company",
		"url": "/",
		"open_in_new_tab": 0,
		"display_order": 5,
	},
	{
		"link_code": "CO-LAB",
		"title": "Remedium Lab",
		"link_group": "Company",
		"url": "/diagnostics",
		"open_in_new_tab": 0,
		"display_order": 10,
	},
	{
		"link_code": "CO-AEST",
		"title": "Remedium Aesthetic",
		"link_group": "Company",
		"url": "/wellness/aesthetics",
		"open_in_new_tab": 0,
		"display_order": 20,
	},
	{
		"link_code": "CO-CARE",
		"title": "Remedium Care",
		"link_group": "Company",
		"url": "/circle",
		"open_in_new_tab": 0,
		"display_order": 30,
	},
	{
		"link_code": "CO-CENTRES",
		"title": "Centres",
		"link_group": "Company",
		"url": "/centres",
		"open_in_new_tab": 0,
		"display_order": 40,
	},
	{
		"link_code": "CO-WELLNESS",
		"title": "Wellness",
		"link_group": "Company",
		"url": "/wellness",
		"open_in_new_tab": 0,
		"display_order": 50,
	},
)

DEFAULT_CMS_PAGES = (
	{
		"page_key": "accreditations",
		"title": "Accreditations & Certifications",
		"subtitle": "Quality systems that underpin every Remedium Lab report.",
		"meta_title": "Accreditations & Certifications | Remedium Lab",
		"meta_description": "Remedium Lab NABL accreditation, ISO 9001:2015 certification, and quality credentials for India's first fair price diagnostic network.",
		"meta_keywords": "Remedium Lab, NABL accredited, ISO 9001, diagnostic lab certification, fair price diagnostics India",
		"body": (
			"<p><strong>Remedium Labs</strong> operates with NABL-aligned quality systems and ISO 9001:2015 certified processes. "
			"Our central and hub laboratories follow standardized SOPs, internal quality control, and equipment calibration programmes.</p>"
			"<ul>"
			"<li><strong>NABL-aligned laboratory operations</strong> — structured QC, EQAS participation where applicable, and authorized signatory review.</li>"
			"<li><strong>ISO 9001:2015</strong> — quality management across sample collection, transport, processing, and reporting.</li>"
			"<li><strong>Transparent reporting</strong> — NABL-style PDF reports with method, reference range, and clinical interpretation where configured.</li>"
			"</ul>"
			"<p>Update this page from ERPNext → HEC Site CMS Page → <code>accreditations</code>.</p>"
		),
	},
	{
		"page_key": "policies",
		"title": "Policies",
		"subtitle": "Privacy, terms, refunds, and responsible use of Remedium digital health services.",
		"meta_title": "Policies | Remedium",
		"meta_description": "Remedium privacy policy, terms and conditions, refund policy, disclaimer, and data use policy.",
		"meta_keywords": "Remedium policies, privacy policy, terms, refund policy, diagnostic lab policies",
		"body": (
			"<p>Remedium (Smilecure Lifestyle Pvt. Ltd.) publishes clear policies for patients, partners, and staff. "
			"Select a policy from the list on this page or manage copy in ERPNext → HEC Site CMS Page → <code>policies</code>.</p>"
		),
	},
	{
		"page_key": "press",
		"title": "News & Press",
		"subtitle": "Announcements, media coverage, and updates from Remedium.",
		"meta_title": "News & Press | Remedium",
		"meta_description": "Latest Remedium news, press releases, and media updates from India's first fair price diagnostic lab network.",
		"meta_keywords": "Remedium news, Remedium press, diagnostic lab announcements, Remedium media",
		"body": (
			"<p>Official announcements and media highlights from <strong>Remedium</strong>. "
			"Publish press posts as HEC Blog Post with category <em>Press</em> or <em>News</em> — they appear below automatically.</p>"
		),
	},
	{
		"page_key": "knowledge",
		"title": "Knowledge Centre",
		"subtitle": "Health education, lab test guides, and wellness insights from Remedium clinicians.",
		"meta_title": "Knowledge Centre | Remedium",
		"meta_description": "Remedium Knowledge Centre — articles on diagnostics, preventive health, lab tests, and wellness for patients in West Bengal and beyond.",
		"meta_keywords": "Remedium Knowledge Centre, health blog, lab test guide, diagnostic education, Remedium Lab",
		"body": (
			"<p>Explore articles curated by the Remedium team. "
			"Authors publish from ERPNext → HEC Blog Post; featured articles appear on this page.</p>"
		),
	},
)


def _footer_field_defs():
	return [
		{"fieldname": "link_code", "fieldtype": "Data", "label": "Link Code", "reqd": 1, "unique": 1, "in_list_view": 1},
		{"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1},
		{
			"fieldname": "link_group",
			"fieldtype": "Select",
			"label": "Group",
			"options": "Subdomain\nCompany\nResources\nLegal\nSocial",
			"reqd": 1,
			"in_list_view": 1,
			"in_standard_filter": 1,
		},
		{"fieldname": "url", "fieldtype": "Data", "label": "URL", "reqd": 1, "in_list_view": 1},
		{"fieldname": "icon", "fieldtype": "Data", "label": "Icon (social only)", "description": "facebook, instagram, youtube, linkedin"},
		{"fieldname": "display_order", "fieldtype": "Int", "label": "Display Order", "default": "0", "in_list_view": 1},
		{"fieldname": "enabled", "fieldtype": "Check", "label": "Enabled", "default": "1", "in_list_view": 1},
		{"fieldname": "open_in_new_tab", "fieldtype": "Check", "label": "Open in New Tab", "default": "0"},
	]


def _cms_field_defs():
	return [
		{"fieldname": "page_key", "fieldtype": "Data", "label": "Page Key", "reqd": 1, "unique": 1, "in_list_view": 1},
		{"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1},
		{"fieldname": "subtitle", "fieldtype": "Small Text", "label": "Subtitle"},
		{"fieldname": "section_content", "fieldtype": "Section Break", "label": "Content"},
		{"fieldname": "body", "fieldtype": "Text Editor", "label": "Body HTML"},
		{"fieldname": "section_seo", "fieldtype": "Section Break", "label": "SEO"},
		{"fieldname": "meta_title", "fieldtype": "Data", "label": "Meta Title"},
		{"fieldname": "meta_description", "fieldtype": "Small Text", "label": "Meta Description"},
		{"fieldname": "meta_keywords", "fieldtype": "Data", "label": "Meta Keywords"},
		{"fieldname": "is_published", "fieldtype": "Check", "label": "Published", "default": "1", "in_list_view": 1},
		{"fieldname": "display_order", "fieldtype": "Int", "label": "Display Order", "default": "0"},
	]


def _ensure_doctype(name, title_field, field_defs, autoname=None):
	if frappe.db.exists("DocType", name):
		return
	if not autoname:
		autoname = {
			FOOTER_DOCTYPE: "field:link_code",
			CMS_DOCTYPE: "field:page_key",
			FAQ_DOCTYPE: "field:faq_code",
		}.get(name, "hash")
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": name,
			"module": "Health Ecosystem Core",
			"custom": 0,
			"autoname": autoname,
			"naming_rule": "By fieldname",
			"title_field": title_field,
			"sort_field": "display_order",
			"sort_order": "ASC",
			"track_changes": 1,
			"fields": field_defs,
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "Website Manager", "read": 1, "write": 1, "create": 1, "delete": 0},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def ensure_seo_settings_fields():
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		return
	meta = frappe.get_meta("Health Ecosystem Settings")
	defs = [
		{
			"fieldname": "section_public_seo",
			"fieldtype": "Section Break",
			"label": "Public Website SEO",
			"insert_after": "home_collection_hours",
		},
		{
			"fieldname": "public_seo_tagline",
			"fieldtype": "Data",
			"label": "SEO Tagline",
			"default": DEFAULT_SEO_TAGLINE,
			"description": "Shown under brand in www footer (e.g. fair price diagnostic lab claim).",
			"insert_after": "section_public_seo",
		},
		{
			"fieldname": "public_seo_keywords",
			"fieldtype": "Small Text",
			"label": "Focus Keywords",
			"default": DEFAULT_SEO_KEYWORDS,
			"description": "Comma-separated focus keywords for meta tags and AI crawlers.",
			"insert_after": "public_seo_tagline",
		},
		{
			"fieldname": "column_break_public_seo",
			"fieldtype": "Column Break",
			"insert_after": "public_seo_keywords",
		},
		{
			"fieldname": "public_website_title",
			"fieldtype": "Data",
			"label": "Website Title",
			"default": DEFAULT_SEO_GEO["public_website_title"],
			"insert_after": "column_break_public_seo",
		},
		{
			"fieldname": "public_meta_title",
			"fieldtype": "Data",
			"label": "Default Meta Title",
			"default": DEFAULT_SEO_GEO["public_meta_title"],
			"insert_after": "public_website_title",
		},
		{
			"fieldname": "public_meta_description",
			"fieldtype": "Small Text",
			"label": "Default Meta Description",
			"default": DEFAULT_SEO_GEO["public_meta_description"],
			"insert_after": "public_meta_title",
		},
		{
			"fieldname": "public_canonical_url",
			"fieldtype": "Data",
			"label": "Canonical URL",
			"default": DEFAULT_SEO_GEO["public_canonical_url"],
			"insert_after": "public_meta_description",
		},
		{
			"fieldname": "public_robots_index",
			"fieldtype": "Check",
			"label": "Robots Index",
			"default": "1",
			"insert_after": "public_canonical_url",
		},
		{
			"fieldname": "public_robots_follow",
			"fieldtype": "Check",
			"label": "Robots Follow",
			"default": "1",
			"insert_after": "public_robots_index",
		},
		{
			"fieldname": "section_public_og",
			"fieldtype": "Section Break",
			"label": "Open Graph & Twitter",
			"insert_after": "public_robots_follow",
		},
		{
			"fieldname": "public_og_title",
			"fieldtype": "Data",
			"label": "OG Title",
			"default": DEFAULT_SEO_GEO["public_og_title"],
			"insert_after": "section_public_og",
		},
		{
			"fieldname": "public_og_description",
			"fieldtype": "Small Text",
			"label": "OG Description",
			"default": DEFAULT_SEO_GEO["public_og_description"],
			"insert_after": "public_og_title",
		},
		{
			"fieldname": "public_twitter_card",
			"fieldtype": "Select",
			"label": "Twitter Card",
			"options": "summary\nsummary_large_image",
			"default": "summary_large_image",
			"insert_after": "public_og_description",
		},
		{
			"fieldname": "section_public_geo",
			"fieldtype": "Section Break",
			"label": "Organization & GEO (Local SEO)",
			"insert_after": "public_twitter_card",
		},
		{
			"fieldname": "public_org_name",
			"fieldtype": "Data",
			"label": "Legal Organization Name",
			"default": DEFAULT_SEO_GEO["public_org_name"],
			"insert_after": "section_public_geo",
		},
		{
			"fieldname": "public_org_display_name",
			"fieldtype": "Data",
			"label": "Public Brand Name",
			"default": DEFAULT_SEO_GEO["public_org_display_name"],
			"insert_after": "public_org_name",
		},
		{
			"fieldname": "public_contact_phone",
			"fieldtype": "Data",
			"label": "Public Contact Phone",
			"default": DEFAULT_SEO_GEO["public_contact_phone"],
			"insert_after": "public_org_display_name",
		},
		{
			"fieldname": "public_contact_email",
			"fieldtype": "Data",
			"label": "Public Contact Email",
			"default": DEFAULT_SEO_GEO["public_contact_email"],
			"insert_after": "public_contact_phone",
		},
		{
			"fieldname": "public_street_address",
			"fieldtype": "Small Text",
			"label": "Street Address",
			"default": DEFAULT_SEO_GEO["public_street_address"],
			"insert_after": "public_contact_email",
		},
		{
			"fieldname": "public_city",
			"fieldtype": "Data",
			"label": "City",
			"default": DEFAULT_SEO_GEO["public_city"],
			"insert_after": "public_street_address",
		},
		{
			"fieldname": "public_state",
			"fieldtype": "Data",
			"label": "State",
			"default": DEFAULT_SEO_GEO["public_state"],
			"insert_after": "public_city",
		},
		{
			"fieldname": "public_pin_code",
			"fieldtype": "Data",
			"label": "PIN Code",
			"default": DEFAULT_SEO_GEO["public_pin_code"],
			"insert_after": "public_state",
		},
		{
			"fieldname": "public_country",
			"fieldtype": "Data",
			"label": "Country",
			"default": DEFAULT_SEO_GEO["public_country"],
			"insert_after": "public_pin_code",
		},
		{
			"fieldname": "public_latitude",
			"fieldtype": "Data",
			"label": "Latitude",
			"default": DEFAULT_SEO_GEO["public_latitude"],
			"insert_after": "public_country",
		},
		{
			"fieldname": "public_longitude",
			"fieldtype": "Data",
			"label": "Longitude",
			"default": DEFAULT_SEO_GEO["public_longitude"],
			"insert_after": "public_latitude",
		},
		{
			"fieldname": "public_google_maps_url",
			"fieldtype": "Data",
			"label": "Google Maps URL",
			"insert_after": "public_longitude",
		},
		{
			"fieldname": "section_public_search",
			"fieldtype": "Section Break",
			"label": "Google Search Console & Sitemap",
			"insert_after": "public_google_maps_url",
		},
		{
			"fieldname": "public_sitemap_url",
			"fieldtype": "Data",
			"label": "XML Sitemap URL",
			"default": DEFAULT_SEO_GEO["public_sitemap_url"],
			"insert_after": "section_public_search",
		},
		{
			"fieldname": "public_gsc_verification",
			"fieldtype": "Data",
			"label": "Google Search Console Verification Code",
			"description": "Content value for meta google-site-verification (not the full tag).",
			"insert_after": "public_sitemap_url",
		},
	]
	to_add = [d for d in defs if not meta.has_field(d["fieldname"])]
	if not to_add:
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	try:
		create_custom_fields({"Health Ecosystem Settings": to_add}, ignore_validate=True)
	except Exception:
		frappe.log_error(title="phase76_seo_fields", message=frappe.get_traceback())
	frappe.clear_cache(doctype="Health Ecosystem Settings")


def _settings_value(fieldname, default=None):
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		return default
	try:
		val = frappe.db.get_single_value("Health Ecosystem Settings", fieldname)
		return val if val not in (None, "") else default
	except Exception:
		return default


def ensure_footer_doctype():
	_ensure_doctype(FOOTER_DOCTYPE, "title", _footer_field_defs())


def ensure_cms_doctype():
	_ensure_doctype(CMS_DOCTYPE, "title", _cms_field_defs(), autoname="field:page_key")


def _seed_footer_row(spec):
	if frappe.db.exists(FOOTER_DOCTYPE, {"link_code": spec["link_code"]}):
		return frappe.db.get_value(FOOTER_DOCTYPE, {"link_code": spec["link_code"]}, "name")
	doc = frappe.get_doc({"doctype": FOOTER_DOCTYPE, **spec, "enabled": 1})
	doc.insert(ignore_permissions=True)
	return doc.name


def _seed_cms_row(spec):
	if frappe.db.exists(CMS_DOCTYPE, {"page_key": spec["page_key"]}):
		return frappe.db.get_value(CMS_DOCTYPE, {"page_key": spec["page_key"]}, "name")
	doc = frappe.get_doc({"doctype": CMS_DOCTYPE, **spec, "is_published": 1})
	doc.insert(ignore_permissions=True)
	return doc.name


def seed_default_footer_links():
	"""Seed Resources + SEO company links; leave Subdomain/Legal/Social to clinical_homepage defaults unless missing."""
	from health_ecosystem_core.health_ecosystem_core.clinical_homepage import (
		DEFAULT_FOOTER_COMPANY,
		DEFAULT_FOOTER_LEGAL,
		DEFAULT_FOOTER_SOCIAL,
		DEFAULT_FOOTER_SUBDOMAINS,
	)

	created = []
	for spec in DEFAULT_FOOTER_RESOURCES + DEFAULT_FOOTER_COMPANY_SEO:
		created.append(_seed_footer_row(spec))

	# Seed other groups only when table is empty for that group
	for group, defaults in (
		("Subdomain", DEFAULT_FOOTER_SUBDOMAINS),
		("Legal", [{"link_code": f"LEG-{i}", "title": x["title"], "link_group": "Legal", "url": x["url"], "display_order": (i + 1) * 10, "open_in_new_tab": 0} for i, x in enumerate(DEFAULT_FOOTER_LEGAL)]),
		("Social", DEFAULT_FOOTER_SOCIAL),
	):
		count = frappe.db.count(FOOTER_DOCTYPE, {"link_group": group})
		if count:
			continue
		for spec in defaults:
			row = dict(spec)
			row.setdefault("link_group", group)
			row.setdefault("link_code", row.get("code") or row.get("link_code"))
			if "code" in row:
				row["link_code"] = row.pop("code")
			row.setdefault("enabled", 1)
			row.setdefault("open_in_new_tab", cint(row.get("open_in_new_tab", 0)))
			created.append(_seed_footer_row(row))

	# Legacy company links — add if Company group empty
	if not frappe.db.count(FOOTER_DOCTYPE, {"link_group": "Company"}):
		for i, spec in enumerate(DEFAULT_FOOTER_COMPANY):
			row = {
				"link_code": spec.get("code") or f"CO-LEG-{i}",
				"title": spec["title"],
				"link_group": "Company",
				"url": spec["url"],
				"display_order": (i + 1) * 10,
				"open_in_new_tab": cint(spec.get("open_in_new_tab", 0)),
			}
			created.append(_seed_footer_row(row))

	return created


def seed_default_cms_pages():
	return [_seed_cms_row(spec) for spec in DEFAULT_CMS_PAGES]


def setup_phase76():
	ensure_footer_doctype()
	ensure_cms_doctype()
	ensure_faq_doctype()
	try:
		ensure_seo_settings_fields()
		seed_seo_geo_defaults()
	except Exception:
		frappe.log_error(title="phase76_seo_fields", message=frappe.get_traceback())
	footer = seed_default_footer_links()
	pages = seed_default_cms_pages()
	faqs = seed_default_faqs()
	sync_faq_content()
	blog_seeded = []
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase93_blog import seed_default_blog_posts

		blog_seeded = seed_default_blog_posts()
	except Exception:
		frappe.log_error(title="phase76_blog_seed", message=frappe.get_traceback())
	frappe.db.commit()
	return {
		"ok": True,
		"phase": 76,
		"footer_seeded": len(footer),
		"cms_seeded": len(pages),
		"faqs_seeded": len(faqs),
		"blog_seeded": len(blog_seeded),
	}


def _serialize_footer_link(row):
	return {
		"code": row.get("link_code") or row.get("name"),
		"title": row.get("title"),
		"url": row.get("url"),
		"icon": row.get("icon") or None,
		"open_in_new_tab": bool(cint(row.get("open_in_new_tab"))),
		"group": row.get("link_group"),
	}


def load_footer_links(link_group=None):
	"""Load enabled footer links from ERP, optionally filtered by group."""
	if not frappe.db.exists("DocType", FOOTER_DOCTYPE):
		return []
	filters = {"enabled": 1}
	if link_group:
		filters["link_group"] = link_group
	rows = frappe.get_all(
		FOOTER_DOCTYPE,
		filters=filters,
		fields=["link_code", "title", "url", "icon", "open_in_new_tab", "link_group", "display_order"],
		order_by="display_order asc, title asc",
	)
	return [_serialize_footer_link(r) for r in rows]


def load_footer_by_groups():
	groups = ("Subdomain", "Company", "Resources", "Legal", "Social")
	out = {}
	for g in groups:
		links = load_footer_links(g)
		if links:
			out[g.lower()] = links
	return out


def load_public_seo():
	out = {
		"seo_tagline": _settings_value("public_seo_tagline", DEFAULT_SEO_TAGLINE) or DEFAULT_SEO_TAGLINE,
		"seo_keywords": _settings_value("public_seo_keywords", DEFAULT_SEO_KEYWORDS) or DEFAULT_SEO_KEYWORDS,
	}
	for field, default in DEFAULT_SEO_GEO.items():
		if field.startswith("public_robots_"):
			out[field] = cint(_settings_value(field, default if default else 0))
		else:
			val = _settings_value(field, default)
			out[field] = val if val not in (None, "") else default
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase93_blog import get_portal_seo_settings

		resp = get_portal_seo_settings()
		analytics = (resp or {}).get("data") or {}
		out["google_analytics_id"] = analytics.get("google_analytics_id") or ""
		out["google_tag_manager_id"] = analytics.get("google_tag_manager_id") or ""
		out["enable_google_indexing_default"] = cint(analytics.get("enable_google_indexing_default") or 1)
	except Exception:
		out.setdefault("google_analytics_id", "")
		out.setdefault("google_tag_manager_id", "")
		out.setdefault("enable_google_indexing_default", 1)
	return out


def seed_seo_geo_defaults():
	"""Apply default SEO/GEO single values when fields are empty."""
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		return []
	ensure_seo_settings_fields()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase93_blog import ensure_portal_seo_settings_fields

		ensure_portal_seo_settings_fields()
	except Exception:
		frappe.log_error(title="seed_seo_geo_analytics", message=frappe.get_traceback())
	updated = []
	for field, default in DEFAULT_SEO_GEO.items():
		current = frappe.db.get_single_value("Health Ecosystem Settings", field)
		if current not in (None, ""):
			continue
		frappe.db.set_single_value("Health Ecosystem Settings", field, default)
		updated.append(field)
	if not frappe.db.get_single_value("Health Ecosystem Settings", "public_seo_tagline"):
		frappe.db.set_single_value("Health Ecosystem Settings", "public_seo_tagline", DEFAULT_SEO_TAGLINE)
		updated.append("public_seo_tagline")
	if not frappe.db.get_single_value("Health Ecosystem Settings", "public_seo_keywords"):
		frappe.db.set_single_value("Health Ecosystem Settings", "public_seo_keywords", DEFAULT_SEO_KEYWORDS)
		updated.append("public_seo_keywords")
	if not frappe.db.get_global("hec_public_robots_seeded"):
		if not cint(frappe.db.get_single_value("Health Ecosystem Settings", "public_robots_index")):
			frappe.db.set_single_value("Health Ecosystem Settings", "public_robots_index", 1)
			updated.append("public_robots_index")
		if not cint(frappe.db.get_single_value("Health Ecosystem Settings", "public_robots_follow")):
			frappe.db.set_single_value("Health Ecosystem Settings", "public_robots_follow", 1)
			updated.append("public_robots_follow")
		frappe.db.set_global("hec_public_robots_seeded", 1)
	frappe.db.commit()
	return updated


def build_footer_payload():
	"""Merge ERP footer links with helpline/brand from homepage settings."""
	from health_ecosystem_core.health_ecosystem_core.clinical_homepage import (
		DEFAULT_FOOTER_COMPANY,
		DEFAULT_FOOTER_LEGAL,
		DEFAULT_FOOTER_SOCIAL,
		DEFAULT_FOOTER_SUBDOMAINS,
		_settings_value,
		first_tel_href,
		load_home_collection_helpline,
	)

	ensure_footer_doctype()
	ensure_cms_doctype()
	ensure_faq_doctype()
	seed_default_footer_links()
	if not frappe.db.count(CMS_DOCTYPE):
		seed_default_cms_pages()
	if not frappe.db.count(FAQ_DOCTYPE):
		seed_default_faqs()
	try:
		ensure_seo_settings_fields()
	except Exception:
		frappe.log_error(title="phase76_seo_fields", message=frappe.get_traceback())
	frappe.db.commit()
	groups = load_footer_by_groups()
	seo = load_public_seo()
	helpline = load_home_collection_helpline()
	hours = _settings_value("home_collection_hours", "9:00 AM – 8:00 PM")
	brand = _settings_value("public_brand_name", "Remedium") or "Remedium"
	tagline = _settings_value("public_brand_tagline", "a unit of Smilecure Lifestyle Pvt. Ltd") or (
		"a unit of Smilecure Lifestyle Pvt. Ltd"
	)

	def _fallback(group_key, default_rows, map_fn=None):
		rows = groups.get(group_key)
		if rows:
			return rows
		out = []
		for i, row in enumerate(default_rows):
			item = dict(row)
			code = item.pop("code", None) or item.get("link_code") or f"{group_key}-{i}"
			mapped = {
				"code": code,
				"title": item.get("title") or "",
				"url": item.get("url") or "",
				"icon": item.get("icon"),
				"open_in_new_tab": bool(cint(item.get("open_in_new_tab", 0))),
			}
			if map_fn:
				mapped = map_fn(mapped, item)
			out.append(mapped)
		return out

	legal_rows = groups.get("legal")
	if legal_rows:
		legal = [{"title": x["title"], "url": x["url"]} for x in legal_rows]
	else:
		legal = list(DEFAULT_FOOTER_LEGAL)

	return {
		"brand": brand,
		"tagline": tagline,
		"seo_tagline": seo["seo_tagline"],
		"seo_keywords": seo["seo_keywords"],
		"subdomains": _fallback("subdomain", DEFAULT_FOOTER_SUBDOMAINS),
		"company": _fallback("company", DEFAULT_FOOTER_COMPANY_SEO + DEFAULT_FOOTER_COMPANY),
		"resources": _fallback("resources", DEFAULT_FOOTER_RESOURCES),
		"social": _fallback("social", DEFAULT_FOOTER_SOCIAL),
		"legal": legal,
		"home_collection_helpline": helpline,
		"home_collection_hours": hours or "",
		"home_collection_tel": first_tel_href(helpline),
		"home_collection_cta_label": f"Home Collection Call {helpline}",
	}


def _serialize_cms_page(doc):
	return {
		"page_key": doc.page_key,
		"title": doc.title,
		"subtitle": doc.subtitle or "",
		"body": doc.body or "",
		"meta_title": doc.meta_title or doc.title,
		"meta_description": doc.meta_description or "",
		"meta_keywords": doc.meta_keywords or "",
		"is_published": cint(getattr(doc, "is_published", 1)),
	}


@frappe.whitelist(allow_guest=True)
def get_site_cms_page(page_key=None):
	page_key = cstr(_parse_request_value("page_key", page_key) or "").strip().lower()
	if not page_key:
		return _error(_("page_key is required"))
	if not frappe.db.exists("DocType", CMS_DOCTYPE):
		setup_phase76()
	if not frappe.db.exists(CMS_DOCTYPE, {"page_key": page_key, "is_published": 1}):
		# Fallback defaults for first deploy before desk edit
		for spec in DEFAULT_CMS_PAGES:
			if spec["page_key"] == page_key:
				return _success(_serialize_cms_page(frappe._dict(spec)))
		return _error(_("Page not found"), 404)
	doc = frappe.get_doc(CMS_DOCTYPE, {"page_key": page_key})
	return _success(_serialize_cms_page(doc))


@frappe.whitelist(allow_guest=True)
def get_public_seo_settings():
	setup_phase76()
	return _success(load_public_seo())


def _faq_field_defs():
	return [
		{"fieldname": "faq_code", "fieldtype": "Data", "label": "FAQ Code", "reqd": 1, "unique": 1, "in_list_view": 1},
		{"fieldname": "section", "fieldtype": "Data", "label": "Section Title", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
		{"fieldname": "section_id", "fieldtype": "Data", "label": "Section ID", "description": "URL anchor slug, e.g. remedium-labs"},
		{"fieldname": "question", "fieldtype": "Data", "label": "Question", "reqd": 1, "in_list_view": 1},
		{"fieldname": "answer", "fieldtype": "Text Editor", "label": "Answer", "reqd": 1},
		{"fieldname": "display_order", "fieldtype": "Int", "label": "Display Order", "default": "0", "in_list_view": 1},
		{"fieldname": "enabled", "fieldtype": "Check", "label": "Enabled", "default": "1", "in_list_view": 1},
	]


def ensure_faq_doctype():
	_ensure_doctype(FAQ_DOCTYPE, "question", _faq_field_defs(), autoname="field:faq_code")


def _load_default_faq_sections():
	import json
	import os

	path = frappe.get_app_path("health_ecosystem_core", "data", "remedium_site_faqs.json")
	if not os.path.exists(path):
		return []
	with open(path, encoding="utf-8") as fh:
		return json.load(fh)


def seed_default_faqs():
	ensure_faq_doctype()
	order = 0
	created = []
	for section in _load_default_faq_sections():
		sec_title = section.get("title") or ""
		sec_id = section.get("id") or ""
		for item in section.get("items") or []:
			order += 10
			code = item.get("faq_code")
			if not code or frappe.db.exists(FAQ_DOCTYPE, {"faq_code": code}):
				continue
			doc = frappe.get_doc(
				{
					"doctype": FAQ_DOCTYPE,
					"faq_code": code,
					"section": sec_title,
					"section_id": sec_id,
					"question": item.get("question"),
					"answer": item.get("answer"),
					"display_order": order,
					"enabled": 1,
				}
			)
			doc.insert(ignore_permissions=True)
			created.append(doc.name)
	return created


def sync_faq_content():
	"""Update FAQ question/answer text from remedium_site_faqs.json when faq_code exists."""
	ensure_faq_doctype()
	order = 0
	updated = []
	for section in _load_default_faq_sections():
		sec_title = section.get("title") or ""
		sec_id = section.get("id") or ""
		for item in section.get("items") or []:
			order += 10
			code = item.get("faq_code")
			if not code:
				continue
			name = frappe.db.get_value(FAQ_DOCTYPE, {"faq_code": code}, "name")
			if not name:
				continue
			doc = frappe.get_doc(FAQ_DOCTYPE, name)
			changed = False
			for field, val in (
				("section", sec_title),
				("section_id", sec_id),
				("question", item.get("question")),
				("answer", item.get("answer")),
				("display_order", order),
			):
				if val is not None and doc.get(field) != val:
					doc.set(field, val)
					changed = True
			if changed:
				doc.save(ignore_permissions=True)
				updated.append(name)
	return updated


def load_faq_sections():
	"""Grouped FAQ payload for /faq page."""
	if not frappe.db.exists("DocType", FAQ_DOCTYPE):
		return _load_default_faq_sections()
	rows = frappe.get_all(
		FAQ_DOCTYPE,
		filters={"enabled": 1},
		fields=["section", "section_id", "question", "answer", "display_order"],
		order_by="display_order asc, name asc",
	)
	if not rows:
		return _load_default_faq_sections()
	sections = []
	by_key = {}
	for row in rows:
		key = row.section_id or row.section
		if key not in by_key:
			by_key[key] = {"id": row.section_id or key, "title": row.section, "items": []}
		by_key[key]["items"].append({"question": row.question, "answer": row.answer})
	for section in by_key.values():
		sections.append(section)
	return sections


@frappe.whitelist(allow_guest=True)
def get_site_faqs():
	ensure_faq_doctype()
	if not frappe.db.count(FAQ_DOCTYPE):
		seed_default_faqs()
		frappe.db.commit()
	return _success({"sections": load_faq_sections()})

