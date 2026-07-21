"""Phase 57 — Scientific literature interpretations for lab reports.

Populates Diagnostic Test Master.interpretation (and Item.hec_lab_interpretation)
with clinician-oriented text and peer-reviewed / guideline citations.
Rendered below each test block on the NABL-style Lab Report printout.
"""

from __future__ import annotations

import re

import frappe
from frappe.utils import cint

from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import LAB_ITEM_GROUP

# ---------------------------------------------------------------------------
# Curated interpretations (literature-backed). Citations are real PubMed /
# guideline references used in clinical laboratory medicine.
# ---------------------------------------------------------------------------

INTERP_ALT_SGPT = """
<p>The Serum Glutamic Pyruvic Transaminase test, also known as the SGPT or alanine
aminotransferase (ALT) test, measures GPT/ALT activity in the bloodstream. ALT is
an enzyme concentrated in hepatocytes and is also present in kidney, heart, and
muscle cells; in clinical practice it is used primarily to evaluate hepatocellular
injury and to monitor liver health.</p>
<p>Isolated or combined ALT elevations should be interpreted with the remainder of
the liver chemistry panel (AST, ALP, bilirubin, albumin) and the clinical context.
Marked elevations may be seen in acute viral hepatitis, ischemic hepatitis, or
severe drug-induced liver injury, whereas mild persistent elevations are commonly
associated with metabolic dysfunction–associated steatotic liver disease and other
chronic liver conditions. Results must be correlated with the laboratory-specific
reference interval.</p>
<p><em>References:</em> Lala V, Zubair M, Minter DA. Liver Function Tests. StatPearls.
NCBI Bookshelf NBK482489. · Moriles KE, Azer SA. Alanine Aminotransferase (ALT) Test.
StatPearls. NCBI Bookshelf NBK559278. · Kwo PY, Cohen SM, Lim JK. ACG Clinical Guideline:
Evaluation of Abnormal Liver Chemistries. Am J Gastroenterol. 2017;112(1):18-35.
PubMed PMID: 27995906.</p>
"""

INTERP_AST_SGOT = """
<p>Aspartate aminotransferase (AST), formerly SGOT, is an aminotransferase present
in liver, cardiac, and skeletal muscle tissue. Elevation indicates tissue injury;
when interpreted with ALT, the AST:ALT ratio and the broader liver panel help
distinguish hepatocellular from cholestatic patterns of injury.</p>
<p>AST is less liver-specific than ALT. Marked elevations occur in acute hepatitis
and ischemic injury; milder changes occur in NAFLD, alcohol-related liver disease,
and myopathies. Clinical correlation is required.</p>
<p><em>References:</em> Lala V et al. Liver Function Tests. StatPearls NBK482489. ·
Kwo PY et al. ACG Clinical Guideline: Evaluation of Abnormal Liver Chemistries.
Am J Gastroenterol. 2017;112:18-35. PMID: 27995906.</p>
"""

INTERP_LFT = """
<p>Liver chemistry panels (often called LFTs) typically include ALT, AST, ALP,
bilirubin fractions, total protein, albumin, and sometimes GGT. These assays do not
measure a single “liver function” but rather patterns of hepatocyte injury,
cholestasis, and synthetic capacity.</p>
<p>Hepatocellular injury shows predominant AST/ALT rise; cholestatic injury shows
predominant ALP/bilirubin rise. Albumin and coagulation tests better reflect true
hepatic synthetic function. Abnormal results warrant clinical review and, when
indicated, etiologic work-up for viral, metabolic, autoimmune, or biliary disease.</p>
<p><em>References:</em> Lala V et al. Liver Function Tests. StatPearls NBK482489. ·
Kwo PY et al. ACG Clinical Guideline: Evaluation of Abnormal Liver Chemistries.
Am J Gastroenterol. 2017;112:18-35. PMID: 27995906. · Cleveland Clinic Center for
Continuing Education. Guide to Commonly Used Liver Tests.</p>
"""

INTERP_LIPID = """
<p>A fasting or non-fasting lipid profile quantifies total cholesterol, LDL-C,
HDL-C, triglycerides, and derived indices (non–HDL-C, cholesterol/HDL ratio). It is
central to atherosclerotic cardiovascular disease (ASCVD) risk assessment and to
monitoring lipid-lowering therapy.</p>
<p>Elevated LDL-C and non–HDL-C are causal risk factors for ASCVD; low HDL-C and
high triglycerides further refine residual risk. Guideline-directed care uses the
lipid panel together with clinical risk estimators rather than any single cutoff
in isolation.</p>
<p><em>References:</em> Grundy SM et al. 2018 AHA/ACC/AACVPR/AAPA/ABC/ACPM/ADA/AGS/
APhA/ASPC/NLA/PCNA Guideline on the Management of Blood Cholesterol. Circulation.
2019;139:e1082-e1143. PMID: 30586774. · ACC/AHA Joint Committee. Guideline on the
Management of Dyslipidemia. JACC. 2026. DOI: 10.1016/j.jacc.2025.11.016.</p>
"""

INTERP_CBC = """
<p>A complete blood count (CBC) enumerates circulating red cells, white cells, and
platelets and provides red-cell indices (MCV, MCH, MCHC, RDW) and leukocyte
differentials. It is a first-line investigation for anaemia, infection, inflammation,
marrow disorders, and bleeding risk.</p>
<p>Abnormal haemoglobin or haematocrit suggests anaemia or polycythaemia; leukocyte
and differential shifts support infection or haematologic disease; thrombocytopenia
or thrombocytosis guides haemostasis assessment. CBC-derived ratios (e.g., NLR) are
increasingly studied as inexpensive inflammatory markers but do not replace clinical
judgment.</p>
<p><em>References:</em> Seo IH, Lee YJ. Usefulness of Complete Blood Count (CBC) to
Assess Cardiovascular and Metabolic Diseases: A Comprehensive Literature Review.
Biomedicines. 2022;10(11):2697. PMID: 36359217. · Tefferi A et al. How to interpret
and pursue an abnormal complete blood cell count in adults. Mayo Clin Proc.
2005;80(7):923-936. PMID: 16007898.</p>
"""

INTERP_HBA1C = """
<p>Glycated haemoglobin (HbA1c) reflects average glycaemia over approximately
2–3 months and is used for diagnosis of diabetes/prediabetes and for monitoring
glycaemic control. Estimated average glucose (eAG) translates HbA1c into an
approximate mean plasma glucose.</p>
<p>ADA diagnostic cut-offs commonly cite HbA1c ≥6.5% for diabetes and 5.7–6.4% for
prediabetes, with confirmation as clinically indicated. Conditions that alter
erythrocyte turnover (haemolysis, recent transfusion, haemoglobinopathies) can
discordantly affect HbA1c and require alternative glucose metrics.</p>
<p><em>References:</em> American Diabetes Association Professional Practice Committee.
Standards of Care in Diabetes—Diagnosis and Classification of Diabetes. Diabetes Care
(annual Standards of Care). · Nathan DM et al. Translating the A1C assay into
estimated average glucose values. Diabetes Care. 2008;31(8):1473-1478. PMID: 18540046.</p>
"""

INTERP_TSH_THYROID = """
<p>Thyroid-stimulating hormone (TSH) is the primary screening test for thyroid
dysfunction. Free T4 (and sometimes free T3) refine whether dysfunction is primary
hypothyroidism, hyperthyroidism, or a central disorder.</p>
<p>Elevated TSH with low free T4 indicates primary hypothyroidism; suppressed TSH
with high free T4/T3 supports thyrotoxicosis. Subclinical patterns require repeat
testing and clinical correlation before treatment decisions.</p>
<p><em>References:</em> Ross DS et al. 2016 American Thyroid Association Guidelines
for Diagnosis and Management of Hyperthyroidism. Thyroid. 2016;26(10):1343-1421.
PMID: 27521067. · Jonklaas J et al. Guidelines for the Treatment of Hypothyroidism.
Thyroid. 2014;24(12):1670-1751. PMID: 25266247.</p>
"""

INTERP_KFT = """
<p>Kidney function panels commonly include urea/BUN, creatinine, uric acid, and
often electrolytes and albumin. Serum creatinine and estimated GFR are central to
staging chronic kidney disease; urea rises with reduced GFR, high protein load, or
gastrointestinal bleeding.</p>
<p>Results should be interpreted with hydration status, muscle mass, drugs affecting
creatinine secretion, and trends over time. Electrolyte disturbances may accompany
acute or chronic kidney injury and require urgent clinical attention when severe.</p>
<p><em>References:</em> Kidney Disease: Improving Global Outcomes (KDIGO) CKD Work Group.
KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic
Kidney Disease. Kidney Int. 2024;105(4S):S117-S314. · Levey AS et al. A new equation
to estimate glomerular filtration rate. Ann Intern Med. 2009;150(9):604-612.
PMID: 19414839.</p>
"""

INTERP_ELECTROLYTES = """
<p>Serum electrolytes (sodium, potassium, chloride, and often bicarbonate) maintain
osmolarity, membrane potential, and acid–base balance. Hyponatraemia and
hyperkalaemia are among the most clinically urgent laboratory abnormalities.</p>
<p>Interpretation requires clinical context (volume status, medications such as
diuretics or ACE inhibitors, renal function, and acid–base status). Critical values
should be communicated promptly per laboratory protocol.</p>
<p><em>References:</em> Adrogué HJ, Madias NE. Hyponatremia. N Engl J Med.
2000;342(21):1581-1589. PMID: 10824078. · Mount DB. Fluid and Electrolyte
Disturbances. In: Harrison's Principles of Internal Medicine (current edition).</p>
"""

INTERP_IRON = """
<p>Iron studies (serum iron, TIBC/transferrin, transferrin saturation, ferritin)
distinguish iron-deficiency anaemia from anaemia of inflammation and help evaluate
iron overload. Ferritin is an acute-phase reactant and must be read with CRP/clinical
inflammation status.</p>
<p>Low ferritin is specific for depleted iron stores; high saturation with high
ferritin raises concern for haemochromatosis or secondary iron overload and warrants
specialist review.</p>
<p><em>References:</em> Camaschella C. Iron-Deficiency Anemia. N Engl J Med.
2015;372(19):1832-1843. PMID: 25946282. · WHO. Guideline on haemoglobin cutoffs to
define anaemia and assessments of iron status (current WHO guidance).</p>
"""

INTERP_URINE = """
<p>Urinalysis (physical, chemical, and microscopic examination) screens for urinary
tract infection, glomerular or tubular disease, metabolic disorders (e.g., glycosuria,
ketonuria), and haematuria. Dipstick positives should be confirmed microscopically
when clinically relevant.</p>
<p>Interpretation depends on collection quality, hydration, menstruation, and
medications. Persistent abnormalities warrant culture, imaging, or nephrology
referral as indicated.</p>
<p><em>References:</em> Simerville JA et al. Urinalysis: A Comprehensive Review.
Am Fam Physician. 2005;71(6):1153-1162. PMID: 15791892. · EAU / AUA guidance on
UTI and haematuria evaluation (specialty guidelines).</p>
"""

INTERP_GLUCOSE = """
<p>Plasma glucose measurement (fasting, random, or post-prandial) assesses glycaemic
status for diabetes screening, diagnosis, and acute care. Diagnostic thresholds differ
for fasting plasma glucose, OGTT, and random glucose with symptoms.</p>
<p>Pre-analytical factors (fasting duration, sample tube, delay to analysis) affect
results. Correlate with HbA1c and clinical presentation; acute illness can cause
transient hyperglycaemia.</p>
<p><em>References:</em> American Diabetes Association. Standards of Care in Diabetes
(Diagnosis and Classification). Diabetes Care (annual). · WHO. Definition and
diagnosis of diabetes mellitus and intermediate hyperglycaemia (technical report).</p>
"""

INTERP_CRP_INFLAMMATION = """
<p>C-reactive protein (CRP) is an acute-phase reactant that rises rapidly with
infection, tissue injury, and systemic inflammation. High-sensitivity CRP (hs-CRP)
is additionally used in cardiovascular risk stratification in selected adults.</p>
<p>CRP is non-specific; serial trends and clinical correlation outperform a single
value. Markedly elevated CRP supports significant inflammatory burden but does not
identify the source alone.</p>
<p><em>References:</em> Pepys MB, Hirschfield GM. C-reactive protein: a critical update.
J Clin Invest. 2003;111(12):1805-1812. PMID: 12813013. · Ridker PM. Clinical
application of C-reactive protein for cardiovascular disease detection and prevention.
Circulation. 2003;107(3):363-369. PMID: 12551853.</p>
"""

INTERP_COAG = """
<p>Coagulation assays such as prothrombin time (PT/INR) and activated partial
thromboplastin time (APTT) assess the extrinsic and intrinsic pathways of haemostasis.
They guide anticoagulant monitoring and evaluation of bleeding disorders.</p>
<p>Prolongation may reflect factor deficiency, inhibitors, vitamin K deficiency,
liver synthetic failure, or anticoagulant therapy. Results must be interpreted with
medication history and clinical bleeding/thrombosis phenotype.</p>
<p><em>References:</em> Tripodi A. The laboratory and the direct oral anticoagulants.
Clin Chem. 2013;59(2):353-362. · Bates SM, Weitz JI. Coagulation Assays. Circulation.
2005;112(4):e53-e60.</p>
"""

INTERP_VITAMIN_D = """
<p>25-hydroxyvitamin D is the preferred circulating marker of vitamin D status.
Deficiency is associated with osteomalacia/rickets and has been linked to broader
musculoskeletal and metabolic outcomes; supplementation decisions should follow
guideline thresholds and local assay standardization.</p>
<p><em>References:</em> Holick MF et al. Evaluation, Treatment, and Prevention of
Vitamin D Deficiency: Endocrine Society Clinical Practice Guideline. J Clin Endocrinol
Metab. 2011;96(7):1911-1930. PMID: 21646368.</p>
"""

INTERP_VITAMIN_B12 = """
<p>Vitamin B12 (cobalamin) measurement helps evaluate megaloblastic anaemia,
neuropathy, and malabsorption syndromes. Borderline levels may require metabolites
(methylmalonic acid, homocysteine) for confirmation.</p>
<p><em>References:</em> Stabler SP. Vitamin B12 Deficiency. N Engl J Med.
2013;368(2):149-160. PMID: 23301732.</p>
"""

INTERP_GENERIC = """
<p>{test_name} is a laboratory investigation used to support diagnosis, monitoring,
or screening as ordered by the treating clinician. Numerical results should be
interpreted against the laboratory’s biological reference interval, the patient’s
clinical history, concurrent medications, and related investigations.</p>
<p>Unexpected or critical values warrant clinical correlation and, when indicated,
repeat testing or specialist referral. This interpretive note is for laboratory
reporting context and does not replace physician judgment.</p>
<p><em>References:</em> Clinical and Laboratory Standards Institute (CLSI). EP28 —
Defining, Establishing, and Verifying Reference Intervals. · Burtis CA, Ashwood ER,
Bruns DE, eds. Tietz Textbook of Clinical Chemistry and Molecular Diagnostics
(current edition).</p>
"""

# (keywords tuple, interpretation html) — first match wins
INTERPRETATION_RULES = (
    (("sgpt", "alt/sgpt", "alanine aminotransferase", "alt)", "(alt"), INTERP_ALT_SGPT),
    (("sgot", "ast/sgot", "aspartate aminotransferase"), INTERP_AST_SGOT),
    (("liver function", "lft", "bilirubin, total", "ggt"), INTERP_LFT),
    (("lipid profile", "total cholesterol", "triglycerides - serum", "hdl cholesterol", "ldl cholesterol", "vldl"), INTERP_LIPID),
    (("complete blood count", "cbc", "haemogram", "hemogram", "tlc", "differential"), INTERP_CBC),
    (("hba1c", "glycated", "glycosylated"), INTERP_HBA1C),
    (("thyroid", "tsh", "ft3", "ft4", "t3", "t4"), INTERP_TSH_THYROID),
    (("kidney function", "kft", "creatinine", "urea", "bun", "egfr", "uric acid"), INTERP_KFT),
    (("electrolyte", "sodium", "potassium", "chloride", "bicarbonate"), INTERP_ELECTROLYTES),
    (("iron profile", "iron studies", "ferritin", "tibc", "transferrin"), INTERP_IRON),
    (("urine routine", "urine re", "urinalysis", "urine me"), INTERP_URINE),
    (("glucose", "fbs", "ppbs", "gtt", "ogtt"), INTERP_GLUCOSE),
    (("crp", "c-reactive", "hs-crp"), INTERP_CRP_INFLAMMATION),
    (("prothrombin", "aptt", "ptt", "inr", "coagul"), INTERP_COAG),
    (("vitamin d", "25-oh", "25 oh"), INTERP_VITAMIN_D),
    (("vitamin b12", "cobalamin"), INTERP_VITAMIN_B12),
)


def _normalize(text):
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def build_interpretation(test_name):
    lower = _normalize(test_name)
    for keywords, html in INTERPRETATION_RULES:
        if any(k in lower for k in keywords):
            return re.sub(r"\s+", " ", html).strip()
    return INTERP_GENERIC.format(test_name=test_name or "This test").strip()


def ensure_item_interpretation_field():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "hec_lab_interpretation",
                    "label": "Lab Report Interpretation",
                    "fieldtype": "Text Editor",
                    "insert_after": "hec_lab_parameters",
                    "description": "Literature-backed interpretation printed on lab reports",
                }
            ]
        }
    )


def _ensure_pathology():
    name = frappe.db.get_value("Clinical Department", {"department_name": "Pathology"}, "name")
    if name:
        return name
    if frappe.db.exists("DocType", "Clinical Department"):
        doc = frappe.get_doc(
            {"doctype": "Clinical Department", "department_name": "Pathology", "description": "Laboratory diagnostics"}
        )
        doc.insert(ignore_permissions=True)
        return doc.name
    return None


def upsert_master_interpretation(item_code, item_name, interpretation):
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return None
    pathology = _ensure_pathology()
    if not pathology:
        return None

    existing = frappe.db.get_value("Diagnostic Test Master", {"item": item_code}, "name")
    if existing:
        doc = frappe.get_doc("Diagnostic Test Master", existing)
        doc.interpretation = interpretation
        # Propagate to parameter rows that lack their own text (report fallback)
        for row in doc.parameters or []:
            if not (row.interpretation or "").strip():
                row.interpretation = interpretation
        doc.save(ignore_permissions=True)
        return doc.name

    # Create shell master so reports can resolve interpretation by item
    test_name = (item_name or item_code)[:140]
    if frappe.db.exists("Diagnostic Test Master", test_name):
        linked = frappe.db.get_value("Diagnostic Test Master", test_name, "item")
        if linked and linked != item_code:
            test_name = f"{test_name[:100]} ({item_code})"[:140]
        else:
            doc = frappe.get_doc("Diagnostic Test Master", test_name)
            doc.item = item_code
            doc.interpretation = interpretation
            doc.save(ignore_permissions=True)
            return doc.name

    payload = {
        "doctype": "Diagnostic Test Master",
        "test_name": test_name,
        "department": pathology,
        "item": item_code,
        "lis_code": item_code,
        "report_category": "CLINICAL BIOCHEMISTRY",
        "interpretation": interpretation,
    }
    if frappe.get_meta("Diagnostic Test Master").has_field("disabled"):
        payload["disabled"] = 0
    doc = frappe.get_doc(payload)
    doc.insert(ignore_permissions=True)
    return doc.name


def apply_interpretation_to_item(item_code, interpretation):
    if frappe.get_meta("Item").has_field("hec_lab_interpretation"):
        frappe.db.set_value("Item", item_code, "hec_lab_interpretation", interpretation, update_modified=False)


def sync_item_interpretation(item_code, item_name=None):
    item_name = item_name or frappe.db.get_value("Item", item_code, "item_name")
    interpretation = build_interpretation(item_name)
    apply_interpretation_to_item(item_code, interpretation)
    master = upsert_master_interpretation(item_code, item_name, interpretation)
    return {
        "item_code": item_code,
        "item_name": item_name,
        "master": master,
        "chars": len(interpretation),
    }


def sync_all_lab_interpretations(limit=None):
    ensure_item_interpretation_field()
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
        updated.append(sync_item_interpretation(row.name, row.item_name))
        if idx % 50 == 0:
            frappe.db.commit()

    # Also backfill any masters not linked via current Item loop
    if frappe.db.exists("DocType", "Diagnostic Test Master"):
        for master in frappe.get_all(
            "Diagnostic Test Master",
            fields=["name", "test_name", "interpretation"],
            limit=2000,
        ):
            if (master.interpretation or "").strip():
                continue
            text = build_interpretation(master.test_name)
            frappe.db.set_value("Diagnostic Test Master", master.name, "interpretation", text)

    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "updated": len(updated),
        "samples": [
            {"item_code": u["item_code"], "item_name": u["item_name"], "master": u["master"]}
            for u in updated
            if any(
                k in (u["item_name"] or "").lower()
                for k in ("sgpt", "alt", "lipid", "cbc", "hba1c", "liver", "thyroid")
            )
        ][:10],
    }


def setup_phase57():
    ensure_item_interpretation_field()
    frappe.clear_cache()
    return {"ok": True, "phase": 57}
