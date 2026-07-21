# Copyright (c) 2026, Health Ecosystem and contributors
# License: MIT

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class LabComplaint(Document):
	def before_insert(self):
		if not self.ack_id:
			ts = now_datetime().strftime("%Y%m%d%H%M%S")
			self.ack_id = f"ACK-{ts}-{frappe.generate_hash(length=4).upper()}"
