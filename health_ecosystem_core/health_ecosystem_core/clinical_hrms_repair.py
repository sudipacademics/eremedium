"""Repair partial HRMS install — import missing DocTypes or drop broken link fields."""

from __future__ import annotations

import json
import os
import re

import frappe

HRMS_BASE = "/home/frappe/frappe-bench/apps/hrms/hrms"
HRMS_DOCTYPE_DIRS = ("hr/doctype", "payroll/doctype")

CRITICAL_DOCTYPES = (
    "Employee",
    "Leave Allocation",
    "Leave Application",
    "Leave Type",
    "Expense Claim",
    "Attendance",
    "Shift Type",
)

# HR + lightweight payroll JSON imports (schema only — avoids broken Python modules).
PRIORITY_HR_FOLDERS = (
    "compensatory_leave_request",
    "leave_policy",
    "leave_policy_assignment",
    "leave_period",
    "leave_block_list",
    "leave_control_panel",
    "shift_type",
    "shift_location",
    "shift_assignment",
    "shift_request",
    "employee_advance",
    "expense_claim_type",
    "employee_separation",
    "employee_onboarding",
    "employee_transfer",
    "employee_promotion",
    "employee_grievance",
    "attendance_request",
    "employee_checkin",
    "travel_request",
    "training_event",
    "training_program",
    "training_event_employee",
    "training_feedback",
    "kra",
    "appraisal_template",
    "appraisal_template_goal",
    "appraisal_cycle",
    "appraisal",
    "appraisal_kra",
    "appraisal_goal",
    "employee_feedback_criteria",
    "employee_feedback_rating",
    "salary_component_account",
    "salary_detail",
    "salary_component",
    "salary_structure",
    "salary_structure_assignment",
    "payroll_period",
    "payroll_entry",
    "salary_slip",
    "salary_slip_timesheet",
    "additional_salary",
    "retention_bonus",
    "employee_tax_exemption_declaration",
    "employee_tax_exemption_proof_submission",
    "employee_tax_exemption_category",
    "employee_tax_exemption_sub_category",
    "gratuity",
    "gratuity_rule",
    "income_tax_slab",
)

SEED_RECORDS = {
    "Shift Type": {
        "name": "General",
        "shift_type_name": "General",
        "start_time": "09:00:00",
        "end_time": "18:00:00",
    },
    "Salary Component": {
        "name": "Basic",
        "salary_component": "Basic",
        "type": "Earning",
    },
}

MISSING_LINK_RE = re.compile(
    r"Field (\w+) is referring to non-existing doctype (.+?)\.",
    re.IGNORECASE,
)


def _hrms_doctype_json(doctype_folder: str) -> str | None:
    for sub in HRMS_DOCTYPE_DIRS:
        path = os.path.join(HRMS_BASE, sub, doctype_folder, f"{doctype_folder}.json")
        if os.path.isfile(path):
            return path
    return None


def _import_doctype_json(path: str) -> bool:
    from frappe.modules.import_file import import_file_by_path

    try:
        import_file_by_path(path, force=True)
        return True
    except Exception:
        frappe.log_error(title="hrms_import_doctype", message=f"{path}\n{frappe.get_traceback()}")
        return False


def _import_folder(folder: str) -> bool:
    path = _hrms_doctype_json(folder)
    if not path:
        return False
    try:
        with open(path, encoding="utf-8") as handle:
            dt = json.load(handle).get("name")
    except Exception:
        dt = None
    if dt and frappe.db.exists("DocType", dt):
        return True
    return _import_doctype_json(path)


def _ensure_seed_records():
    created = []
    for doctype, payload in SEED_RECORDS.items():
        if not frappe.db.exists("DocType", doctype):
            continue
        name = payload.get("name")
        if name and frappe.db.exists(doctype, name):
            continue
        try:
            frappe.get_doc({"doctype": doctype, **payload}).insert(ignore_permissions=True)
            created.append(f"{doctype}:{name}")
        except Exception:
            frappe.log_error(title="hrms_seed_record", message=frappe.get_traceback())
    return created


def import_priority_hrms_doctypes() -> list[str]:
    imported = []
    for folder in PRIORITY_HR_FOLDERS:
        path = _hrms_doctype_json(folder)
        if not path:
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                dt = json.load(handle).get("name")
        except Exception:
            continue
        if dt and frappe.db.exists("DocType", dt):
            continue
        if _import_folder(folder):
            imported.append(dt or folder)
    if imported:
        frappe.db.commit()
        frappe.clear_cache()
    return imported


def _doctype_table_exists(doctype: str) -> bool:
    try:
        frappe.db.get_table_columns(doctype)
        return True
    except Exception:
        return False


def sync_hrms_tables() -> list[str]:
    """Create DB tables for imported HRMS DocTypes (partial install leaves meta without tables)."""
    synced = []
    for folder in PRIORITY_HR_FOLDERS:
        path = _hrms_doctype_json(folder)
        if not path:
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                dt = json.load(handle).get("name")
        except Exception:
            continue
        if not dt:
            continue
        if not frappe.db.exists("DocType", dt):
            _import_folder(folder)
        if not frappe.db.exists("DocType", dt):
            continue
        if _doctype_table_exists(dt):
            continue
        try:
            frappe.db.updatedb(dt)
            synced.append(dt)
        except Exception:
            frappe.log_error(title="hrms_sync_table", message=f"{dt}\n{frappe.get_traceback()}")
    if synced:
        frappe.db.commit()
        frappe.clear_cache()
    return synced


@frappe.whitelist()
def safe_get_timeline_data(doctype, name, items=None):
    """HRMS timeline wrapper — partial install may reference DocTypes without DB tables."""
    try:
        from hrms.overrides.employee_master import get_timeline_data

        return get_timeline_data(doctype, name, items)
    except Exception:
        frappe.log_error(title="hrms_timeline_fallback", message=frappe.get_traceback())
        return {}


def ensure_hrms_modules():
    """Ensure Module Def rows exist so migrate/import does not throw 'Module HR not found'."""
    created = []
    for mod_name, app in (("HR", "hrms"), ("HRMS", "hrms"), ("Payroll", "hrms")):
        if frappe.db.exists("Module Def", mod_name):
            try:
                frappe.db.set_value("Module Def", mod_name, "app_name", app, update_modified=False)
            except Exception:
                pass
        else:
            try:
                frappe.get_doc(
                    {
                        "doctype": "Module Def",
                        "module_name": mod_name,
                        "app_name": app,
                    }
                ).insert(ignore_permissions=True)
                created.append(mod_name)
            except Exception:
                frappe.log_error(title="ensure_hrms_modules", message=frappe.get_traceback())
        # Runtime bind — Frappe looks up scrubbed keys (hr, payroll), not display names.
        try:
            if not getattr(frappe.local, "module_app", None):
                frappe.local.module_app = frappe._dict()
            scrubbed = frappe.scrub(mod_name)
            frappe.local.module_app[scrubbed] = app
            frappe.local.module_app[mod_name] = app
            frappe.local.module_app[mod_name.lower()] = app
        except Exception:
            pass
    frappe.db.commit()
    return {"ok": True, "created": created, "installed_apps": frappe.get_installed_apps()}


def bind_hrms_module_app():
    """Per-request bind so Desk never throws Module HR not found when hrms is installed."""
    try:
        installed = set(frappe.get_installed_apps() or [])
        if "hrms" not in installed and not frappe.db.exists("Module Def", "HR"):
            return
        if not getattr(frappe.local, "module_app", None):
            frappe.local.module_app = frappe._dict()
        for key in ("hr", "HR", "hrms", "HRMS", "payroll", "Payroll"):
            frappe.local.module_app[key] = "hrms"
    except Exception:
        pass


@frappe.whitelist()
def provision_hr_manager_identity(email=None, password=None, full_name=None):
    """Create / repair HR Manager User + Employee ID (HR-EMP-#####). System Manager only."""
    frappe.only_for(("System Manager", "Administrator"))
    ensure_hrms_installed_app()
    ensure_hrms_modules()
    bind_hrms_module_app()

    from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
        DEMO_HR_MANAGER,
        seed_demo_hr_manager,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
        ensure_employee_for_user,
        ensure_hr_settings,
    )

    ensure_hr_settings()
    if email:
        from frappe.utils.password import update_password

        email = str(email).strip().lower()
        first = (full_name or "HR").split(None, 1)[0]
        last = " ".join((full_name or "Manager").split(None, 1)[1:] or ["Manager"])
        for role in ("HR Manager", "HR User", "Employee"):
            if not frappe.db.exists("Role", role):
                frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
                    ignore_permissions=True
                )
        if not frappe.db.exists("User", email):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": first,
                    "last_name": last,
                    "user_type": "System User",
                    "send_welcome_email": 0,
                    "enabled": 1,
                }
            ).insert(ignore_permissions=True)
        user = frappe.get_doc("User", email)
        user.enabled = 1
        user.user_type = "System User"
        # Strip Agency Agent roles so HR never lands on Agents portal by role mix-up.
        user.roles = [r for r in user.roles if r.role not in ("Agency Agent", "Agency Manager")]
        existing = {r.role for r in user.roles}
        for role in ("HR Manager", "HR User", "Employee"):
            if role not in existing:
                user.append("roles", {"role": role})
        user.save(ignore_permissions=True)
        if password:
            update_password(email, password, logout_all_sessions=False)
        employee = ensure_employee_for_user(email)
        frappe.db.commit()
        return {
            "ok": True,
            "email": email,
            "employee_id": employee,
            "roles": [r.role for r in user.roles],
            "login_url": "/hr/login",
        }

    seeded = seed_demo_hr_manager()
    employee = ensure_employee_for_user(seeded["email"])
    frappe.db.commit()
    return {
        "ok": True,
        "email": seeded["email"],
        "password": seeded.get("password") or DEMO_HR_MANAGER["password"],
        "employee_id": employee,
        "roles": seeded.get("roles") or list(DEMO_HR_MANAGER["roles"]),
        "login_url": "/hr/login",
    }


def ensure_hrms_installed_app():
    """Ensure apps.txt + Installed Applications declare hrms (no partial state)."""
    import os

    apps_txt = os.path.join(frappe.utils.get_bench_path(), "sites", "apps.txt")
    if os.path.isfile(apps_txt):
        lines = [ln.strip() for ln in open(apps_txt, encoding="utf-8").read().splitlines() if ln.strip()]
        if "hrms" not in lines:
            with open(apps_txt, "a", encoding="utf-8") as fh:
                fh.write("hrms\n")

    ensure_hrms_modules()

    version = "15.63.0"
    try:
        import hrms

        version = getattr(hrms, "__version__", version)
    except Exception:
        pass

    # Frappe stores apps on Single "Installed Applications" child table
    if frappe.db.exists("DocType", "Installed Applications"):
        doc = frappe.get_single("Installed Applications")
        existing = {row.app_name for row in (doc.installed_applications or [])}
        if "hrms" not in existing:
            doc.append(
                "installed_applications",
                {"app_name": "hrms", "app_version": version, "git_branch": "version-15"},
            )
            doc.save(ignore_permissions=True)
            frappe.db.commit()
            return {"ok": True, "created": True, "apps": frappe.get_installed_apps()}
        return {"ok": True, "created": False, "apps": frappe.get_installed_apps()}

    return {"ok": True, "created": False, "apps": frappe.get_installed_apps(), "note": "Installed Applications missing"}


def smoke_employee_desk():
    """Quick meta/timeline smoke for Employee + HR DocTypes."""
    out = {
        "ok": True,
        "apps": frappe.get_installed_apps(),
        "employee_meta_fields": 0,
        "sample_employee": None,
        "doctypes": {},
    }
    try:
        out["employee_meta_fields"] = len(frappe.get_meta("Employee").fields)
        emp = frappe.db.get_value("Employee", {}, "name")
        out["sample_employee"] = emp
        if emp:
            out["timeline"] = safe_get_timeline_data("Employee", emp)
    except Exception as exc:
        out["ok"] = False
        out["employee_error"] = str(exc)[:200]
    for dt in (
        "Leave Application",
        "Expense Claim",
        "Salary Component",
        "Salary Structure",
        "Payroll Entry",
        "Salary Slip",
        "Job Opening",
    ):
        out["doctypes"][dt] = bool(frappe.db.exists("DocType", dt))
    return out


def _remove_broken_field(parent: str, fieldname: str) -> bool:
    removed = False
    if frappe.db.exists("DocField", {"parent": parent, "fieldname": fieldname}):
        frappe.db.delete("DocField", {"parent": parent, "fieldname": fieldname})
        removed = True
    for row in frappe.get_all(
        "Custom Field",
        filters={"dt": parent, "fieldname": fieldname},
        pluck="name",
    ):
        frappe.delete_doc("Custom Field", row, force=1, ignore_permissions=True)
        removed = True
    return removed


def _repair_doctype_meta(doctype: str, max_rounds: int = 12) -> dict:
    removed_fields: list[str] = []
    imported_targets: list[str] = []

    for _ in range(max_rounds):
        try:
            frappe.clear_cache(doctype=doctype)
            frappe.get_meta(doctype)
            return {
                "doctype": doctype,
                "ok": True,
                "removed_fields": removed_fields,
                "imported_targets": imported_targets,
            }
        except Exception as exc:
            msg = str(exc)
            match = MISSING_LINK_RE.search(msg)
            if not match:
                return {
                    "doctype": doctype,
                    "ok": False,
                    "error": msg[:300],
                    "removed_fields": removed_fields,
                    "imported_targets": imported_targets,
                }

            fieldname, target = match.group(1), match.group(2).strip()
            target_folder = target.lower().replace(" ", "_")

            if not frappe.db.exists("DocType", target):
                if _import_folder(target_folder):
                    imported_targets.append(target)
                    frappe.db.commit()
                    frappe.clear_cache()
                    continue

            if _remove_broken_field(doctype, fieldname):
                removed_fields.append(f"{doctype}.{fieldname}->{target}")
                frappe.db.commit()
                continue

            return {
                "doctype": doctype,
                "ok": False,
                "error": msg[:300],
                "removed_fields": removed_fields,
                "imported_targets": imported_targets,
            }

    return {
        "doctype": doctype,
        "ok": False,
        "error": "max repair rounds exceeded",
        "removed_fields": removed_fields,
        "imported_targets": imported_targets,
    }


def repair_hrms_employee_fields():
    return run_repair()


def run_repair():
    if not os.path.isdir(HRMS_BASE):
        return {"ok": False, "reason": "hrms app not installed on bench"}

    imported = import_priority_hrms_doctypes()
    tables_synced = sync_hrms_tables()
    seeded = _ensure_seed_records()

    validations = []
    all_ok = True
    for dt in CRITICAL_DOCTYPES:
        if not frappe.db.exists("DocType", dt):
            validations.append({"doctype": dt, "ok": False, "error": "DocType missing"})
            all_ok = False
            continue
        result = _repair_doctype_meta(dt)
        validations.append(result)
        if not result.get("ok"):
            all_ok = False

    frappe.clear_cache()
    frappe.db.commit()

    return {
        "ok": all_ok,
        "imported": imported,
        "tables_synced": tables_synced,
        "seeded": seeded,
        "validations": validations,
    }
