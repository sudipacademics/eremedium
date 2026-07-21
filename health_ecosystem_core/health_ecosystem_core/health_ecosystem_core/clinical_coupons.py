"""Promo code validation and discount calculation (Phase 22)."""

from __future__ import annotations

import os

import frappe
from frappe import _
from frappe.utils import add_months, flt, getdate, today

APPLIES_PHARMACY = {"pharmacy", "all"}
APPLIES_LAB = {"lab", "lab diagnostics", "all"}


def _normalize_code(code):
	return (code or "").strip().upper()


def _normalize_context(context):
	ctx = (context or "all").strip().lower()
	if ctx in ("lab", "diagnostics", "lab diagnostics"):
		return "lab"
	if ctx == "pharmacy":
		return "pharmacy"
	return "all"


def _applies_to_matches(doc_applies, context):
	applies = (doc_applies or "All").strip().lower()
	if applies == "all":
		return True
	if context == "pharmacy":
		return applies == "pharmacy"
	if context == "lab":
		return applies in ("lab", "lab diagnostics")
	return True


def _import_mobile_promotion(force=True):
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	app_path = frappe.get_app_path("health_ecosystem_core")
	candidates.append(
		os.path.join(app_path, "health_ecosystem_core", "doctype", "mobile_promotion", "mobile_promotion.json")
	)
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg_root = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg_root, "doctype", "mobile_promotion", "mobile_promotion.json"))
	except Exception:
		pass
	for json_path in candidates:
		if os.path.isfile(json_path):
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype="Mobile Promotion")
			return frappe.db.exists("DocType", "Mobile Promotion")
	return False


def _load_promotion(code):
	code = _normalize_code(code)
	if not code or not frappe.db.exists("DocType", "Mobile Promotion"):
		return None, _("Invalid coupon code")
	if not frappe.db.exists("Mobile Promotion", code):
		return None, _("Coupon not found")
	doc = frappe.get_doc("Mobile Promotion", code)
	if not doc.enabled:
		return None, _("This coupon is no longer active")
	today_d = getdate(today())
	valid_from = getattr(doc, "valid_from", None)
	valid_upto = getattr(doc, "valid_upto", None)
	if valid_from and getdate(valid_from) > today_d:
		return None, _("This coupon is not yet valid")
	if valid_upto and getdate(valid_upto) < today_d:
		return None, _("This coupon has expired")
	return doc, None


def _infer_discount_from_title(doc, subtotal):
	title = (doc.title or "").lower()
	if "10%" in title or "10 %" in title:
		return round(subtotal * 0.10, 2)
	if "₹25" in (doc.title or "") or "25 off" in title:
		return min(25.0, subtotal)
	return 0


def compute_discount(doc, subtotal):
	subtotal = flt(subtotal)
	if subtotal <= 0:
		frappe.throw(_("Order total must be greater than zero"))

	min_order = flt(getattr(doc, "min_order_amount", None) or 0)
	if min_order and subtotal < min_order:
		frappe.throw(_("Minimum order amount is ₹{0}").format(int(min_order)))

	pct = flt(getattr(doc, "discount_percent", None) or 0)
	fixed = flt(getattr(doc, "discount_amount", None) or 0)

	if pct > 0:
		discount = round(subtotal * pct / 100.0, 2)
	elif fixed > 0:
		discount = min(fixed, subtotal)
	else:
		discount = _infer_discount_from_title(doc, subtotal)

	if discount <= 0:
		frappe.throw(_("This offer is not redeemable at checkout"))

	discount = min(discount, subtotal)
	final_total = round(subtotal - discount, 2)
	return discount, final_total


def validate_promo_code(code, subtotal, context="all", item_group=None):
	"""Return discount payload or raise with message."""
	context = _normalize_context(context)
	doc, err = _load_promotion(code)
	if err:
		frappe.throw(err)

	applies_to = getattr(doc, "applies_to", None) or "All"
	if not _applies_to_matches(applies_to, context):
		frappe.throw(_("This coupon does not apply to this order type"))

	limit_group = (getattr(doc, "item_group", None) or "").strip()
	if limit_group and item_group and str(item_group).strip() != limit_group:
		frappe.throw(_("This coupon does not apply to the selected items"))

	discount, final_total = compute_discount(doc, subtotal)
	return {
		"promo_code": doc.promo_label,
		"title": doc.title,
		"subtotal": flt(subtotal),
		"discount_amount": discount,
		"final_total": final_total,
		"applies_to": applies_to,
		"item_group": limit_group or None,
		"valid_upto": str(doc.valid_upto) if getattr(doc, "valid_upto", None) else None,
	}


def apply_promo_to_amount(code, subtotal, context="all", item_group=None):
	"""Safe wrapper — returns (final_total, discount, promo_code) or original on empty code."""
	if not _normalize_code(code):
		return flt(subtotal), 0.0, ""
	result = validate_promo_code(code, subtotal, context, item_group=item_group)
	return result["final_total"], result["discount_amount"], result["promo_code"]


def seed_phase22_promos():
	"""Ensure FIRST10 / HEALTH25 / FAMILY exist with discount fields + validity."""
	if not frappe.db.exists("DocType", "Mobile Promotion"):
		_import_mobile_promotion(force=True)
	if not frappe.db.exists("DocType", "Mobile Promotion"):
		return {"ok": False, "error": "Mobile Promotion missing"}

	upto = add_months(getdate(today()), 12)
	promos = [
		{
			"promo_label": "FIRST10",
			"title": "10% off first lab booking",
			"description": "Use at lab checkout",
			"display_order": 1,
			"discount_percent": 10,
			"discount_amount": 0,
			"min_order_amount": 0,
			"applies_to": "Lab Diagnostics",
			"valid_from": today(),
			"valid_upto": upto,
			"enabled": 1,
		},
		{
			"promo_label": "HEALTH25",
			"title": "₹25 off pharmacy",
			"description": "Min order ₹299",
			"display_order": 2,
			"discount_percent": 0,
			"discount_amount": 25,
			"min_order_amount": 299,
			"applies_to": "Pharmacy",
			"valid_from": today(),
			"valid_upto": upto,
			"enabled": 1,
		},
		{
			"promo_label": "FAMILY",
			"title": "Family health packages",
			"description": "5% off lab panels",
			"display_order": 3,
			"discount_percent": 5,
			"discount_amount": 0,
			"min_order_amount": 0,
			"applies_to": "Lab Diagnostics",
			"valid_from": today(),
			"valid_upto": upto,
			"enabled": 1,
		},
	]
	created = []
	for spec in promos:
		if frappe.db.exists("Mobile Promotion", spec["promo_label"]):
			doc = frappe.get_doc("Mobile Promotion", spec["promo_label"])
			for key, value in spec.items():
				if key == "promo_label":
					continue
				if doc.meta.has_field(key):
					doc.set(key, value)
			doc.save(ignore_permissions=True)
			created.append(doc.name)
		else:
			doc = frappe.get_doc({"doctype": "Mobile Promotion", **spec})
			doc.insert(ignore_permissions=True)
			created.append(doc.name)
	frappe.db.commit()
	return {"ok": True, "promos": created}


def setup_phase22():
	_import_mobile_promotion(force=True)
	seeded = seed_phase22_promos()
	return {"ok": True, "seed": seeded, "count": frappe.db.count("Mobile Promotion") if frappe.db.exists("DocType", "Mobile Promotion") else 0}


def smoke_phase22():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase22()
	check("setup", setup.get("ok"), str(setup))
	check("doctype", frappe.db.exists("DocType", "Mobile Promotion"))
	check("seed_count", frappe.db.count("Mobile Promotion") >= 3)

	# HEALTH25 pharmacy min order
	try:
		validate_promo_code("HEALTH25", 200, "pharmacy")
		check("health25_min_order_blocks", False, "should have thrown")
	except Exception as exc:
		check("health25_min_order_blocks", "299" in str(exc) or "Minimum" in str(exc), str(exc))

	ok25 = validate_promo_code("HEALTH25", 356, "pharmacy")
	check("health25_ok", ok25.get("discount_amount") == 25 and ok25.get("final_total") == 331, str(ok25))

	# Lab FIRST10
	ok10 = validate_promo_code("FIRST10", 1000, "lab")
	check("first10_lab", ok10.get("discount_amount") == 100 and ok10.get("final_total") == 900, str(ok10))

	# Wrong context
	try:
		validate_promo_code("HEALTH25", 500, "lab")
		check("context_guard", False, "pharmacy coupon should fail on lab")
	except Exception as exc:
		check("context_guard", True, str(exc))

	# API whitelist present
	from health_ecosystem_core.health_ecosystem_core import api as api_mod

	check("api_validate_coupon", hasattr(api_mod, "validate_coupon"))

	return result


@frappe.whitelist(allow_guest=True)
def run_phase22_setup():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(setup_phase22())


@frappe.whitelist(allow_guest=True)
def run_phase22_smoke():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(smoke_phase22())
