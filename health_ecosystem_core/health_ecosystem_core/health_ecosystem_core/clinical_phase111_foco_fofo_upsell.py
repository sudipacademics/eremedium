"""Phase 111 — FOFO → FOCO mapping and override upsell commission.

PDF: map each FOFO under one FOCO at onboarding. For every eligible FOFO bill:
  Net Amount = MRP − FOFO Margin
  FOCO Earning = Override Upsell Commission % of Net Amount
The % is stored on Franchisee Profile as Override Upsell Commission (default 20),
read from the parent FOCO. Earnings stay Pending, then credit the FOCO wallet
after 7 days. Duplicate TRFs are never accrued twice.
"""

from __future__ import annotations

import json
import os
from typing import Any

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, getdate, now_datetime, today

DEFAULT_OVERRIDE_UPSELL = 20.0
SETTLEMENT_DAYS = 7
LEDGER_DOCTYPE = "FOFO FOCO Commission"


def _model_blob(profile) -> str:
	if isinstance(profile, str):
		row = frappe.db.get_value(
			"Franchisee Profile",
			profile,
			["category", "ownership"],
			as_dict=True,
		) or {}
		return f"{row.get('category') or ''} {row.get('ownership') or ''}".upper()
	return f"{profile.get('category') or ''} {profile.get('ownership') or ''}".upper()


def is_foco_centre(profile) -> bool:
	return "FOCO" in _model_blob(profile)


def is_fofo_centre(profile) -> bool:
	return "FOFO" in _model_blob(profile)


def override_upsell_percent(foco_id, fofo_id=None) -> float:
	"""Dynamic FOFO→FOCO % from the parent FOCO Franchisee Profile field."""
	pct = 0.0
	if foco_id and frappe.db.exists("Franchisee Profile", foco_id):
		pct = flt(frappe.db.get_value("Franchisee Profile", foco_id, "override_upsell_commission"))
	if pct <= 0:
		pct = DEFAULT_OVERRIDE_UPSELL
	return min(pct, 100.0)


def parent_foco_for(fofo_id) -> str:
	if not fofo_id:
		return ""
	return cstr(frappe.db.get_value("Franchisee Profile", fofo_id, "parent_foco") or "")


def _ensure_ledger_doctype():
	if frappe.db.exists("DocType", LEDGER_DOCTYPE):
		return
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	try:
		app_path = frappe.get_app_path("health_ecosystem_core")
		candidates.append(
			os.path.join(
				app_path,
				"health_ecosystem_core",
				"doctype",
				"fofo_foco_commission",
				"fofo_foco_commission.json",
			)
		)
		candidates.append(
			os.path.join(app_path, "doctype", "fofo_foco_commission", "fofo_foco_commission.json")
		)
	except Exception:
		pass
	try:
		import health_ecosystem_core.health_ecosystem_core as pkg

		pkg_dir = os.path.dirname(pkg.__file__)
		candidates.append(
			os.path.join(pkg_dir, "doctype", "fofo_foco_commission", "fofo_foco_commission.json")
		)
		candidates.append(
			os.path.join(
				pkg_dir,
				"health_ecosystem_core",
				"doctype",
				"fofo_foco_commission",
				"fofo_foco_commission.json",
			)
		)
	except Exception:
		pass
	candidates.append("/tmp/fofo_foco_commission.json")
	last_error = ""
	for json_path in candidates:
		if not os.path.isfile(json_path):
			continue
		try:
			import_file_by_path(json_path, force=True)
			frappe.db.commit()
			frappe.clear_cache(doctype=LEDGER_DOCTYPE)
			if frappe.db.exists("DocType", LEDGER_DOCTYPE):
				return
		except Exception:
			last_error = frappe.get_traceback()
	frappe.throw(_("Could not install FOFO FOCO Commission doctype. {0}").format(last_error[:800]))


def _ensure_wallet_commission_type():
	if not frappe.db.exists("DocType", "Franchisee Wallet Transaction"):
		return
	meta = frappe.get_meta("Franchisee Wallet Transaction")
	df = meta.get_field("transaction_type")
	if not df:
		return
	options = (df.options or "").split("\n")
	if "FOFO Commission" in options:
		return
	options.append("FOFO Commission")
	try:
		frappe.make_property_setter(
			{
				"doctype": "Franchisee Wallet Transaction",
				"fieldname": "transaction_type",
				"property": "options",
				"value": "\n".join(options),
				"property_type": "Text",
			},
			validate_fields_for_doctype=False,
		)
	except Exception:
		frappe.log_error(title="phase111_wallet_type", message=frappe.get_traceback())


def ensure_phase111_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	_ensure_ledger_doctype()
	_ensure_wallet_commission_type()
	meta = frappe.get_meta("Franchisee Profile")
	fields = []
	if not meta.has_field("parent_foco"):
		fields.append(
			{
				"fieldname": "parent_foco",
				"label": "Under Which FOCO",
				"fieldtype": "Link",
				"options": "Franchisee Profile",
				"insert_after": "ownership",
				"description": "Permanent FOFO → FOCO map set during FOFO onboarding.",
			}
		)
	if not meta.has_field("override_upsell_commission"):
		fields.append(
			{
				"fieldname": "override_upsell_commission",
				"label": "Override Upsell Commission",
				"fieldtype": "Percent",
				"default": str(int(DEFAULT_OVERRIDE_UPSELL)),
				"insert_after": "commission_percentage_rate",
				"description": (
					"FOCO earning % on mapped FOFO net (MRP − FOFO Margin). "
					"Dynamic override of the default 20% FOFO→FOCO upsell."
				),
			}
		)
	if fields:
		create_custom_fields({"Franchisee Profile": fields}, update=True, ignore_validate=True)
	# Backfill default % on FOCO profiles that still have a blank value.
	frappe.db.sql(
		"""
		UPDATE `tabFranchisee Profile`
		SET override_upsell_commission = %(pct)s
		WHERE IFNULL(override_upsell_commission, 0) = 0
		  AND (
				UPPER(IFNULL(category,'')) LIKE '%%FOCO%%'
				OR UPPER(IFNULL(ownership,'')) LIKE '%%FOCO%%'
		  )
		""",
		{"pct": DEFAULT_OVERRIDE_UPSELL},
	)
	return {"ok": True}


def map_fofo_to_foco(fofo_id, parent_foco, *, force=0):
	"""Permanently map a FOFO Franchisee Profile under an active FOCO."""
	ensure_phase111_fields()
	fofo_id = cstr(fofo_id or "").strip()
	parent_foco = cstr(parent_foco or "").strip()
	if not fofo_id or not frappe.db.exists("Franchisee Profile", fofo_id):
		frappe.throw(_("FOFO Franchisee Profile is required"))
	if not parent_foco or not frappe.db.exists("Franchisee Profile", parent_foco):
		frappe.throw(_("Select an active FOCO centre"))
	if fofo_id == parent_foco:
		frappe.throw(_("A FOFO cannot be mapped under itself"))
	foco = frappe.get_doc("Franchisee Profile", parent_foco)
	if (foco.active_status or "Active") != "Active":
		frappe.throw(_("Selected FOCO is not active"))
	existing = cstr(frappe.db.get_value("Franchisee Profile", fofo_id, "parent_foco") or "")
	if existing and existing != parent_foco and not cint(force):
		frappe.throw(
			_("This FOFO is already mapped under {0}. Mapping is permanent.").format(existing)
		)
	frappe.flags.allow_parent_foco_remap = bool(cint(force))
	try:
		doc = frappe.get_doc("Franchisee Profile", fofo_id)
		doc.parent_foco = parent_foco
		if not (doc.category or "").strip():
			doc.category = "FOFO"
		if not (doc.ownership or "").strip():
			doc.ownership = "FOFO"
		doc.save(ignore_permissions=True)
	finally:
		frappe.flags.allow_parent_foco_remap = False
	frappe.db.commit()
	return {
		"ok": True,
		"fofo": fofo_id,
		"parent_foco": parent_foco,
		"foco_name": foco.franchise_name,
		"override_upsell_commission": override_upsell_percent(parent_foco, fofo_id),
	}


def canonical_map_fofo_parent_foco_payload(payload: dict[str, Any]) -> str:
	ordered = {
		"action": "map_fofo_parent_foco",
		"application_id": cstr(payload.get("application_id") or ""),
		"application_number": cstr(payload.get("application_number") or ""),
		"fofo_franchisee": cstr(payload.get("fofo_franchisee") or ""),
		"parent_foco": cstr(payload.get("parent_foco") or ""),
	}
	return json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)


def map_fofo_parent_foco_payload(payload: dict[str, Any], *, signature: str | None = None) -> dict[str, Any]:
	from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
		verify_rfms_bridge_signature,
	)

	canonical = canonical_map_fofo_parent_foco_payload(payload)
	verify_rfms_bridge_signature(canonical, signature)
	return map_fofo_to_foco(
		payload.get("fofo_franchisee"),
		payload.get("parent_foco"),
		force=0,
	)


def list_active_foco_centres(limit=200):
	ensure_phase111_fields()
	rows = frappe.get_all(
		"Franchisee Profile",
		filters={"active_status": "Active"},
		fields=[
			"name",
			"franchise_name",
			"branch_code",
			"category",
			"ownership",
			"address",
			"territory_region",
			"override_upsell_commission",
		],
		order_by="franchise_name asc",
		limit=cint(limit) or 200,
	)
	out = []
	for row in rows:
		if not is_foco_centre(row):
			continue
		out.append(
			{
				"name": row.name,
				"franchise_name": row.franchise_name,
				"branch_code": row.branch_code,
				"address": row.address or "",
				"territory_region": row.territory_region or "",
				"override_upsell_commission": flt(row.override_upsell_commission)
				or DEFAULT_OVERRIDE_UPSELL,
			}
		)
	return out


def _bill_amounts(trf):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
		line_settlement,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

	mrp_amount = 0.0
	platform_fee = 0.0
	for line in get_trf_test_lines(trf):
		qty = flt(line.get("qty")) or 1
		settled = line_settlement(line["item_code"], franchisee_id=trf.franchisee_id, qty=qty)
		mrp_amount += flt(settled.get("mrp")) * qty
		platform_fee += flt(settled.get("platform_fee_amount") or (flt(settled.get("platform_fee")) * qty))
	if platform_fee <= 0:
		platform_fee = flt(getattr(trf, "wholesale_amount", None) or 0)
	if mrp_amount <= 0:
		mrp_amount = flt(trf.amount) or platform_fee
	mrp_amount = round(mrp_amount, 2)
	platform_fee = round(platform_fee, 2)
	fofo_margin = round(max(mrp_amount - platform_fee, 0.0), 2)
	net_amount = round(mrp_amount - fofo_margin, 2)
	return mrp_amount, fofo_margin, net_amount


def accrue_fofo_foco_commission(trf_name):
	"""Bill-wise pending FOFO earning for the mapped FOCO. Idempotent per TRF."""
	try:
		ensure_phase111_fields()
	except Exception:
		frappe.log_error(title="phase111_ensure", message=frappe.get_traceback())
		return None
	if not frappe.db.exists("DocType", LEDGER_DOCTYPE):
		return None
	if isinstance(trf_name, str):
		if not frappe.db.exists("Customer TRF", trf_name):
			return None
		trf = frappe.get_doc("Customer TRF", trf_name)
	else:
		trf = trf_name
	fofo_id = cstr(getattr(trf, "franchisee_id", None) or "")
	if not fofo_id:
		return None
	parent = parent_foco_for(fofo_id)
	if not parent:
		return None
	existing = frappe.db.get_value(
		LEDGER_DOCTYPE,
		{"customer_trf": trf.name, "foco": parent},
		"name",
	)
	if existing:
		return existing
	mrp_amount, fofo_margin, net_amount = _bill_amounts(trf)
	pct = override_upsell_percent(parent, fofo_id)
	earning = round(net_amount * pct / 100.0, 2)
	if earning <= 0:
		return None
	fofo_name = frappe.db.get_value("Franchisee Profile", fofo_id, "franchise_name") or fofo_id
	bill_dt = getattr(trf, "hec_bill_datetime", None) or trf.creation
	doc = frappe.get_doc(
		{
			"doctype": LEDGER_DOCTYPE,
			"foco": parent,
			"fofo": fofo_id,
			"customer_trf": trf.name,
			"bill_date": bill_dt,
			"mrp_amount": mrp_amount,
			"fofo_margin": fofo_margin,
			"net_amount": net_amount,
			"commission_percent": pct,
			"foco_earning": earning,
			"status": "Pending",
			"fofo_name": fofo_name,
			"patient_name": trf.patient_name,
			"notes": _("Pending FOFO earnings — settles to FOCO wallet after {0} days").format(
				SETTLEMENT_DAYS
			),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _credit_foco_wallet(foco_id, amount, ledger_name):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _record_wallet_transaction

	amount = flt(amount)
	if amount <= 0:
		return None
	profile = frappe.get_doc("Franchisee Profile", foco_id)
	balance = flt(profile.wallet_balance)
	new_balance = round(balance + amount, 2)
	profile.db_set("wallet_balance", new_balance)
	try:
		txn_id = _record_wallet_transaction(
			foco_id,
			"FOFO Commission",
			amount,
			new_balance,
			reference_doctype=LEDGER_DOCTYPE,
			reference_name=ledger_name,
			remarks=_("FOFO commission settlement {0}").format(ledger_name),
		)
	except Exception:
		# Fallback if Select options were not migrated yet.
		txn_id = _record_wallet_transaction(
			foco_id,
			"Adjustment",
			amount,
			new_balance,
			reference_doctype=LEDGER_DOCTYPE,
			reference_name=ledger_name,
			remarks=_("FOFO commission settlement {0}").format(ledger_name),
		)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase121_wallet_books import book_wallet_credit

	book_wallet_credit(txn_id, "commission")
	return txn_id


def settle_pending_fofo_commissions(as_of=None, foco_id=None, days=None):
	"""Credit FOCO wallet for Pending rows older than SETTLEMENT_DAYS. Never double-credit."""
	ensure_phase111_fields()
	if not frappe.db.exists("DocType", LEDGER_DOCTYPE):
		return {"ok": True, "settled": 0, "amount": 0}
	cutoff = add_days(getdate(as_of or today()), -(cint(days) if days is not None else SETTLEMENT_DAYS))
	filters = {"status": "Pending", "creation": ("<=", f"{cutoff} 23:59:59")}
	if foco_id:
		filters["foco"] = foco_id
	rows = frappe.get_all(
		LEDGER_DOCTYPE,
		filters=filters,
		fields=["name", "foco", "foco_earning"],
		order_by="foco, creation",
	)
	settled = 0
	total = 0.0
	# Consolidate per FOCO for a single wallet credit, then mark each row Credited.
	by_foco = {}
	for row in rows:
		by_foco.setdefault(row.foco, []).append(row)
	for foco, items in by_foco.items():
		batch_amount = round(sum(flt(i.foco_earning) for i in items), 2)
		if batch_amount <= 0:
			continue
		# One wallet credit per FOCO per run, referenced to the first ledger row.
		txn_id = _credit_foco_wallet(foco, batch_amount, items[0].name)
		settle_on = today()
		for item in items:
			frappe.db.set_value(
				LEDGER_DOCTYPE,
				item.name,
				{
					"status": "Credited",
					"settlement_date": settle_on,
					"wallet_transaction": txn_id,
				},
			)
			settled += 1
			total += flt(item.foco_earning)
	if settled:
		frappe.db.commit()
	return {"ok": True, "settled": settled, "amount": round(total, 2), "cutoff": str(cutoff)}


def run_daily_fofo_foco_settlement():
	try:
		return settle_pending_fofo_commissions()
	except Exception:
		frappe.log_error(title="phase111_fofo_foco_settlement", message=frappe.get_traceback())
		return {"ok": False}


def _onboarding_status(fofo_id) -> str:
	status = frappe.db.get_value("Franchisee Profile", fofo_id, "active_status") or "Active"
	if status == "Active":
		return "Onboarded"
	return status


def foco_centre_tab(foco_id):
	"""FOCO Partner Portal — Centre tab rows for mapped FOFOs."""
	ensure_phase111_fields()
	children = frappe.get_all(
		"Franchisee Profile",
		filters={"parent_foco": foco_id},
		fields=["name", "franchise_name", "branch_code", "address", "territory_region", "active_status"],
		order_by="franchise_name asc",
	)
	centres = []
	profit_from_centre = 0.0
	pending_earnings = 0.0
	for child in children:
		agg = frappe.db.sql(
			"""
			SELECT
				IFNULL(SUM(mrp_amount), 0) AS sales,
				IFNULL(SUM(net_amount), 0) AS net_business,
				IFNULL(SUM(foco_earning), 0) AS earning,
				IFNULL(SUM(CASE WHEN status = 'Pending' THEN foco_earning ELSE 0 END), 0) AS pending,
				IFNULL(SUM(CASE WHEN status = 'Credited' THEN foco_earning ELSE 0 END), 0) AS credited
			FROM `tabFOFO FOCO Commission`
			WHERE foco = %s AND fofo = %s
			""",
			(foco_id, child.name),
			as_dict=True,
		)[0]
		earning = flt(agg.earning)
		pending = flt(agg.pending)
		profit_from_centre += earning
		pending_earnings += pending
		if pending > 0:
			settle_status = "Pending"
		elif earning > 0:
			settle_status = "Credited"
		else:
			settle_status = "—"
		centres.append(
			{
				"fofo": child.name,
				"fofo_name": child.franchise_name,
				"franchise_code": child.branch_code,
				"address": child.address or child.territory_region or "",
				"territory": child.territory_region or "",
				"onboarding_status": _onboarding_status(child.name),
				"total_fofo_sales": round(flt(agg.sales), 2),
				"net_business": round(flt(agg.net_business), 2),
				"foco_earning": round(earning, 2),
				"pending_earning": round(pending, 2),
				"credited_earning": round(flt(agg.credited), 2),
				"settlement_status": settle_status,
			}
		)
	pct = override_upsell_percent(foco_id)
	return {
		"foco": foco_id,
		"override_upsell_commission": pct,
		"profit_from_centre": round(profit_from_centre, 2),
		"pending_fofo_earnings": round(pending_earnings, 2),
		"centres": centres,
	}


def foco_fofo_commission_statement(foco_id, limit=200):
	"""FOCO Partner Portal — FOFO Commission statement tab."""
	ensure_phase111_fields()
	if not frappe.db.exists("DocType", LEDGER_DOCTYPE):
		return {"lines": [], "summary": {}}
	rows = frappe.get_all(
		LEDGER_DOCTYPE,
		filters={"foco": foco_id},
		fields=[
			"name",
			"fofo",
			"fofo_name",
			"customer_trf",
			"bill_date",
			"mrp_amount",
			"fofo_margin",
			"net_amount",
			"commission_percent",
			"foco_earning",
			"settlement_date",
			"status",
			"creation",
		],
		order_by="creation desc",
		limit=cint(limit) or 200,
	)
	lines = []
	pending = 0.0
	credited = 0.0
	for row in rows:
		amt = flt(row.foco_earning)
		if row.status == "Pending":
			pending += amt
		elif row.status == "Credited":
			credited += amt
		lines.append(
			{
				"id": row.name,
				"fofo": row.fofo,
				"fofo_name": row.fofo_name or row.fofo,
				"trf_id": row.customer_trf,
				"bill_date": str(row.bill_date or row.creation),
				"mrp": flt(row.mrp_amount),
				"fofo_margin": flt(row.fofo_margin),
				"net_amount": flt(row.net_amount),
				"commission_percent": flt(row.commission_percent),
				"foco_earning": amt,
				"settlement_date": str(row.settlement_date) if row.settlement_date else "",
				"status": row.status,
			}
		)
	return {
		"override_upsell_commission": override_upsell_percent(foco_id),
		"lines": lines,
		"summary": {
			"pending_fofo_earnings": round(pending, 2),
			"credited_total": round(credited, 2),
			"profit_from_centre": round(pending + credited, 2),
		},
	}


def foco_pending_and_profit(foco_id):
	if not foco_id or not frappe.db.exists("DocType", LEDGER_DOCTYPE):
		return {"pending_fofo_earnings": 0.0, "profit_from_centre": 0.0}
	row = frappe.db.sql(
		"""
		SELECT
			IFNULL(SUM(CASE WHEN status = 'Pending' THEN foco_earning ELSE 0 END), 0) AS pending,
			IFNULL(SUM(foco_earning), 0) AS profit
		FROM `tabFOFO FOCO Commission`
		WHERE foco = %s
		""",
		foco_id,
		as_dict=True,
	)[0]
	return {
		"pending_fofo_earnings": round(flt(row.pending), 2),
		"profit_from_centre": round(flt(row.profit), 2),
	}
