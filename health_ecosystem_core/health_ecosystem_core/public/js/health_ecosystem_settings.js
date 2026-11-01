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

		frm.add_custom_button(__("Generate LIS API Key & Secret"), () => {
			hec_generate_lis_keys(frm, /*confirm*/ 0);
		}, __("Integrations"));

		frm.add_custom_button(__("Copy LIS Bridge Config"), () => {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_secrets.export_lis_bridge_snippet",
				callback(r) {
					if (r.message?.status !== "success") {
						frappe.msgprint(r.message?.message || __("Configure LIS keys first — use Generate LIS API Key & Secret"));
						return;
					}
					const data = r.message.data || {};
					const text = data.env_json_text || data.snippet || "";
					frappe.utils.copy_to_clipboard(text);
					frappe.show_alert({
						message: __("LIS config copied — paste into em200.env.json on the lab PC"),
						indicator: "green",
					});
					hec_show_lis_credentials_dialog({
						title: __("Current LIS credentials"),
						api_key: data.api_key,
						api_secret: data.api_secret,
						backend_base_url: data.backend_base_url,
						site_name: data.site_name,
						env_json_text: data.env_json_text,
						snippet: data.snippet,
					});
				},
			});
		}, __("Integrations"));

		if (frappe.user.has_role("System Manager") || frappe.user.has_role("Health System Admin")) {
			frm.add_custom_button(__("Rotate LIS Keys"), () => {
				frappe.confirm(
					__("Generate NEW LIS API key/secret? Old bridge configs on lab PCs will stop working until updated."),
					() => hec_generate_lis_keys(frm, /*confirm*/ 1)
				);
			}, __("Integrations"));
		}
	},
});

function hec_generate_lis_keys(frm, confirm) {
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_secrets.generate_lis_api_credentials",
		args: { confirm: confirm ? 1 : 0 },
		freeze: true,
		freeze_message: __("Generating LIS credentials…"),
		callback(r) {
			const envelope = r.message || {};
			if (envelope.code === "CONFIRM_REQUIRED") {
				frappe.confirm(envelope.message || __("Keys already exist. Rotate anyway?"), () => {
					hec_generate_lis_keys(frm, 1);
				});
				return;
			}
			if (envelope.status !== "success") {
				frappe.msgprint({
					title: __("Could not generate keys"),
					message: envelope.message || __("Failed"),
					indicator: "red",
				});
				return;
			}
			const data = envelope.data || {};
			frm.reload_doc();
			hec_show_lis_credentials_dialog({
				title: __("New LIS API Key & Secret"),
				api_key: data.api_key,
				api_secret: data.api_secret,
				backend_base_url: data.backend_base_url,
				site_name: data.site_name,
			});
		},
	});
}

function hec_show_lis_credentials_dialog(opts) {
	const api_key = opts.api_key || "";
	const api_secret = opts.api_secret || "";
	const backend = opts.backend_base_url || "";
	const site = opts.site_name || "";
	const envText =
		opts.env_json_text ||
		JSON.stringify(
			{
				DEPLOY_MODE: "em200_pc",
				BACKEND_BASE_URL: backend,
				SITE_NAME: site,
				API_KEY: api_key,
				API_SECRET: api_secret,
				MACHINE_REFERENCE: "EM 200",
				LISTEN_HOST: "127.0.0.1",
				LISTEN_PORT: 8000,
				POWER: "ON",
			},
			null,
			2
		);

	const d = new frappe.ui.Dialog({
		title: opts.title || __("LIS credentials"),
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "help",
				options: `<p style="margin:0 0 12px;color:#555;">
					${__("Copy these into the lab PC")} <code>em200.env.json</code>
					${__("or FFMS Admin ERP smoke check. Do not WhatsApp secrets.")}
				</p>`,
			},
			{ fieldtype: "Data", fieldname: "api_key", label: __("API Key"), read_only: 1, default: api_key },
			{ fieldtype: "Data", fieldname: "api_secret", label: __("API Secret"), read_only: 1, default: api_secret },
			{ fieldtype: "Data", fieldname: "backend_base_url", label: __("Backend URL"), read_only: 1, default: backend },
			{ fieldtype: "Data", fieldname: "site_name", label: __("Site Name"), read_only: 1, default: site },
			{
				fieldtype: "Code",
				fieldname: "env_json",
				label: __("em200.env.json fragment"),
				options: "JSON",
				read_only: 1,
				default: envText,
			},
		],
		primary_action_label: __("Copy Key + Secret"),
		primary_action() {
			frappe.utils.copy_to_clipboard(`API_KEY=${api_key}\nAPI_SECRET=${api_secret}`);
			frappe.show_alert({ message: __("Key and secret copied"), indicator: "green" });
		},
		secondary_action_label: __("Copy JSON"),
		secondary_action() {
			frappe.utils.copy_to_clipboard(envText);
			frappe.show_alert({ message: __("JSON copied for em200.env.json"), indicator: "green" });
		},
	});
	d.show();
}
