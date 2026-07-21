"""Phase 62 — NABL 112A QC: equipment/calibration (120/126), IQC, EQA, method verification."""

from __future__ import annotations

import os
from statistics import mean, pstdev

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, getdate, now_datetime, today

PHASE62_DOCTYPES = (
	("lab_equipment", "Lab Equipment"),
	("equipment_calibration", "Equipment Calibration"),
	("temperature_log", "Temperature Log"),
	("iqc_run", "IQC Run"),
	("eqa_participation", "EQA Participation"),
	("method_verification", "Method Verification"),
)

EQUIPMENT_SEED = (
	{
		"equipment_name": "Biochemistry Analyzer",
		"asset_tag": "BIO-001",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.3 Monitoring Unit",
		"location": "Biochem Bay",
		"safety_label": "Green",
		"manufacturer": "Demo",
		"model": "ChemAuto-X",
		"serial_no": "BIO-SN-001",
		"calibration_interval_months": 12,
	},
	{
		"equipment_name": "Haematology Analyzer",
		"asset_tag": "HEM-001",
		"equipment_type": "Analyzer",
		"nabl_product_group": "2.7.3 Monitoring Unit",
		"location": "Haematology Bay",
		"safety_label": "Green",
		"manufacturer": "Demo",
		"model": "CellCount-5",
		"serial_no": "HEM-SN-001",
		"calibration_interval_months": 12,
	},
	{
		"equipment_name": "Reagent Refrigerator",
		"asset_tag": "REF-001",
		"equipment_type": "Refrigerator",
		"nabl_product_group": "2.6 Thermal",
		"location": "Store",
		"safety_label": "Green",
		"manufacturer": "Demo",
		"model": "ColdBox-200",
		"serial_no": "REF-SN-001",
		"calibration_interval_months": 12,
	},
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


def ensure_phase62_doctypes():
	for folder, name in PHASE62_DOCTYPES:
		_import_doctype(folder, name, force=True)
	_import_doctype("health_ecosystem_settings", "Health Ecosystem Settings", force=True)


def ensure_phase62_settings_fields():
	"""Add enforcement flags if missing (via DocType reload + defaults)."""
	# Fields live in health_ecosystem_settings.json; force reload already done.
	# Ensure single exists
	if not frappe.db.exists("Health Ecosystem Settings"):
		try:
			frappe.get_doc({"doctype": "Health Ecosystem Settings"}).insert(ignore_permissions=True)
		except Exception:
			pass


def seed_lab_equipment():
	created = []
	for row in EQUIPMENT_SEED:
		existing = frappe.db.exists("Lab Equipment", {"asset_tag": row["asset_tag"]})
		if existing:
			created.append(existing)
			continue
		cal_on = getdate(today())
		due = add_months(cal_on, cint(row.get("calibration_interval_months") or 12))
		doc = frappe.get_doc(
			{
				"doctype": "Lab Equipment",
				**row,
				"status": "In Service",
				"iq_date": cal_on,
				"oq_date": cal_on,
				"pq_date": cal_on,
				"last_calibration_on": cal_on,
				"next_calibration_due": due,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
		# Seed calibration certificate record
		frappe.get_doc(
			{
				"doctype": "Equipment Calibration",
				"equipment": doc.name,
				"calibration_date": cal_on,
				"due_date": due,
				"outcome": "Accepted",
				"calibrating_cab": "Demo NABL Cal Lab",
				"nabl_cert_no": f"NABL-DEMO-{row['asset_tag']}",
				"mu_cmc": "Within acceptance",
				"mu_accepted": 1,
				"notes": "Phase 62 seed",
			}
		).insert(ignore_permissions=True)
	frappe.db.commit()
	return created


def seed_temperature_logs(equipment_names):
	created = 0
	ref = None
	for name in equipment_names:
		etype = frappe.db.get_value("Lab Equipment", name, "equipment_type")
		if etype == "Refrigerator":
			ref = name
			break
	if not ref and equipment_names:
		ref = equipment_names[-1]
	if not ref:
		return 0
	if frappe.get_all("Temperature Log", filters={"equipment": ref, "log_date": today()}, limit=1):
		return 0
	frappe.get_doc(
		{
			"doctype": "Temperature Log",
			"equipment": ref,
			"log_date": today(),
			"temperature_c": 4.2,
			"setpoint_c": 4.0,
			"within_range": 1,
			"recorded_by": frappe.session.user,
			"notes": "Phase 62 seed",
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return 1


def seed_iqc_runs(equipment_names):
	"""Seed L1/L2 Glucose IQC for today on biochem analyzer."""
	bio = None
	for name in equipment_names:
		tag = frappe.db.get_value("Lab Equipment", name, "asset_tag")
		if tag == "BIO-001":
			bio = name
			break
	if not bio and equipment_names:
		bio = equipment_names[0]
	if not bio:
		return 0
	created = 0
	for level, value, mean_v, sd_v in (("1", 98.0, 100.0, 3.0), ("2", 245.0, 250.0, 6.0)):
		exists = frappe.get_all(
			"IQC Run",
			filters={"analyte_code": "GLU", "qc_level": level, "run_date": today(), "equipment": bio},
			limit=1,
		)
		if exists:
			continue
		z = (value - mean_v) / sd_v if sd_v else 0
		outcome = "Accept" if abs(z) <= 2 else "Reject"
		frappe.get_doc(
			{
				"doctype": "IQC Run",
				"equipment": bio,
				"analyte_code": "GLU",
				"analyte_name": "Glucose",
				"qc_level": level,
				"run_date": today(),
				"shift": "Morning",
				"control_lot": "QC-GLU-SEED",
				"result_value": value,
				"lab_mean": mean_v,
				"lab_sd": sd_v,
				"z_score": round(z, 3),
				"outcome": outcome,
				"notes": "Phase 62 seed",
			}
		).insert(ignore_permissions=True)
		created += 1
	frappe.db.commit()
	return created


def seed_eqa_and_method(equipment_names):
	eqa = 0
	mv = 0
	if not frappe.get_all("EQA Participation", filters={"scheme_name": "Demo EQAS Biochem"}, limit=1):
		frappe.get_doc(
			{
				"doctype": "EQA Participation",
				"scheme_name": "Demo EQAS Biochem",
				"discipline": "Clinical Biochemistry",
				"cycle": "2026-Q2",
				"participation_date": today(),
				"score": "Z=0.4",
				"outcome": "Satisfactory",
				"notes": "Phase 62 seed",
			}
		).insert(ignore_permissions=True)
		eqa = 1
	equip = equipment_names[0] if equipment_names else None
	master = frappe.db.get_value("Diagnostic Test Master", {"disabled": 0}, "name")
	if equip and master and not frappe.get_all(
		"Method Verification",
		filters={"equipment": equip, "diagnostic_test": master, "verification_date": today()},
		limit=1,
	):
		frappe.get_doc(
			{
				"doctype": "Method Verification",
				"diagnostic_test": master,
				"equipment": equip,
				"verification_date": today(),
				"trigger_reason": "New Method",
				"outcome": "Pass",
				"accuracy_ok": 1,
				"precision_ok": 1,
				"linearity_ok": 1,
				"amr_ok": 1,
				"carryover_ok": 1,
				"inter_instrument_ok": 1,
				"notes": "Phase 62 seed",
			}
		).insert(ignore_permissions=True)
		mv = 1
	frappe.db.commit()
	return {"eqa": eqa, "method_verification": mv}


def setup_phase62():
	ensure_phase62_doctypes()
	ensure_phase62_settings_fields()
	equip = seed_lab_equipment()
	temp = seed_temperature_logs(equip)
	iqc = seed_iqc_runs(equip)
	extra = seed_eqa_and_method(equip)
	return {
		"ok": True,
		"equipment": equip,
		"equipment_count": frappe.db.count("Lab Equipment"),
		"calibrations": frappe.db.count("Equipment Calibration"),
		"temperature_logs_seeded": temp,
		"iqc_seeded": iqc,
		"iqc_count": frappe.db.count("IQC Run"),
		"eqa_seeded": extra["eqa"],
		"method_verification_seeded": extra["method_verification"],
	}


def smoke_phase62():
	"""Create/verify one of each critical path; return pass/fail details."""
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase62()
	check("setup", setup.get("ok"), str(setup))
	check("lab_equipment_doctype", frappe.db.exists("DocType", "Lab Equipment"))
	check("iqc_doctype", frappe.db.exists("DocType", "IQC Run"))
	check("equipment_rows", frappe.db.count("Lab Equipment") >= 1, f"count={frappe.db.count('Lab Equipment')}")
	check("iqc_rows", frappe.db.count("IQC Run") >= 1, f"count={frappe.db.count('IQC Run')}")
	check("calibration_rows", frappe.db.count("Equipment Calibration") >= 1)
	check("eqa_rows", frappe.db.count("EQA Participation") >= 1)
	check("method_verification_rows", frappe.db.count("Method Verification") >= 1)

	# Today's IQC must be Accept for GLU
	iqc_ok = todays_iqc_status_for_analytes(["GLU", "Glucose"])
	check("todays_iqc_glu_accept", iqc_ok.get("ok"), str(iqc_ok))

	# Overdue equipment list callable
	overdue = list_overdue_equipment()
	check("overdue_list_callable", isinstance(overdue, list), f"overdue={len(overdue)}")

	# LJ series
	lj = get_lj_series("GLU", "1", limit=30)
	check("lj_series", isinstance(lj.get("points"), list), f"points={len(lj.get('points') or [])}")

	return result


def todays_iqc_status_for_analytes(analyte_codes):
	"""Return {ok, rejects, missing} for today's IQC Accept requirement."""
	if not frappe.db.exists("DocType", "IQC Run"):
		return {"ok": True, "rejects": [], "missing": [], "stub": True}
	codes = []
	for c in analyte_codes or []:
		c = (c or "").strip()
		if c and c.upper() not in [x.upper() for x in codes]:
			codes.append(c)
	rejects = []
	missing = []
	for code in codes:
		rows = frappe.get_all(
			"IQC Run",
			filters={"run_date": today(), "analyte_code": code},
			fields=["name", "qc_level", "outcome", "analyte_name"],
		)
		if not rows:
			# try by name
			rows = frappe.get_all(
				"IQC Run",
				filters={"run_date": today(), "analyte_name": ("like", f"%{code}%")},
				fields=["name", "qc_level", "outcome", "analyte_code"],
			)
		if not rows:
			missing.append(code)
			continue
		for r in rows:
			if (r.outcome or "") == "Reject":
				rejects.append(f"{code} L{r.qc_level}: Reject ({r.name})")
	# Soft: missing does not fail unless enforce; rejects always fail when checking
	ok = not rejects
	return {"ok": ok, "rejects": rejects, "missing": missing}


def list_overdue_equipment():
	if not frappe.db.exists("DocType", "Lab Equipment"):
		return []
	rows = frappe.get_all(
		"Lab Equipment",
		filters={"status": "In Service"},
		fields=["name", "equipment_name", "next_calibration_due", "safety_label", "asset_tag"],
	)
	out = []
	today_d = getdate(today())
	for r in rows:
		if r.safety_label == "Out-of-Service":
			out.append({**r, "reason": "Out-of-Service label"})
			continue
		if r.next_calibration_due and getdate(r.next_calibration_due) < today_d:
			out.append({**r, "reason": "Calibration overdue"})
	return out


def get_lj_series(analyte_code, qc_level="1", limit=30):
	points = frappe.get_all(
		"IQC Run",
		filters={"analyte_code": analyte_code, "qc_level": str(qc_level)},
		fields=["run_date", "result_value", "lab_mean", "lab_sd", "z_score", "outcome", "name"],
		order_by="run_date asc",
		limit=cint(limit) or 30,
	)
	values = [flt(p.result_value) for p in points if p.result_value is not None]
	stats = {}
	if len(values) >= 2:
		m = mean(values)
		sd = pstdev(values) if len(values) > 1 else 0
		stats = {"mean": round(m, 4), "sd": round(sd, 4), "cv_percent": round((sd / m) * 100, 2) if m else None}
	elif len(values) == 1:
		stats = {"mean": values[0], "sd": 0, "cv_percent": 0}
	return {"analyte_code": analyte_code, "qc_level": str(qc_level), "points": points, "stats": stats}


def compute_iqc_z(result_value, lab_mean, lab_sd):
	sd = flt(lab_sd)
	if not sd:
		return None
	return round((flt(result_value) - flt(lab_mean)) / sd, 3)


# ── APIs ─────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def run_phase62_setup():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(setup_phase62())


@frappe.whitelist()
def run_phase62_smoke():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(smoke_phase62())


@frappe.whitelist()
def get_qc_dashboard():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	equipment = frappe.get_all(
		"Lab Equipment",
		fields=[
			"name",
			"equipment_name",
			"asset_tag",
			"equipment_type",
			"nabl_product_group",
			"status",
			"safety_label",
			"next_calibration_due",
			"location",
		],
		order_by="equipment_name asc",
		limit=100,
	)
	iqc_today = frappe.get_all(
		"IQC Run",
		filters={"run_date": today()},
		fields=["name", "analyte_code", "analyte_name", "qc_level", "result_value", "outcome", "equipment"],
		order_by="creation desc",
		limit=50,
	)
	eqa = frappe.get_all(
		"EQA Participation",
		fields=["name", "scheme_name", "discipline", "cycle", "outcome", "participation_date", "score"],
		order_by="participation_date desc",
		limit=20,
	)
	return _success(
		{
			"equipment": equipment,
			"overdue": list_overdue_equipment(),
			"iqc_today": iqc_today,
			"eqa": eqa,
			"counts": {
				"equipment": frappe.db.count("Lab Equipment"),
				"iqc": frappe.db.count("IQC Run"),
				"eqa": frappe.db.count("EQA Participation"),
				"calibrations": frappe.db.count("Equipment Calibration"),
			},
		}
	)


@frappe.whitelist()
def submit_iqc_run(
	analyte_code=None,
	analyte_name=None,
	qc_level=None,
	result_value=None,
	equipment=None,
	lab_mean=None,
	lab_sd=None,
	control_lot=None,
	shift=None,
	notes=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	analyte_code = _parse_request_value("analyte_code", analyte_code)
	result_value = _parse_request_value("result_value", result_value)
	if not analyte_code or result_value is None:
		return _error("analyte_code and result_value required")
	lab_mean = flt(_parse_request_value("lab_mean", lab_mean) or 0) or None
	lab_sd = flt(_parse_request_value("lab_sd", lab_sd) or 0) or None
	z = compute_iqc_z(result_value, lab_mean, lab_sd) if lab_mean is not None and lab_sd else None
	outcome = "Accept"
	if z is not None and abs(z) > 3:
		outcome = "Reject"
	elif z is not None and abs(z) > 2:
		outcome = "Warning"
	doc = frappe.get_doc(
		{
			"doctype": "IQC Run",
			"equipment": _parse_request_value("equipment", equipment),
			"analyte_code": analyte_code,
			"analyte_name": _parse_request_value("analyte_name", analyte_name) or analyte_code,
			"qc_level": str(_parse_request_value("qc_level", qc_level) or "1"),
			"run_date": today(),
			"shift": _parse_request_value("shift", shift) or "Morning",
			"control_lot": _parse_request_value("control_lot", control_lot),
			"result_value": flt(result_value),
			"lab_mean": lab_mean,
			"lab_sd": lab_sd,
			"z_score": z,
			"outcome": outcome,
			"notes": _parse_request_value("notes", notes),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"iqc_run": doc.name, "outcome": outcome, "z_score": z})


@frappe.whitelist()
def get_iqc_lj_chart(analyte_code=None, qc_level=None, limit=30):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	analyte_code = _parse_request_value("analyte_code", analyte_code)
	if not analyte_code:
		return _error("analyte_code required")
	return _success(
		get_lj_series(
			analyte_code,
			_parse_request_value("qc_level", qc_level) or "1",
			_parse_request_value("limit", limit) or 30,
		)
	)


@frappe.whitelist()
def record_temperature_log(equipment=None, temperature_c=None, setpoint_c=None, within_range=None, notes=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	equipment = _parse_request_value("equipment", equipment)
	temperature_c = _parse_request_value("temperature_c", temperature_c)
	if not equipment or temperature_c is None:
		return _error("equipment and temperature_c required")
	doc = frappe.get_doc(
		{
			"doctype": "Temperature Log",
			"equipment": equipment,
			"log_date": today(),
			"temperature_c": flt(temperature_c),
			"setpoint_c": flt(_parse_request_value("setpoint_c", setpoint_c) or 0) or None,
			"within_range": cint(
				_parse_request_value("within_range", within_range) if within_range is not None else 1
			),
			"recorded_by": frappe.session.user,
			"notes": _parse_request_value("notes", notes),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"temperature_log": doc.name})
