"""Re-sync Phase 6 child DocTypes after migrate orphan cleanup."""

import frappe


def execute():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import sync_phase6_doctypes

    sync_phase6_doctypes(force=True)
    frappe.db.commit()
