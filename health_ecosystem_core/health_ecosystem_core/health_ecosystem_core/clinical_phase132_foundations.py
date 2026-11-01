"""Phase 132 — Ecosystem foundations (P0 of ECOSYSTEM_ROADMAP.md).

- Unique Patient ID (UID, field universal_patient_id): REM-UID- + 7 random Crockford base32 characters + a Damm check
  character (clinical_barcodes), assigned on insert and backfilled; permanent once issued. Copied onto Customer TRF /
  Doctor Appointment / Clinical Prescription. The earlier RUP + 10 digits + Verhoeff IDs were re-issued once by phase 136
  and stay searchable through Health Patient.legacy_upi.
- Family accounts: Patient Account Link (one login manages several patients), dedupe fix lives in patient_bridge.
  Manager-only merge tool writes a Patient Merge Log; nothing is merged automatically.
- Shared primitives for the field apps: HEC Field Provider, Provider Payout Ledger, Custody Scan Event (immutable,
  HMAC-chained per scan code), HEC API Client (signed partner requests), HEC Device (web push subscriptions).
- One-time host handoff codes (replaces the session-in-URL-fragment handoff).
- Authenticated access to private prescription uploads.

Hook functions here run in every Frappe container, so they only depend on frappe, clinical_barcodes and the long-standing
api helpers (never on newer patient_bridge functions).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, flt, get_datetime, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import (
	UID_PREFIX,
	UID_RE,
	make_uid,
	match_prefix,
	mod11_check_char,
	mod11_validate,
	normalize_uid,
	parse_code,
	render_labels,
	validate_uid,
	verhoeff_validate,
)

PATIENT_DT = "Health Patient"
PAL_DT = "Patient Account Link"
MERGE_DT = "Patient Merge Log"
FP_DT = "HEC Field Provider"
PAYOUT_DT = "Provider Payout Ledger"
CUSTODY_DT = "Custody Scan Event"
API_CLIENT_DT = "HEC API Client"
DEVICE_DT = "HEC Device"
INTENT_DT = "HEC Payment Intent"

UPI_FIELD = "universal_patient_id"
UPI_LABEL = "Unique Patient ID"
UPI_PREFIX = UID_PREFIX
UPI_DOCTYPES = ("Customer TRF", "Doctor Appointment", "Clinical Prescription")
UPI_RE = UID_RE
LEGACY_UPI_FIELD = "legacy_upi"
LEGACY_UPI_PREFIX = "RUP"
LEGACY_UPI_RE = re.compile(r"^RUP\d{11}$")

RELATIONS = ("Self", "Spouse", "Child", "Parent", "Sibling", "Other")
MAX_PROFILES = 12

FP_STATUSES = ("Applied", "KYC Pending", "Active", "Suspended", "Offboarded")
VEHICLE_TYPES = ("Two Wheeler", "Three Wheeler", "Four Wheeler", "Bicycle", "On Foot", "Other")
PAYOUT_TYPES = ("Job Payout", "Run Payout", "Adjustment", "Penalty", "Payout Settlement")
PAYOUT_STATUSES = ("Accrued", "Approved", "Paid", "Reversed")
PAYOUT_TRANSITIONS = {"Accrued": {"Approved", "Reversed"}, "Approved": {"Paid", "Reversed"}}

CODE_TYPES = ("Universal Barcode", "Icebox", "Kit", "Hub", "Shipment")
CUSTODY_EVENTS = (
	"Issued",
	"Bound",
	"Picked Up",
	"Dropped At Hub",
	"Dispatched",
	"Received At Lab",
	"Rejected",
	"Exception",
)
PREFIX_CODE_TYPES = {"RU": "Universal Barcode", "RI": "Icebox", "RK": "Kit", "RH": "Hub", "RS": "Shipment"}
CUSTODY_SECRET_KEY = "hec_custody_secret"
SCAN_CODE_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,64}$")
SIGNED_FIELDS = (
	"scan_code",
	"code_type",
	"event",
	"actor_user",
	"actor_role",
	"location_doctype",
	"location_name",
	"lat",
	"lng",
	"device_id",
	"ref_doctype",
	"ref_name",
	"payload_json",
	"prev_event",
	"seq",
	"created_at",
)

CLIENT_TYPES = ("Partner Lab", "Analyser", "Ancillary App")
API_MAX_SKEW_SECONDS = 300
API_SCOPE_RE = re.compile(r"^[a-z0-9_*]+(:[a-z0-9_*]+)?$")

HANDOFF_TTL_SECONDS = 60
HANDOFF_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
HANDOFF_HOST_SUFFIXES = ("remediumlabs.in", "e-remedium.in", "smilecurelifestyle.in")
HANDOFF_HOSTS = ("phlebofirst.com", "www.phlebofirst.com")
HANDOFF_DEV_HOSTS = ("localhost", "127.0.0.1", "167.233.108.90")

NEW_PAYMENT_SCOPES = (
	"pf_collection",
	"teleporter_subscription",
	"uberdoc_consult",
	"uberdoc_clinic_session",
	"program_enrollment",
)

MANAGE_ROLES = frozenset({"System Manager", "Health System Admin", "Administrator"})
STAFF_ROLES = MANAGE_ROLES | {"Lab Manager", "Lab Technician", "Pathologist"}
RX_STAFF_ROLES = MANAGE_ROLES | {"Franchisee Operator", "Lab Technician", "Pathologist"}

SEED_STAFF_PASSWORD_KEY = "hec_seed_staff_password"
ROTATED_ADMIN_KEY = "hec_rotated_admin_passwords"
PRIVATE_RX_KEY = "hec_private_rx_uploads"
ROTATE_ROLES = ("System Manager", "Health System Admin")
CIRCUIT_SHARES_JOB = "health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares"

SMOKE_TAG = "P132SMK"


def _fail(message):
	raise frappe.ValidationError(message)


def _deny(message):
	raise frappe.PermissionError(message)


def _has_field(doctype, fieldname):
	try:
		return bool(frappe.db.exists("DocType", doctype)) and frappe.get_meta(doctype).has_field(fieldname)
	except Exception:
		return False


def _sel(options):
	return "\n".join(options)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _ensure_doctype(name, fields, permissions=None, istable=0, autoname="hash", extra=None):
	"""Create the custom DocType, or append fields added since it was created."""
	if frappe.db.exists("DocType", name):
		doc = frappe.get_doc("DocType", name)
		have = {f.fieldname for f in doc.fields}
		missing = [f for f in fields if f.get("fieldname") not in have]
		if missing:
			for f in missing:
				doc.append("fields", f)
			doc.save(ignore_permissions=True)
			frappe.clear_cache(doctype=name)
		return False
	doc = {
		"doctype": "DocType",
		"name": name,
		"module": "Health Ecosystem Core",
		"custom": 1,
		"istable": istable,
		"autoname": autoname,
		"naming_rule": "Random" if autoname == "hash" else "Expression (old style)",
		"engine": "InnoDB",
		"fields": fields,
	}
	if istable:
		doc["editable_grid"] = 1
	else:
		doc["track_changes"] = 1
		doc["permissions"] = permissions or []
	doc.update(extra or {})
	frappe.get_doc(doc).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def _perms(write_roles, read_roles, create=1, delete=1):
	perms = [
		{"role": r, "read": 1, "write": 1, "create": create, "delete": delete, "report": 1, "export": 1}
		for r in write_roles
	]
	perms += [{"role": r, "read": 1, "report": 1, "export": 1} for r in read_roles]
	return perms


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	lab_readers = ("Lab Manager", "Lab Technician", "Pathologist")
	return [
		(
			PAL_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "fetch_from": "patient.patient_name", "read_only": 1, "in_list_view": 1},
				{"fieldname": UPI_FIELD, "label": UPI_LABEL, "fieldtype": "Data", "fetch_from": f"patient.{UPI_FIELD}", "read_only": 1},
				{"fieldname": "relation", "label": "Relation", "fieldtype": "Select", "options": _sel(RELATIONS), "default": "Other", "reqd": 1, "in_list_view": 1},
				{"fieldname": "is_primary", "label": "Primary Profile", "fieldtype": "Check", "default": "0"},
				{"fieldname": "consent_on", "label": "Consent Recorded On", "fieldtype": "Datetime"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "link_key", "label": "Link Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms(managers, ()),
			{"title_field": "patient_name"},
		),
		(
			MERGE_DT,
			[
				{"fieldname": "source_patient", "label": "Merged (source) Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "target_patient", "label": "Kept (target) Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "source_upi", "label": "Source UPI", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "target_upi", "label": "Target UPI", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "merged_by", "label": "Merged By", "fieldtype": "Link", "options": "User", "read_only": 1, "in_list_view": 1},
				{"fieldname": "merged_on", "label": "Merged On", "fieldtype": "Datetime", "read_only": 1, "in_list_view": 1},
				{"fieldname": "repointed_json", "label": "Re-pointed Links", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms((), managers),
			{"in_create": 1},
		),
		(
			FP_DT,
			[
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "full_name", "label": "Full Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "search_index": 1},
				{"fieldname": "is_phlebo_rider", "label": "Phlebo Rider", "fieldtype": "Check", "default": "0"},
				{"fieldname": "is_teleporter_runner", "label": "Teleporter Runner", "fieldtype": "Check", "default": "0"},
				{"fieldname": "provider_types", "label": "Provider Types", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(FP_STATUSES), "default": "Applied", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "kyc_section", "label": "KYC", "fieldtype": "Section Break"},
				{"fieldname": "aadhaar_last4", "label": "Aadhaar (last 4)", "fieldtype": "Data", "length": 4},
				{"fieldname": "pan", "label": "PAN", "fieldtype": "Data"},
				{"fieldname": "dl_no", "label": "Driving Licence No.", "fieldtype": "Data"},
				{"fieldname": "vehicle_type", "label": "Vehicle Type", "fieldtype": "Select", "options": "\n" + _sel(VEHICLE_TYPES)},
				{"fieldname": "vehicle_no", "label": "Vehicle No.", "fieldtype": "Data"},
				{"fieldname": "area_section", "label": "Service Area", "fieldtype": "Section Break"},
				{"fieldname": "home_lat", "label": "Home Latitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "home_lng", "label": "Home Longitude", "fieldtype": "Float", "precision": "6"},
				{"fieldname": "service_radius_km", "label": "Service Radius (km)", "fieldtype": "Float", "default": "8"},
				{"fieldname": "base_hub", "label": "Base Hub", "fieldtype": "Data"},
				{"fieldname": "rating_avg", "label": "Rating", "fieldtype": "Float", "read_only": 1},
				{"fieldname": "rating_count", "label": "Ratings", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "payout_section", "label": "Payout", "fieldtype": "Section Break"},
				{"fieldname": "payout_upi", "label": "Payout UPI ID", "fieldtype": "Data"},
				{"fieldname": "bank_account_name", "label": "Bank Account Name", "fieldtype": "Data"},
				{"fieldname": "bank_account_no", "label": "Bank Account No.", "fieldtype": "Data"},
				{"fieldname": "bank_ifsc", "label": "IFSC", "fieldtype": "Data"},
				{"fieldname": "onboarded_on", "label": "Onboarded On", "fieldtype": "Date"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, ()),
			{"title_field": "full_name", "search_fields": "mobile"},
		),
		(
			PAYOUT_DT,
			[
				{"fieldname": "provider", "label": "Provider", "fieldtype": "Link", "options": FP_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "entry_type", "label": "Type", "fieldtype": "Select", "options": _sel(PAYOUT_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(PAYOUT_STATUSES), "default": "Accrued", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType"},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Dynamic Link", "options": "source_doctype", "search_index": 1},
				{"fieldname": "period", "label": "Period (YYYY-MM)", "fieldtype": "Data", "in_standard_filter": 1},
				{"fieldname": "posted_on", "label": "Posted On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "paid_ref", "label": "Payment Reference", "fieldtype": "Data"},
				{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
			],
			_perms(managers, (), delete=0),
			None,
		),
		(
			CUSTODY_DT,
			[
				{"fieldname": "scan_code", "label": "Scan Code", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "code_type", "label": "Code Type", "fieldtype": "Select", "options": "\n" + _sel(CODE_TYPES), "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "event", "label": "Event", "fieldtype": "Select", "options": _sel(CUSTODY_EVENTS), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "seq", "label": "Sequence", "fieldtype": "Int", "read_only": 1, "in_list_view": 1},
				{"fieldname": "created_at", "label": "Scanned At", "fieldtype": "Datetime", "read_only": 1, "in_list_view": 1},
				{"fieldname": "actor_user", "label": "Actor", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "actor_role", "label": "Actor Role", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "location_doctype", "label": "Location Type", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "location_name", "label": "Location", "fieldtype": "Dynamic Link", "options": "location_doctype", "read_only": 1},
				{"fieldname": "lat", "label": "Latitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "lng", "label": "Longitude", "fieldtype": "Float", "precision": "6", "read_only": 1},
				{"fieldname": "device_id", "label": "Device", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "ref_doctype", "label": "Reference Type", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "ref_name", "label": "Reference", "fieldtype": "Dynamic Link", "options": "ref_doctype", "read_only": 1, "search_index": 1},
				{"fieldname": "payload_json", "label": "Payload", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "prev_event", "label": "Previous Event", "fieldtype": "Link", "options": CUSTODY_DT, "read_only": 1},
				{"fieldname": "chain_key", "label": "Chain Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "signature", "label": "Signature", "fieldtype": "Data", "read_only": 1},
			],
			_perms((), managers + lab_readers),
			{"in_create": 1, "sort_field": "created_at", "sort_order": "DESC"},
		),
		(
			API_CLIENT_DT,
			[
				{"fieldname": "client_name", "label": "Client Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "client_type", "label": "Client Type", "fieldtype": "Select", "options": _sel(CLIENT_TYPES), "default": "Partner Lab", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "linked_lab", "label": "Linked Lab", "fieldtype": "Link", "options": "Franchisee Profile"},
				{"fieldname": "api_key", "label": "API Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "in_list_view": 1},
				{"fieldname": "api_secret", "label": "API Secret", "fieldtype": "Password", "read_only": 1, "hidden": 1},
				{"fieldname": "api_secret_hash", "label": "Secret Hash", "fieldtype": "Data", "read_only": 1, "hidden": 1},
				{"fieldname": "secret_salt", "label": "Secret Salt", "fieldtype": "Data", "read_only": 1, "hidden": 1},
				{"fieldname": "scopes", "label": "Scopes (one per line)", "fieldtype": "Small Text"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "last_used", "label": "Last Used", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, (), create=0),
			{"title_field": "client_name"},
		),
		(
			DEVICE_DT,
			[
				{"fieldname": "device_id", "label": "Device ID", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "user", "label": "User", "fieldtype": "Link", "options": "User", "in_list_view": 1, "search_index": 1},
				{"fieldname": "platform", "label": "Platform", "fieldtype": "Select", "options": "Web\nAndroid\niOS\nOther", "default": "Web", "in_list_view": 1},
				{"fieldname": "push_subscription_json", "label": "Web Push Subscription", "fieldtype": "Code", "options": "JSON"},
				{"fieldname": "user_agent", "label": "User Agent", "fieldtype": "Small Text"},
				{"fieldname": "last_seen", "label": "Last Seen", "fieldtype": "Datetime", "in_list_view": 1},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1"},
			],
			_perms((), managers),
			None,
		),
	]


def _ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	spec = {}
	if frappe.db.exists("DocType", PATIENT_DT):
		spec[PATIENT_DT] = [
			{
				"fieldname": UPI_FIELD,
				"label": UPI_LABEL,
				"fieldtype": "Data",
				"insert_after": "patient_name",
				"unique": 1,
				"read_only": 1,
				"no_copy": 1,
				"in_standard_filter": 1,
				"in_global_search": 1,
			},
			{
				"fieldname": LEGACY_UPI_FIELD,
				"label": "Legacy Patient ID (RUP)",
				"fieldtype": "Data",
				"insert_after": UPI_FIELD,
				"read_only": 1,
				"no_copy": 1,
				"search_index": 1,
				"in_global_search": 1,
				"description": "The RUP ID issued before the REM-UID switch; still accepted by ID lookups.",
			},
			{
				"fieldname": "merged_into",
				"label": "Merged Into",
				"fieldtype": "Link",
				"options": PATIENT_DT,
				"insert_after": "status",
				"read_only": 1,
				"no_copy": 1,
			},
		]
	for dt in UPI_DOCTYPES:
		if frappe.db.exists("DocType", dt):
			spec[dt] = [
				{
					"fieldname": UPI_FIELD,
					"label": UPI_LABEL,
					"fieldtype": "Data",
					"insert_after": "patient_name",
					"read_only": 1,
					"no_copy": 1,
					"search_index": 1,
				}
			]
	if spec:
		create_custom_fields(spec, update=True)
	return sorted(spec)


def ensure_payment_scopes():
	"""Append the new HEC Payment Intent.scope options via a property setter; existing options keep their order."""
	if not frappe.db.exists("DocType", INTENT_DT):
		return []
	field = frappe.get_meta(INTENT_DT).get_field("scope")
	if not field:
		return []
	current = [o for o in cstr(field.options).split("\n") if o.strip()]
	missing = [s for s in NEW_PAYMENT_SCOPES if s not in current]
	if missing:
		from frappe.custom.doctype.property_setter.property_setter import make_property_setter

		make_property_setter(
			INTENT_DT, "scope", "options", "\n".join(current + missing), "Text", validate_fields_for_doctype=False
		)
		frappe.clear_cache(doctype=INTENT_DT)
	return missing


def ensure_foundations_setup():
	_ensure_custom_fields()
	created = []
	for name, fields, perms, extra in _doctype_specs():
		if _ensure_doctype(name, fields, perms, extra=extra):
			created.append(name)
	return created


def _ensure_ready():
	if not frappe.db.exists("DocType", DEVICE_DT) or not _has_field(PATIENT_DT, UPI_FIELD) or not _has_field(PATIENT_DT, LEGACY_UPI_FIELD):
		ensure_foundations_setup()
		frappe.db.commit()


def setup_phase132(backfill=1):
	"""Idempotent: DocTypes, custom fields, payment scopes, custody secret, UPI backfill."""
	created = ensure_foundations_setup()
	frappe.db.commit()
	scopes_added = ensure_payment_scopes()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_setup import ensure_patient_link_fields

		ensure_patient_link_fields()
	except Exception:
		frappe.log_error(title="setup_phase132 patient link fields", message=frappe.get_traceback())
	frappe.db.commit()
	secret_state = "present" if frappe.conf.get(CUSTODY_SECRET_KEY) else "created"
	custody_secret()
	out = {
		"ok": True,
		"created": created,
		"payment_scopes_added": scopes_added,
		"custody_secret": secret_state,
		"upi_backfilled": 0,
		"linked_upi_filled": {},
	}
	out["private_rx_uploads"] = ensure_private_rx_default()
	out["rotated_admin_users"] = rotate_default_admin_passwords()
	out["circuit_sweep_job"] = ensure_circuit_sweep_job()
	if cint(backfill):
		out["upi_backfilled"] = backfill_upi()
		out["linked_upi_filled"] = backfill_linked_upi()
	out["patients_without_upi"] = frappe.db.count(PATIENT_DT, {UPI_FIELD: ("is", "not set")})
	out["patients_total"] = frappe.db.count(PATIENT_DT)
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# Seeded accounts and site defaults
# ---------------------------------------------------------------------------


def seed_staff_password():
	"""Password for a newly seeded staff / admin user: site_config hec_seed_staff_password, else random. Never logged."""
	configured = cstr(frappe.conf.get(SEED_STAFF_PASSWORD_KEY)).strip()
	return configured or frappe.generate_hash(length=24)


def set_new_staff_password(user):
	from frappe.utils.password import update_password

	update_password(user, seed_staff_password(), logout_all_sessions=False)


def ensure_private_rx_default():
	"""Private prescription uploads default on; an explicit value in site_config (including 0) is respected."""
	if PRIVATE_RX_KEY in (frappe.get_site_config() or {}):
		return cint(frappe.conf.get(PRIVATE_RX_KEY))
	from frappe.installer import update_site_config

	update_site_config(PRIVATE_RX_KEY, 1)
	frappe.local.conf[PRIVATE_RX_KEY] = 1
	return 1


def ensure_circuit_sweep_job():
	"""Register the phase126 backstop as a Scheduled Job Type once the live hooks carry it (no global sync_jobs)."""
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	if CIRCUIT_SHARES_JOB not in (cron.get("*/10 * * * *") or []):
		return "not in hooks"
	if frappe.db.exists("Scheduled Job Type", {"method": CIRCUIT_SHARES_JOB}):
		return "present"
	frappe.get_doc(
		{"doctype": "Scheduled Job Type", "method": CIRCUIT_SHARES_JOB, "frequency": "Cron", "cron_format": "*/10 * * * *"}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return "created"


def _published_default_passwords():
	"""Well-known demo passwords the seeders used to apply (read from the seeder modules, not duplicated here)."""
	import importlib

	base = "health_ecosystem_core.health_ecosystem_core."
	sources = (
		("init", lambda m: [u.get("password") for u in m.DEFAULT_USERS]),
		("clinical_iam", lambda m: [m.SAMPLE_COLLECTOR_DEFAULT_PASSWORD]),
		("clinical_phase25", lambda m: [u.get("password") for u in m.SALES_SEED_USERS]),
		("clinical_phase28_ops", lambda m: [m.DEMO_PASSWORD]),
		("clinical_phase73b_careers", lambda m: [m.DEMO_HR_MANAGER["password"]]),
		("clinical_phase73e_pipeline", lambda m: [m.PEOPLE_DEMO["password"], m.HIRE_DEMO_PASSWORD]),
		("clinical_phase99_encounter", lambda m: [m.DEMO_PHYSICIAN["password"]]),
		("clinical_phase109_agency_agents", lambda m: [m.DEMO_AGENCY_PASSWORD]),
		("clinical_phase92_hr_policy_masters", lambda m: [m.SALES_REP_DEMO["password"]]),
		("clinical_franchisee_import", lambda m: [m.DEFAULT_PASSWORD]),
	)
	out = set()
	for module, pick in sources:
		try:
			out.update(p for p in pick(importlib.import_module(base + module)) if p)
		except Exception:
			continue
	return out


def _has_password(user, pwd):
	from frappe.utils.password import check_password

	try:
		check_password(user, pwd, delete_tracker_cache=False)
		return True
	except frappe.AuthenticationError:
		return False


def rotate_default_admin_passwords():
	"""System Manager / Health System Admin users still on a published demo password get a random one.
	New passwords are merged into site_config hec_rotated_admin_passwords before they are applied; returns user ids only."""
	defaults = _published_default_passwords()
	if not defaults:
		return []
	users = set(frappe.get_all("Has Role", filters={"role": ("in", ROTATE_ROLES), "parenttype": "User"}, pluck="parent"))
	# Dedicated People portal login. Its password is restored by seed_demo_hr_manager and must not be rotated.
	pinned = {"hr_manager@health.local"}
	targets = []
	for user in sorted(users - {"Administrator", "Guest"} - pinned):
		if not frappe.db.get_value("User", user, "enabled"):
			continue
		if any(_has_password(user, pwd) for pwd in defaults):
			targets.append(user)
	if not targets:
		return []
	from frappe.installer import update_site_config
	from frappe.utils.password import update_password

	fresh = {user: frappe.generate_hash(length=24) for user in targets}
	stored = dict((frappe.get_site_config() or {}).get(ROTATED_ADMIN_KEY) or {})
	stored.update(fresh)
	update_site_config(ROTATED_ADMIN_KEY, stored)
	frappe.local.conf[ROTATED_ADMIN_KEY] = stored
	for user, pwd in fresh.items():
		update_password(user, pwd, logout_all_sessions=True)
	frappe.db.commit()
	return targets


# ---------------------------------------------------------------------------
# Unique Patient ID
# ---------------------------------------------------------------------------


def generate_upi():
	"""Random REM-UID, checked against every issued ID (collisions are astronomically rare but never reused)."""
	for _attempt in range(20):
		upi = make_uid()
		if not frappe.db.exists(PATIENT_DT, {UPI_FIELD: upi}):
			return upi
	_fail(_("Could not allocate a Unique Patient ID"))


def validate_upi(upi):
	return validate_uid(cstr(upi).strip().upper())


def validate_legacy_upi(upi):
	upi = cstr(upi).strip().upper()
	return bool(LEGACY_UPI_RE.match(upi)) and verhoeff_validate(upi[len(LEGACY_UPI_PREFIX) :])


def patient_for_uid(value):
	"""Health Patient for a REM-UID (case / spacing / Crockford aliases tolerated) or a legacy RUP ID; None otherwise."""
	if not value or not _has_field(PATIENT_DT, UPI_FIELD):
		return None
	raw = cstr(value).strip().upper()
	uid = normalize_uid(raw)
	if validate_uid(uid):
		return frappe.db.get_value(PATIENT_DT, {UPI_FIELD: uid}, "name")
	if LEGACY_UPI_RE.match(raw):
		if _has_field(PATIENT_DT, LEGACY_UPI_FIELD):
			name = frappe.db.get_value(PATIENT_DT, {LEGACY_UPI_FIELD: raw}, "name")
			if name:
				return name
		return frappe.db.get_value(PATIENT_DT, {UPI_FIELD: raw}, "name")
	return None


def on_health_patient_validate(doc, method=None):
	"""Health Patient validate: an issued REM-UID and the recorded legacy RUP ID are permanent."""
	if doc.is_new() or not doc.meta.has_field(UPI_FIELD):
		return
	before = doc.get_doc_before_save()
	if not before:
		return
	old = cstr(before.get(UPI_FIELD)).strip()
	if old and validate_upi(old) and cstr(doc.get(UPI_FIELD)).strip() != old:
		frappe.throw(_("The Unique Patient ID {0} is permanent and cannot be changed").format(old), frappe.ValidationError)
	if doc.meta.has_field(LEGACY_UPI_FIELD):
		old_legacy = cstr(before.get(LEGACY_UPI_FIELD)).strip()
		if old_legacy and cstr(doc.get(LEGACY_UPI_FIELD)).strip() != old_legacy:
			frappe.throw(_("The legacy patient ID {0} is permanent and cannot be changed").format(old_legacy), frappe.ValidationError)


def assign_upi(patient_id):
	"""Idempotent: returns the patient's UPI, allocating one when missing."""
	if not patient_id or not _has_field(PATIENT_DT, UPI_FIELD):
		return None
	current = frappe.db.get_value(PATIENT_DT, patient_id, UPI_FIELD)
	if current:
		return current
	last_exc = None
	for _attempt in range(3):
		upi = generate_upi()
		try:
			frappe.db.set_value(PATIENT_DT, patient_id, UPI_FIELD, upi, update_modified=False)
			return upi
		except Exception as exc:
			last_exc = exc
	raise last_exc


def on_health_patient_before_insert(doc, method=None):
	try:
		if doc.meta.has_field(UPI_FIELD) and not doc.get(UPI_FIELD):
			doc.set(UPI_FIELD, generate_upi())
	except Exception:
		frappe.log_error(title="UPI on patient insert", message=frappe.get_traceback())


def _patient_link_of(doc):
	meta = doc.meta
	if meta.has_field("health_patient"):
		return doc.get("health_patient")
	if meta.has_field("patient"):
		return doc.get("patient")
	return None


def fill_universal_patient_id(doc, method=None):
	"""before_save on Customer TRF / Doctor Appointment / Clinical Prescription. Never blocks the save."""
	try:
		if not doc.meta.has_field(UPI_FIELD):
			return
		patient = _patient_link_of(doc)
		if not patient:
			return
		upi = frappe.db.get_value(PATIENT_DT, patient, UPI_FIELD)
		if upi and doc.get(UPI_FIELD) != upi:
			doc.set(UPI_FIELD, upi)
	except Exception:
		frappe.log_error(title=f"UPI fill {doc.doctype}", message=frappe.get_traceback())


def backfill_upi(batch=500):
	"""Assign UPIs to existing patients in committed batches. Safe to re-run."""
	if not _has_field(PATIENT_DT, UPI_FIELD):
		return 0
	total = 0
	tried = set()
	while True:
		names = [
			n
			for n in frappe.get_all(
				PATIENT_DT, filters={UPI_FIELD: ("is", "not set")}, pluck="name", order_by="creation asc", limit=cint(batch) or 500
			)
			if n not in tried
		]
		if not names:
			break
		for name in names:
			tried.add(name)
			try:
				if assign_upi(name):
					total += 1
			except Exception:
				frappe.log_error(title="UPI backfill", message=f"{name}\n{frappe.get_traceback()}")
		frappe.db.commit()
	return total


def _link_field(doctype):
	meta = frappe.get_meta(doctype)
	for field in ("health_patient", "patient"):
		df = meta.get_field(field)
		if df and df.fieldtype == "Link" and df.options == PATIENT_DT:
			return field
	return None


def backfill_linked_upi():
	"""Copy the patient's UPI onto TRF / appointment / prescription rows that link a patient but lack it."""
	out = {}
	if not _has_field(PATIENT_DT, UPI_FIELD):
		return out
	for dt in UPI_DOCTYPES:
		if not _has_field(dt, UPI_FIELD):
			continue
		link = _link_field(dt)
		if not link:
			continue
		missing = {UPI_FIELD: ("is", "not set"), link: ("is", "set")}
		before = frappe.db.count(dt, missing)
		if before:
			frappe.db.sql(
				f"""update `tab{dt}` t join `tab{PATIENT_DT}` p on p.name = t.`{link}`
				set t.`{UPI_FIELD}` = p.`{UPI_FIELD}`
				where ifnull(t.`{UPI_FIELD}`, '') = '' and ifnull(p.`{UPI_FIELD}`, '') != ''"""
			)
		out[dt] = before - frappe.db.count(dt, missing)
	return out


# ---------------------------------------------------------------------------
# Family accounts
# ---------------------------------------------------------------------------


def link_patient_account(user, patient, relation="Other", is_primary=0, consent=False):
	"""Idempotent on (user, patient); re-activates an inactive link."""
	if not user or not patient or user == "Guest" or not frappe.db.exists("DocType", PAL_DT):
		return None
	relation = relation if relation in RELATIONS else "Other"
	key = f"{user}::{patient}"
	existing = frappe.db.get_value(PAL_DT, {"link_key": key}, ["name", "active"], as_dict=True)
	if existing:
		if not cint(existing.active):
			frappe.db.set_value(PAL_DT, existing.name, "active", 1)
		return existing.name
	doc = frappe.get_doc(
		{
			"doctype": PAL_DT,
			"user": user,
			"patient": patient,
			"relation": relation,
			"is_primary": 1 if cint(is_primary) else 0,
			"active": 1,
			"link_key": key,
			"consent_on": now_datetime() if consent else None,
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(PAL_DT, {"link_key": key}, "name")
	return doc.name


def _profile_row(patient, relation, is_primary):
	fields = ["name", "patient_name", "gender", "mobile", "status"]
	meta = frappe.get_meta(PATIENT_DT)
	fields += [f for f in ("dob", UPI_FIELD, LEGACY_UPI_FIELD) if meta.has_field(f)]
	row = frappe.db.get_value(PATIENT_DT, patient, fields, as_dict=True)
	if not row:
		return None
	return {
		"patient": row.name,
		"patient_name": row.patient_name,
		"gender": row.gender,
		"mobile": row.mobile,
		"dob": cstr(row.get("dob") or "") or None,
		"universal_patient_id": row.get(UPI_FIELD),
		"legacy_upi": row.get(LEGACY_UPI_FIELD) or None,
		"relation": relation,
		"is_primary": 1 if cint(is_primary) else 0,
		"status": row.status,
	}


def list_profiles(user):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import primary_patient_for_user

	out, seen = [], set()
	primary = primary_patient_for_user(user)
	if primary and frappe.db.exists(PATIENT_DT, primary):
		assign_upi(primary)
		row = _profile_row(primary, "Self", 1)
		if row:
			out.append(row)
			seen.add(primary)
	if frappe.db.exists("DocType", PAL_DT):
		for link in frappe.get_all(
			PAL_DT,
			filters={"user": user, "active": 1},
			fields=["patient", "relation", "is_primary"],
			order_by="creation asc",
		):
			if link.patient in seen:
				continue
			seen.add(link.patient)
			assign_upi(link.patient)
			row = _profile_row(link.patient, link.relation, link.is_primary)
			if row:
				out.append(row)
	return out


def iam_profile(user):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

	profile = patient_profile_for_user(user) or {}
	pid = profile.get("patient_id")
	upi = assign_upi(pid) if pid else None
	if pid:
		link_patient_account(user, pid, "Self", is_primary=1)
	return {
		"user": user,
		"full_name": frappe.db.get_value("User", user, "full_name"),
		"patient_id": pid,
		"patient_name": profile.get("patient_name"),
		"universal_patient_id": upi,
		"profiles": list_profiles(user),
	}


def add_dependant(user, payload):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import names_match, primary_patient_for_user

	name = cstr(payload.get("patient_name")).strip()
	if len(name) < 2 or len(name) > 140:
		_fail(_("Enter the family member's full name"))
	relation = cstr(payload.get("relation") or "Other").strip()
	if relation not in RELATIONS or relation == "Self":
		_fail(_("Choose a relation"))
	if not cint(payload.get("consent")):
		_fail(_("Please confirm you are allowed to manage this person's health records"))
	gender = cstr(payload.get("gender") or "").strip().title() or "Other"
	if gender not in ("Male", "Female", "Other"):
		_fail(_("Invalid gender"))
	dob = cstr(payload.get("dob") or "").strip() or None
	if dob:
		try:
			dob = getdate(dob)
		except Exception:
			_fail(_("Invalid date of birth"))
		if dob > getdate(today()):
			_fail(_("Date of birth cannot be in the future"))
	else:
		age = cint(payload.get("age"))
		if age < 0 or age > 120:
			_fail(_("Invalid age"))
		if age:
			dob = getdate(add_to_date(today(), years=-age))

	profiles = list_profiles(user)
	for p in profiles:
		if p["relation"] != "Self" and names_match(p["patient_name"], name) and (not dob or not p["dob"] or getdate(p["dob"]) == dob):
			return p
	if len(profiles) >= MAX_PROFILES:
		_fail(_("A login can manage at most {0} profiles").format(MAX_PROFILES))

	mobile = cstr(payload.get("mobile") or "").strip() or frappe.db.get_value("User", user, "mobile_no")
	primary = primary_patient_for_user(user)
	if not mobile and primary:
		mobile = frappe.db.get_value(PATIENT_DT, primary, "mobile")
	doc = {"doctype": PATIENT_DT, "patient_name": name, "gender": gender, "mobile": mobile, "status": "Active"}
	if dob and frappe.get_meta(PATIENT_DT).has_field("dob"):
		doc["dob"] = dob
	patient = frappe.get_doc(doc)
	patient.flags.ignore_mandatory = True
	patient.insert(ignore_permissions=True)
	assign_upi(patient.name)
	link_patient_account(user, patient.name, relation, consent=True)
	return _profile_row(patient.name, relation, 0)


# ---------------------------------------------------------------------------
# Merge (manual only)
# ---------------------------------------------------------------------------


def _patient_link_columns():
	rows = list(
		frappe.db.sql(
			"select parent, fieldname from `tabDocField` where fieldtype = 'Link' and options = %s", (PATIENT_DT,), as_dict=True
		)
	)
	rows += frappe.db.sql(
		"select dt as parent, fieldname from `tabCustom Field` where fieldtype = 'Link' and options = %s",
		(PATIENT_DT,),
		as_dict=True,
	)
	skip = {PAL_DT, MERGE_DT}
	out, seen = [], set()
	for r in rows:
		key = (r.parent, r.fieldname)
		if r.parent in skip or key in seen or key == (PATIENT_DT, "merged_into"):
			continue
		seen.add(key)
		if not frappe.db.exists("DocType", r.parent):
			continue
		meta = frappe.get_meta(r.parent)
		if cint(meta.issingle) or cint(meta.get("is_virtual")) or not frappe.db.table_exists(r.parent):
			continue
		if not frappe.db.has_column(r.parent, r.fieldname):
			continue
		out.append(key)
	return out


def merge_patients(source, target, notes=None):
	"""Re-point every Health Patient link from source to target, keep source as Inactive (merged_into), log it."""
	source, target = cstr(source).strip(), cstr(target).strip()
	if not source or not target or source == target:
		_fail(_("Choose two different patients"))
	for pid in (source, target):
		if not frappe.db.exists(PATIENT_DT, pid):
			_fail(_("Patient {0} not found").format(pid))
	if _has_field(PATIENT_DT, "merged_into"):
		if frappe.db.get_value(PATIENT_DT, source, "merged_into"):
			_fail(_("{0} was already merged").format(source))
		if frappe.db.get_value(PATIENT_DT, target, "merged_into"):
			_fail(_("{0} is itself merged; pick the surviving record").format(target))
	source_upi = frappe.db.get_value(PATIENT_DT, source, UPI_FIELD) if _has_field(PATIENT_DT, UPI_FIELD) else None
	target_upi = assign_upi(target)

	repointed = {}
	for dt, field in _patient_link_columns():
		count = frappe.db.count(dt, {field: source})
		if count:
			frappe.db.sql(f"update `tab{dt}` set `{field}` = %s where `{field}` = %s", (target, source))
			repointed[f"{dt}.{field}"] = count
	if _has_field(PATIENT_DT, "referred_by") and frappe.db.get_value(PATIENT_DT, target, "referred_by") == target:
		frappe.db.set_value(PATIENT_DT, target, "referred_by", None, update_modified=False)

	if source_upi and target_upi:
		for dt in UPI_DOCTYPES:
			if _has_field(dt, UPI_FIELD):
				count = frappe.db.count(dt, {UPI_FIELD: source_upi})
				if count:
					frappe.db.sql(f"update `tab{dt}` set `{UPI_FIELD}` = %s where `{UPI_FIELD}` = %s", (target_upi, source_upi))
					repointed[f"{dt}.{UPI_FIELD}"] = count

	if frappe.db.exists("DocType", PAL_DT):
		moved = 0
		for link in frappe.get_all(PAL_DT, filters={"patient": source}, fields=["name", "user"]):
			key = f"{link.user}::{target}"
			if frappe.db.exists(PAL_DT, {"link_key": key}):
				frappe.db.set_value(PAL_DT, link.name, "active", 0)
			else:
				frappe.db.set_value(PAL_DT, link.name, {"patient": target, "link_key": key})
			moved += 1
		if moved:
			repointed[f"{PAL_DT}.patient"] = moved

	meta = frappe.get_meta(PATIENT_DT)
	if meta.has_field("linked_user"):
		src_user = frappe.db.get_value(PATIENT_DT, source, "linked_user")
		if src_user and not frappe.db.get_value(PATIENT_DT, target, "linked_user"):
			frappe.db.set_value(PATIENT_DT, target, "linked_user", src_user, update_modified=False)
	updates = {"status": "Inactive"}
	if meta.has_field("merged_into"):
		updates["merged_into"] = target
	frappe.db.set_value(PATIENT_DT, source, updates)

	log = frappe.get_doc(
		{
			"doctype": MERGE_DT,
			"source_patient": source,
			"target_patient": target,
			"source_upi": source_upi,
			"target_upi": target_upi,
			"merged_by": frappe.session.user,
			"merged_on": now_datetime(),
			"repointed_json": json.dumps(repointed, indent=1, sort_keys=True),
			"notes": cstr(notes)[:1000] or None,
		}
	)
	log.insert(ignore_permissions=True)
	return {"log": log.name, "source": source, "target": target, "repointed": repointed}


# ---------------------------------------------------------------------------
# One-time host handoff
# ---------------------------------------------------------------------------


def _clean_host(value):
	value = cstr(value).strip().lower()
	if not value:
		return ""
	parsed = urlparse(value if "//" in value else f"//{value}")
	return cstr(parsed.hostname).lower()


def handoff_host_allowed(host):
	host = _clean_host(host)
	if not host:
		return False
	extra = frappe.conf.get("hec_handoff_hosts") or []
	if host in HANDOFF_DEV_HOSTS or host in HANDOFF_HOSTS or host in extra:
		return True
	return any(host == s or host.endswith(f".{s}") for s in HANDOFF_HOST_SUFFIXES)


def _handoff_cache_key(code):
	return frappe.cache().make_key(f"hec_handoff:{hashlib.sha256(code.encode()).hexdigest()}")


def issue_handoff(user, target_host, ttl=HANDOFF_TTL_SECONDS):
	host = _clean_host(target_host)
	if not handoff_host_allowed(host):
		_fail(_("Unknown portal host"))
	if not user or user == "Guest":
		_deny(_("Not authenticated"))
	code = secrets.token_urlsafe(32)
	payload = {"user": user, "host": host, "exp": int(time.time()) + cint(ttl)}
	frappe.cache().set(_handoff_cache_key(code), json.dumps(payload), ex=max(1, cint(ttl)))
	return code


def consume_handoff(code, origin_host=None):
	"""Single use: the code is deleted in the same Redis transaction that reads it. Returns the user or None."""
	code = cstr(code).strip()
	if not HANDOFF_CODE_RE.match(code):
		return None
	pipe = frappe.cache().pipeline()
	key = _handoff_cache_key(code)
	pipe.get(key)
	pipe.delete(key)
	raw, _deleted = pipe.execute()
	if not raw:
		return None
	try:
		payload = json.loads(raw)
	except (TypeError, ValueError):
		return None
	if cint(payload.get("exp")) < int(time.time()):
		return None
	origin = _clean_host(origin_host)
	if origin and payload.get("host") and origin != payload["host"]:
		return None
	user = payload.get("user")
	if not user or not frappe.db.get_value("User", user, "enabled"):
		return None
	return user


def _request_origin_host():
	for header in ("Origin", "Referer"):
		value = frappe.get_request_header(header)
		if value:
			return _clean_host(value)
	return ""


def _session_payload(user):
	from health_ecosystem_core.health_ecosystem_core.api import _user_must_change_password

	roles = list(frappe.get_roles(user))
	franchisee = None
	if "Franchisee Operator" in roles:
		franchisee = frappe.db.get_value(
			"Franchisee Profile",
			{"linked_user": user, "active_status": "Active"},
			[
				"name",
				"branch_code",
				"franchise_name",
				"territory_region",
				"address",
				"contact_phone",
				"contact_email",
				"commission_percentage_rate",
			],
			as_dict=True,
		)
	doc = frappe.db.get_value("User", user, ["username", "full_name"], as_dict=True) or {}
	return {
		"user": user,
		"username": doc.get("username") or user,
		"full_name": doc.get("full_name"),
		"roles": roles,
		"sid": frappe.session.sid,
		"must_change_password": _user_must_change_password(user),
		"franchisee": franchisee,
	}


# ---------------------------------------------------------------------------
# Custody chain
# ---------------------------------------------------------------------------


def custody_secret():
	secret = frappe.conf.get(CUSTODY_SECRET_KEY)
	if secret:
		return cstr(secret)
	from frappe.installer import update_site_config

	on_disk = (frappe.get_site_config() or {}).get(CUSTODY_SECRET_KEY)
	secret = cstr(on_disk) if on_disk else secrets.token_hex(32)
	if not on_disk:
		update_site_config(CUSTODY_SECRET_KEY, secret)
	frappe.local.conf[CUSTODY_SECRET_KEY] = secret
	return secret


def _canonical_event(row):
	out = {}
	for f in SIGNED_FIELDS:
		value = row.get(f)
		if f in ("lat", "lng"):
			out[f] = f"{flt(value):.6f}"
		elif f == "seq":
			out[f] = cint(value)
		elif f == "created_at":
			out[f] = get_datetime(value).strftime("%Y-%m-%d %H:%M:%S.%f") if value else ""
		else:
			out[f] = cstr(value)
	return json.dumps(out, sort_keys=True, separators=(",", ":"))


def sign_event(row, prev_signature):
	message = f"{_canonical_event(row)}|{cstr(prev_signature)}".encode()
	return hmac.new(custody_secret().encode(), message, hashlib.sha256).hexdigest()


def _event_row(name):
	return frappe.db.get_value(CUSTODY_DT, name, list(SIGNED_FIELDS) + ["name", "signature"], as_dict=True)


def _last_event(scan_code):
	rows = frappe.get_all(
		CUSTODY_DT, filters={"scan_code": scan_code}, fields=["name", "seq", "signature"], order_by="seq desc", limit=1
	)
	return rows[0] if rows else None


def record_scan_event(
	scan_code,
	event,
	code_type=None,
	actor_user=None,
	actor_role=None,
	location_doctype=None,
	location_name=None,
	lat=None,
	lng=None,
	device_id=None,
	ref_doctype=None,
	ref_name=None,
	payload=None,
):
	"""The only writer of Custody Scan Event. Appends to the scan code's chain and signs it."""
	scan_code = cstr(scan_code).strip().upper()
	if not SCAN_CODE_RE.match(scan_code):
		_fail(_("Invalid scan code"))
	if event not in CUSTODY_EVENTS:
		_fail(_("Invalid custody event {0}").format(event))
	code_type = code_type or PREFIX_CODE_TYPES.get(match_prefix(scan_code) or "")
	if code_type and code_type not in CODE_TYPES:
		_fail(_("Invalid code type {0}").format(code_type))
	for dt in (location_doctype, ref_doctype):
		if dt and not frappe.db.exists("DocType", dt):
			_fail(_("Unknown DocType {0}").format(dt))
	if payload in (None, ""):
		payload_json = ""
	else:
		if isinstance(payload, str):
			payload = frappe.parse_json(payload)
		payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
		if len(payload_json) > 20000:
			_fail(_("Custody payload too large"))
	actor_user = actor_user or frappe.session.user

	for _attempt in range(3):
		prev = _last_event(scan_code)
		seq = (cint(prev.seq) if prev else 0) + 1
		doc = frappe.get_doc(
			{
				"doctype": CUSTODY_DT,
				"scan_code": scan_code,
				"code_type": code_type,
				"event": event,
				"seq": seq,
				"created_at": now_datetime(),
				"actor_user": actor_user,
				"actor_role": cstr(actor_role)[:140] or None,
				"location_doctype": location_doctype or None,
				"location_name": cstr(location_name)[:140] or None,
				"lat": flt(lat, 6),
				"lng": flt(lng, 6),
				"device_id": cstr(device_id)[:140] or None,
				"ref_doctype": ref_doctype or None,
				"ref_name": cstr(ref_name)[:140] or None,
				"payload_json": payload_json or None,
				"prev_event": prev.name if prev else None,
				"chain_key": f"{scan_code}#{seq}",
			}
		)
		doc.flags.hec_custody_write = True
		doc.flags.ignore_links = True
		try:
			doc.insert(ignore_permissions=True)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			continue
		signature = sign_event(_event_row(doc.name), prev.signature if prev else "")
		frappe.db.set_value(CUSTODY_DT, doc.name, "signature", signature, update_modified=False)
		return {"name": doc.name, "scan_code": scan_code, "seq": seq, "event": event, "prev_event": doc.prev_event, "signature": signature}
	_fail(_("Another scan of {0} is being recorded; try again").format(scan_code))


def verify_chain(scan_code):
	scan_code = cstr(scan_code).strip().upper()
	names = frappe.get_all(CUSTODY_DT, filters={"scan_code": scan_code}, pluck="name", order_by="seq asc", limit=0)
	prev_name, prev_sig = None, ""
	for idx, name in enumerate(names, start=1):
		row = _event_row(name)
		if cint(row.seq) != idx:
			return {"ok": False, "count": len(names), "broken_at": idx, "reason": "sequence gap"}
		if cstr(row.prev_event) != cstr(prev_name):
			return {"ok": False, "count": len(names), "broken_at": idx, "reason": "previous-event pointer mismatch"}
		if not row.signature or not hmac.compare_digest(sign_event(row, prev_sig), cstr(row.signature)):
			return {"ok": False, "count": len(names), "broken_at": idx, "reason": "signature mismatch"}
		prev_name, prev_sig = name, row.signature
	return {"ok": True, "count": len(names), "broken_at": None, "reason": None}


def custody_events(scan_code):
	scan_code = cstr(scan_code).strip().upper()
	rows = frappe.get_all(
		CUSTODY_DT,
		filters={"scan_code": scan_code},
		fields=[
			"name",
			"seq",
			"event",
			"code_type",
			"created_at",
			"actor_user",
			"actor_role",
			"location_doctype",
			"location_name",
			"lat",
			"lng",
			"ref_doctype",
			"ref_name",
		],
		order_by="seq asc",
		limit=500,
	)
	return {"scan_code": scan_code, "parsed": parse_code(scan_code), "events": rows, "verification": verify_chain(scan_code)}


def on_custody_event_validate(doc, method=None):
	if not (doc.flags.in_insert or doc.is_new()):
		frappe.throw(_("Custody scan events are immutable; record a new event instead"), frappe.PermissionError)
	if not doc.flags.hec_custody_write:
		frappe.throw(_("Custody scan events can only be written through record_scan_event"), frappe.PermissionError)


def on_custody_event_trash(doc, method=None):
	frappe.throw(_("Custody scan events cannot be deleted"), frappe.PermissionError)


def block_custody_rename(doc, method=None, *args, **kwargs):
	frappe.throw(_("Custody scan events cannot be renamed"), frappe.PermissionError)


# ---------------------------------------------------------------------------
# API clients (partner / machine keys)
# ---------------------------------------------------------------------------


def _secret_hash(salt, secret):
	return hashlib.sha256(f"{salt}:{secret}".encode()).hexdigest()


def _clean_scopes(scopes):
	if isinstance(scopes, str):
		scopes = frappe.parse_json(scopes) if scopes.strip().startswith("[") else re.split(r"[\s,]+", scopes)
	out = []
	for s in scopes or []:
		s = cstr(s).strip().lower()
		if not s:
			continue
		if not API_SCOPE_RE.match(s):
			_fail(_("Invalid scope {0}").format(s))
		if s not in out:
			out.append(s)
	return out


def _new_secret(doc):
	secret = secrets.token_urlsafe(32)
	salt = secrets.token_hex(8)
	doc.api_secret = secret
	doc.secret_salt = salt
	doc.api_secret_hash = _secret_hash(salt, secret)
	return secret


def create_api_client(client_name, client_type="Partner Lab", scopes=None, linked_lab=None, notes=None):
	"""Returns the plain secret exactly once; only an encrypted copy (Password field) and a salted hash are stored."""
	client_name = cstr(client_name).strip()
	if not client_name:
		_fail(_("Client name is required"))
	if client_type not in CLIENT_TYPES:
		_fail(_("Invalid client type"))
	if linked_lab and not frappe.db.exists("Franchisee Profile", linked_lab):
		_fail(_("Linked lab not found"))
	doc = frappe.get_doc(
		{
			"doctype": API_CLIENT_DT,
			"client_name": client_name[:140],
			"client_type": client_type,
			"linked_lab": linked_lab or None,
			"api_key": f"hec_{secrets.token_hex(12)}",
			"scopes": "\n".join(_clean_scopes(scopes)),
			"active": 1,
			"notes": cstr(notes)[:1000] or None,
		}
	)
	secret = _new_secret(doc)
	doc.insert(ignore_permissions=True)
	return {"name": doc.name, "api_key": doc.api_key, "api_secret": secret, "scopes": _clean_scopes(doc.scopes)}


def rotate_api_client_secret(name):
	doc = frappe.get_doc(API_CLIENT_DT, name)
	secret = _new_secret(doc)
	doc.save(ignore_permissions=True)
	return {"name": doc.name, "api_key": doc.api_key, "api_secret": secret}


def api_signature(secret, timestamp, body):
	body = body if isinstance(body, bytes) else cstr(body).encode()
	return hmac.new(cstr(secret).encode(), f"{cint(timestamp)}.".encode() + body, hashlib.sha256).hexdigest()


def verify_api_signature(api_key, signature, timestamp, body, required_scope=None, now_ts=None):
	"""Signature = hex HMAC-SHA256(api_secret, f"{timestamp}." + raw_body); rejects > 5 minutes skew and replays."""
	if not api_key or not signature or not timestamp:
		raise frappe.AuthenticationError(_("Missing API signature headers"))
	try:
		ts = int(cstr(timestamp).strip())
	except ValueError:
		raise frappe.AuthenticationError(_("Invalid request timestamp"))
	now_ts = cint(now_ts) or int(time.time())
	if abs(now_ts - ts) > API_MAX_SKEW_SECONDS:
		raise frappe.AuthenticationError(_("Stale request timestamp"))
	row = frappe.db.get_value(
		API_CLIENT_DT,
		{"api_key": cstr(api_key).strip()},
		["name", "active", "scopes", "api_secret_hash", "secret_salt", "linked_lab", "client_type"],
		as_dict=True,
	)
	if not row or not cint(row.active):
		raise frappe.AuthenticationError(_("Unknown or inactive API key"))
	from frappe.utils.password import get_decrypted_password

	secret = get_decrypted_password(API_CLIENT_DT, row.name, "api_secret", raise_exception=False)
	if not secret or not hmac.compare_digest(_secret_hash(row.secret_salt, secret), cstr(row.api_secret_hash)):
		raise frappe.AuthenticationError(_("API client secret unavailable; rotate the key"))
	if not hmac.compare_digest(api_signature(secret, ts, body), cstr(signature).strip().lower()):
		raise frappe.AuthenticationError(_("Invalid API signature"))
	scopes = _clean_scopes(row.scopes)
	if required_scope and required_scope not in scopes and "*" not in scopes:
		raise frappe.PermissionError(_("Scope {0} not granted to this API key").format(required_scope))
	cache = frappe.cache()
	replay_key = cache.make_key(f"hec_api_sig:{cstr(signature).strip().lower()}")
	if not cache.set(replay_key, "1", ex=API_MAX_SKEW_SECONDS * 2, nx=True):
		raise frappe.AuthenticationError(_("Replayed request"))
	frappe.db.set_value(API_CLIENT_DT, row.name, "last_used", now_datetime(), update_modified=False)
	return {"name": row.name, "client_type": row.client_type, "linked_lab": row.linked_lab, "scopes": scopes}


def authenticate_api_client(required_scope=None):
	"""For partner / converter endpoints: X-Api-Key, X-Api-Timestamp (unix seconds), X-Api-Signature."""
	request = getattr(frappe.local, "request", None)
	body = request.get_data() if request is not None else b""
	return verify_api_signature(
		frappe.get_request_header("X-Api-Key"),
		frappe.get_request_header("X-Api-Signature"),
		frappe.get_request_header("X-Api-Timestamp"),
		body,
		required_scope=required_scope,
	)


def _api_client_row(row):
	return {
		"name": row.name,
		"client_name": row.client_name,
		"client_type": row.client_type,
		"linked_lab": row.linked_lab,
		"api_key": row.api_key,
		"scopes": _clean_scopes(row.scopes),
		"active": cint(row.active),
		"last_used": row.last_used,
	}


def list_api_clients():
	rows = frappe.get_all(
		API_CLIENT_DT,
		fields=["name", "client_name", "client_type", "linked_lab", "api_key", "scopes", "active", "last_used"],
		order_by="creation desc",
		limit=500,
	)
	return {"clients": [_api_client_row(r) for r in rows]}


# ---------------------------------------------------------------------------
# Field providers and payouts
# ---------------------------------------------------------------------------

FP_EDITABLE = (
	"full_name",
	"mobile",
	"is_phlebo_rider",
	"is_teleporter_runner",
	"status",
	"aadhaar_last4",
	"pan",
	"dl_no",
	"vehicle_type",
	"vehicle_no",
	"home_lat",
	"home_lng",
	"service_radius_km",
	"base_hub",
	"payout_upi",
	"bank_account_name",
	"bank_account_no",
	"bank_ifsc",
	"notes",
)


def save_field_provider(payload):
	name = cstr(payload.get("name")).strip()
	if name:
		doc = frappe.get_doc(FP_DT, name)
	else:
		user = cstr(payload.get("user")).strip()
		if not user or not frappe.db.exists("User", user):
			_fail(_("Choose an existing user"))
		if frappe.db.exists(FP_DT, {"user": user}):
			_fail(_("This user already has a field provider record"))
		doc = frappe.new_doc(FP_DT)
		doc.user = user
		doc.full_name = frappe.db.get_value("User", user, "full_name")
		doc.mobile = frappe.db.get_value("User", user, "mobile_no")
	for f in FP_EDITABLE:
		if f in payload:
			doc.set(f, payload.get(f))
	if doc.status and doc.status not in FP_STATUSES:
		_fail(_("Invalid status"))
	if doc.vehicle_type and doc.vehicle_type not in VEHICLE_TYPES:
		_fail(_("Invalid vehicle type"))
	if doc.aadhaar_last4 and not re.match(r"^\d{4}$", cstr(doc.aadhaar_last4)):
		_fail(_("Aadhaar: enter the last 4 digits only"))
	if doc.pan:
		doc.pan = cstr(doc.pan).strip().upper()
		if not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", doc.pan):
			_fail(_("Invalid PAN"))
	if doc.bank_ifsc:
		doc.bank_ifsc = cstr(doc.bank_ifsc).strip().upper()
		if not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", doc.bank_ifsc):
			_fail(_("Invalid IFSC"))
	if not cint(doc.is_phlebo_rider) and not cint(doc.is_teleporter_runner):
		_fail(_("Pick at least one provider type"))
	doc.provider_types = ", ".join(
		t for t, on in (("Phlebo Rider", doc.is_phlebo_rider), ("Teleporter Runner", doc.is_teleporter_runner)) if cint(on)
	)
	if doc.status == "Active" and not doc.onboarded_on:
		doc.onboarded_on = today()
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return {**doc.as_dict(no_default_fields=True), "name": doc.name}


def list_field_providers(filters=None, page=1, page_size=20):
	filters = filters or {}
	where = {}
	if filters.get("status"):
		where["status"] = filters["status"]
	if filters.get("type") == "rider":
		where["is_phlebo_rider"] = 1
	elif filters.get("type") == "runner":
		where["is_teleporter_runner"] = 1
	or_filters = None
	q = cstr(filters.get("q")).strip()
	if q:
		or_filters = [["full_name", "like", f"%{q}%"], ["mobile", "like", f"%{q}%"], ["user", "like", f"%{q}%"]]
	page = max(1, cint(page) or 1)
	size = min(max(1, cint(page_size) or 20), 100)
	fields = ["name", "user", "full_name", "mobile", "provider_types", "status", "service_radius_km", "base_hub", "rating_avg", "onboarded_on"]
	rows = frappe.get_all(FP_DT, filters=where, or_filters=or_filters, fields=fields, order_by="modified desc", start=(page - 1) * size, limit=size)
	total = len(frappe.get_all(FP_DT, filters=where, or_filters=or_filters, pluck="name", limit=0)) if or_filters else frappe.db.count(FP_DT, where)
	return {"rows": rows, "total": total, "page": page, "page_size": size}


def post_payout(payload):
	provider = cstr(payload.get("provider")).strip()
	if not provider or not frappe.db.exists(FP_DT, provider):
		_fail(_("Provider not found"))
	entry_type = payload.get("entry_type")
	if entry_type not in PAYOUT_TYPES:
		_fail(_("Invalid payout type"))
	amount = flt(payload.get("amount"), 2)
	if not amount:
		_fail(_("Amount is required"))
	source_doctype = payload.get("source_doctype") or None
	if source_doctype and not frappe.db.exists("DocType", source_doctype):
		_fail(_("Unknown source DocType"))
	period = cstr(payload.get("period") or today()[:7]).strip()
	if not re.match(r"^\d{4}-\d{2}$", period):
		_fail(_("Period must look like 2026-10"))
	doc = frappe.get_doc(
		{
			"doctype": PAYOUT_DT,
			"provider": provider,
			"entry_type": entry_type,
			"amount": amount,
			"status": "Accrued",
			"source_doctype": source_doctype,
			"source_name": payload.get("source_name") or None,
			"period": period,
			"posted_on": now_datetime(),
			"remarks": cstr(payload.get("remarks"))[:1000] or None,
		}
	)
	doc.flags.ignore_links = True
	doc.insert(ignore_permissions=True)
	return {**doc.as_dict(no_default_fields=True), "name": doc.name}


def set_payout_status(name, status, paid_ref=None):
	doc = frappe.get_doc(PAYOUT_DT, name)
	if status not in PAYOUT_TRANSITIONS.get(doc.status, set()):
		_fail(_("Cannot move a {0} payout to {1}").format(doc.status, status))
	if status == "Paid" and not cstr(paid_ref).strip():
		_fail(_("Payment reference is required"))
	doc.status = status
	if paid_ref:
		doc.paid_ref = cstr(paid_ref).strip()[:140]
	doc.save(ignore_permissions=True)
	return {**doc.as_dict(no_default_fields=True), "name": doc.name}


def list_payouts(filters=None, page=1, page_size=20):
	filters = filters or {}
	where = {k: filters[k] for k in ("provider", "status", "entry_type", "period") if filters.get(k)}
	page = max(1, cint(page) or 1)
	size = min(max(1, cint(page_size) or 20), 200)
	rows = frappe.get_all(
		PAYOUT_DT,
		filters=where,
		fields=["name", "provider", "entry_type", "amount", "status", "source_doctype", "source_name", "period", "posted_on", "paid_ref"],
		order_by="posted_on desc",
		start=(page - 1) * size,
		limit=size,
	)
	totals = frappe.get_all(PAYOUT_DT, filters=where, fields=["status", "sum(amount) as amount"], group_by="status")
	return {"rows": rows, "total": frappe.db.count(PAYOUT_DT, where), "totals": {t.status: flt(t.amount) for t in totals}}


# ---------------------------------------------------------------------------
# Devices (web push)
# ---------------------------------------------------------------------------


def register_device(user, device_id, platform="Web", push_subscription=None, user_agent=None):
	device_id = cstr(device_id).strip()
	if not re.match(r"^[A-Za-z0-9._:-]{8,140}$", device_id):
		_fail(_("Invalid device id"))
	if platform not in ("Web", "Android", "iOS", "Other"):
		platform = "Other"
	sub = None
	if push_subscription not in (None, ""):
		if isinstance(push_subscription, str):
			push_subscription = frappe.parse_json(push_subscription)
		if not isinstance(push_subscription, dict) or not cstr(push_subscription.get("endpoint")).startswith("https://"):
			_fail(_("Invalid push subscription"))
		sub = json.dumps(push_subscription, sort_keys=True)
		if len(sub) > 4000:
			_fail(_("Push subscription too large"))
	values = {
		"user": user,
		"platform": platform,
		"user_agent": cstr(user_agent)[:500] or None,
		"last_seen": now_datetime(),
		"active": 1,
	}
	if sub is not None:
		values["push_subscription_json"] = sub
	name = frappe.db.get_value(DEVICE_DT, {"device_id": device_id}, "name")
	if name:
		frappe.db.set_value(DEVICE_DT, name, values)
	else:
		doc = frappe.get_doc({"doctype": DEVICE_DT, "device_id": device_id, **values})
		doc.insert(ignore_permissions=True)
		name = doc.name
	return {"name": name, "device_id": device_id, "push": bool(sub or frappe.db.get_value(DEVICE_DT, name, "push_subscription_json"))}


def unregister_device(user, device_id):
	name = frappe.db.get_value(DEVICE_DT, {"device_id": cstr(device_id).strip(), "user": user}, "name")
	if name:
		frappe.db.set_value(DEVICE_DT, name, {"active": 0, "push_subscription_json": None})
	return {"removed": bool(name)}


# ---------------------------------------------------------------------------
# Private prescription uploads
# ---------------------------------------------------------------------------


def _rx_orders(file_url):
	if not frappe.db.exists("DocType", "Pharmacy Order"):
		return []
	return frappe.get_all("Pharmacy Order", filters={"uploaded_prescription_url": file_url}, fields=["name", "owner"], limit=20)


def can_read_rx(file_doc, user=None, roles=None):
	user = user or frappe.session.user
	if user == "Guest":
		return False
	if not cint(file_doc.is_private) or file_doc.owner == user or user == "Administrator":
		return True
	if file_doc.attached_to_doctype == "Pharmacy Order" and file_doc.attached_to_name:
		if frappe.has_permission("Pharmacy Order", "read", file_doc.attached_to_name, user=user):
			return True
	orders = _rx_orders(file_doc.file_url)
	if not orders:
		return False
	roles = set(roles if roles is not None else frappe.get_roles(user))
	if roles & RX_STAFF_ROLES:
		return True
	return any(frappe.has_permission("Pharmacy Order", "read", o.name, user=user) for o in orders)


def attach_private_rx(doc, method=None):
	"""Pharmacy Order after_insert: attach the uploader's private Rx file so desk permissions follow the order."""
	try:
		url = cstr(doc.get("uploaded_prescription_url"))
		if not url.startswith("/private/files/"):
			return
		name = frappe.db.get_value(
			"File", {"file_url": url, "owner": doc.owner, "attached_to_name": ("is", "not set")}, "name"
		)
		if name:
			frappe.db.set_value(
				"File",
				name,
				{"attached_to_doctype": "Pharmacy Order", "attached_to_name": doc.name, "attached_to_field": "uploaded_prescription_url"},
				update_modified=False,
			)
	except Exception:
		frappe.log_error(title="attach_private_rx", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _parse(value, default=None):
	if value in (None, ""):
		return default if default is not None else {}
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		_fail(_("Invalid request payload"))


def _call(sid, access, fn, message="OK", commit=False):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	roles = set(frappe.get_roles(frappe.session.user))
	if access == "manage" and not roles & MANAGE_ROLES:
		return _error(_("Admin access required"), 403)
	if access == "staff" and not roles & STAFF_ROLES:
		return _error(_("Lab staff access required"), 403)
	try:
		_ensure_ready()
		data = fn(roles)
		if commit:
			frappe.db.commit()
		return _success(data, message=message)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


@frappe.whitelist(allow_guest=True)
def iam_me(sid=None):
	return _call(sid, "user", lambda roles: iam_profile(frappe.session.user), commit=True)


@frappe.whitelist(allow_guest=True)
def iam_list_profiles(sid=None):
	return _call(sid, "user", lambda roles: {"profiles": list_profiles(frappe.session.user)}, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def iam_add_dependant(payload=None, sid=None):
	return _call(
		sid, "user", lambda roles: add_dependant(frappe.session.user, _parse(payload)), message=_("Profile added"), commit=True
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def iam_merge_patients(source=None, target=None, notes=None, sid=None):
	return _call(sid, "manage", lambda roles: merge_patients(source, target, notes), message=_("Patients merged"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def iam_issue_handoff_code(target_host=None, sid=None):
	def run(roles):
		code = issue_handoff(frappe.session.user, target_host)
		return {"code": code, "expires_in": HANDOFF_TTL_SECONDS, "target_host": _clean_host(target_host)}

	return _call(sid, "user", run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def iam_redeem_handoff_code(code=None):
	"""Guest: swaps a one-time handoff code for a fresh session on this host (same shape as authenticate_user)."""
	frappe.flags.ignore_csrf = True
	code = code or frappe.form_dict.get("code")
	user = consume_handoff(code, _request_origin_host())
	if not user:
		return _error(_("This sign-in link has expired. Please sign in again."), 401)
	try:
		from frappe.auth import LoginManager

		login_manager = getattr(frappe.local, "login_manager", None) or LoginManager()
		login_manager.login_as(user)
		frappe.local.login_manager = login_manager
		frappe.db.commit()
		return _success(_session_payload(user), message="Authenticated")
	except Exception:
		frappe.log_error(title="iam_redeem_handoff_code", message=frappe.get_traceback())
		return _error(_("Could not sign you in. Please sign in again."), 401)


@frappe.whitelist(allow_guest=True)
def rx_file(file_url=None, sid=None):
	"""Streams an uploaded prescription to its owner or to pharmacy staff handling an order that references it."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	file_url = cstr(file_url).strip()
	if not file_url.startswith(("/private/files/", "/files/")) or ".." in file_url:
		return _error(_("Invalid file"))
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		return _error(_("File not found"), 404)
	file_doc = frappe.get_doc("File", name)
	if not can_read_rx(file_doc):
		return _error(_("Not permitted"), 403)
	if cint(file_doc.is_private) and not file_doc.attached_to_name:
		orders = [o for o in _rx_orders(file_url) if o.owner == file_doc.owner]
		if orders:
			attach_private_rx(frappe._dict(uploaded_prescription_url=file_url, owner=file_doc.owner, name=orders[0].name))
			frappe.db.commit()
	frappe.local.response.filename = file_doc.file_name
	frappe.local.response.filecontent = file_doc.get_content()
	frappe.local.response.type = "download"


@frappe.whitelist(allow_guest=True)
def fp_list(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "manage", lambda roles: list_field_providers(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def fp_save(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: save_field_provider(_parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def payout_list(filters=None, page=1, page_size=20, sid=None):
	return _call(sid, "manage", lambda roles: list_payouts(_parse(filters), page, page_size))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def payout_post(payload=None, sid=None):
	return _call(sid, "manage", lambda roles: post_payout(_parse(payload)), message=_("Posted"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def payout_set_status(name=None, status=None, paid_ref=None, sid=None):
	return _call(sid, "manage", lambda roles: set_payout_status(name, status, paid_ref), message=_("Updated"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def custody_record(payload=None, sid=None):
	def run(roles):
		p = _parse(payload)
		return record_scan_event(
			p.get("scan_code"),
			p.get("event"),
			code_type=p.get("code_type"),
			actor_role=p.get("actor_role") or next(iter(sorted(roles & MANAGE_ROLES)), None),
			location_doctype=p.get("location_doctype"),
			location_name=p.get("location_name"),
			lat=p.get("lat"),
			lng=p.get("lng"),
			device_id=p.get("device_id"),
			ref_doctype=p.get("ref_doctype"),
			ref_name=p.get("ref_name"),
			payload=p.get("payload"),
		)

	return _call(sid, "manage", run, message=_("Recorded"), commit=True)


@frappe.whitelist(allow_guest=True)
def custody_chain(scan_code=None, sid=None):
	return _call(sid, "staff", lambda roles: custody_events(scan_code))


@frappe.whitelist(allow_guest=True)
def api_client_list(sid=None):
	return _call(sid, "manage", lambda roles: list_api_clients())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def api_client_create(client_name=None, client_type="Partner Lab", scopes=None, linked_lab=None, notes=None, sid=None):
	return _call(
		sid,
		"manage",
		lambda roles: create_api_client(client_name, client_type, scopes, linked_lab, notes),
		message=_("Copy the secret now; it is not shown again"),
		commit=True,
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def api_client_rotate(name=None, sid=None):
	return _call(
		sid, "manage", lambda roles: rotate_api_client_secret(name), message=_("Copy the secret now; it is not shown again"), commit=True
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def api_client_set_active(name=None, active=1, sid=None):
	def run(roles):
		if not frappe.db.exists(API_CLIENT_DT, name):
			_fail(_("API client not found"))
		frappe.db.set_value(API_CLIENT_DT, name, "active", 1 if cint(active) else 0)
		return {"name": name, "active": 1 if cint(active) else 0}

	return _call(sid, "manage", run, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def device_register(device_id=None, platform="Web", push_subscription=None, sid=None):
	ua = frappe.get_request_header("User-Agent")
	return _call(
		sid, "user", lambda roles: register_device(frappe.session.user, device_id, platform, push_subscription, ua), commit=True
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def device_unregister(device_id=None, sid=None):
	return _call(sid, "user", lambda roles: unregister_device(frappe.session.user, device_id), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def barcode_labels(codes=None, fmt="pdf", size=None, captions=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import LABEL_ROLES

	def run(roles):
		if not roles & LABEL_ROLES:
			_deny(_("Staff access required"))
		return render_labels(codes, fmt, size, captions)

	return _call(sid, "user", run)


# ---------------------------------------------------------------------------
# Smoke (throwaway data, rolled back)
# ---------------------------------------------------------------------------


def smoke_phase132():
	"""Check digits, labels, UPI, dedupe, merge, custody chain, API signatures, handoff codes, payment scopes.
	Everything written is rolled back; returns {checks, passed, total, ok}."""
	setup = setup_phase132()
	setup_rotated = setup.get("rotated_admin_users") or []
	out = {
		"ok": True,
		"checks": [],
		"setup": {
			k: setup.get(k)
			for k in (
				"created",
				"upi_backfilled",
				"patients_without_upi",
				"patients_total",
				"custody_secret",
				"private_rx_uploads",
				"rotated_admin_users",
				"circuit_sweep_job",
			)
		},
	}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:200]})
		if not cond:
			out["ok"] = False

	def refused(fn, errors=(frappe.ValidationError, frappe.PermissionError, frappe.AuthenticationError)):
		try:
			fn()
		except errors as exc:
			return cstr(exc) or "refused"
		return None

	from health_ecosystem_core.health_ecosystem_core import clinical_barcodes as bc
	from health_ecosystem_core.health_ecosystem_core import patient_bridge as pb

	tag = frappe.generate_hash(length=6).upper()
	try:
		# Check digits and codes
		check("verhoeff 236 -> 3", bc.verhoeff_check_digit("236") == "3")
		check("verhoeff validates 2363, rejects 2364 / transposed 2633", verhoeff_validate("2363") and not verhoeff_validate("2364") and not verhoeff_validate("2633"))
		check("mod11 ORCID vectors (7 and X)", mod11_check_char("000000021825009") == "7" and mod11_check_char("000000021694233") == "X")
		check("mod11 validate / reject", mod11_validate("0000000218250097") and not mod11_validate("0000000218250098"))
		ru = bc.make_code("RU", 4242)
		bad = ru[:-2] + str((int(ru[-2]) + 1) % 10) + ru[-1]
		check("make_code RU round-trips, corrupt digit rejected", bc.validate_code(ru, "RU") and not bc.validate_code(bad), (ru, bad))
		upi_sample = f"RUP1234567890{bc.verhoeff_check_digit('1234567890')}"
		check("legacy RUP not read as RU; RUP validates", bc.match_prefix(upi_sample) == "RUP" and bc.parse_code(upi_sample)["valid"] and validate_legacy_upi(upi_sample), bc.parse_code(upi_sample))
		uid_sample = bc.make_uid("ABCDEFG")
		check(
			"REM-UID vector ABCDEFG -> check C; parses as Unique Patient ID; corrupted char rejected",
			uid_sample == "REM-UID-ABCDEFGC" and validate_upi(uid_sample) and bc.parse_code(uid_sample)["label"] == bc.UID_LABEL and not validate_upi("REM-UID-ABCDEFHC"),
			uid_sample,
		)
		check("code128 table: symbols 11 modules, stop 13", all(sum(map(int, p)) == 11 for p in bc._C128[:106]) and sum(map(int, bc._C128[106])) == 13)
		mods = bc.code128_modules("RU123")
		check("code128 set B length", len(mods) == 11 * (len("RU123") + 2) + 13, len(mods))
		check("code128 set C used for even digits", bc.code128_values("123456")[0] == 105 and len(bc.code128_values("123456")) == 6)
		pdf = render_labels([ru, uid_sample], "pdf", "50x25", {ru: "Smoke tube"})
		import base64 as _b64

		check("label PDF", _b64.b64decode(pdf["content_base64"])[:4] == b"%PDF")
		zpl = render_labels([ru], "zpl")
		check("label ZPL", zpl["content"].startswith("^XA") and ru in zpl["content"] and "^XZ" in zpl["content"])
		tspl = render_labels([ru], "tspl", "38x25")
		check("label TSPL", "SIZE 38 mm,25 mm" in tspl["content"] and f'"{ru}"' in tspl["content"])
		check("bad label value refused", refused(lambda: render_labels(["bad code<>"], "zpl")))

		# UPI
		check("UPI custom field unique on Health Patient", cint(frappe.get_meta(PATIENT_DT).get_field(UPI_FIELD).unique) == 1)
		check("backfill left no patient without UPI", setup.get("patients_without_upi") == 0, setup.get("patients_without_upi"))
		phone = f"9{secrets.randbelow(10**9):09d}"
		user = f"p132smoke-{tag.lower()}@example.invalid"
		frappe.get_doc(
			{"doctype": "User", "email": user, "first_name": "P132", "last_name": tag, "user_type": "Website User", "send_welcome_email": 0, "mobile_no": phone}
		).insert(ignore_permissions=True)
		a = pb.ensure_patient(f"P132 Smoke Ravi {tag}", phone=phone, gender="Male", user=user)
		a_upi = frappe.db.get_value(PATIENT_DT, a, UPI_FIELD)
		check("REM-UID assigned on new patient and valid", validate_upi(a_upi) and a_upi.startswith(UPI_PREFIX), a_upi)

		# Dedupe
		a2 = pb.ensure_patient(f"  mr p132 smoke  RAVI {tag.lower()} ", phone=phone, user=user)
		check("same phone + same (normalised) name -> same patient", a2 == a, (a, a2))
		b = pb.ensure_patient(f"P132 Smoke Sita {tag}", phone=phone, gender="Female")
		b_upi = frappe.db.get_value(PATIENT_DT, b, UPI_FIELD)
		check("same phone + different name -> new patient", b and b != a, (a, b))
		check("new patient gets a different UPI", validate_upi(b_upi) and b_upi != a_upi)
		check(
			"different-name patient linked to the phone owner's account (Other)",
			frappe.db.get_value(PAL_DT, {"user": user, "patient": b, "active": 1}, "relation") == "Other",
		)
		check("account holder's primary profile unchanged", pb.primary_patient_for_user(user) == a, pb.primary_patient_for_user(user))
		b2 = pb.ensure_patient(f"P132 Smoke Sita {tag}", phone=phone, user=user)
		check("dependant re-booked by holder -> same dependant, primary kept", b2 == b and pb.primary_patient_for_user(user) == a)
		check("phone-only lookup returns the holder, not the dependant", pb.find_patient(phone=phone) == a, pb.find_patient(phone=phone))
		check("OTP placeholder name keeps phone match", pb.ensure_patient(f"Patient {phone[-4:]}", phone=phone) == a)
		check("UPI match wins over name", pb.ensure_patient("Someone Else", phone=phone, upi=b_upi) == b)
		if frappe.get_meta(PATIENT_DT).has_field("dob"):
			frappe.db.set_value(PATIENT_DT, a, "dob", "1990-05-01", update_modified=False)
			check(
				"phone + name + DOB: matching DOB matches, different DOB does not",
				pb.find_patient(phone=phone, patient_name=f"P132 Smoke Ravi {tag}", dob="1990-05-01") == a
				and pb.find_patient(phone=phone, patient_name=f"P132 Smoke Ravi {tag}", dob="1901-01-01") is None,
			)
		email = f"p132smoke-e-{tag.lower()}@example.invalid"
		c = pb.ensure_patient(f"P132 Smoke Email {tag}", email=email)
		c2 = pb.ensure_patient(f"P132 Smoke Email {tag}", phone=f"8{secrets.randbelow(10**9):09d}", email=email)
		check("email + name match across a new phone", c2 == c, (c, c2))
		c3 = pb.ensure_patient(f"P132 Smoke Other {tag}", email=email)
		check("email match with different name -> new patient", c3 and c3 != c)

		profiles = list_profiles(user)
		check("profiles list holder (Self) + dependant", [p["relation"] for p in profiles][:1] == ["Self"] and any(p["patient"] == b for p in profiles), profiles)
		dep = add_dependant(user, {"patient_name": f"P132 Smoke Kid {tag}", "relation": "Child", "gender": "Female", "age": 6, "consent": 1})
		check("iam add dependant", dep and dep["relation"] == "Child" and validate_upi(dep["universal_patient_id"]), dep)
		again = add_dependant(user, {"patient_name": f"p132 smoke kid {tag}", "relation": "Child", "age": 6, "consent": 1})
		check("add dependant is idempotent by name", again["patient"] == dep["patient"])
		check("add dependant without consent refused", refused(lambda: add_dependant(user, {"patient_name": "X Y", "relation": "Child"})))

		# Merge
		jr = frappe.get_doc({"doctype": "Patient Care Journey", "patient": b, "patient_name": f"P132 Smoke Sita {tag}", "status": "Diagnostics Booked"})
		jr.flags.ignore_mandatory = True
		jr.flags.ignore_links = True
		jr.insert(ignore_permissions=True)
		merged = merge_patients(b, dep["patient"], notes="smoke")
		check("merge re-points journey", frappe.db.get_value("Patient Care Journey", jr.name, "patient") == dep["patient"], merged["repointed"])
		check(
			"merge moves account links (source link deactivated when target already linked)",
			not frappe.db.exists(PAL_DT, {"patient": b, "active": 1}),
		)
		src = frappe.db.get_value(PATIENT_DT, b, ["status", "merged_into"], as_dict=True)
		check("merge marks source inactive + merged_into", src.status == "Inactive" and src.merged_into == dep["patient"], src)
		check("merge log written", frappe.db.exists(MERGE_DT, merged["log"]))
		check("second merge of same source refused", refused(lambda: merge_patients(b, a)))

		# Custody chain
		code = bc.make_code("RU", 900000 + secrets.randbelow(99999))
		dev = f"{SMOKE_TAG}-{tag}"
		e1 = record_scan_event(code, "Issued", device_id=dev, payload={"kit": dev})
		e2 = record_scan_event(code, "Bound", lat=22.572646, lng=88.363895, device_id=dev, ref_doctype="Health Patient", ref_name=a)
		e3 = record_scan_event(code, "Dropped At Hub", device_id=dev, payload={"hub": "smoke"})
		check("custody chain seq + prev pointers", (e1["seq"], e2["seq"], e3["seq"]) == (1, 2, 3) and e2["prev_event"] == e1["name"] and e3["prev_event"] == e2["name"])
		check("custody code type inferred from prefix", frappe.db.get_value(CUSTODY_DT, e1["name"], "code_type") == "Universal Barcode")
		v = verify_chain(code)
		check("custody chain verifies", v["ok"] and v["count"] == 3, v)
		frappe.db.set_value(CUSTODY_DT, e2["name"], "lat", 23.0, update_modified=False)
		v = verify_chain(code)
		check("tampered event detected", not v["ok"] and v["broken_at"] == 2, v)
		frappe.db.set_value(CUSTODY_DT, e2["name"], "lat", 22.572646, update_modified=False)
		check("restored chain verifies again", verify_chain(code)["ok"])

		def _edit():
			d = frappe.get_doc(CUSTODY_DT, e3["name"])
			d.device_id = "edited"
			d.save(ignore_permissions=True)

		check("update of scan event refused", refused(_edit))
		check("delete of scan event refused", refused(lambda: frappe.delete_doc(CUSTODY_DT, e3["name"], ignore_permissions=True, force=1)))

		def _direct_insert():
			frappe.get_doc({"doctype": CUSTODY_DT, "scan_code": code, "event": "Exception", "chain_key": f"{code}#99"}).insert(ignore_permissions=True)

		check("insert outside record_scan_event refused", refused(_direct_insert))

		# API client signatures
		client = create_api_client(f"{SMOKE_TAG} Client {tag}", "Partner Lab", ["barcode:resolve"])
		check("api secret stored encrypted, not plain", frappe.db.get_value(API_CLIENT_DT, client["name"], "api_secret") != client["api_secret"])
		ts = int(time.time())
		body = json.dumps({"universal": ru, "n": tag})
		sig = api_signature(client["api_secret"], ts, body)
		ok_client = verify_api_signature(client["api_key"], sig, ts, body, "barcode:resolve")
		check("valid signature accepted", ok_client["name"] == client["name"])
		check("replayed signature rejected", refused(lambda: verify_api_signature(client["api_key"], sig, ts, body, "barcode:resolve")))
		check("bad signature rejected", refused(lambda: verify_api_signature(client["api_key"], "0" * 64, ts, body + "x")))
		stale_ts = ts - 600
		stale_sig = api_signature(client["api_secret"], stale_ts, body)
		check("stale timestamp rejected", refused(lambda: verify_api_signature(client["api_key"], stale_sig, stale_ts, body)))
		body2 = body + " "
		check(
			"missing scope rejected",
			refused(lambda: verify_api_signature(client["api_key"], api_signature(client["api_secret"], ts, body2), ts, body2, "barcode:bind")),
		)

		# Handoff codes
		code1 = issue_handoff(user, "collect.remediumlabs.in")
		check("handoff code is >= 32 random bytes", len(code1) >= 43)
		check("handoff redeem returns user", consume_handoff(code1, "collect.remediumlabs.in") == user)
		check("handoff code is single-use", consume_handoff(code1) is None)
		code2 = issue_handoff(user, "partners.remediumlabs.in")
		check("handoff refused from another host", consume_handoff(code2, "evil.example.com") is None)
		code3 = issue_handoff(user, "labtech.e-remedium.in")
		frappe.cache().set(_handoff_cache_key(code3), json.dumps({"user": user, "host": "labtech.e-remedium.in", "exp": int(time.time()) - 5}), ex=30)
		check("expired handoff code refused", consume_handoff(code3) is None)
		check("handoff to unknown host refused", refused(lambda: issue_handoff(user, "evil.example.com")))

		# Payment scopes + misc
		options = cstr(frappe.get_meta(INTENT_DT).get_field("scope").options).split("\n") if frappe.db.exists("DocType", INTENT_DT) else []
		check("payment scopes present (old kept)", all(s in options for s in NEW_PAYMENT_SCOPES) and "patient_checkout" in options, options)
		from health_ecosystem_core.health_ecosystem_core import api as api_mod

		check("random password not flagged as default", not api_mod._is_default_password(frappe.generate_hash(length=16)))
		check("published demo passwords flagged as default", all(api_mod._is_default_password(p) for p in _published_default_passwords()))
		check("custody secret configured", bool(frappe.conf.get(CUSTODY_SECRET_KEY)))
		cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
		check("circuit-share backstop in live scheduler hooks (*/10)", CIRCUIT_SHARES_JOB in (cron.get("*/10 * * * *") or []), list(cron))
		job = frappe.db.get_value("Scheduled Job Type", {"method": CIRCUIT_SHARES_JOB}, ["cron_format", "stopped"], as_dict=True)
		check("circuit-share backstop Scheduled Job Type active", bool(job) and job.cron_format == "*/10 * * * *" and not cint(job.stopped), job)
		check("private prescription uploads enabled", cint(frappe.conf.get(PRIVATE_RX_KEY)) == 1, frappe.conf.get(PRIVATE_RX_KEY))
		check("setup reports rotated admins as user ids only", isinstance(setup_rotated, list) and all(isinstance(u, str) for u in setup_rotated))
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
		out["trace"] = frappe.get_traceback()[-1500:]
	finally:
		frappe.db.rollback()
		out["cleanup"] = _cleanup_smoke()
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _cleanup_smoke():
	"""Backstop if anything survived the rollback (e.g. an implicit commit)."""
	patients = frappe.get_all(PATIENT_DT, filters={"patient_name": ("like", "P132 Smoke %")}, pluck="name")
	users = frappe.get_all("User", filters={"name": ("like", "p132smoke-%@example.invalid")}, pluck="name")
	clients = frappe.get_all(API_CLIENT_DT, filters={"client_name": ("like", f"{SMOKE_TAG} Client %")}, pluck="name") if frappe.db.exists("DocType", API_CLIENT_DT) else []
	events = frappe.db.count(CUSTODY_DT, {"device_id": ("like", f"{SMOKE_TAG}-%")}) if frappe.db.exists("DocType", CUSTODY_DT) else 0
	if not patients and not users and not clients and not events:
		return "clean"
	if events:
		frappe.db.delete(CUSTODY_DT, {"device_id": ("like", f"{SMOKE_TAG}-%")})
	for p in patients:
		frappe.db.delete(PAL_DT, {"patient": p})
		frappe.db.delete(MERGE_DT, {"source_patient": p})
		frappe.db.delete("Patient Care Journey", {"patient": p})
		customer = frappe.db.get_value(PATIENT_DT, p, "customer")
		frappe.db.delete(PATIENT_DT, {"name": p})
		if customer and customer.startswith("P132 Smoke"):
			frappe.db.delete("Customer", {"name": customer})
	for u in users:
		frappe.db.delete(PAL_DT, {"user": u})
		frappe.db.delete("Has Role", {"parent": u})
		frappe.db.delete("User", {"name": u})
	for c in clients:
		frappe.db.delete("__Auth", {"doctype": API_CLIENT_DT, "name": c})
		frappe.db.delete(API_CLIENT_DT, {"name": c})
	frappe.db.commit()
	return f"removed {len(patients)} patients, {len(users)} users, {len(clients)} api clients, {events} scan events"
