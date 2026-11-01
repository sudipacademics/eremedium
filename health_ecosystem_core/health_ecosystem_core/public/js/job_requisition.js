frappe.ui.form.on('Job Requisition', {
	refresh(frm) {
		if (frm.doc.status === 'Open') {
			frm.add_custom_button(__('Publish to Careers'), () => {
				frappe.call({
					method:
						'health_ecosystem_core.health_ecosystem_core.clinical_phase112_wb_hiring.publish_requisition_to_opening',
					args: { requisition: frm.doc.name },
					freeze: true,
					callback(r) {
						const d = (r.message && r.message.data) || r.message || {};
						frappe.show_alert({
							message: __('Published Job Opening: {0}', [d.job_opening || '']),
							indicator: 'green',
						});
						frm.reload_doc();
					},
				});
			}, __('ATS'));
		}
	},
});
