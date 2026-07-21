import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class LabReport(Document):
    def before_insert(self):
        if not self.lab_no:
            self.lab_no = self.name or ""

    def validate(self):
        if not self.report_date:
            self.report_date = now_datetime()
        if not self.lab_receipt_date:
            self.lab_receipt_date = now_datetime()
        from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
            apply_calculated_parameters,
        )

        apply_calculated_parameters(self)

    def before_save(self):
        if self.report_status == "Printed" and not self.printed_on:
            self.printed_on = now_datetime()

    def on_update(self):
        if frappe.flags.in_import or frappe.flags.in_migrate:
            return
        if self.has_value_changed("report_status") and self.report_status in ("Authorized", "Printed"):
            try:
                from health_ecosystem_core.health_ecosystem_core.clinical_phase53_critical_alerts import (
                    process_lab_report_critical_alerts,
                )

                process_lab_report_critical_alerts(self.name)
            except Exception:
                frappe.log_error(title="lab_report critical alerts", message=frappe.get_traceback())
