frappe.pages["employee-gamification"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Employee Gamification"),
		single_column: true,
	});

	page.main.addClass("employee-gamification-dashboard");
	page.set_primary_action(__("Refresh"), function () {
		load_dashboard(page);
	});

	load_dashboard(page);

	function load_dashboard(page) {
		page.main.html(`
			<div class="text-muted text-center" style="padding: 48px;">
				${__("Loading leaderboard…")}
			</div>
		`);

		frappe.call({
			method:
				"health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.get_gamification_dashboard",
			callback: function (r) {
				if (!r.message) {
					page.main.html(`<div class="alert alert-danger">${__("Unable to load dashboard")}</div>`);
					return;
				}
				render_dashboard(page, r.message);
			},
		});
	}

	function render_dashboard(page, data) {
		var summary = data.summary || {};
		var boards = data.leaderboards || {};
		var periods = [
			{ key: "daily", label: __("Today") },
			{ key: "weekly", label: __("This week") },
			{ key: "monthly", label: __("This month") },
			{ key: "annual", label: __("This year") },
		];

		var html = `
			<style>
				.employee-gamification-dashboard .hec-gamify-summary {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
					gap: 12px;
					margin-bottom: 20px;
				}
				.employee-gamification-dashboard .hec-gamify-card {
					background: var(--card-bg, #fff);
					border: 1px solid var(--border-color, #d1d8dd);
					border-radius: 8px;
					padding: 16px;
				}
				.employee-gamification-dashboard .hec-gamify-card h4 {
					margin: 0 0 4px;
					font-size: 24px;
				}
				.employee-gamification-dashboard .hec-gamify-card p {
					margin: 0;
					color: var(--text-muted);
					font-size: 12px;
					text-transform: uppercase;
					letter-spacing: 0.04em;
				}
				.employee-gamification-dashboard .hec-gamify-tabs {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					margin-bottom: 16px;
				}
				.employee-gamification-dashboard .hec-gamify-tab {
					border: 1px solid var(--border-color, #d1d8dd);
					background: var(--control-bg, #f7f7f7);
					border-radius: 20px;
					padding: 6px 14px;
					cursor: pointer;
				}
				.employee-gamification-dashboard .hec-gamify-tab.active {
					background: var(--primary, #171717);
					color: #fff;
					border-color: var(--primary, #171717);
				}
				.employee-gamification-dashboard .hec-leader-row {
					display: grid;
					grid-template-columns: 48px 1fr 100px 120px;
					gap: 12px;
					align-items: center;
					padding: 10px 0;
					border-bottom: 1px solid var(--border-color, #edf2f7);
				}
				.employee-gamification-dashboard .hec-leader-rank {
					font-weight: 700;
					font-size: 18px;
					color: var(--text-muted);
				}
				.employee-gamification-dashboard .hec-leader-name {
					font-weight: 600;
				}
				.employee-gamification-dashboard .hec-leader-meta {
					font-size: 12px;
					color: var(--text-muted);
				}
				.employee-gamification-dashboard .hec-points {
					font-weight: 700;
					text-align: right;
				}
				.employee-gamification-dashboard .hec-revenue {
					text-align: right;
					color: var(--text-muted);
					font-size: 12px;
				}
				.employee-gamification-dashboard .hec-section-title {
					margin: 24px 0 12px;
					font-size: 16px;
					font-weight: 700;
				}
				.employee-gamification-dashboard .hec-rules-grid {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
					gap: 10px;
				}
				.employee-gamification-dashboard .hec-rule-chip {
					border: 1px dashed var(--border-color, #d1d8dd);
					border-radius: 8px;
					padding: 10px 12px;
					font-size: 12px;
				}
				.employee-gamification-dashboard .hec-recent-table td,
				.employee-gamification-dashboard .hec-recent-table th {
					font-size: 12px;
				}
			</style>

			<div class="hec-gamify-summary">
				<div class="hec-gamify-card">
					<h4>${frappe.format(summary.all_time_points || 0, { fieldtype: "Float" })}</h4>
					<p>${__("All-time points")}</p>
				</div>
				<div class="hec-gamify-card">
					<h4>${frappe.format(summary.all_time_revenue || 0, { fieldtype: "Currency" })}</h4>
					<p>${__("Linked revenue")}</p>
				</div>
				<div class="hec-gamify-card">
					<h4>${summary.all_time_entries || 0}</h4>
					<p>${__("Point entries")}</p>
				</div>
				<div class="hec-gamify-card">
					<button class="btn btn-default btn-sm" data-route="List/Employee Gamification Rule">${__("Manage rules")}</button>
					<button class="btn btn-default btn-sm" style="margin-left:8px;" data-route="List/Employee Gamification Entry">${__("View ledger")}</button>
				</div>
			</div>

			<div class="hec-gamify-card">
				<div class="hec-gamify-tabs" id="hec-gamify-tabs"></div>
				<div id="hec-gamify-leaderboard"></div>
			</div>

			<div class="hec-section-title">${__("Active rules")}</div>
			<div class="hec-rules-grid" id="hec-gamify-rules"></div>

			<div class="hec-section-title">${__("Recent activity")}</div>
			<div class="hec-gamify-card">
				<table class="table table-sm hec-recent-table">
					<thead>
						<tr>
							<th>${__("Employee")}</th>
							<th>${__("Rule")}</th>
							<th>${__("Points")}</th>
							<th>${__("Revenue")}</th>
							<th>${__("Reference")}</th>
							<th>${__("Date")}</th>
						</tr>
					</thead>
					<tbody id="hec-gamify-recent"></tbody>
				</table>
			</div>
		`;

		page.main.html(html);

		page.main.find("[data-route]").on("click", function () {
			frappe.set_route($(this).data("route"));
		});

		var $tabs = page.main.find("#hec-gamify-tabs");
		periods.forEach(function (p, idx) {
			var $tab = $(`<button type="button" class="hec-gamify-tab">${p.label}</button>`);
			if (idx === 0) {
				$tab.addClass("active");
			}
			$tab.on("click", function () {
				$tabs.find(".hec-gamify-tab").removeClass("active");
				$tab.addClass("active");
				render_leaderboard(boards[p.key]);
			});
			$tabs.append($tab);
		});
		render_leaderboard(boards.daily);

		var rules_html = (data.active_rules || [])
			.map(function (rule) {
				return `
					<div class="hec-rule-chip">
						<strong>${frappe.utils.escape_html(rule.title || rule.rule_code)}</strong><br>
						${frappe.utils.escape_html(rule.reference_doctype)} · ${frappe.utils.escape_html(rule.trigger_event)}<br>
						${__("Base")}: ${rule.base_points}
						${rule.points_per_1000_revenue ? ` · ${__("Per ₹1000")}: ${rule.points_per_1000_revenue}` : ""}
					</div>
				`;
			})
			.join("");
		page.main.find("#hec-gamify-rules").html(rules_html || `<div class="text-muted">${__("No active rules")}</div>`);

		var recent_html = (data.recent_entries || [])
			.map(function (row) {
				return `
					<tr>
						<td>${frappe.utils.escape_html(row.employee_name || row.employee || "")}</td>
						<td>${frappe.utils.escape_html(row.rule_code || "")}</td>
						<td>${frappe.format(row.points, { fieldtype: "Float" })}</td>
						<td>${frappe.format(row.revenue_amount || 0, { fieldtype: "Currency" })}</td>
						<td>${frappe.utils.escape_html((row.reference_doctype || "") + " " + (row.reference_name || ""))}</td>
						<td>${frappe.datetime.str_to_user(row.activity_date || row.creation)}</td>
					</tr>
				`;
			})
			.join("");
		page.main.find("#hec-gamify-recent").html(recent_html || `<tr><td colspan="6" class="text-muted">${__("No entries yet")}</td></tr>`);
	}

	function render_leaderboard(board) {
		var $target = $("#hec-gamify-leaderboard");
		if (!$target.length) {
			return;
		}
		var leaders = (board && board.leaders) || [];
		if (!leaders.length) {
			$target.html(`<div class="text-muted" style="padding: 24px 0;">${__("No points recorded for this period yet.")}</div>`);
			return;
		}
		var rows = leaders
			.map(function (row) {
				var medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank;
				return `
					<div class="hec-leader-row">
						<div class="hec-leader-rank">${medal}</div>
						<div>
							<div class="hec-leader-name">${frappe.utils.escape_html(row.employee_name || row.employee || "")}</div>
							<div class="hec-leader-meta">${row.activity_count || 0} ${__("activities")}</div>
						</div>
						<div class="hec-points">${frappe.format(row.total_points, { fieldtype: "Float" })} ${__("pts")}</div>
						<div class="hec-revenue">${frappe.format(row.total_revenue || 0, { fieldtype: "Currency" })}</div>
					</div>
				`;
			})
			.join("");
		$target.html(`
			<div style="margin-bottom:8px;color:var(--text-muted);font-size:12px;">
				${frappe.utils.escape_html((board && board.label) || "")}
			</div>
			${rows}
		`);
	}
};
