"""Phase 40 — Colorful NABL lab report PDF + compact Lab Report desk form."""

from __future__ import annotations

import frappe


def setup_phase40_nabl_report():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import ensure_report_branding_fields

    ensure_report_branding_fields()
    frappe.clear_cache(doctype="Lab Report")
    frappe.clear_cache(doctype="Lab Report Parameter")
    return {"ok": True, "phase": "40", "feature": "nabl_color_report_compact_form"}
