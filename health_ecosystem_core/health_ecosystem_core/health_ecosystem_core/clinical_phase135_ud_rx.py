"""Phase 135 — Uber Doc e-Rx engine: Digital Prescription, Prescription Pad endpoints, PDF / JSON, public verify, EMR push.

- Digital Prescription is the structured record (complaints, ICD-10 diagnoses, vitals with BMI, medications, test
  recommendations, yoga / exercise / tutorial plans, advice, follow-up). Only Verified providers can sign; medicines
  only when the provider can_prescribe_medicines (Verified Doctors). Signed prescriptions are immutable (cancel only).
- Signing renders a private PDF (with a QR of the verify URL when pyqrcode is available), stores the canonical rx_json
  and its SHA-256, upserts an EMR Record (clinical_emr) and queues the signed EMR webhooks.
- For Doctor-category providers with a Remedium patient, the Item-linked medicines / tests are mirrored into a submitted
  Clinical Prescription so phase 50 pharmacy fulfilment ("Order medicines") keeps working; free-text drugs stay on the
  Digital Prescription only (Prescription Medicine requires an Item).
- ICD-10: no external catalogue is shipped. Codes are free entry with format validation; every code used on a signed
  prescription is remembered in Uber Doc ICD Code (operations can curate descriptions) and feeds the autocomplete.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import secrets

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import PATIENT_DT, UPI_FIELD, _perms, _sel
from health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc import (
	BOOKING_DT,
	ICD_DT,
	MODE_LABEL,
	PRESCRIBER_CATEGORY,
	PROGRAM_DT,
	PROVIDER_DT,
	QUAL_DT,
	ROLE_MANAGER,
	ST_CANCELLED,
	TUTORIAL_PROGRAM,
	_booking,
	_deny,
	_fail,
	_guest,
	_has_field,
	_iso,
	_lock,
	_missing,
	_notify,
	_parse,
	_rate_limit,
	_request_ip,
	_run,
	_save_file,
	_text,
	app_url,
	booking_party,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx"
RX_DT = "Digital Prescription"
COMPLAINT_DT = "Rx Complaint"
DIAGNOSIS_DT = "Rx Diagnosis"
MEDICATION_DT = "Rx Medication"
TEST_DT = "Rx Test Recommendation"
EXERCISE_DT = "Rx Exercise Plan"
CP_DT = "Clinical Prescription"
ITEM_DT = "Item"
DTM_DT = "Diagnostic Test Master"
VITAL_DT = "Patient Vital Log"

RX_STATUSES = ("Draft", "Signed", "Cancelled")
DIAGNOSIS_TYPES = ("Provisional", "Final")
ROUTES = ("Oral", "Sublingual", "Topical", "Inhalation", "Nasal", "Ophthalmic", "Otic", "IV", "IM", "SC", "Rectal", "Other")
CP_ROUTES = {"Oral": "Oral", "Sublingual": "Oral", "Topical": "Topical", "Inhalation": "Inhalation", "IV": "IV", "IM": "IM"}
TIMINGS = ("After Food", "Before Food", "With Food", "Empty Stomach", "Bedtime", "Any Time")
GLUCOSE_CONTEXTS = ("Fasting", "Random", "Post-prandial")
# The second character may be a letter: ICD-10-CM FY2027 adds codes such as QA1.71.
ICD_RE = re.compile(r"^[A-Z][0-9A-Z][0-9A-Z](\.[0-9A-Z]{1,4})?$")
VERIFY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
SCHEMA = "uberdoc.erx.v1"
VERIFY_IP_LIMIT = 120
VITAL_LIMITS = {
	"bp_systolic": (50, 260),
	"bp_diastolic": (30, 160),
	"pulse": (20, 250),
	"temperature_c": (30, 45),
	"spo2": (50, 100),
	"weight_kg": (0.5, 350),
	"height_cm": (30, 250),
	"respiratory_rate": (5, 80),
	"blood_glucose": (20, 800),
}
VITAL_LABELS = {
	"bp_systolic": "BP systolic (mmHg)",
	"bp_diastolic": "BP diastolic (mmHg)",
	"pulse": "Pulse (/min)",
	"temperature_c": "Temperature (°C)",
	"spo2": "SpO2 (%)",
	"weight_kg": "Weight (kg)",
	"height_cm": "Height (cm)",
	"respiratory_rate": "Respiratory rate (/min)",
	"blood_glucose": "Blood glucose (mg/dL)",
}
MAX_ROWS = 40


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def rx_doctype_specs():
	managers = ("System Manager", "Health System Admin", ROLE_MANAGER)
	vitals = [{"fieldname": "vitals_section", "label": "Vitals", "fieldtype": "Section Break"}]
	for key, (_lo, _hi) in VITAL_LIMITS.items():
		vitals.append({"fieldname": key, "label": VITAL_LABELS[key], "fieldtype": "Float", "precision": "1"})
	vitals += [
		{"fieldname": "glucose_context", "label": "Glucose Context", "fieldtype": "Select", "options": "\n" + _sel(GLUCOSE_CONTEXTS)},
		{"fieldname": "bmi", "label": "BMI", "fieldtype": "Float", "precision": "1", "read_only": 1},
	]
	def child(name, fields):
		return (name, fields, [], 1, "hash", None)

	return [
		child(
			COMPLAINT_DT,
			[
				{"fieldname": "complaint", "label": "Complaint", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "duration", "label": "Since", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Data", "in_list_view": 1},
			],
		),
		child(
			DIAGNOSIS_DT,
			[
				{"fieldname": "icd_code", "label": "ICD-10", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "description", "label": "Diagnosis", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "diagnosis_type", "label": "Type", "fieldtype": "Select", "options": _sel(DIAGNOSIS_TYPES), "default": "Provisional", "in_list_view": 1},
			],
		),
		child(
			MEDICATION_DT,
			[
				{"fieldname": "medicine_item", "label": "Medicine (catalogue)", "fieldtype": "Link", "options": ITEM_DT},
				{"fieldname": "drug_name", "label": "Drug", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "strength", "label": "Strength / Dosage", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "dose", "label": "Dose", "fieldtype": "Data"},
				{"fieldname": "frequency", "label": "Frequency", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "duration", "label": "Duration", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "route", "label": "Route", "fieldtype": "Select", "options": _sel(ROUTES), "default": "Oral"},
				{"fieldname": "timing", "label": "Timing", "fieldtype": "Select", "options": _sel(TIMINGS), "default": "After Food"},
				{"fieldname": "instructions", "label": "Instructions", "fieldtype": "Data"},
			],
		),
		child(
			TEST_DT,
			[
				{"fieldname": "diagnostic_test", "label": "Diagnostic Test", "fieldtype": "Link", "options": DTM_DT},
				{"fieldname": "item", "label": "Test Item", "fieldtype": "Link", "options": ITEM_DT},
				{"fieldname": "test_name", "label": "Test", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Data", "in_list_view": 1},
			],
		),
		child(
			EXERCISE_DT,
			[
				{"fieldname": "tutorial_program", "label": "Tutorial Programme", "fieldtype": "Link", "options": PROGRAM_DT},
				{"fieldname": "exercise_name", "label": "Exercise / Practice", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "sets", "label": "Sets", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "reps", "label": "Reps", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "duration_min", "label": "Minutes", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "frequency", "label": "Frequency", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Data"},
			],
		),
		(
			RX_DT,
			[
				{"fieldname": "booking", "label": "Booking", "fieldtype": "Link", "options": BOOKING_DT, "reqd": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(RX_STATUSES), "default": "Draft", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "rx_date", "label": "Date", "fieldtype": "Date", "in_list_view": 1},
				{"fieldname": "provider", "label": "Provider", "fieldtype": "Link", "options": PROVIDER_DT, "reqd": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "provider_name", "label": "Provider Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "provider_category", "label": "Provider Category", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "provider_registration_no", "label": "Registration No.", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "provider_registration_council", "label": "Registration Council", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "provider_qualification", "label": "Qualifications", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "patient_section", "label": "Patient", "fieldtype": "Section Break"},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "patient_age", "label": "Age", "fieldtype": "Data"},
				{"fieldname": "patient_gender", "label": "Gender", "fieldtype": "Select", "options": "\nMale\nFemale\nOther"},
				{"fieldname": UPI_FIELD, "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "customer_profile", "label": "Customer Profile", "fieldtype": "Link", "options": "Customer Profile", "read_only": 1},
				{"fieldname": "clinical_section", "label": "Clinical", "fieldtype": "Section Break"},
				{"fieldname": "complaints", "label": "Chief Complaints", "fieldtype": "Table", "options": COMPLAINT_DT},
				{"fieldname": "diagnoses", "label": "Diagnosis (ICD-10)", "fieldtype": "Table", "options": DIAGNOSIS_DT},
				{"fieldname": "clinical_notes", "label": "Clinical Notes", "fieldtype": "Small Text"},
				*vitals,
				{"fieldname": "rx_section", "label": "Prescription", "fieldtype": "Section Break"},
				{"fieldname": "medications", "label": "Medications", "fieldtype": "Table", "options": MEDICATION_DT},
				{"fieldname": "tests", "label": "Test Recommendations", "fieldtype": "Table", "options": TEST_DT},
				{"fieldname": "exercises", "label": "Yoga / Exercise / Tutorial Plan", "fieldtype": "Table", "options": EXERCISE_DT},
				{"fieldname": "advice", "label": "Advice", "fieldtype": "Small Text"},
				{"fieldname": "follow_up_date", "label": "Follow-up Date", "fieldtype": "Date"},
				{"fieldname": "sign_section", "label": "Signature", "fieldtype": "Section Break"},
				{"fieldname": "signed_on", "label": "Signed On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "signed_by", "label": "Signed By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "signature_hash", "label": "Content SHA-256", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "verify_code", "label": "Verify Code", "fieldtype": "Data", "unique": 1, "read_only": 1, "search_index": 1},
				{"fieldname": "pdf_file", "label": "PDF (private)", "fieldtype": "Attach", "read_only": 1},
				{"fieldname": "rx_json", "label": "Canonical JSON", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "clinical_prescription", "label": "Clinical Prescription (pharmacy)", "fieldtype": "Link", "options": CP_DT, "read_only": 1},
				{"fieldname": "emr_record", "label": "EMR Record", "fieldtype": "Link", "options": "EMR Record", "read_only": 1},
				{"fieldname": "cancel_reason", "label": "Cancel Reason", "fieldtype": "Small Text", "read_only": 1},
			],
			_perms(managers, (), delete=0),
			0,
			"UDRX-.YYYY.-.#####",
			{"title_field": "patient_name", "sort_field": "creation", "sort_order": "DESC"},
		),
	]


def ensure_rx_custom_fields():
	if not frappe.db.exists("DocType", CP_DT) or not frappe.db.exists("DocType", RX_DT):
		return []
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			CP_DT: [
				{"fieldname": "digital_prescription", "label": "Uber Doc e-Rx", "fieldtype": "Link", "options": RX_DT, "insert_after": "care_journey", "read_only": 1, "no_copy": 1},
				{"fieldname": "source_app", "label": "Source App", "fieldtype": "Data", "insert_after": "digital_prescription", "read_only": 1, "no_copy": 1},
			]
		},
		update=True,
	)
	return [CP_DT]


# ---------------------------------------------------------------------------
# ICD-10
# ---------------------------------------------------------------------------


def normalize_icd(code):
	"""Upper-case, insert the dot after three characters (J069 -> J06.9); None when blank."""
	text = re.sub(r"\s+", "", cstr(code)).upper()
	if not text:
		return None
	if "." not in text and len(text) > 3:
		text = f"{text[:3]}.{text[3:]}"
	return text


def valid_icd(code):
	return bool(ICD_RE.match(cstr(code)))


def icd_search(q=None, limit=20):
	q = cstr(q).strip()
	filters = {"active": 1}
	or_filters = None
	if q:
		or_filters = [["code", "like", f"{normalize_icd(q) or q}%"], ["description", "like", f"%{q}%"]]
	rows = frappe.get_all(ICD_DT, filters=filters, or_filters=or_filters, fields=["code", "description", "usage_count"], order_by="usage_count desc, code asc", limit=min(cint(limit) or 20, 50))
	return {"rows": rows, "format_ok": valid_icd(normalize_icd(q)) if q else None, "normalized": normalize_icd(q) if q else None}


def remember_icd(code, description, source="Provider Entry"):
	code = normalize_icd(code)
	if not code or not valid_icd(code):
		return
	if frappe.db.exists(ICD_DT, code):
		frappe.db.sql(f"update `tab{ICD_DT}` set usage_count = ifnull(usage_count, 0) + 1 where name = %s", (code,))
		if description and not frappe.db.get_value(ICD_DT, code, "description"):
			frappe.db.set_value(ICD_DT, code, "description", cstr(description)[:140], update_modified=False)
		return
	try:
		frappe.get_doc({"doctype": ICD_DT, "code": code, "description": cstr(description)[:140] or None, "active": 1, "usage_count": 1, "source": source}).insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		pass


def save_icd(payload):
	p = payload or {}
	code = normalize_icd(p.get("code"))
	if not code or not valid_icd(code):
		_fail(_("ICD-10 codes look like J06.9 or E11"))
	description = cstr(p.get("description")).strip()[:140]
	if frappe.db.exists(ICD_DT, code):
		frappe.db.set_value(ICD_DT, code, {"description": description or None, "active": 0 if p.get("active") in (0, "0", False) else 1, "source": "Operations"})
	else:
		frappe.get_doc({"doctype": ICD_DT, "code": code, "description": description or None, "active": 1, "usage_count": 0, "source": "Operations"}).insert(ignore_permissions=True)
	return frappe.db.get_value(ICD_DT, code, ["code", "description", "active", "usage_count", "source"], as_dict=True)


def list_icd(q=None):
	or_filters = [["code", "like", f"%{q}%"], ["description", "like", f"%{q}%"]] if q else None
	return {"rows": frappe.get_all(ICD_DT, or_filters=or_filters, fields=["code", "description", "active", "usage_count", "source"], order_by="usage_count desc, code asc", limit=500)}


# ---------------------------------------------------------------------------
# Pickers
# ---------------------------------------------------------------------------


def med_search(q=None, limit=25):
	from health_ecosystem_core.health_ecosystem_core.api import PHARMACY_ITEM_GROUPS

	q = cstr(q).strip()
	filters = {"is_sales_item": 1, "disabled": 0, "item_group": ("in", list(PHARMACY_ITEM_GROUPS))}
	or_filters = [["name", "like", f"%{q}%"], ["item_name", "like", f"%{q}%"]] if q else None
	return {"rows": frappe.get_all(ITEM_DT, filters=filters, or_filters=or_filters, fields=["name", "item_name", "item_group"], order_by="item_name asc", limit=min(cint(limit) or 25, 50))}


def test_search(q=None, limit=25):
	"""Same source as the phase 49 diagnostic autocomplete (Diagnostic Test Master), open to Uber Doc providers."""
	if not frappe.db.exists("DocType", DTM_DT):
		return {"rows": []}
	q = cstr(q).strip()
	or_filters = [["name", "like", f"%{q}%"], ["test_name", "like", f"%{q}%"]] if q else None
	rows = frappe.get_all(DTM_DT, or_filters=or_filters, fields=["name", "test_name", "item"], order_by="test_name asc", limit=min(cint(limit) or 25, 50))
	for r in rows:
		r["item_name"] = frappe.db.get_value(ITEM_DT, r.item, "item_name") if r.item else None
	return {"rows": rows}


def program_picker(q=None):
	q = cstr(q).strip()
	or_filters = [["title", "like", f"%{q}%"], ["provider_name", "like", f"%{q}%"]] if q else None
	return {"rows": frappe.get_all(PROGRAM_DT, filters={"status": "Published"}, or_filters=or_filters, fields=["name", "title", "category", "level", "provider_name"], order_by="title asc", limit=50)}


# ---------------------------------------------------------------------------
# Prescriptions
# ---------------------------------------------------------------------------


def _provider_row(provider):
	return frappe.db.get_value(
		PROVIDER_DT, provider, ["name", "user", "full_name", "provider_category", "verification_status", "can_prescribe_medicines", "registration_no", "registration_council", "doctor"], as_dict=True
	)


def _age_text(patient):
	meta = frappe.get_meta(PATIENT_DT)
	for field in ("dob", "date_of_birth"):
		if meta.has_field(field):
			dob = frappe.db.get_value(PATIENT_DT, patient, field)
			if dob:
				years = (getdate(today()) - getdate(dob)).days // 365
				return f"{years} y"
	if meta.has_field("age"):
		age = frappe.db.get_value(PATIENT_DT, patient, "age")
		return f"{age} y" if age else None
	return None


def start_rx(ctx, booking):
	doc, party = _booking(ctx, booking, ("provider",), lock=True)
	prov = _provider_row(doc.provider)
	if prov.verification_status != "Verified":
		_deny(_("Your provider profile is not verified yet"))
	if doc.mode == TUTORIAL_PROGRAM:
		_fail(_("Tutorial enrollments do not take a prescription"))
	if doc.status == ST_CANCELLED or doc.status == "Requested":
		_fail(_("Start the prescription once the booking is confirmed"))
	existing = frappe.db.get_value(RX_DT, {"booking": booking, "status": ("in", ("Draft", "Signed"))}, "name")
	if existing:
		return rx_payload(existing, party)
	quals = ", ".join(frappe.get_all(QUAL_DT, filters={"parent": prov.name, "parenttype": PROVIDER_DT}, pluck="degree", order_by="idx asc", limit=6))
	values = {
		"doctype": RX_DT,
		"booking": booking,
		"status": "Draft",
		"rx_date": getdate(today()),
		"provider": prov.name,
		"provider_name": prov.full_name,
		"provider_category": prov.provider_category,
		"provider_registration_no": prov.registration_no,
		"provider_registration_council": prov.registration_council,
		"provider_qualification": quals[:140] or None,
		"patient": doc.patient,
		"patient_name": doc.patient_name,
		UPI_FIELD: doc.get(UPI_FIELD),
		"customer_profile": doc.customer_profile,
	}
	if doc.patient:
		values["patient_age"] = _age_text(doc.patient)
		gender = frappe.db.get_value(PATIENT_DT, doc.patient, "gender")
		values["patient_gender"] = gender if gender in ("Male", "Female", "Other") else None
	rx = frappe.get_doc(values)
	rx.insert(ignore_permissions=True)
	return rx_payload(rx.name, party)


def _rx_doc(ctx, name, parties=None, lock=False):
	if not name or not frappe.db.exists(RX_DT, name):
		_missing(_("Prescription not found"))
	if lock:
		_lock(RX_DT, name)
	rx = frappe.get_doc(RX_DT, name)
	booking = frappe.get_doc(BOOKING_DT, rx.booking)
	party = booking_party(ctx, booking)
	if not party or (parties and party not in parties):
		_deny(_("Not permitted"))
	if party in ("patient", "clinic") and rx.status == "Draft":
		_missing(_("Prescription not found"))
	return rx, party


def _num(value, key):
	if value in (None, ""):
		return None
	try:
		n = flt(value, 1)
	except Exception:
		_fail(_("{0} must be a number").format(VITAL_LABELS[key]))
	lo, hi = VITAL_LIMITS[key]
	if n < lo or n > hi:
		_fail(_("{0} must be between {1} and {2}").format(VITAL_LABELS[key], lo, hi))
	return n


def compute_bmi(weight, height):
	if not weight or not height:
		return None
	m = flt(height) / 100.0
	return round(flt(weight) / (m * m), 1) if m > 0 else None


def _rows(value):
	rows = _parse(value, []) or []
	if not isinstance(rows, list):
		_fail(_("Invalid list"))
	if len(rows) > MAX_ROWS:
		_fail(_("At most {0} rows per section").format(MAX_ROWS))
	return [r for r in rows if isinstance(r, dict)]


def _apply_rx(rx, p, can_prescribe):
	if "complaints" in p:
		rows = []
		for r in _rows(p.get("complaints")):
			complaint = cstr(r.get("complaint")).strip()
			if complaint:
				rows.append({"complaint": complaint[:140], "duration": _text(r.get("duration"), 60), "notes": _text(r.get("notes"), 140)})
		rx.set("complaints", rows)
	if "diagnoses" in p:
		rows = []
		for r in _rows(p.get("diagnoses")):
			code = normalize_icd(r.get("icd_code"))
			description = cstr(r.get("description")).strip()[:140]
			if not code and not description:
				continue
			if code and not valid_icd(code):
				_fail(_("{0} is not an ICD-10 code (expected like J06.9 or E11)").format(r.get("icd_code")))
			if code and not description:
				description = cstr(frappe.db.get_value(ICD_DT, code, "description"))
			dtype = cstr(r.get("diagnosis_type")).strip() or "Provisional"
			rows.append({"icd_code": code, "description": description or None, "diagnosis_type": dtype if dtype in DIAGNOSIS_TYPES else "Provisional"})
		rx.set("diagnoses", rows)
	if "medications" in p:
		rows = []
		for r in _rows(p.get("medications")):
			item = cstr(r.get("medicine_item")).strip() or None
			drug = cstr(r.get("drug_name")).strip()
			if item and not frappe.db.exists(ITEM_DT, item):
				_fail(_("Medicine {0} not found in the catalogue").format(item))
			if item and not drug:
				drug = cstr(frappe.db.get_value(ITEM_DT, item, "item_name"))
			if not drug:
				continue
			route = cstr(r.get("route")).strip() or "Oral"
			timing = cstr(r.get("timing")).strip() or "After Food"
			rows.append(
				{
					"medicine_item": item,
					"drug_name": drug[:140],
					"strength": _text(r.get("strength"), 60),
					"dose": _text(r.get("dose"), 60),
					"frequency": _text(r.get("frequency"), 40),
					"duration": _text(r.get("duration"), 40),
					"route": route if route in ROUTES else "Other",
					"timing": timing if timing in TIMINGS else "Any Time",
					"instructions": _text(r.get("instructions"), 140),
				}
			)
		if rows and not can_prescribe:
			_deny(_("Only verified doctors can prescribe medicines; use the exercise / therapy plan instead"))
		rx.set("medications", rows)
	if "tests" in p:
		rows = []
		for r in _rows(p.get("tests")):
			test = cstr(r.get("diagnostic_test")).strip() or None
			item = cstr(r.get("item")).strip() or None
			name = cstr(r.get("test_name")).strip()
			if test:
				if not frappe.db.exists(DTM_DT, test):
					_fail(_("Test {0} not found").format(test))
				tname, titem = frappe.db.get_value(DTM_DT, test, ["test_name", "item"])
				name, item = name or cstr(tname), item or titem
			if item and not frappe.db.exists(ITEM_DT, item):
				_fail(_("Test item {0} not found").format(item))
			if item and not name:
				name = cstr(frappe.db.get_value(ITEM_DT, item, "item_name"))
			if not name:
				continue
			rows.append({"diagnostic_test": test, "item": item, "test_name": name[:140], "notes": _text(r.get("notes"), 140)})
		rx.set("tests", rows)
	if "exercises" in p:
		rows = []
		for r in _rows(p.get("exercises")):
			program = cstr(r.get("tutorial_program")).strip() or None
			name = cstr(r.get("exercise_name")).strip()
			if program:
				title, status = frappe.db.get_value(PROGRAM_DT, program, ["title", "status"]) or (None, None)
				if status != "Published":
					_fail(_("Programme {0} is not published").format(program))
				name = name or cstr(title)
			if not name:
				continue
			rows.append(
				{
					"tutorial_program": program,
					"exercise_name": name[:140],
					"sets": min(max(cint(r.get("sets")), 0), 100) or None,
					"reps": min(max(cint(r.get("reps")), 0), 1000) or None,
					"duration_min": min(max(cint(r.get("duration_min")), 0), 600) or None,
					"frequency": _text(r.get("frequency"), 60),
					"notes": _text(r.get("notes"), 140),
				}
			)
		rx.set("exercises", rows)
	for key in VITAL_LIMITS:
		if key in p:
			rx.set(key, _num(p.get(key), key))
	if "temperature_f" in p and p.get("temperature_f") not in (None, ""):
		rx.temperature_c = _num(round((flt(p.get("temperature_f")) - 32) * 5 / 9, 1), "temperature_c")
	if rx.bp_systolic and rx.bp_diastolic and flt(rx.bp_diastolic) >= flt(rx.bp_systolic):
		_fail(_("Diastolic BP must be lower than systolic"))
	if "glucose_context" in p:
		ctx_value = cstr(p.get("glucose_context")).strip()
		rx.glucose_context = ctx_value if ctx_value in GLUCOSE_CONTEXTS else None
	rx.bmi = compute_bmi(rx.weight_kg, rx.height_cm)
	for key, limit in (("clinical_notes", 4000), ("advice", 4000)):
		if key in p:
			rx.set(key, _text(p.get(key), limit))
	if "follow_up_date" in p:
		value = p.get("follow_up_date")
		if value:
			value = getdate(value)
			if value < getdate(today()):
				_fail(_("Follow-up date cannot be in the past"))
		rx.follow_up_date = value or None
	if not rx.patient:
		if "patient_name" in p:
			rx.patient_name = _text(p.get("patient_name"), 140)
		if "patient_age" in p:
			rx.patient_age = _text(p.get("patient_age"), 20)
		if "patient_gender" in p:
			gender = cstr(p.get("patient_gender")).strip().title()
			rx.patient_gender = gender if gender in ("Male", "Female", "Other") else None


def save_rx(ctx, name, payload):
	rx, party = _rx_doc(ctx, name, ("provider",), lock=True)
	if rx.status != "Draft":
		_fail(_("A {0} prescription cannot be edited").format(rx.status.lower()))
	prov = _provider_row(rx.provider)
	_apply_rx(rx, payload or {}, cint(prov.can_prescribe_medicines) and prov.verification_status == "Verified")
	rx.save(ignore_permissions=True)
	return rx_payload(rx.name, party)


def verify_url(code):
	base = app_url()
	if base:
		return f"{base}/verify/{code}"
	return f"{frappe.utils.get_url()}/api/method/{MODULE_PATH}.ud_verify_rx?code={code}"


def _new_verify_code():
	for _attempt in range(10):
		code = "".join(secrets.choice(VERIFY_CODE_ALPHABET) for _i in range(12))
		if not frappe.db.exists(RX_DT, {"verify_code": code}):
			return code
	_fail(_("Could not allocate a verify code"))


def canonical(value):
	return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def build_rx_json(rx):
	booking = frappe.db.get_value(BOOKING_DT, rx.booking, ["name", "mode", "slot_start"], as_dict=True) or {}
	vitals = {k: flt(rx.get(k), 1) for k in VITAL_LIMITS if rx.get(k) not in (None, "", 0)}
	if rx.bmi:
		vitals["bmi"] = flt(rx.bmi, 1)
	if rx.glucose_context and "blood_glucose" in vitals:
		vitals["glucose_context"] = rx.glucose_context
	return {
		"schema": SCHEMA,
		"rx_id": rx.name,
		"status": rx.status,
		"rx_date": cstr(rx.rx_date),
		"signed_on": _iso(rx.signed_on),
		"verify_code": rx.verify_code,
		"verify_url": verify_url(rx.verify_code) if rx.verify_code else None,
		"cancel_reason": rx.cancel_reason if rx.status == "Cancelled" else None,
		"provider": {
			"id": rx.provider,
			"name": rx.provider_name,
			"category": rx.provider_category,
			"registration_no": rx.provider_registration_no,
			"registration_council": rx.provider_registration_council,
			"qualifications": rx.provider_qualification,
		},
		"patient": {"patient_id": rx.patient, "name": rx.patient_name, "age": rx.patient_age, "gender": rx.patient_gender, "universal_patient_id": rx.get(UPI_FIELD)},
		"booking": {"id": booking.get("name"), "mode": booking.get("mode"), "slot_start": _iso(booking.get("slot_start"))},
		"chief_complaints": [{"complaint": c.complaint, "duration": c.duration, "notes": c.notes} for c in rx.complaints],
		"diagnoses": [{"icd_code": d.icd_code, "description": d.description, "type": d.diagnosis_type} for d in rx.diagnoses],
		"vitals": vitals,
		"medications": [
			{"drug": m.drug_name, "item_code": m.medicine_item, "strength": m.strength, "dose": m.dose, "frequency": m.frequency, "duration": m.duration, "route": m.route, "timing": m.timing, "instructions": m.instructions}
			for m in rx.medications
		],
		"tests": [{"name": t.test_name, "diagnostic_test": t.diagnostic_test, "item_code": t.item, "notes": t.notes} for t in rx.tests],
		"exercise_plan": [
			{"program": e.tutorial_program, "exercise": e.exercise_name, "sets": cint(e.sets) or None, "reps": cint(e.reps) or None, "duration_min": cint(e.duration_min) or None, "frequency": e.frequency, "notes": e.notes}
			for e in rx.exercises
		],
		"clinical_notes": rx.clinical_notes,
		"advice": rx.advice,
		"follow_up_date": cstr(rx.follow_up_date) if rx.follow_up_date else None,
	}


def content_sha(rx_json):
	body = {k: v for k, v in rx_json.items() if k not in ("status", "cancel_reason", "signature")}
	return hashlib.sha256(canonical(body).encode()).hexdigest()


def sign_rx(ctx, name):
	rx, party = _rx_doc(ctx, name, ("provider",), lock=True)
	if rx.status != "Draft":
		_fail(_("This prescription is already {0}").format(rx.status.lower()))
	prov = _provider_row(rx.provider)
	if prov.user != ctx.user:
		_deny(_("Only the treating provider can sign"))
	if prov.verification_status != "Verified":
		_deny(_("Only verified providers can sign prescriptions"))
	if rx.medications and not (cint(prov.can_prescribe_medicines) and prov.provider_category == PRESCRIBER_CATEGORY):
		_deny(_("Only verified doctors can prescribe medicines"))
	if prov.provider_category == PRESCRIBER_CATEGORY and not (prov.registration_no and prov.registration_council):
		_fail(_("Add your registration number and council before signing"))
	if not rx.patient_name:
		_fail(_("Enter the patient's name"))
	if not rx.complaints and not rx.diagnoses:
		_fail(_("Add at least one chief complaint or diagnosis"))
	if not (rx.medications or rx.tests or rx.exercises or rx.advice):
		_fail(_("Add medicines, tests, an exercise / therapy plan or advice"))
	for m in rx.medications:
		if not m.frequency or not m.duration:
			_fail(_("{0}: set the frequency and duration").format(m.drug_name))
	for d in rx.diagnoses:
		if d.icd_code and not valid_icd(d.icd_code):
			_fail(_("{0} is not an ICD-10 code").format(d.icd_code))
	now = now_datetime()
	rx.update({"status": "Signed", "signed_on": now, "signed_by": ctx.user, "verify_code": _new_verify_code(), "rx_date": rx.rx_date or getdate(now)})
	data = build_rx_json(rx)
	sha = content_sha(data)
	data["signature"] = {"algorithm": "sha256", "content_hash": sha, "signed_by": prov.full_name, "registration_no": prov.registration_no}
	rx.signature_hash = sha
	rx.rx_json = canonical(data)
	rx.save(ignore_permissions=True)
	pdf = render_pdf(rx)
	url = _save_file(RX_DT, rx.name, f"{rx.name}.pdf", pdf, private=True, fieldname="pdf_file")
	frappe.db.set_value(RX_DT, rx.name, "pdf_file", url, update_modified=False)
	frappe.db.set_value(BOOKING_DT, rx.booking, "prescription", rx.name, update_modified=False)
	for d in rx.diagnoses:
		remember_icd(d.icd_code, d.description)
	rx.reload()
	cp = mirror_clinical_prescription(rx, prov)
	if cp:
		frappe.db.set_value(RX_DT, rx.name, "clinical_prescription", cp, update_modified=False)
	log_vitals(rx)
	emr = push_emr(rx.name)
	_notify_patient(rx)
	out = rx_payload(rx.name, party)
	out["emr"] = emr
	return out


def cancel_rx(ctx, name, reason):
	rx, party = _rx_doc(ctx, name, ("provider", "ops"), lock=True)
	reason = cstr(reason).strip()[:500]
	if not reason:
		_fail(_("Give the reason for cancelling"))
	if rx.status == "Cancelled":
		return rx_payload(rx.name, party)
	was_signed = rx.status == "Signed"
	rx.status = "Cancelled"
	rx.cancel_reason = reason
	if rx.rx_json:
		data = json.loads(rx.rx_json)
		data.update({"status": "Cancelled", "cancel_reason": reason})
		rx.rx_json = canonical(data)
	rx.save(ignore_permissions=True)
	if rx.clinical_prescription and frappe.db.exists(CP_DT, rx.clinical_prescription):
		frappe.db.set_value(CP_DT, rx.clinical_prescription, "status", "Cancelled")
	if frappe.db.get_value(BOOKING_DT, rx.booking, "prescription") == rx.name and not was_signed:
		frappe.db.set_value(BOOKING_DT, rx.booking, "prescription", None, update_modified=False)
	emr = push_emr(rx.name) if was_signed else None
	out = rx_payload(rx.name, party)
	out["emr"] = emr
	return out


def rx_payload(name, party=None):
	rx = frappe.get_doc(RX_DT, name)
	prov = _provider_row(rx.provider)
	booking = frappe.db.get_value(BOOKING_DT, rx.booking, ["name", "mode", "slot_start", "status", "profile_type", "customer_name"], as_dict=True) or {}
	return {
		"name": rx.name,
		"status": rx.status,
		"party": party,
		"rx_date": cstr(rx.rx_date) if rx.rx_date else None,
		"booking": {"name": booking.get("name"), "mode": booking.get("mode"), "mode_label": MODE_LABEL.get(booking.get("mode")), "slot_start": _iso(booking.get("slot_start")), "status": booking.get("status"), "profile_type": booking.get("profile_type"), "customer_name": booking.get("customer_name")},
		"provider": rx.provider,
		"provider_name": rx.provider_name,
		"provider_category": rx.provider_category,
		"provider_registration_no": rx.provider_registration_no,
		"provider_registration_council": rx.provider_registration_council,
		"provider_qualification": rx.provider_qualification,
		"can_prescribe_medicines": bool(prov and cint(prov.can_prescribe_medicines) and prov.verification_status == "Verified"),
		"patient": rx.patient,
		"patient_name": rx.patient_name,
		"patient_age": rx.patient_age,
		"patient_gender": rx.patient_gender,
		"patient_editable": not rx.patient and rx.status == "Draft",
		"universal_patient_id": rx.get(UPI_FIELD),
		"complaints": [{"complaint": c.complaint, "duration": c.duration, "notes": c.notes} for c in rx.complaints],
		"diagnoses": [{"icd_code": d.icd_code, "description": d.description, "diagnosis_type": d.diagnosis_type} for d in rx.diagnoses],
		"vitals": {**{k: flt(rx.get(k), 1) if rx.get(k) not in (None, "") else None for k in VITAL_LIMITS}, "glucose_context": rx.glucose_context, "bmi": flt(rx.bmi, 1) or None},
		"medications": [
			{"medicine_item": m.medicine_item, "drug_name": m.drug_name, "strength": m.strength, "dose": m.dose, "frequency": m.frequency, "duration": m.duration, "route": m.route, "timing": m.timing, "instructions": m.instructions}
			for m in rx.medications
		],
		"tests": [{"diagnostic_test": t.diagnostic_test, "item": t.item, "test_name": t.test_name, "notes": t.notes} for t in rx.tests],
		"exercises": [
			{"tutorial_program": e.tutorial_program, "exercise_name": e.exercise_name, "sets": cint(e.sets) or None, "reps": cint(e.reps) or None, "duration_min": cint(e.duration_min) or None, "frequency": e.frequency, "notes": e.notes}
			for e in rx.exercises
		],
		"clinical_notes": rx.clinical_notes,
		"advice": rx.advice,
		"follow_up_date": cstr(rx.follow_up_date) if rx.follow_up_date else None,
		"signed_on": _iso(rx.signed_on),
		"signature_hash": rx.signature_hash,
		"verify_code": rx.verify_code,
		"verify_url": verify_url(rx.verify_code) if rx.verify_code else None,
		"has_pdf": bool(rx.pdf_file),
		"clinical_prescription": rx.clinical_prescription,
		"emr_record": rx.emr_record,
		"cancel_reason": rx.cancel_reason,
		"options": {"routes": list(ROUTES), "timings": list(TIMINGS), "diagnosis_types": list(DIAGNOSIS_TYPES), "glucose_contexts": list(GLUCOSE_CONTEXTS)},
	}


def rx_list_row(r):
	return {"name": r.name, "status": r.status, "rx_date": cstr(r.rx_date) if r.rx_date else None, "provider_name": r.provider_name, "provider_category": r.provider_category, "patient_name": r.patient_name, "booking": r.booking, "verify_code": r.verify_code if r.status == "Signed" else None, "clinical_prescription": r.clinical_prescription, "signed_on": _iso(r.signed_on)}


RX_LIST_FIELDS = ["name", "status", "rx_date", "provider_name", "provider_category", "patient_name", "booking", "verify_code", "clinical_prescription", "signed_on"]


def my_prescriptions(ctx):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc import _patients_of

	patients = _patients_of(ctx)
	if not patients:
		return {"rows": []}
	rows = frappe.get_all(RX_DT, filters={"patient": ("in", patients), "status": ("in", ("Signed", "Cancelled"))}, fields=RX_LIST_FIELDS, order_by="signed_on desc", limit=200)
	return {"rows": [rx_list_row(r) for r in rows]}


def provider_prescriptions(ctx, status=None):
	filters = {"provider": ctx.provider}
	if status in RX_STATUSES:
		filters["status"] = status
	rows = frappe.get_all(RX_DT, filters=filters, fields=RX_LIST_FIELDS, order_by="modified desc", limit=200)
	return {"rows": [rx_list_row(r) for r in rows]}


def rx_pdf(ctx, name):
	rx, _party = _rx_doc(ctx, name)
	if rx.status == "Draft":
		return {"filename": f"{rx.name}-preview.pdf", "content_base64": base64.b64encode(render_pdf(rx, preview=True)).decode(), "preview": True}
	if not rx.pdf_file:
		_missing(_("PDF not available"))
	content = frappe.get_doc("File", {"file_url": rx.pdf_file}).get_content()
	if isinstance(content, str):
		content = content.encode()
	return {"filename": f"{rx.name}.pdf", "content_base64": base64.b64encode(content).decode(), "preview": False}


def rx_json_download(ctx, name):
	rx, _party = _rx_doc(ctx, name)
	data = json.loads(rx.rx_json) if rx.rx_json else build_rx_json(rx)
	return {"filename": f"{rx.name}.json", "rx": data}


def _initials(name):
	parts = [p for p in re.split(r"\s+", cstr(name).strip()) if p]
	return " ".join(f"{p[0].upper()}." for p in parts[:3]) or None


def verify_rx(code):
	_rate_limit(f"ud_verify_ip:{_request_ip()}", VERIFY_IP_LIMIT, 3600)
	code = re.sub(r"[^A-Za-z0-9]", "", cstr(code)).upper()
	if len(code) != 12:
		_missing(_("Prescription not found"))
	name = frappe.db.get_value(RX_DT, {"verify_code": code}, "name")
	if not name:
		_missing(_("Prescription not found"))
	rx = frappe.get_doc(RX_DT, name)
	data = json.loads(rx.rx_json or "{}")
	return {
		"valid": rx.status == "Signed",
		"status": rx.status,
		"rx_id": rx.name,
		"rx_date": cstr(rx.rx_date),
		"signed_on": _iso(rx.signed_on),
		"cancel_reason": rx.cancel_reason if rx.status == "Cancelled" else None,
		"provider": {"name": rx.provider_name, "category": rx.provider_category, "registration_no": rx.provider_registration_no, "registration_council": rx.provider_registration_council, "qualifications": rx.provider_qualification},
		"patient": {"initials": _initials(rx.patient_name), "age": rx.patient_age, "gender": rx.patient_gender},
		"medications": [{k: m.get(k) for k in ("drug", "strength", "dose", "frequency", "duration", "route", "timing")} for m in data.get("medications") or []],
		"tests": [t.get("name") for t in data.get("tests") or []],
		"exercise_plan": [e.get("exercise") for e in data.get("exercise_plan") or []],
		"content_hash": rx.signature_hash,
		"hash_matches": bool(data) and content_sha(data) == rx.signature_hash,
	}


# ---------------------------------------------------------------------------
# Side effects of signing
# ---------------------------------------------------------------------------


def mirror_clinical_prescription(rx, prov):
	"""Submitted Clinical Prescription with the catalogue-linked lines, so phase 50 pharmacy fulfilment works."""
	if not rx.patient or not prov.doctor or prov.provider_category != PRESCRIBER_CATEGORY or not frappe.db.exists("DocType", CP_DT):
		return None
	meds = [m for m in rx.medications if m.medicine_item]
	tests = [t for t in rx.tests if t.item or t.diagnostic_test]
	if not meds and not tests:
		return None
	try:
		booking = frappe.db.get_value(BOOKING_DT, rx.booking, ["doctor_appointment"], as_dict=True) or {}
		diagnosis = "; ".join(f"{d.icd_code + ' ' if d.icd_code else ''}{d.description or ''}".strip() for d in rx.diagnoses) or None
		notes = []
		if rx.complaints:
			notes.append("Complaints: " + ", ".join(c.complaint for c in rx.complaints))
		if rx.advice:
			notes.append("Advice: " + rx.advice)
		notes.append(f"Uber Doc e-Rx {rx.name} (verify {rx.verify_code})")
		values = {
			"doctype": CP_DT,
			"patient": rx.patient,
			"patient_name": rx.patient_name,
			"doctor": prov.doctor,
			"encounter_date": rx.rx_date,
			"status": "Submitted",
			"diagnosis": diagnosis,
			"clinical_notes": "<p>" + "</p><p>".join(escape_html(n) for n in notes) + "</p>",
			"medicines": [
				{
					"medicine_item": m.medicine_item,
					"dosage": " ".join(x for x in (m.strength, m.dose) if x) or None,
					"duration": m.duration,
					"frequency": m.frequency,
					"route": CP_ROUTES.get(m.route, "Other"),
					"instructions": "; ".join(x for x in (m.timing, m.instructions) if x)[:140] or None,
				}
				for m in meds
			],
			"diagnostics": [{"diagnostic_test": t.diagnostic_test, "item": t.item, "notes": t.notes} for t in tests],
		}
		if _has_field(CP_DT, "doctor_appointment") and booking.get("doctor_appointment"):
			values["doctor_appointment"] = booking["doctor_appointment"]
		if _has_field(CP_DT, "digital_prescription"):
			values["digital_prescription"] = rx.name
			values["source_app"] = "Uber Doc"
		cp = frappe.get_doc(values)
		cp.insert(ignore_permissions=True)
		return cp.name
	except Exception:
		frappe.log_error(title="phase135 mirror Clinical Prescription", message=f"{rx.name}\n{frappe.get_traceback()}")
		return None


def log_vitals(rx):
	if not rx.patient or not frappe.db.exists("DocType", VITAL_DT):
		return 0
	rows = [("bp_systolic", rx.bp_systolic, "mmHg"), ("bp_diastolic", rx.bp_diastolic, "mmHg"), ("weight", rx.weight_kg, "kg"), ("spo2", rx.spo2, "%"), ("glucose", rx.blood_glucose, "mg/dL")]
	count = 0
	for vtype, value, unit in rows:
		if not value:
			continue
		try:
			frappe.get_doc({"doctype": VITAL_DT, "patient": rx.patient, "vital_type": vtype, "value": flt(value), "unit": unit, "source": "manual", "recorded_at": rx.signed_on, "notes": f"Uber Doc e-Rx {rx.name}"}).insert(ignore_permissions=True)
			count += 1
		except Exception:
			frappe.log_error(title="phase135 vital log", message=f"{rx.name}\n{frappe.get_traceback()}")
	return count


def push_emr(name):
	"""Upsert the EMR Record for this prescription (idempotent) and queue the signed webhooks."""
	from health_ecosystem_core.health_ecosystem_core.clinical_emr import upsert_emr_record

	rx = frappe.get_doc(RX_DT, name)
	if not rx.patient and not rx.get(UPI_FIELD):
		return {"skipped": "no patient identity (walk-in on a clinic shift)"}
	summary = json.loads(rx.rx_json or "{}")
	label = "Prescription" if rx.provider_category == PRESCRIBER_CATEGORY else "Care plan"
	res = upsert_emr_record(
		RX_DT,
		rx.name,
		"Prescription",
		"Uber Doc",
		patient=rx.patient,
		universal_patient_id=rx.get(UPI_FIELD),
		title=f"{label} — {rx.provider_name}" + (" (cancelled)" if rx.status == "Cancelled" else ""),
		record_date=rx.rx_date,
		summary=summary,
		file_url=rx.pdf_file,
	)
	if res.get("name") and rx.emr_record != res["name"]:
		frappe.db.set_value(RX_DT, rx.name, "emr_record", res["name"], update_modified=False)
	return res


def _notify_patient(rx):
	booking = frappe.db.get_value(BOOKING_DT, rx.booking, ["booked_by", "profile_type", "customer_profile"], as_dict=True) or {}
	mobile = frappe.db.get_value(PATIENT_DT, rx.patient, "mobile") if rx.patient else None
	if not mobile and booking.get("booked_by"):
		mobile = frappe.db.get_value("User", booking.booked_by, "mobile_no")
	if booking.get("profile_type") == "B2B_CLINIC" and not rx.patient:
		mobile = frappe.db.get_value("Customer Profile", booking.customer_profile, "mobile")
	_notify(mobile, _("Uber Doc: {0} issued your prescription {1}. Verify: {2}").format(rx.provider_name, rx.name, verify_url(rx.verify_code)))


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def qr_data_uri(text):
	try:
		import pyqrcode
	except Exception:
		return None
	try:
		qr = pyqrcode.create(text, error="M")
		try:
			return "data:image/png;base64," + qr.png_as_base64_str(scale=4, quiet_zone=2)
		except Exception:
			buf = io.BytesIO()
			qr.svg(buf, scale=4, quiet_zone=2, xmldecl=False)
			return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()
	except Exception:
		frappe.log_error(title="phase135 QR", message=frappe.get_traceback())
		return None


def _e(value):
	return escape_html(cstr(value)) if value not in (None, "") else ""


def render_html(rx, preview=False):
	prescriber = rx.provider_category == PRESCRIBER_CATEGORY
	title = _("Prescription") if prescriber else _("Care Plan")
	code = rx.verify_code or "PREVIEW"
	url = verify_url(rx.verify_code) if rx.verify_code else ""
	qr = qr_data_uri(url) if url else None
	vitals = []
	for key in VITAL_LIMITS:
		if rx.get(key):
			vitals.append(f"<td><span>{_e(VITAL_LABELS[key])}</span><b>{_e(flt(rx.get(key), 1))}</b></td>")
	if rx.bmi:
		vitals.append(f"<td><span>BMI</span><b>{_e(rx.bmi)}</b></td>")
	vitals_html = ""
	if vitals:
		rows = ["<tr>" + "".join(vitals[i : i + 5]) + "</tr>" for i in range(0, len(vitals), 5)]
		vitals_html = f"<h3>Vitals</h3><table class='vitals'>{''.join(rows)}</table>"
	sections = [vitals_html]
	if rx.complaints:
		items = "".join(f"<li>{_e(c.complaint)}{' — ' + _e(c.duration) if c.duration else ''}{' (' + _e(c.notes) + ')' if c.notes else ''}</li>" for c in rx.complaints)
		sections.append(f"<h3>Chief complaints</h3><ul>{items}</ul>")
	if rx.diagnoses:
		items = "".join(f"<li>{'<b>' + _e(d.icd_code) + '</b> ' if d.icd_code else ''}{_e(d.description)} <i>({_e(d.diagnosis_type)})</i></li>" for d in rx.diagnoses)
		sections.append(f"<h3>Diagnosis</h3><ul>{items}</ul>")
	if rx.clinical_notes:
		sections.append(f"<h3>Notes</h3><p>{_e(rx.clinical_notes)}</p>")
	if rx.medications:
		rows = "".join(
			f"<tr><td>{i}</td><td><b>{_e(m.drug_name)}</b>{'<br><small>' + _e(m.strength) + '</small>' if m.strength else ''}</td><td>{_e(m.dose)}</td><td>{_e(m.frequency)}</td><td>{_e(m.duration)}</td><td>{_e(m.route)}<br><small>{_e(m.timing)}</small></td><td>{_e(m.instructions)}</td></tr>"
			for i, m in enumerate(rx.medications, start=1)
		)
		sections.append(f"<h3 class='rx'>&#8478; Medications</h3><table class='grid'><tr><th>#</th><th>Drug</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Route / timing</th><th>Instructions</th></tr>{rows}</table>")
	if rx.tests:
		items = "".join(f"<li>{_e(t.test_name)}{' — ' + _e(t.notes) if t.notes else ''}</li>" for t in rx.tests)
		sections.append(f"<h3>Recommended tests</h3><ul>{items}</ul>")
	if rx.exercises:
		rows = "".join(
			f"<tr><td><b>{_e(e.exercise_name)}</b></td><td>{_e(e.sets)}</td><td>{_e(e.reps)}</td><td>{_e(e.duration_min)}</td><td>{_e(e.frequency)}</td><td>{_e(e.notes)}</td></tr>"
			for e in rx.exercises
		)
		sections.append(f"<h3>Yoga / exercise / therapy plan</h3><table class='grid'><tr><th>Practice</th><th>Sets</th><th>Reps</th><th>Minutes</th><th>Frequency</th><th>Notes</th></tr>{rows}</table>")
	if rx.advice:
		sections.append(f"<h3>Advice</h3><p>{_e(rx.advice)}</p>")
	if rx.follow_up_date:
		sections.append(f"<p class='follow'>Follow-up on <b>{_e(frappe.utils.formatdate(rx.follow_up_date))}</b></p>")
	reg = " · ".join(x for x in (f"Reg. No. {rx.provider_registration_no}" if rx.provider_registration_no else "", rx.provider_registration_council or "") if x)
	signed = (
		f"Digitally signed by <b>{_e(rx.provider_name)}</b>{' (' + _e(reg) + ')' if reg else ''} on {_e(frappe.utils.format_datetime(rx.signed_on))}"
		if rx.signed_on
		else "<b>DRAFT — not signed, not valid for dispensing</b>"
	)
	watermark = "<div class='watermark'>PREVIEW</div>" if preview or rx.status != "Signed" else ""
	cancelled = f"<p class='cancelled'>CANCELLED: {_e(rx.cancel_reason)}</p>" if rx.status == "Cancelled" else ""
	qr_html = f"<img class='qr' src='{qr}'/>" if qr else ""
	return f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:Helvetica,Arial,sans-serif;color:#1d2733;font-size:11.5px;margin:0;}}
.wrap{{padding:22px 28px;position:relative;}}
.head{{border-bottom:3px solid #0f766e;padding-bottom:10px;margin-bottom:12px;}}
.head table{{width:100%;}} .brand{{color:#0f766e;font-weight:700;font-size:13px;letter-spacing:.5px;}}
.doc{{font-size:18px;font-weight:700;margin-top:2px;}} .muted{{color:#5b6775;}}
.title{{text-align:right;font-size:20px;font-weight:700;color:#0f766e;}}
.pt{{background:#f1f7f6;border-radius:6px;padding:8px 10px;margin-bottom:10px;}} .pt td{{padding:2px 12px 2px 0;}}
h3{{font-size:12.5px;color:#0f766e;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.4px;}} h3.rx{{font-size:14px;}}
ul{{margin:0;padding-left:18px;}} li{{margin:2px 0;}}
table.grid{{width:100%;border-collapse:collapse;}} table.grid th{{background:#e6f2f0;text-align:left;padding:5px;font-size:10.5px;}}
table.grid td{{border-bottom:1px solid #dfe7e6;padding:5px;vertical-align:top;}}
table.vitals{{width:100%;border-collapse:separate;border-spacing:4px;}} table.vitals td{{background:#f6f8f9;border-radius:4px;padding:5px;width:20%;}}
table.vitals span{{display:block;color:#5b6775;font-size:9.5px;}} table.vitals b{{font-size:13px;}}
.foot{{margin-top:22px;border-top:1px solid #cfd8d7;padding-top:10px;}} .foot table{{width:100%;}}
.qr{{width:96px;height:96px;}} .code{{font-family:Courier,monospace;font-size:13px;font-weight:700;letter-spacing:1px;}}
.follow{{margin-top:10px;}} .cancelled{{color:#b42318;font-weight:700;font-size:14px;}}
.watermark{{position:absolute;top:300px;left:120px;font-size:90px;color:rgba(180,35,24,.12);transform:rotate(-30deg);font-weight:700;}}
</style></head><body><div class="wrap">{watermark}
<div class="head"><table><tr><td><div class="brand">UBER DOC</div><div class="doc">{_e(rx.provider_name)}</div>
<div class="muted">{_e(rx.provider_category)}{' · ' + _e(rx.provider_qualification) if rx.provider_qualification else ''}</div><div class="muted">{_e(reg)}</div></td>
<td class="title">{_e(title)}<div class="muted" style="font-size:11px;font-weight:400">{_e(rx.name)} · {_e(frappe.utils.formatdate(rx.rx_date))}</div></td></tr></table></div>
{cancelled}
<div class="pt"><table><tr><td><b>{_e(rx.patient_name)}</b></td><td>{_e(rx.patient_age)}</td><td>{_e(rx.patient_gender)}</td>
<td>{'ID ' + _e(rx.get(UPI_FIELD)) if rx.get(UPI_FIELD) else ''}</td></tr></table></div>
{''.join(sections)}
<div class="foot"><table><tr><td>{signed}<br><span class="muted">Verify at {_e(url) if url else 'the Uber Doc verify page'} with code</span> <span class="code">{_e(code)}</span>
<br><span class="muted">Content SHA-256 {_e((rx.signature_hash or '')[:16])}…</span></td><td style="text-align:right">{qr_html}</td></tr></table></div>
</div></body></html>"""


def render_pdf(rx, preview=False):
	from frappe.utils.pdf import get_pdf

	return get_pdf(render_html(rx, preview=preview), {"page-size": "A4", "margin-top": "8mm", "margin-bottom": "8mm", "margin-left": "6mm", "margin-right": "6mm"})


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rx_start(booking=None, sid=None):
	return _run(sid, "verified", lambda ctx: start_rx(ctx, booking), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_rx_get(name=None, sid=None):
	def run(ctx):
		rx, party = _rx_doc(ctx, name)
		return rx_payload(rx.name, party)

	return _run(sid, "user", run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rx_save(name=None, payload=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_rx(ctx, name, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rx_sign(name=None, sid=None):
	return _run(sid, "verified", lambda ctx: sign_rx(ctx, name), message=_("Signed"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rx_cancel(name=None, reason=None, sid=None):
	return _run(sid, "user", lambda ctx: cancel_rx(ctx, name, reason), message=_("Cancelled"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rx_pdf(name=None, sid=None):
	return _run(sid, "user", lambda ctx: rx_pdf(ctx, name))


@frappe.whitelist(allow_guest=True)
def ud_rx_json(name=None, sid=None):
	return _run(sid, "user", lambda ctx: rx_json_download(ctx, name))


@frappe.whitelist(allow_guest=True)
def ud_my_prescriptions(sid=None):
	return _run(sid, "user", my_prescriptions)


@frappe.whitelist(allow_guest=True)
def ud_provider_prescriptions(status=None, sid=None):
	return _run(sid, "provider", lambda ctx: provider_prescriptions(ctx, status))


@frappe.whitelist(allow_guest=True)
def ud_icd_search(q=None, sid=None):
	return _run(sid, "provider", lambda ctx: icd_search(q))


@frappe.whitelist(allow_guest=True)
def ud_med_search(q=None, sid=None):
	def run(ctx):
		if not cint(frappe.db.get_value(PROVIDER_DT, ctx.provider, "can_prescribe_medicines")):
			_deny(_("Only verified doctors can prescribe medicines"))
		return med_search(q)

	return _run(sid, "verified", run)


@frappe.whitelist(allow_guest=True)
def ud_test_search(q=None, sid=None):
	return _run(sid, "provider", lambda ctx: test_search(q))


@frappe.whitelist(allow_guest=True)
def ud_rx_programs(q=None, sid=None):
	return _run(sid, "provider", lambda ctx: program_picker(q))


@frappe.whitelist(allow_guest=True)
def ud_verify_rx(code=None):
	return _guest(lambda: verify_rx(code))


@frappe.whitelist(allow_guest=True)
def ud_ops_icd_list(q=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_icd(cstr(q).strip() or None))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_icd_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_icd(_parse(payload)), message=_("Saved"), commit=True)
