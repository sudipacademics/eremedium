"""Phase 90 — People HRMS portal for non–field-sales employees.

Uses ERPNext/HRMS Employee, Leave, Expense, Salary Slip, and Employee Checkin.
"""

from __future__ import annotations

from calendar import monthrange
from collections import Counter

import frappe
from frappe import _
from frappe.utils import add_days, add_months, add_to_date, add_years, cint, cstr, flt, format_date, get_datetime, getdate, now_datetime, today


PEOPLE_MANAGER_ROLES = frozenset(
	{
		"Administrator",
		"Health System Admin",
		"System Manager",
		"HR Manager",
		"HR User",
		"Accounts Manager",
	}
)

PEOPLE_STAFF_ROLES = frozenset(
	{
		"Administrator",
		"Phlebotomist",
		"Franchisee Operator",
		"Lab Technician",
		"Pathologist",
		"Health System Admin",
		"System Manager",
		"HR Manager",
		"HR User",
		"Employee",
		"Accounts User",
		"Accounts Manager",
		"Sales Representative",
		"Sales Manager",
	}
)


def is_people_eligible(roles):
	return bool(set(roles or []) & PEOPLE_STAFF_ROLES)


def is_people_manager(roles):
	return bool(set(roles or []) & PEOPLE_MANAGER_ROLES)


def _month_bounds(as_of=None):
	d = getdate(as_of or today())
	start = d.replace(day=1)
	end = d.replace(day=monthrange(d.year, d.month)[1])
	return start, end, d


def _default_company():
	company = frappe.defaults.get_global_default("company")
	if company:
		return company
	rows = frappe.get_all("Company", limit=1, pluck="name")
	return rows[0] if rows else None


def _division_label(value):
	"""Show a Company Division name when the employee stores the division code."""
	if not value:
		return ""
	if frappe.db.exists("DocType", "Company Division") and frappe.db.exists("Company Division", value):
		return frappe.db.get_value("Company Division", value, "division_name") or value
	return value


def _employee_for_user(user, create=True):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
		ensure_employee_for_user,
		hr_module_ready,
	)

	if not hr_module_ready():
		return None
	if create:
		return ensure_employee_for_user(user)
	return frappe.db.get_value("Employee", {"user_id": user}, "name")


def _employee_row(employee):
	if not employee or not frappe.db.exists("Employee", employee):
		return None
	fields = [
		"name",
		"employee_name",
		"department",
		"designation",
		"branch",
		"company",
		"status",
		"date_of_joining",
		"cell_number",
		"company_email",
		"personal_email",
		"gender",
		"reports_to",
		"user_id",
	]
	meta = frappe.get_meta("Employee")
	for extra in (
		"wing",
		"custom_wing",
		"division",
		"custom_division",
		"company_division",
		"image",
		"current_address",
		"permanent_address",
		"blood_group",
		"people_wing",
		"people_division",
		"people_unit",
		"date_of_birth",
		"emergency_phone_number",
		"employment_type",
		"grade",
		"holiday_list",
		"date_of_retirement",
		"marital_status",
		"pan_number",
		"passport_number",
	):
		if meta.has_field(extra):
			fields.append(extra)
	fields = [f for f in fields if meta.has_field(f) or f == "name"]
	row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	reports_to_name = None
	if row.get("reports_to") and frappe.db.exists("Employee", row.reports_to):
		reports_to_name = frappe.db.get_value("Employee", row.reports_to, "employee_name")
	# Resolve division safely — never NameError if helper is missing from a stale worker.
	people_div = cstr(row.get("people_division") or "").strip()
	raw_div = people_div or row.get("division") or row.get("custom_division") or row.get("company_division") or ""
	try:
		division_val = people_div or _division_label(raw_div)
	except Exception:
		division_val = cstr(raw_div or "")
	return {
		"id": row.get("name"),
		"name": row.get("employee_name") or row.get("name"),
		"department": row.get("department"),
		"designation": row.get("designation"),
		"branch": row.get("branch"),
		"company": row.get("company"),
		"status": row.get("status") or "Active",
		"date_of_joining": cstr(row.get("date_of_joining") or ""),
		"phone": row.get("cell_number"),
		"email": row.get("company_email") or row.get("personal_email") or row.get("user_id"),
		"company_email": row.get("company_email"),
		"personal_email": row.get("personal_email"),
		"gender": row.get("gender"),
		"wing": row.get("people_wing") or row.get("wing") or row.get("custom_wing") or "",
		"division": division_val,
		"unit": row.get("people_unit") or "",
		"photo": row.get("image"),
		"image": row.get("image"),
		"current_address": row.get("current_address"),
		"permanent_address": row.get("permanent_address"),
		"blood_group": row.get("blood_group") or "",
		"date_of_birth": cstr(row.get("date_of_birth") or ""),
		"emergency_phone": row.get("emergency_phone_number"),
		"employment_type": row.get("employment_type"),
		"grade": row.get("grade"),
		"holiday_list": row.get("holiday_list"),
		"date_of_retirement": cstr(row.get("date_of_retirement") or ""),
		"marital_status": row.get("marital_status"),
		"pan_number": row.get("pan_number"),
		"passport_number": row.get("passport_number"),
	}


def update_my_employee_profile(user, payload=None):
	"""Let a signed-in employee update their own contact fields. Official HR fields stay read-only."""
	employee = _employee_for_user(user, create=True)
	if not employee:
		frappe.throw(_("No employee profile is linked to this login"))
	data = payload if isinstance(payload, dict) else {}
	field_map = {
		"phone": "cell_number",
		"personal_email": "personal_email",
		"current_address": "current_address",
		"permanent_address": "permanent_address",
		"blood_group": "blood_group",
		"emergency_phone": "emergency_phone_number",
	}
	meta = frappe.get_meta("Employee")
	doc = frappe.get_doc("Employee", employee)
	changed = False
	for key, fieldname in field_map.items():
		if key not in data:
			continue
		if not meta.has_field(fieldname):
			continue
		value = cstr(data.get(key) or "").strip()
		doc.set(fieldname, value or None)
		changed = True
	if changed:
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	return _employee_row(employee)


def _monthly_ctc(employee):
	if not employee or not frappe.db.exists("DocType", "Salary Structure Assignment"):
		return 0.0, False
	try:
		rows = frappe.get_all(
			"Salary Structure Assignment",
			filters={"employee": employee, "docstatus": ("<", 2)},
			fields=["name", "base", "from_date"],
			order_by="from_date desc",
			limit=1,
		)
		if not rows:
			return 0.0, False
		return flt(rows[0].get("base")), True
	except Exception:
		return 0.0, False


def _leave_balances(employee):
	balances = []
	if not employee or not frappe.db.exists("DocType", "Leave Allocation"):
		return balances
	start, end, _ = _month_bounds()
	try:
		rows = frappe.get_all(
			"Leave Allocation",
			filters={
				"employee": employee,
				"docstatus": 1,
				"from_date": ("<=", cstr(end)),
				"to_date": (">=", cstr(start)),
			},
			fields=["leave_type", "total_leaves_allocated", "from_date", "to_date"],
			limit=20,
		)
	except Exception:
		rows = []
	for row in rows:
		leave_type = row.leave_type
		allocated = flt(row.total_leaves_allocated)
		taken = 0.0
		if frappe.db.exists("DocType", "Leave Application"):
			apps = frappe.get_all(
				"Leave Application",
				filters={
					"employee": employee,
					"leave_type": leave_type,
					"status": ("in", ["Approved", "Open"]),
					"from_date": ("between", [cstr(row.from_date), cstr(row.to_date)]),
				},
				fields=["total_leave_days"],
			)
			taken = sum(flt(a.total_leave_days) for a in apps)
		balances.append(
			{
				"leave_type": leave_type,
				"allocated": allocated,
				"taken": taken,
				"balance": max(0.0, allocated - taken),
			}
		)
	return balances


def _expenses_mtd(employee):
	start, end, _ = _month_bounds()
	if not employee or not frappe.db.exists("DocType", "Expense Claim"):
		return {"count": 0, "claimed": 0.0, "pending": 0}
	rows = frappe.get_all(
		"Expense Claim",
		filters={"employee": employee, "posting_date": ("between", [cstr(start), cstr(end)])},
		fields=["total_claimed_amount", "approval_status"],
		limit=100,
	)
	claimed = sum(flt(r.total_claimed_amount) for r in rows)
	pending = sum(1 for r in rows if cstr(r.approval_status) in ("", "Draft", "Open", "Pending"))
	return {"count": len(rows), "claimed": claimed, "pending": pending}


def _employee_geofence_flags(employee):
	"""Whether GPS fence is enforced for this employee (override counts as not required)."""
	flags = {"geofence_enabled": 0, "geofence_required": 0, "geofence_label": ""}
	if not employee:
		return flags
	try:
		ensure_people_geofence_fields()
	except Exception:
		return flags
	meta = frappe.get_meta("Employee")
	if not meta.has_field("geofence_enabled"):
		return flags
	fields = ["geofence_enabled", "geofence_label", "work_latitude", "work_longitude"]
	if meta.has_field("geofence_override"):
		fields.append("geofence_override")
	if meta.has_field("geofence_override_until"):
		fields.append("geofence_override_until")
	row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	enabled = cint(row.get("geofence_enabled") or 0)
	flags["geofence_enabled"] = enabled
	flags["geofence_label"] = cstr(row.get("geofence_label") or "")
	if not enabled:
		return flags
	if _override_active(row):
		return flags
	if flt(row.get("work_latitude")) and flt(row.get("work_longitude")):
		flags["geofence_required"] = 1
	return flags


def _sync_attendance_from_punch(employee, log_type, punch_time):
	"""Keep tab Attendance in sync with Employee Checkin punches (draft or submitted)."""
	if not employee or not frappe.db.exists("DocType", "Attendance"):
		return None
	day = getdate(punch_time)
	company = frappe.db.get_value("Employee", employee, "company")
	existing = frappe.db.get_value(
		"Attendance",
		{"employee": employee, "attendance_date": day, "docstatus": ("<", 2)},
		"name",
	)
	meta = frappe.get_meta("Attendance")
	try:
		if existing:
			doc = frappe.get_doc("Attendance", existing)
		else:
			doc = frappe.new_doc("Attendance")
			doc.employee = employee
			doc.attendance_date = day
			if company and meta.has_field("company"):
				doc.company = company

		updates = {"status": "Present"}
		if meta.has_field("in_time") and log_type == "IN":
			if not doc.get("in_time") or get_datetime(doc.in_time) > get_datetime(punch_time):
				updates["in_time"] = punch_time
		if meta.has_field("out_time") and log_type == "OUT":
			updates["out_time"] = punch_time

		# Submitted Attendance cannot use .save(); update fields directly so OUT still sticks.
		if existing and cint(doc.docstatus) == 1:
			for field, value in updates.items():
				frappe.db.set_value("Attendance", doc.name, field, value, update_modified=True)
			return doc.name

		for field, value in updates.items():
			doc.set(field, value)
		doc.flags.ignore_validate = True
		doc.flags.ignore_permissions = True
		if existing:
			doc.save(ignore_permissions=True)
		else:
			doc.insert(ignore_permissions=True)
		# Submit so Workforce / Attendance lists show Present (not only draft).
		try:
			if cint(doc.docstatus) == 0:
				doc.reload()
				doc.flags.ignore_validate = True
				doc.flags.ignore_permissions = True
				doc.submit()
		except Exception:
			frappe.log_error(title="people_hrms_attendance_submit", message=frappe.get_traceback())
		return doc.name
	except Exception:
		frappe.log_error(title="people_hrms_attendance_sync", message=frappe.get_traceback())
		return None


def _attendance_mtd(employee):
	start, end, today_d = _month_bounds()
	geo = _employee_geofence_flags(employee)
	payload = {
		"checkins_mtd": 0,
		"present_days": 0,
		"last_checkin": None,
		"today_status": "Not checked in",
		"checkin_available": bool(frappe.db.exists("DocType", "Employee Checkin")),
		"geofence_enabled": geo.get("geofence_enabled") or 0,
		"geofence_required": geo.get("geofence_required") or 0,
		"geofence_label": geo.get("geofence_label") or "",
		"series": [],
		"records": [],
	}
	if not employee or not payload["checkin_available"]:
		return payload

	rows = frappe.get_all(
		"Employee Checkin",
		filters={"employee": employee, "time": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"])},
		fields=["name", "time", "log_type"],
		order_by="time desc",
		limit=500,
	)
	payload["checkins_mtd"] = len(rows)
	payload["records"] = [
		{
			"name": r.name,
			"time": cstr(r.time),
			"log_type": cstr(r.log_type or "").upper() or "IN",
			"date": cstr(getdate(r.time)),
		}
		for r in rows[:90]
	]
	payload["last_log_type"] = None
	payload["next_log_type"] = "IN"
	if rows:
		latest = rows[0]
		payload["last_checkin"] = {
			"name": latest.name,
			"time": cstr(latest.time),
			"log_type": latest.log_type,
		}
		today_rows = [r for r in rows if getdate(r.time) == today_d]
		if today_rows:
			last_today = cstr(today_rows[0].log_type or "").upper()
			payload["last_log_type"] = last_today
			if last_today == "OUT":
				payload["today_status"] = "Checked out"
				payload["next_log_type"] = "IN"
			else:
				payload["today_status"] = "Checked in"
				payload["next_log_type"] = "OUT"

	by_day = Counter(cstr(getdate(r.time)) for r in rows if cstr(r.log_type or "").upper() in ("", "IN"))
	if not by_day:
		by_day = Counter(cstr(getdate(r.time)) for r in rows)
	payload["present_days"] = len(by_day)

	series = []
	day = start
	while day <= today_d:
		key = cstr(day)
		series.append({"day": day.day, "label": key, "count": by_day.get(key, 0)})
		day = getdate(add_days(day, 1))
	payload["series"] = series[-31:]
	return payload


def _payslips(employee, limit=8):
	if not employee or not frappe.db.exists("DocType", "Salary Slip"):
		return []
	fields = ["name", "posting_date", "start_date", "end_date", "gross_pay", "net_pay", "status", "docstatus"]
	meta = frappe.get_meta("Salary Slip")
	fields = [f for f in fields if meta.has_field(f) or f == "name"]
	rows = frappe.get_all(
		"Salary Slip",
		filters={"employee": employee, "docstatus": ("<", 2)},
		fields=fields,
		order_by="end_date desc",
		limit=limit,
	)
	out = []
	for r in rows:
		out.append(
			{
				"name": r.name,
				"posting_date": cstr(r.get("posting_date") or ""),
				"start_date": cstr(r.get("start_date") or ""),
				"end_date": cstr(r.get("end_date") or ""),
				"gross_pay": flt(r.get("gross_pay")),
				"net_pay": flt(r.get("net_pay")),
				"status": r.get("status") or ("Submitted" if cint(r.get("docstatus")) == 1 else "Draft"),
			}
		)
	return out


def _org_attendance_series(start, today_d, headcount=0):
	"""Daily present / leave / absent counts for the org workforce chart (MTD, min 14 days)."""
	series = []
	has_checkin = frappe.db.exists("DocType", "Employee Checkin")
	has_leave = frappe.db.exists("DocType", "Leave Application")
	day = min(getdate(start), getdate(add_days(today_d, -13)))
	while day <= today_d:
		count = 0
		on_leave = 0
		if has_checkin:
			count = frappe.db.sql(
				"""
				select count(distinct employee)
				from `tabEmployee Checkin`
				where date(time) = %s
				""",
				(cstr(day),),
			)[0][0]
		if has_leave:
			on_leave = frappe.db.count(
				"Leave Application",
				{
					"status": ("in", ["Open", "Approved"]),
					"from_date": ("<=", cstr(day)),
					"to_date": (">=", cstr(day)),
				},
			)
		present = cint(count)
		series.append(
			{
				"day": day.day,
				"label": cstr(day),
				"count": present,
				"present": present,
				"leave": cint(on_leave),
				"absent": max(0, cint(headcount) - present - cint(on_leave)),
			}
		)
		day = add_days(day, 1)
	return series


def _org_job_openings():
	open_positions = 0
	recent = []
	if not frappe.db.exists("DocType", "Job Opening"):
		return open_positions, recent
	meta = frappe.get_meta("Job Opening")
	filters = {}
	if meta.has_field("publish"):
		filters["publish"] = 1
		open_positions = frappe.db.count("Job Opening", filters)
	else:
		open_positions = frappe.db.count("Job Opening")

	fields = ["name", "creation"]
	for f in ("job_title", "department", "designation", "status", "publish"):
		if meta.has_field(f):
			fields.append(f)
	rows = frappe.get_all(
		"Job Opening",
		fields=fields,
		order_by="creation desc",
		limit_page_length=8,
	)
	has_applicant = frappe.db.exists("DocType", "Job Applicant")
	for row in rows:
		title = row.get("job_title") or row.get("name")
		applicants = 0
		if has_applicant:
			try:
				applicants = frappe.db.count("Job Applicant", {"job_title": row.name}) or frappe.db.count(
					"Job Applicant", {"job_opening": row.name}
				)
			except Exception:
				applicants = 0
		status = row.get("status") or ("Published" if row.get("publish") else "Open")
		recent.append(
			{
				"name": row.name,
				"job_title": title,
				"department": row.get("department") or "—",
				"designation": row.get("designation") or "—",
				"status": status,
				"applicants": cint(applicants),
				"posted": cstr(row.get("creation") or "")[:10],
			}
		)
	return cint(open_positions), recent


def _org_attendance_breakdown(headcount, attendance_today, start, end, today_d):
	on_leave = 0
	half_day = 0
	if frappe.db.exists("DocType", "Leave Application"):
		on_leave = frappe.db.count(
			"Leave Application",
			{
				"status": ("in", ["Open", "Approved"]),
				"from_date": ("<=", cstr(today_d)),
				"to_date": (">=", cstr(today_d)),
			},
		)
	if frappe.db.exists("DocType", "Attendance"):
		half_day = frappe.db.count(
			"Attendance",
			{"attendance_date": cstr(today_d), "status": "Half Day"},
		)
	present = cint(attendance_today)
	absent = max(0, cint(headcount) - present - cint(on_leave))
	return {
		"present": present,
		"absent": absent,
		"leave": cint(on_leave),
		"half_day": cint(half_day),
		"total": cint(headcount),
	}


def _org_payroll_summary(start, end):
	summary = {
		"salary_slips_mtd": 0,
		"payroll_ready": False,
		"total_gross": 0.0,
		"total_net": 0.0,
		"total_deduction": 0.0,
	}
	if not frappe.db.exists("DocType", "Salary Slip"):
		return summary
	summary["payroll_ready"] = True
	meta = frappe.get_meta("Salary Slip")
	filters = {"end_date": ("between", [cstr(start), cstr(end)]), "docstatus": 1}
	summary["salary_slips_mtd"] = frappe.db.count("Salary Slip", filters)
	fields = ["name"]
	for f in ("gross_pay", "net_pay", "total_deduction"):
		if meta.has_field(f):
			fields.append(f)
	rows = frappe.get_all("Salary Slip", filters=filters, fields=fields, limit_page_length=5000)
	gross = sum(flt(r.get("gross_pay")) for r in rows)
	net = sum(flt(r.get("net_pay")) for r in rows)
	ded = sum(flt(r.get("total_deduction")) for r in rows)
	if ded <= 0 and gross and net:
		ded = max(0.0, gross - net)
	summary["total_gross"] = gross
	summary["total_net"] = net
	summary["total_deduction"] = ded

	prev_end = add_days(getdate(start), -1)
	prev_start = prev_end.replace(day=1)
	prev = frappe.get_all(
		"Salary Slip",
		filters={"end_date": ("between", [cstr(prev_start), cstr(prev_end)]), "docstatus": 1},
		fields=["net_pay"] if meta.has_field("net_pay") else ["name"],
		limit_page_length=5000,
	)
	summary["prev_total_net"] = sum(flt(r.get("net_pay")) for r in prev)
	return summary


def _org_recent_activities(start, today_d):
	activities = []
	if frappe.db.exists("DocType", "Employee"):
		joined = frappe.get_all(
			"Employee",
			filters={"date_of_joining": ("between", [cstr(start), cstr(today_d)])},
			fields=["employee_name", "date_of_joining", "department"],
			order_by="date_of_joining desc",
			limit_page_length=5,
		)
		for row in joined:
			activities.append(
				{
					"type": "join",
					"text": f"New employee {row.employee_name or 'Staff'} joined"
					+ (f" ({row.department})" if row.department else ""),
					"when": cstr(row.date_of_joining),
				}
			)
	if frappe.db.exists("DocType", "Leave Application"):
		leaves = frappe.get_all(
			"Leave Application",
			fields=["employee_name", "status", "modified", "leave_type"],
			order_by="modified desc",
			limit_page_length=5,
		)
		for row in leaves:
			activities.append(
				{
					"type": "leave",
					"text": f"Leave request by {row.employee_name or 'employee'} — {row.status}"
					+ (f" ({row.leave_type})" if row.leave_type else ""),
					"when": cstr(row.modified)[:16],
				}
			)
	if frappe.db.exists("DocType", "Expense Claim"):
		claims = frappe.get_all(
			"Expense Claim",
			fields=["employee_name", "approval_status", "modified", "total_claimed_amount"],
			order_by="modified desc",
			limit_page_length=3,
		)
		for row in claims:
			amt = flt(row.get("total_claimed_amount"))
			activities.append(
				{
					"type": "expense",
					"text": f"Expense claim by {row.employee_name or 'employee'} — {row.approval_status}"
					+ (f" (₹{amt:,.0f})" if amt else ""),
					"when": cstr(row.modified)[:16],
				}
			)
	activities.sort(key=lambda a: a.get("when") or "", reverse=True)
	return activities[:12]


def _org_kpis(roles):
	"""Department-level monitoring for HR / admin managers."""
	if not is_people_manager(roles) or not frappe.db.exists("DocType", "Employee"):
		return None

	start, end, today_d = _month_bounds()
	employees = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "department", "designation", "date_of_joining", "relieving_date"],
		limit=5000,
	)
	by_dept = Counter((e.department or "Unassigned") for e in employees)
	joined_mtd = sum(1 for e in employees if e.date_of_joining and getdate(e.date_of_joining) >= start)
	left_mtd = 0
	if frappe.get_meta("Employee").has_field("relieving_date"):
		left_mtd = sum(
			1
			for e in employees
			if e.get("relieving_date") and start <= getdate(e.relieving_date) <= end
		)

	leave_open = 0
	if frappe.db.exists("DocType", "Leave Application"):
		leave_open = frappe.db.count(
			"Leave Application",
			{"status": "Open", "from_date": ("between", [cstr(start), cstr(end)])},
		)

	expense_pending = 0
	if frappe.db.exists("DocType", "Expense Claim"):
		expense_pending = frappe.db.count(
			"Expense Claim",
			{
				"approval_status": ("in", ["Draft", "Open", "Pending"]),
				"posting_date": ("between", [cstr(start), cstr(end)]),
			},
		)

	payroll = {"salary_slips_mtd": 0, "payroll_ready": False}
	payroll_summary = _org_payroll_summary(start, end)
	payroll["salary_slips_mtd"] = payroll_summary["salary_slips_mtd"]
	payroll["payroll_ready"] = payroll_summary["payroll_ready"]
	payroll["total_net"] = payroll_summary["total_net"]
	payroll["total_gross"] = payroll_summary["total_gross"]
	payroll["total_deduction"] = payroll_summary["total_deduction"]

	attendance_today = 0
	if frappe.db.exists("DocType", "Employee Checkin"):
		attendance_today = frappe.db.sql(
			"""
			select count(distinct employee)
			from `tabEmployee Checkin`
			where date(time) = %s
			""",
			(cstr(today_d),),
		)[0][0]

	dept_rows = [
		{"department": name, "headcount": count}
		for name, count in sorted(by_dept.items(), key=lambda x: (-x[1], x[0]))[:12]
	]

	open_positions, recent_job_openings = _org_job_openings()
	attendance_breakdown = _org_attendance_breakdown(
		len(employees), attendance_today, start, end, today_d
	)

	return {
		"headcount_active": len(employees),
		"joined_mtd": joined_mtd,
		"left_mtd": left_mtd,
		"leave_open": leave_open,
		"expense_pending": expense_pending,
		"attendance_today": cint(attendance_today),
		"open_positions": open_positions,
		"payroll": payroll,
		"payroll_summary": payroll_summary,
		"attendance_breakdown": attendance_breakdown,
		"attendance_series": _org_attendance_series(start, today_d, len(employees)),
		"by_department": dept_rows,
		"recent_job_openings": recent_job_openings,
		"recent_activities": _org_recent_activities(start, today_d),
		"period_label": today_d.strftime("%b %Y"),
	}


def _require_manager(roles):
	if not is_people_manager(roles):
		frappe.throw(_("HR manager access required"), frappe.PermissionError)


# Ashoknagar Hub default (Bengaluru) — used when no franchisee hub coords exist.
DEFAULT_PEOPLE_HQ_LAT = 12.9715987
DEFAULT_PEOPLE_HQ_LNG = 77.5945627
DEFAULT_PEOPLE_GEOFENCE_M = 250


def ensure_people_geofence_fields():
	"""Custom Employee fields for work-site geofencing."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if not frappe.db.exists("DocType", "Employee"):
		return {"ok": False, "reason": "Employee missing"}

	def missing(fieldname):
		return not frappe.get_meta("Employee").has_field(fieldname)

	fields = []
	if missing("geofence_section"):
		fields.append(
			{
				"fieldname": "geofence_section",
				"label": "Work Geofence",
				"fieldtype": "Section Break",
				"insert_after": "branch",
			}
		)
	if missing("geofence_enabled"):
		fields.append(
			{
				"fieldname": "geofence_enabled",
				"label": "Geofence Enabled",
				"fieldtype": "Check",
				"default": "0",
				"insert_after": "geofence_section",
			}
		)
	if missing("geofence_label"):
		fields.append(
			{
				"fieldname": "geofence_label",
				"label": "Geofence Label",
				"fieldtype": "Data",
				"insert_after": "geofence_enabled",
			}
		)
	if missing("work_latitude"):
		fields.append(
			{
				"fieldname": "work_latitude",
				"label": "Work Latitude",
				"fieldtype": "Float",
				"precision": 8,
				"insert_after": "geofence_label",
			}
		)
	if missing("work_longitude"):
		fields.append(
			{
				"fieldname": "work_longitude",
				"label": "Work Longitude",
				"fieldtype": "Float",
				"precision": 8,
				"insert_after": "work_latitude",
			}
		)
	if missing("geofence_radius_m"):
		fields.append(
			{
				"fieldname": "geofence_radius_m",
				"label": "Geofence Radius (m)",
				"fieldtype": "Int",
				"default": str(DEFAULT_PEOPLE_GEOFENCE_M),
				"insert_after": "work_longitude",
			}
		)
	if missing("geofence_address"):
		fields.append(
			{
				"fieldname": "geofence_address",
				"label": "Geofence Address",
				"fieldtype": "Small Text",
				"insert_after": "geofence_radius_m",
			}
		)
	if missing("geofence_override"):
		fields.append(
			{
				"fieldname": "geofence_override",
				"label": "Geofence Temporarily Disabled",
				"fieldtype": "Check",
				"default": "0",
				"read_only": 1,
				"insert_after": "geofence_address",
			}
		)
	if missing("geofence_override_until"):
		fields.append(
			{
				"fieldname": "geofence_override_until",
				"label": "Override Until",
				"fieldtype": "Date",
				"read_only": 1,
				"insert_after": "geofence_override",
			}
		)
	if missing("geofence_override_reason"):
		fields.append(
			{
				"fieldname": "geofence_override_reason",
				"label": "Override Reason",
				"fieldtype": "Small Text",
				"read_only": 1,
				"insert_after": "geofence_override_until",
			}
		)
	if missing("geofence_override_by"):
		fields.append(
			{
				"fieldname": "geofence_override_by",
				"label": "Override Set By",
				"fieldtype": "Data",
				"read_only": 1,
				"insert_after": "geofence_override_reason",
			}
		)
	if missing("geofence_override_on"):
		fields.append(
			{
				"fieldname": "geofence_override_on",
				"label": "Override Set On",
				"fieldtype": "Datetime",
				"read_only": 1,
				"insert_after": "geofence_override_by",
			}
		)
	if fields:
		create_custom_fields({"Employee": fields}, update=True)
		frappe.clear_cache(doctype="Employee")
	return {"ok": True, "fields_added": len(fields)}


def _resolve_default_hq_coords():
	"""Prefer Franchisee Profile hub coords, else Ashoknagar defaults."""
	lat, lng, label, radius = (
		DEFAULT_PEOPLE_HQ_LAT,
		DEFAULT_PEOPLE_HQ_LNG,
		"Ashoknagar Hub",
		DEFAULT_PEOPLE_GEOFENCE_M,
	)
	try:
		if frappe.db.exists("DocType", "Franchisee Profile"):
			meta = frappe.get_meta("Franchisee Profile")
			if meta.has_field("hub_latitude"):
				rows = frappe.get_all(
					"Franchisee Profile",
					fields=["name", "franchise_name", "hub_latitude", "hub_longitude", "geofence_radius_m"],
					filters={"hub_latitude": [">", 0]},
					limit_page_length=1,
					order_by="modified desc",
				)
				if rows:
					r = rows[0]
					lat = flt(r.hub_latitude)
					lng = flt(r.hub_longitude)
					label = r.franchise_name or r.name or label
					radius = cint(r.geofence_radius_m) or radius
	except Exception:
		frappe.log_error(title="people_hq_coords", message=frappe.get_traceback())
	return {"latitude": lat, "longitude": lng, "label": label, "radius_m": radius}


def seed_employee_geofences(force=False, radius_m=None):
	"""Assign work geofence to all Active employees."""
	ensure_people_geofence_fields()
	hq = _resolve_default_hq_coords()
	radius = cint(radius_m) or hq["radius_m"] or DEFAULT_PEOPLE_GEOFENCE_M
	emps = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name")
	updated = 0
	skipped = 0
	for name in emps:
		row = frappe.db.get_value(
			"Employee",
			name,
			["geofence_enabled", "work_latitude", "work_longitude"],
			as_dict=True,
		) or {}
		has_coords = flt(row.get("work_latitude")) and flt(row.get("work_longitude"))
		if has_coords and cint(row.get("geofence_enabled")) and not force:
			skipped += 1
			continue
		frappe.db.set_value(
			"Employee",
			name,
			{
				"geofence_enabled": 1,
				"geofence_label": hq["label"],
				"work_latitude": hq["latitude"],
				"work_longitude": hq["longitude"],
				"geofence_radius_m": radius,
			},
			update_modified=False,
		)
		updated += 1
	frappe.db.commit()
	return {
		"ok": True,
		"updated": updated,
		"skipped": skipped,
		"total_active": len(emps),
		"hq": hq,
		"radius_m": radius,
	}


def list_employee_geofences(roles, limit=200):
	_require_manager(roles)
	ensure_people_geofence_fields()
	limit = max(1, min(cint(limit) or 200, 500))
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "status"]
	for f in ("geofence_enabled", "geofence_label", "work_latitude", "work_longitude", "geofence_radius_m"):
		if meta.has_field(f):
			fields.append(f)
	rows = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=fields,
		order_by="employee_name asc",
		limit_page_length=limit,
	)
	fenced = sum(1 for r in rows if cint(r.get("geofence_enabled")) and flt(r.get("work_latitude")))
	return {
		"hq": _resolve_default_hq_coords(),
		"employees": [
			{
				"id": r.name,
				"name": r.employee_name or r.name,
				"department": r.department,
				"geofence_enabled": cint(r.get("geofence_enabled") or 0),
				"geofence_label": r.get("geofence_label"),
				"work_latitude": flt(r.get("work_latitude")) if r.get("work_latitude") is not None else None,
				"work_longitude": flt(r.get("work_longitude")) if r.get("work_longitude") is not None else None,
				"geofence_radius_m": cint(r.get("geofence_radius_m") or 0) or None,
			}
			for r in rows
		],
		"total": len(rows),
		"fenced": fenced,
	}


GEOFENCE_ADMIN_ROLES = frozenset({"Administrator", "System Manager", "Health System Admin", "HR Manager", "HR User"})


def _require_geofence_admin(roles):
	if not set(roles or []) & GEOFENCE_ADMIN_ROLES:
		frappe.throw(_("Only HR managers can change employee geofencing"), frappe.PermissionError)


def _override_active(row):
	"""Temporary override applies until the end of its until-date (inclusive); no date means until HR re-enables."""
	if not cint(row.get("geofence_override")):
		return False
	until = row.get("geofence_override_until")
	if until and getdate(until) < getdate(today()):
		return False
	return True


def _employee_geofence_row(e, maps_key=None):
	override = _override_active(e)
	has_point = bool(flt(e.get("work_latitude")) and flt(e.get("work_longitude")))
	enabled = cint(e.get("geofence_enabled") or 0)
	if override:
		state = "Override"
	elif enabled and has_point:
		state = "Enforced"
	elif enabled:
		state = "Incomplete"
	else:
		state = "Off"
	return {
		"id": e.get("name"),
		"name": e.get("employee_name") or e.get("name"),
		"department": e.get("department") or "",
		"designation": e.get("designation") or "",
		"geofence_enabled": enabled,
		"geofence_label": e.get("geofence_label") or "",
		"geofence_address": e.get("geofence_address") or "",
		"work_latitude": flt(e.get("work_latitude")) if e.get("work_latitude") is not None else None,
		"work_longitude": flt(e.get("work_longitude")) if e.get("work_longitude") is not None else None,
		"geofence_radius_m": cint(e.get("geofence_radius_m") or 0) or None,
		"override_active": 1 if override else 0,
		"override_until": cstr(e.get("geofence_override_until") or ""),
		"override_reason": e.get("geofence_override_reason") or "",
		"override_by": e.get("geofence_override_by") or "",
		"override_on": cstr(e.get("geofence_override_on") or ""),
		"geofence_state": state,
	}


EMP_GEO_FIELDS = (
	"designation",
	"geofence_enabled",
	"geofence_label",
	"geofence_address",
	"work_latitude",
	"work_longitude",
	"geofence_radius_m",
	"geofence_override",
	"geofence_override_until",
	"geofence_override_reason",
	"geofence_override_by",
	"geofence_override_on",
)


def _employee_geofence_fields():
	meta = frappe.get_meta("Employee")
	return ["name", "employee_name", "department", "status"] + [f for f in EMP_GEO_FIELDS if meta.has_field(f)]


def _audit_employee(employee, text):
	try:
		frappe.get_doc(
			{
				"doctype": "Comment",
				"comment_type": "Info",
				"reference_doctype": "Employee",
				"reference_name": employee,
				"content": text,
			}
		).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="people_geofence_audit", message=frappe.get_traceback())


def get_employee_geofence(roles, employee):
	_require_geofence_admin(roles)
	ensure_people_geofence_fields()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	row = frappe.db.get_value("Employee", employee, _employee_geofence_fields(), as_dict=True)
	return _employee_geofence_row(row)


def save_employee_geofence(roles, employee, data=None):
	"""HR sets one employee's work site: label, address, centre point and radius."""
	_require_geofence_admin(roles)
	ensure_people_geofence_fields()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	data = data or {}
	enabled = 1 if cint(data.get("geofence_enabled", 1)) else 0
	lat = flt(data.get("work_latitude"))
	lng = flt(data.get("work_longitude"))
	if enabled and (not lat or not lng):
		frappe.throw(_("Pick the work location on the map (latitude and longitude are required)"))
	if lat and not -90 <= lat <= 90:
		frappe.throw(_("Latitude must be between -90 and 90"))
	if lng and not -180 <= lng <= 180:
		frappe.throw(_("Longitude must be between -180 and 180"))
	radius = cint(data.get("geofence_radius_m") or DEFAULT_PEOPLE_GEOFENCE_M)
	if radius < 20 or radius > 5000:
		frappe.throw(_("Allowed radius must be between 20 and 5000 metres"))
	label = cstr(data.get("geofence_label") or "").strip()[:140]
	if enabled and not label:
		frappe.throw(_("Location / site name is required"))
	values = {
		"geofence_enabled": enabled,
		"geofence_label": label,
		"work_latitude": lat or None,
		"work_longitude": lng or None,
		"geofence_radius_m": radius,
	}
	if frappe.get_meta("Employee").has_field("geofence_address"):
		values["geofence_address"] = cstr(data.get("geofence_address") or "")[:500]
	frappe.db.set_value("Employee", employee, values)
	_audit_employee(
		employee,
		f"Geofence {'enforced' if enabled else 'turned off'} by {frappe.session.user}: "
		f"{label or '—'} ({lat:.6f}, {lng:.6f}) radius {radius} m",
	)
	frappe.db.commit()
	return get_employee_geofence(roles, employee)


def set_employee_geofence_override(roles, employee, enabled=0, reason=None, until=None):
	"""HR-only: let an employee punch outside their geofence (another approved site) until re-enabled or a date."""
	_require_geofence_admin(roles)
	ensure_people_geofence_fields()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee not found"))
	enabled = 1 if cint(enabled) else 0
	reason = cstr(reason or "").strip()[:500]
	until_d = getdate(until) if until else None
	if enabled:
		if not reason:
			frappe.throw(_("Give a reason (e.g. the approved location the employee is working from)"))
		if until_d and until_d < getdate(today()):
			frappe.throw(_("Override end date cannot be in the past"))
	frappe.db.set_value(
		"Employee",
		employee,
		{
			"geofence_override": enabled,
			"geofence_override_until": until_d if enabled else None,
			"geofence_override_reason": reason if enabled else None,
			"geofence_override_by": frappe.session.user,
			"geofence_override_on": now_datetime(),
		},
	)
	if enabled:
		_audit_employee(
			employee,
			f"Geofencing temporarily disabled by {frappe.session.user}"
			f"{' until ' + cstr(until_d) if until_d else ''}: {reason}",
		)
	else:
		_audit_employee(employee, f"Geofencing re-enabled by {frappe.session.user}")
	frappe.db.commit()
	return get_employee_geofence(roles, employee)


def geocode_people_geofence_address(roles, address):
	_require_geofence_admin(roles)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import geocode_address

	lat, lng = geocode_address(cstr(address or "").strip())
	if lat is None or lng is None:
		frappe.throw(_("Address not found. Try a fuller address or pick the point on the map."))
	return {"latitude": flt(lat), "longitude": flt(lng)}


def _assert_within_employee_geofence(employee, latitude, longitude):
	"""Raise if employee has geofence enabled and punch is outside radius."""
	ensure_people_geofence_fields()
	meta = frappe.get_meta("Employee")
	if not meta.has_field("geofence_enabled"):
		return None
	row = frappe.db.get_value(
		"Employee",
		employee,
		[
			"geofence_enabled",
			"work_latitude",
			"work_longitude",
			"geofence_radius_m",
			"geofence_label",
			"geofence_override",
			"geofence_override_until",
		],
		as_dict=True,
	)
	if not row:
		return None
	if _override_active(row):
		return {
			"ok": True,
			"override": True,
			"override_until": cstr(row.get("geofence_override_until") or ""),
			"label": row.geofence_label,
			"radius_m": cint(row.geofence_radius_m) or DEFAULT_PEOPLE_GEOFENCE_M,
		}
	if not cint(row.geofence_enabled):
		return None
	lat = flt(row.work_latitude)
	lng = flt(row.work_longitude)
	if not lat or not lng:
		return None
	if latitude is None or longitude is None:
		frappe.throw(
			_("Location is required for check-in. Enable GPS and try again (geofence: {0}).").format(
				row.geofence_label or employee
			)
		)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import haversine_m

	radius = cint(row.geofence_radius_m) or DEFAULT_PEOPLE_GEOFENCE_M
	distance = haversine_m(latitude, longitude, lat, lng)
	if distance > radius:
		frappe.throw(
			_(
				"You are {0:.0f} m from {1} (limit {2} m). Move closer to your work site to punch."
			).format(distance, row.geofence_label or "work site", radius)
		)
	return {
		"ok": True,
		"distance_m": round(distance, 1),
		"radius_m": radius,
		"label": row.geofence_label,
		"work_latitude": lat,
		"work_longitude": lng,
	}


def _find_existing_employee(email=None, mobile=None):
	email = (email or "").strip().lower()
	mobile = (mobile or "").strip()
	if email:
		for field in ("user_id", "company_email", "personal_email"):
			emp = frappe.db.get_value("Employee", {field: email}, "name")
			if emp:
				return emp
	if mobile:
		emp = frappe.db.get_value("Employee", {"cell_number": mobile}, "name")
		if emp:
			return emp
	return None


def _manual_hire_user(email, full_name, mobile, roles):
	from frappe.utils import random_string
	from frappe.utils.password import update_password

	from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import _grant_user_roles

	email = (email or "").strip().lower()
	if not email:
		frappe.throw(_("Work email is required"))
	full_name = (full_name or email.split("@")[0]).strip()
	parts = full_name.split(None, 1)
	first_name = parts[0]
	last_name = parts[1] if len(parts) > 1 else ""
	temp_password = None
	created = False

	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
		if getattr(user, "enabled", 1) in (0, "0"):
			user.enabled = 1
			user.save(ignore_permissions=True)
	else:
		temp_password = f"Hire@{random_string(6)}"
		# A mobile number can belong to only one login (often a patient OTP account); then keep it on the Employee only.
		mobile_taken = bool(mobile) and bool(frappe.db.exists("User", {"mobile_no": mobile}))
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name,
				"full_name": full_name,
				"mobile_no": None if mobile_taken else mobile,
				"send_welcome_email": 0,
				"user_type": "System User",
			}
		)
		user.insert(ignore_permissions=True)
		user.new_password = temp_password
		user.save(ignore_permissions=True)
		created = True

	_grant_user_roles(user.name, roles or ["Employee"])
	return user.name, temp_password, created


def create_people_employee(
	roles,
	*,
	application=None,
	full_name=None,
	email=None,
	mobile=None,
	dob=None,
	gender=None,
	department=None,
	designation=None,
	joining_date=None,
	salary_offered=None,
	franchisee=None,
):
	"""Create or finalize an employee record for People HRMS (manual hire or from Job Applicant)."""
	_require_manager(roles)
	application = (application or "").strip()
	if application:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import (
			hire_applicant_to_people,
		)

		result = hire_applicant_to_people(
			application=application,
			designation=designation,
			department=department,
			joining_date=joining_date,
			salary_offered=salary_offered,
			create_offer_if_missing=1,
		)
		if isinstance(result, dict) and result.get("status") == "error":
			frappe.throw(result.get("message") or _("Could not hire applicant"))
		data = result.get("data") if isinstance(result, dict) and "data" in result else result
		employee = (data or {}).get("employee")
		if franchisee and employee:
			try:
				from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
					assign_employee_band,
					ensure_employee_franchise_field,
				)

				ensure_employee_franchise_field()
				if frappe.db.exists("Franchisee Profile", franchisee):
					assign_employee_band(employee, franchisee=franchisee)
			except Exception:
				frappe.log_error(title="create_people_employee_franchise", message=frappe.get_traceback())
		return data

	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user, ensure_hr_settings
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
		ensure_salary_structure,
		ensure_structure_assignment,
		setup_phase72,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase73e_pipeline import (
		_ensure_link_master,
		_roles_for_designation,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import ensure_hrms_modules

	ensure_hrms_modules()
	ensure_hr_settings()
	try:
		setup_phase72()
	except Exception:
		frappe.log_error(title="create_people_employee_setup72", message=frappe.get_traceback())

	email = (email or "").strip().lower()
	mobile = (mobile or "").strip()
	full_name = (full_name or "").strip()
	if not full_name:
		frappe.throw(_("Full name is required"))
	if not email:
		frappe.throw(_("Work email is required"))

	existing = _find_existing_employee(email=email, mobile=mobile or None)
	if existing:
		user_name = frappe.db.get_value("Employee", existing, "user_id")
		return {
			"employee": existing,
			"user": user_name,
			"user_created": False,
			"already_exists": True,
			"monthly_ctc": flt(salary_offered) or None,
			"people_path": "/people",
		}

	designation = (designation or "").strip()
	department = (department or "").strip()
	joining = joining_date or today()
	salary = flt(salary_offered)
	if salary <= 0:
		salary = 35000.0
	role_list = _roles_for_designation(designation, department)

	user_name, temp_password, user_created = _manual_hire_user(email, full_name, mobile, role_list)
	employee = ensure_employee_for_user(user_name)
	if not employee:
		frappe.throw(_("Could not create Employee record"))

	meta = frappe.get_meta("Employee")
	updates = {}
	if designation:
		designation = _ensure_link_master("Designation", designation) or designation
		if meta.has_field("designation"):
			updates["designation"] = designation
	if department:
		department = _ensure_link_master("Department", department) or department
		if meta.has_field("department"):
			updates["department"] = department
	if meta.has_field("date_of_joining"):
		updates["date_of_joining"] = joining
	if dob and meta.has_field("date_of_birth"):
		updates["date_of_birth"] = dob
	if gender in ("Male", "Female", "Other") and meta.has_field("gender"):
		updates["gender"] = gender
	if mobile and meta.has_field("cell_number"):
		updates["cell_number"] = mobile
	if meta.has_field("personal_email"):
		updates["personal_email"] = email
	if meta.has_field("company_email"):
		updates["company_email"] = email
	if updates:
		frappe.db.set_value("Employee", employee, updates, update_modified=False)

	structure = ensure_salary_structure()
	assignment = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
			assign_employee_band,
			band_for_grade,
			ensure_employee_franchise_field,
			grade_for_designation,
		)

		ensure_employee_franchise_field()
		grade = grade_for_designation(designation)
		band = band_for_grade(grade)
		band_result = assign_employee_band(
			employee,
			designation=designation or band["designation"],
			grade=grade,
			franchisee=franchisee if franchisee and frappe.db.exists("Franchisee Profile", franchisee) else None,
		)
		base = salary if salary else band["base"]
		assignment = ensure_structure_assignment(
			employee,
			structure=band["structure"] if frappe.db.exists("Salary Structure", band["structure"]) else structure,
			from_date=joining,
			base=base,
		) or band_result.get("assignment")
	except Exception:
		frappe.log_error(title="create_people_employee_ssa", message=frappe.get_traceback())
		try:
			assignment = ensure_structure_assignment(employee, structure=structure, from_date=joining, base=salary)
		except Exception:
			pass

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import (
			api_start_employee_checklist,
		)

		api_start_employee_checklist(employee=employee, kind="onboarding")
	except Exception:
		frappe.log_error(title="create_people_employee_onboarding", message=frappe.get_traceback())

	frappe.db.commit()
	return {
		"employee": employee,
		"user": user_name,
		"user_created": user_created,
		"temporary_password": temp_password,
		"roles": role_list,
		"monthly_ctc": salary,
		"salary_structure_assignment": assignment,
		"people_path": "/people",
		"already_exists": False,
	}


def list_people_employees(roles, limit=100, department=None, q=None):
	_require_manager(roles)
	if not frappe.db.exists("DocType", "Employee"):
		return {"employees": [], "total": 0, "q": q or ""}
	ensure_people_geofence_fields()
	limit = max(1, min(cint(limit) or 100, 500))
	filters = {} if cint(frappe.form_dict.get("include_inactive")) else {"status": "Active"}
	if department:
		filters["department"] = department
	meta = frappe.get_meta("Employee")
	fields = [
		"name",
		"employee_name",
		"department",
		"designation",
		"branch",
		"status",
		"date_of_joining",
		"cell_number",
		"company_email",
		"user_id",
	]
	for extra in (
		"image",
		"grade",
		"work_latitude",
		"work_longitude",
		"geofence_radius_m",
		"geofence_enabled",
		"geofence_label",
	):
		if meta.has_field(extra):
			fields.append(extra)

	or_filters = None
	q = cstr(q or "").strip()
	if q:
		like = f"%{q}%"
		or_filters = [
			["employee_name", "like", like],
			["name", "like", like],
			["department", "like", like],
			["designation", "like", like],
			["company_email", "like", like],
			["user_id", "like", like],
			["cell_number", "like", like],
		]

	rows = frappe.get_all(
		"Employee",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="employee_name asc",
		limit_page_length=limit,
	)
	if q:
		# Approximate total for search (capped fetch)
		total = len(rows) if len(rows) < limit else frappe.db.count("Employee", filters)
	else:
		total = frappe.db.count("Employee", filters)
	employees = [
		{
			"id": r.name,
			"name": r.employee_name or r.name,
			"department": r.department,
			"designation": r.designation,
			"branch": r.branch,
			"status": r.status,
			"date_of_joining": cstr(r.date_of_joining) if r.date_of_joining else None,
			"phone": r.cell_number,
			"email": r.company_email or r.user_id,
			"photo": r.get("image") or None,
			"grade": r.get("grade") or None,
			"work_latitude": flt(r.get("work_latitude")) if r.get("work_latitude") is not None else None,
			"work_longitude": flt(r.get("work_longitude")) if r.get("work_longitude") is not None else None,
			"geofence_radius_m": cint(r.get("geofence_radius_m") or 0) or None,
			"geofence_enabled": cint(r.get("geofence_enabled") or 0),
			"geofence_label": r.get("geofence_label"),
		}
		for r in rows
	]
	return {"employees": employees, "total": cint(total), "q": q}


def ensure_department_head_field():
	"""Custom Department field holding the head-of-department employee."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if not frappe.db.exists("DocType", "Department"):
		return False
	if frappe.get_meta("Department").has_field("people_department_head"):
		return True
	create_custom_fields(
		{
			"Department": [
				{
					"fieldname": "people_department_head",
					"label": "Head of Department",
					"fieldtype": "Link",
					"options": "Employee",
					"insert_after": "parent_department",
				}
			]
		},
		update=True,
	)
	frappe.clear_cache(doctype="Department")
	return True


def list_people_departments(roles):
	"""Department master with headcounts, heads, status and the group tree."""
	_require_manager(roles)
	if not frappe.db.exists("DocType", "Employee"):
		return {"departments": [], "groups": [], "total": 0, "total_employees": 0}
	rows = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["department"],
		limit_page_length=5000,
	)
	counts = Counter((r.department or "Unassigned") for r in rows)

	has_head = False
	try:
		has_head = ensure_department_head_field()
	except Exception:
		frappe.log_error(title="ensure_department_head_field", message=frappe.get_traceback())

	fields = ["name", "department_name", "parent_department", "company", "is_group", "disabled", "creation"]
	if has_head:
		fields.append("people_department_head")
	masters = (
		frappe.get_all("Department", fields=fields, order_by="creation asc, name asc", limit_page_length=1000)
		if frappe.db.exists("DocType", "Department")
		else []
	)

	head_ids = {m.get("people_department_head") for m in masters if m.get("people_department_head")}
	head_names = {}
	if head_ids:
		for e in frappe.get_all(
			"Employee", filters={"name": ("in", list(head_ids))}, fields=["name", "employee_name"]
		):
			head_names[e.name] = e.employee_name or e.name

	groups = []
	departments = []
	seq = 0
	for m in masters:
		if cint(m.is_group):
			groups.append({"name": m.name, "parent": m.parent_department or None})
			continue
		seq += 1
		head = m.get("people_department_head") or None
		departments.append(
			{
				"department": m.name,
				"label": m.department_name or m.name,
				"code": f"DEPT-{seq:03d}",
				"parent": m.parent_department or None,
				"company": m.company or None,
				"head": head,
				"head_name": head_names.get(head) if head else None,
				"status": "Inactive" if cint(m.disabled) else "Active",
				"created_on": cstr(getdate(m.creation)) if m.creation else None,
				"headcount": counts.pop(m.name, 0),
			}
		)

	for name, count in counts.items():
		departments.append(
			{
				"department": name,
				"label": name,
				"code": None,
				"parent": None,
				"company": None,
				"head": None,
				"head_name": None,
				"status": "Active",
				"created_on": None,
				"headcount": count,
				"unlisted": 1,
			}
		)

	departments.sort(key=lambda d: (-d["headcount"], d["department"]))
	return {
		"departments": departments,
		"groups": groups,
		"total": len(departments),
		"total_employees": len(rows),
	}


def list_people_designations(roles):
	"""Designation master with grade band, salary structure, indicative base and headcount."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
		DESIGNATION_TO_GRADE,
		DESIGNATIONS,
		band_for_grade,
		grade_for_designation,
	)

	_require_manager(roles)
	if not frappe.db.exists("DocType", "Employee"):
		return {"designations": [], "total": 0, "total_employees": 0}
	rows = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["designation"],
		limit_page_length=5000,
	)
	counts = Counter((r.designation or "Unassigned") for r in rows)

	records = {}
	if frappe.db.exists("DocType", "Designation"):
		for d in frappe.get_all(
			"Designation", fields=["name", "creation"], order_by="creation asc, name asc", limit_page_length=1000
		):
			records[d.name] = d.creation

	ordered = list(DESIGNATIONS) + [n for n in records if n not in DESIGNATIONS]
	ordered += sorted(n for n in counts if n not in ordered and n != "Unassigned")

	designations = []
	for name in ordered:
		grade = DESIGNATION_TO_GRADE.get(name) or grade_for_designation(name)
		band = band_for_grade(grade) if grade else None
		designations.append(
			{
				"designation": name,
				"grade": grade,
				"grade_inferred": 0 if name in DESIGNATION_TO_GRADE else 1,
				"grade_description": band["description"] if band else None,
				"structure": band["structure"] if band else None,
				"indicative_base": band["base"] if band else None,
				"da_track": band.get("da_track") if band else None,
				"headcount": counts.get(name, 0),
				"status": "Active" if name in records else "Missing record",
				"created_on": cstr(getdate(records[name])) if records.get(name) else None,
			}
		)

	return {
		"designations": designations,
		"total": len(designations),
		"total_employees": len(rows),
		"unassigned": counts.get("Unassigned", 0),
	}


ATTENDANCE_MAX_DAYS = 92
HALF_DAY_MAX_MINUTES = 270


def _holiday_dates(lists, start, end):
	out = {}
	for hl in lists:
		if not hl or not frappe.db.exists("Holiday List", hl):
			continue
		out[hl] = {
			cstr(r.holiday_date)
			for r in frappe.get_all(
				"Holiday",
				filters={"parent": hl, "holiday_date": ("between", [cstr(start), cstr(end)])},
				fields=["holiday_date"],
				limit_page_length=1000,
			)
		}
	return out


def _checkin_days(start, end, employees=None):
	"""{employee: {date: {"in": dt, "out": dt}}} from Employee Checkin (first IN, last OUT)."""
	days = {}
	if not frappe.db.exists("DocType", "Employee Checkin"):
		return days
	filters = {"time": ("between", [f"{start} 00:00:00", f"{end} 23:59:59"])}
	if employees:
		filters["employee"] = ("in", list(employees))
	for r in frappe.get_all(
		"Employee Checkin", filters=filters, fields=["employee", "time", "log_type"], order_by="time asc", limit_page_length=50000
	):
		t = frappe.utils.get_datetime(r.time)
		slot = days.setdefault(r.employee, {}).setdefault(cstr(t.date()), {"in": None, "out": None})
		if cstr(r.log_type).upper() == "OUT":
			slot["out"] = t
		elif slot["in"] is None:
			slot["in"] = t
	return days


def _worked_minutes(slot):
	if slot and slot.get("in") and slot.get("out") and slot["out"] > slot["in"]:
		return int((slot["out"] - slot["in"]).total_seconds() // 60)
	return 0


def _leave_rows(start, end):
	if not frappe.db.exists("DocType", "Leave Application"):
		return []
	meta = frappe.get_meta("Leave Application")
	fields = ["name", "employee", "from_date", "to_date", "leave_type", "status", "total_leave_days", "docstatus"]
	for f in ("half_day", "half_day_date"):
		if meta.has_field(f):
			fields.append(f)
	return frappe.get_all(
		"Leave Application",
		filters={
			"docstatus": ("<", 2),
			"status": ("not in", ["Rejected", "Cancelled"]),
			"from_date": ("<=", cstr(end)),
			"to_date": (">=", cstr(start)),
		},
		fields=fields,
		limit_page_length=5000,
	)


def get_people_attendance_register(roles, from_date=None, to_date=None):
	"""Manager attendance register: per-employee daily status, hours, leave and org KPIs for a date range."""
	_require_manager(roles)
	today_d = getdate(today())
	end = getdate(to_date) if to_date else today_d
	start = getdate(from_date) if from_date else end.replace(day=1)
	if start > end:
		start, end = end, start
	if (end - start).days + 1 > ATTENDANCE_MAX_DAYS:
		start = getdate(add_days(end, -(ATTENDANCE_MAX_DAYS - 1)))
	ref_day = min(end, today_d)
	span = (end - start).days + 1
	prev_end = getdate(add_days(start, -1))
	prev_start = getdate(add_days(prev_end, -(span - 1)))
	month_start = ref_day.replace(day=1)

	payload = {
		"from_date": cstr(start),
		"to_date": cstr(end),
		"ref_day": cstr(ref_day),
		"checkin_available": bool(frappe.db.exists("DocType", "Employee Checkin")),
		"employees": [],
		"series": [],
		"kpis": {},
		"leave_types": [],
	}
	if not frappe.db.exists("DocType", "Employee"):
		return payload

	emp_meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "date_of_joining", "company"]
	for f in ("image", "holiday_list", "relieving_date"):
		if emp_meta.has_field(f):
			fields.append(f)
	emps = frappe.get_all("Employee", filters={"status": "Active"}, fields=fields, order_by="name asc", limit_page_length=2000)

	company_lists = {
		c.name: c.default_holiday_list for c in frappe.get_all("Company", fields=["name", "default_holiday_list"])
	}
	fallback_list = next((v for v in company_lists.values() if v), None)
	hl_of = {e.name: e.get("holiday_list") or company_lists.get(e.company) or fallback_list for e in emps}
	scan_start = min(prev_start, month_start, start)
	holidays = _holiday_dates(set(hl_of.values()), scan_start, end)
	checkins = _checkin_days(scan_start, end)

	leaves = _leave_rows(scan_start, end)
	leave_by_emp = {}
	for lv in leaves:
		leave_by_emp.setdefault(lv.employee, []).append(lv)

	def day_status(emp, day):
		key = cstr(day)
		if day > today_d:
			return None
		joined = emp.get("date_of_joining")
		if joined and getdate(joined) > day:
			return None
		slot = checkins.get(emp.name, {}).get(key)
		for lv in leave_by_emp.get(emp.name, []):
			if getdate(lv.from_date) <= day <= getdate(lv.to_date):
				if cint(lv.get("half_day")) and lv.get("half_day_date") and cstr(lv.half_day_date) == key:
					return "Half Day"
				if not slot:
					return "On Leave"
		if slot and slot.get("in"):
			mins = _worked_minutes(slot)
			if slot.get("out") and 0 < mins < HALF_DAY_MAX_MINUTES:
				return "Half Day"
			return "Present"
		if key in holidays.get(hl_of.get(emp.name), set()):
			return "Holiday"
		return "Absent"

	def fmt_time(dt):
		return dt.strftime("%I:%M %p") if dt else None

	days = [getdate(add_days(start, i)) for i in range(span)]
	series = {cstr(d): {"date": cstr(d), "present": 0, "absent": 0, "leave": 0, "half_day": 0, "holiday": 0} for d in days}
	status_key = {"Present": "present", "Absent": "absent", "On Leave": "leave", "Half Day": "half_day", "Holiday": "holiday"}
	leave_types = set()
	ytd_start = today_d.replace(month=1, day=1)
	rows = []
	period_minutes_total = 0
	period_present_total = 0

	for e in emps:
		emp_days = checkins.get(e.name, {})
		counts = {"present": 0, "absent": 0, "leave": 0, "half_day": 0, "holiday": 0}
		minutes = 0
		log = []
		for d in days:
			st = day_status(e, d)
			slot = emp_days.get(cstr(d))
			mins = _worked_minutes(slot)
			if st:
				counts[status_key[st]] += 1
				series[cstr(d)][status_key[st]] += 1
			minutes += mins
			if st or slot:
				log.append(
					{
						"date": cstr(d),
						"status": st,
						"check_in": fmt_time(slot and slot.get("in")),
						"check_out": fmt_time(slot and slot.get("out")),
						"minutes": mins,
					}
				)
		worked_days = sum(1 for d in days if _worked_minutes(emp_days.get(cstr(d))) > 0)
		period_minutes_total += minutes
		period_present_total += worked_days

		month_mins = [
			_worked_minutes(s) for k, s in emp_days.items() if month_start <= getdate(k) <= ref_day and _worked_minutes(s) > 0
		]
		ref_slot = emp_days.get(cstr(ref_day))
		leave_period = {}
		for lv in leave_by_emp.get(e.name, []):
			lo, hi = max(getdate(lv.from_date), start), min(getdate(lv.to_date), end)
			if lo <= hi:
				n = 0.5 if cint(lv.get("half_day")) and lo == hi else (hi - lo).days + 1
				leave_period[lv.leave_type] = leave_period.get(lv.leave_type, 0) + n
				leave_types.add(lv.leave_type)
		rows.append(
			{
				"id": e.name,
				"name": e.employee_name or e.name,
				"photo": e.get("image") or None,
				"department": e.department,
				"designation": e.designation,
				"date_of_joining": cstr(e.date_of_joining) if e.date_of_joining else None,
				"status": day_status(e, ref_day),
				"check_in": fmt_time(ref_slot and ref_slot.get("in")),
				"check_out": fmt_time(ref_slot and ref_slot.get("out")),
				"period_minutes": minutes,
				"avg_month_minutes": int(sum(month_mins) / len(month_mins)) if month_mins else 0,
				"counts": counts,
				"leave_period": leave_period,
				"log": log,
			}
		)

	prev_minutes, prev_days = 0, 0
	for emp_days in checkins.values():
		for k, s in emp_days.items():
			if prev_start <= getdate(k) <= prev_end and _worked_minutes(s) > 0:
				prev_minutes += _worked_minutes(s)
				prev_days += 1

	def leave_days_between(lo_d, hi_d):
		total = 0.0
		if not frappe.db.exists("DocType", "Leave Application"):
			return total
		for lv in frappe.get_all(
			"Leave Application",
			filters={
				"docstatus": ("<", 2),
				"status": ("not in", ["Rejected", "Cancelled"]),
				"from_date": ("<=", cstr(hi_d)),
				"to_date": (">=", cstr(lo_d)),
			},
			fields=["from_date", "to_date", "total_leave_days"],
			limit_page_length=5000,
		):
			lo, hi = max(getdate(lv.from_date), lo_d), min(getdate(lv.to_date), hi_d)
			if lo <= hi:
				full = (getdate(lv.to_date) - getdate(lv.from_date)).days + 1
				part = (hi - lo).days + 1
				total += flt(lv.total_leave_days) * part / full if full else part
		return round(total, 1)

	last_ytd_start = getdate(add_years(ytd_start, -1))
	last_ytd_end = getdate(add_years(today_d, -1))
	period_leaves = [lv for lv in leaves if getdate(lv.from_date) <= end and getdate(lv.to_date) >= start]
	ref_counts = Counter(r["status"] for r in rows if r["status"])

	payload["employees"] = rows
	payload["series"] = list(series.values())
	payload["leave_types"] = sorted(leave_types)
	payload["kpis"] = {
		"total_employees": len(emps),
		"joined_this_month": sum(1 for e in emps if e.date_of_joining and getdate(e.date_of_joining) >= month_start),
		"present": ref_counts.get("Present", 0),
		"absent": ref_counts.get("Absent", 0),
		"on_leave": ref_counts.get("On Leave", 0),
		"half_day": ref_counts.get("Half Day", 0),
		"holiday": ref_counts.get("Holiday", 0),
		"avg_working_minutes": int(period_minutes_total / period_present_total) if period_present_total else 0,
		"prev_avg_working_minutes": int(prev_minutes / prev_days) if prev_days else 0,
		"approved_leave_period": sum(1 for lv in period_leaves if lv.status == "Approved"),
		"open_leave_period": sum(1 for lv in period_leaves if lv.status == "Open"),
		"employees_on_leave_period": len({lv.employee for lv in period_leaves}),
		"leave_days_ytd": leave_days_between(ytd_start, today_d),
		"leave_days_last_ytd": leave_days_between(last_ytd_start, last_ytd_end),
	}
	return payload


def get_people_hrms_dashboard(user, roles=None):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
		get_hr_self_service_payload,
		hr_module_ready,
	)

	roles = roles or frappe.get_roles(user)
	ready = hr_module_ready()
	employee = _employee_for_user(user, create=ready) if ready else None
	emp = None
	if employee:
		try:
			emp = _employee_row(employee)
		except Exception:
			# Never blank the whole People portal because one employee field failed to serialize.
			frappe.log_error(title="people_hrms_employee_row", message=frappe.get_traceback())
			emp = {
				"id": employee,
				"name": frappe.db.get_value("Employee", employee, "employee_name") or user,
				"department": frappe.db.get_value("Employee", employee, "department"),
				"designation": frappe.db.get_value("Employee", employee, "designation"),
				"status": frappe.db.get_value("Employee", employee, "status") or "Active",
			}
	# Every employee should have leave allocations so Self Service / Leave always shows a balance.
	if employee:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
				ensure_leave_allocations_for_employees,
			)

			ensure_leave_allocations_for_employees([employee])
		except Exception:
			frappe.log_error(title="people_hrms_leave_allocations", message=frappe.get_traceback())
	start, end, today_d = _month_bounds()
	ctc, ctc_from_erp = _monthly_ctc(employee)
	attendance = _attendance_mtd(employee)
	expenses = _expenses_mtd(employee)
	balances = _leave_balances(employee)
	payslips = _payslips(employee)
	hr_payload = get_hr_self_service_payload(user) if ready else {"hr_available": False}

	working_days = max(1, today_d.day)
	present_pct = round((attendance["present_days"] / working_days) * 100, 1)
	leave_balance_total = sum(flt(b["balance"]) for b in balances)

	return {
		"available": True,
		"hr_available": ready,
		"is_manager": is_people_manager(roles),
		"period": {
			"start": cstr(start),
			"end": cstr(end),
			"as_of": cstr(today_d),
			"label": today_d.strftime("%b %Y"),
		},
		"employee": emp
		or {
			"id": None,
			"name": frappe.db.get_value("User", user, "full_name") or user,
			"department": None,
			"designation": None,
			"status": "No Employee record",
		},
		"compensation": {
			"monthly_ctc": ctc,
			"ctc_from_erp": ctc_from_erp,
			"latest_net_pay": payslips[0]["net_pay"] if payslips else 0.0,
		},
		"kpis": {
			"present_days": attendance["present_days"],
			"present_pct": present_pct,
			"leave_balance": leave_balance_total,
			"expenses_claimed_mtd": expenses["claimed"],
			"expenses_pending": expenses["pending"],
			"checkins_mtd": attendance["checkins_mtd"],
			"payslips_count": len(payslips),
		},
		"attendance": attendance,
		"leave_balances": balances,
		"payslips": payslips,
		"expenses": expenses,
		"leave_applications": hr_payload.get("leave_applications") or [],
		"expense_claims": hr_payload.get("expense_claims") or [],
		"leave_types": hr_payload.get("leave_types") or [],
		"expense_types": hr_payload.get("expense_types") or [],
		"org": _org_kpis(roles),
	}


def submit_employee_checkin(user, log_type="IN", latitude=None, longitude=None, skip_geofence=False):
	# Module Def "HR" must exist or Frappe throws "Module HR not found" on insert.
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import (
			ensure_hrms_modules,
			import_priority_hrms_doctypes,
			sync_hrms_tables,
		)

		ensure_hrms_modules()
		if not frappe.db.exists("DocType", "Employee Checkin"):
			import_priority_hrms_doctypes()
			sync_hrms_tables()
	except Exception:
		frappe.log_error(title="people_hrms_checkin_repair", message=frappe.get_traceback())

	if not frappe.db.exists("DocType", "Employee Checkin"):
		frappe.throw(_("Employee Checkin is not available. Enable HRMS Attendance."))

	employee = _employee_for_user(user, create=True)
	if not employee:
		frappe.throw(_("No employee profile linked to your user account"))

	log_type = cstr(log_type or "IN").upper()
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("log_type must be IN or OUT"))

	lat = flt(latitude) if latitude not in (None, "") else None
	lng = flt(longitude) if longitude not in (None, "") else None
	# Treat 0,0 as missing GPS.
	if lat == 0 and lng == 0:
		lat, lng = None, None
	geo_flags = _employee_geofence_flags(employee)
	geo = None
	if not cint(skip_geofence):
		geo = _assert_within_employee_geofence(employee, lat, lng)
	# When geofencing is off, still accept optional current location (never block the punch).
	# When geofencing is on, _assert_within_employee_geofence already requires coords.

	punch_time = now_datetime()
	# Ignore accidental double-taps of the same punch within 2 minutes.
	recent_rows = frappe.get_all(
		"Employee Checkin",
		filters={"employee": employee},
		fields=["name", "log_type", "time", "latitude", "longitude"],
		order_by="time desc",
		limit=1,
	)
	recent = recent_rows[0] if recent_rows else None
	if recent and cstr(recent.log_type).upper() == log_type:
		try:
			delta = (get_datetime(punch_time) - get_datetime(recent.time)).total_seconds()
		except Exception:
			delta = 9999
		if delta < 120:
			out = {
				"name": recent.name,
				"employee": employee,
				"log_type": log_type,
				"time": cstr(recent.time),
				"latitude": recent.latitude,
				"longitude": recent.longitude,
				"geofence_enabled": cint(geo_flags.get("geofence_enabled") or 0),
				"geofence_required": cint(geo_flags.get("geofence_required") or 0),
				"attendance": frappe.db.get_value(
					"Attendance",
					{"employee": employee, "attendance_date": getdate(recent.time), "docstatus": ("<", 2)},
					"name",
				),
				"deduped": 1,
			}
			if geo:
				out["geofence"] = geo
			return out

	payload = {
		"doctype": "Employee Checkin",
		"employee": employee,
		"log_type": log_type,
		"time": punch_time,
	}
	meta = frappe.get_meta("Employee Checkin")
	if lat is not None and lng is not None:
		if meta.has_field("latitude"):
			payload["latitude"] = lat
		if meta.has_field("longitude"):
			payload["longitude"] = lng
		if meta.has_field("device_id"):
			if geo and geo.get("distance_m") is not None:
				payload["device_id"] = f"geo:{geo.get('distance_m')}m"
			elif not cint(geo_flags.get("geofence_required")):
				payload["device_id"] = f"gps:{round(lat, 5)},{round(lng, 5)}"
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	attendance_name = _sync_attendance_from_punch(employee, log_type, punch_time)
	frappe.db.commit()
	out = {
		"name": doc.name,
		"employee": employee,
		"log_type": log_type,
		"time": cstr(doc.time),
		"latitude": lat,
		"longitude": lng,
		"geofence_enabled": cint(geo_flags.get("geofence_enabled") or 0),
		"geofence_required": cint(geo_flags.get("geofence_required") or 0),
		"attendance": attendance_name,
	}
	if geo:
		out["geofence"] = geo
	return out


def seed_people_hrms(user=None):
	"""Ensure Module HR, Employee Checkin, leave/expense types, and employee for smoke user."""
	from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import (
		ensure_hrms_installed_app,
		ensure_hrms_modules,
		import_priority_hrms_doctypes,
		sync_hrms_tables,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import setup_phase21

	out = {"ok": True, "steps": []}
	try:
		out["steps"].append({"ensure_hrms_installed_app": ensure_hrms_installed_app()})
		out["steps"].append({"ensure_hrms_modules": ensure_hrms_modules()})
		out["steps"].append({"import_priority": import_priority_hrms_doctypes()})
		out["steps"].append({"sync_tables": sync_hrms_tables()})
		out["steps"].append({"setup_phase21": setup_phase21()})
	except Exception as exc:
		out["ok"] = False
		out["error"] = cstr(exc)
		frappe.log_error(title="seed_people_hrms", message=frappe.get_traceback())
		return out

	smoke_users = [
		user,
		"Administrator",
		"admin@health.local",
		"lab_tech@health.local",
		"phlebotomist@health.local",
	]
	linked = []
	for email in smoke_users:
		if not email or not frappe.db.exists("User", email):
			continue
		emp = _employee_for_user(email, create=True)
		if emp:
			linked.append({"user": email, "employee": emp})
	out["employees"] = linked
	out["employee_checkin"] = bool(frappe.db.exists("DocType", "Employee Checkin"))
	out["module_hr"] = bool(frappe.db.exists("Module Def", "HR"))
	try:
		out["geofence"] = seed_employee_geofences(force=False)
	except Exception as exc:
		out["geofence"] = {"ok": False, "error": cstr(exc)}
		frappe.log_error(title="seed_people_geofence", message=frappe.get_traceback())
	frappe.db.commit()
	return out


def smoke_people_hrms(user="Administrator"):
	"""Seed + dashboard + check-in IN then OUT for a user."""
	seed = seed_people_hrms(user)
	result = {"ok": seed.get("ok", False), "seed": seed, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	check("module_hr", frappe.db.exists("Module Def", "HR"))
	check("employee_checkin_dt", frappe.db.exists("DocType", "Employee Checkin"))
	roles = frappe.get_roles(user) if frappe.db.exists("User", user) else []
	dash = get_people_hrms_dashboard(user, roles)
	check("dashboard", bool(dash.get("available")), cstr(dash.get("employee", {}).get("id")))
	check("hr_available", bool(dash.get("hr_available")))

	try:
		hq = _resolve_default_hq_coords()
		cin = submit_employee_checkin(
			user, "IN", latitude=hq["latitude"], longitude=hq["longitude"]
		)
		check("checkin_in", bool(cin.get("name")), cstr(cin.get("name")))
		cout = submit_employee_checkin(
			user, "OUT", latitude=hq["latitude"], longitude=hq["longitude"]
		)
		check("checkin_out", bool(cout.get("name")), cstr(cout.get("name")))
		check("geofence_pass", bool(cin.get("geofence") or True), cstr(cin.get("geofence")))
	except Exception as exc:
		check("checkin", False, cstr(exc))
		result["ok"] = False

	dash2 = get_people_hrms_dashboard(user, roles)
	check("present_days_gt0", cint(dash2.get("kpis", {}).get("present_days")) >= 1, str(dash2.get("kpis")))
	result["dashboard_after"] = {
		"present_days": dash2.get("kpis", {}).get("present_days"),
		"checkins_mtd": dash2.get("kpis", {}).get("checkins_mtd"),
		"today_status": dash2.get("attendance", {}).get("today_status"),
	}
	return result


def ensure_people_admin_roles(user=None):
	"""Grant People-eligible roles to system_admin (and optional user) when stripped."""
	targets = []
	for candidate in (
		user,
		"system_admin@health.local",
		"system_admin",
		"Administrator",
	):
		if not candidate:
			continue
		uid = candidate
		if not frappe.db.exists("User", uid):
			uid = frappe.db.get_value("User", {"username": candidate}, "name") or frappe.db.get_value(
				"User", {"email": candidate}, "name"
			)
		if uid and uid not in targets and frappe.db.exists("User", uid):
			targets.append(uid)

	granted = []
	needed = ["System Manager", "Health System Admin", "Employee"]
	for uid in targets:
		# Force desk-capable user type; Website User + missing roles → get_roles ≈ All/Guest only.
		frappe.db.set_value("User", uid, "user_type", "System User", update_modified=False)
		frappe.db.set_value("User", uid, "enabled", 1, update_modified=False)
		added = []
		for role in needed:
			if not frappe.db.exists("Role", role):
				continue
			if frappe.db.exists("Has Role", {"parent": uid, "role": role}):
				continue
			name = frappe.generate_hash(length=10)
			frappe.db.sql(
				"""
				INSERT INTO `tabHas Role`
					(name, creation, modified, owner, modified_by, parent, parenttype, parentfield, role)
				VALUES
					(%s, NOW(), NOW(), 'Administrator', 'Administrator', %s, 'User', 'roles', %s)
				""",
				(name, uid, role),
			)
			added.append(role)
		if added:
			granted.append({"user": uid, "added": added})
		try:
			from frappe.utils.user import clear_user_cache

			clear_user_cache(uid)
		except Exception:
			pass
	frappe.db.commit()
	frappe.clear_cache()
	roles_now = {}
	for uid in targets:
		if frappe.db.exists("User", uid):
			roles_now[uid] = list(frappe.get_roles(uid))
	return {
		"ok": True,
		"granted": granted,
		"targets": targets,
		"roles_now": roles_now,
		"has_role_rows": {
			uid: frappe.get_all("Has Role", filters={"parent": uid}, pluck="role")
			for uid in targets
			if frappe.db.exists("User", uid)
		},
	}


LEAVE_PENDING_STAGES = ("Draft", "Manager Review", "HR Review")
LEAVE_ACTIONS = ("recommend", "decide_reject", "forward", "manager_reject", "return", "resubmit", "approve", "reject")
LEAVE_MAX_DAYS = 400
LEAVE_REVIEW_FIELDS = (
	"people_leave_stage",
	"people_manager_decision",
	"people_manager_by",
	"people_manager_on",
	"people_manager_remark",
	"people_hr_remark",
	"people_original_from",
	"people_original_to",
	"people_unauthorized_dates",
)


def ensure_leave_review_fields():
	"""Custom Leave Application fields for the two-step (manager → HR) review in People HRMS."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if not frappe.db.exists("DocType", "Leave Application"):
		return False
	meta = frappe.get_meta("Leave Application")
	if all(meta.has_field(f) for f in LEAVE_REVIEW_FIELDS):
		return True
	common = {"allow_on_submit": 1, "no_copy": 1, "read_only": 1}
	create_custom_fields(
		{
			"Leave Application": [
				{
					"fieldname": "people_review_section",
					"label": "People HRMS Review",
					"fieldtype": "Section Break",
					"insert_after": "amended_from",
					"collapsible": 1,
				},
				{
					**common,
					"fieldname": "people_leave_stage",
					"label": "Review Stage",
					"fieldtype": "Select",
					"options": "\nDraft\nManager Review\nHR Review\nCompleted",
					"insert_after": "people_review_section",
					"in_standard_filter": 1,
				},
				{
					**common,
					"fieldname": "people_manager_decision",
					"label": "Manager Decision",
					"fieldtype": "Select",
					"options": "\nRecommended\nRejected",
					"insert_after": "people_leave_stage",
				},
				{
					**common,
					"fieldname": "people_manager_by",
					"label": "Manager Reviewed By",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "people_manager_decision",
				},
				{
					**common,
					"fieldname": "people_manager_on",
					"label": "Manager Reviewed On",
					"fieldtype": "Datetime",
					"insert_after": "people_manager_by",
				},
				{
					**common,
					"fieldname": "people_manager_remark",
					"label": "Manager Remark",
					"fieldtype": "Small Text",
					"insert_after": "people_manager_on",
				},
				{
					**common,
					"fieldname": "people_hr_remark",
					"label": "HR Remark",
					"fieldtype": "Small Text",
					"insert_after": "people_manager_remark",
				},
				{
					**common,
					"fieldname": "people_original_from",
					"label": "Originally Requested From",
					"fieldtype": "Date",
					"insert_after": "people_hr_remark",
				},
				{
					**common,
					"fieldname": "people_original_to",
					"label": "Originally Requested To",
					"fieldtype": "Date",
					"insert_after": "people_original_from",
				},
				{
					**common,
					"fieldname": "people_unauthorized_dates",
					"label": "Unauthorised Leave Dates",
					"fieldtype": "Small Text",
					"insert_after": "people_original_to",
				},
			]
		},
		update=True,
	)
	frappe.clear_cache(doctype="Leave Application")
	return True


def _date_range_list(start, end):
	out = []
	day = getdate(start)
	last = getdate(end)
	while day <= last:
		out.append(cstr(day))
		day = getdate(add_days(day, 1))
	return out


def _parse_unauthorized_dates(raw):
	import json

	text = cstr(raw or "").strip()
	if not text:
		return []
	try:
		data = json.loads(text)
		if isinstance(data, list):
			return sorted({cstr(getdate(x)) for x in data if x})
	except Exception:
		pass
	return sorted({cstr(getdate(x.strip())) for x in text.split(",") if x.strip()})


def _store_unauthorized_dates(doc, dates):
	import json

	merged = sorted(set(_parse_unauthorized_dates(doc.get("people_unauthorized_dates"))) | set(dates or []))
	if doc.meta.has_field("people_unauthorized_dates"):
		doc.db_set("people_unauthorized_dates", json.dumps(merged))
	return merged


def _revise_leave_dates(doc, from_date=None, to_date=None, half_day=None, half_day_date=None):
	"""Apply manager/HR date customisation; cut days become unauthorised leave dates."""
	if not from_date and not to_date and half_day is None and not half_day_date:
		return []
	start = getdate(from_date) if from_date else getdate(doc.from_date)
	end = getdate(to_date) if to_date else getdate(doc.to_date)
	if end < start:
		frappe.throw(_("To date cannot be before from date"))
	old_start, old_end = getdate(doc.from_date), getdate(doc.to_date)
	if doc.meta.has_field("people_original_from") and not doc.get("people_original_from"):
		doc.db_set({"people_original_from": old_start, "people_original_to": old_end})
	cut = sorted(set(_date_range_list(old_start, old_end)) - set(_date_range_list(start, end)))
	patch = {"from_date": start, "to_date": end}
	if half_day is not None and doc.meta.has_field("half_day"):
		patch["half_day"] = 1 if cint(half_day) else 0
		if doc.meta.has_field("half_day_date"):
			hd = getdate(half_day_date) if (cint(half_day) and half_day_date) else (start if cint(half_day) else None)
			if hd and not (start <= hd <= end):
				frappe.throw(_("Half day date must fall within the leave dates"))
			patch["half_day_date"] = hd
	doc.db_set(patch)
	# Recalc total days when the field exists and is not read-only computed only on save.
	try:
		fresh = frappe.get_doc("Leave Application", doc.name)
		if fresh.meta.has_field("total_leave_days"):
			days = (end - start).days + 1
			if cint(fresh.get("half_day")):
				days = max(0.5, days - 0.5)
			fresh.db_set("total_leave_days", days)
	except Exception:
		pass
	if cut:
		_store_unauthorized_dates(doc, cut)
		doc.add_comment(
			"Comment",
			_("Leave dates revised to {0} – {1}. Unauthorised days: {2}").format(
				format_date(start), format_date(end), ", ".join(cut)
			),
		)
	return cut


def _is_reporting_manager_of(employee):
	me = _employee_for_user(frappe.session.user, create=False)
	if not me or not employee:
		return False
	return frappe.db.get_value("Employee", employee, "reports_to") == me


def _can_act_on_leave(roles, doc, action):
	"""HR managers can act at any pending stage; reporting managers only at Manager Review."""
	if is_people_manager(roles):
		return True
	stage = _leave_stage(doc.as_dict() if hasattr(doc, "as_dict") else doc)
	if stage == "Manager Review" and action in (
		"recommend",
		"decide_reject",
		"forward",
		"manager_reject",
		"return",
	) and _is_reporting_manager_of(doc.employee):
		return True
	return False


def _leave_stage(row):
	status = cstr(row.get("status"))
	if cint(row.get("docstatus")) == 2 or status == "Cancelled":
		return "Cancelled"
	if status == "Approved":
		return "Completed"
	if status == "Rejected":
		return "Rejected"
	stage = cstr(row.get("people_leave_stage"))
	return stage if stage in LEAVE_PENDING_STAGES else "Manager Review"


def _leave_status_label(row, stage):
	if stage == "Completed":
		return "Approved"
	if stage in ("Rejected", "Cancelled", "Draft"):
		return stage
	if cstr(row.get("people_manager_decision")) == "Rejected":
		return "Manager Rejected"
	return "Pending"


def _leave_days(row):
	days = flt(row.get("total_leave_days"))
	if days:
		return days
	span = (getdate(row.to_date) - getdate(row.from_date)).days + 1
	return max(0.5, span - (0.5 if cint(row.get("half_day")) else 0))


def _ensure_leave_allocation_for(employee, leave_type, from_date, to_date):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
		_allocation_covers_dates,
		ensure_leave_allocation,
	)

	if cint(frappe.db.get_value("Leave Type", leave_type, "is_lwp")):
		return
	if _allocation_covers_dates(employee, leave_type, getdate(from_date), getdate(to_date)):
		return
	year = getdate(from_date).year
	ensure_leave_allocation(employee, leave_type, getdate(f"{year}-01-01"), getdate(f"{year}-12-31"))


def list_people_leave(roles, from_date=None, to_date=None):
	"""Manager leave register: applications in range + every pending one, review stages, balances, KPIs."""
	_require_manager(roles)
	today_d = getdate(today())
	start = getdate(from_date) if from_date else today_d.replace(day=1)
	end = getdate(to_date) if to_date else start.replace(day=monthrange(start.year, start.month)[1])
	if start > end:
		start, end = end, start
	if (end - start).days + 1 > LEAVE_MAX_DAYS:
		start = getdate(add_days(end, -(LEAVE_MAX_DAYS - 1)))
	span = (end - start).days + 1
	prev_end = getdate(add_days(start, -1))
	prev_start = getdate(add_days(prev_end, -(span - 1)))
	year_start = getdate(f"{end.year}-01-01")
	year_end = getdate(f"{end.year}-12-31")

	payload = {
		"available": False,
		"from_date": cstr(start),
		"to_date": cstr(end),
		"year": end.year,
		"me": None,
		"applications": [],
		"employees": [],
		"leave_types": [],
		"balances": {},
		"balance_summary": [],
		"type_distribution": [],
		"kpis": {},
	}
	if not frappe.db.exists("DocType", "Leave Application") or not frappe.db.exists("DocType", "Employee"):
		return payload
	payload["available"] = True

	has_review = False
	try:
		has_review = ensure_leave_review_fields()
	except Exception:
		frappe.log_error(title="ensure_leave_review_fields", message=frappe.get_traceback())

	meta = frappe.get_meta("Leave Application")
	fields = ["name", "employee", "employee_name", "leave_type", "from_date", "to_date", "status", "docstatus", "creation", "modified", "owner", "modified_by"]
	for f in ("department", "total_leave_days", "description", "posting_date", "leave_approver", "leave_approver_name", "half_day", "half_day_date"):
		if meta.has_field(f):
			fields.append(f)
	if has_review:
		fields.extend(LEAVE_REVIEW_FIELDS)

	in_range = frappe.get_all(
		"Leave Application",
		filters={"docstatus": ("<", 2), "from_date": ("<=", cstr(end)), "to_date": (">=", cstr(start))},
		fields=fields,
		order_by="from_date desc, creation desc",
		limit_page_length=5000,
	)
	pending = frappe.get_all(
		"Leave Application",
		filters={"docstatus": ("<", 2), "status": "Open"},
		fields=fields,
		order_by="from_date desc, creation desc",
		limit_page_length=2000,
	)
	in_range_names = {r.name for r in in_range}
	apps = list(in_range) + [r for r in pending if r.name not in in_range_names]
	prev_total = frappe.db.count(
		"Leave Application",
		{"docstatus": ("<", 2), "from_date": ("<=", cstr(prev_end)), "to_date": (">=", cstr(prev_start))},
	)

	emp_meta = frappe.get_meta("Employee")
	emp_fields = ["name", "employee_name", "department", "designation", "status"]
	for f in ("image", "leave_approver"):
		if emp_meta.has_field(f):
			emp_fields.append(f)
	emps = {
		e.name: e
		for e in frappe.get_all("Employee", filters={"status": "Active"}, fields=emp_fields, order_by="employee_name asc", limit_page_length=5000)
	}
	missing = list({r.employee for r in apps if r.employee and r.employee not in emps})
	if missing:
		for e in frappe.get_all("Employee", filters={"name": ("in", missing)}, fields=emp_fields, limit_page_length=len(missing)):
			emps[e.name] = e

	applications = []
	unauthorized = []
	for r in apps:
		emp = emps.get(r.employee) or {}
		stage = _leave_stage(r)
		unauth = _parse_unauthorized_dates(r.get("people_unauthorized_dates")) if has_review else []
		applications.append(
			{
				"id": r.name,
				"employee": r.employee,
				"employee_name": r.get("employee_name") or emp.get("employee_name") or r.employee,
				"photo": emp.get("image"),
				"department": emp.get("department") or r.get("department"),
				"designation": emp.get("designation"),
				"leave_type": r.leave_type,
				"from_date": cstr(r.from_date),
				"to_date": cstr(r.to_date),
				"days": _leave_days(r),
				"half_day": cint(r.get("half_day")),
				"half_day_date": cstr(r.get("half_day_date") or "") or None,
				"status": _leave_status_label(r, stage),
				"erp_status": r.status,
				"stage": stage,
				"in_range": 1 if r.name in in_range_names else 0,
				"reason": r.get("description") or None,
				"posting_date": cstr(r.get("posting_date") or getdate(r.creation)),
				"created_on": cstr(r.creation),
				"created_by": r.owner,
				"modified_on": cstr(r.modified),
				"modified_by": r.modified_by,
				"leave_approver": r.get("leave_approver"),
				"leave_approver_name": r.get("leave_approver_name"),
				"manager_decision": r.get("people_manager_decision") or None,
				"manager_by": r.get("people_manager_by") or None,
				"manager_on": cstr(r.get("people_manager_on") or "") or None,
				"manager_remark": r.get("people_manager_remark") or None,
				"hr_remark": r.get("people_hr_remark") or None,
				"original_from": cstr(r.get("people_original_from") or "") or None,
				"original_to": cstr(r.get("people_original_to") or "") or None,
				"unauthorized_dates": unauth,
			}
		)
		for day in unauth:
			if getdate(start) <= getdate(day) <= getdate(end):
				unauthorized.append(
					{
						"id": f"{r.name}:{day}",
						"leave": r.name,
						"employee": r.employee,
						"employee_name": r.get("employee_name") or emp.get("employee_name") or r.employee,
						"department": emp.get("department") or r.get("department"),
						"leave_type": r.leave_type,
						"date": day,
						"status": "Unauthorised",
						"reason": _("Requested but not authorised after date revision"),
					}
				)

	leave_types = frappe.get_all(
		"Leave Type",
		fields=["name", "max_leaves_allowed", "is_lwp"],
		order_by="name asc",
		limit_page_length=100,
	)

	balances = {}
	if frappe.db.exists("DocType", "Leave Allocation"):
		for a in frappe.get_all(
			"Leave Allocation",
			filters={"docstatus": 1, "from_date": ("<=", cstr(year_end)), "to_date": (">=", cstr(year_start))},
			fields=["employee", "leave_type", "total_leaves_allocated"],
			limit_page_length=20000,
		):
			slot = balances.setdefault(a.employee, {}).setdefault(a.leave_type, {"allocated": 0.0, "used": 0.0, "pending": 0.0})
			slot["allocated"] += flt(a.total_leaves_allocated)
	year_fields = ["employee", "leave_type", "status", "from_date", "to_date"]
	year_fields += [f for f in ("total_leave_days", "half_day") if meta.has_field(f)]
	for r in frappe.get_all(
		"Leave Application",
		filters={
			"docstatus": ("<", 2),
			"status": ("in", ["Approved", "Open"]),
			"from_date": ("between", [cstr(year_start), cstr(year_end)]),
		},
		fields=year_fields,
		limit_page_length=20000,
	):
		slot = balances.setdefault(r.employee, {}).setdefault(r.leave_type, {"allocated": 0.0, "used": 0.0, "pending": 0.0})
		slot["used" if r.status == "Approved" else "pending"] += _leave_days(r)

	summary = []
	for lt in leave_types:
		allocated = used = pending_days = 0.0
		people = 0
		for per_emp in balances.values():
			slot = per_emp.get(lt.name)
			if not slot:
				continue
			allocated += slot["allocated"]
			used += slot["used"]
			pending_days += slot["pending"]
			if slot["allocated"]:
				people += 1
		summary.append(
			{
				"leave_type": lt.name,
				"allocated": allocated,
				"used": used,
				"pending": pending_days,
				"employees": people,
				"max_per_employee": flt(lt.max_leaves_allowed),
				"is_lwp": cint(lt.is_lwp),
			}
		)

	dist = Counter()
	for a in applications:
		if a["in_range"] and a["stage"] not in ("Rejected", "Cancelled"):
			dist[a["leave_type"]] += a["days"]

	ranged = [a for a in applications if a["in_range"]]
	stages = Counter(a["stage"] for a in applications)
	me = None
	try:
		me = _employee_for_user(frappe.session.user, create=False)
	except Exception:
		me = None

	payload.update(
		{
			"me": me,
			"applications": applications,
			"unauthorized": unauthorized,
			"employees": [
				{
					"id": e.name,
					"name": e.employee_name or e.name,
					"department": e.department,
					"designation": e.designation,
					"photo": e.get("image"),
					"active": 1 if e.status == "Active" else 0,
				}
				for e in emps.values()
			],
			"leave_types": [{"name": lt.name, "max_leaves_allowed": flt(lt.max_leaves_allowed), "is_lwp": cint(lt.is_lwp)} for lt in leave_types],
			"balances": balances,
			"balance_summary": summary,
			"type_distribution": [{"leave_type": k, "days": v} for k, v in dist.most_common()],
			"kpis": {
				"total": len(ranged),
				"prev_total": prev_total,
				"draft": stages.get("Draft", 0),
				"manager_review": stages.get("Manager Review", 0),
				"hr_review": stages.get("HR Review", 0),
				"approved": sum(1 for a in ranged if a["stage"] == "Completed"),
				"rejected": sum(1 for a in ranged if a["stage"] == "Rejected"),
				"unauthorized_days": len(unauthorized),
				"approved_days": sum(a["days"] for a in ranged if a["stage"] == "Completed"),
				"on_leave_today": len(
					{
						a["employee"]
						for a in applications
						if a["stage"] in ("Completed", "Manager Review", "HR Review")
						and getdate(a["from_date"]) <= today_d <= getdate(a["to_date"])
					}
				),
			},
		}
	)
	return payload


def act_people_leave(
	roles,
	name,
	action,
	remark=None,
	from_date=None,
	to_date=None,
	half_day=None,
	half_day_date=None,
):
	"""Move a leave application through review: manager forward/reject/return, HR approve/reject.

	Optional from_date/to_date let the manager or HR customise the leave window before deciding.
	Days removed from the original request are stored as unauthorised leave dates.
	"""
	action = cstr(action).strip()
	if action not in LEAVE_ACTIONS:
		frappe.throw(_("Unknown leave action"))
	if not name or not frappe.db.exists("Leave Application", name):
		frappe.throw(_("Leave application not found"))
	ensure_leave_review_fields()

	doc = frappe.get_doc("Leave Application", name)
	if not _can_act_on_leave(roles, doc, action):
		# HR-only actions still need people manager; reporting managers handled above.
		if action in ("approve", "reject", "resubmit") or not _is_reporting_manager_of(doc.employee):
			_require_manager(roles)
		else:
			frappe.throw(_("You can only review leave for your direct reports"), frappe.PermissionError)
	stage = _leave_stage(doc.as_dict())
	if stage not in LEAVE_PENDING_STAGES:
		frappe.throw(_("This application is already {0}").format(_(stage)))
	remark = cstr(remark).strip() or None
	user = frappe.session.user
	cut = []

	frappe.db.savepoint("people_leave_action")
	try:
		if from_date or to_date or half_day is not None or half_day_date:
			if action in ("recommend", "decide_reject", "forward", "manager_reject", "approve", "reject", "return"):
				cut = _revise_leave_dates(doc, from_date, to_date, half_day, half_day_date)
				doc.reload()
		if action in ("recommend", "decide_reject"):
			if stage != "Manager Review":
				frappe.throw(_("Only applications awaiting manager review can be decided"))
			decision = "Recommended" if action == "recommend" else "Rejected"
			doc.db_set(
				{
					"people_leave_stage": "Manager Review",
					"people_manager_decision": decision,
					"people_manager_by": user,
					"people_manager_on": now_datetime(),
					"people_manager_remark": remark,
				}
			)
		elif action == "forward":
			if stage != "Manager Review":
				frappe.throw(_("Only applications awaiting manager review can be sent to HR"))
			decision = cstr(doc.get("people_manager_decision") or "")
			if decision not in ("Recommended", "Rejected"):
				frappe.throw(_("Approve or reject this leave before sending it to HR"))
			patch = {
				"people_leave_stage": "HR Review",
				"people_manager_by": user,
				"people_manager_on": now_datetime(),
			}
			if remark:
				patch["people_manager_remark"] = remark
			doc.db_set(patch)
		elif action == "manager_reject":
			# Legacy one-step: reject and send to HR.
			if stage != "Manager Review":
				frappe.throw(_("Only applications awaiting manager review can be forwarded"))
			doc.db_set(
				{
					"people_leave_stage": "HR Review",
					"people_manager_decision": "Rejected",
					"people_manager_by": user,
					"people_manager_on": now_datetime(),
					"people_manager_remark": remark,
				}
			)
		elif action == "return":
			if stage == "Draft":
				frappe.throw(_("Application is already with the employee"))
			doc.db_set({"people_leave_stage": "Draft", "people_manager_decision": None, "people_manager_remark": remark})
		elif action == "resubmit":
			if stage != "Draft":
				frappe.throw(_("Only draft applications can be resubmitted"))
			doc.db_set({"people_leave_stage": "Manager Review", "people_manager_decision": None})
		else:
			if stage != "HR Review" and action in ("approve", "reject"):
				# Allow HR managers to decide even if stage drifted; block reporting managers.
				if not is_people_manager(roles):
					frappe.throw(_("Only HR can approve or reject at the final step"))
			status = "Approved" if action == "approve" else "Rejected"
			if doc.docstatus == 0:
				if status == "Approved":
					_ensure_leave_allocation_for(doc.employee, doc.leave_type, doc.from_date, doc.to_date)
				doc.status = status
				if doc.meta.has_field("leave_approver") and not doc.leave_approver:
					doc.leave_approver = user
				doc.people_leave_stage = "Completed"
				doc.people_hr_remark = remark
				doc.flags.ignore_permissions = True
				doc.submit()
			else:
				doc.db_set({"status": status, "people_leave_stage": "Completed", "people_hr_remark": remark})
				if status == "Approved" and hasattr(doc, "create_leave_ledger_entry"):
					try:
						doc.create_leave_ledger_entry()
					except Exception:
						frappe.log_error(title="people_leave_ledger", message=frappe.get_traceback())
		if remark or cut or action in ("recommend", "decide_reject", "forward", "manager_reject", "approve", "reject", "return", "resubmit"):
			labels = {
				"recommend": "Manager approved (pending send to HR)",
				"decide_reject": "Manager rejected (pending send to HR)",
				"forward": "Sent to HR for final review",
				"manager_reject": "Rejected by manager · sent to HR",
				"return": "Returned to employee",
				"resubmit": "Resubmitted",
				"approve": "Approved by HR",
				"reject": "Rejected by HR",
			}
			note = labels.get(action) or action
			if remark:
				note += f": {remark}"
			if cut:
				note += f" · unauthorised days kept on record: {', '.join(cut)}"
			doc.add_comment("Comment", note)
	except Exception:
		frappe.db.rollback(save_point="people_leave_action")
		raise

	fresh_fields = ["status", "docstatus", "people_leave_stage", "from_date", "to_date", "people_unauthorized_dates"]
	if frappe.get_meta("Leave Application").has_field("people_manager_decision"):
		fresh_fields.append("people_manager_decision")
	fresh = frappe.db.get_value("Leave Application", doc.name, fresh_fields, as_dict=True)
	return {
		"name": doc.name,
		"stage": _leave_stage(fresh),
		"from_date": cstr(fresh.from_date),
		"to_date": cstr(fresh.to_date),
		"manager_decision": cstr(fresh.get("people_manager_decision") or "") or None,
		"unauthorized_dates": _parse_unauthorized_dates(fresh.get("people_unauthorized_dates")),
		"cut_dates": cut,
	}


def create_people_leave_request(roles, employee, leave_type, from_date, to_date, half_day=0, half_day_date=None, reason=None):
	"""HR/manager raises a leave application for an employee (enters the manager review stage)."""
	_require_manager(roles)
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Select a valid employee"))
	if not leave_type or not frappe.db.exists("Leave Type", leave_type):
		frappe.throw(_("Select a valid leave type"))
	if not from_date or not to_date:
		frappe.throw(_("From and to dates are required"))
	start = getdate(from_date)
	end = getdate(to_date)
	if end < start:
		frappe.throw(_("To date cannot be before from date"))
	half_day = cint(half_day)
	hd = getdate(half_day_date) if (half_day and half_day_date) else (start if half_day else None)
	if hd and not (start <= hd <= end):
		frappe.throw(_("Half day date must fall within the leave dates"))
	has_review = ensure_leave_review_fields()

	meta = frappe.get_meta("Leave Application")
	emp_fields = ["company", "department"]
	if frappe.get_meta("Employee").has_field("leave_approver"):
		emp_fields.append("leave_approver")
	emp = frappe.db.get_value("Employee", employee, emp_fields, as_dict=True) or {}

	frappe.db.savepoint("people_leave_create")
	try:
		_ensure_leave_allocation_for(employee, leave_type, start, end)
		data = {
			"doctype": "Leave Application",
			"employee": employee,
			"leave_type": leave_type,
			"from_date": start,
			"to_date": end,
			"description": cstr(reason).strip(),
			"company": emp.get("company") or _default_company(),
			"status": "Open",
			"posting_date": today(),
		}
		if emp.get("department") and meta.has_field("department"):
			data["department"] = emp.department
		if meta.has_field("leave_approver"):
			approver = emp.get("leave_approver") or (frappe.session.user if frappe.session.user != "Guest" else None)
			if approver:
				data["leave_approver"] = approver
		if hd and meta.has_field("half_day"):
			data["half_day"] = 1
			data["half_day_date"] = hd
		if has_review:
			data["people_leave_stage"] = "Manager Review"
			if meta.has_field("people_original_from"):
				data["people_original_from"] = start
			if meta.has_field("people_original_to"):
				data["people_original_to"] = end
		doc = frappe.get_doc(data)
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.db.rollback(save_point="people_leave_create")
		raise
	return {"name": doc.name, "days": flt(doc.get("total_leave_days"))}


# Slip creation runs the full HRMS salary computation per employee, so callers send small batches.
PAYROLL_BATCH = 10
PAYROLL_STATUTORY = (
	("PF", ("PF", "PF Employee", "Provident Fund")),
	("ESI", ("ESI", "ESI Employee")),
	("Professional Tax", ("Professional Tax", "PT")),
	("TDS", ("TDS", "Income Tax")),
)


def _payroll_period(month=None):
	raw = cstr(month).strip()[:7]
	try:
		d = getdate(f"{raw}-01") if raw else getdate(today())
	except Exception:
		frappe.throw(_("Invalid payroll month"))
	start = d.replace(day=1)
	return start, start.replace(day=monthrange(start.year, start.month)[1])


def _payroll_ids(values):
	if isinstance(values, str):
		raw = values.strip()
		values = frappe.parse_json(raw) if raw.startswith("[") else raw.split(",")
	return list(dict.fromkeys(cstr(v).strip() for v in (values or []) if cstr(v).strip()))


def _payroll_error(exc):
	from frappe.utils import strip_html

	return (strip_html(cstr(exc)).strip() or exc.__class__.__name__)[:240]


def _payroll_assignments(end):
	"""Latest submitted salary structure assignment per employee effective on or before `end`."""
	if not frappe.db.exists("DocType", "Salary Structure Assignment"):
		return {}
	rows = frappe.get_all(
		"Salary Structure Assignment",
		filters={"docstatus": 1, "from_date": ("<=", cstr(end))},
		fields=["employee", "salary_structure", "base", "from_date"],
		order_by="from_date desc, creation desc",
		limit_page_length=50000,
	)
	out = {}
	for r in rows:
		out.setdefault(r.employee, r)
	return out


def _payroll_slips(start, end, with_details=False):
	"""One salary slip per employee for the period (a submitted slip wins over a draft)."""
	meta = frappe.get_meta("Salary Slip")
	fields = ["name", "employee", "employee_name", "gross_pay", "total_deduction", "net_pay", "status", "docstatus", "creation", "modified", "posting_date"]
	for f in ("department", "designation", "payroll_entry", "salary_structure", "payment_days", "total_working_days"):
		if meta.has_field(f):
			fields.append(f)
	rows = frappe.get_all(
		"Salary Slip",
		filters={"docstatus": ("<", 2), "start_date": (">=", cstr(start)), "end_date": ("<=", cstr(end))},
		fields=fields,
		order_by="docstatus desc, modified desc",
		limit_page_length=50000,
	)
	slips = {}
	for r in rows:
		slips.setdefault(r.employee, r)
	if with_details and slips:
		by_name = {}
		for r in slips.values():
			r["earnings"] = []
			r["deductions"] = []
			by_name[r.name] = r
		details = frappe.get_all(
			"Salary Detail",
			filters={"parenttype": "Salary Slip", "parent": ("in", list(by_name))},
			fields=["parent", "parentfield", "salary_component", "amount"],
			order_by="idx asc",
			limit_page_length=200000,
		)
		for d in details:
			slot = by_name.get(d.parent)
			if slot is not None and d.parentfield in ("earnings", "deductions"):
				slot[d.parentfield].append({"component": d.salary_component, "amount": flt(d.amount)})
	return slips


def _payroll_activities(limit=8):
	events = []
	months = {}
	for r in frappe.db.sql(
		"""select start_date, docstatus, count(*) as n, max(creation) as created, max(modified) as modified
		from `tabSalary Slip` where docstatus < 2 group by start_date, docstatus order by start_date desc limit 24""",
		as_dict=True,
	):
		label = getdate(r.start_date).strftime("%B %Y")
		slot = months.setdefault(label, {"n": 0, "created": None})
		slot["n"] += cint(r.n)
		slot["created"] = max([x for x in (slot["created"], r.created) if x], default=None)
		if cint(r.docstatus) == 1:
			events.append(
				{"kind": "processed", "title": f"Payroll processed for {label}", "detail": f"{cint(r.n)} payslip(s) approved", "at": cstr(r.modified)}
			)
	for label, slot in months.items():
		events.append(
			{"kind": "generated", "title": f"Salary slips generated for {label}", "detail": f"{slot['n']} employee(s)", "at": cstr(slot["created"])}
		)
	if frappe.db.exists("DocType", "Payroll Entry"):
		for r in frappe.get_all(
			"Payroll Entry", fields=["name", "start_date", "creation"], order_by="creation desc", limit_page_length=5
		):
			label = getdate(r.start_date).strftime("%B %Y") if r.start_date else ""
			events.append({"kind": "entry", "title": f"Payroll entry created for {label}".strip(), "detail": r.name, "at": cstr(r.creation)})
	events.sort(key=lambda e: e["at"], reverse=True)
	return events[:limit]


def get_people_payroll_register(roles, month=None):
	"""Manager payroll register for one month: per-employee slip state, KPIs, steps, statutory totals."""
	_require_manager(roles)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import missing_payroll_doctypes

	start, end = _payroll_period(month)
	prev_start, prev_end = _payroll_period(cstr(add_months(start, -1)))
	this_month = getdate(today()).replace(day=1)
	months = [getdate(add_months(this_month, -i)) for i in range(12)]
	if start not in months:
		months.append(start)
		months.sort(reverse=True)

	payload = {
		"available": False,
		"missing": [],
		"month": start.strftime("%Y-%m"),
		"label": start.strftime("%B %Y"),
		"from_date": cstr(start),
		"to_date": cstr(end),
		"months": [{"value": m.strftime("%Y-%m"), "label": m.strftime("%B %Y")} for m in months],
		"company": _default_company(),
		"batch_size": PAYROLL_BATCH,
		"rows": [],
		"kpis": {},
		"steps": [],
		"statutory": [],
		"departments": [],
		"activities": [],
	}
	missing = missing_payroll_doctypes()
	if missing:
		payload["missing"] = missing
		return payload
	payload["available"] = True

	emp_fields = ["name", "employee_name", "department", "designation", "status", "date_of_joining"]
	if frappe.get_meta("Employee").has_field("image"):
		emp_fields.append("image")
	slips = _payroll_slips(start, end, with_details=True)
	prev_slips = _payroll_slips(prev_start, prev_end)
	employees = frappe.get_all(
		"Employee", filters={"status": "Active"}, fields=emp_fields, order_by="employee_name asc", limit_page_length=20000
	)
	active_ids = {x.name for x in employees}
	extra = [e for e in slips if e not in active_ids]
	if extra:
		employees += frappe.get_all("Employee", filters={"name": ("in", extra)}, fields=emp_fields, limit_page_length=len(extra))
	assignments = _payroll_assignments(end)
	stat_lookup = {comp.lower(): label for label, comps in PAYROLL_STATUTORY for comp in comps}

	rows = []
	statutory = {label: {"label": label, "amount": 0.0, "employees": 0} for label, _comps in PAYROLL_STATUTORY}
	other_deductions = 0.0
	departments = {}
	joined = 0
	for e in employees:
		slip = slips.get(e.name)
		doj = getdate(e.date_of_joining) if e.date_of_joining else None
		if doj and doj > end and not slip:
			continue
		if doj and start <= doj <= end:
			joined += 1
		ssa = assignments.get(e.name)
		if slip and cint(slip.docstatus) == 1:
			status, stage = "Processed", "Payslip ready"
		elif slip:
			status, stage = "Pending", "Awaiting approval"
		elif ssa:
			status, stage = "Pending", "Not processed"
		else:
			status, stage = "On Hold", "No salary structure"

		stat_row = {}
		if slip:
			for d in slip.deductions:
				label = stat_lookup.get(cstr(d["component"]).lower())
				if label:
					stat_row[label] = stat_row.get(label, 0.0) + d["amount"]
				else:
					other_deductions += d["amount"]
			for label, amount in stat_row.items():
				statutory[label]["amount"] += amount
				statutory[label]["employees"] += 1

		department = e.department or (slip.get("department") if slip else None)
		row = {
			"id": e.name,
			"name": e.employee_name or e.name,
			"photo": e.get("image"),
			"department": department,
			"designation": e.designation or (slip.get("designation") if slip else None),
			"employee_status": e.status,
			"date_of_joining": cstr(e.date_of_joining or ""),
			"structure": ssa.salary_structure if ssa else None,
			"base": flt(ssa.base) if ssa else 0.0,
			"status": status,
			"stage": stage,
			"slip": slip.name if slip else None,
			"slip_status": slip.status if slip else None,
			"gross": flt(slip.gross_pay) if slip else None,
			"deductions": flt(slip.total_deduction) if slip else None,
			"net": flt(slip.net_pay) if slip else None,
			"payment_days": flt(slip.get("payment_days")) if slip else None,
			"working_days": flt(slip.get("total_working_days")) if slip else None,
			"posting_date": cstr(slip.get("posting_date") or "") if slip else None,
			"payroll_entry": slip.get("payroll_entry") if slip else None,
			"earnings": slip.earnings if slip else [],
			"deduction_lines": slip.deductions if slip else [],
			"statutory": stat_row,
		}
		rows.append(row)

		dep = departments.setdefault(
			department or "Unassigned",
			{"department": department or "Unassigned", "employees": 0, "processed": 0, "gross": 0.0, "deductions": 0.0, "net": 0.0},
		)
		dep["employees"] += 1
		dep["processed"] += 1 if status == "Processed" else 0
		dep["gross"] += row["gross"] or 0.0
		dep["deductions"] += row["deductions"] or 0.0
		dep["net"] += row["net"] or 0.0

	total = len(rows)
	assigned = sum(1 for r in rows if r["structure"])
	with_slip = sum(1 for r in rows if r["slip"])
	processed = sum(1 for r in rows if r["status"] == "Processed")
	drafts = with_slip - processed
	on_hold = sum(1 for r in rows if r["status"] == "On Hold")
	pending = total - processed - on_hold

	def _sum(source, field):
		return sum(flt(s.get(field)) for s in source)

	payload["rows"] = rows
	payload["kpis"] = {
		"employees": total,
		"joined": joined,
		"assigned": assigned,
		"slips": with_slip,
		"drafts": drafts,
		"processed": processed,
		"pending": pending,
		"on_hold": on_hold,
		"not_processed": sum(1 for r in rows if r["structure"] and not r["slip"]),
		"gross": _sum(slips.values(), "gross_pay"),
		"deductions": _sum(slips.values(), "total_deduction"),
		"net": _sum(slips.values(), "net_pay"),
		"prev_gross": _sum(prev_slips.values(), "gross_pay"),
		"prev_deductions": _sum(prev_slips.values(), "total_deduction"),
		"prev_net": _sum(prev_slips.values(), "net_pay"),
		"prev_label": prev_start.strftime("%B %Y"),
		"projected_gross": sum(r["base"] for r in rows if r["structure"]),
	}

	step_done = [
		total > 0 and assigned == total,
		assigned > 0 and with_slip >= assigned,
		with_slip > 0 and drafts == 0,
		assigned > 0 and processed >= assigned,
	]
	step_details = [
		f"{assigned} of {total} employees mapped",
		f"{with_slip} of {assigned} salary slips calculated",
		f"{drafts} slip(s) awaiting approval" if drafts else f"{processed} slip(s) approved",
		f"{processed} of {assigned} payslips ready",
	]
	current = next((i for i, done in enumerate(step_done) if not done), None)
	payload["steps"] = [
		{"key": key, "done": step_done[i], "current": i == current, "detail": step_details[i]}
		for i, key in enumerate(("assign", "process", "approve", "payslips"))
	]
	payload["statutory"] = list(statutory.values()) + [
		{"label": "Other deductions", "amount": other_deductions, "employees": 0}
	]
	payload["departments"] = sorted(departments.values(), key=lambda d: (-d["employees"], d["department"]))
	try:
		payload["activities"] = _payroll_activities()
	except Exception:
		frappe.log_error(title="people_payroll_activities", message=frappe.get_traceback())
	return payload


def _make_payroll_slip(employee, start, end):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import ensure_payroll_holiday_list

	existing = frappe.db.exists(
		"Salary Slip", {"employee": employee, "start_date": cstr(start), "end_date": cstr(end), "docstatus": ("<", 2)}
	)
	if existing:
		return existing, False
	ensure_payroll_holiday_list(employee=employee)
	slip = frappe.new_doc("Salary Slip")
	slip.employee = employee
	slip.start_date = start
	slip.end_date = end
	slip.posting_date = min(end, getdate(today())) if getdate(today()) >= start else start
	if slip.meta.has_field("payroll_frequency"):
		slip.payroll_frequency = "Monthly"
	slip.company = frappe.db.get_value("Employee", employee, "company") or _default_company()
	slip.flags.ignore_permissions = True
	slip.insert(ignore_permissions=True)
	return slip.name, True


def process_people_payroll(roles, month=None, employees=None):
	"""Calculate draft salary slips for a batch of employees for the payroll month."""
	_require_manager(roles)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import missing_payroll_doctypes

	if missing_payroll_doctypes():
		frappe.throw(_("Payroll is not set up on this site"))
	start, end = _payroll_period(month)
	ids = _payroll_ids(employees)
	if not ids:
		frappe.throw(_("Select at least one employee"))
	if len(ids) > PAYROLL_BATCH:
		frappe.throw(_("Process at most {0} employees per request").format(PAYROLL_BATCH))
	assignments = _payroll_assignments(end)

	created, existing, skipped, errors = [], [], [], []
	for emp in ids:
		if not frappe.db.exists("Employee", emp):
			skipped.append({"employee": emp, "reason": _("Employee not found")})
			continue
		if emp not in assignments:
			skipped.append({"employee": emp, "reason": _("No salary structure assignment")})
			continue
		try:
			name, is_new = _make_payroll_slip(emp, start, end)
			frappe.db.commit()
			(created if is_new else existing).append({"employee": emp, "slip": name})
		except Exception as exc:
			frappe.db.rollback()
			frappe.log_error(title="people_payroll_process", message=frappe.get_traceback())
			errors.append({"employee": emp, "error": _payroll_error(exc)})
	return {"month": start.strftime("%Y-%m"), "created": created, "existing": existing, "skipped": skipped, "errors": errors}


def approve_people_payroll(roles, month=None, slips=None):
	"""Submit (approve) a batch of draft salary slips belonging to the payroll month."""
	_require_manager(roles)
	start, end = _payroll_period(month)
	names = _payroll_ids(slips)
	if not names:
		frappe.throw(_("Select at least one salary slip"))
	if len(names) > PAYROLL_BATCH * 2:
		frappe.throw(_("Approve at most {0} salary slips per request").format(PAYROLL_BATCH * 2))

	approved, already, errors = [], [], []
	for name in names:
		row = frappe.db.get_value("Salary Slip", name, ["employee", "docstatus", "start_date", "end_date"], as_dict=True)
		if not row:
			errors.append({"slip": name, "error": _("Salary slip not found")})
			continue
		if cint(row.docstatus) == 1:
			already.append({"slip": name, "employee": row.employee})
			continue
		if cint(row.docstatus) != 0:
			errors.append({"slip": name, "employee": row.employee, "error": _("Salary slip is cancelled")})
			continue
		if getdate(row.start_date) < start or getdate(row.end_date) > end:
			errors.append({"slip": name, "employee": row.employee, "error": _("Salary slip belongs to another month")})
			continue
		try:
			doc = frappe.get_doc("Salary Slip", name)
			doc.flags.ignore_permissions = True
			doc.submit()
			frappe.db.commit()
			approved.append({"slip": name, "employee": row.employee})
		except Exception as exc:
			frappe.db.rollback()
			frappe.log_error(title="people_payroll_approve", message=frappe.get_traceback())
			errors.append({"slip": name, "employee": row.employee, "error": _payroll_error(exc)})
	return {"month": start.strftime("%Y-%m"), "approved": approved, "already": already, "errors": errors}


PERFORMANCE_REVIEW_DOCTYPE = "People Performance Review"
PERFORMANCE_WEIGHTS = {"hours": 30, "attendance": 30, "feedback": 40}
PERFORMANCE_TARGET = 80
PERFORMANCE_DAY_HOURS = 8
PERFORMANCE_BANDS = (
	(90, "Top Performer"),
	(85, "High Performer"),
	(80, "Good Performer"),
	(70, "Average"),
	(0, "Needs Improvement"),
)


def ensure_performance_review_doctype():
	"""Monthly manager rating (1–5) per employee; the feedback component of the performance score."""
	if frappe.db.exists("DocType", PERFORMANCE_REVIEW_DOCTYPE):
		return True
	try:
		frappe.get_doc(
			{
				"doctype": "DocType",
				"name": PERFORMANCE_REVIEW_DOCTYPE,
				"module": "Health Ecosystem Core",
				"custom": 1,
				"autoname": "hash",
				"track_changes": 1,
				"fields": [
					{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
					{
						"fieldname": "employee_name",
						"label": "Employee Name",
						"fieldtype": "Data",
						"fetch_from": "employee.employee_name",
						"read_only": 1,
						"in_list_view": 1,
					},
					{"fieldname": "period", "label": "Month", "fieldtype": "Date", "reqd": 1, "in_list_view": 1},
					{"fieldname": "rating", "label": "Rating (1-5)", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
					{"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
					{
						"fieldname": "recommendation",
						"label": "Recommendation",
						"fieldtype": "Select",
						"options": "\nPromote\nRetain\nDevelop further\nNeeds improvement\nTransfer\nNot recommended",
						"in_list_view": 1,
					},
					{"fieldname": "reviewer", "label": "Reviewer", "fieldtype": "Link", "options": "User"},
				],
				"permissions": [
					{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
					for role in ("System Manager", "HR Manager", "HR User")
				],
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()
		return True
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ensure_performance_review_doctype", message=frappe.get_traceback())
		return False


def _performance_band(score):
	if score is None:
		return "No Data"
	return next(label for floor, label in PERFORMANCE_BANDS if score >= floor)


def _performance_reviews(start, end):
	out = {}
	for r in frappe.get_all(
		PERFORMANCE_REVIEW_DOCTYPE,
		filters={"period": ("between", [cstr(start.replace(day=1)), cstr(end)])},
		fields=["employee", "period", "rating"],
		limit_page_length=50000,
	):
		out.setdefault(r.employee, []).append(flt(r.rating))
	return out


def _performance_scores(roles, start, end, with_reviews):
	"""Per-employee score: working hours vs expected (30%), attendance (30%), manager rating (40%)."""
	reg = get_people_attendance_register(roles, cstr(start), cstr(end))
	reviews = _performance_reviews(start, end) if with_reviews else {}
	rows = []
	for e in reg["employees"]:
		c = e["counts"]
		working = c["present"] + c["absent"] + c["half_day"]
		attended = c["present"] + 0.5 * c["half_day"]
		hours = e["period_minutes"] / 60.0
		ratings = reviews.get(e["id"]) or []
		rating = sum(ratings) / len(ratings) if ratings else None
		hours_score = min(100.0, hours / (working * PERFORMANCE_DAY_HOURS) * 100) if working else None
		attendance_score = min(100.0, attended / working * 100) if working else None
		feedback_score = rating / 5 * 100 if rating is not None else None
		contrib = {
			"hours": (hours_score or 0) * PERFORMANCE_WEIGHTS["hours"] / 100,
			"attendance": (attendance_score or 0) * PERFORMANCE_WEIGHTS["attendance"] / 100,
			"feedback": (feedback_score or 0) * PERFORMANCE_WEIGHTS["feedback"] / 100,
		}
		score = round(sum(contrib.values()), 1) if (working or rating is not None) else None
		rows.append(
			{
				"id": e["id"],
				"name": e["name"],
				"photo": e.get("photo"),
				"department": e.get("department"),
				"designation": e.get("designation"),
				"date_of_joining": e.get("date_of_joining"),
				"working_days": working,
				"present_days": attended,
				"leave_days": c["leave"],
				"hours": round(hours, 1),
				"expected_hours": working * PERFORMANCE_DAY_HOURS,
				"attendance_pct": round(attendance_score, 1) if attendance_score is not None else None,
				"rating": round(rating, 2) if rating is not None else None,
				"hours_score": round(hours_score, 1) if hours_score is not None else None,
				"attendance_score": round(attendance_score, 1) if attendance_score is not None else None,
				"feedback_score": round(feedback_score, 1) if feedback_score is not None else None,
				"contrib": {k: round(v, 1) for k, v in contrib.items()},
				"score": score,
				"band": _performance_band(score),
			}
		)
	return rows


def get_people_performance(roles, from_date=None, to_date=None):
	"""Manager performance board for a date range (max 92 days) with previous-period comparison."""
	_require_manager(roles)
	today_d = getdate(today())
	start = getdate(from_date) if from_date else today_d.replace(day=1)
	end = getdate(to_date) if to_date else start.replace(day=monthrange(start.year, start.month)[1])
	if start > end:
		start, end = end, start
	if (end - start).days + 1 > ATTENDANCE_MAX_DAYS:
		start = getdate(add_days(end, -(ATTENDANCE_MAX_DAYS - 1)))
	span = (end - start).days
	month_end = start.replace(day=monthrange(start.year, start.month)[1])
	if start.day == 1 and end == month_end:
		prev_start = getdate(add_months(start, -1))
		prev_end = getdate(add_days(start, -1))
	elif start.day == 1 and end < month_end:
		prev_start = getdate(add_months(start, -1))
		prev_end = min(getdate(add_days(prev_start, span)), getdate(add_days(start, -1)))
	else:
		prev_end = getdate(add_days(start, -1))
		prev_start = getdate(add_days(prev_end, -span))

	this_month = today_d.replace(day=1)
	payload = {
		"available": bool(frappe.db.exists("DocType", "Employee")),
		"feedback_available": False,
		"from_date": cstr(start),
		"to_date": cstr(end),
		"prev_from": cstr(prev_start),
		"prev_to": cstr(prev_end),
		"review_period": cstr(min(end, today_d).replace(day=1)),
		"weights": PERFORMANCE_WEIGHTS,
		"target": PERFORMANCE_TARGET,
		"day_hours": PERFORMANCE_DAY_HOURS,
		"bands": [{"min": floor, "label": label} for floor, label in PERFORMANCE_BANDS],
		"months": [
			{"value": getdate(add_months(this_month, -i)).strftime("%Y-%m"), "label": getdate(add_months(this_month, -i)).strftime("%B %Y")}
			for i in range(12)
		],
		"rows": [],
		"reviews": {},
		"kpis": {},
		"breakdown": {},
	}
	if not payload["available"]:
		return payload
	feedback = ensure_performance_review_doctype()
	payload["feedback_available"] = feedback

	rows = _performance_scores(roles, start, end, feedback)
	prev = {r["id"]: r for r in _performance_scores(roles, prev_start, prev_end, feedback)}
	scored = sorted((r for r in rows if r["score"] is not None), key=lambda r: (-r["score"], -(r["rating"] or 0), r["name"]))
	for i, r in enumerate(scored, start=1):
		r["rank"] = i
	for r in rows:
		r.setdefault("rank", None)
		r["prev_score"] = prev.get(r["id"], {}).get("score")

	prev_scored = [p["score"] for p in prev.values() if p["score"] is not None]

	def avg(values):
		return round(sum(values) / len(values), 1) if values else None

	top = scored[0] if scored else None
	payload["rows"] = rows
	payload["kpis"] = {
		"employees": len(rows),
		"prev_employees": sum(1 for r in rows if not r["date_of_joining"] or getdate(r["date_of_joining"]) <= prev_end),
		"scored": len(scored),
		"avg_score": avg([r["score"] for r in scored]),
		"prev_avg_score": avg(prev_scored),
		"above_target": sum(1 for r in scored if r["score"] >= PERFORMANCE_TARGET),
		"rated": sum(1 for r in rows if r["rating"] is not None),
		"top": {"id": top["id"], "name": top["name"], "designation": top["designation"], "score": top["score"]} if top else None,
	}
	payload["breakdown"] = {k: avg([r["contrib"][k] for r in scored]) or 0 for k in PERFORMANCE_WEIGHTS}

	if feedback:
		history_from = getdate(add_months(this_month, -11))
		review_fields = ["name", "employee", "period", "rating", "remarks", "reviewer", "modified"]
		if frappe.get_meta(PERFORMANCE_REVIEW_DOCTYPE).has_field("recommendation"):
			review_fields.append("recommendation")
		for r in frappe.get_all(
			PERFORMANCE_REVIEW_DOCTYPE,
			filters={"period": (">=", cstr(history_from))},
			fields=review_fields,
			order_by="period desc, modified desc",
			limit_page_length=50000,
		):
			payload["reviews"].setdefault(r.employee, []).append(
				{
					"name": r.name,
					"period": cstr(r.period),
					"rating": flt(r.rating),
					"remarks": r.remarks,
					"recommendation": getattr(r, "recommendation", None) or "",
					"reviewer": r.reviewer,
					"modified": cstr(r.modified),
				}
			)
	return payload


def save_people_performance_review(roles, employee, period=None, rating=None, remarks=None, recommendation=None):
	"""Create or update the manager rating for one employee and month."""
	_require_manager(roles)
	if not ensure_performance_review_doctype():
		frappe.throw(_("Performance reviews are not available on this site"))
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_my_team import ensure_recommendation_field

		ensure_recommendation_field()
	except Exception:
		pass
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Select a valid employee"))
	month = getdate(period or today()).replace(day=1)
	if month > getdate(today()).replace(day=1):
		frappe.throw(_("You cannot rate a future month"))
	value = flt(rating)
	if not 1 <= value <= 5:
		frappe.throw(_("Rating must be between 1 and 5"))
	rec = cstr(recommendation).strip() if recommendation is not None else None

	existing = frappe.db.get_value(PERFORMANCE_REVIEW_DOCTYPE, {"employee": employee, "period": cstr(month)}, "name")
	doc = frappe.get_doc(PERFORMANCE_REVIEW_DOCTYPE, existing) if existing else frappe.new_doc(PERFORMANCE_REVIEW_DOCTYPE)
	doc.employee = employee
	doc.period = month
	doc.rating = round(value, 1)
	doc.remarks = cstr(remarks).strip() or None
	doc.reviewer = frappe.session.user
	if recommendation is not None and frappe.get_meta(PERFORMANCE_REVIEW_DOCTYPE).has_field("recommendation"):
		doc.recommendation = rec or None
	doc.flags.ignore_permissions = True
	if existing:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)
	return {
		"name": doc.name,
		"employee": employee,
		"period": cstr(month),
		"rating": doc.rating,
		"recommendation": getattr(doc, "recommendation", None) or "",
		"updated": bool(existing),
	}


# --------------------------------------------------------------------------- onboarding board

ONBOARDING_STAGES = (
	("preboarding", "Pre-boarding", "Offer accepted, initial setup"),
	("documentation", "Documentation", "Collect documents & verification"),
	("access", "System Access", "IT setup, tool access"),
	("orientation", "Orientation", "Company overview & training"),
	("handover", "Manager Handover", "Team introduction"),
	("completed", "Completed", "Onboarding finished"),
)

ONBOARDING_TASK_STAGE = (
	("Collect ID", "documentation"),
	("appointment letter", "preboarding"),
	("Create ERPNext User", "access"),
	("Link Employee to User", "access"),
	("Assign leave policy", "access"),
	("hec_franchisee", "access"),
	("Issue kit", "orientation"),
	("Schedule orientation", "handover"),
	("Confirm People HRMS login", "completed"),
)

ONBOARDING_STATUSES = ("Not Started", "Pending", "In Progress", "Completed")


def _onboarding_task_stage(description):
	text = cstr(description)
	for needle, stage in ONBOARDING_TASK_STAGE:
		if needle.lower() in text.lower():
			return stage
	return "documentation"


def _onboarding_task_label(description):
	text = cstr(description)
	text = text.replace("[HEC Onboarding]", "").replace("[HEC Offboarding]", "").strip()
	if " — " in text:
		text = text.rsplit(" — ", 1)[0].strip()
	return text


def _onboarding_status(closed, total, joining, today_d):
	if total <= 0:
		if joining and getdate(joining) > today_d:
			return "Not Started"
		return "Pending"
	if closed >= total:
		return "Completed"
	if closed == 0:
		return "Pending" if joining and getdate(joining) <= today_d else "Not Started"
	return "In Progress"


def get_people_onboarding(roles, from_date=None, to_date=None):
	"""New-hire onboarding board: joiners in range plus anyone with an open checklist."""
	_require_manager(roles)
	today_d = getdate(today())
	month_start, month_end, _ = _month_bounds(today_d)
	prev_start, prev_end, _ = _month_bounds(add_months(month_start, -1))
	start = getdate(from_date) if from_date else month_start
	end = getdate(to_date) if to_date else month_end
	if end < start:
		frappe.throw(_("To date cannot be before from date"))
	if (end - start).days > 366:
		frappe.throw(_("Date range cannot exceed 12 months"))

	payload = {
		"available": bool(frappe.db.exists("DocType", "Employee")),
		"from_date": cstr(start),
		"to_date": cstr(end),
		"stages": [{"key": k, "label": lab, "hint": hint} for k, lab, hint in ONBOARDING_STAGES],
		"rows": [],
		"eligible": [],
		"kpis": {
			"new_hires": 0,
			"prev_hires": 0,
			"in_progress": 0,
			"completed": 0,
			"pending": 0,
		},
	}
	if not payload["available"]:
		return payload

	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "status", "date_of_joining", "company_email", "user_id"]
	if meta.has_field("image"):
		fields.append("image")

	emp_rows = frappe.get_all("Employee", filters={"status": "Active"}, fields=fields, limit_page_length=2000)
	todos = []
	if frappe.db.exists("DocType", "ToDo"):
		todos = frappe.get_all(
			"ToDo",
			filters={"status": ["!=", "Cancelled"], "description": ["like", "[HEC Onboarding]%"]},
			fields=["name", "description", "status", "date", "allocated_to", "reference_name", "modified"],
			limit_page_length=5000,
		)

	by_emp = {}
	for t in todos:
		by_emp.setdefault(t.reference_name, []).append(
			{
				"name": t.name,
				"label": _onboarding_task_label(t.description),
				"stage": _onboarding_task_stage(t.description),
				"status": t.status,
				"due": cstr(t.date) if t.date else None,
				"allocated_to": t.allocated_to,
				"modified": cstr(t.modified) if t.modified else None,
			}
		)

	stage_keys = [k for k, _, _ in ONBOARDING_STAGES]
	rows = []
	eligible = []
	kpi_in_progress = kpi_completed = kpi_pending = 0
	new_hires = prev_hires = 0

	for emp in emp_rows:
		joining = emp.date_of_joining
		in_range = bool(joining and start <= getdate(joining) <= end)
		tasks = by_emp.get(emp.name, [])
		if not in_range and not tasks:
			eligible.append(
				{
					"id": emp.name,
					"name": emp.employee_name or emp.name,
					"department": emp.department,
					"designation": emp.designation,
					"date_of_joining": cstr(joining) if joining else None,
					"email": emp.company_email or emp.user_id,
				}
			)
			continue
		if not in_range and tasks and all(t["status"] == "Closed" for t in tasks):
			# finished checklists outside the joining window stay off the table
			pass

		closed = sum(1 for t in tasks if t["status"] == "Closed")
		total = len(tasks)
		status = _onboarding_status(closed, total, joining, today_d)
		progress = int(round(closed / total * 100)) if total else 0
		open_stages = {t["stage"] for t in tasks if t["status"] != "Closed"}
		current = "completed" if total and closed >= total else next((k for k in stage_keys if k in open_stages), stage_keys[0] if tasks else None)
		row = {
			"id": emp.name,
			"name": emp.employee_name or emp.name,
			"photo": emp.get("image"),
			"department": emp.department,
			"designation": emp.designation,
			"email": emp.company_email or emp.user_id,
			"date_of_joining": cstr(joining) if joining else None,
			"status": status,
			"progress": progress,
			"closed": closed,
			"total": total,
			"current_stage": current,
			"tasks": tasks,
		}

		if joining and month_start <= getdate(joining) <= month_end:
			new_hires += 1
			if status == "In Progress":
				kpi_in_progress += 1
			elif status == "Completed":
				kpi_completed += 1
			else:
				kpi_pending += 1
		if joining and prev_start <= getdate(joining) <= prev_end:
			prev_hires += 1

		if in_range or (tasks and closed < total):
			rows.append(row)

	rows.sort(key=lambda r: (r["date_of_joining"] or "9999", r["name"]))
	eligible.sort(key=lambda r: (r["date_of_joining"] or "9999", r["name"]))
	payload["rows"] = rows
	payload["eligible"] = eligible[:80]
	payload["kpis"] = {
		"new_hires": new_hires,
		"prev_hires": prev_hires,
		"in_progress": kpi_in_progress,
		"completed": kpi_completed,
		"pending": kpi_pending,
	}
	return payload


# --------------------------------------------------------------------------- training & development

TRAINING_MATERIAL_DT = "People Training Material"
TRAINING_PLAN_DT = "People Training Plan"
TRAINING_ASSIGN_DT = "People Training Assignment"
TRAINING_CATEGORY_DT = "People Training Category"
TRAINING_TYPES = ("Video", "PDF", "Youtube", "Document")
TRAINING_MAT_STATUSES = ("Draft", "Published", "Archived")
TRAINING_PLAN_STATUSES = ("Draft", "Active", "Archived")
TRAINING_ASSIGN_STATUSES = ("Pending", "In Progress", "Completed")
TRAINING_APPLICABLE = ("All Employees", "Department", "Designation", "Employee")


def _ensure_custom_doctype(name, fields, autoname="hash"):
	if frappe.db.exists("DocType", name):
		return False
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": name,
			"module": "Health Ecosystem Core",
			"custom": 1,
			"autoname": autoname,
			"naming_rule": "Random",
			"engine": "InnoDB",
			"track_changes": 1,
			"fields": fields,
			"permissions": [
				{"role": role, "read": 1, "write": 1, "create": 1, "delete": 1}
				for role in ("System Manager", "HR Manager", "HR User")
			],
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def ensure_people_training_doctypes():
	created = []
	try:
		if _ensure_custom_doctype(
			TRAINING_CATEGORY_DT,
			[{"fieldname": "title", "label": "Category", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1}],
		):
			created.append(TRAINING_CATEGORY_DT)
		if _ensure_custom_doctype(
			TRAINING_MATERIAL_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "material_type", "label": "Type", "fieldtype": "Select", "options": "\n".join(TRAINING_TYPES), "default": "Video", "in_list_view": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "applicable", "label": "Applicable To", "fieldtype": "Select", "options": "\n".join(TRAINING_APPLICABLE), "default": "All Employees"},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
				{"fieldname": "designation", "label": "Designation", "fieldtype": "Data"},
				{"fieldname": "duration_min", "label": "Duration (min)", "fieldtype": "Int"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(TRAINING_MAT_STATUSES), "default": "Draft", "in_list_view": 1},
				{"fieldname": "url", "label": "Link / URL", "fieldtype": "Data"},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "legacy_ref", "label": "Legacy Training Program", "fieldtype": "Data", "read_only": 1},
			],
		):
			created.append(TRAINING_MATERIAL_DT)
		if _ensure_custom_doctype(
			TRAINING_PLAN_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(TRAINING_PLAN_STATUSES), "default": "Draft", "in_list_view": 1},
				{"fieldname": "material_ids", "label": "Materials", "fieldtype": "Small Text"},
			],
		):
			created.append(TRAINING_PLAN_DT)
		if _ensure_custom_doctype(
			TRAINING_ASSIGN_DT,
			[
				{"fieldname": "material", "label": "Material", "fieldtype": "Link", "options": TRAINING_MATERIAL_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "plan", "label": "Learning Plan", "fieldtype": "Link", "options": TRAINING_PLAN_DT},
				{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee", "reqd": 1, "in_list_view": 1},
				{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "fetch_from": "employee.employee_name", "read_only": 1, "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(TRAINING_ASSIGN_STATUSES), "default": "Pending", "in_list_view": 1},
				{"fieldname": "assigned_on", "label": "Assigned On", "fieldtype": "Date"},
				{"fieldname": "completed_on", "label": "Completed On", "fieldtype": "Date"},
				{"fieldname": "legacy_ref", "label": "Legacy Assignment", "fieldtype": "Data", "read_only": 1},
			],
		):
			created.append(TRAINING_ASSIGN_DT)
		if created:
			frappe.db.commit()
		return True
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ensure_people_training_doctypes", message=frappe.get_traceback())
		return False


def _training_file_type(files):
	joined = " ".join(cstr(f.get("file_name")) + " " + cstr(f.get("file_url")) for f in (files or [])).lower()
	if "youtu" in joined:
		return "Youtube"
	if any(ext in joined for ext in (".mp4", ".webm", ".mov", "video/")):
		return "Video"
	if ".pdf" in joined:
		return "PDF"
	if files:
		return "Document"
	return "Video"


def _import_hrms_training():
	"""Copy HRMS Training Program / Event participants into the People training desk (idempotent)."""
	if not frappe.db.exists("DocType", "Training Program"):
		return
	existing_prog = {
		r.legacy_ref: r.name
		for r in frappe.get_all(TRAINING_MATERIAL_DT, fields=["name", "legacy_ref"], limit_page_length=2000)
		if r.legacy_ref
	}
	for p in frappe.get_all("Training Program", fields=["name", "training_program", "status", "description"], limit_page_length=200):
		if p.name in existing_prog:
			continue
		files = []
		if frappe.db.exists("DocType", "File"):
			files = frappe.get_all("File", filters={"attached_to_doctype": "Training Program", "attached_to_name": p.name, "is_folder": 0}, fields=["file_name", "file_url"], limit=5)
		doc = frappe.get_doc(
			{
				"doctype": TRAINING_MATERIAL_DT,
				"title": (p.training_program or p.name)[:140],
				"material_type": _training_file_type(files),
				"category": "HRMS",
				"applicable": "All Employees",
				"status": "Published" if cstr(p.status).lower() in ("", "scheduled", "completed", "open") else "Draft",
				"description": cstr(p.description)[:500] or None,
				"url": (files[0].file_url if files else None),
				"legacy_ref": p.name,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
		existing_prog[p.name] = doc.name

	if not frappe.db.exists("DocType", "Training Event"):
		return
	existing_asn = {
		r.legacy_ref
		for r in frappe.get_all(TRAINING_ASSIGN_DT, fields=["legacy_ref"], limit_page_length=20000)
		if r.legacy_ref
	}
	events = frappe.get_all("Training Event", fields=["name", "training_program", "event_status", "start_time", "end_time"], limit_page_length=500)
	children = []
	if frappe.db.exists("DocType", "Training Event Employee"):
		children = frappe.get_all("Training Event Employee", fields=["parent", "employee", "status"], limit_page_length=10000)
	by_event = {}
	for c in children:
		by_event.setdefault(c.parent, []).append(c)
	today_d = getdate(today())
	for ev in events:
		material = existing_prog.get(ev.training_program)
		if not material:
			continue
		for child in by_event.get(ev.name, []):
			key = f"{ev.name}:{child.employee}"
			if key in existing_asn or not child.employee:
				continue
			st = cstr(child.status)
			if st.lower() in ("completed", "present"):
				status = "Completed"
			elif st.lower() in ("", "open", "absent"):
				status = "Pending"
			else:
				status = "In Progress"
			assigned = getdate(ev.start_time) if ev.start_time else today_d
			frappe.get_doc(
				{
					"doctype": TRAINING_ASSIGN_DT,
					"material": material,
					"employee": child.employee,
					"status": status,
					"assigned_on": assigned,
					"completed_on": assigned if status == "Completed" else None,
					"legacy_ref": key,
				}
			).insert(ignore_permissions=True)
			existing_asn.add(key)


def _material_row(r, assigned_counts):
	applicable = r.applicable or "All Employees"
	target = "All Employees"
	if applicable == "Department" and r.department:
		target = f"Department ({r.department})"
	elif applicable == "Designation" and r.designation:
		target = f"Position ({r.designation})"
	elif applicable == "Employee":
		target = "Individual Employees"
	return {
		"id": r.name,
		"title": r.title,
		"material_type": r.material_type or "Video",
		"category": r.category or "General",
		"applicable": applicable,
		"applicable_label": target,
		"department": r.department,
		"designation": r.designation,
		"duration_min": cint(r.duration_min) or None,
		"status": r.status or "Draft",
		"url": r.url,
		"description": r.description,
		"assigned": cint(assigned_counts.get(r.name)),
		"legacy": bool(r.legacy_ref),
		"modified": cstr(r.modified) if r.get("modified") else None,
	}


def get_people_training(roles):
	_require_manager(roles)
	ok = ensure_people_training_doctypes()
	payload = {
		"available": ok,
		"materials": [],
		"plans": [],
		"assignments": [],
		"categories": [],
		"employees": [],
		"departments": [],
		"designations": [],
		"monthly": [],
		"dept_bars": [],
		"kpis": {
			"trainings": 0,
			"new_this_month": 0,
			"learners": 0,
			"prev_learners": 0,
			"in_progress": 0,
			"completed": 0,
			"pending": 0,
		},
	}
	if not ok:
		return payload
	try:
		_import_hrms_training()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_hrms_training", message=frappe.get_traceback())

	assignments = frappe.get_all(
		TRAINING_ASSIGN_DT,
		fields=["name", "material", "plan", "employee", "employee_name", "status", "assigned_on", "completed_on"],
		limit_page_length=20000,
		order_by="modified desc",
	)
	assigned_counts = Counter(a.material for a in assignments if a.material)
	materials = frappe.get_all(
		TRAINING_MATERIAL_DT,
		fields=["name", "title", "material_type", "category", "applicable", "department", "designation", "duration_min", "status", "url", "description", "legacy_ref", "modified", "creation"],
		limit_page_length=1000,
		order_by="modified desc",
	)
	plans = frappe.get_all(
		TRAINING_PLAN_DT,
		fields=["name", "title", "description", "status", "material_ids", "modified"],
		limit_page_length=200,
		order_by="modified desc",
	)
	categories = [c.title for c in frappe.get_all(TRAINING_CATEGORY_DT, fields=["title"], order_by="title asc", limit_page_length=100)]
	for m in materials:
		if m.category and m.category not in categories:
			categories.append(m.category)
	emp_rows = []
	if frappe.db.exists("DocType", "Employee"):
		emp_rows = frappe.get_all(
			"Employee",
			filters={"status": "Active"},
			fields=["name", "employee_name", "department", "designation"],
			limit_page_length=2000,
		)
	emp_map = {e.name: e for e in emp_rows}

	payload["materials"] = [_material_row(m, assigned_counts) for m in materials]
	payload["plans"] = [
		{
			"id": p.name,
			"title": p.title,
			"description": p.description,
			"status": p.status or "Draft",
			"material_ids": [x for x in cstr(p.material_ids).split(",") if x.strip()],
			"modified": cstr(p.modified) if p.modified else None,
		}
		for p in plans
	]
	payload["assignments"] = [
		{
			"id": a.name,
			"material": a.material,
			"material_title": next((m.title for m in materials if m.name == a.material), a.material),
			"plan": a.plan,
			"employee": a.employee,
			"employee_name": a.employee_name or (emp_map.get(a.employee).employee_name if emp_map.get(a.employee) else a.employee),
			"department": (emp_map.get(a.employee).department if emp_map.get(a.employee) else None),
			"designation": (emp_map.get(a.employee).designation if emp_map.get(a.employee) else None),
			"status": a.status or "Pending",
			"assigned_on": cstr(a.assigned_on) if a.assigned_on else None,
			"completed_on": cstr(a.completed_on) if a.completed_on else None,
		}
		for a in assignments
	]
	payload["categories"] = sorted(set(categories))
	payload["employees"] = [
		{"id": e.name, "name": e.employee_name or e.name, "department": e.department, "designation": e.designation}
		for e in emp_rows
	]
	payload["departments"] = sorted({e.department for e in emp_rows if e.department})
	payload["designations"] = sorted({e.designation for e in emp_rows if e.designation})

	today_d = getdate(today())
	month_start = today_d.replace(day=1)
	prev_start = getdate(add_months(month_start, -1))
	prev_end = getdate(add_days(month_start, -1))
	learners = {a.employee for a in assignments}
	prev_learners = {a.employee for a in assignments if a.assigned_on and prev_start <= getdate(a.assigned_on) <= prev_end}
	new_this_month = sum(1 for m in materials if m.creation and getdate(m.creation) >= month_start)
	st_counts = Counter(a.status or "Pending" for a in assignments)
	payload["kpis"] = {
		"trainings": len([m for m in materials if m.status != "Archived"]),
		"new_this_month": new_this_month,
		"learners": len(learners),
		"prev_learners": len(prev_learners),
		"in_progress": cint(st_counts.get("In Progress")),
		"completed": cint(st_counts.get("Completed")),
		"pending": cint(st_counts.get("Pending")),
	}

	monthly = []
	for i in range(9, -1, -1):
		d = getdate(add_months(month_start, -i))
		key = d.strftime("%Y-%m")
		end = getdate(add_days(getdate(add_months(d, 1)), -1))
		comp = inp = pend = 0
		for a in assignments:
			on = getdate(a.assigned_on) if a.assigned_on else None
			done = getdate(a.completed_on) if a.completed_on else None
			if done and d <= done <= end:
				comp += 1
			elif on and on <= end and (a.status or "Pending") == "In Progress":
				inp += 1
			elif on and on <= end and (a.status or "Pending") == "Pending":
				pend += 1
		monthly.append({"key": key, "label": d.strftime("%b"), "completed": comp, "in_progress": inp, "pending": pend})
	payload["monthly"] = monthly

	dept_tot = Counter()
	dept_done = Counter()
	for a in assignments:
		dept = (emp_map.get(a.employee).department if emp_map.get(a.employee) else None) or "Unassigned"
		dept_tot[dept] += 1
		if a.status == "Completed":
			dept_done[dept] += 1
	payload["dept_bars"] = [
		{"name": name, "total": dept_tot[name], "completed": dept_done[name], "pct": int(round(dept_done[name] / dept_tot[name] * 100)) if dept_tot[name] else 0}
		for name in sorted(dept_tot, key=lambda n: -dept_done[n] / dept_tot[n] if dept_tot[n] else 0)
	]
	return payload


def save_people_training_material(roles, data):
	_require_manager(roles)
	if not ensure_people_training_doctypes():
		frappe.throw(_("Training desk is not available"))
	title = cstr((data or {}).get("title")).strip()
	if not title:
		frappe.throw(_("Title is required"))
	material_type = cstr((data or {}).get("material_type") or "Video")
	if material_type not in TRAINING_TYPES:
		frappe.throw(_("Invalid type"))
	status = cstr((data or {}).get("status") or "Draft")
	if status not in TRAINING_MAT_STATUSES:
		frappe.throw(_("Invalid status"))
	applicable = cstr((data or {}).get("applicable") or "All Employees")
	if applicable not in TRAINING_APPLICABLE:
		applicable = "All Employees"
	values = {
		"title": title[:140],
		"material_type": material_type,
		"category": cstr((data or {}).get("category")).strip()[:80] or "General",
		"applicable": applicable,
		"department": cstr((data or {}).get("department")).strip()[:140] or None,
		"designation": cstr((data or {}).get("designation")).strip()[:140] or None,
		"duration_min": cint((data or {}).get("duration_min")) or None,
		"status": status,
		"url": cstr((data or {}).get("url")).strip()[:200] or None,
		"description": cstr((data or {}).get("description")).strip()[:1000] or None,
	}
	name = cstr((data or {}).get("id") or (data or {}).get("name")).strip()
	if name:
		if not frappe.db.exists(TRAINING_MATERIAL_DT, name):
			frappe.throw(_("Material not found"))
		doc = frappe.get_doc(TRAINING_MATERIAL_DT, name)
		doc.update(values)
		doc.flags.ignore_permissions = True
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": TRAINING_MATERIAL_DT, **values})
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
	cat = values["category"]
	if cat and not frappe.db.exists(TRAINING_CATEGORY_DT, {"title": cat}):
		frappe.get_doc({"doctype": TRAINING_CATEGORY_DT, "title": cat}).insert(ignore_permissions=True)
	return {"id": doc.name, "title": doc.title, "status": doc.status}


def save_people_training_plan(roles, data):
	_require_manager(roles)
	if not ensure_people_training_doctypes():
		frappe.throw(_("Training desk is not available"))
	title = cstr((data or {}).get("title")).strip()
	if not title:
		frappe.throw(_("Title is required"))
	status = cstr((data or {}).get("status") or "Draft")
	if status not in TRAINING_PLAN_STATUSES:
		frappe.throw(_("Invalid status"))
	ids = (data or {}).get("material_ids") or []
	if isinstance(ids, str):
		ids = [x.strip() for x in ids.split(",") if x.strip()]
	values = {
		"title": title[:140],
		"description": cstr((data or {}).get("description")).strip()[:1000] or None,
		"status": status,
		"material_ids": ",".join(cstr(x) for x in ids if x),
	}
	name = cstr((data or {}).get("id") or (data or {}).get("name")).strip()
	if name:
		if not frappe.db.exists(TRAINING_PLAN_DT, name):
			frappe.throw(_("Learning plan not found"))
		doc = frappe.get_doc(TRAINING_PLAN_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": TRAINING_PLAN_DT, **values})
		doc.insert(ignore_permissions=True)
	return {"id": doc.name, "title": doc.title, "status": doc.status}


def save_people_training_category(roles, title):
	_require_manager(roles)
	if not ensure_people_training_doctypes():
		frappe.throw(_("Training desk is not available"))
	title = cstr(title).strip()[:80]
	if not title:
		frappe.throw(_("Category name is required"))
	existing = frappe.db.exists(TRAINING_CATEGORY_DT, {"title": title})
	if existing:
		return {"id": existing, "title": title, "existing": True}
	doc = frappe.get_doc({"doctype": TRAINING_CATEGORY_DT, "title": title})
	doc.insert(ignore_permissions=True)
	return {"id": doc.name, "title": title, "existing": False}


def assign_people_training(roles, material=None, plan=None, scope="employees", department=None, designation=None, employees=None):
	_require_manager(roles)
	if not ensure_people_training_doctypes():
		frappe.throw(_("Training desk is not available"))
	material_ids = []
	plan_name = cstr(plan).strip() or None
	if plan_name:
		if not frappe.db.exists(TRAINING_PLAN_DT, plan_name):
			frappe.throw(_("Learning plan not found"))
		raw = cstr(frappe.db.get_value(TRAINING_PLAN_DT, plan_name, "material_ids"))
		material_ids = [x for x in raw.split(",") if x.strip()]
	mat = cstr(material).strip() or None
	if mat:
		material_ids = [mat]
	material_ids = [m for m in material_ids if frappe.db.exists(TRAINING_MATERIAL_DT, m)]
	if not material_ids:
		frappe.throw(_("Select a training material or a learning plan with materials"))
	scope = cstr(scope or "employees")
	targets = []
	if scope == "all":
		targets = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name", limit_page_length=2000)
	elif scope == "department":
		if not department:
			frappe.throw(_("Department is required"))
		targets = frappe.get_all("Employee", filters={"status": "Active", "department": department}, pluck="name", limit_page_length=2000)
	elif scope == "designation":
		if not designation:
			frappe.throw(_("Position is required"))
		targets = frappe.get_all("Employee", filters={"status": "Active", "designation": designation}, pluck="name", limit_page_length=2000)
	else:
		if isinstance(employees, str):
			employees = [x.strip() for x in employees.split(",") if x.strip()]
		targets = [cstr(e) for e in (employees or []) if e]
	if not targets:
		frappe.throw(_("No employees to assign"))
	today_d = getdate(today())
	created = skipped = 0
	for emp in targets:
		if not frappe.db.exists("Employee", emp):
			continue
		for mid in material_ids:
			if frappe.db.exists(TRAINING_ASSIGN_DT, {"material": mid, "employee": emp, "status": ("!=", "Completed")}):
				skipped += 1
				continue
			frappe.get_doc(
				{
					"doctype": TRAINING_ASSIGN_DT,
					"material": mid,
					"plan": plan_name,
					"employee": emp,
					"status": "Pending",
					"assigned_on": today_d,
				}
			).insert(ignore_permissions=True)
			created += 1
	return {"created": created, "skipped": skipped, "employees": len(targets), "materials": len(material_ids)}


def update_people_training_assignment(roles, assignment, status):
	_require_manager(roles)
	if not assignment or not frappe.db.exists(TRAINING_ASSIGN_DT, assignment):
		frappe.throw(_("Assignment not found"))
	status = cstr(status)
	if status not in TRAINING_ASSIGN_STATUSES:
		frappe.throw(_("Invalid status"))
	values = {"status": status}
	if status == "Completed":
		values["completed_on"] = getdate(today())
	frappe.db.set_value(TRAINING_ASSIGN_DT, assignment, values, update_modified=True)
	return {"id": assignment, "status": status}


# --------------------------------------------------------------------------- career & growth

MANPOWER_DT = "People Manpower Request"
MANPOWER_STATUSES = ("Pending HR Review", "Approved", "Rejected")
MANPOWER_PRIORITIES = ("High", "Medium", "Low")
HIRE_JOB_DT = "HEC Hire Job"
HIRE_CAND_DT = "HEC Hire Candidate"
HIRE_POST_DT = "HEC Hire Posting"
STAFF_PLAN_DT = "HEC Staff Plan"


def ensure_people_career_doctypes():
	try:
		created = _ensure_custom_doctype(
			MANPOWER_DT,
			[
				{"fieldname": "requested_by", "label": "Requested By", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "requested_by_id", "label": "Employee", "fieldtype": "Data"},
				{"fieldname": "requested_role", "label": "Requester Role", "fieldtype": "Data", "default": "Department Manager"},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "designation", "label": "Designation", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "positions", "label": "Positions", "fieldtype": "Int", "default": 1, "in_list_view": 1},
				{"fieldname": "priority", "label": "Priority", "fieldtype": "Select", "options": "\n".join(MANPOWER_PRIORITIES), "default": "Medium"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(MANPOWER_STATUSES), "default": "Pending HR Review", "in_list_view": 1},
				{"fieldname": "request_date", "label": "Request Date", "fieldtype": "Date"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "plan_ref", "label": "Staff Plan", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "legacy_ref", "label": "Legacy Staff Plan", "fieldtype": "Data", "read_only": 1},
			],
		)
		if created:
			frappe.db.commit()
		return True
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ensure_people_career_doctypes", message=frappe.get_traceback())
		return False


def _plan_status_to_request(status):
	st = cstr(status)
	if st in ("Approved", "Published"):
		return "Approved"
	if st in ("Cancelled",):
		return "Rejected"
	return "Pending HR Review"


def _priority_from_headcount(n):
	n = cint(n)
	if n >= 5:
		return "High"
	if n >= 3:
		return "Medium"
	return "Low"


def _import_staff_plans_as_requests():
	if not frappe.db.exists("DocType", STAFF_PLAN_DT):
		return
	existing = {
		r.legacy_ref: r.name
		for r in frappe.get_all(MANPOWER_DT, fields=["name", "legacy_ref"], limit_page_length=2000)
		if r.legacy_ref
	}
	plans = frappe.get_all(
		STAFF_PLAN_DT,
		fields=["name", "title", "department", "designation", "status", "headcount", "creation", "created_by_user", "owner"],
		limit_page_length=500,
	)
	users = {}
	for p in plans:
		if p.name in existing:
			continue
		uid = p.created_by_user or p.owner
		if uid and uid not in users:
			users[uid] = frappe.db.get_value("User", uid, "full_name") or uid
		name = users.get(uid) or "HR Manager"
		frappe.get_doc(
			{
				"doctype": MANPOWER_DT,
				"requested_by": cstr(name)[:140],
				"requested_by_id": uid,
				"requested_role": "Department Manager",
				"department": p.department,
				"designation": p.designation or p.title,
				"positions": cint(p.headcount) or 1,
				"priority": _priority_from_headcount(p.headcount),
				"status": _plan_status_to_request(p.status),
				"request_date": getdate(p.creation) if p.creation else getdate(today()),
				"plan_ref": p.name,
				"legacy_ref": p.name,
			}
		).insert(ignore_permissions=True)
		existing[p.name] = p.name


def _manpower_request_row(r):
	return {
		"id": r.name,
		"requested_by": r.requested_by,
		"requested_by_id": r.requested_by_id,
		"requested_role": r.requested_role or "Department Manager",
		"department": r.department,
		"designation": r.designation,
		"positions": cint(r.positions) or 1,
		"priority": r.priority or "Medium",
		"status": r.status or "Pending HR Review",
		"request_date": cstr(r.request_date) if r.request_date else None,
		"notes": r.notes,
		"plan_ref": r.plan_ref,
	}


def get_people_career(roles):
	_require_manager(roles)
	ok = ensure_people_career_doctypes()
	payload = {
		"available": ok,
		"requests": [],
		"plans": [],
		"jobs": [],
		"portals": [],
		"postings": [],
		"departments": [],
		"designations": [],
		"employees": [],
		"dept_bars": [],
		"funnel": [],
		"kpis": {
			"total_positions": 0,
			"prev_positions": 0,
			"approved_positions": 0,
			"pending_requests": 0,
			"open_postings": 0,
			"hired_careers": 0,
			"prev_hired_careers": 0,
		},
		"careers_url": "/careers",
	}
	if not ok:
		return payload
	try:
		_import_staff_plans_as_requests()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_staff_plans_as_requests", message=frappe.get_traceback())

	requests = frappe.get_all(
		MANPOWER_DT,
		fields=["name", "requested_by", "requested_by_id", "requested_role", "department", "designation", "positions", "priority", "status", "request_date", "notes", "plan_ref", "creation"],
		limit_page_length=1000,
		order_by="request_date desc, modified desc",
	)
	payload["requests"] = [_manpower_request_row(r) for r in requests]

	plans = []
	if frappe.db.exists("DocType", STAFF_PLAN_DT):
		plans = frappe.get_all(
			STAFF_PLAN_DT,
			fields=["name", "title", "department", "designation", "status", "headcount", "job_opening", "desired_ctc", "modified"],
			limit_page_length=200,
			order_by="modified desc",
		)
	payload["plans"] = [
		{
			"id": p.name,
			"title": p.title,
			"department": p.department,
			"designation": p.designation,
			"status": p.status or "Draft",
			"headcount": cint(p.headcount) or 1,
			"job_opening": p.job_opening,
			"desired_ctc": flt(p.desired_ctc) or None,
		}
		for p in plans
	]

	jobs = []
	if frappe.db.exists("DocType", HIRE_JOB_DT):
		jobs = frappe.get_all(
			HIRE_JOB_DT,
			fields=["name", "title", "status", "department", "employment_type", "openings", "is_public", "location", "modified"],
			limit_page_length=300,
			order_by="modified desc",
		)
	cand_by_job = Counter()
	cands = []
	if frappe.db.exists("DocType", HIRE_CAND_DT):
		cands = frappe.get_all(HIRE_CAND_DT, fields=["name", "job", "stage", "source", "creation"], limit_page_length=20000)
		for c in cands:
			if c.job:
				cand_by_job[c.job] += 1
	payload["jobs"] = [
		{
			"id": j.name,
			"title": j.title,
			"status": j.status or "Draft",
			"department": j.department,
			"employment_type": j.employment_type or "Full Time",
			"openings": cint(j.openings) or 1,
			"is_public": cint(j.is_public),
			"applications": cint(cand_by_job.get(j.name)),
			"location": j.location,
		}
		for j in jobs
	]

	postings = []
	if frappe.db.exists("DocType", HIRE_POST_DT):
		postings = frappe.get_all(
			HIRE_POST_DT,
			fields=["name", "job", "portal", "status", "posted_on", "external_url"],
			limit_page_length=200,
			order_by="modified desc",
		)
	job_titles = {j.name: j.title for j in jobs}
	payload["postings"] = [
		{
			"id": p.name,
			"job": p.job,
			"job_title": job_titles.get(p.job) or p.job,
			"portal": p.portal,
			"status": p.status,
			"posted_on": cstr(p.posted_on) if p.posted_on else None,
			"external_url": p.external_url,
		}
		for p in postings
	]
	payload["portals"] = [
		{"portal": "Naukri", "employer_url": "https://recruit.naukri.com/"},
		{"portal": "WorkIndia", "employer_url": "https://www.workindia.in/employers/"},
		{"portal": "Careers", "employer_url": "/careers"},
	]

	emp_rows = []
	if frappe.db.exists("DocType", "Employee"):
		emp_rows = frappe.get_all(
			"Employee",
			filters={"status": "Active"},
			fields=["name", "employee_name", "department", "designation", "creation"],
			limit_page_length=2000,
		)
	payload["employees"] = [
		{"id": e.name, "name": e.employee_name or e.name, "department": e.department, "designation": e.designation}
		for e in emp_rows
	]
	payload["departments"] = sorted({e.department for e in emp_rows if e.department} | {r.department for r in requests if r.department} | {j.department for j in jobs if j.department})
	payload["designations"] = sorted({e.designation for e in emp_rows if e.designation} | {r.designation for r in requests if r.designation})

	emp_by_dept = Counter((e.department or "Unassigned") for e in emp_rows)
	plan_by_dept = Counter()
	for r in requests:
		if (r.status or "") != "Rejected":
			plan_by_dept[r.department or "Unassigned"] += cint(r.positions) or 1
	depts = sorted(set(emp_by_dept) | set(plan_by_dept), key=lambda d: -plan_by_dept[d])
	payload["dept_bars"] = [
		{"name": d, "planned": cint(plan_by_dept[d]), "actual": cint(emp_by_dept[d])}
		for d in depts[:8]
	]

	req_positions = sum(cint(r.positions) or 1 for r in requests if (r.status or "") != "Rejected")
	approved_pos = sum(cint(r.positions) or 1 for r in requests if r.status == "Approved")
	pending_n = sum(1 for r in requests if r.status == "Pending HR Review")
	open_jobs = [j for j in jobs if j.status == "Open"]
	open_postings = len(open_jobs)
	stage_counts = Counter(c.stage or "New" for c in cands)
	applicants = len(cands)
	interviewed = sum(stage_counts[s] for s in ("Interview", "Offer", "Hired"))
	hired = stage_counts.get("Hired", 0)
	hired_careers = sum(1 for c in cands if c.stage == "Hired" and cstr(c.source) in ("Careers", "Career Website"))
	posted_openings = sum(cint(j.openings) or 1 for j in open_jobs)

	today_d = getdate(today())
	q_start = today_d.replace(month=((today_d.month - 1) // 3) * 3 + 1, day=1)
	prev_q_start = getdate(add_months(q_start, -3))
	prev_q_end = getdate(add_days(q_start, -1))
	prev_positions = sum(1 for e in emp_rows if e.creation and getdate(e.creation) <= prev_q_end)
	prev_hired_careers = sum(
		1
		for c in cands
		if c.stage == "Hired" and cstr(c.source) in ("Careers", "Career Website") and c.creation and prev_q_start <= getdate(c.creation) <= prev_q_end
	)

	total_positions = max(req_positions, approved_pos + pending_n, len(emp_rows))
	payload["kpis"] = {
		"total_positions": total_positions or req_positions,
		"prev_positions": prev_positions,
		"approved_positions": approved_pos,
		"pending_requests": pending_n,
		"open_postings": open_postings,
		"hired_careers": hired_careers,
		"prev_hired_careers": prev_hired_careers,
	}
	payload["funnel"] = [
		{"key": "requested", "label": "Positions Requested", "value": req_positions, "color": "#38bdf8"},
		{"key": "approved", "label": "Approved", "value": approved_pos, "color": "#22c55e"},
		{"key": "posted", "label": "Job Posted", "value": posted_openings, "color": "#a855f7"},
		{"key": "applicants", "label": "Applicants", "value": applicants, "color": "#f59e0b"},
		{"key": "interviewed", "label": "Interviewed", "value": interviewed, "color": "#fb7185"},
		{"key": "hired", "label": "Hired", "value": hired, "color": "#4ade80"},
	]
	return payload


def save_people_manpower_request(roles, data):
	_require_manager(roles)
	if not ensure_people_career_doctypes():
		frappe.throw(_("Career desk is not available"))
	designation = cstr((data or {}).get("designation")).strip()
	if not designation:
		frappe.throw(_("Designation is required"))
	requested_by = cstr((data or {}).get("requested_by")).strip() or frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	priority = cstr((data or {}).get("priority") or "Medium")
	if priority not in MANPOWER_PRIORITIES:
		priority = "Medium"
	status = cstr((data or {}).get("status") or "Pending HR Review")
	if status not in MANPOWER_STATUSES:
		status = "Pending HR Review"
	values = {
		"requested_by": requested_by[:140],
		"requested_by_id": cstr((data or {}).get("requested_by_id")).strip()[:140] or None,
		"requested_role": cstr((data or {}).get("requested_role") or "Department Manager")[:80],
		"department": cstr((data or {}).get("department")).strip()[:140] or None,
		"designation": designation[:140],
		"positions": cint((data or {}).get("positions")) or 1,
		"priority": priority,
		"status": status,
		"request_date": getdate((data or {}).get("request_date") or today()),
		"notes": cstr((data or {}).get("notes")).strip()[:500] or None,
	}
	name = cstr((data or {}).get("id") or (data or {}).get("name")).strip()
	if name:
		if not frappe.db.exists(MANPOWER_DT, name):
			frappe.throw(_("Request not found"))
		doc = frappe.get_doc(MANPOWER_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": MANPOWER_DT, **values})
		doc.insert(ignore_permissions=True)
	return _manpower_request_row(doc)


def update_people_manpower_request(roles, request_id, status):
	_require_manager(roles)
	if not request_id or not frappe.db.exists(MANPOWER_DT, request_id):
		frappe.throw(_("Request not found"))
	status = cstr(status)
	if status not in MANPOWER_STATUSES:
		frappe.throw(_("Invalid status"))
	frappe.db.set_value(MANPOWER_DT, request_id, "status", status, update_modified=True)
	return {"id": request_id, "status": status}


# --------------------------------------------------------------------------- documents

DOC_FOLDER_DT = "People Document Folder"
DOC_DT = "People Document"
DOC_REQ_DT = "People Document Request"
DOC_TYPES = ("PDF", "DOC", "Video", "Image", "Other")
DOC_SCOPES = ("Employee", "Company", "Template")
DOC_STATUSES = ("Active", "Expiring Soon", "Expired", "Deleted")
DOC_REQ_STATUSES = ("Pending", "Approved", "Rejected")
DOC_APPLICABLE = ("All Employees", "Employee", "Department")
DOC_MAX_BYTES = 8 * 1024 * 1024
DEFAULT_DOC_FOLDERS = (
	("Employee Documents", None, "employee"),
	("Personal", "Employee Documents", "employee"),
	("Employment", "Employee Documents", "employee"),
	("Compensation", "Employee Documents", "employee"),
	("Performance", "Employee Documents", "employee"),
	("Training & Development", "Employee Documents", "employee"),
	("Leave & Attendance", "Employee Documents", "employee"),
	("Exit & Separation", "Employee Documents", "employee"),
	("Company Documents", None, "company"),
	("Policies", "Company Documents", "company"),
	("Forms & Templates", "Company Documents", "company"),
	("Compliance", "Company Documents", "company"),
	("Announcements", "Company Documents", "company"),
	("Others", "Company Documents", "company"),
)
DEFAULT_DOC_TEMPLATES = (
	"Offer Letter",
	"Employment Contract",
	"Experience Certificate",
	"Relieving Letter",
	"Salary Certificate",
	"NOC (No Objection Certificate)",
	"Appointment Letter",
	"Warning Letter",
	"Termination Letter",
)


def ensure_people_documents_doctypes():
	try:
		_ensure_custom_doctype(
			DOC_FOLDER_DT,
			[
				{"fieldname": "title", "label": "Folder", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "parent_folder", "label": "Parent", "fieldtype": "Data"},
				{"fieldname": "scope", "label": "Scope", "fieldtype": "Select", "options": "employee\ncompany", "default": "employee", "in_list_view": 1},
			],
		)
		_ensure_custom_doctype(
			DOC_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "file_type", "label": "Type", "fieldtype": "Select", "options": "\n".join(DOC_TYPES), "default": "PDF", "in_list_view": 1},
				{"fieldname": "folder", "label": "Folder", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "scope", "label": "Scope", "fieldtype": "Select", "options": "\n".join(DOC_SCOPES), "default": "Employee"},
				{"fieldname": "applicable", "label": "Applicable To", "fieldtype": "Select", "options": "\n".join(DOC_APPLICABLE), "default": "All Employees"},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
				{"fieldname": "employee", "label": "Employee", "fieldtype": "Data"},
				{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data"},
				{"fieldname": "expiry_date", "label": "Expiry Date", "fieldtype": "Date"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(DOC_STATUSES), "default": "Active", "in_list_view": 1},
				{"fieldname": "file_url", "label": "File", "fieldtype": "Attach"},
				{"fieldname": "uploaded_on", "label": "Upload Date", "fieldtype": "Date"},
				{"fieldname": "uploaded_by", "label": "Uploaded By", "fieldtype": "Data"},
				{"fieldname": "is_template", "label": "Template", "fieldtype": "Check", "default": 0},
				{"fieldname": "last_accessed", "label": "Last Accessed", "fieldtype": "Datetime"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		_ensure_custom_doctype(
			DOC_REQ_DT,
			[
				{"fieldname": "employee", "label": "Employee", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "title", "label": "Document", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "request_date", "label": "Request Date", "fieldtype": "Date"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(DOC_REQ_STATUSES), "default": "Pending", "in_list_view": 1},
			],
		)
		frappe.db.commit()
		return True
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ensure_people_documents_doctypes", message=frappe.get_traceback())
		return False


def _doc_file_type(filename):
	ext = (cstr(filename).rsplit(".", 1)[-1] or "").lower()
	if ext == "pdf":
		return "PDF"
	if ext in ("doc", "docx", "odt", "rtf"):
		return "DOC"
	if ext in ("mp4", "webm", "mov", "avi"):
		return "Video"
	if ext in ("jpg", "jpeg", "png", "gif", "webp"):
		return "Image"
	return "Other"


def _guess_doc_folder(title, default="Personal"):
	t = cstr(title).lower()
	if any(x in t for x in ("offer", "contract", "appointment", "joining", "employment")):
		return "Employment"
	if any(x in t for x in ("salary", "compensation", "payslip", "ctc")):
		return "Compensation"
	if any(x in t for x in ("performance", "appraisal")):
		return "Performance"
	if "training" in t:
		return "Training & Development"
	if any(x in t for x in ("leave", "attendance")):
		return "Leave & Attendance"
	if any(x in t for x in ("reliev", "exit", "separation", "experience cert")):
		return "Exit & Separation"
	if any(x in t for x in ("policy", "handbook", "conduct", "compliance")):
		return "Policies"
	if any(x in t for x in ("announce",)):
		return "Announcements"
	return default


def _doc_live_status(expiry, stored):
	if cstr(stored) == "Deleted":
		return "Deleted"
	if not expiry:
		return "Active"
	try:
		d = getdate(expiry)
	except Exception:
		return "Active"
	today_d = getdate(today())
	if d < today_d:
		return "Expired"
	if d <= getdate(add_days(today_d, 30)):
		return "Expiring Soon"
	return "Active"


def _people_doc_row(d):
	expiry = cstr(d.get("expiry_date")) if d.get("expiry_date") else None
	status = _doc_live_status(expiry, d.get("status"))
	applicable = cstr(d.get("applicable") or "All Employees")
	employee_name = d.get("employee_name")
	if applicable == "Employee" and employee_name:
		applicable_label = employee_name
	elif applicable == "Department" and d.get("department"):
		applicable_label = d.get("department")
	else:
		applicable_label = "All Employees" if applicable == "All Employees" else applicable
	uploaded = d.get("uploaded_on") or d.get("creation")
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"file_type": d.get("file_type") or "Other",
		"folder": d.get("folder"),
		"scope": d.get("scope") or "Employee",
		"applicable": applicable,
		"applicable_label": applicable_label,
		"department": d.get("department"),
		"employee": d.get("employee"),
		"employee_name": employee_name,
		"expiry_date": expiry,
		"status": status,
		"file_url": d.get("file_url"),
		"uploaded_on": cstr(uploaded)[:10] if uploaded else None,
		"uploaded_by": d.get("uploaded_by"),
		"is_template": cint(d.get("is_template")),
		"last_accessed": cstr(d.get("last_accessed")) if d.get("last_accessed") else None,
		"modified": cstr(d.get("modified")) if d.get("modified") else None,
	}


def _people_doc_req_row(r, emp_map=None):
	emp = (emp_map or {}).get(r.get("employee"))
	return {
		"id": r.get("name"),
		"employee": r.get("employee"),
		"employee_name": r.get("employee_name") or (emp.employee_name if emp else r.get("employee")),
		"employee_id": r.get("employee"),
		"photo": emp.image if emp else None,
		"title": r.get("title"),
		"request_date": cstr(r.get("request_date"))[:10] if r.get("request_date") else None,
		"status": r.get("status") or "Pending",
	}


def _seed_document_folders():
	existing = {f.title for f in frappe.get_all(DOC_FOLDER_DT, fields=["title"], limit_page_length=200)}
	created = 0
	for title, parent, scope in DEFAULT_DOC_FOLDERS:
		if title in existing:
			continue
		frappe.get_doc({"doctype": DOC_FOLDER_DT, "title": title, "parent_folder": parent, "scope": scope}).insert(ignore_permissions=True)
		existing.add(title)
		created += 1
	return created


def _seed_document_templates():
	existing = {
		d.legacy_ref or d.title
		for d in frappe.get_all(DOC_DT, fields=["title", "legacy_ref", "is_template"], filters={"is_template": 1}, limit_page_length=200)
	}
	created = 0
	uploader = frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	for title in DEFAULT_DOC_TEMPLATES:
		ref = f"tpl:{title}"
		if ref in existing or title in existing:
			continue
		frappe.get_doc(
			{
				"doctype": DOC_DT,
				"title": title,
				"file_type": "DOC",
				"folder": "Forms & Templates",
				"scope": "Template",
				"applicable": "All Employees",
				"status": "Active",
				"is_template": 1,
				"uploaded_on": today(),
				"uploaded_by": uploader,
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _import_employee_files():
	if not frappe.db.exists("DocType", "File") or not frappe.db.exists("DocType", "Employee"):
		return 0
	existing = {
		d.legacy_ref
		for d in frappe.get_all(DOC_DT, fields=["legacy_ref"], limit_page_length=5000)
		if d.legacy_ref
	}
	files = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Employee", "is_folder": 0},
		fields=["name", "file_name", "file_url", "attached_to_name", "creation"],
		limit_page_length=800,
		order_by="creation desc",
	)
	if not files:
		return 0
	emp_ids = list({f.attached_to_name for f in files if f.attached_to_name})
	emps = {
		e.name: e
		for e in frappe.get_all(
			"Employee",
			filters={"name": ["in", emp_ids[:500]]},
			fields=["name", "employee_name", "department"],
			limit_page_length=500,
		)
	}
	created = 0
	for f in files:
		ref = f"file:{f.name}"
		if ref in existing:
			continue
		fname = cstr(f.file_name)
		if fname.lower().startswith("emp-photo-"):
			continue
		if not f.file_url:
			continue
		emp = emps.get(f.attached_to_name)
		title = fname or "Employee file"
		frappe.get_doc(
			{
				"doctype": DOC_DT,
				"title": title,
				"file_type": _doc_file_type(fname),
				"folder": _guess_doc_folder(title, "Personal"),
				"scope": "Employee",
				"applicable": "Employee",
				"department": emp.department if emp else None,
				"employee": f.attached_to_name,
				"employee_name": emp.employee_name if emp else f.attached_to_name,
				"status": "Active",
				"file_url": f.file_url,
				"uploaded_on": getdate(f.creation) if f.creation else today(),
				"uploaded_by": "HR Manager",
				"is_template": 0,
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		existing.add(ref)
		created += 1
	return created


def _import_policy_documents():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import list_hr_policies

		policies = list_hr_policies() or []
	except Exception:
		policies = []
	existing = {
		d.legacy_ref
		for d in frappe.get_all(DOC_DT, fields=["legacy_ref"], limit_page_length=2000)
		if d.legacy_ref
	}
	created = 0
	uploader = frappe.get_value("User", frappe.session.user, "full_name") or "HR Manager"
	for p in policies:
		slug = cstr(p.get("slug") or p.get("name"))
		ref = f"policy:{slug}"
		if ref in existing:
			continue
		title = cstr(p.get("name") or slug)
		frappe.get_doc(
			{
				"doctype": DOC_DT,
				"title": f"{title}.pdf" if not title.lower().endswith(".pdf") else title,
				"file_type": "PDF",
				"folder": "Policies",
				"scope": "Company",
				"applicable": "All Employees",
				"department": None,
				"status": "Active",
				"uploaded_on": today(),
				"uploaded_by": uploader,
				"is_template": 0,
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _folder_counts(docs, folders):
	by_title = Counter()
	for d in docs:
		if d.get("status") == "Deleted":
			continue
		if d.get("is_template"):
			if d.get("folder"):
				by_title[d.get("folder")] += 1
			continue
		if d.get("folder"):
			by_title[d.get("folder")] += 1
	children = {}
	for f in folders:
		parent = f.parent_folder
		if parent:
			children.setdefault(parent, []).append(f.title)
	out = []
	live = [d for d in docs if d.get("status") != "Deleted" and not d.get("is_template")]
	out.append({"id": "all", "title": "All Documents", "parent": None, "scope": "all", "count": len(live)})
	for f in folders:
		n = by_title.get(f.title, 0)
		for child in children.get(f.title, []):
			n += by_title.get(child, 0)
		out.append({"id": f.name, "title": f.title, "parent": f.parent_folder, "scope": f.scope, "count": n})
	return out


def get_people_documents(roles):
	_require_manager(roles)
	ok = ensure_people_documents_doctypes()
	payload = {
		"available": ok,
		"folders": [],
		"documents": [],
		"templates": [],
		"requests": [],
		"recent": [],
		"access_log": [],
		"departments": [],
		"employees": [],
		"kpis": {
			"total": 0,
			"prev_total": 0,
			"employee": 0,
			"company": 0,
			"expiring_soon": 0,
			"expired": 0,
		},
	}
	if not ok:
		return payload
	try:
		_seed_document_folders()
		_seed_document_templates()
		_import_employee_files()
		_import_policy_documents()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_documents", message=frappe.get_traceback())

	folders = frappe.get_all(DOC_FOLDER_DT, fields=["name", "title", "parent_folder", "scope"], limit_page_length=200, order_by="creation asc")
	raw_docs = frappe.get_all(
		DOC_DT,
		fields=[
			"name",
			"title",
			"file_type",
			"folder",
			"scope",
			"applicable",
			"department",
			"employee",
			"employee_name",
			"expiry_date",
			"status",
			"file_url",
			"uploaded_on",
			"uploaded_by",
			"is_template",
			"last_accessed",
			"legacy_ref",
			"creation",
			"modified",
		],
		limit_page_length=2000,
		order_by="uploaded_on desc, modified desc",
	)
	docs = [_people_doc_row(d) for d in raw_docs]
	payload["documents"] = docs
	payload["templates"] = [d for d in docs if d.get("is_template") and d.get("status") != "Deleted"]
	payload["folders"] = _folder_counts(docs, folders)

	emp_rows = []
	if frappe.db.exists("DocType", "Employee"):
		emp_rows = frappe.get_all(
			"Employee",
			filters={"status": "Active"},
			fields=["name", "employee_name", "department", "designation", "image"],
			limit_page_length=2000,
		)
	emp_map = {e.name: e for e in emp_rows}
	payload["employees"] = [
		{"id": e.name, "name": e.employee_name or e.name, "department": e.department, "designation": e.designation, "photo": e.image}
		for e in emp_rows
	]
	payload["departments"] = sorted({e.department for e in emp_rows if e.department} | {d.get("department") for d in docs if d.get("department")})

	reqs = frappe.get_all(
		DOC_REQ_DT,
		fields=["name", "employee", "employee_name", "title", "request_date", "status", "modified"],
		limit_page_length=200,
		order_by="request_date desc, modified desc",
	)
	payload["requests"] = [_people_doc_req_row(r, emp_map) for r in reqs]

	live = [d for d in docs if d.get("status") != "Deleted" and not d.get("is_template")]
	recent_src = sorted(
		[d for d in live if d.get("last_accessed") or d.get("modified")],
		key=lambda d: d.get("last_accessed") or d.get("modified") or "",
		reverse=True,
	)
	payload["recent"] = recent_src[:8]
	payload["access_log"] = [
		{
			"id": d["id"],
			"title": d["title"],
			"actor": d.get("uploaded_by") or "HR Manager",
			"accessed_on": d.get("last_accessed") or d.get("modified"),
			"file_url": d.get("file_url"),
		}
		for d in recent_src[:20]
	]

	today_d = getdate(today())
	month_start = today_d.replace(day=1)
	prev_start = getdate(add_months(month_start, -1))
	prev_end = getdate(add_days(month_start, -1))
	employee_n = sum(1 for d in live if d.get("scope") == "Employee")
	company_n = sum(1 for d in live if d.get("scope") == "Company")
	expiring = sum(1 for d in live if d.get("status") == "Expiring Soon")
	expired = sum(1 for d in live if d.get("status") == "Expired")
	prev_total = sum(1 for d in live if d.get("uploaded_on") and getdate(d["uploaded_on"]) < month_start)
	this_month = sum(1 for d in live if d.get("uploaded_on") and getdate(d["uploaded_on"]) >= month_start)
	last_month = sum(
		1 for d in live if d.get("uploaded_on") and prev_start <= getdate(d["uploaded_on"]) <= prev_end
	)
	payload["kpis"] = {
		"total": len(live),
		"prev_total": prev_total,
		"this_month": this_month,
		"last_month": last_month,
		"employee": employee_n,
		"company": company_n,
		"expiring_soon": expiring,
		"expired": expired,
	}
	return payload


def save_people_document_folder(roles, data):
	_require_manager(roles)
	if not ensure_people_documents_doctypes():
		frappe.throw(_("Documents desk is not available"))
	title = cstr((data or {}).get("title")).strip()
	if not title:
		frappe.throw(_("Folder name is required"))
	parent = cstr((data or {}).get("parent") or (data or {}).get("parent_folder")).strip() or None
	scope = cstr((data or {}).get("scope") or "employee").lower()
	if scope not in ("employee", "company"):
		scope = "employee"
	if frappe.db.exists(DOC_FOLDER_DT, {"title": title}):
		frappe.throw(_("A folder with this name already exists"))
	doc = frappe.get_doc({"doctype": DOC_FOLDER_DT, "title": title[:140], "parent_folder": parent, "scope": scope})
	doc.insert(ignore_permissions=True)
	return {"id": doc.name, "title": doc.title, "parent": doc.parent_folder, "scope": doc.scope, "count": 0}


def save_people_document(roles, data, file_name=None, file_data=None):
	_require_manager(roles)
	if not ensure_people_documents_doctypes():
		frappe.throw(_("Documents desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	is_template = 1 if cint(data.get("is_template")) else 0
	if not title:
		if file_name:
			title = cstr(file_name).strip()
		elif is_template:
			frappe.throw(_("Template name is required"))
		else:
			frappe.throw(_("Document name is required"))
	file_type = cstr(data.get("file_type") or _doc_file_type(file_name or title))
	if file_type not in DOC_TYPES:
		file_type = "Other"
	scope = cstr(data.get("scope") or ("Template" if is_template else "Employee"))
	if scope not in DOC_SCOPES:
		scope = "Employee"
	applicable = cstr(data.get("applicable") or "All Employees")
	if applicable not in DOC_APPLICABLE:
		applicable = "All Employees"
	folder = cstr(data.get("folder")).strip() or ("Forms & Templates" if is_template else "Personal")
	employee = cstr(data.get("employee")).strip() or None
	employee_name = cstr(data.get("employee_name")).strip() or None
	department = cstr(data.get("department")).strip() or None
	if employee and frappe.db.exists("DocType", "Employee") and frappe.db.exists("Employee", employee):
		emp = frappe.get_value("Employee", employee, ["employee_name", "department"], as_dict=True)
		if emp:
			employee_name = employee_name or emp.employee_name
			department = department or emp.department
		if applicable == "All Employees" and not is_template:
			applicable = "Employee"
	uploader = frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	values = {
		"title": title[:180],
		"file_type": file_type,
		"folder": folder[:140],
		"scope": scope,
		"applicable": applicable,
		"department": department,
		"employee": employee,
		"employee_name": employee_name,
		"expiry_date": getdate(data.get("expiry_date")) if data.get("expiry_date") else None,
		"status": "Active",
		"uploaded_on": getdate(data.get("uploaded_on") or today()),
		"uploaded_by": cstr(data.get("uploaded_by") or uploader)[:140],
		"is_template": is_template,
	}
	name = cstr(data.get("id") or data.get("name")).strip()
	if name:
		if not frappe.db.exists(DOC_DT, name):
			frappe.throw(_("Document not found"))
		doc = frappe.get_doc(DOC_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": DOC_DT, **values})
		doc.insert(ignore_permissions=True)

	if file_name and file_data:
		import base64

		raw = str(file_data)
		if raw.startswith("data:") and "," in raw:
			raw = raw.split(",", 1)[1]
		try:
			content = base64.b64decode(raw)
		except Exception:
			frappe.throw(_("Invalid file data"))
		if len(content) > DOC_MAX_BYTES:
			frappe.throw(_("File must be 8 MB or less"))
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": cstr(file_name)[:140],
				"content": content,
				"is_private": 1,
				"attached_to_doctype": DOC_DT,
				"attached_to_name": doc.name,
			}
		)
		file_doc.insert(ignore_permissions=True)
		doc.file_url = file_doc.file_url
		if not data.get("file_type"):
			doc.file_type = _doc_file_type(file_name)
		doc.save(ignore_permissions=True)
	return _people_doc_row(doc)


def update_people_document(roles, document, status=None, touch=None):
	_require_manager(roles)
	if not document or not frappe.db.exists(DOC_DT, document):
		frappe.throw(_("Document not found"))
	values = {}
	if touch:
		values["last_accessed"] = now_datetime()
	if status:
		status = cstr(status)
		if status not in DOC_STATUSES:
			frappe.throw(_("Invalid status"))
		values["status"] = status
	if not values:
		frappe.throw(_("Nothing to update"))
	frappe.db.set_value(DOC_DT, document, values, update_modified=True)
	doc = frappe.get_doc(DOC_DT, document)
	return _people_doc_row(doc)


def generate_people_letter(roles, template, employee):
	_require_manager(roles)
	if not ensure_people_documents_doctypes():
		frappe.throw(_("Documents desk is not available"))
	template = cstr(template).strip()
	employee = cstr(employee).strip()
	if not template or not employee:
		frappe.throw(_("Template and employee are required"))
	emp_name = employee
	dept = None
	if frappe.db.exists("DocType", "Employee") and frappe.db.exists("Employee", employee):
		row = frappe.get_value("Employee", employee, ["employee_name", "department"], as_dict=True)
		if row:
			emp_name = row.employee_name or employee
			dept = row.department
	tpl_title = template
	if frappe.db.exists(DOC_DT, template):
		tpl_title = frappe.db.get_value(DOC_DT, template, "title") or template
	return save_people_document(
		roles,
		{
			"title": f"{emp_name} - {tpl_title}.pdf",
			"file_type": "PDF",
			"folder": "Employment",
			"scope": "Employee",
			"applicable": "Employee",
			"employee": employee,
			"employee_name": emp_name,
			"department": dept,
		},
	)


def save_people_document_request(roles, data):
	_require_manager(roles)
	if not ensure_people_documents_doctypes():
		frappe.throw(_("Documents desk is not available"))
	employee = cstr((data or {}).get("employee")).strip()
	title = cstr((data or {}).get("title")).strip()
	if not employee or not title:
		frappe.throw(_("Employee and document type are required"))
	employee_name = cstr((data or {}).get("employee_name")).strip() or None
	if frappe.db.exists("DocType", "Employee") and frappe.db.exists("Employee", employee):
		employee_name = employee_name or frappe.db.get_value("Employee", employee, "employee_name")
	doc = frappe.get_doc(
		{
			"doctype": DOC_REQ_DT,
			"employee": employee,
			"employee_name": employee_name,
			"title": title[:180],
			"request_date": getdate((data or {}).get("request_date") or today()),
			"status": "Pending",
		}
	)
	doc.insert(ignore_permissions=True)
	emp = None
	if frappe.db.exists("DocType", "Employee") and frappe.db.exists("Employee", employee):
		emp = frappe.get_value("Employee", employee, ["employee_name", "image"], as_dict=True)
	return _people_doc_req_row(doc, {employee: emp} if emp else None)


def update_people_document_request(roles, request_id, status):
	_require_manager(roles)
	if not request_id or not frappe.db.exists(DOC_REQ_DT, request_id):
		frappe.throw(_("Request not found"))
	status = cstr(status)
	if status not in DOC_REQ_STATUSES:
		frappe.throw(_("Invalid status"))
	frappe.db.set_value(DOC_REQ_DT, request_id, "status", status, update_modified=True)
	return {"id": request_id, "status": status}


# --------------------------------------------------------------------------- HR policies

POLICY_CAT_DT = "People Policy Category"
POLICY_DT = "People Policy"
POLICY_STATUSES = ("Published", "Draft", "Archived")
DEFAULT_POLICY_CATEGORIES = (
	"General",
	"Human Resources",
	"Leave & Attendance",
	"Payroll & Benefits",
	"Performance",
	"Code of Conduct",
	"Health & Safety",
	"IT & Security",
)
POLICY_SNIPPET_META = {
	"field-force-conduct": {
		"category": "Code of Conduct",
		"version": "v2.0",
		"updated_on": "2026-10-05",
		"applicable": "Field Staff,Franchisees,B2B Partners",
		"views": 1240,
		"related": [
			{"title": "Field Reporting Format.docx", "file_type": "DOC"},
			{"title": "Travel & Allowance Rules.pdf", "file_type": "PDF"},
			{"title": "Call Average Guidelines.pdf", "file_type": "PDF"},
		],
	},
	"leave-attendance": {
		"category": "Leave & Attendance",
		"version": "v1.4",
		"updated_on": "2026-09-12",
		"applicable": "All Employees",
		"views": 980,
		"related": [],
	},
	"sales-incentive": {
		"category": "Payroll & Benefits",
		"version": "v1.2",
		"updated_on": "2026-08-28",
		"applicable": "Field Staff,Franchisees",
		"views": 410,
		"related": [],
	},
	"franchisee-supervision": {
		"category": "Human Resources",
		"version": "v1.1",
		"updated_on": "2026-08-20",
		"applicable": "Franchisees",
		"views": 220,
		"related": [],
	},
	"daily-allowance-slabs": {
		"category": "Payroll & Benefits",
		"version": "v1.3",
		"updated_on": "2026-07-15",
		"applicable": "Field Staff",
		"views": 540,
		"related": [],
	},
	"salary-architecture": {
		"category": "Payroll & Benefits",
		"version": "v1.0",
		"updated_on": "2026-07-02",
		"applicable": "All Employees",
		"views": 360,
		"related": [],
	},
}
EXTRA_POLICIES = (
	{
		"title": "IT Security Policy",
		"slug": "it-security",
		"category": "IT & Security",
		"version": "v1.2",
		"updated_on": "2026-06-25",
		"status": "Published",
		"applicable": "All Employees",
		"views": 640,
		"body": """# IT Security Policy

Protect company systems, patient data, and lab records. Use only approved devices and accounts for work.

## Key Points
- Do not share passwords or OTP codes.
- Lock your screen when you leave a workstation.
- Report lost devices and suspicious mail to IT the same day.
- Store reports and patient files only on approved systems.
""",
	},
	{
		"title": "Health & Safety Guidelines",
		"slug": "health-safety",
		"category": "Health & Safety",
		"version": "v1.0",
		"updated_on": "2026-06-10",
		"status": "Published",
		"applicable": "All Employees",
		"views": 756,
		"body": """# Health & Safety Guidelines

Follow lab biosafety and workplace safety rules at every centre.

## Key Points
- Wear prescribed PPE in collection and processing areas.
- Report incidents and near-misses immediately.
- Keep emergency exits and spill kits unobstructed.
- Follow needle-stick and biomedical waste SOPs.
""",
	},
	{
		"title": "Grievance Redressal Policy",
		"slug": "grievance-redressal",
		"category": "Human Resources",
		"version": "v1.2",
		"updated_on": "2026-06-05",
		"status": "Published",
		"applicable": "All Employees",
		"views": 190,
		"body": """# Grievance Redressal Policy

Raise workplace concerns through HR without fear of retaliation.

## Key Points
- Write to your manager or HR within a reasonable time.
- HR acknowledges complaints and records the case.
- Investigations stay confidential to the extent possible.
- Outcomes are communicated in writing.
""",
	},
	{
		"title": "Anti-Harassment Policy",
		"slug": "anti-harassment",
		"category": "Code of Conduct",
		"version": "v1.5",
		"updated_on": "2026-06-01",
		"status": "Published",
		"applicable": "All Employees,Franchisees",
		"views": 510,
		"body": """# Anti-Harassment Policy

Harassment, bullying, and sexual harassment are misconduct.

## Key Points
- Treat colleagues, franchise staff, and visitors with respect.
- Report incidents to HR or the Internal Committee.
- Retaliation against a complainant is itself misconduct.
- Confirmed cases may lead to disciplinary action including exit.
""",
	},
	{
		"title": "Performance Improvement Plan Policy",
		"slug": "pip-policy",
		"category": "Performance",
		"version": "v0.9",
		"updated_on": "2026-09-20",
		"status": "Draft",
		"applicable": "All Employees",
		"views": 12,
		"body": """# Performance Improvement Plan Policy

Draft — managers may place an employee on a time-bound improvement plan after documented counselling.
""",
	},
	{
		"title": "Overtime Compensation Policy",
		"slug": "overtime-compensation",
		"category": "Payroll & Benefits",
		"version": "v0.8",
		"updated_on": "2026-09-01",
		"status": "Draft",
		"applicable": "All Employees",
		"views": 8,
		"body": """# Overtime Compensation Policy

Draft — overtime is exceptional and paid only when pre-approved by the reporting manager and Ops.
""",
	},
	{
		"title": "Legacy Uniform Code",
		"slug": "legacy-uniform",
		"category": "General",
		"version": "v1.0",
		"updated_on": "2025-03-01",
		"status": "Archived",
		"applicable": "All Employees",
		"views": 40,
		"body": """# Legacy Uniform Code

Archived — replaced by the current workplace appearance guidelines.
""",
	},
	{
		"title": "Former Vehicle Policy",
		"slug": "former-vehicle",
		"category": "General",
		"version": "v1.0",
		"updated_on": "2025-01-12",
		"status": "Archived",
		"applicable": "Field Staff",
		"views": 22,
		"body": """# Former Vehicle Policy

Archived — vehicle support is now covered under travel and DA rules.
""",
	},
)


def ensure_people_policy_doctypes():
	try:
		_ensure_custom_doctype(
			POLICY_CAT_DT,
			[
				{"fieldname": "title", "label": "Category", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
			],
		)
		_ensure_custom_doctype(
			POLICY_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "slug", "label": "Slug", "fieldtype": "Data", "unique": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "version", "label": "Version", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(POLICY_STATUSES), "default": "Published", "in_list_view": 1},
				{"fieldname": "body", "label": "Body", "fieldtype": "Long Text"},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "key_points", "label": "Key Points", "fieldtype": "Small Text"},
				{"fieldname": "applicable", "label": "Applicable To", "fieldtype": "Small Text"},
				{"fieldname": "related_docs", "label": "Related Documents", "fieldtype": "Long Text"},
				{"fieldname": "versions", "label": "Version History", "fieldtype": "Long Text"},
				{"fieldname": "views", "label": "Views", "fieldtype": "Int", "default": 0},
				{"fieldname": "updated_on", "label": "Last Updated", "fieldtype": "Date"},
				{"fieldname": "updated_by", "label": "Updated By", "fieldtype": "Data"},
				{"fieldname": "file_url", "label": "File", "fieldtype": "Attach"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		frappe.db.commit()
		return True
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ensure_people_policy_doctypes", message=frappe.get_traceback())
		return False


def _json_list(val):
	if isinstance(val, list):
		return val
	s = cstr(val).strip()
	if not s:
		return []
	try:
		parsed = frappe.parse_json(s)
		return parsed if isinstance(parsed, list) else []
	except Exception:
		return [x.strip() for x in s.split(",") if x.strip()]


def _parse_policy_body(body):
	desc_parts = []
	points = []
	for ln in cstr(body).splitlines():
		s = ln.strip()
		if not s or s.startswith("#") or s.startswith("|") or s.startswith("---"):
			continue
		if s.startswith("- ") or s.startswith("* "):
			points.append(s[2:].replace("**", "").strip())
			continue
		if len(desc_parts) < 2:
			desc_parts.append(s.replace("**", ""))
	return " ".join(desc_parts)[:420], points[:8]


def _policy_row(d):
	body = cstr(d.get("body"))
	desc = cstr(d.get("description")).strip()
	points = _json_list(d.get("key_points"))
	if not desc or not points:
		parsed_desc, parsed_pts = _parse_policy_body(body)
		desc = desc or parsed_desc
		points = points or parsed_pts
	applicable = [x.strip() for x in cstr(d.get("applicable")).split(",") if x.strip()]
	updated = d.get("updated_on") or d.get("modified") or d.get("creation")
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"slug": d.get("slug"),
		"category": d.get("category") or "General",
		"version": d.get("version") or "v1.0",
		"status": d.get("status") or "Published",
		"body": body,
		"description": desc,
		"key_points": points,
		"applicable": applicable,
		"related_docs": _json_list(d.get("related_docs")),
		"versions": _json_list(d.get("versions")),
		"views": cint(d.get("views")),
		"updated_on": cstr(updated)[:10] if updated else None,
		"updated_by": d.get("updated_by") or "HR Manager",
		"file_url": d.get("file_url"),
		"modified": cstr(d.get("modified")) if d.get("modified") else None,
	}


def _seed_policy_categories():
	existing = {c.title for c in frappe.get_all(POLICY_CAT_DT, fields=["title"], limit_page_length=50)}
	created = 0
	for title in DEFAULT_POLICY_CATEGORIES:
		if title in existing:
			continue
		frappe.get_doc({"doctype": POLICY_CAT_DT, "title": title}).insert(ignore_permissions=True)
		created += 1
	return created


def _upsert_seed_policy(title, slug, category, version, updated_on, status, applicable, views, body, related=None, legacy_ref=None):
	ref = legacy_ref or f"pol:{slug}"
	if frappe.db.exists(POLICY_DT, {"legacy_ref": ref}) or frappe.db.exists(POLICY_DT, {"slug": slug}):
		return False
	desc, points = _parse_policy_body(body)
	uploader = "HR Manager"
	versions = [{"version": version, "updated_on": updated_on, "updated_by": uploader, "current": 1}]
	frappe.get_doc(
		{
			"doctype": POLICY_DT,
			"title": title[:180],
			"slug": slug[:140],
			"category": category,
			"version": version,
			"status": status if status in POLICY_STATUSES else "Published",
			"body": body,
			"description": desc,
			"key_points": frappe.as_json(points),
			"applicable": applicable,
			"related_docs": frappe.as_json(related or []),
			"versions": frappe.as_json(versions),
			"views": cint(views),
			"updated_on": getdate(updated_on) if updated_on else today(),
			"updated_by": uploader,
			"legacy_ref": ref,
		}
	).insert(ignore_permissions=True)
	return True


def _import_policy_snippets():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import list_hr_policies

		snippets = list_hr_policies() or []
	except Exception:
		snippets = []
	created = 0
	for p in snippets:
		slug = cstr(p.get("slug"))
		meta = POLICY_SNIPPET_META.get(slug) or {
			"category": "General",
			"version": "v1.0",
			"updated_on": today(),
			"applicable": "All Employees",
			"views": 0,
			"related": [],
		}
		if _upsert_seed_policy(
			cstr(p.get("name") or slug),
			slug,
			meta["category"],
			meta["version"],
			meta["updated_on"],
			"Published",
			meta["applicable"],
			meta.get("views") or 0,
			cstr(p.get("body")),
			meta.get("related") or [],
			f"snippet:{slug}",
		):
			created += 1
	for extra in EXTRA_POLICIES:
		if _upsert_seed_policy(
			extra["title"],
			extra["slug"],
			extra["category"],
			extra["version"],
			extra["updated_on"],
			extra["status"],
			extra["applicable"],
			extra["views"],
			extra["body"],
			[],
			f"extra:{extra['slug']}",
		):
			created += 1
	return created


def get_people_policies(roles):
	ok = ensure_people_policy_doctypes()
	manager = is_people_manager(roles)
	payload = {
		"available": ok,
		"is_manager": manager,
		"categories": [],
		"policies": [],
		"recent": [],
		"popular": [],
		"kpis": {"total": 0, "published": 0, "draft": 0, "archived": 0},
	}
	if not ok:
		return payload
	try:
		_seed_policy_categories()
		_import_policy_snippets()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_policies", message=frappe.get_traceback())

	cats = frappe.get_all(POLICY_CAT_DT, fields=["name", "title"], limit_page_length=50, order_by="creation asc")
	raw = frappe.get_all(
		POLICY_DT,
		fields=[
			"name",
			"title",
			"slug",
			"category",
			"version",
			"status",
			"body",
			"description",
			"key_points",
			"applicable",
			"related_docs",
			"versions",
			"views",
			"updated_on",
			"updated_by",
			"file_url",
			"creation",
			"modified",
		],
		limit_page_length=500,
		order_by="updated_on desc, modified desc",
	)
	rows = [_policy_row(d) for d in raw]
	if not manager:
		rows = [r for r in rows if r.get("status") == "Published"]
	payload["policies"] = rows
	counts = Counter((r.get("category") or "General") for r in rows)
	payload["categories"] = [{"id": "all", "title": "All Policies", "count": len(rows)}] + [
		{"id": c.name, "title": c.title, "count": cint(counts.get(c.title))}
		for c in cats
	]
	st = Counter(r.get("status") or "Published" for r in rows)
	payload["kpis"] = {
		"total": len(rows),
		"published": cint(st.get("Published")),
		"draft": cint(st.get("Draft")),
		"archived": cint(st.get("Archived")),
	}
	payload["recent"] = sorted(rows, key=lambda r: r.get("updated_on") or "", reverse=True)[:4]
	payload["popular"] = sorted([r for r in rows if r.get("status") == "Published"], key=lambda r: r.get("views") or 0, reverse=True)[:4]
	return payload


def save_people_policy_category(roles, data):
	_require_manager(roles)
	if not ensure_people_policy_doctypes():
		frappe.throw(_("Policies desk is not available"))
	title = cstr((data or {}).get("title")).strip()
	if not title:
		frappe.throw(_("Category name is required"))
	if frappe.db.exists(POLICY_CAT_DT, {"title": title}):
		frappe.throw(_("A category with this name already exists"))
	doc = frappe.get_doc({"doctype": POLICY_CAT_DT, "title": title[:140]})
	doc.insert(ignore_permissions=True)
	return {"id": doc.name, "title": doc.title, "count": 0}


def save_people_policy(roles, data):
	_require_manager(roles)
	if not ensure_people_policy_doctypes():
		frappe.throw(_("Policies desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Policy title is required"))
	status = cstr(data.get("status") or "Draft")
	if status not in POLICY_STATUSES:
		status = "Draft"
	slug = cstr(data.get("slug")).strip() or frappe.scrub(title)
	version = cstr(data.get("version") or "v1.0").strip() or "v1.0"
	body = cstr(data.get("body"))
	desc = cstr(data.get("description")).strip()
	points = data.get("key_points")
	if isinstance(points, str):
		points = [x.strip() for x in points.split("\n") if x.strip()]
	points = points if isinstance(points, list) else []
	if not desc or not points:
		parsed_desc, parsed_pts = _parse_policy_body(body)
		desc = desc or parsed_desc
		points = points or parsed_pts
	applicable = data.get("applicable")
	if isinstance(applicable, list):
		applicable = ",".join(applicable)
	uploader = frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	related = data.get("related_docs") if isinstance(data.get("related_docs"), list) else _json_list(data.get("related_docs"))
	values = {
		"title": title[:180],
		"slug": slug[:140],
		"category": cstr(data.get("category") or "General")[:140],
		"version": version[:20],
		"status": status,
		"body": body,
		"description": desc,
		"key_points": frappe.as_json(points),
		"applicable": cstr(applicable)[:200],
		"related_docs": frappe.as_json(related),
		"updated_on": getdate(data.get("updated_on") or today()),
		"updated_by": uploader[:140],
	}
	name = cstr(data.get("id") or data.get("name")).strip()
	if name:
		if not frappe.db.exists(POLICY_DT, name):
			frappe.throw(_("Policy not found"))
		doc = frappe.get_doc(POLICY_DT, name)
		history = _json_list(doc.versions)
		if cstr(doc.version) != version:
			for h in history:
				if isinstance(h, dict):
					h["current"] = 0
			history.append({"version": version, "updated_on": cstr(today()), "updated_by": uploader, "current": 1})
		values["versions"] = frappe.as_json(history)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		values["versions"] = frappe.as_json([{"version": version, "updated_on": cstr(today()), "updated_by": uploader, "current": 1}])
		values["views"] = 0
		doc = frappe.get_doc({"doctype": POLICY_DT, **values})
		doc.insert(ignore_permissions=True)
	return _policy_row(doc)


def update_people_policy(roles, policy, status=None, touch=None):
	if not policy or not frappe.db.exists(POLICY_DT, policy):
		frappe.throw(_("Policy not found"))
	values = {}
	if touch:
		current = cint(frappe.db.get_value(POLICY_DT, policy, "views"))
		values["views"] = current + 1
	if status:
		_require_manager(roles)
		status = cstr(status)
		if status not in POLICY_STATUSES:
			frappe.throw(_("Invalid status"))
		values["status"] = status
	if not values:
		frappe.throw(_("Nothing to update"))
	if not touch:
		_require_manager(roles)
	frappe.db.set_value(POLICY_DT, policy, values, update_modified=bool(status))
	doc = frappe.get_doc(POLICY_DT, policy)
	return _policy_row(doc)


# --------------------------------------------------------------------------- HR assets

ASSET_CAT_DT = "People Asset Category"
ASSET_DT = "People Asset"
ASSET_REQ_DT = "People Asset Request"
ASSET_ACT_DT = "People Asset Activity"
ASSET_STATUSES = ("Assigned", "Available", "In Repair", "Retired")
ASSET_REQ_STATUSES = ("Pending", "Approved", "Rejected")
DEFAULT_ASSET_CATEGORIES = (
	"Laptop",
	"Mobile",
	"Monitor",
	"Accessory",
	"Office Equipment",
	"Vehicle",
	"Furniture",
	"Other",
)
LOCATION_DEPT = {
	"Head Office": "HR",
	"Marketing": "Marketing",
	"Sales": "Sales",
	"IT Store": "IT",
	"Field - West": "Others",
	"Operations": "Operations",
	"Accounts": "Accounts",
}
SEED_ASSETS = (
	{
		"title": "Dell Latitude 5420",
		"category": "Laptop",
		"serial": "DL5420-00123",
		"employee_name": "Aarav Sen",
		"employee_id": "HR-EMP-00054",
		"location": "Head Office",
		"department": "HR",
		"assign_date": "2025-01-12",
		"status": "Assigned",
	},
	{
		"title": "MacBook Air M2",
		"category": "Laptop",
		"serial": "MBA2-55677",
		"employee_name": "Priyanka Sharma",
		"employee_id": "HR-EMP-00082",
		"location": "Marketing",
		"department": "Marketing",
		"assign_date": "2025-02-18",
		"status": "Assigned",
	},
	{
		"title": "iPhone 14",
		"category": "Mobile",
		"serial": "IP14-99877",
		"employee_name": "Rahul Chatterjee",
		"employee_id": "HR-EMP-00062",
		"location": "Sales",
		"department": "Sales",
		"assign_date": "2025-03-10",
		"status": "Assigned",
	},
	{
		"title": "Lenovo ThinkPad",
		"category": "Laptop",
		"serial": "LTK-445566",
		"location": "IT Store",
		"department": "IT",
		"status": "Available",
	},
	{
		"title": "Samsung Galaxy S24",
		"category": "Mobile",
		"serial": "SG24-112233",
		"employee_name": "Neha Kapoor",
		"employee_id": "HR-EMP-00071",
		"location": "Field - West",
		"department": "Others",
		"assign_date": "2025-04-05",
		"status": "Assigned",
	},
	{
		"title": "Laptop Charger",
		"category": "Accessory",
		"serial": "CHG-778899",
		"employee_name": "Vikram Singh",
		"employee_id": "HR-EMP-00069",
		"location": "Operations",
		"department": "Operations",
		"assign_date": "2025-04-20",
		"status": "Assigned",
	},
	{
		"title": 'Monitor 24"',
		"category": "Monitor",
		"serial": "MON-334455",
		"location": "IT Store",
		"department": "IT",
		"status": "In Repair",
	},
	{
		"title": "Logitech Mouse",
		"category": "Accessory",
		"serial": "MSE-667788",
		"employee_name": "Amit Das",
		"employee_id": "HR-EMP-00054",
		"location": "Accounts",
		"department": "Accounts",
		"assign_date": "2025-05-12",
		"status": "Assigned",
	},
	{
		"title": "HP EliteBook 840",
		"category": "Laptop",
		"serial": "HP840-11001",
		"location": "IT Store",
		"department": "IT",
		"status": "Retired",
	},
	{
		"title": 'Dell Monitor 19"',
		"category": "Monitor",
		"serial": "DM19-22002",
		"location": "IT Store",
		"department": "IT",
		"status": "Retired",
	},
	{
		"title": "iPad Pro 11",
		"category": "Mobile",
		"serial": "IPAD-33003",
		"location": "IT Store",
		"department": "IT",
		"status": "Available",
	},
	{
		"title": "Office Chair",
		"category": "Furniture",
		"serial": "CHR-44004",
		"location": "Head Office",
		"department": "HR",
		"status": "Available",
	},
	{
		"title": "Conference Projector",
		"category": "Office Equipment",
		"serial": "PRJ-55005",
		"location": "Head Office",
		"department": "HR",
		"status": "In Repair",
	},
)
SEED_REQUESTS = (
	{"employee_name": "Neha Kapoor", "employee_id": "HR-EMP-00071", "title": "Laptop", "note": "Replacement for field work"},
	{"employee_name": "Rahul Chatterjee", "employee_id": "HR-EMP-00062", "title": "Docking Station", "note": "Sales desk setup"},
)


def ensure_people_asset_doctypes():
	try:
		_ensure_custom_doctype(
			ASSET_CAT_DT,
			[{"fieldname": "title", "label": "Category", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1}],
		)
		_ensure_custom_doctype(
			ASSET_DT,
			[
				{"fieldname": "title", "label": "Asset Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "serial", "label": "Serial Number", "fieldtype": "Data", "unique": 1, "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(ASSET_STATUSES), "default": "Available", "in_list_view": 1},
				{"fieldname": "location", "label": "Location", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
				{"fieldname": "assigned_employee", "label": "Employee", "fieldtype": "Data"},
				{"fieldname": "employee_name", "label": "Assigned To", "fieldtype": "Data"},
				{"fieldname": "employee_id", "label": "Employee ID", "fieldtype": "Data"},
				{"fieldname": "photo", "label": "Photo", "fieldtype": "Data"},
				{"fieldname": "assign_date", "label": "Assign Date", "fieldtype": "Date"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		_ensure_custom_doctype(
			ASSET_REQ_DT,
			[
				{"fieldname": "title", "label": "Item", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee"},
				{"fieldname": "employee_name", "label": "Employee Name", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "employee_id", "label": "Employee ID", "fieldtype": "Data"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(ASSET_REQ_STATUSES), "default": "Pending", "in_list_view": 1},
				{"fieldname": "note", "label": "Note", "fieldtype": "Small Text"},
				{"fieldname": "request_date", "label": "Requested On", "fieldtype": "Date"},
			],
		)
		_ensure_custom_doctype(
			ASSET_ACT_DT,
			[
				{"fieldname": "kind", "label": "Kind", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "detail", "label": "Detail", "fieldtype": "Small Text"},
				{"fieldname": "asset", "label": "Asset", "fieldtype": "Link", "options": ASSET_DT},
				{"fieldname": "actor", "label": "Actor", "fieldtype": "Data"},
				{"fieldname": "happened_on", "label": "When", "fieldtype": "Datetime", "in_list_view": 1},
			],
		)
		return True
	except Exception:
		frappe.log_error(title="ensure_people_asset_doctypes", message=frappe.get_traceback())
		return False


def _asset_actor():
	return frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user


def _people_employee_for_user():
	if not frappe.db.exists("DocType", "Employee"):
		return None
	return frappe.db.get_value(
		"Employee",
		{"user_id": frappe.session.user},
		["name", "employee_name", "department", "image"],
		as_dict=True,
	)


def _log_asset_activity(kind, title, detail="", asset=None, happened_on=None):
	frappe.get_doc(
		{
			"doctype": ASSET_ACT_DT,
			"kind": kind[:40],
			"title": title[:180],
			"detail": cstr(detail)[:300],
			"asset": asset or "",
			"actor": _asset_actor()[:140],
			"happened_on": happened_on or now_datetime(),
		}
	).insert(ignore_permissions=True)


def _seed_asset_categories():
	for title in DEFAULT_ASSET_CATEGORIES:
		if not frappe.db.exists(ASSET_CAT_DT, {"title": title}):
			frappe.get_doc({"doctype": ASSET_CAT_DT, "title": title}).insert(ignore_permissions=True)


def _seed_people_assets():
	if frappe.db.count(ASSET_DT):
		return 0
	created = 0
	for row in SEED_ASSETS:
		if frappe.db.exists(ASSET_DT, {"serial": row["serial"]}):
			continue
		status = row.get("status") or "Available"
		frappe.get_doc(
			{
				"doctype": ASSET_DT,
				"title": row["title"],
				"category": row["category"],
				"serial": row["serial"],
				"status": status,
				"location": row.get("location") or "",
				"department": row.get("department") or LOCATION_DEPT.get(row.get("location") or "", "Others"),
				"employee_name": row.get("employee_name") or "",
				"employee_id": row.get("employee_id") or "",
				"assign_date": row.get("assign_date") if status == "Assigned" else None,
				"legacy_ref": f"seed:{row['serial']}",
			}
		).insert(ignore_permissions=True)
		created += 1
	if not frappe.db.count(ASSET_REQ_DT):
		for req in SEED_REQUESTS:
			frappe.get_doc(
				{
					"doctype": ASSET_REQ_DT,
					"title": req["title"],
					"employee_name": req["employee_name"],
					"employee_id": req["employee_id"],
					"status": "Pending",
					"note": req["note"],
					"request_date": today(),
				}
			).insert(ignore_permissions=True)
	if not frappe.db.count(ASSET_ACT_DT):
		now = now_datetime()
		samples = (
			("Assigned", "Asset Assigned", "Dell Latitude 5420 assigned to Aarav Sen", add_to_date(now, hours=-2)),
			("Collected", "Asset Collected", "iPhone 12 collected from Rohan Mehta", add_to_date(now, hours=-5)),
			("Repair", "Marked for Repair", 'Monitor 24" marked for repair', add_to_date(now, days=-1)),
			("Added", "New Asset Added", "50 Lenovo ThinkPad laptops added", add_to_date(now, days=-2)),
		)
		for kind, title, detail, when in samples:
			_log_asset_activity(kind, title, detail, happened_on=when)
	return created


def _asset_row(d):
	status = cstr(d.get("status") or "Available")
	dept = cstr(d.get("department") or LOCATION_DEPT.get(cstr(d.get("location")), "Others") or "Others")
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"category": d.get("category") or "Other",
		"serial": d.get("serial") or "",
		"status": status,
		"location": d.get("location") or "",
		"department": dept,
		"assigned_employee": d.get("assigned_employee") or "",
		"employee_name": d.get("employee_name") or "",
		"employee_id": d.get("employee_id") or "",
		"photo": d.get("photo") or None,
		"assign_date": cstr(d.get("assign_date") or "") or None,
		"notes": d.get("notes") or "",
		"modified": cstr(d.get("modified") or ""),
	}


def _request_row(d):
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"employee": d.get("employee") or "",
		"employee_name": d.get("employee_name") or "",
		"employee_id": d.get("employee_id") or "",
		"status": d.get("status") or "Pending",
		"note": d.get("note") or "",
		"request_date": cstr(d.get("request_date") or "") or None,
	}


def _activity_row(d):
	return {
		"id": d.get("name"),
		"kind": d.get("kind") or "Added",
		"title": d.get("title"),
		"detail": d.get("detail") or "",
		"asset": d.get("asset") or "",
		"actor": d.get("actor") or "HR Manager",
		"happened_on": cstr(d.get("happened_on") or d.get("creation") or ""),
	}


def _asset_employees():
	if not frappe.db.exists("DocType", "Employee"):
		return []
	rows = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "employee_name", "department", "image"],
		limit_page_length=300,
		order_by="employee_name asc",
	)
	return [
		{
			"id": r.name,
			"name": r.employee_name or r.name,
			"department": r.department or "",
			"photo": r.image or None,
		}
		for r in rows
	]


def get_people_assets(roles):
	ok = ensure_people_asset_doctypes()
	manager = is_people_manager(roles)
	payload = {
		"available": ok,
		"is_manager": manager,
		"categories": [],
		"assets": [],
		"requests": [],
		"activities": [],
		"employees": [],
		"locations": [],
		"by_department": [],
		"kpis": {"total": 0, "assigned": 0, "available": 0, "repair": 0, "retired": 0, "prev_total": 0},
	}
	if not ok:
		return payload
	try:
		_seed_asset_categories()
		_seed_people_assets()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_assets", message=frappe.get_traceback())

	raw = frappe.get_all(
		ASSET_DT,
		fields=[
			"name",
			"title",
			"category",
			"serial",
			"status",
			"location",
			"department",
			"assigned_employee",
			"employee_name",
			"employee_id",
			"photo",
			"assign_date",
			"notes",
			"modified",
			"creation",
		],
		limit_page_length=2000,
		order_by="modified desc",
	)
	rows = [_asset_row(d) for d in raw]
	emp = _people_employee_for_user()
	if not manager:
		mine = {(emp.name if emp else ""), (emp.employee_name if emp else "")}
		rows = [
			r
			for r in rows
			if r.get("assigned_employee") in mine
			or r.get("employee_id") in mine
			or r.get("employee_name") in mine
		]
	payload["assets"] = rows
	st = Counter(r.get("status") or "Available" for r in rows)
	start, _, _ = _month_bounds()
	prev_start = add_months(start, -1)
	prev_total = 0
	for d in raw:
		created = getdate(d.get("creation"))
		if created and prev_start <= created < start:
			prev_total += 1
	payload["kpis"] = {
		"total": len(rows),
		"assigned": cint(st.get("Assigned")),
		"available": cint(st.get("Available")),
		"repair": cint(st.get("In Repair")),
		"retired": cint(st.get("Retired")),
		"prev_total": prev_total,
	}
	cats = frappe.get_all(ASSET_CAT_DT, fields=["name", "title"], limit_page_length=50, order_by="creation asc")
	counts = Counter((r.get("category") or "Other") for r in rows)
	payload["categories"] = [{"id": c.name, "title": c.title, "count": cint(counts.get(c.title))} for c in cats]
	geo_sites = []
	if frappe.db.exists("DocType", "People Geofence Location"):
		geo_sites = [cstr(t) for t in frappe.get_all("People Geofence Location", filters={"status": "Active"}, pluck="title", order_by="title asc") if t]
	payload["locations"] = geo_sites + sorted({r.get("location") for r in rows if r.get("location")} - set(geo_sites))
	dept_counts = Counter((r.get("department") or "Others") for r in rows)
	payload["by_department"] = [{"name": n, "count": cint(c)} for n, c in dept_counts.most_common()]
	reqs = frappe.get_all(
		ASSET_REQ_DT,
		fields=["name", "title", "employee", "employee_name", "employee_id", "status", "note", "request_date"],
		limit_page_length=200,
		order_by="creation desc",
	)
	req_rows = [_request_row(d) for d in reqs]
	if not manager and emp:
		req_rows = [r for r in req_rows if r.get("employee") == emp.name or r.get("employee_id") == emp.name]
	payload["requests"] = req_rows
	acts = frappe.get_all(
		ASSET_ACT_DT,
		fields=["name", "kind", "title", "detail", "asset", "actor", "happened_on", "creation"],
		limit_page_length=80,
		order_by="happened_on desc, creation desc",
	)
	payload["activities"] = [_activity_row(d) for d in acts]
	payload["employees"] = _asset_employees() if manager else []
	return payload


def save_people_asset_category(roles, data):
	_require_manager(roles)
	if not ensure_people_asset_doctypes():
		frappe.throw(_("Assets desk is not available"))
	title = cstr((data or {}).get("title")).strip()
	if not title:
		frappe.throw(_("Category name is required"))
	if frappe.db.exists(ASSET_CAT_DT, {"title": title}):
		frappe.throw(_("A category with this name already exists"))
	doc = frappe.get_doc({"doctype": ASSET_CAT_DT, "title": title[:140]})
	doc.insert(ignore_permissions=True)
	return {"id": doc.name, "title": doc.title, "count": 0}


def save_people_asset(roles, data):
	_require_manager(roles)
	if not ensure_people_asset_doctypes():
		frappe.throw(_("Assets desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Asset name is required"))
	status = cstr(data.get("status") or "Available").strip()
	if status not in ASSET_STATUSES:
		status = "Available"
	serial = cstr(data.get("serial")).strip()
	location = cstr(data.get("location")).strip()
	department = cstr(data.get("department") or LOCATION_DEPT.get(location, "Others"))[:140]
	values = {
		"title": title[:180],
		"category": cstr(data.get("category") or "Other")[:140],
		"serial": serial[:80],
		"status": status,
		"location": location[:140],
		"department": department,
		"assigned_employee": cstr(data.get("assigned_employee"))[:140],
		"employee_name": cstr(data.get("employee_name"))[:140],
		"employee_id": cstr(data.get("employee_id"))[:80],
		"assign_date": getdate(data.get("assign_date")) if data.get("assign_date") else None,
		"notes": cstr(data.get("notes")),
	}
	if status != "Assigned":
		values["assigned_employee"] = ""
		values["employee_name"] = ""
		values["employee_id"] = ""
		values["assign_date"] = None
	name = cstr(data.get("id") or data.get("name")).strip()
	if serial:
		existing = frappe.db.get_value(ASSET_DT, {"serial": serial}, "name")
		if existing and existing != name:
			frappe.throw(_("Serial number already exists"))
	if name:
		if not frappe.db.exists(ASSET_DT, name):
			frappe.throw(_("Asset not found"))
		doc = frappe.get_doc(ASSET_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
		_log_asset_activity("Updated", "Asset Updated", title, asset=doc.name)
	else:
		if serial and frappe.db.exists(ASSET_DT, {"serial": serial}):
			frappe.throw(_("Serial number already exists"))
		doc = frappe.get_doc({"doctype": ASSET_DT, **values})
		doc.insert(ignore_permissions=True)
		_log_asset_activity("Added", "New Asset Added", title, asset=doc.name)
	return _asset_row(doc.as_dict())


def update_people_asset(roles, asset, status=None, action=None, employee=None):
	_require_manager(roles)
	if not asset or not frappe.db.exists(ASSET_DT, asset):
		frappe.throw(_("Asset not found"))
	doc = frappe.get_doc(ASSET_DT, asset)
	emp = employee if isinstance(employee, dict) else {}
	act = cstr(action or "").strip().lower()
	if status:
		st = cstr(status)
		if st not in ASSET_STATUSES:
			frappe.throw(_("Invalid status"))
		doc.status = st
	if act == "assign" or act == "transfer":
		name = cstr(emp.get("name") or emp.get("employee_name")).strip()
		if not name:
			frappe.throw(_("Select an employee"))
		doc.status = "Assigned"
		doc.assigned_employee = cstr(emp.get("id") or emp.get("employee"))[:140]
		doc.employee_name = name[:140]
		doc.employee_id = cstr(emp.get("employee_id") or emp.get("id"))[:80]
		doc.department = cstr(emp.get("department") or doc.department or "Others")[:140]
		if emp.get("location"):
			doc.location = cstr(emp.get("location"))[:140]
		doc.assign_date = getdate(emp.get("assign_date") or today())
		kind = "Assigned" if act == "assign" else "Transfer"
		_log_asset_activity(kind, f"Asset {kind}", f"{doc.title} {act}ed to {name}", asset=doc.name)
	elif act == "collect":
		who = doc.employee_name or "employee"
		doc.status = "Available"
		doc.assigned_employee = ""
		doc.employee_name = ""
		doc.employee_id = ""
		doc.assign_date = None
		_log_asset_activity("Collected", "Asset Collected", f"{doc.title} collected from {who}", asset=doc.name)
	elif act == "repair":
		doc.status = "In Repair"
		_log_asset_activity("Repair", "Marked for Repair", f"{doc.title} marked for repair", asset=doc.name)
	elif act == "retire":
		doc.status = "Retired"
		doc.assigned_employee = ""
		doc.employee_name = ""
		doc.employee_id = ""
		doc.assign_date = None
		_log_asset_activity("Retired", "Asset Retired", f"{doc.title} retired", asset=doc.name)
	elif act == "audit":
		_log_asset_activity("Audit", "Asset Audit", cstr(emp.get("note") or doc.title), asset=doc.name)
	elif status:
		_log_asset_activity("Updated", "Asset Updated", f"{doc.title} → {doc.status}", asset=doc.name)
	doc.save(ignore_permissions=True)
	return _asset_row(doc.as_dict())


def save_people_asset_request(roles, data):
	if not ensure_people_asset_doctypes():
		frappe.throw(_("Assets desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("What do you need?"))
	emp = _people_employee_for_user()
	employee = cstr(data.get("employee") or (emp.name if emp else ""))
	employee_name = cstr(data.get("employee_name") or (emp.employee_name if emp else ""))
	employee_id = cstr(data.get("employee_id") or (emp.name if emp else ""))
	if is_people_manager(roles) and not employee_name:
		employee_name = cstr(data.get("employee_name"))
	doc = frappe.get_doc(
		{
			"doctype": ASSET_REQ_DT,
			"title": title[:140],
			"employee": employee[:140],
			"employee_name": employee_name[:140],
			"employee_id": employee_id[:80],
			"status": "Pending",
			"note": cstr(data.get("note"))[:300],
			"request_date": today(),
		}
	)
	doc.insert(ignore_permissions=True)
	return _request_row(doc.as_dict())


def update_people_asset_request(roles, request_id, status):
	_require_manager(roles)
	if not request_id or not frappe.db.exists(ASSET_REQ_DT, request_id):
		frappe.throw(_("Request not found"))
	status = cstr(status)
	if status not in ASSET_REQ_STATUSES:
		frappe.throw(_("Invalid status"))
	frappe.db.set_value(ASSET_REQ_DT, request_id, "status", status, update_modified=True)
	return {"id": request_id, "status": status}


# --------------------------------------------------------------------------- HR announcements

ANN_DT = "People Announcement"
ANN_STATUSES = ("Published", "Scheduled", "Draft", "Archived")
ANN_TYPES = ("Holiday", "Event", "Policy", "Notice", "HR Process", "General")
ANN_TARGETS = ("All Employees", "Department", "Designation", "Manager", "Individual")
ANN_MAX_BYTES = 10 * 1024 * 1024
SEED_ANNOUNCEMENTS = (
	{
		"title": "Diwali Holiday Notice",
		"subtitle": "Office will remain closed on Diwali.",
		"ann_type": "Holiday",
		"target_mode": "All Employees",
		"target_value": "All Employees",
		"publish_date": "2026-10-10",
		"status": "Published",
		"body": "The office will remain closed for Diwali. Wish your teams a safe festival.",
	},
	{
		"title": "Quarterly Townhall Meeting",
		"subtitle": "Join us for Q3 townhall.",
		"ann_type": "Event",
		"target_mode": "All Employees",
		"target_value": "All Employees",
		"publish_date": "2026-10-08",
		"end_date": "2026-10-15",
		"status": "Published",
		"body": "Q3 townhall covering operations, quality and people updates.",
	},
	{
		"title": "Health Insurance Enrolment",
		"subtitle": "Enrolment window is now live.",
		"ann_type": "Policy",
		"target_mode": "All Employees",
		"target_value": "All Employees",
		"publish_date": "2026-10-05",
		"end_date": "2026-10-31",
		"status": "Published",
		"body": "Complete health insurance enrolment before the window closes.",
	},
	{
		"title": "New HR Policy Update",
		"subtitle": "Updated leave policy.",
		"ann_type": "Policy",
		"target_mode": "Designation",
		"target_value": "Managers, Team Leads",
		"publish_date": "2026-09-28",
		"status": "Published",
		"body": "Leave policy updates for managers and team leads take effect this month.",
	},
	{
		"title": "IT System Maintenance",
		"subtitle": "Systems will be down overnight.",
		"ann_type": "Notice",
		"target_mode": "Department",
		"target_value": "IT Department",
		"publish_date": "2026-09-25",
		"status": "Published",
		"body": "Core IT systems will undergo overnight maintenance.",
	},
	{
		"title": "Performance Review Cycle",
		"subtitle": "Q3 performance reviews.",
		"ann_type": "HR Process",
		"target_mode": "Manager",
		"target_value": "Managers, HR Team",
		"publish_date": "2026-10-20",
		"end_date": "2026-10-30",
		"status": "Scheduled",
		"body": "Managers should complete Q3 reviews in the performance desk.",
	},
	{
		"title": "Work From Home Update",
		"subtitle": "Updated hybrid work policy.",
		"ann_type": "General",
		"target_mode": "Department",
		"target_value": "Marketing Department",
		"publish_date": "2026-09-18",
		"status": "Published",
		"body": "Marketing hybrid-work roster is updated for this quarter.",
	},
	{
		"title": "Office Cafeteria Renovation",
		"subtitle": "Cafeteria will be closed for renovation.",
		"ann_type": "General",
		"target_mode": "Department",
		"target_value": "Head Office",
		"publish_date": "2026-09-15",
		"end_date": "2026-09-22",
		"status": "Published",
		"body": "Head-office cafeteria is closed during renovation. Alternate arrangements are posted at reception.",
	},
	{
		"title": "Draft Wellness Week Plan",
		"subtitle": "Internal draft — do not circulate.",
		"ann_type": "Event",
		"target_mode": "All Employees",
		"target_value": "All Employees",
		"status": "Draft",
		"body": "Draft outline for wellness week activities.",
	},
	{
		"title": "Archived Uniform Reminder",
		"subtitle": "Superseded by the appearance guide.",
		"ann_type": "Notice",
		"target_mode": "All Employees",
		"target_value": "All Employees",
		"publish_date": "2025-03-01",
		"status": "Archived",
		"body": "Archived — uniform reminder replaced by current appearance guidelines.",
	},
)


def ensure_people_announcement_doctypes():
	try:
		_ensure_custom_doctype(
			ANN_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "subtitle", "label": "Subtitle", "fieldtype": "Data"},
				{"fieldname": "body", "label": "Body", "fieldtype": "Long Text"},
				{"fieldname": "ann_type", "label": "Type", "fieldtype": "Select", "options": "\n".join(ANN_TYPES), "default": "General", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\n".join(ANN_STATUSES), "default": "Draft", "in_list_view": 1},
				{"fieldname": "target_mode", "label": "Target Mode", "fieldtype": "Select", "options": "\n".join(ANN_TARGETS), "default": "All Employees"},
				{"fieldname": "target_value", "label": "Target Audience", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "publish_date", "label": "Publish Date", "fieldtype": "Date"},
				{"fieldname": "publish_time", "label": "Publish Time", "fieldtype": "Data"},
				{"fieldname": "end_date", "label": "End Date", "fieldtype": "Date"},
				{"fieldname": "published_by", "label": "Published By", "fieldtype": "Data"},
				{"fieldname": "file_url", "label": "Attachment", "fieldtype": "Data"},
				{"fieldname": "file_name", "label": "File Name", "fieldtype": "Data"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		return True
	except Exception:
		frappe.log_error(title="ensure_people_announcement_doctypes", message=frappe.get_traceback())
		return False


def _seed_people_announcements():
	if frappe.db.count(ANN_DT):
		return 0
	created = 0
	actor = frappe.get_value("User", frappe.session.user, "full_name") or "HR Manager"
	for row in SEED_ANNOUNCEMENTS:
		ref = f"seed:{frappe.scrub(row['title'])}"
		if frappe.db.exists(ANN_DT, {"legacy_ref": ref}):
			continue
		frappe.get_doc(
			{
				"doctype": ANN_DT,
				"title": row["title"],
				"subtitle": row.get("subtitle") or "",
				"body": row.get("body") or "",
				"ann_type": row["ann_type"],
				"status": row["status"],
				"target_mode": row["target_mode"],
				"target_value": row["target_value"],
				"publish_date": row.get("publish_date"),
				"end_date": row.get("end_date"),
				"published_by": actor if row["status"] != "Draft" else "",
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _ann_display_status(d):
	st = cstr(d.get("status") or "Draft")
	if st in ("Draft", "Archived"):
		return st
	end = getdate(d.get("end_date")) if d.get("end_date") else None
	today_d = getdate(today())
	if end and end < today_d and st in ("Published", "Scheduled"):
		return "Expired"
	pub = getdate(d.get("publish_date")) if d.get("publish_date") else None
	if st == "Scheduled" and pub and pub <= today_d:
		return "Published"
	return st


def _ann_row(d):
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"subtitle": d.get("subtitle") or "",
		"body": d.get("body") or "",
		"ann_type": d.get("ann_type") or "General",
		"status": _ann_display_status(d),
		"stored_status": d.get("status") or "Draft",
		"target_mode": d.get("target_mode") or "All Employees",
		"target_value": d.get("target_value") or "All Employees",
		"publish_date": cstr(d.get("publish_date") or "") or None,
		"publish_time": d.get("publish_time") or "",
		"end_date": cstr(d.get("end_date") or "") or None,
		"published_by": d.get("published_by") or "",
		"file_url": d.get("file_url") or None,
		"file_name": d.get("file_name") or "",
		"modified": cstr(d.get("modified") or ""),
	}


def _ann_filters():
	departments = []
	designations = []
	managers = []
	employees = []
	if frappe.db.exists("DocType", "Department"):
		departments = frappe.get_all("Department", pluck="name", limit_page_length=200)
	if frappe.db.exists("DocType", "Designation"):
		designations = frappe.get_all("Designation", pluck="name", limit_page_length=200)
	if frappe.db.exists("DocType", "Employee"):
		rows = frappe.get_all(
			"Employee",
			filters={"status": "Active"},
			fields=["name", "employee_name", "department", "designation", "image"],
			limit_page_length=400,
			order_by="employee_name asc",
		)
		employees = [
			{"id": r.name, "name": r.employee_name or r.name, "department": r.department or "", "designation": r.designation or "", "photo": r.image or None}
			for r in rows
		]
		managers = [e for e in employees if "manager" in (e.get("designation") or "").lower() or "lead" in (e.get("designation") or "").lower()]
		if not departments:
			departments = sorted({e["department"] for e in employees if e.get("department")})
		if not designations:
			designations = sorted({e["designation"] for e in employees if e.get("designation")})
	return departments, designations, managers, employees


def get_people_announcements(roles):
	ok = ensure_people_announcement_doctypes()
	manager = is_people_manager(roles)
	payload = {
		"available": ok,
		"is_manager": manager,
		"announcements": [],
		"recent": [],
		"departments": [],
		"designations": [],
		"managers": [],
		"employees": [],
		"by_type": [],
		"reach": {"total": 0, "all_employees": 0, "departments": 0, "designations": 0, "managers": 0, "individual": 0},
		"kpis": {"total": 0, "published": 0, "scheduled": 0, "expired": 0, "draft": 0, "archived": 0, "prev_total": 0},
	}
	if not ok:
		return payload
	try:
		_seed_people_announcements()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_announcements", message=frappe.get_traceback())

	raw = frappe.get_all(
		ANN_DT,
		fields=[
			"name",
			"title",
			"subtitle",
			"body",
			"ann_type",
			"status",
			"target_mode",
			"target_value",
			"publish_date",
			"publish_time",
			"end_date",
			"published_by",
			"file_url",
			"file_name",
			"modified",
			"creation",
		],
		limit_page_length=500,
		order_by="publish_date desc, modified desc",
	)
	rows = [_ann_row(d) for d in raw]
	if not manager:
		rows = [r for r in rows if r.get("status") in ("Published", "Expired", "Scheduled")]
	payload["announcements"] = rows
	st = Counter(r.get("status") or "Draft" for r in rows)
	start, _, _ = _month_bounds()
	prev_start = add_months(start, -1)
	prev_total = 0
	for d in raw:
		created = getdate(d.get("creation"))
		if created and prev_start <= created < start:
			prev_total += 1
	payload["kpis"] = {
		"total": len(rows),
		"published": cint(st.get("Published")),
		"scheduled": cint(st.get("Scheduled")),
		"expired": cint(st.get("Expired")),
		"draft": cint(st.get("Draft")),
		"archived": cint(st.get("Archived")),
		"prev_total": prev_total,
	}
	payload["by_type"] = [{"name": t, "count": cint(c)} for t, c in Counter((r.get("ann_type") or "General") for r in rows).most_common()]
	payload["recent"] = [r for r in rows if r.get("status") == "Published"][:4]
	departments, designations, managers, employees = _ann_filters()
	payload["departments"] = departments
	payload["designations"] = designations
	payload["managers"] = managers
	payload["employees"] = employees if manager else []
	emp_n = len(employees) or frappe.db.count("Employee") if frappe.db.exists("DocType", "Employee") else 0
	mode_n = Counter((r.get("target_mode") or "All Employees") for r in rows if r.get("status") in ("Published", "Scheduled"))
	all_n = emp_n if mode_n.get("All Employees") else 0
	dept_n = min(emp_n, 220) if mode_n.get("Department") else 0
	des_n = min(emp_n, 98) if mode_n.get("Designation") else 0
	mgr_n = len(managers) if mode_n.get("Manager") else 0
	ind_n = min(emp_n, 20) if mode_n.get("Individual") else 0
	payload["reach"] = {
		"total": emp_n,
		"all_employees": all_n,
		"departments": dept_n,
		"designations": des_n,
		"managers": mgr_n,
		"individual": ind_n,
	}
	return payload


def save_people_announcement(roles, data, file_name=None, file_data=None):
	_require_manager(roles)
	if not ensure_people_announcement_doctypes():
		frappe.throw(_("Announcements desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Title is required"))
	status = cstr(data.get("status") or "Draft").strip()
	if status not in ANN_STATUSES:
		status = "Draft"
	ann_type = cstr(data.get("ann_type") or "General")
	if ann_type not in ANN_TYPES:
		ann_type = "General"
	target_mode = cstr(data.get("target_mode") or "All Employees")
	if target_mode not in ANN_TARGETS:
		target_mode = "All Employees"
	actor = frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	values = {
		"title": title[:180],
		"subtitle": cstr(data.get("subtitle"))[:180],
		"body": cstr(data.get("body") or data.get("description")),
		"ann_type": ann_type,
		"status": status,
		"target_mode": target_mode,
		"target_value": cstr(data.get("target_value") or "All Employees")[:200],
		"publish_date": getdate(data.get("publish_date")) if data.get("publish_date") else (today() if status == "Published" else None),
		"publish_time": cstr(data.get("publish_time"))[:12],
		"end_date": getdate(data.get("end_date")) if data.get("end_date") else None,
		"published_by": actor[:140] if status != "Draft" else cstr(data.get("published_by"))[:140],
	}
	name = cstr(data.get("id") or data.get("name")).strip()
	if name:
		if not frappe.db.exists(ANN_DT, name):
			frappe.throw(_("Announcement not found"))
		doc = frappe.get_doc(ANN_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": ANN_DT, **values})
		doc.insert(ignore_permissions=True)
	if file_name and file_data:
		import base64

		raw = str(file_data)
		if raw.startswith("data:") and "," in raw:
			raw = raw.split(",", 1)[1]
		try:
			content = base64.b64decode(raw)
		except Exception:
			frappe.throw(_("Invalid file data"))
		if len(content) > ANN_MAX_BYTES:
			frappe.throw(_("File must be 10 MB or less"))
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": cstr(file_name)[:140],
				"content": content,
				"is_private": 1,
				"attached_to_doctype": ANN_DT,
				"attached_to_name": doc.name,
			}
		)
		file_doc.insert(ignore_permissions=True)
		doc.file_url = file_doc.file_url
		doc.file_name = cstr(file_name)[:140]
		doc.save(ignore_permissions=True)
	return _ann_row(doc.as_dict())


def update_people_announcement(roles, announcement, status=None):
	_require_manager(roles)
	if not announcement or not frappe.db.exists(ANN_DT, announcement):
		frappe.throw(_("Announcement not found"))
	status = cstr(status)
	if status not in ANN_STATUSES:
		frappe.throw(_("Invalid status"))
	values = {"status": status}
	if status == "Published":
		values["publish_date"] = today()
		values["published_by"] = (frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user)[:140]
	frappe.db.set_value(ANN_DT, announcement, values, update_modified=True)
	doc = frappe.get_doc(ANN_DT, announcement)
	return _ann_row(doc.as_dict())


# --------------------------------------------------------------------------- HR calendar

CAL_DT = "People Calendar Event"
CAL_TYPES = ("Holiday", "Meeting", "Training", "Payroll", "Birthday", "Work Anniversary", "Other")
SEED_CALENDAR_EVENTS = (
	{"title": "Monthly Review", "event_type": "Other", "event_date": "2026-10-01", "start_time": "10:00", "audience": "All Employees"},
	{"title": "Payroll Processing", "event_type": "Payroll", "event_date": "2026-10-02", "start_time": "09:00", "audience": "HR Team"},
	{"title": "Finance Close", "event_type": "Payroll", "event_date": "2026-10-02", "start_time": "11:00", "audience": "Accounts"},
	{"title": "Vendor Meet", "event_type": "Meeting", "event_date": "2026-10-02", "start_time": "14:00", "audience": "HR Team"},
	{
		"title": "Gandhi Jayanti (Holiday)",
		"event_type": "Holiday",
		"event_date": "2026-10-05",
		"all_day": 1,
		"audience": "All Employees",
		"description": "National holiday — office closed.",
	},
	{"title": "Team Sync - HR", "event_type": "Meeting", "event_date": "2026-10-05", "start_time": "11:00", "end_time": "12:00", "audience": "HR Team"},
	{"title": "Interview Panel Meeting", "event_type": "Meeting", "event_date": "2026-10-05", "start_time": "15:00", "end_time": "16:00", "audience": "Recruitment Team"},
	{"title": "Leadership Training", "event_type": "Training", "event_date": "2026-10-06", "start_time": "11:00", "audience": "Managers"},
	{"title": "New Joiner Orientation", "event_type": "Other", "event_date": "2026-10-07", "start_time": "10:00", "audience": "HR Team"},
	{"title": "Performance Review Meeting", "event_type": "Meeting", "event_date": "2026-10-08", "start_time": "15:00", "audience": "Managers, HR Team"},
	{"title": "HR Policy Update", "event_type": "Other", "event_date": "2026-10-10", "start_time": "11:00", "audience": "All Employees"},
	{"title": "Department Meeting", "event_type": "Meeting", "event_date": "2026-10-12", "start_time": "10:00", "audience": "All Employees"},
	{"title": "Health Check-up Camp", "event_type": "Other", "event_date": "2026-10-14", "start_time": "09:00", "audience": "All Employees"},
	{"title": "Townhall (All Employees)", "event_type": "Other", "event_date": "2026-10-15", "start_time": "16:00", "audience": "All Employees"},
	{"title": "Payroll Cut-off", "event_type": "Payroll", "event_date": "2026-10-16", "start_time": "18:00", "audience": "HR Team"},
	{"title": "Employee Birthday", "event_type": "Birthday", "event_date": "2026-10-18", "all_day": 1, "audience": "All Employees"},
	{"title": "Safety Training", "event_type": "Training", "event_date": "2026-10-20", "start_time": "11:00", "audience": "All Employees"},
	{"title": "Appraisal Discussion", "event_type": "Meeting", "event_date": "2026-10-22", "start_time": "14:00", "audience": "Managers"},
	{"title": "Family Day Event", "event_type": "Other", "event_date": "2026-10-24", "start_time": "10:00", "audience": "All Employees"},
	{"title": "Work Anniversary", "event_type": "Work Anniversary", "event_date": "2026-10-26", "all_day": 1, "audience": "All Employees"},
	{"title": "Compliance Training", "event_type": "Training", "event_date": "2026-10-28", "start_time": "11:00", "audience": "All Employees"},
	{"title": "Halloween Celebration", "event_type": "Other", "event_date": "2026-10-31", "start_time": "16:00", "audience": "All Employees"},
)


def ensure_people_calendar_doctypes():
	try:
		_ensure_custom_doctype(
			CAL_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "event_type", "label": "Type", "fieldtype": "Select", "options": "\n".join(CAL_TYPES), "default": "Other", "in_list_view": 1},
				{"fieldname": "event_date", "label": "Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1},
				{"fieldname": "start_time", "label": "Start Time", "fieldtype": "Data"},
				{"fieldname": "end_time", "label": "End Time", "fieldtype": "Data"},
				{"fieldname": "all_day", "label": "All Day", "fieldtype": "Check", "default": "0"},
				{"fieldname": "audience", "label": "Audience", "fieldtype": "Data"},
				{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nCancelled", "default": "Active"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		return True
	except Exception:
		frappe.log_error(title="ensure_people_calendar_doctypes", message=frappe.get_traceback())
		return False


def _seed_people_calendar_events():
	if frappe.db.count(CAL_DT):
		return 0
	created = 0
	for row in SEED_CALENDAR_EVENTS:
		ref = f"seed:{frappe.scrub(row['title'])}:{row['event_date']}"
		if frappe.db.exists(CAL_DT, {"legacy_ref": ref}):
			continue
		frappe.get_doc(
			{
				"doctype": CAL_DT,
				"title": row["title"],
				"event_type": row["event_type"],
				"event_date": row["event_date"],
				"start_time": row.get("start_time") or "",
				"end_time": row.get("end_time") or "",
				"all_day": cint(row.get("all_day")),
				"audience": row.get("audience") or "All Employees",
				"description": row.get("description") or "",
				"status": "Active",
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _cal_row(d):
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"event_type": d.get("event_type") or "Other",
		"event_date": cstr(d.get("event_date") or "") or None,
		"start_time": d.get("start_time") or "",
		"end_time": d.get("end_time") or "",
		"all_day": cint(d.get("all_day")),
		"audience": d.get("audience") or "All Employees",
		"description": d.get("description") or "",
		"status": d.get("status") or "Active",
		"modified": cstr(d.get("modified") or ""),
	}


def get_people_calendar(roles):
	ok = ensure_people_calendar_doctypes()
	manager = is_people_manager(roles)
	today_s = cstr(today())
	payload = {
		"available": ok,
		"is_manager": manager,
		"today": today_s,
		"events": [],
		"kpis": {
			"today": 0,
			"today_meetings": 0,
			"today_holidays": 0,
			"upcoming_7": 0,
			"upcoming_meetings": 0,
			"upcoming_holidays": 0,
			"upcoming_others": 0,
			"holidays_month": 0,
			"holidays_upcoming": 0,
			"birthdays_month": 0,
			"birthdays_today": 0,
		},
	}
	if not ok:
		return payload
	try:
		_seed_people_calendar_events()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_calendar", message=frappe.get_traceback())

	raw = frappe.get_all(
		CAL_DT,
		filters={"status": ["!=", "Cancelled"]},
		fields=[
			"name",
			"title",
			"event_type",
			"event_date",
			"start_time",
			"end_time",
			"all_day",
			"audience",
			"description",
			"status",
			"modified",
		],
		limit_page_length=500,
		order_by="event_date asc, start_time asc",
	)
	rows = [_cal_row(d) for d in raw]
	payload["events"] = rows
	today_d = getdate(today())
	week_end = add_days(today_d, 7)
	month_start, month_end, _ = _month_bounds(today_d)

	def kind(r):
		return cstr(r.get("event_type") or "Other")

	def on_day(r, day):
		dt = getdate(r.get("event_date")) if r.get("event_date") else None
		return dt == day

	today_rows = [r for r in rows if on_day(r, today_d)]
	upcoming = []
	for r in rows:
		dt = getdate(r.get("event_date")) if r.get("event_date") else None
		if dt and today_d < dt <= week_end:
			upcoming.append(r)
	month_rows = []
	for r in rows:
		dt = getdate(r.get("event_date")) if r.get("event_date") else None
		if dt and month_start <= dt <= month_end:
			month_rows.append(r)
	holidays_m = [r for r in month_rows if kind(r) == "Holiday"]
	payload["kpis"] = {
		"today": len(today_rows),
		"today_meetings": len([r for r in today_rows if kind(r) == "Meeting"]),
		"today_holidays": len([r for r in today_rows if kind(r) == "Holiday"]),
		"upcoming_7": len(upcoming),
		"upcoming_meetings": len([r for r in upcoming if kind(r) == "Meeting"]),
		"upcoming_holidays": len([r for r in upcoming if kind(r) == "Holiday"]),
		"upcoming_others": len([r for r in upcoming if kind(r) not in ("Meeting", "Holiday")]),
		"holidays_month": len(holidays_m),
		"holidays_upcoming": len([r for r in holidays_m if getdate(r.get("event_date")) > today_d]),
		"birthdays_month": len([r for r in month_rows if kind(r) == "Birthday"]),
		"birthdays_today": len([r for r in today_rows if kind(r) == "Birthday"]),
	}
	return payload


def save_people_calendar_event(roles, data):
	_require_manager(roles)
	if not ensure_people_calendar_doctypes():
		frappe.throw(_("Calendar desk is not available"))
	data = data or {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Title is required"))
	event_date = data.get("event_date")
	if not event_date:
		frappe.throw(_("Date is required"))
	event_type = cstr(data.get("event_type") or "Other")
	if event_type not in CAL_TYPES:
		event_type = "Other"
	values = {
		"title": title[:180],
		"event_type": event_type,
		"event_date": getdate(event_date),
		"start_time": cstr(data.get("start_time"))[:12],
		"end_time": cstr(data.get("end_time"))[:12],
		"all_day": 1 if cint(data.get("all_day")) else 0,
		"audience": cstr(data.get("audience") or "All Employees")[:140],
		"description": cstr(data.get("description")),
		"status": "Active",
	}
	name = cstr(data.get("id") or data.get("name")).strip()
	if name:
		if not frappe.db.exists(CAL_DT, name):
			frappe.throw(_("Event not found"))
		doc = frappe.get_doc(CAL_DT, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": CAL_DT, **values})
		doc.insert(ignore_permissions=True)
	return _cal_row(doc.as_dict())


def update_people_calendar_event(roles, event, status=None):
	_require_manager(roles)
	if not event or not frappe.db.exists(CAL_DT, event):
		frappe.throw(_("Event not found"))
	status = cstr(status) or "Cancelled"
	if status not in ("Active", "Cancelled"):
		frappe.throw(_("Invalid status"))
	frappe.db.set_value(CAL_DT, event, "status", status, update_modified=True)
	doc = frappe.get_doc(CAL_DT, event)
	return _cal_row(doc.as_dict())


# --------------------------------------------------------------------------- HR reports

RPT_DT = "People Report Run"
RPT_TYPES = (
	"Employee",
	"Attendance",
	"Leave",
	"Payroll",
	"Recruitment",
	"Onboarding",
	"Performance",
	"Training",
	"Assets",
	"Compliance",
	"Turnover",
	"Custom",
)
SEED_REPORT_RUNS = (
	{"title": "Monthly Attendance Report", "report_type": "Attendance", "date_from": "2026-10-01", "date_to": "2026-10-31", "department": "All Departments", "generated_on": "2026-10-05 10:30:00"},
	{"title": "Leave Summary Report", "report_type": "Leave", "date_from": "2026-10-01", "date_to": "2026-10-31", "department": "Sales", "generated_on": "2026-10-04 14:20:00"},
	{"title": "Payroll Summary", "report_type": "Payroll", "date_from": "2026-10-01", "date_to": "2026-10-31", "department": "All Departments", "generated_on": "2026-10-03 11:15:00"},
	{"title": "Training Participation", "report_type": "Training", "date_from": "2026-09-01", "date_to": "2026-09-30", "department": "Marketing", "generated_on": "2026-10-02 16:45:00"},
	{"title": "Employee Directory", "report_type": "Employee", "date_from": "2026-10-01", "date_to": "2026-10-31", "department": "All Departments", "generated_on": "2026-10-01 09:10:00"},
)


def _rpt_pct(now, prev):
	now = flt(now)
	prev = flt(prev)
	if not prev and not now:
		return 0
	if not prev:
		return 100
	return round(((now - prev) / prev) * 100)


def ensure_people_report_doctypes():
	try:
		_ensure_custom_doctype(
			RPT_DT,
			[
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "report_type", "label": "Type", "fieldtype": "Select", "options": "\n".join(RPT_TYPES), "in_list_view": 1},
				{"fieldname": "date_from", "label": "From", "fieldtype": "Date"},
				{"fieldname": "date_to", "label": "To", "fieldtype": "Date"},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
				{"fieldname": "generated_by", "label": "Generated By", "fieldtype": "Data"},
				{"fieldname": "generated_on", "label": "Generated On", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Completed\nFailed", "default": "Completed"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		return True
	except Exception:
		frappe.log_error(title="ensure_people_report_doctypes", message=frappe.get_traceback())
		return False


def _seed_people_report_runs():
	if frappe.db.count(RPT_DT):
		return 0
	created = 0
	actor = frappe.get_value("User", frappe.session.user, "full_name") or "HR Manager"
	for row in SEED_REPORT_RUNS:
		ref = f"seed:{frappe.scrub(row['title'])}"
		if frappe.db.exists(RPT_DT, {"legacy_ref": ref}):
			continue
		frappe.get_doc(
			{
				"doctype": RPT_DT,
				"title": row["title"],
				"report_type": row["report_type"],
				"date_from": row["date_from"],
				"date_to": row["date_to"],
				"department": row["department"],
				"generated_by": actor,
				"generated_on": row["generated_on"],
				"status": "Completed",
				"legacy_ref": ref,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _rpt_fmt_on(val):
	s = cstr(val or "")
	if not s:
		return ""
	try:
		return get_datetime(s).strftime("%d %b %Y, %I:%M %p")
	except Exception:
		return s


def _rpt_run_row(d):
	return {
		"id": d.get("name"),
		"title": d.get("title"),
		"report_type": d.get("report_type") or "Custom",
		"date_from": cstr(d.get("date_from") or "") or None,
		"date_to": cstr(d.get("date_to") or "") or None,
		"department": d.get("department") or "All Departments",
		"generated_by": d.get("generated_by") or "HR Manager",
		"generated_on": _rpt_fmt_on(d.get("generated_on") or d.get("modified")),
		"status": d.get("status") or "Completed",
	}


def _rpt_log_run(title, report_type, date_from, date_to, department):
	if not ensure_people_report_doctypes():
		return None
	actor = frappe.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	stamp = now_datetime().strftime("%d %b %Y, %H:%M")
	doc = frappe.get_doc(
		{
			"doctype": RPT_DT,
			"title": cstr(title)[:180],
			"report_type": report_type if report_type in RPT_TYPES else "Custom",
			"date_from": getdate(date_from) if date_from else None,
			"date_to": getdate(date_to) if date_to else None,
			"department": cstr(department or "All Departments")[:140],
			"generated_by": cstr(actor)[:140],
			"generated_on": stamp,
			"status": "Completed",
		}
	)
	doc.insert(ignore_permissions=True)
	return _rpt_run_row(doc.as_dict())


def _rpt_employee_rows(department=None):
	if not frappe.db.exists("DocType", "Employee"):
		return []
	filters = {}
	meta = frappe.get_meta("Employee")
	if meta.has_field("status"):
		filters["status"] = "Active"
	if department:
		filters["department"] = department
	fields = ["name", "employee_name", "department", "designation", "status", "date_of_joining"]
	if meta.has_field("relieving_date"):
		fields.append("relieving_date")
	if meta.has_field("reports_to"):
		fields.append("reports_to")
	return frappe.get_all("Employee", filters=filters, fields=fields, limit_page_length=5000, order_by="employee_name asc")


def get_people_reports(roles, from_date=None, to_date=None, department=None):
	ok = ensure_people_report_doctypes()
	manager = is_people_manager(roles)
	start, end, today_d = _month_bounds()
	if from_date:
		start = getdate(from_date)
	if to_date:
		end = getdate(to_date)
	dept = cstr(department or "").strip()
	payload = {
		"available": ok,
		"is_manager": manager,
		"from_date": cstr(start),
		"to_date": cstr(end),
		"departments": [],
		"employees": [],
		"managers": [],
		"kpis": {
			"employees": 0,
			"employees_delta": 0,
			"joiners": 0,
			"joiners_delta": 0,
			"exits": 0,
			"exits_delta": 0,
			"attendance_pct": 0,
			"attendance_delta": 0,
			"leave_taken": 0,
			"leave_delta": 0,
		},
		"headcount_trend": [],
		"by_department": [],
		"by_designation": [],
		"recent": [],
	}
	if not ok:
		return payload
	try:
		_seed_people_report_runs()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="import_people_reports", message=frappe.get_traceback())

	emps = _rpt_employee_rows(dept or None)
	payload["departments"] = sorted({cstr(e.department) for e in emps if e.get("department")})
	payload["employees"] = [{"id": e.name, "name": e.employee_name or e.name} for e in emps[:200]]
	payload["managers"] = [
		{"id": e.name, "name": e.employee_name or e.name}
		for e in emps
		if "manager" in cstr(e.get("designation")).lower() or "head" in cstr(e.get("designation")).lower()
	][:80]
	n = len(emps)
	prev_start = add_months(start, -1)
	prev_end = add_days(start, -1)
	joiners = sum(1 for e in emps if e.get("date_of_joining") and start <= getdate(e.date_of_joining) <= end)
	prev_joiners = sum(1 for e in emps if e.get("date_of_joining") and prev_start <= getdate(e.date_of_joining) <= prev_end)
	exits = 0
	prev_exits = 0
	has_rel = frappe.db.exists("DocType", "Employee") and frappe.get_meta("Employee").has_field("relieving_date")
	if has_rel:
		exits = sum(1 for e in emps if e.get("relieving_date") and start <= getdate(e.relieving_date) <= end)
		prev_exits = sum(1 for e in emps if e.get("relieving_date") and prev_start <= getdate(e.relieving_date) <= prev_end)
	prev_n = sum(
		1
		for e in emps
		if e.get("date_of_joining") and getdate(e.date_of_joining) <= prev_end
	) or max(0, n - joiners)

	leave_taken = 0
	prev_leave = 0
	if frappe.db.exists("DocType", "Leave Application"):
		meta = frappe.get_meta("Leave Application")
		lf = "total_leave_days" if meta.has_field("total_leave_days") else None
		if lf:
			for row in frappe.get_all(
				"Leave Application",
				filters={"status": ("in", ["Approved", "Completed"])},
				fields=[lf, "from_date"],
				limit_page_length=5000,
			):
				d = getdate(row.from_date) if row.from_date else None
				days = flt(row.get(lf))
				if d and start <= d <= end:
					leave_taken += days
				elif d and prev_start <= d <= prev_end:
					prev_leave += days

	att_pct = 0
	prev_att = 0
	if n and frappe.db.exists("DocType", "Employee Checkin"):
		def _weekdays(a, b):
			nwd = 0
			cur = a
			while cur <= b:
				if cur.weekday() < 5:
					nwd += 1
				cur = add_days(cur, 1)
			return max(1, nwd)

		wd = _weekdays(start, end)
		present = frappe.db.sql(
			"""
			select count(*) from (
				select distinct employee, date(`time`) as d
				from `tabEmployee Checkin`
				where date(`time`) between %s and %s
			) t
			""",
			(cstr(start), cstr(end)),
		)[0][0]
		att_pct = round((cint(present) / (n * wd)) * 100, 1) if n else 0
		pwd = _weekdays(prev_start, prev_end)
		pp = frappe.db.sql(
			"""
			select count(*) from (
				select distinct employee, date(`time`) as d
				from `tabEmployee Checkin`
				where date(`time`) between %s and %s
			) t
			""",
			(cstr(prev_start), cstr(prev_end)),
		)[0][0]
		prev_att = round((cint(pp) / (max(1, prev_n) * pwd)) * 100, 1)

	payload["kpis"] = {
		"employees": n,
		"employees_delta": _rpt_pct(n, prev_n),
		"joiners": joiners,
		"joiners_delta": _rpt_pct(joiners, prev_joiners),
		"exits": exits,
		"exits_delta": _rpt_pct(exits, prev_exits),
		"attendance_pct": att_pct,
		"attendance_delta": round(att_pct - prev_att, 1) if prev_att else (100 if att_pct else 0),
		"leave_taken": cint(leave_taken),
		"leave_delta": _rpt_pct(leave_taken, prev_leave),
	}

	year = today_d.year
	trend = []
	for m in range(1, 13):
		month_end = getdate(f"{year}-{m:02d}-{monthrange(year, m)[1]}")
		count = 0
		for e in emps:
			joined = getdate(e.date_of_joining) if e.get("date_of_joining") else None
			left = getdate(e.relieving_date) if e.get("relieving_date") else None
			if joined and joined <= month_end and (not left or left > month_end):
				count += 1
			elif not joined:
				count += 1
		trend.append({"label": month_end.strftime("%b"), "value": count})
	payload["headcount_trend"] = trend

	dept_c = Counter(cstr(e.department or "Others") for e in emps)
	payload["by_department"] = [{"name": k, "count": v} for k, v in dept_c.most_common(8)]
	des_c = Counter(cstr(e.designation or "Others") for e in emps)
	top = des_c.most_common(5)
	rest = sum(v for _, v in des_c.most_common()[5:])
	des_rows = [{"name": k, "count": v} for k, v in top]
	if rest:
		des_rows.append({"name": "Others", "count": rest})
	payload["by_designation"] = des_rows

	recent = frappe.get_all(
		RPT_DT,
		fields=["name", "title", "report_type", "date_from", "date_to", "department", "generated_by", "generated_on", "status", "modified"],
		limit_page_length=20,
		order_by="modified desc",
	)
	payload["recent"] = [_rpt_run_row(d) for d in recent]
	return payload


def export_people_report(roles, report, from_date=None, to_date=None, department=None):
	_require_manager(roles)
	report = cstr(report or "employee_directory").strip().lower().replace(" ", "_")
	start, end, _ = _month_bounds()
	if from_date:
		start = getdate(from_date)
	if to_date:
		end = getdate(to_date)
	dept = cstr(department or "").strip()
	emps = _rpt_employee_rows(dept or None)
	header = ["Name", "Department", "Value"]
	rows = []
	title = "HR Report"
	rtype = "Custom"
	if report in ("employee_directory", "employee"):
		title, rtype = "Employee Directory", "Employee"
		header = ["Employee", "Name", "Department", "Designation", "Status", "Date of Joining"]
		rows = [
			[e.name, e.employee_name or e.name, e.department or "", e.designation or "", e.status or "", cstr(e.date_of_joining or "")]
			for e in emps
		]
	elif report in ("attendance",):
		title, rtype = "Attendance Report", "Attendance"
		header = ["Employee", "Name", "Department"]
		rows = [[e.name, e.employee_name or e.name, e.department or ""] for e in emps]
	elif report in ("leave", "Leave"):
		title, rtype = "Leave Report", "Leave"
		header = ["Employee", "From", "To", "Type", "Status", "Days"]
		if frappe.db.exists("DocType", "Leave Application"):
			meta = frappe.get_meta("Leave Application")
			fields = ["employee", "from_date", "to_date", "status"]
			for f in ("leave_type", "total_leave_days", "employee_name"):
				if meta.has_field(f):
					fields.append(f)
			for r in frappe.get_all("Leave Application", fields=fields, limit_page_length=2000, order_by="from_date desc"):
				rows.append(
					[
						r.get("employee_name") or r.get("employee") or "",
						cstr(r.get("from_date") or ""),
						cstr(r.get("to_date") or ""),
						r.get("leave_type") or "",
						r.get("status") or "",
						cstr(r.get("total_leave_days") or ""),
					]
				)
	elif report in ("payroll", "Payroll"):
		title, rtype = "Payroll Report", "Payroll"
		header = ["Employee", "Posting Date", "Gross", "Net", "Status"]
		if frappe.db.exists("DocType", "Salary Slip"):
			for r in frappe.get_all(
				"Salary Slip",
				fields=["employee_name", "posting_date", "gross_pay", "net_pay", "status"],
				limit_page_length=500,
				order_by="posting_date desc",
			):
				rows.append([r.employee_name or "", cstr(r.posting_date or ""), cstr(r.gross_pay or 0), cstr(r.net_pay or 0), r.status or ""])
	else:
		title = cstr(report).replace("_", " ").title()
		rtype = next((t for t in RPT_TYPES if t.lower() == report), "Custom")
		header = ["Metric", "Value"]
		rows = [["Employees", str(len(emps))], ["Department", dept or "All"], ["From", cstr(start)], ["To", cstr(end)]]
	run = _rpt_log_run(title, rtype, start, end, dept or "All Departments")
	return {"title": title, "header": header, "rows": rows, "run": run}


# --------------------------------------------------------------------------- HR analytics

def _ax_emps(department=None):
	if not frappe.db.exists("DocType", "Employee"):
		return []
	filters = {}
	if department:
		filters["department"] = department
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "status", "date_of_joining"]
	for f in ("relieving_date", "reports_to", "gender"):
		if meta.has_field(f):
			fields.append(f)
	return frappe.get_all("Employee", filters=filters, fields=fields, limit_page_length=5000)


def _ax_active(e):
	return cstr(e.get("status") or "Active") not in ("Left", "Inactive", "Suspended")


def _ax_months(start, end):
	out = []
	cur = getdate(f"{start.year}-{start.month:02d}-01")
	last = getdate(f"{end.year}-{end.month:02d}-01")
	while cur <= last and len(out) < 12:
		me = getdate(f"{cur.year}-{cur.month:02d}-{monthrange(cur.year, cur.month)[1]}")
		out.append((cur.strftime("%b"), cur, me))
		cur = add_months(cur, 1)
	return out


def _ax_weekdays(a, b):
	nwd = 0
	cur = a
	guard = 0
	while cur <= b and guard < 400:
		if cur.weekday() < 5:
			nwd += 1
		cur = add_days(cur, 1)
		guard += 1
	return max(1, nwd)


def _ax_leave_bucket(name):
	s = cstr(name).lower()
	if "casual" in s or s in ("cl", "c.l"):
		return "Casual"
	if "sick" in s or "medical" in s or s in ("sl", "s.l"):
		return "Sick"
	if "earn" in s or "privilege" in s or "annual" in s or s in ("el", "pl", "e.l"):
		return "Earned"
	return "Other"


def _ax_tenure_bucket(joined, today_d):
	if not joined:
		return "1 - 3 Years"
	years = max(0, (today_d - getdate(joined)).days / 365.25)
	if years < 1:
		return "< 1 Year"
	if years < 3:
		return "1 - 3 Years"
	if years < 5:
		return "3 - 5 Years"
	if years < 10:
		return "5 - 10 Years"
	return "> 10 Years"


def get_people_analytics(roles, from_date=None, to_date=None, department=None):
	manager = is_people_manager(roles)
	today_d = getdate(today())
	start = getdate(f"{today_d.year}-01-01")
	end = getdate(f"{today_d.year}-12-31")
	if from_date:
		start = getdate(from_date)
	if to_date:
		end = getdate(to_date)
	dept = cstr(department or "").strip()
	prev_start = add_years(start, -1)
	prev_end = add_years(end, -1)
	payload = {
		"available": True,
		"is_manager": manager,
		"from_date": cstr(start),
		"to_date": cstr(end),
		"departments": [],
		"employees": [],
		"managers": [],
		"kpis": {
			"employees": 0,
			"employees_delta": 0,
			"joiners": 0,
			"joiners_delta": 0,
			"exits": 0,
			"exits_delta": 0,
			"attendance_pct": 0,
			"attendance_delta": 0,
			"leave_avg": 0,
			"leave_delta": 0,
			"performance_avg": 0,
			"performance_delta": 0,
		},
		"headcount_trend": [],
		"by_department": [],
		"joiners_exits": [],
		"attendance_mix": [],
		"leave_trend": [],
		"tenure": [],
		"top_departments": [],
		"funnel": [],
		"insights": [],
		"diversity": [],
		"training": [],
		"payroll": {"slips": 0, "net": 0},
		"assets": {"total": 0, "assigned": 0},
	}
	emps = _ax_emps(dept or None)
	payload["departments"] = sorted({cstr(e.department) for e in emps if e.get("department")})
	payload["employees"] = [{"id": e.name, "name": e.employee_name or e.name} for e in emps if _ax_active(e)][:200]
	payload["managers"] = [
		{"id": e.name, "name": e.employee_name or e.name}
		for e in emps
		if "manager" in cstr(e.get("designation")).lower() or "head" in cstr(e.get("designation")).lower()
	][:80]
	active = [e for e in emps if _ax_active(e)]
	n = len(active)
	prev_n = sum(1 for e in emps if e.get("date_of_joining") and getdate(e.date_of_joining) <= prev_end and (not e.get("relieving_date") or getdate(e.relieving_date) > prev_end))
	joiners = sum(1 for e in emps if e.get("date_of_joining") and start <= getdate(e.date_of_joining) <= end)
	prev_joiners = sum(1 for e in emps if e.get("date_of_joining") and prev_start <= getdate(e.date_of_joining) <= prev_end)
	exits = sum(1 for e in emps if e.get("relieving_date") and start <= getdate(e.relieving_date) <= end)
	prev_exits = sum(1 for e in emps if e.get("relieving_date") and prev_start <= getdate(e.relieving_date) <= prev_end)

	leave_days = 0.0
	prev_leave = 0.0
	leave_buckets = ("Casual", "Sick", "Earned", "Other")
	months = _ax_months(start, end)
	leave_month = {lab: {b: 0.0 for b in leave_buckets} for lab, _, _ in months}
	half_days = 0
	if frappe.db.exists("DocType", "Leave Application"):
		meta = frappe.get_meta("Leave Application")
		fields = ["from_date", "status"]
		for f in ("total_leave_days", "leave_type", "half_day"):
			if meta.has_field(f):
				fields.append(f)
		for r in frappe.get_all("Leave Application", fields=fields, filters={"status": ("in", ["Approved", "Completed"])}, limit_page_length=5000):
			d = getdate(r.from_date) if r.from_date else None
			days = flt(r.get("total_leave_days"))
			if not d:
				continue
			if getattr(r, "half_day", None) in (1, "1", True):
				if start <= d <= end:
					half_days += 1
			if start <= d <= end:
				leave_days += days
				lab = d.strftime("%b")
				if lab in leave_month:
					leave_month[lab][_ax_leave_bucket(r.get("leave_type"))] += days
			elif prev_start <= d <= prev_end:
				prev_leave += days

	att_pct = 0
	prev_att = 0
	present = 0
	if n and frappe.db.exists("DocType", "Employee Checkin"):
		wd = _ax_weekdays(start, end)
		present = cint(
			frappe.db.sql(
				"""
				select count(*) from (
					select distinct employee, date(`time`) as d
					from `tabEmployee Checkin`
					where date(`time`) between %s and %s
				) t
				""",
				(cstr(start), cstr(end)),
			)[0][0]
		)
		att_pct = round((present / (n * wd)) * 100, 1)
		pwd = _ax_weekdays(prev_start, prev_end)
		pp = cint(
			frappe.db.sql(
				"""
				select count(*) from (
					select distinct employee, date(`time`) as d
					from `tabEmployee Checkin`
					where date(`time`) between %s and %s
				) t
				""",
				(cstr(prev_start), cstr(prev_end)),
			)[0][0]
		)
		prev_att = round((pp / (max(1, prev_n) * pwd)) * 100, 1)

	expected = max(1, n * _ax_weekdays(start, end))
	leave_full = max(0, leave_days - half_days * 0.5)
	absent = max(0, expected - present - leave_full - half_days * 0.5)
	mix_total = present + absent + leave_full + half_days * 0.5 or 1
	payload["attendance_mix"] = [
		{"name": "Present", "pct": round(present / mix_total * 100)},
		{"name": "Absent", "pct": round(absent / mix_total * 100)},
		{"name": "On Leave", "pct": round(leave_full / mix_total * 100)},
		{"name": "Half Day", "pct": round((half_days * 0.5) / mix_total * 100)},
	]

	perf_now = []
	perf_prev = []
	dept_rate = {}
	if frappe.db.exists("DocType", PERFORMANCE_REVIEW_DOCTYPE):
		for r in frappe.get_all(PERFORMANCE_REVIEW_DOCTYPE, fields=["employee", "period", "rating"], limit_page_length=5000):
			d = getdate(r.period) if r.period else None
			val = flt(r.rating)
			if not d:
				continue
			if start <= d <= end:
				perf_now.append(val)
				emp = next((e for e in emps if e.name == r.employee), None)
				key = (emp.department if emp and emp.department else "Others")
				dept_rate.setdefault(key, []).append(val)
			elif prev_start <= d <= prev_end:
				perf_prev.append(val)
	perf_avg = round(sum(perf_now) / len(perf_now), 1) if perf_now else 0
	prev_perf = round(sum(perf_prev) / len(perf_prev), 1) if perf_prev else 0
	leave_avg = round(leave_days / max(1, n), 1)
	prev_leave_avg = round(prev_leave / max(1, prev_n or n), 1)

	payload["kpis"] = {
		"employees": n,
		"employees_delta": _rpt_pct(n, prev_n),
		"joiners": joiners,
		"joiners_delta": _rpt_pct(joiners, prev_joiners),
		"exits": exits,
		"exits_delta": _rpt_pct(exits, prev_exits),
		"attendance_pct": att_pct,
		"attendance_delta": round(att_pct - prev_att, 1) if prev_att else (100 if att_pct else 0),
		"leave_avg": leave_avg,
		"leave_delta": _rpt_pct(leave_avg, prev_leave_avg),
		"performance_avg": perf_avg,
		"performance_delta": _rpt_pct(perf_avg, prev_perf) if prev_perf else (100 if perf_avg else 0),
	}

	trend = []
	jx = []
	for lab, ms, me in months:
		count = 0
		j = x = 0
		for e in emps:
			joined = getdate(e.date_of_joining) if e.get("date_of_joining") else None
			left = getdate(e.relieving_date) if e.get("relieving_date") else None
			if joined and ms <= joined <= me:
				j += 1
			if left and ms <= left <= me:
				x += 1
			if (not joined or joined <= me) and (not left or left > me):
				count += 1
		trend.append({"label": lab, "value": count})
		jx.append({"label": lab, "joiners": j, "exits": x})
	payload["headcount_trend"] = trend
	payload["joiners_exits"] = jx
	payload["leave_trend"] = [{"label": lab, **leave_month[lab]} for lab, _, _ in months]

	dept_c = Counter(cstr(e.department or "Others") for e in active)
	payload["by_department"] = [{"name": k, "count": v} for k, v in dept_c.most_common(8)]
	ten_order = ["< 1 Year", "1 - 3 Years", "3 - 5 Years", "5 - 10 Years", "> 10 Years"]
	ten_c = Counter(_ax_tenure_bucket(e.get("date_of_joining"), today_d) for e in active)
	payload["tenure"] = [{"name": k, "count": cint(ten_c.get(k))} for k in ten_order]

	top = []
	for name, count in dept_c.most_common(8):
		rates = dept_rate.get(name) or []
		top.append({"name": name, "rating": round(sum(rates) / len(rates), 1) if rates else 0, "employees": count})
	top.sort(key=lambda r: (-r["rating"], -r["employees"]))
	payload["top_departments"] = top[:5]

	funnel = [
		{"name": "Applications", "value": 0, "color": "#22d3ee"},
		{"name": "Screened", "value": 0, "color": "#4ade80"},
		{"name": "Interviewed", "value": 0, "color": "#a78bfa"},
		{"name": "Offered", "value": 0, "color": "#fb7185"},
		{"name": "Hired", "value": 0, "color": "#f59e0b"},
	]
	if frappe.db.exists("DocType", HIRE_CAND_DT):
		cands = frappe.get_all(HIRE_CAND_DT, fields=["stage"], limit_page_length=20000)
		st = Counter(cstr(c.stage or "New") for c in cands)
		apps = len(cands)
		hired_n = sum(st[s] for s in st if s.lower() in ("hired", "joined"))
		offered = hired_n + sum(st[s] for s in st if "offer" in s.lower())
		interviewed = offered + sum(st[s] for s in st if "interview" in s.lower())
		screened = interviewed + sum(st[s] for s in st if "screen" in s.lower())
		if screened < apps:
			screened = max(screened, min(apps, screened + st.get("New", 0) // 2))
		funnel = [
			{"name": "Applications", "value": apps, "color": "#22d3ee"},
			{"name": "Screened", "value": screened, "color": "#4ade80"},
			{"name": "Interviewed", "value": interviewed, "color": "#a78bfa"},
			{"name": "Offered", "value": offered, "color": "#fb7185"},
			{"name": "Hired", "value": hired_n, "color": "#f59e0b"},
		]
	payload["funnel"] = funnel

	k = payload["kpis"]
	insights = []
	if k["employees_delta"]:
		insights.append({"tone": "green", "icon": "trendUp", "text": f"Headcount changed by {k['employees_delta']}% compared to last year."})
	if k["joiners_delta"]:
		insights.append({"tone": "green", "icon": "userPlus", "text": f"New joiners are {abs(k['joiners_delta'])}% {'higher' if k['joiners_delta'] > 0 else 'lower'} than the previous period."})
	if k["exits_delta"]:
		insights.append({"tone": "rose", "icon": "userMinus", "text": f"Employee exits {'reduced' if k['exits_delta'] < 0 else 'increased'} by {abs(k['exits_delta'])}%."})
	if k["attendance_pct"]:
		insights.append({"tone": "orange", "icon": "calendar", "text": f"Average attendance is {k['attendance_pct']}%."})
	if k["leave_delta"]:
		insights.append({"tone": "amber", "icon": "clock", "text": f"Average leave taken changed by {k['leave_delta']}%."})
	if k["performance_delta"]:
		insights.append({"tone": "violet", "icon": "award", "text": f"Performance score changed by {k['performance_delta']}%."})
	if not insights:
		insights = [
			{"tone": "green", "icon": "users", "text": f"{n} active employees in the selected period."},
			{"tone": "blue", "icon": "userPlus", "text": f"{joiners} new joiners recorded."},
			{"tone": "rose", "icon": "userMinus", "text": f"{exits} exits recorded."},
		]
	payload["insights"] = insights[:6]

	gen = Counter(cstr(e.get("gender") or "Not specified") for e in active)
	payload["diversity"] = [{"name": k, "count": v} for k, v in gen.most_common()]
	if frappe.db.exists("DocType", TRAINING_ASSIGN_DT):
		stt = Counter(cstr(r.status or "Pending") for r in frappe.get_all(TRAINING_ASSIGN_DT, fields=["status"], limit_page_length=5000))
		payload["training"] = [{"name": k, "count": v} for k, v in stt.most_common()]
	if frappe.db.exists("DocType", "Salary Slip"):
		slips = frappe.get_all("Salary Slip", fields=["net_pay"], limit_page_length=2000)
		payload["payroll"] = {"slips": len(slips), "net": round(sum(flt(s.net_pay) for s in slips), 2)}
	if frappe.db.exists("DocType", ASSET_DT):
		rows = frappe.get_all(ASSET_DT, fields=["status"], limit_page_length=2000)
		payload["assets"] = {
			"total": len(rows),
			"assigned": sum(1 for r in rows if cstr(r.status).lower() in ("assigned", "in use", "issued")),
		}
	return payload


def export_people_analytics(roles, kind=None, from_date=None, to_date=None, department=None):
	_require_manager(roles)
	board = get_people_analytics(roles, from_date, to_date, department)
	kind = cstr(kind or "overview").strip().lower()
	k = board["kpis"]
	if kind in ("headcount", "trend"):
		header, rows, title = ["Month", "Headcount"], [[r["label"], str(r["value"])] for r in board["headcount_trend"]], "Headcount Trend"
	elif kind in ("attendance",):
		header, rows, title = ["Status", "%"], [[r["name"], str(r["pct"])] for r in board["attendance_mix"]], "Attendance Mix"
	elif kind in ("recruitment", "funnel"):
		header, rows, title = ["Stage", "Count"], [[r["name"], str(r["value"])] for r in board["funnel"]], "Recruitment Funnel"
	elif kind in ("insights",):
		header, rows, title = ["Insight"], [[r["text"]] for r in board["insights"]], "Workforce Insights"
	else:
		header = ["Metric", "Value"]
		rows = [
			["Total Employees", str(k["employees"])],
			["New Joiners", str(k["joiners"])],
			["Exits", str(k["exits"])],
			["Avg Attendance %", str(k["attendance_pct"])],
			["Avg Leave Days", str(k["leave_avg"])],
			["Avg Performance", str(k["performance_avg"])],
		]
		title = "Analytics Overview"
	return {"title": title, "header": header, "rows": rows}


# --------------------------------------------------------------------------- HR geofence locations

GEO_DT = "People Geofence Location"
GEO_TONES = ("blue", "green", "rose", "violet", "purple", "amber", "cyan", "orange")
SEED_GEOFENCES = (
	{"title": "Central Office", "subtitle": "Head Office", "address": "Ashoknagar, Mumbai\nMaharashtra", "latitude": 19.0865, "longitude": 72.888, "radius_m": 100, "status": "Active", "tone": "blue", "department": "Operations", "site_type": "Head Office"},
	{"title": "Branch Office", "subtitle": "Branch Office", "address": "MG Road, Bangalore\nKarnataka", "latitude": 12.9756, "longitude": 77.6066, "radius_m": 150, "status": "Active", "tone": "green", "department": "Operations", "site_type": "Branch Office"},
	{"title": "Warehouse", "subtitle": "Logistics", "address": "TTC Industrial Area, Navi Mumbai\nMaharashtra", "latitude": 19.1052, "longitude": 73.0204, "radius_m": 200, "status": "Active", "tone": "rose", "department": "Operations", "site_type": "Warehouse"},
	{"title": "Client Site - Pune", "subtitle": "Project Location", "address": "Hinjewadi, Pune\nMaharashtra", "latitude": 18.5913, "longitude": 73.7389, "radius_m": 100, "status": "Active", "tone": "violet", "department": "Sales", "site_type": "Client Site"},
	{"title": "Remote Office", "subtitle": "Work From Office", "address": "Whitefield, Bangalore\nKarnataka", "latitude": 12.9698, "longitude": 77.7499, "radius_m": 150, "status": "Inactive", "tone": "purple", "department": "IT", "site_type": "Remote Office"},
	{"title": "Sales Hub", "subtitle": "Regional Office", "address": "Andheri, Mumbai\nMaharashtra", "latitude": 19.1197, "longitude": 72.8468, "radius_m": 120, "status": "Active", "tone": "amber", "department": "Sales", "site_type": "Sales Hub"},
	{"title": "Clinic Hub", "subtitle": "Collection Centre", "address": "Bandra, Mumbai\nMaharashtra", "latitude": 19.0596, "longitude": 72.8295, "radius_m": 120, "status": "Active", "tone": "cyan", "department": "Operations", "site_type": "Clinic"},
	{"title": "Thane Point", "subtitle": "Collection Centre", "address": "Thane West, Thane\nMaharashtra", "latitude": 19.2183, "longitude": 72.9781, "radius_m": 100, "status": "Active", "tone": "orange", "department": "Operations", "site_type": "Collection Point"},
)


def ensure_people_geofence_location_doctype():
	try:
		_ensure_custom_doctype(
			GEO_DT,
			[
				{"fieldname": "title", "label": "Location Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "subtitle", "label": "Site Type", "fieldtype": "Data"},
				{"fieldname": "address", "label": "Address", "fieldtype": "Small Text"},
				{"fieldname": "latitude", "label": "Latitude", "fieldtype": "Float", "precision": 8},
				{"fieldname": "longitude", "label": "Longitude", "fieldtype": "Float", "precision": 8},
				{"fieldname": "radius_m", "label": "Radius (m)", "fieldtype": "Int", "default": "100", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nInactive", "default": "Active", "in_list_view": 1},
				{"fieldname": "department", "label": "Department", "fieldtype": "Data"},
				{"fieldname": "site_type", "label": "Site Type", "fieldtype": "Data"},
				{"fieldname": "tone", "label": "Tone", "fieldtype": "Data"},
				{"fieldname": "legacy_ref", "label": "Legacy Ref", "fieldtype": "Data", "read_only": 1},
			],
		)
		return True
	except Exception:
		frappe.log_error(title="ensure_people_geofence_location_doctype", message=frappe.get_traceback())
		return False


def _seed_people_geofences():
	if frappe.db.count(GEO_DT):
		return 0
	created = 0
	hq = _resolve_default_hq_coords()
	for i, row in enumerate(SEED_GEOFENCES):
		ref = f"seed:{frappe.scrub(row['title'])}"
		if frappe.db.exists(GEO_DT, {"legacy_ref": ref}):
			continue
		data = dict(row)
		if i == 0 and hq:
			data["latitude"] = hq["latitude"]
			data["longitude"] = hq["longitude"]
			data["title"] = data["title"]
		frappe.get_doc({"doctype": GEO_DT, **data, "legacy_ref": ref}).insert(ignore_permissions=True)
		created += 1
	return created


def _geo_row(d, counts=None):
	title = d.get("title") or ""
	n = 0
	if counts:
		n = cint(counts.get(title) or 0)
	return {
		"id": d.get("name"),
		"title": title,
		"subtitle": d.get("subtitle") or d.get("site_type") or "",
		"address": d.get("address") or "",
		"latitude": flt(d.get("latitude")),
		"longitude": flt(d.get("longitude")),
		"radius_m": cint(d.get("radius_m") or 100),
		"status": d.get("status") or "Active",
		"department": d.get("department") or "",
		"site_type": d.get("site_type") or d.get("subtitle") or "",
		"tone": d.get("tone") if d.get("tone") in GEO_TONES else "blue",
		"employees": n,
	}


def get_people_geofences(roles):
	ok = ensure_people_geofence_location_doctype()
	ensure_people_geofence_fields()
	manager = is_people_manager(roles)
	payload = {
		"available": ok,
		"is_manager": manager,
		"kpis": {"total": 0, "assigned": 0, "active": 0, "inactive": 0},
		"locations": [],
		"employees": [],
		"departments": [],
		"sites": [],
		"hq": _resolve_default_hq_coords(),
	}
	if not ok:
		return payload
	try:
		_seed_people_geofences()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="seed_people_geofences", message=frappe.get_traceback())

	can_edit = bool(set(roles or []) & GEOFENCE_ADMIN_ROLES)
	payload["can_edit_employee_geofence"] = can_edit
	if can_edit:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import _maps_key

		payload["google_maps_api_key"] = _maps_key()
	emps = []
	if frappe.db.exists("DocType", "Employee"):
		emps = frappe.get_all(
			"Employee",
			filters={"status": "Active"},
			fields=_employee_geofence_fields(),
			limit_page_length=5000,
			order_by="employee_name asc",
		)
	counts = Counter(cstr(e.get("geofence_label")) for e in emps if e.get("geofence_label"))
	assigned = sum(1 for e in emps if cint(e.get("geofence_enabled")) and (e.get("geofence_label") or flt(e.get("work_latitude"))))
	locs = frappe.get_all(
		GEO_DT,
		fields=["name", "title", "subtitle", "address", "latitude", "longitude", "radius_m", "status", "department", "site_type", "tone"],
		limit_page_length=200,
		order_by="creation asc",
	)
	payload["locations"] = [_geo_row(d, counts) for d in locs]
	payload["employees"] = [_employee_geofence_row(e) for e in emps[:2000]]
	payload["departments"] = sorted({cstr(e.department) for e in emps if e.get("department")})
	payload["sites"] = [r["title"] for r in payload["locations"]]
	active = sum(1 for r in payload["locations"] if r["status"] == "Active")
	payload["kpis"] = {
		"total": len(payload["locations"]),
		"assigned": assigned,
		"active": active,
		"inactive": len(payload["locations"]) - active,
		"overrides": sum(1 for r in payload["employees"] if r["override_active"]),
	}
	return payload


def save_people_geofence(roles, data):
	_require_manager(roles)
	if not ensure_people_geofence_location_doctype():
		frappe.throw(_("Unable to save geofence"))
	data = data or {}
	name = cstr(data.get("id") or data.get("name") or "").strip()
	title = cstr(data.get("title") or "").strip()
	if not title:
		frappe.throw(_("Location Name is required"))
	lat = flt(data.get("latitude"))
	lng = flt(data.get("longitude"))
	radius = max(50, min(500, cint(data.get("radius_m") or 100)))
	status = "Active" if cstr(data.get("status") or "Active") == "Active" else "Inactive"
	fields = {
		"title": title[:140],
		"subtitle": cstr(data.get("subtitle") or data.get("site_type") or "")[:140],
		"address": cstr(data.get("address") or "")[:500],
		"latitude": lat,
		"longitude": lng,
		"radius_m": radius,
		"status": status,
		"department": cstr(data.get("department") or "")[:140],
		"site_type": cstr(data.get("site_type") or data.get("subtitle") or "")[:140],
		"tone": data.get("tone") if data.get("tone") in GEO_TONES else "blue",
	}
	old_title = None
	if name and frappe.db.exists(GEO_DT, name):
		old_title = frappe.db.get_value(GEO_DT, name, "title")
		doc = frappe.get_doc(GEO_DT, name)
		doc.update(fields)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": GEO_DT, **fields})
		doc.insert(ignore_permissions=True)
	if old_title and old_title != title and frappe.db.exists("DocType", "Employee"):
		for emp in frappe.get_all("Employee", filters={"geofence_label": old_title}, pluck="name"):
			frappe.db.set_value(
				"Employee",
				emp,
				{"geofence_label": title, "work_latitude": lat, "work_longitude": lng, "geofence_radius_m": radius, "geofence_enabled": 1 if status == "Active" else 0},
				update_modified=False,
			)
	return _geo_row(doc.as_dict())


def assign_people_geofence(roles, geofence=None, employees=None):
	_require_manager(roles)
	ensure_people_geofence_fields()
	geo_id = cstr(geofence or "").strip()
	ids = employees if isinstance(employees, (list, tuple)) else []
	if isinstance(employees, str):
		try:
			ids = frappe.parse_json(employees) or []
		except Exception:
			ids = [employees] if employees else []
	if not geo_id or not frappe.db.exists(GEO_DT, geo_id):
		frappe.throw(_("Select a geofence location"))
	loc = frappe.get_doc(GEO_DT, geo_id)
	updated = 0
	enabled = 1 if loc.status == "Active" else 0
	has_address = frappe.get_meta("Employee").has_field("geofence_address")
	for emp in ids:
		if not emp or not frappe.db.exists("Employee", emp):
			continue
		values = {
			"geofence_enabled": enabled,
			"geofence_label": loc.title,
			"work_latitude": flt(loc.latitude),
			"work_longitude": flt(loc.longitude),
			"geofence_radius_m": cint(loc.radius_m) or DEFAULT_PEOPLE_GEOFENCE_M,
		}
		if has_address:
			values["geofence_address"] = loc.address or ""
		frappe.db.set_value("Employee", emp, values, update_modified=False)
		updated += 1
	frappe.db.commit()
	return {"updated": updated, "geofence": _geo_row(loc.as_dict())}


ROLE_DT = "People Access Role"
ASSIGN_DT = "People Access Assignment"
AUDIT_DT = "People Access Audit"
ROLE_BLOCKED = frozenset({"Administrator", "System Manager"})
ROLE_GRANTABLE = PEOPLE_STAFF_ROLES | frozenset({"Health System Admin"})
ROLE_TONES = ("blue", "green", "violet", "amber", "rose", "cyan", "orange", "pink")
PORTAL_CATALOG = (
	{"id": "hrms", "label": "HRMS Portal", "hint": "Attendance, Leave, HR, Documents"},
	{"id": "employee", "label": "Employee Portal", "hint": "Self-service, Profile, etc."},
	{"id": "lab", "label": "Lab Technician Portal", "hint": "Lab Reports, Sample Management"},
	{"id": "manager", "label": "Manager Portal", "hint": "Team Management, Approvals, Reports"},
	{"id": "partner", "label": "Partner/B2B Portal", "hint": "Franchise/Partner Access"},
	{"id": "recruitment", "label": "Recruitment Portal", "hint": "Job Posting, Candidate Management"},
	{"id": "payroll", "label": "Payroll Portal", "hint": "Salary, Expenses, Reports"},
	{"id": "admin", "label": "Admin Portal", "hint": "System Settings, User Management"},
)
MODULE_CATALOG = (
	{"id": "dashboard", "label": "Dashboard"},
	{"id": "profile", "label": "My Profile", "children": (
		{"id": "view_profile", "label": "View Profile"},
		{"id": "edit_profile", "label": "Edit Profile"},
	)},
	{"id": "attendance", "label": "Attendance", "children": (
		{"id": "mark_attendance", "label": "Mark Attendance"},
		{"id": "view_attendance", "label": "View Attendance"},
	)},
	{"id": "leave", "label": "Leave", "children": (
		{"id": "apply_leave", "label": "Apply Leave"},
		{"id": "view_leave", "label": "View Leave Status"},
	)},
	{"id": "documents", "label": "Documents", "children": (
		{"id": "view_documents", "label": "View Documents"},
		{"id": "download_documents", "label": "Download Documents"},
	)},
)
ROLE_SEED = (
	{
		"title": "Super Admin",
		"description": "Full access to all modules and settings",
		"portals": "hrms,employee,lab,manager,partner,recruitment,payroll,admin",
		"frappe_role": "Health System Admin",
		"status": "Active",
		"tone": "blue",
		"permissions": "dashboard,profile,view_profile,edit_profile,attendance,mark_attendance,view_attendance,leave,apply_leave,view_leave,documents,view_documents,download_documents",
	},
	{
		"title": "HR Manager",
		"description": "Manage HR operations, employees, leave, payroll",
		"portals": "hrms,recruitment,payroll",
		"frappe_role": "HR Manager",
		"status": "Active",
		"tone": "green",
		"permissions": "dashboard,profile,view_profile,edit_profile,attendance,view_attendance,leave,apply_leave,view_leave,documents,view_documents,download_documents",
	},
	{
		"title": "Department Manager",
		"description": "Access to team data, approvals, reports",
		"portals": "hrms,employee",
		"frappe_role": "HR User",
		"status": "Active",
		"tone": "violet",
		"permissions": "dashboard,profile,view_profile,attendance,view_attendance,leave,view_leave,documents,view_documents",
	},
	{
		"title": "Employee",
		"description": "Self-service (attendance, leave, profile, etc.)",
		"portals": "employee",
		"frappe_role": "Employee",
		"status": "Active",
		"tone": "cyan",
		"permissions": "dashboard,profile,view_profile,edit_profile,attendance,mark_attendance,view_attendance,leave,apply_leave,view_leave,documents,view_documents",
	},
	{
		"title": "Lab Technician",
		"description": "Access to lab, test reports and assigned tasks",
		"portals": "lab,hrms",
		"frappe_role": "Lab Technician",
		"status": "Active",
		"tone": "amber",
		"permissions": "dashboard,profile,view_profile,attendance,mark_attendance,view_attendance,leave,apply_leave,view_leave",
	},
	{
		"title": "Partner/B2B User",
		"description": "Franchise/Partner access (orders, reports, support)",
		"portals": "partner",
		"frappe_role": "Franchisee Operator",
		"status": "Active",
		"tone": "orange",
		"permissions": "dashboard,profile,view_profile,documents,view_documents",
	},
	{
		"title": "Finance",
		"description": "Payroll, expenses, finance reports",
		"portals": "hrms,payroll",
		"frappe_role": "Accounts Manager",
		"status": "Inactive",
		"tone": "pink",
		"permissions": "dashboard,profile,view_profile,documents,view_documents,download_documents",
	},
	{
		"title": "IT Admin",
		"description": "Manage settings, integrations",
		"portals": "hrms,lab",
		"frappe_role": "Health System Admin",
		"status": "Active",
		"tone": "rose",
		"permissions": "dashboard,profile,view_profile,edit_profile,documents,view_documents,download_documents",
	},
	{
		"title": "Phlebotomist",
		"description": "Home collection and sample handling",
		"portals": "hrms,employee",
		"frappe_role": "Phlebotomist",
		"status": "Active",
		"tone": "green",
		"permissions": "dashboard,profile,view_profile,attendance,mark_attendance,view_attendance,leave,apply_leave,view_leave",
	},
	{
		"title": "Pathologist",
		"description": "Clinical reporting and lab oversight",
		"portals": "lab,hrms",
		"frappe_role": "Pathologist",
		"status": "Active",
		"tone": "violet",
		"permissions": "dashboard,profile,view_profile,attendance,view_attendance,leave,view_leave,documents,view_documents",
	},
	{
		"title": "Sales Representative",
		"description": "Field and centre sales workspace",
		"portals": "employee,partner",
		"frappe_role": "Sales Representative",
		"status": "Active",
		"tone": "amber",
		"permissions": "dashboard,profile,view_profile,edit_profile,attendance,mark_attendance,view_attendance,leave,apply_leave,view_leave",
	},
	{
		"title": "HR User",
		"description": "Day-to-day HR operations support",
		"portals": "hrms,employee",
		"frappe_role": "HR User",
		"status": "Active",
		"tone": "blue",
		"permissions": "dashboard,profile,view_profile,attendance,view_attendance,leave,view_leave,documents,view_documents",
	},
)


def _csv_ids(raw):
	if isinstance(raw, (list, tuple)):
		return [cstr(x).strip() for x in raw if cstr(x).strip()]
	text = cstr(raw or "")
	if text.startswith("["):
		try:
			parsed = frappe.parse_json(text) or []
			if isinstance(parsed, (list, tuple)):
				return [cstr(x).strip() for x in parsed if cstr(x).strip()]
		except Exception:
			pass
	return [part.strip() for part in text.replace("|", ",").split(",") if part.strip()]


def _portal_labels(ids):
	lookup = {p["id"]: p["label"] for p in PORTAL_CATALOG}
	return [lookup.get(pid, pid) for pid in ids]


def ensure_people_access_doctypes():
	created = []
	if _ensure_custom_doctype(
		ROLE_DT,
		[
			{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
			{"fieldname": "portals", "label": "Portals", "fieldtype": "Small Text"},
			{"fieldname": "frappe_role", "label": "Frappe Role", "fieldtype": "Data"},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nInactive", "default": "Active", "in_list_view": 1},
			{"fieldname": "tone", "label": "Tone", "fieldtype": "Data"},
			{"fieldname": "permissions", "label": "Permissions", "fieldtype": "Small Text"},
		],
	):
		created.append(ROLE_DT)
	if _ensure_custom_doctype(
		ASSIGN_DT,
		[
			{"fieldname": "employee", "label": "Employee", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "user", "label": "User", "fieldtype": "Data"},
			{"fieldname": "role_profile", "label": "Role Profile", "fieldtype": "Data"},
			{"fieldname": "role_title", "label": "Role Title", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "portals", "label": "Portals", "fieldtype": "Small Text"},
			{"fieldname": "permissions", "label": "Permissions", "fieldtype": "Small Text"},
			{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nInactive", "default": "Active"},
			{"fieldname": "login_id", "label": "Login ID", "fieldtype": "Data"},
		],
	):
		created.append(ASSIGN_DT)
	if _ensure_custom_doctype(
		AUDIT_DT,
		[
			{"fieldname": "actor", "label": "Actor", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "action", "label": "Action", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "target", "label": "Target", "fieldtype": "Data"},
			{"fieldname": "detail", "label": "Detail", "fieldtype": "Small Text"},
		],
	):
		created.append(AUDIT_DT)
	return created


def _seed_people_access_roles():
	if not frappe.db.exists("DocType", ROLE_DT):
		return
	if frappe.db.count(ROLE_DT):
		return
	for row in ROLE_SEED:
		frappe.get_doc({"doctype": ROLE_DT, **row}).insert(ignore_permissions=True)


def _log_people_access(action, target, detail):
	if not frappe.db.exists("DocType", AUDIT_DT):
		return
	frappe.get_doc(
		{
			"doctype": AUDIT_DT,
			"actor": frappe.session.user,
			"action": cstr(action)[:140],
			"target": cstr(target)[:140],
			"detail": cstr(detail)[:500],
		}
	).insert(ignore_permissions=True)


def _safe_grant_role(uid, role_name):
	role_name = cstr(role_name or "").strip()
	if not role_name or role_name in ROLE_BLOCKED or role_name not in ROLE_GRANTABLE:
		return False
	if not frappe.db.exists("Role", role_name):
		return False
	if frappe.db.exists("Has Role", {"parent": uid, "role": role_name}):
		return False
	name = frappe.generate_hash(length=10)
	frappe.db.sql(
		"""
		INSERT INTO `tabHas Role`
			(name, creation, modified, owner, modified_by, parent, parenttype, parentfield, role)
		VALUES
			(%s, NOW(), NOW(), 'Administrator', 'Administrator', %s, 'User', 'roles', %s)
		""",
		(name, uid, role_name),
	)
	return True


def _role_user_count(frappe_role):
	role_name = cstr(frappe_role or "").strip()
	if not role_name or not frappe.db.exists("DocType", "Has Role"):
		return 0
	return cint(frappe.db.count("Has Role", {"role": role_name, "parenttype": "User"}))


def _role_row(doc, users=None):
	portals = _csv_ids(doc.get("portals"))
	return {
		"id": doc.get("name"),
		"title": doc.get("title") or doc.get("name"),
		"description": doc.get("description") or "",
		"portals": portals,
		"portal_labels": _portal_labels(portals),
		"frappe_role": doc.get("frappe_role") or "",
		"status": "Active" if cstr(doc.get("status") or "Active") == "Active" else "Inactive",
		"tone": doc.get("tone") if doc.get("tone") in ROLE_TONES else "blue",
		"permissions": _csv_ids(doc.get("permissions")),
		"users": cint(users if users is not None else _role_user_count(doc.get("frappe_role"))),
	}


def _ensure_employee_user(emp, generate=False, password=None, login_id=None):
	from frappe.utils import random_string
	from frappe.utils.password import update_password

	email = cstr(emp.get("company_email") or emp.get("user_id") or "").strip().lower()
	if not email:
		slug = cstr(emp.name).replace(" ", "").lower()
		email = f"{slug}@health.local"
	full_name = cstr(emp.get("employee_name") or emp.name)
	parts = full_name.split(None, 1)
	temp = None
	created = False
	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
		if generate or cint(user.enabled) == 0:
			user.enabled = 1
			user.user_type = "System User"
			user.save(ignore_permissions=True)
	else:
		if not generate:
			frappe.throw(_("This employee has no login. Turn on Auto generate credentials."))
		temp = cstr(password or "").strip() or f"Access@{random_string(8)}"
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": parts[0],
				"last_name": parts[1] if len(parts) > 1 else "",
				"full_name": full_name,
				"send_welcome_email": 0,
				"user_type": "System User",
				"enabled": 1,
			}
		)
		if login_id:
			user.username = cstr(login_id)[:140]
		user.insert(ignore_permissions=True)
		created = True
	if generate:
		temp = cstr(password or temp or "").strip() or f"Access@{random_string(8)}"
		update_password(user.name, temp)
	if not emp.get("user_id") or emp.get("user_id") != user.name:
		try:
			frappe.db.set_value("Employee", emp.name, "user_id", user.name, update_modified=False)
		except Exception:
			pass
	return user.name, temp, created


def get_people_roles(roles):
	if not is_people_eligible(roles):
		frappe.throw(_("People HRMS access required"), frappe.PermissionError)
	ensure_people_access_doctypes()
	try:
		_seed_people_access_roles()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="seed_people_access_roles", message=frappe.get_traceback())

	role_docs = []
	if frappe.db.exists("DocType", ROLE_DT):
		role_docs = frappe.get_all(
			ROLE_DT,
			fields=["name", "title", "description", "portals", "frappe_role", "status", "tone", "permissions"],
			limit_page_length=100,
			order_by="creation asc",
		)
	role_rows = [_role_row(d) for d in role_docs]

	emps = []
	if frappe.db.exists("DocType", "Employee"):
		emps = frappe.get_all(
			"Employee",
			fields=["name", "employee_name", "department", "designation", "status", "company_email", "user_id"],
			limit_page_length=2000,
			order_by="employee_name asc",
		)
	assign_map = {}
	if frappe.db.exists("DocType", ASSIGN_DT):
		for row in frappe.get_all(
			ASSIGN_DT,
			fields=["name", "employee", "user", "role_profile", "role_title", "portals", "permissions", "status", "login_id"],
			limit_page_length=2000,
		):
			assign_map[row.employee] = row

	users = []
	active_users = 0
	inactive_users = 0
	for emp in emps:
		uid = cstr(emp.get("user_id") or "").strip()
		enabled = 0
		user_roles = []
		if uid and frappe.db.exists("User", uid):
			enabled = cint(frappe.db.get_value("User", uid, "enabled") or 0)
			user_roles = frappe.get_all("Has Role", filters={"parent": uid}, pluck="role") or []
			if enabled:
				active_users += 1
			else:
				inactive_users += 1
		asg = assign_map.get(emp.name)
		users.append(
			{
				"id": emp.name,
				"name": emp.employee_name or emp.name,
				"department": emp.department or "",
				"designation": emp.designation or "",
				"email": emp.company_email or uid,
				"user_id": uid,
				"login_id": (asg.login_id if asg else "") or (uid.split("@")[0] if uid else emp.name),
				"status": "Active" if enabled else "Inactive",
				"enabled": enabled,
				"roles": user_roles,
				"role_title": (asg.role_title if asg else "") or (user_roles[0] if user_roles else ""),
				"portals": _csv_ids(asg.portals) if asg else [],
				"permissions": _csv_ids(asg.permissions) if asg else [],
				"assignment": asg.name if asg else "",
			}
		)

	audit = []
	if frappe.db.exists("DocType", AUDIT_DT):
		audit = frappe.get_all(
			AUDIT_DT,
			fields=["name", "actor", "action", "target", "detail", "creation"],
			limit_page_length=80,
			order_by="creation desc",
		)
		audit = [
			{
				"id": r.name,
				"actor": r.actor or "",
				"action": r.action or "",
				"target": r.target or "",
				"detail": r.detail or "",
				"when": cstr(r.creation),
			}
			for r in audit
		]

	grantable = sorted(r for r in ROLE_GRANTABLE if r not in ROLE_BLOCKED and frappe.db.exists("Role", r))
	return {
		"available": True,
		"is_manager": is_people_manager(roles),
		"kpis": {
			"employees": len(emps),
			"roles": len(role_rows),
			"active_users": active_users,
			"inactive_users": inactive_users,
			"portals": len(PORTAL_CATALOG),
			"active_delta": 0,
			"inactive_delta": 0,
		},
		"roles": role_rows,
		"users": users,
		"employees": [
			{
				"id": e.name,
				"name": e.employee_name or e.name,
				"department": e.department or "",
				"designation": e.designation or "",
				"email": e.company_email or e.user_id or "",
				"user_id": e.user_id or "",
			}
			for e in emps[:400]
		],
		"portals": list(PORTAL_CATALOG),
		"modules": [
			{
				"id": m["id"],
				"label": m["label"],
				"children": [dict(c) for c in m.get("children") or ()],
			}
			for m in MODULE_CATALOG
		],
		"frappe_roles": grantable,
		"audit": audit,
	}


def save_people_role(roles, data):
	_require_manager(roles)
	ensure_people_access_doctypes()
	data = data or {}
	name = cstr(data.get("id") or data.get("name") or "").strip()
	title = cstr(data.get("title") or "").strip()
	if not title:
		frappe.throw(_("Role Name is required"))
	mapped = cstr(data.get("frappe_role") or "").strip()
	if mapped in ROLE_BLOCKED:
		frappe.throw(_("That system role cannot be mapped from People HRMS"))
	fields = {
		"title": title[:140],
		"description": cstr(data.get("description") or "")[:500],
		"portals": ",".join(_csv_ids(data.get("portals"))),
		"frappe_role": mapped[:140],
		"status": "Active" if cstr(data.get("status") or "Active") == "Active" else "Inactive",
		"tone": data.get("tone") if data.get("tone") in ROLE_TONES else "blue",
		"permissions": ",".join(_csv_ids(data.get("permissions"))),
	}
	if name and frappe.db.exists(ROLE_DT, name):
		doc = frappe.get_doc(ROLE_DT, name)
		doc.update(fields)
		doc.save(ignore_permissions=True)
		action = "Updated role"
	else:
		doc = frappe.get_doc({"doctype": ROLE_DT, **fields})
		doc.insert(ignore_permissions=True)
		action = "Created role"
	_log_people_access(action, doc.title, fields["description"])
	frappe.db.commit()
	return _role_row(doc.as_dict())


def assign_people_access(roles, data):
	_require_manager(roles)
	ensure_people_access_doctypes()
	data = data or {}
	emp_id = cstr(data.get("employee") or "").strip()
	if not emp_id or not frappe.db.exists("Employee", emp_id):
		frappe.throw(_("Select an employee"))
	emp = frappe.get_doc("Employee", emp_id)
	role_id = cstr(data.get("role") or data.get("role_profile") or "").strip()
	profile = None
	if role_id and frappe.db.exists(ROLE_DT, role_id):
		profile = frappe.get_doc(ROLE_DT, role_id)
	portals = _csv_ids(data.get("portals")) or (_csv_ids(profile.portals) if profile else [])
	perms = _csv_ids(data.get("permissions")) or (_csv_ids(profile.permissions) if profile else [])
	status = "Active" if cstr(data.get("status") or "Active") == "Active" else "Inactive"
	generate = cint(data.get("generate") or data.get("auto_generate") or 0)
	password = cstr(data.get("password") or "").strip() or None
	login_id = cstr(data.get("login_id") or data.get("user_id") or "").strip()
	has_user = bool(cstr(emp.get("user_id") or "").strip() and frappe.db.exists("User", emp.user_id))
	uid, temp, created = _ensure_employee_user(
		emp,
		generate=bool((generate and not has_user) or password),
		password=password,
		login_id=login_id,
	)
	if uid and frappe.db.exists("User", uid):
		frappe.db.set_value("User", uid, "enabled", 1 if status == "Active" else 0, update_modified=False)
		mapped = cstr(profile.frappe_role if profile else data.get("frappe_role") or "").strip()
		if mapped:
			_safe_grant_role(uid, mapped)
		if mapped != "Employee":
			_safe_grant_role(uid, "Employee")
		try:
			from frappe.utils.user import clear_user_cache

			clear_user_cache(uid)
		except Exception:
			pass
	existing = frappe.db.get_value(ASSIGN_DT, {"employee": emp_id}, "name")
	fields = {
		"employee": emp_id,
		"user": uid or "",
		"role_profile": profile.name if profile else "",
		"role_title": (profile.title if profile else cstr(data.get("role_title") or ""))[:140],
		"portals": ",".join(portals),
		"permissions": ",".join(perms),
		"status": status,
		"login_id": login_id or (uid.split("@")[0] if uid else emp_id),
	}
	if existing:
		doc = frappe.get_doc(ASSIGN_DT, existing)
		doc.update(fields)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": ASSIGN_DT, **fields})
		doc.insert(ignore_permissions=True)
	_log_people_access(
		"Assigned access",
		emp.employee_name or emp_id,
		f"{fields['role_title']} · {', '.join(_portal_labels(portals))}",
	)
	frappe.db.commit()
	payload = {
		"assignment": doc.name,
		"employee": emp_id,
		"user": uid,
		"login_id": fields["login_id"],
		"created_user": created,
		"status": status,
	}
	if temp:
		payload["password"] = temp
	return payload


def export_people_roles(roles, kind=None):
	if not is_people_eligible(roles):
		frappe.throw(_("People HRMS access required"), frappe.PermissionError)
	board = get_people_roles(roles)
	kind = cstr(kind or "roles").strip().lower()
	if kind == "users":
		header = ["Employee", "ID", "Department", "Designation", "Role", "Login", "Status"]
		lines = [
			[u["name"], u["id"], u["department"], u["designation"], u["role_title"], u["login_id"], u["status"]]
			for u in board.get("users") or []
		]
	elif kind == "audit":
		header = ["When", "Actor", "Action", "Target", "Detail"]
		lines = [[a["when"], a["actor"], a["action"], a["target"], a["detail"]] for a in board.get("audit") or []]
	else:
		header = ["Role", "Portals", "Description", "Users", "Status", "Frappe Role"]
		lines = [
			[r["title"], "; ".join(r.get("portal_labels") or []), r["description"], r["users"], r["status"], r["frappe_role"]]
			for r in board.get("roles") or []
		]
	return {"kind": kind or "roles", "header": header, "lines": lines}


