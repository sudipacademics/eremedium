import frappe
from frappe.model.document import Document


class FranchiseeProfile(Document):
    def validate(self):
        if self.commission_percentage_rate and self.commission_percentage_rate > 100:
            frappe.throw("Commission percentage cannot exceed 100%")
        if not self.get("franchisee_type"):
            self.franchisee_type = "Pulse"
        if not self.get("commission_base"):
            self.commission_base = "Franchisee Rate"
        if self.franchisee_fee in (None, ""):
            self.franchisee_fee = 80000
        if self.wallet_balance in (None, ""):
            self.wallet_balance = 0

    def on_update(self):
        if frappe.flags.in_import or frappe.flags.in_migrate:
            return
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import (
                assign_shared_price_lists,
            )

            assign_shared_price_lists(self)
        except Exception:
            frappe.log_error(title="franchisee shared price lists", message=frappe.get_traceback())
