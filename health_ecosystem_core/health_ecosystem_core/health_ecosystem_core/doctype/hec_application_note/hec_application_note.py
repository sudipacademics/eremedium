# Copyright (c) 2026 and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class HECApplicationNote(Document):
	def before_insert(self):
		import frappe

		if not self.created_by_user:
			self.created_by_user = frappe.session.user
