import frappe
from frappe.model.document import Document
from frappe.utils import flt


class LabTestPanel(Document):
    def validate(self):
        total = 0
        for row in self.tests or []:
            if row.item and not row.item_name:
                row.item_name = frappe.db.get_value("Item", row.item, "item_name")
            if row.item:
                total += flt(_resolve_selling_rate(row.item))
        if not flt(self.panel_rate):
            self.panel_rate = total


def _resolve_selling_rate(item_code):
    from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate as resolve

    return resolve(item_code)
