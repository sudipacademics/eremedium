import frappe
from frappe.model.document import Document


class ClinicalPrescription(Document):
    def validate(self):
        for row in self.medicines or []:
            if row.medicine_item and not row.salt:
                row.salt = _resolve_salt(row.medicine_item)


def _resolve_salt(item_code):
    item = frappe.db.get_value(
        "Item",
        item_code,
        ["generic_name", "item_group"],
        as_dict=True,
    )
    if not item:
        return None
    if item.generic_name:
        return item.generic_name
    if item.item_group:
        return frappe.db.get_value("Item Group", item.item_group, "generic_name")
    return None
