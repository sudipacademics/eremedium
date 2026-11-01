# Copyright (c) 2026 and contributors
# For license information, please see license.txt

"""Override HRMS Job Applicant with ATS hire-to-Employee draft behaviour.

Registered via hooks.override_doctype_class. Extends (does not replace) the
careers pipeline in clinical_phase73b / 73e.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, today

try:
	from hrms.hr.doctype.job_applicant.job_applicant import JobApplicant as HRMSJobApplicant
except Exception:  # pragma: no cover - HRMS may be absent on some benches
	try:
		from erpnext.hr.doctype.job_applicant.job_applicant import JobApplicant as HRMSJobApplicant
	except Exception:
		HRMSJobApplicant = Document

ATS_STATUS_HIRED = "Hired"
ATS_STATUS_NEW = "New"


class JobApplicant(HRMSJobApplicant):
	def validate(self):
		super().validate()
		self._ats_sync_name_fields()
		self._ats_default_status()
		self._ats_sync_status_with_pipeline()
		self._ats_sync_job_opening_from_requisition()

	def on_update(self):
		super().on_update()
		self._ats_maybe_draft_employee()

	def before_insert(self):
		if hasattr(super(), "before_insert"):
			super().before_insert()
		self._ats_default_status()
		self._ats_sync_status_with_pipeline()

	def _ats_default_status(self):
		if not self.meta.has_field("hec_applicant_status"):
			return
		if not self.hec_applicant_status:
			self.hec_applicant_status = ATS_STATUS_NEW

	def _ats_sync_status_with_pipeline(self):
		"""Keep Desk ATS status and Careers pipeline stage aligned (Phase 112)."""
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring import (
				sync_ats_pipeline_status,
			)

			prefer = "ats"
			if self.has_value_changed("hec_pipeline_stage") and not self.has_value_changed(
				"hec_applicant_status"
			):
				prefer = "pipeline"
			elif self.has_value_changed("hec_applicant_status"):
				prefer = "ats"
			else:
				prefer = "fill"
			sync_ats_pipeline_status(self, prefer=prefer)
		except Exception:
			pass

	def _ats_sync_name_fields(self):
		"""Keep HRMS applicant_name in sync with First/Last Name custom fields."""
		first = (getattr(self, "hec_first_name", None) or "").strip()
		last = (getattr(self, "hec_last_name", None) or "").strip()
		if first or last:
			full = f"{first} {last}".strip()
			if self.meta.has_field("applicant_name") and full:
				self.applicant_name = full
			return

		name = (getattr(self, "applicant_name", None) or "").strip()
		if not name:
			return
		parts = name.split(None, 1)
		if self.meta.has_field("hec_first_name") and not first:
			self.hec_first_name = parts[0]
		if self.meta.has_field("hec_last_name") and len(parts) > 1 and not last:
			self.hec_last_name = parts[1]

	def _ats_sync_job_opening_from_requisition(self):
		"""Map Applied For (Job Requisition) → HRMS job_title (Job Opening) when empty."""
		requisition = getattr(self, "hec_applied_for", None)
		if not requisition or not frappe.db.exists("Job Requisition", requisition):
			return
		jr = frappe.db.get_value(
			"Job Requisition",
			requisition,
			["job_opening", "job_title"],
			as_dict=True,
		) or {}
		if self.meta.has_field("job_title") and not self.job_title:
			opening = jr.get("job_opening")
			if opening and frappe.db.exists("DocType", "Job Opening") and frappe.db.exists(
				"Job Opening", opening
			):
				self.job_title = opening

	def _ats_maybe_draft_employee(self):
		if not self.meta.has_field("hec_applicant_status"):
			return
		if self.hec_applicant_status != ATS_STATUS_HIRED:
			return
		if not self.has_value_changed("hec_applicant_status"):
			return
		try:
			create_draft_employee_from_applicant(self)
		except frappe.ValidationError:
			raise
		except Exception:
			frappe.log_error(title="ats_draft_employee", message=frappe.get_traceback())
			frappe.throw(
				_("Could not draft Employee from this applicant. See Error Log."),
				frappe.ValidationError,
			)


def create_draft_employee_from_applicant(applicant) -> str | None:
	"""Create an Inactive Employee draft from Job Applicant for HR review.

	Guards against duplicates; never overwrites an existing Employee record.
	Employee is not submittable — ``status=Inactive`` is the review draft state.
	"""
	if not frappe.db.exists("DocType", "Employee"):
		frappe.throw(
			_("Employee DocType is not installed (HRMS/ERPNext HR required)"),
			frappe.ValidationError,
		)

	linked = getattr(applicant, "hec_employee", None)
	if linked and frappe.db.exists("Employee", linked):
		frappe.msgprint(
			_("Employee {0} is already linked to this applicant; not overwritten.").format(linked),
			indicator="blue",
			alert=True,
		)
		return linked

	email = (getattr(applicant, "email_id", None) or "").strip().lower()
	phone = (
		getattr(applicant, "hec_mobile", None)
		or getattr(applicant, "phone_number", None)
		or ""
	).strip()
	first = (getattr(applicant, "hec_first_name", None) or "").strip()
	last = (getattr(applicant, "hec_last_name", None) or "").strip()
	if not first:
		full = (getattr(applicant, "applicant_name", None) or "").strip()
		parts = full.split(None, 1) if full else []
		first = parts[0] if parts else (email.split("@")[0] if email else "Applicant")
		last = last or (parts[1] if len(parts) > 1 else "")

	existing = _find_existing_employee(email=email, phone=phone)
	if existing:
		_link_employee(applicant, existing)
		frappe.msgprint(
			_("Existing Employee {0} found; linked without overwrite.").format(existing),
			indicator="orange",
			alert=True,
		)
		return existing

	company = frappe.defaults.get_global_default("company")
	if not company:
		companies = frappe.get_all("Company", limit=1, pluck="name")
		company = companies[0] if companies else None
	if not company:
		frappe.throw(_("Set a default Company before drafting an Employee"), frappe.ValidationError)

	emp_meta = frappe.get_meta("Employee")
	payload = {"doctype": "Employee"}

	def _set(field, value):
		if value is None or value == "":
			return
		if emp_meta.has_field(field):
			payload[field] = value

	_set("naming_series", "HR-EMP-.#####")
	_set("first_name", first)
	_set("last_name", last or None)
	_set("employee_name", f"{first} {last}".strip())
	_set("company", company)
	_set("status", "Inactive")
	_set("date_of_joining", today())
	_set("cell_number", phone or None)
	_set("personal_email", email or None)
	_set("company_email", email or None)
	_set("prefered_email", email or None)
	_set("gender", "Other")
	_set("date_of_birth", getdate("1990-01-01"))

	if email and frappe.db.exists("User", email) and emp_meta.has_field("user_id"):
		if not frappe.db.exists("Employee", {"user_id": email}):
			_set("user_id", email)

	_apply_role_context(applicant, payload, emp_meta)

	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	doc.add_comment(
		"Comment",
		_(
			"Drafted from Job Applicant {0} (ATS Hired). Review and set Status to Active when ready."
		).format(applicant.name),
	)

	_link_employee(applicant, doc.name)
	frappe.msgprint(
		_("Draft Employee {0} created (Inactive) for HR review.").format(doc.name),
		indicator="green",
		alert=True,
	)
	return doc.name


def _find_existing_employee(email=None, phone=None):
	emp_meta = frappe.get_meta("Employee")
	if email:
		for field in ("personal_email", "company_email", "prefered_email", "user_id"):
			if not emp_meta.has_field(field):
				continue
			name = frappe.db.get_value("Employee", {field: email}, "name")
			if name:
				return name
		if frappe.db.exists("User", email):
			name = frappe.db.get_value("Employee", {"user_id": email}, "name")
			if name:
				return name
	if phone and emp_meta.has_field("cell_number"):
		name = frappe.db.get_value("Employee", {"cell_number": phone}, "name")
		if name:
			return name
	return None


def _link_employee(applicant, employee_name: str):
	if applicant.meta.has_field("hec_employee"):
		frappe.db.set_value(
			"Job Applicant",
			applicant.name,
			"hec_employee",
			employee_name,
			update_modified=False,
		)
		applicant.hec_employee = employee_name
	applicant.add_comment(
		"Comment",
		_("ATS: linked / drafted Employee {0} after status Hired.").format(employee_name),
	)


def _apply_role_context(applicant, payload: dict, emp_meta):
	requisition = getattr(applicant, "hec_applied_for", None)
	job_title = getattr(applicant, "job_title", None)
	designation = None
	department = None

	if requisition and frappe.db.exists("Job Requisition", requisition):
		jr = frappe.db.get_value(
			"Job Requisition",
			requisition,
			["job_title", "department"],
			as_dict=True,
		) or {}
		designation = jr.get("job_title")
		department = jr.get("department")

	if not designation and job_title and frappe.db.exists("DocType", "Job Opening"):
		if frappe.db.exists("Job Opening", job_title):
			designation = (
				frappe.db.get_value("Job Opening", job_title, "designation")
				or frappe.db.get_value("Job Opening", job_title, "job_title")
				or job_title
			)
			department = department or frappe.db.get_value("Job Opening", job_title, "department")

	if designation and emp_meta.has_field("designation"):
		df = emp_meta.get_field("designation")
		if df and df.fieldtype == "Link":
			if frappe.db.exists("DocType", "Designation") and frappe.db.exists("Designation", designation):
				payload["designation"] = designation
		else:
			payload["designation"] = designation

	if department and emp_meta.has_field("department"):
		df = emp_meta.get_field("department")
		if df and df.fieldtype == "Link":
			if frappe.db.exists("DocType", "Department") and frappe.db.exists("Department", department):
				payload["department"] = department
		else:
			payload["department"] = department
