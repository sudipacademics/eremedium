import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import setup_phase89

	setup_phase89(seed=1)
	frappe.clear_cache()
