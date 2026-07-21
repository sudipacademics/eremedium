frappe.ui.form.on("Health Patient", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Patient Care Journey",
				filters: {
					patient: frm.doc.name,
					status: ["not in", ["Authorized", "Dispatched"]],
				},
				fields: ["name", "status"],
				order_by: "creation desc",
				limit: 1,
			},
			callback(r) {
				const journey = (r.message || [])[0];
				if (journey) {
					frm.add_custom_button(__("Care Journey ({0})", [journey.status]), () => {
						frappe.set_route("Form", "Patient Care Journey", journey.name);
					}).addClass("btn-primary");
					return;
				}

				frm.add_custom_button(__("Start Care Journey"), () => {
					frappe.call({
						method: "health_ecosystem_core.health_ecosystem_core.clinical_journey.start_patient_journey",
						args: { patient: frm.doc.name },
						freeze: true,
						callback(res) {
							if (!res.exc && res.message?.status === "success") {
								const journey_id = res.message.data?.journey_id;
								if (journey_id) {
									frappe.set_route("Form", "Patient Care Journey", journey_id);
								}
							}
						},
					});
				}).addClass("btn-primary");
			},
		});

		frm.add_custom_button(__("All Journeys"), () => {
			frappe.set_route("List", "Patient Care Journey", { patient: frm.doc.name });
		});
	},
});
