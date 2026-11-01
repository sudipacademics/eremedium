# Copyright (c) 2026 and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class JobRequisition(Document):
	"""Internal headcount requisition (ATS).

	Relationship: optional ``job_opening`` links to HRMS Job Opening used by
	Phase 73b Careers portal. Do not treat this as a duplicate of Job Opening.
	"""

	def validate(self):
		if self.job_title:
			self.job_title = self.job_title.strip()
		if self.target_headcount is not None and self.target_headcount < 1:
			frappe.throw(_("Target Headcount must be at least 1"), frappe.ValidationError)
		if self.job_opening and not frappe.db.exists("DocType", "Job Opening"):
			frappe.throw(
				_("HRMS Job Opening is not installed; clear Published Job Opening."),
				frappe.ValidationError,
			)
		if self.job_opening and frappe.db.exists("DocType", "Job Opening"):
			if not frappe.db.exists("Job Opening", self.job_opening):
				frappe.throw(
					_("Published Job Opening {0} does not exist").format(self.job_opening),
					frappe.ValidationError,
				)
