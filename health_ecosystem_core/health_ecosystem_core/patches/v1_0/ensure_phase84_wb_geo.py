import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase84_wb_geo import (
		ensure_lead_geo_fields,
		ensure_wb_postal_locality_doctype,
	)

	ensure_wb_postal_locality_doctype()
	ensure_lead_geo_fields()
	frappe.clear_cache()
