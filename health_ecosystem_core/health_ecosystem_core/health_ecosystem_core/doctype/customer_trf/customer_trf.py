import frappe
from frappe.model.document import Document
from frappe.utils import flt, now_datetime, random_string


class CustomerTRF(Document):
    def before_insert(self):
        if not self.unique_barcode:
            self.unique_barcode = self._generate_barcode()

    def validate(self):
        self._sync_test_lines()

    def _sync_test_lines(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_utils import sync_trf_test_lines

        sync_trf_test_lines(self)

    def _generate_barcode(self):
        prefix = frappe.db.get_value(
            "Franchisee Profile", self.franchisee_id, "branch_code"
        ) or "GEN"
        return f"{prefix}-{random_string(10).upper()}"

    def on_update(self):
        if self.order_status == "Completed" and not frappe.flags.in_import:
            self._notify_completion()
        if self.has_value_changed("order_status") and self.order_status == "Completed":
            from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
                maybe_consume_reagents_on_trf_complete,
            )

            maybe_consume_reagents_on_trf_complete(self.name)
        if self.has_value_changed("order_status") or self.has_value_changed("health_patient"):
            from health_ecosystem_core.health_ecosystem_core.clinical_workflow import on_customer_trf_on_update

            on_customer_trf_on_update(self)

    def after_insert(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_workflow import on_customer_trf_after_insert

        on_customer_trf_after_insert(self)

    def _notify_completion(self):
        frappe.publish_realtime(
            "trf_completed",
            {"barcode": self.unique_barcode, "trf": self.name},
            user=frappe.session.user,
        )
