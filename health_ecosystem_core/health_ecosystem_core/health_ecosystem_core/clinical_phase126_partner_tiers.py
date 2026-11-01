"""Phase 126 — FOCO → Master FOCO → Orange FOCO (lab) partner circuit billing.

Each test has a fixed Billing Rate (incoming from the layer above) and Platform Fee (outgoing to the
layer below) per tier, stored in Partner Tier Rate. Money is realised at the billing partner's deposit;
the company passes the margin down the circuit:

  MF share  = Master FOCO billing rate − Master FOCO platform fee
  Lab share = Orange billing rate − Orange platform fee

  Bill via FOCO         debit FOCO platform fee − (lab share if the FOCO has its own lab)
                        MF share → mapped Master FOCO, lab share → mapped lab (unless FOCO has lab)
  Bill via Master FOCO  debit FOCO platform fee − MF share − (lab share if it has its own lab)
                        lab share → mapped lab (unless it has its own lab)
  Bill via Orange FOCO  debit Orange platform fee

The biller is debited at billing. The MF share posts when the sample reaches the lab (icebox shipment
complete, TRF → In Lab) and the lab share posts when the report is authorized. Every row lives in
Partner Circuit Share keyed by TRF + line + role, so posting and reversal are idempotent.
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

TIER_FOCO = "FOCO"
TIER_MF = "Master FOCO"
TIER_ORANGE = "Orange FOCO"
TIERS = (TIER_FOCO, TIER_MF, TIER_ORANGE)

RATE_DT = "Partner Tier Rate"
SHARE_DT = "Partner Circuit Share"
SHIP_DT = "Partner Sample Shipment"
SHIP_ROW_DT = "Partner Sample Shipment TRF"
VBILL_DT = "Partner Vector Bill"
VECTOR_TYPE = "Vector"
WALLET_DT = "Franchisee Wallet Transaction"
PROFILE_DT = "Franchisee Profile"

ROLE_DEBIT = "Biller Debit"
ROLE_MF = "MF Share"
ROLE_LAB = "Lab Share"

TRIGGER_BILLING = "Billing"
TRIGGER_RECEIPT = "Lab Receipt"
TRIGGER_REPORT = "Report Authorized"
TRIGGER_CANCEL = "Cancellation"

RECEIVED_TRF_STATUSES = ("In Lab", "Completed")
AUTHORIZED_REPORT_STATUSES = ("Authorized", "Printed")
AUTHORIZED_JOURNEY_STATUSES = ("Authorized", "Dispatched")
ADMIN_ROLES = frozenset({"Administrator", "System Manager", "Health System Admin"})

FBG_ITEM_HINTS = ("fasting blood glucose", "glucose fasting", "fasting blood sugar", "blood sugar fasting", "fbs", "fbg")
FBG_SEED = (
	(TIER_FOCO, 28.0, 19.60),
	(TIER_MF, 14.0, 11.20),
	(TIER_ORANGE, 10.0, 6.0),
)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _ensure_custom_doctype(name, fields, permissions, istable=0):
	if frappe.db.exists("DocType", name):
		return False
	doc = {
		"doctype": "DocType",
		"name": name,
		"module": "Health Ecosystem Core",
		"custom": 1,
		"istable": istable,
		"autoname": "hash",
		"naming_rule": "Random",
		"engine": "InnoDB",
		"fields": fields,
	}
	if istable:
		doc["editable_grid"] = 1
	else:
		doc["track_changes"] = 1
		doc["permissions"] = permissions
	frappe.get_doc(doc).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def _admin_perms(extra_read=()):
	perms = [
		{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
		for role in ("System Manager", "Health System Admin")
	]
	perms += [{"role": role, "read": 1} for role in extra_read]
	return perms


def _ensure_profile_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	meta = frappe.get_meta(PROFILE_DT)
	anchor = "override_upsell_commission" if meta.has_field("override_upsell_commission") else "commission_percentage_rate"
	wanted = [
		{
			"fieldname": "section_partner_circuit",
			"label": "Partner Circuit",
			"fieldtype": "Section Break",
			"insert_after": anchor,
			"collapsible": 0,
		},
		{
			"fieldname": "partner_tier",
			"label": "Partner Tier",
			"fieldtype": "Select",
			"options": "\n" + "\n".join(TIERS),
			"insert_after": "section_partner_circuit",
			"in_standard_filter": 1,
			"description": "FOCO (phlebotomy) → Master FOCO (LR + logistics) → Orange FOCO (lab).",
		},
		{
			"fieldname": "mapped_master_foco",
			"label": "Mapped Master FOCO",
			"fieldtype": "Link",
			"options": PROFILE_DT,
			"insert_after": "partner_tier",
			"depends_on": f"eval:doc.partner_tier=='{TIER_FOCO}'",
			"description": "Set at onboarding for a FOCO. Receives the MF share when the sample reaches the lab.",
		},
		{
			"fieldname": "mapped_orange_lab",
			"label": "Mapped Orange FOCO / Lab",
			"fieldtype": "Link",
			"options": PROFILE_DT,
			"insert_after": "mapped_master_foco",
			"depends_on": f"eval:doc.partner_tier=='{TIER_MF}'",
			"description": "Set at onboarding for a Master FOCO. FOCOs under it use the same lab.",
		},
		{
			"fieldname": "has_lab",
			"label": "Has Own Lab",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "mapped_orange_lab",
			"description": "Partner performs tests itself: the lab share is not paid out, its debit is reduced instead.",
		},
		{
			"fieldname": "column_break_partner_circuit",
			"fieldtype": "Column Break",
			"insert_after": "has_lab",
		},
		{
			"fieldname": "svc_phlebotomy",
			"label": "Phlebotomist Service (FOCO module)",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "column_break_partner_circuit",
			"description": "Required for walk-in patient billing. Always on for a FOCO; tick for a Master / Orange FOCO that also runs a FOCO.",
		},
		{
			"fieldname": "svc_lr_logistics",
			"label": "LR + Logistics Service",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "svc_phlebotomy",
		},
		{
			"fieldname": "svc_lab_team",
			"label": "Lab Team (Technician, Lab Manager, Accessor / Transcriber, Signatories)",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "svc_lr_logistics",
		},
		{
			"fieldname": "circuit_mapped_on",
			"label": "Circuit Mapped On",
			"fieldtype": "Datetime",
			"read_only": 1,
			"insert_after": "svc_lab_team",
		},
		{
			"fieldname": "vector_entry_partner",
			"label": "Vector Entry Partner",
			"fieldtype": "Link",
			"options": PROFILE_DT,
			"insert_after": "circuit_mapped_on",
			"depends_on": "eval:doc.franchisee_type=='Vector'",
			"description": (
				"Vector (doctor / pharmacy) only: the FOCO, Master FOCO or Orange FOCO / lab its samples enter through. "
				"Leave empty for the normal Vector billing."
			),
		},
	]
	missing = [f for f in wanted if not meta.has_field(f["fieldname"])]
	if missing:
		create_custom_fields({PROFILE_DT: missing}, update=True, ignore_validate=True)
		frappe.clear_cache(doctype=PROFILE_DT)
	for f in wanted:
		if f["fieldname"] not in ("svc_phlebotomy", "mapped_master_foco"):
			continue
		row = frappe.db.get_value(
			"Custom Field",
			{"dt": PROFILE_DT, "fieldname": f["fieldname"]},
			["name", "label", "description", "depends_on"],
			as_dict=True,
		)
		want = {k: f.get(k) for k in ("label", "description", "depends_on")}
		if row and any(cstr(row.get(k)) != cstr(v) for k, v in want.items()):
			frappe.db.set_value("Custom Field", row.name, want)
			frappe.clear_cache(doctype=PROFILE_DT)
	return [f["fieldname"] for f in missing]


def _ensure_wallet_types():
	if not frappe.db.exists("DocType", WALLET_DT):
		return
	df = frappe.get_meta(WALLET_DT).get_field("transaction_type")
	if not df:
		return
	options = [o for o in (df.options or "").split("\n") if o]
	added = [t for t in (ROLE_MF, ROLE_LAB) if t not in options]
	if not added:
		return
	frappe.make_property_setter(
		{
			"doctype": WALLET_DT,
			"fieldname": "transaction_type",
			"property": "options",
			"value": "\n".join(options + added),
			"property_type": "Text",
		},
		validate_fields_for_doctype=False,
	)
	frappe.clear_cache(doctype=WALLET_DT)


def ensure_partner_tier_setup():
	"""Idempotent: profile fields, rate + ledger doctypes, wallet types."""
	created = []
	fields = _ensure_profile_fields()
	if _ensure_custom_doctype(
		RATE_DT,
		[
			{"fieldname": "item_code", "label": "Test (Item)", "fieldtype": "Link", "options": "Item", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "item_name", "label": "Test Name", "fieldtype": "Data", "fetch_from": "item_code.item_name", "read_only": 1, "in_list_view": 1},
			{"fieldname": "tier", "label": "Partner Tier", "fieldtype": "Select", "options": "\n".join(TIERS), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "billing_rate", "label": "Billing Rate (incoming)", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
			{"fieldname": "platform_fee", "label": "Platform Fee (outgoing)", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
			{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
		],
		_admin_perms(extra_read=("Franchisee Operator",)),
	):
		created.append(RATE_DT)
	if _ensure_custom_doctype(
		SHARE_DT,
		[
			{"fieldname": "customer_trf", "label": "Bill (TRF)", "fieldtype": "Link", "options": "Customer TRF", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
			{"fieldname": "item_code", "label": "Test", "fieldtype": "Link", "options": "Item", "in_list_view": 1},
			{"fieldname": "line_no", "label": "Line", "fieldtype": "Int"},
			{"fieldname": "qty", "label": "Qty", "fieldtype": "Float", "default": "1"},
			{"fieldname": "bill_channel", "label": "Billed Via (Tier)", "fieldtype": "Data", "in_standard_filter": 1},
			{"fieldname": "billing_partner", "label": "Billing Partner", "fieldtype": "Link", "options": PROFILE_DT, "in_standard_filter": 1, "search_index": 1},
			{"fieldname": "beneficiary", "label": "Wallet Adjusted", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
			{"fieldname": "role", "label": "Role", "fieldtype": "Select", "options": "\n".join((ROLE_DEBIT, ROLE_MF, ROLE_LAB)), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Pending\nPosted\nReversed", "default": "Pending", "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "trigger", "label": "Posted On Event", "fieldtype": "Select", "options": "\n" + "\n".join((TRIGGER_BILLING, TRIGGER_RECEIPT, TRIGGER_REPORT, TRIGGER_CANCEL))},
			{"fieldname": "posted_on", "label": "Posted At", "fieldtype": "Datetime"},
			{"fieldname": "wallet_transaction", "label": "Wallet Transaction", "fieldtype": "Link", "options": WALLET_DT},
			{"fieldname": "reversal_transaction", "label": "Reversal Transaction", "fieldtype": "Link", "options": WALLET_DT},
			{"fieldname": "share_key", "label": "Share Key", "fieldtype": "Data", "unique": 1, "read_only": 1},
			{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
		],
		_admin_perms(extra_read=("Franchisee Operator",)),
	):
		created.append(SHARE_DT)
	if _ensure_custom_doctype(
		SHIP_ROW_DT,
		[
			{"fieldname": "customer_trf", "label": "Bill (TRF)", "fieldtype": "Link", "options": "Customer TRF", "reqd": 1, "in_list_view": 1},
			{"fieldname": "patient_name", "label": "Patient", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "tests", "label": "Tests", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "from_partner", "label": "Billed By", "fieldtype": "Link", "options": PROFILE_DT, "in_list_view": 1},
		],
		[],
		istable=1,
	):
		created.append(SHIP_ROW_DT)
	if _ensure_custom_doctype(
		SHIP_DT,
		[
			{"fieldname": "shipper", "label": "Accessioned / Shipped By", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "shipper_tier", "label": "Shipper Tier", "fieldtype": "Data", "read_only": 1},
			{"fieldname": "to_lab", "label": "To Lab", "fieldtype": "Link", "options": PROFILE_DT, "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Shipped\nDelivered\nCancelled", "default": "Shipped", "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "lr_number", "label": "LR / Docket No.", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "courier", "label": "Courier / Logistics", "fieldtype": "Data"},
			{"fieldname": "icebox_temp_c", "label": "Icebox Temp (°C)", "fieldtype": "Float"},
			{"fieldname": "shipped_on", "label": "Shipped On", "fieldtype": "Datetime"},
			{"fieldname": "delivered_on", "label": "Received At Lab", "fieldtype": "Datetime"},
			{"fieldname": "received_by", "label": "Received By", "fieldtype": "Data"},
			{"fieldname": "sample_count", "label": "Samples", "fieldtype": "Int", "in_list_view": 1},
			{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
			{"fieldname": "samples", "label": "Samples", "fieldtype": "Table", "options": SHIP_ROW_DT},
		],
		_admin_perms(extra_read=("Franchisee Operator",)),
	):
		created.append(SHIP_DT)
	if _ensure_custom_doctype(
		VBILL_DT,
		[
			{"fieldname": "customer_trf", "label": "Bill (TRF)", "fieldtype": "Link", "options": "Customer TRF", "reqd": 1, "unique": 1, "in_list_view": 1},
			{"fieldname": "vector", "label": "Vector (Billed To)", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
			{"fieldname": "entry_partner", "label": "Entry Partner (Billed By)", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
			{"fieldname": "entry_tier", "label": "Entry Tier", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "amount", "label": "B2B Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
			{"fieldname": "tests", "label": "Tests", "fieldtype": "Data"},
			{"fieldname": "patient_name", "label": "Patient", "fieldtype": "Data"},
			{"fieldname": "billed_by", "label": "Created By Partner", "fieldtype": "Link", "options": PROFILE_DT},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Unsettled\nSettled\nCancelled", "default": "Unsettled", "in_list_view": 1, "in_standard_filter": 1},
			{"fieldname": "settled_on", "label": "Settled On", "fieldtype": "Datetime"},
			{"fieldname": "settled_by", "label": "Settled By", "fieldtype": "Data"},
			{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
		],
		_admin_perms(extra_read=("Franchisee Operator",)),
	):
		created.append(VBILL_DT)
	_ensure_doctype_field(
		SHARE_DT,
		{"fieldname": "origin_vector", "label": "Origin Vector", "fieldtype": "Link", "options": PROFILE_DT, "insert_after": "billing_partner"},
	)
	trf_fields = _ensure_trf_fields()
	_relax_rate_platform_fee()
	_ensure_wallet_types()
	return {"ok": True, "created_doctypes": created, "created_fields": fields + trf_fields}


def _relax_rate_platform_fee():
	"""Partner Tier Rate rows may hold a billing rate alone (partial chart row); the fee becomes optional."""
	if not frappe.db.exists("DocType", RATE_DT):
		return False
	df = frappe.get_meta(RATE_DT).get_field("platform_fee")
	if not df or not cint(df.reqd):
		return False
	doc = frappe.get_doc("DocType", RATE_DT)
	for f in doc.fields:
		if f.fieldname == "platform_fee":
			f.reqd = 0
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=RATE_DT)
	return True


def _ensure_doctype_field(doctype, field):
	"""Add a field to one of our custom DocTypes created before the field existed."""
	if not frappe.db.exists("DocType", doctype) or frappe.get_meta(doctype).has_field(field["fieldname"]):
		return False
	doc = frappe.get_doc("DocType", doctype)
	doc.append("fields", field)
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=doctype)
	return True


def _ensure_trf_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	meta = frappe.get_meta("Customer TRF")
	wanted = [
		{"fieldname": "section_partner_circuit", "label": "Partner Circuit", "fieldtype": "Section Break", "insert_after": "platform_billed", "collapsible": 1},
		{"fieldname": "circuit_entry_partner", "label": "Circuit Entry Partner", "fieldtype": "Link", "options": PROFILE_DT, "insert_after": "section_partner_circuit", "read_only": 1},
		{"fieldname": "vector_partner", "label": "Vector Partner", "fieldtype": "Link", "options": PROFILE_DT, "insert_after": "circuit_entry_partner", "read_only": 1},
		{"fieldname": "circuit_billed_by", "label": "Bill Created By", "fieldtype": "Link", "options": PROFILE_DT, "insert_after": "vector_partner", "read_only": 1},
		{"fieldname": "hec_dummy_patient_bill", "label": "Dummy Patient Bill (no books)", "fieldtype": "Check", "default": "0", "insert_after": "circuit_billed_by", "read_only": 1},
	]
	if not meta.has_field("platform_billed"):
		for f in wanted:
			if f["insert_after"] == "platform_billed":
				f["insert_after"] = "amount"
	missing = [f for f in wanted if not meta.has_field(f["fieldname"])]
	if missing:
		create_custom_fields({"Customer TRF": missing}, update=True, ignore_validate=True)
		frappe.clear_cache(doctype="Customer TRF")
	return [f["fieldname"] for f in missing]


def resolve_fbg_item():
	"""Best match for the Fasting Blood Glucose lab item."""
	rows = frappe.get_all(
		"Item",
		filters={"disabled": 0},
		or_filters=[
			["item_name", "like", "%fasting%glucose%"],
			["item_name", "like", "%glucose%fasting%"],
			["item_name", "like", "%fasting%sugar%"],
			["item_name", "like", "%sugar%fasting%"],
			["item_code", "in", ["FBS", "FBG", "GLU-F", "GLUF"]],
		],
		fields=["name", "item_name"],
		limit_page_length=20,
	)
	rows = [r for r in rows if not any(x in cstr(r.item_name).lower() for x in ("post", "prandial", "parandial", " pp"))]
	if not rows:
		return None
	for hint in FBG_ITEM_HINTS:
		for r in rows:
			if cstr(r.item_name).strip().lower() == hint:
				return r.name
	for r in rows:
		name = cstr(r.item_name).lower()
		if "fbs" in name or "fbg" in name:
			return r.name
	return rows[0].name


def seed_fbg_tier_rates(item_code=None):
	"""Seed Fasting Blood Glucose rates (FOCO 28/19.60, MF 14/11.20, Orange 10/6)."""
	ensure_partner_tier_setup()
	item_code = cstr(item_code or "").strip() or resolve_fbg_item()
	if not item_code or not frappe.db.exists("Item", item_code):
		return {"ok": False, "error": "Fasting Blood Glucose item not found; pass item_code"}
	out = []
	for tier, billing, fee in FBG_SEED:
		name = frappe.db.get_value(RATE_DT, {"item_code": item_code, "tier": tier}, "name")
		if name:
			out.append({"tier": tier, "rate": name, "created": False})
			continue
		doc = frappe.get_doc(
			{
				"doctype": RATE_DT,
				"item_code": item_code,
				"tier": tier,
				"billing_rate": billing,
				"platform_fee": fee,
				"active": 1,
				"notes": "Seeded — partner circuit launch rates",
			}
		).insert(ignore_permissions=True)
		out.append({"tier": tier, "rate": doc.name, "created": True})
	frappe.db.commit()
	clear_tier_caches()
	return {"ok": True, "item_code": item_code, "rates": out}


def setup_phase126(item_code=None):
	setup = ensure_partner_tier_setup()
	frappe.db.commit()
	seed = seed_fbg_tier_rates(item_code)
	return {"setup": setup, "seed": seed}


# ---------------------------------------------------------------------------
# Circuit + rates
# ---------------------------------------------------------------------------


def _profile_row(fid):
	if not fid or not frappe.db.exists(PROFILE_DT, fid):
		return None
	meta = frappe.get_meta(PROFILE_DT)
	fields = ["name", "franchise_name", "branch_code", "franchisee_type"] + [
		f
		for f in (
			"vector_entry_partner",
			"partner_tier",
			"mapped_master_foco",
			"mapped_orange_lab",
			"has_lab",
			"svc_phlebotomy",
			"svc_lr_logistics",
			"svc_lab_team",
			"circuit_mapped_on",
			"wallet_balance",
		)
		if meta.has_field(f)
	]
	return frappe.db.get_value(PROFILE_DT, fid, fields, as_dict=True)


def partner_circuit(fid) -> dict[str, Any]:
	"""Tier, mapped Master FOCO and the lab that performs this partner's tests."""
	row = _profile_row(fid)
	if not row:
		return {"franchisee": fid, "tier": None}
	tier = cstr(row.get("partner_tier")).strip() or None
	has_lab = bool(cint(row.get("has_lab")))
	if tier == TIER_ORANGE and cint(row.get("svc_phlebotomy")):
		# Orange FOCO + FOCO module is a FOCO with own lab (profiles are normalised on save; this covers old rows).
		tier, has_lab = TIER_FOCO, True
	master = None
	lab = None
	if tier == TIER_FOCO:
		master = cstr(row.get("mapped_master_foco")).strip() or None
		if master:
			lab = cstr(frappe.db.get_value(PROFILE_DT, master, "mapped_orange_lab") or "").strip() or None
	elif tier == TIER_MF:
		lab = cstr(row.get("mapped_orange_lab")).strip() or None
	elif tier == TIER_ORANGE:
		lab = row.name
	if has_lab:
		lab = row.name

	def _label(pid):
		if not pid:
			return None
		return frappe.db.get_value(PROFILE_DT, pid, "franchise_name") or pid

	return {
		"franchisee": row.name,
		"franchise_name": row.get("franchise_name") or row.name,
		"tier": tier,
		"has_lab": has_lab,
		"master_foco": master,
		"master_foco_name": _label(master),
		"lab": lab,
		"lab_name": _label(lab),
		"services": {
			"phlebotomy": bool(cint(row.get("svc_phlebotomy"))),
			"lr_logistics": bool(cint(row.get("svc_lr_logistics"))),
			"lab_team": bool(cint(row.get("svc_lab_team"))),
		},
		"circuit_mapped_on": cstr(row.get("circuit_mapped_on") or "") or None,
	}


def _all_tier_rates() -> dict[str, dict[str, dict[str, float]]]:
	"""Active tier rates for every item, cached for the current request."""
	cached = getattr(frappe.local, "p126_tier_rates", None)
	if cached is not None:
		return cached
	out: dict[str, dict[str, dict[str, float]]] = {}
	if frappe.db.exists("DocType", RATE_DT):
		for r in frappe.get_all(RATE_DT, filters={"active": 1}, fields=["item_code", "tier", "billing_rate", "platform_fee"], limit_page_length=0):
			out.setdefault(r.item_code, {})[r.tier] = {
				"billing_rate": flt(r.billing_rate),
				"platform_fee": flt(r.platform_fee),
			}
	# Only fully priced tests (all three tiers, billing and fee) are on the circuit; partial rows (e.g. an
	# imported Orange billing alone) never bill, so an Orange partner is never debited ₹0.
	out = {code: tiers for code, tiers in out.items() if tier_row_complete(tiers)}
	frappe.local.p126_tier_rates = out
	return out


def tier_row_complete(tiers) -> bool:
	return all(
		t in tiers and flt(tiers[t].get("billing_rate")) > 0 and flt(tiers[t].get("platform_fee")) > 0 for t in TIERS
	)


def tier_rates(item_code) -> dict[str, dict[str, float]]:
	if not item_code:
		return {}
	return dict(_all_tier_rates().get(item_code) or {})


def clear_tier_caches():
	frappe.local.p126_tier_rates = None
	frappe.local.p126_circuits = None
	frappe.local.p126_vector_entries = None


def _cached_circuit(fid):
	store = getattr(frappe.local, "p126_circuits", None)
	if store is None:
		store = frappe.local.p126_circuits = {}
	if fid not in store:
		store[fid] = partner_circuit(fid)
	return store[fid]


def _needed_tiers(tier):
	if tier == TIER_ORANGE:
		return (TIER_ORANGE,)
	return (TIER_FOCO, TIER_MF, TIER_ORANGE)


def tier_settlement(item_code, biller_id, qty=1, circuit=None):
	"""Per-line deposit adjustment for a tiered biller, or None when the item/biller is not on the circuit."""
	rates = tier_rates(item_code)
	if not rates:
		return None
	circuit = circuit or _cached_circuit(biller_id)
	tier = circuit.get("tier")
	if tier not in TIERS:
		return None
	foco_module = has_foco_module(circuit)
	if not rates or any(t not in rates for t in _needed_tiers(tier)):
		return None
	qty = flt(qty) or 1
	has_lab = circuit.get("has_lab")
	mf_share = 0.0
	lab_share = 0.0
	if tier == TIER_ORANGE:
		debit = rates[TIER_ORANGE]["platform_fee"]
	else:
		mf_share = round(rates[TIER_MF]["billing_rate"] - rates[TIER_MF]["platform_fee"], 2)
		lab_share = round(rates[TIER_ORANGE]["billing_rate"] - rates[TIER_ORANGE]["platform_fee"], 2)
		debit = rates[TIER_FOCO]["platform_fee"]
		if tier == TIER_MF:
			debit -= mf_share
			mf_share = 0.0
		if has_lab:
			debit -= lab_share
			lab_share = 0.0
	debit = round(max(debit, 0.0), 2)

	shares = []
	if mf_share > 0:
		if not circuit.get("master_foco"):
			frappe.throw(
				_("{0} is a FOCO without a mapped Master FOCO. Map the partner circuit before billing.").format(
					circuit.get("franchise_name") or biller_id
				),
				frappe.ValidationError,
			)
		shares.append({"role": ROLE_MF, "beneficiary": circuit["master_foco"], "per_unit": mf_share})
	if lab_share > 0:
		if not circuit.get("lab"):
			frappe.throw(
				_("{0} has no mapped Orange FOCO / lab. Map the partner circuit before billing.").format(
					circuit.get("franchise_name") or biller_id
				),
				frappe.ValidationError,
			)
		shares.append({"role": ROLE_LAB, "beneficiary": circuit["lab"], "per_unit": lab_share})

	patient_rate = rates[TIER_FOCO]["billing_rate"] if foco_module and TIER_FOCO in rates else None

	return {
		"item_code": item_code,
		"tier": tier,
		"qty": qty,
		"debit_per_unit": debit,
		"debit_amount": round(debit * qty, 2),
		"shares": [{**s, "amount": round(s["per_unit"] * qty, 2)} for s in shares],
		"rates": rates,
		"foco_module": foco_module,
		"patient_rate": patient_rate,
	}


def has_foco_module(circuit) -> bool:
	"""A FOCO always runs the FOCO (phlebotomy) module; Master / Orange FOCO only when Phlebotomist Service is ticked."""
	if circuit.get("tier") == TIER_FOCO:
		return True
	return bool((circuit.get("services") or {}).get("phlebotomy"))


def assert_can_bill_patient(fid):
	"""Walk-in patient billing is allowed only for partners running the FOCO module.

	Partners not on the circuit keep today's behaviour.
	"""
	circuit = _cached_circuit(fid)
	if circuit.get("tier") not in TIERS or has_foco_module(circuit):
		return circuit
	frappe.throw(
		_(
			"{0} is a {1} without the FOCO module. Walk-in patient billing needs Phlebotomist Service; "
			"bill B2B partners for accession and shipment instead."
		).format(circuit.get("franchise_name") or fid, circuit.get("tier")),
		frappe.ValidationError,
	)


def tier_preview_for_lines(lines, biller_id):
	"""Attach tier deposit adjustments to repriced bill lines (for the bill entry preview)."""
	entry = vector_entry(biller_id)
	if entry:
		total = 0.0
		applied = False
		for row in lines or []:
			code = cstr(row.get("item") or row.get("item_code") or "").strip()
			try:
				line = vector_tier_settlement(code, biller_id, flt(row.get("qty")) or 1, entry=entry) if code else None
			except frappe.ValidationError:
				line = None
			if line:
				applied = True
				total += line["b2b_amount"]
		return lines, {
			"tier": f"Vector via {entry['entry_tier']}",
			"applied": applied,
			"vector": True,
			"deposit_adjustment": 0,
			"b2b_amount": round(total, 2),
			"entry_name": entry["entry_name"],
			"entry_tier": entry["entry_tier"],
			"master_foco_name": None,
			"lab_name": None,
		}
	circuit = partner_circuit(biller_id)
	if circuit.get("tier") not in TIERS:
		return lines, None
	total = 0.0
	applied = False
	out = []
	for row in lines or []:
		code = cstr(row.get("item") or row.get("item_code") or "").strip()
		qty = flt(row.get("qty")) or 1
		merged = dict(row)
		try:
			tier = tier_settlement(code, biller_id, qty, circuit=circuit) if code else None
		except frappe.ValidationError as exc:
			merged["tier_error"] = cstr(exc)
			tier = None
		if tier:
			applied = True
			merged["platform_fee"] = tier["debit_per_unit"]
			merged["tier_deposit_adjustment"] = -tier["debit_amount"]
			merged["tier_shares"] = tier["shares"]
			total += tier["debit_amount"]
		else:
			total += flt(merged.get("platform_fee")) * qty
		out.append(merged)
	summary = {
		"tier": circuit.get("tier"),
		"applied": applied,
		"deposit_adjustment": -round(total, 2),
		"master_foco_name": circuit.get("master_foco_name"),
		"lab_name": circuit.get("lab_name"),
	}
	return out, summary


# ---------------------------------------------------------------------------
# Vector (doctor / pharmacy B2B) entry into the circuit
# ---------------------------------------------------------------------------


def vector_entry(vector_id):
	"""Entry partner for a mapped Vector, or None (not a Vector / unmapped → normal Vector billing)."""
	if not vector_id:
		return None
	store = getattr(frappe.local, "p126_vector_entries", None)
	if store is None:
		store = frappe.local.p126_vector_entries = {}
	if vector_id in store:
		return store[vector_id]
	out = None
	meta = frappe.get_meta(PROFILE_DT)
	if meta.has_field("vector_entry_partner") and frappe.db.exists(PROFILE_DT, vector_id):
		row = frappe.db.get_value(
			PROFILE_DT,
			vector_id,
			["name", "franchise_name", "franchisee_type", "vector_entry_partner"],
			as_dict=True,
		)
		entry = cstr(row.get("vector_entry_partner")).strip()
		if cstr(row.get("franchisee_type")).strip() == VECTOR_TYPE and entry and frappe.db.exists(PROFILE_DT, entry):
			circuit = _cached_circuit(entry)
			if circuit.get("tier") in TIERS:
				out = {
					"vector": row.name,
					"vector_name": row.franchise_name or row.name,
					"entry_partner": entry,
					"entry_name": circuit.get("franchise_name") or entry,
					"entry_tier": circuit["tier"],
					"entry_has_lab": bool(circuit.get("has_lab")),
					"circuit": circuit,
				}
	store[vector_id] = out
	return out


def vector_tier_settlement(item_code, vector_id, qty=1, entry=None):
	"""Entry-partner deposit debit, pending shares and the B2B amount billed to the Vector.

	FOCO entry:    the FOCO is debited as when it bills (−19.60, −15.60 with own lab); MF + lab shares as usual.
	Master entry:  the Master FOCO is debited its platform fee (−11.20); lab share to its mapped lab.
	Lab entry:     the lab is debited its platform fee (−6.00).
	The Vector is billed the entry tier's billing rate (28 / 14 / 10), settled offline.
	"""
	entry = entry or vector_entry(vector_id)
	if not entry:
		return None
	rates = tier_rates(item_code)
	tier = entry["entry_tier"]
	circuit = entry["circuit"]
	partner = entry["entry_partner"]
	if not rates or any(t not in rates for t in _needed_tiers(tier)):
		return None
	qty = flt(qty) or 1
	if tier == TIER_FOCO:
		base = tier_settlement(item_code, partner, qty, circuit=circuit)
		if not base:
			return None
		debit = base["debit_per_unit"]
		shares = [{k: v for k, v in s.items() if k != "amount"} for s in base["shares"]]
	elif tier == TIER_MF:
		debit = rates[TIER_MF]["platform_fee"]
		lab_share = round(rates[TIER_ORANGE]["billing_rate"] - rates[TIER_ORANGE]["platform_fee"], 2)
		shares = []
		if circuit.get("has_lab"):
			debit -= lab_share
		elif lab_share > 0:
			if not circuit.get("lab"):
				frappe.throw(
					_("{0} has no mapped Orange FOCO / lab. Map the partner circuit before billing.").format(entry["entry_name"]),
					frappe.ValidationError,
				)
			shares.append({"role": ROLE_LAB, "beneficiary": circuit["lab"], "per_unit": lab_share})
	else:
		debit = rates[TIER_ORANGE]["platform_fee"]
		shares = []
	debit = round(max(debit, 0.0), 2)
	b2b_rate = rates[tier]["billing_rate"]
	return {
		"item_code": item_code,
		"tier": tier,
		"channel": f"Vector via {tier}",
		"qty": qty,
		"entry_partner": partner,
		"vector": entry["vector"],
		"debit_per_unit": debit,
		"debit_amount": round(debit * qty, 2),
		"shares": [{**s, "amount": round(s["per_unit"] * qty, 2)} for s in shares],
		"b2b_rate": b2b_rate,
		"b2b_amount": round(b2b_rate * qty, 2),
		"rates": rates,
	}


def settle_vector_bill(trf_name, vector_id, billed_by=None):
	"""Mapped Vector bill: dummy MRP patient bill (no books), entry partner deposit debit, B2B bill to the Vector."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
		debit_b2b_wallet_platform_fee,
		get_wallet_balance,
	)

	ensure_partner_tier_setup()
	entry = vector_entry(vector_id)
	if not entry:
		frappe.throw(_("{0} is not mapped to a circuit entry partner").format(vector_id))
	trf = frappe.get_doc("Customer TRF", trf_name)
	if cint(trf.get("platform_billed")):
		return {"wallet_transaction": None, "already_billed": True}
	lines = []
	for row in trf.get("tests") or []:
		line = vector_tier_settlement(row.item, vector_id, flt(row.qty or 1) or 1, entry=entry)
		if not line:
			frappe.throw(
				_("{0} has no partner tier rates, so it cannot be billed through {1}. Only circuit tests can be billed by a mapped Vector.").format(
					frappe.db.get_value("Item", row.item, "item_name") or row.item, entry["entry_name"]
				),
				frappe.ValidationError,
			)
		lines.append(line)
	if not lines:
		frappe.throw(_("Add at least one test"))
	partner = entry["entry_partner"]
	total_debit = round(sum(l["debit_amount"] for l in lines), 2)
	b2b_total = round(sum(l["b2b_amount"] for l in lines), 2)
	txn = debit_b2b_wallet_platform_fee(partner, total_debit, trf.name) if total_debit > 0 else None
	record_circuit_bill(trf.name, partner, lines, txn, origin_vector=vector_id)
	tests = ", ".join(frappe.db.get_value("Item", l["item_code"], "item_name") or l["item_code"] for l in lines)
	vbill = frappe.db.get_value(VBILL_DT, {"customer_trf": trf.name}, "name")
	if not vbill:
		vbill = frappe.get_doc(
			{
				"doctype": VBILL_DT,
				"customer_trf": trf.name,
				"vector": vector_id,
				"entry_partner": partner,
				"entry_tier": entry["entry_tier"],
				"amount": b2b_total,
				"tests": tests[:140],
				"patient_name": trf.patient_name,
				"billed_by": billed_by or vector_id,
				"status": "Unsettled",
			}
		).insert(ignore_permissions=True).name
	trf.db_set(
		{
			"wholesale_amount": total_debit,
			"platform_billed": 1,
			"circuit_entry_partner": partner,
			"vector_partner": vector_id,
			"circuit_billed_by": billed_by or vector_id,
			"hec_dummy_patient_bill": 1,
		}
	)
	frappe.db.commit()
	return {
		"wallet_transaction": txn,
		"wholesale_amount": total_debit,
		"partner_tier": f"Vector via {entry['entry_tier']}",
		"vector_bill": vbill,
		"vector_bill_amount": b2b_total,
		"entry_partner": partner,
		"entry_partner_name": entry["entry_name"],
		"entry_wallet_balance": get_wallet_balance(partner),
		"wallet_balance": get_wallet_balance(billed_by or vector_id),
		"patient_invoice": None,
		"platform_invoice": None,
		"invoice_errors": [],
		"dummy_patient_bill": True,
	}


def vector_debit_for_lines(vector_id, lines):
	"""Entry-partner debit for prospective bill lines (headroom checks), or None when not a mapped Vector."""
	entry = vector_entry(vector_id)
	if not entry:
		return None
	total = 0.0
	for row in lines or []:
		code = cstr(row.get("item") or row.get("item_code") or row.get("code") or "").strip()
		if not code:
			continue
		line = vector_tier_settlement(code, vector_id, flt(row.get("qty")) or 1, entry=entry)
		if line:
			total += line["debit_amount"]
	return {"entry_partner": entry["entry_partner"], "debit": round(total, 2)}


def vector_bill_to_options(foco_id):
	"""Vectors that enter through this FOCO (for the FOCO 'Bill to Vector' choice)."""
	meta = frappe.get_meta(PROFILE_DT)
	if not meta.has_field("vector_entry_partner"):
		return []
	if _cached_circuit(foco_id).get("tier") != TIER_FOCO:
		return []
	return [
		{"id": r.name, "name": r.franchise_name or r.name, "branch_code": r.branch_code}
		for r in frappe.get_all(
			PROFILE_DT,
			filters={"vector_entry_partner": foco_id, "franchisee_type": VECTOR_TYPE, "active_status": "Active"},
			fields=["name", "franchise_name", "branch_code"],
			order_by="franchise_name asc",
			limit_page_length=500,
		)
	]


def vector_entry_public(fid):
	entry = vector_entry(fid)
	if not entry:
		return None
	return {k: entry[k] for k in ("vector", "vector_name", "entry_partner", "entry_name", "entry_tier", "entry_has_lab")}


def _vbill_row(d):
	return {
		"id": d.name,
		"trf": d.customer_trf,
		"vector": d.vector,
		"vector_name": frappe.db.get_value(PROFILE_DT, d.vector, "franchise_name") or d.vector,
		"entry_partner": d.entry_partner,
		"entry_name": frappe.db.get_value(PROFILE_DT, d.entry_partner, "franchise_name") or d.entry_partner,
		"entry_tier": d.entry_tier,
		"amount": flt(d.amount),
		"tests": d.tests,
		"patient_name": d.patient_name,
		"billed_by": d.billed_by,
		"status": d.status,
		"settled_on": cstr(d.settled_on) if d.settled_on else None,
		"created": cstr(d.creation),
	}


def partner_vector_bills_payload(fid, limit=300):
	"""B2B bills between Vectors and their entry partners (settled offline)."""
	ensure_partner_tier_setup()
	fields = ["name", "customer_trf", "vector", "entry_partner", "entry_tier", "amount", "tests", "patient_name", "billed_by", "status", "settled_on", "creation"]
	receivable = [
		_vbill_row(d)
		for d in frappe.get_all(VBILL_DT, filters={"entry_partner": fid}, fields=fields, order_by="creation desc", limit_page_length=cint(limit) or 300)
	]
	payable = [
		_vbill_row(d)
		for d in frappe.get_all(VBILL_DT, filters={"vector": fid}, fields=fields, order_by="creation desc", limit_page_length=cint(limit) or 300)
	]
	month = cstr(now_datetime())[:7]

	def totals(rows):
		return {
			"unsettled": round(sum(r["amount"] for r in rows if r["status"] == "Unsettled"), 2),
			"settled_month": round(sum(r["amount"] for r in rows if r["status"] == "Settled" and cstr(r["settled_on"])[:7] == month), 2),
			"count_unsettled": sum(1 for r in rows if r["status"] == "Unsettled"),
		}

	return {
		"vector_entry": vector_entry_public(fid),
		"receivable": receivable,
		"payable": payable,
		"receivable_totals": totals(receivable),
		"payable_totals": totals(payable),
	}


def settle_partner_vector_bill(fid, bill, roles=None, remarks=None):
	"""Entry partner records that the Vector paid the B2B bill offline."""
	ensure_partner_tier_setup()
	if not bill or not frappe.db.exists(VBILL_DT, bill):
		frappe.throw(_("Vector bill not found"))
	doc = frappe.get_doc(VBILL_DT, bill)
	if doc.entry_partner != fid and not set(roles or []) & ADMIN_ROLES:
		frappe.throw(_("Only the billing partner can mark this Vector bill settled"), frappe.PermissionError)
	if doc.status == "Cancelled":
		frappe.throw(_("This bill was cancelled"))
	if doc.status != "Settled":
		doc.db_set(
			{
				"status": "Settled",
				"settled_on": now_datetime(),
				"settled_by": frappe.session.user,
				"remarks": cstr(remarks or doc.remarks or "")[:500],
			}
		)
		frappe.db.commit()
	doc.reload()
	return _vbill_row(doc)


def map_vector_entry(roles, vector, entry_partner=None):
	"""Admin: map a Vector to its circuit entry partner (or clear to return it to normal Vector billing)."""
	_require_admin(roles)
	ensure_partner_tier_setup()
	vector = cstr(vector or "").strip()
	if not vector or not frappe.db.exists(PROFILE_DT, vector):
		frappe.throw(_("Vector not found"))
	frappe.flags.allow_partner_circuit_remap = True
	try:
		doc = frappe.get_doc(PROFILE_DT, vector)
		doc.vector_entry_partner = cstr(entry_partner or "").strip() or None
		doc.save(ignore_permissions=True)
	finally:
		frappe.flags.allow_partner_circuit_remap = False
	frappe.db.commit()
	clear_tier_caches()
	return vector_entry_public(vector) or {"vector": vector, "entry_partner": None}


def assert_foco_can_bill_vector(foco_id, vector_id):
	"""Only the FOCO a Vector enters through may raise a bill on the Vector's behalf."""
	entry = vector_entry(vector_id)
	if not entry or entry["entry_partner"] != foco_id or entry["entry_tier"] != TIER_FOCO:
		frappe.throw(
			_("{0} does not enter the circuit through your FOCO, so you cannot bill on its behalf.").format(vector_id),
			frappe.ValidationError,
		)
	return entry


# ---------------------------------------------------------------------------
# Ledger + wallet movements
# ---------------------------------------------------------------------------


def _share_key(trf, line_no, role, beneficiary):
	return f"{trf}:{line_no}:{role}:{beneficiary}"


def record_circuit_bill(trf_name, biller_id, tier_lines, wallet_txn, origin_vector=None):
	"""Write the Posted biller debit and the Pending MF / lab shares for a bill. Idempotent."""
	if not tier_lines:
		return []
	ensure_partner_tier_setup()
	extra = {"origin_vector": origin_vector} if origin_vector and frappe.get_meta(SHARE_DT).has_field("origin_vector") else {}
	created = []
	for line_no, line in enumerate(tier_lines, start=1):
		rows = [
			{
				"role": ROLE_DEBIT,
				"beneficiary": biller_id,
				"amount": line["debit_amount"],
				"status": "Posted",
				"trigger": TRIGGER_BILLING,
				"posted_on": now_datetime(),
				"wallet_transaction": wallet_txn,
			}
		] + [
			{
				"role": share["role"],
				"beneficiary": share["beneficiary"],
				"amount": share["amount"],
				"status": "Pending",
			}
			for share in line["shares"]
		]
		for r in rows:
			key = _share_key(trf_name, line_no, r["role"], r["beneficiary"])
			if frappe.db.exists(SHARE_DT, {"share_key": key}):
				continue
			doc = frappe.get_doc(
				{
					"doctype": SHARE_DT,
					"customer_trf": trf_name,
					"item_code": line["item_code"],
					"line_no": line_no,
					"qty": line["qty"],
					"bill_channel": line.get("channel") or line["tier"],
					"billing_partner": biller_id,
					"share_key": key,
					**extra,
					**r,
				}
			).insert(ignore_permissions=True)
			created.append(doc.name)
	return created


def _move_wallet(fid, delta, txn_type, trf_name, remarks):
	"""Atomic balance change + wallet transaction row. Returns (txn_id, balance_after)."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _record_wallet_transaction

	delta = round(flt(delta), 2)
	frappe.db.sql(
		"UPDATE `tabFranchisee Profile` SET wallet_balance = IFNULL(wallet_balance, 0) + %s WHERE name = %s",
		(delta, fid),
	)
	balance = flt(frappe.db.get_value(PROFILE_DT, fid, "wallet_balance"), 2)
	amount = abs(delta) if txn_type in (ROLE_MF, ROLE_LAB) else delta
	txn = _record_wallet_transaction(
		fid,
		txn_type,
		amount,
		balance,
		reference_doctype="Customer TRF",
		reference_name=trf_name,
		remarks=remarks,
	)
	return txn, balance


def _book_credit(txn):
	if frappe.flags.get("p126_skip_books"):
		return
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_wallet_books import book_wallet_credit

		book_wallet_credit(txn, "commission")
	except Exception:
		frappe.log_error(title="phase126_book_credit", message=frappe.get_traceback())


def _lock_share(name):
	rows = frappe.db.sql(
		f"SELECT name, status FROM `tab{SHARE_DT}` WHERE name = %s FOR UPDATE",
		(name,),
		as_dict=True,
	)
	return rows[0] if rows else None


def _post_share(name, trigger):
	locked = _lock_share(name)
	if not locked or locked.status != "Pending":
		return None
	share = frappe.get_doc(SHARE_DT, name)
	label = {ROLE_MF: "Master FOCO share", ROLE_LAB: "Lab share"}.get(share.role, share.role)
	txn, _balance = _move_wallet(
		share.beneficiary,
		flt(share.amount),
		share.role,
		share.customer_trf,
		_("{0} for bill {1} ({2})").format(label, share.customer_trf, trigger),
	)
	share.db_set(
		{
			"status": "Posted",
			"trigger": trigger,
			"posted_on": now_datetime(),
			"wallet_transaction": txn,
		}
	)
	_book_credit(txn)
	return txn


def _trf_cancelled(trf_name):
	return frappe.db.get_value("Customer TRF", trf_name, "order_status") == "Cancelled"


def post_circuit_shares(trf_name, role, trigger):
	if not trf_name or not frappe.db.exists("DocType", SHARE_DT) or _trf_cancelled(trf_name):
		return []
	names = frappe.get_all(
		SHARE_DT,
		filters={"customer_trf": trf_name, "role": role, "status": "Pending"},
		pluck="name",
	)
	posted = []
	for name in names:
		txn = _post_share(name, trigger)
		if txn:
			posted.append(txn)
	return posted


def on_sample_received_at_lab(trf_name):
	"""Icebox shipment completed: the sample reached the lab → credit the Master FOCO share."""
	try:
		return post_circuit_shares(trf_name, ROLE_MF, TRIGGER_RECEIPT)
	except Exception:
		frappe.log_error(title="phase126_on_receipt", message=frappe.get_traceback())
		return []


def on_report_authorized(trf_name):
	"""Lab completed the report → credit the lab share."""
	try:
		return post_circuit_shares(trf_name, ROLE_LAB, TRIGGER_REPORT)
	except Exception:
		frappe.log_error(title="phase126_on_report", message=frappe.get_traceback())
		return []


def reverse_circuit_for_trf(trf_name, reason=None):
	"""Cancelled bill: drop pending shares, claw back posted shares, refund the biller debit. Idempotent."""
	if not trf_name or not frappe.db.exists("DocType", SHARE_DT):
		return {"reversed": 0}
	reason = reason or _("Bill {0} cancelled").format(trf_name)
	count = 0
	for name in frappe.get_all(
		SHARE_DT,
		filters={"customer_trf": trf_name, "status": ("in", ("Pending", "Posted"))},
		pluck="name",
	):
		locked = _lock_share(name)
		if not locked or locked.status not in ("Pending", "Posted"):
			continue
		share = frappe.get_doc(SHARE_DT, name)
		reversal_txn = None
		if share.status == "Posted":
			if share.role == ROLE_DEBIT:
				delta = flt(share.amount)
				remark = _("Platform fee returned: {0}").format(reason)
			else:
				delta = -flt(share.amount)
				remark = _("{0} reversed: {1}").format(share.role, reason)
			reversal_txn, _balance = _move_wallet(share.beneficiary, delta, "Adjustment", trf_name, remark)
		share.db_set(
			{
				"status": "Reversed",
				"reversal_transaction": reversal_txn,
				"remarks": cstr(reason)[:500],
			}
		)
		count += 1
	if frappe.db.exists("DocType", VBILL_DT):
		for vbill in frappe.get_all(VBILL_DT, filters={"customer_trf": trf_name, "status": ("!=", "Cancelled")}, pluck="name"):
			frappe.db.set_value(VBILL_DT, vbill, {"status": "Cancelled", "remarks": cstr(reason)[:500]})
	return {"reversed": count}


def on_trf_status_change(trf_name, new_status):
	try:
		if new_status == "Cancelled":
			reverse_circuit_for_trf(trf_name)
		elif new_status in RECEIVED_TRF_STATUSES:
			post_circuit_shares(trf_name, ROLE_MF, TRIGGER_RECEIPT)
	except Exception:
		frappe.log_error(title="phase126_trf_status", message=frappe.get_traceback())


def _report_authorized(trf_name):
	if frappe.db.exists("DocType", "Lab Report") and frappe.db.exists(
		"Lab Report", {"customer_trf": trf_name, "report_status": ("in", AUTHORIZED_REPORT_STATUSES)}
	):
		return True
	journey = frappe.db.get_value("Customer TRF", trf_name, "care_journey")
	if journey and frappe.db.get_value("Patient Care Journey", journey, "status") in AUTHORIZED_JOURNEY_STATUSES:
		return True
	return False


def post_due_circuit_shares(limit=500):
	"""Scheduler safety net: post shares whose event already happened, reverse cancelled bills."""
	if not frappe.db.exists("DocType", SHARE_DT):
		return {"ok": True, "skipped": "no ledger"}
	report = {"mf_posted": 0, "lab_posted": 0, "reversed": 0}
	trfs = frappe.get_all(
		SHARE_DT,
		filters={"status": "Pending"},
		fields=["customer_trf"],
		distinct=True,
		limit_page_length=limit,
	)
	for row in trfs:
		trf = row.customer_trf
		status = frappe.db.get_value("Customer TRF", trf, "order_status")
		try:
			if status == "Cancelled":
				report["reversed"] += reverse_circuit_for_trf(trf)["reversed"]
				frappe.db.commit()
				continue
			if status in RECEIVED_TRF_STATUSES:
				report["mf_posted"] += len(post_circuit_shares(trf, ROLE_MF, TRIGGER_RECEIPT))
			if _report_authorized(trf):
				report["lab_posted"] += len(post_circuit_shares(trf, ROLE_LAB, TRIGGER_REPORT))
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="phase126_sweep", message=frappe.get_traceback())
	cancelled_posted = frappe.db.sql(
		f"""
		SELECT DISTINCT s.customer_trf
		FROM `tab{SHARE_DT}` s
		JOIN `tabCustomer TRF` t ON t.name = s.customer_trf
		WHERE s.status = 'Posted' AND t.order_status = 'Cancelled'
		LIMIT %s
		""",
		(cint(limit),),
		as_dict=True,
	)
	for row in cancelled_posted:
		try:
			report["reversed"] += reverse_circuit_for_trf(row.customer_trf)["reversed"]
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="phase126_sweep_cancel", message=frappe.get_traceback())
	return {"ok": True, **report}


# ---------------------------------------------------------------------------
# Portal + admin payloads
# ---------------------------------------------------------------------------


def _share_row(s):
	return {
		"id": s.name,
		"trf": s.customer_trf,
		"item_code": s.item_code,
		"item_name": frappe.db.get_value("Item", s.item_code, "item_name") if s.item_code else None,
		"qty": flt(s.qty) or 1,
		"bill_channel": s.bill_channel,
		"billing_partner": s.billing_partner,
		"beneficiary": s.beneficiary,
		"role": s.role,
		"amount": flt(s.amount),
		"status": s.status,
		"trigger": s.trigger,
		"posted_on": cstr(s.posted_on) if s.posted_on else None,
		"created": cstr(s.creation),
	}


def partner_earnings_payload(fid, limit=200):
	ensure_partner_tier_setup()
	circuit = partner_circuit(fid)
	rows = frappe.get_all(
		SHARE_DT,
		filters={"beneficiary": fid},
		fields=[
			"name",
			"customer_trf",
			"item_code",
			"qty",
			"bill_channel",
			"billing_partner",
			"beneficiary",
			"role",
			"amount",
			"status",
			"trigger",
			"posted_on",
			"creation",
		],
		order_by="creation desc",
		limit_page_length=cint(limit) or 200,
	)
	month = cstr(now_datetime())[:7]
	kpis = {
		"pending_mf": 0.0,
		"pending_lab": 0.0,
		"credited_month": 0.0,
		"debited_month": 0.0,
		"bills_month": 0,
	}
	bills = {}
	for r in rows:
		amt = flt(r.amount)
		in_month = cstr(r.posted_on or r.creation)[:7] == month
		if r.status == "Pending" and r.role == ROLE_MF:
			kpis["pending_mf"] += amt
		if r.status == "Pending" and r.role == ROLE_LAB:
			kpis["pending_lab"] += amt
		if r.status == "Posted" and in_month:
			if r.role == ROLE_DEBIT:
				kpis["debited_month"] += amt
			else:
				kpis["credited_month"] += amt
	# Bills this partner generated: show the whole circuit for each.
	billed = frappe.get_all(
		SHARE_DT,
		filters={"billing_partner": fid},
		fields=["name", "customer_trf", "item_code", "qty", "bill_channel", "billing_partner", "beneficiary", "role", "amount", "status", "trigger", "posted_on", "creation"],
		order_by="creation desc",
		limit_page_length=cint(limit) or 200,
	)
	for r in list(billed) + list(rows):
		b = bills.setdefault(
			r.customer_trf,
			{"trf": r.customer_trf, "channel": r.bill_channel, "created": cstr(r.creation), "lines": {}, "billed_by_me": r.billing_partner == fid},
		)
		b["lines"][r.name] = _share_row(r)
	bill_list = []
	for b in bills.values():
		lines = list(b["lines"].values())
		debit = sum(l["amount"] for l in lines if l["role"] == ROLE_DEBIT)
		mf = [l for l in lines if l["role"] == ROLE_MF]
		lab = [l for l in lines if l["role"] == ROLE_LAB]
		tests = sorted({l["item_name"] or l["item_code"] for l in lines if l["item_code"]})
		bill_list.append(
			{
				"trf": b["trf"],
				"channel": b["channel"],
				"created": b["created"],
				"billed_by_me": b["billed_by_me"],
				"tests": ", ".join(t for t in tests if t),
				"debit": round(debit, 2),
				"mf_share": round(sum(l["amount"] for l in mf), 2),
				"mf_status": _combined_status(mf),
				"mf_beneficiary": mf[0]["beneficiary"] if mf else None,
				"lab_share": round(sum(l["amount"] for l in lab), 2),
				"lab_status": _combined_status(lab),
				"lab_beneficiary": lab[0]["beneficiary"] if lab else None,
			}
		)
	bill_list.sort(key=lambda r: r["created"], reverse=True)
	kpis = {k: round(v, 2) if isinstance(v, float) else v for k, v in kpis.items()}
	kpis["bills_month"] = sum(1 for b in bill_list if b["created"][:7] == month)
	return {
		"circuit": circuit,
		"kpis": kpis,
		"bills": bill_list[: cint(limit) or 200],
		"wallet_balance": flt(frappe.db.get_value(PROFILE_DT, fid, "wallet_balance"), 2),
	}


def _combined_status(lines):
	if not lines:
		return None
	statuses = {l["status"] for l in lines}
	if statuses == {"Posted"}:
		return "Posted"
	if statuses == {"Reversed"}:
		return "Reversed"
	if "Pending" in statuses:
		return "Pending"
	return sorted(statuses)[0]


def _require_admin(roles):
	if not set(roles or []) & ADMIN_ROLES:
		frappe.throw(_("Only system admins can change partner circuits or tier rates"), frappe.PermissionError)


def map_partner_circuit(roles, data):
	"""Admin / onboarding: set tier, mapping, has_lab and service flags on a partner."""
	_require_admin(roles)
	ensure_partner_tier_setup()
	data = data or {}
	fid = cstr(data.get("franchisee") or "").strip()
	if not fid or not frappe.db.exists(PROFILE_DT, fid):
		frappe.throw(_("Partner (Franchisee Profile) not found"))
	tier = cstr(data.get("partner_tier") or "").strip()
	if tier not in TIERS:
		frappe.throw(_("Partner tier must be one of {0}").format(", ".join(TIERS)))
	values = {"partner_tier": tier, "circuit_mapped_on": now_datetime()}
	for key in ("has_lab", "svc_phlebotomy", "svc_lr_logistics", "svc_lab_team"):
		if key in data:
			values[key] = 1 if cint(data.get(key)) else 0
	master = cstr(data.get("mapped_master_foco") or "").strip() or None
	lab = cstr(data.get("mapped_orange_lab") or "").strip() or None
	if tier == TIER_ORANGE and cint(data.get("svc_phlebotomy")):
		# Orange FOCO + FOCO module = FOCO with own lab.
		tier = TIER_FOCO
		values["partner_tier"] = TIER_FOCO
		values["has_lab"] = 1
	values["mapped_master_foco"] = master if tier == TIER_FOCO else None
	values["mapped_orange_lab"] = lab if tier == TIER_MF else None
	frappe.flags.allow_partner_circuit_remap = True
	try:
		doc = frappe.get_doc(PROFILE_DT, fid)
		doc.update(values)
		doc.save(ignore_permissions=True)
	finally:
		frappe.flags.allow_partner_circuit_remap = False
	frappe.db.commit()
	clear_tier_caches()
	return partner_circuit(fid)


def validate_partner_circuit(doc):
	"""Franchisee Profile validate hook: tier-consistent mapping, locked after first save for non-admins."""
	meta = frappe.get_meta(PROFILE_DT)
	if not meta.has_field("partner_tier"):
		return
	tier = cstr(doc.get("partner_tier")).strip()
	if tier == TIER_ORANGE and cint(doc.get("svc_phlebotomy")):
		# Orange FOCO + FOCO module is the same partner as a FOCO with own lab.
		doc.partner_tier = tier = TIER_FOCO
		doc.has_lab = 1
		doc.mapped_orange_lab = None
	if tier == TIER_FOCO and meta.has_field("svc_phlebotomy"):
		# A FOCO is the FOCO module: phlebotomy is always on.
		doc.svc_phlebotomy = 1
	master = cstr(doc.get("mapped_master_foco")).strip()
	lab = cstr(doc.get("mapped_orange_lab")).strip()
	if master and master == doc.name:
		frappe.throw(_("A partner cannot be mapped to itself"))
	if lab and lab == doc.name:
		frappe.throw(_("A partner cannot be mapped to itself"))
	if master:
		if tier != TIER_FOCO:
			frappe.throw(_("Only a FOCO maps to a Master FOCO"))
		if cstr(frappe.db.get_value(PROFILE_DT, master, "partner_tier")).strip() != TIER_MF:
			frappe.throw(_("{0} is not a Master FOCO").format(master))
	if lab:
		if tier != TIER_MF:
			frappe.throw(_("Only a Master FOCO maps to an Orange FOCO / lab"))
		lab_row = frappe.db.get_value(PROFILE_DT, lab, ["partner_tier", "has_lab"], as_dict=True) or {}
		if cstr(lab_row.get("partner_tier")).strip() != TIER_ORANGE and not cint(lab_row.get("has_lab")):
			frappe.throw(_("{0} is not an Orange FOCO / lab").format(lab))
	entry = cstr(doc.get("vector_entry_partner")).strip() if meta.has_field("vector_entry_partner") else ""
	if entry:
		if cstr(doc.get("franchisee_type")).strip() != VECTOR_TYPE:
			frappe.throw(_("Only a Vector franchisee maps to a circuit entry partner"))
		if tier:
			frappe.throw(_("A Vector is a B2B client, not a circuit partner: clear its Partner Tier"))
		if entry == doc.name:
			frappe.throw(_("A partner cannot be mapped to itself"))
		if cstr(frappe.db.get_value(PROFILE_DT, entry, "partner_tier")).strip() not in TIERS:
			frappe.throw(_("{0} is not a FOCO, Master FOCO or Orange FOCO").format(entry))
	if doc.is_new() or frappe.flags.allow_partner_circuit_remap:
		return
	if set(frappe.get_roles()) & ADMIN_ROLES:
		return
	before = doc.get_doc_before_save()
	if not before:
		return
	for field in ("partner_tier", "mapped_master_foco", "mapped_orange_lab", "has_lab", "svc_phlebotomy", "vector_entry_partner"):
		if cstr(before.get(field)) and cstr(before.get(field)) != cstr(doc.get(field)):
			frappe.throw(_("Partner circuit mapping is set at onboarding; only admins can change it"), frappe.PermissionError)


def save_partner_tier_rate(roles, data):
	_require_admin(roles)
	ensure_partner_tier_setup()
	data = data or {}
	item = cstr(data.get("item_code") or "").strip()
	tier = cstr(data.get("tier") or "").strip()
	if not item or not frappe.db.exists("Item", item):
		frappe.throw(_("Test item not found"))
	if tier not in TIERS:
		frappe.throw(_("Tier must be one of {0}").format(", ".join(TIERS)))
	billing = flt(data.get("billing_rate"))
	fee = flt(data.get("platform_fee"))
	if billing < 0 or fee < 0 or fee > billing:
		frappe.throw(_("Platform fee must be between 0 and the billing rate"))
	name = frappe.db.get_value(RATE_DT, {"item_code": item, "tier": tier}, "name")
	values = {"billing_rate": billing, "platform_fee": fee, "active": 1 if cint(data.get("active", 1)) else 0}
	if name:
		doc = frappe.get_doc(RATE_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": RATE_DT, "item_code": item, "tier": tier, **values}).insert(ignore_permissions=True)
	frappe.db.commit()
	clear_tier_caches()
	return {"rate": doc.name, "item_code": item, "tier": tier, **values}


def smoke_partner_circuit(item_code=None):
	"""Run the seven FBG circuit scenarios on throwaway partners, then roll everything back."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import debit_b2b_wallet_platform_fee

	setup = setup_phase126(item_code)
	item_code = (setup.get("seed") or {}).get("item_code")
	if not item_code:
		return {"ok": False, "setup": setup}
	frappe.db.commit()

	result = {"ok": True, "item_code": item_code, "checks": []}

	def check(name, got, want):
		ok = abs(flt(got) - flt(want)) < 0.005
		result["checks"].append({"name": name, "got": round(flt(got), 2), "want": want, "pass": ok})
		if not ok:
			result["ok"] = False

	def bal(fid):
		return flt(frappe.db.get_value(PROFILE_DT, fid, "wallet_balance"), 2)

	frappe.flags.p126_skip_books = True
	frappe.flags.allow_partner_circuit_remap = True
	clear_tier_caches()
	try:
		def make(code, tier, has_lab=0, master=None, lab=None, phlebotomy=0):
			doc = frappe.get_doc(
				{
					"doctype": PROFILE_DT,
					"franchise_name": f"P126 Smoke {code}",
					"branch_code": code,
					"owner_name": "Smoke",
					"franchisee_type": "Pulse",
					"commission_percentage_rate": 0,
					"commission_base": "Franchisee Rate",
					"wallet_balance": 1000,
					"active_status": "Active",
					"partner_tier": tier,
					"has_lab": has_lab,
					"mapped_master_foco": master,
					"mapped_orange_lab": lab,
					"svc_phlebotomy": phlebotomy,
				}
			)
			doc.insert(ignore_permissions=True)
			return doc.name

		orange = make("P126SMK-OR", TIER_ORANGE)
		mf = make("P126SMK-MF", TIER_MF, lab=orange)
		mf_lab = make("P126SMK-MFL", TIER_MF, has_lab=1, lab=orange)
		foco = make("P126SMK-FO", TIER_FOCO, master=mf)
		foco_lab = make("P126SMK-FOL", TIER_FOCO, has_lab=1, master=mf)

		from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import line_settlement

		priced = line_settlement(item_code, franchisee_id=foco)
		check("FOCO patient price = FOCO billing rate", priced["rate"], 28.0)
		check("FOCO catalog platform fee = deposit debit", priced["platform_fee"], 19.60)
		check("FOCO+lab catalog platform fee", line_settlement(item_code, franchisee_id=foco_lab)["platform_fee"], 15.60)
		check("MF catalog platform fee", line_settlement(item_code, franchisee_id=mf)["platform_fee"], 16.80)
		check("FOCO always has the FOCO module", cint(frappe.db.get_value(PROFILE_DT, foco, "svc_phlebotomy")), 1)

		def blocked(fid):
			try:
				assert_can_bill_patient(fid)
				return 0
			except frappe.ValidationError:
				return 1

		mf_foco = make("P126SMK-MFF", TIER_MF, lab=orange, phlebotomy=1)
		orange_foco = make("P126SMK-ORF", TIER_ORANGE, phlebotomy=1)
		check("FOCO may bill patients", blocked(foco), 0)
		check("MF without FOCO module blocked from patient billing", blocked(mf), 1)
		check("Orange without FOCO module blocked from patient billing", blocked(orange), 1)
		check("MF with FOCO module may bill patients", blocked(mf_foco), 0)
		check("Orange with FOCO module may bill patients", blocked(orange_foco), 0)
		check("MF with FOCO module patient price", line_settlement(item_code, franchisee_id=mf_foco)["rate"], 28.0)
		check("MF with FOCO module debit", line_settlement(item_code, franchisee_id=mf_foco)["platform_fee"], 16.80)
		stored = frappe.db.get_value(PROFILE_DT, orange_foco, ["partner_tier", "has_lab"], as_dict=True)
		check("Orange + FOCO module saved as FOCO", 1 if stored.partner_tier == TIER_FOCO else 0, 1)
		check("Orange + FOCO module saved with own lab", cint(stored.has_lab), 1)
		try:
			tier_settlement(item_code, orange_foco, 1)
			check("Orange + FOCO module needs a Master FOCO (like FOCO with lab)", 0, 1)
		except frappe.ValidationError:
			check("Orange + FOCO module needs a Master FOCO (like FOCO with lab)", 1, 1)
		orange_foco_mf = make("P126SMK-ORM", TIER_ORANGE, phlebotomy=1)
		frappe.db.set_value(PROFILE_DT, orange_foco_mf, "mapped_master_foco", mf)
		clear_tier_caches()
		ofm = tier_settlement(item_code, orange_foco_mf, 1)
		check("Orange + FOCO module = FOCO with lab: debit", ofm["debit_amount"], 15.60)
		check(
			"Orange + FOCO module = FOCO with lab: MF +2.80",
			sum(s["amount"] for s in ofm["shares"] if s["role"] == ROLE_MF and s["beneficiary"] == mf),
			2.80,
		)
		check("Orange + FOCO module = FOCO with lab: no lab share", sum(s["amount"] for s in ofm["shares"] if s["role"] == ROLE_LAB), 0)
		check("Orange + FOCO module patient price", line_settlement(item_code, franchisee_id=orange_foco_mf)["rate"], 28.0)
		mf_all = make("P126SMK-MFA", TIER_MF, has_lab=1, lab=orange, phlebotomy=1)
		check("MF + FOCO + lab debit", line_settlement(item_code, franchisee_id=mf_all)["platform_fee"], 12.80)
		check("MF + FOCO debit", line_settlement(item_code, franchisee_id=mf_foco)["platform_fee"], 16.80)

		seq = {"n": 0}

		def bill(biller):
			seq["n"] += 1
			trf = frappe.get_doc(
				{
					"doctype": "Customer TRF",
					"patient_name": "P126 Smoke Patient",
					"age": 30,
					"gender": "Male",
					"test_required": item_code,
					"unique_barcode": f"P126SMK{frappe.generate_hash(length=6).upper()}{seq['n']}",
					"franchisee_id": biller,
					"tests": [{"item": item_code, "qty": 1, "rate": 28, "amount": 28}],
					"amount": 28,
					"order_status": "Booked",
					"platform_billed": 0,
				}
			)
			trf.insert(ignore_permissions=True)
			line = tier_settlement(item_code, biller, 1)
			txn = debit_b2b_wallet_platform_fee(biller, line["debit_amount"], trf.name)
			record_circuit_bill(trf.name, biller, [line], txn)
			return trf.name

		def run_events(trf):
			on_sample_received_at_lab(trf)
			on_report_authorized(trf)

		# 1. FOCO bills
		b0 = {k: bal(k) for k in (foco, mf, orange)}
		t = bill(foco)
		check("FOCO debit", b0[foco] - bal(foco), 19.60)
		check("FOCO: MF pending before receipt", bal(mf) - b0[mf], 0)
		on_sample_received_at_lab(t)
		check("FOCO: MF +2.80 on lab receipt", bal(mf) - b0[mf], 2.80)
		check("FOCO: lab pending before report", bal(orange) - b0[orange], 0)
		on_report_authorized(t)
		check("FOCO: lab +4.00 on report", bal(orange) - b0[orange], 4.00)
		run_events(t)
		check("FOCO: idempotent MF", bal(mf) - b0[mf], 2.80)
		check("FOCO: idempotent lab", bal(orange) - b0[orange], 4.00)

		# 2. FOCO with own lab
		b0 = {k: bal(k) for k in (foco_lab, mf, orange)}
		t = bill(foco_lab)
		run_events(t)
		check("FOCO+lab debit", b0[foco_lab] - bal(foco_lab), 15.60)
		check("FOCO+lab: MF +2.80", bal(mf) - b0[mf], 2.80)
		check("FOCO+lab: no lab credit", bal(orange) - b0[orange], 0)

		# 3. Master FOCO bills
		b0 = {k: bal(k) for k in (mf, orange)}
		t = bill(mf)
		run_events(t)
		check("MF debit", b0[mf] - bal(mf), 16.80)
		check("MF: lab +4.00", bal(orange) - b0[orange], 4.00)

		# 4. Master FOCO with own lab
		b0 = {k: bal(k) for k in (mf_lab, orange)}
		t = bill(mf_lab)
		run_events(t)
		check("MF+lab debit", b0[mf_lab] - bal(mf_lab), 12.80)
		check("MF+lab: no lab credit", bal(orange) - b0[orange], 0)

		# 5. Orange bills
		b0 = bal(orange)
		t = bill(orange)
		run_events(t)
		check("Orange debit", b0 - bal(orange), 6.00)

		# B2B accession + icebox shipment by the Master FOCO (record only), received by the lab
		b0 = {k: bal(k) for k in (foco, mf, orange)}
		t = bill(foco)
		check("Shipment: bill is pending accession at MF", 1 if any(p["trf"] == t for p in pending_accession_samples(mf)) else 0, 1)
		ship = create_partner_shipment(mf, {"trfs": [t], "lr_number": "P126-LR", "courier": "Smoke", "icebox_temp_c": 4})
		check("Shipment record moves no money (MF)", bal(mf) - b0[mf], 0)
		check("Shipment record moves no money (FOCO beyond debit)", b0[foco] - bal(foco), 19.60)
		receive_partner_shipment(orange, ship["shipment"]["id"])
		check("Lab receipt of shipment credits MF +2.80", bal(mf) - b0[mf], 2.80)
		receive_partner_shipment(orange, ship["shipment"]["id"])
		on_sample_received_at_lab(t)
		check("Shipment receipt idempotent", bal(mf) - b0[mf], 2.80)
		try:
			receive_partner_shipment(mf, ship["shipment"]["id"])
			check("Only receiving lab confirms shipment", 0, 1)
		except frappe.PermissionError:
			check("Only receiving lab confirms shipment", 1, 1)

		# 6. Cancel before shares post
		b0 = {k: bal(k) for k in (foco, mf, orange)}
		t = bill(foco)
		frappe.db.set_value("Customer TRF", t, "order_status", "Cancelled")
		reverse_circuit_for_trf(t)
		run_events(t)
		check("Cancel-before: FOCO net 0", bal(foco) - b0[foco], 0)
		check("Cancel-before: MF net 0", bal(mf) - b0[mf], 0)
		check("Cancel-before: lab net 0", bal(orange) - b0[orange], 0)

		# 7. Cancel after shares post
		b0 = {k: bal(k) for k in (foco, mf, orange)}
		t = bill(foco)
		run_events(t)
		frappe.db.set_value("Customer TRF", t, "order_status", "Cancelled")
		reverse_circuit_for_trf(t)
		reverse_circuit_for_trf(t)
		check("Cancel-after: FOCO net 0", bal(foco) - b0[foco], 0)
		check("Cancel-after: MF net 0", bal(mf) - b0[mf], 0)
		check("Cancel-after: lab net 0", bal(orange) - b0[orange], 0)

		# ---- Vector (doctor / pharmacy) B2B entry -------------------------------------------------
		from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import finalize_hub_b2b_settlement

		def make_vector(code, entry=None):
			doc = frappe.get_doc(
				{
					"doctype": PROFILE_DT,
					"franchise_name": f"P126 Smoke {code}",
					"branch_code": code,
					"owner_name": "Smoke",
					"franchisee_type": VECTOR_TYPE,
					"commission_percentage_rate": 0,
					"commission_base": "Franchisee Rate",
					"wallet_balance": 1000,
					"active_status": "Active",
					"vector_entry_partner": entry,
				}
			)
			doc.insert(ignore_permissions=True)
			return doc.name

		def vector_bill(vector, billed_by=None):
			seq["n"] += 1
			trf = frappe.get_doc(
				{
					"doctype": "Customer TRF",
					"patient_name": "P126 Smoke Vector Patient",
					"age": 40,
					"gender": "Female",
					"test_required": item_code,
					"unique_barcode": f"P126SMKV{frappe.generate_hash(length=6).upper()}{seq['n']}",
					"franchisee_id": vector,
					"tests": [{"item": item_code, "qty": 1, "rate": 70, "amount": 70}],
					"amount": 70,
					"order_status": "Booked",
					"platform_billed": 0,
				}
			)
			trf.insert(ignore_permissions=True)
			res = finalize_hub_b2b_settlement(trf.name, vector, billed_by=billed_by)
			return trf.name, res

		def vbill(trf):
			return frappe.db.get_value(VBILL_DT, {"customer_trf": trf}, ["amount", "status", "entry_partner", "billed_by"], as_dict=True) or {}

		v_foco = make_vector("P126SMK-VF", foco)
		v_mf = make_vector("P126SMK-VM", mf)
		v_lab = make_vector("P126SMK-VO", orange)
		v_free = make_vector("P126SMK-VU")
		clear_tier_caches()

		check("Vector→FOCO patient price stays MRP", line_settlement(item_code, franchisee_id=v_foco)["rate"], 70.0)
		check("Vector→FOCO fee shown = B2B 28", line_settlement(item_code, franchisee_id=v_foco)["platform_fee"], 28.0)
		check("Vector→Master fee shown = B2B 14", line_settlement(item_code, franchisee_id=v_mf)["platform_fee"], 14.0)
		check("Vector→Lab fee shown = B2B 10", line_settlement(item_code, franchisee_id=v_lab)["platform_fee"], 10.0)
		check("Unmapped Vector stays on normal Vector billing", 1 if vector_tier_settlement(item_code, v_free, 1) is None else 0, 1)

		# Vector enters via FOCO (Vector creates the bill)
		b0 = {k: bal(k) for k in (foco, mf, orange, v_foco)}
		t, res = vector_bill(v_foco)
		check("Vector→FOCO: FOCO deposit −19.60", b0[foco] - bal(foco), 19.60)
		check("Vector→FOCO: Vector wallet untouched", bal(v_foco) - b0[v_foco], 0)
		check("Vector→FOCO: B2B bill 28 to Vector", vbill(t).get("amount"), 28.0)
		check("Vector→FOCO: B2B bill unsettled", 1 if vbill(t).get("status") == "Unsettled" else 0, 1)
		check("Vector→FOCO: dummy patient bill, no invoices", 1 if (res.get("dummy_patient_bill") and not res.get("platform_invoice")) else 0, 1)
		run_events(t)
		check("Vector→FOCO: MF +2.80 on receipt", bal(mf) - b0[mf], 2.80)
		check("Vector→FOCO: lab +4.00 on report", bal(orange) - b0[orange], 4.00)

		# FOCO raises the bill on the Vector's behalf
		try:
			assert_foco_can_bill_vector(foco_lab, v_foco)
			check("Bill to Vector refused for a FOCO the Vector does not enter", 0, 1)
		except frappe.ValidationError:
			check("Bill to Vector refused for a FOCO the Vector does not enter", 1, 1)
		check("Bill to Vector options list the Vector", 1 if any(v["id"] == v_foco for v in vector_bill_to_options(foco)) else 0, 1)
		b0 = bal(foco)
		assert_foco_can_bill_vector(foco, v_foco)
		t, _res = vector_bill(v_foco, billed_by=foco)
		check("FOCO Bill to Vector: FOCO deposit −19.60", b0 - bal(foco), 19.60)
		check("FOCO Bill to Vector: bill created by FOCO", 1 if vbill(t).get("billed_by") == foco else 0, 1)
		check("FOCO Bill to Vector: TRF records the FOCO", 1 if frappe.db.get_value("Customer TRF", t, "circuit_billed_by") == foco else 0, 1)

		# Vector enters via Master FOCO (accession only)
		b0 = {k: bal(k) for k in (mf, orange, v_mf)}
		t, _res = vector_bill(v_mf)
		check("Vector→Master: Master deposit −11.20", b0[mf] - bal(mf), 11.20)
		check("Vector→Master: B2B bill 14 to Vector", vbill(t).get("amount"), 14.0)
		check("Vector→Master: pending at Master accession", 1 if any(p["trf"] == t for p in pending_accession_samples(mf)) else 0, 1)
		on_sample_received_at_lab(t)
		check("Vector→Master: nothing extra to Master on receipt", b0[mf] - bal(mf), 11.20)
		on_report_authorized(t)
		check("Vector→Master: lab +4.00 on report", bal(orange) - b0[orange], 4.00)
		check("Vector→Master: Vector wallet untouched", bal(v_mf) - b0[v_mf], 0)

		# Vector enters via the lab
		b0 = {k: bal(k) for k in (orange, v_lab)}
		t, _res = vector_bill(v_lab)
		run_events(t)
		check("Vector→Lab: lab deposit −6.00", b0[orange] - bal(orange), 6.00)
		check("Vector→Lab: B2B bill 10 to Vector", vbill(t).get("amount"), 10.0)

		# Cancelling a Vector bill reverses the entry partner and cancels the B2B bill
		b0 = {k: bal(k) for k in (foco, mf, orange)}
		t, _res = vector_bill(v_foco)
		run_events(t)
		frappe.db.set_value("Customer TRF", t, "order_status", "Cancelled")
		reverse_circuit_for_trf(t)
		check("Vector cancel: FOCO net 0", bal(foco) - b0[foco], 0)
		check("Vector cancel: MF net 0", bal(mf) - b0[mf], 0)
		check("Vector cancel: lab net 0", bal(orange) - b0[orange], 0)
		check("Vector cancel: B2B bill cancelled", 1 if vbill(t).get("status") == "Cancelled" else 0, 1)

		# Unmapped FOCO must not bill on the circuit
		lonely = make("P126SMK-FX", TIER_FOCO)
		try:
			tier_settlement(item_code, lonely, 1)
			check("Unmapped FOCO blocked", 0, 1)
		except frappe.ValidationError:
			check("Unmapped FOCO blocked", 1, 1)
	except Exception:
		result["ok"] = False
		result["error"] = frappe.get_traceback()[-2000:]
	finally:
		frappe.flags.p126_skip_books = False
		frappe.flags.allow_partner_circuit_remap = False
		frappe.db.rollback()
		result["cleanup"] = _cleanup_smoke()
	result["passed"] = sum(1 for c in result["checks"] if c["pass"])
	result["total"] = len(result["checks"])
	return result


# ---------------------------------------------------------------------------
# B2B accession & icebox shipment (record only — no new charge)
# ---------------------------------------------------------------------------


def _trf_summary(trf):
	trf_meta = frappe.get_meta("Customer TRF")
	row = frappe.db.get_value(
		"Customer TRF",
		trf,
		["name", "patient_name", "order_status", "franchisee_id", "creation"]
		+ [f for f in ("vector_partner", "circuit_entry_partner") if trf_meta.has_field(f)],
		as_dict=True,
	)
	if not row:
		return None
	vector = row.get("vector_partner")
	tests = frappe.get_all(
		"TRF Test Item",
		filters={"parent": trf, "parenttype": "Customer TRF"},
		pluck="item",
		order_by="idx asc",
	)
	names = [frappe.db.get_value("Item", t, "item_name") or t for t in tests if t]
	return {
		"trf": row.name,
		"patient_name": row.patient_name,
		"order_status": row.order_status,
		"billed_by": row.franchisee_id,
		"billed_by_name": frappe.db.get_value(PROFILE_DT, row.franchisee_id, "franchise_name") if row.franchisee_id else None,
		"tests": ", ".join(names),
		"created": cstr(row.creation),
		"via_vector": vector or None,
		"via_vector_name": frappe.db.get_value(PROFILE_DT, vector, "franchise_name") if vector else None,
	}


def _shipped_trfs(shipper):
	if not frappe.db.exists("DocType", SHIP_DT):
		return set()
	return set(
		frappe.db.sql_list(
			f"""
			SELECT r.customer_trf
			FROM `tab{SHIP_ROW_DT}` r
			JOIN `tab{SHIP_DT}` s ON s.name = r.parent
			WHERE s.shipper = %s AND s.status != 'Cancelled'
			""",
			(shipper,),
		)
	)


def pending_accession_samples(fid, limit=300):
	"""Circuit samples awaiting this Master / Orange FOCO's accession (its share is still pending)."""
	circuit = _cached_circuit(fid)
	tier = circuit.get("tier")
	if tier not in (TIER_MF, TIER_ORANGE) and not circuit.get("has_lab"):
		return []
	role = ROLE_MF if tier == TIER_MF else ROLE_LAB
	trfs = [
		r.customer_trf
		for r in frappe.get_all(
			SHARE_DT,
			filters={"beneficiary": fid, "role": role, "status": "Pending"},
			fields=["customer_trf"],
			distinct=True,
			order_by="creation desc",
			limit_page_length=limit,
		)
	]
	# Vector (doctor / pharmacy) samples that entered the circuit at this Master FOCO / lab: accession only.
	if frappe.get_meta("Customer TRF").has_field("circuit_entry_partner"):
		trfs += frappe.get_all(
			"Customer TRF",
			filters={"circuit_entry_partner": fid, "order_status": ("!=", "Cancelled")},
			pluck="name",
			order_by="creation desc",
			limit_page_length=limit,
		)
	shipped = _shipped_trfs(fid)
	out = []
	seen = set()
	for name in trfs:
		if name in shipped or name in seen:
			continue
		seen.add(name)
		s = _trf_summary(name)
		if s and s["order_status"] != "Cancelled":
			out.append(s)
	return out


def _shipment_row(doc):
	return {
		"id": doc.name,
		"shipper": doc.shipper,
		"shipper_name": frappe.db.get_value(PROFILE_DT, doc.shipper, "franchise_name"),
		"to_lab": doc.to_lab,
		"to_lab_name": frappe.db.get_value(PROFILE_DT, doc.to_lab, "franchise_name") if doc.to_lab else None,
		"status": doc.status,
		"lr_number": doc.lr_number,
		"courier": doc.courier,
		"icebox_temp_c": doc.icebox_temp_c,
		"shipped_on": cstr(doc.shipped_on) if doc.shipped_on else None,
		"delivered_on": cstr(doc.delivered_on) if doc.delivered_on else None,
		"sample_count": cint(doc.sample_count),
		"samples": [
			{"trf": r.customer_trf, "patient_name": r.patient_name, "tests": r.tests, "from_partner": r.from_partner}
			for r in (doc.get("samples") or [])
		],
	}


def partner_shipments_payload(fid, limit=100):
	ensure_partner_tier_setup()
	circuit = _cached_circuit(fid)
	outgoing = [
		_shipment_row(frappe.get_doc(SHIP_DT, n))
		for n in frappe.get_all(SHIP_DT, filters={"shipper": fid}, pluck="name", order_by="creation desc", limit_page_length=limit)
	]
	incoming = [
		_shipment_row(frappe.get_doc(SHIP_DT, n))
		for n in frappe.get_all(
			SHIP_DT,
			filters={"to_lab": fid, "shipper": ("!=", fid)},
			pluck="name",
			order_by="creation desc",
			limit_page_length=limit,
		)
	]
	return {
		"circuit": circuit,
		"can_ship": circuit.get("tier") in (TIER_MF, TIER_ORANGE) or bool(circuit.get("has_lab")),
		"pending": pending_accession_samples(fid),
		"outgoing": outgoing,
		"incoming": incoming,
	}


def create_partner_shipment(fid, data):
	"""Accession circuit samples and record the icebox shipment to the lab. No deposit movement here.

	A Master FOCO ships to its mapped lab (status Shipped; the lab confirms receipt). An Orange FOCO / own lab
	accessions at its own bench, so the record is received immediately.
	"""
	ensure_partner_tier_setup()
	circuit = _cached_circuit(fid)
	tier = circuit.get("tier")
	if tier not in (TIER_MF, TIER_ORANGE) and not circuit.get("has_lab"):
		frappe.throw(_("Only a Master FOCO or Orange FOCO / lab can accession and ship circuit samples"))
	data = data or {}
	wanted = [cstr(t).strip() for t in (data.get("trfs") or []) if cstr(t).strip()]
	if not wanted:
		frappe.throw(_("Select at least one sample"))
	pending = {p["trf"]: p for p in pending_accession_samples(fid, limit=1000)}
	missing = [t for t in wanted if t not in pending]
	if missing:
		frappe.throw(_("These bills are not awaiting your accession: {0}").format(", ".join(missing[:10])))
	self_lab = tier == TIER_ORANGE or bool(circuit.get("has_lab"))
	to_lab = circuit.get("lab") if not self_lab else fid
	if not to_lab:
		frappe.throw(_("No lab is mapped for this Master FOCO. Map the partner circuit first."))
	now = now_datetime()
	doc = frappe.get_doc(
		{
			"doctype": SHIP_DT,
			"shipper": fid,
			"shipper_tier": tier,
			"to_lab": to_lab,
			"status": "Delivered" if self_lab else "Shipped",
			"lr_number": cstr(data.get("lr_number") or "").strip()[:140],
			"courier": cstr(data.get("courier") or "").strip()[:140],
			"icebox_temp_c": flt(data.get("icebox_temp_c")) if data.get("icebox_temp_c") not in (None, "") else None,
			"shipped_on": now,
			"delivered_on": now if self_lab else None,
			"received_by": frappe.session.user if self_lab else None,
			"sample_count": len(wanted),
			"remarks": cstr(data.get("remarks") or "")[:500],
			"samples": [
				{
					"customer_trf": t,
					"patient_name": pending[t]["patient_name"],
					"tests": cstr(pending[t]["tests"])[:140],
					"from_partner": pending[t]["billed_by"],
				}
				for t in wanted
			],
		}
	).insert(ignore_permissions=True)
	posted = []
	if self_lab:
		for t in wanted:
			posted += post_circuit_shares(t, ROLE_MF, TRIGGER_RECEIPT)
	frappe.db.commit()
	return {"shipment": _shipment_row(doc), "mf_credits_posted": len(posted)}


def receive_partner_shipment(fid, shipment, roles=None):
	"""The receiving lab confirms the icebox arrived: shipment complete → Master FOCO share credits."""
	if not shipment or not frappe.db.exists(SHIP_DT, shipment):
		frappe.throw(_("Shipment not found"))
	doc = frappe.get_doc(SHIP_DT, shipment)
	if doc.to_lab != fid and not set(roles or []) & ADMIN_ROLES:
		frappe.throw(_("Only the receiving lab can confirm this shipment"), frappe.PermissionError)
	if doc.status == "Cancelled":
		frappe.throw(_("This shipment was cancelled"))
	posted = []
	if doc.status != "Delivered":
		doc.db_set({"status": "Delivered", "delivered_on": now_datetime(), "received_by": frappe.session.user})
	for row in doc.get("samples") or []:
		posted += post_circuit_shares(row.customer_trf, ROLE_MF, TRIGGER_RECEIPT)
	frappe.db.commit()
	doc.reload()
	return {"shipment": _shipment_row(doc), "mf_credits_posted": len(posted)}


def _cleanup_smoke():
	"""Remove any smoke partners / bills that survived the rollback (e.g. an inner commit)."""
	partners = frappe.get_all(PROFILE_DT, filters={"name": ("like", "P126SMK-%")}, pluck="name")
	if not partners:
		frappe.db.commit()
		return {"partners": 0}
	trfs = frappe.get_all("Customer TRF", filters={"franchisee_id": ("in", partners)}, pluck="name")
	if frappe.db.exists("DocType", SHIP_DT):
		for name in frappe.get_all(SHIP_DT, filters={"shipper": ("in", partners)}, pluck="name"):
			frappe.delete_doc(SHIP_DT, name, force=1, ignore_permissions=True)
	if frappe.db.exists("DocType", VBILL_DT):
		frappe.db.delete(VBILL_DT, {"vector": ("in", partners)})
		frappe.db.delete(VBILL_DT, {"entry_partner": ("in", partners)})
	for dt, field, values in (
		(SHARE_DT, "beneficiary", partners),
		(WALLET_DT, "franchisee", partners),
	):
		if frappe.db.exists("DocType", dt):
			frappe.db.delete(dt, {field: ("in", values)})
	for name in trfs:
		frappe.delete_doc("Customer TRF", name, force=1, ignore_permissions=True)
	for name in partners:
		frappe.delete_doc(PROFILE_DT, name, force=1, ignore_permissions=True)
	frappe.db.commit()
	return {"partners": len(partners), "trfs": len(trfs)}


def list_partner_tier_rates(item_code=None):
	ensure_partner_tier_setup()
	filters = {"item_code": item_code} if item_code else {}
	return frappe.get_all(
		RATE_DT,
		filters=filters,
		fields=["name", "item_code", "item_name", "tier", "billing_rate", "platform_fee", "active"],
		order_by="item_code asc, tier asc",
		limit_page_length=500,
	)
