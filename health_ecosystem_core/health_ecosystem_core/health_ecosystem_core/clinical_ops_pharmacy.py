"""Operations portal: central stock for the pharmacy and the aesthetic unit.

One engine, separate inventories (`DOMAINS`): Pharmacy, Aesthetic Consumables (central hub supplying branches;
branch returns need Ops approval and get a return challan; branches confirm received quantities) and Aesthetic
Products (distributor / retailer: transfer price, branch retail sales and sale returns, outside purchases only on
approval). Items and transactions carry `domain`; locations belong to a `store`. Requests without a domain are the
pharmacy, so the Care portal and older screens are unaffected. Aesthetic branch staff come in through Portal
Access → Aesthetic Backend → Products (or the Aesthetic Staff / Manager roles) and work only for their branches.

The Central Pharmacy Store is the stockist; branches are retailers. A branch buying from an outside vendor
needs an approved `Ops Med External Request` first (medicine, quantity, vendor, price, reason); the purchase
can only be entered against it and is posted to the branch ledger as "External Purchase".

Masters: medicines, vendors, locations (the Central Pharmacy Store plus Care branches from the Care
branch directory, and any extra branch the Operations Manager adds). Stock is held per location and
batch in `Ops Med Bin`; every change goes through `_move`, which writes one `Ops Med Ledger` row, so
the ledger is the complete movement history. Purchases add stock; branch requisitions are approved
(fully or partly) and dispatched from the central store first-expiry-first-out; delivery adds the
stock at the branch. Expired batches can never be dispatched. Returns, adjustments and expiry
write-offs are recorded the same way, and non-stock actions go to `Ops Med Audit`.

Access: Operations Manager / System Manager (or Inventory & Purchase at Approve/Manage in Portal
Access) run everything. Other Operations users work only for the branches they are assigned to
(location staff list, their Care branch, or their HR Unit/Centre): raise requisitions, confirm
deliveries, send returns and record dispensing.
"""

from __future__ import annotations

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, date_diff, escape_html, flt, format_date, getdate, now_datetime, today

SCHEMA_VERSION = "ops-pharmacy-5"
MED_DT = "Ops Medicine"
VEN_DT = "Ops Med Vendor"
LOC_DT = "Ops Med Location"
BATCH_DT = "Ops Med Batch"
BIN_DT = "Ops Med Bin"
LEDGER_DT = "Ops Med Ledger"
PUR_DT = "Ops Med Purchase"
REQ_DT = "Ops Med Requisition"
DSP_DT = "Ops Med Dispatch"
RET_DT = "Ops Med Return"
ADJ_DT = "Ops Med Adjustment"
AUD_DT = "Ops Med Audit"
EXT_DT = "Ops Med External Request"
SALE_DT = "Ops Med Sale"
EXT_OPEN = ("Approved", "Partially Approved", "Partially Received")
EXT_VALID_DAYS = 15
EXTERNAL = "External Purchase"

MANAGER_ROLES = {"System Manager", "Administrator", "Health System Admin", "Operations Manager"}
CENTRAL = "Central Store"
BRANCH = "Branch"
NEAR_EXPIRY_DAYS = 90
FORMS = ("Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream", "Ointment", "Powder", "Inhaler", "Device", "Other")
SCHEDULES = ("OTC", "H", "H1", "X", "G")
DISPATCH_FLOW = ("Dispatched", "In Transit", "Out for Delivery", "Delivered")
ADJ_REASONS = ("Count correction", "Damaged", "Expiry write-off", "Theft / loss", "Dispensed / Sold", "Opening stock", "Other")
BRANCH_ADJ_REASONS = ("Dispensed / Sold", "Damaged")
RETURN_REASONS = ("Near expiry", "Expired", "Damaged", "Excess stock", "Recalled", "Wrong item")
COMPANY = "Smilecure Lifestyle Pvt Ltd"

SEED_MEDICINES = (
	("Vitamin D3 60000 IU", "Cholecalciferol", "Capsule", "60000 IU", "Strip of 4", "Strip", "OTC", 24, 6, "Normal"),
	("Paracetamol 650", "Paracetamol", "Tablet", "650 mg", "Strip of 15", "Strip", "OTC", 40, 10, "Normal"),
	("Azithromycin 500", "Azithromycin", "Tablet", "500 mg", "Strip of 3", "Strip", "H", 20, 5, "Normal"),
	("Pantoprazole 40", "Pantoprazole", "Tablet", "40 mg", "Strip of 15", "Strip", "H", 30, 8, "Normal"),
	("Cetirizine 10", "Cetirizine", "Tablet", "10 mg", "Strip of 10", "Strip", "OTC", 25, 6, "Normal"),
	("ORS sachet", "Oral rehydration salts", "Powder", "21 g", "Sachet", "Sachet", "OTC", 36, 10, "Normal"),
	("Insulin glargine pen", "Insulin glargine", "Injection", "100 IU/ml, 3 ml", "Pen", "Pen", "H", 10, 3, "Cold chain"),
	("Metformin 500", "Metformin", "Tablet", "500 mg", "Strip of 10", "Strip", "H", 40, 10, "Normal"),
	("Atorvastatin 10", "Atorvastatin", "Tablet", "10 mg", "Strip of 10", "Strip", "H", 20, 6, "Normal"),
	("Amoxicillin 500", "Amoxicillin", "Capsule", "500 mg", "Strip of 10", "Strip", "H", 24, 6, "Normal"),
)
SEED_VENDORS = (
	("PharmaNest Distributors", "dispatch@pharmanest.example", "Medicines"),
	("ColdChain Bengal", "ops@coldchain.example", "Cold-chain medicines"),
)

# One stock engine, separate inventories. Every item and transaction carries its `domain`; locations belong to a
# `store` (Pharmacy, or Aesthetic for both aesthetic inventories). A request names its domain (`domain` arg);
# without one it is the pharmacy, so the Care portal and existing pharmacy screens are unchanged.
PHARMACY = "pharmacy"
DOMAINS = {
	PHARMACY: {
		"label": "Pharmacy", "store": "Pharmacy", "noun": "medicine", "central": "Central Pharmacy Store", "central_code": "CPS", "prefix": "MED",
		"external": True, "sales": False, "return_approval": False, "receive_qty": False, "transfer_price": False,
		"branch_reasons": BRANCH_ADJ_REASONS, "portal": None, "erp_group": "Medicines",
	},
	"aes_consumable": {
		"label": "Aesthetic Consumables", "store": "Aesthetic", "noun": "consumable", "central": "Aesthetic Central Store", "central_code": "ACS",
		"prefix": "CON", "external": False, "sales": False, "return_approval": True, "receive_qty": True, "transfer_price": False,
		"branch_reasons": ("Used in procedure", "Damaged", "Expired"), "portal": "aesthetics", "erp_group": "Aesthetic Consumables",
	},
	"aes_product": {
		"label": "Aesthetic Products", "store": "Aesthetic", "noun": "product", "central": "Aesthetic Central Store", "central_code": "ACS",
		"prefix": "PRD", "external": True, "sales": True, "return_approval": True, "receive_qty": True, "transfer_price": True,
		"branch_reasons": ("Damaged", "Expired", "Used as tester / sample"), "portal": "aesthetics", "erp_group": "Aesthetic Products",
	},
}
AESTHETIC_BRANCHES = (("Bongaon Aesthetic", "BGN", "Bongaon"), ("Barasat Aesthetic", "BRS", "Barasat"))
AESTHETIC_MODULE = "Products"
PAY_MODES = ("Cash", "UPI", "Card", "Bank transfer", "Other")


def _dom():
	d = cstr(getattr(frappe.local, "ops_domain", "") or "")
	return d if d in DOMAINS else PHARMACY


def _cfg(domain=None):
	return frappe._dict(DOMAINS[domain or _dom()])


def _store():
	return _cfg().store


NUMBERING = {PHARMACY: ("MR", "DC", "RT"), "aes_consumable": ("CR", "CDC", "CRT"), "aes_product": ("OR", "PDC", "PRT")}


def _prefix(kind):
	return NUMBERING[_dom()][("req", "dc", "rt").index(kind)]


def _set_domain(value):
	value = cstr(value or PHARMACY)
	if value not in DOMAINS:
		frappe.throw(_("Unknown inventory"))
	frappe.local.ops_domain = value


def _same_domain(doc):
	if cstr(doc.get("domain") or PHARMACY) != _dom():
		frappe.throw(_("{0} belongs to the {1} inventory").format(doc.name, _cfg(doc.get("domain") or PHARMACY).label))


# ---------------------------------------------------------------- schema


def _f(fieldname, fieldtype="Data", label=None, **extra):
	return {"fieldname": fieldname, "fieldtype": fieldtype, "label": label or fieldname.replace("_", " ").title(), **extra}


SCHEMA = {
	MED_DT: [
		_f("item_code", in_list_view=1), _f("medicine_name", reqd=1, in_list_view=1), _f("generic_name"), _f("dosage_form"),
		_f("strength"), _f("pack_size"), _f("uom", label="UOM"), _f("category"), _f("schedule"), _f("hsn_code", label="HSN"),
		_f("gst_rate", "Float", "GST %"), _f("mrp", "Float", "MRP"), _f("reorder_central", "Int", "Reorder Level (Central)"),
		_f("reorder_branch", "Int", "Reorder Level (Branch)"), _f("storage"), _f("active", "Check", default="1"),
		_f("erp_item", label="ERP Item"),
	],
	VEN_DT: [
		_f("vendor_name", reqd=1, in_list_view=1), _f("category"), _f("gstin", label="GSTIN"), _f("drug_license"),
		_f("contact_person"), _f("phone"), _f("email"), _f("address", "Small Text"), _f("active", "Check", default="1"),
	],
	LOC_DT: [
		_f("location_name", reqd=1, in_list_view=1), _f("kind", in_list_view=1), _f("code"), _f("care_branch_id", "Int", "Care Branch ID"),
		_f("address", "Small Text"), _f("staff", "Long Text", "Staff Logins"), _f("active", "Check", default="1"),
		_f("erp_warehouse", label="ERP Warehouse"),
	],
	BATCH_DT: [
		_f("item", in_list_view=1), _f("batch_no", in_list_view=1), _f("mfg_date", "Date"), _f("expiry_date", "Date", in_list_view=1),
		_f("vendor"), _f("purchase"), _f("rate", "Float"), _f("mrp", "Float", "MRP"), _f("erp_batch", label="ERP Batch"),
	],
	BIN_DT: [_f("location", in_list_view=1), _f("item", in_list_view=1), _f("batch", in_list_view=1), _f("qty", "Int", in_list_view=1)],
	LEDGER_DT: [
		_f("posted_on", "Datetime", in_list_view=1), _f("location", in_list_view=1), _f("item", in_list_view=1), _f("batch"),
		_f("qty", "Int", in_list_view=1), _f("balance", "Int"), _f("voucher_type", in_list_view=1), _f("voucher_no"),
		_f("note", "Small Text"), _f("actor"), _f("erp_voucher", label="ERP Voucher"),
	],
	PUR_DT: [
		_f("purchase_no", in_list_view=1), _f("vendor", in_list_view=1), _f("invoice_no"), _f("invoice_date", "Date"),
		_f("location"), _f("lines", "Long Text"), _f("total", "Float"), _f("status"), _f("note", "Small Text"), _f("actor"),
		_f("source"), _f("external_request"),
	],
	EXT_DT: [
		_f("ext_no", in_list_view=1), _f("location", in_list_view=1), _f("item"), _f("medicine_name", in_list_view=1),
		_f("qty", "Int"), _f("unit_price", "Float"), _f("vendor_name"), _f("vendor_gstin", label="Vendor GSTIN"), _f("vendor_phone"),
		_f("vendor"), _f("reason", "Small Text"), _f("urgency"), _f("status", in_list_view=1), _f("requested_by"), _f("requested_by_name"),
		_f("approved_qty", "Int"), _f("approved_price", "Float"), _f("valid_until", "Date"), _f("decided_by"), _f("decided_on", "Datetime"),
		_f("decision_note", "Small Text"), _f("received_qty", "Int"), _f("receipts", "Long Text"),
	],
	REQ_DT: [
		_f("req_no", in_list_view=1), _f("location", in_list_view=1), _f("priority"), _f("required_by", "Date"),
		_f("status", in_list_view=1), _f("lines", "Long Text"), _f("note", "Small Text"), _f("requested_by"),
		_f("requested_by_name"), _f("decided_by"), _f("decided_on", "Datetime"), _f("decision_note", "Small Text"),
	],
	DSP_DT: [
		_f("challan_no", in_list_view=1), _f("requisition"), _f("source"), _f("destination", in_list_view=1),
		_f("status", in_list_view=1), _f("lines", "Long Text"), _f("carrier"), _f("vehicle_no"), _f("driver_phone"),
		_f("expected_on", "Date"), _f("events", "Long Text"), _f("dispatched_by"), _f("dispatched_on", "Datetime"),
		_f("delivered_on", "Datetime"), _f("received_by"), _f("note", "Small Text"),
	],
	RET_DT: [
		_f("return_no", in_list_view=1), _f("kind", in_list_view=1), _f("source"), _f("destination"), _f("vendor"),
		_f("status", in_list_view=1), _f("lines", "Long Text"), _f("reason"), _f("note", "Small Text"), _f("actor"),
		_f("received_by"), _f("received_on", "Datetime"),
	],
	ADJ_DT: [
		_f("adj_no", in_list_view=1), _f("location", in_list_view=1), _f("lines", "Long Text"), _f("reason"),
		_f("note", "Small Text"), _f("actor"),
	],
	AUD_DT: [
		_f("at", "Datetime", in_list_view=1), _f("action", in_list_view=1), _f("ref_type"), _f("ref_no", in_list_view=1),
		_f("detail", "Small Text"), _f("actor"),
	],
	SALE_DT: [
		_f("sale_no", in_list_view=1), _f("location", in_list_view=1), _f("customer"), _f("phone"), _f("lines", "Long Text"),
		_f("subtotal", "Float"), _f("discount", "Float"), _f("total", "Float", in_list_view=1), _f("payment_mode"), _f("status", in_list_view=1),
		_f("returns", "Long Text"), _f("note", "Small Text"), _f("actor"),
	],
}
_DOMAIN_DTS = (MED_DT, LEDGER_DT, PUR_DT, EXT_DT, REQ_DT, DSP_DT, RET_DT, ADJ_DT, AUD_DT, SALE_DT)
for _dt in _DOMAIN_DTS:
	SCHEMA[_dt].append(_f("domain", in_list_view=1))
SCHEMA[LOC_DT].append(_f("store", in_list_view=1))
SCHEMA[MED_DT] += [_f("brand"), _f("transfer_price", "Float", "Transfer Price")]
SCHEMA[RET_DT] += [_f("decided_by"), _f("decided_on", "Datetime"), _f("decision_note", "Small Text"), _f("requested_by")]
SCHEMA[DSP_DT] += [_f("shortage", "Int"), _f("domain_note", "Small Text")]


def _ensure_dt(name, fields):
	if frappe.db.exists("DocType", name):
		have = {f.fieldname for f in frappe.get_meta(name).fields}
		missing = [f for f in fields if f["fieldname"] not in have]
		if missing:
			doc = frappe.get_doc("DocType", name)
			for field in missing:
				doc.append("fields", field)
			doc.save(ignore_permissions=True)
		return
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": name,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"autoname": "hash",
			"naming_rule": "Random",
			"track_changes": 1,
			"fields": fields,
			"permissions": [{"role": r, "read": 1, "write": 1, "create": 1, "delete": 1} for r in ("System Manager", "Operations Manager")],
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)


def ensure():
	cache = frappe.cache()
	if cache.get_value("ops_pharmacy_schema") == SCHEMA_VERSION:
		return
	for role in ("Operations Manager", "Operations Staff"):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)
	for name, fields in SCHEMA.items():
		_ensure_dt(name, fields)
	for dt in _DOMAIN_DTS:
		frappe.db.sql(f"update `tab{dt}` set domain=%s where ifnull(domain, '')=''", (PHARMACY,))
	frappe.db.sql(f"update `tab{LOC_DT}` set store='Pharmacy' where ifnull(store, '')=''")
	_seed()
	frappe.db.commit()
	cache.set_value("ops_pharmacy_schema", SCHEMA_VERSION)


def _seed():
	if not frappe.db.count(MED_DT) and not frappe.db.count(AUD_DT):
		for i, (name, generic, form, strength, pack, uom, schedule, reorder_c, reorder_b, storage) in enumerate(SEED_MEDICINES, 1):
			frappe.get_doc(
				{
					"doctype": MED_DT, "item_code": f"MED-{i:04d}", "medicine_name": name, "generic_name": generic, "dosage_form": form,
					"strength": strength, "pack_size": pack, "uom": uom, "schedule": schedule, "category": "Medicine",
					"reorder_central": reorder_c, "reorder_branch": reorder_b, "storage": storage, "active": 1, "domain": PHARMACY,
				}
			).insert(ignore_permissions=True)
	if not frappe.db.count(VEN_DT):
		for name, email, category in SEED_VENDORS:
			frappe.get_doc({"doctype": VEN_DT, "vendor_name": name, "email": email, "category": category, "active": 1}).insert(ignore_permissions=True)
	if not frappe.db.exists(LOC_DT, {"kind": CENTRAL, "store": "Pharmacy"}):
		frappe.get_doc({"doctype": LOC_DT, "location_name": "Central Pharmacy Store", "kind": CENTRAL, "code": "CPS", "active": 1, "staff": "[]",
			"store": "Pharmacy"}).insert(ignore_permissions=True)


def _seed_store():
	"""The aesthetic store starts with its central hub and the Aesthetic console's branches; more are added in Branches & Stores."""
	cfg = _cfg()
	if cfg.store == "Pharmacy" or frappe.db.exists(LOC_DT, {"store": cfg.store}):
		return
	frappe.get_doc({"doctype": LOC_DT, "location_name": cfg.central, "kind": CENTRAL, "code": cfg.central_code, "active": 1, "staff": "[]",
		"store": cfg.store}).insert(ignore_permissions=True)
	for name, code, city in AESTHETIC_BRANCHES:
		frappe.get_doc({"doctype": LOC_DT, "location_name": name, "kind": BRANCH, "code": code, "address": city, "active": 1, "staff": "[]",
			"store": cfg.store}).insert(ignore_permissions=True)


def _sync_care_branches():
	"""Every Care branch (Care portal branch directory) is a pharmacy branch."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_access import care_branches

		branches = care_branches()
	except Exception:
		return
	for b in branches:
		existing = frappe.db.get_value(LOC_DT, {"care_branch_id": b["id"]}, ["name", "active"], as_dict=True)
		if existing:
			continue
		frappe.get_doc(
			{
				"doctype": LOC_DT, "location_name": f"{b['name']} Pharmacy", "kind": BRANCH, "code": b.get("code") or "",
				"care_branch_id": b["id"], "address": b.get("city") or "", "active": 1 if b.get("active", 1) else 0, "staff": "[]",
				"store": "Pharmacy",
			}
		).insert(ignore_permissions=True)


# ---------------------------------------------------------------- access


def _list(value):
	if not value:
		return []
	if isinstance(value, list):
		return value
	try:
		data = json.loads(value)
	except ValueError:
		return []
	return data if isinstance(data, list) else []


def _ctx():
	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	level = None
	info = {}
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_access import _user_portal_perms

		info = _user_portal_perms(user) or {}
		if info.get("managed"):
			level = ((info.get("portals") or {}).get("ops") or {}).get("Inventory & Purchase", "none")
	except Exception:
		info = {}
	role_manager = bool(roles & MANAGER_ROLES)
	manager = role_manager or level in ("approve", "manage")
	cfg = _cfg()
	locations = frappe.get_all(LOC_DT, filters={"store": cfg.store}, fields=["name", "location_name", "kind", "care_branch_id", "staff", "active", "address", "code"],
		limit_page_length=500)
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	branch_level = None
	if manager:
		mine = {l.name for l in locations}
	elif cfg.portal:
		mine = set()
		levels = {"none": 0, "view": 1, "create": 2, "edit": 3, "approve": 4, "manage": 5}
		portal_level = ((info.get("portals") or {}).get(cfg.portal) or {}).get(AESTHETIC_MODULE) if info.get("managed") else None
		if portal_level is not None:
			branch_level = levels.get(portal_level, 0)
		elif roles & {"Aesthetic Staff", "Aesthetic Manager"}:
			branch_level = levels["manage"] if "Aesthetic Manager" in roles else levels["create"]
		unit = cstr(frappe.db.get_value("Employee", employee, "people_unit")) if employee and frappe.get_meta("Employee").has_field("people_unit") else ""
		for l in locations:
			if l.kind != BRANCH:
				continue
			keys = {k.lower() for k in (l.location_name.split(" ")[0], l.address or "", l.code or "") if len(k or "") >= 3}
			if user in _list(l.staff) or (branch_level or 0) >= levels["approve"] or (unit and any(k in unit.lower() for k in keys)):
				mine.add(l.name)
	else:
		mine = set()
		care_ids = set()
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_people_access import care_scope

			care = info.get("care") or {}
			scope = care_scope(care.get("employee") or employee, care.get("branches") or []) if (care or employee) else {}
			care_ids = set(scope.get("ids") or [])
			if scope.get("all"):
				care_ids = {cint(l.care_branch_id) for l in locations if l.care_branch_id}
		except Exception:
			pass
		for l in locations:
			if user in _list(l.staff) or (l.care_branch_id and cint(l.care_branch_id) in care_ids):
				mine.add(l.name)
	blocked = level == "none" and not role_manager and not branch_level
	member = not blocked and (manager or bool(mine) or "Operations Staff" in roles or level in ("view", "create", "edit") or bool(branch_level))
	write = not blocked and (manager or level in ("create", "edit") or (level is None and ("Operations Staff" in roles or bool(mine)))
		or (bool(mine) and (branch_level or 0) >= 2))
	return frappe._dict(user=user, manager=manager, member=member, write=write, branches=mine, level=level, branch_level=branch_level)


def _require(ctx, what="member"):
	label = _cfg().label
	if not ctx.member:
		frappe.throw(_("You do not have access to {0} stock. Ask HR to give you access in Portal Access.").format(label), frappe.PermissionError)
	if what == "manager" and not ctx.manager:
		frappe.throw(_("Only the Operations Manager can do this"), frappe.PermissionError)
	if what == "write" and not ctx.write:
		frappe.throw(_("Your access to {0} is view-only").format(label), frappe.PermissionError)


def _require_branch(ctx, location):
	if ctx.manager:
		return
	if location not in ctx.branches:
		frappe.throw(_("You can only work with your own branch"), frappe.PermissionError)


def _actor():
	return frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user


def _audit(action, ref_type="", ref_no="", detail=""):
	frappe.get_doc(
		{"doctype": AUD_DT, "at": now_datetime(), "action": action[:140], "ref_type": ref_type, "ref_no": ref_no, "detail": cstr(detail)[:1000], "actor": _actor()[:140],
			"domain": _dom()}
	).insert(ignore_permissions=True)


def _next_no(doctype, field, prefix):
	year = getdate(today()).strftime("%y")
	stem = f"{prefix}-{year}-"
	last = frappe.db.sql(f"select `{field}` from `tab{doctype}` where `{field}` like %s order by `{field}` desc limit 1", (stem + "%",))
	n = cint(last[0][0].rsplit("-", 1)[-1]) + 1 if last else 1
	return f"{stem}{n:04d}"


# ---------------------------------------------------------------- lookups


def _items():
	return {r.name: r for r in frappe.get_all(MED_DT, filters={"domain": _dom()}, fields=["*"], limit_page_length=5000)}


def _locations():
	return {r.name: r for r in frappe.get_all(LOC_DT, filters={"store": _store()}, fields=["*"], limit_page_length=500)}


def _location(name):
	"""A location of the current store."""
	if not name or frappe.db.get_value(LOC_DT, name, "store") != _store():
		frappe.throw(_("Choose a location of the {0} store").format(_store()))
	return name


def _central():
	name = frappe.db.get_value(LOC_DT, {"kind": CENTRAL, "active": 1, "store": _store()}, "name")
	if not name:
		frappe.throw(_("Set up an active Central Store location first"))
	return name


def _expired(expiry):
	return bool(expiry) and getdate(expiry) <= getdate(today())


def _batch_row(name):
	b = frappe.db.get_value(BATCH_DT, name, ["name", "item", "batch_no", "expiry_date", "mfg_date", "rate", "mrp", "vendor"], as_dict=True)
	if not b:
		frappe.throw(_("Batch not found"))
	return b


# ---------------------------------------------------------------- stock movement


def _move(location, item, batch, qty, voucher_type, voucher_no, note=""):
	"""The only place stock changes. qty is signed (whole units). Writes the ledger row."""
	qty = cint(qty)
	if not qty:
		return 0
	row = frappe.db.sql(f"select name, qty from `tab{BIN_DT}` where location=%s and batch=%s for update", (location, batch), as_dict=True)
	if row:
		new = cint(row[0].qty) + qty
		if new < 0:
			b = _batch_row(batch)
			frappe.throw(_("Not enough stock of batch {0}: {1} available, {2} needed").format(b.batch_no, cint(row[0].qty), -qty))
		frappe.db.set_value(BIN_DT, row[0].name, "qty", new, update_modified=False)
	else:
		if qty < 0:
			b = _batch_row(batch)
			frappe.throw(_("No stock of batch {0} at this location").format(b.batch_no))
		new = qty
		frappe.get_doc({"doctype": BIN_DT, "location": location, "item": item, "batch": batch, "qty": new}).insert(ignore_permissions=True)
	erp_voucher = _erp().push(location, item, batch, qty, voucher_type, voucher_no, note) or (voucher_no if frappe.flags.ops_erp_pull else "")
	frappe.get_doc(
		{
			"doctype": LEDGER_DT, "posted_on": now_datetime(), "location": location, "item": item, "batch": batch, "qty": qty,
			"balance": new, "voucher_type": voucher_type, "voucher_no": voucher_no, "note": cstr(note)[:500], "actor": _actor()[:140],
			"erp_voucher": cstr(erp_voucher)[:140], "domain": frappe.db.get_value(MED_DT, item, "domain") or PHARMACY,
		}
	).insert(ignore_permissions=True)
	return new


def _erp():
	from health_ecosystem_core.health_ecosystem_core import clinical_ops_pharmacy_erp as erp

	return erp


def _vendors():
	from health_ecosystem_core.health_ecosystem_core import clinical_ops_vendors as vendors

	return vendors


def _bin_qty(location, batch):
	return cint(frappe.db.get_value(BIN_DT, {"location": location, "batch": batch}, "qty"))


def _fefo(source, item, qty):
	"""First-expiry-first-out allocation from non-expired batches at `source`."""
	rows = frappe.db.sql(
		f"""select b.name batch, b.batch_no, b.expiry_date, b.mrp, b.rate, bin.qty
		from `tab{BIN_DT}` bin join `tab{BATCH_DT}` b on b.name = bin.batch
		where bin.location=%s and bin.item=%s and bin.qty > 0 and (b.expiry_date is null or b.expiry_date > %s)
		order by b.expiry_date is null, b.expiry_date asc, b.creation asc""",
		(source, item, today()),
		as_dict=True,
	)
	left = cint(qty)
	picks = []
	for r in rows:
		if left <= 0:
			break
		take = min(left, cint(r.qty))
		picks.append({"batch": r.batch, "batch_no": r.batch_no, "expiry": cstr(r.expiry_date or ""), "qty": take, "mrp": flt(r.mrp), "rate": flt(r.rate)})
		left -= take
	return picks, max(left, 0)


# ---------------------------------------------------------------- masters


def save_medicine(ctx, data):
	_require(ctx, "manager")
	cfg = _cfg()
	name = cstr(data.get("medicine_name")).strip()
	if not name:
		frappe.throw(_("{0} name is required").format(cfg.noun.title()))
	dup = frappe.db.get_value(MED_DT, {"medicine_name": name, "domain": _dom()}, "name")
	doc_id = cstr(data.get("id")).strip()
	if dup and dup != doc_id:
		frappe.throw(_("{0} already exists").format(name))
	pharmacy = _dom() == PHARMACY
	values = {
		"medicine_name": name[:140], "generic_name": cstr(data.get("generic_name"))[:140],
		"dosage_form": cstr(data.get("dosage_form") or ("Tablet" if pharmacy else ""))[:40], "strength": cstr(data.get("strength"))[:60],
		"pack_size": cstr(data.get("pack_size"))[:60], "uom": cstr(data.get("uom") or ("Strip" if pharmacy else "Nos"))[:30],
		"category": cstr(data.get("category") or ("Medicine" if pharmacy else cfg.noun.title()))[:60],
		"schedule": cstr(data.get("schedule") or ("OTC" if pharmacy else ""))[:10],
		"hsn_code": cstr(data.get("hsn_code"))[:20], "gst_rate": flt(data.get("gst_rate")), "mrp": flt(data.get("mrp")),
		"reorder_central": max(cint(data.get("reorder_central")), 0), "reorder_branch": max(cint(data.get("reorder_branch")), 0),
		"storage": cstr(data.get("storage") or "Normal")[:30], "active": 1 if cint(data.get("active", 1)) else 0,
		"brand": cstr(data.get("brand"))[:140], "transfer_price": max(flt(data.get("transfer_price")), 0), "domain": _dom(),
	}
	if cfg.transfer_price and values["transfer_price"] and values["mrp"] and values["transfer_price"] > values["mrp"]:
		frappe.throw(_("Transfer price cannot be above the MRP / retail price"))
	if doc_id:
		doc = frappe.get_doc(MED_DT, doc_id)
		_same_domain(doc)
		doc.update(values)
		doc.save(ignore_permissions=True)
		_audit(f"{cfg.noun.title()} updated", MED_DT, doc.item_code, name)
	else:
		code = cstr(data.get("item_code")).strip() or _next_med_code()
		if frappe.db.exists(MED_DT, {"item_code": code}):
			frappe.throw(_("Item code {0} is already used").format(code))
		doc = frappe.get_doc({"doctype": MED_DT, "item_code": code, **values}).insert(ignore_permissions=True)
		_audit(f"{cfg.noun.title()} added", MED_DT, code, name)
	if _erp().enabled():
		with _erp()._system():
			_erp().ensure_item(doc)
	return doc.as_dict()


def _next_med_code():
	prefix = _cfg().prefix
	last = frappe.db.sql(f"select item_code from `tab{MED_DT}` where item_code like %s order by item_code desc limit 1", (prefix + "-%",))
	return f"{prefix}-{(cint(last[0][0].split('-')[-1]) + 1) if last else 1:04d}"


def save_vendor(ctx, data):
	_require(ctx, "manager")
	name = cstr(data.get("vendor_name")).strip()
	if not name:
		frappe.throw(_("Vendor name is required"))
	doc_id = cstr(data.get("id")).strip()
	dup = frappe.db.get_value(VEN_DT, {"vendor_name": name}, "name")
	if dup and dup != doc_id:
		frappe.throw(_("{0} already exists").format(name))
	values = {k: cstr(data.get(k))[:200] for k in ("category", "gstin", "drug_license", "contact_person", "phone", "email", "address")}
	values.update({"vendor_name": name[:140], "active": 1 if cint(data.get("active", 1)) else 0})
	_vendors().ensure()
	current = frappe.db.get_value(VEN_DT, doc_id, "status") if doc_id else ""
	values["status"] = "Inactive" if not values["active"] else (current if current in ("Active", "On Hold") else "Active")
	if not doc_id:
		values["vendor_code"] = _vendors()._next_code()
	if doc_id:
		doc = frappe.get_doc(VEN_DT, doc_id)
		doc.update(values)
		doc.save(ignore_permissions=True)
		_audit("Vendor updated", VEN_DT, name)
	else:
		doc = frappe.get_doc({"doctype": VEN_DT, **values}).insert(ignore_permissions=True)
		_audit("Vendor added", VEN_DT, name)
	return doc.as_dict()


def save_location(ctx, data):
	_require(ctx, "manager")
	name = cstr(data.get("location_name")).strip()
	if not name:
		frappe.throw(_("Location name is required"))
	kind = CENTRAL if data.get("kind") == CENTRAL else BRANCH
	staff = sorted({cstr(s).strip().lower() for s in _list(data.get("staff")) if cstr(s).strip()})
	for s in staff:
		if not frappe.db.exists("User", s):
			frappe.throw(_("{0} is not a portal login").format(s))
	values = {"location_name": name[:140], "kind": kind, "code": cstr(data.get("code"))[:20], "address": cstr(data.get("address"))[:500],
		"staff": json.dumps(staff), "active": 1 if cint(data.get("active", 1)) else 0}
	doc_id = cstr(data.get("id")).strip()
	if kind == CENTRAL and frappe.db.exists(LOC_DT, {"kind": CENTRAL, "store": _store(), "active": 1, "name": ["!=", doc_id or "-"]}):
		frappe.throw(_("The {0} store already has a central store").format(_store()))
	if doc_id:
		doc = frappe.get_doc(LOC_DT, _location(doc_id))
		if doc.care_branch_id:
			values.pop("location_name")
		doc.update(values)
		doc.save(ignore_permissions=True)
		_audit("Location updated", LOC_DT, doc.location_name, f"staff: {', '.join(staff) or '-'}")
	else:
		doc = frappe.get_doc({"doctype": LOC_DT, "store": _store(), **values}).insert(ignore_permissions=True)
		_audit("Location added", LOC_DT, name, kind)
	if _erp().enabled():
		with _erp()._system():
			_erp().location_warehouse(doc.name)
	return doc.as_dict()


# ---------------------------------------------------------------- purchases


def save_purchase(ctx, data):
	_require(ctx, "manager")
	opening = bool(cint(data.get("opening")))
	vendor = cstr(data.get("vendor"))
	invoice = cstr(data.get("invoice_no")).strip()
	if opening:
		vendor = vendor if vendor and frappe.db.exists(VEN_DT, vendor) else ""
		invoice = invoice or "Opening stock"
	else:
		if not vendor or not frappe.db.exists(VEN_DT, vendor):
			frappe.throw(_("Choose the vendor"))
		if not invoice:
			frappe.throw(_("Enter the vendor invoice number"))
		if frappe.db.exists(PUR_DT, {"vendor": vendor, "invoice_no": invoice}):
			frappe.throw(_("Invoice {0} from this vendor is already entered").format(invoice))
	location = _location(cstr(data.get("location")) or _central())
	purchase_no, _lines = _post_purchase(
		location, vendor, invoice, data.get("invoice_date"), data.get("lines"),
		voucher="Opening Stock" if opening else "Purchase", prefix="OPN" if opening else "GRN",
		status="Opening Stock" if opening else "Received", note=data.get("note"), source="Opening" if opening else "Central",
		ledger_note=invoice if opening else f"Invoice {invoice}",
	)
	_audit("Opening stock entered" if opening else "Purchase received", PUR_DT, purchase_no, f"{len(_lines)} line(s), {invoice}")
	return {"purchase_no": purchase_no}


def _post_purchase(location, vendor, invoice, invoice_date, raw_lines, voucher, prefix, status, note="", source="", external_request="", ledger_note="", only_item=None):
	"""Validate purchase lines, create batches and add the stock at `location`. Expired batches are refused."""
	_vendors().check_vendor_open(vendor)
	items = _items()
	lines = []
	for raw in _list(raw_lines):
		item = cstr(raw.get("item")) or (only_item or "")
		if item not in items:
			frappe.throw(_("Choose a {0} on every line").format(_cfg().noun))
		if only_item and item != only_item:
			frappe.throw(_("Only {0} is approved on this request").format(items[only_item].medicine_name))
		batch_no = cstr(raw.get("batch_no")).strip().upper()
		if not batch_no:
			frappe.throw(_("Enter the batch number for {0}").format(items[item].medicine_name))
		expiry = getdate(raw.get("expiry_date")) if raw.get("expiry_date") else None
		mfg = getdate(raw.get("mfg_date")) if raw.get("mfg_date") else None
		if not expiry:
			frappe.throw(_("Enter the expiry date for batch {0}").format(batch_no))
		if _expired(expiry):
			frappe.throw(_("Batch {0} of {1} is already expired and cannot be received").format(batch_no, items[item].medicine_name))
		if mfg and mfg > getdate(today()):
			frappe.throw(_("Manufacturing date of batch {0} is in the future").format(batch_no))
		if mfg and mfg >= expiry:
			frappe.throw(_("Batch {0}: expiry must be after the manufacturing date").format(batch_no))
		qty = cint(raw.get("qty"))
		free = max(cint(raw.get("free_qty")), 0)
		if qty <= 0:
			frappe.throw(_("Quantity must be more than zero for batch {0}").format(batch_no))
		lines.append({"item": item, "item_name": items[item].medicine_name, "batch_no": batch_no, "mfg_date": cstr(mfg or ""), "expiry_date": cstr(expiry),
			"qty": qty, "free_qty": free, "rate": flt(raw.get("rate")), "mrp": flt(raw.get("mrp")) or flt(items[item].mrp)})
	if not lines:
		frappe.throw(_("Add at least one {0} line").format(_cfg().noun))
	if invoice_date and getdate(invoice_date) > getdate(today()):
		frappe.throw(_("Invoice date cannot be in the future"))
	purchase_no = _next_no(PUR_DT, "purchase_no", prefix)
	doc = frappe.get_doc(
		{
			"doctype": PUR_DT, "purchase_no": purchase_no, "vendor": vendor, "invoice_no": cstr(invoice)[:60],
			"invoice_date": getdate(invoice_date) if invoice_date else getdate(today()),
			"location": location, "status": status, "note": cstr(note)[:500], "actor": _actor()[:140],
			"total": round(sum(l["qty"] * l["rate"] for l in lines), 2), "lines": "[]", "source": source, "external_request": external_request,
			"domain": _dom(),
		}
	).insert(ignore_permissions=True)
	for l in lines:
		batch = frappe.db.get_value(BATCH_DT, {"item": l["item"], "batch_no": l["batch_no"]}, ["name", "expiry_date"], as_dict=True)
		if batch:
			if cstr(batch.expiry_date) != l["expiry_date"]:
				frappe.throw(_("Batch {0} is already recorded with expiry {1}").format(l["batch_no"], format_date(batch.expiry_date)))
			batch_id = batch.name
		else:
			batch_id = frappe.get_doc(
				{"doctype": BATCH_DT, "item": l["item"], "batch_no": l["batch_no"], "mfg_date": l["mfg_date"] or None, "expiry_date": l["expiry_date"],
					"vendor": vendor, "purchase": purchase_no, "rate": l["rate"], "mrp": l["mrp"]}
			).insert(ignore_permissions=True).name
		l["batch"] = batch_id
		_move(location, l["item"], batch_id, l["qty"] + l["free_qty"], voucher, purchase_no, ledger_note or f"Invoice {invoice}")
	doc.lines = json.dumps(lines)
	doc.save(ignore_permissions=True)
	return purchase_no, lines


# ---------------------------------------------------------------- branch purchases from outside vendors

# A branch may buy medicines from an outside vendor only on an approved request: it states the medicine,
# quantity, vendor, price and reason; the Operations Manager approves (possibly a lower quantity / price
# cap, valid for a limited time) or rejects. Only then can the branch record the purchase, within the
# approved medicine, quantity, price and date, and the stock lands in the branch ledger.


def _ext(ext_no):
	name = frappe.db.get_value(EXT_DT, {"ext_no": ext_no}, "name") or (ext_no if frappe.db.exists(EXT_DT, ext_no) else None)
	if not name:
		frappe.throw(_("Purchase request not found"))
	doc = frappe.get_doc(EXT_DT, name)
	_same_domain(doc)
	return doc


def save_external_request(ctx, data):
	_require(ctx, "write")
	if not _cfg().external:
		frappe.throw(_("Outside purchases are not used for {0}").format(_cfg().label))
	location = cstr(data.get("location"))
	locs = _locations()
	if location not in locs or locs[location].kind != BRANCH:
		frappe.throw(_("Choose the branch that wants to buy"))
	_require_branch(ctx, location)
	items = _items()
	item = cstr(data.get("item"))
	noun = _cfg().noun
	if item and item not in items:
		frappe.throw(_("Choose the {0} from the list, or type its name if it is not listed").format(noun))
	name = items[item].medicine_name if item else cstr(data.get("medicine_name")).strip()
	if not name:
		frappe.throw(_("Which {0} do you want to buy?").format(noun))
	qty = cint(data.get("qty"))
	if qty <= 0:
		frappe.throw(_("Quantity must be more than zero"))
	price = flt(data.get("unit_price"))
	if price <= 0:
		frappe.throw(_("Enter the vendor's price per unit"))
	vendor = cstr(data.get("vendor_name")).strip()
	if not vendor:
		frappe.throw(_("Enter the vendor"))
	reason = cstr(data.get("reason")).strip()
	if len(reason) < 5:
		frappe.throw(_("Explain why the {0} must be bought outside the central store").format(noun))
	ext_no = _next_no(EXT_DT, "ext_no", "EPR")
	frappe.get_doc(
		{
			"doctype": EXT_DT, "ext_no": ext_no, "location": location, "item": item, "medicine_name": name[:140], "qty": qty,
			"unit_price": price, "vendor_name": vendor[:140], "vendor_gstin": cstr(data.get("vendor_gstin")).strip().upper()[:20],
			"vendor_phone": cstr(data.get("vendor_phone")).strip()[:20], "reason": reason[:1000],
			"urgency": cstr(data.get("urgency") or "Normal")[:20], "status": "Pending", "requested_by": frappe.session.user,
			"requested_by_name": _actor()[:140], "received_qty": 0, "receipts": "[]", "domain": _dom(),
		}
	).insert(ignore_permissions=True)
	_audit("Outside purchase requested", EXT_DT, ext_no, f"{locs[location].location_name}: {name} × {qty} @ {price} from {vendor}")
	return {"ext_no": ext_no}


def decide_external_request(ctx, ext_no, action, data):
	_require(ctx, "manager")
	doc = _ext(ext_no)
	if doc.status != "Pending":
		frappe.throw(_("This request is already {0}").format(doc.status.lower()))
	data = data if isinstance(data, dict) else {}
	note = cstr(data.get("note")).strip()
	if action == "reject":
		if not note:
			frappe.throw(_("Give the branch a reason for rejecting"))
		doc.status = "Rejected"
	else:
		items = _items()
		item = cstr(data.get("item") or doc.item)
		if item not in items:
			frappe.throw(_("Pick the {0} from the master (add it first if it is new)").format(_cfg().noun))
		qty = cint(data.get("approved_qty") or doc.qty)
		if qty <= 0 or qty > cint(doc.qty):
			frappe.throw(_("Approve between 1 and {0}").format(doc.qty))
		price = flt(data.get("approved_price") or doc.unit_price)
		if price <= 0:
			frappe.throw(_("Enter the highest price per unit the branch may pay"))
		days = min(max(cint(data.get("valid_days") or EXT_VALID_DAYS), 1), 90)
		vendor = frappe.db.get_value(VEN_DT, {"vendor_name": doc.vendor_name}, "name")
		if not vendor:
			_vendors().ensure()
			vendor = frappe.get_doc(
				{"doctype": VEN_DT, "vendor_name": doc.vendor_name, "gstin": doc.vendor_gstin, "phone": doc.vendor_phone,
					"category": {"aes_product": "Device & Peel", "aes_consumable": "Consumable"}.get(_dom(), "Medicine"), "active": 1, "status": "Active",
					"vendor_code": _vendors()._next_code(),
					"notes": f"Branch local vendor (added from outside purchase request {doc.ext_no})"}
			).insert(ignore_permissions=True).name
			_audit("Vendor added", VEN_DT, doc.vendor_name, f"From outside purchase request {doc.ext_no}")
		doc.item = item
		doc.medicine_name = items[item].medicine_name
		doc.vendor = vendor
		doc.approved_qty = qty
		doc.approved_price = price
		doc.valid_until = add_days(getdate(today()), days)
		doc.status = "Approved" if qty >= cint(doc.qty) and price >= flt(doc.unit_price) else "Partially Approved"
	doc.decided_by = _actor()[:140]
	doc.decided_on = now_datetime()
	doc.decision_note = note[:500]
	doc.save(ignore_permissions=True)
	detail = note if action == "reject" else f"{doc.approved_qty} @ max {doc.approved_price}, valid until {format_date(doc.valid_until)}. {note}"
	_audit(f"Outside purchase {doc.status.lower()}", EXT_DT, doc.ext_no, detail)
	return {"status": doc.status}


def cancel_external_request(ctx, ext_no):
	_require(ctx, "write")
	doc = _ext(ext_no)
	_require_branch(ctx, doc.location)
	if doc.status not in ("Pending",) + EXT_OPEN or cint(doc.received_qty):
		frappe.throw(_("Only requests with nothing bought yet can be cancelled"))
	doc.status = "Cancelled"
	doc.save(ignore_permissions=True)
	_audit("Outside purchase cancelled", EXT_DT, doc.ext_no)
	return {"status": doc.status}


def receive_external(ctx, data):
	"""The branch records an approved outside purchase: stock comes in at the branch, within the approval."""
	_require(ctx, "write")
	doc = _ext(cstr(data.get("ext_no")))
	_require_branch(ctx, doc.location)
	if doc.status not in EXT_OPEN:
		if doc.status == "Pending":
			frappe.throw(_("{0} is waiting for the Operations Manager's approval. Purchases cannot be entered before approval.").format(doc.ext_no))
		frappe.throw(_("{0} is {1}; no purchase can be entered on it").format(doc.ext_no, doc.status.lower()))
	if doc.valid_until and getdate(doc.valid_until) < getdate(today()):
		frappe.throw(_("The approval for {0} expired on {1}. Raise a new request.").format(doc.ext_no, format_date(doc.valid_until)))
	invoice = cstr(data.get("invoice_no")).strip()
	if not invoice:
		frappe.throw(_("Enter the vendor's bill / invoice number"))
	if frappe.db.exists(PUR_DT, {"vendor": doc.vendor, "invoice_no": invoice}):
		frappe.throw(_("Invoice {0} from this vendor is already entered").format(invoice))
	lines = _list(data.get("lines"))
	left = cint(doc.approved_qty) - cint(doc.received_qty)
	asked = sum(cint(l.get("qty")) + max(cint(l.get("free_qty")), 0) for l in lines)
	if asked > left:
		frappe.throw(_("Only {0} more can be bought on {1}").format(left, doc.ext_no))
	for l in lines:
		if flt(l.get("rate")) > flt(doc.approved_price) + 0.005:
			frappe.throw(_("Price ₹{0} is above the approved ₹{1} per unit. Ask for a new approval.").format(flt(l.get("rate")), flt(doc.approved_price)))
		if flt(l.get("rate")) <= 0:
			frappe.throw(_("Enter the price paid per unit"))
	purchase_no, posted = _post_purchase(
		doc.location, doc.vendor, invoice, data.get("invoice_date"), lines, voucher=EXTERNAL, prefix="BGRN", status="Received at branch",
		note=data.get("note"), source="Branch external", external_request=doc.ext_no, ledger_note=f"{doc.ext_no} · {doc.vendor_name} invoice {invoice}",
		only_item=doc.item,
	)
	got = sum(l["qty"] + l["free_qty"] for l in posted)
	receipts = _list(doc.receipts)
	receipts.append({"purchase_no": purchase_no, "invoice_no": invoice, "qty": got, "at": cstr(now_datetime()), "by": _actor(),
		"batches": [{"batch_no": l["batch_no"], "expiry": l["expiry_date"], "qty": l["qty"] + l["free_qty"], "rate": l["rate"]} for l in posted]})
	doc.receipts = json.dumps(receipts)
	doc.received_qty = cint(doc.received_qty) + got
	doc.status = "Received" if doc.received_qty >= cint(doc.approved_qty) else "Partially Received"
	doc.save(ignore_permissions=True)
	_audit("Outside purchase received", EXT_DT, doc.ext_no, f"{purchase_no}: {got} unit(s), invoice {invoice}")
	return {"purchase_no": purchase_no, "status": doc.status}


def _ext_rows(scope):
	rows = frappe.get_all(EXT_DT, filters={"domain": _dom()}, fields=["*"], order_by="creation desc", limit_page_length=300)
	out = []
	for r in rows:
		if scope is not None and r.location not in scope:
			continue
		r.receipts = _list(r.receipts)
		for k in ("creation", "modified", "decided_on", "valid_until"):
			if r.get(k):
				r[k] = cstr(r[k])
		r.expired_approval = bool(r.valid_until and r.status in EXT_OPEN and getdate(r.valid_until) < getdate(today()))
		out.append(r)
	return out


# ---------------------------------------------------------------- requisitions


def save_requisition(ctx, data):
	_require(ctx, "write")
	location = cstr(data.get("location"))
	locs = _locations()
	noun = _cfg().noun
	if location not in locs or locs[location].kind != BRANCH:
		frappe.throw(_("Choose the branch that needs the {0}s").format(noun))
	_require_branch(ctx, location)
	items = _items()
	merged = {}
	for raw in _list(data.get("lines")):
		item = cstr(raw.get("item"))
		qty = cint(raw.get("qty"))
		if item not in items or not cint(items[item].active):
			frappe.throw(_("Choose an active {0} on every line").format(noun))
		if qty <= 0:
			frappe.throw(_("Quantity must be more than zero"))
		merged[item] = merged.get(item, 0) + qty
	if not merged:
		frappe.throw(_("Add at least one {0}").format(noun))
	lines = [{"item": i, "item_name": items[i].medicine_name, "uom": items[i].uom, "qty": q, "approved": 0, "dispatched": 0, "delivered": 0} for i, q in merged.items()]
	req_no = _next_no(REQ_DT, "req_no", _prefix("req"))
	frappe.get_doc(
		{
			"doctype": REQ_DT, "req_no": req_no, "location": location, "priority": cstr(data.get("priority") or "Normal")[:20],
			"required_by": getdate(data.get("required_by")) if data.get("required_by") else None, "status": "Pending",
			"lines": json.dumps(lines), "note": cstr(data.get("note"))[:500], "requested_by": frappe.session.user, "requested_by_name": _actor()[:140],
			"domain": _dom(),
		}
	).insert(ignore_permissions=True)
	_audit("Requisition raised", REQ_DT, req_no, f"{locs[location].location_name}: {len(lines)} {noun}(s)")
	return {"req_no": req_no}


def _req(req_no):
	name = frappe.db.get_value(REQ_DT, {"req_no": req_no}, "name") or (req_no if frappe.db.exists(REQ_DT, req_no) else None)
	if not name:
		frappe.throw(_("Requisition not found"))
	doc = frappe.get_doc(REQ_DT, name)
	_same_domain(doc)
	return doc


def _req_status(doc, lines):
	if doc.status in ("Rejected", "Cancelled"):
		return doc.status
	approved = sum(l["approved"] for l in lines)
	if approved <= 0:
		return doc.status
	dispatched = sum(l["dispatched"] for l in lines)
	delivered = sum(l["delivered"] for l in lines)
	if delivered >= approved:
		return "Completed"
	if dispatched >= approved:
		return "Dispatched"
	if dispatched > 0:
		return "Partially Dispatched"
	return "Approved" if all(l["approved"] >= l["qty"] for l in lines) else "Partially Approved"


def decide_requisition(ctx, req_no, action, approvals, note):
	_require(ctx, "manager")
	doc = _req(req_no)
	if doc.status != "Pending":
		frappe.throw(_("This requisition is already {0}").format(doc.status.lower()))
	lines = _list(doc.lines)
	note = cstr(note).strip()
	if action == "reject":
		if not note:
			frappe.throw(_("Give the branch a reason for rejecting"))
		doc.status = "Rejected"
	else:
		approved = {cstr(a.get("item")): cint(a.get("approved")) for a in _list(approvals)}
		for l in lines:
			l["approved"] = min(max(approved.get(l["item"], l["qty"]), 0), l["qty"])
		if not any(l["approved"] for l in lines):
			if not note:
				frappe.throw(_("Nothing is approved. Reject the requisition with a reason instead."))
			doc.status = "Rejected"
		else:
			doc.status = "Approved" if all(l["approved"] >= l["qty"] for l in lines) else "Partially Approved"
	doc.lines = json.dumps(lines)
	doc.decided_by = _actor()[:140]
	doc.decided_on = now_datetime()
	doc.decision_note = note[:500]
	doc.save(ignore_permissions=True)
	_audit(f"Requisition {doc.status.lower()}", REQ_DT, doc.req_no, note)
	return {"status": doc.status}


def cancel_requisition(ctx, req_no):
	_require(ctx, "write")
	doc = _req(req_no)
	if not ctx.manager and doc.requested_by != frappe.session.user:
		_require_branch(ctx, doc.location)
	lines = _list(doc.lines)
	if doc.status not in ("Pending", "Approved", "Partially Approved") or any(l["dispatched"] for l in lines):
		frappe.throw(_("Only requisitions that have not been dispatched can be cancelled"))
	doc.status = "Cancelled"
	doc.save(ignore_permissions=True)
	_audit("Requisition cancelled", REQ_DT, doc.req_no)
	return {"status": doc.status}


# ---------------------------------------------------------------- dispatch


def plan_dispatch(ctx, req_no=None, destination=None, lines=None, source=None):
	_require(ctx, "manager")
	source = _location(cstr(source) or _central())
	items = _items()
	wanted = []
	if req_no:
		doc = _req(req_no)
		if doc.status not in ("Approved", "Partially Approved", "Partially Dispatched"):
			frappe.throw(_("Only approved requisitions can be dispatched"))
		destination = doc.location
		over = {cstr(l.get("item")): cint(l.get("qty")) for l in _list(lines)}
		for l in _list(doc.lines):
			remaining = l["approved"] - l["dispatched"]
			if remaining > 0:
				wanted.append((l["item"], min(over.get(l["item"], remaining), remaining)))
	else:
		for l in _list(lines):
			if cstr(l.get("item")) in items and cint(l.get("qty")) > 0:
				wanted.append((cstr(l.get("item")), cint(l.get("qty"))))
	if not destination or frappe.db.get_value(LOC_DT, destination, "store") != _store():
		frappe.throw(_("Choose the destination branch"))
	if destination == source:
		frappe.throw(_("Source and destination are the same"))
	plan = []
	for item, qty in wanted:
		if qty <= 0:
			continue
		picks, short = _fefo(source, item, qty)
		plan.append({"item": item, "item_name": items[item].medicine_name, "uom": items[item].uom, "wanted": qty, "batches": picks, "short": short})
	return {"source": source, "destination": destination, "lines": plan}


def create_dispatch(ctx, data):
	_require(ctx, "manager")
	req_no = cstr(data.get("requisition")) or None
	plan = plan_dispatch(ctx, req_no, data.get("destination"), data.get("lines"), data.get("source"))
	picked = [(p, b) for p in plan["lines"] for b in p["batches"]]
	if not picked:
		frappe.throw(_("No unexpired stock is available at the source for these {0}s").format(_cfg().noun))
	challan = _next_no(DSP_DT, "challan_no", _prefix("dc"))
	items = _items()
	lines = []
	for p, b in picked:
		_move(plan["source"], p["item"], b["batch"], -b["qty"], "Dispatch", challan, f"To {frappe.db.get_value(LOC_DT, plan['destination'], 'location_name')}")
		lines.append({"item": p["item"], "item_name": p["item_name"], "uom": p["uom"], "batch": b["batch"], "batch_no": b["batch_no"],
			"expiry": b["expiry"], "qty": b["qty"], "mrp": b["mrp"], "rate": b["rate"],
			"transfer_price": flt(items[p["item"]].transfer_price) if _cfg().transfer_price else 0})
	now = now_datetime()
	doc = frappe.get_doc(
		{
			"doctype": DSP_DT, "challan_no": challan, "requisition": req_no or "", "source": plan["source"], "destination": plan["destination"],
			"status": "Dispatched", "lines": json.dumps(lines), "carrier": cstr(data.get("carrier"))[:140], "vehicle_no": cstr(data.get("vehicle_no"))[:40],
			"driver_phone": cstr(data.get("driver_phone"))[:20], "expected_on": getdate(data.get("expected_on")) if data.get("expected_on") else None,
			"events": json.dumps([{"status": "Dispatched", "at": cstr(now), "by": _actor(), "note": cstr(data.get("note"))[:300]}]),
			"dispatched_by": _actor()[:140], "dispatched_on": now, "note": cstr(data.get("note"))[:500], "domain": _dom(),
		}
	).insert(ignore_permissions=True)
	if req_no:
		req = _req(req_no)
		rl = _list(req.lines)
		sent = {}
		for l in lines:
			sent[l["item"]] = sent.get(l["item"], 0) + l["qty"]
		for l in rl:
			l["dispatched"] += sent.get(l["item"], 0)
		req.status = _req_status(req, rl)
		req.lines = json.dumps(rl)
		req.save(ignore_permissions=True)
	short = [f"{p['item_name']} short by {p['short']}" for p in plan["lines"] if p["short"]]
	_audit("Dispatch created", DSP_DT, challan, (f"For {req_no}. " if req_no else "") + ("; ".join(short) if short else "Full quantity"))
	return {"challan_no": challan, "name": doc.name, "short": short}


def _dsp(challan):
	name = frappe.db.get_value(DSP_DT, {"challan_no": challan}, "name") or (challan if frappe.db.exists(DSP_DT, challan) else None)
	if not name:
		frappe.throw(_("Dispatch not found"))
	doc = frappe.get_doc(DSP_DT, name)
	_same_domain(doc)
	return doc


def update_dispatch(ctx, challan, status, note="", received_by="", received=None):
	_require(ctx, "write")
	doc = _dsp(challan)
	status = cstr(status)
	lines = _list(doc.lines)
	events = _list(doc.events)
	if doc.status in ("Delivered", "Cancelled"):
		frappe.throw(_("This dispatch is already {0}").format(doc.status.lower()))
	if status == "Cancelled":
		_require(ctx, "manager")
		for l in lines:
			_move(doc.source, l["item"], l["batch"], l["qty"], "Dispatch Cancelled", doc.challan_no, cstr(note))
		_requisition_progress(doc, lines, "dispatched", -1)
	elif status == "Delivered":
		if not ctx.manager:
			_require_branch(ctx, doc.destination)
		counted = {cstr(r.get("batch")): cint(r.get("qty")) for r in _list(received)} if _cfg().receive_qty else {}
		if any(min(max(counted.get(l["batch"], l["qty"]), 0), l["qty"]) < l["qty"] for l in lines) and not cstr(note).strip():
			frappe.throw(_("Some items are short. Note what was missing or damaged."))
		shortage = 0
		for l in lines:
			got = min(max(counted.get(l["batch"], l["qty"]), 0), l["qty"])
			l["received"] = got
			l["short"] = l["qty"] - got
			shortage += l["short"]
			if got:
				_move(doc.destination, l["item"], l["batch"], got, "Receipt", doc.challan_no, f"Received from {frappe.db.get_value(LOC_DT, doc.source, 'location_name')}")
			if l["short"]:
				_erp().transit_loss(doc.destination, l["item"], l["batch"], l["short"], doc.challan_no)
		doc.shortage = shortage
		doc.lines = json.dumps(lines)
		doc.delivered_on = now_datetime()
		doc.received_by = (cstr(received_by).strip() or _actor())[:140]
		_requisition_progress(doc, lines, "delivered", 1)
		if shortage:
			note = f"Short by {shortage}: {cstr(note).strip()}"
	elif status in DISPATCH_FLOW:
		_require(ctx, "manager")
		if DISPATCH_FLOW.index(status) <= DISPATCH_FLOW.index(doc.status):
			frappe.throw(_("The dispatch is already {0}").format(doc.status.lower()))
	else:
		frappe.throw(_("Unknown status"))
	doc.status = status
	events.append({"status": status, "at": cstr(now_datetime()), "by": _actor(), "note": cstr(note)[:300]})
	doc.events = json.dumps(events)
	doc.save(ignore_permissions=True)
	_audit(f"Dispatch {status.lower()}", DSP_DT, doc.challan_no, cstr(note))
	return {"status": doc.status}


def _requisition_progress(dsp, lines, field, sign):
	if not dsp.requisition:
		return
	req = _req(dsp.requisition)
	rl = _list(req.lines)
	moved = {}
	for l in lines:
		moved[l["item"]] = moved.get(l["item"], 0) + l["qty"]
	for l in rl:
		l[field] = max(l[field] + sign * moved.get(l["item"], 0), 0)
	req.status = _req_status(req, rl)
	req.lines = json.dumps(rl)
	req.save(ignore_permissions=True)


# ---------------------------------------------------------------- returns and adjustments


def _batch_lines(raw_lines, location, need_reason=False, reasons=None):
	out = []
	items = _items()
	for raw in _list(raw_lines):
		batch = cstr(raw.get("batch"))
		qty = cint(raw.get("qty"))
		if not batch or qty == 0:
			continue
		b = _batch_row(batch)
		if b.item not in items:
			frappe.throw(_("Batch {0} is not in the {1} inventory").format(b.batch_no, _cfg().label))
		reason = cstr(raw.get("reason"))
		if need_reason and reasons and reason not in reasons:
			frappe.throw(_("Choose a reason for batch {0}").format(b.batch_no))
		out.append({"item": b.item, "item_name": items[b.item].medicine_name, "batch": batch, "batch_no": b.batch_no,
			"expiry": cstr(b.expiry_date or ""), "qty": qty, "reason": reason, "available": _bin_qty(location, batch)})
	if not out:
		frappe.throw(_("Add at least one batch line"))
	return out


def _ret(return_no):
	name = frappe.db.get_value(RET_DT, {"return_no": return_no}, "name")
	if not name:
		frappe.throw(_("Return not found"))
	doc = frappe.get_doc(RET_DT, name)
	_same_domain(doc)
	return doc


def save_return(ctx, data):
	_require(ctx, "write")
	kind = "Vendor Return" if data.get("kind") == "Vendor Return" else "Branch Return"
	source = _location(cstr(data.get("source")))
	_require_branch(ctx, source)
	vendor = cstr(data.get("vendor"))
	if kind == "Vendor Return":
		_require(ctx, "manager")
		if not frappe.db.exists(VEN_DT, vendor):
			frappe.throw(_("Choose the vendor"))
		destination = ""
	else:
		destination = _central()
		if source == destination:
			frappe.throw(_("Use a vendor return or an adjustment for central store stock"))
	lines = _batch_lines(data.get("lines"), source, True, RETURN_REASONS)
	for l in lines:
		if l["qty"] <= 0 or l["qty"] > l["available"]:
			frappe.throw(_("Batch {0}: return between 1 and {1}").format(l["batch_no"], l["available"]))
	return_no = _next_no(RET_DT, "return_no", _prefix("rt"))
	needs_approval = kind == "Branch Return" and _cfg().return_approval and not ctx.manager
	if not needs_approval:
		_return_out(kind, source, lines, return_no)
	frappe.get_doc(
		{
			"doctype": RET_DT, "return_no": return_no, "kind": kind, "source": source, "destination": destination, "vendor": vendor,
			"status": "Requested" if needs_approval else "Completed" if kind == "Vendor Return" else "In Transit", "lines": json.dumps(lines),
			"reason": ", ".join(sorted({l["reason"] for l in lines})), "note": cstr(data.get("note"))[:500], "actor": _actor()[:140],
			"requested_by": frappe.session.user, "domain": _dom(),
		}
	).insert(ignore_permissions=True)
	_audit(f"{kind} {'requested' if needs_approval else 'created'}", RET_DT, return_no, f"{len(lines)} batch line(s)")
	return {"return_no": return_no, "status": "Requested" if needs_approval else "In Transit"}


def _return_out(kind, source, lines, return_no):
	frappe.flags.ops_return_kind = kind
	try:
		for l in lines:
			if l["qty"] > _bin_qty(source, l["batch"]):
				frappe.throw(_("Batch {0}: only {1} left at the branch").format(l["batch_no"], _bin_qty(source, l["batch"])))
			_move(source, l["item"], l["batch"], -l["qty"], "Return Out", return_no, l["reason"])
	finally:
		frappe.flags.ops_return_kind = None


def decide_return(ctx, return_no, action, note=""):
	"""Ops approval of a branch return request: approved stock leaves the branch on a return challan; rejected stays."""
	_require(ctx, "manager")
	doc = _ret(return_no)
	if doc.status != "Requested":
		frappe.throw(_("This return is already {0}").format(doc.status.lower()))
	note = cstr(note).strip()
	if action == "reject":
		if not note:
			frappe.throw(_("Give the branch a reason for rejecting"))
		doc.status = "Rejected"
	else:
		_return_out(doc.kind, doc.source, _list(doc.lines), doc.return_no)
		doc.status = "In Transit"
	doc.decided_by = _actor()[:140]
	doc.decided_on = now_datetime()
	doc.decision_note = note[:500]
	doc.save(ignore_permissions=True)
	_audit(f"Return {'approved' if doc.status == 'In Transit' else 'rejected'}", RET_DT, doc.return_no, note)
	return {"status": doc.status}


def cancel_return(ctx, return_no):
	_require(ctx, "write")
	doc = _ret(return_no)
	_require_branch(ctx, doc.source)
	if doc.status != "Requested":
		frappe.throw(_("Only return requests waiting for approval can be cancelled"))
	doc.status = "Cancelled"
	doc.save(ignore_permissions=True)
	_audit("Return request cancelled", RET_DT, doc.return_no)
	return {"status": doc.status}


def receive_return(ctx, return_no):
	_require(ctx, "manager")
	doc = _ret(return_no)
	if doc.status != "In Transit":
		frappe.throw(_("This return is already {0}").format(doc.status.lower()))
	for l in _list(doc.lines):
		_move(doc.destination, l["item"], l["batch"], l["qty"], "Return In", doc.return_no, l.get("reason") or "")
	doc.status = "Received"
	doc.received_by = _actor()[:140]
	doc.received_on = now_datetime()
	doc.save(ignore_permissions=True)
	_audit("Return received", RET_DT, doc.return_no)
	return {"status": doc.status}


def save_adjustment(ctx, data):
	_require(ctx, "write")
	location = _location(cstr(data.get("location")))
	_require_branch(ctx, location)
	branch_reasons = tuple(_cfg().branch_reasons)
	lines = _batch_lines(data.get("lines"), location, True, ADJ_REASONS + tuple(r for r in branch_reasons if r not in ADJ_REASONS) if ctx.manager else branch_reasons)
	for l in lines:
		if not ctx.manager and l["qty"] > 0:
			frappe.throw(_("Branches can only record stock going out ({0})").format(", ".join(branch_reasons).lower()))
		if l["available"] + l["qty"] < 0:
			frappe.throw(_("Batch {0}: only {1} in stock").format(l["batch_no"], l["available"]))
		if l["qty"] > 0 and _expired(l["expiry"]) and l["reason"] != "Opening stock":
			frappe.throw(_("Batch {0} is expired; stock cannot be added").format(l["batch_no"]))
	adj_no = _next_no(ADJ_DT, "adj_no", "ADJ")
	for l in lines:
		_move(location, l["item"], l["batch"], l["qty"], "Adjustment", adj_no, l["reason"])
	frappe.get_doc(
		{"doctype": ADJ_DT, "adj_no": adj_no, "location": location, "lines": json.dumps(lines), "reason": ", ".join(sorted({l["reason"] for l in lines})),
			"note": cstr(data.get("note"))[:500], "actor": _actor()[:140], "domain": _dom()}
	).insert(ignore_permissions=True)
	_audit("Stock adjusted", ADJ_DT, adj_no, f"{len(lines)} batch line(s)")
	return {"adj_no": adj_no}


def write_off_expired(ctx, location):
	_require(ctx, "manager")
	rows = frappe.db.sql(
		f"""select bin.batch, bin.qty from `tab{BIN_DT}` bin join `tab{BATCH_DT}` b on b.name = bin.batch join `tab{MED_DT}` m on m.name = bin.item
		where bin.location=%s and bin.qty > 0 and b.expiry_date <= %s and m.domain = %s""",
		(_location(location), today(), _dom()),
		as_dict=True,
	)
	if not rows:
		frappe.throw(_("No expired stock at this location"))
	return save_adjustment(ctx, {"location": location, "note": "Expired stock written off",
		"lines": [{"batch": r.batch, "qty": -cint(r.qty), "reason": "Expiry write-off"} for r in rows]})


# ---------------------------------------------------------------- retail sales (aesthetic products)


def _sale(sale_no):
	name = frappe.db.get_value(SALE_DT, {"sale_no": sale_no}, "name")
	if not name:
		frappe.throw(_("Sale not found"))
	doc = frappe.get_doc(SALE_DT, name)
	_same_domain(doc)
	return doc


def save_sale(ctx, data):
	"""A branch sells products over the counter: stock leaves the branch first-expiry-first-out at the retail price."""
	_require(ctx, "write")
	if not _cfg().sales:
		frappe.throw(_("Sales are not recorded for {0}").format(_cfg().label))
	location = _location(cstr(data.get("location")))
	_require_branch(ctx, location)
	if frappe.db.get_value(LOC_DT, location, "kind") != BRANCH:
		frappe.throw(_("Sales are recorded at a branch"))
	items = _items()
	lines = []
	for raw in _list(data.get("lines")):
		item = cstr(raw.get("item"))
		qty = cint(raw.get("qty"))
		if not item and not qty:
			continue
		if item not in items or not cint(items[item].active):
			frappe.throw(_("Choose an active product on every line"))
		if qty <= 0:
			frappe.throw(_("Quantity must be more than zero"))
		price = flt(raw.get("price")) or flt(items[item].mrp)
		if price <= 0:
			frappe.throw(_("Enter the selling price of {0}").format(items[item].medicine_name))
		if flt(items[item].mrp) and price > flt(items[item].mrp) + 0.005:
			frappe.throw(_("{0} cannot be sold above its MRP ₹{1}").format(items[item].medicine_name, flt(items[item].mrp)))
		picks, short = _fefo(location, item, qty)
		if short:
			frappe.throw(_("Only {0} {1} of {2} in stock at this branch").format(qty - short, items[item].uom or "", items[item].medicine_name))
		for b in picks:
			lines.append({"item": item, "item_name": items[item].medicine_name, "batch": b["batch"], "batch_no": b["batch_no"], "expiry": b["expiry"],
				"qty": b["qty"], "price": price, "amount": round(b["qty"] * price, 2), "returned": 0})
	if not lines:
		frappe.throw(_("Add at least one product"))
	subtotal = round(sum(l["amount"] for l in lines), 2)
	discount = min(max(flt(data.get("discount")), 0), subtotal)
	mode = cstr(data.get("payment_mode") or "Cash")
	if mode not in PAY_MODES:
		frappe.throw(_("Choose the payment mode"))
	sale_no = _next_no(SALE_DT, "sale_no", "SL")
	customer = cstr(data.get("customer")).strip()[:140]
	for l in lines:
		_move(location, l["item"], l["batch"], -l["qty"], "Retail Sale", sale_no, customer or "Walk-in customer")
	frappe.get_doc({"doctype": SALE_DT, "sale_no": sale_no, "location": location, "customer": customer, "phone": cstr(data.get("phone")).strip()[:20],
		"lines": json.dumps(lines), "subtotal": subtotal, "discount": round(discount, 2), "total": round(subtotal - discount, 2), "payment_mode": mode,
		"status": "Completed", "returns": "[]", "note": cstr(data.get("note"))[:500], "actor": _actor()[:140], "domain": _dom()}).insert(ignore_permissions=True)
	_audit("Retail sale", SALE_DT, sale_no, f"{len(lines)} line(s), ₹{round(subtotal - discount, 2)} by {mode}")
	return {"sale_no": sale_no, "total": round(subtotal - discount, 2)}


def return_sale(ctx, sale_no, data):
	"""Customer return: the batches go back into the branch stock."""
	_require(ctx, "write")
	doc = _sale(sale_no)
	_require_branch(ctx, doc.location)
	reason = cstr(data.get("reason")).strip()
	if not reason:
		frappe.throw(_("Give the reason for the return"))
	lines = _list(doc.lines)
	asked = {cstr(r.get("batch")): cint(r.get("qty")) for r in _list(data.get("lines"))}
	back, amount = [], 0.0
	for l in lines:
		q = asked.get(l["batch"], 0)
		if q <= 0:
			continue
		if q > l["qty"] - cint(l.get("returned")):
			frappe.throw(_("{0} batch {1}: only {2} can be returned").format(l["item_name"], l["batch_no"], l["qty"] - cint(l.get("returned"))))
		_move(doc.location, l["item"], l["batch"], q, "Sale Return", doc.sale_no, reason)
		l["returned"] = cint(l.get("returned")) + q
		back.append({"batch_no": l["batch_no"], "item_name": l["item_name"], "qty": q})
		amount += q * flt(l["price"])
	if not back:
		frappe.throw(_("Choose what is returned"))
	refund = round(amount * (flt(doc.total) / flt(doc.subtotal) if flt(doc.subtotal) else 1), 2)
	returns = _list(doc.returns)
	returns.append({"at": cstr(now_datetime()), "by": _actor(), "reason": reason[:300], "lines": back, "refund": refund})
	doc.lines = json.dumps(lines)
	doc.returns = json.dumps(returns)
	doc.status = "Returned" if all(cint(l.get("returned")) >= l["qty"] for l in lines) else "Partially Returned"
	doc.save(ignore_permissions=True)
	_audit("Sale return", SALE_DT, doc.sale_no, f"{sum(b['qty'] for b in back)} unit(s), refund ₹{refund}: {reason}")
	return {"status": doc.status, "refund": refund}


# ---------------------------------------------------------------- reads


def _scope_filter(ctx, field="location"):
	return None if ctx.manager else list(ctx.branches) or ["-"]


# ---------------------------------------------------------------- ERP (ERPNext) import

ERP_IMPORT = "ERP Import"
ERP_GROUPS = ("Medicines", "Products")
ERP_TEST_ITEM = re.compile(r"smoke|^new[- ]?item|batch-first|\btest\b|\bdemo\b|\bsample\b", re.I)


def _erp_groups():
	if _dom() != PHARMACY:
		return [g for g in (_cfg().erp_group,) if frappe.db.exists("Item Group", g)] or [_cfg().erp_group]
	groups = set(ERP_GROUPS)
	for g in frappe.get_all("Item Group", pluck="name"):
		if re.search(r"medic|pharma|drug", g, re.I):
			groups.add(g)
	return sorted(groups)


def _erp_price(code, price_list):
	return flt(frappe.db.get_value("Item Price", {"item_code": code, "price_list": price_list}, "price_list_rate", order_by="modified desc"))


def _erp_field(doctype, name, field):
	return frappe.db.get_value(doctype, name, field) if frappe.get_meta(doctype).has_field(field) else None


def _erp_item_mrp(code):
	return flt(_erp_field("Item", code, "hec_item_mrp")) or _erp_price(code, "MRP") or flt(frappe.db.get_value("Item", code, "standard_rate"))


def _erp_batch_rates(b, warehouse):
	"""(purchase rate, MRP) for an ERP batch: pharma-bill batch fields first, then item valuation and prices."""
	rate = flt(_erp_field("Batch", b.batch_no, "hec_purchase_rate")) or flt(frappe.db.get_value("Bin", {"item_code": b.item_code, "warehouse": warehouse}, "valuation_rate")) \
		or _erp_price(b.item_code, "Standard Buying")
	mrp = flt(_erp_field("Batch", b.batch_no, "hec_mrp")) or _erp_item_mrp(b.item_code)
	return round(rate, 2), round(mrp, 2)


def _erp_batches(warehouse, codes):
	"""Batch-wise ERP stock in one warehouse: serial-and-batch bundles (v15) plus legacy batch_no ledger rows."""
	if not codes:
		return []
	rows = frappe.db.sql(
		"""select sbe.batch_no, sbb.item_code, sum(sbe.qty) qty, avg(sbe.incoming_rate) rate
		from `tabSerial and Batch Entry` sbe join `tabSerial and Batch Bundle` sbb on sbb.name = sbe.parent
		where sbb.is_cancelled = 0 and sbb.docstatus = 1 and sbb.warehouse = %s and sbb.item_code in %s and ifnull(sbe.batch_no, '') != ''
		group by sbe.batch_no, sbb.item_code""",
		(warehouse, tuple(codes)),
		as_dict=True,
	)
	seen = {(r.item_code, r.batch_no) for r in rows}
	legacy = frappe.db.sql(
		"""select batch_no, item_code, sum(actual_qty) qty, avg(incoming_rate) rate from `tabStock Ledger Entry`
		where is_cancelled = 0 and warehouse = %s and item_code in %s and ifnull(batch_no, '') != '' and ifnull(serial_and_batch_bundle, '') = ''
		group by batch_no, item_code""",
		(warehouse, tuple(codes)),
		as_dict=True,
	)
	rows += [r for r in legacy if (r.item_code, r.batch_no) not in seen]
	meta = {b.name: b for b in frappe.get_all("Batch", filters={"name": ["in", [r.batch_no for r in rows] or ["-"]]}, fields=["name", "expiry_date", "manufacturing_date"])}
	out = []
	for r in rows:
		if cint(r.qty) <= 0:
			continue
		b = meta.get(r.batch_no) or frappe._dict()
		out.append(frappe._dict(item_code=r.item_code, batch_no=r.batch_no, qty=cint(r.qty), rate=flt(r.rate), expiry_date=cstr(b.get("expiry_date") or ""),
			mfg_date=cstr(b.get("manufacturing_date") or "")))
	return out


def erp_preview(ctx, warehouse=None):
	_require(ctx, "manager")
	groups = _erp_groups()
	warehouses = frappe.db.sql(
		"""select b.warehouse, count(distinct b.item_code) items, sum(b.actual_qty) qty from tabBin b join tabItem i on i.name = b.item_code
		where b.actual_qty > 0 and i.item_group in %s group by b.warehouse order by qty desc""",
		(tuple(groups),),
		as_dict=True,
	)
	warehouse = cstr(warehouse) or (warehouses[0].warehouse if warehouses else "")
	erp_items = frappe.get_all("Item", filters={"item_group": ["in", groups], "is_stock_item": 1, "disabled": 0},
		fields=["item_code", "item_name", "item_group", "stock_uom", "standard_rate", "valuation_rate"], order_by="item_name asc", limit_page_length=2000)
	codes = [i.item_code for i in erp_items]
	linked = {r.erp_item: r for r in frappe.get_all(MED_DT, filters={"erp_item": ["!=", ""], "domain": _dom()}, fields=["name", "erp_item", "medicine_name"])}
	on_hand = {r.item_code: cint(r.actual_qty) for r in frappe.get_all("Bin", filters={"warehouse": warehouse, "item_code": ["in", codes or ["-"]]}, fields=["item_code", "actual_qty"])} if warehouse else {}
	batches = _erp_batches(warehouse, codes) if warehouse else []
	central = _central()
	ops_batches = {(r.item, r.batch_no): r.name for r in frappe.get_all(BATCH_DT, fields=["name", "item", "batch_no"], limit_page_length=20000)}
	items = []
	for i in erp_items:
		med = linked.get(i.item_code)
		mine = [b for b in batches if b.item_code == i.item_code]
		batched = sum(b.qty for b in mine)
		rows = []
		for b in mine:
			ops_batch = ops_batches.get((med.name, b.batch_no)) if med else None
			status = "ok"
			if not b.expiry_date:
				status = "no_expiry"
			elif _expired(b.expiry_date):
				status = "expired"
			rows.append({**b, "status": status, "ops_qty": _bin_qty(central, ops_batch) if ops_batch else 0})
		items.append({
			"item_code": i.item_code, "item_name": i.item_name, "item_group": i.item_group, "uom": i.stock_uom,
			"mrp": _erp_item_mrp(i.item_code), "on_hand": on_hand.get(i.item_code, 0),
			"unbatched": max(on_hand.get(i.item_code, 0) - batched, 0), "batches": rows,
			"medicine": med.name if med else "", "medicine_name": med.medicine_name if med else "",
			"suggested": bool(med) or not ERP_TEST_ITEM.search(f"{i.item_code} {i.item_name}"),
		})
	return {"warehouse": warehouse, "warehouses": warehouses, "groups": groups, "items": items}


def erp_import(ctx, data):
	"""Bring the chosen ERP items into the medicine master and set the central store's stock of their ERP batches to the
	ERP quantity. Batches that exist only here are left alone; ERP stock without a batch or expiry, and expired ERP
	batches, are skipped and reported."""
	_require(ctx, "manager")
	warehouse = cstr(data.get("warehouse"))
	codes = [cstr(c) for c in _list(data.get("items")) if cstr(c)]
	if not warehouse or not frappe.db.exists("Warehouse", warehouse):
		frappe.throw(_("Choose the ERP warehouse to import from"))
	if not codes:
		frappe.throw(_("Choose at least one ERP item"))
	central = _central()
	erp_items = {i.item_code: i for i in frappe.get_all("Item", filters={"item_code": ["in", codes]}, fields=["item_code", "item_name", "stock_uom", "standard_rate", "item_group"])}
	added, updated, meds = [], [], {}
	for code in codes:
		i = erp_items.get(code)
		if not i:
			frappe.throw(_("ERP item {0} not found").format(code))
		mrp = _erp_item_mrp(code)
		extra = {k: v for k, v in (("pack_size", cstr(_erp_field("Item", code, "hec_pack_size") or "")), ("hsn_code", cstr(_erp_field("Item", code, "hec_hsn_sac") or ""))) if v}
		name = frappe.db.get_value(MED_DT, {"erp_item": code}, "name") or frappe.db.get_value(MED_DT, {"item_code": code}, "name")
		if name and frappe.db.get_value(MED_DT, name, "domain") != _dom():
			frappe.throw(_("{0} is already used in the {1} inventory").format(i.item_name, _cfg(frappe.db.get_value(MED_DT, name, "domain")).label))
		if name:
			doc = frappe.get_doc(MED_DT, name)
			doc.update({"medicine_name": i.item_name, "erp_item": code, "active": 1, **extra})
			if mrp:
				doc.mrp = mrp
			doc.save(ignore_permissions=True)
			updated.append(i.item_name)
		else:
			doc = frappe.get_doc({"doctype": MED_DT, "item_code": code, "erp_item": code, "medicine_name": i.item_name, "uom": i.stock_uom,
				"category": "Medicine" if _dom() == PHARMACY else _cfg().noun.title(), "mrp": mrp, "reorder_central": 0, "reorder_branch": 0, "active": 1,
				"domain": _dom(), **extra}).insert(ignore_permissions=True)
			added.append(i.item_name)
		meds[code] = doc
	adj_no = _next_no(ADJ_DT, "adj_no", "ERP")
	lines, skipped = [], []
	synced = _erp().enabled()
	pharmacy_warehouses = {w for w in frappe.get_all(LOC_DT, pluck="erp_warehouse") if w} if synced else set()
	for b in _erp_batches(warehouse, codes):
		med = meds[b.item_code]
		if not b.expiry_date:
			skipped.append(f"{med.medicine_name} batch {b.batch_no}: no expiry date in ERP")
			continue
		if _expired(b.expiry_date):
			skipped.append(f"{med.medicine_name} batch {b.batch_no}: expired {format_date(b.expiry_date)}")
			continue
		batch = frappe.db.get_value(BATCH_DT, {"item": med.name, "batch_no": b.batch_no}, "name")
		rate, mrp = _erp_batch_rates(b, warehouse)
		values = {"expiry_date": b.expiry_date, "mfg_date": b.mfg_date or None, "rate": rate, "mrp": mrp or flt(med.mrp)}
		if batch:
			frappe.db.set_value(BATCH_DT, batch, {k: v for k, v in values.items() if v}, update_modified=False)
		else:
			batch = frappe.get_doc({"doctype": BATCH_DT, "item": med.name, "batch_no": b.batch_no, "vendor": "", "purchase": adj_no, **values}).insert(ignore_permissions=True).name
		if synced:
			if warehouse in pharmacy_warehouses:
				continue
			diff = b.qty
			frappe.flags.ops_erp_source = warehouse
		else:
			diff = b.qty - _bin_qty(central, batch)
		try:
			if diff:
				_move(central, med.name, batch, diff, ERP_IMPORT, adj_no, f"ERP {warehouse}: {b.qty}")
				lines.append({"item": med.name, "item_name": med.medicine_name, "batch": batch, "batch_no": b.batch_no, "expiry": b.expiry_date,
					"qty": diff, "reason": ERP_IMPORT, "available": b.qty})
		finally:
			frappe.flags.ops_erp_source = None
	for code in codes:
		bin_qty = cint(frappe.db.get_value("Bin", {"item_code": code, "warehouse": warehouse}, "actual_qty"))
		batched = sum(b.qty for b in _erp_batches(warehouse, [code]))
		if bin_qty > batched:
			skipped.append(f"{meds[code].medicine_name}: {bin_qty - batched} in ERP without a batch number")
	if lines:
		frappe.get_doc({"doctype": ADJ_DT, "adj_no": adj_no, "location": central, "lines": json.dumps(lines), "reason": ERP_IMPORT,
			"note": f"Imported from ERP warehouse {warehouse}"[:500], "actor": _actor()[:140], "domain": _dom()}).insert(ignore_permissions=True)
	_audit("Imported from ERP", ADJ_DT if lines else MED_DT, adj_no if lines else "",
		f"{warehouse}: {len(added)} new, {len(updated)} updated medicine(s), {len(lines)} batch change(s), {len(skipped)} skipped")
	return {"adj_no": adj_no if lines else "", "added": added, "updated": updated, "changed": len(lines), "skipped": skipped}


def board(ctx):
	_require(ctx)
	if _dom() == PHARMACY:
		_sync_care_branches()
	else:
		_seed_store()
	items = _items()
	locs = _locations()
	scope = _scope_filter(ctx)
	stock = frappe.db.sql(
		f"""select bin.location, bin.item, bin.batch, bin.qty, b.batch_no, b.expiry_date, b.mfg_date, b.rate, b.mrp, b.vendor
		from `tab{BIN_DT}` bin join `tab{BATCH_DT}` b on b.name = bin.batch join `tab{MED_DT}` m on m.name = bin.item
		where bin.qty != 0 and m.domain = %(domain)s
		{"" if scope is None else "and bin.location in %(scope)s"} order by b.expiry_date asc""",
		{"scope": scope, "domain": _dom()},
		as_dict=True,
	)
	horizon = add_days(getdate(today()), NEAR_EXPIRY_DAYS)
	alerts = []
	totals = {}
	value = 0.0
	for s in stock:
		s.expiry_date = cstr(s.expiry_date or "")
		s.mfg_date = cstr(s.mfg_date or "")
		s.expired = _expired(s.expiry_date)
		s.days_left = date_diff(s.expiry_date, today()) if s.expiry_date else None
		if not s.expired:
			totals[(s.location, s.item)] = totals.get((s.location, s.item), 0) + cint(s.qty)
			value += cint(s.qty) * flt(s.rate)
		name = items[s.item].medicine_name if s.item in items else s.item
		where = locs[s.location].location_name if s.location in locs else s.location
		if s.qty > 0 and s.expired:
			alerts.append({"kind": "expired", "location": s.location, "item": s.item, "text": f"{name} batch {s.batch_no} expired {format_date(s.expiry_date)} · {s.qty} at {where} (blocked)"})
		elif s.qty > 0 and s.expiry_date and getdate(s.expiry_date) <= horizon:
			alerts.append({"kind": "near", "location": s.location, "item": s.item, "days": s.days_left,
				"text": f"{name} batch {s.batch_no} expires in {s.days_left} days · {s.qty} at {where}"})
	for loc_id, loc in locs.items():
		if not cint(loc.active) or (scope is not None and loc_id not in scope):
			continue
		for item_id, it in items.items():
			if not cint(it.active):
				continue
			reorder = cint(it.reorder_central if loc.kind == CENTRAL else it.reorder_branch)
			have = totals.get((loc_id, item_id), 0)
			if reorder and have <= reorder:
				alerts.append({"kind": "low", "location": loc_id, "item": item_id, "qty": have, "reorder": reorder,
					"text": f"{it.medicine_name} at {loc.location_name}: {have} {it.uom or ''} left (reorder at {reorder})"})
	order = {"expired": 0, "low": 1, "near": 2}
	alerts.sort(key=lambda a: (order[a["kind"]], a.get("days") or 0))

	def scoped(doctype, fields, loc_fields, limit=300):
		rows = frappe.get_all(doctype, filters={"domain": _dom()}, fields=fields, order_by="creation desc", limit_page_length=limit)
		if scope is None:
			return rows
		return [r for r in rows if any(r.get(f) in scope for f in loc_fields)]

	cfg = _cfg()
	reqs = scoped(REQ_DT, ["name", "req_no", "location", "priority", "required_by", "status", "lines", "note", "requested_by_name", "decided_by", "decided_on", "decision_note", "creation"], ["location"])
	dsps = scoped(DSP_DT, ["name", "challan_no", "requisition", "source", "destination", "status", "lines", "carrier", "vehicle_no", "driver_phone", "expected_on", "events", "dispatched_by", "dispatched_on", "delivered_on", "received_by", "note", "shortage"], ["source", "destination"])
	rets = scoped(RET_DT, ["name", "return_no", "kind", "source", "destination", "vendor", "status", "lines", "reason", "note", "actor", "creation", "received_by", "received_on", "decided_by", "decided_on", "decision_note"], ["source", "destination"])
	adjs = scoped(ADJ_DT, ["name", "adj_no", "location", "lines", "reason", "note", "actor", "creation"], ["location"], 150)
	sales = scoped(SALE_DT, ["name", "sale_no", "location", "customer", "phone", "lines", "subtotal", "discount", "total", "payment_mode", "status", "returns", "note", "actor", "creation"], ["location"], 300) if cfg.sales else []
	purchases = frappe.get_all(PUR_DT, filters={"domain": _dom()}, fields=["name", "purchase_no", "vendor", "invoice_no", "invoice_date", "location", "lines", "total", "actor", "creation", "source", "external_request", "status"], order_by="creation desc", limit_page_length=300) if ctx.manager else []
	for coll in (reqs, dsps, rets, adjs, purchases, sales):
		for r in coll:
			r.lines = _list(r.lines)
			if "events" in r:
				r.events = _list(r.events)
			if "returns" in r:
				r.returns = _list(r.returns)
			for k in ("creation", "decided_on", "dispatched_on", "delivered_on", "received_on", "required_by", "expected_on", "invoice_date"):
				if r.get(k):
					r[k] = cstr(r[k])
	vendors = frappe.get_all(VEN_DT, fields=["*"], order_by="vendor_name asc") if ctx.manager else frappe.get_all(VEN_DT, fields=["name", "vendor_name"], order_by="vendor_name asc")
	external = _ext_rows(scope)
	kpis = {
		"medicines": sum(1 for i in items.values() if cint(i.active)),
		"units": sum(totals.values()),
		"value": round(value, 2),
		"low": sum(1 for a in alerts if a["kind"] == "low"),
		"near": sum(1 for a in alerts if a["kind"] == "near"),
		"expired": sum(1 for a in alerts if a["kind"] == "expired"),
		"pending": sum(1 for r in reqs if r.status == "Pending"),
		"to_dispatch": sum(1 for r in reqs if r.status in ("Approved", "Partially Approved", "Partially Dispatched")),
		"in_transit": sum(1 for d in dsps if d.status in ("Dispatched", "In Transit", "Out for Delivery")),
		"ext_pending": sum(1 for e in external if e.status == "Pending"),
		"returns_pending": sum(1 for r in rets if r.status == "Requested"),
		"sales_today": round(sum(flt(s.total) for s in sales if cstr(s.creation)[:10] == cstr(today())), 2),
	}
	branch_reasons = tuple(cfg.branch_reasons)
	return {
		"domain": {"key": _dom(), **{k: cfg[k] for k in ("label", "store", "noun", "external", "sales", "return_approval", "receive_qty", "transfer_price")}},
		"sales": sales,
		"me": {"user": ctx.user, "name": _actor(), "manager": ctx.manager, "write": ctx.write, "branches": sorted(ctx.branches)},
		"items": [dict(i) for i in sorted(items.values(), key=lambda x: x.medicine_name.lower())],
		"locations": [dict(l, staff=_list(l.staff)) for l in sorted(locs.values(), key=lambda x: (x.kind != CENTRAL, x.location_name))],
		"vendors": vendors,
		"stock": stock,
		"alerts": alerts,
		"kpis": kpis,
		"requisitions": reqs,
		"dispatches": dsps,
		"returns": rets,
		"adjustments": adjs,
		"purchases": purchases,
		"external_requests": external,
		"erp": _erp().status() if ctx.manager else {"enabled": _erp().enabled()},
		"constants": {"forms": FORMS, "schedules": SCHEDULES, "return_reasons": RETURN_REASONS, "near_days": NEAR_EXPIRY_DAYS, "flow": DISPATCH_FLOW,
			"adj_reasons": ADJ_REASONS + tuple(r for r in branch_reasons if r not in ADJ_REASONS) if ctx.manager else branch_reasons, "pay_modes": PAY_MODES},
	}


def ledger(ctx, filters):
	_require(ctx)
	filters = filters if isinstance(filters, dict) else {}
	where, params = ["1=1", "domain = %(domain)s"], {"domain": _dom()}
	scope = _scope_filter(ctx)
	if scope is not None:
		where.append("location in %(scope)s")
		params["scope"] = scope
	for key in ("location", "item", "voucher_type"):
		if filters.get(key):
			where.append(f"{key} = %({key})s")
			params[key] = cstr(filters[key])
	if filters.get("from"):
		where.append("posted_on >= %(from)s")
		params["from"] = cstr(filters["from"])
	if filters.get("to"):
		where.append("posted_on < %(to)s")
		params["to"] = cstr(add_days(getdate(filters["to"]), 1))
	rows = frappe.db.sql(
		f"""select l.posted_on, l.location, l.item, l.batch, l.qty, l.balance, l.voucher_type, l.voucher_no, l.note, l.actor, l.erp_voucher, b.batch_no, b.expiry_date
		from `tab{LEDGER_DT}` l left join `tab{BATCH_DT}` b on b.name = l.batch where {' and '.join('l.' + w if not w.startswith('1') else w for w in where)}
		order by l.posted_on desc, l.creation desc limit 1000""",
		params,
		as_dict=True,
	)
	for r in rows:
		r.posted_on = cstr(r.posted_on)
		r.expiry_date = cstr(r.expiry_date or "")
	return rows


def audit(ctx):
	_require(ctx, "manager")
	rows = frappe.get_all(AUD_DT, filters={"domain": _dom()}, fields=["at", "action", "ref_type", "ref_no", "detail", "actor"], order_by="at desc", limit_page_length=500)
	for r in rows:
		r.at = cstr(r.at)
	return rows


def vendor_history(ctx, vendor):
	_require(ctx, "manager")
	if not frappe.db.exists(VEN_DT, vendor):
		frappe.throw(_("Vendor not found"))
	purchases = frappe.get_all(PUR_DT, filters={"vendor": vendor}, fields=["purchase_no", "invoice_no", "invoice_date", "location", "lines", "total", "creation"], order_by="creation desc")
	returns = frappe.get_all(RET_DT, filters={"vendor": vendor}, fields=["return_no", "lines", "reason", "creation", "status"], order_by="creation desc")
	for r in purchases + returns:
		r.lines = _list(r.lines)
		r.creation = cstr(r.creation)
		if r.get("invoice_date"):
			r.invoice_date = cstr(r.invoice_date)
	return {"vendor": frappe.get_doc(VEN_DT, vendor).as_dict(), "purchases": purchases, "returns": returns,
		"total": round(sum(flt(p.total) for p in purchases), 2)}


# ---------------------------------------------------------------- delivery challan PDF


def _challan_html(title, ref_label, ref_no, date, status, src, dst, meta, lines, price_label, price_key, note, track, signs):
	e = escape_html
	received = any("received" in l for l in lines)
	rows = "".join(
		f"<tr><td>{i}</td><td><b>{e(l['item_name'])}</b>{('<br><small>' + e(l.get('reason')) + '</small>') if l.get('reason') else ''}</td>"
		f"<td class='mono'>{e(l['batch_no'])}</td><td>{e(format_date(l['expiry']) if l.get('expiry') else '—')}</td><td class='r'>{cint(l['qty'])} {e(l.get('uom') or '')}</td>"
		+ (f"<td class='r'>{cint(l.get('received', l['qty']))}{(' (short ' + str(cint(l.get('short'))) + ')') if cint(l.get('short')) else ''}</td>" if received else "")
		+ f"<td class='r'>{flt(l.get(price_key)):.2f}</td><td class='r'>{cint(l['qty']) * flt(l.get(price_key)):.2f}</td></tr>"
		for i, l in enumerate(lines, 1)
	)
	total_qty = sum(cint(l["qty"]) for l in lines)
	total_val = sum(cint(l["qty"]) * flt(l.get(price_key)) for l in lines)
	meta_rows = "".join(f"<tr><td>{e(a)}</td><td>{e(b)}</td><td>{e(c)}</td><td>{e(d)}</td></tr>" for a, b, c, d in meta)
	track_html = "".join(f"<li><b>{e(ev.get('status'))}</b> · {e(cstr(ev.get('at'))[:16])} · {e(ev.get('by') or '')}{(' · ' + e(ev.get('note'))) if ev.get('note') else ''}</li>" for ev in track)
	return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 14mm 12mm 16mm; }}
body {{ font-family: 'DejaVu Sans', Arial, sans-serif; color: #0f172a; font-size: 10pt; }}
.top {{ display: table; width: 100%; border-bottom: 3px solid #0e3c37; padding-bottom: 8px; margin-bottom: 10px; }}
.top div {{ display: table-cell; vertical-align: bottom; }}
.brand b {{ font-size: 15pt; color: #0e3c37; }} .brand small {{ display: block; color: #64748b; }}
.ref {{ text-align: right; }} .ref b {{ font-size: 12pt; }}
h1 {{ font-size: 13pt; letter-spacing: .08em; text-align: center; margin: 6px 0 10px; }}
.two {{ display: table; width: 100%; margin-bottom: 10px; }} .two > div {{ display: table-cell; width: 50%; border: 1px solid #dbe5ea; padding: 8px 10px; vertical-align: top; }}
.two h4 {{ margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; color: #0e3c37; letter-spacing: .06em; }}
table.l {{ width: 100%; border-collapse: collapse; margin-top: 6px; }}
table.l th {{ background: #0e3c37; color: #fff; font-size: 8.5pt; text-align: left; padding: 5px; }}
table.l td {{ border-bottom: 1px solid #e2e8f0; padding: 5px; font-size: 9pt; vertical-align: top; }}
.r {{ text-align: right; }} .mono {{ font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; }}
tfoot td {{ font-weight: bold; border-top: 2px solid #0e3c37; }}
.meta {{ width: 100%; border-collapse: collapse; margin: 8px 0; }} .meta td {{ border: 1px solid #e2e8f0; padding: 4px 8px; font-size: 9pt; }}
.meta td:nth-child(odd) {{ background: #f1f7f7; color: #475569; width: 18%; }}
.signs {{ display: table; width: 100%; margin-top: 28px; }} .signs div {{ display: table-cell; width: 33%; text-align: center; padding: 0 8px; }}
.signs span {{ display: block; border-top: 1px solid #0f172a; padding-top: 4px; font-size: 9pt; margin-top: 36px; }}
ul {{ margin: 4px 0 0; padding-left: 16px; font-size: 8.5pt; }}
.foot {{ margin-top: 14px; font-size: 7.5pt; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 5px; }}
</style></head><body>
<div class="top"><div class="brand"><b>{e(COMPANY)}</b><small>Operations · {e(_cfg().label)}</small></div>
<div class="ref">{e(ref_label)} <b>{e(ref_no)}</b><br>Date: {e(format_date(date))}<br>Status: {e(status)}</div></div>
<h1>{e(title)}</h1>
<div class="two"><div><h4>From</h4><b>{e(src.location_name)}</b><br>{e(src.address or '')}</div><div><h4>To</h4><b>{e(dst.location_name if dst else '')}</b><br>{e((dst.address or '') if dst else '')}</div></div>
<table class="meta">{meta_rows}</table>
<table class="l"><thead><tr><th>#</th><th>{e(_cfg().noun.title())}</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th>{'<th class="r">Received</th>' if received else ''}<th class="r">{e(price_label)}</th><th class="r">Value</th></tr></thead>
<tbody>{rows}</tbody><tfoot><tr><td colspan="4">Total</td><td class="r">{total_qty}</td>{'<td></td>' if received else ''}<td></td><td class="r">{total_val:.2f}</td></tr></tfoot></table>
<p style="font-size:8.5pt;color:#475569">{e(note)}</p>
{f'<b style="font-size:9pt">Tracking</b><ul>{track_html}</ul>' if track_html else ''}
<div class="signs">{''.join(f'<div><span>{e(s)}</span></div>' for s in signs)}</div>
<div class="foot">{e(COMPANY)} · {e(ref_no)} · Generated {e(cstr(now_datetime())[:16])}</div>
</body></html>"""


def challan_pdf(ctx, challan):
	_require(ctx)
	doc = _dsp(challan)
	if not ctx.manager and doc.source not in ctx.branches and doc.destination not in ctx.branches:
		frappe.throw(_("Not allowed"), frappe.PermissionError)
	from frappe.utils.pdf import get_pdf

	cfg = _cfg()
	src = frappe.get_doc(LOC_DT, doc.source)
	dst = frappe.get_doc(LOC_DT, doc.destination)
	transfer = cfg.transfer_price
	html = _challan_html(
		"DELIVERY CHALLAN", "Challan No.", doc.challan_no, doc.dispatched_on, doc.status, src, dst,
		[("Requisition" if not transfer else "Order", doc.requisition or "Direct transfer", "Carrier", doc.carrier or "—"),
			("Vehicle no.", doc.vehicle_no or "—", "Driver phone", doc.driver_phone or "—"),
			("Dispatched by", doc.dispatched_by or "", "Expected", format_date(doc.expected_on) if doc.expected_on else "—")]
		+ ([("Received by", doc.received_by or "", "Shortage", str(cint(doc.shortage)) if cint(doc.shortage) else "None")] if doc.status == "Delivered" else []),
		_list(doc.lines), "Transfer price" if transfer else "MRP", "transfer_price" if transfer else "mrp",
		f"{cfg.noun.title()}s issued first-expiry-first-out. Expired batches are blocked from dispatch. Not a tax invoice; stock transfer between own locations.",
		_list(doc.events),
		("Dispatched by (Central Store)", "Carrier / driver", "Received by (Branch)" + (f": {doc.received_by}" if doc.received_by else "")),
	)
	content = get_pdf(html, {"page-size": "A4", "encoding": "UTF-8"})
	_audit("Challan downloaded", DSP_DT, doc.challan_no)
	return {"file_name": f"delivery-challan-{doc.challan_no}.pdf", "data": base64.b64encode(content).decode()}


def return_challan_pdf(ctx, return_no):
	_require(ctx)
	doc = _ret(return_no)
	if not ctx.manager and doc.source not in ctx.branches:
		frappe.throw(_("Not allowed"), frappe.PermissionError)
	if doc.status in ("Requested", "Rejected", "Cancelled"):
		frappe.throw(_("A return challan is issued once the return is approved"))
	from frappe.utils.pdf import get_pdf

	src = frappe.get_doc(LOC_DT, doc.source)
	dst = frappe.get_doc(LOC_DT, doc.destination) if doc.destination else frappe._dict(location_name=frappe.db.get_value(VEN_DT, doc.vendor, "vendor_name") or "Vendor", address="")
	rates = {b.name: b for b in frappe.get_all(BATCH_DT, filters={"name": ["in", [l["batch"] for l in _list(doc.lines)] or ["-"]]}, fields=["name", "rate", "mrp"])}
	lines = [{**l, "rate": flt(rates[l["batch"]].rate) if l["batch"] in rates else 0} for l in _list(doc.lines)]
	html = _challan_html(
		"RETURN CHALLAN", "Return No.", doc.return_no, doc.decided_on or doc.creation, doc.status, src, dst,
		[("Type", doc.kind, "Reason", doc.reason or "—"), ("Requested by", doc.actor or "", "Approved by", doc.decided_by or "—"),
			("Received by", doc.received_by or "—", "Received on", format_date(doc.received_on) if doc.received_on else "—")],
		lines, "Rate", "rate", f"Stock returned {'to the vendor' if doc.kind == 'Vendor Return' else 'from the branch to the central store'}. {doc.note or ''}",
		[], ("Handed over by (Branch)", "Carrier", "Received by (Central Store)"),
	)
	content = get_pdf(html, {"page-size": "A4", "encoding": "UTF-8"})
	_audit("Return challan downloaded", RET_DT, doc.return_no)
	return {"file_name": f"return-challan-{doc.return_no}.pdf", "data": base64.b64encode(content).decode()}


# ---------------------------------------------------------------- whitelisted API


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _require_mobile_auth, _success

	return _error, _parse_request_value, _require_mobile_auth, _success


def _json(value, fallback):
	if value in (None, ""):
		return fallback
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("Invalid request data"))


def _run(sid, fn):
	_error, _parse, _auth, _success = _api()
	if not _auth(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	try:
		ensure()
		_set_domain(_arg("domain"))
		_erp().pull()
		result = fn(_ctx())
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
		frappe.log_error(title="ops_pharmacy", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _arg(name, value=None):
	return _api()[1](name, value)


def _endpoint(fn):
	return frappe.whitelist(allow_guest=True, methods=["POST"])(fn)


@_endpoint
def get_pharmacy_board(sid=None):
	return _run(sid, board)


@_endpoint
def get_pharmacy_ledger(filters=None, sid=None):
	return _run(sid, lambda ctx: ledger(ctx, _json(_arg("filters", filters), {})))


@_endpoint
def get_pharmacy_audit(sid=None):
	return _run(sid, audit)


@_endpoint
def get_pharmacy_vendor_history(vendor=None, sid=None):
	return _run(sid, lambda ctx: vendor_history(ctx, cstr(_arg("vendor", vendor))))


@_endpoint
def save_pharmacy_medicine(data=None, sid=None):
	return _run(sid, lambda ctx: save_medicine(ctx, _json(_arg("data", data), {})))


@_endpoint
def get_pharmacy_erp_preview(warehouse=None, sid=None):
	return _run(sid, lambda ctx: erp_preview(ctx, _arg("warehouse", warehouse)))


@_endpoint
def import_pharmacy_from_erp(data=None, sid=None):
	return _run(sid, lambda ctx: erp_import(ctx, _json(_arg("data", data), {})))


@_endpoint
def setup_pharmacy_erp_sync(data=None, sid=None):
	return _run(sid, lambda ctx: _erp().setup(ctx, _json(_arg("data", data), {})))


@_endpoint
def sync_pharmacy_erp_now(sid=None):
	return _run(sid, lambda ctx: _erp().sync_now(ctx))


@_endpoint
def disable_pharmacy_erp_sync(sid=None):
	return _run(sid, lambda ctx: _erp().disable(ctx))


@_endpoint
def save_pharmacy_vendor(data=None, sid=None):
	return _run(sid, lambda ctx: save_vendor(ctx, _json(_arg("data", data), {})))


@_endpoint
def save_pharmacy_location(data=None, sid=None):
	return _run(sid, lambda ctx: save_location(ctx, _json(_arg("data", data), {})))


@_endpoint
def save_pharmacy_purchase(data=None, sid=None):
	return _run(sid, lambda ctx: save_purchase(ctx, _json(_arg("data", data), {})))


@_endpoint
def save_pharmacy_requisition(data=None, sid=None):
	return _run(sid, lambda ctx: save_requisition(ctx, _json(_arg("data", data), {})))


@_endpoint
def decide_pharmacy_requisition(requisition=None, action=None, approvals=None, note=None, sid=None):
	return _run(sid, lambda ctx: decide_requisition(ctx, cstr(_arg("requisition", requisition)), cstr(_arg("action", action)),
		_json(_arg("approvals", approvals), []), cstr(_arg("note", note))))


@_endpoint
def cancel_pharmacy_requisition(requisition=None, sid=None):
	return _run(sid, lambda ctx: cancel_requisition(ctx, cstr(_arg("requisition", requisition))))


@_endpoint
def plan_pharmacy_dispatch(data=None, sid=None):
	return _run(sid, lambda ctx: (lambda d: plan_dispatch(ctx, d.get("requisition"), d.get("destination"), d.get("lines"), d.get("source")))(_json(_arg("data", data), {})))


@_endpoint
def create_pharmacy_dispatch(data=None, sid=None):
	return _run(sid, lambda ctx: create_dispatch(ctx, _json(_arg("data", data), {})))


@_endpoint
def update_pharmacy_dispatch(challan=None, status=None, note=None, received_by=None, received=None, sid=None):
	return _run(sid, lambda ctx: update_dispatch(ctx, cstr(_arg("challan", challan)), cstr(_arg("status", status)), cstr(_arg("note", note)),
		cstr(_arg("received_by", received_by)), _json(_arg("received", received), [])))


@_endpoint
def decide_pharmacy_return(return_no=None, action=None, note=None, sid=None):
	return _run(sid, lambda ctx: decide_return(ctx, cstr(_arg("return_no", return_no)), cstr(_arg("action", action)), cstr(_arg("note", note))))


@_endpoint
def cancel_pharmacy_return(return_no=None, sid=None):
	return _run(sid, lambda ctx: cancel_return(ctx, cstr(_arg("return_no", return_no))))


@_endpoint
def get_pharmacy_return_challan(return_no=None, sid=None):
	return _run(sid, lambda ctx: return_challan_pdf(ctx, cstr(_arg("return_no", return_no))))


@_endpoint
def save_pharmacy_sale(data=None, sid=None):
	return _run(sid, lambda ctx: save_sale(ctx, _json(_arg("data", data), {})))


@_endpoint
def return_pharmacy_sale(sale_no=None, data=None, sid=None):
	return _run(sid, lambda ctx: return_sale(ctx, cstr(_arg("sale_no", sale_no)), _json(_arg("data", data), {})))


@_endpoint
def get_pharmacy_challan(challan=None, sid=None):
	return _run(sid, lambda ctx: challan_pdf(ctx, cstr(_arg("challan", challan))))


@_endpoint
def save_pharmacy_return(data=None, sid=None):
	return _run(sid, lambda ctx: save_return(ctx, _json(_arg("data", data), {})))


@_endpoint
def receive_pharmacy_return(return_no=None, sid=None):
	return _run(sid, lambda ctx: receive_return(ctx, cstr(_arg("return_no", return_no))))


@_endpoint
def save_pharmacy_adjustment(data=None, sid=None):
	return _run(sid, lambda ctx: save_adjustment(ctx, _json(_arg("data", data), {})))


@_endpoint
def save_pharmacy_external_request(data=None, sid=None):
	return _run(sid, lambda ctx: save_external_request(ctx, _json(_arg("data", data), {})))


@_endpoint
def decide_pharmacy_external_request(ext_no=None, action=None, data=None, sid=None):
	return _run(sid, lambda ctx: decide_external_request(ctx, cstr(_arg("ext_no", ext_no)), cstr(_arg("action", action)), _json(_arg("data", data), {})))


@_endpoint
def cancel_pharmacy_external_request(ext_no=None, sid=None):
	return _run(sid, lambda ctx: cancel_external_request(ctx, cstr(_arg("ext_no", ext_no))))


@_endpoint
def receive_pharmacy_external(data=None, sid=None):
	return _run(sid, lambda ctx: receive_external(ctx, _json(_arg("data", data), {})))


@_endpoint
def write_off_pharmacy_expired(location=None, sid=None):
	return _run(sid, lambda ctx: write_off_expired(ctx, cstr(_arg("location", location))))
