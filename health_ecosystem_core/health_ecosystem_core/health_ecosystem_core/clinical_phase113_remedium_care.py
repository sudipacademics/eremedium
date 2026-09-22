"""
Phase 113 — Remedium Care ops (Ashoknagar Hub journey).

Digital intake, Recovery Blueprint, zone session logs, progress reports,
AI gait snapshot stubs, and Care ops queue. Backend wing id remains physiotherapy.
"""

from __future__ import annotations

import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_require_mobile_auth,
	_success,
	_user_roles,
)

BLUEPRINT_DT = "Care Recovery Blueprint"
SESSION_LOG_DT = "Care Zone Session Log"
PROGRESS_DT = "Care Progress Report"
INTAKE_DT = "Care Digital Intake"

CARE_ZONES = {
	"A": {
		"label": "Zone A — Electrotherapy & Traction",
		"modalities": ["IFT", "TENS", "Ultrasound", "Traction", "Heat/Ice"],
		"ashoknagar_label": "Electrotherapy bay",
	},
	"B": {
		"label": "Zone B — Shockwave / Laser / Hand robotics",
		"modalities": ["Shockwave", "Laser", "Hand robotics"],
		"ashoknagar_label": "Advanced modality suite",
	},
	"C": {
		"label": "Zone C — Active rehab & gait lab",
		"modalities": ["Active rehab", "Gait lab", "Strength", "Mobility"],
		"ashoknagar_label": "Gait & active floor",
	},
}

PACKAGE_PLAN_MAP = {
	"Standard": "CARE_STD_8",
	"Advanced": "CARE_ADV_12",
}

CARE_PACKS = [
	{
		"plan_code": "CARE_STD_8",
		"title": "Remedium Care Standard — 8 Sessions",
		"description": "Standard Recovery Blueprint block: assessment + Zone A rehab with session tracking.",
		"monthly_price": 7999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "physiotherapy",
		"session_pack": 1,
		"included_sessions": 8,
		"display_order": 28,
		"care_package": "Standard",
	},
	{
		"plan_code": "CARE_ADV_12",
		"title": "Remedium Care Advanced Tech-Led — 12 Sessions",
		"description": "Advanced Tech-Led package with Zone B modalities and gait lab access.",
		"monthly_price": 14999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "physiotherapy",
		"session_pack": 1,
		"included_sessions": 12,
		"display_order": 29,
		"care_package": "Advanced",
	},
]

CARE_CATALOG_ITEMS = [
	{
		"item_code": "CARE-ASSESS",
		"item_name": "Remedium Care Assessment Consult",
		"description": "Clinical consult, film review, and Recovery Blueprint creation.",
		"standard_rate": 999,
	},
	{
		"item_code": "CARE-IFT",
		"item_name": "Care Zone A — IFT / TENS Session",
		"description": "Electrotherapy session in Zone A.",
		"standard_rate": 799,
	},
	{
		"item_code": "CARE-TRACTION",
		"item_name": "Care Zone A — Traction Session",
		"description": "Spinal traction in Zone A.",
		"standard_rate": 999,
	},
	{
		"item_code": "CARE-SHOCKWAVE",
		"item_name": "Care Zone B — Shockwave Session",
		"description": "Focused shockwave therapy.",
		"standard_rate": 2499,
	},
	{
		"item_code": "CARE-LASER",
		"item_name": "Care Zone B — Therapeutic Laser",
		"description": "Laser modality session.",
		"standard_rate": 1499,
	},
	{
		"item_code": "CARE-GAIT",
		"item_name": "Care Zone C — Gait Lab Session",
		"description": "Active rehab and gait analysis.",
		"standard_rate": 1299,
	},
]


def _is_staff(roles=None):
	roles = set(roles or _user_roles())
	return bool(
		roles
		& {
			"System Manager",
			"Health System Admin",
			"Physician",
			"Healthcare Practitioner",
			"Nursing User",
			"Healthcare Admin",
		}
	)


def _ensure_doctype(name, fields, autoname, permissions=None, is_child=False, parent=None):
	if frappe.db.exists("DocType", name):
		return False
	payload = {
		"doctype": "DocType",
		"name": name,
		"module": "Health Ecosystem Core",
		"custom": 0,
		"autoname": autoname,
		"naming_rule": (
			"Expression"
			if autoname.startswith("format:")
			else ("By fieldname" if autoname.startswith("field:") else "Random")
		),
		"engine": "InnoDB",
		"track_changes": 1,
		"fields": fields,
		"permissions": permissions
		or [
			{
				"role": "System Manager",
				"read": 1,
				"write": 1,
				"create": 1,
				"delete": 1,
				"export": 1,
				"report": 1,
			},
			{
				"role": "Health System Admin",
				"read": 1,
				"write": 1,
				"create": 1,
				"export": 1,
				"report": 1,
			},
			{"role": "Physician", "read": 1, "write": 1, "create": 1, "report": 1},
			{"role": "Patient", "read": 1},
		],
	}
	if is_child:
		payload.update(
			{
				"istable": 1,
				"editable_grid": 1,
				"permissions": [],
				"autoname": "",
				"naming_rule": "",
			}
		)
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def ensure_phase113_doctypes():
	created = []

	if _ensure_doctype(
		"Care Blueprint Modality",
		[
			{"fieldname": "zone", "label": "Zone", "fieldtype": "Select", "options": "A\nB\nC", "in_list_view": 1, "reqd": 1},
			{"fieldname": "modality", "label": "Modality", "fieldtype": "Data", "in_list_view": 1, "reqd": 1},
			{"fieldname": "planned_sessions", "label": "Planned Sessions", "fieldtype": "Int", "default": "1", "in_list_view": 1},
			{"fieldname": "completed_sessions", "label": "Completed", "fieldtype": "Int", "default": "0", "in_list_view": 1},
			{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
		],
		"",
		is_child=True,
	):
		created.append("Care Blueprint Modality")

	if _ensure_doctype(
		BLUEPRINT_DT,
		[
			{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
			{"fieldname": "package", "label": "Package", "fieldtype": "Select", "options": "Standard\nAdvanced", "default": "Standard", "reqd": 1, "in_list_view": 1},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Draft\nActive\nCompleted\nPaused\nCancelled", "default": "Active", "in_list_view": 1},
			{"fieldname": "chief_complaint", "label": "Chief Complaint", "fieldtype": "Small Text"},
			{"fieldname": "timeline_weeks", "label": "Timeline (weeks)", "fieldtype": "Int", "default": "4"},
			{"fieldname": "zone_plan_summary", "label": "Zone Plan Summary", "fieldtype": "Small Text"},
			{"fieldname": "planned_sessions", "label": "Planned Sessions", "fieldtype": "Int", "default": "8"},
			{"fieldname": "completed_sessions", "label": "Completed Sessions", "fieldtype": "Int", "default": "0", "read_only": 1},
			{"fieldname": "progress_percent", "label": "Progress %", "fieldtype": "Float", "default": "0", "read_only": 1},
			{"fieldname": "session_card", "label": "Session Card", "fieldtype": "Link", "options": "Health Subscription"},
			{"fieldname": "appointment", "label": "Consult Appointment", "fieldtype": "Link", "options": "Doctor Appointment"},
			{"fieldname": "clinician", "label": "Clinician", "fieldtype": "Data"},
			{"fieldname": "start_date", "label": "Start Date", "fieldtype": "Date", "default": "Today", "in_list_view": 1},
			{"fieldname": "end_date", "label": "Target End Date", "fieldtype": "Date"},
			{"fieldname": "baseline_pain", "label": "Baseline Pain (0-10)", "fieldtype": "Float"},
			{"fieldname": "baseline_mobility", "label": "Baseline Mobility (0-10)", "fieldtype": "Float"},
			{"fieldname": "current_pain", "label": "Current Pain (0-10)", "fieldtype": "Float"},
			{"fieldname": "current_mobility", "label": "Current Mobility (0-10)", "fieldtype": "Float"},
			{"fieldname": "red_zone_tags", "label": "Red Zone Tags", "fieldtype": "Small Text"},
			{"fieldname": "ai_gait_status", "label": "AI Gait Status", "fieldtype": "Select", "options": "\nPending\nCaptured\nReviewed", "default": "Pending"},
			{"fieldname": "ai_gait_snapshot_url", "label": "AI Gait Snapshot URL", "fieldtype": "Data"},
			{"fieldname": "ai_gait_metadata_json", "label": "AI Gait Metadata JSON", "fieldtype": "Long Text"},
			{"fieldname": "modalities", "label": "Planned Modalities", "fieldtype": "Table", "options": "Care Blueprint Modality"},
			{"fieldname": "clinical_notes", "label": "Clinical Notes", "fieldtype": "Text Editor"},
		],
		"format:HEC-CAREBP-{YYYY}-{#####}",
	):
		created.append(BLUEPRINT_DT)

	if _ensure_doctype(
		SESSION_LOG_DT,
		[
			{"fieldname": "blueprint", "label": "Blueprint", "fieldtype": "Link", "options": BLUEPRINT_DT, "reqd": 1, "in_list_view": 1},
			{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
			{"fieldname": "appointment", "label": "Appointment", "fieldtype": "Link", "options": "Doctor Appointment"},
			{"fieldname": "session_card", "label": "Session Card", "fieldtype": "Link", "options": "Health Subscription"},
			{"fieldname": "zone", "label": "Zone", "fieldtype": "Select", "options": "A\nB\nC", "reqd": 1, "in_list_view": 1},
			{"fieldname": "modality", "label": "Modality", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "therapist", "label": "Therapist", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "duration_minutes", "label": "Duration (min)", "fieldtype": "Int", "default": "30"},
			{"fieldname": "session_date", "label": "Session Date", "fieldtype": "Datetime", "default": "Now", "in_list_view": 1},
			{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			{"fieldname": "punched", "label": "Card Punched", "fieldtype": "Check", "default": "0"},
		],
		"format:HEC-CAREZN-{YYYY}-{#####}",
	):
		created.append(SESSION_LOG_DT)

	if _ensure_doctype(
		PROGRESS_DT,
		[
			{"fieldname": "blueprint", "label": "Blueprint", "fieldtype": "Link", "options": BLUEPRINT_DT, "reqd": 1, "in_list_view": 1},
			{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
			{"fieldname": "report_month", "label": "Report Month", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "baseline_pain", "label": "Baseline Pain", "fieldtype": "Float"},
			{"fieldname": "current_pain", "label": "Current Pain", "fieldtype": "Float"},
			{"fieldname": "baseline_mobility", "label": "Baseline Mobility", "fieldtype": "Float"},
			{"fieldname": "current_mobility", "label": "Current Mobility", "fieldtype": "Float"},
			{"fieldname": "sessions_completed", "label": "Sessions Completed", "fieldtype": "Int"},
			{"fieldname": "summary_html", "label": "Summary HTML", "fieldtype": "Text Editor"},
			{"fieldname": "ai_gait_note", "label": "AI Gait Note", "fieldtype": "Small Text"},
			{"fieldname": "renewal_cta", "label": "Renewal CTA", "fieldtype": "Data"},
			{"fieldname": "circle_referral_url", "label": "Circle Referral URL", "fieldtype": "Data"},
			{"fieldname": "generated_on", "label": "Generated On", "fieldtype": "Datetime", "default": "Now"},
		],
		"format:HEC-CAREPR-{YYYY}-{#####}",
	):
		created.append(PROGRESS_DT)

	if _ensure_doctype(
		INTAKE_DT,
		[
			{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
			{"fieldname": "appointment", "label": "Appointment", "fieldtype": "Link", "options": "Doctor Appointment", "in_list_view": 1},
			{"fieldname": "chief_complaint", "label": "Chief Complaint", "fieldtype": "Small Text", "reqd": 1},
			{"fieldname": "history_json", "label": "History JSON", "fieldtype": "Long Text"},
			{"fieldname": "consent", "label": "Consent", "fieldtype": "Check", "default": "0", "reqd": 1},
			{"fieldname": "sensory_notes", "label": "Sensory / Triage Notes", "fieldtype": "Small Text"},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Draft\nSubmitted", "default": "Submitted", "in_list_view": 1},
			{"fieldname": "submitted_on", "label": "Submitted On", "fieldtype": "Datetime", "default": "Now"},
		],
		"format:HEC-CAREIN-{YYYY}-{#####}",
	):
		created.append(INTAKE_DT)

	return created


def ensure_phase113_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	ensure_phase113_doctypes()
	create_custom_fields(
		{
			"Doctor Appointment": [
				{
					"fieldname": "care_arrived",
					"label": "Care Arrived",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "session_punched",
				},
				{
					"fieldname": "care_intake_complete",
					"label": "Care Intake Complete",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "care_arrived",
				},
				{
					"fieldname": "care_intake",
					"label": "Care Digital Intake",
					"fieldtype": "Link",
					"options": INTAKE_DT,
					"insert_after": "care_intake_complete",
				},
				{
					"fieldname": "care_blueprint",
					"label": "Care Recovery Blueprint",
					"fieldtype": "Link",
					"options": BLUEPRINT_DT,
					"insert_after": "care_intake",
				},
				{
					"fieldname": "care_zone",
					"label": "Care Zone",
					"fieldtype": "Select",
					"options": "\nA\nB\nC",
					"insert_after": "care_blueprint",
				},
			],
			"Health Subscription Plan": [
				{
					"fieldname": "care_package",
					"label": "Care Package Type",
					"fieldtype": "Select",
					"options": "\nStandard\nAdvanced",
					"insert_after": "included_sessions",
				},
			],
		},
		update=True,
	)


def seed_care_session_packs():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import subscriptions_ready
	from health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions import (
		ensure_wellness_session_fields,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_yoga_subscriptions import ensure_yoga_plan_fields

	ensure_phase113_fields()
	if not subscriptions_ready():
		return []
	ensure_yoga_plan_fields()
	ensure_wellness_session_fields()
	created = []
	meta = frappe.get_meta("Health Subscription Plan")
	for spec in CARE_PACKS:
		code = spec["plan_code"]
		payload = {k: v for k, v in spec.items() if meta.has_field(k)}
		payload["enabled"] = 1
		if frappe.db.exists("Health Subscription Plan", code):
			doc = frappe.get_doc("Health Subscription Plan", code)
			changed = False
			for key, value in payload.items():
				if doc.get(key) != value:
					doc.set(key, value)
					changed = True
			if changed:
				doc.save(ignore_permissions=True)
			continue
		frappe.get_doc({"doctype": "Health Subscription Plan", "name": code, **payload}).insert(
			ignore_permissions=True
		)
		created.append(code)
	frappe.db.commit()
	return created


def seed_care_catalog_items():
	"""Ensure consult + modality Items under Physiotherapy item group when Item exists."""
	if not frappe.db.exists("DocType", "Item"):
		return []
	group = "Physiotherapy & Rehabilitation"
	if frappe.db.exists("DocType", "Item Group") and not frappe.db.exists("Item Group", group):
		try:
			frappe.get_doc(
				{"doctype": "Item Group", "item_group_name": group, "parent_item_group": "All Item Groups", "is_group": 0}
			).insert(ignore_permissions=True)
		except Exception:
			pass
	created = []
	for spec in CARE_CATALOG_ITEMS:
		code = spec["item_code"]
		if frappe.db.exists("Item", code):
			continue
		try:
			payload = {
				"doctype": "Item",
				"item_code": code,
				"item_name": spec["item_name"],
				"item_group": group if frappe.db.exists("Item Group", group) else "All Item Groups",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"include_item_in_manufacturing": 0,
				"description": spec["description"],
				"standard_rate": spec["standard_rate"],
			}
			frappe.get_doc(payload).insert(ignore_permissions=True)
			created.append(code)
		except Exception:
			frappe.log_error(title="seed_care_catalog_items", message=frappe.get_traceback())
	if created:
		frappe.db.commit()
	return created


def _patient_for_user():
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

	profile = patient_profile_for_user()
	return profile.get("patient_id") if profile else None


def _json_loads(raw, default=None):
	if default is None:
		default = {}
	if not raw:
		return default
	if isinstance(raw, (dict, list)):
		return raw
	try:
		return json.loads(raw)
	except Exception:
		return default


def _default_modalities(package):
	rows = [
		{"zone": "A", "modality": "IFT", "planned_sessions": 4},
		{"zone": "A", "modality": "Traction", "planned_sessions": 2},
		{"zone": "C", "modality": "Active rehab", "planned_sessions": 2},
	]
	if package == "Advanced":
		rows.extend(
			[
				{"zone": "B", "modality": "Shockwave", "planned_sessions": 2},
				{"zone": "B", "modality": "Laser", "planned_sessions": 2},
				{"zone": "C", "modality": "Gait lab", "planned_sessions": 2},
			]
		)
	return rows


def _serialize_blueprint(name):
	doc = frappe.get_doc(BLUEPRINT_DT, name)
	modalities = [
		{
			"zone": r.zone,
			"modality": r.modality,
			"planned_sessions": cint(r.planned_sessions),
			"completed_sessions": cint(r.completed_sessions),
			"notes": r.notes,
		}
		for r in (doc.modalities or [])
	]
	return {
		"name": doc.name,
		"patient": doc.patient,
		"package": doc.package,
		"status": doc.status,
		"chief_complaint": doc.chief_complaint,
		"timeline_weeks": cint(doc.timeline_weeks),
		"zone_plan_summary": doc.zone_plan_summary,
		"planned_sessions": cint(doc.planned_sessions),
		"completed_sessions": cint(doc.completed_sessions),
		"progress_percent": flt(doc.progress_percent),
		"session_card": doc.session_card,
		"appointment": doc.appointment,
		"clinician": doc.clinician,
		"start_date": str(doc.start_date or "") or None,
		"end_date": str(doc.end_date or "") or None,
		"baseline_pain": flt(doc.baseline_pain) if doc.baseline_pain is not None else None,
		"baseline_mobility": flt(doc.baseline_mobility) if doc.baseline_mobility is not None else None,
		"current_pain": flt(doc.current_pain) if doc.current_pain is not None else None,
		"current_mobility": flt(doc.current_mobility) if doc.current_mobility is not None else None,
		"red_zone_tags": doc.red_zone_tags,
		"ai_gait_status": doc.ai_gait_status,
		"ai_gait_snapshot_url": doc.ai_gait_snapshot_url,
		"ai_gait_metadata": _json_loads(doc.ai_gait_metadata_json, {}),
		"modalities": modalities,
		"clinical_notes": doc.clinical_notes,
		"zones": CARE_ZONES,
	}


def _recalc_blueprint_progress(blueprint_name):
	doc = frappe.get_doc(BLUEPRINT_DT, blueprint_name)
	completed = cint(
		frappe.db.count(SESSION_LOG_DT, {"blueprint": blueprint_name})
	)
	planned = cint(doc.planned_sessions) or 1
	doc.completed_sessions = completed
	doc.progress_percent = min(100.0, round(100.0 * completed / planned, 1))
	if doc.progress_percent >= 100 and doc.status == "Active":
		doc.status = "Completed"
	doc.save(ignore_permissions=True)
	return doc


@frappe.whitelist(allow_guest=True)
def ensure_remedium_care_setup(sid=None):
	"""Idempotent migrate for Care DocTypes, fields, packs, and catalog items."""
	# Allow authenticated users (patient or staff) and desk System Manager
	authed = False
	try:
		authed = bool(_require_mobile_auth(sid))
	except Exception:
		authed = False
	if not authed and frappe.session.user in (None, "Guest"):
		return _error(_("Not authenticated"), 401)
	created_dt = ensure_phase113_doctypes()
	ensure_phase113_fields()
	packs = seed_care_session_packs()
	items = seed_care_catalog_items()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions import (
			seed_wellness_session_packs,
		)

		seed_wellness_session_packs()
	except Exception:
		pass
	return _success(
		{
			"doctypes": created_dt,
			"packs": packs,
			"items": items,
			"zones": CARE_ZONES,
			"package_plan_map": PACKAGE_PLAN_MAP,
		}
	)


@frappe.whitelist(allow_guest=True)
def get_care_zones(sid=None):
	return _success({"zones": CARE_ZONES, "packages": list(PACKAGE_PLAN_MAP.keys())})


@frappe.whitelist(allow_guest=True)
def submit_care_intake(
	appointment_id=None,
	chief_complaint=None,
	history_json=None,
	consent=None,
	sensory_notes=None,
	sid=None,
):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	patient = _patient_for_user()
	if not patient:
		return _error(_("Patient profile required"), 400)
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
	chief_complaint = (_parse_request_value("chief_complaint", chief_complaint) or "").strip()
	if not chief_complaint:
		return _error(_("Chief complaint is required"))
	consent_raw = _parse_request_value("consent", consent)
	if str(consent_raw or "").strip().lower() in ("0", "false", "no", ""):
		return _error(_("Consent is required"))
	history_raw = _parse_request_value("history_json", history_json) or "{}"
	if isinstance(history_raw, (dict, list)):
		history_raw = json.dumps(history_raw)
	sensory_notes = _parse_request_value("sensory_notes", sensory_notes) or ""

	doc = frappe.get_doc(
		{
			"doctype": INTAKE_DT,
			"patient": patient,
			"appointment": appointment_id or None,
			"chief_complaint": chief_complaint,
			"history_json": history_raw,
			"consent": 1,
			"sensory_notes": sensory_notes,
			"status": "Submitted",
			"submitted_on": now_datetime(),
		}
	)
	doc.insert(ignore_permissions=True)

	if appointment_id and frappe.db.exists("Doctor Appointment", appointment_id):
		meta = frappe.get_meta("Doctor Appointment")
		updates = {}
		if meta.has_field("care_intake_complete"):
			updates["care_intake_complete"] = 1
		if meta.has_field("care_intake"):
			updates["care_intake"] = doc.name
		if updates:
			frappe.db.set_value("Doctor Appointment", appointment_id, updates, update_modified=True)

	frappe.db.commit()
	return _success(
		{
			"intake": {
				"name": doc.name,
				"patient": patient,
				"appointment": appointment_id,
				"chief_complaint": chief_complaint,
				"status": doc.status,
			}
		}
	)


@frappe.whitelist(allow_guest=True)
def get_care_intake(appointment_id=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
	patient = _patient_for_user()
	filters = {}
	if appointment_id:
		filters["appointment"] = appointment_id
	elif patient:
		filters["patient"] = patient
	else:
		return _error(_("appointment_id required"))
	name = frappe.db.get_value(INTAKE_DT, filters, "name", order_by="creation desc")
	if not name:
		return _success({"intake": None})
	doc = frappe.get_doc(INTAKE_DT, name)
	if not _is_staff() and doc.patient != patient:
		return _error(_("Not allowed"), 403)
	return _success(
		{
			"intake": {
				"name": doc.name,
				"patient": doc.patient,
				"appointment": doc.appointment,
				"chief_complaint": doc.chief_complaint,
				"history": _json_loads(doc.history_json, {}),
				"consent": cint(doc.consent),
				"sensory_notes": doc.sensory_notes,
				"status": doc.status,
				"submitted_on": str(doc.submitted_on or "") or None,
			}
		}
	)


@frappe.whitelist(allow_guest=True)
def mark_care_checkin(appointment_id=None, arrived=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip()
	if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
		return _error(_("Appointment not found"), 404)
	arrived_flag = 1 if str(_parse_request_value("arrived", arrived) or "1").lower() not in ("0", "false", "no") else 0
	meta = frappe.get_meta("Doctor Appointment")
	if meta.has_field("care_arrived"):
		frappe.db.set_value("Doctor Appointment", appointment_id, "care_arrived", arrived_flag, update_modified=True)
		frappe.db.commit()
	return _success({"appointment_id": appointment_id, "care_arrived": arrived_flag})


@frappe.whitelist(allow_guest=True)
def create_care_blueprint(
	patient=None,
	package=None,
	chief_complaint=None,
	timeline_weeks=None,
	appointment_id=None,
	baseline_pain=None,
	baseline_mobility=None,
	attach_pack=None,
	clinical_notes=None,
	sid=None,
):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	seed_care_session_packs()

	patient = (_parse_request_value("patient", patient) or "").strip()
	package = (_parse_request_value("package", package) or "Standard").strip()
	if package not in ("Standard", "Advanced"):
		package = "Standard"
	if not patient:
		return _error(_("patient required"))
	chief_complaint = _parse_request_value("chief_complaint", chief_complaint) or ""
	timeline_weeks = cint(_parse_request_value("timeline_weeks", timeline_weeks) or (6 if package == "Advanced" else 4))
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip() or None
	attach_pack = str(_parse_request_value("attach_pack", attach_pack) or "1").lower() not in ("0", "false", "no")

	modalities = _default_modalities(package)
	planned = sum(cint(m["planned_sessions"]) for m in modalities)
	zone_summary = ", ".join(sorted({f"Zone {m['zone']}: {m['modality']}" for m in modalities}))

	doc = frappe.get_doc(
		{
			"doctype": BLUEPRINT_DT,
			"patient": patient,
			"package": package,
			"status": "Active",
			"chief_complaint": chief_complaint,
			"timeline_weeks": timeline_weeks,
			"zone_plan_summary": zone_summary,
			"planned_sessions": planned,
			"completed_sessions": 0,
			"progress_percent": 0,
			"appointment": appointment_id,
			"clinician": frappe.session.user,
			"start_date": today(),
			"end_date": getdate(today()) + timedelta(weeks=timeline_weeks),
			"baseline_pain": flt(_parse_request_value("baseline_pain", baseline_pain) or 0) or None,
			"baseline_mobility": flt(_parse_request_value("baseline_mobility", baseline_mobility) or 0) or None,
			"current_pain": flt(_parse_request_value("baseline_pain", baseline_pain) or 0) or None,
			"current_mobility": flt(_parse_request_value("baseline_mobility", baseline_mobility) or 0) or None,
			"ai_gait_status": "Pending",
			"clinical_notes": _parse_request_value("clinical_notes", clinical_notes) or "",
			"modalities": modalities,
		}
	)
	doc.insert(ignore_permissions=True)

	session_card = None
	if attach_pack:
		plan_code = PACKAGE_PLAN_MAP.get(package)
		try:
			if plan_code and frappe.db.exists("Health Subscription Plan", plan_code):
				plan = frappe.get_doc("Health Subscription Plan", plan_code)
				user = frappe.db.get_value("Health Patient", patient, "user")
				if user and frappe.db.exists("DocType", "Health Subscription"):
					meta = frappe.get_meta("Health Subscription")
					payload = {
						"doctype": "Health Subscription",
						"user": user,
						"plan": plan.name,
						"status": "Active",
						"start_date": today(),
						"amount": flt(plan.monthly_price),
						"sessions_total": cint(plan.included_sessions),
						"sessions_remaining": cint(plan.included_sessions),
						"wellness_wing": "physiotherapy",
					}
					clean = {k: v for k, v in payload.items() if k == "doctype" or meta.has_field(k)}
					sub = frappe.get_doc(clean)
					sub.insert(ignore_permissions=True)
					session_card = sub.name
					doc.session_card = session_card
					doc.save(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="care_blueprint_attach_pack", message=frappe.get_traceback())

	if appointment_id and frappe.db.exists("Doctor Appointment", appointment_id):
		meta = frappe.get_meta("Doctor Appointment")
		if meta.has_field("care_blueprint"):
			frappe.db.set_value("Doctor Appointment", appointment_id, "care_blueprint", doc.name, update_modified=True)

	frappe.db.commit()
	return _success({"blueprint": _serialize_blueprint(doc.name), "session_card": session_card})


@frappe.whitelist(allow_guest=True)
def update_care_blueprint(blueprint_id=None, sid=None, **kwargs):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	if not blueprint_id or not frappe.db.exists(BLUEPRINT_DT, blueprint_id):
		return _error(_("Blueprint not found"), 404)
	doc = frappe.get_doc(BLUEPRINT_DT, blueprint_id)
	allowed = {
		"package",
		"status",
		"chief_complaint",
		"timeline_weeks",
		"zone_plan_summary",
		"planned_sessions",
		"current_pain",
		"current_mobility",
		"baseline_pain",
		"baseline_mobility",
		"red_zone_tags",
		"clinical_notes",
		"ai_gait_status",
		"ai_gait_snapshot_url",
		"end_date",
	}
	for key in allowed:
		val = _parse_request_value(key, kwargs.get(key) if kwargs else None)
		if val is None:
			# also read from form_dict
			val = frappe.form_dict.get(key)
		if val is not None and val != "":
			doc.set(key, val)
	meta_json = _parse_request_value("ai_gait_metadata_json", None) or frappe.form_dict.get("ai_gait_metadata_json")
	if meta_json:
		if isinstance(meta_json, (dict, list)):
			meta_json = json.dumps(meta_json)
		doc.ai_gait_metadata_json = meta_json
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"blueprint": _serialize_blueprint(doc.name)})


@frappe.whitelist(allow_guest=True)
def get_my_care_blueprints(sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	patient = _patient_for_user()
	if not patient:
		return _success({"blueprints": []})
	names = frappe.get_all(
		BLUEPRINT_DT,
		filters={"patient": patient},
		pluck="name",
		order_by="modified desc",
	)
	return _success({"blueprints": [_serialize_blueprint(n) for n in names]})


@frappe.whitelist(allow_guest=True)
def get_care_blueprint(blueprint_id=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	if not blueprint_id or not frappe.db.exists(BLUEPRINT_DT, blueprint_id):
		return _error(_("Blueprint not found"), 404)
	doc = frappe.get_doc(BLUEPRINT_DT, blueprint_id)
	patient = _patient_for_user()
	if not _is_staff() and doc.patient != patient:
		return _error(_("Not allowed"), 403)
	return _success({"blueprint": _serialize_blueprint(doc.name)})


@frappe.whitelist(allow_guest=True)
def log_care_zone_session(
	blueprint_id=None,
	zone=None,
	modality=None,
	therapist=None,
	duration_minutes=None,
	notes=None,
	appointment_id=None,
	punch_card=None,
	sid=None,
):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	zone = (_parse_request_value("zone", zone) or "").strip().upper()
	modality = (_parse_request_value("modality", modality) or "").strip()
	if not blueprint_id or not frappe.db.exists(BLUEPRINT_DT, blueprint_id):
		return _error(_("Blueprint not found"), 404)
	if zone not in CARE_ZONES:
		return _error(_("Invalid zone"))
	if not modality:
		return _error(_("modality required"))

	bp = frappe.get_doc(BLUEPRINT_DT, blueprint_id)
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip() or None
	punch = str(_parse_request_value("punch_card", punch_card) or "1").lower() not in ("0", "false", "no")

	log = frappe.get_doc(
		{
			"doctype": SESSION_LOG_DT,
			"blueprint": blueprint_id,
			"patient": bp.patient,
			"appointment": appointment_id,
			"session_card": bp.session_card,
			"zone": zone,
			"modality": modality,
			"therapist": _parse_request_value("therapist", therapist) or frappe.session.user,
			"duration_minutes": cint(_parse_request_value("duration_minutes", duration_minutes) or 30),
			"session_date": now_datetime(),
			"notes": _parse_request_value("notes", notes) or "",
			"punched": 0,
		}
	)
	log.insert(ignore_permissions=True)

	# Increment modality completed count
	for row in bp.modalities or []:
		if row.zone == zone and (row.modality or "").lower() == modality.lower():
			row.completed_sessions = cint(row.completed_sessions) + 1
			break
	bp.save(ignore_permissions=True)

	if punch and bp.session_card:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions import (
				punch_session_card,
			)

			punch_session_card(subscription_id=bp.session_card, appointment_id=appointment_id, sid=sid)
			log.punched = 1
			log.save(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="care_zone_punch", message=frappe.get_traceback())

	if appointment_id and frappe.db.exists("Doctor Appointment", appointment_id):
		meta = frappe.get_meta("Doctor Appointment")
		updates = {}
		if meta.has_field("care_zone"):
			updates["care_zone"] = zone
		if meta.has_field("care_blueprint"):
			updates["care_blueprint"] = blueprint_id
		if updates:
			frappe.db.set_value("Doctor Appointment", appointment_id, updates, update_modified=True)

	_recalc_blueprint_progress(blueprint_id)
	frappe.db.commit()
	return _success(
		{
			"log": {
				"name": log.name,
				"zone": zone,
				"modality": modality,
				"punched": cint(log.punched),
			},
			"blueprint": _serialize_blueprint(blueprint_id),
		}
	)


@frappe.whitelist(allow_guest=True)
def list_care_ops_queue(limit=50, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	limit = cint(_parse_request_value("limit", limit) or 50)

	blueprints = frappe.get_all(
		BLUEPRINT_DT,
		filters={"status": ["in", ["Draft", "Active"]]},
		fields=[
			"name",
			"patient",
			"package",
			"status",
			"progress_percent",
			"completed_sessions",
			"planned_sessions",
			"chief_complaint",
			"start_date",
			"ai_gait_status",
			"red_zone_tags",
		],
		order_by="modified desc",
		limit_page_length=limit,
	)

	checkins = []
	meta = frappe.get_meta("Doctor Appointment")
	if meta.has_field("wellness_wing"):
		filters = {"appointment_date": [">=", today()], "wellness_wing": "physiotherapy"}
		fields = ["name", "patient_name", "appointment_date", "appointment_time", "status"]
		for f in ("care_arrived", "care_intake_complete", "care_blueprint", "care_zone", "session_card"):
			if meta.has_field(f):
				fields.append(f)
		checkins = frappe.get_all(
			"Doctor Appointment",
			filters=filters,
			fields=fields,
			order_by="appointment_date asc, appointment_time asc",
			limit_page_length=limit,
		)

	zone_board = {z: {"label": CARE_ZONES[z]["label"], "ashoknagar_label": CARE_ZONES[z]["ashoknagar_label"], "today": 0} for z in CARE_ZONES}
	today_logs = frappe.get_all(
		SESSION_LOG_DT,
		filters={"session_date": [">=", f"{today()} 00:00:00"]},
		fields=["zone"],
	)
	for row in today_logs:
		z = row.zone
		if z in zone_board:
			zone_board[z]["today"] += 1

	return _success(
		{
			"blueprints": blueprints,
			"checkins": checkins,
			"zone_board": zone_board,
			"zones": CARE_ZONES,
		}
	)


@frappe.whitelist(allow_guest=True)
def generate_care_progress_report(blueprint_id=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	if not blueprint_id or not frappe.db.exists(BLUEPRINT_DT, blueprint_id):
		return _error(_("Blueprint not found"), 404)
	bp = frappe.get_doc(BLUEPRINT_DT, blueprint_id)
	patient = _patient_for_user()
	if not _is_staff() and bp.patient != patient:
		return _error(_("Not allowed"), 403)

	month = now_datetime().strftime("%Y-%m")
	ai_note = ""
	if bp.ai_gait_status in ("Captured", "Reviewed") and bp.ai_gait_snapshot_url:
		ai_note = f"AI gait snapshot: {bp.ai_gait_status} ({bp.ai_gait_snapshot_url})"
	elif bp.ai_gait_status == "Pending":
		ai_note = "AI gait snapshot pending capture."

	summary = f"""
	<h2>Remedium Care Progress Report</h2>
	<p><strong>Package:</strong> {frappe.utils.escape_html(bp.package or '')} ·
	<strong>Progress:</strong> {flt(bp.progress_percent)}%</p>
	<table>
	<tr><th></th><th>Baseline</th><th>Current</th></tr>
	<tr><td>Pain (0–10)</td><td>{flt(bp.baseline_pain)}</td><td>{flt(bp.current_pain)}</td></tr>
	<tr><td>Mobility (0–10)</td><td>{flt(bp.baseline_mobility)}</td><td>{flt(bp.current_mobility)}</td></tr>
	</table>
	<p>Sessions completed: {cint(bp.completed_sessions)} / {cint(bp.planned_sessions)}</p>
	<p>{frappe.utils.escape_html(ai_note)}</p>
	"""

	report = frappe.get_doc(
		{
			"doctype": PROGRESS_DT,
			"blueprint": blueprint_id,
			"patient": bp.patient,
			"report_month": month,
			"baseline_pain": bp.baseline_pain,
			"current_pain": bp.current_pain,
			"baseline_mobility": bp.baseline_mobility,
			"current_mobility": bp.current_mobility,
			"sessions_completed": bp.completed_sessions,
			"summary_html": summary,
			"ai_gait_note": ai_note,
			"renewal_cta": "/wellness/sessions?wing=physiotherapy",
			"circle_referral_url": "/circle",
			"generated_on": now_datetime(),
		}
	)
	report.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success(
		{
			"report": {
				"name": report.name,
				"report_month": month,
				"summary_html": summary,
				"baseline_pain": flt(bp.baseline_pain),
				"current_pain": flt(bp.current_pain),
				"baseline_mobility": flt(bp.baseline_mobility),
				"current_mobility": flt(bp.current_mobility),
				"sessions_completed": cint(bp.completed_sessions),
				"renewal_cta": report.renewal_cta,
				"circle_referral_url": report.circle_referral_url,
				"ai_gait_note": ai_note,
			}
		}
	)


@frappe.whitelist(allow_guest=True)
def get_my_care_progress_reports(blueprint_id=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_phase113_fields()
	patient = _patient_for_user()
	if not patient and not _is_staff():
		return _success({"reports": []})
	filters = {}
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	if blueprint_id:
		filters["blueprint"] = blueprint_id
	if patient and not _is_staff():
		filters["patient"] = patient
	rows = frappe.get_all(
		PROGRESS_DT,
		filters=filters,
		fields=[
			"name",
			"blueprint",
			"report_month",
			"baseline_pain",
			"current_pain",
			"baseline_mobility",
			"current_mobility",
			"sessions_completed",
			"summary_html",
			"renewal_cta",
			"circle_referral_url",
			"ai_gait_note",
			"generated_on",
		],
		order_by="creation desc",
		limit_page_length=20,
	)
	return _success({"reports": rows})


@frappe.whitelist(allow_guest=True)
def upload_care_gait_snapshot(
	blueprint_id=None,
	snapshot_url=None,
	metadata_json=None,
	red_zone_tags=None,
	sid=None,
):
	"""Phase 6 — stub/metadata capture for AI Movement Snapshot."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_phase113_fields()
	blueprint_id = (_parse_request_value("blueprint_id", blueprint_id) or "").strip()
	if not blueprint_id or not frappe.db.exists(BLUEPRINT_DT, blueprint_id):
		return _error(_("Blueprint not found"), 404)
	doc = frappe.get_doc(BLUEPRINT_DT, blueprint_id)
	url = (_parse_request_value("snapshot_url", snapshot_url) or "").strip()
	meta = _parse_request_value("metadata_json", metadata_json) or "{}"
	if isinstance(meta, (dict, list)):
		meta = json.dumps(meta)
	tags = _parse_request_value("red_zone_tags", red_zone_tags)
	doc.ai_gait_snapshot_url = url
	doc.ai_gait_metadata_json = meta
	doc.ai_gait_status = "Captured" if url else "Pending"
	if tags is not None:
		doc.red_zone_tags = tags
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"blueprint": _serialize_blueprint(doc.name)})
