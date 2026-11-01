"""Phase 136 smoke: REM-UID format / check character / uniqueness / immutability, one-time re-issue + copy rewrite +
legacy alias, registration + dedupe, QR card (no PHI, HMAC, masked public view, rotation), logged ID lookups (staff,
signed API client, refusals), EMR aggregation from authorized lab reports (analyte parsing, trends), prescriptions,
vitals and uploads, e-Rx -> medication schedules -> checklist -> dose log -> missed job -> adherence, goals fed by labs /
vitals / checklist, tip selection rules, opt-in WhatsApp (muted) and patient-only separation.

Commits are suspended for the run and everything is rolled back; _cleanup_smoke is the backstop (private files written
to disk are removed explicitly). Source documents are written with db_insert so no other module's hooks fire."""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta

import frappe
from frappe.utils import add_days, cint, cstr, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core import clinical_barcodes as bc
from health_ecosystem_core.health_ecosystem_core import clinical_emr as emr
from health_ecosystem_core.health_ecosystem_core import clinical_phase132_foundations as p132
from health_ecosystem_core.health_ecosystem_core import clinical_phase136_emr as vemr
from health_ecosystem_core.health_ecosystem_core import clinical_phase136_lifestyle as life
from health_ecosystem_core.health_ecosystem_core import clinical_phase136_patient_iam as iam
from health_ecosystem_core.health_ecosystem_core import patient_bridge as pb

TAG = "P136 Smoke"
EMAIL_PREFIX = "p136smoke-"
OTP = "136790"
PATIENT_DT = p132.PATIENT_DT
UPI = p132.UPI_FIELD
LEGACY = p132.LEGACY_UPI_FIELD


def run_smoke():
	setup = iam.setup_phase136(backfill=0)
	out = {
		"ok": True,
		"checks": [],
		"setup": {k: setup.get(k) for k in ("created", "uid_migration", "tips", "scheduler_jobs", "icd_fy2027_qa", "patients_total", "patients_not_rem_uid", "config")},
	}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:240]})
		if not cond:
			out["ok"] = False

	state = {"files": [], "mobiles": []}
	real_commit = frappe.db.commit
	user_before = frappe.session.user
	flags = ("vault_no_notify", "vault_skip_rate_limit", "vault_inline_sync", "emr_no_dispatch", "ud_no_notify", "mute_emails")
	frappe.db.commit = lambda *a, **k: None
	for flag in flags:
		frappe.flags[flag] = True
	try:
		_scenario(check, setup, state, frappe.generate_hash(length=5).upper())
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
		out["trace"] = frappe.get_traceback()[-2000:]
	finally:
		frappe.set_user(user_before)
		frappe.db.rollback()
		frappe.db.commit = real_commit
		for flag in flags:
			frappe.flags[flag] = False
		out["cleanup"] = _cleanup_smoke(state)
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _refused(fn):
	try:
		fn()
	except (frappe.ValidationError, frappe.PermissionError, frappe.AuthenticationError) as exc:
		return cstr(exc) or "refused"
	return None


def _phone(state):
	mobile = f"9{secrets.randbelow(10**9):09d}"
	state["mobiles"].append(mobile)
	return mobile


def _otp(mobile):
	frappe.cache().set_value(f"hec_otp:{mobile}", {"code": OTP, "attempts": 0}, expires_in_sec=300)
	return OTP


def _enabled_roles(roles):
	"""User.insert silently drops disabled Roles, so only hand it enabled ones."""
	has_disabled = frappe.get_meta("Role").has_field("disabled")
	return [r for r in roles if frappe.db.exists("Role", {"name": r, "disabled": 0} if has_disabled else r)]


def _staff_role():
	return next(iter(_enabled_roles(("Lab Technician", "Pathologist", "Lab Manager", "Health System Admin", "System Manager"))), "System Manager")


def _user(email, roles, mobile=None):
	roles = _enabled_roles(roles)
	doc = frappe.get_doc({"doctype": "User", "email": email, "first_name": "P136", "last_name": email.split("@")[0][-6:], "send_welcome_email": 0, "user_type": "System User" if set(roles) - {"Patient"} else "Website User", "mobile_no": mobile, "roles": [{"role": r} for r in roles]})
	doc.insert(ignore_permissions=True)
	return doc.name


def _db_insert(values):
	"""Write a source document and its child rows without controllers or doc events."""
	doc = frappe.get_doc(values)
	doc.flags.ignore_links = True
	doc.flags.ignore_mandatory = True
	doc.set_new_name()
	doc.set_parent_in_children()
	doc.db_insert()
	for child in doc.get_all_children():
		child.db_insert()
	return doc.name


def _trf(tag, patient=None, uid=None, phone=None):
	values = {"doctype": "Customer TRF", "patient_name": f"{TAG} TRF {tag}", "patient_phone": phone, "order_status": "Completed", "unique_barcode": f"P136-{frappe.generate_hash(length=10).upper()}"}
	if patient and p132._has_field("Customer TRF", "health_patient"):
		values["health_patient"] = patient
	if uid and p132._has_field("Customer TRF", UPI):
		values[UPI] = uid
	return _db_insert(values)


def _lab_report(trf, days_ago, params, status="Authorized"):
	when = now_datetime() - timedelta(days=days_ago)
	rows = []
	for p in params:
		row = {"include_in_report": 1, "result_input_type": "Numeric", "lower_range": 0, "upper_range": 0}
		row.update(p)
		rows.append(row)
	return _db_insert({"doctype": "Lab Report", "customer_trf": trf, "report_status": status, "department": "Biochemistry", "sample_date": when, "report_date": when, "parameters": rows})


def _ctx(user):
	return iam.make_ctx(user)


def _payload(name, **extra):
	return {"patient_name": name, "dob": "1988-04-12", "gender": "Female", "consent": 1, **extra}


def _scenario(check, setup, state, tag):
	low = tag.lower()
	today_ = getdate(today())

	# --- setup -------------------------------------------------------------
	dts = (iam.PROFILE_DT, iam.LOOKUP_DT, iam.REISSUE_DT, vemr.POINT_DT, life.GOAL_DT, life.ENTRY_DT, life.TIP_DT, life.TIP_DELIVERY_DT, life.SCHEDULE_DT, life.DOSE_DT, life.ROUTINE_DT, life.ROUTINE_LOG_DT, life.REMINDER_DT)
	check("vault DocTypes exist", all(frappe.db.exists("DocType", d) for d in dts), [d for d in dts if not frappe.db.exists("DocType", d)])
	lf = frappe.get_meta(PATIENT_DT).get_field(LEGACY)
	check("Health Patient.legacy_upi exists and is indexed", lf and cint(lf.search_index))
	check("every patient carries a REM-UID after setup", setup.get("patients_not_rem_uid") == 0, setup.get("patients_not_rem_uid"))

	# --- Unique Patient ID --------------------------------------------------
	uids = {bc.make_uid() for _i in range(2000)}
	check("2000 random REM-UIDs: unique, REM-UID-XXXXXXXX, check character valid", len(uids) == 2000 and all(bc.UID_RE.match(u) and p132.validate_upi(u) for u in uids))
	body = sorted(uids)[0][len(bc.UID_PREFIX) :]
	subs = [body[:i] + ch + body[i + 1 :] for i in range(8) for ch in bc.CROCKFORD_ALPHABET if ch != body[i]]
	check("every single-character substitution is rejected", subs and not any(bc.damm32_validate(s) for s in subs), len(subs))
	swaps = [body[:i] + body[i + 1] + body[i] + body[i + 2 :] for i in range(7) if body[i] != body[i + 1]]
	check("every adjacent transposition is rejected", not any(bc.damm32_validate(s) for s in swaps), len(swaps))
	vec = bc.make_uid("0110ABC")
	check("normalisation: case, spaces / hyphens, O -> 0, I / L -> 1", bc.normalize_uid(f" rem uid oil0abc{vec[-1].lower()} ") == vec and p132.validate_upi(vec))
	check(
		"vector ABCDEFG -> REM-UID-ABCDEFGC, labelled Unique Patient ID; legacy RUP still parses",
		bc.make_uid("ABCDEFG") == "REM-UID-ABCDEFGC" and bc.parse_code("rem-uid-abcdefgc")["label"] == bc.UID_LABEL and bc.parse_code(f"RUP1234567890{bc.verhoeff_check_digit('1234567890')}")["valid"],
	)
	issued = frappe.db.get_value(PATIENT_DT, {UPI: ("like", f"{bc.UID_PREFIX}%")}, UPI)
	if issued:
		queue = iter([issued, bc.make_uid()])
		real_make = p132.make_uid
		p132.make_uid = lambda *a, **k: next(queue)
		try:
			fresh = p132.generate_upi()
		finally:
			p132.make_uid = real_make
		check("generate_upi skips an ID that is already issued", fresh != issued and p132.validate_upi(fresh))

	# --- one-time re-issue --------------------------------------------------
	holder = _user(f"{EMAIL_PREFIX}holder-{low}@example.invalid", ["Patient"], _phone(state))
	mig = pb.ensure_patient(f"{TAG} Legacy {tag}", phone=_phone(state), gender="Female", age=40)
	legacy_body = str(1000000000 + secrets.randbelow(8999999999))
	legacy = f"RUP{legacy_body}{bc.verhoeff_check_digit(legacy_body)}"
	frappe.db.set_value(PATIENT_DT, mig, {UPI: legacy, LEGACY: None}, update_modified=False)
	trf_m = _trf(f"M{tag}", mig, legacy)
	pal = p132.link_patient_account(holder, mig, "Other", consent=True)
	frappe.db.set_value(p132.PAL_DT, pal, UPI, legacy, update_modified=False)
	rec_m = emr.upsert_emr_record(PATIENT_DT, mig, "Patient Upload", "Patient", patient=mig, title=f"{TAG} legacy", summary={"n": 1}, push=False)["name"]
	rep = iam.migrate_uids()
	new_uid = frappe.db.get_value(PATIENT_DT, mig, UPI)
	check("re-issue gives a REM-UID and keeps the RUP in legacy_upi", p132.validate_upi(new_uid) and frappe.db.get_value(PATIENT_DT, mig, LEGACY) == legacy and rep["reissued"] >= 1, rep)
	check(
		"copies rewritten: Customer TRF, Patient Account Link, EMR Record",
		frappe.db.get_value("Customer TRF", trf_m, UPI) == new_uid and frappe.db.get_value(p132.PAL_DT, pal, UPI) == new_uid and frappe.db.get_value(emr.EMR_DT, rec_m, UPI) == new_uid,
	)
	check("re-issue logged", frappe.db.exists(iam.REISSUE_DT, {"patient": mig, "old_uid": legacy, "new_uid": new_uid}))
	rep2 = iam.migrate_uids()
	check("migration is idempotent (nothing re-issued, ID unchanged)", rep2["reissued"] == 0 and rep2["assigned"] == 0 and frappe.db.get_value(PATIENT_DT, mig, UPI) == new_uid, rep2)
	check(
		"legacy RUP and case-insensitive REM-UID resolve to the patient",
		p132.patient_for_uid(legacy) == mig and pb.find_patient(upi=legacy) == mig and p132.patient_for_uid(new_uid.lower().replace("-", " ")) == mig,
	)
	doc = frappe.get_doc(PATIENT_DT, mig)
	doc._doc_before_save = frappe.get_doc(PATIENT_DT, mig)
	doc.set(UPI, bc.make_uid())
	check("an issued REM-UID cannot be changed", _refused(lambda: p132.on_health_patient_validate(doc)))
	doc2 = frappe.get_doc(PATIENT_DT, mig)
	doc2._doc_before_save = frappe.get_doc(PATIENT_DT, mig)
	doc2.set(LEGACY, "RUP00000000000")
	check("the legacy ID cannot be changed", _refused(lambda: p132.on_health_patient_validate(doc2)))

	# --- registration and sign-in ------------------------------------------
	m1 = _phone(state)
	name1 = f"{TAG} Asha {tag}"
	reg = iam.register(m1, _otp(m1), _payload(name1, email=f"{EMAIL_PREFIX}asha-{low}@example.invalid"), login=False)
	pid1, user1, uid1 = reg["patient"], reg["user"], reg["universal_patient_id"]
	check(
		"registration -> Health Patient + REM-UID + Self account link",
		p132.validate_upi(uid1) and frappe.db.exists(p132.PAL_DT, {"user": user1, "patient": pid1, "relation": "Self", "active": 1}) and cstr(frappe.db.get_value(PATIENT_DT, pid1, "dob")) == "1988-04-12",
		reg,
	)
	check("registered login is a portal user whose primary profile is the patient", frappe.db.get_value("User", user1, "user_type") == "Website User" and pb.primary_patient_for_user(user1) == pid1)
	reg2 = iam.register(m1, _otp(m1), _payload(name1.lower()), login=False)
	check("same mobile + same name -> same patient, no duplicate", reg2["patient"] == pid1 and reg2["existing"] and frappe.db.count(PATIENT_DT, {"mobile": m1}) == 1)
	check(
		"a different person on a registered mobile is refused (never merged)",
		_refused(lambda: iam.register(m1, _otp(m1), _payload(f"{TAG} Other {tag}"), login=False)) and frappe.db.count(PATIENT_DT, {"mobile": m1}) == 1,
	)
	m2 = _phone(state)
	_otp(m2)
	check("wrong OTP refused", _refused(lambda: iam.register(m2, "000000", _payload(f"{TAG} Wrong {tag}"), login=False)))
	m3 = _phone(state)
	placeholder = pb.ensure_patient(f"Patient {m3[-4:]}", phone=m3)
	reg3 = iam.register(m3, _otp(m3), _payload(f"{TAG} Claim {tag}", gender="Male"), login=False)
	check(
		"an OTP placeholder record is claimed (renamed), not duplicated",
		reg3["patient"] == placeholder and reg3["claimed_placeholder"] and frappe.db.get_value(PATIENT_DT, placeholder, "patient_name") == f"{TAG} Claim {tag}" and frappe.db.count(PATIENT_DT, {"mobile": m3}) == 1,
	)
	m4 = _phone(state)
	login4 = iam.otp_login(m4, _otp(m4), login=False)
	check("sign-in with an unregistered mobile returns a registration ticket", not login4["registered"] and login4.get("ticket"))
	reg4 = iam.register(m4, None, _payload(f"{TAG} Ticket {tag}"), ticket=login4["ticket"], login=False)
	check("registration with the ticket needs no second OTP; the ticket is single-use", reg4["patient"] and _refused(lambda: iam.register(m4, None, _payload(f"{TAG} Ticket {tag}"), ticket=login4["ticket"], login=False)))
	check("sign-in with a registered mobile resolves its login", iam.otp_login(m1, _otp(m1), login=False)["user"] == user1)
	ms = _phone(state)
	staff_role = _staff_role()
	staff = _user(f"{EMAIL_PREFIX}staff-{low}@example.invalid", [staff_role], ms)
	regs = iam.register(ms, _otp(ms), _payload(f"{TAG} Staff Self {tag}"), login=False)
	check("staff mobile: the vault uses a separate patient login; the staff account gets no patient", regs["user"] != staff and staff_role not in frappe.get_roles(regs["user"]) and not pb.primary_patient_for_user(staff))

	ctx1 = _ctx(user1)
	me1 = iam.me(ctx1)
	check("vault_me lists the account's own profile with its UID", me1["primary"] == pid1 and me1["profiles"][0]["universal_patient_id"] == uid1 and not me1["needs_self_profile"])
	dep = iam.add_family(ctx1, {"patient_name": f"{TAG} Kid {tag}", "relation": "Child", "gender": "Male", "age": 8, "consent": 1})
	ctx1 = _ctx(user1)
	patients1 = iam.patients_of(ctx1)
	check("family profile added with its own REM-UID", p132.validate_upi(dep["universal_patient_id"]) and dep["patient"] in patients1)
	check("a registered name cannot be overwritten from the vault", _refused(lambda: iam.save_profile(ctx1, pid1, {"patient_name": f"{TAG} Renamed {tag}"})))
	prof = iam.save_profile(ctx1, pid1, {"blood_group": "B+", "emergency_contact_name": f"{TAG} Ravi", "emergency_contact_phone": _phone(state), "show_emergency_on_card": 1})
	check("blood group / emergency contact saved", prof["blood_group"] == "B+" and prof["show_emergency_on_card"] == 1)

	# --- QR health card -----------------------------------------------------
	card = iam.card_payload(pid1)
	url = card["qr_url"]
	parts = [p.lower() for p in name1.split() if len(p) > 2]
	check("QR URL holds only the UID and a key (no name, phone or DOB)", uid1 in url and "k=" in url and not any(p in url.lower() for p in parts) and m1 not in url and "1988-04-12" not in url, url)
	k1 = re.search(r"k=([a-z2-7]+)", url).group(1)
	pub = iam.public_card(uid1, k1)
	check("public scan: valid ID + masked name only", pub["valid"] and pub["masked_name"] == iam.mask_name(name1) and "Asha" not in pub["masked_name"] and set(pub) <= {"status", "valid", "universal_patient_id", "issuer", "masked_name", "message"}, pub)
	bad = iam.public_card(uid1, "a" * iam.CARD_K_LEN)
	check("forged key -> unverified, no name", not bad["valid"] and bad["status"] == "unverified" and "masked_name" not in bad)
	check("wrong check character -> invalid", iam.public_card(uid1[:-1] + ("0" if uid1[-1] != "0" else "1"), k1)["status"] == "invalid")
	rotated = iam.rotate_card(pid1)
	k2 = re.search(r"k=([a-z2-7]+)", rotated["qr_url"]).group(1)
	check("card rotation: old QR stops verifying, new one verifies, UID unchanged", k2 != k1 and not iam.public_card(uid1, k1)["valid"] and iam.public_card(uid1, k2)["valid"] and rotated["universal_patient_id"] == uid1 and rotated["card_version"] == 2)
	check("public scans are logged", frappe.db.count(iam.LOOKUP_DT, {"channel": "Public Card", "queried_value": uid1}) >= 4)
	svg = iam.card_svg(rotated)
	check("card SVG shows the UID and the opted-in emergency contact, not the patient's mobile", uid1 in svg and m1 not in svg and f"{TAG} Ravi" in svg)
	pdf = iam.card_pdf(rotated)
	check("card PDF renders", pdf[:4] == b"%PDF" and len(pdf) > 1000, len(pdf))

	# --- ID lookup ----------------------------------------------------------
	check("patient logins cannot use the ID lookup", iam.lookup_channel(user1, set(frappe.get_roles(user1))) is None)
	staff2 = _user(f"{EMAIL_PREFIX}lab-{low}@example.invalid", [staff_role])
	roles2 = set(frappe.get_roles(staff2))
	found = iam.lookup_uid(uid1.lower(), iam.lookup_channel(staff2, roles2), actor_user=staff2, actor_roles=roles2, purpose="smoke")
	check("staff lookup returns minimal identity only", found["found"] and found["patient_name"] == name1 and found["mobile_last4"] == m1[-4:] and "mobile" not in found and "dob" not in found and "email" not in found, found)
	check("the lookup is logged with the actor", frappe.db.exists(iam.LOOKUP_DT, {"actor_user": staff2, "patient": pid1, "result": "Found", "channel": "Staff"}))
	via_legacy = iam.lookup_uid(legacy, "Staff", actor_user=staff2)
	check("a legacy RUP lookup returns the new REM-UID", via_legacy["found"] and via_legacy["universal_patient_id"] == new_uid and via_legacy["matched_legacy_id"])
	nf = iam.lookup_uid(bc.make_uid(), "Staff", actor_user=staff2)
	inv = iam.lookup_uid("REM-UID-BAD", "Staff", actor_user=staff2)
	check("unknown -> Not Found, malformed -> Invalid, both logged", not nf["found"] and nf["valid_format"] and not inv["valid_format"] and frappe.db.count(iam.LOOKUP_DT, {"actor_user": staff2, "result": ("in", ("Not Found", "Invalid"))}) >= 2)
	client = p132.create_api_client(f"{TAG} Client {tag}", "Ancillary App", [iam.LOOKUP_SCOPE])
	ts = int(time.time())
	body_json = json.dumps({"uid": uid1, "n": tag})
	ok_client = p132.verify_api_signature(client["api_key"], p132.api_signature(client["api_secret"], ts, body_json), ts, body_json, iam.LOOKUP_SCOPE)
	via_api = iam.lookup_uid(uid1, "API Client", api_client=ok_client["name"])
	check("signed HEC API Client with iam:lookup can look up; logged", via_api["found"] and frappe.db.exists(iam.LOOKUP_DT, {"api_client": client["name"], "result": "Found"}))
	other = p132.create_api_client(f"{TAG} NoScope {tag}", "Ancillary App", ["barcode:resolve"])
	body2 = json.dumps({"uid": uid1, "x": tag})
	check("API client without iam:lookup refused", _refused(lambda: p132.verify_api_signature(other["api_key"], p132.api_signature(other["api_secret"], ts, body2), ts, body2, iam.LOOKUP_SCOPE)))

	# --- EMR aggregation ----------------------------------------------------
	trf1 = _trf(f"A{tag}", pid1, uid1, m1)
	params1 = [
		{"description": "BIOCHEMISTRY", "result_value": "", "result_input_type": "Heading"},
		{"description": "Glucose Fasting", "result_value": "126", "unit": "mg/dL", "lower_range": 70, "upper_range": 100, "test_name": "Blood Sugar Fasting"},
		{"description": "Glycated Haemoglobin (HbA1c)", "result_value": "6.8 H", "unit": "%", "lower_range": 4, "upper_range": 5.6, "test_name": "HbA1c"},
		{"description": "TSH", "result_value": "<0.01", "unit": "uIU/mL", "lower_range": 0.4, "upper_range": 4.2, "abnormal_flag": "L", "test_name": "Thyroid"},
		{"description": "Platelet Count", "result_value": "1,50,000", "unit": "/cumm", "lower_range": 150000, "upper_range": 410000, "test_name": "CBC"},
		{"description": "HIV I & II", "result_value": "Non Reactive", "result_input_type": "Choice List", "test_name": "HIV"},
	]
	lr1 = _lab_report(trf1, 30, params1)
	res1 = vemr.sync_lab_report(lr1)
	rec1 = frappe.db.get_value(emr.EMR_DT, res1.get("name"), ["name", "patient", UPI, "record_type", "source_app", "summary_json"], as_dict=True) if res1.get("name") else None
	check("authorized lab report -> EMR Record for the TRF's patient with the UID", rec1 and res1["created"] and rec1.patient == pid1 and rec1.get(UPI) == uid1 and rec1.record_type == "Lab Report" and rec1.source_app == "Remedium Lab", res1)
	an = {a["key"]: a for a in json.loads(rec1.summary_json)["analytes"]} if rec1 else {}
	check(
		"analytes: numeric + computed flag, inline flag, '<' qualifier, Indian digit grouping, text-only result, heading skipped",
		an.get("glucose_fasting", {}).get("value_num") == 126 and an["glucose_fasting"]["flag"] == "H" and an.get("hba1c", {}).get("flag") == "H" and an["hba1c"]["value_num"] == 6.8
		and an.get("tsh", {}).get("qualifier") == "<" and an.get("platelet_count", {}).get("value_num") == 150000 and an.get("hiv_i_ii", {}).get("value_num") is None and "biochemistry" not in an,
		list(an),
	)
	check("one analyte point per analyte", rec1 and frappe.db.count(vemr.POINT_DT, {"emr_record": rec1.name}) == len(an))
	again = vemr.sync_lab_report(lr1)
	check("lab EMR upsert is idempotent", not again["changed"] and frappe.db.count(emr.EMR_DT, {"source_name": lr1}) == 1 and frappe.db.count(vemr.POINT_DT, {"emr_record": rec1.name}) == len(an))
	draft = _lab_report(_trf(f"D{tag}", pid1, uid1), 1, params1, status="Verified")
	check("a report that is not authorized is not aggregated", vemr.sync_lab_report(draft).get("skipped"))
	lr2 = _lab_report(_trf(f"B{tag}", pid1, uid1), 2, [{"description": "Fasting Blood Sugar", "result_value": "110 mg/dL", "unit": "mg/dL", "lower_range": 70, "upper_range": 100, "test_name": "FBS"}])
	vemr.sync_lab_report(lr2)
	series = vemr.trend_series(pid1, "glucose_fasting")
	check(
		"fasting glucose trend: aliases merged, date order, reference band and flags",
		[p["value"] for p in series["points"]] == [126.0, 110.0] and series["band"] == {"low": 70.0, "high": 100.0} and [p["flag"] for p in series["points"]] == ["H", "H"],
		series,
	)
	check("trend list includes the analyte with both results", any(a["key"] == "glucose_fasting" and a["count"] == 2 for a in vemr.list_trends(pid1)["analytes"]))
	lr_dep = _lab_report(_trf(f"K{tag}", None, dep["universal_patient_id"]), 3, [{"description": "Haemoglobin", "result_value": "11.2", "unit": "g/dL", "lower_range": 12, "upper_range": 16}])
	check("patient resolved from the TRF's Unique Patient ID alone", vemr.sync_lab_report(lr_dep).get("name") and frappe.db.get_value(emr.EMR_DT, {"source_name": lr_dep}, "patient") == dep["patient"])
	tl = vemr.timeline(patients1, {"record_type": "Lab Report"}, 1, 10)
	check("timeline: own + family records, filtered by type, newest first", tl["total"] >= 3 and all(r["record_type"] == "Lab Report" for r in tl["rows"]) and tl["rows"][0]["record_date"] >= tl["rows"][-1]["record_date"], tl["total"])
	check("timeline pagination", len(vemr.timeline(patients1, {}, 1, 1)["rows"]) == 1 and vemr.timeline(patients1, {}, 2, 1)["page"] == 2)
	vital_w = frappe.get_doc({"doctype": vemr.VITAL_DT, "patient": pid1, "vital_type": "weight", "value": 78, "unit": "kg", "source": "manual", "recorded_at": now_datetime() - timedelta(days=1)}).insert(ignore_permissions=True)
	vemr.on_vital_log_insert(vital_w)
	check("Patient Vital Log -> EMR Vital record", frappe.db.exists(emr.EMR_DT, {"source_doctype": vemr.VITAL_DT, "source_name": vital_w.name, "record_type": "Vital", "patient": pid1}))
	item = frappe.get_all("Item", filters={"disabled": 0}, pluck="name", limit=1)
	cp = _db_insert(
		{
			"doctype": "Clinical Prescription",
			"patient": pid1,
			"patient_name": name1,
			"encounter_date": add_days(today_, -5),
			"status": "Submitted",
			"diagnosis": "Smoke review",
			"medicines": [{"medicine_item": item[0] if item else f"{TAG} Drug", "dosage": "1 tab", "frequency": "BD", "duration": "10 days"}],
		}
	)
	check("submitted Clinical Prescription -> EMR prescription (Polyclinic)", vemr.sync_clinical_prescription(cp).get("created") and frappe.db.get_value(emr.EMR_DT, {"source_name": cp}, "record_type") == "Prescription")
	check("Clinical Prescription medicine -> medication schedule (BD, 10 days)", life.sync_cp_schedules(cp)["schedules_created"] == 1 and frappe.db.get_value(life.SCHEDULE_DT, {"source_name": cp}, "times") == "08:00,20:00")
	cp_sched = frappe.db.get_value(life.SCHEDULE_DT, {"source_name": cp}, "name")
	check("the patient can stop a medicine", life.update_schedule(iam.patients_of(_ctx(user1)), cp_sched, {"status": "Stopped"})["status"] == "Stopped")
	from frappe.utils.pdf import get_pdf

	upload_pdf = base64.b64encode(get_pdf("<p>P136 smoke discharge summary</p>")).decode()
	up = vemr.save_upload(user1, pid1, {"title": f"{TAG} discharge", "record_type": "Discharge", "record_date": cstr(add_days(today_, -10))}, "discharge.pdf", upload_pdf)
	file_name = frappe.db.get_value(emr.EMR_DT, up["name"], "source_name")
	state["files"].append(frappe.db.get_value("File", file_name, "file_url"))
	check("patient upload stored as a private file + EMR record", up["source_app"] == "Patient" and up["record_type"] == "Discharge" and cint(frappe.db.get_value("File", file_name, "is_private")) == 1)
	got = vemr.record_file(patients1, up["name"])
	check("the owner can download the upload", base64.b64decode(got["content_base64"])[:4] == b"%PDF")
	m5 = _phone(state)
	reg5 = iam.register(m5, _otp(m5), _payload(f"{TAG} Bina {tag}"), login=False)
	ctx5 = _ctx(reg5["user"])
	patients5 = iam.patients_of(ctx5)
	check(
		"another account cannot read the upload, the lab record or the profile",
		_refused(lambda: vemr.record_file(patients5, up["name"])) and _refused(lambda: vemr.record_detail(patients5, rec1.name)) and _refused(lambda: iam.patient_in_scope(ctx5, pid1)),
	)
	check("a fake PDF upload is refused", _refused(lambda: vemr.save_upload(user1, pid1, {"title": "x y"}, "x.pdf", base64.b64encode(b"hello").decode())))
	check("lab records cannot be deleted as uploads", _refused(lambda: vemr.delete_upload(patients1, rec1.name)))
	check("own upload can be deleted", vemr.delete_upload(patients1, up["name"])["deleted"] and not frappe.db.exists(emr.EMR_DT, up["name"]))

	# --- e-Rx -> medication schedules -> checklist -----------------------------
	rx = _db_insert(
		{
			"doctype": "Digital Prescription",
			"booking": f"{TAG}-BOOKING",
			"status": "Signed",
			"rx_date": today_,
			"signed_on": now_datetime(),
			"provider": f"{TAG}-PROVIDER",
			"provider_name": f"{TAG} Doctor",
			"provider_category": "Doctor",
			"patient": pid1,
			"patient_name": name1,
			UPI: uid1,
			"follow_up_date": add_days(today_, 14),
			"medications": [
				{"drug_name": "P136 Paracetamol", "strength": "500 mg", "frequency": "1-0-1", "duration": "5 days", "timing": "After Food", "route": "Oral"},
				{"drug_name": "P136 Antacid", "frequency": "SOS", "duration": "", "timing": "Before Food", "route": "Oral"},
				{"drug_name": "P136 Vitamin", "frequency": "HS", "duration": "1 month", "timing": "Bedtime", "route": "Oral"},
			],
			"exercises": [{"exercise_name": "Surya Namaskar", "duration_min": 15, "frequency": "Daily"}],
		}
	)
	res = life.sync_rx_schedules(rx)
	check("signed e-Rx -> 3 medication schedules + 1 yoga routine item", res == {"schedules_created": 3, "routines_created": 1}, res)
	check("schedule sync is idempotent", life.sync_rx_schedules(rx) == {"schedules_created": 0, "routines_created": 0})
	sch = {s.drug_name: s for s in frappe.get_all(life.SCHEDULE_DT, filters={"source_name": rx}, fields=["name", "drug_name", "times", "as_needed", "start_date", "end_date", "timing"])}
	para, antacid, vit = sch.get("P136 Paracetamol"), sch.get("P136 Antacid"), sch.get("P136 Vitamin")
	check(
		"frequency / duration parsed: 1-0-1 x 5 days, SOS, HS x 1 month",
		para and para.times == "08:00,21:00" and getdate(para.end_date) == add_days(today_, 4) and cint(antacid.as_needed) and not antacid.times and vit.times == "22:00" and getdate(vit.end_date) == add_days(today_, 29),
		sch,
	)
	item_y = frappe.db.get_value(life.ROUTINE_DT, {"source_name": rx}, ["name", "category", "minutes"], as_dict=True)
	check("exercise plan -> Yoga routine item with minutes", item_y and item_y.category == "Yoga" and cint(item_y.minutes) == 15)
	cl = life.today_checklist(pid1)
	mine = [d for d in cl["doses"] if d["schedule"] in (para.name, vit.name)]
	check(
		"today's checklist: scheduled slots, SOS listed separately, routine item",
		sorted((d["drug_name"], d["slot"]) for d in mine) == [("P136 Paracetamol", "08:00"), ("P136 Paracetamol", "21:00"), ("P136 Vitamin", "22:00")]
		and any(a["drug_name"] == "P136 Antacid" for a in cl["as_needed"]) and any(r["name"] == item_y.name for r in cl["routine"]),
		mine,
	)
	life.log_dose(patients1, para.name, today_, "08:00", "Taken")
	cl = life.log_dose(patients1, para.name, today_, "21:00", "Skipped")
	states = {(d["slot"]): d["status"] for d in cl["doses"] if d["schedule"] == para.name}
	check("dose log Taken / Skipped shows in the checklist", states == {"08:00": "Taken", "21:00": "Skipped"}, states)
	check("a dose that is not on the schedule is refused", _refused(lambda: life.log_dose(patients1, para.name, today_, "09:00", "Taken")))
	check("another account cannot log this patient's dose", _refused(lambda: life.log_dose(patients5, para.name, today_, "08:00", "Taken")))
	sos = life.log_dose(patients1, antacid.name, today_, None, "Taken")
	check("an as-needed dose is logged on demand", any(a["drug_name"] == "P136 Antacid" and a["taken_today"] == 1 for a in sos["as_needed"]))
	start = add_days(today_, -2)
	for s in (para, vit):
		frappe.db.set_value(life.SCHEDULE_DT, s.name, "start_date", start, update_modified=False)
	missed = life.vault_mark_missed_doses(2, patients=[pid1])
	check("missed-dose job marks unlogged past slots Missed (2 days x 3 slots)", missed["missed"] == 6, missed)
	check("missed-dose job is idempotent", life.vault_mark_missed_doses(2, patients=[pid1])["missed"] == 0)
	yesterday = add_days(today_, -1)
	ad0 = life.adherence(pid1, 2, until=yesterday)
	life.log_dose(patients1, para.name, yesterday, "08:00", "Taken")
	ad1 = life.adherence(pid1, 2, until=yesterday)
	check("adherence % from the dose log (0 % -> 1 of 6 after a late 'taken')", ad0["expected"] == 6 and ad0["pct"] == 0 and ad1["taken"] == 1 and ad1["pct"] == 16.7, (ad0, ad1))
	life.update_schedule(patients1, para.name, {"times": ["07:30", "19:30"]})
	slots = sorted(d["slot"] for d in life.today_checklist(pid1)["doses"] if d["schedule"] == para.name)
	check("patient-adjusted dose times drive the checklist", slots == ["07:30", "19:30"], slots)
	check("invalid dose time refused", _refused(lambda: life.update_schedule(patients1, para.name, {"times": ["25:00"]})))
	iam.save_settings(ctx1, pid1, {"wa_reminders": 1, "wa_tips": 1})
	optin = frappe.db.get_value(iam.PROFILE_DT, {"patient": pid1}, ["wa_reminders", "wa_tips", "wa_opt_in_on"], as_dict=True)
	check("WhatsApp opt-in recorded with a timestamp", cint(optin.wa_reminders) and cint(optin.wa_tips) and optin.wa_opt_in_on)
	at = datetime.combine(today_, datetime.strptime("07:35", "%H:%M").time())
	r1 = life.vault_dose_reminders(at, patients=[pid1])
	r2 = life.vault_dose_reminders(at, patients=[pid1])
	check("dose reminder created once for the due slot (muted in smoke)", r1["muted"] == 1 and r2["muted"] == 0 and frappe.db.get_value(life.REMINDER_DT, {"patient": pid1, "kind": "Dose"}, "status") == "Muted", (r1, r2))

	# --- goals ----------------------------------------------------------------
	g_glu = life.save_goal(user1, patients1, pid1, {"goal_type": "Fasting Glucose", "target": 100})
	check("glucose goal: baseline and current auto-filled from the latest lab value", g_glu["baseline"] == 110.0 and g_glu["current"] == 110.0 and g_glu["progress_pct"] == 0, g_glu)
	lr3 = _lab_report(_trf(f"C{tag}", pid1, uid1), 0, [{"description": "Glucose - Fasting", "result_value": "105", "unit": "mg/dL", "lower_range": 70, "upper_range": 100}])
	vemr.sync_lab_report(lr3)
	g_glu = life.goal_detail(patients1, g_glu["name"])
	check("a new lab result feeds the goal (110 -> 105 of target 100 = 50 %)", g_glu["current"] == 105.0 and g_glu["progress_pct"] == 50.0 and any(e["source"] == "Lab Report" for e in g_glu["entries"]), g_glu)
	check("a second active goal of the same type is refused", _refused(lambda: life.save_goal(user1, patients1, pid1, {"goal_type": "Fasting Glucose", "target": 95})))
	g_a1c = life.save_goal(user1, patients1, pid1, {"goal_type": "HbA1c", "target": 6.0})
	check("HbA1c goal picks up the lab analyte", g_a1c["current"] == 6.8)
	g_w = life.save_goal(user1, patients1, pid1, {"goal_type": "Weight", "target": 70})
	vital_w2 = frappe.get_doc({"doctype": vemr.VITAL_DT, "patient": pid1, "vital_type": "weight", "value": 74, "unit": "kg", "source": "manual", "recorded_at": now_datetime()}).insert(ignore_permissions=True)
	vemr.on_vital_log_insert(vital_w2)
	g_w = life.goal_detail(patients1, g_w["name"])
	check("weight goal fed by Patient Vital Log (78 -> 74 of 70 = 50 %)", g_w["baseline"] == 78.0 and g_w["current"] == 74.0 and g_w["progress_pct"] == 50.0, g_w)
	g_bp = life.save_goal(user1, patients1, pid1, {"goal_type": "Blood Pressure", "target": 120, "target_2": 80, "baseline": 140, "baseline_2": 90})
	when = now_datetime()
	for vtype, value in (("bp_systolic", 130), ("bp_diastolic", 85)):
		v = frappe.get_doc({"doctype": vemr.VITAL_DT, "patient": pid1, "vital_type": vtype, "value": value, "unit": "mmHg", "source": "manual", "recorded_at": when}).insert(ignore_permissions=True)
		vemr.on_vital_log_insert(v)
	g_bp = life.goal_detail(patients1, g_bp["name"])
	bp_entries = [e for e in g_bp["entries"] if e["source"] == "Vital Log"]
	check("systolic + diastolic readings paired into one BP entry (130/85 -> 50 %)", len(bp_entries) == 1 and bp_entries[0]["value"] == 130 and bp_entries[0]["value_2"] == 85 and g_bp["progress_pct"] == 50.0, g_bp)
	g_y = life.save_goal(user1, patients1, pid1, {"goal_type": "Yoga Streak", "target": 7})
	for offset in (-2, -1, 0):
		life.log_routine(patients1, item_y.name, add_days(today_, offset), 1)
	g_y = life.goal_detail(patients1, g_y["name"])
	check("yoga streak from checklist completions (3 days of 7 = 42.9 %)", g_y["streak_days"] == 3 and g_y["progress_pct"] == 42.9, g_y)
	life.log_routine(patients1, item_y.name, today_, 0)
	g_y = life.goal_detail(patients1, g_y["name"])
	check("un-ticking today removes the entry; the streak still counts from yesterday", g_y["streak_days"] == 2)
	g_act = life.save_goal(user1, patients1, pid1, {"goal_type": "Daily Activity", "target": 15})
	check("daily activity goal counts earlier checklist minutes (2 of 7 days)", g_act["streak_days"] == 2 and g_act["progress_pct"] == 28.6, g_act)
	g_w = life.add_entry(patients1, g_w["name"], {"value": 73})
	auto = next(e for e in g_w["entries"] if e["source"] == "Vital Log")
	check("manual entry updates the goal; auto entries cannot be deleted", g_w["current"] == 73.0 and _refused(lambda: life.delete_entry(patients1, auto["name"])))
	check("another account cannot open the goal", _refused(lambda: life.goal_detail(patients5, g_glu["name"])))

	# --- habit tips -----------------------------------------------------------
	tips_active = frappe.db.count(life.TIP_DT, {"active": 1})
	check("tip library seeded (>= 20 active tips)", tips_active >= 20, tips_active)
	t1, created = life.select_tip(pid1, today_)
	d1 = life._delivery_out(t1)
	check("today's tip is triggered by the flagged lab results", created and d1["reason"].startswith("Recent result flagged"), d1)
	check("one tip per day (idempotent) with the wellness disclaimer", life.select_tip(pid1, today_)[0] == t1 and d1["disclaimer"] == life.TIP_DISCLAIMER)
	t2, _new = life.select_tip(pid1, add_days(today_, 1))
	check("min interval: the same tip is not repeated the next day", t2 and life._delivery_out(t2)["tip"] != d1["tip"])
	t3, _new = life.select_tip(reg4["patient"], today_)
	check("a profile without goals or flags gets general wellness tips", t3 and life._delivery_out(t3)["reason"] == "General wellness")
	nudge = life.vault_daily_nudges(today_, patients=[pid1])
	check("WhatsApp tip nudge for an opted-in profile is muted in smoke", nudge["muted"] == 1 and frappe.db.get_value(life.TIP_DELIVERY_DT, {"patient": pid1, "channel": "WhatsApp", "delivered_on": today_}, "status") == "Muted", nudge)

	# --- separation -----------------------------------------------------------
	cancel_rx = frappe.db.set_value("Digital Prescription", rx, "status", "Cancelled")
	stopped = life.sync_rx_schedules(rx)
	check("a cancelled e-Rx stops its schedules and routine item", cancel_rx is None and stopped.get("stopped") == 4 and not frappe.db.exists(life.SCHEDULE_DT, {"source_name": rx, "status": "Active"}), stopped)
	exported = iam.export_data(_ctx(user1))
	check("data export holds only this account's profiles", sorted(p["profile"]["patient"] for p in exported["profiles"]) == sorted(patients1) and any(r["record_type"] == "Lab Report" for r in exported["profiles"][0]["records"]))
	allowed = re.compile(r"^(vault_[a-z_]+|iam_lookup_uid)$")
	whitelisted = []
	for mod in (iam, vemr, life):
		whitelisted += [n for n, f in vars(mod).items() if callable(f) and f in frappe.whitelisted and getattr(f, "__module__", "") == mod.__name__]
	check("vault modules expose only vault_* endpoints (+ the staff / partner ID lookup)", whitelisted and all(allowed.match(n) for n in whitelisted), sorted(n for n in whitelisted if not allowed.match(n)))
	partner_roles = [r for r in ("Clinical Provider", "Franchisee Operator", "Teleporter Runner", "Uber Doc Clinic User", "Phlebotomist") if frappe.db.exists("Role", r)]
	leaks = []
	for i, role in enumerate(partner_roles):
		u = _user(f"{EMAIL_PREFIX}partner{i}-{low}@example.invalid", [role])
		pctx = _ctx(u)
		if iam.me(pctx)["profiles"] or not _refused(lambda: iam.patient_in_scope(pctx, pid1)) or not _refused(lambda: vemr.record_detail(iam.patients_of(pctx), rec1.name)):
			leaks.append(role)
	check("provider / B2B / runner logins see only their own (empty) vault and cannot reach patients", partner_roles and not leaks, (partner_roles, leaks))
	events = frappe.get_hooks("doc_events") or {}

	def hooked(dt, ev, fn):
		cur = (events.get(dt) or {}).get(ev)
		cur = [cur] if isinstance(cur, str) else list(cur or [])
		return fn in cur

	ve, vl, vm = vemr.MODULE_PATH, life.MODULE_PATH, "health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations"
	check(
		"live hooks: lab report / journey / prescriptions / vitals / encounter / e-Rx / enrollment / patient immutability",
		hooked("Lab Report", "on_update", f"{ve}.on_lab_report_update") and hooked("Patient Care Journey", "on_update", f"{ve}.on_journey_update")
		and hooked("Clinical Prescription", "on_update", f"{ve}.on_clinical_prescription_update") and hooked("Patient Vital Log", "after_insert", f"{ve}.on_vital_log_insert")
		and hooked("Clinical Encounter", "on_update", f"{ve}.on_encounter_update") and hooked("Digital Prescription", "on_update", f"{vl}.on_digital_prescription_update")
		and hooked("Tutorial Enrollment", "on_update", f"{vl}.on_enrollment_update") and hooked("Health Patient", "validate", f"{vm}.on_health_patient_validate"),
	)
	jobs = iam.ensure_scheduler_jobs()
	check("vault scheduler jobs registered", all(v in ("present", "created") for v in jobs.values()), jobs)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase135_ud_rx import normalize_icd, valid_icd

	check("ICD format accepts FY2027 letter codes (QA1.71)", valid_icd(normalize_icd("qa171")) and normalize_icd("qa171") == "QA1.71", setup.get("icd_fy2027_qa"))


def _cleanup_smoke(state):
	"""Backstop if anything survived the rollback; also removes private files written to disk."""
	removed = {}
	for url in state.get("files") or []:
		try:
			path = frappe.get_site_path(*cstr(url).lstrip("/").split("/"))
			if url and os.path.isfile(path):
				os.remove(path)
				removed["disk_files"] = removed.get("disk_files", 0) + 1
		except Exception:
			pass
	patients = frappe.get_all(PATIENT_DT, filters={"patient_name": ("like", f"{TAG}%")}, pluck="name")
	for m in state.get("mobiles") or []:
		patients += frappe.get_all(PATIENT_DT, filters={"mobile": m}, pluck="name")
	patients = sorted(set(patients))
	users = frappe.get_all("User", filters={"name": ("like", f"{EMAIL_PREFIX}%@example.invalid")}, pluck="name")
	users += [f"p{m}@otp.health.local" for m in state.get("mobiles") or [] if frappe.db.exists("User", f"p{m}@otp.health.local")]
	if patients:
		records = frappe.get_all(emr.EMR_DT, filters={"patient": ("in", patients)}, pluck="name")
		if records:
			frappe.db.delete(vemr.POINT_DT, {"emr_record": ("in", records)})
			frappe.db.delete(emr.DELIVERY_DT, {"emr_record": ("in", records)})
			frappe.db.delete(emr.EMR_DT, {"name": ("in", records)})
			removed["emr_records"] = len(records)
		for dt in (life.DOSE_DT, life.ROUTINE_LOG_DT, life.SCHEDULE_DT, life.ROUTINE_DT, life.TIP_DELIVERY_DT, life.REMINDER_DT, iam.PROFILE_DT, iam.LOOKUP_DT, iam.REISSUE_DT, "Patient Vital Log"):
			if frappe.db.exists("DocType", dt):
				frappe.db.delete(dt, {"patient": ("in", patients)})
		goals = frappe.get_all(life.GOAL_DT, filters={"patient": ("in", patients)}, pluck="name")
		if goals:
			frappe.db.delete(life.ENTRY_DT, {"goal": ("in", goals)})
			frappe.db.delete(life.GOAL_DT, {"name": ("in", goals)})
		frappe.db.delete("File", {"attached_to_doctype": PATIENT_DT, "attached_to_name": ("in", patients)})
		for dt in ("Clinical Prescription", "Digital Prescription"):
			for name in frappe.get_all(dt, filters={"patient": ("in", patients)}, pluck="name") if frappe.db.exists("DocType", dt) else []:
				try:
					frappe.delete_doc(dt, name, ignore_permissions=True, force=True)
				except Exception:
					frappe.db.delete(dt, {"name": name})
	trfs = frappe.get_all("Customer TRF", filters={"patient_name": ("like", f"{TAG} TRF%")}, pluck="name")
	if trfs:
		labs = frappe.get_all("Lab Report", filters={"customer_trf": ("in", trfs)}, pluck="name")
		if labs:
			frappe.db.delete("Lab Report Parameter", {"parent": ("in", labs)})
			frappe.db.delete("Lab Report", {"name": ("in", labs)})
		frappe.db.delete("Customer TRF", {"name": ("in", trfs)})
		removed["trfs"] = len(trfs)
	if patients:
		for p in patients:
			frappe.db.delete(p132.PAL_DT, {"patient": p})
			frappe.db.delete(PATIENT_DT, {"name": p})
		removed["patients"] = len(patients)
	clients = frappe.get_all(p132.API_CLIENT_DT, filters={"client_name": ("like", f"{TAG}%")}, pluck="name") if frappe.db.exists("DocType", p132.API_CLIENT_DT) else []
	for c in clients:
		frappe.db.delete("__Auth", {"doctype": p132.API_CLIENT_DT, "name": c})
		frappe.db.delete(p132.API_CLIENT_DT, {"name": c})
	for u in sorted(set(users)):
		frappe.db.delete(p132.PAL_DT, {"user": u})
		frappe.db.delete("Has Role", {"parent": u})
		frappe.db.delete("User", {"name": u})
	if users:
		removed["users"] = len(set(users))
	frappe.db.commit()
	return f"removed {removed}" if removed else "clean"
