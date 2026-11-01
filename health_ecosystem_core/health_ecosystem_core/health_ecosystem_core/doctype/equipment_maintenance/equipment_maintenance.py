# Copyright (c) 2026, Health Ecosystem and contributors
# License: MIT

from frappe.model.document import Document


class EquipmentMaintenance(Document):
	def after_insert(self):
		self._sync_equipment_dates()

	def on_update(self):
		self._sync_equipment_dates()

	def _sync_equipment_dates(self):
		if (self.outcome or "") not in ("Completed", "Partial"):
			return
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase97_equipment_assets import (
				apply_maintenance_to_equipment,
			)

			apply_maintenance_to_equipment(self)
		except Exception:
			import frappe

			frappe.log_error(title="equipment_maintenance_sync", message=frappe.get_traceback())
