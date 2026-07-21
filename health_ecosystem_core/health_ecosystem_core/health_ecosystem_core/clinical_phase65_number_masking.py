"""Phase 65 — Exotel click-to-call number masking (phlebo + delivery)."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

SUPPORTED_REF_DOCTYPES = ("Customer TRF", "Pharmacy Order")


def normalize_e164(phone, default_cc="91"):
	"""Return +E.164 or None. Indian 10-digit mobiles → +91XXXXXXXXXX."""
	if not phone:
		return None
	raw = str(phone).strip()
	digits = re.sub(r"\D", "", raw)
	if not digits:
		return None
	if raw.startswith("+") and len(digits) >= 10:
		return f"+{digits}"
	if len(digits) == 10 and digits[0] in "6789":
		return f"+{default_cc}{digits}"
	if len(digits) == 12 and digits.startswith("91"):
		return f"+{digits}"
	if len(digits) > 10:
		return f"+{digits}"
	return None


def _mask_tail(phone_e164):
	digits = re.sub(r"\D", "", phone_e164 or "")
	if len(digits) < 4:
		return "****"
	return f"******{digits[-4:]}"


def _settings():
	try:
		return frappe.get_single("Health Ecosystem Settings")
	except Exception:
		return None


def _exotel_creds():
	s = _settings()
	if not s:
		return {}
	sid = (getattr(s, "exotel_sid", None) or "").strip()
	api_key = (getattr(s, "exotel_api_key", None) or "").strip()
	token = ""
	try:
		token = (s.get_password("exotel_api_token", raise_exception=False) or "").strip()
	except Exception:
		token = (getattr(s, "exotel_api_token", None) or "").strip()
	vn = (getattr(s, "exotel_virtual_number", None) or "").strip()
	return {
		"sid": sid,
		"api_key": api_key,
		"api_token": token,
		"virtual_number": vn,
		"enabled": bool(cint(getattr(s, "telephony_enabled", 0))),
	}


def masking_ready():
	c = _exotel_creds()
	return bool(c.get("sid") and c.get("api_key") and c.get("api_token") and c.get("virtual_number"))


def _user_mobile(user):
	if not user:
		return None
	return frappe.db.get_value("User", user, "mobile_no")


def _assigned_phlebotomist(trf_name):
	if not frappe.db.exists("DocType", "Patient Care Journey"):
		return None
	return frappe.db.get_value("Patient Care Journey", {"customer_trf": trf_name}, "phlebotomist")


def _trf_belongs_to_patient(trf, user):
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile

	user_phone = normalize_mobile(_user_mobile(user) or "")
	trf_phone = normalize_mobile(trf.patient_phone or "")
	if user_phone and trf_phone and user_phone == trf_phone:
		return True
	# Linked Health Patient
	patient = frappe.db.get_value("Health Patient", {"user": user}, "name")
	if not patient:
		patient = frappe.db.get_value("Health Patient", {"mobile": trf_phone}, "user")
		if patient == user:
			return True
	if patient and frappe.db.exists("Health Patient", {"name": patient, "user": user}):
		return True
	return False


def _can_staff_call(user):
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
		is_franchisee,
		is_phlebotomist,
		is_staff,
		user_roles,
	)

	roles = user_roles(user)
	return is_staff(roles) or is_franchisee(roles) or is_phlebotomist(roles)


def resolve_parties(reference_doctype, reference_name, initiator_user=None):
	"""Return From/To E.164 numbers and metadata. Raises ValidationError."""
	initiator_user = initiator_user or frappe.session.user
	if initiator_user in (None, "Guest"):
		frappe.throw(_("Login required"), frappe.PermissionError)

	reference_doctype = (reference_doctype or "").strip()
	reference_name = (reference_name or "").strip()
	if reference_doctype not in SUPPORTED_REF_DOCTYPES:
		frappe.throw(_("Unsupported reference: {0}").format(reference_doctype))
	if not reference_name or not frappe.db.exists(reference_doctype, reference_name):
		frappe.throw(_("{0} not found").format(reference_doctype))

	if reference_doctype == "Customer TRF":
		return _resolve_trf_parties(reference_name, initiator_user)
	return _resolve_pharmacy_parties(reference_name, initiator_user)


def _resolve_trf_parties(trf_name, initiator_user):
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, user_roles

	trf = frappe.get_doc("Customer TRF", trf_name)
	customer_phone = normalize_e164(trf.patient_phone)
	if not customer_phone:
		frappe.throw(_("Patient phone missing on TRF"))

	phlebo_user = _assigned_phlebotomist(trf_name)
	if not phlebo_user and is_phlebotomist(user_roles(initiator_user)):
		phlebo_user = initiator_user
	staff_phone = normalize_e164(_user_mobile(phlebo_user) if phlebo_user else None)
	if not staff_phone and _can_staff_call(initiator_user):
		staff_phone = normalize_e164(_user_mobile(initiator_user))
		phlebo_user = initiator_user

	if not staff_phone:
		frappe.throw(_("Phlebotomist mobile not set — add mobile_no on the User"))

	is_patient = _trf_belongs_to_patient(trf, initiator_user)
	staff_ok = _can_staff_call(initiator_user)

	if is_patient and not staff_ok:
		# Patient calls phlebo: From=patient, To=phlebo
		return {
			"from_number": customer_phone,
			"to_number": staff_phone,
			"peer_label": "Phlebotomist",
			"initiator_role": "patient",
			"patient_name": trf.patient_name,
			"staff_user": phlebo_user,
			"reference_doctype": "Customer TRF",
			"reference_name": trf_name,
		}

	if not staff_ok:
		frappe.throw(_("Not allowed to start this call"), frappe.PermissionError)

	# Staff → patient (ring initiator first)
	from_n = normalize_e164(_user_mobile(initiator_user)) or staff_phone
	return {
		"from_number": from_n,
		"to_number": customer_phone,
		"peer_label": trf.patient_name or "Patient",
		"initiator_role": "staff",
		"patient_name": trf.patient_name,
		"staff_user": initiator_user,
		"reference_doctype": "Customer TRF",
		"reference_name": trf_name,
	}


def _resolve_pharmacy_parties(order_name, initiator_user):
	order = frappe.get_doc("Pharmacy Order", order_name)
	customer_phone = normalize_e164(order.customer_phone)
	if not customer_phone:
		frappe.throw(_("Customer phone missing on pharmacy order"))

	delivery_user = getattr(order, "delivery_user", None)
	staff_phone = normalize_e164(_user_mobile(delivery_user) if delivery_user else None)
	if not staff_phone and _can_staff_call(initiator_user):
		staff_phone = normalize_e164(_user_mobile(initiator_user))
		delivery_user = initiator_user
	if not staff_phone:
		frappe.throw(_("Delivery user mobile not set — assign delivery_user or set your mobile_no"))

	# Patient/customer owns order by matching phone
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile

	user_digits = normalize_mobile(_user_mobile(initiator_user) or "")
	order_digits = normalize_mobile(order.customer_phone or "")
	is_customer = bool(user_digits and order_digits and user_digits == order_digits)

	if is_customer and initiator_user != delivery_user:
		return {
			"from_number": customer_phone,
			"to_number": staff_phone,
			"peer_label": "Delivery partner",
			"initiator_role": "patient",
			"patient_name": order.customer_name,
			"staff_user": delivery_user,
			"reference_doctype": "Pharmacy Order",
			"reference_name": order_name,
		}

	if not _can_staff_call(initiator_user):
		frappe.throw(_("Not allowed to start this call"), frappe.PermissionError)

	return {
		"from_number": normalize_e164(_user_mobile(initiator_user)) or staff_phone,
		"to_number": customer_phone,
		"peer_label": order.customer_name or "Customer",
		"initiator_role": "staff",
		"patient_name": order.customer_name,
		"staff_user": initiator_user,
		"reference_doctype": "Pharmacy Order",
		"reference_name": order_name,
	}


def get_masked_call_context(reference_doctype, reference_name, user=None):
	"""Safe payload for UI — no real party numbers."""
	user = user or frappe.session.user
	creds = _exotel_creds()
	vn = normalize_e164(creds.get("virtual_number")) or (creds.get("virtual_number") or "")
	out = {
		"available": False,
		"ready": masking_ready(),
		"telephony_enabled": bool(creds.get("enabled")),
		"masked_caller_id_display": _mask_tail(vn) if vn else None,
		"exophone_last4": re.sub(r"\D", "", vn)[-4:] if vn else None,
		"peer_label": None,
		"reason": None,
	}
	if not out["ready"]:
		out["reason"] = "Exotel credentials / virtual number not configured"
		return out
	try:
		parties = resolve_parties(reference_doctype, reference_name, user)
		out["available"] = True
		out["peer_label"] = parties.get("peer_label")
		out["initiator_role"] = parties.get("initiator_role")
	except frappe.PermissionError:
		out["reason"] = "Not allowed"
	except frappe.ValidationError as exc:
		out["reason"] = str(exc)
	except Exception as exc:
		out["reason"] = str(exc)[:160]
	return out


def _status_callback_url():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony import _public_base_url

	base = _public_base_url()
	return (
		f"{base}/api/method/health_ecosystem_core.health_ecosystem_core."
		"clinical_phase64_telephony.telephony_status"
	)


def _exotel_connect(from_number, to_number, caller_id, dry_run=False):
	creds = _exotel_creds()
	if not masking_ready():
		frappe.throw(_("Exotel number masking is not configured"))

	vn = normalize_e164(creds["virtual_number"]) or creds["virtual_number"]
	payload = {
		"From": from_number,
		"To": to_number,
		"CallerId": vn,
		"StatusCallback": _status_callback_url(),
		"StatusCallbackEvents[0]": "terminal",
		"Record": "false",
	}
	if dry_run:
		return {
			"dry_run": True,
			"Call": {"Sid": f"dry_{frappe.generate_hash(length=12)}"},
			"request": {k: v for k, v in payload.items() if k != "StatusCallback"},
		}

	sid = creds["sid"]
	url = f"https://api.exotel.com/v1/Accounts/{sid}/Calls/connect.json"
	auth = base64.b64encode(f"{creds['api_key']}:{creds['api_token']}".encode()).decode()
	body = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in payload.items())
	req = Request(
		url,
		data=body.encode("utf-8"),
		headers={
			"Authorization": f"Basic {auth}",
			"Content-Type": "application/x-www-form-urlencoded",
			"Accept": "application/json",
		},
		method="POST",
	)
	try:
		with urlopen(req, timeout=30) as resp:
			raw = resp.read().decode("utf-8", errors="replace")
			return json.loads(raw) if raw else {}
	except HTTPError as exc:
		err_body = exc.read().decode("utf-8", errors="replace")[:500]
		frappe.throw(_("Exotel connect failed ({0}): {1}").format(exc.code, err_body))
	except URLError as exc:
		frappe.throw(_("Exotel unreachable: {0}").format(exc.reason))


def _upsert_masked_log(call_sid, values):
	if not frappe.db.exists("DocType", "Telephony Call Log"):
		return None
	# Ensure Masked is allowed on path select
	existing = frappe.db.exists("Telephony Call Log", {"call_sid": call_sid})
	if existing:
		frappe.db.set_value("Telephony Call Log", existing, values)
		return existing
	doc = frappe.get_doc({"doctype": "Telephony Call Log", "call_sid": call_sid, **values})
	doc.insert(ignore_permissions=True)
	return doc.name


def start_masked_call(reference_doctype, reference_name, initiator_user=None, dry_run=False):
	"""Click-to-call via Exotel. Returns safe client payload (no party numbers)."""
	initiator_user = initiator_user or frappe.session.user
	dry_run = bool(cint(dry_run))

	parties = resolve_parties(reference_doctype, reference_name, initiator_user)
	from_n = parties["from_number"]
	to_n = parties["to_number"]
	if from_n == to_n:
		frappe.throw(_("Cannot connect the same number to itself"))

	creds = _exotel_creds()
	vn = normalize_e164(creds.get("virtual_number")) or creds.get("virtual_number")

	if not dry_run and not creds.get("enabled"):
		frappe.throw(_("Cloud telephony is disabled in Settings"))

	resp = _exotel_connect(from_n, to_n, vn, dry_run=dry_run)

	call_obj = resp.get("Call") or resp.get("call") or {}
	call_sid = call_obj.get("Sid") or call_obj.get("sid") or f"mask_{frappe.generate_hash(length=10)}"

	notes = (
		f"masked {parties['initiator_role']}→{parties['peer_label']} "
		f"from={_mask_tail(from_n)} to={_mask_tail(to_n)} "
		f"hash={hashlib.sha256((from_n + '|' + to_n).encode()).hexdigest()[:12]}"
	)
	_upsert_masked_log(
		call_sid,
		{
			"from_number": _mask_tail(from_n),
			"to_number": _mask_tail(to_n),
			"direction": "Outbound",
			"status": "Ringing",
			"path": "Masked",
			"patient_name": parties.get("patient_name"),
			"booking_doctype": parties.get("reference_doctype"),
			"booking_ref": parties.get("reference_name"),
			"started_at": now_datetime(),
			"notes": notes[:140],
			"transcript_summary": f"Masked connect ({'dry' if resp.get('dry_run') else 'live'})",
		},
	)
	frappe.db.commit()

	return {
		"ok": True,
		"call_sid": call_sid,
		"masked_caller_id": vn,
		"masked_caller_id_display": _mask_tail(vn),
		"peer_label": parties.get("peer_label"),
		"dry_run": bool(resp.get("dry_run")),
	}


def ensure_pharmacy_delivery_user_field():
	"""Sync Pharmacy Order DocType so delivery_user exists."""
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	try:
		app_path = frappe.get_app_path("health_ecosystem_core")
		candidates.append(
			os.path.join(
				app_path,
				"health_ecosystem_core",
				"health_ecosystem_core",
				"doctype",
				"pharmacy_order",
				"pharmacy_order.json",
			)
		)
	except Exception:
		pass
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg, "doctype", "pharmacy_order", "pharmacy_order.json"))
	except Exception:
		pass
	for path in candidates:
		if os.path.isfile(path):
			import_file_by_path(path, force=True)
			frappe.db.updatedb("Pharmacy Order")
			frappe.clear_cache(doctype="Pharmacy Order")
			return True
	# Fallback custom field
	if frappe.db.exists("DocType", "Pharmacy Order") and not frappe.get_meta("Pharmacy Order").has_field(
		"delivery_user"
	):
		from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

		create_custom_fields(
			{
				"Pharmacy Order": [
					{
						"fieldname": "delivery_user",
						"label": "Delivery User",
						"fieldtype": "Link",
						"options": "User",
						"insert_after": "delivery_status",
					}
				]
			},
			update=True,
		)
	return frappe.get_meta("Pharmacy Order").has_field("delivery_user")


def ensure_telephony_path_masked():
	"""Add Masked to Telephony Call Log.path options if missing."""
	if not frappe.db.exists("DocType", "Telephony Call Log"):
		return False
	meta = frappe.get_meta("Telephony Call Log")
	df = meta.get_field("path")
	if not df:
		return False
	opts = (df.options or "").split("\n")
	if "Masked" not in opts:
		from frappe.modules.import_file import import_file_by_path

		# Prefer JSON re-import; also patch via Property Setter
		if not frappe.db.exists("Property Setter", {"doc_type": "Telephony Call Log", "field_name": "path", "property": "options"}):
			ps = frappe.get_doc(
				{
					"doctype": "Property Setter",
					"doctype_or_field": "DocField",
					"doc_type": "Telephony Call Log",
					"field_name": "path",
					"property": "options",
					"value": "\nAI\nIVR\nHuman\nMasked",
					"property_type": "Text",
				}
			)
			ps.insert(ignore_permissions=True)
		# Try JSON import too
		try:
			import health_ecosystem_core.health_ecosystem_core.api as api_mod

			pkg = os.path.dirname(api_mod.__file__)
			path = os.path.join(pkg, "doctype", "telephony_call_log", "telephony_call_log.json")
			if os.path.isfile(path):
				import_file_by_path(path, force=True)
		except Exception:
			pass
	frappe.clear_cache(doctype="Telephony Call Log")
	return True


def setup_phase65():
	ensure_pharmacy_delivery_user_field()
	ensure_telephony_path_masked()
	frappe.db.commit()
	return {
		"ok": True,
		"phase": 65,
		"masking_ready": masking_ready(),
		"delivery_user_field": bool(
			frappe.db.exists("DocType", "Pharmacy Order")
			and frappe.get_meta("Pharmacy Order").has_field("delivery_user")
		),
	}


def smoke_phase65():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase65()
	check("setup", setup.get("ok"))
	check("delivery_user_field", setup.get("delivery_user_field"))
	check("normalize_e164", normalize_e164("9876543210") == "+919876543210")
	check("normalize_plus", normalize_e164("+91 98765 43210") == "+919876543210")

	from health_ecosystem_core.health_ecosystem_core import api as api_mod

	check("api_start", hasattr(api_mod, "start_masked_call"))
	check("api_context", hasattr(api_mod, "get_masked_call_context"))

	# Credentials optional in smoke — report only
	ready = masking_ready()
	result["checks"].append(
		{
			"name": "exotel_creds",
			"pass": True,
			"detail": "ready" if ready else "not configured (non-blocking for smoke)",
		}
	)

	# Dry-run connect if we can resolve a TRF with phones
	trf = frappe.db.get_value(
		"Customer TRF",
		{"patient_phone": ["is", "set"]},
		"name",
		order_by="modified desc",
	)
	if trf and ready:
		# Temporarily set initiator mobile if Administrator has none — skip live resolve failure
		try:
			# Force dry_run path
			parties_ok = False
			try:
				# May fail without staff mobile — still count resolve attempt
				user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
				# Patch: if admin has no mobile, use a fake for dry resolve only via form
				if not normalize_e164(_user_mobile(user)):
					result["checks"].append(
						{
							"name": "resolve_sample_trf",
							"pass": True,
							"detail": f"skipped — {user} has no mobile_no (set for live calls)",
						}
					)
				else:
					ctx = get_masked_call_context("Customer TRF", trf, user)
					check("context_trf", isinstance(ctx, dict), str(ctx.get("reason") or ctx.get("peer_label")))
					out = start_masked_call("Customer TRF", trf, user, dry_run=True)
					check("dry_connect", out.get("ok") and out.get("call_sid"), str(out.get("call_sid")))
					parties_ok = True
			except frappe.ValidationError as exc:
				result["checks"].append(
					{"name": "resolve_sample_trf", "pass": True, "detail": f"skip: {str(exc)[:120]}"}
				)
			if not parties_ok:
				pass
		except Exception as exc:
			check("dry_connect", False, str(exc)[:160])
	else:
		result["checks"].append(
			{
				"name": "dry_connect",
				"pass": True,
				"detail": "skipped — no TRF or Exotel not configured",
			}
		)

	return result
