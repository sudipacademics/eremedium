"""
Phase 121.13 — reconciliation per transaction type.

- UPI / QR collection report: each successful UPI payment is matched to the UPI collection booked for its order.
- Cheque collection report: each cheque is matched by number; re-uploads update its status, bounced cheques are flagged.
- Cash: collections sitting in the cash account are grouped into a bank deposit (one Journal Entry, cash -> bank);
  the bank statement's cash-deposit line then matches that entry.
The bank statement itself stays in clinical_phase121_payment_core.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re

import frappe
from frappe import _
from frappe.utils import add_days, cstr, flt, getdate, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import (
	_api,
	_cell,
	_parse_amount,
	_parse_date,
	_require_finance,
	_rows_from_file,
	_statement_bank_account,
	_tokens,
	payment_settings,
)

LINE_DT = "HEC Recon Line"
UPI = "UPI Collection"
CHEQUE = "Cheque"
TYPES = {"upi": UPI, "cheque": CHEQUE}
LINKED_STATES = ("Matched", "Returned")

REPORT_KEYS = {
	UPI: {
		"date": ("transaction date", "txn date", "transaction date time", "date and time", "date"),
		"reference": (
			"bank rrn",
			"rrn",
			"utr",
			"upi transaction id",
			"upi txn id",
			"customer ref",
			"transaction id",
			"txn id",
			"ref no",
			"reference",
		),
		"amount": ("transaction amount", "txn amount", "amount"),
		"counterparty": ("payer name", "payer vpa", "customer vpa", "remitter name", "customer name", "payer", "vpa"),
		"status": ("transaction status", "txn status", "status"),
		"settlement_date": ("settlement date", "settled on", "credit date"),
	},
	CHEQUE: {
		"date": ("deposit date", "instrument date", "presentation date", "cheque date", "date"),
		"reference": ("cheque no", "cheque number", "chequeno", "instrument no", "instrument number", "chq no"),
		"amount": ("cheque amount", "instrument amount", "amount"),
		"counterparty": ("drawer name", "drawer", "drawee bank", "bank name", "customer name", "payer"),
		"status": ("cheque status", "instrument status", "status"),
		"settlement_date": ("credit date", "realisation date", "realization date", "clearing date", "value date"),
	},
}
UPI_SKIP = ("FAIL", "DECLIN", "REJECT", "PENDING", "TIMEOUT", "TIMED OUT", "EXPIRED", "REVERS", "REFUND")
CHEQUE_RETURNED = ("RETURN", "BOUNCE", "DISHONO", "REJECT", "UNPAID")
OFFLINE_REF = re.compile(r"^offline-(.+)-\d{14}$")
COLLECTOR_RE = re.compile(r"\bby (\S+@\S+|\S+)\s*$")


def _doctype_ready():
	return bool(frappe.db.exists("DocType", LINE_DT))


def ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"Payment Entry": [
				{
					"fieldname": "hec_collection_ref",
					"label": "Collection Reference (UTR / Cheque No)",
					"fieldtype": "Data",
					"no_copy": 1,
					"search_index": 1,
					"insert_after": "hec_payment_key",
				},
				{
					"fieldname": "hec_collected_by",
					"label": "Collected By",
					"fieldtype": "Data",
					"read_only": 1,
					"no_copy": 1,
					"insert_after": "hec_collection_ref",
				},
				{
					"fieldname": "hec_cash_deposit",
					"label": "Banked in Cash Deposit",
					"fieldtype": "Data",
					"read_only": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
					"search_index": 1,
					"insert_after": "hec_collected_by",
				},
			],
			"Journal Entry": [
				{
					"fieldname": "hec_cash_deposit",
					"label": "Banked in Cash Deposit",
					"fieldtype": "Data",
					"read_only": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
					"search_index": 1,
					"insert_after": "hec_payment_key",
				}
			],
		},
		update=True,
	)
	return {"custom_fields": "ok"}


# --------------------------------------------------------------------------- parsing


def _header_map(row, keys):
	cells = [_cell(c).lower() for c in row]
	mapping = {}
	for key, candidates in keys.items():
		for candidate in candidates:
			for index, cell in enumerate(cells):
				if index in mapping.values():
					continue
				if cell == candidate or (len(candidate) > 3 and cell.startswith(candidate)):
					mapping[key] = index
					break
			if key in mapping:
				break
	return mapping


def parse_report(statement_type, filename, content):
	keys = REPORT_KEYS[statement_type]
	rows = _rows_from_file(filename, content)
	header_index, mapping = None, {}
	for index, row in enumerate(rows[:40]):
		candidate = _header_map(row, keys)
		if {"date", "amount", "reference"} <= set(candidate):
			header_index, mapping = index, candidate
			break
	if header_index is None:
		frappe.throw(_("Could not find the header row. The report needs date, amount and reference (UTR / RRN / cheque number) columns."))
	parsed, skipped = [], 0
	for row in rows[header_index + 1 :]:
		if not row or all(_cell(c) == "" for c in row):
			continue

		def get(key):
			index = mapping.get(key)
			return row[index] if index is not None and index < len(row) else None

		txn_date = _parse_date(get("date"))
		amount = _parse_amount(get("amount"))
		reference = re.sub(r"\s+", "", _cell(get("reference")))[:140]
		if not txn_date or amount <= 0 or not reference:
			continue
		status = _cell(get("status"))[:140]
		if statement_type == UPI and any(word in status.upper() for word in UPI_SKIP):
			skipped += 1
			continue
		parsed.append(
			{
				"date": txn_date,
				"amount": round(amount, 2),
				"reference": reference,
				"counterparty": _cell(get("counterparty"))[:140],
				"status": status,
				"settlement_date": _parse_date(get("settlement_date")),
				"description": " | ".join(_cell(c) for c in row if _cell(c))[:1000],
			}
		)
	return parsed, skipped


def _is_returned(status):
	return any(word in cstr(status).upper() for word in CHEQUE_RETURNED)


def _import_id(statement_type, row):
	parts = [statement_type, row["reference"].upper(), cstr(row["amount"])]
	if statement_type == UPI:
		parts.append(cstr(row["date"]))
	else:
		parts.append(row["counterparty"].upper())
	return "HRL-" + hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:24]


def import_report(statement_type, filename, content):
	rows, skipped = parse_report(statement_type, filename, content)
	created, updated, duplicates, auto_matched = 0, 0, 0, 0
	for row in rows:
		import_id = _import_id(statement_type, row)
		existing = frappe.db.get_value(LINE_DT, {"import_id": import_id}, ["name", "report_status", "recon_status"], as_dict=True)
		if existing:
			if statement_type == CHEQUE and existing.report_status != row["status"]:
				values = {"report_status": row["status"], "settlement_date": row["settlement_date"]}
				if _is_returned(row["status"]) and existing.recon_status != "Ignored":
					values["recon_status"] = "Returned"
				frappe.db.set_value(LINE_DT, existing.name, values)
				updated += 1
			else:
				duplicates += 1
			continue
		line = frappe.get_doc(
			{
				"doctype": LINE_DT,
				"statement_type": statement_type,
				"txn_date": row["date"],
				"amount": row["amount"],
				"reference": row["reference"],
				"counterparty": row["counterparty"],
				"report_status": row["status"],
				"settlement_date": row["settlement_date"],
				"description": row["description"],
				"import_id": import_id,
				"source_file": cstr(filename)[:140],
			}
		)
		line.insert(ignore_permissions=True)
		created += 1
		exact = [s for s in suggest(line.name) if s["confidence"] == "reference" and s["voucher_type"] != "Franchisee Wallet Topup Request"]
		if len(exact) == 1:
			_link(line.name, exact[0]["voucher_type"], exact[0]["voucher_name"], "Auto")
			auto_matched += 1
		elif statement_type == CHEQUE and _is_returned(row["status"]):
			frappe.db.set_value(LINE_DT, line.name, "recon_status", "Returned")
	frappe.db.commit()
	return {"rows": len(rows), "created": created, "updated": updated, "duplicates": duplicates, "skipped": skipped, "auto_matched": auto_matched}


# --------------------------------------------------------------------------- matching


def _linked_vouchers(statement_type, exclude_line=None):
	filters = {"statement_type": statement_type, "recon_status": ["in", LINKED_STATES], "matched_name": ["is", "set"]}
	if exclude_line:
		filters["name"] = ["!=", exclude_line]
	return {(r.matched_doctype, r.matched_name) for r in frappe.get_all(LINE_DT, filters=filters, fields=["matched_doctype", "matched_name"])}


def _order_of(reference_no):
	match = OFFLINE_REF.match(cstr(reference_no))
	return match.group(1) if match else None


def _collector(remarks, collected_by=None):
	if collected_by:
		return collected_by
	match = COLLECTOR_RE.search(cstr(remarks))
	return match.group(1) if match else None


def _pe_label(row):
	order = _order_of(row.reference_no)
	bits = [row.party or "", f"order {order}" if order else cstr(row.reference_no)]
	if row.get("hec_collection_ref"):
		bits.append(f"ref {row.hec_collection_ref}")
	return " · ".join(b for b in bits if b)


def _mode_filter(statement_type):
	return "UPI" if statement_type == UPI else "Cheque"


def suggest(line_name):
	line = frappe.get_doc(LINE_DT, line_name)
	ref = cstr(line.reference).upper()
	tokens = _tokens(line.reference, line.description) | ({ref} if ref else set())
	linked = _linked_vouchers(line.statement_type, exclude_line=line.name)
	start, end = add_days(line.txn_date, -3), add_days(line.txn_date, 2)
	amount = flt(line.amount)
	out, seen = [], set()

	def add(kind, name, voucher_amount, label, confidence, posting_date=None):
		if (kind, name) in seen or (kind, name) in linked:
			return
		seen.add((kind, name))
		out.append(
			{
				"voucher_type": kind,
				"voucher_name": name,
				"amount": flt(voucher_amount),
				"label": label,
				"confidence": confidence,
				"posting_date": cstr(posting_date or ""),
				"amount_differs": abs(flt(voucher_amount) - amount) >= 0.01,
			}
		)

	pe_fields = ["name", "party", "paid_amount", "posting_date", "reference_no", "remarks", "hec_collection_ref", "mode_of_payment"]
	if ref:
		for row in frappe.get_all(
			"Payment Entry",
			filters={"docstatus": 1, "payment_type": "Receive", "hec_collection_ref": line.reference},
			fields=pe_fields,
		) + frappe.get_all(
			"Payment Entry", filters={"docstatus": 1, "payment_type": "Receive", "reference_no": line.reference}, fields=pe_fields
		):
			add("Payment Entry", row.name, row.paid_amount, _pe_label(row), "reference", row.posting_date)
		for row in frappe.get_all(
			"Journal Entry", filters={"docstatus": 1, "cheque_no": line.reference}, fields=["name", "total_debit", "user_remark", "posting_date"]
		):
			add("Journal Entry", row.name, row.total_debit, cstr(row.user_remark)[:120], "reference", row.posting_date)
		for row in frappe.get_all(
			"Franchisee Wallet Topup Request",
			filters={"payment_reference": line.reference, "status": ["!=", "Rejected"]},
			fields=["name", "franchisee", "amount", "status", "creation"],
		):
			label = f"{row.status} wallet top-up · {row.franchisee}"
			add("Franchisee Wallet Topup Request", row.name, row.amount, label, "reference" if row.status == "Approved" else "approve_first", row.creation)
	for row in frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"payment_type": "Receive",
			"mode_of_payment": _mode_filter(line.statement_type),
			"paid_amount": amount,
			"posting_date": ["between", [start, end]],
		},
		fields=pe_fields,
		order_by="posting_date asc",
	):
		if row.hec_collection_ref and cstr(row.hec_collection_ref).upper() not in tokens:
			continue
		add("Payment Entry", row.name, row.paid_amount, _pe_label(row), "amount_date", row.posting_date)
	return out[:6]


def _voucher_ok(voucher_type, voucher_name):
	if voucher_type not in ("Payment Entry", "Journal Entry", "Franchisee Wallet Topup Request"):
		frappe.throw(_("Unsupported voucher type"))
	if voucher_type == "Franchisee Wallet Topup Request":
		status = frappe.db.get_value(voucher_type, voucher_name, "status")
		if status != "Approved":
			frappe.throw(_("Approve the wallet top-up request first"))
	elif frappe.db.get_value(voucher_type, voucher_name, "docstatus") != 1:
		frappe.throw(_("{0} {1} is not submitted").format(voucher_type, voucher_name))


def _link(line_name, voucher_type, voucher_name, via):
	line = frappe.get_doc(LINE_DT, line_name)
	_voucher_ok(voucher_type, voucher_name)
	if (voucher_type, voucher_name) in _linked_vouchers(line.statement_type, exclude_line=line.name):
		frappe.throw(_("{0} is already matched to another report line").format(voucher_name))
	status = "Returned" if line.statement_type == CHEQUE and _is_returned(line.report_status) else "Matched"
	frappe.db.set_value(
		LINE_DT,
		line.name,
		{"recon_status": status, "matched_doctype": voucher_type, "matched_name": voucher_name, "matched_via": via},
	)
	return status


def _unlinked_books(statement_type, from_date, to_date):
	linked = _linked_vouchers(statement_type)
	rows = []
	for row in frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"payment_type": "Receive",
			"mode_of_payment": _mode_filter(statement_type),
			"posting_date": ["between", [from_date, to_date]],
		},
		fields=["name", "party", "paid_amount", "posting_date", "reference_no", "remarks", "hec_collection_ref", "hec_collected_by"],
		order_by="posting_date desc",
		limit=300,
	):
		if ("Payment Entry", row.name) in linked:
			continue
		rows.append(
			{
				"voucher_type": "Payment Entry",
				"voucher_name": row.name,
				"date": cstr(row.posting_date),
				"amount": flt(row.paid_amount),
				"label": _pe_label(row),
				"collected_by": _collector(row.remarks, row.hec_collected_by),
			}
		)
	topup_mode = "UPI" if statement_type == UPI else "Cheque"
	for row in frappe.get_all(
		"Franchisee Wallet Topup Request",
		filters={"payment_mode": topup_mode, "status": "Approved", "creation": ["between", [from_date, f"{to_date} 23:59:59"]]},
		fields=["name", "franchisee", "amount", "creation", "payment_reference"],
		limit=200,
	):
		if ("Franchisee Wallet Topup Request", row.name) in linked:
			continue
		rows.append(
			{
				"voucher_type": "Franchisee Wallet Topup Request",
				"voucher_name": row.name,
				"date": cstr(row.creation)[:10],
				"amount": flt(row.amount),
				"label": f"Wallet top-up · {row.franchisee} · ref {row.payment_reference or '—'}",
				"collected_by": None,
			}
		)
	return rows


def list_report(statement_type, from_date=None, to_date=None, show="open"):
	to_date = getdate(to_date or today())
	from_date = getdate(from_date or add_days(to_date, -60))
	filters = {"statement_type": statement_type, "txn_date": ["between", [from_date, to_date]]}
	if show == "open":
		filters["recon_status"] = ["in", ["Unmatched", "Returned"]]
	lines = frappe.get_all(
		LINE_DT,
		filters=filters,
		fields=[
			"name",
			"txn_date",
			"amount",
			"reference",
			"counterparty",
			"report_status",
			"settlement_date",
			"recon_status",
			"matched_doctype",
			"matched_name",
			"matched_via",
		],
		order_by="txn_date desc, creation desc",
		limit=500,
	)
	for line in lines:
		line["suggestions"] = suggest(line.name) if line.recon_status == "Unmatched" else []
	counts = frappe.db.sql(
		f"select recon_status, count(*) n, sum(amount) total from `tab{LINE_DT}` where statement_type = %s and txn_date between %s and %s group by recon_status",
		(statement_type, from_date, to_date),
		as_dict=True,
	)
	return {
		"statement_type": statement_type,
		"from_date": cstr(from_date),
		"to_date": cstr(to_date),
		"lines": lines,
		"counts": {c.recon_status: {"count": c.n, "amount": flt(c.total)} for c in counts},
		"books_not_in_report": _unlinked_books(statement_type, from_date, to_date),
	}


# --------------------------------------------------------------------------- cash deposits


def _cash_accounts():
	settings = payment_settings()
	cash = settings.get("cash_account")
	if not cash:
		frappe.throw(_("Set the cash account in HEC Payment Settings first."))
	return cash


def cash_in_hand(since=None):
	"""Cash receipts (debits to the cash account) not yet banked through a cash deposit."""
	cash = _cash_accounts()
	since = getdate(since or add_days(today(), -90))
	rows = frappe.db.sql(
		"""
		select gle.voucher_type, gle.voucher_no, gle.posting_date, sum(gle.debit) - sum(gle.credit) amount,
			pe.party, pe.reference_no, pe.remarks pe_remarks, pe.hec_collected_by, je.user_remark
		from `tabGL Entry` gle
		left join `tabPayment Entry` pe on gle.voucher_type = 'Payment Entry' and pe.name = gle.voucher_no
		left join `tabJournal Entry` je on gle.voucher_type = 'Journal Entry' and je.name = gle.voucher_no
		where gle.account = %(cash)s and gle.is_cancelled = 0 and gle.posting_date >= %(since)s
			and gle.voucher_type in ('Payment Entry', 'Journal Entry')
			and ifnull(pe.hec_cash_deposit, '') = '' and ifnull(je.hec_cash_deposit, '') = ''
			and ifnull(je.hec_payment_key, '') not like 'CASHDEP-%%'
		group by gle.voucher_type, gle.voucher_no, gle.posting_date, pe.party, pe.reference_no, pe.remarks, pe.hec_collected_by, je.user_remark
		having amount > 0
		order by gle.posting_date asc
		""",
		{"cash": cash, "since": since},
		as_dict=True,
	)
	items = []
	for row in rows:
		order = _order_of(row.reference_no)
		label = " · ".join(b for b in (row.party, f"order {order}" if order else None) if b) or cstr(row.user_remark)[:120]
		items.append(
			{
				"voucher_type": row.voucher_type,
				"voucher_name": row.voucher_no,
				"date": cstr(row.posting_date),
				"amount": flt(row.amount, 2),
				"label": label,
				"collected_by": _collector(row.pe_remarks or row.user_remark, row.hec_collected_by),
				"age_days": (getdate(today()) - getdate(row.posting_date)).days,
			}
		)
	deposits = frappe.get_all(
		"Journal Entry",
		filters={"docstatus": 1, "hec_payment_key": ["like", "CASHDEP-%"], "posting_date": [">=", since]},
		fields=["name", "posting_date", "total_debit", "cheque_no", "clearance_date", "user_remark"],
		order_by="posting_date desc",
		limit=100,
	)
	return {
		"cash_account": cash,
		"since": cstr(since),
		"items": items,
		"total": flt(sum(i["amount"] for i in items), 2),
		"deposits": [
			{
				"journal_entry": d.name,
				"date": cstr(d.posting_date),
				"amount": flt(d.total_debit),
				"slip_no": d.cheque_no,
				"in_bank_statement": bool(d.clearance_date),
				"remark": d.user_remark,
			}
			for d in deposits
		],
	}


def create_cash_deposit(vouchers, slip_no, deposit_date=None, bank_account=None):
	cash = _cash_accounts()
	slip_no = cstr(slip_no).strip()
	if not slip_no:
		frappe.throw(_("Enter the deposit slip number"))
	if isinstance(vouchers, str):
		vouchers = json.loads(vouchers or "[]")
	if not vouchers:
		frappe.throw(_("Tick the collections included in this deposit"))
	posting = getdate(deposit_date or today())
	if posting > getdate(today()):
		frappe.throw(_("Deposit date cannot be in the future"))
	bank_account = _statement_bank_account(bank_account)
	gl = frappe.db.get_value("Bank Account", bank_account, "account")
	company = frappe.db.get_value("Account", cash, "company")
	if frappe.db.get_value("Account", gl, "company") != company:
		frappe.throw(_("The cash account and the bank account belong to different companies"))

	total, picked = 0.0, []
	for item in vouchers:
		voucher_type, voucher_name = cstr(item.get("voucher_type")), cstr(item.get("voucher_name"))
		if voucher_type not in ("Payment Entry", "Journal Entry"):
			frappe.throw(_("Unsupported voucher {0}").format(voucher_name))
		doc = frappe.db.get_value(voucher_type, voucher_name, ["docstatus", "hec_cash_deposit"], as_dict=True)
		if not doc or doc.docstatus != 1:
			frappe.throw(_("{0} is not a submitted entry").format(voucher_name))
		if doc.hec_cash_deposit:
			frappe.throw(_("{0} is already in cash deposit {1}").format(voucher_name, doc.hec_cash_deposit))
		amount = flt(
			frappe.db.sql(
				"select sum(debit) - sum(credit) from `tabGL Entry` where voucher_type = %s and voucher_no = %s and account = %s and is_cancelled = 0",
				(voucher_type, voucher_name, cash),
			)[0][0]
		)
		if amount <= 0:
			frappe.throw(_("{0} did not put cash into {1}").format(voucher_name, cash))
		total += amount
		picked.append((voucher_type, voucher_name))
	total = flt(total, 2)
	cost_center = frappe.db.get_value("Company", company, "cost_center")
	key = f"CASHDEP-{slip_no}-{posting}"[:140]
	if frappe.db.exists("Journal Entry", {"hec_payment_key": key, "docstatus": 1}):
		frappe.throw(_("Deposit slip {0} on {1} is already recorded").format(slip_no, posting))
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Bank Entry",
			"company": company,
			"posting_date": posting,
			"cheque_no": slip_no[:140],
			"cheque_date": posting,
			"user_remark": f"Cash deposited to bank, slip {slip_no}: {len(picked)} collections",
			"hec_payment_key": key,
			"accounts": [
				{"account": gl, "debit_in_account_currency": total, "cost_center": cost_center},
				{"account": cash, "credit_in_account_currency": total, "cost_center": cost_center},
			],
		}
	)
	je.flags.ignore_permissions = True
	je.insert(ignore_permissions=True)
	je.submit()
	for voucher_type, voucher_name in picked:
		frappe.db.set_value(voucher_type, voucher_name, "hec_cash_deposit", je.name, update_modified=False)
	return {"journal_entry": je.name, "amount": total, "count": len(picked)}


def cancel_cash_deposit(journal_entry):
	je = frappe.get_doc("Journal Entry", journal_entry)
	if not cstr(je.hec_payment_key).startswith("CASHDEP-") or je.docstatus != 1:
		frappe.throw(_("Not an open cash deposit"))
	if je.clearance_date:
		frappe.throw(_("This deposit is already reconciled with the bank statement. Unreconcile it in ERPNext first."))
	je.flags.ignore_permissions = True
	je.cancel()
	for doctype in ("Payment Entry", "Journal Entry"):
		frappe.db.sql(f"update `tab{doctype}` set hec_cash_deposit = '' where hec_cash_deposit = %s", (journal_entry,))
	return {"journal_entry": journal_entry, "cancelled": True}


# --------------------------------------------------------------------------- whitelisted API (finance)


def _type(statement_type):
	value = TYPES.get(cstr(statement_type).lower()) or (statement_type if statement_type in TYPES.values() else None)
	if not value:
		frappe.throw(_("statement_type must be upi or cheque"))
	if not _doctype_ready():
		frappe.throw(_("Reconciliation is not set up yet"))
	return value


@frappe.whitelist(allow_guest=True, methods=["POST"])
def upload_recon_report(statement_type=None, filename=None, content_b64=None, sid=None):
	def run():
		_require_finance(sid)
		kind = _type(statement_type or frappe.form_dict.get("statement_type"))
		name = cstr(filename or frappe.form_dict.get("filename")).strip()
		data = cstr(content_b64 or frappe.form_dict.get("content_b64"))
		if not name or not data:
			frappe.throw(_("Choose a report file"))
		if not re.search(r"\.(csv|xls|xlsx)$", name.lower()):
			frappe.throw(_("Upload the report as CSV, XLS or XLSX"))
		if data.startswith("data:") and "," in data[:100]:
			data = data.split(",", 1)[1]
		content = base64.b64decode(data)
		if len(content) > 8 * 1024 * 1024:
			frappe.throw(_("Report file is larger than 8 MB"))
		return import_report(kind, name, content)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def list_recon_report(statement_type=None, from_date=None, to_date=None, show="open", sid=None):
	def run():
		_require_finance(sid)
		return list_report(_type(statement_type), from_date, to_date, cstr(show) or "open")

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def match_recon_line(line=None, voucher_type=None, voucher_name=None, sid=None):
	def run():
		_require_finance(sid)
		if not (line and voucher_type and voucher_name) or not frappe.db.exists(LINE_DT, line):
			frappe.throw(_("line, voucher_type and voucher_name are required"))
		status = _link(line, voucher_type, voucher_name, "Manual")
		frappe.db.commit()
		return {"line": line, "recon_status": status}

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def set_recon_line_status(line=None, action=None, sid=None):
	"""action: ignore | reopen (clears any match)."""

	def run():
		_require_finance(sid)
		if not line or not frappe.db.exists(LINE_DT, line):
			frappe.throw(_("Report line not found"))
		if action == "ignore":
			frappe.db.set_value(LINE_DT, line, {"recon_status": "Ignored", "matched_doctype": None, "matched_name": None, "matched_via": ""})
		elif action == "reopen":
			report_status, kind = frappe.db.get_value(LINE_DT, line, ["report_status", "statement_type"])
			status = "Returned" if kind == CHEQUE and _is_returned(report_status) else "Unmatched"
			frappe.db.set_value(LINE_DT, line, {"recon_status": status, "matched_doctype": None, "matched_name": None, "matched_via": ""})
		else:
			frappe.throw(_("action must be ignore or reopen"))
		frappe.db.commit()
		return {"line": line, "recon_status": frappe.db.get_value(LINE_DT, line, "recon_status")}

	return _api(run)


@frappe.whitelist(allow_guest=True)
def get_cash_in_hand(since=None, sid=None):
	def run():
		_require_finance(sid)
		return cash_in_hand(since)

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def record_cash_deposit(vouchers=None, slip_no=None, deposit_date=None, sid=None):
	def run():
		_require_finance(sid)
		result = create_cash_deposit(vouchers or frappe.form_dict.get("vouchers"), slip_no, deposit_date)
		frappe.db.commit()
		return result

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def undo_cash_deposit(journal_entry=None, sid=None):
	def run():
		_require_finance(sid)
		if not journal_entry:
			frappe.throw(_("journal_entry is required"))
		result = cancel_cash_deposit(journal_entry)
		frappe.db.commit()
		return result

	return _api(run)
