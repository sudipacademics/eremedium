const ABNORMAL_FLAGS = new Set(["H", "L", "CRITICAL", "HIGH", "LOW", "Critical"]);

function labReportSummary(frm) {
	const rows = frm.doc.parameters || [];
	const filled = rows.filter((r) => r.result_value).length;
	const abnormal = listAbnormalParams(rows).length;
	const pending = rows.length - filled;
	return { total: rows.length, filled, abnormal, pending };
}

function clientFlagFromRanges(value, lower, upper) {
	const num = Number(value);
	if (value === "" || value == null || Number.isNaN(num)) {
		return "";
	}
	if (lower != null && lower !== "" && !Number.isNaN(Number(lower)) && num < Number(lower)) {
		return "L";
	}
	if (upper != null && upper !== "" && !Number.isNaN(Number(upper)) && num > Number(upper)) {
		return "H";
	}
	return "N";
}

function effectiveAbnormalFlag(row) {
	let flag = (row.abnormal_flag || "").trim();
	const rtype = (row.result_input_type || "Numeric").trim();
	if (rtype === "Numeric" || !rtype) {
		const computed = clientFlagFromRanges(row.result_value, row.lower_range, row.upper_range);
		if (computed) {
			flag = computed;
		}
	}
	return flag;
}

function isAbnormalFlag(flag) {
	const f = String(flag || "")
		.trim()
		.toUpperCase();
	if (!f || f === "N" || f === "NORMAL" || f === "—" || f === "-") {
		return false;
	}
	return ABNORMAL_FLAGS.has(flag) || ABNORMAL_FLAGS.has(f) || f === "H" || f === "L" || f === "CRITICAL";
}

function listAbnormalParams(rows) {
	return (rows || [])
		.filter((r) => (r.result_value || "").toString().trim())
		.filter((r) => {
			const rtype = (r.result_input_type || "Numeric").trim();
			if (rtype === "Heading" || rtype === "Spacer") {
				return false;
			}
			return isAbnormalFlag(effectiveAbnormalFlag(r));
		})
		.map((r) => ({
			description: r.description || r.parameter_code || __("Parameter"),
			result_value: r.result_value,
			flag: effectiveAbnormalFlag(r),
			range:
				r.reference_range_label ||
				(r.lower_range != null && r.upper_range != null ? `${r.lower_range}-${r.upper_range}` : ""),
		}));
}

function syncClientAbnormalFlags(frm) {
	(frm.doc.parameters || []).forEach((row) => {
		const rtype = (row.result_input_type || "Numeric").trim();
		if (rtype !== "Numeric" && rtype) {
			return;
		}
		if (!(row.result_value || "").toString().trim()) {
			return;
		}
		const computed = clientFlagFromRanges(row.result_value, row.lower_range, row.upper_range);
		if (computed) {
			row.abnormal_flag = computed;
		}
	});
}

function confirmIfAbnormal(rows, actionLabel, onConfirm) {
	const abnormal = listAbnormalParams(rows);
	if (!abnormal.length) {
		onConfirm();
		return;
	}
	const lines = abnormal
		.slice(0, 12)
		.map((a) => `• ${a.description} = ${a.result_value} (${a.flag}${a.range ? `, ref ${a.range}` : ""})`)
		.join("<br>");
	const more = abnormal.length > 12 ? `<br>${__("{0} more…", [abnormal.length - 12])}` : "";
	frappe.confirm(
		__(
			"<b>Abnormal result(s) found ({0}).</b><br><br>{1}{2}<br><br>This is abnormal — confirm {3}?",
			[abnormal.length, lines, more, actionLabel]
		),
		onConfirm
	);
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
		const flag = effectiveAbnormalFlag(row.doc);
		const resultCol = row.columns?.result_value;
		const flagCol = row.columns?.abnormal_flag;
		if (resultCol) {
			resultCol.css("font-weight", isAbnormalFlag(flag) ? "700" : "");
			resultCol.css(
				"color",
				flag === "H" || flag === "Critical" || String(flag).toUpperCase() === "CRITICAL"
					? "#b91c1c"
					: flag === "L"
						? "#1d4ed8"
						: ""
			);
		}
		if (flagCol) {
			flagCol.css("font-weight", isAbnormalFlag(flag) ? "700" : "");
			flagCol.css(
				"color",
				flag === "H" || flag === "Critical" || String(flag).toUpperCase() === "CRITICAL"
					? "#b91c1c"
					: flag === "L"
						? "#1d4ed8"
						: "#16a34a"
			);
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
			}
		);
	},

	refresh(frm) {
		if (frm.is_new()) return;

		syncClientAbnormalFlags(frm);
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
				}
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
				}
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
				}
			);
		}, __("Workflow"));

		if (frm.doc.report_status !== "Authorized" && frm.doc.report_status !== "Printed") {
			frm.add_custom_button(
				__("Finalize → Review"),
				() => {
					syncClientAbnormalFlags(frm);
					confirmIfAbnormal(frm.doc.parameters, __("finalize for review"), () => {
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
									}
								);
							});
						});
					});
				},
				__("Workflow")
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
					syncClientAbnormalFlags(frm);
					confirmIfAbnormal(frm.doc.parameters, __("authorization"), () => {
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
							__("Authorize")
						);
					});
				},
				__("Workflow")
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
		syncClientAbnormalFlags(frm);
		frappe.show_alert({
			message: __("Evaluating derivation equations on Save…"),
			indicator: "blue",
		});
	},
});

frappe.ui.form.on("Lab Report Parameter", {
	result_value(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		const rtype = (row.result_input_type || "Numeric").trim();
		if (rtype === "Numeric" || !rtype) {
			const computed = clientFlagFromRanges(row.result_value, row.lower_range, row.upper_range);
			if (computed) {
				frappe.model.set_value(cdt, cdn, "abnormal_flag", computed);
			}
		}
		setTimeout(() => {
			renderLabReportSummary(frm);
			highlightAbnormalGrid(frm);
		}, 100);
	},
	abnormal_flag(frm) {
		setTimeout(() => {
			renderLabReportSummary(frm);
			highlightAbnormalGrid(frm);
		}, 100);
	},
});
