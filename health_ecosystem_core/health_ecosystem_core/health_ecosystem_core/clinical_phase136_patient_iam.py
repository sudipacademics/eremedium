"""Phase 136 — Patient IAM and cross-vertical EMR vault (Module 4 of ECOSYSTEM_ROADMAP.md), patients only.

- Unique Patient ID: REM-UID-XXXXXXXX (clinical_barcodes / phase 132) is the one permanent patient ID. migrate_uids
  re-issues it once for every patient still on the earlier RUP ID, keeps the RUP value in Health Patient.legacy_upi and
  rewrites every stored copy (any DocType column named universal_patient_id, plus the merge log). Signed e-Rx JSON / PDF
  snapshots keep the ID they were signed with, because their content hash covers it.
- Registration / sign-in: patient mobile OTP; registration creates (or claims an OTP placeholder) Health Patient + UID
  + Patient Account Link Self through the phase 0 dedupe; a different person on an already-registered mobile is refused
  (never merged) and pointed to Family profiles. Staff / partner / provider logins see only their own patient profiles.
- QR health card: the QR holds only <vault host>/card/<UID>?k=<short HMAC>; the public scan confirms a valid Remedium ID
  and shows a masked name. Per-patient card keys rotate without changing the UID. iam_lookup_uid serves authenticated
  Remedium staff, verified Uber Doc providers and HEC API Clients holding iam:lookup; every lookup is logged.
- EMR aggregation / timeline / trends live in clinical_phase136_emr; goals, tips and the medication / routine checklist in
  clinical_phase136_lifestyle; the smoke in clinical_phase136_smoke.

Hook and scheduler code runs in every Frappe container, so module-level imports stay limited to frappe, the api
helpers, clinical_barcodes, phase 132 and clinical_emr.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
from typing import NoReturn

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_barcodes import UID_PREFIX, normalize_uid, validate_uid
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	API_CLIENT_DT,
	LEGACY_UPI_FIELD,
	MERGE_DT,
	PATIENT_DT,
	RELATIONS,
	UPI_FIELD,
	_ensure_doctype,
	_perms,
	_sel,
	assign_upi,
	generate_upi,
	link_patient_account,
	list_profiles,
	patient_for_uid,
	validate_legacy_upi,
	validate_upi,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase136_patient_iam"
EMR_MODULE = "health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr"
LIFE_MODULE = "health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle"
SCHEDULED_JOBS = (
	(f"{EMR_MODULE}.vault_sync_recent", "*/15 * * * *"),
	(f"{LIFE_MODULE}.vault_dose_reminders", "*/15 * * * *"),
	(f"{LIFE_MODULE}.vault_mark_missed_doses", "20 0 * * *"),
	(f"{LIFE_MODULE}.vault_daily_nudges", "30 8 * * *"),
)
# Domain not decided yet: set site_config `vault_base_url` (or this constant) once the host exists.
APP_URL = ""

PROFILE_DT = "Patient Vault Profile"
LOOKUP_DT = "Patient ID Lookup Log"
REISSUE_DT = "Patient UID Reissue Log"
PROVIDER_DT = "Clinical Provider"

CARD_SECRET_KEY = "hec_vault_card_secret"
CARD_K_LEN = 10
LOOKUP_SCOPE = "iam:lookup"
LOOKUP_CHANNELS = ("Staff", "Provider", "API Client", "Public Card")
LOOKUP_RESULTS = ("Found", "Not Found", "Invalid", "Denied", "Valid Card", "Unverified Card")
LOOKUP_STAFF_ROLES = frozenset(
	{
		"System Manager",
		"Health System Admin",
		"Administrator",
		"Lab Manager",
		"Lab Technician",
		"Pathologist",
		"Phlebotomist",
		"Franchisee Operator",
		"Physician",
		"Nurse",
		"Uber Doc Manager",
	}
)
BLOOD_GROUPS = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
GENDERS = ("Male", "Female", "Other")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
PUBLIC_IP_LIMIT = 300
LOOKUP_USER_LIMIT = 300
REG_TICKET_TTL = 600
UID_MIGRATION_BATCH = 100
ICD_ZIP = "/tmp/icd10cm-2027.zip"
OLD_ICD_RE = re.compile(r"^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$")
TIP_DISCLAIMER = "General wellness guidance, not medical advice. Follow your doctor's advice."
SMOKE_TAG = "P136SMK"


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


def _mobile(value, required=True):
	digits = re.sub(r"\D", "", cstr(value))
	if len(digits) > 10:
		digits = digits[-10:]
	if len(digits) == 10 and digits[0] in "6789":
		return digits
	if required:
		_fail(_("Enter a valid 10-digit mobile number"))
	return None


def _request_ip():
	return cstr(getattr(frappe.local, "request_ip", "")) or "local"


def _user_agent():
	try:
		return cstr(frappe.get_request_header("User-Agent"))[:300] or None
	except Exception:
		return None


def _rate_limit(key, limit, seconds):
	if frappe.flags.vault_skip_rate_limit:
		return
	cache = frappe.cache()
	count = cint(cache.get_value(key))
	if count >= limit:
		_fail(_("Too many attempts; try again later"))
	cache.set_value(key, count + 1, expires_in_sec=seconds)


def _as_admin():
	previous = frappe.session.user
	frappe.set_user("Administrator")
	return previous


def vault_base():
	return cstr(frappe.conf.get("vault_base_url") or APP_URL).strip().rstrip("/")


def age_years(dob):
	if not dob:
		return None
	try:
		born, now = getdate(dob), getdate(today())
	except Exception:
		return None
	return now.year - born.year - ((now.month, now.day) < (born.month, born.day))


def mask_name(name):
	parts = [p for p in re.split(r"\s+", cstr(name).strip()) if p]
	return " ".join(f"{p[0].upper()}***" for p in parts[:3]) or None


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	return [
		(
			PROFILE_DT,
			[
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "unique": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": "user", "label": "Created By Login", "fieldtype": "Link", "options": "User", "read_only": 1},
				{"fieldname": "card_section", "label": "Health Card", "fieldtype": "Section Break"},
				{"fieldname": "blood_group", "label": "Blood Group", "fieldtype": "Select", "options": "\n" + _sel(BLOOD_GROUPS)},
				{"fieldname": "emergency_contact_name", "label": "Emergency Contact", "fieldtype": "Data"},
				{"fieldname": "emergency_contact_relation", "label": "Emergency Contact Relation", "fieldtype": "Data"},
				{"fieldname": "emergency_contact_phone", "label": "Emergency Contact Phone", "fieldtype": "Data"},
				{"fieldname": "show_emergency_on_card", "label": "Print Emergency Contact on Card", "fieldtype": "Check", "default": "0"},
				{"fieldname": "card_version", "label": "Card Version", "fieldtype": "Int", "default": "1", "read_only": 1},
				{"fieldname": "card_issued_on", "label": "Card Issued On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "card_salt", "label": "Card Key Salt", "fieldtype": "Data", "read_only": 1, "hidden": 1},
				{"fieldname": "notify_section", "label": "WhatsApp (opt-in)", "fieldtype": "Section Break"},
				{"fieldname": "wa_reminders", "label": "Medicine Reminders on WhatsApp", "fieldtype": "Check", "default": "0"},
				{"fieldname": "wa_tips", "label": "Daily Habit Tip on WhatsApp", "fieldtype": "Check", "default": "0"},
				{"fieldname": "wa_mobile", "label": "WhatsApp Mobile", "fieldtype": "Data"},
				{"fieldname": "wa_opt_in_on", "label": "Opted In On", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "wa_opt_in_by", "label": "Opted In By", "fieldtype": "Link", "options": "User", "read_only": 1},
			],
			_perms(managers, ()),
			{"title_field": "patient_name"},
		),
		(
			LOOKUP_DT,
			[
				{"fieldname": "looked_up_at", "label": "At", "fieldtype": "Datetime", "read_only": 1, "in_list_view": 1},
				{"fieldname": "queried_value", "label": "Queried ID", "fieldtype": "Data", "read_only": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "read_only": 1, "search_index": 1},
				{"fieldname": "resolved_uid", "label": "Resolved ID", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "channel", "label": "Channel", "fieldtype": "Select", "options": _sel(LOOKUP_CHANNELS), "read_only": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "result", "label": "Result", "fieldtype": "Select", "options": _sel(LOOKUP_RESULTS), "read_only": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "actor_user", "label": "Looked Up By", "fieldtype": "Link", "options": "User", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "actor_roles", "label": "Actor Roles", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "api_client", "label": "API Client", "fieldtype": "Link", "options": API_CLIENT_DT, "read_only": 1},
				{"fieldname": "purpose", "label": "Purpose", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "ip", "label": "IP", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "user_agent", "label": "User Agent", "fieldtype": "Small Text", "read_only": 1},
			],
			_perms((), managers),
			{"in_create": 1, "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			REISSUE_DT,
			[
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "read_only": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "old_uid", "label": "Previous ID", "fieldtype": "Data", "read_only": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "new_uid", "label": "Unique Patient ID", "fieldtype": "Data", "read_only": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "batch", "label": "Batch", "fieldtype": "Data", "read_only": 1, "in_standard_filter": 1},
				{"fieldname": "reissued_on", "label": "Re-issued On", "fieldtype": "Datetime", "read_only": 1},
			],
			_perms((), managers),
			{"in_create": 1, "sort_field": "creation", "sort_order": "DESC"},
		),
	]


def ensure_iam_setup():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import ensure_foundations_setup

	created = ensure_foundations_setup()
	for name, fields, perms, extra in _doctype_specs():
		if _ensure_doctype(name, fields, perms, extra=extra):
			created.append(name)
	return created


def ensure_vault_setup():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr import ensure_emr_vault_setup
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import ensure_lifestyle_setup

	return ensure_iam_setup() + ensure_emr_vault_setup() + ensure_lifestyle_setup()


def _ensure_ready():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import REMINDER_DT

	if not frappe.db.exists("DocType", REMINDER_DT) or not frappe.db.exists("DocType", LOOKUP_DT) or not _has_field(PATIENT_DT, LEGACY_UPI_FIELD):
		ensure_vault_setup()
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


def card_secret():
	secret = frappe.conf.get(CARD_SECRET_KEY)
	if secret:
		return cstr(secret)
	from frappe.installer import update_site_config

	on_disk = (frappe.get_site_config() or {}).get(CARD_SECRET_KEY)
	secret = cstr(on_disk) if on_disk else secrets.token_hex(32)
	if not on_disk:
		update_site_config(CARD_SECRET_KEY, secret)
	frappe.local.conf[CARD_SECRET_KEY] = secret
	return secret


def config_status():
	from importlib.util import find_spec

	warnings = []
	if not vault_base():
		warnings.append(_("Vault domain not set (site_config vault_base_url): health-card QR codes point to the public verify API until then."))
	if not find_spec("pyqrcode"):
		warnings.append(_("pyqrcode is not importable: card PDFs / SVGs are issued without the QR (the app still draws it)."))
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	missing = [m.rsplit(".", 1)[-1] for m, expr in SCHEDULED_JOBS if m not in (cron.get(expr) or [])]
	if missing:
		warnings.append(_("Vault jobs not in the live hooks yet (deploy script patches hooks): {0}").format(", ".join(missing)))
	warnings.append(_("Web push reminders are not available (no VAPID keys / web-push sender on the server); WhatsApp opt-in only."))
	return {"app_url": vault_base() or None, "qr": bool(find_spec("pyqrcode")), "warnings": warnings}


def setup_phase136(backfill=1, migrate=1):
	"""Idempotent: DocTypes + fields, card secret, one-time REM-UID re-issue, tip seed, scheduler jobs, FY2027 ICD QA
	codes, EMR / medication backfill."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import backfill_linked_upi, backfill_upi
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr import backfill_emr
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import backfill_lifestyle, seed_tips

	created = ensure_vault_setup()
	frappe.db.commit()
	secret_state = "present" if frappe.conf.get(CARD_SECRET_KEY) else "created"
	card_secret()
	out = {"ok": True, "created": created, "card_secret": secret_state}
	out["upi_backfilled"] = backfill_upi()
	out["uid_migration"] = migrate_uids() if cint(migrate) else "skipped"
	out["linked_upi_filled"] = backfill_linked_upi()
	frappe.db.commit()
	out["tips"] = seed_tips()
	frappe.db.commit()
	out["scheduler_jobs"] = ensure_scheduler_jobs()
	out["icd_fy2027_qa"] = load_icd_qa_codes()
	frappe.db.commit()
	if cint(backfill):
		out["emr_backfill"] = backfill_emr()
		out["lifestyle_backfill"] = backfill_lifestyle()
	out["patients_total"] = frappe.db.count(PATIENT_DT)
	out["patients_without_uid"] = frappe.db.count(PATIENT_DT, {UPI_FIELD: ("is", "not set")})
	out["patients_not_rem_uid"] = cint(
		frappe.db.sql(f"select count(*) from `tab{PATIENT_DT}` where ifnull(`{UPI_FIELD}`, '') not like %s", (f"{UID_PREFIX}%",))[0][0]
	)
	out["config"] = config_status()
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# One-time REM-UID re-issue
# ---------------------------------------------------------------------------


def uid_copy_columns():
	"""Every stored copy of the patient ID: columns named universal_patient_id on any table, plus the merge log."""
	rows = list(frappe.db.sql("select parent, fieldname from `tabDocField` where fieldname = %s", (UPI_FIELD,), as_dict=True))
	rows += frappe.db.sql("select dt as parent, fieldname from `tabCustom Field` where fieldname = %s", (UPI_FIELD,), as_dict=True)
	rows += [frappe._dict(parent=MERGE_DT, fieldname=f) for f in ("source_upi", "target_upi")]
	out, seen = [], set()
	for r in rows:
		key = (r.parent, r.fieldname)
		if r.parent == PATIENT_DT or key in seen:
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
	return sorted(out)


def reissue_uid(patient, batch=None):
	"""Give one patient a REM-UID, moving a previous ID into legacy_upi. No-op when the patient already has one."""
	rows = frappe.db.sql(
		f"select name, `{UPI_FIELD}` as uid, `{LEGACY_UPI_FIELD}` as legacy from `tab{PATIENT_DT}` where name = %s for update", (patient,), as_dict=True
	)
	if not rows:
		return None
	row = rows[0]
	current = cstr(row.uid).strip().upper()
	if validate_upi(current):
		return None
	new = generate_upi()
	values = {UPI_FIELD: new}
	if current and not cstr(row.legacy).strip():
		values[LEGACY_UPI_FIELD] = current
	frappe.db.set_value(PATIENT_DT, patient, values, update_modified=False)
	frappe.get_doc(
		{"doctype": REISSUE_DT, "patient": patient, "old_uid": current or None, "new_uid": new, "batch": batch, "reissued_on": now_datetime()}
	).insert(ignore_permissions=True)
	return {"patient": patient, "old": current or None, "new": new}


def rewrite_uid_copies():
	"""Point copies that still hold a legacy ID at the patient's REM-UID (join on legacy_upi). Safe to re-run."""
	out = {}
	for dt, field in uid_copy_columns():
		join = (
			f"from `tab{dt}` t join `tab{PATIENT_DT}` p on p.`{LEGACY_UPI_FIELD}` = t.`{field}` "
			f"where ifnull(t.`{field}`, '') != '' and t.`{field}` not like %s and p.`{UPI_FIELD}` like %s"
		)
		args = (f"{UID_PREFIX}%", f"{UID_PREFIX}%")
		count = cint(frappe.db.sql(f"select count(*) {join}", args)[0][0])
		if count:
			frappe.db.sql(
				f"update `tab{dt}` t join `tab{PATIENT_DT}` p on p.`{LEGACY_UPI_FIELD}` = t.`{field}` set t.`{field}` = p.`{UPI_FIELD}` "
				f"where ifnull(t.`{field}`, '') != '' and t.`{field}` not like %s and p.`{UPI_FIELD}` like %s",
				args,
			)
			frappe.db.commit()
		left = cint(frappe.db.sql(f"select count(*) from `tab{dt}` where `{field}` like %s", ("RUP%",))[0][0])
		out[f"{dt}.{field}"] = {"rewritten": count, "legacy_left": left}
	return out


def migrate_uids(batch=UID_MIGRATION_BATCH, limit=None):
	"""Batched, committed per batch, logged in Patient UID Reissue Log; re-running only touches what is left."""
	if not _has_field(PATIENT_DT, LEGACY_UPI_FIELD) or not frappe.db.exists("DocType", REISSUE_DT):
		ensure_iam_setup()
		frappe.db.commit()
	tag = f"UID-{now_datetime().strftime('%Y%m%d-%H%M%S')}"
	report = {"batch_tag": tag, "reissued": 0, "assigned": 0, "errors": 0, "batches": 0}
	tried = set()
	size = max(cint(batch) or UID_MIGRATION_BATCH, 1)
	while True:
		names = [
			n
			for n in frappe.db.sql_list(
				f"select name from `tab{PATIENT_DT}` where ifnull(`{UPI_FIELD}`, '') not like %s order by creation asc limit %s",
				(f"{UID_PREFIX}%", size + len(tried)),
			)
			if n not in tried
		][:size]
		if not names:
			break
		for name in names:
			tried.add(name)
			frappe.db.savepoint("vault_uid_row")
			try:
				res = reissue_uid(name, tag)
				if res and res["old"]:
					report["reissued"] += 1
				elif res:
					report["assigned"] += 1
			except Exception:
				report["errors"] += 1
				frappe.db.rollback(save_point="vault_uid_row")
				frappe.log_error(title="phase136 UID re-issue", message=f"{name}\n{frappe.get_traceback()}")
		frappe.db.commit()
		report["batches"] += 1
		if limit and len(tried) >= cint(limit):
			break
	report["copies"] = rewrite_uid_copies()
	frappe.db.commit()
	frappe.logger("hec_vault").info(f"phase136 UID migration {json.dumps(report, default=str)[:2000]}")
	return report


# ---------------------------------------------------------------------------
# ICD-10-CM FY2027 codes the earlier ICD format check skipped
# ---------------------------------------------------------------------------


def _fit(desc, limit=140):
	desc = " ".join(cstr(desc).split())
	if len(desc) <= limit:
		return desc
	return desc[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:- ") + "\u2026"


def load_icd_qa_codes(path=ICD_ZIP):
	"""Codes with a letter in the second place (e.g. QA1.71) from the CDC order file, if load-icd10cm.sh left it in /tmp."""
	if not os.path.exists(path):
		return {"skipped": f"{path} not present; re-run docker/scripts/load-icd10cm.sh (it now loads the QA codes too)"}
	import zipfile

	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx import normalize_icd, valid_icd
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc import ICD_DT

	if not frappe.db.exists("DocType", ICD_DT):
		return {"skipped": "Uber Doc ICD Code not installed (run setup_phase135)"}
	try:
		zf = zipfile.ZipFile(path)
		order = next((n for n in zf.namelist() if re.search(r"order.*2027\.txt$", n, re.I) and "addenda" not in n.lower()), None)
		if not order:
			return {"skipped": "order file not found in the zip"}
		text = zf.read(order).decode("utf-8", errors="replace")
	except Exception:
		frappe.log_error(title="phase136 ICD QA load", message=frappe.get_traceback())
		return {"skipped": "zip unreadable"}
	found = inserted = 0
	for line in text.splitlines():
		if len(line) < 16:
			continue
		code = normalize_icd(line[6:13].strip())
		if not code or not valid_icd(code) or OLD_ICD_RE.match(code):
			continue
		found += 1
		if frappe.db.exists(ICD_DT, code):
			continue
		desc = _fit(line[77:].strip() or line[16:76].strip())
		frappe.get_doc({"doctype": ICD_DT, "code": code, "description": desc or None, "active": 1, "usage_count": 0, "source": "Operations"}).insert(ignore_permissions=True)
		inserted += 1
	return {"file": order, "found": found, "inserted": inserted}


# ---------------------------------------------------------------------------
# Vault profile, card keys, health card
# ---------------------------------------------------------------------------


def ensure_vault_profile(patient, user=None):
	name = frappe.db.get_value(PROFILE_DT, {"patient": patient}, "name")
	if name:
		return name
	doc = frappe.get_doc(
		{
			"doctype": PROFILE_DT,
			"patient": patient,
			"patient_name": frappe.db.get_value(PATIENT_DT, patient, "patient_name"),
			"user": user if user and user != "Guest" else None,
			"card_salt": secrets.token_hex(8),
			"card_version": 1,
			"card_issued_on": now_datetime(),
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(PROFILE_DT, {"patient": patient}, "name")
	return doc.name


def _profile_row(patient):
	name = ensure_vault_profile(patient)
	return frappe.db.get_value(
		PROFILE_DT,
		name,
		["name", "blood_group", "emergency_contact_name", "emergency_contact_relation", "emergency_contact_phone", "show_emergency_on_card", "card_version", "card_issued_on", "card_salt", "wa_reminders", "wa_tips", "wa_mobile", "wa_opt_in_on"],
		as_dict=True,
	)


def card_key(uid, salt, version):
	digest = hmac.new(card_secret().encode(), f"{uid}:{salt}:{cint(version)}".encode(), hashlib.sha256).digest()
	return base64.b32encode(digest).decode().rstrip("=").lower()[:CARD_K_LEN]


def card_url(uid, k):
	base = vault_base()
	if base:
		return f"{base}/card/{uid}?k={k}"
	return f"{frappe.utils.get_url()}/api/method/{MODULE_PATH}.vault_public_card?uid={uid}&k={k}"


def verify_card(uid, k):
	"""'valid' | 'unverified' (unknown ID, rotated or forged key: no existence oracle) | 'invalid' (format / check)."""
	uid = normalize_uid(uid)
	if not validate_uid(uid):
		return "invalid", uid, None
	patient = frappe.db.get_value(PATIENT_DT, {UPI_FIELD: uid}, "name")
	if not patient:
		return "unverified", uid, None
	prof = frappe.db.get_value(PROFILE_DT, {"patient": patient}, ["card_salt", "card_version"], as_dict=True)
	k = re.sub(r"[^a-z2-7]", "", cstr(k).strip().lower())
	if not prof or not prof.card_salt or len(k) != CARD_K_LEN:
		return "unverified", uid, patient
	if not hmac.compare_digest(k, card_key(uid, prof.card_salt, prof.card_version)):
		return "unverified", uid, patient
	return "valid", uid, patient


def _patient_row(patient):
	meta = frappe.get_meta(PATIENT_DT)
	fields = ["name", "patient_name", "gender", "mobile", "email", "status"] + [f for f in ("dob", UPI_FIELD, LEGACY_UPI_FIELD, "merged_into") if meta.has_field(f)]
	return frappe.db.get_value(PATIENT_DT, patient, fields, as_dict=True)


def card_payload(patient):
	uid = assign_upi(patient)
	row = _patient_row(patient)
	prof = _profile_row(patient)
	k = card_key(uid, prof.card_salt, prof.card_version)
	emergency = None
	if cint(prof.show_emergency_on_card) and prof.emergency_contact_phone:
		emergency = {"name": prof.emergency_contact_name, "relation": prof.emergency_contact_relation, "phone": prof.emergency_contact_phone}
	return {
		"patient": patient,
		"patient_name": row.patient_name,
		"universal_patient_id": uid,
		"legacy_upi": row.get(LEGACY_UPI_FIELD) or None,
		"gender": row.gender,
		"age_years": age_years(row.get("dob")),
		"blood_group": prof.blood_group or None,
		"emergency": emergency,
		"qr_url": card_url(uid, k),
		"card_version": cint(prof.card_version) or 1,
		"card_issued_on": cstr(prof.card_issued_on) or None,
	}


def rotate_card(patient):
	name = ensure_vault_profile(patient)
	version = cint(frappe.db.get_value(PROFILE_DT, name, "card_version")) + 1
	frappe.db.set_value(PROFILE_DT, name, {"card_salt": secrets.token_hex(8), "card_version": version, "card_issued_on": now_datetime()})
	return card_payload(patient)


def qr_matrix(text):
	try:
		import pyqrcode
	except Exception:
		return None
	try:
		return [[1 if cint(v) else 0 for v in row] for row in pyqrcode.create(text, error="M").code]
	except Exception:
		frappe.log_error(title="phase136 QR", message=frappe.get_traceback())
		return None


def _qr_svg(matrix, x, y, size):
	quiet = 2
	n = len(matrix) + 2 * quiet
	m = size / n
	rects = []
	for r, row in enumerate(matrix):
		start = None
		for c, v in enumerate(list(row) + [0]):
			if v and start is None:
				start = c
			elif not v and start is not None:
				rects.append(f'<rect x="{x + (start + quiet) * m:.2f}" y="{y + (r + quiet) * m:.2f}" width="{(c - start) * m + 0.05:.2f}" height="{m + 0.05:.2f}"/>')
				start = None
	return f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="10" fill="#fff"/><g fill="#0b1f2a" shape-rendering="crispEdges">{"".join(rects)}</g>'


def card_svg(card):
	"""Credit-card proportions (85.6 x 54 mm at 10 px / mm). No phone or address unless the patient opted to print an
	emergency contact."""
	e = html.escape
	lines = []
	meta = " · ".join(x for x in (f"{card['age_years']} y" if card.get("age_years") is not None else "", card.get("gender") or "") if x)
	if meta:
		lines.append(f'<text x="44" y="292" font-size="26" fill="#334155">{e(meta)}</text>')
	if card.get("blood_group"):
		lines.append(f'<text x="44" y="330" font-size="26" fill="#334155">Blood group <tspan font-weight="700" fill="#b42318">{e(card["blood_group"])}</tspan></text>')
	if card.get("emergency"):
		em = card["emergency"]
		label = " ".join(x for x in (em.get("name") or "", f"({em['relation']})" if em.get("relation") else "") if x)
		lines.append(f'<text x="44" y="380" font-size="20" fill="#475569">In emergency: {e(label)} {e(em.get("phone") or "")}</text>')
	matrix = qr_matrix(card["qr_url"])
	qr = _qr_svg(matrix, 596, 150, 220) if matrix else '<rect x="596" y="150" width="220" height="220" rx="10" fill="#fff"/><text x="706" y="266" font-size="16" text-anchor="middle" fill="#64748b">QR in the app</text>'
	name = cstr(card.get("patient_name"))[:34]
	return (
		'<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540" font-family="Helvetica, Arial, sans-serif">'
		'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecfdf5"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs>'
		'<rect width="856" height="540" rx="34" fill="url(#g)" stroke="#0f766e" stroke-width="3"/>'
		'<rect width="856" height="96" rx="34" fill="#0f766e"/><rect y="62" width="856" height="34" fill="#0f766e"/>'
		'<text x="44" y="60" font-size="30" font-weight="700" fill="#fff" letter-spacing="2">REMEDIUM</text>'
		'<text x="812" y="60" font-size="22" fill="#ccfbf1" text-anchor="end">Health ID card</text>'
		f'<text x="44" y="168" font-size="40" font-weight="700" fill="#0b1f2a">{e(name)}</text>'
		'<text x="44" y="214" font-size="18" fill="#64748b" letter-spacing="1.5">UNIQUE PATIENT ID</text>'
		f'<text x="44" y="252" font-size="34" font-weight="700" fill="#0f766e" font-family="Courier New, monospace" letter-spacing="1">{e(card["universal_patient_id"])}</text>'
		f'{"".join(lines)}{qr}'
		'<text x="706" y="400" font-size="16" fill="#475569" text-anchor="middle">Scan to verify this ID</text>'
		'<text x="44" y="500" font-size="17" fill="#64748b">The QR carries only this ID and a check key, never health data.</text>'
		f'<text x="812" y="500" font-size="15" fill="#94a3b8" text-anchor="end">v{cint(card.get("card_version"))}</text>'
		"</svg>"
	)


def card_pdf(card):
	from frappe.utils.pdf import get_pdf

	svg = base64.b64encode(card_svg(card).encode()).decode()
	e = html.escape
	body = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:Helvetica,Arial,sans-serif;color:#1d2733;margin:0;font-size:11px;}}
.cut{{border:0.3mm dashed #94a3b8;display:inline-block;padding:2mm;}}
.card{{width:85.6mm;height:54mm;display:block;}}
.back{{width:85.6mm;height:54mm;box-sizing:border-box;padding:4mm;border:0.4mm solid #0f766e;border-radius:3mm;font-size:8.5pt;}}
h1{{font-size:14pt;color:#0f766e;margin:0 0 4mm;}} td{{vertical-align:top;padding-right:6mm;}}
</style></head><body><h1>Remedium health ID card</h1><table><tr>
<td><div class="cut"><img class="card" src="data:image/svg+xml;base64,{svg}"/></div></td>
<td><div class="cut"><div class="back"><b>Unique Patient ID</b><br>{e(card["universal_patient_id"])}<br><br>
Show this card at any Remedium lab, collection centre, clinic or partner service so your records stay together.<br><br>
Scanning the QR only confirms that the ID is valid and shows a masked name. Your reports stay in your vault and are shared
only with services you use.<br><br>Lost card? Re-issue it from the app: the old QR stops verifying, your ID stays the same.</div></div></td>
</tr></table><p style="color:#64748b">Print at 100% scale and cut along the dashed lines.</p></body></html>"""
	return get_pdf(body, {"page-size": "A4", "margin-top": "12mm", "margin-bottom": "12mm", "margin-left": "12mm", "margin-right": "12mm"})


def _log_lookup(queried, channel, result, patient=None, resolved=None, actor_user=None, actor_roles=None, api_client=None, purpose=None):
	try:
		frappe.get_doc(
			{
				"doctype": LOOKUP_DT,
				"looked_up_at": now_datetime(),
				"queried_value": cstr(queried).strip()[:64] or None,
				"patient": patient or None,
				"resolved_uid": resolved or None,
				"channel": channel,
				"result": result,
				"actor_user": actor_user if actor_user and actor_user != "Guest" else None,
				"actor_roles": ", ".join(sorted(actor_roles or []))[:500] or None,
				"api_client": api_client or None,
				"purpose": cstr(purpose).strip()[:140] or None,
				"ip": _request_ip()[:64],
				"user_agent": _user_agent(),
			}
		).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="phase136 lookup log", message=frappe.get_traceback())


def public_card(uid, k):
	_rate_limit(f"vault_card_ip:{_request_ip()}", PUBLIC_IP_LIMIT, 3600)
	status, norm, patient = verify_card(uid, k)
	_log_lookup(uid, "Public Card", "Valid Card" if status == "valid" else ("Invalid" if status == "invalid" else "Unverified Card"), patient if status == "valid" else None, norm if status == "valid" else None)
	out = {"status": status, "valid": status == "valid", "universal_patient_id": norm if status != "invalid" else None, "issuer": "Remedium"}
	if status == "valid":
		out["masked_name"] = mask_name(frappe.db.get_value(PATIENT_DT, patient, "patient_name"))
		out["message"] = _("This is a valid Remedium Unique Patient ID.")
	elif status == "unverified":
		out["message"] = _("This card could not be verified. It may have been re-issued; ask the holder for their current card.")
	else:
		out["message"] = _("This is not a valid Remedium Unique Patient ID.")
	return out


# ---------------------------------------------------------------------------
# Cross-vertical lookup (staff, verified providers, HEC API Clients with iam:lookup)
# ---------------------------------------------------------------------------


def lookup_channel(user, roles):
	if roles & LOOKUP_STAFF_ROLES:
		return "Staff"
	if frappe.db.exists("DocType", PROVIDER_DT) and frappe.db.exists(PROVIDER_DT, {"user": user, "verification_status": "Verified"}):
		return "Provider"
	return None


def lookup_uid(value, channel, actor_user=None, actor_roles=None, api_client=None, purpose=None):
	"""Minimal identity for a REM-UID or legacy RUP ID: name, gender, age, last 4 of the mobile. Always logged."""
	raw = cstr(value).strip()
	uid = normalize_uid(raw)
	legacy = validate_legacy_upi(raw)
	if not validate_uid(uid) and not legacy:
		_log_lookup(raw, channel, "Invalid", actor_user=actor_user, actor_roles=actor_roles, api_client=api_client, purpose=purpose)
		return {"found": False, "valid_format": False}
	patient = patient_for_uid(raw)
	if patient:
		merged_into = frappe.db.get_value(PATIENT_DT, patient, "merged_into") if _has_field(PATIENT_DT, "merged_into") else None
		if merged_into and frappe.db.exists(PATIENT_DT, merged_into):
			patient = merged_into
	if not patient:
		_log_lookup(raw, channel, "Not Found", actor_user=actor_user, actor_roles=actor_roles, api_client=api_client, purpose=purpose)
		return {"found": False, "valid_format": True}
	row = _patient_row(patient)
	resolved = row.get(UPI_FIELD) or assign_upi(patient)
	_log_lookup(raw, channel, "Found", patient, resolved, actor_user, actor_roles, api_client, purpose)
	mobile = re.sub(r"\D", "", cstr(row.mobile))
	return {
		"found": True,
		"valid_format": True,
		"patient": patient,
		"universal_patient_id": resolved,
		"matched_legacy_id": bool(legacy),
		"patient_name": row.patient_name,
		"gender": row.gender,
		"age_years": age_years(row.get("dob")),
		"mobile_last4": mobile[-4:] if len(mobile) >= 4 else None,
	}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def iam_lookup_uid(uid=None, purpose=None, sid=None):
	"""Signed HEC API Client (X-Api-Key / X-Api-Timestamp / X-Api-Signature, scope iam:lookup) or a staff / verified
	provider session. Not used by the patient vault UI."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import authenticate_api_client

	uid = uid or frappe.form_dict.get("uid")
	try:
		_ensure_ready()
		if frappe.get_request_header("X-Api-Key"):
			frappe.flags.ignore_csrf = True
			try:
				client = authenticate_api_client(LOOKUP_SCOPE)
			except (frappe.AuthenticationError, frappe.PermissionError) as exc:
				frappe.db.rollback()
				_log_lookup(uid, "API Client", "Denied", purpose=purpose)
				frappe.db.commit()
				code = 401 if isinstance(exc, frappe.AuthenticationError) else 403
				return _error(cstr(exc) or _("Not permitted"), code)
			data = lookup_uid(uid, "API Client", api_client=client["name"], purpose=purpose)
			frappe.db.commit()
			return _success(data)
		if not _require_mobile_auth(sid):
			return _error(_("Not authenticated"), 401)
		user = frappe.session.user
		roles = set(frappe.get_roles(user))
		channel = lookup_channel(user, roles)
		if not channel:
			_log_lookup(uid, "Staff", "Denied", actor_user=user, actor_roles=roles, purpose=purpose)
			frappe.db.commit()
			return _error(_("Patient ID lookup is limited to Remedium staff, verified providers and authorised partner systems"), 403)
		_rate_limit(f"vault_lookup_user:{user}", LOOKUP_USER_LIMIT, 3600)
		data = lookup_uid(uid, channel, actor_user=user, actor_roles=roles, purpose=purpose)
		frappe.db.commit()
		return _success(data)
	except frappe.AuthenticationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not authenticated"), 401)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


# ---------------------------------------------------------------------------
# Registration and sign-in (patient OTP)
# ---------------------------------------------------------------------------


def _verify_otp(mobile, otp):
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import verify_otp_code

	ok, err = verify_otp_code(mobile, otp)
	if not ok:
		raise OtpError(err or _("OTP verification failed"))


def _ticket_key(ticket):
	return f"vault_reg_ticket:{hashlib.sha256(cstr(ticket).encode()).hexdigest()}"


def issue_registration_ticket(mobile):
	ticket = secrets.token_urlsafe(24)
	frappe.cache().set_value(_ticket_key(ticket), mobile, expires_in_sec=REG_TICKET_TTL)
	return ticket


def _consume_ticket(mobile, ticket):
	key = _ticket_key(ticket)
	held = cstr(frappe.cache().get_value(key))
	if not held or held != mobile:
		raise OtpError(_("This verification has expired. Request a new OTP."))
	frappe.cache().delete_value(key)


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


def _clean_name(value):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import _is_placeholder_name

	name = re.sub(r"\s+", " ", cstr(value)).strip()
	if len(name) < 2 or len(name) > 140 or _is_placeholder_name(name):
		_fail(_("Enter your full name"))
	return name


def _clean_dob(p):
	dob = cstr(p.get("dob")).strip()
	if dob:
		try:
			dob = getdate(dob)
		except Exception:
			_fail(_("Invalid date of birth"))
		if dob > getdate(today()) or dob.year < 1900:
			_fail(_("Enter a valid date of birth"))
		return dob
	age = cint(p.get("age"))
	if p.get("age") in (None, "") or age < 0 or age > 120:
		_fail(_("Enter your date of birth or age"))
	return getdate(add_to_date(today(), years=-age))


def _clean_gender(value, required=True):
	gender = cstr(value).strip().title()
	if gender in GENDERS:
		return gender
	if required:
		_fail(_("Choose a gender"))
	return None


def _clean_email(value):
	email = cstr(value).strip().lower()
	if email and not EMAIL_RE.match(email):
		_fail(_("Enter a valid email"))
	return email or None


def _fill_missing(patient, dob=None, gender=None, email=None):
	row = frappe.db.get_value(PATIENT_DT, patient, ["dob", "gender", "email"], as_dict=True) or {}
	updates = {}
	if dob and not row.get("dob"):
		updates["dob"] = dob
	if gender and not row.get("gender"):
		updates["gender"] = gender
	if email and not row.get("email"):
		updates["email"] = email
	if updates:
		frappe.db.set_value(PATIENT_DT, patient, updates, update_modified=False)


def register(mobile, otp=None, payload=None, ticket=None, login=True):
	"""New vault account: OTP (or a ticket from vault_otp_login) + name, DOB / age, gender, optional email, consent."""
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import ensure_patient_user_for_mobile
	from health_ecosystem_core.health_ecosystem_core import patient_bridge as pb

	mobile = _mobile(mobile)
	_rate_limit(f"vault_register_ip:{_request_ip()}", 30, 3600)
	_rate_limit(f"vault_register:{mobile}", 10, 3600)
	p = payload or {}
	name = _clean_name(p.get("patient_name"))
	dob = _clean_dob(p)
	gender = _clean_gender(p.get("gender"))
	email = _clean_email(p.get("email"))
	if not cint(p.get("consent")):
		_fail(_("Please accept the privacy terms to create your health vault"))
	if ticket:
		_consume_ticket(mobile, ticket)
	else:
		_verify_otp(mobile, otp)

	previous = _as_admin()
	try:
		res = pb.resolve_patient(phone=mobile, patient_name=name, dob=dob)
		existing = res["match"]
		if existing:
			current = frappe.db.get_value(PATIENT_DT, existing, "patient_name")
			if not pb.names_match(current, name) and not pb._is_placeholder_name(current):
				res = {"match": None, "conflict": existing}
				existing = None
		conflict = res["conflict"]
		claimed = False
		if not existing and conflict:
			holder = frappe.db.get_value(PATIENT_DT, conflict, "patient_name")
			if not pb._is_placeholder_name(holder):
				_deny(
					_("This mobile number already holds the health account of {0}. Sign in with it and add yourself under Family profiles.").format(
						mask_name(holder)
					)
				)
			existing, claimed = conflict, True
		if claimed:
			pid = existing
			claim = {"patient_name": name, "gender": gender, "dob": dob}
			if email and not frappe.db.get_value(PATIENT_DT, pid, "email"):
				claim["email"] = email
			frappe.db.set_value(PATIENT_DT, pid, claim, update_modified=False)
		elif existing:
			pid = existing
			_fill_missing(pid, dob, gender, email)
		else:
			pid = pb.ensure_patient(patient_name=name, phone=mobile, gender=gender, email=email, dob=dob)
			if not pid:
				_fail(_("Could not create your health record"))
		user = ensure_patient_user_for_mobile(mobile)
		frappe.set_user("Administrator")
		pb._link_user_to_patient(user, pid)
		link_patient_account(user, pid, "Self", is_primary=1, consent=True)
		uid = assign_upi(pid)
		ensure_vault_profile(pid, user)
	finally:
		frappe.set_user(previous)
	out = {"patient": pid, "universal_patient_id": uid, "existing": bool(existing and not claimed), "claimed_placeholder": claimed, "user": user}
	if login:
		out["session"] = _login_session(user, mobile)
	return out


def otp_login(mobile, otp, login=True):
	"""Existing patient (any record on this mobile): session. Unknown mobile: a 10-minute registration ticket, so the
	patient does not need a second OTP to register."""
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import ensure_patient_user_for_mobile
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import find_patient

	mobile = _mobile(mobile)
	_rate_limit(f"vault_otp_login:{mobile}", 20, 3600)
	_verify_otp(mobile, otp)
	if not find_patient(phone=mobile):
		return {"registered": False, "ticket": issue_registration_ticket(mobile), "mobile": mobile}
	user = ensure_patient_user_for_mobile(mobile)
	return {"registered": True, "user": user, "session": _login_session(user, mobile) if login else None}


# ---------------------------------------------------------------------------
# Signed-in vault (own and linked family profiles only)
# ---------------------------------------------------------------------------


def make_ctx(user):
	return frappe._dict(user=user, patients=None)


def patients_of(ctx):
	if ctx.patients is None:
		ctx.patients = [p["patient"] for p in list_profiles(ctx.user)]
	return ctx.patients


def patient_in_scope(ctx, patient=None):
	"""The requested profile when this login manages it, else the account's own (first) profile."""
	patients = patients_of(ctx)
	patient = cstr(patient).strip()
	if patient:
		if patient not in patients:
			_deny(_("This health profile is not linked to your account"))
		return patient
	if not patients:
		_missing(_("Create your health profile first"))
	return patients[0]


def _profile_out(p):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import _is_placeholder_name

	return {
		**p,
		"age_years": age_years(p.get("dob")),
		"needs_profile": _is_placeholder_name(p.get("patient_name")) or not p.get("dob"),
	}


def me(ctx):
	profiles = [_profile_out(p) for p in list_profiles(ctx.user)]
	ctx.patients = [p["patient"] for p in profiles]
	return {
		"user": ctx.user,
		"full_name": frappe.db.get_value("User", ctx.user, "full_name"),
		"profiles": profiles,
		"primary": profiles[0]["patient"] if profiles else None,
		"needs_self_profile": not profiles,
		"app_url": vault_base() or None,
	}


def create_self(ctx, payload):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import _link_user_to_patient, ensure_patient

	if patients_of(ctx):
		_fail(_("Your health profile already exists"))
	p = payload or {}
	name = _clean_name(p.get("patient_name"))
	dob = _clean_dob(p)
	gender = _clean_gender(p.get("gender"))
	email = _clean_email(p.get("email"))
	if not cint(p.get("consent")):
		_fail(_("Please accept the privacy terms to create your health vault"))
	mobile = _mobile(frappe.db.get_value("User", ctx.user, "mobile_no"), required=False)
	previous = _as_admin()
	try:
		pid = ensure_patient(patient_name=name, phone=mobile, gender=gender, email=email, user=ctx.user, dob=dob)
		if not pid:
			_fail(_("Could not create your health record"))
		_link_user_to_patient(ctx.user, pid)
		link_patient_account(ctx.user, pid, "Self", is_primary=1, consent=True)
		assign_upi(pid)
		ensure_vault_profile(pid, ctx.user)
	finally:
		frappe.set_user(previous)
	ctx.patients = None
	return me(ctx)


def save_profile(ctx, patient, payload):
	"""Demographics the account holder may complete, plus card / emergency details. A registered name is never
	overwritten here (identity changes go through support)."""
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import _is_placeholder_name

	patient = patient_in_scope(ctx, patient)
	p = payload or {}
	row = _patient_row(patient)
	updates = {}
	if p.get("patient_name") not in (None, ""):
		name = _clean_name(p.get("patient_name"))
		if name != row.patient_name:
			if not _is_placeholder_name(row.patient_name):
				_fail(_("A registered name cannot be changed here; contact support"))
			updates["patient_name"] = name
	if p.get("dob") not in (None, ""):
		updates["dob"] = _clean_dob({"dob": p.get("dob")})
	if p.get("gender") not in (None, ""):
		updates["gender"] = _clean_gender(p.get("gender"))
	if "email" in p:
		updates["email"] = _clean_email(p.get("email"))
	if updates:
		frappe.db.set_value(PATIENT_DT, patient, updates)
	prof_name = ensure_vault_profile(patient, ctx.user)
	prof = {}
	if "blood_group" in p:
		bg = cstr(p.get("blood_group")).strip().upper()
		if bg and bg not in BLOOD_GROUPS:
			_fail(_("Choose a blood group"))
		prof["blood_group"] = bg or None
	for key, limit in (("emergency_contact_name", 140), ("emergency_contact_relation", 40)):
		if key in p:
			prof[key] = cstr(p.get(key)).strip()[:limit] or None
	if "emergency_contact_phone" in p:
		prof["emergency_contact_phone"] = _mobile(p.get("emergency_contact_phone"), required=False) if cstr(p.get("emergency_contact_phone")).strip() else None
		if cstr(p.get("emergency_contact_phone")).strip() and not prof["emergency_contact_phone"]:
			_fail(_("Enter a valid 10-digit emergency contact number"))
	if "show_emergency_on_card" in p:
		prof["show_emergency_on_card"] = 1 if cint(p.get("show_emergency_on_card")) else 0
	if prof:
		frappe.db.set_value(PROFILE_DT, prof_name, prof)
	if updates.get("patient_name"):
		frappe.db.set_value(PROFILE_DT, prof_name, "patient_name", updates["patient_name"], update_modified=False)
	return profile_detail(ctx, patient)


def profile_detail(ctx, patient):
	patient = patient_in_scope(ctx, patient)
	row = _patient_row(patient)
	prof = _profile_row(patient)
	relation = next((p for p in list_profiles(ctx.user) if p["patient"] == patient), {}).get("relation")
	return {
		"patient": patient,
		"patient_name": row.patient_name,
		"relation": relation,
		"gender": row.gender,
		"dob": cstr(row.get("dob") or "") or None,
		"age_years": age_years(row.get("dob")),
		"email": row.email,
		"mobile": row.mobile,
		"universal_patient_id": row.get(UPI_FIELD) or assign_upi(patient),
		"legacy_upi": row.get(LEGACY_UPI_FIELD) or None,
		"blood_group": prof.blood_group or None,
		"emergency_contact_name": prof.emergency_contact_name,
		"emergency_contact_relation": prof.emergency_contact_relation,
		"emergency_contact_phone": prof.emergency_contact_phone,
		"show_emergency_on_card": cint(prof.show_emergency_on_card),
		"wa_reminders": cint(prof.wa_reminders),
		"wa_tips": cint(prof.wa_tips),
		"wa_mobile": prof.wa_mobile or row.mobile,
		"wa_opt_in_on": cstr(prof.wa_opt_in_on) or None,
		"card_version": cint(prof.card_version) or 1,
	}


def add_family(ctx, payload):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import add_dependant

	row = add_dependant(ctx.user, payload or {})
	ensure_vault_profile(row["patient"], ctx.user)
	ctx.patients = None
	return _profile_out(row)


def save_settings(ctx, patient, payload):
	"""WhatsApp opt-ins are explicit, timestamped and per profile; turning both off clears the opt-in record."""
	patient = patient_in_scope(ctx, patient)
	p = payload or {}
	name = ensure_vault_profile(patient, ctx.user)
	prof = frappe.db.get_value(PROFILE_DT, name, ["wa_reminders", "wa_tips", "wa_opt_in_on"], as_dict=True)
	values = {}
	for key in ("wa_reminders", "wa_tips"):
		if key in p:
			values[key] = 1 if cint(p.get(key)) else 0
	if "wa_mobile" in p:
		raw = cstr(p.get("wa_mobile")).strip()
		values["wa_mobile"] = _mobile(raw) if raw else None
	on = values.get("wa_reminders", cint(prof.wa_reminders)) or values.get("wa_tips", cint(prof.wa_tips))
	if on and not (cint(prof.wa_reminders) or cint(prof.wa_tips)):
		values.update({"wa_opt_in_on": now_datetime(), "wa_opt_in_by": ctx.user})
	elif not on:
		values.update({"wa_opt_in_on": None, "wa_opt_in_by": None})
	if values:
		frappe.db.set_value(PROFILE_DT, name, values)
	return profile_detail(ctx, patient)


def lookup_history(ctx, patient, limit=50):
	"""Who looked up this patient's ID: channel, organisation type and time (staff identities stay internal)."""
	patient = patient_in_scope(ctx, patient)
	rows = frappe.get_all(LOOKUP_DT, filters={"patient": patient}, fields=["looked_up_at", "channel", "result", "purpose", "api_client"], order_by="creation desc", limit=min(cint(limit) or 50, 200))
	out = []
	for r in rows:
		client = frappe.db.get_value(API_CLIENT_DT, r.api_client, "client_name") if r.api_client else None
		out.append({"at": cstr(r.looked_up_at), "channel": r.channel, "result": r.result, "purpose": r.purpose, "partner": client})
	return {"rows": out}


def export_data(ctx, patient=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr import export_emr
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import export_lifestyle

	patients = [patient_in_scope(ctx, patient)] if patient else patients_of(ctx)
	out = {"schema": "remedium.vault.export.v1", "exported_at": cstr(now_datetime()), "exported_by": ctx.user, "profiles": []}
	for pid in patients:
		out["profiles"].append(
			{
				"profile": profile_detail(ctx, pid),
				"lookups": lookup_history(ctx, pid, 200)["rows"],
				**export_emr(pid),
				**export_lifestyle(pid),
			}
		)
	return out


def home(ctx, patient=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr import recent_records
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import adherence, daily_tip, goals_summary, today_checklist

	patient = patient_in_scope(ctx, patient)
	return {
		"patient": patient,
		"card": card_payload(patient),
		"checklist": today_checklist(patient),
		"tip": daily_tip(patient),
		"goals": goals_summary(patient),
		"adherence_7d": adherence(patient, 7),
		"recent": recent_records(patient, 4),
	}


def meta():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr import UPLOAD_TYPES
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import GOAL_META, GOAL_TYPES

	return {
		"app_url": vault_base() or None,
		"uberdoc_url": cstr(frappe.conf.get("uberdoc_base_url")).strip().rstrip("/") or None,
		"blood_groups": list(BLOOD_GROUPS),
		"relations": [r for r in RELATIONS if r != "Self"],
		"genders": list(GENDERS),
		"goal_types": [{"goal_type": t, "unit": GOAL_META[t]["unit"]} for t in GOAL_TYPES],
		"upload_types": list(UPLOAD_TYPES),
		"tip_disclaimer": TIP_DISCLAIMER,
		"uid_prefix": UID_PREFIX,
	}


# ---------------------------------------------------------------------------
# Endpoints (patient-only)
# ---------------------------------------------------------------------------


def run(sid, fn, message="OK", commit=False):
	"""Signed-in vault call: no role gate, because every function is scoped to the login's own / linked profiles."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	try:
		_ensure_ready()
		data = fn(make_ctx(frappe.session.user))
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


def guest(fn, message="OK", commit=True):
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


@frappe.whitelist(allow_guest=True)
def vault_meta():
	return guest(meta, commit=False)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_otp_login(mobile=None, otp=None):
	return guest(lambda: otp_login(mobile, otp), message=_("Verified"))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_register(mobile=None, otp=None, ticket=None, payload=None):
	return guest(lambda: register(mobile, otp, _parse(payload), ticket=ticket), message=_("Your health vault is ready"))


@frappe.whitelist(allow_guest=True)
def vault_public_card(uid=None, k=None):
	return guest(lambda: public_card(uid, k))


@frappe.whitelist(allow_guest=True)
def vault_me(sid=None):
	return run(sid, me, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_create_self(payload=None, sid=None):
	return run(sid, lambda ctx: create_self(ctx, _parse(payload)), message=_("Profile created"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_profile(patient=None, sid=None):
	return run(sid, lambda ctx: profile_detail(ctx, patient))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_profile_save(patient=None, payload=None, sid=None):
	return run(sid, lambda ctx: save_profile(ctx, patient, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_add_family(payload=None, sid=None):
	return run(sid, lambda ctx: add_family(ctx, _parse(payload)), message=_("Profile added"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_settings_save(patient=None, payload=None, sid=None):
	return run(sid, lambda ctx: save_settings(ctx, patient, _parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_card(patient=None, sid=None):
	return run(sid, lambda ctx: card_payload(patient_in_scope(ctx, patient)), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_card_svg(patient=None, sid=None):
	def fn(ctx):
		card = card_payload(patient_in_scope(ctx, patient))
		return {"filename": f"{card['universal_patient_id']}.svg", "svg": card_svg(card)}

	return run(sid, fn, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_card_pdf(patient=None, sid=None):
	def fn(ctx):
		card = card_payload(patient_in_scope(ctx, patient))
		return {"filename": f"{card['universal_patient_id']}.pdf", "content_base64": base64.b64encode(card_pdf(card)).decode()}

	return run(sid, fn, commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_card_rotate(patient=None, sid=None):
	return run(sid, lambda ctx: rotate_card(patient_in_scope(ctx, patient)), message=_("New card issued; the old QR no longer verifies"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_lookup_history(patient=None, sid=None):
	return run(sid, lambda ctx: lookup_history(ctx, patient))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_export(patient=None, sid=None):
	return run(sid, lambda ctx: export_data(ctx, patient))


@frappe.whitelist(allow_guest=True)
def vault_home(patient=None, sid=None):
	return run(sid, lambda ctx: home(ctx, patient), commit=True)


def smoke_phase136():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase136_smoke import run_smoke

	return run_smoke()
