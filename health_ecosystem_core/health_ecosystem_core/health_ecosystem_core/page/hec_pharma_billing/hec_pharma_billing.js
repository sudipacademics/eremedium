frappe.pages["hec-pharma-billing"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("HEC Pharma Billing"),
		single_column: true,
	});

	page.hec = {
		direction: "sales",
		rows: [blank_row()],
		last_invoice: null,
	};

	page.set_primary_action(__("Save Invoice"), function () {
		save_invoice(page);
	});
	page.set_secondary_action(__("New Item"), function () {
		open_item_quick_entry(page);
	});
	page.add_inner_button(__("Add Line"), function () {
		page.hec.rows.push(blank_row());
		render(page);
	});
	page.add_inner_button(__("Print Last"), function () {
		print_last(page);
	});

	render(page);
};

function blank_row() {
	return {
		item_code: "",
		hec_pack_size: "",
		hec_batch_no: "",
		hec_expiry_date: "",
		qty: 1,
		free_qty: 0,
		lot_scheme: "",
		hec_item_mrp: 0,
		rate: 0,
		discount_percentage: 0,
		hec_gst_rate: 0,
	};
}

function render(page) {
	var d = page.hec.direction;
	var html = `
	<style>
		.hec-pharma-bill .hec-toolbar { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; align-items:end; }
		.hec-pharma-bill .hec-field { min-width:140px; }
		.hec-pharma-bill .hec-field label { display:block; font-size:11px; color:#666; margin-bottom:2px; }
		.hec-pharma-bill table { width:100%; border-collapse:collapse; font-size:12px; }
		.hec-pharma-bill th, .hec-pharma-bill td { border:1px solid #d1d8dd; padding:4px; }
		.hec-pharma-bill th { background:#f5f7fa; text-align:center; white-space:nowrap; }
		.hec-pharma-bill input, .hec-pharma-bill select { width:100%; border:1px solid #d1d8dd; border-radius:3px; padding:3px 4px; }
		.hec-pharma-bill .hec-dir button.active { background:#2490ef; color:#fff; }
		.hec-pharma-bill .hec-status { margin-top:10px; }
	</style>
	<div class="hec-pharma-bill">
		<div class="hec-toolbar">
			<div class="hec-field hec-dir">
				<label>${__("Type")}</label>
				<button type="button" class="btn btn-default btn-sm ${d === "sales" ? "active" : ""}" data-dir="sales">${__("Sales")}</button>
				<button type="button" class="btn btn-default btn-sm ${d === "purchase" ? "active" : ""}" data-dir="purchase">${__("Purchase")}</button>
			</div>
			<div class="hec-field" style="min-width:220px">
				<label>${d === "sales" ? __("Customer") : __("Supplier")}</label>
				<input type="text" class="hec-party" placeholder="${__("Party name")}" value="${frappe.utils.escape_html(page.hec.party || "")}">
			</div>
			<div class="hec-field">
				<label>${__("Posting Date")}</label>
				<input type="date" class="hec-posting" value="${page.hec.posting_date || frappe.datetime.get_today()}">
			</div>
			<div class="hec-field">
				<label>${__("Invoice Disc %")}</label>
				<input type="number" step="0.01" class="hec-inv-disc" value="${page.hec.inv_disc || 0}">
			</div>
			<div class="hec-field">
				<label>${__("Transport")}</label>
				<input type="text" class="hec-transport" value="${frappe.utils.escape_html(page.hec.transport || "")}">
			</div>
			<div class="hec-field">
				<label>${__("E-Way Bill")}</label>
				<input type="text" class="hec-eway" value="${frappe.utils.escape_html(page.hec.eway || "")}">
			</div>
		</div>
		<div style="overflow-x:auto">
		<table>
			<thead>
				<tr>
					<th>${__("Item")}</th>
					<th>${__("Pack")}</th>
					<th>${__("Batch")}</th>
					<th>${__("Exp")}</th>
					<th>${__("Qty")}</th>
					<th>${__("Free")}</th>
					<th>${__("Lot")}</th>
					<th>${__("MRP")}</th>
					<th>${__("Rate")}</th>
					<th>${__("DIS%")}</th>
					<th>${__("GST%")}</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				${page.hec.rows
					.map(
						(r, i) => `
				<tr data-idx="${i}">
					<td style="min-width:160px"><input class="hec-item" data-f="item_code" value="${frappe.utils.escape_html(r.item_code || "")}" list="hec-item-list"></td>
					<td><input data-f="hec_pack_size" value="${frappe.utils.escape_html(r.hec_pack_size || "")}"></td>
					<td><input data-f="hec_batch_no" value="${frappe.utils.escape_html(r.hec_batch_no || "")}"></td>
					<td><input type="date" data-f="hec_expiry_date" value="${r.hec_expiry_date || ""}"></td>
					<td><input type="number" step="0.001" data-f="qty" value="${r.qty || 0}"></td>
					<td><input type="number" step="0.001" data-f="free_qty" value="${r.free_qty || 0}"></td>
					<td><input data-f="lot_scheme" placeholder="9:1" value="${frappe.utils.escape_html(r.lot_scheme || "")}"></td>
					<td><input type="number" step="0.01" data-f="hec_item_mrp" value="${r.hec_item_mrp || 0}"></td>
					<td><input type="number" step="0.01" data-f="rate" value="${r.rate || 0}"></td>
					<td><input type="number" step="0.01" data-f="discount_percentage" value="${r.discount_percentage || 0}"></td>
					<td><input type="number" step="0.01" data-f="hec_gst_rate" value="${r.hec_gst_rate || 0}"></td>
					<td><button type="button" class="btn btn-xs btn-default hec-del">${__("×")}</button></td>
				</tr>`
					)
					.join("")}
			</tbody>
		</table>
		</div>
		<datalist id="hec-item-list"></datalist>
		<div class="hec-status text-muted"></div>
	</div>`;

	page.main.html(html);
	bind(page);
	load_item_list(page);
}

function bind(page) {
	page.main.find("[data-dir]").on("click", function () {
		page.hec.direction = $(this).data("dir");
		render(page);
	});
	page.main.find(".hec-party").on("change", function () {
		page.hec.party = $(this).val();
	});
	page.main.find(".hec-posting").on("change", function () {
		page.hec.posting_date = $(this).val();
	});
	page.main.find(".hec-inv-disc").on("change", function () {
		page.hec.inv_disc = flt($(this).val());
	});
	page.main.find(".hec-transport").on("change", function () {
		page.hec.transport = $(this).val();
	});
	page.main.find(".hec-eway").on("change", function () {
		page.hec.eway = $(this).val();
	});

	page.main.find("tbody tr").each(function () {
		var idx = cint($(this).data("idx"));
		$(this)
			.find("input")
			.on("change", function () {
				var f = $(this).data("f");
				var val = $(this).val();
				if (["qty", "free_qty", "hec_item_mrp", "rate", "discount_percentage", "hec_gst_rate"].indexOf(f) >= 0) {
					val = flt(val);
				}
				page.hec.rows[idx][f] = val;
				if (f === "item_code" && val) {
					autofill_item(page, idx, val);
				}
				if (f === "lot_scheme" && val && page.hec.rows[idx].qty) {
					apply_lot(page, idx);
				}
			});
		$(this)
			.find(".hec-del")
			.on("click", function () {
				page.hec.rows.splice(idx, 1);
				if (!page.hec.rows.length) page.hec.rows.push(blank_row());
				render(page);
			});
	});
}

function apply_lot(page, idx) {
	var r = page.hec.rows[idx];
	var parts = String(r.lot_scheme || "").split(":");
	if (parts.length !== 2) return;
	var paid = cint(parts[0]);
	var free = cint(parts[1]);
	if (paid <= 0) return;
	var batch = paid + free;
	var received = cint(r.qty);
	var free_qty = Math.floor(received / batch) * free;
	var paid_qty = received - free_qty;
	r.qty = paid_qty;
	r.free_qty = free_qty;
	render(page);
}

function autofill_item(page, idx, item_code) {
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_get_hec_pharma_item_defaults",
		args: { item_code: item_code },
		callback: function (r) {
			var d = r.message || {};
			if (!d.item_code) return;
			var row = page.hec.rows[idx];
			row.hec_pack_size = d.hec_pack_size || row.hec_pack_size;
			row.hec_item_mrp = d.hec_item_mrp || row.hec_item_mrp;
			row.rate = d.rate || row.rate;
			row.hec_gst_rate = d.hec_gst_rate || row.hec_gst_rate;
			render(page);
		},
	});
}

function load_item_list(page) {
	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Item",
			fields: ["name"],
			filters: { disabled: 0 },
			limit_page_length: 200,
			order_by: "modified desc",
		},
		callback: function (r) {
			var opts = (r.message || [])
				.map(function (x) {
					return `<option value="${frappe.utils.escape_html(x.name)}">`;
				})
				.join("");
			page.main.find("#hec-item-list").html(opts);
		},
	});
}

function collect_header(page) {
	page.hec.party = page.main.find(".hec-party").val();
	page.hec.posting_date = page.main.find(".hec-posting").val();
	page.hec.inv_disc = flt(page.main.find(".hec-inv-disc").val());
	page.hec.transport = page.main.find(".hec-transport").val();
	page.hec.eway = page.main.find(".hec-eway").val();
	page.main.find("tbody tr").each(function () {
		var idx = cint($(this).data("idx"));
		$(this)
			.find("input")
			.each(function () {
				var f = $(this).data("f");
				var val = $(this).val();
				if (["qty", "free_qty", "hec_item_mrp", "rate", "discount_percentage", "hec_gst_rate"].indexOf(f) >= 0) {
					val = flt(val);
				}
				page.hec.rows[idx][f] = val;
			});
	});
}

function save_invoice(page) {
	collect_header(page);
	var items = (page.hec.rows || []).filter(function (r) {
		return r.item_code && flt(r.qty) > 0;
	});
	if (!items.length) {
		frappe.msgprint(__("Add at least one item line"));
		return;
	}
	page.main.find(".hec-status").text(__("Saving…"));
	frappe.call({
		method: "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice",
		args: {
			data: {
				direction: page.hec.direction,
				party: page.hec.party,
				posting_date: page.hec.posting_date,
				submit: 1,
				update_stock: 0,
				items: items,
				invoice_discount: page.hec.inv_disc
					? { apply_discount_on: "Net Total", additional_discount_percentage: page.hec.inv_disc }
					: {},
				transport: {
					hec_transport: page.hec.transport,
					hec_eway_bill: page.hec.eway,
				},
			},
		},
		freeze: true,
		freeze_message: __("Creating invoice…"),
		callback: function (r) {
			var msg = r.message || {};
			if (!msg.ok) {
				page.main.find(".hec-status").html(`<span class="text-danger">${__("Failed")}</span>`);
				return;
			}
			page.hec.last_invoice = msg;
			page.main.find(".hec-status").html(
				`<span class="text-success">${__("Saved")} <a href="/app/${msg.doctype
					.toLowerCase()
					.replace(/ /g, "-")}/${msg.invoice}">${msg.invoice}</a></span>`
			);
			frappe.show_alert({ message: __("Invoice {0} created", [msg.invoice]), indicator: "green" });
		},
	});
}

function print_last(page) {
	var last = page.hec.last_invoice;
	if (!last || !last.invoice) {
		frappe.msgprint(__("Save an invoice first"));
		return;
	}
	var url =
		"/printview?doctype=" +
		encodeURIComponent(last.doctype) +
		"&name=" +
		encodeURIComponent(last.invoice) +
		"&format=" +
		encodeURIComponent(last.print_format) +
		"&no_letterhead=0";
	window.open(url, "_blank");
}

function open_item_quick_entry(page) {
	var d = new frappe.ui.Dialog({
		title: __("Item Quick Entry"),
		fields: [
			{ fieldname: "item_code", label: __("Item Code"), fieldtype: "Data", reqd: 1 },
			{ fieldname: "item_name", label: __("Item Name"), fieldtype: "Data", reqd: 1 },
			{ fieldname: "hec_pack_size", label: __("Pack Size"), fieldtype: "Data", default: "1*10" },
			{ fieldname: "hec_item_mrp", label: __("MRP"), fieldtype: "Currency" },
			{ fieldname: "price_list_rate", label: __("Price List Rate"), fieldtype: "Currency" },
			{ fieldname: "hec_hsn_sac", label: __("HSN / SAC"), fieldtype: "Data" },
			{ fieldname: "hec_gst_rate", label: __("GST %"), fieldtype: "Float", default: 12 },
			{ fieldname: "has_batch_no", label: __("Has Batch"), fieldtype: "Check", default: 1 },
			{ fieldname: "has_expiry_date", label: __("Has Expiry"), fieldtype: "Check", default: 1 },
			{ fieldname: "is_stock_item", label: __("Is Stock Item"), fieldtype: "Check", default: 1 },
		],
		primary_action_label: __("Save Item"),
		primary_action: function (values) {
			frappe.call({
				method: "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_upsert_hec_pharma_item",
				args: { data: values },
				freeze: true,
				callback: function (r) {
					var msg = r.message || {};
					if (msg.ok) {
						frappe.show_alert({ message: __("Item {0} saved", [msg.item_code]), indicator: "green" });
						d.hide();
						page.hec.rows[page.hec.rows.length - 1].item_code = msg.item_code;
						if (msg.defaults) {
							Object.assign(page.hec.rows[page.hec.rows.length - 1], {
								hec_pack_size: msg.defaults.hec_pack_size,
								hec_item_mrp: msg.defaults.hec_item_mrp,
								rate: msg.defaults.rate,
								hec_gst_rate: msg.defaults.hec_gst_rate,
							});
						}
						render(page);
					}
				},
			});
		},
	});
	d.show();
}
