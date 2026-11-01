"""Phase 110 — Fill Diagnostic Test Master parameters + age/sex reference ranges.

Walks every Diagnostic Test Master and:
1. Inserts missing parameter rows (panel profiles or single-analyte).
2. Fills blank/zero normal_min / normal_max from curated clinical reference data.
3. Adds gender / age-wise reference_ranges when known and enables uses_age_related_ranges.

Reference values are standard adult/pediatric intervals compiled from widely published
clinical laboratory tables (Merck Manual / ABIM-style adult ranges, Apollo 24|7 panels,
NCCPA adult lab values). Individual analyzers may differ — treat as starting defaults
for reporting, not method-specific certification limits.

Run:
  bench --site health.localhost execute \\
    health_ecosystem_core.health_ecosystem_core.clinical_phase110_dtm_reference_fill.sync_all_diagnostic_references
"""

from __future__ import annotations

import re

import frappe
from frappe.utils import cint, flt

SOURCE = "phase110-clinical-reference"


def _code(name):
	code = re.sub(r"[^A-Z0-9]+", "_", (name or "").upper()).strip("_")
	return (code[:40] or "PARAM")


def _norm(text):
	return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _band(gender, y0, y1, low, high, label=None, m0=0, d0=0, m1=0, d1=0):
	row = {
		"gender": gender,
		"age_from_years": cint(y0),
		"age_from_months": cint(m0),
		"age_from_days": cint(d0),
		"age_to_years": cint(y1),
		"age_to_months": cint(m1),
		"age_to_days": cint(d1),
		"normal_min": low,
		"normal_max": high,
	}
	if label:
		row["display_label"] = label
	elif low is not None and high is not None:
		row["display_label"] = f"{low} - {high}"
	elif high is not None:
		row["display_label"] = f"< {high}"
	elif low is not None:
		row["display_label"] = f"> {low}"
	return row


# ---------------------------------------------------------------------------
# Analyte library: aliases match test_name / parameter_name (substring / token)
# ---------------------------------------------------------------------------
# Tuple: (aliases_tuple, parameter_name, unit, min, max, input_type, choices, ranges)
# ranges: list of _band(...) or None

def _q(aliases, name, choices="Non Reactive\nReactive"):
	return (aliases, name, "", None, None, "Choice List", choices, None)


def _d(aliases, name):
	return (aliases, name, "", None, None, "Descriptive Text", None, None)


def _n(aliases, name, unit, low, high, ranges=None):
	return (aliases, name, unit, low, high, "Numeric", None, ranges)


ANALYTE_ROWS = [
	# Haematology
	_n(
		("haemoglobin", "hemoglobin", " lab-hb", "lab hb"),
		"Haemoglobin (Hb)",
		"g/dL",
		12.0,
		17.0,
		[
			_band("Both", 0, 0, 13.5, 19.5, "Newborn 13.5-19.5", m1=1),
			_band("Both", 0, 1, 10.0, 18.0, "Infant"),
			_band("Both", 1, 5, 11.0, 14.0),
			_band("Both", 6, 11, 11.5, 15.5),
			_band("Male", 12, 120, 13.0, 17.0),
			_band("Female", 12, 120, 12.0, 15.0),
		],
	),
	_n(
		("packed cell volume", "hematocrit", "pcv"),
		"Packed Cell Volume (PCV)",
		"%",
		35.0,
		50.0,
		[
			_band("Male", 12, 120, 40.0, 50.0),
			_band("Female", 12, 120, 36.0, 46.0),
			_band("Both", 0, 11, 35.0, 45.0),
		],
	),
	_n(
		("red blood cell", "rbc count", "rbc indices"),
		"Red Blood Cell (RBC) Count",
		"million/µL",
		4.2,
		5.5,
		[
			_band("Male", 12, 120, 4.5, 5.9),
			_band("Female", 12, 120, 4.0, 5.2),
			_band("Both", 0, 11, 3.8, 5.5),
		],
	),
	_n(("mean corpuscular volume", " mcv"), "Mean Corpuscular Volume (MCV)", "fL", 83.0, 101.0),
	_n(("mean corpuscular haemoglobin concentration", "mchc"), "MCHC", "g/dL", 31.5, 34.5),
	_n(("mean corpuscular haemoglobin", " mch"), "MCH", "pg", 27.0, 32.0),
	_n(("red cell distribution", " r d w", "rdw"), "RDW", "%", 11.6, 14.0),
	_n(
		("total wbc", "tlc", "total leucocyte", "white blood"),
		"Total Leucocyte Count (TLC)",
		"cells/µL",
		4000.0,
		11000.0,
		[
			_band("Both", 0, 0, 9000.0, 30000.0, "Neonate", m1=1),
			_band("Both", 0, 1, 6000.0, 17500.0),
			_band("Both", 2, 120, 4000.0, 11000.0),
		],
	),
	_n(
		("platelet count", "platelets count"),
		"Platelet Count",
		"cells/µL",
		150000.0,
		450000.0,
		[_band("Both", 0, 120, 150000.0, 450000.0)],
	),
	_n(("plateletcrit", " pct"), "Plateletcrit (PCT)", "%", 0.2, 0.4),
	_n(("mean platelet volume", "mpv"), "Mean Platelet Volume (MPV)", "fL", 7.0, 11.0),
	_n(("absolute neutrophil",), "Absolute Neutrophil Count", "cells/µL", 2000.0, 7000.0),
	_n(("absolute lymphocyte",), "Absolute Lymphocyte Count", "cells/µL", 1000.0, 3000.0),
	_n(("absolute eosinophil",), "Absolute Eosinophil Count", "cells/µL", 20.0, 500.0),
	_n(("absolute basophil",), "Absolute Basophil Count", "cells/µL", 20.0, 100.0),
	_n(("absolute monocyte",), "Absolute Monocyte Count", "cells/µL", 200.0, 800.0),
	_n(
		("erythrocyte sedimentation", " esr"),
		"ESR",
		"mm/hr",
		0.0,
		20.0,
		[_band("Male", 0, 120, 0.0, 15.0), _band("Female", 0, 120, 0.0, 20.0)],
	),
	_n(("reticulocyte",), "Reticulocyte Count", "%", 0.5, 1.5),
	_n(("bleeding clotting", "bleeding time"), "Bleeding Time", "min", 2.0, 7.0),
	_n(("clotting time",), "Clotting Time", "min", 4.0, 10.0),
	_n(("prothrombin",), "Prothrombin Time (PT)", "sec", 11.0, 13.5),
	_n(("partial thromboplastin", " aptt", " ptt"), "APTT", "sec", 25.0, 40.0),
	_n(("fibrinogen",), "Fibrinogen", "mg/dL", 200.0, 400.0),
	_n(("d dimer", "d (dimer)"), "D-Dimer", "ng/mL", 0.0, 500.0),
	_n(("anti thrombin", "antithrombin"), "Anti Thrombin III Activity", "%", 80.0, 120.0),
	_n(("protein c functional",), "Protein C Activity", "%", 70.0, 140.0),
	_n(("protein s functional",), "Protein S Activity", "%", 60.0, 140.0),
	_n(("factor viii", "factor (viii)"), "Factor VIII Activity", "%", 50.0, 150.0),
	_n(("factor ix", "factor (ix)"), "Factor IX Activity", "%", 50.0, 150.0),
	_n(("von willebrand", "vwf"), "von Willebrand Factor", "%", 50.0, 150.0),
	_n(("g6pd", "glucose-6-phosphate"), "G6PD", "U/g Hb", 6.0, 12.0),
	_n(("haemoglobin a2", "hb a2"), "Haemoglobin A2", "%", 1.5, 3.5),
	_n(("haemoglobin f", "foetal hb", "hb f"), "Haemoglobin F", "%", 0.0, 1.0),
	_n(("haemoglobin a0", "hb a0"), "Haemoglobin A0", "%", 95.0, 98.0),
	# Biochemistry
	_n(("albumin",), "Albumin", "g/dL", 3.5, 5.0),
	_n(("albumin/globulin", "a/g", "a g ratio"), "A/G Ratio", "", 1.1, 2.5),
	_n(("protein total", "total protein", "protein total (serum)"), "Total Protein", "g/dL", 6.3, 8.2),
	_n(
		("alkaline phosphatase", " alp"),
		"Alkaline Phosphatase (ALP)",
		"U/L",
		40.0,
		129.0,
		[
			_band("Both", 0, 1, 80.0, 400.0),
			_band("Both", 1, 12, 100.0, 400.0),
			_band("Both", 13, 17, 50.0, 250.0),
			_band("Male", 18, 120, 40.0, 129.0),
			_band("Female", 18, 120, 35.0, 104.0),
		],
	),
	_n(
		("ggt", "gamma glutamyl"),
		"GGT",
		"U/L",
		5.0,
		40.0,
		[_band("Male", 0, 120, 8.0, 61.0), _band("Female", 0, 120, 5.0, 36.0)],
	),
	_n(
		("sgot", "ast)", "aspartate amino"),
		"AST (SGOT)",
		"U/L",
		8.0,
		48.0,
		[_band("Male", 0, 120, 10.0, 40.0), _band("Female", 0, 120, 9.0, 32.0)],
	),
	_n(
		("sgpt", "alt)", "alanine amino"),
		"ALT (SGPT)",
		"U/L",
		7.0,
		55.0,
		[_band("Male", 0, 120, 10.0, 55.0), _band("Female", 0, 120, 7.0, 30.0)],
	),
	_n(("bilirubin (total)", "bilirubin total", "serum bilirubin"), "Bilirubin Total", "mg/dL", 0.1, 1.2),
	_n(("bilirubin direct", "conjugated"), "Bilirubin Direct", "mg/dL", 0.0, 0.3),
	_n(("bilirubin indirect", "unconjugated"), "Bilirubin Indirect", "mg/dL", 0.2, 1.0),
	_n(("amylase",), "Amylase", "U/L", 28.0, 100.0),
	_n(("lipase",), "Lipase", "U/L", 13.0, 60.0),
	_n(("ammonia",), "Ammonia", "µg/dL", 15.0, 45.0),
	_n(("ada", "adenosine deaminase"), "ADA", "U/L", 0.0, 30.0),
	_n(("ace", "angiotensin converting"), "ACE", "U/L", 8.0, 52.0),
	_n(("ldh", "lactate dehydrogenase"), "LDH", "U/L", 120.0, 250.0),
	_n(
		("cpk", "creatine kinase", "ck nac"),
		"CK (CPK)",
		"U/L",
		30.0,
		200.0,
		[_band("Male", 0, 120, 39.0, 308.0), _band("Female", 0, 120, 26.0, 192.0)],
	),
	_n(("cpk (mb)", "ck mb", "cpk mb"), "CK-MB", "ng/mL", 0.0, 5.0),
	_n(("troponin i",), "Troponin I", "ng/mL", 0.0, 0.04),
	_n(("trop t", "troponin t"), "Troponin T", "ng/mL", 0.0, 0.01),
	_n(("nt pro bnp", "pro bnp"), "NT-proBNP", "pg/mL", 0.0, 125.0),
	_n(("homocystine", "homocysteine"), "Homocysteine", "µmol/L", 5.0, 15.0),
	_n(("fructosamine",), "Fructosamine", "µmol/L", 205.0, 285.0),
	_n(("cystatin",), "Cystatin C", "mg/L", 0.5, 1.0),
	_n(("haptoglobin",), "Haptoglobin", "mg/dL", 30.0, 200.0),
	_n(("ceruloplasmin",), "Ceruloplasmin", "mg/dL", 20.0, 60.0),
	_n(("copper",), "Copper", "µg/dL", 70.0, 140.0),
	_n(("zinc",), "Zinc", "µg/dL", 70.0, 120.0),
	_n(("magnesium",), "Magnesium", "mg/dL", 1.6, 2.6),
	_n(("phosphorus", "inorganic phosphorus"), "Phosphorus", "mg/dL", 2.5, 4.5),
	_n(("chloride",), "Chloride", "mEq/L", 98.0, 107.0),
	_n(("bicarbonate", "hco3"), "Bicarbonate", "mEq/L", 22.0, 29.0),
	_n(("sodium",), "Sodium", "mEq/L", 136.0, 145.0),
	_n(("potassium",), "Potassium", "mEq/L", 3.5, 5.1),
	_n(("calcium ionized",), "Ionized Calcium", "mg/dL", 4.6, 5.3),
	_n(("calcium",), "Calcium", "mg/dL", 8.6, 10.2),
	_n(
		("creatinine",),
		"Creatinine",
		"mg/dL",
		0.6,
		1.2,
		[
			_band("Both", 0, 0, 0.3, 1.0, "Neonate", m1=1),
			_band("Both", 0, 12, 0.3, 0.7),
			_band("Male", 13, 120, 0.7, 1.3),
			_band("Female", 13, 120, 0.5, 1.1),
		],
	),
	_n(
		("uric acid", "uric (lab-uric"),
		"Uric Acid",
		"mg/dL",
		3.5,
		7.2,
		[_band("Male", 0, 120, 3.5, 7.2), _band("Female", 0, 120, 2.6, 6.0)],
	),
	_n(
		("urea", "bun", "blood urea"),
		"Urea",
		"mg/dL",
		15.0,
		40.0,
		[
			_band("Both", 0, 0, 7.0, 28.0, "0-14d", d1=14),
			_band("Both", 0, 1, 11.0, 36.0),
			_band("Both", 1, 120, 15.0, 40.0),
		],
	),
	_n(("glucose fasting", "fbs"), "Glucose Fasting", "mg/dL", 70.0, 99.0),
	_n(("glucose post", "ppbs", "postparandial", "post prandial"), "Glucose PP", "mg/dL", 70.0, 140.0),
	_n(("glucose (random)", "glucose random"), "Glucose Random", "mg/dL", 70.0, 140.0),
	_n(("hba1c", "glycosylated", "glycated", "hb%"), "HbA1c", "%", None, 5.6),
	_n(("cholesterol (total)", "cholesterol total", "total cholesterol"), "Total Cholesterol", "mg/dL", None, 200.0),
	_n(("triglycerides",), "Triglycerides", "mg/dL", None, 150.0),
	_n(("high density", "hdl"), "HDL Cholesterol", "mg/dL", 40.0, None),
	_n(("low density", "ldl"), "LDL Cholesterol", "mg/dL", None, 100.0),
	_n(("lipoprotein a", "lp(a)"), "Lipoprotein(a)", "mg/dL", None, 30.0),
	_n(("apolipoprotein (a1)", "apolipoprotein a1"), "Apolipoprotein A1", "mg/dL", 110.0, 180.0),
	_n(("apolipoprotein b",), "Apolipoprotein B", "mg/dL", 60.0, 130.0),
	_n(("apolipo a1 b",), "Apo A1 / Apo B", "", None, None),
	_n(
		("iron",),
		"Iron, Serum",
		"µg/dL",
		60.0,
		170.0,
		[_band("Male", 0, 120, 65.0, 175.0), _band("Female", 0, 120, 50.0, 170.0)],
	),
	_n(("tibc", "total iron binding", "iron binding capacity"), "TIBC", "µg/dL", 250.0, 450.0),
	_n(("transferrin",), "Transferrin", "mg/dL", 200.0, 360.0),
	_n(
		("ferritin",),
		"Ferritin",
		"ng/mL",
		30.0,
		400.0,
		[_band("Male", 0, 120, 30.0, 400.0), _band("Female", 0, 120, 15.0, 150.0)],
	),
	_n(("bile acids",), "Total Bile Acids", "µmol/L", 0.0, 10.0),
	_n(("osmolality (serum)",), "Serum Osmolality", "mOsm/kg", 275.0, 295.0),
	_n(("osmolality (urine)",), "Urine Osmolality", "mOsm/kg", 50.0, 1200.0),
	_n(("gfr", "egfr"), "eGFR", "mL/min/1.73m²", 90.0, None),
	_n(("creatinine clearance",), "Creatinine Clearance", "mL/min", 90.0, 130.0),
	# Hormones
	_n(
		("thyroid stimulating hormone", " tsh", "thyroid profile (tsh)"),
		"TSH",
		"µIU/mL",
		0.4,
		4.0,
		[
			_band("Both", 0, 0, 1.0, 39.0, "0-1d", d1=1),
			_band("Both", 0, 0, 1.0, 17.0, "1-4d", d0=1, d1=4),
			_band("Both", 0, 0, 1.7, 9.1, "2-20wk", m0=0, m1=5),
			_band("Both", 0, 20, 0.7, 6.4),
			_band("Both", 21, 120, 0.4, 4.0),
		],
	),
	_n(("free thyroxine", "ft4"), "Free T4", "ng/dL", 0.8, 1.8),
	_n(("free triiodothyronine", "ft3"), "Free T3", "pg/mL", 2.3, 4.2),
	_n(("triiodothyronine", "total (tt3)", " t3 "), "Total T3", "ng/dL", 80.0, 200.0),
	_n(("thyroxine", "total (tt4)", " t4 "), "Total T4", "µg/dL", 4.5, 12.0),
	_n(("thyroglobulin ab", "anti thyroglobulin", "anti tg"), "Anti-Thyroglobulin Ab", "IU/mL", None, 40.0),
	_n(("thyroid peroxidase", "tpo"), "Anti-TPO Ab", "IU/mL", None, 34.0),
	_n(("tsh receptor", "trab"), "TRAb", "IU/L", None, 1.75),
	_n(("thyroglobulin",), "Thyroglobulin", "ng/mL", 1.4, 78.0),
	_n(("para thyroid", "parathyroid", "pth"), "PTH Intact", "pg/mL", 15.0, 65.0),
	_n(
		("cortisol m", "cortisol morning"),
		"Cortisol (Morning)",
		"µg/dL",
		6.0,
		23.0,
	),
	_n(("cortisol e", "cortisol evening"), "Cortisol (Evening)", "µg/dL", 3.0, 15.0),
	_n(("acth", "adrenocorticotropic"), "ACTH", "pg/mL", 7.0, 63.0),
	_n(
		("testosterone",),
		"Testosterone Total",
		"ng/mL",
		2.5,
		8.5,
		[_band("Male", 18, 120, 2.5, 8.5), _band("Female", 18, 120, 0.1, 0.9)],
	),
	_n(
		("free testosterone",),
		"Free Testosterone",
		"pg/mL",
		50.0,
		210.0,
		[_band("Male", 18, 120, 50.0, 210.0), _band("Female", 18, 120, 1.0, 8.5)],
	),
	_n(
		("estradiol", "e2"),
		"Estradiol (E2)",
		"pg/mL",
		30.0,
		400.0,
		[
			_band("Male", 0, 120, 10.0, 40.0),
			_band("Female", 0, 120, 30.0, 400.0, "Follicular/Luteal approx"),
		],
	),
	_n(("estriol",), "Unconjugated Estriol", "ng/mL", 0.0, 1.0),
	_n(
		("progesterone",),
		"Progesterone",
		"ng/mL",
		0.2,
		25.0,
		[
			_band("Female", 0, 120, 0.2, 1.5, "Follicular"),
			_band("Female", 0, 120, 1.5, 25.0, "Luteal"),
			_band("Male", 0, 120, 0.1, 1.0),
		],
	),
	_n(
		("prolactin",),
		"Prolactin",
		"ng/mL",
		2.0,
		25.0,
		[_band("Male", 0, 120, 2.0, 18.0), _band("Female", 0, 120, 2.0, 29.0)],
	),
	_n(
		("folicle stimulating", "follicle stimulating", " fsh"),
		"FSH",
		"mIU/mL",
		1.5,
		12.0,
		[
			_band("Male", 0, 120, 1.5, 12.4),
			_band("Female", 0, 120, 2.5, 10.2, "Follicular"),
			_band("Female", 0, 120, 25.8, 134.8, "Post-menopausal"),
		],
	),
	_n(
		("luteinizing", " lh"),
		"LH",
		"mIU/mL",
		1.0,
		10.0,
		[
			_band("Male", 0, 120, 1.0, 9.0),
			_band("Female", 0, 120, 1.9, 12.5, "Follicular"),
			_band("Female", 0, 120, 14.0, 52.0, "Post-menopausal"),
		],
	),
	_n(("amh", "mullerian"), "AMH", "ng/mL", 1.0, 4.0),
	_n(("dheas", "dehydroepiandrosterone"), "DHEA-S", "µg/dL", 35.0, 430.0),
	_n(("androstenedione",), "Androstenedione", "ng/mL", 0.3, 3.1),
	_n(("alpha dihydrotestosterone", " dht"), "DHT", "pg/mL", 112.0, 955.0),
	_n(("17 alpha hydroxy", "ohp"), "17-OH Progesterone", "ng/mL", 0.2, 1.3),
	_n(("aldosterone",), "Aldosterone", "ng/dL", 4.0, 31.0),
	_n(("growth hormone",), "Growth Hormone", "ng/mL", 0.0, 5.0),
	_n(("igf", "somatomedin"), "IGF-1", "ng/mL", 50.0, 350.0),
	_n(("shbg", "sex hormone binding"), "SHBG", "nmol/L", 10.0, 80.0),
	_n(("insulin assay (fasting)", "insulin (fasting)", "insulin fasting"), "Insulin Fasting", "µU/mL", 2.0, 25.0),
	_n(("insulin assay (pp)", "insulin(pp)", "insulin pp"), "Insulin PP", "µU/mL", 5.0, 55.0),
	_n(("insulin (random)", "insulin random"), "Insulin Random", "µU/mL", 2.0, 25.0),
	_n(("c peptide",), "C-Peptide", "ng/mL", 0.8, 3.5),
	_n(("beta", "beta hcg", "hcg"), "Beta hCG", "mIU/mL", None, 5.0),
	_n(("free beta",), "Free Beta hCG", "ng/mL", None, None),
	_n(("erythropoietin", "epo"), "EPO", "mIU/mL", 2.6, 18.5),
	# Vitamins / markers
	_n(("vitamin (b12)", "vitamin b12", "b12"), "Vitamin B12", "pg/mL", 200.0, 900.0),
	_n(("folate", "folic acid"), "Folate", "ng/mL", 3.0, 20.0),
	_n(("vitamin d3", "25 (oh)", "25 oh"), "25-OH Vitamin D", "ng/mL", 30.0, 100.0),
	_n(("1 25 dihydroxy", "1,25"), "1,25-Dihydroxy Vitamin D", "pg/mL", 18.0, 72.0),
	_n(("vitamin a", "retinol"), "Vitamin A", "µg/dL", 20.0, 60.0),
	_n(("vitamin e",), "Vitamin E", "mg/L", 5.0, 20.0),
	_n(("vitamin c",), "Vitamin C", "mg/dL", 0.4, 2.0),
	_n(("vitamin b1", "thiamine"), "Vitamin B1", "nmol/L", 70.0, 180.0),
	_n(("vitamin b6", "pyridoxine"), "Vitamin B6", "nmol/L", 20.0, 120.0),
	_n(("psa", "prostatic specific", "prostate specific"), "PSA Total", "ng/mL", None, 4.0),
	_n(("cea", "carcino embryonic"), "CEA", "ng/mL", None, 5.0),
	_n(("afp", "alpha fetoprotein", "fetoprotein"), "AFP", "ng/mL", None, 10.0),
	_n(("ca 125",), "CA-125", "U/mL", None, 35.0),
	_n(("ca 15.3", "ca 15-3"), "CA 15-3", "U/mL", None, 30.0),
	_n(("ca 19.9", "ca 19-9"), "CA 19-9", "U/mL", None, 37.0),
	_n(("ca 72.4", "ca 72-4"), "CA 72-4", "U/mL", None, 6.9),
	_n(("he4",), "HE4", "pmol/L", None, 140.0),
	_n(("beta 2 microglobulin",), "Beta-2 Microglobulin", "mg/L", 0.8, 2.4),
	_n(("crp", "c-reactive", "c reactive"), "CRP", "mg/L", None, 5.0),
	_n(("procalcitonin",), "Procalcitonin", "ng/mL", None, 0.5),
	_n(("interleukin 6", "il-6", "il6"), "IL-6", "pg/mL", None, 7.0),
	_n(("aso", "streptolysin"), "ASO Titre", "IU/mL", None, 200.0),
	_n(("ra factor", " rheumatoid", " ra"), "RA Factor", "IU/mL", None, 14.0),
	_n(("ccp antibody", "anti- ccp", "anti ccp"), "Anti-CCP", "U/mL", None, 20.0),
	_n(("c3", "complement 3"), "Complement C3", "mg/dL", 90.0, 180.0),
	_n(("c4", "complement 4"), "Complement C4", "mg/dL", 10.0, 40.0),
	_n(("ige", "total ige"), "Total IgE", "IU/mL", None, 100.0),
	_n(("immunoglobulin (iga)", "immunoglobulin iga"), "IgA", "mg/dL", 70.0, 400.0),
	_n(("immunoglobulin (igg)", "immunoglobulin igg"), "IgG", "mg/dL", 700.0, 1600.0),
	_n(("immunoglobulin (igm)", "immunoglobulin igm"), "IgM", "mg/dL", 40.0, 230.0),
	_n(("igg4",), "IgG4", "mg/dL", 3.0, 200.0),
	_n(("lithium",), "Lithium", "mmol/L", 0.6, 1.2),
	_n(("digoxin",), "Digoxin", "ng/mL", 0.8, 2.0),
	_n(("carbamazepine", "tegretol"), "Carbamazepine", "µg/mL", 4.0, 12.0),
	_n(("phenytoin", "eptoin"), "Phenytoin", "µg/mL", 10.0, 20.0),
	_n(("phenobarbitone",), "Phenobarbitone", "µg/mL", 15.0, 40.0),
	_n(("valproic",), "Valproic Acid", "µg/mL", 50.0, 100.0),
	_n(("cyclosporin",), "Cyclosporine", "ng/mL", 100.0, 400.0),
	_n(("tacrolimus",), "Tacrolimus", "ng/mL", 5.0, 15.0),
	_n(("fecal calprotectin", "calprotectin"), "Fecal Calprotectin", "µg/g", None, 50.0),
	_n(("acid phosphatase",), "Prostatic Acid Phosphatase", "U/L", None, 3.5),
	_n(("blood (ph)", "blood ph"), "Blood pH", "", 7.35, 7.45),
	_n(("albumin (urine)", "microalbumin"), "Urine Albumin", "mg/L", None, 30.0),
	_n(("urine for protein 24", "protein 24"), "24h Urine Protein", "mg/day", None, 150.0),
	_n(("urine for calcium",), "24h Urine Calcium", "mg/day", 100.0, 300.0),
	_n(("urine for creatinine 24",), "24h Urine Creatinine", "mg/day", 500.0, 2000.0),
	_n(("urine for uric",), "Urine Uric Acid", "mg/day", 250.0, 750.0),
	_n(("microalbumin creatinine",), "ACR", "mg/g", None, 30.0),
	_n(("vma", "vanil mandelic"), "VMA", "mg/day", None, 8.0),
	_n(("metanephrine",), "Metanephrines", "pg/mL", None, 100.0),
	# Qualitative / serology
	_q(("hiv",), "HIV 1 & 2 Antibody"),
	_q(("hbsag",), "HBsAg"),
	_q(("hbsab", "hbs antibody", "hbs ab"), "Anti-HBs"),
	_q(("hbeag",), "HBeAg"),
	_q(("hbeab",), "Anti-HBe"),
	_q(("hbcab", "anti-hbc", "hepatitis b core"), "Anti-HBc"),
	_q(("hcv", "hepatitis c"), "Anti-HCV"),
	_q(("hav", "hepatitis a"), "HAV Antibody"),
	_q(("hev", "hepatitis e"), "HEV Antibody"),
	_q(("dengue",), "Dengue Antibody / Antigen"),
	_q(("chikungunya",), "Chikungunya Antibody"),
	_q(("covid", "sars"), "COVID-19 Result"),
	_q(("vdrl", "syphilis", "tpha", "fta"), "Syphilis Serology"),
	_q(("widal", "typhidot", "typhoid", "salmonella"), "Typhoid Serology"),
	_q(("malaria",), "Malaria Antigen / Parasite"),
	_q(("filaria",), "Filaria Antigen"),
	_q(("leptospira",), "Leptospira Antibody"),
	_q(("scrub typhus",), "Scrub Typhus Antibody"),
	_q(("rubella",), "Rubella Antibody"),
	_q(("toxoplasma",), "Toxoplasma Antibody"),
	_q(("cmv",), "CMV Antibody"),
	_q(("hsv", "herpes"), "HSV Antibody"),
	_q(("varicella",), "VZV Antibody"),
	_q(("h pylori",), "H. pylori Antibody"),
	_q(("anca",), "ANCA"),
	_q(("ana", "antinuclear", "anti nuclear"), "ANA"),
	_q(("coombs",), "Coombs Test"),
	_q(("pregnancy", "upt"), "Urine Pregnancy Test"),
	_q(("afb", "acid fast", "zn stain", "zn "), "AFB Stain"),
	_q(("gram",), "Gram Stain"),
	_q(("koh", "fungal stain"), "KOH / Fungal Stain"),
	_q(("mantoux",), "Mantoux Test"),
	_q(("quantiferon",), "QuantiFERON-TB Gold"),
	_q(("hla b27", "b27"), "HLA-B27"),
	_q(("p24",), "HIV p24 Antigen"),
	_q(("alcohol screen",), "Alcohol Screen"),
	_q(("drug of abuse",), "Drug of Abuse Panel"),
	_q(("stool occult",), "Occult Blood"),
	_q(("urine sugar", "urine for (ketone)", "reducing substance"), "Urine Qualitative"),
	_q(("bence jones",), "Bence Jones Protein"),
	_d(("culture",), "Culture Report"),
	_d(("biopsy", "histopath", "cytology", "cell (block)", "slide for opinion"), "Histopathology / Cytology Report"),
	_d(("pap smear", "papanicolaou", "liquid based", "lbc"), "PAP / LBC Report"),
	_d(("peripheral smear", "peripheral blood"), "Peripheral Smear Findings"),
	_d(("semen analysis",), "Semen Analysis"),
	_d(("karyotype", "chromosome"), "Karyotype Report"),
	_d(("nipt",), "NIPT Report"),
	_d(("pcr", "genexpert", "rna quantification", "dna quantification", "viral load"), "Molecular / PCR Report"),
	_d(("body fluid", "stool for", "sputum", "pus routine"), "Routine Examination"),
]


def _compile_catalog():
	compiled = []
	for aliases, name, unit, low, high, itype, choices, ranges in ANALYTE_ROWS:
		compiled.append(
			{
				"aliases": tuple(_norm(a) for a in aliases),
				"parameter_name": name,
				"unit": unit or "",
				"normal_min": low,
				"normal_max": high,
				"result_input_type": itype,
				"choice_options": choices,
				"ranges": ranges or [],
			}
		)
	return compiled


CATALOG = None


def get_catalog():
	global CATALOG
	if CATALOG is None:
		CATALOG = _compile_catalog()
	return CATALOG


def match_analyte(text):
	"""Best catalog match for a master or parameter name."""
	n = _norm(text)
	if not n:
		return None
	best = None
	best_score = 0
	for row in get_catalog():
		for alias in row["aliases"]:
			if not alias:
				continue
			score = 0
			if n == alias:
				score = 100
			elif alias in n:
				score = 50 + min(len(alias), 40)
			elif n in alias and len(n) >= 4:
				score = 30 + len(n)
			if score > best_score:
				best_score = score
				best = row
	return best if best_score >= 30 else None


def _param_row_from_analyte(analyte, override_name=None):
	name = override_name or analyte["parameter_name"]
	row = {
		"parameter_code": _code(name),
		"parameter_name": name,
		"unit": analyte.get("unit") or "",
		"normal_min": analyte.get("normal_min"),
		"normal_max": analyte.get("normal_max"),
		"result_input_type": analyte.get("result_input_type") or "Numeric",
		"parameter_kind": "Real",
		"is_calculated": 0,
	}
	if analyte.get("choice_options"):
		row["choice_options"] = analyte["choice_options"]
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase96_method_machine import (
			resolve_method_and_machine,
		)

		method, machine = resolve_method_and_machine(row["parameter_code"], name, 0)
		row["method"] = method
		row["machine_name"] = machine
	except Exception:
		pass
	return row


def _bounds_missing(low, high):
	"""True when both bounds are blank or zero placeholders."""
	l = None if low in (None, "") else flt(low)
	h = None if high in (None, "") else flt(high)
	if l is None and h is None:
		return True
	if l == 0 and h == 0:
		return True
	return False


def _skip_zero_fill(param_name):
	n = _norm(param_name)
	skip = (
		"blast",
		"myelocyte",
		"promyelocyte",
		"meta myelocyte",
		"prolymphocyte",
		"atypical",
		"nrbc",
		"heading",
	)
	return any(s in n for s in skip)


def _range_rows_for_param(analyte, param_code, param_name):
	out = []
	for band in analyte.get("ranges") or []:
		r = dict(band)
		r["parameter_code"] = param_code
		r["parameter_name"] = param_name
		out.append(r)
	return out


def _profile_rows_for_master(doc):
	"""Reuse Apollo profile catalogs when the master name matches a panel."""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase56_lab_parameters import (
			match_apollo_profile,
		)
	except Exception:
		return None, None
	item_name = doc.test_name or doc.name
	item_code = getattr(doc, "item", None) or ""
	rows, category, source = match_apollo_profile(item_name, item_code=item_code)
	if not rows:
		# also try item_name from Item
		if item_code and frappe.db.exists("Item", item_code):
			iname = frappe.db.get_value("Item", item_code, "item_name")
			rows, category, source = match_apollo_profile(iname, item_code=item_code)
	return rows, category


def fill_one_master(doc_or_name, *, dry_run=False):
	"""Fill missing parameters / bounds / age-sex ranges for one master."""
	doc = (
		frappe.get_doc("Diagnostic Test Master", doc_or_name)
		if isinstance(doc_or_name, str)
		else doc_or_name
	)
	changed = {
		"name": doc.name,
		"added_params": 0,
		"filled_bounds": 0,
		"added_ranges": 0,
		"enabled_age": 0,
		"skipped": 0,
	}

	# Never overwrite maternal serum screening composites (Double / Dual / Triple / Quad).
	probe = f"{doc.name} {getattr(doc, 'item', '')} {getattr(doc, 'test_name', '')}".lower()
	if any(
		k in probe
		for k in (
			"double marker",
			"dual marker",
			"triple marker",
			"quadruple",
			"quad marker",
			"maternal screen",
			"allergy profile",
			"allergy panel",
			"atopic allergy",
		)
	):
		changed["skipped"] = 1
		return changed

	# 1) Ensure at least one parameter
	if not (doc.parameters or []):
		profile_rows, category = _profile_rows_for_master(doc)
		if profile_rows:
			for row in profile_rows:
				doc.append("parameters", row)
				changed["added_params"] += 1
			if category and not doc.report_category:
				doc.report_category = category
		else:
			analyte = match_analyte(doc.test_name or doc.name)
			if analyte:
				doc.append("parameters", _param_row_from_analyte(analyte, doc.test_name))
				changed["added_params"] += 1
			else:
				# Heuristic fallback
				n = _norm(doc.test_name or doc.name)
				if any(k in n for k in ("culture", "biopsy", "smear", "cytolog", "histopath", "karyotype")):
					doc.append(
						"parameters",
						{
							"parameter_code": _code(doc.name),
							"parameter_name": doc.test_name or doc.name,
							"result_input_type": "Descriptive Text",
							"parameter_kind": "Real",
							"is_calculated": 0,
						},
					)
				elif any(
					k in n
					for k in (
						"antibody",
						"antigen",
						"igg",
						"igm",
						"iga",
						"serology",
						"rapid",
						"elisa",
						"cmia",
					)
				):
					doc.append(
						"parameters",
						{
							"parameter_code": _code(doc.name),
							"parameter_name": doc.test_name or doc.name,
							"result_input_type": "Choice List",
							"choice_options": "Non Reactive\nReactive",
							"parameter_kind": "Real",
							"is_calculated": 0,
						},
					)
				else:
					doc.append(
						"parameters",
						{
							"parameter_code": _code(doc.name),
							"parameter_name": doc.test_name or doc.name,
							"result_input_type": "Numeric",
							"parameter_kind": "Real",
							"is_calculated": 0,
						},
					)
				changed["added_params"] += 1

	# 2) Fill missing numeric bounds + collect age/sex bands
	new_ranges = []
	existing_keys = {
		(
			_norm(getattr(r, "parameter_code", None) or getattr(r, "parameter_name", None)),
			(getattr(r, "gender", None) or "Both"),
			cint(getattr(r, "age_from_years", 0)),
			cint(getattr(r, "age_to_years", 0)),
			flt(getattr(r, "normal_min", None)),
			flt(getattr(r, "normal_max", None)),
		)
		for r in (doc.reference_ranges or [])
	}

	for param in doc.parameters or []:
		itype = (getattr(param, "result_input_type", None) or "Numeric").strip()
		if itype not in ("Numeric", "Table Value", ""):
			continue
		analyte = match_analyte(param.parameter_name) or match_analyte(param.parameter_code)
		if not analyte:
			analyte = match_analyte(doc.test_name or doc.name)
		if not analyte:
			continue
		if _bounds_missing(param.normal_min, param.normal_max) and not _skip_zero_fill(
			param.parameter_name
		):
			if analyte.get("normal_min") is not None or analyte.get("normal_max") is not None:
				param.normal_min = analyte.get("normal_min")
				param.normal_max = analyte.get("normal_max")
				if not param.unit and analyte.get("unit"):
					param.unit = analyte["unit"]
				changed["filled_bounds"] += 1
		# Age/sex bands
		code = (param.parameter_code or _code(param.parameter_name)).strip()
		for band in _range_rows_for_param(analyte, code, param.parameter_name):
			key = (
				_norm(code),
				band.get("gender") or "Both",
				cint(band.get("age_from_years")),
				cint(band.get("age_to_years")),
				flt(band.get("normal_min")),
				flt(band.get("normal_max")),
			)
			if key in existing_keys:
				continue
			existing_keys.add(key)
			new_ranges.append(band)

	for band in new_ranges:
		doc.append("reference_ranges", band)
		changed["added_ranges"] += 1

	if (doc.reference_ranges or []) and not cint(getattr(doc, "uses_age_related_ranges", 0)):
		doc.uses_age_related_ranges = 1
		changed["enabled_age"] = 1

	if dry_run:
		return changed

	if (
		changed["added_params"]
		or changed["filled_bounds"]
		or changed["added_ranges"]
		or changed["enabled_age"]
	):
		doc.flags.ignore_permissions = True
		doc.save(ignore_permissions=True)
	return changed


def sync_all_diagnostic_references(limit=None, dry_run=0, only_missing_params=0):
	"""Walk all Diagnostic Test Masters and fill gaps. Returns summary dict."""
	dry_run = cint(dry_run)
	only_missing = cint(only_missing_params)
	names = frappe.get_all(
		"Diagnostic Test Master",
		filters={"disabled": 0} if frappe.get_meta("Diagnostic Test Master").has_field("disabled") else None,
		pluck="name",
		order_by="name asc",
	)
	if limit:
		names = names[: cint(limit)]

	summary = {
		"ok": True,
		"scanned": 0,
		"updated": 0,
		"added_params": 0,
		"filled_bounds": 0,
		"added_ranges": 0,
		"enabled_age": 0,
		"samples": [],
		"source": SOURCE,
		"dry_run": dry_run,
	}

	for name in names:
		doc = frappe.get_doc("Diagnostic Test Master", name)
		if only_missing and (doc.parameters or []):
			# still allow bound/range fill
			pass
		summary["scanned"] += 1
		try:
			res = fill_one_master(doc, dry_run=bool(dry_run))
		except Exception:
			frappe.log_error(title="phase110_dtm_fill", message=frappe.get_traceback())
			continue
		touched = res["added_params"] or res["filled_bounds"] or res["added_ranges"] or res["enabled_age"]
		if touched:
			summary["updated"] += 1
			summary["added_params"] += res["added_params"]
			summary["filled_bounds"] += res["filled_bounds"]
			summary["added_ranges"] += res["added_ranges"]
			summary["enabled_age"] += res["enabled_age"]
			if len(summary["samples"]) < 25:
				summary["samples"].append(res)

	if not dry_run:
		frappe.db.commit()
		frappe.clear_cache()
	return summary


def audit_diagnostic_reference_gaps(limit=50):
	"""Quick gap report for Desk / bench."""
	masters = frappe.get_all("Diagnostic Test Master", fields=["name"], order_by="name", limit_page_length=2000)
	no_params = []
	zero_bounds = []
	for m in masters:
		pc = frappe.db.count("Diagnostic Test Parameter", {"parent": m.name})
		if pc == 0:
			no_params.append(m.name)
			continue
		rows = frappe.get_all(
			"Diagnostic Test Parameter",
			filters={"parent": m.name},
			fields=["parameter_name", "normal_min", "normal_max", "result_input_type"],
		)
		for r in rows:
			if (r.result_input_type or "Numeric") not in ("Numeric", "Table Value", ""):
				continue
			if _bounds_missing(r.normal_min, r.normal_max) and not _skip_zero_fill(r.parameter_name):
				zero_bounds.append(f"{m.name} :: {r.parameter_name}")
				break
	return {
		"masters": len(masters),
		"no_params": len(no_params),
		"no_params_sample": no_params[: cint(limit)],
		"masters_with_blank_bounds": len(zero_bounds),
		"blank_bounds_sample": zero_bounds[: cint(limit)],
		"catalog_size": len(get_catalog()),
	}
