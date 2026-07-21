frappe.ui.form.on("Health Ecosystem Settings", {
	refresh(frm) {
		if (!frappe.user.has_role("System Manager") && !frappe.user.has_role("Health System Admin")) {
			return;
		}

		frm.add_custom_button(__("Check Integration Status"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_secrets.get_integration_status",
				callback(r) {
					if (r.message?.status !== "success") {
						frappe.msgprint(r.message?.message || __("Failed"));
						return;
					}
					const d = r.message.data;
					const otp = d.otp || {};
					const notes = d.notifications || {};
					frappe.msgprint({
						title: __("Integration Status"),
						message: `
							<b>OTP / SMS</b>: ${otp.configured ? __("MSG91 live") : __("Test mode — OTP 123456")}
							(${otp.provider || "Test"})<br>
							<b>Patient notifications</b>: ${notes.channel || __("unset")}
							(SMS test: ${notes.sms_test_mode ? __("yes") : __("no")},
							WhatsApp test: ${notes.whatsapp_test_mode ? __("yes") : __("no")})<br>
							<b>LIS</b>: ${d.lis.configured ? __("Configured") : __("Not configured")}
							(${d.lis.source})<br>
							<b>Razorpay</b>: ${d.razorpay.configured ? __("Live keys set") : __("Not configured — Pay Now disabled")}
							${d.razorpay.test_mode ? __(" (placeholder/test mode)") : ""}<br>
							<b>LIS requires payment</b>: ${d.lis_requires_payment ? __("Yes") : __("No")}<br>
							<b>Backend URL</b>: ${d.backend_base_url}<br>
							<b>Site</b>: ${d.site_name}
						`,
						indicator: otp.configured && d.razorpay.configured ? "green" : "orange",
					});
				},
			});
		}, __("Integrations"));

		frm.add_custom_button(__("Send Test OTP"), () => {
			frappe.prompt(
				[
					{
						fieldname: "mobile",
						label: __("Mobile"),
						fieldtype: "Data",
						reqd: 1,
						description: __("10-digit Indian mobile to receive a live OTP SMS"),
					},
				],
				(values) => {
					frappe.call({
						method: "health_ecosystem_core.health_ecosystem_core.otp_auth.send_otp",
						args: { mobile: values.mobile },
						freeze: true,
						callback(r) {
							const envelope = r.message || {};
							if (envelope.status !== "success") {
								frappe.msgprint(envelope.message || __("OTP send failed"), __("Error"), "red");
								return;
							}
							const payload = envelope.data || {};
							const testMode = payload.test_mode;
							const hint =
								payload.hint ||
								(testMode
									? __("Use OTP 123456 (test mode)")
									: __("Check the mobile for SMS. If nothing arrives, verify MSG91 wallet, sender ID, and DLT template."));
							frappe.msgprint({
								title: __("OTP sent"),
								message: hint,
								indicator: testMode ? "orange" : "green",
							});
						},
					});
				},
				__("Send test OTP"),
				__("Send")
			);
		}, __("Integrations"));

		frm.add_custom_button(__("Copy LIS Bridge Config"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_secrets.export_lis_bridge_snippet",
				callback(r) {
					if (r.message?.status !== "success") {
						frappe.msgprint(r.message?.message || __("Configure LIS keys first"));
						return;
					}
					frappe.utils.copy_to_clipboard(r.message.data.snippet);
					frappe.show_alert({
						message: __("LIS CONFIG copied — paste into lis_bridge.py on lab PC"),
						indicator: "green",
					});
				},
			});
		}, __("Integrations"));

		if (frappe.user.has_role("System Manager")) {
			frm.add_custom_button(__("Rotate LIS Keys"), () => {
				frappe.confirm(
					__("Generate new LIS API key/secret? You must update lis_bridge.py on the lab PC."),
					() => {
						frappe.call({
							method: "health_ecosystem_core.health_ecosystem_core.clinical_secrets.rotate_lis_api_keys",
							freeze: true,
							callback(r) {
								if (r.message?.status === "success") {
									frm.reload_doc();
									frappe.msgprint(r.message.message);
								}
							},
						});
					}
				);
			}, __("Integrations"));
		}
	},
});
