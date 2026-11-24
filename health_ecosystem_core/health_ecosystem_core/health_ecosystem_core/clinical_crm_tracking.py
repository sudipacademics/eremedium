"""CRM booking tracking tags → sales close attribution from Care / Aesthetic / lab bills."""

from __future__ import annotations

import json
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

CRM_SALE_DT = "CRM Sales Close"
TAG_RE = re.compile(r"(?:\[CRM_TAG:)?(CRM-[A-Z0-9]{2,6}-[A-Z0-9-]{3,24})\]?", re.I)


def extract_crm_tag(*texts):
	for text in texts:
		m = TAG_RE.search(cstr(text or ""))
		if m:
			return m.group(1).upper()
	return ""


def ensure_crm_sales_close_doctype():
	if frappe.db.exists("DocType", CRM_SALE_DT):
		return
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def

		ensure_hec_module_def()
	except Exception:
		try:
			from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

			ensure_module_def()
		except Exception:
			pass
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_SALE_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"editable_grid": 0,
			"track_changes": 1,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:CSC-{#####}",
			"fields": [
				{"fieldname": "tracking_tag", "label": "Tracking Tag", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "booking_id", "label": "CRM Booking", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "executive", "label": "CRM Executive", "fieldtype": "Data", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "executive_code", "label": "Executive Code", "fieldtype": "Data"},
				{"fieldname": "amount", "label": "Billed Amount", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "bill_ref", "label": "Bill / Invoice", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "portal", "label": "Portal", "fieldtype": "Select", "options": "\ncare\naesthetic\nlab\nfranchise\ncrm", "in_standard_filter": 1},
				{"fieldname": "patient_name", "label": "Patient", "fieldtype": "Data"},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "closed_at", "label": "Closed At", "fieldtype": "Datetime"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1, "write": 1, "create": 1},
				{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
				{"role": "Care Staff", "read": 1, "create": 1},
				{"role": "Care Manager", "read": 1, "create": 1},
				{"role": "Aesthetic Staff", "read": 1, "create": 1},
				{"role": "Aesthetic Manager", "read": 1, "create": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def record_crm_sales_close(data=None, **kwargs):
	"""Upsert a sales-close row keyed by tracking_tag + bill_ref (from portal bill generation)."""
	ensure_crm_sales_close_doctype()
	payload = data if isinstance(data, dict) else {}
	if isinstance(data, str) and data.strip():
		try:
			parsed = json.loads(data)
			if isinstance(parsed, dict):
				payload = parsed
		except Exception:
			payload = {}
	payload.update({k: v for k, v in kwargs.items() if v is not None})

	tag = extract_crm_tag(payload.get("tracking_tag"), payload.get("referred_by"), payload.get("notes")) or cstr(
		payload.get("tracking_tag") or ""
	).strip().upper()
	if not tag:
		frappe.throw(_("tracking_tag is required (CRM-XX-BK0001)"))
	if not tag.startswith("CRM-"):
		tag = f"CRM-{tag}"

	bill_ref = cstr(payload.get("bill_ref") or payload.get("invoice_number") or payload.get("number") or "").strip()
	amount = flt(payload.get("amount") or payload.get("total") or 0)
	portal = cstr(payload.get("portal") or "care").strip().lower() or "care"
	executive = cstr(payload.get("executive") or "").strip()
	executive_code = cstr(payload.get("executive_code") or "").strip().upper()
	# CRM-SG-BK0007 → executive_code SG when portal notify omits it
	if not executive_code and tag.upper().startswith("CRM-"):
		parts = tag.upper().split("-")
		if len(parts) >= 2 and parts[1]:
			executive_code = parts[1]
	booking_id = cstr(payload.get("booking_id") or "").strip()
	if not booking_id and "-" in tag:
		# CRM-SG-BK0007 → BK-0007
		tail = tag.split("-", 2)[-1]
		if tail.upper().startswith("BK"):
			booking_id = tail.upper().replace("BK", "BK-", 1) if not tail.upper().startswith("BK-") else tail.upper()

	existing = None
	if bill_ref:
		existing = frappe.db.get_value(CRM_SALE_DT, {"tracking_tag": tag, "bill_ref": bill_ref}, "name")
	if not existing:
		existing = frappe.db.get_value(CRM_SALE_DT, {"tracking_tag": tag, "bill_ref": ["in", ["", None]]}, "name")

	values = {
		"tracking_tag": tag,
		"booking_id": booking_id,
		"executive": executive,
		"executive_code": executive_code,
		"amount": amount,
		"bill_ref": bill_ref,
		"portal": portal if portal in ("care", "aesthetic", "lab", "franchise", "crm") else "crm",
		"patient_name": cstr(payload.get("patient_name") or payload.get("patient") or "")[:140],
		"mobile": re.sub(r"\D", "", cstr(payload.get("mobile") or ""))[-10:],
		"notes": cstr(payload.get("notes") or "")[:500],
		"closed_at": payload.get("closed_at") or now_datetime(),
	}

	if existing:
		doc = frappe.get_doc(CRM_SALE_DT, existing)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": CRM_SALE_DT, **values})
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {
		"name": doc.name,
		"tracking_tag": doc.tracking_tag,
		"booking_id": doc.booking_id,
		"executive": doc.executive,
		"amount": flt(doc.amount),
		"bill_ref": doc.bill_ref,
		"portal": doc.portal,
		"closed_at": cstr(doc.closed_at),
	}


def list_crm_sales_closes(limit=100, executive=None, tracking_tag=None):
	ensure_crm_sales_close_doctype()
	filters = {}
	if executive:
		filters["executive"] = cstr(executive).strip()
	if tracking_tag:
		filters["tracking_tag"] = cstr(tracking_tag).strip().upper()
	rows = frappe.get_all(
		CRM_SALE_DT,
		filters=filters or None,
		fields=[
			"name",
			"tracking_tag",
			"booking_id",
			"executive",
			"executive_code",
			"amount",
			"bill_ref",
			"portal",
			"patient_name",
			"mobile",
			"notes",
			"closed_at",
			"modified",
		],
		order_by="closed_at desc, modified desc",
		limit_page_length=cint(limit) or 100,
	)
	return {"closes": rows, "total_amount": sum(flt(r.get("amount")) for r in rows)}


CRM_TARGET_DT = "CRM Sales Target"


def ensure_crm_sales_target_doctype():
	if frappe.db.exists("DocType", CRM_TARGET_DT):
		return
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def

		ensure_hec_module_def()
	except Exception:
		try:
			from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

			ensure_module_def()
		except Exception:
			pass
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_TARGET_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"editable_grid": 0,
			"track_changes": 1,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:CST-{#####}",
			"fields": [
				{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "user_id", "label": "User", "fieldtype": "Data"},
				{"fieldname": "period", "label": "Period", "fieldtype": "Date", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "target_amount", "label": "Target Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
				{"fieldname": "set_by", "label": "Set By", "fieldtype": "Data"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "HR Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1},
				{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
				{"role": "Sales Representative", "read": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def _period_month(period=None):
	from frappe.utils import getdate, today

	d = getdate(period or today())
	return d.replace(day=1)


def _employee_for_user(user=None):
	user = cstr(user or frappe.session.user).strip()
	if not user or user in ("Guest", "Administrator"):
		# Administrator may still have an Employee row
		pass
	return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name") or frappe.db.get_value(
		"Employee", {"user_id": user}, "name"
	)


def get_crm_sales_target(employee=None, period=None):
	ensure_crm_sales_target_doctype()
	month = _period_month(period)
	emp = cstr(employee or "").strip() or _employee_for_user()
	if not emp:
		return {"employee": "", "period": cstr(month), "target_amount": 0, "name": None}
	row = frappe.db.get_value(
		CRM_TARGET_DT,
		{"employee": emp, "period": cstr(month)},
		["name", "employee", "employee_name", "user_id", "period", "target_amount", "set_by", "notes"],
		as_dict=True,
	)
	if not row:
		return {
			"employee": emp,
			"employee_name": frappe.db.get_value("Employee", emp, "employee_name") or emp,
			"period": cstr(month),
			"target_amount": 0,
			"name": None,
		}
	return {
		"name": row.name,
		"employee": row.employee,
		"employee_name": row.employee_name or "",
		"user_id": row.user_id or "",
		"period": cstr(row.period),
		"target_amount": flt(row.target_amount),
		"set_by": row.set_by or "",
		"notes": row.notes or "",
	}


def set_crm_sales_target(employee=None, period=None, target_amount=None, notes=None):
	"""Reporting manager / HR sets a monthly CRM sales ₹ target for a direct report."""
	ensure_crm_sales_target_doctype()
	emp = cstr(employee or "").strip()
	if not emp or not frappe.db.exists("Employee", emp):
		frappe.throw(_("Select an employee"))
	month = _period_month(period)
	amount = flt(target_amount)
	if amount < 0:
		frappe.throw(_("Target amount cannot be negative"))

	emp_row = frappe.db.get_value("Employee", emp, ["employee_name", "user_id", "reports_to"], as_dict=True) or {}
	me_emp = _employee_for_user()
	roles = set(frappe.get_roles(frappe.session.user))
	is_hr = bool(roles & {"HR Manager", "HR User", "System Manager", "Administrator", "Health System Admin"})
	is_crm_mgr = bool(roles & {"CRM Manager", "Sales Manager"})
	if me_emp and emp_row.get("reports_to") == me_emp:
		pass  # reporting manager
	elif is_hr or is_crm_mgr:
		pass
	else:
		frappe.throw(_("Only the reporting manager (or HR / CRM Manager) can set CRM targets"), frappe.PermissionError)

	existing = frappe.db.get_value(CRM_TARGET_DT, {"employee": emp, "period": cstr(month)}, "name")
	values = {
		"employee": emp,
		"employee_name": emp_row.get("employee_name") or emp,
		"user_id": emp_row.get("user_id") or "",
		"period": month,
		"target_amount": amount,
		"set_by": frappe.session.user,
		"notes": cstr(notes or "").strip()[:500] or None,
	}
	if existing:
		doc = frappe.get_doc(CRM_TARGET_DT, existing)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": CRM_TARGET_DT, **values})
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return get_crm_sales_target(emp, month)


def _executive_aliases(employee=None, user=None):
	"""Names / codes used on CRM Sales Close.executive for this person."""
	aliases = set()
	emp = cstr(employee or "").strip()
	uid = cstr(user or "").strip()
	if emp and frappe.db.exists("Employee", emp):
		row = frappe.db.get_value("Employee", emp, ["employee_name", "user_id"], as_dict=True) or {}
		if row.get("employee_name"):
			aliases.add(cstr(row.employee_name).strip())
		if row.get("user_id"):
			uid = uid or row.user_id
	if uid:
		aliases.add(uid)
		aliases.add(uid.split("@")[0])
		full = frappe.db.get_value("User", uid, "full_name")
		if full:
			aliases.add(cstr(full).strip())
	# executive code from initials
	for name in list(aliases):
		parts = [p for p in re.split(r"\s+", name) if p and "@" not in p]
		if len(parts) >= 2:
			aliases.add(f"{parts[0][0]}{parts[-1][0]}".upper())
		elif len(parts) == 1 and len(parts[0]) >= 2:
			aliases.add(parts[0][:2].upper())
	return {a for a in aliases if a}


def achievement_from_closes(employee=None, period=None, user=None):
	"""Sum portal-billed CRM sales closes for this executive in the month."""
	ensure_crm_sales_close_doctype()
	month = _period_month(period)
	from calendar import monthrange

	end = month.replace(day=monthrange(month.year, month.month)[1])
	aliases = _executive_aliases(employee, user)
	codes = {a.upper() for a in aliases if a and len(a) <= 6 and a.isalnum()}
	# Always include initials-style codes derived from full names
	for a in list(aliases):
		parts = [p for p in re.split(r"\s+", cstr(a)) if p and "@" not in p]
		if len(parts) >= 2:
			codes.add(f"{parts[0][0]}{parts[-1][0]}".upper())
	rows = frappe.get_all(
		CRM_SALE_DT,
		filters={"closed_at": ["between", [cstr(month), cstr(end) + " 23:59:59"]]},
		fields=["amount", "executive", "executive_code", "bill_ref", "tracking_tag", "portal", "closed_at"],
		limit_page_length=2000,
	)
	# Also pull recent closes with blank closed_at (older notifies)
	extra = frappe.get_all(
		CRM_SALE_DT,
		filters={"closed_at": ["in", ["", None]]},
		fields=["amount", "executive", "executive_code", "bill_ref", "tracking_tag", "portal", "closed_at", "modified"],
		limit_page_length=500,
	)
	seen = {(cstr(r.get("tracking_tag")), cstr(r.get("bill_ref"))) for r in rows}
	for r in extra:
		key = (cstr(r.get("tracking_tag")), cstr(r.get("bill_ref")))
		if key in seen:
			continue
		mod = cstr(r.get("modified") or "")
		if mod and not (cstr(month) <= mod[:10] <= cstr(end)):
			continue
		rows.append(r)
		seen.add(key)

	matched = []
	total = 0.0
	alias_upper = {a.upper() for a in aliases}
	for r in rows:
		exec_name = cstr(r.get("executive") or "").strip()
		code = cstr(r.get("executive_code") or "").strip().upper()
		tag = cstr(r.get("tracking_tag") or "").strip().upper()
		hit = False
		if exec_name and (exec_name in aliases or exec_name.upper() in alias_upper):
			hit = True
		if code and code in codes:
			hit = True
		# tracking tag CRM-SG-BK0007 → credit SG even when executive field is blank (portal sync)
		if not hit and tag.startswith("CRM-"):
			parts = tag.split("-")
			if len(parts) >= 2 and parts[1] in codes:
				hit = True
		if not hit and exec_name:
			low = exec_name.lower()
			for a in aliases:
				if len(a) >= 3 and a.lower() in low:
					hit = True
					break
		if not hit:
			continue
		amt = flt(r.get("amount"))
		total += amt
		matched.append(r)
	return {"amount": total, "closes": matched, "count": len(matched)}


def get_crm_target_achievement(period=None, employee=None):
	"""CRM dashboard: target (from My Team / reporting manager) vs achievement (synced portal bills)."""
	month = _period_month(period)
	emp = cstr(employee or "").strip() or _employee_for_user()
	user = frappe.session.user
	if emp and emp != _employee_for_user():
		# managers may view a report's card
		me = _employee_for_user()
		reports_to = frappe.db.get_value("Employee", emp, "reports_to") if emp else None
		roles = set(frappe.get_roles(user))
		if reports_to != me and not (roles & {"HR Manager", "CRM Manager", "Sales Manager", "System Manager", "Administrator"}):
			frappe.throw(_("Not permitted to view that target"), frappe.PermissionError)
		user = frappe.db.get_value("Employee", emp, "user_id") or user

	target = get_crm_sales_target(emp, month)
	ach = achievement_from_closes(emp, month, user)
	target_amt = flt(target.get("target_amount"))
	ach_amt = flt(ach.get("amount"))
	pct = round((ach_amt / target_amt) * 100, 1) if target_amt > 0 else (100.0 if ach_amt > 0 else 0.0)
	return {
		"period": cstr(month),
		"period_label": month.strftime("%B %Y"),
		"employee": emp or "",
		"employee_name": target.get("employee_name") or "",
		"target_amount": target_amt,
		"achievement_amount": ach_amt,
		"remaining_amount": max(target_amt - ach_amt, 0),
		"percent": min(pct, 999.0),
		"closes_count": ach.get("count") or 0,
		"set_by": target.get("set_by") or "",
		"has_target": bool(target.get("name") and target_amt > 0),
	}


def map_crm_targets_for_employees(employee_ids, period=None):
	"""Bulk targets for My Team board rows."""
	ensure_crm_sales_target_doctype()
	month = _period_month(period)
	ids = [cstr(i) for i in (employee_ids or []) if i]
	if not ids:
		return {}
	rows = frappe.get_all(
		CRM_TARGET_DT,
		filters={"employee": ("in", ids), "period": cstr(month)},
		fields=["employee", "target_amount", "name", "set_by"],
		limit_page_length=500,
	)
	return {r.employee: {"target_amount": flt(r.target_amount), "name": r.name, "set_by": r.set_by or ""} for r in rows}


CRM_OWN_DT = "CRM Ownership"
CRM_XFER_DT = "CRM Transfer History"
CRM_NOTE_DT = "CRM Transfer Notice"
CRM_SNAP_DT = "CRM Record Snapshot"


def _ensure_hec_module():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def

		ensure_hec_module_def()
	except Exception:
		try:
			from health_ecosystem_core.health_ecosystem_core.init import ensure_module_def

			ensure_module_def()
		except Exception:
			pass


def ensure_crm_record_snapshot_doctype():
	"""Shared lead/follow-up payloads so transferred records appear on the new owner's browser."""
	if frappe.db.exists("DocType", CRM_SNAP_DT):
		return
	_ensure_hec_module()
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_SNAP_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"editable_grid": 0,
			"track_changes": 0,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:CSNAP-{#####}",
			"fields": [
				{"fieldname": "record_type", "label": "Record Type", "fieldtype": "Select", "options": "Lead\nActivity\nDeal\nContact", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "record_id", "label": "Record Id", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "owner_name", "label": "Owner", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "payload", "label": "Payload JSON", "fieldtype": "Long Text", "reqd": 1},
				{"fieldname": "updated_at", "label": "Updated At", "fieldtype": "Datetime"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1, "write": 1, "create": 1},
				{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
				{"role": "Sales Representative", "read": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def ensure_crm_ownership_doctype():
	if frappe.db.exists("DocType", CRM_OWN_DT):
		return
	_ensure_hec_module()
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_OWN_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"editable_grid": 0,
			"track_changes": 1,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:COWN-{#####}",
			"fields": [
				{"fieldname": "record_type", "label": "Record Type", "fieldtype": "Select", "options": "Lead\nActivity\nDeal\nContact", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "record_id", "label": "Record Id", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "owner_name", "label": "Owner", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "from_owner", "label": "From Owner", "fieldtype": "Data"},
				{"fieldname": "transferred_by", "label": "Transferred By", "fieldtype": "Data"},
				{"fieldname": "transferred_at", "label": "Transferred At", "fieldtype": "Datetime"},
				{"fieldname": "note", "label": "Note", "fieldtype": "Small Text"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1},
				{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
				{"role": "Sales Representative", "read": 1},
				{"role": "HR Manager", "read": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def ensure_crm_transfer_history_doctype():
	if frappe.db.exists("DocType", CRM_XFER_DT):
		return
	_ensure_hec_module()
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_XFER_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"editable_grid": 0,
			"track_changes": 0,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:CXFER-{#####}",
			"fields": [
				{"fieldname": "lead_id", "label": "Lead Id", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "lead_name", "label": "Lead Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "previous_owner", "label": "Previous Owner", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "new_owner", "label": "New Owner", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "transferred_by", "label": "Transferred By", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "transferred_by_name", "label": "Transferred By Name", "fieldtype": "Data"},
				{"fieldname": "transferred_at", "label": "Transfer Date", "fieldtype": "Datetime", "in_list_view": 1},
				{"fieldname": "remarks", "label": "Transfer Remarks", "fieldtype": "Small Text"},
				{"fieldname": "followups_moved", "label": "Pending Follow-ups Moved", "fieldtype": "Int", "default": "0"},
				{"fieldname": "followup_ids", "label": "Follow-up Ids", "fieldtype": "Small Text"},
				{"fieldname": "activity_ids", "label": "All Activity Ids", "fieldtype": "Small Text"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1},
				{"role": "Sales Manager", "read": 1, "write": 1, "create": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def ensure_crm_transfer_notice_doctype():
	if frappe.db.exists("DocType", CRM_NOTE_DT):
		return
	_ensure_hec_module()
	doc = frappe.get_doc(
		{
			"doctype": "DocType",
			"name": CRM_NOTE_DT,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"istable": 0,
			"engine": "InnoDB",
			"naming_rule": "Expression",
			"autoname": "format:CNOTE-{#####}",
			"fields": [
				{"fieldname": "recipient", "label": "Recipient", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "recipient_user", "label": "Recipient User", "fieldtype": "Data"},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1},
				{"fieldname": "body", "label": "Body", "fieldtype": "Small Text"},
				{"fieldname": "lead_id", "label": "Lead Id", "fieldtype": "Data"},
				{"fieldname": "read", "label": "Read", "fieldtype": "Check", "default": "0"},
				{"fieldname": "created_at", "label": "Created At", "fieldtype": "Datetime"},
			],
			"permissions": [
				{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
				{"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
				{"role": "CRM Staff", "read": 1, "write": 1},
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


def _parse_snapshots_blob(raw):
	"""Accept {leads:[], activities:[], deals:[], contacts:[]} or JSON string."""
	if raw is None:
		return {"leads": [], "activities": [], "deals": [], "contacts": []}
	if isinstance(raw, str):
		raw = raw.strip()
		if not raw:
			return {"leads": [], "activities": [], "deals": [], "contacts": []}
		try:
			raw = json.loads(raw)
		except Exception:
			return {"leads": [], "activities": [], "deals": [], "contacts": []}
	if not isinstance(raw, dict):
		return {"leads": [], "activities": [], "deals": [], "contacts": []}

	def _rows(key):
		val = raw.get(key) or []
		if isinstance(val, str):
			try:
				val = json.loads(val)
			except Exception:
				val = []
		if not isinstance(val, list):
			return []
		out = []
		for row in val:
			if isinstance(row, dict) and cstr(row.get("id") or "").strip():
				out.append(row)
		return out

	return {
		"leads": _rows("leads"),
		"activities": _rows("activities"),
		"deals": _rows("deals"),
		"contacts": _rows("contacts"),
	}


def upsert_crm_record_snapshot(record_type, record_id, owner_name, payload):
	ensure_crm_record_snapshot_doctype()
	kind = cstr(record_type or "Lead").strip() or "Lead"
	rid = cstr(record_id or "").strip()
	owner = cstr(owner_name or "").strip()
	if not rid or not owner:
		return None
	if isinstance(payload, (dict, list)):
		body = json.dumps(payload, ensure_ascii=False, default=str)
	else:
		body = cstr(payload or "").strip()
	if not body:
		return None
	# Cap oversized history blobs
	if len(body) > 450000:
		try:
			obj = json.loads(body) if isinstance(payload, str) else payload
			if isinstance(obj, dict):
				obj = dict(obj)
				if isinstance(obj.get("history"), list):
					obj["history"] = obj["history"][:20]
				if isinstance(obj.get("transferHistory"), list):
					obj["transferHistory"] = obj["transferHistory"][:10]
				body = json.dumps(obj, ensure_ascii=False, default=str)[:450000]
			else:
				body = body[:450000]
		except Exception:
			body = body[:450000]
	existing = frappe.db.get_value(CRM_SNAP_DT, {"record_type": kind, "record_id": rid}, "name")
	values = {
		"record_type": kind,
		"record_id": rid,
		"owner_name": owner,
		"payload": body,
		"updated_at": now_datetime(),
	}
	if existing:
		doc = frappe.get_doc(CRM_SNAP_DT, existing)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": CRM_SNAP_DT, **values})
		doc.insert(ignore_permissions=True)
	return doc.name


def upsert_crm_record_snapshots(snapshots=None, default_owner=None):
	"""Bulk upsert lead/activity/deal/contact JSON for cross-browser CRM sync."""
	ensure_crm_record_snapshot_doctype()
	blob = _parse_snapshots_blob(snapshots)
	dst = cstr(default_owner or "").strip()
	saved = 0
	mapping = (
		("Lead", blob["leads"]),
		("Activity", blob["activities"]),
		("Deal", blob["deals"]),
		("Contact", blob["contacts"]),
	)
	for kind, rows in mapping:
		for row in rows:
			rid = cstr(row.get("id") or "").strip()
			owner = cstr(row.get("owner") or dst).strip()
			if not rid or not owner:
				continue
			payload = dict(row)
			payload["owner"] = owner
			if upsert_crm_record_snapshot(kind, rid, owner, payload):
				saved += 1
	frappe.db.commit()
	return {"saved": saved, "leads": len(blob["leads"]), "activities": len(blob["activities"])}


def list_crm_record_snapshots(owner=None, record_type=None, limit=2000, include_all=0):
	"""Pull shared CRM payloads for an owner (or current user). Managers may pass include_all=1."""
	ensure_crm_record_snapshot_doctype()
	filters = {}
	kind = cstr(record_type or "").strip()
	if kind:
		filters["record_type"] = kind
	rows = frappe.get_all(
		CRM_SNAP_DT,
		filters=filters or None,
		fields=["record_type", "record_id", "owner_name", "payload", "updated_at", "modified"],
		order_by="modified desc",
		limit_page_length=cint(limit) or 2000,
	)
	session_user = cstr(frappe.session.user or "")
	session_full = cstr(frappe.db.get_value("User", session_user, "full_name") or "").strip().lower()
	emp_name = ""
	try:
		emp_name = cstr(frappe.db.get_value("Employee", {"user_id": session_user}, "employee_name") or "").strip().lower()
	except Exception:
		emp_name = ""
	session_aliases = {session_full, session_user.lower(), session_user.split("@")[0].lower(), emp_name}
	session_aliases = {a for a in session_aliases if a}
	who = cstr(owner or "").strip().lower()
	if cint(include_all):
		aliases = set()
	elif who:
		aliases = {who}
		# Asking for "my" rows under any known login identity
		if who in session_aliases:
			aliases |= session_aliases
	else:
		aliases = set(session_aliases)
	aliases = {a for a in aliases if a}

	leads, activities, deals, contacts = [], [], [], []
	seen = set()
	for r in rows:
		rid = cstr(r.record_id or "").strip()
		own = cstr(r.owner_name or "").strip()
		rtype = cstr(r.record_type or "Lead")
		key = f"{rtype}:{rid}"
		if not rid or key in seen:
			continue
		if aliases and own.lower() not in aliases:
			continue
		try:
			payload = json.loads(r.payload) if r.payload else {}
		except Exception:
			payload = {}
		if not isinstance(payload, dict):
			continue
		payload["id"] = rid
		payload["owner"] = own or cstr(payload.get("owner") or "")
		seen.add(key)
		if rtype == "Lead":
			leads.append(payload)
		elif rtype == "Activity":
			activities.append(payload)
		elif rtype == "Deal":
			deals.append(payload)
		elif rtype == "Contact":
			contacts.append(payload)
	return {
		"leads": leads,
		"activities": activities,
		"deals": deals,
		"contacts": contacts,
		"count": len(seen),
	}


def list_crm_ownership():
	"""Ownership overrides shared across all CRM portal browsers."""
	ensure_crm_ownership_doctype()
	rows = frappe.get_all(
		CRM_OWN_DT,
		fields=["record_type", "record_id", "owner_name", "from_owner", "transferred_by", "transferred_at", "note", "modified"],
		limit_page_length=5000,
		order_by="modified desc",
	)
	leads, activities, deals, contacts = {}, {}, {}, {}
	for r in rows:
		rid = cstr(r.record_id or "").strip()
		owner = cstr(r.owner_name or "").strip()
		if not rid or not owner:
			continue
		entry = {
			"owner": owner,
			"from_owner": cstr(r.from_owner or ""),
			"transferred_by": cstr(r.transferred_by or ""),
			"transferred_at": cstr(r.transferred_at or r.modified or ""),
			"note": cstr(r.note or ""),
		}
		kind = cstr(r.record_type or "Lead")
		if kind == "Lead" and rid not in leads:
			leads[rid] = entry
		elif kind == "Activity" and rid not in activities:
			activities[rid] = entry
		elif kind == "Deal" and rid not in deals:
			deals[rid] = entry
		elif kind == "Contact" and rid not in contacts:
			contacts[rid] = entry
	return {"leads": leads, "activities": activities, "deals": deals, "contacts": contacts}


def _upsert_ownership(record_type, record_id, owner_name, from_owner=None, note=None):
	ensure_crm_ownership_doctype()
	rid = cstr(record_id or "").strip()
	owner = cstr(owner_name or "").strip()
	kind = cstr(record_type or "Lead").strip() or "Lead"
	if not rid or not owner:
		return None
	existing = frappe.db.get_value(CRM_OWN_DT, {"record_type": kind, "record_id": rid}, "name")
	values = {
		"record_type": kind,
		"record_id": rid,
		"owner_name": owner,
		"from_owner": cstr(from_owner or "")[:140] or None,
		"transferred_by": frappe.session.user,
		"transferred_at": now_datetime(),
		"note": cstr(note or "").strip()[:500] or None,
	}
	if existing:
		doc = frappe.get_doc(CRM_OWN_DT, existing)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": CRM_OWN_DT, **values})
		doc.insert(ignore_permissions=True)
	return doc.name


def _parse_id_list(raw):
	if raw is None:
		return []
	if isinstance(raw, str):
		raw = raw.strip()
		if not raw:
			return []
		try:
			parsed = json.loads(raw)
			raw = parsed
		except Exception:
			raw = [x.strip() for x in raw.split(",") if x.strip()]
	if not isinstance(raw, (list, tuple)):
		return []
	return [cstr(x).strip() for x in raw if cstr(x).strip()]


def _parse_lead_meta(raw):
	"""Optional [{id, name, followup_ids?}] for transfer history labels."""
	if raw is None:
		return {}
	if isinstance(raw, str):
		raw = raw.strip()
		if not raw:
			return {}
		try:
			raw = json.loads(raw)
		except Exception:
			return {}
	out = {}
	if isinstance(raw, dict) and "id" not in raw:
		for k, v in raw.items():
			if isinstance(v, dict):
				out[cstr(k)] = {
					"name": cstr(v.get("name") or k),
					"followup_ids": _parse_id_list(v.get("followup_ids") or v.get("activity_ids")),
				}
			else:
				out[cstr(k)] = {"name": cstr(v), "followup_ids": []}
		return out
	if isinstance(raw, list):
		for row in raw:
			if isinstance(row, dict) and row.get("id"):
				lid = cstr(row.get("id"))
				out[lid] = {
					"name": cstr(row.get("name") or lid),
					"followup_ids": _parse_id_list(row.get("followup_ids") or row.get("activity_ids")),
				}
	elif isinstance(raw, dict) and raw.get("id"):
		lid = cstr(raw.get("id"))
		out[lid] = {
			"name": cstr(raw.get("name") or lid),
			"followup_ids": _parse_id_list(raw.get("followup_ids") or raw.get("activity_ids")),
		}
	return out


def _notify_transfer(recipient_name, recipient_user, title, body, lead_id=None):
	ensure_crm_transfer_notice_doctype()
	if not recipient_name and not recipient_user:
		return
	frappe.get_doc(
		{
			"doctype": CRM_NOTE_DT,
			"recipient": cstr(recipient_name or "")[:140],
			"recipient_user": cstr(recipient_user or "")[:140],
			"title": cstr(title or "Lead transferred")[:140],
			"body": cstr(body or "")[:500],
			"lead_id": cstr(lead_id or "")[:40] or None,
			"read": 0,
			"created_at": now_datetime(),
		}
	).insert(ignore_permissions=True)


def transfer_crm_ownership(
	from_owner=None,
	to_owner=None,
	lead_ids=None,
	activity_ids=None,
	deal_ids=None,
	contact_ids=None,
	note=None,
	lead_meta=None,
	transferred_by_name=None,
	snapshots=None,
):
	"""Persist ownership handoff + append-only transfer history + notify both owners."""
	ensure_crm_ownership_doctype()
	ensure_crm_transfer_history_doctype()
	ensure_crm_transfer_notice_doctype()
	ensure_crm_record_snapshot_doctype()
	src = cstr(from_owner or "").strip()
	dst = cstr(to_owner or "").strip()
	remarks = cstr(note or "").strip()
	if not dst:
		frappe.throw(_("Select the destination CRM owner"))
	if src and src == dst:
		frappe.throw(_("From and to owners must be different"))
	if not remarks:
		frappe.throw(_("Transfer remarks are required"))

	leads = _parse_id_list(lead_ids)
	acts = _parse_id_list(activity_ids)
	deals = _parse_id_list(deal_ids)
	contacts = _parse_id_list(contact_ids)
	names = _parse_lead_meta(lead_meta)
	if not (leads or acts or deals or contacts):
		frappe.throw(_("Select at least one lead or follow-up to transfer"))

	by_user = frappe.session.user
	by_name = cstr(transferred_by_name or "").strip() or cstr(frappe.db.get_value("User", by_user, "full_name") or by_user)
	when = now_datetime()

	saved = []
	for lid in leads:
		saved.append(_upsert_ownership("Lead", lid, dst, src, remarks))
	for aid in acts:
		saved.append(_upsert_ownership("Activity", aid, dst, src, remarks))
	for did in deals:
		saved.append(_upsert_ownership("Deal", did, dst, src, remarks))
	for cid in contacts:
		saved.append(_upsert_ownership("Contact", cid, dst, src, remarks))

	# Persist full lead/follow-up payloads so the new owner's browser can load them.
	snap_result = upsert_crm_record_snapshots(snapshots, default_owner=dst)

	# One history row per lead (pending follow-ups that moved with it)
	history_rows = []
	for lid in leads:
		meta = names.get(lid) or {}
		lead_label = meta.get("name") if isinstance(meta, dict) else cstr(meta or lid)
		if not lead_label:
			lead_label = lid
		moved = []
		if isinstance(meta, dict) and meta.get("followup_ids"):
			moved = list(meta["followup_ids"])
		elif len(leads) == 1:
			moved = list(acts)
		doc = frappe.get_doc(
			{
				"doctype": CRM_XFER_DT,
				"lead_id": lid,
				"lead_name": lead_label,
				"previous_owner": src or None,
				"new_owner": dst,
				"transferred_by": by_user,
				"transferred_by_name": by_name,
				"transferred_at": when,
				"remarks": remarks[:500],
				"followups_moved": len(moved),
				"followup_ids": ",".join(moved)[:500] if moved else None,
				"activity_ids": ",".join(moved)[:500] if moved else None,
			}
		)
		doc.insert(ignore_permissions=True)
		history_rows.append(doc.name)
		_notify_transfer(
			dst,
			"",
			f"Lead {lid} assigned to you",
			f"{by_name} transferred “{lead_label}” from {src or 'previous owner'} to you. Remarks: {remarks}",
			lid,
		)
		if src:
			_notify_transfer(
				src,
				"",
				f"Lead {lid} transferred away",
				f"{by_name} transferred “{lead_label}” from you to {dst}. Remarks: {remarks}",
				lid,
			)

	# Follow-up-only transfers still get a notice
	if not leads and acts:
		_notify_transfer(dst, "", "Follow-ups assigned to you", f"{by_name} transferred {len(acts)} pending follow-up(s) to you. Remarks: {remarks}")
		if src:
			_notify_transfer(src, "", "Follow-ups transferred away", f"{by_name} transferred {len(acts)} pending follow-up(s) from you to {dst}.")

	frappe.db.commit()
	return {
		"saved": len([x for x in saved if x]),
		"leads": len(leads),
		"activities": len(acts),
		"deals": len(deals),
		"contacts": len(contacts),
		"snapshots": snap_result.get("saved") if isinstance(snap_result, dict) else 0,
		"history": len(history_rows),
		"to_owner": dst,
		"from_owner": src,
		"remarks": remarks,
		"ownership": list_crm_ownership(),
		"transfer_history": list_crm_transfer_history(limit=50),
		"notices": list_crm_transfer_notices(limit=20),
	}


def list_crm_transfer_history(lead_id=None, limit=100):
	ensure_crm_transfer_history_doctype()
	filters = {}
	lid = cstr(lead_id or "").strip()
	if lid:
		filters["lead_id"] = lid
	rows = frappe.get_all(
		CRM_XFER_DT,
		filters=filters or None,
		fields=[
			"name",
			"lead_id",
			"lead_name",
			"previous_owner",
			"new_owner",
			"transferred_by",
			"transferred_by_name",
			"transferred_at",
			"remarks",
			"followups_moved",
			"followup_ids",
		],
		order_by="transferred_at desc, modified desc",
		limit_page_length=cint(limit) or 100,
	)
	return {
		"history": [
			{
				"id": r.name,
				"lead_id": r.lead_id,
				"lead_name": r.lead_name or "",
				"previous_owner": r.previous_owner or "",
				"new_owner": r.new_owner or "",
				"transferred_by": r.transferred_by_name or r.transferred_by or "",
				"transferred_at": cstr(r.transferred_at or ""),
				"remarks": r.remarks or "",
				"followups_moved": cint(r.followups_moved),
				"followup_ids": [x for x in cstr(r.followup_ids or "").split(",") if x],
			}
			for r in rows
		]
	}


def list_crm_transfer_notices(recipient=None, limit=30):
	ensure_crm_transfer_notice_doctype()
	filters = {}
	who = cstr(recipient or "").strip()
	user = frappe.session.user
	full = cstr(frappe.db.get_value("User", user, "full_name") or "")
	# Default: notices for current session user / full name
	rows = frappe.get_all(
		CRM_NOTE_DT,
		fields=["name", "recipient", "recipient_user", "title", "body", "lead_id", "read", "created_at"],
		order_by="created_at desc, modified desc",
		limit_page_length=500,
	)
	out = []
	for r in rows:
		rec = cstr(r.recipient or "")
		ruser = cstr(r.recipient_user or "")
		if who:
			if who.lower() not in (rec.lower(), ruser.lower()):
				continue
		else:
			if user not in (ruser, rec) and full.lower() not in (rec.lower(),) and (not full or full.lower() != rec.lower()):
				# also match email local-part
				if user.split("@")[0].lower() not in (rec.lower(), ruser.lower()):
					continue
		out.append(
			{
				"id": r.name,
				"recipient": rec,
				"title": r.title or "",
				"body": r.body or "",
				"lead_id": r.lead_id or "",
				"read": cint(r.read),
				"created_at": cstr(r.created_at or ""),
			}
		)
		if len(out) >= (cint(limit) or 30):
			break
	return {"notices": out, "unread": sum(1 for n in out if not n["read"])}


def mark_crm_transfer_notice_read(notice_id=None):
	ensure_crm_transfer_notice_doctype()
	nid = cstr(notice_id or "").strip()
	if not nid or not frappe.db.exists(CRM_NOTE_DT, nid):
		frappe.throw(_("Notice not found"))
	frappe.db.set_value(CRM_NOTE_DT, nid, "read", 1)
	frappe.db.commit()
	return {"ok": True, "id": nid}
