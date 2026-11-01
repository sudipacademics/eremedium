"""Phase 134 — Teleporter: cold-chain icebox logistics between collection centers and testing labs (teleports.in).

Teleporter is its own app with its own parties: any center or lab signs up on teleports.in with an OTP-verified mobile
(Teleporter Center / Teleporter Lab, status Pending Approval), operations approve it (role granted), map the center to one
authorised lab (Collection To Lab Mapping) and activate a tiered icebox subscription. Remedium franchises / labs can be
linked optionally (linked_franchisee / linked_remedium_lab); that is the only coupling to the diagnostic core.

- The icebox (RI carrier code, Mod 11-2 check character) is the unit of shipment; the sample list on a Shipment Manifest
  is optional free text.
- Origin scan (center): icebox + runner badge -> custody Dispatched + Picked Up (HMAC chain of phase 132),
  PENDING_PICKUP -> IN_TRANSIT_WITH_RUNNER.
- Destination scan (authorised lab): the icebox must arrive at the mapped lab from the mapped center, otherwise an
  Exception custody event is written and the scan is refused. On success: Received At Lab, transit TAT, temperature check.
- Only for a lab linked to a Remedium lab: sample codes that resolve to Remedium TRF tubes are sealed while in transit
  (receive_trf_tube refuses them) and unlocked by the destination scan. PhleboFirst universal barcodes only get their
  custody chain extended (soft hook; never blocks a shipment).

Scheduler jobs here run in worker containers, so module-level imports stay limited to frappe, api helpers,
clinical_barcodes and phase 132.
"""

from __future__ import annotations

import json
import re
import secrets
from typing import NoReturn

import frappe
from frappe import _
from frappe.utils import (
	add_days,
	add_months,
	add_to_date,
	cint,
	cstr,
	flt,
	getdate,
	now_datetime,
	time_diff_in_seconds,
	today,
)

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import (
	CHECK_MOD11,
	code128_svg,
	get_prefix,
	make_code,
	parse_code,
	register_prefix,
	render_labels,
	validate_code,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	CUSTODY_DT,
	FP_DT,
	_ensure_doctype,
	_perms,
	_sel,
	custody_events,
	custody_secret,
	record_scan_event,
	verify_chain,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter"
EXPIRE_JOB = f"{MODULE_PATH}.tp_expire_subscriptions"
OVERDUE_JOB = f"{MODULE_PATH}.tp_overdue_transit_alerts"
SCHEDULED_JOBS = ((EXPIRE_JOB, "30 0 * * *"), (OVERDUE_JOB, "*/15 * * * *"))
APP_URL = "https://teleports.in"

CENTER_DT = "Teleporter Center"
LAB_DT = "Teleporter Lab"
PARTY_USER_DT = "Teleporter Party User"
TIER_DT = "Icebox Tier"
ICEBOX_DT = "Icebox Asset"
SUB_DT = "Teleporter Subscription"
SUB_BOX_DT = "Teleporter Subscription Icebox"
MAP_DT = "Collection To Lab Mapping"
MANIFEST_DT = "Shipment Manifest"
SAMPLE_DT = "Shipment Manifest Sample"

PROFILE_DT = "Franchisee Profile"
TRF_DT = "Customer TRF"
TUBE_DT = "TRF Collection Tube"
PARTNER_SHIP_DT = "Partner Sample Shipment"

ROLE_CENTER = "Teleporter Center User"
ROLE_LAB = "Teleporter Lab User"
ROLE_RUNNER = "Teleporter Runner"
ROLE_MANAGER = "Teleporter Manager"
TP_ROLES = (ROLE_CENTER, ROLE_LAB, ROLE_RUNNER, ROLE_MANAGER)
MANAGE_ROLES = frozenset({"System Manager", "Health System Admin", "Administrator", ROLE_MANAGER})
LAB_STAFF_ROLES = frozenset({"Lab Technician", "Lab Manager"})
# Roles a mobile-OTP Teleporter login may carry; any other role (staff, partner, desk) must use its password.
OTP_LOGIN_ROLES = frozenset({ROLE_CENTER, ROLE_LAB, ROLE_RUNNER, "Patient", "Phlebotomist", "All", "Guest", "Desk User"})

PARTY_STATUSES = ("Pending Approval", "Active", "Suspended", "Rejected")
SIGNUP_SOURCES = ("Self Sign-up", "Operations")
CENTER_TYPES = ("Collection Centre", "Clinic", "Hospital", "Diagnostic Centre", "Pharmacy", "Franchise", "Other")
LAB_TYPES = ("Diagnostic Lab", "Hospital Lab", "Reference Lab", "Other")
PARTY = {
	"center": frappe._dict(
		kind="center", dt=CENTER_DT, name_field="center_name", link_field="linked_franchisee", role=ROLE_CENTER, types=CENTER_TYPES, label="center"
	),
	"lab": frappe._dict(kind="lab", dt=LAB_DT, name_field="lab_name", link_field="linked_remedium_lab", role=ROLE_LAB, types=LAB_TYPES, label="lab"),
}
SIGNUP_IP_LIMIT = 10
SIGNUP_MOBILE_LIMIT = 5
USER_EMAIL_DOMAIN = "teleporter.local"

TIER_CODES = ("TIER_1", "TIER_2", "TIER_3")
ICEBOX_PREFIX = "RI"
ICEBOX_SERIES = "TPRI-SEQ-"
ICEBOX_STATUSES = ("In Stock", "Assigned", "At Collection Point", "In Transit", "At Lab", "Maintenance", "Retired")
OPS_ICEBOX_STATUSES = ("In Stock", "Maintenance", "Retired")
BILLING_CYCLES = {"Monthly": 1, "Quarterly": 3, "Yearly": 12}
SUB_STATUSES = ("Pending Payment", "Active", "Paused", "Expired", "Cancelled")
SUB_OPEN = ("Pending Payment", "Active", "Paused")
SUB_TRANSITIONS = {"Active": {"Paused", "Cancelled"}, "Paused": {"Active", "Cancelled"}, "Pending Payment": {"Cancelled"}}
PAYMENT_MODES = ("Cash", "Bank Transfer", "UPI", "Cheque", "Waived")

ST_PENDING = "PENDING_PICKUP"
ST_TRANSIT = "IN_TRANSIT_WITH_RUNNER"
ST_RECEIVED = "RECEIVED_AT_LAB"
ST_CANCELLED = "CANCELLED"
ST_EXCEPTION = "EXCEPTION"
MANIFEST_STATUSES = (ST_PENDING, ST_TRANSIT, ST_RECEIVED, ST_CANCELLED, ST_EXCEPTION)
OPEN_STATUSES = (ST_PENDING, ST_TRANSIT)
SAMPLE_STATUSES = ("Pending", "Sealed", "Unlocked", "Accessioned", "Missing", "Rejected")

MAX_REGISTER = 200
MAX_SAMPLES = 200
SAMPLE_CODE_RE = re.compile(r"^[A-Za-z0-9._:/#-]{1,140}$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
PINCODE_RE = re.compile(r"^\d{6}$")
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
SMOKE_TAG = "P134SMK"

if not get_prefix(ICEBOX_PREFIX):
	register_prefix(ICEBOX_PREFIX, "Icebox", 6, CHECK_MOD11)


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
	return [p for p in re.split(r"[\s,;]+", text) if p]


def _str(value):
	return cstr(value) if value not in (None, "") else None


def _hhmm(value):
	if value in (None, ""):
		return None
	parts = cstr(value).split(":")
	if len(parts) < 2 or not parts[0].strip().isdigit():
		return None
	return f"{int(parts[0]):02d}:{parts[1][:2]}"


def _time_in(value, label):
	text = cstr(value).strip()
	if not text:
		return None
	m = TIME_RE.match(text)
	if not m:
		_fail(_("{0} must look like 09:30").format(label))
	return f"{int(m.group(1)):02d}:{m.group(2)}:00"


def _date_in(value):
	return getdate(value) if value not in (None, "") else None


def _temp_value(value):
	if value in (None, ""):
		return None
	temp = flt(value, 2)
	if temp < -80 or temp > 60:
		_fail(_("Temperature {0} °C is not plausible").format(value))
	return temp


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
	if not frappe.db.sql(f"select name from `tab{doctype}` where name = %s for update", (name,)):
		_missing(_("{0} {1} not found").format(doctype, name))


def _clear_messages():
	try:
		frappe.clear_messages()
	except Exception:
		pass


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _party_fields(name_field, label, types, link_field, link_label, link_desc):
	return [
		{"fieldname": name_field, "label": f"{label} Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_global_search": 1},
		{"fieldname": "party_type", "label": "Type", "fieldtype": "Select", "options": _sel(types), "in_list_view": 1, "in_standard_filter": 1},
		{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(PARTY_STATUSES), "default": "Pending Approval", "in_list_view": 1, "in_standard_filter": 1},
		{"fieldname": "contact_person", "label": "Contact Person", "fieldtype": "Data"},
		{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "search_index": 1, "in_list_view": 1},
		{"fieldname": "email", "label": "Email", "fieldtype": "Data"},
		{"fieldname": "address_section", "label": "Address", "fieldtype": "Section Break"},
		{"fieldname": "address", "label": "Address", "fieldtype": "Small Text"},
		{"fieldname": "city", "label": "City", "fieldtype": "Data", "in_standard_filter": 1},
		{"fieldname": "pincode", "label": "Pincode", "fieldtype": "Data"},
		{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6"},
		{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6"},
		{"fieldname": "gstin", "label": "GSTIN", "fieldtype": "Data"},
		{"fieldname": "remedium_section", "label": "Remedium Link (optional)", "fieldtype": "Section Break"},
		{"fieldname": link_field, "label": link_label, "fieldtype": "Link", "options": PROFILE_DT, "description": link_desc},
		{"fieldname": "approval_section", "label": "Approval", "fieldtype": "Section Break"},
		{"fieldname": "signup_source", "label": "Signup Source", "fieldtype": "Select", "options": _sel(SIGNUP_SOURCES), "default": "Self Sign-up", "read_only": 1},
		{"fieldname": "approved_by", "label": "Approved By", "fieldtype": "Link", "options": "User", "read_only": 1},
		{"fieldname": "approved_on", "label": "Approved On", "fieldtype": "Datetime", "read_only": 1},
		{"fieldname": "rejection_reason", "label": "Rejection / Suspension Reason", "fieldtype": "Small Text"},
		{"fieldname": "users_section", "label": "Users", "fieldtype": "Section Break"},
		{"fieldname": "users", "label": "Users", "fieldtype": "Table", "options": PARTY_USER_DT},
		{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
	]


def _doctype_specs():
	managers = ("System Manager", "Health System Admin", ROLE_MANAGER)
	center_ref = {"fieldname": "collection_point_id", "label": "Center", "fieldtype": "Link", "options": CENTER_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1}
	center_name = {"fieldname": "collection_point_name", "label": "Center Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1}
	return [
		(
			PARTY_USER_DT,
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
			CENTER_DT,
			_party_fields(
				"center_name",
				"Center",
				CENTER_TYPES,
				"linked_franchisee",
				"Linked Remedium Franchise",
				"Set when this center is a Remedium franchise (enables partner-circuit shipment records).",
			),
			_perms(managers, ()),
			0,
			"TPC-.#####",
			{"title_field": "center_name", "search_fields": "mobile,city"},
		),
		(
			LAB_DT,
			_party_fields(
				"lab_name",
				"Lab",
				LAB_TYPES,
				"linked_remedium_lab",
				"Linked Remedium Lab",
				"Set when this lab is a Remedium lab (has own lab, Orange FOCO or the mother lab): enables the accession lock.",
			),
			_perms(managers, ()),
			0,
			"TPL-.#####",
			{"title_field": "lab_name", "search_fields": "mobile,city"},
		),
		(
			TIER_DT,
			[
				{"fieldname": "tier", "label": "Tier", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "label", "label": "Label", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "capacity_tubes", "label": "Capacity (tubes)", "fieldtype": "Int", "in_list_view": 1},
				{"fieldname": "temp_min_c", "label": "Min Temperature (°C)", "fieldtype": "Float", "precision": "1"},
				{"fieldname": "temp_max_c", "label": "Max Temperature (°C)", "fieldtype": "Float", "precision": "1"},
				{"fieldname": "hold_hours", "label": "Hold Time (hours)", "fieldtype": "Float", "precision": "1"},
				{"fieldname": "monthly_price", "label": "Monthly Price", "fieldtype": "Currency"},
				{"fieldname": "deposit", "label": "Deposit", "fieldtype": "Currency"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, ()),
			0,
			"field:tier",
			{"naming_rule": "By fieldname", "title_field": "label"},
		),
		(
			SAMPLE_DT,
			[
				{"fieldname": "sample_code", "label": "Scanned Code", "fieldtype": "Data", "in_list_view": 1, "search_index": 1},
				{"fieldname": "accession_id", "label": "Accession ID", "fieldtype": "Data", "in_list_view": 1, "search_index": 1},
				{"fieldname": "universal_barcode", "label": "PhleboFirst Barcode", "fieldtype": "Data"},
				{"fieldname": "customer_trf", "label": "Remedium TRF", "fieldtype": "Link", "options": TRF_DT, "search_index": 1},
				{"fieldname": "trf_tube_row", "label": "TRF Tube Row", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "tube_code", "label": "Tube", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "patient_name", "label": "Patient", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "locked", "label": "Accession Lock", "fieldtype": "Check", "default": "0", "read_only": 1, "in_list_view": 1},
				{"fieldname": "sample_status", "label": "Status", "fieldtype": "Select", "options": _sel(SAMPLE_STATUSES), "default": "Pending", "in_list_view": 1},
				{"fieldname": "unverified", "label": "Free Code", "fieldtype": "Check", "default": "0", "read_only": 1},
				{"fieldname": "validation_note", "label": "Note", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "accessioned_at", "label": "Accessioned At", "fieldtype": "Datetime", "read_only": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			ICEBOX_DT,
			[
				{"fieldname": "carrier_code", "label": "Carrier Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "read_only": 1, "in_list_view": 1},
				{"fieldname": "tier", "label": "Tier", "fieldtype": "Link", "options": TIER_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(ICEBOX_STATUSES), "default": "In Stock", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "assigned_runner", "label": "Assigned Runner", "fieldtype": "Link", "options": FP_DT, "in_standard_filter": 1},
				{"fieldname": "assigned_runner_name", "label": "Runner Name", "fieldtype": "Data", "fetch_from": "assigned_runner.full_name", "read_only": 1},
				{"fieldname": "subscription", "label": "Subscription", "fieldtype": "Link", "options": SUB_DT, "in_standard_filter": 1},
				{**center_ref, "reqd": 0, "read_only": 1, "in_list_view": 0},
				center_name,
				{"fieldname": "holder_type", "label": "Current Holder Type", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "holder_name", "label": "Current Holder", "fieldtype": "Dynamic Link", "options": "holder_type", "read_only": 1},
				{"fieldname": "last_temp_c", "label": "Last Temperature (°C)", "fieldtype": "Float", "precision": "1", "read_only": 1},
				{"fieldname": "last_temp_at", "label": "Last Temperature At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "last_scan_event", "label": "Last Scan", "fieldtype": "Link", "options": CUSTODY_DT, "read_only": 1},
				{"fieldname": "last_scan_at", "label": "Last Scan At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"field:carrier_code",
			{"naming_rule": "By fieldname"},
		),
		(
			SUB_BOX_DT,
			[
				{"fieldname": "icebox", "label": "Icebox", "fieldtype": "Link", "options": ICEBOX_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "tier", "label": "Tier", "fieldtype": "Data", "fetch_from": "icebox.tier", "read_only": 1, "in_list_view": 1},
			],
			[],
			1,
			"hash",
			None,
		),
		(
			SUB_DT,
			[
				center_ref,
				center_name,
				{"fieldname": "tier", "label": "Icebox Tier", "fieldtype": "Link", "options": TIER_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(SUB_STATUSES), "default": "Pending Payment", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "billing_cycle", "label": "Billing Cycle", "fieldtype": "Select", "options": _sel(BILLING_CYCLES), "default": "Monthly"},
				{"fieldname": "amount", "label": "Amount per Cycle", "fieldtype": "Currency"},
				{"fieldname": "start_date", "label": "Start Date", "fieldtype": "Date", "reqd": 1},
				{"fieldname": "end_date", "label": "End Date", "fieldtype": "Date"},
				{"fieldname": "auto_renew", "label": "Auto Renew", "fieldtype": "Check", "default": "0"},
				{"fieldname": "pickup_window_start", "label": "Daily Pickup From", "fieldtype": "Time"},
				{"fieldname": "pickup_window_end", "label": "Daily Pickup Until", "fieldtype": "Time"},
				{"fieldname": "status_reason", "label": "Status Reason", "fieldtype": "Small Text"},
				{"fieldname": "payment_section", "label": "Payment", "fieldtype": "Section Break"},
				{"fieldname": "payment_mode", "label": "Payment Mode", "fieldtype": "Select", "options": "\n" + _sel(PAYMENT_MODES)},
				{"fieldname": "payment_ref", "label": "Payment Reference", "fieldtype": "Data"},
				{"fieldname": "amount_paid", "label": "Amount Paid", "fieldtype": "Currency"},
				{"fieldname": "paid_on", "label": "Paid On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "activated_by", "label": "Activated By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "payment_intent", "label": "Payment Intent", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "boxes_section", "label": "Iceboxes", "fieldtype": "Section Break"},
				{"fieldname": "iceboxes", "label": "Iceboxes", "fieldtype": "Table", "options": SUB_BOX_DT},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"TPS-.YYYY.-.#####",
			{"title_field": "collection_point_name"},
		),
		(
			MAP_DT,
			[
				center_ref,
				center_name,
				{"fieldname": "authorized_receiving_lab_id", "label": "Authorised Receiving Lab", "fieldtype": "Link", "options": LAB_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "lab_name", "label": "Lab Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "effective_from", "label": "Effective From", "fieldtype": "Date"},
				{"fieldname": "effective_to", "label": "Effective To", "fieldtype": "Date"},
				{"fieldname": "default_runner", "label": "Default Runner", "fieldtype": "Link", "options": FP_DT},
				{"fieldname": "default_runner_name", "label": "Runner Name", "fieldtype": "Data", "fetch_from": "default_runner.full_name", "read_only": 1},
				{"fieldname": "expected_tat_minutes", "label": "Expected Transit TAT (minutes)", "fieldtype": "Int"},
				{"fieldname": "active_key", "label": "Active Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			0,
			"TPMAP-.#####",
			{"title_field": "collection_point_name"},
		),
		(
			MANIFEST_DT,
			[
				{"fieldname": "manifest_date", "label": "Manifest Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(MANIFEST_STATUSES), "default": ST_PENDING, "in_list_view": 1, "in_standard_filter": 1},
				center_ref,
				center_name,
				{"fieldname": "receiving_lab", "label": "Receiving Lab", "fieldtype": "Link", "options": LAB_DT, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "receiving_lab_name", "label": "Receiving Lab Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "remedium_lab", "label": "Remedium Lab (accession lock)", "fieldtype": "Link", "options": PROFILE_DT, "read_only": 1},
				{"fieldname": "mapping", "label": "Mapping", "fieldtype": "Link", "options": MAP_DT, "read_only": 1},
				{"fieldname": "subscription", "label": "Subscription", "fieldtype": "Link", "options": SUB_DT, "read_only": 1},
				{"fieldname": "icebox", "label": "Icebox", "fieldtype": "Link", "options": ICEBOX_DT, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "icebox_tier", "label": "Icebox Tier", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "runner", "label": "Runner", "fieldtype": "Link", "options": FP_DT, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "runner_name", "label": "Runner Name", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "pickup_window_start", "label": "Pickup From", "fieldtype": "Time", "read_only": 1},
				{"fieldname": "pickup_window_end", "label": "Pickup Until", "fieldtype": "Time", "read_only": 1},
				{"fieldname": "seal_no", "label": "Seal No.", "fieldtype": "Data"},
				{"fieldname": "transit_section", "label": "Transit", "fieldtype": "Section Break"},
				{"fieldname": "origin_scan_event", "label": "Origin Scan (Dispatched)", "fieldtype": "Link", "options": CUSTODY_DT, "read_only": 1},
				{"fieldname": "pickup_scan_event", "label": "Runner Pickup Scan", "fieldtype": "Link", "options": CUSTODY_DT, "read_only": 1},
				{"fieldname": "destination_scan_event", "label": "Destination Scan", "fieldtype": "Link", "options": CUSTODY_DT, "read_only": 1},
				{"fieldname": "dispatched_at", "label": "Dispatched At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "dispatched_by", "label": "Dispatched By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "received_at", "label": "Received At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "received_by", "label": "Received By", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "expected_tat_minutes", "label": "Expected TAT (minutes)", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "transit_tat_minutes", "label": "Transit TAT (minutes)", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "tat_breached", "label": "TAT Breached", "fieldtype": "Check", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "temp_out_c", "label": "Temperature Out (°C)", "fieldtype": "Float", "precision": "1", "read_only": 1},
				{"fieldname": "temp_out_set", "label": "Temperature Out Recorded", "fieldtype": "Check", "read_only": 1, "hidden": 1},
				{"fieldname": "temp_in_c", "label": "Temperature In (°C)", "fieldtype": "Float", "precision": "1", "read_only": 1},
				{"fieldname": "temp_in_set", "label": "Temperature In Recorded", "fieldtype": "Check", "read_only": 1, "hidden": 1},
				{"fieldname": "temp_excursion", "label": "Temperature Excursion", "fieldtype": "Check", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "overdue_alerted_at", "label": "Overdue Alert Sent", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "exception_count", "label": "Exceptions", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "last_exception", "label": "Last Exception", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "partner_shipment", "label": "Partner Sample Shipment", "fieldtype": "Link", "options": PARTNER_SHIP_DT, "read_only": 1},
				{"fieldname": "cancel_reason", "label": "Cancel / Exception Reason", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "samples_section", "label": "Samples (optional)", "fieldtype": "Section Break"},
				{"fieldname": "sample_count", "label": "Samples", "fieldtype": "Int", "read_only": 1, "in_list_view": 1},
				{"fieldname": "samples", "label": "Samples", "fieldtype": "Table", "options": SAMPLE_DT},
			],
			_perms(managers, (), delete=0),
			0,
			"TPM-.YYYY.-.#####",
			{"title_field": "collection_point_name", "sort_field": "creation", "sort_order": "DESC"},
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
	for role, desk in ((ROLE_CENTER, 0), (ROLE_LAB, 0), (ROLE_RUNNER, 0), (ROLE_MANAGER, 1)):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk}).insert(ignore_permissions=True)
			created.append(role)
	return created


def ensure_tp_setup():
	created = _ensure_roles()
	specs = _doctype_specs()
	for name, fields, perms, istable, autoname, extra in specs:
		if _ensure_doctype(name, _links_resolvable(fields), perms, istable=istable, autoname=autoname, extra=extra):
			created.append(name)
	for name, fields, perms, istable, autoname, extra in specs:
		_ensure_doctype(name, _links_resolvable(fields), perms, istable=istable, autoname=autoname, extra=extra)
	return created


def _ensure_ready():
	if not frappe.db.exists("DocType", MANIFEST_DT) or not _has_field(MANIFEST_DT, "remedium_lab") or not _has_field(SUB_DT, "iceboxes"):
		ensure_tp_setup()
		frappe.db.commit()


def seed_tiers():
	"""The three tier rows with blank specs and prices: operations fill them in."""
	created = []
	for idx, code in enumerate(TIER_CODES, start=1):
		if not frappe.db.exists(TIER_DT, code):
			frappe.get_doc({"doctype": TIER_DT, "tier": code, "label": f"Tier {idx}", "active": 1}).insert(ignore_permissions=True)
			created.append(code)
	return created


def sync_runner_roles():
	granted = []
	for row in frappe.get_all(FP_DT, filters={"is_teleporter_runner": 1, "status": "Active"}, fields=["user"], limit=0):
		if row.user and frappe.db.exists("User", row.user) and ROLE_RUNNER not in frappe.get_roles(row.user):
			frappe.get_doc("User", row.user).add_roles(ROLE_RUNNER)
			granted.append(row.user)
	return granted


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


def setup_phase134():
	"""Idempotent: roles, Teleporter DocTypes, tier rows, icebox prefix, runner roles, scheduled jobs."""
	created = ensure_tp_setup()
	frappe.db.commit()
	tiers = seed_tiers()
	runners = sync_runner_roles()
	custody_secret()
	out = {
		"ok": True,
		"created": created,
		"tiers_seeded": tiers,
		"tiers": frappe.db.count(TIER_DT),
		"icebox_prefix": get_prefix(ICEBOX_PREFIX),
		"runner_roles_granted": runners,
		"scheduler_jobs": ensure_scheduler_jobs(),
	}
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# Remedium links (optional)
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
	return _has_field(PROFILE_DT, "partner_tier") and cstr(frappe.db.get_value(PROFILE_DT, lab, "partner_tier")).strip() == "Orange FOCO"


def _profile_name(fid):
	return (frappe.db.get_value(PROFILE_DT, fid, "franchise_name") or fid) if fid else None


def remedium_lab_of(lab):
	"""The Remedium lab behind a Teleporter Lab, or None."""
	linked = frappe.db.get_value(LAB_DT, lab, "linked_remedium_lab") if lab else None
	return linked if linked and is_lab_profile(linked) else None


# ---------------------------------------------------------------------------
# Parties: Teleporter Center / Teleporter Lab
# ---------------------------------------------------------------------------


def _kind(kind):
	k = PARTY.get(cstr(kind).strip().lower())
	if not k:
		_fail(_("Kind must be center or lab"))
	return k


def party_status(kind, name):
	return frappe.db.get_value(_kind(kind).dt, name, "status") if name else None


def party_display(kind, name):
	k = _kind(kind)
	return (frappe.db.get_value(k.dt, name, k.name_field) or name) if name else None


def _party_users(kind, name):
	return frappe.get_all(
		PARTY_USER_DT, filters={"parent": name, "parenttype": _kind(kind).dt}, fields=["user", "full_name", "mobile", "active"], order_by="idx asc", limit=0
	)


def party_payload(kind, name):
	k = _kind(kind)
	doc = frappe.get_doc(k.dt, name)
	linked = doc.get(k.link_field)
	has_point = bool(flt(doc.lat) or flt(doc.lng))
	return {
		"kind": k.kind,
		"name": doc.name,
		"display_name": doc.get(k.name_field),
		"party_type": doc.party_type,
		"contact_person": doc.contact_person,
		"mobile": doc.mobile,
		"email": doc.email,
		"address": doc.address,
		"city": doc.city,
		"pincode": doc.pincode,
		"gstin": doc.gstin,
		"lat": flt(doc.lat, 6) if has_point else None,
		"lng": flt(doc.lng, 6) if has_point else None,
		"status": doc.status,
		"signup_source": doc.signup_source,
		"linked_remedium": linked,
		"linked_remedium_name": _profile_name(linked),
		"remedium_linked": bool(linked and (k.kind == "center" or is_lab_profile(linked))),
		"approved_by": doc.approved_by,
		"approved_on": _str(doc.approved_on),
		"rejection_reason": doc.rejection_reason,
		"users": [{"user": u.user, "full_name": u.full_name, "mobile": u.mobile, "active": cint(u.active)} for u in _party_users(k.kind, doc.name)],
		"notes": doc.notes,
		"creation": _str(doc.creation),
	}


def party_card(kind, name):
	k = _kind(kind)
	row = frappe.db.get_value(k.dt, name, ["name", k.name_field, "status", k.link_field], as_dict=True)
	linked = row.get(k.link_field)
	return {
		"kind": k.kind,
		"id": row.name,
		"name": row.get(k.name_field),
		"status": row.status,
		"remedium_linked": bool(linked and (k.kind == "center" or is_lab_profile(linked))),
	}


def parties_for_user(kind, user, active_only=False):
	k = _kind(kind)
	if not user or user == "Guest" or not frappe.db.exists("DocType", k.dt):
		return []
	names = frappe.get_all(PARTY_USER_DT, filters={"user": user, "parenttype": k.dt, "active": 1}, pluck="parent", limit=0)
	if not names:
		return []
	filters = {"name": ("in", list(set(names)))}
	if active_only:
		filters["status"] = "Active"
	return sorted(frappe.get_all(k.dt, filters=filters, pluck="name", limit=0))


def _user_ctx():
	"""Run user / DocType writes as Administrator (Guest sign-up cannot create Users through core hooks)."""
	previous = frappe.session.user
	frappe.set_user("Administrator")
	return previous


def ensure_party_user(mobile, full_name=None, email=None):
	"""Existing login for this mobile, else a new Website User with no Remedium roles. Returns (user, created)."""
	mobile = _mobile(mobile)
	user = frappe.db.get_value("User", {"mobile_no": mobile}, "name")
	if user:
		return user, False
	email = cstr(email).strip().lower()
	if not EMAIL_RE.match(email) or frappe.db.exists("User", email):
		email = f"tp{mobile}@{USER_EMAIL_DOMAIN}"
	if frappe.db.exists("User", email):
		return email, False
	names = cstr(full_name).strip().split(" ", 1) or ["Teleporter"]
	previous = _user_ctx()
	try:
		doc = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": (names[0] or "Teleporter")[:60],
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


def _grant_role(user, role):
	if user and frappe.db.exists("User", user) and role not in frappe.get_roles(user):
		frappe.get_doc("User", user).add_roles(role)


def _clean_party_fields(k, doc, p, partial):
	display = cstr(p.get("display_name") or p.get(k.name_field) or "").strip()
	if display or not partial:
		if len(display) < 3:
			_fail(_("Enter the {0} name").format(k.label))
		doc.set(k.name_field, display[:140])
	if "party_type" in p or not partial:
		ptype = cstr(p.get("party_type")).strip() or "Other"
		doc.party_type = ptype if ptype in k.types else "Other"
	if "mobile" in p or not partial:
		doc.mobile = _mobile(p.get("mobile"))
	if "email" in p:
		email = cstr(p.get("email")).strip().lower()
		if email and not EMAIL_RE.match(email):
			_fail(_("Enter a valid email"))
		doc.email = email or None
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
			doc.set(key, cstr(p.get(key)).strip()[:limit] or None)
	for key in ("lat", "lng"):
		if key in p:
			value = flt(p.get(key), 6) if p.get(key) not in (None, "") else 0
			if (key == "lat" and abs(value) > 90) or (key == "lng" and abs(value) > 180):
				_fail(_("Invalid coordinates"))
			doc.set(key, value)


def _set_remedium_link(k, doc, value):
	value = cstr(value).strip() or None
	if value:
		if not frappe.db.exists(PROFILE_DT, value):
			_fail(_("Remedium franchise / lab {0} not found").format(value))
		if k.kind == "lab" and not is_lab_profile(value):
			_fail(_("{0} is not a Remedium lab (needs Has Own Lab, Orange FOCO or the mother lab)").format(value))
	doc.set(k.link_field, value)


def _notify_party(kind, name, text, subject):
	k = _kind(kind)
	row = frappe.db.get_value(k.dt, name, ["mobile", "email"], as_dict=True) or {}
	_notify(row.get("mobile"), text)
	email = cstr(row.get("email"))
	if email and EMAIL_RE.match(email) and not email.endswith(f"@{USER_EMAIL_DOMAIN}") and not frappe.flags.tp_no_notify:
		try:
			frappe.sendmail(recipients=[email], subject=subject, message=text)
		except Exception:
			frappe.log_error(title="phase134 party email", message=frappe.get_traceback())


def _rate_limit(key, limit, seconds):
	if frappe.flags.tp_skip_rate_limit:
		return
	cache = frappe.cache()
	count = cint(cache.get_value(key))
	if count >= limit:
		_fail(_("Too many sign-up attempts; try again later"))
	cache.set_value(key, count + 1, expires_in_sec=seconds)


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


def teleporter_user_for_mobile(mobile):
	"""A login linked to a Teleporter center / lab or an active runner with this mobile; None otherwise."""
	mobile = _mobile(mobile, required=False)
	if not mobile:
		return None
	candidates = frappe.get_all("User", filters={"mobile_no": mobile}, pluck="name", limit=5)
	candidates += frappe.get_all(PARTY_USER_DT, filters={"mobile": mobile, "active": 1}, pluck="user", limit=5)
	candidates += frappe.get_all(FP_DT, filters={"mobile": ("like", f"%{mobile}"), "is_teleporter_runner": 1}, pluck="user", limit=5)
	for user in dict.fromkeys(c for c in candidates if c):
		if parties_for_user("center", user) or parties_for_user("lab", user) or runner_for_user(user):
			return user
	return None


def _verify_otp(mobile, otp):
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import verify_otp_code

	ok, err = verify_otp_code(mobile, otp)
	if not ok:
		raise OtpError(err or _("OTP verification failed"))


def otp_login(mobile, otp, login=True):
	"""Teleporter's own OTP sign-in: never creates a patient account; staff accounts must use their password."""
	mobile = _mobile(mobile)
	_verify_otp(mobile, otp)
	user = teleporter_user_for_mobile(mobile)
	if not user:
		_missing(_("No Teleporter account for this mobile. Sign up first."))
	if not otp_login_allowed(user):
		_deny(_("This account must sign in with its password"))
	return _login_session(user, mobile) if login else {"user": user}


def signup(kind, mobile, otp, payload, login=True):
	"""Guest sign-up of a center or lab with an OTP-verified mobile; status Pending Approval until operations approve."""
	k = _kind(kind)
	mobile = _mobile(mobile)
	_rate_limit(f"tp_signup_ip:{cstr(getattr(frappe.local, 'request_ip', '')) or 'local'}", SIGNUP_IP_LIMIT, 3600)
	_rate_limit(f"tp_signup_mobile:{mobile}", SIGNUP_MOBILE_LIMIT, 86400)
	_verify_otp(mobile, otp)
	p = _parse(payload)
	if not isinstance(p, dict):
		_fail(_("Invalid request payload"))
	p = {**p, "mobile": mobile, "display_name": p.get("display_name") or p.get("name")}
	existing = frappe.db.get_value(k.dt, {"mobile": mobile, "status": "Pending Approval"}, "name")
	previous = _user_ctx()
	try:
		doc = frappe.get_doc(k.dt, existing) if existing else frappe.new_doc(k.dt)
		_clean_party_fields(k, doc, p, partial=False)
		doc.status = "Pending Approval"
		doc.signup_source = "Self Sign-up"
		user, _created = ensure_party_user(mobile, p.get("contact_person") or p.get("display_name"), p.get("email"))
		if not any(r.user == user for r in doc.get("users") or []):
			doc.append("users", {"user": user, "mobile": mobile, "active": 1})
		if doc.is_new():
			doc.insert(ignore_permissions=True)
		else:
			doc.save(ignore_permissions=True)
	finally:
		frappe.set_user(previous)
	session = None
	if login and otp_login_allowed(user):
		session = _login_session(user, mobile)
	return {
		"kind": k.kind,
		"party": party_payload(k.kind, doc.name),
		"session": session,
		"message": _("Thanks: operations will review your {0} and contact you").format(k.label)
		if session or not login
		else _("Submitted. This mobile belongs to an existing account: sign in with its password"),
	}


def list_parties(kind, filters=None):
	k = _kind(kind)
	filters = filters or {}
	where = {}
	if filters.get("status"):
		where["status"] = filters["status"]
	or_filters = None
	q = cstr(filters.get("q")).strip()
	if q:
		or_filters = [[k.name_field, "like", f"%{q}%"], ["mobile", "like", f"%{q}%"], ["city", "like", f"%{q}%"], ["name", "like", f"%{q}%"]]
	names = frappe.get_all(k.dt, filters=where, or_filters=or_filters, pluck="name", order_by="modified desc", limit=500)
	return {"rows": [party_payload(k.kind, n) for n in names]}


def list_signups(kind=None):
	kinds = [_kind(kind).kind] if kind else ["center", "lab"]
	rows = []
	for kd in kinds:
		rows += list_parties(kd, {"status": "Pending Approval"})["rows"]
	rows.sort(key=lambda r: cstr(r["creation"]), reverse=True)
	return {"rows": rows}


def save_party(kind, payload, user=None):
	k = _kind(kind)
	p = payload or {}
	name = cstr(p.get("name")).strip()
	doc = frappe.get_doc(k.dt, name) if name and frappe.db.exists(k.dt, name) else frappe.new_doc(k.dt)
	_clean_party_fields(k, doc, p, partial=not doc.is_new())
	link_key = "linked_remedium" if "linked_remedium" in p else k.link_field
	if link_key in p:
		_set_remedium_link(k, doc, p.get(link_key))
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
			if frappe.db.exists("User", ref):
				uid = ref
			else:
				uid, _created = ensure_party_user(ref, doc.contact_person or doc.get(k.name_field))
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
				_grant_role(row.user, k.role)
	return party_payload(k.kind, doc.name)


def approve_party(kind, name, user=None):
	k = _kind(kind)
	if not name or not frappe.db.exists(k.dt, name):
		_missing(_("{0} {1} not found").format(k.label.title(), name))
	doc = frappe.get_doc(k.dt, name)
	if doc.status not in ("Pending Approval", "Rejected"):
		_fail(_("{0} is {1}").format(doc.get(k.name_field), doc.status))
	doc.update({"status": "Active", "approved_by": user or frappe.session.user, "approved_on": now_datetime(), "rejection_reason": None})
	doc.save(ignore_permissions=True)
	for row in doc.users:
		if cint(row.active):
			_grant_role(row.user, k.role)
	_notify_party(
		k.kind,
		doc.name,
		_("Teleporter: {0} is approved. Sign in at {1}/login with this mobile.").format(doc.get(k.name_field), APP_URL),
		_("Your Teleporter {0} is approved").format(k.label),
	)
	return party_payload(k.kind, doc.name)


def reject_party(kind, name, reason):
	k = _kind(kind)
	reason = cstr(reason).strip()[:500]
	if not reason:
		_fail(_("Give the reason"))
	if not name or not frappe.db.exists(k.dt, name):
		_missing(_("{0} {1} not found").format(k.label.title(), name))
	doc = frappe.get_doc(k.dt, name)
	if doc.status != "Pending Approval":
		_fail(_("Only a pending sign-up can be rejected (this one is {0})").format(doc.status))
	doc.update({"status": "Rejected", "rejection_reason": reason})
	doc.save(ignore_permissions=True)
	_notify_party(
		k.kind,
		doc.name,
		_("Teleporter: the sign-up for {0} was not approved: {1}").format(doc.get(k.name_field), reason),
		_("Your Teleporter sign-up"),
	)
	return party_payload(k.kind, doc.name)


def set_party_status(kind, name, status, reason=None):
	k = _kind(kind)
	if status not in ("Active", "Suspended"):
		_fail(_("Status must be Active or Suspended"))
	if not name or not frappe.db.exists(k.dt, name):
		_missing(_("{0} {1} not found").format(k.label.title(), name))
	doc = frappe.get_doc(k.dt, name)
	if status == "Active" and not doc.approved_on:
		_fail(_("Approve the sign-up first"))
	doc.status = status
	if status == "Suspended":
		doc.rejection_reason = cstr(reason).strip()[:500] or doc.rejection_reason
	doc.save(ignore_permissions=True)
	return party_payload(k.kind, doc.name)


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------

FP_FIELDS = ["name", "user", "full_name", "mobile", "status", "is_teleporter_runner", "is_phlebo_rider"]


def runner_for_user(user):
	if not user or user == "Guest":
		return None
	row = frappe.db.get_value(FP_DT, {"user": user}, FP_FIELDS, as_dict=True)
	if not row or row.status != "Active" or not cint(row.is_teleporter_runner):
		return None
	return row


def resolve_runner(runner_id):
	"""Runner badge (HEC Field Provider id), login email or mobile -> an Active Teleporter Runner."""
	raw = cstr(runner_id).strip()
	if not raw:
		_fail(_("Scan or enter the runner ID"))
	name = frappe.db.exists(FP_DT, raw) or frappe.db.get_value(FP_DT, {"user": raw}, "name")
	if not name:
		digits = re.sub(r"\D", "", raw)
		if len(digits) >= 10:
			name = frappe.db.get_value(FP_DT, {"mobile": ("like", f"%{digits[-10:]}")}, "name")
	if not name:
		_fail(_("Runner {0} is not a registered field provider").format(raw[:40]))
	row = frappe.db.get_value(FP_DT, name, FP_FIELDS, as_dict=True)
	label = row.full_name or row.name
	if not cint(row.is_teleporter_runner):
		_fail(_("{0} is not a Teleporter Runner").format(label))
	if row.status != "Active":
		_fail(_("Runner {0} is {1}, not Active").format(label, row.status))
	return row


def _runner_card(row):
	if not row:
		return None
	return {"provider": row.name, "full_name": row.full_name, "mobile": row.mobile, "status": row.status}


def enable_runner(user, enable=1, mobile=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import save_field_provider

	user = cstr(user).strip()
	if not user or not frappe.db.exists("User", user):
		_fail(_("User not found"))
	name = frappe.db.get_value(FP_DT, {"user": user}, "name")
	payload = {"name": name} if name else {"user": user}
	if cint(enable):
		payload.update({"is_teleporter_runner": 1, "status": "Active"})
	else:
		if not name:
			_fail(_("{0} is not a runner").format(user))
		payload["is_teleporter_runner"] = 0
		if not cint(frappe.db.get_value(FP_DT, name, "is_phlebo_rider")):
			payload.update({"is_teleporter_runner": 1, "status": "Suspended"})
	if mobile:
		payload["mobile"] = _mobile(mobile)
	saved = save_field_provider(payload)
	if cint(enable):
		_grant_role(user, ROLE_RUNNER)
	elif ROLE_RUNNER in frappe.get_roles(user):
		frappe.get_doc("User", user).remove_roles(ROLE_RUNNER)
	return _runner_list_row(frappe.db.get_value(FP_DT, saved["name"], FP_FIELDS, as_dict=True))


def _runner_list_row(fp, user=None):
	user = user or (fp.user if fp else None)
	return {
		"provider": fp.name if fp else None,
		"user": user,
		"full_name": (fp.full_name if fp else None) or frappe.db.get_value("User", user, "full_name"),
		"mobile": (fp.mobile if fp else None) or frappe.db.get_value("User", user, "mobile_no"),
		"status": fp.status if fp else None,
		"is_runner": bool(fp and cint(fp.is_teleporter_runner) and fp.status == "Active"),
		"has_role": bool(user and ROLE_RUNNER in frappe.get_roles(user)),
	}


def list_runners(q=None):
	providers = {r.user: r for r in frappe.get_all(FP_DT, filters={"is_teleporter_runner": 1}, fields=FP_FIELDS, limit=0)}
	role_users = set(frappe.get_all("Has Role", filters={"role": ROLE_RUNNER, "parenttype": "User"}, pluck="parent", limit=0))
	q = cstr(q).strip().lower()
	rows = []
	for user in sorted(set(providers) | role_users):
		row = _runner_list_row(providers.get(user), user)
		if q and q not in cstr(row["full_name"]).lower() and q not in user.lower() and q not in cstr(row["mobile"]):
			continue
		rows.append(row)
	return {"rows": rows[:200]}


# ---------------------------------------------------------------------------
# Tiers and iceboxes
# ---------------------------------------------------------------------------

TIER_NUMBERS = ("capacity_tubes", "temp_min_c", "temp_max_c", "hold_hours", "monthly_price", "deposit")


def tier_row(row):
	configured = flt(row.get("temp_max_c")) > flt(row.get("temp_min_c"))
	out = {k: row.get(k) for k in ("tier", "label", "notes")}
	out.update({k: flt(row.get(k)) if k != "capacity_tubes" else cint(row.get(k)) for k in TIER_NUMBERS})
	out.update({"active": cint(row.get("active")), "temp_range_configured": configured})
	return out


def list_tiers():
	rows = frappe.get_all(TIER_DT, fields=["tier", "label", "notes", "active", *TIER_NUMBERS], order_by="tier asc", limit=0)
	return {"rows": [tier_row(r) for r in rows]}


def save_tier(payload):
	code = cstr(payload.get("tier")).strip().upper()
	if code not in TIER_CODES:
		_fail(_("Tier must be one of {0}").format(", ".join(TIER_CODES)))
	doc = frappe.get_doc(TIER_DT, code) if frappe.db.exists(TIER_DT, code) else frappe.get_doc({"doctype": TIER_DT, "tier": code})
	for key in ("label", "notes"):
		if key in payload:
			doc.set(key, cstr(payload.get(key)).strip()[:500] or None)
	for key in TIER_NUMBERS:
		if key in payload:
			value = cint(payload.get(key)) if key == "capacity_tubes" else flt(payload.get(key), 2)
			if key not in ("temp_min_c", "temp_max_c") and value < 0:
				_fail(_("{0} cannot be negative").format(key))
			doc.set(key, value)
	if "active" in payload:
		doc.active = 1 if cint(payload.get("active")) else 0
	lo, hi = flt(doc.temp_min_c), flt(doc.temp_max_c)
	if (lo or hi) and hi <= lo:
		_fail(_("Max temperature must be above min temperature (leave both 0 when not set)"))
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return tier_row(doc.as_dict())


def temp_check(tier, value):
	row = frappe.db.get_value(TIER_DT, tier, ["temp_min_c", "temp_max_c"], as_dict=True) if tier else None
	lo, hi = (flt(row.temp_min_c), flt(row.temp_max_c)) if row else (0.0, 0.0)
	configured = hi > lo
	ok = (lo <= value <= hi) if (configured and value is not None) else None
	return {"value": value, "min": lo if configured else None, "max": hi if configured else None, "configured": configured, "ok": ok}


ICEBOX_FIELDS = [
	"name",
	"carrier_code",
	"tier",
	"status",
	"assigned_runner",
	"assigned_runner_name",
	"subscription",
	"collection_point_id",
	"collection_point_name",
	"holder_type",
	"holder_name",
	"last_temp_c",
	"last_temp_at",
	"last_scan_event",
	"last_scan_at",
	"notes",
]


def icebox_code(code):
	code = cstr(code).strip().upper()
	if not code:
		_fail(_("Scan the icebox barcode"))
	parsed = parse_code(code)
	if parsed["prefix"] != ICEBOX_PREFIX:
		_fail(_("{0} is not an icebox code").format(code[:40]))
	if not parsed["valid"]:
		_fail(_("Icebox code {0} fails its check character; re-scan the label").format(code))
	return code


def get_icebox(code, lock=False):
	code = icebox_code(code)
	row = frappe.db.get_value(ICEBOX_DT, code, ICEBOX_FIELDS, as_dict=True)
	if not row:
		_missing(_("Icebox {0} is not registered").format(code))
	if lock:
		_lock(ICEBOX_DT, code)
		row = frappe.db.get_value(ICEBOX_DT, code, ICEBOX_FIELDS, as_dict=True)
	return row


def open_manifest_for_icebox(code, exclude=None):
	filters = {"icebox": code, "status": ("in", OPEN_STATUSES)}
	if exclude:
		filters["name"] = ("!=", exclude)
	return frappe.db.get_value(MANIFEST_DT, filters, "name")


def icebox_row(row):
	return {
		"carrier_code": row.name,
		"tier": row.tier,
		"status": row.status,
		"assigned_runner": row.assigned_runner,
		"assigned_runner_name": row.assigned_runner_name,
		"subscription": row.subscription,
		"collection_point_id": row.collection_point_id,
		"collection_point_name": row.collection_point_name,
		"holder_type": row.holder_type,
		"holder_name": row.holder_name,
		"last_temp_c": flt(row.last_temp_c, 1) if row.last_temp_at else None,
		"last_scan_event": row.last_scan_event,
		"last_scan_at": _str(row.last_scan_at),
		"open_manifest": open_manifest_for_icebox(row.name),
		"notes": row.notes,
	}


def _set_icebox(code, status=None, holder=None, temp=None, event=None):
	now = now_datetime()
	values = {}
	if status:
		values["status"] = status
	if holder is not None:
		values["holder_type"], values["holder_name"] = holder if holder else (None, None)
	if temp is not None:
		values.update({"last_temp_c": temp, "last_temp_at": now})
	if event:
		values.update({"last_scan_event": event, "last_scan_at": now})
	if values:
		frappe.db.set_value(ICEBOX_DT, code, values)


def register_iceboxes(tier, count, notes=None, actor_role="Operations"):
	from frappe.model.naming import getseries

	tier = cstr(tier).strip().upper()
	if not frappe.db.exists(TIER_DT, tier):
		_fail(_("Unknown icebox tier {0}").format(tier))
	count = cint(count)
	if count < 1 or count > MAX_REGISTER:
		_fail(_("Register between 1 and {0} iceboxes at a time").format(MAX_REGISTER))
	digits = get_prefix(ICEBOX_PREFIX)["digits"]
	created = []
	for _i in range(count):
		code = None
		for _attempt in range(10):
			candidate = make_code(ICEBOX_PREFIX, cint(getseries(ICEBOX_SERIES, digits)))
			if not frappe.db.exists(ICEBOX_DT, candidate):
				code = candidate
				break
		if not code:
			_fail(_("Could not allocate a new icebox code"))
		frappe.get_doc(
			{"doctype": ICEBOX_DT, "carrier_code": code, "tier": tier, "status": "In Stock", "notes": cstr(notes).strip()[:500] or None}
		).insert(ignore_permissions=True)
		ev = record_scan_event(code, "Issued", code_type="Icebox", actor_role=actor_role, ref_doctype=ICEBOX_DT, ref_name=code, payload={"tier": tier})
		_set_icebox(code, event=ev["name"])
		created.append(code)
	rows = frappe.get_all(ICEBOX_DT, filters={"name": ("in", created)}, fields=ICEBOX_FIELDS, limit=0)
	return {"created": created, "rows": [icebox_row(r) for r in rows]}


def list_iceboxes(filters=None, page=1, page_size=50):
	filters = filters or {}
	where = {}
	for key, field in (("status", "status"), ("tier", "tier"), ("subscription", "subscription"), ("runner", "assigned_runner"), ("center", "collection_point_id")):
		if filters.get(key):
			where[field] = filters[key]
	or_filters = None
	q = cstr(filters.get("q")).strip()
	if q:
		or_filters = [["name", "like", f"%{q}%"], ["collection_point_name", "like", f"%{q}%"], ["assigned_runner_name", "like", f"%{q}%"]]
	page = max(1, cint(page) or 1)
	size = min(max(1, cint(page_size) or 50), 200)
	rows = frappe.get_all(ICEBOX_DT, filters=where, or_filters=or_filters, fields=ICEBOX_FIELDS, order_by="name asc", start=(page - 1) * size, limit=size)
	total = len(frappe.get_all(ICEBOX_DT, filters=where, or_filters=or_filters, pluck="name", limit=0)) if or_filters else frappe.db.count(ICEBOX_DT, where)
	return {"rows": [icebox_row(r) for r in rows], "total": total, "page": page, "page_size": size}


def _bind_box(code, sub):
	old = frappe.db.get_value(ICEBOX_DT, code, "subscription")
	if old and old != sub.name:
		frappe.db.delete(SUB_BOX_DT, {"parent": old, "parenttype": SUB_DT, "icebox": code})
	if not frappe.db.exists(SUB_BOX_DT, {"parent": sub.name, "parenttype": SUB_DT, "icebox": code}):
		doc = frappe.get_doc(SUB_DT, sub.name)
		doc.append("iceboxes", {"icebox": code})
		doc.save(ignore_permissions=True)
	values = {"subscription": sub.name, "collection_point_id": sub.collection_point_id, "collection_point_name": sub.collection_point_name}
	if frappe.db.get_value(ICEBOX_DT, code, "status") == "In Stock":
		values["status"] = "Assigned"
	frappe.db.set_value(ICEBOX_DT, code, values)


def _unbind_box(code):
	old = frappe.db.get_value(ICEBOX_DT, code, "subscription")
	if old:
		frappe.db.delete(SUB_BOX_DT, {"parent": old, "parenttype": SUB_DT, "icebox": code})
	values = {"subscription": None, "collection_point_id": None, "collection_point_name": None, "holder_type": None, "holder_name": None}
	if frappe.db.get_value(ICEBOX_DT, code, "status") in ("Assigned", "At Collection Point", "At Lab"):
		values["status"] = "In Stock"
	frappe.db.set_value(ICEBOX_DT, code, values)


def _assert_box_free(code):
	other = open_manifest_for_icebox(code)
	if other:
		_fail(_("Icebox {0} is on open manifest {1}; change it after the manifest is received or cancelled").format(code, other))


def _check_box_for_sub(box, sub):
	if box.status in ("Retired", "Maintenance"):
		_fail(_("Icebox {0} is {1}").format(box.name, box.status))
	if box.tier != sub.tier:
		_fail(_("Icebox {0} is {1} but subscription {2} is for {3}").format(box.name, box.tier, sub.name, sub.tier))
	if box.subscription and box.subscription != sub.name and frappe.db.get_value(SUB_DT, box.subscription, "status") in SUB_OPEN:
		_fail(_("Icebox {0} is assigned to subscription {1}; unassign it first").format(box.name, box.subscription))


def assign_icebox(payload):
	code = icebox_code(payload.get("carrier_code"))
	box = get_icebox(code, lock=True)
	if box.status == "Retired":
		_fail(_("Icebox {0} is retired").format(code))
	if "subscription" in payload:
		sub_name = cstr(payload.get("subscription")).strip()
		if sub_name != cstr(box.subscription):
			_assert_box_free(code)
			if sub_name:
				sub = frappe.db.get_value(SUB_DT, sub_name, SUB_FIELDS, as_dict=True)
				if not sub:
					_missing(_("Subscription {0} not found").format(sub_name))
				if sub.status not in SUB_OPEN:
					_fail(_("Subscription {0} is {1}").format(sub_name, sub.status))
				_check_box_for_sub(box, sub)
				_bind_box(code, sub)
			else:
				_unbind_box(code)
	if "runner" in payload:
		runner = cstr(payload.get("runner")).strip()
		if runner:
			runner = resolve_runner(runner).name
		frappe.db.set_value(ICEBOX_DT, code, {"assigned_runner": runner or None, "assigned_runner_name": frappe.db.get_value(FP_DT, runner, "full_name") if runner else None})
	return icebox_row(get_icebox(code))


def set_icebox_status(code, status, notes=None):
	code = icebox_code(code)
	box = get_icebox(code, lock=True)
	if status not in OPS_ICEBOX_STATUSES:
		_fail(_("Status must be one of {0}").format(", ".join(OPS_ICEBOX_STATUSES)))
	_assert_box_free(code)
	if status in ("In Stock", "Retired") and box.subscription:
		_unbind_box(code)
	values = {"status": status}
	if notes:
		values["notes"] = (cstr(box.notes) + "\n" + cstr(notes).strip())[-2000:].strip()
	frappe.db.set_value(ICEBOX_DT, code, values)
	return icebox_row(get_icebox(code))


def icebox_labels(codes, fmt="pdf", size=None):
	codes = [icebox_code(c) for c in _list(codes)]
	if not codes:
		_fail(_("Choose iceboxes to print"))
	tiers = dict(frappe.get_all(ICEBOX_DT, filters={"name": ("in", codes)}, fields=["name", "tier"], as_list=True))
	missing = [c for c in codes if c not in tiers]
	if missing:
		_fail(_("Not registered: {0}").format(", ".join(missing[:10])))
	return render_labels(codes, fmt or "pdf", size, {c: f"Teleporter {tiers[c]}" for c in codes})


# ---------------------------------------------------------------------------
# Subscriptions and mappings
# ---------------------------------------------------------------------------

SUB_FIELDS = [
	"name",
	"collection_point_id",
	"collection_point_name",
	"tier",
	"billing_cycle",
	"amount",
	"start_date",
	"end_date",
	"auto_renew",
	"pickup_window_start",
	"pickup_window_end",
	"status",
	"status_reason",
	"payment_mode",
	"payment_ref",
	"amount_paid",
	"paid_on",
	"notes",
]

MAPPING_FIELDS = [
	"name",
	"collection_point_id",
	"collection_point_name",
	"authorized_receiving_lab_id",
	"lab_name",
	"active",
	"effective_from",
	"effective_to",
	"default_runner",
	"default_runner_name",
	"expected_tat_minutes",
	"notes",
]


def _check_center(center, require_active=True):
	center = cstr(center).strip()
	if not center or not frappe.db.exists(CENTER_DT, center):
		_missing(_("Teleporter center {0} not found").format(center or ""))
	status = party_status("center", center)
	if require_active and status != "Active":
		_fail(_("Center {0} is {1}: operations must approve it first").format(party_display("center", center), status))
	return center


def _check_lab(lab, require_active=True):
	lab = cstr(lab).strip()
	if not lab or not frappe.db.exists(LAB_DT, lab):
		_missing(_("Teleporter lab {0} not found").format(lab or ""))
	status = party_status("lab", lab)
	if require_active and status != "Active":
		_fail(_("Lab {0} is {1}: operations must approve it first").format(party_display("lab", lab), status))
	return lab


def _sub_in_date(row, on=None):
	on = getdate(on or today())
	return bool(row.get("start_date")) and getdate(row.start_date) <= on and (not row.get("end_date") or getdate(row.end_date) >= on)


def _period_end(start, cycle):
	return add_days(add_months(getdate(start), BILLING_CYCLES.get(cycle) or 1), -1)


def subscription_row(row):
	boxes = frappe.get_all(SUB_BOX_DT, filters={"parent": row.name, "parenttype": SUB_DT}, pluck="icebox", order_by="idx asc", limit=0)
	return {
		"name": row.name,
		"collection_point_id": row.collection_point_id,
		"collection_point_name": row.collection_point_name,
		"tier": row.tier,
		"billing_cycle": row.billing_cycle,
		"amount": flt(row.amount),
		"start_date": _str(row.start_date),
		"end_date": _str(row.end_date),
		"auto_renew": cint(row.auto_renew),
		"pickup_window_start": _hhmm(row.pickup_window_start),
		"pickup_window_end": _hhmm(row.pickup_window_end),
		"status": row.status,
		"status_reason": row.status_reason,
		"payment_mode": row.payment_mode,
		"payment_ref": row.payment_ref,
		"amount_paid": flt(row.amount_paid),
		"paid_on": _str(row.paid_on),
		"notes": row.notes,
		"iceboxes": boxes,
		"in_date": _sub_in_date(row),
	}


def _sub(name):
	row = frappe.db.get_value(SUB_DT, cstr(name).strip(), SUB_FIELDS, as_dict=True) if name else None
	if not row:
		_missing(_("Subscription {0} not found").format(name))
	return row


def active_subscriptions(center, on=None):
	rows = frappe.get_all(SUB_DT, filters={"collection_point_id": center, "status": "Active"}, fields=SUB_FIELDS, order_by="start_date desc", limit=20)
	return [r for r in rows if _sub_in_date(r, on)]


def list_subscriptions(filters=None):
	filters = filters or {}
	where = {k: filters[k] for k in ("status", "tier") if filters.get(k)}
	if filters.get("center"):
		where["collection_point_id"] = filters["center"]
	rows = frappe.get_all(SUB_DT, filters=where, fields=SUB_FIELDS, order_by="modified desc", limit=500)
	return {"rows": [subscription_row(r) for r in rows]}


def save_subscription(payload):
	name = cstr(payload.get("name")).strip()
	doc = frappe.get_doc(SUB_DT, name) if name else frappe.new_doc(SUB_DT)
	editable_core = doc.is_new() or doc.status == "Pending Payment"
	if editable_core:
		if doc.is_new() or "collection_point_id" in payload:
			center = _check_center(payload.get("collection_point_id") or doc.collection_point_id, require_active=False)
			doc.collection_point_id = center
			doc.collection_point_name = party_display("center", center)
		if doc.is_new() or "tier" in payload:
			tier = cstr(payload.get("tier") or doc.tier).strip().upper()
			if not frappe.db.exists(TIER_DT, tier) or not cint(frappe.db.get_value(TIER_DT, tier, "active")):
				_fail(_("Choose an active icebox tier"))
			if "iceboxes" not in payload and any(frappe.db.get_value(ICEBOX_DT, r.icebox, "tier") != tier for r in doc.get("iceboxes") or []):
				_fail(_("Unassign the {0} iceboxes before changing the tier").format(doc.tier))
			doc.tier = tier
	elif any(k in payload and cstr(payload.get(k)) != cstr(doc.get(k)) for k in ("collection_point_id", "tier")):
		_fail(_("Center and tier can only change while the subscription is Pending Payment"))
	if doc.is_new() or "billing_cycle" in payload:
		cycle = cstr(payload.get("billing_cycle") or doc.billing_cycle or "Monthly")
		if cycle not in BILLING_CYCLES:
			_fail(_("Billing cycle must be Monthly, Quarterly or Yearly"))
		doc.billing_cycle = cycle
	if "amount" in payload:
		if flt(payload.get("amount")) < 0:
			_fail(_("Amount cannot be negative"))
		doc.amount = flt(payload.get("amount"), 2)
	if doc.is_new() or "start_date" in payload:
		doc.start_date = _date_in(payload.get("start_date")) or getdate(today())
	if "end_date" in payload or doc.is_new():
		doc.end_date = _date_in(payload.get("end_date"))
	if not doc.end_date:
		doc.end_date = _period_end(doc.start_date, doc.billing_cycle)
	if getdate(doc.end_date) < getdate(doc.start_date):
		_fail(_("End date is before the start date"))
	for key, label in (("pickup_window_start", _("Pickup from")), ("pickup_window_end", _("Pickup until"))):
		if key in payload:
			doc.set(key, _time_in(payload.get(key), label))
		elif doc.is_new():
			doc.set(key, None)  # new_doc() pre-fills Time fields with the current time
	if doc.pickup_window_start and doc.pickup_window_end and cstr(_hhmm(doc.pickup_window_end)) <= cstr(_hhmm(doc.pickup_window_start)):
		_fail(_("Pickup window must end after it starts"))
	if "auto_renew" in payload:
		doc.auto_renew = 1 if cint(payload.get("auto_renew")) else 0
	if "notes" in payload:
		doc.notes = cstr(payload.get("notes")).strip()[:2000] or None
	if doc.is_new():
		doc.status = "Pending Payment"
	clash = frappe.db.get_value(
		SUB_DT,
		{"collection_point_id": doc.collection_point_id, "tier": doc.tier, "status": ("in", SUB_OPEN), "name": ("!=", doc.name or "")},
		"name",
	)
	if clash and doc.status in SUB_OPEN:
		_fail(_("{0} already has open {1} subscription {2}").format(doc.collection_point_name, doc.tier, clash))
	removed = []
	wanted = None
	if "iceboxes" in payload:
		wanted = list(dict.fromkeys(icebox_code(c) for c in _list(payload.get("iceboxes"))))
		current = {r.icebox for r in doc.get("iceboxes") or []}
		for code in wanted:
			_check_box_for_sub(get_icebox(code), doc)
		removed = sorted(current - set(wanted))
		for code in removed + [c for c in wanted if c not in current]:
			_assert_box_free(code)
		doc.set("iceboxes", [{"icebox": c} for c in wanted])
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	sub = _sub(doc.name)
	for code in removed:
		if frappe.db.get_value(ICEBOX_DT, code, "subscription") == doc.name:
			_unbind_box(code)
	for code in wanted or []:
		_bind_box(code, sub)
	return subscription_row(_sub(doc.name))


def activate_subscription(name, payment_mode, payment_ref=None, amount_paid=None, user=None):
	sub = _sub(name)
	if sub.status != "Pending Payment":
		_fail(_("Only a Pending Payment subscription can be activated (this one is {0})").format(sub.status))
	if payment_mode not in PAYMENT_MODES:
		_fail(_("Payment mode must be one of {0}").format(", ".join(PAYMENT_MODES)))
	if sub.end_date and getdate(sub.end_date) < getdate(today()):
		_fail(_("The subscription period has already ended; edit its dates first"))
	_check_center(sub.collection_point_id)
	frappe.db.set_value(
		SUB_DT,
		sub.name,
		{
			"status": "Active",
			"payment_mode": payment_mode,
			"payment_ref": cstr(payment_ref).strip()[:140] or None,
			"amount_paid": flt(amount_paid, 2) if amount_paid not in (None, "") else flt(sub.amount, 2),
			"paid_on": now_datetime(),
			"activated_by": user or frappe.session.user,
			"status_reason": None,
		},
	)
	return subscription_row(_sub(sub.name))


def set_subscription_status(name, status, reason=None):
	sub = _sub(name)
	if status not in SUB_TRANSITIONS.get(sub.status, set()):
		_fail(_("A {0} subscription cannot become {1}").format(sub.status, status))
	frappe.db.set_value(SUB_DT, sub.name, {"status": status, "status_reason": cstr(reason).strip()[:500] or None})
	return subscription_row(_sub(sub.name))


def _in_effect(row, on=None):
	on = getdate(on or today())
	if row.get("effective_from") and getdate(row.effective_from) > on:
		return False
	return not (row.get("effective_to") and getdate(row.effective_to) < on)


def mapping_row(row):
	return {
		"name": row.name,
		"collection_point_id": row.collection_point_id,
		"collection_point_name": row.collection_point_name,
		"authorized_receiving_lab_id": row.authorized_receiving_lab_id,
		"lab_name": row.lab_name,
		"active": cint(row.active),
		"effective_from": _str(row.effective_from),
		"effective_to": _str(row.effective_to),
		"default_runner": row.default_runner,
		"default_runner_name": row.default_runner_name,
		"expected_tat_minutes": cint(row.expected_tat_minutes),
		"notes": row.notes,
		"in_effect": bool(cint(row.active) and _in_effect(row)),
	}


def active_mapping(center, on=None):
	rows = frappe.get_all(MAP_DT, filters={"collection_point_id": center, "active": 1}, fields=MAPPING_FIELDS, order_by="modified desc", limit=5)
	return next((r for r in rows if _in_effect(r, on)), None)


def apply_mapping_rules(doc):
	"""One active mapping per center (also enforced by the unique active_key); inactive rows stay editable."""
	active = cint(doc.active)
	center = _check_center(doc.collection_point_id, require_active=active)
	lab = _check_lab(doc.authorized_receiving_lab_id, require_active=active)
	doc.collection_point_name = party_display("center", center)
	doc.lab_name = party_display("lab", lab)
	if doc.effective_from and doc.effective_to and getdate(doc.effective_to) < getdate(doc.effective_from):
		_fail(_("Effective To is before Effective From"))
	if cint(doc.expected_tat_minutes) < 0:
		_fail(_("Expected TAT cannot be negative"))
	if active:
		other = frappe.db.get_value(MAP_DT, {"collection_point_id": center, "active": 1, "name": ("!=", doc.name or "")}, "name")
		if other:
			_fail(_("{0} already has an active mapping ({1}); deactivate it first").format(doc.collection_point_name, other))
		doc.active_key = center
	elif not cstr(doc.active_key).startswith("off:"):
		doc.active_key = f"off:{frappe.generate_hash(length=16)}"


def on_mapping_validate(doc, method=None):
	apply_mapping_rules(doc)


def save_mapping(payload):
	name = cstr(payload.get("name")).strip()
	doc = frappe.get_doc(MAP_DT, name) if name else frappe.new_doc(MAP_DT)
	for key in ("collection_point_id", "authorized_receiving_lab_id"):
		if key in payload or doc.is_new():
			doc.set(key, cstr(payload.get(key)).strip() or None)
	if "active" in payload or doc.is_new():
		doc.active = 1 if cint(payload.get("active", 1)) else 0
	for key in ("effective_from", "effective_to"):
		if key in payload:
			doc.set(key, _date_in(payload.get(key)))
	if "default_runner" in payload:
		runner = cstr(payload.get("default_runner")).strip()
		doc.default_runner = resolve_runner(runner).name if runner else None
	if "expected_tat_minutes" in payload:
		doc.expected_tat_minutes = cint(payload.get("expected_tat_minutes"))
	if "notes" in payload:
		doc.notes = cstr(payload.get("notes")).strip()[:2000] or None
	apply_mapping_rules(doc)
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return mapping_row(frappe.db.get_value(MAP_DT, doc.name, MAPPING_FIELDS, as_dict=True))


def list_mappings(filters=None):
	filters = filters or {}
	where = {}
	if filters.get("center"):
		where["collection_point_id"] = filters["center"]
	if filters.get("lab"):
		where["authorized_receiving_lab_id"] = filters["lab"]
	if cstr(filters.get("active")) in ("0", "1"):
		where["active"] = cint(filters["active"])
	rows = frappe.get_all(MAP_DT, filters=where, fields=MAPPING_FIELDS, order_by="active desc, modified desc", limit=500)
	return {"rows": [mapping_row(r) for r in rows]}


def gate(center):
	"""Approved center + active in-effect mapping to an approved lab + Active, in-date subscription(s), or refuse."""
	_check_center(center)
	label = party_display("center", center)
	mapping = active_mapping(center)
	if not mapping:
		_fail(_("No active Collection To Lab Mapping for {0}: operations must map an authorised receiving lab before any shipment").format(label))
	_check_lab(mapping.authorized_receiving_lab_id)
	subs = active_subscriptions(center)
	if not subs:
		_fail(_("{0} has no Active, in-date Teleporter subscription").format(label))
	return mapping, subs


def icebox_for_dispatch(code, center, subs, manifest=None):
	box = get_icebox(code, lock=True)
	if box.status in ("Retired", "Maintenance"):
		_fail(_("Icebox {0} is {1}").format(box.name, box.status))
	if box.status == "In Stock" or not box.subscription:
		_fail(_("Icebox {0} is not assigned to a Teleporter subscription").format(box.name))
	sub = next((s for s in subs if s.name == box.subscription), None)
	if not sub:
		_fail(
			_("Icebox {0} belongs to subscription {1}, which is not an Active, in-date subscription of {2}").format(
				box.name, box.subscription, party_display("center", center)
			)
		)
	if box.tier != sub.tier:
		_fail(_("Icebox {0} is {1} but subscription {2} is for {3}").format(box.name, box.tier, sub.name, sub.tier))
	other = open_manifest_for_icebox(box.name, exclude=manifest)
	if other:
		_fail(_("Icebox {0} is already on open manifest {1}").format(box.name, other))
	return box, sub


# ---------------------------------------------------------------------------
# Samples (optional; Remedium lock only for Remedium-linked labs)
# ---------------------------------------------------------------------------


def _pf_module():
	try:
		from health_ecosystem_core.health_ecosystem_core import clinical_phase133_phlebofirst as pf
	except ImportError:
		return None
	return pf


def _pf_barcode(code):
	"""Registered PhleboFirst universal barcode for a scanned code, or None (never raises)."""
	pf = _pf_module()
	if not pf:
		return None
	try:
		if not frappe.db.exists("DocType", pf.UB_DT) or not pf.is_pf_code(code):
			return None
		norm = cstr(code).strip().upper()
		return norm if frappe.db.exists(pf.UB_DT, norm) else None
	except Exception:
		return None


def _tube_fields():
	fields = ["name", "parent", "accession_id", "tube_code", "status"]
	if _has_field(TUBE_DT, "universal_barcode"):
		fields.append("universal_barcode")
	return fields


def resolve_sample(code):
	"""Remedium tube accession ID, PhleboFirst / mapped LIS code bound to a tube, or TRF barcode / ID -> {kind, trf, tubes}."""
	raw = cstr(code).strip()
	fields = _tube_fields()
	row = frappe.db.get_value(TUBE_DT, {"accession_id": raw, "parenttype": TRF_DT}, fields, as_dict=True)
	if row:
		return frappe._dict(kind="tube", trf=row.parent, tubes=[row], has_tubes=True)
	pf = _pf_module()
	if pf and "universal_barcode" in fields:
		try:
			universal = pf.universal_for_code(raw)
		except Exception:
			universal = None
		if universal:
			row = frappe.db.get_value(TUBE_DT, {"universal_barcode": universal, "parenttype": TRF_DT}, fields, as_dict=True)
			if row:
				return frappe._dict(kind="tube", trf=row.parent, tubes=[row], has_tubes=True)
	trf = frappe.db.get_value(TRF_DT, {"unique_barcode": raw}, "name") or (raw if frappe.db.exists(TRF_DT, raw) else None)
	if trf:
		tubes = frappe.get_all(TUBE_DT, filters={"parent": trf, "parenttype": TRF_DT}, fields=fields, order_by="idx asc", limit=0)
		return frappe._dict(kind="trf", trf=trf, tubes=tubes, has_tubes=bool(tubes))
	return None


def locked_manifest_with(trf, tube_row=None, exclude=None):
	"""Open manifest (other than `exclude`) already locking this tube (or its whole TRF)."""
	rows = frappe.db.sql(
		f"""
		select m.name from `tab{SAMPLE_DT}` s inner join `tab{MANIFEST_DT}` m on m.name = s.parent
		where s.parenttype = %(dt)s and m.status in %(open)s and m.name != %(exclude)s and s.locked = 1
		and s.customer_trf = %(trf)s and (s.trf_tube_row = %(row)s or ifnull(s.trf_tube_row, '') = '' or %(row)s = '')
		limit 1
		""",
		{"dt": MANIFEST_DT, "open": OPEN_STATUSES, "exclude": exclude or "", "trf": trf, "row": tube_row or ""},
	)
	return rows[0][0] if rows else None


def _sample_rows(raw, doc):
	"""Rows for one scanned code. Every code is recorded; only Remedium tubes going to a Remedium-linked lab are locked."""
	universal = _pf_barcode(raw)
	base = {"sample_code": raw, "sample_status": "Pending", "universal_barcode": universal}
	if not doc.remedium_lab:
		return [{**base, "unverified": 0 if universal else 1}]
	hit = resolve_sample(raw)
	if not hit:
		return [{**base, "unverified": 0 if universal else 1, "validation_note": _("Not a Remedium tube or TRF: recorded, not locked")}]
	trf = frappe.db.get_value(TRF_DT, hit.trf, ["name", "order_status", "patient_name"], as_dict=True)
	info = {**base, "customer_trf": trf.name, "patient_name": trf.patient_name}
	if trf.order_status in ("Cancelled", "Completed"):
		return [{**info, "validation_note": _("TRF is {0}: recorded, not locked").format(trf.order_status)}]
	if not hit.has_tubes:
		other = locked_manifest_with(trf.name, exclude=doc.name)
		if other:
			return [{**info, "validation_note": _("Already locked on manifest {0}: recorded, not locked").format(other)}]
		return [{**info, "locked": 1, "validation_note": _("TRF has no draw plan: locked as a whole")}]
	out, notes = [], []
	for tube in hit.tubes:
		if tube.status in ("Received", "Rejected"):
			notes.append(_("{0} already {1}").format(tube.accession_id, cstr(tube.status).lower()))
			continue
		other = locked_manifest_with(trf.name, tube.name, exclude=doc.name)
		if other:
			notes.append(_("{0} locked on {1}").format(tube.accession_id, other))
			continue
		out.append(
			{
				**info,
				"sample_code": raw if hit.kind == "tube" else tube.accession_id,
				"accession_id": tube.accession_id,
				"universal_barcode": tube.get("universal_barcode") or universal,
				"trf_tube_row": tube.name,
				"tube_code": tube.tube_code,
				"locked": 1,
			}
		)
	if not out:
		return [{**info, "validation_note": ("; ".join(notes) or _("No open tube")) + _(": recorded, not locked")}]
	return out


def add_samples(doc, codes):
	raw_codes = []
	for c in _list(codes):
		c = cstr(c).strip()
		if c and c not in raw_codes:
			raw_codes.append(c)
	if len(raw_codes) + len(doc.get("samples") or []) > MAX_SAMPLES:
		_fail(_("At most {0} samples per manifest").format(MAX_SAMPLES))
	have = set()
	for row in doc.get("samples") or []:
		have.add(cstr(row.sample_code).upper())
		if row.accession_id:
			have.add(cstr(row.accession_id).upper())
	added, rejected = [], []
	for raw in raw_codes:
		if not SAMPLE_CODE_RE.match(raw):
			rejected.append({"code": raw[:60], "reason": _("Invalid characters in the code")})
			continue
		if raw.upper() in have:
			rejected.append({"code": raw, "reason": _("Already on this manifest")})
			continue
		for row in _sample_rows(raw, doc):
			if row.get("accession_id") and cstr(row["accession_id"]).upper() in have:
				continue
			doc.append("samples", row)
			have.add(cstr(row["sample_code"]).upper())
			if row.get("accession_id"):
				have.add(cstr(row["accession_id"]).upper())
		added.append(raw)
	doc.sample_count = len(doc.get("samples") or [])
	return added, rejected


def _stale_rows(doc):
	stale = []
	for row in doc.get("samples") or []:
		if cint(row.locked) and row.trf_tube_row and frappe.db.get_value(TUBE_DT, row.trf_tube_row, "status") in ("Received", "Rejected"):
			stale.append(row.accession_id or row.sample_code)
	return stale


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------


def _manifest_fields():
	fields = [
		"name",
		"manifest_date",
		"status",
		"collection_point_id",
		"collection_point_name",
		"receiving_lab",
		"receiving_lab_name",
		"remedium_lab",
		"mapping",
		"subscription",
		"icebox",
		"icebox_tier",
		"runner",
		"runner_name",
		"origin_scan_event",
		"pickup_scan_event",
		"destination_scan_event",
		"dispatched_at",
		"received_at",
		"transit_tat_minutes",
		"expected_tat_minutes",
		"tat_breached",
		"temp_out_c",
		"temp_out_set",
		"temp_in_c",
		"temp_in_set",
		"temp_excursion",
		"seal_no",
		"notes",
		"sample_count",
		"exception_count",
		"last_exception",
		"pickup_window_start",
		"pickup_window_end",
		"overdue_alerted_at",
		"cancel_reason",
	]
	if _has_field(MANIFEST_DT, "partner_shipment"):
		fields.append("partner_shipment")
	return fields


def sample_row(row):
	return {
		"name": row.get("name"),
		"sample_code": row.get("sample_code"),
		"universal_barcode": row.get("universal_barcode"),
		"customer_trf": row.get("customer_trf"),
		"accession_id": row.get("accession_id"),
		"trf_tube_row": row.get("trf_tube_row"),
		"tube_code": row.get("tube_code"),
		"patient_name": row.get("patient_name"),
		"sample_status": row.get("sample_status"),
		"locked": cint(row.get("locked")),
		"unverified": cint(row.get("unverified")),
		"validation_note": row.get("validation_note"),
	}


def manifest_payload(doc, samples=True):
	g = doc.get
	out = {
		"name": g("name"),
		"manifest_date": _str(g("manifest_date")),
		"status": g("status"),
		"collection_point_id": g("collection_point_id"),
		"collection_point_name": g("collection_point_name"),
		"receiving_lab": g("receiving_lab"),
		"receiving_lab_name": g("receiving_lab_name"),
		"remedium_linked": bool(g("remedium_lab")),
		"mapping": g("mapping"),
		"subscription": g("subscription"),
		"icebox": g("icebox"),
		"icebox_tier": g("icebox_tier"),
		"runner": g("runner"),
		"runner_name": g("runner_name"),
		"origin_scan_event": g("origin_scan_event"),
		"pickup_scan_event": g("pickup_scan_event"),
		"destination_scan_event": g("destination_scan_event"),
		"dispatched_at": _str(g("dispatched_at")),
		"received_at": _str(g("received_at")),
		"transit_tat_minutes": cint(g("transit_tat_minutes")) if g("received_at") else None,
		"expected_tat_minutes": cint(g("expected_tat_minutes")) or None,
		"tat_breached": cint(g("tat_breached")),
		"temp_out_c": flt(g("temp_out_c"), 1) if cint(g("temp_out_set")) else None,
		"temp_in_c": flt(g("temp_in_c"), 1) if cint(g("temp_in_set")) else None,
		"temp_excursion": cint(g("temp_excursion")),
		"seal_no": g("seal_no"),
		"notes": g("notes"),
		"sample_count": cint(g("sample_count")),
		"exception_count": cint(g("exception_count")),
		"last_exception": g("last_exception"),
		"pickup_window_start": _hhmm(g("pickup_window_start")),
		"pickup_window_end": _hhmm(g("pickup_window_end")),
		"overdue_alerted_at": _str(g("overdue_alerted_at")),
		"cancel_reason": g("cancel_reason"),
		"partner_shipment": g("partner_shipment"),
	}
	if samples:
		out["samples"] = [sample_row(r) for r in (g("samples") or [])]
	return out


def _manifest_rows(filters, order_by="creation desc", limit=200, or_filters=None):
	return [
		manifest_payload(r, samples=False)
		for r in frappe.get_all(MANIFEST_DT, filters=filters, or_filters=or_filters, fields=_manifest_fields(), order_by=order_by, limit=limit)
	]


def manifest_doc(name, lock=False):
	name = cstr(name).strip()
	if not name or not frappe.db.exists(MANIFEST_DT, name):
		_missing(_("Manifest {0} not found").format(name))
	if lock:
		_lock(MANIFEST_DT, name)
	return frappe.get_doc(MANIFEST_DT, name)


def _assert_center(doc, center):
	if doc.collection_point_id != center:
		_deny(_("Manifest {0} belongs to another center").format(doc.name))


def _apply_route(doc, mapping, sub=None, box=None):
	doc.mapping = mapping.name
	doc.receiving_lab = mapping.authorized_receiving_lab_id
	doc.receiving_lab_name = mapping.lab_name or party_display("lab", mapping.authorized_receiving_lab_id)
	doc.remedium_lab = remedium_lab_of(mapping.authorized_receiving_lab_id)
	doc.expected_tat_minutes = cint(mapping.expected_tat_minutes)
	doc.pickup_window_start = sub.pickup_window_start if sub else None
	doc.pickup_window_end = sub.pickup_window_end if sub else None
	if sub:
		doc.subscription = sub.name
	if box:
		doc.icebox = box.name
		doc.icebox_tier = box.tier


def _new_manifest(center, notes=None):
	doc = frappe.new_doc(MANIFEST_DT)
	doc.manifest_date = getdate(today())
	doc.status = ST_PENDING
	doc.collection_point_id = center
	doc.collection_point_name = party_display("center", center)
	doc.notes = cstr(notes).strip()[:2000] or None
	return doc


def center_scope(ctx, center=None, require_active=True):
	"""The center a request acts for: managers name it, users default to their only center."""
	center = cstr(center).strip()
	if ctx.centers is None:
		if not center:
			_fail(_("Choose the center"))
	elif center:
		if center not in ctx.centers:
			_deny(_("You are not linked to center {0}").format(center))
	elif len(ctx.centers) == 1:
		center = ctx.centers[0]
	else:
		_fail(_("Choose the center"))
	return _check_center(center, require_active=require_active)


def create_manifest(ctx, payload):
	p = payload or {}
	center = center_scope(ctx, p.get("center"))
	mapping, subs = gate(center)
	box, sub = None, (subs[0] if len(subs) == 1 else None)
	if cstr(p.get("icebox_code")).strip():
		box, sub = icebox_for_dispatch(p.get("icebox_code"), center, subs)
	doc = _new_manifest(center, p.get("notes"))
	_apply_route(doc, mapping, sub, box)
	added, rejected = add_samples(doc, p.get("samples"))
	doc.insert(ignore_permissions=True)
	if box:
		_set_icebox(box.name, status="At Collection Point", holder=(CENTER_DT, center))
	return {"manifest": manifest_payload(doc), "added": added, "rejected": rejected}


def _pending_doc(ctx, name):
	doc = manifest_doc(name, lock=True)
	if not ctx.is_manager:
		_assert_center(doc, center_scope(ctx, doc.collection_point_id))
	if doc.status != ST_PENDING:
		_fail(_("Manifest {0} is {1}; samples can only change before pickup").format(doc.name, doc.status))
	return doc


def manifest_add_samples(ctx, name, codes):
	doc = _pending_doc(ctx, name)
	added, rejected = add_samples(doc, codes)
	doc.save(ignore_permissions=True)
	return {"manifest": manifest_payload(doc), "added": added, "rejected": rejected}


def manifest_remove_sample(ctx, name, code):
	doc = _pending_doc(ctx, name)
	code = cstr(code).strip().upper()
	keep = [r for r in doc.samples if code not in (cstr(r.sample_code).upper(), cstr(r.accession_id).upper(), cstr(r.name).upper())]
	if len(keep) == len(doc.samples):
		_fail(_("{0} is not on this manifest").format(code))
	doc.set("samples", keep)
	doc.sample_count = len(keep)
	doc.save(ignore_permissions=True)
	return manifest_payload(doc)


def _icebox_back_to_center(code):
	if code and frappe.db.get_value(ICEBOX_DT, code, "status") in ("At Collection Point", "In Transit"):
		box = get_icebox(code)
		holder = (CENTER_DT, box.collection_point_id) if box.collection_point_id else False
		_set_icebox(code, status="Assigned" if box.subscription else "In Stock", holder=holder)


def cancel_manifest(ctx, name, reason=None):
	doc = manifest_doc(name, lock=True)
	reason = cstr(reason).strip()[:500]
	if not ctx.is_manager:
		_assert_center(doc, center_scope(ctx, doc.collection_point_id, require_active=False))
		if doc.status != ST_PENDING:
			_deny(_("Only operations can cancel a manifest after pickup"))
	if doc.status not in OPEN_STATUSES:
		_fail(_("Manifest {0} is {1}").format(doc.name, doc.status))
	if doc.status == ST_TRANSIT:
		if not reason:
			_fail(_("Give a reason to cancel a manifest in transit"))
		record_scan_event(
			doc.icebox, "Exception", code_type="Icebox", actor_role="Operations", ref_doctype=MANIFEST_DT, ref_name=doc.name, payload={"cancelled": True, "reason": reason}
		)
	doc.status = ST_CANCELLED
	doc.cancel_reason = reason or None
	doc.save(ignore_permissions=True)
	_icebox_back_to_center(doc.icebox)
	return manifest_payload(doc)


def mark_exception(ctx, name, reason):
	doc = manifest_doc(name, lock=True)
	reason = cstr(reason).strip()[:500]
	if not reason:
		_fail(_("Give the exception reason"))
	if doc.status not in OPEN_STATUSES:
		_fail(_("Manifest {0} is {1}").format(doc.name, doc.status))
	if doc.icebox:
		record_scan_event(
			doc.icebox, "Exception", code_type="Icebox", actor_role="Operations", ref_doctype=MANIFEST_DT, ref_name=doc.name, payload={"exception": True, "reason": reason}
		)
	doc.status = ST_EXCEPTION
	doc.cancel_reason = reason
	doc.exception_count = cint(doc.exception_count) + 1
	doc.last_exception = reason
	doc.save(ignore_permissions=True)
	return manifest_payload(doc)


def can_view_manifest(ctx, doc):
	if ctx.is_manager:
		return True
	if doc.collection_point_id in parties_for_user("center", ctx.user):
		return True
	if doc.receiving_lab in parties_for_user("lab", ctx.user):
		return True
	runner = runner_for_user(ctx.user)
	return bool(runner and doc.runner == runner.name)


def manifest_detail(ctx, name):
	doc = manifest_doc(name)
	if not can_view_manifest(ctx, doc):
		_deny(_("Not your manifest"))
	return manifest_payload(doc)


# ---------------------------------------------------------------------------
# Origin scanner (center)
# ---------------------------------------------------------------------------


def _manifest_for_scan(center, code, name, has_samples):
	if name:
		doc = manifest_doc(name, lock=True)
		_assert_center(doc, center)
		if doc.status != ST_PENDING:
			_fail(_("Manifest {0} is {1}; only PENDING_PICKUP manifests can be dispatched").format(doc.name, doc.status))
		if doc.icebox and doc.icebox != code:
			_fail(_("Manifest {0} is packed in icebox {1}, not {2}").format(doc.name, doc.icebox, code))
		return doc
	pending = frappe.get_all(
		MANIFEST_DT, filters={"collection_point_id": center, "status": ST_PENDING}, fields=["name", "icebox"], order_by="creation desc", limit=50
	)
	same = [m for m in pending if m.icebox == code]
	if same:
		return manifest_doc(same[0].name, lock=True)
	blank = [m for m in pending if not m.icebox]
	if len(blank) == 1 and not has_samples:
		return manifest_doc(blank[0].name, lock=True)
	if len(blank) > 1 and not has_samples:
		_fail(_("Several manifests are waiting for pickup; choose one"))
	return None


def _event_card(ev):
	return {k: ev.get(k) for k in ("name", "seq", "event", "prev_event")}


def origin_scan(ctx, payload):
	p = payload or {}
	center = center_scope(ctx, p.get("center"))
	mapping, subs = gate(center)
	code = icebox_code(p.get("icebox_code"))
	samples = _list(p.get("samples"))
	doc = _manifest_for_scan(center, code, cstr(p.get("manifest")).strip() or None, bool(samples)) or _new_manifest(center, p.get("notes"))
	box, sub = icebox_for_dispatch(code, center, subs, manifest=doc.name)
	runner = resolve_runner(p.get("runner_id"))
	warnings = []
	designated = [r for r in (mapping.default_runner, box.assigned_runner) if r]
	if designated and runner.name not in designated:
		if cint(p.get("override_runner")) and ctx.is_manager:
			warnings.append(_("{0} is not the designated runner; dispatched under manager override").format(runner.full_name or runner.name))
		else:
			names = ", ".join(sorted({frappe.db.get_value(FP_DT, d, "full_name") or d for d in designated}))
			_fail(
				_("{0} is not the designated runner for this pickup ({1}); a Teleporter Manager can override").format(runner.full_name or runner.name, names)
			)
	if not doc.is_new() and (doc.mapping != mapping.name or doc.receiving_lab != mapping.authorized_receiving_lab_id):
		warnings.append(_("Receiving lab updated to the current mapping ({0})").format(mapping.lab_name or mapping.authorized_receiving_lab_id))
	_apply_route(doc, mapping, sub, box)
	added, rejected = add_samples(doc, samples) if samples else ([], [])
	stale = _stale_rows(doc)
	if stale:
		_fail(_("Remove samples already received or rejected at the lab: {0}").format(", ".join(stale[:10])))
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	temp_out = _temp_value(p.get("temp_out_c"))
	seal = cstr(p.get("seal_no")).strip()[:140]
	common = {
		"code_type": "Icebox",
		"location_doctype": CENTER_DT,
		"location_name": center,
		"lat": p.get("lat"),
		"lng": p.get("lng"),
		"device_id": p.get("device_id"),
		"ref_doctype": MANIFEST_DT,
		"ref_name": doc.name,
	}
	info = {"manifest": doc.name, "runner": runner.name, "seal_no": seal, "temp_out_c": temp_out, "samples": len(doc.samples), "receiving_lab": doc.receiving_lab}
	e1 = record_scan_event(code, "Dispatched", actor_role="Teleporter Center", payload=info, **common)
	e2 = record_scan_event(code, "Picked Up", actor_user=runner.user, actor_role=ROLE_RUNNER, payload={**info, "handed_over_by": ctx.user}, **common)
	_pf_dispatched(doc, code, runner, common)
	temp = temp_check(box.tier, temp_out)
	doc.update(
		{
			"status": ST_TRANSIT,
			"runner": runner.name,
			"runner_name": runner.full_name,
			"seal_no": seal or doc.seal_no,
			"dispatched_at": now_datetime(),
			"dispatched_by": ctx.user,
			"origin_scan_event": e1["name"],
			"pickup_scan_event": e2["name"],
		}
	)
	if temp_out is not None:
		doc.temp_out_c, doc.temp_out_set = temp_out, 1
	if temp["ok"] is False:
		doc.temp_excursion = 1
		warnings.append(_("Temperature {0} °C is outside the {1} range ({2} to {3} °C)").format(temp_out, box.tier, temp["min"], temp["max"]))
	for row in doc.samples:
		if row.sample_status == "Pending":
			row.sample_status = "Sealed"
	doc.sample_count = len(doc.samples)
	doc.save(ignore_permissions=True)
	_set_icebox(code, status="In Transit", holder=(FP_DT, runner.name), temp=temp_out, event=e2["name"])
	verification = verify_chain(code)
	shipment = _link_partner_shipment(doc)
	if shipment:
		doc.reload()
	return {
		"manifest": manifest_payload(doc),
		"events": [_event_card(e1), _event_card(e2)],
		"verification": verification,
		"rejected": rejected,
		"added": added,
		"warnings": warnings,
		"partner_shipment": shipment,
	}


def _pf_dispatched(doc, icebox, runner, common):
	"""Soft hook: extend PhleboFirst universal barcodes' custody chains; never blocks the shipment."""
	for row in doc.samples:
		if not row.universal_barcode or not _pf_barcode(row.universal_barcode):
			continue
		try:
			record_scan_event(
				row.universal_barcode,
				"Dispatched",
				actor_user=runner.user,
				actor_role=ROLE_RUNNER,
				payload={"manifest": doc.name, "icebox": icebox, "runner": runner.name},
				**{**common, "code_type": "Universal Barcode"},
			)
		except Exception:
			frappe.log_error(title="phase134 PF dispatched", message=f"{doc.name} {row.universal_barcode}\n{frappe.get_traceback()}")


def _pf_received(doc):
	"""Soft hook: phase 133 marks bound PhleboFirst barcodes Received (status + custody) on lab arrival."""
	pf = _pf_module()
	if not pf:
		return
	for row in doc.samples:
		code = row.universal_barcode
		if not code or not _pf_barcode(code):
			continue
		try:
			bound = frappe.db.get_value(pf.UB_DT, code, ["bound_trf", "bound_tube_row", "bound_accession"], as_dict=True) or {}
			if bound.get("bound_trf"):
				tube = frappe._dict(universal_barcode=code, accession_id=bound.get("bound_accession"), name=bound.get("bound_tube_row"))
				pf.on_trf_tube_received(bound.get("bound_trf"), tube)
		except Exception:
			_clear_messages()
			frappe.log_error(title="phase134 PF received", message=f"{doc.name} {code}\n{frappe.get_traceback()}")


def _link_partner_shipment(doc):
	"""Remedium Master FOCO center -> its mapped Remedium lab: keep the partner-circuit shipment record so the MF
	share posts on receipt. Runs last because create_partner_shipment commits."""
	if doc.get("partner_shipment") or not doc.remedium_lab or not _has_field(MANIFEST_DT, "partner_shipment"):
		return None
	fid = frappe.db.get_value(CENTER_DT, doc.collection_point_id, "linked_franchisee")
	if not fid or not frappe.db.exists("DocType", PARTNER_SHIP_DT):
		return None
	try:
		from health_ecosystem_core.health_ecosystem_core import clinical_phase126_partner_tiers as circuit_mod

		circuit = circuit_mod.partner_circuit(fid)
		if circuit.get("tier") != circuit_mod.TIER_MF or circuit.get("has_lab") or circuit.get("lab") != doc.remedium_lab:
			return None
		pending = {p["trf"] for p in circuit_mod.pending_accession_samples(fid, limit=1000)}
		trfs = sorted({r.customer_trf for r in doc.samples if r.customer_trf and cint(r.locked)} & pending)
		if not trfs:
			return None
		data = {"trfs": trfs, "lr_number": doc.name, "courier": "Teleporter", "remarks": f"Teleporter manifest {doc.name}, icebox {doc.icebox}"}
		if cint(doc.temp_out_set):
			data["icebox_temp_c"] = doc.temp_out_c
		res = circuit_mod.create_partner_shipment(fid, data)
		shipment = (res.get("shipment") or {}).get("id")
		if shipment:
			frappe.db.set_value(MANIFEST_DT, doc.name, "partner_shipment", shipment, update_modified=False)
		return shipment
	except Exception:
		_clear_messages()
		frappe.log_error(title="phase134 partner shipment link", message=f"{doc.name}\n{frappe.get_traceback()}")
		return None


# ---------------------------------------------------------------------------
# Destination scanner (lab) and accession unlock
# ---------------------------------------------------------------------------


def lab_scope(ctx, lab, manifest_lab=None):
	lab = cstr(lab).strip() or None
	if ctx.labs is None:
		return _check_lab(lab or manifest_lab)
	if lab:
		if lab not in ctx.labs:
			_deny(_("You are not linked to lab {0}").format(lab))
	elif manifest_lab in ctx.labs:
		lab = manifest_lab
	elif len(ctx.labs) == 1:
		lab = ctx.labs[0]
	else:
		_fail(_("Choose the lab"))
	return _check_lab(lab)


def _receipt_problem(doc, box, lab, code):
	mapping = frappe.db.get_value(MAP_DT, doc.mapping, MAPPING_FIELDS, as_dict=True) if doc.mapping else None
	if not mapping:
		return _("Manifest {0} has no Collection To Lab Mapping; receipt refused").format(doc.name)
	if lab != mapping.authorized_receiving_lab_id or lab != doc.receiving_lab:
		return _("Wrong lab: manifest {0} is authorised only for {1}; icebox {2} was scanned at {3}").format(
			doc.name, mapping.lab_name or mapping.authorized_receiving_lab_id, code, party_display("lab", lab)
		)
	if doc.collection_point_id != mapping.collection_point_id:
		return _("Wrong origin: manifest {0} came from {1} but its mapping is for {2}").format(
			doc.name, party_display("center", doc.collection_point_id), mapping.collection_point_name or mapping.collection_point_id
		)
	if box.collection_point_id and box.collection_point_id != doc.collection_point_id:
		return _("Wrong origin: icebox {0} is assigned to {1}, not {2}").format(
			code, box.collection_point_name or box.collection_point_id, party_display("center", doc.collection_point_id)
		)
	if not doc.pickup_scan_event:
		return _("Manifest {0} has no runner pickup scan").format(doc.name)
	chain = verify_chain(code)
	if not chain["ok"]:
		return _("Custody chain of icebox {0} is broken at event {1} ({2})").format(code, chain["broken_at"], chain["reason"])
	return None


def destination_scan(ctx, payload):
	p = payload or {}
	code = icebox_code(p.get("icebox_code"))
	box = get_icebox(code, lock=True)
	name = frappe.db.get_value(MANIFEST_DT, {"icebox": code, "status": ST_TRANSIT}, "name")
	if not name:
		pending = frappe.db.get_value(MANIFEST_DT, {"icebox": code, "status": ST_PENDING}, "name")
		if pending:
			_fail(_("Icebox {0} is on manifest {1}, which has not been dispatched (no origin scan yet)").format(code, pending))
		_fail(_("Icebox {0} has no manifest in transit").format(code))
	doc = manifest_doc(name, lock=True)
	lab = lab_scope(ctx, p.get("lab"), doc.receiving_lab)
	temp_in = _temp_value(p.get("temp_in_c"))
	common = {
		"code_type": "Icebox",
		"location_doctype": LAB_DT,
		"location_name": lab,
		"lat": p.get("lat"),
		"lng": p.get("lng"),
		"device_id": p.get("device_id"),
		"ref_doctype": MANIFEST_DT,
		"ref_name": doc.name,
	}
	problem = _receipt_problem(doc, box, lab, code)
	if problem:
		record_scan_event(
			code,
			"Exception",
			actor_role="Teleporter Lab",
			payload={"reason": problem, "scanning_lab": lab, "expected_lab": doc.receiving_lab, "origin": doc.collection_point_id, "temp_in_c": temp_in},
			**common,
		)
		frappe.db.set_value(MANIFEST_DT, doc.name, {"exception_count": cint(doc.exception_count) + 1, "last_exception": problem[:500]}, update_modified=False)
		frappe.db.commit()
		_fail(problem)
	now = now_datetime()
	tat = max(0, int(time_diff_in_seconds(now, doc.dispatched_at) // 60)) if doc.dispatched_at else None
	expected = cint(doc.expected_tat_minutes)
	breached = bool(expected and tat is not None and tat > expected)
	temp = temp_check(doc.icebox_tier or box.tier, temp_in)
	ev = record_scan_event(
		code,
		"Received At Lab",
		actor_role="Teleporter Lab",
		payload={"manifest": doc.name, "temp_in_c": temp_in, "transit_tat_minutes": tat, "tat_breached": breached, "samples": len(doc.samples)},
		**common,
	)
	unlocked = 0
	for row in doc.samples:
		if row.sample_status == "Sealed":
			row.sample_status = "Unlocked"
			unlocked += 1
	doc.update(
		{
			"status": ST_RECEIVED,
			"destination_scan_event": ev["name"],
			"received_at": now,
			"received_by": ctx.user,
			"transit_tat_minutes": tat or 0,
			"tat_breached": 1 if breached else 0,
		}
	)
	if temp_in is not None:
		doc.temp_in_c, doc.temp_in_set = temp_in, 1
	if temp["ok"] is False:
		doc.temp_excursion = 1
	note = cstr(p.get("notes")).strip()
	if note:
		doc.notes = (cstr(doc.notes) + "\n" + _("At lab: {0}").format(note)).strip()[:2000]
	doc.save(ignore_permissions=True)
	_set_icebox(code, status="At Lab", holder=(LAB_DT, lab), temp=temp_in, event=ev["name"])
	_pf_received(doc)
	shipment = _receive_partner_shipment(doc, ctx)
	return {
		"manifest": manifest_payload(doc),
		"transit_tat_minutes": tat,
		"expected_tat_minutes": expected or None,
		"tat_breached": breached,
		"temp": temp,
		"event": {"name": ev["name"], "seq": ev["seq"]},
		"unlocked": unlocked,
		"remedium_linked": bool(doc.remedium_lab),
		"partner_shipment": shipment,
	}


def _receive_partner_shipment(doc, ctx):
	shipment = doc.get("partner_shipment")
	if not shipment or not doc.remedium_lab:
		return None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import receive_partner_shipment

		receive_partner_shipment(doc.remedium_lab, shipment, roles=ctx.roles)
	except Exception:
		_clear_messages()
		frappe.log_error(title="phase134 partner shipment receipt", message=f"{doc.name}\n{frappe.get_traceback()}")
	return shipment


def accession_unlocked(ctx, name):
	"""Remedium-linked labs only: receive every unlocked Remedium tube through the normal accession desk."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import receive_trf_tube

	doc = manifest_doc(name)
	if ctx.labs is not None and doc.receiving_lab not in ctx.labs:
		_deny(_("Manifest {0} is for another lab").format(doc.name))
	if not doc.remedium_lab:
		_fail(_("This lab is not linked to a Remedium lab; accession happens in your own system"))
	if doc.status not in (ST_RECEIVED, ST_EXCEPTION):
		_fail(_("Scan the icebox at reception first (manifest {0} is {1})").format(doc.name, doc.status))
	results = []
	for row in list(doc.samples):
		if not cint(row.locked):
			continue
		if row.sample_status != "Unlocked" and not (row.sample_status == "Sealed" and doc.status == ST_EXCEPTION):
			continue
		code = row.accession_id or row.sample_code
		if row.trf_tube_row:
			targets = [row.accession_id]
		else:
			targets = frappe.get_all(
				TUBE_DT, filters={"parent": row.customer_trf, "parenttype": TRF_DT, "status": ("in", ("Planned", "Drawn"))}, pluck="accession_id", order_by="idx asc"
			)
			if not targets:
				results.append({"code": code, "accession_id": None, "ok": False, "message": _("TRF has no tubes to receive; accession at the desk")})
				continue
		for acc in targets:
			frappe.db.savepoint("tp_accession")
			try:
				receive_trf_tube(trf_id=row.customer_trf, accession_id=acc)
				results.append({"code": code, "accession_id": acc, "ok": True, "message": _("Received")})
			except Exception as exc:
				try:
					frappe.db.rollback(save_point="tp_accession")
				except Exception:
					pass
				_clear_messages()
				results.append({"code": code, "accession_id": acc, "ok": False, "message": cstr(exc)[:300] or _("Could not receive")})
	doc.reload()
	ok = sum(1 for r in results if r["ok"])
	return {"results": results, "accessioned": ok, "failed": len(results) - ok, "manifest": manifest_payload(doc)}


def sealed_manifest_for_tube(trf_id, row):
	"""Teleporter manifest in transit that holds this tube (or its whole TRF) under the accession lock; None otherwise."""
	if not trf_id or not row or not frappe.db.exists("DocType", SAMPLE_DT) or not _has_field(SAMPLE_DT, "locked"):
		return None
	rows = frappe.db.sql(
		f"""
		select m.name from `tab{SAMPLE_DT}` s inner join `tab{MANIFEST_DT}` m on m.name = s.parent
		where s.parenttype = %(dt)s and m.status = %(st)s and s.locked = 1 and s.sample_status = 'Sealed'
		and s.customer_trf = %(trf)s and (s.trf_tube_row = %(row)s or ifnull(s.trf_tube_row, '') = '')
		limit 1
		""",
		{"dt": MANIFEST_DT, "st": ST_TRANSIT, "trf": trf_id, "row": cstr(row.get("name"))},
	)
	return rows[0][0] if rows else None


def _mark_samples(trf_id, row, status, note=None):
	if not frappe.db.exists("DocType", SAMPLE_DT) or not _has_field(SAMPLE_DT, "locked"):
		return 0
	names = frappe.db.sql_list(
		f"""
		select s.name from `tab{SAMPLE_DT}` s inner join `tab{MANIFEST_DT}` m on m.name = s.parent
		where s.parenttype = %(dt)s and s.locked = 1 and s.customer_trf = %(trf)s
		and (s.trf_tube_row = %(row)s or ifnull(s.trf_tube_row, '') = '')
		and (s.sample_status = 'Unlocked' or (s.sample_status = 'Sealed' and m.status = %(exc)s))
		""",
		{"dt": MANIFEST_DT, "trf": trf_id, "row": cstr(row.get("name")), "exc": ST_EXCEPTION},
	)
	for name in names:
		values = {"sample_status": status}
		if status == "Accessioned":
			values["accessioned_at"] = now_datetime()
		if note:
			values["validation_note"] = cstr(note)[:500]
		frappe.db.set_value(SAMPLE_DT, name, values, update_modified=False)
	return len(names)


def on_trf_tube_received(trf_id, row):
	return _mark_samples(trf_id, row, "Accessioned")


def on_trf_tube_rejected(trf_id, row, reason=None):
	return _mark_samples(trf_id, row, "Rejected", reason)


# ---------------------------------------------------------------------------
# Views: center, runner, lab, ops
# ---------------------------------------------------------------------------


def my_point(ctx, center=None):
	center = center_scope(ctx, center, require_active=False)
	party = party_payload("center", center)
	mapping = active_mapping(center)
	subs = active_subscriptions(center)
	sub = subs[0] if subs else None
	if not sub:
		latest = frappe.get_all(SUB_DT, filters={"collection_point_id": center, "status": ("!=", "Cancelled")}, fields=SUB_FIELDS, order_by="modified desc", limit=1)
		sub = latest[0] if latest else None
	boxes = frappe.get_all(ICEBOX_DT, filters={"collection_point_id": center}, fields=ICEBOX_FIELDS, order_by="name asc", limit=200)
	problems = []
	if party["status"] != "Active":
		problems.append(_("Your center is {0}; operations will review it").format(party["status"]))
	if not mapping:
		problems.append(_("No active mapping to a receiving lab: operations will set it up"))
	elif party_status("lab", mapping.authorized_receiving_lab_id) != "Active":
		problems.append(_("The mapped lab is not active"))
	if not subs:
		problems.append(_("No Active, in-date subscription") + (f" ({sub.name}: {sub.status})" if sub else ""))
	if subs and not any(b.subscription in {s.name for s in subs} and b.status not in ("Retired", "Maintenance") for b in boxes):
		problems.append(_("No usable icebox is assigned to the active subscription"))
	return {
		"center": party,
		"subscription": subscription_row(sub) if sub else None,
		"subscriptions": [subscription_row(s) for s in subs],
		"mapping": mapping_row(mapping) if mapping else None,
		"iceboxes": [icebox_row(b) for b in boxes],
		"ready": not problems,
		"problems": problems,
		"pending_manifests": [
			manifest_payload(frappe.get_doc(MANIFEST_DT, n))
			for n in frappe.get_all(MANIFEST_DT, filters={"collection_point_id": center, "status": ST_PENDING}, pluck="name", order_by="creation desc", limit=20)
		],
	}


def my_manifests(ctx, center=None, status=None, days=14):
	center = center_scope(ctx, center, require_active=False)
	filters = [["collection_point_id", "=", center]]
	if status:
		filters.append(["status", "=", status])
	else:
		filters.append(["manifest_date", ">=", add_days(today(), -max(1, min(cint(days) or 14, 90)))])
	return {"rows": _manifest_rows(filters)}


def runner_today(ctx):
	runner = ctx.runner
	maps = [m for m in frappe.get_all(MAP_DT, filters={"default_runner": runner.name, "active": 1}, fields=MAPPING_FIELDS, limit=200) if _in_effect(m)]
	boxes = frappe.get_all(ICEBOX_DT, filters={"assigned_runner": runner.name}, fields=ICEBOX_FIELDS, order_by="name asc", limit=200)
	route = []
	for mp in maps:
		subs = active_subscriptions(mp.collection_point_id)
		sub = subs[0] if subs else None
		open_row = frappe.get_all(
			MANIFEST_DT, filters={"collection_point_id": mp.collection_point_id, "status": ("in", OPEN_STATUSES)}, fields=["name", "status"], order_by="creation desc", limit=1
		)
		route.append(
			{
				"mapping": mp.name,
				"collection_point_id": mp.collection_point_id,
				"collection_point_name": mp.collection_point_name,
				"receiving_lab": mp.authorized_receiving_lab_id,
				"receiving_lab_name": mp.lab_name,
				"pickup_window_start": _hhmm(sub.pickup_window_start) if sub else None,
				"pickup_window_end": _hhmm(sub.pickup_window_end) if sub else None,
				"subscription_active": bool(sub),
				"open_manifest": open_row[0].name if open_row else None,
				"open_status": open_row[0].status if open_row else None,
			}
		)
	route.sort(key=lambda r: (r["pickup_window_start"] or "99:99", cstr(r["collection_point_name"])))
	or_filters = [["runner", "=", runner.name]]
	if maps:
		or_filters.append(["mapping", "in", [m.name for m in maps]])
	if boxes:
		or_filters.append(["icebox", "in", [b.name for b in boxes]])
	open_rows = _manifest_rows({"status": ("in", OPEN_STATUSES)}, order_by="creation asc", or_filters=or_filters)
	done = _manifest_rows({"runner": runner.name, "status": ST_RECEIVED, "received_at": (">=", getdate(today()))}, order_by="received_at desc")
	return {"runner": _runner_card(runner), "route": route, "manifests": open_rows + done, "iceboxes": [icebox_row(b) for b in boxes]}


def runner_badge(ctx):
	runner = ctx.runner
	return {"runner_id": runner.name, "full_name": runner.full_name, "svg": code128_svg(runner.name, module=3, height=90, quiet=12, font_size=18)}


def _lab_list(ctx):
	labs = frappe.get_all(LAB_DT, filters={"status": "Active"}, pluck="name", limit=500) if ctx.labs is None else ctx.labs
	return [{"id": lab, "name": party_display("lab", lab), "remedium_linked": bool(remedium_lab_of(lab))} for lab in sorted(labs)]


def _lab_filter(ctx, lab):
	lab = cstr(lab).strip() or None
	if ctx.labs is None:
		return [lab] if lab else None
	if lab:
		if lab not in ctx.labs:
			_deny(_("You are not linked to lab {0}").format(lab))
		return [lab]
	return list(ctx.labs)


def lab_expected(ctx, lab=None):
	scope = _lab_filter(ctx, lab)
	filters = {"status": ("in", OPEN_STATUSES)}
	if scope is not None:
		filters["receiving_lab"] = ("in", scope)
	return {"labs": _lab_list(ctx), "expected": _manifest_rows(filters, order_by="dispatched_at asc, creation asc")}


def lab_received(ctx, lab=None, days=7):
	scope = _lab_filter(ctx, lab)
	filters = {"status": ("in", (ST_RECEIVED, ST_EXCEPTION)), "modified": (">=", add_days(today(), -max(1, min(cint(days) or 7, 90))))}
	if scope is not None:
		filters["receiving_lab"] = ("in", scope)
	return {"rows": _manifest_rows(filters, order_by="received_at desc")}


def manifests_board(filters=None, page=1, page_size=50):
	filters = filters or {}
	base = []
	if filters.get("date_from"):
		base.append(["manifest_date", ">=", getdate(filters["date_from"])])
	if filters.get("date_to"):
		base.append(["manifest_date", "<=", getdate(filters["date_to"])])
	for key, field in (("center", "collection_point_id"), ("lab", "receiving_lab"), ("runner", "runner"), ("icebox", "icebox")):
		if filters.get(key):
			base.append([field, "=", filters[key]])
	counts = {r.status: cint(r.n) for r in frappe.get_all(MANIFEST_DT, filters=base, fields=["status", "count(name) as n"], group_by="status", limit=0)}
	rows_filters = list(base)
	if filters.get("status"):
		rows_filters.append(["status", "=", filters["status"]])
	page = max(1, cint(page) or 1)
	size = min(max(1, cint(page_size) or 50), 200)
	rows = [
		manifest_payload(r, samples=False)
		for r in frappe.get_all(MANIFEST_DT, filters=rows_filters, fields=_manifest_fields(), order_by="creation desc", start=(page - 1) * size, limit=size)
	]
	return {"rows": rows, "total": frappe.db.count(MANIFEST_DT, rows_filters), "counts": counts, "page": page, "page_size": size}


def tat_report(date_from=None, date_to=None, lab=None, center=None):
	date_from = getdate(date_from or add_days(today(), -30))
	date_to = getdate(date_to or today())
	conds = ["status = %(st)s", "date(received_at) between %(f)s and %(t)s"]
	values = {"st": ST_RECEIVED, "f": date_from, "t": date_to}
	if lab:
		conds.append("receiving_lab = %(lab)s")
		values["lab"] = lab
	if center:
		conds.append("collection_point_id = %(center)s")
		values["center"] = center
	rows = frappe.db.sql(
		f"""
		select collection_point_id, max(collection_point_name) as collection_point_name,
			receiving_lab, max(receiving_lab_name) as receiving_lab_name, count(*) as manifests,
			avg(transit_tat_minutes) as avg_tat_minutes, max(transit_tat_minutes) as max_tat_minutes,
			sum(tat_breached) as breached, max(expected_tat_minutes) as expected_tat_minutes,
			sum(temp_excursion) as temp_excursions
		from `tab{MANIFEST_DT}` where {' and '.join(conds)}
		group by collection_point_id, receiving_lab
		order by manifests desc
		""",
		values,
		as_dict=True,
	)
	out = [
		{
			"collection_point_id": r.collection_point_id,
			"collection_point_name": r.collection_point_name,
			"receiving_lab": r.receiving_lab,
			"receiving_lab_name": r.receiving_lab_name,
			"manifests": cint(r.manifests),
			"avg_tat_minutes": round(flt(r.avg_tat_minutes), 1),
			"max_tat_minutes": cint(r.max_tat_minutes),
			"breached": cint(r.breached),
			"expected_tat_minutes": cint(r.expected_tat_minutes) or None,
			"temp_excursions": cint(r.temp_excursions),
		}
		for r in rows
	]
	total = sum(r["manifests"] for r in out)
	avg = round(sum(r["avg_tat_minutes"] * r["manifests"] for r in out) / total, 1) if total else None
	return {
		"date_from": cstr(date_from),
		"date_to": cstr(date_to),
		"rows": out,
		"totals": {"manifests": total, "breached": sum(r["breached"] for r in out), "avg_tat_minutes": avg},
	}


def custody_lookup(code):
	raw = cstr(code).strip()
	if not raw:
		_fail(_("Enter a code"))
	if frappe.db.exists(MANIFEST_DT, raw):
		doc = frappe.get_doc(MANIFEST_DT, raw)
		events, verification = [], None
		if doc.icebox:
			chain = custody_events(doc.icebox)
			events = [e for e in chain["events"] if e.ref_name == doc.name]
			verification = chain["verification"]
		return {"code": raw, "kind": "manifest", "events": events, "verification": verification, "manifests": [manifest_payload(doc)]}
	upper = raw.upper()
	if parse_code(upper)["prefix"] == ICEBOX_PREFIX and frappe.db.exists(ICEBOX_DT, upper):
		chain = custody_events(upper)
		return {"code": upper, "kind": "icebox", "events": chain["events"], "verification": chain["verification"], "manifests": _manifest_rows({"icebox": upper}, limit=20)}
	names = frappe.db.sql_list(
		f"""
		select distinct parent from `tab{SAMPLE_DT}` where parenttype = %(dt)s
		and (sample_code = %(c)s or accession_id = %(c)s or universal_barcode = %(c)s or customer_trf = %(c)s)
		""",
		{"dt": MANIFEST_DT, "c": raw},
	)
	manifests = _manifest_rows({"name": ("in", list(set(names)))}, limit=50) if names else []
	chain = custody_events(upper) if re.match(r"^[A-Za-z0-9._:/-]{1,64}$", upper) else {"events": [], "verification": None}
	kind = "sample" if (manifests or chain["events"]) else "unknown"
	return {"code": raw, "kind": kind, "events": chain["events"], "verification": chain["verification"] if chain["events"] else None, "manifests": manifests}


def lookup(kind, q=None):
	q = cstr(q).strip()
	like = f"%{q}%"
	rows = []
	if kind in ("center", "lab"):
		k = _kind(kind)
		or_filters = [["name", "like", like], [k.name_field, "like", like], ["city", "like", like]] if q else None
		for r in frappe.get_all(k.dt, filters={"status": ("in", ("Active", "Pending Approval"))}, or_filters=or_filters, fields=["name", k.name_field, "status", "city"], limit=50):
			rows.append({"value": r.name, "label": r.get(k.name_field), "description": " · ".join(x for x in (r.city, r.status) if x)})
	elif kind in ("franchisee", "remedium_lab"):
		or_filters = [["name", "like", like], ["franchise_name", "like", like]] if q else None
		for p in frappe.get_all(PROFILE_DT, filters={"active_status": "Active"}, or_filters=or_filters, fields=["name", "franchise_name"], order_by="franchise_name asc", limit=300):
			if kind == "remedium_lab" and not is_lab_profile(p.name):
				continue
			rows.append({"value": p.name, "label": p.franchise_name or p.name, "description": p.name})
	elif kind == "runner":
		for r in list_runners(q)["rows"]:
			if r["is_runner"]:
				rows.append({"value": r["provider"], "label": r["full_name"] or r["user"], "description": r["mobile"] or r["user"]})
	elif kind == "subscription":
		or_filters = [["name", "like", like], ["collection_point_name", "like", like]] if q else None
		for s in frappe.get_all(SUB_DT, filters={"status": ("in", SUB_OPEN)}, or_filters=or_filters, fields=["name", "collection_point_name", "tier", "status"], limit=50):
			rows.append({"value": s.name, "label": f"{s.collection_point_name} · {s.tier}", "description": s.status})
	else:
		_fail(_("Unknown lookup {0}").format(kind))
	return {"rows": rows[:50]}


def me(ctx):
	centers = parties_for_user("center", ctx.user)
	labs = parties_for_user("lab", ctx.user)
	cards = [party_card("center", c) for c in centers] + [party_card("lab", lab) for lab in labs]
	return {
		"user": ctx.user,
		"full_name": frappe.db.get_value("User", ctx.user, "full_name"),
		"roles": sorted(r for r in ctx.roles if r not in ("All", "Guest")),
		"is_manager": ctx.is_manager,
		"runner": _runner_card(runner_for_user(ctx.user)),
		"centers": [c for c in cards if c["kind"] == "center"],
		"labs": [c for c in cards if c["kind"] == "lab"],
		"pending": any(c["status"] == "Pending Approval" for c in cards),
	}


# ---------------------------------------------------------------------------
# Notifications and scheduler
# ---------------------------------------------------------------------------


def _notify(phone, message):
	if frappe.flags.tp_no_notify or not phone or not message:
		return
	try:
		frappe.enqueue(f"{MODULE_PATH}.tp_send_whatsapp_job", queue="short", enqueue_after_commit=True, phone=cstr(phone), text=cstr(message))
	except Exception:
		frappe.log_error(title="phase134 notify enqueue", message=frappe.get_traceback())


def tp_send_whatsapp_job(phone=None, text=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		send_whatsapp(phone, text, context={"source": "teleporter"})
	except Exception:
		frappe.log_error(title="phase134 WhatsApp", message=frappe.get_traceback())


def tp_expire_subscriptions(only=None):
	"""Daily: Active / Paused subscriptions past their end date expire; auto-renew ones open the next period as
	Pending Payment (operations activate it once paid)."""
	if not frappe.db.exists("DocType", SUB_DT):
		return {"skipped": "not installed"}
	filters = {"status": ("in", ("Active", "Paused")), "end_date": ("<", getdate(today()))}
	if only:
		filters["name"] = ("in", list(only))
	report = {"expired": 0, "renewal_due": 0, "errors": 0}
	for s in frappe.get_all(SUB_DT, filters=filters, fields=["name", "end_date", "billing_cycle", "auto_renew"], limit=1000):
		try:
			if cint(s.auto_renew):
				start = add_days(getdate(s.end_date), 1)
				end = _period_end(start, s.billing_cycle)
				frappe.db.set_value(
					SUB_DT, s.name, {"status": "Pending Payment", "start_date": start, "end_date": end, "status_reason": f"Auto-renewal due for {start} to {end}: awaiting payment"}
				)
				report["renewal_due"] += 1
			else:
				frappe.db.set_value(SUB_DT, s.name, {"status": "Expired", "status_reason": f"Ended {s.end_date}"})
				report["expired"] += 1
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase134 expire subscription", message=f"{s.name}\n{frappe.get_traceback()}")
	return report


def tp_overdue_transit_alerts(only=None, notify=1):
	"""Every 15 minutes: one WhatsApp alert per manifest in transit longer than the mapping's expected TAT (or the
	tier's hold time when no TAT is set) to the runner, the lab and the center."""
	if not frappe.db.exists("DocType", MANIFEST_DT):
		return {"skipped": "not installed"}
	filters = {"status": ST_TRANSIT, "overdue_alerted_at": ("is", "not set")}
	if only:
		filters["name"] = ("in", list(only))
	now = now_datetime()
	report = {"checked": 0, "alerted": 0, "errors": 0}
	rows = frappe.get_all(
		MANIFEST_DT,
		filters=filters,
		fields=["name", "dispatched_at", "expected_tat_minutes", "icebox", "icebox_tier", "runner", "receiving_lab", "receiving_lab_name", "collection_point_id", "collection_point_name"],
		limit=500,
	)
	for m in rows:
		report["checked"] += 1
		try:
			limit = cint(m.expected_tat_minutes) or int(flt(frappe.db.get_value(TIER_DT, m.icebox_tier, "hold_hours")) * 60 if m.icebox_tier else 0)
			if not limit or not m.dispatched_at:
				continue
			minutes = int(time_diff_in_seconds(now, m.dispatched_at) // 60)
			if minutes <= limit:
				continue
			frappe.db.set_value(MANIFEST_DT, m.name, "overdue_alerted_at", now, update_modified=False)
			if cint(notify):
				text = _("Teleporter: manifest {0} (icebox {1}) from {2} to {3} is overdue: {4} min in transit, expected {5} min.").format(
					m.name, m.icebox, m.collection_point_name, m.receiving_lab_name, minutes, limit
				)
				phones = {
					frappe.db.get_value(FP_DT, m.runner, "mobile") if m.runner else None,
					frappe.db.get_value(LAB_DT, m.receiving_lab, "mobile") if m.receiving_lab else None,
					frappe.db.get_value(CENTER_DT, m.collection_point_id, "mobile") if m.collection_point_id else None,
				}
				for phone in phones:
					_notify(phone, text)
			frappe.db.commit()
			report["alerted"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase134 overdue alert", message=f"{m.name}\n{frappe.get_traceback()}")
	return report


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _context(access, user, roles):
	ctx = frappe._dict(user=user, roles=roles, is_manager=bool(roles & MANAGE_ROLES), runner=None, centers=None, labs=None)
	if access == "manage":
		if not ctx.is_manager:
			_deny(_("Teleporter Manager access required"))
	elif access == "runner":
		ctx.runner = runner_for_user(user)
		if not ctx.runner:
			_deny(_("You are not an active Teleporter Runner; ask operations to enable you"))
	elif access == "center":
		if not ctx.is_manager:
			ctx.centers = parties_for_user("center", user)
			if not ctx.centers:
				_deny(_("This login is not linked to a Teleporter center"))
	elif access == "lab":
		if not ctx.is_manager:
			ctx.labs = parties_for_user("lab", user, active_only=True)
			if not ctx.labs:
				_deny(_("This login is not linked to an active Teleporter lab"))
	elif access == "custody":
		if not ctx.is_manager and not parties_for_user("lab", user, active_only=True):
			_deny(_("Lab or operations access required"))
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


def _guest(fn, message="OK"):
	frappe.flags.ignore_csrf = True
	try:
		_ensure_ready()
		data = fn()
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_signup(kind=None, mobile=None, otp=None, payload=None):
	return _guest(lambda: signup(kind, mobile, otp, payload), message=_("Sign-up received"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_otp_login(mobile=None, otp=None):
	return _guest(lambda: otp_login(mobile, otp), message=_("Authenticated"))


@frappe.whitelist(allow_guest=True)
def tp_me(sid=None):
	return _run(sid, "user", me)


@frappe.whitelist(allow_guest=True)
def tp_signups_list(kind=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_signups(kind))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_signup_approve(kind=None, name=None, sid=None):
	return _run(sid, "manage", lambda ctx: approve_party(kind, name, ctx.user), message=_("Approved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_signup_reject(kind=None, name=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: reject_party(kind, name, reason), message=_("Rejected"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_centers_list(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_parties("center", _parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_center_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_party("center", _parse(payload), ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_labs_list(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_parties("lab", _parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_lab_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_party("lab", _parse(payload), ctx.user), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_party_set_status(kind=None, name=None, status=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: set_party_status(kind, name, status, reason), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_tiers_list(sid=None):
	return _run(sid, "user", lambda ctx: list_tiers())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_tier_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_tier(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_icebox_register(tier=None, count=None, notes=None, sid=None):
	return _run(sid, "manage", lambda ctx: register_iceboxes(tier, count, notes, actor_role=ROLE_MANAGER), message=_("Registered"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_icebox_list(filters=None, page=1, page_size=50, sid=None):
	return _run(sid, "manage", lambda ctx: list_iceboxes(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_icebox_assign(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: assign_icebox(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_icebox_set_status(carrier_code=None, status=None, notes=None, sid=None):
	return _run(sid, "manage", lambda ctx: set_icebox_status(carrier_code, status, notes), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_icebox_labels(codes=None, fmt="pdf", size=None, sid=None):
	return _run(sid, "manage", lambda ctx: icebox_labels(codes, fmt, size))


@frappe.whitelist(allow_guest=True)
def tp_runners_list(q=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_runners(q))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_runner_enable(user=None, enable=1, mobile=None, sid=None):
	return _run(sid, "manage", lambda ctx: enable_runner(user, enable, mobile), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_lookup(kind=None, q=None, sid=None):
	return _run(sid, "manage", lambda ctx: lookup(kind, q))


@frappe.whitelist(allow_guest=True)
def tp_mapping_list(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_mappings(_parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_mapping_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_mapping(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_subscription_list(filters=None, sid=None):
	return _run(sid, "manage", lambda ctx: list_subscriptions(_parse(filters)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_subscription_save(payload=None, sid=None):
	return _run(sid, "manage", lambda ctx: save_subscription(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_subscription_activate(name=None, payment_mode=None, payment_ref=None, amount_paid=None, sid=None):
	# TODO(teleporter): online payment through HEC Payment Intent scope `teleporter_subscription` once the
	# phase 121 provider settings cover the new scopes; until then operations activate after offline payment.
	return _run(sid, "manage", lambda ctx: activate_subscription(name, payment_mode, payment_ref, amount_paid, ctx.user), message=_("Activated"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_subscription_set_status(name=None, status=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: set_subscription_status(name, status, reason), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_manifests_board(filters=None, page=1, page_size=50, sid=None):
	return _run(sid, "manage", lambda ctx: manifests_board(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_mark_exception(name=None, reason=None, sid=None):
	return _run(sid, "manage", lambda ctx: mark_exception(ctx, name, reason), message=_("Marked"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_custody_chain(code=None, sid=None):
	return _run(sid, "custody", lambda ctx: custody_lookup(code))


@frappe.whitelist(allow_guest=True)
def tp_tat_report(date_from=None, date_to=None, lab=None, center=None, sid=None):
	return _run(sid, "manage", lambda ctx: tat_report(date_from, date_to, lab, center))


@frappe.whitelist(allow_guest=True)
def tp_manifest_detail(name=None, sid=None):
	return _run(sid, "user", lambda ctx: manifest_detail(ctx, name))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_cancel_manifest(name=None, reason=None, sid=None):
	def run(ctx):
		if not ctx.is_manager:
			ctx.centers = parties_for_user("center", ctx.user)
		return cancel_manifest(ctx, name, reason)

	return _run(sid, "user", run, message=_("Cancelled"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_my_point(center=None, sid=None):
	return _run(sid, "center", lambda ctx: my_point(ctx, center))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_create_manifest(payload=None, sid=None):
	return _run(sid, "center", lambda ctx: create_manifest(ctx, _parse(payload)), message=_("Manifest created"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_manifest_add_samples(manifest=None, samples=None, sid=None):
	return _run(sid, "center", lambda ctx: manifest_add_samples(ctx, manifest, samples), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_manifest_remove_sample(manifest=None, code=None, sid=None):
	return _run(sid, "center", lambda ctx: manifest_remove_sample(ctx, manifest, code), message=_("Removed"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_origin_scan(payload=None, sid=None):
	return _run(sid, "center", lambda ctx: origin_scan(ctx, _parse(payload)), message=_("Handed over to the runner"), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_my_manifests(center=None, status=None, days=14, sid=None):
	return _run(sid, "center", lambda ctx: my_manifests(ctx, center, status, days))


@frappe.whitelist(allow_guest=True)
def tp_runner_today(sid=None):
	return _run(sid, "runner", runner_today)


@frappe.whitelist(allow_guest=True)
def tp_runner_badge(sid=None):
	return _run(sid, "runner", runner_badge)


@frappe.whitelist(allow_guest=True)
def tp_lab_expected(lab=None, sid=None):
	return _run(sid, "lab", lambda ctx: lab_expected(ctx, lab))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_destination_scan(payload=None, sid=None):
	return _run(sid, "lab", lambda ctx: destination_scan(ctx, _parse(payload)), message=_("Received at lab"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def tp_accession_unlocked(manifest=None, sid=None):
	return _run(sid, "lab", lambda ctx: accession_unlocked(ctx, manifest), commit=True)


@frappe.whitelist(allow_guest=True)
def tp_lab_received(lab=None, days=7, sid=None):
	return _run(sid, "lab", lambda ctx: lab_received(ctx, lab, days))


# ---------------------------------------------------------------------------
# Smoke (throwaway data, rolled back)
# ---------------------------------------------------------------------------


def smoke_phase134():
	"""Sign-up -> approval -> mapping -> subscription -> manifest -> origin / destination scans, gates, custody chain,
	TAT / temperature, Remedium accession lock, scheduler jobs. Inner booking / accession code commits, so commits are
	suspended for the run and everything is rolled back; _cleanup_smoke is the backstop. Returns {checks, passed, total, ok}."""
	setup = setup_phase134()
	out = {"ok": True, "checks": [], "setup": {k: setup.get(k) for k in ("created", "tiers_seeded", "tiers", "scheduler_jobs")}}
	tiers_before = {t.name: (flt(t.temp_min_c), flt(t.temp_max_c)) for t in frappe.get_all(TIER_DT, fields=["name", "temp_min_c", "temp_max_c"], limit=0)}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:240]})
		if not cond:
			out["ok"] = False

	real_commit = frappe.db.commit
	frappe.db.commit = lambda *args, **kwargs: None
	frappe.flags.tp_no_notify = True
	frappe.flags.pf_no_notify = True
	frappe.flags.mute_emails = True
	frappe.flags.tp_skip_rate_limit = True
	user_before = frappe.session.user
	try:
		_smoke_scenario(check, frappe.generate_hash(length=5).upper())
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
		out["trace"] = frappe.get_traceback()[-2000:]
	finally:
		frappe.set_user(user_before)
		frappe.db.rollback()
		frappe.db.commit = real_commit
		frappe.flags.tp_no_notify = False
		frappe.flags.pf_no_notify = False
		frappe.flags.mute_emails = False
		frappe.flags.tp_skip_rate_limit = False
		out["cleanup"] = _cleanup_smoke(tiers_before)
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _smoke_user(email, roles, mobile=None):
	doc = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": "P134",
			"last_name": email.split("@")[0][-6:],
			"send_welcome_email": 0,
			"user_type": "System User",
			"mobile_no": mobile,
			"roles": [{"role": r} for r in roles],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _smoke_profile(code, lab=False):
	doc = frappe.get_doc(
		{
			"doctype": PROFILE_DT,
			"franchise_name": f"P134 Smoke {code}",
			"branch_code": code,
			"owner_name": "Smoke",
			"franchisee_type": "Pulse",
			"commission_percentage_rate": 0,
			"commission_base": "Franchisee Rate",
			"wallet_balance": 0,
			"active_status": "Active",
		}
	)
	doc.insert(ignore_permissions=True)
	if lab:
		frappe.db.set_value(PROFILE_DT, doc.name, "has_lab", 1, update_modified=False)
	return doc.name


def _smoke_items():
	from health_ecosystem_core.health_ecosystem_core.api import LAB_ITEM_GROUPS

	groups = [g for g in LAB_ITEM_GROUPS if frappe.db.exists("Item Group", g)]
	filters = {"disabled": 0, "is_sales_item": 1}
	if groups:
		filters["item_group"] = ("in", groups)
	return frappe.get_all("Item", filters=filters, pluck="name", limit=1)


def _smoke_trf(franchisee, item, label, tag):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import build_draw_plan_for_trf

	doc = frappe.get_doc(
		{
			"doctype": TRF_DT,
			"patient_name": f"P134 Smoke {label} {tag}",
			"age": 30,
			"gender": "Male",
			"test_required": item,
			"tests": [{"item": item, "qty": 1, "rate": 100, "amount": 100}],
			"franchisee_id": franchisee,
			"order_status": "Sample Collected",
		}
	)
	doc.insert(ignore_permissions=True)
	for row in build_draw_plan_for_trf(doc):
		doc.append("collection_tubes", row)
	doc.save(ignore_permissions=True)
	doc.reload()
	return doc.name, [r.accession_id for r in doc.collection_tubes]


def _smoke_otp(mobile, code="246810"):
	frappe.cache().set_value(f"hec_otp:{mobile}", {"code": code, "attempts": 0}, expires_in_sec=300)
	return code


def _smoke_scenario(check, tag):
	from health_ecosystem_core.health_ecosystem_core import clinical_phase89_vial_accession as accession
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import save_field_provider

	low = tag.lower()

	def refused(fn):
		try:
			fn()
		except (frappe.ValidationError, frappe.PermissionError) as exc:
			return cstr(exc) or "refused"
		return None

	def ctx_for(user, access=None):
		roles = set(frappe.get_roles(user))
		ctx = frappe._dict(user=user, roles=roles, is_manager=bool(roles & MANAGE_ROLES), runner=runner_for_user(user), centers=None, labs=None)
		if access == "center" and not ctx.is_manager:
			ctx.centers = parties_for_user("center", user)
		if access == "lab" and not ctx.is_manager:
			ctx.labs = parties_for_user("lab", user, active_only=True)
		return ctx

	def phone():
		return f"9{secrets.randbelow(10**9):09d}"

	def box_status(code):
		return frappe.db.get_value(ICEBOX_DT, code, "status")

	def tube_status(trf, acc):
		return frappe.db.get_value(TUBE_DT, {"parent": trf, "accession_id": acc}, "status")

	# --- setup -----------------------------------------------------------
	check("roles Center User / Lab User / Runner / Manager exist", all(frappe.db.exists("Role", r) for r in TP_ROLES))
	check("Teleporter DocTypes exist", all(frappe.db.exists("DocType", d) for d in (CENTER_DT, LAB_DT, PARTY_USER_DT, TIER_DT, ICEBOX_DT, SUB_DT, SUB_BOX_DT, MAP_DT, MANIFEST_DT, SAMPLE_DT)))
	check("mapping links Teleporter Center -> Teleporter Lab", frappe.get_meta(MAP_DT).get_field("collection_point_id").options == CENTER_DT and frappe.get_meta(MAP_DT).get_field("authorized_receiving_lab_id").options == LAB_DT)
	check("tier rows TIER_1..TIER_3 seeded", all(frappe.db.exists(TIER_DT, t) for t in TIER_CODES))
	check("icebox prefix RI registered with Mod 11-2", (get_prefix(ICEBOX_PREFIX) or {}).get("check") == CHECK_MOD11)

	# --- sign-up + approval ----------------------------------------------
	m_center, m_lab = phone(), phone()
	payload_c = {"name": f"P134 Smoke Center A {tag}", "party_type": "Clinic", "contact_person": "Smoke A", "email": f"p134smoke-ca-{low}@example.invalid", "city": "Kolkata", "pincode": "700001"}
	check("sign-up with a wrong OTP refused", refused(lambda: (_smoke_otp(m_center), signup("center", m_center, "000000", payload_c, login=False))))
	res = signup("center", m_center, _smoke_otp(m_center), payload_c, login=False)
	center_a = res["party"]["name"]
	center_user = res["party"]["users"][0]["user"] if res["party"]["users"] else None
	check("center sign-up -> Pending Approval with a linked login", res["party"]["status"] == "Pending Approval" and center_user, res["party"])
	check("signed-up user is a Website User without Remedium roles", frappe.db.get_value("User", center_user, "user_type") == "Website User" and not (set(frappe.get_roles(center_user)) - OTP_LOGIN_ROLES))
	check("Teleporter OTP login finds the pending center user", otp_login(m_center, _smoke_otp(m_center), login=False)["user"] == center_user)
	again = signup("center", m_center, _smoke_otp(m_center), {**payload_c, "city": "Howrah"}, login=False)
	check("repeat sign-up updates the pending record (no duplicate)", again["party"]["name"] == center_a and again["party"]["city"] == "Howrah")
	cp = ctx_for(center_user, "center")
	msg = refused(lambda: create_manifest(cp, {}))
	check("pending (unapproved) center blocked", msg and "Pending Approval" in msg, msg)
	lab_res = signup("lab", m_lab, _smoke_otp(m_lab), {"name": f"P134 Smoke Lab One {tag}", "party_type": "Diagnostic Lab", "email": f"p134smoke-l1-{low}@example.invalid"}, login=False)
	lab1 = lab_res["party"]["name"]
	lab1_user = lab_res["party"]["users"][0]["user"]
	check("reject needs a reason", refused(lambda: reject_party("lab", lab1, "")))
	approve_party("center", center_a)
	approve_party("lab", lab1)
	check("approval activates and grants roles", party_status("center", center_a) == "Active" and ROLE_CENTER in frappe.get_roles(center_user) and ROLE_LAB in frappe.get_roles(lab1_user))
	remedium_lab = _smoke_profile(f"{SMOKE_TAG}-R1-{tag}", lab=True)
	plain_profile = _smoke_profile(f"{SMOKE_TAG}-F1-{tag}")
	check("linking a non-lab Remedium profile to a lab refused", refused(lambda: save_party("lab", {"name": lab1, "linked_remedium": plain_profile})))
	save_party("lab", {"name": lab1, "linked_remedium": remedium_lab})
	check("lab linked to a Remedium lab", party_payload("lab", lab1)["remedium_linked"])
	lab2_user = _smoke_user(f"p134smoke-l2-{low}@example.invalid", [], phone())
	lab2 = save_party("lab", {"display_name": f"P134 Smoke Lab Two {tag}", "mobile": phone(), "users": [lab2_user]})["name"]
	center_b = save_party("center", {"display_name": f"P134 Smoke Center B {tag}", "mobile": phone()})["name"]
	check("ops-created parties are Active", party_status("lab", lab2) == "Active" and party_status("center", center_b) == "Active" and ROLE_LAB in frappe.get_roles(lab2_user))
	mgr_user = _smoke_user(f"p134smoke-mg-{low}@example.invalid", [ROLE_MANAGER], phone())
	check("staff / manager accounts cannot use Teleporter OTP login", not otp_login_allowed(mgr_user))
	cp = ctx_for(center_user, "center")
	l1 = ctx_for(lab1_user, "lab")
	l2 = ctx_for(lab2_user, "lab")
	mgr = ctx_for(mgr_user)
	check("lab users resolve to their own lab only", l1.labs == [lab1] and l2.labs == [lab2], (l1.labs, l2.labs))

	# --- runners, tiers, iceboxes -----------------------------------------
	r1_user = _smoke_user(f"p134smoke-r1-{low}@example.invalid", [ROLE_RUNNER], phone())
	r2_user = _smoke_user(f"p134smoke-r2-{low}@example.invalid", ["Phlebotomist"], phone())
	r3_user = _smoke_user(f"p134smoke-r3-{low}@example.invalid", [ROLE_RUNNER], phone())
	runner1 = save_field_provider({"user": r1_user, "is_teleporter_runner": 1, "status": "Active"})["name"]
	runner2 = save_field_provider({"user": r2_user, "is_phlebo_rider": 1, "status": "Active"})["name"]
	runner3 = save_field_provider({"user": r3_user, "is_teleporter_runner": 1, "status": "Active"})["name"]
	save_tier({"tier": "TIER_1", "temp_min_c": 2, "temp_max_c": 8})
	check("tier with max <= min refused", refused(lambda: save_tier({"tier": "TIER_2", "temp_min_c": 8, "temp_max_c": 2})))
	reg = register_iceboxes("TIER_1", 3, notes=f"{SMOKE_TAG} {tag}")
	box1, box2, box_b = reg["created"]
	box_t2 = register_iceboxes("TIER_2", 1, notes=f"{SMOKE_TAG} {tag}")["created"][0]
	check("icebox codes = RI + 6 digits + check char", all(re.match(r"^RI\d{6}[0-9X]$", c) and validate_code(c, ICEBOX_PREFIX) for c in reg["created"] + [box_t2]))
	transitions = [box_status(box1)]

	# --- subscription + mapping gates --------------------------------------
	sub = save_subscription({"collection_point_id": center_a, "tier": "TIER_1", "start_date": today(), "pickup_window_start": "09:00", "pickup_window_end": "11:00"})
	check("new subscription Pending Payment", sub["status"] == "Pending Payment")
	assign_icebox({"carrier_code": box1, "subscription": sub["name"], "runner": runner1})
	assign_icebox({"carrier_code": box2, "subscription": sub["name"]})
	transitions.append(box_status(box1))
	check("TIER_2 icebox cannot join a TIER_1 subscription", refused(lambda: assign_icebox({"carrier_code": box_t2, "subscription": sub["name"]})))
	activate_subscription(sub["name"], "Waived")
	msg = refused(lambda: create_manifest(cp, {}))
	check("manifest refused without an active mapping", msg and "Mapping" in msg, msg)
	mapping = save_mapping({"collection_point_id": center_a, "authorized_receiving_lab_id": lab1, "active": 1, "default_runner": runner1, "expected_tat_minutes": 120})
	check("mapping saved and in effect", mapping["in_effect"], mapping)
	check("second active mapping for the same center refused", refused(lambda: save_mapping({"collection_point_id": center_a, "authorized_receiving_lab_id": lab2, "active": 1})))
	alt = save_mapping({"collection_point_id": center_a, "authorized_receiving_lab_id": lab2, "active": 0})
	check("inactive alternative mapping allowed", alt["name"] and not alt["active"])
	set_subscription_status(sub["name"], "Paused")
	check("manifest refused while the subscription is paused", refused(lambda: create_manifest(cp, {})))
	set_subscription_status(sub["name"], "Active")
	set_party_status("lab", lab1, "Suspended")
	check("manifest refused while the mapped lab is suspended", refused(lambda: create_manifest(cp, {})))
	set_party_status("lab", lab1, "Active")

	# --- manifest without samples -> origin -> destination -----------------
	res = create_manifest(cp, {"icebox_code": box1})
	m1 = res["manifest"]["name"]
	check("manifest without samples created", res["manifest"]["status"] == ST_PENDING and res["manifest"]["sample_count"] == 0 and res["manifest"]["remedium_linked"])
	transitions.append(box_status(box1))
	check("icebox tier must match the subscription", (frappe.db.set_value(ICEBOX_DT, box_t2, {"subscription": sub["name"], "status": "Assigned"}) or True) and "TIER_2" in cstr(refused(lambda: origin_scan(cp, {"icebox_code": box_t2, "runner_id": runner1, "samples": ["X"]}))))
	frappe.db.set_value(ICEBOX_DT, box_t2, {"subscription": None, "status": "In Stock"})
	check("runner must be a Teleporter Runner", ROLE_RUNNER in cstr(refused(lambda: origin_scan(cp, {"manifest": m1, "icebox_code": box1, "runner_id": runner2}))))
	check("non-designated runner refused", "designated" in cstr(refused(lambda: origin_scan(cp, {"manifest": m1, "icebox_code": box1, "runner_id": runner3}))))
	scan = origin_scan(cp, {"manifest": m1, "icebox_code": box1, "runner_id": r1_user, "temp_out_c": 4, "device_id": f"{SMOKE_TAG}-{tag}"})
	e1, e2 = scan["events"]
	check("origin scan -> IN_TRANSIT_WITH_RUNNER", scan["manifest"]["status"] == ST_TRANSIT and scan["manifest"]["runner"] == runner1)
	check("custody Dispatched then Picked Up, chained", e1["event"] == "Dispatched" and e2["event"] == "Picked Up" and e2["prev_event"] == e1["name"] and scan["verification"]["ok"])
	transitions.append(box_status(box1))
	check("destination scan at the wrong lab refused", "Wrong lab" in cstr(refused(lambda: destination_scan(l2, {"icebox_code": box1}))))
	check("wrong-lab attempt logged as custody Exception", frappe.get_all(CUSTODY_DT, filters={"scan_code": box1}, fields=["event"], order_by="seq desc", limit=1)[0].event == "Exception")
	frappe.db.set_value(MANIFEST_DT, m1, "collection_point_id", center_b, update_modified=False)
	check("destination scan with a mismatched origin refused", "Wrong origin" in cstr(refused(lambda: destination_scan(l1, {"icebox_code": box1}))))
	frappe.db.set_value(MANIFEST_DT, m1, "collection_point_id", center_a, update_modified=False)
	frappe.db.set_value(MANIFEST_DT, m1, "dispatched_at", add_to_date(now_datetime(), minutes=-150), update_modified=False)
	rec = destination_scan(l1, {"icebox_code": box1, "temp_in_c": 12})
	check("destination scan -> RECEIVED_AT_LAB", rec["manifest"]["status"] == ST_RECEIVED)
	check("transit TAT computed and breached vs expected 120", 149 <= cint(rec["transit_tat_minutes"]) <= 152 and rec["tat_breached"], rec["transit_tat_minutes"])
	check("temperature outside the tier range flagged", rec["temp"]["ok"] is False and rec["manifest"]["temp_excursion"] == 1)
	events = [e.event for e in frappe.get_all(CUSTODY_DT, filters={"scan_code": box1}, fields=["event"], order_by="seq asc", limit=0)]
	check("custody chain verifies end to end", verify_chain(box1)["ok"] and events == ["Issued", "Dispatched", "Picked Up", "Exception", "Exception", "Received At Lab"], events)
	transitions.append(box_status(box1))
	check("icebox status transitions", transitions == ["In Stock", "Assigned", "At Collection Point", "In Transit", "At Lab"], transitions)

	# --- Remedium-linked lab: accession lock / unlock ---------------------
	items = _smoke_items()
	if not items:
		check("lab test item available for the lock checks", False, "no item")
		return
	if not frappe.db.exists("HEC Collection Tube", "SST"):
		accession.seed_collection_tubes()
	trf1, accs1 = _smoke_trf(remedium_lab, items[0], "One", tag)
	trf3, accs3 = _smoke_trf(remedium_lab, items[0], "Three", tag)
	check("throwaway TRFs have tubes", accs1 and accs3)
	if not (accs1 and accs3):
		return
	acc1, acc3 = accs1[0], accs3[0]
	free_code = f"EXT-{tag}-001"
	res = create_manifest(cp, {"icebox_code": box2, "samples": [acc1, free_code]})
	m2 = res["manifest"]["name"]
	rows = {s["sample_code"]: s for s in res["manifest"]["samples"]}
	check("Remedium tube locked, free code recorded without lock", rows[acc1]["locked"] == 1 and rows[free_code]["locked"] == 0 and rows[free_code]["unverified"] == 1, rows)
	origin_scan(cp, {"manifest": m2, "icebox_code": box2, "runner_id": runner1})
	msg = refused(lambda: accession.receive_trf_tube(trf_id=trf1, accession_id=acc1))
	check("accession refused while sealed in transit", msg and m2 in msg and "scan the icebox" in msg, msg)
	accession.receive_trf_tube(trf_id=trf3, accession_id=acc3)
	check("tube outside any manifest still accessions normally", tube_status(trf3, acc3) == "Received")
	destination_scan(l1, {"icebox_code": box2})
	acc = accession_unlocked(l1, m2)
	check("accession all unlocked receives the tube", tube_status(trf1, acc1) == "Received" and any(r["ok"] for r in acc["results"]), acc["results"])
	check("manifest sample marked Accessioned", frappe.db.get_value(SAMPLE_DT, {"parent": m2, "accession_id": acc1}, "sample_status") == "Accessioned")

	# --- non-Remedium lab: codes only recorded -----------------------------
	trf4, accs4 = _smoke_trf(remedium_lab, items[0], "Four", tag)
	sub_b = save_subscription({"collection_point_id": center_b, "tier": "TIER_1", "start_date": today()})
	assign_icebox({"carrier_code": box_b, "subscription": sub_b["name"]})
	activate_subscription(sub_b["name"], "Waived")
	save_mapping({"collection_point_id": center_b, "authorized_receiving_lab_id": lab2, "active": 1})
	res = create_manifest(mgr, {"center": center_b, "icebox_code": box_b, "samples": [accs4[0]]})
	m3 = res["manifest"]["name"]
	check("Remedium code to a non-Remedium lab recorded without lock", not res["manifest"]["remedium_linked"] and res["manifest"]["samples"][0]["locked"] == 0)
	origin_scan(mgr, {"center": center_b, "manifest": m3, "icebox_code": box_b, "runner_id": runner3})
	accession.receive_trf_tube(trf_id=trf4, accession_id=accs4[0])
	check("no accession lock for a non-Remedium lab", tube_status(trf4, accs4[0]) == "Received")
	destination_scan(l2, {"icebox_code": box_b})
	check("accession all unlocked refused for a non-Remedium lab", refused(lambda: accession_unlocked(l2, m3)))

	# --- views + scheduler ------------------------------------------------
	view = runner_today(ctx_for(r1_user))
	check("runner sees today's route", any(r["mapping"] == mapping["name"] for r in view["route"]))
	check("center view ready", my_point(cp)["ready"], my_point(cp)["problems"])
	check("custody lookup by icebox verifies", custody_lookup(box1)["verification"]["ok"])
	check("TAT report counts the breached receipt", any(r["collection_point_id"] == center_a and r["breached"] >= 1 for r in tat_report(today(), today(), lab=lab1)["rows"]))
	m4 = create_manifest(cp, {"icebox_code": box1})["manifest"]["name"]
	origin_scan(cp, {"manifest": m4, "icebox_code": box1, "runner_id": runner1})
	frappe.db.set_value(MANIFEST_DT, m4, "dispatched_at", add_to_date(now_datetime(), minutes=-200), update_modified=False)
	check("overdue in-transit manifest flagged once", tp_overdue_transit_alerts(only=[m4], notify=0)["alerted"] == 1 and tp_overdue_transit_alerts(only=[m4], notify=0)["alerted"] == 0)
	frappe.db.set_value(SUB_DT, sub_b["name"], "end_date", add_days(today(), -1))
	tp_expire_subscriptions(only=[sub_b["name"]])
	check("past-end subscription Expired", _sub(sub_b["name"]).status == "Expired")

	# --- PhleboFirst soft hook -------------------------------------------
	pf = _pf_module()
	if pf and frappe.db.exists("DocType", pf.UB_DT):
		ub = pf.issue_barcodes("SST", 1)["codes"][0]
		frappe.db.set_value(pf.UB_DT, ub, {"status": "Dropped", "bound_trf": trf4, "bound_accession": accs4[0]})
		m5 = create_manifest(cp, {"samples": [ub]})["manifest"]["name"]
		check("PhleboFirst barcode recorded on the manifest", frappe.db.get_value(SAMPLE_DT, {"parent": m5}, "universal_barcode") == ub)
		destination_scan(l1, {"icebox_code": box1})
		origin_scan(cp, {"manifest": m5, "icebox_code": box1, "runner_id": runner1})
		last = frappe.get_all(CUSTODY_DT, filters={"scan_code": ub}, fields=["event"], order_by="seq desc", limit=1)
		check("PhleboFirst custody gets Dispatched at origin", last and last[0].event == "Dispatched", last)
		destination_scan(l1, {"icebox_code": box1})
		check("phase 133 marks the PhleboFirst barcode Received on lab arrival", frappe.db.get_value(pf.UB_DT, ub, "status") == "Received" and verify_chain(ub)["ok"])


def _cleanup_smoke(tiers_before):
	"""Backstop if anything survived the rollback (e.g. a DDL implicit commit)."""
	removed = {}
	for name, (lo, hi) in (tiers_before or {}).items():
		row = frappe.db.get_value(TIER_DT, name, ["temp_min_c", "temp_max_c"], as_dict=True)
		if row and (flt(row.temp_min_c), flt(row.temp_max_c)) != (lo, hi):
			frappe.db.set_value(TIER_DT, name, {"temp_min_c": lo, "temp_max_c": hi}, update_modified=False)
			removed["tiers_restored"] = removed.get("tiers_restored", 0) + 1
	centers = frappe.get_all(CENTER_DT, filters={"center_name": ("like", "P134 Smoke %")}, pluck="name") if frappe.db.exists("DocType", CENTER_DT) else []
	labs = frappe.get_all(LAB_DT, filters={"lab_name": ("like", "P134 Smoke %")}, pluck="name") if frappe.db.exists("DocType", LAB_DT) else []
	profiles = frappe.get_all(PROFILE_DT, filters={"name": ("like", f"{SMOKE_TAG}-%")}, pluck="name")
	users = frappe.get_all("User", filters={"name": ("like", "p134smoke-%@example.invalid")}, pluck="name")
	boxes = frappe.get_all(ICEBOX_DT, filters={"notes": ("like", f"{SMOKE_TAG} %")}, pluck="name") if frappe.db.exists("DocType", ICEBOX_DT) else []
	trfs = frappe.get_all(TRF_DT, filters={"patient_name": ("like", "P134 Smoke %")}, pluck="name")
	if centers:
		manifests = frappe.get_all(MANIFEST_DT, filters={"collection_point_id": ("in", centers)}, pluck="name")
		if manifests:
			frappe.db.delete(SAMPLE_DT, {"parent": ("in", manifests)})
			frappe.db.delete(MANIFEST_DT, {"name": ("in", manifests)})
			removed["manifests"] = len(manifests)
		subs = frappe.get_all(SUB_DT, filters={"collection_point_id": ("in", centers)}, pluck="name")
		if subs:
			frappe.db.delete(SUB_BOX_DT, {"parent": ("in", subs)})
			frappe.db.delete(SUB_DT, {"name": ("in", subs)})
			removed["subscriptions"] = len(subs)
		frappe.db.delete(MAP_DT, {"collection_point_id": ("in", centers)})
	for dt, names in ((CENTER_DT, centers), (LAB_DT, labs)):
		if names:
			users += frappe.get_all(PARTY_USER_DT, filters={"parent": ("in", names), "parenttype": dt, "user": ("like", f"%@{USER_EMAIL_DOMAIN}")}, pluck="user")
			frappe.db.delete(PARTY_USER_DT, {"parent": ("in", names), "parenttype": dt})
			frappe.db.delete(dt, {"name": ("in", names)})
			removed[dt] = len(names)
	if boxes:
		frappe.db.delete(CUSTODY_DT, {"scan_code": ("in", boxes)})
		frappe.db.delete(ICEBOX_DT, {"name": ("in", boxes)})
		removed["iceboxes"] = len(boxes)
	pf = _pf_module()
	if pf and trfs and frappe.db.exists("DocType", pf.UB_DT):
		codes = frappe.get_all(pf.UB_DT, filters={"bound_trf": ("in", trfs)}, pluck="name")
		if codes:
			frappe.db.delete(CUSTODY_DT, {"scan_code": ("in", codes)})
			frappe.db.delete(pf.UB_DT, {"name": ("in", codes)})
			removed["pf_barcodes"] = len(codes)
	if trfs:
		if frappe.db.exists("DocType", "Sample Transport Log"):
			frappe.db.delete("Sample Transport Log", {"customer_trf": ("in", trfs)})
		for child in (TUBE_DT, "TRF Test Item"):
			if frappe.db.exists("DocType", child):
				frappe.db.delete(child, {"parent": ("in", trfs)})
		frappe.db.delete(TRF_DT, {"name": ("in", trfs)})
		removed["trfs"] = len(trfs)
	for p in frappe.get_all("Health Patient", filters={"patient_name": ("like", "P134 Smoke %")}, pluck="name"):
		frappe.db.delete("Patient Account Link", {"patient": p})
		frappe.db.delete("Patient Care Journey", {"patient": p})
		frappe.db.delete("Health Patient", {"name": p})
		removed["patients"] = removed.get("patients", 0) + 1
	users = sorted(set(users))
	providers = frappe.get_all(FP_DT, filters={"user": ("in", users)}, pluck="name") if users else []
	if providers:
		frappe.db.delete(FP_DT, {"name": ("in", providers)})
	for u in users:
		frappe.db.delete("Has Role", {"parent": u})
		frappe.db.delete("User", {"name": u})
	if users:
		removed["users"] = len(users)
	if profiles:
		frappe.db.delete(PROFILE_DT, {"name": ("in", profiles)})
		removed["profiles"] = len(profiles)
	frappe.db.commit()
	return f"removed {removed}" if removed else "clean"
