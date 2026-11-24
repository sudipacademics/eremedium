"""People HRMS: per-employee portal access (logins + module permissions) and asset assignment agreements.

Portal access maps each portal to the existing roles that already gate it. Higher module levels add the
portal's manager role. HR / manager roles can only be granted by an HR Manager or System Manager, and
System Manager / Administrator / Health System Admin are never granted here.

Assigning assets snapshots them into an Asset Assignment PDF. HR and the employee can sign
on screen; the signed PDF is stored as a private People Document on the employee.
"""

from __future__ import annotations

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, format_date, getdate, now_datetime, today

ACCESS_DT = "People Portal Access"
AGREEMENT_DT = "People Asset Agreement"
AGREEMENT_STATUSES = "Issued\nPending Signatures\nPending Employee\nPending HR\nSigned"
LEVELS = ("none", "view", "create", "edit", "approve", "manage")
LEVEL_LABEL = {"none": "No access", "view": "View", "create": "Create", "edit": "Edit", "approve": "Approve", "manage": "Manage"}
FORBIDDEN_ROLES = {"System Manager", "Administrator", "Health System Admin"}
ELEVATED_ROLES = {
	"HR Manager",
	"HR User",
	"Lab Manager",
	"Quality Control Manager",
	"Sales Manager",
	"Aesthetic Manager",
	"Operations Manager",
	"Care Manager",
	"CRM Manager",
}
GRANTOR_ROLES = {"HR Manager", "System Manager", "Administrator"}
COMPANY = "Smilecure Lifestyle Pvt Ltd"

# People portal modules, one per sidebar item, with the routes each one covers.
PEOPLE_MODULE_PATHS = {
	"Dashboard": ["/people"],
	"Employees": ["/people/employees"],
	"WDD": ["/people/departments", "/people/designations", "/people/organization"],
	"Grades": ["/people/grades"],
	"Attendance": ["/people/attendance"],
	"Leave": ["/people/leave"],
	"Payroll": ["/people/payslips"],
	"Expenses": ["/people/expenses"],
	"Performance": ["/people/performance"],
	"Recruitment": ["/people/recruitment"],
	"Onboarding": ["/people/onboarding"],
	"Training": ["/people/training"],
	"Career": ["/people/career"],
	"Documents": ["/people/documents"],
	"Policies": ["/people/policies"],
	"Assets": ["/people/assets"],
	"Announcements": ["/people/announcements"],
	"Calendar": ["/people/calendar"],
	"Reports": ["/people/reports"],
	"Analytics": ["/people/analytics"],
	"Company Settings": ["/people/settings/company"],
	"Geofencing": ["/people/settings/geofencing"],
	"Roles & Permissions": ["/people/settings/roles"],
	"Integrations": ["/people/settings/integrations"],
}
# Modules that only exist as organisation-wide HR screens (need the HR shell even at View).
PEOPLE_ORG_MODULES = {"Employees", "WDD", "Grades", "Recruitment", "Onboarding", "Reports", "Analytics", "Company Settings", "Geofencing", "Roles & Permissions", "Integrations"}
# What a newly ticked People portal starts with: the employee's own self-service only.
PEOPLE_SELF_SERVICE_DEFAULT = {"Dashboard", "Attendance", "Leave", "Payroll", "Expenses"}
# Settings saved before the per-sidebar module list existed.
PEOPLE_LEGACY_MODULES = {
	"Employees": ["Employees", "WDD", "Grades"],
	"Documents": ["Documents", "Policies"],
	"Performance": ["Performance", "Training", "Career"],
	"Recruitment": ["Recruitment", "Onboarding"],
	"Reports": ["Reports", "Analytics"],
	"Settings": ["Company Settings", "Geofencing", "Roles & Permissions", "Integrations"],
}

AESTHETIC_MODULE_PATHS = {
	"Dashboard": ["/"],
	"Bookings": ["/bookings"],
	"Services": ["/services"],
	"Products": ["/products"],
	"Machines": ["/machines"],
	"Invoices": ["/invoices"],
	"Branches": ["/branches"],
	"Settings": ["/settings"],
}
OPS_MODULE_PATHS = {
	"Dashboard": ["/"],
	"Approvals": ["/approvals"],
	"Unit Operations": ["/units"],
	"Service Operations": ["/services"],
	"Bookings & Orders": ["/bookings"],
	"Logistics & Collection": ["/logistics"],
	"Inventory & Purchase": ["/inventory"],
	"Assets": ["/assets"],
	"Vendor Management": ["/vendors"],
	"Quality & Compliance": ["/quality"],
	"Reports & Analytics": ["/reports"],
	"Settings": ["/settings"],
}
# Lab Technician portal sidebar (LabTechChrome). My Profile is always open.
LAB_MODULE_PATHS = {
	"Result entry": ["/dashboard/lab-reports"],
	"Mother lab bill": ["/dashboard/lab-bill-entry"],
	"Accession": ["/dashboard/accession"],
	"PhleboFirst inbox": ["/dashboard/pf-inbox"],
	"Report lifecycle": ["/dashboard/report-lifecycle"],
	"Critical alerts": ["/dashboard/critical-alerts"],
	"IQC / NABL QC": ["/dashboard/qc"],
	"QMS": ["/dashboard/qms"],
	"Barcode bench": ["/dashboard/lab-tech"],
	"All bookings": ["/dashboard/all-bookings"],
	"Reagents": ["/dashboard/reagents"],
	"Inventory Management": ["/dashboard/inventory"],
	"Pathologist": ["/dashboard/pathologist"],
	"Reports (Signed)": ["/dashboard/pathologist/signed"],
	"Test Master": ["/dashboard/test-master"],
	"Settings": ["/dashboard/settings"],
}
# Lab settings saved with the earlier five-module list.
LAB_LEGACY_MODULES = {
	"Samples": ["Accession", "PhleboFirst inbox", "Barcode bench", "All bookings"],
	"Results": ["Result entry", "Mother lab bill", "Report lifecycle", "Critical alerts"],
	"Reports": ["Pathologist", "Reports (Signed)"],
	"Inventory": ["Inventory Management", "Reagents"],
	"Quality Control": ["IQC / NABL QC", "QMS"],
}
CARE_MODULE_PATHS = {
	"Dashboard": ["/"],
	"Appointments": ["/appointments"],
	"Doctors": ["/doctors"],
	"Physiotherapy": ["/physio"],
	"Patients": ["/patients"],
	"Test & Lab": ["/lab"],
	"Diagnostics": ["/diagnostics"],
	"Billing & Invoice": ["/billing"],
	"Pharmacy": ["/pharmacy"],
	"Inventory Management": ["/inventory"],
	"Branch Management": ["/branches"],
	"Reports & Analytics": ["/reports"],
	"Assets Management": ["/assets"],
	"User & Access": ["/access"],
	"Settings": ["/settings"],
}
# Mother modules only — granting a mother module covers all of its CRM sidebar submodules.
CRM_MODULE_PATHS = {
	"Dashboard": ["/"],
	"Service Lead": [
		"/leads/service",
		"/leads/service/aesthetic",
		"/leads/service/care",
		"/leads/service/lab",
	],
	"Franchise Lead": [
		"/leads/franchise",
		"/leads/franchise/aesthetic",
		"/leads/franchise/care",
		"/leads/franchise/lab",
		"/leads/franchise/nexilab",
	],
	"Contacts": ["/contacts"],
	"Accounts": ["/accounts"],
	"Deals": ["/deals"],
	"Service Followup": [
		"/activities/service",
		"/activities/service/aesthetic",
		"/activities/service/care",
		"/activities/service/lab",
	],
	"Franchise Followup": [
		"/activities/franchise",
		"/activities/franchise/aesthetic",
		"/activities/franchise/care",
		"/activities/franchise/lab",
		"/activities/franchise/nexilab",
	],
	"WhatsApp Centre": [
		"/whatsapp",
		"/whatsapp/all",
		"/whatsapp/all/all",
		"/whatsapp/franchise",
		"/whatsapp/service",
		# legacy single-segment tabs
		"/whatsapp/aesthetic",
		"/whatsapp/care",
		"/whatsapp/lab",
		"/whatsapp/nexilab",
	],
	"Bookings": ["/bookings"],
	"Franchise (FFMS/RFMS)": ["/franchise"],
	"Partner Unit Bookings": ["/partner-bookings"],
	"Campaigns": ["/campaigns"],
	"Reports & Analytics": ["/reports"],
	"Settings": ["/settings"],
}
# Executive = assigned modules + Service/Franchise categories. Manager = full CRM with manage.
CRM_CATEGORIES = (
	{"id": "service", "name": "Service", "hint": "Lab / Aesthetic / Care leads, follow-ups & WhatsApp"},
	{"id": "franchise", "name": "Franchise", "hint": "Lab / Aesthetic / Care / NexiLab franchise leads, follow-ups & WhatsApp"},
)
# Roles these portals check that may not exist yet on a fresh site (created on first use).
PORTAL_ROLES = (
	"Aesthetic Staff",
	"Aesthetic Manager",
	"Operations Staff",
	"Operations Manager",
	"Care Staff",
	"Care Manager",
	"CRM Executive",
	"CRM Staff",
	"CRM Manager",
	"Lab Technician",
	"Lab Manager",
	"Quality Control Manager",
	"Lab Accessor",
)

# LabTech portal — HR picks exactly one user type per employee.
# Sign & finalize (pathologist authorize) is only for Lab Manager + Quality Control Manager.
LABTECH_USER_TYPES = (
	{
		"id": "lab_manager",
		"name": "Lab Manager",
		"hint": "Full lab operations · can sign & finalize reports",
		"roles": ("Lab Technician", "Lab Manager"),
		"can_sign": 1,
	},
	{
		"id": "qc_manager",
		"name": "Quality Control Manager",
		"hint": "QC / NABL oversight · can sign & finalize reports",
		"roles": ("Lab Technician", "Quality Control Manager"),
		"can_sign": 1,
	},
	{
		"id": "lab_technician",
		"name": "Lab Technician",
		"hint": "Result entry & bench work · cannot sign reports",
		"roles": ("Lab Technician",),
		"can_sign": 0,
	},
	{
		"id": "accessor",
		"name": "Accessor",
		"hint": "Sample accession & bookings · cannot sign reports",
		"roles": ("Lab Technician", "Lab Accessor"),
		"can_sign": 0,
	},
)
LABTECH_USER_TYPE_IDS = {t["id"] for t in LABTECH_USER_TYPES}
LABTECH_SIGN_ROLES = frozenset({"Lab Manager", "Quality Control Manager"})
LABTECH_DEFAULT_TYPE = "lab_technician"

PORTALS = {
	"people": {
		"label": "People HRMS",
		"url": "https://people.e-remedium.in",
		"roles": ["Employee"],
		"modules": list(PEOPLE_MODULE_PATHS),
		"approve_roles": ["HR User"],
		"manage_roles": ["HR Manager"],
		"manage_modules": ["Employees", "Payroll", "Company Settings", "Roles & Permissions", "Integrations"],
		"org_modules": PEOPLE_ORG_MODULES,
		"module_paths": PEOPLE_MODULE_PATHS,
	},
	"labtech": {
		"label": "Lab Technician Portal",
		"url": "https://labtech.e-remedium.in",
		"roles": ["Lab Technician"],
		"modules": list(LAB_MODULE_PATHS),
		"manage_roles": ["Lab Manager", "Quality Control Manager"],
		"module_paths": LAB_MODULE_PATHS,
		"user_types": list(LABTECH_USER_TYPES),
	},
	"collect": {
		"label": "Collection / Phlebotomy",
		"url": "https://collect.remediumlabs.in",
		"roles": ["Phlebotomist"],
		"modules": ["Collections", "Routes", "Handover"],
	},
	"partners": {
		"label": "Franchise Partners",
		"url": "https://partners.remediumlabs.in",
		"roles": ["Franchisee Operator"],
		"modules": ["Bookings", "Billing", "Reports"],
	},
	"sales": {
		"label": "Reach / Sales",
		"url": "https://reach.e-remedium.in",
		"roles": ["Sales Representative"],
		"modules": ["Leads", "Visits", "Targets", "Reports"],
		"manage_roles": ["Sales Manager"],
	},
	"crm": {
		"label": "CRM Portal",
		"url": "https://crm.e-remedium.in",
		# CRM Executive = telecaller with assigned modules/categories; CRM Manager = full access.
		# CRM Staff kept for legacy users until HR re-saves portal access.
		# Only Settings→Manage (or the CRM Manager Frappe role) elevates to Manager —
		# Manage on Lead/Followup modules must not turn executives into managers.
		"roles": ["CRM Executive", "Employee"],
		"modules": list(CRM_MODULE_PATHS),
		"manage_roles": ["CRM Manager"],
		"manage_modules": ["Settings"],
		"module_paths": CRM_MODULE_PATHS,
		"category_options": list(CRM_CATEGORIES),
	},
	"careers": {
		"label": "Careers / Recruitment",
		"url": "https://career.e-remedium.in",
		"roles": ["HR User"],
		"modules": ["Job Openings", "Applicants", "Interviews", "Offers"],
	},
	"aesthetics": {
		"label": "Aesthetic Backend",
		"url": "https://aesthetics.e-remedium.in",
		"roles": ["Aesthetic Staff", "Employee"],
		"modules": list(AESTHETIC_MODULE_PATHS),
		"manage_roles": ["Aesthetic Manager"],
		"module_paths": AESTHETIC_MODULE_PATHS,
	},
	"ops": {
		"label": "Operations Backend",
		"url": "https://ops.e-remedium.in",
		"roles": ["Operations Staff", "Employee"],
		"modules": list(OPS_MODULE_PATHS),
		"manage_roles": ["Operations Manager"],
		"module_paths": OPS_MODULE_PATHS,
	},
	"care": {
		"label": "Care Backend",
		"url": "https://care.e-remedium.in",
		"roles": ["Care Staff", "Employee"],
		"modules": list(CARE_MODULE_PATHS),
		"manage_roles": ["Care Manager"],
		"module_paths": CARE_MODULE_PATHS,
	},
}


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles


def _is_manager(roles):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	return is_people_manager(roles)


def _guard(sid, manager=True):
	_error, _parse, _require, _success, _roles = _api()
	denied = _require(sid)
	if denied:
		return denied, None
	roles = _roles()
	if manager and not _is_manager(roles):
		return _error(_("HR manager access required"), 403), None
	return None, roles


def _ensure_portal_roles():
	for role in PORTAL_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def _ensure_access_fields():
	"""Fields added to People Portal Access after it was first created."""
	if not frappe.db.exists("DocType", ACCESS_DT) or frappe.get_meta(ACCESS_DT).has_field("branches"):
		return
	doc = frappe.get_doc("DocType", ACCESS_DT)
	doc.append("fields", {"fieldname": "branches", "label": "Branches", "fieldtype": "Small Text", "description": "Clinic portal branch ids (JSON) for Care/Aesthetic, CRM category ids (service/franchise), or [\"*\"] for every branch/category."})
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=ACCESS_DT)


def _ensure_doctypes():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import _ensure_custom_doctype

	_ensure_portal_roles()

	_ensure_custom_doctype(
		ACCESS_DT,
		[
			{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
			{"fieldname": "portal", "label": "Portal", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "login_user", "label": "Login", "fieldtype": "Link", "options": "User", "in_list_view": 1},
			{"fieldname": "permissions", "label": "Module Permissions", "fieldtype": "Long Text"},
			{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			{"fieldname": "granted_by", "label": "Granted By", "fieldtype": "Data", "read_only": 1},
			{"fieldname": "granted_on", "label": "Granted On", "fieldtype": "Datetime", "read_only": 1},
			{"fieldname": "branches", "label": "Branches", "fieldtype": "Small Text"},
		],
	)
	_ensure_access_fields()
	_ensure_custom_doctype(
		AGREEMENT_DT,
		[
			{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
			{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": AGREEMENT_STATUSES, "default": "Issued", "in_list_view": 1},
			{"fieldname": "assets", "label": "Assets", "fieldtype": "Long Text"},
			{"fieldname": "issued_on", "label": "Issued On", "fieldtype": "Date"},
			{"fieldname": "hr_signature", "label": "HR Signature", "fieldtype": "Long Text"},
			{"fieldname": "hr_signer", "label": "HR Signer", "fieldtype": "Data"},
			{"fieldname": "hr_signed_by", "label": "HR Signed By (User)", "fieldtype": "Data", "read_only": 1},
			{"fieldname": "hr_signed_on", "label": "HR Signed On", "fieldtype": "Datetime", "read_only": 1},
			{"fieldname": "employee_signature", "label": "Employee Signature", "fieldtype": "Long Text"},
			{"fieldname": "employee_signer", "label": "Employee Signer", "fieldtype": "Data"},
			{"fieldname": "employee_signed_on", "label": "Employee Signed On", "fieldtype": "Datetime", "read_only": 1},
			{"fieldname": "people_document", "label": "People Document", "fieldtype": "Data"},
			{"fieldname": "file_url", "label": "PDF", "fieldtype": "Data"},
		],
	)
	if frappe.db.get_value("DocField", {"parent": AGREEMENT_DT, "fieldname": "status"}, "options") != AGREEMENT_STATUSES:
		frappe.db.set_value("DocField", {"parent": AGREEMENT_DT, "fieldname": "status"}, {"options": AGREEMENT_STATUSES, "default": "Issued"})
		frappe.clear_cache(doctype=AGREEMENT_DT)


def _caller_can_grant(roles):
	return bool(set(roles or []) & GRANTOR_ROLES)


# ---------------------------------------------------------------- Care Backend branches

# Public lists of branches kept by each clinic portal (id, name, code, city, active); new branches show up here.
CARE_BRANCH_DIRECTORY = "https://care.e-remedium.in/care-api/branch-directory"
CARE_BRANCH_CACHE = "care_branch_directory"
AES_BRANCH_DIRECTORY = "https://care.e-remedium.in/aes-api/branch-directory"
AES_BRANCH_CACHE = "aes_branch_directory"
ALL_BRANCHES = "*"


def _portal_branches(url, cache_key):
	"""Branches of a clinic portal, cached for five minutes; the last good copy is used if the portal is unreachable."""
	cache = frappe.cache()
	hit = cache.get_value(cache_key)
	if hit is not None:
		return hit
	import urllib.request

	try:
		with urllib.request.urlopen(url, timeout=6) as resp:
			payload = json.loads(resp.read().decode("utf-8") or "{}")
		branches = [
			{"id": cint(b.get("id")), "name": cstr(b.get("name")), "code": cstr(b.get("code")), "city": cstr(b.get("city")), "active": cint(b.get("active"))}
			for b in (payload.get("data") or [])
			if cint(b.get("id"))
		]
		cache.set_value(cache_key, branches, expires_in_sec=300)
		cache.set_value(cache_key + "_last", branches)
		return branches
	except Exception:
		return cache.get_value(cache_key + "_last") or []


def care_branches():
	"""Branches of the Care portal, cached for five minutes; the last good copy is used if the portal is unreachable."""
	return _portal_branches(CARE_BRANCH_DIRECTORY, CARE_BRANCH_CACHE)


def aes_branches():
	"""Branches of the Aesthetic portal; new branches appear here without a code change."""
	return _portal_branches(AES_BRANCH_DIRECTORY, AES_BRANCH_CACHE)


def _parse_branches(raw):
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
	except ValueError:
		data = None
	if not isinstance(data, list):
		return []
	if ALL_BRANCHES in data:
		return [ALL_BRANCHES]
	return sorted({cint(x) for x in data if cint(x) > 0})


def _unit_branch(unit, branches):
	"""Clinic branch an HRMS Unit/Centre stands for: 'Remedium Care - Ashoknagar' -> branch 'Ashoknagar'."""
	text = cstr(unit).strip().lower()
	if not text:
		return None
	for b in branches:
		name = b["name"].strip().lower()
		if not name:
			continue
		if text == name or text.endswith(" - " + name) or text.endswith(" " + name) or name.endswith(" " + text) or name in text or text in name:
			return b["id"]
	return None


def _checked_care_branches(employee, raw, new_roles, active):
	branches = _parse_branches(raw)
	directory = care_branches()
	known = {b["id"] for b in directory}
	unknown = [b for b in branches if b != ALL_BRANCHES and known and b not in known]
	if unknown:
		frappe.throw(_("Unknown Care branch: {0}").format(", ".join(str(b) for b in unknown)))
	manager = "Care Manager" in new_roles
	if not manager and (branches == [ALL_BRANCHES] or len(branches) > 1):
		frappe.throw(_("Only a Care Manager can work in more than one branch. Give Manage on at least one Care module, or pick one branch."))
	if active and not branches and not care_scope(employee, [])["ids"]:
		frappe.throw(_("Pick the Care branch this employee works in, or set their Unit / Centre to a Remedium Care branch."))
	return branches


def care_scope(employee, assigned):
	"""Branches a Care Backend login may use: explicit HR assignment, else the branch of the employee's Unit/Centre."""
	return _portal_scope(employee, assigned, care_branches())


def aes_scope(employee, assigned):
	"""Branches an Aesthetic Backend login may use: explicit HR assignment, else Unit/Centre."""
	return _portal_scope(employee, assigned, aes_branches())


def _portal_scope(employee, assigned, branches):
	unit = cstr(frappe.db.get_value("Employee", employee, "people_unit")) if employee and frappe.get_meta("Employee").has_field("people_unit") else ""
	unit_branch = _unit_branch(unit, branches)
	if assigned == [ALL_BRANCHES]:
		return {"all": True, "ids": [], "source": "assigned", "unit": unit, "unit_branch": unit_branch}
	known = {b["id"] for b in branches}
	ids = [i for i in assigned if not known or i in known]
	if ids:
		return {"all": False, "ids": ids, "source": "assigned", "unit": unit, "unit_branch": unit_branch}
	return {"all": False, "ids": [unit_branch] if unit_branch else [], "source": "unit", "unit": unit, "unit_branch": unit_branch}


def _checked_aes_branches(employee, raw, perms, active):
	branches = _parse_branches(raw)
	directory = aes_branches()
	known = {b["id"] for b in directory}
	unknown = [b for b in branches if b != ALL_BRANCHES and known and b not in known]
	if unknown:
		frappe.throw(_("Unknown Aesthetic branch: {0}").format(", ".join(str(b) for b in unknown)))
	manager = cstr((perms or {}).get("Settings") or "none") not in ("", "none")
	if not manager and (branches == [ALL_BRANCHES] or len(branches) > 1):
		frappe.throw(_("Only staff with Settings access can work in more than one Aesthetic branch. Give Settings access, or pick one branch."))
	if active and not branches and not aes_scope(employee, [])["ids"]:
		frappe.throw(_("Pick the Aesthetic branch this employee works in, or set their Unit / Centre to an Aesthetic branch."))
	return branches


def _parse_crm_categories(raw):
	"""CRM Service / Franchise categories stored in the same branches JSON field."""
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
	except ValueError:
		data = None
	if not isinstance(data, list):
		return []
	if ALL_BRANCHES in data or "*" in {cstr(x).strip() for x in data}:
		return [ALL_BRANCHES]
	allowed = {c["id"] for c in CRM_CATEGORIES}
	out = []
	for x in data:
		cid = cstr(x).strip().lower()
		if cid in allowed and cid not in out:
			out.append(cid)
	return out


def _crm_is_manager(perms):
	"""Settings→Manage elevates to CRM Manager. Module Manage alone stays Executive."""
	perms = perms or {}
	return cstr(perms.get("Settings") or "none").lower() == "manage"


def _reconcile_crm_manager_elevation(user, crm_perms, branches, user_roles):
	"""Keep real managers; demote executives who only got CRM Manager from module Manage.

	- Categories already ``*`` (all) + CRM Manager role → ensure Settings→Manage (stay Manager).
	- Otherwise drop CRM Manager when Settings is not Manage.
	"""
	crm_perms = dict(crm_perms or {})
	if _crm_is_manager(crm_perms):
		return crm_perms
	cats = _parse_crm_categories(branches)
	has_mgr_role = "CRM Manager" in (user_roles or [])
	if has_mgr_role and ALL_BRANCHES in cats:
		crm_perms["Settings"] = "manage"
		row = frappe.db.get_value(
			ACCESS_DT,
			{"login_user": user, "portal": "crm", "active": 1},
			["name", "permissions"],
			as_dict=True,
		)
		if row:
			try:
				data = json.loads(row.permissions or "{}")
			except ValueError:
				data = {}
			if isinstance(data, dict):
				data["Settings"] = "manage"
				frappe.db.set_value(ACCESS_DT, row.name, "permissions", json.dumps(data), update_modified=False)
				frappe.cache().hdel(PERM_CACHE, user)
		_sync_user_roles(user, _needed_roles(user) | {"CRM Manager"})
		return crm_perms
	# Executive with leftover CRM Manager from module Manage — strip the role.
	if has_mgr_role:
		needed = _needed_roles(user)
		needed.discard("CRM Manager")
		_sync_user_roles(user, needed)
	return crm_perms


def _infer_crm_categories(perms):
	"""Derive Service / Franchise from enabled mother modules."""
	inferred = []
	service_keys = (
		"Service Lead",
		"Service Followup",
		"Bookings",
		"Partner Unit Bookings",
		"Partner Bookings",
		"Contacts",
		"Accounts",
		"Deals",
		"WhatsApp Centre",
		"Dashboard",
	)
	franchise_keys = (
		"Franchise Lead",
		"Franchise Followup",
		"Franchise (FFMS/RFMS)",
		"Franchise",
		"Partner Unit Bookings",
		"WhatsApp Centre",
		"Contacts",
		"Accounts",
		"Deals",
		"Dashboard",
	)
	# Prefer explicit lead/followup modules when present.
	if any(cstr(perms.get(m) or "none") != "none" for m in ("Service Lead", "Service Followup", "Bookings")):
		inferred.append("service")
	if any(cstr(perms.get(m) or "none") != "none" for m in ("Franchise Lead", "Franchise Followup", "Franchise (FFMS/RFMS)", "Franchise")):
		inferred.append("franchise")
	if inferred:
		return inferred
	# Shared modules only (Contacts/Deals/WA) → both until HR picks.
	if any(cstr(perms.get(m) or "none") != "none" for m in service_keys + franchise_keys):
		return ["service", "franchise"]
	return []


def _checked_crm_categories(raw, perms, active):
	cats = _parse_crm_categories(raw)
	manager = _crm_is_manager(perms)
	if not manager and ALL_BRANCHES in cats:
		frappe.throw(_("Only a CRM Manager can have all categories. Give Manage on Settings, or pick Service / Franchise."))
	if active and not cats:
		inferred = _infer_crm_categories(perms)
		if manager and not inferred:
			return [ALL_BRANCHES]
		if manager and set(inferred) == {"service", "franchise"}:
			return [ALL_BRANCHES]
		if not inferred:
			frappe.throw(_("Pick at least one CRM category: Service and/or Franchise."))
		return inferred
	return cats


def crm_scope(assigned):
	"""Categories a CRM login may use: Service / Franchise, or all for managers."""
	cats = list(assigned or [])
	if ALL_BRANCHES in cats:
		return {"all": True, "ids": [c["id"] for c in CRM_CATEGORIES], "source": "assigned"}
	ids = [c for c in cats if c in {x["id"] for x in CRM_CATEGORIES}]
	return {"all": False, "ids": ids, "source": "assigned"}


def _parse_perms(raw, portal):
	modules = PORTALS[portal]["modules"]
	data = dict(raw) if isinstance(raw, dict) else {}
	if portal == "people" and data and "Dashboard" not in data:
		legacy = dict(data)
		for old, new_keys in PEOPLE_LEGACY_MODULES.items():
			if old in legacy:
				for k in new_keys:
					data[k] = legacy[old]
		data["Dashboard"] = "view"
		data.setdefault("Expenses", "view" if cstr(legacy.get("Payroll") or "none") != "none" else "none")
	if portal == "labtech" and data and not any(m in data for m in modules):
		legacy = dict(data)
		for old, new_keys in LAB_LEGACY_MODULES.items():
			for k in new_keys:
				data[k] = legacy.get(old, "none")
	if portal == "labtech" and data and "Test Master" not in data:
		# Rows saved before the Test Master module existed keep the level they have for result entry.
		data["Test Master"] = data.get("Result entry", "none")
	if portal == "labtech" and data and "Settings" not in data:
		# Settings was added after early labtech grants. Keep the page reachable;
		# Lab Manager vs view-only is enforced by the settings APIs.
		has_any = any(cstr(data.get(m) or "none").lower() != "none" for m in modules if m != "Settings")
		data["Settings"] = "view" if has_any else "none"
	if portal == "crm" and data:
		# Legacy flat names → mother modules (only when the new mother key is absent).
		legacy_leads = cstr(data.get("Leads") or "none").lower()
		legacy_acts = cstr(data.get("Activities") or "none").lower()
		if legacy_leads in LEVELS and legacy_leads != "none":
			if "Service Lead" not in data:
				data["Service Lead"] = legacy_leads
			if "Franchise Lead" not in data:
				data["Franchise Lead"] = legacy_leads
		if legacy_acts in LEVELS and legacy_acts != "none":
			if "Service Followup" not in data:
				data["Service Followup"] = legacy_acts
			if "Franchise Followup" not in data:
				data["Franchise Followup"] = legacy_acts
		if cstr(data.get("Franchise") or "none").lower() not in ("", "none"):
			data.setdefault("Franchise (FFMS/RFMS)", data.get("Franchise"))
		if cstr(data.get("Partner Bookings") or "none").lower() not in ("", "none"):
			data.setdefault("Partner Unit Bookings", data.get("Partner Bookings"))
		if cstr(data.get("Reports") or "none").lower() not in ("", "none"):
			data.setdefault("Reports & Analytics", data.get("Reports"))
		# Roll former wing-submodule rows up into the mother module.
		_crm_roll_up = {
			"Service Lead": ("Service Lead · Aesthetic", "Service Lead · Care", "Service Lead · Lab"),
			"Franchise Lead": ("Franchise Lead · Aesthetic", "Franchise Lead · Care", "Franchise Lead · Lab"),
			"Service Followup": ("Service Followup · Aesthetic", "Service Followup · Care", "Service Followup · Lab"),
			"Franchise Followup": (
				"Franchise Followup · Aesthetic",
				"Franchise Followup · Care",
				"Franchise Followup · Lab",
			),
			"WhatsApp Centre": (
				"WhatsApp · All Chats",
				"WhatsApp · Lab",
				"WhatsApp · Aesthetic",
				"WhatsApp · Care",
				"WhatsApp · NexiLab",
				"WhatsApp · Franchise",
			),
		}
		for mother, children in _crm_roll_up.items():
			cur = cstr(data.get(mother) or "none").lower()
			cur_i = LEVELS.index(cur) if cur in LEVELS else 0
			best_i = cur_i
			best = cur if cur in LEVELS else "none"
			for child in children:
				lvl = cstr(data.get(child) or "none").lower()
				if lvl in LEVELS and LEVELS.index(lvl) > best_i:
					best_i = LEVELS.index(lvl)
					best = lvl
			if best_i > 0:
				data[mother] = best
	out = {}
	for m in modules:
		level = cstr(data.get(m) or "none").lower()
		out[m] = level if level in LEVELS else "none"
	return out


def _parse_labtech_user_type(raw):
	"""Single LabTech user-type id stored in the branches JSON field."""
	vals = []
	if isinstance(raw, list):
		vals = [cstr(x).strip() for x in raw if cstr(x).strip()]
	elif isinstance(raw, str):
		text = raw.strip()
		if not text:
			vals = []
		elif text.startswith("["):
			try:
				parsed = json.loads(text)
			except ValueError:
				parsed = []
			if isinstance(parsed, list):
				vals = [cstr(x).strip() for x in parsed if cstr(x).strip()]
			elif cstr(parsed).strip():
				vals = [cstr(parsed).strip()]
		else:
			vals = [text]
	for v in vals:
		if v in LABTECH_USER_TYPE_IDS:
			return v
	return ""


def user_can_sign_lab_reports(roles=None):
	"""Lab Manager + Quality Control Manager (and system admins) may sign & finalize."""
	roles = set(roles or frappe.get_roles())
	if roles & {"Health System Admin", "System Manager", "Administrator", "Pathologist"}:
		return True
	return bool(roles & LABTECH_SIGN_ROLES)


def _checked_labtech_user_type(raw, active):
	chosen = _parse_labtech_user_type(raw)
	if active and not chosen:
		frappe.throw(_("Pick a LabTech user type: Lab Manager, Quality Control Manager, Lab Technician, or Accessor."))
	return [chosen] if chosen else []


def _labtech_type_spec(type_id):
	for row in LABTECH_USER_TYPES:
		if row["id"] == type_id:
			return row
	return None


def _roles_for(portal, perms, branches=None):
	spec = PORTALS[portal]
	levels = [LEVELS.index(v) for v in perms.values() if cstr(v).lower() in LEVELS]
	if not levels or max(levels) == 0:
		return set()
	# LabTech: HR-assigned user type is the source of truth for Frappe roles.
	if portal == "labtech":
		type_id = _parse_labtech_user_type(branches) or LABTECH_DEFAULT_TYPE
		type_spec = _labtech_type_spec(type_id) or _labtech_type_spec(LABTECH_DEFAULT_TYPE)
		roles = set(type_spec.get("roles") or spec["roles"])
		return {r for r in roles if frappe.db.exists("Role", r)}
	roles = set(spec["roles"])
	top = max(levels)
	org_view = any(perms.get(m, "none") != "none" for m in spec.get("org_modules", ()))
	if top >= LEVELS.index("approve") or org_view:
		roles.update(spec.get("approve_roles", []))
	manage_modules = spec.get("manage_modules")
	if manage_modules:
		if any(perms.get(m) == "manage" for m in manage_modules):
			roles.update(spec.get("manage_roles", []))
	elif top >= LEVELS.index("manage"):
		roles.update(spec.get("manage_roles", []))
	return {r for r in roles if frappe.db.exists("Role", r)}


def _managed_roles():
	roles = set()
	for spec in PORTALS.values():
		roles.update(spec["roles"])
		roles.update(spec.get("approve_roles", []))
		roles.update(spec.get("manage_roles", []))
	return roles


def _password_problem(pwd):
	if len(pwd) < 8:
		return _("Password must be at least 8 characters")
	if not re.search(r"[A-Za-z]", pwd) or not re.search(r"\d", pwd):
		return _("Password must contain letters and numbers")
	try:
		from frappe.utils.password_strength import test_password_strength

		result = test_password_strength(pwd) or {}
		if cint(result.get("score")) < 2:
			return _("Password is too easy to guess. Use a longer mix of words, numbers and symbols")
	except Exception:
		pass
	return None


def _employee_row(employee):
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "user_id", "company_email", "personal_email", "department", "designation", "date_of_joining", "cell_number", "branch", "company"]
	for extra in ("people_wing", "people_division", "people_unit", "people_position"):
		if meta.has_field(extra):
			fields.append(extra)
	fields = [f for f in fields if f == "name" or meta.has_field(f)]
	return frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}


def _portal_catalog():
	out = []
	for key, spec in PORTALS.items():
		# CRM Manager is created on first use; base roles are enough for "available".
		base_roles = list(spec["roles"]) + list(spec.get("manage_roles", []))
		available = all(frappe.db.exists("Role", r) for r in spec["roles"]) if spec["roles"] else True
		# Treat as available once at least one portal role exists (roles are auto-created on ensure).
		if not available and any(frappe.db.exists("Role", r) for r in base_roles):
			available = True
		entry = {
			"key": key,
			"label": spec["label"],
			"url": spec["url"],
			"modules": spec["modules"],
			"available": available,
			"elevated": bool(set(spec["roles"] + list(spec.get("manage_roles", []))) & ELEVATED_ROLES),
			"org_modules": sorted(spec.get("org_modules", ())),
			"defaults": {m: ("view" if m in PEOPLE_SELF_SERVICE_DEFAULT else "none") for m in spec["modules"]}
			if key == "people"
			else {m: "view" for m in spec["modules"]},
		}
		if spec.get("category_options"):
			entry["category_options"] = list(spec["category_options"])
			entry["role_labels"] = {
				"staff": "Executive",
				"manager": "Manager",
				"hint": "Manager = Manage on any module (sees all activity in selected modules). Executive = only assigned modules and categories.",
			}
		if spec.get("user_types"):
			entry["user_types"] = list(spec["user_types"])
			entry["role_labels"] = {
				"hint": "Pick one LabTech user type. Only Lab Manager and Quality Control Manager can sign & finalize reports.",
			}
		if spec.get("module_meta"):
			entry["module_meta"] = dict(spec["module_meta"])
		out.append(entry)
	return out


def access_state(employee):
	_ensure_doctypes()
	emp = _employee_row(employee)
	rows = frappe.get_all(ACCESS_DT, filters={"employee": employee}, fields=["name", "portal", "login_user", "permissions", "active", "granted_by", "granted_on", "branches"])
	access = []
	for r in rows:
		if r.portal not in PORTALS:
			continue
		user = frappe.db.get_value("User", r.login_user, ["enabled", "last_login"], as_dict=True) if r.login_user else None
		try:
			perms = json.loads(r.permissions or "{}")
		except ValueError:
			perms = {}
		access.append(
			{
				"portal": r.portal,
				"login_id": r.login_user or "",
				"permissions": _parse_perms(perms, r.portal),
				"active": cint(r.active),
				"login_enabled": cint(user.enabled) if user else 0,
				"last_login": cstr(user.last_login) if user and user.last_login else "",
				"granted_by": r.granted_by or "",
				"granted_on": cstr(r.granted_on or ""),
				"branches": (
					_parse_crm_categories(r.branches)
					if r.portal == "crm"
					else (
						([_parse_labtech_user_type(r.branches)] if _parse_labtech_user_type(r.branches) else [])
						if r.portal == "labtech"
						else _parse_branches(r.branches)
					)
				),
				"labtech_user_type": _parse_labtech_user_type(r.branches) if r.portal == "labtech" else None,
			}
		)
	scope = care_scope(employee, [])
	aes = aes_scope(employee, [])
	return {
		"employee": employee,
		"employee_name": emp.get("employee_name") or employee,
		"default_login": emp.get("user_id") or emp.get("company_email") or emp.get("personal_email") or "",
		"portals": _portal_catalog(),
		"levels": [{"value": v, "label": LEVEL_LABEL[v]} for v in LEVELS],
		"access": access,
		"care_branches": care_branches(),
		"aes_branches": aes_branches(),
		"crm_categories": list(CRM_CATEGORIES),
		"unit": scope["unit"],
		"unit_branch": scope["unit_branch"],
		"aes_unit_branch": aes["unit_branch"],
	}


def _resolve_login(employee, login_id, roles):
	login_id = cstr(login_id).strip().lower()
	if not login_id:
		frappe.throw(_("Login ID is required"))
	user = frappe.db.get_value("User", {"name": login_id}) or frappe.db.get_value("User", {"username": login_id}) or frappe.db.get_value("User", {"email": login_id})
	if user:
		if user in ("Administrator", "Guest"):
			frappe.throw(_("This login cannot be used"))
		if FORBIDDEN_ROLES & set(frappe.get_roles(user)) and "System Manager" not in roles:
			frappe.throw(_("{0} is an admin login and can only be changed by a System Manager").format(user))
		owner = frappe.db.get_value("Employee", {"user_id": user}, "name")
		if owner and owner != employee:
			frappe.throw(_("{0} is already the login of another employee ({1})").format(user, owner))
		return user, False
	from frappe.utils import validate_email_address

	if not validate_email_address(login_id):
		frappe.throw(_("A new login ID must be a valid email address"))
	return login_id, True


def save_access(employee, entries, roles):
	_ensure_doctypes()
	_ensure_portal_roles()
	if not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	emp = _employee_row(employee)
	can_grant = _caller_can_grant(roles)
	wanted = {}
	for item in entries or []:
		portal = cstr(item.get("portal"))
		if portal not in PORTALS:
			continue
		wanted[portal] = item

	existing = {r.portal: r for r in frappe.get_all(ACCESS_DT, filters={"employee": employee}, fields=["name", "portal", "login_user", "permissions", "active"])}
	touched_users = set(r.login_user for r in existing.values() if r.login_user)
	before = {u: _needed_roles(u) for u in touched_users}
	results = []

	for portal, item in wanted.items():
		spec = PORTALS[portal]
		missing = [r for r in spec["roles"] if not frappe.db.exists("Role", r)]
		if missing:
			# Create any newly introduced portal roles (e.g. CRM Executive) instead of blocking save.
			_ensure_portal_roles()
			missing = [r for r in spec["roles"] if not frappe.db.exists("Role", r)]
		if missing:
			frappe.throw(_("{0} is not available on this server (missing roles: {1})").format(spec["label"], ", ".join(missing)))
		perms = _parse_perms(item.get("permissions") or {}, portal)
		active = 1 if cint(item.get("active", 1)) else 0
		labtech_branches = None
		if portal == "labtech":
			labtech_branches = _checked_labtech_user_type(item.get("branches") or item.get("labtech_user_type"), active)
		new_roles = _roles_for(portal, perms, labtech_branches if portal == "labtech" else item.get("branches")) if active else set()
		if new_roles & FORBIDDEN_ROLES:
			frappe.throw(_("That access level is not allowed"))
		if (new_roles & ELEVATED_ROLES) and not can_grant:
			prev = existing.get(portal)
			prev_branches = None
			if prev and portal == "labtech":
				prev_row = frappe.db.get_value(ACCESS_DT, prev.name, "branches")
				prev_branches = _parse_labtech_user_type(prev_row)
				prev_branches = [prev_branches] if prev_branches else []
			prev_roles = (
				_roles_for(portal, _parse_perms(json.loads(prev.permissions or "{}"), portal), prev_branches)
				if prev
				else set()
			)
			if (new_roles & ELEVATED_ROLES) - prev_roles:
				frappe.throw(_("Only an HR Manager or System Manager can grant {0} access").format(", ".join(sorted(new_roles & ELEVATED_ROLES))))
		user, is_new = _resolve_login(employee, item.get("login_id") or emp.get("user_id") or emp.get("company_email"), roles)
		password = cstr(item.get("password") or "")
		if is_new and not password:
			frappe.throw(_("Set a password for the new login {0}").format(user))
		if password:
			problem = _password_problem(password)
			if problem:
				frappe.throw(_("{0}: {1}").format(spec["label"], problem))
		if is_new:
			first, _sep, last = cstr(emp.get("employee_name") or user).partition(" ")
			frappe.get_doc(
				{
					"doctype": "User",
					"email": user,
					"first_name": first or user,
					"last_name": last,
					"send_welcome_email": 0,
					"enabled": 1,
				}
			).insert(ignore_permissions=True)
		elif not cint(frappe.db.get_value("User", user, "enabled")) and active:
			frappe.db.set_value("User", user, "enabled", 1)
		if user not in before:
			before[user] = _needed_roles(user)
		if password:
			from frappe.utils.password import update_password

			update_password(user, password, logout_all_sessions=not is_new and user != frappe.session.user)
		if portal == "people" and active and emp.get("user_id") != user:
			# The People login is how the portal finds this employee's own profile.
			frappe.db.set_value("Employee", employee, "user_id", user, update_modified=True)
			emp["user_id"] = user
		values = {
			"employee": employee,
			"portal": portal,
			"login_user": user,
			"permissions": json.dumps(perms),
			"active": active,
			"granted_by": frappe.session.user,
			"granted_on": now_datetime(),
		}
		if portal == "care":
			values["branches"] = json.dumps(_checked_care_branches(employee, item.get("branches"), new_roles, active))
		if portal == "aesthetics":
			values["branches"] = json.dumps(_checked_aes_branches(employee, item.get("branches"), perms, active))
		if portal == "crm":
			values["branches"] = json.dumps(_checked_crm_categories(item.get("branches"), perms, active))
		if portal == "labtech":
			values["branches"] = json.dumps(labtech_branches or [])
		if portal in existing:
			old_user = existing[portal].login_user
			frappe.db.set_value(ACCESS_DT, existing[portal].name, values, update_modified=True)
			if old_user:
				touched_users.add(old_user)
		else:
			frappe.get_doc({"doctype": ACCESS_DT, **values}).insert(ignore_permissions=True)
		touched_users.add(user)
		if active:
			# HR-issued logins are staff, so the patient sign-up email check must not block them.
			try:
				from health_ecosystem_core.health_ecosystem_core.clinical_email import mark_user_email_verified

				mark_user_email_verified(user)
			except Exception:
				pass
		results.append({"portal": portal, "login_id": user, "created": is_new, "password_set": bool(password)})

	for portal, row in existing.items():
		if portal not in wanted:
			# Keep rows for portal keys not in the current catalog (so a temporary
			# catalog gap cannot wipe CRM / other assignments on save).
			if portal not in PORTALS:
				continue
			frappe.delete_doc(ACCESS_DT, row.name, ignore_permissions=True, force=True)

	for user in touched_users:
		_sync_user_roles(user, before.get(user, set()))
		frappe.cache().hdel(PERM_CACHE, user)
	frappe.db.commit()
	return {"saved": results, "state": access_state(employee)}


def _needed_roles(user):
	needed = set()
	if not user:
		return needed
	for r in frappe.get_all(
		ACCESS_DT,
		filters={"login_user": user, "active": 1},
		fields=["portal", "permissions", "branches"],
	):
		if r.portal in PORTALS:
			try:
				needed |= _roles_for(
					r.portal,
					_parse_perms(json.loads(r.permissions or "{}"), r.portal),
					r.branches,
				)
			except ValueError:
				continue
	return needed


def _sync_user_roles(user, previously_needed):
	"""Add the portal roles the login now needs and remove only the ones this screen granted before
	and no longer needs. Roles given anywhere else are left alone."""
	if not user or not frappe.db.exists("User", user):
		return
	needed = _needed_roles(user)
	drop = (previously_needed - needed) & _managed_roles()
	if user == frappe.session.user:
		drop -= ELEVATED_ROLES
	if frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name"):
		drop.discard("Employee")
	doc = frappe.get_doc("User", user)
	current = {d.role for d in doc.roles}
	changed = False
	for role in sorted(needed - current):
		doc.append("roles", {"role": role})
		changed = True
	for d in list(doc.roles):
		if d.role in drop:
			doc.remove(d)
			changed = True
	if changed:
		doc.save(ignore_permissions=True)


PERM_CACHE = "people_portal_perms_v4"


def _user_portal_perms(user):
	"""{portal: {module: level}} for a login's active access rows, plus whether it is managed at all."""
	cached = frappe.cache().hget(PERM_CACHE, user)
	if cached is not None:
		return cached
	rows = frappe.get_all(ACCESS_DT, filters={"login_user": user}, fields=["portal", "permissions", "active", "employee", "branches"])
	portals, employee, care, aes, crm = {}, None, None, None, None
	for r in rows:
		if r.portal not in PORTALS:
			continue
		if r.portal == "people":
			employee = r.employee
		if r.portal == "care" and cint(r.active):
			care = {"employee": r.employee, "branches": _parse_branches(r.branches)}
		if r.portal == "aesthetics" and cint(r.active):
			aes = {"employee": r.employee, "branches": _parse_branches(r.branches)}
		if r.portal == "crm" and cint(r.active):
			crm = {"employee": r.employee, "branches": _parse_crm_categories(r.branches)}
		if not cint(r.active):
			portals[r.portal] = {m: "none" for m in PORTALS[r.portal]["modules"]}
			continue
		try:
			portals[r.portal] = _parse_perms(json.loads(r.permissions or "{}"), r.portal)
		except ValueError:
			portals[r.portal] = {m: "none" for m in PORTALS[r.portal]["modules"]}
	value = {"managed": bool(rows), "portals": portals, "employee": employee, "care": care, "aes": aes, "crm": crm}
	frappe.cache().hset(PERM_CACHE, user, value)
	return value


def _ensure_people_link(user, employee):
	"""A People login must resolve to its own employee record (never an auto-created duplicate)."""
	if not employee or not frappe.db.exists("Employee", employee):
		return
	if frappe.db.get_value("Employee", employee, "user_id") == user:
		return
	other = frappe.db.get_value("Employee", {"user_id": user, "name": ("!=", employee)}, "name")
	if other:
		return
	frappe.db.set_value("Employee", employee, "user_id", user, update_modified=True)
	frappe.db.commit()


def my_permissions():
	_ensure_doctypes()
	user = frappe.session.user
	exempt = bool({"System Manager", "Administrator"} & set(frappe.get_roles(user)))
	info = _user_portal_perms(user)
	_ensure_people_link(user, info.get("employee"))
	portals = []
	for key, perms in info["portals"].items():
		spec = PORTALS[key]
		portals.append({"key": key, "label": spec["label"], "url": spec["url"], "permissions": perms})
	portal_modules = {}
	for key, perms in info["portals"].items():
		paths = PORTALS[key].get("module_paths", {})
		portal_modules[key] = {m: {"level": level, "paths": paths.get(m, [])} for m, level in perms.items()}
	user_doc = frappe.db.get_value("User", user, ["full_name", "user_image"], as_dict=True) or {}
	care = info.get("care")
	aes = info.get("aes")
	crm = info.get("crm")
	emp = info.get("employee") or (aes and aes.get("employee")) or (care and care.get("employee")) or (crm and crm.get("employee"))
	if not emp:
		emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if not aes and emp:
		aes = {"employee": emp, "branches": []}
	photo = cstr(user_doc.get("user_image") or "").strip()
	# Gravatar d=404 is a deliberate miss — treat as empty so Employee photo can win.
	if photo and "gravatar.com" in photo.lower() and "d=404" in photo.lower():
		photo = ""
	if not photo and emp and frappe.db.exists("Employee", emp):
		try:
			photo = cstr(frappe.db.get_value("Employee", emp, "image") or "").strip()
		except Exception:
			photo = ""
		# Keep User.user_image in sync so every portal sees the HR photo.
		if photo and user not in (None, "", "Guest"):
			try:
				frappe.db.set_value("User", user, "user_image", photo, update_modified=False)
			except Exception:
				pass
	user_roles = [r for r in frappe.get_roles(user) if r not in ("All", "Guest")]
	crm_perms = (info["portals"].get("crm") or {}) if crm else {}
	if crm and user not in (None, "", "Guest") and not exempt:
		try:
			crm_perms = _reconcile_crm_manager_elevation(user, crm_perms, crm.get("branches") or [], user_roles)
			info["portals"]["crm"] = crm_perms
			user_roles = [r for r in frappe.get_roles(user) if r not in ("All", "Guest")]
		except Exception:
			pass
	settings_mgr = bool(crm and _crm_is_manager(crm_perms))
	crm_mgr = exempt or bool({"System Manager", "Administrator"} & set(user_roles)) or settings_mgr
	if crm_mgr:
		crm_categories = {"all": True, "ids": [c["id"] for c in CRM_CATEGORIES], "source": "admin" if exempt else "manager"}
	elif crm:
		crm_categories = crm_scope(crm.get("branches") or [])
		if settings_mgr and (not crm_categories["ids"] or crm_categories["all"]):
			crm_categories = {"all": True, "ids": [c["id"] for c in CRM_CATEGORIES], "source": "manager"}
	else:
		crm_categories = None
	return {
		"user": user,
		"full_name": user_doc.get("full_name") or user,
		"user_image": photo,
		"roles": user_roles,
		"exempt": exempt,
		"managed": bool(info["managed"]) and not exempt,
		"portals": portals,
		"portal_modules": portal_modules,
		"people_modules": portal_modules.get("people", {}),
		"always_paths": ["/people/profile"],
		"care_branches": {"all": True, "ids": [], "source": "admin"} if exempt else (care_scope(care["employee"], care["branches"]) if care else None),
		"aes_branches": {"all": True, "ids": [], "source": "admin"} if exempt else (aes_scope(aes["employee"], aes["branches"]) if aes else None),
		"crm_categories": crm_categories,
		# Manager = admin / Settings→Manage only — not module-level Manage or stale CRM Manager role.
		"crm_role": "Manager" if crm_mgr else ("Executive" if crm else None),
	}


# ---------------------------------------------------------------- server-side module enforcement

# API method -> (People module, minimum level). Methods not listed are not module-gated.
METHOD_RULES = {
	"list_people_employees": ("Employees", "view"),
	"get_people_employee_detail": ("Employees", "view"),
	"create_people_employee": ("Employees", "create"),
	"update_people_employee_detail": ("Employees", "edit"),
	"assign_people_employee_org": ("Employees", "edit"),
	"delete_people_employees": ("Employees", "manage"),
	"save_people_org_master": ("WDD", "edit"),
	"delete_people_org_master": ("WDD", "manage"),
	"get_people_attendance_register": ("Attendance", "view"),
	"submit_employee_checkin": ("Attendance", "create"),
	"list_people_leave": ("Leave", "view"),
	"submit_leave_application": ("Leave", "create"),
	"create_people_leave_request": ("Leave", "create"),
	"act_people_leave": ("Leave", "approve"),
	"upload_people_leave_attachment": ("Leave", "create"),
	"get_people_leave_attachments": ("Leave", "view"),
	"open_people_leave_attachment": ("Leave", "view"),
	"get_people_payroll_register": ("Payroll", "view"),
	"get_people_payroll_workflow": ("Payroll", "view"),
	"create_people_payroll_entry": ("Payroll", "manage"),
	"process_people_payroll": ("Payroll", "approve"),
	"submit_people_payroll": ("Payroll", "approve"),
	"approve_people_payroll": ("Payroll", "approve"),
	"get_people_salary_slip": ("Payroll", "edit"),
	"update_people_salary_slip": ("Payroll", "edit"),
	"get_people_salary_structures": ("Payroll", "edit"),
	"assign_people_salary_structure": ("Payroll", "manage"),
	"submit_expense_claim": ("Expenses", "create"),
	"attach_expense_receipt": ("Expenses", "create"),
	"get_people_performance": ("Performance", "view"),
	"save_people_performance_review": ("Performance", "edit"),
	"submit_appraisal_self_review": ("Performance", "create"),
	"list_job_applications": ("Recruitment", "view"),
	"get_job_application": ("Recruitment", "view"),
	"list_hire_jobs": ("Recruitment", "view"),
	"save_hire_job": ("Recruitment", "create"),
	"schedule_interview": ("Recruitment", "edit"),
	"update_interview_status": ("Recruitment", "edit"),
	"create_job_offer": ("Recruitment", "approve"),
	"send_job_offer_email": ("Recruitment", "approve"),
	"get_job_offer_email": ("Recruitment", "view"),
	"hire_applicant_to_people": ("Recruitment", "approve"),
	"save_people_manpower_request": ("Recruitment", "create"),
	"update_people_manpower_request": ("Recruitment", "approve"),
	"get_people_onboarding": ("Onboarding", "view"),
	"list_employee_checklists": ("Onboarding", "view"),
	"start_employee_checklist": ("Onboarding", "create"),
	"start_applicant_onboarding": ("Onboarding", "create"),
	"start_employee_separation": ("Onboarding", "manage"),
	"get_people_training": ("Training", "view"),
	"save_people_training_category": ("Training", "create"),
	"save_people_training_material": ("Training", "create"),
	"save_people_training_plan": ("Training", "create"),
	"assign_people_training": ("Training", "edit"),
	"update_people_training_assignment": ("Training", "edit"),
	"submit_training_feedback": ("Training", "create"),
	"get_people_career": ("Career", "view"),
	"get_people_documents": ("Documents", "view"),
	"save_people_document": ("Documents", "create"),
	"save_people_document_folder": ("Documents", "create"),
	"update_people_document": ("Documents", "edit"),
	"save_people_document_request": ("Documents", "create"),
	"update_people_document_request": ("Documents", "approve"),
	"generate_people_letter": ("Documents", "create"),
	"get_people_policies": ("Policies", "view"),
	"save_people_policy": ("Policies", "create"),
	"save_people_policy_category": ("Policies", "create"),
	"update_people_policy": ("Policies", "edit"),
	"get_people_assets": ("Assets", "view"),
	"save_people_asset": ("Assets", "create"),
	"save_people_asset_category": ("Assets", "create"),
	"update_people_asset": ("Assets", "edit"),
	"save_people_asset_request": ("Assets", "create"),
	"update_people_asset_request": ("Assets", "approve"),
	"get_employee_asset_options": ("Assets", "edit"),
	"save_employee_assets": ("Assets", "edit"),
	"get_asset_inventory": ("Assets", "view"),
	"save_inventory_asset": ("Assets", "create"),
	"update_inventory_assets": ("Assets", "edit"),
	"delete_inventory_assets": ("Assets", "manage"),
	"decide_asset_request": ("Assets", "view"),
	"get_announcement_desk": ("Announcements", "view"),
	"save_announcement": ("Announcements", "create"),
	"get_people_announcements": ("Announcements", "view"),
	"save_people_announcement": ("Announcements", "create"),
	"update_people_announcement": ("Announcements", "edit"),
	"get_people_calendar": ("Calendar", "view"),
	"save_people_calendar_event": ("Calendar", "create"),
	"update_people_calendar_event": ("Calendar", "edit"),
	"get_people_reports": ("Reports", "view"),
	"get_people_analytics": ("Analytics", "view"),
	"export_people_analytics": ("Analytics", "view"),
	"get_people_geofences": ("Geofencing", "view"),
	"geocode_people_geofence_address": ("Geofencing", "view"),
	"save_people_geofence": ("Geofencing", "create"),
	"assign_people_geofence": ("Geofencing", "edit"),
	"save_employee_geofence": ("Geofencing", "edit"),
	"set_employee_geofence_override": ("Geofencing", "edit"),
	"seed_employee_geofences": ("Geofencing", "manage"),
	"get_people_roles": ("Roles & Permissions", "view"),
	"export_people_roles": ("Roles & Permissions", "view"),
	"save_people_role": ("Roles & Permissions", "manage"),
	"get_employee_portal_access": ("Roles & Permissions", "view"),
	"save_employee_portal_access": ("Roles & Permissions", "manage"),
}


def _request_user():
	user = frappe.session.user if getattr(frappe.local, "session", None) else "Guest"
	if user and user != "Guest":
		return user
	try:
		from health_ecosystem_core.health_ecosystem_core.api import _ensure_mobile_session

		return _ensure_mobile_session() or "Guest"
	except Exception:
		return "Guest"


def enforce_portal_permissions():
	"""before_request hook: block People API calls for modules the login is not permitted to use."""
	request = getattr(frappe.local, "request", None)
	if not request or not request.path.startswith("/api/method/"):
		return
	method = request.path.rsplit("/", 1)[-1].rsplit(".", 1)[-1]
	rule = METHOD_RULES.get(method)
	if not rule:
		return
	user = _request_user()
	if not user or user in ("Guest", "Administrator"):
		return
	if not frappe.db.exists("DocType", ACCESS_DT):
		return
	info = _user_portal_perms(user)
	if not info["managed"] or "people" not in info["portals"]:
		return
	if {"System Manager", "Administrator"} & set(frappe.get_roles(user)):
		return
	module, needed = rule
	have = info["portals"]["people"].get(module, "none")
	if LEVELS.index(have) < LEVELS.index(needed):
		frappe.throw(
			_("You do not have {0} access to {1}. Ask HR to update your portal permissions.").format(LEVEL_LABEL[needed], module),
			frappe.PermissionError,
		)


# ---------------------------------------------------------------- assets + agreements


def _asset_dt():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import ASSET_DT, ensure_people_asset_doctypes

	ensure_people_asset_doctypes()
	return ASSET_DT


def asset_options(employee):
	dt = _asset_dt()
	fields = ["name", "title", "category", "serial", "status", "location", "assigned_employee", "employee_name", "assign_date", "notes"]
	rows = frappe.get_all(dt, filters={"status": ("in", ["Available", "Assigned"])}, fields=fields, order_by="title asc", limit_page_length=2000)
	out = []
	for r in rows:
		mine = r.assigned_employee == employee
		if r.status == "Assigned" and not mine:
			continue
		out.append(
			{
				"id": r.name,
				"title": r.title,
				"category": r.category or "",
				"serial": r.serial or "",
				"location": r.location or "",
				"status": r.status,
				"assigned": 1 if mine else 0,
				"assign_date": cstr(r.assign_date or ""),
			}
		)
	return {"employee": employee, "assets": out, "agreements": list_agreements(employee)}


def save_assets(employee, asset_ids, roles):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import update_people_asset

	dt = _asset_dt()
	emp = _employee_row(employee)
	if not emp:
		frappe.throw(_("Employee not found"))
	wanted = [cstr(a) for a in asset_ids or [] if cstr(a)]
	current = set(frappe.get_all(dt, filters={"assigned_employee": employee, "status": "Assigned"}, pluck="name"))
	added, removed = [], []
	payload = {
		"id": employee,
		"name": emp.get("employee_name") or employee,
		"employee_id": employee,
		"department": emp.get("department") or "",
		"assign_date": today(),
	}
	for asset in wanted:
		if asset in current:
			continue
		status = frappe.db.get_value(dt, asset, "status")
		if status != "Available":
			frappe.throw(_("Asset {0} is not available").format(frappe.db.get_value(dt, asset, "title") or asset))
		update_people_asset(roles, asset, action="assign", employee=payload)
		added.append(asset)
	for asset in current - set(wanted):
		update_people_asset(roles, asset, action="collect")
		removed.append(asset)
	agreement = None
	if added:
		agreement = create_agreement(employee, added)
	frappe.db.commit()
	return {"added": added, "removed": removed, "agreement": agreement, "options": asset_options(employee)}


def _asset_snapshot(asset_ids):
	dt = _asset_dt()
	wanted = ["name", "title", "category", "serial", "location", "assign_date", "notes", "brand", "model", "vendor", "warranty_until", "purchase_cost", "condition", "expected_return"]
	meta = frappe.get_meta(dt)
	fields = [name for name in wanted if name == "name" or meta.has_field(name)]
	rows = frappe.get_all(dt, filters={"name": ("in", list(asset_ids))}, fields=fields, order_by="title asc")
	return [
		{
			"id": r.name,
			"title": r.title,
			"category": r.category or "",
			"brand": getattr(r, "brand", "") or "",
			"model": getattr(r, "model", "") or "",
			"vendor": getattr(r, "vendor", "") or "",
			"serial": r.serial or "",
			"location": r.location or "",
			"assign_date": cstr(r.assign_date or today()),
			"expected_return": cstr(getattr(r, "expected_return", "") or ""),
			"warranty_until": cstr(getattr(r, "warranty_until", "") or ""),
			"purchase_cost": getattr(r, "purchase_cost", 0) or 0,
			"condition": getattr(r, "condition", "") or "",
			"notes": r.notes or "",
		}
		for r in rows
	]


def create_agreement(employee, asset_ids):
	_ensure_doctypes()
	emp = _employee_row(employee)
	doc = frappe.get_doc(
		{
			"doctype": AGREEMENT_DT,
			"employee": employee,
			"employee_name": emp.get("employee_name") or employee,
			"status": "Pending Signatures",
			"assets": json.dumps(_asset_snapshot(asset_ids)),
			"issued_on": today(),
		}
	).insert(ignore_permissions=True)
	_render_and_store(doc)
	return _agreement_row(doc)


def _agreement_row(doc):
	try:
		assets = json.loads(doc.assets or "[]")
	except ValueError:
		assets = []
	return {
		"id": doc.name,
		"employee": doc.employee,
		"employee_name": doc.employee_name,
		"status": doc.status,
		"issued_on": cstr(doc.issued_on or ""),
		"assets": assets,
		"hr_signed": bool(doc.hr_signature),
		"hr_signer": doc.hr_signer or "",
		"hr_signed_on": cstr(doc.hr_signed_on or ""),
		"employee_signed": bool(doc.employee_signature),
		"employee_signer": doc.employee_signer or "",
		"employee_signed_on": cstr(doc.employee_signed_on or ""),
		"people_document": doc.people_document or "",
	}


def list_agreements(employee):
	_ensure_doctypes()
	names = frappe.get_all(AGREEMENT_DT, filters={"employee": employee}, pluck="name", order_by="creation desc", limit_page_length=50)
	return [_agreement_row(frappe.get_doc(AGREEMENT_DT, n)) for n in names]


def _agreement_html(doc):
	emp = _employee_row(doc.employee)
	try:
		assets = json.loads(doc.assets or "[]")
	except ValueError:
		assets = []
	e = escape_html

	def row(label, value):
		value = cstr(value).strip()
		return f"<tr><th>{e(label)}</th><td>{e(value) if value else '&mdash;'}</td></tr>"

	dept = cstr(emp.get("department") or "")
	if " — " in dept:
		dept = dept.split(" — ")[-1]
	dept = re.sub(r"\s+-\s+[A-Z0-9]{2,8}$", "", dept)
	emp_rows = "".join(
		[
			row("Employee name", emp.get("employee_name")),
			row("Employee ID", emp.get("name")),
			row("Designation", emp.get("people_position") or emp.get("designation")),
			row("Department", dept),
			row("Wing / Division", " / ".join(p for p in (cstr(emp.get("people_wing")), cstr(emp.get("people_division"))) if p)),
			row("Unit / Centre", emp.get("people_unit") or emp.get("branch")),
			row("Email", emp.get("company_email") or emp.get("user_id") or emp.get("personal_email")),
			row("Mobile", emp.get("cell_number")),
			row("Date of joining", format_date(emp.get("date_of_joining")) if emp.get("date_of_joining") else ""),
		]
	)
	def asset_extra(a):
		bits = []
		product = " ".join(p for p in (cstr(a.get("brand")), cstr(a.get("model"))) if p).strip()
		if product:
			bits.append(product)
		if a.get("condition"):
			bits.append(f"Condition: {a.get('condition')}")
		if a.get("expected_return"):
			bits.append(f"Return by {format_date(a.get('expected_return'))}")
		if a.get("warranty_until"):
			bits.append(f"Warranty {format_date(a.get('warranty_until'))}")
		if a.get("notes"):
			bits.append(cstr(a.get("notes")))
		return f"<br><small>{e(' · '.join(bits))}</small>" if bits else ""

	asset_rows = "".join(
		f"<tr><td>{i}</td><td><b>{e(a.get('title'))}</b>{asset_extra(a)}</td>"
		f"<td>{e(a.get('category'))}</td><td class='mono'>{e(a.get('id'))}</td><td class='mono'>{e(a.get('serial') or '—')}</td>"
		f"<td>{e(a.get('location') or '—')}</td><td>{e(format_date(a.get('assign_date')) if a.get('assign_date') else '')}</td></tr>"
		for i, a in enumerate(assets, 1)
	)

	def sign_box(title, name, signature="", signed_on=""):
		img = ""
		sig = cstr(signature)
		if sig.startswith("data:image/") and "base64," in sig and len(sig) < 400000:
			img = f'<img src="{sig}" alt="signature">'
		when = format_date(signed_on) if signed_on else ""
		date_line = f"Date: <b>{e(when)}</b>" if when else "Date: ____ / ____ / ________"
		return (
			f"<div class='sign'><div class='sign-title'>{e(title)}</div><div class='sign-pad'>{img}</div>"
			f"<div class='sign-line'></div><div class='sign-meta'><span>Name: <b>{e(name or '')}</b></span>"
			f"<span>{date_line}</span></div></div>"
		)

	terms = [
		"The assets listed above are the property of Smilecure Lifestyle Pvt Ltd and are issued to the employee solely for official work.",
		"The employee will use the assets with reasonable care, keep them secure, and not lend, sell, pledge or modify them without written approval.",
		"Any loss, theft or damage must be reported to HR and the reporting manager immediately, and in writing within 24 hours.",
		"Loss or damage caused by negligence or misuse may be recovered from the employee as per company policy and applicable law.",
		"Software, data and accounts on the assets remain confidential company property and are subject to the company IT and data policies.",
		"The company may inspect, audit, recall or replace any asset at any time.",
		"All assets, accessories and data must be returned in working condition on resignation, termination, transfer, or on request.",
		"Full and final settlement may be withheld until all assets are returned or recovered.",
	]
	terms_html = "".join(f"<li>{e(t)}</li>" for t in terms)
	return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 16mm 14mm 18mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'DejaVu Sans', Arial, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.45; }}
.top {{ border-bottom: 3px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; display: table; width: 100%; }}
.top div {{ display: table-cell; vertical-align: bottom; }}
.brand b {{ font-size: 15pt; color: #0f766e; }} .brand small {{ display: block; color: #64748b; font-size: 8.5pt; }}
.ref {{ text-align: right; font-size: 8.5pt; color: #475569; }}
h1 {{ font-size: 14pt; margin: 4px 0 2px; letter-spacing: .02em; }}
.sub {{ color: #64748b; font-size: 9pt; margin: 0 0 12px; }}
h2 {{ font-size: 10.5pt; text-transform: uppercase; letter-spacing: .06em; color: #0f766e; margin: 16px 0 6px; }}
table {{ width: 100%; border-collapse: collapse; }}
.kv th {{ width: 32%; text-align: left; font-weight: 600; color: #475569; background: #f1f7f7; }}
.kv th, .kv td {{ border: 1px solid #dbe5ea; padding: 5px 8px; font-size: 9.5pt; }}
.assets th {{ background: #0f766e; color: #fff; font-size: 8.5pt; text-align: left; padding: 6px; }}
.assets td {{ border-bottom: 1px solid #e2e8f0; padding: 6px; font-size: 9pt; vertical-align: top; }}
.assets small {{ color: #64748b; }}
.mono {{ font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; }}
ol {{ margin: 0; padding-left: 18px; }} ol li {{ margin: 0 0 4px; font-size: 9.3pt; }}
.ack {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 9.5pt; margin-top: 10px; }}
.signs {{ display: table; width: 100%; margin-top: 18px; page-break-inside: avoid; }}
.sign {{ display: table-cell; width: 50%; padding-right: 14px; }}
.sign + .sign {{ padding-right: 0; padding-left: 14px; }}
.sign-title {{ font-weight: 700; font-size: 9.5pt; text-transform: uppercase; color: #0f766e; }}
.sign-pad {{ height: 70px; margin-top: 6px; }}
.sign-pad img {{ max-height: 68px; max-width: 100%; }}
.sign-line {{ border-top: 1px solid #0f172a; margin-top: 2px; }}
.sign-meta {{ font-size: 9pt; margin-top: 4px; }} .sign-meta span {{ display: block; }}
.foot {{ margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 7.8pt; color: #64748b; }}
</style></head><body>
<div class="top"><div class="brand"><b>{e(COMPANY)}</b><small>People HRMS · Asset Management</small></div>
<div class="ref">Ref: <b>{e(doc.name)}</b><br>Issued: <b>{e(format_date(doc.issued_on))}</b></div></div>
<h1>Asset Assignment &amp; Acknowledgement Form</h1>
<p class="sub">This form records company assets issued to the employee named below.</p>
<h2>Employee details</h2><table class="kv">{emp_rows}</table>
<h2>Assigned assets</h2>
<table class="assets"><thead><tr><th>#</th><th>Asset</th><th>Category</th><th>Asset ID</th><th>Serial number</th><th>Location</th><th>Assigned on</th></tr></thead><tbody>{asset_rows}</tbody></table>
<h2>Terms &amp; conditions</h2><ol>{terms_html}</ol>
<div class="ack"><b>Acknowledgement.</b> I confirm that I have received the assets listed above in good working condition, that I have read and understood the terms above, and that I agree to follow them.</div>
<div class="signs">{sign_box("Employee signature", doc.employee_signer or emp.get("employee_name"), doc.employee_signature, doc.employee_signed_on)}{sign_box("HR Manager signature", doc.hr_signer, doc.hr_signature, doc.hr_signed_on)}</div>
<div class="foot">Document {e(doc.name)} · Generated {e(cstr(now_datetime())[:16])} · Smilecure Lifestyle Pvt Ltd · Official asset assignment record.</div>
</body></html>"""


def _render_and_store(doc):
	from frappe.utils.pdf import get_pdf

	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import DOC_DT, ensure_people_documents_doctypes

	pdf = get_pdf(_agreement_html(doc), {"page-size": "A4", "encoding": "UTF-8"})
	ensure_people_documents_doctypes()
	title = f"Asset Assignment — {doc.employee_name} ({doc.name})"
	if doc.people_document and frappe.db.exists(DOC_DT, doc.people_document):
		people_doc = frappe.get_doc(DOC_DT, doc.people_document)
	else:
		emp = _employee_row(doc.employee)
		people_doc = frappe.get_doc(
			{
				"doctype": DOC_DT,
				"title": title[:180],
				"file_type": "PDF",
				"folder": "Asset Assignments",
				"scope": "Employee",
				"applicable": "Employee",
				"employee": doc.employee,
				"employee_name": doc.employee_name,
				"department": emp.get("department"),
				"status": "Active",
				"uploaded_on": today(),
				"uploaded_by": frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user,
				"is_template": 0,
			}
		).insert(ignore_permissions=True)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"asset-assignment-{doc.name}-{cstr(doc.status).lower().replace(' ', '-')}.pdf",
			"content": pdf,
			"is_private": 1,
			"attached_to_doctype": DOC_DT,
			"attached_to_name": people_doc.name,
		}
	).insert(ignore_permissions=True)
	people_doc.file_url = file_doc.file_url
	people_doc.title = title[:180]
	people_doc.save(ignore_permissions=True)
	frappe.db.set_value(AGREEMENT_DT, doc.name, {"people_document": people_doc.name, "file_url": file_doc.file_url}, update_modified=False)
	doc.people_document = people_doc.name
	doc.file_url = file_doc.file_url


def sign_agreement(agreement, party, signature, roles):
	_ensure_doctypes()
	if not agreement or not frappe.db.exists(AGREEMENT_DT, agreement):
		frappe.throw(_("Agreement not found"))
	party = cstr(party).strip().lower()
	if party not in ("hr", "employee"):
		frappe.throw(_("Choose who is signing"))
	sig = cstr(signature).strip()
	if not sig.startswith("data:image/") or "base64," not in sig:
		frappe.throw(_("Draw a signature first"))
	if len(sig) > 350000:
		frappe.throw(_("Signature image is too large"))
	doc = frappe.get_doc(AGREEMENT_DT, agreement)
	own = frappe.db.get_value("Employee", doc.employee, "user_id") == frappe.session.user
	if party == "hr":
		if not _is_manager(roles):
			frappe.throw(_("HR manager access required"), frappe.PermissionError)
		doc.hr_signature = sig
		doc.hr_signer = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
		doc.hr_signed_by = frappe.session.user
		doc.hr_signed_on = now_datetime()
	else:
		if not own and not _is_manager(roles):
			frappe.throw(_("Not allowed"), frappe.PermissionError)
		doc.employee_signature = sig
		doc.employee_signer = doc.employee_name
		doc.employee_signed_on = now_datetime()
	if doc.hr_signature and doc.employee_signature:
		doc.status = "Signed"
	elif doc.hr_signature:
		doc.status = "Pending Employee"
	elif doc.employee_signature:
		doc.status = "Pending HR"
	else:
		doc.status = "Pending Signatures"
	doc.save(ignore_permissions=True)
	_render_and_store(doc)
	return _agreement_row(doc)


def agreement_pdf(agreement, roles):
	if not agreement or not frappe.db.exists(AGREEMENT_DT, agreement):
		frappe.throw(_("Agreement not found"))
	doc = frappe.get_doc(AGREEMENT_DT, agreement)
	own = frappe.db.get_value("Employee", doc.employee, "user_id") == frappe.session.user
	if not own and not _is_manager(roles):
		frappe.throw(_("Not allowed"), frappe.PermissionError)
	if doc.hr_signature or doc.employee_signature or not doc.file_url:
		_render_and_store(doc)
	file_name = frappe.db.get_value("File", {"file_url": doc.file_url}, "name")
	content = frappe.get_doc("File", file_name).get_content()
	if isinstance(content, str):
		content = content.encode()
	return {"file_name": f"asset-assignment-{doc.name}.pdf", "data": base64.b64encode(content).decode(), "agreement": _agreement_row(doc)}


def my_agreements():
	_ensure_doctypes()
	employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	if not employee:
		return {"employee": None, "agreements": []}
	return {"employee": employee, "agreements": list_agreements(employee)}


# ---------------------------------------------------------------- whitelisted API


def _run(fn, *args):
	_error, _parse, _require, _success, _roles = _api()
	try:
		return _success(fn(*args))
	except frappe.PermissionError as exc:
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="people_access", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _arg(name, value):
	return _api()[1](name, value)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_employee_portal_access(employee=None, sid=None):
	_heal_crm_catalog_if_stale()
	denied, _roles = _guard(sid)
	if denied:
		return denied
	return _run(access_state, cstr(_arg("employee", employee)))


def _heal_crm_catalog_if_stale():
	"""If a deploy/restart restored an old site-packages copy, reload mother-module catalog."""
	try:
		if "WhatsApp Centre" in CRM_MODULE_PATHS and "Service Lead" in CRM_MODULE_PATHS and callable(globals().get("_checked_crm_categories")):
			return False
	except Exception:
		pass
	import importlib.util
	import os
	import sys

	candidates = [
		"/home/frappe/frappe-bench/crm_clinical_people_access.GOOD.py",
		"/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_people_access.py",
	]
	for path in candidates:
		if not os.path.isfile(path):
			continue
		try:
			with open(path, encoding="utf-8") as fh:
				text = fh.read()
			if "WhatsApp Centre" not in text or "Service Lead" not in text:
				continue
			spec = importlib.util.spec_from_file_location("_crm_people_access_good", path)
			mod = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(mod)
			# Hot-patch this module's catalog + helpers used by save/load.
			g = globals()
			for name in (
				"CRM_MODULE_PATHS",
				"CRM_CATEGORIES",
				"PORTALS",
				"PORTAL_ROLES",
				"_parse_crm_categories",
				"_checked_crm_categories",
				"_infer_crm_categories",
				"_crm_is_manager",
				"crm_scope",
				"_parse_perms",
			):
				if hasattr(mod, name):
					g[name] = getattr(mod, name)
			# Keep sys.modules entry consistent for later imports.
			sys.modules[__name__] = sys.modules.get(__name__)
			return True
		except Exception:
			continue
	return False


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_employee_portal_access(employee=None, access=None, sid=None):
	_heal_crm_catalog_if_stale()
	denied, roles = _guard(sid)
	if denied:
		return denied
	raw = _arg("access", access) or "[]"
	try:
		entries = json.loads(raw) if isinstance(raw, str) else list(raw)
	except ValueError:
		return _api()[0](_("Invalid access data"))
	return _run(save_access, cstr(_arg("employee", employee)), entries, roles)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_portal_permissions(sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _require_mobile_auth

	if not _require_mobile_auth(_arg("sid", sid)):
		return _api()[0](_("Not authenticated"), 401)
	return _run(my_permissions)


def list_crm_portal_assignees():
	"""Employees with active People → Portal Access → CRM Portal (for CRM transfer ownership)."""
	_ensure_doctypes()
	# Match portal key variants HR may have stored
	rows = frappe.get_all(
		ACCESS_DT,
		filters={"active": 1},
		fields=["employee", "login_user", "permissions", "portal"],
		limit_page_length=2000,
	)
	out = []
	seen = set()
	for r in rows:
		portal = cstr(r.get("portal") or "").strip().lower().replace(" ", "")
		if portal not in ("crm", "crmportal", "smilecurecrm"):
			continue
		emp = cstr(r.employee or "").strip()
		if not emp or emp in seen:
			continue
		seen.add(emp)
		emp_row = frappe.db.get_value(
			"Employee",
			emp,
			["employee_name", "user_id", "status", "designation"],
			as_dict=True,
		) or {}
		if emp_row.get("status") and emp_row.status != "Active":
			continue
		user = cstr(r.login_user or emp_row.get("user_id") or "").strip()
		name = cstr(emp_row.get("employee_name") or "").strip()
		if not name and user:
			name = cstr(frappe.db.get_value("User", user, "full_name") or user.split("@")[0]).strip()
		if not name:
			name = emp
		# Skip rows with no usable CRM modules (all none) when permissions are present
		try:
			raw = r.permissions or "{}"
			data = json.loads(raw) if isinstance(raw, str) else (raw or {})
			perms = _parse_perms(data, "crm")
			if perms and not any(v and str(v).lower() != "none" for v in perms.values()):
				continue
		except Exception:
			pass
		out.append(
			{
				"employee": emp,
				"employee_name": name,
				"user": user,
				"full_name": name,
				"designation": cstr(emp_row.get("designation") or ""),
			}
		)

	# Also include active users with CRM Executive / CRM Staff / CRM Manager roles
	for role in ("CRM Executive", "CRM Staff", "CRM Manager"):
		for has in frappe.get_all("Has Role", filters={"role": role, "parenttype": "User"}, fields=["parent"], limit_page_length=500):
			user = cstr(has.parent or "").strip()
			if not user or user in ("Guest", "Administrator"):
				continue
			emp = frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name") or frappe.db.get_value(
				"Employee", {"user_id": user}, "name"
			)
			if not emp or emp in seen:
				# still allow user-only CRM logins without Employee row
				if not emp:
					key = f"user:{user}"
					if key in seen:
						continue
					seen.add(key)
					full = cstr(frappe.db.get_value("User", user, "full_name") or user.split("@")[0]).strip()
					if frappe.db.get_value("User", user, "enabled") in (0, "0"):
						continue
					out.append(
						{
							"employee": "",
							"employee_name": full,
							"user": user,
							"full_name": full,
							"designation": role,
						}
					)
				continue
			seen.add(emp)
			emp_row = frappe.db.get_value(
				"Employee",
				emp,
				["employee_name", "user_id", "status", "designation"],
				as_dict=True,
			) or {}
			if emp_row.get("status") and emp_row.status != "Active":
				continue
			name = cstr(emp_row.get("employee_name") or "").strip() or cstr(
				frappe.db.get_value("User", user, "full_name") or user.split("@")[0]
			).strip()
			out.append(
				{
					"employee": emp,
					"employee_name": name,
					"user": user,
					"full_name": name,
					"designation": cstr(emp_row.get("designation") or role),
				}
			)

	out.sort(key=lambda x: (x.get("employee_name") or "").lower())
	return {"users": out, "count": len(out)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_employee_asset_options(employee=None, sid=None):
	denied, _roles = _guard(sid)
	if denied:
		return denied
	return _run(asset_options, cstr(_arg("employee", employee)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_employee_assets(employee=None, assets=None, sid=None):
	denied, roles = _guard(sid)
	if denied:
		return denied
	raw = _arg("assets", assets) or "[]"
	try:
		ids = json.loads(raw) if isinstance(raw, str) else list(raw)
	except ValueError:
		return _api()[0](_("Invalid asset list"))
	return _run(save_assets, cstr(_arg("employee", employee)), ids, roles)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def sign_asset_agreement(agreement=None, party=None, signature=None, sid=None):
	denied, roles = _guard(sid, manager=False)
	if denied:
		return denied
	return _run(
		sign_agreement,
		cstr(_arg("agreement", agreement)),
		cstr(_arg("party", party)),
		cstr(_arg("signature", signature)),
		roles,
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_asset_agreement_pdf(agreement=None, sid=None):
	denied, roles = _guard(sid, manager=False)
	if denied:
		return denied
	return _run(agreement_pdf, cstr(_arg("agreement", agreement)), roles)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_asset_agreements(sid=None):
	denied, _roles = _guard(sid, manager=False)
	if denied:
		return denied
	return _run(my_agreements)
