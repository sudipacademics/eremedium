"""Remedium Care branch pharmacy on the Operations pharmacy stock (clinical_ops_pharmacy).

Care branch staff work on their own branch's `Ops Med Location` from care.e-remedium.in: batch-wise stock,
requisitions to the central store, delivery receipt, returns, dispensing / damaged entries and the movement
ledger. The Operations Manager approves and dispatches in the Operations portal. Buying a medicine from an
outside vendor needs the Operations Manager's approval first (`external_request`); the purchase can only be
recorded against that approval (`external_receive`), within its medicine, quantity, price and validity. Pharmacy sales billed in the
Care portal take stock from the branch first-expiry-first-out ("Care Sale" ledger rows, voucher = invoice no.)
and a cancelled bill puts the same batches back.

Access: Care Backend → Pharmacy level (view to see, create to raise / receive / return / sell) and the user's
Care branches from HR (Portal Access branches, else Unit / Centre). Operations users keep their Operations
access; System Managers and the Operations Manager see every branch. Nothing here changes the Operations
module's own rules: every stock change still goes through its `_move` and functions.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, today

LEVELS = {"none": 0, "view": 1, "create": 2, "edit": 3, "approve": 4, "manage": 5}
SALE = "Care Sale"
SALE_UNDO = "Care Sale Cancelled"


def _ops():
	from health_ecosystem_core.health_ecosystem_core import clinical_ops_pharmacy as ops

	return ops


def _care_level():
	from health_ecosystem_core.health_ecosystem_core.clinical_people_access import my_permissions

	perms = my_permissions()
	if perms.get("exempt"):
		return LEVELS["manage"]
	level = ((perms.get("portal_modules") or {}).get("care") or {}).get("Pharmacy", {}).get("level", "none")
	return LEVELS.get(level, 0)


def _ctx():
	"""The Operations pharmacy context, widened by the user's Care Backend Pharmacy access for their branches."""
	ops = _ops()
	base = ops._ctx()
	if base.manager:
		return base
	level = _care_level()
	ctx = frappe._dict(base)
	ctx.member = bool(base.member or level >= LEVELS["view"])
	ctx.write = bool(base.write or level >= LEVELS["create"])
	ctx.care_level = level
	return ctx


def _location(ctx, branch_id):
	"""Pharmacy location of a Care branch, checked against the user's branches."""
	ops = _ops()
	ops._sync_care_branches()
	branch_id = cint(branch_id)
	loc = frappe.db.get_value(ops.LOC_DT, {"care_branch_id": branch_id}, ["name", "location_name", "active"], as_dict=True) if branch_id else None
	if not loc:
		frappe.throw(_("This Care branch has no pharmacy location yet. Ask the Operations Manager to add it in Branches & Stores."))
	if not ctx.manager and loc.name not in ctx.branches:
		frappe.throw(_("You can only work with your own branch"), frappe.PermissionError)
	return loc


# ---------------------------------------------------------------- reads


def board(ctx, data):
	ops = _ops()
	ops._require(ctx)
	loc = _location(ctx, data.get("branch_id"))
	full = ops.board(ctx)
	mine = loc.name

	def at(rows, *fields):
		return [r for r in rows if any(r.get(f) == mine for f in fields)]

	stock = [s for s in full["stock"] if s.location == mine]
	central = ops._central()
	central_qty = {}
	for s in frappe.db.sql(
		f"""select bin.item, sum(bin.qty) qty from `tab{ops.BIN_DT}` bin join `tab{ops.BATCH_DT}` b on b.name = bin.batch
		where bin.location=%s and bin.qty > 0 and (b.expiry_date is null or b.expiry_date > %s) group by bin.item""",
		(central, today()),
		as_dict=True,
	):
		central_qty[s.item] = cint(s.qty)
	return {
		"me": {**full["me"], "write": bool(ctx.write)},
		"location": {"name": loc.name, "location_name": loc.location_name, "active": cint(loc.active)},
		"items": [i for i in full["items"] if cint(i.get("active"))],
		"central_qty": central_qty,
		"stock": stock,
		"alerts": [a for a in full["alerts"] if a.get("location") == mine],
		"requisitions": at(full["requisitions"], "location"),
		"dispatches": at(full["dispatches"], "destination"),
		"returns": at(full["returns"], "source"),
		"adjustments": at(full["adjustments"], "location"),
		"external_requests": at(full.get("external_requests") or [], "location"),
		"constants": {
			"adj_reasons": list(ops.BRANCH_ADJ_REASONS),
			"return_reasons": list(ops.RETURN_REASONS),
			"near_days": ops.NEAR_EXPIRY_DAYS,
			"priorities": ["Normal", "Urgent", "Emergency"],
		},
	}


def ledger(ctx, data):
	ops = _ops()
	loc = _location(ctx, data.get("branch_id"))
	filters = dict(data.get("filters") or {})
	filters["location"] = loc.name
	return ops.ledger(ctx, filters)


def sellable(ctx, data):
	"""Medicines in stock at the branch for billing: unexpired quantity, earliest expiry and its MRP."""
	ops = _ops()
	ops._require(ctx)
	loc = _location(ctx, data.get("branch_id"))
	items = ops._items()
	rows = frappe.db.sql(
		f"""select bin.item, bin.qty, b.batch_no, b.expiry_date, b.mrp from `tab{ops.BIN_DT}` bin join `tab{ops.BATCH_DT}` b on b.name = bin.batch
		where bin.location=%s and bin.qty > 0 and (b.expiry_date is null or b.expiry_date > %s)
		order by b.expiry_date is null, b.expiry_date asc""",
		(loc.name, today()),
		as_dict=True,
	)
	out = {}
	for r in rows:
		it = items.get(r.item)
		if not it or not cint(it.active):
			continue
		row = out.setdefault(r.item, {
			"item": r.item, "name": it.medicine_name, "generic": it.generic_name, "strength": it.strength, "uom": it.uom or "Unit",
			"qty": 0, "mrp": float(r.mrp or it.mrp or 0), "next_expiry": cstr(r.expiry_date or ""), "schedule": it.schedule,
		})
		row["qty"] += cint(r.qty)
	return {"location": loc.location_name, "items": sorted(out.values(), key=lambda x: x["name"].lower())}


# ---------------------------------------------------------------- branch actions


def requisition(ctx, data):
	loc = _location(ctx, data.get("branch_id"))
	priority = cstr(data.get("priority") or "Normal")
	if priority not in ("Normal", "Urgent", "Emergency"):
		priority = "Normal"
	return _ops().save_requisition(ctx, {**data, "location": loc.name, "priority": priority})


def cancel(ctx, data):
	ops = _ops()
	loc = _location(ctx, data.get("branch_id"))
	doc = ops._req(cstr(data.get("requisition")))
	if doc.location != loc.name:
		frappe.throw(_("This requisition belongs to another branch"), frappe.PermissionError)
	return ops.cancel_requisition(ctx, doc.req_no)


def receive(ctx, data):
	ops = _ops()
	loc = _location(ctx, data.get("branch_id"))
	doc = ops._dsp(cstr(data.get("challan")))
	if doc.destination != loc.name:
		frappe.throw(_("This delivery is for another branch"), frappe.PermissionError)
	ops._require(ctx, "write")
	return ops.update_dispatch(ctx, doc.challan_no, "Delivered", cstr(data.get("note")), cstr(data.get("received_by")))


def stock_return(ctx, data):
	loc = _location(ctx, data.get("branch_id"))
	return _ops().save_return(ctx, {**data, "kind": "Branch Return", "source": loc.name})


def adjustment(ctx, data):
	loc = _location(ctx, data.get("branch_id"))
	return _ops().save_adjustment(ctx, {**data, "location": loc.name})


def external_request(ctx, data):
	"""Ask the Operations Manager for permission to buy a medicine from an outside vendor."""
	loc = _location(ctx, data.get("branch_id"))
	return _ops().save_external_request(ctx, {**data, "location": loc.name})


def _own_external(ctx, data):
	ops = _ops()
	loc = _location(ctx, data.get("branch_id"))
	doc = ops._ext(cstr(data.get("ext_no")))
	if doc.location != loc.name:
		frappe.throw(_("This request belongs to another branch"), frappe.PermissionError)
	return doc


def external_cancel(ctx, data):
	return _ops().cancel_external_request(ctx, _own_external(ctx, data).ext_no)


def external_receive(ctx, data):
	"""Record an approved outside purchase (refused until the Operations Manager has approved it)."""
	doc = _own_external(ctx, data)
	return _ops().receive_external(ctx, {**data, "ext_no": doc.ext_no})


def challan(ctx, data):
	ops = _ops()
	loc = _location(ctx, data.get("branch_id"))
	doc = ops._dsp(cstr(data.get("challan")))
	if doc.destination != loc.name and doc.source != loc.name:
		frappe.throw(_("This challan belongs to another branch"), frappe.PermissionError)
	return ops.challan_pdf(frappe._dict(ctx, manager=True), doc.challan_no)


# ---------------------------------------------------------------- sales


def dispense(ctx, data):
	"""Take a pharmacy bill's medicines out of the branch stock, first expiry first. All or nothing."""
	ops = _ops()
	ops._require(ctx, "write")
	loc = _location(ctx, data.get("branch_id"))
	invoice = cstr(data.get("invoice_no")).strip()
	if not invoice:
		frappe.throw(_("Invoice number is required"))
	if frappe.db.exists(ops.LEDGER_DT, {"voucher_type": SALE, "voucher_no": invoice, "location": loc.name}):
		frappe.throw(_("Stock for {0} has already been taken").format(invoice))
	items = ops._items()
	wanted = {}
	for raw in data.get("lines") or []:
		item = cstr(raw.get("item"))
		if item not in items:
			frappe.throw(_("{0} is not in the medicine master").format(cstr(raw.get("name")) or item))
		asked = float(raw.get("qty") or 0)
		qty = int(asked)
		if asked <= 0 or asked != qty:
			frappe.throw(_("Sell {0} in whole units").format(items[item].medicine_name))
		wanted[item] = wanted.get(item, 0) + qty
	if not wanted:
		frappe.throw(_("No medicines to take from stock"))
	note = cstr(data.get("patient"))[:120]
	picks = []
	for item, qty in wanted.items():
		got, short = ops._fefo(loc.name, item, qty)
		if short:
			frappe.throw(_("Only {0} {1} of {2} in stock at {3}").format(qty - short, items[item].uom or "", items[item].medicine_name, loc.location_name))
		for b in got:
			ops._move(loc.name, item, b["batch"], -b["qty"], SALE, invoice, note)
			picks.append({"item": item, "name": items[item].medicine_name, "batch_no": b["batch_no"], "expiry": b["expiry"], "qty": b["qty"], "mrp": b["mrp"]})
	return {"invoice_no": invoice, "location": loc.location_name, "batches": picks}


def restock(ctx, data):
	"""A cancelled pharmacy bill: put back exactly the batches its sale took."""
	ops = _ops()
	ops._require(ctx, "write")
	loc = _location(ctx, data.get("branch_id"))
	invoice = cstr(data.get("invoice_no")).strip()
	if frappe.db.exists(ops.LEDGER_DT, {"voucher_type": SALE_UNDO, "voucher_no": invoice, "location": loc.name}):
		return {"invoice_no": invoice, "restocked": 0}
	rows = frappe.get_all(ops.LEDGER_DT, filters={"voucher_type": SALE, "voucher_no": invoice, "location": loc.name}, fields=["item", "batch", "qty"])
	for r in rows:
		ops._move(loc.name, r.item, r.batch, -cint(r.qty), SALE_UNDO, invoice, cstr(data.get("reason"))[:200] or "Bill cancelled")
	return {"invoice_no": invoice, "restocked": sum(-cint(r.qty) for r in rows)}


# ---------------------------------------------------------------- endpoints


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_mobile_auth, _success

	return _error, _parse_request_value, _require_mobile_auth, _success


def _call(fn, sid, data):
	_error, _parse, _auth, _success = _api()
	if not _auth(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	raw = _parse("data", data) or "{}"
	try:
		payload = frappe.parse_json(raw) if isinstance(raw, str) else dict(raw)
	except Exception:
		return _error(_("Invalid request data"))
	try:
		_ops().ensure()
		_ops()._set_domain(_ops().PHARMACY)
		_ops()._erp().pull()
		result = fn(_ctx(), payload or {})
		frappe.db.commit()
		return _success(result)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="care_pharmacy", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _endpoint(fn):
	def handler(sid=None, data=None):
		return _call(fn, sid, data)

	handler.__name__ = f"care_pharmacy_{fn.__name__}"
	return frappe.whitelist(allow_guest=True, methods=["POST"])(handler)


care_pharmacy_board = _endpoint(board)
care_pharmacy_ledger = _endpoint(ledger)
care_pharmacy_sellable = _endpoint(sellable)
care_pharmacy_requisition = _endpoint(requisition)
care_pharmacy_cancel = _endpoint(cancel)
care_pharmacy_receive = _endpoint(receive)
care_pharmacy_return = _endpoint(stock_return)
care_pharmacy_adjustment = _endpoint(adjustment)
care_pharmacy_challan = _endpoint(challan)
care_pharmacy_dispense = _endpoint(dispense)
care_pharmacy_restock = _endpoint(restock)
care_pharmacy_external_request = _endpoint(external_request)
care_pharmacy_external_cancel = _endpoint(external_cancel)
care_pharmacy_external_receive = _endpoint(external_receive)
