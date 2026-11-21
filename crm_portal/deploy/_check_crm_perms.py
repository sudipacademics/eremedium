import json
import frappe

from health_ecosystem_core.health_ecosystem_core.clinical_people_access import (
	ACCESS_DT,
	PERM_CACHE,
	PORTALS,
	_user_portal_perms,
	my_permissions,
)

user = "sganguly@gmail.com"
frappe.cache().hdel(PERM_CACHE, user)
frappe.set_user(user)
rows = frappe.get_all(
	ACCESS_DT,
	filters={"login_user": user},
	fields=["portal", "active", "permissions", "employee"],
)
print("ROWS", json.dumps(rows, default=str))
print("HAS_CRM", "crm" in PORTALS)
print("CRM_PATHS_KEYS", list((PORTALS.get("crm") or {}).get("module_paths") or {}))
info = _user_portal_perms(user)
print("INFO_CRM", json.dumps((info.get("portals") or {}).get("crm")))
perms = my_permissions()
print("MODULES_CRM", json.dumps((perms.get("portal_modules") or {}).get("crm")))
print("ROLES", perms.get("roles"))
print("EXEMPT", perms.get("exempt"))
