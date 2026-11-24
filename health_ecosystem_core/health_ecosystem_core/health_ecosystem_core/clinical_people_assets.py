"""People HRMS asset inventory.

Every physical item is one People Asset row with a unique serial / asset number. Adding a quantity
creates that many rows. Stock is counted from item status, so it moves automatically when items are
assigned, returned, transferred, repaired, damaged, lost or disposed. Every change writes a People
Asset Movement row (the asset history). Assignments create an Asset Assignment report that HR and the
employee sign on screen (see clinical_people_access).
"""

from __future__ import annotations

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core import clinical_phase90_people_hrms as hrms

ASSET_DT = hrms.ASSET_DT
ASSET_CAT_DT = hrms.ASSET_CAT_DT
MOVE_DT = "People Asset Movement"
AGREEMENT_DT = "People Asset Agreement"
STATUSES = ("Assigned", "Available", "In Repair", "Under Maintenance", "Damaged", "Lost", "Retired")
CONDITIONS = ("New", "Good", "Fair", "Poor", "Damaged")
ACTIONS = ("assign", "transfer", "return", "repair", "maintenance", "ready", "damage", "loss", "dispose", "audit")
OPEN_KINDS = ("Assign", "Transfer", "Repair", "Maintenance")
IMAGE_MAX = 2 * 1024 * 1024
MAX_QTY = 50

INVENTORY_FIELDS = [
	{"fieldname": "brand", "label": "Brand", "fieldtype": "Data"},
	{"fieldname": "model", "label": "Model", "fieldtype": "Data"},
	{"fieldname": "vendor", "label": "Vendor", "fieldtype": "Data"},
	{"fieldname": "purchase_date", "label": "Purchase Date", "fieldtype": "Date"},
	{"fieldname": "purchase_cost", "label": "Purchase Cost", "fieldtype": "Float"},
	{"fieldname": "warranty_until", "label": "Warranty Until", "fieldtype": "Date"},
	{"fieldname": "reorder_level", "label": "Reorder Level", "fieldtype": "Int"},
	{"fieldname": "condition", "label": "Condition", "fieldtype": "Select", "options": "\n".join(CONDITIONS), "default": "Good"},
	{"fieldname": "expected_return", "label": "Expected Return", "fieldtype": "Date"},
]
MOVE_FIELDS = [
	{"fieldname": "asset", "label": "Asset", "fieldtype": "Link", "options": ASSET_DT, "reqd": 1, "in_list_view": 1},
	{"fieldname": "kind", "label": "Kind", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Open\nClosed", "default": "Open", "in_list_view": 1},
	{"fieldname": "employee", "label": "Employee", "fieldtype": "Data"},
	{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "employee_id", "label": "Employee ID", "fieldtype": "Data"},
	{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
	{"fieldname": "from_employee", "label": "From Employee", "fieldtype": "Data"},
	{"fieldname": "from_location", "label": "From Location", "fieldtype": "Data"},
	{"fieldname": "to_location", "label": "To Location", "fieldtype": "Data"},
	{"fieldname": "condition", "label": "Condition", "fieldtype": "Data"},
	{"fieldname": "expected_return", "label": "Expected Return", "fieldtype": "Date"},
	{"fieldname": "note", "label": "Note", "fieldtype": "Small Text"},
	{"fieldname": "agreement", "label": "Agreement", "fieldtype": "Data"},
	{"fieldname": "actor", "label": "By", "fieldtype": "Data"},
	{"fieldname": "happened_on", "label": "When", "fieldtype": "Datetime", "in_list_view": 1},
]
REQ_DT = hrms.ASSET_REQ_DT
REQ_STATUSES = ("Pending", "Approved", "Rejected", "Fulfilled", "Cancelled")
PRIORITIES = ("Normal", "High", "Urgent")
REQUEST_FIELDS = [
	{"fieldname": "category", "label": "Category", "fieldtype": "Data"},
	{"fieldname": "quantity", "label": "Quantity", "fieldtype": "Int"},
	{"fieldname": "priority", "label": "Priority", "fieldtype": "Select", "options": "\n".join(PRIORITIES)},
	{"fieldname": "needed_by", "label": "Needed By", "fieldtype": "Date"},
	{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
	{"fieldname": "designation", "label": "Designation", "fieldtype": "Data"},
	{"fieldname": "hr_note", "label": "HR Note", "fieldtype": "Small Text"},
	{"fieldname": "decided_by", "label": "Decided By", "fieldtype": "Data"},
	{"fieldname": "decided_on", "label": "Decided On", "fieldtype": "Datetime"},
	{"fieldname": "assigned_assets", "label": "Assigned Assets", "fieldtype": "Small Text"},
	{"fieldname": "agreement", "label": "Assignment Report", "fieldtype": "Data"},
	{"fieldname": "fulfilled_on", "label": "Fulfilled On", "fieldtype": "Datetime"},
	{"fieldname": "status", "fieldtype": "Select", "options": "\n".join(REQ_STATUSES)},
]
ASSET_FIELDS = (
	"name", "title", "category", "serial", "status", "location", "department", "assigned_employee",
	"employee_name", "employee_id", "photo", "assign_date", "notes", "modified", "creation",
	"brand", "model", "vendor", "purchase_date", "purchase_cost", "warranty_until", "reorder_level",
	"condition", "expected_return",
)


# ---------------------------------------------------------------- schema


def _sync_fields(doctype, fields):
	"""Add fields introduced after the DocType was first created and keep Select options current."""
	have = {f.fieldname for f in frappe.get_meta(doctype).fields}
	missing = [f for f in fields if f["fieldname"] not in have]
	changed = False
	if missing:
		doc = frappe.get_doc("DocType", doctype)
		for field in missing:
			doc.append("fields", field)
		doc.save(ignore_permissions=True)
		changed = True
	for field in fields:
		if field.get("fieldtype") != "Select":
			continue
		current = frappe.db.get_value("DocField", {"parent": doctype, "fieldname": field["fieldname"]}, "options")
		if current is not None and cstr(current) != field["options"]:
			frappe.db.set_value("DocField", {"parent": doctype, "fieldname": field["fieldname"]}, "options", field["options"])
			changed = True
	if changed:
		frappe.clear_cache(doctype=doctype)


def ensure():
	if not hrms.ensure_people_asset_doctypes():
		frappe.throw(_("Assets desk is not available"))
	hrms._ensure_custom_doctype(MOVE_DT, MOVE_FIELDS)
	_sync_fields(ASSET_DT, INVENTORY_FIELDS + [{"fieldname": "status", "fieldtype": "Select", "options": "\n".join(STATUSES)}])
	_sync_fields(REQ_DT, REQUEST_FIELDS)


# ---------------------------------------------------------------- rows


def _date(value):
	return getdate(value) if value else None


def _asset_row(d):
	location = cstr(d.get("location"))
	return {
		"id": d.get("name"),
		"title": d.get("title") or "",
		"category": d.get("category") or "Other",
		"brand": d.get("brand") or "",
		"model": d.get("model") or "",
		"vendor": d.get("vendor") or "",
		"serial": d.get("serial") or "",
		"status": d.get("status") or "Available",
		"location": location,
		"department": d.get("department") or hrms.LOCATION_DEPT.get(location, "Others"),
		"assigned_employee": d.get("assigned_employee") or "",
		"employee_name": d.get("employee_name") or "",
		"employee_id": d.get("employee_id") or "",
		"photo": d.get("photo") or "",
		"assign_date": cstr(d.get("assign_date") or ""),
		"expected_return": cstr(d.get("expected_return") or ""),
		"purchase_date": cstr(d.get("purchase_date") or ""),
		"purchase_cost": flt(d.get("purchase_cost")),
		"warranty_until": cstr(d.get("warranty_until") or ""),
		"condition": d.get("condition") or "",
		"reorder_level": max(cint(d.get("reorder_level")), 0),
		"notes": d.get("notes") or "",
		"modified": cstr(d.get("modified") or ""),
	}


def _move_row(d):
	return {
		"id": d.get("name"),
		"asset": d.get("asset") or "",
		"kind": d.get("kind") or "",
		"status": d.get("status") or "",
		"employee_name": d.get("employee_name") or "",
		"employee_id": d.get("employee_id") or "",
		"department": d.get("department") or "",
		"from_employee": d.get("from_employee") or "",
		"from_location": d.get("from_location") or "",
		"to_location": d.get("to_location") or "",
		"condition": d.get("condition") or "",
		"expected_return": cstr(d.get("expected_return") or ""),
		"note": d.get("note") or "",
		"agreement": d.get("agreement") or "",
		"actor": d.get("actor") or "",
		"happened_on": cstr(d.get("happened_on") or ""),
	}


def _employees():
	if not frappe.db.exists("DocType", "Employee"):
		return []
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "image"] + [f for f in ("designation", "branch") if meta.has_field(f)]
	rows = frappe.get_all("Employee", filters={"status": "Active"}, fields=fields, order_by="employee_name asc", limit_page_length=2000)
	return [
		{
			"id": r.name,
			"name": r.employee_name or r.name,
			"department": r.department or "",
			"designation": r.get("designation") or "",
			"branch": r.get("branch") or "",
			"photo": r.image or "",
		}
		for r in rows
	]


def _stock(rows):
	groups = {}
	for row in rows:
		key = "|".join((row["title"], row["brand"], row["model"], row["category"]))
		g = groups.setdefault(
			key,
			{
				"key": key, "title": row["title"], "brand": row["brand"], "model": row["model"], "category": row["category"],
				"total": 0, "available": 0, "assigned": 0, "maintenance": 0, "damaged": 0, "lost": 0, "retired": 0,
				"reorder": 0, "value": 0.0,
			},
		)
		status = row["status"]
		if status == "Retired":
			g["retired"] += 1
			continue
		g["total"] += 1
		g["value"] += row["purchase_cost"]
		if status == "Available":
			g["available"] += 1
		elif status == "Assigned":
			g["assigned"] += 1
		elif status in ("In Repair", "Under Maintenance"):
			g["maintenance"] += 1
		elif status == "Damaged":
			g["damaged"] += 1
		elif status == "Lost":
			g["lost"] += 1
		g["reorder"] = max(g["reorder"], row["reorder_level"])
	out = []
	for g in groups.values():
		g["low"] = g["reorder"] > 0 and g["available"] <= g["reorder"]
		out.append(g)
	out.sort(key=lambda g: (not g["low"], g["title"].lower()))
	return out


def _agreements(manager, emp):
	if not frappe.db.exists("DocType", AGREEMENT_DT):
		return []
	from health_ecosystem_core.health_ecosystem_core.clinical_people_access import _agreement_row

	filters = {}
	if not manager:
		if not emp:
			return []
		filters["employee"] = emp.name
	names = frappe.get_all(AGREEMENT_DT, filters=filters, pluck="name", order_by="creation desc", limit_page_length=80)
	return [_agreement_row(frappe.get_doc(AGREEMENT_DT, n)) for n in names]


# ---------------------------------------------------------------- requests


REQ_LIST_FIELDS = (
	"name", "title", "employee", "employee_name", "employee_id", "status", "note", "request_date", "creation",
	"category", "quantity", "priority", "needed_by", "department", "designation", "hr_note", "decided_by",
	"decided_on", "assigned_assets", "agreement", "fulfilled_on",
)


def _employee_card(employee_id):
	if not employee_id or not frappe.db.exists("Employee", employee_id):
		return {}
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "image"] + [f for f in ("designation", "branch", "cell_number", "company_email", "user_id") if meta.has_field(f)]
	return frappe.db.get_value("Employee", employee_id, fields, as_dict=True) or {}


def _requester(d):
	"""employee_id is the requester; older rows may hold the HR user's own employee in `employee`."""
	return cstr(d.get("employee_id") or d.get("employee"))


def _request_row(d, cards):
	emp_id = _requester(d)
	card = cards.get(emp_id) or {}
	return {
		"id": d.get("name"),
		"title": d.get("title") or "",
		"category": d.get("category") or "",
		"quantity": cint(d.get("quantity")) or 1,
		"priority": d.get("priority") or "Normal",
		"needed_by": cstr(d.get("needed_by") or ""),
		"note": d.get("note") or "",
		"status": d.get("status") or "Pending",
		"request_date": cstr(d.get("request_date") or d.get("creation") or "")[:10],
		"employee": emp_id,
		"employee_name": d.get("employee_name") or card.get("employee_name") or "",
		"employee_id": d.get("employee_id") or emp_id,
		"department": d.get("department") or card.get("department") or "",
		"designation": d.get("designation") or card.get("designation") or "",
		"branch": card.get("branch") or "",
		"phone": card.get("cell_number") or "",
		"email": card.get("company_email") or card.get("user_id") or "",
		"photo": card.get("image") or "",
		"hr_note": d.get("hr_note") or "",
		"decided_by": d.get("decided_by") or "",
		"decided_on": cstr(d.get("decided_on") or ""),
		"assigned_assets": d.get("assigned_assets") or "",
		"agreement": d.get("agreement") or "",
		"fulfilled_on": cstr(d.get("fulfilled_on") or ""),
	}


def _requests(manager, emp):
	if manager:
		rows = frappe.get_all(REQ_DT, fields=list(REQ_LIST_FIELDS), order_by="creation desc", limit_page_length=500)
	else:
		if not emp:
			return []
		rows = frappe.get_all(
			REQ_DT,
			or_filters={"employee": emp.name, "employee_id": emp.name},
			fields=list(REQ_LIST_FIELDS),
			order_by="creation desc",
			limit_page_length=200,
		)
		rows = [r for r in rows if _requester(r) == emp.name]
	ids = {_requester(r) for r in rows if _requester(r)}
	cards = {i: _employee_card(i) for i in ids}
	return [_request_row(r, cards) for r in rows]


def submit_request(roles, data):
	ensure()
	data = data if isinstance(data, dict) else {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Tell HR which asset you need"))
	reason = cstr(data.get("note")).strip()
	if not reason:
		frappe.throw(_("Add the reason for the request"))
	emp = hrms._people_employee_for_user()
	employee_id = emp.name if emp else ""
	if hrms.is_people_manager(roles) and cstr(data.get("employee")).strip():
		employee_id = cstr(data.get("employee")).strip()
	if not employee_id:
		frappe.throw(_("Your login is not linked to an employee record. Ask HR to link it."))
	card = _employee_card(employee_id)
	if not card:
		frappe.throw(_("Employee not found"))
	priority = cstr(data.get("priority") or "Normal")
	doc = frappe.get_doc(
		{
			"doctype": REQ_DT,
			"title": title[:140],
			"category": cstr(data.get("category"))[:140],
			"quantity": min(max(cint(data.get("quantity") or 1), 1), 20),
			"priority": priority if priority in PRIORITIES else "Normal",
			"needed_by": _date(data.get("needed_by")),
			"employee": card.name,
			"employee_name": card.employee_name or card.name,
			"employee_id": card.name,
			"department": cstr(card.department)[:140],
			"designation": cstr(card.get("designation"))[:140],
			"status": "Pending",
			"note": reason[:1000],
			"request_date": today(),
		}
	).insert(ignore_permissions=True)
	hrms._log_asset_activity("Request", "Asset Requested", f"{card.employee_name} requested {title}")
	return _request_row(doc.as_dict(), {card.name: card})


def decide_request(roles, request_id, status, note):
	if not request_id or not frappe.db.exists(REQ_DT, request_id):
		frappe.throw(_("Request not found"))
	ensure()
	doc = frappe.get_doc(REQ_DT, request_id)
	status = cstr(status).strip()
	if status == "Cancelled":
		emp = hrms._people_employee_for_user()
		own = emp and emp.name == _requester(doc)
		if not own and not hrms.is_people_manager(roles):
			frappe.throw(_("Not allowed"), frappe.PermissionError)
		if doc.status not in ("Pending", "Approved"):
			frappe.throw(_("Only open requests can be cancelled"))
	else:
		hrms._require_manager(roles)
		if status not in ("Approved", "Rejected", "Pending"):
			frappe.throw(_("Invalid status"))
		if doc.status in ("Fulfilled", "Cancelled"):
			frappe.throw(_("This request is already {0}").format(doc.status.lower()))
		if status == "Rejected" and not cstr(note).strip():
			frappe.throw(_("Add a note telling the employee why"))
	doc.status = status
	if cstr(note).strip():
		doc.hr_note = cstr(note).strip()[:1000]
	doc.decided_by = hrms._asset_actor()[:140]
	doc.decided_on = now_datetime()
	doc.save(ignore_permissions=True)
	hrms._log_asset_activity("Request", f"Request {status.lower()}", f"{doc.employee_name}: {doc.title}{(' · ' + cstr(note).strip()) if cstr(note).strip() else ''}")
	return _request_row(doc.as_dict(), {})


def my_assets(roles):
	ensure()
	emp = hrms._people_employee_for_user()
	if not emp:
		return {"employee": None, "assets": [], "requests": [], "agreements": [], "categories": []}
	rows = [
		_asset_row(d)
		for d in frappe.get_all(ASSET_DT, filters={"assigned_employee": emp.name}, fields=list(ASSET_FIELDS), order_by="assign_date desc", limit_page_length=200)
	]
	if not rows:
		rows = [_asset_row(d) for d in frappe.get_all(ASSET_DT, filters={"employee_id": emp.name, "status": "Assigned"}, fields=list(ASSET_FIELDS), limit_page_length=200)]
	return {
		"employee": {"id": emp.name, "name": emp.employee_name},
		"assets": rows,
		"requests": _requests(False, emp),
		"agreements": _agreements(False, emp),
		"categories": frappe.get_all(ASSET_CAT_DT, pluck="title", order_by="title asc", limit_page_length=100),
	}


# ---------------------------------------------------------------- board


def board(roles):
	ensure()
	payload = hrms.get_people_assets(roles)
	manager = hrms.is_people_manager(roles)
	emp = hrms._people_employee_for_user()
	rows = [_asset_row(d) for d in frappe.get_all(ASSET_DT, fields=list(ASSET_FIELDS), order_by="modified desc", limit_page_length=5000)]
	if not manager:
		mine = {emp.name, emp.employee_name} if emp else set()
		rows = [r for r in rows if mine and (r["assigned_employee"] in mine or r["employee_id"] in mine or r["employee_name"] in mine)]
	ids = {r["id"] for r in rows}
	stock = _stock(rows)
	horizon = add_days(getdate(today()), 30)
	counts = {s: 0 for s in STATUSES}
	warranty = 0
	value = 0.0
	for r in rows:
		counts[r["status"]] = counts.get(r["status"], 0) + 1
		if r["status"] != "Retired":
			value += r["purchase_cost"]
		if r["warranty_until"] and r["status"] not in ("Retired", "Lost") and getdate(r["warranty_until"]) <= horizon:
			warranty += 1
	moves = frappe.get_all(
		MOVE_DT,
		fields=[f["fieldname"] for f in MOVE_FIELDS] + ["name"],
		order_by="happened_on desc, creation desc",
		limit_page_length=400,
	)
	payload.update(
		{
			"assets": rows,
			"stock": stock,
			"movements": [_move_row(m) for m in moves if manager or m.asset in ids],
			"agreements": _agreements(manager, emp),
			"requests": _requests(manager, emp),
			"employees": _employees() if manager else [],
			"me": {"id": emp.name, "name": emp.employee_name} if emp else None,
			"statuses": list(STATUSES),
			"conditions": list(CONDITIONS),
		}
	)
	payload["kpis"] = {
		"total": sum(v for k, v in counts.items() if k != "Retired"),
		"assigned": counts["Assigned"],
		"available": counts["Available"],
		"maintenance": counts["In Repair"] + counts["Under Maintenance"],
		"damaged": counts["Damaged"],
		"lost": counts["Lost"],
		"retired": counts["Retired"],
		"warranty": warranty,
		"low_stock": sum(1 for g in stock if g["low"]),
		"value": round(value, 2),
		"prev_total": cint((payload.get("kpis") or {}).get("prev_total")),
	}
	return payload


# ---------------------------------------------------------------- create / edit


def _unique_serial(preferred):
	preferred = cstr(preferred).strip()[:80]
	if preferred and not frappe.db.exists(ASSET_DT, {"serial": preferred}):
		return preferred
	base = preferred or "AST-" + now_datetime().strftime("%y%m%d")
	for n in range(1, 10000):
		candidate = f"{base}-{n:03d}"[:80]
		if not frappe.db.exists(ASSET_DT, {"serial": candidate}):
			return candidate
	frappe.throw(_("Could not allocate a unique serial number"))


def _store_image(doc, file_name, file_data):
	raw = cstr(file_data)
	if raw.startswith("data:") and "," in raw:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw)
	except Exception:
		frappe.throw(_("Invalid image data"))
	if len(content) > IMAGE_MAX:
		frappe.throw(_("Image must be 2 MB or less"))
	f = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": re.sub(r"[^\w.\-]+", "-", cstr(file_name) or "asset.jpg")[:120],
			"content": content,
			"is_private": 0,
			"attached_to_doctype": ASSET_DT,
			"attached_to_name": doc.name,
		}
	).insert(ignore_permissions=True)
	return f.file_url


def save_item(roles, data):
	hrms._require_manager(roles)
	ensure()
	data = data if isinstance(data, dict) else {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Asset name is required"))
	location = cstr(data.get("location")).strip()
	condition = cstr(data.get("condition") or "Good")
	values = {
		"title": title[:180],
		"category": cstr(data.get("category") or "Other")[:140],
		"brand": cstr(data.get("brand")).strip()[:140],
		"model": cstr(data.get("model")).strip()[:140],
		"vendor": cstr(data.get("vendor")).strip()[:140],
		"location": location[:140],
		"department": cstr(data.get("department") or hrms.LOCATION_DEPT.get(location, "Others"))[:140],
		"purchase_date": _date(data.get("purchase_date")),
		"purchase_cost": max(flt(data.get("purchase_cost")), 0),
		"warranty_until": _date(data.get("warranty_until")),
		"reorder_level": max(cint(data.get("reorder_level")), 0),
		"condition": condition if condition in CONDITIONS else "Good",
		"notes": cstr(data.get("notes"))[:1000],
	}
	serial = cstr(data.get("serial")).strip()[:80]
	name = cstr(data.get("id")).strip()
	if name:
		if not frappe.db.exists(ASSET_DT, name):
			frappe.throw(_("Asset not found"))
		if serial:
			other = frappe.db.get_value(ASSET_DT, {"serial": serial}, "name")
			if other and other != name:
				frappe.throw(_("Serial number {0} is already used by another item").format(serial))
			values["serial"] = serial
		doc = frappe.get_doc(ASSET_DT, name)
		doc.update(values)
		if data.get("image_data"):
			doc.photo = _store_image(doc, data.get("image_name"), data.get("image_data"))
		elif data.get("remove_photo"):
			doc.photo = ""
		doc.save(ignore_permissions=True)
		hrms._log_asset_activity("Updated", "Asset Updated", f"{title} · {doc.serial}", asset=doc.name)
		return {"created": 0, "assets": [_asset_row(doc.as_dict())]}

	qty = max(cint(data.get("quantity") or 1), 1)
	if qty > MAX_QTY:
		frappe.throw(_("Add at most {0} items at a time").format(MAX_QTY))
	serials = [cstr(s).strip()[:80] for s in (data.get("serials") or []) if cstr(s).strip()]
	if serials and len(serials) != qty:
		frappe.throw(_("Enter one serial number per item ({0} needed, {1} given)").format(qty, len(serials)))
	if len(set(serials)) != len(serials):
		frappe.throw(_("Serial numbers must be unique"))
	if not serials and qty == 1 and serial:
		serials = [serial]
	for s in serials:
		if frappe.db.exists(ASSET_DT, {"serial": s}):
			frappe.throw(_("Serial number {0} already exists").format(s))
	status = cstr(data.get("status") or "Available")
	if status not in ("Available", "In Repair", "Under Maintenance", "Damaged"):
		status = "Available"
	created = []
	photo = ""
	for i in range(qty):
		item_serial = serials[i] if serials else _unique_serial(f"{serial}-{i + 1:03d}" if serial else "")
		doc = frappe.get_doc({"doctype": ASSET_DT, **values, "serial": item_serial, "status": status, "photo": photo})
		doc.insert(ignore_permissions=True)
		if i == 0 and data.get("image_data"):
			photo = _store_image(doc, data.get("image_name"), data.get("image_data"))
			doc.db_set("photo", photo, update_modified=False)
		_move(doc, "Stock In", {"note": f"Added to stock ({qty} unit{'s' if qty > 1 else ''})"})
		created.append(doc)
	detail = f"{title} · {created[0].serial}" if qty == 1 else f"{qty} × {title} ({created[0].serial} … {created[-1].serial})"
	hrms._log_asset_activity("Added", "New Asset Added", detail, asset=created[0].name)
	return {"created": qty, "assets": [_asset_row(d.as_dict()) for d in created]}


# ---------------------------------------------------------------- movements


def _close_open(asset, kinds):
	for name in frappe.get_all(MOVE_DT, filters={"asset": asset, "status": "Open", "kind": ("in", list(kinds))}, pluck="name"):
		frappe.db.set_value(MOVE_DT, name, "status", "Closed", update_modified=False)


def _move(doc, kind, info, agreement=""):
	info = info or {}
	frappe.get_doc(
		{
			"doctype": MOVE_DT,
			"asset": doc.name,
			"kind": kind,
			"status": "Open" if kind in OPEN_KINDS else "Closed",
			"employee": cstr(info.get("employee") or doc.assigned_employee)[:140],
			"employee_name": cstr(info.get("employee_name") or doc.employee_name)[:140],
			"employee_id": cstr(info.get("employee_id") or doc.employee_id)[:80],
			"department": cstr(info.get("department") or doc.department)[:140],
			"from_employee": cstr(info.get("from_employee"))[:140],
			"from_location": cstr(info.get("from_location"))[:140],
			"to_location": cstr(doc.location)[:140],
			"condition": cstr(doc.get("condition"))[:40],
			"expected_return": doc.get("expected_return") if kind in ("Assign", "Transfer") else None,
			"note": cstr(info.get("note"))[:500],
			"agreement": agreement,
			"actor": hrms._asset_actor()[:140],
			"happened_on": now_datetime(),
		}
	).insert(ignore_permissions=True)


def _clear_holder(doc):
	doc.assigned_employee = ""
	doc.employee_name = ""
	doc.employee_id = ""
	doc.assign_date = None
	doc.expected_return = None


def _employee_info(employee_id):
	if not employee_id or not frappe.db.exists("Employee", employee_id):
		frappe.throw(_("Select an employee"))
	row = frappe.db.get_value("Employee", employee_id, ["name", "employee_name", "department", "status"], as_dict=True)
	if row.status not in ("Active", None, ""):
		frappe.throw(_("{0} is not an active employee").format(row.employee_name))
	return row


def _label(doc):
	return f"{doc.title} ({doc.serial})" if doc.serial else doc.title


def _apply(doc, act, data):
	"""Change one item. Returns (movement kind, movement info, needs assignment report)."""
	if doc.status == "Retired" and act != "audit":
		frappe.throw(_("{0} has been disposed").format(_label(doc)))
	condition = cstr(data.get("condition"))
	if condition in CONDITIONS:
		doc.condition = condition
	note = cstr(data.get("note")).strip()
	info = {"note": note, "from_employee": doc.employee_name or "", "from_location": doc.location or ""}
	location = cstr(data.get("location")).strip()

	if act in ("assign", "transfer"):
		employee_id = cstr(data.get("employee")).strip()
		if act == "assign" and doc.status != "Available":
			frappe.throw(_("{0} is {1}. Only available stock can be assigned.").format(_label(doc), doc.status.lower()))
		if act == "transfer" and doc.status == "Lost":
			frappe.throw(_("{0} is reported lost").format(_label(doc)))
		if act == "transfer" and not employee_id:
			if not location or location == doc.location:
				frappe.throw(_("Choose the employee or branch to transfer to"))
			doc.location = location[:140]
			doc.department = hrms.LOCATION_DEPT.get(location, doc.department or "Others")
			hrms._log_asset_activity("Transfer", "Asset Transfer", f"{_label(doc)} moved to {location}", asset=doc.name)
			return "Transfer", info, False
		emp = _employee_info(employee_id)
		if act == "transfer" and emp.name == doc.assigned_employee and (not location or location == doc.location):
			frappe.throw(_("{0} is already with {1}").format(_label(doc), emp.employee_name))
		new_holder = emp.name != doc.assigned_employee
		doc.status = "Assigned"
		doc.assigned_employee = emp.name
		doc.employee_name = emp.employee_name or emp.name
		doc.employee_id = emp.name
		doc.department = cstr(emp.department or doc.department or "Others")[:140]
		if location:
			doc.location = location[:140]
		if new_holder or act == "assign":
			doc.assign_date = _date(data.get("assign_date")) or getdate(today())
		if data.get("expected_return") or act == "assign":
			doc.expected_return = _date(data.get("expected_return"))
		if doc.expected_return and doc.assign_date and getdate(doc.expected_return) < getdate(doc.assign_date):
			frappe.throw(_("Expected return cannot be before the assignment date"))
		_close_open(doc.name, ("Assign", "Transfer"))
		verb = "assigned to" if act == "assign" else "transferred to"
		hrms._log_asset_activity("Assigned" if act == "assign" else "Transfer", "Asset Assigned" if act == "assign" else "Asset Transfer", f"{_label(doc)} {verb} {doc.employee_name}", asset=doc.name)
		return ("Assign" if act == "assign" else "Transfer"), info, new_holder

	if act == "return":
		if doc.status == "Available":
			frappe.throw(_("{0} is already in stock").format(_label(doc)))
		info.update({"employee_name": doc.employee_name, "employee_id": doc.employee_id, "employee": doc.assigned_employee})
		_close_open(doc.name, OPEN_KINDS)
		_clear_holder(doc)
		doc.status = "Damaged" if condition == "Damaged" else "Available"
		if location:
			doc.location = location[:140]
		hrms._log_asset_activity("Collected", "Asset Returned", f"{_label(doc)} returned by {info['employee_name'] or 'holder'}", asset=doc.name)
		return "Return", info, False

	if act in ("repair", "maintenance"):
		if doc.status == "Lost":
			frappe.throw(_("{0} is reported lost").format(_label(doc)))
		doc.status = "In Repair" if act == "repair" else "Under Maintenance"
		hrms._log_asset_activity("Repair", "Sent for " + ("repair" if act == "repair" else "maintenance"), _label(doc), asset=doc.name)
		return ("Repair" if act == "repair" else "Maintenance"), info, False

	if act == "ready":
		if doc.status not in ("In Repair", "Under Maintenance", "Damaged"):
			frappe.throw(_("{0} is not under repair or maintenance").format(_label(doc)))
		_close_open(doc.name, ("Repair", "Maintenance"))
		doc.status = "Assigned" if doc.assigned_employee else "Available"
		if doc.condition == "Damaged":
			doc.condition = "Good"
		hrms._log_asset_activity("Updated", "Repair completed", f"{_label(doc)} is {doc.status.lower()}", asset=doc.name)
		return "Repaired", info, False

	if act == "damage":
		if doc.status == "Lost":
			frappe.throw(_("{0} is reported lost").format(_label(doc)))
		doc.status = "Damaged"
		doc.condition = "Damaged"
		hrms._log_asset_activity("Damage", "Damage reported", f"{_label(doc)}{(' · ' + note) if note else ''}", asset=doc.name)
		return "Damage", info, False

	if act == "loss":
		if doc.status == "Lost":
			frappe.throw(_("{0} is already reported lost").format(_label(doc)))
		info.update({"employee_name": doc.employee_name, "employee_id": doc.employee_id, "employee": doc.assigned_employee})
		_close_open(doc.name, OPEN_KINDS)
		_clear_holder(doc)
		doc.status = "Lost"
		hrms._log_asset_activity("Loss", "Loss reported", f"{_label(doc)}{(' · ' + note) if note else ''}", asset=doc.name)
		return "Loss", info, False

	if act == "dispose":
		if not note:
			frappe.throw(_("Add a disposal note (method, buyer or reason)"))
		info.update({"employee_name": doc.employee_name, "employee_id": doc.employee_id, "employee": doc.assigned_employee})
		_close_open(doc.name, OPEN_KINDS)
		_clear_holder(doc)
		doc.status = "Retired"
		hrms._log_asset_activity("Retired", "Asset Disposed", f"{_label(doc)} · {note}", asset=doc.name)
		return "Dispose", info, False

	if act == "audit":
		hrms._log_asset_activity("Audit", "Asset Audit", f"{_label(doc)}{(' · ' + note) if note else ''}", asset=doc.name)
		return "Audit", info, False

	frappe.throw(_("Unknown action"))


def update_items(roles, asset_ids, action, data):
	hrms._require_manager(roles)
	ensure()
	act = cstr(action).strip().lower()
	if act not in ACTIONS:
		frappe.throw(_("Unknown action"))
	ids = []
	for a in asset_ids or []:
		a = cstr(a).strip()
		if a and a not in ids:
			ids.append(a)
	if not ids:
		frappe.throw(_("Select at least one asset"))
	if len(ids) > 100:
		frappe.throw(_("Select at most 100 assets"))
	data = data if isinstance(data, dict) else {}
	request = None
	request_id = cstr(data.get("request")).strip()
	if request_id:
		if act != "assign":
			frappe.throw(_("Requests are fulfilled by assigning an item"))
		if not frappe.db.exists(REQ_DT, request_id):
			frappe.throw(_("Request not found"))
		request = frappe.get_doc(REQ_DT, request_id)
		if request.status not in ("Pending", "Approved"):
			frappe.throw(_("This request is already {0}").format(cstr(request.status).lower()))
		requester = _requester(request)
		if requester and cstr(data.get("employee")) != requester:
			frappe.throw(_("Assign the item to {0}, who raised this request").format(request.employee_name or requester))
	done = []
	for asset in ids:
		if not frappe.db.exists(ASSET_DT, asset):
			frappe.throw(_("Asset not found"))
		doc = frappe.get_doc(ASSET_DT, asset)
		kind, info, report = _apply(doc, act, data)
		doc.save(ignore_permissions=True)
		done.append((doc, kind, info, report))

	agreement = ""
	reported = [d for d, _k, _i, report in done if report]
	if reported and reported[0].assigned_employee:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_access import create_agreement, sign_agreement

		agreement = cstr(create_agreement(reported[0].assigned_employee, [d.name for d in reported]).get("id"))
		signature = cstr(data.get("hr_signature"))
		if agreement and signature.startswith("data:image/"):
			sign_agreement(agreement, "hr", signature, roles)
	for doc, kind, info, report in done:
		if request and not info.get("note"):
			info["note"] = f"Request: {request.title}"
		_move(doc, kind, info, agreement if report else "")
	if request:
		request.status = "Fulfilled"
		request.assigned_assets = ", ".join(_label(d) for d, *_ in done)[:1000]
		request.agreement = agreement
		request.fulfilled_on = now_datetime()
		request.decided_by = hrms._asset_actor()[:140]
		if not request.decided_on:
			request.decided_on = now_datetime()
		request.save(ignore_permissions=True)
	return {"updated": len(done), "agreement": agreement, "request": request.name if request else "", "assets": [_asset_row(d.as_dict()) for d, *_ in done]}


def delete_items(roles, asset_ids, reason):
	"""Remove items entered by mistake. Signed assignment reports keep their own snapshot of the item."""
	hrms._require_manager(roles)
	ensure()
	reason = cstr(reason).strip()
	if not reason:
		frappe.throw(_("Add a reason for deleting"))
	ids = []
	for a in asset_ids or []:
		a = cstr(a).strip()
		if a and a not in ids:
			ids.append(a)
	if not ids:
		frappe.throw(_("Select at least one asset"))
	if len(ids) > 100:
		frappe.throw(_("Select at most 100 assets"))
	docs = []
	for asset in ids:
		if not frappe.db.exists(ASSET_DT, asset):
			frappe.throw(_("Asset not found"))
		doc = frappe.get_doc(ASSET_DT, asset)
		if doc.status == "Assigned":
			frappe.throw(_("{0} is with {1}. Return it to stock before deleting.").format(_label(doc), doc.employee_name or _("an employee")))
		docs.append(doc)
	for doc in docs:
		label = _label(doc)
		for name in frappe.get_all(MOVE_DT, filters={"asset": doc.name}, pluck="name"):
			frappe.delete_doc(MOVE_DT, name, ignore_permissions=True, force=True)
		for name in frappe.get_all(hrms.ASSET_ACT_DT, filters={"asset": doc.name}, pluck="name"):
			frappe.db.set_value(hrms.ASSET_ACT_DT, name, "asset", "", update_modified=False)
		photo = cstr(doc.photo)
		shared = photo and frappe.db.count(ASSET_DT, {"photo": photo, "name": ("!=", doc.name)})
		for name in frappe.get_all("File", filters={"attached_to_doctype": ASSET_DT, "attached_to_name": doc.name}, fields=["name", "file_url"]):
			if shared and name.file_url == photo:
				continue
			frappe.delete_doc("File", name.name, ignore_permissions=True, force=True)
		frappe.delete_doc(ASSET_DT, doc.name, ignore_permissions=True, force=True)
		hrms._log_asset_activity("Deleted", "Asset Deleted", f"{label} · {reason}")
	return {"deleted": len(docs)}


# ---------------------------------------------------------------- whitelisted API


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles


def _json(value, fallback):
	if value in (None, ""):
		return fallback
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("Invalid request data"))


def _run(sid, fn, *args):
	_error, _parse, _require, _success, _roles = _api()
	denied = _require(_parse("sid", sid))
	if denied:
		return denied
	try:
		return _success(fn(_roles(), *args))
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="people_assets", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_asset_inventory(sid=None):
	return _run(sid, board)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_inventory_asset(asset=None, sid=None):
	parse = _api()[1]
	return _run(sid, lambda roles: save_item(roles, _json(parse("asset", asset), {})))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_assets(sid=None):
	return _run(sid, my_assets)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def submit_asset_request(request=None, sid=None):
	parse = _api()[1]
	return _run(sid, lambda roles: submit_request(roles, _json(parse("request", request), {})))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def decide_asset_request(request=None, status=None, note=None, sid=None):
	parse = _api()[1]
	return _run(sid, lambda roles: decide_request(roles, cstr(parse("request", request)), cstr(parse("status", status)), cstr(parse("note", note))))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def delete_inventory_assets(assets=None, reason=None, sid=None):
	parse = _api()[1]
	return _run(sid, lambda roles: delete_items(roles, _json(parse("assets", assets), []), cstr(parse("reason", reason))))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def update_inventory_assets(assets=None, action=None, data=None, sid=None):
	parse = _api()[1]
	return _run(
		sid,
		lambda roles: update_items(roles, _json(parse("assets", assets), []), cstr(parse("action", action)), _json(parse("data", data), {})),
	)
