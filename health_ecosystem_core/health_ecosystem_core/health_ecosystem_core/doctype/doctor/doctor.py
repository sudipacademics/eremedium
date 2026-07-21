import frappe
from frappe.model.document import Document


class Doctor(Document):
    def validate(self):
        if not self.doctor_name and self.user:
            user = frappe.get_doc("User", self.user)
            self.doctor_name = user.full_name or user.name
