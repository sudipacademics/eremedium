/**
 * RemeLab-style single-window Lab Bill Entry on Customer TRF.
 * Test Details + Adjustments + Staff + Receipt + live totals.
 */
(function () {
	var API =
		"health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry.";

	function safe(fn) {
		try {
			return fn();
		} catch (e) {
			console.error("HEC Lab Bill Entry:", e);
			return null;
		}
	}

	function blank_test() {
		return {
			item: "",
			item_name: "",
			qty: 1,
			rate: 0,
			amount: 0,
			hec_disc_percent: 0,
			hec_disc_amount: 0,
			hec_r_amount: 0,
			hec_remark: "",
		};
	}

	function blank_adj() {
		return { adjustment: "", percentage: 0, amount: 0, remark: "", conf_by: "" };
	}

	function blank_staff() {
		return { staff_name: "", amount: 0 };
	}

	function recalc_line(r) {
		var qty = flt(r.qty) || 1;
		var rate = flt(r.rate) || 0;
		var gross = qty * rate;
		var disc_pct = flt(r.hec_disc_percent) || 0;
		var disc_amt = flt(r.hec_disc_amount) || 0;
		var source = r._disc_source || "pct";
		// RemeLab: Disc% drives DiscAmt unless user last edited DiscAmt
		if (source === "amt" && disc_amt > 0 && gross > 0) {
			disc_pct = (disc_amt * 100) / gross;
		} else if (disc_pct > 0) {
			disc_amt = (gross * disc_pct) / 100;
			source = "pct";
		} else if (disc_amt > 0 && gross > 0) {
			disc_pct = (disc_amt * 100) / gross;
			source = "amt";
		} else {
			disc_pct = 0;
			disc_amt = 0;
		}
		r.qty = qty;
		r.rate = rate;
		r.amount = gross;
		r.hec_disc_percent = Math.round(disc_pct * 1000) / 1000;
		r.hec_disc_amount = Math.round(disc_amt * 100) / 100;
		r.hec_r_amount = Math.round(Math.max(gross - disc_amt, 0) * 100) / 100;
		r._disc_source = source;
		return r;
	}

	function state(frm) {
		if (!frm._hec_bill) {
			frm._hec_bill = {
				tests: [blank_test()],
				adjustments: [blank_adj()],
				staff: [blank_staff()],
				search_txt: "",
			};
		}
		return frm._hec_bill;
	}

	function money(n) {
		return format_currency(flt(n) || 0);
	}

	function compute_local(frm) {
		var s = state(frm);
		var $w = frm.$wrapper.find(".hec-bill-entry");
		var test_amount = 0;
		(s.tests || []).forEach(function (r) {
			recalc_line(r);
			test_amount += flt(r.hec_r_amount);
		});
		var coll = flt($w.find(".hec-coll-charge").val());
		var addition = 0;
		var deduction = 0;
		(s.adjustments || []).forEach(function (a) {
			var amt = flt(a.amount);
			var pct = flt(a.percentage);
			if (!amt && pct) amt = (test_amount * pct) / 100;
			a.amount = amt;
			var name = (a.adjustment || "").toLowerCase();
			if (/disc|deduct|less|concession/.test(name) || amt < 0) deduction += Math.abs(amt);
			else addition += Math.abs(amt);
		});
		var net = test_amount + coll + addition - deduction;
		var paid = flt($w.find(".hec-amount-paid").val());
		var recv = flt($w.find(".hec-received").val()) || paid;
		var refund = flt($w.find(".hec-refund").val());
		var written = flt($w.find(".hec-written-off").val());
		var due = Math.max(net - recv - written + refund, 0);
		var bal = paid > net ? paid - net : 0;
		return {
			no_of_test: (s.tests || []).filter(function (r) {
				return (r.item || "").trim();
			}).length,
			hec_test_amount: test_amount,
			hec_coll_charge: coll,
			hec_addition: addition,
			hec_deduction: deduction,
			hec_net_amount: net,
			hec_received: recv,
			hec_refund: refund,
			hec_written_off: written,
			hec_due_amount: due,
			hec_amount_paid: paid,
			hec_balance_return: bal,
		};
	}

	function paint_totals(frm) {
		var t = compute_local(frm);
		var $w = frm.$wrapper.find(".hec-bill-entry");
		$w.find(".hec-tot-tests").text(t.no_of_test);
		$w.find(".hec-tot-test-amt").text(money(t.hec_test_amount));
		$w.find(".hec-tot-coll").text(money(t.hec_coll_charge));
		$w.find(".hec-tot-add").text(money(t.hec_addition));
		$w.find(".hec-tot-ded").text(money(t.hec_deduction));
		$w.find(".hec-tot-net").text(money(t.hec_net_amount));
		$w.find(".hec-tot-recv").text(money(t.hec_received));
		$w.find(".hec-tot-refund").text(money(t.hec_refund));
		$w.find(".hec-tot-wo").text(money(t.hec_written_off));
		$w.find(".hec-tot-due").text(money(t.hec_due_amount));
		$w.find(".hec-tot-bal").text(money(t.hec_balance_return));
		return t;
	}

	function sync_from_dom(frm) {
		var s = state(frm);
		var $w = frm.$wrapper.find(".hec-bill-entry");
		$w.find("tr.hec-test-row").each(function (i) {
			var $tr = $(this);
			if (!s.tests[i]) s.tests[i] = blank_test();
			var r = s.tests[i];
			r.item = $tr.find(".hec-t-code").val() || "";
			r.item_name = $tr.find(".hec-t-name").val() || "";
			r.rate = flt($tr.find(".hec-t-rate").val());
			r.qty = flt($tr.find(".hec-t-qty").val()) || 1;
			r.hec_disc_percent = flt($tr.find(".hec-t-disc").val());
			r.hec_disc_amount = flt($tr.find(".hec-t-discamt").val());
			r.hec_remark = $tr.find(".hec-t-remark").val() || "";
			if (!r._disc_source) r._disc_source = "pct";
			recalc_line(r);
			$tr.find(".hec-t-amt").val(flt(r.amount).toFixed(2));
			$tr.find(".hec-t-disc").val(flt(r.hec_disc_percent));
			$tr.find(".hec-t-discamt").val(flt(r.hec_disc_amount).toFixed(2));
			$tr.find(".hec-t-ramt").val(flt(r.hec_r_amount).toFixed(2));
		});
		$w.find("tr.hec-adj-row").each(function (i) {
			var $tr = $(this);
			if (!s.adjustments[i]) s.adjustments[i] = blank_adj();
			var a = s.adjustments[i];
			a.adjustment = $tr.find(".hec-a-name").val() || "";
			a.percentage = flt($tr.find(".hec-a-pct").val());
			a.amount = flt($tr.find(".hec-a-amt").val());
			a.remark = $tr.find(".hec-a-remark").val() || "";
			a.conf_by = $tr.find(".hec-a-conf").val() || "";
		});
		$w.find("tr.hec-staff-row").each(function (i) {
			var $tr = $(this);
			if (!s.staff[i]) s.staff[i] = blank_staff();
			var st = s.staff[i];
			st.staff_name = $tr.find(".hec-s-name").val() || "";
			st.amount = flt($tr.find(".hec-s-amt").val());
		});
	}

	function load_from_doc(frm) {
		var s = state(frm);
		var d = frm.doc || {};
		s.tests = (d.tests || [])
			.filter(function (r) {
				return r.item;
			})
			.map(function (r) {
				return recalc_line({
					item: r.item,
					item_name: r.item_name || "",
					qty: r.qty || 1,
					rate: r.rate || 0,
					hec_disc_percent: r.hec_disc_percent || 0,
					hec_disc_amount: r.hec_disc_amount || 0,
					hec_remark: r.hec_remark || "",
				});
			});
		if (!s.tests.length) s.tests = [blank_test()];

		s.adjustments = (d.hec_adjustments || []).map(function (r) {
			return {
				adjustment: r.adjustment || "",
				percentage: r.percentage || 0,
				amount: r.amount || 0,
				remark: r.remark || "",
				conf_by: r.conf_by || "",
			};
		});
		if (!s.adjustments.length) s.adjustments = [blank_adj()];

		s.staff = (d.hec_staff_share || []).map(function (r) {
			return { staff_name: r.staff_name || "", amount: r.amount || 0 };
		});
		if (!s.staff.length) s.staff = [blank_staff()];
	}

	function header_html(frm) {
		var d = frm.doc || {};
		var bill_no = d.name || "(New)";
		var barcode = d.unique_barcode || "";
		var now = frappe.datetime.str_to_user(frappe.datetime.now_datetime());
		return `
			<div class="hec-be-head">
				<div class="hec-be-title-row">
					<div class="hec-be-title">${__("Bill Entry")}</div>
					<div class="hec-be-actions">
						<button type="button" class="btn btn-xs btn-default hec-be-new">${__("New")}</button>
						<button type="button" class="btn btn-xs btn-primary hec-be-save">${__("Save")}</button>
					</div>
				</div>
				<div class="hec-be-grid-form">
					<label>${__("Bill Date")}<input type="text" class="hec-bill-dt" value="${frappe.utils.escape_html(
						d.hec_bill_datetime || now
					)}"></label>
					<label>${__("Bill No")}<input type="text" class="hec-bill-no" value="${frappe.utils.escape_html(
						bill_no
					)}" readonly></label>
					<label>${__("Lab No")}<input type="text" class="hec-lab-no" value="${frappe.utils.escape_html(
						barcode
					)}" readonly></label>
					<label>${__("Patient Name")}<input type="text" class="hec-patient" value="${frappe.utils.escape_html(
						d.patient_name || ""
					)}"></label>
					<label>${__("Sex")}
						<select class="hec-gender">
							<option value="Male" ${d.gender === "Male" ? "selected" : ""}>Male</option>
							<option value="Female" ${d.gender === "Female" ? "selected" : ""}>Female</option>
							<option value="Other" ${!d.gender || d.gender === "Other" ? "selected" : ""}>Other</option>
						</select>
					</label>
					<label>${__("Age")}<input type="number" class="hec-age" value="${d.age || ""}"></label>
					<label>${__("Phone")}<input type="text" class="hec-phone" value="${frappe.utils.escape_html(
						d.patient_phone || ""
					)}"></label>
					<label>${__("WhatsApp")}<input type="text" class="hec-whatsapp" value="${frappe.utils.escape_html(
						d.hec_whatsapp || ""
					)}"></label>
					<label>${__("Mail Id")}<input type="text" class="hec-email" value="${frappe.utils.escape_html(
						d.hec_email || ""
					)}"></label>
					<label>${__("Address")}<input type="text" class="hec-address" value="${frappe.utils.escape_html(
						d.collection_address || ""
					)}"></label>
					<label>${__("Refr. By")}
						<span class="hec-link-row">
							<input type="text" class="hec-refr" value="${frappe.utils.escape_html(
								d.referred_doctor || "Self"
							)}" placeholder="${__("Doctor / Self")}">
							<button type="button" class="btn btn-xs btn-default hec-pick-doctor" title="${__(
								"Select Doctor"
							)}">…</button>
						</span>
					</label>
					<label>${__("Guardian")}<input type="text" class="hec-guardian" value="${frappe.utils.escape_html(
						d.hec_guardian || ""
					)}"></label>
					<label>${__("Coll Centre")}
						<span class="hec-link-row">
							<input type="text" class="hec-centre" value="${frappe.utils.escape_html(
								d.franchisee_id || ""
							)}" placeholder="${__("Franchisee / Centre")}" readonly>
							<button type="button" class="btn btn-xs btn-default hec-pick-centre" title="${__(
								"Select Centre"
							)}">…</button>
						</span>
					</label>
					<label>${__("Organization")}<input type="text" class="hec-org" value="${frappe.utils.escape_html(
						d.hec_organization || ""
					)}"></label>
					<label>${__("Coll. Charge")}<input type="number" step="0.01" class="hec-coll-charge" value="${flt(
						d.hec_coll_charge || 0
					)}"></label>
					<label class="hec-check"><input type="checkbox" class="hec-outside" ${
						cint(d.hec_outside_sample) ? "checked" : ""
					}> ${__("Outside Sample")}</label>
					<label class="hec-span2">${__("Remarks")}<input type="text" class="hec-remarks" value="${frappe.utils.escape_html(
						d.hec_lab_remarks || ""
					)}"></label>
				</div>
			</div>`;
	}

	function tests_html(frm) {
		var s = state(frm);
		var rows = (s.tests || [])
			.map(function (r, i) {
				recalc_line(r);
				return `<tr class="hec-test-row" data-i="${i}">
					<td><input class="hec-t-code" value="${frappe.utils.escape_html(r.item || "")}"></td>
					<td><input class="hec-t-name" value="${frappe.utils.escape_html(r.item_name || "")}"></td>
					<td><input type="number" step="0.01" class="hec-t-rate" value="${flt(r.rate)}"></td>
					<td><input type="number" step="0.01" class="hec-t-qty" value="${flt(r.qty) || 1}"></td>
					<td><input type="number" step="0.01" class="hec-t-amt" value="${flt(r.amount).toFixed(2)}" readonly></td>
					<td><input type="number" step="0.01" class="hec-t-disc" value="${flt(r.hec_disc_percent)}"></td>
					<td><input type="number" step="0.01" class="hec-t-discamt" value="${flt(r.hec_disc_amount).toFixed(2)}"></td>
					<td><input type="number" step="0.01" class="hec-t-ramt" value="${flt(r.hec_r_amount).toFixed(2)}" readonly></td>
					<td><input class="hec-t-remark" value="${frappe.utils.escape_html(r.hec_remark || "")}"></td>
					<td><button type="button" class="btn btn-xs hec-t-del" title="Remove">×</button></td>
				</tr>`;
			})
			.join("");
		return `
			<div class="hec-be-section">
				<div class="hec-be-sec-title">${__("Test Details")}</div>
				<div class="hec-be-search">
					<input type="text" class="hec-test-search" placeholder="${__("Search By Test Name")}">
					<button type="button" class="btn btn-xs btn-success hec-test-add-btn" title="${__("Add")}">+</button>
					<input type="text" class="hec-label-field" placeholder="${__("Label")}" style="max-width:140px">
				</div>
				<table class="hec-be-table">
					<thead>
						<tr>
							<th>${__("Code")}</th><th>${__("Test Name")}</th><th>${__("Rate")}</th><th>${__("No")}</th>
							<th>${__("Amount")}</th><th>${__("Disc(%)")}</th><th>${__("DiscAmt")}</th>
							<th>${__("R.Amount")}</th><th>${__("Remark")}</th><th></th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`;
	}

	function adj_staff_totals_html(frm) {
		var s = state(frm);
		var d = frm.doc || {};
		var adj_rows = (s.adjustments || [])
			.map(function (a, i) {
				return `<tr class="hec-adj-row" data-i="${i}">
					<td><input class="hec-a-name" value="${frappe.utils.escape_html(a.adjustment || "")}"></td>
					<td><input type="number" step="0.01" class="hec-a-pct" value="${flt(a.percentage)}"></td>
					<td><input type="number" step="0.01" class="hec-a-amt" value="${flt(a.amount)}"></td>
					<td><input class="hec-a-remark" value="${frappe.utils.escape_html(a.remark || "")}"></td>
					<td><input class="hec-a-conf" value="${frappe.utils.escape_html(a.conf_by || "")}"></td>
					<td><button type="button" class="btn btn-xs hec-a-del">×</button></td>
				</tr>`;
			})
			.join("");
		var staff_rows = (s.staff || [])
			.map(function (st, i) {
				return `<tr class="hec-staff-row" data-i="${i}">
					<td><input class="hec-s-name" value="${frappe.utils.escape_html(st.staff_name || "")}"></td>
					<td><input type="number" step="0.01" class="hec-s-amt" value="${flt(st.amount)}"></td>
					<td><button type="button" class="btn btn-xs hec-s-del">×</button></td>
				</tr>`;
			})
			.join("");

		return `
			<div class="hec-be-bottom">
				<div class="hec-be-bottom-left">
					<div class="hec-be-section">
						<div class="hec-be-sec-title">${__("Adjustments")}
							<button type="button" class="btn btn-xs btn-default hec-adj-add">+</button>
						</div>
						<table class="hec-be-table hec-be-table-sm">
							<thead><tr>
								<th>${__("ADJUSTMENT")}</th><th>${__("PERCENTAGE%")}</th><th>${__("AMOUNT")}</th>
								<th>${__("Remark")}</th><th>${__("CONF_BY")}</th><th></th>
							</tr></thead>
							<tbody>${adj_rows}</tbody>
						</table>
					</div>
					<div class="hec-be-receipt">
						<label>${__("Receipt Amount")}<input type="number" step="0.01" class="hec-receipt-amt" value="${flt(
							d.hec_receipt_amount || 0
						)}"></label>
						<label>${__("Receipt Mode")}
							<select class="hec-receipt-mode">
								${["CASH", "CARD", "UPI", "CHEQUE", "NEFT", "OTHER"]
									.map(function (m) {
										return `<option value="${m}" ${
											(d.hec_receipt_mode || "CASH") === m ? "selected" : ""
										}>${m}</option>`;
									})
									.join("")}
							</select>
						</label>
						<label>${__("Receipt No")}<input type="text" class="hec-receipt-no" value="${frappe.utils.escape_html(
							d.hec_receipt_no || ""
						)}" readonly></label>
						<label>${__("Cheque/Refr.No")}<input type="text" class="hec-cheque-ref" value="${frappe.utils.escape_html(
							d.hec_cheque_ref || ""
						)}"></label>
						<label>${__("Cheque/Refr.Dt")}<input type="date" class="hec-cheque-dt" value="${
							d.hec_cheque_date || ""
						}"></label>
						<label>${__("Bank")}<input type="text" class="hec-bank" value="${frappe.utils.escape_html(
							d.hec_bank || ""
						)}"></label>
					</div>
				</div>
				<div class="hec-be-bottom-mid">
					<label>${__("Amount Paid")}<input type="number" step="0.01" class="hec-amount-paid" value="${flt(
						d.hec_amount_paid || d.hec_receipt_amount || 0
					)}"></label>
					<label style="display:none">${__("Received")}<input type="number" step="0.01" class="hec-received" value="${flt(
						d.hec_received || 0
					)}"></label>
					<label style="display:none">${__("Refund")}<input type="number" step="0.01" class="hec-refund" value="${flt(
						d.hec_refund || 0
					)}"></label>
					<label style="display:none">${__("Written Off")}<input type="number" step="0.01" class="hec-written-off" value="${flt(
						d.hec_written_off || 0
					)}"></label>
					<div class="hec-be-totals">
						<div><span>${__("No of Test")}:</span> <b class="hec-tot-tests">0</b></div>
						<div><span>${__("Test Amount")}:</span> <b class="hec-tot-test-amt">0</b></div>
						<div><span>${__("Coll Charge")}:</span> <b class="hec-tot-coll">0</b></div>
						<div><span>${__("Addition")}:</span> <b class="hec-tot-add">0</b></div>
						<div><span>${__("Deduction")}:</span> <b class="hec-tot-ded">0</b></div>
						<div class="hec-hi"><span>${__("Net Amount")}:</span> <b class="hec-tot-net">0</b></div>
						<div><span>${__("Received")}:</span> <b class="hec-tot-recv">0</b></div>
						<div><span>${__("Refund")}:</span> <b class="hec-tot-refund">0</b></div>
						<div><span>${__("WrittenOff")}:</span> <b class="hec-tot-wo">0</b></div>
						<div class="hec-hi"><span>${__("Due Amount")}:</span> <b class="hec-tot-due">0</b></div>
						<div><span>${__("Balance To Return")}:</span> <b class="hec-tot-bal">0</b></div>
					</div>
				</div>
				<div class="hec-be-bottom-right">
					<div class="hec-be-section">
						<div class="hec-be-sec-title">${__("Staff")}
							<button type="button" class="btn btn-xs btn-default hec-staff-add">+</button>
						</div>
						<table class="hec-be-table hec-be-table-sm">
							<thead><tr><th>${__("StaffName")}</th><th>${__("Amt")}</th><th></th></tr></thead>
							<tbody>${staff_rows}</tbody>
						</table>
					</div>
				</div>
			</div>`;
	}

	function css() {
		return `<style>
			.hec-bill-entry { margin: 8px 0 16px; border: 1px solid #2b6cb0; border-radius: 4px; background: #fff; font-size: 12px; }
			.hec-bill-entry * { box-sizing: border-box; }
			.hec-be-title-row { display:flex; justify-content:space-between; align-items:center; background:#2b6cb0; color:#fff; padding:6px 10px; }
			.hec-be-title { font-weight:700; font-size:14px; }
			.hec-be-actions .btn { margin-left:6px; }
			.hec-be-grid-form { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px 10px; padding:8px 10px; }
			.hec-be-grid-form label { display:flex; flex-direction:column; gap:2px; font-size:11px; color:#334155; margin:0; }
			.hec-be-grid-form input, .hec-be-grid-form select { height:26px; padding:2px 6px; border:1px solid #cbd5e1; border-radius:2px; }
			.hec-be-grid-form .hec-span2 { grid-column: span 2; }
			.hec-be-grid-form .hec-check { flex-direction:row; align-items:center; gap:6px; margin-top:16px; }
			.hec-link-row { display:flex; gap:4px; align-items:center; }
			.hec-link-row input { flex:1; }
			.hec-link-row .btn { height:26px; min-width:28px; padding:0 6px; }
			.hec-be-section { padding:0 10px 10px; }
			.hec-be-sec-title { background:#2b6cb0; color:#fff; padding:4px 8px; font-weight:600; margin:6px 0 4px; display:flex; justify-content:space-between; align-items:center; }
			.hec-be-search { display:flex; gap:6px; align-items:center; margin-bottom:4px; }
			.hec-be-search input { height:26px; padding:2px 6px; border:1px solid #cbd5e1; flex:1; }
			.hec-be-table { width:100%; border-collapse:collapse; }
			.hec-be-table th { background:#2b6cb0; color:#fff; font-weight:600; padding:3px 4px; border:1px solid #1e4e8c; text-align:center; white-space:nowrap; }
			.hec-be-table td { border:1px solid #cbd5e1; padding:1px; }
			.hec-be-table input { width:100%; border:0; height:24px; padding:1px 4px; background:#fff; }
			.hec-be-table .hec-t-del, .hec-be-table .hec-a-del, .hec-be-table .hec-s-del {
				background:#e53e3e; color:#fff; border:0; border-radius:50%; width:22px; height:22px; line-height:20px; padding:0;
			}
			.hec-be-bottom { display:grid; grid-template-columns: 1.4fr 0.9fr 0.7fr; gap:8px; padding:0 10px 10px; }
			.hec-be-receipt { display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-top:6px; }
			.hec-be-receipt label { display:flex; flex-direction:column; font-size:11px; gap:2px; margin:0; }
			.hec-be-receipt input, .hec-be-receipt select { height:26px; border:1px solid #cbd5e1; padding:2px 6px; }
			.hec-be-totals { border:1px solid #cbd5e1; padding:8px; margin-top:8px; background:#f8fafc; }
			.hec-be-totals div { display:flex; justify-content:space-between; padding:2px 0; }
			.hec-be-totals .hec-hi { background:#fef9c3; padding:3px 4px; margin:2px -4px; }
			.hec-be-bottom-mid > label { display:flex; flex-direction:column; font-size:11px; gap:2px; }
			.hec-be-bottom-mid > label input { height:26px; border:1px solid #cbd5e1; padding:2px 6px; }
			@media (max-width: 1100px) {
				.hec-be-grid-form { grid-template-columns: repeat(2, 1fr); }
				.hec-be-bottom { grid-template-columns: 1fr; }
			}
			/* Hide default TRF child grids while Bill Entry is primary editor */
			[data-fieldname="tests"],
			[data-fieldname="hec_adjustments"],
			[data-fieldname="hec_staff_share"],
			[data-fieldname="hec_receipt_section"],
			[data-fieldname="hec_totals_section"] { display: none !important; }
		</style>`;
	}

	function render(frm) {
		if (!frm || !frm.$wrapper || !frm.$wrapper.length) return;
		var $wrap = frm.$wrapper.find(".hec-bill-entry");
		if (!$wrap.length) {
			$wrap = $(
				'<div class="hec-bill-entry"></div>'
			);
			var $anchor = frm.$wrapper.find(".form-layout").first();
			if ($anchor.length) $anchor.before($wrap);
			else {
				var $page = frm.$wrapper.find(".layout-main-section, .form-page, .page-form").first();
				if ($page.length) $page.prepend($wrap);
				else frm.$wrapper.prepend($wrap);
			}
		}
		$wrap.html(css() + header_html(frm) + tests_html(frm) + adj_staff_totals_html(frm));
		bind(frm);
		paint_totals(frm);
	}

	function open_doctor_picker(frm, preset) {
		var dlg = new frappe.ui.Dialog({
			title: __("Select Referring Doctor"),
			fields: [
				{ fieldname: "txt", fieldtype: "Data", label: __("Search"), default: preset || "" },
				{ fieldname: "results", fieldtype: "HTML" },
			],
		});
		function run() {
			frappe.call({
				method: API + "api_search_hec_doctors",
				args: { txt: dlg.get_value("txt") || "", limit: 40 },
				callback: function (r) {
					var doctors = (r.message && r.message.doctors) || [];
					var html =
						'<div style="max-height:320px;overflow:auto"><table class="table table-bordered table-condensed"><thead><tr><th>Name</th><th>Id</th><th></th></tr></thead><tbody>' +
						doctors
							.map(function (d) {
								return `<tr>
									<td>${frappe.utils.escape_html(d.doctor_name || d.label || "")}</td>
									<td>${frappe.utils.escape_html(d.name || "")}</td>
									<td><button class="btn btn-xs btn-primary hec-pick-doc" data-label="${frappe.utils.escape_html(
										d.doctor_name || d.name
									)}">${__("Select")}</button></td>
								</tr>`;
							})
							.join("") +
						"</tbody></table></div>";
					dlg.fields_dict.results.$wrapper.html(html);
					dlg.fields_dict.results.$wrapper.find(".hec-pick-doc").on("click", function () {
						frm.$wrapper.find(".hec-bill-entry .hec-refr").val($(this).data("label"));
						dlg.hide();
					});
				},
			});
		}
		dlg.fields_dict.txt.$input.on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				run();
			}
		});
		dlg.set_primary_action(__("Search"), run);
		dlg.show();
		run();
	}

	function open_centre_picker(frm, preset) {
		var dlg = new frappe.ui.Dialog({
			title: __("Select Collection Centre"),
			fields: [
				{ fieldname: "txt", fieldtype: "Data", label: __("Search"), default: preset || "" },
				{ fieldname: "results", fieldtype: "HTML" },
			],
		});
		function run() {
			frappe.call({
				method: API + "api_search_hec_collection_centres",
				args: { txt: dlg.get_value("txt") || "", limit: 40 },
				callback: function (r) {
					var centres = (r.message && r.message.centres) || [];
					var html =
						'<div style="max-height:320px;overflow:auto"><table class="table table-bordered table-condensed"><thead><tr><th>Centre</th><th>Code</th><th></th></tr></thead><tbody>' +
						centres
							.map(function (c) {
								return `<tr>
									<td>${frappe.utils.escape_html(c.franchise_name || "")}</td>
									<td>${frappe.utils.escape_html(c.name || "")}</td>
									<td><button class="btn btn-xs btn-primary hec-pick-c" data-name="${frappe.utils.escape_html(
										c.name
									)}">${__("Select")}</button></td>
								</tr>`;
							})
							.join("") +
						"</tbody></table></div>";
					dlg.fields_dict.results.$wrapper.html(html);
					dlg.fields_dict.results.$wrapper.find(".hec-pick-c").on("click", function () {
						frm.$wrapper.find(".hec-bill-entry .hec-centre").val($(this).data("name"));
						dlg.hide();
					});
				},
			});
		}
		dlg.fields_dict.txt.$input.on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				run();
			}
		});
		dlg.set_primary_action(__("Search"), run);
		dlg.show();
		run();
	}

	function open_test_picker(frm, preset) {
		var dlg = new frappe.ui.Dialog({
			title: __("Search By Test Name"),
			fields: [
				{ fieldname: "txt", fieldtype: "Data", label: __("Search"), default: preset || "" },
				{ fieldname: "results", fieldtype: "HTML" },
			],
		});
		function run() {
			var txt = dlg.get_value("txt") || "";
			frappe.call({
				method: API + "api_search_hec_lab_tests",
				args: { txt: txt, limit: 40 },
				callback: function (r) {
					var tests = (r.message && r.message.tests) || [];
					var html =
						'<div style="max-height:320px;overflow:auto"><table class="table table-bordered table-condensed"><thead><tr><th>Code</th><th>Name</th><th>Rate</th><th></th></tr></thead><tbody>' +
						tests
							.map(function (t) {
								return `<tr>
									<td>${frappe.utils.escape_html(t.item_code)}</td>
									<td>${frappe.utils.escape_html(t.item_name)}${
										t.kind === "panel" ? " <em>(Panel)</em>" : ""
									}</td>
									<td class="text-right">${flt(t.rate).toFixed(2)}</td>
									<td><button class="btn btn-xs btn-primary hec-pick" data-code="${frappe.utils.escape_html(
										t.item_code
									)}" data-name="${frappe.utils.escape_html(t.item_name)}" data-rate="${flt(
										t.rate
									)}" data-kind="${t.kind || "test"}" data-panel="${frappe.utils.escape_html(
										t.panel_id || ""
									)}">${__("Add")}</button></td>
								</tr>`;
							})
							.join("") +
						"</tbody></table></div>";
					dlg.fields_dict.results.$wrapper.html(html);
					dlg.fields_dict.results.$wrapper.find(".hec-pick").on("click", function () {
						var $b = $(this);
						var kind = $b.data("kind");
						if (kind === "panel") {
							frappe.call({
								method: API + "api_expand_hec_lab_panel",
								args: { panel_id: $b.data("panel") || $b.data("code") },
								freeze: true,
								callback: function (res) {
									var lines = (res.message && res.message.tests) || [];
									var s = state(frm);
									lines.forEach(function (line) {
										s.tests.push(
											recalc_line({
												item: line.item,
												item_name: line.item_name,
												qty: line.qty || 1,
												rate: line.rate || 0,
											})
										);
									});
									// drop trailing blank
									s.tests = s.tests.filter(function (r, idx) {
										return (r.item || "").trim() || idx === s.tests.length - 1;
									});
									if (!s.tests.length) s.tests = [blank_test()];
									dlg.hide();
									render(frm);
								},
							});
						} else {
							var s = state(frm);
							var empty = s.tests.find(function (r) {
								return !(r.item || "").trim();
							});
							var target = empty || blank_test();
							target.item = $b.data("code");
							target.item_name = $b.data("name");
							target.rate = flt($b.data("rate"));
							target.qty = 1;
							recalc_line(target);
							if (!empty) s.tests.push(target);
							dlg.hide();
							render(frm);
						}
					});
				},
			});
		}
		dlg.fields_dict.txt.$input.on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				run();
			}
		});
		dlg.set_primary_action(__("Search"), run);
		dlg.show();
		run();
	}

	function collect_payload(frm) {
		sync_from_dom(frm);
		var s = state(frm);
		var $w = frm.$wrapper.find(".hec-bill-entry");
		var t = compute_local(frm);
		return {
			name: frm.doc.name,
			patient_name: $w.find(".hec-patient").val(),
			age: cint($w.find(".hec-age").val()),
			gender: $w.find(".hec-gender").val(),
			patient_phone: $w.find(".hec-phone").val(),
			hec_whatsapp: $w.find(".hec-whatsapp").val(),
			hec_email: $w.find(".hec-email").val(),
			collection_address: $w.find(".hec-address").val(),
			referred_doctor: $w.find(".hec-refr").val() || "Self",
			hec_guardian: $w.find(".hec-guardian").val(),
			franchisee_id: $w.find(".hec-centre").val(),
			hec_organization: $w.find(".hec-org").val(),
			hec_coll_charge: flt($w.find(".hec-coll-charge").val()),
			hec_outside_sample: $w.find(".hec-outside").is(":checked") ? 1 : 0,
			hec_lab_remarks: $w.find(".hec-remarks").val(),
			hec_bill_datetime: $w.find(".hec-bill-dt").val(),
			hec_receipt_amount: flt($w.find(".hec-receipt-amt").val()) || t.hec_amount_paid,
			hec_receipt_mode: $w.find(".hec-receipt-mode").val(),
			hec_cheque_ref: $w.find(".hec-cheque-ref").val(),
			hec_cheque_date: $w.find(".hec-cheque-dt").val(),
			hec_bank: $w.find(".hec-bank").val(),
			hec_amount_paid: t.hec_amount_paid,
			hec_received: t.hec_received || t.hec_amount_paid,
			hec_refund: t.hec_refund,
			hec_written_off: t.hec_written_off,
			tests: (s.tests || [])
				.filter(function (r) {
					return (r.item || "").trim();
				})
				.map(function (r) {
					recalc_line(r);
					return {
						item: r.item,
						item_name: r.item_name,
						qty: r.qty,
						rate: r.rate,
						hec_disc_percent: r.hec_disc_percent,
						hec_disc_amount: r.hec_disc_amount,
						hec_remark: r.hec_remark,
						_disc_source: r._disc_source || "pct",
					};
				}),
			adjustments: (s.adjustments || []).filter(function (a) {
				return (a.adjustment || "").trim() || flt(a.amount) || flt(a.percentage);
			}),
			staff: (s.staff || []).filter(function (st) {
				return (st.staff_name || "").trim() || flt(st.amount);
			}),
		};
	}

	function save_bill(frm) {
		var payload = collect_payload(frm);
		if (!(payload.patient_name || "").trim()) {
			frappe.msgprint(__("Patient Name is required"));
			return;
		}
		if (!payload.age) {
			frappe.msgprint(__("Age is required"));
			return;
		}
		if (!payload.tests.length) {
			frappe.msgprint(__("Add at least one test"));
			return;
		}
		if (!(payload.franchisee_id || "").trim()) {
			frappe.msgprint(__("Coll Centre (Franchisee) is required"));
			return;
		}
		frappe.call({
			method: API + "api_save_hec_lab_bill",
			args: { data: payload },
			freeze: true,
			freeze_message: __("Saving bill…"),
			callback: function (r) {
				var msg = r.message || {};
				if (!msg.ok) return;
				frappe.show_alert({ message: __("Bill saved: {0}", [msg.name]), indicator: "green" });
				if (frm.doc.name !== msg.name) {
					frappe.set_route("Form", "Customer TRF", msg.name);
				} else {
					frm.reload_doc();
				}
			},
		});
	}

	function bind(frm) {
		var $w = frm.$wrapper.find(".hec-bill-entry");
		var s = state(frm);

		$w.find(".hec-be-new").on("click", function () {
			frappe.new_doc("Customer TRF");
		});
		$w.find(".hec-be-save").on("click", function () {
			save_bill(frm);
		});
		$w.find(".hec-pick-doctor").on("click", function () {
			open_doctor_picker(frm, $w.find(".hec-refr").val());
		});
		$w.find(".hec-pick-centre").on("click", function () {
			open_centre_picker(frm, $w.find(".hec-centre").val());
		});
		$w.find(".hec-centre").on("click", function () {
			open_centre_picker(frm, $(this).val());
		});
		$w.find(".hec-test-add-btn, .hec-test-search").on("click focus", function (e) {
			if (e.type === "focus" && !$w.find(".hec-test-search").val()) return;
			if (e.type === "click" && $(e.target).hasClass("hec-test-search")) return;
			open_test_picker(frm, $w.find(".hec-test-search").val());
		});
		$w.find(".hec-test-search").on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				open_test_picker(frm, $(this).val());
			}
		});

		$w.on("input change", "input, select", function () {
			sync_from_dom(frm);
			paint_totals(frm);
		});

		// Disc% vs DiscAmt source tracking (RemeLab)
		$w.find(".hec-t-disc").on("input", function () {
			var i = cint($(this).closest("tr").data("i"));
			var s = state(frm);
			if (s.tests[i]) s.tests[i]._disc_source = "pct";
		});
		$w.find(".hec-t-discamt").on("input", function () {
			var i = cint($(this).closest("tr").data("i"));
			var s = state(frm);
			if (s.tests[i]) s.tests[i]._disc_source = "amt";
		});

		$w.find(".hec-t-del").on("click", function () {
			var i = cint($(this).closest("tr").data("i"));
			s.tests.splice(i, 1);
			if (!s.tests.length) s.tests.push(blank_test());
			render(frm);
		});
		$w.find(".hec-a-del").on("click", function () {
			var i = cint($(this).closest("tr").data("i"));
			s.adjustments.splice(i, 1);
			if (!s.adjustments.length) s.adjustments.push(blank_adj());
			render(frm);
		});
		$w.find(".hec-s-del").on("click", function () {
			var i = cint($(this).closest("tr").data("i"));
			s.staff.splice(i, 1);
			if (!s.staff.length) s.staff.push(blank_staff());
			render(frm);
		});
		$w.find(".hec-adj-add").on("click", function () {
			s.adjustments.push(blank_adj());
			render(frm);
		});
		$w.find(".hec-staff-add").on("click", function () {
			s.staff.push(blank_staff());
			render(frm);
		});

		// Enter on code opens picker
		$w.find(".hec-t-code").on("keydown", function (e) {
			if (e.which === 13) {
				e.preventDefault();
				open_test_picker(frm, $(this).val());
			}
		});
	}

	function mount(frm) {
		safe(function () {
			load_from_doc(frm);
			render(frm);
		});
	}

	frappe.ui.form.on("Customer TRF", {
		onload_post_render: function (frm) {
			mount(frm);
		},
		onload: function (frm) {
			mount(frm);
		},
		refresh: function (frm) {
			mount(frm);
		},
	});

	// Hard guarantee: if form already open when script arrives late
	$(document).on("page-change", function () {
		try {
			var route = frappe.get_route_str() || "";
			if (route.indexOf("Form/Customer TRF") === 0 || route.indexOf("customer-trf") >= 0) {
				var frm = cur_frm;
				if (frm && frm.doctype === "Customer TRF") mount(frm);
			}
		} catch (e) {}
	});
})();
