"""Phase 59 — Operational inventory: Real vs Calculated parameters + derivation on Save.

- Parameter Type: Real (measured / LIS / manual) vs Calculated (derived)
- Derivation Equation on Calculated params — evaluated on every Save (Desk + web + LIS)
- Reagent consumption on TRF Completed is tied to Real parameters only
"""

from __future__ import annotations

import re

import frappe
from frappe.utils import cint, flt

# Tokens in derivation equations are aliased across LIS / Apollo / Mayo names.
FORMULA_ALIAS_GROUPS = (
    ("ALBUMIN", "ALBUMIN_SERUM", "SERUM_ALBUMIN"),
    ("TOTAL_PROTEIN", "PROTEIN_TOTAL", "PROTEIN_TOTAL_SERUM", "TOTAL_PROTEIN_SERUM", "SERUM_PROTEIN"),
    ("GLOBULIN", "GLOBULIN_SERUM", "SERUM_GLOBULIN"),
    ("ALT", "SGPT", "ALT_SGPT", "ALANINE_AMINOTRANSFERASE_ALT_SGPT", "ALANINE_AMINOTRANSFERASE"),
    ("AST", "SGOT", "AST_SGOT", "ASPARTATE_AMINOTRANSFERASE_AST_SGOT", "ASPARTATE_AMINOTRANSFERASE"),
    ("ALP", "ALKALINE_PHOSPHATASE", "ALKALINE_PHOSPHATASE_ALP"),
    ("TOTAL_BILI", "BILIRUBIN_TOTAL", "BILIRUBIN_TOTAL_SERUM", "TOTAL_BILIRUBIN"),
    ("DIRECT_BILI", "BILIRUBIN_DIRECT", "BILIRUBIN_CONJUGATED_DIRECT_SERUM", "DIRECT_BILIRUBIN", "CONJUGATED_BILIRUBIN"),
    ("INDIRECT_BILI", "BILIRUBIN_INDIRECT", "INDIRECT_BILIRUBIN", "UNCONJUGATED_BILIRUBIN"),
    ("HDL", "HDL_C", "HDL_CHOLESTEROL", "HDL_CHOLESTEROL_SERUM"),
    ("LDL", "LDL_C", "LDL_CHOLESTEROL"),
    ("VLDL", "VLDL_C", "VLDL_CHOLESTEROL"),
    ("TC", "TOTAL_CHOLESTEROL", "CHOLESTEROL"),
    ("TG", "TRIGLYCERIDES", "TRIGLYCERIDES_SERUM", "TRIGLYCERIDE"),
    ("IRON", "IRON_SERUM", "SERUM_IRON"),
    ("TIBC", "TIBC_TOTAL_IRON_BINDING_CAPACITY", "TOTAL_IRON_BINDING_CAPACITY"),
    ("HBA1C", "HBA1C_GLYCATED_HAEMOGLOBIN", "GLYCATED_HAEMOGLOBIN", "GLYCOSYLATED_HAEMOGLOBIN"),
    ("UREA", "BLOOD_UREA", "UREA_SERUM", "SERUM_UREA"),
    ("BUN", "BUN_BLOOD_UREA_NITROGEN", "BLOOD_UREA_NITROGEN"),
    ("CREATININE", "CREATININE_SERUM", "SERUM_CREATININE"),
    ("NA", "SODIUM", "SODIUM_NA"),
    ("CL", "CHLORIDE", "CHLORIDE_CL"),
    ("HCO3", "BICARBONATE", "BICARBONATE_HCO3"),
    ("CA", "CALCIUM", "CALCIUM_SERUM", "SERUM_CALCIUM"),
    ("TLC", "TOTAL_LEUCOCYTE_COUNT_TLC", "WBC", "WBC_COUNT"),
    ("NEUT_ABS", "NEUTROPHILS_ABS", "ABSOLUTE_NEUTROPHIL_COUNT"),
    ("LYMPH_ABS", "LYMPHOCYTES_ABS", "ABSOLUTE_LYMPHOCYTE_COUNT"),
    ("NRBC", "NRBCS_100_WBC"),
    ("PLATELETS", "PLATELET_COUNT"),
)

# Derived / calculator parameters. Formulas use short alias tokens.
# requires = parent alias keys that must exist on the same Diagnostic Test Master to auto-insert.
DERIVED_SPECS = (
    {
        "code": "GLOBULIN",
        "name": "Globulin",
        "unit": "g/dL",
        "normal_min": 2.0,
        "normal_max": 3.5,
        "formula": "{TOTAL_PROTEIN} - {ALBUMIN}",
        "hints": ("globulin",),
        "exclude": ("thyroglobulin", "sex hormone", "a/g", "albumin/globulin"),
        "codes": ("GLOBULIN", "GLOBULIN_SERUM", "SERUM_GLOBULIN"),
        "requires": ("TOTAL_PROTEIN", "ALBUMIN"),
        "description": "Total Protein minus Serum Albumin.",
    },
    {
        "code": "A_G_RATIO",
        "name": "A/G Ratio",
        "unit": "",
        "normal_min": 1.1,
        "normal_max": 2.5,
        "formula": "{ALBUMIN} / {GLOBULIN}",
        "hints": ("a/g ratio", "a/g", "albumin/globulin", "albumin globulin ratio", "ag ratio"),
        "exclude": (),
        "codes": ("A_G_RATIO", "AG_RATIO", "ALBUMIN_GLOBULIN_RATIO"),
        "requires": ("ALBUMIN", "GLOBULIN"),
        "description": "Albumin ÷ Globulin. Normal 1.1–2.5.",
        "legacy_formulas": ("{ALBUMIN_SERUM} / {GLOBULIN}",),
    },
    {
        "code": "AST_ALT_RATIO",
        "name": "AST/ALT Ratio",
        "unit": "",
        "normal_min": None,
        "normal_max": 2.0,
        "formula": "{AST} / {ALT}",
        "hints": ("ast/alt", "ast / alt", "de ritis", "sgot/sgpt", "sgot / sgpt"),
        "exclude": (),
        "codes": ("AST_ALT_RATIO", "DE_RITIS_RATIO", "SGOT_SGPT_RATIO"),
        "requires": ("AST", "ALT"),
        "description": "AST (SGOT) ÷ ALT (SGPT). Values >2 often suggest alcohol-related liver injury.",
    },
    {
        "code": "BILIRUBIN_INDIRECT",
        "name": "Bilirubin (Indirect)",
        "unit": "mg/dL",
        "normal_min": 0.2,
        "normal_max": 1.1,
        "formula": "{TOTAL_BILI} - {DIRECT_BILI}",
        "hints": ("bilirubin (indirect)", "indirect bilirubin", "unconjugated bilirubin"),
        "exclude": (),
        "codes": ("BILIRUBIN_INDIRECT", "INDIRECT_BILIRUBIN", "UNCONJUGATED_BILIRUBIN"),
        "requires": ("TOTAL_BILI", "DIRECT_BILI"),
        "description": "Total bilirubin minus conjugated (direct) bilirubin.",
        "legacy_formulas": ("{BILIRUBIN_TOTAL_SERUM} - {BILIRUBIN_CONJUGATED_DIRECT_SERUM}",),
    },
    {
        "code": "NON_HDL_CHOLESTEROL",
        "name": "Non-HDL Cholesterol",
        "unit": "mg/dL",
        "normal_min": None,
        "normal_max": 130.0,
        "formula": "{TC} - {HDL}",
        "hints": ("non-hdl", "non hdl"),
        "exclude": (),
        "codes": ("NON_HDL_CHOLESTEROL", "NON_HDL"),
        "requires": ("TC", "HDL"),
        "legacy_formulas": ("{TOTAL_CHOLESTEROL} - {HDL_CHOLESTEROL_SERUM}",),
    },
    {
        "code": "VLDL_CHOLESTEROL",
        "name": "VLDL Cholesterol",
        "unit": "mg/dL",
        "normal_min": None,
        "normal_max": 30.0,
        "formula": "{TG} / 5",
        "hints": ("vldl",),
        "exclude": (),
        "codes": ("VLDL_CHOLESTEROL", "VLDL", "VLDL_C"),
        "requires": ("TG",),
        "description": "Friedewald VLDL = Triglycerides ÷ 5.",
    },
    {
        "code": "CHOL_HDL_RATIO",
        "name": "CHOL / HDL Ratio",
        "unit": "",
        "normal_min": None,
        "normal_max": 3.5,
        "formula": "{TC} / {HDL}",
        "hints": ("chol / hdl", "chol/hdl", "tc/hdl", "cholesterol/hdl"),
        "exclude": ("ldl / hdl", "ldl/hdl"),
        "codes": ("CHOL_HDL_RATIO", "TC_HDL_RATIO"),
        "requires": ("TC", "HDL"),
        "legacy_formulas": ("{TOTAL_CHOLESTEROL} / {HDL_CHOLESTEROL_SERUM}",),
    },
    {
        "code": "LDL_HDL_RATIO",
        "name": "LDL / HDL Ratio",
        "unit": "",
        "normal_min": None,
        "normal_max": 3.0,
        "formula": "{LDL} / {HDL}",
        "hints": ("ldl / hdl", "ldl/hdl"),
        "exclude": (),
        "codes": ("LDL_HDL_RATIO",),
        "requires": ("LDL", "HDL"),
    },
    {
        "code": "ATHEROGENIC_INDEX_PLASMA_AIP",
        "name": "Atherogenic Index Plasma (AIP)",
        "unit": "",
        "normal_min": None,
        "normal_max": None,
        "formula": "log10({TG} / {HDL})",
        "hints": ("atherogenic",),
        "exclude": (),
        "codes": ("ATHEROGENIC_INDEX_PLASMA_AIP", "AIP"),
        "requires": ("TG", "HDL"),
        "legacy_formulas": ("log10({TRIGLYCERIDES_SERUM} / {HDL_CHOLESTEROL_SERUM})",),
    },
    {
        "code": "NEUTROPHIL_LYMPHOCYTE_RATIO_NLR",
        "name": "Neutrophil Lymphocyte Ratio (NLR)",
        "unit": "",
        "normal_min": 1.0,
        "normal_max": 2.0,
        "formula": "{NEUT_ABS} / {LYMPH_ABS}",
        "hints": ("neutrophil lymphocyte ratio", "nlr"),
        "exclude": (),
        "codes": ("NEUTROPHIL_LYMPHOCYTE_RATIO_NLR", "NLR"),
        "requires": ("NEUT_ABS", "LYMPH_ABS"),
        "legacy_formulas": ("{NEUTROPHILS_ABS} / {LYMPHOCYTES_ABS}",),
    },
    {
        "code": "CORRECTED_TLC",
        "name": "Corrected TLC",
        "unit": "cells/µL",
        "normal_min": None,
        "normal_max": None,
        "formula": "{TLC} * 100 / (100 + {NRBC})",
        "hints": ("corrected tlc", "corrected wbc"),
        "exclude": (),
        "codes": ("CORRECTED_TLC", "CORRECTED_WBC"),
        "requires": ("TLC", "NRBC"),
        "legacy_formulas": ("{TOTAL_LEUCOCYTE_COUNT_TLC} * 100 / (100 + {NRBCS_100_WBC})",),
    },
    {
        "code": "ESTIMATED_AVERAGE_GLUCOSE_EAG",
        "name": "Estimated Average Glucose (EAG)",
        "unit": "mg/dL",
        "normal_min": None,
        "normal_max": 117.0,
        "formula": "28.7 * {HBA1C} - 46.7",
        "hints": ("estimated average glucose", "eag"),
        "exclude": (),
        "codes": ("ESTIMATED_AVERAGE_GLUCOSE_EAG", "EAG"),
        "requires": ("HBA1C",),
        "description": "NGSP: eAG (mg/dL) = 28.7 × HbA1c − 46.7.",
        "legacy_formulas": ("28.7 * {HBA1C_GLYCATED_HAEMOGLOBIN} - 46.7",),
    },
    {
        "code": "BUN_BLOOD_UREA_NITROGEN",
        "name": "BUN (Blood Urea Nitrogen)",
        "unit": "mg/dL",
        "normal_min": 7.0,
        "normal_max": 20.0,
        "formula": "{UREA} / 2.14",
        "hints": ("bun", "blood urea nitrogen"),
        "exclude": ("bun/creatinine", "bun / creatinine", "bun creatinine"),
        "codes": ("BUN", "BUN_BLOOD_UREA_NITROGEN", "BLOOD_UREA_NITROGEN"),
        "requires": ("UREA",),
        "description": "BUN = Urea ÷ 2.14.",
    },
    {
        "code": "BUN_CREATININE_RATIO",
        "name": "BUN/Creatinine Ratio",
        "unit": "",
        "normal_min": 10.0,
        "normal_max": 20.0,
        "formula": "{BUN} / {CREATININE}",
        "hints": ("bun/creatinine", "bun / creatinine", "bun creatinine ratio"),
        "exclude": (),
        "codes": ("BUN_CREATININE_RATIO",),
        "requires": ("BUN", "CREATININE"),
    },
    {
        "code": "ANION_GAP",
        "name": "Anion Gap",
        "unit": "mEq/L",
        "normal_min": 8.0,
        "normal_max": 16.0,
        "formula": "{NA} - ({CL} + {HCO3})",
        "hints": ("anion gap",),
        "exclude": (),
        "codes": ("ANION_GAP",),
        "requires": ("NA", "CL", "HCO3"),
        "description": "Na − (Cl + HCO3).",
    },
    {
        "code": "CORRECTED_CALCIUM",
        "name": "Corrected Calcium",
        "unit": "mg/dL",
        "normal_min": 8.6,
        "normal_max": 10.2,
        "formula": "{CA} + 0.8 * (4 - {ALBUMIN})",
        "hints": ("corrected calcium", "albumin corrected calcium", "adjusted calcium"),
        "exclude": (),
        "codes": ("CORRECTED_CALCIUM", "ALBUMIN_CORRECTED_CALCIUM"),
        "requires": ("CA", "ALBUMIN"),
        "description": "Measured Ca + 0.8 × (4 − Albumin).",
    },
    {
        "code": "UIBC",
        "name": "UIBC (Unsaturated Iron Binding Capacity)",
        "unit": "µg/dL",
        "normal_min": 110.0,
        "normal_max": 370.0,
        "formula": "{TIBC} - {IRON}",
        "hints": ("uibc", "unsaturated iron"),
        "exclude": (),
        "codes": ("UIBC", "UIBC_UNSATURATED_IRON_BINDING_CAPACITY"),
        "requires": ("TIBC", "IRON"),
        "description": "TIBC minus Serum Iron.",
    },
    {
        "code": "TRANSFERRIN_SATURATION",
        "name": "Transferrin Saturation",
        "unit": "%",
        "normal_min": 20.0,
        "normal_max": 50.0,
        "formula": "({IRON} / {TIBC}) * 100",
        "hints": ("transferrin saturation", "tsat"),
        "exclude": (),
        "codes": ("TRANSFERRIN_SATURATION", "TSAT"),
        "requires": ("IRON", "TIBC"),
        "description": "(Serum Iron ÷ TIBC) × 100.",
    },
)

DERIVATION_BY_CODE = {spec["code"]: spec["formula"] for spec in DERIVED_SPECS}
for spec in DERIVED_SPECS:
    for extra in spec.get("codes") or ():
        DERIVATION_BY_CODE.setdefault(extra, spec["formula"])

DERIVATION_BY_NAME_HINT = tuple((hint, spec["formula"]) for spec in DERIVED_SPECS for hint in spec["hints"])


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


def _slug(text):
    return re.sub(r"[^A-Z0-9]+", "_", (text or "").upper()).strip("_")


def expand_formula_aliases(variables):
    """Copy measured values onto short tokens used in derivation equations."""
    out = dict(variables or {})
    for group in FORMULA_ALIAS_GROUPS:
        present = None
        for key in group:
            if key in variables:
                present = variables[key]
                break
        if present is None:
            continue
        for key in group:
            out.setdefault(key, present)
    return out


def _row_tokens(row):
    tokens = set()
    code = (
        getattr(row, "parameter_code", None)
        or (row.get("parameter_code") if hasattr(row, "get") else None)
        or ""
    )
    name = (
        getattr(row, "parameter_name", None)
        or (row.get("parameter_name") if hasattr(row, "get") else None)
        or getattr(row, "description", None)
        or (row.get("description") if hasattr(row, "get") else None)
        or ""
    )
    code = str(code).strip().upper()
    if code:
        tokens.add(code)
    slug = _slug(name)
    if slug:
        tokens.add(slug)
    expanded = set(tokens)
    for group in FORMULA_ALIAS_GROUPS:
        if tokens & set(group):
            expanded.update(group)
    return expanded


def match_derived_spec(parameter_code=None, parameter_name=None):
    code = (parameter_code or "").strip().upper()
    lower = (parameter_name or "").lower()
    for spec in DERIVED_SPECS:
        if code and code in (spec.get("codes") or ()):
            return spec
        if not lower:
            continue
        if any(ex and ex in lower for ex in (spec.get("exclude") or ())):
            continue
        if any(hint and hint in lower for hint in (spec.get("hints") or ())):
            return spec
    return None


def formula_for_parameter(parameter_code=None, parameter_name=None, existing_formula=None) -> str:
    spec = match_derived_spec(parameter_code, parameter_name)
    canonical = spec["formula"] if spec else ""
    current = str(existing_formula or "").strip()
    if current:
        legacy = set(spec.get("legacy_formulas") or ()) if spec else set()
        if spec and (current == canonical or current in legacy):
            return canonical
        return current
    if canonical:
        return canonical
    code = (parameter_code or "").strip().upper()
    if code in DERIVATION_BY_CODE:
        return DERIVATION_BY_CODE[code]
    return ""


def _apply_derived_spec_to_row(row, spec):
    changed = False
    if (getattr(row, "parameter_kind", None) or "") != "Calculated" or not cint(row.is_calculated):
        row.parameter_kind = "Calculated"
        row.is_calculated = 1
        changed = True
    formula = formula_for_parameter(row.parameter_code, row.parameter_name, row.formula)
    if spec and (not (row.formula or "").strip() or (row.formula or "").strip() in (spec.get("legacy_formulas") or ())):
        formula = spec["formula"]
    if formula and (row.formula or "").strip() != formula:
        row.formula = formula
        changed = True
    if getattr(row, "reagent_item", None):
        row.reagent_item = None
        row.reagent_qty = 0
        changed = True
    if spec.get("description") and not (getattr(row, "description", None) or "").strip():
        row.description = spec["description"]
        changed = True
    refresh_range = spec.get("code") in (
        "A_G_RATIO",
        "AST_ALT_RATIO",
        "GLOBULIN",
        "BILIRUBIN_INDIRECT",
    )
    if spec.get("normal_min") is not None and (refresh_range or row.normal_min in (None, "")):
        if flt(row.normal_min or 0) != flt(spec["normal_min"]) or row.normal_min in (None, ""):
            row.normal_min = spec["normal_min"]
            changed = True
    if spec.get("normal_max") is not None and (refresh_range or row.normal_max in (None, "")):
        if flt(row.normal_max or 0) != flt(spec["normal_max"]) or row.normal_max in (None, ""):
            row.normal_max = spec["normal_max"]
            changed = True
    if spec.get("unit") and not (row.unit or "").strip():
        row.unit = spec["unit"]
        changed = True
    return changed


def _master_alias_keys(doc):
    keys = set()
    for row in doc.parameters or []:
        keys.update(_row_tokens(row))
    return keys


def _append_missing_derived_rows(doc):
    """Insert calculator lines when parent analytes already exist on the master."""
    present = _master_alias_keys(doc)
    existing_codes = {
        (row.parameter_code or "").strip().upper() for row in (doc.parameters or []) if row.parameter_code
    }
    existing_names = {(row.parameter_name or "").strip().lower() for row in (doc.parameters or [])}
    added = 0
    for spec in DERIVED_SPECS:
        if spec["code"] in existing_codes or spec["name"].lower() in existing_names:
            continue
        if any(match_derived_spec(row.parameter_code, row.parameter_name) is spec for row in (doc.parameters or [])):
            continue
        required = spec.get("requires") or ()
        if required and not all(key in present for key in required):
            continue
        doc.append(
            "parameters",
            {
                "parameter_code": spec["code"],
                "parameter_name": spec["name"],
                "unit": spec.get("unit") or "",
                "normal_min": spec.get("normal_min"),
                "normal_max": spec.get("normal_max"),
                "parameter_kind": "Calculated",
                "is_calculated": 1,
                "formula": spec["formula"],
                "description": spec.get("description") or "",
                "result_input_type": "Numeric",
            },
        )
        existing_codes.add(spec["code"])
        existing_names.add(spec["name"].lower())
        present.update(_row_tokens(doc.parameters[-1]))
        added += 1
    return added


def sync_parameter_kinds_and_formulas(limit=None):
    """Mark known calculator parameters Calculated and fill derivation equations."""
    lim = cint(limit) if limit else 0
    masters = frappe.get_all("Diagnostic Test Master", pluck="name", limit=lim or None)
    updated_masters = 0
    updated_rows = 0
    inserted_rows = 0
    for name in masters:
        doc = frappe.get_doc("Diagnostic Test Master", name)
        changed = False
        present = _master_alias_keys(doc)
        for row in doc.parameters or []:
            spec = match_derived_spec(row.parameter_code, row.parameter_name)
            parents_ok = bool(spec) and all(key in present for key in (spec.get("requires") or ()))
            if spec and (parents_ok or not spec.get("requires")):
                if _apply_derived_spec_to_row(row, spec):
                    changed = True
                    updated_rows += 1
                continue
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
        inserted = _append_missing_derived_rows(doc)
        if inserted:
            inserted_rows += inserted
            changed = True
        if changed:
            doc.save(ignore_permissions=True)
            updated_masters += 1
    return {"masters": updated_masters, "rows": updated_rows, "inserted": inserted_rows}


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
