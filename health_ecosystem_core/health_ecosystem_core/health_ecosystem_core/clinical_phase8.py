"""
Phase 8: NABL-style lab report authoring (legacy biochemistry report parity).

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase8.setup_phase8
"""

import json
import os

import frappe
from frappe.utils import cint, flt, get_datetime, now_datetime

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

    rows = []
    for line in get_trf_test_lines(trf):
        item_code = line["item_code"]
        master = find_test_master_for_item(item_code)
        if master and frappe.db.exists("Diagnostic Test Master", master):
            doc = frappe.get_doc("Diagnostic Test Master", master)
            if doc.parameters:
                for param in doc.parameters:
                    rows.append(_parameter_row_from_master(param, master, item_code))
                continue
        rows.append(
            {
                "include_in_report": 1,
                "parameter_code": "",
                "description": line.get("item_name") or item_code,
                "unit": "",
                "lower_range": None,
                "upper_range": None,
                "method": "",
                "diagnostic_test": master,
                "erp_item_code": item_code,
            }
        )
    return rows


def _parameter_row_from_master(param, master, item_code):
    master_doc = frappe.get_doc("Diagnostic Test Master", master) if master else None
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
    row = {
        "include_in_report": 1,
        "test_name": master_doc.test_name if master_doc else "",
        "parameter_code": param.parameter_code or "",
        "description": param.parameter_name,
        "unit": param.unit or "",
        "lower_range": param.normal_min,
        "upper_range": param.normal_max,
        "method": param.method or (master_doc.machine_method if master_doc else ""),
        "parameter_kind": kind,
        "is_calculated": is_calc,
        "formula": formula,
        "interpretation": param.interpretation or (master_doc.interpretation if master_doc else ""),
        "diagnostic_test": master,
        "erp_item_code": item_code,
    }
    if hasattr(param, "reagent_item") and kind == "Real" and param.reagent_item:
        row["reagent_item"] = param.reagent_item
        row["reagent_qty"] = flt(getattr(param, "reagent_qty", None) or 0) or 1
    return row


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
            "specimen": "Serum" if dept == "Biochemistry" else "",
            "parameters": build_parameter_rows_from_trf(trf),
        }
    )
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
    machine_rows = frappe.get_all(
        "Lab Test Result",
        filters={"customer_trf": trf.name},
        fields=[
            "analyte_test_name",
            "numeric_result_value",
            "unit_of_measure",
            "reference_range",
            "abnormal_flag",
            "erp_item_code",
        ],
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
                param.result_value = str(row.numeric_result_value)
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
                    param.abnormal_flag = abnormal_flag_for_value(
                        param.diagnostic_test, param.description, param.result_value
                    )
                imported += 1
                break
    return imported


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
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import abnormal_flag_for_value

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

        try:
            numeric = flt(param.result_value)
        except Exception:
            numeric = flt(param.result_value) if param.result_value.replace(".", "", 1).isdigit() else 0

        data = {
            "barcode_link": barcode,
            "analyte_test_name": analyte,
            "numeric_result_value": numeric,
            "unit_of_measure": param.unit,
            "machine_reference": "Manual Entry",
            "verification_timestamp": now_datetime(),
            "customer_trf": trf.name,
            "reference_range": ref,
            "abnormal_flag": flag,
        }
        if param.erp_item_code and frappe.get_meta("Lab Test Result").has_field("erp_item_code"):
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
    filled = frappe.db.sql(
        """
        SELECT COUNT(*) FROM `tabLab Test Result`
        WHERE customer_trf = %s AND numeric_result_value IS NOT NULL
        """,
        trf_name,
    )[0][0]
    return filled >= expected


@frappe.whitelist()
def finalize_lab_report(lab_report=None):
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


def render_nabl_lab_report_html(payload):
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        render_remedium_lab_report_html,
    )

    return render_remedium_lab_report_html(payload)


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

    if not trf_results_complete(trf_name):
        current = frappe.db.get_value("Customer TRF", trf_name, "order_status")
        if current in ("Booked", "Sample Collected"):
            frappe.db.set_value("Customer TRF", trf_name, "order_status", "In Lab")
        return False

    frappe.db.set_value("Customer TRF", trf_name, "order_status", "Completed")
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
def get_lab_report_preview_html(lab_report=None):
    from health_ecosystem_core.health_ecosystem_core.api import _parse_request_value

    lab_report = _parse_request_value("lab_report", lab_report)
    if not lab_report:
        return ""
    return render_nabl_lab_report_html(lab_report_print_payload(lab_report))


# ---------------------------------------------------------------------------
# Phase 36 — Lab report result entry on the web app (parity with Desk form)
# ---------------------------------------------------------------------------

# Fields a lab technician may edit from the web grid.
_EDITABLE_PARAM_FIELDS = (
    "result_value",
    "unit",
    "method",
    "abnormal_flag",
    "interpretation",
    "include_in_report",
)

# TRF statuses that belong in the lab technician result-entry queue.
_QUEUE_TRF_STATUSES = ("Sample Collected", "In Lab")


def _staff_guard():
    """Return an _error() dict if the current user is not lab staff, else None."""
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import require_roles

    if frappe.session.user == "Guest":
        from health_ecosystem_core.health_ecosystem_core.api import _error

        return _error("Not authenticated", 401)
    return require_roles("Lab Technician", "Pathologist", "Health System Admin", "System Manager")


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
            }
        )
    return {
        "lab_report": doc.name,
        "customer_trf": doc.customer_trf,
        "care_journey": doc.get("care_journey"),
        "report_status": doc.report_status,
        "department": doc.department,
        "report_title_1": doc.get("report_title_1"),
        "report_title_2": doc.get("report_title_2"),
        "patient_name": frappe.db.get_value("Customer TRF", doc.customer_trf, "patient_name"),
        "specimen": doc.get("specimen"),
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
def save_lab_report_parameters(lab_report=None, parameters=None):
    """Persist edited result values / units / interpretations from the web grid.

    ``parameters`` is a JSON array of rows keyed by child ``name``. Only the
    fields in ``_EDITABLE_PARAM_FIELDS`` are written; calculated rows are
    re-derived on save so formulas stay authoritative.
    """
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import apply_calculated_parameters

    guard = _staff_guard()
    if guard:
        return guard

    lab_report = _parse_request_value("lab_report", lab_report)
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
    if doc.report_status in ("Draft",) or not doc.report_status:
        doc.report_status = "In Progress"
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
