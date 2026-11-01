import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import ensure_phase83_maps_fields

	ensure_phase83_maps_fields()
	frappe.clear_cache()
