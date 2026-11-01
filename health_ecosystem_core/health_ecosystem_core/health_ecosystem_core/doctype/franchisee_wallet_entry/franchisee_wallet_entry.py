import frappe
from frappe.model.document import Document
from frappe.utils import flt


class FranchiseeWalletEntry(Document):
    def after_insert(self):
        recompute_wallet_balance(self.franchisee)

    def on_update(self):
        recompute_wallet_balance(self.franchisee)

    def after_delete(self):
        if self.franchisee:
            recompute_wallet_balance(self.franchisee)


def recompute_wallet_balance(franchisee: str) -> float:
    if not franchisee:
        return 0.0
    rows = frappe.get_all(
        "Franchisee Wallet Entry",
        filters={"franchisee": franchisee},
        fields=["entry_type", "amount"],
    )
    balance = 0.0
    for row in rows:
        amt = flt(row.amount)
        if row.entry_type == "Debit":
            balance -= abs(amt)
        else:
            balance += amt
    if frappe.db.exists("Franchisee Profile", franchisee):
        frappe.db.set_value(
            "Franchisee Profile",
            franchisee,
            "wallet_balance",
            balance,
            update_modified=False,
        )
    return balance
