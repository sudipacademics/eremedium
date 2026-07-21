frappe.pages["hec-lab-results"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("HEC Lab Results"),
		single_column: true,
	});

	page.hec = {
		queue: [],
		detail: null,
		rows: [],
		filter: "",
	};

	page.set_primary_action(__("Save Results"), function () {
		save_results(page);
	});
	page.set_secondary_action(__("Refresh Queue"), function () {
		load_queue(page);
	});
	page.add_inner_button(__("Import Machine"), function () {
		import_machine(page);
	});
	page.add_inner_button(__("Reload from TRF"), function () {
		reload_params(page);
	});
	page.add_inner_button(__("Finalize"), function () {
		finalize_report(page);
	});
	page.add_inner_button(__("Open Form"), function () {
		if (page.hec.detail && page.hec.detail.lab_report) {
			frappe.set_route("Form", "Lab Report", page.hec.detail.lab_report);
		}
	});

	render_shell(page);
	load_queue(page);
};

function render_shell(page) {
	page.main.html(`
	<style>
		.hec-lab-entry { display:flex; gap:12px; min-height:70vh; }
		.hec-lab-queue {
			width: 280px; flex-shrink:0; border:1px solid var(--border-color,#d1d8dd);
			border-radius:6px; background:var(--card-bg,#fff); overflow:auto; max-height:78vh;
		}
		.hec-lab-queue h5 { margin:0; padding:10px 12px; border-bottom:1px solid var(--border-color,#d1d8dd); font-size:13px; }
		.hec-lab-queue .hec-q-search { padding:8px 10px; border-bottom:1px solid var(--border-color,#d1d8dd); }
		.hec-lab-queue .hec-q-search input { width:100%; }
		.hec-lab-queue .hec-q-item {
			display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #eee;
			background:transparent; padding:10px 12px; cursor:pointer;
		}
		.hec-lab-queue .hec-q-item:hover, .hec-lab-queue .hec-q-item.active { background:#eef6fc; }
		.hec-lab-queue .hec-q-item .t { font-weight:600; font-size:12px; }
		.hec-lab-queue .hec-q-item .s { font-size:11px; color:#666; }
		.hec-lab-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }
		.hec-lab-meta {
			display:flex; flex-wrap:wrap; gap:12px 18px; align-items:center;
			padding:10px 12px; border:1px solid var(--border-color,#d1d8dd); border-radius:6px; background:var(--card-bg,#fff);
		}
		.hec-lab-meta .hec-chip { font-size:12px; }
		.hec-lab-meta .hec-chip b { margin-right:4px; }
		.hec-lab-grid-wrap { overflow:auto; border:1px solid var(--border-color,#d1d8dd); border-radius:6px; max-height:68vh; background:#fff; }
		.hec-lab-grid { width:100%; border-collapse:collapse; font-size:12px; }
		.hec-lab-grid th { position:sticky; top:0; background:#f5f7fa; z-index:1; border:1px solid #d1d8dd; padding:6px 4px; white-space:nowrap; text-align:center; }
		.hec-lab-grid td { border:1px solid #d1d8dd; padding:2px 4px; vertical-align:middle; }
		.hec-lab-grid input[type="text"], .hec-lab-grid input[type="number"] {
			width:100%; border:1px solid transparent; background:transparent; padding:4px 6px; border-radius:3px;
		}
		.hec-lab-grid input:focus { border-color:#2490ef; background:#fff; outline:none; }
		.hec-lab-grid tr.hec-calc { background:#fafafa; }
		.hec-lab-grid tr.hec-calc input.hec-result { color:#888; }
		.hec-lab-grid tr.hec-abn { background:#fff5f5; }
		.hec-lab-grid .hec-flag-H, .hec-lab-grid .hec-flag-Critical { color:#c0392b; font-weight:700; }
		.hec-lab-grid .hec-flag-L { color:#2980b9; font-weight:700; }
		.hec-lab-empty { padding:48px; text-align:center; color:#888; }
		.hec-lab-status { font-size:12px; color:#666; min-height:18px; }
		.hec-group-row td { background:#e8eef5; font-weight:600; font-size:11px; letter-spacing:.02em; }
	</style>
	<div class="hec-lab-entry">
		<aside class="hec-lab-queue">
			<h5>${__("Work Queue")}</h5>
			<div class="hec-q-search">
				<input type="text" class="form-control input-sm hec-filter" placeholder="${__("TRF / Patient / Barcode")}">
			</div>
			<div class="hec-q-list"></div>
		</aside>
		<section class="hec-lab-main">
			<div class="hec-lab-meta hec-meta-bar"><span class="text-muted">${__("Select a TRF from the queue")}</span></div>
			<div class="hec-lab-grid-wrap"><div class="hec-lab-empty">${__("No report loaded")}</div></div>
			<div class="hec-lab-status"></div>
		</section>
	</div>`);

	page.main.find(".hec-filter").on("change keyup", function (e) {
		if (e.type === "keyup" && e.which !== 13) return;
		page.hec.filter = $(this).val();
		load_queue(page);
	});
}

function load_queue(page) {
	page.main.find(".hec-lab-status").text(__("Loading queue…"));
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_list_lab_entry_queue",
		args: { limit: 100, search: page.hec.filter || "" },
		callback: function (r) {
			var msg = r.message || {};
			page.hec.queue = msg.queue || [];
			render_queue(page);
			page.main.find(".hec-lab-status").text(__("{0} in queue", [page.hec.queue.length]));
		},
	});
}

function render_queue(page) {
	var html = (page.hec.queue || [])
		.map(function (q) {
			var active =
				page.hec.detail &&
				(page.hec.detail.customer_trf === q.trf_id || page.hec.detail.lab_report === q.lab_report)
					? "active"
					: "";
			return `
			<button type="button" class="hec-q-item ${active}" data-trf="${frappe.utils.escape_html(q.trf_id || "")}" data-report="${frappe.utils.escape_html(q.lab_report || "")}">
				<div class="t">${frappe.utils.escape_html(q.patient_name || q.trf_id || "")}</div>
				<div class="s">${frappe.utils.escape_html(q.trf_id || "")} · ${frappe.utils.escape_html(q.order_status || "")}${q.report_status ? " · " + frappe.utils.escape_html(q.report_status) : ""}</div>
				<div class="s">${frappe.utils.escape_html(q.test_required || "")}</div>
			</button>`;
		})
		.join("");
	if (!html) {
		html = `<div class="hec-lab-empty">${__("No samples in queue")}</div>`;
	}
	page.main.find(".hec-q-list").html(html);
	page.main.find(".hec-q-item").on("click", function () {
		open_entry(page, $(this).data("trf"), $(this).data("report"));
	});
}

function open_entry(page, trf_id, lab_report) {
	page.main.find(".hec-lab-status").text(__("Loading report…"));
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_open_lab_entry",
		args: { trf_id: trf_id || null, lab_report: lab_report || null },
		freeze: true,
		callback: function (r) {
			var msg = r.message || {};
			if (!msg.ok) {
				frappe.msgprint(msg.message || __("Could not open report"));
				return;
			}
			page.hec.detail = msg.data || {};
			page.hec.rows = (page.hec.detail.parameters || []).map(function (p) {
				return Object.assign({}, p);
			});
			render_meta(page);
			render_grid(page);
			render_queue(page);
			page.main.find(".hec-lab-status").text(
				__("{0} · {1} parameters", [page.hec.detail.lab_report, page.hec.rows.length])
			);
			setTimeout(function () {
				page.main.find("input.hec-result:not([readonly])").first().focus().select();
			}, 50);
		},
	});
}

function render_meta(page) {
	var d = page.hec.detail || {};
	page.main.find(".hec-meta-bar").html(`
		<span class="hec-chip"><b>${__("Patient")}</b>${frappe.utils.escape_html(d.patient_name || "—")}</span>
		<span class="hec-chip"><b>${__("TRF")}</b><a href="/app/customer-trf/${encodeURIComponent(d.customer_trf || "")}">${frappe.utils.escape_html(d.customer_trf || "")}</a></span>
		<span class="hec-chip"><b>${__("Report")}</b><a href="/app/lab-report/${encodeURIComponent(d.lab_report || "")}">${frappe.utils.escape_html(d.lab_report || "")}</a></span>
		<span class="hec-chip"><b>${__("Status")}</b>${frappe.utils.escape_html(d.report_status || "")}</span>
		<span class="hec-chip"><b>${__("Dept")}</b>${frappe.utils.escape_html(d.department || "")}</span>
		<span class="hec-chip"><b>${__("Specimen")}</b>${frappe.utils.escape_html(d.specimen || "")}</span>
	`);
}

function render_grid(page) {
	var rows = page.hec.rows || [];
	if (!rows.length) {
		page.main.find(".hec-lab-grid-wrap").html(`<div class="hec-lab-empty">${__("No parameters on this report")}</div>`);
		return;
	}

	var html = `
	<table class="hec-lab-grid">
		<thead>
			<tr>
				<th style="width:36px">#</th>
				<th style="min-width:160px">${__("Parameter")}</th>
				<th style="min-width:110px">${__("Result")}</th>
				<th style="width:70px">${__("Unit")}</th>
				<th style="width:60px">${__("Low")}</th>
				<th style="width:60px">${__("High")}</th>
				<th style="width:70px">${__("Flag")}</th>
				<th style="min-width:100px">${__("Method")}</th>
				<th style="width:50px">${__("Print")}</th>
			</tr>
		</thead>
		<tbody>`;

	var last_group = null;
	rows.forEach(function (r, i) {
		var group = r.test_name || "";
		if (group && group !== last_group) {
			html += `<tr class="hec-group-row"><td colspan="9">${frappe.utils.escape_html(group)}</td></tr>`;
			last_group = group;
		}
		var calc = cint(r.is_calculated) || (r.parameter_kind || "") === "Calculated";
		var abn = r.abnormal_flag && r.abnormal_flag !== "N" ? "hec-abn" : "";
		html += `
		<tr class="${calc ? "hec-calc" : ""} ${abn}" data-idx="${i}">
			<td class="text-center">${i + 1}</td>
			<td title="${frappe.utils.escape_html(r.parameter_code || "")}">${frappe.utils.escape_html(r.description || "")}${calc ? ' <span class="text-muted">(calc)</span>' : ""}</td>
			<td><input type="text" class="hec-result" data-f="result_value" value="${frappe.utils.escape_html(r.result_value || "")}" ${calc ? "readonly" : ""}></td>
			<td><input type="text" data-f="unit" value="${frappe.utils.escape_html(r.unit || "")}"></td>
			<td class="text-center text-muted">${r.lower_range != null ? r.lower_range : ""}</td>
			<td class="text-center text-muted">${r.upper_range != null ? r.upper_range : ""}</td>
			<td class="text-center hec-flag-${frappe.utils.escape_html(r.abnormal_flag || "")}">${frappe.utils.escape_html(r.abnormal_flag || "")}</td>
			<td><input type="text" data-f="method" value="${frappe.utils.escape_html(r.method || "")}"></td>
			<td class="text-center"><input type="checkbox" data-f="include_in_report" ${cint(r.include_in_report) ? "checked" : ""}></td>
		</tr>`;
	});
	html += `</tbody></table>`;
	page.main.find(".hec-lab-grid-wrap").html(html);

	page.main.find(".hec-lab-grid tbody tr[data-idx]").each(function () {
		var idx = cint($(this).data("idx"));
		$(this)
			.find("input")
			.on("change", function () {
				var f = $(this).data("f");
				var val = $(this).attr("type") === "checkbox" ? ($(this).is(":checked") ? 1 : 0) : $(this).val();
				page.hec.rows[idx][f] = val;
			});
		$(this)
			.find("input.hec-result")
			.on("keydown", function (e) {
				if (e.which === 13) {
					e.preventDefault();
					var next = page.main.find("input.hec-result:not([readonly])").eq(
						page.main.find("input.hec-result:not([readonly])").index(this) + 1
					);
					if (next.length) next.focus().select();
					else save_results(page);
				}
			});
	});
}

function collect_rows(page) {
	page.main.find(".hec-lab-grid tbody tr[data-idx]").each(function () {
		var idx = cint($(this).data("idx"));
		$(this)
			.find("input")
			.each(function () {
				var f = $(this).data("f");
				if (!f) return;
				var val = $(this).attr("type") === "checkbox" ? ($(this).is(":checked") ? 1 : 0) : $(this).val();
				page.hec.rows[idx][f] = val;
			});
	});
}

function save_results(page) {
	if (!page.hec.detail || !page.hec.detail.lab_report) {
		frappe.msgprint(__("Open a report first"));
		return;
	}
	collect_rows(page);
	page.main.find(".hec-lab-status").text(__("Saving…"));
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_save_lab_entry",
		args: {
			lab_report: page.hec.detail.lab_report,
			parameters: page.hec.rows,
		},
		freeze: true,
		freeze_message: __("Saving results…"),
		callback: function (r) {
			var msg = r.message || {};
			if (!msg.ok) {
				frappe.msgprint(msg.message || __("Save failed"));
				page.main.find(".hec-lab-status").html(`<span class="text-danger">${__("Save failed")}</span>`);
				return;
			}
			page.hec.detail = msg.data || page.hec.detail;
			page.hec.rows = (page.hec.detail.parameters || page.hec.rows).map(function (p) {
				return Object.assign({}, p);
			});
			render_meta(page);
			render_grid(page);
			frappe.show_alert({ message: __("Results saved"), indicator: "green" });
			page.main.find(".hec-lab-status").html(`<span class="text-success">${__("Saved")} · ${__("changed")}: ${(msg.data && msg.data.changed) || 0}</span>`);
		},
	});
}

function import_machine(page) {
	if (!page.hec.detail || !page.hec.detail.lab_report) {
		frappe.msgprint(__("Open a report first"));
		return;
	}
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_import_machine_lab_entry",
		args: { lab_report: page.hec.detail.lab_report },
		freeze: true,
		callback: function (r) {
			var msg = r.message || {};
			if (!msg.ok) {
				frappe.msgprint(msg.message || __("Import failed"));
				return;
			}
			frappe.show_alert({ message: __("Machine results imported"), indicator: "green" });
			open_entry(page, page.hec.detail.customer_trf, page.hec.detail.lab_report);
		},
	});
}

function reload_params(page) {
	if (!page.hec.detail || !page.hec.detail.lab_report) {
		frappe.msgprint(__("Open a report first"));
		return;
	}
	frappe.confirm(__("Reload parameters from TRF? Unsaved results will be lost."), function () {
		frappe.call({
			method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_reload_lab_entry",
			args: { lab_report: page.hec.detail.lab_report },
			freeze: true,
			callback: function (r) {
				var msg = r.message || {};
				if (!msg.ok) {
					frappe.msgprint(msg.message || __("Reload failed"));
					return;
				}
				page.hec.detail = msg.data || {};
				page.hec.rows = (page.hec.detail.parameters || []).map(function (p) {
					return Object.assign({}, p);
				});
				render_meta(page);
				render_grid(page);
			},
		});
	});
}

function finalize_report(page) {
	if (!page.hec.detail || !page.hec.detail.lab_report) {
		frappe.msgprint(__("Open a report first"));
		return;
	}
	frappe.confirm(__("Save and finalize this report for review?"), function () {
		collect_rows(page);
		frappe.call({
			method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_save_lab_entry",
			args: { lab_report: page.hec.detail.lab_report, parameters: page.hec.rows },
			callback: function () {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_result_entry.api_finalize_lab_entry",
					args: { lab_report: page.hec.detail.lab_report },
					freeze: true,
					callback: function (r) {
						var msg = r.message || {};
						if (!msg.ok) {
							frappe.msgprint(msg.message || __("Finalize failed"));
							return;
						}
						frappe.show_alert({ message: __("Report finalized"), indicator: "green" });
						open_entry(page, page.hec.detail.customer_trf, page.hec.detail.lab_report);
						load_queue(page);
					},
				});
			},
		});
	});
}
