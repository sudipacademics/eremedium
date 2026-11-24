"""Update patient details on a booking and the copies the partner portal reads."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_require_mobile_auth,
	_success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase123_booking_lifecycle import _scope_for_user

_GENDER = {
	"m": "Male",
	"male": "Male",
	"f": "Female",
	"female": "Female",
	"o": "Other",
	"other": "Other",
}

# Records that store a copy of the booking patient. The partner portal reads these.
_COPIES = (
	("Lab Report", ("patient_name", "gender", "age")),
	("Patient Care Journey", ("patient_name",)),
	("Lab Critical Value Alert", ("patient_name",)),
	("FOFO FOCO Commission", ("patient_name",)),
	("Referring Doctor Commission Ledger", ("patient_name",)),
)


def _bounded_int(value, low, high, label):
	if value in (None, ""):
		return 0
	number = cint(value)
	if number < low or number > high:
		frappe.throw(_("{0} must be between {1} and {2}").format(label, low, high))
	return number


def _apply_copies(doctype, trf_name, values):
	if not frappe.db.exists("DocType", doctype):
		return
	meta = frappe.get_meta(doctype)
	if not meta.has_field("customer_trf"):
		return
	fields = {key: values[key] for key in values if meta.has_field(key) and key in values}
	if not fields:
		return
	for name in frappe.get_all(doctype, filters={"customer_trf": trf_name}, pluck="name"):
		frappe.db.set_value(doctype, name, fields, update_modified=False)


def _apply_linked_patients(trf_name, patient_name, gender, phone):
	if not frappe.db.exists("DocType", "Patient Care Journey"):
		return
	seen = set()
	for row in frappe.get_all(
		"Patient Care Journey",
		filters={"customer_trf": trf_name},
		fields=["patient"],
	):
		patient = cstr(row.patient).strip()
		if not patient or patient in seen or not frappe.db.exists("Health Patient", patient):
			continue
		seen.add(patient)
		values = {"patient_name": patient_name, "gender": gender}
		if frappe.get_meta("Health Patient").has_field("mobile"):
			values["mobile"] = phone
		frappe.db.set_value("Health Patient", patient, values, update_modified=False)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def update_booking_patient(
	trf_id=None,
	patient_name=None,
	age=None,
	age_months=None,
	age_days=None,
	gender=None,
	patient_phone=None,
	sid=None,
):
	"""Save patient details on the booking and sync them to the partner portal copies."""
	if not _require_mobile_auth(_parse_request_value("sid", sid)):
		return _error(_("Not authenticated"), 401)
	scope, scoped_franchisee = _scope_for_user()
	if not scope:
		return _error(_("Not permitted"), 403)

	trf_name = cstr(_parse_request_value("trf_id", trf_id)).strip()
	if not trf_name or not frappe.db.exists("Customer TRF", trf_name):
		found = frappe.db.get_value("Customer TRF", {"unique_barcode": trf_name}, "name") if trf_name else None
		trf_name = found or ""
	if not trf_name:
		return _error(_("Booking not found"), 404)

	franchisee_id = frappe.db.get_value("Customer TRF", trf_name, "franchisee_id")
	if scope == "franchisee" and franchisee_id != scoped_franchisee:
		return _error(_("Not permitted"), 403)

	name = " ".join(cstr(_parse_request_value("patient_name", patient_name)).split())
	if not name:
		return _error(_("Patient name is required"))
	if len(name) > 140:
		return _error(_("Patient name is too long"))

	gender_key = cstr(_parse_request_value("gender", gender)).strip().lower()
	gender_value = _GENDER.get(gender_key)
	if not gender_value:
		return _error(_("Gender must be Male, Female, or Other"))

	try:
		years = _bounded_int(_parse_request_value("age", age), 0, 130, _("Age (years)"))
		months = _bounded_int(_parse_request_value("age_months", age_months), 0, 11, _("Age (months)"))
		days = _bounded_int(_parse_request_value("age_days", age_days), 0, 31, _("Age (days)"))
	except frappe.ValidationError as exc:
		return _error(str(exc))

	phone = "".join(ch for ch in cstr(_parse_request_value("patient_phone", patient_phone)) if ch.isdigit())
	if phone and not 8 <= len(phone) <= 15:
		return _error(_("Enter a valid phone number"))

	trf_values = {
		"patient_name": name,
		"age": years,
		"age_months": months,
		"age_days": days,
		"gender": gender_value,
		"patient_phone": phone,
	}
	frappe.db.set_value("Customer TRF", trf_name, trf_values, update_modified=True)

	copy_values = {"patient_name": name, "gender": gender_value, "age": years, "patient_phone": phone}
	for doctype, fields in _COPIES:
		_apply_copies(doctype, trf_name, {key: copy_values[key] for key in fields})
	_apply_linked_patients(trf_name, name, gender_value, phone)

	return _success(
		{"trf_id": trf_name, **trf_values},
		message=_("Patient details updated on this booking and the partner portal"),
	)
