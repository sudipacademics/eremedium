"""
Phase 8: NABL-style lab report authoring (legacy biochemistry report parity).

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase8.setup_phase8
"""

import json
import os

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, now_datetime


# Never print these as Typed by / Approved by — not result-entry staff.
_ATTRIBUTION_SYSTEM_USERS = frozenset(
    {
        "administrator",
        "guest",
        "admin",
        "system",
    }
)


def ensure_lab_report_attribution_fields():
    """Typed by / Approved by audit fields for printed report footer."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("DocType", "Lab Report"):
        return
    meta = frappe.get_meta("Lab Report")
    if meta.has_field("typed_by_name") and meta.has_field("approved_by_name"):
        return
    create_custom_fields(
        {
            "Lab Report": [
                {
                    "fieldname": "typed_by_user",
                    "label": "Typed By (User)",
                    "fieldtype": "Link",
                    "options": "User",
                    "insert_after": "section_signoff",
                    "read_only": 1,
                },
                {
                    "fieldname": "typed_by_name",
                    "label": "Typed By",
                    "fieldtype": "Data",
                    "insert_after": "typed_by_user",
                    "read_only": 1,
                },
                {
                    "fieldname": "approved_by_user",
                    "label": "Approved By (User)",
                    "fieldtype": "Link",
                    "options": "User",
                    "insert_after": "typed_by_name",
                    "read_only": 1,
                },
                {
                    "fieldname": "approved_by_name",
                    "label": "Approved By",
                    "fieldtype": "Data",
                    "insert_after": "approved_by_user",
                    "read_only": 1,
                },
            ]
        },
        ignore_validate=True,
        update=True,
    )
    frappe.clear_cache(doctype="Lab Report")


def _is_system_attribution_user(user):
    u = cstr(user or "").strip()
    if not u:
        return True
    low = u.lower()
    if low in _ATTRIBUTION_SYSTEM_USERS:
        return True
    if low.split("@", 1)[0] in _ATTRIBUTION_SYSTEM_USERS:
        return True
    return False


def _is_valid_attribution_label(label):
    text = cstr(label or "").strip()
    if not text:
        return False
    return text.lower() not in _ATTRIBUTION_SYSTEM_USERS


def portal_employee_display(user=None):
    """Employee name for a portal login (Employee.user_id → employee_name).

    System accounts (Administrator / Guest) never resolve to a printable name.
    """
    user = cstr(user or "").strip()
    if _is_system_attribution_user(user):
        return ""
    try:
        if frappe.db.exists("DocType", "Employee"):
            emp_name = frappe.db.get_value("Employee", {"user_id": user}, "employee_name")
            emp_name = cstr(emp_name or "").strip()
            if emp_name and _is_valid_attribution_label(emp_name):
                return emp_name
    except Exception:
        frappe.log_error(title="portal_employee_display", message=frappe.get_traceback())
    full = cstr(frappe.db.get_value("User", user, "full_name") or "").strip()
    if full and _is_valid_attribution_label(full):
        return full
    if "@" in user:
        local = user.split("@", 1)[0].strip()
        return local if _is_valid_attribution_label(local) else ""
    return user if _is_valid_attribution_label(user) else ""


def infer_typed_by_user_from_history(lab_report_name):
    """Who actually entered results — Version trail of parameter edits (never system users)."""
    name = cstr(lab_report_name or "").strip()
    if not name:
        return ""
    try:
        versions = frappe.get_all(
            "Version",
            filters={"ref_doctype": "Lab Report", "docname": name},
            fields=["owner", "creation", "data"],
            order_by="creation asc",
            limit_page_length=80,
        )
    except Exception:
        versions = []
    last_param_editor = ""
    last_any_editor = ""
    for row in versions:
        owner = cstr(row.get("owner") or "").strip()
        if _is_system_attribution_user(owner):
            continue
        last_any_editor = owner
        blob = cstr(row.get("data") or "")
        if any(
            token in blob
            for token in (
                '"parameters"',
                "result_value",
                "report_status",
                "abnormal_flag",
            )
        ):
            last_param_editor = owner
    if last_param_editor:
        return last_param_editor
    if last_any_editor:
        return last_any_editor
    # Fallback: document owner / modified_by if they are real portal users
    try:
        meta = frappe.db.get_value(
            "Lab Report",
            name,
            ["owner", "modified_by"],
            as_dict=True,
        ) or {}
    except Exception:
        meta = {}
    for candidate in (meta.get("owner"), meta.get("modified_by")):
        if candidate and not _is_system_attribution_user(candidate):
            return cstr(candidate).strip()
    return ""


def stamp_lab_report_typed_by(doc, user=None):
    """Record the LabTech portal employee who entered / saved results.

    Never stamps Administrator/Guest. A real employee save replaces a bad
    system stamp; a system session never overwrites a real employee stamp.
    """
    ensure_lab_report_attribution_fields()
    user = cstr(user or frappe.session.user or "").strip()
    if _is_system_attribution_user(user):
        return ""
    label = portal_employee_display(user)
    if not _is_valid_attribution_label(label):
        return ""
    existing_user = cstr(getattr(doc, "typed_by_user", None) or "").strip()
    if existing_user and not _is_system_attribution_user(existing_user) and _is_system_attribution_user(user):
        return cstr(getattr(doc, "typed_by_name", None) or "")
    if hasattr(doc, "typed_by_user"):
        doc.typed_by_user = user
    if hasattr(doc, "typed_by_name"):
        doc.typed_by_name = label
    return label


def stamp_lab_report_approved_by(lab_report_name, user=None):
    """Record the pathologist / portal employee who authorized (released) the report."""
    ensure_lab_report_attribution_fields()
    user = cstr(user or frappe.session.user or "").strip()
    if _is_system_attribution_user(user) or not lab_report_name:
        return ""
    label = portal_employee_display(user)
    if not _is_valid_attribution_label(label):
        return ""
    updates = {}
    meta = frappe.get_meta("Lab Report")
    if meta.has_field("approved_by_user"):
        updates["approved_by_user"] = user
    if meta.has_field("approved_by_name"):
        updates["approved_by_name"] = label
    if updates:
        frappe.db.set_value("Lab Report", lab_report_name, updates, update_modified=False)
    return label


def resolve_lab_report_attribution(doc):
    """Typed by / Approved by for print — employee who entered / released only.

    Never returns Administrator. Bad stored stamps are healed from Version history.
    """
    ensure_lab_report_attribution_fields()
    typed = cstr(getattr(doc, "typed_by_name", None) or "").strip()
    typed_user = cstr(getattr(doc, "typed_by_user", None) or "").strip()
    approved = cstr(getattr(doc, "approved_by_name", None) or "").strip()
    approved_user = cstr(getattr(doc, "approved_by_user", None) or "").strip()

    if _is_system_attribution_user(typed_user) or not _is_valid_attribution_label(typed):
        inferred = infer_typed_by_user_from_history(getattr(doc, "name", None))
        typed = portal_employee_display(inferred) if inferred else ""
        typed_user = inferred if inferred else ""
        # Heal bad stamp so reprints stay correct
        if (
            typed_user
            and _is_valid_attribution_label(typed)
            and getattr(doc, "name", None)
            and frappe.db.exists("Lab Report", doc.name)
        ):
            try:
                frappe.db.set_value(
                    "Lab Report",
                    doc.name,
                    {"typed_by_user": typed_user, "typed_by_name": typed},
                    update_modified=False,
                )
                doc.typed_by_user = typed_user
                doc.typed_by_name = typed
            except Exception:
                frappe.log_error(title="heal_typed_by", message=frappe.get_traceback())

    if _is_system_attribution_user(approved_user) or not _is_valid_attribution_label(approved):
        pathologist = ""
        journey = cstr(getattr(doc, "care_journey", None) or "").strip()
        if journey and frappe.db.exists("Patient Care Journey", journey):
            pathologist = cstr(frappe.db.get_value("Patient Care Journey", journey, "pathologist") or "")
        candidate = approved_user if not _is_system_attribution_user(approved_user) else pathologist
        if _is_system_attribution_user(candidate):
            candidate = ""
        if not candidate and cstr(getattr(doc, "report_status", "") or "") in ("Authorized", "Printed"):
            mod = cstr(getattr(doc, "modified_by", None) or "")
            if not _is_system_attribution_user(mod):
                candidate = mod
        approved = portal_employee_display(candidate) if candidate else ""

    if not _is_valid_attribution_label(typed):
        typed = ""
    if not _is_valid_attribution_label(approved):
        approved = ""
    return {"typed_by": typed, "approved_by": approved}

DEPT_REPORT_TITLES = {
    "Biochemistry": ("REPORT ON BIOCHEMISTRY", "REPORT ON EXAMINATION OF BLOOD"),
    "Haematology": ("REPORT ON HAEMATOLOGY", "COMPLETE BLOOD COUNT"),
    "Serology": ("REPORT ON SEROLOGY", "IMMUNOLOGY ASSAY"),
    "Microbiology": ("REPORT ON MICROBIOLOGY", "CULTURE & SENSITIVITY"),
    "Clinical Pathology": ("REPORT ON CLINICAL PATHOLOGY", "URINE / STOOL EXAMINATION"),
}

VALID_LAB_REPORT_DEPARTMENTS = frozenset(DEPT_REPORT_TITLES) | {"Other"}

# Clinical Department / master names often differ from Lab Report select options.
DEPARTMENT_ALIASES = {
    "pathology": "Clinical Pathology",
    "general pathology": "Clinical Pathology",
    "clinical pathology": "Clinical Pathology",
    "hematology": "Haematology",
    "haematology": "Haematology",
    "biochemistry": "Biochemistry",
    "serology": "Serology",
    "microbiology": "Microbiology",
    "immunology": "Serology",
}


def normalize_lab_report_department(raw):
    """Map Clinical Department / test-master labels to Lab Report select values."""
    if not raw:
        return "Biochemistry"
    value = (raw or "").strip()
    if value in VALID_LAB_REPORT_DEPARTMENTS:
        return value
    mapped = DEPARTMENT_ALIASES.get(value.lower())
    if mapped:
        return mapped
    lower = value.lower()
    for option in VALID_LAB_REPORT_DEPARTMENTS:
        if option.lower() in lower or lower in option.lower():
            return option
    return "Other"


def sync_phase8_doctypes(force=False):
    from frappe.modules.import_file import import_file_by_path

    app_path = frappe.get_app_path("health_ecosystem_core")
    base = os.path.join(app_path, "health_ecosystem_core", "health_ecosystem_core", "doctype")
    for rel in (
        "lab_report_parameter/lab_report_parameter.json",
        "lab_report/lab_report.json",
        "diagnostic_test_parameter/diagnostic_test_parameter.json",
        "diagnostic_test_master/diagnostic_test_master.json",
    ):
        path = os.path.join(base, rel)
        if os.path.exists(path):
            import_file_by_path(path, force=force)

    for dt in ("Lab Report Parameter", "Lab Report"):
        if frappe.db.exists("DocType", dt):
            frappe.db.set_value("DocType", dt, "module", "Health Ecosystem Core")
            frappe.db.set_value("DocType", dt, "app", "health_ecosystem_core")

    frappe.clear_cache(doctype="Lab Report Parameter")
    frappe.clear_cache(doctype="Lab Report")

    try:
        frappe.model.sync.sync_for("health_ecosystem_core", force=force)
    except Exception:
        frappe.log_error(title="Phase 8 sync_for", message=frappe.get_traceback())

    frappe.clear_cache()


def setup_phase8(seed_demo_methods=True):
    sync_phase8_doctypes(force=True)
    _verify_phase8_controllers()
    if seed_demo_methods:
        try:
            seed_biochemistry_methods()
        except Exception:
            frappe.log_error(title="seed_biochemistry_methods", message=frappe.get_traceback())
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": 8, "lab_report": frappe.db.exists("DocType", "Lab Report")}


def _verify_phase8_controllers():
    """Fail fast during setup if child-table Python controllers are missing."""
    import importlib

    for module_path, class_name in (
        (
            "health_ecosystem_core.health_ecosystem_core.doctype.lab_report_parameter.lab_report_parameter",
            "LabReportParameter",
        ),
        (
            "health_ecosystem_core.health_ecosystem_core.doctype.lab_report.lab_report",
            "LabReport",
        ),
    ):
        mod = importlib.import_module(module_path)
        if not hasattr(mod, class_name):
            raise ImportError(f"{class_name} missing in {module_path}")


def seed_biochemistry_methods():
    """Seed Urea/Creatinine style methods for demo NABL masters."""
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return
    seeds = {
        "UREA": {"method": "UREASE", "code": "48"},
        "CREATININE": {"method": "Enzymatic", "code": "50"},
    }
    for master_name, meta in seeds.items():
        if not frappe.db.exists("Diagnostic Test Master", master_name):
            continue
        doc = frappe.get_doc("Diagnostic Test Master", master_name)
        for row in doc.parameters or []:
            pname = (row.parameter_name or "").upper()
            if "UREA" in pname:
                row.method = meta["method"] if "UREA" in master_name else row.method
                row.parameter_code = meta["code"] if "UREA" in master_name else row.parameter_code
            if "CREATININE" in pname or "CREAT" in pname:
                row.method = meta["method"]
                row.parameter_code = meta["code"]
        doc.save(ignore_permissions=True)


def _department_for_trf(trf):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item, get_trf_test_lines

    for line in get_trf_test_lines(trf):
        master = find_test_master_for_item(line["item_code"])
        if master:
            dept = frappe.db.get_value("Diagnostic Test Master", master, "department")
            if dept:
                return normalize_lab_report_department(dept)
    return "Biochemistry"


def _default_titles(department):
    return DEPT_REPORT_TITLES.get(department, ("LABORATORY REPORT", "DIAGNOSTIC TEST RESULTS"))


def _bill_meta_from_trf(trf):
    bill_no = trf.sales_invoice or trf.sales_order or trf.name
    bill_date = None
    if trf.sales_invoice and frappe.db.exists("Sales Invoice", trf.sales_invoice):
        bill_date = frappe.db.get_value("Sales Invoice", trf.sales_invoice, "posting_date")
    elif trf.sales_order and frappe.db.exists("Sales Order", trf.sales_order):
        bill_date = frappe.db.get_value("Sales Order", trf.sales_order, "transaction_date")
    return bill_no, bill_date


def _collection_center_label(franchisee_id):
    if not franchisee_id:
        return ""
    row = frappe.db.get_value(
        "Franchisee Profile",
        franchisee_id,
        ["franchise_name", "address", "nabl_declared"],
        as_dict=True,
    )
    if not row:
        return franchisee_id
    name = row.franchise_name or franchisee_id
    if cint(row.get("nabl_declared")) and (row.address or "").strip():
        return f"{name}, {row.address.strip()}"
    return name


def build_parameter_rows_from_trf(trf):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item, get_trf_test_lines

    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)

    age_years = getattr(trf, "age", None)
    age_months = getattr(trf, "age_months", None)
    age_days = getattr(trf, "age_days", None)
    gender = getattr(trf, "gender", None)
    menstrual_cycle_day = None
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            resolve_menstrual_cycle_day,
        )

        menstrual_cycle_day = resolve_menstrual_cycle_day(trf)
    except Exception:
        menstrual_cycle_day = getattr(trf, "menstrual_cycle_day", None)

    rows = []
    for line in get_trf_test_lines(trf):
        item_code = line["item_code"]
        master = find_test_master_for_item(item_code)
        if master and frappe.db.exists("Diagnostic Test Master", master):
            doc = frappe.get_doc("Diagnostic Test Master", master)
            if doc.parameters:
                for param in doc.parameters:
                    rows.append(
                        _parameter_row_from_master(
                            param,
                            master,
                            item_code,
                            age_years=age_years,
                            gender=gender,
                            master_doc=doc,
                            age_months=age_months,
                            age_days=age_days,
                            menstrual_cycle_day=menstrual_cycle_day,
                        )
                    )
                continue
        fallback = {
            "include_in_report": 1,
            "parameter_code": "",
            "description": line.get("item_name") or item_code,
            "unit": "",
            "lower_range": None,
            "upper_range": None,
            "method": "",
            "result_input_type": "Numeric",
            "diagnostic_test": master,
            "erp_item_code": item_code,
        }
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                abo_grouping_template,
                infer_format_kind,
                widal_template,
            )

            kind = infer_format_kind(line.get("item_name"), item_code)
            template = abo_grouping_template() if kind == "abo" else widal_template() if kind == "widal" else None
            if template:
                layout = "Numeric Profile" if kind == "abo" else "Table Matrix"
                for param in template:
                    rows.append(
                        {
                            "include_in_report": 1,
                            "parameter_code": param["parameter_code"],
                            "description": param["parameter_name"],
                            "unit": "",
                            "lower_range": None,
                            "upper_range": None,
                            "method": "",
                            "result_input_type": param["result_input_type"],
                            "choice_options": param.get("choice_options") or "",
                            "before_heading": param.get("before_heading") or "",
                            "result_layout": layout,
                            "result_value": param.get("default_value") or "",
                            "diagnostic_test": master,
                            "erp_item_code": item_code,
                            "test_name": line.get("item_name") or item_code,
                        }
                    )
                continue
        except Exception:
            pass
        rows.append(fallback)
    return rows


def _parameter_row_from_master(
    param,
    master,
    item_code,
    age_years=None,
    gender=None,
    master_doc=None,
    age_months=None,
    age_days=None,
    menstrual_cycle_day=None,
):
    master_doc = master_doc or (frappe.get_doc("Diagnostic Test Master", master) if master else None)
    is_calc = cint(getattr(param, "is_calculated", 0))
    kind = (getattr(param, "parameter_kind", None) or "").strip()
    if not kind:
        kind = "Calculated" if is_calc else "Real"
    if kind == "Calculated":
        is_calc = 1
    formula = getattr(param, "formula", None) or ""
    if is_calc and not formula:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase59_parameter_inventory import (
                formula_for_parameter,
            )

            formula = formula_for_parameter(param.parameter_code, param.parameter_name, formula)
        except Exception:
            pass

    lower = param.normal_min
    upper = param.normal_max
    range_label = ""
    interpretation = param.interpretation or (master_doc.interpretation if master_doc else "")
    layout = "Numeric Profile"
    uses_interpretation_bands = 0
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            format_range_label,
            master_layout_flags,
            resolve_parameter_bounds,
        )

        flags = master_layout_flags(master_doc)
        layout = flags.get("result_layout") or layout
        uses_interpretation_bands = 1 if flags.get("reference_range_mode") == "Interpretation Bands" else 0
        bounds = resolve_parameter_bounds(
            master_doc,
            param,
            age_years=age_years,
            gender=gender,
            age_months=age_months,
            age_days=age_days,
            menstrual_cycle_day=menstrual_cycle_day,
        )
        if flags.get("reference_range_mode") == "Interpretation Bands":
            lower = None
            upper = None
        else:
            lower = bounds.get("normal_min")
            upper = bounds.get("normal_max")
        range_label = format_range_label(bounds, param.unit)
        if bounds.get("interpretation"):
            interpretation = bounds["interpretation"]
    except Exception:
        pass

    result_input_type = getattr(param, "result_input_type", None) or "Numeric"
    if result_input_type in ("Heading", "Spacer"):
        lower = None
        upper = None
        range_label = ""

    method = param.method or (master_doc.machine_method if master_doc else "") or ""
    machine_name = getattr(param, "machine_name", None) or ""
    if not method or "apollo" in (method or "").lower() or not machine_name:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase96_method_machine import (
                resolve_method_and_machine,
            )

            seeded_method, seeded_machine = resolve_method_and_machine(
                param.parameter_code, param.parameter_name, is_calc
            )
            if not method or "apollo" in method.lower():
                method = seeded_method
            if not machine_name:
                machine_name = seeded_machine
        except Exception:
            pass

    row = {
        "include_in_report": 0 if result_input_type == "Spacer" else 1,
        "test_name": master_doc.test_name if master_doc else "",
        "parameter_code": param.parameter_code or "",
        "description": param.parameter_name,
        "unit": param.unit or "",
        "lower_range": lower,
        "upper_range": upper,
        "reference_range_label": range_label,
        "method": method,
        "machine_name": machine_name,
        "parameter_kind": kind,
        "is_calculated": is_calc,
        "formula": formula,
        "interpretation": interpretation,
        "diagnostic_test": master,
        "erp_item_code": item_code,
        "result_input_type": result_input_type,
        "choice_options": getattr(param, "choice_options", None) or "",
        "print_style": getattr(param, "print_style", None) or "Normal",
        "before_heading": getattr(param, "before_heading", None) or "",
        "linked_info_role": getattr(param, "linked_info_role", None) or "None",
        "result_layout": layout,
        "result_value": getattr(param, "default_value", None) or "",
        "uses_interpretation_bands": uses_interpretation_bands,
    }
    if hasattr(param, "reagent_item") and kind == "Real" and param.reagent_item:
        row["reagent_item"] = param.reagent_item
        row["reagent_qty"] = flt(getattr(param, "reagent_qty", None) or 0) or 1
    return row


def _apply_graph_flags_to_lab_report(doc, trf):
    """Enable chromatogram attach when any ordered master allows graph upload."""
    if not frappe.get_meta("Lab Report").has_field("allow_graph_upload"):
        return
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item, get_trf_test_lines

    allow = 0
    label = "Chromatogram / Graph"
    heading_1 = doc.report_title_1
    heading_2 = doc.report_title_2
    for line in get_trf_test_lines(trf):
        master = find_test_master_for_item(line["item_code"])
        if not master:
            continue
        md = frappe.get_doc("Diagnostic Test Master", master)
        if cint(getattr(md, "allow_graph_upload", 0)) or (getattr(md, "result_layout", "") == "Graph + Values"):
            allow = 1
            label = getattr(md, "graph_label", None) or label
        if getattr(md, "report_heading_1", None):
            heading_1 = md.report_heading_1
        if getattr(md, "report_heading_2", None):
            heading_2 = md.report_heading_2
    doc.allow_graph_upload = allow
    if allow:
        doc.graph_label = label
    if heading_1:
        doc.report_title_1 = heading_1
    if heading_2:
        doc.report_title_2 = heading_2


def _existing_lab_report(trf_id):
    return frappe.db.get_value("Lab Report", {"customer_trf": trf_id}, "name", order_by="creation desc")


def _ensure_lab_report_for_trf(trf_id):
    existing = _existing_lab_report(trf_id)
    if existing:
        return existing
    resp = get_or_create_lab_report(trf_id=trf_id)
    return (resp.get("data") or {}).get("lab_report")


@frappe.whitelist()
def get_or_create_lab_report(trf_id=None, department=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
        return _error("TRF not found", 404)

    existing = _existing_lab_report(trf_id)
    if existing:
        return _success({"lab_report": existing, "created": False})

    trf = frappe.get_doc("Customer TRF", trf_id)
    raw_dept = _parse_request_value("department", department) or _department_for_trf(trf)
    dept = normalize_lab_report_department(raw_dept)
    title_1, title_2 = _default_titles(dept)
    bill_no, bill_date = _bill_meta_from_trf(trf)
    booked = trf.creation
    sample_date = trf.collection_slot or now_datetime()

    from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
        referred_doctor_from_trf,
    )

    referred = referred_doctor_from_trf(trf)

    specimen = ""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
            rebuild_trf_draw_plan,
            specimen_from_trf_draw_plan,
        )

        if frappe.get_meta("Customer TRF").has_field("collection_tubes"):
            if not (trf.get("collection_tubes") or []):
                rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=0)
                trf.reload()
            specimen = specimen_from_trf_draw_plan(trf) or ""
    except Exception:
        frappe.log_error(title="phase89_specimen_for_report", message=frappe.get_traceback())
    if not specimen:
        specimen = "Serum" if dept == "Biochemistry" else ""

    doc = frappe.get_doc(
        {
            "doctype": "Lab Report",
            "customer_trf": trf_id,
            "care_journey": trf.get("care_journey"),
            "report_status": "Draft",
            "bill_no": bill_no,
            "bill_date": bill_date,
            "appointment_no": bill_no,
            "referral_doctor": referred,
            "advised_by": referred,
            "sample_booked_date": booked,
            "sample_date": sample_date,
            "lab_receipt_date": now_datetime(),
            "report_date": now_datetime(),
            "collection_center": _collection_center_label(trf.franchisee_id),
            "department": dept,
            "report_title_1": title_1,
            "report_title_2": title_2,
            "specimen": specimen,
            "parameters": build_parameter_rows_from_trf(trf),
        }
    )
    _apply_graph_flags_to_lab_report(doc, trf)
    doc.insert(ignore_permissions=True)
    doc.lab_no = doc.name
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"lab_report": doc.name, "created": True})


@frappe.whitelist()
def reload_lab_report_parameters(lab_report=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)

    doc = frappe.get_doc("Lab Report", lab_report)
    doc.parameters = []
    trf = frappe.get_doc("Customer TRF", doc.customer_trf)
    for row in build_parameter_rows_from_trf(trf):
        doc.append("parameters", row)
    _apply_graph_flags_to_lab_report(doc, trf)
    doc.report_status = "In Progress"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"lab_report": doc.name, "parameters": len(doc.parameters)})


@frappe.whitelist()
def import_machine_results_to_report(lab_report=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)

    doc = frappe.get_doc("Lab Report", lab_report)
    imported = _apply_machine_results_to_doc(doc)
    doc.report_status = "In Progress"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"lab_report": doc.name, "imported": imported})


def _apply_machine_results_to_doc(doc):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import abnormal_flag_for_value

    trf = frappe.get_doc("Customer TRF", doc.customer_trf)
    machine_fields = [
        "analyte_test_name",
        "numeric_result_value",
        "unit_of_measure",
        "reference_range",
        "abnormal_flag",
        "erp_item_code",
    ]
    if frappe.get_meta("Lab Test Result").has_field("result_value_text"):
        machine_fields.append("result_value_text")
    machine_rows = frappe.get_all(
        "Lab Test Result",
        filters={"customer_trf": trf.name},
        fields=machine_fields,
    )
    imported = 0
    for param in doc.parameters:
        # Never overwrite Calculated / derived rows from LIS — equations apply on Save
        kind = (getattr(param, "parameter_kind", None) or "").strip()
        if kind == "Calculated" or cint(getattr(param, "is_calculated", 0)):
            continue
        if param.result_value:
            continue
        for row in machine_rows:
            analyte = (row.analyte_test_name or "").lower()
            desc = (param.description or "").lower()
            item_match = param.erp_item_code and row.erp_item_code == param.erp_item_code
            if item_match or analyte == desc or analyte in desc or desc in analyte:
                # Qualitative analytes carry only text, so prefer it over a blank float.
                text_value = row.get("result_value_text")
                if text_value:
                    param.result_value = str(text_value)
                elif row.numeric_result_value is not None:
                    param.result_value = str(row.numeric_result_value)
                else:
                    continue
                if not param.unit:
                    param.unit = row.unit_of_measure
                if not param.abnormal_flag and row.abnormal_flag:
                    flag = row.abnormal_flag
                    if flag in ("High", "H"):
                        param.abnormal_flag = "H"
                    elif flag in ("Low", "L"):
                        param.abnormal_flag = "L"
                    elif flag in ("Normal", "N"):
                        param.abnormal_flag = "N"
                    else:
                        param.abnormal_flag = flag
                elif param.diagnostic_test and param.result_value:
                    from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                        apply_interpretation_to_lab_row,
                    )

                    if not apply_interpretation_to_lab_row(param):
                        param.abnormal_flag = abnormal_flag_for_value(
                            param.diagnostic_test, param.description, param.result_value
                        )
                imported += 1
                break
    _apply_interpretation_classification(doc)
    return imported


def _apply_interpretation_classification(doc):
    """Recompute clinical_category + flags for interpretation-band parameters."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            apply_interpretation_to_lab_row,
        )
    except Exception:
        return 0

    changed = 0
    master_cache = {}
    for param in doc.parameters or []:
        master_name = getattr(param, "diagnostic_test", None)
        if not master_name:
            continue
        master_doc = master_cache.get(master_name)
        if master_doc is None and frappe.db.exists("Diagnostic Test Master", master_name):
            master_doc = frappe.get_doc("Diagnostic Test Master", master_name)
            master_cache[master_name] = master_doc
        before_cat = getattr(param, "clinical_category", None) or ""
        before_flag = param.abnormal_flag or ""
        apply_interpretation_to_lab_row(param, master_doc=master_doc)
        after_cat = getattr(param, "clinical_category", None) or ""
        after_flag = param.abnormal_flag or ""
        if before_cat != after_cat or before_flag != after_flag:
            changed += 1
    return changed


def _import_machine_results_to_report_doc(doc):
    imported = _apply_machine_results_to_doc(doc)
    if imported:
        doc.report_status = "In Progress"
        doc.save(ignore_permissions=True)
    return imported


def _flag_from_ranges(value, lower, upper):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""
    if lower is not None and num < float(lower):
        return "L"
    if upper is not None and num > float(upper):
        return "H"
    return "N"


def sync_lab_report_to_results(lab_report):
    """Push Lab Report parameter grid into Lab Test Result rows."""
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        abnormal_flag_for_value,
        normalize_abnormal_flag,
    )

    doc = frappe.get_doc("Lab Report", lab_report)
    trf = frappe.get_doc("Customer TRF", doc.customer_trf)
    barcode = trf.unique_barcode

    for param in doc.parameters:
        if not param.include_in_report or not param.result_value:
            continue
        analyte = param.description
        existing = frappe.db.get_value(
            "Lab Test Result",
            {"customer_trf": trf.name, "analyte_test_name": analyte},
            "name",
        )
        ref = ""
        if param.lower_range is not None and param.upper_range is not None:
            ref = f"{param.lower_range}-{param.upper_range}"
        flag = param.abnormal_flag or _flag_from_ranges(
            param.result_value, param.lower_range, param.upper_range
        )
        if not flag and param.diagnostic_test:
            flag = abnormal_flag_for_value(param.diagnostic_test, analyte, param.result_value)
        flag = normalize_abnormal_flag(flag)

        # A typed value like "Reactive" must not be silently flattened to 0.
        raw_value = str(param.result_value).strip()
        try:
            numeric = float(raw_value)
        except (TypeError, ValueError):
            numeric = None

        result_meta = frappe.get_meta("Lab Test Result")
        data = {
            "barcode_link": barcode,
            "analyte_test_name": analyte,
            "numeric_result_value": flt(numeric) if numeric is not None else None,
            "unit_of_measure": param.unit,
            "machine_reference": "Manual Entry",
            "verification_timestamp": now_datetime(),
            "customer_trf": trf.name,
            "reference_range": ref,
            "abnormal_flag": flag,
        }
        if result_meta.has_field("result_value_text"):
            data["result_value_text"] = raw_value if numeric is None else None
        if param.erp_item_code and result_meta.has_field("erp_item_code"):
            data["erp_item_code"] = param.erp_item_code

        if existing:
            frappe.db.set_value("Lab Test Result", existing, data, update_modified=True)
        else:
            frappe.get_doc({"doctype": "Lab Test Result", **data}).insert(ignore_permissions=True)


def expected_parameter_count(trf_name):
    """Count Real (measured) parameters only — Calculated/derived are filled on Save."""
    trf = frappe.get_doc("Customer TRF", trf_name)
    rows = build_parameter_rows_from_trf(trf)
    real = 0
    for row in rows:
        kind = (row.get("parameter_kind") or "").strip()
        if kind == "Calculated" or cint(row.get("is_calculated")):
            continue
        real += 1
    return real


def trf_results_complete(trf_name):
    expected = expected_parameter_count(trf_name)
    if not expected:
        return False
    # A qualitative result is a complete result, so text counts as filled too.
    if frappe.get_meta("Lab Test Result").has_field("result_value_text"):
        filled = frappe.db.sql(
            """
            SELECT COUNT(*) FROM `tabLab Test Result`
            WHERE customer_trf = %s
              AND (numeric_result_value IS NOT NULL
                   OR (result_value_text IS NOT NULL AND result_value_text != ''))
            """,
            trf_name,
        )[0][0]
    else:
        filled = frappe.db.sql(
            """
            SELECT COUNT(*) FROM `tabLab Test Result`
            WHERE customer_trf = %s AND numeric_result_value IS NOT NULL
            """,
            trf_name,
        )[0][0]
    return filled >= expected


@frappe.whitelist()
def finalize_lab_report(lab_report=None, confirm_password=None):
    """Save report grid to Lab Test Results and advance TRF/journey for pathologist review."""
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
    from health_ecosystem_core.health_ecosystem_core.clinical_journey import advance_journey
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import build_lab_report_json

    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)

    doc = frappe.get_doc("Lab Report", lab_report)
    if not any((p.result_value or "").strip() for p in doc.parameters):
        return _error("Enter at least one result before finalizing")

    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import apply_calculated_parameters

    apply_calculated_parameters(doc, force=True)
    abnormals = _lab_report_abnormal_rows(doc)
    if abnormals:
        try:
            ack_user = require_lab_user_password(confirm_password)
        except frappe.ValidationError as exc:
            return _error(str(exc) or "Password required to accept abnormal results", 403)
        summary = ", ".join(
            f"{(p.description or p.parameter_code or p.name)}={p.result_value or ''} ({p.abnormal_flag})"
            for p in abnormals[:12]
        )
        doc.add_comment(
            "Info",
            f"Abnormal results acknowledged by {ack_user}: {summary}",
        )

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_nabl_release_gates import (
            apply_release_gates_to_report,
        )

        apply_release_gates_to_report(doc, save=False)
    except Exception:
        frappe.log_error(title="nabl release gates", message=frappe.get_traceback())

    # Block finalize when sample was rejected
    if doc.customer_trf and frappe.db.get_value("Customer TRF", doc.customer_trf, "sample_rejected"):
        return _error("Sample was rejected — cannot finalize results. Recollect or clear rejection first.")

    doc.report_status = "Verified"
    doc.report_date = now_datetime()
    if not doc.dispatch_date:
        doc.dispatch_date = now_datetime()
    stamp_lab_report_typed_by(doc)
    doc.save(ignore_permissions=True)
    sync_lab_report_to_results(doc.name)

    trf_name = doc.customer_trf
    frappe.db.set_value("Customer TRF", trf_name, "order_status", "Completed")

    journey = doc.care_journey or frappe.db.get_value("Customer TRF", trf_name, "care_journey")
    if journey:
        advance_journey(
            journey,
            "Report Review",
            lab_report_json=json.dumps(build_lab_report_json(trf_name)),
        )

    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
        maybe_consume_reagents_on_trf_complete,
    )

    maybe_consume_reagents_on_trf_complete(trf_name)

    frappe.db.commit()
    return _success(
        {
            "lab_report": doc.name,
            "trf_id": trf_name,
            "journey_id": journey,
            "complete": trf_results_complete(trf_name),
            "auto_verified": cint(doc.get("auto_verified") or 0),
            "release_hold_reasons": doc.get("release_hold_reasons") or "",
        },
        message="Report sent for pathologist review",
    )


def lab_report_print_payload(lab_report_name):
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import build_print_payload

    doc = frappe.get_doc("Lab Report", lab_report_name)
    trf = frappe.get_doc("Customer TRF", doc.customer_trf)
    return build_print_payload(doc, trf)


def render_nabl_lab_report_html(payload, letterhead_plain=0, chrome_mode=None, for_pdf=0):
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        render_remedium_lab_report_html,
    )

    return render_remedium_lab_report_html(
        payload,
        letterhead_plain=letterhead_plain,
        chrome_mode=chrome_mode,
        for_pdf=for_pdf,
    )


def journey_pdf_payload(journey_name):
    """Prefer Lab Report NABL layout when a report exists for the journey TRF."""
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import journey_report_payload

    base = journey_report_payload(journey_name)
    trf_id = base.get("trf_id")
    if trf_id and frappe.db.exists("DocType", "Lab Report"):
        lab_report = _existing_lab_report(trf_id)
        if lab_report:
            nabl = lab_report_print_payload(lab_report)
            base.update(
                {
                    "nabl_report": nabl,
                    "report_title_1": nabl.get("report_title_1"),
                    "investigator_1": nabl.get("investigator_1"),
                    "investigator_2": nabl.get("investigator_2"),
                }
            )
            base["structured"] = {"tests": nabl.get("test_sections") or []}
    return base


def maybe_advance_trf_after_machine_result(trf_name):
    """Only complete TRF / advance journey when all expected parameters are logged."""
    from health_ecosystem_core.health_ecosystem_core.clinical_journey import advance_journey
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import build_lab_report_json

    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import on_sample_received_at_lab

    if not trf_results_complete(trf_name):
        current = frappe.db.get_value("Customer TRF", trf_name, "order_status")
        if current in ("Booked", "Sample Collected"):
            frappe.db.set_value("Customer TRF", trf_name, "order_status", "In Lab")
            on_sample_received_at_lab(trf_name)
        return False

    frappe.db.set_value("Customer TRF", trf_name, "order_status", "Completed")
    on_sample_received_at_lab(trf_name)
    journey = frappe.db.get_value("Customer TRF", trf_name, "care_journey")
    if journey:
        lab_report = _existing_lab_report(trf_name)
        if lab_report:
            doc = frappe.get_doc("Lab Report", lab_report)
            _import_machine_results_to_report_doc(doc)
        advance_journey(
            journey,
            "Report Review",
            lab_report_json=json.dumps(build_lab_report_json(trf_name)),
        )
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
            maybe_consume_reagents_on_trf_complete,
        )

        maybe_consume_reagents_on_trf_complete(trf_name)
    except Exception:
        frappe.log_error(title="phase24_reagent_consume", message=frappe.get_traceback())
    return True


@frappe.whitelist()
def recalculate_lab_report(lab_report=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import apply_calculated_parameters

    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)
    doc = frappe.get_doc("Lab Report", lab_report)
    apply_calculated_parameters(doc, force=True)
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success({"lab_report": doc.name}, message="Calculated parameters updated")


@frappe.whitelist()
def get_lab_report_preview_html(lab_report=None, letterhead_plain=0):
    from frappe.utils import cint

    from health_ecosystem_core.health_ecosystem_core.api import _parse_request_value
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        resolve_remedium_report_chrome,
    )

    ensure_lab_report_attribution_fields()
    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report:
        return ""
    plain = cint(_parse_request_value("letterhead_plain", letterhead_plain) or 0)
    payload = lab_report_print_payload(lab_report)
    # Headerless uses Remedium without_header template; otherwise NABL vs Non-NABL from Test Master.
    chrome = (
        "remedium_without_header"
        if plain
        else resolve_remedium_report_chrome(requested="nabl", lab_report=lab_report, payload=payload)
    )
    return render_nabl_lab_report_html(
        payload,
        letterhead_plain=1 if plain else 0,
        chrome_mode=chrome,
    )


def _preview_sample_value(param_row):
    """Mid-range / choice sample for Diagnostic Test Master preview only."""
    from frappe.utils import cstr

    rtype = (param_row.get("result_input_type") or "Numeric").strip()
    if rtype in ("Heading", "Spacer"):
        return None
    if rtype == "Choice List":
        opts = [o.strip() for o in (param_row.get("choice_options") or "").splitlines() if o.strip()]
        # Prefer a non-reactive / negative style option when present
        for prefer in ("Non Reactive", "Negative", "Absent", "Nil", "Normal"):
            for o in opts:
                if prefer.lower() in o.lower():
                    return o
        return opts[0] if opts else "Non Reactive"
    if rtype == "Descriptive Text":
        return "Within normal limits. (Preview sample)"
    if rtype == "Date":
        from frappe.utils import today

        return str(today())
    if param_row.get("result_value"):
        return cstr(param_row.get("result_value"))
    low = param_row.get("lower_range")
    high = param_row.get("upper_range")
    try:
        if low is not None and high is not None and flt(high) > flt(low):
            return cstr(round((flt(low) + flt(high)) / 2.0, 2))
        if high is not None and flt(high) > 0:
            return cstr(round(flt(high) * 0.8, 2))
        if low is not None:
            return cstr(round(flt(low) * 1.1, 2))
    except Exception:
        pass
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            _sample_result_for_param,
        )

        return _sample_result_for_param(frappe._dict(param_row))
    except Exception:
        return "1.0"


@frappe.whitelist()
def preview_diagnostic_test_master_report(
    name=None,
    age=35,
    gender="Male",
    fill_sample=1,
    letterhead_plain=0,
):
    """Render final NABL-style report HTML for one Diagnostic Test Master (layout preview)."""
    from frappe.utils import cint, now_datetime

    from health_ecosystem_core.health_ecosystem_core.api import _parse_request_value
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        build_print_payload,
        render_remedium_lab_report_html,
    )

    name = (_parse_request_value("name", name) or "").strip()
    if not name or not frappe.db.exists("Diagnostic Test Master", name):
        frappe.throw(_("Diagnostic Test Master not found"))

    master = frappe.get_doc("Diagnostic Test Master", name)
    age = cint(_parse_request_value("age", age) or 35) or 35
    gender = (_parse_request_value("gender", gender) or "Male").strip() or "Male"
    if gender.lower().startswith("f"):
        gender = "Female"
    elif gender.lower().startswith("m"):
        gender = "Male"
    fill_sample = cint(_parse_request_value("fill_sample", fill_sample) if fill_sample is not None else 1)
    plain = cint(_parse_request_value("letterhead_plain", letterhead_plain) or 0)

    if not (master.parameters or []):
        frappe.throw(_("Add at least one parameter before previewing the report."))

    item_code = getattr(master, "item", None) or ""
    rows = []
    for param in master.parameters:
        rows.append(
            _parameter_row_from_master(
                param,
                master.name,
                item_code,
                age_years=age,
                gender=gender,
                master_doc=master,
            )
        )

    for row in rows:
        if cint(fill_sample):
            sample = _preview_sample_value(row)
            if sample is not None:
                row["result_value"] = sample
                rtype = (row.get("result_input_type") or "Numeric").strip()
                if rtype == "Numeric" or not rtype:
                    row["abnormal_flag"] = _flag_from_ranges(
                        row.get("result_value"),
                        row.get("lower_range"),
                        row.get("upper_range"),
                    )
                else:
                    row["abnormal_flag"] = row.get("abnormal_flag") or "N"

    class _PreviewRow(frappe._dict):
        """Mimic child-table row for build_print_payload / apply_calculated_parameters."""

        def as_dict(self, *args, **kwargs):
            return frappe._dict(self)

    dept = normalize_lab_report_department(getattr(master, "department", None) or "") or "Biochemistry"
    title1, title2 = _default_titles(dept)
    if getattr(master, "report_category", None):
        title1 = master.report_category
    title2 = master.test_name or master.name

    now = now_datetime()
    doc = frappe._dict(
        name=f"PREVIEW-{master.name}"[:140],
        patient_name="Preview Patient",
        gender=gender,
        age=age,
        department=dept,
        specimen="Serum",
        bill_no="PREVIEW",
        lab_no=f"PREV-{master.name}"[:40],
        report_no=f"PREV-{master.name}"[:40],
        report_title_1=title1,
        report_title_2=title2,
        report_note="",
        comments=(
            "PREVIEW ONLY — sample values for layout check. "
            f"Master: {master.name}. Age {age}Y / {gender}. Not a patient report."
        ),
        report_status="Authorized",
        sample_date=now,
        lab_receipt_date=now,
        report_date=now,
        dispatch_date=now,
        printed_on=now,
        auto_verified=0,
        allow_graph_upload=cint(getattr(master, "allow_graph_upload", 0)),
        graph_label=getattr(master, "graph_label", None) or "Graph",
        graph_attachment="",
        graph_notes="",
        referral_doctor="Self",
        collection_center="Preview Collection Centre",
        parameters=[_PreviewRow(r) for r in rows],
    )
    trf = frappe._dict(
        name="PREVIEW-TRF",
        patient_name="Preview Patient",
        gender=gender,
        age=age,
        unique_barcode="PREVIEW-BARCODE",
        sales_invoice="",
        sales_order="",
        referred_doctor="Self",
    )

    payload = build_print_payload(doc, trf)
    html = render_remedium_lab_report_html(payload, letterhead_plain=plain)
    banner = (
        "<div style='background:#fff3cd;border:1px solid #ffc107;color:#856404;"
        "padding:8px 12px;margin:0 0 12px;font:12px/1.4 Segoe UI,Arial,sans-serif;'>"
        "<strong>PREVIEW</strong> — Diagnostic Test Master layout with sample results. "
        "Not for clinical use."
        "</div>"
    )
    if "<body" in html.lower():
        # Inject after opening body tag
        import re as _re

        html = _re.sub(r"(<body[^>]*>)", r"\1" + banner, html, count=1, flags=_re.IGNORECASE)
    else:
        html = banner + html
    return html


@frappe.whitelist()
def complete_nabl_pdf_for_trf(trf_id=None, fill_sample=1, authorize=1):
    """End-to-end: draw plan → Lab Report → sample results (optional) → NABL PDF.

    Operator hardening helper for blank/incomplete TRFs and report printing.
    """
    from frappe.utils import cint, cstr, now_datetime

    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
        return _error("TRF not found", 404)

    draw = {}
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
            rebuild_trf_draw_plan,
            repair_customer_trf_draw_plan_field,
        )

        repair_customer_trf_draw_plan_field()
        draw = rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=1) or {}
    except Exception:
        frappe.log_error(title="complete_nabl_draw_plan", message=frappe.get_traceback())
        draw = {"ok": False, "error": "draw_plan_failed"}

    resp = get_or_create_lab_report(trf_id=trf_id)
    lab_report = None
    if isinstance(resp, dict):
        lab_report = (resp.get("data") or {}).get("lab_report")
    if not lab_report:
        err = _error("Could not create Lab Report")
        err["data"] = {"trf_id": trf_id, "draw": draw, "response": resp}
        return err

    doc = frappe.get_doc("Lab Report", lab_report)
    if cint(fill_sample) and not any((p.result_value or "").strip() for p in (doc.parameters or [])):
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                _fill_lab_report_sample_results,
            )

            _fill_lab_report_sample_results(doc)
            doc.reload()
        except Exception:
            frappe.log_error(title="complete_nabl_fill_sample", message=frappe.get_traceback())

    if cint(authorize) and doc.report_status not in ("Authorized", "Printed"):
        doc.report_status = "Authorized"
        if not doc.report_date:
            doc.report_date = now_datetime()
        if hasattr(doc, "dispatch_date") and not doc.dispatch_date:
            doc.dispatch_date = now_datetime()
        stamp_lab_report_typed_by(doc)
        if hasattr(doc, "approved_by_user"):
            doc.approved_by_user = frappe.session.user
        if hasattr(doc, "approved_by_name"):
            doc.approved_by_name = portal_employee_display(frappe.session.user)
        doc.save(ignore_permissions=True)
        from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
            on_report_authorized,
            on_sample_received_at_lab,
        )

        on_sample_received_at_lab(trf_id)
        on_report_authorized(trf_id)

    payload = lab_report_print_payload(lab_report)
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        html_to_lab_report_pdf,
        resolve_remedium_report_chrome,
    )

    mode = resolve_remedium_report_chrome(requested="nabl", lab_report=lab_report, payload=payload)
    html = render_nabl_lab_report_html(payload, chrome_mode=mode, for_pdf=1)
    if not html:
        err = _error("NABL HTML empty")
        err["data"] = {"lab_report": lab_report, "trf_id": trf_id}
        return err

    pdf_content = html_to_lab_report_pdf(html, chrome_mode=mode, brand="remedium")
    fname = f"Lab_Report_{trf_id}_{mode}.pdf"
    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": fname,
            "content": pdf_content,
            "is_private": 1,
            "attached_to_doctype": "Lab Report",
            "attached_to_name": lab_report,
            "folder": "Home/Attachments",
        }
    )
    file_doc.insert(ignore_permissions=True)

    journey = doc.care_journey or frappe.db.get_value("Customer TRF", trf_id, "care_journey")
    if journey and frappe.db.exists("Patient Care Journey", journey):
        try:
            frappe.db.set_value("Patient Care Journey", journey, "report_pdf", file_doc.file_url)
        except Exception:
            pass

    frappe.db.commit()
    return _success(
        {
            "trf_id": trf_id,
            "lab_report": lab_report,
            "journey_id": journey,
            "report_status": doc.report_status,
            "parameters": len(doc.parameters or []),
            "draw_tubes": len(draw.get("tubes") or []),
            "pdf_url": file_doc.file_url,
            "pdf_name": file_doc.name,
            "html_file": None,
            "html_bytes": len(html or ""),
            "pdf_bytes": len(pdf_content or b""),
            "patient_name": cstr(frappe.db.get_value("Customer TRF", trf_id, "patient_name") or ""),
        },
        message="NABL report PDF generated",
    )


# ---------------------------------------------------------------------------
# Phase 36 — Lab report result entry on the web app (parity with Desk form)
# ---------------------------------------------------------------------------

# Fields a lab technician may edit from the web grid.
# Unit / method / machine_name are owned by Diagnostic Test Master (admin Desk).
_EDITABLE_PARAM_FIELDS = (
    "result_value",
    "abnormal_flag",
    "interpretation",
    "include_in_report",
)

# TRF statuses that belong in the lab technician result-entry queue.
_QUEUE_TRF_STATUSES = ("Sample Collected", "In Lab")


def _is_abnormal_flag(flag):
    f = (flag or "").strip().upper()
    return bool(f) and f not in ("N", "NORMAL", "-", "—")


def _lab_report_abnormal_rows(doc):
    rows = []
    for param in doc.parameters or []:
        if _is_abnormal_flag(getattr(param, "abnormal_flag", None)):
            rows.append(param)
    return rows


def require_lab_user_password(password=None):
    """Confirm the signed-in lab user with their password (NABL abnormal acknowledge)."""
    from frappe.utils.password import check_password

    from health_ecosystem_core.health_ecosystem_core.api import _parse_request_value

    pwd = (
        _parse_request_value("confirm_password", password) or _parse_request_value("password", password) or ""
    ).strip()
    if not pwd:
        frappe.throw("Enter your password to accept abnormal results.")
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("Not authenticated")
    try:
        check_password(user, pwd)
    except Exception:
        frappe.throw("Incorrect password.")
    return user


@frappe.whitelist()
def verify_lab_user_password(password=None):
    """SPA helper — verify the current user's password before clearing an abnormal popup."""
    from health_ecosystem_core.health_ecosystem_core.api import _error, _success

    guard = _staff_guard()
    if guard:
        return guard
    try:
        user = require_lab_user_password(password)
    except frappe.ValidationError as exc:
        return _error(str(exc) or "Incorrect password", 403)
    return _success({"ok": True, "user": user})


def _staff_guard():
    """Return an _error() dict if the current user is not lab staff, else None."""
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import require_roles

    if frappe.session.user == "Guest":
        from health_ecosystem_core.health_ecosystem_core.api import _error

        return _error("Not authenticated", 401)
    return require_roles("Lab Technician", "Pathologist", "Health System Admin", "System Manager")


def _uses_interpretation_bands(row):
    if cint(getattr(row, "uses_interpretation_bands", 0) or 0):
        return 1
    master = getattr(row, "diagnostic_test", None)
    if not master or not frappe.db.exists("Diagnostic Test Master", master):
        return 0
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            reference_range_mode,
        )

        return 1 if reference_range_mode(frappe.get_doc("Diagnostic Test Master", master)) == "Interpretation Bands" else 0
    except Exception:
        return 0


def _lab_report_detail_payload(doc):
    parameters = []
    for row in doc.parameters:
        parameters.append(
            {
                "name": row.name,
                "idx": row.idx,
                "include_in_report": int(row.include_in_report or 0),
                "test_name": row.test_name or "",
                "parameter_code": row.parameter_code or "",
                "description": row.description or "",
                "result_value": row.result_value or "",
                "unit": row.unit or "",
                "lower_range": row.lower_range,
                "upper_range": row.upper_range,
                "method": row.method or "",
                "machine_name": getattr(row, "machine_name", None) or "",
                "parameter_kind": getattr(row, "parameter_kind", None)
                or ("Calculated" if cint(row.is_calculated) else "Real"),
                "is_calculated": int(row.is_calculated or 0),
                "formula": row.formula or "",
                "reagent_item": getattr(row, "reagent_item", None) or "",
                "reagent_qty": flt(getattr(row, "reagent_qty", None) or 0),
                "abnormal_flag": row.abnormal_flag or "",
                "interpretation": row.interpretation or "",
                "diagnostic_test": row.diagnostic_test or "",
                "erp_item_code": row.erp_item_code or "",
                "result_input_type": getattr(row, "result_input_type", None) or "Numeric",
                "choice_options": getattr(row, "choice_options", None) or "",
                "result_layout": getattr(row, "result_layout", None) or "",
                "before_heading": getattr(row, "before_heading", None) or "",
                "print_style": getattr(row, "print_style", None) or "Normal",
                "reference_range_label": getattr(row, "reference_range_label", None) or "",
                "clinical_category": getattr(row, "clinical_category", None) or "",
                "uses_interpretation_bands": _uses_interpretation_bands(row),
            }
        )
    trf = {}
    if doc.customer_trf and frappe.db.exists("Customer TRF", doc.customer_trf):
        trf = (
            frappe.db.get_value(
                "Customer TRF",
                doc.customer_trf,
                [
                    "patient_name",
                    "age",
                    "age_months",
                    "age_days",
                    "gender",
                    "referred_doctor",
                    "test_required",
                    "unique_barcode",
                    "collection_slot",
                ],
                as_dict=True,
            )
            or {}
        )
    return {
        "lab_report": doc.name,
        "customer_trf": doc.customer_trf,
        "care_journey": doc.get("care_journey"),
        "report_status": doc.report_status,
        "department": doc.department,
        "report_title_1": doc.get("report_title_1"),
        "report_title_2": doc.get("report_title_2"),
        "patient_name": doc.get("patient_name") or trf.get("patient_name"),
        "age": doc.get("age") if doc.get("age") not in (None, "") else trf.get("age"),
        "age_months": cint(trf.get("age_months") or 0),
        "age_days": cint(trf.get("age_days") or 0),
        "gender": doc.get("gender") or trf.get("gender"),
        "unique_barcode": doc.get("unique_barcode") or trf.get("unique_barcode"),
        "appointment_no": doc.get("appointment_no") or "",
        "bill_no": doc.get("bill_no") or "",
        "specimen": doc.get("specimen"),
        "sample_date": str(doc.get("sample_date") or "") or None,
        "lab_receipt_date": str(doc.get("lab_receipt_date") or "") or None,
        "collection_slot": str(trf.get("collection_slot") or "") or None,
        "referral_doctor": doc.get("referral_doctor") or trf.get("referred_doctor") or "",
        "test_required": trf.get("test_required") or "",
        "comments": doc.get("comments") or "",
        "report_note": doc.get("report_note") or "",
        "collection_center": doc.get("collection_center"),
        "auto_verified": cint(doc.get("auto_verified") or 0),
        "iqc_ok": cint(doc.get("iqc_ok") if doc.get("iqc_ok") is not None else 1),
        "release_hold_reasons": doc.get("release_hold_reasons") or "",
        "parameters": parameters,
    }


@frappe.whitelist()
def get_lab_report_detail(lab_report=None, trf_id=None):
    """Return a Lab Report (parent + parameter grid) for the web editor.

    Pass ``lab_report`` for an existing report, or ``trf_id`` to auto
    create/fetch the report for that TRF (mirrors the Desk 'Open Lab Report').
    """
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    guard = _staff_guard()
    if guard:
        return guard

    lab_report = _parse_request_value("lab_report", lab_report)
    trf_id = _parse_request_value("trf_id", trf_id)

    if not lab_report and trf_id:
        resp = get_or_create_lab_report(trf_id=trf_id)
        if resp.get("status") != "success":
            return resp
        lab_report = (resp.get("data") or {}).get("lab_report")

    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)

    doc = frappe.get_doc("Lab Report", lab_report)
    return _success(_lab_report_detail_payload(doc))


@frappe.whitelist()
def save_lab_report_parameters(lab_report=None, parameters=None, comments=None, report_note=None):
    """Persist edited result values / units / interpretations from the web grid.

    ``parameters`` is a JSON array of rows keyed by child ``name``. Only the
    fields in ``_EDITABLE_PARAM_FIELDS`` are written; calculated rows are
    re-derived on save so formulas stay authoritative.

    Optional ``comments`` / ``report_note`` map onto Lab Report parent notes
    (printed as Comments / Note) so the result-entry comment tabs persist.
    """
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import apply_calculated_parameters

    guard = _staff_guard()
    if guard:
        return guard

    lab_report = _parse_request_value("lab_report", lab_report)
    comments = _parse_request_value("comments", comments)
    report_note = _parse_request_value("report_note", report_note)
    if not lab_report or not frappe.db.exists("Lab Report", lab_report):
        return _error("Lab Report not found", 404)

    raw = _parse_request_value("parameters", parameters)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except (ValueError, TypeError):
            return _error("Invalid parameters payload")
    if not isinstance(raw, list):
        return _error("Invalid parameters payload")

    doc = frappe.get_doc("Lab Report", lab_report)
    if doc.report_status in ("Authorized", "Printed"):
        return _error("Report already authorized; results are locked", 409)

    edits = {str(r.get("name")): r for r in raw if isinstance(r, dict) and r.get("name")}
    changed = 0
    for row in doc.parameters:
        payload = edits.get(row.name)
        if not payload:
            continue
        is_calc = (getattr(row, "parameter_kind", None) or "").strip() == "Calculated" or cint(
            row.is_calculated
        )
        for field in _EDITABLE_PARAM_FIELDS:
            if field not in payload:
                continue
            # Derived results are authoritative from the Derivation Equation
            if is_calc and field == "result_value":
                continue
            value = payload.get(field)
            if field == "include_in_report":
                value = 1 if value in (1, "1", True, "true") else 0
            if getattr(row, field) != value:
                setattr(row, field, value)
                changed += 1

    apply_calculated_parameters(doc, force=True)
    _apply_interpretation_classification(doc)
    if comments is not None:
        doc.comments = comments
    if report_note is not None:
        doc.report_note = report_note
    if doc.report_status in ("Draft",) or not doc.report_status:
        doc.report_status = "In Progress"
    if changed or comments is not None or report_note is not None:
        stamp_lab_report_typed_by(doc)
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return _success(
        {**_lab_report_detail_payload(doc), "changed": changed},
        message="Results saved",
    )


@frappe.whitelist()
def list_lab_report_queue(limit=200):
    """Lab technician queue: TRFs awaiting result entry + report review counts.

    Returns TRFs with status in Sample Collected / In Lab, each annotated with
    its Lab Report name + status (if one exists), plus a separate list of
    reports already Verified and waiting for pathologist authorization.
    """
    from health_ecosystem_core.health_ecosystem_core.api import _success

    guard = _staff_guard()
    if guard:
        return guard

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 200

    trfs = frappe.get_all(
        "Customer TRF",
        filters={"order_status": ["in", _QUEUE_TRF_STATUSES]},
        fields=[
            "name",
            "patient_name",
            "order_status",
            "test_required",
            "franchisee_id",
            "care_journey",
            "collection_slot",
            "modified",
        ],
        order_by="modified desc",
        limit=limit,
    )

    report_map = {}
    for r in frappe.get_all(
        "Lab Report",
        filters={"customer_trf": ["in", [t["name"] for t in trfs] or [""]]},
        fields=["name", "customer_trf", "report_status"],
    ):
        report_map[r["customer_trf"]] = r

    queue = []
    for t in trfs:
        report = report_map.get(t["name"])
        queue.append(
            {
                "trf_id": t["name"],
                "patient_name": t["patient_name"],
                "order_status": t["order_status"],
                "test_required": t["test_required"],
                "franchisee_id": t["franchisee_id"],
                "collection_slot": t["collection_slot"],
                "modified": t["modified"],
                "lab_report": report["name"] if report else None,
                "report_status": report["report_status"] if report else None,
            }
        )

    review = frappe.get_all(
        "Lab Report",
        filters={"report_status": "Verified"},
        fields=["name", "customer_trf", "care_journey", "report_status", "modified"],
        order_by="modified desc",
        limit=limit,
    )
    review_rows = []
    for r in review:
        review_rows.append(
            {
                "lab_report": r["name"],
                "trf_id": r["customer_trf"],
                "journey_id": r["care_journey"],
                "report_status": r["report_status"],
                "patient_name": frappe.db.get_value("Customer TRF", r["customer_trf"], "patient_name"),
                "modified": r["modified"],
            }
        )

    return _success(
        {
            "queue": queue,
            "pending_review": review_rows,
            "queue_count": len(queue),
            "review_count": len(review_rows),
        }
    )


def smoke_abnormal_password_gate():
    """Live check: empty/wrong password rejected; H/L/Critical are abnormal, N is not."""
    assert _is_abnormal_flag("H")
    assert _is_abnormal_flag("L")
    assert _is_abnormal_flag("Critical")
    assert _is_abnormal_flag("CRITICAL")
    assert not _is_abnormal_flag("N")
    assert not _is_abnormal_flag("normal")
    assert not _is_abnormal_flag("")
    assert not _is_abnormal_flag(None)

    try:
        require_lab_user_password("")
        raise AssertionError("empty password must fail")
    except Exception as exc:
        assert "password" in str(exc).lower()

    try:
        require_lab_user_password("definitely-wrong-password-xyz")
        raise AssertionError("wrong password must fail")
    except Exception as exc:
        assert "incorrect" in str(exc).lower() or "password" in str(exc).lower()

    print("SMOKE_OK abnormal_password_gate")
    return {"ok": True, "gate": "abnormal_password"}
