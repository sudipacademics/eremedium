frappe.pages["hec-company-ops"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Company Operations"),
		single_column: true,
	});
	wrapper.page = page;
	hec_ops.render(wrapper);
};

frappe.pages["hec-company-ops"].on_page_show = function (wrapper) {
	if (wrapper && wrapper._hec_ops_refresh) wrapper._hec_ops_refresh();
};

var hec_ops = {
	boards: [
		{ id: "overview", label: __("Company Overview") },
		{ id: "lab", label: __("Lab Operations") },
		{ id: "franchisee", label: __("Franchisee Network") },
		{ id: "pharmacy", label: __("Pharmacy & Purchase") },
		{ id: "clinical", label: __("Clinical Appointments") },
	],
	money: function (n) {
		return format_currency(flt(n) || 0);
	},
	card: function (label, value, tone) {
		tone = tone || "blue";
		return (
			`<div class="hec-kpi-card hec-tone-${tone}"><div class="hec-kpi-label">${frappe.utils.escape_html(
				label
			)}</div><div class="hec-kpi-value">${value}</div></div>`
		);
	},
	css: function () {
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
			.hec-ops-h { font-size:14px; font-weight:600; margin:12px 0 6px; color:#1e293b; }
		</style>`;
	},
	render: function (wrapper) {
		var me = this;
		var $body = $(wrapper).find(".layout-main-section");
		if (!$body.length) $body = $(wrapper);
		$body.html(
			me.css() +
				`<div class="hec-ops">
			<div class="hec-ops-tabs"></div>
			<div class="hec-ops-body text-muted">${__("Loading KPIs…")}</div>
		</div>`
		);
		var $tabs = $body.find(".hec-ops-tabs");
		me.boards.forEach(function (b, i) {
			var $b = $(
				`<button type="button" class="btn btn-sm btn-default" data-board="${b.id}">${b.label}</button>`
			);
			if (i === 0) $b.addClass("active");
			$tabs.append($b);
		});
		function load(board) {
			$body.find(".hec-ops-tabs .btn").removeClass("active");
			$body.find(`.hec-ops-tabs .btn[data-board="${board}"]`).addClass("active");
			$body.find(".hec-ops-body").html(`<p class="text-muted">${__("Loading…")}</p>`);
			frappe.call({
				method:
					"health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards.api_get_company_ops_kpis",
				args: { board: board === "pharmacy" ? "pharmacy" : board },
				callback: function (r) {
					var msg = r.message || {};
					$body.find(".hec-ops-body").html(me.html_for(board, msg));
				},
			});
		}
		$tabs.on("click", ".btn", function () {
			load($(this).data("board"));
		});
		wrapper._hec_ops_refresh = function () {
			var cur = $tabs.find(".btn.active").data("board") || "overview";
			load(cur);
		};
		var page = wrapper.page;
		if (page && page.set_primary_action) {
			page.set_primary_action(__("Refresh"), function () {
				wrapper._hec_ops_refresh();
			});
		}
		load("overview");
	},
	html_for: function (board, msg) {
		if (board === "overview") return this.html_overview(msg.overview || {});
		if (board === "lab") return this.html_lab(msg.lab || {});
		if (board === "franchisee") return this.html_franchisee(msg.franchisee || {});
		if (board === "pharmacy") return this.html_pharmacy(msg.pharmacy_purchase || {});
		if (board === "clinical") return this.html_clinical(msg.clinical || {});
		return "";
	},
	html_overview: function (o) {
		var pipe = o.trf_pipeline || {};
		var cards = [
			this.card(__("TRFs Today"), o.trf_today || 0, "blue"),
			this.card(__("Revenue Today"), this.money(o.revenue_today), "green"),
			this.card(__("Paid Today"), o.paid_today || 0, "teal"),
			this.card(__("TRFs MTD"), o.trf_month || 0, "blue"),
			this.card(__("Revenue MTD"), this.money(o.revenue_month), "green"),
			this.card(__("Sales Invoices Today"), o.sales_invoices_today || 0, "amber"),
			this.card(__("SI Amount Today"), this.money(o.sales_invoice_amount_today), "amber"),
			this.card(__("Open Appointments"), o.open_appointments || 0, "rose"),
			this.card(__("Pharmacy Orders Today"), o.pharmacy_orders_today || 0, "teal"),
			this.card(__("Purchase Invoices Today"), o.purchase_invoices_today || 0, "amber"),
		].join("");
		var rows = Object.keys(pipe)
			.map(function (k) {
				return `<tr><td>${frappe.utils.escape_html(k)}</td><td>${pipe[k]}</td></tr>`;
			})
			.join("");
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__("Lab TRF Pipeline (open)")}</div>
			<table class="hec-ops-table"><thead><tr><th>${__("Status")}</th><th>${__(
				"Count"
			)}</th></tr></thead><tbody>${rows}</tbody></table>`;
	},
	html_lab: function (o) {
		var bs = o.by_status || {};
		var cards = [
			this.card(__("In Lab"), (bs["In Lab"] || {}).open || 0, "rose"),
			this.card(__("Sample Collected"), (bs["Sample Collected"] || {}).open || 0, "amber"),
			this.card(__("Booked"), (bs["Booked"] || {}).open || 0, "blue"),
			this.card(__("Completed Today"), (bs["Completed"] || {}).today || 0, "green"),
			this.card(__("Pending Payment"), o.pending_payment || 0, "amber"),
			this.card(__("Lab Reports Open"), o.lab_reports_open || 0, "rose"),
			this.card(__("Reports Done Today"), o.lab_reports_done_today || 0, "green"),
		].join("");
		var trend = (o.trend_7d || [])
			.map(function (t) {
				return `<tr><td>${frappe.utils.escape_html(t.date)}</td><td>${t.trfs}</td><td>${format_currency(
					flt(t.amount) || 0
				)}</td></tr>`;
			})
			.join("");
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__("Last 7 Days")}</div>
			<table class="hec-ops-table"><thead><tr><th>${__("Date")}</th><th>${__("TRFs")}</th><th>${__(
				"Amount"
			)}</th></tr></thead><tbody>${trend}</tbody></table>`;
	},
	html_franchisee: function (o) {
		var cards = [
			this.card(__("Bookings Today"), o.today_bookings || 0, "blue"),
			this.card(__("Bookings MTD"), o.month_bookings || 0, "teal"),
			this.card(__("Active Centres MTD"), o.active_centres || 0, "green"),
		].join("");
		var rows = (o.centres || [])
			.map(function (c) {
				return `<tr><td>${frappe.utils.escape_html(c.franchise_name)}</td><td>${frappe.utils.escape_html(
					c.franchisee_id
				)}</td><td>${c.today}</td><td>${c.month}</td><td>${format_currency(
					flt(c.month_revenue) || 0
				)}</td></tr>`;
			})
			.join("");
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__("Centres")}</div>
			<table class="hec-ops-table"><thead><tr><th>${__("Name")}</th><th>${__("Code")}</th><th>${__(
				"Today"
			)}</th><th>${__("MTD")}</th><th>${__(
				"MTD Revenue"
			)}</th></tr></thead><tbody>${
				rows || "<tr><td colspan=5>No data</td></tr>"
			}</tbody></table>`;
	},
	html_pharmacy: function (o) {
		var cards = [
			this.card(__("Pharmacy Orders Today"), o.pharmacy_orders_today || 0, "teal"),
			this.card(__("Pharmacy Orders MTD"), o.pharmacy_orders_month || 0, "blue"),
			this.card(__("Pharmacy GMV MTD"), this.money(o.pharmacy_gmv_month), "green"),
			this.card(__("Purchase Invoices Today"), o.pinv_today || 0, "amber"),
			this.card(__("PINV MTD"), o.pinv_month || 0, "amber"),
			this.card(__("PINV Amount MTD"), this.money(o.pinv_amount_month), "rose"),
			this.card(__("Sales Invoices MTD"), o.si_month || 0, "blue"),
			this.card(__("SI Amount MTD"), this.money(o.si_amount_month), "green"),
		].join("");
		return `<div class="hec-kpi-grid">${cards}</div>`;
	},
	html_clinical: function (o) {
		var cards = [
			this.card(__("Appointments Today"), o.appointments_today || 0, "blue"),
			this.card(__("Appointments (7d)"), o.appointments_week || 0, "teal"),
			this.card(__("Doctors"), o.doctors || 0, "green"),
		].join("");
		var st = o.by_status || {};
		var rows = Object.keys(st)
			.map(function (k) {
				return `<tr><td>${frappe.utils.escape_html(k)}</td><td>${st[k]}</td></tr>`;
			})
			.join("");
		return `<div class="hec-kpi-grid">${cards}</div>
			<div class="hec-ops-h">${__("Status (last 7 days)")}</div>
			<table class="hec-ops-table"><thead><tr><th>${__("Status")}</th><th>${__(
				"Count"
			)}</th></tr></thead><tbody>${
				rows || "<tr><td colspan=2>No data</td></tr>"
			}</tbody></table>`;
	},
};
