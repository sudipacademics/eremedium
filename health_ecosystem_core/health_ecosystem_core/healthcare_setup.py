"""
Marley Healthcare desk setup: roles, permissions, and sample masters.

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.healthcare_setup.setup_healthcare_desk
"""

import frappe
from frappe.utils import flt, now_datetime


HEC_ADMIN_USERS = [
    "system_admin@health.local",
    "sudip.academics@gmail.com",
    "Administrator",
]

HEC_STAFF_USERS = [
    "franchise_hub@health.local",
    "lab_tech@health.local",
]

HEALTHCARE_ADMIN_ROLES = [
    "Healthcare Administrator",
    "Physician",
    "Nursing User",
    "Laboratory User",
]

HEC_ROLES = [
    "Health System Admin",
    "Franchisee Operator",
    "Lab Technician",
    "System Manager",
]

HEALTHCARE_DOCTYPES = [
    "Patient",
    "Healthcare Practitioner",
    "Patient Appointment",
    "Patient Encounter",
    "Medical Department",
    "Appointment Type",
    "Healthcare Service Unit",
    "Healthcare Service Unit Type",
    "Clinical Procedure",
    "Lab Test",
    "Vital Signs",
    "Healthcare Settings",
    "Inpatient Record",
    "Complaint",
    "Diagnosis",
]

PERMISSION_TYPES = ("read", "write", "create", "delete", "email", "print", "export", "report")

SYSTEM_ADMIN_ROLES = [
    "Healthcare Administrator",
    "Health System Admin",
    "System Manager",
    "Physician",
    "Laboratory User",
]


def resolve_system_admin_user():
    """Find system_admin by email or username."""
    for candidate in ("system_admin@health.local", "system_admin", "Administrator"):
        if frappe.db.exists("User", candidate):
            return candidate
    name = frappe.db.get_value("User", {"username": "system_admin"}, "name")
    return name


def fix_all_hec_desk_users():
    """Grant healthcare access to system_admin and any sudip/* admin emails."""
    extra = frappe.get_all(
        "User",
        filters={"email": ["in", ["sudip.academics@gmail.com"]]},
        pluck="name",
    )
    sudip_like = frappe.get_all(
        "User",
        filters={"email": ["like", "%sudip%"]},
        pluck="name",
    )
    for u in sudip_like:
        if u not in extra:
            extra.append(u)
    return fix_system_admin_permissions(extra_users=extra)


def fix_system_admin_permissions(extra_users=None):
    """
    Grant Healthcare + HEC roles to system_admin and optional extra users.
    /app/patient is the patient PORTAL (Patient role only) — admins use /app/List/Patient.
    """
    targets = [resolve_system_admin_user()]
    for u in extra_users or []:
        if u and u not in targets:
            targets.append(u)

    results = []
    for user_id in targets:
        if not user_id:
            continue
        if not frappe.db.exists("User", user_id):
            alt = frappe.db.get_value("User", {"email": user_id}, "name") or frappe.db.get_value(
                "User", {"username": user_id}, "name"
            )
            if not alt:
                results.append({"ok": False, "user": user_id, "error": "not found"})
                continue
            user_id = alt
        results.append(grant_healthcare_to_user(user_id))

    if not any(r.get("ok") for r in results):
        return {"ok": False, "error": "No users updated", "results": results}

    _fix_healthcare_workspace_patient_links()
    fix_user_home_routes()
    _grant_admin_access_to_patient_portal_page()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "results": results}


def _fix_healthcare_workspace_patient_links():
    """Point workspace Patient shortcuts to DocType list, not broken /app/patient page route."""
    for ws_name in frappe.get_all("Workspace", pluck="name"):
        try:
            ws = frappe.get_doc("Workspace", ws_name)
        except Exception:
            continue
        changed = False
        for link in ws.links or []:
            link_to = (link.link_to or "").strip()
            link_to_lower = link_to.lower()
            link_type = (link.link_type or getattr(link, "type", None) or "").lower()

            # Broken Marley shortcut: Page "patient" does not exist on v15 desk.
            if link_to_lower == "patient":
                link.link_type = "DocType"
                link.link_to = "Patient"
                if hasattr(link, "url"):
                    link.url = ""
                changed = True
            elif link_type == "page" and link_to_lower == "patient":
                link.link_type = "DocType"
                link.link_to = "Patient"
                changed = True

        for shortcut in getattr(ws, "shortcuts", None) or []:
            st = (shortcut.type or "").lower()
            doc = (shortcut.link_to or shortcut.doc_view or "").lower()
            if doc == "patient" and st in ("page", "url", ""):
                shortcut.type = "DocType"
                shortcut.link_to = "Patient"
                if hasattr(shortcut, "doc_view"):
                    shortcut.doc_view = "List"
                changed = True

        if changed:
            ws.save(ignore_permissions=True)


def fix_user_home_routes():
    """
    Stop desk login landing on /app/patient (missing Page).
    Send healthcare users to Healthcare workspace instead.
    """
    fixed_users = []
    user_fields = frappe.get_meta("User").get_valid_columns()

    for user_name in frappe.get_all("User", filters={"enabled": 1}, pluck="name"):
        updates = {}
        if "home_page" in user_fields and frappe.db.has_column("User", "home_page"):
            home = (frappe.db.get_value("User", user_name, "home_page") or "").strip().lower()
            if home in ("patient", "/app/patient", "app/patient"):
                updates["home_page"] = ""

        if "default_workspace" in user_fields:
            roles = frappe.get_all("Has Role", filters={"parent": user_name}, pluck="role")
            if any(r in roles for r in ("Healthcare Administrator", "Health System Admin", "Physician")):
                updates["default_workspace"] = "Healthcare"

        if updates:
            frappe.db.set_value("User", user_name, updates, update_modified=False)
            fixed_users.append({"user": user_name, **updates})

    frappe.db.commit()
    return fixed_users


def remove_patient_role_from_admins():
    """Desk admins must not have Patient role — it routes login to /app/patient portal."""
    admin_roles = {"System Manager", "Healthcare Administrator", "Health System Admin", "Administrator"}
    fixed = []
    for user_name in frappe.get_all("User", filters={"enabled": 1}, pluck="name"):
        roles = [r.role for r in frappe.get_doc("User", user_name).roles]
        if not any(r in admin_roles for r in roles):
            continue
        if "Patient" not in roles:
            continue
        user = frappe.get_doc("User", user_name)
        user.roles = [r for r in user.roles if r.role != "Patient"]
        user.save(ignore_permissions=True)
        fixed.append(user_name)
    frappe.db.commit()
    return fixed


def _page_folder_name(page_slug):
    return page_slug.replace("-", "_")


def _write_desk_page_js(page_slug, doctype):
    """Frappe desk Pages need a .js file with on_page_load — HTML script in content does not run."""
    import os

    folder = _page_folder_name(page_slug)
    app_path = frappe.get_app_path("health_ecosystem_core")
    page_dir = os.path.join(app_path, "health_ecosystem_core", "page", folder)
    os.makedirs(page_dir, exist_ok=True)
    js_path = os.path.join(page_dir, f"{folder}.js")
    js_body = f"""frappe.pages["{page_slug}"].on_page_load = function () {{
\tconst path = window.location.pathname || "";
\tif (path.endsWith("/new")) {{
\t\tfrappe.new_doc("{doctype}");
\t}} else {{
\t\tfrappe.set_route("List", "{doctype}");
\t}}
}};
"""
    with open(js_path, "w", encoding="utf-8") as handle:
        handle.write(js_body)
    return js_path


def create_doctype_desk_redirect_page(page_slug, doctype, title=None):
    """Desk Page so /app/<slug> opens the DocType list or new form."""
    from frappe.desk.utils import slug

    page_slug = page_slug or slug(doctype)
    title = title or doctype
    _write_desk_page_js(page_slug, doctype)

    if frappe.db.exists("Page", page_slug):
        page = frappe.get_doc("Page", page_slug)
    else:
        page = frappe.get_doc(
            {
                "doctype": "Page",
                "page_name": page_slug,
                "title": title,
                "module": "Health Ecosystem Core",
            }
        )

    page.title = title
    page.module = "Health Ecosystem Core"
    page.content = None

    admin_roles = (
        "System Manager",
        "Healthcare Administrator",
        "Health System Admin",
        "Physician",
        "Laboratory User",
        "Nursing User",
    )
    existing_roles = {r.role for r in (page.roles or [])}
    for role in admin_roles:
        if role not in existing_roles:
            page.append("roles", {"role": role})

    if page.is_new():
        prev_dev = frappe.conf.get("developer_mode")
        frappe.conf.developer_mode = 1
        try:
            page.insert(ignore_permissions=True)
        finally:
            frappe.conf.developer_mode = prev_dev
    else:
        page.save(ignore_permissions=True)

    try:
        frappe.reload_doc("health_ecosystem_core", "page", _page_folder_name(page_slug))
    except Exception:
        pass
    return page.name


# Frappe Page.page_name max length is 20 — long slugs get truncated (e.g. healthcare-practitio).
HEALTHCARE_PAGE_SLUGS = {
    "Healthcare Practitioner": "practitioner",
    "Patient Encounter": "patient-encounter",
    "Patient Appointment": "patient-appointment",
    "Healthcare Service Unit": "service-unit",
    "Medical Department": "medical-department",
    "Appointment Type": "appointment-type",
    "Patient": "patients",
}


def create_healthcare_desk_redirect_pages():
    """Create desk Pages for slug URLs that otherwise 404 on this site."""
    for broken in ("healthcare-practitio", "healthcare-service-u"):
        if frappe.db.exists("Page", broken):
            frappe.delete_doc("Page", broken, ignore_permissions=True, force=True)

    created = {}
    for doctype, page_slug in HEALTHCARE_PAGE_SLUGS.items():
        if not frappe.db.exists("DocType", doctype):
            continue
        try:
            created[doctype] = create_doctype_desk_redirect_page(page_slug, doctype)
        except Exception as exc:
            created[doctype] = {"error": str(exc)}
    frappe.db.commit()
    frappe.clear_cache()
    return created


def create_patient_desk_redirect_page():
    """Fallback Page 'patient' so /app/patient opens Patient list instead of 404."""
    try:
        return create_doctype_desk_redirect_page("patient", "Patient", title="Patients")
    except Exception as exc:
        frappe.log_error(title="create_patient_desk_redirect_page", message=frappe.get_traceback())
        return {"skipped": True, "reason": str(exc)}


def _fix_workspace_content_patient_routes():
    """Fix Frappe v15 workspace JSON content pointing to Page patient."""
    import json
    import re

    changed_ws = []
    for ws_name in frappe.get_all("Workspace", pluck="name"):
        content = frappe.db.get_value("Workspace", ws_name, "content") or ""
        if not content or "patient" not in content.lower():
            continue
        new_content = content
        new_content = re.sub(
            r'"link_type"\s*:\s*"Page"\s*,\s*"link_to"\s*:\s*"patient"',
            '"link_type": "DocType", "link_to": "Patient"',
            new_content,
            flags=re.IGNORECASE,
        )
        new_content = re.sub(
            r'"link_to"\s*:\s*"patient"',
            '"link_to": "Patient"',
            new_content,
            flags=re.IGNORECASE,
        )
        if new_content != content:
            frappe.db.set_value("Workspace", ws_name, "content", new_content, update_modified=False)
            changed_ws.append(ws_name)
    return changed_ws


def fix_desk_route_conflicts():
    """
    Remove blank Page routes that hijack /app/patient and break Marley slugs.
  Frappe v15 tries Page before DocType; empty Page = blank screen.
    """
    # Blank Page 'patient' blocks Patient list — use /app/patients redirect page instead.
    if frappe.db.exists("Page", "patient"):
        try:
            frappe.delete_doc("Page", "patient", ignore_permissions=True, force=True)
        except Exception:
            page = frappe.get_doc("Page", "patient")
            page.content = """<script>
frappe.ready(function() { frappe.set_route("List", "Patient"); });
</script>"""
            page.save(ignore_permissions=True)

    for broken in ("healthcare-practitio", "healthcare-service-u", "healthcare-practitioner"):
        if frappe.db.exists("Page", broken):
            frappe.delete_doc("Page", broken, ignore_permissions=True, force=True)

    import re

    for ws_name in frappe.get_all("Workspace", pluck="name"):
        content = frappe.db.get_value("Workspace", ws_name, "content") or ""
        if not content:
            continue
        new_content = content
        new_content = re.sub(
            r'"route"\s*:\s*"/app/healthcare-practitioner"',
            '"route": "/app/practitioner"',
            new_content,
        )
        new_content = re.sub(
            r'"route"\s*:\s*"/app/patient"',
            '"route": "/app/patients"',
            new_content,
        )
        new_content = re.sub(
            r'"link_to"\s*:\s*"healthcare-practitioner"',
            '"link_to": "Healthcare Practitioner"',
            new_content,
            flags=re.IGNORECASE,
        )
        if new_content != content:
            frappe.db.set_value("Workspace", ws_name, "content", new_content, update_modified=False)

    create_healthcare_desk_redirect_pages()
    fix_all_healthcare_shortcuts()
    _fix_healthcare_workspace_patient_links()
    _fix_workspace_content_patient_routes()
    removed = remove_patient_role_from_admins()
    users = fix_user_home_routes()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "fixed_users": users,
        "removed_patient_role_from": removed,
        "use_practitioner": "/app/practitioner",
        "use_patients": "/app/patients",
        "healthcare_home": "/app/healthcare",
    }


def fix_patient_desk_routes():
    """Alias for desk route repair (patient + practitioner slug conflicts)."""
    return fix_desk_route_conflicts()


def _grant_admin_access_to_patient_portal_page():
    """If Marley patient portal Page exists, allow admins too (optional)."""
    if not frappe.db.exists("Page", "patient"):
        return
    page = frappe.get_doc("Page", "patient")
    admin_roles = {"Healthcare Administrator", "System Manager", "Health System Admin"}
    existing = {r.role for r in (page.roles or [])}
    changed = False
    for role in admin_roles:
        if role not in existing:
            page.append("roles", {"role": role})
            changed = True
    if changed:
        page.save(ignore_permissions=True)


def list_desk_users():
    """Diagnostic: enabled system users and their roles."""
    users = frappe.get_all(
        "User",
        filters={"enabled": 1, "user_type": "System User"},
        fields=["name", "email", "username", "full_name"],
        order_by="modified desc",
        limit=30,
    )
    result = []
    for u in users:
        doc = frappe.get_doc("User", u.name)
        result.append(
            {
                **u,
                "roles": [r.role for r in doc.roles],
            }
        )
    return result


def _force_user_roles(user_id, roles):
    """Insert roles directly when User child-table save leaves user with zero roles."""
    for role in roles:
        _ensure_role(role)
        if frappe.db.exists("Has Role", {"parent": user_id, "role": role}):
            continue
        frappe.get_doc(
            {
                "doctype": "Has Role",
                "parent": user_id,
                "parenttype": "User",
                "parentfield": "roles",
                "role": role,
            }
        ).insert(ignore_permissions=True)
    frappe.db.commit()


def grant_healthcare_to_user(user_id):
    """Grant full healthcare desk access to a specific user email/username."""
    if not frappe.db.exists("User", user_id):
        user_id = frappe.db.get_value("User", {"email": user_id}, "name")
    if not user_id:
        user_id = frappe.db.get_value("User", {"username": user_id}, "name")
    if not user_id:
        return {"ok": False, "error": f"User not found: {user_id}"}

    for role in SYSTEM_ADMIN_ROLES:
        _ensure_role(role)

    user = frappe.get_doc("User", user_id)
    user.enabled = 1
    user.user_type = "System User"
    if frappe.db.has_column("User", "default_workspace"):
        user.default_workspace = "Healthcare"
    existing = {r.role for r in user.roles}
    for role in SYSTEM_ADMIN_ROLES:
        if role not in existing:
            user.append("roles", {"role": role})
    user.save(ignore_permissions=True)
    frappe.db.commit()

    user.reload()
    if not [r.role for r in user.roles]:
        user.add_roles(*SYSTEM_ADMIN_ROLES)
        frappe.db.commit()
        user.reload()
    if not frappe.get_all("Has Role", filters={"parent": user_id}, pluck="role"):
        _force_user_roles(user_id, SYSTEM_ADMIN_ROLES)
        user.reload()

    ensure_healthcare_doctype_permissions()
    frappe.db.commit()
    frappe.clear_cache(user=user_id)

    roles = frappe.get_all("Has Role", filters={"parent": user_id}, pluck="role")
    return {
        "ok": bool(roles),
        "user": user_id,
        "roles": roles,
        "patient_url": "/app/List/Patient",
        "practitioner_url": doctype_desk_route("Healthcare Practitioner"),
        "healthcare_home": "/app/healthcare",
    }


def healthcare_installed():
    return "healthcare" in (frappe.get_installed_apps() or [])


def _default_company():
    return frappe.defaults.get_global_default("company") or (
        frappe.get_all("Company", limit=1)[0].name if frappe.get_all("Company", limit=1) else None
    )


def _ensure_role(role_name):
    if frappe.db.exists("Role", role_name):
        return
    frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": role_name,
            "desk_access": 1,
        }
    ).insert(ignore_permissions=True)


def ensure_healthcare_roles_on_users():
    """Grant Healthcare Administrator (+ related) to HEC admin users."""
    for role in HEALTHCARE_ADMIN_ROLES:
        _ensure_role(role)

    targets = set(HEC_ADMIN_USERS + HEC_STAFF_USERS)

    # Also grant to anyone who already has System Manager / Health System Admin.
    for role in ("System Manager", "Health System Admin"):
        for row in frappe.get_all("Has Role", filters={"role": role}, fields=["parent"]):
            targets.add(row.parent)

    for email in targets:
        if not frappe.db.exists("User", email):
            continue
        user = frappe.get_doc("User", email)
        existing = {r.role for r in user.roles}
        is_admin = email in HEC_ADMIN_USERS or "System Manager" in existing or "Health System Admin" in existing
        roles_to_add = HEALTHCARE_ADMIN_ROLES if is_admin else ["Physician", "Laboratory User"]
        changed = False
        for role in roles_to_add:
            if role not in existing:
                user.append("roles", {"role": role})
                changed = True
        if changed:
            user.save(ignore_permissions=True)


def ensure_healthcare_doctype_permissions():
    """Ensure HEC + Healthcare roles can access Marley DocTypes."""
    roles = list(set(HEC_ROLES + HEALTHCARE_ADMIN_ROLES))
    for doctype in HEALTHCARE_DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in roles:
            for ptype in PERMISSION_TYPES:
                try:
                    frappe.permissions.add_permission(doctype, role, permlevel=0, ptype=ptype)
                except Exception:
                    pass
    frappe.clear_cache()


def _ensure_medical_department(name):
    if frappe.db.exists("Medical Department", name):
        return name
    doc = frappe.get_doc({"doctype": "Medical Department", "department": name})
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_appointment_type(name, duration=30):
    if frappe.db.exists("Appointment Type", name):
        return name
    doc = frappe.get_doc(
        {
            "doctype": "Appointment Type",
            "appointment_type": name,
            "default_duration": duration,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_service_unit_type(name):
    if not frappe.db.exists("DocType", "Healthcare Service Unit Type"):
        return None
    if frappe.db.exists("Healthcare Service Unit Type", name):
        return name
    doc = frappe.get_doc(
        {
            "doctype": "Healthcare Service Unit Type",
            "service_unit_type": name,
            "allow_appointments": 1,
            "overlap_appointments": 0,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_service_unit(name, company, unit_type=None):
    if not frappe.db.exists("DocType", "Healthcare Service Unit"):
        return None
    if frappe.db.exists("Healthcare Service Unit", name):
        return name
    doc = frappe.get_doc(
        {
            "doctype": "Healthcare Service Unit",
            "healthcare_service_unit_name": name,
            "company": company,
            "is_group": 0,
            "allow_appointments": 1,
            "service_unit_type": unit_type,
        }
    )
    doc.flags.ignore_mandatory = True
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_consultation_item(company):
    code = "CONSULT-001"
    if frappe.db.exists("Item", code):
        return code
    item = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": code,
            "item_name": "Doctor Consultation",
            "item_group": "Services",
            "stock_uom": "Nos",
            "is_stock_item": 0,
            "is_sales_item": 1,
            "standard_rate": 500,
        }
    )
    item.flags.ignore_mandatory = True
    item.insert(ignore_permissions=True)
    return code


def _ensure_healthcare_settings(company):
    if not frappe.db.exists("DocType", "Healthcare Settings"):
        return

    if frappe.db.exists("Healthcare Settings", "Healthcare Settings"):
        hs = frappe.get_doc("Healthcare Settings", "Healthcare Settings")
    else:
        hs = frappe.get_doc({"doctype": "Healthcare Settings"})

    if company and hs.meta.has_field("company") and not hs.get("company"):
        hs.company = company

    for field, value in (
        ("link_customer_to_patient", 1),
        ("patient_name_by", "Patient Name"),
    ):
        if hs.meta.has_field(field) and not hs.get(field):
            hs.set(field, value)

    consultation_item = _ensure_consultation_item(company)
    if consultation_item and hs.meta.has_field("op_consulting_charge_item"):
        hs.op_consulting_charge_item = consultation_item

    hs.flags.ignore_mandatory = True
    if hs.is_new():
        hs.insert(ignore_permissions=True)
    else:
        hs.save(ignore_permissions=True)


def seed_healthcare_practitioners(company):
    """Create sample doctors if none exist."""
    if not frappe.db.exists("DocType", "Healthcare Practitioner"):
        return []

    existing = frappe.db.count("Healthcare Practitioner")
    if existing:
        return frappe.get_all("Healthcare Practitioner", pluck="name", limit=5)

    dept = _ensure_medical_department("General Medicine")
    _ensure_medical_department("Pathology")
    _ensure_appointment_type("Consultation", 30)
    _ensure_appointment_type("Follow Up", 15)

    unit_type = _ensure_service_unit_type("Consultation Room")
    _ensure_service_unit("OPD Room 1", company, unit_type)

    practitioners = [
        {
            "practitioner_name": "Dr. Ananya Sharma",
            "department": dept,
            "mobile_phone": "+91-9876500001",
            "op_consulting_charge": 500,
        },
        {
            "practitioner_name": "Dr. Rahul Mehta",
            "department": dept,
            "mobile_phone": "+91-9876500002",
            "op_consulting_charge": 600,
        },
    ]

    created = []
    for spec in practitioners:
        name = spec["practitioner_name"]
        if frappe.db.get_value("Healthcare Practitioner", {"practitioner_name": name}, "name"):
            continue
        doc = frappe.get_doc(
            {
                "doctype": "Healthcare Practitioner",
                "practitioner_name": name,
                "department": spec["department"],
                "mobile_phone": spec.get("mobile_phone"),
                "op_consulting_charge": flt(spec.get("op_consulting_charge")),
                "status": "Active",
            }
        )
        if doc.meta.has_field("company") and company:
            doc.company = company
        doc.flags.ignore_mandatory = True
        doc.insert(ignore_permissions=True)
        created.append(doc.name)

    return created


def seed_sample_patient():
    if not frappe.db.exists("DocType", "Patient"):
        return None
    if frappe.db.exists("Patient", {"patient_name": "Sample Patient Demo"}):
        return frappe.db.get_value("Patient", {"patient_name": "Sample Patient Demo"}, "name")

    patient = frappe.get_doc(
        {
            "doctype": "Patient",
            "patient_name": "Sample Patient Demo",
            "sex": "Male",
            "mobile": "+91-9999900000",
            "status": "Active",
        }
    )
    patient.flags.ignore_mandatory = True
    patient.insert(ignore_permissions=True)
    return patient.name


def verify_healthcare_desk():
    """Return diagnostic dict for desk troubleshooting."""
    checks = {}
    for dt in ("Patient", "Healthcare Practitioner", "Patient Encounter", "Patient Appointment"):
        checks[dt] = bool(frappe.db.exists("DocType", dt))

    checks["patient_count"] = frappe.db.count("Patient") if checks.get("Patient") else 0
    checks["practitioner_count"] = (
        frappe.db.count("Healthcare Practitioner") if checks.get("Healthcare Practitioner") else 0
    )
    checks["healthcare_installed"] = healthcare_installed()

    admin = "system_admin@health.local"
    if not frappe.db.exists("User", admin):
        admin = "Administrator"
    if frappe.db.exists("User", admin):
        checks["admin_user"] = admin
        checks["admin_roles"] = [r.role for r in frappe.get_doc("User", admin).roles]
    else:
        checks["admin_user"] = None
        checks["admin_roles"] = []

    checks["patient_list_route"] = "/app/List/Patient"
    checks["healthcare_workspace"] = "/app/healthcare"
    return checks


def setup_healthcare_desk(seed_demo=True):
    """
    Full Marley desk bootstrap: roles, permissions, settings, practitioners.
    Safe to run multiple times.
    """
    if not healthcare_installed():
        return {"ok": False, "error": "healthcare app not installed — run install-marley.sh first"}

    missing = [dt for dt in ("Patient", "Healthcare Practitioner", "Patient Encounter") if not frappe.db.exists("DocType", dt)]
    if missing:
        from frappe.model.sync import sync_for

        sync_for("healthcare", force=True)
        frappe.db.commit()
        missing = [dt for dt in missing if not frappe.db.exists("DocType", dt)]
        if missing:
            return {"ok": False, "error": f"DocTypes still missing after sync: {', '.join(missing)}"}

    company = _default_company()

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_healthcare_patient_fields

    fix_patient_desk_routes()
    ensure_healthcare_roles_on_users()
    fix_system_admin_permissions()
    ensure_healthcare_doctype_permissions()
    ensure_healthcare_patient_fields()
    _ensure_healthcare_settings(company)

    practitioners = seed_healthcare_practitioners(company) if seed_demo else []
    sample_patient = seed_sample_patient() if seed_demo else None

    frappe.db.commit()
    frappe.clear_cache()

    report = verify_healthcare_desk()
    report["ok"] = True
    report["practitioners_created"] = practitioners
    report["sample_patient"] = sample_patient
    report["message"] = (
        "Healthcare desk ready. Open /app/healthcare or /app/List/Patient "
        "(not /app/patient). Log out and log in if pages still missing."
    )
    return report


def dump_patient_route_debug():
    """Debug why /app/patient fails."""
    user = "sudip.academics@gmail.com"
    out = {
        "user_roles": [r.role for r in frappe.get_doc("User", user).roles] if frappe.db.exists("User", user) else [],
        "default_workspace": frappe.db.get_value("User", user, "default_workspace"),
    }
    if frappe.db.exists("Workspace", "Healthcare"):
        ws = frappe.get_doc("Workspace", "Healthcare")
        out["workspace_links"] = [
            {"type": getattr(l, "link_type", ""), "to": l.link_to, "label": getattr(l, "label", "")}
            for l in (ws.links or [])
        ]
        out["content_has_patient"] = "patient" in ((ws.content or "").lower())
        if out["content_has_patient"]:
            out["content_snippet"] = (ws.content or "")[:2000]
    out["page_patient_exists"] = frappe.db.exists("Page", "patient")
    out["doctype_patient_exists"] = frappe.db.exists("DocType", "Patient")
    return out


HEALTHCARE_SHORTCUT_DOCTYPES = {
    "patient": "Patient",
    "healthcare practitioner": "Healthcare Practitioner",
    "patient appointment": "Patient Appointment",
    "patient encounter": "Patient Encounter",
    "healthcare service unit": "Healthcare Service Unit",
    "lab test": "Lab Test",
}


def doctype_desk_route(doctype, view="list"):
    """Desk URL via short Page redirect (page_name max 20 chars on this Frappe build)."""
    page_slug = HEALTHCARE_PAGE_SLUGS.get(doctype)
    if page_slug:
        base = f"/app/{page_slug}"
        return f"{base}/new" if view == "new" else base
    from frappe.desk.utils import slug

    base = f"/app/{slug(doctype)}"
    if view == "new":
        return f"{base}/new"
    return base


def fix_healthcare_v15_routes():
    """
    Fix broken legacy URLs like /app/List/Healthcare Practitioner
    which redirect to /app/Healthcare%20Practitioner (404).
    """
    reload_healthcare_workspace()
    fix_all_healthcare_shortcuts()
    fix_desk_route_conflicts()
    pages = create_healthcare_desk_redirect_pages()

    routes = {}
    for key, doctype in HEALTHCARE_SHORTCUT_DOCTYPES.items():
        if frappe.db.exists("DocType", doctype):
            routes[doctype] = {
                "list": doctype_desk_route(doctype),
                "new": doctype_desk_route(doctype, view="new"),
            }

    frappe.clear_cache()
    return {
        "ok": True,
        "pages": pages,
        "routes": routes,
        "use_these": {
            "healthcare_workspace": "/app/healthcare",
            "practitioner_list": routes.get("Healthcare Practitioner", {}).get("list"),
            "practitioner_new": routes.get("Healthcare Practitioner", {}).get("new"),
            "patient_list": routes.get("Patient", {}).get("list"),
        },
        "avoid": [
            "/app/List/Healthcare Practitioner",
            "/app/Healthcare Practitioner",
            "/app/Healthcare%20Practitioner",
        ],
    }


def fix_healthcare_shortcuts():
    """Fix Workspace Shortcut records that route Patient to missing Page."""
    return fix_all_healthcare_shortcuts()


def fix_all_healthcare_shortcuts():
    """Fix Healthcare workspace shortcuts using broken Page routes."""
    fixed = []
    for row in frappe.get_all(
        "Workspace Shortcut",
        fields=["name", "type", "link_to", "label", "doc_view", "parent"],
    ):
        label_key = (row.label or "").strip().lower()
        link_key = (row.link_to or "").strip().lower()
        stype = (row.type or "").strip()

        target_doctype = None
        for key, doctype in HEALTHCARE_SHORTCUT_DOCTYPES.items():
            if label_key == key or link_key == key.replace(" ", "-") or link_key == key:
                target_doctype = doctype
                break
            if label_key == doctype.lower() or link_key == doctype.lower():
                target_doctype = doctype
                break

        needs_fix = False
        if target_doctype:
            needs_fix = stype.lower() != "doctype" or (row.link_to or "") != target_doctype
        elif stype.lower() == "page" and row.link_to:
            if not frappe.db.exists("Page", row.link_to):
                # Broken page shortcut — try map from label
                target_doctype = HEALTHCARE_SHORTCUT_DOCTYPES.get(label_key)
                needs_fix = bool(target_doctype)

        if not needs_fix:
            continue

        doc = frappe.get_doc("Workspace Shortcut", row.name)
        if target_doctype:
            doc.type = "DocType"
            doc.link_to = target_doctype
            if hasattr(doc, "doc_view"):
                doc.doc_view = "List"
            doc.save(ignore_permissions=True)
            fixed.append({"name": row.name, "label": row.label, "doctype": target_doctype})

    frappe.db.commit()
    return fixed


def reload_healthcare_workspace():
    """Reload Healthcare workspace from Marley app JSON (fixes broken links)."""
    try:
        frappe.reload_doc("healthcare", "workspace", "healthcare")
    except Exception:
        frappe.reload_doc("healthcare", "workspace", "Healthcare")
    _fix_healthcare_workspace_patient_links()
    _fix_workspace_content_patient_routes()
    fix_healthcare_shortcuts()
    frappe.db.commit()
    frappe.clear_cache()
    return dump_patient_route_debug()


def force_fix_sudip_patient_route():
    """Remove Patient role + fix workspace for sudip."""
    user = "sudip.academics@gmail.com"
    frappe.db.sql("DELETE FROM `tabHas Role` WHERE parent=%s AND role='Patient'", (user,))
    updates = {"default_workspace": "Healthcare"}
    if frappe.db.has_column("User", "home_page"):
        updates["home_page"] = ""
    frappe.db.set_value("User", user, updates, update_modified=False)
    fix_patient_desk_routes()
    frappe.clear_cache(user=user)
    return dump_patient_route_debug()
    """Full Marley desk diagnostic."""
    out = verify_healthcare_desk()
    out["healthcare_workspaces"] = frappe.get_all(
        "Workspace",
        filters={"module": "Healthcare"},
        fields=["name", "title", "public", "is_hidden"],
    )
    out["all_modules_healthcare"] = frappe.get_all(
        "Module Def", filters={"app_name": "healthcare"}, fields=["name"]
    )
    out["healthcare_app_path"] = frappe.get_app_path("healthcare") if "healthcare" in (frappe.get_installed_apps() or []) else None
    try:
        import healthcare  # noqa: F401

        out["healthcare_import"] = "ok"
    except Exception as exc:
        out["healthcare_import"] = str(exc)
    return out


def repair_marley_desk():
    """
    Re-sync Marley healthcare DocTypes, workspaces, build assets, clear cache.
    Run when /app/healthcare and /app/List/Patient show 'Page not found'.
    """
    if "healthcare" not in (frappe.get_installed_apps() or []):
        return {"ok": False, "error": "healthcare app not on site — run install-marley.sh"}

    from frappe.model.sync import sync_for

    sync_for("healthcare", force=True)
    frappe.db.commit()

    # Reload key workspaces from app JSON
    for ws in ("healthcare", "Healthcare"):
        try:
            frappe.reload_doc("healthcare", "workspace", ws.lower())
        except Exception:
            try:
                frappe.reload_doc("healthcare", "workspace", ws)
            except Exception:
                pass

    frappe.db.commit()
    setup_healthcare_desk(seed_demo=False)
    frappe.clear_cache()

    return {"ok": True, "diagnosis": diagnose_marley_desk()}


def get_desk_urls():
    """Return working desk URLs for this site (Frappe v15 route formats)."""
    urls = {
        "home": "/app/home",
        "healthcare_workspace": "/app/healthcare",
        "patient_list": doctype_desk_route("Patient") if frappe.db.exists("DocType", "Patient") else None,
        "practitioner_list": doctype_desk_route("Healthcare Practitioner")
        if frappe.db.exists("DocType", "Healthcare Practitioner")
        else None,
        "practitioner_new": doctype_desk_route("Healthcare Practitioner", view="new")
        if frappe.db.exists("DocType", "Healthcare Practitioner")
        else None,
        "encounter_list": doctype_desk_route("Patient Encounter")
        if frappe.db.exists("DocType", "Patient Encounter")
        else None,
        "broken_do_not_use": [
            "/app/List/Healthcare Practitioner",
            "/app/Healthcare Practitioner",
            "/app/Healthcare%20Practitioner",
            "/app/patient",
        ],
    }
    if frappe.db.exists("Workspace", "Healthcare"):
        urls["healthcare_workspace_alt"] = "/app/Healthcare"
    ws = frappe.get_all("Workspace", filters={"module": "Healthcare"}, pluck="name")
    urls["healthcare_workspaces"] = {name: f"/app/{name}" for name in ws}
    urls["tip"] = (
        "Frappe v15 uses slug URLs. Open practitioner_list above, "
        "or Healthcare workspace and click Masters > Healthcare Practitioner."
    )
    return urls
