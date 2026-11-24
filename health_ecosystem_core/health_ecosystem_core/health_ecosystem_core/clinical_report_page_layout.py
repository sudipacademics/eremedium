"""LabTech Settings — Report Page Management.

Layouts for SLPL and Remedium (NABL digital, Non-NABL digital, physical),
optional branch overrides, and PDF geometry for the existing report engine.
"""

from __future__ import annotations

import copy
import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
	_require_lab_settings,
	_save_attach,
)

BRANDS = ("slpl", "remedium")
FORMATS = ("with_header", "without_header", "non_nabl")
LETTERHEAD_FORMATS = ("with_header", "non_nabl")
STORAGE_FIELD = "page_layouts_json"
OVERRIDES_FIELD = "page_layout_branch_overrides_json"
ACTIVE_FIELD = "page_layout_active_json"
TEMPLATES_FIELD = "page_editor_templates_json"

BRAND_LABELS = {
	"slpl": "SLPL Lab",
	"remedium": "Remedium Lab",
}
FORMAT_LABELS = {
	"with_header": "Digital with NABL letterhead",
	"without_header": "Physical without letterhead",
	"non_nabl": "Digital with Non-NABL letterhead",
}


def _is_letterhead_format(fmt):
	return cstr(fmt or "").lower() in LETTERHEAD_FORMATS


def _empty_with_header(brand):
	return {
		"header_enabled": 1,
		"footer_enabled": 1,
		# Same letterhead geometry for every lab (Remedium-proven A4 bands).
		"header_height_mm": 36.83,
		"footer_height_mm": 24.36,
		"side_mm": 8.0,
		"gap_mm": 1.5,
		"header_image": "",
		"footer_image": "",
		"lab_logo": "",
		"nabl_logo": "",
		"header_template": "nabl" if brand == "remedium" else "standard",
		"footer_template": "standard",
		"include_nabl_logo": 1 if brand == "remedium" else 0,
		"include_barcode": 1,
		"show_address": 1,
		"include_disclaimer": 1,
		"lab_name": "SLPL Laboratory" if brand == "slpl" else "Remedium Diagnostics",
		"lab_address": "",
		"lab_phone": "",
		"lab_website": "",
		"disclaimer": "This is a computer generated report. Not valid without authorised signature.",
		"template_name": ("SLPL Lab report" if brand == "slpl" else "Remedium Lab report"),
	}


def _empty_non_nabl(brand):
	layout = _empty_with_header(brand)
	layout["header_template"] = "non_nabl"
	layout["include_nabl_logo"] = 0
	layout["template_name"] = (
		"SLPL Non-NABL report" if brand == "slpl" else "Remedium Non-NABL report"
	)
	return layout


def _empty_without_header(brand):
	# Same content box as digital letterhead — blank bands for pre-printed pads.
	return {
		"header_enabled": 0,
		"footer_enabled": 0,
		"header_height_mm": 36.83,
		"footer_height_mm": 24.36,
		"margin_top_mm": 36.83,
		"margin_bottom_mm": 24.36,
		"margin_left_mm": 8.0,
		"margin_right_mm": 8.0,
		"side_mm": 8.0,
		"header_image": "",
		"footer_image": "",
		"include_barcode": 1,
		"show_address": 0,
		"include_disclaimer": 1,
		"include_nabl_logo": 0,
		"lab_name": "SLPL Laboratory" if brand == "slpl" else "Remedium Diagnostics",
		"lab_address": "",
		"lab_phone": "",
		"lab_website": "",
		"disclaimer": "This is a computer generated report. Not valid without authorised signature.",
		"template_name": ("SLPL Lab report" if brand == "slpl" else "Remedium Lab report"),
	}


def default_store():
	return {
		brand: {
			"with_header": _empty_with_header(brand),
			"without_header": _empty_without_header(brand),
			"non_nabl": _empty_non_nabl(brand),
		}
		for brand in BRANDS
	}


def _parse_json(raw, fallback):
	if isinstance(raw, dict):
		return raw
	text = cstr(raw or "").strip()
	if not text:
		return copy.deepcopy(fallback)
	try:
		data = json.loads(text)
		return data if isinstance(data, dict) else copy.deepcopy(fallback)
	except Exception:
		return copy.deepcopy(fallback)


def ensure_page_layout_storage():
	"""Long-text JSON on Lab Report Branding — avoids fragile HES custom-field validation."""
	if not frappe.db.exists("DocType", "Lab Report Branding"):
		return False
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	fields = [
		{
			"fieldname": STORAGE_FIELD,
			"label": "Page Layouts JSON",
			"fieldtype": "Long Text",
			"insert_after": "show_authorized_badge",
			"hidden": 1,
		},
		{
			"fieldname": OVERRIDES_FIELD,
			"label": "Page Layout Branch Overrides JSON",
			"fieldtype": "Long Text",
			"insert_after": STORAGE_FIELD,
			"hidden": 1,
		},
		{
			"fieldname": ACTIVE_FIELD,
			"label": "Active Page Layout JSON",
			"fieldtype": "Small Text",
			"insert_after": OVERRIDES_FIELD,
			"hidden": 1,
		},
		{
			"fieldname": TEMPLATES_FIELD,
			"label": "Page Editor Templates JSON",
			"fieldtype": "Long Text",
			"insert_after": ACTIVE_FIELD,
			"hidden": 1,
		},
	]
	try:
		create_custom_fields({"Lab Report Branding": fields}, ignore_validate=True, update=True)
	except Exception:
		frappe.log_error(title="report_page_layout_fields", message=frappe.get_traceback())
	return True


def _branding_doc():
	from health_ecosystem_core.health_ecosystem_core.doctype.lab_report_branding.lab_report_branding import (
		ensure_lab_report_branding,
	)

	ensure_lab_report_branding()
	ensure_page_layout_storage()
	return frappe.get_single("Lab Report Branding")


def _letterhead_mtime(url):
	"""mtime of a letterhead file on disk, or 0 if missing."""
	import os

	raw = cstr(url or "").strip()
	if not raw:
		return 0.0
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
			_local_letterhead_path,
		)

		path = _local_letterhead_path(raw)
	except Exception:
		path = ""
	if not path:
		fname = raw.rsplit("/", 1)[-1].split("?")[0]
		if fname:
			try:
				cand = frappe.get_site_path("public", "files", fname)
				if os.path.isfile(cand):
					path = cand
			except Exception:
				path = ""
	if not path:
		return 0.0
	try:
		return float(os.path.getmtime(path))
	except Exception:
		return 0.0


_STALE_LETTERHEAD_NAMES = frozenset(
	{
		"03.png",
		"04.png",
		"03.jpg",
		"04.jpg",
		"03.jpeg",
		"04.jpeg",
	}
)


def _letterhead_basename(url):
	return cstr(url or "").split("?", 1)[0].rsplit("/", 1)[-1].strip().lower()


def heal_stale_letterheads_from_branding(persist=True):
	"""Fill missing / known-stale Page Management pads from branding.

	Never replaces a real Template Management upload with an older branding URL —
	that was wiping Save template / Upload changes on the next PDF.
	"""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

		b = get_report_branding() or {}
	except Exception:
		b = {}
	store = load_store()
	changed = []
	pairs = (
		(
			"remedium",
			"with_header",
			"header_image",
			cstr(b.get("nabl_header_banner") or b.get("header_banner") or ""),
		),
		(
			"remedium",
			"with_header",
			"footer_image",
			cstr(b.get("footer_banner") or ""),
		),
		(
			"remedium",
			"non_nabl",
			"header_image",
			cstr(b.get("non_nabl_header_banner") or ""),
		),
		(
			"remedium",
			"non_nabl",
			"footer_image",
			cstr(b.get("footer_banner") or ""),
		),
	)
	for brand, fmt, field, brand_url in pairs:
		brand_url = cstr(brand_url or "").strip().split("?", 1)[0]
		if not brand_url:
			continue
		lay = store.setdefault(brand, {}).setdefault(
			fmt, _empty_with_header(brand) if fmt == "with_header" else _empty_non_nabl(brand)
		)
		cur = cstr(lay.get(field) or "").strip().split("?", 1)[0]
		if cur == brand_url:
			continue
		cur_m = _letterhead_mtime(cur) if cur else 0.0
		brand_m = _letterhead_mtime(brand_url)
		stale_name = _letterhead_basename(cur) in _STALE_LETTERHEAD_NAMES
		missing = bool(cur) and cur_m <= 0
		empty = not cur
		# Only seed empty bands, or replace missing/known-stale files — never a fresh upload.
		if brand_m > 0 and (empty or missing or stale_name):
			lay[field] = brand_url
			changed.append(f"{brand}/{fmt}.{field}")
	if changed and persist:
		_write_store(store)
	return {"changed": changed, "persisted": bool(changed and persist)}


def _seed_from_branding(store, saved=None):
	"""Fill Remedium with-header images only when that layout has never stored them.

	An empty header_image or footer_image in the saved layout means Remove, and must stay empty.
	"""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

		b = get_report_branding() or {}
	except Exception:
		b = {}
	saved = saved if isinstance(saved, dict) else {}
	rem_saved = (saved.get("remedium") or {}).get("with_header") if isinstance(saved.get("remedium"), dict) else {}
	rem_saved = rem_saved if isinstance(rem_saved, dict) else {}
	rem = store.setdefault("remedium", {}).setdefault("with_header", _empty_with_header("remedium"))
	if "header_image" not in rem_saved and not rem.get("header_image"):
		rem["header_image"] = cstr(
			b.get("nabl_header_banner") or b.get("header_banner") or ""
		)
	if "footer_image" not in rem_saved and not rem.get("footer_image"):
		rem["footer_image"] = cstr(b.get("footer_banner") or "")
	if not rem.get("lab_logo"):
		rem["lab_logo"] = cstr(b.get("lab_logo") or "")
	if not rem.get("nabl_logo"):
		rem["nabl_logo"] = cstr(b.get("nabl_logo") or "")
	for key in ("lab_name", "lab_address", "lab_phone", "lab_website"):
		if not rem.get(key) and b.get(key):
			rem[key] = cstr(b.get(key))
	if b.get("report_footer"):
		rem["disclaimer"] = cstr(b.get("report_footer"))
	nn_saved = (saved.get("remedium") or {}).get("non_nabl") if isinstance(saved.get("remedium"), dict) else {}
	nn_saved = nn_saved if isinstance(nn_saved, dict) else {}
	nn = store.setdefault("remedium", {}).setdefault("non_nabl", _empty_non_nabl("remedium"))
	if "header_image" not in nn_saved and not nn.get("header_image"):
		nn["header_image"] = cstr(b.get("non_nabl_header_banner") or "")
	if "footer_image" not in nn_saved and not nn.get("footer_image"):
		nn["footer_image"] = cstr(b.get("footer_banner") or rem.get("footer_image") or "")
	for key in ("lab_name", "lab_address", "lab_phone", "lab_website", "disclaimer"):
		if not nn.get(key) and rem.get(key):
			nn[key] = rem.get(key)
	# Mirror identity onto without_header text fields
	wo = store.setdefault("remedium", {}).setdefault("without_header", _empty_without_header("remedium"))
	for key in ("lab_name", "lab_address", "lab_phone", "lab_website", "disclaimer"):
		if not wo.get(key) and rem.get(key):
			wo[key] = rem.get(key)
	# SLPL Non-NABL keeps its own artwork; copy identity from SLPL digital if empty.
	sl_saved = (saved.get("slpl") or {}).get("non_nabl") if isinstance(saved.get("slpl"), dict) else {}
	sl_saved = sl_saved if isinstance(sl_saved, dict) else {}
	sl_nn = store.setdefault("slpl", {}).setdefault("non_nabl", _empty_non_nabl("slpl"))
	sl_wh = store.get("slpl", {}).get("with_header") or {}
	for key in ("lab_name", "lab_address", "lab_phone", "lab_website", "disclaimer", "footer_image"):
		if key == "footer_image" and "footer_image" in sl_saved:
			continue
		if not sl_nn.get(key) and sl_wh.get(key):
			sl_nn[key] = sl_wh.get(key)
	return store


def _deep_merge(base, overlay):
	out = copy.deepcopy(base or {})
	if not isinstance(overlay, dict):
		return out
	for key, val in overlay.items():
		if isinstance(val, dict) and isinstance(out.get(key), dict):
			out[key] = _deep_merge(out.get(key), val)
		elif val is not None:
			out[key] = val
	return out


def _normalize_layout(brand, fmt, layout):
	if fmt == "non_nabl":
		base = _empty_non_nabl(brand)
	elif _is_letterhead_format(fmt):
		base = _empty_with_header(brand)
	else:
		base = _empty_without_header(brand)
	merged = _deep_merge(base, layout if isinstance(layout, dict) else {})
	# Clamp geometry to printable A4
	if _is_letterhead_format(fmt):
		merged["header_height_mm"] = max(10.0, min(80.0, flt(merged.get("header_height_mm") or 36.83)))
		merged["footer_height_mm"] = max(8.0, min(50.0, flt(merged.get("footer_height_mm") or 24.36)))
		merged["side_mm"] = max(0.0, min(30.0, flt(merged.get("side_mm") or 8)))
		merged["gap_mm"] = max(0.0, min(10.0, flt(merged.get("gap_mm") or 1.5)))
		if fmt == "non_nabl":
			merged["header_template"] = "non_nabl"
			merged["include_nabl_logo"] = 0
		for flag in (
			"header_enabled",
			"footer_enabled",
			"include_nabl_logo",
			"include_barcode",
			"show_address",
			"include_disclaimer",
		):
			merged[flag] = 1 if cint(merged.get(flag)) else 0
		if fmt == "non_nabl":
			merged["include_nabl_logo"] = 0
	else:
		# Physical without letterhead: match digital band heights; never carry artwork.
		merged["header_enabled"] = 0
		merged["footer_enabled"] = 0
		merged["header_image"] = ""
		merged["footer_image"] = ""
		band_h = flt(merged.get("header_height_mm") or merged.get("margin_top_mm") or 36.83)
		band_f = flt(merged.get("footer_height_mm") or merged.get("margin_bottom_mm") or 24.36)
		# Legacy defaults were 15mm — too short for Remedium pads; bump to letterhead size.
		if band_h < 30.0:
			band_h = 36.83
		if band_f < 20.0:
			band_f = 24.36
		merged["header_height_mm"] = max(10.0, min(80.0, band_h))
		merged["footer_height_mm"] = max(8.0, min(50.0, band_f))
		merged["margin_top_mm"] = merged["header_height_mm"]
		merged["margin_bottom_mm"] = merged["footer_height_mm"]
		merged["margin_left_mm"] = max(0.0, min(30.0, flt(merged.get("margin_left_mm") or merged.get("side_mm") or 8)))
		merged["margin_right_mm"] = max(
			0.0, min(30.0, flt(merged.get("margin_right_mm") or merged["margin_left_mm"]))
		)
		merged["side_mm"] = merged["margin_left_mm"]
		for flag in ("include_barcode", "show_address", "include_disclaimer", "include_nabl_logo"):
			merged[flag] = 1 if cint(merged.get(flag)) else 0
		merged["include_nabl_logo"] = 0
	return merged


def _align_slpl_bands(store):
	"""SLPL used a short 18mm footer that cropped letterhead. Match Remedium bands."""
	slpl = store.get("slpl")
	if not isinstance(slpl, dict):
		return store
	for fmt, layout in slpl.items():
		if not isinstance(layout, dict):
			continue
		if _is_letterhead_format(fmt):
			if abs(flt(layout.get("footer_height_mm")) - 18.0) < 0.2:
				layout["footer_height_mm"] = 24.36
			if abs(flt(layout.get("header_height_mm")) - 40.0) < 0.2:
				layout["header_height_mm"] = 36.83
			layout["margin_top_mm"] = layout["header_height_mm"]
			layout["margin_bottom_mm"] = layout["footer_height_mm"]
		else:
			if abs(flt(layout.get("margin_bottom_mm")) - 18.0) < 0.2:
				layout["margin_bottom_mm"] = 24.36
			if abs(flt(layout.get("margin_top_mm")) - 40.0) < 0.2:
				layout["margin_top_mm"] = 36.83
	return store


def load_store():
	store = default_store()
	try:
		doc = _branding_doc()
		raw = doc.get(STORAGE_FIELD) if doc.meta.has_field(STORAGE_FIELD) else None
		saved = _parse_json(raw, {})
		for brand in BRANDS:
			for fmt in FORMATS:
				saved_layout = ((saved.get(brand) or {}) if isinstance(saved, dict) else {}).get(fmt)
				store[brand][fmt] = _normalize_layout(brand, fmt, saved_layout)
		store = _seed_from_branding(store, saved)
		store = _align_slpl_bands(store)
	except Exception:
		frappe.log_error(title="report_page_layout_load", message=frappe.get_traceback())
		store = _align_slpl_bands(_seed_from_branding(default_store()))
	return store


def load_overrides():
	try:
		doc = _branding_doc()
		if not doc.meta.has_field(OVERRIDES_FIELD):
			return {}
		return _parse_json(doc.get(OVERRIDES_FIELD), {})
	except Exception:
		return {}


def load_active():
	fallback = {"brand": "remedium", "format": "with_header", "branch": ""}
	try:
		doc = _branding_doc()
		if not doc.meta.has_field(ACTIVE_FIELD):
			return fallback
		data = _parse_json(doc.get(ACTIVE_FIELD), fallback)
		brand = cstr(data.get("brand") or "remedium").lower()
		fmt = cstr(data.get("format") or "with_header").lower()
		if brand not in BRANDS:
			brand = "remedium"
		if fmt not in FORMATS:
			fmt = "with_header"
		return {"brand": brand, "format": fmt, "branch": cstr(data.get("branch") or "")}
	except Exception:
		return fallback


def _write_store(store, overrides=None, active=None, branding_sync=None):
	"""Persist page layouts, then mirror banner URLs without Attach Image doc.save."""
	doc = _branding_doc()
	if doc.meta.has_field(STORAGE_FIELD):
		doc.set(STORAGE_FIELD, json.dumps(store, ensure_ascii=False))
	if overrides is not None and doc.meta.has_field(OVERRIDES_FIELD):
		doc.set(OVERRIDES_FIELD, json.dumps(overrides, ensure_ascii=False))
	if active is not None and doc.meta.has_field(ACTIVE_FIELD):
		doc.set(ACTIVE_FIELD, json.dumps(active, ensure_ascii=False))
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)
	# Banner Attach Image fields: update Singles rows only (no Document.save / attach hook).
	for field, value in (branding_sync or {}).items():
		frappe.db.set_value(
			"Lab Report Branding",
			"Lab Report Branding",
			field,
			value,
			update_modified=False,
		)
	frappe.db.commit()
	try:
		frappe.clear_document_cache("Lab Report Branding", "Lab Report Branding")
	except Exception:
		pass
	try:
		frappe.cache().delete_value("lab_report_branding")
	except Exception:
		pass


def list_branches():
	"""Report templates assign only to LabTech branches.

	Franchisee Profile and the HR Branch list belong to other modules.
	This stays empty until the LabTech branch module exists.
	"""
	return []


def get_effective_layout(brand=None, fmt=None, branch=None):
	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower().replace("-", "_")
	if brand not in BRANDS:
		brand = "remedium"
	if fmt in ("none", "plain", "without", "no_header"):
		fmt = "without_header"
	elif fmt in ("nabl", "with", "header"):
		fmt = "with_header"
	elif fmt in ("non_nabl", "without_nabl", "nonnabl"):
		fmt = "non_nabl"
	elif fmt not in FORMATS:
		fmt = "with_header"
	store = load_store()
	layout = copy.deepcopy(store[brand][fmt])
	branch = cstr(branch or "").strip()
	if branch:
		ov = load_overrides()
		branch_ov = (ov.get(branch) or ov.get(branch.upper()) or {}) if isinstance(ov, dict) else {}
		layout = _normalize_layout(
			brand,
			fmt,
			_deep_merge(layout, ((branch_ov.get(brand) or {}).get(fmt) or {})),
		)
	layout["brand"] = brand
	layout["format"] = fmt
	layout["branch"] = branch
	layout["brand_label"] = BRAND_LABELS.get(brand, brand)
	layout["format_label"] = FORMAT_LABELS.get(fmt, fmt)
	return layout


def parse_chrome_to_layout(chrome_mode=None, brand=None, branch=None):
	"""Map legacy chrome_mode / new template ids → effective layout."""
	mode = cstr(chrome_mode or "").strip().lower().replace("-", "_").replace(" ", "_")
	active = load_active()
	use_brand = cstr(brand or active.get("brand") or "remedium").lower()
	use_branch = cstr(branch if branch is not None else active.get("branch") or "").strip()

	fmt = "with_header"
	header_variant = None
	if mode in ("none", "plain", "without_header", "no_header", "without_header_footer", "headerless"):
		fmt = "without_header"
	elif mode in ("with_header", "digital_header", "letterhead"):
		# Delivery "With Header" — caller should already have resolved NABL vs Non-NABL.
		# Default to NABL/with_header page-management template.
		fmt = "with_header"
		header_variant = "nabl"
		use_brand = use_brand if use_brand in BRANDS else "remedium"
	elif mode in ("nabl", "with_nabl"):
		fmt = "with_header"
		header_variant = "nabl"
		use_brand = use_brand if use_brand in BRANDS else "remedium"
	elif mode in ("non_nabl", "without_nabl", "nonnabl", "remedium_non_nabl", "slpl_non_nabl"):
		fmt = "non_nabl"
		header_variant = "non_nabl"
		if mode.startswith("slpl"):
			use_brand = "slpl"
		elif mode.startswith("remedium") or mode in ("non_nabl", "without_nabl", "nonnabl"):
			use_brand = "remedium"
		else:
			use_brand = use_brand if use_brand in BRANDS else "remedium"
	elif mode.endswith("_without_header") or mode.endswith("_none"):
		parts = mode.split("_")
		if parts[0] in BRANDS:
			use_brand = parts[0]
		fmt = "without_header"
	elif mode.endswith("_with_header") or mode.endswith("_nabl"):
		parts = mode.split("_")
		if parts[0] in BRANDS:
			use_brand = parts[0]
		fmt = "with_header"
		if mode.endswith("_nabl"):
			header_variant = "nabl"
	elif mode in ("slpl", "remedium"):
		use_brand = mode
		fmt = cstr(active.get("format") or "with_header")

	# Page Management (Report Template Management) is the source of truth for artwork.
	layout = get_effective_layout(use_brand, fmt, use_branch)
	if header_variant == "nabl" and not layout.get("header_image") and cint(layout.get("header_enabled", 1)):
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

			b = get_report_branding() or {}
			layout["header_image"] = cstr(b.get("nabl_header_banner") or b.get("header_banner") or "")
			layout["footer_image"] = layout.get("footer_image") or cstr(b.get("footer_banner") or "")
		except Exception:
			pass
	if header_variant == "non_nabl":
		layout["include_nabl_logo"] = 0
		if not layout.get("header_image") and cint(layout.get("header_enabled", 1)):
			try:
				from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

				b = get_report_branding() or {}
				layout["header_image"] = cstr(b.get("non_nabl_header_banner") or "")
				if not layout.get("footer_image"):
					layout["footer_image"] = cstr(b.get("footer_banner") or "")
			except Exception:
				pass
	return layout


def get_report_page_management(user=None, brand=None, fmt=None, branch=None):
	access = _require_lab_settings(user)
	store = load_store()
	active = load_active()
	brand = cstr(brand or active.get("brand") or "remedium").lower()
	fmt = cstr(fmt or active.get("format") or "with_header").lower()
	branch = cstr(branch if branch is not None else active.get("branch") or "").strip()
	if brand not in BRANDS:
		brand = "remedium"
	if fmt not in FORMATS:
		fmt = "with_header"
	layout = get_effective_layout(brand, fmt, branch or None)
	templates = list_editor_templates(brand=brand, fmt=fmt)
	return {
		"can_manage": access["can_manage"],
		"brands": [{"id": b, "label": BRAND_LABELS[b]} for b in BRANDS],
		"formats": [{"id": f, "label": FORMAT_LABELS[f]} for f in FORMATS],
		"active": {"brand": brand, "format": fmt, "branch": branch},
		"layout": layout,
		"layouts": store,
		"branches": list_branches(),
		"templates": templates,
		"active_template": get_active_editor_template(brand, fmt),
		"has_branch_override": bool(
			branch
			and ((load_overrides().get(branch) or load_overrides().get(branch.upper()) or {}).get(brand) or {}).get(
				fmt
			)
		),
	}


_SHARED_BOX = (
	"header_height_mm",
	"footer_height_mm",
	"margin_top_mm",
	"margin_bottom_mm",
	"margin_left_mm",
	"margin_right_mm",
	"side_mm",
	"header_align",
	"footer_align",
)


def _copy_content_box(store, brand, fmt, normalized):
	"""All formats for one lab share one content box. Artwork stays per template."""
	for other in FORMATS:
		if other == fmt:
			continue
		sibling = copy.deepcopy(store[brand].get(other) or {})
		for key in _SHARED_BOX:
			if normalized.get(key) not in (None, ""):
				sibling[key] = normalized[key]
		# Physical keeps a copy of NABL digital artwork refs for the UI only.
		if fmt == "with_header" and other == "without_header":
			sibling["header_image"] = normalized.get("header_image") or ""
			sibling["footer_image"] = normalized.get("footer_image") or ""
		store[brand][other] = _normalize_layout(brand, other, sibling)


def save_report_page_layout(
	user=None,
	brand=None,
	fmt=None,
	layout=None,
	branch=None,
	as_branch_override=0,
	file_name=None,
	file_data=None,
	image_field=None,
):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can change report page layouts"), frappe.PermissionError)

	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower()
	if brand not in BRANDS or fmt not in FORMATS:
		frappe.throw(_("Unknown brand or format"))

	if isinstance(layout, str):
		try:
			layout = json.loads(layout)
		except Exception:
			layout = {}
	layout = layout if isinstance(layout, dict) else {}

	image_field = cstr(image_field or "").strip()
	if image_field in ("header_image", "footer_image", "lab_logo", "nabl_logo"):
		# Never silently "succeed" when the client asked to upload but sent no bytes —
		# that was the root cause of Template Management appearing not to save.
		if file_data in (None, ""):
			frappe.throw(
				_("Header/footer image upload was empty. Choose the file again and upload."),
				frappe.ValidationError,
			)
		url = _save_attach(
			file_name or f"{brand}-{image_field}.png",
			file_data,
			attached_to_doctype="Lab Report Branding",
			attached_to_name="Lab Report Branding",
			attached_to_field=image_field,
			max_bytes=8 * 1024 * 1024,
		)
		if not url:
			frappe.throw(_("Could not store the uploaded letterhead image"), frappe.ValidationError)
		layout[image_field] = url
		if image_field == "header_image":
			layout["header_enabled"] = 1
		elif image_field == "footer_image":
			layout["footer_enabled"] = 1

	normalized = _normalize_layout(brand, fmt, layout)
	store = load_store()
	overrides = load_overrides()
	branch = cstr(branch or "").strip()
	active = {"brand": brand, "format": fmt, "branch": branch}

	if cint(as_branch_override) and branch:
		slot = overrides.setdefault(branch, {}).setdefault(brand, {})
		slot[fmt] = normalized
		for other in FORMATS:
			if other == fmt:
				continue
			sibling = _deep_merge(store[brand].get(other) or {}, slot.get(other) or {})
			for key in _SHARED_BOX:
				if normalized.get(key) not in (None, ""):
					sibling[key] = normalized[key]
			if fmt == "with_header" and other == "without_header":
				sibling["header_image"] = normalized.get("header_image") or ""
				sibling["footer_image"] = normalized.get("footer_image") or ""
			slot[other] = _normalize_layout(brand, other, sibling)
		_write_store(
			store,
			overrides=overrides,
			active=active,
			branding_sync=_branding_sync_fields(brand, fmt, normalized),
		)
	else:
		store[brand][fmt] = normalized
		_copy_content_box(store, brand, fmt, normalized)
		# One atomic Single save: page layout JSON + banner URLs together.
		_write_store(
			store,
			active=active,
			branding_sync=_branding_sync_fields(brand, fmt, normalized),
		)

	return get_report_page_management(user, brand=brand, fmt=fmt, branch=branch)


def _branding_sync_fields(brand, fmt, normalized):
	"""Banner/identity fields to mirror onto Lab Report Branding in the same save."""
	if brand != "remedium" or not _is_letterhead_format(fmt):
		return {}
	updates = {}
	header = cstr((normalized or {}).get("header_image") or "").strip().split("?", 1)[0]
	footer = cstr((normalized or {}).get("footer_image") or "").strip().split("?", 1)[0]
	if header:
		if fmt == "non_nabl":
			updates["non_nabl_header_banner"] = header
		else:
			updates["nabl_header_banner"] = header
			cur_legacy = cstr(
				frappe.db.get_single_value("Lab Report Branding", "header_banner") or ""
			).strip()
			if not cur_legacy:
				updates["header_banner"] = header
	if footer:
		updates["footer_banner"] = footer
	lab_logo = cstr((normalized or {}).get("lab_logo") or "").strip().split("?", 1)[0]
	if lab_logo:
		updates["lab_logo"] = lab_logo
	nabl_logo = cstr((normalized or {}).get("nabl_logo") or "").strip().split("?", 1)[0]
	if nabl_logo and fmt != "non_nabl":
		updates["nabl_logo"] = nabl_logo
	for key in ("lab_name", "lab_address", "lab_phone", "lab_website"):
		val = cstr((normalized or {}).get(key) or "").strip()
		if val:
			updates[key] = val
	disclaimer = cstr((normalized or {}).get("disclaimer") or "").strip()
	if disclaimer:
		updates["report_footer"] = disclaimer
	return updates


def reset_report_page_layout(user=None, brand=None, fmt=None, branch=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can reset report page layouts"), frappe.PermissionError)
	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower()
	if brand not in BRANDS or fmt not in FORMATS:
		frappe.throw(_("Unknown brand or format"))
	store = load_store()
	overrides = load_overrides()
	branch = cstr(branch or "").strip()
	fresh = (
		_empty_with_header(brand)
		if fmt == "with_header"
		else _empty_without_header(brand)
	)
	if brand == "remedium":
		tmp = default_store()
		tmp = _seed_from_branding(tmp)
		fresh = tmp[brand][fmt]
	if branch:
		if branch in overrides and brand in (overrides.get(branch) or {}):
			(overrides.get(branch) or {}).pop(fmt, None)
			if not overrides.get(branch, {}).get(brand):
				(overrides.get(branch) or {}).pop(brand, None)
			if not overrides.get(branch):
				overrides.pop(branch, None)
		_write_store(store, overrides=overrides, active={"brand": brand, "format": fmt, "branch": branch})
	else:
		store[brand][fmt] = fresh
		_write_store(store, active={"brand": brand, "format": fmt, "branch": ""})
	return get_report_page_management(user, brand=brand, fmt=fmt, branch=branch)


def apply_report_page_layout_to_branches(user=None, brand=None, fmt=None, branches=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can apply layouts to branches"), frappe.PermissionError)
	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower()
	if brand not in BRANDS or fmt not in FORMATS:
		frappe.throw(_("Unknown brand or format"))
	if isinstance(branches, str):
		try:
			branches = json.loads(branches)
		except Exception:
			branches = [b.strip() for b in branches.split(",") if b.strip()]
	branches = [cstr(b).strip() for b in (branches or []) if cstr(b).strip()]
	if not branches:
		frappe.throw(_("Select at least one branch"))
	store = load_store()
	layout = copy.deepcopy(store[brand][fmt])
	overrides = load_overrides()
	for code in branches:
		overrides.setdefault(code, {}).setdefault(brand, {})[fmt] = copy.deepcopy(layout)
	_write_store(store, overrides=overrides, active={"brand": brand, "format": fmt, "branch": branches[0]})
	return get_report_page_management(user, brand=brand, fmt=fmt, branch=branches[0])


def pdf_options_from_layout(layout):
	"""wkhtmltopdf option dict + letterhead sources for html_to_lab_report_pdf."""
	layout = layout or {}
	fmt = cstr(layout.get("format") or "with_header")
	top = flt(layout.get("header_height_mm") or layout.get("margin_top_mm") or 36.9)
	bottom = flt(layout.get("footer_height_mm") or layout.get("margin_bottom_mm") or 24.4)
	left = flt(layout.get("margin_left_mm") or layout.get("side_mm") or 8)
	right = flt(layout.get("margin_right_mm") or left)
	if not _is_letterhead_format(fmt):
		# Same content box as letterhead templates. The bands stay blank for pre-printed paper.
		return {
			"chrome": "plain",
			"margin_top_mm": top,
			"margin_bottom_mm": bottom,
			"margin_left_mm": left,
			"margin_right_mm": right,
			"header_image": "",
			"footer_image": "",
			"header_height_mm": top,
			"footer_height_mm": bottom,
			"header_align": cstr(layout.get("header_align") or "center"),
			"footer_align": cstr(layout.get("footer_align") or "center"),
		}
	header_on = cint(layout.get("header_enabled", 1))
	footer_on = cint(layout.get("footer_enabled", 1))
	return {
		"chrome": "letterhead",
		"margin_top_mm": top,
		"margin_bottom_mm": bottom,
		"margin_left_mm": left,
		"margin_right_mm": right,
		"side_mm": left,
		"header_image": cstr(layout.get("header_image") or "") if header_on else "",
		"footer_image": cstr(layout.get("footer_image") or "") if footer_on else "",
		"header_height_mm": top,
		"footer_height_mm": bottom,
		"header_align": cstr(layout.get("header_align") or "center"),
		"footer_align": cstr(layout.get("footer_align") or "center"),
		"lab_logo": cstr(layout.get("lab_logo") or ""),
		"nabl_logo": cstr(layout.get("nabl_logo") or ""),
	}


def preview_report_page_pdf(user=None, brand=None, fmt=None, branch=None):
	"""Sample A4 PDF matching the on-screen live preview (inline letterhead, not header-html)."""
	_require_lab_settings(user)
	layout = get_effective_layout(brand, fmt, branch)
	from html import escape as esc_html

	from frappe.utils.pdf import get_pdf

	from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
		A4_HEIGHT_MM,
		A4_WIDTH_MM,
		_image_data_uri,
		_letterhead_natural_height_mm,
		_local_letterhead_path,
		html_to_lab_report_pdf,
	)

	name = cstr(layout.get("lab_name") or layout.get("brand_label") or "Lab")
	fmt = cstr(layout.get("format") or "with_header")
	body = f"""
<h1>Complete Blood Count (CBC)</h1>
<table class="meta">
<tr><td><b>Patient</b>: Sample Patient</td><td><b>Age / Sex</b>: 32 Y / M</td></tr>
<tr><td><b>Patient ID</b>: PREV-001</td><td><b>Ref. By</b>: Dr. Preview</td></tr>
<tr><td><b>Sample ID</b>: SMP-1001</td><td><b>Lab</b>: {esc_html(name)}</td></tr>
</table>
<table class="results"><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th></tr></thead>
<tbody>
<tr><td>Haemoglobin</td><td>13.8</td><td>g/dL</td><td>13.0 – 17.0</td></tr>
<tr><td>WBC Count</td><td>7.2</td><td>10^3/µL</td><td>4.0 – 11.0</td></tr>
<tr><td>Platelet Count</td><td>245</td><td>10^3/µL</td><td>150 – 450</td></tr>
</tbody></table>
<p class="foot">{esc_html(cstr(layout.get("disclaimer") or ""))}</p>
<div style="page-break-before:always">
<h1>Liver Function Test</h1>
<table class="meta">
<tr><td><b>Patient</b>: Sample Patient</td><td><b>Page</b>: 2</td></tr>
<tr><td><b>Patient ID</b>: PREV-001</td><td><b>Lab</b>: {esc_html(name)}</td></tr>
</table>
<table class="results"><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference</th></tr></thead>
<tbody>
<tr><td>Bilirubin Total</td><td>0.8</td><td>mg/dL</td><td>0.2 – 1.2</td></tr>
<tr><td>SGOT (AST)</td><td>28</td><td>U/L</td><td>5 – 40</td></tr>
<tr><td>SGPT (ALT)</td><td>31</td><td>U/L</td><td>5 – 41</td></tr>
<tr><td>Alkaline Phosphatase</td><td>92</td><td>U/L</td><td>40 – 129</td></tr>
</tbody></table>
<p class="foot">Page 2 uses the same content box as page 1.</p>
</div>
"""

	side = flt(layout.get("side_mm") or layout.get("margin_left_mm") or 8)
	html = f"""<!doctype html><html><head><meta charset="utf-8"/>
<style>
body {{ font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 0; }}
h1 {{ font-size: 14px; margin: 0 0 8px; color: #0f3d3a; }}
.meta {{ width: 100%; border-collapse: collapse; margin: 0 0 12px; border: 1px solid #d7e2e0; }}
.meta td {{ padding: 5px 8px; vertical-align: top; width: 50%; }}
table.results {{ width: 100%; border-collapse: collapse; }}
table.results th, table.results td {{ border-bottom: 1px solid #e5eeec; padding: 6px 4px; text-align: left; }}
table.results th {{ background: #f3f8f7; font-size: 10px; text-transform: uppercase; }}
.foot {{ margin-top: 16px; font-size: 9px; color: #64748b; }}
</style></head><body>{body}</body></html>"""
	# Same engine as authorized reports: header and footer are page chrome, so they
	# repeat on every A4 page at the editor's band size.
	pdf = html_to_lab_report_pdf(
		html,
		chrome_mode=f"{layout.get('brand') or 'remedium'}_{fmt}",
		page_layout=layout,
		brand=layout.get("brand"),
		branch=branch,
	)

	import base64

	return {
		"file_name": f"report-page-preview-{layout['brand']}-{layout['format']}.pdf",
		"content_base64": base64.b64encode(pdf).decode("ascii"),
		"layout": layout,
	}


def _load_templates_store():
	try:
		doc = _branding_doc()
		if not doc.meta.has_field(TEMPLATES_FIELD):
			return {}
		return _parse_json(doc.get(TEMPLATES_FIELD), {})
	except Exception:
		return {}


def _write_templates_store(store):
	doc = _branding_doc()
	if not doc.meta.has_field(TEMPLATES_FIELD):
		ensure_page_layout_storage()
		doc = _branding_doc()
	if doc.meta.has_field(TEMPLATES_FIELD):
		doc.set(TEMPLATES_FIELD, json.dumps(store, ensure_ascii=False))
		doc.flags.ignore_permissions = True
		doc.save(ignore_permissions=True)
		frappe.db.commit()


def list_editor_templates(brand=None, fmt=None):
	store = _load_templates_store()
	out = []
	for key, tpl in (store or {}).items():
		if not isinstance(tpl, dict):
			continue
		b = cstr(tpl.get("brand") or "")
		f = cstr(tpl.get("format") or "")
		if brand and b != brand:
			continue
		if fmt and f != fmt:
			continue
		out.append(
			{
				"id": key,
				"name": cstr(tpl.get("name") or key),
				"brand": b,
				"format": f,
				"updated": cstr(tpl.get("updated") or ""),
				"is_default": cint(tpl.get("is_default")),
			}
		)
	out.sort(key=lambda r: (0 if r.get("is_default") else 1, r.get("name") or ""))
	return out


def get_active_editor_template(brand, fmt):
	store = _load_templates_store()
	key = f"{brand}__{fmt}__active"
	tpl = store.get(key)
	if isinstance(tpl, dict):
		return {
			"id": key,
			"name": cstr(tpl.get("name") or "Active design"),
			"brand": brand,
			"format": fmt,
			"canvas_json": tpl.get("canvas_json") or {},
			"meta": tpl.get("meta") or {},
			"updated": cstr(tpl.get("updated") or ""),
		}
	# Fall back to any default for brand/format
	for k, tpl in (store or {}).items():
		if (
			isinstance(tpl, dict)
			and cstr(tpl.get("brand")) == brand
			and cstr(tpl.get("format")) == fmt
			and cint(tpl.get("is_default"))
		):
			return {
				"id": k,
				"name": cstr(tpl.get("name") or k),
				"brand": brand,
				"format": fmt,
				"canvas_json": tpl.get("canvas_json") or {},
				"meta": tpl.get("meta") or {},
				"updated": cstr(tpl.get("updated") or ""),
			}
	return None


def save_report_page_editor_template(
	user=None,
	brand=None,
	fmt=None,
	name=None,
	canvas_json=None,
	meta=None,
	header_image=None,
	footer_image=None,
	set_active=1,
	template_id=None,
):
	"""Persist Fabric.js canvas JSON and optionally export header/footer PNGs for PDF."""
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can save report page designs"), frappe.PermissionError)

	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower()
	if brand not in BRANDS or fmt not in FORMATS:
		frappe.throw(_("Unknown brand or format"))

	if isinstance(canvas_json, str):
		try:
			canvas_json = json.loads(canvas_json)
		except Exception:
			canvas_json = {}
	if isinstance(meta, str):
		try:
			meta = json.loads(meta)
		except Exception:
			meta = {}
	meta = meta if isinstance(meta, dict) else {}

	# Optional exported band images from the editor (data URLs)
	layout_patch = {}
	for field, payload in (("header_image", header_image), ("footer_image", footer_image)):
		if not payload:
			continue
		if isinstance(payload, str) and payload.startswith("data:"):
			url = _save_attach(
				f"{brand}-{fmt}-{field}.png",
				payload,
				attached_to_doctype="Lab Report Branding",
				attached_to_name="Lab Report Branding",
				attached_to_field=field,
				max_bytes=8 * 1024 * 1024,
			)
			layout_patch[field] = url
		elif isinstance(payload, str) and (
			payload.startswith("/") or payload.startswith("http://") or payload.startswith("https://")
		):
			# Keep the uploaded or stock file. Do not redraw it.
			layout_patch[field] = payload.split("?", 1)[0]
		elif isinstance(payload, dict) and payload.get("file_data"):
			url = _save_attach(
				cstr(payload.get("file_name") or f"{brand}-{field}.png"),
				payload.get("file_data"),
				attached_to_doctype="Lab Report Branding",
				attached_to_name="Lab Report Branding",
				attached_to_field=field,
			)
			layout_patch[field] = url

	# Merge geometry from editor meta into layout store
	for key in (
		"header_height_mm",
		"footer_height_mm",
		"side_mm",
		"margin_top_mm",
		"margin_bottom_mm",
		"margin_left_mm",
		"margin_right_mm",
		"header_enabled",
		"footer_enabled",
		"include_nabl_logo",
		"include_barcode",
		"show_address",
		"include_disclaimer",
		"lab_name",
		"lab_address",
		"lab_phone",
		"disclaimer",
	):
		if key in meta:
			layout_patch[key] = meta.get(key)

	# A new upload must stay. Only an explicit delete clears the band.
	if header_image:
		layout_patch["header_enabled"] = 1
	elif cint(meta.get("header_enabled")) == 0:
		layout_patch["header_image"] = ""
		layout_patch["header_enabled"] = 0
	if footer_image:
		layout_patch["footer_enabled"] = 1
	elif cint(meta.get("footer_enabled")) == 0:
		layout_patch["footer_image"] = ""
		layout_patch["footer_enabled"] = 0

	branch = cstr(meta.get("branch") or "").strip()
	if layout_patch:
		merged = _deep_merge(get_effective_layout(brand, fmt, branch or None), layout_patch)
		if branch:
			save_report_page_layout(
				user=user,
				brand=brand,
				fmt=fmt,
				layout=merged,
				branch=branch,
				as_branch_override=1,
			)
		else:
			save_report_page_layout(
				user=user,
				brand=brand,
				fmt=fmt,
				layout=merged,
			)

	store = _load_templates_store()
	tid = cstr(template_id or "").strip() or f"{brand}__{fmt}__active"
	store[tid] = {
		"name": cstr(name or f"{BRAND_LABELS.get(brand, brand)} · {FORMAT_LABELS.get(fmt, fmt)}"),
		"brand": brand,
		"format": fmt,
		"canvas_json": canvas_json or {},
		"meta": meta,
		"updated": frappe.utils.now_datetime().isoformat(),
		"is_default": 1 if cint(set_active) else cint((store.get(tid) or {}).get("is_default")),
	}
	if cint(set_active):
		# Mark others for same brand/format as non-default
		for k, tpl in list(store.items()):
			if k == tid or not isinstance(tpl, dict):
				continue
			if cstr(tpl.get("brand")) == brand and cstr(tpl.get("format")) == fmt:
				tpl["is_default"] = 0
		store[tid]["is_default"] = 1
		# Also keep canonical active key
		active_key = f"{brand}__{fmt}__active"
		if tid != active_key:
			store[active_key] = copy.deepcopy(store[tid])
			store[active_key]["name"] = store[tid]["name"]
			store[active_key]["is_default"] = 1

	_write_templates_store(store)
	return get_report_page_management(user, brand=brand, fmt=fmt, branch=branch)


def get_report_page_editor_template(user=None, brand=None, fmt=None, template_id=None, branch=None):
	_require_lab_settings(user)
	brand = cstr(brand or "remedium").lower()
	fmt = cstr(fmt or "with_header").lower()
	branch = cstr(branch or "").strip()
	store = _load_templates_store()
	tid = cstr(template_id or "").strip()
	if tid and isinstance(store.get(tid), dict):
		tpl = store[tid]
		return {
			"id": tid,
			"name": cstr(tpl.get("name") or tid),
			"brand": cstr(tpl.get("brand") or brand),
			"format": cstr(tpl.get("format") or fmt),
			"canvas_json": tpl.get("canvas_json") or {},
			"meta": tpl.get("meta") or {},
			"updated": cstr(tpl.get("updated") or ""),
			"layout": get_effective_layout(brand, fmt, branch or None),
			"branch": branch,
			"branches": list_branches(),
			"templates": list_editor_templates(brand=brand, fmt=fmt),
		}
	active = get_active_editor_template(brand, fmt) or {
		"id": f"{brand}__{fmt}__active",
		"name": f"{BRAND_LABELS.get(brand, brand)} design",
		"brand": brand,
		"format": fmt,
		"canvas_json": {},
		"meta": {},
		"updated": "",
	}
	active["layout"] = get_effective_layout(brand, fmt, branch or None)
	active["branch"] = branch
	active["branches"] = list_branches()
	active["templates"] = list_editor_templates(brand=brand, fmt=fmt)
	return active


def delete_report_page_editor_template(user=None, template_id=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can delete designs"), frappe.PermissionError)
	tid = cstr(template_id or "").strip()
	if not tid or tid.endswith("__active"):
		frappe.throw(_("Cannot delete the active design slot"))
	store = _load_templates_store()
	if tid in store:
		store.pop(tid, None)
		_write_templates_store(store)
	return {"ok": 1, "templates": list_editor_templates()}
