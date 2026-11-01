const TRF_FLOW = {
	Booked: "Sample Collected",
	"Sample Collected": "In Lab",
	"In Lab": "Completed",
};

frappe.ui.form.on("Customer TRF", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}

		render_draw_plan_banner(frm);

		const next = TRF_FLOW[frm.doc.order_status];
		if (next) {
			frm.add_custom_button(__("Move to {0}", [next]), () => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.api.update_order_status",
					args: { trf_id: frm.doc.name, order_status: next },
					freeze: true,
					callback() {
						frm.reload_doc();
						frappe.show_alert({ message: __("TRF and care journey updated"), indicator: "green" });
					},
				});
			}).addClass("btn-primary");
		}

		if ((frm.doc.tests || []).length) {
			const labels = frm.doc.tests.map((row) => row.item_name || row.item).join(", ");
			frm.set_df_property("test_required", "description", labels);
		}

		frm.add_custom_button(__("Rebuild Draw Plan"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession.rebuild_trf_draw_plan",
				args: { trf_id: frm.doc.name, preserve_received: 1 },
				freeze: true,
				freeze_message: __("Building tube draw plan…"),
				callback(r) {
					frm.reload_doc();
					const tubes = r.message?.tubes || [];
					frappe.show_alert({
						message: __("Draw plan: {0} tube(s)", [tubes.length]),
						indicator: "green",
					});
				},
			});
		}, __("Collection"));

		frm.add_custom_button(__("Receive Tube…"), () => {
			const options = (frm.doc.collection_tubes || [])
				.map((r) => r.accession_id)
				.filter(Boolean);
			if (!options.length) {
				frappe.msgprint(__("No collection tubes — rebuild draw plan first."));
				return;
			}
			frappe.prompt(
				[
					{
						fieldname: "accession_id",
						fieldtype: "Select",
						label: __("Accession ID"),
						options: options.join("\n"),
						reqd: 1,
					},
				],
				(values) => {
					frappe.call({
						method: "health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession.receive_trf_tube",
						args: { trf_id: frm.doc.name, accession_id: values.accession_id },
						freeze: true,
						callback() {
							frm.reload_doc();
							frappe.show_alert({ message: __("Tube received"), indicator: "green" });
						},
					});
				},
				__("Receive Collection Tube"),
				__("Receive")
			);
		}, __("Collection"));

		frm.add_custom_button(__("Reject Tube…"), () => {
			const options = (frm.doc.collection_tubes || [])
				.map((r) => r.accession_id)
				.filter(Boolean);
			if (!options.length) {
				frappe.msgprint(__("No collection tubes — rebuild draw plan first."));
				return;
			}
			frappe.prompt(
				[
					{
						fieldname: "accession_id",
						fieldtype: "Select",
						label: __("Accession ID"),
						options: options.join("\n"),
						reqd: 1,
					},
					{
						fieldname: "reason",
						fieldtype: "Data",
						label: __("Reason"),
						default: "Wrong Container",
						reqd: 1,
					},
				],
				(values) => {
					frappe.call({
						method: "health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession.reject_trf_tube",
						args: {
							trf_id: frm.doc.name,
							accession_id: values.accession_id,
							reason: values.reason,
						},
						freeze: true,
						callback() {
							frm.reload_doc();
							frappe.show_alert({ message: __("Tube rejected"), indicator: "orange" });
						},
					});
				},
				__("Reject Collection Tube"),
				__("Reject")
			);
		}, __("Collection"));

		if (frm.doc.care_journey) {
			frm.add_custom_button(__("Open Care Journey"), () => {
				frappe.set_route("Form", "Patient Care Journey", frm.doc.care_journey);
			});
		} else if (frm.doc.health_patient) {
			frm.add_custom_button(__("Link Care Journey"), () => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_journey.start_patient_journey",
					args: { patient: frm.doc.health_patient },
					freeze: true,
					callback(r) {
						const journey_id = r.message?.data?.journey_id;
						if (journey_id) {
							frappe.db.set_value("Customer TRF", frm.doc.name, "care_journey", journey_id).then(() => {
								frm.reload_doc();
							});
						}
					},
				});
			});
		}

		if (frm.doc.order_status === "In Lab" || frm.doc.order_status === "Completed") {
			frm.add_custom_button(__("Open Lab Report"), () => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_phase8.get_or_create_lab_report",
					args: { trf_id: frm.doc.name },
					freeze: true,
					callback(r) {
						const lab_report = r.message?.data?.lab_report;
						if (lab_report) {
							frappe.set_route("Form", "Lab Report", lab_report);
						}
					},
				});
			}).addClass("btn-primary");

			frm.add_custom_button(__("Generate NABL PDF"), () => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_phase8.complete_nabl_pdf_for_trf",
					args: { trf_id: frm.doc.name, fill_sample: 0, authorize: 1 },
					freeze: true,
					freeze_message: __("Building NABL report PDF…"),
					callback(r) {
						const data = r.message?.data || {};
						if (data.pdf_url) {
							window.open(data.pdf_url, "_blank");
							frappe.show_alert({ message: __("NABL PDF ready"), indicator: "green" });
						} else {
							frappe.msgprint(r.message?.message || __("NABL PDF failed"));
						}
						frm.reload_doc();
					},
				});
			}, __("Print"));
		}
	},
});

function render_draw_plan_banner(frm) {
	frm.dashboard.clear_headline();
	const tubes = frm.doc.collection_tubes || [];
	if (!tubes.length) {
		frm.dashboard.set_headline_alert(
			__(
				"Collection tubes not built yet — click <b>Collection → Rebuild Draw Plan</b> to generate accession IDs."
			),
			"orange"
		);
		return;
	}
	const rows = tubes
		.map((t) => {
			const code = frappe.utils.escape_html(t.tube_code || t.tube || "");
			const acc = frappe.utils.escape_html(t.accession_id || "");
			const color = frappe.utils.escape_html(t.cap_color || "");
			const vol = t.aggregated_volume_ml != null ? t.aggregated_volume_ml : "";
			const status = frappe.utils.escape_html(t.status || "");
			const tests = frappe.utils.escape_html(t.linked_tests || "");
			return `<tr>
				<td><b>${code}</b><br><small>${color}</small></td>
				<td><code>${acc}</code></td>
				<td>${vol} mL</td>
				<td>${status}</td>
				<td>${tests}</td>
			</tr>`;
		})
		.join("");
	const html = `
		<div style="margin:8px 0 12px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;">
			<div style="font-weight:700;margin-bottom:6px;">${__("Collection Draw Plan")} — ${tubes.length} ${__("tube(s)")}</div>
			<table class="table table-bordered" style="margin:0;background:#fff;">
				<thead><tr>
					<th>${__("Tube")}</th><th>${__("Accession")}</th><th>${__("Vol")}</th><th>${__("Status")}</th><th>${__("Tests")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	frm.dashboard.add_section(html, __("Draw Plan"), "draw-plan");
}
