"""
Phase 11 — IAM helpers: role checks, franchise scope, phlebotomist assignments, patient portal users.
"""

import frappe
from frappe import _

STAFF_ROLES = frozenset(
    {"Health System Admin", "System Manager", "Lab Technician", "Pathologist"}
)
FRANCHISEE_ROLE = "Franchisee Operator"
PHLEBOTOMIST_ROLE = "Phlebotomist"
PATIENT_ROLE = "Patient"


def user_roles(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return []
    return frappe.get_roles(user)


def is_staff(roles=None):
    roles = roles if roles is not None else user_roles()
    return bool(set(roles) & STAFF_ROLES)


def is_franchisee(roles=None):
    roles = roles if roles is not None else user_roles()
    return FRANCHISEE_ROLE in roles


def is_phlebotomist(roles=None):
    roles = roles if roles is not None else user_roles()
    return PHLEBOTOMIST_ROLE in roles


def is_patient_portal(roles=None):
    roles = roles if roles is not None else user_roles()
    if is_staff(roles) or is_franchisee(roles) or is_phlebotomist(roles):
        return False
    return PATIENT_ROLE in roles or len(roles) <= 2


def require_roles(*allowed, user=None):
    """Return None if allowed, else an _error()-style dict for API responses."""
    roles = set(user_roles(user))
    if roles & set(allowed):
        return None
    if is_staff(roles) and STAFF_ROLES & set(allowed):
        return None
    return {
        "status": "error",
        "message": _("You do not have permission for this action."),
        "data": {},
        "http_status": 403,
    }


def franchisee_id_for_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    return frappe.db.get_value(
        "Franchisee Profile",
        {"linked_user": user, "active_status": "Active"},
        "name",
    )


def trf_list_filters_for_user(user=None):
    """Filters dict for frappe.get_all('Customer TRF', filters=...)."""
    user = user or frappe.session.user
    roles = user_roles(user)

    if is_franchisee(roles):
        franchisee_id = franchisee_id_for_user(user)
        return {"franchisee_id": franchisee_id} if franchisee_id else {"name": ("=", "")}

    if is_staff(roles):
        return {}

    if is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids(user)
        if not trf_ids:
            return {"name": ("=", "")}
        return {"name": ("in", trf_ids)}

    return None


def phlebotomist_trf_ids(user=None):
    user = user or frappe.session.user
    hub = franchise_for_phlebotomist(user)
    if hub:
        return frappe.get_all(
            "Customer TRF",
            filters={
                "franchisee_id": hub,
                "order_status": ("in", ["Booked", "Sample Collected"]),
            },
            pluck="name",
        )
    journeys = frappe.get_all(
        "Patient Care Journey",
        filters={"phlebotomist": user},
        pluck="customer_trf",
    )
    return [t for t in journeys if t]


def franchise_for_phlebotomist(user=None):
    user = user or frappe.session.user
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_franchisee_hub"}):
        hub = frappe.db.get_value("User", user, "hec_franchisee_hub")
        if hub:
            return hub
    return None


def auto_assign_phlebotomist_for_trf(trf_name):
    """Link hub phlebotomist to journey when a customer books diagnostics."""
    trf = frappe.get_doc("Customer TRF", trf_name)
    if not trf.franchisee_id:
        return None
    phlebotomist = frappe.db.get_value(
        "Franchisee Profile", trf.franchisee_id, "default_phlebotomist"
    )
    if not phlebotomist:
        return None
    journey_name = trf.get("care_journey")
    if journey_name:
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import advance_journey_forward

        advance_journey_forward(
            journey_name,
            "Phlebotomist Assigned",
            phlebotomist=phlebotomist,
            customer_trf=trf.name,
        )
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27 import notify_phlebo_assignment

        notify_phlebo_assignment(trf.name, phlebotomist)
    except Exception:
        frappe.log_error(title="notify_phlebo_assignment", message=frappe.get_traceback())
    return phlebotomist


def ensure_patient_portal_role():
    if frappe.db.exists("Role", PATIENT_ROLE):
        return PATIENT_ROLE
    frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": PATIENT_ROLE,
            "desk_access": 0,
            "description": "Mobile/web patient portal — bookings and journeys only",
        }
    ).insert(ignore_permissions=True)
    return PATIENT_ROLE


def ensure_phlebotomist_permissions():
    """Read access on journeys and TRFs for sample collection role."""
    from health_ecosystem_core.health_ecosystem_core.clinical_setup import ensure_clinical_roles

    ensure_clinical_roles()
    ensure_patient_portal_role()
    for doctype, perms in (
        ("Customer TRF", {"read": 1, "write": 1, "create": 0}),
        ("Patient Care Journey", {"read": 1, "write": 1, "create": 0}),
        ("Pharmacy Order", {"read": 1}),
    ):
        _ensure_role_perm(doctype, PHLEBOTOMIST_ROLE, perms)
        _ensure_role_perm(doctype, PATIENT_ROLE, {"read": 1, "create": 1})


def _ensure_role_perm(doctype, role, perm_map):
    if not frappe.db.exists("DocType", doctype):
        return
    existing = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role},
        "name",
    )
    if existing:
        return
    meta = frappe.get_meta(doctype)
    if any(p.role == role for p in meta.permissions):
        return
    doc = frappe.get_doc("DocType", doctype)
    row = {"role": role}
    row.update(perm_map)
    doc.append("permissions", row)
    doc.save(ignore_permissions=True)


def link_user_to_health_patient(user, patient_name=None, phone=None):
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

    patient_id = ensure_patient(
        patient_name=patient_name or frappe.db.get_value("User", user, "full_name"),
        phone=phone or frappe.db.get_value("User", user, "mobile_no"),
        user=user,
    )
    return patient_id


def setup_iam(seed_users=True):
    """Phase 11 entry — roles, permissions, demo phlebotomist + patient users."""
    from health_ecosystem_core.health_ecosystem_core.init import (
        DEFAULT_USERS,
        _create_users,
        _create_roles,
    )

    ensure_phlebotomist_permissions()
    _create_roles()

  # Extend DEFAULT_USERS at runtime if phlebotomist not yet in list
    extra = [
        {
            "email": "phlebotomist@health.local",
            "username": "phlebotomist",
            "first_name": "Sample",
            "last_name": "Collector",
            "password": "PhlebChangeMe@123",
            "roles": [PHLEBOTOMIST_ROLE],
        },
        {
            "email": "patient_demo@health.local",
            "username": "patient_demo",
            "first_name": "Demo",
            "last_name": "Patient",
            "password": "PatientChangeMe@123",
            "roles": [PATIENT_ROLE],
            "user_type": "Website User",
        },
    ]
    if seed_users:
        for spec in extra:
            if spec["email"] not in {u["email"] for u in DEFAULT_USERS}:
                _upsert_iam_user(spec)
        _create_users()

    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 11,
        "roles": [PHLEBOTOMIST_ROLE, PATIENT_ROLE],
        "demo_users": [u["email"] for u in extra],
    }


def _upsert_iam_user(spec):
    user_type = spec.get("user_type", "System User")
    if frappe.db.exists("User", spec["email"]):
        user = frappe.get_doc("User", spec["email"])
    else:
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": spec["email"],
                "first_name": spec["first_name"],
                "last_name": spec["last_name"],
                "send_welcome_email": 0,
                "enabled": 1,
            }
        )
        user.insert(ignore_permissions=True)

    user.username = spec["username"]
    user.enabled = 1
    user.user_type = user_type
    existing = {r.role for r in user.roles}
    for role in spec["roles"]:
        if role not in existing:
            user.append("roles", {"role": role})
    user.save(ignore_permissions=True)

    from frappe.utils.password import update_password

    update_password(spec["email"], spec["password"], logout_all_sessions=False)

    if PATIENT_ROLE in spec["roles"]:
        link_user_to_health_patient(
            spec["email"],
            patient_name=f"{spec['first_name']} {spec['last_name']}",
        )

    if PHLEBOTOMIST_ROLE in spec["roles"] and frappe.db.exists("Franchisee Profile", "HUB001"):
        frappe.db.set_value("User", spec["email"], "hec_franchisee_hub", "HUB001", update_modified=False)
        frappe.db.set_value(
            "Franchisee Profile", "HUB001", "default_phlebotomist", spec["email"], update_modified=False
        )
