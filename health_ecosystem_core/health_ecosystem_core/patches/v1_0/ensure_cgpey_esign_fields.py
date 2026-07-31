import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import ensure_cgpey_esign_fields

	ensure_cgpey_esign_fields()
	frappe.clear_cache()
