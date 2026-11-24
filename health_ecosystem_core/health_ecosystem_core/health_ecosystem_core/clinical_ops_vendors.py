"""Operations portal: Vendor Management.

One vendor master for all Operations purchasing: the pharmacy's `Ops Med Vendor` (clinical_ops_pharmacy), widened
with a vendor code (VN-###), location, PAN, rating, status (Active / On Hold / Inactive), payment terms, bank
details, an opening balance and the list of materials / products it supplies (`supplies`, JSON; rows may link an Ops
stock item). Product brochures and price lists are vendor documents. Around it: `Ops Vendor Category`, purchase orders (`Ops Vendor PO`, PDF),
payments (`Ops Vendor Payment`) and documents (`Ops Vendor Document`, private files with expiry).

Money: purchases are the pharmacy goods receipts (`Ops Med Purchase`) plus received purchase orders.
Purchase (YTD) counts them from 1 April. Outstanding payable = opening balance + all purchases - all payments.
Vendors on hold or inactive get no new purchase orders or pharmacy receipts.

Access (Portal Access → Operations → Vendor Management): view sees everything; create adds vendors, POs and
documents; edit also edits vendors and moves POs on; approve / manage (and Operations Manager / System Manager)
also record payments, change status, manage categories, import and delete.
"""

from __future__ import annotations

import base64
import csv
import io
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, flt, format_date, getdate, now_datetime, today

SCHEMA_VERSION = "ops-vendors-2"
CAT_DT = "Ops Vendor Category"
PO_DT = "Ops Vendor PO"
PAY_DT = "Ops Vendor Payment"
DOC_DT = "Ops Vendor Document"
STATUSES = ("Active", "On Hold", "Inactive")
PO_STATUSES = ("Draft", "Sent", "Received", "Cancelled")
PAY_MODES = ("NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Card", "Other")
DOC_TYPES = ("GST Certificate", "Drug Licence", "PAN Card", "Agreement / Contract", "Cancelled Cheque", "Product Brochure", "Price List / Catalogue",
	"Quotation", "Invoice", "AMC Contract", "Other")
BROCHURE_TYPES = ("Product Brochure", "Price List / Catalogue")
SUPPLY_KINDS = ("Medicine", "Consumable", "Product", "Reagent", "Device / Equipment", "Service", "Other")
MAX_SUPPLIES = 300
UNITS = ("Lab", "Care", "Aesthetic", "Pharmacy", "Operations")
LEVELS = {"none": 0, "view": 1, "create": 2, "edit": 3, "approve": 4, "manage": 5}
MANAGER_ROLES = {"System Manager", "Administrator", "Health System Admin", "Operations Manager"}
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
MAX_DOC_BYTES = 10 * 1024 * 1024
SEED_CATEGORIES = (
	("Medicine", "pharmacy", "rose"),
	("Reagent", "lab", "violet"),
	("Consumable", "box", "indigo"),
	("Device & Peel", "aesthetic", "pink"),
	("Cold Logistics", "snow", "sky"),
	("Equipment & AMC", "wrench", "slate"),
	("Services", "users", "teal"),
)
OLD_CATEGORIES = {"Medicines": "Medicine", "Cold-chain medicines": "Cold Logistics", "Branch local vendor": "Medicine"}


def _ph():
	from health_ecosystem_core.health_ecosystem_core import clinical_ops_pharmacy as ph

	return ph


def _f(*args, **kwargs):
	return _ph()._f(*args, **kwargs)


def _schema():
	return {
		_ph().VEN_DT: [
			_f("vendor_code", in_list_view=1), _f("status", in_list_view=1), _f("city"), _f("state"), _f("pincode"), _f("pan", label="PAN"),
			_f("rating", "Float"), _f("payment_terms"), _f("credit_days", "Int"), _f("bank_name"), _f("bank_account"), _f("ifsc", label="IFSC"),
			_f("opening_balance", "Float"), _f("website"), _f("notes", "Small Text"), _f("hold_reason", "Small Text"), _f("alt_phone"),
			_f("supplies", "Long Text"),
		],
		CAT_DT: [_f("category_name", reqd=1, in_list_view=1), _f("icon"), _f("color"), _f("sort_order", "Int"), _f("active", "Check", default="1")],
		PO_DT: [
			_f("po_no", in_list_view=1), _f("vendor", in_list_view=1), _f("unit"), _f("lines", "Long Text"), _f("subtotal", "Float"), _f("tax", "Float"),
			_f("total", "Float", in_list_view=1), _f("status", in_list_view=1), _f("expected_on", "Date"), _f("received_on", "Date"), _f("bill_no"),
			_f("note", "Small Text"), _f("created_by"), _f("events", "Long Text"),
		],
		PAY_DT: [
			_f("pay_no", in_list_view=1), _f("vendor", in_list_view=1), _f("paid_on", "Date"), _f("amount", "Float", in_list_view=1), _f("mode"),
			_f("reference"), _f("against"), _f("note", "Small Text"), _f("recorded_by"),
		],
		DOC_DT: [
			_f("vendor", in_list_view=1), _f("doc_type", in_list_view=1), _f("title"), _f("file_url"), _f("file_name"), _f("expiry", "Date"),
			_f("uploaded_by"), _f("size", "Int"),
		],
	}


def ensure():
	ph = _ph()
	ph.ensure()
	cache = frappe.cache()
	if cache.get_value("ops_vendors_schema") == SCHEMA_VERSION:
		return
	for name, fields in _schema().items():
		ph._ensure_dt(name, fields)
	if not frappe.db.count(CAT_DT):
		for i, (name, icon, color) in enumerate(SEED_CATEGORIES, 1):
			frappe.get_doc({"doctype": CAT_DT, "category_name": name, "icon": icon, "color": color, "sort_order": i, "active": 1}).insert(ignore_permissions=True)
	for v in frappe.get_all(ph.VEN_DT, fields=["name", "category", "status", "active", "vendor_code", "notes"], order_by="creation asc"):
		values = {}
		if v.category in OLD_CATEGORIES:
			values["category"] = OLD_CATEGORIES[v.category]
			if v.category == "Branch local vendor":
				values["notes"] = ((v.notes or "") + "\nBranch local vendor (added from an outside purchase approval)").strip()
		if v.status not in STATUSES:
			values["status"] = "Active" if cint(v.active) else "Inactive"
		if not v.vendor_code:
			values["vendor_code"] = _next_code()
			frappe.db.set_value(ph.VEN_DT, v.name, "vendor_code", values["vendor_code"], update_modified=False)
		if values:
			frappe.db.set_value(ph.VEN_DT, v.name, values, update_modified=False)
	frappe.db.commit()
	cache.set_value("ops_vendors_schema", SCHEMA_VERSION)


def _next_code():
	rows = frappe.db.sql(f"select vendor_code from `tab{_ph().VEN_DT}` where vendor_code like 'VN-%%'")
	n = max([cint(cstr(r[0]).split("-")[-1]) for r in rows] or [0])
	return f"VN-{n + 1:03d}"


# ---------------------------------------------------------------- access


def _ctx():
	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	level = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_access import _user_portal_perms

		info = _user_portal_perms(user) or {}
		if info.get("managed"):
			level = ((info.get("portals") or {}).get("ops") or {}).get("Vendor Management", "none")
	except Exception:
		pass
	if roles & MANAGER_ROLES:
		n = LEVELS["manage"]
	elif level is not None:
		n = LEVELS.get(level, 0)
	else:
		n = LEVELS["edit"] if "Operations Staff" in roles else 0
	return frappe._dict(user=user, level=n, can={k: n >= v for k, v in LEVELS.items() if v})


def _need(ctx, what):
	if ctx.level < LEVELS[what]:
		if ctx.level == 0:
			frappe.throw(_("You do not have access to Vendor Management. Ask HR to give it in Portal Access."), frappe.PermissionError)
		frappe.throw(_("Your Vendor Management access does not allow this"), frappe.PermissionError)


def _audit(action, ref_no="", detail=""):
	_ph()._audit(action, "Vendor", ref_no, detail)


def _vendor(name):
	ph = _ph()
	if not name or not frappe.db.exists(ph.VEN_DT, name):
		frappe.throw(_("Vendor not found"))
	return frappe.get_doc(ph.VEN_DT, name)


def check_vendor_open(vendor):
	"""Raise when a vendor may not receive new orders or receipts."""
	if not vendor:
		return
	ensure()
	row = frappe.db.get_value(_ph().VEN_DT, vendor, ["vendor_name", "status", "active", "hold_reason"], as_dict=True)
	if not row:
		return
	status = row.status or ("Active" if cint(row.active) else "Inactive")
	if status != "Active":
		frappe.throw(_("{0} is {1}{2}. Activate the vendor in Vendor Management first.").format(
			row.vendor_name, status.lower(), f" ({row.hold_reason})" if row.hold_reason else ""))


# ---------------------------------------------------------------- money


def _fy_start():
	d = getdate(today())
	return getdate(f"{d.year if d.month >= 4 else d.year - 1}-04-01")


def _money(vendors=None):
	"""{vendor: {purchase_all, purchase_ytd, paid, last_purchase}}"""
	ph = _ph()
	fy = _fy_start()
	cond = "and vendor in %(v)s" if vendors else ""
	out = {}

	def bucket(v):
		return out.setdefault(v, {"purchase_all": 0.0, "purchase_ytd": 0.0, "paid": 0.0, "last_purchase": None, "open_po": 0})

	for r in frappe.db.sql(
		f"""select vendor, sum(total) t, sum(if(ifnull(invoice_date, date(creation)) >= %(fy)s, total, 0)) y, max(ifnull(invoice_date, date(creation))) last
		from `tab{ph.PUR_DT}` where ifnull(vendor, '') != '' {cond} group by vendor""",
		{"fy": fy, "v": tuple(vendors or ["-"])},
		as_dict=True,
	):
		b = bucket(r.vendor)
		b["purchase_all"] += flt(r.t)
		b["purchase_ytd"] += flt(r.y)
		b["last_purchase"] = r.last
	for r in frappe.db.sql(
		f"""select vendor, sum(if(status='Received', total, 0)) t, sum(if(status='Received' and received_on >= %(fy)s, total, 0)) y,
		max(if(status='Received', received_on, null)) last, sum(if(status in ('Draft', 'Sent'), 1, 0)) open_po
		from `tab{PO_DT}` where 1=1 {cond} group by vendor""",
		{"fy": fy, "v": tuple(vendors or ["-"])},
		as_dict=True,
	):
		b = bucket(r.vendor)
		b["purchase_all"] += flt(r.t)
		b["purchase_ytd"] += flt(r.y)
		b["open_po"] = cint(r.open_po)
		if r.last and (not b["last_purchase"] or getdate(r.last) > getdate(b["last_purchase"])):
			b["last_purchase"] = r.last
	for r in frappe.db.sql(f"select vendor, sum(amount) p from `tab{PAY_DT}` where 1=1 {cond} group by vendor", {"v": tuple(vendors or ["-"])}, as_dict=True):
		bucket(r.vendor)["paid"] += flt(r.p)
	return out


def _vendor_row(v, money):
	m = money.get(v.name) or {}
	status = v.status if v.status in STATUSES else ("Active" if cint(v.active) else "Inactive")
	return {
		"name": v.name, "vendor_code": v.vendor_code, "vendor_name": v.vendor_name, "category": v.category or "", "status": status,
		"contact_person": v.contact_person or "", "phone": v.phone or "", "alt_phone": v.alt_phone or "", "email": v.email or "",
		"gstin": v.gstin or "", "pan": v.pan or "", "drug_license": v.drug_license or "", "address": v.address or "", "city": v.city or "",
		"state": v.state or "", "pincode": v.pincode or "", "rating": flt(v.rating), "payment_terms": v.payment_terms or "",
		"credit_days": cint(v.credit_days), "bank_name": v.bank_name or "", "bank_account": v.bank_account or "", "ifsc": v.ifsc or "",
		"opening_balance": flt(v.opening_balance), "website": v.website or "", "notes": v.notes or "", "hold_reason": v.hold_reason or "",
		"purchase_ytd": round(flt(m.get("purchase_ytd")), 2), "purchase_all": round(flt(m.get("purchase_all")), 2), "paid": round(flt(m.get("paid")), 2),
		"outstanding": round(flt(v.opening_balance) + flt(m.get("purchase_all")) - flt(m.get("paid")), 2),
		"last_purchase": cstr(m.get("last_purchase") or ""), "open_po": cint(m.get("open_po")), "creation": cstr(v.creation),
		"supplies": _ph()._list(v.get("supplies")),
	}


def _stock_items():
	ph = _ph()
	return [
		{"name": r.name, "item_name": r.medicine_name, "domain": r.domain or ph.PHARMACY, "brand": r.get("brand") or "",
			"pack": " ".join(x for x in (cstr(r.pack_size), cstr(r.uom)) if x)}
		for r in frappe.get_all(ph.MED_DT, filters={"active": 1}, fields=["name", "medicine_name", "domain", "brand", "pack_size", "uom"],
			order_by="medicine_name asc", limit_page_length=5000)
	]


def _supplies(raw):
	"""Materials / products the vendor supplies: [{item, kind, brand, pack, rate, moq, lead_days, ops_item}]."""
	ph = _ph()
	if isinstance(raw, str):
		text = raw.strip()
		if text.startswith("["):
			raw = ph._list(text)
		else:
			raw = [{"item": x} for x in re.split(r"[;\n]+", text)]
	rows, seen = [], set()
	kind_of = {ph.PHARMACY: "Medicine", "aes_consumable": "Consumable", "aes_product": "Product"}
	for r in raw if isinstance(raw, list) else []:
		r = r if isinstance(r, dict) else {"item": r}
		item = cstr(r.get("item")).strip()[:140]
		if not item:
			continue
		brand = cstr(r.get("brand")).strip()[:80]
		key = (item.lower(), brand.lower())
		if key in seen:
			continue
		seen.add(key)
		kind = cstr(r.get("kind")).strip()
		ops_item = cstr(r.get("ops_item")).strip()
		linked = frappe.db.get_value(ph.MED_DT, ops_item, ["name", "domain"], as_dict=True) if ops_item else None
		if linked and kind not in SUPPLY_KINDS:
			kind = kind_of.get(linked.domain or ph.PHARMACY, "Other")
		rate, moq, lead = flt(r.get("rate")), cint(r.get("moq")), cint(r.get("lead_days"))
		if rate < 0 or moq < 0 or lead < 0:
			frappe.throw(_("Rate, minimum order and lead time cannot be negative ({0})").format(item))
		rows.append({
			"item": item, "kind": kind if kind in SUPPLY_KINDS else "Other", "brand": brand, "pack": cstr(r.get("pack")).strip()[:60],
			"rate": round(rate, 2), "moq": moq, "lead_days": lead, "ops_item": linked.name if linked else "",
		})
	if len(rows) > MAX_SUPPLIES:
		frappe.throw(_("A vendor can list at most {0} supplied items").format(MAX_SUPPLIES))
	return rows


def _supplies_from_text(text, existing=None):
	"""CSV "Item (Brand); Item" -> rows, keeping the details of items the vendor already lists."""
	known = {(s["item"] + (f" ({s['brand']})" if s.get("brand") else "")).lower(): s for s in existing or []}
	rows = []
	for token in re.split(r"[;\n]+", cstr(text)):
		token = token.strip()
		if not token:
			continue
		if token.lower() in known:
			rows.append(known[token.lower()])
			continue
		m = re.match(r"^(.*?)\s*\(([^()]+)\)$", token)
		rows.append({"item": m.group(1), "brand": m.group(2)} if m and m.group(1) else {"item": token})
	return rows


# ---------------------------------------------------------------- reads


def board(ctx):
	_need(ctx, "view")
	ph = _ph()
	for name in frappe.get_all(ph.VEN_DT, filters={"vendor_code": ["in", ["", None]]}, pluck="name", order_by="creation asc"):
		frappe.db.set_value(ph.VEN_DT, name, "vendor_code", _next_code(), update_modified=False)
	vendors = frappe.get_all(ph.VEN_DT, fields=["*"], order_by="creation desc", limit_page_length=5000)
	money = _money()
	rows = [_vendor_row(v, money) for v in vendors]
	cats = frappe.get_all(CAT_DT, fields=["name", "category_name", "icon", "color", "sort_order", "active"], order_by="sort_order asc, category_name asc")
	counts = {}
	for r in rows:
		counts[r["category"]] = counts.get(r["category"], 0) + 1
	for c in cats:
		c["count"] = counts.get(c.category_name, 0)
	return {
		"me": {"level": ctx.level, "can": ctx.can},
		"vendors": rows,
		"categories": cats,
		"kpis": {
			"total": len(rows), "active": sum(1 for r in rows if r["status"] == "Active"), "on_hold": sum(1 for r in rows if r["status"] == "On Hold"),
			"inactive": sum(1 for r in rows if r["status"] == "Inactive"), "purchase_ytd": round(sum(r["purchase_ytd"] for r in rows), 2),
			"outstanding": round(sum(max(r["outstanding"], 0) for r in rows), 2), "fy_start": cstr(_fy_start()),
		},
		"constants": {"statuses": STATUSES, "po_statuses": PO_STATUSES, "pay_modes": PAY_MODES, "doc_types": DOC_TYPES, "units": UNITS,
			"brochure_types": BROCHURE_TYPES, "supply_kinds": SUPPLY_KINDS},
		"items": _stock_items(),
	}


def detail(ctx, vendor):
	_need(ctx, "view")
	ph = _ph()
	v = _vendor(vendor)
	row = _vendor_row(v, _money([v.name]))
	grns = frappe.get_all(ph.PUR_DT, filters={"vendor": v.name}, fields=["purchase_no", "invoice_no", "invoice_date", "location", "lines", "total", "source", "creation", "domain"],
		order_by="creation desc", limit_page_length=500)
	locs = {l.name: l.location_name for l in frappe.get_all(ph.LOC_DT, fields=["name", "location_name"])}
	purchases = [{"kind": "GRN", "ref": g.purchase_no, "bill_no": g.invoice_no or "", "date": cstr(g.invoice_date or g.creation)[:10], "total": flt(g.total),
		"status": "Received", "where": locs.get(g.location, g.location or ""), "lines": len(ph._list(g.lines)), "source": g.source or "Central",
		"inventory": ph.DOMAINS.get(g.domain or ph.PHARMACY, {}).get("label", "Pharmacy")} for g in grns]
	pos = frappe.get_all(PO_DT, filters={"vendor": v.name}, fields=["*"], order_by="creation desc", limit_page_length=500)
	for p in pos:
		p.lines = ph._list(p.lines)
		p.events = ph._list(p.events)
		for k in ("expected_on", "received_on", "creation", "modified"):
			p[k] = cstr(p.get(k) or "")
	payments = frappe.get_all(PAY_DT, filters={"vendor": v.name}, fields=["name", "pay_no", "paid_on", "amount", "mode", "reference", "against", "note", "recorded_by", "creation"],
		order_by="paid_on desc, creation desc", limit_page_length=500)
	docs = frappe.get_all(DOC_DT, filters={"vendor": v.name}, fields=["name", "doc_type", "title", "file_name", "expiry", "uploaded_by", "size", "creation"],
		order_by="creation desc", limit_page_length=200)
	for r in payments + docs:
		for k in ("paid_on", "expiry", "creation"):
			if r.get(k):
				r[k] = cstr(r[k])
		if "expiry" in r:
			r["expired"] = bool(r.get("expiry")) and getdate(r["expiry"]) < getdate(today())
	return {"vendor": row, "grns": purchases, "pos": pos, "payments": payments, "documents": docs}


# ---------------------------------------------------------------- vendor master


def _clean(data):
	name = cstr(data.get("vendor_name")).strip()
	if not name:
		frappe.throw(_("Vendor name is required"))
	gstin = cstr(data.get("gstin")).strip().upper().replace(" ", "")
	if gstin and not GSTIN_RE.match(gstin):
		frappe.throw(_("GSTIN must be 15 characters, e.g. 19ABCDE1234F1Z5"))
	pan = cstr(data.get("pan")).strip().upper()
	if pan and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", pan):
		frappe.throw(_("PAN must look like ABCDE1234F"))
	if gstin and not pan:
		pan = gstin[2:12]
	email = cstr(data.get("email")).strip()
	if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
		frappe.throw(_("Enter a valid email"))
	category = cstr(data.get("category")).strip()
	if category and not frappe.db.exists(CAT_DT, {"category_name": category}):
		frappe.throw(_("Choose a category from the list (add new ones under Vendor Categories)"))
	rating = flt(data.get("rating"))
	if rating < 0 or rating > 5:
		frappe.throw(_("Rating is between 0 and 5"))
	status = cstr(data.get("status") or "Active")
	if status not in STATUSES:
		status = "Active"
	values = {
		"vendor_name": name[:140], "category": category, "contact_person": cstr(data.get("contact_person")).strip()[:140],
		"phone": cstr(data.get("phone")).strip()[:20], "alt_phone": cstr(data.get("alt_phone")).strip()[:20], "email": email[:140],
		"gstin": gstin, "pan": pan, "drug_license": cstr(data.get("drug_license")).strip()[:60], "address": cstr(data.get("address")).strip()[:500],
		"city": cstr(data.get("city")).strip()[:80], "state": cstr(data.get("state")).strip()[:80], "pincode": cstr(data.get("pincode")).strip()[:10],
		"rating": round(rating, 1), "payment_terms": cstr(data.get("payment_terms")).strip()[:140], "credit_days": max(cint(data.get("credit_days")), 0),
		"bank_name": cstr(data.get("bank_name")).strip()[:140], "bank_account": cstr(data.get("bank_account")).strip()[:40],
		"ifsc": cstr(data.get("ifsc")).strip().upper()[:15], "opening_balance": flt(data.get("opening_balance")),
		"website": cstr(data.get("website")).strip()[:140], "notes": cstr(data.get("notes")).strip()[:1000], "status": status,
		"active": 0 if status == "Inactive" else 1,
	}
	if "supplies" in data:
		values["supplies"] = frappe.as_json(_supplies(data.get("supplies")))
	if values["ifsc"] and not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", values["ifsc"]):
		frappe.throw(_("IFSC must look like SBIN0001234"))
	return values


def save_vendor(ctx, data):
	ph = _ph()
	doc_id = cstr(data.get("id") or data.get("name")).strip()
	_need(ctx, "edit" if doc_id else "create")
	values = _clean(data)
	dup = frappe.db.get_value(ph.VEN_DT, {"vendor_name": values["vendor_name"]}, "name")
	if dup and dup != doc_id:
		frappe.throw(_("{0} already exists").format(values["vendor_name"]))
	if values["gstin"]:
		dup = frappe.db.get_value(ph.VEN_DT, {"gstin": values["gstin"], "name": ["!=", doc_id or "-"]}, "vendor_name")
		if dup:
			frappe.throw(_("GSTIN {0} is already used by {1}").format(values["gstin"], dup))
	if doc_id:
		doc = _vendor(doc_id)
		if values["status"] != (doc.status or "Active") and not ctx.can["approve"]:
			values.pop("status")
			values.pop("active")
		if not ctx.can["approve"]:
			values.pop("opening_balance")
		doc.update(values)
		doc.save(ignore_permissions=True)
		_audit("Vendor updated", doc.vendor_code, doc.vendor_name)
	else:
		if not ctx.can["approve"]:
			values["opening_balance"] = 0
		doc = frappe.get_doc({"doctype": ph.VEN_DT, "vendor_code": _next_code(), **values}).insert(ignore_permissions=True)
		_audit("Vendor added", doc.vendor_code, doc.vendor_name)
	return {"name": doc.name, "vendor_code": doc.vendor_code}


def set_status(ctx, vendor, status, reason=""):
	_need(ctx, "approve")
	if status not in STATUSES:
		frappe.throw(_("Unknown status"))
	doc = _vendor(vendor)
	reason = cstr(reason).strip()
	if status == "On Hold" and not reason:
		frappe.throw(_("Give a reason for putting the vendor on hold"))
	doc.status = status
	doc.active = 0 if status == "Inactive" else 1
	doc.hold_reason = reason[:500] if status != "Active" else ""
	doc.save(ignore_permissions=True)
	_audit(f"Vendor {status.lower()}", doc.vendor_code, reason)
	return {"status": status}


def delete_vendor(ctx, vendor):
	_need(ctx, "manage")
	ph = _ph()
	doc = _vendor(vendor)
	used = [label for dt, field, label in (
		(ph.PUR_DT, "vendor", "goods receipts"), (PO_DT, "vendor", "purchase orders"), (PAY_DT, "vendor", "payments"),
		(ph.BATCH_DT, "vendor", "stock batches"), (ph.RET_DT, "vendor", "returns"), (ph.EXT_DT, "vendor", "outside purchase requests"),
	) if frappe.db.exists(dt, {field: doc.name})]
	if used:
		frappe.throw(_("{0} has {1}; mark it Inactive instead of deleting").format(doc.vendor_name, ", ".join(used)))
	for d in frappe.get_all(DOC_DT, filters={"vendor": doc.name}, pluck="name"):
		_delete_document(d)
	frappe.delete_doc(ph.VEN_DT, doc.name, ignore_permissions=True, force=True)
	_audit("Vendor deleted", doc.vendor_code, doc.vendor_name)
	return {"deleted": doc.vendor_code}


def import_vendors(ctx, rows):
	"""Rows from the CSV template; vendors are matched by code, then GSTIN, then name."""
	_need(ctx, "approve")
	ph = _ph()
	rows = rows if isinstance(rows, list) else []
	if not rows:
		frappe.throw(_("The file has no vendor rows"))
	if len(rows) > 1000:
		frappe.throw(_("Import at most 1000 vendors at a time"))
	added, updated, errors = 0, 0, []
	cats = {c.lower(): c for c in frappe.get_all(CAT_DT, pluck="category_name")}
	for i, raw in enumerate(rows, 2):
		data = {k: cstr(v).strip() for k, v in (raw or {}).items()}
		if not data.get("vendor_name"):
			continue
		if data.get("category"):
			cat = cats.get(data["category"].lower()) or OLD_CATEGORIES.get(data["category"])
			if not cat:
				errors.append(f"Row {i}: unknown category {data['category']}")
				continue
			data["category"] = cat
		existing = (frappe.db.get_value(ph.VEN_DT, {"vendor_code": data.get("vendor_code")}, "name") if data.get("vendor_code") else None) \
			or (frappe.db.get_value(ph.VEN_DT, {"gstin": data.get("gstin", "").upper()}, "name") if data.get("gstin") else None) \
			or frappe.db.get_value(ph.VEN_DT, {"vendor_name": data["vendor_name"]}, "name")
		frappe.db.savepoint("vendor_row")
		try:
			current = _vendor_row(_vendor(existing), {}) if existing else {}
			if data.get("supplies"):
				data["supplies"] = _supplies_from_text(data["supplies"], current.get("supplies"))
			else:
				data.pop("supplies", None)
			if existing:
				merged = {**current, **{k: v for k, v in data.items() if v != ""}, "id": existing}
				save_vendor(ctx, merged)
				updated += 1
			else:
				save_vendor(ctx, data)
				added += 1
		except frappe.ValidationError as exc:
			frappe.db.rollback(save_point="vendor_row")
			errors.append(f"Row {i} ({data['vendor_name']}): {re.sub(r'<[^>]+>', '', cstr(exc))}")
	_audit("Vendors imported", "", f"{added} added, {updated} updated, {len(errors)} errors")
	return {"added": added, "updated": updated, "errors": errors[:50]}


# ---------------------------------------------------------------- categories


def save_category(ctx, data):
	_need(ctx, "approve")
	ph = _ph()
	name = cstr(data.get("category_name")).strip()
	if not name:
		frappe.throw(_("Category name is required"))
	doc_id = cstr(data.get("id")).strip()
	dup = frappe.db.get_value(CAT_DT, {"category_name": name}, "name")
	if dup and dup != doc_id:
		frappe.throw(_("{0} already exists").format(name))
	values = {"category_name": name[:80], "icon": cstr(data.get("icon") or "tag")[:30], "color": cstr(data.get("color") or "slate")[:20],
		"sort_order": cint(data.get("sort_order")), "active": 1}
	if doc_id:
		doc = frappe.get_doc(CAT_DT, doc_id)
		old = doc.category_name
		doc.update(values)
		doc.save(ignore_permissions=True)
		if old != name:
			frappe.db.sql(f"update `tab{ph.VEN_DT}` set category=%s where category=%s", (name, old))
	else:
		values["sort_order"] = values["sort_order"] or (frappe.db.count(CAT_DT) + 1)
		doc = frappe.get_doc({"doctype": CAT_DT, **values}).insert(ignore_permissions=True)
	_audit("Vendor category saved", "", name)
	return {"name": doc.name}


def delete_category(ctx, name):
	_need(ctx, "approve")
	doc = frappe.get_doc(CAT_DT, name)
	n = frappe.db.count(_ph().VEN_DT, {"category": doc.category_name})
	if n:
		frappe.throw(_("{0} vendor(s) use {1}; move them to another category first").format(n, doc.category_name))
	frappe.delete_doc(CAT_DT, name, ignore_permissions=True, force=True)
	_audit("Vendor category deleted", "", doc.category_name)
	return {"deleted": name}


# ---------------------------------------------------------------- purchase orders


def save_po(ctx, data):
	ph = _ph()
	doc_id = cstr(data.get("id")).strip()
	_need(ctx, "edit" if doc_id else "create")
	vendor = _vendor(cstr(data.get("vendor")))
	check_vendor_open(vendor.name)
	unit = cstr(data.get("unit") or "Operations")
	if unit not in UNITS:
		frappe.throw(_("Choose the unit the order is for"))
	lines = []
	for raw in ph._list(data.get("lines")):
		desc = cstr(raw.get("description")).strip()
		qty = flt(raw.get("qty"))
		rate = flt(raw.get("rate"))
		gst = flt(raw.get("gst"))
		if not desc and not qty:
			continue
		if not desc or qty <= 0 or rate < 0 or gst < 0 or gst > 28:
			frappe.throw(_("Every line needs an item, a quantity above zero, a rate and GST between 0 and 28%"))
		amount = round(qty * rate, 2)
		lines.append({"description": desc[:200], "uom": cstr(raw.get("uom") or "Nos")[:20], "qty": qty, "rate": rate, "gst": gst,
			"amount": amount, "tax": round(amount * gst / 100, 2)})
	if not lines:
		frappe.throw(_("Add at least one line"))
	subtotal = round(sum(l["amount"] for l in lines), 2)
	tax = round(sum(l["tax"] for l in lines), 2)
	values = {"vendor": vendor.name, "unit": unit, "lines": frappe.as_json(lines), "subtotal": subtotal, "tax": tax, "total": round(subtotal + tax, 2),
		"expected_on": getdate(data.get("expected_on")) if data.get("expected_on") else None, "note": cstr(data.get("note"))[:500]}
	if doc_id:
		doc = frappe.get_doc(PO_DT, doc_id)
		if doc.status != "Draft":
			frappe.throw(_("Only draft orders can be edited"))
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		po_no = ph._next_no(PO_DT, "po_no", "PO")
		status = "Sent" if data.get("send") else "Draft"
		doc = frappe.get_doc({"doctype": PO_DT, "po_no": po_no, "status": status, "created_by": ph._actor()[:140],
			"events": frappe.as_json([{"status": status, "at": cstr(now_datetime()), "by": ph._actor()}]), **values}).insert(ignore_permissions=True)
	_audit("Purchase order saved", doc.po_no, f"{vendor.vendor_name}: {doc.total}")
	return {"po_no": doc.po_no, "status": doc.status}


def set_po_status(ctx, po_no, status, data=None):
	ph = _ph()
	data = data if isinstance(data, dict) else {}
	_need(ctx, "edit")
	name = frappe.db.get_value(PO_DT, {"po_no": po_no}, "name")
	if not name:
		frappe.throw(_("Purchase order not found"))
	doc = frappe.get_doc(PO_DT, name)
	allowed = {"Draft": ("Sent", "Cancelled"), "Sent": ("Received", "Cancelled"), "Received": (), "Cancelled": ()}
	if status not in allowed.get(doc.status, ()):
		frappe.throw(_("A {0} order cannot be marked {1}").format(doc.status.lower(), status.lower()))
	if status == "Received":
		doc.bill_no = cstr(data.get("bill_no")).strip()[:60]
		doc.received_on = getdate(data.get("received_on")) if data.get("received_on") else getdate(today())
		if doc.received_on > getdate(today()):
			frappe.throw(_("Received date cannot be in the future"))
		if data.get("total") not in (None, ""):
			total = flt(data.get("total"))
			if total <= 0:
				frappe.throw(_("Enter the billed amount"))
			doc.total = round(total, 2)
	events = ph._list(doc.events)
	events.append({"status": status, "at": cstr(now_datetime()), "by": ph._actor(), "note": cstr(data.get("note"))[:200]})
	doc.events = frappe.as_json(events)
	doc.status = status
	doc.save(ignore_permissions=True)
	_audit(f"Purchase order {status.lower()}", doc.po_no, cstr(data.get("note")))
	return {"status": status}


def po_pdf(ctx, po_no):
	_need(ctx, "view")
	ph = _ph()
	from frappe.utils.pdf import get_pdf

	name = frappe.db.get_value(PO_DT, {"po_no": po_no}, "name")
	if not name:
		frappe.throw(_("Purchase order not found"))
	doc = frappe.get_doc(PO_DT, name)
	v = _vendor(doc.vendor)
	e = escape_html
	lines = ph._list(doc.lines)
	rows = "".join(
		f"<tr><td>{i}</td><td>{e(l['description'])}</td><td class='r'>{flt(l['qty']):g} {e(l.get('uom') or '')}</td><td class='r'>{flt(l['rate']):.2f}</td>"
		f"<td class='r'>{flt(l['gst']):g}%</td><td class='r'>{flt(l['amount']) + flt(l['tax']):.2f}</td></tr>"
		for i, l in enumerate(lines, 1)
	)
	html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 14mm 12mm 16mm; }}
body {{ font-family: 'DejaVu Sans', Arial, sans-serif; color: #0f172a; font-size: 10pt; }}
.top {{ display: table; width: 100%; border-bottom: 3px solid #0e3c37; padding-bottom: 8px; margin-bottom: 10px; }}
.top div {{ display: table-cell; vertical-align: bottom; }} .brand b {{ font-size: 15pt; color: #0e3c37; }} .brand small {{ display: block; color: #64748b; }}
.ref {{ text-align: right; }} .ref b {{ font-size: 12pt; }}
h1 {{ font-size: 13pt; letter-spacing: .08em; text-align: center; margin: 6px 0 10px; }}
.two {{ display: table; width: 100%; margin-bottom: 10px; }} .two > div {{ display: table-cell; width: 50%; border: 1px solid #dbe5ea; padding: 8px 10px; vertical-align: top; }}
.two h4 {{ margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; color: #0e3c37; letter-spacing: .06em; }}
table.l {{ width: 100%; border-collapse: collapse; }} table.l th {{ background: #0e3c37; color: #fff; font-size: 8.5pt; text-align: left; padding: 5px; }}
table.l td {{ border-bottom: 1px solid #e2e8f0; padding: 5px; font-size: 9pt; }} .r {{ text-align: right; }}
.tot {{ width: 45%; margin-left: 55%; border-collapse: collapse; margin-top: 8px; }} .tot td {{ padding: 4px 6px; font-size: 9.5pt; }} .tot tr:last-child td {{ font-weight: bold; border-top: 2px solid #0e3c37; }}
.signs {{ display: table; width: 100%; margin-top: 40px; }} .signs div {{ display: table-cell; width: 50%; text-align: center; }}
.signs span {{ display: inline-block; border-top: 1px solid #0f172a; padding-top: 4px; font-size: 9pt; min-width: 60%; }}
.foot {{ margin-top: 14px; font-size: 7.5pt; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 5px; }}
</style></head><body>
<div class="top"><div class="brand"><b>{e(ph.COMPANY)}</b><small>Operations · {e(doc.unit or '')}</small></div>
<div class="ref">PO No. <b>{e(doc.po_no)}</b><br>Date: {e(format_date(doc.creation))}<br>Status: {e(doc.status)}</div></div>
<h1>PURCHASE ORDER</h1>
<div class="two"><div><h4>Vendor</h4><b>{e(v.vendor_name)}</b> ({e(v.vendor_code or '')})<br>{e(v.address or '')}<br>{e(', '.join(x for x in (v.city, v.state, v.pincode) if x))}<br>
GSTIN: {e(v.gstin or '—')} · Phone: {e(v.phone or '—')}</div>
<div><h4>Deliver to</h4><b>{e(ph.COMPANY)}</b><br>{e(doc.unit or 'Operations')}<br>Expected by: {e(format_date(doc.expected_on) if doc.expected_on else '—')}<br>Payment terms: {e(v.payment_terms or (str(v.credit_days) + ' days' if v.credit_days else '—'))}</div></div>
<table class="l"><thead><tr><th>#</th><th>Item / service</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>{rows}</tbody></table>
<table class="tot"><tr><td>Sub-total</td><td class="r">{flt(doc.subtotal):.2f}</td></tr><tr><td>GST</td><td class="r">{flt(doc.tax):.2f}</td></tr><tr><td>Total (INR)</td><td class="r">{flt(doc.total):.2f}</td></tr></table>
{f'<p style="font-size:9pt"><b>Note:</b> {e(doc.note)}</p>' if doc.note else ''}
<div class="signs"><div><span>Prepared by: {e(doc.created_by or '')}</span></div><div><span>Authorised signatory</span></div></div>
<div class="foot">{e(ph.COMPANY)} · {e(doc.po_no)} · Generated {e(cstr(now_datetime())[:16])}</div>
</body></html>"""
	content = get_pdf(html, {"page-size": "A4", "encoding": "UTF-8"})
	return {"file_name": f"purchase-order-{doc.po_no}.pdf", "data": base64.b64encode(content).decode()}


# ---------------------------------------------------------------- payments


def record_payment(ctx, data):
	_need(ctx, "approve")
	ph = _ph()
	vendor = _vendor(cstr(data.get("vendor")))
	amount = round(flt(data.get("amount")), 2)
	if amount <= 0:
		frappe.throw(_("Enter the amount paid"))
	mode = cstr(data.get("mode") or "NEFT")
	if mode not in PAY_MODES:
		frappe.throw(_("Choose the payment mode"))
	paid_on = getdate(data.get("paid_on")) if data.get("paid_on") else getdate(today())
	if paid_on > getdate(today()):
		frappe.throw(_("Payment date cannot be in the future"))
	reference = cstr(data.get("reference")).strip()[:80]
	if mode not in ("Cash",) and not reference:
		frappe.throw(_("Enter the UTR / cheque / transaction reference"))
	if reference and frappe.db.exists(PAY_DT, {"vendor": vendor.name, "reference": reference}):
		frappe.throw(_("A payment with reference {0} is already recorded for this vendor").format(reference))
	pay_no = ph._next_no(PAY_DT, "pay_no", "VP")
	frappe.get_doc({"doctype": PAY_DT, "pay_no": pay_no, "vendor": vendor.name, "paid_on": paid_on, "amount": amount, "mode": mode, "reference": reference,
		"against": cstr(data.get("against")).strip()[:60], "note": cstr(data.get("note"))[:500], "recorded_by": ph._actor()[:140]}).insert(ignore_permissions=True)
	_audit("Vendor payment recorded", pay_no, f"{vendor.vendor_name}: {amount} by {mode} {reference}")
	return {"pay_no": pay_no}


def delete_payment(ctx, pay_no):
	_need(ctx, "manage")
	name = frappe.db.get_value(PAY_DT, {"pay_no": pay_no}, "name")
	if not name:
		frappe.throw(_("Payment not found"))
	frappe.delete_doc(PAY_DT, name, ignore_permissions=True, force=True)
	_audit("Vendor payment deleted", pay_no)
	return {"deleted": pay_no}


# ---------------------------------------------------------------- documents


def upload_document(ctx, data):
	_need(ctx, "create")
	ph = _ph()
	vendor = _vendor(cstr(data.get("vendor")))
	doc_type = cstr(data.get("doc_type") or "Other")
	if doc_type not in DOC_TYPES:
		frappe.throw(_("Choose the document type"))
	file_name = re.sub(r"[^\w.\- ]+", "_", cstr(data.get("file_name")).strip())[:120]
	raw = cstr(data.get("content"))
	if "," in raw[:100]:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw, validate=True)
	except Exception:
		frappe.throw(_("The file could not be read"))
	if not file_name or not content:
		frappe.throw(_("Choose a file"))
	if len(content) > MAX_DOC_BYTES:
		frappe.throw(_("Files can be at most 10 MB"))
	ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
	if ext not in ("pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt"):
		frappe.throw(_("Upload a PDF, image, Word, Excel, CSV or text file"))
	try:
		f = frappe.get_doc({"doctype": "File", "file_name": f"{vendor.vendor_code or 'vendor'}-{file_name}", "content": content, "is_private": 1}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="ops_vendor_document", message=frappe.get_traceback())
		frappe.throw(_("{0} could not be stored. Check that the file opens, then upload it again.").format(file_name))
	rec = frappe.get_doc({"doctype": DOC_DT, "vendor": vendor.name, "doc_type": doc_type, "title": cstr(data.get("title") or doc_type)[:140],
		"file_name": file_name, "file_url": f.file_url, "expiry": getdate(data.get("expiry")) if data.get("expiry") else None, "uploaded_by": ph._actor()[:140],
		"size": len(content)}).insert(ignore_permissions=True)
	f.db_set({"attached_to_doctype": DOC_DT, "attached_to_name": rec.name}, update_modified=False)
	_audit("Vendor document uploaded", vendor.vendor_code, f"{doc_type}: {file_name}")
	return {"name": rec.name}


def get_document(ctx, name):
	_need(ctx, "view")
	rec = frappe.get_doc(DOC_DT, name)
	f = frappe.db.get_value("File", {"attached_to_doctype": DOC_DT, "attached_to_name": rec.name}, "name")
	if not f:
		frappe.throw(_("The file is missing"))
	content = frappe.get_doc("File", f).get_content()
	if isinstance(content, str):
		content = content.encode()
	return {"file_name": rec.file_name, "data": base64.b64encode(content).decode()}


def _delete_document(name):
	for f in frappe.get_all("File", filters={"attached_to_doctype": DOC_DT, "attached_to_name": name}, pluck="name"):
		frappe.delete_doc("File", f, ignore_permissions=True, force=True)
	frappe.delete_doc(DOC_DT, name, ignore_permissions=True, force=True)


def delete_document(ctx, name):
	_need(ctx, "edit")
	rec = frappe.get_doc(DOC_DT, name)
	_delete_document(rec.name)
	_audit("Vendor document deleted", rec.vendor, rec.file_name)
	return {"deleted": name}


def export_csv(ctx):
	_need(ctx, "view")
	data = board(ctx)
	buf = io.StringIO()
	w = csv.writer(buf)
	cols = ["vendor_code", "vendor_name", "category", "status", "contact_person", "phone", "alt_phone", "email", "gstin", "pan", "drug_license", "address",
		"city", "state", "pincode", "rating", "payment_terms", "credit_days", "bank_name", "bank_account", "ifsc", "opening_balance", "website", "notes",
		"supplies", "purchase_ytd", "outstanding"]
	w.writerow(cols)
	for r in data["vendors"]:
		r = {**r, "supplies": "; ".join(s["item"] + (f" ({s['brand']})" if s.get("brand") else "") for s in r["supplies"])}
		w.writerow([r.get(c, "") for c in cols])
	return {"file_name": f"vendors-{today()}.csv", "data": base64.b64encode(buf.getvalue().encode("utf-8-sig")).decode()}


# ---------------------------------------------------------------- endpoints


def _run(sid, fn):
	ph = _ph()
	_error, _parse, _auth, _success = ph._api()
	if not _auth(_parse("sid", sid)):
		return _error(_("Not authenticated"), 401)
	try:
		ensure()
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
		frappe.log_error(title="ops_vendors", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _arg(name, value=None):
	return _ph()._arg(name, value)


def _data(value):
	return _ph()._json(_arg("data", value), {})


_endpoint = frappe.whitelist(allow_guest=True, methods=["POST"])


@_endpoint
def get_vendor_board(sid=None):
	return _run(sid, board)


@_endpoint
def get_vendor_detail(vendor=None, sid=None):
	return _run(sid, lambda ctx: detail(ctx, cstr(_arg("vendor", vendor))))


@_endpoint
def save_ops_vendor(data=None, sid=None):
	return _run(sid, lambda ctx: save_vendor(ctx, _data(data)))


@_endpoint
def set_vendor_status(vendor=None, status=None, reason=None, sid=None):
	return _run(sid, lambda ctx: set_status(ctx, cstr(_arg("vendor", vendor)), cstr(_arg("status", status)), cstr(_arg("reason", reason) or "")))


@_endpoint
def delete_ops_vendor(vendor=None, sid=None):
	return _run(sid, lambda ctx: delete_vendor(ctx, cstr(_arg("vendor", vendor))))


@_endpoint
def import_ops_vendors(rows=None, sid=None):
	return _run(sid, lambda ctx: import_vendors(ctx, _ph()._json(_arg("rows", rows), [])))


@_endpoint
def export_ops_vendors(sid=None):
	return _run(sid, export_csv)


@_endpoint
def save_vendor_category(data=None, sid=None):
	return _run(sid, lambda ctx: save_category(ctx, _data(data)))


@_endpoint
def delete_vendor_category(name=None, sid=None):
	return _run(sid, lambda ctx: delete_category(ctx, cstr(_arg("name", name))))


@_endpoint
def save_vendor_po(data=None, sid=None):
	return _run(sid, lambda ctx: save_po(ctx, _data(data)))


@_endpoint
def set_vendor_po_status(po_no=None, status=None, data=None, sid=None):
	return _run(sid, lambda ctx: set_po_status(ctx, cstr(_arg("po_no", po_no)), cstr(_arg("status", status)), _data(data)))


@_endpoint
def get_vendor_po_pdf(po_no=None, sid=None):
	return _run(sid, lambda ctx: po_pdf(ctx, cstr(_arg("po_no", po_no))))


@_endpoint
def record_vendor_payment(data=None, sid=None):
	return _run(sid, lambda ctx: record_payment(ctx, _data(data)))


@_endpoint
def delete_vendor_payment(pay_no=None, sid=None):
	return _run(sid, lambda ctx: delete_payment(ctx, cstr(_arg("pay_no", pay_no))))


@_endpoint
def upload_vendor_document(data=None, sid=None):
	return _run(sid, lambda ctx: upload_document(ctx, _data(data)))


@_endpoint
def get_vendor_document(name=None, sid=None):
	return _run(sid, lambda ctx: get_document(ctx, cstr(_arg("name", name))))


@_endpoint
def delete_vendor_document(name=None, sid=None):
	return _run(sid, lambda ctx: delete_document(ctx, cstr(_arg("name", name))))
