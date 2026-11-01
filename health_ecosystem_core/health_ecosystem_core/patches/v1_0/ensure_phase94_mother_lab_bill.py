import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase94_mother_lab_bill import setup_phase94

	setup_phase94()
	frappe.clear_cache()
