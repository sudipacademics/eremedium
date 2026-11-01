import frappe
from frappe import _
from frappe.model.document import Document

PROVIDER_FIELDS = (
    "provider_patient_checkout",
    "provider_subscriptions",
    "provider_patient_wallet",
    "provider_b2b_wallet",
    "provider_ffms_fees",
)


class HECPaymentSettings(Document):
    def validate(self):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import icici_available

        if icici_available():
            return
        for field in PROVIDER_FIELDS:
            if self.get(field) == "ICICI":
                frappe.throw(
                    _("ICICI cannot be selected yet: the ICICI API credentials are not configured on the server.")
                )
