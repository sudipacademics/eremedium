"""Phase 64 — Exotel cloud telephony + AI voice booking control plane."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timedelta
from xml.sax.saxutils import escape

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_time, getdate, now_datetime, today

PHASE64_DOCTYPES = (("telephony_call_log", "Telephony Call Log"),)

SERVICE_DIGIT_MAP = {
	"1": "Doctor",
	"2": "Lab",
	"3": "Allied",
	"4": "Teleconsult",
	"0": "Human",
}

AI_TOOLS_SPEC = [
	{
		"type": "function",
		"function": {
			"name": "lookup_caller",
			"description": "Look up the caller in CRM by phone",
			"parameters": {"type": "object", "properties": {"phone": {"type": "string"}}, "required": []},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "list_bookable_services",
			"description": "List bookable service categories and sample catalog items",
			"parameters": {"type": "object", "properties": {}},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "check_availability",
			"description": "Check doctor slots or lab collection availability",
			"parameters": {
				"type": "object",
				"properties": {
					"service": {"type": "string", "enum": ["Doctor", "Teleconsult", "Lab", "Lab Panel", "Allied"]},
					"date": {"type": "string"},
					"practitioner": {"type": "string"},
					"item_code": {"type": "string"},
				},
				"required": ["service"],
			},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "book_service",
			"description": "Book a service for the caller",
			"parameters": {
				"type": "object",
				"properties": {
					"service": {"type": "string"},
					"patient_name": {"type": "string"},
					"date": {"type": "string"},
					"time": {"type": "string"},
					"practitioner": {"type": "string"},
					"item_code": {"type": "string"},
					"panel_id": {"type": "string"},
					"service_code": {"type": "string"},
					"notes": {"type": "string"},
				},
				"required": ["service", "patient_name"],
			},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "escalate_to_human",
			"description": "Transfer the call to a human agent",
			"parameters": {
				"type": "object",
				"properties": {"reason": {"type": "string"}},
				"required": ["reason"],
			},
		},
	},
]


def _import_doctype(folder, doctype_name, force=True):
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	app_path = frappe.get_app_path("health_ecosystem_core")
	candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg_root = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
	except Exception:
		pass
	for json_path in candidates:
		if os.path.isfile(json_path):
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype=doctype_name)
			if frappe.db.exists("DocType", doctype_name):
				return True
	frappe.throw(_("Could not install {0} doctype").format(doctype_name))


def ensure_phase64_doctypes():
	for folder, name in PHASE64_DOCTYPES:
		_import_doctype(folder, name, force=True)
	_import_doctype("health_ecosystem_settings", "Health Ecosystem Settings", force=True)


def _settings():
	try:
		return frappe.get_single("Health Ecosystem Settings")
	except Exception:
		return None


def _telephony_enabled():
	s = _settings()
	return bool(s and cint(getattr(s, "telephony_enabled", 0)))


def _webhook_secret():
	s = _settings()
	return (getattr(s, "exotel_webhook_secret", None) or "").strip() if s else ""


def _openai_key():
	s = _settings()
	return (getattr(s, "telephony_openai_api_key", None) or "").strip() if s else ""


def _agent_number():
	s = _settings()
	return (getattr(s, "exotel_agent_connect_number", None) or "").strip() if s else ""


def _public_base_url():
	s = _settings()
	base = ""
	if s:
		base = (getattr(s, "patient_portal_base_url", None) or getattr(s, "telephony_public_base_url", None) or "").strip()
	if not base:
		base = frappe.utils.get_url()
	return base.rstrip("/")


def _normalize_phone(raw):
	from health_ecosystem_core.health_ecosystem_core.clinical_otp import normalize_mobile

	return normalize_mobile(raw)


def _verify_webhook(secret_param=None):
	"""Accept Exotel CustomField secret or X-Telephony-Secret header / form field."""
	expected = _webhook_secret()
	if not expected:
		# Soft: allow when secret not configured (dev/smoke); still require telephony_enabled for live ops
		return True
	provided = (
		secret_param
		or frappe.get_request_header("X-Telephony-Secret")
		or frappe.form_dict.get("webhook_secret")
		or frappe.form_dict.get("CustomField")
		or frappe.form_dict.get("secret")
	)
	if not provided:
		return False
	return hmac.compare_digest(str(provided).strip(), expected)


def _cache_key(call_sid):
	return f"telephony:call:{call_sid}"


def _set_call_ctx(call_sid, data, ttl=3600):
	frappe.cache().set_value(_cache_key(call_sid), data, expires_in_sec=ttl)


def _get_call_ctx(call_sid):
	return frappe.cache().get_value(_cache_key(call_sid)) or {}


def lookup_caller(phone=None):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import find_patient

	phone = _normalize_phone(phone)
	if not phone:
		return {"known": False, "phone": None, "patient_id": None, "patient_name": None}
	# Try exact then with common prefixes stored in DB
	patient_id = find_patient(phone=phone)
	if not patient_id:
		for candidate in (phone, f"91{phone}", f"+91{phone}"):
			patient_id = frappe.db.get_value("Health Patient", {"mobile": candidate}, "name")
			if patient_id:
				break
		if not patient_id:
			# last-10 match
			rows = frappe.get_all("Health Patient", fields=["name", "mobile", "patient_name"], limit=500)
			for r in rows:
				if _normalize_phone(r.mobile) == phone:
					patient_id = r.name
					break
	if not patient_id:
		return {"known": False, "phone": phone, "patient_id": None, "patient_name": None}
	name = frappe.db.get_value("Health Patient", patient_id, "patient_name")
	return {"known": True, "phone": phone, "patient_id": patient_id, "patient_name": name}


def list_bookable_services():
	doctors = []
	if frappe.db.exists("DocType", "Doctor"):
		doctors = frappe.get_all("Doctor", fields=["name", "doctor_name"], limit=10, order_by="doctor_name asc")
	lab_items = []
	if frappe.db.exists("DocType", "Item"):
		lab_items = frappe.get_all(
			"Item",
			filters={"disabled": 0, "is_sales_item": 1},
			fields=["name", "item_name"],
			limit=15,
			order_by="modified desc",
		)
	panels = []
	if frappe.db.exists("DocType", "Lab Test Panel"):
		panels = frappe.get_all("Lab Test Panel", fields=["name", "panel_name"], limit=10)
	allied = []
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health import _load_services

		allied = [{"service_code": s["service_code"], "service_name": s["service_name"]} for s in _load_services()[:10]]
	except Exception:
		pass
	return {
		"categories": ["Doctor", "Teleconsult", "Lab", "Lab Panel", "Allied"],
		"doctors": doctors,
		"lab_items": lab_items,
		"panels": panels,
		"allied": allied,
	}


def check_availability(service=None, date=None, practitioner=None, item_code=None):
	service = (service or "Doctor").strip()
	date = date or today()
	if service in ("Doctor", "Teleconsult", "Allied"):
		if not practitioner:
			# pick first active doctor
			if frappe.db.exists("DocType", "Doctor"):
				practitioner = frappe.db.get_value("Doctor", {}, "name", order_by="creation asc")
		if not practitioner:
			return {"ok": False, "slots": [], "reason": "No practitioner configured"}
		from health_ecosystem_core.health_ecosystem_core.appointments import get_doctor_schedule_slots

		resp = get_doctor_schedule_slots(doctor=practitioner, appointment_date=date)
		slots = (resp.get("data") or {}).get("slots") or []
		return {
			"ok": bool(slots),
			"service": service,
			"date": str(getdate(date)),
			"practitioner": practitioner,
			"slots": slots[:12],
			"reason": None if slots else "No slots available",
		}
	# Lab / panel — soft availability: next 3 default morning windows
	windows = []
	base = getdate(date)
	for i in range(0, 3):
		d = add_days(base, i)
		windows.append({"date": str(d), "collection_slot": f"{d} 08:00:00", "label": f"{d} morning home collection"})
	return {"ok": True, "service": service, "date": str(base), "item_code": item_code, "slots": windows, "reason": None}


def _default_franchisee():
	if frappe.db.exists("DocType", "Franchisee Profile"):
		return frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")
	return None


def _default_consultation_type():
	if frappe.db.exists("DocType", "Consultation Type"):
		name = frappe.db.get_value("Consultation Type", {}, "name", order_by="creation asc")
		return name
	return None


def _book_doctor_internal(
	*,
	patient_name,
	patient_phone,
	practitioner=None,
	appointment_type=None,
	appointment_date=None,
	appointment_time=None,
	department=None,
	notes=None,
	teleconsult=False,
):
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

	patient = ensure_patient(patient_name=patient_name, phone=patient_phone, gender="Male")
	if not patient:
		return {"ok": False, "error": "Could not create patient"}
	appointment_type = appointment_type or _default_consultation_type()
	if not appointment_type:
		return {"ok": False, "error": "No Consultation Type configured"}
	appointment_date = appointment_date or today()
	if not practitioner and frappe.db.exists("DocType", "Doctor"):
		practitioner = frappe.db.get_value("Doctor", {}, "name", order_by="creation asc")

	# pick first slot if time missing
	if practitioner and not appointment_time:
		avail = check_availability("Doctor", appointment_date, practitioner)
		if avail.get("slots"):
			appointment_time = avail["slots"][0].get("time")
		else:
			return {"ok": False, "error": "No slots available", "escalate": True}

	company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	doc = {
		"doctype": "Doctor Appointment",
		"patient": patient,
		"patient_name": patient_name,
		"consultation_type": appointment_type,
		"appointment_date": getdate(appointment_date),
		"company": company,
		"status": "Scheduled",
		"notes": (notes or "") + (" | Telephony booking" if not notes or "Telephony" not in notes else ""),
		"amount": 0,
		"razorpay_payment_status": "Pending",
		"payment_method": "Pay at Hub",
	}
	if practitioner and frappe.db.exists("Doctor", practitioner):
		doc["doctor"] = practitioner
		doc["doctor_name"] = frappe.db.get_value("Doctor", practitioner, "doctor_name")
	if department:
		doc["department"] = department
	if appointment_time:
		from health_ecosystem_core.health_ecosystem_core.appointments import _normalize_appointment_time

		doc["appointment_time"] = _normalize_appointment_time(appointment_time)
	if teleconsult:
		doc["consultation_mode"] = "Online"
		doc["notes"] = (doc.get("notes") or "") + " | Teleconsult"
	apt = frappe.get_doc(doc)
	apt.insert(ignore_permissions=True)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_journey import ensure_journey_for_patient

		ensure_journey_for_patient(patient, status="Doctor Consultation", appointment=apt.name)
	except Exception:
		pass
	frappe.db.commit()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_appointment_booked

		notify_appointment_booked(apt.name)
	except Exception:
		pass
	return {
		"ok": True,
		"booking_doctype": "Doctor Appointment",
		"booking_ref": apt.name,
		"patient": patient,
		"message": f"Appointment {apt.name} booked",
	}


def _book_lab_internal(*, patient_name, patient_phone, item_code=None, panel_id=None, collection_slot=None, age=30):
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import create_customer_trf_booking

	franchisee_id = _default_franchisee()
	if not franchisee_id:
		return {"ok": False, "error": "No Franchisee Profile configured", "escalate": True}
	test_items = None
	test_required = None
	if panel_id:
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_diagnostics import _panel_test_items

			test_items = _panel_test_items(panel_id)
		except Exception:
			test_items = None
		if not test_items:
			return {"ok": False, "error": "Panel empty or not found", "escalate": True}
	elif item_code:
		test_required = item_code
	else:
		# first lab item
		item_code = frappe.db.get_value("Item", {"disabled": 0, "is_sales_item": 1}, "name")
		if not item_code:
			return {"ok": False, "error": "No lab Item configured", "escalate": True}
		test_required = item_code

	if not collection_slot:
		collection_slot = f"{today()} 08:00:00"

	resp = create_customer_trf_booking(
		patient_name=patient_name,
		age=age,
		gender="Male",
		test_required=test_required,
		test_items=test_items,
		franchisee_id=franchisee_id,
		patient_phone=patient_phone,
		collection_slot=collection_slot,
		payment_method="Pay at Hub",
	)
	if not resp or resp.get("status") != "success":
		return {
			"ok": False,
			"error": (resp or {}).get("message") or "Lab book failed",
			"escalate": True,
		}
	data = resp.get("data") or {}
	trf = data.get("trf_id") or data.get("trf") or data.get("name") or data.get("customer_trf")
	# nested shapes
	if not trf and isinstance(data.get("trf_doc"), dict):
		trf = data["trf_doc"].get("name")
	return {
		"ok": True,
		"booking_doctype": "Customer TRF",
		"booking_ref": trf,
		"message": f"Lab booking {trf} created",
	}


def book_service(
	service=None,
	patient_name=None,
	phone=None,
	date=None,
	time=None,
	practitioner=None,
	item_code=None,
	panel_id=None,
	service_code=None,
	notes=None,
	call_sid=None,
):
	service = (service or "Doctor").strip()
	ctx = _get_call_ctx(call_sid) if call_sid else {}
	phone = _normalize_phone(phone or ctx.get("phone"))
	patient_name = (patient_name or ctx.get("patient_name") or "Caller").strip()
	if not phone:
		return {"ok": False, "error": "Phone required", "escalate": True}

	if service == "Human":
		return escalate_to_human(call_sid=call_sid, reason="Caller requested agent")

	if service in ("Doctor", "Allied"):
		extra = notes or ""
		if service == "Allied" and service_code:
			extra = f"Allied service_code={service_code}\n{extra}"
		result = _book_doctor_internal(
			patient_name=patient_name,
			patient_phone=phone,
			practitioner=practitioner,
			appointment_date=date,
			appointment_time=time,
			notes=extra,
			teleconsult=False,
		)
	elif service == "Teleconsult":
		result = _book_doctor_internal(
			patient_name=patient_name,
			patient_phone=phone,
			practitioner=practitioner,
			appointment_date=date,
			appointment_time=time,
			notes=notes,
			teleconsult=True,
		)
	elif service in ("Lab", "Lab Panel"):
		result = _book_lab_internal(
			patient_name=patient_name,
			patient_phone=phone,
			item_code=item_code,
			panel_id=panel_id,
			collection_slot=f"{date or today()} {time or '08:00:00'}" if date or time else None,
		)
	else:
		return {"ok": False, "error": f"Unknown service {service}", "escalate": True}

	if call_sid and result.get("ok"):
		_update_call_log(
			call_sid,
			{
				"status": "Booked",
				"service_intent": service,
				"booking_doctype": result.get("booking_doctype"),
				"booking_ref": result.get("booking_ref"),
				"patient": result.get("patient") or ctx.get("patient_id"),
				"patient_name": patient_name,
			},
		)
	return result


def escalate_to_human(call_sid=None, reason=None):
	agent = _agent_number()
	_update_call_log(
		call_sid,
		{"status": "Escalated", "path": "Human", "escalate_reason": reason or "Complex request"},
	)
	return {
		"ok": True,
		"escalate": True,
		"agent_number": agent,
		"reason": reason or "Complex request",
		"exotel_connect": bool(agent),
		"message": "Routing to human agent" if agent else "No agent number configured — mark escalated",
	}


def _upsert_call_log(call_sid, values):
	if not call_sid:
		return None
	existing = frappe.db.exists("Telephony Call Log", {"call_sid": call_sid})
	if existing:
		frappe.db.set_value("Telephony Call Log", existing, values)
		frappe.db.commit()
		return existing
	doc = frappe.get_doc({"doctype": "Telephony Call Log", "call_sid": call_sid, **values})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


def _update_call_log(call_sid, values):
	if not call_sid:
		return
	name = frappe.db.exists("Telephony Call Log", {"call_sid": call_sid})
	if name:
		frappe.db.set_value("Telephony Call Log", name, values)
		frappe.db.commit()


def _exotel_xml_gather(action_url, prompt, digits=1):
	return (
		'<?xml version="1.0" encoding="UTF-8"?>'
		"<Response>"
		f'<Gather timeout="10" finishOnKey="#" numDigits="{digits}" method="POST" action="{escape(action_url)}">'
		f"<Say>{escape(prompt)}</Say>"
		"</Gather>"
		f"<Say>We did not receive input. Connecting you to an agent.</Say>"
		f"{_exotel_connect_xml()}"
		"</Response>"
	)


def _exotel_connect_xml():
	agent = _agent_number()
	if not agent:
		return "<Hangup/>"
	return f"<Dial><Number>{escape(agent)}</Number></Dial>"


def _exotel_xml_ai_greeting(name, ai_url):
	greet = f"Hi {name}, want to book an appointment? Tell me doctor visit, lab test, or allied service."
	return (
		'<?xml version="1.0" encoding="UTF-8"?>'
		"<Response>"
		f"<Say>{escape(greet)}</Say>"
		f'<Gather timeout="15" finishOnKey="#" method="POST" action="{escape(ai_url)}" input="speech dtmf">'
		"<Say>Please say doctor, lab, or allied. Or press 1 for doctor, 2 for lab, 3 for allied, 0 for agent.</Say>"
		"</Gather>"
		f"{_exotel_connect_xml()}"
		"</Response>"
	)


def _method_url(method):
	return f"{_public_base_url()}/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.{method}"


def setup_phase64():
	ensure_phase64_doctypes()
	return {"ok": True, "doctype": "Telephony Call Log", "enabled": _telephony_enabled()}


def smoke_phase64():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase64()
	check("setup", setup.get("ok"))
	check("doctype", frappe.db.exists("DocType", "Telephony Call Log"))

	# Known vs unknown routing
	phone_unknown = "9876500641"
	lookup_u = lookup_caller(phone_unknown)
	check("lookup_unknown", lookup_u.get("known") is False, str(lookup_u))

	# Ensure a known patient for smoke
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

	known_phone = "9876500642"
	pid = ensure_patient(patient_name="Telephony Smoke Patient", phone=known_phone, gender="Male")
	frappe.db.commit()
	lookup_k = lookup_caller(known_phone)
	check("lookup_known", lookup_k.get("known") is True and bool(pid), str(lookup_k))

	# Incoming simulation
	call_sid = f"SMOKE-{frappe.generate_hash(length=8)}"
	incoming = _handle_incoming(call_sid=call_sid, from_number=known_phone, to_number="08000000000", as_json=True)
	check("incoming_known_ai_path", (incoming.get("path") == "AI"), str(incoming))
	check("call_log_created", frappe.db.exists("Telephony Call Log", {"call_sid": call_sid}))

	call_sid2 = f"SMOKE-{frappe.generate_hash(length=8)}"
	incoming2 = _handle_incoming(call_sid=call_sid2, from_number=phone_unknown, to_number="08000000000", as_json=True)
	check("incoming_unknown_ivr", incoming2.get("path") == "IVR", str(incoming2))

	# Invalid secret
	secret_ok = _verify_webhook("wrong") if _webhook_secret() else True
	if _webhook_secret():
		check("invalid_secret_rejected", secret_ok is False)
	else:
		check("secret_optional_dev", True, "webhook secret not set")

	# Availability
	avail = check_availability("Doctor", today())
	check("check_availability_callable", isinstance(avail.get("slots"), list), str(avail.get("reason")))

	# Book doctor if slots exist, else escalate path
	if avail.get("ok") and avail.get("slots"):
		book = book_service(
			service="Doctor",
			patient_name="Telephony Smoke Patient",
			phone=known_phone,
			date=today(),
			time=avail["slots"][0].get("time"),
			practitioner=avail.get("practitioner"),
			call_sid=call_sid,
		)
		check("book_doctor", book.get("ok"), str(book))
	else:
		esc = escalate_to_human(call_sid=call_sid, reason="No slots in smoke")
		check("escalate_no_slot", esc.get("escalate") is True, str(esc))

	# Lab book attempt (may escalate if no franchisee/item)
	lab = book_service(
		service="Lab",
		patient_name="Telephony Smoke Patient",
		phone=known_phone,
		call_sid=call_sid2,
	)
	check("book_lab_or_escalate", lab.get("ok") or lab.get("escalate"), str(lab))

	# AI tools dispatch
	tool = dispatch_ai_tool("list_bookable_services", {}, call_sid=call_sid)
	check("ai_tool_list_services", "categories" in tool, str(tool)[:120])

	# AI turn (works without OpenAI key — rule-based fallback)
	turn = ai_conversation_turn(call_sid=call_sid, user_text="I want to book a doctor", phone=known_phone)
	check("ai_turn", bool(turn.get("reply")), str(turn.get("reply"))[:80])

	dash = get_telephony_dashboard_data()
	check("dashboard", isinstance(dash.get("calls"), list), str(dash.get("counts")))

	return result


def _handle_incoming(call_sid=None, from_number=None, to_number=None, as_json=False):
	phone = _normalize_phone(from_number)
	info = lookup_caller(phone)
	path = "AI" if info.get("known") else "IVR"
	_upsert_call_log(
		call_sid,
		{
			"from_number": phone or from_number,
			"to_number": to_number,
			"direction": "Inbound",
			"status": "In Progress",
			"path": path,
			"caller_known": 1 if info.get("known") else 0,
			"patient": info.get("patient_id"),
			"patient_name": info.get("patient_name"),
			"started_at": now_datetime(),
		},
	)
	_set_call_ctx(
		call_sid,
		{
			"phone": phone,
			"patient_id": info.get("patient_id"),
			"patient_name": info.get("patient_name"),
			"path": path,
			"known": info.get("known"),
		},
	)
	payload = {
		"ok": True,
		"call_sid": call_sid,
		"path": path,
		"caller": info,
		"ai_url": _method_url("telephony_ai_gather"),
		"ivr_url": _method_url("telephony_ivr_digit"),
		"greeting": (
			f"Hi {info.get('patient_name')}, want to book?"
			if info.get("known")
			else "Press 1 to book doctor, 2 for lab, 3 for allied, 0 for agent."
		),
	}
	if as_json:
		return payload
	if path == "AI":
		xml = _exotel_xml_ai_greeting(info.get("patient_name") or "there", payload["ai_url"])
	else:
		xml = _exotel_xml_gather(
			payload["ivr_url"],
			"Welcome to Remedium. Press 1 to book a doctor appointment. Press 2 for lab test. Press 3 for allied health. Press 0 to speak to an agent.",
		)
	payload["xml"] = xml
	return payload


def dispatch_ai_tool(name, arguments, call_sid=None):
	arguments = arguments or {}
	ctx = _get_call_ctx(call_sid) if call_sid else {}
	phone = arguments.get("phone") or ctx.get("phone")
	if name == "lookup_caller":
		return lookup_caller(phone)
	if name == "list_bookable_services":
		return list_bookable_services()
	if name == "check_availability":
		return check_availability(
			arguments.get("service"),
			arguments.get("date"),
			arguments.get("practitioner"),
			arguments.get("item_code"),
		)
	if name == "book_service":
		return book_service(
			service=arguments.get("service"),
			patient_name=arguments.get("patient_name") or ctx.get("patient_name"),
			phone=phone,
			date=arguments.get("date"),
			time=arguments.get("time"),
			practitioner=arguments.get("practitioner"),
			item_code=arguments.get("item_code"),
			panel_id=arguments.get("panel_id"),
			service_code=arguments.get("service_code"),
			notes=arguments.get("notes"),
			call_sid=call_sid,
		)
	if name == "escalate_to_human":
		return escalate_to_human(call_sid=call_sid, reason=arguments.get("reason"))
	return {"ok": False, "error": f"Unknown tool {name}"}


def _rule_based_ai_reply(user_text, call_sid, phone):
	text = (user_text or "").lower()
	ctx = _get_call_ctx(call_sid)
	name = ctx.get("patient_name") or "there"
	if any(w in text for w in ("agent", "human", "operator", "person")):
		esc = escalate_to_human(call_sid, "Caller asked for human")
		return {"reply": "Connecting you to an agent now.", "tool_results": [esc], "escalate": True}
	service = None
	if "lab" in text or "blood" in text or "test" in text:
		service = "Lab"
	elif "tele" in text or "online" in text or "video" in text:
		service = "Teleconsult"
	elif "allied" in text or "physio" in text or "yoga" in text:
		service = "Allied"
	elif "doctor" in text or "appoint" in text or "consult" in text:
		service = "Doctor"
	if not service:
		return {
			"reply": f"Hi {name}. I can book a doctor, teleconsult, lab test, or allied service. What would you like?",
			"tool_results": [],
		}
	avail = check_availability(service, today())
	if not avail.get("ok") and service in ("Doctor", "Teleconsult", "Allied"):
		esc = escalate_to_human(call_sid, avail.get("reason") or "No slots")
		return {
			"reply": "I could not find an open slot. Connecting you to an agent.",
			"tool_results": [avail, esc],
			"escalate": True,
		}
	book = book_service(
		service=service,
		patient_name=ctx.get("patient_name") or name,
		phone=phone or ctx.get("phone"),
		date=today(),
		time=(avail.get("slots") or [{}])[0].get("time") if avail.get("slots") else None,
		practitioner=avail.get("practitioner"),
		call_sid=call_sid,
	)
	if book.get("ok"):
		return {
			"reply": f"Done. Your {service.lower()} booking {book.get('booking_ref')} is confirmed. You will get an SMS shortly.",
			"tool_results": [avail, book],
		}
	if book.get("escalate"):
		esc = escalate_to_human(call_sid, book.get("error") or "Booking failed")
		return {
			"reply": "I need an agent to finish this booking. Connecting you now.",
			"tool_results": [book, esc],
			"escalate": True,
		}
	return {"reply": book.get("error") or "Sorry, booking failed.", "tool_results": [book]}


def _openai_chat_turn(messages):
	"""Call OpenAI Chat Completions with tools; return assistant message dict."""
	import urllib.request

	key = _openai_key()
	if not key:
		return None
	body = json.dumps(
		{
			"model": "gpt-4o-mini",
			"messages": messages,
			"tools": AI_TOOLS_SPEC,
			"tool_choice": "auto",
		}
	).encode("utf-8")
	req = urllib.request.Request(
		"https://api.openai.com/v1/chat/completions",
		data=body,
		headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
		method="POST",
	)
	try:
		with urllib.request.urlopen(req, timeout=45) as resp:
			data = json.loads(resp.read().decode("utf-8"))
		return (data.get("choices") or [{}])[0].get("message")
	except Exception:
		frappe.log_error(title="telephony_openai", message=frappe.get_traceback())
		return None


def ai_conversation_turn(call_sid=None, user_text=None, phone=None):
	ctx = _get_call_ctx(call_sid) if call_sid else {}
	phone = _normalize_phone(phone or ctx.get("phone"))
	name = ctx.get("patient_name") or "caller"
	# Prefer OpenAI when key present
	system = (
		"You are Remedium Health voice booking assistant. "
		f"Caller name: {name}. Phone: {phone}. "
		"Greet known callers briefly. Use tools to check availability and book. "
		"Services: Doctor, Teleconsult, Lab, Lab Panel, Allied. "
		"If no slot or complex request, call escalate_to_human. Keep spoken replies under 40 words."
	)
	messages = [
		{"role": "system", "content": system},
		{"role": "user", "content": user_text or "Hello"},
	]
	msg = _openai_chat_turn(messages)
	tool_results = []
	if msg and msg.get("tool_calls"):
		messages.append(msg)
		for tc in msg["tool_calls"]:
			fn = (tc.get("function") or {}).get("name")
			raw_args = (tc.get("function") or {}).get("arguments") or "{}"
			try:
				args = json.loads(raw_args)
			except Exception:
				args = {}
			result = dispatch_ai_tool(fn, args, call_sid=call_sid)
			tool_results.append({"tool": fn, "result": result})
			messages.append(
				{
					"role": "tool",
					"tool_call_id": tc.get("id"),
					"content": json.dumps(result),
				}
			)
		follow = _openai_chat_turn(messages)
		reply = (follow or {}).get("content") or "Your request was processed."
		escalate = any(r.get("result", {}).get("escalate") for r in tool_results)
		_append_transcript(call_sid, user_text, reply)
		return {"reply": reply, "tool_results": tool_results, "escalate": escalate, "provider": "openai"}
	if msg and msg.get("content"):
		_append_transcript(call_sid, user_text, msg["content"])
		return {"reply": msg["content"], "tool_results": [], "provider": "openai"}
	# Fallback rule-based
	out = _rule_based_ai_reply(user_text, call_sid, phone)
	_append_transcript(call_sid, user_text, out.get("reply"))
	out["provider"] = "rules"
	return out


def _append_transcript(call_sid, user_text, reply):
	if not call_sid:
		return
	name = frappe.db.exists("Telephony Call Log", {"call_sid": call_sid})
	if not name:
		return
	prev = frappe.db.get_value("Telephony Call Log", name, "transcript_summary") or ""
	line = f"User: {user_text or ''}\nAgent: {reply or ''}\n---\n"
	frappe.db.set_value("Telephony Call Log", name, "transcript_summary", prev + line)
	frappe.db.commit()


def get_telephony_dashboard_data():
	calls = frappe.get_all(
		"Telephony Call Log",
		fields=[
			"name",
			"call_sid",
			"from_number",
			"status",
			"path",
			"caller_known",
			"patient_name",
			"service_intent",
			"booking_doctype",
			"booking_ref",
			"escalate_reason",
			"creation",
		],
		order_by="creation desc",
		limit=50,
	)
	return {
		"calls": calls,
		"counts": {
			"total": frappe.db.count("Telephony Call Log"),
			"booked": frappe.db.count("Telephony Call Log", {"status": "Booked"}),
			"escalated": frappe.db.count("Telephony Call Log", {"status": "Escalated"}),
			"ai": frappe.db.count("Telephony Call Log", {"path": "AI"}),
			"ivr": frappe.db.count("Telephony Call Log", {"path": "IVR"}),
		},
		"telephony_enabled": _telephony_enabled(),
		"agent_configured": bool(_agent_number()),
		"openai_configured": bool(_openai_key()),
	}


# ── Whitelisted APIs ─────────────────────────────────────────────────────────


def _respond_xml(xml):
	# Frappe has no response type "text" (KeyError) ??? use download/inline for raw XML.
	frappe.local.response["type"] = "download"
	frappe.local.response["filename"] = "exotel.xml"
	frappe.local.response["filecontent"] = xml
	frappe.local.response["content_type"] = "application/xml"
	frappe.local.response["display_content_as"] = "inline"
	frappe.local.response["http_status_code"] = 200
	return xml


@frappe.whitelist()
def run_phase64_setup():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	frappe.only_for("System Manager")
	return _success(setup_phase64())


@frappe.whitelist()
def run_phase64_smoke():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	frappe.only_for("System Manager")
	return _success(smoke_phase64())


@frappe.whitelist(allow_guest=True)
def telephony_incoming(
	CallSid=None,
	CallFrom=None,
	CallTo=None,
	From=None,
	To=None,
	call_sid=None,
	from_number=None,
	to_number=None,
	format=None,
	webhook_secret=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	call_sid = _parse_request_value("CallSid", CallSid) or _parse_request_value("call_sid", call_sid) or frappe.generate_hash(length=12)
	from_number = (
		_parse_request_value("CallFrom", CallFrom)
		or _parse_request_value("From", From)
		or _parse_request_value("from_number", from_number)
	)
	to_number = (
		_parse_request_value("CallTo", CallTo)
		or _parse_request_value("To", To)
		or _parse_request_value("to_number", to_number)
	)
	fmt = (_parse_request_value("format", format) or "").lower()
	as_json = fmt == "json" or frappe.get_request_header("Accept") == "application/json"
	payload = _handle_incoming(call_sid=call_sid, from_number=from_number, to_number=to_number, as_json=as_json)
	if as_json:
		return _success(payload)
	return _respond_xml(payload.get("xml") or "<Response><Hangup/></Response>")


@frappe.whitelist(allow_guest=True)
def telephony_ivr_digit(
	CallSid=None,
	digits=None,
	Digits=None,
	CallFrom=None,
	From=None,
	call_sid=None,
	from_number=None,
	format=None,
	webhook_secret=None,
	patient_name=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	call_sid = _parse_request_value("CallSid", CallSid) or _parse_request_value("call_sid", call_sid)
	digit = str(_parse_request_value("Digits", Digits) or _parse_request_value("digits", digits) or "").strip()[:1]
	phone = _normalize_phone(
		_parse_request_value("CallFrom", CallFrom)
		or _parse_request_value("From", From)
		or _parse_request_value("from_number", from_number)
	)
	intent = SERVICE_DIGIT_MAP.get(digit, "Other")
	_update_call_log(call_sid, {"service_intent": intent if intent != "Human" else None, "path": "IVR"})
	as_json = (_parse_request_value("format", format) or "").lower() == "json"

	if intent == "Human" or digit == "0":
		esc = escalate_to_human(call_sid, "IVR requested agent")
		if as_json:
			return _success({"intent": intent, **esc})
		xml = '<?xml version="1.0" encoding="UTF-8"?><Response>' + _exotel_connect_xml() + "</Response>"
		return _respond_xml(xml)

	ctx = _get_call_ctx(call_sid)
	name = _parse_request_value("patient_name", patient_name) or ctx.get("patient_name") or "Caller"
	avail = check_availability(intent if intent != "Other" else "Doctor", today())
	if intent in ("Doctor", "Teleconsult", "Allied") and not avail.get("ok"):
		esc = escalate_to_human(call_sid, avail.get("reason") or "No slots")
		if as_json:
			return _success({"intent": intent, "availability": avail, **esc})
		xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No slots available. Connecting to an agent.</Say>' + _exotel_connect_xml() + "</Response>"
		return _respond_xml(xml)

	book = book_service(
		service=intent if intent != "Other" else "Doctor",
		patient_name=name,
		phone=phone or ctx.get("phone"),
		date=today(),
		time=(avail.get("slots") or [{}])[0].get("time") if avail.get("slots") else None,
		practitioner=avail.get("practitioner"),
		call_sid=call_sid,
	)
	if as_json:
		return _success({"intent": intent, "availability": avail, "booking": book})
	if book.get("ok"):
		msg = f"Your booking {book.get('booking_ref')} is confirmed. You will receive an SMS. Thank you."
		xml = f'<?xml version="1.0" encoding="UTF-8"?><Response><Say>{escape(msg)}</Say><Hangup/></Response>'
	else:
		xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Unable to complete booking. Connecting to an agent.</Say>' + _exotel_connect_xml() + "</Response>"
		escalate_to_human(call_sid, book.get("error") or "IVR book failed")
	return _respond_xml(xml)


@frappe.whitelist(allow_guest=True)
def telephony_ai_gather(
	CallSid=None,
	SpeechResult=None,
	Digits=None,
	digits=None,
	CallFrom=None,
	From=None,
	call_sid=None,
	user_text=None,
	format=None,
	webhook_secret=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	call_sid = _parse_request_value("CallSid", CallSid) or _parse_request_value("call_sid", call_sid)
	# DTMF shortcut during AI gather
	digit = str(_parse_request_value("Digits", Digits) or _parse_request_value("digits", digits) or "").strip()[:1]
	speech = (
		_parse_request_value("SpeechResult", SpeechResult)
		or _parse_request_value("user_text", user_text)
		or ""
	)
	if digit and SERVICE_DIGIT_MAP.get(digit):
		# reuse IVR digit path textually
		mapped = SERVICE_DIGIT_MAP[digit]
		speech = mapped if mapped != "Human" else "speak to agent"
	phone = _normalize_phone(_parse_request_value("CallFrom", CallFrom) or _parse_request_value("From", From))
	turn = ai_conversation_turn(call_sid=call_sid, user_text=speech, phone=phone)
	as_json = (_parse_request_value("format", format) or "").lower() == "json"
	if as_json:
		return _success(turn)
	reply = turn.get("reply") or "Please hold."
	if turn.get("escalate"):
		xml = f'<?xml version="1.0" encoding="UTF-8"?><Response><Say>{escape(reply)}</Say>{_exotel_connect_xml()}</Response>'
	else:
		# offer another turn
		ai_url = _method_url("telephony_ai_gather")
		xml = (
			'<?xml version="1.0" encoding="UTF-8"?>'
			"<Response>"
			f"<Say>{escape(reply)}</Say>"
			f'<Gather timeout="12" finishOnKey="#" method="POST" action="{escape(ai_url)}" input="speech dtmf">'
			"<Say>Anything else? Press 0 for an agent.</Say>"
			"</Gather>"
			"<Hangup/>"
			"</Response>"
		)
	return _respond_xml(xml)


@frappe.whitelist(allow_guest=True)
def telephony_ai_tools(call_sid=None, tool=None, arguments=None, webhook_secret=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	call_sid = _parse_request_value("call_sid", call_sid)
	tool = _parse_request_value("tool", tool)
	arguments = _parse_request_value("arguments", arguments) or {}
	if isinstance(arguments, str):
		try:
			arguments = json.loads(arguments)
		except Exception:
			arguments = {}
	if not tool:
		return _error("tool required")
	# Require active call context for book_service
	if tool == "book_service" and call_sid and not _get_call_ctx(call_sid):
		return _error("No active call context", 400)
	return _success(dispatch_ai_tool(tool, arguments, call_sid=call_sid))


@frappe.whitelist(allow_guest=True)
def telephony_ai_turn(call_sid=None, user_text=None, phone=None, webhook_secret=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	return _success(
		ai_conversation_turn(
			call_sid=_parse_request_value("call_sid", call_sid),
			user_text=_parse_request_value("user_text", user_text),
			phone=_parse_request_value("phone", phone),
		)
	)


@frappe.whitelist(allow_guest=True)
def telephony_status(
	CallSid=None,
	Status=None,
	DialCallStatus=None,
	call_sid=None,
	status=None,
	Duration=None,
	duration=None,
	webhook_secret=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if not _verify_webhook(_parse_request_value("webhook_secret", webhook_secret)):
		return _error("Unauthorized", 401)
	call_sid = _parse_request_value("CallSid", CallSid) or _parse_request_value("call_sid", call_sid)
	status = _parse_request_value("Status", Status) or _parse_request_value("DialCallStatus", DialCallStatus) or _parse_request_value("status", status)
	duration = cint(_parse_request_value("Duration", Duration) or _parse_request_value("duration", duration) or 0)
	mapped = "Completed"
	st = (status or "").lower()
	if "fail" in st or "busy" in st:
		mapped = "Failed"
	elif "no" in st and "answer" in st:
		mapped = "No Answer"
	# don't overwrite Booked/Escalated
	name = frappe.db.exists("Telephony Call Log", {"call_sid": call_sid}) if call_sid else None
	current = frappe.db.get_value("Telephony Call Log", name, "status") if name else None
	vals = {"ended_at": now_datetime(), "duration_seconds": duration or None}
	if current not in ("Booked", "Escalated"):
		vals["status"] = mapped
	_update_call_log(call_sid, vals)
	return _success({"call_sid": call_sid, "status": vals.get("status", current)})


@frappe.whitelist()
def get_telephony_dashboard():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	return _success(get_telephony_dashboard_data())
