import frappe


def execute():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring import (
		ensure_wb_hiring_fields,
	)

	ensure_wb_hiring_fields()
	frappe.db.commit()
