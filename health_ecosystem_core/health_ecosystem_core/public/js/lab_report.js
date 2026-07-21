const ABNORMAL_FLAGS = new Set(["H", "L", "Critical", "HIGH", "LOW"]);

function labReportSummary(frm) {
	const rows = frm.doc.parameters || [];
	const filled = rows.filter((r) => r.result_value).length;
	const abnormal = rows.filter((r) => ABNORMAL_FLAGS.has(r.abnormal_flag)).length;
	const pending = rows.length - filled;
	return { total: rows.length, filled, abnormal, pending };
}

function renderLabReportSummary(frm) {
	const s = labReportSummary(frm);
	const status = frm.doc.report_status || "Draft";
	const html = `
		<div class="lab-report-summary" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
			<span class="indicator ${status === "Authorized" ? "green" : status === "Verified" ? "orange" : "blue"}">
				${__(status)}
			</span>
			<span class="text-muted">${__("{0} parameters", [s.total])}</span>
			<span class="text-muted">${__("{0} filled", [s.filled])}</span>
			<span style="color:#b91c1c;font-weight:600;">${__("{0} abnormal", [s.abnormal])}</span>
			<span class="text-muted">${__("{0} pending", [s.pending])}</span>
		</div>`;
	if (!frm.lab_report_summary) {
		frm.lab_report_summary = $(html).prependTo(frm.fields_dict.parameters.wrapper);
	} else {
		frm.lab_report_summary.replaceWith($(html));
		frm.lab_report_summary = frm.fields_dict.parameters.wrapper.find(".lab-report-summary").first();
	}
}

function highlightAbnormalGrid(frm) {
	const grid = frm.fields_dict.parameters?.grid;
	if (!grid || !grid.grid_rows) return;
	grid.grid_rows.forEach((row) => {
		const flag = row.doc.abnormal_flag;
		const resultCol = row.columns?.result_value;
		const flagCol = row.columns?.abnormal_flag;
		if (resultCol) {
			resultCol.css("font-weight", ABNORMAL_FLAGS.has(flag) ? "700" : "");
			resultCol.css("color", flag === "H" || flag === "Critical" ? "#b91c1c" : flag === "L" ? "#1d4ed8" : "");
		}
		if (flagCol) {
			flagCol.css("font-weight", ABNORMAL_FLAGS.has(flag) ? "700" : "");
			flagCol.css("color", flag === "H" || flag === "Critical" ? "#b91c1c" : flag === "L" ? "#1d4ed8" : "#16a34a");
		}
	});
}

function callLabMethod(frm, method, args, onSuccess) {
	return frappe.call({
		method,
		args: { lab_report: frm.doc.name, ...args },
		freeze: true,
		callback(r) {
			if (r.message?.status === "error") {
				frappe.msgprint(r.message.message || __("Request failed"));
				return;
			}
			if (onSuccess) onSuccess(r);
			else frm.reload_doc();
		},
	});
}

function isCalculatedRow(doc) {
	return doc.parameter_kind === "Calculated" || Number(doc.is_calculated) === 1;
}

function lockCalculatedRows(frm) {
	const grid = frm.fields_dict.parameters?.grid;
	if (!grid || !grid.grid_rows) return;
	grid.grid_rows.forEach((row) => {
		const calculated = isCalculatedRow(row.doc);
		if (row.toggle_editable) {
			row.toggle_editable("result_value", !calculated);
		}
		if (calculated && row.doc.formula) {
			row.wrapper?.attr("title", __("Derived on Save: {0}", [row.doc.formula]));
		}
	});
}

frappe.ui.form.on("Lab Report", {
	onload(frm) {
		["section_patient", "section_dates", "section_signoff", "section_titles", "section_billing", "section_print"].forEach(
			(field) => {
				if (frm.fields_dict[field]) {
					frm.set_df_property(field, "collapsible", 1);
				}
			},
		);
	},

	refresh(frm) {
		if (frm.is_new()) return;

		renderLabReportSummary(frm);
		setTimeout(() => {
			highlightAbnormalGrid(frm);
			lockCalculatedRows(frm);
		}, 300);

		frm.clear_custom_buttons();

		frm.add_custom_button(__("Reload from TRF"), () => {
			callLabMethod(
				frm,
				"health_ecosystem_core.health_ecosystem_core.clinical_phase8.reload_lab_report_parameters",
				{},
				() => {
					frm.reload_doc();
					frappe.show_alert({ message: __("Parameter grid refreshed"), indicator: "green" });
				},
			);
		}, __("Workflow"));

		frm.add_custom_button(__("Import Machine"), () => {
			callLabMethod(
				frm,
				"health_ecosystem_core.health_ecosystem_core.clinical_phase8.import_machine_results_to_report",
				{},
				(r) => {
					frm.reload_doc();
					const imported = r.message?.data?.imported ?? 0;
					frappe.show_alert({
						message: __("Imported {0} machine result(s)", [imported]),
						indicator: "green",
					});
				},
			);
		}, __("Workflow"));

		frm.add_custom_button(__("Recalculate"), () => {
			callLabMethod(
				frm,
				"health_ecosystem_core.health_ecosystem_core.clinical_phase8.recalculate_lab_report",
				{},
				() => {
					frm.reload_doc();
					frappe.show_alert({ message: __("Derived parameters recalculated"), indicator: "green" });
				},
			);
		}, __("Workflow"));

		if (frm.doc.report_status !== "Authorized" && frm.doc.report_status !== "Printed") {
			frm.add_custom_button(
				__("Finalize → Review"),
				() => {
					frappe.confirm(__("Save results and send to pathologist review?"), () => {
						frm.save().then(() => {
							callLabMethod(
								frm,
								"health_ecosystem_core.health_ecosystem_core.clinical_phase8.finalize_lab_report",
								{},
								() => {
									frm.reload_doc();
									frappe.show_alert({
										message: __("Report sent for pathologist review"),
										indicator: "green",
									});
								},
							);
						});
					});
				},
				__("Workflow"),
			).addClass("btn-primary");
		}

		const roles = frappe.user_roles || [];
		if (
			frm.doc.report_status === "Verified" &&
			frm.doc.care_journey &&
			(roles.includes("Pathologist") || roles.includes("Health System Admin") || roles.includes("System Manager"))
		) {
			frm.add_custom_button(
				__("Authorize & PDF"),
				() => {
					frappe.prompt(
						[{ fieldname: "pathologist_notes", fieldtype: "Small Text", label: __("Notes (optional)") }],
						(values) => {
							frappe.call({
								method: "health_ecosystem_core.health_ecosystem_core.clinical_journey.authorize_lab_report",
								args: {
									journey_id: frm.doc.care_journey,
									pathologist_notes: values.pathologist_notes,
								},
								freeze: true,
								callback(r) {
									if (r.message?.status === "success") {
										frm.reload_doc();
										frappe.show_alert({
											message: __("Report authorized — patient notified"),
											indicator: "green",
										});
									}
								},
							});
						},
						__("Authorize lab report"),
						__("Authorize"),
					);
				},
				__("Workflow"),
			).addClass("btn-primary");
		}

		frm.add_custom_button(__("Preview NABL PDF"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_phase8.get_lab_report_preview_html",
				args: { lab_report: frm.doc.name },
				callback(r) {
					const html = r.message;
					if (!html) return;
					const w = window.open("", "_blank");
					if (w) {
						w.document.write(html);
						w.document.close();
					}
				},
			});
		}, __("Actions"));

		if (frm.doc.customer_trf) {
			frm.add_custom_button(__("Open TRF"), () => {
				frappe.set_route("Form", "Customer TRF", frm.doc.customer_trf);
			}, __("Actions"));
		}

		if (frm.doc.care_journey) {
			frm.add_custom_button(__("Care Journey"), () => {
				frappe.set_route("Form", "Patient Care Journey", frm.doc.care_journey);
			}, __("Actions"));
		}
	},

	parameters_on_form_rendered(frm) {
		highlightAbnormalGrid(frm);
		lockCalculatedRows(frm);
	},

	before_save(frm) {
		// Server validate recalculates Derivation Equations for Calculated rows
		frappe.show_alert({
			message: __("Evaluating derivation equations on Save…"),
			indicator: "blue",
		});
	},
});

frappe.ui.form.on("Lab Report Parameter", {
	result_value(frm) {
		setTimeout(() => highlightAbnormalGrid(frm), 100);
	},
	abnormal_flag(frm) {
		setTimeout(() => highlightAbnormalGrid(frm), 100);
	},
});
