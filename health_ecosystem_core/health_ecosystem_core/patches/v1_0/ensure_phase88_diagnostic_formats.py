import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import setup_phase88

	setup_phase88(seed_examples=1)
	frappe.clear_cache()
