"""
Phase 94 — Mother-lab direct / online sample bill for lab reception (SPA).

Thin wrapper around Phase 70 Bill Entry save:
- pins mother lab Franchisee Profile
- sets sample_intake_channel + hec_outside_sample
- role-gated for Lab Technician / Pathologist / Admin
- keeps order_status Booked for later /dashboard/accession
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
MODULE = "Health Ecosystem Core"

INTAKE_CHANNELS = (
	"Direct to Mother Lab",
	"Online / Courier Sample",
)

RECEPTION_ROLES = (
	"Lab Technician",
	"Pathologist",
	"Health System Admin",
	"System Manager",
	"Administrator",
	"Franchisee Operator",
	"Laboratory User",
)


def setup_phase94():
	ensure_mother_lab_bill_fields()
	pinned = ensure_mother_lab_sample_collector()
	frappe.clear_cache()
	return {"ok": True, "phase": 94, "sample_collector": pinned}


def ensure_mother_lab_bill_fields():
	"""Customer TRF intake channel + Settings mother lab link (idempotent)."""
	trf_fields = []
	if not frappe.db.exists("Custom Field", {"dt": "Customer TRF", "fieldname": "sample_intake_channel"}):
		if not frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
			trf_fields.append(
				{
					"fieldname": "sample_intake_channel",
					"label": "Sample Intake Channel",
					"fieldtype": "Select",
					"options": "\n".join(
						[
							"",
							"Home Collection",
							"Hub Walk-in",
							"Direct to Mother Lab",
							"Online / Courier Sample",
						]
					),
					"insert_after": "hec_outside_sample",
				}
			)

	settings_fields = []
	try:
		settings_meta = frappe.get_meta("Health Ecosystem Settings")
		has_mother = settings_meta.has_field("mother_lab_franchisee")
	except Exception:
		has_mother = False

	if not has_mother and not frappe.db.exists(
		"Custom Field", {"dt": "Health Ecosystem Settings", "fieldname": "mother_lab_franchisee"}
	):
		# Prefer Link only — avoid new Section Break colliding with live Desk custom fields.
		settings_fields.append(
			{
				"fieldname": "mother_lab_franchisee",
				"label": "Mother Lab Franchisee Profile",
				"fieldtype": "Link",
				"options": "Franchisee Profile",
				"insert_after": "hire_value_for_roi",
				"description": "Pinned collection centre for SPA mother-lab / courier bill entry.",
			}
		)

	payload = {}
	if trf_fields:
		payload["Customer TRF"] = trf_fields
	if settings_fields:
		payload["Health Ecosystem Settings"] = settings_fields

	if payload:
		# ignore_validate: live Settings meta already has duplicate custom fieldnames
		create_custom_fields(payload, update=True, ignore_validate=True)
		frappe.db.commit()
	return True


def _parse_json(value):
	if value is None or value == "":
		return None
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except Exception:
		return None


def _ok(data=None, message="OK"):
	return {"status": "success", "message": message, "data": data or {}}


def _assert_reception_role():
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles.intersection(RECEPTION_ROLES):
		frappe.throw(_("Not permitted: Lab Reception roles required."), frappe.PermissionError)


def ensure_mother_lab_sample_collector():
	"""Pin Sample Collector as the mother lab's default phlebotomist for blood draw."""
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
		PHLEBOTOMIST_ROLE,
		resolve_sample_collector_user,
	)

	mother = resolve_mother_lab_franchisee()
	user = resolve_sample_collector_user(create=True)
	if not mother or not user:
		return {"ok": False, "mother_lab_franchisee": mother, "phlebotomist": user}

	if frappe.get_meta("Franchisee Profile").has_field("default_phlebotomist"):
		frappe.db.set_value(
			"Franchisee Profile",
			mother,
			"default_phlebotomist",
			user,
			update_modified=False,
		)
	if frappe.get_meta("User").has_field("hec_franchisee_hub"):
		frappe.db.set_value("User", user, "hec_franchisee_hub", mother, update_modified=False)

	try:
		user_doc = frappe.get_doc("User", user)
		roles = {r.role for r in (user_doc.roles or [])}
		if PHLEBOTOMIST_ROLE not in roles:
			user_doc.append("roles", {"role": PHLEBOTOMIST_ROLE})
			user_doc.save(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="phase94_phlebo_role", message=frappe.get_traceback())

	frappe.db.commit()
	full_name = frappe.db.get_value("User", user, "full_name") or "Sample Collector"
	return {
		"ok": True,
		"mother_lab_franchisee": mother,
		"phlebotomist": user,
		"full_name": full_name,
	}


def assign_mother_lab_phlebotomist(trf_name, phlebotomist=None):
	"""Assign Sample Collector (or override) on the TRF journey — no home-visit SMS."""
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import PF_ORDER_MESSAGE, is_pf_trf, resolve_sample_collector_user
	from health_ecosystem_core.health_ecosystem_core.clinical_journey import ensure_journey_for_patient
	from health_ecosystem_core.health_ecosystem_core.clinical_workflow import (
		advance_journey_forward,
		resolve_trf_health_patient,
	)

	if not trf_name or not frappe.db.exists("Customer TRF", trf_name):
		return {"ok": False, "trf": trf_name}
	if is_pf_trf(trf_name):
		return {"ok": False, "trf": trf_name, "phlebotomist": None, "error": PF_ORDER_MESSAGE}
	user = (phlebotomist or "").strip() or resolve_sample_collector_user()
	if not user:
		return {"ok": False, "trf": trf_name, "phlebotomist": None}

	trf = frappe.get_doc("Customer TRF", trf_name)
	patient_id = resolve_trf_health_patient(trf)
	journey = trf.get("care_journey")
	if not journey and patient_id:
		journey = ensure_journey_for_patient(
			patient_id,
			status="Phlebotomist Assigned",
			phlebotomist=user,
			customer_trf=trf_name,
		)
		if journey:
			trf.db_set("care_journey", journey)
	elif journey:
		advance_journey_forward(
			journey,
			"Phlebotomist Assigned",
			phlebotomist=user,
			customer_trf=trf_name,
		)
	frappe.db.commit()
	full_name = frappe.db.get_value("User", user, "full_name") or "Sample Collector"
	return {
		"ok": True,
		"trf": trf_name,
		"phlebotomist": user,
		"full_name": full_name,
		"care_journey": journey or trf.get("care_journey"),
	}


def resolve_mother_lab_franchisee():
	"""Prefer Settings.mother_lab_franchisee, else SAHEB-like name, else oldest FP."""
	ensure_mother_lab_bill_fields()
	settings_name = None
	try:
		if frappe.db.exists("DocType", "Health Ecosystem Settings"):
			meta = frappe.get_meta("Health Ecosystem Settings")
			if meta.has_field("mother_lab_franchisee"):
				settings_name = frappe.db.get_single_value(
					"Health Ecosystem Settings", "mother_lab_franchisee"
				)
	except Exception:
		settings_name = None

	if settings_name and frappe.db.exists("Franchisee Profile", settings_name):
		return settings_name

	saheb = frappe.db.get_value(
		"Franchisee Profile",
		{"name": ["like", "%SAHEB%"]},
		"name",
		order_by="creation asc",
	)
	if saheb:
		return saheb

	return frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")


def _franchise_label(franchisee):
	"""Safe display name for Franchisee Profile (field is franchise_name, not franchisee_name)."""
	if not franchisee:
		return None
	try:
		meta = frappe.get_meta("Franchisee Profile")
		for field in ("franchise_name", "franchisee_name", "lab_name", "centre_name"):
			if meta.has_field(field):
				val = frappe.db.get_value("Franchisee Profile", franchisee, field)
				if val:
					return val
	except Exception:
		pass
	return franchisee


@frappe.whitelist()
def api_get_mother_lab_bill_defaults():
	"""SPA bootstrap: mother lab centre + allowed channels."""
	_assert_reception_role()
	ensure_mother_lab_bill_fields()
	franchisee = resolve_mother_lab_franchisee()
	label = _franchise_label(franchisee)
	franchisee_type = ""
	if franchisee and frappe.db.exists("Franchisee Profile", franchisee):
		franchisee_type = (frappe.db.get_value("Franchisee Profile", franchisee, "franchisee_type") or "Pulse").strip()
	pinned = ensure_mother_lab_sample_collector()
	centres = list_mother_lab_collection_centres()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase121_mother_lab import mother_lab_wallet_status

	wallet = mother_lab_wallet_status() or {}
	return _ok(
		{
			"wallet_balance": wallet.get("wallet_balance"),
			"credit_limit": wallet.get("credit_limit"),
			"available_to_bill": wallet.get("available_to_bill"),
			"mother_lab_franchisee": franchisee,
			"mother_lab_label": label,
			"franchisee_type": franchisee_type or "Pulse",
			"pricing_rule": (
				"Vector bills at MRP (Standard Selling). "
				"Pulse franchisees and Online / Courier Sample channel bill at FOCO; "
				"MRP is shown slashed when MRP exceeds FOCO."
			),
			"channels": list(INTAKE_CHANNELS),
			"roles_ok": True,
			"default_phlebotomist": pinned.get("phlebotomist"),
			"default_phlebotomist_name": pinned.get("full_name") or "Sample Collector",
			"collection_centres": centres,
		}
	)


def list_mother_lab_collection_centres(limit=200):
	"""Active Franchisee Profile rows for the Coll Centre picker (mother lab first)."""
	ensure_mother_lab_bill_fields()
	mother = resolve_mother_lab_franchisee()
	if not frappe.db.exists("DocType", "Franchisee Profile"):
		return []
	from frappe.utils import cint

	meta = frappe.get_meta("Franchisee Profile")
	fields = ["name"]
	for fname in ("franchise_name", "branch_code", "franchisee_type"):
		if meta.has_field(fname):
			fields.append(fname)
	filters = {}
	if meta.has_field("disabled"):
		filters["disabled"] = 0
	rows = frappe.get_all(
		"Franchisee Profile",
		filters=filters or None,
		fields=fields,
		limit_page_length=cint(limit) or 200,
		order_by="name asc",
		ignore_permissions=True,
	)
	out = []
	for row in rows:
		display = row.get("franchise_name") or row.name
		branch = row.get("branch_code") or ""
		ftype = (row.get("franchisee_type") or "Pulse").strip() or "Pulse"
		label = f"{display}" + (f" · {branch}" if branch else "")
		out.append(
			{
				"name": row.name,
				"franchise_name": display,
				"branch_code": branch,
				"franchisee_type": ftype,
				"label": label,
				"is_mother_lab": 1 if row.name == mother else 0,
			}
		)
	out.sort(key=lambda c: (0 if c["is_mother_lab"] else 1, (c["franchise_name"] or "").lower()))
	return out


def _resolve_bill_collection_centre(requested=None):
	"""Use the selected Coll Centre when it exists; otherwise mother lab."""
	mother = resolve_mother_lab_franchisee()
	centre = (requested or "").strip()
	if centre and frappe.db.exists("Franchisee Profile", centre):
		return centre
	return mother


@frappe.whitelist()
def api_list_mother_lab_bills(limit=40, txt=None):
	"""Recent mother-lab direct / courier bills for SPA history."""
	_assert_reception_role()
	ensure_mother_lab_bill_fields()
	from frappe.utils import cint

	limit = cint(limit) or 40
	txt = (txt or frappe.form_dict.get("txt") or "").strip()
	mother = resolve_mother_lab_franchisee()

	filters = {}
	# Prefer intake channel (covers all mother-lab SPA bills even if centre changed).
	if frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
		filters["sample_intake_channel"] = ["in", list(INTAKE_CHANNELS)]
	elif mother:
		filters["franchisee_id"] = mother
		if frappe.get_meta("Customer TRF").has_field("hec_outside_sample"):
			filters["hec_outside_sample"] = 1
	elif frappe.get_meta("Customer TRF").has_field("hec_outside_sample"):
		filters["hec_outside_sample"] = 1

	or_filters = None
	if txt:
		or_filters = [
			["name", "like", f"%{txt}%"],
			["patient_name", "like", f"%{txt}%"],
			["unique_barcode", "like", f"%{txt}%"],
			["patient_phone", "like", f"%{txt}%"],
		]

	fields = [
		"name",
		"unique_barcode",
		"patient_name",
		"age",
		"gender",
		"patient_phone",
		"order_status",
		"creation",
		"modified",
		"franchisee_id",
		"amount",
	]
	for f in (
		"sample_intake_channel",
		"hec_bill_datetime",
		"hec_net_amount",
		"hec_amount_paid",
		"hec_due_amount",
		"hec_receipt_mode",
		"hec_outside_sample",
	):
		if frappe.get_meta("Customer TRF").has_field(f):
			fields.append(f)

	rows = frappe.get_all(
		"Customer TRF",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		limit_page_length=limit,
		order_by="creation desc",
		ignore_permissions=True,
	)
	out = []
	for row in rows:
		out.append(
			{
				"name": row.name,
				"unique_barcode": row.unique_barcode,
				"patient_name": row.patient_name,
				"age": row.age,
				"gender": row.gender,
				"patient_phone": row.patient_phone or "",
				"order_status": row.order_status,
				"creation": str(row.creation or ""),
				"hec_bill_datetime": str(getattr(row, "hec_bill_datetime", "") or row.creation or ""),
				"sample_intake_channel": getattr(row, "sample_intake_channel", "") or "",
				"hec_net_amount": float(getattr(row, "hec_net_amount", None) or row.amount or 0),
				"hec_amount_paid": float(getattr(row, "hec_amount_paid", None) or 0),
				"hec_due_amount": float(getattr(row, "hec_due_amount", None) or 0),
				"hec_receipt_mode": getattr(row, "hec_receipt_mode", "") or "",
			}
		)
	return _ok({"bills": out, "count": len(out), "mother_lab_franchisee": mother})


@frappe.whitelist()
def api_get_mother_lab_bill(name=None):
	"""Load one mother-lab bill for reprint / review."""
	_assert_reception_role()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
		api_get_hec_lab_bill,
	)

	name = (name or frappe.form_dict.get("name") or "").strip()
	if not name:
		frappe.throw(_("name required"))
	raw = api_get_hec_lab_bill(name=name) or {}
	bill = raw.get("bill") if isinstance(raw, dict) else None
	if not bill:
		frappe.throw(_("Bill not found"))
	# Attach centre label for print header
	bill["mother_lab_label"] = _franchise_label(bill.get("franchisee_id"))
	bill["sample_intake_channel"] = (
		frappe.db.get_value("Customer TRF", name, "sample_intake_channel")
		if frappe.get_meta("Customer TRF").has_field("sample_intake_channel")
		else ""
	)
	journey = frappe.db.get_value("Customer TRF", name, "care_journey")
	phlebo = None
	if journey and frappe.db.exists("Patient Care Journey", journey):
		phlebo = frappe.db.get_value("Patient Care Journey", journey, "phlebotomist")
	if not phlebo:
		pinned = ensure_mother_lab_sample_collector()
		phlebo = pinned.get("phlebotomist")
		bill["phlebotomist_name"] = pinned.get("full_name") or "Sample Collector"
	elif phlebo:
		bill["phlebotomist_name"] = frappe.db.get_value("User", phlebo, "full_name") or phlebo
	bill["phlebotomist"] = phlebo
	return _ok({"bill": bill})


@frappe.whitelist()
def api_search_mother_lab_tests(
	txt=None, limit=30, intake_channel=None, sample_intake_channel=None, franchisee_id=None, coll_centre=None
):
	"""Role-gated test search for SPA mother-lab bill."""
	_assert_reception_role()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
		api_search_hec_lab_tests,
	)

	centre = _resolve_bill_collection_centre(
		franchisee_id
		or coll_centre
		or frappe.form_dict.get("franchisee_id")
		or frappe.form_dict.get("coll_centre")
	)
	channel = (
		(intake_channel or sample_intake_channel or frappe.form_dict.get("intake_channel") or frappe.form_dict.get("sample_intake_channel") or "")
		.strip()
		or None
	)
	raw = api_search_hec_lab_tests(
		txt=txt,
		limit=limit,
		franchisee_id=centre,
		intake_channel=channel,
	) or {}
	tests = raw.get("tests") if isinstance(raw, dict) else []
	return _ok({"ok": True, "tests": tests or [], "count": len(tests or [])})


@frappe.whitelist()
def api_reprice_mother_lab_bill_lines(data=None):
	"""Re-price SPA bill lines when intake channel changes (MRP vs FOCO)."""
	_assert_reception_role()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
		api_apply_patient_bill_rates,
	)

	payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
	if not isinstance(payload, dict):
		payload = {}
	centre = _resolve_bill_collection_centre(
		payload.get("franchisee_id") or payload.get("coll_centre")
	)
	payload = dict(payload)
	payload["franchisee_id"] = centre
	raw = api_apply_patient_bill_rates(data=payload) or {}
	tests = raw.get("tests") if isinstance(raw, dict) else []
	return _ok({"ok": True, "tests": tests or []})


@frappe.whitelist()
def api_search_mother_lab_doctors(txt=None, limit=30):
	"""Role-gated referring doctor search for SPA mother-lab bill."""
	_assert_reception_role()
	from health_ecosystem_core.health_ecosystem_core.clinical_phase95_hub_lab_bill import (
		api_search_referring_doctors,
	)

	return api_search_referring_doctors(txt=txt, limit=limit)


@frappe.whitelist()
def api_save_mother_lab_bill(data=None):
	"""Create Customer TRF for direct / online sample at mother lab."""
	_assert_reception_role()
	ensure_mother_lab_bill_fields()

	from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import (
		api_save_hec_lab_bill,
	)

	payload = _parse_json(data) or _parse_json(frappe.form_dict.get("data")) or {}
	if not payload:
		frappe.throw(_("Bill data required"))

	channel = (payload.get("sample_intake_channel") or "").strip()
	if channel not in INTAKE_CHANNELS:
		frappe.throw(
			_("sample_intake_channel must be one of: {0}").format(", ".join(INTAKE_CHANNELS))
		)

	mother = resolve_mother_lab_franchisee()
	if not mother:
		frappe.throw(_("Configure Mother Lab Franchisee on Health Ecosystem Settings."))

	centre = _resolve_bill_collection_centre(
		payload.get("coll_centre") or payload.get("franchisee_id")
	)
	payload = dict(payload)
	payload["franchisee_id"] = centre
	payload["coll_centre"] = centre
	payload["sample_intake_channel"] = channel
	payload["hec_outside_sample"] = 1
	payload["order_status"] = "Booked"
	# Never allow caller to force a pre-set barcode through this path unless empty
	payload["unique_barcode"] = (payload.get("unique_barcode") or "").strip()

	# Default payment_method for receipt UX when provided
	if not payload.get("payment_method"):
		mode = (payload.get("hec_receipt_mode") or "CASH").upper()
		if mode in ("CASH",):
			payload["payment_method"] = "Pay at Hub"
		elif mode in ("UPI", "CARD", "NEFT"):
			payload["payment_method"] = "Online"
		else:
			payload["payment_method"] = "Pay at Hub"

	existing = (payload.get("name") or payload.get("trf_id") or "").strip()
	is_new = not existing or not frappe.db.exists("Customer TRF", existing)
	if is_new:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase121_mother_lab import (
			assert_mother_lab_can_bill,
		)

		assert_mother_lab_can_bill(payload)

	result = api_save_hec_lab_bill(data=payload)
	if not isinstance(result, dict):
		result = {"ok": True, "raw": result}

	if is_new:
		new_trf = result.get("name") or (result.get("bill") or {}).get("name")
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase121_mother_lab import (
				settle_new_mother_lab_bill,
			)

			settlement = settle_new_mother_lab_bill(new_trf) if new_trf else None
			if settlement:
				result["platform_settlement"] = settlement
		except Exception as exc:
			traceback = frappe.get_traceback()
			frappe.db.rollback()
			frappe.log_error(title="phase121_mother_lab_settlement", message=traceback)
			try:
				if new_trf and frappe.db.exists("Customer TRF", new_trf):
					frappe.delete_doc("Customer TRF", new_trf, force=1, ignore_permissions=True)
					frappe.db.commit()
			except Exception:
				frappe.db.rollback()
				frappe.log_error(title="phase121_mother_lab_cleanup", message=frappe.get_traceback())
			frappe.throw(str(exc))

	# Ensure channel persisted (Phase 70 may not know the field yet)
	try:
		trf_name = result.get("name") or (result.get("bill") or {}).get("name")
		if trf_name and frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
			frappe.db.set_value(
				"Customer TRF",
				trf_name,
				{
					"sample_intake_channel": channel,
					"hec_outside_sample": 1,
					"franchisee_id": centre,
				},
				update_modified=False,
			)
			frappe.db.commit()
			result["sample_intake_channel"] = channel
			result["mother_lab_franchisee"] = mother
			result["coll_centre"] = centre
			result["franchisee_id"] = centre
	except Exception:
		frappe.log_error(title="phase94_set_channel", message=frappe.get_traceback())

	try:
		trf_name = result.get("name") or (result.get("bill") or {}).get("name")
		override = (payload.get("phlebotomist") or "").strip() or None
		assigned = assign_mother_lab_phlebotomist(trf_name, phlebotomist=override)
		result["phlebotomist"] = assigned.get("phlebotomist")
		result["phlebotomist_name"] = assigned.get("full_name")
		result["care_journey"] = assigned.get("care_journey")
	except Exception:
		frappe.log_error(title="phase94_assign_phlebo", message=frappe.get_traceback())

	return _ok(result)


def smoke_mother_lab_sample_collector(trf_id=None):
	"""Pin Sample Collector on mother lab and assign them on a Direct-to-Mother-Lab TRF."""
	from health_ecosystem_core.health_ecosystem_core.clinical_iam import resolve_sample_collector_user

	pinned = ensure_mother_lab_sample_collector()
	user = pinned.get("phlebotomist") or resolve_sample_collector_user()
	mother = pinned.get("mother_lab_franchisee") or resolve_mother_lab_franchisee()
	fp_default = None
	hub = None
	if mother and frappe.get_meta("Franchisee Profile").has_field("default_phlebotomist"):
		fp_default = frappe.db.get_value("Franchisee Profile", mother, "default_phlebotomist")
	if user and frappe.get_meta("User").has_field("hec_franchisee_hub"):
		hub = frappe.db.get_value("User", user, "hec_franchisee_hub")

	target = (trf_id or "").strip() or None
	if not target and frappe.get_meta("Customer TRF").has_field("sample_intake_channel"):
		target = frappe.db.get_value(
			"Customer TRF",
			{"sample_intake_channel": ["in", list(INTAKE_CHANNELS)]},
			"name",
			order_by="modified desc",
		)
	if not target and mother:
		target = frappe.db.get_value(
			"Customer TRF",
			{"franchisee_id": mother, "order_status": ["in", ("Booked", "Sample Collected", "Draft")]},
			"name",
			order_by="modified desc",
		)

	assigned = None
	journey_phlebo = None
	if target:
		assigned = assign_mother_lab_phlebotomist(target, phlebotomist=user)
		journey = assigned.get("care_journey") if assigned else None
		if journey and frappe.db.exists("Patient Care Journey", journey):
			journey_phlebo = frappe.db.get_value("Patient Care Journey", journey, "phlebotomist")

	ok_pin = bool(user and mother and fp_default == user and hub == mother)
	ok_assign = True
	if target:
		ok_assign = bool(assigned and assigned.get("ok") and assigned.get("phlebotomist") == user)
	ok = ok_pin and ok_assign
	print("RESULT " + ("SMOKE_OK" if ok else "SMOKE_FAIL"))
	return {
		"ok": ok,
		"pinned": pinned,
		"mother_lab_franchisee": mother,
		"phlebotomist": user,
		"full_name": pinned.get("full_name"),
		"franchisee_default": fp_default,
		"hec_franchisee_hub": hub,
		"assigned": assigned,
		"journey_phlebotomist": journey_phlebo,
	}


def smoke_mother_lab_collection_centre_picker():
	"""Mother lab Coll Centre is selectable — not locked to Saheb Medical."""
	mother = resolve_mother_lab_franchisee()
	centres = list_mother_lab_collection_centres()
	names = [c["name"] for c in centres]
	other = next((n for n in names if n != mother), None)
	resolved_other = _resolve_bill_collection_centre(other) if other else None
	resolved_blank = _resolve_bill_collection_centre("")
	ok = bool(
		mother
		and mother in names
		and len(centres) >= 1
		and resolved_blank == mother
		and (not other or resolved_other == other)
	)
	print("RESULT " + ("SMOKE_OK" if ok else "SMOKE_FAIL"))
	return {
		"ok": ok,
		"mother_lab_franchisee": mother,
		"centre_count": len(centres),
		"other_centre": other,
		"resolved_other": resolved_other,
		"centres": centres[:8],
	}