"""Phase 96 — Scientific method + analyzer model on Diagnostic Test Parameter.

Unit, method, and machine_name are owned by Diagnostic Test Master (admin-editable
in ERPNext Desk). Lab technicians see them read-only on the result-entry grid.

Defaults are seeded from common clinical-chemistry / haematology practice
(Erba EM200 reagent sheet, IFCC enzyme methods, impedance CBC analyzers, HPLC HbA1c).
"""

from __future__ import annotations

import re

import frappe
from frappe.utils import cint


# Analyzer models commonly used in mid-volume Indian labs (public vendor data).
MACHINE_BIOCHEMISTRY = "EM200"
MACHINE_HAEMATOLOGY = "BC-6200"
MACHINE_HBA1C = "D-10"
MACHINE_IMMUNOASSAY = "Cobas e411"
MACHINE_URINE = "Clinitek Status+"
MACHINE_DEFAULT = "EM200"

# Placeholder / marketing labels that must be replaced with scientific methods.
_BAD_METHODS = (
	"",
	"apollo-aligned",
	"apollo aligned",
	"apollo",
	"—",
	"-",
	"na",
	"n/a",
	"none",
)


def _norm(text):
	return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def resolve_method_and_machine(parameter_code=None, parameter_name=None, is_calculated=0):
	"""Return (method, machine_name) for a parameter from curated defaults."""
	blob = _norm(f"{parameter_code or ''} {parameter_name or ''}")
	calc = cint(is_calculated) or "ratio" in blob or "indirect" in blob and "bilirubin" in blob

	# --- Calculated / derived ---
	if calc or any(
		t in blob
		for t in (
			"a g ratio",
			"ag ratio",
			"ast alt",
			"chol hdl",
			"ldl hdl",
			"non hdl",
			"vldl",
			"atherogenic",
			"eag",
			"estimated average glucose",
			"corrected tlc",
			"nlr",
			"uibc",
			"transferrin saturation",
			"bun",
			"egfr",
		)
	):
		if "bilirubin" in blob and "indirect" in blob:
			return "Calculated (Total − Direct)", MACHINE_BIOCHEMISTRY
		if "globulin" in blob and "ag" not in blob:
			return "Calculated (Total Protein − Albumin)", MACHINE_BIOCHEMISTRY
		if "a g" in blob or "ag ratio" in blob:
			return "Calculated (Albumin / Globulin)", MACHINE_BIOCHEMISTRY
		if "ast alt" in blob:
			return "Calculated (AST / ALT)", MACHINE_BIOCHEMISTRY
		if "vldl" in blob:
			return "Calculated (Triglycerides / 5)", MACHINE_BIOCHEMISTRY
		if "non hdl" in blob:
			return "Calculated (Total − HDL)", MACHINE_BIOCHEMISTRY
		if "chol hdl" in blob or "ldl hdl" in blob or "atherogenic" in blob:
			return "Calculated", MACHINE_BIOCHEMISTRY
		if "eag" in blob or "estimated average" in blob:
			return "Calculated (from HbA1c)", MACHINE_HBA1C
		if "uibc" in blob or "transferrin saturation" in blob:
			return "Calculated", MACHINE_BIOCHEMISTRY
		if "bun" in blob:
			return "Calculated (Urea / 2.14)", MACHINE_BIOCHEMISTRY
		return "Calculated", MACHINE_BIOCHEMISTRY

	# --- LFT / bilirubin / enzymes ---
	if "bilirubin" in blob and ("direct" in blob or "conjugated" in blob):
		return "Diazo (end-point)", MACHINE_BIOCHEMISTRY
	if "bilirubin" in blob:
		return "Diazo (end-point)", MACHINE_BIOCHEMISTRY
	if any(t in blob for t in ("alt", "sgpt", "alanine aminotransferase")):
		return "IFCC kinetic enzymatic (UV)", MACHINE_BIOCHEMISTRY
	if any(t in blob for t in ("ast", "sgot", "aspartate aminotransferase")):
		return "IFCC kinetic enzymatic (UV)", MACHINE_BIOCHEMISTRY
	if "alp" in blob or "alkaline phosphatase" in blob:
		return "Kinetic enzymatic (pNPP)", MACHINE_BIOCHEMISTRY
	if "ggt" in blob or "gamma glutamyl" in blob or "gamma-glutamyl" in blob:
		return "Kinetic enzymatic (IFCC)", MACHINE_BIOCHEMISTRY

	# --- Proteins ---
	if "albumin" in blob:
		return "BCG (bromocresol green)", MACHINE_BIOCHEMISTRY
	if "protein" in blob and "total" in blob:
		return "Biuret (end-point)", MACHINE_BIOCHEMISTRY
	if "protein" in blob:
		return "Biuret (end-point)", MACHINE_BIOCHEMISTRY

	# --- Renal / metabolites ---
	if "urea" in blob and "nitrogen" not in blob:
		return "Urease (UV kinetic)", MACHINE_BIOCHEMISTRY
	if "creatinine" in blob:
		return "Enzymatic", MACHINE_BIOCHEMISTRY
	if "uric" in blob:
		return "Uricase enzymatic", MACHINE_BIOCHEMISTRY
	if any(t in blob for t in ("glucose", "sugar", "fbs", "ppbs", "rbs")):
		return "Glucose oxidase / Hexokinase", MACHINE_BIOCHEMISTRY

	# --- Lipids ---
	if "triglyceride" in blob:
		return "Enzymatic (GPO-PAP)", MACHINE_BIOCHEMISTRY
	if "hdl" in blob:
		return "Direct enzymatic", MACHINE_BIOCHEMISTRY
	if "ldl" in blob:
		return "Direct enzymatic", MACHINE_BIOCHEMISTRY
	if "cholesterol" in blob:
		return "Enzymatic (CHOD-PAP)", MACHINE_BIOCHEMISTRY

	# --- Electrolytes ---
	if any(t in blob for t in ("sodium", "potassium", "chloride", "lithium", "electrolyte")):
		return "ISE (ion-selective electrode)", MACHINE_BIOCHEMISTRY
	if "calcium" in blob:
		return "Arsenazo III / end-point", MACHINE_BIOCHEMISTRY
	if "magnesium" in blob:
		return "Xylidyl blue / end-point", MACHINE_BIOCHEMISTRY
	if "phosphorus" in blob or "phosphate" in blob:
		return "Phosphomolybdate", MACHINE_BIOCHEMISTRY

	# --- Iron ---
	if "ferritin" in blob:
		return "Immunoturbidimetric / CLIA", MACHINE_IMMUNOASSAY
	if "iron" in blob or "tibc" in blob:
		return "Ferrozine / colorimetric", MACHINE_BIOCHEMISTRY

	# --- Thyroid / immunoassay ---
	if any(t in blob for t in ("tsh", "ft3", "ft4", "t3", "t4", "thyroid")):
		return "CLIA / ECLIA", MACHINE_IMMUNOASSAY

	# --- HbA1c ---
	if "hba1c" in blob or "glycated" in blob or "glycosylated" in blob:
		return "HPLC", MACHINE_HBA1C

	# --- Haematology ---
	if any(
		t in blob
		for t in (
			"haemoglobin",
			"hemoglobin",
			"hb ",
			"pcv",
			"hct",
			"rbc",
			"mcv",
			"mch",
			"mchc",
			"rdw",
			"tlc",
			"wbc",
			"leucocyte",
			"leukocyte",
			"neutrophil",
			"lymphocyte",
			"eosinophil",
			"monocyte",
			"basophil",
			"platelet",
			"mpv",
			"nrbc",
		)
	):
		return "Impedance / optical cytometry", MACHINE_HAEMATOLOGY

	# --- Urine ---
	if "urine" in blob:
		return "Reflectance photometry / microscopy", MACHINE_URINE

	# --- Serology defaults ---
	if any(t in blob for t in ("igg", "igm", "antibody", "antigen", "hbsag", "hiv", "vdrl", "widal")):
		return "Immunochromatography / ELISA", MACHINE_IMMUNOASSAY

	return "Enzymatic", MACHINE_DEFAULT


def _needs_method_refresh(current):
	return _norm(current) in _BAD_METHODS or "apollo" in _norm(current)


def _needs_machine_refresh(current):
	return not (current or "").strip()


def ensure_machine_name_fields():
	"""Ensure Machine Name exists on Diagnostic Test Parameter + Lab Report Parameter."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	field_defs = {
		"Diagnostic Test Parameter": {
			"fieldname": "machine_name",
			"label": "Machine Name",
			"fieldtype": "Data",
			"insert_after": "method",
			"in_list_view": 1,
			"description": "Analyzer model (e.g. EM200). Admin-editable; read-only for lab tech UI.",
		},
		"Lab Report Parameter": {
			"fieldname": "machine_name",
			"label": "Machine Name",
			"fieldtype": "Data",
			"insert_after": "method",
			"in_list_view": 1,
			"read_only": 1,
			"description": "Analyzer model from Diagnostic Test Master (e.g. EM200)",
		},
	}
	changed = []
	for doctype, df in field_defs.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		meta = frappe.get_meta(doctype)
		if not meta.has_field("machine_name"):
			try:
				create_custom_fields({doctype: [df]}, update=True)
				changed.append(f"{doctype}:custom_field")
			except Exception:
				frappe.log_error(title=f"ensure_machine_name_{doctype}", message=frappe.get_traceback())
		if not frappe.db.has_column(doctype, "machine_name"):
			frappe.db.add_column(doctype, "machine_name", "Data")
			changed.append(f"{doctype}:column")
		frappe.clear_cache(doctype=doctype)
	return {"ok": True, "updated": changed}


def seed_diagnostic_parameter_methods(force=False, limit=None):
	"""Fill scientific method + machine_name on Diagnostic Test Parameter rows."""
	ensure_machine_name_fields()
	kwargs = {}
	if limit:
		kwargs["limit"] = cint(limit)
	masters = frappe.get_all("Diagnostic Test Master", pluck="name", **kwargs)
	updated_params = 0
	updated_masters = 0
	for master_name in masters:
		doc = frappe.get_doc("Diagnostic Test Master", master_name)
		dirty = False
		for row in doc.parameters or []:
			method, machine = resolve_method_and_machine(
				row.parameter_code, row.parameter_name, cint(getattr(row, "is_calculated", 0))
			)
			if force or _needs_method_refresh(row.method):
				if (row.method or "") != method:
					row.method = method
					dirty = True
					updated_params += 1
			if force or _needs_machine_refresh(getattr(row, "machine_name", None)):
				if (getattr(row, "machine_name", None) or "") != machine:
					row.machine_name = machine
					dirty = True
					updated_params += 1
		# Also seed master-level default when blank / Apollo placeholder
		if hasattr(doc, "machine_method"):
			mm = (doc.machine_method or "").strip()
			if force or _needs_method_refresh(mm) or not mm:
				# Prefer first real parameter method+machine summary
				sample = None
				for row in doc.parameters or []:
					if row.method and getattr(row, "machine_name", None):
						sample = f"{row.method} · {row.machine_name}"
						break
				if sample and doc.machine_method != sample:
					doc.machine_method = sample
					dirty = True
		if dirty:
			doc.flags.ignore_links = True
			doc.flags.ignore_validate = True
			doc.save(ignore_permissions=True)
			updated_masters += 1
	frappe.db.commit()
	return {
		"ok": True,
		"masters_updated": updated_masters,
		"parameter_fields_touched": updated_params,
	}


def sync_lab_report_from_masters(lab_report=None, force=False, statuses=None):
	"""Copy unit/method/machine_name from Diagnostic Test Master onto Lab Report rows."""
	ensure_machine_name_fields()
	statuses = statuses or ("Draft", "In Progress", "Pending Review")
	filters = {}
	if lab_report:
		filters["name"] = lab_report
	else:
		filters["report_status"] = ("in", list(statuses))

	names = frappe.get_all("Lab Report", filters=filters, pluck="name")
	# Build lookup: (master, parameter_code|name) -> master row
	master_cache = {}

	def master_row(master, code, desc):
		if not master or not frappe.db.exists("Diagnostic Test Master", master):
			return None
		if master not in master_cache:
			doc = frappe.get_doc("Diagnostic Test Master", master)
			by_code = {}
			by_name = {}
			for p in doc.parameters or []:
				if p.parameter_code:
					by_code[_norm(p.parameter_code)] = p
				if p.parameter_name:
					by_name[_norm(p.parameter_name)] = p
			master_cache[master] = (by_code, by_name)
		by_code, by_name = master_cache[master]
		return by_code.get(_norm(code)) or by_name.get(_norm(desc))

	reports_touched = 0
	rows_touched = 0
	for name in names:
		doc = frappe.get_doc("Lab Report", name)
		dirty = False
		for row in doc.parameters or []:
			src = master_row(row.diagnostic_test, row.parameter_code, row.description)
			if src:
				if src.unit and (force or not (row.unit or "").strip() or row.unit != src.unit):
					# Always prefer master unit (technician must not own unit)
					if (row.unit or "") != (src.unit or ""):
						row.unit = src.unit or ""
						dirty = True
						rows_touched += 1
				src_method = src.method or ""
				src_machine = getattr(src, "machine_name", None) or ""
				if not src_method or _needs_method_refresh(src_method):
					src_method, seeded_machine = resolve_method_and_machine(
						row.parameter_code, row.description, cint(row.is_calculated)
					)
					if not src_machine:
						src_machine = seeded_machine
				if force or _needs_method_refresh(row.method) or (src_method and row.method != src_method):
					if (row.method or "") != src_method:
						row.method = src_method
						dirty = True
						rows_touched += 1
				if hasattr(row, "machine_name"):
					if force or _needs_machine_refresh(row.machine_name) or (
						src_machine and row.machine_name != src_machine
					):
						if (row.machine_name or "") != src_machine:
							row.machine_name = src_machine
							dirty = True
							rows_touched += 1
			else:
				method, machine = resolve_method_and_machine(
					row.parameter_code, row.description, cint(row.is_calculated)
				)
				if force or _needs_method_refresh(row.method):
					row.method = method
					dirty = True
					rows_touched += 1
				if hasattr(row, "machine_name") and (force or _needs_machine_refresh(row.machine_name)):
					row.machine_name = machine
					dirty = True
					rows_touched += 1
		if dirty:
			# Open reports may reference retired/missing Item links — skip link checks.
			doc.flags.ignore_links = True
			doc.flags.ignore_validate = True
			try:
				doc.save(ignore_permissions=True)
				reports_touched += 1
			except Exception:
				# Fallback: patch child rows directly
				for row in doc.parameters or []:
					vals = {
						"unit": row.unit or "",
						"method": row.method or "",
					}
					if hasattr(row, "machine_name"):
						vals["machine_name"] = row.machine_name or ""
					frappe.db.set_value("Lab Report Parameter", row.name, vals, update_modified=False)
				reports_touched += 1
				frappe.log_error(title=f"sync_lab_report_{name}", message=frappe.get_traceback())
	frappe.db.commit()
	return {"ok": True, "reports_updated": reports_touched, "rows_touched": rows_touched}


def setup_phase96(force=False):
	fields = ensure_machine_name_fields()
	seed = seed_diagnostic_parameter_methods(force=force)
	try:
		sync = sync_lab_report_from_masters(force=force)
	except Exception:
		frappe.log_error(title="setup_phase96_sync", message=frappe.get_traceback())
		sync = {"ok": False, "error": "sync_failed_see_error_log"}
	frappe.clear_cache()
	return {"ok": True, "phase": 96, "fields": fields, "seed": seed, "sync": sync}
