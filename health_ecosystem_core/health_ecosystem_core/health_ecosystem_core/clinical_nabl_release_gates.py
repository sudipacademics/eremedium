"""NABL 112B / 112A Cl. 7.4.1.5 — automated selection and release gates."""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt, get_datetime


def _settings_flag(name, default=0):
	try:
		return cint(frappe.db.get_single_value("Health Ecosystem Settings", name) or default)
	except Exception:
		return default


def _master_param_meta(diagnostic_test, parameter_code=None, parameter_name=None):
	if not diagnostic_test or not frappe.db.exists("Diagnostic Test Master", diagnostic_test):
		return {}
	doc = frappe.get_doc("Diagnostic Test Master", diagnostic_test)
	code = (parameter_code or "").strip().upper()
	name = (parameter_name or "").strip().lower()
	for p in doc.parameters or []:
		pc = (p.parameter_code or "").strip().upper()
		pn = (p.parameter_name or "").strip().lower()
		if (code and pc == code) or (name and pn == name):
			return {
				"amr_min": p.get("amr_min"),
				"amr_max": p.get("amr_max"),
				"critical_min": p.get("critical_min"),
				"critical_max": p.get("critical_max"),
				"normal_min": p.get("normal_min"),
				"normal_max": p.get("normal_max"),
				"delta_limit_percent": p.get("delta_limit_percent"),
				"nabl_discipline": p.get("nabl_discipline") or doc.get("nabl_discipline"),
				"parameter_kind": p.get("parameter_kind") or ("Calculated" if cint(p.get("is_calculated")) else "Real"),
			}
	return {"nabl_discipline": doc.get("nabl_discipline")}


def _parse_number(raw):
	if raw is None:
		return None
	text = str(raw).strip().replace(",", "")
	if not text or text in ("-", "NA", "N/A"):
		return None
	try:
		return flt(text)
	except Exception:
		return None


def _prior_result(patient, parameter_code, parameter_name, before_dt, days=7):
	"""Best-effort prior numeric result for delta check."""
	if not patient:
		return None
	trf_names = frappe.get_all(
		"Customer TRF",
		filters={"patient": patient},
		pluck="name",
		limit=50,
	)
	if not trf_names:
		return None
	reports = frappe.get_all(
		"Lab Report",
		filters={
			"customer_trf": ("in", trf_names),
			"report_status": ("in", ["Verified", "Authorized", "Printed"]),
		},
		fields=["name", "report_date", "printed_on"],
		order_by="modified desc",
		limit=20,
	)
	code = (parameter_code or "").strip().upper()
	name = (parameter_name or "").strip().lower()
	cutoff = None
	if before_dt:
		try:
			from frappe.utils import add_to_date

			cutoff = add_to_date(get_datetime(before_dt), days=-int(days or 7))
		except Exception:
			cutoff = None
	for rep in reports:
		if not frappe.db.exists("Lab Report", rep.name):
			continue
		doc = frappe.get_doc("Lab Report", rep.name)
		for row in doc.parameters or []:
			pc = (row.parameter_code or "").strip().upper()
			pn = (row.description or "").strip().lower()
			if not ((code and pc == code) or (name and pn == name)):
				continue
			val = _parse_number(row.result_value)
			if val is None:
				continue
			return val
	return None


def evaluate_release_gates(lab_report_doc):
	"""Return {auto_verified, holds: [str], disciplines: set}."""
	holds = []
	disciplines = set()

	# Phase 62 — real IQC (replaces Phase 61 stub when IQC Run DocType exists)
	iqc_checked = False
	analyte_codes = []
	for row in lab_report_doc.parameters or []:
		if not cint(getattr(row, "include_in_report", 1)):
			continue
		code = (getattr(row, "parameter_code", None) or "").strip()
		if code:
			analyte_codes.append(code)
		elif getattr(row, "description", None):
			analyte_codes.append(row.description)

	if frappe.db.exists("DocType", "IQC Run") and analyte_codes:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase62_nabl_112a_qc import (
				todays_iqc_status_for_analytes,
			)

			iqc = todays_iqc_status_for_analytes(analyte_codes[:40])
			iqc_checked = True
			for r in iqc.get("rejects") or []:
				holds.append(f"IQC: {r}")
			enforce_iqc = _settings_flag("nabl_enforce_iqc")
			if enforce_iqc and (iqc.get("missing") or []):
				holds.append("IQC missing today for: " + ", ".join(iqc["missing"][:8]))
			elif not enforce_iqc:
				# Soft: still honour report-level iqc_ok stub if unchecked
				if not cint(getattr(lab_report_doc, "iqc_ok", 1)):
					holds.append("IQC not OK for this run")
		except Exception:
			frappe.log_error(title="iqc gate", message=frappe.get_traceback())
			if not cint(getattr(lab_report_doc, "iqc_ok", 1)):
				holds.append("IQC not OK for this run")
	elif not cint(getattr(lab_report_doc, "iqc_ok", 1)):
		holds.append("IQC not OK for this run")

	# Equipment calibration / OOS
	if frappe.db.exists("DocType", "Lab Equipment"):
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase62_nabl_112a_qc import (
				list_overdue_equipment,
			)

			overdue = list_overdue_equipment()
			if overdue and _settings_flag("nabl_enforce_calibration"):
				holds.append(
					"Equipment calibration/OOS: "
					+ ", ".join((o.get("equipment_name") or o.get("name")) for o in overdue[:5])
				)
			elif overdue and not _settings_flag("nabl_enforce_calibration"):
				# Soft note only when auto path — still allow finalize; do not add hold
				pass
		except Exception:
			pass

	patient = None
	trf = getattr(lab_report_doc, "customer_trf", None)
	if trf and frappe.db.exists("Customer TRF", trf):
		patient = frappe.db.get_value("Customer TRF", trf, "patient")

	for row in lab_report_doc.parameters or []:
		if not cint(getattr(row, "include_in_report", 1)):
			continue
		kind = (getattr(row, "parameter_kind", None) or "").strip()
		if not kind:
			kind = "Calculated" if cint(getattr(row, "is_calculated", 0)) else "Real"
		meta = _master_param_meta(
			getattr(row, "diagnostic_test", None),
			getattr(row, "parameter_code", None),
			getattr(row, "description", None),
		)
		disc = meta.get("nabl_discipline")
		if disc:
			disciplines.add(disc)

		val = _parse_number(getattr(row, "result_value", None))
		if val is None:
			continue

		label = (row.description or row.parameter_code or "parameter").strip()

		amr_min = meta.get("amr_min")
		amr_max = meta.get("amr_max")
		if amr_min is not None and val < flt(amr_min):
			holds.append(f"{label}: below AMR ({val} < {amr_min})")
		if amr_max is not None and val > flt(amr_max):
			holds.append(f"{label}: above AMR ({val} > {amr_max})")

		cmin = meta.get("critical_min")
		cmax = meta.get("critical_max")
		flag = (getattr(row, "abnormal_flag", None) or "").strip()
		if flag == "Critical" or (cmin is not None and val < flt(cmin)) or (cmax is not None and val > flt(cmax)):
			holds.append(f"{label}: critical value — authorize required")

		# Delta check when outside reference interval
		lo = meta.get("normal_min") if meta.get("normal_min") is not None else getattr(row, "lower_range", None)
		hi = meta.get("normal_max") if meta.get("normal_max") is not None else getattr(row, "upper_range", None)
		outside = False
		if lo is not None and val < flt(lo):
			outside = True
		if hi is not None and val > flt(hi):
			outside = True
		if outside and kind != "Calculated":
			limit = flt(meta.get("delta_limit_percent") or 20)
			prior = _prior_result(
				patient,
				getattr(row, "parameter_code", None),
				getattr(row, "description", None),
				getattr(lab_report_doc, "report_date", None) or getattr(lab_report_doc, "lab_receipt_date", None),
			)
			if prior is not None and flt(prior) != 0:
				delta_pct = abs(val - flt(prior)) / abs(flt(prior)) * 100.0
				if delta_pct > limit:
					holds.append(f"{label}: delta check fail ({delta_pct:.1f}% > {limit}%)")

	# Deduplicate while preserving order
	seen = set()
	uniq = []
	for h in holds:
		if h not in seen:
			seen.add(h)
			uniq.append(h)

	return {
		"auto_verified": 1 if not uniq else 0,
		"holds": uniq,
		"disciplines": disciplines,
	}


def apply_release_gates_to_report(lab_report_doc, save=False):
	result = evaluate_release_gates(lab_report_doc)
	lab_report_doc.auto_verified = cint(result["auto_verified"])
	lab_report_doc.release_hold_reasons = "\n".join(result["holds"][:20]) if result["holds"] else ""
	if save:
		lab_report_doc.save(ignore_permissions=True)
	return result


def user_competent_for_disciplines(user, disciplines):
	"""Return (ok, message). Soft-pass when no disciplines or no assessments exist."""
	disciplines = {d for d in (disciplines or set()) if d}
	if not disciplines:
		return True, ""
	if not frappe.db.exists("DocType", "Lab Competence Assessment"):
		return True, ""
	rows = frappe.get_all(
		"Lab Competence Assessment",
		filters={"user": user, "competent": 1},
		fields=["primary_discipline", "secondary_disciplines"],
		order_by="assessment_date desc",
		limit=20,
	)
	if not rows:
		msg = f"No competence assessment for {user}"
		if _settings_flag("nabl_enforce_competence"):
			return False, msg
		return True, msg + " (soft warning)"

	allowed = set()
	for r in rows:
		if r.primary_discipline:
			allowed.add(r.primary_discipline)
		for part in (r.secondary_disciplines or "").split(","):
			part = part.strip()
			if part:
				allowed.add(part)
	missing = disciplines - allowed
	if missing:
		msg = f"Not competent for: {', '.join(sorted(missing))}"
		if _settings_flag("nabl_enforce_competence"):
			return False, msg
		return True, msg + " (soft warning)"
	return True, ""


def assert_batch_may_open(batch_doc):
	status = (getattr(batch_doc, "verification_status", None) or "Pending").strip()
	if status == "Verified":
		return
	if status == "Failed":
		frappe.throw("Lot verification Failed — cannot open this pack")
	if _settings_flag("nabl_enforce_lot_verification"):
		frappe.throw("Lot verification required before opening this pack (NABL 112B)")
