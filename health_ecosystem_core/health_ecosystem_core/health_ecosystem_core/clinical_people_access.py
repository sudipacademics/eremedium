"""People HRMS: per-employee portal access (logins + module permissions) and asset assignment agreements.

Portal access maps each portal to the existing roles that already gate it. Higher module levels add the
portal's manager role. HR / manager roles can only be granted by an HR Manager or System Manager, and
System Manager / Administrator / Health System Admin are never granted here.

Assigning assets snapshots them into an Asset Assignment PDF (with blank signature lines for paper
signing) stored as a private People Document on the employee.
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
ELEVATED_ROLES = {"HR Manager", "HR User", "Lab Manager", "Sales Manager", "Aesthetic Manager", "Operations Manager"}
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
	"Employees": ["/employees"],
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
# Roles these portals check that may not exist yet on a fresh site (created on first use).
PORTAL_ROLES = ("Aesthetic Staff", "Aesthetic Manager", "Operations Staff", "Operations Manager")

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
		"modules": ["Samples", "Results", "Reports", "Inventory", "Quality Control"],
		"manage_roles": ["Lab Manager"],
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
		],
	)
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
	out = {}
	for m in modules:
		level = cstr(data.get(m) or "none").lower()
		out[m] = level if level in LEVELS else "none"
	return out


def _roles_for(portal, perms):
	spec = PORTALS[portal]
	levels = [LEVELS.index(v) for v in perms.values()]
	if not levels or max(levels) == 0:
		return set()
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
		available = all(frappe.db.exists("Role", r) for r in spec["roles"])
		out.append(
			{
				"key": key,
				"label": spec["label"],
				"url": spec["url"],
				"modules": spec["modules"],
				"available": available,
				"elevated": bool(set(spec["roles"]) & ELEVATED_ROLES),
				"org_modules": sorted(spec.get("org_modules", ())),
				"defaults": {m: ("view" if m in PEOPLE_SELF_SERVICE_DEFAULT else "none") for m in spec["modules"]}
				if key == "people"
				else {m: "view" for m in spec["modules"]},
			}
		)
	return out


def access_state(employee):
	_ensure_doctypes()
	emp = _employee_row(employee)
	rows = frappe.get_all(ACCESS_DT, filters={"employee": employee}, fields=["name", "portal", "login_user", "permissions", "active", "granted_by", "granted_on"])
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
			}
		)
	return {
		"employee": employee,
		"employee_name": emp.get("employee_name") or employee,
		"default_login": emp.get("user_id") or emp.get("company_email") or emp.get("personal_email") or "",
		"portals": _portal_catalog(),
		"levels": [{"value": v, "label": LEVEL_LABEL[v]} for v in LEVELS],
		"access": access,
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
		if not all(frappe.db.exists("Role", r) for r in spec["roles"]):
			frappe.throw(_("{0} is not available on this server").format(spec["label"]))
		perms = _parse_perms(item.get("permissions") or {}, portal)
		active = 1 if cint(item.get("active", 1)) else 0
		new_roles = _roles_for(portal, perms) if active else set()
		if new_roles & FORBIDDEN_ROLES:
			frappe.throw(_("That access level is not allowed"))
		if (new_roles & ELEVATED_ROLES) and not can_grant:
			prev = existing.get(portal)
			prev_roles = _roles_for(portal, _parse_perms(json.loads(prev.permissions or "{}"), portal)) if prev else set()
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
	for r in frappe.get_all(ACCESS_DT, filters={"login_user": user, "active": 1}, fields=["portal", "permissions"]):
		if r.portal in PORTALS:
			try:
				needed |= _roles_for(r.portal, _parse_perms(json.loads(r.permissions or "{}"), r.portal))
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


PERM_CACHE = "people_portal_perms"


def _user_portal_perms(user):
	"""{portal: {module: level}} for a login's active access rows, plus whether it is managed at all."""
	cached = frappe.cache().hget(PERM_CACHE, user)
	if cached is not None:
		return cached
	rows = frappe.get_all(ACCESS_DT, filters={"login_user": user}, fields=["portal", "permissions", "active", "employee"])
	portals, employee = {}, None
	for r in rows:
		if r.portal not in PORTALS:
			continue
		if r.portal == "people":
			employee = r.employee
		if not cint(r.active):
			portals[r.portal] = {m: "none" for m in PORTALS[r.portal]["modules"]}
			continue
		try:
			portals[r.portal] = _parse_perms(json.loads(r.permissions or "{}"), r.portal)
		except ValueError:
			portals[r.portal] = {m: "none" for m in PORTALS[r.portal]["modules"]}
	value = {"managed": bool(rows), "portals": portals, "employee": employee}
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
	return {
		"user": user,
		"full_name": user_doc.get("full_name") or user,
		"roles": [r for r in frappe.get_roles(user) if r not in ("All", "Guest")],
		"exempt": exempt,
		"managed": bool(info["managed"]) and not exempt,
		"portals": portals,
		"portal_modules": portal_modules,
		"people_modules": portal_modules.get("people", {}),
		"always_paths": ["/people/profile"],
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
	rows = frappe.get_all(dt, filters={"name": ("in", list(asset_ids))}, fields=["name", "title", "category", "serial", "location", "assign_date", "notes"], order_by="title asc")
	return [
		{
			"id": r.name,
			"title": r.title,
			"category": r.category or "",
			"serial": r.serial or "",
			"location": r.location or "",
			"assign_date": cstr(r.assign_date or today()),
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
			"status": "Issued",
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
	asset_rows = "".join(
		f"<tr><td>{i}</td><td><b>{e(a.get('title'))}</b>{'<br><small>' + e(a.get('notes')) + '</small>' if a.get('notes') else ''}</td>"
		f"<td>{e(a.get('category'))}</td><td class='mono'>{e(a.get('id'))}</td><td class='mono'>{e(a.get('serial') or '—')}</td>"
		f"<td>{e(a.get('location') or '—')}</td><td>{e(format_date(a.get('assign_date')) if a.get('assign_date') else '')}</td></tr>"
		for i, a in enumerate(assets, 1)
	)

	def sign_box(title, name):
		return (
			f"<div class='sign'><div class='sign-title'>{e(title)}</div><div class='sign-pad'></div>"
			f"<div class='sign-line'></div><div class='sign-meta'><span>Name: <b>{e(name or '')}</b></span>"
			"<span>Date: ____ / ____ / ________</span></div></div>"
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
<div class="signs">{sign_box("Employee signature", emp.get("employee_name"))}{sign_box("HR Manager signature", "")}</div>
<div class="foot">Document {e(doc.name)} · Generated {e(cstr(now_datetime())[:16])} · Print this form, have both parties sign, and keep the signed copy on file.</div>
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


def agreement_pdf(agreement, roles):
	if not agreement or not frappe.db.exists(AGREEMENT_DT, agreement):
		frappe.throw(_("Agreement not found"))
	doc = frappe.get_doc(AGREEMENT_DT, agreement)
	own = frappe.db.get_value("Employee", doc.employee, "user_id") == frappe.session.user
	if not own and not _is_manager(roles):
		frappe.throw(_("Not allowed"), frappe.PermissionError)
	if doc.status != "Issued" and not doc.employee_signature and not doc.hr_signature:
		doc.db_set("status", "Issued", update_modified=False)
		_render_and_store(doc)
	elif not doc.file_url:
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
	denied, _roles = _guard(sid)
	if denied:
		return denied
	return _run(access_state, cstr(_arg("employee", employee)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_employee_portal_access(employee=None, access=None, sid=None):
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
