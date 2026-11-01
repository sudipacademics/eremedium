"""Phase 135 smoke: provider onboarding -> verification gate, rates, availability -> slots, D2C bookings (no double
booking, mode validation, payment / hold), B2B clinic sign-up -> approval -> shift -> accept -> complete -> settlement,
tutorials, video token window and participants, e-Rx validation, sign -> PDF / JSON / verify / EMR (idempotent) /
signed webhook, UPI propagation. Commits are suspended for the run and everything is rolled back; _cleanup_smoke is the
backstop (private files written to disk are removed explicitly)."""

from __future__ import annotations

import base64
import json
import os
import secrets
from datetime import timedelta

import frappe
from frappe.utils import add_days, cstr, flt, get_datetime, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core import clinical_emr as emr
from health_ecosystem_core.health_ecosystem_core import clinical_phase135_ud_rx as rxm
from health_ecosystem_core.health_ecosystem_core import clinical_phase135_uberdoc as ud

TAG = "P135 Smoke"
EMAIL_PREFIX = "p135smoke-"
SMOKE_ICD = "U98.9"


def run_smoke():
	setup = ud.setup_phase135()
	out = {"ok": True, "checks": [], "setup": {k: setup.get(k) for k in ("created", "custom_fields", "payment_scopes_added", "scheduler_jobs")}}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:240]})
		if not cond:
			out["ok"] = False

	files = []
	real_save = ud._save_file

	def tracking_save(*args, **kwargs):
		url = real_save(*args, **kwargs)
		files.append(url)
		return url

	real_commit = frappe.db.commit
	real_payments = ud.payments_configured
	conf_before = {k: frappe.local.conf.get(k) for k in ("uberdoc_jitsi_domain", "uberdoc_jitsi_app_id", "uberdoc_jitsi_app_secret", "uberdoc_jaas_kid", "uberdoc_jaas_private_key")}
	user_before = frappe.session.user
	frappe.db.commit = lambda *a, **k: None
	ud._save_file = tracking_save
	rxm._save_file = tracking_save
	ud.payments_configured = lambda: {"online": True, "test_mode": True}
	for key in conf_before:
		frappe.local.conf.pop(key, None)
	frappe.flags.ud_no_notify = True
	frappe.flags.ud_skip_rate_limit = True
	frappe.flags.emr_no_dispatch = True
	frappe.flags.mute_emails = True
	try:
		_scenario(check, frappe.generate_hash(length=5).upper())
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
		out["trace"] = frappe.get_traceback()[-2000:]
	finally:
		frappe.set_user(user_before)
		frappe.db.rollback()
		frappe.db.commit = real_commit
		ud._save_file = real_save
		rxm._save_file = real_save
		ud.payments_configured = real_payments
		for key, value in conf_before.items():
			if value is None:
				frappe.local.conf.pop(key, None)
			else:
				frappe.local.conf[key] = value
		frappe.flags.ud_no_notify = False
		frappe.flags.ud_skip_rate_limit = False
		frappe.flags.emr_no_dispatch = False
		frappe.flags.mute_emails = False
		out["cleanup"] = _cleanup_smoke(files)
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _phone():
	return f"9{secrets.randbelow(10**9):09d}"


def _otp(mobile, code="135790"):
	frappe.cache().set_value(f"hec_otp:{mobile}", {"code": code, "attempts": 0}, expires_in_sec=300)
	return code


def _ctx(user, provider=None, patients=None):
	roles = set(frappe.get_roles(user))
	return frappe._dict(user=user, roles=roles, is_manager=bool(roles & ud.MANAGE_ROLES), provider=provider or ud.provider_for_user(user), clinics=ud.clinics_for_user(user), patients=patients)


def _refused(fn):
	try:
		fn()
	except (frappe.ValidationError, frappe.PermissionError) as exc:
		return cstr(exc) or "refused"
	return None


def _user(email, roles, mobile=None):
	doc = frappe.get_doc({"doctype": "User", "email": email, "first_name": "P135", "last_name": email.split("@")[0][-6:], "send_welcome_email": 0, "user_type": "System User", "mobile_no": mobile, "roles": [{"role": r} for r in roles]})
	doc.insert(ignore_permissions=True)
	return doc.name


def _patient(label, tag, user):
	from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import assign_upi, link_patient_account
	from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_patient

	pid = ensure_patient(patient_name=f"{TAG} {label} {tag}", phone=_phone(), gender="Female", age=34, user=user)
	link_patient_account(user, pid, "Self", is_primary=1, consent=True)
	assign_upi(pid)
	return pid


def _slot(provider, day, hhmm, mode=None):
	slots = ud.provider_slots(provider, day, 1, mode)["days"][0]["slots"]
	want = f"{getdate(day)} {hhmm}:00"
	return next((s for s in slots if s["start"] == want), None)


def _scenario(check, tag):
	low = tag.lower()
	tomorrow = add_days(today(), 1)
	weekday = ud.WEEKDAYS[getdate(tomorrow).weekday()]

	# --- setup -------------------------------------------------------------
	check("roles Clinical Provider / Uber Doc Clinic User / Uber Doc Manager exist", all(frappe.db.exists("Role", r) for r in ud.UD_ROLES))
	dts = (ud.PROVIDER_DT, ud.RULE_DT, ud.TIMEOFF_DT, ud.CUSTOMER_DT, ud.BOOKING_DT, ud.SETTLEMENT_DT, ud.PROGRAM_DT, ud.ENROLL_DT, ud.ICD_DT, rxm.RX_DT, emr.EMR_DT, emr.DELIVERY_DT)
	check("Uber Doc, e-Rx and EMR DocTypes exist", all(frappe.db.exists("DocType", d) for d in dts), [d for d in dts if not frappe.db.exists("DocType", d)])
	check("HEC API Client has webhook_url", frappe.get_meta("HEC API Client").has_field("webhook_url"))
	scope_opts = cstr(frappe.get_meta("HEC Payment Intent").get_field("scope").options).split("\n") if frappe.db.exists("DocType", "HEC Payment Intent") else []
	check("payment scopes uberdoc_consult / uberdoc_clinic_session / program_enrollment", all(s in scope_opts for s in ud.UD_SCOPES), scope_opts)

	# --- provider sign-up + onboarding -------------------------------------
	m_doc, m_yoga = _phone(), _phone()
	pay_doc = {"full_name": f"{TAG} Doctor {tag}", "provider_category": "Doctor", "email": f"{EMAIL_PREFIX}doc-{low}@example.invalid", "city": "Kolkata"}
	check("provider sign-up with a wrong OTP refused", _refused(lambda: (_otp(m_doc), ud.provider_signup(m_doc, "000000", pay_doc, login=False))))
	res = ud.provider_signup(m_doc, _otp(m_doc), pay_doc, login=False)
	doc_p = res["provider"]["name"]
	doc_user = res["provider"]["user"]
	check("doctor sign-up -> Pending with a Website User login", res["provider"]["verification_status"] == "Pending" and frappe.db.get_value("User", doc_user, "user_type") == "Website User")
	check("signed-up provider gets the Clinical Provider role only", ud.ROLE_PROVIDER in frappe.get_roles(doc_user) and ud.otp_login_allowed(doc_user))
	again = ud.provider_signup(m_doc, _otp(m_doc), {**pay_doc, "city": "Howrah"}, login=False)
	check("repeat sign-up updates the pending provider (no duplicate)", again["provider"]["name"] == doc_p and frappe.db.count(ud.PROVIDER_DT, {"user": doc_user}) == 1)
	check("Uber Doc OTP login finds the provider", ud.otp_login(m_doc, _otp(m_doc), login=False)["user"] == doc_user)
	yres = ud.provider_signup(m_yoga, _otp(m_yoga), {"full_name": f"{TAG} Yoga {tag}", "provider_category": "Yoga Instructor"}, login=False)
	yoga_p, yoga_user = yres["provider"]["name"], yres["provider"]["user"]
	dctx, yctx = _ctx(doc_user, doc_p), _ctx(yoga_user, yoga_p)

	check("unverified provider not listed", not any(r["name"] == doc_p for r in ud.search_providers({"q": tag})["rows"]))
	check("unverified provider cannot reach verified-only endpoints", _refused(lambda: ud._context("verified", doc_user, set(frappe.get_roles(doc_user)))))

	ud.save_provider_profile(dctx, {"bio": "Smoke bio", "registration_no": f"SMK{tag}", "registration_council": "Smoke Council", "qualifications": [{"degree": "MBBS", "institution": "Smoke College", "year": 2010}], "languages": "English, Bengali"})
	check("in-person rate without a chamber refused", _refused(lambda: ud.save_rates(dctx, [{"mode": "PHYSICAL", "duration_min": 30, "price_d2c": 500}])))
	check("invalid mode refused", _refused(lambda: ud.save_rates(dctx, [{"mode": "HOME", "duration_min": 30, "price_d2c": 1}])))
	rates = [
		{"mode": "PHYSICAL", "duration_min": 30, "price_d2c": 500, "price_b2b": 300, "chamber_name": f"{TAG} Chamber", "chamber_address": "Smoke Street", "home_visit": 1},
		{"mode": "ONLINE_VIDEO", "duration_min": 30, "price_d2c": 0},
		{"mode": "TELEMEDICINE", "duration_min": 30, "price_d2c": 200},
	]
	saved = ud.save_rates(dctx, rates)
	check("rates per mode saved (B2B price only on in-person)", len(saved["rates"]) == 3 and next(r for r in saved["rates"] if r["mode"] == "ONLINE_VIDEO")["price_b2b"] is None)
	from frappe.utils.pdf import get_pdf

	pdf_b64 = base64.b64encode(get_pdf("<p>P135 smoke credential</p>")).decode()
	cred = ud.upload_credential(dctx, "Registration Certificate", "registration.pdf", pdf_b64)
	cred_url = frappe.db.get_value(ud.CRED_DT, {"parent": doc_p}, "file")
	check("credential stored as a private file", cred["credentials"] and cstr(cred_url).startswith("/private/"), cred_url)
	check("non-PDF / image upload refused", _refused(lambda: ud.upload_credential(dctx, "Other", "x.exe", pdf_b64)))
	rule = {"weekday": weekday, "start_time": "09:00", "end_time": "12:00", "modes": ["PHYSICAL", "ONLINE_VIDEO", "TELEMEDICINE"], "slot_minutes": 30, "chamber_name": f"{TAG} Chamber"}
	ud.save_rule(dctx, rule)
	check("overlapping availability block refused", _refused(lambda: ud.save_rule(dctx, {**rule, "start_time": "11:00", "end_time": "13:00"})))
	check("availability for a mode without a rate refused", _refused(lambda: ud.save_rule(yctx, {**rule, "modes": ["PHYSICAL"]})))
	ud.save_time_off(dctx, {"starts_at": f"{tomorrow} 11:00:00", "ends_at": f"{tomorrow} 12:00:00", "reason": "Smoke"})
	slots = ud.provider_slots(doc_p, tomorrow, 1)["days"][0]["slots"]
	starts = [s["start"][11:16] for s in slots]
	check("slots from availability minus time off", starts == ["09:00", "09:30", "10:00", "10:30"], starts)
	check("provider can submit once complete", ud.submit_for_verification(dctx)["submitted_on"])
	check("verify needs credentials (yoga has none yet)", _refused(lambda: ud.verify_provider(yoga_p, "verify")))
	vp = ud.verify_provider(doc_p, "verify", user="Administrator")
	check("doctor verified, listed, can prescribe medicines", vp["verification_status"] == "Verified" and vp["listed"] and vp["can_prescribe_medicines"])
	check("doctor linked to a Remedium Doctor with the Physician role", vp["doctor"] and frappe.db.get_value("Doctor", vp["doctor"], "user") == doc_user and "Physician" in frappe.get_roles(doc_user))
	ud.save_provider_profile(yctx, {"bio": "Yoga bio", "city": "Kolkata", "qualifications": [{"degree": "Yoga certification"}]})
	ud.save_rates(yctx, [{"mode": "ONLINE_VIDEO", "duration_min": 45, "price_d2c": 0}, {"mode": "TUTORIAL_PROGRAM", "price_d2c": 0}])
	ud.upload_credential(yctx, "Degree Certificate", "yoga.pdf", pdf_b64)
	ud.save_rule(yctx, {"weekday": weekday, "start_time": "07:00", "end_time": "08:30", "modes": ["ONLINE_VIDEO"], "slot_minutes": 45})
	yv = ud.verify_provider(yoga_p, "verify", user="Administrator")
	check("yoga instructor verified without medicine rights", yv["verification_status"] == "Verified" and not yv["can_prescribe_medicines"] and not yv["doctor"])
	found = ud.search_providers({"q": tag, "category": "Doctor"})["rows"]
	check("search lists the verified doctor by category", [r["name"] for r in found] == [doc_p], found)
	check("search by mode filters out providers without it", not any(r["name"] == yoga_p for r in ud.search_providers({"q": tag, "mode": "PHYSICAL"})["rows"]))
	check("B2B search shows the clinic price", any(r["name"] == doc_p and r["rates"][0].get("price_b2b") == 300 for r in ud.search_providers({"q": tag, "customer_type": "B2B_CLINIC"})["rows"]))

	# --- D2C bookings -------------------------------------------------------
	pu1 = _user(f"{EMAIL_PREFIX}pa-{low}@example.invalid", ["Patient"], _phone())
	pu2 = _user(f"{EMAIL_PREFIX}pb-{low}@example.invalid", ["Patient"], _phone())
	pat1, pat2 = _patient("Patient A", tag, pu1), _patient("Patient B", tag, pu2)
	p1, p2 = _ctx(pu1, patients=[pat1]), _ctx(pu2, patients=[pat2])
	upi1 = frappe.db.get_value("Health Patient", pat1, "universal_patient_id")
	b_video = ud.book_d2c(p1, {"provider": doc_p, "mode": "ONLINE_VIDEO", "slot_start": f"{tomorrow} 09:00:00", "consent": 1})
	check("free video booking confirmed with a random room", b_video["status"] == "Confirmed" and b_video["payment_status"] == "Not Required" and cstr(frappe.db.get_value(ud.BOOKING_DT, b_video["name"], "room_name")).startswith("ud-"))
	check("double booking the same slot refused", "no longer available" in cstr(_refused(lambda: ud.book_d2c(p2, {"provider": doc_p, "mode": "TELEMEDICINE", "slot_start": f"{tomorrow} 09:00:00", "consent": 1}))))
	check("TUTORIAL_PROGRAM is not a slot mode", _refused(lambda: ud.book_d2c(p2, {"provider": doc_p, "mode": "TUTORIAL_PROGRAM", "slot_start": f"{tomorrow} 09:30:00"})))
	check("mode the provider does not offer refused", _refused(lambda: ud.book_d2c(p2, {"provider": yoga_p, "mode": "PHYSICAL", "slot_start": f"{tomorrow} 07:00:00"})))
	check("remote consult needs consent", _refused(lambda: ud.book_d2c(p2, {"provider": doc_p, "mode": "TELEMEDICINE", "slot_start": f"{tomorrow} 09:30:00"})))
	check("pay at clinic refused for an online consult", _refused(lambda: ud.book_d2c(p2, {"provider": doc_p, "mode": "TELEMEDICINE", "slot_start": f"{tomorrow} 09:30:00", "payment_mode": "Pay at Clinic", "consent": 1})))
	check("booking for someone else's patient refused", _refused(lambda: ud.book_d2c(p2, {"provider": doc_p, "mode": "PHYSICAL", "slot_start": f"{tomorrow} 09:30:00", "patient": pat1, "payment_mode": "Pay at Clinic"})))
	b_phys = ud.book_d2c(p1, {"provider": doc_p, "mode": "PHYSICAL", "slot_start": f"{tomorrow} 09:30:00", "payment_mode": "Pay at Clinic", "reason": "Smoke"})
	check("in-person pay-at-clinic booking confirmed, unpaid", b_phys["status"] == "Confirmed" and b_phys["payment_status"] == "Unpaid" and b_phys["chamber_name"] == f"{TAG} Chamber")
	apt = frappe.db.get_value(ud.BOOKING_DT, b_phys["name"], "doctor_appointment")
	check("doctor booking mirrored as a Remedium Doctor Appointment", apt and frappe.db.get_value("Doctor Appointment", apt, "uberdoc_booking") == b_phys["name"], apt)
	profile = frappe.db.get_value(ud.BOOKING_DT, b_phys["name"], "customer_profile")
	check("one D2C profile per patient carrying the UPI", profile == frappe.db.get_value(ud.BOOKING_DT, b_video["name"], "customer_profile") and frappe.db.get_value(ud.CUSTOMER_DT, profile, "universal_patient_id") == upi1 and frappe.db.count(ud.CUSTOMER_DT, {"d2c_key": pat1}) == 1)
	check("UPI propagated to the booking", b_phys["universal_patient_id"] == upi1 and upi1)
	b_tele = ud.book_d2c(p2, {"provider": doc_p, "mode": "TELEMEDICINE", "slot_start": f"{tomorrow} 10:00:00", "consent": 1})
	check("paid online booking held as Requested / Pending", b_tele["status"] == "Requested" and b_tele["payment_status"] == "Pending" and b_tele["hold_expires_at"])
	check("held slot is not offered", _slot(doc_p, tomorrow, "10:00") is None)
	paid = ud.complete_payment(ud.BOOKING_DT, b_tele["name"], f"order_smoke_{low}", f"pay_smoke_{low}", "Webhook")
	check("payment confirms the booking (webhook path)", paid["status"] == "Confirmed" and frappe.db.get_value(ud.BOOKING_DT, b_tele["name"], "payment_status") == "Paid")
	check("payment completion is idempotent", ud.complete_payment(ud.BOOKING_DT, b_tele["name"], f"order_smoke_{low}", f"pay_smoke_{low}", "Poller")["already_paid"])
	b_hold = ud.book_d2c(p2, {"provider": doc_p, "mode": "TELEMEDICINE", "slot_start": f"{tomorrow} 10:30:00", "consent": 1})
	frappe.db.set_value(ud.BOOKING_DT, b_hold["name"], "hold_expires_at", now_datetime() - timedelta(minutes=1))
	check("lapsed hold released by the scheduler", ud.ud_expire_holds(only=[b_hold["name"]])["bookings"] == 1 and _slot(doc_p, tomorrow, "10:30") is not None)

	# --- video window + participants ---------------------------------------
	check("room closed before the window", "opens at" in cstr(_refused(lambda: ud.join_room(p1, b_video["name"]))))
	now = now_datetime().replace(microsecond=0)
	frappe.db.set_value(ud.BOOKING_DT, b_video["name"], {"slot_start": now + timedelta(minutes=5), "slot_end": now + timedelta(minutes=35)})
	pub = ud.join_room(p1, b_video["name"])
	check("public fallback: random room, no token, warning", pub["provider_kind"] == "public" and pub["jwt"] is None and pub["warning"] and pub["room"].startswith("ud-"))
	frappe.local.conf.update({"uberdoc_jitsi_domain": "meet.smoke.invalid", "uberdoc_jitsi_app_id": "smokeapp", "uberdoc_jitsi_app_secret": "smoke-secret"})
	jp = ud.join_room(p1, b_video["name"])
	claims = ud.decode_hs256(jp["jwt"], "smoke-secret")
	room = frappe.db.get_value(ud.BOOKING_DT, b_video["name"], "room_name")
	window_end = get_datetime(frappe.db.get_value(ud.BOOKING_DT, b_video["name"], "slot_end")) + timedelta(minutes=ud.JOIN_GRACE_MINUTES)
	check("HS256 token bound to this booking's room", claims and claims["room"] == room and claims["iss"] == "smokeapp" and jp["url"].startswith("https://meet.smoke.invalid/"))
	check("token expires at slot end + grace", claims and abs(claims["exp"] - ud._epoch(window_end)) <= 2, claims)
	check("patient is not moderator", claims and claims["moderator"] is False)
	check("token rejected with another secret", ud.decode_hs256(jp["jwt"], "other") is None)
	jd = ud.join_room(dctx, b_video["name"])
	check("provider joins as moderator and the consult starts", ud.decode_hs256(jd["jwt"], "smoke-secret")["moderator"] is True and frappe.db.get_value(ud.BOOKING_DT, b_video["name"], "status") == "In Consultation")
	check("non-participant cannot join", _refused(lambda: ud.join_room(p2, b_video["name"])))
	check("in-person booking has no room", _refused(lambda: ud.join_room(p1, b_phys["name"])))
	frappe.db.set_value(ud.BOOKING_DT, b_tele["name"], {"slot_start": now - timedelta(minutes=80), "slot_end": now - timedelta(minutes=50)})
	check("room closed after slot end + grace", "closed" in cstr(_refused(lambda: ud.join_room(p2, b_tele["name"]))))
	ud.post_message(p2, b_tele["name"], "Smoke question")
	thread = ud.post_message(dctx, b_tele["name"], "Smoke answer")
	check("telemedicine thread between patient and provider", [m["sender_role"] for m in thread["messages"]] == ["Patient", "Provider"])
	check("outsider cannot post", _refused(lambda: ud.post_message(p1, b_tele["name"], "x")))

	# --- B2B clinic ----------------------------------------------------------
	m_clinic = _phone()
	cres = ud.clinic_signup(m_clinic, _otp(m_clinic), {"clinic_name": f"{TAG} Clinic {tag}", "contact_person": "Smoke", "chambers": [{"chamber_name": "Room 1", "address": "Smoke Road"}]}, login=False)
	clinic = cres["clinic"]["name"]
	cuser = cres["clinic"]["users"][0]["user"]
	check("clinic sign-up -> Pending Approval", cres["clinic"]["status"] == "Pending Approval")
	cctx = _ctx(cuser)
	shift = {"provider": doc_p, "chamber_name": "Room 1", "slot_start": f"{tomorrow} 14:00:00", "slot_end": f"{tomorrow} 16:00:00", "session_count": 6}
	check("pending clinic cannot request shifts", _refused(lambda: ud.request_shift(cctx, shift)))
	check("reject needs a reason", _refused(lambda: ud.clinic_action(clinic, "reject", "")))
	ud.clinic_action(clinic, "approve", user="Administrator")
	check("approval activates and grants the clinic role", ud.ROLE_CLINIC in frappe.get_roles(cuser))
	cctx = _ctx(cuser)
	req = ud.request_shift(cctx, shift)
	check("shift request -> Requested at clinic price x sessions", req["status"] == "Requested" and flt(req["price"]) == 1800 and req["provider_response"] == "Pending")
	s14, e16 = get_datetime(shift["slot_start"]), get_datetime(shift["slot_end"])
	check("unaccepted clinic request does not hold the provider's time", not ud._overlaps(ud.busy_intervals(doc_p, s14, e16), s14, e16))
	check("decline needs a reason", _refused(lambda: ud.provider_respond(dctx, req["name"], 0, "")))
	acc = ud.provider_respond(dctx, req["name"], 1)
	check("provider accepts -> Confirmed", acc["status"] == "Confirmed" and acc["provider_response"] == "Accepted")
	check("overlapping shift request refused once accepted", _refused(lambda: ud.request_shift(cctx, {**shift, "slot_start": f"{tomorrow} 15:00:00", "slot_end": f"{tomorrow} 17:00:00"})))
	req2 = ud.request_shift(cctx, {**shift, "slot_start": f"{tomorrow} 17:00:00", "slot_end": f"{tomorrow} 18:00:00", "session_count": 2})
	dec = ud.provider_respond(dctx, req2["name"], 0, "Not available")
	check("declined request cancelled", dec["status"] == "Cancelled" and dec["provider_response"] == "Declined")
	frappe.db.set_value(ud.BOOKING_DT, req["name"], {"slot_start": now - timedelta(hours=2), "slot_end": now - timedelta(minutes=5)})
	ud.provider_set_status(dctx, req["name"], "Checked In")
	done = ud.provider_set_status(dctx, req["name"], "Completed")
	sett = frappe.db.get_value(ud.BOOKING_DT, req["name"], "settlement")
	check("completed shift accrues on a draft clinic settlement", done["status"] == "Completed" and sett and flt(frappe.db.get_value(ud.SETTLEMENT_DT, sett, "total_amount")) == 1800)
	check("clinic sees its settlement", any(r["name"] == sett for r in ud.list_settlements(cctx)["rows"]))
	ud.settlement_action(sett, "invoice", invoice_no=f"SMK-{tag}")
	check("settlement invoiced then paid offline", ud.settlement_action(sett, "mark_paid", payment_mode="Bank Transfer", payment_ref="SMK")["status"] == "Paid")

	# --- tutorials -----------------------------------------------------------
	prog = ud.save_program(yctx, {"title": f"{TAG} Programme {tag}", "category": "Yoga", "format": "Recorded", "price": 0, "modules": [{"title": "Intro", "video_url": "https://example.invalid/intro", "is_preview": 1, "duration_min": 10}, {"title": "Flow", "video_url": "https://example.invalid/flow", "duration_min": 20}]})
	check("non-https module link refused", _refused(lambda: ud.save_program(yctx, {"name": prog["name"], "modules": [{"title": "X", "video_url": "http://x"}]})))
	ud.submit_program(yctx, prog["name"])
	ud.moderate_program(prog["name"], "publish", user="Administrator")
	pub_view = ud.public_program(None, prog["name"])
	check("library: preview unlocked, other modules locked", pub_view["modules"][0]["video_url"] and pub_view["modules"][1]["locked"] and not pub_view["modules"][1]["video_url"])
	enr = ud.enroll(p1, prog["name"])
	check("free programme enrollment active with a TUTORIAL_PROGRAM booking", enr["status"] == "Active" and frappe.db.get_value(ud.BOOKING_DT, enr["booking"], "mode") == "TUTORIAL_PROGRAM")
	unlocked = ud.public_program(p1, prog["name"])
	check("enrolled patient sees all modules", all(m["video_url"] for m in unlocked["modules"]))
	rows = [m["name"] for m in unlocked["modules"]]
	half = ud.set_progress(p1, enr["name"], rows[0], 1)
	full = ud.set_progress(p1, enr["name"], rows[1], 1)
	check("progress tracked to completion", half["progress_pct"] == 50 and full["status"] == "Completed" and frappe.db.get_value(ud.BOOKING_DT, enr["booking"], "status") == "Completed")
	paid_prog = ud.save_program(yctx, {"title": f"{TAG} Paid {tag}", "category": "Exercise", "price": 999, "modules": [{"title": "Week 1", "video_url": "https://example.invalid/w1"}]})
	ud.submit_program(yctx, paid_prog["name"])
	ud.moderate_program(paid_prog["name"], "publish", user="Administrator")
	penr = ud.enroll(p2, paid_prog["name"])
	ud.complete_payment(ud.ENROLL_DT, penr["name"], f"order_prog_{low}", f"pay_prog_{low}", "Webhook")
	check("paid programme: Pending Payment -> Active on payment", penr["status"] == "Pending Payment" and frappe.db.get_value(ud.ENROLL_DT, penr["name"], "status") == "Active")

	# --- e-Rx ----------------------------------------------------------------
	client = None
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import create_api_client

		client = create_api_client(f"{TAG} EMR {tag}", "Ancillary App", ["emr:webhook"])
		frappe.db.set_value("HEC API Client", client["name"], "webhook_url", "https://example.invalid/emr-hook")
	except Exception as exc:
		check("EMR webhook API client created", False, exc)
	b_y = ud.book_d2c(p2, {"provider": yoga_p, "mode": "ONLINE_VIDEO", "slot_start": f"{tomorrow} 07:00:00", "consent": 1})
	yrx = rxm.start_rx(yctx, b_y["name"])
	check("non-doctor cannot prescribe medicines", "doctors" in cstr(_refused(lambda: rxm.save_rx(yctx, yrx["name"], {"medications": [{"drug_name": "Smoke drug", "frequency": "1-0-1", "duration": "3 days"}]}))))
	rxm.save_rx(yctx, yrx["name"], {"complaints": [{"complaint": "Back stiffness"}], "exercises": [{"tutorial_program": prog["name"], "sets": 2, "frequency": "Daily"}, {"exercise_name": "Cat-cow", "reps": 10}]})
	ysigned = rxm.sign_rx(yctx, yrx["name"])
	check("yoga plan signs with the programme linked", ysigned["status"] == "Signed" and ysigned["exercises"][0]["exercise_name"] == prog["title"] and not ysigned["medications"])
	check("doctor cannot open a prescription on another provider's booking", _refused(lambda: rxm.start_rx(dctx, b_y["name"])))
	drx = rxm.start_rx(dctx, b_phys["name"])
	check("prescription pad pre-fills patient + UPI", drx["patient"] == pat1 and drx["universal_patient_id"] == upi1 and drx["status"] == "Draft")
	check("starting again returns the same draft", rxm.start_rx(dctx, b_phys["name"])["name"] == drx["name"])
	check(
		"ICD normalisation J069 -> J06.9, FY2027 QA171 -> QA1.71 accepted, malformed codes refused",
		rxm.normalize_icd("j069") == "J06.9" and rxm.valid_icd("J06.9") and rxm.valid_icd(rxm.normalize_icd("qa171")) and not rxm.valid_icd("1AB") and not rxm.valid_icd("XY"),
	)
	check("invalid ICD code refused", _refused(lambda: rxm.save_rx(dctx, drx["name"], {"diagnoses": [{"icd_code": "12AB", "description": "x"}]})))
	check("diastolic >= systolic refused", _refused(lambda: rxm.save_rx(dctx, drx["name"], {"bp_systolic": 80, "bp_diastolic": 90})))
	check("signing an empty prescription refused", _refused(lambda: rxm.sign_rx(dctx, drx["name"])))
	items = frappe.get_all("Item", filters={"disabled": 0, "is_sales_item": 1}, pluck="name", limit=1)
	meds = [{"drug_name": "Smoke Paracetamol", "strength": "500 mg", "frequency": "1-0-1", "duration": "3 days", "timing": "After Food"}]
	if items:
		meds.append({"medicine_item": items[0], "frequency": "0-0-1", "duration": "5 days"})
	payload = {
		"complaints": [{"complaint": "Fever", "duration": "2 days"}],
		"diagnoses": [{"icd_code": SMOKE_ICD.replace(".", ""), "description": f"{TAG} diagnosis"}],
		"bp_systolic": 120,
		"bp_diastolic": 80,
		"pulse": 78,
		"weight_kg": 70,
		"height_cm": 175,
		"spo2": 98,
		"medications": meds,
		"tests": [{"test_name": "CBC"}],
		"exercises": [{"exercise_name": "Walk", "duration_min": 20, "frequency": "Daily"}],
		"advice": "Fluids and rest",
		"follow_up_date": cstr(add_days(today(), 7)),
	}
	saved_rx = rxm.save_rx(dctx, drx["name"], payload)
	check("BMI computed from weight and height", saved_rx["vitals"]["bmi"] == 22.9, saved_rx["vitals"])
	check("ICD stored normalised", saved_rx["diagnoses"][0]["icd_code"] == SMOKE_ICD)
	check("patient cannot see a draft", _refused(lambda: rxm._rx_doc(p1, drx["name"])))
	frappe.db.set_value(ud.PROVIDER_DT, doc_p, "verification_status", "Suspended")
	check("suspended provider cannot sign", _refused(lambda: rxm.sign_rx(dctx, drx["name"])))
	frappe.db.set_value(ud.PROVIDER_DT, doc_p, "verification_status", "Verified")
	signed = rxm.sign_rx(dctx, drx["name"])
	check("doctor prescription signed with a verify code", signed["status"] == "Signed" and len(cstr(signed["verify_code"])) == 12 and signed["has_pdf"])
	rx_doc = frappe.get_doc(rxm.RX_DT, drx["name"])
	pdf = frappe.get_doc("File", {"file_url": rx_doc.pdf_file}).get_content() if rx_doc.pdf_file else b""
	pdf = pdf.encode() if isinstance(pdf, str) else pdf
	check("signed PDF is a non-empty private file", rx_doc.pdf_file and rx_doc.pdf_file.startswith("/private/") and len(pdf) > 1000 and pdf[:4] == b"%PDF", len(pdf))
	data = json.loads(rx_doc.rx_json)
	check("canonical JSON has the structured sections", data["schema"] == rxm.SCHEMA and data["medications"][0]["frequency"] == "1-0-1" and data["vitals"]["bmi"] == 22.9 and data["diagnoses"][0]["icd_code"] == SMOKE_ICD)
	check("content hash matches the JSON", rxm.content_sha(data) == rx_doc.signature_hash == data["signature"]["content_hash"])
	ver = rxm.verify_rx(rx_doc.verify_code)
	check("public verify: valid, hash intact, patient masked", ver["valid"] and ver["hash_matches"] and ver["patient"]["initials"] and "patient_id" not in ver["patient"] and TAG not in cstr(ver["patient"]))
	check("unknown verify code refused", _refused(lambda: rxm.verify_rx("ABCDEFGHJKLM")))
	check("signed prescription is immutable", _refused(lambda: rxm.save_rx(dctx, drx["name"], {"advice": "x"})))
	check("UPI on the prescription", rx_doc.universal_patient_id == upi1)
	emr_rows = frappe.get_all(emr.EMR_DT, filters={"source_doctype": rxm.RX_DT, "source_name": drx["name"]}, fields=["name", "universal_patient_id", "file", "version"], limit=5)
	check("EMR Record upserted once with the PDF and UPI", len(emr_rows) == 1 and emr_rows[0].universal_patient_id == upi1 and emr_rows[0].file == rx_doc.pdf_file, emr_rows)
	again = rxm.push_emr(drx["name"])
	check("EMR upsert is idempotent", not again["changed"] and again["name"] == emr_rows[0].name and frappe.db.count(emr.EMR_DT, {"source_name": drx["name"]}) == 1)
	if client:
		deliveries = frappe.get_all(emr.DELIVERY_DT, filters={"emr_record": emr_rows[0].name, "api_client": client["name"]}, pluck="name")
		check("webhook delivery queued for the emr:webhook client", len(deliveries) == 1, deliveries)
		captured = {}

		def sender(url, body, headers):
			captured.update({"url": url, "body": body, "headers": headers})
			return 200, ""

		res = emr.deliver(deliveries[0], sender=sender)
		h = captured.get("headers") or {}
		check("webhook body HMAC-SHA256 signed with the client secret", res["status"] == "Delivered" and emr.verify_webhook_signature(client["api_secret"], h.get("X-Hec-Timestamp"), captured.get("body"), h.get("X-Hec-Signature")))
		check("webhook payload carries the record and UPI", json.loads(captured.get("body") or "{}").get("record", {}).get("universal_patient_id") == upi1)
		check("tampered body fails the signature", not emr.verify_webhook_signature(client["api_secret"], h.get("X-Hec-Timestamp"), cstr(captured.get("body")) + " ", h.get("X-Hec-Signature")))
	cp = rx_doc.clinical_prescription
	if items:
		check("catalogue medicines mirrored to a submitted Clinical Prescription", cp and frappe.db.get_value("Clinical Prescription", cp, "digital_prescription") == drx["name"] and frappe.db.get_value("Clinical Prescription", cp, "status") == "Submitted")
	check("booking links the signed prescription", frappe.db.get_value(ud.BOOKING_DT, b_phys["name"], "prescription") == drx["name"])
	cancelled = rxm.cancel_rx(dctx, drx["name"], "Smoke cancel")
	check("cancel bumps the EMR record version and re-pushes", cancelled["status"] == "Cancelled" and cancelled["emr"]["changed"] and cancelled["emr"]["version"] == 2 and (not client or frappe.db.count(emr.DELIVERY_DT, {"emr_record": emr_rows[0].name}) == 2))
	check("verify shows the cancellation", rxm.verify_rx(rx_doc.verify_code)["valid"] is False)
	if client:
		failing = frappe.get_all(emr.DELIVERY_DT, filters={"emr_record": emr_rows[0].name, "status": "Pending"}, pluck="name")
		if failing:
			first = emr.deliver(failing[0], sender=lambda u, b, h: (500, "smoke"))
			nxt = frappe.db.get_value(emr.DELIVERY_DT, failing[0], "next_attempt_at")
			for _i in range(emr.MAX_ATTEMPTS):
				emr.deliver(failing[0], sender=lambda u, b, h: (500, "smoke"))
			check("failed delivery retries with backoff then fails", first["status"] == "Pending" and get_datetime(nxt) > now_datetime() and frappe.db.get_value(emr.DELIVERY_DT, failing[0], "status") == "Failed")
	check("no-show only after the slot starts", _refused(lambda: ud.provider_set_status(yctx, b_y["name"], "No Show")))
	check("patient sees signed prescriptions only", all(r["status"] != "Draft" for r in rxm.my_prescriptions(p2)["rows"]) and any(r["name"] == yrx["name"] for r in rxm.my_prescriptions(p2)["rows"]))


def _cleanup_smoke(files):
	"""Backstop if anything survived the rollback; also removes the private files written to disk."""
	removed = {}
	for url in files or []:
		try:
			path = frappe.get_site_path(*cstr(url).lstrip("/").split("/"))
			if os.path.isfile(path):
				os.remove(path)
				removed["disk_files"] = removed.get("disk_files", 0) + 1
		except Exception:
			pass
	providers = frappe.get_all(ud.PROVIDER_DT, filters={"full_name": ("like", f"{TAG}%")}, pluck="name") if frappe.db.exists("DocType", ud.PROVIDER_DT) else []
	clinics = frappe.get_all(ud.CUSTOMER_DT, filters={"display_name": ("like", f"{TAG}%")}, pluck="name") if frappe.db.exists("DocType", ud.CUSTOMER_DT) else []
	patients = frappe.get_all("Health Patient", filters={"patient_name": ("like", f"{TAG}%")}, pluck="name")
	users = frappe.get_all("User", filters={"name": ("like", f"{EMAIL_PREFIX}%@example.invalid")}, pluck="name")
	if providers:
		users += frappe.get_all(ud.PROVIDER_DT, filters={"name": ("in", providers)}, pluck="user")
		bookings = frappe.get_all(ud.BOOKING_DT, filters={"provider": ("in", providers)}, pluck="name")
		rxs = frappe.get_all(rxm.RX_DT, filters={"provider": ("in", providers)}, pluck="name")
		if rxs:
			records = frappe.get_all(emr.EMR_DT, filters={"source_name": ("in", rxs)}, pluck="name")
			if records:
				frappe.db.delete(emr.DELIVERY_DT, {"emr_record": ("in", records)})
				frappe.db.delete(emr.EMR_DT, {"name": ("in", records)})
			cps = frappe.get_all("Clinical Prescription", filters={"digital_prescription": ("in", rxs)}, pluck="name") if frappe.get_meta("Clinical Prescription").has_field("digital_prescription") else []
			for child in ("Prescription Medicine", "Prescription Diagnostic"):
				if cps:
					frappe.db.delete(child, {"parent": ("in", cps)})
			if cps:
				frappe.db.delete("Clinical Prescription", {"name": ("in", cps)})
			for child in (rxm.COMPLAINT_DT, rxm.DIAGNOSIS_DT, rxm.MEDICATION_DT, rxm.TEST_DT, rxm.EXERCISE_DT):
				frappe.db.delete(child, {"parent": ("in", rxs)})
			frappe.db.delete("File", {"attached_to_doctype": rxm.RX_DT, "attached_to_name": ("in", rxs)})
			frappe.db.delete(rxm.RX_DT, {"name": ("in", rxs)})
			removed["prescriptions"] = len(rxs)
		if bookings:
			if frappe.get_meta("Doctor Appointment").has_field("uberdoc_booking"):
				frappe.db.delete("Doctor Appointment", {"uberdoc_booking": ("in", bookings)})
			frappe.db.delete(ud.MSG_DT, {"parent": ("in", bookings)})
			frappe.db.delete(ud.BOOKING_DT, {"name": ("in", bookings)})
			removed["bookings"] = len(bookings)
		setts = frappe.get_all(ud.SETTLEMENT_DT, filters={"provider": ("in", providers)}, pluck="name")
		if setts:
			frappe.db.delete(ud.SETTLE_LINE_DT, {"parent": ("in", setts)})
			frappe.db.delete(ud.SETTLEMENT_DT, {"name": ("in", setts)})
		programs = frappe.get_all(ud.PROGRAM_DT, filters={"provider": ("in", providers)}, pluck="name")
		if programs:
			enrolls = frappe.get_all(ud.ENROLL_DT, filters={"program": ("in", programs)}, pluck="name")
			if enrolls:
				frappe.db.delete(ud.PROGRESS_DT, {"parent": ("in", enrolls)})
				frappe.db.delete(ud.ENROLL_DT, {"name": ("in", enrolls)})
			frappe.db.delete(ud.MODULE_DT, {"parent": ("in", programs)})
			frappe.db.delete(ud.PROGRAM_DT, {"name": ("in", programs)})
		frappe.db.delete(ud.RULE_DT, {"provider": ("in", providers)})
		frappe.db.delete(ud.TIMEOFF_DT, {"provider": ("in", providers)})
		doctors = [d for d in frappe.get_all(ud.PROVIDER_DT, filters={"name": ("in", providers)}, pluck="doctor") if d]
		if doctors:
			frappe.db.delete("Doctor", {"name": ("in", doctors), "doctor_name": ("like", f"{TAG}%")})
		for child in (ud.QUAL_DT, ud.CRED_DT, ud.RATE_DT):
			frappe.db.delete(child, {"parent": ("in", providers)})
		frappe.db.delete("File", {"attached_to_doctype": ud.PROVIDER_DT, "attached_to_name": ("in", providers)})
		frappe.db.delete(ud.PROVIDER_DT, {"name": ("in", providers)})
		removed["providers"] = len(providers)
	if patients:
		clinics += frappe.get_all(ud.CUSTOMER_DT, filters={"health_patient": ("in", patients)}, pluck="name")
		if frappe.db.exists("DocType", "Patient Vital Log"):
			frappe.db.delete("Patient Vital Log", {"patient": ("in", patients)})
	if clinics:
		users += frappe.get_all(ud.CUST_USER_DT, filters={"parent": ("in", clinics), "user": ("like", f"%@{ud.USER_EMAIL_DOMAIN}")}, pluck="user")
		frappe.db.delete(ud.CHAMBER_DT, {"parent": ("in", clinics)})
		frappe.db.delete(ud.CUST_USER_DT, {"parent": ("in", clinics)})
		frappe.db.delete(ud.CUSTOMER_DT, {"name": ("in", clinics)})
		removed["customer_profiles"] = len(set(clinics))
	for p in patients:
		frappe.db.delete("Patient Account Link", {"patient": p})
		frappe.db.delete("Patient Care Journey", {"patient": p})
		frappe.db.delete("Health Patient", {"name": p})
	if patients:
		removed["patients"] = len(patients)
	if frappe.db.exists("DocType", ud.ICD_DT):
		frappe.db.delete(ud.ICD_DT, {"description": ("like", f"{TAG}%")})
	clients = frappe.get_all("HEC API Client", filters={"client_name": ("like", f"{TAG}%")}, pluck="name") if frappe.db.exists("DocType", "HEC API Client") else []
	if clients:
		frappe.db.delete(emr.DELIVERY_DT, {"api_client": ("in", clients)})
		frappe.db.delete("HEC API Client", {"name": ("in", clients)})
	users = sorted({u for u in users if u and (u.startswith(EMAIL_PREFIX) or u.endswith(f"@{ud.USER_EMAIL_DOMAIN}"))})
	for u in users:
		frappe.db.delete("Has Role", {"parent": u})
		frappe.db.delete("User", {"name": u})
	if users:
		removed["users"] = len(users)
	frappe.db.commit()
	return f"removed {removed}" if removed else "clean"
