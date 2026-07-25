"""Phase 75 — Patient Refer & Earn wallet (per Health Patient)."""

from __future__ import annotations

import base64
import secrets
import string

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, today

SIGNUP_CREDIT = 50.0
FIRST_ORDER_REFERRER_BONUS = 100.0
MAX_WALLET_APPLY_FRACTION = 1.0  # full balance may apply, capped by payable total


def setup_phase75():
	_ensure_wallet_doctype()
	_ensure_patient_fields()
	return {"ok": True, "phase": 75}


def _ensure_wallet_doctype():
	if frappe.db.exists("DocType", "Patient Wallet Transaction"):
		return
	# Migrate creates from JSON; this is a safety no-op if missing mid-deploy.


def _ensure_patient_fields():
	try:
		create_custom_fields(
			{
				"Health Patient": [
					{
						"fieldname": "referral_code",
						"label": "Referral Code",
						"fieldtype": "Data",
						"unique": 1,
						"insert_after": "status",
						"read_only": 1,
					},
					{
						"fieldname": "referred_by",
						"label": "Referred By",
						"fieldtype": "Link",
						"options": "Health Patient",
						"insert_after": "referral_code",
						"read_only": 1,
					},
					{
						"fieldname": "wallet_balance",
						"label": "Wallet Balance",
						"fieldtype": "Currency",
						"default": "0",
						"insert_after": "referred_by",
						"read_only": 1,
					},
					{
						"fieldname": "profile_image",
						"label": "Profile Image",
						"fieldtype": "Attach Image",
						"insert_after": "wallet_balance",
					},
					{
						"fieldname": "referral_bonus_paid",
						"label": "First-Order Referral Bonus Paid",
						"fieldtype": "Check",
						"default": "0",
						"insert_after": "profile_image",
						"read_only": 1,
					},
					{
						"fieldname": "signup_referral_credited",
						"label": "Signup Referral Credited",
						"fieldtype": "Check",
						"default": "0",
						"insert_after": "referral_bonus_paid",
						"read_only": 1,
					},
				],
				"Customer TRF": [
					{
						"fieldname": "wallet_credit_applied",
						"label": "Wallet Credit Applied",
						"fieldtype": "Currency",
						"insert_after": "amount",
						"read_only": 1,
					},
				],
				"Doctor Appointment": [
					{
						"fieldname": "wallet_credit_applied",
						"label": "Wallet Credit Applied",
						"fieldtype": "Currency",
						"insert_after": "amount",
						"read_only": 1,
					},
				],
			},
			update=True,
		)
	except Exception:
		# Fields may already exist from DocType JSON migrate
		frappe.clear_cache(doctype="Health Patient")



def _generate_referral_code():
	alphabet = string.ascii_uppercase + string.digits
	for _ in range(40):
		code = "REM" + "".join(secrets.choice(alphabet) for _ in range(6))
		if not frappe.db.exists("Health Patient", {"referral_code": code}):
			return code
	return "REM" + frappe.generate_hash(length=6).upper()


def ensure_patient_wallet_and_code(patient_id):
	"""Assign referral code and zero wallet if missing. Returns patient name."""
	if not patient_id or not frappe.db.exists("Health Patient", patient_id):
		return None
	_ensure_patient_fields()
	doc = frappe.get_doc("Health Patient", patient_id)
	changed = False
	if not (getattr(doc, "referral_code", None) or "").strip():
		doc.referral_code = _generate_referral_code()
		changed = True
	if getattr(doc, "wallet_balance", None) is None:
		doc.wallet_balance = 0
		changed = True
	if changed:
		doc.save(ignore_permissions=True)
	return doc.name


def get_wallet_balance(patient_id):
	return flt(frappe.db.get_value("Health Patient", patient_id, "wallet_balance"))


def _record_txn(patient_id, transaction_type, amount, balance_after, reference_doctype=None, reference_name=None, remarks=None):
	payload = {
		"doctype": "Patient Wallet Transaction",
		"patient": patient_id,
		"transaction_type": transaction_type,
		"amount": flt(amount),
		"balance_after": flt(balance_after),
		"remarks": remarks,
		"posting_date": today(),
	}
	if (
		reference_doctype
		and reference_name
		and frappe.db.exists("DocType", reference_doctype)
		and frappe.db.exists(reference_doctype, reference_name)
	):
		payload["reference_doctype"] = reference_doctype
		payload["reference_name"] = reference_name
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	return doc.name


def credit_patient_wallet(patient_id, amount, remarks=None, reference_doctype=None, reference_name=None):
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Credit amount must be positive"), frappe.ValidationError)
	ensure_patient_wallet_and_code(patient_id)
	doc = frappe.get_doc("Health Patient", patient_id)
	new_balance = round(flt(doc.wallet_balance) + amount, 2)
	doc.wallet_balance = new_balance
	doc.save(ignore_permissions=True)
	txn = _record_txn(
		patient_id,
		"Credit",
		amount,
		new_balance,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
		remarks=remarks or _("Wallet credit"),
	)
	return {"transaction_id": txn, "amount": amount, "wallet_balance": new_balance}


def debit_patient_wallet(patient_id, amount, remarks=None, reference_doctype=None, reference_name=None):
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Debit amount must be positive"), frappe.ValidationError)
	ensure_patient_wallet_and_code(patient_id)
	doc = frappe.get_doc("Health Patient", patient_id)
	balance = flt(doc.wallet_balance)
	if balance < amount:
		frappe.throw(
			_("Insufficient wallet balance (₹{0} available, ₹{1} requested)").format(balance, amount),
			frappe.ValidationError,
		)
	new_balance = round(balance - amount, 2)
	doc.wallet_balance = new_balance
	doc.save(ignore_permissions=True)
	txn = _record_txn(
		patient_id,
		"Debit",
		amount,
		new_balance,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
		remarks=remarks or _("Wallet debit"),
	)
	return {"transaction_id": txn, "amount": amount, "wallet_balance": new_balance}


def find_patient_by_referral_code(code):
	code = (code or "").strip().upper()
	if not code:
		return None
	return frappe.db.get_value("Health Patient", {"referral_code": code}, "name")


def attribute_referral(new_patient_id, referral_code):
	"""Link referred_by and credit ₹50 each once. Safe to call repeatedly."""
	code = (referral_code or "").strip().upper()
	if not code or not new_patient_id:
		return {"ok": False, "reason": "missing"}

	ensure_patient_wallet_and_code(new_patient_id)
	referrer = find_patient_by_referral_code(code)
	if not referrer:
		return {"ok": False, "reason": "invalid_code"}
	if referrer == new_patient_id:
		return {"ok": False, "reason": "self_referral"}

	doc = frappe.get_doc("Health Patient", new_patient_id)
	if cint(getattr(doc, "signup_referral_credited", 0)):
		return {"ok": True, "already": True}

	existing_ref = (getattr(doc, "referred_by", None) or "").strip()
	if existing_ref and existing_ref != referrer:
		return {"ok": False, "reason": "already_attributed"}

	doc.referred_by = referrer
	doc.signup_referral_credited = 1
	doc.save(ignore_permissions=True)

	credit_patient_wallet(
		new_patient_id,
		SIGNUP_CREDIT,
		remarks=_("Welcome credit for joining with referral {0}").format(code),
		reference_doctype="Health Patient",
		reference_name=referrer,
	)
	credit_patient_wallet(
		referrer,
		SIGNUP_CREDIT,
		remarks=_("Referral signup bonus for inviting {0}").format(new_patient_id),
		reference_doctype="Health Patient",
		reference_name=new_patient_id,
	)
	return {"ok": True, "referrer": referrer, "signup_credit": SIGNUP_CREDIT}


def on_first_paid_order(patient_id, reference_doctype=None, reference_name=None):
	"""After referred patient's first paid order, credit referrer ₹100 once."""
	if not patient_id or not frappe.db.exists("Health Patient", patient_id):
		return {"ok": False}
	doc = frappe.get_doc("Health Patient", patient_id)
	if cint(getattr(doc, "referral_bonus_paid", 0)):
		return {"ok": True, "already": True}
	referrer = (getattr(doc, "referred_by", None) or "").strip()
	if not referrer:
		return {"ok": False, "reason": "not_referred"}

	doc.referral_bonus_paid = 1
	doc.save(ignore_permissions=True)
	credit_patient_wallet(
		referrer,
		FIRST_ORDER_REFERRER_BONUS,
		remarks=_("First-order referral bonus from {0}").format(patient_id),
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)
	return {"ok": True, "referrer": referrer, "bonus": FIRST_ORDER_REFERRER_BONUS}


def patient_id_from_payment_doc(reference_doctype, reference_name):
	"""Resolve Health Patient from a paid order doc."""
	if not reference_doctype or not reference_name or not frappe.db.exists(reference_doctype, reference_name):
		return None
	doc = frappe.get_doc(reference_doctype, reference_name)
	# Prefer linked patient / phone / email
	for field in ("health_patient", "patient", "hec_health_patient"):
		val = getattr(doc, field, None)
		if val and frappe.db.exists("Health Patient", val):
			return val
	phone = getattr(doc, "customer_phone", None) or getattr(doc, "mobile", None) or getattr(doc, "phone", None)
	email = getattr(doc, "customer_email", None) or getattr(doc, "email", None)
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import find_patient

	return find_patient(phone=phone, email=email)


def handle_payment_confirmed(reference_doctype, reference_name, paid_amount=None):
	"""Hook from verify_razorpay_payment — referral bonus + 10% wallet earn on purchase."""
	try:
		patient_id = patient_id_from_payment_doc(reference_doctype, reference_name)
		if patient_id:
			on_first_paid_order(patient_id, reference_doctype, reference_name)
			credit_purchase_wallet_points(
				patient_id, reference_doctype, reference_name, paid_amount=paid_amount
			)
	except Exception:
		frappe.log_error(title="phase75_payment_hook", message=frappe.get_traceback())


def _paid_amount_for_reference(reference_doctype, reference_name):
	"""Best-effort paid total for wallet earn."""
	if not reference_doctype or not reference_name or not frappe.db.exists(reference_doctype, reference_name):
		return 0.0
	doc = frappe.get_doc(reference_doctype, reference_name)
	for field in (
		"paid_amount",
		"grand_total",
		"rounded_total",
		"outstanding_amount",
		"amount",
		"total",
		"net_total",
	):
		val = flt(getattr(doc, field, None))
		if val > 0:
			# outstanding is remaining — skip if others exist
			if field == "outstanding_amount":
				continue
			return val
	# Sales Order / Invoice via child link
	so = getattr(doc, "sales_order", None)
	if so and frappe.db.exists("Sales Order", so):
		return flt(frappe.db.get_value("Sales Order", so, "grand_total"))
	si = getattr(doc, "sales_invoice", None)
	if si and frappe.db.exists("Sales Invoice", si):
		return flt(frappe.db.get_value("Sales Invoice", si, "grand_total"))
	return 0.0


def credit_purchase_wallet_points(patient_id, reference_doctype, reference_name, paid_amount=None):
	"""Credit 10% of paid amount as wallet points (once per order)."""
	earn_pct = 0.10
	if not patient_id:
		return None
	paid = flt(paid_amount) if paid_amount is not None else 0
	if paid <= 0:
		paid = _paid_amount_for_reference(reference_doctype, reference_name)
	if paid <= 0:
		return None

	# Idempotent: skip if we already credited purchase reward for this reference
	if frappe.db.exists("DocType", "Patient Wallet Transaction"):
		prior = frappe.get_all(
			"Patient Wallet Transaction",
			filters={
				"patient": patient_id,
				"transaction_type": "Credit",
				"reference_doctype": reference_doctype,
				"reference_name": reference_name,
			},
			fields=["name", "remarks"],
			limit=20,
		)
		for row in prior:
			if "Purchase reward" in (row.remarks or ""):
				return {"already": True, "transaction_id": row.name}

	earn = round(paid * earn_pct, 2)
	if earn <= 0:
		return None
	return credit_patient_wallet(
		patient_id,
		earn,
		remarks=_("Purchase reward 10% on {0} {1} (₹{2})").format(
			reference_doctype, reference_name, paid
		),
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)


def apply_wallet_to_pricing(user, pricing, use_wallet=False):
	"""Reduce final_total by available wallet (or requested amount). Mutates/returns pricing dict."""
	pricing = dict(pricing or {})
	use_wallet = bool(cint(use_wallet))
	pricing["wallet_balance"] = 0.0
	pricing["wallet_credit"] = 0.0
	if not use_wallet or not user or user == "Guest":
		return pricing

	from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

	profile = patient_profile_for_user(user) or {}
	patient_id = profile.get("patient_id") or profile.get("name")
	if not patient_id:
		return pricing
	ensure_patient_wallet_and_code(patient_id)
	balance = get_wallet_balance(patient_id)
	payable = flt(pricing.get("final_total"))
	credit = min(balance, payable) if payable > 0 else 0.0
	credit = round(credit * MAX_WALLET_APPLY_FRACTION, 2)
	pricing["wallet_balance"] = balance
	pricing["wallet_credit"] = credit
	pricing["final_total"] = round(max(0.0, payable - credit), 2)
	pricing["patient_id"] = patient_id
	return pricing


def debit_wallet_for_order(patient_id, amount, reference_doctype, reference_name):
	amount = flt(amount)
	if amount <= 0:
		return None
	return debit_patient_wallet(
		patient_id,
		amount,
		remarks=_("Applied to {0} {1}").format(reference_doctype, reference_name),
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)


def get_patient_wallet_payload(patient_id, limit=30):
	ensure_patient_wallet_and_code(patient_id)
	doc = frappe.get_doc("Health Patient", patient_id)
	txns = []
	if frappe.db.exists("DocType", "Patient Wallet Transaction"):
		txns = frappe.get_all(
			"Patient Wallet Transaction",
			filters={"patient": patient_id},
			fields=[
				"name",
				"transaction_type",
				"amount",
				"balance_after",
				"remarks",
				"posting_date",
				"creation",
				"reference_doctype",
				"reference_name",
			],
			order_by="creation desc",
			limit=cint(limit) or 30,
		)
	referred_count = frappe.db.count("Health Patient", {"referred_by": patient_id})
	code = (doc.referral_code or "").strip()
	share = (
		f"Join Remedium with my code {code} and we both get ₹{int(SIGNUP_CREDIT)} wallet credit. "
		f"https://www.e-remedium.in/signup?ref={code}"
	)
	return {
		"patient_id": patient_id,
		"patient_name": doc.patient_name,
		"referral_code": code,
		"wallet_balance": flt(doc.wallet_balance),
		"referred_by": doc.referred_by,
		"referred_count": referred_count,
		"signup_credit": SIGNUP_CREDIT,
		"first_order_bonus": FIRST_ORDER_REFERRER_BONUS,
		"share_text": share,
		"share_url": f"https://www.e-remedium.in/signup?ref={code}",
		"transactions": txns,
		"profile_image": getattr(doc, "profile_image", None),
	}


def update_patient_profile_fields(
	patient_id,
	*,
	patient_name=None,
	mobile=None,
	email=None,
	dob=None,
	gender=None,
	profile_image_b64=None,
	profile_image_filename=None,
):
	ensure_patient_wallet_and_code(patient_id)
	doc = frappe.get_doc("Health Patient", patient_id)
	if patient_name:
		doc.patient_name = patient_name.strip()
	if mobile is not None:
		from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile

		doc.mobile = normalize_mobile(mobile) if mobile else ""
	if email is not None:
		doc.email = (email or "").strip().lower()
	if dob:
		doc.dob = dob
	if gender and gender in ("Male", "Female", "Other"):
		doc.gender = gender

	if profile_image_b64:
		raw = profile_image_b64
		if "," in raw:
			raw = raw.split(",", 1)[1]
		content = base64.b64decode(raw)
		fname = profile_image_filename or f"profile-{patient_id}.jpg"
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": fname,
				"content": content,
				"is_private": 0,
				"attached_to_doctype": "Health Patient",
				"attached_to_name": patient_id,
			}
		)
		file_doc.save(ignore_permissions=True)
		doc.profile_image = file_doc.file_url
		# Mirror to User image when linked
		user = getattr(doc, "linked_user", None)
		if user and frappe.db.exists("User", user):
			frappe.db.set_value("User", user, "user_image", file_doc.file_url, update_modified=False)

	doc.save(ignore_permissions=True)

	# Sync User display fields
	user = getattr(doc, "linked_user", None)
	if user and frappe.db.exists("User", user):
		updates = {}
		if patient_name:
			parts = patient_name.strip().split(None, 1)
			updates["first_name"] = parts[0]
			updates["last_name"] = parts[1] if len(parts) > 1 else ""
		if mobile is not None:
			updates["mobile_no"] = doc.mobile
		if updates:
			frappe.db.set_value("User", user, updates, update_modified=False)

	return get_patient_wallet_payload(patient_id, limit=5)


def smoke_phase75():
	setup_phase75()
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	check("doctype", frappe.db.exists("DocType", "Patient Wallet Transaction"))
	# Create two ephemeral patients if possible
	a = frappe.get_doc(
		{
			"doctype": "Health Patient",
			"patient_name": "Referrer Smoke",
			"mobile": "9000000075",
			"status": "Active",
		}
	).insert(ignore_permissions=True)
	b = frappe.get_doc(
		{
			"doctype": "Health Patient",
			"patient_name": "Referee Smoke",
			"mobile": "9000000076",
			"status": "Active",
		}
	).insert(ignore_permissions=True)
	ensure_patient_wallet_and_code(a.name)
	ensure_patient_wallet_and_code(b.name)
	code = frappe.db.get_value("Health Patient", a.name, "referral_code")
	check("code", bool(code), detail=str(code))
	attr = attribute_referral(b.name, code)
	check("attribute", bool(attr.get("ok")), detail=str(attr))
	check("bal_a", get_wallet_balance(a.name) >= SIGNUP_CREDIT)
	check("bal_b", get_wallet_balance(b.name) >= SIGNUP_CREDIT)
	bonus = on_first_paid_order(b.name, None, None)
	check("bonus", bool(bonus.get("ok")), detail=str(bonus))
	check("bal_a_bonus", get_wallet_balance(a.name) >= SIGNUP_CREDIT + FIRST_ORDER_REFERRER_BONUS)
	# cleanup
	for name in (a.name, b.name):
		frappe.delete_doc("Health Patient", name, force=1, ignore_permissions=True)
	frappe.db.commit()
	return result
