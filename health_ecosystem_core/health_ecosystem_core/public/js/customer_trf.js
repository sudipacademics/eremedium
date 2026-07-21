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
		}
	},
});
