"""
Phase 121.7 — franchisee wallet balances in the books.

- One-off: correct wallet balances that drifted from their own transaction history (the July 2026 sheet import
  credited opening wallets twice), then post one opening Journal Entry per hub: Cr Franchisee Wallet Liability,
  Dr Temporary Opening (pre-system sheet hubs) or Franchise Security Deposit (hubs activated from FFMS, whose
  deposit is already booked).
- From then on: wallets opened at FFMS activation are carved out of the security deposit, and FOFO commission
  credits are booked to the commission expense account. Top-ups (121.1) and platform fees (121.6) are booked at source.
- Hubs listed in HEC Payment Settings "books_excluded_hubs" (the demo hub) never reach the books.
"""

from __future__ import annotations

import frappe
from frappe.utils import cstr, flt, get_datetime, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import payment_settings, post_journal

WALLET_TXN_DT = "Franchisee Wallet Transaction"
OPENING_REF = "OPENING-RECHARGE"
DEBIT_TYPES = ("Platform Fee", "Refund")
CORRECTION_REMARK = "Balance corrected to match wallet history (opening credit was applied twice at import)"


def excluded_hubs():
	raw = cstr(payment_settings().get("books_excluded_hubs"))
	return {part.strip() for part in raw.replace("\n", ",").split(",") if part.strip()}


def _books_from():
	value = payment_settings().get("wallet_books_from")
	return get_datetime(value) if value else None


def ledger_net(hub):
	"""Wallet balance implied by the hub's own transaction history."""
	net = 0.0
	for row in frappe.get_all(WALLET_TXN_DT, filters={"franchisee": hub}, fields=["transaction_type", "amount"]):
		amount = flt(row.amount)
		net += -abs(amount) if row.transaction_type in DEBIT_TYPES else amount
	return round(net, 2)


def _activation_opening(hub):
	"""Opening wallet credited at FFMS activation (carved out of a deposit booked by FFMS)."""
	return round(
		sum(
			flt(row.amount)
			for row in frappe.get_all(
				WALLET_TXN_DT,
				filters={"franchisee": hub, "payment_reference": OPENING_REF, "owner": "Guest"},
				fields=["amount"],
			)
		),
		2,
	)


def wallet_opening_plan():
	excluded = excluded_hubs()
	rows = []
	for hub in frappe.get_all(
		"Franchisee Profile", fields=["name", "franchise_name", "active_status", "wallet_balance"], order_by="name"
	):
		net = ledger_net(hub.name)
		balance = flt(hub.wallet_balance, 2)
		if not balance and not net:
			continue
		from_deposit = min(_activation_opening(hub.name), max(net, 0))
		rows.append(
			{
				"hub": hub.name,
				"name": hub.franchise_name,
				"status": hub.active_status,
				"balance": balance,
				"history": net,
				"correction": round(net - balance, 2),
				"opening_from_deposit": from_deposit,
				"opening_from_temporary": round(max(net, 0) - from_deposit, 2),
				"excluded": hub.name in excluded,
				"booked": bool(frappe.db.get_value("Journal Entry", {"hec_payment_key": f"OPENING-WALLET-{hub.name}", "docstatus": 1})),
			}
		)
	return rows


def _correct_balance(hub, net):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import _record_wallet_transaction

	balance = flt(frappe.db.get_value("Franchisee Profile", hub, "wallet_balance", for_update=True), 2)
	delta = round(net - balance, 2)
	if not delta:
		return None
	frappe.db.set_value("Franchisee Profile", hub, "wallet_balance", net)
	return _record_wallet_transaction(hub, "Adjustment", delta, net, remarks=CORRECTION_REMARK)


def _post_opening(row, settings):
	key = f"OPENING-WALLET-{row['hub']}"
	existing = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
	if existing:
		return existing
	liability = settings.get("franchisee_wallet_account")
	company = frappe.db.get_value("Account", liability, "company")
	cost_center = frappe.db.get_value("Company", company, "cost_center")
	lines = []
	for account, amount in (
		(settings.get("temporary_opening_account"), row["opening_from_temporary"]),
		(settings.get("security_deposit_account"), row["opening_from_deposit"]),
	):
		if flt(amount) > 0:
			if not account:
				frappe.throw(f"Opening wallet offset account missing for {row['hub']}")
			lines.append({"account": account, "debit_in_account_currency": flt(amount, 2), "cost_center": cost_center})
	total = round(sum(line["debit_in_account_currency"] for line in lines), 2)
	if total <= 0:
		return None
	lines.append({"account": liability, "credit_in_account_currency": total, "cost_center": cost_center})
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Opening Entry" if not row["opening_from_deposit"] else "Journal Entry",
			"is_opening": "Yes" if not row["opening_from_deposit"] else "No",
			"company": company,
			"posting_date": getdate(today()),
			"user_remark": f"Opening franchisee wallet {row['hub']} ({row['name']})",
			"hec_payment_key": key,
			"accounts": lines,
		}
	)
	je.flags.ignore_permissions = True
	je.insert()
	je.submit()
	return je.name


def apply_wallet_opening(dry_run=1):
	"""Correct drifted balances and post opening wallet entries. Idempotent; dry_run rolls everything back."""
	dry_run = int(dry_run or 0)
	settings = payment_settings()
	report = {"dry_run": bool(dry_run), "corrected": [], "opened": [], "skipped": [], "errors": []}
	before = wallet_books_check()
	if not settings.get("wallet_books_from") and flt(before.get("ledger")):
		report["errors"].append(
			{"hub": "*", "error": f"Wallet liability already has a balance of {before['ledger']}; opening would double count"}
		)
		report["totals"] = {"errors": 1}
		return report
	for row in wallet_opening_plan():
		if row["excluded"]:
			report["skipped"].append({"hub": row["hub"], "reason": "excluded from books"})
			continue
		savepoint = f"wo_{frappe.generate_hash(length=8)}"
		frappe.db.savepoint(savepoint)
		try:
			if row["correction"]:
				txn = _correct_balance(row["hub"], row["history"])
				report["corrected"].append({"hub": row["hub"], "from": row["balance"], "to": row["history"], "transaction": txn})
			if row["booked"]:
				report["skipped"].append({"hub": row["hub"], "reason": "opening already booked"})
				continue
			je = _post_opening(row, settings)
			report["opened"].append(
				{
					"hub": row["hub"],
					"amount": row["history"],
					"temporary_opening": row["opening_from_temporary"],
					"security_deposit": row["opening_from_deposit"],
					"journal_entry": je,
				}
			)
		except Exception as exc:
			frappe.db.rollback(save_point=savepoint)
			report["errors"].append({"hub": row["hub"], "error": cstr(exc)[:300]})
	if dry_run:
		frappe.db.rollback()
	else:
		if not report["errors"] and not settings.get("wallet_books_from"):
			frappe.db.set_single_value("HEC Payment Settings", "wallet_books_from", now_datetime())
		frappe.db.commit()
	report["totals"] = {
		"corrected": len(report["corrected"]),
		"correction_amount": round(sum(r["to"] - r["from"] for r in report["corrected"]), 2),
		"opened": len(report["opened"]),
		"opening_amount": round(sum(r["amount"] for r in report["opened"]), 2),
		"errors": len(report["errors"]),
	}
	return report


def _after_books_from(txn):
	start = _books_from()
	if not start:
		return False
	return get_datetime(frappe.db.get_value(WALLET_TXN_DT, txn, "creation")) >= start


def book_wallet_credit(txn, kind):
	"""Book a wallet credit made after the opening: kind 'activation' (Dr security deposit), 'import'
	(Dr temporary opening) or 'commission' (Dr commission expense). Idempotent per transaction."""
	if not txn or not _after_books_from(txn):
		return None
	row = frappe.db.get_value(WALLET_TXN_DT, txn, ["franchisee", "amount"], as_dict=True)
	if not row or row.franchisee in excluded_hubs() or flt(row.amount) <= 0:
		return None
	settings = payment_settings()
	debit = {
		"activation": settings.get("security_deposit_account"),
		"import": settings.get("temporary_opening_account"),
		"commission": settings.get("franchise_commission_account"),
	}.get(kind)
	label = {"activation": "opening from security deposit", "import": "opening", "commission": "FOFO commission"}.get(kind)
	try:
		return post_journal(
			f"WALLET-{kind}-{txn}",
			row.amount,
			debit,
			settings.get("franchisee_wallet_account"),
			f"Franchisee wallet {label} {row.franchisee} ({txn})",
		)
	except Exception:
		frappe.log_error(title="book_wallet_credit", message=frappe.get_traceback())
		return None


PATIENT_TXN_DT = "Patient Wallet Transaction"


def _patient_txn_booked_era(txn):
	start = payment_settings().get("patient_wallet_books_from")
	if not start:
		return False
	return get_datetime(frappe.db.get_value(PATIENT_TXN_DT, txn, "creation")) >= get_datetime(start)


def book_patient_promo_credit(txn):
	"""Promotional patient wallet credit (referral, first-order, purchase reward): Dr promo expense, Cr wallet liability."""
	if not txn or not _patient_txn_booked_era(txn):
		return None
	row = frappe.db.get_value(PATIENT_TXN_DT, txn, ["patient", "amount", "transaction_type"], as_dict=True)
	if not row or row.transaction_type != "Credit" or flt(row.amount) <= 0:
		return None
	settings = payment_settings()
	try:
		return post_journal(
			f"PWALLET-promo-{txn}",
			row.amount,
			settings.get("promo_credit_account"),
			settings.get("patient_wallet_account"),
			f"Patient wallet promotional credit {row.patient} ({txn})",
		)
	except Exception:
		frappe.log_error(title="book_patient_promo_credit", message=frappe.get_traceback())
		return None


def _spend_customer(reference_doctype, reference_name, company, patient):
	"""Customer (and invoice in the books company) the wallet spend pays for."""
	from health_ecosystem_core.health_ecosystem_core.api import _ensure_customer

	doc = frappe.db.get_value(reference_doctype, reference_name, "*", as_dict=True) or {}
	invoice = cstr(doc.get("sales_invoice"))
	if invoice:
		si = frappe.db.get_value("Sales Invoice", invoice, ["customer", "company", "docstatus"], as_dict=True)
		if si and si.docstatus == 1 and si.company == company:
			return si.customer, invoice
	order = cstr(doc.get("sales_order"))
	if order:
		customer = frappe.db.get_value("Sales Order", order, "customer")
		if customer:
			return customer, None
	name = doc.get("patient_name") or doc.get("customer_name") or frappe.db.get_value("Health Patient", patient, "patient_name")
	return _ensure_customer(cstr(name) or patient), None


def book_patient_wallet_spend(txn):
	"""Patient wallet applied to an order: Dr wallet liability, Cr the patient's receivable (against the invoice if any)."""
	from erpnext.accounts.party import get_party_account

	if not txn or not _patient_txn_booked_era(txn):
		return None
	key = f"PWALLET-spend-{txn}"
	existing = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
	if existing:
		return existing
	row = frappe.db.get_value(
		PATIENT_TXN_DT, txn, ["patient", "amount", "transaction_type", "reference_doctype", "reference_name"], as_dict=True
	)
	if not row or row.transaction_type != "Debit" or flt(row.amount) <= 0 or not row.reference_name:
		return None
	liability = payment_settings().get("patient_wallet_account")
	if not liability:
		return None
	try:
		company = frappe.db.get_value("Account", liability, "company")
		customer, invoice = _spend_customer(row.reference_doctype, row.reference_name, company, row.patient)
		receivable = get_party_account("Customer", customer, company)
		cost_center = frappe.db.get_value("Company", company, "cost_center")
		amount = flt(row.amount, 2)
		credit = {
			"account": receivable,
			"party_type": "Customer",
			"party": customer,
			"credit_in_account_currency": amount,
			"cost_center": cost_center,
		}
		if invoice:
			credit.update({"reference_type": "Sales Invoice", "reference_name": invoice})
		je = frappe.get_doc(
			{
				"doctype": "Journal Entry",
				"voucher_type": "Journal Entry",
				"company": company,
				"posting_date": getdate(today()),
				"user_remark": f"Patient wallet applied to {row.reference_doctype} {row.reference_name} ({txn})",
				"hec_payment_key": key,
				"accounts": [
					{"account": liability, "debit_in_account_currency": amount, "cost_center": cost_center},
					credit,
				],
			}
		)
		je.flags.ignore_permissions = True
		je.insert()
		je.submit()
		return je.name
	except Exception:
		frappe.log_error(title="book_patient_wallet_spend", message=frappe.get_traceback())
		return None


def patient_wallet_books_check():
	"""Patient wallet balances vs the Patient Wallet Liability ledger balance."""
	liability = payment_settings().get("patient_wallet_account")
	if not liability:
		return {}
	wallets = flt(frappe.db.sql("select sum(wallet_balance) from `tabHealth Patient`")[0][0], 2)
	ledger = flt(
		frappe.db.sql("select sum(credit - debit) from `tabGL Entry` where account=%s and is_cancelled=0", (liability,))[0][0],
		2,
	)
	return {"wallets": wallets, "ledger": ledger, "difference": round(wallets - ledger, 2)}


def wallet_books_check():
	"""Wallet balances of booked hubs vs the Franchisee Wallet Liability ledger balance."""
	settings = payment_settings()
	liability = settings.get("franchisee_wallet_account")
	if not liability:
		return {}
	excluded = excluded_hubs()
	balances = frappe.get_all("Franchisee Profile", fields=["name", "wallet_balance"])
	wallets = round(sum(flt(r.wallet_balance) for r in balances if r.name not in excluded), 2)
	ledger = flt(
		frappe.db.sql(
			"select sum(credit - debit) from `tabGL Entry` where account=%s and is_cancelled=0", (liability,)
		)[0][0],
		2,
	)
	return {
		"wallets": wallets,
		"ledger": ledger,
		"difference": round(wallets - ledger, 2),
		"opening_booked": bool(settings.get("wallet_books_from")),
	}
