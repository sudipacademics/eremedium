frappe.ui.form.on("Clinical Prescription", {
	therapeutic_template(frm) {
		if (!frm.doc.therapeutic_template || frm.doc.medicines?.length) {
			return;
		}
		frappe.call({
			method: "health_ecosystem_core.health_ecosystem_core.clinical_prescriptions.get_therapeutic_template",
			args: { template_name: frm.doc.therapeutic_template },
			callback(r) {
				const tpl = r.message?.data?.template;
				if (!tpl?.medicines?.length) {
					return;
				}
				frm.clear_table("medicines");
				tpl.medicines.forEach((row) => {
					const child = frm.add_child("medicines");
					child.medicine_item = row.medicine_item;
					child.dosage = row.dosage;
					child.duration = row.duration;
					child.frequency = row.frequency;
					child.instructions = row.instructions;
					child.salt = row.salt;
				});
				frm.refresh_field("medicines");
				if (tpl.department && !frm.doc.department) {
					frm.set_value("department", tpl.department);
				}
			},
		});
	},

	refresh(frm) {
		if (frm.is_new() || frm.doc.docstatus === 1) {
			return;
		}

		frm.add_custom_button(__("Submit Prescription"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_prescriptions.submit_clinical_prescription",
				args: { prescription_id: frm.doc.name },
				freeze: true,
				callback(r) {
					if (!r.exc && r.message?.status === "success") {
						frm.reload_doc();
					}
				},
			});
		}).addClass("btn-primary");

		if (frm.doc.diagnostics?.length) {
			frm.add_custom_button(__("Order Diagnostics"), () => {
				frappe.prompt(
					[
						{
							fieldname: "franchisee_id",
							label: __("Franchisee"),
							fieldtype: "Link",
							options: "Franchisee Profile",
							reqd: 1,
						},
						{
							fieldname: "collection_address",
							label: __("Collection Address"),
							fieldtype: "Small Text",
						},
					],
					(values) => {
						frappe.call({
							method: "health_ecosystem_core.health_ecosystem_core.clinical_diagnostics.order_diagnostics_from_prescription",
							args: {
								prescription_id: frm.doc.name,
								franchisee_id: values.franchisee_id,
								collection_address: values.collection_address,
							},
							freeze: true,
							callback(r) {
								if (!r.exc && r.message?.status === "success") {
									frappe.msgprint(__("Diagnostic TRF(s) created"));
									if (r.message.data?.care_journey) {
										frm.set_value("care_journey", r.message.data.care_journey);
									}
								}
							},
						});
					},
					__("Book Lab Tests"),
					__("Create TRF")
				);
			});
		}

		if (frm.doc.medicines?.length) {
			frm.add_custom_button(__("Create Pharmacy Order"), () => {
				frappe.call({
					method: "health_ecosystem_core.health_ecosystem_core.clinical_prescriptions.create_pharmacy_order_from_prescription",
					args: { prescription_id: frm.doc.name },
					freeze: true,
					callback(r) {
						if (!r.exc && r.message?.status === "success") {
							const order_id = r.message.data?.order_id;
							if (order_id) {
								frappe.set_route("Form", "Pharmacy Order", order_id);
							}
						}
					},
				});
			});
		}
	},
});
