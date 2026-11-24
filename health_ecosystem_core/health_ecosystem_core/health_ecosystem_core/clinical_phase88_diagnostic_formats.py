"""Phase 88 — Customizable Diagnostic Test Master formats.

Supports age/gender reference bands, linked clinical fields, descriptive /
table layouts, and HPLC-style graph upload on Lab Report — aligned with
legacy RL Test Link + Description Master behaviour.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt

MODULE = "Health Ecosystem Core"


def age_to_days(years=0, months=0, days=0):
	return max(0, cint(years) * 365 + cint(months) * 30 + cint(days))


def patient_age_days(age_years=None, age_months=0, age_days=0):
	"""TRF stores whole years; months/days optional overrides for neonatal bands."""
	return age_to_days(age_years or 0, age_months or 0, age_days or 0)


def _norm_gender(gender):
	g = (gender or "").strip().lower()
	if g.startswith("m"):
		return "Male"
	if g.startswith("f"):
		return "Female"
	return ""


def _param_key(code=None, name=None):
	code = (code or "").strip().lower()
	name = (name or "").strip().lower()
	return code or name


def resolve_menstrual_cycle_day(trf=None, menstrual_cycle_day=None, lmp_date=None):
	"""Prefer explicit cycle day; else days since LMP (clamped 1–45)."""
	if menstrual_cycle_day is not None and cint(menstrual_cycle_day) > 0:
		return cint(menstrual_cycle_day)
	if trf is not None:
		explicit = getattr(trf, "menstrual_cycle_day", None)
		if explicit is not None and cint(explicit) > 0:
			return cint(explicit)
		lmp_date = lmp_date or getattr(trf, "lmp_date", None)
	if not lmp_date:
		return None
	try:
		from frappe.utils import date_diff, getdate, today

		delta = date_diff(getdate(today()), getdate(lmp_date)) + 1
		if delta < 1:
			return None
		return min(delta, 45)
	except Exception:
		return None


CYCLE_PHASE_WINDOWS = {
	"Follicular (1-13)": (1, 13),
	"Ovulatory (14)": (14, 14),
	"Luteal (15-28)": (15, 28),
	"Mid-cycle (12-16)": (12, 16),
}


def _row_cycle_constraint(row):
	"""Return (from_day, to_day, mode) where mode is False | 'day' | 'post' | 'pregnant'."""
	cf = cint(getattr(row, "cycle_day_from", 0) or 0)
	ct = cint(getattr(row, "cycle_day_to", 0) or 0)
	phase = (getattr(row, "cycle_phase", None) or "Any").strip() or "Any"
	if cf or ct:
		return (cf or 1, ct or cf or 35, "day")
	if phase in CYCLE_PHASE_WINDOWS:
		a, b = CYCLE_PHASE_WINDOWS[phase]
		return (a, b, "day")
	if phase == "Post-menopausal":
		return (None, None, "post")
	if phase == "Pregnant":
		return (None, None, "pregnant")
	return (None, None, False)


def match_reference_range_row(
	master_doc,
	parameter_code=None,
	parameter_name=None,
	age_years=None,
	gender=None,
	age_months=None,
	age_days=None,
	menstrual_cycle_day=None,
):
	"""Pick best age/gender/cycle band for a parameter from Diagnostic Test Master.reference_ranges."""
	if not master_doc or not cint(getattr(master_doc, "uses_age_related_ranges", 0)):
		return None
	ranges = getattr(master_doc, "reference_ranges", None) or []
	if not ranges:
		return None

	key = _param_key(parameter_code, parameter_name)
	if not key:
		return None

	patient_days = patient_age_days(age_years, age_months or 0, age_days or 0)
	want_gender = _norm_gender(gender)
	cycle_day = cint(menstrual_cycle_day) if menstrual_cycle_day not in (None, "") else None
	if cycle_day is not None and cycle_day <= 0:
		cycle_day = None

	candidates = []
	for row in ranges:
		row_key = _param_key(getattr(row, "parameter_code", None), getattr(row, "parameter_name", None))
		if row_key != key and (getattr(row, "parameter_name", "") or "").strip().lower() != (
			parameter_name or ""
		).strip().lower():
			continue
		from_d = age_to_days(
			getattr(row, "age_from_years", 0),
			getattr(row, "age_from_months", 0),
			getattr(row, "age_from_days", 0),
		)
		to_d = age_to_days(
			getattr(row, "age_to_years", 0),
			getattr(row, "age_to_months", 0),
			getattr(row, "age_to_days", 0),
		)
		if to_d < from_d:
			to_d = from_d
		if patient_days < from_d or patient_days > to_d:
			continue

		cf, ct, cycle_mode = _row_cycle_constraint(row)
		cycle_score = 0
		if cycle_mode == "day":
			if cycle_day is None:
				# Cycle-specific band without patient cycle day — skip
				continue
			if cycle_day < cint(cf) or cycle_day > cint(ct):
				continue
			cycle_score = 2
		elif cycle_mode == "post":
			# Post-menopausal bands only when no active cycle day
			if cycle_day is not None:
				continue
			cycle_score = 1
		elif cycle_mode == "pregnant":
			# Require explicit cycle day >= 40 as a soft pregnancy proxy, else skip
			if cycle_day is None or cycle_day < 40:
				continue
			cycle_score = 1

		row_gender = (getattr(row, "gender", None) or "Both").strip()
		score = 0
		if row_gender == "Both" or not want_gender:
			score = 1
		elif want_gender and row_gender == want_gender:
			score = 3
		else:
			continue
		score += cycle_score
		# Prefer exact gender / cycle, then older age_from (boundary at e.g. 14Y), then narrower span
		span = max(1, to_d - from_d)
		candidates.append((score, from_d, -span, row))

	if not candidates:
		return None
	candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
	return candidates[0][3]


def resolve_parameter_bounds(
	master_doc,
	param,
	age_years=None,
	gender=None,
	age_months=None,
	age_days=None,
	menstrual_cycle_day=None,
):
	"""Return normal/critical bounds + display label for a Diagnostic Test Parameter row."""
	fallback = {
		"normal_min": getattr(param, "normal_min", None),
		"normal_max": getattr(param, "normal_max", None),
		"critical_min": getattr(param, "critical_min", None),
		"critical_max": getattr(param, "critical_max", None),
		"unit": getattr(param, "unit", None) or "",
		"display_label": None,
		"interpretation": getattr(param, "interpretation", None) or "",
		"matched_age_band": 0,
		"cycle_phase": None,
	}
	if not master_doc:
		return fallback

	matched = match_reference_range_row(
		master_doc,
		parameter_code=getattr(param, "parameter_code", None),
		parameter_name=getattr(param, "parameter_name", None),
		age_years=age_years,
		gender=gender,
		age_months=age_months,
		age_days=age_days,
		menstrual_cycle_day=menstrual_cycle_day,
	)
	if not matched:
		return fallback

	return {
		"normal_min": getattr(matched, "normal_min", None),
		"normal_max": getattr(matched, "normal_max", None),
		"critical_min": getattr(matched, "critical_min", None)
		if getattr(matched, "critical_min", None) is not None
		else fallback["critical_min"],
		"critical_max": getattr(matched, "critical_max", None)
		if getattr(matched, "critical_max", None) is not None
		else fallback["critical_max"],
		"unit": fallback["unit"],
		"display_label": (getattr(matched, "display_label", None) or "").strip() or None,
		"interpretation": (getattr(matched, "interpretation", None) or "").strip()
		or fallback["interpretation"],
		"matched_age_band": 1,
		"cycle_phase": getattr(matched, "cycle_phase", None),
		"age_from_years": getattr(matched, "age_from_years", None),
		"age_from_months": getattr(matched, "age_from_months", None),
		"age_from_days": getattr(matched, "age_from_days", None),
		"age_to_years": getattr(matched, "age_to_years", None),
		"age_to_months": getattr(matched, "age_to_months", None),
		"age_to_days": getattr(matched, "age_to_days", None),
	}


def _is_blank_numeric_label(label):
	"""0-0 and 0.0-0.0 are unset Float defaults, not a biological interval."""
	text = "".join((label or "").lower().split())
	if not text:
		return False
	head = text.split("/", 1)[0]
	sep = "–" if "–" in head else "-"
	if sep not in head:
		return False
	left, right = head.split(sep, 1)
	try:
		return float(left) == 0 and float(right) == 0
	except ValueError:
		return False


def format_range_label(bounds, unit=None):
	if not bounds:
		return ""
	label = (bounds.get("display_label") or "").strip()
	if label and not _is_blank_numeric_label(label):
		return label
	low = bounds.get("normal_min")
	high = bounds.get("normal_max")

	def _num(value):
		if value is None or value == "":
			return None
		try:
			return float(value)
		except (TypeError, ValueError):
			return None

	lo, hi = _num(low), _num(high)
	# Child-table Float fields default to 0. Both zeros means "no range entered".
	if lo == 0 and hi == 0:
		lo = hi = None
	unit = (unit or bounds.get("unit") or "").strip()
	if lo is not None and hi is not None:
		return f"{flt(lo)}-{flt(hi)} {unit}".strip()
	if lo is not None:
		return f">={flt(lo)} {unit}".strip()
	if hi is not None:
		return f"<{flt(hi)} {unit}".strip()
	return ""


def master_layout_flags(master_doc):
	if not master_doc:
		return {
			"result_layout": "Numeric Profile",
			"uses_age_related_ranges": 0,
			"has_linked_clinical_fields": 0,
			"is_descriptive": 0,
			"is_table_format": 0,
			"allow_graph_upload": 0,
			"graph_label": "",
			"report_heading_1": "",
			"report_heading_2": "",
		}
	layout = (getattr(master_doc, "result_layout", None) or "Numeric Profile").strip()
	return {
		"result_layout": layout,
		"uses_age_related_ranges": cint(getattr(master_doc, "uses_age_related_ranges", 0)),
		"has_linked_clinical_fields": cint(getattr(master_doc, "has_linked_clinical_fields", 0)),
		"is_descriptive": cint(getattr(master_doc, "is_descriptive", 0)) or (layout == "Descriptive"),
		"is_table_format": cint(getattr(master_doc, "is_table_format", 0)) or (layout == "Table Matrix"),
		"allow_graph_upload": cint(getattr(master_doc, "allow_graph_upload", 0))
		or (layout == "Graph + Values"),
		"graph_label": getattr(master_doc, "graph_label", None) or "Chromatogram / Graph",
		"report_heading_1": getattr(master_doc, "report_heading_1", None) or "",
		"report_heading_2": getattr(master_doc, "report_heading_2", None) or "",
	}


AGGLUTINATION_CHOICES = "0\n+\n++\n+++\n++++"
BLOOD_GROUP_CHOICES = (
	"A Positive\nA Negative\nB Positive\nB Negative\nAB Positive\nAB Negative\nO Positive\nO Negative"
)
RH_CHOICES = "Positive\nNegative"
ABO_GROUP_CHOICES = "A\nB\nAB\nO"
DIPSTICK_CHOICES = "Negative\nTrace\n1+\n2+\n3+\n4+"
POS_NEG_CHOICES = "Negative\nPositive"
REACTIVE_CHOICES = "Non Reactive\nReactive"
URINE_COLOUR_CHOICES = "Pale Yellow\nYellow\nDark Yellow\nAmber\nReddish\nBrown\nOther"
URINE_APPEARANCE_CHOICES = "Clear\nSlightly Hazy\nHazy\nTurbid"

QUALITATIVE_PARAM_CHOICES = (
	(("colour", "color"), URINE_COLOUR_CHOICES),
	(("appearance", "clarity"), URINE_APPEARANCE_CHOICES),
	(("protein", "albumin"), DIPSTICK_CHOICES),
	(("glucose", "sugar"), DIPSTICK_CHOICES),
	(("ketone",), DIPSTICK_CHOICES),
	(("bilirubin",), DIPSTICK_CHOICES),
	(("urobilinogen",), DIPSTICK_CHOICES),
	(("blood", "occult"), DIPSTICK_CHOICES),
	(("nitrite",), POS_NEG_CHOICES),
	(("leukocyte", "leucocyte", "wbc esterase"), POS_NEG_CHOICES),
)


def _choice_row(code, name, choices, heading="", default="", rtype="Choice List"):
	return {
		"parameter_code": code,
		"parameter_name": name,
		"result_input_type": rtype,
		"choice_options": choices,
		"default_value": default,
		"before_heading": heading,
		"parameter_kind": "Real",
		"is_calculated": 0,
		"normal_min": None,
		"normal_max": None,
		"unit": "",
	}


def abo_grouping_template(parameter_name=None, parameter_code=None):
	"""Single Choice List — tech types the observed ABO/Rh result from a dropdown."""
	return [
		_choice_row(
			parameter_code or "BLOOD_GROUP",
			parameter_name or "Blood Group",
			BLOOD_GROUP_CHOICES,
		),
	]


def _is_abo_agglutination_matrix(doc):
	names = " ".join((p.parameter_name or "").lower() for p in (doc.parameters or []))
	return any(k in names for k in ("anti-a", "anti-b", "anti-d", "a cells", "b cells"))


def widal_template():
	titre = "Negative\n1:20\n1:40\n1:80\n1:160\n1:320"
	return [
		_choice_row("84", 'S. typhi "O"', titre, "Widal titres", "Negative"),
		_choice_row("85", 'S. typhi "H"', titre, "Widal titres", "Negative"),
		_choice_row("86", 'S. paratyphi "A" (H)', titre, "Widal titres", "Negative"),
		_choice_row("87", 'S. paratyphi "B" (H)', titre, "Widal titres", "Negative"),
	]


def infer_format_kind(test_name=None, item_code=None):
	blob = f"{test_name or ''} {item_code or ''}".lower()
	if any(k in blob for k in ("blood group", "blood grouping", "abo", "rh typing", "abo & rh", "abo/rh")):
		if "antibody" in blob or "titre" in blob or "titer" in blob:
			return ""
		return "abo"
	if "widal" in blob:
		return "widal"
	if any(k in blob for k in ("peripheral smear", "peripheral blood smear", "pbf examination")):
		return "smear"
	if "urine" in blob and any(
		k in blob for k in ("re/me", "re me", "(re", "routine", "complete urine", "urine re", "urine me")
	):
		return "urine"
	if any(k in blob for k in ("pregnancy", "upt", "urine hcg")) and "beta" not in blob:
		return "posneg"
	if any(k in blob for k in ("malaria", "dengue ns1", "typhoid ig", "hiv card", "hbsag card", "hcv card")):
		return "posneg"
	return ""


def qualitative_choices_for_param(parameter_name):
	lower = (parameter_name or "").lower()
	for hints, choices in QUALITATIVE_PARAM_CHOICES:
		if any(h in lower for h in hints):
			if "total protein" in lower or "serum" in lower:
				continue
			if hints == ("blood", "occult") and "group" in lower:
				continue
			if hints == ("protein", "albumin") and "serum" in lower:
				continue
			return choices
	return ""


def _is_stub_numeric_master(doc):
	rows = list(doc.parameters or [])
	if not rows:
		return True
	if len(rows) > 2:
		return False
	for row in rows:
		rtype = (getattr(row, "result_input_type", None) or "Numeric").strip()
		if rtype not in ("Numeric", ""):
			return False
		low = getattr(row, "normal_min", None)
		high = getattr(row, "normal_max", None)
		if low not in (None, "", 0, 0.0) or high not in (None, "", 0, 0.0):
			if flt(low) or flt(high):
				return False
	return True


def apply_template_rows(doc, rows, layout):
	doc.result_layout = layout
	if layout == "Table Matrix":
		doc.is_table_format = 1
		doc.is_descriptive = 0
	elif layout == "Descriptive":
		doc.is_descriptive = 1
		doc.is_table_format = 0
	else:
		doc.is_table_format = 0
		doc.is_descriptive = 0
	doc.set("parameters", [])
	for row in rows:
		doc.append("parameters", row)
	return len(rows)


def apply_layout_to_master(doc):
	"""Stamp result_layout + input types. Replace stub numeric grids with templates."""
	kind = infer_format_kind(doc.test_name or doc.name, doc.item)
	changed = False
	if kind == "abo":
		rows = list(doc.parameters or [])
		if _is_abo_agglutination_matrix(doc) or _is_stub_numeric_master(doc) or not rows:
			keep_name = rows[0].parameter_name if len(rows) == 1 and not _is_abo_agglutination_matrix(doc) else None
			keep_code = rows[0].parameter_code if len(rows) == 1 and not _is_abo_agglutination_matrix(doc) else None
			apply_template_rows(doc, abo_grouping_template(keep_name, keep_code), "Numeric Profile")
			return True, "abo-choice"
		if (doc.result_layout or "") == "Table Matrix" or cint(getattr(doc, "is_table_format", 0)):
			doc.result_layout = "Numeric Profile"
			doc.is_table_format = 0
			changed = True
		for row in rows:
			rtype = (getattr(row, "result_input_type", None) or "Numeric").strip()
			opts = (row.choice_options or "").strip()
			needs_blood_group = (
				rtype in ("Numeric", "", None)
				or not opts
				or opts == AGGLUTINATION_CHOICES.strip()
				or "+++" in opts
			)
			if needs_blood_group:
				row.result_input_type = "Choice List"
				row.choice_options = BLOOD_GROUP_CHOICES
				row.normal_min = None
				row.normal_max = None
				row.unit = ""
				changed = True
		return changed, "abo-choice" if changed else "abo"
	elif kind == "widal":
		if _is_stub_numeric_master(doc) or len(doc.parameters or []) < 4:
			apply_template_rows(doc, widal_template(), "Table Matrix")
			return True, "widal-template"
		if (doc.result_layout or "") != "Table Matrix":
			doc.result_layout = "Table Matrix"
			doc.is_table_format = 1
			changed = True
	elif kind == "smear":
		if _is_stub_numeric_master(doc):
			apply_template_rows(
				doc,
				[
					{
						"parameter_code": "PBS",
						"parameter_name": "Peripheral Smear Findings",
						"result_input_type": "Descriptive Text",
						"default_value": "No abnormal morphology seen.",
						"parameter_kind": "Real",
					}
				],
				"Descriptive",
			)
			return True, "smear-template"
		if (doc.result_layout or "") != "Descriptive":
			doc.result_layout = "Descriptive"
			doc.is_descriptive = 1
			changed = True
	elif kind == "posneg":
		if _is_stub_numeric_master(doc):
			name = doc.test_name or "Result"
			apply_template_rows(
				doc,
				[_choice_row("RESULT", name, POS_NEG_CHOICES, "", "Negative")],
				"Numeric Profile",
			)
			doc.result_layout = "Numeric Profile"
			return True, "posneg-template"

	if kind == "urine":
		for row in doc.parameters or []:
			choices = qualitative_choices_for_param(row.parameter_name)
			rtype = (getattr(row, "result_input_type", None) or "Numeric").strip()
			if choices and rtype in ("Numeric", "", None):
				row.result_input_type = "Choice List"
				row.choice_options = choices
				row.normal_min = None
				row.normal_max = None
				changed = True

	for row in doc.parameters or []:
		rtype = (getattr(row, "result_input_type", None) or "Numeric").strip()
		if kind == "widal" and rtype == "Numeric":
			row.result_input_type = "Choice List"
			if not (row.choice_options or "").strip():
				row.choice_options = "Negative\n1:20\n1:40\n1:80\n1:160\n1:320"
			changed = True
	return changed, kind or "typed"


def repair_non_urine_dipstick_hijack():
	"""Undo Choice List stamping on biochemistry/haematology numeric analytes."""
	urine_choice_sets = {
		DIPSTICK_CHOICES.strip(),
		URINE_COLOUR_CHOICES.strip(),
		URINE_APPEARANCE_CHOICES.strip(),
		POS_NEG_CHOICES.strip(),
	}
	repaired = []
	resync_items = []
	for name in frappe.get_all("Diagnostic Test Master", pluck="name"):
		doc = frappe.get_doc("Diagnostic Test Master", name)
		kind = infer_format_kind(doc.test_name or doc.name, doc.item)
		if kind in ("abo", "widal", "smear", "posneg", "urine"):
			continue
		changed = False
		for row in doc.parameters or []:
			opts = (row.choice_options or "").strip()
			rtype = (getattr(row, "result_input_type", None) or "").strip()
			if rtype == "Choice List" and opts in urine_choice_sets:
				row.result_input_type = "Numeric"
				row.choice_options = ""
				changed = True
		if changed:
			doc.save(ignore_permissions=True)
			repaired.append(name)
			if doc.item:
				resync_items.append(doc.item)
	restored = []
	if resync_items:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase56_lab_parameters import (
				match_apollo_profile,
				sync_item_parameters,
			)

			for item in dict.fromkeys(resync_items):
				item_name = frappe.db.get_value("Item", item, "item_name") or item
				rows, _cat, _src = match_apollo_profile(item_name, item_code=item)
				if rows:
					sync_item_parameters(item, item_name, create_master=True)
					restored.append(item)
		except Exception:
			frappe.log_error(title="phase88_resync_numeric", message=frappe.get_traceback())
	frappe.db.commit()
	return {"repaired": repaired, "restored_profiles": restored}


def apply_non_numeric_layouts(limit=None):
	"""Walk Diagnostic Test Masters and apply ABO/Widal/urine/smear input layouts."""
	names = frappe.get_all("Diagnostic Test Master", pluck="name", limit=cint(limit) if limit else None)
	updated = []
	for name in names:
		doc = frappe.get_doc("Diagnostic Test Master", name)
		changed, kind = apply_layout_to_master(doc)
		if changed:
			doc.save(ignore_permissions=True)
			updated.append({"master": name, "kind": kind, "params": len(doc.parameters or [])})
	frappe.db.commit()
	return {"masters": len(updated), "updated": updated[:40]}


def ensure_phase88_doctypes():
	"""Reload DocType JSONs so new format fields exist after hot-copy (no full migrate)."""
	from pathlib import Path

	from frappe.modules.import_file import import_file_by_path

	base = Path(__file__).resolve().parent / "doctype"
	paths = [
		base / "diagnostic_test_reference_range" / "diagnostic_test_reference_range.json",
		base / "diagnostic_test_parameter" / "diagnostic_test_parameter.json",
		base / "diagnostic_test_master" / "diagnostic_test_master.json",
		base / "lab_report_parameter" / "lab_report_parameter.json",
		base / "lab_report" / "lab_report.json",
		base / "customer_trf" / "customer_trf.json",
	]
	for path in paths:
		try:
			if path.exists():
				import_file_by_path(str(path), force=True, ignore_version=True)
		except Exception:
			frappe.log_error(title=f"phase88_import_{path.name}", message=frappe.get_traceback())
	for dt in (
		"diagnostic_test_reference_range",
		"diagnostic_test_parameter",
		"diagnostic_test_master",
		"lab_report_parameter",
		"lab_report",
		"customer_trf",
	):
		try:
			frappe.reload_doc("Health Ecosystem Core", "doctype", dt, force=True)
		except Exception:
			try:
				frappe.reload_doc("health_ecosystem_core", "doctype", dt, force=True)
			except Exception:
				frappe.log_error(title=f"phase88_reload_{dt}", message=frappe.get_traceback())
	_ensure_trf_age_cycle_fields()
	try:
		frappe.db.updatedb("Diagnostic Test Reference Range")
		frappe.db.updatedb("Customer TRF")
	except Exception:
		frappe.log_error(title="phase88_updatedb_ranges", message=frappe.get_traceback())
	frappe.clear_cache()
	return {"ok": True, "phase": 88}


def _ensure_trf_age_cycle_fields():
	"""Fail-soft Custom Fields if Customer TRF JSON reload skipped age/cycle columns."""
	meta = frappe.get_meta("Customer TRF")
	needed = []
	if not meta.has_field("age_months"):
		needed.append(
			{
				"fieldname": "age_months",
				"label": "Age (Months)",
				"fieldtype": "Int",
				"insert_after": "age",
				"default": "0",
			}
		)
	if not meta.has_field("age_days"):
		needed.append(
			{
				"fieldname": "age_days",
				"label": "Age (Days)",
				"fieldtype": "Int",
				"insert_after": "age_months",
				"default": "0",
			}
		)
	if not meta.has_field("lmp_date"):
		needed.append(
			{
				"fieldname": "lmp_date",
				"label": "LMP Date",
				"fieldtype": "Date",
				"insert_after": "gender",
			}
		)
	if not meta.has_field("menstrual_cycle_day"):
		needed.append(
			{
				"fieldname": "menstrual_cycle_day",
				"label": "Menstrual Cycle Day",
				"fieldtype": "Int",
				"insert_after": "lmp_date",
			}
		)
	if not needed:
		return
	try:
		from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

		create_custom_fields({"Customer TRF": needed}, update=True)
		frappe.clear_cache(doctype="Customer TRF")
	except Exception:
		frappe.log_error(title="phase88_trf_age_cycle_cf", message=frappe.get_traceback())


def setup_phase88(seed_examples=1):
	ensure_phase88_doctypes()
	seeded = {}
	if cint(seed_examples):
		seeded = seed_format_examples()
	repaired = repair_non_urine_dipstick_hijack()
	layouts = apply_non_numeric_layouts()
	return {
		"ok": True,
		"phase": 88,
		"seeded": cint(seed_examples),
		"masters": seeded,
		"repaired": repaired,
		"layouts": layouts,
	}


def seed_format_examples():
	"""Create-or-update one Diagnostic Test Master per result_layout category."""
	reverted = _revert_wrong_descriptive_hijack()
	out = {
		"Numeric Profile": _seed_uric_acid(),
		"Numeric Profile (Y/M/D urea)": _seed_serum_urea(),
		"Table Matrix": _seed_widal(),
		"Choice List (ABO)": _seed_abo_grouping(),
		"Graph + Values": _seed_hplc(),
		"Composite Linked": _seed_triple_marker(),
		"Composite Linked (Double Marker)": _seed_double_marker(force=1),
		"Numeric Profile (Allergy Profile)": _seed_allergy_profile(force=1),
		"Descriptive": _seed_descriptive(),
	}
	# Extra Numeric Profile sample focused on pediatric age bands (optional catalog richness).
	out["Numeric Profile (age bands)"] = _seed_total_ige()
	out["Numeric Profile (cycle FSH)"] = _seed_fsh_cycle_example()
	frappe.db.commit()
	result = {k: v for k, v in out.items() if v}
	if reverted:
		result["_reverted_wrong_descriptive"] = reverted
	return result


def list_format_seed_masters():
	"""Desk/API helper — show seeded masters by result_layout."""
	wanted_items = [
		"LAB-URIC-ACID",
		"LAB-TOTAL-IGE",
		"LAB-WIDAL",
		"LAB-HPLC-HB",
		"LAB-TRIPLE-MARKER",
		"LAB-DOUBLE-MARKER-TEST-USG-REPORT-WEIGHT-LMP-DOB",
		"LAB-ALLERGY-PROFILE",
		"LAB-PERIPHERAL-SMEAR",
		"LAB-UREA",
		"LAB-FSH",
	]
	rows = frappe.get_all(
		"Diagnostic Test Master",
		filters={"item": ["in", wanted_items]},
		fields=[
			"name",
			"item",
			"result_layout",
			"uses_age_related_ranges",
			"is_table_format",
			"is_descriptive",
			"allow_graph_upload",
			"has_linked_clinical_fields",
		],
		order_by="result_layout asc, name asc",
	)
	# Also include any dedicated seed names even if item link differs historically
	extra_names = [
		"URIC (LAB-URIC-ACID)",
		"TOTAL IgE",
		"WIDAL TEST",
		"Hb% ELECTROPHORESIS",
		"TRIPLE MARKER",
		"PERIPHERAL SMEAR",
	]
	seen = {r.name for r in rows}
	for name in extra_names:
		if name in seen or not frappe.db.exists("Diagnostic Test Master", name):
			continue
		row = frappe.db.get_value(
			"Diagnostic Test Master",
			name,
			[
				"name",
				"item",
				"result_layout",
				"uses_age_related_ranges",
				"is_table_format",
				"is_descriptive",
				"allow_graph_upload",
				"has_linked_clinical_fields",
			],
			as_dict=True,
		)
		if row:
			rows.append(row)
			seen.add(name)
	return {"ok": True, "count": len(rows), "masters": rows}


def _find_master(*names, fuzzy=False):
	"""Resolve Diagnostic Test Master by exact name or Item code.

	Fuzzy LIKE is opt-in and skipped for short tokens (avoids PBS→PPBS).
	"""
	for name in names:
		if not name:
			continue
		if frappe.db.exists("Diagnostic Test Master", name):
			return frappe.get_doc("Diagnostic Test Master", name)
	for name in names:
		if not name:
			continue
		by_item = frappe.db.get_value("Diagnostic Test Master", {"item": name}, "name")
		if by_item:
			return frappe.get_doc("Diagnostic Test Master", by_item)
	if fuzzy:
		for name in names:
			if not name or len(str(name).strip()) < 8:
				continue
			like = frappe.db.get_value(
				"Diagnostic Test Master",
				{"test_name": ["like", f"%{name}%"]},
				"name",
			)
			if like:
				return frappe.get_doc("Diagnostic Test Master", like)
	return None


def _ensure_lab_item_group():
	if frappe.db.exists("Item Group", "Lab Tests"):
		return "Lab Tests"
	parent = "All Item Groups" if frappe.db.exists("Item Group", "All Item Groups") else None
	doc = frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": "Lab Tests",
			"parent_item_group": parent,
			"is_group": 0,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_lab_item(item_code, item_name, rate=200.0):
	"""Ensure a sellable Lab Tests Item exists for Bill Entry / TRF."""
	item_code = (item_code or "").strip()
	item_name = (item_name or item_code).strip()
	if not item_code:
		frappe.throw("item_code required")
	if frappe.db.exists("Item", item_code):
		frappe.db.set_value("Item", item_code, {"disabled": 0, "is_sales_item": 1}, update_modified=False)
		return item_code

	group = _ensure_lab_item_group()
	uom = "Nos" if frappe.db.exists("UOM", "Nos") else (frappe.db.get_value("UOM", {}, "name") or "Unit")
	doc = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": item_code,
			"item_name": item_name,
			"item_group": group,
			"stock_uom": uom,
			"is_stock_item": 0,
			"is_sales_item": 1,
			"is_purchase_item": 0,
			"include_item_in_manufacturing": 0,
			"standard_rate": flt(rate) or 200.0,
			"description": item_name,
		}
	)
	doc.insert(ignore_permissions=True)
	return item_code


def _ensure_department():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase56_lab_parameters import (
			_ensure_pathology_department,
		)

		name = _ensure_pathology_department()
		if name:
			return name
	except Exception:
		pass
	name = frappe.db.get_value("Clinical Department", {"department_name": "Pathology"}, "name")
	if name:
		return name
	name = frappe.db.get_value("Clinical Department", {}, "name", order_by="creation asc")
	return name


def _get_or_create_master(
	*names,
	item_code,
	test_name,
	report_category="CLINICAL BIOCHEMISTRY",
	nabl_discipline=None,
	rate=200.0,
):
	"""Find existing master or create Item + Diagnostic Test Master for format seeding."""
	# Prefer link by intended item_code first so we never hijack unrelated masters.
	doc = None
	if item_code and frappe.db.exists("Diagnostic Test Master", {"item": item_code}):
		doc = frappe.get_doc("Diagnostic Test Master", {"item": item_code})
	if not doc:
		doc = _find_master(*names, item_code, test_name, fuzzy=False)
	_ensure_lab_item(item_code, test_name, rate=rate)
	if doc and doc.item and doc.item != item_code:
		# Master exists under a different billable item — create a dedicated seed master.
		doc = None
	if doc:
		changed = False
		if not doc.item:
			doc.item = item_code
			changed = True
		if not (doc.lis_code or "").strip():
			doc.lis_code = item_code
			changed = True
		if report_category and not (doc.report_category or "").strip():
			doc.report_category = report_category
			changed = True
		if nabl_discipline and hasattr(doc, "nabl_discipline") and not doc.nabl_discipline:
			doc.nabl_discipline = nabl_discipline
			changed = True
		if changed:
			doc.save(ignore_permissions=True)
		return doc

	department = _ensure_department()
	if not department:
		frappe.throw("Clinical Department missing — cannot seed Diagnostic Test Master")

	payload = {
		"doctype": "Diagnostic Test Master",
		"test_name": test_name[:140],
		"department": department,
		"item": item_code,
		"lis_code": item_code,
		"report_category": report_category,
		"parameters": [],
	}
	if nabl_discipline and frappe.get_meta("Diagnostic Test Master").has_field("nabl_discipline"):
		payload["nabl_discipline"] = nabl_discipline
	if frappe.db.exists("Diagnostic Test Master", payload["test_name"]):
		payload["test_name"] = f"{test_name[:110]} ({item_code})"[:140]
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	return doc


def _revert_wrong_descriptive_hijack():
	"""Undo PBS→PPBS fuzzy-match damage from an earlier seed run."""
	suspects = frappe.get_all(
		"Diagnostic Test Master",
		filters={"is_descriptive": 1, "result_layout": "Descriptive"},
		fields=["name", "item", "test_name"],
	)
	fixed = []
	for row in suspects:
		item = (row.item or "").upper()
		name = (row.name or "").upper()
		if item == "LAB-PERIPHERAL-SMEAR" or "PERIPHERAL" in name:
			continue
		# Restore numeric biochemistry-style masters accidentally marked Descriptive
		doc = frappe.get_doc("Diagnostic Test Master", row.name)
		doc.result_layout = "Numeric Profile"
		doc.is_descriptive = 0
		doc.descriptive_placeholder = None
		doc.save(ignore_permissions=True)
		fixed.append(doc.name)
	return fixed


def _seed_serum_urea():
	"""Legacy-style Serum Urea — Y/M/D paediatric bands (Same as Male screenshot)."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("uses_age_related_ranges"):
		return None
	if not frappe.get_meta("Diagnostic Test Reference Range").has_field("age_from_days"):
		return None

	doc = _get_or_create_master(
		"SERUM UREA",
		"Serum Urea",
		"UREA",
		"LAB-UREA",
		item_code="LAB-UREA",
		test_name="SERUM UREA",
		report_category="CLINICAL BIOCHEMISTRY",
		nabl_discipline="Clinical Biochemistry",
		rate=180,
	)
	doc.result_layout = "Numeric Profile"
	doc.uses_age_related_ranges = 1
	doc.machine_method = doc.machine_method or "UREASE"
	doc.report_heading_1 = doc.report_heading_1 or "CLINICAL BIOCHEMISTRY"
	doc.report_category = "CLINICAL BIOCHEMISTRY"
	param_code = "Serum Urea"
	param_name = "Serum Urea"
	if not doc.parameters:
		doc.append(
			"parameters",
			{
				"parameter_code": param_code,
				"parameter_name": param_name,
				"unit": "mg/dl",
				"result_input_type": "Numeric",
				"normal_min": 10,
				"normal_max": 50,
				"method": "UREASE",
			},
		)
	else:
		doc.parameters[0].parameter_code = doc.parameters[0].parameter_code or param_code
		doc.parameters[0].parameter_name = doc.parameters[0].parameter_name or param_name
		doc.parameters[0].result_input_type = "Numeric"
		if not doc.parameters[0].unit:
			doc.parameters[0].unit = "mg/dl"
		param_code = (doc.parameters[0].parameter_code or param_code).strip()
		param_name = (doc.parameters[0].parameter_name or param_name).strip()

	kept = []
	for row in doc.reference_ranges or []:
		key = _param_key(row.parameter_code, row.parameter_name)
		if key not in (_param_key(param_code, param_name), "serum urea", "urea"):
			kept.append(row)
	doc.set("reference_ranges", [])
	for row in kept:
		doc.append("reference_ranges", row.as_dict())

	bands = [
		dict(
			age_from_years=0,
			age_from_months=0,
			age_from_days=0,
			age_to_years=0,
			age_to_months=0,
			age_to_days=28,
			normal_min=7,
			normal_max=26,
			display_label="7 - 26 mg/dl",
		),
		dict(
			age_from_years=0,
			age_from_months=0,
			age_from_days=29,
			age_to_years=14,
			age_to_months=0,
			age_to_days=0,
			normal_min=11,
			normal_max=39,
			display_label="11 - 39 mg/dl",
		),
		dict(
			age_from_years=14,
			age_from_months=0,
			age_from_days=0,
			age_to_years=99,
			age_to_months=0,
			age_to_days=0,
			normal_min=10,
			normal_max=50,
			display_label="10 - 50 mg/dl",
		),
	]
	for band in bands:
		doc.append(
			"reference_ranges",
			{
				"parameter_code": param_code,
				"parameter_name": param_name,
				"gender": "Both",
				"cycle_phase": "Any",
				**band,
			},
		)
	doc.save(ignore_permissions=True)
	return doc.name


def _seed_fsh_cycle_example():
	"""Example hormone master using menstrual cycle day bands."""
	if not frappe.get_meta("Diagnostic Test Reference Range").has_field("cycle_day_from"):
		return None
	doc = _get_or_create_master(
		"FSH",
		"FSH (Follicle Stimulating Hormone)",
		"LAB-FSH",
		item_code="LAB-FSH",
		test_name="FSH",
		report_category="DEPARTMENT OF IMMUNOLOGY",
		nabl_discipline="Serology and Immunology",
		rate=550,
	)
	doc.result_layout = "Numeric Profile"
	doc.uses_age_related_ranges = 1
	doc.machine_method = doc.machine_method or "CLIA"
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF IMMUNOLOGY"
	if not doc.parameters:
		doc.append(
			"parameters",
			{
				"parameter_code": "FSH",
				"parameter_name": "FSH",
				"unit": "mIU/mL",
				"result_input_type": "Numeric",
				"normal_min": 2,
				"normal_max": 12,
				"method": "CLIA",
			},
		)
	code = (doc.parameters[0].parameter_code or "FSH").strip()
	name = doc.parameters[0].parameter_name or "FSH"
	doc.set("reference_ranges", [])
	cycle_bands = [
		(1, 13, "Follicular (1-13)", 2.5, 10.2),
		(14, 14, "Ovulatory (14)", 3.4, 33.4),
		(15, 28, "Luteal (15-28)", 1.5, 9.1),
	]
	for cf, ct, phase, low, high in cycle_bands:
		doc.append(
			"reference_ranges",
			{
				"parameter_code": code,
				"parameter_name": name,
				"gender": "Female",
				"age_from_years": 12,
				"age_to_years": 55,
				"cycle_day_from": cf,
				"cycle_day_to": ct,
				"cycle_phase": phase,
				"normal_min": low,
				"normal_max": high,
				"display_label": f"{low} - {high} mIU/mL ({phase})",
			},
		)
	doc.append(
		"reference_ranges",
		{
			"parameter_code": code,
			"parameter_name": name,
			"gender": "Female",
			"age_from_years": 45,
			"age_to_years": 120,
			"cycle_phase": "Post-menopausal",
			"normal_min": 25.8,
			"normal_max": 134.8,
			"display_label": "25.8 - 134.8 mIU/mL (Post-menopausal)",
		},
	)
	doc.save(ignore_permissions=True)
	return doc.name


def smoke_ymd_and_cycle_ranges():
	"""Verify Serum Urea Y/M/D + FSH cycle-day matching."""
	ensure_phase88_doctypes()
	urea_name = _seed_serum_urea()
	fsh_name = _seed_fsh_cycle_example()
	frappe.db.commit()

	urea = frappe.get_doc("Diagnostic Test Master", urea_name) if urea_name else None
	fsh = frappe.get_doc("Diagnostic Test Master", fsh_name) if fsh_name else None
	out = {"ok": False, "urea_master": urea_name, "fsh_master": fsh_name}

	if urea and urea.parameters:
		p = urea.parameters[0]
		neo = resolve_parameter_bounds(urea, p, age_years=0, age_months=0, age_days=10, gender="Male")
		child = resolve_parameter_bounds(urea, p, age_years=5, age_months=0, age_days=0, gender="Female")
		adult = resolve_parameter_bounds(urea, p, age_years=30, gender="Male")
		out["urea"] = {"neonate_10d": neo, "child_5y": child, "adult_30y": adult}
		urea_ok = (
			flt(neo.get("normal_min")) == 7
			and flt(neo.get("normal_max")) == 26
			and flt(child.get("normal_min")) == 11
			and flt(adult.get("normal_min")) == 10
			and cint(neo.get("matched_age_band")) == 1
		)
	else:
		urea_ok = False

	if fsh and fsh.parameters:
		p = fsh.parameters[0]
		fol = resolve_parameter_bounds(fsh, p, age_years=28, gender="Female", menstrual_cycle_day=5)
		ov = resolve_parameter_bounds(fsh, p, age_years=28, gender="Female", menstrual_cycle_day=14)
		post = resolve_parameter_bounds(fsh, p, age_years=55, gender="Female", menstrual_cycle_day=None)
		out["fsh"] = {"follicular_d5": fol, "ovulatory_d14": ov, "post": post}
		fsh_ok = (
			flt(fol.get("normal_min")) == 2.5
			and flt(ov.get("normal_min")) == 3.4
			and flt(post.get("normal_min")) == 25.8
		)
	else:
		fsh_ok = False

	meta = frappe.get_meta("Diagnostic Test Reference Range")
	grid = [df.fieldname for df in meta.fields if cint(df.in_list_view)]
	out["grid_list_view_fields"] = grid
	grid_ok = all(
		f in grid
		for f in (
			"age_from_years",
			"age_from_months",
			"age_from_days",
			"age_to_years",
			"age_to_months",
			"age_to_days",
			"cycle_day_from",
			"cycle_day_to",
		)
	)
	out["ok"] = bool(urea_ok and fsh_ok and grid_ok)
	out["urea_ok"] = urea_ok
	out["fsh_ok"] = fsh_ok
	out["grid_ok"] = grid_ok
	return out


def _seed_uric_acid():
	"""Numeric Profile — Male 3.5–6.0 / Female 2.5–5.0 mg/dl (adult bands)."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("uses_age_related_ranges"):
		return None
	if not frappe.get_meta("Diagnostic Test Reference Range").has_field("normal_min"):
		return None

	doc = _get_or_create_master(
		"URIC (LAB-URIC-ACID)",
		"Uric Acid",
		"URIC",
		"LAB-URIC-ACID",
		item_code="LAB-URIC-ACID",
		test_name="URIC (LAB-URIC-ACID)",
		report_category="CLINICAL BIOCHEMISTRY",
		nabl_discipline="Clinical Biochemistry",
		rate=200,
	)

	doc.result_layout = "Numeric Profile"
	doc.uses_age_related_ranges = 1
	doc.is_descriptive = 0
	doc.is_table_format = 0
	doc.machine_method = doc.machine_method or "Enzymatic"
	doc.report_heading_1 = doc.report_heading_1 or "CLINICAL BIOCHEMISTRY"
	doc.report_category = doc.report_category or "CLINICAL BIOCHEMISTRY"

	param_code = "Serum Uric Acid"
	param_name = "Serum Uric Acid"
	if not doc.parameters:
		doc.append(
			"parameters",
			{
				"parameter_code": param_code,
				"parameter_name": param_name,
				"unit": "mg/dl",
				"result_input_type": "Numeric",
				"normal_min": 3.5,
				"normal_max": 6.0,
				"default_value": "7",
				"method": "Enzymatic",
			},
		)
	else:
		row = doc.parameters[0]
		param_code = (row.parameter_code or param_code).strip() or param_code
		param_name = (row.parameter_name or param_name).strip() or param_name
		if not row.parameter_code:
			row.parameter_code = param_code
		row.parameter_name = (row.parameter_name or param_name).strip()
		row.result_input_type = "Numeric"
		if not row.unit:
			row.unit = "mg/dl"
		if flt(getattr(row, "critical_min", 0) or 0) == 0:
			row.critical_min = None
		if flt(getattr(row, "critical_max", 0) or 0) == 0:
			row.critical_max = None

	kept = []
	for row in doc.reference_ranges or []:
		key = _param_key(row.parameter_code, row.parameter_name)
		if key not in (_param_key(param_code, param_name), "serum uric acid", "uric acid", "uric"):
			kept.append(row)
	doc.set("reference_ranges", [])
	for row in kept:
		doc.append("reference_ranges", row.as_dict())

	for gender, low, high in (("Male", 3.5, 6.0), ("Female", 2.5, 5.0)):
		doc.append(
			"reference_ranges",
			{
				"parameter_code": param_code,
				"parameter_name": param_name,
				"gender": gender,
				"age_from_years": 0,
				"age_to_years": 120,
				"normal_min": low,
				"normal_max": high,
				"display_label": f"{low} - {high} mg/dl",
			},
		)
	doc.save(ignore_permissions=True)
	return doc.name


def smoke_uric_acid_ranges():
	"""Verify Uric Acid Male/Female bands resolve correctly."""
	ensure_phase88_doctypes()
	_seed_uric_acid()
	frappe.db.commit()

	doc = _find_master("URIC (LAB-URIC-ACID)", "Uric Acid", "URIC", "LAB-URIC-ACID")
	if not doc:
		return {"ok": False, "error": "Diagnostic Test Master for Uric Acid not found"}

	meta = frappe.get_meta("Diagnostic Test Reference Range")
	has_limits = meta.has_field("normal_min") and meta.has_field("normal_max")
	grid_fields = [df.fieldname for df in meta.fields if cint(df.in_list_view)]

	param = (doc.parameters or [None])[0]
	if not param:
		return {"ok": False, "error": "No parameter row on Uric master", "master": doc.name}

	male = resolve_parameter_bounds(doc, param, age_years=23, gender="Male")
	female = resolve_parameter_bounds(doc, param, age_years=23, gender="Female")

	ok = (
		has_limits
		and "normal_min" in grid_fields
		and "normal_max" in grid_fields
		and flt(male.get("normal_min")) == 3.5
		and flt(male.get("normal_max")) == 6.0
		and flt(female.get("normal_min")) == 2.5
		and flt(female.get("normal_max")) == 5.0
		and cint(male.get("matched_age_band")) == 1
		and cint(female.get("matched_age_band")) == 1
	)
	return {
		"ok": ok,
		"master": doc.name,
		"uses_age_related_ranges": cint(doc.uses_age_related_ranges),
		"band_count": len(doc.reference_ranges or []),
		"grid_list_view_fields": grid_fields,
		"male_23y": male,
		"female_23y": female,
	}


def _seed_total_ige():
	"""Numeric Profile — pediatric/adult IgE age bands (IU/mL)."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("uses_age_related_ranges"):
		return None
	doc = _get_or_create_master(
		"TOTAL IgE",
		"Total IgE",
		"IgE",
		"LAB-TOTAL-IGE",
		item_code="LAB-TOTAL-IGE",
		test_name="TOTAL IgE",
		report_category="DEPARTMENT OF IMMUNOLOGY",
		nabl_discipline="Serology and Immunology",
		rate=450,
	)
	doc.result_layout = "Numeric Profile"
	doc.uses_age_related_ranges = 1
	doc.machine_method = doc.machine_method or "CLIA"
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF IMMUNOLOGY"
	doc.report_category = doc.report_category or "DEPARTMENT OF IMMUNOLOGY"
	if not doc.parameters:
		doc.append(
			"parameters",
			{
				"parameter_code": "TIgE",
				"parameter_name": "TOTAL IgE",
				"unit": "IU/mL",
				"result_input_type": "Numeric",
				"normal_min": 0,
				"normal_max": 100,
				"method": "CLIA",
			},
		)
	else:
		doc.parameters[0].result_input_type = "Numeric"
	code = (doc.parameters[0].parameter_code or "TIgE").strip()
	name = doc.parameters[0].parameter_name
	doc.set("reference_ranges", [])
	bands = [
		(0, 0, 1, 0, 0, 1, 0, 15),
		(0, 0, 1, 1, 0, 0, 0, 30),
		(1, 0, 1, 5, 11, 29, 0, 60),
		(6, 0, 0, 9, 11, 29, 0, 90),
		(10, 0, 0, 15, 11, 29, 0, 200),
		(16, 0, 0, 120, 0, 0, 0, 100),
	]
	for gender in ("Male", "Female"):
		for afy, afm, afd, aty, atm, atd, low, high in bands:
			doc.append(
				"reference_ranges",
				{
					"parameter_code": code,
					"parameter_name": name,
					"gender": gender,
					"age_from_years": afy,
					"age_from_months": afm,
					"age_from_days": afd,
					"age_to_years": aty,
					"age_to_months": atm,
					"age_to_days": atd,
					"normal_min": low,
					"normal_max": high,
				},
			)
	doc.save(ignore_permissions=True)
	return doc.name


def _seed_abo_grouping():
	"""Choice List — observed ABO/Rh group selected from a dropdown."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("result_layout"):
		return None
	doc = _get_or_create_master(
		"BLOOD GROUPING (ABO & Rh)",
		"Blood Grouping ABO (Rh)",
		"ABO",
		"LAB-ABO",
		item_code="LAB-ABO",
		test_name="BLOOD GROUPING (ABO & Rh)",
		report_category="DEPARTMENT OF HAEMATOLOGY",
		nabl_discipline="Haematology",
		rate=150,
	)
	apply_template_rows(doc, abo_grouping_template(), "Numeric Profile")
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF HAEMATOLOGY"
	doc.report_heading_2 = doc.report_heading_2 or "ABO & Rh BLOOD GROUPING"
	doc.machine_method = doc.machine_method or "Tube / Column agglutination"
	doc.save(ignore_permissions=True)
	return doc.name


def _seed_widal():
	"""Table Matrix — semi-quantitative titre Choice Lists."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("is_table_format"):
		return None
	doc = _get_or_create_master(
		"WIDAL TEST",
		"Widal",
		"LAB-WIDAL",
		item_code="LAB-WIDAL",
		test_name="WIDAL TEST",
		report_category="DEPARTMENT OF SEROLOGY",
		nabl_discipline="Serology and Immunology",
		rate=250,
	)
	doc.result_layout = "Table Matrix"
	doc.is_table_format = 1
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF SEROLOGY"
	doc.report_heading_2 = doc.report_heading_2 or "REPORT ON EXAMINATION OF BLOOD"
	wanted = (
		("84", 'S. typhi "O"'),
		("85", 'S. typhi "H"'),
		("86", 'S. paratyphi "A" (H)'),
		("87", 'S. paratyphi "B" (H)'),
	)
	existing_codes = {(p.parameter_code or "") for p in (doc.parameters or [])}
	for code, title in wanted:
		if code in existing_codes:
			continue
		doc.append(
			"parameters",
			{
				"parameter_code": code,
				"parameter_name": title,
				"result_input_type": "Choice List",
				"choice_options": "Negative\n1:20\n1:40\n1:80\n1:160\n1:320",
				"default_value": "Negative",
				"parameter_kind": "Real",
			},
		)
	for p in doc.parameters:
		if not getattr(p, "result_input_type", None) or p.result_input_type == "Numeric":
			p.result_input_type = "Choice List"
			p.choice_options = p.choice_options or "Negative\n1:20\n1:40\n1:80\n1:160\n1:320"
	doc.save(ignore_permissions=True)
	return doc.name


def _seed_hplc():
	"""Graph + Values — HPLC chromatogram + % fractions."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("allow_graph_upload"):
		return None
	doc = _get_or_create_master(
		"Hb% ELECTROPHORESIS",
		"ELECTROPHORESIS (HPLC)",
		"HPLC",
		"LAB-HPLC-HB",
		item_code="LAB-HPLC-HB",
		test_name="Hb% ELECTROPHORESIS",
		report_category="DEPARTMENT OF HAEMATOLOGY",
		nabl_discipline="Haematology",
		rate=900,
	)
	doc.result_layout = "Graph + Values"
	doc.allow_graph_upload = 1
	doc.graph_label = "HPLC Chromatogram"
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF HAEMATOLOGY"
	doc.report_heading_2 = doc.report_heading_2 or "REPORT ON EXAMINATION OF BLOOD"
	wanted = [
		("HEAD", "Hb ELECTROPHORESIS", "Heading", "Bold Underline"),
		("HbA0", "Haemoglobin A0", "Numeric", "Normal"),
		("HbA2", "Haemoglobin A2", "Numeric", "Normal"),
		("HbF", "Haemoglobin F", "Numeric", "Normal"),
	]
	if not doc.parameters:
		for code, name, rtype, style in wanted:
			doc.append(
				"parameters",
				{
					"parameter_code": code,
					"parameter_name": name,
					"result_input_type": rtype,
					"print_style": style,
					"unit": "%" if rtype == "Numeric" else "",
				},
			)
	doc.save(ignore_permissions=True)
	return doc.name


def _seed_triple_marker():
	"""Composite Linked — clinical fields + analytes + MoMs / risks."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("has_linked_clinical_fields"):
		return None
	doc = _get_or_create_master(
		"TRIPLE MARKER",
		"Triple Marker",
		"Triple test",
		"LAB-TRIPLE-MARKER",
		item_code="LAB-TRIPLE-MARKER",
		test_name="TRIPLE MARKER",
		report_category="DEPARTMENT OF IMMUNOLOGY",
		nabl_discipline="Serology and Immunology",
		rate=2200,
	)
	doc.result_layout = "Composite Linked"
	doc.has_linked_clinical_fields = 1
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF IMMUNOLOGY"
	doc.report_heading_2 = doc.report_heading_2 or "Triple test (14 - 22 WEEKS)*"
	if not doc.parameters:
		lines = [
			("899", "Clinical Details", "Descriptive Text", "Clinical Detail", "", None, None),
			("900", "Maternal Age", "Numeric", "Patient Age", "years", None, None),
			("901", "Maternal Weight", "Numeric", "Patient Weight", "kg", None, None),
			("902", "LMP DATE", "Date", "LMP Date", "", None, None),
			("903", "AFP", "Numeric", "Analyte Value", "ng/mL", None, 10.0),
			("904", "MoM AFP", "Numeric", "Calculated MoM", "MoM", 0.5, 2.0),
			("905", "Free Beta HCG", "Numeric", "Analyte Value", "ng/mL", None, None),
			("906", "MoM Free Beta HCG", "Numeric", "Calculated MoM", "MoM", 0.5, 2.0),
			("907", "Estriol, Unconjugated (uE3)", "Numeric", "Analyte Value", "ng/mL", None, None),
			("908", "MoM Estriol, Unconjugated (uE3)", "Numeric", "Calculated MoM", "MoM", 0.5, 2.0),
			("909", "Risk for Trisomy 18", "Descriptive Text", "Risk Score", "", None, None),
			("910", "Risk for Trisomy 21", "Descriptive Text", "Risk Score", "", None, None),
		]
		for code, name, rtype, role, unit, nmin, nmax in lines:
			doc.append(
				"parameters",
				{
					"parameter_code": code,
					"parameter_name": name,
					"result_input_type": rtype,
					"linked_info_role": role,
					"unit": unit,
					"normal_min": nmin,
					"normal_max": nmax,
				},
			)
	doc.save(ignore_permissions=True)
	return doc.name


def _double_marker_parameter_lines():
	"""First-trimester Dual / Double Marker (PAPP-A + free β-hCG) + USG-linked fields."""
	# code, name, result_input_type, linked_info_role, unit, normal_min, normal_max, method
	return [
		("DM-CLIN", "Clinical Details", "Descriptive Text", "Clinical Detail", "", None, None, ""),
		("DM-AGE", "Maternal Age", "Numeric", "Patient Age", "years", None, None, ""),
		("DM-WT", "Maternal Weight", "Numeric", "Patient Weight", "kg", None, None, ""),
		("DM-LMP", "LMP Date", "Date", "LMP Date", "", None, None, ""),
		("DM-GA", "Gestational Age (by USG)", "Numeric", "Gestational Age", "weeks", 9.0, 14.0, "Ultrasound"),
		("DM-CRL", "CRL (Crown Rump Length)", "Numeric", "Other", "mm", None, None, "Ultrasound"),
		("DM-NT", "Nuchal Translucency (NT)", "Numeric", "Other", "mm", None, None, "Ultrasound"),
		("DM-NT-MOM", "MoM NT", "Numeric", "Calculated MoM", "MoM", 0.5, 2.0, "Calculated"),
		(
			"DM-PAPPA",
			"PAPP-A (Pregnancy Associated Plasma Protein-A)",
			"Numeric",
			"Analyte Value",
			"mIU/mL",
			None,
			None,
			"CLIA / CMIA",
		),
		("DM-PAPPA-MOM", "MoM PAPP-A", "Numeric", "Calculated MoM", "MoM", 0.5, 2.5, "Calculated"),
		("DM-FBHCG", "Free Beta hCG", "Numeric", "Analyte Value", "ng/mL", None, None, "CLIA / CMIA"),
		("DM-FBHCG-MOM", "MoM Free Beta hCG", "Numeric", "Calculated MoM", "MoM", 0.5, 2.0, "Calculated"),
		("DM-RISK21", "Risk for Trisomy 21 (Down Syndrome)", "Descriptive Text", "Risk Score", "", None, None, ""),
		("DM-RISK18", "Risk for Trisomy 18 (Edwards Syndrome)", "Descriptive Text", "Risk Score", "", None, None, ""),
		("DM-RISK13", "Risk for Trisomy 13 (Patau Syndrome)", "Descriptive Text", "Risk Score", "", None, None, ""),
		("DM-SCREEN", "Screen Interpretation", "Descriptive Text", "Other", "", None, None, ""),
	]


def _apply_composite_parameter_lines(doc, lines, *, replace=True):
	if replace:
		doc.set("parameters", [])
	elif doc.parameters:
		return
	for code, name, rtype, role, unit, nmin, nmax, method in lines:
		row = {
			"parameter_code": code,
			"parameter_name": name,
			"result_input_type": rtype,
			"linked_info_role": role,
			"unit": unit or "",
			"normal_min": nmin,
			"normal_max": nmax,
			"parameter_kind": "Calculated" if role == "Calculated MoM" else "Real",
			"is_calculated": 1 if role == "Calculated MoM" else 0,
		}
		if method:
			row["method"] = method
		doc.append("parameters", row)


def _seed_double_marker(force=1):
	"""Composite Linked — first trimester Dual / Double Marker (PAPP-A + free β-hCG)."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("has_linked_clinical_fields"):
		return None
	force = cint(force)
	doc = _get_or_create_master(
		"Double Marker TEST USG Report Weight LMP (Dob)",
		"Double Marker",
		"Dual Marker",
		"Double Marker Test",
		"LAB-DOUBLE-MARKER-TEST-USG-REPORT-WEIGHT-LMP-DOB",
		item_code="LAB-DOUBLE-MARKER-TEST-USG-REPORT-WEIGHT-LMP-DOB",
		test_name="Double Marker TEST USG Report Weight LMP (Dob)",
		report_category="DEPARTMENT OF IMMUNOLOGY",
		nabl_discipline="Serology and Immunology",
		rate=1800,
	)
	doc.result_layout = "Composite Linked"
	doc.has_linked_clinical_fields = 1
	doc.is_descriptive = 0
	doc.uses_age_related_ranges = 0
	doc.report_heading_1 = "DEPARTMENT OF IMMUNOLOGY"
	doc.report_heading_2 = "Double / Dual Marker (9 – 13+6 weeks)*"
	doc.machine_method = doc.machine_method or "CLIA / CMIA + USG NT"
	doc.interpretation = (
		doc.interpretation
		or "First-trimester maternal serum screening using PAPP-A and free β-hCG, "
		"combined with maternal demographics and nuchal translucency (NT) from USG. "
		"Results are reported as Multiples of the Median (MoM). Typical MoM reference "
		"is approximately 0.5–2.0 (lab-specific medians apply). Screen cut-offs commonly "
		"use ~1:250 for Trisomy 21 — interpret with obstetrician."
	)
	_apply_composite_parameter_lines(
		doc,
		_double_marker_parameter_lines(),
		replace=force or not (doc.parameters or []),
	)
	# Clear wrong age bands if any
	if doc.reference_ranges:
		doc.set("reference_ranges", [])
	doc.save(ignore_permissions=True)
	return doc.name


def repair_double_dual_marker_masters(force=1):
	"""Rebuild Double/Dual Marker (+ related PAPP-A / Free β-hCG singles) correctly."""
	force = cint(force)
	fixed = {"double_marker": None, "pappa": None, "free_beta_hcg": None, "matched": []}

	# 1) Primary Double Marker master
	fixed["double_marker"] = _seed_double_marker(force=force)

	# Any other masters whose name/item looks like double/dual marker screening
	candidates = frappe.db.sql(
		"""
		SELECT name, item FROM `tabDiagnostic Test Master`
		WHERE LOWER(name) LIKE '%%double marker%%'
		   OR LOWER(name) LIKE '%%dual marker%%'
		   OR LOWER(IFNULL(item,'')) LIKE '%%double-marker%%'
		   OR LOWER(IFNULL(item,'')) LIKE '%%dual-marker%%'
		""",
		as_dict=1,
	)
	for row in candidates:
		fixed["matched"].append(row.name)
		if row.name == fixed["double_marker"]:
			continue
		doc = frappe.get_doc("Diagnostic Test Master", row.name)
		doc.result_layout = "Composite Linked"
		doc.has_linked_clinical_fields = 1
		doc.is_descriptive = 0
		doc.uses_age_related_ranges = 0
		doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF IMMUNOLOGY"
		doc.report_heading_2 = doc.report_heading_2 or "Double / Dual Marker (9 – 13+6 weeks)*"
		_apply_composite_parameter_lines(doc, _double_marker_parameter_lines(), replace=True)
		doc.set("reference_ranges", [])
		doc.save(ignore_permissions=True)

	# 2) Standalone PAPP-A
	if frappe.db.exists("Diagnostic Test Master", {"item": "LAB-PAPPA-A-2"}):
		pappa = frappe.get_doc("Diagnostic Test Master", {"item": "LAB-PAPPA-A-2"})
	elif frappe.db.exists("Diagnostic Test Master", "PAPPA-a"):
		pappa = frappe.get_doc("Diagnostic Test Master", "PAPPA-a")
	else:
		pappa = None
	if pappa:
		pappa.result_layout = "Numeric Profile"
		pappa.has_linked_clinical_fields = 0
		pappa.report_category = pappa.report_category or "DEPARTMENT OF IMMUNOLOGY"
		pappa.set("parameters", [])
		pappa.append(
			"parameters",
			{
				"parameter_code": "PAPPA",
				"parameter_name": "PAPP-A (Pregnancy Associated Plasma Protein-A)",
				"result_input_type": "Numeric",
				"unit": "mIU/mL",
				"method": "CLIA / CMIA",
				"linked_info_role": "Analyte Value",
				"parameter_kind": "Real",
				"is_calculated": 0,
				"interpretation": "Interpret with gestational age; screening use is via MoM in Double Marker.",
			},
		)
		pappa.set("reference_ranges", [])
		pappa.uses_age_related_ranges = 0
		pappa.save(ignore_permissions=True)
		fixed["pappa"] = pappa.name

	# 3) Standalone Free Beta hCG (was wrongly given FT4 ranges)
	if frappe.db.exists("Diagnostic Test Master", {"item": "LAB-FREE-BETA-HCG"}):
		fb = frappe.get_doc("Diagnostic Test Master", {"item": "LAB-FREE-BETA-HCG"})
	elif frappe.db.exists("Diagnostic Test Master", "FREE"):
		fb = frappe.get_doc("Diagnostic Test Master", "FREE")
	else:
		fb = None
	if fb:
		fb.result_layout = "Numeric Profile"
		fb.has_linked_clinical_fields = 0
		fb.report_category = fb.report_category or "DEPARTMENT OF IMMUNOLOGY"
		fb.set("parameters", [])
		fb.append(
			"parameters",
			{
				"parameter_code": "FREE_BETA_HCG",
				"parameter_name": "Free Beta hCG",
				"result_input_type": "Numeric",
				"unit": "ng/mL",
				"method": "CLIA / CMIA",
				"linked_info_role": "Analyte Value",
				"parameter_kind": "Real",
				"is_calculated": 0,
				"interpretation": "First-trimester screening marker; use MoM with Double Marker panel.",
			},
		)
		fb.set("reference_ranges", [])
		fb.uses_age_related_ranges = 0
		fb.save(ignore_permissions=True)
		fixed["free_beta_hcg"] = fb.name

	frappe.db.commit()
	return {"ok": True, **fixed}


def _allergy_ige_row(code, name, heading="", unit="kUA/L", nmax=0.35, rtype="Numeric", choices=None):
	row = {
		"parameter_code": code,
		"parameter_name": name,
		"result_input_type": rtype,
		"unit": unit if rtype == "Numeric" else "",
		"normal_min": 0.0 if rtype == "Numeric" else None,
		"normal_max": nmax if rtype == "Numeric" else None,
		"method": "ImmunoCAP / FEIA",
		"before_heading": heading or "",
		"linked_info_role": "Analyte Value" if rtype == "Numeric" else "None",
		"parameter_kind": "Real",
		"is_calculated": 0,
		"interpretation": (
			"Specific IgE < 0.35 kUA/L = Class 0 (Negative). "
			"0.35–0.70 Class 1; 0.71–3.50 Class 2; 3.51–17.50 Class 3; "
			"17.51–50 Class 4; 50.01–100 Class 5; >100 Class 6."
			if rtype == "Numeric" and unit == "kUA/L"
			else ""
		),
	}
	if choices:
		row["choice_options"] = choices
	return row


def _allergy_profile_parameter_lines():
	"""Adult Allergy Profile — Total IgE + common inhalant/food specific IgE (ImmunoCAP-style)."""
	rows = []
	rows.append(
		_allergy_ige_row(
			"ALG-TIGE",
			"Total IgE",
			heading="Allergy Screening",
			unit="IU/mL",
			nmax=100.0,
		)
	)
	rows[-1]["interpretation"] = (
		"Adult Total IgE reference is method-dependent (often <100 IU/mL). "
		"Elevated Total IgE supports atopy but does not identify the allergen."
	)
	rows.append(
		_allergy_ige_row(
			"ALG-PHAD",
			"Phadiatop (Inhalant Allergy Screen)",
			rtype="Choice List",
			choices="Negative\nPositive",
		)
	)
	rows[-1]["default_value"] = "Negative"
	rows[-1]["interpretation"] = "Positive indicates sensitisation to one or more common inhalant allergens."

	inhalants = [
		("ALG-HD", "House Dust"),
		("ALG-DPT", "Dermatophagoides pteronyssinus (Dust Mite)"),
		("ALG-DFA", "Dermatophagoides farinae (Dust Mite)"),
		("ALG-COCK", "Cockroach (German)"),
		("ALG-CAT", "Cat Epithelium & Dander"),
		("ALG-DOG", "Dog Dander"),
		("ALG-ALT", "Alternaria alternata (Mold)"),
		("ALG-ASPF", "Aspergillus fumigatus (Mold)"),
		("ALG-BERM", "Bermuda Grass (Cynodon)"),
		("ALG-JOHN", "Johnson Grass"),
		("ALG-TIM", "Timothy Grass"),
		("ALG-RAG", "Ragweed"),
		("ALG-ACA", "Acacia"),
		("ALG-ELM", "Elm"),
		("ALG-MES", "Mesquite"),
	]
	for i, (code, name) in enumerate(inhalants):
		rows.append(
			_allergy_ige_row(
				code,
				name,
				heading="Inhalant / Environmental Allergens" if i == 0 else "",
			)
		)

	veg_foods = [
		("ALG-MILK", "Cow Milk"),
		("ALG-EGG", "Egg White"),
		("ALG-WHT", "Wheat"),
		("ALG-GLU", "Gluten"),
		("ALG-SOY", "Soybean"),
		("ALG-PEA", "Peanut"),
		("ALG-RICE", "Rice"),
		("ALG-POT", "Potato"),
		("ALG-LEM", "Lemon"),
		("ALG-PIN", "Pineapple"),
		("ALG-ALM", "Almond"),
		("ALG-LEN", "Lentil"),
	]
	for i, (code, name) in enumerate(veg_foods):
		rows.append(
			_allergy_ige_row(
				code,
				name,
				heading="Food Allergens — Vegetarian" if i == 0 else "",
			)
		)

	nonveg = [
		("ALG-CHK", "Chicken"),
		("ALG-FISH", "Fish (Cod)"),
		("ALG-SHR", "Shrimp / Prawn"),
	]
	for i, (code, name) in enumerate(nonveg):
		rows.append(
			_allergy_ige_row(
				code,
				name,
				heading="Food Allergens — Non-Vegetarian" if i == 0 else "",
			)
		)

	rows.append(
		{
			"parameter_code": "ALG-CLASS",
			"parameter_name": "Highest ImmunoCAP Class",
			"result_input_type": "Choice List",
			"choice_options": "0 - Negative\n1 - Weak\n2 - Moderate\n3 - High\n4 - Very High\n5 - Ultra High\n6 - Extremely High",
			"default_value": "0 - Negative",
			"before_heading": "Interpretation",
			"method": "ImmunoCAP / FEIA",
			"parameter_kind": "Real",
			"is_calculated": 0,
			"linked_info_role": "Other",
		}
	)
	rows.append(
		{
			"parameter_code": "ALG-NOTE",
			"parameter_name": "Clinical Comments",
			"result_input_type": "Descriptive Text",
			"default_value": (
				"Specific IgE indicates sensitisation; correlate with clinical history. "
				"Negative result does not completely exclude allergy."
			),
			"method": "",
			"parameter_kind": "Real",
			"is_calculated": 0,
			"linked_info_role": "Other",
		}
	)
	return rows


def _seed_allergy_profile(force=1):
	"""Numeric Profile — Allergy Profile (Total IgE + specific IgE panel)."""
	force = cint(force)
	doc = _get_or_create_master(
		"Allergy Profile",
		"Allergy Panel",
		"Atopic Allergy Panel",
		"LAB-ALLERGY-PROFILE",
		item_code="LAB-ALLERGY-PROFILE",
		test_name="Allergy Profile",
		report_category="DEPARTMENT OF IMMUNOLOGY",
		nabl_discipline="Serology and Immunology",
		rate=2500,
	)
	doc.result_layout = "Numeric Profile"
	doc.has_linked_clinical_fields = 0
	doc.is_descriptive = 0
	doc.is_table_format = 0
	doc.uses_age_related_ranges = 0
	doc.report_category = "DEPARTMENT OF IMMUNOLOGY"
	if hasattr(doc, "nabl_discipline"):
		doc.nabl_discipline = "Serology and Immunology"
	doc.report_heading_1 = "DEPARTMENT OF IMMUNOLOGY"
	doc.report_heading_2 = "ALLERGY PROFILE (Specific IgE — ImmunoCAP style)"
	doc.machine_method = "ImmunoCAP / FEIA"
	doc.interpretation = (
		"Allergy Profile measures Total IgE and allergen-specific IgE. "
		"Specific IgE < 0.35 kUA/L is Negative (Class 0). "
		"Results indicate sensitisation and must be interpreted with clinical history."
	)
	if force or not (doc.parameters or []) or len(doc.parameters or []) < 5:
		doc.set("parameters", [])
		for row in _allergy_profile_parameter_lines():
			doc.append("parameters", row)
	doc.set("reference_ranges", [])
	doc.save(ignore_permissions=True)
	return doc.name


def repair_allergy_profile_masters(force=1):
	"""Rebuild Allergy Profile masters that were collapsed to a single descriptive line."""
	force = cint(force)
	fixed = {"allergy_profile": None, "matched": []}
	fixed["allergy_profile"] = _seed_allergy_profile(force=force)

	candidates = frappe.db.sql(
		"""
		SELECT name, item FROM `tabDiagnostic Test Master`
		WHERE LOWER(name) LIKE '%%allerg%%'
		   OR LOWER(IFNULL(item,'')) LIKE '%%allerg%%'
		""",
		as_dict=1,
	)
	for row in candidates:
		fixed["matched"].append(row.name)
		if row.name == fixed["allergy_profile"]:
			continue
		# Skip Total IgE / single-allergen masters
		probe = f"{row.name} {row.item or ''}".lower()
		if "total ige" in probe or probe.strip() in ("ige", "lab-ige"):
			continue
		doc = frappe.get_doc("Diagnostic Test Master", row.name)
		# Only rebuild generic profile/panel masters
		if not any(k in probe for k in ("profile", "panel", "comprehensive", "atopic")):
			continue
		doc.result_layout = "Numeric Profile"
		doc.is_descriptive = 0
		doc.uses_age_related_ranges = 0
		doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF IMMUNOLOGY"
		doc.report_heading_2 = doc.report_heading_2 or "ALLERGY PROFILE (Specific IgE — ImmunoCAP style)"
		doc.set("parameters", [])
		for prow in _allergy_profile_parameter_lines():
			doc.append("parameters", prow)
		doc.set("reference_ranges", [])
		doc.save(ignore_permissions=True)

	frappe.db.commit()
	return {"ok": True, **fixed}


def _seed_descriptive():
	"""Descriptive — free-text morphology / narrative report (Peripheral Smear)."""
	if not frappe.get_meta("Diagnostic Test Master").has_field("is_descriptive"):
		return None
	doc = _get_or_create_master(
		"PERIPHERAL SMEAR",
		"Peripheral Blood Smear",
		"LAB-PERIPHERAL-SMEAR",
		item_code="LAB-PERIPHERAL-SMEAR",
		test_name="PERIPHERAL SMEAR",
		report_category="DEPARTMENT OF HAEMATOLOGY",
		nabl_discipline="Haematology",
		rate=300,
	)
	doc.result_layout = "Descriptive"
	doc.is_descriptive = 1
	doc.descriptive_placeholder = (
		doc.descriptive_placeholder
		or "RBC morphology, WBC differential comments, platelet estimate, parasites…"
	)
	doc.report_heading_1 = doc.report_heading_1 or "DEPARTMENT OF HAEMATOLOGY"
	doc.report_heading_2 = doc.report_heading_2 or "PERIPHERAL BLOOD SMEAR EXAMINATION"
	doc.machine_method = doc.machine_method or "Microscopy"
	if not doc.parameters:
		doc.append(
			"parameters",
			{
				"parameter_code": "PBS",
				"parameter_name": "Peripheral Smear Findings",
				"result_input_type": "Descriptive Text",
				"default_value": "No abnormal morphology seen.",
				"print_style": "Normal",
			},
		)
	else:
		for p in doc.parameters:
			if not p.result_input_type or p.result_input_type == "Numeric":
				p.result_input_type = "Descriptive Text"
	doc.save(ignore_permissions=True)
	return doc.name


def _default_trf_franchisee():
	name = frappe.db.get_value(
		"Franchisee Profile",
		{"franchise_name": ["like", "%SAHEB%"]},
		"name",
	)
	if name:
		return name
	return frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")


def smoke_live_uric_trf_journey(
	high_value=None,
	normal_value=None,
	gender="Male",
	age=23,
	patient_name=None,
):
	"""Drive a live Customer TRF → Lab Report for Uric Acid and verify gender bands/flags.

	Male (default): 3.5–6.0 · Female: 2.5–5.0
	"""
	from frappe.utils import cstr

	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import api_save_hec_lab_bill
	from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
		_flag_from_ranges,
		get_or_create_lab_report,
	)

	gender = _norm_gender(gender) or "Male"
	if gender == "Female":
		expect_low, expect_high = 2.5, 5.0
		high_value = 6.0 if high_value is None else flt(high_value)
		normal_value = 4.0 if normal_value is None else flt(normal_value)
		patient_name = patient_name or "Smoke Uric Female"
	else:
		expect_low, expect_high = 3.5, 6.0
		high_value = 7.0 if high_value is None else flt(high_value)
		normal_value = 5.0 if normal_value is None else flt(normal_value)
		patient_name = patient_name or "Smoke Uric Male"

	ensure_phase88_doctypes()
	_seed_uric_acid()
	frappe.db.commit()

	master = _find_master("URIC (LAB-URIC-ACID)", "Uric Acid", "URIC", "LAB-URIC-ACID")
	if not master:
		return {"ok": False, "error": "Uric Acid Diagnostic Test Master missing"}

	item_code = master.item or "LAB-URIC-ACID"
	if not frappe.db.exists("Item", item_code):
		return {"ok": False, "error": f"Item {item_code} missing", "master": master.name}

	franchisee = _default_trf_franchisee()
	if not franchisee:
		return {"ok": False, "error": "No Franchisee Profile for Coll Centre"}

	bill = api_save_hec_lab_bill(
		{
			"patient_name": patient_name,
			"age": cint(age) or 23,
			"gender": gender,
			"patient_phone": "9000000089" if gender == "Female" else "9000000088",
			"referred_doctor": "Self",
			"franchisee_id": franchisee,
			"hec_bill_datetime": frappe.utils.now_datetime(),
			"hec_receipt_mode": "CASH",
			"hec_amount_paid": 200,
			"hec_received": 200,
			"order_status": "In Lab",
			"tests": [
				{
					"item": item_code,
					"item_name": "Uric Acid",
					"qty": 1,
					"rate": 200,
					"hec_disc_percent": 0,
					"hec_disc_amount": 0,
				}
			],
			"adjustments": [],
			"staff": [],
		}
	)
	if not isinstance(bill, dict) or not bill.get("ok"):
		return {"ok": False, "error": "api_save_hec_lab_bill failed", "bill": bill}

	trf_id = bill.get("name")
	frappe.db.set_value("Customer TRF", trf_id, "order_status", "In Lab")
	frappe.db.commit()

	resp = get_or_create_lab_report(trf_id=trf_id)
	lab_report = None
	if isinstance(resp, dict):
		lab_report = (resp.get("data") or {}).get("lab_report")
	if not lab_report:
		return {"ok": False, "error": "get_or_create_lab_report failed", "response": resp, "trf_id": trf_id}

	doc = frappe.get_doc("Lab Report", lab_report)
	params = [p for p in (doc.parameters or []) if "uric" in (p.description or "").lower()]
	if not params:
		params = list(doc.parameters or [])
	if not params:
		return {"ok": False, "error": "Lab Report has no parameters", "lab_report": lab_report, "trf_id": trf_id}

	param = params[0]
	low = flt(param.lower_range)
	high = flt(param.upper_range)
	label = (param.reference_range_label or "").strip()

	param.result_value = cstr(high_value)
	param.abnormal_flag = _flag_from_ranges(param.result_value, param.lower_range, param.upper_range)
	doc.report_status = "In Progress"
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	doc.reload()
	param = next((p for p in doc.parameters if p.name == param.name), doc.parameters[0])
	flag_high = (param.abnormal_flag or "").upper()

	param.result_value = cstr(normal_value)
	param.abnormal_flag = _flag_from_ranges(param.result_value, param.lower_range, param.upper_range)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	doc.reload()
	param = next((p for p in doc.parameters if "uric" in (p.description or "").lower()), doc.parameters[0])
	flag_normal = (param.abnormal_flag or "").upper()

	ok = low == expect_low and high == expect_high and flag_high == "H" and flag_normal == "N"
	return {
		"ok": ok,
		"gender": gender,
		"age": cint(age) or 23,
		"expected_range": {"low": expect_low, "high": expect_high},
		"trf_id": trf_id,
		"barcode": bill.get("unique_barcode"),
		"lab_report": lab_report,
		"franchisee_id": franchisee,
		"master": master.name,
		"parameter": param.description,
		"lower_range": low,
		"upper_range": high,
		"reference_range_label": label,
		"result_high": {"value": high_value, "flag": flag_high},
		"result_normal": {"value": normal_value, "flag": flag_normal},
		"desk_urls": {
			"trf": f"/app/customer-trf/{trf_id}",
			"lab_report": f"/app/lab-report/{lab_report}",
		},
	}


def smoke_live_uric_trf_journey_female():
	"""Convenience wrapper — Female 23y, band 2.5–5.0."""
	return smoke_live_uric_trf_journey(gender="Female", age=23)


FORMAT_SMOKE_ITEMS = (
	("LAB-URIC-ACID", "Uric Acid", 200.0),
	("LAB-TOTAL-IGE", "TOTAL IgE", 450.0),
	("LAB-WIDAL", "WIDAL TEST", 250.0),
	("LAB-ABO", "BLOOD GROUPING (ABO & Rh)", 150.0),
	("LAB-HPLC-HB", "Hb% ELECTROPHORESIS", 900.0),
	("LAB-TRIPLE-MARKER", "TRIPLE MARKER", 2200.0),
	("LAB-PERIPHERAL-SMEAR", "PERIPHERAL SMEAR", 300.0),
)


def smoke_abo_table_matrix(lab_report=None, trf_id=None):
	"""Verify ABO master is a Choice List dropdown (not Table Matrix); rebuild a draft report if given."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import reload_lab_report_parameters

	layouts = apply_non_numeric_layouts()
	abo_masters = []
	for name in frappe.get_all("Diagnostic Test Master", pluck="name"):
		doc = frappe.get_doc("Diagnostic Test Master", name)
		if infer_format_kind(doc.test_name or doc.name, doc.item) != "abo":
			continue
		kinds = [
			(p.parameter_name, p.result_input_type, (p.choice_options or "").strip())
			for p in (doc.parameters or [])
		]
		abo_masters.append(
			{
				"name": doc.name,
				"item": doc.item,
				"layout": doc.result_layout,
				"table": cint(doc.is_table_format),
				"params": len(doc.parameters or []),
				"choice_rows": sum(1 for _n, t, c in kinds if t == "Choice List" and c),
				"blood_group_rows": sum(1 for _n, t, c in kinds if t == "Choice List" and "A Positive" in c),
				"rows": [k[0] for k in kinds],
			}
		)
	ok_master = any(
		m["layout"] != "Table Matrix"
		and not m["table"]
		and m["blood_group_rows"] >= 1
		and m["params"] <= 3
		for m in abo_masters
	)

	rebuilt = None
	report_rows = []
	target = lab_report
	if not target and trf_id:
		target = frappe.db.get_value("Lab Report", {"customer_trf": trf_id}, "name")
	if not target:
		target = frappe.db.get_value("Lab Report", {"name": ["like", "%20260813-00612%"]}, "name")
	if not target:
		# last-resort: newest draft ABO-ish report
		target = frappe.db.get_value(
			"Lab Report",
			{"report_status": ["in", ("Draft", "In Progress")]},
			"name",
			order_by="modified desc",
		)
	if target and frappe.db.exists("Lab Report", target):
		reload_lab_report_parameters(lab_report=target)
		rep = frappe.get_doc("Lab Report", target)
		report_rows = [
			{
				"description": p.description,
				"result_input_type": p.result_input_type,
				"result_layout": getattr(p, "result_layout", None),
				"choice_options": getattr(p, "choice_options", None) or "",
			}
			for p in (rep.parameters or [])
		]
		rebuilt = {
			"lab_report": rep.name,
			"trf": rep.customer_trf,
			"params": len(report_rows),
			"choice_rows": sum(1 for r in report_rows if r["result_input_type"] == "Choice List"),
			"blood_group_rows": sum(1 for r in report_rows if "A Positive" in (r["choice_options"] or "")),
			"table_rows": sum(1 for r in report_rows if (r["result_layout"] or "") == "Table Matrix"),
		}

	ok_report = True
	if rebuilt:
		ok_report = (
			rebuilt["blood_group_rows"] >= 1
			and rebuilt["table_rows"] == 0
			and rebuilt["params"] <= 3
		)

	print("RESULT " + ("SMOKE_OK" if ok_master and ok_report else "SMOKE_FAIL"))
	return {
		"ok": bool(ok_master and ok_report),
		"layouts": layouts,
		"abo_masters": abo_masters,
		"rebuilt": rebuilt,
	}


def _sample_result_for_param(param):
	"""Return a plausible dummy result for NABL print smoke."""
	from frappe.utils import cstr, today

	rtype = (getattr(param, "result_input_type", None) or "Numeric").strip()
	if rtype in ("Heading", "Spacer"):
		return None
	desc = (getattr(param, "description", None) or "").lower()
	code = (getattr(param, "parameter_code", None) or "").lower()
	item = (getattr(param, "erp_item_code", None) or "").upper()

	if rtype == "Choice List":
		opts = [o.strip() for o in (getattr(param, "choice_options", None) or "").split("\n") if o.strip()]
		if opts:
			for prefer in ("A Positive", "O Positive", "1:80", "Negative"):
				if prefer in opts:
					return prefer
			return opts[0]
		return "Negative"

	if rtype == "Date":
		return today()

	if rtype == "Descriptive Text":
		if "smear" in desc or item == "LAB-PERIPHERAL-SMEAR":
			return (
				"RBC: Normocytic normochromic. WBC: Within normal limits. "
				"Platelets: Adequate on smear. No haemoparasite seen."
			)
		if "clinical" in desc:
			return "G2P1, 16 weeks by LMP; no prior aneuploidy history."
		if "risk" in desc or "trisomy" in desc:
			return "1:2500 (Low risk)"
		return "Within normal limits."

	# Numeric defaults by analyte / item
	if "uric" in desc or item == "LAB-URIC-ACID":
		return "5.0"
	if "ige" in desc or "ige" in code or item == "LAB-TOTAL-IGE":
		return "45"
	if item == "LAB-HPLC-HB" or "haemoglobin" in desc or desc.startswith("hb"):
		if "a2" in desc or "a2" in code:
			return "2.8"
		if "f" in code or desc.endswith(" f") or "haemoglobin f" in desc:
			return "0.6"
		return "86.5"
	if "maternal age" in desc:
		return "28"
	if "weight" in desc:
		return "62"
	if "mom" in desc:
		return "1.12"
	if "afp" in desc:
		return "32.4"
	if "hcg" in desc:
		return "28.6"
	if "estriol" in desc or "ue3" in desc:
		return "1.45"
	# Mid-range fallback from reference bounds when available
	low = getattr(param, "lower_range", None)
	high = getattr(param, "upper_range", None)
	if low is not None and high is not None:
		try:
			return cstr(round((flt(low) + flt(high)) / 2.0, 2))
		except Exception:
			pass
	return "1.0"


def _fill_lab_report_sample_results(doc):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import _flag_from_ranges
	from frappe.utils import cstr, now_datetime

	filled = []
	skipped = []
	for param in doc.parameters or []:
		rtype = (getattr(param, "result_input_type", None) or "Numeric").strip()
		if rtype in ("Heading", "Spacer"):
			skipped.append({"description": param.description, "result_input_type": rtype})
			continue
		value = _sample_result_for_param(param)
		if value is None:
			skipped.append({"description": param.description, "result_input_type": rtype})
			continue
		param.result_value = cstr(value)
		if rtype == "Numeric":
			param.abnormal_flag = _flag_from_ranges(param.result_value, param.lower_range, param.upper_range)
		elif not param.abnormal_flag:
			param.abnormal_flag = "N"
		filled.append(
			{
				"description": param.description,
				"erp_item_code": getattr(param, "erp_item_code", None),
				"result_input_type": rtype,
				"result_value": param.result_value,
				"abnormal_flag": param.abnormal_flag,
			}
		)

	doc.report_status = "Authorized"
	if hasattr(doc, "printed_on"):
		doc.printed_on = now_datetime()
	if hasattr(doc, "dispatch_date") and not doc.dispatch_date:
		doc.dispatch_date = now_datetime()
	if hasattr(doc, "report_date") and not doc.report_date:
		doc.report_date = now_datetime()
	doc.comments = (
		doc.comments
		or "Smoke NABL report — dummy patient with all Phase 88 format-category tests."
	)
	doc.save(ignore_permissions=True)
	return {"filled": filled, "skipped": skipped}


def smoke_all_format_nabl_report(
	patient_name=None,
	gender="Female",
	age=28,
	save_html=1,
):
	"""Bill Entry → Lab Report → sample results → NABL HTML for all format seeds."""
	from frappe.utils import cint as _cint
	from frappe.utils import now_datetime

	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import api_save_hec_lab_bill
	from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
		get_or_create_lab_report,
		lab_report_print_payload,
		render_nabl_lab_report_html,
	)

	ensure_phase88_doctypes()
	seeded = seed_format_examples()
	frappe.db.commit()

	gender = _norm_gender(gender) or "Female"
	age = cint(age) or 28
	patient_name = patient_name or "Smoke NABL All Formats"

	franchisee = _default_trf_franchisee()
	if not franchisee:
		return {"ok": False, "error": "No Franchisee Profile for Coll Centre", "seeded": seeded}

	tests = []
	missing_items = []
	for item_code, item_name, rate in FORMAT_SMOKE_ITEMS:
		if not frappe.db.exists("Item", item_code):
			missing_items.append(item_code)
			continue
		tests.append(
			{
				"item": item_code,
				"item_name": item_name,
				"qty": 1,
				"rate": rate,
				"hec_disc_percent": 0,
				"hec_disc_amount": 0,
			}
		)
	if missing_items:
		return {"ok": False, "error": "Missing Items", "missing_items": missing_items, "seeded": seeded}
	if len(tests) < len(FORMAT_SMOKE_ITEMS):
		return {"ok": False, "error": "Incomplete test basket", "tests": tests}

	total = sum(flt(t["rate"]) for t in tests)
	bill = api_save_hec_lab_bill(
		{
			"patient_name": patient_name,
			"age": age,
			"gender": gender,
			"patient_phone": "9000000188",
			"referred_doctor": "Self",
			"franchisee_id": franchisee,
			"hec_bill_datetime": now_datetime(),
			"hec_receipt_mode": "CASH",
			"hec_amount_paid": total,
			"hec_received": total,
			"order_status": "In Lab",
			"tests": tests,
			"adjustments": [],
			"staff": [],
		}
	)
	if not isinstance(bill, dict) or not bill.get("ok"):
		return {"ok": False, "error": "api_save_hec_lab_bill failed", "bill": bill, "seeded": seeded}

	trf_id = bill.get("name")
	frappe.db.set_value("Customer TRF", trf_id, "order_status", "In Lab")
	frappe.db.commit()

	resp = get_or_create_lab_report(trf_id=trf_id)
	lab_report = None
	if isinstance(resp, dict):
		lab_report = (resp.get("data") or {}).get("lab_report")
	if not lab_report:
		return {
			"ok": False,
			"error": "get_or_create_lab_report failed",
			"response": resp,
			"trf_id": trf_id,
			"seeded": seeded,
		}

	doc = frappe.get_doc("Lab Report", lab_report)
	fill = _fill_lab_report_sample_results(doc)
	frappe.db.commit()
	doc.reload()

	payload = lab_report_print_payload(lab_report)
	html = render_nabl_lab_report_html(payload)

	items_on_report = sorted(
		{
			(p.erp_item_code or "").strip()
			for p in (doc.parameters or [])
			if (p.erp_item_code or "").strip()
		}
	)
	expected_items = [c for c, _, _ in FORMAT_SMOKE_ITEMS]
	layouts_seen = {}
	for item_code, _, _ in FORMAT_SMOKE_ITEMS:
		master = frappe.db.get_value(
			"Diagnostic Test Master",
			{"item": item_code},
			["name", "result_layout"],
			as_dict=True,
		)
		if master:
			layouts_seen[master.result_layout or "Numeric Profile"] = {
				"master": master.name,
				"item": item_code,
			}

	sections = payload.get("test_sections") or []
	param_count = sum(len(s.get("parameters") or []) for s in sections)
	html_ok = bool(html) and ("NABL" in html) and (patient_name.split()[0] in html or patient_name in html)
	# At least uric + smear text should appear for format coverage
	coverage = {
		"has_nabl_strip": "NABL" in (html or ""),
		"has_uric": "uric" in (html or "").lower() or "Uric" in (html or ""),
		"has_widal_or_typhi": ("typhi" in (html or "").lower()) or ("widal" in (html or "").lower()),
		"has_smear_text": "smear" in (html or "").lower() or "Normocytic" in (html or ""),
		"has_hplc_or_hb": ("Haemoglobin" in (html or "")) or ("HPLC" in (html or "")),
		"section_count": len(sections),
		"parameter_count": param_count,
	}

	html_path = None
	html_url = None
	html_bytes = len(html or "")
	if _cint(save_html) and html:
		fname = f"nabl-smoke-all-formats-{trf_id}.html"
		# Prefer public files so Desk/nginx can serve it
		try:
			files_dir = frappe.get_site_path("public", "files")
			import os

			os.makedirs(files_dir, exist_ok=True)
			html_path = os.path.join(files_dir, fname)
			with open(html_path, "w", encoding="utf-8") as fh:
				fh.write(html)
			html_url = f"/files/{fname}"
		except Exception as exc:
			html_path = f"write_failed:{exc}"

	ok = (
		html_ok
		and coverage["section_count"] >= 4
		and coverage["parameter_count"] >= 8
		and all(i in items_on_report for i in expected_items)
		and len(layouts_seen) >= 5
	)

	return {
		"ok": ok,
		"patient_name": patient_name,
		"gender": gender,
		"age": age,
		"trf_id": trf_id,
		"barcode": bill.get("unique_barcode"),
		"lab_report": lab_report,
		"franchisee_id": franchisee,
		"seeded_masters": seeded,
		"bill_tests": [t["item"] for t in tests],
		"items_on_report": items_on_report,
		"layouts_covered": layouts_seen,
		"fill_summary": {
			"filled_count": len(fill["filled"]),
			"skipped_count": len(fill["skipped"]),
			"filled": fill["filled"][:40],
			"skipped": fill["skipped"],
		},
		"nabl": {
			"html_bytes": html_bytes,
			"html_path": html_path,
			"html_url": html_url,
			"coverage": coverage,
			"section_titles": [
				{"report_category": s.get("report_category"), "test_name": s.get("test_name")}
				for s in sections
			],
		},
		"desk_urls": {
			"trf": f"/app/customer-trf/{trf_id}",
			"lab_report": f"/app/lab-report/{lab_report}",
			"nabl_html": html_url,
		},
	}
