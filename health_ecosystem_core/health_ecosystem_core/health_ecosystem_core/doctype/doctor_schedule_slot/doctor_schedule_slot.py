import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_time


class DoctorScheduleSlot(Document):
    def validate(self):
        if self.from_time and self.to_time and get_time(self.from_time) >= get_time(self.to_time):
            frappe.throw(_("From Time must be before To Time"))
