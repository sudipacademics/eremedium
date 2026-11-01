"""
Phase 121.1 — payment core.

- HEC Payment Settings: provider per scope (Razorpay today, ICICI once its adapter ships) and the account map.
- HEC Payment Intent: one row per provider order, completed by checkout, the Razorpay webhook or the poller.
- Books: Journal Entries for wallet top-ups and FFMS fees/deposits, keyed by hec_payment_key (idempotent).
- Backfill of paid patient orders that never got a Payment Entry.
- Bank statement import (CSV / XLS / XLSX) into ERPNext Bank Transactions with reference matching.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import re
from datetime import date, datetime, timedelta
from html.parser import HTMLParser

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, flt, getdate, now_datetime, today

SETTINGS_DT = "HEC Payment Settings"
INTENT_DT = "HEC Payment Intent"
SCOPES = ("patient_checkout", "subscriptions", "patient_wallet", "b2b_wallet", "ffms_fees")
# Completed by clinical_phase135_uberdoc; added to the Select by phase 132 ensure_payment_scopes (no settings field).
UBERDOC_SCOPES = ("uberdoc_consult", "uberdoc_clinic_session", "program_enrollment")
FINANCE_ROLES = {"System Manager", "Health System Admin", "Accounts Manager", "Accounts User"}
ICICI_ADAPTERS: dict = {}

ACCOUNT_PLAN = (
	("razorpay_clearing_account", "Razorpay Clearing", "Bank Accounts", "Bank"),
	("franchisee_wallet_account", "Franchisee Wallet Liability", "Current Liabilities", ""),
	("patient_wallet_account", "Patient Wallet Liability", "Current Liabilities", ""),
	("security_deposit_account", "Franchise Security Deposit", "Current Liabilities", ""),
	("franchise_fee_income_account", "Franchise Fee Income", "Direct Income", "Income Account"),
	("application_fee_income_account", "Franchise Application Fee Income", "Direct Income", "Income Account"),
)
BANK_MODES = ("Wire Transfer", "Cheque", "Bank Draft", "Credit Card", "UPI")
FFMS_INCOME_FIELD = {
	"application_fee": "application_fee_income_account",
	"franchise_fee": "franchise_fee_income_account",
	"fofo_one_time_fee": "franchise_fee_income_account",
	"security_deposit": "security_deposit_account",
}
POLL_MIN_AGE_MINUTES = 5
POLL_MAX_AGE_HOURS = 72


# --------------------------------------------------------------------------- settings / setup


def _doctype_ready(name):
	return bool(frappe.db.exists("DocType", name))


def payment_settings():
	if not _doctype_ready(SETTINGS_DT):
		return frappe._dict()
	return frappe.get_cached_doc(SETTINGS_DT)


def icici_available():
	"""True once an ICICI adapter is implemented and its credentials are present (Phase 121.2+)."""
	return bool(ICICI_ADAPTERS)


def provider_for(scope):
	chosen = cstr(payment_settings().get(f"provider_{scope}") or "Razorpay")
	if chosen == "ICICI" and icici_available():
		return "ICICI"
	return "Razorpay"


def _main_company():
	names = frappe.get_all("Company", pluck="name", order_by="creation asc")
	for name in names:
		if "(demo)" not in name.lower():
			return name
	return names[0] if names else None


def sales_company():
	"""Company for new invoices, orders and payments (HEC Payment Settings, else the first non-demo company)."""
	company = cstr(payment_settings().get("company"))
	if company and frappe.db.exists("Company", company):
		return company
	return _main_company() or frappe.defaults.get_global_default("company")


def _ensure_account(company, account_name, parent_name, account_type):
	existing = frappe.db.get_value("Account", {"company": company, "account_name": account_name, "is_group": 0}, "name")
	if existing:
		return existing
	parent = frappe.db.get_value("Account", {"company": company, "account_name": parent_name, "is_group": 1}, "name")
	if not parent:
		return None
	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": account_name,
			"parent_account": parent,
			"company": company,
			"is_group": 0,
			"account_type": account_type or "",
			"account_currency": frappe.db.get_value("Company", company, "default_currency") or "INR",
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_mode_of_payment(name, mop_type="Bank"):
	if not frappe.db.exists("Mode of Payment", name):
		frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": name, "type": mop_type, "enabled": 1}).insert(
			ignore_permissions=True
		)


def _ensure_mop_account(mode, company, account):
	if not account or not frappe.db.exists("Mode of Payment", mode):
		return False
	doc = frappe.get_doc("Mode of Payment", mode)
	if any(row.company == company for row in doc.accounts):
		return False
	doc.append("accounts", {"company": company, "default_account": account})
	doc.save(ignore_permissions=True)
	return True


def _ensure_bank_account(company, gl_account):
	if not gl_account:
		return None
	existing = frappe.db.get_value("Bank Account", {"account": gl_account, "is_company_account": 1}, "name")
	if existing:
		return existing
	stale = frappe.db.get_value("Bank Account", {"account_name": "ICICI Current", "bank": "ICICI Bank"}, ["name", "company"], as_dict=True)
	if stale and stale.company != company and not frappe.db.exists("Bank Transaction", {"bank_account": stale.name}):
		frappe.db.set_value("Bank Account", stale.name, {"company": company, "account": gl_account})
		return stale.name
	if not frappe.db.exists("Bank", "ICICI Bank"):
		frappe.get_doc({"doctype": "Bank", "bank_name": "ICICI Bank"}).insert(ignore_permissions=True)
	doc = frappe.get_doc(
		{
			"doctype": "Bank Account",
			"account_name": "ICICI Current",
			"bank": "ICICI Bank",
			"account": gl_account,
			"is_company_account": 1,
			"company": company,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	field = {
		"fieldname": "hec_payment_key",
		"label": "HEC Payment Key",
		"fieldtype": "Data",
		"read_only": 1,
		"no_copy": 1,
		"search_index": 1,
		"insert_after": "remarks",
	}
	create_custom_fields(
		{
			"Payment Entry": [dict(field, insert_after="reference_date")],
			"Journal Entry": [dict(field, insert_after="user_remark")],
		},
		update=True,
	)


def setup_phase121_1():
	"""Idempotent: accounts, modes of payment, bank account, custom fields and settings defaults."""
	_ensure_custom_fields()
	settings = frappe.get_doc(SETTINGS_DT)
	# A new Single inherits the user's default company (the demo one) for its Link field.
	if settings.company and "(demo)" in settings.company.lower() and _main_company() != settings.company:
		settings.company = None
	company = cstr(settings.company) or _main_company()
	if not company:
		return {"company": None}
	summary = {"company": company, "accounts": {}, "mop_accounts": []}
	for field in ("collection_bank_account", "cash_account"):
		if settings.get(field) and frappe.db.get_value("Account", settings.get(field), "company") != company:
			settings.set(field, None)
	if settings.bank_account and frappe.db.get_value("Bank Account", settings.bank_account, "company") != company:
		settings.bank_account = None
	for field, account_name, parent_name, account_type in ACCOUNT_PLAN:
		if settings.get(field) and frappe.db.get_value("Account", settings.get(field), "company") == company:
			continue
		name = _ensure_account(company, account_name, parent_name, account_type)
		summary["accounts"][field] = name
		if name:
			settings.set(field, name)
	company_row = frappe.db.get_value("Company", company, ["default_bank_account", "default_cash_account"], as_dict=True)
	if not settings.company:
		settings.company = company
	if not settings.collection_bank_account:
		settings.collection_bank_account = company_row.default_bank_account or frappe.db.get_value(
			"Account", {"company": company, "account_name": "Bank Account", "is_group": 0}, "name"
		)
	if not settings.cash_account:
		settings.cash_account = company_row.default_cash_account or frappe.db.get_value(
			"Account", {"company": company, "account_name": "Cash", "is_group": 0}, "name"
		)
	if not settings.bank_account:
		settings.bank_account = _ensure_bank_account(company, settings.collection_bank_account)
	for scope in SCOPES:
		if not settings.get(f"provider_{scope}"):
			settings.set(f"provider_{scope}", "Razorpay")
	if settings.meta.has_field("hub_receipts_from") and not settings.get("hub_receipts_from"):
		settings.hub_receipts_from = today()
	for field, account_name in (
		("temporary_opening_account", "Temporary Opening"),
		("franchise_commission_account", "Commission on Sales"),
		("promo_credit_account", "Marketing Expenses"),
	):
		if settings.meta.has_field(field) and not settings.get(field):
			settings.set(field, frappe.db.get_value("Account", {"company": company, "account_name": account_name, "is_group": 0}, "name"))
	if settings.meta.has_field("books_excluded_hubs") and not settings.get("books_excluded_hubs") and frappe.db.exists("Franchisee Profile", "HUB001"):
		settings.books_excluded_hubs = "HUB001"
	if settings.meta.has_field("patient_wallet_books_from") and not settings.get("patient_wallet_books_from"):
		settings.patient_wallet_books_from = now_datetime()
	settings.flags.ignore_permissions = True
	settings.save()
	for account_name, parent_name, account_type in (
		("Bank Charges", "Indirect Expenses", "Chargeable"),
		("Interest Income", "Indirect Income", "Income Account"),
	):
		_ensure_account(company, account_name, parent_name, account_type)

	_ensure_mode_of_payment("Razorpay", "Bank")
	_ensure_mode_of_payment("UPI", "Bank")
	if _ensure_mop_account("Razorpay", company, settings.razorpay_clearing_account):
		summary["mop_accounts"].append("Razorpay")
	for mode in BANK_MODES:
		if _ensure_mop_account(mode, company, settings.collection_bank_account):
			summary["mop_accounts"].append(mode)
	if _ensure_mop_account("Cash", company, settings.cash_account):
		summary["mop_accounts"].append("Cash")
	frappe.clear_document_cache(SETTINGS_DT, SETTINGS_DT)
	return summary


# --------------------------------------------------------------------------- intents


def record_intent(scope, order_id, amount, reference_doctype=None, reference_name=None, party_type=None, party=None):
	"""Log a provider order so the webhook / poller can complete it if the browser never comes back."""
	if not order_id or not _doctype_ready(INTENT_DT):
		return None
	try:
		existing = frappe.db.get_value(INTENT_DT, {"provider_order_id": order_id}, "name")
		if existing:
			return existing
		doc = frappe.get_doc(
			{
				"doctype": INTENT_DT,
				"scope": scope,
				"provider": provider_for(scope),
				"status": "Created",
				"amount": flt(amount),
				"provider_order_id": order_id,
				"reference_doctype": reference_doctype,
				"reference_name": reference_name,
				"party_type": party_type,
				"party": party,
			}
		)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return doc.name
	except Exception:
		frappe.log_error(title="record_payment_intent", message=frappe.get_traceback())
		return None


def intent_for_order(order_id):
	if not order_id or not _doctype_ready(INTENT_DT):
		return None
	return frappe.db.get_value(
		INTENT_DT,
		{"provider_order_id": order_id},
		["name", "scope", "status", "amount", "reference_doctype", "reference_name", "party_type", "party", "attempts"],
		as_dict=True,
	)


def wallet_stash_from_intent(order_id, scope):
	"""Fallback for wallet verify when the Redis order stash has expired."""
	intent = intent_for_order(order_id)
	if not intent or intent.scope != scope or not intent.party:
		return None
	key = "franchisee_id" if scope == "b2b_wallet" else "patient_id"
	return {key: intent.party, "amount": flt(intent.amount)}


def mark_intent_paid(order_id, payment_id, via="Checkout"):
	intent = intent_for_order(order_id)
	if not intent or intent.status == "Paid":
		return
	frappe.db.set_value(
		INTENT_DT,
		intent.name,
		{"status": "Paid", "provider_payment_id": payment_id, "completed_via": via, "completed_at": now_datetime()},
	)


def _note_intent(intent_name, event=None, error=None, failed=False, status=None):
	values = {}
	if event:
		values["last_event"] = cstr(event)[:1000]
	if error:
		values["last_error"] = cstr(error)[:1000]
	if failed:
		values["attempts"] = cint(frappe.db.get_value(INTENT_DT, intent_name, "attempts")) + 1
	if status:
		values["status"] = status
	if values:
		frappe.db.set_value(INTENT_DT, intent_name, values)


def complete_intent(order_id, payment_id, via, event=None):
	"""Complete a provider order server-side (webhook / poller). Safe to repeat."""
	from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import confirm_payment

	intent = intent_for_order(order_id)
	if not intent:
		return {"status": "unknown_order"}
	if intent.status == "Paid":
		return {"status": "already_paid", "intent": intent.name}
	check = confirm_payment(order_id, payment_id, expected_amount_paise=int(round(flt(intent.amount) * 100)))
	if not check.get("ok") or not check.get("checked"):
		_note_intent(intent.name, event=event, error=f"{via}: {check.get('reason') or 'not confirmed'}")
		frappe.db.commit()
		return {"status": "not_confirmed", "reason": check.get("reason"), "intent": intent.name}

	previous_user = frappe.session.user
	try:
		frappe.set_user("Administrator")
		if intent.scope in ("patient_checkout", "subscriptions"):
			from health_ecosystem_core.health_ecosystem_core.api import _finalize_checkout_payment

			result = _finalize_checkout_payment(
				intent.reference_doctype, intent.reference_name, payment_id, order_id=order_id, via=via
			)
			if result.get("already_verified") and not result.get("same_payment"):
				_note_intent(intent.name, event=event, error=f"{via}: document already paid by another payment", status="Rejected")
				frappe.db.commit()
				return {"status": "document_already_paid", "intent": intent.name}
		elif intent.scope == "b2b_wallet":
			from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import complete_wallet_razorpay_credit

			result = complete_wallet_razorpay_credit(intent.party, flt(intent.amount), payment_id, order_id=order_id)
		elif intent.scope == "patient_wallet":
			from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
				complete_patient_wallet_razorpay_credit,
			)

			result = complete_patient_wallet_razorpay_credit(intent.party, flt(intent.amount), payment_id, order_id=order_id)
		elif intent.scope in UBERDOC_SCOPES:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc import complete_uberdoc_intent

			result = complete_uberdoc_intent(intent, order_id, payment_id, via)
		else:
			return {"status": "unsupported_scope", "intent": intent.name}
		mark_intent_paid(order_id, payment_id, via)
		if event:
			_note_intent(intent.name, event=event)
		frappe.db.commit()
		return {"status": "completed", "intent": intent.name, "result": result}
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title=f"complete_intent {order_id}", message=frappe.get_traceback())
		_note_intent(intent.name, event=event, error=f"{via}: completion failed, see Error Log")
		frappe.db.commit()
		return {"status": "error", "intent": intent.name}
	finally:
		frappe.set_user(previous_user)


# --------------------------------------------------------------------------- Razorpay webhook + poller


def _webhook_secret():
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_razorpay_webhook_secret

	return cstr(get_razorpay_webhook_secret() or "").strip()


@frappe.whitelist(allow_guest=True, methods=["POST"])
def razorpay_webhook():
	"""Razorpay → payment.captured / order.paid / payment.failed. Signed with the webhook secret."""
	secret = _webhook_secret()
	if not secret:
		frappe.local.response["http_status_code"] = 503
		return {"status": "error", "message": "Webhook secret not configured"}
	raw = frappe.request.get_data() or b""
	signature = cstr(frappe.get_request_header("X-Razorpay-Signature")).strip()
	expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
	if not signature or not hmac.compare_digest(expected, signature):
		frappe.local.response["http_status_code"] = 401
		return {"status": "error", "message": "Invalid signature"}
	try:
		body = json.loads(raw.decode("utf-8") or "{}")
	except ValueError:
		frappe.local.response["http_status_code"] = 400
		return {"status": "error", "message": "Invalid JSON"}

	event = cstr(body.get("event"))
	payment = ((body.get("payload") or {}).get("payment") or {}).get("entity") or {}
	order_id = cstr(payment.get("order_id"))
	payment_id = cstr(payment.get("id"))
	summary = f"{event} {payment_id} {payment.get('status') or ''} {payment.get('method') or ''}".strip()
	if event in ("payment.captured", "order.paid") and order_id and payment_id:
		result = complete_intent(order_id, payment_id, "Webhook", event=summary)
	elif event == "payment.failed" and order_id:
		intent = intent_for_order(order_id)
		if intent and intent.status != "Paid":
			reason = cstr(payment.get("error_description") or payment.get("error_reason") or "")
			_note_intent(intent.name, event=summary, error=reason, failed=True)
			frappe.db.commit()
		result = {"status": "noted"}
	else:
		result = {"status": "ignored"}
	return {"status": "success", "data": {"event": event, **result}}


def _razorpay_ready():
	from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
		get_razorpay_key_id,
		get_razorpay_key_secret,
		razorpay_sandbox_active,
	)

	return bool(get_razorpay_key_id() and get_razorpay_key_secret()) and not razorpay_sandbox_active()


def poll_pending_intents(limit=40):
	"""Scheduler (every 10 min): recover Razorpay payments whose checkout never reported back.

	Also retries platform billing for hub collections the franchisee wallet could not cover earlier.
	"""
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_hub_receipts import bill_pending_hub_collections

		bill_pending_hub_collections()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="bill_pending_hub_collections", message=frappe.get_traceback())
	if not _doctype_ready(INTENT_DT) or not cint(payment_settings().get("poller_enabled") or 0) or not _razorpay_ready():
		return {"checked": 0}
	from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import RazorpayUnreachable, _get

	now = now_datetime()
	expire_before = add_to_date(now, hours=-POLL_MAX_AGE_HOURS)
	frappe.db.sql(
		f"update `tab{INTENT_DT}` set status='Expired' where status='Created' and provider='Razorpay' and creation < %s",
		(expire_before,),
	)
	rows = frappe.get_all(
		INTENT_DT,
		filters={
			"status": "Created",
			"provider": "Razorpay",
			"scope": ["in", ["patient_checkout", "subscriptions", "patient_wallet", "b2b_wallet", *UBERDOC_SCOPES]],
			"creation": ["between", [expire_before, add_to_date(now, minutes=-POLL_MIN_AGE_MINUTES)]],
		},
		fields=["name", "provider_order_id"],
		order_by="modified asc",
		limit=cint(limit),
	)
	completed = 0
	for row in rows:
		try:
			payments = (_get(f"/orders/{row.provider_order_id}/payments") or {}).get("items") or []
		except RazorpayUnreachable:
			break
		captured = [p for p in payments if cstr(p.get("status")) == "captured"]
		if captured:
			result = complete_intent(row.provider_order_id, cstr(captured[0].get("id")), "Poller")
			completed += 1 if result.get("status") == "completed" else 0
		else:
			frappe.db.set_value(INTENT_DT, row.name, "modified", now, update_modified=False)
	frappe.db.commit()
	return {"checked": len(rows), "completed": completed}


# --------------------------------------------------------------------------- books


def _posting_date(value=None):
	if not value:
		return getdate(today())
	try:
		parsed = getdate(cstr(value)[:10])
	except Exception:
		return getdate(today())
	return min(parsed, getdate(today()))


def post_journal(key, amount, debit_account, credit_account, remark, posting_date=None, reference_no=None, company=None):
	"""Submitted two-line Journal Entry, unique per key. Returns the JE name."""
	amount = flt(amount, 2)
	if not key or amount <= 0 or not debit_account or not credit_account:
		return None
	existing = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
	if existing:
		return existing
	company = company or frappe.db.get_value("Account", debit_account, "company") or sales_company()
	posting = _posting_date(posting_date)
	account_type = frappe.db.get_value("Account", debit_account, "account_type")
	voucher_type = {"Bank": "Bank Entry", "Cash": "Cash Entry"}.get(account_type, "Journal Entry")
	cost_center = frappe.db.get_value("Company", company, "cost_center")
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": voucher_type,
			"company": company,
			"posting_date": posting,
			"cheque_no": cstr(reference_no or key)[:140] if voucher_type == "Bank Entry" else None,
			"cheque_date": posting if voucher_type == "Bank Entry" else None,
			"user_remark": remark,
			"hec_payment_key": key,
			"accounts": [
				{"account": debit_account, "debit_in_account_currency": amount, "cost_center": cost_center},
				{"account": credit_account, "credit_in_account_currency": amount, "cost_center": cost_center},
			],
		}
	)
	je.flags.ignore_permissions = True
	je.insert(ignore_permissions=True)
	je.submit()
	return je.name


def _receipt_account(source):
	settings = payment_settings()
	source = cstr(source).lower()
	if source in ("razorpay", "gateway", "online"):
		return settings.get("razorpay_clearing_account")
	if source == "cash":
		return settings.get("cash_account")
	return settings.get("collection_bank_account")


def book_wallet_topup(kind, party, amount, reference, source="razorpay", posting_date=None):
	"""Dr receipt account, Cr wallet liability. kind: b2b | patient."""
	settings = payment_settings()
	liability = settings.get("franchisee_wallet_account" if kind == "b2b" else "patient_wallet_account")
	if not liability:
		return None
	label = "Franchisee" if kind == "b2b" else "Patient"
	try:
		return post_journal(
			f"WALLET-{kind}-{reference}",
			amount,
			_receipt_account(source),
			liability,
			f"{label} wallet top-up {party} via {source} ({reference})",
			posting_date=posting_date,
			reference_no=reference,
		)
	except Exception:
		frappe.log_error(title="book_wallet_topup", message=frappe.get_traceback())
		return None


def _ffms_source(method):
	method = cstr(method).lower()
	if method in ("gateway", "razorpay", "online"):
		return "razorpay"
	if method == "cash":
		return "cash"
	return "bank"


@frappe.whitelist(allow_guest=True, methods=["POST"])
def post_ffms_payment(hec_payload=None, **kwargs):
	"""FFMS HMAC bridge: book one verified FFMS payment (fee → income, deposit → liability). Idempotent."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import verify_rfms_bridge_signature

	raw = hec_payload if hec_payload is not None else frappe.form_dict.get("hec_payload")
	raw = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else cstr(raw)
	try:
		verify_rfms_bridge_signature(raw)
	except frappe.AuthenticationError as exc:
		frappe.local.response["http_status_code"] = 401
		return {"status": "error", "message": cstr(exc)}
	try:
		payload = json.loads(raw)
	except ValueError:
		frappe.local.response["http_status_code"] = 400
		return {"status": "error", "message": "hec_payload must be JSON"}
	if payload.get("action") != "post_ffms_payment":
		frappe.local.response["http_status_code"] = 400
		return {"status": "error", "message": "Unexpected action"}

	application_id = cstr(payload.get("application_id")).strip()
	payment_key = cstr(payload.get("payment_key")).strip()
	receipt = cstr(payload.get("receipt_number")).strip()
	amount = flt(payload.get("amount"))
	income_field = FFMS_INCOME_FIELD.get(payment_key)
	if not (application_id and receipt and amount > 0 and income_field):
		frappe.local.response["http_status_code"] = 400
		return {"status": "error", "message": "application_id, receipt_number, amount and a known payment_key are required"}

	settings = payment_settings()
	credit_account = settings.get(income_field)
	source = _ffms_source(payload.get("method"))
	debit_account = _receipt_account(source)
	if not credit_account or not debit_account:
		frappe.local.response["http_status_code"] = 409
		return {"status": "error", "message": "HEC Payment Settings accounts are not configured"}

	key = f"FFMS-{application_id}-{payment_key}-{receipt}"[:140]
	reference = cstr(payload.get("transaction_reference")).strip() or receipt
	remark = (
		f"FFMS {cstr(payload.get('application_number'))} {cstr(payload.get('applicant_name'))} — "
		f"{cstr(payload.get('payment_label') or payment_key)} via {cstr(payload.get('method') or source)}; "
		f"receipt {receipt}; ref {reference}"
	)
	previous_user = frappe.session.user
	try:
		frappe.set_user("Administrator")
		existed = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
		name = existed or post_journal(
			key, amount, debit_account, credit_account, remark, posting_date=payload.get("paid_at"), reference_no=reference
		)
		frappe.db.commit()
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="post_ffms_payment", message=frappe.get_traceback())
		frappe.local.response["http_status_code"] = 500
		return {"status": "error", "message": cstr(exc)[:300] or "Posting failed"}
	finally:
		frappe.set_user(previous_user)
	return {"status": "success", "data": {"journal_entry": name, "already_posted": bool(existed), "key": key}}


# --------------------------------------------------------------------------- backfill of patient payments


BACKFILL_DOCTYPES = ("Customer TRF", "Pharmacy Order", "Doctor Appointment")


def _existing_payment_entry(payment_id):
	return frappe.db.get_value(
		"Payment Entry", {"docstatus": 1, "reference_no": payment_id}, "name"
	) or frappe.db.get_value("Payment Entry", {"docstatus": 1, "hec_payment_key": f"PAY-{payment_id}"}, "name")


def _razorpay_payment(payment_id):
	from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import _get

	return _get(f"/payments/{payment_id}")


def _offline_date(payment_id):
	match = re.search(r"(\d{14})$", cstr(payment_id))
	if not match:
		return None
	try:
		return datetime.strptime(match.group(1), "%Y%m%d%H%M%S").date()
	except ValueError:
		return None


def backfill_patient_payments(dry_run=1, limit=500):
	"""Post Payment Entries for paid orders that have none. Razorpay ids are checked live first."""
	from health_ecosystem_core.health_ecosystem_core.api import _create_payment_entry, _payable_amount

	dry_run = cint(dry_run)
	report = {"posted": [], "skipped": [], "errors": [], "dry_run": bool(dry_run)}
	candidates = []
	for doctype in BACKFILL_DOCTYPES:
		fields = ["name", "payment_id"]
		for rows in frappe.get_all(
			doctype, filters={"razorpay_payment_status": "Paid", "payment_id": ["is", "set"]}, fields=fields, limit=cint(limit)
		):
			candidates.append((doctype, rows.name, cstr(rows.payment_id)))
	for row in frappe.get_all(
		"Health Subscription",
		filters={"status": "Active", "razorpay_subscription_id": ["like", "pay_%"]},
		fields=["name", "razorpay_subscription_id"],
		limit=cint(limit),
	):
		candidates.append(("Health Subscription", row.name, cstr(row.razorpay_subscription_id)))

	previous_user = frappe.session.user
	frappe.set_user("Administrator")
	try:
		for doctype, name, payment_id in candidates:
			if _existing_payment_entry(payment_id):
				continue
			doc = frappe.get_doc(doctype, name)
			amount = _payable_amount(doc)
			posting = None
			if payment_id.startswith("pay_"):
				payment = _razorpay_payment(payment_id)
				if not payment or cstr(payment.get("status")) != "captured":
					report["skipped"].append({"doc": f"{doctype} {name}", "payment_id": payment_id, "reason": "not a captured live Razorpay payment"})
					continue
				paid = flt(payment.get("amount")) / 100
				if amount and abs(paid - amount) > 1:
					report["skipped"].append({"doc": f"{doctype} {name}", "payment_id": payment_id, "reason": f"Razorpay amount {paid} ≠ order {amount}"})
					continue
				amount = paid
				posting = datetime.fromtimestamp(cint(payment.get("created_at"))).date() if payment.get("created_at") else None
				mode_kind = "razorpay"
			elif payment_id.startswith("offline-"):
				posting = _offline_date(payment_id)
				mode_kind = "cash"
			else:
				report["skipped"].append({"doc": f"{doctype} {name}", "payment_id": payment_id, "reason": "test or unknown payment id"})
				continue
			if amount <= 0:
				report["skipped"].append({"doc": f"{doctype} {name}", "payment_id": payment_id, "reason": "zero amount"})
				continue
			if doctype == "Health Subscription":
				doc.patient_name = frappe.db.get_value("User", doc.user, "full_name") or doc.user
			savepoint = f"bf_{frappe.generate_hash(length=8)}"
			frappe.db.savepoint(savepoint)
			try:
				pe = _create_payment_entry(
					doc,
					amount,
					payment_id,
					sales_invoice=getattr(doc, "sales_invoice", None),
					mode_kind=mode_kind,
					remarks=f"Backfill {mode_kind} payment {payment_id} ({doctype} {name})",
					posting_date=posting,
				)
				report["posted"].append(
					{"doc": f"{doctype} {name}", "payment_id": payment_id, "amount": amount, "payment_entry": pe.name, "company": pe.company}
				)
				if dry_run:
					frappe.db.rollback(save_point=savepoint)
			except Exception as exc:
				frappe.db.rollback(save_point=savepoint)
				report["errors"].append({"doc": f"{doctype} {name}", "payment_id": payment_id, "error": cstr(exc)[:300]})
		if dry_run:
			frappe.db.rollback()
		else:
			frappe.db.commit()
	finally:
		frappe.set_user(previous_user)
	report["totals"] = {
		"posted": len(report["posted"]),
		"posted_amount": round(sum(flt(r["amount"]) for r in report["posted"]), 2),
		"skipped": len(report["skipped"]),
		"errors": len(report["errors"]),
	}
	return report


# --------------------------------------------------------------------------- bank statement import + matching


HEADER_KEYS = {
	"date": ("value date", "transaction date", "txn date", "txn posted date", "tran date", "posting date", "date"),
	"description": ("transaction remarks", "remarks", "description", "narration", "particulars", "details"),
	"reference": (
		"cheque number",
		"cheque no",
		"chequeno",
		"chq no",
		"chq./ref.no",
		"ref no",
		"reference",
		"utr",
		"transaction id",
		"tran id",
		"chq",
	),
	"withdrawal": ("withdrawal amount", "withdrawal", "debit amount", "debit", "dr amount"),
	"deposit": ("deposit amount", "deposit", "credit amount", "credit", "cr amount"),
	"amount": ("transaction amount", "amount"),
	"drcr": ("cr/dr", "dr/cr", "type"),
	"balance": ("balance", "available balance"),
}
DATE_FORMATS = (
	"%d/%m/%Y",
	"%d-%m-%Y",
	"%d-%b-%Y",
	"%d/%b/%Y",
	"%d %b %Y",
	"%d %B %Y",
	"%d/%m/%y",
	"%d-%m-%y",
	"%Y-%m-%d",
	"%d.%m.%Y",
	"%d-%b-%y",
)
SETTLEMENT_WORDS = ("RAZORPAY", "RZP")


class _TableParser(HTMLParser):
	"""Rows of every <tr> in an HTML document (banks often serve HTML tables as .xls)."""

	def __init__(self):
		super().__init__()
		self.rows, self._row, self._cell = [], None, None

	def handle_starttag(self, tag, attrs):
		if tag == "tr":
			self._row = []
		elif tag in ("td", "th") and self._row is not None:
			self._cell = []

	def handle_endtag(self, tag):
		if tag in ("td", "th") and self._row is not None and self._cell is not None:
			self._row.append(" ".join("".join(self._cell).split()))
			self._cell = None
		elif tag == "tr" and self._row is not None:
			self.rows.append(self._row)
			self._row = None

	def handle_data(self, data):
		if self._cell is not None:
			self._cell.append(data)


def _cell(value):
	if value is None:
		return ""
	if isinstance(value, float) and value.is_integer():
		return str(int(value))
	return cstr(value).strip()


def _rows_from_file(filename, content):
	name = cstr(filename).lower()
	if content.lstrip()[:1] == b"<":
		parser = _TableParser()
		parser.feed(content.decode("utf-8", errors="replace"))
		return parser.rows
	if name.endswith(".xlsx"):
		from openpyxl import load_workbook

		sheet = load_workbook(io.BytesIO(content), read_only=True, data_only=True).active
		return [list(row) for row in sheet.iter_rows(values_only=True)]
	if name.endswith(".xls"):
		import xlrd

		book = xlrd.open_workbook(file_contents=content)
		sheet = book.sheet_by_index(0)
		rows = []
		for r in range(sheet.nrows):
			row = []
			for c in range(sheet.ncols):
				cell = sheet.cell(r, c)
				if cell.ctype == xlrd.XL_CELL_DATE:
					row.append(xlrd.xldate_as_datetime(cell.value, book.datemode))
				else:
					row.append(cell.value)
			rows.append(row)
		return rows
	text = content.decode("utf-8-sig", errors="replace")
	return list(csv.reader(io.StringIO(text)))


def _header_map(row):
	cells = [_cell(c).lower() for c in row]
	mapping = {}
	for key, candidates in HEADER_KEYS.items():
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


def _parse_date(value):
	if isinstance(value, datetime):
		return value.date()
	if isinstance(value, date):
		return value
	text = _cell(value)
	if not text:
		return None
	for candidate in (text, text.split(" ")[0]):
		for fmt in DATE_FORMATS:
			try:
				return datetime.strptime(candidate, fmt).date()
			except ValueError:
				continue
	return None


def _parse_amount(value):
	if isinstance(value, (int, float)):
		return abs(flt(value))
	text = re.sub(r"[^\d.\-]", "", _cell(value).replace(",", ""))
	try:
		return abs(float(text)) if text not in ("", "-", ".") else 0.0
	except ValueError:
		return 0.0


def parse_statement(filename, content):
	rows = _rows_from_file(filename, content)
	header_index, mapping = None, {}
	for index, row in enumerate(rows[:40]):
		candidate = _header_map(row)
		if "date" in candidate and ("deposit" in candidate or "amount" in candidate):
			header_index, mapping = index, candidate
			break
	if header_index is None:
		frappe.throw(_("Could not find the statement header row (needs a date column and deposit/credit or amount columns)."))
	parsed = []
	for row in rows[header_index + 1 :]:
		if not row or all(_cell(c) == "" for c in row):
			continue

		def get(key):
			index = mapping.get(key)
			return row[index] if index is not None and index < len(row) else None

		txn_date = _parse_date(get("date"))
		if not txn_date:
			continue
		deposit = _parse_amount(get("deposit")) if "deposit" in mapping else 0.0
		withdrawal = _parse_amount(get("withdrawal")) if "withdrawal" in mapping else 0.0
		if "deposit" not in mapping and "amount" in mapping:
			amount = _parse_amount(get("amount"))
			if _cell(get("drcr")).upper().startswith("C"):
				deposit = amount
			else:
				withdrawal = amount
		if not deposit and not withdrawal:
			continue
		parsed.append(
			{
				"date": txn_date,
				"description": _cell(get("description"))[:1000],
				"reference": _cell(get("reference"))[:140],
				"deposit": round(deposit, 2),
				"withdrawal": round(withdrawal, 2),
				"balance": _cell(get("balance")),
			}
		)
	return parsed


def _require_finance(sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _require_mobile_auth, _user_roles

	if sid:
		_require_mobile_auth(sid)
	if frappe.session.user in (None, "Guest"):
		frappe.throw(_("Please sign in"), frappe.PermissionError)
	if frappe.session.user != "Administrator" and not FINANCE_ROLES & set(_user_roles() or []):
		frappe.throw(_("Finance access required"), frappe.PermissionError)


def _api(fn):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _success

	try:
		return _success(fn())
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"), 400)
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase121_payment_core", message=frappe.get_traceback())
		return _error(_("Something went wrong. The error was logged for the admin."), 500)


def _statement_bank_account(bank_account=None):
	name = cstr(bank_account).strip() or cstr(payment_settings().get("bank_account"))
	if not name or not frappe.db.exists("Bank Account", name):
		frappe.throw(_("Set the statement bank account in HEC Payment Settings first."))
	return name


def _tokens(*texts):
	found = set()
	for text in texts:
		for token in re.findall(r"[A-Za-z0-9]{6,}", cstr(text)):
			if any(ch.isdigit() for ch in token):
				found.add(token.upper())
	return found


def suggest_matches(bank_transaction):
	"""Candidate vouchers for a statement line: reference hits first, then same amount within ±5 days."""
	bt = frappe.db.get_value(
		"Bank Transaction",
		bank_transaction,
		["name", "date", "deposit", "withdrawal", "description", "reference_number", "bank_account", "unallocated_amount"],
		as_dict=True,
	)
	if not bt:
		return []
	if flt(bt.deposit) <= 0:
		return _suggest_withdrawal_matches(bt) if flt(bt.withdrawal) > 0 else []
	gl = frappe.db.get_value("Bank Account", bt.bank_account, "account")
	amount = flt(bt.unallocated_amount) or flt(bt.deposit)
	tokens = _tokens(bt.description, bt.reference_number)
	window = (getdate(bt.date) - timedelta(days=5), getdate(bt.date) + timedelta(days=5))
	suggestions = []
	seen = set()

	def add(kind, name, voucher_amount, label, confidence):
		if (kind, name) in seen:
			return
		seen.add((kind, name))
		suggestions.append({"voucher_type": kind, "voucher_name": name, "amount": flt(voucher_amount), "label": label, "confidence": confidence})

	je_rows = frappe.db.sql(
		"""select je.name, je.cheque_no, je.posting_date, je.user_remark, jea.debit_in_account_currency amount
		from `tabJournal Entry` je join `tabJournal Entry Account` jea on jea.parent = je.name
		where je.docstatus = 1 and je.clearance_date is null and jea.account = %s and jea.debit_in_account_currency = %s""",
		(gl, amount),
		as_dict=True,
	)
	pe_rows = frappe.get_all(
		"Payment Entry",
		filters={"docstatus": 1, "clearance_date": ["is", "not set"], "paid_to": gl, "received_amount": amount},
		fields=["name", "reference_no", "posting_date", "party", "received_amount"],
	)
	for row in je_rows:
		if cstr(row.cheque_no).upper() in tokens:
			add("Journal Entry", row.name, row.amount, row.user_remark or row.cheque_no, "reference")
	for row in pe_rows:
		if cstr(row.reference_no).upper() in tokens:
			add("Payment Entry", row.name, row.received_amount, f"{row.party} · {row.reference_no}", "reference")
	for request in frappe.get_all(
		"Franchisee Wallet Topup Request",
		filters={"status": "Pending"},
		fields=["name", "franchisee", "amount", "payment_reference"],
	):
		if cstr(request.payment_reference).upper() in tokens:
			add("Franchisee Wallet Topup Request", request.name, request.amount, f"Pending top-up · {request.franchisee}", "approve_first")
	for row in je_rows:
		if window[0] <= getdate(row.posting_date) <= window[1]:
			add("Journal Entry", row.name, row.amount, row.user_remark or row.cheque_no, "amount_date")
	for row in pe_rows:
		if window[0] <= getdate(row.posting_date) <= window[1]:
			add("Payment Entry", row.name, row.received_amount, f"{row.party} · {row.reference_no}", "amount_date")
	return suggestions


def _suggest_withdrawal_matches(bt):
	gl = frappe.db.get_value("Bank Account", bt.bank_account, "account")
	amount = flt(bt.unallocated_amount) or flt(bt.withdrawal)
	tokens = _tokens(bt.description, bt.reference_number)
	window = (getdate(bt.date) - timedelta(days=5), getdate(bt.date) + timedelta(days=5))
	je_rows = frappe.db.sql(
		"""select je.name, je.cheque_no, je.posting_date, je.user_remark, jea.credit_in_account_currency amount
		from `tabJournal Entry` je join `tabJournal Entry Account` jea on jea.parent = je.name
		where je.docstatus = 1 and je.clearance_date is null and jea.account = %s and jea.credit_in_account_currency = %s""",
		(gl, amount),
		as_dict=True,
	)
	pe_rows = frappe.get_all(
		"Payment Entry",
		filters={"docstatus": 1, "clearance_date": ["is", "not set"], "paid_from": gl, "paid_amount": amount},
		fields=["name", "reference_no", "posting_date", "party", "paid_amount"],
	)
	suggestions, seen = [], set()

	def add(kind, name, voucher_amount, label, confidence):
		if (kind, name) not in seen:
			seen.add((kind, name))
			suggestions.append({"voucher_type": kind, "voucher_name": name, "amount": flt(voucher_amount), "label": label, "confidence": confidence})

	for confidence in ("reference", "amount_date"):
		for row in je_rows:
			hit = cstr(row.cheque_no).upper() in tokens if confidence == "reference" else window[0] <= getdate(row.posting_date) <= window[1]
			if hit:
				add("Journal Entry", row.name, row.amount, row.user_remark or row.cheque_no, confidence)
		for row in pe_rows:
			hit = cstr(row.reference_no).upper() in tokens if confidence == "reference" else window[0] <= getdate(row.posting_date) <= window[1]
			if hit:
				add("Payment Entry", row.name, row.paid_amount, f"{row.party or ''} · {row.reference_no or ''}", confidence)
	return suggestions


def _is_settlement_line(description):
	text = cstr(description).upper()
	return any(word in text for word in SETTLEMENT_WORDS)


def _bank_charges_account(company):
	return frappe.db.get_value("Account", {"company": company, "account_name": "Bank Charges", "is_group": 0}, "name")


def booking_accounts(bank_account=None):
	"""Ledger accounts a statement line may be booked against (no party, bank or cash accounts)."""
	bank_account = _statement_bank_account(bank_account)
	company = frappe.db.get_value("Bank Account", bank_account, "company")
	gl = frappe.db.get_value("Bank Account", bank_account, "account")
	settings = payment_settings()
	blocked = {gl} | {
		settings.get(field) for field in ("franchisee_wallet_account", "patient_wallet_account") if settings.get(field)
	}
	rows = [
		row
		for row in frappe.get_all(
			"Account",
			filters={
				"company": company,
				"is_group": 0,
				"disabled": 0,
				"account_type": ["not in", ["Receivable", "Payable", "Stock", "Fixed Asset", "Depreciation", "Accumulated Depreciation"]],
			},
			fields=["name", "root_type"],
			order_by="root_type, name",
		)
		if row.name not in blocked
	]
	return {
		"accounts": rows,
		"bank_charges_account": _bank_charges_account(company),
		"razorpay_clearing_account": settings.get("razorpay_clearing_account"),
	}


def book_statement_line(bank_transaction, kind, account=None, fee=0):
	"""Post a Journal Entry for a statement line that has no voucher yet, then reconcile it.

	kind razorpay_settlement (deposit): Dr bank, Dr bank charges (fee), Cr Razorpay Clearing (amount + fee).
	kind account: deposit Dr bank / Cr account; withdrawal Dr account / Cr bank.
	"""
	bt = frappe.get_doc("Bank Transaction", bank_transaction)
	if bt.docstatus != 1 or bt.status not in ("Unreconciled", "Pending"):
		frappe.throw(_("This statement line is already reconciled"))
	if flt(bt.allocated_amount) > 0:
		frappe.throw(_("This line is partly matched. Finish it in ERPNext's Bank Reconciliation Tool."))
	gl = frappe.db.get_value("Bank Account", bt.bank_account, "account")
	company = bt.company or frappe.db.get_value("Bank Account", bt.bank_account, "company")
	is_deposit = flt(bt.deposit) > 0
	amount = flt(bt.unallocated_amount) or flt(bt.deposit) or flt(bt.withdrawal)
	fee = flt(fee, 2)
	if amount <= 0:
		frappe.throw(_("This line has no amount"))
	if fee < 0:
		frappe.throw(_("Fee cannot be negative"))
	cost_center = frappe.db.get_value("Company", company, "cost_center")
	label = cstr(bt.description)[:200] or bt.name

	if kind == "razorpay_settlement":
		if not is_deposit:
			frappe.throw(_("A Razorpay settlement must be a deposit"))
		clearing = payment_settings().get("razorpay_clearing_account")
		if not clearing or frappe.db.get_value("Account", clearing, "company") != company:
			frappe.throw(_("Set the Razorpay clearing account in HEC Payment Settings first."))
		lines = [{"account": gl, "debit_in_account_currency": amount}]
		if fee > 0:
			charges = _bank_charges_account(company)
			if not charges:
				frappe.throw(_("No 'Bank Charges' account found for {0}").format(company))
			lines.append({"account": charges, "debit_in_account_currency": fee})
		lines.append({"account": clearing, "credit_in_account_currency": flt(amount + fee, 2)})
		remark = f"Razorpay settlement {label}"
	elif kind == "account":
		account = cstr(account).strip()
		allowed = {row.name for row in booking_accounts(bt.bank_account)["accounts"]}
		if account not in allowed:
			frappe.throw(_("Choose a valid ledger account for {0}").format(company))
		if fee:
			frappe.throw(_("A fee only applies to Razorpay settlements"))
		if is_deposit:
			lines = [{"account": gl, "debit_in_account_currency": amount}, {"account": account, "credit_in_account_currency": amount}]
		else:
			lines = [{"account": account, "debit_in_account_currency": amount}, {"account": gl, "credit_in_account_currency": amount}]
		remark = f"Bank statement line {label}"
	else:
		frappe.throw(_("Unknown booking type"))

	key = f"BANKLINE-{bt.name}"
	je_name = frappe.db.get_value("Journal Entry", {"hec_payment_key": key, "docstatus": 1}, "name")
	if not je_name:
		for line in lines:
			line["cost_center"] = cost_center
		je = frappe.get_doc(
			{
				"doctype": "Journal Entry",
				"voucher_type": "Bank Entry",
				"company": company,
				"posting_date": bt.date,
				"cheque_no": cstr(bt.reference_number or bt.name)[:140],
				"cheque_date": bt.date,
				"user_remark": remark,
				"hec_payment_key": key,
				"accounts": lines,
			}
		)
		je.flags.ignore_permissions = True
		je.insert(ignore_permissions=True)
		je.submit()
		je_name = je.name
	status = reconcile_bank_transaction(bt.name, "Journal Entry", je_name)
	return {"bank_transaction": bt.name, "journal_entry": je_name, "status": status}


def _account_balance(account):
	if not account:
		return None
	row = frappe.db.sql(
		"select coalesce(sum(debit) - sum(credit), 0) from `tabGL Entry` where account = %s and is_cancelled = 0", (account,)
	)
	return flt(row[0][0], 2) if row else 0.0


def reconcile_bank_transaction(bank_transaction, voucher_type, voucher_name):
	from erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool import reconcile_vouchers

	if voucher_type not in ("Journal Entry", "Payment Entry"):
		frappe.throw(_("Only Journal Entries and Payment Entries can be matched"))
	bt = frappe.get_doc("Bank Transaction", bank_transaction)
	amount = flt(bt.unallocated_amount) or flt(bt.deposit) or flt(bt.withdrawal)
	reconcile_vouchers(
		bank_transaction, json.dumps([{"payment_doctype": voucher_type, "payment_name": voucher_name, "amount": amount}])
	)
	return frappe.db.get_value("Bank Transaction", bank_transaction, "status")


def import_statement(filename, content, bank_account=None):
	bank_account = _statement_bank_account(bank_account)
	company = frappe.db.get_value("Bank Account", bank_account, "company")
	rows = parse_statement(filename, content)
	created, duplicates, auto_matched = [], 0, 0
	for row in rows:
		fingerprint = "|".join(
			[bank_account, cstr(row["date"]), cstr(row["deposit"]), cstr(row["withdrawal"]), row["reference"], row["description"], row["balance"]]
		)
		txn_id = "HEC-" + hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:24]
		if frappe.db.exists("Bank Transaction", {"transaction_id": txn_id}):
			duplicates += 1
			continue
		bt = frappe.get_doc(
			{
				"doctype": "Bank Transaction",
				"date": row["date"],
				"bank_account": bank_account,
				"company": company,
				"deposit": row["deposit"],
				"withdrawal": row["withdrawal"],
				"description": row["description"],
				"reference_number": row["reference"],
				"transaction_id": txn_id,
				"currency": "INR",
			}
		)
		bt.insert(ignore_permissions=True)
		bt.submit()
		created.append(bt.name)
		if row["deposit"] > 0 or row["withdrawal"] > 0:
			exact = [s for s in suggest_matches(bt.name) if s["confidence"] == "reference" and s["voucher_type"] != "Franchisee Wallet Topup Request"]
			if len(exact) == 1:
				try:
					reconcile_bank_transaction(bt.name, exact[0]["voucher_type"], exact[0]["voucher_name"])
					auto_matched += 1
				except Exception:
					frappe.log_error(title="bank auto-match", message=frappe.get_traceback())
	frappe.db.commit()
	return {"rows": len(rows), "created": len(created), "duplicates": duplicates, "auto_matched": auto_matched}


def list_unreconciled(limit=100, bank_account=None):
	bank_account = _statement_bank_account(bank_account)
	rows = frappe.get_all(
		"Bank Transaction",
		filters={"docstatus": 1, "bank_account": bank_account, "status": ["in", ["Unreconciled", "Pending"]]},
		fields=["name", "date", "deposit", "withdrawal", "description", "reference_number", "unallocated_amount", "status"],
		order_by="date desc, creation desc",
		limit=cint(limit) or 100,
	)
	for row in rows:
		row["suggestions"] = suggest_matches(row.name)
		row["settlement_hint"] = flt(row.deposit) > 0 and _is_settlement_line(row.description)
	counts = frappe.db.sql(
		"select status, count(*) n from `tabBank Transaction` where docstatus = 1 and bank_account = %s group by status",
		(bank_account,),
		as_dict=True,
	)
	clearing = payment_settings().get("razorpay_clearing_account")
	return {
		"bank_account": bank_account,
		"transactions": rows,
		"counts": {c.status: c.n for c in counts},
		"razorpay_clearing_account": clearing,
		"razorpay_clearing_balance": _account_balance(clearing),
	}


# --------------------------------------------------------------------------- whitelisted API (finance)


def _wallet_books_check(kind="franchisee"):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_wallet_books import (
			patient_wallet_books_check,
			wallet_books_check,
		)

		return patient_wallet_books_check() if kind == "patient" else wallet_books_check()
	except Exception:
		frappe.log_error(title="wallet_books_check", message=frappe.get_traceback())
		return {}


@frappe.whitelist(allow_guest=True)
def get_payment_core_status(sid=None):
	def run():
		_require_finance(sid)
		settings = payment_settings()
		intents = {}
		if _doctype_ready(INTENT_DT):
			for row in frappe.db.sql(
				f"select status, count(*) n from `tab{INTENT_DT}` group by status", as_dict=True
			):
				intents[row.status] = row.n
		return {
			"company": sales_company(),
			"providers": {scope: provider_for(scope) for scope in SCOPES},
			"icici_available": icici_available(),
			"webhook_configured": bool(_webhook_secret()),
			"bank_account": settings.get("bank_account"),
			"intents": intents,
			"wallet_books": _wallet_books_check(),
			"patient_wallet_books": _wallet_books_check("patient"),
		}

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def upload_bank_statement(filename=None, content_b64=None, bank_account=None, sid=None):
	def run():
		_require_finance(sid)
		name = cstr(filename or frappe.form_dict.get("filename")).strip()
		data = cstr(content_b64 or frappe.form_dict.get("content_b64"))
		if not name or not data:
			frappe.throw(_("Choose a statement file"))
		if not re.search(r"\.(csv|xls|xlsx)$", name.lower()):
			frappe.throw(_("Upload the statement as CSV, XLS or XLSX"))
		if "," in data[:100] and data.startswith("data:"):
			data = data.split(",", 1)[1]
		content = base64.b64decode(data)
		if len(content) > 8 * 1024 * 1024:
			frappe.throw(_("Statement file is larger than 8 MB"))
		return import_statement(name, content, bank_account)

	return _api(run)


@frappe.whitelist(allow_guest=True)
def list_bank_transactions(limit=100, bank_account=None, sid=None):
	def run():
		_require_finance(sid)
		return list_unreconciled(limit, bank_account)

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def match_bank_transaction(bank_transaction=None, voucher_type=None, voucher_name=None, sid=None):
	def run():
		_require_finance(sid)
		if not (bank_transaction and voucher_type and voucher_name):
			frappe.throw(_("bank_transaction, voucher_type and voucher_name are required"))
		status = reconcile_bank_transaction(bank_transaction, voucher_type, voucher_name)
		frappe.db.commit()
		return {"bank_transaction": bank_transaction, "status": status}

	return _api(run)


@frappe.whitelist(allow_guest=True)
def list_bank_booking_accounts(bank_account=None, sid=None):
	def run():
		_require_finance(sid)
		return booking_accounts(bank_account)

	return _api(run)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def book_bank_transaction(bank_transaction=None, kind=None, account=None, fee=0, sid=None):
	def run():
		_require_finance(sid)
		if not (bank_transaction and kind):
			frappe.throw(_("bank_transaction and kind are required"))
		result = book_statement_line(bank_transaction, kind, account, fee)
		frappe.db.commit()
		return result

	return _api(run)
