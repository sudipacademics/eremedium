const HEC_JOURNEY_FLOW = [
	"Nursing Intake",
	"Doctor Consultation",
	"Prescription Issued",
	"Medicine Ordered",
	"Diagnostics Booked",
	"Phlebotomist Assigned",
	"Sample Collected",
	"In Lab",
	"Report Review",
	"Authorized",
	"Dispatched",
];

function hec_status_index(status) {
	return HEC_JOURNEY_FLOW.indexOf(status);
}

function hec_next_journey_status(current) {
	const idx = hec_status_index(current);
	if (idx < 0 || idx >= HEC_JOURNEY_FLOW.length - 1) {
		return null;
	}
	return HEC_JOURNEY_FLOW[idx + 1];
}

function hec_prev_journey_status(current) {
	const idx = hec_status_index(current);
	if (idx <= 0) {
		return null;
	}
	return HEC_JOURNEY_FLOW[idx - 1];
}

function hec_render_pipeline(frm) {
	const current = frm.doc.status;
	const curIdx = hec_status_index(current);
	const steps = HEC_JOURNEY_FLOW.map((step, i) => {
		const done = i < curIdx;
		const active = i === curIdx;
		const bg = active ? "#0d9488" : done ? "#99f6e4" : "#e2e8f0";
		const color = active ? "#fff" : "#0f172a";
		const weight = active ? "600" : "400";
		return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:${bg};color:${color};font-weight:${weight};font-size:11px;white-space:nowrap;">${done ? "✓ " : ""}${frappe.utils.escape_html(step)}</span>`;
	}).join('<span style="color:#94a3b8;">›</span>');
	frm.dashboard.add_section(
		`<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;">${steps}</div>`,
		__("Care pipeline")
	);
}

function hec_transition(frm, to_status, extra = {}) {
	return frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase33_journey_ops.journey_transition",
		args: { journey_id: frm.doc.name, to_status, ...extra },
		freeze: true,
		freeze_message: __("Updating journey…"),
		callback(r) {
			if (!r.exc && r.message?.status === "success") {
				frm.reload_doc();
				frappe.show_alert({ message: __("Journey moved to {0}", [to_status]), indicator: "green" });
			}
		},
	});
}

function hec_assign_phlebo_dialog(frm, to_status) {
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase33_journey_ops.list_active_phlebotomists",
		callback(r) {
			const list = (r.message?.data?.phlebotomists) || [];
			const options = list.map((p) => ({ label: `${p.full_name} (${p.user})`, value: p.user }));
			const d = new frappe.ui.Dialog({
				title: __("Assign phlebotomist"),
				fields: [
					{
						fieldname: "phlebotomist",
						fieldtype: "Autocomplete",
						label: __("Phlebotomist"),
						reqd: 1,
						options,
						default: frm.doc.phlebotomist || (options[0] && options[0].value),
					},
				],
				primary_action_label: __("Assign & advance"),
				primary_action(values) {
					d.hide();
					hec_transition(frm, to_status, { phlebotomist: values.phlebotomist });
				},
			});
			if (!options.length) {
				d.set_df_property("phlebotomist", "fieldtype", "Link");
				d.set_df_property("phlebotomist", "options", "User");
			}
			d.show();
		},
	});
}

function hec_render_activity(frm) {
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase33_journey_ops.get_journey_activity",
		args: { journey_id: frm.doc.name },
		callback(r) {
			const activity = (r.message?.data?.activity) || [];
			if (!activity.length) {
				return;
			}
			const rows = activity
				.map(
					(a) =>
						`<li style="margin-bottom:6px;"><span>${frappe.utils.escape_html(a.content)}</span>` +
						`<span class="text-muted" style="margin-left:6px;font-size:11px;">${frappe.utils.escape_html(a.ago)}</span></li>`
				)
				.join("");
			frm.dashboard.add_section(
				`<ul style="list-style:none;padding-left:0;margin:6px 0;">${rows}</ul>`,
				__("Activity")
			);
		},
	});
}

function hec_add_journey_workflow_buttons(frm) {
	if (frm.is_new()) {
		return;
	}

	const next = hec_next_journey_status(frm.doc.status);
	if (next && next !== "Authorized") {
		frm.add_custom_button(
			__("Next: {0}", [next]),
			() => {
				if (next === "Phlebotomist Assigned") {
					hec_assign_phlebo_dialog(frm, next);
				} else {
					hec_transition(frm, next);
				}
			},
			null
		).addClass("btn-primary");
	}

	if (frm.doc.status !== "Phlebotomist Assigned" && hec_status_index(frm.doc.status) < hec_status_index("Phlebotomist Assigned")) {
		frm.add_custom_button(
			__("Assign phlebotomist"),
			() => hec_assign_phlebo_dialog(frm, "Phlebotomist Assigned"),
			__("Actions")
		);
	}

	const prev = hec_prev_journey_status(frm.doc.status);
	if (prev) {
		frm.add_custom_button(
			__("Back: {0}", [prev]),
			() => {
				frappe.confirm(__("Move journey back to {0}? (admin only)", [prev]), () =>
					hec_transition(frm, prev)
				);
			},
			__("Actions")
		);
	}

	if (frm.doc.customer_trf && frm.doc.status === "Diagnostics Booked") {
		frm.add_custom_button(
			__("Mark Sample Collected"),
			() => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.api.update_order_status",
					args: { trf_id: frm.doc.customer_trf, order_status: "Sample Collected" },
					freeze: true,
					callback() {
						frm.reload_doc();
					},
				});
			},
			__("Actions")
		);
	}

	if (frm.doc.status === "Report Review") {
		frm.add_custom_button(__("Authorize Report"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_journey.authorize_lab_report",
				args: { journey_id: frm.doc.name },
				freeze: true,
				callback(r) {
					if (!r.exc && r.message?.status === "success") {
						frm.reload_doc();
					}
				},
			});
		}).addClass("btn-primary");
	}

	if (frm.doc.status === "Authorized") {
		frm.add_custom_button(
			__("Mark Dispatched"),
			() => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_journey.dispatch_journey_report",
					args: { journey_id: frm.doc.name },
					freeze: true,
					callback() {
						frm.reload_doc();
					},
				});
			},
			__("Actions")
		);
	}

	if (frm.doc.report_pdf) {
		frm.add_custom_button(__("Open Report PDF"), () => window.open(frm.doc.report_pdf, "_blank"), __("Open"));
	}
	if (frm.doc.customer_trf) {
		frm.add_custom_button(__("TRF"), () => frappe.set_route("Form", "Customer TRF", frm.doc.customer_trf), __("Open"));
	}
	if (frm.doc.appointment) {
		frm.add_custom_button(__("Appointment"), () => frappe.set_route("Form", "Doctor Appointment", frm.doc.appointment), __("Open"));
	}
	if (frm.doc.prescription) {
		frm.add_custom_button(__("Prescription"), () => frappe.set_route("Form", "Clinical Prescription", frm.doc.prescription), __("Open"));
	}
	if (frm.doc.pharmacy_order) {
		frm.add_custom_button(__("Pharmacy Order"), () => frappe.set_route("Form", "Pharmacy Order", frm.doc.pharmacy_order), __("Open"));
	}
}

frappe.ui.form.on("Patient Care Journey", {
	refresh(frm) {
		hec_add_journey_workflow_buttons(frm);
		if (!frm.is_new()) {
			hec_render_pipeline(frm);
			hec_render_activity(frm);
		}
	},
});

frappe.listview_settings["Patient Care Journey"] = {
	get_indicator(doc) {
		const colors = {
			"Nursing Intake": "blue",
			"Doctor Consultation": "orange",
			"Prescription Issued": "purple",
			"Medicine Ordered": "pink",
			"Diagnostics Booked": "yellow",
			"Phlebotomist Assigned": "yellow",
			"Sample Collected": "cyan",
			"In Lab": "cyan",
			"Report Review": "red",
			Authorized: "green",
			Dispatched: "darkgrey",
		};
		return [__(doc.status), colors[doc.status] || "blue", doc.status];
	},
	onload(listview) {
		listview.page.add_inner_button(__("Pipeline Board"), () => {
			frappe.set_route("List", "Patient Care Journey", "Kanban", "Patient Care Pipeline");
		});
	},
	formatters: {
		status(value) {
			return `<strong>${frappe.utils.escape_html(value || "")}</strong>`;
		},
	},
};
