"""
Phase 71 — Company Operations KPI dashboards (at-a-glance).

Creates:
- Whitelist KPI APIs (overview / lab / franchisee / pharmacy / clinical)
- Desk Page: hec-company-ops (tabbed boards)
- Native Number Cards + Dashboard Charts + Dashboards
- Workspace: HEC Company Ops (+ Clinical shortcuts)
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, today

MODULE = "Health Ecosystem Core"
PAGE_NAME = "hec-company-ops"
WORKSPACE_NAME = "Company Ops KPIs"


DASHBOARDS = (
	"HEC Company Overview",
	"HEC Lab Operations",
	"HEC Franchisee Network",
	"HEC Pharmacy & Purchase",
	"HEC Clinical Appointments",
	"HEC HR Operations",
)


def setup_phase71():
	ensure_ops_page()
	ensure_number_cards_and_charts()
	ensure_native_dashboards()
	ensure_ops_workspace()
	ensure_clinical_shortcuts()
	frappe.clear_cache()
	return {"ok": True, "phase": 71, "page": PAGE_NAME, "dashboards": list(DASHBOARDS)}


# ---------------------------------------------------------------------------
# KPI helpers
# ---------------------------------------------------------------------------


def _today():
	return getdate(today())


def _month_start(d=None):
	d = getdate(d or today())
	return d.replace(day=1)


def _count(doctype, filters=None):
	if not frappe.db.exists("DocType", doctype):
		return 0
	try:
		return cint(frappe.db.count(doctype, filters or {}))
	except Exception:
		return 0


def _sum(doctype, field, filters=None):
	if not frappe.db.exists("DocType", doctype):
		return 0.0
	if not frappe.get_meta(doctype).has_field(field):
		return 0.0
	try:
		conditions = ["1=1"]
		values = []
		for key, val in (filters or {}).items():
			if isinstance(val, (list, tuple)) and len(val) == 2 and val[0] in (">=", ">", "<=", "<", "=", "!="):
				conditions.append(f"`{key}` {val[0]} %s")
				values.append(val[1])
			elif isinstance(val, (list, tuple)) and len(val) == 2 and val[0] == "<":
				conditions.append(f"`{key}` < %s")
				values.append(val[1])
			else:
				conditions.append(f"`{key}` = %s")
				values.append(val)
		sql = f"select coalesce(sum(`{field}`),0) from `tab{doctype}` where " + " and ".join(conditions)
		return flt(frappe.db.sql(sql, values)[0][0])
	except Exception:
		frappe.log_error(title=f"hec_sum:{doctype}.{field}", message=frappe.get_traceback())
		return 0.0


def _trf_filters_today():
	return {"creation": [">=", str(_today())]}


def kpi_overview():
	d = _today()
	ms = _month_start(d)
	trf_today = _count("Customer TRF", {"creation": [">=", str(d)]})
	trf_month = _count("Customer TRF", {"creation": [">=", str(ms)]})
	rev_today = _sum("Customer TRF", "amount", {"creation": [">=", str(d)]})
	rev_month = _sum("Customer TRF", "amount", {"creation": [">=", str(ms)]})
	paid_today = _count(
		"Customer TRF",
		{"creation": [">=", str(d)], "razorpay_payment_status": "Paid"},
	)
	si_today = 0
	si_amt = 0.0
	if frappe.db.exists("DocType", "Sales Invoice"):
		si_today = _count(
			"Sales Invoice",
			{"docstatus": 1, "posting_date": [">=", str(d)]},
		)
		si_amt = _sum(
			"Sales Invoice",
			"grand_total",
			{"docstatus": 1, "posting_date": [">=", str(d)]},
		)
	open_appts = _count(
		"Doctor Appointment",
		{"appointment_date": [">=", str(d)]} if frappe.db.exists("DocType", "Doctor Appointment") else None,
	)
	# Prefer status-aware if field exists
	if frappe.db.exists("DocType", "Doctor Appointment"):
		meta = frappe.get_meta("Doctor Appointment")
		filters = {}
		if meta.has_field("appointment_date"):
			filters["appointment_date"] = [">=", str(d)]
		elif meta.has_field("scheduled_on"):
			filters["scheduled_on"] = [">=", str(d)]
		else:
			filters["creation"] = [">=", str(d)]
		if meta.has_field("status"):
			filters["status"] = ["not in", ["Cancelled", "No Show", "Completed"]]
		open_appts = _count("Doctor Appointment", filters)

	pharm = _count("Pharmacy Order", {"creation": [">=", str(d)]}) if frappe.db.exists("DocType", "Pharmacy Order") else 0
	pinv = _count("Purchase Invoice", {"creation": [">=", str(d)], "docstatus": ["<", 2]}) if frappe.db.exists("DocType", "Purchase Invoice") else 0

	pipeline = {}
	if frappe.db.exists("DocType", "Customer TRF"):
		for st in ("Booked", "Sample Collected", "In Lab", "Completed", "Cancelled"):
			pipeline[st] = _count("Customer TRF", {"order_status": st})

	return {
		"as_of": str(d),
		"trf_today": trf_today,
		"trf_month": trf_month,
		"revenue_today": rev_today,
		"revenue_month": rev_month,
		"paid_today": paid_today,
		"sales_invoices_today": si_today,
		"sales_invoice_amount_today": si_amt,
		"open_appointments": open_appts,
		"pharmacy_orders_today": pharm,
		"purchase_invoices_today": pinv,
		"trf_pipeline": pipeline,
	}


def kpi_lab():
	d = _today()
	by_status = {}
	for st in ("Booked", "Sample Collected", "In Lab", "Completed", "Cancelled"):
		by_status[st] = {
			"open": _count("Customer TRF", {"order_status": st}),
			"today": _count("Customer TRF", {"order_status": st, "creation": [">=", str(d)]}),
		}
	pending_pay = _count("Customer TRF", {"razorpay_payment_status": "Pending", "order_status": ["!=", "Cancelled"]})
	reports_open = 0
	reports_done = 0
	if frappe.db.exists("DocType", "Lab Report"):
		meta = frappe.get_meta("Lab Report")
		status_field = "status" if meta.has_field("status") else None
		if status_field:
			reports_open = _count("Lab Report", {status_field: ["in", ["Draft", "In Progress", "Pending"]]})
			reports_done = _count("Lab Report", {status_field: ["in", ["Authorized", "Completed", "Final"]], "modified": [">=", str(d)]})
		else:
			reports_open = _count("Lab Report", {"docstatus": 0})
			reports_done = _count("Lab Report", {"modified": [">=", str(d)]})
	# last 7 days TRF trend
	trend = []
	for i in range(6, -1, -1):
		day = add_days(d, -i)
		nxt = add_days(day, 1)
		c = _count("Customer TRF", {"creation": [">=", str(day)]}) - _count(
			"Customer TRF", {"creation": [">=", str(nxt)]}
		)
		amt = 0.0
		try:
			rows = frappe.db.sql(
				"""
				select coalesce(sum(amount),0) from `tabCustomer TRF`
				where creation >= %s and creation < %s
				""",
				(str(day), str(nxt)),
			)
			amt = flt(rows[0][0]) if rows else 0
		except Exception:
			amt = 0
		trend.append({"date": str(day), "trfs": max(c, 0), "amount": amt})
	return {
		"by_status": by_status,
		"pending_payment": pending_pay,
		"lab_reports_open": reports_open,
		"lab_reports_done_today": reports_done,
		"trend_7d": trend,
	}


def kpi_franchisee():
	d = _today()
	ms = _month_start(d)
	if not frappe.db.exists("DocType", "Franchisee Profile"):
		return {"centres": [], "today_bookings": 0, "month_bookings": 0}
	centres = frappe.get_all(
		"Franchisee Profile",
		fields=["name", "franchise_name"] if frappe.get_meta("Franchisee Profile").has_field("franchise_name") else ["name"],
		limit_page_length=200,
	)
	rows = []
	today_bookings = 0
	month_bookings = 0
	for c in centres:
		code = c.name
		t = _count("Customer TRF", {"franchisee_id": code, "creation": [">=", str(d)]})
		m = _count("Customer TRF", {"franchisee_id": code, "creation": [">=", str(ms)]})
		rev = _sum("Customer TRF", "amount", {"franchisee_id": code, "creation": [">=", str(ms)]})
		today_bookings += t
		month_bookings += m
		rows.append(
			{
				"franchisee_id": code,
				"franchise_name": c.get("franchise_name") or code,
				"today": t,
				"month": m,
				"month_revenue": rev,
			}
		)
	rows.sort(key=lambda r: (-r["month"], -r["today"], r["franchise_name"]))
	return {
		"today_bookings": today_bookings,
		"month_bookings": month_bookings,
		"centres": rows[:25],
		"active_centres": len([r for r in rows if r["month"] > 0]),
	}


def kpi_pharmacy_purchase():
	d = _today()
	ms = _month_start(d)
	out = {
		"pharmacy_orders_today": 0,
		"pharmacy_orders_month": 0,
		"pharmacy_gmv_month": 0.0,
		"pinv_today": 0,
		"pinv_month": 0,
		"pinv_amount_month": 0.0,
		"si_month": 0,
		"si_amount_month": 0.0,
	}
	if frappe.db.exists("DocType", "Pharmacy Order"):
		out["pharmacy_orders_today"] = _count("Pharmacy Order", {"creation": [">=", str(d)]})
		out["pharmacy_orders_month"] = _count("Pharmacy Order", {"creation": [">=", str(ms)]})
		meta = frappe.get_meta("Pharmacy Order")
		amt_field = "order_total" if meta.has_field("order_total") else ("grand_total" if meta.has_field("grand_total") else None)
		if amt_field:
			out["pharmacy_gmv_month"] = _sum("Pharmacy Order", amt_field, {"creation": [">=", str(ms)]})
	if frappe.db.exists("DocType", "Purchase Invoice"):
		out["pinv_today"] = _count("Purchase Invoice", {"posting_date": [">=", str(d)], "docstatus": ["<", 2]})
		out["pinv_month"] = _count("Purchase Invoice", {"posting_date": [">=", str(ms)], "docstatus": 1})
		out["pinv_amount_month"] = _sum(
			"Purchase Invoice", "grand_total", {"posting_date": [">=", str(ms)], "docstatus": 1}
		)
	if frappe.db.exists("DocType", "Sales Invoice"):
		out["si_month"] = _count("Sales Invoice", {"posting_date": [">=", str(ms)], "docstatus": 1})
		out["si_amount_month"] = _sum(
			"Sales Invoice", "grand_total", {"posting_date": [">=", str(ms)], "docstatus": 1}
		)
	return out


def kpi_clinical():
	d = _today()
	out = {
		"appointments_today": 0,
		"appointments_week": 0,
		"doctors": 0,
		"by_status": {},
	}
	if frappe.db.exists("DocType", "Doctor"):
		out["doctors"] = _count("Doctor")
	if not frappe.db.exists("DocType", "Doctor Appointment"):
		return out
	meta = frappe.get_meta("Doctor Appointment")
	date_field = "appointment_date" if meta.has_field("appointment_date") else (
		"scheduled_on" if meta.has_field("scheduled_on") else "creation"
	)
	week_start = add_days(d, -6)
	out["appointments_today"] = _count("Doctor Appointment", {date_field: [">=", str(d)]}) if date_field == "creation" else _count(
		"Doctor Appointment", {date_field: str(d)} if date_field == "appointment_date" else {date_field: [">=", str(d), "<", str(add_days(d, 1))]}
	)
	# simplify today count
	if date_field == "appointment_date":
		out["appointments_today"] = _count("Doctor Appointment", {date_field: str(d)})
	else:
		out["appointments_today"] = _count("Doctor Appointment", {"creation": [">=", str(d)]})
	out["appointments_week"] = _count("Doctor Appointment", {"creation": [">=", str(week_start)]})
	if meta.has_field("status"):
		for st in frappe.get_all("Doctor Appointment", fields=["status"], distinct=True, limit_page_length=20):
			s = st.status or "Unknown"
			out["by_status"][s] = _count("Doctor Appointment", {"status": s, "creation": [">=", str(week_start)]})
	return out


def kpi_hr():
	"""Read-only HR aggregates for Company Ops (headcount, leave, expenses, attendance)."""
	d = _today()
	out = {
		"headcount_active": 0,
		"on_leave_today": 0,
		"open_leave_applications": 0,
		"open_expense_claims": 0,
		"expense_claimed_month": 0.0,
		"attendance_present_today": 0,
		"attendance_absent_today": 0,
		"attendance_gaps_today": 0,
		"open_appraisals": 0,
		"scheduled_trainings": 0,
		"hr_available": False,
	}
	if not frappe.db.exists("DocType", "Employee"):
		return out
	out["hr_available"] = True
	emp_filters = {}
	if frappe.get_meta("Employee").has_field("status"):
		emp_filters["status"] = "Active"
	out["headcount_active"] = _count("Employee", emp_filters or None)

	if frappe.db.exists("DocType", "Leave Application"):
		la_meta = frappe.get_meta("Leave Application")
		open_filters = {}
		if la_meta.has_field("status"):
			open_filters["status"] = ["in", ["Open", "Applied"]]
		else:
			open_filters["docstatus"] = 0
		out["open_leave_applications"] = _count("Leave Application", open_filters)

		# On leave today: approved leave covering today
		try:
			rows = frappe.db.sql(
				"""
				select count(*) from `tabLeave Application`
				where docstatus < 2
				  and from_date <= %s and to_date >= %s
				  and ifnull(status, '') in ('Approved', 'Open', 'Applied')
				""",
				(str(d), str(d)),
			)
			out["on_leave_today"] = cint(rows[0][0]) if rows else 0
		except Exception:
			out["on_leave_today"] = 0

	if frappe.db.exists("DocType", "Expense Claim"):
		ec_meta = frappe.get_meta("Expense Claim")
		open_ec = {"docstatus": 0}
		if ec_meta.has_field("approval_status"):
			open_ec = {"approval_status": ["in", ["Draft", "Pending", "Unpaid"]]}
		out["open_expense_claims"] = _count("Expense Claim", open_ec)
		ms = _month_start(d)
		amt_field = "total_claimed_amount" if ec_meta.has_field("total_claimed_amount") else None
		if amt_field:
			out["expense_claimed_month"] = _sum(
				"Expense Claim",
				amt_field,
				{"posting_date": [">=", str(ms)], "docstatus": ["<", 2]}
				if ec_meta.has_field("posting_date")
				else {"creation": [">=", str(ms)]},
			)

	if frappe.db.exists("DocType", "Attendance"):
		att_meta = frappe.get_meta("Attendance")
		date_field = "attendance_date" if att_meta.has_field("attendance_date") else None
		if date_field:
			out["attendance_present_today"] = _count(
				"Attendance", {date_field: str(d), "status": "Present"} if att_meta.has_field("status") else {date_field: str(d)}
			)
			if att_meta.has_field("status"):
				out["attendance_absent_today"] = _count("Attendance", {date_field: str(d), "status": "Absent"})
			# Gap: active employees without attendance row today
			marked = _count("Attendance", {date_field: str(d)})
			out["attendance_gaps_today"] = max(cint(out["headcount_active"]) - cint(marked), 0)

	if frappe.db.exists("DocType", "Appraisal"):
		out["open_appraisals"] = _count("Appraisal", {"docstatus": 0})
	if frappe.db.exists("DocType", "Training Event"):
		out["scheduled_trainings"] = _count("Training Event", {"event_status": "Scheduled"})

	return out


@frappe.whitelist()
def api_get_company_ops_kpis(board=None):
	"""Return one or all KPI boards for the Company Ops page."""
	board = (board or frappe.form_dict.get("board") or "all").strip().lower()
	payload = {"ok": True, "generated_at": frappe.utils.now_datetime()}
	if board in ("all", "overview"):
		payload["overview"] = kpi_overview()
	if board in ("all", "lab"):
		payload["lab"] = kpi_lab()
	if board in ("all", "franchisee"):
		payload["franchisee"] = kpi_franchisee()
	if board in ("all", "pharmacy", "purchase"):
		payload["pharmacy_purchase"] = kpi_pharmacy_purchase()
	if board in ("all", "clinical"):
		payload["clinical"] = kpi_clinical()
	if board in ("all", "hr"):
		payload["hr"] = kpi_hr()
	return payload


# Number-card custom methods (Frappe Number Card type=Custom)
@frappe.whitelist()
def nc_trf_today():
	return _count("Customer TRF", {"creation": [">=", str(_today())]})


@frappe.whitelist()
def nc_trf_revenue_today():
	return _sum("Customer TRF", "amount", {"creation": [">=", str(_today())]})


@frappe.whitelist()
def nc_trf_in_lab():
	return _count("Customer TRF", {"order_status": "In Lab"})


@frappe.whitelist()
def nc_trf_completed_today():
	return _count("Customer TRF", {"order_status": "Completed", "modified": [">=", str(_today())]})


@frappe.whitelist()
def nc_pharmacy_today():
	return _count("Pharmacy Order", {"creation": [">=", str(_today())]}) if frappe.db.exists("DocType", "Pharmacy Order") else 0


@frappe.whitelist()
def nc_pinv_today():
	return _count("Purchase Invoice", {"posting_date": str(_today()), "docstatus": ["<", 2]}) if frappe.db.exists("DocType", "Purchase Invoice") else 0


@frappe.whitelist()
def nc_appts_today():
	return kpi_clinical().get("appointments_today") or 0


@frappe.whitelist()
def nc_franchisee_active():
	return kpi_franchisee().get("active_centres") or 0


# ---------------------------------------------------------------------------
# Desk Page
# ---------------------------------------------------------------------------


def ensure_ops_page():
	roles = [
		"System Manager",
		"Health System Admin",
		"Accounts Manager",
		"Accounts User",
		"Purchase Manager",
		"Sales Manager",
		"Stock Manager",
	]
	if frappe.db.exists("Page", PAGE_NAME):
		page = frappe.get_doc("Page", PAGE_NAME)
	else:
		page = frappe.get_doc(
			{
				"doctype": "Page",
				"page_name": PAGE_NAME,
				"title": "Company Operations",
				"module": MODULE,
				"standard": "Yes",
			}
		)
		page.insert(ignore_permissions=True)
	page.title = "Company Operations"
	page.module = MODULE
	page.roles = []
	for role in roles:
		if frappe.db.exists("Role", role):
			page.append("roles", {"role": role})
	page.save(ignore_permissions=True)
	_write_page_js()
	return PAGE_NAME


def _write_page_js():
	"""Ensure page JS exists under page module + assets + site-packages."""
	import os
	import shutil

	js = _ops_page_js()
	targets = []
	try:
		app_path = frappe.get_app_path("health_ecosystem_core")
		page_js = os.path.join(
			app_path,
			"health_ecosystem_core",
			"page",
			"hec_company_ops",
			"hec_company_ops.js",
		)
		targets.append(page_js)
		targets.append(os.path.join(app_path, "public", "js", "hec_company_ops.js"))
	except Exception:
		pass
	try:
		targets.append(frappe.get_site_path("assets", "health_ecosystem_core", "js", "hec_company_ops.js"))
	except Exception:
		pass
	try:
		import health_ecosystem_core

		pkg = os.path.dirname(health_ecosystem_core.__file__)
		targets.append(os.path.join(pkg, "public", "js", "hec_company_ops.js"))
		targets.append(
			os.path.join(pkg, "health_ecosystem_core", "page", "hec_company_ops", "hec_company_ops.js")
		)
	except Exception:
		pass

	for path in targets:
		try:
			os.makedirs(os.path.dirname(path), exist_ok=True)
			with open(path, "w", encoding="utf-8") as f:
				f.write(js)
		except Exception:
			pass
	return True


def _ops_page_js():
	return r"""
frappe.pages['hec-company-ops'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Company Operations'),
		single_column: true
	});
	wrapper.page = page;
	hec_ops.render(wrapper);
};

frappe.pages['hec-company-ops'].on_page_show = function(wrapper) {
	if (wrapper && wrapper._hec_ops_refresh) wrapper._hec_ops_refresh();
};

var hec_ops = {
	boards: [
		{id: 'overview', label: __('Company Overview')},
		{id: 'lab', label: __('Lab Operations')},
		{id: 'franchisee', label: __('Franchisee Network')},
		{id: 'pharmacy', label: __('Pharmacy & Purchase')},
		{id: 'clinical', label: __('Clinical Appointments')},
		{id: 'hr', label: __('HR')}
	],
	money: function(n) { return format_currency(flt(n)||0); },
	card: function(label, value, tone) {
		tone = tone || 'blue';
		return `<div class="hec-kpi-card hec-tone-${tone}"><div class="hec-kpi-label">${frappe.utils.escape_html(label)}</div><div class="hec-kpi-value">${value}</div></div>`;
	},
	css: function() {
		return `<style>
			.hec-ops { padding: 8px 4px 24px; }
			.hec-ops-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
			.hec-ops-tabs .btn.active { background:#1e40af; color:#fff; }
			.hec-kpi-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap:10px; margin-bottom:14px; }
			.hec-kpi-card { border:1px solid #cbd5e1; border-radius:8px; padding:12px; background:#fff; }
			.hec-kpi-label { font-size:12px; color:#64748b; margin-bottom:4px; }
			.hec-kpi-value { font-size:22px; font-weight:700; color:#0f172a; }
			.hec-tone-blue { border-top:3px solid #2563eb; }
			.hec-tone-green { border-top:3px solid #16a34a; }
			.hec-tone-amber { border-top:3px solid #d97706; }
			.hec-tone-rose { border-top:3px solid #e11d48; }
			.hec-tone-teal { border-top:3px solid #0d9488; }
			.hec-ops-table { width:100%; border-collapse:collapse; font-size:12px; background:#fff; }
			.hec-ops-table th, .hec-ops-table td { border:1px solid #e2e8f0; padding:6px 8px; text-align:left; }
			.hec-ops-table th { background:#f1f5f9; }
			.hec-ops-section { margin-top:8px; }
			.hec-ops-h { font-size:14px; font-weight:600; margin:12px 0 6px; color:#1e293b; }
		</style>`;
	},
	render: function(wrapper) {
		var me = this;
		var $body = $(wrapper).find('.layout-main-section');
		if (!$body.length) $body = $(wrapper);
		$body.html(me.css() + `<div class="hec-ops">
			<div class="hec-ops-tabs"></div>
			<div class="hec-ops-body text-muted">${__('Loading KPIs…')}</div>
		</div>`);
		var $tabs = $body.find('.hec-ops-tabs');
		me.boards.forEach(function(b, i) {
			var $b = $(`<button type="button" class="btn btn-sm btn-default" data-board="${b.id}">${b.label}</button>`);
			if (i===0) $b.addClass('active');
			$tabs.append($b);
		});
		function load(board) {
			$body.find('.hec-ops-tabs .btn').removeClass('active');
			$body.find(`.hec-ops-tabs .btn[data-board="${board}"]`).addClass('active');
			$body.find('.hec-ops-body').html(`<p class="text-muted">${__('Loading…')}</p>`);
			frappe.call({
				method: 'health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards.api_get_company_ops_kpis',
				args: { board: board === 'pharmacy' ? 'pharmacy' : board },
				callback: function(r) {
					var msg = r.message || {};
					$body.find('.hec-ops-body').html(me.html_for(board, msg));
				}
			});
		}
		$tabs.on('click', '.btn', function() { load($(this).data('board')); });
		wrapper._hec_ops_refresh = function() {
			var cur = $tabs.find('.btn.active').data('board') || 'overview';
			load(cur);
		};
		page = wrapper.page;
		if (page && page.set_primary_action) {
			page.set_primary_action(__('Refresh'), function() { wrapper._hec_ops_refresh(); });
		}
		load('overview');
	},
	html_for: function(board, msg) {
		if (board === 'overview') return this.html_overview(msg.overview || {});
		if (board === 'lab') return this.html_lab(msg.lab || {});
		if (board === 'franchisee') return this.html_franchisee(msg.franchisee || {});
		if (board === 'pharmacy') return this.html_pharmacy(msg.pharmacy_purchase || {});
		if (board === 'clinical') return this.html_clinical(msg.clinical || {});
		if (board === 'hr') return this.html_hr(msg.hr || {});
		return '';
	},
	html_overview: function(o) {
		var pipe = o.trf_pipeline || {};
		var cards = [
			this.card(__('TRFs Today'), o.trf_today||0, 'blue'),
			this.card(__('Revenue Today'), this.money(o.revenue_today), 'green'),
			this.card(__('Paid Today'), o.paid_today||0, 'teal'),
			this.card(__('TRFs MTD'), o.trf_month||0, 'blue'),
			this.card(__('Revenue MTD'), this.money(o.revenue_month), 'green'),
			this.card(__('Sales Invoices Today'), o.sales_invoices_today||0, 'amber'),
			this.card(__('SI Amount Today'), this.money(o.sales_invoice_amount_today), 'amber'),
			this.card(__('Open Appointments'), o.open_appointments||0, 'rose'),
			this.card(__('Pharmacy Orders Today'), o.pharmacy_orders_today||0, 'teal'),
			this.card(__('Purchase Invoices Today'), o.purchase_invoices_today||0, 'amber')
		].join('');
		var rows = Object.keys(pipe).map(function(k){
			return `<tr><td>${frappe.utils.escape_html(k)}</td><td>${pipe[k]}</td></tr>`;
		}).join('');
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__('Lab TRF Pipeline (open)')}</div>
			<table class="hec-ops-table"><thead><tr><th>${__('Status')}</th><th>${__('Count')}</th></tr></thead><tbody>${rows}</tbody></table>`;
	},
	html_lab: function(o) {
		var bs = o.by_status || {};
		var cards = [
			this.card(__('In Lab'), (bs['In Lab']||{}).open||0, 'rose'),
			this.card(__('Sample Collected'), (bs['Sample Collected']||{}).open||0, 'amber'),
			this.card(__('Booked'), (bs['Booked']||{}).open||0, 'blue'),
			this.card(__('Completed Today'), (bs['Completed']||{}).today||0, 'green'),
			this.card(__('Pending Payment'), o.pending_payment||0, 'amber'),
			this.card(__('Lab Reports Open'), o.lab_reports_open||0, 'rose'),
			this.card(__('Reports Done Today'), o.lab_reports_done_today||0, 'green')
		].join('');
		var trend = (o.trend_7d||[]).map(function(t){
			return `<tr><td>${frappe.utils.escape_html(t.date)}</td><td>${t.trfs}</td><td>${format_currency(flt(t.amount)||0)}</td></tr>`;
		}).join('');
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__('Last 7 Days')}</div>
			<table class="hec-ops-table"><thead><tr><th>${__('Date')}</th><th>${__('TRFs')}</th><th>${__('Amount')}</th></tr></thead><tbody>${trend}</tbody></table>`;
	},
	html_franchisee: function(o) {
		var cards = [
			this.card(__('Bookings Today'), o.today_bookings||0, 'blue'),
			this.card(__('Bookings MTD'), o.month_bookings||0, 'teal'),
			this.card(__('Active Centres MTD'), o.active_centres||0, 'green')
		].join('');
		var rows = (o.centres||[]).map(function(c){
			return `<tr><td>${frappe.utils.escape_html(c.franchise_name)}</td><td>${frappe.utils.escape_html(c.franchisee_id)}</td><td>${c.today}</td><td>${c.month}</td><td>${format_currency(flt(c.month_revenue)||0)}</td></tr>`;
		}).join('');
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__('Centres')}</div>
			<table class="hec-ops-table"><thead><tr><th>${__('Name')}</th><th>${__('Code')}</th><th>${__('Today')}</th><th>${__('MTD')}</th><th>${__('MTD Revenue')}</th></tr></thead><tbody>${rows||'<tr><td colspan=5>No data</td></tr>'}</tbody></table>`;
	},
	html_pharmacy: function(o) {
		var cards = [
			this.card(__('Pharmacy Orders Today'), o.pharmacy_orders_today||0, 'teal'),
			this.card(__('Pharmacy Orders MTD'), o.pharmacy_orders_month||0, 'blue'),
			this.card(__('Pharmacy GMV MTD'), this.money(o.pharmacy_gmv_month), 'green'),
			this.card(__('Purchase Invoices Today'), o.pinv_today||0, 'amber'),
			this.card(__('PINV MTD'), o.pinv_month||0, 'amber'),
			this.card(__('PINV Amount MTD'), this.money(o.pinv_amount_month), 'rose'),
			this.card(__('Sales Invoices MTD'), o.si_month||0, 'blue'),
			this.card(__('SI Amount MTD'), this.money(o.si_amount_month), 'green')
		].join('');
		return `<div class="hec-kpi-grid">${cards}</div>`;
	},
	html_clinical: function(o) {
		var cards = [
			this.card(__('Appointments Today'), o.appointments_today||0, 'blue'),
			this.card(__('Appointments (7d)'), o.appointments_week||0, 'teal'),
			this.card(__('Doctors'), o.doctors||0, 'green')
		].join('');
		var st = o.by_status || {};
		var rows = Object.keys(st).map(function(k){
			return `<tr><td>${frappe.utils.escape_html(k)}</td><td>${st[k]}</td></tr>`;
		}).join('');
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__('Status (last 7 days)')}</div>
			<table class="hec-ops-table"><thead><tr><th>${__('Status')}</th><th>${__('Count')}</th></tr></thead><tbody>${rows||'<tr><td colspan=2>No data</td></tr>'}</tbody></table>`;
	},
	html_hr: function(o) {
		if (!o.hr_available) {
			return `<p class="text-muted">${__('HR DocTypes not available. Install Frappe HRMS and run Phase 21 setup.')}</p>`;
		}
		var cards = [
			this.card(__('Active Headcount'), o.headcount_active||0, 'blue'),
			this.card(__('On Leave Today'), o.on_leave_today||0, 'amber'),
			this.card(__('Open Leave Apps'), o.open_leave_applications||0, 'rose'),
			this.card(__('Open Expense Claims'), o.open_expense_claims||0, 'teal'),
			this.card(__('Open Appraisals'), o.open_appraisals||0, 'blue'),
			this.card(__('Scheduled Trainings'), o.scheduled_trainings||0, 'teal'),
			this.card(__('Expense Claimed MTD'), this.money(o.expense_claimed_month), 'green'),
			this.card(__('Present Today'), o.attendance_present_today||0, 'green'),
			this.card(__('Absent Today'), o.attendance_absent_today||0, 'rose'),
			this.card(__('Attendance Gaps'), o.attendance_gaps_today||0, 'amber')
		].join('');
		return `<div class="hec-kpi-grid">${cards}</div>
			<p class="text-muted" style="margin-top:10px">${__('Read-only HR aggregates. Training, KRA & appraisal self-service at /dashboard/performance.')}</p>`;
	}
};
"""


# ---------------------------------------------------------------------------
# Native Number Cards / Charts / Dashboards
# ---------------------------------------------------------------------------


def _upsert_number_card(name, opts):
	if frappe.db.exists("Number Card", name):
		doc = frappe.get_doc("Number Card", name)
		doc.update(opts)
		doc.save(ignore_permissions=True)
		return name
	doc = frappe.get_doc({"doctype": "Number Card", "name": name, **opts})
	doc.insert(ignore_permissions=True)
	return name


def _upsert_chart(name, opts):
	if frappe.db.exists("Dashboard Chart", name):
		doc = frappe.get_doc("Dashboard Chart", name)
		for k, v in opts.items():
			setattr(doc, k, v)
		doc.save(ignore_permissions=True)
		return name
	doc = frappe.get_doc({"doctype": "Dashboard Chart", "name": name, "chart_name": name, **opts})
	doc.insert(ignore_permissions=True)
	return name


def ensure_number_cards_and_charts():
	"""Create Number Cards + Charts used by native Dashboards / Workspace."""
	method_prefix = "health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards."

	cards = [
		("HEC TRFs Today", {"label": "TRFs Today", "type": "Custom", "method": method_prefix + "nc_trf_today", "is_public": 1, "show_percentage_stats": 0}),
		("HEC TRF Revenue Today", {"label": "TRF Revenue Today", "type": "Custom", "method": method_prefix + "nc_trf_revenue_today", "is_public": 1, "currency": frappe.db.get_default("currency") or "INR"}),
		("HEC TRF In Lab", {"label": "TRFs In Lab", "type": "Custom", "method": method_prefix + "nc_trf_in_lab", "is_public": 1}),
		("HEC TRF Completed Today", {"label": "TRFs Completed Today", "type": "Custom", "method": method_prefix + "nc_trf_completed_today", "is_public": 1}),
		("HEC Pharmacy Today", {"label": "Pharmacy Orders Today", "type": "Custom", "method": method_prefix + "nc_pharmacy_today", "is_public": 1}),
		("HEC PINV Today", {"label": "Purchase Invoices Today", "type": "Custom", "method": method_prefix + "nc_pinv_today", "is_public": 1}),
		("HEC Appts Today", {"label": "Appointments Today", "type": "Custom", "method": method_prefix + "nc_appts_today", "is_public": 1}),
		("HEC Active Centres", {"label": "Active Franchisee Centres", "type": "Custom", "method": method_prefix + "nc_franchisee_active", "is_public": 1}),
	]
	# Document-type cards where possible
	if frappe.db.exists("DocType", "Customer TRF"):
		cards.append(
			(
				"HEC TRF Booked Open",
				{
					"label": "Open Booked TRFs",
					"type": "Document Type",
					"document_type": "Customer TRF",
					"function": "Count",
					"filters_json": json.dumps([["Customer TRF", "order_status", "=", "Booked"]]),
					"is_public": 1,
				},
			)
		)

	for name, opts in cards:
		opts.setdefault("module", MODULE)
		try:
			_upsert_number_card(name, opts)
		except Exception:
			frappe.log_error(title=f"number_card:{name}", message=frappe.get_traceback())

	# Charts
	charts = []
	if frappe.db.exists("DocType", "Customer TRF"):
		charts.append(
			(
				"HEC TRF by Status",
				{
					"chart_type": "Group By",
					"document_type": "Customer TRF",
					"group_by_type": "Count",
					"group_by_based_on": "order_status",
					"is_public": 1,
					"timeseries": 0,
					"type": "Pie",
					"filters_json": json.dumps([]),
				},
			)
		)
		charts.append(
			(
				"HEC TRF Last 30 Days",
				{
					"chart_type": "Count",
					"document_type": "Customer TRF",
					"based_on": "creation",
					"time_interval": "Daily",
					"timeseries": 1,
					"timespan": "Last Month",
					"is_public": 1,
					"type": "Line",
					"filters_json": json.dumps([]),
				},
			)
		)
	if frappe.db.exists("DocType", "Sales Invoice"):
		charts.append(
			(
				"HEC SI Amount MTD",
				{
					"chart_type": "Sum",
					"document_type": "Sales Invoice",
					"based_on": "posting_date",
					"value_based_on": "grand_total",
					"time_interval": "Daily",
					"timeseries": 1,
					"timespan": "Last Month",
					"filters_json": json.dumps([["Sales Invoice", "docstatus", "=", 1]]),
					"is_public": 1,
					"type": "Bar",
				},
			)
		)
	if frappe.db.exists("DocType", "Purchase Invoice"):
		charts.append(
			(
				"HEC PINV Amount MTD",
				{
					"chart_type": "Sum",
					"document_type": "Purchase Invoice",
					"based_on": "posting_date",
					"value_based_on": "grand_total",
					"time_interval": "Daily",
					"timeseries": 1,
					"timespan": "Last Month",
					"filters_json": json.dumps([["Purchase Invoice", "docstatus", "=", 1]]),
					"is_public": 1,
					"type": "Bar",
				},
			)
		)

	for name, opts in charts:
		opts.setdefault("module", MODULE)
		try:
			_upsert_chart(name, opts)
		except Exception:
			frappe.log_error(title=f"chart:{name}", message=frappe.get_traceback())

	frappe.db.commit()
	return True


def _upsert_dashboard(name, chart_names, card_names):
	if frappe.db.exists("Dashboard", name):
		doc = frappe.get_doc("Dashboard", name)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Dashboard",
				"dashboard_name": name,
				"is_default": 0,
				"is_standard": 0,
				"module": MODULE,
			}
		)
	doc.charts = []
	doc.cards = []
	for ch in chart_names:
		if frappe.db.exists("Dashboard Chart", ch):
			doc.append("charts", {"chart": ch, "width": "Half"})
	# Frappe requires at least one chart on Dashboard
	if not doc.charts and frappe.db.exists("Dashboard Chart", "HEC TRF Last 30 Days"):
		doc.append("charts", {"chart": "HEC TRF Last 30 Days", "width": "Full"})
	elif not doc.charts and frappe.db.exists("Dashboard Chart", "HEC TRF by Status"):
		doc.append("charts", {"chart": "HEC TRF by Status", "width": "Full"})
	for ca in card_names:
		if frappe.db.exists("Number Card", ca):
			doc.append("cards", {"card": ca})
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return name


def ensure_native_dashboards():
	_upsert_dashboard(
		"HEC Company Overview",
		["HEC TRF Last 30 Days", "HEC TRF by Status", "HEC SI Amount MTD"],
		["HEC TRFs Today", "HEC TRF Revenue Today", "HEC Pharmacy Today", "HEC Appts Today", "HEC Active Centres"],
	)
	_upsert_dashboard(
		"HEC Lab Operations",
		["HEC TRF by Status", "HEC TRF Last 30 Days"],
		["HEC TRFs Today", "HEC TRF In Lab", "HEC TRF Completed Today", "HEC TRF Booked Open"],
	)
	_upsert_dashboard(
		"HEC Franchisee Network",
		["HEC TRF Last 30 Days"],
		["HEC Active Centres", "HEC TRFs Today", "HEC TRF Revenue Today"],
	)
	_upsert_dashboard(
		"HEC Pharmacy & Purchase",
		["HEC PINV Amount MTD", "HEC SI Amount MTD"],
		["HEC Pharmacy Today", "HEC PINV Today", "HEC TRF Revenue Today"],
	)
	_upsert_dashboard(
		"HEC Clinical Appointments",
		["HEC TRF Last 30 Days"],
		["HEC Appts Today", "HEC TRFs Today"],
	)
	frappe.db.commit()
	return True


def ensure_ops_workspace():
	"""Create / refresh Company Ops KPIs workspace with page + dashboard shortcuts."""
	try:
		if frappe.db.exists("Workspace", WORKSPACE_NAME):
			ws = frappe.get_doc("Workspace", WORKSPACE_NAME)
		else:
			ws = frappe.get_doc(
				{
					"doctype": "Workspace",
					"label": WORKSPACE_NAME,
					"title": WORKSPACE_NAME,
					"name": "company-ops-kpis",
					"module": MODULE,
					"public": 1,
					"is_hidden": 0,
				}
			)
			ws.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="hec_ops_workspace", message=frappe.get_traceback())
		# Fallback: only Clinical shortcuts
		ensure_clinical_shortcuts()
		return False

	# Clear and rebuild shortcuts for predictability
	ws.shortcuts = []
	ws.append(
		"shortcuts",
		{"label": "Company Operations", "type": "Page", "link_to": PAGE_NAME, "color": "Blue"},
	)
	for dash in DASHBOARDS:
		if frappe.db.exists("Dashboard", dash):
			ws.append(
				"shortcuts",
				{"label": dash.replace("HEC ", ""), "type": "Dashboard", "link_to": dash, "color": "Green"},
			)

	# Number cards on workspace (if child table exists)
	if hasattr(ws, "number_cards"):
		ws.number_cards = []
		for card in (
			"HEC TRFs Today",
			"HEC TRF Revenue Today",
			"HEC TRF In Lab",
			"HEC Pharmacy Today",
			"HEC Appts Today",
			"HEC Active Centres",
		):
			if frappe.db.exists("Number Card", card):
				try:
					ws.append("number_cards", {"number_card_name": card, "label": card.replace("HEC ", "")})
				except Exception:
					pass

	if hasattr(ws, "charts"):
		ws.charts = []
		for ch in ("HEC TRF by Status", "HEC TRF Last 30 Days"):
			if frappe.db.exists("Dashboard Chart", ch):
				try:
					ws.append("charts", {"chart_name": ch, "label": ch.replace("HEC ", "")})
				except Exception:
					pass

	try:
		ws.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="hec_ops_workspace_save", message=frappe.get_traceback())
		ensure_clinical_shortcuts()
		return False
	return WORKSPACE_NAME


def ensure_clinical_shortcuts():
	if not frappe.db.exists("Workspace", "Clinical"):
		return False
	ws = frappe.get_doc("Workspace", "Clinical")
	labels = {s.label for s in (ws.shortcuts or [])}
	changed = False
	if "Company Operations" not in labels:
		ws.append(
			"shortcuts",
			{"label": "Company Operations", "type": "Page", "link_to": PAGE_NAME, "color": "Blue"},
		)
		changed = True
	if changed:
		ws.save(ignore_permissions=True)
		frappe.db.commit()
	return True
