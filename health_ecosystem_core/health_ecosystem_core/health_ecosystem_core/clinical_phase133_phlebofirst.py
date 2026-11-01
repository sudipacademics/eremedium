"""Phase 133 — PhleboFirst collector marketplace + universal sample barcodes (Module 1 of ECOSYSTEM_ROADMAP.md).

Flow: a PF customer (doctor / pharmacy / small lab / franchisee) uploads a TRF or prescription -> the assigned lab opens it,
builds a quotation and approves -> a plain Customer TRF (payment Pending, no partner-circuit billing) with its draw plan is
created and the job is broadcast to nearby phlebo riders -> first rider to accept wins (row lock) -> at the draw the rider
binds pre-printed PF- vacutainer barcodes to the TRF tubes -> drop at a HUB- prefixed drop hub (payout accrued) -> the lab
receives the tube on the existing accession page (PF code or mapped LIS code resolves to the TRF tube).

Codes: PF- + 7 digits + Verhoeff (tubes), HUB- + 5 digits + Verhoeff (drop hubs), KIT- + 6 digits + Verhoeff (kits).
Every barcode transition is written to the shared Custody Scan Event chain (phase 132 record_scan_event).
The partner-lab converter API lives in clinical_phase133_pf_converter.py.

The scheduler job and the WhatsApp worker job here also run in worker containers, so module-level imports stay limited
to frappe, api helpers, clinical_barcodes and phase 132.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, flt, get_datetime, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import (
	render_labels,
	verhoeff_check_digit,
	verhoeff_validate,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	FP_DT,
	PAYOUT_DT,
	_ensure_doctype,
	_perms,
	_sel,
	custody_secret,
	record_scan_event,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst"
SCHEDULER_JOB = f"{MODULE_PATH}.pf_rebroadcast_and_expire"
SCHEDULER_CRON = "*/2 * * * *"
PF_APP_URL = "https://phlebofirst.com/app"

ACCOUNT_DT = "PF Account"
ACCOUNT_USER_DT = "PF Account User"
SETTINGS_DT = "PF Lab Settings"
SETTINGS_USER_DT = "PF Lab Authoriser"
HUB_DT = "PF Drop Hub"
KIT_DT = "PF Collection Kit"
REQ_DT = "PF TRF Request"
QUOTE_DT = "PF Lab Quotation"
QUOTE_ITEM_DT = "PF Lab Quotation Item"
JOB_DT = "PF Phlebo Job"
OFFER_DT = "PF Job Offer"
UB_DT = "PF Universal Barcode"
MAP_DT = "PF LIS Barcode Mapping"
HOOK_DT = "PF Webhook Event"

TRF_DT = "Customer TRF"
TUBE_DT = "TRF Collection Tube"
TUBE_CATALOG_DT = "HEC Collection Tube"
PROFILE_DT = "Franchisee Profile"
PATIENT_DT = "Health Patient"
PF_TRF_FIELD = "pf_request"
UB_TUBE_FIELD = "universal_barcode"

ROLE_CUSTOMER = "PF Customer"
ROLE_AUTHORISER = "PF Lab Authoriser"
ROLE_PHLEBO = "Phlebotomist"
ROLE_FRANCHISEE = "Franchisee Operator"
MANAGE_ROLES = frozenset({"System Manager", "Health System Admin", "Administrator"})
LAB_ROLES = frozenset({"Lab Technician", "Lab Manager", ROLE_AUTHORISER}) | MANAGE_ROLES
IN_HOUSE_LAB_ROLES = frozenset({"Lab Technician", "Lab Manager"})

ACCOUNT_TYPES = ("Doctor", "Pharmacy", "Small Lab", "Franchisee")
GENDERS = ("Male", "Female", "Other")
REQ_STATUSES = (
	"Uploaded",
	"Under Review",
	"Quoted",
	"Broadcast",
	"Accepted",
	"En Route",
	"Collected",
	"Dropped At Hub",
	"Received At Lab",
	"Rejected",
	"Cancelled",
	"Expired",
)
REQ_FLOW = REQ_STATUSES[:9]
REQ_TRANSITIONS = {
	"Uploaded": {"Under Review", "Quoted", "Rejected", "Cancelled"},
	"Under Review": {"Quoted", "Rejected", "Cancelled"},
	"Quoted": {"Broadcast", "Cancelled", "Expired"},
	"Broadcast": {"Accepted", "Cancelled", "Expired"},
	"Accepted": {"En Route", "Broadcast"},
	"En Route": {"Collected"},
	"Collected": {"En Route", "Dropped At Hub", "Received At Lab"},
	"Dropped At Hub": {"Received At Lab"},
}
REQ_TIME_FIELDS = {
	"Under Review": "reviewed_on",
	"Quoted": "approved_on",
	"Broadcast": "broadcast_on",
	"Accepted": "accepted_on",
	"En Route": "started_on",
	"Collected": "collected_on",
	"Dropped At Hub": "dropped_on",
	"Received At Lab": "received_on",
	"Rejected": "closed_on",
	"Cancelled": "closed_on",
	"Expired": "closed_on",
}
CUSTOMER_CANCELLABLE = ("Uploaded", "Under Review", "Quoted", "Broadcast")
QUOTE_STATUSES = ("Draft", "Issued", "Accepted", "Expired", "Superseded", "Cancelled")
JOB_STATUSES = ("Open", "Accepted", "Started", "Collected", "Dropped", "Received", "Expired", "Cancelled")
JOB_ACTIVE = ("Accepted", "Started", "Collected")
OFFER_RESPONSES = ("Pending", "Accepted", "Declined", "Lapsed", "Withdrawn")
UB_STATUSES = ("Issued", "Bound", "Dropped", "Received", "Rejected", "Void")
KIT_STATUSES = ("In Stock", "Issued", "Consumed", "Returned")
MAP_SOURCES = ("Auto", "API", "Manual")

CODE_SPECS = {"PF": ("PF-", 7), "HUB": ("HUB-", 5), "KIT": ("KIT-", 6)}
SERIES_KEYS = {"PF": "PFUB-SEQ-", "HUB": "PFHUB-SEQ-", "KIT": "PFKIT-SEQ-"}
MAX_ISSUE = 500
MAX_ACTIVE_JOBS = 3
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
LIVE_GPS_MAX_AGE_MIN = 30
RIDER_SPEED_KMPH = 20
DEFAULT_RADII = "5,10,20"
TUBE_CODES = ("BLU", "RED", "SST", "GRN", "LAV", "GRY", "RBL")

SETTINGS_DEFAULTS = {
	"accepts_pf": 1,
	"catchment_radius_km": 15,
	"default_collection_fee": 150,
	"rider_payout_pct": 80,
	"quote_validity_hours": 24,
	"broadcast_radii_km": DEFAULT_RADII,
	"rebroadcast_minutes": 5,
	"sla_minutes": 60,
	"allow_unkitted_codes": 1,
	"lis_barcode_format": "",
	"lis_prefix": "",
}
SETTINGS_EDITABLE = tuple(SETTINGS_DEFAULTS) + ("lat", "lng", "api_client", "outbound_webhook_url", "notes")


def _fail(message):
	raise frappe.ValidationError(message)


def _deny(message):
	raise frappe.PermissionError(message)


def _missing(message):
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


def _clean_phone(value, required=True):
	digits = re.sub(r"\D", "", cstr(value))
	if len(digits) > 10 and digits.startswith("91"):
		digits = digits[-10:]
	if not digits and not required:
		return ""
	if not re.match(r"^[6-9]\d{9}$", digits):
		_fail(_("Enter a valid 10-digit mobile number"))
	return digits


def _mask_phone(phone):
	digits = re.sub(r"\D", "", cstr(phone))
	if len(digits) < 6:
		return ""
	return f"{digits[:2]}{'*' * (len(digits) - 4)}{digits[-2:]}"


def _coords(lat, lng):
	"""(lat, lng) floats, or (None, None) when absent; refuses half / out-of-range pairs."""
	if lat in (None, "") and lng in (None, ""):
		return None, None
	lat, lng = flt(lat, 6), flt(lng, 6)
	if not lat and not lng:
		return None, None
	if not (-90 <= lat <= 90 and -180 <= lng <= 180) or not lat or not lng:
		_fail(_("Invalid location coordinates"))
	return lat, lng


def _distance_km(lat1, lng1, lat2, lng2):
	if not (flt(lat1) and flt(lng1) and flt(lat2) and flt(lng2)):
		return None
	from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import haversine_m

	return round(haversine_m(flt(lat1), flt(lng1), flt(lat2), flt(lng2)) / 1000.0, 2)


def _dt(value):
	if not value:
		return None
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import parse_mysql_datetime

	try:
		return parse_mysql_datetime(value)
	except Exception:
		_fail(_("Invalid date / time {0}").format(cstr(value)[:40]))


def _str(value):
	return cstr(value) if value not in (None, "") else None


def _area_from_address(address):
	parts = [p.strip() for p in cstr(address).replace("\n", ",").split(",") if p.strip()]
	parts = [re.sub(r"\b\d{6}\b", "", p).strip(" -") for p in parts]
	parts = [p for p in parts if p and not p.isdigit()]
	if not parts:
		return ""
	return ", ".join(parts[-2:] if len(parts) >= 3 else parts[-1:])[:140]


# ---------------------------------------------------------------------------
# Prefixed codes
# ---------------------------------------------------------------------------


def make_code(kind, seq):
	"""PF-0000123<c> / HUB-00012<c> / KIT-000123<c> with a Verhoeff check digit."""
	prefix, digits = CODE_SPECS[kind]
	body = str(cint(seq)).zfill(digits)
	if cint(seq) < 1 or len(body) != digits:
		_fail(_("Sequence {0} does not fit a {1} code").format(seq, prefix))
	return f"{prefix}{body}{verhoeff_check_digit(body)}"


def check_code(code, kind):
	"""(normalised code, error message or None): prefix, length and check digit."""
	prefix, digits = CODE_SPECS[kind]
	code = cstr(code).strip().upper()
	if not code.startswith(prefix):
		return code, _("Code must start with {0}").format(prefix)
	rest = code[len(prefix) :]
	if not rest.isdigit() or len(rest) != digits + 1:
		return code, _("{0} codes have {1} digits after the prefix").format(prefix, digits + 1)
	if not verhoeff_validate(rest):
		return code, _("Check digit does not match; re-scan the label")
	return code, None


def require_code(code, kind):
	code, err = check_code(code, kind)
	if err:
		_fail(err)
	return code


def is_pf_code(code):
	return check_code(code, "PF")[1] is None


def _next_code(kind, doctype):
	from frappe.model.naming import getseries

	digits = CODE_SPECS[kind][1]
	for _attempt in range(10):
		seq = cint(getseries(SERIES_KEYS[kind], digits))
		code = make_code(kind, seq)
		if not frappe.db.exists(doctype, code):
			return seq, code
	_fail(_("Could not allocate a new {0} code").format(CODE_SPECS[kind][0]))


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	lab_readers = ("Lab Manager", "Lab Technician", ROLE_AUTHORISER)
	time_fields = [
		{"fieldname": "times_section", "label": "Timeline", "fieldtype": "Section Break", "collapsible": 1},
		{"fieldname": "submitted_on", "label": "Submitted On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "reviewed_on", "label": "Reviewed On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "approved_on", "label": "Approved On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "broadcast_on", "label": "Broadcast On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "accepted_on", "label": "Accepted On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "started_on", "label": "En Route Since", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "collected_on", "label": "Collected On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "dropped_on", "label": "Dropped At Hub On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "received_on", "label": "Received At Lab On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "result_ready_on", "label": "Result Ready On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "closed_on", "label": "Closed On", "fieldtype": "Datetime", "read_only": 1},
	]
	return [
		(
			ACCOUNT_USER_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "full_name", "label": "Name", "fieldtype": "Data", "fetch_from": "user.full_name", "read_only": 1, "in_list_view": 1},
				{"fieldname": "account_role", "label": "Role", "fieldtype": "Select", "options": "Owner\nStaff", "default": "Staff", "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			ACCOUNT_DT,
			[
				{"fieldname": "display_name", "label": "Display Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "account_type", "label": "Account Type", "fieldtype": "Select", "options": _sel(ACCOUNT_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nSuspended", "default": "Active", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "franchisee", "label": "Franchisee", "fieldtype": "Link", "options": PROFILE_DT, "search_index": 1},
				{"fieldname": "referring_doctor", "label": "Referring Doctor", "fieldtype": "Link", "options": "Referring Doctor"},
				{"fieldname": "doctor", "label": "Doctor", "fieldtype": "Link", "options": "Doctor"},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "email", "label": "Email", "fieldtype": "Data"},
				{"fieldname": "gstin", "label": "GSTIN", "fieldtype": "Data"},
				{"fieldname": "address", "label": "Address", "fieldtype": "Small Text"},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "default_lab", "label": "Default Lab", "fieldtype": "Link", "options": PROFILE_DT},
				{"fieldname": "wallet_mode", "label": "Payment Mode", "fieldtype": "Select", "options": "Pay per Order\nPrepaid Wallet\nCredit", "default": "Pay per Order"},
				{"fieldname": "credit_limit", "label": "Credit Limit", "fieldtype": "Currency"},
				{"fieldname": "users", "label": "Users", "fieldtype": "Table", "options": ACCOUNT_USER_DT},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, lab_readers),
			0,
			"PFA-.#####",
			{"title_field": "display_name", "search_fields": "account_type,mobile"},
		),
		(
			SETTINGS_USER_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "full_name", "label": "Name", "fieldtype": "Data", "fetch_from": "user.full_name", "read_only": 1, "in_list_view": 1},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			SETTINGS_DT,
			[
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "lab_name", "label": "Lab Name", "fieldtype": "Data", "fetch_from": "lab.franchise_name", "read_only": 1, "in_list_view": 1},
				{"fieldname": "accepts_pf", "label": "Accepts PhleboFirst Requests", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "catchment_radius_km", "label": "Catchment Radius (km)", "fieldtype": "Float", "default": "15"},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "money_section", "label": "Collection Fee", "fieldtype": "Section Break"},
				{"fieldname": "default_collection_fee", "label": "Default Collection Fee", "fieldtype": "Currency", "default": "150"},
				{"fieldname": "rider_payout_pct", "label": "Rider Payout % of Fee", "fieldtype": "Percent", "default": "80"},
				{"fieldname": "quote_validity_hours", "label": "Quote Validity (hours)", "fieldtype": "Int", "default": "24"},
				{"fieldname": "broadcast_section", "label": "Broadcast", "fieldtype": "Section Break"},
				{"fieldname": "broadcast_radii_km", "label": "Broadcast Radii (km, comma separated)", "fieldtype": "Data", "default": DEFAULT_RADII},
				{"fieldname": "rebroadcast_minutes", "label": "Widen Radius Every (minutes)", "fieldtype": "Int", "default": "5"},
				{"fieldname": "sla_minutes", "label": "Expire Unaccepted Jobs After (minutes)", "fieldtype": "Int", "default": "60"},
				{"fieldname": "allow_unkitted_codes", "label": "Allow Barcodes Not Issued In A Kit", "fieldtype": "Check", "default": "1"},
				{"fieldname": "lis_section", "label": "Lab LIS", "fieldtype": "Section Break"},
				{"fieldname": "lis_barcode_format", "label": "LIS Barcode Format", "fieldtype": "Data", "description": "Tokens: {prefix} {seq} {seq:8} {yyyy} {yy} {mm} {dd} {tube}"},
				{"fieldname": "lis_prefix", "label": "LIS Prefix", "fieldtype": "Data"},
				{"fieldname": "lis_next_seq", "label": "Next LIS Sequence", "fieldtype": "Int", "default": "1"},
				{"fieldname": "api_client", "label": "Converter API Client", "fieldtype": "Link", "options": "HEC API Client"},
				{"fieldname": "outbound_webhook_url", "label": "Outbound Webhook URL (https)", "fieldtype": "Data"},
				{"fieldname": "authorisers", "label": "Lab Authorisers", "fieldtype": "Table", "options": SETTINGS_USER_DT},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, lab_readers),
			0,
			"field:lab",
			{"title_field": "lab_name", "naming_rule": "By fieldname"},
		),
		(
			HUB_DT,
			[
				{"fieldname": "hub_code", "label": "Hub Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "read_only": 1, "in_list_view": 1},
				{"fieldname": "hub_name", "label": "Hub Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "franchisee", "label": "Franchisee", "fieldtype": "Link", "options": PROFILE_DT},
				{"fieldname": "collection_centre", "label": "B2B Collection Centre", "fieldtype": "Link", "options": "B2B Collection Centre"},
				{"fieldname": "receiving_lab", "label": "Receiving Lab", "fieldtype": "Link", "options": PROFILE_DT},
				{"fieldname": "address", "label": "Address", "fieldtype": "Small Text"},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "geofence_m", "label": "Geofence (m)", "fieldtype": "Int", "default": "300"},
				{"fieldname": "hours", "label": "Hours", "fieldtype": "Data"},
			],
			_perms(managers, lab_readers),
			0,
			"field:hub_code",
			{"title_field": "hub_name", "naming_rule": "By fieldname"},
		),
		(
			KIT_DT,
			[
				{"fieldname": "kit_code", "label": "Kit Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "read_only": 1, "in_list_view": 1},
				{"fieldname": "rider", "label": "Rider", "fieldtype": "Link", "options": FP_DT, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(KIT_STATUSES), "default": "In Stock", "in_list_view": 1},
				{"fieldname": "issued_on", "label": "Issued On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "issued_by", "label": "Issued By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "contents_json", "label": "Contents", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, lab_readers),
			0,
			"field:kit_code",
			{"naming_rule": "By fieldname"},
		),
		(
			REQ_DT,
			[
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(REQ_STATUSES), "default": "Uploaded", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "account", "label": "PF Account", "fieldtype": "Link", "options": ACCOUNT_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "account_type", "label": "Account Type", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "customer_user", "label": "Uploaded By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "assigned_lab", "label": "Assigned Lab", "fieldtype": "Link", "options": PROFILE_DT, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "created_via", "label": "Created Via", "fieldtype": "Select", "options": "Portal\nWhatsApp\nAPI", "default": "Portal"},
				{"fieldname": "payment_status", "label": "Payment Status", "fieldtype": "Select", "options": "Pending\nPaid\nWaived", "default": "Pending"},
				{"fieldname": "patient_section", "label": "Patient", "fieldtype": "Section Break"},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "search_index": 1},
				{"fieldname": "universal_patient_id", "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "patient_phone", "label": "Patient Mobile", "fieldtype": "Data"},
				{"fieldname": "patient_age", "label": "Age (years)", "fieldtype": "Int"},
				{"fieldname": "patient_gender", "label": "Gender", "fieldtype": "Select", "options": _sel(GENDERS)},
				{"fieldname": "upload_section", "label": "Upload", "fieldtype": "Section Break"},
				{"fieldname": "upload_file", "label": "TRF / Prescription (private)", "fieldtype": "Attach"},
				{"fieldname": "file_name", "label": "File Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "file_type", "label": "File Type", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "suggested_tests", "label": "Suggested Tests", "fieldtype": "Small Text"},
				{"fieldname": "ocr_json", "label": "OCR", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "pickup_section", "label": "Pickup", "fieldtype": "Section Break"},
				{"fieldname": "pickup_address", "label": "Pickup Address", "fieldtype": "Small Text"},
				{"fieldname": "pickup_area", "label": "Pickup Area", "fieldtype": "Data"},
				{"fieldname": "pickup_lat", "label": "Pickup Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "pickup_lng", "label": "Pickup Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "preferred_window_start", "label": "Preferred From", "fieldtype": "Datetime"},
				{"fieldname": "preferred_window_end", "label": "Preferred To", "fieldtype": "Datetime"},
				{"fieldname": "links_section", "label": "Links", "fieldtype": "Section Break"},
				{"fieldname": "quotation", "label": "Quotation", "fieldtype": "Link", "options": QUOTE_DT, "read_only": 1},
				{"fieldname": "customer_trf", "label": "Customer TRF", "fieldtype": "Link", "options": TRF_DT, "read_only": 1, "search_index": 1},
				{"fieldname": "job", "label": "Phlebo Job", "fieldtype": "Link", "options": JOB_DT, "read_only": 1},
				{"fieldname": "reviewed_by", "label": "Reviewed By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "status_reason", "label": "Rejection / Cancellation Reason", "fieldtype": "Small Text"},
			]
			+ time_fields,
			_perms(managers, lab_readers),
			0,
			"PFR-.YYYY.-.#####",
			{"title_field": "patient_name", "search_fields": "patient_name,patient_phone,status", "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			QUOTE_ITEM_DT,
			[
				{"fieldname": "item_code", "label": "Test", "fieldtype": "Link", "options": "Item", "reqd": 1, "in_list_view": 1},
				{"fieldname": "item_name", "label": "Test Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "mrp", "label": "MRP", "fieldtype": "Currency"},
				{"fieldname": "rate", "label": "Rate", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "qty", "label": "Qty", "fieldtype": "Int", "default": "1", "in_list_view": 1},
				{"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "tube_hint", "label": "Tube", "fieldtype": "Data"},
			],
			None,
			1,
			"hash",
			None,
		),
		(
			QUOTE_DT,
			[
				{"fieldname": "request", "label": "Request", "fieldtype": "Link", "options": REQ_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(QUOTE_STATUSES), "default": "Draft", "in_list_view": 1},
				{"fieldname": "items", "label": "Tests", "fieldtype": "Table", "options": QUOTE_ITEM_DT},
				{"fieldname": "test_total", "label": "Test Total", "fieldtype": "Currency", "read_only": 1},
				{"fieldname": "collection_fee", "label": "Collection Fee", "fieldtype": "Currency"},
				{"fieldname": "rider_payout", "label": "Rider Payout", "fieldtype": "Currency"},
				{"fieldname": "discount", "label": "Discount", "fieldtype": "Currency"},
				{"fieldname": "grand_total", "label": "Grand Total", "fieldtype": "Currency", "read_only": 1, "in_list_view": 1},
				{"fieldname": "valid_until", "label": "Valid Until", "fieldtype": "Datetime"},
				{"fieldname": "pickup_address", "label": "Pickup Address", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "pickup_lat", "label": "Pickup Latitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "pickup_lng", "label": "Pickup Longitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "authorised_by", "label": "Authorised By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "authorised_on", "label": "Authorised On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, lab_readers),
			0,
			"PFQ-.YYYY.-.#####",
			None,
		),
		(
			JOB_DT,
			[
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(JOB_STATUSES), "default": "Open", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "request", "label": "Request", "fieldtype": "Link", "options": REQ_DT, "reqd": 1, "search_index": 1},
				{"fieldname": "quotation", "label": "Quotation", "fieldtype": "Link", "options": QUOTE_DT},
				{"fieldname": "customer_trf", "label": "Customer TRF", "fieldtype": "Link", "options": TRF_DT, "search_index": 1},
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "in_standard_filter": 1},
				{"fieldname": "pickup_area", "label": "Pickup Area", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "pickup_address", "label": "Pickup Address", "fieldtype": "Small Text"},
				{"fieldname": "pickup_lat", "label": "Pickup Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "pickup_lng", "label": "Pickup Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "window_start", "label": "Window From", "fieldtype": "Datetime"},
				{"fieldname": "window_end", "label": "Window To", "fieldtype": "Datetime"},
				{"fieldname": "collection_fee", "label": "Collection Fee", "fieldtype": "Currency"},
				{"fieldname": "rider_payout", "label": "Rider Payout", "fieldtype": "Currency", "in_list_view": 1},
				{"fieldname": "tube_count", "label": "Tubes", "fieldtype": "Int"},
				{"fieldname": "test_count", "label": "Tests", "fieldtype": "Int"},
				{"fieldname": "broadcast_section", "label": "Broadcast", "fieldtype": "Section Break"},
				{"fieldname": "broadcast_round", "label": "Broadcast Round", "fieldtype": "Int", "default": "0"},
				{"fieldname": "broadcast_radius_km", "label": "Broadcast Radius (km)", "fieldtype": "Float"},
				{"fieldname": "last_broadcast_on", "label": "Last Broadcast", "fieldtype": "Datetime"},
				{"fieldname": "sla_due", "label": "Accept By", "fieldtype": "Datetime"},
				{"fieldname": "rider_section", "label": "Rider", "fieldtype": "Section Break"},
				{"fieldname": "rider", "label": "Rider", "fieldtype": "Link", "options": FP_DT, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "rider_user", "label": "Rider User", "fieldtype": "Link", "options": "User", "search_index": 1},
				{"fieldname": "accepted_on", "label": "Accepted On", "fieldtype": "Datetime"},
				{"fieldname": "started_on", "label": "Started On", "fieldtype": "Datetime"},
				{"fieldname": "collected_on", "label": "Collected On", "fieldtype": "Datetime"},
				{"fieldname": "dropped_hub", "label": "Dropped At Hub", "fieldtype": "Link", "options": HUB_DT},
				{"fieldname": "dropped_on", "label": "Dropped On", "fieldtype": "Datetime"},
				{"fieldname": "drop_distance_m", "label": "Drop Distance From Hub (m)", "fieldtype": "Float"},
				{"fieldname": "drop_geofence_warning", "label": "Dropped Outside Hub Geofence", "fieldtype": "Check"},
				{"fieldname": "received_on", "label": "Received On", "fieldtype": "Datetime"},
				{"fieldname": "payout_entry", "label": "Payout Entry", "fieldtype": "Link", "options": PAYOUT_DT},
			],
			_perms(managers, lab_readers),
			0,
			"PFJ-.YYYY.-.#####",
			{"sort_field": "creation", "sort_order": "DESC"},
		),
		(
			OFFER_DT,
			[
				{"fieldname": "job", "label": "Job", "fieldtype": "Link", "options": JOB_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "rider", "label": "Rider", "fieldtype": "Link", "options": FP_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "rider_user", "label": "Rider User", "fieldtype": "Link", "options": "User"},
				{"fieldname": "response", "label": "Response", "fieldtype": "Select", "options": _sel(OFFER_RESPONSES), "default": "Pending", "in_list_view": 1},
				{"fieldname": "broadcast_round", "label": "Round", "fieldtype": "Int"},
				{"fieldname": "distance_km", "label": "Distance (km)", "fieldtype": "Float", "in_list_view": 1},
				{"fieldname": "offered_on", "label": "Offered On", "fieldtype": "Datetime"},
				{"fieldname": "responded_on", "label": "Responded On", "fieldtype": "Datetime"},
				{"fieldname": "offer_key", "label": "Offer Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms(managers, ()),
			0,
			"hash",
			None,
		),
		(
			UB_DT,
			[
				{"fieldname": "code", "label": "Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "read_only": 1, "in_list_view": 1},
				{"fieldname": "seq", "label": "Sequence", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(UB_STATUSES), "default": "Issued", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "tube_code", "label": "Tube Type", "fieldtype": "Link", "options": TUBE_CATALOG_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "kit", "label": "Kit", "fieldtype": "Link", "options": KIT_DT, "in_standard_filter": 1},
				{"fieldname": "rider", "label": "Rider", "fieldtype": "Link", "options": FP_DT, "in_standard_filter": 1},
				{"fieldname": "issue_batch", "label": "Issue Batch", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "issued_on", "label": "Issued On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "issued_by", "label": "Issued By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "bind_section", "label": "Binding", "fieldtype": "Section Break"},
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "read_only": 1, "search_index": 1},
				{"fieldname": "bound_request", "label": "Request", "fieldtype": "Link", "options": REQ_DT, "read_only": 1},
				{"fieldname": "bound_job", "label": "Job", "fieldtype": "Link", "options": JOB_DT, "read_only": 1, "search_index": 1},
				{"fieldname": "bound_trf", "label": "Customer TRF", "fieldtype": "Link", "options": TRF_DT, "read_only": 1, "search_index": 1},
				{"fieldname": "bound_tube_row", "label": "TRF Tube Row", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "bound_accession", "label": "Accession ID", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "bound_on", "label": "Bound On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "bound_by", "label": "Bound By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "bound_lat", "label": "Bound Latitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "bound_lng", "label": "Bound Longitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "binding_signature", "label": "Binding Signature", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "drop_hub", "label": "Drop Hub", "fieldtype": "Link", "options": HUB_DT, "read_only": 1},
				{"fieldname": "dropped_on", "label": "Dropped On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "received_on", "label": "Received On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "received_by", "label": "Received By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "status_reason", "label": "Rejection / Void Reason", "fieldtype": "Small Text", "read_only": 1},
			],
			_perms(managers, lab_readers),
			0,
			"field:code",
			{"naming_rule": "By fieldname", "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			MAP_DT,
			[
				{"fieldname": "universal_barcode", "label": "Universal Barcode", "fieldtype": "Link", "options": UB_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "lis_barcode", "label": "Lab LIS Barcode", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "lis_format", "label": "Format", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": _sel(MAP_SOURCES), "default": "API", "in_list_view": 1},
				{"fieldname": "api_client", "label": "API Client", "fieldtype": "Link", "options": "HEC API Client", "read_only": 1},
				{"fieldname": "created_by", "label": "Created By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "universal_lab_key", "label": "Universal + Lab", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "lab_lis_key", "label": "Lab + LIS", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms(managers, lab_readers),
			0,
			"hash",
			None,
		),
		(
			HOOK_DT,
			[
				{"fieldname": "direction", "label": "Direction", "fieldtype": "Select", "options": "Inbound\nOutbound", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "event_type", "label": "Event", "fieldtype": "Data", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "event_id", "label": "Event ID", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "idem_key", "label": "Idempotency Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Pending\nDelivered\nProcessed\nFailed\nAbandoned", "default": "Pending", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "api_client", "label": "API Client", "fieldtype": "Link", "options": "HEC API Client"},
				{"fieldname": "lab", "label": "Lab", "fieldtype": "Link", "options": PROFILE_DT, "in_standard_filter": 1},
				{"fieldname": "universal_barcode", "label": "Universal Barcode", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "url", "label": "URL", "fieldtype": "Data"},
				{"fieldname": "attempts", "label": "Attempts", "fieldtype": "Int", "default": "0"},
				{"fieldname": "next_attempt_on", "label": "Next Attempt", "fieldtype": "Datetime"},
				{"fieldname": "http_status", "label": "HTTP Status", "fieldtype": "Int"},
				{"fieldname": "payload_json", "label": "Payload", "fieldtype": "Code", "options": "JSON"},
				{"fieldname": "response_json", "label": "Response", "fieldtype": "Code", "options": "JSON"},
				{"fieldname": "last_error", "label": "Last Error", "fieldtype": "Small Text"},
			],
			_perms((), managers),
			0,
			"hash",
			{"sort_field": "creation", "sort_order": "DESC"},
		),
	]


def _ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	spec = {}
	if frappe.db.exists("DocType", TRF_DT):
		spec[TRF_DT] = [
			{
				"fieldname": PF_TRF_FIELD,
				"label": "PhleboFirst Request",
				"fieldtype": "Link",
				"options": REQ_DT,
				"insert_after": "unique_barcode",
				"read_only": 1,
				"no_copy": 1,
				"search_index": 1,
			}
		]
	if frappe.db.exists("DocType", TUBE_DT):
		spec[TUBE_DT] = [
			{
				"fieldname": UB_TUBE_FIELD,
				"label": "Universal Barcode",
				"fieldtype": "Link",
				"options": UB_DT,
				"insert_after": "accession_id",
				"read_only": 1,
				"no_copy": 1,
				"search_index": 1,
				"in_list_view": 1,
			}
		]
	if spec:
		create_custom_fields(spec, update=True)
	return sorted(spec)


def _ensure_roles():
	created = []
	for role in (ROLE_CUSTOMER, ROLE_AUTHORISER):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 0}).insert(ignore_permissions=True)
			created.append(role)
	return created


def _links_resolvable(fields):
	"""Drop Link/Table fields whose target DocType does not exist yet (request <-> quotation <-> job link each other)."""
	dropped = {
		f.get("fieldname")
		for f in fields
		if f.get("fieldtype") in ("Link", "Table", "Table MultiSelect") and not frappe.db.exists("DocType", f.get("options"))
	}
	return [
		f
		for f in fields
		if f.get("fieldname") not in dropped and cstr(f.get("fetch_from")).split(".")[0] not in dropped
	]


def ensure_pf_setup():
	created = _ensure_roles()
	specs = _doctype_specs()
	for name, fields, perms, istable, autoname, extra in specs:
		if _ensure_doctype(name, _links_resolvable(fields), perms, istable=istable, autoname=autoname, extra=extra):
			created.append(name)
	for name, fields, perms, istable, autoname, extra in specs:
		_ensure_doctype(name, fields, perms, istable=istable, autoname=autoname, extra=extra)
	_ensure_custom_fields()
	return created


def _ensure_ready():
	if not frappe.db.exists("DocType", HOOK_DT) or not _has_field(TUBE_DT, UB_TUBE_FIELD) or not _has_field(TRF_DT, PF_TRF_FIELD):
		ensure_pf_setup()
		frappe.db.commit()


def ensure_scheduler_job():
	"""Register the */2 rebroadcast job once the live hooks carry it (no global sync_jobs)."""
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	if SCHEDULER_JOB not in (cron.get(SCHEDULER_CRON) or []):
		return "not in hooks"
	if frappe.db.exists("Scheduled Job Type", {"method": SCHEDULER_JOB}):
		return "present"
	frappe.get_doc({"doctype": "Scheduled Job Type", "method": SCHEDULER_JOB, "frequency": "Cron", "cron_format": SCHEDULER_CRON}).insert(
		ignore_permissions=True
	)
	frappe.db.commit()
	return "created"


def setup_phase133():
	"""Idempotent: roles, PF DocTypes, TRF custom fields, tube catalog check, scheduled job."""
	created = ensure_pf_setup()
	frappe.db.commit()
	missing_tubes = [t for t in TUBE_CODES if not frappe.db.exists(TUBE_CATALOG_DT, t)]
	if missing_tubes:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import seed_collection_tubes

			seed_collection_tubes()
			missing_tubes = [t for t in TUBE_CODES if not frappe.db.exists(TUBE_CATALOG_DT, t)]
		except Exception:
			frappe.log_error(title="setup_phase133 tubes", message=frappe.get_traceback())
	custody_secret()
	out = {
		"ok": True,
		"created": created,
		"custom_fields": [f"{TRF_DT}.{PF_TRF_FIELD}", f"{TUBE_DT}.{UB_TUBE_FIELD}"],
		"missing_tubes": missing_tubes,
		"scheduler_job": ensure_scheduler_job(),
		"accepting_labs": frappe.db.count(SETTINGS_DT, {"accepts_pf": 1}),
	}
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# Labs, settings, hubs
# ---------------------------------------------------------------------------


def mother_lab():
	try:
		value = frappe.db.get_single_value("Health Ecosystem Settings", "mother_lab_franchisee")
	except Exception:
		value = None
	value = value or "MOTHERLAB"
	return value if frappe.db.exists(PROFILE_DT, value) else None


def is_lab_profile(lab):
	if not lab or not frappe.db.exists(PROFILE_DT, lab):
		return False
	if lab == mother_lab():
		return True
	if _has_field(PROFILE_DT, "has_lab") and cint(frappe.db.get_value(PROFILE_DT, lab, "has_lab")):
		return True
	if _has_field(PROFILE_DT, "partner_tier") and cstr(frappe.db.get_value(PROFILE_DT, lab, "partner_tier")).strip() == "Orange FOCO":
		return True
	return False


def lab_settings(lab):
	if not lab or not frappe.db.exists(SETTINGS_DT, lab):
		return None
	return frappe.get_doc(SETTINGS_DT, lab)


def _settings_value(settings, key):
	if settings is None:
		return SETTINGS_DEFAULTS.get(key)
	value = settings.get(key)
	return SETTINGS_DEFAULTS.get(key) if value in (None, "") else value


def _radii(settings):
	out = []
	for part in re.split(r"[,\s]+", cstr(_settings_value(settings, "broadcast_radii_km"))):
		if flt(part) > 0:
			out.append(flt(part))
	return sorted(out) or [5.0, 10.0, 20.0]


def lab_coords(lab):
	settings = lab_settings(lab)
	if settings and flt(settings.lat) and flt(settings.lng):
		return flt(settings.lat), flt(settings.lng)
	fields = [f for f in ("hub_latitude", "hub_longitude", "latitude", "longitude") if _has_field(PROFILE_DT, f)]
	row = frappe.db.get_value(PROFILE_DT, lab, fields, as_dict=True) if fields else None
	if not row:
		return None, None
	for la, ln in (("hub_latitude", "hub_longitude"), ("latitude", "longitude")):
		if flt(row.get(la)) and flt(row.get(ln)):
			return flt(row.get(la)), flt(row.get(ln))
	return None, None


def _lab_name(lab):
	return frappe.db.get_value(PROFILE_DT, lab, "franchise_name") if lab else None


def accepting_labs():
	return frappe.get_all(SETTINGS_DT, filters={"accepts_pf": 1}, pluck="lab")


def assign_lab(account, lat, lng):
	default = account.get("default_lab")
	labs = accepting_labs()
	if default and default in labs:
		return default
	if lat and lng:
		best = None
		for lab in labs:
			la, ln = lab_coords(lab)
			d = _distance_km(lat, lng, la, ln)
			radius = flt(_settings_value(lab_settings(lab), "catchment_radius_km"))
			if d is not None and d <= radius and (best is None or d < best[0]):
				best = (d, lab)
		if best:
			return best[1]
	return labs[0] if len(labs) == 1 else None


def labs_for_user(user, roles):
	"""None means every lab (managers)."""
	if roles & MANAGE_ROLES:
		return None
	labs = set()
	if frappe.db.exists("DocType", SETTINGS_USER_DT):
		labs |= set(frappe.get_all(SETTINGS_USER_DT, filters={"user": user, "parenttype": SETTINGS_DT}, pluck="parent"))
	for lab in frappe.get_all(PROFILE_DT, filters={"linked_user": user, "active_status": "Active"}, pluck="name"):
		if is_lab_profile(lab):
			labs.add(lab)
	if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_franchisee_hub"}):
		hub = frappe.db.get_value("User", user, "hec_franchisee_hub")
		if hub and is_lab_profile(hub):
			labs.add(hub)
	if not labs and roles & IN_HOUSE_LAB_ROLES:
		ml = mother_lab()
		if ml:
			labs.add(ml)
	return labs


def _assert_lab(ctx, lab):
	if ctx.labs is None:
		return
	if not lab or lab not in ctx.labs:
		_deny(_("This request belongs to another lab"))


def hub_by_code(code):
	code = require_code(code, "HUB")
	row = frappe.db.get_value(
		HUB_DT, code, ["name", "hub_code", "hub_name", "active", "lat", "lng", "geofence_m", "receiving_lab", "address"], as_dict=True
	)
	if not row:
		_missing(_("Drop hub {0} is not registered").format(code))
	if not cint(row.active):
		_fail(_("Drop hub {0} is not active").format(code))
	return row


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


def account_for_user(user, roles, create=True):
	if frappe.db.exists("DocType", ACCOUNT_USER_DT):
		for parent in frappe.get_all(ACCOUNT_USER_DT, filters={"user": user, "active": 1, "parenttype": ACCOUNT_DT}, pluck="parent"):
			acc = frappe.db.get_value(ACCOUNT_DT, parent, ["name", "status"], as_dict=True)
			if acc and acc.status == "Active":
				return frappe.get_doc(ACCOUNT_DT, acc.name)
	if ROLE_FRANCHISEE not in roles:
		return None
	franchise = frappe.db.get_value(PROFILE_DT, {"linked_user": user, "active_status": "Active"}, "name")
	if not franchise:
		return None
	existing = frappe.db.get_value(ACCOUNT_DT, {"franchisee": franchise, "status": "Active"}, "name")
	if existing:
		doc = frappe.get_doc(ACCOUNT_DT, existing)
		if not any(r.user == user for r in doc.users):
			doc.append("users", {"user": user, "account_role": "Owner", "active": 1})
			doc.save(ignore_permissions=True)
		return doc
	if not create:
		return None
	return _create_franchise_account(franchise, user)


def _create_franchise_account(franchise, user):
	fields = ["franchise_name", "contact_phone", "contact_email", "address"]
	fields += [f for f in ("latitude", "longitude") if _has_field(PROFILE_DT, f)]
	row = frappe.db.get_value(PROFILE_DT, franchise, fields, as_dict=True) or {}
	phone = re.sub(r"\D", "", cstr(row.get("contact_phone")))[-10:]
	doc = frappe.get_doc(
		{
			"doctype": ACCOUNT_DT,
			"display_name": row.get("franchise_name") or franchise,
			"account_type": "Franchisee",
			"status": "Active",
			"franchisee": franchise,
			"mobile": phone or None,
			"email": row.get("contact_email"),
			"address": row.get("address"),
			"lat": flt(row.get("latitude")) or None,
			"lng": flt(row.get("longitude")) or None,
			"users": [{"user": user, "account_role": "Owner", "active": 1}],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def _resolve_user(identifier):
	value = cstr(identifier).strip()
	if not value:
		return None
	if frappe.db.exists("User", value):
		return value
	user = frappe.db.get_value("User", {"email": value}, "name")
	if user:
		return user
	digits = re.sub(r"\D", "", value)[-10:]
	if len(digits) == 10:
		return frappe.db.get_value("User", {"mobile_no": ("like", f"%{digits}")}, "name")
	return None


def _grant_role(user, role):
	if user in ("Administrator", "Guest") or role in frappe.get_roles(user):
		return False
	doc = frappe.get_doc("User", user)
	doc.flags.ignore_permissions = True
	doc.add_roles(role)
	return True


def save_account(payload):
	p = payload
	name = cstr(p.get("name")).strip()
	doc = frappe.get_doc(ACCOUNT_DT, name) if name else frappe.new_doc(ACCOUNT_DT)
	for f in ("display_name", "account_type", "status", "franchisee", "referring_doctor", "doctor", "email", "gstin", "address", "default_lab", "wallet_mode", "notes"):
		if f in p:
			doc.set(f, _str(p.get(f)))
	if "mobile" in p:
		doc.mobile = _clean_phone(p.get("mobile"), required=False) or None
	if "credit_limit" in p:
		doc.credit_limit = max(0, flt(p.get("credit_limit")))
	if "lat" in p or "lng" in p:
		doc.lat, doc.lng = _coords(p.get("lat"), p.get("lng"))
	if not cstr(doc.display_name).strip():
		_fail(_("Display name is required"))
	if doc.account_type not in ACCOUNT_TYPES:
		_fail(_("Choose an account type"))
	if doc.status not in ("Active", "Suspended"):
		doc.status = "Active"
	for link_field, dt in (("franchisee", PROFILE_DT), ("referring_doctor", "Referring Doctor"), ("doctor", "Doctor"), ("default_lab", PROFILE_DT)):
		value = doc.get(link_field)
		if value and not frappe.db.exists(dt, value):
			_fail(_("{0} {1} not found").format(dt, value))
	if doc.account_type == "Franchisee" and not doc.franchisee:
		_fail(_("Link the franchisee profile"))
	if doc.franchisee:
		clash = frappe.db.get_value(ACCOUNT_DT, {"franchisee": doc.franchisee, "status": "Active", "name": ("!=", doc.name or "")}, "name")
		if clash:
			_fail(_("Franchisee already has PF account {0}").format(clash))
	if doc.default_lab and not frappe.db.exists(SETTINGS_DT, doc.default_lab):
		_fail(_("The default lab has no PhleboFirst settings"))
	granted = []
	for ident in p.get("add_users") or []:
		user = _resolve_user(ident)
		if not user:
			_fail(_("No user found for {0}").format(cstr(ident)[:80]))
		if not any(r.user == user for r in doc.users):
			doc.append("users", {"user": user, "account_role": "Staff", "active": 1})
	for user in p.get("remove_users") or []:
		for row in doc.users:
			if row.user == user:
				row.active = 0
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	for row in doc.users:
		if cint(row.active) and ROLE_FRANCHISEE not in frappe.get_roles(row.user) and _grant_role(row.user, ROLE_CUSTOMER):
			granted.append(row.user)
	out = account_row(doc)
	out["granted_role_to"] = granted
	return out


def account_row(doc):
	return {
		"name": doc.name,
		"display_name": doc.display_name,
		"account_type": doc.account_type,
		"status": doc.status,
		"franchisee": doc.franchisee,
		"referring_doctor": doc.referring_doctor,
		"doctor": doc.doctor,
		"mobile": doc.mobile,
		"email": doc.email,
		"address": doc.address,
		"lat": flt(doc.lat) or None,
		"lng": flt(doc.lng) or None,
		"default_lab": doc.default_lab,
		"default_lab_name": _lab_name(doc.default_lab),
		"users": [{"user": r.user, "full_name": r.full_name, "account_role": r.account_role, "active": cint(r.active)} for r in doc.users],
	}


# ---------------------------------------------------------------------------
# Request status
# ---------------------------------------------------------------------------


def set_request_status(name, status, extra=None, force=False):
	current = frappe.db.get_value(REQ_DT, name, "status")
	if current == status:
		if extra:
			frappe.db.set_value(REQ_DT, name, extra)
		return False
	if not force and status not in REQ_TRANSITIONS.get(current, set()):
		_fail(_("Request {0} is {1}; it cannot move to {2}").format(name, current, status))
	values = {"status": status}
	field = REQ_TIME_FIELDS.get(status)
	if field:
		values[field] = now_datetime()
	values.update(extra or {})
	frappe.db.set_value(REQ_DT, name, values)
	return True


def _lock(doctype, name):
	rows = frappe.db.sql(f"select name from `tab{doctype}` where name = %s for update", (name,))
	if not rows:
		_missing(_("{0} {1} not found").format(doctype, name))
	return frappe.get_doc(doctype, name)


# ---------------------------------------------------------------------------
# Customer: upload, list, detail, cancel
# ---------------------------------------------------------------------------


def _sniff_file(content):
	if content[:4] == b"%PDF":
		return "application/pdf", "pdf"
	if content[:3] == b"\xff\xd8\xff":
		return "image/jpeg", "jpg"
	if content[:8] == b"\x89PNG\r\n\x1a\n":
		return "image/png", "png"
	if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
		return "image/webp", "webp"
	if content[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc"):
		return "image/heic", "heic"
	return None, None


def _decode_upload(file_base64, file_name):
	raw = cstr(file_base64).strip()
	if not raw:
		_fail(_("Attach the TRF or prescription (photo or PDF)"))
	if raw.startswith("data:") and "," in raw:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw, validate=False)
	except Exception:
		_fail(_("The attached file could not be read"))
	if not content:
		_fail(_("The attached file is empty"))
	if len(content) > MAX_UPLOAD_BYTES:
		_fail(_("The file is larger than 5 MB"))
	mime, ext = _sniff_file(content)
	if not mime:
		_fail(_("Only photos (JPG, PNG, WEBP, HEIC) or PDF files are accepted"))
	stem = re.sub(r"[^A-Za-z0-9._-]+", "_", cstr(file_name).rsplit(".", 1)[0])[:60].strip("._") or "trf"
	return content, f"{stem}.{ext}", mime


def create_request(ctx, payload):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import assign_upi
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

	account = ctx.account
	p = payload
	patient_name = re.sub(r"\s+", " ", cstr(p.get("patient_name"))).strip()
	if len(patient_name) < 2 or len(patient_name) > 140:
		_fail(_("Enter the patient's full name"))
	phone = _clean_phone(p.get("patient_phone"))
	age = cint(p.get("patient_age"))
	if age < 0 or age > 120 or cstr(p.get("patient_age")).strip() == "":
		_fail(_("Enter the patient's age in years"))
	gender = cstr(p.get("patient_gender")).strip().title()
	if gender not in GENDERS:
		_fail(_("Choose the patient's gender"))
	address = cstr(p.get("pickup_address")).strip()
	if len(address) < 8:
		_fail(_("Enter the full pickup address"))
	lat, lng = _coords(p.get("pickup_lat"), p.get("pickup_lng"))
	if lat is None:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import geocode_address

			lat, lng = geocode_address(address)
			lat, lng = (flt(lat, 6) or None, flt(lng, 6) or None)
		except Exception:
			lat, lng = None, None
	start, end = _dt(p.get("preferred_window_start")), _dt(p.get("preferred_window_end"))
	if start and end and end <= start:
		_fail(_("The preferred window must end after it starts"))
	content, file_name, mime = _decode_upload(p.get("file_base64"), p.get("file_name"))

	patient = ensure_patient(patient_name, phone=phone, age=age or None, gender=gender)
	upi = assign_upi(patient) if patient else None
	lab = assign_lab(account, lat, lng)
	doc = frappe.get_doc(
		{
			"doctype": REQ_DT,
			"status": "Uploaded",
			"account": account.name,
			"account_type": account.account_type,
			"customer_user": ctx.user,
			"assigned_lab": lab,
			"created_via": "Portal",
			"payment_status": "Pending",
			"patient": patient,
			"universal_patient_id": upi,
			"patient_name": patient_name,
			"patient_phone": phone,
			"patient_age": age,
			"patient_gender": gender,
			"suggested_tests": cstr(p.get("suggested_tests")).strip()[:1000] or None,
			"notes": cstr(p.get("notes")).strip()[:1000] or None,
			"pickup_address": address[:1000],
			"pickup_area": (cstr(p.get("pickup_area")).strip() or _area_from_address(address))[:140] or None,
			"pickup_lat": lat,
			"pickup_lng": lng,
			"preferred_window_start": start,
			"preferred_window_end": end,
			"submitted_on": now_datetime(),
		}
	)
	doc.insert(ignore_permissions=True)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{doc.name}-{file_name}",
			"content": content,
			"is_private": 1,
			"attached_to_doctype": REQ_DT,
			"attached_to_name": doc.name,
			"attached_to_field": "upload_file",
		}
	)
	file_doc.insert(ignore_permissions=True)
	frappe.db.set_value(REQ_DT, doc.name, {"upload_file": file_doc.file_url, "file_name": file_name, "file_type": mime}, update_modified=False)
	if lab:
		_notify(
			_lab_phone(lab),
			_("PhleboFirst: new request {0} from {1} for {2}. Quote it in the PhleboFirst app: {3}").format(
				doc.name, account.display_name, patient_name, f"{PF_APP_URL}/lab"
			),
		)
	return request_detail(doc.name, "customer")


def _customer_request(ctx, name):
	doc = frappe.get_doc(REQ_DT, name) if frappe.db.exists(REQ_DT, name) else None
	if not doc or doc.account != ctx.account.name:
		_missing(_("Request not found"))
	return doc


def my_requests(ctx, status=None, page=1, page_size=20):
	filters = {"account": ctx.account.name}
	if status == "active":
		filters["status"] = ("not in", ("Received At Lab", "Rejected", "Cancelled", "Expired"))
	elif status:
		filters["status"] = status
	page, size = max(1, cint(page) or 1), min(max(1, cint(page_size) or 20), 100)
	rows = frappe.get_all(
		REQ_DT,
		filters=filters,
		fields=["name", "status", "patient_name", "patient_age", "patient_gender", "assigned_lab", "pickup_area", "preferred_window_start", "submitted_on", "quotation", "job", "customer_trf"],
		order_by="creation desc",
		start=(page - 1) * size,
		limit=size,
	)
	for r in rows:
		r["lab_name"] = _lab_name(r.assigned_lab)
		r["grand_total"] = flt(frappe.db.get_value(QUOTE_DT, r.quotation, "grand_total")) if r.quotation else None
	return {"account": account_row(ctx.account), "rows": rows, "total": frappe.db.count(REQ_DT, filters), "page": page, "page_size": size}


def _quote_payload(name):
	if not name or not frappe.db.exists(QUOTE_DT, name):
		return None
	q = frappe.get_doc(QUOTE_DT, name)
	return {
		"name": q.name,
		"status": q.status,
		"lab": q.lab,
		"lab_name": _lab_name(q.lab),
		"items": [{"item_code": i.item_code, "item_name": i.item_name, "mrp": flt(i.mrp), "rate": flt(i.rate), "qty": cint(i.qty) or 1, "amount": flt(i.amount), "tube_hint": i.tube_hint} for i in q.items],
		"test_total": flt(q.test_total),
		"collection_fee": flt(q.collection_fee),
		"rider_payout": flt(q.rider_payout),
		"discount": flt(q.discount),
		"grand_total": flt(q.grand_total),
		"valid_until": q.valid_until,
		"authorised_by": q.authorised_by,
		"authorised_on": q.authorised_on,
		"notes": q.notes,
	}


def _timeline(doc):
	stamps = {"Uploaded": doc.submitted_on or doc.creation}
	for status, field in REQ_TIME_FIELDS.items():
		if status in REQ_FLOW:
			stamps[status] = doc.get(field)
	reached = REQ_FLOW.index(doc.status) if doc.status in REQ_FLOW else -1
	out = [{"status": s, "at": stamps.get(s), "done": i <= reached or bool(stamps.get(s))} for i, s in enumerate(REQ_FLOW)]
	if doc.status not in REQ_FLOW:
		out.append({"status": doc.status, "at": doc.closed_on, "done": True})
	return out


def _rider_card(job, reveal_phone=False):
	if not job or not job.rider:
		return None
	fp = frappe.db.get_value(FP_DT, job.rider, ["full_name", "mobile", "rating_avg", "vehicle_type"], as_dict=True) or {}
	out = {
		"name": fp.get("full_name"),
		"phone_masked": _mask_phone(fp.get("mobile")),
		"rating": flt(fp.get("rating_avg")) or None,
		"vehicle_type": fp.get("vehicle_type"),
		"eta_minutes": None,
		"distance_km": None,
		"location_at": None,
	}
	if reveal_phone:
		out["phone"] = fp.get("mobile")
	if job.status in ("Accepted", "Started") and job.rider_user:
		pos = _live_position(job.rider_user)
		if pos:
			d = _distance_km(pos[0], pos[1], job.pickup_lat, job.pickup_lng)
			out["distance_km"] = d
			out["eta_minutes"] = int(round(d / RIDER_SPEED_KMPH * 60)) if d is not None else None
			out["location_at"] = pos[2]
	return out


def request_detail(name, audience="customer"):
	doc = frappe.get_doc(REQ_DT, name)
	job = frappe.get_doc(JOB_DT, doc.job) if doc.job and frappe.db.exists(JOB_DT, doc.job) else None
	out = {
		"name": doc.name,
		"status": doc.status,
		"account": doc.account,
		"account_name": frappe.db.get_value(ACCOUNT_DT, doc.account, "display_name"),
		"account_type": doc.account_type,
		"assigned_lab": doc.assigned_lab,
		"lab_name": _lab_name(doc.assigned_lab),
		"payment_status": doc.payment_status,
		"patient": doc.patient,
		"universal_patient_id": doc.universal_patient_id,
		"patient_name": doc.patient_name,
		"patient_phone": doc.patient_phone,
		"patient_age": doc.patient_age,
		"patient_gender": doc.patient_gender,
		"has_file": bool(doc.upload_file),
		"file_name": doc.file_name,
		"file_type": doc.file_type,
		"suggested_tests": doc.suggested_tests,
		"notes": doc.notes,
		"pickup_address": doc.pickup_address,
		"pickup_area": doc.pickup_area,
		"pickup_lat": flt(doc.pickup_lat) or None,
		"pickup_lng": flt(doc.pickup_lng) or None,
		"preferred_window_start": doc.preferred_window_start,
		"preferred_window_end": doc.preferred_window_end,
		"status_reason": doc.status_reason,
		"customer_trf": doc.customer_trf,
		"submitted_on": doc.submitted_on or doc.creation,
		"quotation": _quote_payload(doc.quotation),
		"timeline": _timeline(doc),
		"can_cancel": doc.status in CUSTOMER_CANCELLABLE,
		"job": None,
		"rider": None,
	}
	if job:
		out["job"] = {
			"name": job.name,
			"status": job.status,
			"accepted_on": job.accepted_on,
			"started_on": job.started_on,
			"collected_on": job.collected_on,
			"dropped_on": job.dropped_on,
			"dropped_hub": job.dropped_hub,
			"sla_due": job.sla_due,
			"broadcast_round": cint(job.broadcast_round),
			"broadcast_radius_km": flt(job.broadcast_radius_km),
			"tube_count": cint(job.tube_count),
		}
		out["rider"] = _rider_card(job, reveal_phone=audience in ("lab", "admin"))
	if audience in ("lab", "admin"):
		out["ocr"] = json.loads(doc.ocr_json) if doc.ocr_json else None
		out["reviewed_by"] = doc.reviewed_by
		if doc.customer_trf and frappe.db.exists(TRF_DT, doc.customer_trf):
			out["trf"] = _trf_summary(doc.customer_trf)
	return out


def cancel_request(ctx, name, reason=None):
	doc = _customer_request(ctx, name)
	doc = _lock(REQ_DT, doc.name)
	if doc.status not in CUSTOMER_CANCELLABLE:
		_fail(_("A rider has already accepted this request; contact the lab to cancel"))
	_close_request(doc, "Cancelled", cstr(reason).strip()[:500] or _("Cancelled by customer"))
	return request_detail(doc.name, "customer")


def _close_request(doc, status, reason):
	"""Cancel / expire / reject: closes the job, offers, quotation and the TRF created for it."""
	if doc.job and frappe.db.exists(JOB_DT, doc.job):
		job_status = frappe.db.get_value(JOB_DT, doc.job, "status")
		if job_status in ("Open", "Accepted"):
			frappe.db.set_value(JOB_DT, doc.job, "status", "Expired" if status == "Expired" else "Cancelled")
			frappe.db.sql(
				f"update `tab{OFFER_DT}` set response = %s, responded_on = %s where job = %s and response = 'Pending'",
				("Lapsed" if status == "Expired" else "Withdrawn", now_datetime(), doc.job),
			)
	if doc.quotation and frappe.db.get_value(QUOTE_DT, doc.quotation, "status") in ("Draft", "Issued"):
		frappe.db.set_value(QUOTE_DT, doc.quotation, "status", "Expired" if status == "Expired" else "Cancelled")
	set_request_status(doc.name, status, {"status_reason": reason})
	if doc.customer_trf and frappe.db.get_value(TRF_DT, doc.customer_trf, "order_status") == "Booked":
		_set_trf_status(doc.customer_trf, "Cancelled")


def _set_trf_status(trf, status):
	from health_ecosystem_core.health_ecosystem_core.api import _apply_order_status

	res = _apply_order_status(trf, status) or {}
	if res.get("status") != "success":
		frappe.local.response.pop("http_status_code", None)
		frappe.log_error(title="phase133 TRF status", message=f"{trf} -> {status}: {res.get('message')}")
		return False
	return True


# ---------------------------------------------------------------------------
# Private upload download
# ---------------------------------------------------------------------------


def can_read_request(doc, user, roles):
	if roles & MANAGE_ROLES or user == "Administrator":
		return True
	if doc.customer_user == user:
		return True
	acc = account_for_user(user, roles, create=False)
	if acc and acc.name == doc.account:
		return True
	if roles & LAB_ROLES:
		labs = labs_for_user(user, roles)
		return labs is None or (doc.assigned_lab in labs)
	return False


# ---------------------------------------------------------------------------
# Lab authoriser
# ---------------------------------------------------------------------------


def lab_inbox(ctx, status=None, q=None, page=1, page_size=30):
	filters = {}
	if ctx.labs is not None:
		if not ctx.labs:
			return {"labs": [], "rows": [], "total": 0, "counts": {}}
		filters["assigned_lab"] = ("in", sorted(ctx.labs))
	if status == "pending" or not status:
		filters["status"] = ("in", ("Uploaded", "Under Review"))
	elif status == "active":
		filters["status"] = ("in", ("Quoted", "Broadcast", "Accepted", "En Route", "Collected", "Dropped At Hub"))
	elif status == "unassigned":
		if ctx.labs is not None:
			_deny(_("Only managers see unassigned requests"))
		filters = {"assigned_lab": ("is", "not set"), "status": ("in", ("Uploaded", "Under Review"))}
	elif status != "all":
		filters["status"] = status
	or_filters = None
	q = cstr(q).strip()
	if q:
		or_filters = [["patient_name", "like", f"%{q}%"], ["name", "like", f"%{q}%"], ["patient_phone", "like", f"%{q}%"]]
	page, size = max(1, cint(page) or 1), min(max(1, cint(page_size) or 30), 100)
	rows = frappe.get_all(
		REQ_DT,
		filters=filters,
		or_filters=or_filters,
		fields=["name", "status", "patient_name", "patient_age", "patient_gender", "account", "account_type", "assigned_lab", "pickup_area", "preferred_window_start", "preferred_window_end", "submitted_on", "suggested_tests", "job", "quotation"],
		order_by="creation asc" if status in (None, "", "pending") else "modified desc",
		start=(page - 1) * size,
		limit=size,
	)
	for r in rows:
		r["account_name"] = frappe.db.get_value(ACCOUNT_DT, r.account, "display_name")
		r["lab_name"] = _lab_name(r.assigned_lab)
		r["job_status"] = frappe.db.get_value(JOB_DT, r.job, "status") if r.job else None
	base = {"assigned_lab": filters["assigned_lab"]} if "assigned_lab" in filters and status != "unassigned" else {}
	counts = {
		"pending": frappe.db.count(REQ_DT, {**base, "status": ("in", ("Uploaded", "Under Review"))}),
		"active": frappe.db.count(REQ_DT, {**base, "status": ("in", ("Quoted", "Broadcast", "Accepted", "En Route", "Collected", "Dropped At Hub"))}),
	}
	labs = sorted(ctx.labs) if ctx.labs is not None else accepting_labs()
	total = len(frappe.get_all(REQ_DT, filters=filters, or_filters=or_filters, pluck="name", limit=0)) if or_filters else frappe.db.count(REQ_DT, filters)
	return {"labs": [{"lab": lab, "lab_name": _lab_name(lab)} for lab in labs], "rows": rows, "total": total, "counts": counts}


def open_request(ctx, name):
	doc = _lock(REQ_DT, name)
	if doc.assigned_lab:
		_assert_lab(ctx, doc.assigned_lab)
	elif ctx.labs is not None:
		_deny(_("This request has no lab yet"))
	if doc.status == "Uploaded":
		set_request_status(doc.name, "Under Review", {"reviewed_by": ctx.user})
	settings = lab_settings(doc.assigned_lab)
	out = request_detail(doc.name, "lab")
	fee = flt(_settings_value(settings, "default_collection_fee"))
	out["defaults"] = {
		"collection_fee": fee,
		"rider_payout_pct": flt(_settings_value(settings, "rider_payout_pct")),
		"rider_payout": round(fee * flt(_settings_value(settings, "rider_payout_pct")) / 100.0, 2),
		"quote_validity_hours": cint(_settings_value(settings, "quote_validity_hours")),
	}
	return out


def assign_request_lab(name, lab):
	doc = _lock(REQ_DT, name)
	if doc.status not in ("Uploaded", "Under Review"):
		_fail(_("Only requests waiting for review can be re-assigned"))
	if not lab or lab not in accepting_labs():
		_fail(_("Choose a lab that accepts PhleboFirst requests"))
	frappe.db.set_value(REQ_DT, doc.name, "assigned_lab", lab)
	return request_detail(doc.name, "admin")


def search_tests(q=None, limit=25):
	from health_ecosystem_core.health_ecosystem_core.api import LAB_ITEM_GROUPS
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import mrp_rate

	q = cstr(q).strip()
	if len(q) < 2:
		return {"items": []}
	limit = min(max(1, cint(limit) or 25), 50)
	or_filters = [["item_code", "like", f"%{q}%"], ["item_name", "like", f"%{q}%"]]
	filters = {"disabled": 0, "is_sales_item": 1}
	groups = [g for g in LAB_ITEM_GROUPS if frappe.db.exists("Item Group", g)]
	if groups:
		filters["item_group"] = ("in", groups)
	rows = frappe.get_all("Item", filters=filters, or_filters=or_filters, fields=["item_code", "item_name", "item_group"], limit=limit, order_by="item_name asc")
	return {"items": [{"item_code": r.item_code, "item_name": r.item_name, "item_group": r.item_group, "mrp": flt(mrp_rate(r.item_code))} for r in rows]}


def _tube_hint(item_code):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import _preferred_tube_reqs
		from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item

		master = find_test_master_for_item(item_code)
		reqs = _preferred_tube_reqs(frappe.get_doc("Diagnostic Test Master", master)) if master else []
		return ", ".join(sorted({cstr(r.tube) for r in reqs if r.tube})) or None
	except Exception:
		return None


def _quote_lines(items):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase54_franchisee_rate_model import mrp_rate

	items = _parse(items, [])
	if not isinstance(items, list) or not items:
		_fail(_("Add at least one test to the quotation"))
	lines, seen = [], set()
	for raw in items[:60]:
		if not isinstance(raw, dict):
			raw = {"item_code": raw}
		code = cstr(raw.get("item_code")).strip()
		if not code:
			continue
		if code in seen:
			_fail(_("{0} is listed twice").format(code))
		seen.add(code)
		item = frappe.db.get_value("Item", code, ["item_name", "disabled"], as_dict=True)
		if not item or cint(item.disabled):
			_fail(_("Test {0} not found").format(code))
		mrp = flt(mrp_rate(code))
		rate = flt(raw.get("rate")) if raw.get("rate") not in (None, "") else mrp
		qty = cint(raw.get("qty")) or 1
		if rate < 0 or qty < 1 or qty > 10:
			_fail(_("Check the rate / quantity of {0}").format(code))
		lines.append({"item_code": code, "item_name": item.item_name, "mrp": mrp, "rate": rate, "qty": qty, "amount": flt(rate * qty, 2), "tube_hint": _tube_hint(code)})
	if not lines:
		_fail(_("Add at least one test to the quotation"))
	return lines


def approve_request(ctx, name, items, collection_fee=None, rider_payout=None, discount=None, notes=None):
	doc = _lock(REQ_DT, name)
	_assert_lab(ctx, doc.assigned_lab)
	if not doc.assigned_lab:
		_fail(_("Assign a lab first"))
	if doc.status not in ("Uploaded", "Under Review"):
		_fail(_("Request {0} is already {1}").format(doc.name, doc.status))
	settings = lab_settings(doc.assigned_lab)
	if not settings or not cint(settings.accepts_pf):
		_fail(_("This lab is not accepting PhleboFirst requests"))
	resume = bool(doc.quotation and doc.customer_trf and frappe.db.exists(TRF_DT, doc.customer_trf))
	if resume:
		quote = frappe.get_doc(QUOTE_DT, doc.quotation)
		trf_name = doc.customer_trf
	else:
		lines = _quote_lines(items)
		fee = flt(collection_fee) if collection_fee not in (None, "") else flt(_settings_value(settings, "default_collection_fee"))
		payout = (
			flt(rider_payout)
			if rider_payout not in (None, "")
			else round(fee * flt(_settings_value(settings, "rider_payout_pct")) / 100.0, 2)
		)
		disc = max(0, flt(discount))
		test_total = flt(sum(l["amount"] for l in lines), 2)
		if fee < 0 or payout < 0:
			_fail(_("Fees cannot be negative"))
		if disc > test_total:
			_fail(_("Discount cannot exceed the test total"))
		quote = frappe.get_doc(
			{
				"doctype": QUOTE_DT,
				"request": doc.name,
				"lab": doc.assigned_lab,
				"status": "Issued",
				"items": lines,
				"test_total": test_total,
				"collection_fee": fee,
				"rider_payout": payout,
				"discount": disc,
				"grand_total": flt(test_total + fee - disc, 2),
				"valid_until": add_to_date(now_datetime(), hours=cint(_settings_value(settings, "quote_validity_hours")) or 24),
				"pickup_address": doc.pickup_address,
				"pickup_lat": doc.pickup_lat,
				"pickup_lng": doc.pickup_lng,
				"authorised_by": ctx.user,
				"authorised_on": now_datetime(),
				"notes": cstr(notes).strip()[:1000] or None,
			}
		)
		quote.insert(ignore_permissions=True)
		frappe.db.set_value(REQ_DT, doc.name, "quotation", quote.name)
		trf_name = create_pf_trf(doc, quote)
		frappe.db.set_value(REQ_DT, doc.name, "customer_trf", trf_name)
	trf = ensure_draw_plan(trf_name)
	set_request_status(doc.name, "Quoted", {"reviewed_by": doc.reviewed_by or ctx.user})
	job = _create_job(doc, quote, trf, settings)
	set_request_status(doc.name, "Broadcast", {"job": job.name})
	offers = broadcast_job(job.name)
	_notify(
		_customer_phone(doc),
		_("PhleboFirst: {0} approved request {1} for {2}. Total Rs {3} (incl. collection Rs {4}). We are assigning a phlebotomist. Track it: {5}").format(
			_lab_name(doc.assigned_lab), doc.name, doc.patient_name, flt(quote.grand_total), flt(quote.collection_fee), _request_url(doc.name)
		),
	)
	out = request_detail(doc.name, "lab")
	out["offers"] = len(offers)
	return out


def reject_request(ctx, name, reason):
	doc = _lock(REQ_DT, name)
	_assert_lab(ctx, doc.assigned_lab)
	reason = cstr(reason).strip()
	if len(reason) < 3:
		_fail(_("Give a reason for the rejection"))
	if doc.status not in ("Uploaded", "Under Review"):
		_fail(_("Request {0} is already {1}").format(doc.name, doc.status))
	_close_request(doc, "Rejected", reason[:500])
	frappe.db.set_value(REQ_DT, doc.name, "reviewed_by", ctx.user)
	_notify(_customer_phone(doc), _("PhleboFirst: request {0} for {1} was not accepted by the lab: {2}").format(doc.name, doc.patient_name, reason[:200]))
	return request_detail(doc.name, "lab")


def run_ocr(ctx, name):
	doc = frappe.get_doc(REQ_DT, name)
	_assert_lab(ctx, doc.assigned_lab)
	if not doc.upload_file:
		_fail(_("No file attached"))
	if cstr(doc.file_type) == "application/pdf":
		_fail(_("Test suggestions work on photos; read the PDF manually"))
	file_name = frappe.db.get_value("File", {"file_url": doc.upload_file}, "name")
	if not file_name:
		_missing(_("File not found"))
	content = frappe.get_doc("File", file_name).get_content()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase100_ai_practice import (
			OCR_SYSTEM,
			_chat_json,
			_fuzzy_match_items,
			_vision_ocr_text,
		)

		text, _status = _vision_ocr_text(base64.b64encode(content).decode(), mime=doc.file_type or "image/jpeg")
		if not text:
			_fail(_("Text recognition is unavailable right now"))
		parsed, _st = _chat_json(OCR_SYSTEM, text)
		diagnostics = []
		for row in (parsed or {}).get("diagnostics") or []:
			raw = cstr(row.get("raw_name")).strip()
			matches = [m for m in _fuzzy_match_items(raw, kind="diagnostic") if m.get("item")]
			diagnostics.append({"raw_name": raw, "matches": [{"item_code": m["item"], "test_name": m.get("test_name")} for m in matches]})
	except frappe.ValidationError:
		raise
	except Exception:
		frappe.log_error(title="phase133 OCR", message=frappe.get_traceback())
		_fail(_("Text recognition is unavailable right now"))
	result = {"text": cstr(text)[:4000], "diagnostics": diagnostics}
	frappe.db.set_value(REQ_DT, doc.name, "ocr_json", json.dumps(result), update_modified=False)
	return result


# ---------------------------------------------------------------------------
# Customer TRF (plain consumer booking; no circuit billing, no auto phlebotomist)
# ---------------------------------------------------------------------------


def create_pf_trf(req, quote):
	"""Customer TRF for an approved request. Deliberately not create_customer_trf_booking: that one prices with the
	session user's membership / promo, links the patient to the session user, auto-assigns the hub phlebotomist and
	sends the booking notification. Partner-circuit debits only happen in the bill-entry paths, never here."""
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import set_patient_link

	meta = frappe.get_meta(TRF_DT)
	tests = [{"item": i.item_code, "item_name": i.item_name, "qty": cint(i.qty) or 1, "rate": flt(i.rate), "amount": flt(i.amount)} for i in quote.items]
	account = frappe.db.get_value(ACCOUNT_DT, req.account, ["display_name", "account_type"], as_dict=True) or {}
	data = {
		"doctype": TRF_DT,
		"patient_name": req.patient_name,
		"age": cint(req.patient_age),
		"gender": req.patient_gender or "Other",
		"test_required": tests[0]["item"],
		"tests": tests,
		"franchisee_id": req.assigned_lab,
		"patient_phone": req.patient_phone,
		"collection_address": req.pickup_address,
		"collection_slot": req.preferred_window_start,
		"amount": flt(quote.test_total),
		"razorpay_payment_status": "Pending",
		"order_status": "Booked",
		"referred_doctor": account.get("display_name") if account.get("account_type") == "Doctor" else "Self",
	}
	optional = {
		PF_TRF_FIELD: req.name,
		"sample_intake_channel": "Home Collection",
		"hec_coll_charge": flt(quote.collection_fee),
		"collection_latitude": flt(req.pickup_lat) or None,
		"collection_longitude": flt(req.pickup_lng) or None,
		"universal_patient_id": req.universal_patient_id,
	}
	for key, value in optional.items():
		if value not in (None, "") and meta.has_field(key):
			data[key] = value
	set_patient_link(data, req.patient, TRF_DT)
	trf = frappe.get_doc(data)
	trf.flags.pf_booking = True
	if not cint(req.patient_age):
		trf.flags.ignore_mandatory = True
	trf.insert(ignore_permissions=True)
	if req.patient and not frappe.flags.pf_no_notify:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_journey import ensure_journey_for_patient, sync_journey_from_trf

			journey = ensure_journey_for_patient(req.patient, status="Diagnostics Booked")
			if journey and meta.has_field("care_journey"):
				frappe.db.set_value(TRF_DT, trf.name, "care_journey", journey, update_modified=False)
			sync_journey_from_trf(trf.name, "Booked")
		except Exception:
			frappe.log_error(title="phase133 TRF journey", message=frappe.get_traceback())
	return trf.name


def ensure_draw_plan(trf_name):
	"""Draw plan rows from the ordered tests (phase 89 aggregation), without re-importing DocTypes."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import build_draw_plan_for_trf

	if not _has_field(TRF_DT, "collection_tubes"):
		_fail(_("Collection draw plans are not installed (run setup_phase89)"))
	trf = frappe.get_doc(TRF_DT, trf_name)
	if not trf.collection_tubes:
		for row in build_draw_plan_for_trf(trf):
			trf.append("collection_tubes", row)
		trf.save(ignore_permissions=True)
	return trf


def _trf_summary(trf_name):
	trf = frappe.get_doc(TRF_DT, trf_name)
	return {
		"name": trf.name,
		"barcode": trf.unique_barcode,
		"order_status": trf.order_status,
		"payment_status": trf.razorpay_payment_status,
		"tubes": [_tube_row(r) for r in sorted(trf.get("collection_tubes") or [], key=lambda r: cint(r.clsi_draw_order))],
	}


def _tube_row(r):
	return {
		"row": r.name,
		"tube_code": r.tube_code,
		"cap_color": r.cap_color,
		"accession_id": r.accession_id,
		"volume_ml": flt(r.aggregated_volume_ml),
		"status": r.status,
		"linked_tests": r.linked_tests,
		"universal_barcode": r.get(UB_TUBE_FIELD),
		"drawn_at": r.drawn_at,
		"received_at": r.received_at,
	}


# ---------------------------------------------------------------------------
# Jobs, riders and broadcast
# ---------------------------------------------------------------------------


def _create_job(req, quote, trf, settings):
	if req.job and frappe.db.exists(JOB_DT, req.job):
		return frappe.get_doc(JOB_DT, req.job)
	now = now_datetime()
	sla = add_to_date(now, minutes=cint(_settings_value(settings, "sla_minutes")) or 60)
	if req.preferred_window_start:
		before_window = add_to_date(get_datetime(req.preferred_window_start), minutes=-15)
		if before_window > sla:
			sla = before_window
	job = frappe.get_doc(
		{
			"doctype": JOB_DT,
			"status": "Open",
			"request": req.name,
			"quotation": quote.name,
			"customer_trf": trf.name,
			"lab": req.assigned_lab,
			"pickup_area": req.pickup_area,
			"pickup_address": req.pickup_address,
			"pickup_lat": req.pickup_lat,
			"pickup_lng": req.pickup_lng,
			"window_start": req.preferred_window_start,
			"window_end": req.preferred_window_end,
			"collection_fee": flt(quote.collection_fee),
			"rider_payout": flt(quote.rider_payout),
			"tube_count": len(trf.get("collection_tubes") or []),
			"test_count": len(quote.items),
			"broadcast_round": 0,
			"sla_due": sla,
		}
	)
	job.insert(ignore_permissions=True)
	return job


def eligible_riders():
	providers = frappe.get_all(
		FP_DT,
		filters={"status": "Active", "is_phlebo_rider": 1},
		fields=["name", "user", "full_name", "mobile", "home_lat", "home_lng", "service_radius_km"],
		limit=0,
	)
	users = [p.user for p in providers if p.user]
	if not users:
		return []
	phlebos = set(frappe.get_all("Has Role", filters={"role": ROLE_PHLEBO, "parenttype": "User", "parent": ("in", users)}, pluck="parent"))
	enabled = set(frappe.get_all("User", filters={"name": ("in", users), "enabled": 1}, pluck="name"))
	return [p for p in providers if p.user in phlebos and p.user in enabled]


def _live_position(user):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import get_phlebotomist_location

		loc = get_phlebotomist_location(user) or {}
	except Exception:
		return None
	if not loc or not cint(loc.get("on_duty")) or not flt(loc.get("latitude")) or not flt(loc.get("longitude")):
		return None
	try:
		if get_datetime(loc.get("updated_at")) < add_to_date(now_datetime(), minutes=-LIVE_GPS_MAX_AGE_MIN):
			return None
	except Exception:
		return None
	return flt(loc["latitude"]), flt(loc["longitude"]), loc.get("updated_at")


def rider_position(provider, lat=None, lng=None):
	"""Explicit coordinates from the app, else fresh GPS from the phase 20 Redis store, else the rider's home."""
	if flt(lat) and flt(lng):
		return flt(lat), flt(lng), "device"
	live = _live_position(provider.get("user"))
	if live:
		return live[0], live[1], "live"
	if flt(provider.get("home_lat")) and flt(provider.get("home_lng")):
		return flt(provider.get("home_lat")), flt(provider.get("home_lng")), "home"
	return None


def broadcast_job(job_name, widen=False):
	"""Offer the job to eligible riders inside the current round's radius. Returns the new offer names."""
	job = frappe.get_doc(JOB_DT, job_name)
	if job.status != "Open":
		return []
	radii = _radii(lab_settings(job.lab))
	round_no = cint(job.broadcast_round)
	if round_no == 0 or widen:
		round_no = min(round_no + 1, len(radii))
	radius = radii[round_no - 1]
	existing = set(frappe.get_all(OFFER_DT, filters={"job": job.name}, pluck="rider"))
	created, notify = [], []
	has_pickup = bool(flt(job.pickup_lat) and flt(job.pickup_lng))
	for p in eligible_riders():
		if p.name in existing:
			continue
		distance = None
		if has_pickup:
			pos = rider_position(p)
			if not pos:
				continue
			distance = _distance_km(job.pickup_lat, job.pickup_lng, pos[0], pos[1])
			if distance is None or distance > radius:
				continue
		elif round_no > 1:
			continue
		offer = frappe.get_doc(
			{
				"doctype": OFFER_DT,
				"job": job.name,
				"rider": p.name,
				"rider_user": p.user,
				"response": "Pending",
				"broadcast_round": round_no,
				"distance_km": distance,
				"offered_on": now_datetime(),
				"offer_key": f"{job.name}::{p.name}",
			}
		)
		try:
			offer.insert(ignore_permissions=True)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			continue
		created.append(offer.name)
		notify.append((p.mobile, distance))
	frappe.db.set_value(JOB_DT, job.name, {"broadcast_round": round_no, "broadcast_radius_km": radius, "last_broadcast_on": now_datetime()})
	for phone, distance in notify:
		_notify(
			phone,
			_("PhleboFirst job near {0}{1}: earn Rs {2}. Accept it in the PhleboFirst app: {3}").format(
				job.pickup_area or _("you"), f" ({distance} km)" if distance is not None else "", flt(job.rider_payout), f"{PF_APP_URL}/jobs"
			),
		)
	return created


def rider_for_user(user, roles):
	if ROLE_PHLEBO not in roles:
		return None
	row = frappe.db.get_value(
		FP_DT,
		{"user": user},
		["name", "user", "full_name", "mobile", "status", "is_phlebo_rider", "home_lat", "home_lng", "service_radius_km"],
		as_dict=True,
	)
	if not row or row.status != "Active" or not cint(row.is_phlebo_rider):
		return None
	return row


def _job_card(job, rider, pos=None, offer=None, reveal=False):
	distance = _distance_km(pos[0], pos[1], job.pickup_lat, job.pickup_lng) if pos else None
	if distance is None and offer:
		distance = offer.get("distance_km")
	out = {
		"name": job.name,
		"status": job.status,
		"request": job.request,
		"lab": job.lab,
		"lab_name": _lab_name(job.lab),
		"pickup_area": job.pickup_area,
		"distance_km": distance,
		"window_start": job.window_start,
		"window_end": job.window_end,
		"collection_fee": flt(job.collection_fee),
		"rider_payout": flt(job.rider_payout),
		"tube_count": cint(job.tube_count),
		"test_count": cint(job.test_count),
		"sla_due": job.sla_due,
		"offered": bool(offer),
		"accepted_on": job.accepted_on,
		"started_on": job.started_on,
		"collected_on": job.collected_on,
		"dropped_on": job.dropped_on,
		"mine": bool(rider and job.rider == rider.name),
	}
	if reveal and out["mine"]:
		req = frappe.db.get_value(REQ_DT, job.request, ["patient_name", "patient_age", "patient_gender", "patient_phone", "notes"], as_dict=True) or {}
		out.update(
			{
				"patient_name": req.get("patient_name"),
				"patient_age": req.get("patient_age"),
				"patient_gender": req.get("patient_gender"),
				"notes": req.get("notes"),
				"pickup_lat": flt(job.pickup_lat) or None,
				"pickup_lng": flt(job.pickup_lng) or None,
			}
		)
		if job.status in ("Started", "Collected"):
			out["pickup_address"] = job.pickup_address
			out["patient_phone"] = req.get("patient_phone")
		else:
			out["patient_phone_masked"] = _mask_phone(req.get("patient_phone"))
	return out


def open_jobs(ctx, lat=None, lng=None):
	rider = ctx.rider
	pos = rider_position(rider, lat, lng)
	offers = {
		o.job: o
		for o in frappe.get_all(OFFER_DT, filters={"rider": rider.name}, fields=["job", "response", "distance_km"], limit=0)
	}
	rows = frappe.get_all(
		JOB_DT,
		filters={"status": "Open"},
		fields=["name", "status", "request", "lab", "pickup_area", "pickup_lat", "pickup_lng", "window_start", "window_end", "collection_fee", "rider_payout", "tube_count", "test_count", "sla_due", "broadcast_radius_km", "rider", "accepted_on", "started_on", "collected_on", "dropped_on"],
		order_by="creation asc",
		limit=200,
	)
	out = []
	for job in rows:
		offer = offers.get(job.name)
		if offer and offer.response in ("Declined", "Withdrawn"):
			continue
		card = _job_card(job, rider, pos, offer if offer and offer.response == "Pending" else None)
		if offer and offer.response == "Pending":
			out.append(card)
		elif card["distance_km"] is not None and card["distance_km"] <= flt(job.broadcast_radius_km):
			out.append(card)
	out.sort(key=lambda c: (c["distance_km"] if c["distance_km"] is not None else 9999, cstr(c["sla_due"])))
	return {"jobs": out, "position": {"lat": pos[0], "lng": pos[1], "source": pos[2]} if pos else None, "rider": _rider_profile(rider)}


def _rider_profile(rider):
	kit = frappe.db.get_value(KIT_DT, {"rider": rider.name, "status": "Issued"}, ["name", "issued_on"], as_dict=True)
	stock = frappe.get_all(UB_DT, filters={"rider": rider.name, "status": "Issued"}, fields=["tube_code", "count(name) as n"], group_by="tube_code")
	return {
		"name": rider.name,
		"full_name": rider.full_name,
		"mobile": rider.mobile,
		"service_radius_km": flt(rider.service_radius_km),
		"kit": kit.name if kit else None,
		"barcode_stock": {r.tube_code: cint(r.n) for r in stock},
		"active_jobs": frappe.db.count(JOB_DT, {"rider": rider.name, "status": ("in", JOB_ACTIVE)}),
	}


def _my_job(ctx, name, lock=False):
	doc = _lock(JOB_DT, name) if lock else (frappe.get_doc(JOB_DT, name) if frappe.db.exists(JOB_DT, name) else None)
	if not doc or doc.rider != ctx.rider.name:
		_missing(_("Job not found in your queue"))
	return doc


def accept_job(ctx, name, lat=None, lng=None):
	rider = ctx.rider
	rows = frappe.db.sql(f"select name, status, rider from `tab{JOB_DT}` where name = %s for update", (name,), as_dict=True)
	if not rows:
		_missing(_("Job not found"))
	row = rows[0]
	if row.status != "Open":
		if row.rider == rider.name and row.status in JOB_ACTIVE:
			return job_detail(ctx, name)
		_fail(_("Sorry, this job has already been taken by another rider"))
	job = frappe.get_doc(JOB_DT, name)
	offer = frappe.db.get_value(OFFER_DT, {"job": name, "rider": rider.name}, ["name", "response"], as_dict=True)
	if offer and offer.response in ("Declined", "Withdrawn"):
		_fail(_("You released this job earlier"))
	if not offer:
		pos = rider_position(rider, lat, lng)
		d = _distance_km(pos[0], pos[1], job.pickup_lat, job.pickup_lng) if pos else None
		if d is None or d > flt(job.broadcast_radius_km):
			_deny(_("This job is outside your area"))
	if frappe.db.count(JOB_DT, {"rider": rider.name, "status": ("in", JOB_ACTIVE)}) >= MAX_ACTIVE_JOBS:
		_fail(_("Finish your current jobs before accepting more (max {0})").format(MAX_ACTIVE_JOBS))
	now = now_datetime()
	frappe.db.set_value(JOB_DT, name, {"status": "Accepted", "rider": rider.name, "rider_user": rider.user, "accepted_on": now})
	if offer:
		frappe.db.set_value(OFFER_DT, offer.name, {"response": "Accepted", "responded_on": now})
	else:
		frappe.get_doc(
			{
				"doctype": OFFER_DT,
				"job": name,
				"rider": rider.name,
				"rider_user": rider.user,
				"response": "Accepted",
				"broadcast_round": cint(job.broadcast_round),
				"offered_on": now,
				"responded_on": now,
				"offer_key": f"{name}::{rider.name}",
			}
		).insert(ignore_permissions=True)
	frappe.db.sql(
		f"update `tab{OFFER_DT}` set response = 'Lapsed', responded_on = %s where job = %s and rider != %s and response = 'Pending'",
		(now, name, rider.name),
	)
	set_request_status(job.request, "Accepted")
	req = frappe.get_doc(REQ_DT, job.request)
	_notify(
		_customer_phone(req),
		_("PhleboFirst: {0} will collect the sample for {1} (request {2}).").format(rider.full_name or _("A phlebotomist"), req.patient_name, req.name),
	)
	return job_detail(ctx, name)


def release_job(ctx, name, reason=None):
	job = _my_job(ctx, name, lock=True)
	if job.status != "Accepted":
		_fail(_("You can only release a job before starting it"))
	now = now_datetime()
	frappe.db.set_value(JOB_DT, name, {"status": "Open", "rider": None, "rider_user": None, "accepted_on": None, "last_broadcast_on": now})
	frappe.db.set_value(OFFER_DT, {"job": name, "rider": ctx.rider.name}, {"response": "Declined", "responded_on": now})
	frappe.db.sql(f"update `tab{OFFER_DT}` set response = 'Pending', responded_on = null where job = %s and response = 'Lapsed'", (name,))
	set_request_status(job.request, "Broadcast", {"status_reason": cstr(reason).strip()[:500] or None})
	return {"name": name, "status": "Open"}


def start_job(ctx, name):
	job = _my_job(ctx, name, lock=True)
	if job.status == "Started":
		return job_detail(ctx, name)
	if job.status != "Accepted":
		_fail(_("Job {0} is {1}").format(name, job.status))
	frappe.db.set_value(JOB_DT, name, {"status": "Started", "started_on": now_datetime()})
	set_request_status(job.request, "En Route")
	req = frappe.get_doc(REQ_DT, job.request)
	_notify(_customer_phone(req), _("PhleboFirst: the phlebotomist is on the way for {0} (request {1}).").format(req.patient_name, req.name))
	return job_detail(ctx, name)


def job_draw_plan(ctx, name):
	job = _my_job(ctx, name)
	if not job.customer_trf:
		return []
	return _trf_summary(job.customer_trf)["tubes"]


def job_detail(ctx, name):
	job = frappe.get_doc(JOB_DT, name)
	if job.rider != ctx.rider.name:
		_missing(_("Job not found in your queue"))
	card = _job_card(job, ctx.rider, reveal=True)
	card["tubes"] = _trf_summary(job.customer_trf)["tubes"] if job.customer_trf else []
	card["trf"] = job.customer_trf
	card["dropped_hub"] = job.dropped_hub
	card["payout_entry"] = job.payout_entry
	card["navigate_url"] = (
		f"https://www.google.com/maps/dir/?api=1&destination={flt(job.pickup_lat)},{flt(job.pickup_lng)}"
		if flt(job.pickup_lat) and flt(job.pickup_lng) and job.status in ("Started", "Collected")
		else None
	)
	return card


def my_jobs(ctx):
	rider = ctx.rider
	fields = ["name", "status", "request", "lab", "pickup_area", "pickup_lat", "pickup_lng", "pickup_address", "window_start", "window_end", "collection_fee", "rider_payout", "tube_count", "test_count", "sla_due", "rider", "accepted_on", "started_on", "collected_on", "dropped_on"]
	active = frappe.get_all(JOB_DT, filters={"rider": rider.name, "status": ("in", JOB_ACTIVE)}, fields=fields, order_by="accepted_on asc", limit=50)
	recent = frappe.get_all(JOB_DT, filters={"rider": rider.name, "status": ("in", ("Dropped", "Received"))}, fields=fields, order_by="dropped_on desc", limit=20)
	return {
		"active": [_job_card(j, rider, reveal=True) for j in active],
		"recent": [_job_card(j, rider) for j in recent],
		"rider": _rider_profile(rider),
	}


def _barcode_row(code, lock=False):
	if lock:
		rows = frappe.db.sql(f"select name from `tab{UB_DT}` where name = %s for update", (code,))
		if not rows:
			return None
	return frappe.get_doc(UB_DT, code) if frappe.db.exists(UB_DT, code) else None


def _binding_problem(ctx, job, row, bc, settings):
	"""Why this barcode cannot be bound to this tube row, or None."""
	if not bc:
		return _("This barcode was never issued")
	if bc.status == "Bound":
		return _("This barcode is already bound to another tube") if bc.bound_tube_row != row.name else _("Already bound to this tube")
	if bc.status != "Issued":
		return _("This barcode is {0} and cannot be used").format(bc.status)
	if bc.kit:
		kit = frappe.db.get_value(KIT_DT, bc.kit, ["rider", "status"], as_dict=True) or {}
		if kit.get("rider") != ctx.rider.name or kit.get("status") != "Issued":
			return _("This barcode belongs to another rider's kit")
	elif bc.rider:
		if bc.rider != ctx.rider.name:
			return _("This barcode was issued to another rider")
	elif not cint(_settings_value(settings, "allow_unkitted_codes")):
		return _("Only barcodes from your issued kit can be used")
	if cstr(bc.tube_code) != cstr(row.tube_code):
		return _("Wrong tube: this label is for {0}, the draw plan needs {1}").format(bc.tube_code, row.tube_code)
	if row.get(UB_TUBE_FIELD):
		return _("This tube already has barcode {0}").format(row.get(UB_TUBE_FIELD))
	if row.status != "Planned":
		return _("This tube is already {0}").format(row.status)
	return None


def _tube_row_of(trf, row_name):
	for r in trf.get("collection_tubes") or []:
		if r.name == row_name:
			return r
	_missing(_("Tube {0} is not on this order's draw plan").format(row_name))


def check_barcode(ctx, job_name, tube_row, code):
	"""Dry run for live scanner feedback."""
	code, err = check_code(code, "PF")
	if err:
		return {"ok": False, "code": code, "error": err}
	job = _my_job(ctx, job_name)
	trf = frappe.get_doc(TRF_DT, job.customer_trf)
	row = _tube_row_of(trf, tube_row)
	problem = _binding_problem(ctx, job, row, _barcode_row(code), lab_settings(job.lab))
	return {"ok": not problem, "code": code, "error": problem, "tube_code": row.tube_code}


def binding_signature(code, trf, tube_row, rider, ts):
	message = f"{code}|{trf}|{tube_row}|{rider}|{ts}".encode()
	return hmac.new(custody_secret().encode(), message, hashlib.sha256).hexdigest()


def bind_barcode(ctx, job_name, tube_row, code, lat=None, lng=None, device_id=None):
	code = require_code(code, "PF")
	lat, lng = _coords(lat, lng)
	job = _my_job(ctx, job_name, lock=True)
	if job.status != "Started":
		_fail(_("Start the job before binding barcodes"))
	bc = _barcode_row(code, lock=True)
	trf = frappe.get_doc(TRF_DT, job.customer_trf)
	row = _tube_row_of(trf, tube_row)
	problem = _binding_problem(ctx, job, row, bc, lab_settings(job.lab))
	if problem:
		_fail(problem)
	now = now_datetime()
	signature = binding_signature(code, trf.name, row.name, ctx.rider.name, now.isoformat())
	row.set(UB_TUBE_FIELD, code)
	row.status = "Drawn"
	row.drawn_at = now
	trf.flags.pf_binding = True
	trf.save(ignore_permissions=True)
	frappe.db.set_value(
		UB_DT,
		code,
		{
			"status": "Bound",
			"rider": bc.rider or ctx.rider.name,
			"lab": job.lab,
			"bound_request": job.request,
			"bound_job": job.name,
			"bound_trf": trf.name,
			"bound_tube_row": row.name,
			"bound_accession": row.accession_id,
			"bound_on": now,
			"bound_by": ctx.user,
			"bound_lat": flt(lat),
			"bound_lng": flt(lng),
			"binding_signature": signature,
		},
	)
	record_scan_event(
		code,
		"Bound",
		code_type="Universal Barcode",
		actor_role=ROLE_PHLEBO,
		lat=lat,
		lng=lng,
		device_id=device_id,
		ref_doctype=TRF_DT,
		ref_name=trf.name,
		payload={"job": job.name, "tube_row": row.name, "tube_code": row.tube_code, "accession_id": row.accession_id, "signature": signature},
	)
	_emit(job.lab, "barcode.bound", code)
	return {"code": code, "tube": _tube_row(row), "tubes": _trf_summary(trf.name)["tubes"]}


def unbind_barcode(ctx, job_name, code, reason, device_id=None):
	code = require_code(code, "PF")
	reason = cstr(reason).strip()
	if len(reason) < 3:
		_fail(_("Say why the barcode is being removed"))
	job = _my_job(ctx, job_name, lock=True)
	if job.status not in ("Started", "Collected"):
		_fail(_("Barcodes can only be removed before the drop-off"))
	bc = _barcode_row(code, lock=True)
	if not bc or bc.status != "Bound" or bc.bound_job != job.name:
		_fail(_("{0} is not bound on this job").format(code))
	trf = frappe.get_doc(TRF_DT, job.customer_trf)
	row = _tube_row_of(trf, bc.bound_tube_row)
	if row.status not in ("Drawn", "Planned"):
		_fail(_("The tube is already {0}").format(row.status))
	row.set(UB_TUBE_FIELD, None)
	row.status = "Planned"
	row.drawn_at = None
	trf.save(ignore_permissions=True)
	frappe.db.set_value(
		UB_DT,
		code,
		{
			"status": "Issued",
			"lab": None,
			"bound_request": None,
			"bound_job": None,
			"bound_trf": None,
			"bound_tube_row": None,
			"bound_accession": None,
			"bound_on": None,
			"bound_by": None,
			"bound_lat": 0,
			"bound_lng": 0,
			"binding_signature": None,
		},
	)
	record_scan_event(
		code,
		"Exception",
		code_type="Universal Barcode",
		actor_role=ROLE_PHLEBO,
		device_id=device_id,
		ref_doctype=TRF_DT,
		ref_name=trf.name,
		payload={"action": "unbind", "reason": reason[:300], "job": job.name, "tube_row": row.name},
	)
	if job.status == "Collected":
		frappe.db.set_value(JOB_DT, job.name, {"status": "Started", "collected_on": None})
		set_request_status(job.request, "En Route")
	return {"code": code, "tubes": _trf_summary(trf.name)["tubes"]}


def mark_collected(ctx, job_name):
	job = _my_job(ctx, job_name, lock=True)
	if job.status == "Collected":
		return job_detail(ctx, job_name)
	if job.status != "Started":
		_fail(_("Job {0} is {1}").format(job_name, job.status))
	trf = frappe.get_doc(TRF_DT, job.customer_trf)
	tubes = [r for r in trf.get("collection_tubes") or [] if r.status != "Rejected"]
	pending = [r.tube_code for r in tubes if not r.get(UB_TUBE_FIELD) or r.status != "Drawn"]
	if not tubes or pending:
		_fail(_("Scan and bind every tube first: {0}").format(", ".join(pending) or _("no tubes on the draw plan")))
	frappe.db.set_value(JOB_DT, job.name, {"status": "Collected", "collected_on": now_datetime()})
	set_request_status(job.request, "Collected")
	if trf.order_status == "Booked":
		_set_trf_status(trf.name, "Sample Collected")
	return job_detail(ctx, job_name)


def hub_lookup(code):
	hub = hub_by_code(code)
	return {
		"hub_code": hub.hub_code,
		"hub_name": hub.hub_name,
		"address": hub.address,
		"lat": flt(hub.lat) or None,
		"lng": flt(hub.lng) or None,
		"geofence_m": cint(hub.geofence_m),
		"receiving_lab": hub.receiving_lab,
		"receiving_lab_name": _lab_name(hub.receiving_lab),
	}


def drop_at_hub(ctx, job_name, hub_code, codes, lat=None, lng=None, device_id=None):
	hub = hub_by_code(hub_code)
	lat, lng = _coords(lat, lng)
	codes = _parse(codes, []) if not isinstance(codes, list) else codes
	scanned = []
	for c in codes or []:
		code = require_code(c, "PF")
		if code not in scanned:
			scanned.append(code)
	job = _my_job(ctx, job_name, lock=True)
	if job.status == "Dropped":
		_fail(_("This job was already handed over at {0}").format(job.dropped_hub))
	if job.status != "Collected":
		_fail(_("Mark the sample collected before the drop-off"))
	bound = frappe.get_all(UB_DT, filters={"bound_job": job.name, "status": "Bound"}, pluck="name")
	missing = sorted(set(bound) - set(scanned))
	extra = sorted(set(scanned) - set(bound))
	if extra:
		_fail(_("{0} is not part of this job").format(", ".join(extra)))
	if not bound or missing:
		_fail(_("Scan every tube of this job: missing {0}").format(", ".join(missing) or _("all tubes")))
	distance_m = None
	warning = False
	if lat and lng and flt(hub.lat) and flt(hub.lng):
		distance_m = round((_distance_km(lat, lng, hub.lat, hub.lng) or 0) * 1000)
		warning = distance_m > (cint(hub.geofence_m) or 300)
	lab_mismatch = bool(hub.receiving_lab and hub.receiving_lab != job.lab)
	now = now_datetime()
	for code in bound:
		frappe.db.set_value(UB_DT, code, {"status": "Dropped", "drop_hub": hub.name, "dropped_on": now})
		record_scan_event(
			code,
			"Dropped At Hub",
			code_type="Universal Barcode",
			actor_role=ROLE_PHLEBO,
			location_doctype=HUB_DT,
			location_name=hub.name,
			lat=lat,
			lng=lng,
			device_id=device_id,
			ref_doctype=TRF_DT,
			ref_name=job.customer_trf,
			payload={"job": job.name, "distance_m": distance_m, "outside_geofence": warning},
		)
	frappe.db.set_value(
		JOB_DT, job.name, {"status": "Dropped", "dropped_hub": hub.name, "dropped_on": now, "drop_distance_m": distance_m, "drop_geofence_warning": 1 if warning else 0}
	)
	set_request_status(job.request, "Dropped At Hub")
	payout = accrue_payout(job.name)
	for code in bound:
		_emit(job.lab, "barcode.dropped", code)
	_notify(_lab_phone(job.lab), _("PhleboFirst: {0} tube(s) for request {1} dropped at {2}.").format(len(bound), job.request, hub.hub_name))
	out = job_detail(ctx, job_name)
	out.update({"geofence_warning": warning, "distance_m": distance_m, "hub_lab_mismatch": lab_mismatch, "payout": payout})
	return out


def accrue_payout(job_name):
	"""One Accrued Job Payout per job (idempotent)."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import post_payout

	job = frappe.get_doc(JOB_DT, job_name)
	existing = frappe.db.get_value(
		PAYOUT_DT, {"source_doctype": JOB_DT, "source_name": job.name, "entry_type": "Job Payout", "status": ("!=", "Reversed")}, ["name", "amount"], as_dict=True
	)
	if existing:
		return {"name": existing.name, "amount": flt(existing.amount), "created": False}
	if not job.rider or flt(job.rider_payout) <= 0:
		return None
	row = post_payout(
		{
			"provider": job.rider,
			"entry_type": "Job Payout",
			"amount": flt(job.rider_payout),
			"source_doctype": JOB_DT,
			"source_name": job.name,
			"remarks": f"PhleboFirst collection {job.request}",
		}
	)
	frappe.db.set_value(JOB_DT, job.name, "payout_entry", row["name"], update_modified=False)
	return {"name": row["name"], "amount": flt(row["amount"]), "created": True}


def my_earnings(ctx):
	rider = ctx.rider
	rows = frappe.get_all(
		PAYOUT_DT,
		filters={"provider": rider.name},
		fields=["name", "entry_type", "amount", "status", "source_doctype", "source_name", "period", "posted_on", "paid_ref"],
		order_by="posted_on desc",
		limit=100,
	)
	totals = frappe.get_all(PAYOUT_DT, filters={"provider": rider.name}, fields=["status", "sum(amount) as amount"], group_by="status")
	month = today()[:7]
	return {
		"rows": rows,
		"totals": {t.status: flt(t.amount) for t in totals},
		"this_month": flt(sum(flt(r.amount) for r in rows if r.period == month and r.status != "Reversed")),
		"jobs_done": frappe.db.count(JOB_DT, {"rider": rider.name, "status": ("in", ("Dropped", "Received"))}),
	}


# ---------------------------------------------------------------------------
# Lab receipt: code resolution + tube hooks (called from phase 89 / api.py)
# ---------------------------------------------------------------------------


def universal_for_code(code):
	"""PF universal code for a PF code or a lab LIS barcode mapped to one."""
	raw = cstr(code).strip()
	if not raw:
		return None
	if is_pf_code(raw):
		norm = raw.upper()
		return norm if frappe.db.exists(UB_DT, norm) else None
	if frappe.db.exists("DocType", MAP_DT):
		return frappe.db.get_value(MAP_DT, {"lis_barcode": raw}, "universal_barcode")
	return None


def resolve_trf_for_code(code):
	"""Customer TRF for a PF universal barcode or a mapped LIS barcode; None otherwise."""
	if not frappe.db.exists("DocType", UB_DT):
		return None
	universal = universal_for_code(code)
	if not universal:
		return None
	return frappe.db.get_value(UB_DT, universal, "bound_trf") or frappe.db.get_value(TUBE_DT, {UB_TUBE_FIELD: universal, "parenttype": TRF_DT}, "parent")


def on_trf_tube_received(trf_id, row):
	code = cstr(row.get(UB_TUBE_FIELD)) if row else ""
	if not code or not frappe.db.exists(UB_DT, code):
		return None
	bc = frappe.db.get_value(UB_DT, code, ["status", "lab", "bound_request", "bound_job"], as_dict=True)
	if bc.status == "Received":
		return None
	if bc.status not in ("Bound", "Dropped"):
		return None
	now = now_datetime()
	frappe.db.set_value(UB_DT, code, {"status": "Received", "received_on": now, "received_by": frappe.session.user})
	record_scan_event(
		code,
		"Received At Lab",
		code_type="Universal Barcode",
		actor_role="Lab",
		location_doctype=PROFILE_DT if bc.lab else None,
		location_name=bc.lab,
		ref_doctype=TRF_DT,
		ref_name=trf_id,
		payload={"accession_id": row.get("accession_id"), "tube_row": row.get("name")},
	)
	if bc.bound_request and frappe.db.get_value(REQ_DT, bc.bound_request, "status") in ("Collected", "Dropped At Hub"):
		set_request_status(bc.bound_request, "Received At Lab")
	if bc.bound_job and frappe.db.get_value(JOB_DT, bc.bound_job, "status") in ("Collected", "Dropped"):
		frappe.db.set_value(JOB_DT, bc.bound_job, {"status": "Received", "received_on": now})
	_emit(bc.lab, "barcode.received", code)
	return code


def on_trf_tube_rejected(trf_id, row, reason=None):
	code = cstr(row.get(UB_TUBE_FIELD)) if row else ""
	if not code or not frappe.db.exists(UB_DT, code):
		return None
	if frappe.db.get_value(UB_DT, code, "status") in ("Rejected", "Void"):
		return None
	frappe.db.set_value(UB_DT, code, {"status": "Rejected", "status_reason": cstr(reason)[:500] or None})
	record_scan_event(
		code,
		"Rejected",
		code_type="Universal Barcode",
		actor_role="Lab",
		ref_doctype=TRF_DT,
		ref_name=trf_id,
		payload={"reason": cstr(reason)[:300], "accession_id": row.get("accession_id")},
	)
	return code


# ---------------------------------------------------------------------------
# Ops: barcodes, kits, hubs, riders, settings, jobs board
# ---------------------------------------------------------------------------


def _tube_ok(tube_code):
	tube_code = cstr(tube_code).strip().upper()
	if not tube_code or not frappe.db.exists(TUBE_CATALOG_DT, tube_code):
		_fail(_("Unknown tube type {0}").format(tube_code))
	return tube_code


def issue_barcodes(tube_code, count, kit=None, rider=None, actor=None):
	tube_code = _tube_ok(tube_code)
	count = cint(count)
	if count < 1 or count > MAX_ISSUE:
		_fail(_("Issue between 1 and {0} barcodes at a time").format(MAX_ISSUE))
	if kit and not frappe.db.exists(KIT_DT, kit):
		_fail(_("Kit {0} not found").format(kit))
	if rider and not frappe.db.exists(FP_DT, rider):
		_fail(_("Rider {0} not found").format(rider))
	batch = f"{now_datetime().strftime('%Y%m%d%H%M%S')}-{frappe.generate_hash(length=4)}"
	codes = []
	for _i in range(count):
		seq, code = _next_code("PF", UB_DT)
		frappe.get_doc(
			{
				"doctype": UB_DT,
				"code": code,
				"seq": seq,
				"status": "Issued",
				"tube_code": tube_code,
				"kit": kit or None,
				"rider": rider or None,
				"issue_batch": batch,
				"issued_on": now_datetime(),
				"issued_by": actor or frappe.session.user,
			}
		).insert(ignore_permissions=True)
		record_scan_event(code, "Issued", code_type="Universal Barcode", actor_role="Ops", payload={"tube_code": tube_code, "kit": kit, "rider": rider, "batch": batch})
		codes.append(code)
	return {"codes": codes, "tube_code": tube_code, "batch": batch, "kit": kit, "rider": rider}


def issue_kit(rider, tubes, notes=None):
	if not rider or not frappe.db.exists(FP_DT, rider):
		_fail(_("Choose a rider"))
	if frappe.db.get_value(FP_DT, rider, "status") != "Active":
		_fail(_("The rider is not active"))
	tubes = _parse(tubes, {})
	if not isinstance(tubes, dict) or not tubes:
		_fail(_("Choose the tubes for the kit"))
	mix = {}
	for tube, n in tubes.items():
		n = cint(n)
		if n:
			mix[_tube_ok(tube)] = n
	if not mix or sum(mix.values()) > MAX_ISSUE:
		_fail(_("A kit holds 1 to {0} tubes").format(MAX_ISSUE))
	_seq, kit_code = _next_code("KIT", KIT_DT)
	kit = frappe.get_doc(
		{
			"doctype": KIT_DT,
			"kit_code": kit_code,
			"rider": rider,
			"status": "Issued",
			"issued_on": now_datetime(),
			"issued_by": frappe.session.user,
			"contents_json": json.dumps(mix),
			"notes": cstr(notes)[:500] or None,
		}
	)
	kit.insert(ignore_permissions=True)
	record_scan_event(kit_code, "Issued", code_type="Kit", actor_role="Ops", payload={"rider": rider, "contents": mix})
	codes = []
	for tube, n in mix.items():
		codes += issue_barcodes(tube, n, kit=kit_code, rider=rider)["codes"]
	return {"kit": kit_code, "rider": rider, "contents": mix, "codes": codes}


def print_codes(codes, fmt="pdf", size=None):
	codes = _parse(codes, []) if not isinstance(codes, list) else codes
	clean = []
	for c in codes:
		raw = cstr(c).strip().upper()
		kind = "HUB" if raw.startswith("HUB-") else "KIT" if raw.startswith("KIT-") else "PF"
		clean.append(require_code(raw, kind))
	captions = {}
	for code in clean:
		if code.startswith("PF-"):
			captions[code] = cstr(frappe.db.get_value(UB_DT, code, "tube_code") or "")
		elif code.startswith("HUB-"):
			captions[code] = cstr(frappe.db.get_value(HUB_DT, code, "hub_name") or "")[:30]
	return render_labels(clean, fmt, size, captions)


def list_barcodes(filters=None, page=1, page_size=50):
	f = _parse(filters, {})
	where = {k: f[k] for k in ("status", "tube_code", "kit", "rider", "lab") if f.get(k)}
	if f.get("q"):
		where["name"] = ("like", f"%{cstr(f['q']).strip().upper()}%")
	page, size = max(1, cint(page) or 1), min(max(1, cint(page_size) or 50), MAX_ISSUE)
	rows = frappe.get_all(
		UB_DT,
		filters=where,
		fields=["name", "status", "tube_code", "kit", "rider", "lab", "bound_trf", "bound_job", "bound_on", "drop_hub", "dropped_on", "received_on", "issued_on"],
		order_by="creation desc",
		start=(page - 1) * size,
		limit=size,
	)
	counts = frappe.get_all(UB_DT, filters={k: v for k, v in where.items() if k != "status"}, fields=["status", "count(name) as n"], group_by="status")
	return {"rows": rows, "total": frappe.db.count(UB_DT, where), "counts": {c.status: cint(c.n) for c in counts}}


def void_barcode(code, reason):
	code = require_code(code, "PF")
	bc = _barcode_row(code, lock=True)
	if not bc:
		_missing(_("Barcode not found"))
	if bc.status != "Issued":
		_fail(_("Only unused barcodes can be voided"))
	reason = cstr(reason).strip()
	if len(reason) < 3:
		_fail(_("Give a reason"))
	frappe.db.set_value(UB_DT, code, {"status": "Void", "status_reason": reason[:500]})
	record_scan_event(code, "Exception", code_type="Universal Barcode", actor_role="Ops", payload={"action": "void", "reason": reason[:300]})
	return {"code": code, "status": "Void"}


def list_kits(rider=None):
	where = {"rider": rider} if rider else {}
	rows = frappe.get_all(KIT_DT, filters=where, fields=["name", "rider", "status", "issued_on", "contents_json"], order_by="creation desc", limit=200)
	for r in rows:
		r["rider_name"] = frappe.db.get_value(FP_DT, r.rider, "full_name") if r.rider else None
		r["contents"] = json.loads(r.pop("contents_json") or "{}")
		r["unused"] = frappe.db.count(UB_DT, {"kit": r.name, "status": "Issued"})
	return {"rows": rows}


def save_hub(payload):
	p = payload
	name = cstr(p.get("name") or p.get("hub_code")).strip().upper()
	if name:
		doc = frappe.get_doc(HUB_DT, name)
	else:
		doc = frappe.new_doc(HUB_DT)
		_seq, doc.hub_code = _next_code("HUB", HUB_DT)
	for f in ("hub_name", "address", "hours", "franchisee", "collection_centre", "receiving_lab"):
		if f in p:
			doc.set(f, _str(cstr(p.get(f)).strip()))
	if "active" in p:
		doc.active = 1 if cint(p.get("active")) else 0
	if "geofence_m" in p:
		doc.geofence_m = min(max(cint(p.get("geofence_m")) or 300, 50), 5000)
	if "lat" in p or "lng" in p:
		doc.lat, doc.lng = _coords(p.get("lat"), p.get("lng"))
	if not cstr(doc.hub_name).strip():
		_fail(_("Hub name is required"))
	for link_field, dt in (("franchisee", PROFILE_DT), ("collection_centre", "B2B Collection Centre"), ("receiving_lab", PROFILE_DT)):
		if doc.get(link_field) and not frappe.db.exists(dt, doc.get(link_field)):
			_fail(_("{0} {1} not found").format(dt, doc.get(link_field)))
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return {**doc.as_dict(no_default_fields=True), "name": doc.name}


def list_hubs(include_inactive=1):
	where = {} if cint(include_inactive) else {"active": 1}
	rows = frappe.get_all(HUB_DT, filters=where, fields=["name", "hub_code", "hub_name", "active", "franchisee", "collection_centre", "receiving_lab", "address", "lat", "lng", "geofence_m", "hours"], order_by="hub_name asc", limit=500)
	for r in rows:
		r["receiving_lab_name"] = _lab_name(r.receiving_lab)
	return {"rows": rows}


def save_settings(payload):
	p = payload
	lab = cstr(p.get("lab")).strip()
	if not lab or not frappe.db.exists(PROFILE_DT, lab):
		_fail(_("Choose the lab"))
	if not is_lab_profile(lab):
		_fail(_("{0} is not a lab (needs has_lab, Orange FOCO tier or the mother lab)").format(lab))
	doc = frappe.get_doc(SETTINGS_DT, lab) if frappe.db.exists(SETTINGS_DT, lab) else frappe.get_doc({"doctype": SETTINGS_DT, "lab": lab, **SETTINGS_DEFAULTS})
	for f in SETTINGS_EDITABLE:
		if f not in p:
			continue
		value = p.get(f)
		if f in ("accepts_pf", "allow_unkitted_codes"):
			doc.set(f, 1 if cint(value) else 0)
		elif f in ("catchment_radius_km", "default_collection_fee", "rider_payout_pct"):
			doc.set(f, max(0, flt(value)))
		elif f in ("quote_validity_hours", "rebroadcast_minutes", "sla_minutes"):
			doc.set(f, max(1, cint(value)))
		elif f in ("lat", "lng"):
			continue
		else:
			doc.set(f, _str(cstr(value).strip()))
	if "lat" in p or "lng" in p:
		doc.lat, doc.lng = _coords(p.get("lat"), p.get("lng"))
	if flt(doc.rider_payout_pct) > 100:
		_fail(_("Rider payout cannot exceed 100% of the fee"))
	_radii_check = [x for x in re.split(r"[,\s]+", cstr(doc.broadcast_radii_km)) if x]
	if any(flt(x) <= 0 for x in _radii_check):
		_fail(_("Broadcast radii must be positive numbers, e.g. 5,10,20"))
	if doc.outbound_webhook_url and not cstr(doc.outbound_webhook_url).startswith("https://"):
		_fail(_("The webhook URL must use https://"))
	if doc.outbound_webhook_url and not doc.api_client:
		_fail(_("Outbound webhooks are signed with the lab's API client; link one first"))
	if doc.api_client:
		client_lab = frappe.db.get_value("HEC API Client", doc.api_client, "linked_lab")
		if client_lab != lab:
			_fail(_("The API client must be linked to this lab"))
	if doc.lis_barcode_format:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase133_pf_converter import render_lis_format

		render_lis_format(doc.lis_barcode_format, doc.lis_prefix, 1, "SST")
	if "authorisers" in p:
		doc.set("authorisers", [])
		for ident in p.get("authorisers") or []:
			user = _resolve_user(ident)
			if not user:
				_fail(_("No user found for {0}").format(cstr(ident)[:80]))
			doc.append("authorisers", {"user": user})
			_grant_role(user, ROLE_AUTHORISER)
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return settings_row(doc)


def settings_row(doc):
	out = {f: doc.get(f) for f in ("lab", "lab_name") + SETTINGS_EDITABLE}
	out["lis_next_seq"] = cint(doc.lis_next_seq)
	out["authorisers"] = [r.user for r in doc.authorisers]
	out["lab_lat"], out["lab_lng"] = lab_coords(doc.lab)
	return out


def list_settings():
	return {"rows": [settings_row(frappe.get_doc(SETTINGS_DT, n)) for n in frappe.get_all(SETTINGS_DT, pluck="name", order_by="lab asc")]}


def list_accounts(q=None):
	or_filters = None
	q = cstr(q).strip()
	if q:
		or_filters = [["display_name", "like", f"%{q}%"], ["mobile", "like", f"%{q}%"], ["name", "like", f"%{q}%"]]
	names = frappe.get_all(ACCOUNT_DT, or_filters=or_filters, pluck="name", order_by="modified desc", limit=200)
	return {"rows": [account_row(frappe.get_doc(ACCOUNT_DT, n)) for n in names]}


def list_riders(q=None):
	users = frappe.get_all("Has Role", filters={"role": ROLE_PHLEBO, "parenttype": "User"}, pluck="parent", limit=0)
	if not users:
		return {"rows": []}
	user_rows = frappe.get_all("User", filters={"name": ("in", users), "enabled": 1}, fields=["name", "full_name", "mobile_no"], limit=0)
	q = cstr(q).strip().lower()
	if q:
		user_rows = [u for u in user_rows if q in cstr(u.full_name).lower() or q in u.name.lower() or q in cstr(u.mobile_no)]
	fps = {
		r.user: r
		for r in frappe.get_all(FP_DT, filters={"user": ("in", [u.name for u in user_rows])}, fields=["name", "user", "status", "is_phlebo_rider", "home_lat", "home_lng", "service_radius_km", "mobile"], limit=0)
	}
	out = []
	for u in sorted(user_rows, key=lambda r: cstr(r.full_name)):
		fp = fps.get(u.name)
		out.append(
			{
				"user": u.name,
				"full_name": u.full_name,
				"mobile": (fp.mobile if fp else None) or u.mobile_no,
				"provider": fp.name if fp else None,
				"status": fp.status if fp else None,
				"is_rider": bool(fp and cint(fp.is_phlebo_rider) and fp.status == "Active"),
				"home_lat": flt(fp.home_lat) if fp else None,
				"home_lng": flt(fp.home_lng) if fp else None,
				"service_radius_km": flt(fp.service_radius_km) if fp else None,
				"active_jobs": frappe.db.count(JOB_DT, {"rider": fp.name, "status": ("in", JOB_ACTIVE)}) if fp else 0,
				"unused_barcodes": frappe.db.count(UB_DT, {"rider": fp.name, "status": "Issued"}) if fp else 0,
			}
		)
	return {"rows": out}


def enable_rider(user, enable=1, home_lat=None, home_lng=None, service_radius_km=None, mobile=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import save_field_provider

	if not user or not frappe.db.exists("User", user):
		_fail(_("User not found"))
	if ROLE_PHLEBO not in frappe.get_roles(user):
		_fail(_("Only Phlebotomist users can be PhleboFirst riders"))
	name = frappe.db.get_value(FP_DT, {"user": user}, "name")
	payload = {"name": name} if name else {"user": user}
	if cint(enable):
		payload.update({"is_phlebo_rider": 1, "status": "Active"})
	else:
		payload["is_phlebo_rider"] = 0
		if not name:
			_fail(_("{0} is not a rider").format(user))
		if not cint(frappe.db.get_value(FP_DT, name, "is_teleporter_runner")):
			payload["status"] = "Suspended"
			payload["is_phlebo_rider"] = 1
	lat, lng = _coords(home_lat, home_lng)
	if lat is not None:
		payload.update({"home_lat": lat, "home_lng": lng})
	if service_radius_km not in (None, ""):
		payload["service_radius_km"] = max(1, flt(service_radius_km))
	if mobile:
		payload["mobile"] = _clean_phone(mobile)
	return save_field_provider(payload)


def jobs_board(filters=None, page=1, page_size=50):
	f = _parse(filters, {})
	where = {}
	if f.get("status"):
		where["status"] = f["status"]
	elif not f.get("all"):
		where["status"] = ("in", ("Open", "Accepted", "Started", "Collected", "Dropped"))
	if f.get("lab"):
		where["lab"] = f["lab"]
	page, size = max(1, cint(page) or 1), min(max(1, cint(page_size) or 50), 200)
	rows = frappe.get_all(
		JOB_DT,
		filters=where,
		fields=["name", "status", "request", "lab", "pickup_area", "window_start", "window_end", "collection_fee", "rider_payout", "tube_count", "broadcast_round", "broadcast_radius_km", "sla_due", "rider", "accepted_on", "started_on", "collected_on", "dropped_on", "dropped_hub", "drop_geofence_warning", "creation"],
		order_by="creation desc",
		start=(page - 1) * size,
		limit=size,
	)
	for r in rows:
		r["lab_name"] = _lab_name(r.lab)
		r["rider_name"] = frappe.db.get_value(FP_DT, r.rider, "full_name") if r.rider else None
		r["offers"] = frappe.db.count(OFFER_DT, {"job": r.name})
		r["overdue"] = bool(r.status == "Open" and r.sla_due and get_datetime(r.sla_due) < now_datetime())
	counts = frappe.get_all(JOB_DT, fields=["status", "count(name) as n"], group_by="status")
	req_counts = frappe.get_all(REQ_DT, fields=["status", "count(name) as n"], group_by="status")
	return {
		"rows": rows,
		"total": frappe.db.count(JOB_DT, where),
		"job_counts": {c.status: cint(c.n) for c in counts},
		"request_counts": {c.status: cint(c.n) for c in req_counts},
		"unassigned_requests": frappe.db.count(REQ_DT, {"assigned_lab": ("is", "not set"), "status": ("in", ("Uploaded", "Under Review"))}),
	}


def list_lab_jobs(ctx):
	where = {"status": ("in", ("Open", "Accepted", "Started", "Collected", "Dropped"))}
	if ctx.labs is not None:
		if not ctx.labs:
			return {"rows": []}
		where["lab"] = ("in", sorted(ctx.labs))
	return jobs_board(json.dumps({"status": where["status"], **({"lab": where["lab"]} if "lab" in where else {})}))


# ---------------------------------------------------------------------------
# Notifications + outbound events
# ---------------------------------------------------------------------------


def _customer_phone(req):
	phone = frappe.db.get_value(ACCOUNT_DT, req.account, "mobile") if req.account else None
	if not phone and req.customer_user:
		phone = frappe.db.get_value("User", req.customer_user, "mobile_no")
	return phone


def _lab_phone(lab):
	return frappe.db.get_value(PROFILE_DT, lab, "contact_phone") if lab else None


def _request_url(name):
	return f"{PF_APP_URL}/requests/{cstr(name)}"


def _notify(phone, message):
	if frappe.flags.pf_no_notify or not phone or not message:
		return
	try:
		frappe.enqueue(f"{MODULE_PATH}.pf_send_whatsapp_job", queue="short", enqueue_after_commit=True, phone=cstr(phone), text=cstr(message))
	except Exception:
		frappe.log_error(title="phase133 notify enqueue", message=frappe.get_traceback())


def pf_send_whatsapp_job(phone=None, text=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		send_whatsapp(phone, text, context={"source": "phlebofirst"})
	except Exception:
		frappe.log_error(title="phase133 WhatsApp", message=frappe.get_traceback())


def _emit(lab, event, code):
	if not lab:
		return
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase133_pf_converter import queue_outbound_event

		queue_outbound_event(lab, event, code)
	except Exception:
		frappe.log_error(title="phase133 outbound event", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


def _expire_job(job_name):
	job = frappe.get_doc(JOB_DT, job_name)
	if job.status != "Open":
		return False
	req = frappe.get_doc(REQ_DT, job.request)
	if req.status in ("Quoted", "Broadcast"):
		_close_request(req, "Expired", _("No phlebotomist accepted in time"))
	else:
		frappe.db.set_value(JOB_DT, job.name, "status", "Expired")
	msg = _("PhleboFirst: no phlebotomist was available for request {0} ({1}). Please re-submit or contact the lab.").format(req.name, req.patient_name)
	_notify(_customer_phone(req), msg)
	_notify(_lab_phone(job.lab), msg)
	return True


def pf_rebroadcast_and_expire(only=None, webhooks=1):
	"""Every 2 minutes: widen the radius of Open jobs by rounds, expire jobs past their SLA, retry outbound webhooks.
	`only` (job names) and webhooks=0 let the smoke test run it without touching live jobs or calling partner URLs."""
	if not frappe.db.exists("DocType", JOB_DT):
		return {"skipped": "not installed"}
	report = {"widened": 0, "offers": 0, "expired": 0, "webhooks": 0, "errors": 0}
	now = now_datetime()
	filters = {"status": "Open"}
	if only:
		filters["name"] = ("in", list(only))
	for job in frappe.get_all(JOB_DT, filters=filters, fields=["name", "lab", "sla_due", "last_broadcast_on", "broadcast_round"], limit=500):
		try:
			if job.sla_due and get_datetime(job.sla_due) <= now:
				if _expire_job(job.name):
					report["expired"] += 1
			else:
				settings = lab_settings(job.lab)
				every = cint(_settings_value(settings, "rebroadcast_minutes")) or 5
				due = not job.last_broadcast_on or add_to_date(get_datetime(job.last_broadcast_on), minutes=every) <= now
				if due and cint(job.broadcast_round) < len(_radii(settings)):
					report["offers"] += len(broadcast_job(job.name, widen=True))
					report["widened"] += 1
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase133 rebroadcast", message=f"{job.name}\n{frappe.get_traceback()}")
	if not cint(webhooks):
		return report
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase133_pf_converter import retry_outbound_webhooks

		report["webhooks"] = retry_outbound_webhooks()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase133 webhook retry", message=frappe.get_traceback())
	return report


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _context(access, user, roles):
	ctx = frappe._dict(user=user, roles=roles, account=None, rider=None, labs=None)
	if access == "customer":
		ctx.account = account_for_user(user, roles, create=True)
		if not ctx.account:
			_deny(_("This login is not linked to a PhleboFirst customer account"))
	elif access == "lab":
		if not roles & LAB_ROLES:
			_deny(_("Lab authoriser access required"))
		ctx.labs = labs_for_user(user, roles)
	elif access == "rider":
		ctx.rider = rider_for_user(user, roles)
		if not ctx.rider:
			_deny(_("You are not an active PhleboFirst rider; ask operations to enable you"))
	elif access == "manage":
		if not roles & MANAGE_ROLES:
			_deny(_("Admin access required"))
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


@frappe.whitelist(allow_guest=True)
def pf_me(sid=None):
	"""Which PhleboFirst surfaces this login can use."""

	def run(ctx):
		roles = ctx.roles
		account = account_for_user(ctx.user, roles, create=False)
		rider = rider_for_user(ctx.user, roles)
		labs = labs_for_user(ctx.user, roles) if roles & LAB_ROLES else set()
		return {
			"user": ctx.user,
			"customer": account_row(account) if account else None,
			"can_customer": bool(account) or ROLE_FRANCHISEE in roles,
			"rider": _rider_profile(rider) if rider else None,
			"lab_authoriser": bool(roles & LAB_ROLES) and (labs is None or bool(labs)),
			"labs": None if labs is None else [{"lab": lab, "lab_name": _lab_name(lab)} for lab in sorted(labs)],
			"manager": bool(roles & MANAGE_ROLES),
		}

	return _run(sid, "user", run, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_create_request(payload=None, sid=None):
	return _run(sid, "customer", lambda ctx: create_request(ctx, _parse(payload)), message=_("Request submitted"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_my_requests(status=None, page=1, page_size=20, sid=None):
	return _run(sid, "customer", lambda ctx: my_requests(ctx, status, page, page_size), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_request_detail(name=None, sid=None):
	return _run(sid, "customer", lambda ctx: request_detail(_customer_request(ctx, name).name, "customer"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_cancel_request(name=None, reason=None, sid=None):
	return _run(sid, "customer", lambda ctx: cancel_request(ctx, name, reason), message=_("Request cancelled"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_request_file(name=None, sid=None):
	"""Streams the private TRF / prescription upload to the customer, the assigned lab or operations."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	if not name or not frappe.db.exists(REQ_DT, name):
		return _error(_("Request not found"), 404)
	doc = frappe.get_doc(REQ_DT, name)
	if not can_read_request(doc, user, roles):
		return _error(_("Not permitted"), 403)
	file_name = frappe.db.get_value("File", {"file_url": doc.upload_file, "attached_to_doctype": REQ_DT, "attached_to_name": doc.name}, "name") if doc.upload_file else None
	if not file_name:
		return _error(_("File not found"), 404)
	file_doc = frappe.get_doc("File", file_name)
	frappe.local.response.filename = doc.file_name or file_doc.file_name
	frappe.local.response.filecontent = file_doc.get_content()
	frappe.local.response.type = "download"
	frappe.local.response.display_content_as = "inline"


@frappe.whitelist(allow_guest=True)
def pf_lab_inbox(status=None, q=None, page=1, page_size=30, sid=None):
	return _run(sid, "lab", lambda ctx: lab_inbox(ctx, status, q, page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_open_request(name=None, sid=None):
	return _run(sid, "lab", lambda ctx: open_request(ctx, name), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_request_ocr(name=None, sid=None):
	return _run(sid, "lab", lambda ctx: run_ocr(ctx, name), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_search_tests(q=None, limit=25, sid=None):
	return _run(sid, "lab", lambda ctx: search_tests(q, limit))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_approve_request(name=None, items=None, collection_fee=None, rider_payout=None, discount=None, notes=None, sid=None):
	return _run(
		sid,
		"lab",
		lambda ctx: approve_request(ctx, name, items, collection_fee, rider_payout, discount, notes),
		message=_("Approved and broadcast to riders"),
		commit=True,
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_reject_request(name=None, reason=None, sid=None):
	return _run(sid, "lab", lambda ctx: reject_request(ctx, name, reason), message=_("Request rejected"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_lab_jobs(sid=None):
	return _run(sid, "lab", lambda ctx: list_lab_jobs(ctx))


@frappe.whitelist(allow_guest=True)
def pf_open_jobs(lat=None, lng=None, sid=None):
	return _run(sid, "rider", lambda ctx: open_jobs(ctx, lat, lng))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_accept_job(name=None, lat=None, lng=None, sid=None):
	return _run(sid, "rider", lambda ctx: accept_job(ctx, name, lat, lng), message=_("Job accepted"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_release_job(name=None, reason=None, sid=None):
	return _run(sid, "rider", lambda ctx: release_job(ctx, name, reason), message=_("Job released"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_my_jobs(sid=None):
	return _run(sid, "rider", my_jobs)


@frappe.whitelist(allow_guest=True)
def pf_job_detail(name=None, sid=None):
	return _run(sid, "rider", lambda ctx: job_detail(ctx, name))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_start_job(name=None, sid=None):
	return _run(sid, "rider", lambda ctx: start_job(ctx, name), message=_("Job started"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_job_draw_plan(name=None, sid=None):
	return _run(sid, "rider", lambda ctx: {"tubes": job_draw_plan(ctx, name)})


@frappe.whitelist(allow_guest=True)
def pf_check_barcode(name=None, tube_row=None, code=None, sid=None):
	return _run(sid, "rider", lambda ctx: check_barcode(ctx, name, tube_row, code))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_bind_barcode(name=None, tube_row=None, code=None, lat=None, lng=None, device_id=None, sid=None):
	return _run(sid, "rider", lambda ctx: bind_barcode(ctx, name, tube_row, code, lat, lng, device_id), message=_("Barcode bound"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_unbind_barcode(name=None, code=None, reason=None, device_id=None, sid=None):
	return _run(sid, "rider", lambda ctx: unbind_barcode(ctx, name, code, reason, device_id), message=_("Barcode removed"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_mark_collected(name=None, sid=None):
	return _run(sid, "rider", lambda ctx: mark_collected(ctx, name), message=_("Sample collected"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_hub_lookup(code=None, sid=None):
	return _run(sid, "rider", lambda ctx: hub_lookup(code))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_drop_at_hub(name=None, hub_code=None, codes=None, lat=None, lng=None, device_id=None, sid=None):
	return _run(sid, "rider", lambda ctx: drop_at_hub(ctx, name, hub_code, codes, lat, lng, device_id), message=_("Handed over at the hub"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_my_earnings(sid=None):
	return _run(sid, "rider", my_earnings)


@frappe.whitelist(allow_guest=True)
def pf_ops_dashboard(filters=None, page=1, page_size=50, sid=None):
	return _run(sid, "manage", lambda ctx: jobs_board(filters, page, page_size))


@frappe.whitelist(allow_guest=True)
def pf_ops_requests(status=None, q=None, page=1, page_size=30, sid=None):
	return _run(sid, "manage", lambda ctx: lab_inbox(frappe._dict(labs=None), status or "all", q, page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_assign_lab(name=None, lab=None, sid=None):
	return _run(sid, "manage", lambda ctx: assign_request_lab(name, lab), message=_("Lab assigned"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_accounts_list(q=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_accounts(q))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_account_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_account(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_lab_settings_list(sid=None):
	return _run(sid, "manage", lambda ctx: list_settings())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_lab_settings_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_settings(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_hubs_list(include_inactive=1, sid=None):
	return _run(sid, "manage", lambda ctx: list_hubs(include_inactive))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_hub_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_hub(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_issue_barcodes(tube_code=None, count=None, kit=None, rider=None, sid=None):
	return _run(sid, "manage", lambda ctx: issue_barcodes(tube_code, count, kit, rider, ctx.user), message=_("Barcodes issued"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_print_codes(codes=None, fmt="pdf", size=None, sid=None):
	return _run(sid, "manage", lambda ctx: print_codes(codes, fmt, size))


@frappe.whitelist(allow_guest=True)
def pf_barcodes_list(filters=None, page=1, page_size=50, sid=None):
	return _run(sid, "manage", lambda ctx: list_barcodes(filters, page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_void_barcode(code=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: void_barcode(code, reason), message=_("Barcode voided"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_issue_kit(rider=None, tubes=None, notes=None, sid=None):
	return _run(sid, "manage", lambda ctx: issue_kit(rider, tubes, notes), message=_("Kit issued"), commit=True)


@frappe.whitelist(allow_guest=True)
def pf_kits_list(rider=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_kits(rider))


@frappe.whitelist(allow_guest=True)
def pf_riders_list(q=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_riders(q))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def pf_rider_enable(user=None, enable=1, home_lat=None, home_lng=None, service_radius_km=None, mobile=None, sid=None):
	return _run(sid, "manage", lambda ctx: enable_rider(user, enable, home_lat, home_lng, service_radius_km, mobile), message=_("Saved"), commit=True)


def smoke_phase133():
	"""Throwaway end-to-end PhleboFirst + converter checks; everything is rolled back. Returns {checks, passed, total, ok}."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase133_pf_smoke import run_smoke

	return run_smoke()
