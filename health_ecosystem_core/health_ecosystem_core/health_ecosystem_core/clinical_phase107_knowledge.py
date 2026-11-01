"""Phase 107 — HCP Knowledge / TatvaPedia-lite (curated articles + PubMed search)."""

from __future__ import annotations

import json
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

import frappe
from frappe import _
from frappe.utils import cint

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

ARTICLE_DT = "Clinical Knowledge Article"

CURATED_SEED = (
    {
        "article_code": "DM-ADA-LIFESTYLE",
        "title": "Lifestyle management in type 2 diabetes — practical outpatient points",
        "specialty": "endocrinology",
        "condition_tags": "Diabetes, Lifestyle",
        "summary": "Focus on nutrition, activity, weight, and medication adherence with measurable HbA1c goals.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=type+2+diabetes+lifestyle+management",
        "pmid": "",
        "status": "Approved",
    },
    {
        "article_code": "NAFLD-WEIGHT",
        "title": "Weight loss as first-line therapy in NAFLD",
        "specialty": "hepatology",
        "condition_tags": "NAFLD, Fatty Liver",
        "summary": "7–10% body weight reduction associates with improvement in steatosis and enzymes.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=NAFLD+weight+loss",
        "status": "Approved",
    },
    {
        "article_code": "COPD-PULM-REHAB",
        "title": "Pulmonary rehabilitation and inhaler technique in COPD",
        "specialty": "pulmonology",
        "condition_tags": "COPD, Asthma",
        "summary": "Check inhaler technique every visit; rehab improves walk distance and symptoms.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=COPD+pulmonary+rehabilitation",
        "status": "Approved",
    },
    {
        "article_code": "PCOS-METABOLIC",
        "title": "Metabolic screening in PCOS",
        "specialty": "gynaecology",
        "condition_tags": "PCOS",
        "summary": "Screen glucose, lipids, BMI, and BP; lifestyle remains foundational.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=PCOS+metabolic+screening",
        "status": "Approved",
    },
    {
        "article_code": "URI-OPD",
        "title": "Avoiding unnecessary antibiotics in outpatient URI",
        "specialty": "general_medicine",
        "condition_tags": "URI, Fever",
        "summary": "Most viral URIs resolve supportively; document red flags and follow-up advice.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=outpatient+URI+antibiotic+stewardship",
        "status": "Approved",
    },
    {
        "article_code": "HTN-HOME-BP",
        "title": "Home BP monitoring to guide therapy",
        "specialty": "general_medicine",
        "condition_tags": "Hypertension",
        "summary": "Validated home readings improve titration decisions vs clinic-only BP.",
        "source_name": "Curated editorial",
        "external_url": "https://pubmed.ncbi.nlm.nih.gov/?term=home+blood+pressure+monitoring",
        "status": "Approved",
    },
)


def ensure_phase107_doctypes():
    if frappe.db.exists("DocType", ARTICLE_DT):
        return False
    frappe.get_doc(
        {
            "doctype": "DocType",
            "name": ARTICLE_DT,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "autoname": "field:article_code",
            "naming_rule": "By fieldname",
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": [
                {
                    "fieldname": "article_code",
                    "label": "Article Code",
                    "fieldtype": "Data",
                    "reqd": 1,
                    "unique": 1,
                    "in_list_view": 1,
                },
                {
                    "fieldname": "title",
                    "label": "Title",
                    "fieldtype": "Data",
                    "reqd": 1,
                    "in_list_view": 1,
                },
                {
                    "fieldname": "specialty",
                    "label": "Specialty",
                    "fieldtype": "Data",
                    "in_list_view": 1,
                    "in_standard_filter": 1,
                },
                {
                    "fieldname": "condition_tags",
                    "label": "Condition Tags",
                    "fieldtype": "Data",
                },
                {
                    "fieldname": "status",
                    "label": "Status",
                    "fieldtype": "Select",
                    "options": "Draft\nApproved\nArchived",
                    "default": "Draft",
                    "in_list_view": 1,
                },
                {"fieldname": "summary", "label": "Summary (60–120 sec read)", "fieldtype": "Small Text"},
                {"fieldname": "source_name", "label": "Source", "fieldtype": "Data"},
                {"fieldname": "pmid", "label": "PMID", "fieldtype": "Data"},
                {"fieldname": "external_url", "label": "External URL", "fieldtype": "Data"},
                {"fieldname": "display_order", "label": "Display Order", "fieldtype": "Int", "default": "0"},
            ],
            "permissions": [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Health System Admin",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "export": 1,
                    "report": 1,
                },
                {"role": "Physician", "read": 1, "report": 1},
            ],
        }
    ).insert(ignore_permissions=True)
    frappe.clear_cache(doctype=ARTICLE_DT)
    return True


def seed_knowledge_articles():
    ensure_phase107_doctypes()
    seeded = []
    for i, spec in enumerate(CURATED_SEED):
        code = spec["article_code"]
        payload = {**spec, "display_order": i + 1}
        if frappe.db.exists(ARTICLE_DT, code):
            doc = frappe.get_doc(ARTICLE_DT, code)
            for k, v in payload.items():
                doc.set(k, v)
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc({"doctype": ARTICLE_DT, **payload}).insert(ignore_permissions=True)
        seeded.append(code)
    frappe.db.commit()
    return seeded


def _serialize_article(name):
    doc = frappe.get_doc(ARTICLE_DT, name)
    return {
        "name": doc.name,
        "article_code": doc.article_code,
        "title": doc.title,
        "specialty": doc.specialty,
        "condition_tags": doc.condition_tags,
        "summary": doc.summary,
        "source_name": doc.source_name,
        "pmid": doc.pmid,
        "external_url": doc.external_url,
        "status": doc.status,
    }


@frappe.whitelist()
def list_knowledge_articles(specialty=None, limit=50, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)
    ensure_phase107_doctypes()
    filters = {"status": "Approved"}
    specialty = (_parse_request_value("specialty", specialty) or "").strip()
    if specialty:
        filters["specialty"] = specialty
    names = frappe.get_all(
        ARTICLE_DT,
        filters=filters,
        pluck="name",
        order_by="display_order asc, modified desc",
        limit=cint(limit or 50),
    )
    return _success({"articles": [_serialize_article(n) for n in names]})


def _pubmed_esearch(term, limit=8):
    params = urlencode(
        {
            "db": "pubmed",
            "term": term,
            "retmax": int(limit),
            "retmode": "json",
            "sort": "relevance",
        }
    )
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{params}"
    req = Request(url, headers={"User-Agent": "e-Remedium-Knowledge/1.0"})
    with urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (data.get("esearchresult") or {}).get("idlist") or []


def _pubmed_esummary(pmids):
    if not pmids:
        return []
    params = urlencode({"db": "pubmed", "id": ",".join(pmids), "retmode": "json"})
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?{params}"
    req = Request(url, headers={"User-Agent": "e-Remedium-Knowledge/1.0"})
    with urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    result = data.get("result") or {}
    out = []
    for pmid in pmids:
        row = result.get(pmid) or {}
        if not row or pmid == "uids":
            continue
        out.append(
            {
                "pmid": pmid,
                "title": row.get("title"),
                "source": row.get("fulljournalname") or row.get("source"),
                "pubdate": row.get("pubdate"),
                "authors": ", ".join(
                    [a.get("name") for a in (row.get("authors") or [])[:4] if a.get("name")]
                ),
                "external_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            }
        )
    return out


@frappe.whitelist()
def search_pubmed(q=None, limit=8, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)

    q = (_parse_request_value("q", q) or "").strip()
    if len(q) < 3:
        return _error(_("Search query too short"))

    cache_key = f"hec:pubmed:{q.lower()[:80]}:{limit}"
    cached = frappe.cache().get_value(cache_key)
    if cached:
        return _success({"results": cached, "cached": True})

    try:
        ids = _pubmed_esearch(q, limit=cint(limit or 8))
        results = _pubmed_esummary(ids)
        frappe.cache().set_value(cache_key, results, expires_in_sec=6 * 3600)
        return _success({"results": results, "cached": False})
    except Exception as exc:
        frappe.log_error(title="pubmed_search", message=frappe.get_traceback())
        # Graceful fallback: curated keyword filter
        ensure_phase107_doctypes()
        fallback = []
        for name in frappe.get_all(ARTICLE_DT, filters={"status": "Approved"}, pluck="name"):
            art = _serialize_article(name)
            blob = f"{art['title']} {art.get('summary') or ''} {art.get('condition_tags') or ''}".lower()
            if q.lower() in blob:
                fallback.append(
                    {
                        "pmid": art.get("pmid") or None,
                        "title": art["title"],
                        "source": art.get("source_name"),
                        "external_url": art.get("external_url"),
                        "curated": True,
                    }
                )
        return _success(
            {
                "results": fallback[: cint(limit or 8)],
                "cached": False,
                "fallback": True,
                "error": str(exc)[:200],
            }
        )


def setup_phase107_knowledge():
    created = ensure_phase107_doctypes()
    seeded = seed_knowledge_articles()
    return {"ok": True, "phase": "107", "wave": "C", "created": created, "seeded": seeded}


def smoke_phase107_knowledge():
    setup = setup_phase107_knowledge()
    count = frappe.db.count(ARTICLE_DT, {"status": "Approved"}) if frappe.db.exists("DocType", ARTICLE_DT) else 0
    return {"ok": count >= 1, "phase": "107", "setup": setup, "approved_articles": count}
