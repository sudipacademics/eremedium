"""Phase 29 — Import Remedium FOCO lab test catalog from CSV into ERPNext Items."""

from __future__ import annotations

import csv
import os
import re

import frappe
from frappe import _
from frappe.utils import flt, cint

LAB_ITEM_GROUP = "Lab Tests"
FOCO_PRICE_LIST = "Remedium FOCO Wholesale"
RETAIL_MARKUP = 1.2  # patient MRP when sheet only has FOCO / wholesale column
DEFAULT_SAMPLE = "Blood"
DEFAULT_PREPARATION = "No special preparation is required."
DEFAULT_TAT_HOURS = 24

NAME_COLUMNS = ("test name", "item name", "name", "investigation")
FOCO_COLUMNS = ("foco rate", "foco", "wholesale rate", "test amount", "rate")
MRP_COLUMNS = ("mrp", "retail rate", "patient rate", "selling rate", "test amount")

# ---------------------------------------------------------------------------
# Rate inference for tests missing a rate (FOCO Rate == 0)
#   Signal 1: "our price trends" — match to a priced sibling in the same sheet
#   Signal 2: "current market price" — category / keyword market rate (INR, FOCO/wholesale)
# ---------------------------------------------------------------------------

DEFAULT_MARKET_RATE = 600  # fallback when no sibling and no category matches

# Non-diagnostic entries that are not orderable lab tests (radiology, pure
# surgical procedure names with no specimen, reporting artifacts). These are
# left uncreated and reported so the catalog stays clean.
NONLAB_KEYWORDS = (
    "doppler",
    "duplex",
    "upper abdomen",
    "pft",
    "body mass index",
    "(bmi)",
    "pathology blank",
    "no growth",
    "growth positive",
    "more than 5 blocks",
    "up to 5 blocks",
    "slide review",
    "stained cytology slides",
    "v4 test",
)

# Ordered (keywords, rate, label). First match wins. Sibling match is tried
# before any of these. Rates are FOCO/wholesale INR calibrated to sheet medians.
MARKET_RATE_RULES = (
    (("resection", "ectomy", "mastectomy", "whipple", "hysterectomy",
      "nephrectomy", "prostatectomy", "cystectomy", "gastrectomy",
      "esophagectomy", "orchidectomy", "orchiectomy", "penectomy",
      "neck dissection", "ureteroplasty"), 2500, "market:histopath-large"),
    (("biopsy", "biopsies", "trucut", "punch", "needle biopsy",
      "incisional", "curettage", "curretage", "lump", "nodulectomy",
      "polypectomy", "debridement", "excision", "lesion", "hernia sac",
      "hemia sac", "hydrocele sac", "bursa", "sac with", "endometrium with",
      "buccal", "tongue biops"), 1200, "market:histopath-biopsy"),
    (("immunohistochemistry", "ihc", "er pr", "er/pr", "ki 67", "ki67",
      "tissue block", "per marker"), 1500, "market:ihc"),
    (("histopathology", "specimen"), 1500, "market:histopath"),
    (("flow cytometry", "flowcytometry", "freelite", "free light chain",
      "kappa", "lambda"), 3000, "market:flow-cytometry"),
    (("pcr", "genotyping", "mutation", "sequencing", "karyotyping",
      "microdeletion", "bcrabl", "bcr abl", "jak2", "jak 2", "fmr1",
      "fragile x", "mthfr", "hybrid dna", "digene", "proviral",
      "viral load", "hcv rna", "hbv", "rt pcr"), 3500, "market:molecular"),
    (("protein c", "protein s", "antithrombin", "anti thrombin",
      "lupus anticoagulant", "factor v", "factor viii"),
     2500, "market:coagulation"),
    (("amphetamine", "barbiturate", "benzodiaepine", "benzodiazepine",
      "opiate", "opiates", "cannabis", "marijuana", "methamphetamine",
      "phencyclidine", "nicotine", "drug of abuse", "drug abuse"),
     1000, "market:drug-screen"),
    (("allergy",), 2500, "market:allergy-panel"),
    (("t3", "t4", "thyroxine", "triiodothyronine", "tri-iodothyronine",
      "thyroid"), 400, "market:thyroid"),
    (("aldosterone", "renin", "catecholamine", "metanephrine",
      "normetanephrine", "vasopressin", "adh", "erythropoietin",
      "epo", "erythropoeitin", "inhibin", "androstein", "androstenedione"),
     2000, "market:endocrine"),
    (("vitamin", "folate", "folic"), 2000, "market:vitamin"),
    (("culture", "sensitivity"), 500, "market:culture"),
    (("cytology", "pap smear", "fnac", "cervical smear"), 600, "market:cytology"),
    (("fluid examination", "fluid exam", "ascitic fluid", "pleural fluid",
      "synovial fluid", "capd fluid", "fluid for", "body fluid"),
     400, "market:fluid"),
    (("antibody", "antibodies", "igg", "igm", "iga",
      "serology", "panel", "titre", "titer"), 1200, "market:serology"),
    (("microalbumin", "urinary", "urine"), 250, "market:urine-chemistry"),
    (("sodium", "potassium", "chloride", "calcium", "phosphor", "phosphorus",
      "phosphorous", "magnesium", "protein", "urea", "creatinine",
      "osmolality", "bicarbonate", "electrolyte", "electrolytes"),
     250, "market:chemistry"),
    (("marker", "antigen"), 1000, "market:marker"),
)


def _normalize_test_key(name):
    """Collapse a test name to a comparable key by dropping sample type,
    qualifiers and punctuation so formatting-variant siblings collide."""
    s = (name or "").lower()
    s = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", s)  # drop bracketed content
    s = re.sub(
        r"\b(serum|plasma|blood|urine|random|spot|fluid|csf|stool|"
        r"qualitative|quantitative|elisa|ifa|clia|rapid|card|screen|"
        r"screening|report|reporting|level|levels|total|test|method|"
        r"automated|new|hrs|hours|hr|24)\b",
        " ",
        s,
    )
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _build_known_rate_index(rows):
    index = {}
    for row in rows:
        rate = flt(row.get("foco_rate"))
        if rate <= 0:
            continue
        key = _normalize_test_key(row.get("name"))
        if not key:
            continue
        index.setdefault(key, []).append(rate)
    return index


def _median(values):
    if not values:
        return 0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return round((ordered[mid - 1] + ordered[mid]) / 2, 2)


def _is_nonlab(name):
    lower = (name or "").lower()
    return any(kw in lower for kw in NONLAB_KEYWORDS)


def _kw_match(lower, keyword):
    """Word-boundary match so 'protein' does not fire inside 'fetoprotein'."""
    return re.search(r"\b" + re.escape(keyword) + r"\b", lower) is not None


def _infer_rate(name, known_index, global_median):
    """Return (rate, method). rate 0 with method 'skip:nonlab' means do not create."""
    if _is_nonlab(name):
        return 0, "skip:nonlab"

    key = _normalize_test_key(name)
    siblings = known_index.get(key)
    if siblings:
        return _median(siblings), "sheet:sibling"

    lower = (name or "").lower()
    for keywords, rate, label in MARKET_RATE_RULES:
        if any(_kw_match(lower, kw) for kw in keywords):
            return rate, label

    return global_median or DEFAULT_MARKET_RATE, "market:default"


def _data_csv_path():
    candidates = []
    try:
        app_path = frappe.get_app_path("health_ecosystem_core")
        candidates.append(os.path.join(app_path, "data", "remedium_foco_lab_rates.csv"))
    except Exception:
        pass
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(os.path.join(pkg_root, "..", "data", "remedium_foco_lab_rates.csv"))
        candidates.append(os.path.join(pkg_root, "data", "remedium_foco_lab_rates.csv"))
    except Exception:
        pass
    for path in candidates:
        if path and os.path.isfile(path):
            return os.path.normpath(path)
    return None


def ensure_lab_item_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_foco_rate",
                    "label": "FOCO Rate",
                    "fieldtype": "Currency",
                    "insert_after": "standard_rate",
                    "description": "Franchise / wholesale rate from FOCO price list",
                },
                {
                    "fieldname": "hec_lab_sample_type",
                    "label": "Sample Type",
                    "fieldtype": "Data",
                    "insert_after": "hec_foco_rate",
                },
                {
                    "fieldname": "hec_lab_report_tat_hours",
                    "label": "Report TAT (hours)",
                    "fieldtype": "Int",
                    "insert_after": "hec_lab_sample_type",
                },
                {
                    "fieldname": "hec_lab_test_count",
                    "label": "Tests Included",
                    "fieldtype": "Int",
                    "default": "1",
                    "insert_after": "hec_lab_report_tat_hours",
                },
                {
                    "fieldname": "hec_lab_preparation",
                    "label": "Preparation",
                    "fieldtype": "Small Text",
                    "insert_after": "hec_lab_test_count",
                },
                {
                    "fieldname": "hec_lab_also_known_as",
                    "label": "Also Known As",
                    "fieldtype": "Small Text",
                    "insert_after": "hec_lab_preparation",
                },
                {
                    "fieldname": "hec_lab_category",
                    "label": "Lab Category",
                    "fieldtype": "Data",
                    "insert_after": "hec_lab_also_known_as",
                },
            ],
        },
        update=True,
    )


def ensure_lab_item_group():
    if not frappe.db.exists("Item Group", LAB_ITEM_GROUP):
        frappe.get_doc(
            {
                "doctype": "Item Group",
                "item_group_name": LAB_ITEM_GROUP,
                "parent_item_group": "All Item Groups",
                "is_group": 0,
            }
        ).insert(ignore_permissions=True)


def _ensure_price_list(name, *, selling=1):
    if frappe.db.exists("Price List", name):
        return name
    frappe.get_doc(
        {
            "doctype": "Price List",
            "price_list_name": name,
            "currency": "INR",
            "enabled": 1,
            "selling": selling,
            "buying": 0 if selling else 1,
        }
    ).insert(ignore_permissions=True)
    return name


def ensure_lab_price_lists():
    retail = (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        or "Standard Selling"
    )
    _ensure_price_list(retail, selling=1)
    _ensure_price_list(FOCO_PRICE_LIST, selling=1)
    return retail, FOCO_PRICE_LIST


def _normalize_header(value):
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _pick_column(fieldnames, aliases):
    normalized = {_normalize_header(h): h for h in fieldnames if h}
    for alias in aliases:
        if alias in normalized:
            return normalized[alias]
    return None


def _parse_rate(value):
    if value is None:
        return 0
    text = str(value).strip().replace(",", "")
    if not text:
        return 0
    try:
        return flt(text)
    except Exception:
        return 0


def _item_code_from_name(name, used_codes):
    base = re.sub(r"[^A-Z0-9]+", "-", frappe.scrub(name).upper()).strip("-")[:110]
    if not base:
        base = "TEST"
    code = f"LAB-{base}"[:140]
    if code not in used_codes and not frappe.db.exists("Item", code):
        used_codes.add(code)
        return code
    idx = 2
    while True:
        candidate = f"LAB-{base}-{idx}"[:140]
        if candidate not in used_codes and not frappe.db.exists("Item", candidate):
            used_codes.add(candidate)
            return candidate
        idx += 1


def _infer_sample_type(name):
    lower = (name or "").lower()
    if "urine" in lower or "urinary" in lower:
        return "Urine"
    if "stool" in lower or "fecal" in lower:
        return "Stool"
    if "saliva" in lower:
        return "Saliva"
    if "swab" in lower or "culture" in lower:
        return "Swab"
    return DEFAULT_SAMPLE


def _normalize_sample_type(value):
    sample = (value or "").strip()
    if not sample:
        return ""
    upper = sample.upper()
    mapping = {
        "SERUM": "Blood",
        "PLASMA": "Blood",
        "EDTA": "Blood",
        "BLOOD": "Blood",
        "URINE": "Urine",
        "STOOL": "Stool",
        "SWAB": "Swab",
        "SALIVA": "Saliva",
        "CSF": "CSF",
    }
    for key, normalized in mapping.items():
        if key in upper:
            return normalized
    return sample.title()


def _infer_category(name):
    lower = (name or "").lower()
    if any(k in lower for k in ("thyroid", "tsh", "t3", "t4")):
        return "Hormone"
    if any(k in lower for k in ("lipid", "cholesterol", "triglyceride")):
        return "Lipid"
    if any(k in lower for k in ("liver", "lft", "sgpt", "sgot")):
        return "Liver"
    if any(k in lower for k in ("kidney", "kft", "creatinine", "urea")):
        return "Kidney"
    if any(k in lower for k in ("diabetes", "glucose", "hba1c", "insulin")):
        return "Diabetes"
    if any(k in lower for k in ("vitamin", "iron", "calcium", "electrolyte")):
        return "Vitamins & Minerals"
    if "panel" in lower or "profile" in lower:
        return "Health Package"
    return "Pathology"


def _build_description(name, sample_type, preparation, tat_hours):
    return (
        f"<p><strong>{name}</strong></p>"
        f"<p>Sample: {sample_type}. Reports in about {tat_hours} hours.</p>"
        f"<p>{preparation}</p>"
    )


def _upsert_item_price(item_code, price_list, rate):
    if not rate:
        return
    existing = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list},
        "name",
    )
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
        return
    frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": price_list,
            "price_list_rate": rate,
            "selling": 1,
        }
    ).insert(ignore_permissions=True)


def _find_existing_lab_item(name):
    if not name:
        return None
    return frappe.db.get_value("Item", {"item_name": name, "item_group": LAB_ITEM_GROUP}, "name")


def _upsert_lab_item(row, retail_pl, foco_pl, used_codes):
    name = (row.get("name") or "").strip()
    foco_rate = flt(row.get("foco_rate"))
    mrp = flt(row.get("mrp"))
    if not name or foco_rate <= 0:
        return None

    if mrp <= 0:
        mrp = round(foco_rate * RETAIL_MARKUP, 2)
    if foco_rate > mrp:
        mrp = foco_rate

    item_code = (
        row.get("item_code")
        or _find_existing_lab_item(name)
        or _item_code_from_name(name, used_codes)
    )
    sample_type = _infer_sample_type(name)
    category = _infer_category(name)
    tat = DEFAULT_TAT_HOURS
    if "rapid" in name.lower() or "screen" in name.lower():
        tat = 12

    values = {
        "item_name": name,
        "item_group": LAB_ITEM_GROUP,
        "stock_uom": "Nos",
        "is_stock_item": 0,
        "is_sales_item": 1,
        "disabled": 0,
        "standard_rate": mrp,
        "description": _build_description(name, sample_type, DEFAULT_PREPARATION, tat),
        "hec_foco_rate": foco_rate,
        "hec_lab_sample_type": sample_type,
        "hec_lab_report_tat_hours": tat,
        "hec_lab_test_count": 1,
        "hec_lab_preparation": DEFAULT_PREPARATION,
        "hec_lab_also_known_as": name,
        "hec_lab_category": category,
    }

    if frappe.db.exists("Item", item_code):
        doc = frappe.get_doc("Item", item_code)
        doc.update(values)
        doc.save(ignore_permissions=True)
        action = "updated"
    else:
        doc = frappe.get_doc({"doctype": "Item", "item_code": item_code, **values})
        doc.insert(ignore_permissions=True)
        action = "created"

    _upsert_item_price(item_code, retail_pl, mrp)
    _upsert_item_price(item_code, foco_pl, foco_rate)
    return {"item_code": item_code, "action": action, "mrp": mrp, "foco_rate": foco_rate}


def parse_lab_rate_csv(path=None):
    path = path or _data_csv_path()
    if not path or not os.path.isfile(path):
        frappe.throw(_("Lab rate CSV not found at {0}").format(path or "data/remedium_foco_lab_rates.csv"))

    rows = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return rows
        name_col = _pick_column(reader.fieldnames, NAME_COLUMNS)
        foco_col = _pick_column(reader.fieldnames, FOCO_COLUMNS)
        mrp_col = _pick_column(reader.fieldnames, MRP_COLUMNS)
        if not name_col:
            frappe.throw(_("CSV missing test name column"))
        if not foco_col and not mrp_col:
            frappe.throw(_("CSV missing FOCO Rate / price column"))

        for raw in reader:
            name = (raw.get(name_col) or "").strip()
            foco_rate = _parse_rate(raw.get(foco_col)) if foco_col else 0
            mrp = _parse_rate(raw.get(mrp_col)) if mrp_col and mrp_col != foco_col else 0
            if foco_col and mrp_col and foco_col == mrp_col:
                foco_rate = _parse_rate(raw.get(foco_col))
                mrp = 0
            elif not foco_rate and mrp:
                foco_rate = mrp
                mrp = 0
            rows.append({"name": name, "foco_rate": foco_rate, "mrp": mrp})
    return rows


def _write_inferred_review(path, inferred_rows):
    if not path:
        return None
    try:
        review_path = os.path.join(os.path.dirname(path), "remedium_foco_lab_rates_inferred.csv")
        with open(review_path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Test Name", "Inferred FOCO Rate", "Patient MRP", "Method"])
            for entry in inferred_rows:
                writer.writerow([entry["name"], entry["foco_rate"], entry["mrp"], entry["method"]])
        return review_path
    except Exception:
        return None


def import_lab_items_from_csv(path=None, limit=None, infer_missing=True):
    ensure_lab_item_custom_fields()
    ensure_lab_item_group()
    retail_pl, foco_pl = ensure_lab_price_lists()

    path = path or _data_csv_path()
    parsed = parse_lab_rate_csv(path)
    if limit:
        parsed = parsed[: cint(limit)]

    known_index = _build_known_rate_index(parsed)
    all_known = [r for values in known_index.values() for r in values]
    global_median = _median(all_known)

    used_codes = set()
    created = updated = skipped = inferred = 0
    method_breakdown = {}
    samples = []
    inferred_rows = []

    for row in parsed:
        if infer_missing and flt(row.get("foco_rate")) <= 0 and (row.get("name") or "").strip():
            rate, method = _infer_rate(row["name"], known_index, global_median)
            method_breakdown[method] = method_breakdown.get(method, 0) + 1
            if rate <= 0:
                skipped += 1
                continue
            row = dict(row, foco_rate=rate, mrp=0)
            inferred += 1
            mrp = round(rate * RETAIL_MARKUP, 2)
            entry = {"name": row["name"], "foco_rate": rate, "mrp": mrp, "method": method}
            inferred_rows.append(entry)
            if method.startswith("market") and len([e for e in samples if e.get("inferred")]) < 5:
                samples.append({**entry, "inferred": True})

        result = _upsert_lab_item(row, retail_pl, foco_pl, used_codes)
        if not result:
            skipped += 1
            continue
        if result["action"] == "created":
            created += 1
        else:
            updated += 1

    frappe.db.commit()
    review_path = _write_inferred_review(path, inferred_rows)
    return {
        "ok": True,
        "source": path,
        "retail_price_list": retail_pl,
        "foco_price_list": foco_pl,
        "parsed": len(parsed),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "inferred": inferred,
        "global_median_rate": global_median,
        "method_breakdown": method_breakdown,
        "review_csv": review_path,
        "samples": samples[:8],
    }


def lab_item_profile(item_code):
    if not item_code or not frappe.db.exists("Item", item_code):
        return {}
    fields = [
        "item_name",
        "description",
        "standard_rate",
        "hec_foco_rate",
        "hec_lab_sample_type",
        "hec_lab_report_tat_hours",
        "hec_lab_test_count",
        "hec_lab_preparation",
        "hec_lab_also_known_as",
        "hec_lab_category",
        "item_group",
    ]
    meta = frappe.get_meta("Item")
    available = {f.fieldname for f in meta.fields}
    fetch = [f for f in fields if f in available]
    row = frappe.db.get_value("Item", item_code, fetch, as_dict=True) if fetch else {}
    aliases = []
    aka = (row.get("hec_lab_also_known_as") or "").strip()
    if aka:
        aliases = [part.strip() for part in re.split(r"[;,|]", aka) if part.strip()]
    return {
        "foco_rate": flt(row.get("hec_foco_rate")),
        "sample_type": row.get("hec_lab_sample_type") or DEFAULT_SAMPLE,
        "report_tat_hours": cint(row.get("hec_lab_report_tat_hours")) or DEFAULT_TAT_HOURS,
        "test_count": cint(row.get("hec_lab_test_count")) or 1,
        "preparation": row.get("hec_lab_preparation") or DEFAULT_PREPARATION,
        "also_known_as": aliases,
        "lab_category": row.get("hec_lab_category") or "",
    }


def setup_phase29():
    ensure_lab_item_custom_fields()
    ensure_lab_item_group()
    retail_pl, foco_pl = ensure_lab_price_lists()
    frappe.clear_cache()
    return {"ok": True, "phase": 29, "retail_price_list": retail_pl, "foco_price_list": foco_pl}


def smoke_phase29_lab_import(limit=25):
    setup_phase29()
    sample_code = frappe.db.get_value(
        "Item",
        {"item_group": LAB_ITEM_GROUP, "disabled": 0},
        "name",
        order_by="modified desc",
    )
    profile = lab_item_profile(sample_code) if sample_code else {}
    return {
        "ok": True,
        "sample_item": sample_code,
        "sample_profile": profile,
        "catalog_count": frappe.db.count("Item", {"item_group": LAB_ITEM_GROUP, "disabled": 0}),
    }
