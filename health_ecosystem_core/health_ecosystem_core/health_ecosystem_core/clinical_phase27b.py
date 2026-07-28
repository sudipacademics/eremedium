"""Phase 27B — Sales commission ledger + Remedium Labs catalog seed."""

from __future__ import annotations

import os

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, today

PHASE27B_DOCTYPES = (
    ("sales_commission_ledger", "Sales Commission Ledger"),
    ("sales_catalog_offering", "Sales Catalog Offering"),
)

DEFAULT_REVENUE_SHARE_RATE = 2.5
DEFAULT_ONBOARDING_BONUS = 15000

REMEDIUM_PUBLIC_SITE = "https://www.e-remedium.in/"
REMEDIUM_FRANCHISE_PAGE = "https://www.e-remedium.in/franchise/"
REMEDIUM_BROCHURE_PDF = (
    "https://lab.remediumhealth.co.in/wp-content/uploads/2026/02/Foco-Brochure-2026_compressed.pdf"
)
REMEDIUM_COMPANY = {
    "name": "Remedium Labs",
    "legal_name": "Smilecure Lifestyle Pvt. Ltd.",
    "tagline": "Transparency, Accuracy & Speed – Our Promise to You",
    "accreditation": "NABL Accredited | ISO 9001:2015 Certified",
    "experience_years": 25,
    "email": "labs@remedium.smilecure.info",
    "phone": "+91 8100149231",
    "home_collection_helpline": "+91 8100149230 / 6290862844",
    "home_collection_hours": "9:00 AM – 8:00 PM",
    "public_site": REMEDIUM_PUBLIC_SITE,
    "franchise_page": REMEDIUM_FRANCHISE_PAGE,
}

DEPRECATED_OFFERING_CODES = ("FOCO_COLLECTION", "FOCO_MINI_HUB", "FOCO_FULL_LAB")

BROCHURE_OFFERINGS = (
    {
        "offering_code": "REMEDIUM_FOCO_CC",
        "title": "FOCO – Collection Centre",
        "category": "Remedium Franchise",
        "description": (
            "Franchise Owned, Company Operated — patient handling and sample collection at your centre; "
            "all testing centrally managed by Remedium Labs."
        ),
        "bullet_points": "\n".join(
            [
                "Low investment & faster ROI",
                "Centralized NABL-compliant testing",
                "Company-managed SOPs & QC",
                "Branding, logistics & IT support",
                "Ideal for clinics, entrepreneurs & healthcare institutions",
            ]
        ),
        "sort_order": 10,
    },
    {
        "offering_code": "REMEDIUM_MASTER_HUB",
        "title": "Master Franchise – Testing Hub",
        "category": "Remedium Franchise",
        "description": (
            "Regional testing hub with in-house capability following Remedium Labs protocols; "
            "expand through multiple collection centres."
        ),
        "bullet_points": "\n".join(
            [
                "Higher testing volumes",
                "Regional market control",
                "Infrastructure & technical guidance",
                "Ongoing marketing & compliance support",
                "Scale regionally with full technical backing",
            ]
        ),
        "sort_order": 20,
    },
    {
        "offering_code": "REMEDIUM_WHY_PARTNER",
        "title": "Why Partner With Remedium Labs",
        "category": "Revenue Model",
        "description": "Structured franchise partnership backed by advanced technology, standardized SOPs, and experienced professionals.",
        "bullet_points": "\n".join(
            [
                "NABL Accredited brand credibility",
                "Transparent franchise structure",
                "Strong corporate backing (Smilecure Lifestyle Pvt. Ltd.)",
                "End-to-end support ecosystem",
                "Long-term partnership vision",
            ]
        ),
        "sort_order": 30,
    },
    {
        "offering_code": "SVC_BIOCHEMISTRY",
        "title": "Biochemistry",
        "category": "Diagnostic Service",
        "description": "Core clinical chemistry testing with accuracy-driven reporting.",
        "bullet_points": "\n".join(
            [
                "LFT, KFT, lipid & metabolic panels",
                "Fast turnaround with quality assurance",
                "NABL-compliant processes",
            ]
        ),
        "sort_order": 40,
    },
    {
        "offering_code": "SVC_MICRO_SERO",
        "title": "Microbiology & Serology",
        "category": "Diagnostic Service",
        "description": "Infectious disease and serology testing for clinics and hospitals.",
        "bullet_points": "\n".join(
            [
                "Culture & sensitivity workflows",
                "Serology profiles",
                "Ethical & transparent reporting",
            ]
        ),
        "sort_order": 50,
    },
    {
        "offering_code": "SVC_HORMONE",
        "title": "Hormone & Advanced Profile Testing",
        "category": "Diagnostic Service",
        "description": "Advanced endocrine and specialty profiles for referral partners.",
        "bullet_points": "\n".join(
            [
                "Thyroid, reproductive & metabolic hormones",
                "Advanced specialty panels",
                "Expert team, modern infrastructure",
            ]
        ),
        "sort_order": 60,
    },
    {
        "offering_code": "PKG_FULL_BODY",
        "title": "Full Body Health Checkup",
        "category": "Health Package",
        "description": "Flagship preventive health panel for walk-in patients and corporate camps.",
        "mrp_reference": 2499,
        "wholesale_reference": 1749,
        "bullet_points": "\n".join(
            [
                "CBC, LFT, KFT, Lipid profile",
                "Fasting & PP blood sugar",
                "Thyroid profile (TSH)",
                "Urine routine",
                "Same-day digital report via Remedium app",
            ]
        ),
        "sort_order": 70,
    },
    {
        "offering_code": "PKG_DIABETES",
        "title": "Diabetes Care Panel",
        "category": "Health Package",
        "description": "Chronic care programme panel for clinic partnerships.",
        "mrp_reference": 1299,
        "wholesale_reference": 909,
        "bullet_points": "\n".join(
            [
                "HbA1c",
                "Fasting & post-prandial glucose",
                "Microalbumin urine",
                "Lipid mini panel",
            ]
        ),
        "sort_order": 80,
    },
    {
        "offering_code": "ADDON_HOME_COLLECTION",
        "title": "Home Sample Collection",
        "category": "Add-on Service",
        "description": "Helpline 8100149230 / 6290862844 · 9am–8pm daily.",
        "mrp_reference": 199,
        "wholesale_reference": 120,
        "bullet_points": "\n".join(
            [
                "Book via Remedium Labs mobile app",
                "Track sample collection and delivery",
                "Trained phlebotomist network",
                "Secure, user-friendly patient experience",
            ]
        ),
        "sort_order": 90,
    },
    {
        "offering_code": "ADDON_MOBILE_APP",
        "title": "Remedium Labs Mobile App",
        "category": "Add-on Service",
        "description": "Diagnostic services at your fingertips — reports, packages, and journey tracking.",
        "bullet_points": "\n".join(
            [
                "View & download test reports",
                "Explore health packages and offers",
                "Track sample collection status",
                "Secure, user-friendly interface",
            ]
        ),
        "sort_order": 100,
    },
    {
        "offering_code": "REVENUE_MODEL",
        "title": "Franchise Revenue Model",
        "category": "Revenue Model",
        "description": "How Remedium franchise partners earn on every test.",
        "bullet_points": "\n".join(
            [
                "Bill patients at MRP at your centre",
                "Platform wholesale debited from prepaid wallet",
                "Your margin = MRP − wholesale",
                "Sales commission on onboarded franchise revenue",
                "Health Circle membership upsell (ecosystem app)",
            ]
        ),
        "sort_order": 110,
    },
)

SALES_PANELS = (
    {
        "panel_name": "Remedium Starter Panel",
        "description": "Entry-level pitch panel — CBC, sugar, lipid basics.",
        "panel_rate": 899,
        "tests": ["CBC", "Blood Sugar Fasting", "Lipid Profile"],
    },
    {
        "panel_name": "Remedium Corporate Camp Panel",
        "description": "Corporate health camp bundle for field demos.",
        "panel_rate": 1499,
        "tests": ["CBC", "Blood Sugar Fasting", "LFT", "KFT", "Thyroid Profile"],
    },
    {
        "panel_name": "Remedium Senior Care Panel",
        "description": "Geriatric screening package for clinic partnerships.",
        "panel_rate": 2199,
        "tests": ["CBC", "HbA1c", "Vitamin D", "Vitamin B12", "Lipid Profile", "TSH"],
    },
)


def _import_doctype(folder, doctype_name):
    if frappe.db.exists("DocType", doctype_name):
        return
    from frappe.modules.import_file import import_file_by_path

    candidates = []
    app_path = frappe.get_app_path("health_ecosystem_core")
    candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
    except Exception:
        pass
    for json_path in candidates:
        if os.path.isfile(json_path):
            import_file_by_path(json_path, force=True)
            frappe.db.commit()
            if frappe.db.exists("DocType", doctype_name):
                return
    frappe.throw(_("Could not install {0}").format(doctype_name))


def ensure_phase27b_doctypes():
    for folder, name in PHASE27B_DOCTYPES:
        _import_doctype(folder, name)


def ensure_phase27b_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    ensure_phase27b_doctypes()
    create_custom_fields(
        {
            "Sales Rep Profile": [
                {
                    "fieldname": "revenue_share_rate",
                    "label": "Revenue Share %",
                    "fieldtype": "Percent",
                    "default": str(DEFAULT_REVENUE_SHARE_RATE),
                    "insert_after": "territory_region",
                },
                {
                    "fieldname": "onboarding_bonus",
                    "label": "Onboarding Bonus",
                    "fieldtype": "Currency",
                    "default": str(DEFAULT_ONBOARDING_BONUS),
                    "insert_after": "revenue_share_rate",
                },
            ],
        },
        update=True,
    )


def _rep_rates(sales_rep_id):
    rep = frappe.get_doc("Sales Rep Profile", sales_rep_id)
    return {
        "revenue_share_rate": flt(getattr(rep, "revenue_share_rate", None)) or DEFAULT_REVENUE_SHARE_RATE,
        "onboarding_bonus": flt(getattr(rep, "onboarding_bonus", None)) or DEFAULT_ONBOARDING_BONUS,
    }


def _ledger_exists(sales_rep, entry_type, reference_doctype, reference_name):
    return frappe.db.exists(
        "Sales Commission Ledger",
        {
            "sales_rep": sales_rep,
            "entry_type": entry_type,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "status": ("!=", "Reversed"),
        },
    )


def record_commission_entry(
    sales_rep,
    entry_type,
    commission_amount,
    *,
    franchisee=None,
    gross_amount=0,
    commission_rate=0,
    reference_doctype=None,
    reference_name=None,
    notes=None,
    posting_date=None,
):
    ensure_phase27b_doctypes()
    if not sales_rep or flt(commission_amount) <= 0:
        return None
    if reference_doctype and reference_name and _ledger_exists(sales_rep, entry_type, reference_doctype, reference_name):
        return frappe.db.get_value(
            "Sales Commission Ledger",
            {
                "sales_rep": sales_rep,
                "entry_type": entry_type,
                "reference_doctype": reference_doctype,
                "reference_name": reference_name,
            },
            "name",
        )

    doc = frappe.get_doc(
        {
            "doctype": "Sales Commission Ledger",
            "sales_rep": sales_rep,
            "franchisee": franchisee,
            "entry_type": entry_type,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "gross_amount": flt(gross_amount),
            "commission_rate": flt(commission_rate),
            "commission_amount": flt(commission_amount),
            "status": "Accrued",
            "posting_date": getdate(posting_date or today()),
            "notes": notes,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _sales_rep_for_franchisee(franchisee_id):
    if not franchisee_id:
        return None
    meta = frappe.get_meta("Franchisee Profile")
    if not meta.has_field("acquired_by_sales_rep"):
        return None
    return frappe.db.get_value("Franchisee Profile", franchisee_id, "acquired_by_sales_rep")


def accrue_onboarding_commission(franchisee_id, onboarding_request=None):
    sales_rep = _sales_rep_for_franchisee(franchisee_id)
    if not sales_rep:
        return None
    rates = _rep_rates(sales_rep)
    bonus = rates["onboarding_bonus"]
    return record_commission_entry(
        sales_rep,
        "Onboarding Bonus",
        bonus,
        franchisee=franchisee_id,
        gross_amount=bonus,
        commission_rate=100,
        reference_doctype="Franchise Onboarding Request" if onboarding_request else "Franchisee Profile",
        reference_name=onboarding_request or franchisee_id,
        notes=f"Onboarding bonus for {franchisee_id}",
    )


def accrue_trf_revenue_commission(trf_name):
    if not frappe.db.exists("Customer TRF", trf_name):
        return None
    trf = frappe.get_doc("Customer TRF", trf_name)
    if trf.razorpay_payment_status != "Paid":
        return None
    franchisee_id = getattr(trf, "franchisee_id", None)
    sales_rep = _sales_rep_for_franchisee(franchisee_id)
    if not sales_rep:
        return None
    gross = flt(trf.amount)
    if gross <= 0:
        return None
    rates = _rep_rates(sales_rep)
    rate = rates["revenue_share_rate"]
    commission = gross * rate / 100.0
    return record_commission_entry(
        sales_rep,
        "Revenue Share",
        commission,
        franchisee=franchisee_id,
        gross_amount=gross,
        commission_rate=rate,
        reference_doctype="Customer TRF",
        reference_name=trf_name,
        notes=f"Revenue share on paid TRF {trf_name}",
    )


def on_payment_confirmed(reference_doctype, reference_name):
    if reference_doctype != "Customer TRF":
        return
    try:
        accrue_trf_revenue_commission(reference_name)
        frappe.db.commit()
    except Exception:
        frappe.log_error(title="accrue_trf_revenue_commission", message=frappe.get_traceback())


def list_commission_ledger(user, limit=50, status=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import is_sales_user, scoped_rep_ids

    if not is_sales_user(user):
        return []
    ensure_phase27b_doctypes()
    rep_ids = scoped_rep_ids(user)
    filters = {"sales_rep": ("in", rep_ids)}
    if status:
        filters["status"] = status
    rows = frappe.get_all(
        "Sales Commission Ledger",
        filters=filters,
        fields=[
            "name",
            "sales_rep",
            "franchisee",
            "entry_type",
            "reference_doctype",
            "reference_name",
            "gross_amount",
            "commission_rate",
            "commission_amount",
            "status",
            "posting_date",
            "notes",
            "creation",
        ],
        order_by="posting_date desc, creation desc",
        limit=cint(limit),
    )
    for row in rows:
        if row.franchisee:
            row["franchise_name"] = frappe.db.get_value("Franchisee Profile", row.franchisee, "franchise_name")
    return rows


def get_commission_summary(user):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import is_sales_user, scoped_rep_ids

    if not is_sales_user(user):
        return {"available": False}
    ensure_phase27b_doctypes()
    rep_ids = scoped_rep_ids(user)
    rows = frappe.get_all(
        "Sales Commission Ledger",
        filters={"sales_rep": ("in", rep_ids)},
        fields=["commission_amount", "status", "entry_type", "posting_date"],
    )
    accrued = paid = month_accrued = 0.0
    month_start = getdate(today()).replace(day=1)
    for row in rows:
        amt = flt(row.commission_amount)
        if row.status == "Accrued":
            accrued += amt
            if getdate(row.posting_date) >= month_start:
                month_accrued += amt
        elif row.status == "Paid":
            paid += amt
    return {
        "available": True,
        "accrued_total": accrued,
        "paid_total": paid,
        "month_accrued": month_accrued,
        "entry_count": len(rows),
    }


def _resolve_item_code(test_name):
    code = frappe.db.get_value("Item", {"item_name": test_name}, "name")
    if code:
        return code
    code = frappe.db.get_value("Item", test_name, "name")
    if code:
        return code
    return frappe.db.get_value("Item", {"name": ("like", f"%{test_name[:20]}%")}, "name")


def seed_sales_catalog_offerings():
    ensure_phase27b_doctypes()
    created = []
    for code in DEPRECATED_OFFERING_CODES:
        if frappe.db.exists("Sales Catalog Offering", code):
            frappe.db.set_value("Sales Catalog Offering", code, "is_active", 0, update_modified=False)
    for spec in BROCHURE_OFFERINGS:
        if frappe.db.exists("Sales Catalog Offering", spec["offering_code"]):
            doc = frappe.get_doc("Sales Catalog Offering", spec["offering_code"])
            for key, value in spec.items():
                if hasattr(doc, key):
                    setattr(doc, key, value)
            doc.is_active = 1
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc({"doctype": "Sales Catalog Offering", **spec, "is_active": 1})
            doc.insert(ignore_permissions=True)
        created.append(spec["offering_code"])
    return created


def seed_sales_lab_panels():
    if not frappe.db.exists("DocType", "Lab Test Panel"):
        return []
    created = []
    for spec in SALES_PANELS:
        panel_name = spec["panel_name"]
        test_rows = []
        for test_label in spec["tests"]:
            item_code = _resolve_item_code(test_label)
            if not item_code:
                continue
            test_rows.append(
                {
                    "item": item_code,
                    "item_name": frappe.db.get_value("Item", item_code, "item_name") or test_label,
                }
            )
        if len(test_rows) < 2:
            continue
        if frappe.db.exists("Lab Test Panel", panel_name):
            doc = frappe.get_doc("Lab Test Panel", panel_name)
            doc.description = spec["description"]
            doc.panel_rate = spec["panel_rate"]
            doc.show_on_mobile = 1
            doc.is_active = 1
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "Lab Test Panel",
                    "panel_name": panel_name,
                    "description": spec["description"],
                    "panel_rate": spec["panel_rate"],
                    "is_active": 1,
                    "show_on_mobile": 1,
                    "tests": test_rows,
                }
            )
            doc.insert(ignore_permissions=True)
        created.append(panel_name)
    return created


def get_catalog_offerings():
    ensure_phase27b_doctypes()
    rows = frappe.get_all(
        "Sales Catalog Offering",
        filters={"is_active": 1},
        fields=[
            "offering_code",
            "title",
            "category",
            "description",
            "investment_from",
            "investment_to",
            "mrp_reference",
            "wholesale_reference",
            "bullet_points",
            "brochure_page",
            "sort_order",
        ],
        order_by="sort_order asc",
    )
    for row in rows:
        bullets = (row.bullet_points or "").strip()
        row["points"] = [line.strip() for line in bullets.splitlines() if line.strip()]
    return rows


def get_remedium_catalog_meta():
    return dict(REMEDIUM_COMPANY)


def get_brochure_url():
    settings = None
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        settings = frappe.get_single("Health Ecosystem Settings")
    if settings and getattr(settings, "sales_brochure_url", None):
        return settings.sales_brochure_url
    return REMEDIUM_BROCHURE_PDF


def get_franchise_portal_url():
    settings = None
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        settings = frappe.get_single("Health Ecosystem Settings")
    if settings and getattr(settings, "franchise_portal_url", None):
        return settings.franchise_portal_url
    return REMEDIUM_FRANCHISE_PAGE


def seed_demo_commissions():
    """Backfill sample ledger rows for sales smoke demo."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_or_create_sales_rep

    ensure_phase27b_custom_fields()
    rep_id = get_or_create_sales_rep("sales_rep1@health.local")
    franchisee = frappe.db.get_value("Franchisee Profile", {"branch_code": "HUB002"}, "name")
    if not franchisee:
        franchisee = frappe.db.get_value("Franchisee Profile", {}, "name")
    if franchisee:
        meta = frappe.get_meta("Franchisee Profile")
        if meta.has_field("acquired_by_sales_rep"):
            frappe.db.set_value("Franchisee Profile", franchisee, "acquired_by_sales_rep", rep_id, update_modified=False)

    if franchisee and not _ledger_exists(rep_id, "Onboarding Bonus", "Franchisee Profile", franchisee):
        accrue_onboarding_commission(franchisee)

    trf = frappe.db.get_value(
        "Customer TRF",
        {"franchisee_id": franchisee, "razorpay_payment_status": "Paid"},
        "name",
        order_by="creation desc",
    )
    if trf:
        accrue_trf_revenue_commission(trf)

    frappe.db.commit()
    return {"rep": rep_id, "franchisee": franchisee, "sample_trf": trf}


def setup_phase27b():
    ensure_phase27b_custom_fields()
    offerings = seed_sales_catalog_offerings()
    panels = seed_sales_lab_panels()
    _ensure_brochure_setting()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "phase": "27B", "offerings": offerings, "panels": panels}


def _ensure_brochure_setting():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "sales_brochure_url",
                    "label": "Sales Brochure URL",
                    "fieldtype": "Data",
                    "default": REMEDIUM_BROCHURE_PDF,
                    "insert_after": "enable_scheduled_reminders",
                },
                {
                    "fieldname": "franchise_portal_url",
                    "label": "Franchise Portal URL",
                    "fieldtype": "Data",
                    "default": REMEDIUM_FRANCHISE_PAGE,
                    "insert_after": "sales_brochure_url",
                },
                {
                    "fieldname": "company_public_site_url",
                    "label": "Company Public Site URL",
                    "fieldtype": "Data",
                    "default": REMEDIUM_PUBLIC_SITE,
                    "insert_after": "franchise_portal_url",
                },
            ],
        },
        update=True,
    )
    if frappe.db.exists("Health Ecosystem Settings", "Health Ecosystem Settings"):
        settings = frappe.get_single("Health Ecosystem Settings")
        changed = False
        for field, default in (
            ("sales_brochure_url", REMEDIUM_BROCHURE_PDF),
            ("franchise_portal_url", REMEDIUM_FRANCHISE_PAGE),
            ("company_public_site_url", REMEDIUM_PUBLIC_SITE),
        ):
            if hasattr(settings, field) and not getattr(settings, field, None):
                setattr(settings, field, default)
                changed = True
        if changed:
            settings.save(ignore_permissions=True)
