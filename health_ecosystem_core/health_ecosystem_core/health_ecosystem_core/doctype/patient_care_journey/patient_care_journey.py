import frappe
from frappe.model.document import Document


JOURNEY_STATES = [
    "Nursing Intake",
    "Doctor Consultation",
    "Prescription Issued",
    "Medicine Ordered",
    "Diagnostics Booked",
    "Phlebotomist Assigned",
    "Sample Collected",
    "In Lab",
    "Report Review",
    "Authorized",
    "Dispatched",
]


class PatientCareJourney(Document):
    def validate(self):
        if self.status and self.status not in JOURNEY_STATES:
            frappe.throw(f"Invalid journey status: {self.status}")
