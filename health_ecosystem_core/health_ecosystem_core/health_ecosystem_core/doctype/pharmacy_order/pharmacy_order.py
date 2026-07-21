import frappe
from frappe.model.document import Document


class PharmacyOrder(Document):
    def after_insert(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import on_pharmacy_order_after_insert

        on_pharmacy_order_after_insert(self)
