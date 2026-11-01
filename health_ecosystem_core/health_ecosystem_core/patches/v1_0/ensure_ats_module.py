import frappe


def execute():
	"""Ensure ATS custom fields, Job Application web form, and sample requisition."""
	from health_ecosystem_core.health_ecosystem_core.ats_setup import setup_ats

	setup_ats()
	frappe.clear_cache()
