"""
Phase 91 — Staff planning on ERP host (/planning).

Creates workforce plans from role / KPI / KRA / JD, estimates market CTC from
local benchmarks + heuristic blend labelled by common salary portals
(AmbitionBox, Glassdoor, Naukri, Apna) — no live scraping — then publishes a
Careers Job Opening when HR confirms desired CTC.
"""

from __future__ import annotations

import json
import os
import random
from statistics import median

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
)

PLANNER_ROLES = frozenset(
	{
		"System Manager",
		"Health System Admin",
		"HR Manager",
		"HR User",
	}
)

# Local India monthly CTC mid bands (INR) — editable via ensure/update API.
ROLE_BENCHMARKS = (
	{
		"staff_role": "Collections",
		"designation": "Phlebotomist",
		"department": "Collections",
		"kpis": ["Home collections / day", "Redraw rate < 3%", "On-time hub check-in"],
		"kras": ["Sample Collection Quality", "TRF & Data Accuracy", "Attendance & Punctuality"],
		"median_ctc": 22000,
		"p25": 18000,
		"p75": 28000,
	},
	{
		"staff_role": "Lab",
		"designation": "Lab Technician",
		"department": "Laboratory",
		"kpis": ["Samples processed / shift", "QC pass rate", "TAT within SLA"],
		"kras": ["SOP & NABL Compliance", "TRF & Data Accuracy", "Team Collaboration"],
		"median_ctc": 28000,
		"p25": 22000,
		"p75": 36000,
	},
	{
		"staff_role": "Front Office",
		"designation": "Receptionist",
		"department": "Front Office",
		"kpis": ["Patient wait time", "Appointment accuracy", "CSAT"],
		"kras": ["Customer Service", "Attendance & Punctuality", "Team Collaboration"],
		"median_ctc": 18000,
		"p25": 15000,
		"p75": 24000,
	},
	{
		"staff_role": "Marketing",
		"designation": "Marketing Executive",
		"department": "Marketing",
		"kpis": ["Leads generated", "Cost per lead", "Campaign ROI"],
		"kras": ["Customer Service", "Team Collaboration", "Sales & Revenue Target"],
		"median_ctc": 35000,
		"p25": 28000,
		"p75": 48000,
	},
	{
		"staff_role": "Finance",
		"designation": "Accountant",
		"department": "Finance",
		"kpis": ["Books closed on time", "Reconciliation %", "Vendor SLA"],
		"kras": ["SOP & NABL Compliance", "Attendance & Punctuality", "Team Collaboration"],
		"median_ctc": 40000,
		"p25": 32000,
		"p75": 55000,
	},
	{
		"staff_role": "HR",
		"designation": "HR Executive",
		"department": "HR",
		"kpis": ["Time to fill", "Onboarding completion %", "Attrition"],
		"kras": ["Customer Service", "Team Collaboration", "Attendance & Punctuality"],
		"median_ctc": 38000,
		"p25": 30000,
		"p75": 50000,
	},
	{
		"staff_role": "IT",
		"designation": "IT Support Executive",
		"department": "IT",
		"kpis": ["Ticket SLA", "Uptime incidents", "Asset compliance"],
		"kras": ["SOP & NABL Compliance", "Team Collaboration", "Attendance & Punctuality"],
		"median_ctc": 42000,
		"p25": 32000,
		"p75": 60000,
	},
	{
		"staff_role": "Operations",
		"designation": "Centre Manager",
		"department": "Operations",
		"kpis": ["Centre revenue", "NPS", "Staff utilisation"],
		"kras": ["Customer Service", "Team Collaboration", "SOP & NABL Compliance"],
		"median_ctc": 55000,
		"p25": 42000,
		"p75": 75000,
	},
)

CITY_FACTOR = {
	"kolkata": 1.0,
	"howrah": 0.95,
	"delhi": 1.18,
	"ncr": 1.18,
	"mumbai": 1.25,
	"bengaluru": 1.22,
	"hyderabad": 1.12,
	"chennai": 1.1,
	"pune": 1.15,
	"default": 1.0,
}

PORTAL_WEIGHTS = (
	("AmbitionBox", 0.28),
	("Glassdoor", 0.22),
	("Naukri", 0.30),
	("Apna", 0.20),
)


def _require_planner():
	user = frappe.session.user
	if user in ("Guest", None):
		frappe.throw(_("Login required"), frappe.PermissionError)
	roles = set(frappe.get_roles(user))
	if not roles.intersection(PLANNER_ROLES):
		frappe.throw(_("Staff planning access requires HR / Admin role"), frappe.PermissionError)


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def _doctype_json_path():
	here = os.path.dirname(os.path.abspath(__file__))
	return os.path.join(here, "doctype", "hec_staff_plan", "hec_staff_plan.json")


def ensure_staff_plan_doctype():
	if frappe.db.exists("DocType", "HEC Staff Plan"):
		return {"ok": True, "created": False}
	path = _doctype_json_path()
	if not os.path.isfile(path):
		return {"ok": False, "error": "doctype json missing"}
	try:
		from frappe.modules.import_file import import_file_by_path

		import_file_by_path(path, force=True)
		frappe.db.commit()
		frappe.clear_cache(doctype="HEC Staff Plan")
		return {"ok": True, "created": True}
	except Exception:
		frappe.log_error(title="ensure_staff_plan_doctype", message=frappe.get_traceback())
		return {"ok": False, "error": "import failed"}


def _ensure_job_opening_ctc_field():
	if not frappe.db.exists("DocType", "Job Opening"):
		return
	if frappe.db.exists("Custom Field", {"dt": "Job Opening", "fieldname": "hec_planned_ctc"}):
		return
	module = None
	for candidate in ("Health Ecosystem Core", "Health Ecosystem", "HR", "HRMS"):
		if frappe.db.exists("Module Def", candidate):
			module = candidate
			break
	try:
		frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": "Job Opening",
				"fieldname": "hec_planned_ctc",
				"label": "Planned Monthly CTC",
				"fieldtype": "Currency",
				"insert_after": "description",
				"module": module,
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="ensure_job_opening_ctc_field", message=frappe.get_traceback())


def setup_phase91():
	dt = ensure_staff_plan_doctype()
	_ensure_job_opening_ctc_field()
	return {"ok": bool(dt.get("ok")), "doctype": dt, "benchmarks": len(ROLE_BENCHMARKS)}


def _match_benchmark(designation="", staff_role="", department=""):
	des = cstr(designation).lower()
	role = cstr(staff_role).lower()
	dept = cstr(department).lower()
	best = None
	score = -1
	for row in ROLE_BENCHMARKS:
		s = 0
		if des and des in row["designation"].lower():
			s += 3
		if role and role == row["staff_role"].lower():
			s += 2
		if dept and dept in row["department"].lower():
			s += 1
		if s > score:
			score = s
			best = row
	return best or ROLE_BENCHMARKS[0]


def _city_factor(location=""):
	loc = cstr(location).lower()
	for key, factor in CITY_FACTOR.items():
		if key != "default" and key in loc:
			return factor
	return CITY_FACTOR["default"]


def estimate_market_ctc(designation=None, staff_role=None, department=None, location=None, jd_text=None):
	"""
	Heuristic market CTC blend. Portal names are reference markets only —
	values come from seeded local benchmarks + seniority/city factors, not live scrapes.
	"""
	bm = _match_benchmark(designation, staff_role, department)
	factor = _city_factor(location)
	base = flt(bm["median_ctc"]) * factor

	# JD keyword nudges
	jd = cstr(jd_text).lower()
	if any(k in jd for k in ("senior", "lead", "manager", "head")):
		base *= 1.22
	elif any(k in jd for k in ("junior", "trainee", "intern")):
		base *= 0.82

	rng = random.Random(hash(f"{designation}|{staff_role}|{location}|{today()}") & 0xFFFFFFFF)
	sources = []
	samples = []
	for name, weight in PORTAL_WEIGHTS:
		# disperse around median within p25–p75 shaped band
		spread = 0.12 + weight * 0.08
		val = round(base * (1 + rng.uniform(-spread, spread)) / 100) * 100
		val = max(flt(bm["p25"]) * factor * 0.9, min(flt(bm["p75"]) * factor * 1.15, val))
		sources.append(
			{
				"portal": name,
				"weight": weight,
				"estimated_median_ctc": val,
				"note": "Modelled estimate from local benchmark + market weight (not a live scrape)",
			}
		)
		samples.append(val)

	med = round(median(samples) / 100) * 100
	return {
		"method": "heuristic_benchmark_blend",
		"disclaimer": (
			"Estimates are synthesised from internal role benchmarks and typical portal market "
			"weightings (AmbitionBox, Glassdoor, Naukri, Apna). They are not live scraped figures."
		),
		"matched_benchmark": {
			"staff_role": bm["staff_role"],
			"designation": bm["designation"],
			"department": bm["department"],
			"baseline_median": bm["median_ctc"],
			"p25": bm["p25"],
			"p75": bm["p75"],
			"default_kpis": bm["kpis"],
			"default_kras": bm["kras"],
		},
		"city_factor": factor,
		"location": location or "Kolkata",
		"sources": sources,
		"market_median_ctc": med,
		"suggested_desired_ctc": med,
		"currency": "INR",
		"period": "monthly",
		"as_of": str(today()),
	}


def _parse_json_list(raw, fallback=None):
	if raw in (None, ""):
		return list(fallback or [])
	if isinstance(raw, list):
		return raw
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
		return data if isinstance(data, list) else list(fallback or [])
	except Exception:
		return list(fallback or [])


def _serialize_plan(doc):
	return {
		"name": doc.name,
		"title": doc.title,
		"department": doc.department,
		"designation": doc.designation,
		"staff_role": doc.staff_role,
		"location": doc.location,
		"employment_type": doc.employment_type,
		"status": doc.status,
		"headcount": cint(doc.headcount) or 1,
		"desired_ctc": flt(doc.desired_ctc),
		"market_median_ctc": flt(doc.market_median_ctc),
		"job_opening": doc.job_opening,
		"kpis": _parse_json_list(doc.kpi_json),
		"kras": _parse_json_list(doc.kra_json),
		"jd_text": doc.jd_text or "",
		"market_research": json.loads(doc.market_research_json)
		if doc.market_research_json
		else None,
		"notes": doc.notes or "",
		"published_on": cstr(doc.published_on or ""),
		"created_by_user": doc.created_by_user,
		"careers_apply_path": f"/jobs/{doc.job_opening}/apply" if doc.job_opening else None,
		"careers_url": f"https://www.e-remedium.in/jobs/{doc.job_opening}/apply"
		if doc.job_opening
		else "https://www.e-remedium.in/jobs",
	}


@frappe.whitelist(allow_guest=True)
def get_staff_planning_catalog(sid=None):
	frappe.flags.ignore_csrf = True
	_require_planner()
	setup_phase91()
	kras = []
	if frappe.db.exists("DocType", "KRA"):
		kras = frappe.get_all("KRA", fields=["name", "title", "description"], limit=50)
	if not kras:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase74_performance import KRA_LIBRARY

		kras = [{"name": t, "title": t, "description": d} for t, d in KRA_LIBRARY]

	return _success(
		{
			"role_benchmarks": ROLE_BENCHMARKS,
			"kra_library": kras,
			"employment_types": ["Full Time", "Part Time", "Contract", "Internship"],
			"staff_roles": [r["staff_role"] for r in ROLE_BENCHMARKS],
			"disclaimer": (
				"Market CTC uses internal benchmarks blended across AmbitionBox / Glassdoor / "
				"Naukri / Apna weightings — not live portal scrapes."
			),
		}
	)


@frappe.whitelist(allow_guest=True)
def list_staff_plans(status=None, limit=50, sid=None):
	frappe.flags.ignore_csrf = True
	_require_planner()
	setup_phase91()
	if not frappe.db.exists("DocType", "HEC Staff Plan"):
		return _error(_("Staff Plan DocType missing — run setup"), 500)
	filters = {}
	status = _parse_request_value("status", status)
	if status:
		filters["status"] = status
	rows = frappe.get_all(
		"HEC Staff Plan",
		filters=filters,
		fields=[
			"name",
			"title",
			"department",
			"designation",
			"staff_role",
			"status",
			"desired_ctc",
			"market_median_ctc",
			"job_opening",
			"headcount",
			"creation",
			"modified",
		],
		order_by="modified desc",
		limit_page_length=cint(_parse_request_value("limit", limit) or 50),
	)
	return _success({"plans": rows})


@frappe.whitelist(allow_guest=True)
def get_staff_plan(plan=None, sid=None):
	frappe.flags.ignore_csrf = True
	_require_planner()
	plan = _parse_request_value("plan", plan)
	if not plan or not frappe.db.exists("HEC Staff Plan", plan):
		return _error(_("Plan not found"), 404)
	return _success(_serialize_plan(frappe.get_doc("HEC Staff Plan", plan)))


@frappe.whitelist(allow_guest=True)
def create_staff_plan(
	title=None,
	designation=None,
	department=None,
	staff_role=None,
	location=None,
	employment_type=None,
	headcount=None,
	kpi_json=None,
	kra_json=None,
	jd_text=None,
	notes=None,
	sid=None,
):
	frappe.flags.ignore_csrf = True
	_require_planner()
	setup_phase91()
	if not frappe.db.exists("DocType", "HEC Staff Plan"):
		return _error(_("Staff Plan DocType missing"), 500)

	designation = (_parse_request_value("designation", designation) or "").strip()
	title = (_parse_request_value("title", title) or "").strip() or f"Hire {designation}".strip()
	if not designation:
		return _error(_("designation is required"))

	bm = _match_benchmark(designation, staff_role, department)
	kpis = _parse_json_list(_parse_request_value("kpi_json", kpi_json), bm["kpis"])
	kras = _parse_json_list(_parse_request_value("kra_json", kra_json), bm["kras"])
	jd = (_parse_request_value("jd_text", jd_text) or "").strip()
	if not jd:
		jd = (
			f"Role: {designation}\nDepartment: {_parse_request_value('department', department) or bm['department']}\n\n"
			f"Key performance indicators:\n- " + "\n- ".join(kpis) + "\n\n"
			f"KRAs:\n- " + "\n- ".join(kras)
		)

	doc = frappe.get_doc(
		{
			"doctype": "HEC Staff Plan",
			"title": title,
			"designation": designation,
			"department": _parse_request_value("department", department) or bm["department"],
			"staff_role": _parse_request_value("staff_role", staff_role) or bm["staff_role"],
			"location": _parse_request_value("location", location) or "Kolkata, West Bengal",
			"employment_type": _parse_request_value("employment_type", employment_type) or "Full Time",
			"headcount": cint(_parse_request_value("headcount", headcount) or 1),
			"kpi_json": json.dumps(kpis),
			"kra_json": json.dumps(kras),
			"jd_text": jd,
			"notes": _parse_request_value("notes", notes) or "",
			"status": "Draft",
			"created_by_user": frappe.session.user,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"plan": _serialize_plan(doc)}, message=_("Staff plan created"))


@frappe.whitelist(allow_guest=True)
def research_market_ctc(plan=None, designation=None, staff_role=None, department=None, location=None, jd_text=None, sid=None):
	"""Run market CTC estimate and optionally persist onto a staff plan."""
	frappe.flags.ignore_csrf = True
	_require_planner()
	setup_phase91()
	plan = _parse_request_value("plan", plan)

	if plan and frappe.db.exists("HEC Staff Plan", plan):
		doc = frappe.get_doc("HEC Staff Plan", plan)
		designation = designation or doc.designation
		staff_role = staff_role or doc.staff_role
		department = department or doc.department
		location = location or doc.location
		jd_text = jd_text or doc.jd_text

	research = estimate_market_ctc(
		designation=_parse_request_value("designation", designation),
		staff_role=_parse_request_value("staff_role", staff_role),
		department=_parse_request_value("department", department),
		location=_parse_request_value("location", location),
		jd_text=_parse_request_value("jd_text", jd_text),
	)

	if plan and frappe.db.exists("HEC Staff Plan", plan):
		doc = frappe.get_doc("HEC Staff Plan", plan)
		doc.market_median_ctc = research["market_median_ctc"]
		doc.market_research_json = json.dumps(research)
		if not flt(doc.desired_ctc):
			doc.desired_ctc = research["suggested_desired_ctc"]
		doc.status = "Researched" if doc.status == "Draft" else doc.status
		# Fill empty KPI/KRA from benchmark defaults
		if not _parse_json_list(doc.kpi_json):
			doc.kpi_json = json.dumps(research["matched_benchmark"]["default_kpis"])
		if not _parse_json_list(doc.kra_json):
			doc.kra_json = json.dumps(research["matched_benchmark"]["default_kras"])
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		return _success({"plan": _serialize_plan(doc), "research": research}, message=_("Market CTC estimated"))

	return _success({"research": research}, message=_("Market CTC estimated"))


@frappe.whitelist(allow_guest=True)
def set_desired_ctc(plan=None, desired_ctc=None, use_market_median=None, sid=None):
	frappe.flags.ignore_csrf = True
	_require_planner()
	plan = _parse_request_value("plan", plan)
	if not plan or not frappe.db.exists("HEC Staff Plan", plan):
		return _error(_("Plan not found"), 404)
	doc = frappe.get_doc("HEC Staff Plan", plan)
	if cint(_parse_request_value("use_market_median", use_market_median) or 0):
		doc.desired_ctc = flt(doc.market_median_ctc) or flt(doc.desired_ctc)
	else:
		doc.desired_ctc = flt(_parse_request_value("desired_ctc", desired_ctc))
	if doc.desired_ctc <= 0:
		return _error(_("desired_ctc must be greater than zero"))
	if doc.status in ("Draft", "Researched"):
		doc.status = "Approved"
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"plan": _serialize_plan(doc)}, message=_("Desired CTC saved"))


def _publish_job_opening_from_plan(doc):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import (
		_ensure_custom_fields,
		_ensure_designation,
	)

	if not frappe.db.exists("DocType", "Job Opening"):
		frappe.throw(_("Job Opening DocType missing — install HRMS careers module"))
	_ensure_custom_fields()
	_ensure_job_opening_ctc_field()
	company = _default_company()
	designation = _ensure_designation(doc.designation) or doc.designation
	meta = frappe.get_meta("Job Opening")

	kpis = _parse_json_list(doc.kpi_json)
	kras = _parse_json_list(doc.kra_json)
	description = (doc.jd_text or "").strip()
	description += "\n\n---\nKey Performance Indicators (KPIs):\n- " + "\n- ".join(kpis or ["TBD"])
	description += "\n\nKey Result Areas (KRAs):\n- " + "\n- ".join(kras or ["TBD"])
	description += f"\n\nPlanned monthly CTC band (internal): ₹{flt(doc.desired_ctc):,.0f}"

	opening = frappe.new_doc("Job Opening")
	if meta.has_field("job_title"):
		opening.job_title = doc.designation
	if meta.has_field("company") and company:
		opening.company = company
	if meta.has_field("designation") and designation:
		opening.designation = designation
	if meta.has_field("status"):
		opening.status = "Open"
	if meta.has_field("description"):
		opening.description = description
	if meta.has_field("publish"):
		opening.publish = 1
	if meta.has_field("hec_location"):
		opening.hec_location = doc.location or ""
	if meta.has_field("hec_employment_type"):
		opening.hec_employment_type = doc.employment_type or "Full Time"
	if meta.has_field("hec_department_label"):
		opening.hec_department_label = doc.department or ""
	if meta.has_field("hec_planned_ctc"):
		opening.hec_planned_ctc = flt(doc.desired_ctc)

	opening.flags.ignore_permissions = True
	opening.flags.ignore_mandatory = True
	opening.flags.ignore_validate = True
	opening.insert(ignore_permissions=True, ignore_mandatory=True)
	if meta.has_field("publish"):
		frappe.db.set_value("Job Opening", opening.name, "publish", 1, update_modified=False)
	if meta.has_field("hec_planned_ctc"):
		frappe.db.set_value("Job Opening", opening.name, "hec_planned_ctc", flt(doc.desired_ctc), update_modified=False)
	return opening.name


@frappe.whitelist(allow_guest=True)
def publish_staff_plan_to_careers(plan=None, sid=None):
	frappe.flags.ignore_csrf = True
	_require_planner()
	plan = _parse_request_value("plan", plan)
	if not plan or not frappe.db.exists("HEC Staff Plan", plan):
		return _error(_("Plan not found"), 404)
	doc = frappe.get_doc("HEC Staff Plan", plan)
	if flt(doc.desired_ctc) <= 0:
		return _error(_("Set desired CTC before publishing to Careers"))
	if doc.job_opening and frappe.db.exists("Job Opening", doc.job_opening):
		return _success(
			{"plan": _serialize_plan(doc), "already_published": True},
			message=_("Plan already linked to a Careers job opening"),
		)

	try:
		opening_name = _publish_job_opening_from_plan(doc)
	except Exception as exc:
		frappe.log_error(title="publish_staff_plan", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Could not create Job Opening"))

	doc.job_opening = opening_name
	doc.status = "Published"
	doc.published_on = now_datetime()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success(
		{
			"plan": _serialize_plan(doc),
			"job_opening": opening_name,
			"careers_jobs_url": "https://www.e-remedium.in/jobs",
			"careers_apply_url": f"https://www.e-remedium.in/jobs/{opening_name}/apply",
		},
		message=_("Job opening published to Careers"),
	)


@frappe.whitelist(allow_guest=True)
def smoke_staff_planning():
	frappe.flags.ignore_csrf = True
	if frappe.session.user == "Guest":
		frappe.set_user("Administrator")
	setup = setup_phase91()
	out = {"ok": True, "setup": setup, "checks": []}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)})
		if not cond:
			out["ok"] = False

	check("doctype", frappe.db.exists("DocType", "HEC Staff Plan"))
	# Clean prior smoke plan job titles
	title = "Smoke Planning Lab Technician"
	create = create_staff_plan(
		title=title,
		designation="Lab Technician",
		department="Laboratory",
		staff_role="Lab",
		location="Kolkata",
		headcount=1,
	)
	plan_name = (create.get("data") or {}).get("plan", {}).get("name")
	check("create_plan", bool(plan_name), plan_name)
	if not plan_name:
		return _success(out)

	research = research_market_ctc(plan=plan_name)
	med = (research.get("data") or {}).get("research", {}).get("market_median_ctc")
	check("research_median", flt(med) > 0, med)

	set_desired_ctc(plan=plan_name, use_market_median=1)
	pub = publish_staff_plan_to_careers(plan=plan_name)
	opening = (pub.get("data") or {}).get("job_opening")
	check("published_opening", bool(opening) and frappe.db.exists("Job Opening", opening), opening)
	if opening and frappe.db.exists("DocType", "Job Opening"):
		meta = frappe.get_meta("Job Opening")
		if meta.has_field("publish"):
			check("opening_published", cint(frappe.db.get_value("Job Opening", opening, "publish")) == 1)

	out["demo"] = {
		"plan": plan_name,
		"job_opening": opening,
		"planning_url": "https://erp.e-remedium.in/planning",
		"www_planning_url": "https://www.e-remedium.in/planning",
		"careers_jobs_url": "https://www.e-remedium.in/jobs",
	}
	return _success(out)
