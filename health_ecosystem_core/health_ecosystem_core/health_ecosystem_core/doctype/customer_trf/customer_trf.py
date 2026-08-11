import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime, random_string


def generate_unique_customer_trf_barcode(franchisee_id=None, max_attempts=16):
	"""ERP-owned unique barcode for Customer TRF (all booking inputs).

	Format: {branch_code|GEN}-{10 random}. Collision retries until free or exhausted.
	"""
	prefix = None
	if franchisee_id:
		prefix = frappe.db.get_value("Franchisee Profile", franchisee_id, "branch_code")
	prefix = (prefix or "GEN").strip() or "GEN"
	for _ in range(int(max_attempts or 16)):
		code = f"{prefix}-{random_string(10).upper()}"
		if not frappe.db.exists("Customer TRF", {"unique_barcode": code}):
			return code
	frappe.throw(_("Unable to allocate a unique Customer TRF barcode. Please try again."))


class CustomerTRF(Document):
	def before_insert(self):
		if not (self.unique_barcode or "").strip():
			self.unique_barcode = generate_unique_customer_trf_barcode(self.franchisee_id)

	def validate(self):
		self._sync_test_lines()

	def _sync_test_lines(self):
		from health_ecosystem_core.health_ecosystem_core.clinical_utils import sync_trf_test_lines

		sync_trf_test_lines(self)

	def _generate_barcode(self):
		# Kept for callers/tests; prefer generate_unique_customer_trf_barcode.
		return generate_unique_customer_trf_barcode(self.franchisee_id)

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
