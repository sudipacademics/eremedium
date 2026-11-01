# Copyright (c) 2026, Health Ecosystem and contributors
# License: MIT

import frappe
from frappe.model.document import Document


class LabReportBranding(Document):
	pass


def ensure_lab_report_branding():
	"""Create Single DocType + seed defaults for NABL PDF logos/banners."""
	import os

	from frappe.modules.import_file import import_file_by_path

	candidates = []
	try:
		app_path = frappe.get_app_path("health_ecosystem_core")
		candidates.append(
			os.path.join(
				app_path,
				"health_ecosystem_core",
				"health_ecosystem_core",
				"doctype",
				"lab_report_branding",
				"lab_report_branding.json",
			)
		)
		candidates.append(
			os.path.join(app_path, "health_ecosystem_core", "doctype", "lab_report_branding", "lab_report_branding.json")
		)
	except Exception:
		pass
	here = os.path.dirname(os.path.abspath(__file__))
	candidates.append(os.path.join(here, "lab_report_branding.json"))

	if not frappe.db.exists("DocType", "Lab Report Branding"):
		imported = False
		for json_path in candidates:
			if os.path.exists(json_path):
				try:
					import_file_by_path(json_path, force=True, ignore_version=True)
					imported = True
					break
				except Exception:
					frappe.log_error(title="import_lab_report_branding", message=frappe.get_traceback())
		if not imported:
			# Minimal Single fallback so Desk always has an upload place
			frappe.get_doc(
				{
					"doctype": "DocType",
					"name": "Lab Report Branding",
					"module": "Health Ecosystem Core",
					"issingle": 1,
					"custom": 0,
					"fields": [
						{"fieldname": "lab_name", "label": "Lab / Brand Name", "fieldtype": "Data", "reqd": 1},
						{"fieldname": "lab_tagline", "label": "Tagline", "fieldtype": "Data"},
						{"fieldname": "lab_address", "label": "Lab Address", "fieldtype": "Small Text"},
						{"fieldname": "lab_phone", "label": "Phone", "fieldtype": "Data"},
						{"fieldname": "lab_website", "label": "Website", "fieldtype": "Data"},
						{"fieldname": "lab_logo", "label": "Lab Logo", "fieldtype": "Attach Image"},
						{"fieldname": "nabl_logo", "label": "NABL Logo", "fieldtype": "Attach Image"},
						{"fieldname": "header_banner", "label": "Header Banner", "fieldtype": "Attach Image"},
						{"fieldname": "footer_banner", "label": "Footer Banner", "fieldtype": "Attach Image"},
						{"fieldname": "report_primary_color", "label": "Accent Color", "fieldtype": "Color"},
						{"fieldname": "nabl_accreditation", "label": "Accreditation Line", "fieldtype": "Data"},
						{"fieldname": "nabl_certificate_no", "label": "NABL Certificate No.", "fieldtype": "Data"},
						{"fieldname": "report_footer", "label": "Footer Disclaimer", "fieldtype": "Small Text"},
						{"fieldname": "show_authorized_badge", "label": "Show AUTHORIZED badge", "fieldtype": "Check", "default": "1"},
					],
					"permissions": [
						{"role": "System Manager", "read": 1, "write": 1, "create": 1},
						{"role": "Health System Admin", "read": 1, "write": 1},
					],
				}
			).insert(ignore_permissions=True)
		frappe.clear_cache(doctype="Lab Report Branding")

	if not frappe.db.exists("DocType", "Lab Report Branding"):
		return {"ok": False, "error": "DocType not created"}

	if not frappe.db.exists("Lab Report Branding", "Lab Report Branding"):
		doc = frappe.new_doc("Lab Report Branding")
		doc.lab_name = "Remedium Diagnostics"
		doc.lab_tagline = "Accurate · Timely · Trusted"
		doc.report_primary_color = "#0b5cab"
		doc.nabl_accreditation = "NABL Accredited Laboratory | ISO 15189:2022"
		doc.report_footer = (
			"This is a computer-generated report validated by an authorised signatory. "
			"Partial reproduction is not valid. Correlate with clinical findings."
		)
		doc.show_authorized_badge = 1
		if frappe.db.exists("DocType", "Health Ecosystem Settings"):
			for src, dst in (
				("lab_name", "lab_name"),
				("lab_tagline", "lab_tagline"),
				("lab_logo", "lab_logo"),
				("nabl_logo", "nabl_logo"),
				("header_banner", "header_banner"),
				("footer_banner", "footer_banner"),
				("report_primary_color", "report_primary_color"),
				("report_footer", "report_footer"),
				("nabl_accreditation", "nabl_accreditation"),
			):
				try:
					val = frappe.db.get_single_value("Health Ecosystem Settings", src)
				except Exception:
					val = None
				if val:
					doc.set(dst, val)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()

	return {"ok": True, "doctype": "Lab Report Branding"}
