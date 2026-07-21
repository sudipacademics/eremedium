"""Phase 59 — Operational inventory: Real vs Calculated parameters + derivation on Save.

- Parameter Type: Real (measured / LIS / manual) vs Calculated (derived)
- Derivation Equation on Calculated params — evaluated on every Save (Desk + web + LIS)
- Reagent consumption on TRF Completed is tied to Real parameters only
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt

# parameter_code → derivation equation (tokens = {PARAMETER_CODE})
# Codes match clinical_phase56._param_code()
DERIVATION_BY_CODE = {
    # LFT
    "BILIRUBIN_INDIRECT": "{BILIRUBIN_TOTAL_SERUM} - {BILIRUBIN_CONJUGATED_DIRECT_SERUM}",
    "A_G_RATIO": "{ALBUMIN_SERUM} / {GLOBULIN}",
    # Lipid
    "NON_HDL_CHOLESTEROL": "{TOTAL_CHOLESTEROL} - {HDL_CHOLESTEROL_SERUM}",
    "CHOL_HDL_RATIO": "{TOTAL_CHOLESTEROL} / {HDL_CHOLESTEROL_SERUM}",
    "ATHEROGENIC_INDEX_PLASMA_AIP": "log10({TRIGLYCERIDES_SERUM} / {HDL_CHOLESTEROL_SERUM})",
    # CBC
    "NEUTROPHIL_LYMPHOCYTE_RATIO_NLR": "{NEUTROPHILS_ABS} / {LYMPHOCYTES_ABS}",
    "CORRECTED_TLC": "{TOTAL_LEUCOCYTE_COUNT_TLC} * 100 / (100 + {NRBCS_100_WBC})",
    # Diabetes
    "ESTIMATED_AVERAGE_GLUCOSE_EAG": "28.7 * {HBA1C_GLYCATED_HAEMOGLOBIN} - 46.7",
}

# Fallback match on parameter name fragments → formula (when code remap differs)
DERIVATION_BY_NAME_HINT = (
    ("bilirubin (indirect)", "{BILIRUBIN_TOTAL_SERUM} - {BILIRUBIN_CONJUGATED_DIRECT_SERUM}"),
    ("indirect bilirubin", "{BILIRUBIN_TOTAL_SERUM} - {BILIRUBIN_CONJUGATED_DIRECT_SERUM}"),
    ("a/g ratio", "{ALBUMIN_SERUM} / {GLOBULIN}"),
    ("non-hdl", "{TOTAL_CHOLESTEROL} - {HDL_CHOLESTEROL_SERUM}"),
    ("chol / hdl", "{TOTAL_CHOLESTEROL} / {HDL_CHOLESTEROL_SERUM}"),
    ("chol/hdl", "{TOTAL_CHOLESTEROL} / {HDL_CHOLESTEROL_SERUM}"),
    ("atherogenic", "log10({TRIGLYCERIDES_SERUM} / {HDL_CHOLESTEROL_SERUM})"),
    ("neutrophil lymphocyte ratio", "{NEUTROPHILS_ABS} / {LYMPHOCYTES_ABS}"),
    ("corrected tlc", "{TOTAL_LEUCOCYTE_COUNT_TLC} * 100 / (100 + {NRBCS_100_WBC})"),
    ("estimated average glucose", "28.7 * {HBA1C_GLYCATED_HAEMOGLOBIN} - 46.7"),
    ("eag", "28.7 * {HBA1C_GLYCATED_HAEMOGLOBIN} - 46.7"),
)


def is_calculated_param(row) -> bool:
    """True when parameter is derived (Calculated), not measured."""
    kind = (
        getattr(row, "parameter_kind", None)
        or (row.get("parameter_kind") if hasattr(row, "get") else None)
        or ""
    ).strip()
    if kind == "Calculated":
        return True
    if kind == "Real":
        return False
    calc = getattr(row, "is_calculated", None)
    if calc is None and hasattr(row, "get"):
        calc = row.get("is_calculated")
    return bool(cint(calc))


def is_real_param(row) -> bool:
    return not is_calculated_param(row)


def formula_for_parameter(parameter_code=None, parameter_name=None, existing_formula=None) -> str:
    if existing_formula and str(existing_formula).strip():
        return str(existing_formula).strip()
    code = (parameter_code or "").strip().upper()
    if code in DERIVATION_BY_CODE:
        return DERIVATION_BY_CODE[code]
    lower = (parameter_name or "").lower()
    for hint, formula in DERIVATION_BY_NAME_HINT:
        if hint in lower:
            return formula
    return ""


def sync_parameter_kinds_and_formulas(limit=None):
    """Backfill parameter_kind + derivation equations on Diagnostic Test Master rows."""
    lim = cint(limit) if limit else 0
    masters = frappe.get_all("Diagnostic Test Master", pluck="name", limit=lim or None)
    updated_masters = 0
    updated_rows = 0
    for name in masters:
        doc = frappe.get_doc("Diagnostic Test Master", name)
        changed = False
        for row in doc.parameters or []:
            calc = cint(row.is_calculated)
            kind = (getattr(row, "parameter_kind", None) or "").strip()
            if calc and kind != "Calculated":
                row.parameter_kind = "Calculated"
                row.is_calculated = 1
                changed = True
                updated_rows += 1
            elif not calc and kind != "Real":
                row.parameter_kind = "Real"
                row.is_calculated = 0
                changed = True
                updated_rows += 1
            if is_calculated_param(row):
                formula = formula_for_parameter(row.parameter_code, row.parameter_name, row.formula)
                if formula and (row.formula or "").strip() != formula:
                    row.formula = formula
                    changed = True
                    updated_rows += 1
                if getattr(row, "reagent_item", None):
                    row.reagent_item = None
                    row.reagent_qty = 0
                    changed = True
        if changed:
            doc.save(ignore_permissions=True)
            updated_masters += 1
    return {"masters": updated_masters, "rows": updated_rows}


def sync_open_lab_report_param_meta(limit=200):
    """Copy kind/formula/reagent meta onto Draft/In Progress Lab Report parameter rows."""
    reports = frappe.get_all(
        "Lab Report",
        filters={"report_status": ("in", ("Draft", "In Progress", "Verified"))},
        pluck="name",
        limit=cint(limit),
    )
    patched = 0
    for name in reports:
        doc = frappe.get_doc("Lab Report", name)
        changed = False
        for row in doc.parameters or []:
            master_name = row.diagnostic_test
            if not master_name or not frappe.db.exists("Diagnostic Test Master", master_name):
                if cint(row.is_calculated) and (getattr(row, "parameter_kind", None) or "") != "Calculated":
                    row.parameter_kind = "Calculated"
                    changed = True
                elif not cint(row.is_calculated) and (getattr(row, "parameter_kind", None) or "") != "Real":
                    row.parameter_kind = "Real"
                    changed = True
                continue
            master = frappe.get_doc("Diagnostic Test Master", master_name)
            match = None
            for mrow in master.parameters or []:
                if (mrow.parameter_code and mrow.parameter_code == row.parameter_code) or (
                    mrow.parameter_name and mrow.parameter_name == row.description
                ):
                    match = mrow
                    break
            if not match:
                continue
            for field in ("parameter_kind", "is_calculated", "formula", "reagent_item", "reagent_qty"):
                if not hasattr(row, field) or not hasattr(match, field):
                    continue
                new_val = getattr(match, field)
                if getattr(row, field) != new_val:
                    setattr(row, field, new_val)
                    changed = True
        if changed:
            from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
                apply_calculated_parameters,
            )

            apply_calculated_parameters(doc, force=True)
            doc.save(ignore_permissions=True)
            patched += 1
    return {"reports": patched}


def seed_parameter_reagent_defaults():
    """Kit reagents stay on Lab Test Reagent Rule; per-analyte reagent_item is manual.

    Auto-binding a kit onto every Real CBC/LFT row would over-consume on Complete.
    """
    return {
        "parameter_reagents": 0,
        "note": "set reagent_item on Real params or use Lab Test Reagent Rule",
    }


def setup_phase59():
    """Reload doctypes, sync kinds/formulas, seed parameter reagents."""
    import os

    from frappe.modules.import_file import import_file_by_path

    for folder in (
        "diagnostic_test_parameter",
        "lab_report_parameter",
        "lab_test_reagent_rule",
    ):
        candidates = (
            frappe.get_app_path(
                "health_ecosystem_core",
                "health_ecosystem_core",
                "health_ecosystem_core",
                "doctype",
                folder,
                f"{folder}.json",
            ),
            frappe.get_app_path(
                "health_ecosystem_core",
                "health_ecosystem_core",
                "doctype",
                folder,
                f"{folder}.json",
            ),
        )
        for candidate in candidates:
            if candidate and os.path.exists(candidate):
                import_file_by_path(candidate, force=True)
                break

    kinds = sync_parameter_kinds_and_formulas()
    reagents = seed_parameter_reagent_defaults()
    reports = sync_open_lab_report_param_meta()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 59,
        "kinds": kinds,
        "reagents": reagents,
        "reports": reports,
    }


def collect_real_parameter_consumptions(trf):
    """Build reagent debit plan from Real parameters with results.

    Preference order:
    1. Real report rows with reagent_item + qty (per-analyte)
    2. Lab Test Reagent Rule with matching parameter_code (Real only)
    3. Legacy whole-test rule (blank parameter_code) once per test item when
       at least one Real parameter on that item has a result

    Calculated parameters never consume reagents.
    """
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
        _find_open_batch,
        _trf_test_items,
    )

    planned = []
    alerts = []
    franchisee_id = trf.get("franchisee_id")

    report_name = frappe.db.get_value(
        "Lab Report", {"customer_trf": trf.name}, "name", order_by="creation desc"
    )
    param_rows = []
    if report_name:
        param_rows = list(frappe.get_doc("Lab Report", report_name).parameters or [])

    by_reagent = {}
    items_with_real_results = set()
    items_with_param_scoped_debit = set()
    meta_has_param_code = frappe.get_meta("Lab Test Reagent Rule").has_field("parameter_code")

    for row in param_rows:
        if is_calculated_param(row):
            continue
        if not (row.result_value or "").strip():
            continue
        item_code = row.erp_item_code or ""
        if item_code:
            items_with_real_results.add(item_code)
        code = (row.parameter_code or "").strip()

        reagent = getattr(row, "reagent_item", None)
        qty = flt(getattr(row, "reagent_qty", None) or 0)
        if reagent and qty > 0:
            by_reagent[reagent] = by_reagent.get(reagent, 0) + qty
            if item_code:
                items_with_param_scoped_debit.add(item_code)
            continue

        if item_code and code and meta_has_param_code:
            rules = frappe.get_all(
                "Lab Test Reagent Rule",
                filters={"lab_test_item": item_code, "active": 1, "parameter_code": code},
                fields=["reagent_item", "tests_per_consumption"],
            )
            for rule in rules:
                by_reagent[rule.reagent_item] = by_reagent.get(rule.reagent_item, 0) + (
                    cint(rule.tests_per_consumption) or 1
                )
                items_with_param_scoped_debit.add(item_code)

    for test_item in _trf_test_items(trf):
        if test_item not in items_with_real_results:
            continue
        if test_item in items_with_param_scoped_debit:
            continue
        filters = {"lab_test_item": test_item, "active": 1}
        fields = ["reagent_item", "tests_per_consumption"]
        if meta_has_param_code:
            fields.append("parameter_code")
        for rule in frappe.get_all("Lab Test Reagent Rule", filters=filters, fields=fields):
            if meta_has_param_code and (rule.get("parameter_code") or "").strip():
                continue
            by_reagent[rule.reagent_item] = by_reagent.get(rule.reagent_item, 0) + (
                cint(rule.tests_per_consumption) or 1
            )

    for reagent_item, qty in by_reagent.items():
        batch = _find_open_batch(reagent_item, franchisee_id=franchisee_id)
        if not batch:
            alerts.append(
                {
                    "reagent_item": reagent_item,
                    "message": frappe._("No open batch for {0}").format(reagent_item),
                }
            )
            continue
        planned.append(
            {
                "batch_id": batch.name,
                "lot_number": batch.lot_number,
                "reagent_item": reagent_item,
                "quantity": cint(qty) or 1,
                "source": "real_parameter",
            }
        )

    return planned, alerts
