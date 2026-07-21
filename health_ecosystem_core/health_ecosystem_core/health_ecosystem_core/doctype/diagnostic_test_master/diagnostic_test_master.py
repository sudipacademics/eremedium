import frappe
from frappe.model.document import Document
from frappe.utils import cint


class DiagnosticTestMaster(Document):
    def validate(self):
        for row in self.parameters or []:
            kind = (getattr(row, "parameter_kind", None) or "").strip()
            calc = cint(getattr(row, "is_calculated", 0))
            if kind == "Calculated" or calc:
                row.parameter_kind = "Calculated"
                row.is_calculated = 1
                # Calculated / derived params never consume reagents
                if getattr(row, "reagent_item", None):
                    row.reagent_item = None
                    row.reagent_qty = 0
            else:
                row.parameter_kind = "Real"
                row.is_calculated = 0
