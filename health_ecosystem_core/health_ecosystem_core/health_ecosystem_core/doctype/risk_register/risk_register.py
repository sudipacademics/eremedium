# Copyright (c) 2026, Health Ecosystem and contributors
# License: MIT

from frappe.model.document import Document
from frappe.utils import cint


class RiskRegister(Document):
	def before_save(self):
		self.risk_score = cint(self.likelihood or 0) * cint(self.impact or 0)
