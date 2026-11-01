"""Phase 135 — Uber Doc: clinical and wellness provider platform (standalone app, domain not decided yet).

- Clinical Provider: doctors, therapists, psychologists, yoga / exercise instructors, physiotherapists and
  nutritionists sign up with an OTP-verified mobile, upload credentials (private files), set a rate per delivery mode
  and an availability calendar. Operations verify them; only Verified providers are listed or can sign e-Rx, and only
  Verified Doctors may prescribe medicines. A Doctor-category provider is linked to (or creates) a Remedium `Doctor`
  with the Physician role so the provider dashboard, Doctor Appointment and e-Rx pharmacy flows keep working.
- Customer Profile: D2C_PATIENT (one per Health Patient, carries the Universal Patient ID; created on first booking)
  or B2B_CLINIC (self sign-up with OTP, operations approve, chambers + users).
- Consultation Booking: PHYSICAL / ONLINE_VIDEO / TELEMEDICINE / TUTORIAL_PROGRAM. Slots come from Provider
  Availability Rule minus Provider Time Off, existing bookings and the linked Doctor's legacy appointments; the
  provider row is locked while booking so two patients can never take the same slot. B2B clinics request chamber
  shifts that the provider accepts; completed shifts accrue on a monthly Clinic Settlement.
- Video: per-booking random Jitsi room names; join tokens (HS256 self-hosted Jitsi JWT or RS256 8x8 JaaS) are issued
  only to the booking's patient / provider / clinic and only from 10 minutes before the slot to its end plus grace.
- Tutorial Program / Tutorial Enrollment: recorded or live programmes with module progress.
- Payments: HEC Payment Intent scopes uberdoc_consult / program_enrollment / uberdoc_clinic_session through Razorpay
  (phase 121 webhook + poller complete them via complete_uberdoc_intent), pay at clinic, or offline by operations.
- e-Rx (Digital Prescription, PDF / JSON, verify code, EMR push) lives in clinical_phase135_ud_rx.

Scheduler jobs run in worker containers, so module-level imports stay limited to frappe, api helpers and phase 132.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, time as dtime, timedelta
from typing import NoReturn

import frappe
from frappe import _
from frappe.utils import add_days, add_to_date, cint, cstr, flt, get_datetime, get_time, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	PATIENT_DT,
	UPI_FIELD,
	_ensure_doctype,
	_perms,
	_sel,
	assign_upi,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc"
HOLDS_JOB = f"{MODULE_PATH}.ud_expire_holds"
SCHEDULED_JOBS = ((HOLDS_JOB, "*/5 * * * *"),)
# Domain not decided yet: set site_config `uberdoc_base_url` (or this constant) once the host exists.
APP_URL = ""

PROVIDER_DT = "Clinical Provider"
QUAL_DT = "Provider Qualification"
CRED_DT = "Provider Credential Document"
RATE_DT = "Provider Mode Rate"
RULE_DT = "Provider Availability Rule"
TIMEOFF_DT = "Provider Time Off"
CUSTOMER_DT = "Customer Profile"
CHAMBER_DT = "Clinic Chamber"
CUST_USER_DT = "Customer Profile User"
BOOKING_DT = "Consultation Booking"
MSG_DT = "Consultation Message"
SETTLEMENT_DT = "Clinic Settlement"
SETTLE_LINE_DT = "Clinic Settlement Line"
PROGRAM_DT = "Tutorial Program"
MODULE_DT = "Tutorial Module"
ENROLL_DT = "Tutorial Enrollment"
PROGRESS_DT = "Tutorial Module Progress"
ICD_DT = "Uber Doc ICD Code"
VIDEO_DT = "HEC Wellness Video"
DOCTOR_DT = "Doctor"
APPOINTMENT_DT = "Doctor Appointment"
SPA_DT = "Service Provider Application"
PROFILE_DT = "Franchisee Profile"
CONSULT_TYPE = "Uber Doc Consultation"

ROLE_PROVIDER = "Clinical Provider"
ROLE_CLINIC = "Uber Doc Clinic User"
ROLE_MANAGER = "Uber Doc Manager"
ROLE_PHYSICIAN = "Physician"
UD_ROLES = (ROLE_PROVIDER, ROLE_CLINIC, ROLE_MANAGER)
MANAGE_ROLES = frozenset({"System Manager", "Health System Admin", "Administrator", ROLE_MANAGER})
# Roles a mobile-OTP Uber Doc login may carry; staff / partner accounts must use their password.
OTP_LOGIN_ROLES = frozenset({ROLE_PROVIDER, ROLE_CLINIC, ROLE_PHYSICIAN, "Patient", "All", "Guest", "Desk User"})

CATEGORIES = ("Doctor", "Therapist", "Psychologist", "Yoga Instructor", "Exercise Instructor", "Physiotherapist", "Nutritionist")
PRESCRIBER_CATEGORY = "Doctor"
VERIFY_STATUSES = ("Pending", "Verified", "Rejected", "Suspended")
GENDERS = ("Male", "Female", "Other")
CRED_TYPES = ("Registration Certificate", "Degree Certificate", "Identity Proof", "Experience Letter", "Other")
SIGNUP_SOURCES = ("Self Sign-up", "Operations", "Provider Application")

PHYSICAL = "PHYSICAL"
ONLINE_VIDEO = "ONLINE_VIDEO"
TELEMEDICINE = "TELEMEDICINE"
TUTORIAL_PROGRAM = "TUTORIAL_PROGRAM"
MODES = (PHYSICAL, ONLINE_VIDEO, TELEMEDICINE, TUTORIAL_PROGRAM)
SLOT_MODES = (PHYSICAL, ONLINE_VIDEO, TELEMEDICINE)
VIDEO_MODES = (ONLINE_VIDEO, TELEMEDICINE)
MODE_LABEL = {PHYSICAL: "In person", ONLINE_VIDEO: "Video consult", TELEMEDICINE: "Audio call / chat", TUTORIAL_PROGRAM: "Tutorial programme"}

D2C = "D2C_PATIENT"
B2B = "B2B_CLINIC"
PROFILE_TYPES = (D2C, B2B)
CLINIC_STATUSES = ("Pending Approval", "Active", "Suspended", "Rejected")

ST_REQUESTED = "Requested"
ST_CONFIRMED = "Confirmed"
ST_CHECKED_IN = "Checked In"
ST_IN_CONSULT = "In Consultation"
ST_COMPLETED = "Completed"
ST_CANCELLED = "Cancelled"
ST_NO_SHOW = "No Show"
BOOKING_STATUSES = (ST_REQUESTED, ST_CONFIRMED, ST_CHECKED_IN, ST_IN_CONSULT, ST_COMPLETED, ST_CANCELLED, ST_NO_SHOW)
OPEN_STATUSES = (ST_REQUESTED, ST_CONFIRMED, ST_CHECKED_IN, ST_IN_CONSULT)
LIVE_STATUSES = (ST_CONFIRMED, ST_CHECKED_IN, ST_IN_CONSULT)
TRANSITIONS = {
	ST_REQUESTED: {ST_CONFIRMED, ST_CANCELLED},
	ST_CONFIRMED: {ST_CHECKED_IN, ST_IN_CONSULT, ST_COMPLETED, ST_CANCELLED, ST_NO_SHOW},
	ST_CHECKED_IN: {ST_IN_CONSULT, ST_COMPLETED, ST_NO_SHOW, ST_CANCELLED},
	ST_IN_CONSULT: {ST_COMPLETED},
}
RESPONSES = ("Pending", "Accepted", "Declined")
PAYMENT_STATUSES = ("Not Required", "Unpaid", "Pending", "Paid", "Refunded")
PAYMENT_MODES = ("Online", "Pay at Clinic", "Offline", "B2B Settlement", "Free")
OFFLINE_MODES = ("Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Waived")
SCOPE_CONSULT = "uberdoc_consult"
SCOPE_CLINIC = "uberdoc_clinic_session"
SCOPE_PROGRAM = "program_enrollment"
UD_SCOPES = (SCOPE_CONSULT, SCOPE_CLINIC, SCOPE_PROGRAM)

PROGRAM_CATEGORIES = ("Yoga", "Exercise", "Physio", "Mental Health", "Nutrition")
PROGRAM_LEVELS = ("All Levels", "Beginner", "Intermediate", "Advanced")
PROGRAM_FORMATS = ("Recorded", "Live Cohort", "Hybrid")
PROGRAM_STATUSES = ("Draft", "Pending Review", "Published", "Rejected", "Archived")
ENROLL_STATUSES = ("Pending Payment", "Active", "Completed", "Cancelled")
SETTLEMENT_STATUSES = ("Draft", "Invoiced", "Paid", "Cancelled")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
ICD_SOURCES = ("Provider Entry", "Operations")

HOLD_MINUTES = 20
ENROLL_HOLD_HOURS = 24
SLOT_LEAD_MINUTES = 30
MAX_SLOT_DAYS = 30
LEGACY_APPOINTMENT_MINUTES = 15
JOIN_EARLY_MINUTES = 10
JOIN_GRACE_MINUTES = 15
MAX_MESSAGES = 500
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
UPLOAD_EXTS = ("pdf", "jpg", "jpeg", "png", "webp")
PHOTO_EXTS = ("jpg", "jpeg", "png", "webp")
SIGNUP_IP_LIMIT = 10
SIGNUP_MOBILE_LIMIT = 5
USER_EMAIL_DOMAIN = "uberdoc.local"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
PINCODE_RE = re.compile(r"^\d{6}$")
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
UPI_ID_RE = re.compile(r"^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$")
SMOKE_TAG = "P135SMK"


class OtpError(frappe.ValidationError):
	pass


def _fail(message) -> NoReturn:
	raise frappe.ValidationError(message)


def _deny(message) -> NoReturn:
	raise frappe.PermissionError(message)


def _missing(message) -> NoReturn:
	raise frappe.DoesNotExistError(message)


def _has_field(doctype, fieldname):
	try:
		return bool(frappe.db.exists("DocType", doctype)) and frappe.get_meta(doctype).has_field(fieldname)
	except Exception:
		return False


def _parse(value, default=None):
	if value in (None, ""):
		return default if default is not None else {}
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		_fail(_("Invalid request payload"))


def _list(value):
	if value in (None, ""):
		return []
	if isinstance(value, (list, tuple)):
		return list(value)
	text = cstr(value).strip()
	if text.startswith("["):
		return list(_parse(text, []))
	return [p for p in re.split(r"[\n,;]+", text) if p.strip()]


def _str(value):
	return cstr(value) if value not in (None, "") else None


def _text(value, limit):
	return cstr(value).strip()[:limit] or None


def _mobile(value, required=True):
	digits = re.sub(r"\D", "", cstr(value))
	if len(digits) > 10:
		digits = digits[-10:]
	if len(digits) == 10 and digits[0] in "6789":
		return digits
	if required:
		_fail(_("Enter a valid 10-digit mobile number"))
	return None


def _lock(doctype, name):
	if not name or not frappe.db.sql(f"select name from `tab{doctype}` where name = %s for update", (name,)):
		_missing(_("{0} {1} not found").format(doctype, name))


def _to_time(value):
	if value in (None, ""):
		return None
	if isinstance(value, dtime):
		return value
	if isinstance(value, timedelta):
		return (datetime.min + value).time()
	return get_time(cstr(value))


def _hhmm(value):
	t = _to_time(value)
	return t.strftime("%H:%M") if t else None


def _time_in(value, label):
	text = cstr(value).strip()
	m = TIME_RE.match(text)
	if not m:
		_fail(_("{0} must look like 09:30").format(label))
	return f"{int(m.group(1)):02d}:{m.group(2)}:00"


def _dt_in(value, label):
	if value in (None, ""):
		_fail(_("{0} is required").format(label))
	try:
		return get_datetime(value).replace(microsecond=0)
	except Exception:
		_fail(_("{0} is not a valid date / time").format(label))


def _iso(value):
	return get_datetime(value).strftime("%Y-%m-%d %H:%M:%S") if value else None


def _clear_messages():
	try:
		frappe.clear_messages()
	except Exception:
		pass


def app_url():
	return cstr(frappe.conf.get("uberdoc_base_url") or APP_URL).strip().rstrip("/")


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _doctype_specs():
	managers = ("System Manager", "Health System Admin", ROLE_MANAGER)
	provider_ref = {"fieldname": "provider", "label": "Provider", "fieldtype": "Link", "options": PROVIDER_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1}
	provider_name = {"fieldname": "provider_name", "label": "Provider Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1}
	payment_fields = [
		{"fieldname": "payment_section", "label": "Payment", "fieldtype": "Section Break"},
		{"fieldname": "payment_mode", "label": "Payment Mode", "fieldtype": "Select", "options": "\n" + _sel(PAYMENT_MODES)},
		{"fieldname": "payment_status", "label": "Payment Status", "fieldtype": "Select", "options": _sel(PAYMENT_STATUSES), "default": "Unpaid", "in_standard_filter": 1},
		{"fieldname": "payment_intent", "label": "Payment Intent", "fieldtype": "Data", "read_only": 1},
		{"fieldname": "razorpay_order_id", "label": "Razorpay Order", "fieldtype": "Data", "read_only": 1, "search_index": 1},
		{"fieldname": "razorpay_payment_id", "label": "Razorpay Payment", "fieldtype": "Data", "read_only": 1},
		{"fieldname": "offline_payment_ref", "label": "Offline Payment Reference", "fieldtype": "Data"},
		{"fieldname": "paid_on", "label": "Paid On", "fieldtype": "Datetime", "read_only": 1},
	]
	return [
		(
			QUAL_DT,
			[
				{"fieldname": "degree", "label": "Degree / Certification", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "institution", "label": "Institution", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "year", "label": "Year", "fieldtype": "Int", "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			CRED_DT,
			[
				{"fieldname": "doc_type", "label": "Document", "fieldtype": "Select", "options": _sel(CRED_TYPES), "reqd": 1, "in_list_view": 1},
				{"fieldname": "file", "label": "File (private)", "fieldtype": "Attach", "in_list_view": 1},
				{"fieldname": "file_name", "label": "File Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "uploaded_on", "label": "Uploaded On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "verified", "label": "Checked by Operations", "fieldtype": "Check", "default": "0", "in_list_view": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Data"},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			RATE_DT,
			[
				{"fieldname": "mode", "label": "Mode", "fieldtype": "Select", "options": _sel(MODES), "reqd": 1, "in_list_view": 1},
				{"fieldname": "duration_min", "label": "Duration (min)", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "price_d2c", "label": "Price (patients)", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "price_b2b", "label": "Price per session (clinics)", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "chamber_name", "label": "Chamber (in person)", "fieldtype": "Data"},
				{"fieldname": "chamber_address", "label": "Chamber Address", "fieldtype": "Small Text"},
				{"fieldname": "chamber_lat", "label": "Chamber Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "chamber_lng", "label": "Chamber Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "home_visit", "label": "Home Visits", "fieldtype": "Check", "default": "0"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Data"},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			CHAMBER_DT,
			[
				{"fieldname": "chamber_name", "label": "Chamber", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "address", "label": "Address", "fieldtype": "Small Text", "in_list_view": 1},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			CUST_USER_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "full_name", "label": "Name", "fieldtype": "Data", "fetch_from": "user.full_name", "read_only": 1, "in_list_view": 1},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			MSG_DT,
			[
				{"fieldname": "sender", "label": "Sender", "fieldtype": "Link", "options": "User", "in_list_view": 1},
				{"fieldname": "sender_name", "label": "Sender Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "sender_role", "label": "Sender Role", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "body", "label": "Message", "fieldtype": "Small Text", "in_list_view": 1},
				{"fieldname": "sent_at", "label": "Sent At", "fieldtype": "Datetime"},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			SETTLE_LINE_DT,
			[
				{"fieldname": "booking", "label": "Booking", "fieldtype": "Link", "options": BOOKING_DT, "in_list_view": 1},
				{"fieldname": "slot_start", "label": "Shift Start", "fieldtype": "Datetime", "in_list_view": 1},
				{"fieldname": "chamber_name", "label": "Chamber", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "session_count", "label": "Sessions", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			MODULE_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "module_order", "label": "Order", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "wellness_video", "label": "Wellness Video", "fieldtype": "Link", "options": VIDEO_DT},
				{"fieldname": "video_url", "label": "Video URL", "fieldtype": "Data"},
				{"fieldname": "duration_min", "label": "Duration (min)", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "instructions", "label": "Instructions", "fieldtype": "Small Text"},
				{"fieldname": "is_preview", "label": "Free Preview", "fieldtype": "Check", "default": "0", "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			PROGRESS_DT,
			[
				{"fieldname": "module_row", "label": "Module Row", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "module_title", "label": "Module", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "completed", "label": "Completed", "fieldtype": "Check", "default": "0", "in_list_view": 1},
				{"fieldname": "completed_on", "label": "Completed On", "fieldtype": "Datetime"},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			PROVIDER_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "unique": 1, "in_standard_filter": 1},
				{"fieldname": "full_name", "label": "Full Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_global_search": 1},
				{"fieldname": "provider_category", "label": "Category", "fieldtype": "Select", "options": _sel(CATEGORIES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "verification_status", "label": "Verification", "fieldtype": "Select", "options": _sel(VERIFY_STATUSES), "default": "Pending", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "listed", "label": "Listed in Search", "fieldtype": "Check", "default": "0", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "can_prescribe_medicines", "label": "Can Prescribe Medicines", "fieldtype": "Check", "default": "0", "read_only": 1},
				{"fieldname": "headline", "label": "Headline", "fieldtype": "Data"},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "email", "label": "Email", "fieldtype": "Data"},
				{"fieldname": "gender", "label": "Gender", "fieldtype": "Select", "options": "\n" + _sel(GENDERS)},
				{"fieldname": "languages", "label": "Languages (comma separated)", "fieldtype": "Small Text"},
				{"fieldname": "specialities", "label": "Specialities / Focus Areas", "fieldtype": "Small Text"},
				{"fieldname": "city", "label": "City", "fieldtype": "Data", "in_standard_filter": 1},
				{"fieldname": "pincode", "label": "Pincode", "fieldtype": "Data"},
				{"fieldname": "bio", "label": "Bio", "fieldtype": "Small Text"},
				{"fieldname": "photo", "label": "Photo", "fieldtype": "Attach Image"},
				{"fieldname": "credentials_section", "label": "Credentials", "fieldtype": "Section Break"},
				{"fieldname": "registration_no", "label": "Registration No.", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "registration_council", "label": "Registration Council", "fieldtype": "Data"},
				{"fieldname": "years_experience", "label": "Years of Experience", "fieldtype": "Int"},
				{"fieldname": "qualifications", "label": "Qualifications", "fieldtype": "Table", "options": QUAL_DT},
				{"fieldname": "credentials", "label": "Credential Documents", "fieldtype": "Table", "options": CRED_DT},
				{"fieldname": "rates_section", "label": "Rates per Mode", "fieldtype": "Section Break"},
				{"fieldname": "rates", "label": "Rates", "fieldtype": "Table", "options": RATE_DT},
				{"fieldname": "verification_section", "label": "Verification", "fieldtype": "Section Break"},
				{"fieldname": "submitted_on", "label": "Submitted for Verification", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "verified_by", "label": "Verified By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "verified_on", "label": "Verified On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "verification_notes", "label": "Verification / Rejection Notes", "fieldtype": "Small Text"},
				{"fieldname": "signup_source", "label": "Signup Source", "fieldtype": "Select", "options": _sel(SIGNUP_SOURCES), "default": "Self Sign-up", "read_only": 1},
				{"fieldname": "links_section", "label": "Remedium Links", "fieldtype": "Section Break"},
				{"fieldname": "doctor", "label": "Doctor (Remedium)", "fieldtype": "Link", "options": DOCTOR_DT, "read_only": 1},
				{"fieldname": "service_provider_application", "label": "Provider Application", "fieldtype": "Link", "options": SPA_DT, "read_only": 1},
				{"fieldname": "rating_avg", "label": "Rating", "fieldtype": "Float", "precision": "2", "read_only": 1},
				{"fieldname": "rating_count", "label": "Ratings", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "payout_section", "label": "Payout", "fieldtype": "Section Break"},
				{"fieldname": "payout_upi", "label": "Payout UPI ID", "fieldtype": "Data"},
				{"fieldname": "bank_account_name", "label": "Bank Account Name", "fieldtype": "Data"},
				{"fieldname": "bank_account_no", "label": "Bank Account No.", "fieldtype": "Data"},
				{"fieldname": "bank_ifsc", "label": "IFSC", "fieldtype": "Data"},
				{"fieldname": "pan", "label": "PAN", "fieldtype": "Data"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"UDP-.#####",
			{"title_field": "full_name", "search_fields": "provider_category,city,mobile"},
		),
		(
			RULE_DT,
			[
				provider_ref,
				{"fieldname": "weekday", "label": "Weekday", "fieldtype": "Select", "options": _sel(WEEKDAYS), "reqd": 1, "in_list_view": 1},
				{"fieldname": "start_time", "label": "From", "fieldtype": "Time", "reqd": 1, "in_list_view": 1},
				{"fieldname": "end_time", "label": "To", "fieldtype": "Time", "reqd": 1, "in_list_view": 1},
				{"fieldname": "modes", "label": "Modes (one per line)", "fieldtype": "Small Text", "reqd": 1, "in_list_view": 1},
				{"fieldname": "slot_minutes", "label": "Slot (min)", "fieldtype": "Int", "default": "15", "reqd": 1},
				{"fieldname": "buffer_minutes", "label": "Buffer between slots (min)", "fieldtype": "Int", "default": "0"},
				{"fieldname": "chamber_name", "label": "Chamber (in person)", "fieldtype": "Data"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			],
			_perms(managers, ()),
			0,
			"UDAR-.#####",
			None,
		),
		(
			TIMEOFF_DT,
			[
				provider_ref,
				{"fieldname": "starts_at", "label": "From", "fieldtype": "Datetime", "reqd": 1, "in_list_view": 1},
				{"fieldname": "ends_at", "label": "Until", "fieldtype": "Datetime", "reqd": 1, "in_list_view": 1},
				{"fieldname": "reason", "label": "Reason", "fieldtype": "Data", "in_list_view": 1},
			],
			_perms(managers, ()),
			0,
			"UDTO-.#####",
			None,
		),
		(
			CUSTOMER_DT,
			[
				{"fieldname": "profile_type", "label": "Profile Type", "fieldtype": "Select", "options": _sel(PROFILE_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "display_name", "label": "Name", "fieldtype": "Data", "in_list_view": 1, "in_global_search": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(CLINIC_STATUSES), "default": "Active", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "patient_section", "label": "Patient (D2C)", "fieldtype": "Section Break"},
				{"fieldname": "health_patient", "label": "Health Patient", "fieldtype": "Link", "options": PATIENT_DT, "search_index": 1},
				{"fieldname": UPI_FIELD, "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "user", "label": "Owner Login", "fieldtype": "Link", "options": "User"},
				{"fieldname": "d2c_key", "label": "D2C Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "clinic_section", "label": "Clinic (B2B)", "fieldtype": "Section Break"},
				{"fieldname": "clinic_name", "label": "Clinic Name", "fieldtype": "Data"},
				{"fieldname": "contact_person", "label": "Contact Person", "fieldtype": "Data"},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "email", "label": "Email", "fieldtype": "Data"},
				{"fieldname": "gstin", "label": "GSTIN", "fieldtype": "Data"},
				{"fieldname": "address", "label": "Address", "fieldtype": "Small Text"},
				{"fieldname": "city", "label": "City", "fieldtype": "Data", "in_standard_filter": 1},
				{"fieldname": "pincode", "label": "Pincode", "fieldtype": "Data"},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "linked_franchisee", "label": "Linked Remedium Franchise", "fieldtype": "Link", "options": PROFILE_DT},
				{"fieldname": "chambers", "label": "Chambers", "fieldtype": "Table", "options": CHAMBER_DT},
				{"fieldname": "users", "label": "Clinic Users", "fieldtype": "Table", "options": CUST_USER_DT},
				{"fieldname": "approval_section", "label": "Approval", "fieldtype": "Section Break"},
				{"fieldname": "signup_source", "label": "Signup Source", "fieldtype": "Select", "options": _sel(SIGNUP_SOURCES), "default": "Self Sign-up", "read_only": 1},
				{"fieldname": "approved_by", "label": "Approved By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "approved_on", "label": "Approved On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "rejection_reason", "label": "Rejection / Suspension Reason", "fieldtype": "Small Text"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"UDC-.#####",
			{"title_field": "display_name", "search_fields": "profile_type,mobile,city"},
		),
		(
			PROGRAM_DT,
			[
				provider_ref,
				provider_name,
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_global_search": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Select", "options": _sel(PROGRAM_CATEGORIES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "level", "label": "Level", "fieldtype": "Select", "options": _sel(PROGRAM_LEVELS), "default": "All Levels"},
				{"fieldname": "format", "label": "Format", "fieldtype": "Select", "options": _sel(PROGRAM_FORMATS), "default": "Recorded", "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(PROGRAM_STATUSES), "default": "Draft", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "summary", "label": "Summary", "fieldtype": "Small Text"},
				{"fieldname": "description", "label": "Description", "fieldtype": "Text"},
				{"fieldname": "duration_weeks", "label": "Duration (weeks)", "fieldtype": "Int"},
				{"fieldname": "price", "label": "Price", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "modules", "label": "Modules", "fieldtype": "Table", "options": MODULE_DT},
				{"fieldname": "review_section", "label": "Moderation", "fieldtype": "Section Break"},
				{"fieldname": "review_notes", "label": "Review Notes", "fieldtype": "Small Text"},
				{"fieldname": "reviewed_by", "label": "Reviewed By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "published_on", "label": "Published On", "fieldtype": "Datetime", "read_only": 1},
			],
			_perms(managers, (), delete=0),
			0,
			"UDT-.#####",
			{"title_field": "title"},
		),
		(
			BOOKING_DT,
			[
				{"fieldname": "customer_profile", "label": "Customer Profile", "fieldtype": "Link", "options": CUSTOMER_DT, "reqd": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "profile_type", "label": "Customer Type", "fieldtype": "Select", "options": _sel(PROFILE_TYPES), "read_only": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "customer_name", "label": "Customer", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": UPI_FIELD, "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "booked_by", "label": "Booked By", "fieldtype": "Link", "options": "User", "read_only": 1},
				provider_ref,
				provider_name,
				{"fieldname": "provider_category", "label": "Provider Category", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "mode", "label": "Mode", "fieldtype": "Select", "options": _sel(MODES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(BOOKING_STATUSES), "default": ST_REQUESTED, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "slot_section", "label": "Slot", "fieldtype": "Section Break"},
				{"fieldname": "booking_date", "label": "Date", "fieldtype": "Date", "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "slot_start", "label": "Starts", "fieldtype": "Datetime", "search_index": 1},
				{"fieldname": "slot_end", "label": "Ends", "fieldtype": "Datetime"},
				{"fieldname": "session_count", "label": "Sessions (clinic shift)", "fieldtype": "Int", "default": "1"},
				{"fieldname": "chamber_name", "label": "Chamber", "fieldtype": "Data"},
				{"fieldname": "chamber_address", "label": "Chamber Address", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "chamber_lat", "label": "Chamber Latitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "chamber_lng", "label": "Chamber Longitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "home_visit", "label": "Home Visit", "fieldtype": "Check", "default": "0"},
				{"fieldname": "visit_address", "label": "Visit Address", "fieldtype": "Small Text"},
				{"fieldname": "reason", "label": "Reason for Visit", "fieldtype": "Small Text"},
				{"fieldname": "price", "label": "Price", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "hold_expires_at", "label": "Slot Held Until", "fieldtype": "Datetime", "read_only": 1},
				*payment_fields,
				{"fieldname": "refund_due", "label": "Refund Due", "fieldtype": "Check", "default": "0", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "clinic_section", "label": "Clinic Shift (B2B)", "fieldtype": "Section Break"},
				{"fieldname": "provider_response", "label": "Provider Response", "fieldtype": "Select", "options": "\n" + _sel(RESPONSES)},
				{"fieldname": "responded_on", "label": "Responded On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "decline_reason", "label": "Decline Reason", "fieldtype": "Small Text"},
				{"fieldname": "settlement", "label": "Clinic Settlement", "fieldtype": "Link", "options": SETTLEMENT_DT, "read_only": 1},
				{"fieldname": "video_section", "label": "Video / Telemedicine", "fieldtype": "Section Break"},
				{"fieldname": "room_name", "label": "Room", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "room_domain", "label": "Room Domain", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "room_expires_at", "label": "Room Closes", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "consent_recorded", "label": "Teleconsult Consent", "fieldtype": "Check", "default": "0"},
				{"fieldname": "messages", "label": "Messages", "fieldtype": "Table", "options": MSG_DT},
				{"fieldname": "program_section", "label": "Tutorial Programme", "fieldtype": "Section Break"},
				{"fieldname": "tutorial_program", "label": "Tutorial Program", "fieldtype": "Link", "options": PROGRAM_DT},
				{"fieldname": "tutorial_enrollment", "label": "Tutorial Enrollment", "fieldtype": "Link", "options": ENROLL_DT, "read_only": 1},
				{"fieldname": "outcome_section", "label": "Outcome", "fieldtype": "Section Break"},
				{"fieldname": "prescription", "label": "Digital Prescription", "fieldtype": "Link", "options": "Digital Prescription", "read_only": 1},
				{"fieldname": "doctor_appointment", "label": "Doctor Appointment (Remedium)", "fieldtype": "Link", "options": APPOINTMENT_DT, "read_only": 1},
				{"fieldname": "checked_in_at", "label": "Checked In At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "started_at", "label": "Started At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "completed_at", "label": "Completed At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "cancel_reason", "label": "Cancel Reason", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "cancelled_by", "label": "Cancelled By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"CB-.YYYY.-.#####",
			{"title_field": "patient_name", "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			ENROLL_DT,
			[
				{"fieldname": "program", "label": "Program", "fieldtype": "Link", "options": PROGRAM_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "program_title", "label": "Program Title", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "provider", "label": "Provider", "fieldtype": "Link", "options": PROVIDER_DT, "read_only": 1},
				{"fieldname": "customer_profile", "label": "Customer Profile", "fieldtype": "Link", "options": CUSTOMER_DT, "search_index": 1},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": UPI_FIELD, "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "user", "label": "Login", "fieldtype": "Link", "options": "User", "search_index": 1},
				{"fieldname": "booking", "label": "Booking", "fieldtype": "Link", "options": BOOKING_DT, "read_only": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(ENROLL_STATUSES), "default": "Pending Payment", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "price", "label": "Price", "fieldtype": "Currency"},
				*payment_fields,
				{"fieldname": "enrolled_on", "label": "Enrolled On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "completed_on", "label": "Completed On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "progress_pct", "label": "Progress %", "fieldtype": "Float", "precision": "1", "read_only": 1, "in_list_view": 1},
				{"fieldname": "enroll_key", "label": "Enroll Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "progress", "label": "Progress", "fieldtype": "Table", "options": PROGRESS_DT},
			],
			_perms(managers, (), delete=0),
			0,
			"UDE-.YYYY.-.#####",
			{"title_field": "program_title"},
		),
		(
			SETTLEMENT_DT,
			[
				{"fieldname": "customer_profile", "label": "Clinic", "fieldtype": "Link", "options": CUSTOMER_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "clinic_name", "label": "Clinic Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{**provider_ref, "reqd": 1},
				provider_name,
				{"fieldname": "period", "label": "Period (YYYY-MM)", "fieldtype": "Data", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(SETTLEMENT_STATUSES), "default": "Draft", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "session_count", "label": "Sessions", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "total_amount", "label": "Total", "fieldtype": "Currency", "read_only": 1, "in_list_view": 1},
				{"fieldname": "invoice_no", "label": "Invoice No.", "fieldtype": "Data"},
				{"fieldname": "invoiced_on", "label": "Invoiced On", "fieldtype": "Date", "read_only": 1},
				*payment_fields,
				{"fieldname": "open_key", "label": "Open Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "lines", "label": "Shifts", "fieldtype": "Table", "options": SETTLE_LINE_DT},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"UDS-.YYYY.-.#####",
			{"title_field": "clinic_name"},
		),
		(
			ICD_DT,
			[
				{"fieldname": "code", "label": "ICD-10 Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "description", "label": "Description", "fieldtype": "Data", "in_list_view": 1, "in_global_search": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "usage_count", "label": "Times Used", "fieldtype": "Int", "default": "0", "read_only": 1},
				{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": _sel(ICD_SOURCES), "default": "Provider Entry"},
			],
			_perms(managers, ()),
			0,
			"field:code",
			{"naming_rule": "By fieldname", "title_field": "description", "search_fields": "description"},
		),
	]


def _links_resolvable(fields):
	"""Drop Link/Table fields whose target DocType does not exist (yet); the next pass adds them."""
	dropped = {
		f.get("fieldname")
		for f in fields
		if f.get("fieldtype") in ("Link", "Table") and not frappe.db.exists("DocType", f.get("options"))
	}
	return [f for f in fields if f.get("fieldname") not in dropped and cstr(f.get("fetch_from")).split(".")[0] not in dropped]


def _ensure_roles():
	created = []
	for role, desk in ((ROLE_PROVIDER, 0), (ROLE_CLINIC, 0), (ROLE_MANAGER, 1)):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk}).insert(ignore_permissions=True)
			created.append(role)
	return created


def _all_specs():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx import rx_doctype_specs

	return _doctype_specs() + rx_doctype_specs()


def _ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	spec = {}
	if frappe.db.exists("DocType", APPOINTMENT_DT) and frappe.db.exists("DocType", BOOKING_DT):
		spec[APPOINTMENT_DT] = [
			{"fieldname": "uberdoc_booking", "label": "Uber Doc Booking", "fieldtype": "Link", "options": BOOKING_DT, "insert_after": "notes", "read_only": 1, "no_copy": 1, "search_index": 1}
		]
	if spec:
		create_custom_fields(spec, update=True)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx import ensure_rx_custom_fields

	return sorted(spec) + ensure_rx_custom_fields()


def ensure_consultation_type():
	if not frappe.db.exists("DocType", "Consultation Type"):
		return None
	if not frappe.db.exists("Consultation Type", CONSULT_TYPE):
		frappe.get_doc(
			{"doctype": "Consultation Type", "consultation_type": CONSULT_TYPE, "description": "Booked through Uber Doc (price set per provider and mode)."}
		).insert(ignore_permissions=True)
	return CONSULT_TYPE


def ensure_ud_setup():
	from health_ecosystem_core.health_ecosystem_core.clinical_emr import ensure_emr_setup

	created = _ensure_roles() + ensure_emr_setup()
	specs = _all_specs()
	for name, fields, perms, istable, autoname, extra in specs:
		if _ensure_doctype(name, _links_resolvable(fields), perms, istable=istable, autoname=autoname, extra=extra):
			created.append(name)
	for name, fields, perms, istable, autoname, extra in specs:
		_ensure_doctype(name, _links_resolvable(fields), perms, istable=istable, autoname=autoname, extra=extra)
	return created


def _ensure_ready():
	if not _has_field("Digital Prescription", "emr_record") or not _has_field(BOOKING_DT, "prescription") or not _has_field(PROVIDER_DT, "rates"):
		ensure_ud_setup()
		frappe.db.commit()


def ensure_scheduler_jobs():
	"""Register the jobs once the live hooks carry them (no global sync_jobs)."""
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	out = {}
	for method, expr in SCHEDULED_JOBS:
		key = method.rsplit(".", 1)[-1]
		if method not in (cron.get(expr) or []):
			out[key] = "not in hooks"
		elif frappe.db.exists("Scheduled Job Type", {"method": method}):
			out[key] = "present"
		else:
			frappe.get_doc({"doctype": "Scheduled Job Type", "method": method, "frequency": "Cron", "cron_format": expr}).insert(ignore_permissions=True)
			out[key] = "created"
	return out


def _enable_physician_role():
	"""Physician was found disabled on live; Frappe silently drops disabled roles from add_roles."""
	if not frappe.db.exists("Role", ROLE_PHYSICIAN):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE_PHYSICIAN, "desk_access": 1}).insert(ignore_permissions=True)
		return "created"
	if cint(frappe.db.get_value("Role", ROLE_PHYSICIAN, "disabled")):
		frappe.db.set_value("Role", ROLE_PHYSICIAN, "disabled", 0)
		frappe.clear_cache()
		return "enabled"
	return "present"


def sync_provider_roles():
	"""Clinical Provider role for every linked login; Physician for Verified Doctors (legacy appointment / e-Rx code)."""
	granted = []
	for row in frappe.get_all(PROVIDER_DT, fields=["user", "provider_category", "verification_status"], limit=0):
		if not row.user or not frappe.db.exists("User", row.user):
			continue
		roles = set(frappe.get_roles(row.user))
		want = [ROLE_PROVIDER]
		if row.provider_category == PRESCRIBER_CATEGORY and row.verification_status == "Verified":
			want.append(ROLE_PHYSICIAN)
		missing = [r for r in want if r not in roles]
		if missing:
			frappe.get_doc("User", row.user).add_roles(*missing)
			granted.append(row.user)
	return granted


def setup_phase135():
	"""Idempotent: roles, Uber Doc + e-Rx DocTypes, custom fields, EMR sink, payment scopes, consultation type, jobs."""
	from health_ecosystem_core.health_ecosystem_core.clinical_emr import setup_emr
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import ensure_payment_scopes

	created = ensure_ud_setup()
	physician_enabled = _enable_physician_role()
	frappe.db.commit()
	fields = _ensure_custom_fields()
	frappe.db.commit()
	emr = setup_emr()
	scopes = ensure_payment_scopes()
	out = {
		"ok": True,
		"created": created,
		"custom_fields": fields,
		"emr": emr,
		"payment_scopes_added": scopes,
		"consultation_type": ensure_consultation_type(),
		"physician_role_enabled": physician_enabled,
		"provider_roles_granted": sync_provider_roles(),
		"scheduler_jobs": ensure_scheduler_jobs(),
		"config": config_status(),
	}
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# Users, OTP and sign-up
# ---------------------------------------------------------------------------


def _user_ctx():
	"""Run user / DocType writes as Administrator (Guest sign-up cannot create Users through core hooks)."""
	previous = frappe.session.user
	frappe.set_user("Administrator")
	return previous


def ensure_ud_user(mobile, full_name=None, email=None):
	"""Existing login for this mobile, else a new Website User with no Remedium roles. Returns (user, created)."""
	mobile = _mobile(mobile)
	user = frappe.db.get_value("User", {"mobile_no": mobile}, "name")
	if user:
		return user, False
	email = cstr(email).strip().lower()
	if not EMAIL_RE.match(email) or frappe.db.exists("User", email):
		email = f"ud{mobile}@{USER_EMAIL_DOMAIN}"
	if frappe.db.exists("User", email):
		return email, False
	names = cstr(full_name).strip().split(" ", 1)
	previous = _user_ctx()
	try:
		doc = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": (names[0] or "Uber Doc")[:60],
				"last_name": (names[1] if len(names) > 1 else "")[:60],
				"mobile_no": mobile,
				"user_type": "Website User",
				"send_welcome_email": 0,
				"enabled": 1,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
	finally:
		frappe.set_user(previous)
	return doc.name, True


def _grant_role(user, *roles):
	if not user or not frappe.db.exists("User", user):
		return
	have = set(frappe.get_roles(user))
	missing = [r for r in roles if r not in have]
	if missing:
		previous = _user_ctx()
		try:
			frappe.get_doc("User", user).add_roles(*missing)
		finally:
			frappe.set_user(previous)


def _rate_limit(key, limit, seconds):
	if frappe.flags.ud_skip_rate_limit:
		return
	cache = frappe.cache()
	count = cint(cache.get_value(key))
	if count >= limit:
		_fail(_("Too many attempts; try again later"))
	cache.set_value(key, count + 1, expires_in_sec=seconds)


def _request_ip():
	return cstr(getattr(frappe.local, "request_ip", "")) or "local"


def _verify_otp(mobile, otp):
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import verify_otp_code

	ok, err = verify_otp_code(mobile, otp)
	if not ok:
		raise OtpError(err or _("OTP verification failed"))


def _login_session(user, mobile=None):
	frappe.local.login_manager.login_as(user)
	frappe.local.login_manager.post_login()
	doc = frappe.get_doc("User", user)
	return {
		"user": user,
		"username": doc.username or user,
		"full_name": doc.full_name,
		"roles": [r.role for r in doc.roles],
		"sid": frappe.session.sid,
		"must_change_password": False,
		"franchisee": None,
		"mobile": mobile or doc.mobile_no,
	}


def otp_login_allowed(user):
	if not user or not cint(frappe.db.get_value("User", user, "enabled")):
		return False
	return not (set(frappe.get_roles(user)) - OTP_LOGIN_ROLES)


def provider_for_user(user):
	if not user or user == "Guest" or not frappe.db.exists("DocType", PROVIDER_DT):
		return None
	return frappe.db.get_value(PROVIDER_DT, {"user": user}, "name")


def clinics_for_user(user, active_only=False):
	if not user or user == "Guest" or not frappe.db.exists("DocType", CUSTOMER_DT):
		return []
	names = frappe.get_all(CUST_USER_DT, filters={"user": user, "parenttype": CUSTOMER_DT, "active": 1}, pluck="parent", limit=0)
	if not names:
		return []
	filters = {"name": ("in", list(set(names))), "profile_type": B2B}
	if active_only:
		filters["status"] = "Active"
	return sorted(frappe.get_all(CUSTOMER_DT, filters=filters, pluck="name", limit=0))


def ud_user_for_mobile(mobile):
	"""A login linked to a Clinical Provider or a clinic profile with this mobile; None otherwise."""
	mobile = _mobile(mobile, required=False)
	if not mobile:
		return None
	candidates = frappe.get_all("User", filters={"mobile_no": mobile}, pluck="name", limit=5)
	candidates += frappe.get_all(PROVIDER_DT, filters={"mobile": mobile}, pluck="user", limit=5)
	candidates += frappe.get_all(CUST_USER_DT, filters={"mobile": mobile, "active": 1, "parenttype": CUSTOMER_DT}, pluck="user", limit=5)
	for user in dict.fromkeys(c for c in candidates if c):
		if provider_for_user(user) or clinics_for_user(user):
			return user
	return None


def otp_login(mobile, otp, login=True):
	"""Uber Doc provider / clinic OTP sign-in: never creates an account; staff accounts must use their password.
	Patients sign in with the Remedium patient OTP (verify_otp_and_login), because D2C patients are Remedium patients."""
	mobile = _mobile(mobile)
	_rate_limit(f"ud_otp_login:{mobile}", 20, 3600)
	_verify_otp(mobile, otp)
	user = ud_user_for_mobile(mobile)
	if not user:
		_missing(_("No Uber Doc provider or clinic account for this mobile. Patients: use the patient sign-in."))
	if not otp_login_allowed(user):
		_deny(_("This account must sign in with its password"))
	return _login_session(user, mobile) if login else {"user": user}


def _clean_email(value):
	email = cstr(value).strip().lower()
	if email and not EMAIL_RE.match(email):
		_fail(_("Enter a valid email"))
	return email or None


def provider_signup(mobile, otp, payload, login=True):
	"""Guest sign-up of a provider with an OTP-verified mobile; Pending verification until operations verify."""
	mobile = _mobile(mobile)
	_rate_limit(f"ud_signup_ip:{_request_ip()}", SIGNUP_IP_LIMIT, 3600)
	_rate_limit(f"ud_signup_mobile:{mobile}", SIGNUP_MOBILE_LIMIT, 86400)
	_verify_otp(mobile, otp)
	p = _parse(payload)
	if not isinstance(p, dict):
		_fail(_("Invalid request payload"))
	full_name = cstr(p.get("full_name")).strip()
	if len(full_name) < 3:
		_fail(_("Enter your full name"))
	category = cstr(p.get("provider_category")).strip()
	if category not in CATEGORIES:
		_fail(_("Choose your provider category"))
	email = _clean_email(p.get("email"))
	previous = _user_ctx()
	try:
		user, _created = ensure_ud_user(mobile, full_name, email)
		existing = provider_for_user(user)
		if existing and frappe.db.get_value(PROVIDER_DT, existing, "verification_status") != "Pending":
			_fail(_("This mobile already has an Uber Doc provider profile; sign in instead"))
		doc = frappe.get_doc(PROVIDER_DT, existing) if existing else frappe.new_doc(PROVIDER_DT)
		doc.user = user
		doc.full_name = full_name[:140]
		doc.provider_category = category
		doc.mobile = mobile
		doc.email = email
		doc.verification_status = "Pending"
		doc.signup_source = "Self Sign-up"
		_apply_provider_fields(doc, p, partial=True)
		if doc.is_new():
			doc.insert(ignore_permissions=True)
		else:
			doc.save(ignore_permissions=True)
	finally:
		frappe.set_user(previous)
	_grant_role(user, ROLE_PROVIDER)
	session = _login_session(user, mobile) if login and otp_login_allowed(user) else None
	return {
		"provider": provider_payload(doc.name),
		"session": session,
		"message": _("Thanks: complete your profile, credentials, rates and availability; operations will verify you")
		if session or not login
		else _("Submitted. This mobile belongs to an existing account: sign in with its password"),
	}


def clinic_signup(mobile, otp, payload, login=True):
	"""Guest sign-up of a B2B clinic with an OTP-verified mobile; Pending Approval until operations approve."""
	mobile = _mobile(mobile)
	_rate_limit(f"ud_signup_ip:{_request_ip()}", SIGNUP_IP_LIMIT, 3600)
	_rate_limit(f"ud_signup_mobile:{mobile}", SIGNUP_MOBILE_LIMIT, 86400)
	_verify_otp(mobile, otp)
	p = _parse(payload)
	if not isinstance(p, dict):
		_fail(_("Invalid request payload"))
	existing = frappe.db.get_value(CUSTOMER_DT, {"profile_type": B2B, "mobile": mobile, "status": "Pending Approval"}, "name")
	previous = _user_ctx()
	try:
		doc = frappe.get_doc(CUSTOMER_DT, existing) if existing else frappe.new_doc(CUSTOMER_DT)
		doc.profile_type = B2B
		_apply_clinic_fields(doc, {**p, "mobile": mobile}, partial=False)
		doc.status = "Pending Approval"
		doc.signup_source = "Self Sign-up"
		user, _created = ensure_ud_user(mobile, p.get("contact_person") or p.get("clinic_name"), p.get("email"))
		if not any(r.user == user for r in doc.get("users") or []):
			doc.append("users", {"user": user, "mobile": mobile, "active": 1})
		if doc.is_new():
			doc.insert(ignore_permissions=True)
		else:
			doc.save(ignore_permissions=True)
	finally:
		frappe.set_user(previous)
	session = _login_session(user, mobile) if login and otp_login_allowed(user) else None
	return {
		"clinic": clinic_payload(doc.name),
		"session": session,
		"message": _("Thanks: operations will review your clinic and contact you")
		if session or not login
		else _("Submitted. This mobile belongs to an existing account: sign in with its password"),
	}


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

PROVIDER_TEXT_FIELDS = (
	("headline", 140),
	("languages", 500),
	("specialities", 1000),
	("city", 140),
	("bio", 3000),
	("registration_council", 140),
	("bank_account_name", 140),
	("bank_account_no", 40),
	("notes", 2000),
)
# Editing these on a Verified provider sends the profile back to Pending verification.
CREDENTIAL_KEYS = ("full_name", "provider_category", "registration_no", "registration_council", "qualifications")


def _apply_provider_fields(doc, p, partial=True):
	if "full_name" in p or not partial:
		name = cstr(p.get("full_name")).strip()
		if len(name) < 3:
			_fail(_("Enter the full name"))
		doc.full_name = name[:140]
	if "provider_category" in p:
		cat = cstr(p.get("provider_category")).strip()
		if cat not in CATEGORIES:
			_fail(_("Invalid provider category"))
		doc.provider_category = cat
	if "gender" in p:
		gender = cstr(p.get("gender")).strip().title()
		if gender and gender not in GENDERS:
			_fail(_("Invalid gender"))
		doc.gender = gender or None
	if "email" in p:
		doc.email = _clean_email(p.get("email"))
	if "pincode" in p:
		pin = cstr(p.get("pincode")).strip()
		if pin and not PINCODE_RE.match(pin):
			_fail(_("Pincode must be 6 digits"))
		doc.pincode = pin or None
	if "registration_no" in p:
		doc.registration_no = _text(p.get("registration_no"), 80)
	if "years_experience" in p:
		years = cint(p.get("years_experience"))
		if years < 0 or years > 70:
			_fail(_("Years of experience must be between 0 and 70"))
		doc.years_experience = years
	if "bank_ifsc" in p:
		ifsc = cstr(p.get("bank_ifsc")).strip().upper()
		if ifsc and not IFSC_RE.match(ifsc):
			_fail(_("Invalid IFSC"))
		doc.bank_ifsc = ifsc or None
	if "payout_upi" in p:
		upi = cstr(p.get("payout_upi")).strip()
		if upi and not UPI_ID_RE.match(upi):
			_fail(_("Invalid UPI ID"))
		doc.payout_upi = upi or None
	if "pan" in p:
		pan = cstr(p.get("pan")).strip().upper()
		if pan and not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", pan):
			_fail(_("Invalid PAN"))
		doc.pan = pan or None
	for key, limit in PROVIDER_TEXT_FIELDS:
		if key in p:
			doc.set(key, _text(p.get(key), limit))
	if "qualifications" in p:
		rows = []
		for q in _parse(p.get("qualifications"), []) or []:
			degree = cstr((q or {}).get("degree")).strip()
			if not degree:
				continue
			year = cint(q.get("year")) or None
			if year and (year < 1950 or year > getdate(today()).year):
				_fail(_("Qualification year {0} is not plausible").format(year))
			rows.append({"degree": degree[:140], "institution": _text(q.get("institution"), 140), "year": year})
		doc.set("qualifications", rows[:20])


def _credential_snapshot(doc):
	return json.dumps(
		{
			"full_name": doc.full_name,
			"provider_category": doc.provider_category,
			"registration_no": doc.registration_no,
			"registration_council": doc.registration_council,
			"qualifications": [(q.degree, q.institution, q.year) for q in doc.get("qualifications") or []],
		},
		sort_keys=True,
		default=str,
	)


def _rate_row(r):
	return {
		"name": r.name,
		"mode": r.mode,
		"mode_label": MODE_LABEL.get(r.mode, r.mode),
		"duration_min": cint(r.duration_min),
		"price_d2c": flt(r.price_d2c),
		"price_b2b": flt(r.price_b2b) if flt(r.price_b2b) > 0 else None,
		"active": cint(r.active),
		"chamber_name": r.chamber_name,
		"chamber_address": r.chamber_address,
		"chamber_lat": flt(r.chamber_lat, 6) or None,
		"chamber_lng": flt(r.chamber_lng, 6) or None,
		"home_visit": cint(r.home_visit),
		"notes": r.notes,
	}


def _active_rates(doc, mode=None):
	return [r for r in doc.get("rates") or [] if cint(r.active) and (not mode or r.mode == mode)]


def completeness(doc):
	rules = frappe.db.count(RULE_DT, {"provider": doc.name, "active": 1}) if frappe.db.exists("DocType", RULE_DT) else 0
	checks = {
		"profile": bool(doc.full_name and doc.provider_category and doc.city and doc.bio),
		"credentials": bool(doc.get("credentials")) and (doc.provider_category != PRESCRIBER_CATEGORY or bool(doc.registration_no and doc.registration_council)),
		"qualifications": bool(doc.get("qualifications")),
		"rates": bool(_active_rates(doc)),
		"availability": rules > 0 or all(r.mode == TUTORIAL_PROGRAM for r in _active_rates(doc)),
	}
	return {"checks": checks, "ready": all(checks.values())}


def provider_payload(name, private=True):
	doc = frappe.get_doc(PROVIDER_DT, name)
	out = {
		"name": doc.name,
		"full_name": doc.full_name,
		"provider_category": doc.provider_category,
		"verification_status": doc.verification_status,
		"listed": cint(doc.listed),
		"can_prescribe_medicines": cint(doc.can_prescribe_medicines),
		"headline": doc.headline,
		"gender": doc.gender,
		"languages": [x.strip() for x in cstr(doc.languages).split(",") if x.strip()],
		"specialities": doc.specialities,
		"city": doc.city,
		"pincode": doc.pincode,
		"bio": doc.bio,
		"photo": doc.photo,
		"registration_no": doc.registration_no,
		"registration_council": doc.registration_council,
		"years_experience": cint(doc.years_experience),
		"qualifications": [{"degree": q.degree, "institution": q.institution, "year": cint(q.year) or None} for q in doc.get("qualifications") or []],
		"rates": [_rate_row(r) for r in doc.get("rates") or [] if private or cint(r.active)],
		"rating_avg": flt(doc.rating_avg, 2) or None,
		"rating_count": cint(doc.rating_count),
	}
	if private:
		out.update(
			{
				"user": doc.user,
				"mobile": doc.mobile,
				"email": doc.email,
				"credentials": [
					{"name": c.name, "doc_type": c.doc_type, "file_name": c.file_name, "uploaded_on": _str(c.uploaded_on), "verified": cint(c.verified), "notes": c.notes}
					for c in doc.get("credentials") or []
				],
				"submitted_on": _str(doc.submitted_on),
				"verified_by": doc.verified_by,
				"verified_on": _str(doc.verified_on),
				"verification_notes": doc.verification_notes,
				"signup_source": doc.signup_source,
				"doctor": doc.doctor,
				"service_provider_application": doc.service_provider_application,
				"payout_upi": doc.payout_upi,
				"bank_account_name": doc.bank_account_name,
				"bank_account_no": doc.bank_account_no,
				"bank_ifsc": doc.bank_ifsc,
				"pan": doc.pan,
				"notes": doc.notes,
				"completeness": completeness(doc),
				"creation": _str(doc.creation),
			}
		)
	return out


def provider_card(row, customer_type=D2C):
	"""Public search card: active rates only, B2B price only for clinics."""
	rates = []
	for r in frappe.get_all(RATE_DT, filters={"parent": row.name, "parenttype": PROVIDER_DT, "active": 1}, fields=["*"], order_by="idx asc", limit=0):
		rate = _rate_row(r)
		if customer_type != B2B:
			rate.pop("price_b2b", None)
		rates.append(rate)
	degrees = frappe.get_all(QUAL_DT, filters={"parent": row.name, "parenttype": PROVIDER_DT}, pluck="degree", order_by="idx asc", limit=6)
	return {
		"name": row.name,
		"full_name": row.full_name,
		"provider_category": row.provider_category,
		"headline": row.headline,
		"qualifications": ", ".join(degrees),
		"years_experience": cint(row.years_experience),
		"languages": [x.strip() for x in cstr(row.languages).split(",") if x.strip()],
		"city": row.city,
		"bio": cstr(row.bio)[:400] or None,
		"photo": row.photo,
		"rating_avg": flt(row.rating_avg, 2) or None,
		"rating_count": cint(row.rating_count),
		"registration_no": row.registration_no if row.provider_category == PRESCRIBER_CATEGORY else None,
		"registration_council": row.registration_council if row.provider_category == PRESCRIBER_CATEGORY else None,
		"rates": rates,
		"modes": sorted({r["mode"] for r in rates}),
	}


PROVIDER_CARD_FIELDS = ["name", "full_name", "provider_category", "headline", "years_experience", "languages", "city", "bio", "photo", "rating_avg", "rating_count", "registration_no", "registration_council"]


def search_providers(filters=None):
	f = filters or {}
	where = {"verification_status": "Verified", "listed": 1}
	category = cstr(f.get("category")).strip()
	if category:
		if category not in CATEGORIES:
			_fail(_("Invalid category"))
		where["provider_category"] = category
	city = cstr(f.get("city")).strip()
	if city:
		where["city"] = ("like", f"%{city}%")
	language = cstr(f.get("language")).strip()
	if language:
		where["languages"] = ("like", f"%{language}%")
	or_filters = None
	q = cstr(f.get("q")).strip()
	if q:
		or_filters = [["full_name", "like", f"%{q}%"], ["headline", "like", f"%{q}%"], ["specialities", "like", f"%{q}%"]]
	customer_type = B2B if cstr(f.get("customer_type")).upper() == B2B else D2C
	mode = cstr(f.get("mode")).strip().upper()
	if mode and mode not in MODES:
		_fail(_("Invalid mode"))
	if customer_type == B2B:
		mode = PHYSICAL
	max_price = flt(f.get("max_price")) if f.get("max_price") not in (None, "") else None
	rows = frappe.get_all(PROVIDER_DT, filters=where, or_filters=or_filters, fields=PROVIDER_CARD_FIELDS, order_by="rating_avg desc, full_name asc", limit=300)
	out = []
	for row in rows:
		card = provider_card(row, customer_type)
		rates = [r for r in card["rates"] if not mode or r["mode"] == mode]
		if customer_type == B2B:
			rates = [r for r in rates if r.get("price_b2b")]
		if max_price is not None:
			key = "price_b2b" if customer_type == B2B else "price_d2c"
			rates = [r for r in rates if flt(r.get(key)) <= max_price]
		if not rates:
			continue
		card["rates"] = rates if mode else card["rates"]
		out.append(card)
	page = max(cint(f.get("page")) or 1, 1)
	size = min(max(cint(f.get("page_size")) or 24, 1), 60)
	return {"rows": out[(page - 1) * size : page * size], "total": len(out), "page": page, "page_size": size}


def public_provider(name, customer_type=D2C):
	row = frappe.db.get_value(PROVIDER_DT, {"name": name, "verification_status": "Verified", "listed": 1}, PROVIDER_CARD_FIELDS + ["specialities"], as_dict=True)
	if not row:
		_missing(_("Provider not found"))
	card = provider_card(row, B2B if cstr(customer_type).upper() == B2B else D2C)
	card["specialities"] = row.specialities
	card["qualification_rows"] = [
		{"degree": q.degree, "institution": q.institution, "year": cint(q.year) or None}
		for q in frappe.get_all(QUAL_DT, filters={"parent": name, "parenttype": PROVIDER_DT}, fields=["degree", "institution", "year"], order_by="idx asc", limit=20)
	]
	card["programs"] = [
		program_card(p)
		for p in frappe.get_all(PROGRAM_DT, filters={"provider": name, "status": "Published"}, fields=PROGRAM_CARD_FIELDS, order_by="published_on desc", limit=20)
	]
	return card


def save_provider_profile(ctx, payload):
	name = ctx.provider
	_lock(PROVIDER_DT, name)
	doc = frappe.get_doc(PROVIDER_DT, name)
	before = _credential_snapshot(doc)
	p = {k: v for k, v in (payload or {}).items() if k not in ("user", "mobile", "verification_status", "listed", "can_prescribe_medicines", "doctor", "rates", "credentials")}
	_apply_provider_fields(doc, p, partial=True)
	reset = doc.verification_status == "Verified" and _credential_snapshot(doc) != before
	if reset:
		doc.verification_status = "Pending"
		doc.listed = 0
		doc.can_prescribe_medicines = 0
		doc.verification_notes = _("Credentials changed on {0}: verification needed again").format(now_datetime().strftime("%Y-%m-%d %H:%M"))
	doc.save(ignore_permissions=True)
	out = provider_payload(doc.name)
	out["verification_reset"] = reset
	return out


def _clean_rates(rows):
	out, seen = [], set()
	for r in rows or []:
		r = r or {}
		mode = cstr(r.get("mode")).strip().upper()
		if mode not in MODES:
			_fail(_("Invalid mode {0}").format(r.get("mode")))
		duration = cint(r.get("duration_min"))
		if mode != TUTORIAL_PROGRAM and not 5 <= duration <= 480:
			_fail(_("{0}: duration must be 5 to 480 minutes").format(MODE_LABEL[mode]))
		if r.get("price_d2c") in (None, ""):
			_fail(_("{0}: set the price for patients (0 for free)").format(MODE_LABEL[mode]))
		price = flt(r.get("price_d2c"), 2)
		b2b = flt(r.get("price_b2b"), 2) if r.get("price_b2b") not in (None, "") else None
		if price < 0 or (b2b is not None and b2b < 0):
			_fail(_("Prices cannot be negative"))
		if b2b is not None and mode != PHYSICAL:
			b2b = None
		chamber = cstr(r.get("chamber_name")).strip()[:140] if mode == PHYSICAL else ""
		if mode == PHYSICAL and len(chamber) < 2:
			_fail(_("In-person rate: name the chamber / clinic"))
		lat = flt(r.get("chamber_lat"), 6) if mode == PHYSICAL and r.get("chamber_lat") not in (None, "") else None
		lng = flt(r.get("chamber_lng"), 6) if mode == PHYSICAL and r.get("chamber_lng") not in (None, "") else None
		if (lat is not None and abs(lat) > 90) or (lng is not None and abs(lng) > 180):
			_fail(_("Invalid chamber coordinates"))
		key = (mode, chamber.lower())
		if key in seen:
			_fail(_("Duplicate rate for {0} {1}").format(MODE_LABEL[mode], chamber))
		seen.add(key)
		out.append(
			{
				"mode": mode,
				"duration_min": duration or None,
				"price_d2c": price,
				"price_b2b": b2b,
				"active": 0 if r.get("active") in (0, "0", False) else 1,
				"chamber_name": chamber or None,
				"chamber_address": _text(r.get("chamber_address"), 1000) if mode == PHYSICAL else None,
				"chamber_lat": lat,
				"chamber_lng": lng,
				"home_visit": 1 if mode == PHYSICAL and cint(r.get("home_visit")) else 0,
				"notes": _text(r.get("notes"), 140),
			}
		)
	return out


def save_rates(ctx, rows):
	_lock(PROVIDER_DT, ctx.provider)
	doc = frappe.get_doc(PROVIDER_DT, ctx.provider)
	doc.set("rates", _clean_rates(_parse(rows, [])))
	doc.save(ignore_permissions=True)
	return provider_payload(doc.name)


def _file_ext(filename):
	return cstr(filename).rsplit(".", 1)[-1].lower() if "." in cstr(filename) else ""


def _decode_upload(filename, content_b64, exts):
	filename = re.sub(r"[^A-Za-z0-9._ -]", "_", cstr(filename).strip())[:120]
	if _file_ext(filename) not in exts:
		_fail(_("Upload a {0} file").format(" / ".join(e.upper() for e in exts)))
	raw = cstr(content_b64)
	if "," in raw[:100] and raw.startswith("data:"):
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw, validate=False)
	except Exception:
		_fail(_("The file could not be read"))
	if not content:
		_fail(_("The file is empty"))
	if len(content) > MAX_UPLOAD_BYTES:
		_fail(_("Files must be 5 MB or smaller"))
	return filename, content


def _save_file(doctype, name, filename, content, private=True, fieldname=None):
	f = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"attached_to_doctype": doctype,
			"attached_to_name": name,
			"attached_to_field": fieldname,
			"is_private": 1 if private else 0,
			"content": content,
		}
	)
	f.flags.ignore_permissions = True
	f.insert(ignore_permissions=True)
	return f.file_url


def upload_credential(ctx, doc_type, filename, content_b64, notes=None):
	if doc_type not in CRED_TYPES:
		_fail(_("Choose the document type"))
	filename, content = _decode_upload(filename, content_b64, UPLOAD_EXTS)
	_lock(PROVIDER_DT, ctx.provider)
	doc = frappe.get_doc(PROVIDER_DT, ctx.provider)
	if len(doc.get("credentials") or []) >= 20:
		_fail(_("Remove an old document first (20 maximum)"))
	url = _save_file(PROVIDER_DT, doc.name, filename, content, private=True)
	doc.append("credentials", {"doc_type": doc_type, "file": url, "file_name": filename, "uploaded_on": now_datetime(), "verified": 0, "notes": _text(notes, 140)})
	if doc.verification_status == "Verified":
		doc.verification_notes = _("New credential uploaded {0}").format(now_datetime().strftime("%Y-%m-%d"))
	doc.save(ignore_permissions=True)
	return provider_payload(doc.name)


def remove_credential(ctx, row):
	_lock(PROVIDER_DT, ctx.provider)
	doc = frappe.get_doc(PROVIDER_DT, ctx.provider)
	keep = [c for c in doc.get("credentials") or [] if c.name != row]
	if len(keep) == len(doc.get("credentials") or []):
		_missing(_("Document not found"))
	if doc.verification_status == "Verified" and not keep:
		_fail(_("A verified provider must keep at least one credential document"))
	doc.set("credentials", keep)
	doc.save(ignore_permissions=True)
	return provider_payload(doc.name)


def upload_photo(ctx, filename, content_b64):
	filename, content = _decode_upload(filename, content_b64, PHOTO_EXTS)
	url = _save_file(PROVIDER_DT, ctx.provider, filename, content, private=False, fieldname="photo")
	frappe.db.set_value(PROVIDER_DT, ctx.provider, "photo", url)
	return provider_payload(ctx.provider)


def credential_file(ctx, provider, row):
	if not ctx.is_manager and ctx.provider != provider:
		_deny(_("Not permitted"))
	url = frappe.db.get_value(CRED_DT, {"name": row, "parent": provider, "parenttype": PROVIDER_DT}, "file")
	if not url:
		_missing(_("Document not found"))
	f = frappe.get_doc("File", {"file_url": url})
	content = f.get_content()
	if isinstance(content, str):
		content = content.encode()
	return {"filename": f.file_name, "content_base64": base64.b64encode(content).decode(), "content_type": "application/pdf" if _file_ext(f.file_name) == "pdf" else f"image/{_file_ext(f.file_name)}"}


def submit_for_verification(ctx):
	doc = frappe.get_doc(PROVIDER_DT, ctx.provider)
	state = completeness(doc)
	if not state["ready"]:
		missing = [k for k, ok in state["checks"].items() if not ok]
		_fail(_("Complete these first: {0}").format(", ".join(missing)))
	frappe.db.set_value(PROVIDER_DT, doc.name, "submitted_on", now_datetime())
	_notify_ops(_("Uber Doc: {0} ({1}) submitted their profile for verification.").format(doc.full_name, doc.provider_category))
	return provider_payload(doc.name)


# --- verification (operations) ----------------------------------------------


def _ensure_doctor(doc):
	"""Link (or create) the Remedium Doctor for a Doctor-category provider and grant Physician."""
	if not frappe.db.exists("DocType", DOCTOR_DT):
		return None
	doctor = doc.doctor if doc.doctor and frappe.db.exists(DOCTOR_DT, doc.doctor) else None
	if not doctor:
		doctor = frappe.db.get_value(DOCTOR_DT, {"user": doc.user}, "name")
	if not doctor and doc.email:
		doctor = frappe.db.get_value(DOCTOR_DT, {"email": doc.email, "user": ("is", "not set")}, "name")
	if not doctor:
		d = frappe.get_doc({"doctype": DOCTOR_DT, "doctor_name": doc.full_name, "user": doc.user, "mobile": doc.mobile, "email": doc.email, "status": "Active"})
		d.insert(ignore_permissions=True)
		doctor = d.name
	else:
		frappe.db.set_value(DOCTOR_DT, doctor, {"user": doc.user, "status": "Active"})
	if _has_field(DOCTOR_DT, "provider_bio") and doc.bio and not frappe.db.get_value(DOCTOR_DT, doctor, "provider_bio"):
		frappe.db.set_value(DOCTOR_DT, doctor, "provider_bio", cstr(doc.bio)[:2000])
	_grant_role(doc.user, ROLE_PHYSICIAN)
	return doctor


def verify_provider(name, action, reason=None, user=None):
	_lock(PROVIDER_DT, name)
	doc = frappe.get_doc(PROVIDER_DT, name)
	reason = cstr(reason).strip()[:1000]
	if action == "verify":
		if doc.verification_status == "Verified":
			return provider_payload(name)
		if not doc.get("credentials"):
			_fail(_("No credential documents uploaded"))
		if doc.provider_category == PRESCRIBER_CATEGORY and not (doc.registration_no and doc.registration_council):
			_fail(_("A doctor needs a registration number and council before verification"))
		doc.verification_status = "Verified"
		doc.verified_by = user or frappe.session.user
		doc.verified_on = now_datetime()
		doc.listed = 1
		doc.can_prescribe_medicines = 1 if doc.provider_category == PRESCRIBER_CATEGORY else 0
		doc.verification_notes = reason or None
		for c in doc.get("credentials") or []:
			c.verified = 1
		if doc.provider_category == PRESCRIBER_CATEGORY:
			doc.doctor = _ensure_doctor(doc)
		doc.save(ignore_permissions=True)
		_grant_role(doc.user, ROLE_PROVIDER)
		_notify(doc.mobile, _("Uber Doc: your provider profile is verified and now listed. Sign in at {0}/login").format(app_url() or "Uber Doc"))
	elif action in ("reject", "suspend"):
		if not reason:
			_fail(_("Give the reason"))
		if action == "reject" and doc.verification_status not in ("Pending", "Rejected"):
			_fail(_("Only a pending provider can be rejected; suspend a verified one"))
		doc.verification_status = "Rejected" if action == "reject" else "Suspended"
		doc.listed = 0
		doc.can_prescribe_medicines = 0
		doc.verification_notes = reason
		doc.save(ignore_permissions=True)
		_notify(doc.mobile, _("Uber Doc: your provider profile was {0}: {1}").format("not approved" if action == "reject" else "suspended", reason))
	elif action == "reinstate":
		if doc.verification_status != "Suspended":
			_fail(_("Only a suspended provider can be reinstated"))
		doc.verification_status = "Verified"
		doc.listed = 1
		doc.can_prescribe_medicines = 1 if doc.provider_category == PRESCRIBER_CATEGORY else 0
		doc.save(ignore_permissions=True)
	elif action == "unlist":
		frappe.db.set_value(PROVIDER_DT, name, "listed", 0)
	elif action == "list":
		if doc.verification_status != "Verified":
			_fail(_("Only verified providers can be listed"))
		frappe.db.set_value(PROVIDER_DT, name, "listed", 1)
	else:
		_fail(_("Unknown action"))
	return provider_payload(name)


def list_providers_ops(filters=None):
	f = filters or {}
	where = {}
	if f.get("status") in VERIFY_STATUSES:
		where["verification_status"] = f["status"]
	if f.get("category") in CATEGORIES:
		where["provider_category"] = f["category"]
	or_filters = None
	q = cstr(f.get("q")).strip()
	if q:
		or_filters = [["full_name", "like", f"%{q}%"], ["mobile", "like", f"%{q}%"], ["registration_no", "like", f"%{q}%"], ["name", "like", f"%{q}%"]]
	names = frappe.get_all(PROVIDER_DT, filters=where, or_filters=or_filters, pluck="name", order_by="submitted_on desc, modified desc", limit=300)
	return {"rows": [provider_payload(n) for n in names], "counts": {s: frappe.db.count(PROVIDER_DT, {"verification_status": s}) for s in VERIFY_STATUSES}}


def import_application(application, user=None):
	"""Create a Clinical Provider from an approved phase 41 Service Provider Application (reuses its Doctor)."""
	if not frappe.db.exists(SPA_DT, application):
		_missing(_("Application not found"))
	spa = frappe.get_doc(SPA_DT, application)
	if spa.application_status != "Approved":
		_fail(_("Only approved applications can be imported"))
	existing = frappe.db.get_value(PROVIDER_DT, {"service_provider_application": application}, "name")
	if existing:
		return provider_payload(existing)
	login = spa.linked_user or spa.applicant_user
	if not login:
		login, _created = ensure_ud_user(spa.phone, spa.full_name, spa.email)
	if provider_for_user(login):
		_fail(_("That login already has an Uber Doc provider profile"))
	wing = cstr(spa.wellness_wing).lower()
	category = PRESCRIBER_CATEGORY if spa.provider_type == "Doctor" else {"psychology": "Psychologist", "physiotherapy": "Physiotherapist", "yoga": "Yoga Instructor"}.get(wing, "Therapist")
	doc = frappe.get_doc(
		{
			"doctype": PROVIDER_DT,
			"user": login,
			"full_name": spa.full_name,
			"provider_category": category,
			"verification_status": "Pending",
			"mobile": _mobile(spa.phone, required=False),
			"email": spa.email,
			"gender": spa.gender if spa.gender in GENDERS else None,
			"city": spa.city,
			"bio": frappe.utils.strip_html(cstr(spa.bio))[:3000] or None,
			"registration_no": spa.registration_number,
			"qualifications": [{"degree": spa.qualification}] if spa.qualification else [],
			"doctor": spa.linked_doctor,
			"service_provider_application": spa.name,
			"signup_source": "Provider Application",
		}
	)
	doc.insert(ignore_permissions=True)
	for field, label in (("id_proof", "Identity Proof"), ("degree_certificate", "Degree Certificate")):
		if spa.get(field):
			doc.append("credentials", {"doc_type": label, "file": spa.get(field), "file_name": cstr(spa.get(field)).rsplit("/", 1)[-1], "uploaded_on": now_datetime()})
	doc.save(ignore_permissions=True)
	_grant_role(login, ROLE_PROVIDER)
	return provider_payload(doc.name)


# ---------------------------------------------------------------------------
# Availability and slots
# ---------------------------------------------------------------------------


def _rule_row(r):
	return {
		"name": r.name,
		"weekday": r.weekday,
		"start_time": _hhmm(r.start_time),
		"end_time": _hhmm(r.end_time),
		"modes": [m for m in cstr(r.modes).split("\n") if m.strip()],
		"slot_minutes": cint(r.slot_minutes),
		"buffer_minutes": cint(r.buffer_minutes),
		"chamber_name": r.chamber_name,
		"active": cint(r.active),
	}


def _timeoff_row(r):
	return {"name": r.name, "starts_at": _iso(r.starts_at), "ends_at": _iso(r.ends_at), "reason": r.reason}


def list_availability(provider):
	rules = frappe.get_all(RULE_DT, filters={"provider": provider}, fields=["*"], limit=0)
	rules.sort(key=lambda r: (WEEKDAYS.index(r.weekday) if r.weekday in WEEKDAYS else 9, cstr(_hhmm(r.start_time))))
	offs = frappe.get_all(TIMEOFF_DT, filters={"provider": provider, "ends_at": (">=", add_days(now_datetime(), -30))}, fields=["*"], order_by="starts_at asc", limit=200)
	return {"rules": [_rule_row(r) for r in rules], "time_off": [_timeoff_row(r) for r in offs]}


def _minutes(t):
	return t.hour * 60 + t.minute


def save_rule(ctx, payload):
	p = payload or {}
	provider = ctx.provider
	_lock(PROVIDER_DT, provider)
	prov = frappe.get_doc(PROVIDER_DT, provider)
	weekday = cstr(p.get("weekday")).strip().title()
	if weekday not in WEEKDAYS:
		_fail(_("Choose a weekday"))
	start = _time_in(p.get("start_time"), _("From"))
	end = _time_in(p.get("end_time"), _("To"))
	if end <= start:
		_fail(_("The block must end after it starts"))
	modes = []
	for m in _list(p.get("modes")):
		m = cstr(m).strip().upper()
		if m not in SLOT_MODES:
			_fail(_("Availability modes must be in person, video or audio / chat"))
		if m not in modes:
			modes.append(m)
	if not modes:
		_fail(_("Pick at least one mode"))
	rate_modes = {r.mode for r in _active_rates(prov)}
	missing = [MODE_LABEL[m] for m in modes if m not in rate_modes]
	if missing:
		_fail(_("Set a rate first for: {0}").format(", ".join(missing)))
	slot = cint(p.get("slot_minutes")) or 15
	buffer = cint(p.get("buffer_minutes"))
	if not 5 <= slot <= 240 or not 0 <= buffer <= 120:
		_fail(_("Slot must be 5 to 240 minutes and the buffer 0 to 120"))
	if _minutes(get_time(end)) - _minutes(get_time(start)) < slot:
		_fail(_("The block is shorter than one slot"))
	chamber = cstr(p.get("chamber_name")).strip() or None
	if PHYSICAL in modes:
		chambers = [r.chamber_name for r in _active_rates(prov, PHYSICAL)]
		if not chamber and len(chambers) == 1:
			chamber = chambers[0]
		if chamber not in chambers:
			_fail(_("Pick the chamber for in-person slots"))
	else:
		chamber = None
	name = cstr(p.get("name")).strip()
	for other in frappe.get_all(RULE_DT, filters={"provider": provider, "weekday": weekday, "active": 1, "name": ("!=", name or "")}, fields=["name", "start_time", "end_time"], limit=0):
		if cstr(_to_time(other.start_time)) < end and start < cstr(_to_time(other.end_time)):
			_fail(_("Overlaps another {0} block ({1}–{2})").format(weekday, _hhmm(other.start_time), _hhmm(other.end_time)))
	values = {
		"weekday": weekday,
		"start_time": start,
		"end_time": end,
		"modes": "\n".join(modes),
		"slot_minutes": slot,
		"buffer_minutes": buffer,
		"chamber_name": chamber,
		"active": 0 if p.get("active") in (0, "0", False) else 1,
	}
	if name:
		if frappe.db.get_value(RULE_DT, name, "provider") != provider:
			_missing(_("Availability block not found"))
		frappe.db.set_value(RULE_DT, name, values)
	else:
		doc = frappe.get_doc({"doctype": RULE_DT, "provider": provider, **values})
		doc.insert(ignore_permissions=True)
	return list_availability(provider)


def delete_rule(ctx, name):
	if frappe.db.get_value(RULE_DT, name, "provider") != ctx.provider:
		_missing(_("Availability block not found"))
	frappe.delete_doc(RULE_DT, name, ignore_permissions=True, force=True)
	return list_availability(ctx.provider)


def save_time_off(ctx, payload):
	p = payload or {}
	starts = _dt_in(p.get("starts_at"), _("From"))
	ends = _dt_in(p.get("ends_at"), _("Until"))
	if len(cstr(p.get("ends_at")).strip()) <= 10:
		ends = ends.replace(hour=23, minute=59, second=59)
	if ends <= starts:
		_fail(_("Time off must end after it starts"))
	if (ends - starts).days > 120:
		_fail(_("Time off longer than 120 days: ask operations to unlist you instead"))
	frappe.get_doc({"doctype": TIMEOFF_DT, "provider": ctx.provider, "starts_at": starts, "ends_at": ends, "reason": _text(p.get("reason"), 140)}).insert(ignore_permissions=True)
	return list_availability(ctx.provider)


def delete_time_off(ctx, name):
	if frappe.db.get_value(TIMEOFF_DT, name, "provider") != ctx.provider:
		_missing(_("Time off not found"))
	frappe.delete_doc(TIMEOFF_DT, name, ignore_permissions=True, force=True)
	return list_availability(ctx.provider)


def _blocking(row, now=None):
	if row.status not in OPEN_STATUSES and row.status != ST_COMPLETED:
		return False
	if row.status == ST_REQUESTED:
		if row.profile_type == B2B:
			return False
		if row.hold_expires_at and get_datetime(row.hold_expires_at) < (now or now_datetime()):
			return False
	return True


def busy_intervals(provider, start, end, exclude=None, now=None):
	"""Intervals (start, end, source) already taken: bookings, time off, linked Doctor's Remedium appointments."""
	out = []
	for b in frappe.get_all(
		BOOKING_DT,
		filters={"provider": provider, "slot_start": ("<", end), "slot_end": (">", start), "name": ("!=", exclude or "")},
		fields=["name", "slot_start", "slot_end", "status", "profile_type", "hold_expires_at"],
		limit=0,
	):
		if _blocking(b, now):
			out.append((get_datetime(b.slot_start), get_datetime(b.slot_end), b.name))
	for t in frappe.get_all(TIMEOFF_DT, filters={"provider": provider, "starts_at": ("<", end), "ends_at": (">", start)}, fields=["name", "starts_at", "ends_at"], limit=0):
		out.append((get_datetime(t.starts_at), get_datetime(t.ends_at), "time-off"))
	doctor = frappe.db.get_value(PROVIDER_DT, provider, "doctor")
	if doctor and frappe.db.exists("DocType", APPOINTMENT_DT):
		filters = {"doctor": doctor, "appointment_date": ("between", [getdate(start), getdate(end)]), "status": ("not in", ["Cancelled", "No Show"])}
		if _has_field(APPOINTMENT_DT, "uberdoc_booking"):
			filters["uberdoc_booking"] = ("is", "not set")
		for a in frappe.get_all(APPOINTMENT_DT, filters=filters, fields=["name", "appointment_date", "appointment_time"], limit=0):
			if not a.appointment_time:
				continue
			s = datetime.combine(getdate(a.appointment_date), _to_time(a.appointment_time))
			out.append((s, s + timedelta(minutes=LEGACY_APPOINTMENT_MINUTES), a.name))
	return out


def _overlaps(intervals, s, e):
	return any(bs < e and s < be for bs, be, _src in intervals)


def provider_slots(provider, date_from=None, days=7, mode=None, now=None):
	"""Free slots per day. Each slot: start, end, modes (subset of the rule's modes with an active rate), chamber."""
	row = frappe.db.get_value(PROVIDER_DT, provider, ["name", "verification_status", "listed"], as_dict=True)
	if not row:
		_missing(_("Provider not found"))
	mode = cstr(mode).strip().upper() or None
	if mode and mode not in SLOT_MODES:
		_fail(_("Slots exist for in person, video and audio / chat modes only"))
	now = now or now_datetime()
	start_day = getdate(date_from) if date_from else getdate(now)
	days = min(max(cint(days) or 7, 1), MAX_SLOT_DAYS)
	if start_day < getdate(now):
		start_day = getdate(now)
	rates = {r.mode for r in frappe.get_all(RATE_DT, filters={"parent": provider, "parenttype": PROVIDER_DT, "active": 1}, fields=["mode"], limit=0)}
	rules = frappe.get_all(RULE_DT, filters={"provider": provider, "active": 1}, fields=["*"], limit=0)
	range_start = datetime.combine(start_day, dtime.min)
	range_end = range_start + timedelta(days=days)
	busy = busy_intervals(provider, range_start, range_end, now=now)
	earliest = now + timedelta(minutes=SLOT_LEAD_MINUTES)
	out = []
	for offset in range(days):
		day = add_days(start_day, offset)
		weekday = WEEKDAYS[getdate(day).weekday()]
		slots = []
		for rule in rules:
			if rule.weekday != weekday:
				continue
			modes = [m for m in cstr(rule.modes).split("\n") if m in rates and (not mode or m == mode)]
			if not modes:
				continue
			length = timedelta(minutes=cint(rule.slot_minutes) or 15)
			step = length + timedelta(minutes=cint(rule.buffer_minutes))
			cursor = datetime.combine(getdate(day), _to_time(rule.start_time))
			block_end = datetime.combine(getdate(day), _to_time(rule.end_time))
			while cursor + length <= block_end:
				s, e = cursor, cursor + length
				if s >= earliest and not _overlaps(busy, s, e):
					slots.append({"start": _iso(s), "end": _iso(e), "modes": modes, "chamber_name": rule.chamber_name if PHYSICAL in modes else None})
				cursor += step
		slots.sort(key=lambda x: x["start"])
		out.append({"date": cstr(getdate(day)), "weekday": weekday, "slots": slots})
	return {"provider": provider, "days": out, "bookable": row.verification_status == "Verified" and cint(row.listed) == 1}


# ---------------------------------------------------------------------------
# Customer profiles
# ---------------------------------------------------------------------------


def ensure_d2c_profile(patient, user=None):
	"""One D2C_PATIENT profile per Health Patient (unique d2c_key), carrying its Universal Patient ID."""
	if not patient or not frappe.db.exists(PATIENT_DT, patient):
		_fail(_("Patient not found"))
	upi = assign_upi(patient)
	existing = frappe.db.get_value(CUSTOMER_DT, {"d2c_key": patient}, ["name", UPI_FIELD], as_dict=True)
	if existing:
		if upi and existing.get(UPI_FIELD) != upi:
			frappe.db.set_value(CUSTOMER_DT, existing.name, UPI_FIELD, upi, update_modified=False)
		return existing.name
	pname, mobile = frappe.db.get_value(PATIENT_DT, patient, ["patient_name", "mobile"]) or (None, None)
	doc = frappe.get_doc(
		{
			"doctype": CUSTOMER_DT,
			"profile_type": D2C,
			"display_name": pname or patient,
			"status": "Active",
			"health_patient": patient,
			UPI_FIELD: upi,
			"user": user if user and user != "Guest" else None,
			"mobile": _mobile(mobile, required=False),
			"d2c_key": patient,
			"signup_source": "Self Sign-up",
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(CUSTOMER_DT, {"d2c_key": patient}, "name")
	return doc.name


def _apply_clinic_fields(doc, p, partial):
	if "clinic_name" in p or not partial:
		name = cstr(p.get("clinic_name")).strip()
		if len(name) < 3:
			_fail(_("Enter the clinic name"))
		doc.clinic_name = name[:140]
		doc.display_name = name[:140]
	if "mobile" in p or not partial:
		doc.mobile = _mobile(p.get("mobile"))
	if "email" in p:
		doc.email = _clean_email(p.get("email"))
	if "pincode" in p:
		pin = cstr(p.get("pincode")).strip()
		if pin and not PINCODE_RE.match(pin):
			_fail(_("Pincode must be 6 digits"))
		doc.pincode = pin or None
	if "gstin" in p:
		gstin = cstr(p.get("gstin")).strip().upper()
		if gstin and not GSTIN_RE.match(gstin):
			_fail(_("Invalid GSTIN"))
		doc.gstin = gstin or None
	for key, limit in (("contact_person", 140), ("city", 140), ("address", 1000), ("notes", 2000)):
		if key in p:
			doc.set(key, _text(p.get(key), limit))
	for key in ("lat", "lng"):
		if key in p:
			value = flt(p.get(key), 6) if p.get(key) not in (None, "") else 0
			if (key == "lat" and abs(value) > 90) or (key == "lng" and abs(value) > 180):
				_fail(_("Invalid coordinates"))
			doc.set(key, value)
	if "chambers" in p:
		rows, seen = [], set()
		for c in _parse(p.get("chambers"), []) or []:
			cname = cstr((c or {}).get("chamber_name")).strip()[:140]
			if not cname:
				continue
			if cname.lower() in seen:
				_fail(_("Duplicate chamber {0}").format(cname))
			seen.add(cname.lower())
			lat = flt(c.get("lat"), 6) if c.get("lat") not in (None, "") else 0
			lng = flt(c.get("lng"), 6) if c.get("lng") not in (None, "") else 0
			if abs(lat) > 90 or abs(lng) > 180:
				_fail(_("Invalid chamber coordinates"))
			rows.append({"chamber_name": cname, "address": _text(c.get("address"), 1000), "lat": lat, "lng": lng, "active": 0 if c.get("active") in (0, "0", False) else 1})
		doc.set("chambers", rows[:30])


def clinic_payload(name):
	doc = frappe.get_doc(CUSTOMER_DT, name)
	return {
		"name": doc.name,
		"profile_type": doc.profile_type,
		"clinic_name": doc.clinic_name,
		"contact_person": doc.contact_person,
		"mobile": doc.mobile,
		"email": doc.email,
		"gstin": doc.gstin,
		"address": doc.address,
		"city": doc.city,
		"pincode": doc.pincode,
		"lat": flt(doc.lat, 6) or None,
		"lng": flt(doc.lng, 6) or None,
		"status": doc.status,
		"linked_franchisee": doc.linked_franchisee,
		"chambers": [{"name": c.name, "chamber_name": c.chamber_name, "address": c.address, "lat": flt(c.lat, 6) or None, "lng": flt(c.lng, 6) or None, "active": cint(c.active)} for c in doc.get("chambers") or []],
		"users": [{"user": u.user, "full_name": u.full_name, "mobile": u.mobile, "active": cint(u.active)} for u in doc.get("users") or []],
		"signup_source": doc.signup_source,
		"approved_by": doc.approved_by,
		"approved_on": _str(doc.approved_on),
		"rejection_reason": doc.rejection_reason,
		"notes": doc.notes,
		"creation": _str(doc.creation),
	}


def clinic_users(profile):
	return frappe.get_all(CUST_USER_DT, filters={"parent": profile, "parenttype": CUSTOMER_DT, "active": 1}, pluck="user", limit=0)


def save_clinic(ctx, payload):
	p = payload or {}
	name = cstr(p.get("name")).strip() or (ctx.clinics[0] if ctx.clinics else None)
	if not name or (not ctx.is_manager and name not in ctx.clinics):
		_deny(_("Not your clinic"))
	_lock(CUSTOMER_DT, name)
	doc = frappe.get_doc(CUSTOMER_DT, name)
	allowed = {k: v for k, v in p.items() if k in ("clinic_name", "contact_person", "email", "gstin", "address", "city", "pincode", "lat", "lng", "chambers", "notes")}
	_apply_clinic_fields(doc, allowed, partial=True)
	doc.save(ignore_permissions=True)
	return clinic_payload(doc.name)


def ops_save_clinic(payload, user=None):
	p = payload or {}
	name = cstr(p.get("name")).strip()
	doc = frappe.get_doc(CUSTOMER_DT, name) if name and frappe.db.exists(CUSTOMER_DT, name) else frappe.new_doc(CUSTOMER_DT)
	if doc.is_new():
		doc.profile_type = B2B
	elif doc.profile_type != B2B:
		_fail(_("Not a clinic profile"))
	_apply_clinic_fields(doc, p, partial=not doc.is_new())
	if "linked_franchisee" in p:
		value = cstr(p.get("linked_franchisee")).strip() or None
		if value and not frappe.db.exists(PROFILE_DT, value):
			_fail(_("Remedium franchise {0} not found").format(value))
		doc.linked_franchisee = value
	if doc.is_new():
		doc.status = "Active"
		doc.signup_source = "Operations"
		doc.approved_by = user or frappe.session.user
		doc.approved_on = now_datetime()
	if "users" in p:
		rows = []
		for ref in _list(p.get("users")):
			ref = cstr(ref).strip()
			if not ref:
				continue
			uid = ref if frappe.db.exists("User", ref) else ensure_ud_user(ref, doc.contact_person or doc.clinic_name)[0]
			if uid not in [r["user"] for r in rows]:
				rows.append({"user": uid, "mobile": frappe.db.get_value("User", uid, "mobile_no"), "active": 1})
		doc.set("users", rows)
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	if doc.status == "Active":
		for row in doc.users:
			if cint(row.active):
				_grant_role(row.user, ROLE_CLINIC)
	return clinic_payload(doc.name)


def clinic_action(name, action, reason=None, user=None):
	if not name or not frappe.db.exists(CUSTOMER_DT, name):
		_missing(_("Clinic not found"))
	doc = frappe.get_doc(CUSTOMER_DT, name)
	if doc.profile_type != B2B:
		_fail(_("Not a clinic profile"))
	reason = cstr(reason).strip()[:500]
	if action == "approve":
		if doc.status not in ("Pending Approval", "Rejected"):
			_fail(_("{0} is {1}").format(doc.clinic_name, doc.status))
		doc.update({"status": "Active", "approved_by": user or frappe.session.user, "approved_on": now_datetime(), "rejection_reason": None})
		doc.save(ignore_permissions=True)
		for row in doc.users:
			if cint(row.active):
				_grant_role(row.user, ROLE_CLINIC)
		_notify(doc.mobile, _("Uber Doc: {0} is approved. Sign in with this mobile to book specialists for your chambers.").format(doc.clinic_name))
	elif action == "reject":
		if not reason:
			_fail(_("Give the reason"))
		if doc.status != "Pending Approval":
			_fail(_("Only a pending sign-up can be rejected"))
		doc.update({"status": "Rejected", "rejection_reason": reason})
		doc.save(ignore_permissions=True)
		_notify(doc.mobile, _("Uber Doc: the sign-up for {0} was not approved: {1}").format(doc.clinic_name, reason))
	elif action in ("suspend", "activate"):
		if action == "activate" and not doc.approved_on:
			_fail(_("Approve the sign-up first"))
		doc.status = "Suspended" if action == "suspend" else "Active"
		if action == "suspend":
			doc.rejection_reason = reason or doc.rejection_reason
		doc.save(ignore_permissions=True)
	else:
		_fail(_("Unknown action"))
	return clinic_payload(doc.name)


def list_clinics_ops(filters=None):
	f = filters or {}
	where = {"profile_type": B2B}
	if f.get("status") in CLINIC_STATUSES:
		where["status"] = f["status"]
	or_filters = None
	q = cstr(f.get("q")).strip()
	if q:
		or_filters = [["clinic_name", "like", f"%{q}%"], ["mobile", "like", f"%{q}%"], ["city", "like", f"%{q}%"], ["name", "like", f"%{q}%"]]
	names = frappe.get_all(CUSTOMER_DT, filters=where, or_filters=or_filters, pluck="name", order_by="modified desc", limit=300)
	return {"rows": [clinic_payload(n) for n in names], "counts": {s: frappe.db.count(CUSTOMER_DT, {"profile_type": B2B, "status": s}) for s in CLINIC_STATUSES}}


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


def _patients_of(ctx):
	if ctx.patients is None:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import list_profiles

			ctx.patients = [p["patient"] for p in list_profiles(ctx.user)]
		except Exception:
			frappe.log_error(title="phase135 patient profiles", message=frappe.get_traceback())
			ctx.patients = []
	return ctx.patients


def _patient_for(ctx, patient=None, payload=None):
	patients = _patients_of(ctx)
	if patient:
		if patient not in patients:
			_deny(_("You can book only for yourself or family members linked to your account"))
		return patient
	if patients:
		return patients[0]
	p = payload or {}
	name = cstr(p.get("patient_name")).strip()
	if len(name) < 2:
		_fail(_("Enter the patient's name"))
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import link_patient_account
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

	mobile = frappe.db.get_value("User", ctx.user, "mobile_no")
	gender = cstr(p.get("gender")).strip().title()
	pid = ensure_patient(patient_name=name, phone=mobile, gender=gender if gender in GENDERS else None, user=ctx.user)
	if not pid:
		_fail(_("Could not create the patient record"))
	link_patient_account(ctx.user, pid, "Self", is_primary=1, consent=True)
	ctx.patients = None
	return pid


def booking_party(ctx, doc):
	if doc.provider and frappe.db.get_value(PROVIDER_DT, doc.provider, "user") == ctx.user:
		return "provider"
	if doc.profile_type == B2B and ctx.user in clinic_users(doc.customer_profile):
		return "clinic"
	if doc.booked_by == ctx.user or (doc.patient and doc.patient in _patients_of(ctx)):
		return "patient"
	if ctx.is_manager:
		return "ops"
	return None


def _booking(ctx, name, parties=None, lock=False):
	if not name or not frappe.db.exists(BOOKING_DT, name):
		_missing(_("Booking not found"))
	if lock:
		_lock(BOOKING_DT, name)
	doc = frappe.get_doc(BOOKING_DT, name)
	party = booking_party(ctx, doc)
	if not party or (parties and party not in parties):
		_deny(_("Not your booking"))
	return doc, party


def room_window(doc):
	if not doc.slot_start or not doc.slot_end:
		return None, None
	return get_datetime(doc.slot_start) - timedelta(minutes=JOIN_EARLY_MINUTES), get_datetime(doc.slot_end) + timedelta(minutes=JOIN_GRACE_MINUTES)


def booking_row(row):
	return {
		"name": row.name,
		"profile_type": row.profile_type,
		"customer_profile": row.customer_profile,
		"customer_name": row.customer_name,
		"patient": row.patient,
		"patient_name": row.patient_name,
		"universal_patient_id": row.get(UPI_FIELD),
		"provider": row.provider,
		"provider_name": row.provider_name,
		"provider_category": row.provider_category,
		"mode": row.mode,
		"mode_label": MODE_LABEL.get(row.mode, row.mode),
		"status": row.status,
		"booking_date": _str(row.booking_date),
		"slot_start": _iso(row.slot_start),
		"slot_end": _iso(row.slot_end),
		"session_count": cint(row.session_count) or 1,
		"chamber_name": row.chamber_name,
		"price": flt(row.price),
		"payment_mode": row.payment_mode,
		"payment_status": row.payment_status,
		"refund_due": cint(row.refund_due),
		"provider_response": row.provider_response,
		"tutorial_program": row.tutorial_program,
		"prescription": row.prescription,
		"hold_expires_at": _iso(row.hold_expires_at),
		"creation": _str(row.creation),
	}


BOOKING_LIST_FIELDS = [
	"name", "profile_type", "customer_profile", "customer_name", "patient", "patient_name", UPI_FIELD, "provider", "provider_name", "provider_category",
	"mode", "status", "booking_date", "slot_start", "slot_end", "session_count", "chamber_name", "price", "payment_mode", "payment_status", "refund_due",
	"provider_response", "tutorial_program", "prescription", "hold_expires_at", "creation",
]


def booking_payload(doc, party=None):
	out = booking_row(doc)
	opens, closes = room_window(doc)
	now = now_datetime()
	out.update(
		{
			"party": party,
			"reason": doc.reason,
			"chamber_address": doc.chamber_address,
			"chamber_lat": flt(doc.chamber_lat, 6) or None,
			"chamber_lng": flt(doc.chamber_lng, 6) or None,
			"home_visit": cint(doc.home_visit),
			"visit_address": doc.visit_address,
			"decline_reason": doc.decline_reason,
			"cancel_reason": doc.cancel_reason,
			"settlement": doc.settlement,
			"tutorial_enrollment": doc.tutorial_enrollment,
			"doctor_appointment": doc.doctor_appointment,
			"checked_in_at": _iso(doc.checked_in_at),
			"started_at": _iso(doc.started_at),
			"completed_at": _iso(doc.completed_at),
			"consent_recorded": cint(doc.consent_recorded),
			"room_opens_at": _iso(opens),
			"room_closes_at": _iso(closes),
			"can_join": bool(doc.mode in VIDEO_MODES and doc.status in LIVE_STATUSES and opens and opens <= now <= closes and party in ("patient", "provider", "clinic")),
			"messages": [
				{"sender_name": m.sender_name, "sender_role": m.sender_role, "body": m.body, "sent_at": _iso(m.sent_at), "mine": m.sender == frappe.session.user}
				for m in doc.get("messages") or []
			],
			"rx": _rx_brief(doc.prescription),
			"transitions": sorted(TRANSITIONS.get(doc.status, set())) if party in ("provider", "ops") else [],
		}
	)
	return out


def _rx_brief(name):
	if not name or not frappe.db.exists("Digital Prescription", name):
		return None
	row = frappe.db.get_value("Digital Prescription", name, ["name", "status", "verify_code", "signed_on", "clinical_prescription"], as_dict=True)
	return {"name": row.name, "status": row.status, "verify_code": row.verify_code if row.status == "Signed" else None, "signed_on": _iso(row.signed_on), "clinical_prescription": row.clinical_prescription}


def _provider_live(provider):
	row = frappe.db.get_value(PROVIDER_DT, provider, ["name", "full_name", "provider_category", "verification_status", "listed", "user", "mobile", "doctor"], as_dict=True)
	if not row:
		_missing(_("Provider not found"))
	if row.verification_status != "Verified" or not cint(row.listed):
		_fail(_("This provider is not taking bookings"))
	return row


def _rate_for(provider, mode, chamber=None):
	rates = frappe.get_all(RATE_DT, filters={"parent": provider, "parenttype": PROVIDER_DT, "active": 1, "mode": mode}, fields=["*"], order_by="idx asc", limit=0)
	if mode == PHYSICAL and chamber:
		rates = [r for r in rates if cstr(r.chamber_name).lower() == cstr(chamber).lower()]
	if not rates:
		_fail(_("This provider does not offer {0}").format(MODE_LABEL.get(mode, mode)))
	return rates[0]


def _new_booking(values):
	doc = frappe.get_doc({"doctype": BOOKING_DT, **values})
	doc.insert(ignore_permissions=True)
	return doc


def book_d2c(ctx, payload):
	p = payload or {}
	mode = cstr(p.get("mode")).strip().upper()
	if mode not in SLOT_MODES:
		_fail(_("Choose in person, video or audio / chat"))
	provider = cstr(p.get("provider")).strip()
	patient = _patient_for(ctx, cstr(p.get("patient")).strip() or None, p)
	start = _dt_in(p.get("slot_start"), _("Slot"))
	_lock(PROVIDER_DT, provider)
	prov = _provider_live(provider)
	if prov.user == ctx.user:
		_fail(_("You cannot book yourself"))
	day = provider_slots(provider, getdate(start), 1, mode)["days"][0]
	match = next((s for s in day["slots"] if s["start"] == _iso(start) and mode in s["modes"]), None)
	if not match:
		_fail(_("That slot is no longer available; pick another"))
	end = get_datetime(match["end"])
	if _overlaps(busy_intervals(provider, start, end), start, end):
		_fail(_("That slot is no longer available; pick another"))
	rate = _rate_for(provider, mode, match.get("chamber_name"))
	home_visit = 1 if mode == PHYSICAL and cint(p.get("home_visit")) and cint(rate.home_visit) else 0
	visit_address = _text(p.get("visit_address"), 1000) if home_visit else None
	if home_visit and not visit_address:
		_fail(_("Enter the address for the home visit"))
	price = flt(rate.price_d2c)
	pay = cstr(p.get("payment_mode")).strip() or "Online"
	if price <= 0:
		pay, status, pay_status, hold = "Free", ST_CONFIRMED, "Not Required", None
	elif pay == "Pay at Clinic":
		if mode != PHYSICAL:
			_fail(_("Online consultations are paid online"))
		status, pay_status, hold = ST_CONFIRMED, "Unpaid", None
	elif pay == "Online":
		if not payments_configured()["online"]:
			_fail(_("Online payment is not available yet; choose pay at the clinic for in-person visits"))
		status, pay_status, hold = ST_REQUESTED, "Pending", now_datetime() + timedelta(minutes=HOLD_MINUTES)
	else:
		_fail(_("Choose online payment or pay at the clinic"))
	if mode in VIDEO_MODES and not cint(p.get("consent")):
		_fail(_("Please confirm consent for a remote consultation"))
	profile = ensure_d2c_profile(patient, ctx.user)
	prow = frappe.db.get_value(PATIENT_DT, patient, ["patient_name", UPI_FIELD], as_dict=True)
	doc = _new_booking(
		{
			"customer_profile": profile,
			"profile_type": D2C,
			"customer_name": prow.patient_name,
			"patient": patient,
			"patient_name": prow.patient_name,
			UPI_FIELD: prow.get(UPI_FIELD) or assign_upi(patient),
			"booked_by": ctx.user,
			"provider": provider,
			"provider_name": prov.full_name,
			"provider_category": prov.provider_category,
			"mode": mode,
			"status": status,
			"booking_date": getdate(start),
			"slot_start": start,
			"slot_end": end,
			"session_count": 1,
			"chamber_name": rate.chamber_name if mode == PHYSICAL else None,
			"chamber_address": rate.chamber_address if mode == PHYSICAL else None,
			"chamber_lat": flt(rate.chamber_lat) if mode == PHYSICAL else 0,
			"chamber_lng": flt(rate.chamber_lng) if mode == PHYSICAL else 0,
			"home_visit": home_visit,
			"visit_address": visit_address,
			"reason": _text(p.get("reason"), 1000),
			"price": price,
			"payment_mode": pay,
			"payment_status": pay_status,
			"hold_expires_at": hold,
			"consent_recorded": 1 if mode in VIDEO_MODES else 0,
		}
	)
	if status == ST_CONFIRMED:
		_on_confirmed(doc)
	return booking_payload(frappe.get_doc(BOOKING_DT, doc.name), "patient")


def _assign_room(doc):
	if doc.mode not in VIDEO_MODES or doc.room_name:
		return
	cfg = jitsi_config()
	_opens, closes = room_window(doc)
	frappe.db.set_value(BOOKING_DT, doc.name, {"room_name": f"ud-{secrets.token_hex(12)}", "room_domain": cfg["domain"], "room_expires_at": closes}, update_modified=False)


def _shadow_appointment(doc):
	"""Doctor-category bookings with a patient also appear as a Remedium Doctor Appointment (provider dashboard, e-Rx)."""
	if doc.doctor_appointment or not doc.patient or not doc.slot_start or doc.mode == TUTORIAL_PROGRAM:
		return None
	doctor = frappe.db.get_value(PROVIDER_DT, doc.provider, "doctor")
	if not doctor or not frappe.db.exists("DocType", APPOINTMENT_DT):
		return None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import sales_company

		start = get_datetime(doc.slot_start)
		values = {
			"doctype": APPOINTMENT_DT,
			"patient": doc.patient,
			"patient_name": doc.patient_name,
			"doctor": doctor,
			"doctor_name": doc.provider_name,
			"consultation_type": ensure_consultation_type(),
			"appointment_date": start.date(),
			"appointment_time": start.strftime("%H:%M:%S"),
			"status": "Confirmed",
			"notes": _("Uber Doc booking {0} ({1})").format(doc.name, MODE_LABEL.get(doc.mode, doc.mode)),
			"amount": flt(doc.price),
			"razorpay_payment_status": "Paid" if doc.payment_status == "Paid" else "Pending",
			"payment_method": "Online" if doc.payment_mode == "Online" else "Pay at Hub",
			"company": sales_company() or (frappe.get_all("Company", pluck="name", limit=1) or [None])[0],
		}
		if _has_field(APPOINTMENT_DT, "consultation_mode"):
			values["consultation_mode"] = "Online" if doc.mode in VIDEO_MODES else "In-person"
		if _has_field(APPOINTMENT_DT, "uberdoc_booking"):
			values["uberdoc_booking"] = doc.name
		apt = frappe.get_doc(values)
		apt.insert(ignore_permissions=True)
		frappe.db.set_value(BOOKING_DT, doc.name, "doctor_appointment", apt.name, update_modified=False)
		return apt.name
	except Exception:
		frappe.log_error(title="phase135 shadow appointment", message=f"{doc.name}\n{frappe.get_traceback()}")
		return None


def _sync_shadow(doc, status):
	if doc.doctor_appointment and frappe.db.exists(APPOINTMENT_DT, doc.doctor_appointment):
		mapping = {ST_CANCELLED: "Cancelled", ST_NO_SHOW: "No Show", ST_COMPLETED: "Completed", ST_CHECKED_IN: "Checked In"}
		values = {}
		if status in mapping:
			values["status"] = mapping[status]
		if doc.payment_status == "Paid":
			values["razorpay_payment_status"] = "Paid"
		if values:
			frappe.db.set_value(APPOINTMENT_DT, doc.doctor_appointment, values)


def _on_confirmed(doc):
	doc = frappe.get_doc(BOOKING_DT, doc.name)
	_assign_room(doc)
	if doc.profile_type == D2C:
		_shadow_appointment(doc)
	_notify_booking(doc.name, "confirmed")


def _transition(doc, status, user, reason=None):
	if status not in TRANSITIONS.get(doc.status, set()):
		_fail(_("A {0} booking cannot become {1}").format(doc.status, status))
	now = now_datetime()
	values = {"status": status}
	if status == ST_CHECKED_IN:
		values["checked_in_at"] = now
	elif status == ST_IN_CONSULT:
		values["started_at"] = doc.started_at or now
	elif status == ST_COMPLETED:
		values["completed_at"] = now
		values["started_at"] = doc.started_at or now
	elif status == ST_NO_SHOW:
		if doc.slot_start and get_datetime(doc.slot_start) > now:
			_fail(_("No show can be marked only after the slot starts"))
	elif status == ST_CANCELLED:
		values.update({"cancel_reason": cstr(reason).strip()[:500] or None, "cancelled_by": user})
		if doc.payment_status == "Paid":
			values["refund_due"] = 1
	frappe.db.set_value(BOOKING_DT, doc.name, values)
	doc.reload()
	_sync_shadow(doc, status)
	if status == ST_COMPLETED and doc.profile_type == B2B:
		_accrue_settlement(doc)
	if status == ST_COMPLETED and doc.tutorial_enrollment:
		frappe.db.set_value(ENROLL_DT, doc.tutorial_enrollment, {"status": "Completed", "completed_on": now})
	if status == ST_CANCELLED:
		_notify_booking(doc.name, "cancelled")
	return doc


def provider_set_status(ctx, name, status, reason=None):
	doc, party = _booking(ctx, name, ("provider", "ops"), lock=True)
	if status == ST_CANCELLED and not cstr(reason).strip():
		_fail(_("Give the reason for cancelling"))
	if doc.profile_type == B2B and doc.status == ST_REQUESTED and status == ST_CONFIRMED:
		_fail(_("Accept the clinic request instead"))
	if doc.status == ST_REQUESTED and status == ST_CONFIRMED and doc.payment_status == "Pending":
		_fail(_("Waiting for the patient's payment"))
	doc = _transition(doc, status, ctx.user, reason)
	return booking_payload(doc, party)


def cancel_booking(ctx, name, reason=None):
	doc, party = _booking(ctx, name, ("patient", "clinic", "ops"), lock=True)
	if doc.status not in (ST_REQUESTED, ST_CONFIRMED):
		_fail(_("Only a requested or confirmed booking can be cancelled"))
	if party != "ops" and doc.status == ST_CONFIRMED and doc.slot_start and get_datetime(doc.slot_start) <= now_datetime():
		_fail(_("The slot has started; ask the provider"))
	doc = _transition(doc, ST_CANCELLED, ctx.user, reason or _("Cancelled by {0}").format(party))
	return booking_payload(doc, party)


def my_bookings(ctx, scope="upcoming"):
	patients = _patients_of(ctx)
	or_filters = [["booked_by", "=", ctx.user]]
	if patients:
		or_filters.append(["patient", "in", patients])
	filters = {"profile_type": D2C}
	if scope == "upcoming":
		filters["status"] = ("in", OPEN_STATUSES)
	elif scope == "past":
		filters["status"] = ("in", (ST_COMPLETED, ST_CANCELLED, ST_NO_SHOW))
	rows = frappe.get_all(BOOKING_DT, filters=filters, or_filters=or_filters, fields=BOOKING_LIST_FIELDS, order_by="slot_start desc, creation desc", limit=200)
	return {"rows": [booking_row(r) for r in rows]}


def booking_detail(ctx, name):
	doc, party = _booking(ctx, name)
	return booking_payload(doc, party)


def provider_dashboard(ctx, date=None, days=14):
	day = getdate(date) if date else getdate(today())
	start = datetime.combine(day, dtime.min)
	end = start + timedelta(days=min(max(cint(days) or 14, 1), 60))
	rows = frappe.get_all(
		BOOKING_DT,
		filters={"provider": ctx.provider, "status": ("not in", (ST_CANCELLED,)), "slot_start": ("between", [start, end])},
		fields=BOOKING_LIST_FIELDS,
		order_by="slot_start asc",
		limit=500,
	)
	requests = frappe.get_all(BOOKING_DT, filters={"provider": ctx.provider, "profile_type": B2B, "status": ST_REQUESTED}, fields=BOOKING_LIST_FIELDS, order_by="slot_start asc", limit=100)
	programs = frappe.get_all(BOOKING_DT, filters={"provider": ctx.provider, "mode": TUTORIAL_PROGRAM, "status": ("in", LIVE_STATUSES)}, fields=BOOKING_LIST_FIELDS, order_by="creation desc", limit=100)
	pending_rx = frappe.get_all(
		BOOKING_DT,
		filters={"provider": ctx.provider, "status": ST_COMPLETED, "prescription": ("is", "not set"), "mode": ("!=", TUTORIAL_PROGRAM), "completed_at": (">=", add_days(now_datetime(), -7))},
		fields=BOOKING_LIST_FIELDS,
		order_by="completed_at desc",
		limit=50,
	)
	today_end = start + timedelta(days=1)
	listed = [booking_row(r) for r in rows]
	todays = [b for b in listed if b["slot_start"] and b["slot_start"] < _iso(today_end)]
	by_mode = {m: [b for b in todays if b["mode"] == m] for m in SLOT_MODES}
	return {
		"date": cstr(day),
		"today": todays,
		"today_by_mode": by_mode,
		"upcoming": [b for b in listed if b["slot_start"] and b["slot_start"] >= _iso(today_end)],
		"clinic_requests": [booking_row(r) for r in requests],
		"program_enrollments": [booking_row(r) for r in programs],
		"awaiting_rx": [booking_row(r) for r in pending_rx],
		"counts": {m: len(by_mode[m]) for m in SLOT_MODES},
		"provider": provider_payload(ctx.provider),
	}


def provider_calendar(ctx, date_from=None, days=7):
	slots = provider_slots(ctx.provider, date_from, days)
	start = datetime.combine(getdate(slots["days"][0]["date"]), dtime.min)
	end = start + timedelta(days=len(slots["days"]))
	rows = frappe.get_all(
		BOOKING_DT,
		filters={"provider": ctx.provider, "slot_start": ("between", [start, end]), "status": ("not in", (ST_CANCELLED,))},
		fields=BOOKING_LIST_FIELDS,
		order_by="slot_start asc",
		limit=500,
	)
	return {**slots, "bookings": [booking_row(r) for r in rows], **list_availability(ctx.provider)}


# --- B2B clinic shifts -------------------------------------------------------


def _clinic_for(ctx, clinic=None):
	clinics = clinics_for_user(ctx.user, active_only=True) if not ctx.is_manager else None
	if clinic:
		if clinics is not None and clinic not in clinics:
			_deny(_("Not your clinic"))
		if frappe.db.get_value(CUSTOMER_DT, clinic, "status") != "Active":
			_fail(_("The clinic is not active"))
		return clinic
	if not clinics:
		_deny(_("No active clinic is linked to this account"))
	return clinics[0]


def request_shift(ctx, payload):
	p = payload or {}
	clinic = _clinic_for(ctx, cstr(p.get("clinic")).strip() or None)
	cdoc = frappe.get_doc(CUSTOMER_DT, clinic)
	chamber = cstr(p.get("chamber_name")).strip()
	crow = next((c for c in cdoc.get("chambers") or [] if cint(c.active) and c.chamber_name == chamber), None)
	if not crow:
		_fail(_("Pick one of your active chambers"))
	start = _dt_in(p.get("slot_start"), _("Shift start"))
	end = _dt_in(p.get("slot_end"), _("Shift end"))
	if end <= start or (end - start) > timedelta(hours=12):
		_fail(_("A shift must end after it starts and last at most 12 hours"))
	if start < now_datetime() + timedelta(minutes=SLOT_LEAD_MINUTES):
		_fail(_("Shifts must start at least {0} minutes from now").format(SLOT_LEAD_MINUTES))
	sessions = cint(p.get("session_count")) or 1
	if not 1 <= sessions <= 100:
		_fail(_("Sessions must be between 1 and 100"))
	provider = cstr(p.get("provider")).strip()
	_lock(PROVIDER_DT, provider)
	prov = _provider_live(provider)
	rates = [
		r
		for r in frappe.get_all(RATE_DT, filters={"parent": provider, "parenttype": PROVIDER_DT, "active": 1, "mode": PHYSICAL}, fields=["*"], order_by="idx asc", limit=0)
		if flt(r.price_b2b) > 0
	]
	if not rates:
		_fail(_("This provider does not take clinic shifts"))
	if _overlaps(busy_intervals(provider, start, end), start, end):
		_fail(_("The provider is already booked in that window"))
	rate = rates[0]
	doc = _new_booking(
		{
			"customer_profile": clinic,
			"profile_type": B2B,
			"customer_name": cdoc.clinic_name,
			"booked_by": ctx.user,
			"provider": provider,
			"provider_name": prov.full_name,
			"provider_category": prov.provider_category,
			"mode": PHYSICAL,
			"status": ST_REQUESTED,
			"booking_date": getdate(start),
			"slot_start": start,
			"slot_end": end,
			"session_count": sessions,
			"chamber_name": crow.chamber_name,
			"chamber_address": crow.address,
			"chamber_lat": flt(crow.lat),
			"chamber_lng": flt(crow.lng),
			"reason": _text(p.get("notes"), 1000),
			"price": flt(rate.price_b2b) * sessions,
			"payment_mode": "B2B Settlement",
			"payment_status": "Unpaid",
			"provider_response": "Pending",
		}
	)
	_notify(prov.mobile, _("Uber Doc: {0} requests you at {1} on {2} ({3} sessions). Open the app to accept.").format(cdoc.clinic_name, crow.chamber_name, start.strftime("%d %b %H:%M"), sessions))
	return booking_payload(frappe.get_doc(BOOKING_DT, doc.name), "clinic")


def provider_respond(ctx, name, accept, reason=None):
	doc, party = _booking(ctx, name, ("provider", "ops"), lock=True)
	if doc.profile_type != B2B or doc.status != ST_REQUESTED:
		_fail(_("Only a pending clinic request can be answered"))
	now = now_datetime()
	if cint(accept):
		_lock(PROVIDER_DT, doc.provider)
		start, end = get_datetime(doc.slot_start), get_datetime(doc.slot_end)
		if _overlaps(busy_intervals(doc.provider, start, end, exclude=doc.name), start, end):
			_fail(_("You are already booked in that window"))
		frappe.db.set_value(BOOKING_DT, doc.name, {"status": ST_CONFIRMED, "provider_response": "Accepted", "responded_on": now})
		_on_confirmed(doc)
	else:
		reason = cstr(reason).strip()[:500]
		if not reason:
			_fail(_("Give the reason for declining"))
		frappe.db.set_value(BOOKING_DT, doc.name, {"status": ST_CANCELLED, "provider_response": "Declined", "responded_on": now, "decline_reason": reason, "cancel_reason": reason, "cancelled_by": ctx.user})
		cmobile = frappe.db.get_value(CUSTOMER_DT, doc.customer_profile, "mobile")
		_notify(cmobile, _("Uber Doc: {0} declined the {1} shift on {2}: {3}").format(doc.provider_name, doc.chamber_name, get_datetime(doc.slot_start).strftime("%d %b %H:%M"), reason))
	return booking_payload(frappe.get_doc(BOOKING_DT, doc.name), party)


def clinic_bookings(ctx, clinic=None, scope="upcoming"):
	clinics = [_clinic_for(ctx, clinic)] if clinic or not ctx.is_manager else None
	filters = {"profile_type": B2B}
	if clinics:
		filters["customer_profile"] = ("in", clinics)
	if scope == "upcoming":
		filters["status"] = ("in", OPEN_STATUSES)
	elif scope == "past":
		filters["status"] = ("in", (ST_COMPLETED, ST_CANCELLED, ST_NO_SHOW))
	rows = frappe.get_all(BOOKING_DT, filters=filters, fields=BOOKING_LIST_FIELDS, order_by="slot_start desc", limit=300)
	return {"rows": [booking_row(r) for r in rows]}


def _accrue_settlement(doc):
	period = get_datetime(doc.slot_start or now_datetime()).strftime("%Y-%m")
	key = f"{doc.customer_profile}::{doc.provider}::{period}"
	name = frappe.db.get_value(SETTLEMENT_DT, {"open_key": key}, "name")
	if name:
		_lock(SETTLEMENT_DT, name)
		sdoc = frappe.get_doc(SETTLEMENT_DT, name)
	else:
		sdoc = frappe.get_doc(
			{
				"doctype": SETTLEMENT_DT,
				"customer_profile": doc.customer_profile,
				"clinic_name": doc.customer_name,
				"provider": doc.provider,
				"provider_name": doc.provider_name,
				"period": period,
				"status": "Draft",
				"payment_status": "Unpaid",
				"open_key": key,
			}
		)
	if any(line.booking == doc.name for line in sdoc.get("lines") or []):
		return sdoc.name
	sdoc.append("lines", {"booking": doc.name, "slot_start": doc.slot_start, "chamber_name": doc.chamber_name, "session_count": cint(doc.session_count) or 1, "amount": flt(doc.price)})
	sdoc.total_amount = sum(flt(line.amount) for line in sdoc.lines)
	sdoc.session_count = sum(cint(line.session_count) for line in sdoc.lines)
	if sdoc.is_new():
		sdoc.insert(ignore_permissions=True)
	else:
		sdoc.save(ignore_permissions=True)
	frappe.db.set_value(BOOKING_DT, doc.name, "settlement", sdoc.name, update_modified=False)
	return sdoc.name


def settlement_payload(name):
	doc = frappe.get_doc(SETTLEMENT_DT, name)
	return {
		"name": doc.name,
		"customer_profile": doc.customer_profile,
		"clinic_name": doc.clinic_name,
		"provider": doc.provider,
		"provider_name": doc.provider_name,
		"period": doc.period,
		"status": doc.status,
		"session_count": cint(doc.session_count),
		"total_amount": flt(doc.total_amount),
		"invoice_no": doc.invoice_no,
		"invoiced_on": _str(doc.invoiced_on),
		"payment_mode": doc.payment_mode,
		"payment_status": doc.payment_status,
		"offline_payment_ref": doc.offline_payment_ref,
		"paid_on": _iso(doc.paid_on),
		"lines": [{"booking": line.booking, "slot_start": _iso(line.slot_start), "chamber_name": line.chamber_name, "session_count": cint(line.session_count), "amount": flt(line.amount)} for line in doc.lines],
		"notes": doc.notes,
	}


def list_settlements(ctx, clinic=None, provider=None, status=None):
	filters = {}
	if not ctx.is_manager:
		if provider:
			if provider != ctx.provider:
				_deny(_("Not permitted"))
			filters["provider"] = provider
		else:
			filters["customer_profile"] = ("in", [_clinic_for(ctx, clinic)] if clinic else (clinics_for_user(ctx.user) or [""]))
	else:
		if clinic:
			filters["customer_profile"] = clinic
		if provider:
			filters["provider"] = provider
	if status in SETTLEMENT_STATUSES:
		filters["status"] = status
	names = frappe.get_all(SETTLEMENT_DT, filters=filters, pluck="name", order_by="period desc, modified desc", limit=300)
	return {"rows": [settlement_payload(n) for n in names]}


def settlement_action(name, action, invoice_no=None, payment_mode=None, payment_ref=None, notes=None):
	_lock(SETTLEMENT_DT, name)
	doc = frappe.get_doc(SETTLEMENT_DT, name)
	if action == "invoice":
		if doc.status != "Draft":
			_fail(_("Only a draft settlement can be invoiced"))
		invoice_no = cstr(invoice_no).strip()[:60]
		if not invoice_no:
			_fail(_("Enter the invoice number"))
		doc.update({"status": "Invoiced", "invoice_no": invoice_no, "invoiced_on": getdate(today()), "open_key": None})
	elif action == "mark_paid":
		if doc.status != "Invoiced":
			_fail(_("Invoice the settlement first"))
		if payment_mode not in OFFLINE_MODES:
			_fail(_("Choose how it was paid"))
		doc.update({"status": "Paid", "payment_status": "Paid", "payment_mode": "Offline", "offline_payment_ref": f"{payment_mode}: {cstr(payment_ref).strip()[:100]}", "paid_on": now_datetime()})
	elif action == "cancel":
		if doc.status == "Paid":
			_fail(_("A paid settlement cannot be cancelled"))
		doc.update({"status": "Cancelled", "open_key": None})
		for line in doc.lines:
			if line.booking:
				frappe.db.set_value(BOOKING_DT, line.booking, "settlement", None, update_modified=False)
	else:
		_fail(_("Unknown action"))
	if notes:
		doc.notes = cstr(notes).strip()[:2000]
	doc.save(ignore_permissions=True)
	return settlement_payload(doc.name)


# ---------------------------------------------------------------------------
# Telemedicine thread
# ---------------------------------------------------------------------------


def post_message(ctx, name, body):
	doc, party = _booking(ctx, name, ("patient", "provider", "clinic"), lock=True)
	if doc.mode not in VIDEO_MODES:
		_fail(_("Messages are available for video and audio / chat consultations"))
	if doc.status not in OPEN_STATUSES and not (doc.status == ST_COMPLETED and doc.completed_at and get_datetime(doc.completed_at) > now_datetime() - timedelta(days=3)):
		_fail(_("This consultation is closed for messages"))
	body = cstr(body).strip()
	if not body:
		_fail(_("Type a message"))
	if len(doc.get("messages") or []) >= MAX_MESSAGES:
		_fail(_("This thread is full"))
	doc.append("messages", {"sender": ctx.user, "sender_name": frappe.db.get_value("User", ctx.user, "full_name") or ctx.user, "sender_role": party.title(), "body": body[:2000], "sent_at": now_datetime()})
	doc.save(ignore_permissions=True)
	return booking_payload(doc, party)


# ---------------------------------------------------------------------------
# Video rooms (Jitsi with per-booking expiring tokens)
# ---------------------------------------------------------------------------


def jitsi_config():
	conf = frappe.conf
	domain = cstr(conf.get("uberdoc_jitsi_domain")).strip().rstrip("/").replace("https://", "")
	app_id = cstr(conf.get("uberdoc_jitsi_app_id")).strip()
	if conf.get("uberdoc_jaas_kid") and conf.get("uberdoc_jaas_private_key") and app_id:
		return {"kind": "jaas", "domain": domain or "8x8.vc", "app_id": app_id}
	if domain and app_id and conf.get("uberdoc_jitsi_app_secret"):
		return {"kind": "jwt", "domain": domain, "app_id": app_id}
	return {"kind": "public", "domain": "meet.jit.si", "app_id": None}


def _b64url(data):
	return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def hs256_jwt(claims, secret):
	header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
	payload = _b64url(json.dumps(claims, separators=(",", ":")).encode())
	signing = f"{header}.{payload}".encode()
	return f"{header}.{payload}.{_b64url(hmac.new(cstr(secret).encode(), signing, hashlib.sha256).digest())}"


def decode_hs256(token, secret):
	"""Verify signature and nbf/exp; returns the claims or None."""
	try:
		header, payload, sig = cstr(token).split(".")
		expected = _b64url(hmac.new(cstr(secret).encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
		if not hmac.compare_digest(expected, sig):
			return None
		claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
	except Exception:
		return None
	now = int(time.time())
	if cint(claims.get("nbf")) > now or cint(claims.get("exp")) < now:
		return None
	return claims


def _epoch(value):
	# Site datetimes are naive in the Frappe system timezone; offsetting from "now" avoids OS-timezone drift.
	return int(time.time() + (get_datetime(value) - now_datetime()).total_seconds())


def room_token(doc, user, display_name, moderator, cfg=None):
	"""JWT for this booking's room only, valid for the join window; None on the public fallback."""
	cfg = cfg or jitsi_config()
	opens, closes = room_window(doc)
	base = {"room": doc.room_name, "nbf": _epoch(opens), "exp": _epoch(closes)}
	user_ctx = {"id": hashlib.sha256(cstr(user).encode()).hexdigest()[:16], "name": cstr(display_name)[:80], "moderator": "true" if moderator else "false"}
	if cfg["kind"] == "jwt":
		claims = {
			**base,
			"aud": cstr(frappe.conf.get("uberdoc_jitsi_audience") or "jitsi"),
			"iss": cfg["app_id"],
			"sub": cstr(frappe.conf.get("uberdoc_jitsi_sub") or cfg["domain"]),
			"moderator": bool(moderator),
			"context": {"user": {**user_ctx, "moderator": bool(moderator)}},
		}
		return hs256_jwt(claims, frappe.conf.get("uberdoc_jitsi_app_secret"))
	if cfg["kind"] == "jaas":
		try:
			import jwt as pyjwt
		except ImportError:
			_fail(_("8x8 JaaS tokens need PyJWT (bundled with Frappe); it is not importable on this server"))

		claims = {
			**base,
			"aud": "jitsi",
			"iss": "chat",
			"sub": cfg["app_id"],
			"context": {"user": user_ctx, "features": {"livestreaming": "false", "recording": "false", "transcription": "false", "outbound-call": "false"}},
		}
		key = cstr(frappe.conf.get("uberdoc_jaas_private_key")).replace("\\n", "\n")
		return pyjwt.encode(claims, key, algorithm="RS256", headers={"kid": cstr(frappe.conf.get("uberdoc_jaas_kid")), "typ": "JWT"})
	return None


def join_room(ctx, name):
	doc, party = _booking(ctx, name, ("patient", "provider", "clinic"), lock=True)
	if doc.mode not in VIDEO_MODES:
		_fail(_("This booking has no video / audio room"))
	if doc.status not in LIVE_STATUSES:
		_fail(_("The room opens only for confirmed consultations"))
	opens, closes = room_window(doc)
	now = now_datetime()
	if now < opens:
		_fail(_("The room opens at {0}").format(opens.strftime("%d %b %H:%M")))
	if now > closes:
		_fail(_("The room closed at {0}").format(closes.strftime("%d %b %H:%M")))
	if not doc.room_name:
		_assign_room(doc)
		doc.reload()
	if party == "provider" and doc.status in (ST_CONFIRMED, ST_CHECKED_IN):
		frappe.db.set_value(BOOKING_DT, doc.name, {"status": ST_IN_CONSULT, "started_at": doc.started_at or now})
		doc.reload()
	cfg = jitsi_config()
	display = frappe.db.get_value("User", ctx.user, "full_name") or ("Provider" if party == "provider" else "Patient")
	token = room_token(doc, ctx.user, display, party == "provider", cfg)
	path = f"{cfg['app_id']}/{doc.room_name}" if cfg["kind"] == "jaas" else doc.room_name
	url = f"https://{cfg['domain']}/{path}" + (f"?jwt={token}" if token else "")
	audio_only = doc.mode == TELEMEDICINE
	if audio_only:
		url += "#config.startAudioOnly=true&config.startWithVideoMuted=true"
	return {
		"booking": doc.name,
		"mode": doc.mode,
		"party": party,
		"provider_kind": cfg["kind"],
		"domain": cfg["domain"],
		"room": path,
		"jwt": token,
		"url": url,
		"audio_only": audio_only,
		"moderator": party == "provider",
		"opens_at": _iso(opens),
		"expires_at": _iso(closes),
		"display_name": display,
		"warning": None
		if cfg["kind"] != "public"
		else _("Public meet.jit.si fallback: the room name is random and the join link is only handed out inside the booking window, but meet.jit.si itself does not enforce expiry. Configure Uber Doc Jitsi credentials."),
		"booking_detail": booking_payload(doc, party),
	}


# ---------------------------------------------------------------------------
# Tutorial programmes
# ---------------------------------------------------------------------------

PROGRAM_CARD_FIELDS = ["name", "provider", "provider_name", "title", "category", "level", "format", "summary", "duration_weeks", "price", "status", "published_on"]


def program_card(row):
	modules = frappe.get_all(MODULE_DT, filters={"parent": row.name, "parenttype": PROGRAM_DT}, fields=["duration_min", "is_preview"], limit=0)
	return {
		"name": row.name,
		"provider": row.provider,
		"provider_name": row.provider_name,
		"title": row.title,
		"category": row.category,
		"level": row.level,
		"format": row.format,
		"summary": row.summary,
		"duration_weeks": cint(row.duration_weeks) or None,
		"price": flt(row.price),
		"status": row.status,
		"module_count": len(modules),
		"preview_count": sum(1 for m in modules if cint(m.is_preview)),
		"total_minutes": sum(cint(m.duration_min) for m in modules),
	}


def _video_link(m):
	if m.wellness_video and frappe.db.exists(VIDEO_DT, m.wellness_video):
		return frappe.db.get_value(VIDEO_DT, m.wellness_video, "youtube_url") or m.video_url
	return m.video_url


def program_payload(name, unlocked=False, private=False):
	doc = frappe.get_doc(PROGRAM_DT, name)
	out = program_card(doc)
	out.update(
		{
			"description": doc.description,
			"review_notes": doc.review_notes if private else None,
			"modules": [
				{
					"name": m.name,
					"title": m.title,
					"module_order": cint(m.module_order) or m.idx,
					"duration_min": cint(m.duration_min) or None,
					"instructions": m.instructions if (unlocked or cint(m.is_preview) or private) else None,
					"is_preview": cint(m.is_preview),
					"wellness_video": m.wellness_video if private else None,
					"video_url": _video_link(m) if (unlocked or cint(m.is_preview) or private) else None,
					"locked": not (unlocked or cint(m.is_preview) or private),
				}
				for m in sorted(doc.get("modules") or [], key=lambda x: (cint(x.module_order) or x.idx, x.idx))
			],
		}
	)
	return out


def list_programs(filters=None):
	f = filters or {}
	where = {"status": "Published"}
	if f.get("category") in PROGRAM_CATEGORIES:
		where["category"] = f["category"]
	if f.get("format") in PROGRAM_FORMATS:
		where["format"] = f["format"]
	if f.get("provider"):
		where["provider"] = f["provider"]
	or_filters = None
	q = cstr(f.get("q")).strip()
	if q:
		or_filters = [["title", "like", f"%{q}%"], ["summary", "like", f"%{q}%"], ["provider_name", "like", f"%{q}%"]]
	rows = frappe.get_all(PROGRAM_DT, filters=where, or_filters=or_filters, fields=PROGRAM_CARD_FIELDS, order_by="published_on desc", limit=200)
	return {"rows": [program_card(r) for r in rows]}


def public_program(ctx, name):
	status = frappe.db.get_value(PROGRAM_DT, name, "status")
	if not status:
		_missing(_("Programme not found"))
	own = ctx and (ctx.is_manager or frappe.db.get_value(PROGRAM_DT, name, "provider") == ctx.provider)
	if status != "Published" and not own:
		_missing(_("Programme not found"))
	enrollment = None
	if ctx and ctx.user != "Guest":
		enrollment = frappe.db.get_value(ENROLL_DT, {"program": name, "user": ctx.user, "status": ("in", ("Active", "Completed", "Pending Payment"))}, "name")
	unlocked = bool(enrollment and frappe.db.get_value(ENROLL_DT, enrollment, "status") in ("Active", "Completed"))
	out = program_payload(name, unlocked=unlocked, private=bool(own))
	out["enrollment"] = enrollment_payload(enrollment) if enrollment else None
	return out


def save_program(ctx, payload):
	p = payload or {}
	name = cstr(p.get("name")).strip()
	if name:
		if frappe.db.get_value(PROGRAM_DT, name, "provider") != ctx.provider and not ctx.is_manager:
			_missing(_("Programme not found"))
		_lock(PROGRAM_DT, name)
		doc = frappe.get_doc(PROGRAM_DT, name)
	else:
		doc = frappe.new_doc(PROGRAM_DT)
		doc.provider = ctx.provider
		doc.provider_name = frappe.db.get_value(PROVIDER_DT, ctx.provider, "full_name")
		doc.status = "Draft"
	title = cstr(p.get("title", doc.title)).strip()
	if len(title) < 3:
		_fail(_("Give the programme a title"))
	doc.title = title[:140]
	category = cstr(p.get("category", doc.category)).strip()
	if category not in PROGRAM_CATEGORIES:
		_fail(_("Choose a category"))
	doc.category = category
	for key, options in (("level", PROGRAM_LEVELS), ("format", PROGRAM_FORMATS)):
		if key in p:
			value = cstr(p.get(key)).strip()
			if value not in options:
				_fail(_("Invalid {0}").format(key))
			doc.set(key, value)
	for key, limit in (("summary", 500), ("description", 10000)):
		if key in p:
			doc.set(key, _text(p.get(key), limit))
	if "duration_weeks" in p:
		doc.duration_weeks = min(max(cint(p.get("duration_weeks")), 0), 104) or None
	if "price" in p:
		price = flt(p.get("price"), 2)
		if price < 0:
			_fail(_("Price cannot be negative"))
		doc.price = price
	if "modules" in p:
		rows = []
		for idx, m in enumerate(_parse(p.get("modules"), []) or [], start=1):
			mtitle = cstr((m or {}).get("title")).strip()
			if not mtitle:
				continue
			video = cstr(m.get("wellness_video")).strip() or None
			if video and not frappe.db.exists(VIDEO_DT, video):
				_fail(_("Wellness video {0} not found").format(video))
			url = cstr(m.get("video_url")).strip() or None
			if url and not re.match(r"^https://", url):
				_fail(_("Video links must start with https://"))
			rows.append({"title": mtitle[:140], "module_order": cint(m.get("module_order")) or idx, "wellness_video": video, "video_url": url, "duration_min": max(cint(m.get("duration_min")), 0) or None, "instructions": _text(m.get("instructions"), 4000), "is_preview": 1 if cint(m.get("is_preview")) else 0})
		doc.set("modules", rows[:100])
	if doc.status == "Published" and not ctx.is_manager:
		doc.status = "Pending Review"
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return program_payload(doc.name, private=True)


def submit_program(ctx, name):
	if frappe.db.get_value(PROGRAM_DT, name, "provider") != ctx.provider:
		_missing(_("Programme not found"))
	if frappe.db.get_value(PROVIDER_DT, ctx.provider, "verification_status") != "Verified":
		_fail(_("Programmes can be submitted once your profile is verified"))
	doc = frappe.get_doc(PROGRAM_DT, name)
	if not doc.get("modules"):
		_fail(_("Add at least one module"))
	if doc.status not in ("Draft", "Rejected"):
		_fail(_("This programme is {0}").format(doc.status))
	frappe.db.set_value(PROGRAM_DT, name, "status", "Pending Review")
	return program_payload(name, private=True)


def my_programs(ctx):
	rows = frappe.get_all(PROGRAM_DT, filters={"provider": ctx.provider}, fields=PROGRAM_CARD_FIELDS, order_by="modified desc", limit=200)
	return {"rows": [program_card(r) for r in rows]}


def moderate_program(name, action, notes=None, user=None):
	if not frappe.db.exists(PROGRAM_DT, name):
		_missing(_("Programme not found"))
	doc = frappe.get_doc(PROGRAM_DT, name)
	notes = cstr(notes).strip()[:2000] or None
	if action == "publish":
		if frappe.db.get_value(PROVIDER_DT, doc.provider, "verification_status") != "Verified":
			_fail(_("The provider is not verified"))
		if not doc.get("modules"):
			_fail(_("The programme has no modules"))
		doc.update({"status": "Published", "published_on": doc.published_on or now_datetime(), "reviewed_by": user, "review_notes": notes})
	elif action == "reject":
		if not notes:
			_fail(_("Give the reason"))
		doc.update({"status": "Rejected", "reviewed_by": user, "review_notes": notes})
	elif action == "archive":
		doc.update({"status": "Archived", "reviewed_by": user, "review_notes": notes or doc.review_notes})
	else:
		_fail(_("Unknown action"))
	doc.save(ignore_permissions=True)
	return program_payload(name, private=True)


def list_programs_ops(status=None):
	filters = {"status": status} if status in PROGRAM_STATUSES else {}
	rows = frappe.get_all(PROGRAM_DT, filters=filters, fields=PROGRAM_CARD_FIELDS, order_by="modified desc", limit=300)
	return {"rows": [program_card(r) for r in rows], "counts": {s: frappe.db.count(PROGRAM_DT, {"status": s}) for s in PROGRAM_STATUSES}}


def enrollment_payload(name):
	doc = frappe.get_doc(ENROLL_DT, name)
	return {
		"name": doc.name,
		"program": doc.program,
		"program_title": doc.program_title,
		"provider": doc.provider,
		"patient": doc.patient,
		"patient_name": doc.patient_name,
		"booking": doc.booking,
		"status": doc.status,
		"price": flt(doc.price),
		"payment_status": doc.payment_status,
		"payment_mode": doc.payment_mode,
		"enrolled_on": _iso(doc.enrolled_on),
		"completed_on": _iso(doc.completed_on),
		"progress_pct": flt(doc.progress_pct, 1),
		"progress": [{"module_row": r.module_row, "module_title": r.module_title, "completed": cint(r.completed), "completed_on": _iso(r.completed_on)} for r in doc.progress],
	}


def enroll(ctx, program, patient=None, payload=None):
	row = frappe.db.get_value(PROGRAM_DT, program, ["name", "title", "status", "price", "provider", "provider_name"], as_dict=True)
	if not row or row.status != "Published":
		_missing(_("Programme not found"))
	patient = _patient_for(ctx, patient, payload)
	key = f"{program}::{patient}"
	existing = frappe.db.get_value(ENROLL_DT, {"enroll_key": key}, ["name", "status"], as_dict=True)
	if existing and existing.status != "Cancelled":
		return enrollment_payload(existing.name)
	profile = ensure_d2c_profile(patient, ctx.user)
	prow = frappe.db.get_value(PATIENT_DT, patient, ["patient_name", UPI_FIELD], as_dict=True)
	price = flt(row.price)
	free = price <= 0
	now = now_datetime()
	modules = frappe.get_all(MODULE_DT, filters={"parent": program, "parenttype": PROGRAM_DT}, fields=["name", "title"], order_by="module_order asc, idx asc", limit=0)
	booking = _new_booking(
		{
			"customer_profile": profile,
			"profile_type": D2C,
			"customer_name": prow.patient_name,
			"patient": patient,
			"patient_name": prow.patient_name,
			UPI_FIELD: prow.get(UPI_FIELD),
			"booked_by": ctx.user,
			"provider": row.provider,
			"provider_name": row.provider_name,
			"provider_category": frappe.db.get_value(PROVIDER_DT, row.provider, "provider_category"),
			"mode": TUTORIAL_PROGRAM,
			"status": ST_CONFIRMED if free else ST_REQUESTED,
			"booking_date": getdate(now),
			"tutorial_program": program,
			"price": price,
			"payment_mode": "Free" if free else "Online",
			"payment_status": "Not Required" if free else "Pending",
		}
	)
	values = {
		"program": program,
		"program_title": row.title,
		"provider": row.provider,
		"customer_profile": profile,
		"patient": patient,
		"patient_name": prow.patient_name,
		UPI_FIELD: prow.get(UPI_FIELD),
		"user": ctx.user,
		"booking": booking.name,
		"status": "Active" if free else "Pending Payment",
		"price": price,
		"payment_mode": "Free" if free else "Online",
		"payment_status": "Not Required" if free else "Pending",
		"enrolled_on": now if free else None,
		"progress_pct": 0,
		"enroll_key": key,
		"progress": [{"module_row": m.name, "module_title": m.title, "completed": 0} for m in modules],
	}
	if existing:
		doc = frappe.get_doc(ENROLL_DT, existing.name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": ENROLL_DT, **values})
		doc.insert(ignore_permissions=True)
	frappe.db.set_value(BOOKING_DT, booking.name, "tutorial_enrollment", doc.name, update_modified=False)
	return enrollment_payload(doc.name)


def _enrollment(ctx, name, lock=False):
	if not name or not frappe.db.exists(ENROLL_DT, name):
		_missing(_("Enrollment not found"))
	if lock:
		_lock(ENROLL_DT, name)
	doc = frappe.get_doc(ENROLL_DT, name)
	if doc.user != ctx.user and doc.patient not in _patients_of(ctx) and not ctx.is_manager:
		_deny(_("Not your enrollment"))
	return doc


def set_progress(ctx, name, module_row, done=1):
	doc = _enrollment(ctx, name, lock=True)
	if doc.status != "Active":
		_fail(_("The enrollment is {0}").format(doc.status))
	row = next((r for r in doc.progress if r.module_row == module_row), None)
	if not row:
		title = frappe.db.get_value(MODULE_DT, {"name": module_row, "parent": doc.program}, "title")
		if not title:
			_missing(_("Module not found"))
		row = doc.append("progress", {"module_row": module_row, "module_title": title})
	row.completed = 1 if cint(done) else 0
	row.completed_on = now_datetime() if row.completed else None
	total = frappe.db.count(MODULE_DT, {"parent": doc.program, "parenttype": PROGRAM_DT}) or len(doc.progress)
	finished = sum(1 for r in doc.progress if cint(r.completed))
	doc.progress_pct = round(100.0 * finished / total, 1) if total else 0
	if total and finished >= total:
		doc.status = "Completed"
		doc.completed_on = now_datetime()
	doc.save(ignore_permissions=True)
	if doc.status == "Completed" and doc.booking and frappe.db.get_value(BOOKING_DT, doc.booking, "status") in LIVE_STATUSES:
		frappe.db.set_value(BOOKING_DT, doc.booking, {"status": ST_COMPLETED, "completed_at": now_datetime()})
	return enrollment_payload(doc.name)


def my_enrollments(ctx):
	patients = _patients_of(ctx)
	or_filters = [["user", "=", ctx.user]]
	if patients:
		or_filters.append(["patient", "in", patients])
	names = frappe.get_all(ENROLL_DT, filters={"status": ("!=", "Cancelled")}, or_filters=or_filters, pluck="name", order_by="modified desc", limit=200)
	return {"rows": [enrollment_payload(n) for n in names]}


# ---------------------------------------------------------------------------
# Payments (HEC Payment Intent scopes uberdoc_consult / program_enrollment / uberdoc_clinic_session)
# ---------------------------------------------------------------------------

PAY_KINDS = {"booking": (BOOKING_DT, SCOPE_CONSULT), "enrollment": (ENROLL_DT, SCOPE_PROGRAM), "settlement": (SETTLEMENT_DT, SCOPE_CLINIC)}


def _pay_target(ctx, kind, name):
	if kind not in PAY_KINDS:
		_fail(_("Unknown payment target"))
	dt, scope = PAY_KINDS[kind]
	if not name or not frappe.db.exists(dt, name):
		_missing(_("Not found"))
	doc = frappe.get_doc(dt, name)
	if kind == "booking":
		if booking_party(ctx, doc) not in ("patient", "ops"):
			_deny(_("Not your booking"))
		if doc.mode == TUTORIAL_PROGRAM:
			_fail(_("Pay for the programme enrollment instead"))
		if doc.status != ST_REQUESTED or doc.payment_status != "Pending":
			_fail(_("This booking is not awaiting payment"))
		if doc.hold_expires_at and get_datetime(doc.hold_expires_at) < now_datetime():
			_fail(_("The slot hold expired; book again"))
		amount, profile = flt(doc.price), doc.customer_profile
	elif kind == "enrollment":
		doc = _enrollment(ctx, name)
		if doc.status != "Pending Payment":
			_fail(_("This enrollment is not awaiting payment"))
		amount, profile = flt(doc.price), doc.customer_profile
	else:
		if not ctx.is_manager and doc.customer_profile not in clinics_for_user(ctx.user):
			_deny(_("Not your clinic"))
		if doc.status != "Invoiced" or doc.payment_status == "Paid":
			_fail(_("This settlement is not awaiting payment"))
		amount, profile = flt(doc.total_amount), doc.customer_profile
	if amount <= 0:
		_fail(_("Nothing to pay"))
	return frappe._dict(doctype=dt, name=name, scope=scope, amount=amount, profile=profile, doc=doc)


def payments_configured():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_razorpay_key_id, get_razorpay_key_secret, razorpay_sandbox_active

		return {"online": bool(get_razorpay_key_id() and get_razorpay_key_secret()) or bool(razorpay_sandbox_active()), "test_mode": bool(razorpay_sandbox_active())}
	except Exception:
		return {"online": False, "test_mode": False}


def pay_create(ctx, kind, name):
	from urllib.error import HTTPError
	from urllib.request import Request, urlopen

	from health_ecosystem_core.health_ecosystem_core.api import _get_site_api_credentials, _razorpay_receipt, _razorpay_test_mode
	from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import record_intent

	t = _pay_target(ctx, kind, name)
	amount_paise = int(round(t.amount * 100))
	creds = _get_site_api_credentials() or {}
	if _razorpay_test_mode():
		order_id, test = f"order_test_{t.name}_{secrets.token_hex(3)}", True
	else:
		key_id, key_secret = creds.get("razorpay_key_id"), creds.get("razorpay_key_secret")
		if not (key_id and key_secret):
			_fail(_("Online payment is not configured on the server"))
		auth = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
		body = json.dumps({"amount": amount_paise, "currency": "INR", "receipt": _razorpay_receipt(t.doctype, t.name), "payment_capture": 1, "notes": {"reference_doctype": t.doctype, "reference_name": t.name, "scope": t.scope}}).encode()
		req = Request("https://api.razorpay.com/v1/orders", data=body, headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"}, method="POST")
		try:
			with urlopen(req, timeout=20) as resp:
				order_id = json.loads(resp.read().decode()).get("id")
		except HTTPError as exc:
			frappe.log_error(title="phase135 razorpay order", message=exc.read().decode("utf-8", errors="replace"))
			_fail(_("Payment order could not be created; try again"))
		test = False
	intent = record_intent(t.scope, order_id, t.amount, reference_doctype=t.doctype, reference_name=t.name, party_type=CUSTOMER_DT, party=t.profile)
	frappe.db.set_value(t.doctype, t.name, {"razorpay_order_id": order_id, "payment_intent": intent}, update_modified=False)
	prefill = {}
	if kind != "settlement" and t.doc.get("patient"):
		prefill = {"name": t.doc.get("patient_name"), "contact": frappe.db.get_value(PATIENT_DT, t.doc.patient, "mobile")}
	return {"order_id": order_id, "amount": t.amount, "amount_paise": amount_paise, "currency": "INR", "razorpay_key_id": creds.get("razorpay_key_id"), "test_mode": test, "kind": kind, "name": t.name, "prefill": prefill}


def pay_verify(ctx, kind, name, order_id, payment_id, signature=None):
	from health_ecosystem_core.health_ecosystem_core.api import _razorpay_test_mode
	from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import confirm_payment, signature_valid

	if kind not in PAY_KINDS:
		_fail(_("Unknown payment target"))
	dt = PAY_KINDS[kind][0]
	if not name or not frappe.db.exists(dt, name):
		_missing(_("Not found"))
	if cstr(frappe.db.get_value(dt, name, "razorpay_order_id")) != cstr(order_id):
		_fail(_("Payment does not match this order"))
	if kind == "booking":
		_booking(ctx, name, ("patient", "ops"))
	elif kind == "enrollment":
		_enrollment(ctx, name)
	elif not ctx.is_manager and frappe.db.get_value(dt, name, "customer_profile") not in clinics_for_user(ctx.user):
		_deny(_("Not your clinic"))
	if not _razorpay_test_mode():
		if not signature_valid(order_id, payment_id, signature):
			_fail(_("Payment signature is invalid"))
		amount = flt(frappe.db.get_value(dt, name, "total_amount" if kind == "settlement" else "price"))
		check = confirm_payment(order_id, payment_id, expected_amount_paise=int(round(amount * 100)))
		if not check.get("ok"):
			_fail(_("Payment could not be confirmed ({0})").format(check.get("reason")))
	return complete_payment(dt, name, order_id, payment_id, "Checkout")


def complete_payment(dt, name, order_id, payment_id, via="Checkout"):
	"""Idempotent: mark the booking / enrollment / settlement paid and confirm it."""
	_lock(dt, name)
	doc = frappe.get_doc(dt, name)
	result = {"doctype": dt, "name": name, "already_paid": doc.payment_status == "Paid"}
	if doc.payment_status != "Paid":
		values = {"payment_status": "Paid", "paid_on": now_datetime()}
		if via != "Manual":
			values.update({"razorpay_payment_id": payment_id, "razorpay_order_id": order_id or doc.razorpay_order_id})
		if dt == BOOKING_DT:
			if doc.status == ST_REQUESTED:
				values["status"] = ST_CONFIRMED
			elif doc.status == ST_CANCELLED:
				start, end = get_datetime(doc.slot_start), get_datetime(doc.slot_end)
				_lock(PROVIDER_DT, doc.provider)
				if doc.cancelled_by is None and not _overlaps(busy_intervals(doc.provider, start, end, exclude=doc.name), start, end) and end > now_datetime():
					values.update({"status": ST_CONFIRMED, "cancel_reason": None})
				else:
					values["refund_due"] = 1
			frappe.db.set_value(BOOKING_DT, name, values)
			if values.get("status") == ST_CONFIRMED:
				_on_confirmed(doc)
			else:
				_sync_shadow(frappe.get_doc(BOOKING_DT, name), None)
		elif dt == ENROLL_DT:
			if doc.status == "Pending Payment":
				values.update({"status": "Active", "enrolled_on": now_datetime()})
			frappe.db.set_value(ENROLL_DT, name, values)
			if doc.booking:
				frappe.db.set_value(BOOKING_DT, doc.booking, {"status": ST_CONFIRMED, "payment_status": "Paid", "paid_on": now_datetime()})
		else:
			values["status"] = "Paid"
			if via != "Manual":
				values["payment_mode"] = "Online"
			frappe.db.set_value(SETTLEMENT_DT, name, values)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import mark_intent_paid

		if order_id:
			mark_intent_paid(order_id, payment_id, via)
	except Exception:
		frappe.log_error(title="phase135 mark intent", message=frappe.get_traceback())
	result["status"] = frappe.db.get_value(dt, name, "status")
	return result


def complete_uberdoc_intent(intent, order_id, payment_id, via):
	"""Called by phase 121 complete_intent (webhook / poller) for the Uber Doc scopes."""
	if intent.reference_doctype not in (BOOKING_DT, ENROLL_DT, SETTLEMENT_DT) or not intent.reference_name:
		return {"status": "unknown_reference"}
	return complete_payment(intent.reference_doctype, intent.reference_name, order_id, payment_id, via)


def mark_paid_offline(name, payment_mode, payment_ref=None, kind="booking"):
	if payment_mode not in OFFLINE_MODES:
		_fail(_("Choose how it was paid"))
	dt = PAY_KINDS.get(kind, (None,))[0]
	if not dt or not frappe.db.exists(dt, name):
		_missing(_("Not found"))
	ref = f"{payment_mode}: {cstr(payment_ref).strip()[:100]}"
	frappe.db.set_value(dt, name, {"offline_payment_ref": ref, "payment_mode": "Offline" if kind != "booking" or frappe.db.get_value(dt, name, "payment_mode") != "Pay at Clinic" else "Pay at Clinic"})
	return complete_payment(dt, name, None, ref, "Manual")


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def _notify(phone, message):
	if frappe.flags.ud_no_notify or not phone or not message:
		return
	try:
		frappe.enqueue(f"{MODULE_PATH}.ud_send_whatsapp_job", queue="short", enqueue_after_commit=True, phone=cstr(phone), text=cstr(message))
	except Exception:
		frappe.log_error(title="phase135 notify enqueue", message=frappe.get_traceback())


def ud_send_whatsapp_job(phone=None, text=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		send_whatsapp(phone, text, context={"source": "uberdoc"})
	except Exception:
		frappe.log_error(title="phase135 WhatsApp", message=frappe.get_traceback())


def _notify_ops(text):
	for mobile in cstr(frappe.conf.get("uberdoc_ops_mobiles")).split(","):
		_notify(_mobile(mobile, required=False), text)


def _email(address, subject, text):
	address = cstr(address).strip()
	if frappe.flags.ud_no_notify or not address or not EMAIL_RE.match(address) or address.endswith(f"@{USER_EMAIL_DOMAIN}"):
		return
	try:
		frappe.sendmail(recipients=[address], subject=subject, message=text, delayed=True)
	except Exception:
		frappe.log_error(title="phase135 email", message=frappe.get_traceback())


def _notify_booking(name, event):
	doc = frappe.get_doc(BOOKING_DT, name)
	when = get_datetime(doc.slot_start).strftime("%d %b %Y %H:%M") if doc.slot_start else ""
	where = {PHYSICAL: doc.chamber_name or "", ONLINE_VIDEO: _("video (join from the app 10 minutes before)"), TELEMEDICINE: _("audio call / chat in the app"), TUTORIAL_PROGRAM: _("tutorial programme")}.get(doc.mode, "")
	link = f"{app_url()}/app" if app_url() else ""
	prov = frappe.db.get_value(PROVIDER_DT, doc.provider, ["mobile", "email"], as_dict=True) or {}
	if doc.profile_type == D2C:
		patient = frappe.db.get_value(PATIENT_DT, doc.patient, ["mobile", "email"], as_dict=True) if doc.patient else None
		pmobile = (patient or {}).get("mobile") or frappe.db.get_value("User", doc.booked_by, "mobile_no")
		pemail = (patient or {}).get("email") or frappe.db.get_value("User", doc.booked_by, "email")
	else:
		cust = frappe.db.get_value(CUSTOMER_DT, doc.customer_profile, ["mobile", "email"], as_dict=True) or {}
		pmobile, pemail = cust.get("mobile"), cust.get("email")
	if event == "confirmed":
		text = _("Uber Doc: booking {0} with {1} is confirmed for {2} ({3}). {4}").format(doc.name, doc.provider_name, when, where, link).strip()
		ptext = _("Uber Doc: new booking {0} — {1}, {2} ({3}).").format(doc.name, doc.customer_name, when, MODE_LABEL.get(doc.mode, doc.mode))
	else:
		text = _("Uber Doc: booking {0} with {1} on {2} is cancelled.").format(doc.name, doc.provider_name, when)
		ptext = _("Uber Doc: booking {0} ({1}, {2}) is cancelled.").format(doc.name, doc.customer_name, when)
	_notify(pmobile, text)
	_email(pemail, _("Uber Doc booking {0}").format(doc.name), text)
	_notify(prov.get("mobile"), ptext)


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


def ud_expire_holds(only=None):
	"""Every 5 minutes: release D2C slots whose online payment hold lapsed; cancel stale unpaid enrollments."""
	if not frappe.db.exists("DocType", BOOKING_DT):
		return {"skipped": "not installed"}
	now = now_datetime()
	filters = {"status": ST_REQUESTED, "profile_type": D2C, "payment_status": "Pending", "hold_expires_at": ("<", now)}
	if only:
		filters["name"] = ("in", list(only))
	report = {"bookings": 0, "enrollments": 0, "errors": 0}
	for name in frappe.get_all(BOOKING_DT, filters=filters, pluck="name", limit=500):
		try:
			frappe.db.set_value(BOOKING_DT, name, {"status": ST_CANCELLED, "cancel_reason": "Payment not completed in time"})
			frappe.db.commit()
			report["bookings"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase135 expire hold", message=f"{name}\n{frappe.get_traceback()}")
	efilters = {"status": "Pending Payment", "creation": ("<", add_to_date(now, hours=-ENROLL_HOLD_HOURS))}
	if only:
		efilters["name"] = ("in", list(only))
	for e in frappe.get_all(ENROLL_DT, filters=efilters, fields=["name", "booking"], limit=500):
		try:
			frappe.db.set_value(ENROLL_DT, e.name, "status", "Cancelled")
			if e.booking:
				frappe.db.set_value(BOOKING_DT, e.booking, {"status": ST_CANCELLED, "cancel_reason": "Payment not completed"})
			frappe.db.commit()
			report["enrollments"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
	return report


# ---------------------------------------------------------------------------
# Me, meta, ops overview
# ---------------------------------------------------------------------------


def me(ctx):
	provider = None
	if ctx.provider:
		row = frappe.get_doc(PROVIDER_DT, ctx.provider)
		provider = {
			"name": row.name,
			"full_name": row.full_name,
			"provider_category": row.provider_category,
			"verification_status": row.verification_status,
			"listed": cint(row.listed),
			"can_prescribe_medicines": cint(row.can_prescribe_medicines),
			"completeness": completeness(row),
			"submitted_on": _str(row.submitted_on),
		}
	clinics = [
		{"name": c.name, "clinic_name": c.clinic_name, "status": c.status}
		for c in frappe.get_all(CUSTOMER_DT, filters={"name": ("in", clinics_for_user(ctx.user) or [""])}, fields=["name", "clinic_name", "status"], limit=0)
	]
	patient = None
	profiles = []
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import list_profiles

		profiles = list_profiles(ctx.user)
	except Exception:
		profiles = []
	if profiles:
		patient = {k: profiles[0].get(k) for k in ("patient", "patient_name", "universal_patient_id")}
	return {
		"user": ctx.user,
		"full_name": frappe.db.get_value("User", ctx.user, "full_name"),
		"roles": sorted(r for r in ctx.roles if r not in ("All", "Guest")),
		"is_manager": ctx.is_manager,
		"provider": provider,
		"clinics": clinics,
		"patient": patient,
		"profiles": profiles,
		"pending": bool((provider and provider["verification_status"] == "Pending") or any(c["status"] == "Pending Approval" for c in clinics)),
	}


def meta():
	return {
		"categories": list(CATEGORIES),
		"modes": [{"mode": m, "label": MODE_LABEL[m]} for m in MODES],
		"program_categories": list(PROGRAM_CATEGORIES),
		"program_levels": list(PROGRAM_LEVELS),
		"program_formats": list(PROGRAM_FORMATS),
		"credential_types": list(CRED_TYPES),
		"weekdays": list(WEEKDAYS),
		"offline_payment_modes": list(OFFLINE_MODES),
		"payments": payments_configured(),
		"video": jitsi_config()["kind"],
		"app_url": app_url() or None,
	}


def config_status():
	cfg = jitsi_config()
	warnings = []
	if cfg["kind"] == "public":
		warnings.append(_("Video uses the public meet.jit.si fallback (random rooms, server-side join window only). Set uberdoc_jitsi_domain / uberdoc_jitsi_app_id / uberdoc_jitsi_app_secret (self-hosted Jitsi JWT) or uberdoc_jaas_kid / uberdoc_jaas_private_key (8x8 JaaS) in site_config."))
	pay = payments_configured()
	if not pay["online"]:
		warnings.append(_("Razorpay keys are not configured: online consults and programmes cannot be paid; only pay-at-clinic and free bookings work."))
	elif pay["test_mode"]:
		warnings.append(_("Razorpay sandbox / test mode is active: payments are simulated."))
	if not app_url():
		warnings.append(_("Uber Doc domain not set (site_config uberdoc_base_url): e-Rx QR codes point to the API verify endpoint."))
	from importlib.util import find_spec

	qr = bool(find_spec("pyqrcode"))
	if not qr:
		warnings.append(_("pyqrcode is not importable: e-Rx PDFs show the verify code and URL without a QR image."))
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_emr import webhook_clients

		clients = len(webhook_clients())
	except Exception:
		clients = 0
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	if HOLDS_JOB not in (cron.get("*/5 * * * *") or []):
		warnings.append(_("The */5 Uber Doc slot-hold job is not in the live hooks yet (deploy script patches hooks)."))
	return {"video": cfg["kind"], "video_domain": cfg["domain"], "payments": pay, "app_url": app_url() or None, "qr": qr, "emr_webhook_clients": clients, "warnings": warnings}


def ops_overview():
	from health_ecosystem_core.health_ecosystem_core.clinical_emr import DELIVERY_DT, DELIVERY_STATUSES

	day = datetime.combine(getdate(today()), dtime.min)
	return {
		"providers": {s: frappe.db.count(PROVIDER_DT, {"verification_status": s}) for s in VERIFY_STATUSES},
		"clinics": {s: frappe.db.count(CUSTOMER_DT, {"profile_type": B2B, "status": s}) for s in CLINIC_STATUSES},
		"bookings_today": {m: frappe.db.count(BOOKING_DT, {"mode": m, "slot_start": ("between", [day, day + timedelta(days=1)]), "status": ("!=", ST_CANCELLED)}) for m in SLOT_MODES},
		"open_clinic_requests": frappe.db.count(BOOKING_DT, {"profile_type": B2B, "status": ST_REQUESTED}),
		"refunds_due": frappe.db.count(BOOKING_DT, {"refund_due": 1}),
		"programs_pending": frappe.db.count(PROGRAM_DT, {"status": "Pending Review"}),
		"webhooks": {s: frappe.db.count(DELIVERY_DT, {"status": s}) for s in DELIVERY_STATUSES} if frappe.db.exists("DocType", DELIVERY_DT) else {},
		"config": config_status(),
	}


def bookings_board(filters=None, page=1, page_size=50):
	f = filters or {}
	where = {}
	for key, options in (("status", BOOKING_STATUSES), ("mode", MODES), ("profile_type", PROFILE_TYPES), ("payment_status", PAYMENT_STATUSES)):
		if f.get(key) in options:
			where[key] = f[key]
	if f.get("provider"):
		where["provider"] = f["provider"]
	if cint(f.get("refund_due")):
		where["refund_due"] = 1
	if f.get("date_from") or f.get("date_to"):
		where["booking_date"] = ("between", [getdate(f.get("date_from") or "2000-01-01"), getdate(f.get("date_to") or "2100-01-01")])
	or_filters = None
	q = cstr(f.get("q")).strip()
	if q:
		or_filters = [["name", "like", f"%{q}%"], ["patient_name", "like", f"%{q}%"], ["provider_name", "like", f"%{q}%"], ["customer_name", "like", f"%{q}%"], [UPI_FIELD, "like", f"%{q}%"]]
	page = max(cint(page) or 1, 1)
	size = min(max(cint(page_size) or 50, 1), 200)
	rows = frappe.get_all(BOOKING_DT, filters=where, or_filters=or_filters, fields=BOOKING_LIST_FIELDS, order_by="creation desc", limit_start=(page - 1) * size, limit_page_length=size)
	total = len(frappe.get_all(BOOKING_DT, filters=where, or_filters=or_filters, pluck="name", limit=5000))
	return {"rows": [booking_row(r) for r in rows], "total": total, "page": page, "page_size": size}


def clear_refund(name, refund_ref):
	if not frappe.db.exists(BOOKING_DT, name):
		_missing(_("Booking not found"))
	if not cint(frappe.db.get_value(BOOKING_DT, name, "refund_due")):
		_fail(_("No refund is due on this booking"))
	ref = cstr(refund_ref).strip()[:140]
	if not ref:
		_fail(_("Enter the refund reference"))
	notes = cstr(frappe.db.get_value(BOOKING_DT, name, "notes"))
	frappe.db.set_value(BOOKING_DT, name, {"refund_due": 0, "payment_status": "Refunded", "notes": f"{notes}\nRefunded: {ref}".strip()})
	return booking_row(frappe.db.get_value(BOOKING_DT, name, BOOKING_LIST_FIELDS, as_dict=True))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _context(access, user, roles):
	ctx = frappe._dict(user=user, roles=roles, is_manager=bool(roles & MANAGE_ROLES), provider=provider_for_user(user), clinics=None, patients=None)
	if access == "manage":
		if not ctx.is_manager:
			_deny(_("Uber Doc operations access required"))
	elif access in ("provider", "verified"):
		if not ctx.provider:
			_deny(_("This login is not an Uber Doc provider"))
		if access == "verified" and frappe.db.get_value(PROVIDER_DT, ctx.provider, "verification_status") != "Verified":
			_deny(_("Your provider profile is not verified yet"))
	elif access == "clinic":
		ctx.clinics = clinics_for_user(user)
		if not ctx.clinics and not ctx.is_manager:
			_deny(_("This login is not linked to an Uber Doc clinic"))
	return ctx


def _run(sid, access, fn, message="OK", commit=False):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	try:
		_ensure_ready()
		data = fn(_context(access, user, roles))
		if commit:
			frappe.db.commit()
		return _success(data, message=message)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.DoesNotExistError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not found"), 404)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


def _guest(fn, message="OK", commit=True):
	frappe.flags.ignore_csrf = True
	try:
		_ensure_ready()
		data = fn()
		if commit:
			frappe.db.commit()
		return _success(data, message=message)
	except OtpError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("OTP verification failed"), 401)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.DoesNotExistError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not found"), 404)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


def _viewer_ctx():
	"""Optional context for public endpoints: the signed-in user when a session is present."""
	user = frappe.session.user
	if not user or user == "Guest":
		return None
	roles = set(frappe.get_roles(user))
	return frappe._dict(user=user, roles=roles, is_manager=bool(roles & MANAGE_ROLES), provider=provider_for_user(user), clinics=None, patients=None)


# --- guest / public ----------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_otp_login(mobile=None, otp=None):
	return _guest(lambda: otp_login(mobile, otp), message=_("Authenticated"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_signup(mobile=None, otp=None, payload=None):
	return _guest(lambda: provider_signup(mobile, otp, payload), message=_("Sign-up received"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_clinic_signup(mobile=None, otp=None, payload=None):
	return _guest(lambda: clinic_signup(mobile, otp, payload), message=_("Sign-up received"))


@frappe.whitelist(allow_guest=True)
def ud_meta():
	return _guest(meta, commit=False)


@frappe.whitelist(allow_guest=True)
def ud_search_providers(filters=None):
	return _guest(lambda: search_providers(_parse(filters)), commit=False)


@frappe.whitelist(allow_guest=True)
def ud_provider_profile(name=None, customer_type=None):
	return _guest(lambda: public_provider(name, customer_type), commit=False)


@frappe.whitelist(allow_guest=True)
def ud_slots(provider=None, date_from=None, days=7, mode=None):
	def run():
		out = provider_slots(provider, date_from, days, mode)
		if not out["bookable"]:
			_missing(_("Provider not found"))
		return out

	return _guest(run, commit=False)


@frappe.whitelist(allow_guest=True)
def ud_programs(filters=None):
	return _guest(lambda: list_programs(_parse(filters)), commit=False)


@frappe.whitelist(allow_guest=True)
def ud_program_detail(name=None, sid=None):
	if sid:
		_require_mobile_auth(sid)
	return _guest(lambda: public_program(_viewer_ctx(), name), commit=False)


# --- signed in ---------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def ud_me(sid=None):
	return _run(sid, "user", me, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_book(payload=None, sid=None):
	return _run(sid, "user", lambda ctx: book_d2c(ctx, _parse(payload)), message=_("Booked"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_my_bookings(scope="upcoming", sid=None):
	return _run(sid, "user", lambda ctx: my_bookings(ctx, scope))


@frappe.whitelist(allow_guest=True)
def ud_booking_detail(name=None, sid=None):
	return _run(sid, "user", lambda ctx: booking_detail(ctx, name))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_cancel_booking(name=None, reason=None, sid=None):
	return _run(sid, "user", lambda ctx: cancel_booking(ctx, name, reason), message=_("Cancelled"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_join_room(name=None, sid=None):
	return _run(sid, "user", lambda ctx: join_room(ctx, name), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_post_message(name=None, body=None, sid=None):
	return _run(sid, "user", lambda ctx: post_message(ctx, name, body), message=_("Sent"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_pay_create(kind=None, name=None, sid=None):
	return _run(sid, "user", lambda ctx: pay_create(ctx, kind, name), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_pay_verify(kind=None, name=None, order_id=None, payment_id=None, signature=None, sid=None):
	return _run(sid, "user", lambda ctx: pay_verify(ctx, kind, name, order_id, payment_id, signature), message=_("Payment received"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_program_enroll(program=None, patient=None, payload=None, sid=None):
	return _run(sid, "user", lambda ctx: enroll(ctx, program, patient or None, _parse(payload)), message=_("Enrolled"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_my_enrollments(sid=None):
	return _run(sid, "user", my_enrollments)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_enrollment_progress(name=None, module_row=None, done=1, sid=None):
	return _run(sid, "user", lambda ctx: set_progress(ctx, name, module_row, done), commit=True)


# --- provider ----------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def ud_provider_me(sid=None):
	return _run(sid, "provider", lambda ctx: provider_payload(ctx.provider))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_profile_save(payload=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_provider_profile(ctx, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_rates_save(rates=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_rates(ctx, rates), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_credential_upload(doc_type=None, filename=None, content_base64=None, notes=None, sid=None):
	return _run(sid, "provider", lambda ctx: upload_credential(ctx, doc_type, filename, content_base64, notes), message=_("Uploaded"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_credential_remove(row=None, sid=None):
	return _run(sid, "provider", lambda ctx: remove_credential(ctx, row), message=_("Removed"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_photo_upload(filename=None, content_base64=None, sid=None):
	return _run(sid, "provider", lambda ctx: upload_photo(ctx, filename, content_base64), message=_("Uploaded"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_credential_file(provider=None, row=None, sid=None):
	return _run(sid, "user", lambda ctx: credential_file(ctx, provider or ctx.provider, row))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_submit(sid=None):
	return _run(sid, "provider", submit_for_verification, message=_("Submitted for verification"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_availability(sid=None):
	return _run(sid, "provider", lambda ctx: list_availability(ctx.provider))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rule_save(payload=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_rule(ctx, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_rule_delete(name=None, sid=None):
	return _run(sid, "provider", lambda ctx: delete_rule(ctx, name), message=_("Removed"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_time_off_save(payload=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_time_off(ctx, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_time_off_delete(name=None, sid=None):
	return _run(sid, "provider", lambda ctx: delete_time_off(ctx, name), message=_("Removed"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_provider_calendar(date_from=None, days=7, sid=None):
	return _run(sid, "provider", lambda ctx: provider_calendar(ctx, date_from, days))


@frappe.whitelist(allow_guest=True)
def ud_provider_dashboard(date=None, days=14, sid=None):
	return _run(sid, "provider", lambda ctx: provider_dashboard(ctx, date, days))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_booking_set_status(name=None, status=None, reason=None, sid=None):
	return _run(sid, "user", lambda ctx: provider_set_status(ctx, name, status, reason), message=_("Updated"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_provider_respond(name=None, accept=1, reason=None, sid=None):
	return _run(sid, "verified", lambda ctx: provider_respond(ctx, name, accept, reason), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_my_programs(sid=None):
	return _run(sid, "provider", my_programs)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_program_save(payload=None, sid=None):
	return _run(sid, "provider", lambda ctx: save_program(ctx, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_program_submit(name=None, sid=None):
	return _run(sid, "provider", lambda ctx: submit_program(ctx, name), message=_("Submitted for review"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_provider_settlements(sid=None):
	return _run(sid, "provider", lambda ctx: list_settlements(ctx, provider=ctx.provider))


# --- clinic ------------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def ud_clinic_me(clinic=None, sid=None):
	def run(ctx):
		names = ctx.clinics if not clinic else [c for c in ctx.clinics if c == clinic]
		return {"clinics": [clinic_payload(n) for n in names]}

	return _run(sid, "clinic", run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_clinic_save(payload=None, sid=None):
	return _run(sid, "clinic", lambda ctx: save_clinic(ctx, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_clinic_request_shift(payload=None, sid=None):
	return _run(sid, "clinic", lambda ctx: request_shift(ctx, _parse(payload)), message=_("Request sent to the provider"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_clinic_bookings(clinic=None, scope="upcoming", sid=None):
	return _run(sid, "clinic", lambda ctx: clinic_bookings(ctx, clinic, scope))


@frappe.whitelist(allow_guest=True)
def ud_clinic_settlements(clinic=None, status=None, sid=None):
	return _run(sid, "clinic", lambda ctx: list_settlements(ctx, clinic=clinic, status=status))


# --- operations --------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def ud_ops_overview(sid=None):
	return _run(sid, "manage", lambda ctx: ops_overview())


@frappe.whitelist(allow_guest=True)
def ud_ops_providers(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_providers_ops(_parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_provider_action(name=None, action=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: verify_provider(name, action, reason, ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_import_application(application=None, sid=None):
	return _run(sid, "manage", lambda ctx: import_application(application, ctx.user), message=_("Imported"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_ops_applications(sid=None):
	def run(ctx):
		rows = frappe.get_all(SPA_DT, filters={"application_status": "Approved"}, fields=["name", "full_name", "provider_type", "phone", "email", "linked_doctor", "modified"], order_by="modified desc", limit=200)
		imported = set(frappe.get_all(PROVIDER_DT, filters={"service_provider_application": ("is", "set")}, pluck="service_provider_application", limit=0))
		return {"rows": [{**r, "modified": _str(r.modified), "imported": r.name in imported} for r in rows]}

	return _run(sid, "manage", run)


@frappe.whitelist(allow_guest=True)
def ud_ops_clinics(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_clinics_ops(_parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_clinic_action(name=None, action=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: clinic_action(name, action, reason, ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_clinic_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: ops_save_clinic(_parse(payload), ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_ops_bookings(filters=None, page=1, page_size=50, sid=None):
	return _run(sid, "manage", lambda ctx: bookings_board(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_mark_paid(name=None, kind="booking", payment_mode=None, payment_ref=None, sid=None):
	return _run(sid, "manage", lambda ctx: mark_paid_offline(name, payment_mode, payment_ref, kind), message=_("Marked paid"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_clear_refund(name=None, refund_ref=None, sid=None):
	return _run(sid, "manage", lambda ctx: clear_refund(name, refund_ref), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_ops_programs(status=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_programs_ops(status))


@frappe.whitelist(allow_guest=True)
def ud_ops_program_detail(name=None, sid=None):
	return _run(sid, "manage", lambda ctx: program_payload(name, private=True))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_program_action(name=None, action=None, notes=None, sid=None):
	return _run(sid, "manage", lambda ctx: moderate_program(name, action, notes, ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_ops_settlements(clinic=None, provider=None, status=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_settlements(ctx, clinic, provider, status))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ud_ops_settlement_action(name=None, action=None, invoice_no=None, payment_mode=None, payment_ref=None, notes=None, sid=None):
	return _run(sid, "manage", lambda ctx: settlement_action(name, action, invoice_no, payment_mode, payment_ref, notes), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def ud_ops_config(sid=None):
	return _run(sid, "manage", lambda ctx: config_status())


# ---------------------------------------------------------------------------
# Smoke
# ---------------------------------------------------------------------------


def smoke_phase135():
	"""Throwaway data, rolled back; see clinical_phase135_ud_smoke. Returns {checks, passed, total, ok}."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_smoke import run_smoke

	return run_smoke()
