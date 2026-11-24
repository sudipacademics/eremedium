"""ERPNext stock records for the Operations pharmacy, kept in step in both directions.

Record system in the ERP (company `COMPANY`): a "Pharmacy" warehouse group with one warehouse per `Ops Med Location`
(Central Pharmacy Store, every branch) and "Pharmacy In Transit"; each Ops medicine is an ERP Item (group Medicines,
batch + expiry tracked, pharmacy fields hec_*); each Ops batch is an ERP Batch (expiry, MRP, purchase rate).

Ops → ERP: every Ops stock change (`clinical_ops_pharmacy._move`) posts a submitted Stock Entry in the same database
transaction, so if the ERP refuses it the Ops action fails too. Receipts / issues for purchases, adjustments, sales;
dispatches and branch returns go into the transit warehouse and deliveries come out of it.

ERP → Ops: `pull` compares ERP batch stock in the pharmacy warehouses with Ops stock and applies any difference in Ops
as an "ERP Adjustment" (an admin's Stock Reconciliation, Stock Entry, purchase or sale in the ERP). It runs at the
start of every Ops / Care pharmacy request (at most every `PULL_EVERY` seconds). ERP stock without a batch can't be
held batch-wise and is only reported.
"""

from __future__ import annotations

import json
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

SETTINGS_KEY = "ops_pharmacy_erp"
COMPANY = "Smilecure Lifestyle Private Limited"
GROUP = "Pharmacy"
TRANSIT = "Pharmacy In Transit"
SOURCE_WAREHOUSE = "Stores - RESLD"
ITEM_GROUP = "Medicines"
PULL_EVERY = 15
ERP_ADJUST = "ERP Adjustment"
SE_FIELD = "hec_ops_voucher"
TO_TRANSIT = {"Dispatch"}
FROM_TRANSIT = {"Receipt", "Dispatch Cancelled", "Return In"}


def _ops():
	from health_ecosystem_core.health_ecosystem_core import clinical_ops_pharmacy as ops

	return ops


@contextmanager
def _system():
	"""ERP records are posted with system rights: branch staff may move Ops stock but have no ERPNext stock roles."""
	user = frappe.session.user
	if user == "Administrator":
		yield
		return
	frappe.set_user("Administrator")
	try:
		yield
	finally:
		frappe.set_user(user)


# ---------------------------------------------------------------- settings


def settings():
	raw = frappe.db.get_default(SETTINGS_KEY)
	try:
		data = json.loads(raw) if raw else {}
	except ValueError:
		data = {}
	return frappe._dict(data if isinstance(data, dict) else {})


def _save_settings(**values):
	current = settings()
	current.update(values)
	frappe.db.set_default(SETTINGS_KEY, json.dumps(current, default=str))


def enabled():
	return bool(settings().get("enabled"))


def status():
	s = settings()
	ops = _ops()
	return {
		"enabled": bool(s.get("enabled")), "company": s.get("company") or COMPANY, "set_up_on": s.get("set_up_on"),
		"last_pull": s.get("last_pull"), "last_error": s.get("last_error") or "", "last_changes": s.get("last_changes") or [],
		"unbatched": s.get("unbatched") or [], "transit": s.get("transit") or "",
		"warehouses": {l.name: l.erp_warehouse for l in frappe.get_all(ops.LOC_DT, fields=["name", "erp_warehouse"])},
	}


# ---------------------------------------------------------------- ERP masters


def _abbr():
	return frappe.get_cached_value("Company", COMPANY, "abbr")


def _warehouse(label, parent, is_group=0, location=""):
	name = f"{label} - {_abbr()}"
	if not frappe.db.exists("Warehouse", name):
		frappe.get_doc(
			{"doctype": "Warehouse", "warehouse_name": label, "company": COMPANY, "is_group": is_group, "parent_warehouse": parent, "hec_ops_location": location}
		).insert(ignore_permissions=True)
		# ERPNext keeps the warehouse → stock account map for the whole request; a new warehouse must be seen by it.
		frappe.flags.pop("warehouse_account_map", None)
	return name


def _group(store=GROUP):
	root = frappe.db.get_value("Warehouse", {"company": COMPANY, "is_group": 1, "parent_warehouse": ["in", ["", None]]}, "name")
	return _warehouse(store or GROUP, root, 1)


def _transit(store=GROUP):
	store = store or GROUP
	return _warehouse(TRANSIT if store == GROUP else f"{store} In Transit", _group(store))


def _loc_store(location):
	return frappe.db.get_value(_ops().LOC_DT, location, "store") or GROUP


def _item_group(domain):
	"""ERP item group of an Ops inventory (created on first use under All Item Groups)."""
	group = (_ops().DOMAINS.get(domain or _ops().PHARMACY) or {}).get("erp_group") or ITEM_GROUP
	if not frappe.db.exists("Item Group", group):
		root = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ["in", ["", None]]}, "name") or "All Item Groups"
		frappe.get_doc({"doctype": "Item Group", "item_group_name": group, "parent_item_group": root, "is_group": 0}).insert(ignore_permissions=True)
	return group


def _domain_of_group(group):
	for key, cfg in _ops().DOMAINS.items():
		if cfg.get("erp_group") == group:
			return key
	return _ops().PHARMACY


def location_warehouse(location):
	ops = _ops()
	loc = frappe.db.get_value(ops.LOC_DT, location, ["name", "location_name", "erp_warehouse", "store"], as_dict=True)
	if loc.erp_warehouse and frappe.db.exists("Warehouse", loc.erp_warehouse):
		return loc.erp_warehouse
	wh = _warehouse(loc.location_name, _group(loc.store or GROUP), location=loc.name)
	frappe.db.set_value(ops.LOC_DT, loc.name, "erp_warehouse", wh, update_modified=False)
	return wh


def custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	ro = {"read_only": 1, "no_copy": 1}
	create_custom_fields(
		{
			"Item": [
				{"fieldname": "hec_dosage_form", "label": "Dosage Form", "fieldtype": "Data", "insert_after": "hec_item_mrp"},
				{"fieldname": "hec_strength", "label": "Strength", "fieldtype": "Data", "insert_after": "hec_dosage_form"},
				{"fieldname": "hec_drug_schedule", "label": "Drug Schedule", "fieldtype": "Data", "insert_after": "hec_strength"},
				{"fieldname": "hec_storage", "label": "Storage", "fieldtype": "Data", "insert_after": "hec_drug_schedule"},
				{"fieldname": "hec_reorder_central", "label": "Reorder Level (Central Pharmacy)", "fieldtype": "Int", "insert_after": "hec_storage"},
				{"fieldname": "hec_reorder_branch", "label": "Reorder Level (Branch Pharmacy)", "fieldtype": "Int", "insert_after": "hec_reorder_central"},
				{"fieldname": "hec_ops_medicine", "label": "Ops Pharmacy Medicine", "fieldtype": "Data", "insert_after": "hec_reorder_branch", **ro},
			],
			"Stock Entry": [{"fieldname": SE_FIELD, "label": "Ops Pharmacy Voucher", "fieldtype": "Data", "insert_after": "remarks", **ro}],
			"Warehouse": [{"fieldname": "hec_ops_location", "label": "Ops Pharmacy Location", "fieldtype": "Data", "insert_after": "warehouse_name", **ro}],
		},
		update=True,
	)


def _uom(name):
	name = cstr(name).strip() or "Nos"
	if not frappe.db.exists("UOM", name):
		frappe.get_doc({"doctype": "UOM", "uom_name": name, "must_be_whole_number": 1}).insert(ignore_permissions=True)
	return name


def _item_values(med):
	values = {
		"item_name": cstr(med.medicine_name)[:140], "generic_name": med.generic_name, "hec_hsn_sac": med.hsn_code, "hec_gst_rate": med.gst_rate,
		"hec_pack_size": med.pack_size, "hec_item_mrp": med.mrp, "hec_dosage_form": med.dosage_form, "hec_strength": med.strength,
		"hec_drug_schedule": med.schedule, "hec_storage": med.storage, "hec_reorder_central": med.reorder_central,
		"hec_reorder_branch": med.reorder_branch, "hec_ops_medicine": med.name,
	}
	return {k: v for k, v in values.items() if v not in (None, "")}


def ensure_item(med):
	"""The ERP Item of an Ops medicine, created (or brought up to date) on the fly."""
	ops = _ops()
	if isinstance(med, str):
		med = frappe.get_doc(ops.MED_DT, med)
	code = cstr(med.erp_item) or cstr(med.item_code)
	values = _item_values(med)
	if frappe.db.exists("Item", code):
		item = frappe.get_doc("Item", code)
		changed = False
		if not item.has_batch_no or not item.has_expiry_date:
			if frappe.db.exists("Stock Ledger Entry", {"item_code": code, "is_cancelled": 0}) and not item.has_batch_no:
				frappe.throw(_("ERP item {0} already has stock without batches. Turn on batch numbers for it in the ERP first.").format(code))
			item.has_batch_no = 1
			item.has_expiry_date = 1
			changed = True
		for key, value in values.items():
			if item.meta.has_field(key) and item.get(key) != value:
				item.set(key, value)
				changed = True
		if changed:
			item.flags.ignore_permissions = True
			item.save()
	else:
		frappe.get_doc(
			{"doctype": "Item", "item_code": code, "item_group": _item_group(med.get("domain")), "stock_uom": _uom(med.uom), "is_stock_item": 1,
				"has_batch_no": 1, "has_expiry_date": 1, "include_item_in_manufacturing": 0,
				**{k: v for k, v in values.items() if frappe.get_meta("Item").has_field(k)}}
		).insert(ignore_permissions=True)
	if med.erp_item != code:
		frappe.db.set_value(ops.MED_DT, med.name, "erp_item", code, update_modified=False)
	return code


def ensure_batch(batch):
	"""(ERP item code, ERP Batch name) for an Ops batch."""
	ops = _ops()
	b = frappe.db.get_value(ops.BATCH_DT, batch, ["name", "item", "batch_no", "expiry_date", "mfg_date", "rate", "mrp", "erp_batch"], as_dict=True)
	code = ensure_item(b.item)
	if b.erp_batch and frappe.db.exists("Batch", b.erp_batch):
		return code, b.erp_batch
	found = frappe.db.get_value("Batch", {"batch_id": b.batch_no}, ["name", "item"], as_dict=True)
	if found and found.item == code:
		name = found.name
	else:
		name = frappe.get_doc(
			{"doctype": "Batch", "batch_id": b.batch_no if not found else f"{b.batch_no}-{code}"[:140], "item": code, "expiry_date": b.expiry_date,
				"manufacturing_date": b.mfg_date, "hec_mrp": flt(b.mrp), "hec_purchase_rate": flt(b.rate)}
		).insert(ignore_permissions=True).name
	frappe.db.set_value(ops.BATCH_DT, b.name, "erp_batch", name, update_modified=False)
	return code, name


# ---------------------------------------------------------------- Ops → ERP


def _stock_entry(purpose, code, batch, qty, source, target, rate, ref, note):
	co = frappe.get_cached_value("Company", COMPANY, ["stock_adjustment_account", "cost_center"], as_dict=True)
	uom = frappe.get_cached_value("Item", code, "stock_uom")
	row = {"item_code": code, "qty": qty, "transfer_qty": qty, "uom": uom, "stock_uom": uom, "conversion_factor": 1, "s_warehouse": source,
		"t_warehouse": target, "batch_no": batch, "use_serial_batch_fields": 1, "cost_center": co.cost_center}
	if purpose != "Material Transfer":
		row["expense_account"] = co.stock_adjustment_account
	if purpose == "Material Receipt":
		row["basic_rate"] = flt(rate)
		row["allow_zero_valuation_rate"] = 0 if flt(rate) else 1
	actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": purpose, "purpose": purpose, "company": COMPANY,
		"remarks": f"Ops stock · {ref} · {cstr(note)} · by {actor}"[:500], SE_FIELD: cstr(ref)[:140], "items": [row]})
	with _system():
		se.flags.ignore_permissions = True
		se.insert()
		se.submit()
	return se.name


def push(location, item, batch, qty, voucher_type, voucher_no, note=""):
	"""Post one Ops stock change to the ERP. Returns the Stock Entry name ('' when sync is off)."""
	if not enabled() or frappe.flags.ops_erp_pull or not cint(qty):
		return ""
	with _system():
		code, erp_batch = ensure_batch(batch)
		wh = location_warehouse(location)
	rate = flt(frappe.db.get_value(_ops().BATCH_DT, batch, "rate"))
	qty = cint(qty)
	ref = f"{voucher_type} {voucher_no}"
	source = frappe.flags.ops_erp_source
	if source and qty > 0:
		return _stock_entry("Material Transfer", code, erp_batch, qty, source, wh, rate, ref, note)
	branch_return_out = voucher_type == "Return Out" and frappe.flags.ops_return_kind == "Branch Return"
	with _system():
		transit = _transit(_loc_store(location))
	if (voucher_type in TO_TRANSIT or branch_return_out) and qty < 0:
		return _stock_entry("Material Transfer", code, erp_batch, -qty, wh, transit, rate, ref, note)
	if voucher_type in FROM_TRANSIT and qty > 0:
		return _stock_entry("Material Transfer", code, erp_batch, qty, transit, wh, rate, ref, note)
	if qty > 0:
		return _stock_entry("Material Receipt", code, erp_batch, qty, None, wh, rate, ref, note)
	return _stock_entry("Material Issue", code, erp_batch, -qty, wh, None, rate, ref, note)


def transit_loss(location, item, batch, qty, ref):
	"""Stock dispatched but not received (short / damaged on the way) leaves the ERP transit warehouse."""
	if not enabled() or not cint(qty):
		return ""
	with _system():
		code, erp_batch = ensure_batch(batch)
		transit = _transit(_loc_store(location))
	rate = flt(frappe.db.get_value(_ops().BATCH_DT, batch, "rate"))
	return _stock_entry("Material Issue", code, erp_batch, cint(qty), transit, None, rate, f"Short received {ref}", "Transit shortage")


def batch_qty(warehouse, code, erp_batch):
	return cint(
		frappe.db.sql(
			"""select sum(sbe.qty) from `tabSerial and Batch Entry` sbe join `tabSerial and Batch Bundle` sbb on sbb.name = sbe.parent
			where sbb.is_cancelled = 0 and sbb.docstatus = 1 and sbb.warehouse = %s and sbb.item_code = %s and sbe.batch_no = %s""",
			(warehouse, code, erp_batch),
		)[0][0]
	)


# ---------------------------------------------------------------- ERP → Ops


def _erp_stock(warehouses):
	rows = frappe.db.sql(
		"""select sbb.warehouse, sbb.item_code, sbe.batch_no, sum(sbe.qty) qty
		from `tabSerial and Batch Entry` sbe join `tabSerial and Batch Bundle` sbb on sbb.name = sbe.parent
		where sbb.is_cancelled = 0 and sbb.docstatus = 1 and sbb.warehouse in %s and ifnull(sbe.batch_no, '') != ''
		group by sbb.warehouse, sbb.item_code, sbe.batch_no""",
		(tuple(warehouses),),
		as_dict=True,
	)
	return {(r.warehouse, r.item_code, r.batch_no): max(cint(r.qty), 0) for r in rows}


def _ops_medicine(code):
	ops = _ops()
	name = frappe.db.get_value(ops.MED_DT, {"erp_item": code}, "name") or frappe.db.get_value(ops.MED_DT, {"item_code": code}, "name")
	if name:
		return name
	i = frappe.get_doc("Item", code)
	domain = _domain_of_group(i.item_group)
	return frappe.get_doc(
		{"doctype": ops.MED_DT, "item_code": code, "erp_item": code, "medicine_name": i.item_name, "uom": i.stock_uom, "domain": domain,
			"category": "Medicine" if domain == ops.PHARMACY else ops.DOMAINS[domain]["noun"].title(),
			"generic_name": i.get("generic_name") or "", "pack_size": i.get("hec_pack_size") or "", "hsn_code": i.get("hec_hsn_sac") or "",
			"mrp": flt(i.get("hec_item_mrp")), "dosage_form": i.get("hec_dosage_form") or "", "strength": i.get("hec_strength") or "",
			"schedule": i.get("hec_drug_schedule") or "", "reorder_central": cint(i.get("hec_reorder_central")),
			"reorder_branch": cint(i.get("hec_reorder_branch")), "active": 1}
	).insert(ignore_permissions=True).name


def _ops_batch(item, erp_batch):
	ops = _ops()
	name = frappe.db.get_value(ops.BATCH_DT, {"erp_batch": erp_batch}, "name")
	if name:
		return name
	b = frappe.get_doc("Batch", erp_batch)
	name = frappe.db.get_value(ops.BATCH_DT, {"item": item, "batch_no": b.batch_id}, "name")
	if name:
		frappe.db.set_value(ops.BATCH_DT, name, "erp_batch", erp_batch, update_modified=False)
		return name
	return frappe.get_doc(
		{"doctype": ops.BATCH_DT, "item": item, "batch_no": b.batch_id, "expiry_date": b.expiry_date, "mfg_date": b.manufacturing_date,
			"rate": flt(b.get("hec_purchase_rate")), "mrp": flt(b.get("hec_mrp")), "vendor": b.get("supplier") or "", "purchase": "ERP", "erp_batch": erp_batch}
	).insert(ignore_permissions=True).name


def _last_voucher(code, warehouse, erp_batch):
	row = frappe.db.sql(
		"""select sle.voucher_type, sle.voucher_no from `tabStock Ledger Entry` sle
		left join `tabSerial and Batch Entry` sbe on sbe.parent = sle.serial_and_batch_bundle
		where sle.is_cancelled = 0 and sle.item_code = %s and sle.warehouse = %s and (sbe.batch_no = %s or sle.batch_no = %s)
		order by sle.creation desc limit 1""",
		(code, warehouse, erp_batch, erp_batch),
	)
	return (row[0][0], row[0][1]) if row else ("ERP", "")


def _pull():
	"""Apply ERP-side differences to Ops; the moves made here are never pushed back to the ERP."""
	previous = frappe.flags.ops_erp_pull
	frappe.flags.ops_erp_pull = True
	try:
		return _apply_erp_changes()
	finally:
		frappe.flags.ops_erp_pull = previous


def _apply_erp_changes():
	ops = _ops()
	locs = frappe.get_all(ops.LOC_DT, fields=["name", "erp_warehouse"], filters={"erp_warehouse": ["!=", ""]})
	wh_loc = {l.erp_warehouse: l.name for l in locs if l.erp_warehouse}
	if not wh_loc:
		return []
	erp = _erp_stock(list(wh_loc))
	here = {}
	for r in frappe.db.sql(
		f"""select bin.location, bin.item, bin.batch, bin.qty, b.erp_batch, m.erp_item
		from `tab{ops.BIN_DT}` bin join `tab{ops.BATCH_DT}` b on b.name = bin.batch join `tab{ops.MED_DT}` m on m.name = bin.item
		where ifnull(b.erp_batch, '') != '' and ifnull(m.erp_item, '') != ''""",
		as_dict=True,
	):
		wh = next((w for w, l in wh_loc.items() if l == r.location), None)
		if wh:
			here[(wh, r.erp_item, r.erp_batch)] = r
	changes = []
	for key in set(erp) | set(here):
		have = cint(here[key].qty) if key in here else 0
		want = erp.get(key, 0)
		if want == have:
			continue
		wh, code, erp_batch = key
		if key in here:
			item, batch = here[key].item, here[key].batch
		else:
			item = _ops_medicine(code)
			batch = _ops_batch(item, erp_batch)
		vtype, vno = _last_voucher(code, wh, erp_batch)
		ops._move(wh_loc[wh], item, batch, want - have, ERP_ADJUST, vno or "ERP", f"Changed in ERP: {vtype} {vno}".strip())
		changes.append({"warehouse": wh, "item": code, "batch": erp_batch, "from": have, "to": want, "voucher": f"{vtype} {vno}".strip()})
	unbatched = frappe.db.sql(
		"""select b.warehouse, b.item_code, b.actual_qty from tabBin b where b.warehouse in %s and b.actual_qty > 0""",
		(tuple(wh_loc),),
		as_dict=True,
	)
	loose = []
	for b in unbatched:
		batched = sum(q for (w, c, _b), q in erp.items() if w == b.warehouse and c == b.item_code)
		if cint(b.actual_qty) > batched:
			loose.append(f"{b.item_code} in {b.warehouse}: {cint(b.actual_qty) - batched} without batch")
	return changes, loose


def pull(force=False):
	"""Bring ERP-side stock changes into Ops. Never raises: a failure is kept in the sync status."""
	if not enabled() or frappe.flags.ops_erp_pull:
		return
	cache = frappe.cache()
	if not force and cache.get_value("ops_pharmacy_erp_pulled"):
		return
	cache.set_value("ops_pharmacy_erp_pulled", 1, expires_in_sec=PULL_EVERY)
	frappe.db.savepoint("ops_erp_pull")
	try:
		changes, loose = _pull() or ([], [])
		previous = settings().get("last_changes") or []
		_save_settings(last_pull=cstr(now_datetime()), last_error="", unbatched=loose,
			last_changes=([{**c, "at": cstr(now_datetime())} for c in changes] + previous)[:20])
		if changes:
			_ops()._audit("Stock changed in ERP", "", "", "; ".join(f"{c['item']} {c['batch']} @ {c['warehouse']}: {c['from']} → {c['to']} ({c['voucher']})" for c in changes)[:1000])
	except Exception:
		frappe.db.rollback(save_point="ops_erp_pull")
		frappe.log_error(title="ops_pharmacy_erp_pull", message=frappe.get_traceback())
		_save_settings(last_error=cstr(frappe.get_traceback().strip().splitlines()[-1])[:300], last_pull=cstr(now_datetime()))


# ---------------------------------------------------------------- set-up


def setup(ctx, data):
	"""Create the ERP pharmacy records and line the ERP up with the Ops stock, then switch the two-way sync on."""
	ops = _ops()
	ops._require(ctx, "manager")
	source = cstr(data.get("source_warehouse") or SOURCE_WAREHOUSE)
	custom_fields()
	transit = _transit()
	warehouses = {l.name: location_warehouse(l.name) for l in frappe.get_all(ops.LOC_DT, fields=["name"])}
	items = [ensure_item(m) for m in frappe.get_all(ops.MED_DT, pluck="name")]
	done = []
	for r in frappe.get_all(ops.BIN_DT, fields=["location", "item", "batch", "qty"], filters={"qty": ["!=", 0]}):
		code, erp_batch = ensure_batch(r.batch)
		wh = warehouses[r.location]
		diff = cint(r.qty) - batch_qty(wh, code, erp_batch)
		rate = flt(frappe.db.get_value(ops.BATCH_DT, r.batch, "rate"))
		ref = "Ops pharmacy set-up"
		if diff > 0:
			moved = min(diff, batch_qty(source, code, erp_batch)) if frappe.db.exists("Warehouse", source) and source != wh else 0
			if moved > 0:
				done.append(_stock_entry("Material Transfer", code, erp_batch, moved, source, wh, rate, ref, f"Opening from {source}"))
			if diff - moved > 0:
				done.append(_stock_entry("Material Receipt", code, erp_batch, diff - moved, None, wh, rate, ref, "Opening stock"))
		elif diff < 0:
			done.append(_stock_entry("Material Issue", code, erp_batch, -diff, wh, None, rate, ref, "Opening correction"))
	_save_settings(enabled=True, company=COMPANY, transit=transit, source=source, set_up_on=cstr(now_datetime()), last_error="")
	ops._audit("ERP pharmacy stock set up", "", "", f"{len(warehouses)} warehouse(s), {len(items)} item(s), {len(done)} opening entr(ies): {', '.join(done)}"[:1000])
	frappe.cache().delete_value("ops_pharmacy_erp_pulled")
	pull(force=True)
	return {"warehouses": warehouses, "transit": transit, "items": len(items), "entries": done, "status": status()}


def sync_now(ctx):
	_ops()._require(ctx, "manager")
	frappe.cache().delete_value("ops_pharmacy_erp_pulled")
	pull(force=True)
	return status()


def disable(ctx):
	_ops()._require(ctx, "manager")
	_save_settings(enabled=False)
	_ops()._audit("ERP pharmacy sync switched off")
	return status()
