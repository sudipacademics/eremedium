# Copyright (c) 2026, Health Ecosystem and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class HECWBPostalLocality(Document):
	def before_insert(self):
		self._set_geo_key()

	def before_save(self):
		self._set_geo_key()

	def _set_geo_key(self):
		parts = [
			(self.district or "").strip(),
			(self.subdivision or "").strip(),
			(self.block_area or "").strip(),
			(self.pincode or "").strip(),
		]
		self.geo_key = "|".join(parts)
