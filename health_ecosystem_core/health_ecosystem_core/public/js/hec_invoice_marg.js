/**
 * Marg-style Purchase Entry for Purchase Invoice (+ lighter panel for Sales Invoice).
 * Flow: Supplier → Item popup → Available Stocks / new Batch → Qty/Rate/DIS → totals → Save.
 */
(function () {
	function safe(fn) {
		try {
			return fn();
		} catch (e) {
			console.error("HEC Marg invoice panel:", e);
			return null;
		}
	}

	function direction_for(doctype) {
		return doctype === "Purchase Invoice" ? "purchase" : "sales";
	}

	function blank_row() {
		return {
			item_code: "",
			item_name: "",
			stock_uom: "Nos",
			hec_pack_size: "",
			hec_batch_no: "",
			hec_expiry_date: "",
			qty: 1,
			hec_free_qty: 0,
			lot_scheme: "",
			hec_item_mrp: 0,
			selling_rate: 0,
			rate: 0,
			last_purchase_rate: 0,
			stock: 0,
			discount_percentage: 0,
			hec_gst_rate: 0,
		};
	}

	function line_amount(r) {
		var qty = flt(r.qty);
		var rate = flt(r.rate);
		var disc = flt(r.discount_percentage);
		var amt = qty * rate;
		if (disc) amt = amt * (1 - disc / 100);
		return amt;
	}

	function apply_defaults_to_row(r, d, opts) {
		opts = opts || {};
		if (!d) return r;
		if (d.hec_batch_no) r.hec_batch_no = d.hec_batch_no;
		if (d.item_code) r.item_code = d.item_code;
		if (d.item_name) r.item_name = d.item_name;
		if (d.stock_uom) r.stock_uom = d.stock_uom;
		if (d.hec_pack_size !== undefined && d.hec_pack_size !== null) r.hec_pack_size = d.hec_pack_size;
		if (d.hec_expiry_date) r.hec_expiry_date = d.hec_expiry_date;
		if (flt(d.hec_item_mrp)) r.hec_item_mrp = flt(d.hec_item_mrp);
		if (flt(d.selling_rate)) r.selling_rate = flt(d.selling_rate);
		if (flt(d.last_purchase_rate)) r.last_purchase_rate = flt(d.last_purchase_rate);
		if (flt(d.hec_gst_rate)) r.hec_gst_rate = flt(d.hec_gst_rate);
		if (d.stock !== undefined) r.stock = flt(d.stock);
		var prefer_purchase = opts.direction !== "sales";
		if (!flt(r.rate) || opts.force_rate) {
			if (prefer_purchase) {
				r.rate = flt(d.last_purchase_rate) || flt(d.rate) || flt(d.hec_item_mrp) || flt(r.rate);
			} else {
				r.rate = flt(d.hec_item_mrp) || flt(d.selling_rate) || flt(d.rate) || flt(r.rate);
			}
		}
		return r;
	}

	function call_ensure_line(r) {
		return new Promise(function (resolve, reject) {
			var batch = (r.hec_batch_no || "").trim();
			var typed = (r.item_code || "").trim();
			if (!batch || !typed) {
				reject("batch_and_item_required");
				return;
			}
			if (!r.item_name) r.item_name = typed;
			frappe.call({
				method:
					"health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item_batch",
				args: {
					data: {
						item_code: typed,
						item_name: r.item_name || typed,
						hec_batch_no: batch,
						hec_expiry_date: r.hec_expiry_date,
						hec_item_mrp: flt(r.hec_item_mrp) || flt(r.selling_rate),
						rate: flt(r.rate),
						stock_uom: r.stock_uom || "Nos",
						hec_pack_size: r.hec_pack_size,
						hec_gst_rate: r.hec_gst_rate,
					},
				},
				callback: function (res) {
					var msg = (res && res.message) || {};
					var d = msg.defaults || {};
					if (msg.hec_batch_no) r.hec_batch_no = msg.hec_batch_no;
					if (msg.item_code) r.item_code = msg.item_code;
					apply_defaults_to_row(r, d, { force_rate: !flt(r.rate) });
					resolve(r);
				},
				error: function (err) {
					reject(err);
				},
			});
		});
	}

	function compute_totals(rows) {
		var goods = 0;
		var discount = 0;
		var gst = 0;
		(rows || []).forEach(function (r) {
			if (!r.item_code || !flt(r.qty)) return;
			var gross = flt(r.qty) * flt(r.rate);
			var disc_amt = gross * (flt(r.discount_percentage) / 100);
			var net = gross - disc_amt;
			goods += net;
			discount += disc_amt;
			gst += net * (flt(r.hec_gst_rate) / 100);
		});
		return {
			goods: goods,
			discount: discount,
			gst: gst,
			bill: goods + gst,
		};
	}

	function ensure_panel(frm) {
		if (!frm || !frm.$wrapper) return;
		if (frm._hec_marg_bound) {
			render_panel(frm);
			return;
		}
		frm._hec_marg_bound = true;
		frm._hec_marg_rows = [blank_row()];
		frm._hec_marg_focus = 0;
		frm._hec_party_history = null;

		try {
			frm.add_custom_button(__("Apply Marg Grid → Items"), function () {
				apply_rows_to_form(frm);
			}, __("HEC"));
			frm.add_custom_button(__("Print Landscape PDF"), function () {
				print_hec_pdf(frm);
			}, __("HEC"));
		} catch (e) {
			console.error(e);
		}
		render_panel(frm);
	}

	function print_hec_pdf(frm) {
		if (!frm.doc || !frm.doc.name || frm.is_new()) {
			frappe.msgprint(__("Save the invoice first"));
			return;
		}
		var fmt =
			frm.doctype === "Sales Invoice"
				? "HEC Landscape GST Bill"
				: "HEC Landscape GST Bill Purchase";
		var url =
			"/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_download_hec_pdf" +
			"?doctype=" +
			encodeURIComponent(frm.doctype) +
			"&name=" +
			encodeURIComponent(frm.doc.name) +
			"&print_format=" +
			encodeURIComponent(fmt) +
			"&no_letterhead=1";
		window.open(url, "_blank");
	}

	function load_party_history(frm, party) {
		if (!party) {
			frm._hec_party_history = null;
			render_panel(frm);
			return;
		}
		frappe.call({
			method:
				"health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_get_hec_party_history",
			args: { party: party, direction: direction_for(frm.doctype) },
			callback: function (r) {
				frm._hec_party_history = r.message || null;
				render_panel(frm);
			},
		});
	}

	function open_item_popup(frm, idx) {
		var d = new frappe.ui.Dialog({
			title: __("ITEMS"),
			fields: [
				{ fieldname: "txt", fieldtype: "Data", label: __("Search"), reqd: 0 },
				{ fieldname: "html", fieldtype: "HTML" },
			],
			primary_action_label: __("Close"),
			primary_action: function () {
				d.hide();
			},
		});
		d.show();
		var $box = d.fields_dict.html.$wrapper;
		function run(txt) {
			$box.html(`<div class="text-muted">${__("Loading…")}</div>`);
			frappe.call({
				method:
					"health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_search_hec_items",
				args: { txt: txt || "", limit: 30 },
				callback: function (r) {
					var rows = r.message || [];
					if (!rows.length) {
						$box.html(`<div class="text-muted">${__("No items")}</div>`);
						return;
					}
					var html =
						'<table class="table table-bordered table-sm" style="font-size:12px"><thead><tr>' +
						`<th>${__("Description")}</th><th>${__("Pack")}</th><th>${__("Stock")}</th><th>${__("MRP")}</th><th>${__("P.Rate")}</th>` +
						"</tr></thead><tbody>";
					rows.forEach(function (it, i) {
						html +=
							`<tr class="hec-pick-item" data-i="${i}" style="cursor:pointer">` +
							`<td>${frappe.utils.escape_html(it.item_name || it.item_code)}</td>` +
							`<td>${frappe.utils.escape_html(it.hec_pack_size || "")}</td>` +
							`<td class="text-right">${flt(it.stock).toFixed(2)}</td>` +
							`<td class="text-right">${flt(it.hec_item_mrp).toFixed(2)}</td>` +
							`<td class="text-right">${flt(it.last_purchase_rate).toFixed(2)}</td>` +
							"</tr>";
					});
					html += "</tbody></table>";
					$box.html(html);
					$box.find(".hec-pick-item").on("click", function () {
						var it = rows[cint($(this).data("i"))];
						d.hide();
						on_item_picked(frm, idx, it);
					});
				},
			});
		}
		d.fields_dict.txt.$input.on("input", frappe.utils.debounce(function () {
			run(d.get_value("txt"));
		}, 250));
		run("");
	}

	function on_item_picked(frm, idx, it) {
		var row = frm._hec_marg_rows[idx] || blank_row();
		apply_defaults_to_row(row, it, { direction: direction_for(frm.doctype), force_rate: true });
		frm._hec_marg_rows[idx] = row;
		frm._hec_marg_focus = idx;
		open_batch_popup(frm, idx);
	}

	function open_batch_popup(frm, idx) {
		var row = frm._hec_marg_rows[idx] || blank_row();
		if (!(row.item_code || "").trim()) {
			frappe.msgprint(__("Select Item first"));
			return;
		}
		var d = new frappe.ui.Dialog({
			title: __("AVAILABLE STOCKS") + " — " + (row.item_name || row.item_code),
			fields: [
				{ fieldname: "batches_html", fieldtype: "HTML" },
				{ fieldtype: "Section Break", label: __("Or define new batch") },
				{ fieldname: "hec_batch_no", fieldtype: "Data", label: __("Batch") },
				{ fieldname: "hec_expiry_date", fieldtype: "Date", label: __("Expiry") },
				{ fieldname: "hec_item_mrp", fieldtype: "Currency", label: __("M.R.P. / SRate") },
				{ fieldname: "rate", fieldtype: "Currency", label: __("P.Rate") },
			],
			primary_action_label: __("Use New Batch"),
			primary_action: function (values) {
				if (!(values.hec_batch_no || "").trim()) {
					frappe.msgprint(__("Batch No is required"));
					return;
				}
				row.hec_batch_no = values.hec_batch_no;
				row.hec_expiry_date = values.hec_expiry_date || "";
				row.hec_item_mrp = flt(values.hec_item_mrp);
				row.selling_rate = flt(values.hec_item_mrp);
				if (flt(values.rate)) row.rate = flt(values.rate);
				else if (!flt(row.rate)) row.rate = flt(row.last_purchase_rate) || flt(row.hec_item_mrp);
				frm._hec_marg_rows[idx] = row;
				d.hide();
				call_ensure_line(row)
					.then(function () {
						render_panel(frm);
					})
					.catch(function () {
						frappe.msgprint(__("Could not create Batch/Item"));
						render_panel(frm);
					});
			},
		});
		d.show();
		var $box = d.fields_dict.batches_html.$wrapper;
		$box.html(`<div class="text-muted">${__("Loading batches…")}</div>`);
		frappe.call({
			method:
				"health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_list_item_batches",
			args: { item_code: row.item_code, limit: 40 },
			callback: function (r) {
				var rows = r.message || [];
				if (!rows.length) {
					$box.html(
						`<div class="text-muted" style="margin-bottom:8px">${__("No existing batches — enter a new batch below.")}</div>`
					);
					return;
				}
				var html =
					'<table class="table table-bordered table-sm" style="font-size:12px"><thead><tr>' +
					`<th>${__("Batch")}</th><th>${__("Exp")}</th><th>${__("Stock")}</th><th>${__("MRP")}</th><th>${__("P.Rate")}</th>` +
					"</tr></thead><tbody>";
				rows.forEach(function (b, i) {
					html +=
						`<tr class="hec-pick-batch" data-i="${i}" style="cursor:pointer">` +
						`<td>${frappe.utils.escape_html(b.hec_batch_no)}</td>` +
						`<td>${frappe.utils.escape_html(b.hec_expiry_date || "")}</td>` +
						`<td class="text-right">${flt(b.stock).toFixed(2)}</td>` +
						`<td class="text-right">${flt(b.hec_item_mrp).toFixed(2)}</td>` +
						`<td class="text-right">${flt(b.last_purchase_rate).toFixed(2)}</td>` +
						"</tr>";
				});
				html += "</tbody></table>";
				$box.html(html);
				$box.find(".hec-pick-batch").on("click", function () {
					var b = rows[cint($(this).data("i"))];
					apply_defaults_to_row(row, b, {
						direction: direction_for(frm.doctype),
						force_rate: true,
					});
					frm._hec_marg_rows[idx] = row;
					d.hide();
					render_panel(frm);
				});
			},
		});
	}

	function party_strip_html(frm) {
		var h = frm._hec_party_history;
		if (!h || !h.ok) {
			return `<div class="text-muted" style="font-size:11px;padding:6px 0">${__("Select supplier to load party history")}</div>`;
		}
		var addr = h.address || {};
		var addr_line = [addr.line1, addr.city, addr.state].filter(Boolean).join(", ");
		var bills = (h.bills || [])
			.slice(0, 5)
			.map(function (b) {
				return `<tr><td>${frappe.utils.escape_html(b.bill)}</td><td>${b.date}</td><td class="text-right">${flt(b.amount).toFixed(2)}</td><td class="text-right">${b.days}</td></tr>`;
			})
			.join("");
		return `
			<div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0;font-size:11px">
				<div style="flex:1;min-width:220px;border:1px solid #d1d8dd;padding:6px;border-radius:4px;background:#fafbfc">
					<strong>${__("PARTY HISTORY")}</strong><br>
					${frappe.utils.escape_html(h.party_name || h.party)}<br>
					${frappe.utils.escape_html(addr_line)}<br>
					GSTIN: ${frappe.utils.escape_html(h.gstin || "—")}
					${h.dl_no ? " | DL: " + frappe.utils.escape_html(h.dl_no) : ""}<br>
					${__("Balance")}: <b>${flt(h.balance).toFixed(2)}</b> |
					${__("Bills")}: ${cint(h.bill_count)}
				</div>
				<div style="flex:1;min-width:240px;border:1px solid #d1d8dd;padding:6px;border-radius:4px;background:#fafbfc;max-height:120px;overflow:auto">
					<strong>${__("Recent Bills")}</strong>
					<table class="table table-condensed" style="margin:4px 0 0;font-size:11px">
						<thead><tr><th>${__("Bill")}</th><th>${__("Date")}</th><th>${__("Amt")}</th><th>${__("Days")}</th></tr></thead>
						<tbody>${bills || `<tr><td colspan="4" class="text-muted">${__("None")}</td></tr>`}</tbody>
					</table>
				</div>
			</div>`;
	}

	function detail_bar_html(frm) {
		var idx = cint(frm._hec_marg_focus) || 0;
		var r = (frm._hec_marg_rows || [])[idx] || blank_row();
		return `
			<div class="hec-marg-detail" style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;padding:8px;border:1px solid #d1d8dd;background:#f5f7fa;margin-top:6px;border-radius:4px">
				<div><span class="text-muted">${__("Item")}</span><br><b>${frappe.utils.escape_html(r.item_name || r.item_code || "—")}</b></div>
				<div><span class="text-muted">${__("Batch")}</span><br><b>${frappe.utils.escape_html(r.hec_batch_no || "—")}</b></div>
				<div><span class="text-muted">${__("Expiry")}</span><br><b>${frappe.utils.escape_html(r.hec_expiry_date || "—")}</b></div>
				<div><span class="text-muted">${__("M.R.P.")}</span><br><b>${flt(r.hec_item_mrp).toFixed(2)}</b></div>
				<div><span class="text-muted">${__("SRate")}</span><br><b>${flt(r.selling_rate || r.hec_item_mrp).toFixed(2)}</b></div>
				<div><span class="text-muted">${__("Stock")}</span><br><b>${flt(r.stock).toFixed(2)}</b></div>
				<div><span class="text-muted">${__("P.Rate")}</span><br><b>${flt(r.rate).toFixed(2)}</b></div>
				<div><span class="text-muted">${__("GST%")}</span><br><b>${flt(r.hec_gst_rate).toFixed(2)}</b></div>
			</div>`;
	}

	function totals_html(frm) {
		var t = compute_totals(frm._hec_marg_rows || []);
		return `
			<div style="display:flex;justify-content:flex-end;gap:18px;flex-wrap:wrap;font-size:12px;margin-top:8px;padding:8px;border:1px solid #d1d8dd;border-radius:4px;background:#fff">
				<div>${__("VALUE OF GOODS")}<br><b>${format_currency(t.goods)}</b></div>
				<div>${__("DISCOUNT")}<br><b>${format_currency(t.discount)}</b></div>
				<div>${__("GST")}<br><b>${format_currency(t.gst)}</b></div>
				<div>${__("BILL TOTAL")}<br><b style="font-size:14px">${format_currency(t.bill)}</b></div>
			</div>`;
	}

	function render_panel(frm) {
		if (!frm || !frm.$wrapper || !frm.$wrapper.length) return;
		var is_purchase = frm.doctype === "Purchase Invoice";
		var $wrap = frm.$wrapper.find(".hec-marg-panel");
		if (!$wrap.length) {
			$wrap = $(
				'<div class="hec-marg-panel" style="margin:12px 0;border:1px solid var(--border-color,#d1d8dd);border-radius:8px;padding:12px;background:var(--card-bg,#fff);"></div>'
			);
			var $anchor = frm.$wrapper.find(".form-layout").first();
			if ($anchor.length) $anchor.prepend($wrap);
			else frm.$wrapper.prepend($wrap);
		}

		var dir = direction_for(frm.doctype);
		var party_val =
			(dir === "purchase" ? frm.doc.supplier : frm.doc.customer) || frm._hec_marg_party || "";
		var bill_date = frm.doc.bill_date || frm.doc.posting_date || frappe.datetime.get_today();
		var bill_no = frm.doc.bill_no || frm._hec_marg_bill_no || "";
		var inv_disc = flt(frm.doc.additional_discount_percentage) || 0;

		var rows_html = (frm._hec_marg_rows || [])
			.map(function (r, i) {
				var focus = cint(frm._hec_marg_focus) === i ? "background:#fff8e6" : "";
				return `
				<tr data-idx="${i}" style="${focus}">
					<td style="min-width:150px">
						<input data-f="item_code" value="${frappe.utils.escape_html(r.item_code || "")}" placeholder="${__("Item")}">
						<button type="button" class="btn btn-xs btn-default hec-marg-pick-item" title="${__("Items")}">…</button>
					</td>
					<td><input data-f="hec_pack_size" value="${frappe.utils.escape_html(r.hec_pack_size || "")}"></td>
					<td style="min-width:100px">
						<input data-f="hec_batch_no" value="${frappe.utils.escape_html(r.hec_batch_no || "")}" placeholder="${__("Batch")}">
						<button type="button" class="btn btn-xs btn-default hec-marg-pick-batch" title="${__("Batches")}">…</button>
					</td>
					<td><input type="number" step="0.001" data-f="qty" value="${r.qty || 0}"></td>
					<td><input type="number" step="0.001" data-f="hec_free_qty" value="${r.hec_free_qty || 0}"></td>
					<td><input type="number" step="0.01" data-f="rate" value="${r.rate || 0}" title="${__("P.Rate")}"></td>
					<td><input type="number" step="0.01" data-f="discount_percentage" value="${r.discount_percentage || 0}"></td>
					<td class="text-right hec-marg-amt">${format_currency(line_amount(r))}</td>
					<td style="display:none"><input type="date" data-f="hec_expiry_date" value="${r.hec_expiry_date || ""}"></td>
					<td style="display:none"><input type="number" step="0.01" data-f="hec_item_mrp" value="${r.hec_item_mrp || 0}"></td>
					<td style="display:none"><input type="number" step="0.01" data-f="hec_gst_rate" value="${r.hec_gst_rate || 0}"></td>
					<td><button type="button" class="btn btn-xs hec-marg-del">×</button></td>
				</tr>`;
			})
			.join("");

		var html = `
			<style>
				.hec-marg-panel table.hec-marg-grid { width:100%; border-collapse:collapse; font-size:12px; }
				.hec-marg-panel table.hec-marg-grid th, .hec-marg-panel table.hec-marg-grid td { border:1px solid #d1d8dd; padding:3px 4px; }
				.hec-marg-panel table.hec-marg-grid th { background:#f5f7fa; text-align:center; white-space:nowrap; }
				.hec-marg-panel table.hec-marg-grid input { width:calc(100% - 22px); border:1px solid #d1d8dd; border-radius:3px; padding:2px 4px; display:inline-block; }
				.hec-marg-panel .hec-marg-head { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:6px; align-items:end; }
				.hec-marg-panel .hec-marg-head label { display:block; font-size:11px; color:#666; }
			</style>
			<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
				<strong>${__("PURCHASE ENTRY")} — HEC Marg</strong>
				<span class="text-muted" style="font-size:11px">${__("Item → Batch → Qty / P.Rate / DIS")}</span>
			</div>
			<div class="hec-marg-head">
				<div style="min-width:240px">
					<label>${is_purchase ? __("Supplier") : __("Customer")}</label>
					<input type="text" class="hec-marg-party" value="${frappe.utils.escape_html(party_val)}" placeholder="${__("Type name / code")}">
				</div>
				<div>
					<label>${__("Bill Date")}</label>
					<input type="date" class="hec-marg-bill-date" value="${bill_date || ""}">
				</div>
				<div>
					<label>${__("Party Bill No")}</label>
					<input type="text" class="hec-marg-bill-no" value="${frappe.utils.escape_html(bill_no)}">
				</div>
				<div>
					<label>${__("Invoice Disc %")}</label>
					<input type="number" step="0.01" class="hec-marg-inv-disc" value="${inv_disc}">
				</div>
				<button type="button" class="btn btn-xs btn-default hec-marg-add">${__("Add Line")}</button>
				<button type="button" class="btn btn-xs btn-primary hec-marg-apply">${__("Apply to Items")}</button>
				<button type="button" class="btn btn-xs btn-success hec-marg-save">${__("Save Bill")}</button>
			</div>
			${is_purchase ? party_strip_html(frm) : ""}
			<div style="overflow-x:auto">
			<table class="hec-marg-grid">
				<thead>
					<tr>
						<th>${__("PRODUCT")}</th><th>${__("PACK")}</th><th>${__("BATCH")}</th>
						<th>${__("QTY")}</th><th>${__("FREE")}</th><th>${__("P.RATE")}</th><th>${__("DIS%")}</th><th>${__("AMOUNT")}</th><th></th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
			</div>
			${detail_bar_html(frm)}
			${totals_html(frm)}
			<div class="hec-marg-status text-muted" style="margin-top:6px;font-size:12px">
				${__("Press … on Product for item list, then pick Batch from Available Stocks. Save confirms and creates the Purchase Invoice.")}
			</div>
		`;
		$wrap.html(html);
		bind_panel(frm, $wrap);
	}

	function collect(frm, $wrap) {
		frm._hec_marg_party = $wrap.find(".hec-marg-party").val();
		frm._hec_marg_bill_no = $wrap.find(".hec-marg-bill-no").val();
		frm._hec_marg_bill_date = $wrap.find(".hec-marg-bill-date").val();
		$wrap.find("tbody tr").each(function () {
			var idx = cint($(this).data("idx"));
			if (!frm._hec_marg_rows[idx]) frm._hec_marg_rows[idx] = blank_row();
			$(this)
				.find("input[data-f]")
				.each(function () {
					var f = $(this).data("f");
					var val = $(this).val();
					if (
						["qty", "hec_free_qty", "hec_item_mrp", "rate", "discount_percentage", "hec_gst_rate"].indexOf(
							f
						) >= 0
					) {
						val = flt(val);
					}
					frm._hec_marg_rows[idx][f] = val;
				});
		});
	}

	function bind_panel(frm, $wrap) {
		$wrap.find(".hec-marg-add").on("click", function () {
			collect(frm, $wrap);
			frm._hec_marg_rows.push(blank_row());
			frm._hec_marg_focus = frm._hec_marg_rows.length - 1;
			render_panel(frm);
		});
		$wrap.find(".hec-marg-del").on("click", function () {
			collect(frm, $wrap);
			var idx = cint($(this).closest("tr").data("idx"));
			frm._hec_marg_rows.splice(idx, 1);
			if (!frm._hec_marg_rows.length) frm._hec_marg_rows.push(blank_row());
			frm._hec_marg_focus = 0;
			render_panel(frm);
		});
		$wrap.find("tbody tr").on("click", function () {
			frm._hec_marg_focus = cint($(this).data("idx"));
			$wrap.find(".hec-marg-detail").replaceWith($(detail_bar_html(frm)));
		});
		$wrap.find(".hec-marg-pick-item").on("click", function () {
			collect(frm, $wrap);
			var idx = cint($(this).closest("tr").data("idx"));
			frm._hec_marg_focus = idx;
			open_item_popup(frm, idx);
		});
		$wrap.find(".hec-marg-pick-batch").on("click", function () {
			collect(frm, $wrap);
			var idx = cint($(this).closest("tr").data("idx"));
			frm._hec_marg_focus = idx;
			open_batch_popup(frm, idx);
		});
		$wrap.find("tbody input[data-f=item_code]").on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				collect(frm, $wrap);
				var idx = cint($(this).closest("tr").data("idx"));
				open_item_popup(frm, idx);
			}
		});
		$wrap.find(".hec-marg-party").on("change", function () {
			var party = ($(this).val() || "").trim();
			frm._hec_marg_party = party;
			if (frm.doctype === "Purchase Invoice" && party) {
				frm.set_value("supplier", party);
			} else if (frm.doctype === "Sales Invoice" && party) {
				frm.set_value("customer", party);
			}
			load_party_history(frm, party);
		});
		$wrap.find("tbody input").on("change", function () {
			collect(frm, $wrap);
			render_panel(frm);
		});
		$wrap.find(".hec-marg-apply").on("click", function () {
			collect(frm, $wrap);
			apply_rows_to_form(frm);
		});
		$wrap.find(".hec-marg-save").on("click", function () {
			collect(frm, $wrap);
			confirm_save_bill(frm, $wrap);
		});
	}

	function set_child_values(row, values) {
		return frappe.model.set_value(row.doctype, row.name, values);
	}

	function add_invoice_line(frm, r, is_free) {
		var row = frm.add_child("items");
		var code = r.item_code;
		var name = r.item_name || code;
		var uom = r.stock_uom || "Nos";
		var qty = is_free ? flt(r.hec_free_qty) : flt(r.qty);
		var rate = flt(r.rate);
		var gst = flt(r.hec_gst_rate);

		return frappe.model
			.set_value(row.doctype, row.name, "item_code", code)
			.then(function () {
				var updates = {
					qty: qty,
					rate: rate,
					price_list_rate: rate,
					discount_percentage: is_free ? 100 : flt(r.discount_percentage),
				};
				if (is_free) updates.is_free_item = 1;
				if (!(row.item_name || "").trim()) updates.item_name = name;
				if (!(row.uom || "").trim()) updates.uom = uom;
				if (row.hec_free_qty !== undefined && !is_free) updates.hec_free_qty = flt(r.hec_free_qty);
				if (row.hec_pack_size !== undefined) updates.hec_pack_size = r.hec_pack_size;
				if (row.hec_batch_no !== undefined) updates.hec_batch_no = r.hec_batch_no;
				if (row.batch_no !== undefined) updates.batch_no = r.hec_batch_no;
				if (row.hec_expiry_date !== undefined) updates.hec_expiry_date = r.hec_expiry_date;
				if (row.hec_item_mrp !== undefined) updates.hec_item_mrp = flt(r.hec_item_mrp);
				if (row.hec_sgst_rate !== undefined) updates.hec_sgst_rate = gst / 2;
				if (row.hec_cgst_rate !== undefined) updates.hec_cgst_rate = gst / 2;
				return set_child_values(row, updates);
			})
			.then(function () {
				if (!(row.item_name || "").trim()) row.item_name = name;
				if (!(row.uom || "").trim()) row.uom = uom;
				if (row.hec_batch_no !== undefined) row.hec_batch_no = r.hec_batch_no;
				if (row.batch_no !== undefined) row.batch_no = r.hec_batch_no;
			});
	}

	function apply_rows_to_form(frm) {
		var rows = (frm._hec_marg_rows || []).filter(function (r) {
			return r.item_code && r.hec_batch_no && flt(r.qty) > 0;
		});
		if (!rows.length) {
			frappe.msgprint(__("Add at least one line with Item, Batch and Qty"));
			return;
		}
		var $wrap = frm.$wrapper.find(".hec-marg-panel");
		var party = $wrap.find(".hec-marg-party").val();
		var bill_date = $wrap.find(".hec-marg-bill-date").val();
		var bill_no = $wrap.find(".hec-marg-bill-no").val();
		var inv_disc = flt($wrap.find(".hec-marg-inv-disc").val());
		var dir = direction_for(frm.doctype);

		if (dir === "purchase") {
			if (party) frm.set_value("supplier", party);
			if (bill_no) frm.set_value("bill_no", bill_no);
			if (bill_date) {
				frm.set_value("bill_date", bill_date);
				frm.set_value("posting_date", bill_date);
			}
		} else if (party) {
			frm.set_value("customer", party);
		}
		if (inv_disc) {
			frm.set_value("apply_discount_on", "Net Total");
			frm.set_value("additional_discount_percentage", inv_disc);
		}

		$wrap.find(".hec-marg-status").text(__("Applying…"));
		frm.clear_table("items");
		frm.refresh_field("items");

		var chain = Promise.resolve();
		rows.forEach(function (r) {
			chain = chain.then(function () {
				return call_ensure_line(r).then(function () {
					return add_invoice_line(frm, r, false).then(function () {
						if (flt(r.hec_free_qty) > 0) return add_invoice_line(frm, r, true);
					});
				});
			});
		});
		chain
			.then(function () {
				frm.refresh_field("items");
				frappe.show_alert({ message: __("Marg grid applied"), indicator: "green" });
				$wrap
					.find(".hec-marg-status")
					.html(`<span class="text-success">${__("Applied — click Save on the form")}</span>`);
			})
			.catch(function (err) {
				console.error(err);
				frappe.msgprint(__("Could not apply Marg grid"));
			});
	}

	function confirm_save_bill(frm, $wrap) {
		var rows = (frm._hec_marg_rows || []).filter(function (r) {
			return r.item_code && r.hec_batch_no && flt(r.qty) > 0;
		});
		if (!rows.length) {
			frappe.msgprint(__("Add at least one line with Item, Batch and Qty"));
			return;
		}
		var party = ($wrap.find(".hec-marg-party").val() || "").trim();
		if (!party && frm.doctype === "Purchase Invoice") {
			frappe.msgprint(__("Supplier is required"));
			return;
		}
		frappe.confirm(__("Save Changes? Create Purchase Bill now?"), function () {
			save_via_api(frm, $wrap, rows, party);
		});
	}

	function save_via_api(frm, $wrap, rows, party) {
		var dir = direction_for(frm.doctype);
		var items = rows.map(function (r) {
			return {
				item_code: r.item_code,
				item_name: r.item_name,
				qty: r.qty,
				free_qty: r.hec_free_qty,
				lot_scheme: r.lot_scheme,
				rate: r.rate,
				discount_percentage: r.discount_percentage,
				hec_pack_size: r.hec_pack_size,
				hec_batch_no: r.hec_batch_no,
				hec_expiry_date: r.hec_expiry_date,
				hec_item_mrp: r.hec_item_mrp,
				hec_gst_rate: r.hec_gst_rate,
			};
		});
		$wrap.find(".hec-marg-status").text(__("Saving…"));
		frappe.call({
			method: "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice",
			args: {
				data: {
					direction: dir,
					party: party,
					submit: 0,
					update_stock: 1,
					bill_no: $wrap.find(".hec-marg-bill-no").val(),
					bill_date: $wrap.find(".hec-marg-bill-date").val(),
					posting_date: $wrap.find(".hec-marg-bill-date").val(),
					items: items,
					invoice_discount: flt($wrap.find(".hec-marg-inv-disc").val())
						? {
								apply_discount_on: "Net Total",
								additional_discount_percentage: flt($wrap.find(".hec-marg-inv-disc").val()),
						  }
						: {},
				},
			},
			freeze: true,
			freeze_message: __("Creating Purchase Bill…"),
			callback: function (r) {
				var msg = r.message || {};
				if (!msg.ok) {
					$wrap.find(".hec-marg-status").html(`<span class="text-danger">${__("Failed")}</span>`);
					frappe.msgprint(msg.message || __("Save failed"));
					return;
				}
				frappe.show_alert({ message: __("Created {0}", [msg.invoice]), indicator: "green" });
				frappe.set_route("Form", msg.doctype, msg.invoice);
			},
		});
	}

	function on_refresh(frm) {
		safe(function () {
			ensure_panel(frm);
			var party = frm.doctype === "Purchase Invoice" ? frm.doc.supplier : frm.doc.customer;
			if (party && !frm._hec_party_history) load_party_history(frm, party);
		});
	}

	frappe.ui.form.on("Purchase Invoice", {
		refresh: function (frm) {
			setTimeout(function () {
				on_refresh(frm);
			}, 50);
		},
		onload: function (frm) {
			setTimeout(function () {
				safe(function () {
					ensure_panel(frm);
				});
			}, 50);
		},
		supplier: function (frm) {
			if (frm.doc.supplier) load_party_history(frm, frm.doc.supplier);
		},
	});

	frappe.ui.form.on("Sales Invoice", {
		refresh: function (frm) {
			setTimeout(function () {
				on_refresh(frm);
			}, 50);
		},
		onload: function (frm) {
			setTimeout(function () {
				safe(function () {
					ensure_panel(frm);
				});
			}, 50);
		},
	});
})();
