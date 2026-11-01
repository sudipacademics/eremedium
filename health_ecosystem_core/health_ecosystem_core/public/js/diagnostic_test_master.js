function hecOpenHtmlPreview(html, title) {
	if (!html) {
		frappe.msgprint(__("No preview HTML returned."));
		return;
	}
	const w = window.open("", "_blank");
	if (!w) {
		frappe.msgprint(__("Popup blocked — allow popups to preview the report."));
		return;
	}
	w.document.write(html);
	w.document.close();
	try {
		w.document.title = title || __("Report Preview");
	} catch (e) {
		/* ignore */
	}
}

function hecPreviewDiagnosticTestMaster(masterName, defaults) {
	const name = (masterName || "").trim();
	if (!name) {
		frappe.msgprint(__("Save the Diagnostic Test Master first."));
		return;
	}
	const d = defaults || {};
	frappe.prompt(
		[
			{
				fieldname: "age",
				label: __("Patient age (years)"),
				fieldtype: "Int",
				default: d.age != null ? d.age : 35,
				reqd: 1,
			},
			{
				fieldname: "gender",
				label: __("Gender"),
				fieldtype: "Select",
				options: "Male\nFemale",
				default: d.gender || "Male",
				reqd: 1,
			},
			{
				fieldname: "fill_sample",
				label: __("Fill sample result values"),
				fieldtype: "Check",
				default: 1,
			},
		],
		(values) => {
			frappe.call({
				method:
					"health_ecosystem_core.health_ecosystem_core.clinical_phase8.preview_diagnostic_test_master_report",
				args: {
					name,
					age: values.age,
					gender: values.gender,
					fill_sample: values.fill_sample ? 1 : 0,
				},
				freeze: true,
				freeze_message: __("Building report preview…"),
				callback(r) {
					hecOpenHtmlPreview(r.message, __("Preview — {0}", [name]));
				},
			});
		},
		__("Preview final report"),
		__("Preview Report")
	);
}

frappe.ui.form.on("Diagnostic Test Master", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}
		frm.add_custom_button(__("Preview Report"), () => {
			const run = () => hecPreviewDiagnosticTestMaster(frm.doc.name);
			if (frm.is_dirty()) {
				frm.save().then(run);
			} else {
				run();
			}
		}).addClass("btn-primary");
	},
});

frappe.listview_settings["Diagnostic Test Master"] = {
	button: {
		show() {
			return true;
		},
		get_label() {
			return __("Preview");
		},
		get_action(doc) {
			return () => hecPreviewDiagnosticTestMaster(doc.name);
		},
	},
};
