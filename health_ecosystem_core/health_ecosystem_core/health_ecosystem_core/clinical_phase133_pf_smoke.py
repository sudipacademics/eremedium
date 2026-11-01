"""Phase 133 smoke: PhleboFirst end to end + converter, on throwaway data.

Inner booking code commits (TRF after_insert, order-status changes), so commits are suspended for the run and everything
is rolled back at the end; _cleanup is the backstop if a DDL statement forced an implicit commit. Notifications, journey
creation and outbound HTTP are switched off for the run.
"""

from __future__ import annotations

import json
import re
import secrets
import time

import frappe
from frappe.utils import add_to_date, cint, cstr, flt, now_datetime

from health_ecosystem_core.health_ecosystem_core import clinical_phase133_pf_converter as conv
from health_ecosystem_core.health_ecosystem_core import clinical_phase133_phlebofirst as pf
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	API_CLIENT_DT,
	CUSTODY_DT,
	FP_DT,
	PAYOUT_DT,
	api_signature,
	create_api_client,
	validate_upi,
	verify_chain,
)

SMOKE_TAG = "P133SMK"
PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
BASE_LAT, BASE_LNG = 22.5726, 88.3639
SHARE_DT = "Partner Circuit Share"


def _north(km):
	return round(BASE_LAT + km / 111.0, 6), BASE_LNG


def run_smoke():
	setup = pf.setup_phase133()
	out = {"ok": True, "checks": [], "setup": {k: setup.get(k) for k in ("created", "missing_tubes", "scheduler_job", "accepting_labs")}}
	created = {"codes": set(), "kits": set(), "hubs": set(), "clients": set(), "users": set(), "labs": set()}

	def check(name, cond, detail=""):
		out["checks"].append({"name": name, "pass": bool(cond), "detail": cstr(detail)[:240]})
		if not cond:
			out["ok"] = False

	real_commit = frappe.db.commit
	frappe.db.commit = lambda *args, **kwargs: None
	frappe.flags.pf_no_notify = True
	frappe.flags.mute_emails = True
	try:
		_scenario(check, created, frappe.generate_hash(length=5).upper())
	except Exception as exc:
		out["ok"] = False
		out["error"] = f"{type(exc).__name__}: {cstr(exc)[:400]}"
		out["trace"] = frappe.get_traceback()[-2000:]
	finally:
		frappe.db.rollback()
		frappe.db.commit = real_commit
		frappe.flags.pf_no_notify = False
		frappe.flags.mute_emails = False
		out["cleanup"] = _cleanup(created)
	out["passed"] = sum(1 for c in out["checks"] if c["pass"])
	out["total"] = len(out["checks"])
	return out


def _refused(fn, errors=(frappe.ValidationError, frappe.PermissionError, frappe.AuthenticationError, conv.ApiError)):
	try:
		fn()
	except errors as exc:
		return cstr(getattr(exc, "message", None) or exc) or "refused"
	return None


def _api_code(fn):
	try:
		fn()
	except conv.ApiError as exc:
		return exc.code
	return None


def _user(email, roles, mobile=None):
	doc = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": "P133",
			"last_name": email.split("@")[0][-6:],
			"send_welcome_email": 0,
			"user_type": "System User",
			"mobile_no": mobile,
			"roles": [{"role": r} for r in roles],
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)
	return doc.name


def _profile(code, lat, lng, lab=False, linked_user=None):
	doc = frappe.get_doc(
		{
			"doctype": pf.PROFILE_DT,
			"franchise_name": f"P133 Smoke {code}",
			"branch_code": code,
			"owner_name": "Smoke",
			"franchisee_type": "Pulse",
			"commission_percentage_rate": 0,
			"commission_base": "Franchisee Rate",
			"wallet_balance": 1000,
			"active_status": "Active",
			"latitude": lat,
			"longitude": lng,
			"linked_user": linked_user,
		}
	)
	doc.insert(ignore_permissions=True)
	if lab and pf._has_field(pf.PROFILE_DT, "has_lab"):
		frappe.db.set_value(pf.PROFILE_DT, doc.name, "has_lab", 1, update_modified=False)
	return doc.name


def _phone():
	return f"9{secrets.randbelow(10**9):09d}"


def _lab_items():
	from health_ecosystem_core.health_ecosystem_core.api import LAB_ITEM_GROUPS

	groups = [g for g in LAB_ITEM_GROUPS if frappe.db.exists("Item Group", g)]
	filters = {"disabled": 0, "is_sales_item": 1}
	if groups:
		filters["item_group"] = ("in", groups)
	with_master = []
	if frappe.db.exists("DocType", "Diagnostic Test Master"):
		with_master = [i for i in frappe.get_all("Diagnostic Test Master", filters={"item": ("is", "set")}, pluck="item", limit=50) if frappe.db.exists("Item", {"name": i, **filters})]
	items = list(dict.fromkeys(with_master + frappe.get_all("Item", filters=filters, pluck="name", limit=5)))
	return items[:2]


def _wallets(*labs):
	return {lab: flt(frappe.db.get_value(pf.PROFILE_DT, lab, "wallet_balance"), 2) for lab in labs}


def _scenario(check, created, tag):
	ctx = frappe._dict
	low = tag.lower()

	# --- codes ---------------------------------------------------------
	c = pf.make_code("PF", 123)
	check("PF code = PF- + 7 digits + Verhoeff", re.match(r"^PF-\d{8}$", c) and pf.check_code(c, "PF")[1] is None, c)
	check("PF code with bad prefix refused", pf.check_code("PX-" + c[3:], "PF")[1])
	bad = c[:-1] + str((int(c[-1]) + 1) % 10)
	check("PF code with bad check digit refused", pf.check_code(bad, "PF")[1], bad)
	check("PF code with wrong length refused", pf.check_code(c[:-1], "PF")[1] and pf.check_code(c + "7", "PF")[1])
	swapped = "PF-" + c[3:7] + c[8] + c[7] + c[9:]
	check("PF adjacent transposition caught", swapped == c or pf.check_code(swapped, "PF")[1], swapped)
	hub_c, kit_c = pf.make_code("HUB", 7), pf.make_code("KIT", 9)
	check("HUB / KIT codes validate", re.match(r"^HUB-\d{6}$", hub_c) and re.match(r"^KIT-\d{7}$", kit_c) and not pf.check_code(hub_c, "HUB")[1] and not pf.check_code(kit_c, "KIT")[1], (hub_c, kit_c))
	check("PF code is not a hub code", pf.check_code(c, "HUB")[1])

	# --- fixtures --------------------------------------------------------
	items = _lab_items()
	check("lab test items available", len(items) >= 1, items)
	if not items:
		return
	fr_user = _user(f"p133smoke-fr-{low}@example.invalid", ["Franchisee Operator"], _phone())
	cust_user = _user(f"p133smoke-cu-{low}@example.invalid", [], _phone())
	auth_user = _user(f"p133smoke-la-{low}@example.invalid", ["PF Lab Authoriser"])
	riders = {}
	for key, km in (("A", 2), ("B", 3), ("C", 30)):
		riders[key] = _user(f"p133smoke-r{key.lower()}-{low}@example.invalid", ["Phlebotomist"], _phone())
	plain_user = _user(f"p133smoke-px-{low}@example.invalid", [])
	created["users"].update([fr_user, cust_user, auth_user, plain_user, *riders.values()])

	lab1 = _profile(f"{SMOKE_TAG}-L1-{tag}", BASE_LAT, BASE_LNG, lab=True)
	lab2 = _profile(f"{SMOKE_TAG}-L2-{tag}", *_north(100), lab=True)
	franchise = _profile(f"{SMOKE_TAG}-FR-{tag}", *_north(1), linked_user=fr_user)
	created["labs"].update([lab1, lab2, franchise])

	client1 = create_api_client(f"{SMOKE_TAG} Client {tag} L1", "Partner Lab", ["barcode:convert", "barcode:webhook"], lab1)
	client2 = create_api_client(f"{SMOKE_TAG} Client {tag} L2", "Partner Lab", ["barcode:convert", "barcode:webhook"], lab2)
	client3 = create_api_client(f"{SMOKE_TAG} Client {tag} L1C", "Partner Lab", ["barcode:convert"], lab1)
	created["clients"].update([client1["name"], client2["name"], client3["name"]])

	settings = pf.save_settings(
		{
			"lab": lab1,
			"accepts_pf": 1,
			"catchment_radius_km": 25,
			"default_collection_fee": 200,
			"rider_payout_pct": 80,
			"broadcast_radii_km": "5,10,40",
			"rebroadcast_minutes": 5,
			"sla_minutes": 60,
			"allow_unkitted_codes": 0,
			"lis_barcode_format": "{prefix}{seq:6}",
			"lis_prefix": f"S{tag}",
			"lat": BASE_LAT,
			"lng": BASE_LNG,
			"api_client": client1["name"],
			"authorisers": [auth_user],
		}
	)
	check("lab settings saved, authoriser granted role", settings["lab"] == lab1 and "PF Lab Authoriser" in frappe.get_roles(auth_user), settings.get("authorisers"))
	pf.save_settings({"lab": lab2, "accepts_pf": 1, "catchment_radius_km": 25, "api_client": client2["name"]})
	check("settings for a non-lab profile refused", _refused(lambda: pf.save_settings({"lab": franchise})))
	check("settings with http webhook refused", _refused(lambda: pf.save_settings({"lab": lab1, "outbound_webhook_url": "http://example.invalid/hook"})))
	check("authoriser sees only their lab", pf.labs_for_user(auth_user, {"PF Lab Authoriser"}) == {lab1})

	hub = pf.save_hub({"hub_name": f"P133 Smoke Hub {tag}", "lat": _north(1)[0], "lng": BASE_LNG, "geofence_m": 300, "receiving_lab": lab1})
	hub_code = hub["hub_code"]
	created["hubs"].add(hub_code)
	check("drop hub gets a valid HUB- code", pf.check_code(hub_code, "HUB")[1] is None, hub_code)

	fps = {}
	for key, km in (("A", 2), ("B", 3), ("C", 30)):
		lat, lng = _north(km)
		fps[key] = pf.enable_rider(riders[key], 1, lat, lng, 10)["name"]
	check("non-phlebotomist cannot be enabled as rider", _refused(lambda: pf.enable_rider(plain_user, 1)))
	rctx = {k: ctx(user=riders[k], roles={"Phlebotomist"}, rider=pf.rider_for_user(riders[k], {"Phlebotomist"})) for k in riders}
	check("riders active", all(rctx[k].rider for k in rctx))

	acc = pf.save_account({"display_name": f"P133 Smoke Clinic {tag}", "account_type": "Doctor", "mobile": _phone(), "add_users": [cust_user]})
	check("PF account links user and grants PF Customer", cust_user in acc["granted_role_to"] and "PF Customer" in frappe.get_roles(cust_user), acc.get("granted_role_to"))
	cust_roles = set(frappe.get_roles(cust_user))
	cctx = ctx(user=cust_user, roles=cust_roles, account=pf.account_for_user(cust_user, cust_roles))
	check("customer context resolves account", cctx.account and cctx.account.name == acc["name"])

	def new_request(customer_ctx, name_suffix, lat=BASE_LAT, lng=BASE_LNG):
		return pf.create_request(
			customer_ctx,
			{
				"patient_name": f"P133 Smoke {name_suffix} {tag}",
				"patient_phone": _phone(),
				"patient_age": 41,
				"patient_gender": "Female",
				"pickup_address": "12 Park Street, Ballygunge, Kolkata 700019",
				"pickup_lat": lat,
				"pickup_lng": lng,
				"suggested_tests": "CBC, sugar",
				"file_base64": PNG_1PX,
				"file_name": "rx photo.png",
			},
		)

	# --- upload ----------------------------------------------------------
	d = new_request(cctx, "Ravi")
	req = d["name"]
	upi = frappe.db.get_value(pf.REQ_DT, req, "universal_patient_id")
	check("upload creates request Uploaded, nearest lab assigned", d["status"] == "Uploaded" and d["assigned_lab"] == lab1, (d["status"], d["assigned_lab"]))
	check("upload resolves patient with valid UPI", d["patient"] and validate_upi(upi) and frappe.db.get_value("Health Patient", d["patient"], "universal_patient_id") == upi, upi)
	file_row = frappe.db.get_value("File", {"attached_to_doctype": pf.REQ_DT, "attached_to_name": req}, ["is_private", "file_url"], as_dict=True)
	check("upload stored as private attached file", file_row and cint(file_row.is_private) == 1 and file_row.file_url.startswith("/private/"), file_row)
	check("pickup area derived from address", d["pickup_area"] == "Ballygunge, Kolkata", d["pickup_area"])
	check("non-image upload refused", _refused(lambda: pf.create_request(cctx, {"patient_name": "P133 Smoke X", "patient_phone": _phone(), "patient_age": 3, "patient_gender": "Male", "pickup_address": "1 Long Street Road", "file_base64": "aGVsbG8gd29ybGQ=", "file_name": "x.txt"})))
	req_doc = frappe.get_doc(pf.REQ_DT, req)
	check(
		"file readable by customer + lab, not by others",
		pf.can_read_request(req_doc, cust_user, cust_roles)
		and pf.can_read_request(req_doc, auth_user, {"PF Lab Authoriser"})
		and not pf.can_read_request(req_doc, plain_user, set())
		and not pf.can_read_request(req_doc, riders["A"], {"Phlebotomist"}),
	)

	# --- lab review --------------------------------------------------------
	lab2ctx = ctx(user=auth_user, roles={"PF Lab Authoriser"}, labs={lab2})
	lab1ctx = ctx(user=auth_user, roles={"PF Lab Authoriser"}, labs={lab1})
	check("other lab cannot open the request", _refused(lambda: pf.open_request(lab2ctx, req)))
	opened = pf.open_request(lab1ctx, req)
	check("open -> Under Review with default fee/payout", opened["status"] == "Under Review" and opened["defaults"]["collection_fee"] == 200 and opened["defaults"]["rider_payout"] == 160, opened.get("defaults"))
	inbox = pf.lab_inbox(lab1ctx)
	check("lab inbox lists the request", any(r.name == req for r in inbox["rows"]))

	wallets_before = _wallets(lab1, franchise)
	quote_items = [{"item_code": items[0]}] + ([{"item_code": items[1], "rate": 99}] if len(items) > 1 else [])
	approved = pf.approve_request(lab1ctx, req, json.dumps(quote_items), None, None, 0, "smoke")
	q = approved["quotation"]
	check("approve builds Issued quotation (fee 200, payout 160)", q and q["status"] == "Issued" and q["collection_fee"] == 200 and q["rider_payout"] == 160, q and {k: q[k] for k in ("status", "collection_fee", "rider_payout", "grand_total")})
	check("quotation grand total = tests + fee", q and abs(q["grand_total"] - (q["test_total"] + 200)) < 0.01)
	trf = approved["customer_trf"]
	trf_row = frappe.db.get_value(pf.TRF_DT, trf, ["order_status", "razorpay_payment_status", "franchisee_id", pf.PF_TRF_FIELD, "sales_order"], as_dict=True) or {}
	check("Customer TRF created Booked / payment Pending for the lab", trf_row.get("order_status") == "Booked" and trf_row.get("razorpay_payment_status") == "Pending" and trf_row.get("franchisee_id") == lab1, trf_row)
	check("TRF linked back to request, no sales order", trf_row.get(pf.PF_TRF_FIELD) == req and not trf_row.get("sales_order"))
	tubes = frappe.get_doc(pf.TRF_DT, trf).collection_tubes
	check("TRF has a draw plan", len(tubes) >= 1, [t.tube_code for t in tubes])
	check("partner wallets unchanged by approval", _wallets(lab1, franchise) == wallets_before, (wallets_before, _wallets(lab1, franchise)))
	if frappe.db.exists("DocType", SHARE_DT):
		check("no partner-circuit share rows for the PF TRF", frappe.db.count(SHARE_DT, {"customer_trf": trf}) == 0)
	from health_ecosystem_core.health_ecosystem_core import api as api_mod
	from health_ecosystem_core.health_ecosystem_core import clinical_iam as iam
	from health_ecosystem_core.health_ecosystem_core.clinical_phase94_mother_lab_bill import assign_mother_lab_phlebotomist

	def legacy(fn, **kwargs):
		res = fn(**kwargs) or {}
		frappe.local.response.pop("http_status_code", None)
		return res

	refused_collect = legacy(api_mod.phlebotomist_mark_sample_collected, trf_id=trf)
	check("legacy mark-collected refused for PF TRF", refused_collect.get("status") == "error" and "PhleboFirst" in cstr(refused_collect.get("message")), refused_collect.get("message"))
	refused_visit = legacy(api_mod.phlebotomist_start_visit, trf_id=trf)
	check("legacy start-visit refused for PF TRF", refused_visit.get("status") == "error" and "PhleboFirst" in cstr(refused_visit.get("message")), refused_visit.get("message"))
	check("legacy refusal left the PF TRF Booked", frappe.db.get_value(pf.TRF_DT, trf, "order_status") == "Booked")
	check(
		"legacy phlebotomist assignment no-ops for PF TRF",
		iam.auto_assign_phlebotomist_for_trf(trf) is None and assign_mother_lab_phlebotomist(trf).get("ok") is False,
	)
	job = approved["job"]["name"] if approved.get("job") else None
	offered = set(frappe.get_all(pf.OFFER_DT, filters={"job": job}, pluck="rider"))
	check("job Open, request Broadcast", approved["job"] and approved["job"]["status"] == "Open" and approved["status"] == "Broadcast")
	check("offers only to riders inside 5 km", fps["A"] in offered and fps["B"] in offered and fps["C"] not in offered, offered & set(fps.values()))
	board = pf.open_jobs(rctx["A"])
	card = next((j for j in board["jobs"] if j["name"] == job), None)
	check("job board shows fee/payout/area, hides address", card and card["rider_payout"] == 160 and card["pickup_area"] and "pickup_address" not in card, card)
	check("far rider does not see the job", not any(j["name"] == job for j in pf.open_jobs(rctx["C"])["jobs"]))

	# --- accept race / release ---------------------------------------------
	pf.accept_job(rctx["A"], job)
	check("first rider accepts", tuple(frappe.db.get_value(pf.JOB_DT, job, ["status", "rider"])) == ("Accepted", fps["A"]))
	taken = _refused(lambda: pf.accept_job(rctx["B"], job))
	check("second rider gets 'already taken'", taken and "already been taken" in taken, taken)
	check("request Accepted; customer can no longer cancel", frappe.db.get_value(pf.REQ_DT, req, "status") == "Accepted" and _refused(lambda: pf.cancel_request(cctx, req)))
	pf.release_job(rctx["A"], job, "smoke release")
	check("release returns the job to Open / Broadcast", frappe.db.get_value(pf.JOB_DT, job, "status") == "Open" and frappe.db.get_value(pf.REQ_DT, req, "status") == "Broadcast")
	check("other riders' offers re-opened", frappe.db.get_value(pf.OFFER_DT, {"job": job, "rider": fps["B"]}, "response") == "Pending")
	pf.accept_job(rctx["B"], job)
	check("released rider cannot re-accept", _refused(lambda: pf.accept_job(rctx["A"], job)))
	check("other rider cannot start my job", _refused(lambda: pf.start_job(rctx["A"], job)))

	# --- kits, binding ---------------------------------------------------
	plan_tubes = [t.tube_code for t in tubes]
	wrong_tube = next((t for t in pf.TUBE_CODES if t not in plan_tubes and frappe.db.exists(pf.TUBE_CATALOG_DT, t)), None)
	mix = {t: plan_tubes.count(t) for t in plan_tubes}
	if wrong_tube:
		mix[wrong_tube] = 1
	kit_b = pf.issue_kit(fps["B"], mix)
	kit_a = pf.issue_kit(fps["A"], {plan_tubes[0]: 1})
	loose = pf.issue_barcodes(plan_tubes[0], 1)["codes"][0]
	created["kits"].update([kit_b["kit"], kit_a["kit"]])
	created["codes"].update(kit_b["codes"] + kit_a["codes"] + [loose])
	by_tube = {}
	for code in kit_b["codes"]:
		by_tube.setdefault(frappe.db.get_value(pf.UB_DT, code, "tube_code"), []).append(code)
	check("kit issue writes signed Issued custody events", verify_chain(kit_b["kit"])["ok"] and all(verify_chain(x)["count"] == 1 for x in kit_b["codes"][:3]))
	row0 = tubes[0]
	good0 = by_tube[row0.tube_code][0]
	check("bind before start refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, good0)))
	pf.start_job(rctx["B"], job)
	check("start -> En Route; address revealed", frappe.db.get_value(pf.REQ_DT, req, "status") == "En Route" and pf.job_detail(rctx["B"], job).get("pickup_address"))
	check("mark collected before binding refused", _refused(lambda: pf.mark_collected(rctx["B"], job)))
	if wrong_tube:
		msg = _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, by_tube[wrong_tube][0]))
		check("wrong tube type refused", msg and "Wrong tube" in msg, msg)
		dry = pf.check_barcode(rctx["B"], job, row0.name, by_tube[wrong_tube][0])
		check("live check flags wrong tube", not dry["ok"] and "Wrong tube" in cstr(dry["error"]), dry)
	check("other rider's kit code refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, kit_a["codes"][0])))
	never = next(pf.make_code("PF", s) for s in range(9999999, 9999000, -1) if not frappe.db.exists(pf.UB_DT, pf.make_code("PF", s)))
	check("never-issued code refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, never)))
	check("unkitted code refused when the lab disallows it", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, loose)))
	check("malformed code refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, "PF-123")))
	check("live check accepts the right code", pf.check_barcode(rctx["B"], job, row0.name, good0)["ok"])
	lat, lng = BASE_LAT, BASE_LNG
	res = pf.bind_barcode(rctx["B"], job, row0.name, good0, lat, lng)
	tube_after = frappe.db.get_value(pf.TUBE_DT, row0.name, ["status", pf.UB_TUBE_FIELD], as_dict=True)
	bc = frappe.db.get_value(pf.UB_DT, good0, ["status", "lab", "bound_trf", "binding_signature"], as_dict=True)
	check("bind sets tube Drawn + universal_barcode", tube_after.status == "Drawn" and tube_after.get(pf.UB_TUBE_FIELD) == good0, tube_after)
	check("barcode Bound to TRF/lab with HMAC signature", bc.status == "Bound" and bc.bound_trf == trf and bc.lab == lab1 and re.match(r"^[0-9a-f]{64}$", cstr(bc.binding_signature)), bc)
	check("double bind refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, good0)))
	if len(by_tube[row0.tube_code]) > 1:
		check("second code on a bound tube refused", _refused(lambda: pf.bind_barcode(rctx["B"], job, row0.name, by_tube[row0.tube_code][1])))
	chain = verify_chain(good0)
	check("custody chain Issued -> Bound verifies", chain["ok"] and chain["count"] == 2, chain)
	pf.unbind_barcode(rctx["B"], job, good0, "smoke relabel")
	check("unbind frees tube and code", frappe.db.get_value(pf.TUBE_DT, row0.name, "status") == "Planned" and frappe.db.get_value(pf.UB_DT, good0, "status") == "Issued")
	pf.bind_barcode(rctx["B"], job, row0.name, good0, lat, lng)
	bound_codes = [good0]
	used = {good0}
	for t in tubes[1:]:
		code = next(x for x in by_tube[t.tube_code] if x not in used)
		used.add(code)
		pf.bind_barcode(rctx["B"], job, t.name, code, lat, lng)
		bound_codes.append(code)
	check("custody chain survives unbind/rebind", verify_chain(good0)["ok"] and verify_chain(good0)["count"] == 4)
	pf.mark_collected(rctx["B"], job)
	check("mark collected -> job Collected, TRF Sample Collected", frappe.db.get_value(pf.JOB_DT, job, "status") == "Collected" and frappe.db.get_value(pf.TRF_DT, trf, "order_status") == "Sample Collected")

	# --- drop at hub -----------------------------------------------------
	bad_hub = hub_code[:-1] + str((int(hub_code[-1]) + 1) % 10)
	check("drop with bad hub check digit refused", _refused(lambda: pf.drop_at_hub(rctx["B"], job, bad_hub, bound_codes)))
	check("drop without every tube refused", _refused(lambda: pf.drop_at_hub(rctx["B"], job, hub_code, bound_codes[:-1])))
	check("drop with a foreign code refused", _refused(lambda: pf.drop_at_hub(rctx["B"], job, hub_code, bound_codes + [loose])))
	frappe.db.set_value(pf.HUB_DT, hub_code, "active", 0)
	check("drop at inactive hub refused", _refused(lambda: pf.drop_at_hub(rctx["B"], job, hub_code, bound_codes)))
	frappe.db.set_value(pf.HUB_DT, hub_code, "active", 1)
	hub_lat = _north(1)[0]
	dropped = pf.drop_at_hub(rctx["B"], job, hub_code, bound_codes, hub_lat, BASE_LNG)
	check("drop -> Dropped, inside geofence", dropped["status"] == "Dropped" and not dropped["geofence_warning"], {k: dropped.get(k) for k in ("status", "distance_m", "geofence_warning")})
	check("barcodes Dropped at the hub, request Dropped At Hub", all(tuple(frappe.db.get_value(pf.UB_DT, x, ["status", "drop_hub"])) == ("Dropped", hub_code) for x in bound_codes) and frappe.db.get_value(pf.REQ_DT, req, "status") == "Dropped At Hub")
	check("payout accrued on drop", dropped.get("payout") and dropped["payout"]["amount"] == 160 and frappe.db.get_value(PAYOUT_DT, dropped["payout"]["name"], "status") == "Accrued", dropped.get("payout"))
	again = pf.accrue_payout(job)
	check("payout accrued once", again and not again["created"] and frappe.db.count(PAYOUT_DT, {"source_doctype": pf.JOB_DT, "source_name": job}) == 1)
	check("second drop refused", _refused(lambda: pf.drop_at_hub(rctx["B"], job, hub_code, bound_codes)))
	check("earnings show the accrued payout", flt(pf.my_earnings(rctx["B"])["totals"].get("Accrued")) >= 160)
	check("custody chain verifies after drop", verify_chain(good0)["ok"] and frappe.db.get_value(CUSTODY_DT, {"scan_code": good0}, "event", order_by="seq desc") == "Dropped At Hub")

	# --- accession lookup ------------------------------------------------
	from health_ecosystem_core.health_ecosystem_core import clinical_phase89_vial_accession as accession

	check("accession search resolves the PF code", any(r["trf_id"] == trf for r in accession.find_trf_for_accession(good0)["trfs"]))
	check("tube row resolves by PF code", accession._find_tube_row(frappe.get_doc(pf.TRF_DT, trf), good0).name == row0.name)
	check("LIS bridge lookup resolves the PF code", api_mod._pf_trf_for_barcode(good0) == trf and api_mod._pf_trf_for_barcode("NOPE-123") is None)

	# --- converter -------------------------------------------------------
	ts = int(time.time())
	body = json.dumps({"universal": good0, "n": tag})
	check("converter: missing auth refused", _api_code(lambda: conv.authenticate(conv.SCOPE_CONVERT, "", "", "", b"")) == "unauthorized")
	check("converter: bad signature refused", _api_code(lambda: conv.authenticate(conv.SCOPE_CONVERT, client1["api_key"], "0" * 64, ts, body)) == "unauthorized")
	check(
		"converter: scope enforced",
		_api_code(lambda: conv.authenticate(conv.SCOPE_WEBHOOK, client3["api_key"], api_signature(client3["api_secret"], ts, body), ts, body)) == "forbidden",
	)
	authed = conv.authenticate(conv.SCOPE_CONVERT, client1["api_key"], api_signature(client1["api_secret"], ts, body), ts, body)
	check("converter: valid signature authenticates to the lab", authed["linked_lab"] == lab1)
	c1, c2 = {"name": client1["name"], "linked_lab": lab1}, {"name": client2["name"], "linked_lab": lab2}
	check("converter: other lab cannot see the barcode", _api_code(lambda: conv.convert_core(c2, good0)) == "not_found")
	check("converter: malformed universal refused", _api_code(lambda: conv.convert_core(c1, "PF-1")) == "invalid_universal")
	r1 = conv.convert_core(c1, good0)
	lis = r1["lis_barcode"]
	check("converter: LIS code auto-generated from format", lis == f"S{tag}000001" and r1["created"] and r1["mapping_source"] == "Auto", lis)
	check("converter: payload has tube, tests, patient UPI, TRF", r1["tube"]["code"] == row0.tube_code and r1["tests"] and r1["patient"]["upi"] == upi and r1["trf_id"] == trf, {k: r1.get(k) for k in ("tube", "trf_id")})
	r2 = conv.convert_core(c1, good0)
	check("converter: repeat convert returns the same mapping", r2["lis_barcode"] == lis and not r2["created"])
	check("converter: reverse lookup by LIS barcode", conv.convert_core(c1, lis_barcode=lis)["universal"] == good0)
	check("converter: reverse lookup scoped to the lab", _api_code(lambda: conv.convert_core(c2, lis_barcode=lis)) == "not_found")
	check("converter: universal already mapped -> conflict", _api_code(lambda: conv.bind_mapping(good0, lab1, f"OTHER-{tag}")) == "conflict")
	other_code = kit_b["codes"][-1]
	check("converter: LIS barcode already used -> conflict", _api_code(lambda: conv.bind_mapping(other_code, lab1, lis)) == "conflict")
	check("converter: same pair is idempotent", conv.bind_mapping(good0, lab1, lis).lis_barcode == lis)

	def dup_insert():
		frappe.get_doc({"doctype": pf.MAP_DT, "universal_barcode": good0, "lab": lab1, "lis_barcode": f"X{tag}", "universal_lab_key": f"{good0}::{lab1}", "lab_lis_key": f"{lab1}::X{tag}"}).insert(ignore_permissions=True)

	check("converter: DB unique (universal, lab)", _refused(dup_insert, (frappe.DuplicateEntryError, frappe.UniqueValidationError, frappe.ValidationError)))
	ev = json.dumps({"event_id": f"smk-{low}-1", "event": "result.ready", "data": {"universal": good0}})
	w1 = conv.webhook_core(c1, ev)
	w2 = conv.webhook_core(c1, ev)
	check("webhook: same event_id processed once", not w1["duplicate"] and w2["duplicate"] and frappe.db.count(pf.HOOK_DT, {"idem_key": f"in::{client1['name']}::smk-{low}-1"}) == 1, (w1, w2))
	check("webhook: unsupported event refused", _api_code(lambda: conv.webhook_core(c1, json.dumps({"event_id": f"smk-{low}-2", "event": "x.y", "data": {}}))) == "unsupported_event")
	check("webhook: other lab scoped out", _api_code(lambda: conv.webhook_core(c2, json.dumps({"event_id": f"smk-{low}-3", "event": "sample.received", "data": {"universal": good0}}))) == "not_found")
	rec = conv.webhook_core(c1, json.dumps({"event_id": f"smk-{low}-4", "event": "sample.received", "data": {"lis_barcode": lis, "received_at": "2026-10-24T10:00:00"}}))
	check("webhook sample.received marks barcode Received", rec["result"] == "received" and frappe.db.get_value(pf.UB_DT, good0, "status") == "Received", rec)
	check("receipt advances request / job / TRF", frappe.db.get_value(pf.REQ_DT, req, "status") == "Received At Lab" and frappe.db.get_value(pf.JOB_DT, job, "status") == "Received" and frappe.db.get_value(pf.TRF_DT, trf, "order_status") == "In Lab")
	check("custody chain ends Received At Lab and verifies", verify_chain(good0)["ok"] and frappe.db.get_value(CUSTODY_DT, {"scan_code": good0}, "event", order_by="seq desc") == "Received At Lab")
	again_rec = conv.webhook_core(c1, json.dumps({"event_id": f"smk-{low}-5", "event": "sample.received", "data": {"universal": good0}}))
	check("webhook repeat receipt is harmless", again_rec["result"] == "already_received")
	check("accession search resolves the mapped LIS code", any(r["trf_id"] == trf for r in accession.find_trf_for_accession(lis)["trfs"]))

	# --- franchisee auto-account, rebroadcast, expiry ----------------------
	fr_roles = {"Franchisee Operator"}
	fr_acc = pf.account_for_user(fr_user, fr_roles)
	check("franchisee gets an auto PF account", fr_acc and fr_acc.account_type == "Franchisee" and fr_acc.franchisee == franchise)
	fctx = ctx(user=fr_user, roles=fr_roles, account=fr_acc)
	d2 = new_request(fctx, "Sita")
	pf.open_request(lab1ctx, d2["name"])
	a2 = pf.approve_request(lab1ctx, d2["name"], json.dumps([{"item_code": items[0]}]))
	job2 = a2["job"]["name"]
	offered2 = set(frappe.get_all(pf.OFFER_DT, filters={"job": job2}, pluck="rider"))
	check("second job round 1 (5 km) skips the far rider", fps["C"] not in offered2 and fps["A"] in offered2)
	past = add_to_date(now_datetime(), minutes=-10)
	frappe.db.set_value(pf.JOB_DT, job2, "last_broadcast_on", past)
	pf.pf_rebroadcast_and_expire(only=[job2], webhooks=0)
	check("rebroadcast widens to 10 km", flt(frappe.db.get_value(pf.JOB_DT, job2, "broadcast_radius_km")) == 10 and not frappe.db.exists(pf.OFFER_DT, {"job": job2, "rider": fps["C"]}))
	frappe.db.set_value(pf.JOB_DT, job2, "last_broadcast_on", past)
	pf.pf_rebroadcast_and_expire(only=[job2], webhooks=0)
	check("rebroadcast widens to 40 km and reaches the far rider", flt(frappe.db.get_value(pf.JOB_DT, job2, "broadcast_radius_km")) == 40 and frappe.db.exists(pf.OFFER_DT, {"job": job2, "rider": fps["C"]}))
	frappe.db.set_value(pf.JOB_DT, job2, "sla_due", add_to_date(now_datetime(), minutes=-1))
	pf.pf_rebroadcast_and_expire(only=[job2], webhooks=0)
	trf2 = a2["customer_trf"]
	check("expiry marks job + request Expired", frappe.db.get_value(pf.JOB_DT, job2, "status") == "Expired" and frappe.db.get_value(pf.REQ_DT, d2["name"], "status") == "Expired")
	check("expiry lapses offers and cancels the unused TRF", not frappe.db.exists(pf.OFFER_DT, {"job": job2, "response": "Pending"}) and frappe.db.get_value(pf.TRF_DT, trf2, "order_status") == "Cancelled")

	d3 = new_request(cctx, "Cancel")
	pf.cancel_request(cctx, d3["name"], "smoke")
	check("customer can cancel before acceptance", frappe.db.get_value(pf.REQ_DT, d3["name"], "status") == "Cancelled")
	d4 = new_request(cctx, "Reject")
	check("reject needs a reason", _refused(lambda: pf.reject_request(lab1ctx, d4["name"], "")))
	pf.reject_request(lab1ctx, d4["name"], "Illegible prescription")
	check("lab rejection closes the request", tuple(frappe.db.get_value(pf.REQ_DT, d4["name"], ["status", "status_reason"])) == ("Rejected", "Illegible prescription"))
	check("customer sees only own requests", {r.name for r in pf.my_requests(cctx)["rows"]} >= {req, d3["name"], d4["name"]} and d2["name"] not in {r.name for r in pf.my_requests(cctx)["rows"]})

	# --- existing diagnostic flow untouched -------------------------------
	plain = frappe.get_doc(
		{
			"doctype": pf.TRF_DT,
			"patient_name": f"P133 Smoke Plain {tag}",
			"age": 30,
			"gender": "Male",
			"test_required": items[0],
			"tests": [{"item": items[0], "qty": 1, "rate": 100, "amount": 100}],
			"franchisee_id": lab1,
			"order_status": "Booked",
		}
	)
	plain.insert(ignore_permissions=True)
	check("standard TRF saves without PF fields", plain.name and not plain.get(pf.PF_TRF_FIELD))
	for row in accession.build_draw_plan_for_trf(plain):
		plain.append("collection_tubes", row)
	plain.save(ignore_permissions=True)
	plain.reload()
	acc_id = plain.collection_tubes[0].accession_id if plain.collection_tubes else None
	check(
		"queue filter keeps the standard TRF, drops PF TRFs",
		frappe.get_all(pf.TRF_DT, filters=iam.exclude_pf_trfs({"name": ("in", [trf, trf2, plain.name])}), pluck="name") == [plain.name],
	)
	if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_franchisee_hub"}):
		hub_phlebo = _user(f"p133smoke-hq-{low}@example.invalid", ["Phlebotomist"])
		created["users"].add(hub_phlebo)
		frappe.db.set_value("User", hub_phlebo, "hec_franchisee_hub", lab1, update_modified=False)
		check("hub phlebotomist TRF ids exclude PF orders", plain.name in iam.phlebotomist_trf_ids(hub_phlebo) and trf not in iam.phlebotomist_trf_ids(hub_phlebo))
		previous_user = frappe.session.user
		try:
			frappe.set_user(hub_phlebo)
			queue = legacy(api_mod.get_phlebotomist_collection_queue, limit=200)
			queue_ids = {o.get("trf_id") or o.get("name") for o in (queue.get("data") or {}).get("orders") or []}
			check("legacy queue shows the standard TRF, not PF TRFs", plain.name in queue_ids and not ({trf, trf2} & queue_ids), sorted(queue_ids)[:5])
			collected = legacy(api_mod.phlebotomist_mark_sample_collected, trf_id=plain.name)
			check("legacy mark-collected still works for a standard TRF", collected.get("status") == "success" and frappe.db.get_value(pf.TRF_DT, plain.name, "order_status") == "Sample Collected", collected.get("message"))
		finally:
			frappe.set_user(previous_user)
	check("standard TRF barcode lookups unchanged", any(r["trf_id"] == plain.name for r in accession.find_trf_for_accession(plain.unique_barcode)["trfs"]) and pf.resolve_trf_for_code(plain.unique_barcode) is None)
	if acc_id:
		before_ub = frappe.db.count(pf.UB_DT, {"status": "Received"})
		accession.receive_trf_tube(trf_id=plain.name, accession_id=acc_id)
		check(
			"standard tube receipt works and touches no PF barcode",
			frappe.db.get_value(pf.TUBE_DT, plain.collection_tubes[0].name, "status") == "Received" and frappe.db.count(pf.UB_DT, {"status": "Received"}) == before_ub,
		)


def _cleanup(created):
	"""Backstop if anything survived the rollback (e.g. a DDL implicit commit)."""
	users = set(frappe.get_all("User", filters={"name": ("like", "p133smoke-%@example.invalid")}, pluck="name"))
	users |= {u for u in created.get("users") or [] if frappe.db.exists("User", u)}
	labs = set(frappe.get_all(pf.PROFILE_DT, filters={"name": ("like", f"{SMOKE_TAG}-%")}, pluck="name"))
	requests = frappe.get_all(pf.REQ_DT, filters={"patient_name": ("like", "P133 Smoke %")}, pluck="name") if frappe.db.exists("DocType", pf.REQ_DT) else []
	trfs = frappe.get_all(pf.TRF_DT, filters={"patient_name": ("like", "P133 Smoke %")}, pluck="name")
	clients = frappe.get_all(API_CLIENT_DT, filters={"client_name": ("like", f"{SMOKE_TAG} Client %")}, pluck="name")
	providers = frappe.get_all(FP_DT, filters={"user": ("in", list(users))}, pluck="name") if users else []
	codes = {c for c in created.get("codes") or [] if frappe.db.exists(pf.UB_DT, c)}
	if providers and frappe.db.exists("DocType", pf.UB_DT):
		codes |= set(frappe.get_all(pf.UB_DT, filters={"rider": ("in", providers)}, pluck="name"))
	if trfs and frappe.db.exists("DocType", pf.UB_DT):
		codes |= set(frappe.get_all(pf.UB_DT, filters={"bound_trf": ("in", trfs)}, pluck="name"))
	kits = {k for k in created.get("kits") or [] if frappe.db.exists(pf.KIT_DT, k)}
	if providers and frappe.db.exists("DocType", pf.KIT_DT):
		kits |= set(frappe.get_all(pf.KIT_DT, filters={"rider": ("in", providers)}, pluck="name"))
	hubs = set(frappe.get_all(pf.HUB_DT, filters={"hub_name": ("like", "P133 Smoke Hub %")}, pluck="name")) if frappe.db.exists("DocType", pf.HUB_DT) else set()
	if not any((users, labs, requests, trfs, clients, codes, kits, hubs)):
		return "clean"
	if codes or kits:
		frappe.db.delete(CUSTODY_DT, {"scan_code": ("in", list(codes | kits))})
	if codes:
		frappe.db.delete(pf.MAP_DT, {"universal_barcode": ("in", list(codes))})
		frappe.db.delete(pf.UB_DT, {"name": ("in", list(codes))})
	if kits:
		frappe.db.delete(pf.KIT_DT, {"name": ("in", list(kits))})
	if hubs:
		frappe.db.delete(pf.HUB_DT, {"name": ("in", list(hubs))})
	jobs = frappe.get_all(pf.JOB_DT, filters={"request": ("in", requests)}, pluck="name") if requests else []
	if jobs:
		frappe.db.delete(pf.OFFER_DT, {"job": ("in", jobs)})
		frappe.db.delete(PAYOUT_DT, {"source_name": ("in", jobs)})
		frappe.db.delete(pf.JOB_DT, {"name": ("in", jobs)})
	if requests:
		quotes = frappe.get_all(pf.QUOTE_DT, filters={"request": ("in", requests)}, pluck="name")
		if quotes:
			frappe.db.delete(pf.QUOTE_ITEM_DT, {"parent": ("in", quotes)})
			frappe.db.delete(pf.QUOTE_DT, {"name": ("in", quotes)})
		frappe.db.delete("File", {"attached_to_doctype": pf.REQ_DT, "attached_to_name": ("in", requests)})
		frappe.db.delete(pf.REQ_DT, {"name": ("in", requests)})
	if trfs:
		for child in ("TRF Collection Tube", "TRF Test Item"):
			if frappe.db.exists("DocType", child):
				frappe.db.delete(child, {"parent": ("in", trfs)})
		frappe.db.delete(pf.TRF_DT, {"name": ("in", trfs)})
	patients = frappe.get_all("Health Patient", filters={"patient_name": ("like", "P133 Smoke %")}, pluck="name")
	for p in patients:
		frappe.db.delete("Patient Account Link", {"patient": p})
		frappe.db.delete("Patient Care Journey", {"patient": p})
		frappe.db.delete("Health Patient", {"name": p})
	if clients:
		frappe.db.delete(pf.HOOK_DT, {"api_client": ("in", clients)})
		frappe.db.delete("__Auth", {"doctype": API_CLIENT_DT, "name": ("in", clients)})
		frappe.db.delete(API_CLIENT_DT, {"name": ("in", clients)})
	if labs:
		frappe.db.delete(pf.MAP_DT, {"lab": ("in", list(labs))})
		settings = frappe.get_all(pf.SETTINGS_DT, filters={"lab": ("in", list(labs))}, pluck="name")
		if settings:
			frappe.db.delete(pf.SETTINGS_USER_DT, {"parent": ("in", settings)})
			frappe.db.delete(pf.SETTINGS_DT, {"name": ("in", settings)})
		accounts = frappe.get_all(pf.ACCOUNT_DT, filters={"franchisee": ("in", list(labs))}, pluck="name")
		if accounts:
			frappe.db.delete(pf.ACCOUNT_USER_DT, {"parent": ("in", accounts)})
			frappe.db.delete(pf.ACCOUNT_DT, {"name": ("in", accounts)})
		frappe.db.delete(pf.PROFILE_DT, {"name": ("in", list(labs))})
	accounts = frappe.get_all(pf.ACCOUNT_DT, filters={"display_name": ("like", "P133 Smoke %")}, pluck="name")
	if accounts:
		frappe.db.delete(pf.ACCOUNT_USER_DT, {"parent": ("in", accounts)})
		frappe.db.delete(pf.ACCOUNT_DT, {"name": ("in", accounts)})
	if providers:
		frappe.db.delete(PAYOUT_DT, {"provider": ("in", providers)})
		frappe.db.delete(FP_DT, {"name": ("in", providers)})
	for u in users:
		frappe.db.delete("Has Role", {"parent": u})
		frappe.db.delete("User", {"name": u})
	frappe.db.commit()
	removed = {
		"users": len(users),
		"labs": len(labs),
		"requests": len(requests),
		"trfs": len(trfs),
		"codes": len(codes),
		"kits": len(kits),
		"hubs": len(hubs),
		"clients": len(clients),
	}
	return f"removed {removed}"
