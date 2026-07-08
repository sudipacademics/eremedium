"""
System initialization: roles, default users, sample data, API credentials.
Run via: bench --site <site> execute health_ecosystem_core.health_ecosystem_core.init.setup_system
"""

import frappe
from frappe.utils import now_datetime

MODULE_NAME = "Health Ecosystem Core"
APP_NAME = "health_ecosystem_core"


def ensure_module_def():
    """Register desk module (required before Franchisee Profile etc. load)."""
    if frappe.db.exists("Module Def", MODULE_NAME):
        return
    frappe.get_doc(
        {
            "doctype": "Module Def",
            "module_name": MODULE_NAME,
            "app_name": APP_NAME,
            "custom": 0,
        }
    ).insert(ignore_permissions=True)
    frappe.db.commit()


DEFAULT_USERS = [
    {
        "email": "system_admin@health.local",
        "username": "system_admin",
        "first_name": "System",
        "last_name": "Admin",
        "password": "AdminChangeMe@123",
        "roles": ["Health System Admin", "System Manager"],
    },
    {
        "email": "franchise_hub@health.local",
        "username": "franchise_hub",
        "first_name": "Franchise",
        "last_name": "Hub",
        "password": "HubChangeMe@123",
        "roles": ["Franchisee Operator"],
    },
    {
        "email": "lab_tech@health.local",
        "username": "lab_tech_core",
        "first_name": "Lab",
        "last_name": "Technician",
        "password": "TechChangeMe@123",
        "roles": ["Lab Technician"],
    },
]


def after_install():
    setup_system()


def setup_system():
    ensure_module_def()
    _create_roles()
    _create_settings()
    _create_users()
    try:
        _create_sample_franchisee()
    except Exception:
        frappe.log_error(title="setup_system franchisee", message=frappe.get_traceback())
    try:
        _create_sample_items()
    except Exception:
        frappe.log_error(title="setup_system sample items", message=frappe.get_traceback())
    try:
        _seed_mobile_content()
    except Exception:
        frappe.log_error(title="setup_system mobile content", message=frappe.get_traceback())
    try:
        _set_api_credentials()
    except Exception:
        frappe.log_error(title="setup_system api credentials", message=frappe.get_traceback())
    try:
        ensure_healthcare_sales_invoice_fields()
    except Exception:
        frappe.log_error(title="setup_system healthcare fields", message=frappe.get_traceback())
    try:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_healthcare_patient_fields

        ensure_healthcare_patient_fields()
    except Exception:
        frappe.log_error(title="setup_system patient bridge", message=frappe.get_traceback())
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_setup import setup_clinical_module

        setup_clinical_module(seed_demo=False)
    except Exception:
        frappe.log_error(title="setup_system clinical module", message=frappe.get_traceback())
    frappe.db.commit()


def clear_mobile_sessions():
    """Clear all Frappe sessions after server rebuild (forces app re-login)."""
    try:
        from frappe.sessions import clear_all_sessions

        clear_all_sessions()
    except Exception:
        frappe.db.sql("DELETE FROM `tabSessions`")
    frappe.db.commit()
    return "All sessions cleared. Log in again in the mobile app."


def ensure_healthcare_sales_invoice_fields():
    """Marley Healthcare hooks require service_unit on Sales Invoice — create if migrate missed it."""
    installed = frappe.get_installed_apps() or []
    if "healthcare" not in installed:
        return "healthcare app not installed — skipped"

    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Sales Invoice": [
                {
                    "fieldname": "service_unit",
                    "label": "Service Unit",
                    "fieldtype": "Link",
                    "options": "Healthcare Service Unit",
                    "insert_after": "customer",
                },
                {
                    "fieldname": "patient",
                    "label": "Patient",
                    "fieldtype": "Link",
                    "options": "Patient",
                    "insert_after": "customer_name",
                },
            ],
            "Sales Invoice Item": [
                {
                    "fieldname": "service_unit",
                    "label": "Service Unit",
                    "fieldtype": "Link",
                    "options": "Healthcare Service Unit",
                    "insert_after": "item_code",
                },
            ],
        },
        update=True,
    )
    frappe.clear_cache(doctype="Sales Invoice")
    frappe.db.commit()
    return "Healthcare Sales Invoice custom fields ensured"


def repair_mobile_permissions():
    """Reload Health Ecosystem DocType permissions (safe after ERPNext permission overrides)."""
    for doctype in ("customer_trf", "pharmacy_order", "franchisee_profile"):
        try:
            frappe.reload_doc("health_ecosystem_core", "doctype", doctype)
        except Exception:
            frappe.log_error(
                title=f"repair_mobile_permissions {doctype}",
                message=frappe.get_traceback(),
            )
    frappe.clear_cache()
    frappe.db.commit()
    return "Mobile DocType permissions reloaded."


def repair_auth_users():
    """Reset default app users and passwords. Run on server if login fails."""
    _create_roles()
    _create_users()
    try:
        repair_mobile_permissions()
    except Exception:
        frappe.log_error(title="repair_auth_users permissions", message=frappe.get_traceback())
    try:
        ensure_healthcare_sales_invoice_fields()
    except Exception:
        frappe.log_error(title="repair_auth_users healthcare fields", message=frappe.get_traceback())
    try:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_healthcare_patient_fields

        ensure_healthcare_patient_fields()
    except Exception:
        frappe.log_error(title="repair_auth_users patient bridge", message=frappe.get_traceback())
    try:
        from health_ecosystem_core.health_ecosystem_core.healthcare_setup import ensure_healthcare_roles_on_users

        ensure_healthcare_roles_on_users()
    except Exception:
        frappe.log_error(title="repair_auth_users healthcare roles", message=frappe.get_traceback())
    try:
        _create_sample_franchisee()
    except Exception:
        frappe.log_error(title="repair_auth_users franchisee", message=frappe.get_traceback())
    frappe.db.commit()
    return "Default users repaired. Login with system_admin / franchise_hub / lab_tech_core"


def _create_roles():
    roles = [
        {
            "name": "Health System Admin",
            "desk_access": 1,
            "role_name": "Health System Admin",
        },
        {
            "name": "Franchisee Operator",
            "desk_access": 1,
            "role_name": "Franchisee Operator",
        },
        {
            "name": "Lab Technician",
            "desk_access": 1,
            "role_name": "Lab Technician",
        },
    ]
    for role_data in roles:
        if not frappe.db.exists("Role", role_data["name"]):
            frappe.get_doc({"doctype": "Role", **role_data}).insert(ignore_permissions=True)


def _create_settings():
    if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
        return

    if not frappe.db.exists("Health Ecosystem Settings", "Health Ecosystem Settings"):
        doc = frappe.get_doc(
            {
                "doctype": "Health Ecosystem Settings",
                "api_key": "hec_live_api_key_change_me",
                "api_secret": "hec_live_api_secret_change_me",
                "razorpay_key_id": "rzp_test_change_me",
                "razorpay_key_secret": "razorpay_secret_change_me",
            }
        )
        doc.insert(ignore_permissions=True)


def _create_users():
    for spec in DEFAULT_USERS:
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
        user.user_type = "System User"
        existing = {r.role for r in user.roles}
        for role in spec["roles"]:
            if role not in existing:
                user.append("roles", {"role": role})
        user.save(ignore_permissions=True)
        frappe.db.commit()
        if not frappe.get_all("Has Role", filters={"parent": spec["email"]}, pluck="role"):
            from health_ecosystem_core.health_ecosystem_core.healthcare_setup import _force_user_roles

            _force_user_roles(spec["email"], spec["roles"])
        if not [r.role for r in user.roles]:
            user.add_roles(*spec["roles"])
            frappe.db.commit()

        from frappe.utils.password import update_password

        update_password(spec["email"], spec["password"], logout_all_sessions=False)


def _create_sample_franchisee():
    if frappe.db.exists("Franchisee Profile", "HUB001"):
        franchisee = frappe.get_doc("Franchisee Profile", "HUB001")
    else:
        franchisee = frappe.get_doc(
            {
                "doctype": "Franchisee Profile",
                "franchise_name": "Central Health Hub",
                "branch_code": "HUB001",
                "owner_name": "Franchise Hub Operator",
                "territory_region": "Metro North",
                "commission_percentage_rate": 12.5,
                "active_status": "Active",
                "linked_user": "franchise_hub@health.local",
                "contact_email": "franchise_hub@health.local",
                "contact_phone": "+91-9876543210",
            }
        )
        franchisee.insert(ignore_permissions=True)

    franchisee.linked_user = "franchise_hub@health.local"
    franchisee.save(ignore_permissions=True)

    _seed_extra_franchisees()


def _seed_extra_franchisees():
    extras = [
        {
            "branch_code": "HUB002",
            "franchise_name": "South City Diagnostics",
            "owner_name": "South Hub Admin",
            "territory_region": "Metro South",
            "address": "12 MG Road, South City",
            "contact_phone": "+91-9876543211",
        },
        {
            "branch_code": "HUB003",
            "franchise_name": "Eastside Health Lab",
            "owner_name": "East Hub Admin",
            "territory_region": "Metro East",
            "address": "88 Lake View Avenue",
            "contact_phone": "+91-9876543212",
        },
        {
            "branch_code": "HUB004",
            "franchise_name": "Westend Wellness",
            "owner_name": "West Hub Admin",
            "territory_region": "Metro West",
            "address": "5 Park Street, Westend",
            "contact_phone": "+91-9876543213",
        },
    ]
    for spec in extras:
        if frappe.db.exists("Franchisee Profile", spec["branch_code"]):
            doc = frappe.get_doc("Franchisee Profile", spec["branch_code"])
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "Franchisee Profile",
                    "franchise_name": spec["franchise_name"],
                    "branch_code": spec["branch_code"],
                    "owner_name": spec["owner_name"],
                    "territory_region": spec["territory_region"],
                    "commission_percentage_rate": 10,
                    "active_status": "Active",
                    "address": spec["address"],
                    "contact_phone": spec["contact_phone"],
                }
            )
            doc.insert(ignore_permissions=True)
            continue
        doc.franchise_name = spec["franchise_name"]
        doc.territory_region = spec["territory_region"]
        doc.address = spec["address"]
        doc.contact_phone = spec["contact_phone"]
        doc.active_status = "Active"
        doc.save(ignore_permissions=True)


def _create_sample_items():
    companies = frappe.get_all("Company", limit=1)
    if not companies:
        return
    company = companies[0].name
    item_groups = [
        ("Lab Tests", "Lab Tests"),
        ("Medicines", "Medicines"),
        ("Pharmacy", "Pharmacy"),
    ]
    for group_name, parent in item_groups:
        if not frappe.db.exists("Item Group", group_name):
            frappe.get_doc(
                {
                    "doctype": "Item Group",
                    "item_group_name": group_name,
                    "parent_item_group": "All Item Groups",
                    "is_group": 0,
                }
            ).insert(ignore_permissions=True)

    lab_tests = [
        ("CBC-001", "Complete Blood Count (CBC)", 450, "Lab Tests"),
        ("LFT-001", "Liver Function Test (LFT)", 650, "Lab Tests"),
        ("TSH-001", "Thyroid Profile (TSH)", 550, "Lab Tests"),
        ("HBA1C-001", "HbA1c Diabetes Panel", 500, "Lab Tests"),
        ("LIPID-001", "Lipid Profile", 600, "Lab Tests"),
    ]

    for code, name, rate, group in lab_tests:
        if not frappe.db.exists("Item", code):
            item = frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": name,
                    "item_group": group,
                    "stock_uom": "Nos",
                    "is_stock_item": 0,
                    "is_sales_item": 1,
                    "standard_rate": rate,
                    "description": name,
                }
            )
            item.insert(ignore_permissions=True)

    medicines = [
        ("MED-PARA-500", "Paracetamol 500mg", 25, "Medicines"),
        ("MED-AMOX-250", "Amoxicillin 250mg", 89, "Medicines"),
        ("MED-CET-10", "Cetirizine 10mg", 35, "Medicines"),
        ("MED-OME-20", "Omeprazole 20mg", 65, "Medicines"),
    ]

    for code, name, rate, group in medicines:
        if not frappe.db.exists("Item", code):
            item = frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": name,
                    "item_group": group,
                    "stock_uom": "Nos",
                    "is_stock_item": 1,
                    "is_sales_item": 1,
                    "standard_rate": rate,
                }
            )
            item.insert(ignore_permissions=True)


def _seed_mobile_content():
    """Default mobile banners and promotions (editable in ERPNext desk)."""
    if not frappe.db.exists("DocType", "Mobile Home Banner"):
        return

    banners = [
        {
            "banner_title": "Home Sample Collection",
            "subtitle": "Certified phlebotomists at your doorstep",
            "color": "#0D9488",
            "icon": "home_health",
            "display_order": 1,
        },
        {
            "banner_title": "Full Body Checkup",
            "subtitle": "Up to 30% off on health packages",
            "color": "#2563EB",
            "icon": "favorite",
            "display_order": 2,
        },
        {
            "banner_title": "Medicines in 30 mins",
            "subtitle": "Upload prescription & order online",
            "color": "#7C3AED",
            "icon": "medication",
            "display_order": 3,
        },
    ]
    for spec in banners:
        if frappe.db.exists("Mobile Home Banner", spec["banner_title"]):
            continue
        frappe.get_doc({"doctype": "Mobile Home Banner", "enabled": 1, **spec}).insert(
            ignore_permissions=True
        )

    if not frappe.db.exists("DocType", "Mobile Promotion"):
        return

    promos = [
        {
            "promo_label": "FIRST10",
            "title": "10% off first lab booking",
            "description": "Use at checkout",
            "display_order": 1,
            "discount_percent": 10,
            "applies_to": "Lab Diagnostics",
        },
        {
            "promo_label": "HEALTH25",
            "title": "₹25 off pharmacy",
            "description": "Min order ₹299",
            "display_order": 2,
            "discount_amount": 25,
            "min_order_amount": 299,
            "applies_to": "Pharmacy",
        },
        {
            "promo_label": "FAMILY",
            "title": "Family health packages",
            "description": "CBC + LFT combo deals",
            "display_order": 3,
            "discount_percent": 5,
            "applies_to": "Lab Diagnostics",
        },
    ]
    for spec in promos:
        if frappe.db.exists("Mobile Promotion", spec["promo_label"]):
            doc = frappe.get_doc("Mobile Promotion", spec["promo_label"])
            changed = False
            for key, value in spec.items():
                if key == "promo_label":
                    continue
                if doc.meta.has_field(key) and not doc.get(key) and value:
                    doc.set(key, value)
                    changed = True
            if changed:
                doc.save(ignore_permissions=True)
            continue
        frappe.get_doc({"doctype": "Mobile Promotion", "enabled": 1, **spec}).insert(
            ignore_permissions=True
        )


def _get_default_company():
    companies = frappe.get_all("Company", limit=1)
    if companies:
        return companies[0].name
    return None


def _set_api_credentials():
    frappe.conf.health_api_key = "hec_live_api_key_change_me"
    frappe.conf.health_api_secret = "hec_live_api_secret_change_me"

    from frappe.installer import update_site_config

    update_site_config(
        "health_api_key",
        "hec_live_api_key_change_me",
        validate=False,
    )
    update_site_config(
        "health_api_secret",
        "hec_live_api_secret_change_me",
        validate=False,
    )


def run_phase6_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase6_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import setup_phase6

    return setup_phase6()


def run_phase8_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase8_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import setup_phase8

    return setup_phase8()


def run_phase9_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase9_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase9 import setup_phase9

    return setup_phase9()


def run_clinical_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_clinical_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_setup import setup_clinical_module

    return setup_clinical_module()


def run_phase11_iam():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase11_iam"""
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import setup_iam

    return setup_iam()


def run_phase20_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase20_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import setup_phase20

    return setup_phase20()


def run_phase21_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase21_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import setup_phase21

    return setup_phase21()


def run_phase19_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase19_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import setup_phase19

    return setup_phase19()


def run_phase23_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase23_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import setup_phase23

    return setup_phase23()


def run_phase24_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase24_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import setup_phase24

    return setup_phase24()


def run_phase24_smoke_test():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase24_smoke_test"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import smoke_phase24_reagents

    return smoke_phase24_reagents()


def run_phase25_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase25_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import setup_phase25

    return setup_phase25()


def run_phase26_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase26_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import setup_phase26

    return setup_phase26()


def run_phase26_repair_subscriptions():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase26_repair_subscriptions"""
    import frappe

    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import repair_pending_subscriptions

    result = repair_pending_subscriptions()
    frappe.db.commit()
    frappe.clear_cache()
    return result


def ensure_smoke_circle_patient(email="circle_test@health.local", password="CircleTestChangeMe@123"):
    """Create/update patient user for Circle smoke tests."""
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import PATIENT_ROLE, _upsert_iam_user

    _upsert_iam_user(
        {
            "email": email,
            "username": email.split("@")[0],
            "first_name": "Circle",
            "last_name": "Smoke Test",
            "password": password,
            "roles": [PATIENT_ROLE],
            "user_type": "Website User",
        }
    )
    frappe.db.commit()
    return {"email": email, "ok": True}


def run_phase26_smoke_test(email="circle_test@health.local", password="CircleTestChangeMe@123"):
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase26_smoke_test"""
    from frappe.utils import flt

    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import (
        get_active_subscription,
        get_entitlements,
        subscribe_user,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import preview_checkout, setup_phase26

    setup_phase26()
    ensure_smoke_circle_patient(email, password)

    if not get_active_subscription(email):
        try:
            subscribe_user(email, "CIRCLE_12M")
        except Exception as exc:
            if "already have" not in str(exc).lower():
                raise

    entitlements = get_entitlements(email)
    preview = preview_checkout(email, 1000, "lab")
    sub = get_active_subscription(email)
    passed = bool(entitlements.get("active")) and flt(preview.get("membership_discount")) > 0

    return {
        "pass": passed,
        "user": email,
        "subscription_status": sub.get("status") if sub else None,
        "plan": (sub.get("plan") or {}).get("plan_code") if sub else None,
        "entitlements_active": entitlements.get("active"),
        "lab_discount_percent": entitlements.get("lab_discount_percent"),
        "preview_subtotal": preview.get("subtotal"),
        "preview_membership_discount": preview.get("membership_discount"),
        "preview_final_total": preview.get("final_total"),
    }


def run_phase27_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase27_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase27 import setup_phase27

    return setup_phase27()


def run_phase27_smoke_test():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase27_smoke_test"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase27 import (
        setup_phase27,
        smoke_scheduled_reminders,
    )

    setup_phase27()
    return smoke_scheduled_reminders()


def run_phase27b_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase27b_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import setup_phase27b

    return setup_phase27b()


def run_phase27b_seed_demo():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase27b_seed_demo"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import seed_demo_commissions, setup_phase27b

    setup_phase27b()
    return seed_demo_commissions()


def run_phase18b_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase18b_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import setup_phase18b

    return setup_phase18b()


def run_phase18b_smoke_test():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase18b_smoke_test"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import smoke_phase18b_oauth

    return smoke_phase18b_oauth()


def run_phase28_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops import setup_phase28

    return setup_phase28()


def run_phase28_smoke_test():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_smoke_test"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops import smoke_phase28_ops

    return smoke_phase28_ops()


def run_phase28_dispatch_now():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_dispatch_now"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops import run_all_ops_emails_now

    return run_all_ops_emails_now()


def run_phase29_setup():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_setup"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import setup_phase29

    return setup_phase29()


def run_phase29_lab_import():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_lab_import"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import import_lab_items_from_csv

    return import_lab_items_from_csv()


def run_phase29_smoke_test():
    """bench --site SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_smoke_test"""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import smoke_phase29_lab_import

    return smoke_phase29_lab_import(limit=10)
