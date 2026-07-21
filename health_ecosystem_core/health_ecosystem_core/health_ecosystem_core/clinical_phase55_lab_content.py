"""Phase 55 — Lab test display names, Apollo-style content, and FAQs."""

from __future__ import annotations

import json
import re

import frappe
from frappe import _
from frappe.utils import cint

from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import (
    DEFAULT_PREPARATION,
    DEFAULT_SAMPLE,
    LAB_ITEM_GROUP,
    _infer_category,
    _normalize_sample_type,
)

SMALL_WORDS = frozenset(
    "a an and as at by for from in into near of on or per the to via vs with without".split()
)

CANONICAL_ABBREV = {
    "HBA1C": "HbA1c",
    "HB1AC": "HbA1c",
    "FT3": "FT3",
    "FT4": "FT4",
    "TSH": "TSH",
    "T3": "T3",
    "T4": "T4",
    "GGT": "GGT",
    "LDH": "LDH",
    "SGOT": "SGOT",
    "SGPT": "SGPT",
    "AST": "AST",
    "ALT": "ALT",
    "BUN": "BUN",
    "EGFR": "eGFR",
    "GFR": "GFR",
    "PSA": "PSA",
    "AFP": "AFP",
    "CEA": "CEA",
    "CA125": "CA-125",
    "CA199": "CA-19-9",
    "CA153": "CA-15-3",
    "HIV": "HIV",
    "HBV": "HBV",
    "HCV": "HCV",
    "HSV": "HSV",
    "CMV": "CMV",
    "EBV": "EBV",
    "VDRL": "VDRL",
    "ANA": "ANA",
    "APTT": "APTT",
    "PT": "PT",
    "INR": "INR",
    "ESR": "ESR",
    "PCV": "PCV",
    "MCV": "MCV",
    "MCH": "MCH",
    "MCHC": "MCHC",
    "RDW": "RDW",
    "CRP": "CRP",
    "RF": "RF",
    "IgG": "IgG",
    "IgM": "IgM",
    "IgA": "IgA",
    "IgE": "IgE",
    "DNA": "DNA",
    "RNA": "RNA",
    "PCR": "PCR",
    "RTPCR": "RT-PCR",
    "ELISA": "ELISA",
    "CLIA": "CLIA",
    "IFA": "IFA",
    "IHC": "IHC",
    "FNAC": "FNAC",
    "PAP": "PAP",
    "LBC": "LBC",
    "CSF": "CSF",
    "EDTA": "EDTA",
    "A/G": "A/G",
    "OHP": "OHP",
    "ACTH": "ACTH",
    "FSH": "FSH",
    "LH": "LH",
    "PRL": "PRL",
    "AMH": "AMH",
    "DHEAS": "DHEAS",
    "EPO": "EPO",
    "PTH": "PTH",
    "BNP": "BNP",
    "NTBNP": "NT-proBNP",
    "ACE": "ACE",
    "ADA": "ADA",
    "AFB": "AFB",
    "G6PD": "G6PD",
    "HLA": "HLA",
    "TORCH": "TORCH",
    "TPHA": "TPHA",
    "VMA": "VMA",
    "VWF": "vWF",
}

EXPANSION_BY_ABBR = {
    "CBC": "Complete Blood Count",
    "LFT": "Liver Function Test",
    "KFT": "Kidney Function Test",
    "RFT": "Renal Function Test",
    "TSH": "Thyroid Stimulating Hormone",
    "T3": "Triiodothyronine",
    "T4": "Thyroxine",
    "FT3": "Free Triiodothyronine",
    "FT4": "Free Thyroxine",
    "APTT": "Activated Partial Thromboplastin Time",
    "PT": "Prothrombin Time",
    "INR": "International Normalised Ratio",
    "ESR": "Erythrocyte Sedimentation Rate",
    "CRP": "C-Reactive Protein",
    "RF": "Rheumatoid Factor",
    "PSA": "Prostate Specific Antigen",
    "AFP": "Alpha Fetoprotein",
    "CEA": "Carcinoembryonic Antigen",
    "HBA1C": "Glycated Hemoglobin",
    "HB1AC": "Glycated Hemoglobin",
    "LDL": "Low Density Lipoprotein",
    "HDL": "High Density Lipoprotein",
    "VLDL": "Very Low Density Lipoprotein",
    "BUN": "Blood Urea Nitrogen",
    "GFR": "Glomerular Filtration Rate",
    "EGFR": "Estimated Glomerular Filtration Rate",
    "ANA": "Antinuclear Antibody",
    "VDRL": "Venereal Disease Research Laboratory",
    "HIV": "Human Immunodeficiency Virus",
    "HBV": "Hepatitis B Virus",
    "HCV": "Hepatitis C Virus",
    "TORCH": "TORCH Panel",
    "PAP": "Papanicolaou Smear",
    "LBC": "Liquid Based Cytology",
    "FNAC": "Fine Needle Aspiration Cytology",
    "OHP": "17 Alpha Hydroxy Progesterone",
    "ACTH": "Adrenocorticotropic Hormone",
    "FSH": "Follicle Stimulating Hormone",
    "LH": "Luteinizing Hormone",
    "PRL": "Prolactin",
    "AMH": "Anti Mullerian Hormone",
    "DHEAS": "Dehydroepiandrosterone Sulphate",
    "EPO": "Erythropoietin",
    "PTH": "Parathyroid Hormone",
    "G6PD": "Glucose-6-Phosphate Dehydrogenase",
    "ACHR": "ACHR",
    "ACE": "Angiotensin Converting Enzyme",
    "ADA": "Adenosine Deaminase",
    "AFB": "Acid Fast Bacilli",
    "A/G": "Albumin/Globulin Ratio",
    "TRAB": "TSH Receptor Antibody",
    "TPO": "Thyroid Peroxidase Antibody",
    "TG": "Thyroglobulin",
    "BNP": "B-Type Natriuretic Peptide",
    "NTBNP": "N-Terminal pro-BNP",
    "VMA": "Vanillylmandelic Acid",
    "VWF": "Von Willebrand Factor",
    "GTT": "Glucose Tolerance Test",
    "OGTT": "Oral Glucose Tolerance Test",
    "PCV": "Packed Cell Volume",
    "TLC": "Total Leucocyte Count",
    "WBC": "White Blood Cell Count",
    "RBC": "Red Blood Cell Count",
    "MP": "Malaria Parasite",
    "IHC": "Immunohistochemistry",
    "PCR": "Polymerase Chain Reaction",
    "ELISA": "Enzyme Linked Immunosorbent Assay",
    "CLIA": "Chemiluminescence Immunoassay",
    "IFA": "Indirect Immunofluorescence Assay",
}

SYNONYM_EXPANSIONS = {
    "GLYCOSYLATED HAEMOGLOBIN": ("Glycated Hemoglobin", "HbA1c"),
    "GLYCOSYLATED HEMOGLOBIN": ("Glycated Hemoglobin", "HbA1c"),
    "GLYCOSYLATED-HAEMOGLOBIN": ("Glycated Hemoglobin", "HbA1c"),
    "A/G RATIO": ("Albumin/Globulin Ratio", "A/G"),
    "AG RATIO": ("Albumin/Globulin Ratio", "A/G"),
    "A G RATIO": ("Albumin/Globulin Ratio", "A/G"),
    "FT4TSH": ("Free T4 and TSH", "FT4/TSH"),
    "T3T4TSH": ("Thyroid Profile", "T3/T4/TSH"),
    "ACETYL CHOLINE RECEPTOR ANTIBODIES SERUM ACHR": ("Acetylcholine Receptor Antibody", "ACHR"),
    "LIVER FUNCTION TEST": ("Liver Function Test", "LFT"),
    "KIDNEY FUNCTION TEST": ("Kidney Function Test", "KFT"),
    "LIPID PROFILE": ("Lipid Profile", ""),
    "COMPLETE HAEMOGRAM": ("Complete Haemogram", "CHG"),
    "COMPLETE BLOOD COUNT": ("Complete Blood Count", "CBC"),
    "SEMEN ANALYSIS": ("Semen Analysis", ""),
    "PREGNANCY TEST": ("Pregnancy Test", "UPT"),
    "URINE ROUTINE": ("Urine Routine Examination", "UR/E"),
}


def ensure_lab_content_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_lab_slug",
                    "label": "Lab Test Slug",
                    "fieldtype": "Data",
                    "insert_after": "hec_lab_category",
                    "description": "SEO slug for diagnostics detail page",
                },
                {
                    "fieldname": "hec_lab_about",
                    "label": "Lab Test About (JSON)",
                    "fieldtype": "Long Text",
                    "insert_after": "hec_lab_slug",
                },
                {
                    "fieldname": "hec_lab_faqs",
                    "label": "Lab Test FAQs (JSON)",
                    "fieldtype": "Long Text",
                    "insert_after": "hec_lab_about",
                },
            ]
        }
    )


def _is_mostly_uppercase(text):
    words = re.findall(r"[A-Za-z0-9/+\-]+", text or "")
    if not words:
        return False
    upperish = sum(1 for word in words if word.isupper() or (len(word) <= 4 and word.upper() == word))
    return upperish / len(words) >= 0.55


def _canonical_token(token):
    raw = (token or "").strip()
    if not raw:
        return raw
    upper = re.sub(r"[^A-Z0-9/+\-]", "", raw.upper())
    if upper in CANONICAL_ABBREV:
        return CANONICAL_ABBREV[upper]
    if raw.isupper() and len(raw) <= 6:
        return CANONICAL_ABBREV.get(upper, raw.title() if "/" not in raw else raw)
    return raw


def _title_word(word, index=0):
    word = word.strip()
    if not word:
        return word
    if word.upper() in CANONICAL_ABBREV:
        return CANONICAL_ABBREV[word.upper()]
    if re.fullmatch(r"[A-Za-z0-9/+\-\.]+", word):
        lower = word.lower()
        if index > 0 and lower in SMALL_WORDS:
            return lower
        if "/" in word:
            return "/".join(_title_word(part, idx) for idx, part in enumerate(word.split("/")))
        if word.isupper() and len(word) <= 5:
            return CANONICAL_ABBREV.get(word.upper(), word)
        return word[:1].upper() + word[1:].lower()
    return word


def _title_case_phrase(text):
    parts = re.split(r"(\s+|[:/()\-–—&+])", text or "")
    out = []
    word_index = 0
    for part in parts:
        if not part or part.isspace() or part in ":/()–—":
            out.append(part)
            continue
        if part in ("-", "&", "+"):
            out.append(f" {part} " if part == "&" else part)
            continue
        out.append(_title_word(part, word_index))
        word_index += 1
    return re.sub(r"\s+", " ", "".join(out)).strip()


def _normalize_key(text):
    s = (text or "").upper().replace("/", " ")
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


TRAILING_WORD_BLACKLIST = frozenset(
    """
    count test serum plasma urine blood level panel profile assay screen enzyme antibody
    antibodies culture sensitivity examination analysis report sample spot random fasting
    qualitative quantitative total direct indirect fraction function whole routine
    comprehensive basic with plus and each same day hrs hours fluid body receptor
    converting ratio antigen marker fraction fractionation fractionated
    prostatic phosphatase smear identification
    """.split()
)


def _is_valid_trailing_abbrev(token):
    token = (token or "").strip()
    if not token or len(token) > 12:
        return False
    upper = re.sub(r"[^A-Z0-9/+\-]", "", token.upper())
    if not upper:
        return False
    if upper in EXPANSION_BY_ABBR or upper in CANONICAL_ABBREV:
        return True
    if upper in TRAILING_WORD_BLACKLIST:
        return False
    if len(upper) <= 6 and token.isupper():
        return upper not in TRAILING_WORD_BLACKLIST
    return False


def _looks_like_abbrev(token):
    cleaned = re.sub(r"[^A-Za-z0-9/+\-]", "", (token or "").strip())
    if not cleaned:
        return False
    upper = cleaned.upper()
    if upper in EXPANSION_BY_ABBR or upper in CANONICAL_ABBREV:
        return True
    if upper in TRAILING_WORD_BLACKLIST:
        return False
    return cleaned.isupper() and len(cleaned) <= 10


def _strip_non_abbrev_parens(text):
    match = re.search(r"\(([^)]+)\)\s*$", (text or "").strip())
    if match and not _looks_like_abbrev(match.group(1)):
        return text[: match.start()].strip(" -")
    return (text or "").strip()


def _extract_leading_abbrev(text):
    raw = (text or "").strip()
    match = re.match(r"^([A-Z0-9][A-Z0-9/+\-\.]{1,7})\s+(.+)$", raw)
    if not match:
        return raw, ""
    abbr = _canonical_token(match.group(1))
    if abbr.upper() in EXPANSION_BY_ABBR or abbr.upper() in CANONICAL_ABBREV:
        return match.group(2).strip(), abbr
    return raw, ""


def _extract_abbreviation(text):
    raw = (text or "").strip()
    match = re.search(r"\(([^)]+)\)\s*$", raw)
    if match and _looks_like_abbrev(match.group(1)):
        abbr = match.group(1).strip(" -")
        main = raw[: match.start()].strip(" -")
        return main, _canonical_token(abbr)

    leading_main, leading_abbr = _extract_leading_abbrev(raw)
    if leading_abbr:
        return leading_main, leading_abbr

    match = re.search(r"[\s\-–—]+([A-Z0-9][A-Z0-9/+\-\.]{1,})\s*$", raw)
    if match and _is_valid_trailing_abbrev(match.group(1)):
        main = raw[: match.start()].strip(" -")
        return main, _canonical_token(match.group(1))
    return raw, ""


def format_lab_display_name(raw_name):
    """Return display name as 'Full Name (Abbr)' with proper casing."""
    raw = _strip_non_abbrev_parens(raw_name)
    if not raw:
        return raw

    key = _normalize_key(raw)
    if key in SYNONYM_EXPANSIONS:
        full, abbr = SYNONYM_EXPANSIONS[key]
        return f"{full} ({abbr})" if abbr else full

    main, abbr = _extract_abbreviation(raw)
    main_key = _normalize_key(main)

    if main_key in SYNONYM_EXPANSIONS:
        full, synonym_abbr = SYNONYM_EXPANSIONS[main_key]
        abbr = abbr or synonym_abbr
        main = full
    elif abbr and abbr.upper() in EXPANSION_BY_ABBR and _is_mostly_uppercase(main):
        expanded = EXPANSION_BY_ABBR[abbr.upper()]
        if _normalize_key(main) == _normalize_key(expanded) or len(main.split()) <= 2:
            main = expanded
        else:
            main = _title_case_phrase(main)
    elif not abbr and _is_mostly_uppercase(main):
        tokens = re.findall(r"[A-Z0-9/+\-]+", main.upper())
        if len(tokens) == 1 and tokens[0] in EXPANSION_BY_ABBR:
            return f"{EXPANSION_BY_ABBR[tokens[0]]} ({_canonical_token(tokens[0])})"
        main = _title_case_phrase(main)
    elif _is_mostly_uppercase(main):
        main = _title_case_phrase(main)
    else:
        main = re.sub(r"\s+", " ", main).strip()

    if abbr:
        abbr = _canonical_token(abbr)
        if abbr.upper() == "ACE" and "angiotensin" in main.lower():
            main = _title_case_phrase(main)
            return f"{main} ({abbr})"
        if abbr.upper() in EXPANSION_BY_ABBR and main.lower() == EXPANSION_BY_ABBR[abbr.upper()].lower():
            return f"{main} ({abbr})"
        if f"({abbr}" not in main and abbr.lower() not in main.lower():
            return f"{main} ({abbr})"
    return main


def build_also_known_as(raw_name, display_name):
    aliases = []
    for candidate in (raw_name, display_name):
        candidate = (candidate or "").strip()
        if candidate and candidate not in aliases:
            aliases.append(candidate)
    normalized_display = _normalize_key(display_name)
    for key, (full, abbr) in SYNONYM_EXPANSIONS.items():
        if key in normalized_display or _normalize_key(raw_name) == key:
            for part in (full, abbr):
                if part and part not in aliases:
                    aliases.append(part)
    main, abbr = _extract_abbreviation(display_name)
    if abbr and abbr not in aliases:
        aliases.append(abbr)
    if abbr and abbr.upper() in EXPANSION_BY_ABBR:
        expanded = EXPANSION_BY_ABBR[abbr.upper()]
        if expanded not in aliases:
            aliases.append(expanded)
    return [alias for alias in aliases if alias != display_name]


def lab_slug_from_name(display_name):
    slug = frappe.scrub(display_name or "")
    slug = re.sub(r"_+", "-", slug).strip("-")
    return slug[:140]


def _format_tat_label(hours):
    hours = cint(hours) or 24
    if hours <= 12:
        return f"{hours} hours"
    days = max(1, round(hours / 24))
    return "1 day" if days == 1 else f"{days} days"


def infer_preparation(display_name, sample_type, category):
    lower = (display_name or "").lower()
    if any(token in lower for token in ("fasting", "fbs", "ppbs", "gtt", "ogtt", "lipid", "triglyceride")):
        return (
            "Fasting for 10–12 hours is recommended before sample collection. "
            "You may drink plain water during the fast unless your doctor advises otherwise."
        )
    if "post prandial" in lower or "ppbs" in lower or "postparandial" in lower:
        return "Eat a regular meal and give a blood sample exactly 2 hours after you start eating."
    if sample_type == "Urine" and any(token in lower for token in ("24 hr", "24hrs", "24 hrs")):
        return (
            "Collect all urine passed over 24 hours in the container provided by the laboratory. "
            "Follow the lab instructions for discarding the first morning sample and keeping the collection cool."
        )
    if sample_type == "Stool":
        return "Collect a fresh stool sample in a clean, dry container. Avoid contamination with urine or water."
    if any(token in lower for token in ("culture", "semen", "sputum")):
        return (
            "Use a sterile container provided by the laboratory. "
            "Follow hygiene instructions shared at sample collection."
        )
    if category == "Hormone" and any(token in lower for token in ("cortisol", "acth", "renin")):
        return "Sample timing may be important for some hormone tests. Follow the specific instructions given at booking."
    return DEFAULT_PREPARATION


def _category_purpose(category, display_name):
    lower = display_name.lower()
    if category == "Diabetes" or "hba1c" in lower or "glucose" in lower or "insulin" in lower:
        return (
            f"The {display_name} helps assess blood sugar control and supports screening or monitoring of diabetes "
            "and related metabolic conditions."
        )
    if category == "Thyroid" or "thyroid" in lower or "tsh" in lower:
        return (
            f"The {display_name} evaluates thyroid gland function and helps investigate symptoms such as fatigue, "
            "weight change, hair loss, or menstrual irregularities."
        )
    if category == "Lipid" or "lipid" in lower or "cholesterol" in lower:
        return (
            f"The {display_name} measures blood fats and cardiovascular risk markers to support heart health "
            "assessment and preventive care."
        )
    if category == "Liver" or "liver" in lower or "lft" in lower:
        return (
            f"The {display_name} assesses liver health and helps detect inflammation, obstruction, or liver cell injury."
        )
    if category == "Kidney" or "kidney" in lower or "renal" in lower or "creatinine" in lower:
        return (
            f"The {display_name} evaluates kidney function and helps monitor hydration, filtration, and waste clearance."
        )
    if category == "Vitamins & Minerals" or "vitamin" in lower or "iron" in lower or "calcium" in lower:
        return (
            f"The {display_name} measures nutrient levels that may contribute to fatigue, bone health, anaemia, "
            "or neurological symptoms."
        )
    if category == "Hormone":
        return (
            f"The {display_name} measures hormone levels that help evaluate endocrine function, fertility, "
            "growth, or metabolic balance."
        )
    if category == "Health Package":
        return (
            f"The {display_name} combines multiple related investigations to provide a broader preventive health "
            "or disease-monitoring overview."
        )
    return (
        f"The {display_name} is a laboratory investigation used to support diagnosis, screening, treatment "
        "monitoring, or preventive health assessment."
    )


def _category_who_should(category, display_name):
    lower = display_name.lower()
    if category == "Diabetes":
        return (
            "People with diabetes, prediabetes risk, obesity, family history of diabetes, or symptoms such as "
            "increased thirst, frequent urination, or unexplained weight change."
        )
    if category == "Thyroid":
        return (
            "Individuals with thyroid symptoms, goitre, infertility work-up, pregnancy planning, or known thyroid disease."
        )
    if category == "Lipid":
        return (
            "Adults undergoing cardiovascular risk assessment, especially those with hypertension, diabetes, obesity, "
            "smoking history, or a family history of heart disease."
        )
    if "pregnancy" in lower or "beta hcg" in lower:
        return "Women with a missed period, suspected pregnancy, or as advised during antenatal care."
    if "culture" in lower or "sensitivity" in lower:
        return "Patients with suspected infection when a doctor needs to identify the organism and suitable antibiotics."
    if "biopsy" in lower or "histopath" in lower or "cyto" in lower:
        return "Patients with tissue, lump, or cytology samples sent by a doctor for microscopic examination."
    return (
        "Anyone advised by their doctor for diagnosis, monitoring, pre-operative evaluation, occupational screening, "
        "or preventive health check-ups."
    )


def generate_lab_about(display_name, sample_type, category, tat_hours, preparation):
    tat_label = _format_tat_label(tat_hours)
    purpose = _category_purpose(category, display_name)
    who_should = _category_who_should(category, display_name)
    procedure = (
        f"A trained phlebotomist collects the required {sample_type.lower()} sample using standard sterile technique. "
        "The specimen is transported to the laboratory, processed, and reported after medical validation."
    )
    sections = [
        {
            "title": f"What is {display_name}?",
            "body": (
                f"{display_name} is a diagnostic laboratory test offered at Remedium. "
                f"It uses a {sample_type.lower()} sample and reports are typically available within {tat_label}."
            ),
        },
        {
            "title": f"What is the purpose of {display_name}?",
            "body": purpose,
        },
        {
            "title": f"Who should get {display_name} done?",
            "body": who_should,
        },
        {
            "title": "Preparation and procedure",
            "body": f"{preparation}\n\n{procedure}",
        },
    ]
    return sections


def generate_lab_faqs(display_name, sample_type, category, tat_hours, preparation):
    tat_label = _format_tat_label(tat_hours)
    fasting_answer = (
        "Yes, fasting is generally required for this test unless your doctor tells you otherwise."
        if "fasting" in preparation.lower()
        else "No fasting is usually required for this test unless your doctor advises otherwise."
    )
    return [
        {
            "question": f"What is {display_name}?",
            "answer": (
                f"{display_name} is a laboratory investigation that helps your doctor evaluate health status, "
                f"screen for disease, or monitor treatment using a {sample_type.lower()} sample."
            ),
        },
        {
            "question": f"Why is {display_name} done?",
            "answer": _category_purpose(category, display_name),
        },
        {
            "question": "Is fasting required?",
            "answer": fasting_answer,
        },
        {
            "question": "What sample is required?",
            "answer": f"This test requires a {sample_type.lower()} sample collected under standard laboratory conditions.",
        },
        {
            "question": "How long do reports take?",
            "answer": f"Reports for {display_name} are typically available within {tat_label} after sample receipt at the lab.",
        },
        {
            "question": "How can I book this test with Remedium?",
            "answer": (
                "Select Book now on this page, choose a convenient home collection slot, and track your report digitally "
                "in My orders after processing is complete."
            ),
        },
    ]


def build_lab_content(raw_name, sample_type="", tat_hours=24, category=""):
    display_name = format_lab_display_name(raw_name)
    sample_type = _normalize_sample_type(sample_type) or DEFAULT_SAMPLE
    category = category or _infer_category(raw_name)
    tat_hours = cint(tat_hours) or 24
    preparation = infer_preparation(display_name, sample_type, category)
    about = generate_lab_about(display_name, sample_type, category, tat_hours, preparation)
    faqs = generate_lab_faqs(display_name, sample_type, category, tat_hours, preparation)
    aliases = build_also_known_as(raw_name, display_name)
    slug = lab_slug_from_name(display_name)
    short_description = (
        f"{display_name} uses a {sample_type.lower()} sample. "
        f"Reports in about {_format_tat_label(tat_hours)}. {preparation}"
    )
    return {
        "display_name": display_name,
        "also_known_as": aliases,
        "slug": slug,
        "preparation": preparation,
        "about": about,
        "faqs": faqs,
        "short_description": short_description,
        "category": category,
        "sample_type": sample_type,
        "tat_hours": tat_hours,
    }


def _raw_from_item_code(item_code):
    phrase = (item_code or "").replace("LAB-", "").replace("-", " ").strip()
    return phrase.upper() if phrase else ""


def _best_raw_name(item_code, current_name):
    aka_field = frappe.db.get_value("Item", item_code, "hec_lab_also_known_as") or ""
    candidates = [_strip_non_abbrev_parens(current_name), _raw_from_item_code(item_code)]
    candidates.extend(part.strip() for part in re.split(r"[,;|]", aka_field) if part.strip())
    for candidate in candidates:
        if _is_mostly_uppercase(candidate):
            return candidate
    return _raw_from_item_code(item_code) or current_name


def enrich_lab_item(item_code, raw_name=None, commit=False):
    if not item_code or not frappe.db.exists("Item", item_code):
        return None

    row = frappe.db.get_value(
        "Item",
        item_code,
        [
            "item_name",
            "hec_lab_sample_type",
            "hec_lab_report_tat_hours",
            "hec_lab_category",
            "hec_lab_preparation",
        ],
        as_dict=True,
    )
    raw = raw_name or _best_raw_name(item_code, row.item_name)
    content = build_lab_content(
        raw,
        sample_type=row.hec_lab_sample_type,
        tat_hours=row.hec_lab_report_tat_hours,
        category=row.hec_lab_category,
    )

    aka = ", ".join(content["also_known_as"][:12])
    doc = frappe.get_doc("Item", item_code)
    doc.item_name = content["display_name"]
    doc.description = content["short_description"]
    doc.hec_lab_preparation = content["preparation"]
    doc.hec_lab_also_known_as = aka
    doc.hec_lab_category = content["category"]
    doc.hec_lab_sample_type = content["sample_type"]
    doc.hec_lab_report_tat_hours = content["tat_hours"]
    doc.hec_lab_slug = content["slug"]
    doc.hec_lab_about = json.dumps(content["about"], ensure_ascii=False)
    doc.hec_lab_faqs = json.dumps(content["faqs"], ensure_ascii=False)
    doc.save(ignore_permissions=True)
    if commit:
        frappe.db.commit()
    return {"item_code": item_code, "item_name": content["display_name"], "slug": content["slug"]}


def _csv_to_item_code_map():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import (
        _item_code_from_name,
        parse_lab_rate_csv,
    )

    used = frappe.get_all("Item", filters={"item_group": LAB_ITEM_GROUP}, pluck="name")
    used_set = set(used)
    mapping = {}
    for row in parse_lab_rate_csv():
        csv_name = (row.get("name") or "").strip()
        if not csv_name:
            continue
        candidate = _item_code_from_name(csv_name, set())
        if candidate in used_set:
            mapping[candidate] = csv_name
            continue
        prefix = candidate
        matches = sorted(code for code in used if code == prefix or code.startswith(f"{prefix}-"))
        if len(matches) == 1:
            mapping[matches[0]] = csv_name
        elif matches:
            mapping[matches[0]] = csv_name
    return mapping


def enrich_all_lab_items(limit=None, commit_batch=50):
    ensure_lab_content_custom_fields()
    csv_map = _csv_to_item_code_map()

    items = frappe.get_all(
        "Item",
        filters={"item_group": LAB_ITEM_GROUP, "disabled": 0},
        fields=["name", "item_name"],
        order_by="item_name asc",
    )
    if limit:
        items = items[: cint(limit)]

    updated = []
    for idx, row in enumerate(items, start=1):
        raw_name = csv_map.get(row.name) or _best_raw_name(row.name, row.item_name)
        result = enrich_lab_item(row.name, raw_name=raw_name)
        if result:
            updated.append(result)
        if commit_batch and idx % commit_batch == 0:
            frappe.db.commit()

    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "updated": len(updated),
        "samples": updated[:10],
    }


def extended_lab_item_profile(item_code):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import lab_item_profile

    profile = lab_item_profile(item_code) or {}
    fields = frappe.db.get_value(
        "Item",
        item_code,
        ["hec_lab_slug", "hec_lab_about", "hec_lab_faqs"],
        as_dict=True,
    )
    if not fields:
        return profile

    profile["slug"] = fields.hec_lab_slug or lab_slug_from_name(profile.get("item_name") or item_code)
    about = []
    faqs = []
    try:
        if fields.hec_lab_about:
            about = json.loads(fields.hec_lab_about)
    except Exception:
        about = []
    try:
        if fields.hec_lab_faqs:
            faqs = json.loads(fields.hec_lab_faqs)
    except Exception:
        faqs = []
    profile["about_sections"] = about
    profile["faqs"] = faqs
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase56_lab_parameters import (
            parameters_for_item,
        )

        params = parameters_for_item(item_code)
        profile["included_tests"] = params.get("parameters") or []
        profile["test_count"] = params.get("count") or profile.get("test_count") or 1
        profile["parameters_source"] = params.get("source") or ""
    except Exception:
        profile.setdefault("included_tests", [])
    return profile


def setup_phase55():
    ensure_lab_content_custom_fields()
    frappe.clear_cache()
    return {"ok": True, "phase": 55}
