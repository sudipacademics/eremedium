"""Phase 89 — Referral Lab Vial Accession.

Tube catalog, Diagnostic Test Master → tube maps, TRF draw-plan aggregation,
per-tube accession barcodes, Collect/phlebo Drawn + Desk Receive/Reject.
"""

from __future__ import annotations

import json
import os
import re

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, now_datetime

MODULE = "Health Ecosystem Core"

PHASE89_DOCTYPES = (
	("hec_collection_tube", "HEC Collection Tube"),
	("diagnostic_test_tube_requirement", "Diagnostic Test Tube Requirement"),
	("trf_collection_tube", "TRF Collection Tube"),
)

# CLSI-oriented catalog (PDF + Apollo/referral practice)
TUBE_SEED = (
	{
		"tube_code": "BLU",
		"cap_color": "Light Blue",
		"additive": "Sodium Citrate 3.2%",
		"specimen_class": "Citrated Plasma",
		"clsi_draw_order": 20,
		"nominal_volume_ml": 2.7,
		"min_fill_ratio": 1.0,
		"spin_lane": "Spin",
		"description": "Coagulation (PT/INR, APTT) — strict fill ratio",
	},
	{
		"tube_code": "RED",
		"cap_color": "Red",
		"additive": "Clot Activator (no gel)",
		"specimen_class": "Serum",
		"clsi_draw_order": 30,
		"nominal_volume_ml": 4.0,
		"min_fill_ratio": 0.5,
		"spin_lane": "Spin",
		"description": "TDM / blood bank / specialised serology (no gel adsorption)",
	},
	{
		"tube_code": "SST",
		"cap_color": "Gold / Tiger",
		"additive": "Clot Activator + Gel Separator",
		"specimen_class": "Serum",
		"clsi_draw_order": 35,
		"nominal_volume_ml": 3.5,
		"min_fill_ratio": 0.5,
		"spin_lane": "Spin",
		"description": "Routine biochemistry, serology, hormones",
	},
	{
		"tube_code": "GRN",
		"cap_color": "Green",
		"additive": "Lithium / Sodium Heparin",
		"specimen_class": "Heparin Plasma",
		"clsi_draw_order": 40,
		"nominal_volume_ml": 3.0,
		"min_fill_ratio": 0.5,
		"spin_lane": "Spin",
		"description": "STAT plasma chemistry / ABG / cytogenetics",
	},
	{
		"tube_code": "LAV",
		"cap_color": "Lavender / Purple",
		"additive": "K2 / K3 EDTA",
		"specimen_class": "EDTA Whole Blood",
		"clsi_draw_order": 50,
		"nominal_volume_ml": 2.0,
		"min_fill_ratio": 0.5,
		"spin_lane": "Non-Spin",
		"description": "CBC, HbA1c, blood film, grouping, molecular",
	},
	{
		"tube_code": "GRY",
		"cap_color": "Grey",
		"additive": "Sodium Fluoride + Potassium Oxalate",
		"specimen_class": "Fluoride Plasma",
		"clsi_draw_order": 60,
		"nominal_volume_ml": 2.0,
		"min_fill_ratio": 0.5,
		"spin_lane": "Non-Spin",
		"description": "Glucose, OGTT, lactate",
	},
	{
		"tube_code": "RBL",
		"cap_color": "Royal Blue",
		"additive": "Trace-element free (EDTA or none)",
		"specimen_class": "Other",
		"clsi_draw_order": 70,
		"nominal_volume_ml": 6.0,
		"min_fill_ratio": 0.5,
		"spin_lane": "Spin",
		"description": "Heavy metals / trace elements (stub)",
	},
)

# (match patterns on item/master name, tube_code, volume_ml, method, specimen, nabl_discipline)
MAP_RULES = (
	(("uric", "lab-uric"), "SST", 1.0, "Enzymatic", "Serum", "Clinical Biochemistry"),
	(("lipid", "cholesterol", "triglyceride", "hdl", "ldl"), "SST", 2.0, "Enzymatic / Colorimetric", "Serum", "Clinical Biochemistry"),
	(("lft", "sgpt", "sgot", "alt", "ast", "bilirubin", "alkaline"), "SST", 2.0, "Enzymatic", "Serum", "Clinical Biochemistry"),
	(("kft", "creatinine", "urea", "bun", "egfr"), "SST", 1.5, "Enzymatic / Jaffe", "Serum", "Clinical Biochemistry"),
	(("tsh", "t3", "t4", "thyroid", "ft4", "ft3"), "SST", 1.5, "CLIA / EIA", "Serum", "Serology and Immunology"),
	(("ige", "hbsag", "hiv", "vdrl", "widal", "crp"), "SST", 1.5, "CLIA / Immunoturbidimetry", "Serum", "Serology and Immunology"),
	(("cbc", "hemogram", "haemogram", "complete blood"), "LAV", 2.0, "Impedance / Flow Cytometry", "EDTA Whole Blood", "Haematology"),
	(("hba1c", "hb a1c", "glycated"), "LAV", 2.0, "HPLC / Immunoturbidimetry", "EDTA Whole Blood", "Haematology"),
	(("glucose", "fbs", "ppbs", "ogtt", "rbs", "sugar"), "GRY", 2.0, "Enzymatic (Hexokinase/GOD)", "Fluoride Plasma", "Clinical Biochemistry"),
	(("pt", "inr", "aptt", "prothrombin", "d-dimer", "fibrinogen"), "BLU", 2.7, "Coagulometric", "Citrated Plasma", "Haematology"),
	(("electrolyte", "sodium", "potassium", "chloride"), "SST", 1.0, "ISE", "Serum", "Clinical Biochemistry"),
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


def ensure_phase89_doctypes():
	for folder, name in PHASE89_DOCTYPES:
		_import_doctype(folder, name, force=True)

	# Parent DocTypes that gained Phase 89 fields
	for folder, name in (
		("diagnostic_test_master", "Diagnostic Test Master"),
		("customer_trf", "Customer TRF"),
	):
		try:
			_import_doctype(folder, name, force=True)
		except Exception:
			frappe.log_error(title=f"phase89_reload_{name}", message=frappe.get_traceback())

	_ensure_parent_custom_fields()
	frappe.clear_cache()
	return {"ok": True, "phase": 89}


def _ensure_parent_custom_fields():
	"""Fail-soft if JSON reload skipped — keep parents usable on hot deploy."""
	if not frappe.db.exists("DocType", "Diagnostic Test Master"):
		return
	fields = {
		"Diagnostic Test Master": [
			{
				"fieldname": "section_collection",
				"fieldtype": "Section Break",
				"label": "Specimen / Collection",
				"insert_after": "machine_method",
			},
			{
				"fieldname": "primary_tube",
				"fieldtype": "Link",
				"label": "Primary Collection Tube",
				"options": "HEC Collection Tube",
				"insert_after": "section_collection",
			},
			{
				"fieldname": "specimen_material",
				"fieldtype": "Select",
				"label": "Specimen Material",
				"options": "\nSerum\nPlasma\nEDTA Whole Blood\nCitrated Plasma\nFluoride Plasma\nHeparin Plasma\nUrine\nCSF\nOther",
				"insert_after": "primary_tube",
			},
			{
				"fieldname": "tube_requirements",
				"fieldtype": "Table",
				"label": "Tube Requirements",
				"options": "Diagnostic Test Tube Requirement",
				"insert_after": "specimen_material",
			},
		],
		"Customer TRF": [
			{
				"fieldname": "section_draw_plan",
				"fieldtype": "Section Break",
				"label": "Collection Draw Plan",
				"insert_after": "tests",
			},
			{
				"fieldname": "collection_tubes",
				"fieldtype": "Table",
				"label": "Collection Tubes",
				"options": "TRF Collection Tube",
				"insert_after": "section_draw_plan",
			},
		],
	}
	# Only create missing fields
	to_create = {}
	for dt, dfs in fields.items():
		needed = []
		for df in dfs:
			if not frappe.db.exists("Custom Field", {"dt": dt, "fieldname": df["fieldname"]}):
				if frappe.get_meta(dt).has_field(df["fieldname"]):
					continue
				needed.append(df)
		if needed:
			to_create[dt] = needed
	if to_create:
		create_custom_fields(to_create, update=True)


def setup_phase89(seed=1):
	ensure_phase89_doctypes()
	if cint(seed):
		seed_collection_tubes()
		seed_test_tube_maps()
	frappe.db.commit()
	frappe.clear_cache()
	return {"ok": True, "phase": 89, "seeded": cint(seed)}


def seed_collection_tubes():
	created = []
	for row in TUBE_SEED:
		code = row["tube_code"]
		if frappe.db.exists("HEC Collection Tube", code):
			doc = frappe.get_doc("HEC Collection Tube", code)
			for k, v in row.items():
				setattr(doc, k, v)
			doc.active = 1
			doc.save(ignore_permissions=True)
		else:
			doc = frappe.get_doc({"doctype": "HEC Collection Tube", **row, "active": 1})
			doc.insert(ignore_permissions=True)
			created.append(code)
	frappe.db.commit()
	return {"ok": True, "created": created, "total": len(TUBE_SEED)}


def _match_rule(item_code, test_name):
	blob = f"{item_code or ''} {test_name or ''}".lower()
	for patterns, tube, vol, method, specimen, discipline in MAP_RULES:
		if any(p in blob for p in patterns):
			return {
				"tube_code": tube,
				"min_volume_ml": vol,
				"method": method,
				"specimen_material": specimen,
				"nabl_discipline": discipline,
			}
	return None


def _find_masters_for_seed():
	if not frappe.db.exists("DocType", "Diagnostic Test Master"):
		return []
	names = frappe.get_all("Diagnostic Test Master", pluck="name")
	# Prefer known live master for uric smoke
	return names


def seed_test_tube_maps(limit=0):
	"""Apply MAP_RULES to Diagnostic Test Masters (idempotent preferred tube)."""
	if not frappe.db.exists("DocType", "HEC Collection Tube"):
		seed_collection_tubes()
	ensure_phase89_doctypes()

	updated = []
	masters = _find_masters_for_seed()
	if limit:
		masters = masters[: cint(limit)]

	for name in masters:
		doc = frappe.get_doc("Diagnostic Test Master", name)
		rule = _match_rule(doc.item, doc.test_name or name)
		if not rule:
			continue
		tube_code = rule["tube_code"]
		if not frappe.db.exists("HEC Collection Tube", tube_code):
			continue

		changed = False
		if frappe.get_meta("Diagnostic Test Master").has_field("primary_tube"):
			if doc.primary_tube != tube_code:
				doc.primary_tube = tube_code
				changed = True
		if frappe.get_meta("Diagnostic Test Master").has_field("specimen_material"):
			if not doc.specimen_material:
				doc.specimen_material = rule["specimen_material"]
				changed = True
		if not (doc.machine_method or "").strip():
			doc.machine_method = rule["method"]
			changed = True
		if frappe.get_meta("Diagnostic Test Master").has_field("nabl_discipline") and not doc.nabl_discipline:
			doc.nabl_discipline = rule["nabl_discipline"]
			changed = True

		if frappe.get_meta("Diagnostic Test Master").has_field("tube_requirements"):
			has_pref = any(cint(r.preferred) and r.tube == tube_code for r in (doc.tube_requirements or []))
			if not has_pref:
				# keep alternates; ensure preferred SST/etc present
				doc.append(
					"tube_requirements",
					{
						"tube": tube_code,
						"min_volume_ml": rule["min_volume_ml"],
						"preferred": 1,
						"alternate_ok": 0,
						"notes": "Phase 89 seed",
					},
				)
				changed = True

		for param in doc.parameters or []:
			if not (getattr(param, "method", None) or "").strip():
				param.method = rule["method"]
				changed = True
			if hasattr(param, "specimen_material") and not (param.specimen_material or "").strip():
				param.specimen_material = rule["specimen_material"]
				changed = True

		if changed:
			doc.save(ignore_permissions=True)
			_sync_item_sample_type(doc.item, rule["specimen_material"])
			updated.append(name)

	frappe.db.commit()
	return {"ok": True, "updated": updated, "count": len(updated)}


def _sync_item_sample_type(item_code, specimen_material):
	if not item_code or not frappe.db.exists("Item", item_code):
		return
	meta = frappe.get_meta("Item")
	if not meta.has_field("hec_lab_sample_type"):
		return
	current = frappe.db.get_value("Item", item_code, "hec_lab_sample_type")
	if not current:
		frappe.db.set_value("Item", item_code, "hec_lab_sample_type", specimen_material, update_modified=False)


def _preferred_tube_reqs(master_doc):
	reqs = []
	if master_doc and getattr(master_doc, "tube_requirements", None):
		for row in master_doc.tube_requirements:
			if not row.tube:
				continue
			if cint(row.preferred) or not reqs:
				reqs.append(row)
	if not reqs and master_doc and getattr(master_doc, "primary_tube", None):
		reqs.append(
			frappe._dict(
				{
					"tube": master_doc.primary_tube,
					"min_volume_ml": 1.0,
					"preferred": 1,
				}
			)
		)
	if not reqs and master_doc:
		rule = _match_rule(master_doc.item, master_doc.test_name)
		if rule and frappe.db.exists("HEC Collection Tube", rule["tube_code"]):
			reqs.append(
				frappe._dict(
					{
						"tube": rule["tube_code"],
						"min_volume_ml": rule["min_volume_ml"],
						"preferred": 1,
					}
				)
			)
	return [r for r in reqs if cint(getattr(r, "preferred", 1))]


def build_draw_plan_for_trf(trf_id):
	"""Aggregate preferred tubes for ordered tests → list of draw-plan dicts."""
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
		find_test_master_for_item,
		get_trf_test_lines,
	)

	trf = frappe.get_doc("Customer TRF", trf_id) if isinstance(trf_id, str) else trf_id
	barcode = (trf.unique_barcode or trf.name or "TRF").strip()
	agg = {}

	for line in get_trf_test_lines(trf):
		item_code = line.get("item_code") or line.get("item")
		item_name = line.get("item_name") or item_code
		master_name = find_test_master_for_item(item_code) if item_code else None
		master = frappe.get_doc("Diagnostic Test Master", master_name) if master_name else None
		reqs = _preferred_tube_reqs(master)
		if not reqs:
			# Fallback SST for unknown biochem-ish items
			fallback = "SST" if frappe.db.exists("HEC Collection Tube", "SST") else None
			if not fallback:
				continue
			reqs = [frappe._dict({"tube": fallback, "min_volume_ml": 1.0, "preferred": 1})]

		for req in reqs:
			tube_code = req.tube
			bucket = agg.setdefault(
				tube_code,
				{
					"tube": tube_code,
					"aggregated_volume_ml": 0.0,
					"tests": [],
					"destinations": set(),
				},
			)
			bucket["aggregated_volume_ml"] += flt(req.min_volume_ml) or 1.0
			label = item_name or item_code
			if label and label not in bucket["tests"]:
				bucket["tests"].append(label)
			if master and master.nabl_discipline:
				bucket["destinations"].add(master.nabl_discipline)
			elif master and master.report_category:
				bucket["destinations"].add(master.report_category)

	rows = []
	for tube_code, data in agg.items():
		tube = frappe.get_doc("HEC Collection Tube", tube_code)
		nominal = flt(tube.nominal_volume_ml) or 0
		vol = max(flt(data["aggregated_volume_ml"]), nominal * 0.5 if nominal else flt(data["aggregated_volume_ml"]))
		if nominal and vol > nominal:
			# Cap display at one tube nominal × ceil — for MVP keep summed min volumes
			pass
		rows.append(
			{
				"tube": tube_code,
				"tube_code": tube.tube_code,
				"cap_color": tube.cap_color,
				"clsi_draw_order": cint(tube.clsi_draw_order),
				"aggregated_volume_ml": round(vol, 2),
				"accession_id": f"{barcode}-{tube.tube_code}",
				"status": "Planned",
				"destination_department": ", ".join(sorted(data["destinations"])) or "",
				"spin_lane": tube.spin_lane,
				"linked_tests": ", ".join(data["tests"]),
			}
		)

	rows.sort(key=lambda r: (cint(r["clsi_draw_order"]), r["tube_code"]))
	return rows


@frappe.whitelist()
def rebuild_trf_draw_plan(trf_id=None, preserve_received=1):
	"""Write TRF Collection Tube child rows from ordered tests."""
	trf_id = trf_id or frappe.form_dict.get("trf_id")
	if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
		frappe.throw(_("TRF not found"))

	ensure_phase89_doctypes()
	if not frappe.get_meta("Customer TRF").has_field("collection_tubes"):
		frappe.throw(_("Customer TRF missing collection_tubes — run setup_phase89"))

	trf = frappe.get_doc("Customer TRF", trf_id)
	preserve = cint(preserve_received)
	kept = {}
	if preserve:
		for row in trf.collection_tubes or []:
			if row.status in ("Received", "Rejected", "Drawn") and row.tube_code:
				kept[row.tube_code] = row

	plan = build_draw_plan_for_trf(trf)
	trf.set("collection_tubes", [])
	for row in plan:
		prev = kept.get(row["tube_code"])
		if prev:
			row["status"] = prev.status
			row["drawn_at"] = prev.drawn_at
			row["received_at"] = prev.received_at
			row["rejected_reason"] = prev.rejected_reason
			row["accession_id"] = prev.accession_id or row["accession_id"]
		trf.append("collection_tubes", row)

	trf.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"ok": True,
		"trf_id": trf_id,
		"barcode": trf.unique_barcode,
		"tubes": [
			{
				"tube_code": r.tube_code,
				"accession_id": r.accession_id,
				"volume_ml": r.aggregated_volume_ml,
				"status": r.status,
				"draw_order": r.clsi_draw_order,
				"linked_tests": r.linked_tests,
				"destination": r.destination_department,
				"cap_color": r.cap_color,
				"spin_lane": r.spin_lane,
			}
			for r in trf.collection_tubes
		],
	}


def get_trf_draw_plan_payload(trf_id):
	"""Serialize draw plan for Collect / APIs."""
	if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
		return []
	if not frappe.get_meta("Customer TRF").has_field("collection_tubes"):
		return []
	trf = frappe.get_doc("Customer TRF", trf_id)
	if not trf.collection_tubes:
		try:
			rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=0)
			trf.reload()
		except Exception:
			return []
	return [
		{
			"tube_code": r.tube_code,
			"cap_color": r.cap_color,
			"accession_id": r.accession_id,
			"volume_ml": flt(r.aggregated_volume_ml),
			"status": r.status,
			"draw_order": cint(r.clsi_draw_order),
			"linked_tests": r.linked_tests,
			"destination": r.destination_department,
			"spin_lane": r.spin_lane,
			"universal_barcode": r.get("universal_barcode"),
		}
		for r in sorted(trf.collection_tubes, key=lambda x: cint(x.clsi_draw_order))
	]


@frappe.whitelist()
def get_trf_draw_plan(trf_id=None):
	"""SPA / Collect: load collection tubes for a TRF."""
	trf_id = trf_id or frappe.form_dict.get("trf_id")
	if not trf_id:
		frappe.throw(_("trf_id required"))
	return {
		"trf_id": trf_id,
		"tubes": get_trf_draw_plan_payload(trf_id),
		"patient": _accession_patient_payload(trf_id),
	}


_ACCESSION_PATIENT_FIELDS = (
	"patient_name",
	"age",
	"age_months",
	"age_days",
	"gender",
	"patient_phone",
	"unique_barcode",
	"order_status",
	"sample_intake_channel",
	"hec_bill_datetime",
	"creation",
)


def _accession_patient_payload(trf_id):
	if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
		return {}
	meta = frappe.get_meta("Customer TRF")
	fields = [f for f in _ACCESSION_PATIENT_FIELDS if f == "creation" or meta.has_field(f)]
	row = frappe.db.get_value("Customer TRF", trf_id, fields, as_dict=True) or {}
	return {k: (str(v) if v is not None else None) for k, v in row.items()}


@frappe.whitelist()
def get_accession_summary():
	"""Today's tube counts for the accession desk."""
	from frappe.utils import add_days, nowdate

	today = nowdate()
	tube = "`tabTRF Collection Tube`"
	trf = "`tabCustomer TRF`"

	def _count(sql, *args):
		return cint(frappe.db.sql(sql, args)[0][0])

	return {
		"date": today,
		"received_today": _count(
			f"select count(*) from {tube} where status='Received' and date(received_at)=%s", today
		),
		"rejected_today": _count(
			f"select count(*) from {tube} where status='Rejected' and date(modified)=%s", today
		),
		"pending": _count(
			f"""select count(*) from {tube} t inner join {trf} c on c.name=t.parent
			where t.parenttype='Customer TRF' and t.status in ('Planned','Drawn')
			and c.order_status in ('Booked','Sample Collected','In Lab') and c.creation >= %s""",
			add_days(today, -30),
		),
		"total_today": _count(
			f"""select count(*) from {tube} t inner join {trf} c on c.name=t.parent
			where t.parenttype='Customer TRF' and date(c.creation)=%s""",
			today,
		),
	}


@frappe.whitelist()
def find_trf_for_accession(q=None):
	"""Resolve a TRF barcode, TRF ID, tube accession ID, patient mobile or name to TRFs."""
	q = (q or frappe.form_dict.get("q") or "").strip()
	if not q:
		frappe.throw(_("Enter a TRF barcode, accession ID, mobile number or patient name"))
	hits = []

	def _add(name):
		if name and name not in hits:
			hits.append(name)

	if frappe.db.exists("Customer TRF", q):
		_add(q)
	_add(frappe.db.get_value("Customer TRF", {"unique_barcode": q}, "name"))
	_add(frappe.db.get_value("TRF Collection Tube", {"accession_id": q, "parenttype": "Customer TRF"}, "parent"))
	if not hits:
		_add(_pf_trf_for_code(q))
	digits = re.sub(r"\D", "", q)
	if not hits and len(digits) >= 10:
		for name in frappe.get_all(
			"Customer TRF",
			filters={"patient_phone": ["like", f"%{digits[-10:]}"]},
			order_by="creation desc",
			limit=10,
			pluck="name",
		):
			_add(name)
	if not hits and len(q) >= 3 and not digits:
		for name in frappe.get_all(
			"Customer TRF",
			filters={"patient_name": ["like", f"%{q}%"]},
			order_by="creation desc",
			limit=10,
			pluck="name",
		):
			_add(name)
	rows = []
	for name in hits[:10]:
		r = frappe.db.get_value(
			"Customer TRF",
			name,
			["name", "patient_name", "patient_phone", "unique_barcode", "order_status", "creation"],
			as_dict=True,
		)
		if r:
			rows.append(
				{
					"trf_id": r.name,
					"patient_name": r.patient_name,
					"patient_phone": r.patient_phone,
					"barcode": r.unique_barcode,
					"order_status": r.order_status,
					"creation": str(r.creation or ""),
				}
			)
	return {"trfs": rows}


def _pf_module():
	"""PhleboFirst (phase 133) hooks; None where that module is not installed."""
	try:
		from health_ecosystem_core.health_ecosystem_core import clinical_phase133_phlebofirst as pf
	except ImportError:
		return None
	return pf


def _pf_trf_for_code(code):
	pf = _pf_module()
	if not pf:
		return None
	try:
		return pf.resolve_trf_for_code(code)
	except Exception:
		frappe.log_error(title="phase89_pf_lookup", message=frappe.get_traceback())
		return None


def _find_tube_row(trf, code):
	"""Tube row by accession ID, PhleboFirst universal barcode, or a lab LIS barcode mapped to one."""
	code = (code or "").strip()

	def match(value):
		for r in trf.collection_tubes or []:
			if (r.accession_id or "").strip() == value:
				return r
			universal = (r.get("universal_barcode") or "").strip().upper()
			if universal and universal == value.upper():
				return r
		return None

	row = match(code) if code else None
	if row or not code:
		return row
	pf = _pf_module()
	if not pf:
		return None
	try:
		universal = pf.universal_for_code(code)
	except Exception:
		frappe.log_error(title="phase89_pf_tube", message=frappe.get_traceback())
		return None
	return match(universal) if universal else None


def _pf_tube_hook(fn, trf_id, row, *args):
	if not row.get("universal_barcode"):
		return
	pf = _pf_module()
	if not pf:
		return
	try:
		getattr(pf, fn)(trf_id, row, *args)
	except Exception:
		frappe.log_error(title=f"phase89_{fn}", message=frappe.get_traceback())


def _tp_module():
	"""Teleporter (phase 134) hooks; None where that module is not installed."""
	try:
		from health_ecosystem_core.health_ecosystem_core import clinical_phase134_teleporter as tp
	except ImportError:
		return None
	return tp


def _tp_guard(trf_id, row):
	"""A tube sealed in a Teleporter icebox that is still with the runner cannot be received or rejected."""
	tp = _tp_module()
	if not tp:
		return
	try:
		manifest = tp.sealed_manifest_for_tube(trf_id, row)
	except Exception:
		frappe.log_error(title="phase89_tp_guard", message=frappe.get_traceback())
		return
	if manifest:
		frappe.throw(_("Sample is sealed in Teleporter manifest {0}; scan the icebox at reception first").format(manifest))


def _tp_tube_hook(fn, trf_id, row, *args):
	tp = _tp_module()
	if not tp:
		return
	try:
		getattr(tp, fn)(trf_id, row, *args)
	except Exception:
		frappe.log_error(title=f"phase89_tp_{fn}", message=frappe.get_traceback())


def mark_trf_tubes_drawn(trf_id):
	if not frappe.get_meta("Customer TRF").has_field("collection_tubes"):
		return {"ok": False, "skipped": True}
	trf = frappe.get_doc("Customer TRF", trf_id)
	if not trf.collection_tubes:
		rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=0)
		trf.reload()
	now = now_datetime()
	for row in trf.collection_tubes:
		if row.status == "Planned":
			row.status = "Drawn"
			row.drawn_at = now
	trf.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "trf_id": trf_id, "tubes": get_trf_draw_plan_payload(trf_id)}


@frappe.whitelist()
def receive_trf_tube(trf_id=None, accession_id=None):
	trf_id = trf_id or frappe.form_dict.get("trf_id")
	accession_id = (accession_id or frappe.form_dict.get("accession_id") or "").strip()
	if not trf_id or not accession_id:
		frappe.throw(_("trf_id and accession_id required"))

	trf = frappe.get_doc("Customer TRF", trf_id)
	row = _find_tube_row(trf, accession_id)
	if not row:
		frappe.throw(_("Accession {0} not on this TRF").format(accession_id))
	_tp_guard(trf_id, row)

	row.status = "Received"
	row.received_at = now_datetime()
	trf.save(ignore_permissions=True)
	_pf_tube_hook("on_trf_tube_received", trf_id, row)
	_tp_tube_hook("on_trf_tube_received", trf_id, row)

	order_status = _advance_trf_to_in_lab(trf_id)

	# Soft-link transport log when DocType exists
	if frappe.db.exists("DocType", "Sample Transport Log"):
		try:
			exists = frappe.db.exists("Sample Transport Log", {"customer_trf": trf_id})
			if not exists:
				frappe.get_doc(
					{
						"doctype": "Sample Transport Log",
						"customer_trf": trf_id,
						"remarks": f"Received tube {accession_id}",
					}
				).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="phase89_transport_log", message=frappe.get_traceback())

	frappe.db.commit()
	return {"ok": True, "accession_id": accession_id, "status": "Received", "order_status": order_status}


_PRE_LAB_TRF_STATUSES = ("Booked", "Sample Collected")


def _advance_trf_to_in_lab(trf_id):
	"""A tube received at the lab bench puts the TRF in the result-entry queue."""
	current = frappe.db.get_value("Customer TRF", trf_id, "order_status")
	if current not in _PRE_LAB_TRF_STATUSES:
		return current
	frappe.db.set_value("Customer TRF", trf_id, "order_status", "In Lab")
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_journey import sync_journey_from_trf

		sync_journey_from_trf(trf_id, "In Lab")
	except Exception:
		frappe.log_error(title="phase89_receive_journey_sync", message=frappe.get_traceback())
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import on_sample_received_at_lab

	on_sample_received_at_lab(trf_id)
	return "In Lab"


def backfill_received_trfs_to_in_lab(dry_run=1):
	"""Move TRFs that already have a Received tube but are stuck pre-lab into In Lab."""
	dry_run = cint(dry_run)
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT trf.name
		FROM `tabCustomer TRF` trf
		INNER JOIN `tabTRF Collection Tube` tube ON tube.parent = trf.name
		WHERE tube.status = 'Received'
		  AND trf.order_status IN %(statuses)s
		""",
		{"statuses": _PRE_LAB_TRF_STATUSES},
		as_dict=True,
	)
	names = [r.name for r in rows]
	if not dry_run:
		for name in names:
			_advance_trf_to_in_lab(name)
		frappe.db.commit()
	return {"ok": True, "dry_run": dry_run, "count": len(names), "trfs": names}


@frappe.whitelist()
def reject_trf_tube(trf_id=None, accession_id=None, reason=None):
	trf_id = trf_id or frappe.form_dict.get("trf_id")
	accession_id = (accession_id or frappe.form_dict.get("accession_id") or "").strip()
	reason = (reason or frappe.form_dict.get("reason") or "Wrong Container").strip()
	if not trf_id or not accession_id:
		frappe.throw(_("trf_id and accession_id required"))

	trf = frappe.get_doc("Customer TRF", trf_id)
	row = _find_tube_row(trf, accession_id)
	if not row:
		frappe.throw(_("Accession {0} not on this TRF").format(accession_id))
	_tp_guard(trf_id, row)

	row.status = "Rejected"
	row.rejected_reason = reason
	trf.save(ignore_permissions=True)
	_pf_tube_hook("on_trf_tube_rejected", trf_id, row, reason)
	_tp_tube_hook("on_trf_tube_rejected", trf_id, row, reason)

	if frappe.db.exists("DocType", "Sample Rejection Record"):
		try:
			reason_code = "Wrong Container"
			low = reason.lower()
			if "hemolys" in low:
				reason_code = "Hemolysis"
			elif "quantity" in low or "underfill" in low or "qns" in low:
				reason_code = "Quantity Not Sufficient"
			elif "label" in low:
				reason_code = "Labeling Error"
			elif "clot" in low:
				reason_code = "Clotted"
			frappe.get_doc(
				{
					"doctype": "Sample Rejection Record",
					"customer_trf": trf_id,
					"reason": reason_code,
					"action_taken": "Rejected",
					"rejected_by": frappe.session.user if frappe.session.user != "Guest" else None,
					"rejected_on": now_datetime(),
					"notes": f"Accession {accession_id}: {reason}",
				}
			).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="phase89_rejection", message=frappe.get_traceback())

	if frappe.get_meta("Customer TRF").has_field("sample_rejected"):
		frappe.db.set_value("Customer TRF", trf_id, "sample_rejected", 1)
		if frappe.get_meta("Customer TRF").has_field("sample_rejection_note"):
			frappe.db.set_value("Customer TRF", trf_id, "sample_rejection_note", reason)

	frappe.db.commit()
	return {"ok": True, "accession_id": accession_id, "status": "Rejected", "reason": reason}


def specimen_from_trf_draw_plan(trf):
	"""Pick Lab Report specimen string from first preferred draw-plan tube."""
	if isinstance(trf, str):
		trf = frappe.get_doc("Customer TRF", trf)
	if frappe.get_meta("Customer TRF").has_field("collection_tubes") and trf.get("collection_tubes"):
		ordered = sorted(trf.collection_tubes, key=lambda r: cint(r.clsi_draw_order))
		for row in ordered:
			if row.tube and frappe.db.exists("HEC Collection Tube", row.tube):
				cls = frappe.db.get_value("HEC Collection Tube", row.tube, "specimen_class")
				if cls:
					return cls
	# From master of primary test
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item

	item = trf.test_required
	master = find_test_master_for_item(item) if item else None
	if master and frappe.get_meta("Diagnostic Test Master").has_field("specimen_material"):
		sm = frappe.db.get_value("Diagnostic Test Master", master, "specimen_material")
		if sm:
			return sm
	return None


def smoke_phase89_uric_sst():
	"""Smoke A: Uric TRF → 1× SST draw plan + specimen Serum."""
	ensure_phase89_doctypes()
	seed_collection_tubes()
	seed_test_tube_maps()

	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import api_save_hec_lab_bill
	from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
		_default_trf_franchisee,
		_find_master,
		_seed_uric_acid,
	)

	_seed_uric_acid()
	master = _find_master("URIC (LAB-URIC-ACID)", "Uric Acid", "URIC", "LAB-URIC-ACID")
	if not master:
		return {"ok": False, "error": "Uric master missing"}
	# Ensure tube map on uric
	if frappe.get_meta("Diagnostic Test Master").has_field("primary_tube"):
		m = frappe.get_doc("Diagnostic Test Master", master.name)
		m.primary_tube = "SST"
		m.specimen_material = "Serum"
		m.machine_method = m.machine_method or "Enzymatic"
		if not any(cint(r.preferred) and r.tube == "SST" for r in (m.tube_requirements or [])):
			m.append("tube_requirements", {"tube": "SST", "min_volume_ml": 1.0, "preferred": 1})
		m.save(ignore_permissions=True)
		frappe.db.commit()

	franchisee = _default_trf_franchisee()
	bill = api_save_hec_lab_bill(
		{
			"patient_name": "Smoke Vial Uric Male",
			"age": 23,
			"gender": "Male",
			"franchisee_id": franchisee,
			"hec_bill_datetime": now_datetime(),
			"hec_amount_paid": 200,
			"hec_received": 200,
			"order_status": "In Lab",
			"tests": [{"item": master.item or "LAB-URIC-ACID", "item_name": "Uric Acid", "qty": 1, "rate": 200}],
		}
	)
	if not bill.get("ok"):
		return {"ok": False, "error": "bill failed", "bill": bill}
	trf_id = bill["name"]
	plan = rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=0)
	tubes = plan.get("tubes") or []
	codes = [t["tube_code"] for t in tubes]
	ok = codes == ["SST"] and tubes[0]["accession_id"].endswith("-SST")
	spec = specimen_from_trf_draw_plan(trf_id)
	return {
		"ok": ok and spec == "Serum",
		"trf_id": trf_id,
		"barcode": bill.get("unique_barcode"),
		"tubes": tubes,
		"specimen": spec,
	}


def smoke_phase89_multi_tube():
	"""Smoke B: virtual aggregation CBC+Lipid+FBS+PT → LAV+SST+GRY+BLU order."""
	ensure_phase89_doctypes()
	seed_collection_tubes()

	fake_trf = frappe._dict(
		{
			"name": "SMOKE-MULTI",
			"unique_barcode": "HECSMOKEMULTI",
			"test_required": None,
			"tests": [],
		}
	)
	# Build from masters if present via temporary draw using MAP_RULES directly
	desired = [
		("cbc", "LAV"),
		("lipid", "SST"),
		("glucose", "GRY"),
		("pt", "BLU"),
	]
	agg = {}
	for key, tube in desired:
		rule = _match_rule(key, key)
		if not rule:
			continue
		code = rule["tube_code"]
		agg.setdefault(code, {"vol": 0.0, "order": 0})
		agg[code]["vol"] += rule["min_volume_ml"]
		if frappe.db.exists("HEC Collection Tube", code):
			agg[code]["order"] = cint(frappe.db.get_value("HEC Collection Tube", code, "clsi_draw_order"))

	ordered = sorted(agg.keys(), key=lambda c: (agg[c]["order"], c))
	expected = ["BLU", "SST", "LAV", "GRY"]
	ok = ordered == expected
	return {"ok": ok, "ordered_tubes": ordered, "expected": expected, "volumes": {k: agg[k]["vol"] for k in ordered}}


def smoke_phase89_female_uric_regression():
	"""Smoke C: female uric range still works + SST draw plan."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
		smoke_live_uric_trf_journey_female,
	)

	# Ranges regression
	female = smoke_live_uric_trf_journey_female()
	trf_id = female.get("trf_id")
	plan = rebuild_trf_draw_plan(trf_id=trf_id, preserve_received=0) if trf_id else {}
	tubes = plan.get("tubes") or []
	ok = (
		female.get("ok")
		and tubes
		and tubes[0].get("tube_code") == "SST"
		and flt(female.get("lower_range")) == 2.5
	)
	return {
		"ok": ok,
		"female": female,
		"draw_plan": tubes,
	}


def diagnose_trf_draw_plan(trf_id=None):
	"""Desk UI debug for empty Collection Draw Plan section."""
	trf_id = trf_id or "TRF-20260804-00501"
	meta = frappe.get_meta("Customer TRF")
	df = meta.get_field("collection_tubes")
	real_tab = "tabTRF Collection Tube"
	out = {
		"trf_id": trf_id,
		"has_section_draw_plan": meta.has_field("section_draw_plan"),
		"has_collection_tubes": meta.has_field("collection_tubes"),
		"collection_tubes_fieldtype": df.fieldtype if df else None,
		"collection_tubes_options": getattr(df, "options", None) if df else None,
		"trf_collection_tube_doctype": bool(frappe.db.exists("DocType", "TRF Collection Tube")),
		"hec_collection_tube_doctype": bool(frappe.db.exists("DocType", "HEC Collection Tube")),
		"custom_fields": frappe.db.get_all(
			"Custom Field",
			filters={"dt": "Customer TRF", "fieldname": ("in", ["collection_tubes", "section_draw_plan"])},
			fields=["name", "fieldname", "fieldtype", "options", "insert_after"],
		),
		"table_exists_doctype_api": frappe.db.table_exists("TRF Collection Tube"),
		"table_exists_show": bool(frappe.db.sql("SHOW TABLES LIKE %s", (real_tab,))),
	}
	if out["table_exists_doctype_api"] or out["table_exists_show"]:
		try:
			out["child_rows"] = frappe.db.get_all(
				"TRF Collection Tube",
				filters={"parent": trf_id},
				fields=["name", "tube_code", "accession_id", "status", "parentfield", "idx"],
			)
		except Exception as exc:
			out["child_rows_error"] = str(exc)
	# Controller import probe (Desk grid fails hard if this raises)
	try:
		from frappe.model.base_document import import_controller

		ctrl = import_controller("TRF Collection Tube")
		out["controller_ok"] = True
		out["controller"] = f"{ctrl.__module__}.{ctrl.__name__}"
	except Exception as exc:
		out["controller_ok"] = False
		out["controller_error"] = f"{type(exc).__name__}: {exc}"

	if frappe.db.exists("Customer TRF", trf_id):
		try:
			doc = frappe.get_doc("Customer TRF", trf_id)
			out["doc_collection_tubes_len"] = len(doc.get("collection_tubes") or [])
			out["doc_collection_tubes"] = [
				{"tube_code": r.tube_code, "accession_id": r.accession_id, "status": r.status}
				for r in (doc.get("collection_tubes") or [])
			]
		except Exception as exc:
			out["get_doc_error"] = f"{type(exc).__name__}: {exc}"
	return out


def repair_customer_trf_draw_plan_field():
	"""Ensure child MariaDB tables + collection_tubes field so Desk grid renders."""
	ensure_phase89_doctypes()

	for dt in ("HEC Collection Tube", "Diagnostic Test Tube Requirement", "TRF Collection Tube"):
		try:
			frappe.reload_doctype(dt, force=True)
		except Exception:
			pass
		try:
			frappe.db.updatedb(dt)
		except Exception:
			frappe.log_error(title=f"phase89_updatedb_{dt}", message=frappe.get_traceback())

	if not frappe.get_meta("Customer TRF").has_field("collection_tubes"):
		_ensure_parent_custom_fields()
		frappe.clear_cache(doctype="Customer TRF")

	meta = frappe.get_meta("Customer TRF")
	if not meta.has_field("collection_tubes"):
		create_custom_fields(
			{
				"Customer TRF": [
					{
						"fieldname": "section_draw_plan",
						"fieldtype": "Section Break",
						"label": "Collection Draw Plan",
						"insert_after": "tests",
					},
					{
						"fieldname": "collection_tubes",
						"fieldtype": "Table",
						"label": "Collection Tubes",
						"options": "TRF Collection Tube",
						"insert_after": "section_draw_plan",
					},
				]
			},
			update=True,
		)
		frappe.clear_cache(doctype="Customer TRF")

	meta = frappe.get_meta("Customer TRF")
	if meta.has_field("section_draw_plan") and not meta.has_field("collection_tubes"):
		create_custom_fields(
			{
				"Customer TRF": [
					{
						"fieldname": "collection_tubes",
						"fieldtype": "Table",
						"label": "Collection Tubes",
						"options": "TRF Collection Tube",
						"insert_after": "section_draw_plan",
					}
				]
			},
			update=True,
		)
		frappe.clear_cache(doctype="Customer TRF")

	if not frappe.get_meta("Customer TRF").has_field("collection_tubes"):
		_import_doctype("customer_trf", "Customer TRF", force=True)
		frappe.clear_cache(doctype="Customer TRF")

	try:
		frappe.db.updatedb("Customer TRF")
	except Exception:
		pass

	# Ensure Desk layout includes the field (Customize Form can hide new columns)
	try:
		frappe.db.sql(
			"""
			UPDATE `tabDocField`
			SET hidden=0, reqd=0
			WHERE parent=%s AND fieldname=%s
			""",
			("Customer TRF", "collection_tubes"),
		)
		frappe.db.sql(
			"""
			UPDATE `tabDocField`
			SET hidden=0, label=%s
			WHERE parent=%s AND fieldname=%s
			""",
			("Collection Draw Plan", "Customer TRF", "section_draw_plan"),
		)
		frappe.db.sql(
			"""
			UPDATE `tabCustom Field`
			SET hidden=0, label=%s
			WHERE dt=%s AND fieldname=%s
			""",
			("Collection Draw Plan", "Customer TRF", "section_draw_plan"),
		)
		frappe.db.sql(
			"""
			UPDATE `tabDocField`
			SET label=%s
			WHERE parent=%s AND fieldname=%s AND label LIKE %s
			""",
			("Specimen / Collection", "Diagnostic Test Master", "section_collection", "%Phase 89%"),
		)
	except Exception:
		pass

	frappe.db.commit()
	frappe.clear_cache(doctype="Customer TRF")
	frappe.clear_cache(doctype="TRF Collection Tube")
	return diagnose_trf_draw_plan()


def smoke_phase89_all():
	a = smoke_phase89_uric_sst()
	b = smoke_phase89_multi_tube()
	c = smoke_phase89_female_uric_regression()
	return {
		"ok": bool(a.get("ok") and b.get("ok") and c.get("ok")),
		"smoke_a_uric_sst": a,
		"smoke_b_multi_tube": b,
		"smoke_c_female_regression": c,
	}
