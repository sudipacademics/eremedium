import frappe


def execute():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import setup_phase95

    setup_phase95()
    frappe.clear_cache()
