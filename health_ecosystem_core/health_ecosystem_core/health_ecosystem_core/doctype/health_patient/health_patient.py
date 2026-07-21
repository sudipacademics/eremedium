import frappe
from frappe.model.document import Document
from frappe.utils import add_years, today


class HealthPatient(Document):
    def before_insert(self):
        if not self.customer and self.patient_name:
            self.customer = self._ensure_customer()

    def _ensure_customer(self):
        if frappe.db.exists("Customer", self.patient_name):
            return self.patient_name
        customer = frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": self.patient_name,
                "customer_type": "Individual",
                "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
                or "Individual",
                "territory": frappe.db.get_single_value("Selling Settings", "territory") or "All Territories",
                "mobile_no": self.mobile,
                "email_id": self.email,
            }
        )
        customer.insert(ignore_permissions=True)
        return customer.name


def approx_dob_from_age(age):
    try:
        age = int(age)
        if age > 0:
            return add_years(today(), -age)
    except Exception:
        pass
    return None
