frappe.ui.form.on("Pharmacy Order", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}
		const isQuote =
			frm.doc.order_kind === "Chronic quote" || frm.doc.delivery_status === "Quotation Pending";
		if (isQuote && frm.doc.delivery_status === "Quotation Pending") {
			frm.add_custom_button(__("Send quote to patient"), () => hec_send_pharmacy_quote_dialog(frm), "primary");
		}
		if (frm.doc.delivery_status === "Quote Sent" && frm.doc.order_total > 0) {
			frm.set_intro(
				__("Quote sent — patient can pay ₹{0} from My orders on the portal.", [
					frm.doc.order_total,
				]),
				"blue"
			);
		}
	},
});

function hec_send_pharmacy_quote_dialog(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Send pharmacy quote"),
		fields: [
			{
				fieldname: "items_html",
				fieldtype: "HTML",
				options: `<p class="text-muted">${__(
					"Enter one medicine per line: Name | Qty | Rate"
				)}</p>`,
			},
			{
				fieldname: "items_text",
				fieldtype: "Small Text",
				label: __("Medicines"),
				reqd: 1,
				description: __("Example: Metformin 500mg | 60 | 3.50"),
			},
			{
				fieldname: "order_total",
				fieldtype: "Currency",
				label: __("Pack total (INR)"),
				reqd: 1,
				default: frm.doc.order_total || 0,
			},
			{
				fieldname: "pharmacist_notes",
				fieldtype: "Small Text",
				label: __("Notes for patient"),
			},
		],
		primary_action_label: __("Send quote"),
		primary_action(values) {
			const items = hec_parse_quote_lines(values.items_text);
			if (!items.length) {
				frappe.msgprint(__("Add at least one medicine line"));
				return;
			}
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_phase32_pharmacy_quote.send_pharmacy_quote",
				args: {
					order_id: frm.doc.name,
					order_total: values.order_total,
					items_json: JSON.stringify(items),
					pharmacist_notes: values.pharmacist_notes,
				},
				freeze: true,
				callback(r) {
					if (!r.exc && r.message?.status === "success") {
						d.hide();
						frm.reload_doc();
						frappe.show_alert({ message: __("Quote sent"), indicator: "green" });
					}
				},
			});
		},
	});
	d.show();
}

function hec_parse_quote_lines(text) {
	const items = [];
	(text || "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.forEach((line) => {
			const parts = line.split("|").map((p) => p.trim());
			const name = parts[0];
			if (!name) {
				return;
			}
			const qty = parseFloat(parts[1] || "1") || 1;
			const rate = parseFloat(parts[2] || "0") || 0;
			items.push({
				item_name: name,
				item_code: name.slice(0, 140),
				qty,
				rate,
				amount: qty * rate,
			});
		});
	return items;
}
