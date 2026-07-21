"""Phase 56 — Apollo247-style lab parameters on Items + Diagnostic Test Master.

Scraped / curated from Apollo 24|7 lab-test pages (CBC 30, Lipid 8, LFT 11, etc.).
Syncs:
- Item.hec_lab_parameters (JSON) + hec_lab_test_count
- Diagnostic Test Master.parameters child table
- Diagnostic Test Master.disabled toggle
"""

from __future__ import annotations

import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt

from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import LAB_ITEM_GROUP

# ---------------------------------------------------------------------------
# Parameter catalogs (Apollo 24|7 "Tests Included")
# Source: https://www.apollo247.com/lab-tests/...
# Each entry: (parameter_name, unit, normal_min, normal_max, is_calculated)
# ---------------------------------------------------------------------------

APOLLO_CBC_PARAMS = [
    ("Haemoglobin (Hb)", "g/dL", 12.0, 17.0, 0),
    ("Packed Cell Volume (PCV)", "%", 35.0, 50.0, 0),
    ("Red Blood Cell (RBC) Count", "million/µL", 4.2, 5.5, 0),
    ("Mean Corpuscular Volume (MCV)", "fL", 83.0, 101.0, 0),
    ("Mean Corpuscular Haemoglobin (MCH)", "pg", 27.0, 32.0, 0),
    ("Mean Corpuscular Haemoglobin Concentration (MCHC)", "g/dL", 31.5, 34.5, 0),
    ("Red Cell Distribution Width (RDW)", "%", 11.6, 14.0, 0),
    ("Total Leucocyte Count (TLC)", "cells/µL", 4000.0, 10000.0, 0),
    ("Neutrophils", "%", 40.0, 70.0, 0),
    ("Lymphocytes", "%", 20.0, 40.0, 0),
    ("Eosinophils", "%", 1.0, 4.0, 0),
    ("Monocytes", "%", 2.0, 8.0, 0),
    ("Basophils", "%", 0.5, 1.0, 0),
    ("Blasts", "%", 0.0, 0.0, 0),
    ("Pro-myelocytes", "%", 0.0, 0.0, 0),
    ("Myelocytes", "%", 0.0, 0.0, 0),
    ("Meta-myelocyte", "%", 0.0, 0.0, 0),
    ("Bands", "%", 0.0, 5.0, 0),
    ("Prolymphocytes", "%", 0.0, 0.0, 0),
    ("Atypical Cells", "%", 0.0, 0.0, 0),
    ("NRBCs/100 WBC", "", 0.0, 0.0, 0),
    ("Corrected TLC", "cells/µL", None, None, 1),
    ("Neutrophils (Abs)", "cells/µL", 2000.0, 7000.0, 0),
    ("Lymphocytes (Abs)", "cells/µL", 1000.0, 3000.0, 0),
    ("Eosinophils (Abs)", "cells/µL", 20.0, 400.0, 0),
    ("Monocytes (Abs)", "cells/µL", 200.0, 800.0, 0),
    ("Basophils (Abs)", "cells/µL", 20.0, 100.0, 0),
    ("Neutrophil Lymphocyte Ratio (NLR)", "", 1.0, 2.0, 1),
    ("Platelet Count", "cells/µL", 150000.0, 410000.0, 0),
    ("Mean Platelet Volume (MPV)", "fL", 7.0, 11.0, 0),
]

APOLLO_LIPID_PARAMS = [
    ("Total Cholesterol", "mg/dL", None, 200.0, 0),
    ("Triglycerides - Serum", "mg/dL", None, 150.0, 0),
    ("HDL Cholesterol - Serum", "mg/dL", 40.0, None, 0),
    ("Non-HDL Cholesterol", "mg/dL", None, 130.0, 1),
    ("LDL Cholesterol", "mg/dL", None, 100.0, 0),
    ("VLDL Cholesterol", "mg/dL", None, 30.0, 0),
    ("CHOL / HDL Ratio", "", None, 3.5, 1),
    ("Atherogenic Index Plasma (AIP)", "", None, None, 1),
]

APOLLO_LFT_PARAMS = [
    ("Bilirubin, Total - Serum", "mg/dL", 0.1, 1.2, 0),
    ("Bilirubin Conjugated (Direct) - Serum", "mg/dL", None, 0.3, 0),
    ("Bilirubin (Indirect)", "mg/dL", 0.2, 1.1, 1),
    ("Alanine Aminotransferase (ALT/SGPT)", "U/L", 21.0, 72.0, 0),
    ("Aspartate Aminotransferase (AST/SGOT)", "U/L", 17.0, 59.0, 0),
    ("Alkaline Phosphatase (ALP)", "IU/L", 38.0, 126.0, 0),
    ("Protein, Total - Serum", "g/dL", 6.3, 8.2, 0),
    ("Albumin, Serum", "g/dL", 3.5, 5.5, 0),
    ("Globulin", "g/dL", 2.0, 3.5, 0),
    ("A/G Ratio", "", 0.9, 2.2, 1),
    ("Gamma Glutamyl Transferase (GGT)", "U/L", 5.0, 40.0, 0),
]

APOLLO_DIABETES_HBA1C_PARAMS = [
    ("HbA1c, Glycated Haemoglobin", "%", None, 5.6, 0),
    ("Estimated Average Glucose (EAG)", "mg/dL", None, 117.0, 1),
]

APOLLO_KFT_BASIC_PARAMS = [
    ("Urea", "mg/dL", 15.0, 40.0, 0),
    ("Creatinine", "mg/dL", 0.6, 1.2, 0),
    ("Uric Acid", "mg/dL", 3.5, 7.2, 0),
    ("Protein, Total", "g/dL", 6.3, 8.2, 0),
    ("Albumin", "g/dL", 3.5, 5.5, 0),
    ("BUN (Blood Urea Nitrogen)", "mg/dL", 7.0, 20.0, 0),
]

APOLLO_KFT_ELECTROLYTES_PARAMS = APOLLO_KFT_BASIC_PARAMS + [
    ("Sodium (Na)", "mEq/L", 136.0, 145.0, 0),
    ("Potassium (K)", "mEq/L", 3.5, 5.1, 0),
    ("Chloride (Cl)", "mEq/L", 98.0, 107.0, 0),
    ("Calcium", "mg/dL", 8.6, 10.2, 0),
    ("Phosphorus", "mg/dL", 2.5, 4.5, 0),
    ("Bicarbonate (HCO3)", "mEq/L", 22.0, 29.0, 0),
]

APOLLO_THYROID_PARAMS = [
    ("Triiodothyronine (T3)", "ng/dL", 80.0, 200.0, 0),
    ("Thyroxine (T4)", "µg/dL", 4.5, 12.0, 0),
    ("Thyroid Stimulating Hormone (TSH)", "µIU/mL", 0.4, 4.0, 0),
]

APOLLO_FREE_THYROID_PARAMS = [
    ("Free Triiodothyronine (FT3)", "pg/mL", 2.3, 4.2, 0),
    ("Free Thyroxine (FT4)", "ng/dL", 0.8, 1.8, 0),
    ("Thyroid Stimulating Hormone (TSH)", "µIU/mL", 0.4, 4.0, 0),
]

APOLLO_URINE_ROUTINE_PARAMS = [
    ("Colour", "", None, None, 0),
    ("Appearance", "", None, None, 0),
    ("Specific Gravity", "", 1.005, 1.030, 0),
    ("pH", "", 4.6, 8.0, 0),
    ("Protein", "", None, None, 0),
    ("Glucose", "", None, None, 0),
    ("Ketones", "", None, None, 0),
    ("Bilirubin", "", None, None, 0),
    ("Urobilinogen", "", None, None, 0),
    ("Blood", "", None, None, 0),
    ("Nitrite", "", None, None, 0),
    ("Leukocyte Esterase", "", None, None, 0),
    ("RBC", "/HPF", None, None, 0),
    ("WBC", "/HPF", None, None, 0),
    ("Epithelial Cells", "/HPF", None, None, 0),
    ("Casts", "/LPF", None, None, 0),
    ("Crystals", "", None, None, 0),
    ("Bacteria", "", None, None, 0),
]

APOLLO_ELECTROLYTES_PARAMS = [
    ("Sodium (Na)", "mEq/L", 136.0, 145.0, 0),
    ("Potassium (K)", "mEq/L", 3.5, 5.1, 0),
    ("Chloride (Cl)", "mEq/L", 98.0, 107.0, 0),
]

APOLLO_ELECTROLYTES_COMPREHENSIVE = APOLLO_ELECTROLYTES_PARAMS + [
    ("Calcium", "mg/dL", 8.6, 10.2, 0),
    ("Phosphorus", "mg/dL", 2.5, 4.5, 0),
    ("Bicarbonate (HCO3)", "mEq/L", 22.0, 29.0, 0),
]

APOLLO_IRON_PROFILE_PARAMS = [
    ("Iron, Serum", "µg/dL", 60.0, 170.0, 0),
    ("TIBC (Total Iron Binding Capacity)", "µg/dL", 250.0, 450.0, 0),
    ("Transferrin Saturation", "%", 20.0, 50.0, 1),
    ("Ferritin", "ng/mL", 30.0, 400.0, 0),
]

APOLLO_DIABETES_HBA1C_PARAMS = [
    ("HbA1c, Glycated Haemoglobin", "%", None, 5.6, 0),
    ("Estimated Average Glucose (EAG)", "mg/dL", None, 117.0, 1),
]

# (match_keywords_all_must_match_or_any, match_mode, params, report_category, apollo_source)
# match_mode: "any" = any keyword matches, "all" = all keywords present
PROFILE_RULES = (
    (("complete blood count", "cbc"), "any", APOLLO_CBC_PARAMS, "HAEMATOLOGY", "apollo247.com/lab-tests/complete-blood-count-cbc"),
    (("complete haemogram", "complete hemogram", "chg"), "any", APOLLO_CBC_PARAMS, "HAEMATOLOGY", "apollo247.com/lab-tests/complete-blood-count-cbc"),
    (("lipid profile",), "any", APOLLO_LIPID_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/lipid-profile"),
    (("lft with ggt", "liver function test", "lft"), "any", APOLLO_LFT_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/liver-function-test-lft"),
    (("kidney function test with electrolytes", "kft with electrolytes"), "any", APOLLO_KFT_ELECTROLYTES_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("kidney function test basic", "kidney function test", "kft", "renal function"), "any", APOLLO_KFT_BASIC_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("free thyroid function", "ft3 ft4 tsh", "ft3 ft4"), "any", APOLLO_FREE_THYROID_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("thyroid profile", "t3t4tsh", "t3 t4 tsh"), "any", APOLLO_THYROID_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("urine re", "urine routine", "urine me", "complete urine"), "any", APOLLO_URINE_ROUTINE_PARAMS, "CLINICAL PATHOLOGY", "apollo247.com"),
    (("electrolytes comprehensive",), "any", APOLLO_ELECTROLYTES_COMPREHENSIVE, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("electrolytes na", "electrolytes"), "any", APOLLO_ELECTROLYTES_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("iron profile", "iron studies"), "any", APOLLO_IRON_PROFILE_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com"),
    (("glycosylated", "hba1c", "glycated haemoglobin", "glycated hemoglobin"), "any", APOLLO_DIABETES_HBA1C_PARAMS, "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/hba1c-glycated-hemoglobin"),
)


def _param_code(name):
    code = re.sub(r"[^A-Z0-9]+", "_", (name or "").upper()).strip("_")
    return code[:40] or "PARAM"


def _rows_from_catalog(catalog):
    rows = []
    for name, unit, nmin, nmax, calculated in catalog:
        code = _param_code(name)
        is_calc = cint(calculated)
        formula = ""
        if is_calc:
            try:
                from health_ecosystem_core.health_ecosystem_core.clinical_phase59_parameter_inventory import (
                    formula_for_parameter,
                )

                formula = formula_for_parameter(code, name)
            except Exception:
                formula = ""
        rows.append(
            {
                "parameter_code": code,
                "parameter_name": name,
                "unit": unit or "",
                "normal_min": nmin,
                "normal_max": nmax,
                "parameter_kind": "Calculated" if is_calc else "Real",
                "is_calculated": is_calc,
                "formula": formula,
                "method": "Apollo-aligned",
            }
        )
    return rows


def match_apollo_profile(item_name, item_code=None):
    """Return (param_rows, report_category, source) or (None, None, None)."""
    lower = (item_name or "").lower()
    code = (item_code or "").upper()

    # Avoid treating single analyte FT3/FT4/TSH as a full thyroid panel
    if re.search(r"\bft3\b", lower) and "ft4" not in lower and "thyroid" not in lower:
        return None, None, None
    if re.search(r"\bft4\b", lower) and "ft3" not in lower and "tsh" not in lower and "thyroid" not in lower:
        return None, None, None

    # Strong item-code / name anchors from Apollo scrapes
    if "CBC" in code or "COMPLETE-BLOOD" in code or "HAEMOGRAM" in code or "HEMOGRAM" in code:
        return _rows_from_catalog(APOLLO_CBC_PARAMS), "HAEMATOLOGY", "apollo247.com/lab-tests/complete-blood-count-cbc"
    if "LIPID" in code or "lipid profile" in lower:
        return _rows_from_catalog(APOLLO_LIPID_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/lipid-profile"
    if "HBA1C" in code or "GLYCOSYLATED" in code or "glycated" in lower:
        return _rows_from_catalog(APOLLO_DIABETES_HBA1C_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/hba1c-glycated-hemoglobin"
    if ("LIVER-FUNCTION" in code or "LFT" in code or "liver function" in lower) and "with ggt" not in lower:
        # LFT and LFT-WITH-GGT both use the 11-param Apollo LFT panel (includes GGT)
        return _rows_from_catalog(APOLLO_LFT_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/liver-function-test-lft"
    if "LFT" in code or "liver function" in lower:
        return _rows_from_catalog(APOLLO_LFT_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com/lab-tests/liver-function-test-lft"
    if "KIDNEY" in code and "ELECTROLYTE" in code:
        return _rows_from_catalog(APOLLO_KFT_ELECTROLYTES_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com"
    if "KIDNEY" in code or "renal function" in lower or re.search(r"\bkft\b", lower):
        return _rows_from_catalog(APOLLO_KFT_BASIC_PARAMS), "CLINICAL BIOCHEMISTRY", "apollo247.com"
    if "URINE-RE" in code or "urine re" in lower or "urine routine" in lower:
        return _rows_from_catalog(APOLLO_URINE_ROUTINE_PARAMS), "CLINICAL PATHOLOGY", "apollo247.com"

    for keywords, mode, catalog, category, source in PROFILE_RULES:
        if mode == "all":
            hit = all(k in lower for k in keywords)
        else:
            hit = any(k in lower for k in keywords)
        if hit:
            # Prefer more specific KFT electrolytes over basic when both match
            if "electrolytes" in lower and "kidney" in lower and catalog is APOLLO_KFT_BASIC_PARAMS:
                continue
            if "lft with ggt" not in lower and catalog is APOLLO_LFT_PARAMS and "ggt" in lower:
                pass
            return _rows_from_catalog(catalog), category, source
    return None, None, None


def ensure_item_parameter_field():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_lab_parameters",
                    "label": "Lab Parameters (JSON)",
                    "fieldtype": "Long Text",
                    "insert_after": "hec_lab_faqs",
                    "description": "Apollo-style included tests / parameters",
                }
            ]
        }
    )


def ensure_diagnostic_master_disabled_field():
    """Add Disable toggle on Diagnostic Test Master (and sync DocType JSON)."""
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return False

    meta = frappe.get_meta("Diagnostic Test Master")
    if meta.has_field("disabled"):
        return True

    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Diagnostic Test Master": [
                {
                    "fieldname": "disabled",
                    "label": "Disabled",
                    "fieldtype": "Check",
                    "default": "0",
                    "insert_after": "item",
                    "in_list_view": 1,
                    "in_standard_filter": 1,
                    "description": "Hide this diagnostic master from catalogs and new lab reports",
                }
            ]
        }
    )
    frappe.clear_cache(doctype="Diagnostic Test Master")
    return True


def _ensure_pathology_department():
    if frappe.db.exists("Clinical Department", {"department_name": "Pathology"}):
        return frappe.db.get_value("Clinical Department", {"department_name": "Pathology"}, "name")
    if frappe.db.exists("DocType", "Clinical Department"):
        doc = frappe.get_doc(
            {"doctype": "Clinical Department", "department_name": "Pathology", "description": "Laboratory diagnostics"}
        )
        doc.insert(ignore_permissions=True)
        return doc.name
    return None


def upsert_diagnostic_master(item_code, item_name, param_rows, report_category, disabled=0):
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return None

    pathology = _ensure_pathology_department()
    if not pathology:
        return None

    existing = frappe.db.get_value("Diagnostic Test Master", {"item": item_code}, "name")
    if not existing:
        # Only reuse by name when that master has no item, or already points at this item
        if frappe.db.exists("Diagnostic Test Master", item_name):
            linked = frappe.db.get_value("Diagnostic Test Master", item_name, "item")
            if not linked or linked == item_code:
                existing = item_name

    if existing:
        doc = frappe.get_doc("Diagnostic Test Master", existing)
        doc.item = item_code
        doc.lis_code = doc.lis_code or item_code
        doc.report_category = report_category or doc.report_category
        if hasattr(doc, "disabled"):
            doc.disabled = cint(disabled)
        doc.set("parameters", [])
        for row in param_rows:
            doc.append("parameters", row)
        doc.save(ignore_permissions=True)
        return doc.name

    payload = {
        "doctype": "Diagnostic Test Master",
        "test_name": item_name[:140],
        "department": pathology,
        "item": item_code,
        "lis_code": item_code,
        "report_category": report_category or "CLINICAL BIOCHEMISTRY",
        "parameters": param_rows,
    }
    if frappe.get_meta("Diagnostic Test Master").has_field("disabled"):
        payload["disabled"] = cint(disabled)

    # Avoid unique name clash with slight suffix
    if frappe.db.exists("Diagnostic Test Master", payload["test_name"]):
        payload["test_name"] = f"{item_name[:120]} ({item_code})"[:140]

    doc = frappe.get_doc(payload)
    doc.insert(ignore_permissions=True)
    return doc.name


def apply_parameters_to_item(item_code, param_rows, source=""):
    names = [r["parameter_name"] for r in param_rows]
    payload = {
        "source": source,
        "count": len(names),
        "parameters": [
            {
                "parameter_code": r.get("parameter_code"),
                "parameter_name": r.get("parameter_name"),
                "unit": r.get("unit") or "",
                "normal_min": r.get("normal_min"),
                "normal_max": r.get("normal_max"),
                "is_calculated": cint(r.get("is_calculated")),
                "parameter_kind": r.get("parameter_kind")
                or ("Calculated" if cint(r.get("is_calculated")) else "Real"),
                "formula": r.get("formula") or "",
            }
            for r in param_rows
        ],
    }
    frappe.db.set_value(
        "Item",
        item_code,
        {
            "hec_lab_parameters": json.dumps(payload, ensure_ascii=False),
            "hec_lab_test_count": len(names),
        },
        update_modified=False,
    )
    return len(names)


def sync_item_parameters(item_code, item_name=None, create_master=True):
    item_name = item_name or frappe.db.get_value("Item", item_code, "item_name")
    param_rows, category, source = match_apollo_profile(item_name, item_code=item_code)
    if not param_rows:
        # Single-analyte fallback
        param_rows = [
            {
                "parameter_code": _param_code(item_name),
                "parameter_name": item_name,
                "unit": "",
                "normal_min": None,
                "normal_max": None,
                "parameter_kind": "Real",
                "is_calculated": 0,
                "formula": "",
                "method": "",
            }
        ]
        category = "CLINICAL BIOCHEMISTRY"
        source = "single-analyte"

    count = apply_parameters_to_item(item_code, param_rows, source=source)
    master_name = None
    if create_master and len(param_rows) > 1:
        master_name = upsert_diagnostic_master(item_code, item_name, param_rows, category)
    elif create_master and source != "single-analyte":
        master_name = upsert_diagnostic_master(item_code, item_name, param_rows, category)

    return {
        "item_code": item_code,
        "item_name": item_name,
        "parameter_count": count,
        "source": source,
        "master": master_name,
        "is_profile": len(param_rows) > 1,
    }


def sync_all_lab_parameters(limit=None, profiles_only=False):
    ensure_item_parameter_field()
    ensure_diagnostic_master_disabled_field()

    items = frappe.get_all(
        "Item",
        filters={"item_group": LAB_ITEM_GROUP, "disabled": 0},
        fields=["name", "item_name"],
        order_by="item_name asc",
    )
    if limit:
        items = items[: cint(limit)]

    synced = []
    profiles = 0
    singles = 0
    for row in items:
        param_rows, _, _ = match_apollo_profile(row.item_name, item_code=row.name)
        if profiles_only and not param_rows:
            continue
        result = sync_item_parameters(row.name, row.item_name, create_master=True)
        synced.append(result)
        if result["is_profile"]:
            profiles += 1
        else:
            singles += 1

    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "synced": len(synced),
        "profiles": profiles,
        "singles": singles,
        "samples": [s for s in synced if s["is_profile"]][:12],
    }


def parameters_for_item(item_code):
    raw = frappe.db.get_value("Item", item_code, "hec_lab_parameters")
    if not raw:
        return {"count": 0, "parameters": [], "source": ""}
    try:
        data = json.loads(raw)
        return {
            "count": cint(data.get("count")),
            "parameters": data.get("parameters") or [],
            "source": data.get("source") or "",
        }
    except Exception:
        return {"count": 0, "parameters": [], "source": ""}


def setup_phase56():
    ensure_item_parameter_field()
    ensure_diagnostic_master_disabled_field()
    # Prefer DocType JSON field if we can sync
    try:
        from frappe.modules.import_file import import_file_by_path
        import os

        path = os.path.join(
            frappe.get_app_path("health_ecosystem_core"),
            "health_ecosystem_core",
            "doctype",
            "diagnostic_test_master",
            "diagnostic_test_master.json",
        )
        if os.path.exists(path):
            import_file_by_path(path, force=True)
    except Exception:
        pass
    frappe.clear_cache()
    return {"ok": True, "phase": 56}
