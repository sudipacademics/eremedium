"""My team: weekly Saturday feedback from reporting managers, monthly roll-up, HR development reports.

Weekly rows live in `People Weekly Feedback`. Saving a week recalculates that month's
`People Performance Review` (average stars, combined notes, latest recommendation) so
People → Performance stays in step. HR can open a Feedback & Development report per employee.
"""

from __future__ import annotations

import base64
import re
from calendar import monthrange
from collections import Counter
from pathlib import Path

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cstr, escape_html, flt, format_date, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core import clinical_phase90_people_hrms as hrms

PERFORMANCE_REVIEW_DOCTYPE = hrms.PERFORMANCE_REVIEW_DOCTYPE
WEEKLY_DOCTYPE = "People Weekly Feedback"
RECOMMENDATIONS = (
	"Promote",
	"Retain",
	"Develop further",
	"Needs improvement",
	"Transfer",
	"Not recommended",
)
COMPANY = "Smilecure Lifestyle Private Limited"
COMPANY_SHORT = "SMILECURE LIFESTYLE PVT. LTD"
COMPANY_WEB = "www.smilecurelifestyle.in"
COMPANY_CIN = "U85190WB2019PTC231615"
REGISTERED_ADDRESS = "Q60, Fortune Township, Kazipara, Barasat, Kol- 125"
CORPORATE_ADDRESS = "QUBE - 319, Ps Qube Building, Biswa Bangla Sarani, Action Area IID, Rajarhat, West Bengal 700161"
HR_PHONE = "8100149228"
HR_EMAIL = "smilecure.hr@gmail.com"
# Letterhead accent from company stationery
LETTERHEAD_GREEN = "#9ccc65"
HR_SIGNATURE_DEFAULT = "people_hr_signature_file"
HR_SIGNATURE_MAX_BYTES = 2 * 1024 * 1024
HR_SIGNATURE_EXT = ("png", "jpg", "jpeg", "webp")
LOGO_CANDIDATES = (
	# Inside docker-backend (host people-addons is not mounted)
	"public/files/smilecure-lifestyle.png",
	"/home/frappe/frappe-bench/sites/health.localhost/public/files/smilecure-lifestyle.png",
	"/opt/health-ecosystem/people-addons/smilecure-lifestyle.png",
	"/opt/health-ecosystem/health_web_app/dist/smilecure-lifestyle.png",
	"/opt/health-ecosystem/people-addons/smilecure-icon.png",
)


def ensure_recommendation_field():
	"""Add recommendation on People Performance Review when the DocType already exists."""
	if not hrms.ensure_performance_review_doctype():
		return False
	meta = frappe.get_meta(PERFORMANCE_REVIEW_DOCTYPE)
	if meta.has_field("recommendation"):
		return True
	doc = frappe.get_doc("DocType", PERFORMANCE_REVIEW_DOCTYPE)
	doc.append(
		"fields",
		{
			"fieldname": "recommendation",
			"label": "Recommendation",
			"fieldtype": "Select",
			"options": "\n".join([""] + list(RECOMMENDATIONS)),
			"in_list_view": 1,
		},
	)
	doc.save(ignore_permissions=True)
	frappe.clear_cache(doctype=PERFORMANCE_REVIEW_DOCTYPE)
	frappe.db.commit()
	return True


def ensure_weekly_doctype():
	"""One row per employee per Saturday (week ending)."""
	fields = [
		{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
		{
			"fieldname": "employee_name",
			"label": "Employee Name",
			"fieldtype": "Data",
			"fetch_from": "employee.employee_name",
			"read_only": 1,
			"in_list_view": 1,
		},
		{"fieldname": "week_ending", "label": "Week Ending (Saturday)", "fieldtype": "Date", "reqd": 1, "in_list_view": 1},
		{"fieldname": "rating", "label": "Rating (1-5)", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
		{"fieldname": "remarks", "label": "Feedback", "fieldtype": "Small Text"},
		{
			"fieldname": "recommendation",
			"label": "Recommendation",
			"fieldtype": "Select",
			"options": "\n".join([""] + list(RECOMMENDATIONS)),
			"in_list_view": 1,
		},
		{"fieldname": "reviewer", "label": "Reviewer", "fieldtype": "Link", "options": "User"},
	]
	if frappe.db.exists("DocType", WEEKLY_DOCTYPE):
		meta = frappe.get_meta(WEEKLY_DOCTYPE)
		have = {f.fieldname for f in meta.fields}
		missing = [f for f in fields if f["fieldname"] not in have]
		if missing:
			doc = frappe.get_doc("DocType", WEEKLY_DOCTYPE)
			for field in missing:
				doc.append("fields", field)
			doc.save(ignore_permissions=True)
			frappe.clear_cache(doctype=WEEKLY_DOCTYPE)
			frappe.db.commit()
		return True
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": WEEKLY_DOCTYPE,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"autoname": "hash",
			"track_changes": 1,
			"fields": fields,
			"permissions": [
				{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
				for role in ("System Manager", "HR Manager", "HR User")
			],
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return True


def _me():
	employee = hrms._employee_for_user(frappe.session.user, create=False)
	if not employee:
		frappe.throw(_("Your login is not linked to an employee record"), frappe.PermissionError)
	return employee


def _is_hr(roles):
	return bool(set(roles or []) & hrms.PEOPLE_MANAGER_ROLES)


def _team_ids(manager):
	return frappe.get_all(
		"Employee",
		filters={"status": "Active", "reports_to": manager},
		pluck="name",
		order_by="employee_name asc",
		limit_page_length=500,
	)


def _month(period=None):
	month = getdate(period or today()).replace(day=1)
	if month > getdate(today()).replace(day=1):
		frappe.throw(_("You cannot rate a future month"))
	return month


def _saturday_on_or_before(day):
	"""Latest Saturday on or before the given day (Mon=0 … Sat=5)."""
	day = getdate(day)
	return getdate(add_days(day, -((day.weekday() - 5) % 7)))


def _current_saturday():
	return _saturday_on_or_before(today())


def _week_ending(value=None):
	"""Normalize to a Saturday; refuse future weeks."""
	raw = getdate(value) if value else _current_saturday()
	week = _saturday_on_or_before(raw)
	if week.weekday() != 5:
		week = _saturday_on_or_before(week)
	if getdate(value or week) != week and value:
		# Caller passed a non-Saturday; snap back.
		pass
	if week > _current_saturday():
		frappe.throw(_("Weekly feedback is only for Saturdays that have already arrived"))
	return week


def _saturdays_in_month(month_start, up_to=None):
	month_start = getdate(month_start).replace(day=1)
	last = getdate(f"{month_start.year}-{month_start.month}-{monthrange(month_start.year, month_start.month)[1]}")
	limit = min(last, getdate(up_to or _current_saturday()))
	# First Saturday on or after month start.
	first = month_start
	while first.weekday() != 5:
		first = getdate(add_days(first, 1))
	out = []
	day = first
	while day <= limit:
		out.append(day)
		day = getdate(add_days(day, 7))
	return out


def _weeks_for_picker(month_start):
	weeks = _saturdays_in_month(month_start)
	# Also include recent Saturdays from prior month if this month has none yet.
	if not weeks:
		prev = getdate(add_months(month_start, -1))
		weeks = _saturdays_in_month(prev)[-2:]
	return [
		{
			"value": cstr(w),
			"label": f"Week ending {format_date(w, 'dd MMM yyyy')} (Saturday)",
			"month": w.strftime("%Y-%m"),
		}
		for w in weeks
	]


def _weekly_map(employee_ids, week_ending):
	if not employee_ids:
		return {}
	ensure_weekly_doctype()
	out = {}
	for r in frappe.get_all(
		WEEKLY_DOCTYPE,
		filters={"employee": ("in", employee_ids), "week_ending": cstr(week_ending)},
		fields=["name", "employee", "week_ending", "rating", "remarks", "recommendation", "reviewer", "modified"],
		limit_page_length=1000,
	):
		out[r.employee] = {
			"name": r.name,
			"week_ending": cstr(r.week_ending),
			"rating": flt(r.rating),
			"remarks": r.remarks,
			"recommendation": r.recommendation or "",
			"reviewer": r.reviewer,
			"modified": cstr(r.modified),
		}
	return out


def _month_weeklies(employee, month_start):
	ensure_weekly_doctype()
	month_start = getdate(month_start).replace(day=1)
	last = getdate(f"{month_start.year}-{month_start.month}-{monthrange(month_start.year, month_start.month)[1]}")
	return frappe.get_all(
		WEEKLY_DOCTYPE,
		filters={"employee": employee, "week_ending": ("between", [cstr(month_start), cstr(last)])},
		fields=["name", "week_ending", "rating", "remarks", "recommendation", "reviewer", "modified"],
		order_by="week_ending asc",
		limit_page_length=20,
	)


def _rollup_monthly(employee, month_start, reviewer=None):
	"""Average weekly stars into the monthly People Performance Review for that calendar month."""
	ensure_recommendation_field()
	ensure_weekly_doctype()
	month_start = getdate(month_start).replace(day=1)
	weeks = _month_weeklies(employee, month_start)
	if not weeks:
		return None
	avg = round(sum(flt(w.rating) for w in weeks) / len(weeks), 1)
	notes = []
	for w in weeks:
		bit = cstr(w.remarks).strip()
		if bit:
			notes.append(f"Week ending {format_date(w.week_ending, 'dd MMM')}: {bit}")
	recs = [cstr(w.recommendation).strip() for w in weeks if cstr(w.recommendation).strip()]
	recommendation = recs[-1] if recs else None
	# Prefer the most common recommendation when several weeks differ.
	if len(recs) >= 2:
		recommendation = Counter(recs).most_common(1)[0][0]
	header = f"Auto from {len(weeks)} weekly review{'s' if len(weeks) != 1 else ''}."
	remarks = header + (("\n" + "\n".join(notes)) if notes else "")

	existing = frappe.db.get_value(PERFORMANCE_REVIEW_DOCTYPE, {"employee": employee, "period": cstr(month_start)}, "name")
	doc = frappe.get_doc(PERFORMANCE_REVIEW_DOCTYPE, existing) if existing else frappe.new_doc(PERFORMANCE_REVIEW_DOCTYPE)
	doc.employee = employee
	doc.period = month_start
	doc.rating = avg
	doc.remarks = remarks
	doc.reviewer = reviewer or frappe.session.user
	if frappe.get_meta(PERFORMANCE_REVIEW_DOCTYPE).has_field("recommendation"):
		doc.recommendation = recommendation
	doc.flags.ignore_permissions = True
	if existing:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)
	return {
		"name": doc.name,
		"period": cstr(month_start),
		"rating": doc.rating,
		"remarks": doc.remarks,
		"recommendation": getattr(doc, "recommendation", None) or "",
		"weeks": len(weeks),
		"updated": bool(existing),
	}


def _review_map(employee_ids, month):
	if not employee_ids:
		return {}
	ensure_recommendation_field()
	fields = ["name", "employee", "period", "rating", "remarks", "reviewer", "modified"]
	if frappe.get_meta(PERFORMANCE_REVIEW_DOCTYPE).has_field("recommendation"):
		fields.append("recommendation")
	out = {}
	for r in frappe.get_all(
		PERFORMANCE_REVIEW_DOCTYPE,
		filters={"employee": ("in", employee_ids), "period": cstr(month)},
		fields=fields,
		limit_page_length=1000,
	):
		out[r.employee] = {
			"name": r.name,
			"period": cstr(r.period),
			"rating": flt(r.rating),
			"remarks": r.remarks,
			"recommendation": getattr(r, "recommendation", None) or "",
			"reviewer": r.reviewer,
			"modified": cstr(r.modified),
		}
	return out


def get_my_team(roles, period=None, week_ending=None):
	"""Direct reports with this Saturday's weekly feedback and the month's auto roll-up."""
	me = _me()
	ensure_weekly_doctype()
	ensure_recommendation_field()
	if week_ending:
		week = _week_ending(week_ending)
		month = week.replace(day=1)
	elif period:
		month = _month(period)
		cands = _saturdays_in_month(month)
		week = cands[-1] if cands else _week_ending(None)
		if week.month != month.month or week.year != month.year:
			month = week.replace(day=1)
	else:
		week = _week_ending(None)
		month = week.replace(day=1)
	ids = _team_ids(me)
	weekly = _weekly_map(ids, week)
	monthly = _review_map(ids, month)
	crm_targets = {}
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
			achievement_from_closes,
			map_crm_targets_for_employees,
		)

		crm_targets = map_crm_targets_for_employees(ids, month)
	except Exception:
		frappe.log_error(title="my_team_crm_targets", message=frappe.get_traceback())
		crm_targets = {}
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "image", "date_of_joining", "user_id"]
	if meta.has_field("people_wing"):
		fields.append("people_wing")
	rows = []
	if ids:
		for e in frappe.get_all(
			"Employee",
			filters={"name": ("in", ids)},
			fields=fields,
			order_by="employee_name asc",
			limit_page_length=500,
		):
			weeks = _month_weeklies(e.name, month)
			tgt = crm_targets.get(e.name) or {}
			ach_amt = 0.0
			try:
				ach_amt = flt(achievement_from_closes(e.name, month, e.user_id).get("amount"))
			except Exception:
				ach_amt = 0.0
			rows.append(
				{
					"id": e.name,
					"name": e.employee_name or e.name,
					"department": e.department or "",
					"designation": e.designation or "",
					"photo": e.image or "",
					"date_of_joining": cstr(e.date_of_joining) if e.date_of_joining else None,
					"wing": e.get("people_wing") or "",
					"week": weekly.get(e.name),
					"review": monthly.get(e.name),
					"weeks_rated": len(weeks),
					"weeks_in_month": len(_saturdays_in_month(month)),
					"crm_target_amount": flt(tgt.get("target_amount")),
					"crm_achievement_amount": ach_amt,
				}
			)
	me_row = hrms._employee_row(me) or {}
	rated = sum(1 for r in rows if r.get("week"))
	return {
		"available": True,
		"is_manager": bool(rows),
		"is_hr": _is_hr(roles),
		"manager": {"id": me, "name": me_row.get("employee_name") or me},
		"week_ending": cstr(week),
		"week_label": f"Week ending {format_date(week, 'dd MMM yyyy')} (Saturday)",
		"period": cstr(month),
		"period_label": month.strftime("%B %Y"),
		"recommendations": list(RECOMMENDATIONS),
		"weights": hrms.PERFORMANCE_WEIGHTS,
		"team": rows,
		"rated": rated,
		"weeks": _weeks_for_picker(month),
		"months": [
			{
				"value": getdate(add_months(getdate(today()).replace(day=1), -i)).strftime("%Y-%m"),
				"label": getdate(add_months(getdate(today()).replace(day=1), -i)).strftime("%B %Y"),
			}
			for i in range(12)
		],
	}


def save_my_team_review(roles, employee=None, period=None, rating=None, remarks=None, recommendation=None, week_ending=None):
	"""Save Saturday weekly feedback and refresh the monthly performance review."""
	me = _me()
	employee = cstr(employee).strip()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Select a team member"))
	if employee == me:
		frappe.throw(_("You cannot rate yourself"))
	reports_to = frappe.db.get_value("Employee", employee, "reports_to")
	if reports_to != me and not _is_hr(roles):
		frappe.throw(_("You can only review employees who report to you"), frappe.PermissionError)
	if frappe.db.get_value("Employee", employee, "status") != "Active":
		frappe.throw(_("That employee is not active"))

	ensure_weekly_doctype()
	ensure_recommendation_field()
	week = _week_ending(week_ending or period)
	month = week.replace(day=1)
	value = flt(rating)
	if not 1 <= value <= 5:
		frappe.throw(_("Rating must be between 1 and 5 stars"))
	rec = cstr(recommendation).strip()
	if rec and rec not in RECOMMENDATIONS:
		frappe.throw(_("Choose a valid recommendation"))

	existing = frappe.db.get_value(WEEKLY_DOCTYPE, {"employee": employee, "week_ending": cstr(week)}, "name")
	doc = frappe.get_doc(WEEKLY_DOCTYPE, existing) if existing else frappe.new_doc(WEEKLY_DOCTYPE)
	doc.employee = employee
	doc.week_ending = week
	doc.rating = round(value, 1)
	doc.remarks = cstr(remarks).strip() or None
	doc.recommendation = rec or None
	doc.reviewer = frappe.session.user
	doc.flags.ignore_permissions = True
	if existing:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)

	monthly = _rollup_monthly(employee, month, reviewer=frappe.session.user)
	frappe.db.commit()
	return {
		"name": doc.name,
		"employee": employee,
		"week_ending": cstr(week),
		"rating": doc.rating,
		"remarks": doc.remarks,
		"recommendation": doc.recommendation or "",
		"updated": bool(existing),
		"monthly": monthly,
	}


def get_feedback_development_report(roles, employee=None, period=None):
	"""HR Feedback & Development report: weekly history + monthly roll-up for one employee (or the whole team scope)."""
	if not _is_hr(roles):
		frappe.throw(_("Only HR can open Feedback & Development reports"), frappe.PermissionError)
	ensure_weekly_doctype()
	ensure_recommendation_field()
	month = _month(period)
	last = getdate(f"{month.year}-{month.month}-{monthrange(month.year, month.month)[1]}")

	def pack(emp_id):
		row = hrms._employee_row(emp_id) or {}
		weeks = _month_weeklies(emp_id, month)
		monthly = _review_map([emp_id], month).get(emp_id)
		if weeks and not monthly:
			monthly = _rollup_monthly(emp_id, month)
			monthly = _review_map([emp_id], month).get(emp_id)
		return {
			"id": emp_id,
			"name": row.get("employee_name") or emp_id,
			"department": row.get("department") or "",
			"designation": row.get("designation") or "",
			"photo": row.get("image") or "",
			"reports_to": row.get("reports_to"),
			"reports_to_name": row.get("reports_to_name") or "",
			"weeks": [
				{
					"week_ending": cstr(w.week_ending),
					"label": f"Week ending {format_date(w.week_ending, 'dd MMM yyyy')}",
					"rating": flt(w.rating),
					"remarks": w.remarks or "",
					"recommendation": w.recommendation or "",
					"reviewer": w.reviewer,
					"modified": cstr(w.modified),
				}
				for w in weeks
			],
			"monthly": monthly,
			"weeks_expected": len(_saturdays_in_month(month, up_to=min(last, _current_saturday()))),
		}

	if employee:
		if not frappe.db.exists("Employee", employee):
			frappe.throw(_("Select a valid employee"))
		return {
			"period": cstr(month),
			"period_label": month.strftime("%B %Y"),
			"employee": pack(employee),
			"employees": [pack(employee)],
		}

	ids = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name", order_by="employee_name asc", limit_page_length=5000)
	employees = [pack(i) for i in ids]
	employees = [e for e in employees if e["weeks"] or e["monthly"]]
	return {
		"period": cstr(month),
		"period_label": month.strftime("%B %Y"),
		"employee": None,
		"employees": employees,
		"count": len(employees),
	}


def _logo_data_uri():
	"""Embed company logo for wkhtmltopdf (must be readable inside docker-backend)."""
	candidates = list(LOGO_CANDIDATES)
	try:
		candidates.insert(0, frappe.get_site_path("public", "files", "smilecure-lifestyle.png"))
	except Exception:
		pass
	for path in candidates:
		p = Path(path)
		if not p.is_absolute():
			try:
				p = Path(frappe.get_site_path(*Path(path).parts))
			except Exception:
				continue
		if p.is_file():
			return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
	return ""


def _hr_signature_file_name():
	return cstr(frappe.db.get_default(HR_SIGNATURE_DEFAULT) or "").strip()


def _hr_signature_payload():
	"""Return preview metadata for Company Settings (and whether a file is set)."""
	name = _hr_signature_file_name()
	if not name or not frappe.db.exists("File", name):
		return {"has_signature": False, "file_name": "", "preview": "", "updated_on": None}
	row = frappe.db.get_value("File", name, ["file_name", "modified"], as_dict=True) or {}
	preview = ""
	try:
		content = frappe.get_doc("File", name).get_content()
		if isinstance(content, str):
			content = content.encode()
		ext = (cstr(row.get("file_name")).rsplit(".", 1)[-1] or "png").lower()
		mime = "image/jpeg" if ext in ("jpg", "jpeg") else ("image/webp" if ext == "webp" else "image/png")
		preview = f"data:{mime};base64," + base64.b64encode(content).decode()
	except Exception:
		preview = ""
	return {
		"has_signature": bool(preview),
		"file_name": cstr(row.get("file_name") or name),
		"preview": preview,
		"updated_on": cstr(row.get("modified") or "")[:16] or None,
	}


def _hr_signature_data_uri():
	pack = _hr_signature_payload()
	return pack.get("preview") or ""


def get_hr_signature_settings(roles):
	hrms._require_manager(roles)
	return _hr_signature_payload()


def save_hr_signature(roles, file_name=None, file_data=None):
	"""Store HR authorised signature used on Performance Report PDFs."""
	hrms._require_manager(roles)
	file_name = cstr(file_name).strip()
	file_data = file_data
	if not file_name or file_data in (None, ""):
		frappe.throw(_("Choose a signature image (PNG or JPG)"))
	ext = (file_name.rsplit(".", 1)[-1] if "." in file_name else "").lower()
	if ext not in HR_SIGNATURE_EXT:
		frappe.throw(_("Use a PNG, JPG or WEBP image"))
	raw = cstr(file_data)
	if raw.startswith("data:") and "," in raw:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw)
	except Exception:
		frappe.throw(_("Invalid signature file"))
	if not content:
		frappe.throw(_("Signature file is empty"))
	if len(content) > HR_SIGNATURE_MAX_BYTES:
		frappe.throw(_("Signature must be 2 MB or less"))
	old = _hr_signature_file_name()
	safe = "".join(ch for ch in file_name if ch.isalnum() or ch in "._- ")[:80] or f"hr-signature.{ext}"
	doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"hr-performance-signature-{safe}",
			"content": content,
			"is_private": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.set_default(HR_SIGNATURE_DEFAULT, doc.name)
	if old and old != doc.name and frappe.db.exists("File", old):
		try:
			frappe.delete_doc("File", old, ignore_permissions=True, force=True)
		except Exception:
			pass
	frappe.db.commit()
	return _hr_signature_payload()


def clear_hr_signature(roles):
	hrms._require_manager(roles)
	old = _hr_signature_file_name()
	frappe.db.set_default(HR_SIGNATURE_DEFAULT, "")
	if old and frappe.db.exists("File", old):
		try:
			frappe.delete_doc("File", old, ignore_permissions=True, force=True)
		except Exception:
			pass
	frappe.db.commit()
	return _hr_signature_payload()


def _performance_row(roles, employee, month):
	"""Score row for one employee in the calendar month (same engine as the Performance board)."""
	month = getdate(month).replace(day=1)
	last = getdate(f"{month.year}-{month.month}-{monthrange(month.year, month.month)[1]}")
	board = hrms.get_people_performance(roles, cstr(month), cstr(last))
	for row in board.get("rows") or []:
		if row.get("id") == employee:
			return row, board
	return None, board


def download_performance_report(roles, employee=None, period=None):
	"""HR PDF: performance score, weekly feedback history, company letterhead for mailing to the employee."""
	hrms._require_manager(roles)
	employee = cstr(employee).strip()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Select a valid employee"))
	ensure_weekly_doctype()
	ensure_recommendation_field()
	month = _month(period)
	last = getdate(f"{month.year}-{month.month}-{monthrange(month.year, month.month)[1]}")
	row = hrms._employee_row(employee) or {}
	weeks = _month_weeklies(employee, month)
	monthly = _review_map([employee], month).get(employee)
	if weeks and not monthly:
		_rollup_monthly(employee, month)
		monthly = _review_map([employee], month).get(employee)
	# _employee_row maps display name to "name" and the Employee id to "id"
	emp_name = cstr(row.get("name") or row.get("employee_name") or "").strip()
	if not emp_name or emp_name == employee:
		emp_name = cstr(frappe.db.get_value("Employee", employee, "employee_name") or "").strip() or employee
	pack = {
		"id": cstr(row.get("id") or employee),
		"name": emp_name,
		"department": row.get("department") or "",
		"designation": row.get("designation") or "",
		"reports_to_name": row.get("reports_to_name") or "",
		"weeks": [
			{
				"week_ending": cstr(w.week_ending),
				"label": f"Week ending {format_date(w.week_ending, 'dd MMM yyyy')}",
				"rating": flt(w.rating),
				"remarks": w.remarks or "",
				"recommendation": w.recommendation or "",
			}
			for w in weeks
		],
		"monthly": monthly or {},
		"weeks_expected": len(_saturdays_in_month(month, up_to=min(last, _current_saturday()))),
	}
	perf, board = _performance_row(roles, employee, month)
	from frappe.utils.pdf import get_pdf

	e = escape_html
	logo = _logo_data_uri()
	issued = cstr(now_datetime())[:16]
	period_label = month.strftime("%B %Y")
	score = perf.get("score") if perf else None
	band = perf.get("band") if perf else "No Data"
	weights = (board or {}).get("weights") or hrms.PERFORMANCE_WEIGHTS

	def metric(label, weight, detail, value):
		shown = "—" if value is None else f"{flt(value):.1f}%"
		return f"<tr><th>{e(label)} ({weight}%)</th><td>{e(detail)}</td><td class='num'>{e(shown)}</td></tr>"

	hours_detail = (
		f"{int(round(perf.get('hours') or 0))}h of {int(perf.get('expected_hours') or 0)}h expected"
		if perf
		else "—"
	)
	att_detail = (
		f"{perf.get('present_days') or 0} of {perf.get('working_days') or 0} working days"
		if perf
		else "—"
	)
	fb_detail = f"{perf.get('rating'):.1f} / 5 average rating" if perf and perf.get("rating") is not None else "Not rated"
	metrics = "".join(
		[
			metric("Working hours", weights.get("hours", 30), hours_detail, perf.get("hours_score") if perf else None),
			metric("Attendance", weights.get("attendance", 30), att_detail, perf.get("attendance_score") if perf else None),
			metric("Manager feedback", weights.get("feedback", 40), fb_detail, perf.get("feedback_score") if perf else None),
		]
	)
	weeks = pack.get("weeks") or []
	week_bits = []
	for w in weeks:
		week_bits.append(
			"<tr><td>{}</td><td class='num'>{}</td><td>{}</td><td>{}</td></tr>".format(
				e(w["label"]),
				e(f"{flt(w['rating']):.1f}"),
				e(w.get("recommendation") or "—"),
				e(w.get("remarks") or "—"),
			)
		)
	week_rows = "".join(week_bits) or "<tr><td colspan='4'>No weekly reviews recorded for this month.</td></tr>"
	monthly = pack.get("monthly") or {}
	logo_html = (
		f'<img src="{logo}" alt="Smilecure" width="150" height="48" style="width:150px;height:48px;display:block;" />'
		if logo
		else ""
	)
	sig = _hr_signature_data_uri()
	sig_html = f'<img src="{sig}" alt="HR signature" />' if sig else "&nbsp;"
	html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body {{ font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10pt; line-height: 1.45; }}
.letter {{ width: 100%; border-collapse: collapse; border-bottom: 6px solid {LETTERHEAD_GREEN}; margin: 0 0 10px; }}
.letter td {{ border: none; padding: 0; vertical-align: top; }}
.letter .logo-cell {{ width: 162px; padding-right: 14px; }}
.letter .co {{ font-size: 11pt; font-weight: 700; letter-spacing: .02em; color: #111; margin: 0 0 5px; text-transform: uppercase; }}
.company-inner {{ width: 100%; border-collapse: collapse; }}
.company-inner td {{ border: none; padding: 0; vertical-align: top; font-size: 7.5pt; color: #222; line-height: 1.4; }}
.company-inner .left {{ width: 56%; padding-right: 10px; }}
.company-inner .right {{ width: 44%; padding-left: 10px; border-left: 2px solid {LETTERHEAD_GREEN}; }}
.company-inner .row {{ margin: 0 0 3px; }}
.title-row {{ width: 100%; border-collapse: collapse; margin: 0 0 10px; }}
.title-row td {{ border: none; padding: 0; vertical-align: top; }}
.title-row h1 {{ font-size: 14pt; margin: 0 0 2px; color: #0f766e; }}
.title-row .sub {{ margin: 0; color: #64748b; font-size: 9pt; }}
.title-row .meta {{ text-align: right; font-size: 8.5pt; color: #475569; width: 160px; white-space: nowrap; padding-left: 12px; }}
.score {{ background: #f0f7f7; border: 1px solid #cfe4e4; border-radius: 8px; padding: 12px 14px; margin: 0 0 14px; }}
.score b {{ font-size: 22pt; color: #0f766e; }}
.score span {{ display: inline-block; margin-left: 10px; background: #fde6ea; color: #b4233f; border-radius: 999px; padding: 2px 10px; font-size: 8.5pt; font-weight: bold; }}
table.data {{ width: 100%; border-collapse: collapse; margin: 6px 0 12px; }}
table.data th, table.data td {{ border: 1px solid #dbe5ea; padding: 6px 8px; font-size: 9pt; vertical-align: top; }}
table.data th {{ text-align: left; background: #f1f7f7; color: #475569; width: 28%; }}
td.num {{ text-align: right; white-space: nowrap; font-weight: 600; }}
h2 {{ font-size: 10pt; text-transform: uppercase; letter-spacing: .05em; color: #0f766e; margin: 14px 0 6px; }}
.sign {{ margin-top: 36px; width: 46%; }}
.sign .pad {{ min-height: 72px; margin-bottom: 8px; }}
.sign .pad img {{ max-height: 64px; max-width: 220px; display: block; }}
.sign .line {{ border-top: 1px solid #94a3b8; padding-top: 8px; margin-top: 4px; font-size: 8.5pt; color: #475569; line-height: 1.45; }}
</style></head><body>
<table class="letter" width="100%">
  <tr>
    <td class="logo-cell">{logo_html}</td>
    <td>
      <div class="co">{e(COMPANY_SHORT)}</div>
      <table class="company-inner" width="100%">
        <tr>
          <td class="left">
            <div class="row">Registered Address : {e(REGISTERED_ADDRESS)}</div>
            <div class="row">Corporate Address : {e(CORPORATE_ADDRESS)}</div>
          </td>
          <td class="right">
            <div class="row">CIN: {e(COMPANY_CIN)}</div>
            <div class="row">{e(COMPANY_WEB)}</div>
            <div class="row">HR Contact :</div>
            <div class="row">Phone - {e(HR_PHONE)} | Email - {e(HR_EMAIL)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<table class="title-row" width="100%">
  <tr>
    <td>
      <h1>Performance report for the month of {e(period_label)}</h1>
      <p class="sub">Issued by Human Resources for internal review and employee communication.</p>
    </td>
    <td class="meta">Issued: <b>{e(issued)}</b><br>Period: <b>{e(period_label)}</b></td>
  </tr>
</table>
<table class="data">
  <tr><th>Employee</th><td>{e(pack.get('name'))}</td><th>Employee ID</th><td>{e(pack.get('id'))}</td></tr>
  <tr><th>Designation</th><td>{e(pack.get('designation') or '—')}</td><th>Department</th><td>{e(pack.get('department') or '—')}</td></tr>
  <tr><th>Reporting manager</th><td colspan="3">{e(pack.get('reports_to_name') or '—')}</td></tr>
</table>
<div class="score">
  <b>{e('—' if score is None else f'{flt(score):.1f}')}</b> / 100
  <span>{e(band)}</span>
  {("<small style='display:block;margin-top:6px;color:#475569'>Rank " + e(str(perf.get("rank"))) + " of scored employees in this period</small>") if perf and perf.get("rank") else ""}
</div>
<h2>Score breakdown</h2>
<table class="data">
  <tr><th>Component</th><th>Detail</th><th>Score</th></tr>
  {metrics}
</table>
<h2>Manager feedback (monthly)</h2>
<table class="data">
  <tr><th>Average rating</th><td>{e('—' if monthly.get('rating') is None else f"{flt(monthly.get('rating')):.1f} / 5")}</td></tr>
  <tr><th>Recommendation</th><td>{e(monthly.get('recommendation') or '—')}</td></tr>
  <tr><th>Notes</th><td>{e(monthly.get('remarks') or '—')}</td></tr>
</table>
<h2>Weekly Saturday feedback</h2>
<table class="data">
  <tr><th>Week</th><th>Stars</th><th>Recommendation</th><th>Feedback</th></tr>
  {week_rows}
</table>
<div class="sign">
  <div class="pad">{sig_html}</div>
  <div class="line">Authorised Signatory · Human Resources<br>{e(COMPANY)}</div>
</div>
</body></html>"""
	content = get_pdf(
		html,
		{
			"page-size": "A4",
			"encoding": "UTF-8",
			"margin-top": "12mm",
			"margin-bottom": "14mm",
			"margin-left": "11mm",
			"margin-right": "11mm",
			"footer-right": "[page]/[topage]",
			"footer-font-size": "9",
			"footer-font-name": "Arial",
			"footer-spacing": "4",
		},
	)
	slug = re.sub(r"[^a-z0-9]+", "-", cstr(pack.get("name")).lower()).strip("-")[:40] or employee
	return {
		"file_name": f"performance-report-{slug}-{month.strftime('%Y-%m')}.pdf",
		"data": base64.b64encode(content).decode(),
		"employee": employee,
		"period": cstr(month),
	}


# ---------------------------------------------------------------- whitelisted API


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles


def _run(sid, fn):
	_error, _parse, _require, _success, _roles = _api()
	denied = _require(sid)
	if denied:
		return denied
	try:
		return _success(fn(_roles()))
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="people_my_team", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _arg(name, value):
	return _api()[1](name, value)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_team_board(period=None, week_ending=None, sid=None):
	return _run(sid, lambda roles: get_my_team(roles, _arg("period", period), _arg("week_ending", week_ending)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_my_team_review_api(employee=None, period=None, rating=None, remarks=None, recommendation=None, week_ending=None, sid=None):
	return _run(
		sid,
		lambda roles: save_my_team_review(
			roles,
			_arg("employee", employee),
			_arg("period", period),
			_arg("rating", rating),
			_arg("remarks", remarks),
			_arg("recommendation", recommendation),
			_arg("week_ending", week_ending),
		),
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_feedback_development_report_api(employee=None, period=None, sid=None):
	return _run(sid, lambda roles: get_feedback_development_report(roles, _arg("employee", employee), _arg("period", period)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def download_performance_report_api(employee=None, period=None, sid=None):
	return _run(sid, lambda roles: download_performance_report(roles, _arg("employee", employee), _arg("period", period)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_hr_signature_settings_api(sid=None):
	return _run(sid, lambda roles: get_hr_signature_settings(roles))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_hr_signature_api(file_name=None, file_data=None, sid=None):
	return _run(sid, lambda roles: save_hr_signature(roles, _arg("file_name", file_name), _arg("file_data", file_data)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def clear_hr_signature_api(sid=None):
	return _run(sid, lambda roles: clear_hr_signature(roles))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_crm_sales_target_api(employee=None, period=None, target_amount=None, notes=None, sid=None):
	"""My Team — reporting manager sets CRM sales ₹ target for a direct report."""
	from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import set_crm_sales_target

	return _run(
		sid,
		lambda roles: set_crm_sales_target(
			_arg("employee", employee),
			_arg("period", period),
			_arg("target_amount", target_amount),
			_arg("notes", notes),
		),
	)
