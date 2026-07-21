import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class LabTestResult(Document):
    def validate(self):
        if not self.verification_timestamp:
            self.verification_timestamp = now_datetime()

        if not self.customer_trf and self.barcode_link:
            trf = frappe.db.get_value(
                "Customer TRF",
                {"unique_barcode": self.barcode_link},
                "name",
            )
            if trf:
                self.customer_trf = trf
