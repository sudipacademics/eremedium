# Copyright (c) 2026 and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt


class HECHiringCampaign(Document):
	def validate(self):
		leads = flt(self.leads)
		spend = flt(self.spend)
		self.cpl = (spend / leads) if leads else 0
		hire_value_unit = 50000
		try:
			import frappe

			if frappe.db.exists("DocType", "Health Ecosystem Settings"):
				v = frappe.db.get_single_value("Health Ecosystem Settings", "hire_value_for_roi")
				if v is not None and flt(v) > 0:
					hire_value_unit = flt(v)
		except Exception:
			pass
		hire_value = flt(self.hired) * hire_value_unit
		self.roi = (hire_value / spend) if spend else 0
