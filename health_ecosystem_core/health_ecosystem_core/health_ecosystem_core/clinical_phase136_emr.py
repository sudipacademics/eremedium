"""Phase 136 — cross-vertical EMR aggregation for the patient vault (feeds clinical_emr.EMR Record).

Sources (all idempotent upserts keyed on the source document):
- Lab Report once Authorized / Printed: patient from Customer TRF.health_patient, the TRF's Unique Patient ID or the
  care journey; summary_json carries the discrete analytes (name, value, numeric value + qualifier, unit, reference
  low / high, flag) and each analyte is also an EMR Analyte Point for trends and goal feeds. The authorized PDF is
  served through vault_record_file (permission-checked). authorize_lab_report updates the Lab Report with
  frappe.db.set_value (no doc events), so the journey hook queues a sync after commit and a */15 job sweeps recently
  modified reports as a backstop.
- Submitted Clinical Prescriptions (Uber Doc mirrors are skipped: the signed e-Rx is already its own record), signed
  Uber Doc Digital Prescriptions (pushed by clinical_phase135_ud_rx; the backfill only re-pushes any that lack one),
  Patient Vital Log rows, final Clinical Encounters and the patient's own uploads (private files).

Numeric parsing is deliberately conservative: "<5", "> 1000", "5.2 H", "1,50,000" parse; ranges, decimal commas and
free text stay text-only. Analyte keys are a slug of the parameter name, with a short alias list for the analytes the
goal tracker and tips use (fasting glucose, HbA1c, lipids, haemoglobin, vitamin D / B12, TSH).
"""

from __future__ import annotations

import base64
import json
import re
from collections import Counter
from typing import NoReturn

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.clinical_emr import EMR_DT, timeline_query, upsert_emr_record
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	PATIENT_DT,
	UPI_FIELD,
	_ensure_doctype,
	_perms,
	_sel,
	patient_for_uid,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr"
POINT_DT = "EMR Analyte Point"
LAB_DT = "Lab Report"
PARAM_DT = "Lab Report Parameter"
TRF_DT = "Customer TRF"
JOURNEY_DT = "Patient Care Journey"
CP_DT = "Clinical Prescription"
RX_DT = "Digital Prescription"
VITAL_DT = "Patient Vital Log"
ENCOUNTER_DT = "Clinical Encounter"

AUTH_STATUSES = ("Authorized", "Printed")
JOURNEY_AUTH = ("Authorized", "Dispatched")
CP_STATUSES = ("Submitted", "Dispensed")
SKIP_INPUT_TYPES = ("Heading", "Spacer")
FLAGS = ("N", "H", "L", "C")
FLAG_MAP = {"N": "N", "H": "H", "L": "L", "CRITICAL": "C", "C": "C"}
INLINE_FLAGS = {"H": "H", "HIGH": "H", "L": "L", "LOW": "L", "HH": "C", "LL": "C", "CRITICAL": "C", "CRIT": "C"}
UPLOAD_TYPES = ("Patient Upload", "Lab Report", "Prescription", "Imaging", "Discharge", "Vaccination")
UPLOAD_EXTS = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
VITAL_LABELS = {
	"glucose": ("Blood glucose", "mg/dL"),
	"bp_systolic": ("BP systolic", "mmHg"),
	"bp_diastolic": ("BP diastolic", "mmHg"),
	"weight": ("Weight", "kg"),
	"spo2": ("SpO2", "%"),
	"hba1c": ("HbA1c", "%"),
	"other": ("Vital", ""),
}
SWEEP_HOURS = 3
SWEEP_LIMIT = 300
BACKFILL_BATCH = 200

_NUM_RE = re.compile(r"^(?P<q><=|>=|<|>)?\s*(?P<n>[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)\s*(?P<rest>.*)$")
_GROUPED_RE = re.compile(r"[-+]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?")
_RANGE_RE = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?)\s*(?:-|to)\s*([-+]?\d+(?:\.\d+)?)\s*[^\d]*$", re.I)
_UPPER_RE = re.compile(r"^\s*(?:<=|<|up\s*to|upto|below|less\s+than)\s*(\d+(?:\.\d+)?)\s*[^\d]*$", re.I)
_LOWER_RE = re.compile(r"^\s*(?:>=|>|above|more\s+than|greater\s+than)\s*(\d+(?:\.\d+)?)\s*[^\d]*$", re.I)


def _fail(message) -> NoReturn:
	raise frappe.ValidationError(message)


def _missing(message) -> NoReturn:
	raise frappe.DoesNotExistError(message)


def _has_field(doctype, fieldname):
	try:
		return bool(frappe.db.exists("DocType", doctype)) and frappe.get_meta(doctype).has_field(fieldname)
	except Exception:
		return False


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	return [
		(
			POINT_DT,
			[
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "emr_record", "label": "EMR Record", "fieldtype": "Link", "options": EMR_DT, "reqd": 1, "search_index": 1},
				{"fieldname": "analyte_key", "label": "Analyte Key", "fieldtype": "Data", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "analyte_name", "label": "Analyte", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "test_name", "label": "Test", "fieldtype": "Data"},
				{"fieldname": "observed_on", "label": "Observed On", "fieldtype": "Date", "in_list_view": 1, "search_index": 1},
				{"fieldname": "value_text", "label": "Result", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "value_num", "label": "Numeric Value", "fieldtype": "Float", "precision": "4"},
				{"fieldname": "has_num", "label": "Has Numeric Value", "fieldtype": "Check", "default": "0"},
				{"fieldname": "qualifier", "label": "Qualifier", "fieldtype": "Data", "length": 4},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data"},
				{"fieldname": "ref_low", "label": "Reference Low", "fieldtype": "Float", "precision": "4"},
				{"fieldname": "has_ref_low", "label": "Has Reference Low", "fieldtype": "Check", "default": "0"},
				{"fieldname": "ref_high", "label": "Reference High", "fieldtype": "Float", "precision": "4"},
				{"fieldname": "has_ref_high", "label": "Has Reference High", "fieldtype": "Check", "default": "0"},
				{"fieldname": "ref_label", "label": "Reference Range", "fieldtype": "Data"},
				{"fieldname": "flag", "label": "Flag", "fieldtype": "Select", "options": "\n" + _sel(FLAGS), "in_list_view": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Data", "read_only": 1, "search_index": 1},
			],
			_perms((), managers),
			{"in_create": 1, "sort_field": "observed_on", "sort_order": "DESC"},
		),
	]


def ensure_emr_vault_setup():
	from health_ecosystem_core.health_ecosystem_core.clinical_emr import ensure_emr_setup

	created = ensure_emr_setup()
	for name, fields, perms, extra in _doctype_specs():
		if _ensure_doctype(name, fields, perms, extra=extra):
			created.append(name)
	return created


# ---------------------------------------------------------------------------
# Analytes
# ---------------------------------------------------------------------------


def parse_result(text):
	"""(value, qualifier, inline_flag) for a printed result; value None when it is not a single plain number."""
	t = cstr(text).strip().replace("\u2264", "<=").replace("\u2265", ">=")
	if not t:
		return None, None, None
	m = _NUM_RE.match(t)
	if not m:
		return None, None, None
	num = m.group("n")
	if "," in num:
		if not _GROUPED_RE.fullmatch(num):
			return None, None, None
		num = num.replace(",", "")
	flag = None
	rest = m.group("rest").strip()
	if rest:
		tokens = [tok for tok in re.split(r"[\s()\[\]]+", rest.upper()) if tok]
		if any(re.search(r"\d", tok) or tok.startswith(",") for tok in tokens):
			return None, None, None
		for tok in tokens:
			if tok in INLINE_FLAGS:
				flag = INLINE_FLAGS[tok]
	try:
		value = float(num)
	except ValueError:
		return None, None, None
	return value, m.group("q") or None, flag


def parse_range_label(label):
	t = cstr(label).strip().replace("\u2013", "-").replace("\u2014", "-")
	if not t:
		return None, None
	m = _RANGE_RE.match(t)
	if m:
		lo, hi = float(m.group(1)), float(m.group(2))
		return (lo, hi) if lo <= hi else (None, None)
	m = _UPPER_RE.match(t)
	if m:
		return None, float(m.group(1))
	m = _LOWER_RE.match(t)
	if m:
		return float(m.group(1)), None
	return None, None


def reference_band(lower, upper, label):
	"""Float empties read back as 0, so 0 / 0 means "not set"; 0 - x is a real band; x / 0 means a lower bound only."""
	lo, hi = flt(lower), flt(upper)
	if hi > 0 and lo <= hi:
		return lo, hi
	if lo > 0 and not hi:
		return lo, None
	return parse_range_label(label)


def compute_flag(value, qualifier, lo, hi):
	if value is None or (lo is None and hi is None):
		return None
	if lo is not None and (value < lo or (qualifier in ("<", "<=") and value <= lo)):
		return "L"
	if hi is not None and (value > hi or (qualifier in (">", ">=") and value >= hi)):
		return "H"
	return "N"


def analyte_key(name, code=None):
	tokens = re.findall(r"[a-z0-9]+", cstr(name).lower())
	t = set(tokens)
	if not tokens:
		return re.sub(r"[^a-z0-9]+", "_", cstr(code).lower()).strip("_")[:80] or "unnamed"
	if "ratio" not in t and "index" not in t:
		if "hba1c" in t or "a1c" in t or ({"glycated", "glycosylated"} & t and {"haemoglobin", "hemoglobin", "hb"} & t):
			return "hba1c"
		glucose = bool({"glucose", "sugar"} & t)
		if not {"insulin", "urine", "average", "eag", "estimated", "c", "peptide"} & t:
			if {"fbs", "fbg", "fpg"} & t or (glucose and "fasting" in t and not {"post", "pp", "prandial", "random", "ppbs", "rbs"} & t):
				return "glucose_fasting"
			if "ppbs" in t or (glucose and {"pp", "prandial", "post"} & t):
				return "glucose_pp"
			if "rbs" in t or (glucose and "random" in t):
				return "glucose_random"
		if "cholesterol" in t and not {"ldl", "hdl", "vldl", "non"} & t and ("total" in t or t <= {"cholesterol", "serum", "s"}):
			return "cholesterol_total"
		if "ldl" in t and "vldl" not in t:
			return "ldl_cholesterol"
		if "hdl" in t and "non" not in t:
			return "hdl_cholesterol"
		if {"triglyceride", "triglycerides"} & t:
			return "triglycerides"
		if "vitamin" in t and ({"d", "d3", "25", "hydroxy"} & t):
			return "vitamin_d"
		if "vitamin" in t and "b12" in t:
			return "vitamin_b12"
		if "tsh" in t:
			return "tsh"
		if ({"haemoglobin", "hemoglobin"} & t or tokens in (["hb"], ["hgb"])) and not {"glycated", "glycosylated", "a1c", "mean", "corpuscular", "mch", "mchc"} & t:
			return "haemoglobin"
	return "_".join(tokens)[:80]


def build_analytes(params):
	out = []
	for p in params:
		if p.get("include_in_report") in (0, "0"):
			continue
		if cstr(p.get("result_input_type")) in SKIP_INPUT_TYPES:
			continue
		text = cstr(p.get("result_value")).strip()
		name = cstr(p.get("description") or p.get("test_name")).strip()
		if not text or not name:
			continue
		value, qualifier, inline = parse_result(text)
		lo, hi = reference_band(p.get("lower_range"), p.get("upper_range"), p.get("reference_range_label"))
		flag = FLAG_MAP.get(cstr(p.get("abnormal_flag")).strip().upper()) or inline or compute_flag(value, qualifier, lo, hi)
		out.append(
			{
				"key": analyte_key(name, p.get("parameter_code")),
				"name": name[:140],
				"test": cstr(p.get("test_name")).strip()[:140] or None,
				"value": text[:140],
				"value_num": value,
				"qualifier": qualifier,
				"unit": cstr(p.get("unit")).strip()[:40] or None,
				"ref_low": lo,
				"ref_high": hi,
				"ref_label": cstr(p.get("reference_range_label")).strip()[:140] or None,
				"flag": flag,
			}
		)
	return out


def write_points(record, patient, analytes, observed_on, source_doctype, source_name):
	frappe.db.delete(POINT_DT, {"emr_record": record})
	for a in analytes:
		frappe.get_doc(
			{
				"doctype": POINT_DT,
				"patient": patient,
				"emr_record": record,
				"analyte_key": a["key"],
				"analyte_name": a["name"],
				"test_name": a.get("test"),
				"observed_on": observed_on,
				"value_text": a.get("value"),
				"value_num": a["value_num"] if a.get("value_num") is not None else 0,
				"has_num": 1 if a.get("value_num") is not None else 0,
				"qualifier": a.get("qualifier"),
				"unit": a.get("unit"),
				"ref_low": a["ref_low"] if a.get("ref_low") is not None else 0,
				"has_ref_low": 1 if a.get("ref_low") is not None else 0,
				"ref_high": a["ref_high"] if a.get("ref_high") is not None else 0,
				"has_ref_high": 1 if a.get("ref_high") is not None else 0,
				"ref_label": a.get("ref_label"),
				"flag": a.get("flag") or None,
				"source_doctype": source_doctype,
				"source_name": source_name,
			}
		).insert(ignore_permissions=True)
	return len(analytes)


# ---------------------------------------------------------------------------
# Lab reports
# ---------------------------------------------------------------------------


def _trf_row(trf):
	if not trf or not frappe.db.exists(TRF_DT, trf):
		return {}
	meta = frappe.get_meta(TRF_DT)
	fields = [f for f in ("health_patient", "patient", UPI_FIELD, "care_journey", "test_required") if meta.has_field(f)]
	return frappe.db.get_value(TRF_DT, trf, fields, as_dict=True) or {}


def _journey_for(lab_row, trf_row):
	journey = lab_row.get("care_journey") or trf_row.get("care_journey")
	if journey and frappe.db.exists(JOURNEY_DT, journey):
		return journey
	if lab_row.get("customer_trf"):
		return frappe.db.get_value(JOURNEY_DT, {"customer_trf": lab_row["customer_trf"]}, "name", order_by="creation desc")
	return None


def lab_patient(lab_row, trf_row=None, journey=None):
	trf_row = trf_row if trf_row is not None else _trf_row(lab_row.get("customer_trf"))
	for field in ("health_patient", "patient"):
		pid = trf_row.get(field)
		if pid and frappe.db.exists(PATIENT_DT, pid):
			return pid
	if trf_row.get(UPI_FIELD):
		pid = patient_for_uid(trf_row.get(UPI_FIELD))
		if pid:
			return pid
	journey = journey or _journey_for(lab_row, trf_row)
	if journey:
		pid = frappe.db.get_value(JOURNEY_DT, journey, "patient")
		if pid and frappe.db.exists(PATIENT_DT, pid):
			return pid
	return None


LAB_FIELDS = ["name", "customer_trf", "care_journey", "report_status", "department", "report_no", "lab_no", "sample_date", "report_date", "printed_on", "report_title_1", "modified"]
PARAM_FIELDS = ["description", "result_value", "unit", "lower_range", "upper_range", "reference_range_label", "abnormal_flag", "result_input_type", "include_in_report", "test_name", "parameter_code", "idx"]


def sync_lab_report(name, push=True):
	"""Authorized / Printed Lab Report -> EMR Record (+ analyte points + goal feeds). Idempotent."""
	lab = frappe.db.get_value(LAB_DT, name, LAB_FIELDS, as_dict=True)
	if not lab:
		return {"skipped": "missing"}
	if lab.report_status not in AUTH_STATUSES:
		return {"skipped": f"report is {lab.report_status or 'draft'}"}
	trf_row = _trf_row(lab.customer_trf)
	journey = _journey_for(lab, trf_row)
	patient = lab_patient(lab, trf_row, journey)
	if not patient:
		return {"skipped": "no patient linked"}
	params = frappe.get_all(PARAM_DT, filters={"parent": name, "parenttype": LAB_DT}, fields=PARAM_FIELDS, order_by="idx asc", limit=0)
	analytes = build_analytes(params)
	tests = list(dict.fromkeys(a["test"] for a in analytes if a.get("test")))
	record_date = getdate(lab.report_date or lab.printed_on or lab.sample_date or now_datetime())
	file_url = frappe.db.get_value(JOURNEY_DT, journey, "report_pdf") if journey else None
	label = ", ".join(tests[:3]) or lab.report_title_1 or lab.department or _("Lab report")
	summary = {
		"schema": "remedium.lab.v1",
		"lab_report": lab.name,
		"customer_trf": lab.customer_trf,
		"care_journey": journey,
		"report_no": lab.report_no or lab.lab_no,
		"department": lab.department,
		"sample_date": cstr(lab.sample_date) or None,
		"report_date": cstr(lab.report_date) or None,
		"tests": tests,
		"analytes": analytes,
		"abnormal_count": sum(1 for a in analytes if a.get("flag") in ("H", "L", "C")),
	}
	res = upsert_emr_record(LAB_DT, name, "Lab Report", "Remedium Lab", patient=patient, title=f"Lab report — {label}"[:140], record_date=record_date, summary=summary, file_url=file_url or None, push=push)
	if res.get("changed") or not frappe.db.exists(POINT_DT, {"emr_record": res["name"]}):
		write_points(res["name"], patient, analytes, record_date, LAB_DT, name)
		from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import feed_goals_from_analytes

		feed_goals_from_analytes(patient, res["name"])
	return res


def _queue_lab_sync(name):
	if frappe.flags.vault_inline_sync:
		return sync_lab_report(name)
	frappe.enqueue(f"{MODULE_PATH}.vault_sync_lab_report_job", queue="short", enqueue_after_commit=True, lab_report=name)
	return {"queued": name}


def vault_sync_lab_report_job(lab_report=None):
	try:
		sync_lab_report(lab_report)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase136 lab report EMR sync", message=f"{lab_report}\n{frappe.get_traceback()}")


def on_lab_report_update(doc, method=None):
	try:
		if doc.report_status in AUTH_STATUSES:
			_queue_lab_sync(doc.name)
	except Exception:
		frappe.log_error(title="phase136 lab report hook", message=frappe.get_traceback())


def on_journey_update(doc, method=None):
	try:
		if doc.status in JOURNEY_AUTH and doc.customer_trf and frappe.db.exists("DocType", LAB_DT):
			name = frappe.db.get_value(LAB_DT, {"customer_trf": doc.customer_trf}, "name")
			if name:
				_queue_lab_sync(name)
	except Exception:
		frappe.log_error(title="phase136 journey hook", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# Prescriptions, vitals, encounters
# ---------------------------------------------------------------------------


def _doctor_name(doctor):
	if not doctor or not frappe.db.exists("Doctor", doctor):
		return doctor
	for field in ("doctor_name", "full_name", "practitioner_name"):
		if _has_field("Doctor", field):
			value = frappe.db.get_value("Doctor", doctor, field)
			if value:
				return value
	return doctor


def _plain(value, limit=1000):
	text = re.sub(r"<[^>]+>", " ", cstr(value))
	return re.sub(r"\s+", " ", text).strip()[:limit] or None


def sync_clinical_prescription(name, push=True):
	cp = frappe.get_doc(CP_DT, name)
	if cp.get("digital_prescription"):
		return {"skipped": "Uber Doc mirror (the signed e-Rx is its own record)"}
	exists = frappe.db.exists(EMR_DT, {"source_key": f"{CP_DT}::{name}"})
	if cp.status not in CP_STATUSES and not (cp.status == "Cancelled" and exists):
		return {"skipped": f"status {cp.status}"}
	if not cp.patient or not frappe.db.exists(PATIENT_DT, cp.patient):
		return {"skipped": "no patient"}
	doctor = _doctor_name(cp.doctor)
	meds = []
	for m in cp.get("medicines") or []:
		drug = frappe.db.get_value("Item", m.medicine_item, "item_name") if m.get("medicine_item") else None
		meds.append(
			{"drug": drug or m.get("medicine_item"), "item_code": m.get("medicine_item"), "salt": m.get("salt"), "dosage": m.get("dosage"), "frequency": m.get("frequency"), "duration": m.get("duration"), "route": m.get("route"), "instructions": m.get("instructions")}
		)
	tests = [{"diagnostic_test": t.get("diagnostic_test"), "item_code": t.get("item"), "notes": t.get("notes")} for t in cp.get("diagnostics") or []]
	summary = {
		"schema": "remedium.rx.v1",
		"prescription": cp.name,
		"status": cp.status,
		"doctor": doctor,
		"encounter_date": cstr(cp.encounter_date) or None,
		"diagnosis": _plain(cp.diagnosis, 500),
		"notes": _plain(cp.clinical_notes),
		"medications": meds,
		"tests": tests,
	}
	title = f"Prescription — {doctor or _('Remedium doctor')}" + (" (cancelled)" if cp.status == "Cancelled" else "")
	return upsert_emr_record(CP_DT, name, "Prescription", "Polyclinic", patient=cp.patient, title=title[:140], record_date=cp.encounter_date or getdate(cp.creation), summary=summary, push=push)


def on_clinical_prescription_update(doc, method=None):
	try:
		if doc.get("digital_prescription"):
			return
		sync_clinical_prescription(doc.name)
		from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import sync_cp_schedules

		sync_cp_schedules(doc.name)
	except Exception:
		frappe.log_error(title="phase136 Clinical Prescription hook", message=frappe.get_traceback())


def _vital_app(row):
	if cstr(row.notes).startswith("Uber Doc"):
		return "Uber Doc"
	if row.source == "lab":
		return "Remedium Lab"
	if row.source == "device":
		return "Patient"
	return "Polyclinic"


def sync_vital(name, push=True):
	row = frappe.db.get_value(VITAL_DT, name, ["name", "patient", "vital_type", "value", "unit", "source", "recorded_at", "out_of_range", "notes", "creation"], as_dict=True)
	if not row or not row.patient or not frappe.db.exists(PATIENT_DT, row.patient):
		return {"skipped": "no patient"}
	if not flt(row.value):
		return {"skipped": "no value"}
	label, unit = VITAL_LABELS.get(row.vital_type, VITAL_LABELS["other"])
	unit = row.unit or unit
	when = row.recorded_at or row.creation
	summary = {
		"schema": "remedium.vital.v1",
		"vital_type": row.vital_type,
		"label": label,
		"value": flt(row.value, 2),
		"unit": unit,
		"recorded_at": cstr(when),
		"out_of_range": cint(row.out_of_range),
		"source": row.source,
	}
	return upsert_emr_record(VITAL_DT, name, "Vital", _vital_app(row), patient=row.patient, title=f"{label} {flt(row.value, 2):g} {unit}".strip()[:140], record_date=getdate(when), summary=summary, push=push)


def on_vital_log_insert(doc, method=None):
	try:
		sync_vital(doc.name)
		from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import feed_goals_from_vital

		feed_goals_from_vital(doc.name)
	except Exception:
		frappe.log_error(title="phase136 vital hook", message=frappe.get_traceback())


def sync_encounter(name, push=True):
	if not frappe.db.exists("DocType", ENCOUNTER_DT):
		return {"skipped": "not installed"}
	doc = frappe.get_doc(ENCOUNTER_DT, name)
	if doc.status != "Final" or not doc.patient or not frappe.db.exists(PATIENT_DT, doc.patient):
		return {"skipped": "not final"}
	vitals = {}
	try:
		raw = json.loads(doc.vitals_json) if doc.vitals_json else {}
		if isinstance(raw, dict):
			vitals = {cstr(k)[:40]: v for k, v in raw.items() if isinstance(v, (int, float, str)) and cstr(v).strip()}
	except ValueError:
		vitals = {}
	doctor = _doctor_name(doc.doctor)
	summary = {
		"schema": "remedium.encounter.v1",
		"encounter": doc.name,
		"doctor": doctor,
		"encounter_datetime": cstr(doc.encounter_datetime) or None,
		"chief_complaint": _plain(doc.chief_complaint, 500),
		"assessment": _plain(doc.assessment, 500),
		"diagnosis": _plain(doc.diagnosis, 500),
		"vitals": vitals,
	}
	return upsert_emr_record(ENCOUNTER_DT, name, "Encounter", "Polyclinic", patient=doc.patient, title=f"Consultation — {doctor or _('Remedium doctor')}"[:140], record_date=getdate(doc.encounter_datetime or doc.creation), summary=summary, push=push)


def on_encounter_update(doc, method=None):
	try:
		if doc.status == "Final":
			sync_encounter(doc.name)
	except Exception:
		frappe.log_error(title="phase136 encounter hook", message=frappe.get_traceback())


def ensure_rx_emr(name):
	"""Signed / cancelled Uber Doc e-Rx without an EMR Record (pushed at signing; this only repairs gaps)."""
	row = frappe.db.get_value(RX_DT, name, ["status", "emr_record", "patient", UPI_FIELD], as_dict=True)
	if not row or row.status not in ("Signed", "Cancelled") or (row.emr_record and frappe.db.exists(EMR_DT, row.emr_record)):
		return None
	if not row.patient and not row.get(UPI_FIELD):
		return None
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx import push_emr

	return push_emr(name)


# ---------------------------------------------------------------------------
# Backfill and sweep
# ---------------------------------------------------------------------------


def _missing_sources(doctype, filters):
	if not frappe.db.exists("DocType", doctype):
		return []
	names = frappe.get_all(doctype, filters=filters, pluck="name", order_by="creation asc", limit=0)
	have = set(frappe.get_all(EMR_DT, filters={"source_doctype": doctype}, pluck="source_name", limit=0))
	return [n for n in names if n not in have]


def _run_batch(names, fn, label, report):
	done = 0
	for i, name in enumerate(names, start=1):
		frappe.db.savepoint("vault_emr_row")
		try:
			res = fn(name)
			if isinstance(res, dict) and res.get("name"):
				done += 1
		except Exception:
			frappe.db.rollback(save_point="vault_emr_row")
			report["errors"] += 1
			frappe.log_error(title=f"phase136 EMR backfill {label}", message=f"{name}\n{frappe.get_traceback()}")
		if i % BACKFILL_BATCH == 0:
			frappe.db.commit()
	frappe.db.commit()
	report[label] = done


def backfill_emr():
	"""Historic records only, without webhooks (push=False); live hooks push as usual. Safe to re-run."""
	report = {"errors": 0}
	_run_batch(_missing_sources(LAB_DT, {"report_status": ("in", AUTH_STATUSES)}), lambda n: sync_lab_report(n, push=False), "lab_reports", report)
	cp_filters = {"status": ("in", CP_STATUSES)}
	if _has_field(CP_DT, "digital_prescription"):
		cp_filters["digital_prescription"] = ("is", "not set")
	_run_batch(_missing_sources(CP_DT, cp_filters), lambda n: sync_clinical_prescription(n, push=False), "clinical_prescriptions", report)
	_run_batch(_missing_sources(VITAL_DT, {}), lambda n: sync_vital(n, push=False), "vitals", report)
	_run_batch(_missing_sources(ENCOUNTER_DT, {"status": "Final"}), lambda n: sync_encounter(n, push=False), "encounters", report)
	rx = []
	if frappe.db.exists("DocType", RX_DT):
		rx = frappe.get_all(RX_DT, filters={"status": ("in", ("Signed", "Cancelled"))}, pluck="name", limit=0)
	_run_batch(rx, ensure_rx_emr, "uberdoc_rx_repaired", report)
	report["points"] = frappe.db.count(POINT_DT) if frappe.db.exists("DocType", POINT_DT) else 0
	return report


def vault_sync_recent(hours=SWEEP_HOURS):
	"""Every 15 minutes: reports authorized through db.set_value (no doc events) and prescriptions saved the same way."""
	if not frappe.db.exists("DocType", POINT_DT):
		return {"skipped": "not installed"}
	since = add_to_date(now_datetime(), hours=-cint(hours or SWEEP_HOURS))
	report = {"lab_reports": 0, "clinical_prescriptions": 0, "errors": 0}
	labs = frappe.get_all(LAB_DT, filters={"report_status": ("in", AUTH_STATUSES), "modified": (">=", since)}, pluck="name", limit=SWEEP_LIMIT)
	for name in labs:
		try:
			res = sync_lab_report(name)
			frappe.db.commit()
			if res.get("changed"):
				report["lab_reports"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase136 EMR sweep", message=f"{name}\n{frappe.get_traceback()}")
	cp_filters = {"status": ("in", CP_STATUSES), "modified": (">=", since)}
	if _has_field(CP_DT, "digital_prescription"):
		cp_filters["digital_prescription"] = ("is", "not set")
	for name in frappe.get_all(CP_DT, filters=cp_filters, pluck="name", limit=SWEEP_LIMIT):
		try:
			res = sync_clinical_prescription(name)
			from health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle import sync_cp_schedules

			sync_cp_schedules(name)
			frappe.db.commit()
			if res.get("changed"):
				report["clinical_prescriptions"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase136 EMR sweep", message=f"{name}\n{frappe.get_traceback()}")
	return report


# ---------------------------------------------------------------------------
# Timeline, records, files, trends, uploads (scoped by clinical_phase136_patient_iam)
# ---------------------------------------------------------------------------


def _summary(row):
	try:
		return json.loads(row.summary_json or "{}")
	except ValueError:
		return {}


def brief(record_type, summary):
	if record_type == "Lab Report" and summary.get("schema") == "remedium.lab.v1":
		return {"tests": (summary.get("tests") or [])[:4], "analytes": len(summary.get("analytes") or []), "abnormal": cint(summary.get("abnormal_count"))}
	if record_type == "Prescription":
		meds = summary.get("medications") or []
		provider = (summary.get("provider") or {}).get("name") if isinstance(summary.get("provider"), dict) else summary.get("doctor")
		return {"medications": len(meds), "provider": provider, "status": summary.get("status")}
	if record_type == "Vital":
		return {"label": summary.get("label"), "value": summary.get("value"), "unit": summary.get("unit"), "out_of_range": summary.get("out_of_range")}
	if record_type == "Encounter":
		return {"doctor": summary.get("doctor"), "diagnosis": summary.get("diagnosis")}
	if summary.get("schema") == "remedium.upload.v1":
		return {"filename": summary.get("filename"), "uploaded": True}
	return {}


ROW_FIELDS = ["name", "patient", "patient_name", "record_type", "source_app", "source_doctype", "source_name", "title", "record_date", "file", "summary_json", "version", "creation"]


def record_row(row, full=False):
	summary = _summary(row)
	out = {
		"name": row.name,
		"patient": row.patient,
		"patient_name": row.patient_name,
		"record_type": row.record_type,
		"source_app": row.source_app,
		"source_doctype": row.source_doctype,
		"title": row.title,
		"record_date": cstr(row.record_date) or None,
		"has_file": bool(row.file) or row.source_doctype in (LAB_DT, CP_DT, RX_DT),
		"deletable": row.source_app == "Patient" and row.source_doctype == "File",
		"brief": brief(row.record_type, summary),
		"version": cint(row.version),
	}
	if full:
		out["summary"] = summary
	return out


def timeline(patients, filters=None, page=1, page_size=30):
	f = filters or {}
	types = f.get("record_types") or ([f["record_type"]] if f.get("record_type") else [])
	apps = f.get("source_apps") or ([f["source_app"]] if f.get("source_app") else [])
	names, total = timeline_query(patients, types, apps, f.get("date_from") or None, f.get("date_to") or None, page, page_size)
	rows = frappe.get_all(EMR_DT, filters={"name": ("in", names or [""])}, fields=ROW_FIELDS, limit=0)
	order = {n: i for i, n in enumerate(names)}
	rows.sort(key=lambda r: order.get(r.name, 0))
	return {"rows": [record_row(r) for r in rows], "total": total, "page": max(cint(page) or 1, 1), "page_size": min(max(cint(page_size) or 30, 1), 100)}


def recent_records(patient, limit=4):
	return timeline([patient], {}, 1, limit)["rows"]


def record_in_scope(patients, name):
	row = frappe.db.get_value(EMR_DT, name, ROW_FIELDS, as_dict=True) if name else None
	if not row:
		_missing(_("Record not found"))
	if row.patient not in patients:
		raise frappe.PermissionError(_("This record is not in your health vault"))
	return row


def record_detail(patients, name):
	return record_row(record_in_scope(patients, name), full=True)


def _file_content(file_url):
	doc = frappe.get_doc("File", {"file_url": file_url})
	content = doc.get_content()
	return doc.file_name, content.encode() if isinstance(content, str) else content


def record_file(patients, name):
	"""Base64 file for the patient's own record: stored PDF / upload, else regenerated (lab report / prescription)."""
	row = record_in_scope(patients, name)
	filename, content, ctype = None, None, "application/pdf"
	if row.file and frappe.db.exists("File", {"file_url": row.file}):
		filename, content = _file_content(row.file)
	elif row.source_doctype == LAB_DT:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase125_report_share import assert_report_share_ready, build_authorized_report_pdf, _load_journey

		journey = _summary(row).get("care_journey") or _journey_for(frappe.db.get_value(LAB_DT, row.source_name, LAB_FIELDS, as_dict=True) or {}, {})
		jrow = _load_journey(journey)
		if not jrow:
			_missing(_("The report PDF is not available yet"))
		assert_report_share_ready(jrow)
		content, filename, _mode, _label = build_authorized_report_pdf(journey)
	elif row.source_doctype == CP_DT:
		from frappe.utils.pdf import get_pdf

		from health_ecosystem_core.health_ecosystem_core.clinical_prescription_format import prescription_print_payload, render_prescription_html

		content = get_pdf(render_prescription_html(prescription_print_payload(row.source_name)))
		filename = f"{row.source_name}.pdf"
	elif row.source_doctype == RX_DT:
		pdf = frappe.db.get_value(RX_DT, row.source_name, "pdf_file")
		if pdf:
			filename, content = _file_content(pdf)
	if not content:
		_missing(_("No file for this record"))
	ext = cstr(filename).rsplit(".", 1)[-1].lower() if "." in cstr(filename) else "pdf"
	ctype = UPLOAD_EXTS.get(ext, ctype)
	return {"filename": filename or f"{row.name}.pdf", "content_type": ctype, "content_base64": base64.b64encode(content).decode()}


def _unit_key(unit):
	return re.sub(r"\s+", "", cstr(unit)).lower()


POINT_FIELDS = ["name", "emr_record", "analyte_key", "analyte_name", "test_name", "observed_on", "value_text", "value_num", "has_num", "qualifier", "unit", "ref_low", "has_ref_low", "ref_high", "has_ref_high", "ref_label", "flag"]


def _point_out(p):
	return {
		"record": p.emr_record,
		"date": cstr(p.observed_on),
		"value": flt(p.value_num) if cint(p.has_num) else None,
		"value_text": p.value_text,
		"qualifier": p.qualifier,
		"unit": p.unit,
		"ref_low": flt(p.ref_low) if cint(p.has_ref_low) else None,
		"ref_high": flt(p.ref_high) if cint(p.has_ref_high) else None,
		"flag": p.flag or None,
	}


def list_trends(patient):
	rows = frappe.db.sql(
		f"""select analyte_key, count(*) as n, sum(has_num) as numeric_n, max(observed_on) as last_on from `tab{POINT_DT}`
		where patient = %s group by analyte_key order by max(observed_on) desc, analyte_key asc limit 300""",
		(patient,),
		as_dict=True,
	)
	out = []
	for r in rows:
		last = frappe.get_all(POINT_DT, filters={"patient": patient, "analyte_key": r.analyte_key}, fields=POINT_FIELDS, order_by="observed_on desc, creation desc", limit=1)
		p = last[0] if last else None
		out.append(
			{
				"key": r.analyte_key,
				"name": p.analyte_name if p else r.analyte_key,
				"count": cint(r.n),
				"numeric_count": cint(r.numeric_n),
				"last": _point_out(p) if p else None,
			}
		)
	return {"analytes": out}


def trend_series(patient, key):
	points = frappe.get_all(POINT_DT, filters={"patient": patient, "analyte_key": cstr(key)[:80]}, fields=POINT_FIELDS, order_by="observed_on asc, creation asc", limit=500)
	if not points:
		_missing(_("No results for this test yet"))
	numeric = [p for p in points if cint(p.has_num)]
	units = Counter(_unit_key(p.unit) for p in numeric)
	main = units.most_common(1)[0][0] if units else ""
	series = [p for p in numeric if _unit_key(p.unit) == main]
	banded = [p for p in reversed(series) if cint(p.has_ref_low) or cint(p.has_ref_high)]
	band = {"low": flt(banded[0].ref_low) if banded and cint(banded[0].has_ref_low) else None, "high": flt(banded[0].ref_high) if banded and cint(banded[0].has_ref_high) else None}
	unit = next((p.unit for p in reversed(series) if p.unit), None)
	return {
		"key": key,
		"name": points[-1].analyte_name,
		"unit": unit,
		"points": [_point_out(p) for p in series],
		"band": band,
		"excluded_other_units": len(numeric) - len(series),
		"text_results": [_point_out(p) for p in points if not cint(p.has_num)],
	}


def _decode_upload(filename, content_b64):
	filename = re.sub(r"[^A-Za-z0-9._ -]", "", cstr(filename)).strip()[:120]
	ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
	if ext not in UPLOAD_EXTS:
		_fail(_("Upload a PDF or an image (JPG, PNG, WEBP)"))
	try:
		content = base64.b64decode(cstr(content_b64).split(",")[-1], validate=True)
	except Exception:
		_fail(_("The file could not be read"))
	if not content:
		_fail(_("The file is empty"))
	if len(content) > MAX_UPLOAD_BYTES:
		_fail(_("Files up to 5 MB can be uploaded"))
	if ext == "pdf" and not content.startswith(b"%PDF"):
		_fail(_("This is not a PDF file"))
	return filename, ext, content


def save_upload(user, patient, payload, filename, content_base64):
	p = payload or {}
	title = re.sub(r"\s+", " ", cstr(p.get("title"))).strip()
	if len(title) < 2:
		_fail(_("Give the document a title"))
	record_type = cstr(p.get("record_type") or "Patient Upload").strip()
	if record_type not in UPLOAD_TYPES:
		_fail(_("Choose what kind of document this is"))
	record_date = getdate(p.get("record_date") or today())
	if record_date > getdate(today()):
		_fail(_("The document date cannot be in the future"))
	clean, ext, content = _decode_upload(filename, content_base64)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"vault-{frappe.generate_hash(length=8)}-{clean}",
			"content": content,
			"is_private": 1,
			"attached_to_doctype": PATIENT_DT,
			"attached_to_name": patient,
		}
	)
	file_doc.flags.ignore_permissions = True
	file_doc.insert(ignore_permissions=True)
	summary = {"schema": "remedium.upload.v1", "filename": clean, "content_type": UPLOAD_EXTS[ext], "notes": cstr(p.get("notes")).strip()[:500] or None, "uploaded_by": user}
	res = upsert_emr_record("File", file_doc.name, record_type, "Patient", patient=patient, title=title[:140], record_date=record_date, summary=summary, file_url=file_doc.file_url, push=False)
	return record_detail([patient], res["name"])


def delete_upload(patients, name):
	row = record_in_scope(patients, name)
	if row.source_app != "Patient" or row.source_doctype != "File":
		raise frappe.PermissionError(_("Only documents you uploaded can be deleted"))
	frappe.delete_doc(EMR_DT, row.name, ignore_permissions=True, force=True)
	if frappe.db.exists("File", row.source_name):
		frappe.delete_doc("File", row.source_name, ignore_permissions=True, force=True)
	return {"deleted": name}


def prescriptions(patients, patient):
	"""Uber Doc e-Rx and Remedium prescriptions for one profile, newest first."""
	rows = frappe.get_all(EMR_DT, filters={"patient": patient, "record_type": "Prescription"}, fields=ROW_FIELDS, order_by="record_date desc, creation desc", limit=200)
	out = []
	for r in rows:
		item = record_row(r)
		s = _summary(r)
		item["medications"] = [
			{k: m.get(k) for k in ("drug", "strength", "dose", "dosage", "frequency", "duration", "timing", "route", "instructions")} for m in (s.get("medications") or [])
		]
		item["exercise_plan"] = s.get("exercise_plan") or []
		item["verify_url"] = s.get("verify_url")
		item["status"] = s.get("status")
		out.append(item)
	return {"rows": out}


def export_emr(patient):
	rows = frappe.get_all(EMR_DT, filters={"patient": patient}, fields=ROW_FIELDS, order_by="record_date asc, creation asc", limit=0)
	points = frappe.get_all(POINT_DT, filters={"patient": patient}, fields=POINT_FIELDS, order_by="observed_on asc", limit=0)
	return {"records": [record_row(r, full=True) for r in rows], "analytes": [{"key": p.analyte_key, "name": p.analyte_name, **_point_out(p)} for p in points]}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _iam():
	from health_ecosystem_core.health_ecosystem_core import clinical_phase136_patient_iam as iam

	return iam


@frappe.whitelist(allow_guest=True)
def vault_timeline(patient=None, filters=None, page=1, page_size=30, sid=None):
	iam = _iam()

	def fn(ctx):
		patients = [iam.patient_in_scope(ctx, patient)] if patient else iam.patients_of(ctx)
		return timeline(patients, iam._parse(filters), page, page_size)

	return iam.run(sid, fn)


@frappe.whitelist(allow_guest=True)
def vault_record(name=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: record_detail(iam.patients_of(ctx), name))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_record_file(name=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: record_file(iam.patients_of(ctx), name))


@frappe.whitelist(allow_guest=True)
def vault_trends(patient=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: list_trends(iam.patient_in_scope(ctx, patient)))


@frappe.whitelist(allow_guest=True)
def vault_trend(patient=None, key=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: trend_series(iam.patient_in_scope(ctx, patient), key))


@frappe.whitelist(allow_guest=True)
def vault_prescriptions(patient=None, sid=None):
	iam = _iam()

	def fn(ctx):
		pid = iam.patient_in_scope(ctx, patient)
		return prescriptions(iam.patients_of(ctx), pid)

	return iam.run(sid, fn)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_upload(patient=None, payload=None, filename=None, content_base64=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: save_upload(ctx.user, iam.patient_in_scope(ctx, patient), iam._parse(payload), filename, content_base64), message=_("Saved to your vault"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_upload_delete(name=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: delete_upload(iam.patients_of(ctx), name), message=_("Deleted"), commit=True)
