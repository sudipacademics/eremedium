"""Phase 61 — NABL 112B operational: SCF, scope fields, lot verify, release gates, competence, stability."""

from __future__ import annotations

import os

import frappe
from frappe import _
from frappe.utils import cint, now_datetime, today

PHASE61_DOCTYPES = (
	("lot_verification_result", "Lot Verification Result"),
	("lot_verification", "Lot Verification"),
	("sample_transport_log", "Sample Transport Log"),
	("sample_rejection_record", "Sample Rejection Record"),
	("analyte_stability", "Analyte Stability"),
	("lab_competence_assessment", "Lab Competence Assessment"),
	("scf_internal_audit", "SCF Internal Audit"),
)

# Common biochemistry stability windows (hours) — NABL 112B Sec 7 style examples
STABILITY_SEED = (
	("GLU", "Glucose", "Fluoride Plasma", 8, 72, 0, 0),
	("UREA", "Urea", "Serum", 24, 168, 720, 0),
	("CREAT", "Creatinine", "Serum", 24, 168, 720, 0),
	("ALT", "ALT / SGPT", "Serum", 8, 72, 720, 0),
	("AST", "AST / SGOT", "Serum", 8, 72, 720, 0),
	("ALP", "Alkaline Phosphatase", "Serum", 8, 168, 720, 0),
	("BILI_T", "Total Bilirubin", "Serum", 8, 72, 720, 1),
	("CHOL", "Cholesterol", "Serum", 24, 168, 720, 0),
	("TRIG", "Triglycerides", "Serum", 8, 168, 720, 0),
	("HDL", "HDL Cholesterol", "Serum", 8, 168, 720, 0),
	("LDL", "LDL Cholesterol", "Serum", 8, 168, 720, 0),
	("TSH", "TSH", "Serum", 24, 168, 720, 0),
	("FT4", "Free T4", "Serum", 24, 168, 720, 0),
	("HBA1C", "HbA1c", "EDTA Whole Blood", 24, 168, 720, 0),
	("CBC", "CBC", "EDTA Whole Blood", 6, 24, 0, 1),
)


def _import_doctype(folder, doctype_name, force=True):
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	app_path = frappe.get_app_path("health_ecosystem_core")
	candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg_root = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
	except Exception:
		pass

	for json_path in candidates:
		if os.path.isfile(json_path):
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype=doctype_name)
			if frappe.db.exists("DocType", doctype_name):
				return True
	frappe.throw(_("Could not install {0} doctype").format(doctype_name))


def _reload_doctype_json(folder, doctype_name):
	_import_doctype(folder, doctype_name, force=True)


def ensure_phase61_doctypes():
	for folder, name in PHASE61_DOCTYPES:
		_import_doctype(folder, name, force=True)
	# Reload extended masters
	for folder, name in (
		("diagnostic_test_parameter", "Diagnostic Test Parameter"),
		("diagnostic_test_master", "Diagnostic Test Master"),
		("lab_reagent_batch", "Lab Reagent Batch"),
		("franchisee_profile", "Franchisee Profile"),
		("lab_report", "Lab Report"),
		("health_ecosystem_settings", "Health Ecosystem Settings"),
	):
		_reload_doctype_json(folder, name)


def ensure_phase61_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"User": [
				{
					"fieldname": "hec_nabl_signatory_disciplines",
					"label": "NABL Signatory Disciplines",
					"fieldtype": "Small Text",
					"insert_after": "role_profile_name",
					"description": "Comma-separated NABL disciplines this user may authorize",
				}
			],
			"Customer TRF": [
				{
					"fieldname": "sample_rejected",
					"label": "Sample Rejected",
					"fieldtype": "Check",
					"insert_after": "order_status",
					"default": "0",
					"read_only": 1,
				},
				{
					"fieldname": "sample_rejection_note",
					"label": "Sample Rejection Note",
					"fieldtype": "Small Text",
					"insert_after": "sample_rejected",
					"read_only": 1,
				},
			],
		},
		update=True,
	)


def seed_analyte_stability():
	if not frappe.db.exists("DocType", "Analyte Stability"):
		return 0
	created = 0
	for code, name, specimen, rt, refrig, frozen, dnf in STABILITY_SEED:
		found = frappe.get_all(
			"Analyte Stability",
			filters={"analyte_code": code, "specimen_material": specimen},
			limit=1,
		)
		if found:
			continue
		try:
			doc = frappe.get_doc(
				{
					"doctype": "Analyte Stability",
					"analyte_code": code,
					"analyte_name": name,
					"specimen_material": specimen,
					"rt_hours": rt,
					"refrigerated_hours": refrig,
					"frozen_hours": frozen or None,
					"do_not_freeze": dnf,
				}
			)
			doc.insert(ignore_permissions=True)
			created += 1
		except Exception:
			frappe.log_error(title="seed Analyte Stability", message=frappe.get_traceback())
	frappe.db.commit()
	return created


def grandfather_existing_batches():
	"""Mark already-open/sealed historical batches as Verified so ops are not blocked."""
	if not frappe.db.has_column("Lab Reagent Batch", "verification_status"):
		return 0
	names = frappe.get_all(
		"Lab Reagent Batch",
		filters={"verification_status": ("in", ["", "Pending"])},
		pluck="name",
	)
	# Only grandfather batches that already existed before Phase 61 (opened or sealed with tests)
	updated = 0
	for name in names:
		row = frappe.db.get_value(
			"Lab Reagent Batch",
			name,
			["status", "opened_on", "creation"],
			as_dict=True,
		)
		if not row:
			continue
		if row.status in ("Open", "Depleted", "Expired") or row.opened_on:
			frappe.db.set_value(
				"Lab Reagent Batch",
				name,
				{
					"verification_status": "Verified",
					"verified_on": now_datetime(),
					"verified_by": frappe.session.user,
				},
				update_modified=False,
			)
			updated += 1
	frappe.db.commit()
	return updated


def map_department_to_discipline(department_or_category):
	text = (department_or_category or "").strip().lower()
	mapping = {
		"biochem": "Clinical Biochemistry",
		"haemat": "Haematology",
		"hemat": "Haematology",
		"patholog": "Clinical Pathology",
		"micro": "Microbiology",
		"serolog": "Serology and Immunology",
		"immuno": "Serology and Immunology",
		"histo": "Histopathology",
		"cyto": "Cytopathology",
		"molecular": "Molecular Diagnostics",
		"genetic": "Genetics",
	}
	for key, val in mapping.items():
		if key in text:
			return val
	return ""


def seed_master_disciplines():
	updated = 0
	for name in frappe.get_all("Diagnostic Test Master", pluck="name"):
		doc = frappe.get_doc("Diagnostic Test Master", name)
		if doc.get("nabl_discipline"):
			continue
		disc = map_department_to_discipline(doc.report_category) or map_department_to_discipline(
			frappe.db.get_value("Clinical Department", doc.department, "department_name") or doc.department
		)
		if not disc:
			continue
		frappe.db.set_value("Diagnostic Test Master", name, "nabl_discipline", disc, update_modified=False)
		# Update child rows via SQL-safe path when columns exist
		if frappe.db.has_column("Diagnostic Test Parameter", "nabl_discipline"):
			for p in doc.parameters or []:
				if p.name and not p.nabl_discipline:
					frappe.db.set_value(
						"Diagnostic Test Parameter",
						p.name,
						"nabl_discipline",
						disc,
						update_modified=False,
					)
		updated += 1
	frappe.db.commit()
	return updated


def sync_calculated_cv_na():
	"""Mark Calculated params with cv_percent=0 (NA conceptually; column is NOT NULL)."""
	if not frappe.db.has_column("Diagnostic Test Parameter", "cv_percent"):
		return 0
	n = 0
	masters = frappe.get_all("Diagnostic Test Master", pluck="name")
	for m in masters:
		doc = frappe.get_doc("Diagnostic Test Master", m)
		for p in doc.parameters or []:
			kind = (p.parameter_kind or "").strip() or ("Calculated" if cint(p.is_calculated) else "Real")
			if kind == "Calculated" and p.name and flt(p.cv_percent or 0) != 0:
				frappe.db.set_value(
					"Diagnostic Test Parameter",
					p.name,
					"cv_percent",
					0,
					update_modified=False,
				)
				n += 1
	frappe.db.commit()
	return n


def export_nabl_scope_rows():
	"""Flat rows matching NABL 112B scope table columns for Desk export."""
	rows = []
	for name in frappe.get_all("Diagnostic Test Master", filters={"disabled": 0}, pluck="name"):
		doc = frappe.get_doc("Diagnostic Test Master", name)
		for p in doc.parameters or []:
			kind = (p.parameter_kind or "").strip() or ("Calculated" if cint(p.is_calculated) else "Real")
			rows.append(
				{
					"discipline": p.nabl_discipline or doc.nabl_discipline or "",
					"test_name": doc.test_name,
					"parameter": p.parameter_name,
					"parameter_code": p.parameter_code or "",
					"specimen": p.specimen_material or "",
					"method": p.method or doc.machine_method or "",
					"amr_min": p.amr_min,
					"amr_max": p.amr_max,
					"cv_percent": "NA" if kind == "Calculated" else p.cv_percent,
					"mu": p.measurement_uncertainty or "",
					"parameter_kind": kind,
				}
			)
	return rows


def setup_phase61():
	ensure_phase61_doctypes()
	ensure_phase61_custom_fields()
	stability = seed_analyte_stability()
	batches = grandfather_existing_batches()
	disc = seed_master_disciplines()
	calc = sync_calculated_cv_na()
	return {
		"ok": True,
		"stability_seeded": stability,
		"stability_count": frappe.db.count("Analyte Stability") if frappe.db.exists("DocType", "Analyte Stability") else 0,
		"batches_grandfathered": batches,
		"masters_disciplined": disc,
		"calculated_cv_cleared": calc,
		"scope_rows": len(export_nabl_scope_rows()),
	}


# ── Whitelisted APIs ─────────────────────────────────────────────────────────


@frappe.whitelist()
def run_phase61_setup():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(setup_phase61())


@frappe.whitelist()
def get_nabl_scope_export():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success({"rows": export_nabl_scope_rows()})


@frappe.whitelist()
def submit_lot_verification(
	new_batch=None,
	old_batch=None,
	assay_type=None,
	outcome=None,
	notes=None,
	parallel_results=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	user = frappe.session.user
	if user == "Guest":
		return _error("Not authenticated", 401)
	new_batch = _parse_request_value("new_batch", new_batch)
	if not new_batch or not frappe.db.exists("Lab Reagent Batch", new_batch):
		return _error("New batch required", 404)
	outcome = (_parse_request_value("outcome", outcome) or "Accepted").strip()
	if outcome not in ("Accepted", "Failed", "Pending"):
		outcome = "Accepted"

	import json

	results = _parse_request_value("parallel_results", parallel_results) or []
	if isinstance(results, str):
		try:
			results = json.loads(results)
		except Exception:
			results = []

	doc = frappe.get_doc(
		{
			"doctype": "Lot Verification",
			"new_batch": new_batch,
			"old_batch": _parse_request_value("old_batch", old_batch) or None,
			"assay_type": _parse_request_value("assay_type", assay_type) or "Chemistry",
			"outcome": outcome,
			"notes": _parse_request_value("notes", notes),
			"verified_by": user,
			"verified_on": now_datetime(),
			"parallel_results": [
				{
					"parameter_name": r.get("parameter_name") or r.get("parameter") or "Check",
					"old_value": r.get("old_value"),
					"new_value": r.get("new_value"),
					"unit": r.get("unit"),
					"accepted": cint(r.get("accepted", 1)),
				}
				for r in (results or [])
			],
		}
	)
	doc.insert(ignore_permissions=True)

	vstatus = "Verified" if outcome == "Accepted" else ("Failed" if outcome == "Failed" else "Pending")
	frappe.db.set_value(
		"Lab Reagent Batch",
		new_batch,
		{
			"verification_status": vstatus,
			"verified_on": now_datetime() if vstatus != "Pending" else None,
			"verified_by": user if vstatus != "Pending" else None,
		},
	)
	frappe.db.commit()
	return _success({"lot_verification": doc.name, "verification_status": vstatus, "batch": new_batch})


@frappe.whitelist()
def record_sample_transport(
	customer_trf=None,
	pack_temp_setpoint_c=None,
	logger_min_c=None,
	logger_max_c=None,
	temp_acceptable=None,
	collected_on=None,
	remarks=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	trf = _parse_request_value("customer_trf", customer_trf)
	if not trf or not frappe.db.exists("Customer TRF", trf):
		return _error("TRF not found", 404)
	franchisee_id = frappe.db.get_value("Customer TRF", trf, "franchisee_id")
	acceptable = cint(_parse_request_value("temp_acceptable", temp_acceptable) if temp_acceptable is not None else 1)
	doc = frappe.get_doc(
		{
			"doctype": "Sample Transport Log",
			"customer_trf": trf,
			"franchisee_id": franchisee_id,
			"collected_on": _parse_request_value("collected_on", collected_on),
			"pack_temp_setpoint_c": _parse_request_value("pack_temp_setpoint_c", pack_temp_setpoint_c),
			"logger_min_c": _parse_request_value("logger_min_c", logger_min_c),
			"logger_max_c": _parse_request_value("logger_max_c", logger_max_c),
			"temp_acceptable": acceptable,
			"received_by": frappe.session.user,
			"received_on": now_datetime(),
			"remarks": _parse_request_value("remarks", remarks),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"transport_log": doc.name, "temp_acceptable": acceptable})


@frappe.whitelist()
def record_sample_rejection(customer_trf=None, reason=None, action_taken=None, notes=None, lab_report=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	trf = _parse_request_value("customer_trf", customer_trf)
	if not trf or not frappe.db.exists("Customer TRF", trf):
		return _error("TRF not found", 404)
	reason = _parse_request_value("reason", reason)
	if not reason:
		return _error("Rejection reason required")
	action = _parse_request_value("action_taken", action_taken) or "Rejected"
	doc = frappe.get_doc(
		{
			"doctype": "Sample Rejection Record",
			"customer_trf": trf,
			"lab_report": _parse_request_value("lab_report", lab_report),
			"reason": reason,
			"action_taken": action,
			"rejected_by": frappe.session.user,
			"rejected_on": now_datetime(),
			"notes": _parse_request_value("notes", notes),
		}
	)
	doc.insert(ignore_permissions=True)
	if action == "Rejected":
		frappe.db.set_value(
			"Customer TRF",
			trf,
			{
				"sample_rejected": 1,
				"sample_rejection_note": f"{reason}: {notes or ''}".strip(": "),
			},
		)
	frappe.db.commit()
	return _success({"rejection": doc.name, "action_taken": action})


@frappe.whitelist()
def check_sample_stability(customer_trf=None, storage="refrigerated"):
	"""Soft warnings when sample age exceeds Analyte Stability windows for ordered Real params."""
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines, find_test_master_for_item
	from frappe.utils import time_diff_in_hours

	trf_name = _parse_request_value("customer_trf", customer_trf)
	if not trf_name or not frappe.db.exists("Customer TRF", trf_name):
		return _error("TRF not found", 404)
	trf = frappe.get_doc("Customer TRF", trf_name)
	collected = getattr(trf, "sample_collected_on", None) or getattr(trf, "modified", None)
	# Prefer Lab Report sample_date
	lr = frappe.db.get_value("Lab Report", {"customer_trf": trf_name}, ["sample_date", "lab_receipt_date"], as_dict=True)
	if lr and lr.sample_date:
		collected = lr.sample_date
	receipt = (lr.lab_receipt_date if lr else None) or now_datetime()
	if not collected:
		return _success({"warnings": [], "age_hours": None})
	age = time_diff_in_hours(receipt, collected)
	storage = (_parse_request_value("storage", storage) or "refrigerated").lower()
	warnings = []
	if not frappe.db.exists("DocType", "Analyte Stability"):
		return _success({"warnings": [], "age_hours": age})
	for line in get_trf_test_lines(trf):
		master = find_test_master_for_item(line["item_code"])
		if not master or not frappe.db.exists("Diagnostic Test Master", master):
			continue
		mdoc = frappe.get_doc("Diagnostic Test Master", master)
		for p in mdoc.parameters or []:
			kind = (p.parameter_kind or "").strip() or ("Calculated" if cint(p.is_calculated) else "Real")
			if kind == "Calculated":
				continue
			code = (p.parameter_code or "").strip()
			rows = frappe.get_all(
				"Analyte Stability",
				filters={"analyte_code": code} if code else {"analyte_name": p.parameter_name},
				fields=["analyte_name", "rt_hours", "refrigerated_hours", "frozen_hours", "specimen_material"],
				limit=1,
			)
			if not rows and p.parameter_name:
				rows = frappe.get_all(
					"Analyte Stability",
					filters={"analyte_name": ("like", f"%{(p.parameter_name or '')[:12]}%")},
					fields=["analyte_name", "rt_hours", "refrigerated_hours", "frozen_hours", "specimen_material"],
					limit=1,
				)
			if not rows:
				continue
			st = rows[0]
			limit = st.refrigerated_hours if "refrig" in storage else st.rt_hours
			if "frozen" in storage:
				limit = st.frozen_hours
			if limit and age > flt(limit):
				warnings.append(
					{
						"parameter": p.parameter_name,
						"age_hours": round(age, 2),
						"limit_hours": limit,
						"storage": storage,
						"specimen": st.specimen_material,
					}
				)
	return _success({"warnings": warnings, "age_hours": round(age, 2) if age is not None else None})


def flt(v):
	from frappe.utils import flt as _flt

	return _flt(v)


@frappe.whitelist()
def evaluate_lab_report_gates(lab_report=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success
	from health_ecosystem_core.health_ecosystem_core.clinical_nabl_release_gates import evaluate_release_gates

	name = _parse_request_value("lab_report", lab_report)
	if not name or not frappe.db.exists("Lab Report", name):
		return _error("Lab Report not found", 404)
	doc = frappe.get_doc("Lab Report", name)
	result = evaluate_release_gates(doc)
	return _success(
		{
			"auto_verified": result["auto_verified"],
			"holds": result["holds"],
			"disciplines": sorted(result["disciplines"]),
		}
	)
