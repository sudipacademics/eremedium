import frappe
from frappe.model.document import Document
from frappe.utils import cint


class DiagnosticTestMaster(Document):
    def validate(self):
        layout = (getattr(self, "result_layout", None) or "Numeric Profile").strip()
        if layout == "Descriptive":
            self.is_descriptive = 1
        if layout == "Table Matrix":
            self.is_table_format = 1
        if layout == "Graph + Values":
            self.allow_graph_upload = 1
        if layout == "Composite Linked":
            self.has_linked_clinical_fields = 1
        if cint(getattr(self, "uses_age_related_ranges", 0)) and not (self.reference_ranges or []):
            # Allow empty during create; warn only when parameters exist
            pass
        for row in self.reference_ranges or []:
            if not (row.parameter_code or "").strip() and (row.parameter_name or "").strip():
                # Prefer matching existing parameter code by name
                for p in self.parameters or []:
                    if (p.parameter_name or "").strip().lower() == (row.parameter_name or "").strip().lower():
                        row.parameter_code = p.parameter_code or p.parameter_name
                        break
            if not (row.parameter_code or "").strip():
                frappe.throw("Reference range rows require a Parameter Code")
        for row in self.parameters or []:
            if not getattr(row, "result_input_type", None):
                row.result_input_type = "Numeric"
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
