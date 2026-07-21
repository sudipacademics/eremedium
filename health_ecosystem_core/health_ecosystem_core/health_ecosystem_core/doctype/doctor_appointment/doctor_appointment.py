import frappe
from frappe.model.document import Document


class DoctorAppointment(Document):
    def before_insert(self):
        if self.doctor and not self.doctor_name:
            self.doctor_name = frappe.db.get_value("Doctor", self.doctor, "doctor_name")
        if self.patient and not self.patient_name:
            self.patient_name = frappe.db.get_value("Health Patient", self.patient, "patient_name")

    def after_insert(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import on_doctor_appointment_after_insert

        on_doctor_appointment_after_insert(self)
