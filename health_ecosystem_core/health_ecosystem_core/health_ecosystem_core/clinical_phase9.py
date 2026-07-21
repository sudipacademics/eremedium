"""
Phase 9: Secrets, integrations, and payment/LIS configuration.

Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase9.setup_phase9
"""

import frappe


def setup_phase9():
    ensure_integration_settings_fields()
    frappe.db.commit()
    frappe.clear_cache()
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import integration_status_payload

    return {"ok": True, "phase": 9, "integration": integration_status_payload()}


def ensure_integration_settings_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "section_integrations",
                    "label": "Integrations",
                    "fieldtype": "Section Break",
                    "insert_after": "pharmacy_catalog_title",
                    "collapsible": 1,
                },
                {
                    "fieldname": "backend_base_url",
                    "label": "Public Backend URL",
                    "fieldtype": "Data",
                    "insert_after": "section_integrations",
                    "description": "Used in LIS bridge export, e.g. http://167.233.108.90:8080",
                    "default": "http://167.233.108.90:8080",
                },
                {
                    "fieldname": "lis_requires_payment",
                    "label": "LIS Requires Razorpay Payment",
                    "fieldtype": "Check",
                    "insert_after": "backend_base_url",
                    "default": "0",
                    "description": "When enabled, analyzers cannot pull unpaid barcodes. Disable for pay-at-counter labs.",
                },
                {
                    "fieldname": "integration_notes",
                    "label": "Integration Notes",
                    "fieldtype": "Small Text",
                    "insert_after": "lis_requires_payment",
                    "read_only": 1,
                    "default": "See SECRETS_SETUP.md in repo root for full instructions.",
                },
            ]
        }
    )
