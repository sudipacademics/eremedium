import frappe
from frappe.model.document import Document


class NursingAssessment(Document):
    def before_insert(self):
        if not self.recorded_by:
            self.recorded_by = frappe.session.user

    def after_insert(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import on_nursing_assessment_after_insert

        on_nursing_assessment_after_insert(self)
