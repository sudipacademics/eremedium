"""Phase 92 — HR policy masters, grades, payroll bands, appointment templates,
franchisee-scoped team leave/attendance (lab franchisee / B2B2C field force).

Field force reporting covers franchisees, centres, B2B partners, and referring
clinicians — not pharma stockists/chemists or drug samples.
"""

from __future__ import annotations

import os
from pathlib import Path

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today


GRADE_BANDS = (
	{
		"name": "FF-P0",
		"description": "Probationary Field — lab franchise / B2B2C",
		"structure": "HEC Field Force India",
		"base": 12000.0,  # fixed monthly base gross (flexible DA separate)
		"designation": "Probationary Business Officer",
		"da_track": "field",
	},
	{
		"name": "FF-G1",
		"description": "Business Officer — franchise & B2B growth",
		"structure": "HEC Field Force India",
		"base": 13500.0,  # Google Doc Scenario A/B standard fixed base
		"designation": "Business Officer",
		"da_track": "field",
	},
	{
		"name": "FF-G2",
		"description": "Senior / Area Business Manager",
		"structure": "HEC Field Force India",
		"base": 18000.0,
		"designation": "Area Business Manager",
		"da_track": "field",
	},
	{
		"name": "FF-G3",
		"description": "Regional / National sales leadership",
		"structure": "HEC Field Force India",
		"base": 25000.0,
		"designation": "Regional Manager",
		"da_track": "ops",
	},
	{
		"name": "HQ-L1",
		"description": "Lab / ops entry (phlebo / collection)",
		"structure": "HEC Lab Ops India",
		"base": 13500.0,
		"designation": "Phlebotomist",
		"da_track": "phlebo",
	},
	{
		"name": "HQ-L2",
		"description": "Lab technical",
		"structure": "HEC Lab Ops India",
		"base": 15000.0,  # Doc Scenario C — higher fixed, DA rolled into fixed for office
		"designation": "Lab Technician",
		"da_track": "ops",
	},
	{
		"name": "HQ-L3",
		"description": "Lab senior / pathologist track",
		"structure": "HEC Lab Ops India",
		"base": 28000.0,
		"designation": "Pathologist",
		"da_track": "ops",
	},
	{
		"name": "HQ-M1",
		"description": "HQ managers",
		"structure": "HEC Lab Ops India",
		"base": 22000.0,
		"designation": "Centre Manager",
		"da_track": "ops",
	},
	{
		"name": "FR-E1",
		"description": "Franchisee-attached centre staff",
		"structure": "HEC Franchise Staff India",
		"base": 13500.0,
		"designation": "Centre Staff",
		"da_track": "ops",
	},
)

# Mid-slab Daily Allowance (DA/TA) rates from company compensation template.
# HQ = within ~15–20 km / base city; Ex-HQ = same-day outside; OS = overnight.
DA_SLAB_POLICY = {
	"field": {
		"label": "Field Marketing & B2B Executives",
		"hq_day": 200,
		"ex_hq_day": 375,
		"os_day": 950,
		"km_rate_min": 3.0,
		"km_rate_max": 4.0,
	},
	"phlebo": {
		"label": "Phlebotomists / Sample Collectors",
		"hq_day": 125,
		"ex_hq_day": 250,
		"os_day": 650,
		"km_rate_min": 3.0,
		"km_rate_max": 4.0,
	},
	"ops": {
		"label": "Operations & Management Staff",
		"hq_day": 125,
		"ex_hq_day": 300,
		"os_day": 1150,
		"km_rate_min": 3.0,
		"km_rate_max": 4.0,
	},
}

FOOD_ALLOWANCE_FIXED = 500.0

DESIGNATIONS = (
	# Field / Reach / FFMS (lab franchise network — not pharma MRs)
	"Probationary Business Officer",
	"Business Officer",
	"Senior Business Officer",
	"Area Business Manager",
	"Regional Manager",
	"National Head",
	"Sales Manager",
	# People HQ
	"Phlebotomist",
	"Lab Technician",
	"Pathologist",
	"Centre Manager",
	"Operations Executive",
	"HR Executive",
	"Accounts Executive",
	"Customer Care",
	"QA Officer",
	"Centre Staff",
)

DESIGNATION_TO_GRADE = {
	"Probationary Business Officer": "FF-P0",
	"Business Officer": "FF-G1",
	"Senior Business Officer": "FF-G2",
	"Area Business Manager": "FF-G2",
	"Regional Manager": "FF-G3",
	"National Head": "FF-G3",
	"Sales Manager": "FF-G3",
	"Sales Representative": "FF-G1",
	"Phlebotomist": "HQ-L1",
	"Lab Technician": "HQ-L2",
	"Pathologist": "HQ-L3",
	"Centre Manager": "HQ-M1",
	"Operations Executive": "HQ-L2",
	"HR Executive": "HQ-M1",
	"Accounts Executive": "HQ-L2",
	"Customer Care": "HQ-L1",
	"QA Officer": "HQ-L2",
	"Centre Staff": "FR-E1",
}

POLICY_SNIPPETS = (
	{
		"name": "Field Force Conduct & Reporting (Lab Franchise / B2B2C)",
		"slug": "field-force-conduct",
		"body": """# Field Force Conduct & Reporting — Lab Franchise / B2B2C

Remedium field staff grow a **diagnostic lab franchise and B2B2C network**.
You are **not** a pharmaceutical medical representative. Do **not** call on
stockists or chemists for drug stock, and do **not** distribute medicine samples.

## Keep field discipline
- Maintain an approved **tour / beat programme** for your territory HQ.
- Submit **daily call reports** and meet **call-average / coverage** norms.
- Follow HQ / Ex-HQ / Outstation travel rules and working allowances.

## Call on
- Franchisees and centre managers
- B2B partner centres / panels
- Referring clinicians and camp organisers
- Prospects for FOFO / FOCO / B2B activation

## Targets (set by management, typically half-yearly)
Franchise activations & GMV, B2B panels/volume, home-collection enablement,
brand camps — **not** Rx stock goals.

## Collateral
Account for marketing kits, campaign material, and camp kits. False reporting,
proxy attendance, or inflating call averages is misconduct.
""",
	},
	{
		"name": "Leave & Attendance",
		"slug": "leave-attendance",
		"body": """# Leave & Attendance

Leave is governed by Company Leave Policy and applicable Indian labour law.
Apply through People HRMS / prescribed channels; unauthorised absence may be
treated as misconduct. Record attendance via prescribed check-in systems only.
""",
	},
	{
		"name": "Sales Target & Incentive (Franchise / B2B)",
		"slug": "sales-incentive",
		"body": """# Sales Target & Incentive

Incentives and performance bonuses are **discretionary** and do **not** form
part of fixed wages unless stated in writing (Employment Agreement §6.7).
Targets emphasise franchise growth, B2B centres, and collections
(Target Collection / B2B Volume / SPC incentives where applicable).
""",
	},
	{
		"name": "Franchisee Employee Supervision",
		"slug": "franchisee-supervision",
		"body": """# Franchisee Employee Supervision

Franchise partners do **not** receive full People HRMS access.
They may view **leave and attendance** only for employees attached to their
franchise hub. Payroll, org analytics, hiring CRM, and settings remain with
Company HR.
""",
	},
	{
		"name": "Daily Allowance (HQ / Ex-HQ / Outstation)",
		"slug": "daily-allowance-slabs",
		"body": """# Daily Allowance (DA / TA) — HQ · Ex-HQ · Outstation

Fixed monthly **Delivery / Field Allowance** is replaced by a flexible,
activity-linked Daily Allowance covering food, local conveyance, incidentals,
and stay during field visits.

## Categories
| Category | Definition |
|---|---|
| **HQ** | Duties within ~15–20 km / local city / base unit |
| **Ex-HQ** | Outside base city, same-day return (~20–80 km or >6 hrs away) |
| **Outstation (OS)** | Overnight stay outside base (>~80 km) |

## Mid-slab day rates (company defaults)
| Track | HQ / day | Ex-HQ / day | OS / day |
|---|---:|---:|---:|
| Field Marketing & B2B | ₹200 | ₹375 | ₹950 |
| Phlebotomists / Collectors | ₹125 | ₹250 | ₹650 |
| Operations & Management | ₹125 | ₹300 | ₹1,150 |

## Payout rules
1. **HQ** — auto from attendance / GPS duty check-in against designated HQ.
2. **Ex-HQ & OS** — claim via Expense / tour programme; approved by Ops Manager.
3. **Optional km reimbursement** — ₹3.00–₹4.00 / km on personal bike **in lieu of**
   fixed local DA (not stacked), per company sheet rules.

## Fixed vs variable
Monthly **Fixed Base Gross** (Basic + HRA + Dearness Allowance + Food Allowance +
Appraisal / Grade Pay) is leaner and PF/ESI compliant. Flexible DA and incentives
are **variable** and rise with approved field activity — they do **not** form part
of fixed wages unless confirmed in writing.
""",
	},
	{
		"name": "Salary Architecture (Fixed Gross + Flexible DA)",
		"slug": "salary-architecture",
		"body": """# Salary Architecture — Fixed Monthly vs Flexible DA Pool

## Core Fixed Base (payable monthly)
1. **Base Pay (Basic)** — 40% of Fixed Base Gross
2. **HRA** — 40% of Base Pay
3. **Dearness Allowance (statutory/company DA)** — 10% of Base Pay
4. **Food / Fixed Allowance (FA)** — ₹500 fixed
5. **Appraisal Pay / Grade Pay** — balance of Fixed Base Gross

## Flexible Daily Field Earnings
Computed from approved HQ / Ex-HQ / Outstation days (see Daily Allowance policy).

## Performance incentives
Target Collection / B2B Volume / SPC — monthly or quarterly; discretionary.

## Example (Field Marketing, Fixed Gross ₹13,500)
- Scenario A — 20 HQ + 5 Ex-HQ → Flexible DA ≈ ₹4,750 → Gross ≈ ₹18,250
- Scenario B — 15 HQ + 8 Ex-HQ + 2 OS → Flexible DA ≈ ₹7,050 → Gross ≈ ₹20,550
- Backend / office Fixed Gross ₹15,000 typically has DA included in fixed (₹0 variable pool)

Deductions: Employee PF ~12% of Basic + ESI ~0.75% where eligible + PT / TDS as applicable.
""",
	},
)


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def _ensure_designation(name):
	if not name or not frappe.db.exists("DocType", "Designation"):
		return None
	if frappe.db.exists("Designation", name):
		return name
	meta = frappe.get_meta("Designation")
	doc = frappe.new_doc("Designation")
	doc.name = name
	if meta.has_field("designation_name"):
		doc.designation_name = name
	doc.flags.ignore_permissions = True
	try:
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase92_designation", message=frappe.get_traceback())
		return None


def ensure_designations():
	created = []
	for name in DESIGNATIONS:
		before = frappe.db.exists("Designation", name) if frappe.db.exists("DocType", "Designation") else True
		row = _ensure_designation(name)
		if row and not before:
			created.append(row)
	return created


def ensure_employee_grades():
	created = []
	if not frappe.db.exists("DocType", "Employee Grade"):
		return created
	meta = frappe.get_meta("Employee Grade")
	for band in GRADE_BANDS:
		name = band["name"]
		if frappe.db.exists("Employee Grade", name):
			updates = {}
			if meta.has_field("description"):
				updates["description"] = band["description"]
			if meta.has_field("default_base_pay"):
				updates["default_base_pay"] = band["base"]
			if updates:
				frappe.db.set_value("Employee Grade", name, updates, update_modified=False)
			continue
		doc = frappe.new_doc("Employee Grade")
		doc.name = name
		if meta.has_field("grade_name"):
			doc.grade_name = name
		if meta.has_field("description"):
			doc.description = band["description"]
		if meta.has_field("default_base_pay"):
			doc.default_base_pay = band["base"]
		doc.flags.ignore_permissions = True
		try:
			doc.insert(ignore_permissions=True)
			created.append(name)
		except Exception:
			try:
				frappe.db.sql(
					"""
					insert into `tabEmployee Grade`
					(name, creation, modified, owner, modified_by, docstatus, idx)
					values (%s, now(), now(), %s, %s, 0, 0)
					""",
					(name, frappe.session.user, frappe.session.user),
				)
				created.append(name)
			except Exception:
				frappe.log_error(title="phase92_grade", message=frappe.get_traceback())
	frappe.db.commit()
	return created


def ensure_salary_components_phase92():
	"""Extend Phase 72 components with fixed-architecture + flexible DA + TDS."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
		ensure_salary_components,
	)

	created = list(ensure_salary_components() or [])
	if not frappe.db.exists("DocType", "Salary Component"):
		return created

	extra = (
		{"salary_component": "Dearness Allowance", "type": "Earning"},
		{"salary_component": "Food Allowance", "type": "Earning"},
		{"salary_component": "Appraisal Pay", "type": "Earning"},
		{"salary_component": "Grade Pay", "type": "Earning"},
		{"salary_component": "Conveyance Allowance", "type": "Earning"},
		{"salary_component": "Kit Allowance", "type": "Earning"},
		{"salary_component": "Education Allowance", "type": "Earning"},
		{"salary_component": "Uniform Allowance", "type": "Earning"},
		{"salary_component": "Medical Allowance", "type": "Earning"},
		{"salary_component": "Professional Pursuit Allowance", "type": "Earning"},
		{"salary_component": "Ex Gratia", "type": "Earning"},
		{"salary_component": "Transport Allowance", "type": "Earning"},
		{"salary_component": "Sales Incentive", "type": "Earning"},
		{"salary_component": "Field HQ Allowance", "type": "Earning"},
		{"salary_component": "Field Ex-HQ Allowance", "type": "Earning"},
		{"salary_component": "Field Outstation Allowance", "type": "Earning"},
		{"salary_component": "TDS", "type": "Deduction"},
		{"salary_component": "PF Employee", "type": "Deduction"},
		{"salary_component": "ESI Employee", "type": "Deduction"},
	)
	meta = frappe.get_meta("Salary Component")
	variable_pool = {
		"Sales Incentive",
		"Field HQ Allowance",
		"Field Ex-HQ Allowance",
		"Field Outstation Allowance",
	}
	for row in extra:
		name = row["salary_component"]
		if frappe.db.exists("Salary Component", name):
			continue
		try:
			doc = frappe.new_doc("Salary Component")
			doc.salary_component = name
			doc.type = row["type"]
			if meta.has_field("depends_on_payment_days"):
				doc.depends_on_payment_days = (
					0 if name in variable_pool else (1 if row["type"] == "Earning" else 0)
				)
			if meta.has_field("accounts"):
				doc.set("accounts", [])
			doc.flags.ignore_links = True
			doc.flags.ignore_validate = True
			doc.flags.ignore_mandatory = True
			doc.insert(ignore_permissions=True, ignore_links=True)
			created.append(name)
		except Exception:
			try:
				frappe.db.sql(
					"""
					insert into `tabSalary Component`
					(name, salary_component, type, creation, modified, owner, modified_by, docstatus, idx)
					values (%s,%s,%s,now(),now(),%s,%s,0,0)
					""",
					(name, name, row["type"], frappe.session.user, frappe.session.user),
				)
				created.append(name)
			except Exception:
				frappe.log_error(title="phase92_salary_component", message=frappe.get_traceback())
	frappe.db.commit()
	return created


def split_fixed_base_gross(fixed_gross, food_allowance=None):
	"""Google Doc architecture: Basic 40% gross; HRA 40% Basic; DA 10% Basic; FA fixed; Appraisal = balance."""
	gross = flt(fixed_gross)
	food = flt(food_allowance if food_allowance is not None else FOOD_ALLOWANCE_FIXED)
	basic = round(gross * 0.40, 0)
	hra = round(basic * 0.40, 0)
	dearness = round(basic * 0.10, 0)
	appraisal = max(round(gross - basic - hra - dearness - food, 0), 0)
	return {
		"fixed_gross": gross,
		"basic": basic,
		"hra": hra,
		"dearness_allowance": dearness,
		"food_allowance": food,
		"appraisal_pay": appraisal,
		"pf_employee": round(basic * 0.12, 0),
		"esi_employee": round(gross * 0.0075, 0) if gross and gross <= 21000 else 0.0,
	}


def da_track_for_grade(grade):
	band = band_for_grade(grade)
	track = (band or {}).get("da_track") or "ops"
	return track if track in DA_SLAB_POLICY else "ops"


def get_da_slab_policy(track=None, grade=None):
	if not track and grade:
		track = da_track_for_grade(grade)
	track = track or "field"
	row = dict(DA_SLAB_POLICY.get(track) or DA_SLAB_POLICY["field"])
	row["track"] = track
	return row


def estimate_flexible_da(track, hq_days=0, ex_hq_days=0, os_days=0):
	slabs = get_da_slab_policy(track=track)
	hq = cint(hq_days) * flt(slabs["hq_day"])
	ex = cint(ex_hq_days) * flt(slabs["ex_hq_day"])
	os = cint(os_days) * flt(slabs["os_day"])
	return {
		"track": track,
		"hq_days": cint(hq_days),
		"ex_hq_days": cint(ex_hq_days),
		"os_days": cint(os_days),
		"hq_amount": hq,
		"ex_hq_amount": ex,
		"os_amount": os,
		"total": hq + ex + os,
		"rates": slabs,
	}


def _add_structure_row(doc, table_field, component, amount, formula=None):
	if not table_field:
		return
	try:
		child = doc.append(table_field, {})
	except Exception:
		return
	child.salary_component = component
	child_meta = frappe.get_meta(child.doctype)
	if child_meta.has_field("amount"):
		child.amount = flt(amount)
	if formula and child_meta.has_field("formula"):
		child.formula = formula
		if child_meta.has_field("amount_based_on_formula"):
			child.amount_based_on_formula = 1


def _create_salary_structure(name, earnings, deductions, refresh=True):
	"""Create or refresh a Salary Structure with the given earning/deduction rows."""
	if not frappe.db.exists("DocType", "Salary Structure"):
		return None
	company = _default_company()
	if not company:
		return None

	for child in ("Salary Detail", "Salary Component Account"):
		if frappe.db.exists("DocType", child):
			try:
				frappe.db.set_value("DocType", child, "module", "Payroll", update_modified=False)
			except Exception:
				pass

	meta = frappe.get_meta("Salary Structure")
	existing = frappe.db.exists("Salary Structure", name)
	if existing and not refresh:
		return name

	if existing:
		doc = frappe.get_doc("Salary Structure", name)
		# Submitted structures cannot be rewritten via save — cancel first (best-effort).
		if cint(getattr(doc, "docstatus", 0)) == 1:
			try:
				doc.flags.ignore_permissions = True
				doc.cancel()
				doc.reload()
			except Exception:
				frappe.log_error(title="phase92_structure_cancel", message=frappe.get_traceback())
				# Fall through: try clearing children on cancelled/draft copy
				doc = frappe.get_doc("Salary Structure", name)
		for fieldname in ("earnings", "deductions"):
			if meta.has_field(fieldname):
				doc.set(fieldname, [])
		if cint(getattr(doc, "docstatus", 0)) == 2:
			# Amend cancelled → new draft via copy pattern: reset docstatus
			try:
				frappe.db.set_value("Salary Structure", name, "docstatus", 0, update_modified=False)
				doc = frappe.get_doc("Salary Structure", name)
				for fieldname in ("earnings", "deductions"):
					if meta.has_field(fieldname):
						doc.set(fieldname, [])
			except Exception:
				pass
	else:
		doc = frappe.new_doc("Salary Structure")
		doc.name = name
		if meta.has_field("salary_structure_name"):
			doc.salary_structure_name = name
		doc.company = company
		if meta.has_field("payroll_frequency"):
			doc.payroll_frequency = "Monthly"
		if meta.has_field("is_active"):
			doc.is_active = "Yes"
		if meta.has_field("currency"):
			try:
				doc.currency = frappe.db.get_value("Company", company, "default_currency") or "INR"
			except Exception:
				doc.currency = "INR"

	earn_field = "earnings" if meta.has_field("earnings") else None
	ded_field = "deductions" if meta.has_field("deductions") else None
	for component, amount, formula in earnings:
		if frappe.db.exists("Salary Component", component):
			_add_structure_row(doc, earn_field, component, amount, formula)
	for component, amount, formula in deductions:
		if frappe.db.exists("Salary Component", component):
			_add_structure_row(doc, ded_field, component, amount, formula)

	doc.flags.ignore_permissions = True
	doc.flags.ignore_links = True
	doc.flags.ignore_validate = True
	doc.flags.ignore_mandatory = True
	try:
		if existing:
			doc.save(ignore_permissions=True)
		else:
			doc.insert(ignore_permissions=True, ignore_links=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase92_salary_structure", message=frappe.get_traceback())
		return name if existing else None


def ensure_salary_structures_phase92():
	"""Rebuild Field / Lab / Franchise structures to Fixed Gross + Flexible DA architecture."""
	ensure_salary_components_phase92()
	pf = "PF Employee" if frappe.db.exists("Salary Component", "PF Employee") else "PF"
	esi = "ESI Employee" if frappe.db.exists("Salary Component", "ESI Employee") else "ESI"
	pt = "Professional Tax"
	tds = "TDS"

	created = []

	def _rows_for(fixed_gross, include_variable_da=True, pt_amount=150):
		parts = split_fixed_base_gross(fixed_gross)
		earnings = [
			("Basic", parts["basic"], None),
			("HRA", parts["hra"], None),
			("Dearness Allowance", parts["dearness_allowance"], None),
			("Food Allowance", parts["food_allowance"], None),
			("Appraisal Pay", parts["appraisal_pay"], None),
		]
		if include_variable_da:
			earnings.extend(
				[
					("Field HQ Allowance", 0, None),
					("Field Ex-HQ Allowance", 0, None),
					("Field Outstation Allowance", 0, None),
					("Sales Incentive", 0, None),
				]
			)
		deductions = [
			(pf, parts["pf_employee"], None),
			(esi, parts["esi_employee"], None),
			(pt, pt_amount, None),
			(tds, 0, None),
		]
		return earnings, deductions, parts

	# Field Force — Doc standard Fixed Gross ₹13,500 (G1 band)
	earn, ded, _ = _rows_for(13500, include_variable_da=True, pt_amount=150)
	name = _create_salary_structure("HEC Field Force India", earn, ded, refresh=True)
	if name:
		created.append(name)

	# Lab / Ops — Doc Scenario C Fixed Gross ₹15,000
	earn, ded, _ = _rows_for(15000, include_variable_da=True, pt_amount=200)
	name = _create_salary_structure("HEC Lab Ops India", earn, ded, refresh=True)
	if name:
		created.append(name)

	# Franchise staff — lean fixed architecture
	earn, ded, _ = _rows_for(13500, include_variable_da=False, pt_amount=110)
	name = _create_salary_structure("HEC Franchise Staff India", earn, ded, refresh=True)
	if name:
		created.append(name)

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
			ensure_salary_structure,
		)

		legacy = ensure_salary_structure()
		if legacy:
			created.append(legacy)
	except Exception:
		pass
	frappe.db.commit()
	return created


def grade_for_designation(designation):
	d = cstr(designation or "").strip()
	if d in DESIGNATION_TO_GRADE:
		return DESIGNATION_TO_GRADE[d]
	low = d.lower()
	if "regional" in low or "national" in low:
		return "FF-G3"
	if "area" in low or "senior business" in low:
		return "FF-G2"
	if "business officer" in low or "sales rep" in low:
		return "FF-G1"
	if "probationary" in low:
		return "FF-P0"
	if "pathologist" in low:
		return "HQ-L3"
	if "lab tech" in low:
		return "HQ-L2"
	if "phlebotom" in low:
		return "HQ-L1"
	if "centre manager" in low or "hr executive" in low:
		return "HQ-M1"
	if "centre staff" in low or "franchise" in low:
		return "FR-E1"
	return "HQ-L1"


def band_for_grade(grade):
	for band in GRADE_BANDS:
		if band["name"] == grade:
			return band
	return GRADE_BANDS[4]  # HQ-L1 fallback


def assign_employee_band(employee, designation=None, grade=None, franchisee=None):
	"""Set grade/designation/franchise link and SSA for structure band."""
	if not employee or not frappe.db.exists("Employee", employee):
		return {"ok": False, "error": "employee missing"}
	designation = designation or frappe.db.get_value("Employee", employee, "designation")
	grade = grade or grade_for_designation(designation)
	band = band_for_grade(grade)
	_ensure_designation(designation or band["designation"])
	emp_meta = frappe.get_meta("Employee")
	updates = {}
	if emp_meta.has_field("designation") and (designation or band["designation"]):
		updates["designation"] = designation or band["designation"]
	if emp_meta.has_field("grade"):
		if frappe.db.exists("DocType", "Employee Grade") and not frappe.db.exists("Employee Grade", grade):
			ensure_employee_grades()
		updates["grade"] = grade
	if franchisee and emp_meta.has_field("hec_franchisee"):
		updates["hec_franchisee"] = franchisee
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=False)

	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
		ensure_structure_assignment,
	)

	ensure_salary_structures_phase92()
	structure = band["structure"]
	if not frappe.db.exists("Salary Structure", structure):
		structure = "HEC Standard India"
	ssa = ensure_structure_assignment(employee, structure=structure, base=band["base"])
	frappe.db.commit()
	return {
		"ok": True,
		"employee": employee,
		"grade": grade,
		"structure": structure,
		"base": band["base"],
		"assignment": ssa,
		"franchisee": franchisee,
	}


def ensure_employee_franchise_field():
	"""Custom field Employee.hec_franchisee → Franchisee Profile."""
	if not frappe.db.exists("DocType", "Employee"):
		return {"ok": False, "reason": "no Employee"}
	if not frappe.db.exists("DocType", "Franchisee Profile"):
		return {"ok": False, "reason": "no Franchisee Profile"}
	if frappe.db.exists("Custom Field", {"dt": "Employee", "fieldname": "hec_franchisee"}):
		return {"ok": True, "created": False}
	try:
		doc = frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": "Employee",
				"fieldname": "hec_franchisee",
				"label": "Franchisee Hub",
				"fieldtype": "Link",
				"options": "Franchisee Profile",
				"insert_after": "branch",
				"description": "Franchise hub for centre-attached staff (partner leave/attendance scope).",
			}
		)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return {"ok": True, "created": True}
	except Exception:
		frappe.log_error(title="phase92_hec_franchisee", message=frappe.get_traceback())
		return {"ok": False, "error": "custom field failed"}


def _agreement_text():
	candidates = [
		Path(frappe.get_app_path("health_ecosystem_core")) / ".." / ".." / ".." / "docs" / "contracts" / "smilecure-employment-agreement.txt",
		Path("/opt/health-ecosystem/docs/contracts/smilecure-employment-agreement.txt"),
		Path("/home/frappe/frappe-bench/sites/docs/contracts/smilecure-employment-agreement.txt"),
		Path("/home/frappe/frappe-bench/apps/docs/contracts/smilecure-employment-agreement.txt"),
	]
	# Also search workspace relative to this file
	here = Path(__file__).resolve()
	candidates.append(here.parents[4] / "docs" / "contracts" / "smilecure-employment-agreement.txt")
	for path in candidates:
		try:
			p = path.resolve()
			if p.is_file():
				return p.read_text(encoding="utf-8", errors="replace")
		except Exception:
			continue
	return (
		"EMPLOYMENT AGREEMENT — SMILECURE LIFESTYLE PRIVATE LIMITED\n"
		"(Full text seed missing on site; see docs/contracts/smilecure-employment-agreement.txt)\n"
	)


def _ensure_print_format(name, html, standard="No"):
	if not frappe.db.exists("DocType", "Print Format"):
		return None
	if frappe.db.exists("Print Format", name):
		frappe.db.set_value("Print Format", name, "html", html, update_modified=False)
		return name
	doc = frappe.get_doc(
		{
			"doctype": "Print Format",
			"name": name,
			"doc_type": "Employee",
			"module": "HR",
			"standard": standard,
			"custom_format": 1,
			"html": html,
			"print_format_type": "Jinja",
		}
	)
	meta = frappe.get_meta("Print Format")
	if meta.has_field("disabled"):
		doc.disabled = 0
	try:
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="phase92_print_format", message=frappe.get_traceback())
		return None


def _letter_shell(title, body_html):
	return f"""
<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #152029; line-height: 1.45;">
  <div style="border-bottom: 2px solid #1f6f8b; padding-bottom: 8px; margin-bottom: 16px;">
    <div style="font-size: 18pt; font-weight: 700; color: #0f3d4d;">Remedium</div>
    <div style="font-size: 9pt; color: #5c6b78;">a unit of Smilecure Lifestyle Pvt. Ltd</div>
    <div style="font-size: 9pt; color: #5c6b78;">Fortune Township, Shop No. Q-60, Kazipara, Barasat, Kolkata – 700125</div>
  </div>
  <h2 style="font-size: 13pt; color: #0f3d4d;">{title}</h2>
  <p style="font-size: 8pt; color: #a2452e;"><em>Template — confirm with HR/legal before issue.</em></p>
  {body_html}
</div>
"""


def ensure_print_formats():
	"""Seed Remedium appointment / agreement print formats (Employee)."""
	created = []
	ff_body = """
<p>Date: {{ frappe.utils.formatdate(frappe.utils.today()) }}</p>
<p>To<br><strong>{{ doc.employee_name }}</strong><br>{{ doc.current_address or doc.permanent_address or "" }}</p>
<p>Dear {{ doc.employee_name }},</p>
<p>We are pleased to appoint you as <strong>{{ doc.designation or "Business Officer" }}</strong>
(grade {{ doc.grade or "FF-G1" }}) in our <strong>lab franchisee and B2B2C</strong> network,
with headquarters / posting as communicated separately.</p>
<p><strong>Probation:</strong> Three (3) months from date of joining, subject to the Employment Agreement.</p>
<p><strong>Duties (Field Force — Lab Franchise / B2B2C):</strong> Maintain tour programmes, daily call
reports, and call averages covering <strong>franchisees, collection centres, B2B partners, and referring
clinicians</strong>. You are not engaged as a pharmaceutical medical representative and shall not cover
stockists/chemists for drug stock or distribute medicine samples. Account for marketing / camp kits.
Targets (typically half-yearly) emphasise franchise activations, B2B volume, and collections.</p>
<p><strong>Compensation:</strong> Fixed Monthly Base Gross as per Salary Annexure (Basic 40% of fixed gross;
HRA 40% of Basic; Dearness Allowance 10% of Basic; Food Allowance ₹500; Appraisal / Grade Pay = balance).
Flexible Daily Allowance (HQ / Ex-HQ / Outstation) is activity-linked and <em>not</em> part of fixed wages.
Incentives are discretionary. Statutory PF / ESI / PT / TDS apply where eligible.</p>
<p><strong>Notice:</strong> Thirty (30) days or pay in lieu, per Employment Agreement.</p>
<p><strong>Joining documents:</strong> Resignation &amp; relieving letters (if applicable), last salary proof,
experience &amp; education certificates, photographs, PAN, Aadhaar.</p>
<p>Beyond the terms of salary &amp; breakup in the annexure, no other commitment is made/applicable.</p>
<p>Yours faithfully,<br>For Smilecure Lifestyle Pvt. Ltd. (Remedium)<br>Human Resources</p>
<hr>
<p>I accept and shall join on or before __________.<br>Name / Signature / Date</p>
"""
	hq_body = """
<p>Date: {{ frappe.utils.formatdate(frappe.utils.today()) }}</p>
<p>To<br><strong>{{ doc.employee_name }}</strong></p>
<p>We appoint you as <strong>{{ doc.designation or "Staff" }}</strong>
(grade {{ doc.grade or "HQ-L1" }}) effective your date of joining.</p>
<p>Probation: 3 months. Working hours: as per Company policy / Agreement §5.
Compensation = Fixed Monthly Base Gross (Basic / HRA / Dearness Allowance / Food Allowance /
Appraisal Pay) per Salary Annexure, plus activity-linked Daily Allowance where applicable.
PF/ESI/PT/TDS apply where eligible.</p>
<p>Yours faithfully,<br>Human Resources — Remedium</p>
<p>I accept the above terms. Signature / Date __________</p>
"""
	fr_body = """
<p>Date: {{ frappe.utils.formatdate(frappe.utils.today()) }}</p>
<p>To<br><strong>{{ doc.employee_name }}</strong></p>
<p>You are appointed as <strong>{{ doc.designation or "Centre Staff" }}</strong>
attached to franchise hub <strong>{{ doc.hec_franchisee or "—" }}</strong>.</p>
<p>Your franchise partner may view your leave and attendance only; full HRMS remains with Company HR.
Compensation per <em>HEC Franchise Staff India</em> Fixed Base Gross + annexure
(flexible DA only when management authorises field duty).</p>
<p>Yours faithfully,<br>Human Resources — Remedium</p>
"""
	agreement_raw = _agreement_text().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
	agreement_html = "<pre style='white-space:pre-wrap;font-size:9pt;'>" + agreement_raw[:48000] + "</pre>"
	agreement_html += "<p><strong>Employee:</strong> {{ doc.employee_name }} · <strong>Designation:</strong> {{ doc.designation }} · <strong>Grade:</strong> {{ doc.grade }}</p>"

	annexure = """
<p><strong>Salary Annexure</strong> for {{ doc.employee_name }} ({{ doc.name }})</p>
<p>Designation: {{ doc.designation }} · Grade: {{ doc.grade }} · Structure per Salary Structure Assignment.</p>
<p><strong>Fixed Monthly Base Gross</strong> (payable monthly)</p>
<ul>
  <li><strong>Basic</strong> — 40% of Fixed Base Gross</li>
  <li><strong>HRA</strong> — 40% of Basic</li>
  <li><strong>Dearness Allowance</strong> — 10% of Basic</li>
  <li><strong>Food / Fixed Allowance</strong> — ₹500</li>
  <li><strong>Appraisal Pay / Grade Pay</strong> — balance of Fixed Base Gross</li>
</ul>
<p><strong>Flexible Daily Allowance (variable)</strong> — HQ / Ex-HQ / Outstation mid-slab rates by role track
(Field Marketing &amp; B2B · Phlebotomists · Ops &amp; Management). HQ may auto-pay from attendance/GPS;
Ex-HQ &amp; OS via approved tour/expense. Optional personal-bike km ₹3–4/km in lieu of local DA.</p>
<p><strong>Performance incentives</strong> (Collection / B2B / SPC) are discretionary and do not form fixed wages
unless confirmed in writing.</p>
<p><strong>Payroll (statutory)</strong></p>
<ul>
  <li><strong>PF</strong> — ~12% of Basic (employee) + employer as per EPF Act where eligible.</li>
  <li><strong>ESI</strong> — ~0.75% employee where wages are under ESI coverage.</li>
  <li><strong>Professional Tax</strong> — as per West Bengal PT schedule (or place of work).</li>
  <li><strong>TDS</strong> — deducted under Income Tax Act when applicable; Form 16 as per policy.</li>
</ul>
<p><em>Exact amounts are maintained in ERPNext Salary Structure / Assignment — print from Payroll for figures
binding at join date. Source template: company Fixed Gross + Flexible DA compensation note.</em></p>
"""

	mapping = [
		("Remedium Appointment — Field Force", _letter_shell("Letter of Appointment — Field Force (Lab Franchise / B2B2C)", ff_body)),
		("Remedium Appointment — HQ Lab Ops", _letter_shell("Letter of Appointment — HQ / Lab / Ops", hq_body)),
		("Remedium Appointment — Franchise Staff", _letter_shell("Letter of Appointment — Franchisee-attached Staff", fr_body)),
		("Remedium Employment Agreement", _letter_shell("Employment Agreement — Smilecure Lifestyle Pvt. Ltd.", agreement_html)),
		("Remedium Salary Annexure", _letter_shell("Salary Annexure", annexure)),
	]
	for name, html in mapping:
		if _ensure_print_format(name, html):
			created.append(name)
	frappe.db.commit()
	return created


def list_hr_policies():
	return [
		{"name": p["name"], "slug": p["slug"], "body": p["body"]}
		for p in POLICY_SNIPPETS
	]


def list_hr_grades():
	ensure_employee_grades()
	return {
		"grades": [
			{
				"name": b["name"],
				"description": b["description"],
				"structure": b["structure"],
				"base": b["base"],
				"designation": b["designation"],
				"da_track": b.get("da_track"),
				"da_slabs": get_da_slab_policy(track=b.get("da_track")),
			}
			for b in GRADE_BANDS
		],
		"food_allowance_fixed": FOOD_ALLOWANCE_FIXED,
		"architecture": {
			"basic_pct_of_gross": 0.40,
			"hra_pct_of_basic": 0.40,
			"dearness_pct_of_basic": 0.10,
			"food_allowance": FOOD_ALLOWANCE_FIXED,
			"appraisal": "balance of fixed gross",
		},
	}


def list_hr_designations_master():
	ensure_designations()
	rows = []
	for name in DESIGNATIONS:
		grade = DESIGNATION_TO_GRADE.get(name)
		band = band_for_grade(grade) if grade else None
		rows.append(
			{
				"designation": name,
				"grade": grade,
				"structure": band["structure"] if band else None,
				"indicative_base": band["base"] if band else None,
			}
		)
	return {"designations": rows}


def get_appointment_letter_html(employee, letter_type="field"):
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	emp = frappe.get_doc("Employee", employee)
	key = {
		"field": "Remedium Appointment — Field Force",
		"hq": "Remedium Appointment — HQ Lab Ops",
		"franchise": "Remedium Appointment — Franchise Staff",
		"agreement": "Remedium Employment Agreement",
		"annexure": "Remedium Salary Annexure",
	}.get(cstr(letter_type) or "field", "Remedium Appointment — Field Force")
	ensure_print_formats()
	html = frappe.db.get_value("Print Format", key, "html") or ""
	# Lightweight Jinja substitute for common fields (Desk uses full engine)
	repl = {
		"{{ doc.employee_name }}": cstr(emp.employee_name or emp.name),
		"{{ doc.designation or \"Business Officer\" }}": cstr(emp.designation or "Business Officer"),
		"{{ doc.designation or \"Staff\" }}": cstr(emp.designation or "Staff"),
		"{{ doc.designation or \"Centre Staff\" }}": cstr(emp.designation or "Centre Staff"),
		"{{ doc.designation }}": cstr(emp.designation or ""),
		"{{ doc.grade or \"FF-G1\" }}": cstr(getattr(emp, "grade", None) or "FF-G1"),
		"{{ doc.grade or \"HQ-L1\" }}": cstr(getattr(emp, "grade", None) or "HQ-L1"),
		"{{ doc.grade }}": cstr(getattr(emp, "grade", None) or ""),
		"{{ doc.hec_franchisee or \"—\" }}": cstr(getattr(emp, "hec_franchisee", None) or "—"),
		"{{ doc.name }}": cstr(emp.name),
		"{{ doc.current_address or doc.permanent_address or \"\" }}": cstr(
			getattr(emp, "current_address", None) or getattr(emp, "permanent_address", None) or ""
		),
		"{{ frappe.utils.formatdate(frappe.utils.today()) }}": cstr(today()),
	}
	out = html
	for a, b in repl.items():
		out = out.replace(a, b)
	return {"employee": emp.name, "letter_type": letter_type, "print_format": key, "html": out}


def letter_type_for_grade(grade):
	g = cstr(grade or "")
	if g.startswith("FF"):
		return "field"
	if g.startswith("FR"):
		return "franchise"
	return "hq"


def _inr(amount):
	try:
		return f"₹{flt(amount):,.0f}"
	except Exception:
		return f"₹{amount}"


def build_payroll_dynamic_html(grade, structure, monthly_ctc, band_base=None):
	"""Dynamic payroll block — Fixed Gross split + Flexible DA slabs (Google Doc architecture)."""
	ctc = flt(monthly_ctc) or flt(band_base) or 0
	parts = split_fixed_base_gross(ctc)
	track = da_track_for_grade(grade)
	slabs = get_da_slab_policy(track=track)
	# Doc Scenario A illustrative flexible DA for field tracks
	scenario = None
	if track == "field":
		scenario = estimate_flexible_da("field", hq_days=20, ex_hq_days=5, os_days=0)
	elif track == "phlebo":
		scenario = estimate_flexible_da("phlebo", hq_days=20, ex_hq_days=5, os_days=0)
	esi_likely = bool(ctc and ctc <= 21000)
	pf_note = (
		f"Employee PF ~12% of Basic ({_inr(parts['basic'])}) subject to wage ceiling / EPF rules;"
		" employer contribution per statute."
		if parts["basic"]
		else "PF as per EPF Act where eligible."
	)
	esi_note = (
		f"ESI employee ~0.75% of wages (~{_inr(parts['esi_employee'])}) where wages are within ESI coverage."
		if esi_likely
		else "ESI generally not applicable at this fixed-gross band; reassess if wages change."
	)
	scenario_html = ""
	if scenario:
		scenario_html = f"""
  <p style="margin:10px 0 4px;font-size:9.5pt;"><strong>Illustrative flexible DA</strong>
  ({frappe.utils.escape_html(slabs.get('label') or track)} mid-slab:
  HQ ₹{int(slabs['hq_day'])} / Ex-HQ ₹{int(slabs['ex_hq_day'])} / OS ₹{int(slabs['os_day'])} per day)</p>
  <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
    <tr><td style="padding:3px 0;">HQ {scenario['hq_days']} days</td><td style="text-align:right;">{_inr(scenario['hq_amount'])}</td></tr>
    <tr><td style="padding:3px 0;">Ex-HQ {scenario['ex_hq_days']} days</td><td style="text-align:right;">{_inr(scenario['ex_hq_amount'])}</td></tr>
    <tr style="font-weight:650;"><td style="padding:3px 0;">Flexible DA subtotal</td><td style="text-align:right;">{_inr(scenario['total'])}</td></tr>
    <tr style="font-weight:700;border-top:1px solid #c9d8df;"><td style="padding:6px 0;">Est. gross with Scenario A DA</td>
      <td style="text-align:right;">{_inr(ctc + scenario['total'])}</td></tr>
  </table>
"""
	return f"""
<div style="border:1px solid #d5e2e8;border-radius:8px;padding:12px 14px;margin:16px 0;background:#f7fbfc;">
  <h3 style="margin:0 0 8px;font-size:12pt;color:#0f3d4d;">Payroll &amp; compensation (offer)</h3>
  <p style="margin:0 0 8px;">Grade <strong>{frappe.utils.escape_html(cstr(grade))}</strong>
  · Structure <strong>{frappe.utils.escape_html(cstr(structure))}</strong>
  · <strong>Fixed Monthly Base Gross</strong> <strong>{_inr(ctc)}</strong>
  {f'(band indicative {_inr(band_base)})' if band_base and flt(band_base) != ctc else ''}</p>
  <p style="margin:0 0 8px;font-size:9pt;color:#5c6b78;">Architecture: Basic 40% of fixed gross · HRA 40% of Basic ·
  Dearness Allowance 10% of Basic · Food Allowance ₹500 · Appraisal / Grade Pay = balance.
  Flexible HQ / Ex-HQ / Outstation DA is <em>variable</em> and not part of fixed wages.</p>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <tr><td style="padding:4px 0;">Basic (40% of fixed gross)</td><td style="text-align:right;">{_inr(parts['basic'])}</td></tr>
    <tr><td style="padding:4px 0;">HRA (40% of Basic)</td><td style="text-align:right;">{_inr(parts['hra'])}</td></tr>
    <tr><td style="padding:4px 0;">Dearness Allowance (10% of Basic)</td><td style="text-align:right;">{_inr(parts['dearness_allowance'])}</td></tr>
    <tr><td style="padding:4px 0;">Food / Fixed Allowance</td><td style="text-align:right;">{_inr(parts['food_allowance'])}</td></tr>
    <tr><td style="padding:4px 0;">Appraisal / Grade Pay</td><td style="text-align:right;">{_inr(parts['appraisal_pay'])}</td></tr>
    <tr style="font-weight:700;border-top:1px solid #c9d8df;"><td style="padding:6px 0;">Fixed Monthly Base Gross</td>
      <td style="text-align:right;">{_inr(ctc)}</td></tr>
  </table>
  {scenario_html}
  <ul style="margin:10px 0 0;padding-left:18px;font-size:9.5pt;color:#334;">
    <li><strong>PF:</strong> {pf_note}</li>
    <li><strong>ESI:</strong> {esi_note}</li>
    <li><strong>Professional Tax:</strong> Deducted per applicable state schedule (e.g. West Bengal).</li>
    <li><strong>TDS:</strong> Deducted under the Income Tax Act when liability arises; Form 16 as per company process.</li>
    <li><strong>Flexible DA / incentives:</strong> HQ auto via attendance/GPS; Ex-HQ &amp; OS via approved tour/expense.
    Optional bike km ₹3–4/km in lieu of local DA. Not part of fixed wages unless confirmed in writing.</li>
  </ul>
  <p style="margin:8px 0 0;font-size:8.5pt;color:#6a7a86;">
    Indicative breakup for offer review only. Binding figures are confirmed on Salary Structure Assignment at joining.
  </p>
</div>
"""


def _position_duties_html(letter_type):
	if letter_type == "field":
		return (
			"<p><strong>Duties (Field Force — Lab Franchise / B2B2C):</strong> Tour programmes, daily call "
			"reports, and coverage of franchisees, collection centres, B2B partners, and referring clinicians. "
			"Not a pharmaceutical medical representative; no stockist/chemist drug coverage or medicine samples. "
			"Targets emphasise franchise activations, B2B volume, and collections.</p>"
		)
	if letter_type == "franchise":
		return (
			"<p><strong>Duties (Franchise centre staff):</strong> Centre operations under Company HRMS with "
			"franchise hub linkage. Franchise partners may view leave/attendance only.</p>"
		)
	return (
		"<p><strong>Duties (HQ / Lab / Ops):</strong> As per department SOPs, quality and shift policy, "
		"and reporting manager instructions.</p>"
	)


def build_job_offer_email_pack(
	applicant_name,
	applicant_email,
	designation,
	department=None,
	joining_date=None,
	salary_offered=None,
	offer_name=None,
	job_title=None,
):
	"""Compose position-templated offer letter + agreement + payroll annexure for email queue."""
	ensure_print_formats()
	designation = cstr(designation or job_title or "Staff").strip()
	grade = grade_for_designation(designation)
	band = band_for_grade(grade)
	letter_type = letter_type_for_grade(grade)
	structure = band.get("structure") or "HEC Standard India"
	ctc = flt(salary_offered) or flt(band.get("base")) or 0
	name = cstr(applicant_name or "Candidate")
	joining = cstr(joining_date or "") or "as mutually agreed"
	dept = cstr(department or "")

	appointment_title = {
		"field": "Letter of Appointment — Field Force (Lab Franchise / B2B2C)",
		"hq": "Letter of Appointment — HQ / Lab / Ops",
		"franchise": "Letter of Appointment — Franchisee-attached Staff",
	}.get(letter_type, "Letter of Appointment")

	payroll_html = build_payroll_dynamic_html(grade, structure, ctc, band.get("base"))
	duties = _position_duties_html(letter_type)

	appointment_body = f"""
<p>Date: {frappe.utils.formatdate(today())}</p>
<p>To<br><strong>{frappe.utils.escape_html(name)}</strong></p>
<p>Dear {frappe.utils.escape_html(name)},</p>
<p>We are pleased to offer you the position of <strong>{frappe.utils.escape_html(designation)}</strong>
(grade <strong>{frappe.utils.escape_html(grade)}</strong>)
{f'in department <strong>{frappe.utils.escape_html(dept)}</strong>' if dept else ''}
with Smilecure Lifestyle Pvt. Ltd. (Remedium).</p>
<p><strong>Proposed joining date:</strong> {frappe.utils.escape_html(joining)}</p>
<p><strong>Probation:</strong> Three (3) months from date of joining, subject to the Employment Agreement.</p>
{duties}
{payroll_html}
<p><strong>Notice:</strong> Thirty (30) days or pay in lieu, per Employment Agreement.</p>
<p><strong>Joining documents:</strong> Resignation &amp; relieving (if applicable), last salary proof,
education &amp; experience certificates, photographs, PAN, Aadhaar.</p>
<p>This offer is contingent on satisfactory documentation and background checks as applicable.</p>
<p>Yours faithfully,<br>For Smilecure Lifestyle Pvt. Ltd. (Remedium)<br>Human Resources</p>
"""

	agreement_excerpt = _agreement_text()
	# Keep email size sane — full text still available via Print Format / Desk
	excerpt = agreement_excerpt[:12000]
	if len(agreement_excerpt) > 12000:
		excerpt += "\n\n[… full Employment Agreement continues in attached / Desk Print Format …]\n"
	agreement_html = (
		"<h3 style='color:#0f3d4d;'>Employment Agreement — Smilecure Lifestyle Pvt. Ltd.</h3>"
		f"<p>Parties: Company and <strong>{frappe.utils.escape_html(name)}</strong> · "
		f"Designation <strong>{frappe.utils.escape_html(designation)}</strong> · "
		f"Grade <strong>{frappe.utils.escape_html(grade)}</strong></p>"
		"<pre style='white-space:pre-wrap;font-size:9pt;background:#fafafa;padding:10px;border:1px solid #e6ecef;'>"
		+ frappe.utils.escape_html(excerpt)
		+ "</pre>"
	)

	annexure_html = f"""
<h3 style="color:#0f3d4d;">Salary Annexure</h3>
<p>Candidate: <strong>{frappe.utils.escape_html(name)}</strong>
· Offer: {frappe.utils.escape_html(cstr(offer_name or "—"))}</p>
{payroll_html}
<p style="font-size:9pt;">Structure master: <em>{frappe.utils.escape_html(structure)}</em>. 
Final Salary Structure Assignment is created when you are hired into People HRMS.</p>
"""

	pack_html = _letter_shell(
		appointment_title,
		appointment_body
		+ "<hr style='margin:24px 0;border:0;border-top:1px solid #d5e2e8;'>"
		+ annexure_html
		+ "<hr style='margin:24px 0;border:0;border-top:1px solid #d5e2e8;'>"
		+ agreement_html
		+ "<p style='font-size:8pt;color:#a2452e;margin-top:16px;'>"
		"<em>Queued for HR Manager review before send. Not an executed contract until accepted and joined.</em></p>",
	)

	subject = f"Job Offer — {designation} | Remedium ({grade})"
	return {
		"letter_type": letter_type,
		"grade": grade,
		"structure": structure,
		"monthly_ctc": ctc,
		"band_base": flt(band.get("base")),
		"subject": subject,
		"html": pack_html,
		"recipient_email": cstr(applicant_email or "").strip().lower(),
		"designation": designation,
		"print_formats": [
			{
				"field": "Remedium Appointment — Field Force",
				"hq": "Remedium Appointment — HQ Lab Ops",
				"franchise": "Remedium Appointment — Franchise Staff",
			}.get(letter_type),
			"Remedium Salary Annexure",
			"Remedium Employment Agreement",
		],
	}


def _franchise_for_user(user):
	user = user or frappe.session.user
	if not frappe.db.exists("DocType", "Franchisee Profile"):
		return None
	meta = frappe.get_meta("Franchisee Profile")
	filters = {}
	if meta.has_field("linked_user"):
		filters["linked_user"] = user
	elif meta.has_field("user"):
		filters["user"] = user
	else:
		return None
	rows = frappe.get_all("Franchisee Profile", filters=filters, pluck="name", limit=1)
	return rows[0] if rows else None


def _team_employees(franchisee):
	if not franchisee or not frappe.db.exists("DocType", "Employee"):
		return []
	filters = {"status": "Active"}
	meta = frappe.get_meta("Employee")
	if meta.has_field("hec_franchisee"):
		filters["hec_franchisee"] = franchisee
	else:
		return []
	return frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "designation", "department", "user_id"],
		limit_page_length=500,
	)


def get_franchise_team_attendance(user=None):
	"""Leave franchise partners to see check-ins for attached employees only."""
	user = user or frappe.session.user
	roles = frappe.get_roles(user)
	franchisee = _franchise_for_user(user)
	if not franchisee and "Franchisee Operator" not in roles and "HR Manager" not in roles:
		frappe.throw(_("Franchisee access required"), frappe.PermissionError)
	if not franchisee and "HR Manager" in roles:
		return {"franchisee": None, "employees": [], "note": "HR: pick a franchisee hub to filter"}
	employees = _team_employees(franchisee)
	ids = [e.name for e in employees]
	today_d = getdate(today())
	attendance = []
	if ids and frappe.db.exists("DocType", "Employee Checkin"):
		for emp in employees:
			count = frappe.db.sql(
				"""
				select count(*) from `tabEmployee Checkin`
				where employee=%s and date(time)=%s
				""",
				(emp.name, cstr(today_d)),
			)[0][0]
			last = frappe.db.sql(
				"""
				select log_type, time from `tabEmployee Checkin`
				where employee=%s order by time desc limit 1
				""",
				(emp.name,),
			)
			attendance.append(
				{
					"employee": emp.name,
					"employee_name": emp.employee_name,
					"designation": emp.designation,
					"checkins_today": cint(count),
					"last_log_type": last[0][0] if last else None,
					"last_time": cstr(last[0][1]) if last else None,
					"today_status": "Present" if count else "Not checked in",
				}
			)
	elif employees:
		for emp in employees:
			attendance.append(
				{
					"employee": emp.name,
					"employee_name": emp.employee_name,
					"designation": emp.designation,
					"checkins_today": 0,
					"today_status": "Unknown",
				}
			)
	return {
		"franchisee": franchisee,
		"as_of": cstr(today_d),
		"employees": attendance,
		"count": len(attendance),
	}


def get_franchise_team_leave(user=None):
	user = user or frappe.session.user
	roles = frappe.get_roles(user)
	franchisee = _franchise_for_user(user)
	if not franchisee and "Franchisee Operator" not in roles:
		frappe.throw(_("Franchisee access required"), frappe.PermissionError)
	employees = _team_employees(franchisee)
	ids = [e.name for e in employees]
	leaves = []
	if ids and frappe.db.exists("DocType", "Leave Application"):
		rows = frappe.get_all(
			"Leave Application",
			filters={"employee": ("in", ids)},
			fields=[
				"name",
				"employee",
				"employee_name",
				"leave_type",
				"from_date",
				"to_date",
				"status",
				"total_leave_days",
			],
			order_by="from_date desc",
			limit_page_length=100,
		)
		leaves = [
			{
				"name": r.name,
				"employee": r.employee,
				"employee_name": r.employee_name,
				"leave_type": r.leave_type,
				"from_date": cstr(r.from_date),
				"to_date": cstr(r.to_date),
				"status": r.status,
				"days": flt(r.total_leave_days),
			}
			for r in rows
		]
	return {"franchisee": franchisee, "leaves": leaves, "count": len(leaves)}


def setup_phase92():
	out = {"ok": True, "phase": 92, "steps": []}
	try:
		out["steps"].append({"employee_franchise_field": ensure_employee_franchise_field()})
		out["steps"].append({"designations": ensure_designations()})
		out["steps"].append({"grades": ensure_employee_grades()})
		out["steps"].append({"components": ensure_salary_components_phase92()})
		out["steps"].append({"structures": ensure_salary_structures_phase92()})
		out["steps"].append({"print_formats": ensure_print_formats()})
		out["policies"] = [p["slug"] for p in POLICY_SNIPPETS]
	except Exception as exc:
		out["ok"] = False
		out["error"] = cstr(exc)[:240]
		frappe.log_error(title="phase92_setup", message=frappe.get_traceback())
	frappe.db.commit()
	return out


def smoke_phase92():
	setup = setup_phase92()
	result = {"ok": setup.get("ok", False), "setup": setup, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)})
		if not cond:
			result["ok"] = False

	check("designation_bo", bool(frappe.db.exists("Designation", "Business Officer")))
	check("structure_ff", bool(frappe.db.exists("Salary Structure", "HEC Field Force India")))
	check("structure_lab", bool(frappe.db.exists("Salary Structure", "HEC Lab Ops India")))
	check("structure_fr", bool(frappe.db.exists("Salary Structure", "HEC Franchise Staff India")))
	check(
		"component_tds",
		bool(frappe.db.exists("Salary Component", "TDS"))
		or bool(frappe.db.exists("Salary Component", "PF")),
	)
	check(
		"component_dearness",
		bool(frappe.db.exists("Salary Component", "Dearness Allowance")),
	)
	check(
		"component_food",
		bool(frappe.db.exists("Salary Component", "Food Allowance")),
	)
	check(
		"component_appraisal",
		bool(frappe.db.exists("Salary Component", "Appraisal Pay")),
	)
	parts = split_fixed_base_gross(13500)
	check("split_basic_5400", flt(parts["basic"]) == 5400, parts["basic"])
	check("split_hra_2160", flt(parts["hra"]) == 2160, parts["hra"])
	check("split_da_540", flt(parts["dearness_allowance"]) == 540, parts["dearness_allowance"])
	check("split_food_500", flt(parts["food_allowance"]) == 500, parts["food_allowance"])
	da = estimate_flexible_da("field", hq_days=20, ex_hq_days=5, os_days=0)
	check("da_scenario_a", flt(da["total"]) == 20 * 200 + 5 * 375, da["total"])
	check(
		"print_ff",
		bool(frappe.db.exists("Print Format", "Remedium Appointment — Field Force")),
	)
	check(
		"hec_franchisee_field",
		bool(frappe.db.exists("Custom Field", {"dt": "Employee", "fieldname": "hec_franchisee"}))
		or not frappe.db.exists("DocType", "Franchisee Profile"),
	)
	check(
		"policy_da_slab",
		any(p["slug"] == "daily-allowance-slabs" for p in POLICY_SNIPPETS),
	)
	return result


# "password" is the published demo default: never applied (a new login gets hec_seed_staff_password or a random one);
# setup_phase132 reads it to rotate admin accounts still using it.
SALES_REP_DEMO = {
	"email": "sales.rep.demo@health.local",
	"password": "SalesRepDemo@123",
	"first_name": "Aarav",
	"last_name": "Sen",
	"full_name": "Aarav Sen",
	"designation": "Sales Representative",
	"fixed_gross": 13500.0,
}


def _ensure_sales_rep_user_employee():
	"""Create / refresh Sales Representative demo User + Employee + FF band."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
		ensure_structure_assignment,
		setup_phase72,
	)

	setup_phase92()
	try:
		setup_phase72()
	except Exception:
		pass

	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import seed_staff_password

	email = SALES_REP_DEMO["email"]
	created = not frappe.db.exists("User", email)
	if created:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": SALES_REP_DEMO["first_name"],
				"last_name": SALES_REP_DEMO["last_name"],
				"send_welcome_email": 0,
				"user_type": "System User",
				"enabled": 1,
			}
		)
		user.flags.ignore_permissions = True
		user.insert(ignore_permissions=True)
		user.new_password = seed_staff_password()
		user.save(ignore_permissions=True)
	else:
		user = frappe.get_doc("User", email)
		user.enabled = 1
		user.first_name = SALES_REP_DEMO["first_name"]
		user.last_name = SALES_REP_DEMO["last_name"]
		user.save(ignore_permissions=True)

	for role in ("Employee", "Sales Representative"):
		if frappe.db.exists("Role", role) and role not in frappe.get_roles(email):
			user.add_roles(role)

	employee = ensure_employee_for_user(email)
	if not employee:
		frappe.throw(_("Could not create Employee for Sales Representative"))

	band = assign_employee_band(
		employee,
		designation=SALES_REP_DEMO["designation"],
		grade="FF-G1",
	)
	try:
		ensure_structure_assignment(
			employee,
			structure="HEC Field Force India",
			base=SALES_REP_DEMO["fixed_gross"],
		)
	except Exception:
		frappe.log_error(title="sales_rep_ssa", message=frappe.get_traceback())

	emp_meta = frappe.get_meta("Employee")
	updates = {}
	if emp_meta.has_field("employee_name"):
		updates["employee_name"] = SALES_REP_DEMO["full_name"]
	if emp_meta.has_field("designation"):
		updates["designation"] = SALES_REP_DEMO["designation"]
	if emp_meta.has_field("date_of_joining"):
		updates["date_of_joining"] = today()
	if emp_meta.has_field("status"):
		updates["status"] = "Active"
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=True)
	frappe.db.commit()
	return {
		"user": email,
		"created": created,
		"employee": employee,
		"band": band,
		"designation": SALES_REP_DEMO["designation"],
		"grade": "FF-G1",
		"fixed_gross": SALES_REP_DEMO["fixed_gross"],
	}


def build_employment_letter_pack_html(employee):
	"""Appointment + Salary Annexure + Employment Agreement + dynamic payroll HTML."""
	ensure_print_formats()
	appointment = get_appointment_letter_html(employee, "field")
	annexure = get_appointment_letter_html(employee, "annexure")
	agreement = get_appointment_letter_html(employee, "agreement")
	emp = frappe.get_doc("Employee", employee)
	grade = cstr(getattr(emp, "grade", None) or "FF-G1")
	structure = "HEC Field Force India"
	fixed = flt(SALES_REP_DEMO["fixed_gross"])
	payroll = build_payroll_dynamic_html(grade, structure, fixed, fixed)
	sep = "<div style='page-break-after:always'></div>"
	cover = f"""
<div style="font-family:Georgia,'Times New Roman',serif;padding:24px;">
  <h1 style="color:#0f3d4d;">Employment Letter Pack</h1>
  <p><strong>Employee:</strong> {frappe.utils.escape_html(cstr(emp.employee_name or emp.name))}</p>
  <p><strong>Employee ID:</strong> {frappe.utils.escape_html(emp.name)}</p>
  <p><strong>Designation:</strong> {frappe.utils.escape_html(cstr(emp.designation or 'Sales Representative'))}</p>
  <p><strong>Grade:</strong> {frappe.utils.escape_html(grade)} · <strong>Structure:</strong> {structure}</p>
  <p><strong>Fixed Monthly Base Gross:</strong> ₹{fixed:,.0f}</p>
  <p style="font-size:9pt;color:#5c6b78;">Includes Appointment Letter, Salary Annexure with payroll breakup,
  and Employment Agreement (Smilecure Lifestyle Pvt. Ltd.).</p>
</div>
"""
	html = (
		cover
		+ sep
		+ (appointment.get("html") or "")
		+ sep
		+ (annexure.get("html") or "")
		+ payroll
		+ sep
		+ (agreement.get("html") or "")
	)
	return {
		"html": html,
		"parts": {
			"appointment": appointment.get("print_format"),
			"annexure": annexure.get("print_format"),
			"agreement": agreement.get("print_format"),
		},
	}


def render_employment_letter_pdf(html, output_path="/tmp/sales-rep-employment-letter.pdf"):
	"""Render portrait A4 PDF via pdfkit/wkhtmltopdf (same stack as HEC bills)."""
	import pdfkit

	options = {
		"encoding": "UTF-8",
		"page-size": "A4",
		"orientation": "Portrait",
		"margin-top": "12mm",
		"margin-bottom": "12mm",
		"margin-left": "12mm",
		"margin-right": "12mm",
		"disable-javascript": None,
		"enable-local-file-access": None,
		"quiet": None,
		"load-error-handling": "ignore",
		"load-media-error-handling": "ignore",
		"print-media-type": None,
	}
	# Strip remote assets that break wkhtmltopdf in containers
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill import (
			prepare_html_for_pdf,
		)

		html = prepare_html_for_pdf(html)
	except Exception:
		pass
	pdf_bytes = pdfkit.from_string(html, False, options=options)
	path = Path(output_path)
	path.write_bytes(pdf_bytes)
	return {"path": str(path), "bytes": len(pdf_bytes)}


def smoke_onboard_sales_rep_letter():
	"""Smoke: onboard Sales Representative + write full employment letter PDF pack."""
	if frappe.session.user == "Guest":
		frappe.set_user("Administrator")

	result = {"ok": True, "checks": [], "smoke_phase92": None, "hire": None, "pdf": None}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:200]})
		if not cond:
			result["ok"] = False

	result["smoke_phase92"] = smoke_phase92()
	check("phase92_ok", bool(result["smoke_phase92"].get("ok")))

	hire = _ensure_sales_rep_user_employee()
	result["hire"] = hire
	check("employee", bool(hire.get("employee")), hire.get("employee"))
	check("grade_ff_g1", cstr(hire.get("grade")) == "FF-G1", hire.get("grade"))

	pack = build_employment_letter_pack_html(hire["employee"])
	check("pack_html", bool(pack.get("html")) and len(pack["html"]) > 500, len(pack.get("html") or ""))

	pdf_path = "/tmp/sales-rep-employment-letter.pdf"
	try:
		pdf_info = render_employment_letter_pdf(pack["html"], pdf_path)
		result["pdf"] = pdf_info
		check("pdf_written", Path(pdf_path).is_file() and pdf_info.get("bytes", 0) > 1000, pdf_info)
	except Exception as exc:
		frappe.log_error(title="sales_rep_letter_pdf", message=frappe.get_traceback())
		# Fallback: write HTML beside expected PDF path
		html_path = "/tmp/sales-rep-employment-letter.html"
		Path(html_path).write_text(pack["html"], encoding="utf-8")
		result["pdf"] = {"error": cstr(exc)[:240], "html_fallback": html_path}
		check("pdf_written", False, cstr(exc)[:160])

	result["urls"] = {
		"people": "https://www.e-remedium.in/people",
		"login_email": hire.get("user"),
	}
	frappe.db.commit()
	return result
