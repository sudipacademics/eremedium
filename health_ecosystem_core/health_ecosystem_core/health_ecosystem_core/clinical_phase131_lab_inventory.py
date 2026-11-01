"""Phase 131 — Lab inventory management (central store, material requisitions, dispatch to units).

Inventory lives in custom DocTypes, not ERPNext warehouses / Stock Ledger, so nothing here touches accounting.
Stock is held per batch (item + batch no + location). Every movement writes one immutable Lab Inventory
Transaction row with the signed qty and the batch / item balance after it; cancellations write reversal rows,
history is never edited or deleted.

Franchise partners (Franchisee Profile) request material from the /b2b portal; internal company units
(Lab Company Unit) request from the lab portal. The Lab Manager approves (fully / partially) or rejects,
prepares and dispatches. Dispatch picks batches FEFO (earliest expiry first) and never ships expired stock.
"""

from __future__ import annotations

import base64
import csv
import io
import json
from datetime import date

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, get_fullname, get_first_day, get_last_day, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success

ITEM_DT = "Lab Inventory Item"
BATCH_DT = "Lab Inventory Batch"
TXN_DT = "Lab Inventory Transaction"
UNIT_DT = "Lab Company Unit"
UNIT_USER_DT = "Lab Company Unit User"
REQ_DT = "Lab Material Requisition"
REQ_ITEM_DT = "Lab Material Requisition Item"
DSP_DT = "Lab Material Dispatch"
DSP_ITEM_DT = "Lab Material Dispatch Item"
PROFILE_DT = "Franchisee Profile"
UNIT_STOCK_DT = "Lab Unit Stock"
UNIT_TXN_DT = "Lab Unit Stock Transaction"
UNIT_SETTING_DT = "Lab Unit Item Setting"
UNIT_STORE = "Unit Store"
UNIT_TXN_TYPES = ("Receipt", "Usage", "Adjustment", "Reversal")

LAB_MANAGER = "Lab Manager"
MATERIAL_REQUESTER = "Material Requester"
MANAGE_ROLES = frozenset({LAB_MANAGER, "System Manager", "Health System Admin", "Administrator"})
VIEW_ROLES = MANAGE_ROLES | {"Lab Technician", "Pathologist"}
REQUEST_ROLES = VIEW_ROLES | {MATERIAL_REQUESTER}
SMOKE_FLAG = "lab_inventory_smoke"

EXPIRY_WINDOW_DAYS = 90
EPS = 0.0005
MAX_LINES = 200
MAX_EXPORT_ROWS = 20000

TXN_STOCK_IN = "Stock In"
TXN_ADJUST = "Adjustment"
TXN_TRANSFER = "Transfer"
TXN_DISPATCH = "Dispatch"
TXN_REVERSAL = "Reversal"
TXN_TYPES = (TXN_STOCK_IN, TXN_ADJUST, TXN_TRANSFER, TXN_DISPATCH, TXN_REVERSAL)

REQ_FRANCHISE = "Franchise"
REQ_COMPANY = "Company Unit"

S_SUBMITTED = "Submitted"
S_APPROVED = "Approved"
S_PARTIAL = "Partially Approved"
S_REJECTED = "Rejected"
S_PREPARING = "Preparing"
S_PART_DISPATCHED = "Partially Dispatched"
S_DISPATCHED = "Dispatched"
S_RECEIVED = "Received"
S_CANCELLED = "Cancelled"
REQ_STATUSES = (
	S_SUBMITTED,
	S_APPROVED,
	S_PARTIAL,
	S_REJECTED,
	S_PREPARING,
	S_PART_DISPATCHED,
	S_DISPATCHED,
	S_RECEIVED,
	S_CANCELLED,
)
REVIEWABLE = (S_SUBMITTED, S_APPROVED, S_PARTIAL, S_PREPARING)
DISPATCHABLE = (S_APPROVED, S_PARTIAL, S_PREPARING, S_PART_DISPATCHED)
OPEN_STATUSES = (S_SUBMITTED, S_APPROVED, S_PARTIAL, S_PREPARING, S_PART_DISPATCHED)

D_DISPATCHED = "Dispatched"
D_RECEIVED = "Received"
D_CANCELLED = "Cancelled"

ITEM_STATUSES = ("In Stock", "Low Stock", "Expiring Soon", "Out of Stock", "Expired")

DEFAULT_CATEGORIES = (
	"Lab Consumables",
	"Reagents",
	"PPE",
	"Disposables",
	"Glassware",
	"Equipment Spares",
	"Stationery",
	"Other",
)
DEFAULT_UNITS = ("Pcs", "Box", "Kit", "Pack", "Bottle", "Vial", "Roll", "mL", "Litre", "Gram", "Set")
DEFAULT_LOCATIONS = ("Main Store", "Reagent Store", "Cold Room")
ADJUST_REASONS = (
	"Physical count correction",
	"Damaged / broken",
	"Expired - written off",
	"Lost / missing",
	"Consumed in lab",
	"Returned to supplier",
	"Found / excess",
	"Other",
)
LOGISTICS_MODES = ("Courier", "Own vehicle", "Runner / field staff", "Hand delivery", "Transport / bus parcel")
UNIT_TYPES = ("Collection Centre", "Lab", "Clinic", "Hospital", "Office", "Warehouse", "Other")


def _fail(message):
	raise frappe.ValidationError(message)


def _deny(message):
	raise frappe.PermissionError(message)


def _is_manager(roles):
	return bool(set(roles or []) & MANAGE_ROLES)


def _requester_only(roles):
	"""Company-unit staff without any lab role: scoped to the units they are listed on."""
	roles = set(roles or [])
	return MATERIAL_REQUESTER in roles and not roles & VIEW_ROLES


def _scope_units(roles):
	"""None = unrestricted; otherwise the company units this user may see."""
	if not _requester_only(roles):
		return None
	return {u["name"] for u in _units_for_user(roles)}


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _ensure_doctype(name, fields, permissions=None, istable=0, autoname="hash", extra=None):
	"""Create the custom DocType, or append fields added since it was created."""
	if frappe.db.exists("DocType", name):
		doc = frappe.get_doc("DocType", name)
		have = {f.fieldname for f in doc.fields}
		missing = [f for f in fields if f.get("fieldname") not in have]
		if missing:
			for f in missing:
				doc.append("fields", f)
			doc.save(ignore_permissions=True)
			frappe.clear_cache(doctype=name)
		return False
	doc = {
		"doctype": "DocType",
		"name": name,
		"module": "Health Ecosystem Core",
		"custom": 1,
		"istable": istable,
		"autoname": autoname,
		"naming_rule": "Random" if autoname == "hash" else "Expression (old style)",
		"engine": "InnoDB",
		"fields": fields,
	}
	if istable:
		doc["editable_grid"] = 1
	else:
		doc["track_changes"] = 1
		doc["permissions"] = permissions or []
	doc.update(extra or {})
	frappe.get_doc(doc).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def _perms(write_roles, read_roles, create=1, delete=1):
	perms = [
		{"role": r, "read": 1, "write": 1, "create": create, "delete": delete, "report": 1, "export": 1}
		for r in write_roles
	]
	perms += [{"role": r, "read": 1, "report": 1, "export": 1} for r in read_roles]
	return perms


def _ensure_roles():
	created = []
	for role, desk in ((LAB_MANAGER, 1), (MATERIAL_REQUESTER, 0)):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk}).insert(ignore_permissions=True)
			created.append(f"Role {role}")
	return created


def _sel(options):
	return "\n".join(options)


def _holder_fields():
	return [
		{"fieldname": "holder_type", "label": "Holder Type", "fieldtype": "Select", "options": "Franchise\nCompany Unit", "reqd": 1, "in_standard_filter": 1},
		{"fieldname": "franchisee", "label": "Franchise Unit", "fieldtype": "Link", "options": "Franchisee Profile", "in_standard_filter": 1, "search_index": 1},
		{"fieldname": "company_unit", "label": "Company Unit", "fieldtype": "Link", "options": "Lab Company Unit", "in_standard_filter": 1, "search_index": 1},
	]


def ensure_lab_inventory_setup():
	created = _ensure_roles()
	managers = (LAB_MANAGER, "System Manager", "Health System Admin")
	readers = ("Lab Technician", "Pathologist")
	master_perms = _perms(managers, readers)
	flow_perms = _perms(managers, readers, delete=0)
	ledger_perms = _perms((), managers + readers)

	specs = [
		(
			UNIT_USER_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1},
				{"fieldname": "full_name", "label": "Name", "fieldtype": "Data", "fetch_from": "user.full_name", "read_only": 1, "in_list_view": 1},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			UNIT_DT,
			[
				{"fieldname": "unit_name", "label": "Unit Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "unit_code", "label": "Unit Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "unit_type", "label": "Unit Type", "fieldtype": "Select", "options": _sel(UNIT_TYPES), "default": "Collection Centre", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "contact_person", "label": "Contact Person", "fieldtype": "Data"},
				{"fieldname": "contact_phone", "label": "Contact Phone", "fieldtype": "Data"},
				{"fieldname": "address", "label": "Delivery Address", "fieldtype": "Small Text"},
				{"fieldname": "users", "label": "Users who can request for this unit", "fieldtype": "Table", "options": UNIT_USER_DT},
			],
			master_perms,
			0,
			"hash",
			{"title_field": "unit_name", "search_fields": "unit_code"},
		),
		(
			ITEM_DT,
			[
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "sku", "label": "SKU / Item Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Data", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "default": "Pcs", "in_list_view": 1},
				{"fieldname": "min_stock", "label": "Minimum Stock Level", "fieldtype": "Float", "default": "0", "in_list_view": 1},
				{"fieldname": "supplier", "label": "Supplier", "fieldtype": "Data", "in_standard_filter": 1},
				{"fieldname": "default_location", "label": "Default Storage Location", "fieldtype": "Data", "default": "Main Store"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "unit_min_stock", "label": "Default Minimum at Units", "fieldtype": "Float", "default": "0", "description": "Low-stock level for franchise / company unit stock unless the unit sets its own."},
			],
			master_perms,
			0,
			"hash",
			{"title_field": "item_name", "search_fields": "sku,category"},
		),
		(
			BATCH_DT,
			[
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "fetch_from": "item.item_name", "read_only": 1},
				{"fieldname": "batch_no", "label": "Batch No.", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "expiry_date", "label": "Expiry Date", "fieldtype": "Date", "in_list_view": 1},
				{"fieldname": "location", "label": "Storage Location", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "qty", "label": "Quantity On Hand", "fieldtype": "Float", "default": "0", "read_only": 1, "in_list_view": 1},
				{"fieldname": "unit_cost", "label": "Unit Cost", "fieldtype": "Currency"},
				{"fieldname": "supplier", "label": "Supplier", "fieldtype": "Data"},
				{"fieldname": "received_on", "label": "First Received On", "fieldtype": "Date"},
			],
			_perms((), managers + readers),
			0,
			"hash",
			{"title_field": "batch_no"},
		),
		(
			TXN_DT,
			[
				{"fieldname": "posting_datetime", "label": "Posted At", "fieldtype": "Datetime", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "transaction_type", "label": "Type", "fieldtype": "Select", "options": _sel(TXN_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "sku", "label": "SKU", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "batch", "label": "Batch", "fieldtype": "Link", "options": BATCH_DT, "search_index": 1},
				{"fieldname": "batch_no", "label": "Batch No.", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "expiry_date", "label": "Expiry Date", "fieldtype": "Date", "read_only": 1},
				{"fieldname": "location", "label": "Location", "fieldtype": "Data", "in_standard_filter": 1},
				{"fieldname": "counter_location", "label": "From / To Location", "fieldtype": "Data"},
				{"fieldname": "qty_delta", "label": "Qty (+ in / - out)", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
				{"fieldname": "balance_after", "label": "Batch Balance After", "fieldtype": "Float"},
				{"fieldname": "item_balance_after", "label": "Item On-hand After", "fieldtype": "Float"},
				{"fieldname": "reason", "label": "Reason", "fieldtype": "Data"},
				{"fieldname": "reference_no", "label": "Reference No. (GRN / invoice / transfer)", "fieldtype": "Data"},
				{"fieldname": "reference_doctype", "label": "Reference Type", "fieldtype": "Link", "options": "DocType"},
				{"fieldname": "reference_name", "label": "Reference", "fieldtype": "Dynamic Link", "options": "reference_doctype", "search_index": 1},
				{"fieldname": "destination", "label": "Destination Unit", "fieldtype": "Data"},
				{"fieldname": "reversal_of", "label": "Reversal Of", "fieldtype": "Link", "options": TXN_DT},
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User"},
				{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
			],
			ledger_perms,
			0,
			"hash",
			{"sort_field": "posting_datetime", "sort_order": "DESC"},
		),
		(
			REQ_ITEM_DT,
			[
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "sku", "label": "SKU", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "requested_qty", "label": "Requested Qty", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
				{"fieldname": "approved_qty", "label": "Approved Qty", "fieldtype": "Float", "default": "0", "in_list_view": 1},
				{"fieldname": "dispatched_qty", "label": "Dispatched Qty", "fieldtype": "Float", "default": "0", "read_only": 1, "in_list_view": 1},
				{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Data"},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			REQ_DT,
			[
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(REQ_STATUSES), "default": S_SUBMITTED, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "requester_type", "label": "Requesting Unit Type", "fieldtype": "Select", "options": _sel((REQ_FRANCHISE, REQ_COMPANY)), "reqd": 1, "in_standard_filter": 1},
				{"fieldname": "franchisee", "label": "Franchise Unit", "fieldtype": "Link", "options": PROFILE_DT, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "company_unit", "label": "Company Unit", "fieldtype": "Link", "options": UNIT_DT, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "unit_name", "label": "Unit", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "requested_by", "label": "Requested By", "fieldtype": "Link", "options": "User"},
				{"fieldname": "requested_on", "label": "Requested On", "fieldtype": "Datetime", "in_list_view": 1},
				{"fieldname": "required_by", "label": "Required By", "fieldtype": "Date"},
				{"fieldname": "priority", "label": "Priority", "fieldtype": "Select", "options": "Normal\nUrgent", "default": "Normal"},
				{"fieldname": "delivery_address", "label": "Delivery Address", "fieldtype": "Small Text"},
				{"fieldname": "remarks", "label": "Requester Remarks", "fieldtype": "Small Text"},
				{"fieldname": "items", "label": "Items", "fieldtype": "Table", "options": REQ_ITEM_DT},
				{"fieldname": "approval_status", "label": "Approval Outcome", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "reviewed_by", "label": "Reviewed By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "reviewed_on", "label": "Reviewed On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "review_remarks", "label": "Review Remarks", "fieldtype": "Small Text"},
				{"fieldname": "prepared_by", "label": "Prepared By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "prepared_on", "label": "Preparation Started", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "closed_remarks", "label": "Closure / Cancellation Remarks", "fieldtype": "Small Text"},
			],
			flow_perms,
			0,
			"LMR-.YYYY.-.#####",
			{"title_field": "unit_name", "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			DSP_ITEM_DT,
			[
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "sku", "label": "SKU", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "batch", "label": "Batch", "fieldtype": "Link", "options": BATCH_DT, "reqd": 1},
				{"fieldname": "batch_no", "label": "Batch No.", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "expiry_date", "label": "Expiry", "fieldtype": "Date", "read_only": 1, "in_list_view": 1},
				{"fieldname": "location", "label": "From Location", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "qty", "label": "Qty", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
				{"fieldname": "requisition_line", "label": "Requisition Line", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "transaction", "label": "Ledger Entry", "fieldtype": "Link", "options": TXN_DT, "read_only": 1},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			DSP_DT,
			[
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel((D_DISPATCHED, D_RECEIVED, D_CANCELLED)), "default": D_DISPATCHED, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "requisition", "label": "Requisition", "fieldtype": "Link", "options": REQ_DT, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "destination_type", "label": "Destination Type", "fieldtype": "Select", "options": _sel((REQ_FRANCHISE, REQ_COMPANY)), "reqd": 1},
				{"fieldname": "franchisee", "label": "Franchise Unit", "fieldtype": "Link", "options": PROFILE_DT, "search_index": 1},
				{"fieldname": "company_unit", "label": "Company Unit", "fieldtype": "Link", "options": UNIT_DT, "search_index": 1},
				{"fieldname": "destination_name", "label": "Destination", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "dispatch_date", "label": "Dispatch Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "logistics_mode", "label": "Logistics Mode", "fieldtype": "Data"},
				{"fieldname": "courier", "label": "Courier / Logistics Partner", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "tracking_no", "label": "Tracking / Reference No.", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "logistics_details", "label": "Vehicle / Person / Contact", "fieldtype": "Small Text"},
				{"fieldname": "from_location", "label": "Picked From Location", "fieldtype": "Data"},
				{"fieldname": "items", "label": "Items", "fieldtype": "Table", "options": DSP_ITEM_DT},
				{"fieldname": "total_qty", "label": "Total Qty", "fieldtype": "Float", "read_only": 1},
				{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
				{"fieldname": "dispatched_by", "label": "Dispatched By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "received_by", "label": "Received By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "received_on", "label": "Received On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "receipt_remarks", "label": "Receipt Remarks", "fieldtype": "Small Text"},
				{"fieldname": "cancelled_by", "label": "Cancelled By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "cancelled_on", "label": "Cancelled On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "cancel_reason", "label": "Cancellation Reason", "fieldtype": "Small Text"},
				{"fieldname": "unit_stock_posted", "label": "Added to Unit Stock", "fieldtype": "Check", "default": "0", "read_only": 1},
			],
			flow_perms,
			0,
			"LMD-.YYYY.-.#####",
			{"title_field": "destination_name", "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			UNIT_STOCK_DT,
			_holder_fields()
			+ [
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "fetch_from": "item.item_name", "read_only": 1},
				{"fieldname": "batch_no", "label": "Batch No.", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "expiry_date", "label": "Expiry Date", "fieldtype": "Date", "in_list_view": 1},
				{"fieldname": "location", "label": "Location at Unit", "fieldtype": "Data", "default": UNIT_STORE, "in_list_view": 1},
				{"fieldname": "qty", "label": "Quantity On Hand", "fieldtype": "Float", "default": "0", "read_only": 1, "in_list_view": 1},
			],
			_perms((), managers + readers),
			0,
			"hash",
			{"title_field": "batch_no"},
		),
		(
			UNIT_TXN_DT,
			_holder_fields()
			+ [
				{"fieldname": "posting_datetime", "label": "Posted At", "fieldtype": "Datetime", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "transaction_type", "label": "Type", "fieldtype": "Select", "options": _sel(UNIT_TXN_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "sku", "label": "SKU", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "stock", "label": "Unit Stock Row", "fieldtype": "Link", "options": UNIT_STOCK_DT},
				{"fieldname": "batch_no", "label": "Batch No.", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "expiry_date", "label": "Expiry Date", "fieldtype": "Date", "read_only": 1},
				{"fieldname": "location", "label": "Location", "fieldtype": "Data"},
				{"fieldname": "qty_delta", "label": "Qty (+ in / - out)", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
				{"fieldname": "balance_after", "label": "Batch Balance After", "fieldtype": "Float"},
				{"fieldname": "item_balance_after", "label": "Item On-hand After", "fieldtype": "Float"},
				{"fieldname": "reason", "label": "Reason", "fieldtype": "Data"},
				{"fieldname": "reference_doctype", "label": "Reference Type", "fieldtype": "Link", "options": "DocType"},
				{"fieldname": "reference_name", "label": "Reference", "fieldtype": "Dynamic Link", "options": "reference_doctype", "search_index": 1},
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User"},
				{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
			],
			ledger_perms,
			0,
			"hash",
			{"sort_field": "posting_datetime", "sort_order": "DESC"},
		),
		(
			UNIT_SETTING_DT,
			_holder_fields()
			+ [
				{"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": ITEM_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "min_stock", "label": "Minimum Stock at Unit", "fieldtype": "Float", "default": "0", "in_list_view": 1},
			],
			_perms((), managers + readers),
			0,
			"hash",
			None,
		),
	]
	for name, fields, perms, istable, autoname, extra in specs:
		if _ensure_doctype(name, fields, perms, istable=istable, autoname=autoname, extra=extra):
			created.append(name)
	return created


def setup_phase131():
	"""Idempotent: Lab Manager role + inventory / requisition / dispatch DocTypes."""
	created = ensure_lab_inventory_setup()
	frappe.db.commit()
	return {"ok": True, "created": created, "doctypes": [ITEM_DT, BATCH_DT, TXN_DT, UNIT_DT, REQ_DT, DSP_DT]}


# ---------------------------------------------------------------------------
# Stock math
# ---------------------------------------------------------------------------


def _q(value):
	return flt(value, 3)


def _date(value):
	return getdate(value) if value else None


def _today():
	return getdate(today())


def _fefo_key(b):
	exp = _date(b.get("expiry_date"))
	return (exp is None, exp or date.max, cstr(b.get("creation")))


def _summarize(item, batches, today_d=None):
	"""Derive available qty and stock status for one item from its batches."""
	today_d = today_d or _today()
	soon = add_days(today_d, EXPIRY_WINDOW_DAYS)
	available = expired = expiring = 0.0
	live = []
	locations = set()
	for b in batches:
		qty = _q(b.qty)
		if qty <= EPS:
			continue
		exp = _date(b.expiry_date)
		if exp and exp < today_d:
			expired += qty
			continue
		available += qty
		live.append(b)
		locations.add(cstr(b.location))
		if exp and exp <= getdate(soon):
			expiring += qty
	live.sort(key=_fefo_key)
	min_stock = _q(item.min_stock)
	if available <= EPS:
		status = "Expired" if expired > EPS else "Out of Stock"
	elif available <= min_stock + EPS:
		status = "Low Stock"
	elif expiring > EPS:
		status = "Expiring Soon"
	else:
		status = "In Stock"
	nxt = live[0] if live else None
	return {
		"available_qty": _q(available),
		"expired_qty": _q(expired),
		"expiring_qty": _q(expiring),
		"batch_count": len(live),
		"next_batch_no": nxt.batch_no if nxt else None,
		"next_expiry": cstr(nxt.expiry_date) if nxt and nxt.expiry_date else None,
		"locations": sorted(locations),
		"location": (sorted(locations)[0] if len(locations) == 1 else (f"{len(locations)} locations" if locations else (item.default_location or ""))),
		"status": status,
	}


def _item_fields():
	return ["name", "item_name", "sku", "category", "unit", "min_stock", "supplier", "default_location", "active", "description", "unit_min_stock"]


def _item_row(item, summary):
	return {
		"name": item.name,
		"item_name": item.item_name,
		"sku": item.sku,
		"category": item.category or "",
		"unit": item.unit or "",
		"min_stock": _q(item.min_stock),
		"supplier": item.supplier or "",
		"default_location": item.default_location or "",
		"active": cint(item.active),
		"description": item.description or "",
		"unit_min_stock": _q(item.get("unit_min_stock")),
		**summary,
	}


def _all_batches(location=None, item=None):
	filters = {}
	if location:
		filters["location"] = location
	if item:
		filters["item"] = item
	return frappe.get_all(
		BATCH_DT,
		filters=filters,
		fields=["name", "item", "batch_no", "expiry_date", "location", "qty", "unit_cost", "supplier", "received_on", "creation"],
		order_by="creation asc",
		limit_page_length=0,
	)


def _group(rows, key):
	out = {}
	for r in rows:
		out.setdefault(r.get(key), []).append(r)
	return out


def _lock_item(item):
	row = frappe.db.sql(
		f"select name, item_name, sku, unit, active from `tab{ITEM_DT}` where name=%s for update", (item,), as_dict=True
	)
	if not row:
		_fail(_("Inventory item {0} not found").format(item))
	return row[0]


def _lock_batch(batch, with_item=True):
	"""Row-lock a batch. Locks its item first: every writer takes item -> batch locks in that order."""
	if with_item:
		item = frappe.db.get_value(BATCH_DT, batch, "item")
		if not item:
			_fail(_("Batch {0} not found").format(batch))
		_lock_item(item)
	row = frappe.db.sql(
		f"select name, item, batch_no, expiry_date, location, qty, unit_cost, supplier from `tab{BATCH_DT}` where name=%s for update",
		(batch,),
		as_dict=True,
	)
	if not row:
		_fail(_("Batch {0} not found").format(batch))
	return row[0]


def _item_on_hand(item):
	return _q((frappe.db.sql(f"select coalesce(sum(qty), 0) from `tab{BATCH_DT}` where item=%s", (item,)) or [[0]])[0][0])


def _post(batch, delta, txn_type, *, reason=None, reference_no=None, ref_doctype=None, ref_name=None, destination=None, counter_location=None, remarks=None, reversal_of=None):
	"""Apply a signed qty to a batch under a row lock and write its ledger row. Never goes negative."""
	delta = _q(delta)
	if abs(delta) <= EPS:
		_fail(_("Quantity must be non-zero"))
	b = _lock_batch(batch)
	item = frappe.db.get_value(ITEM_DT, b.item, ["item_name", "sku", "unit"], as_dict=True)
	new_qty = _q(flt(b.qty) + delta)
	if new_qty < -EPS:
		_fail(
			_("Insufficient stock for {0} batch {1} at {2}: on hand {3}, requested {4}").format(
				item.item_name, b.batch_no, b.location, _q(b.qty), abs(delta)
			)
		)
	frappe.db.set_value(BATCH_DT, b.name, "qty", max(new_qty, 0))
	txn = frappe.get_doc(
		{
			"doctype": TXN_DT,
			"posting_datetime": now_datetime(),
			"transaction_type": txn_type,
			"item": b.item,
			"item_name": item.item_name,
			"sku": item.sku,
			"unit": item.unit,
			"batch": b.name,
			"batch_no": b.batch_no,
			"expiry_date": b.expiry_date,
			"location": b.location,
			"counter_location": counter_location,
			"qty_delta": delta,
			"balance_after": max(new_qty, 0),
			"item_balance_after": _item_on_hand(b.item),
			"reason": reason,
			"reference_no": reference_no,
			"reference_doctype": ref_doctype if ref_name else None,
			"reference_name": ref_name,
			"destination": destination,
			"reversal_of": reversal_of,
			"user": frappe.session.user,
			"remarks": remarks,
		}
	)
	txn.insert(ignore_permissions=True)
	return txn.name


def _get_or_create_batch(item, batch_no, location, expiry_date=None, unit_cost=None, supplier=None, received_on=None):
	batch_no = cstr(batch_no).strip()
	location = cstr(location).strip()
	existing = frappe.db.get_value(BATCH_DT, {"item": item, "batch_no": batch_no, "location": location}, ["name", "expiry_date"], as_dict=True)
	if existing:
		if expiry_date and existing.expiry_date and getdate(expiry_date) != getdate(existing.expiry_date):
			_fail(
				_("Batch {0} at {1} already has expiry {2}; use a different batch number for a different expiry").format(
					batch_no, location, existing.expiry_date
				)
			)
		if expiry_date and not existing.expiry_date:
			frappe.db.set_value(BATCH_DT, existing.name, "expiry_date", getdate(expiry_date))
		return existing.name
	doc = frappe.get_doc(
		{
			"doctype": BATCH_DT,
			"item": item,
			"batch_no": batch_no,
			"location": location,
			"expiry_date": getdate(expiry_date) if expiry_date else None,
			"qty": 0,
			"unit_cost": flt(unit_cost) or None,
			"supplier": supplier or None,
			"received_on": getdate(received_on) if received_on else _today(),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _fefo_allocate(item, qty, location=None, taken=None):
	"""Lock and pick non-expired batches, earliest expiry first. Returns [(batch row, qty)]."""
	taken = taken if taken is not None else {}
	vals = {"item": item, "today": _today()}
	loc = ""
	if location:
		loc = " and location=%(location)s"
		vals["location"] = location
	rows = frappe.db.sql(
		f"""select name, batch_no, expiry_date, location, qty, creation from `tab{BATCH_DT}`
		where item=%(item)s and qty > 0 and (expiry_date is null or expiry_date >= %(today)s){loc}
		order by expiry_date is null, expiry_date asc, creation asc for update""",
		vals,
		as_dict=True,
	)
	need = _q(qty)
	picks = []
	for r in rows:
		free = _q(flt(r.qty) - flt(taken.get(r.name)))
		if free <= EPS:
			continue
		take = min(free, need)
		picks.append((r, _q(take)))
		taken[r.name] = _q(flt(taken.get(r.name)) + take)
		need = _q(need - take)
		if need <= EPS:
			break
	if need > EPS:
		meta = frappe.db.get_value(ITEM_DT, item, ["item_name", "unit"], as_dict=True) or frappe._dict()
		have = _q(qty - need)
		_fail(
			_("Not enough non-expired stock for {0}{1}: available {2} {3}, requested {4}").format(
				meta.item_name or item, f" at {location}" if location else "", have, meta.unit or "", _q(qty)
			)
		)
	return picks


# ---------------------------------------------------------------------------
# Items, dashboard, meta
# ---------------------------------------------------------------------------


def _distinct(doctype, field):
	return [
		r[0]
		for r in frappe.db.sql(f"select distinct `{field}` from `tab{doctype}` where ifnull(`{field}`, '') != '' order by `{field}`")
	]


def inventory_meta(roles):
	categories = sorted(set(DEFAULT_CATEGORIES) | set(_distinct(ITEM_DT, "category")))
	locations = sorted(set(DEFAULT_LOCATIONS) | set(_distinct(BATCH_DT, "location")) | set(_distinct(ITEM_DT, "default_location")))
	suppliers = sorted(set(_distinct(ITEM_DT, "supplier")) | set(_distinct(BATCH_DT, "supplier")))
	units = sorted(set(DEFAULT_UNITS) | set(_distinct(ITEM_DT, "unit")))
	return {
		"categories": categories,
		"locations": locations,
		"suppliers": suppliers,
		"units": units,
		"adjust_reasons": list(ADJUST_REASONS),
		"logistics_modes": list(LOGISTICS_MODES),
		"unit_types": list(UNIT_TYPES),
		"item_statuses": list(ITEM_STATUSES),
		"requisition_statuses": list(REQ_STATUSES),
		"transaction_types": list(TXN_TYPES),
		"expiry_window_days": EXPIRY_WINDOW_DAYS,
		"can_manage": _is_manager(roles),
		"my_units": [{"name": u["name"], "unit_name": u["unit_name"], "unit_code": u["unit_code"]} for u in _units_for_user(roles)],
	}


def inventory_kpis():
	today_d = _today()
	soon = getdate(add_days(today_d, EXPIRY_WINDOW_DAYS))
	items = frappe.get_all(ITEM_DT, filters={"active": 1}, fields=_item_fields(), limit_page_length=0)
	by_item = _group(_all_batches(), "item")
	available = 0.0
	low = 0
	expiring_batches = 0
	expiring_items = set()
	expired_batches = 0
	for it in items:
		batches = by_item.get(it.name) or []
		s = _summarize(it, batches, today_d)
		available += s["available_qty"]
		if s["available_qty"] <= _q(it.min_stock) + EPS:
			low += 1
		for b in batches:
			if _q(b.qty) <= EPS or not b.expiry_date:
				continue
			exp = getdate(b.expiry_date)
			if exp < today_d:
				expired_batches += 1
			elif exp <= soon:
				expiring_batches += 1
				expiring_items.add(it.name)
	month_start, month_end = get_first_day(today_d), get_last_day(today_d)
	return {
		"total_items": len(items),
		"available_stock": _q(available),
		"low_stock_items": low,
		"expiring_soon": expiring_batches,
		"expiring_items": len(expiring_items),
		"expired_batches": expired_batches,
		"pending_requisitions": frappe.db.count(REQ_DT, {"status": S_SUBMITTED}),
		"to_dispatch": frappe.db.count(REQ_DT, {"status": ("in", DISPATCHABLE)}),
		"dispatched_this_month": frappe.db.count(
			DSP_DT, {"status": ("!=", D_CANCELLED), "dispatch_date": ("between", [month_start, month_end])}
		),
		"as_of": cstr(now_datetime()),
	}


def inventory_dashboard(roles):
	return {"kpis": inventory_kpis(), "meta": inventory_meta(roles)}


def _in_range(value, start, end):
	if not value:
		return False
	d = getdate(value)
	return (not start or d >= start) and (not end or d <= end)


def list_items(filters=None, page=1, page_size=10):
	f = frappe._dict(filters or {})
	show = cstr(f.show or "active")
	item_filters = {}
	if show == "active":
		item_filters["active"] = 1
	elif show == "inactive":
		item_filters["active"] = 0
	if f.category:
		item_filters["category"] = f.category
	items = frappe.get_all(ITEM_DT, filters=item_filters, fields=_item_fields(), order_by="item_name asc", limit_page_length=0)
	location = cstr(f.location).strip() or None
	by_item = _group(_all_batches(location=location), "item")
	needle = cstr(f.q).strip().lower()
	supplier = cstr(f.supplier).strip().lower()
	status = cstr(f.status).strip()
	exp_from = _date(f.expiry_from)
	exp_to = _date(f.expiry_to)
	today_d = _today()
	rows = []
	for it in items:
		batches = by_item.get(it.name) or []
		if location and not batches and cstr(it.default_location) != location:
			continue
		if needle:
			hay = " ".join([cstr(it.item_name), cstr(it.sku), cstr(it.category), cstr(it.supplier)] + [cstr(b.batch_no) + " " + cstr(b.supplier) for b in batches]).lower()
			if needle not in hay:
				continue
		if supplier and supplier != cstr(it.supplier).lower() and not any(cstr(b.supplier).lower() == supplier for b in batches):
			continue
		if (exp_from or exp_to) and not any(_q(b.qty) > EPS and _in_range(b.expiry_date, exp_from, exp_to) for b in batches):
			continue
		s = _summarize(it, batches, today_d)
		if status and s["status"] != status:
			continue
		rows.append(_item_row(it, s))
	total = len(rows)
	page_size = max(1, min(cint(page_size) or 10, MAX_EXPORT_ROWS))
	page = max(1, cint(page) or 1)
	start = (page - 1) * page_size
	counts = {}
	for r in rows:
		counts[r["status"]] = counts.get(r["status"], 0) + 1
	return {"rows": rows[start : start + page_size], "total": total, "page": page, "page_size": page_size, "status_counts": counts}


def item_detail(name):
	if not frappe.db.exists(ITEM_DT, name):
		_fail(_("Inventory item not found"))
	it = frappe.db.get_value(ITEM_DT, name, _item_fields(), as_dict=True)
	batches = _all_batches(item=name)
	s = _summarize(it, batches)
	today_d = _today()
	soon = getdate(add_days(today_d, EXPIRY_WINDOW_DAYS))
	batch_rows = []
	for b in sorted(batches, key=_fefo_key):
		exp = _date(b.expiry_date)
		batch_rows.append(
			{
				"name": b.name,
				"batch_no": b.batch_no,
				"expiry_date": cstr(b.expiry_date) if b.expiry_date else None,
				"location": b.location,
				"qty": _q(b.qty),
				"unit_cost": flt(b.unit_cost) or None,
				"supplier": b.supplier or "",
				"received_on": cstr(b.received_on) if b.received_on else None,
				"expired": bool(exp and exp < today_d),
				"expiring": bool(exp and today_d <= exp <= soon),
			}
		)
	pending = frappe.db.sql(
		f"""select coalesce(sum(greatest(l.approved_qty - l.dispatched_qty, 0)), 0)
		from `tab{REQ_ITEM_DT}` l join `tab{REQ_DT}` r on r.name = l.parent
		where l.item=%s and r.status in %s""",
		(name, DISPATCHABLE),
	)
	history = list_transactions({"item": name}, page=1, page_size=25)
	return {"item": _item_row(it, s), "batches": batch_rows, "pending_dispatch_qty": _q(pending[0][0] if pending else 0), "history": history["rows"]}


def save_item(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can edit inventory items"))
	p = frappe._dict(payload or {})
	item_name = cstr(p.item_name).strip()
	sku = cstr(p.sku).strip().upper()
	if not item_name:
		_fail(_("Item name is required"))
	if not sku:
		_fail(_("SKU / item code is required"))
	if flt(p.min_stock) < 0:
		_fail(_("Minimum stock cannot be negative"))
	clash = frappe.db.get_value(ITEM_DT, {"sku": sku}, "name")
	if clash and clash != p.name:
		_fail(_("SKU {0} is already used by another item").format(sku))
	values = {
		"item_name": item_name,
		"sku": sku,
		"category": cstr(p.category).strip() or None,
		"unit": cstr(p.unit).strip() or "Pcs",
		"min_stock": _q(p.min_stock),
		"supplier": cstr(p.supplier).strip() or None,
		"default_location": cstr(p.default_location).strip() or DEFAULT_LOCATIONS[0],
		"description": cstr(p.description).strip() or None,
		"active": 1 if p.active is None else cint(p.active),
		"unit_min_stock": max(_q(p.unit_min_stock), 0),
	}
	if p.name:
		if not frappe.db.exists(ITEM_DT, p.name):
			_fail(_("Inventory item not found"))
		doc = frappe.get_doc(ITEM_DT, p.name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": ITEM_DT, **values})
		doc.insert(ignore_permissions=True)
		opening = frappe._dict(p.opening or {})
		if flt(opening.qty) > 0:
			stock_in(
				{
					"lines": [
						{
							"item": doc.name,
							"batch_no": opening.batch_no,
							"expiry_date": opening.expiry_date,
							"location": opening.location or values["default_location"],
							"qty": opening.qty,
							"unit_cost": opening.unit_cost,
						}
					],
					"supplier": values["supplier"],
					"reference_no": opening.reference_no,
					"remarks": _("Opening stock"),
				},
				roles,
			)
	return item_detail(doc.name)


# ---------------------------------------------------------------------------
# Stock In / Adjustment / Transfer
# ---------------------------------------------------------------------------


def stock_in(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can receive stock"))
	p = frappe._dict(payload or {})
	lines = p.lines or []
	if not lines:
		_fail(_("Add at least one item to receive"))
	if len(lines) > MAX_LINES:
		_fail(_("Too many lines (max {0})").format(MAX_LINES))
	today_d = _today()
	posted = []
	for item in sorted({cstr((raw or {}).get("item")) for raw in lines if (raw or {}).get("item")}):
		if frappe.db.exists(ITEM_DT, item):
			_lock_item(item)
	for idx, raw in enumerate(lines, start=1):
		line = frappe._dict(raw or {})
		if not line.item or not frappe.db.exists(ITEM_DT, line.item):
			_fail(_("Line {0}: select an inventory item").format(idx))
		qty = _q(line.qty)
		if qty <= EPS:
			_fail(_("Line {0}: quantity must be greater than zero").format(idx))
		if line.expiry_date and getdate(line.expiry_date) < today_d:
			_fail(_("Line {0}: batch is already expired ({1}); do not receive expired stock").format(idx, line.expiry_date))
		item = _lock_item(line.item)
		if not cint(item.active):
			_fail(_("Line {0}: {1} is inactive").format(idx, item.item_name))
		defaults = frappe.db.get_value(ITEM_DT, line.item, ["default_location", "supplier"], as_dict=True)
		batch_no = cstr(line.batch_no).strip() or f"LOT-{today_d.strftime('%Y%m%d')}"
		location = cstr(line.location).strip() or defaults.default_location or DEFAULT_LOCATIONS[0]
		supplier = cstr(line.supplier).strip() or cstr(p.supplier).strip() or defaults.supplier
		batch = _get_or_create_batch(line.item, batch_no, location, line.expiry_date, line.unit_cost, supplier, p.received_on)
		txn = _post(
			batch,
			qty,
			TXN_STOCK_IN,
			reference_no=cstr(p.reference_no).strip() or None,
			remarks=cstr(line.remarks or p.remarks).strip() or None,
			reason=_("Received from {0}").format(supplier) if supplier else None,
		)
		posted.append({"transaction": txn, "item": line.item, "item_name": item.item_name, "batch": batch, "batch_no": batch_no, "qty": qty})
	return {"posted": posted, "count": len(posted)}


def adjust_stock(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can adjust stock"))
	p = frappe._dict(payload or {})
	if not p.batch:
		_fail(_("Select a batch to adjust"))
	reason = cstr(p.reason).strip()
	if not reason:
		_fail(_("Select a reason for the adjustment"))
	b = _lock_batch(p.batch)
	if p.counted_qty not in (None, ""):
		counted = _q(p.counted_qty)
		if counted < 0:
			_fail(_("Counted quantity cannot be negative"))
		delta = _q(counted - flt(b.qty))
	else:
		qty = _q(p.qty)
		if qty <= EPS:
			_fail(_("Quantity must be greater than zero"))
		delta = qty if cstr(p.direction) == "increase" else -qty
	if abs(delta) <= EPS:
		_fail(_("No change: counted quantity equals the quantity on hand"))
	if reason == "Other" and not cstr(p.remarks).strip():
		_fail(_("Add remarks when the reason is Other"))
	txn = _post(p.batch, delta, TXN_ADJUST, reason=reason, remarks=cstr(p.remarks).strip() or None, reference_no=cstr(p.reference_no).strip() or None)
	return {"transaction": txn, "delta": delta, "balance": _q(frappe.db.get_value(BATCH_DT, p.batch, "qty"))}


def transfer_stock(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can transfer stock"))
	p = frappe._dict(payload or {})
	if not p.batch:
		_fail(_("Select a batch to transfer"))
	to_location = cstr(p.to_location).strip()
	if not to_location:
		_fail(_("Select the destination location"))
	qty = _q(p.qty)
	if qty <= EPS:
		_fail(_("Quantity must be greater than zero"))
	b = _lock_batch(p.batch)
	if cstr(b.location) == to_location:
		_fail(_("Destination is the same as the current location"))
	dest = _get_or_create_batch(b.item, b.batch_no, to_location, b.expiry_date, b.unit_cost, b.supplier)
	ref = f"XFER-{now_datetime().strftime('%Y%m%d%H%M%S')}-{frappe.generate_hash(length=4).upper()}"
	remarks = cstr(p.remarks).strip() or None
	out_txn = _post(b.name, -qty, TXN_TRANSFER, counter_location=to_location, reference_no=ref, remarks=remarks, reason=_("Transfer to {0}").format(to_location))
	in_txn = _post(dest, qty, TXN_TRANSFER, counter_location=b.location, reference_no=ref, remarks=remarks, reason=_("Transfer from {0}").format(b.location))
	return {"reference_no": ref, "transactions": [out_txn, in_txn], "to_batch": dest}


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

TXN_FIELDS = (
	"name, posting_datetime, transaction_type, item, item_name, sku, unit, batch, batch_no, expiry_date, location, "
	"counter_location, qty_delta, balance_after, item_balance_after, reason, reference_no, reference_doctype, "
	"reference_name, destination, reversal_of, user, remarks"
)


def _txn_where(filters):
	f = frappe._dict(filters or {})
	conds = ["1=1"]
	vals = {}
	if f.transaction_type:
		conds.append("transaction_type=%(type)s")
		vals["type"] = f.transaction_type
	if f.item:
		conds.append("item=%(item)s")
		vals["item"] = f.item
	if f.location:
		conds.append("(location=%(loc)s or counter_location=%(loc)s)")
		vals["loc"] = f.location
	if f.reference:
		conds.append("(reference_name=%(ref)s or reference_no=%(ref)s)")
		vals["ref"] = f.reference
	if f.date_from:
		conds.append("posting_datetime >= %(df)s")
		vals["df"] = f"{getdate(f.date_from)} 00:00:00"
	if f.date_to:
		conds.append("posting_datetime <= %(dt)s")
		vals["dt"] = f"{getdate(f.date_to)} 23:59:59"
	if cstr(f.q).strip():
		conds.append(
			"(item_name like %(q)s or sku like %(q)s or batch_no like %(q)s or reference_name like %(q)s "
			"or reference_no like %(q)s or destination like %(q)s or reason like %(q)s)"
		)
		vals["q"] = f"%{cstr(f.q).strip()}%"
	return " and ".join(conds), vals


def _txn_row(r):
	return {
		**{k: r.get(k) for k in ("name", "transaction_type", "item", "item_name", "sku", "unit", "batch", "batch_no", "location", "counter_location", "reason", "reference_no", "reference_doctype", "reference_name", "destination", "reversal_of", "user", "remarks")},
		"posting_datetime": cstr(r.posting_datetime),
		"expiry_date": cstr(r.expiry_date) if r.expiry_date else None,
		"qty_delta": _q(r.qty_delta),
		"balance_after": _q(r.balance_after),
		"item_balance_after": _q(r.item_balance_after),
		"user_name": get_fullname(r.user) if r.user else "",
	}


def list_transactions(filters=None, page=1, page_size=20):
	where, vals = _txn_where(filters)
	page_size = max(1, min(cint(page_size) or 20, MAX_EXPORT_ROWS))
	page = max(1, cint(page) or 1)
	agg = frappe.db.sql(
		f"""select count(*) as n, coalesce(sum(case when qty_delta > 0 then qty_delta else 0 end), 0) as qty_in,
		coalesce(sum(case when qty_delta < 0 then -qty_delta else 0 end), 0) as qty_out
		from `tab{TXN_DT}` where {where}""",
		vals,
		as_dict=True,
	)[0]
	rows = frappe.db.sql(
		f"select {TXN_FIELDS} from `tab{TXN_DT}` where {where} order by posting_datetime desc, creation desc limit %(limit)s offset %(offset)s",
		{**vals, "limit": page_size, "offset": (page - 1) * page_size},
		as_dict=True,
	)
	return {
		"rows": [_txn_row(r) for r in rows],
		"total": cint(agg.n),
		"qty_in": _q(agg.qty_in),
		"qty_out": _q(agg.qty_out),
		"page": page,
		"page_size": page_size,
	}


# ---------------------------------------------------------------------------
# Units (franchise partners + internal company units)
# ---------------------------------------------------------------------------


def _unit_users(unit):
	return [r.user for r in frappe.get_all(UNIT_USER_DT, filters={"parent": unit, "parenttype": UNIT_DT}, fields=["user"], limit_page_length=0)]


def _user_access(uid):
	"""How a listed user can reach the request screens (None = they cannot yet)."""
	row = frappe.db.get_value("User", uid, ["full_name", "enabled"], as_dict=True) or frappe._dict()
	roles = set(frappe.get_roles(uid))
	if roles & MANAGE_ROLES:
		access = "Lab Manager / admin"
	elif roles & VIEW_ROLES:
		access = "Lab staff"
	elif MATERIAL_REQUESTER in roles:
		access = MATERIAL_REQUESTER
	else:
		access = None
	return {"user": uid, "full_name": row.full_name or uid, "enabled": cint(row.enabled), "access": access}


def _serialize_unit(u, with_access=False):
	users = _unit_users(u.name)
	out = {
		"name": u.name,
		"unit_name": u.unit_name,
		"unit_code": u.unit_code,
		"unit_type": u.unit_type,
		"active": cint(u.active),
		"contact_person": u.contact_person or "",
		"contact_phone": u.contact_phone or "",
		"address": u.address or "",
		"users": users,
	}
	if with_access:
		out["user_access"] = [_user_access(uid) for uid in users]
	return out


def _grant_requester_role(users):
	"""Manager-only helper: add the Material Requester role (and nothing else) to listed users who lack any request role."""
	granted = []
	for uid in users:
		if uid in ("Administrator", "Guest") or not cint(frappe.db.get_value("User", uid, "enabled")):
			continue
		if set(frappe.get_roles(uid)) & REQUEST_ROLES:
			continue
		user = frappe.get_doc("User", uid)
		user.flags.ignore_permissions = True
		user.add_roles(MATERIAL_REQUESTER)
		granted.append(uid)
	return granted


def _units_for_user(roles, user=None):
	user = user or frappe.session.user
	fields = ["name", "unit_name", "unit_code", "unit_type", "active", "contact_person", "contact_phone", "address"]
	if _is_manager(roles):
		units = frappe.get_all(UNIT_DT, filters={"active": 1}, fields=fields, order_by="unit_name asc", limit_page_length=0)
	else:
		mine = {r.parent for r in frappe.get_all(UNIT_USER_DT, filters={"user": user, "parenttype": UNIT_DT}, fields=["parent"], limit_page_length=0)}
		if not mine:
			return []
		units = frappe.get_all(UNIT_DT, filters={"active": 1, "name": ("in", list(mine))}, fields=fields, order_by="unit_name asc", limit_page_length=0)
	return [_serialize_unit(u) for u in units]


def list_company_units(roles, include_inactive=0):
	if not _is_manager(roles):
		return {"units": _units_for_user(roles)}
	filters = {} if cint(include_inactive) else {"active": 1}
	units = frappe.get_all(
		UNIT_DT,
		filters=filters,
		fields=["name", "unit_name", "unit_code", "unit_type", "active", "contact_person", "contact_phone", "address"],
		order_by="unit_name asc",
		limit_page_length=0,
	)
	return {"units": [_serialize_unit(u, with_access=True) for u in units]}


def save_company_unit(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can manage company units"))
	p = frappe._dict(payload or {})
	unit_name = cstr(p.unit_name).strip()
	code = cstr(p.unit_code).strip().upper()
	if not unit_name or not code:
		_fail(_("Unit name and code are required"))
	clash = frappe.db.get_value(UNIT_DT, {"unit_code": code}, "name")
	if clash and clash != p.name:
		_fail(_("Unit code {0} is already used").format(code))
	users = []
	for raw in p.users or []:
		u = cstr(raw).strip()
		if not u:
			continue
		uid = u if frappe.db.exists("User", u) else frappe.db.get_value("User", {"email": u}, "name")
		if not uid:
			_fail(_("User {0} not found").format(u))
		if uid not in users:
			users.append(uid)
	values = {
		"unit_name": unit_name,
		"unit_code": code,
		"unit_type": p.unit_type if p.unit_type in UNIT_TYPES else UNIT_TYPES[0],
		"active": 1 if p.active is None else cint(p.active),
		"contact_person": cstr(p.contact_person).strip() or None,
		"contact_phone": cstr(p.contact_phone).strip() or None,
		"address": cstr(p.address).strip() or None,
	}
	if p.name:
		if not frappe.db.exists(UNIT_DT, p.name):
			_fail(_("Company unit not found"))
		doc = frappe.get_doc(UNIT_DT, p.name)
		doc.update(values)
		doc.set("users", [])
	else:
		doc = frappe.get_doc({"doctype": UNIT_DT, **values})
	for uid in users:
		doc.append("users", {"user": uid})
	doc.save(ignore_permissions=True) if p.name else doc.insert(ignore_permissions=True)
	granted = _grant_requester_role(users) if cint(p.grant_requester_role) else []
	out = _serialize_unit(
		frappe.db.get_value(UNIT_DT, doc.name, ["name", "unit_name", "unit_code", "unit_type", "active", "contact_person", "contact_phone", "address"], as_dict=True),
		with_access=True,
	)
	out["granted"] = granted
	return out


def list_franchise_units(q=None, limit=50):
	filters = {"active_status": "Active"}
	or_filters = None
	needle = cstr(q).strip()
	if needle:
		or_filters = {"franchise_name": ("like", f"%{needle}%"), "name": ("like", f"%{needle}%")}
	rows = frappe.get_all(
		PROFILE_DT,
		filters=filters,
		or_filters=or_filters,
		fields=["name", "franchise_name", "branch_code", "franchisee_type", "address", "contact_phone"],
		order_by="franchise_name asc",
		limit_page_length=max(1, min(cint(limit) or 50, 200)),
	)
	return {"units": [{**r, "label": f"{r.franchise_name or r.name} ({r.name})"} for r in rows]}


def _franchise_label(fid):
	row = frappe.db.get_value(PROFILE_DT, fid, ["franchise_name", "address", "active_status"], as_dict=True)
	if not row:
		_fail(_("Franchise unit {0} not found").format(fid))
	return row


# ---------------------------------------------------------------------------
# Requisitions
# ---------------------------------------------------------------------------


def _clean_lines(lines):
	if not lines:
		_fail(_("Add at least one item to the request"))
	if len(lines) > MAX_LINES:
		_fail(_("Too many lines (max {0})").format(MAX_LINES))
	merged = {}
	order = []
	for idx, raw in enumerate(lines, start=1):
		line = frappe._dict(raw or {})
		qty = _q(line.qty if line.qty is not None else line.requested_qty)
		if not line.item:
			_fail(_("Line {0}: select an item").format(idx))
		if qty <= EPS:
			_fail(_("Line {0}: quantity must be greater than zero").format(idx))
		meta = frappe.db.get_value(ITEM_DT, line.item, ["name", "item_name", "sku", "unit", "active"], as_dict=True)
		if not meta or not cint(meta.active):
			_fail(_("Line {0}: item is not available for requests").format(idx))
		if line.item not in merged:
			merged[line.item] = {"item": meta.name, "item_name": meta.item_name, "sku": meta.sku, "unit": meta.unit, "requested_qty": 0, "remarks": []}
			order.append(line.item)
		merged[line.item]["requested_qty"] = _q(merged[line.item]["requested_qty"] + qty)
		if cstr(line.remarks).strip():
			merged[line.item]["remarks"].append(cstr(line.remarks).strip())
	return [{**merged[k], "remarks": "; ".join(merged[k]["remarks"])[:140] or None, "approved_qty": 0, "dispatched_qty": 0} for k in order]


def create_requisition(payload, roles, franchisee=None):
	p = frappe._dict(payload or {})
	if franchisee:
		requester_type, fid, unit = REQ_FRANCHISE, franchisee, None
	else:
		requester_type = p.requester_type or REQ_COMPANY
		fid = unit = None
		if requester_type == REQ_FRANCHISE:
			if not _is_manager(roles):
				_deny(_("Franchise partners raise their own requests from the partner portal"))
			fid = p.franchisee
		elif requester_type == REQ_COMPANY:
			unit = p.company_unit
			if not unit or unit not in {u["name"] for u in _units_for_user(roles)}:
				_deny(_("You can only request material for company units you are assigned to"))
		else:
			_fail(_("Unknown requesting unit type"))
	if fid:
		prof = _franchise_label(fid)
		if prof.active_status != "Active":
			_fail(_("Franchise unit {0} is not active").format(fid))
		unit_name = prof.franchise_name or fid
		address = cstr(p.delivery_address).strip() or prof.address
	else:
		u = frappe.db.get_value(UNIT_DT, unit, ["unit_name", "address"], as_dict=True)
		unit_name = u.unit_name
		address = cstr(p.delivery_address).strip() or u.address
	if p.required_by and getdate(p.required_by) < _today():
		_fail(_("Required-by date cannot be in the past"))
	doc = frappe.get_doc(
		{
			"doctype": REQ_DT,
			"status": S_SUBMITTED,
			"requester_type": requester_type,
			"franchisee": fid,
			"company_unit": unit,
			"unit_name": unit_name,
			"requested_by": frappe.session.user,
			"requested_on": now_datetime(),
			"required_by": getdate(p.required_by) if p.required_by else None,
			"priority": "Urgent" if p.priority == "Urgent" else "Normal",
			"delivery_address": address,
			"remarks": cstr(p.remarks).strip() or None,
			"items": _clean_lines(p.lines or p.items),
		}
	)
	doc.insert(ignore_permissions=True)
	_notify(_msgs_new_requisition, doc.name)
	return serialize_requisition(doc.name, with_stock=_is_manager(roles))


def _dispatch_rows_for(requisition=None, franchisee=None, company_units=None, names=None):
	filters = {}
	if requisition:
		filters["requisition"] = requisition
	if franchisee:
		filters["franchisee"] = franchisee
	if company_units is not None:
		filters["company_unit"] = ("in", list(company_units) or [""])
	if names is not None:
		filters["name"] = ("in", list(names) or [""])
	return frappe.get_all(
		DSP_DT,
		filters=filters,
		fields=[
			"name", "status", "requisition", "destination_type", "franchisee", "company_unit", "destination_name",
			"dispatch_date", "logistics_mode", "courier", "tracking_no", "logistics_details", "from_location", "total_qty",
			"remarks", "dispatched_by", "received_by", "received_on", "receipt_remarks", "cancelled_by", "cancelled_on",
			"cancel_reason", "creation",
		],
		order_by="creation desc",
		limit_page_length=0,
	)


def _serialize_dispatch(d, lines=None):
	if lines is None:
		lines = frappe.get_all(
			DSP_ITEM_DT,
			filters={"parent": d.name, "parenttype": DSP_DT},
			fields=["name", "item", "item_name", "sku", "unit", "batch", "batch_no", "expiry_date", "location", "qty", "requisition_line", "transaction"],
			order_by="idx asc",
			limit_page_length=0,
		)
	return {
		**{k: d.get(k) for k in ("name", "status", "requisition", "destination_type", "franchisee", "company_unit", "destination_name", "logistics_mode", "courier", "tracking_no", "logistics_details", "from_location", "remarks", "receipt_remarks", "cancel_reason")},
		"dispatch_date": cstr(d.dispatch_date) if d.dispatch_date else None,
		"total_qty": _q(d.total_qty),
		"dispatched_by": d.dispatched_by,
		"dispatched_by_name": get_fullname(d.dispatched_by) if d.dispatched_by else "",
		"received_by_name": get_fullname(d.received_by) if d.received_by else "",
		"received_on": cstr(d.received_on) if d.received_on else None,
		"cancelled_on": cstr(d.cancelled_on) if d.cancelled_on else None,
		"items": [
			{
				**{k: r.get(k) for k in ("name", "item", "item_name", "sku", "unit", "batch", "batch_no", "location", "requisition_line", "transaction")},
				"expiry_date": cstr(r.expiry_date) if r.expiry_date else None,
				"qty": _q(r.qty),
			}
			for r in lines
		],
	}


def _available_by_item(items):
	if not items:
		return {}
	today_d = _today()
	out = {}
	for b in frappe.get_all(BATCH_DT, filters={"item": ("in", list(items)), "qty": (">", 0)}, fields=["item", "qty", "expiry_date"], limit_page_length=0):
		if b.expiry_date and getdate(b.expiry_date) < today_d:
			continue
		out[b.item] = _q(out.get(b.item, 0) + flt(b.qty))
	return out


def serialize_requisition(name, with_stock=False):
	doc = frappe.get_doc(REQ_DT, name)
	avail = _available_by_item({l.item for l in doc.items}) if with_stock else {}
	lines = []
	for l in doc.items:
		row = {
			"name": l.name,
			"item": l.item,
			"item_name": l.item_name,
			"sku": l.sku,
			"unit": l.unit,
			"requested_qty": _q(l.requested_qty),
			"approved_qty": _q(l.approved_qty),
			"dispatched_qty": _q(l.dispatched_qty),
			"pending_qty": _q(max(flt(l.approved_qty) - flt(l.dispatched_qty), 0)),
			"remarks": l.remarks or "",
		}
		if with_stock:
			row["available_qty"] = avail.get(l.item, 0)
		lines.append(row)
	dispatches = [_serialize_dispatch(d) for d in _dispatch_rows_for(requisition=doc.name)]
	return {
		**{k: doc.get(k) for k in ("name", "status", "requester_type", "franchisee", "company_unit", "unit_name", "requested_by", "priority", "delivery_address", "remarks", "approval_status", "reviewed_by", "review_remarks", "prepared_by", "closed_remarks")},
		"requested_by_name": get_fullname(doc.requested_by) if doc.requested_by else "",
		"reviewed_by_name": get_fullname(doc.reviewed_by) if doc.reviewed_by else "",
		"requested_on": cstr(doc.requested_on) if doc.requested_on else None,
		"required_by": cstr(doc.required_by) if doc.required_by else None,
		"reviewed_on": cstr(doc.reviewed_on) if doc.reviewed_on else None,
		"prepared_on": cstr(doc.prepared_on) if doc.prepared_on else None,
		"items": lines,
		"totals": {
			"requested": _q(sum(flt(l["requested_qty"]) for l in lines)),
			"approved": _q(sum(flt(l["approved_qty"]) for l in lines)),
			"dispatched": _q(sum(flt(l["dispatched_qty"]) for l in lines)),
			"pending": _q(sum(flt(l["pending_qty"]) for l in lines)),
		},
		"dispatches": dispatches,
	}


def list_requisitions(filters=None, page=1, page_size=20, franchisee=None, company_units=None):
	f = frappe._dict(filters or {})
	conds = {}
	scope = {}
	if franchisee:
		scope["franchisee"] = franchisee
	if company_units is not None:
		scope["company_unit"] = ("in", sorted(company_units) or [""])
	conds.update(scope)
	if f.status == "open":
		conds["status"] = ("in", OPEN_STATUSES)
	elif f.status:
		conds["status"] = f.status
	if f.requester_type:
		conds["requester_type"] = f.requester_type
	if f.franchisee and not franchisee:
		conds["franchisee"] = f.franchisee
	if f.company_unit and (company_units is None or f.company_unit in company_units):
		conds["company_unit"] = f.company_unit
	if f.date_from and f.date_to:
		conds["requested_on"] = ("between", [f"{getdate(f.date_from)} 00:00:00", f"{getdate(f.date_to)} 23:59:59"])
	elif f.date_from:
		conds["requested_on"] = (">=", f"{getdate(f.date_from)} 00:00:00")
	elif f.date_to:
		conds["requested_on"] = ("<=", f"{getdate(f.date_to)} 23:59:59")
	or_filters = None
	if cstr(f.q).strip():
		needle = f"%{cstr(f.q).strip()}%"
		or_filters = {"name": ("like", needle), "unit_name": ("like", needle), "franchisee": ("like", needle)}
	page_size = max(1, min(cint(page_size) or 20, MAX_EXPORT_ROWS))
	page = max(1, cint(page) or 1)
	names = frappe.get_all(REQ_DT, filters=conds, or_filters=or_filters, pluck="name", order_by="creation desc", limit_page_length=0)
	total = len(names)
	window = names[(page - 1) * page_size : page * page_size]
	rows = []
	if window:
		heads = {
			r.name: r
			for r in frappe.get_all(
				REQ_DT,
				filters={"name": ("in", window)},
				fields=["name", "status", "requester_type", "franchisee", "company_unit", "unit_name", "requested_by", "requested_on", "required_by", "priority", "approval_status", "reviewed_on"],
				limit_page_length=0,
			)
		}
		agg = {}
		for l in frappe.get_all(
			REQ_ITEM_DT,
			filters={"parent": ("in", window), "parenttype": REQ_DT},
			fields=["parent", "requested_qty", "approved_qty", "dispatched_qty"],
			limit_page_length=0,
		):
			a = agg.setdefault(l.parent, {"lines": 0, "requested": 0.0, "approved": 0.0, "dispatched": 0.0})
			a["lines"] += 1
			a["requested"] += flt(l.requested_qty)
			a["approved"] += flt(l.approved_qty)
			a["dispatched"] += flt(l.dispatched_qty)
		for n in window:
			h = heads.get(n)
			if not h:
				continue
			a = agg.get(n) or {"lines": 0, "requested": 0, "approved": 0, "dispatched": 0}
			rows.append(
				{
					**{k: h.get(k) for k in ("name", "status", "requester_type", "franchisee", "company_unit", "unit_name", "priority", "approval_status")},
					"requested_by_name": get_fullname(h.requested_by) if h.requested_by else "",
					"requested_on": cstr(h.requested_on) if h.requested_on else None,
					"required_by": cstr(h.required_by) if h.required_by else None,
					"lines": a["lines"],
					"requested_qty": _q(a["requested"]),
					"approved_qty": _q(a["approved"]),
					"dispatched_qty": _q(a["dispatched"]),
				}
			)
	if franchisee:
		grouped = frappe.db.sql(f"select status, count(*) as n from `tab{REQ_DT}` where franchisee=%s group by status", (franchisee,), as_dict=True)
	else:
		grouped = frappe.db.sql(f"select status, count(*) as n from `tab{REQ_DT}` group by status", as_dict=True)
	counts = {r.status: cint(r.n) for r in grouped}
	if company_units is not None:
		counts = {}
		for s in frappe.get_all(REQ_DT, filters=scope, pluck="status", limit_page_length=0):
			counts[s] = counts.get(s, 0) + 1
	return {"rows": rows, "total": total, "page": page, "page_size": page_size, "status_counts": counts}


def _refresh_requisition_status(doc):
	if doc.status in (S_REJECTED, S_CANCELLED):
		return doc.status
	approved = sum(flt(l.approved_qty) for l in doc.items)
	dispatched = sum(flt(l.dispatched_qty) for l in doc.items)
	if approved <= EPS:
		return doc.status
	if dispatched >= approved - EPS:
		active = [d for d in _dispatch_rows_for(requisition=doc.name) if d.status != D_CANCELLED]
		status = S_RECEIVED if active and all(d.status == D_RECEIVED for d in active) else S_DISPATCHED
	elif dispatched > EPS:
		status = S_PART_DISPATCHED
	elif doc.prepared_on:
		status = S_PREPARING
	else:
		status = doc.approval_status or S_APPROVED
	doc.status = status
	return status


def review_requisition(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can review requisitions"))
	p = frappe._dict(payload or {})
	if not p.name or not frappe.db.exists(REQ_DT, p.name):
		_fail(_("Requisition not found"))
	doc = frappe.get_doc(REQ_DT, p.name, for_update=True)
	if doc.status not in REVIEWABLE or any(flt(l.dispatched_qty) > EPS for l in doc.items):
		_fail(_("Requisition {0} is {1} and can no longer be reviewed").format(doc.name, doc.status))
	decision = cstr(p.decision).lower()
	remarks = cstr(p.remarks).strip()
	if decision == "reject":
		if not remarks:
			_fail(_("Add a reason for rejecting the request"))
		for l in doc.items:
			l.approved_qty = 0
		doc.status = S_REJECTED
		doc.approval_status = S_REJECTED
	elif decision == "approve":
		given = {cstr(x.get("line")): x.get("approved_qty") for x in (p.lines or []) if x and x.get("line")}
		for l in doc.items:
			qty = _q(given[l.name]) if l.name in given and given[l.name] not in (None, "") else _q(l.requested_qty)
			if qty < 0 or qty > flt(l.requested_qty) + EPS:
				_fail(_("{0}: approved qty must be between 0 and the requested {1}").format(l.item_name, _q(l.requested_qty)))
			l.approved_qty = qty
		total = sum(flt(l.approved_qty) for l in doc.items)
		if total <= EPS:
			_fail(_("Nothing approved: reject the request instead"))
		full = all(abs(flt(l.approved_qty) - flt(l.requested_qty)) <= EPS for l in doc.items)
		doc.approval_status = S_APPROVED if full else S_PARTIAL
		doc.status = doc.approval_status
		doc.prepared_on = None
		doc.prepared_by = None
	else:
		_fail(_("Decision must be approve or reject"))
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	doc.review_remarks = remarks or None
	doc.save(ignore_permissions=True)
	_notify(_msgs_reviewed, doc.name)
	return serialize_requisition(doc.name, with_stock=True)


def mark_preparing(name, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can prepare requisitions"))
	if not name or not frappe.db.exists(REQ_DT, name):
		_fail(_("Requisition not found"))
	doc = frappe.get_doc(REQ_DT, name, for_update=True)
	if doc.status not in (S_APPROVED, S_PARTIAL):
		_fail(_("Only approved requisitions can move to Preparing (current: {0})").format(doc.status))
	doc.prepared_by = frappe.session.user
	doc.prepared_on = now_datetime()
	doc.status = S_PREPARING
	doc.save(ignore_permissions=True)
	return serialize_requisition(doc.name, with_stock=True)


def cancel_requisition(name, reason, roles, franchisee=None):
	if not name or not frappe.db.exists(REQ_DT, name):
		_fail(_("Requisition not found"))
	doc = frappe.get_doc(REQ_DT, name, for_update=True)
	manager = _is_manager(roles) and not franchisee
	if franchisee:
		if doc.franchisee != franchisee:
			_deny(_("Not your request"))
		if doc.status != S_SUBMITTED:
			_fail(_("Only requests awaiting approval can be cancelled; contact the lab for {0} requests").format(doc.status))
	elif not manager:
		mine = doc.company_unit and doc.company_unit in {u["name"] for u in _units_for_user(roles)}
		if doc.requested_by != frappe.session.user and not mine:
			_deny(_("Only the requesting unit or the Lab Manager can cancel this request"))
		if doc.status != S_SUBMITTED:
			_fail(_("Only requests awaiting approval can be cancelled"))
	if doc.status in (S_CANCELLED, S_REJECTED, S_DISPATCHED, S_RECEIVED):
		_fail(_("Requisition is already {0}").format(doc.status))
	if any(d.status != D_CANCELLED for d in _dispatch_rows_for(requisition=doc.name)):
		_fail(_("Cancel its dispatches first, or close the remaining quantity instead"))
	doc.status = S_CANCELLED
	doc.closed_remarks = cstr(reason).strip() or None
	doc.save(ignore_permissions=True)
	return serialize_requisition(doc.name, with_stock=manager)


def close_requisition(name, remarks, roles):
	"""Stop waiting for the undispatched remainder of a partially dispatched requisition."""
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can close requisitions"))
	if not name or not frappe.db.exists(REQ_DT, name):
		_fail(_("Requisition not found"))
	doc = frappe.get_doc(REQ_DT, name, for_update=True)
	if doc.status != S_PART_DISPATCHED:
		_fail(_("Only partially dispatched requisitions can be closed short"))
	if not cstr(remarks).strip():
		_fail(_("Add a reason for closing the remaining quantity"))
	for l in doc.items:
		l.approved_qty = _q(l.dispatched_qty)
	doc.approval_status = S_PARTIAL
	doc.closed_remarks = cstr(remarks).strip()
	_refresh_requisition_status(doc)
	doc.save(ignore_permissions=True)
	return serialize_requisition(doc.name, with_stock=True)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def preview_dispatch(payload, roles):
	"""FEFO allocation preview (no stock change). Same validation as create_dispatch."""
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can dispatch material"))
	plan = _plan_dispatch(frappe._dict(payload or {}))
	return {"allocations": [_alloc_row(a) for a in plan["allocations"]], "total_qty": plan["total_qty"]}


def _alloc_row(a):
	b = a["batch"]
	return {
		"item": a["item"],
		"item_name": a["item_name"],
		"unit": a["unit"],
		"batch": b.name,
		"batch_no": b.batch_no,
		"expiry_date": cstr(b.expiry_date) if b.expiry_date else None,
		"location": b.location,
		"qty": a["qty"],
		"requisition_line": a.get("line"),
	}


def _plan_dispatch(p):
	req = None
	wanted = []
	if p.requisition:
		if not frappe.db.exists(REQ_DT, p.requisition):
			_fail(_("Requisition not found"))
		req = frappe.get_doc(REQ_DT, p.requisition, for_update=True)
		if req.status not in DISPATCHABLE:
			_fail(_("Requisition {0} is {1}; approve it before dispatch").format(req.name, req.status))
		by_line = {l.name: l for l in req.items}
		given = [frappe._dict(x) for x in (p.lines or []) if x]
		if not given:
			given = [frappe._dict({"line": l.name, "qty": flt(l.approved_qty) - flt(l.dispatched_qty)}) for l in req.items]
		for g in given:
			line = by_line.get(cstr(g.line))
			if not line:
				_fail(_("Line {0} is not on requisition {1}").format(g.line, req.name))
			qty = _q(g.qty)
			if qty <= EPS:
				continue
			remaining = _q(flt(line.approved_qty) - flt(line.dispatched_qty))
			if qty > remaining + EPS:
				_fail(_("{0}: dispatch qty {1} exceeds the remaining approved qty {2}").format(line.item_name, qty, remaining))
			wanted.append(frappe._dict({"item": line.item, "qty": qty, "batch": g.batch, "line": line.name}))
		dest_type = req.requester_type
		fid, unit, dest_name = req.franchisee, req.company_unit, req.unit_name
	else:
		dest_type = p.destination_type
		fid = p.franchisee if dest_type == REQ_FRANCHISE else None
		unit = p.company_unit if dest_type == REQ_COMPANY else None
		if dest_type == REQ_FRANCHISE:
			if not fid:
				_fail(_("Select the destination franchise unit"))
			dest_name = _franchise_label(fid).franchise_name or fid
		elif dest_type == REQ_COMPANY:
			if not unit or not frappe.db.exists(UNIT_DT, unit):
				_fail(_("Select the destination company unit"))
			dest_name = frappe.db.get_value(UNIT_DT, unit, "unit_name")
		else:
			_fail(_("Select a destination unit"))
		for g in [frappe._dict(x) for x in (p.lines or []) if x]:
			qty = _q(g.qty)
			if not g.item or qty <= EPS:
				continue
			if not frappe.db.exists(ITEM_DT, g.item):
				_fail(_("Unknown item {0}").format(g.item))
			wanted.append(frappe._dict({"item": g.item, "qty": qty, "batch": g.batch, "line": None}))
	if not wanted:
		_fail(_("Nothing to dispatch: enter a quantity for at least one item"))
	location = cstr(p.from_location).strip() or None
	for item in sorted({w.item for w in wanted}):
		_lock_item(item)
	taken = {}
	allocations = []
	today_d = _today()
	for w in wanted:
		meta = frappe.db.get_value(ITEM_DT, w.item, ["item_name", "sku", "unit"], as_dict=True)
		if w.batch:
			b = _lock_batch(w.batch)
			if b.item != w.item:
				_fail(_("Batch {0} does not belong to {1}").format(b.batch_no, meta.item_name))
			if b.expiry_date and getdate(b.expiry_date) < today_d:
				_fail(_("Batch {0} of {1} is expired and cannot be dispatched").format(b.batch_no, meta.item_name))
			free = _q(flt(b.qty) - flt(taken.get(b.name)))
			if w.qty > free + EPS:
				_fail(_("Batch {0} of {1} has only {2} available").format(b.batch_no, meta.item_name, free))
			taken[b.name] = _q(flt(taken.get(b.name)) + w.qty)
			picks = [(b, w.qty)]
		else:
			picks = _fefo_allocate(w.item, w.qty, location, taken)
		for b, qty in picks:
			allocations.append({"item": w.item, "item_name": meta.item_name, "sku": meta.sku, "unit": meta.unit, "batch": b, "qty": qty, "line": w.line})
	return {
		"req": req,
		"destination_type": dest_type,
		"franchisee": fid,
		"company_unit": unit,
		"destination_name": dest_name,
		"from_location": location,
		"allocations": allocations,
		"total_qty": _q(sum(a["qty"] for a in allocations)),
	}


def create_dispatch(payload, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can dispatch material"))
	p = frappe._dict(payload or {})
	if not cstr(p.courier).strip() and cstr(p.logistics_mode) not in ("Hand delivery", "Runner / field staff", "Own vehicle"):
		_fail(_("Enter the courier / logistics partner"))
	dispatch_date = getdate(p.dispatch_date) if p.dispatch_date else _today()
	plan = _plan_dispatch(p)
	doc = frappe.get_doc(
		{
			"doctype": DSP_DT,
			"status": D_DISPATCHED,
			"requisition": plan["req"].name if plan["req"] else None,
			"destination_type": plan["destination_type"],
			"franchisee": plan["franchisee"],
			"company_unit": plan["company_unit"],
			"destination_name": plan["destination_name"],
			"dispatch_date": dispatch_date,
			"logistics_mode": cstr(p.logistics_mode).strip() or None,
			"courier": cstr(p.courier).strip() or None,
			"tracking_no": cstr(p.tracking_no).strip() or None,
			"logistics_details": cstr(p.logistics_details).strip() or None,
			"from_location": plan["from_location"],
			"total_qty": plan["total_qty"],
			"remarks": cstr(p.remarks).strip() or None,
			"dispatched_by": frappe.session.user,
			"items": [
				{
					"item": a["item"],
					"item_name": a["item_name"],
					"sku": a["sku"],
					"unit": a["unit"],
					"batch": a["batch"].name,
					"batch_no": a["batch"].batch_no,
					"expiry_date": a["batch"].expiry_date,
					"location": a["batch"].location,
					"qty": a["qty"],
					"requisition_line": a["line"],
				}
				for a in plan["allocations"]
			],
		}
	)
	doc.insert(ignore_permissions=True)
	for row in doc.items:
		txn = _post(
			row.batch,
			-flt(row.qty),
			TXN_DISPATCH,
			ref_doctype=DSP_DT,
			ref_name=doc.name,
			destination=plan["destination_name"],
			reference_no=doc.tracking_no,
			remarks=_("Requisition {0}").format(doc.requisition) if doc.requisition else None,
		)
		frappe.db.set_value(DSP_ITEM_DT, row.name, "transaction", txn, update_modified=False)
	req = plan["req"]
	if req:
		sent = {}
		for a in plan["allocations"]:
			sent[a["line"]] = _q(flt(sent.get(a["line"])) + a["qty"])
		for l in req.items:
			if l.name in sent:
				l.dispatched_qty = _q(flt(l.dispatched_qty) + sent[l.name])
		_refresh_requisition_status(req)
		req.save(ignore_permissions=True)
	_notify(_msgs_dispatch, doc.name, False)
	return dispatch_detail(doc.name)


def dispatch_detail(name):
	rows = _dispatch_rows_for(names=[name])
	if not rows:
		_fail(_("Dispatch not found"))
	return _serialize_dispatch(rows[0])


def cancel_dispatch(name, reason, roles):
	if not _is_manager(roles):
		_deny(_("Only the Lab Manager can cancel dispatches"))
	if not name or not frappe.db.exists(DSP_DT, name):
		_fail(_("Dispatch not found"))
	if not cstr(reason).strip():
		_fail(_("Add a reason for cancelling the dispatch"))
	doc = frappe.get_doc(DSP_DT, name, for_update=True)
	if doc.status != D_DISPATCHED:
		_fail(_("Only dispatches in transit can be cancelled (this one is {0})").format(doc.status))
	for item in sorted({row.item for row in doc.items}):
		_lock_item(item)
	for row in doc.items:
		_post(
			row.batch,
			flt(row.qty),
			TXN_REVERSAL,
			ref_doctype=DSP_DT,
			ref_name=doc.name,
			destination=doc.destination_name,
			reversal_of=row.transaction,
			reason=_("Dispatch cancelled"),
			remarks=cstr(reason).strip(),
		)
	doc.status = D_CANCELLED
	doc.cancelled_by = frappe.session.user
	doc.cancelled_on = now_datetime()
	doc.cancel_reason = cstr(reason).strip()
	doc.save(ignore_permissions=True)
	if doc.requisition:
		req = frappe.get_doc(REQ_DT, doc.requisition, for_update=True)
		back = {}
		for row in doc.items:
			if row.requisition_line:
				back[row.requisition_line] = _q(flt(back.get(row.requisition_line)) + flt(row.qty))
		for l in req.items:
			if l.name in back:
				l.dispatched_qty = _q(max(flt(l.dispatched_qty) - back[l.name], 0))
		_refresh_requisition_status(req)
		req.save(ignore_permissions=True)
	_notify(_msgs_dispatch, doc.name, True)
	return dispatch_detail(doc.name)


def receive_dispatch(name, remarks, roles, franchisee=None):
	if not name or not frappe.db.exists(DSP_DT, name):
		_fail(_("Dispatch not found"))
	doc = frappe.get_doc(DSP_DT, name, for_update=True)
	if franchisee:
		if doc.franchisee != franchisee:
			_deny(_("This dispatch is not addressed to your unit"))
	elif not _is_manager(roles):
		if doc.destination_type != REQ_COMPANY or doc.company_unit not in {u["name"] for u in _units_for_user(roles)}:
			_deny(_("Only users of the receiving unit can confirm receipt"))
	if doc.status != D_DISPATCHED:
		_fail(_("Dispatch is already {0}").format(doc.status))
	doc.status = D_RECEIVED
	doc.received_by = frappe.session.user
	doc.received_on = now_datetime()
	doc.receipt_remarks = cstr(remarks).strip() or None
	doc.save(ignore_permissions=True)
	post_unit_receipt(doc.name)
	if doc.requisition:
		req = frappe.get_doc(REQ_DT, doc.requisition, for_update=True)
		_refresh_requisition_status(req)
		req.save(ignore_permissions=True)
	return dispatch_detail(doc.name)


def list_dispatches(filters=None, page=1, page_size=20, franchisee=None, company_units=None):
	f = frappe._dict(filters or {})
	conds = {}
	if franchisee:
		conds["franchisee"] = franchisee
	if company_units is not None:
		conds["company_unit"] = ("in", sorted(company_units) or [""])
	if f.status:
		conds["status"] = f.status
	if f.destination_type:
		conds["destination_type"] = f.destination_type
	if f.requisition:
		conds["requisition"] = f.requisition
	if f.date_from and f.date_to:
		conds["dispatch_date"] = ("between", [getdate(f.date_from), getdate(f.date_to)])
	elif f.date_from:
		conds["dispatch_date"] = (">=", getdate(f.date_from))
	elif f.date_to:
		conds["dispatch_date"] = ("<=", getdate(f.date_to))
	or_filters = None
	if cstr(f.q).strip():
		needle = f"%{cstr(f.q).strip()}%"
		or_filters = {"name": ("like", needle), "destination_name": ("like", needle), "tracking_no": ("like", needle), "courier": ("like", needle), "requisition": ("like", needle)}
	page_size = max(1, min(cint(page_size) or 20, MAX_EXPORT_ROWS))
	page = max(1, cint(page) or 1)
	names = frappe.get_all(DSP_DT, filters=conds, or_filters=or_filters, pluck="name", order_by="creation desc", limit_page_length=0)
	window = names[(page - 1) * page_size : page * page_size]
	rows = [_serialize_dispatch(d) for d in _dispatch_rows_for(names=window)] if window else []
	order = {n: i for i, n in enumerate(window)}
	rows.sort(key=lambda r: order.get(r["name"], 0))
	return {"rows": rows, "total": len(names), "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# Reports + export
# ---------------------------------------------------------------------------


def inventory_reports(date_from=None, date_to=None):
	today_d = _today()
	start = getdate(date_from) if date_from else get_first_day(today_d)
	end = getdate(date_to) if date_to else today_d
	vals = {"df": f"{start} 00:00:00", "dt": f"{end} 23:59:59"}
	movement = frappe.db.sql(
		f"""select transaction_type, count(*) as entries,
		coalesce(sum(case when qty_delta > 0 then qty_delta else 0 end), 0) as qty_in,
		coalesce(sum(case when qty_delta < 0 then -qty_delta else 0 end), 0) as qty_out
		from `tab{TXN_DT}` where posting_datetime between %(df)s and %(dt)s group by transaction_type order by transaction_type""",
		vals,
		as_dict=True,
	)
	by_destination = frappe.db.sql(
		f"""select destination_type, destination_name, count(*) as dispatches, coalesce(sum(total_qty), 0) as qty
		from `tab{DSP_DT}` where status != %(cancelled)s and dispatch_date between %(d1)s and %(d2)s
		group by destination_type, destination_name order by qty desc limit 50""",
		{"cancelled": D_CANCELLED, "d1": start, "d2": end},
		as_dict=True,
	)
	top_items = frappe.db.sql(
		f"""select l.item, l.item_name, l.unit, coalesce(sum(l.qty), 0) as qty, count(distinct d.name) as dispatches
		from `tab{DSP_ITEM_DT}` l join `tab{DSP_DT}` d on d.name = l.parent
		where d.status != %(cancelled)s and d.dispatch_date between %(d1)s and %(d2)s
		group by l.item, l.item_name, l.unit order by qty desc limit 15""",
		{"cancelled": D_CANCELLED, "d1": start, "d2": end},
		as_dict=True,
	)
	soon = getdate(add_days(today_d, EXPIRY_WINDOW_DAYS))
	items = {i.name: i for i in frappe.get_all(ITEM_DT, fields=_item_fields(), limit_page_length=0)}
	expiry = []
	for b in frappe.get_all(BATCH_DT, filters={"qty": (">", 0), "expiry_date": ("is", "set")}, fields=["name", "item", "batch_no", "expiry_date", "location", "qty"], order_by="expiry_date asc", limit_page_length=0):
		exp = getdate(b.expiry_date)
		if exp > soon:
			continue
		it = items.get(b.item)
		expiry.append(
			{
				"batch": b.name,
				"item": b.item,
				"item_name": it.item_name if it else b.item,
				"unit": it.unit if it else "",
				"batch_no": b.batch_no,
				"expiry_date": cstr(b.expiry_date),
				"location": b.location,
				"qty": _q(b.qty),
				"days_left": (exp - today_d).days,
				"expired": exp < today_d,
			}
		)
	by_item = _group(_all_batches(), "item")
	low = []
	for it in items.values():
		if not cint(it.active):
			continue
		s = _summarize(it, by_item.get(it.name) or [], today_d)
		if s["available_qty"] <= _q(it.min_stock) + EPS:
			low.append({"item": it.name, "item_name": it.item_name, "sku": it.sku, "unit": it.unit, "available_qty": s["available_qty"], "min_stock": _q(it.min_stock), "status": s["status"], "shortfall": _q(max(flt(it.min_stock) - s["available_qty"], 0))})
	low.sort(key=lambda r: (-r["shortfall"], r["item_name"] or ""))
	req_counts = frappe.db.sql(
		f"select status, count(*) as n from `tab{REQ_DT}` where requested_on between %(df)s and %(dt)s group by status",
		vals,
		as_dict=True,
	)
	return {
		"date_from": cstr(start),
		"date_to": cstr(end),
		"movement": [{"transaction_type": r.transaction_type, "entries": cint(r.entries), "qty_in": _q(r.qty_in), "qty_out": _q(r.qty_out)} for r in movement],
		"by_destination": [{"destination_type": r.destination_type, "destination_name": r.destination_name, "dispatches": cint(r.dispatches), "qty": _q(r.qty)} for r in by_destination],
		"top_items": [{"item": r.item, "item_name": r.item_name, "unit": r.unit, "qty": _q(r.qty), "dispatches": cint(r.dispatches)} for r in top_items],
		"expiry": expiry,
		"low_stock": low,
		"requisitions": {r.status: cint(r.n) for r in req_counts},
	}


def _export_sheet(kind, filters):
	if kind == "items":
		rows = list_items(filters, page=1, page_size=MAX_EXPORT_ROWS)["rows"]
		head = ["Item Name", "SKU / Item Code", "Category", "Unit", "Available Qty", "Min Stock", "Status", "Next Batch (FEFO)", "Next Expiry", "Batches", "Location", "Supplier", "Expired Qty", "Expiring (90d) Qty", "Active"]
		body = [
			[r["item_name"], r["sku"], r["category"], r["unit"], r["available_qty"], r["min_stock"], r["status"], r["next_batch_no"] or "", r["next_expiry"] or "", r["batch_count"], r["location"], r["supplier"], r["expired_qty"], r["expiring_qty"], "Yes" if r["active"] else "No"]
			for r in rows
		]
		return "Inventory", head, body
	if kind == "history":
		rows = list_transactions(filters, page=1, page_size=MAX_EXPORT_ROWS)["rows"]
		head = ["Posted At", "Type", "Item", "SKU", "Batch No.", "Expiry", "Location", "From / To", "Qty", "Unit", "Batch Balance", "Item On-hand", "Reason", "Reference", "Reference No.", "Destination", "User", "Remarks"]
		body = [
			[r["posting_datetime"], r["transaction_type"], r["item_name"], r["sku"], r["batch_no"], r["expiry_date"] or "", r["location"], r["counter_location"] or "", r["qty_delta"], r["unit"], r["balance_after"], r["item_balance_after"], r["reason"] or "", r["reference_name"] or "", r["reference_no"] or "", r["destination"] or "", r["user_name"] or r["user"] or "", r["remarks"] or ""]
			for r in rows
		]
		return "Stock History", head, body
	if kind == "requisitions":
		rows = list_requisitions(filters, page=1, page_size=MAX_EXPORT_ROWS)["rows"]
		head = ["Requisition", "Status", "Unit Type", "Unit", "Requested By", "Requested On", "Required By", "Priority", "Lines", "Requested Qty", "Approved Qty", "Dispatched Qty"]
		body = [
			[r["name"], r["status"], r["requester_type"], r["unit_name"], r["requested_by_name"], r["requested_on"] or "", r["required_by"] or "", r["priority"], r["lines"], r["requested_qty"], r["approved_qty"], r["dispatched_qty"]]
			for r in rows
		]
		return "Requisitions", head, body
	if kind == "dispatches":
		rows = list_dispatches(filters, page=1, page_size=MAX_EXPORT_ROWS)["rows"]
		head = ["Dispatch", "Status", "Dispatch Date", "Destination", "Requisition", "Item", "SKU", "Batch No.", "Expiry", "Qty", "Unit", "Logistics Mode", "Courier", "Tracking / Ref No.", "Received On"]
		body = []
		for d in rows:
			for it in d["items"] or [{}]:
				body.append([d["name"], d["status"], d["dispatch_date"] or "", d["destination_name"], d["requisition"] or "", it.get("item_name", ""), it.get("sku", ""), it.get("batch_no", ""), it.get("expiry_date") or "", it.get("qty", ""), it.get("unit", ""), d["logistics_mode"] or "", d["courier"] or "", d["tracking_no"] or "", d["received_on"] or ""])
		return "Dispatches", head, body
	_fail(_("Unknown export {0}").format(kind))


def export_inventory(kind, fmt="xlsx", filters=None):
	sheet, head, body = _export_sheet(cstr(kind), filters or {})
	stamp = now_datetime().strftime("%Y%m%d-%H%M")
	slug = sheet.lower().replace(" ", "-")
	if cstr(fmt).lower() == "csv":
		buf = io.StringIO()
		writer = csv.writer(buf)
		writer.writerow(head)
		writer.writerows(body)
		return {
			"filename": f"lab-{slug}-{stamp}.csv",
			"mimetype": "text/csv",
			"content_base64": base64.b64encode(("\ufeff" + buf.getvalue()).encode("utf-8")).decode(),
			"rows": len(body),
		}
	from frappe.utils.xlsxutils import make_xlsx

	xlsx = make_xlsx([head] + body, sheet[:31], column_widths=[22] * len(head))
	return {
		"filename": f"lab-{slug}-{stamp}.xlsx",
		"mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"content_base64": base64.b64encode(xlsx.getvalue()).decode(),
		"rows": len(body),
	}


# ---------------------------------------------------------------------------
# Partner (franchise) side
# ---------------------------------------------------------------------------


def requester_catalogue():
	"""Active items with an availability label only: no quantities, batches, suppliers or costs."""
	items = frappe.get_all(ITEM_DT, filters={"active": 1}, fields=_item_fields(), order_by="category asc, item_name asc", limit_page_length=0)
	by_item = _group(_all_batches(), "item")
	catalogue = []
	for it in items:
		s = _summarize(it, by_item.get(it.name) or [])
		availability = "Available" if s["available_qty"] > _q(it.min_stock) + EPS else ("Limited" if s["available_qty"] > EPS else "Out of stock")
		catalogue.append({"name": it.name, "item_name": it.item_name, "sku": it.sku, "category": it.category or "", "unit": it.unit or "", "availability": availability})
	return catalogue


def partner_material_payload(franchisee):
	prof = _franchise_label(franchisee)
	reqs = list_requisitions({}, page=1, page_size=100, franchisee=franchisee)
	details = [serialize_requisition(r["name"]) for r in reqs["rows"][:50]]
	return {
		"franchisee": {"name": franchisee, "franchise_name": prof.franchise_name, "address": prof.address or ""},
		"catalogue": requester_catalogue(),
		"requests": details,
		"status_counts": reqs["status_counts"],
		"in_transit": sum(1 for d in _dispatch_rows_for(franchisee=franchisee) if d.status == D_DISPATCHED),
	}


def requester_payload(roles):
	"""'My Requests' for company-unit staff: units they are listed on, catalogue, their units' requests."""
	units = _units_for_user(roles)
	names = {u["name"] for u in units}
	reqs = list_requisitions({}, page=1, page_size=100, company_units=names)
	return {
		"units": [{"name": u["name"], "unit_name": u["unit_name"], "unit_code": u["unit_code"], "address": u["address"]} for u in units],
		"catalogue": requester_catalogue(),
		"requests": [serialize_requisition(r["name"]) for r in reqs["rows"][:50]],
		"status_counts": reqs["status_counts"],
		"in_transit": sum(1 for d in _dispatch_rows_for(company_units=names) if d.status == D_DISPATCHED) if names else 0,
	}


def scoped_requisition(name, roles):
	_require_req(name)
	scope = _scope_units(roles)
	if scope is not None and frappe.db.get_value(REQ_DT, name, "company_unit") not in scope:
		_deny(_("This requisition belongs to another unit"))
	return serialize_requisition(name, with_stock=scope is None)


# ---------------------------------------------------------------------------
# Notifications (built inside the transaction, delivered after commit)
# ---------------------------------------------------------------------------


def _notify(builder, *args):
	"""Never raises: a notification problem must not roll back stock or workflow changes."""
	if frappe.flags.get(SMOKE_FLAG):
		return
	try:
		messages = builder(*args)
		if messages:
			frappe.enqueue(f"{__name__}.deliver_notifications", queue="short", enqueue_after_commit=True, messages=messages)
	except Exception:
		frappe.log_error(title="lab_inventory_notify", message=frappe.get_traceback())


def deliver_notifications(messages=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp
	except Exception:
		send_whatsapp = None
		frappe.log_error(title="lab_inventory_notify_whatsapp_import", message=frappe.get_traceback())
	for m in messages or []:
		if m.get("emails"):
			try:
				frappe.sendmail(
					recipients=m["emails"],
					subject=m["subject"],
					message=frappe.utils.escape_html(m["text"]).replace("\n", "<br>"),
					now=True,
				)
			except Exception:
				frappe.log_error(title="lab_inventory_notify_email", message=frappe.get_traceback())
		for phone in m.get("phones") or []:
			if not send_whatsapp:
				break
			try:
				send_whatsapp(phone, m["text"], context={"source": "lab_inventory"})
			except Exception:
				frappe.log_error(title="lab_inventory_notify_whatsapp", message=frappe.get_traceback())


def _contacts():
	return {"emails": [], "phones": []}


def _add(c, email=None, phone=None):
	email = cstr(email).strip()
	phone = cstr(phone).strip()
	if email and "@" in email and email not in c["emails"]:
		c["emails"].append(email)
	if phone and phone not in c["phones"]:
		c["phones"].append(phone)


def _add_user(c, uid, with_phone=True):
	if not uid or uid in ("Administrator", "Guest"):
		return
	row = frappe.db.get_value("User", uid, ["email", "mobile_no", "enabled"], as_dict=True)
	if row and cint(row.enabled):
		_add(c, row.email, row.mobile_no if with_phone else None)


def _add_franchise(c, fid):
	row = frappe.db.get_value(PROFILE_DT, fid, ["contact_email", "contact_phone", "linked_user"], as_dict=True) if fid else None
	if row:
		_add(c, row.contact_email, row.contact_phone)
		_add_user(c, row.linked_user, with_phone=False)


def _add_company_unit(c, unit):
	if not unit:
		return
	_add(c, None, frappe.db.get_value(UNIT_DT, unit, "contact_phone"))
	for uid in _unit_users(unit):
		_add_user(c, uid, with_phone=False)


def _summary(rows, qty_field):
	parts = [f"{r.item_name} x {_q(r.get(qty_field)):g} {r.unit or ''}".strip() for r in rows if flt(r.get(qty_field)) > EPS]
	more = f" and {len(parts) - 5} more" if len(parts) > 5 else ""
	return ", ".join(parts[:5]) + more


def _message(c, subject, text):
	return [{**c, "subject": subject, "text": text}] if c["emails"] or c["phones"] else []


def _msgs_new_requisition(name):
	req = frappe.get_doc(REQ_DT, name)
	c = _contacts()
	for uid in frappe.get_all("Has Role", filters={"role": LAB_MANAGER, "parenttype": "User"}, pluck="parent", limit_page_length=0):
		_add_user(c, uid)
	need = f" Needed by {req.required_by}." if req.required_by else ""
	text = (
		f"New material request {req.name} from {req.unit_name} ({req.priority}). "
		f"{len(req.items)} item(s): {_summary(req.items, 'requested_qty')}.{need} Review it in Inventory Management > Material Requisition."
	)
	return _message(c, f"New material request {req.name} - {req.unit_name}", text)


def _requester_contacts(req):
	c = _contacts()
	_add_user(c, req.requested_by)
	if req.requester_type == REQ_FRANCHISE:
		_add_franchise(c, req.franchisee)
	return c


def _msgs_reviewed(name):
	req = frappe.get_doc(REQ_DT, name)
	if req.status == S_REJECTED:
		text = f"Your material request {req.name} was rejected. Reason: {req.review_remarks}"
	else:
		text = f"Your material request {req.name} was {req.status.lower()}. Approved: {_summary(req.items, 'approved_qty')}."
		if req.review_remarks:
			text += f" Note: {req.review_remarks}"
	return _message(_requester_contacts(req), f"Material request {req.name}: {req.status}", text)


def _msgs_dispatch(name, cancelled):
	d = frappe.get_doc(DSP_DT, name)
	req = frappe.get_doc(REQ_DT, d.requisition) if d.requisition else None
	c = _requester_contacts(req) if req else _contacts()
	if not cancelled or not req:
		if d.destination_type == REQ_FRANCHISE:
			_add_franchise(c, d.franchisee)
		else:
			_add_company_unit(c, d.company_unit)
	ref = f" for request {d.requisition}" if d.requisition else ""
	if cancelled:
		text = f"Dispatch {d.name}{ref} to {d.destination_name} was cancelled. Reason: {d.cancel_reason}"
		return _message(c, f"Dispatch {d.name} cancelled", text)
	text = (
		f"Material dispatched{ref}: {d.name} on {d.dispatch_date} to {d.destination_name}. "
		f"Courier: {d.courier or d.logistics_mode or '-'}. Tracking no: {d.tracking_no or '-'}. "
		f"Items: {_summary(d.items, 'qty')}."
	)
	return _message(c, f"Material dispatched: {d.name}", text)


# ---------------------------------------------------------------------------
# Unit-level stock (franchise units in the UI today; the model also takes company units)
# ---------------------------------------------------------------------------

USAGE_REASONS = ("Sample collection", "Patient procedure", "Testing / lab work", "Housekeeping", "Other")


def _holder(holder_type, holder_id):
	if not holder_id:
		_fail(_("Unit not specified"))
	if holder_type == REQ_FRANCHISE:
		return frappe._dict({"holder_type": REQ_FRANCHISE, "franchisee": holder_id, "company_unit": None})
	if holder_type == REQ_COMPANY:
		return frappe._dict({"holder_type": REQ_COMPANY, "franchisee": None, "company_unit": holder_id})
	_fail(_("Unknown unit type"))


def _holder_key(h):
	return "franchisee" if h.holder_type == REQ_FRANCHISE else "company_unit"


def _holder_filters(h):
	key = _holder_key(h)
	return {"holder_type": h.holder_type, key: h[key]}


def _unit_rows(h, item=None):
	filters = _holder_filters(h)
	if item:
		filters["item"] = item
	return frappe.get_all(
		UNIT_STOCK_DT,
		filters=filters,
		fields=["name", "item", "batch_no", "expiry_date", "location", "qty", "creation"],
		order_by="creation asc",
		limit_page_length=0,
	)


def _unit_on_hand(h, item):
	key = _holder_key(h)
	return _q(
		frappe.db.sql(
			f"select coalesce(sum(qty), 0) from `tab{UNIT_STOCK_DT}` where holder_type=%s and `{key}`=%s and item=%s",
			(h.holder_type, h[key], item),
		)[0][0]
	)


def _lock_unit_stock(h, stock):
	"""Lock order matches central stock: item row first, then the unit batch row."""
	item = frappe.db.get_value(UNIT_STOCK_DT, stock, "item")
	if not item:
		_fail(_("Stock batch not found"))
	_lock_item(item)
	row = frappe.db.sql(
		f"select name, item, batch_no, expiry_date, location, qty, holder_type, franchisee, company_unit from `tab{UNIT_STOCK_DT}` where name=%s for update",
		(stock,),
		as_dict=True,
	)[0]
	if row.holder_type != h.holder_type or cstr(row.franchisee) != cstr(h.franchisee) or cstr(row.company_unit) != cstr(h.company_unit):
		_deny(_("This stock belongs to another unit"))
	return row


def _unit_post(h, stock, delta, txn_type, *, reason=None, ref_doctype=None, ref_name=None, remarks=None):
	delta = _q(delta)
	if abs(delta) <= EPS:
		_fail(_("Quantity must be non-zero"))
	row = _lock_unit_stock(h, stock)
	meta = frappe.db.get_value(ITEM_DT, row.item, ["item_name", "sku", "unit"], as_dict=True)
	new_qty = _q(flt(row.qty) + delta)
	if new_qty < -EPS:
		_fail(_("Insufficient stock for {0} batch {1}: on hand {2}, requested {3}").format(meta.item_name, row.batch_no, _q(row.qty), abs(delta)))
	frappe.db.set_value(UNIT_STOCK_DT, row.name, "qty", max(new_qty, 0))
	txn = frappe.get_doc(
		{
			"doctype": UNIT_TXN_DT,
			**_holder_filters(h),
			"posting_datetime": now_datetime(),
			"transaction_type": txn_type,
			"item": row.item,
			"item_name": meta.item_name,
			"sku": meta.sku,
			"unit": meta.unit,
			"stock": row.name,
			"batch_no": row.batch_no,
			"expiry_date": row.expiry_date,
			"location": row.location,
			"qty_delta": delta,
			"balance_after": max(new_qty, 0),
			"item_balance_after": _unit_on_hand(h, row.item),
			"reason": reason,
			"reference_doctype": ref_doctype if ref_name else None,
			"reference_name": ref_name,
			"user": frappe.session.user,
			"remarks": remarks,
		}
	)
	txn.insert(ignore_permissions=True)
	return txn.name


def _unit_get_or_create(h, item, batch_no, expiry_date=None, location=None):
	batch_no = cstr(batch_no).strip() or f"LOT-{_today().strftime('%Y%m%d')}"
	location = cstr(location).strip() or UNIT_STORE
	want = getdate(expiry_date) if expiry_date else None
	for r in frappe.get_all(
		UNIT_STOCK_DT,
		filters={**_holder_filters(h), "item": item, "batch_no": batch_no, "location": location},
		fields=["name", "expiry_date"],
		limit_page_length=0,
	):
		if _date(r.expiry_date) == want:
			return r.name
	doc = frappe.get_doc(
		{"doctype": UNIT_STOCK_DT, **_holder_filters(h), "item": item, "batch_no": batch_no, "expiry_date": want, "location": location, "qty": 0}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def post_unit_receipt(dispatch_name):
	"""Add a received franchise dispatch to the unit's own stock. Idempotent per dispatch."""
	doc = frappe.get_doc(DSP_DT, dispatch_name)
	if doc.status != D_RECEIVED or cint(doc.get("unit_stock_posted")) or doc.destination_type != REQ_FRANCHISE or not doc.franchisee:
		return 0
	h = _holder(REQ_FRANCHISE, doc.franchisee)
	for item in sorted({r.item for r in doc.items}):
		_lock_item(item)
	for row in doc.items:
		stock = _unit_get_or_create(h, row.item, row.batch_no, row.expiry_date)
		_unit_post(h, stock, flt(row.qty), "Receipt", reason=_("Received from central store"), ref_doctype=DSP_DT, ref_name=doc.name)
	frappe.db.set_value(DSP_DT, doc.name, "unit_stock_posted", 1, update_modified=False)
	return len(doc.items)


def _unit_min_map(h):
	return {
		r.item: _q(r.min_stock)
		for r in frappe.get_all(UNIT_SETTING_DT, filters=_holder_filters(h), fields=["item", "min_stock"], limit_page_length=0)
	}


def _unit_summary(it, batches, own_min, today_d):
	min_ = own_min if own_min is not None else _q(it.get("unit_min_stock"))
	eff = frappe._dict({**it, "min_stock": min_, "default_location": UNIT_STORE})
	s = _summarize(eff, batches, today_d)
	return min_, s


def unit_stock_list(h, filters=None, page=1, page_size=10):
	f = frappe._dict(filters or {})
	by_item = _group(_unit_rows(h), "item")
	settings = _unit_min_map(h)
	names = set(by_item) | set(settings)
	items = frappe.get_all(ITEM_DT, filters={"name": ("in", sorted(names) or [""])}, fields=_item_fields(), order_by="item_name asc", limit_page_length=0)
	today_d = _today()
	soon = getdate(add_days(today_d, EXPIRY_WINDOW_DAYS))
	needle = cstr(f.q).strip().lower()
	location = cstr(f.location).strip()
	status = cstr(f.status).strip()
	kpis = {"total_items": 0, "available_stock": 0.0, "low_stock_items": 0, "expiring_soon": 0}
	counts = {}
	categories = set()
	locations = {UNIT_STORE}
	rows = []
	for it in items:
		batches = by_item.get(it.name) or []
		own = settings.get(it.name)
		min_, s = _unit_summary(it, batches, own, today_d)
		kpis["total_items"] += 1
		kpis["available_stock"] += s["available_qty"]
		if s["available_qty"] <= min_ + EPS:
			kpis["low_stock_items"] += 1
		for b in batches:
			if _q(b.qty) > EPS and b.expiry_date and today_d <= getdate(b.expiry_date) <= soon:
				kpis["expiring_soon"] += 1
			locations.add(cstr(b.location) or UNIT_STORE)
		counts[s["status"]] = counts.get(s["status"], 0) + 1
		if it.category:
			categories.add(it.category)
		if needle:
			hay = " ".join([cstr(it.item_name), cstr(it.sku), cstr(it.category), cstr(it.supplier)] + [cstr(b.batch_no) for b in batches]).lower()
			if needle not in hay:
				continue
		if f.category and it.category != f.category:
			continue
		if location and not any(cstr(b.location) == location and _q(b.qty) > EPS for b in batches):
			continue
		if status and s["status"] != status:
			continue
		rows.append(
			{
				"name": it.name,
				"item_name": it.item_name,
				"sku": it.sku,
				"category": it.category or "",
				"unit": it.unit or "",
				"active": cint(it.active),
				"min_stock": min_,
				"own_min": own,
				"default_min": _q(it.get("unit_min_stock")),
				"suggested_qty": _q(max(min_ - s["available_qty"], 0)),
				**s,
			}
		)
	kpis["available_stock"] = _q(kpis["available_stock"])
	page_size = max(1, min(cint(page_size) or 10, 500))
	page = max(1, cint(page) or 1)
	return {
		"rows": rows[(page - 1) * page_size : page * page_size],
		"total": len(rows),
		"page": page,
		"page_size": page_size,
		"kpis": kpis,
		"status_counts": counts,
		"categories": sorted(categories),
		"locations": sorted(locations),
		"usage_reasons": list(USAGE_REASONS),
		"adjust_reasons": list(ADJUST_REASONS),
	}


def unit_item_detail(h, item):
	if not item or not frappe.db.exists(ITEM_DT, item):
		_fail(_("Item not found"))
	it = frappe.db.get_value(ITEM_DT, item, _item_fields(), as_dict=True)
	batches = _unit_rows(h, item)
	min_, s = _unit_summary(it, batches, _unit_min_map(h).get(item), _today())
	today_d = _today()
	return {
		"item": {"name": it.name, "item_name": it.item_name, "sku": it.sku, "category": it.category or "", "unit": it.unit or "", "min_stock": min_, "default_min": _q(it.unit_min_stock), **s},
		"batches": [
			{
				"name": b.name,
				"batch_no": b.batch_no,
				"expiry_date": cstr(b.expiry_date) if b.expiry_date else None,
				"location": b.location or UNIT_STORE,
				"qty": _q(b.qty),
				"expired": bool(b.expiry_date and getdate(b.expiry_date) < today_d),
			}
			for b in sorted(batches, key=_fefo_key)
			if _q(b.qty) > EPS
		],
		"history": unit_transactions(h, {"item": item}, page=1, page_size=25)["rows"],
	}


def unit_usage(h, payload):
	p = frappe._dict(payload or {})
	qty = _q(p.qty)
	if not p.item or not frappe.db.exists(ITEM_DT, p.item):
		_fail(_("Select an item"))
	if qty <= EPS:
		_fail(_("Quantity must be greater than zero"))
	reason = cstr(p.reason).strip() or USAGE_REASONS[0]
	today_d = _today()
	_lock_item(p.item)
	if p.stock:
		row = _lock_unit_stock(h, p.stock)
		if row.item != p.item:
			_fail(_("Batch does not belong to this item"))
		if row.expiry_date and getdate(row.expiry_date) < today_d:
			_fail(_("Batch {0} is expired; record an adjustment (Expired - written off) instead").format(row.batch_no))
		picks = [(row.name, qty)]
	else:
		key = _holder_key(h)
		rows = frappe.db.sql(
			f"""select name, qty from `tab{UNIT_STOCK_DT}`
			where holder_type=%(ht)s and `{key}`=%(hid)s and item=%(item)s and qty > 0
			and (expiry_date is null or expiry_date >= %(today)s)
			order by expiry_date is null, expiry_date asc, creation asc for update""",
			{"ht": h.holder_type, "hid": h[key], "item": p.item, "today": today_d},
			as_dict=True,
		)
		need = qty
		picks = []
		for r in rows:
			take = min(_q(r.qty), need)
			if take > EPS:
				picks.append((r.name, take))
				need = _q(need - take)
			if need <= EPS:
				break
		if need > EPS:
			_fail(_("Only {0} non-expired units on hand; cannot use {1}").format(_q(qty - need), qty))
	for stock, take in picks:
		_unit_post(h, stock, -take, "Usage", reason=reason, remarks=cstr(p.remarks).strip() or None)
	return {"used": qty, "balance": _unit_on_hand(h, p.item), "batches": len(picks)}


def unit_adjust(h, payload):
	p = frappe._dict(payload or {})
	reason = cstr(p.reason).strip()
	if not reason:
		_fail(_("Select a reason for the adjustment"))
	if reason == "Other" and not cstr(p.remarks).strip():
		_fail(_("Add remarks when the reason is Other"))
	if not p.stock:
		# Opening / found stock that never came through a dispatch.
		if not p.item or not frappe.db.exists(ITEM_DT, p.item) or _q(p.qty) <= EPS:
			_fail(_("Select a batch, or an item with a quantity to add"))
		_lock_item(p.item)
		stock = _unit_get_or_create(h, p.item, p.batch_no, p.expiry_date)
		delta = _q(p.qty)
	else:
		stock = p.stock
		row = _lock_unit_stock(h, stock)
		if p.counted_qty not in (None, ""):
			if _q(p.counted_qty) < 0:
				_fail(_("Counted quantity cannot be negative"))
			delta = _q(_q(p.counted_qty) - flt(row.qty))
		else:
			qty = _q(p.qty)
			if qty <= EPS:
				_fail(_("Quantity must be greater than zero"))
			delta = qty if cstr(p.direction) == "increase" else -qty
		if abs(delta) <= EPS:
			_fail(_("No change: counted quantity equals the quantity on hand"))
	txn = _unit_post(h, stock, delta, "Adjustment", reason=reason, remarks=cstr(p.remarks).strip() or None)
	return {"transaction": txn, "delta": delta, "balance": _q(frappe.db.get_value(UNIT_STOCK_DT, stock, "qty"))}


def set_unit_min(h, item, min_stock):
	if not item or not frappe.db.exists(ITEM_DT, item):
		_fail(_("Item not found"))
	existing = frappe.get_all(UNIT_SETTING_DT, filters={**_holder_filters(h), "item": item}, pluck="name")
	if min_stock in (None, ""):
		for n in existing:
			frappe.db.delete(UNIT_SETTING_DT, {"name": n})
		return {"item": item, "min_stock": None}
	value = _q(min_stock)
	if value < 0:
		_fail(_("Minimum cannot be negative"))
	if existing:
		frappe.db.set_value(UNIT_SETTING_DT, existing[0], "min_stock", value)
	else:
		frappe.get_doc({"doctype": UNIT_SETTING_DT, **_holder_filters(h), "item": item, "min_stock": value}).insert(ignore_permissions=True)
	return {"item": item, "min_stock": value}


def unit_transactions(h, filters=None, page=1, page_size=20):
	f = frappe._dict(filters or {})
	key = _holder_key(h)
	conds = ["holder_type=%(ht)s", f"`{key}`=%(hid)s"]
	vals = {"ht": h.holder_type, "hid": h[key]}
	if f.transaction_type:
		conds.append("transaction_type=%(type)s")
		vals["type"] = f.transaction_type
	if f.item:
		conds.append("item=%(item)s")
		vals["item"] = f.item
	if f.date_from:
		conds.append("posting_datetime >= %(df)s")
		vals["df"] = f"{getdate(f.date_from)} 00:00:00"
	if f.date_to:
		conds.append("posting_datetime <= %(dt)s")
		vals["dt"] = f"{getdate(f.date_to)} 23:59:59"
	if cstr(f.q).strip():
		conds.append("(item_name like %(q)s or sku like %(q)s or batch_no like %(q)s or reference_name like %(q)s or reason like %(q)s)")
		vals["q"] = f"%{cstr(f.q).strip()}%"
	where = " and ".join(conds)
	page_size = max(1, min(cint(page_size) or 20, 500))
	page = max(1, cint(page) or 1)
	total = cint(frappe.db.sql(f"select count(*) from `tab{UNIT_TXN_DT}` where {where}", vals)[0][0])
	rows = frappe.db.sql(
		f"""select name, posting_datetime, transaction_type, item, item_name, sku, unit, batch_no, expiry_date, location,
		qty_delta, balance_after, item_balance_after, reason, reference_doctype, reference_name, user, remarks
		from `tab{UNIT_TXN_DT}` where {where} order by posting_datetime desc, creation desc limit %(limit)s offset %(offset)s""",
		{**vals, "limit": page_size, "offset": (page - 1) * page_size},
		as_dict=True,
	)
	return {
		"rows": [
			{
				**{k: r.get(k) for k in ("name", "transaction_type", "item", "item_name", "sku", "unit", "batch_no", "location", "reason", "reference_doctype", "reference_name", "user", "remarks")},
				"posting_datetime": cstr(r.posting_datetime),
				"expiry_date": cstr(r.expiry_date) if r.expiry_date else None,
				"qty_delta": _q(r.qty_delta),
				"balance_after": _q(r.balance_after),
				"item_balance_after": _q(r.item_balance_after),
				"user_name": get_fullname(r.user) if r.user else "",
			}
			for r in rows
		],
		"total": total,
		"page": page,
		"page_size": page_size,
	}


def stock_holding_units():
	"""Franchise units that hold unit stock or have set minimums (Lab Manager read-only view)."""
	held = frappe.db.sql(
		f"""select franchisee, count(distinct item) as items, coalesce(sum(qty), 0) as qty
		from `tab{UNIT_STOCK_DT}` where holder_type=%s and ifnull(franchisee, '') != '' group by franchisee""",
		(REQ_FRANCHISE,),
		as_dict=True,
	)
	by = {r.franchisee: r for r in held}
	for fid in frappe.get_all(UNIT_SETTING_DT, filters={"holder_type": REQ_FRANCHISE}, pluck="franchisee", limit_page_length=0):
		if fid and fid not in by:
			by[fid] = frappe._dict({"franchisee": fid, "items": 0, "qty": 0})
	names = {r.name: r.franchise_name for r in frappe.get_all(PROFILE_DT, filters={"name": ("in", list(by) or [""])}, fields=["name", "franchise_name"], limit_page_length=0)}
	return {
		"units": sorted(
			[{"franchisee": fid, "label": f"{names.get(fid) or fid} ({fid})", "items": cint(r["items"]), "qty": _q(r["qty"])} for fid, r in by.items()],
			key=lambda u: u["label"].lower(),
		)
	}


# ---------------------------------------------------------------------------
# Whitelisted endpoints (SPA: lab portal + /b2b partner portal)
# ---------------------------------------------------------------------------


def _parse(value, default=None):
	if value in (None, ""):
		return default if default is not None else {}
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		_fail(_("Invalid request payload"))


def _ensure_ready():
	if not frappe.db.exists("DocType", UNIT_SETTING_DT):
		ensure_lab_inventory_setup()
		frappe.db.commit()


def access_denied(access, roles):
	"""'manage' = Lab Manager / admins; 'view' = lab staff; 'request' = lab staff or Material Requester (scoped)."""
	roles = set(roles or [])
	if access == "manage" and not roles & MANAGE_ROLES:
		return _("Lab Manager access required")
	if access == "view" and not roles & VIEW_ROLES:
		return _("Lab staff access required")
	if access == "request" and not roles & REQUEST_ROLES:
		return _("Material Requester or lab staff access required")
	if access not in ("manage", "view", "request"):
		return _("Not permitted")
	return None


def _call(sid, access, fn, message="OK", commit=False):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	roles = set(frappe.get_roles(frappe.session.user))
	try:
		if access == "partner":
			from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user

			fid = resolve_franchisee_for_user(frappe.session.user)
			if not fid:
				return _error(_("Franchisee operator access required"), 403)
			_ensure_ready()
			data = fn(roles, fid)
		else:
			denied = access_denied(access, roles)
			if denied:
				return _error(denied, 403)
			_ensure_ready()
			data = fn(roles)
		if commit:
			frappe.db.commit()
		return _success(data, message=message)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


@frappe.whitelist(allow_guest=True)
def get_inventory_dashboard(sid=None):
	return _call(sid, "view", inventory_dashboard)


@frappe.whitelist(allow_guest=True)
def list_inventory_items(filters=None, page=1, page_size=10, sid=None):
	return _call(sid, "view", lambda roles: list_items(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True)
def get_inventory_item(item=None, sid=None):
	return _call(sid, "view", lambda roles: item_detail(item))


@frappe.whitelist(allow_guest=True)
def save_inventory_item(item=None, sid=None):
	return _call(sid, "manage", lambda roles: save_item(_parse(item), roles), _("Item saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def inventory_stock_in(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: stock_in(_parse(payload), roles), _("Stock received"), commit=True)


@frappe.whitelist(allow_guest=True)
def inventory_adjust_stock(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: adjust_stock(_parse(payload), roles), _("Stock adjusted"), commit=True)


@frappe.whitelist(allow_guest=True)
def inventory_transfer_stock(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: transfer_stock(_parse(payload), roles), _("Stock transferred"), commit=True)


@frappe.whitelist(allow_guest=True)
def list_inventory_transactions(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "view", lambda roles: list_transactions(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True)
def list_inventory_company_units(include_inactive=0, sid=None):
	return _call(sid, "request", lambda roles: list_company_units(roles, include_inactive))


@frappe.whitelist(allow_guest=True)
def save_inventory_company_unit(unit=None, sid=None):
	return _call(sid, "manage", lambda roles: save_company_unit(_parse(unit), roles), _("Unit saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def list_inventory_franchise_units(q=None, sid=None):
	return _call(sid, "manage", lambda roles: list_franchise_units(q))


@frappe.whitelist(allow_guest=True)
def list_material_requisitions(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "request", lambda roles: list_requisitions(_parse(filters), page, page_size, company_units=_scope_units(roles)))


@frappe.whitelist(allow_guest=True)
def get_material_requisition(name=None, sid=None):
	return _call(sid, "request", lambda roles: scoped_requisition(name, roles))


@frappe.whitelist(allow_guest=True)
def get_my_material_requests(sid=None):
	return _call(sid, "request", requester_payload)


def _require_req(name):
	if not name or not frappe.db.exists(REQ_DT, name):
		_fail(_("Requisition not found"))
	return name


@frappe.whitelist(allow_guest=True)
def create_material_requisition(payload=None, sid=None):
	return _call(sid, "request", lambda roles: create_requisition(_parse(payload), roles), _("Request submitted"), commit=True)


@frappe.whitelist(allow_guest=True)
def review_material_requisition(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: review_requisition(_parse(payload), roles), _("Requisition reviewed"), commit=True)


@frappe.whitelist(allow_guest=True)
def prepare_material_requisition(name=None, sid=None):
	return _call(sid, "manage", lambda roles: mark_preparing(name, roles), _("Marked as preparing"), commit=True)


@frappe.whitelist(allow_guest=True)
def cancel_material_requisition(name=None, reason=None, sid=None):
	return _call(sid, "request", lambda roles: cancel_requisition(name, reason, roles), _("Requisition cancelled"), commit=True)


@frappe.whitelist(allow_guest=True)
def close_material_requisition(name=None, remarks=None, sid=None):
	return _call(sid, "manage", lambda roles: close_requisition(name, remarks, roles), _("Requisition closed"), commit=True)


@frappe.whitelist(allow_guest=True)
def preview_material_dispatch(payload=None, sid=None):
	def run(roles):
		try:
			return preview_dispatch(_parse(payload), roles)
		finally:
			frappe.db.rollback()

	return _call(sid, "manage", run)


@frappe.whitelist(allow_guest=True)
def create_material_dispatch(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: create_dispatch(_parse(payload), roles), _("Material dispatched"), commit=True)


@frappe.whitelist(allow_guest=True)
def cancel_material_dispatch(name=None, reason=None, sid=None):
	return _call(sid, "manage", lambda roles: cancel_dispatch(name, reason, roles), _("Dispatch cancelled and stock restored"), commit=True)


@frappe.whitelist(allow_guest=True)
def receive_material_dispatch(name=None, remarks=None, sid=None):
	return _call(sid, "request", lambda roles: receive_dispatch(name, remarks, roles), _("Receipt confirmed"), commit=True)


@frappe.whitelist(allow_guest=True)
def list_material_dispatches(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "request", lambda roles: list_dispatches(_parse(filters), page, page_size, company_units=_scope_units(roles)))


@frappe.whitelist(allow_guest=True)
def get_inventory_reports(date_from=None, date_to=None, sid=None):
	return _call(sid, "view", lambda roles: inventory_reports(date_from, date_to))


@frappe.whitelist(allow_guest=True)
def export_lab_inventory(kind="items", fmt="xlsx", filters=None, sid=None):
	return _call(sid, "view", lambda roles: export_inventory(kind, fmt, _parse(filters)))


@frappe.whitelist(allow_guest=True)
def get_partner_material_requests(sid=None):
	return _call(sid, "partner", lambda roles, fid: partner_material_payload(fid))


@frappe.whitelist(allow_guest=True)
def create_partner_material_request(payload=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: create_requisition(_parse(payload), roles, franchisee=fid), _("Request submitted"), commit=True)


@frappe.whitelist(allow_guest=True)
def cancel_partner_material_request(name=None, reason=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: cancel_requisition(name, reason, roles, franchisee=fid), _("Request cancelled"), commit=True)


@frappe.whitelist(allow_guest=True)
def receive_partner_material_dispatch(name=None, remarks=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: receive_dispatch(name, remarks, roles, franchisee=fid), _("Receipt confirmed and added to your stock"), commit=True)


def _fh(fid):
	return _holder(REQ_FRANCHISE, fid)


@frappe.whitelist(allow_guest=True)
def get_partner_unit_stock(filters=None, page=1, page_size=10, sid=None):
	return _call(sid, "partner", lambda roles, fid: unit_stock_list(_fh(fid), _parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True)
def get_partner_unit_item(item=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: unit_item_detail(_fh(fid), item))


@frappe.whitelist(allow_guest=True)
def record_partner_unit_usage(payload=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: unit_usage(_fh(fid), _parse(payload)), _("Usage recorded"), commit=True)


@frappe.whitelist(allow_guest=True)
def adjust_partner_unit_stock(payload=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: unit_adjust(_fh(fid), _parse(payload)), _("Stock adjusted"), commit=True)


@frappe.whitelist(allow_guest=True)
def set_partner_unit_min_stock(item=None, min_stock=None, sid=None):
	return _call(sid, "partner", lambda roles, fid: set_unit_min(_fh(fid), item, min_stock), _("Minimum saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def list_partner_unit_transactions(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "partner", lambda roles, fid: unit_transactions(_fh(fid), _parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True)
def list_inventory_stock_units(sid=None):
	return _call(sid, "manage", lambda roles: stock_holding_units())


@frappe.whitelist(allow_guest=True)
def get_inventory_unit_stock(franchisee=None, filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "manage", lambda roles: unit_stock_list(_fh(franchisee), _parse(filters), page, page_size))


# ---------------------------------------------------------------------------
# Smoke (throwaway data, rolled back)
# ---------------------------------------------------------------------------

SMOKE_PREFIX = "P131-SMOKE"


def smoke_lab_inventory():
	"""Item, stock in, adjustment, transfer, requisition, partial approval, FEFO dispatch, reversal, KPIs,
	negative-stock refusal. Everything is rolled back; returns {checks, passed, total, ok}."""
	setup = setup_phase131()
	out = {"ok": True, "checks": [], "setup": setup.get("created")}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:200]})
		if not cond:
			out["ok"] = False

	def refused(fn):
		try:
			fn()
		except (frappe.ValidationError, frappe.PermissionError) as exc:
			return cstr(exc) or "refused"
		return None

	roles = {"System Manager", LAB_MANAGER}
	tag = frappe.generate_hash(length=6).upper()
	today_d = _today()
	setattr(frappe.flags, SMOKE_FLAG, True)
	try:
		kpi0 = inventory_kpis()
		detail = save_item(
			{"item_name": f"Smoke Vacutainer {tag}", "sku": f"{SMOKE_PREFIX}-{tag}", "category": "Lab Consumables", "unit": "Pcs", "min_stock": 5, "default_location": "Main Store"},
			roles,
		)
		item = detail["item"]["name"]
		check("item created, out of stock", detail["item"]["status"] == "Out of Stock", detail["item"]["status"])
		stock_in(
			{
				"lines": [
					{"item": item, "batch_no": "B-SOON", "expiry_date": add_days(today_d, 30), "location": "Main Store", "qty": 10},
					{"item": item, "batch_no": "B-LATE", "expiry_date": add_days(today_d, 200), "location": "Main Store", "qty": 10},
					{"item": item, "batch_no": "B-OLD", "expiry_date": add_days(today_d, 5), "location": "Main Store", "qty": 5},
				],
				"reference_no": f"GRN-{tag}",
			},
			roles,
		)
		b_soon = frappe.db.get_value(BATCH_DT, {"item": item, "batch_no": "B-SOON"}, "name")
		b_late = frappe.db.get_value(BATCH_DT, {"item": item, "batch_no": "B-LATE"}, "name")
		b_old = frappe.db.get_value(BATCH_DT, {"item": item, "batch_no": "B-OLD"}, "name")
		frappe.db.set_value(BATCH_DT, b_old, "expiry_date", add_days(today_d, -1))
		s = item_detail(item)["item"]
		check("stock in: 20 available, 5 expired excluded", s["available_qty"] == 20 and s["expired_qty"] == 5, s)
		check("status Expiring Soon (batch within 90 days)", s["status"] == "Expiring Soon", s["status"])
		check(
			"expired stock-in refused",
			refused(lambda: stock_in({"lines": [{"item": item, "batch_no": "X", "expiry_date": add_days(today_d, -3), "qty": 1}]}, roles)),
		)

		adjust_stock({"batch": b_soon, "direction": "decrease", "qty": 2, "reason": "Damaged / broken"}, roles)
		last = list_transactions({"item": item}, page=1, page_size=1)["rows"][0]
		check("adjustment ledger row", last["transaction_type"] == TXN_ADJUST and last["qty_delta"] == -2 and last["balance_after"] == 8, last)
		check("negative stock refused", refused(lambda: adjust_stock({"batch": b_soon, "direction": "decrease", "qty": 100, "reason": "Lost / missing"}, roles)))
		check("batch qty unchanged after refusal", _q(frappe.db.get_value(BATCH_DT, b_soon, "qty")) == 8)

		xfer = transfer_stock({"batch": b_late, "qty": 3, "to_location": f"Smoke Store {tag}"}, roles)
		check(
			"transfer moves qty between locations",
			_q(frappe.db.get_value(BATCH_DT, b_late, "qty")) == 7 and _q(frappe.db.get_value(BATCH_DT, xfer["to_batch"], "qty")) == 3,
		)

		unit = save_company_unit({"unit_name": f"Smoke Unit {tag}", "unit_code": f"{SMOKE_PREFIX}-{tag}", "unit_type": "Collection Centre"}, roles)
		req = create_requisition({"requester_type": REQ_COMPANY, "company_unit": unit["name"], "lines": [{"item": item, "qty": 15}]}, roles)
		check("requisition submitted", req["status"] == S_SUBMITTED, req["status"])
		line = req["items"][0]["name"]
		check(
			"approve above requested refused",
			refused(lambda: review_requisition({"name": req["name"], "decision": "approve", "lines": [{"line": line, "approved_qty": 16}]}, roles)),
		)
		req = review_requisition({"name": req["name"], "decision": "approve", "lines": [{"line": line, "approved_qty": 12}]}, roles)
		check("partial approval", req["status"] == S_PARTIAL and req["items"][0]["approved_qty"] == 12, req["status"])
		req = mark_preparing(req["name"], roles)
		check("preparing", req["status"] == S_PREPARING, req["status"])

		dsp = create_dispatch({"requisition": req["name"], "lines": [{"line": line, "qty": 12}], "courier": "Smoke Courier", "tracking_no": f"TRK-{tag}"}, roles)
		used = {i["batch"]: i["qty"] for i in dsp["items"]}
		check("FEFO: earliest batch first, expired never", used.get(b_soon) == 8 and b_old not in used and _q(sum(used.values())) == 12, used)
		check("dispatch deducted stock", _q(frappe.db.get_value(BATCH_DT, b_soon, "qty")) == 0 and _q(frappe.db.get_value(BATCH_DT, b_old, "qty")) == 5)
		req = serialize_requisition(req["name"])
		check("requisition dispatched", req["status"] == S_DISPATCHED and req["items"][0]["dispatched_qty"] == 12, req["status"])
		check("over-dispatch refused", refused(lambda: create_dispatch({"requisition": req["name"], "lines": [{"line": line, "qty": 1}], "courier": "X"}, roles)))
		ledger_before = frappe.db.count(TXN_DT, {"item": item})

		cancel_dispatch(dsp["name"], "Smoke reversal", roles)
		check("reversal restores stock", _q(frappe.db.get_value(BATCH_DT, b_soon, "qty")) == 8, frappe.db.get_value(BATCH_DT, b_soon, "qty"))
		check("reversal appends ledger rows (history kept)", frappe.db.count(TXN_DT, {"item": item}) == ledger_before + len(dsp["items"]))
		req = serialize_requisition(req["name"])
		check("requisition back to preparing after reversal", req["status"] == S_PREPARING and req["items"][0]["dispatched_qty"] == 0, req["status"])

		dsp2 = create_dispatch({"requisition": req["name"], "lines": [{"line": line, "qty": 5}], "courier": "Smoke Courier"}, roles)
		check("partial dispatch", serialize_requisition(req["name"])["status"] == S_PART_DISPATCHED)
		receive_dispatch(dsp2["name"], "ok", roles)
		closed = close_requisition(req["name"], "Rest not needed", roles)
		check("close short -> received", closed["status"] == S_RECEIVED, closed["status"])

		req_roles = {MATERIAL_REQUESTER}
		other_unit = unit["name"]
		unit_a = save_company_unit(
			{"unit_name": f"Smoke Requester Unit {tag}", "unit_code": f"{SMOKE_PREFIX}-{tag}-A", "users": [frappe.session.user]}, roles
		)
		check("requester refused KPIs / items / history / reports / exports", access_denied("view", req_roles) and access_denied("manage", req_roles))
		check("requester allowed request endpoints", not access_denied("request", req_roles))
		mine = create_requisition({"requester_type": REQ_COMPANY, "company_unit": unit_a["name"], "lines": [{"item": item, "qty": 2}]}, req_roles)
		check("requester can request for own unit", mine["status"] == S_SUBMITTED and "available_qty" not in mine["items"][0], mine["status"])
		check(
			"requester cannot request for another unit",
			refused(lambda: create_requisition({"requester_type": REQ_COMPANY, "company_unit": other_unit, "lines": [{"item": item, "qty": 1}]}, req_roles)),
		)
		check(
			"requester cannot request for a franchise",
			refused(lambda: create_requisition({"requester_type": REQ_FRANCHISE, "franchisee": "X", "lines": [{"item": item, "qty": 1}]}, req_roles)),
		)
		scope = _scope_units(req_roles)
		listed = list_requisitions({}, 1, 500, company_units=scope)
		listed_names = {r["name"] for r in listed["rows"]}
		check(
			"requester list shows only own units",
			mine["name"] in listed_names and req["name"] not in listed_names and other_unit not in scope and all(r["company_unit"] in scope for r in listed["rows"]),
			listed["total"],
		)
		check("requester cannot open another unit's requisition", refused(lambda: scoped_requisition(req["name"], req_roles)))
		check("requester can open own requisition", scoped_requisition(mine["name"], req_roles)["name"] == mine["name"])
		check("requester dispatch list scoped", all(d["company_unit"] in scope for d in list_dispatches({}, 1, 500, company_units=scope)["rows"]))
		cat_row = next((c for c in requester_catalogue() if c["name"] == item), None)
		check(
			"requester catalogue hides quantities / batches / suppliers",
			cat_row and set(cat_row) == {"name", "item_name", "sku", "category", "unit", "availability"},
			cat_row,
		)
		check("lab technician / pathologist unscoped (read-only)", _scope_units({"Lab Technician"}) is None and _scope_units({"Pathologist", MATERIAL_REQUESTER}) is None)
		check(
			"notification builders run (delivery skipped in smoke)",
			isinstance(_msgs_new_requisition(mine["name"]), list) and isinstance(_msgs_dispatch(dsp2["name"], False), list) and isinstance(_msgs_reviewed(req["name"]), list),
		)
		cancel_requisition(mine["name"], "smoke", req_roles)
		check("requester can cancel own unit's submitted request", frappe.db.get_value(REQ_DT, mine["name"], "status") == S_CANCELLED)

		kpi1 = inventory_kpis()
		check("KPI total items +1", kpi1["total_items"] == kpi0["total_items"] + 1, (kpi0["total_items"], kpi1["total_items"]))
		check("KPI available stock +13 (20 in - 2 damaged - 5 dispatched)", abs(kpi1["available_stock"] - kpi0["available_stock"] - 13) < 0.01, (kpi0["available_stock"], kpi1["available_stock"]))
		check("KPI expiring soon counts smoke batch", kpi1["expiring_soon"] >= kpi0["expiring_soon"] + 1)
		check("KPI dispatched this month counts live dispatch", kpi1["dispatched_this_month"] == kpi0["dispatched_this_month"] + 1)
		xl = export_inventory("history", "xlsx", {"item": item})
		check("history Excel export", xl["filename"].endswith(".xlsx") and xl["rows"] >= ledger_before)
		check("items CSV export", export_inventory("items", "csv", {"q": tag})["rows"] == 1)

		fid = frappe.db.get_value(PROFILE_DT, {"active_status": "Active"}, "name")
		check("unit stock: an active franchise exists for the test", bool(fid))
		if fid:
			fh = _holder(REQ_FRANCHISE, fid)
			frappe.db.set_value(ITEM_DT, item, "unit_min_stock", 4)
			fd = create_dispatch(
				{"destination_type": REQ_FRANCHISE, "franchisee": fid, "lines": [{"item": item, "qty": 3}], "courier": "Smoke Courier"}, roles
			)
			check("unit stock untouched while in transit", _unit_on_hand(fh, item) == 0)
			receive_dispatch(fd["name"], "ok", set(), franchisee=fid)
			check("partner receipt adds dispatched qty to unit stock", _unit_on_hand(fh, item) == 3, _unit_on_hand(fh, item))
			check("unit receipt idempotent", post_unit_receipt(fd["name"]) == 0 and _unit_on_hand(fh, item) == 3)
			urow = next((r for r in unit_stock_list(fh, {"q": tag})["rows"] if r["name"] == item), None)
			check("default unit min (4) drives Low Stock", urow and urow["status"] == "Low Stock" and urow["suggested_qty"] == 1, urow and urow["status"])
			set_unit_min(fh, item, 2)
			urow = next((r for r in unit_stock_list(fh, {"q": tag})["rows"] if r["name"] == item), None)
			check("partner min override (2) clears Low Stock", urow and urow["min_stock"] == 2 and urow["status"] != "Low Stock", urow and urow["status"])
			unit_usage(fh, {"item": item, "qty": 2, "reason": "Sample collection"})
			check("usage FEFO deducts", _unit_on_hand(fh, item) == 1)
			check("usage beyond stock refused", refused(lambda: unit_usage(fh, {"item": item, "qty": 5})))
			stock_rows = _unit_rows(fh, item)
			unit_adjust(fh, {"stock": stock_rows[0].name, "counted_qty": 0, "reason": "Physical count correction"})
			urow = next((r for r in unit_stock_list(fh, {"q": tag})["rows"] if r["name"] == item), None)
			check("count to zero -> Out of Stock, still listed (has min)", urow and urow["status"] == "Out of Stock", urow and urow["status"])
			ledger = unit_transactions(fh, {"item": item})
			check("unit ledger: receipt + usage + adjustment", {r["transaction_type"] for r in ledger["rows"]} >= {"Receipt", "Usage", "Adjustment"}, ledger["total"])
			oh = _holder(REQ_COMPANY, unit["name"])
			other_stock = _unit_get_or_create(oh, item, "OTHER-UNIT")
			_unit_post(oh, other_stock, 5, "Adjustment", reason="Found / excess")
			check("other unit's stock not visible to partner", _unit_on_hand(fh, item) == 0 and all(r["name"] != other_stock for r in unit_item_detail(fh, item)["batches"]))
			check("partner cannot use another unit's batch", refused(lambda: unit_usage(fh, {"item": item, "qty": 1, "stock": other_stock})))
			check("manager overview lists the franchise", any(u["franchisee"] == fid for u in stock_holding_units()["units"]))
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
	finally:
		setattr(frappe.flags, SMOKE_FLAG, False)
		frappe.db.rollback()
		out["cleanup"] = _cleanup_smoke()
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _cleanup_smoke():
	"""Backstop if anything survived the rollback (e.g. an inner commit)."""
	items = frappe.get_all(ITEM_DT, filters={"sku": ("like", f"{SMOKE_PREFIX}-%")}, pluck="name")
	units = frappe.get_all(UNIT_DT, filters={"unit_code": ("like", f"{SMOKE_PREFIX}-%")}, pluck="name")
	if not items and not units:
		return "clean"
	reqs = frappe.get_all(REQ_DT, filters={"company_unit": ("in", units or [""])}, pluck="name")
	dsps = set(frappe.get_all(DSP_DT, filters={"company_unit": ("in", units or [""])}, pluck="name"))
	dsps |= set(frappe.get_all(DSP_ITEM_DT, filters={"item": ("in", items or [""]), "parenttype": DSP_DT}, pluck="parent"))
	for n in items:
		for dt in (UNIT_TXN_DT, UNIT_STOCK_DT, UNIT_SETTING_DT):
			frappe.db.delete(dt, {"item": n})
	for parent_dt, child_dt, names in ((DSP_DT, DSP_ITEM_DT, dsps), (REQ_DT, REQ_ITEM_DT, reqs), (UNIT_DT, UNIT_USER_DT, units)):
		for n in names:
			frappe.db.delete(child_dt, {"parent": n, "parenttype": parent_dt})
			frappe.db.delete(parent_dt, {"name": n})
	for n in items:
		frappe.db.delete(TXN_DT, {"item": n})
		frappe.db.delete(BATCH_DT, {"item": n})
		frappe.db.delete(ITEM_DT, {"name": n})
	frappe.db.commit()
	return f"removed {len(items)} items, {len(units)} units"
