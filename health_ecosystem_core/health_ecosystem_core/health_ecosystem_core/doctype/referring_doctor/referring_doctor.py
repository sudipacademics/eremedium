import frappe
from frappe.model.document import Document


class ReferringDoctor(Document):
    def validate(self):
        if self.doctor_name:
            self.doctor_name = self.doctor_name.strip()
