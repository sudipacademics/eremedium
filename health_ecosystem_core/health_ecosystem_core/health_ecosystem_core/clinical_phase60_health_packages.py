"""Phase 60 — Customer health packages (1mg / Apollo247 style).

Seeds bookable Lab Test Panels that bundle existing Lab Test Items
(from the FOCO price list). Package panel_rate is a discounted sell price
vs sum of individual MRPs — same commercial pattern as 1mg/Apollo packs.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt

# ---------------------------------------------------------------------------
# Packages curated from 1mg Comprehensive Silver/Gold/Platinum and
# Apollo Full Body Essential / Diabetes / Women / Men / Fever patterns.
# Each "tests" entry is a list of match hints resolved against Item.item_name.
# ---------------------------------------------------------------------------

CUSTOMER_PACKAGES = (
    {
        "panel_name": "Essential Full Body Checkup",
        "description": (
            "Apollo-style essential full body screen — blood count, diabetes, heart (lipid), "
            "liver, kidney with electrolytes, thyroid, and urine routine. Ideal annual checkup."
        ),
        "panel_rate": 2499,
        "tests": [
            "Complete Blood Count (CBC)",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "LIVER FUNCTION TEST ( LFT )",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "T3T4TSH (THYROID PROFILE)",
            "URINE RE/ME",
        ],
        "brochure": {
            "offering_code": "PKG_ESSENTIAL_FBC",
            "title": "Essential Full Body Checkup",
            "category": "Health Package",
            "mrp_reference": 4570,
            "wholesale_reference": 2499,
            "sort_order": 10,
            "bullet_points": "\n".join(
                [
                    "CBC · FBS · HbA1c · Lipid · LFT · KFT+Electrolytes · Thyroid · Urine",
                    "Screens diabetes, heart, liver, kidney & thyroid",
                    "Home collection friendly · Same-day most analytes",
                ]
            ),
        },
    },
    {
        "panel_name": "Comprehensive Silver Full Body Checkup",
        "description": (
            "1mg Silver-style package — essential organs plus vitamins (D & B12), calcium, "
            "ESR and iron profile for nutrition & inflammation screening."
        ),
        "panel_rate": 4499,
        "tests": [
            "Complete Blood Count (CBC)",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "LIVER FUNCTION TEST ( LFT )",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "T3T4TSH (THYROID PROFILE)",
            "URINE RE/ME",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "CALCIUM (SERUM)",
            "ESR (ERYTHROCYTE SEDIMENTATION RATE)",
            "IRON PROFILE (IRONE TIBC TS% FERRITINE)",
        ],
        "brochure": {
            "offering_code": "PKG_SILVER_FBC",
            "title": "Comprehensive Silver Full Body Checkup",
            "category": "Health Package",
            "mrp_reference": 8570,
            "wholesale_reference": 4499,
            "sort_order": 20,
            "bullet_points": "\n".join(
                [
                    "Everything in Essential + Vitamin D3, B12, Calcium, ESR, Iron",
                    "Bone health · Vitamin deficiency · Inflammation markers",
                    "Best seller style package for 25–50 yr adults",
                ]
            ),
        },
    },
    {
        "panel_name": "Comprehensive Gold Full Body Checkup",
        "description": (
            "1mg Gold-style checkup — Silver coverage plus CRP, ferritin, complete haemogram "
            "with ESR, and free thyroid (FT3/FT4/TSH) for deeper metabolic insight."
        ),
        "panel_rate": 5999,
        "tests": [
            "COMPLETE HAEMOGRAM WITH ESR (CHG)",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "LFT WITH GGT",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "FREE THYROID FUNCTION TEST (FT3 FT4 TSH)",
            "URINE RE/ME",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "CALCIUM (SERUM)",
            "CRP (QUANTITATIVE)",
            "FERRITIN ASSAY (SERUM)",
            "IRON STUDIES II COMPREHENSIVEWITH FERRITIN",
            "BLOOD GROUPING (ABO & Rh)",
        ],
        "brochure": {
            "offering_code": "PKG_GOLD_FBC",
            "title": "Comprehensive Gold Full Body Checkup",
            "category": "Health Package",
            "mrp_reference": 11200,
            "wholesale_reference": 5999,
            "sort_order": 30,
            "bullet_points": "\n".join(
                [
                    "CHG+ESR · Free Thyroid · LFT+GGT · CRP · Ferritin · Iron Studies",
                    "Vitamins D & B12 · Blood group · Full metabolic screen",
                    "Recommended for executives & annual deep checkup",
                ]
            ),
        },
    },
    {
        "panel_name": "Comprehensive Platinum Full Body Checkup",
        "description": (
            "1mg Platinum-style premium package — Gold base plus cardiac (hs-CRP, Troponin I), "
            "digestive enzymes, and urine microalbumin for advanced risk screening."
        ),
        "panel_rate": 7999,
        "tests": [
            "COMPLETE HAEMOGRAM WITH ESR (CHG)",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "LFT WITH GGT",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "FREE THYROID FUNCTION TEST (FT3 FT4 TSH)",
            "URINE RE/ME",
            "URINE FOR MICROALBUMIN CREATININE RATIO(SPOT)",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "CALCIUM (SERUM)",
            "CRP (QUANTITATIVE)",
            "FERRITIN ASSAY (SERUM)",
            "IRON STUDIES II COMPREHENSIVEWITH FERRITIN",
            "BLOOD GROUPING (ABO & Rh)",
            "TROPONIN I",
            "AMYLASE",
            "LIPASE (SERUM)",
        ],
        "brochure": {
            "offering_code": "PKG_PLATINUM_FBC",
            "title": "Comprehensive Platinum Full Body Checkup",
            "category": "Health Package",
            "mrp_reference": 14500,
            "wholesale_reference": 7999,
            "sort_order": 40,
            "bullet_points": "\n".join(
                [
                    "Full Gold coverage + Troponin I · Amylase · Lipase · Microalbumin/Creatinine",
                    "Premium organ + cardiac + enzyme screen",
                ]
            ),
        },
    },
    {
        "panel_name": "Diabetes Care Package",
        "description": (
            "Apollo / 1mg diabetes panel — fasting & PP sugar, HbA1c, lipid, kidney basics, "
            "and urine microalbumin for complication screening."
        ),
        "panel_rate": 1499,
        "tests": [
            "Glucose Fasting (FBS)",
            "GLUCOSE(FASTING & POSTPARANDIAL)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "URINE FOR MICROALBUMIN CREATININE RATIO(SPOT)",
        ],
        "brochure": {
            "offering_code": "PKG_DIABETES_CARE",
            "title": "Diabetes Care Package",
            "category": "Health Package",
            "mrp_reference": 3310,
            "wholesale_reference": 1499,
            "sort_order": 50,
            "bullet_points": "\n".join(
                [
                    "FBS · F&PP · HbA1c · Lipid · KFT+Electrolytes · Microalbumin/Creatinine",
                    "Monitor sugar control & diabetic kidney risk",
                ]
            ),
        },
    },
    {
        "panel_name": "Heart Health Package",
        "description": (
            "Cardiac risk package — lipid profile, diabetes markers, hs-CRP and Troponin I "
            "aligned with Apollo heart screening bundles."
        ),
        "panel_rate": 1999,
        "tests": [
            "LIPID PROFILE Serum",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "hs CRP",
            "TROPONIN I",
            "UREA & CREATININE",
        ],
        "brochure": {
            "offering_code": "PKG_HEART",
            "title": "Heart Health Package",
            "category": "Health Package",
            "mrp_reference": 3670,
            "wholesale_reference": 1999,
            "sort_order": 55,
            "bullet_points": "\n".join(
                [
                    "Lipid · FBS · HbA1c · hs-CRP · Troponin I · Urea & Creatinine",
                    "Heart & metabolic risk screening",
                ]
            ),
        },
    },
    {
        "panel_name": "Thyroid Care Package",
        "description": "Thyroid assessment — total and free thyroid profiles with CBC for anaemia overlap.",
        "panel_rate": 1299,
        "tests": [
            "T3T4TSH (THYROID PROFILE)",
            "FREE THYROID FUNCTION TEST (FT3 FT4 TSH)",
            "Complete Blood Count (CBC)",
        ],
        "brochure": {
            "offering_code": "PKG_THYROID",
            "title": "Thyroid Care Package",
            "category": "Health Package",
            "mrp_reference": 1950,
            "wholesale_reference": 1299,
            "sort_order": 60,
            "bullet_points": "T3T4TSH · Free T3/T4/TSH · CBC",
        },
    },
    {
        "panel_name": "Women Wellness Package",
        "description": (
            "1mg Women Wellness style — CBC, thyroid, diabetes, vitamins, iron, "
            "CA-125 ovarian marker and urine routine."
        ),
        "panel_rate": 3999,
        "tests": [
            "Complete Blood Count (CBC)",
            "T3T4TSH (THYROID PROFILE)",
            "Glucose Fasting (FBS)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "LIPID PROFILE Serum",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "IRON PROFILE (IRONE TIBC TS% FERRITINE)",
            "CA 125 OVARIAN CANCER MARKER",
            "URINE RE/ME",
        ],
        "brochure": {
            "offering_code": "PKG_WOMEN",
            "title": "Women Wellness Package",
            "category": "Health Package",
            "mrp_reference": 7220,
            "wholesale_reference": 3999,
            "sort_order": 70,
            "bullet_points": "\n".join(
                [
                    "CBC · Thyroid · FBS · HbA1c · Lipid · Vit D/B12 · Iron · CA-125 · Urine",
                    "Designed for women 25+ annual wellness",
                ]
            ),
        },
    },
    {
        "panel_name": "Men Health Package",
        "description": (
            "1mg Men Health style — full metabolic screen plus PSA (prostate) and vitamins."
        ),
        "panel_rate": 4499,
        "tests": [
            "Complete Blood Count (CBC)",
            "LIPID PROFILE Serum",
            "LIVER FUNCTION TEST ( LFT )",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "T3T4TSH (THYROID PROFILE)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "Glucose Fasting (FBS)",
            "PSA (PROSTATIC SPECIFIC ANTIGEN TEST) TOTAL",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "URINE RE/ME",
        ],
        "brochure": {
            "offering_code": "PKG_MEN",
            "title": "Men Health Package",
            "category": "Health Package",
            "mrp_reference": 8470,
            "wholesale_reference": 4499,
            "sort_order": 75,
            "bullet_points": "\n".join(
                [
                    "CBC · Lipid · LFT · KFT+Electrolytes · Thyroid · HbA1c · PSA · Vitamins",
                    "Recommended for men 35+",
                ]
            ),
        },
    },
    {
        "panel_name": "Senior Citizen Health Package",
        "description": (
            "Senior screening — haemogram with ESR, organs, diabetes, vitamins, uric acid "
            "and inflammation (CRP) for adults 60+."
        ),
        "panel_rate": 3999,
        "tests": [
            "COMPLETE HAEMOGRAM WITH ESR (CHG)",
            "LIPID PROFILE Serum",
            "LFT WITH GGT",
            "KIDNEY FUNCTION TEST (With Electrolytes",
            "T3T4TSH (THYROID PROFILE)",
            "GLYCOSYLATED HAEMOGLOBIN (HbA1C)",
            "Glucose Fasting (FBS)",
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "URIC ACID",
            "CRP (QUANTITATIVE)",
            "URINE RE/ME",
        ],
        "brochure": {
            "offering_code": "PKG_SENIOR",
            "title": "Senior Citizen Health Package",
            "category": "Health Package",
            "mrp_reference": 8120,
            "wholesale_reference": 3999,
            "sort_order": 80,
            "bullet_points": "\n".join(
                [
                    "CHG+ESR · Lipid · LFT+GGT · KFT · Thyroid · Diabetes · Vitamins · CRP",
                    "Tailored for adults 60+",
                ]
            ),
        },
    },
    {
        "panel_name": "Fever Panel",
        "description": (
            "Acute fever workup — CBC, ESR, CRP, Dengue profile, Malaria dual antigen, "
            "Widal and Typhoid IgG/IgM (Apollo/1mg fever packs)."
        ),
        "panel_rate": 2499,
        "tests": [
            "Complete Blood Count (CBC)",
            "ESR (ERYTHROCYTE SEDIMENTATION RATE)",
            "CRP (QUANTITATIVE)",
            "DENGUE PROFILE NS1 IgG & IgM ELISA",
            "MALARIA DUAL ANTIGEN BLOOD",
            "WIDAL TEST",
            "TYPHOID IgG/IgM RAPID TEST",
        ],
        "brochure": {
            "offering_code": "PKG_FEVER",
            "title": "Fever Panel",
            "category": "Health Package",
            "mrp_reference": 5050,
            "wholesale_reference": 2499,
            "sort_order": 90,
            "bullet_points": "CBC · ESR · CRP · Dengue · Malaria · Widal · Typhoid",
        },
    },
    {
        "panel_name": "Anemia & Iron Package",
        "description": "Anaemia workup — CBC, comprehensive iron studies, ferritin and Vitamin B12.",
        "panel_rate": 1499,
        "tests": [
            "Complete Blood Count (CBC)",
            "IRON STUDIES II COMPREHENSIVEWITH FERRITIN",
            "FERRITIN ASSAY (SERUM)",
            "VITAMIN B12",
        ],
        "brochure": {
            "offering_code": "PKG_ANEMIA",
            "title": "Anemia & Iron Package",
            "category": "Health Package",
            "mrp_reference": 3500,
            "wholesale_reference": 1499,
            "sort_order": 95,
            "bullet_points": "CBC · Iron Studies II · Ferritin · Vitamin B12",
        },
    },
    {
        "panel_name": "Vitamin Check Package",
        "description": "Apollo Vitamin Check style — Vitamin D3, B12 and serum calcium.",
        "panel_rate": 2499,
        "tests": [
            "VITAMIN D3 (25 OH)",
            "VITAMIN B12",
            "CALCIUM (SERUM)",
        ],
        "brochure": {
            "offering_code": "PKG_VITAMIN",
            "title": "Vitamin Check Package",
            "category": "Health Package",
            "mrp_reference": 3500,
            "wholesale_reference": 2499,
            "sort_order": 100,
            "bullet_points": "Vitamin D3 (25-OH) · Vitamin B12 · Calcium",
        },
    },
    {
        "panel_name": "Basic Health Screening",
        "description": (
            "Entry-level 1mg Good Health style screen — CBC, fasting sugar, lipid and thyroid."
        ),
        "panel_rate": 999,
        "tests": [
            "Complete Blood Count (CBC)",
            "Glucose Fasting (FBS)",
            "LIPID PROFILE Serum",
            "T3T4TSH (THYROID PROFILE)",
        ],
        "brochure": {
            "offering_code": "PKG_BASIC_SCREEN",
            "title": "Basic Health Screening",
            "category": "Health Package",
            "mrp_reference": 1970,
            "wholesale_reference": 999,
            "sort_order": 5,
            "bullet_points": "CBC · FBS · Lipid · Thyroid — starter annual screen",
        },
    },
)

# Deactivate auto-seeded junk panels from phase6 (random first N items)
DEPRECATED_PANELS = (
    "Basic Health Panel",
    "Comprehensive Panel",
)


def _normalize_label(text: str) -> str:
    import re

    text = (text or "").upper()
    text = text.replace("&", " AND ")
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return " ".join(text.split())


def _item_search_cache():
    if getattr(frappe.local, "_hec_lab_item_cache", None) is not None:
        return frappe.local._hec_lab_item_cache
    rows = frappe.db.sql(
        """
        SELECT name, item_name, item_code
        FROM `tabItem`
        WHERE disabled = 0
        """,
        as_dict=True,
    )
    cache = []
    for row in rows:
        labels = [
            _normalize_label(row.name),
            _normalize_label(row.item_name),
            _normalize_label(row.item_code),
        ]
        cache.append({"name": row.name, "item_name": row.item_name, "labels": [x for x in labels if x]})
    frappe.local._hec_lab_item_cache = cache
    return cache


# Prefer these Item codes / code fragments when hints match (Phase 55 shortened some names)
CODE_HINTS = (
    (("HBA1C", "GLYCOSYLATED", "GLYCATED HAEMOGLOBIN", "EAG"), ("HBA1C", "GLYCOSYL")),
    (("LIPID PROFILE",), ("LIPID",)),
    (("URINE RE", "URINE ROUTINE", "URINE ME"), ("URINE-RE", "URINE_RE", "URINE RE")),
    (("VITAMIN B12", "VIT B12"), ("B12", "VITAMIN-B12", "VITAMIN B12")),
    (("LFT WITH GGT", "LIVER FUNCTION TEST WITH GGT"), ("LFT-WITH", "LFT WITH GGT", "LFTGGT")),
    (("HS CRP", "HSCRP", "HIGH SENSITIVITY CRP"), ("HS-CRP", "HSCRP", "HS CRP")),
    (("IRON PROFILE", "IRONE TIBC"), ("IRON-PROFILE", "IRON PROFILE", "IRONPROFILE")),
    (("IRON STUDIES",), ("IRON-STUDIES", "IRON STUDIES")),
    (("KIDNEY FUNCTION TEST BASIC", "KFT BASIC"), ("KIDNEY-FUNCTION-TEST-BASIC", "KFT-BASIC", "KIDNEY FUNCTION TEST BASIC")),
    (("URIC ACID",), ("URIC-ACID", "URIC ACID")),
    (("UREA CREATININE", "UREA AND CREATININE"), ("UREA-&-CREATININE", "UREA AND CREATININE", "UREA:CREATININE")),
    (("CA 125", "CA125"), ("CA-125", "CA125", "CA 125")),
    (("DENGUE PROFILE",), ("DENGUE-PROFILE", "DENGUE PROFILE")),
    (("MALARIA DUAL",), ("MALARIA-DUAL", "MALARIA DUAL")),
    (("WIDAL",), ("WIDAL",)),
    (("TYPHOID",), ("TYPHOID",)),
    (("MICROALBUMIN CREATININE RATIO", "MICROALBUMIN"), ("MICROALBUMIN",)),
    (("ESR ERYTHROCYTE", "ERYTHROCYTE SEDIMENTATION"), ("ESR",)),
    (("COMPLETE BLOOD COUNT", " CBC"), ("CBC", "COMPLETE-BLOOD")),
    (("COMPLETE HAEMOGRAM", "CHG"), ("HAEMOGRAM", "CHG", "HEMOGRAM")),
)


def _prefer_item_by_fragments(fragments, require_all=None, exclude=None):
    require_all = [x.upper() for x in (require_all or [])]
    exclude = [x.upper() for x in (exclude or [])]
    best = None
    best_len = 10**9
    for row in _item_search_cache():
        blob = f"{row['name']} {row['item_name']}".upper()
        if require_all and not all(r in blob for r in require_all):
            continue
        if exclude and any(e in blob for e in exclude):
            continue
        if any(f.upper() in blob for f in fragments):
            if len(blob) < best_len:
                best_len = len(blob)
                best = row["name"]
    return best


EXPLICIT_RESOLVERS = {
    "GLYCOSYLATED HAEMOGLOBIN (HBA1C)": lambda: (
        _prefer_item_by_fragments(["HBA1C", "GLYCOSYLATED", "GLYCATED HAEMOGLOBIN"], exclude=["24 HR"])
        or _prefer_item_by_fragments(["HBA1C"])
        or next(
            (
                r.name
                for r in frappe.db.sql(
                    "SELECT name FROM `tabItem` WHERE disabled=0 AND hec_lab_parameters LIKE %s LIMIT 1",
                    ("%HbA1c%",),
                    as_dict=True,
                )
            ),
            None,
        )
    ),
    "LFT WITH GGT": lambda: _prefer_item_by_fragments(["LFT WITH GGT", "LFT-WITH-GGT", "WITH GGT"]),
    "HS CRP": lambda: _prefer_item_by_fragments(["HS CRP", "HS-CRP", "HSCRP", "HIGH SENSITIVITY"]),
    "UREA & CREATININE": lambda: _prefer_item_by_fragments(
        ["UREA & CREATININE", "UREA AND CREATININE", "UREA:CREATININE"],
        exclude=["URINE", "24"],
    ),
    "KIDNEY FUNCTION TEST BASIC (UR CR URIC ACID TP ALB BUN)": lambda: _prefer_item_by_fragments(
        ["KIDNEY FUNCTION TEST BASIC", "KFT BASIC"],
        require_all=["KIDNEY", "BASIC"],
    ),
    "URIC ACID": lambda: _prefer_item_by_fragments(
        ["URIC ACID"], exclude=["URINE", "KIDNEY", "24"]
    ),
    "URINE FOR MICROALBUMIN CREATININE RATIO(SPOT)": lambda: _prefer_item_by_fragments(
        ["MICROALBUMIN CREATININE RATIO", "MICROALBUMIN : CREATININE"],
        require_all=["MICROALBUMIN"],
        exclude=["24 HRS", "24HR", "A/G", "ALBUMIN/GLOBULIN"],
    ),
    "IRON PROFILE (IRONE TIBC TS% FERRITINE)": lambda: _prefer_item_by_fragments(
        ["IRON PROFILE", "IRONE TIBC"],
        require_all=["IRON"],
        exclude=["STUDIES II"],
    ),
}


def repair_truncated_item_names():
    """Fix known Phase-55 truncations that break package labels."""
    fixes = 0
    hba1c = _prefer_item_by_fragments(["HBA1C", "GLYCOSYLATED HAEMOGLOBIN", "GLYCATED HAEMOGLOBIN"])
    if not hba1c:
        # Parameter JSON from Phase 56 often still has HbA1c / EAG even if title was truncated to HB
        for row in frappe.db.sql(
            """
            SELECT name, item_name, hec_lab_parameters
            FROM `tabItem`
            WHERE disabled = 0
              AND (
                hec_lab_parameters LIKE %s
                OR hec_lab_parameters LIKE %s
                OR hec_lab_parameters LIKE %s
              )
            LIMIT 5
            """,
            ("%HbA1c%", "%EAG%", "%Glycated%"),
            as_dict=True,
        ):
            hba1c = row.name
            break
    if not hba1c:
        for row in _item_search_cache():
            blob = f"{row['name']} {row['item_name']}".upper()
            if "HBA1C" in blob or "GLYCOSYL" in blob or "GLYCATED" in blob:
                hba1c = row["name"]
                break
    if hba1c:
        name = frappe.db.get_value("Item", hba1c, "item_name") or ""
        if name.strip().upper() in ("HB", "H B") or len(name.strip()) <= 3 or "hba1c" not in name.lower():
            if name.strip().upper() in ("HB", "H B") or "glycosyl" in (frappe.db.get_value("Item", hba1c, "hec_lab_parameters") or "").lower() or "hba1c" in (frappe.db.get_value("Item", hba1c, "hec_lab_parameters") or "").lower():
                frappe.db.set_value(
                    "Item", hba1c, "item_name", "HbA1c, Glycated Haemoglobin", update_modified=False
                )
                fixes += 1
    uric = _prefer_item_by_fragments(["URIC ACID"], exclude=["URINE", "KIDNEY"])
    if not uric:
        for row in _item_search_cache():
            if _normalize_label(row["item_name"]) == "URIC":
                uric = row["name"]
                break
    if uric:
        name = frappe.db.get_value("Item", uric, "item_name") or ""
        if name.strip().upper() in ("URIC", "UA"):
            frappe.db.set_value("Item", uric, "item_name", "Uric Acid", update_modified=False)
            fixes += 1
    return fixes


def _score_code_hint(hint_norm: str, item_name: str, item_code: str) -> int:
    code_u = (item_code or "").upper().replace("_", "-")
    name_u = (item_name or "").upper()
    for needles, code_bits in CODE_HINTS:
        if not any(n in hint_norm for n in needles):
            continue
        for bit in code_bits:
            bit_u = bit.upper()
            if bit_u in code_u or bit_u in name_u:
                if "HBA1C" in needles[0] or "HBA1C" in bit_u:
                    if "HBA1C" in code_u or "GLYCOSYL" in code_u or "GLYCATED" in name_u:
                        return 2000
                    if name_u.strip() in ("HB", "H B", "HAEMOGLOBIN"):
                        return -1000
                if bit_u in ("ESR",) and "HAEMOGRAM" in name_u:
                    continue
                if "MICROALBUMIN" in needles[0] and "MICROALBUMIN" not in code_u and "MICROALBUMIN" not in name_u:
                    continue
                if "UREA" in needles[0] and ("URINE" in name_u or "24" in name_u):
                    continue
                return 1500
    return 0


def resolve_lab_item(hint: str):
    """Resolve a FOCO / Apollo-style test label to an Item code."""
    hint = (hint or "").strip()
    if not hint:
        return None

    hint_key = hint.upper().strip()
    for key, fn in EXPLICIT_RESOLVERS.items():
        if (
            key in hint_key
            or hint_key in key
            or _normalize_label(key) == _normalize_label(hint)
            or _normalize_label(key) in _normalize_label(hint)
            or _normalize_label(hint) in _normalize_label(key)
        ):
            code = fn()
            if code:
                return code

    code = frappe.db.get_value("Item", {"item_name": hint, "disabled": 0}, "name")
    if code:
        return code
    if frappe.db.exists("Item", hint) and not cint(frappe.db.get_value("Item", hint, "disabled")):
        return hint

    needle = _normalize_label(hint)
    if not needle:
        return None

    code_hit = None
    code_hit_score = 0
    for row in _item_search_cache():
        boost = _score_code_hint(needle, row["item_name"], row["name"])
        if boost > code_hit_score:
            code_hit_score = boost
            code_hit = row["name"]
    if code_hit and code_hit_score >= 1500:
        return code_hit

    aliases = {
        "GLYCOSYLATED HAEMOGLOBIN HBA1C": ["HBA1C GLYCATED HAEMOGLOBIN", "HBA1C", "GLYCOSYLATED HAEMOGLOBIN"],
        "LIPID PROFILE SERUM": ["LIPID PROFILE"],
        "URINE RE ME": ["URINE RE ME", "URINE RE", "URINE ROUTINE"],
        "VITAMIN B12": ["VITAMIN B12"],
        "LFT WITH GGT": ["LFT WITH GGT"],
        "HS CRP": ["HS CRP", "HIGH SENSITIVITY CRP"],
        "UREA CREATININE": ["UREA AND CREATININE", "UREA CREATININE"],
        "KIDNEY FUNCTION TEST BASIC": ["KIDNEY FUNCTION TEST BASIC"],
        "CA 125 OVARIAN CANCER MARKER": ["CA 125", "CA125"],
        "DENGUE PROFILE NS1 IGG IGM ELISA": ["DENGUE PROFILE"],
        "MALARIA DUAL ANTIGEN BLOOD": ["MALARIA DUAL"],
        "WIDAL TEST": ["WIDAL"],
        "TYPHOID IGG IGM RAPID TEST": ["TYPHOID"],
        "URIC ACID": ["URIC ACID"],
        "GLUCOSE FASTING POSTPARANDIAL": ["GLUCOSE FASTING POSTPARANDIAL", "FASTING AND POSTPARANDIAL"],
        "URINE FOR MICROALBUMIN CREATININE RATIO SPOT": ["MICROALBUMIN CREATININE RATIO SPOT"],
        "IRON PROFILE IRONE TIBC TS FERRITINE": ["IRON PROFILE"],
    }

    needles = [needle]
    for key, alts in aliases.items():
        if key in needle or needle in key or any(a in needle for a in alts):
            needles.append(key)
            needles.extend(_normalize_label(a) for a in alts)

    best = None
    best_score = -1
    for row in _item_search_cache():
        name = row["name"]
        item_name = row["item_name"] or ""
        short = _normalize_label(item_name)
        if short in ("HB", "IRON", "URIC", "LFT", "KFT", "WIDAL") and len(needle) > 8:
            code_boost = _score_code_hint(needle, item_name, name)
            if code_boost < 1500:
                continue

        code_boost = _score_code_hint(needle, item_name, name)
        for label in row["labels"]:
            for n in needles:
                if not n:
                    continue
                score = code_boost
                if label == n:
                    score = max(score, 1000)
                elif n in label:
                    score = max(score, 700 - abs(len(label) - len(n)))
                elif label in n and len(label) >= 10:
                    score = max(score, 550 - abs(len(label) - len(n)))
                else:
                    nt = set(n.split())
                    lt = set(label.split())
                    common = {"TEST", "SERUM", "ASSAY", "PROFILE", "FUNCTION", "WITH"}
                    nt2 = nt - common
                    lt2 = lt - common
                    if len(nt2) >= 2 and nt2.issubset(lt2):
                        score = max(score, 480 + len(nt2) * 15)
                    elif len(nt2 & lt2) >= 2:
                        score = max(score, 320 + len(nt2 & lt2) * 25)
                if score > best_score:
                    best_score = score
                    best = name

    return best if best_score >= 320 else None


def debug_resolve_hints(hints=None):
    """bench execute ...debug_resolve_hints"""
    if not hints:
        hints = []
        for spec in CUSTOMER_PACKAGES:
            hints.extend(spec["tests"])
    out = []
    for hint in hints:
        code = resolve_lab_item(hint)
        out.append(
            {
                "hint": hint,
                "item": code,
                "item_name": frappe.db.get_value("Item", code, "item_name") if code else None,
            }
        )
    return out


def _build_test_rows(hints):
    rows = []
    seen = set()
    missing = []
    for hint in hints:
        code = resolve_lab_item(hint)
        if not code:
            missing.append(hint)
            continue
        if code in seen:
            continue
        seen.add(code)
        rows.append(
            {
                "item": code,
                "item_name": frappe.db.get_value("Item", code, "item_name") or hint,
            }
        )
    return rows, missing


def upsert_customer_packages():
    if not frappe.db.exists("DocType", "Lab Test Panel"):
        return {"ok": False, "reason": "Lab Test Panel missing"}

    created = []
    updated = []
    skipped = []
    missing_map = {}

    for spec in CUSTOMER_PACKAGES:
        name = spec["panel_name"]
        test_rows, missing = _build_test_rows(spec["tests"])
        if missing:
            missing_map[name] = missing
        if len(test_rows) < 2:
            skipped.append({"panel": name, "reason": "fewer than 2 resolved tests", "missing": missing})
            continue

        payload = {
            "description": spec["description"],
            "panel_rate": flt(spec["panel_rate"]),
            "is_active": 1,
            "show_on_mobile": 1,
        }

        if frappe.db.exists("Lab Test Panel", name):
            doc = frappe.get_doc("Lab Test Panel", name)
            for key, value in payload.items():
                setattr(doc, key, value)
            doc.set("tests", [])
            for row in test_rows:
                doc.append("tests", row)
            doc.save(ignore_permissions=True)
            updated.append(name)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "Lab Test Panel",
                    "panel_name": name,
                    **payload,
                    "tests": test_rows,
                }
            )
            doc.insert(ignore_permissions=True)
            created.append(name)

    for deprecated in DEPRECATED_PANELS:
        if frappe.db.exists("Lab Test Panel", deprecated):
            frappe.db.set_value("Lab Test Panel", deprecated, "is_active", 0, update_modified=False)
            frappe.db.set_value("Lab Test Panel", deprecated, "show_on_mobile", 0, update_modified=False)

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "missing": missing_map,
        "active_count": len(created) + len(updated),
    }


def upsert_brochure_offerings():
    if not frappe.db.exists("DocType", "Sales Catalog Offering"):
        return []
    codes = []
    for spec in CUSTOMER_PACKAGES:
        bro = spec.get("brochure") or {}
        if not bro.get("offering_code"):
            continue
        data = {
            "title": bro.get("title") or spec["panel_name"],
            "category": bro.get("category") or "Health Package",
            "description": spec["description"],
            "bullet_points": bro.get("bullet_points") or "",
            "mrp_reference": flt(bro.get("mrp_reference")),
            "wholesale_reference": flt(bro.get("wholesale_reference") or spec["panel_rate"]),
            "sort_order": cint(bro.get("sort_order") or 0),
            "is_active": 1,
        }
        code = bro["offering_code"]
        if frappe.db.exists("Sales Catalog Offering", code):
            doc = frappe.get_doc("Sales Catalog Offering", code)
            for key, value in data.items():
                if hasattr(doc, key):
                    setattr(doc, key, value)
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc({"doctype": "Sales Catalog Offering", "offering_code": code, **data})
            doc.insert(ignore_permissions=True)
        codes.append(code)
    return codes


def list_customer_packages_summary():
    """Return seeded packages with resolved child tests for verification."""
    out = []
    for spec in CUSTOMER_PACKAGES:
        name = spec["panel_name"]
        if not frappe.db.exists("Lab Test Panel", name):
            continue
        doc = frappe.get_doc("Lab Test Panel", name)
        out.append(
            {
                "panel_name": doc.panel_name,
                "panel_rate": flt(doc.panel_rate),
                "is_active": cint(doc.is_active),
                "test_count": len(doc.tests or []),
                "tests": [r.item_name or r.item for r in (doc.tests or [])],
            }
        )
    return out


def setup_phase60():
    frappe.local._hec_lab_item_cache = None
    repaired = repair_truncated_item_names()
    frappe.local._hec_lab_item_cache = None
    panels = upsert_customer_packages()
    brochures = upsert_brochure_offerings()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 60,
        "repaired_names": repaired,
        "panels": panels,
        "brochures": brochures,
        "summary": list_customer_packages_summary(),
    }
