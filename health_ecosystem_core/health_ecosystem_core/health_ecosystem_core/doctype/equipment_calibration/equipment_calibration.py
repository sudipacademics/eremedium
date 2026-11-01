# Copyright (c) 2026, Health Ecosystem and contributors
# License: MIT

from frappe.model.document import Document


class EquipmentCalibration(Document):
	def after_insert(self):
		self._sync_equipment_dates()

	def on_update(self):
		self._sync_equipment_dates()

	def _sync_equipment_dates(self):
		record_type = getattr(self, "record_type", None) or "Calibration"
		if record_type == "Preventive Maintenance":
			if (self.outcome or "") not in ("Accepted", "Conditional", "Completed", "Partial"):
				return
			try:
				from health_ecosystem_core.health_ecosystem_core.clinical_phase97_equipment_assets import (
					apply_maintenance_to_equipment_from_calibration,
				)

				apply_maintenance_to_equipment_from_calibration(self)
			except Exception:
				import frappe

				frappe.log_error(title="equipment_pm_sync", message=frappe.get_traceback())
			return
		if (self.outcome or "") not in ("Accepted", "Conditional"):
			return
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase97_equipment_assets import (
				apply_calibration_to_equipment,
			)

			apply_calibration_to_equipment(self)
		except Exception:
			import frappe

			frappe.log_error(title="equipment_calibration_sync", message=frappe.get_traceback())
