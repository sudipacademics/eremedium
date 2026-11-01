import frappe
from frappe.model.document import Document


class FranchiseeProfile(Document):
    def validate(self):
        if self.commission_percentage_rate and self.commission_percentage_rate > 100:
            frappe.throw("Commission percentage cannot exceed 100%")
        if self.override_upsell_commission and self.override_upsell_commission > 100:
            frappe.throw("Override upsell commission cannot exceed 100%")
        if self.parent_foco:
            if self.parent_foco == self.name:
                frappe.throw("A FOFO cannot be mapped under itself")
            if not frappe.flags.allow_parent_foco_remap and not self.is_new():
                previous = frappe.db.get_value("Franchisee Profile", self.name, "parent_foco")
                if previous and previous != self.parent_foco:
                    roles = set(frappe.get_roles())
                    if "System Manager" not in roles and "Health System Admin" not in roles:
                        frappe.throw(
                            "FOFO \u2192 FOCO mapping is permanent. Only a System Manager can remap."
                        )
        if self.override_upsell_commission in (None, ""):
            self.override_upsell_commission = 20
        if not self.get("franchisee_type"):
            self.franchisee_type = "Pulse"
        if not self.get("commission_base"):
            self.commission_base = "Franchisee Rate"
        if self.franchisee_fee in (None, ""):
            self.franchisee_fee = 80000
        if self.wallet_balance in (None, ""):
            self.wallet_balance = 0
        from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
            validate_partner_circuit,
        )

        validate_partner_circuit(self)

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
