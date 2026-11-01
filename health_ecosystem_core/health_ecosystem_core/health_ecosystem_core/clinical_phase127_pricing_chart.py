"""Phase 127 — Master partner pricing chart.

One row per diagnostic test, seven columns: the FOCO / Master FOCO / Orange FOCO billing rate and platform fee
(Partner Tier Rate) plus the MRP (company MRP price list). Admins edit it in the SPA, export it to Excel / PDF and
import it back from Excel. Partner catalogues on the circuit (FOCO, Master FOCO, Orange FOCO, mapped Vectors) are
built from this chart only.
"""

from __future__ import annotations

import base64
import csv
import io
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
	ADMIN_ROLES,
	RATE_DT,
	TIER_FOCO,
	TIER_MF,
	TIER_ORANGE,
	TIERS,
	clear_tier_caches,
	ensure_partner_tier_setup,
)

# Column key -> (tier, field). Order is the chart's left-to-right order.
TIER_COLUMNS = (
	("foco_billing", TIER_FOCO, "billing_rate", "FOCO Billing Rate"),
	("foco_fee", TIER_FOCO, "platform_fee", "FOCO Platform Fee"),
	("mf_billing", TIER_MF, "billing_rate", "Master FOCO Billing Rate"),
	("mf_fee", TIER_MF, "platform_fee", "Master FOCO Platform Fee"),
	("orange_billing", TIER_ORANGE, "billing_rate", "Orange FOCO Billing Rate"),
	("orange_fee", TIER_ORANGE, "platform_fee", "Orange FOCO Platform Fee"),
)
TIER_KEYS = tuple(c[0] for c in TIER_COLUMNS)
HEADERS = ["Item Code", "Test Name", "Category"] + [c[3] for c in TIER_COLUMNS] + ["MRP"]


def _require_admin(roles):
	if not set(roles or []) & ADMIN_ROLES:
		frappe.throw(_("Only system admins can manage the partner pricing chart"), frappe.PermissionError)


def _mrp_price_list():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
		company_mrp_price_list,
	)

	return company_mrp_price_list()


PENDING_GROUP = "Lab Tests - Pricing Pending"
CHARGES_GROUP = "Lab Charges"
LIVE_TEST_GROUP = "Lab Tests"


def _lab_items():
	"""Chart rows: published lab tests plus new tests awaiting an MRP and lab charge items."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _lab_items as lab_items

	rows = list(lab_items())
	seen = {r.name for r in rows}
	extra_groups = [g for g in (PENDING_GROUP, CHARGES_GROUP) if frappe.db.exists("Item Group", g)]
	if extra_groups:
		for r in frappe.get_all(
			"Item",
			filters={"disabled": 0, "item_group": ("in", extra_groups)},
			fields=["name", "item_name", "item_group", "standard_rate"],
			order_by="item_name asc",
			limit_page_length=0,
		):
			if r.name not in seen:
				rows.append(r)
				seen.add(r.name)
	return rows


def _rates_by_item():
	out: dict[str, dict[str, dict[str, Any]]] = {}
	for r in frappe.get_all(
		RATE_DT,
		fields=["name", "item_code", "tier", "billing_rate", "platform_fee", "active"],
		limit_page_length=0,
	):
		out.setdefault(r.item_code, {})[r.tier] = r
	return out


def _mrp_by_item(price_list):
	rows = frappe.get_all(
		"Item Price",
		filters={"price_list": price_list, "selling": 1},
		fields=["item_code", "price_list_rate", "customer"],
		limit_page_length=0,
	)
	out: dict[str, float] = {}
	for r in rows:
		if r.customer:
			continue
		out[r.item_code] = flt(r.price_list_rate)
	return out


def _row(item, rates, mrp):
	row = {
		"item_code": item.name,
		"item_name": item.item_name or item.name,
		"category": item.item_group or "",
		"mrp": mrp if mrp else (flt(item.standard_rate) or None),
	}
	for key, tier, field, _label in TIER_COLUMNS:
		r = rates.get(tier)
		value = flt(r.get(field)) if r and cint(r.get("active")) else None
		if field == "platform_fee" and not value:
			value = None  # a fee of 0 means "not set yet" (partial row)
		row[key] = value
	filled = [k for k in TIER_KEYS if row[k] is not None]
	row["on_circuit"] = len(filled) == len(TIER_KEYS) and all(row[k] > 0 for k in TIER_KEYS)
	row["status"] = "On" if row["on_circuit"] else ("Incomplete" if filled else "Off")
	return row


def pricing_chart(roles, configured_only=0, q=None):
	_require_admin(roles)
	ensure_partner_tier_setup()
	price_list = _mrp_price_list()
	rates = _rates_by_item()
	mrps = _mrp_by_item(price_list)
	needle = cstr(q or "").strip().lower()
	rows = []
	for item in _lab_items():
		row = _row(item, rates.get(item.name) or {}, mrps.get(item.name))
		if cint(configured_only) and not row["on_circuit"]:
			continue
		if needle and needle not in f"{row['item_code']} {row['item_name']} {row['category']}".lower():
			continue
		rows.append(row)
	order = {"On": 0, "Incomplete": 1, "Off": 2}
	rows.sort(key=lambda r: (order.get(r["status"], 3), r["item_name"].lower()))
	return {
		"rows": rows,
		"columns": [{"key": c[0], "tier": c[1], "field": c[2], "label": c[3]} for c in TIER_COLUMNS]
		+ [{"key": "mrp", "tier": None, "field": "mrp", "label": "MRP"}],
		"mrp_price_list": price_list,
		"on_circuit": sum(1 for r in rows if r["on_circuit"]),
		"incomplete": sum(1 for r in rows if r["status"] == "Incomplete"),
		"total": len(rows),
	}


# ---------------------------------------------------------------------------
# Save (inline edits and imports share one validator / writer)
# ---------------------------------------------------------------------------


def _num(value):
	if value is None:
		return None
	text = cstr(value).replace(",", "").replace("₹", "").strip()
	if text == "":
		return None
	try:
		return round(float(text), 2)
	except ValueError:
		raise frappe.ValidationError(_("'{0}' is not a number").format(value))


def _validate_row(raw, known_items):
	code = cstr(raw.get("item_code")).strip()
	if not code:
		raise frappe.ValidationError(_("Item Code is required"))
	if code not in known_items:
		raise frappe.ValidationError(_("Unknown test item {0}").format(code))
	values = {k: _num(raw.get(k)) for k in TIER_KEYS}
	mrp = _num(raw.get("mrp"))
	filled = [k for k in TIER_KEYS if values[k] is not None]
	for key in TIER_KEYS:
		if values[key] is not None and values[key] < 0:
			raise frappe.ValidationError(_("Rates cannot be negative"))
	for bill_key, fee_key, label in (
		("foco_billing", "foco_fee", "FOCO"),
		("mf_billing", "mf_fee", "Master FOCO"),
		("orange_billing", "orange_fee", "Orange FOCO"),
	):
		# Partial rows are allowed (the test stays off the circuit until all six values are set).
		if values[fee_key] is not None and values[bill_key] is None:
			raise frappe.ValidationError(_("{0}: enter the billing rate before its platform fee").format(label))
		if values[fee_key] is not None and values[fee_key] > values[bill_key]:
			raise frappe.ValidationError(_("{0} platform fee cannot exceed its billing rate").format(label))
	if mrp is not None and mrp < 0:
		raise frappe.ValidationError(_("MRP cannot be negative"))
	return code, values, mrp, bool(filled)


def _write_row(code, values, mrp, _any_value, existing, price_list):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _upsert_item_price

	changed = False
	for tier in TIERS:
		bill_key, fee_key = [c[0] for c in TIER_COLUMNS if c[1] == tier]
		current = existing.get(tier)
		if values[bill_key] is not None:
			want = {"billing_rate": values[bill_key], "platform_fee": values[fee_key] or 0, "active": 1}
			if current:
				if (
					flt(current.billing_rate) != want["billing_rate"]
					or flt(current.platform_fee) != want["platform_fee"]
					or not cint(current.active)
				):
					frappe.db.set_value(RATE_DT, current.name, want)
					changed = True
			else:
				frappe.get_doc({"doctype": RATE_DT, "item_code": code, "tier": tier, **want}).insert(ignore_permissions=True)
				changed = True
		elif current and cint(current.active):
			frappe.db.set_value(RATE_DT, current.name, "active", 0)
			changed = True
	if mrp is not None and mrp > 0:
		before = flt(frappe.db.get_value("Item Price", {"item_code": code, "price_list": price_list}, "price_list_rate"))
		if before != mrp:
			_upsert_item_price(code, price_list, mrp)
			changed = True
		changed = _publish_priced_test(code) or changed
	return changed


def _publish_priced_test(code):
	"""A new test waiting for pricing moves to Lab Tests (public + partner catalogues) once it has an MRP."""
	if frappe.db.get_value("Item", code, "item_group") != PENDING_GROUP or not frappe.db.exists("Item Group", LIVE_TEST_GROUP):
		return False
	frappe.db.set_value("Item", code, "item_group", LIVE_TEST_GROUP)
	return True


def apply_pricing_rows(roles, rows, dry_run=0):
	"""Validate and (unless dry_run) write chart rows. Returns per-row outcome with sheet row numbers."""
	_require_admin(roles)
	ensure_partner_tier_setup()
	known = {i.name for i in _lab_items()}
	existing = _rates_by_item()
	price_list = _mrp_price_list()
	report = {"updated": 0, "unchanged": 0, "errors": [], "rows": len(rows or []), "dry_run": bool(cint(dry_run))}
	seen = set()
	for idx, raw in enumerate(rows or [], start=1):
		line = cint(raw.get("_row")) or idx
		try:
			code, values, mrp, on_circuit = _validate_row(raw, known)
			if code in seen:
				raise frappe.ValidationError(_("Duplicate row for {0}").format(code))
			seen.add(code)
			if cint(dry_run):
				report["updated"] += 1
				continue
			if _write_row(code, values, mrp, on_circuit, existing.get(code) or {}, price_list):
				report["updated"] += 1
			else:
				report["unchanged"] += 1
		except frappe.ValidationError as exc:
			report["errors"].append({"row": line, "item_code": cstr(raw.get("item_code")), "error": cstr(exc)})
	if not cint(dry_run):
		frappe.db.commit()
		clear_tier_caches()
	report["ok"] = not report["errors"]
	return report


# ---------------------------------------------------------------------------
# Export / import
# ---------------------------------------------------------------------------


def _sheet_rows(chart):
	data = [HEADERS]
	for r in chart["rows"]:
		data.append(
			[r["item_code"], r["item_name"], r["category"]]
			+ [r[k] if r[k] is not None else "" for k in TIER_KEYS]
			+ [r["mrp"] if r["mrp"] is not None else ""]
		)
	return data


def export_pricing(roles, fmt="xlsx", configured_only=0):
	chart = pricing_chart(roles, configured_only=configured_only)
	stamp = now_datetime().strftime("%Y%m%d-%H%M")
	if cstr(fmt).lower() == "pdf":
		content = _pricing_pdf(chart)
		return {
			"filename": f"partner-pricing-chart-{stamp}.pdf",
			"mimetype": "application/pdf",
			"content_base64": base64.b64encode(content).decode(),
		}
	from frappe.utils.xlsxutils import make_xlsx

	xlsx = make_xlsx(_sheet_rows(chart), "Partner Pricing", column_widths=[28, 40, 18] + [16] * 7)
	return {
		"filename": f"partner-pricing-chart-{stamp}.xlsx",
		"mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"content_base64": base64.b64encode(xlsx.getvalue()).decode(),
	}


def _pricing_pdf(chart):
	from frappe.utils.pdf import get_pdf

	def money(v):
		return "" if v is None else f"{flt(v):,.2f}"

	body = []
	for r in chart["rows"]:
		cells = "".join(f"<td class='n'>{money(r[k])}</td>" for k in TIER_KEYS)
		body.append(
			f"<tr><td>{frappe.utils.escape_html(r['item_name'])}<div class='c'>{frappe.utils.escape_html(r['item_code'])}</div></td>"
			f"<td>{frappe.utils.escape_html(r['category'])}</td>{cells}<td class='n'>{money(r['mrp'])}</td></tr>"
		)
	head = "".join(f"<th>{frappe.utils.escape_html(c[3])}</th>" for c in TIER_COLUMNS)
	html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#0f172a}}
h1{{font-size:15px;margin:0 0 4px}} p{{margin:0 0 10px;color:#475569}}
table{{width:100%;border-collapse:collapse}} th,td{{border:1px solid #cbd5e1;padding:4px 5px;vertical-align:top}}
th{{background:#0f5c5a;color:#fff;font-size:8.5px;text-align:center}} td.n{{text-align:right;white-space:nowrap}}
.c{{color:#64748b;font-size:7.5px}} tr:nth-child(even) td{{background:#f8fafc}}
</style></head><body>
<h1>Partner Pricing Chart</h1>
<p>Remedium · {chart['on_circuit']} of {chart['total']} tests on the partner circuit · generated {now_datetime().strftime('%d %b %Y %H:%M')}</p>
<table><thead><tr><th>Test</th><th>Category</th>{head}<th>MRP</th></tr></thead><tbody>{''.join(body)}</tbody></table>
</body></html>"""
	return get_pdf(html, {"orientation": "Landscape", "page-size": "A4"})


def _header_key(text):
	t = cstr(text).strip().lower().replace("₹", "").replace("(", " ").replace(")", " ")
	t = " ".join(t.split())
	if t in ("item code", "item", "code", "test code"):
		return "item_code"
	if t in ("test name", "item name", "test", "name"):
		return "item_name"
	if t == "category":
		return "category"
	if t == "mrp":
		return "mrp"
	for key, _tier, _field, label in TIER_COLUMNS:
		if t == label.lower():
			return key
	return None


def _parse_upload(filename, content_base64):
	raw = base64.b64decode(cstr(content_base64).split(",")[-1])
	name = cstr(filename).lower()
	if name.endswith(".csv"):
		text = raw.decode("utf-8-sig", errors="replace")
		return [list(r) for r in csv.reader(io.StringIO(text))]
	if name.endswith(".xlsx"):
		from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file

		return read_xlsx_file_from_attached_file(fcontent=raw)
	frappe.throw(_("Upload an .xlsx or .csv file (export the chart first to get the template)"))


def import_pricing(roles, filename, content_base64, dry_run=1):
	"""Import the chart from an Excel / CSV file in the export layout. dry_run=1 validates only."""
	_require_admin(roles)
	sheet = [r for r in (_parse_upload(filename, content_base64) or []) if any(cstr(c).strip() for c in (r or []))]
	if not sheet:
		frappe.throw(_("The file is empty"))
	keys = [_header_key(h) for h in sheet[0]]
	if "item_code" not in keys:
		frappe.throw(_("Header row must include 'Item Code' (use the exported chart as the template)"))
	missing = [c[3] for c in TIER_COLUMNS if c[0] not in keys]
	if missing:
		frappe.throw(_("Missing columns: {0}").format(", ".join(missing)))
	rows = []
	for line, values in enumerate(sheet[1:], start=2):
		row = {"_row": line}
		for key, value in zip(keys, values):
			if key:
				row[key] = value
		rows.append(row)
	return apply_pricing_rows(roles, rows, dry_run=dry_run)


def smoke_pricing_chart():
	"""Read-only checks: chart, Excel / PDF export, Excel round-trip import (dry run), validation."""
	roles = ["System Manager"]
	out = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:200]})
		if not cond:
			out["ok"] = False

	chart = pricing_chart(roles)
	check("chart has rows", chart["total"] > 0, chart["total"])
	fbg = next((r for r in chart["rows"] if r["item_code"] == "LAB-GLUCOSE-FASTING-FBS-2"), None)
	check("FBG on circuit", bool(fbg and fbg["on_circuit"]), fbg)
	if fbg:
		check(
			"FBG values",
			[fbg[k] for k in TIER_KEYS] == [28.0, 19.6, 14.0, 11.2, 10.0, 6.0],
			[fbg[k] for k in TIER_KEYS],
		)
		check("FBG MRP", flt(fbg["mrp"]) == 70.0, fbg["mrp"])
	xlsx = export_pricing(roles, "xlsx")
	check("Excel export", xlsx["filename"].endswith(".xlsx") and len(xlsx["content_base64"]) > 100)
	pdf = export_pricing(roles, "pdf", configured_only=1)
	check("PDF export", base64.b64decode(pdf["content_base64"])[:4] == b"%PDF")
	rep = import_pricing(roles, xlsx["filename"], xlsx["content_base64"], dry_run=1)
	check("Excel round-trip import (dry run) has no errors", rep["ok"] and rep["rows"] == chart["total"], rep["errors"][:3])
	bad = apply_pricing_rows(
		roles,
		[
			{"item_code": "LAB-GLUCOSE-FASTING-FBS-2", "foco_fee": 5},
			{"item_code": "LAB-GLUCOSE-FASTING-FBS-2", **{k: 1 for k in TIER_KEYS}, "foco_fee": 5},
			{"item_code": "NO-SUCH-TEST", **{k: 1 for k in TIER_KEYS}},
		],
		dry_run=1,
	)
	check("fee-without-billing / fee>billing / unknown rows rejected", len(bad["errors"]) == 3, bad["errors"])
	partial = apply_pricing_rows(roles, [{"item_code": "LAB-GLUCOSE-FASTING-FBS-2", "orange_billing": 10}], dry_run=1)
	check("partial (Orange billing only) row accepted", partial["ok"], partial["errors"])
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import tier_row_complete

	check(
		"partial tier rows never count as on circuit",
		not tier_row_complete({"Orange FOCO": {"billing_rate": 10, "platform_fee": 0}}),
	)
	items = circuit_catalog_items_for_tier_check()
	check("circuit catalogue includes FBG", "LAB-GLUCOSE-FASTING-FBS-2" in items, len(items))
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def circuit_catalog_items_for_tier_check():
	"""Tests fully priced in the chart (all three tiers with billing and fee)."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import _all_tier_rates

	return set(_all_tier_rates().keys())


# ---------------------------------------------------------------------------
# Partner catalogues are built from the chart only
# ---------------------------------------------------------------------------


def circuit_catalog_items(franchisee_id):
	"""Item codes a circuit partner (or mapped Vector) may see: tests fully priced in the chart. None = not on circuit."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
		_cached_circuit,
		vector_entry,
	)

	if not franchisee_id:
		return None
	on_circuit = _cached_circuit(franchisee_id).get("tier") in TIERS or bool(vector_entry(franchisee_id))
	if not on_circuit:
		return None
	return circuit_catalog_items_for_tier_check()
