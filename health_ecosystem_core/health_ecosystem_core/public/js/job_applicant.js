frappe.ui.form.on("Job Applicant", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}

		frm.add_custom_button(__("Schedule Interview"), () => {
			frappe.prompt(
				[
					{
						fieldname: "scheduled_on",
						fieldtype: "Datetime",
						label: __("Interview Date & Time"),
						reqd: 1,
					},
					{
						fieldname: "notes",
						fieldtype: "Small Text",
						label: __("Notes"),
					},
				],
				(values) => {
					frappe.call({
						method:
							"health_ecosystem_core.health_ecosystem_core.ats_setup.schedule_interview_note",
						args: {
							applicant: frm.doc.name,
							scheduled_on: values.scheduled_on,
							notes: values.notes,
						},
						freeze: true,
						freeze_message: __("Scheduling interview…"),
						callback(r) {
							if (!r.exc) {
								frappe.show_alert({
									message: __("Interview noted on timeline"),
									indicator: "green",
								});
								frm.reload_doc();
							}
						},
					});
				},
				__("Schedule Interview"),
				__("Schedule")
			);
		});
	},
});
