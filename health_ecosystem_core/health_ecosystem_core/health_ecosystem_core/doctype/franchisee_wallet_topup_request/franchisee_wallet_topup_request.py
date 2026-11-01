import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

REVIEWER_ROLES = ("System Manager", "Health System Admin", "Accounts Manager")


class FranchiseeWalletTopupRequest(Document):
    def validate(self):
        if self.is_new():
            self.status = "Pending"
            return
        previous = self.get_doc_before_save()
        if not previous or previous.status == self.status:
            return
        if previous.status != "Pending":
            frappe.throw(_("A reviewed top-up request cannot be changed."))
        if frappe.session.user != "Administrator" and not set(REVIEWER_ROLES) & set(frappe.get_roles()):
            frappe.throw(_("Only finance or admin users can review wallet top-up requests."), frappe.PermissionError)
        for field in ("franchisee", "amount", "payment_reference"):
            if previous.get(field) != self.get(field):
                frappe.throw(_("Franchisee, amount and reference cannot be edited during review."))
        self.reviewed_by = frappe.session.user
        self.reviewed_at = now_datetime()

    def on_update(self):
        if self.status != "Approved" or self.wallet_transaction:
            return
        from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import credit_b2b_wallet

        row = credit_b2b_wallet(
            self.franchisee,
            flt(self.amount),
            payment_reference=self.payment_reference,
            remarks=_("Offline {0} top-up approved ({1})").format(self.payment_mode or "bank", self.name),
        )
        self.db_set("wallet_transaction", row.get("transaction_id"))

        from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import book_wallet_topup

        book_wallet_topup(
            "b2b",
            self.franchisee,
            flt(self.amount),
            self.payment_reference or self.name,
            source="cash" if self.payment_mode == "Cash" else "bank",
        )
