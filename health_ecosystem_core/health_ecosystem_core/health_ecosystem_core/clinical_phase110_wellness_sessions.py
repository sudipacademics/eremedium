"""
Phase 110 — Wellness session cards (Physiotherapy + Aesthetic) and online session hooks.

Session packs live on Health Subscription Plan / Health Subscription (same pattern as
OPD visit packs). Booking an allied session can consume a punch from the card.
Online / yoga / teleconsult bookings get a Jitsi meeting link via Phase 42 helpers.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_require_mobile_auth,
	_success,
	_user_roles,
)

SESSION_WINGS = ("physiotherapy", "aesthetics", "yoga")

PHYSIO_PACKS = [
	{
		"plan_code": "PHYSIO_CARD_6",
		"title": "Physiotherapy Card — 6 Sessions",
		"description": "Six physiotherapy sessions. Punch one session per visit.",
		"monthly_price": 4999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "physiotherapy",
		"session_pack": 1,
		"included_sessions": 6,
		"display_order": 30,
	},
	{
		"plan_code": "PHYSIO_CARD_12",
		"title": "Physiotherapy Card — 12 Sessions",
		"description": "Twelve physiotherapy sessions with priority scheduling.",
		"monthly_price": 8999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "physiotherapy",
		"session_pack": 1,
		"included_sessions": 12,
		"display_order": 31,
	},
]

AESTHETIC_PACKS = [
	{
		"plan_code": "AESTHETIC_CARD_4",
		"title": "Aesthetic Course — 4 Sessions",
		"description": "Four aesthetic treatment sessions tracked on your card.",
		"monthly_price": 9999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "aesthetics",
		"session_pack": 1,
		"included_sessions": 4,
		"display_order": 40,
	},
	{
		"plan_code": "AESTHETIC_CARD_8",
		"title": "Aesthetic Course — 8 Sessions",
		"description": "Eight aesthetic sessions for a full treatment course.",
		"monthly_price": 17999,
		"billing_interval": "Year",
		"plan_category": "Health",
		"wellness_wing": "aesthetics",
		"session_pack": 1,
		"included_sessions": 8,
		"display_order": 41,
	},
]


def _is_staff(roles=None):
	roles = set(roles or _user_roles())
	return bool(
		roles
		& {
			"System Manager",
			"Health System Admin",
			"Physician",
			"Healthcare Practitioner",
			"Nursing User",
			"Healthcare Admin",
		}
	)


def ensure_wellness_session_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"Health Subscription Plan": [
				{
					"fieldname": "session_pack",
					"label": "Wellness Session Pack",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "online_access",
					"description": "Physio / Aesthetic punch-card style package",
				},
				{
					"fieldname": "included_sessions",
					"label": "Included Sessions",
					"fieldtype": "Int",
					"insert_after": "session_pack",
					"description": "Total punches on the card (0 = unlimited)",
				},
			],
			"Health Subscription": [
				{
					"fieldname": "sessions_remaining",
					"label": "Sessions Remaining",
					"fieldtype": "Int",
					"insert_after": "status",
					"read_only": 1,
				},
				{
					"fieldname": "sessions_total",
					"label": "Sessions Total",
					"fieldtype": "Int",
					"insert_after": "sessions_remaining",
					"read_only": 1,
				},
				{
					"fieldname": "wellness_wing",
					"label": "Wellness Wing",
					"fieldtype": "Data",
					"insert_after": "sessions_total",
					"read_only": 1,
				},
				{
					"fieldname": "last_session_on",
					"label": "Last Session On",
					"fieldtype": "Datetime",
					"insert_after": "wellness_wing",
					"read_only": 1,
				},
			],
			"Doctor Appointment": [
				{
					"fieldname": "wellness_wing",
					"label": "Wellness Wing",
					"fieldtype": "Data",
					"insert_after": "consultation_type",
				},
				{
					"fieldname": "session_card",
					"label": "Session Card",
					"fieldtype": "Link",
					"options": "Health Subscription",
					"insert_after": "wellness_wing",
					"read_only": 1,
				},
				{
					"fieldname": "session_punched",
					"label": "Session Punched",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "session_card",
					"read_only": 1,
				},
			],
		},
		update=True,
	)


def seed_wellness_session_packs():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import subscriptions_ready
	from health_ecosystem_core.health_ecosystem_core.clinical_yoga_subscriptions import ensure_yoga_plan_fields

	if not subscriptions_ready():
		return []
	ensure_yoga_plan_fields()
	ensure_wellness_session_fields()
	created = []
	meta = frappe.get_meta("Health Subscription Plan")
	for spec in PHYSIO_PACKS + AESTHETIC_PACKS:
		code = spec["plan_code"]
		payload = {k: v for k, v in spec.items() if meta.has_field(k)}
		payload["enabled"] = 1
		if frappe.db.exists("Health Subscription Plan", code):
			doc = frappe.get_doc("Health Subscription Plan", code)
			changed = False
			for key, value in payload.items():
				if doc.get(key) != value:
					doc.set(key, value)
					changed = True
			if changed:
				doc.save(ignore_permissions=True)
			continue
		frappe.get_doc({"doctype": "Health Subscription Plan", "name": code, **payload}).insert(
			ignore_permissions=True
		)
		created.append(code)
	frappe.db.commit()
	return created


def _serialize_card(sub_name):
	sub = frappe.get_doc("Health Subscription", sub_name)
	plan = frappe.get_doc("Health Subscription Plan", sub.plan) if sub.plan else None
	wing = getattr(sub, "wellness_wing", None) or (getattr(plan, "wellness_wing", None) if plan else None)
	total = cint(getattr(sub, "sessions_total", 0) or 0)
	remaining = cint(getattr(sub, "sessions_remaining", 0) or 0)
	return {
		"subscription_id": sub.name,
		"status": sub.status,
		"plan_code": getattr(plan, "plan_code", None) if plan else sub.plan,
		"title": getattr(plan, "title", None) if plan else sub.plan,
		"description": getattr(plan, "description", None) if plan else "",
		"wellness_wing": wing,
		"sessions_total": total,
		"sessions_remaining": remaining,
		"sessions_used": max(0, total - remaining) if total else 0,
		"unlimited": total == 0 and cint(getattr(plan, "session_pack", 0) or 0),
		"last_session_on": str(getattr(sub, "last_session_on", "") or "") or None,
		"start_date": str(sub.start_date or "") or None,
		"end_date": str(sub.end_date or "") or None,
		"amount": flt(sub.amount),
	}


def _patient_user_filters(user=None):
	user = user or frappe.session.user
	filters = {"status": "Active", "user": user}
	return filters


@frappe.whitelist(allow_guest=True)
def list_wellness_session_packs(wing_id=None, sid=None):
	"""Public catalog of physio / aesthetic session cards."""
	ensure_wellness_session_fields()
	seed_wellness_session_packs()
	wing_id = (_parse_request_value("wing_id", wing_id) or "").strip().lower() or None
	filters = {"enabled": 1, "session_pack": 1}
	if wing_id:
		filters["wellness_wing"] = wing_id
	rows = frappe.get_all(
		"Health Subscription Plan",
		filters=filters,
		fields=[
			"name",
			"plan_code",
			"title",
			"description",
			"monthly_price",
			"billing_interval",
			"wellness_wing",
			"included_sessions",
			"session_pack",
		],
		order_by="display_order asc, title asc",
	)
	packs = []
	for r in rows:
		packs.append(
			{
				"plan_code": r.plan_code or r.name,
				"title": r.title,
				"description": r.description,
				"price": flt(r.monthly_price),
				"billing_interval": r.billing_interval,
				"wellness_wing": r.wellness_wing,
				"included_sessions": cint(r.included_sessions),
				"unlimited": cint(r.included_sessions) == 0,
			}
		)
	return _success({"packs": packs, "wings": list(SESSION_WINGS)})


@frappe.whitelist(allow_guest=True)
def get_my_session_cards(wing_id=None, sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_wellness_session_fields()
	wing_id = (_parse_request_value("wing_id", wing_id) or "").strip().lower() or None
	filters = _patient_user_filters()
	subs = frappe.get_all(
		"Health Subscription",
		filters=filters,
		fields=["name", "plan", "status", "sessions_remaining", "sessions_total", "wellness_wing"],
		order_by="modified desc",
	)
	cards = []
	for s in subs:
		plan_is_pack = cint(frappe.db.get_value("Health Subscription Plan", s.plan, "session_pack") or 0)
		plan_wing = frappe.db.get_value("Health Subscription Plan", s.plan, "wellness_wing")
		# Also include yoga plans with included_sessions_per_month as cards
		yoga_sessions = cint(
			frappe.db.get_value("Health Subscription Plan", s.plan, "included_sessions_per_month") or -1
		)
		is_yoga = (
			frappe.db.get_value("Health Subscription Plan", s.plan, "plan_category") == "Yoga"
			or plan_wing == "yoga"
		)
		if not plan_is_pack and not is_yoga:
			continue
		wing = s.wellness_wing or plan_wing or ("yoga" if is_yoga else None)
		if wing_id and wing != wing_id:
			continue
		# Stamp counters for yoga if missing
		if is_yoga and not plan_is_pack:
			_ensure_yoga_session_counters(s.name)
		cards.append(_serialize_card(s.name))
	return _success({"cards": cards})


def _ensure_yoga_session_counters(subscription_id):
	sub = frappe.get_doc("Health Subscription", subscription_id)
	plan = frappe.get_doc("Health Subscription Plan", sub.plan)
	if getattr(sub, "sessions_total", None) is not None and cint(sub.sessions_total) >= 0 and getattr(sub, "wellness_wing", None):
		if cint(sub.sessions_total) > 0 or cint(getattr(plan, "included_sessions_per_month", 0) or 0) == 0:
			if not getattr(sub, "wellness_wing", None):
				frappe.db.set_value("Health Subscription", subscription_id, "wellness_wing", "yoga", update_modified=False)
			return
	included = cint(getattr(plan, "included_sessions_per_month", 0) or 0)
	# 0 on yoga = unlimited → store 0 total / high remaining sentinel not needed; remaining=9999 for UX
	total = included
	remaining = 9999 if included == 0 else included
	if cint(getattr(sub, "sessions_remaining", None) or -1) < 0 or not getattr(sub, "wellness_wing", None):
		frappe.db.set_value(
			"Health Subscription",
			subscription_id,
			{
				"sessions_total": total,
				"sessions_remaining": remaining if cint(getattr(sub, "sessions_remaining", None) or -1) < 0 else sub.sessions_remaining,
				"wellness_wing": "yoga",
			},
			update_modified=False,
		)


@frappe.whitelist(allow_guest=True)
def purchase_session_card(plan_code=None, payment_method=None, sid=None):
	"""Create an active session card subscription for the logged-in patient (COD / free activate).

	Online Razorpay can reuse create_subscription_checkout; this path activates immediately
	for Pay at Hub / after offline confirmation.
	"""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_wellness_session_fields()
	seed_wellness_session_packs()
	plan_code = (_parse_request_value("plan_code", plan_code) or "").strip()
	payment_method = (_parse_request_value("payment_method", payment_method) or "Pay at Hub").strip()
	if not plan_code or not frappe.db.exists("Health Subscription Plan", plan_code):
		# try by plan_code field
		plan_name = frappe.db.get_value("Health Subscription Plan", {"plan_code": plan_code}, "name")
		if not plan_name:
			return _error(_("Session pack not found"), 404)
		plan_code = plan_name

	plan = frappe.get_doc("Health Subscription Plan", plan_code)
	if not cint(getattr(plan, "session_pack", 0)):
		return _error(_("Plan is not a wellness session pack"))

	from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

	profile = patient_profile_for_user() or {}
	patient_id = profile.get("patient_id") or profile.get("name")

	included = cint(getattr(plan, "included_sessions", 0) or 0)
	doc = frappe.get_doc(
		{
			"doctype": "Health Subscription",
			"user": frappe.session.user,
			"plan": plan.name,
			"status": "Active",
			"start_date": today(),
			"amount": flt(plan.monthly_price),
			"sessions_total": included,
			"sessions_remaining": included if included > 0 else 9999,
			"wellness_wing": getattr(plan, "wellness_wing", None),
		}
	)
	if patient_id and frappe.get_meta("Health Subscription").has_field("patient"):
		doc.patient = patient_id
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success(
		{"card": _serialize_card(doc.name), "payment_method": payment_method},
		message=_("Session card activated"),
	)


@frappe.whitelist(allow_guest=True)
def activate_session_card(subscription_id=None, sid=None):
	"""Stamp session counters after subscription checkout payment."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	ensure_wellness_session_fields()
	subscription_id = (_parse_request_value("subscription_id", subscription_id) or "").strip()
	if not subscription_id or not frappe.db.exists("Health Subscription", subscription_id):
		return _error(_("Subscription not found"), 404)
	sub = frappe.get_doc("Health Subscription", subscription_id)
	if sub.user != frappe.session.user and not _is_staff():
		return _error(_("Not permitted"), 403)
	plan = frappe.get_doc("Health Subscription Plan", sub.plan)
	included = cint(getattr(plan, "included_sessions", 0) or getattr(plan, "included_sessions_per_month", 0) or 0)
	wing = getattr(plan, "wellness_wing", None) or ""
	sub.sessions_total = included
	sub.sessions_remaining = included if included > 0 else 9999
	sub.wellness_wing = wing
	sub.status = "Active"
	sub.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"card": _serialize_card(sub.name)})


def find_active_session_card(user=None, wing_id=None):
	"""Return best active card for wing (most remaining punches)."""
	ensure_wellness_session_fields()
	user = user or frappe.session.user
	wing_id = (wing_id or "").strip().lower() or None
	subs = frappe.get_all(
		"Health Subscription",
		filters={"status": "Active", "user": user},
		fields=["name", "plan", "sessions_remaining", "sessions_total", "wellness_wing"],
		order_by="sessions_remaining desc, creation desc",
	)
	for s in subs:
		plan_wing = frappe.db.get_value("Health Subscription Plan", s.plan, "wellness_wing")
		wing = (s.wellness_wing or plan_wing or "").lower()
		plan_is_pack = cint(frappe.db.get_value("Health Subscription Plan", s.plan, "session_pack") or 0)
		is_yoga = frappe.db.get_value("Health Subscription Plan", s.plan, "plan_category") == "Yoga"
		if not plan_is_pack and not is_yoga:
			continue
		if wing_id and wing != wing_id and not (wing_id == "yoga" and is_yoga):
			continue
		remaining = cint(s.sessions_remaining)
		total = cint(s.sessions_total)
		# unlimited yoga / pack
		if total == 0 or remaining > 0 or remaining >= 9999:
			return s.name
	return None


def consume_session_punch(subscription_id, appointment_id=None, actor=None):
	"""Decrement one punch; returns remaining."""
	ensure_wellness_session_fields()
	sub = frappe.get_doc("Health Subscription", subscription_id)
	remaining = cint(getattr(sub, "sessions_remaining", 0) or 0)
	total = cint(getattr(sub, "sessions_total", 0) or 0)
	if total > 0 and remaining <= 0:
		frappe.throw(_("No sessions remaining on this card"))
	if total > 0:
		remaining = remaining - 1
		frappe.db.set_value(
			"Health Subscription",
			subscription_id,
			{
				"sessions_remaining": remaining,
				"last_session_on": now_datetime(),
			},
			update_modified=True,
		)
	else:
		frappe.db.set_value(
			"Health Subscription",
			subscription_id,
			{"last_session_on": now_datetime()},
			update_modified=True,
		)
		remaining = 9999
	if appointment_id and frappe.db.exists("Doctor Appointment", appointment_id):
		updates = {"session_card": subscription_id, "session_punched": 1}
		frappe.db.set_value("Doctor Appointment", appointment_id, updates, update_modified=True)
	return remaining


@frappe.whitelist(allow_guest=True)
def punch_session_card(subscription_id=None, appointment_id=None, sid=None):
	"""Patient or staff: punch one session from a card (optionally against an appointment)."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	subscription_id = (_parse_request_value("subscription_id", subscription_id) or "").strip()
	appointment_id = (_parse_request_value("appointment_id", appointment_id) or "").strip() or None
	if not subscription_id or not frappe.db.exists("Health Subscription", subscription_id):
		return _error(_("Session card not found"), 404)
	sub = frappe.get_doc("Health Subscription", subscription_id)
	if sub.user != frappe.session.user and not _is_staff():
		return _error(_("Not permitted"), 403)
	try:
		remaining = consume_session_punch(subscription_id, appointment_id=appointment_id)
		frappe.db.commit()
		return _success(
			{"card": _serialize_card(subscription_id), "sessions_remaining": remaining},
			message=_("Session punched"),
		)
	except Exception as exc:
		return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_session_card_ops(wing_id=None, limit=50, sid=None):
	"""Staff: recent appointments with session punch status for physio/aesthetic."""
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_wellness_session_fields()
	wing_id = (_parse_request_value("wing_id", wing_id) or "").strip().lower() or None
	limit = min(cint(limit) or 50, 100)
	filters = {}
	if wing_id and frappe.get_meta("Doctor Appointment").has_field("wellness_wing"):
		filters["wellness_wing"] = wing_id
	rows = frappe.get_all(
		"Doctor Appointment",
		filters=filters or None,
		fields=[
			"name",
			"patient_name",
			"patient_phone",
			"appointment_date",
			"appointment_time",
			"status",
			"consultation_type",
			"wellness_wing",
			"session_card",
			"session_punched",
			"consultation_mode",
			"meeting_link",
			"amount",
		],
		order_by="appointment_date desc, creation desc",
		limit_page_length=limit,
	)
	# Filter to wellness consultation types when wing field empty
	if not wing_id:
		rows = [
			r
			for r in rows
			if (r.wellness_wing in SESSION_WINGS)
			or (r.consultation_type or "").startswith("Allied")
			or (r.consultation_mode == "Online")
		]
	return _success({"appointments": rows})


def apply_session_card_to_booking(appointment_id, wing_id, use_card=True):
	"""After allied book: optionally punch card and zero amount; set wing + online meeting."""
	if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
		return {}
	ensure_wellness_session_fields()
	updates = {}
	if wing_id and frappe.get_meta("Doctor Appointment").has_field("wellness_wing"):
		updates["wellness_wing"] = wing_id

	card_id = None
	if use_card:
		card_id = find_active_session_card(wing_id=wing_id)
		if card_id:
			try:
				remaining = consume_session_punch(card_id, appointment_id=appointment_id)
				updates["amount"] = 0
				updates["session_card"] = card_id
				updates["session_punched"] = 1
				result = {"session_card": card_id, "sessions_remaining": remaining, "amount": 0}
			except Exception:
				frappe.log_error(title="apply_session_card", message=frappe.get_traceback())
				result = {}
		else:
			result = {}
	else:
		result = {}

	if updates:
		# amount may need db_set after insert
		clean = {k: v for k, v in updates.items() if k != "amount"}
		if clean:
			frappe.db.set_value("Doctor Appointment", appointment_id, clean, update_modified=True)
		if "amount" in updates:
			frappe.db.set_value("Doctor Appointment", appointment_id, "amount", 0, update_modified=True)
	return result


def attach_online_meeting(appointment_id, force=False):
	"""Generate Jitsi meeting link for online wellness / tele / yoga sessions."""
	from health_ecosystem_core.health_ecosystem_core.clinical_phase42_telemedicine import (
		_meeting_link,
		ensure_telemedicine_fields,
	)

	ensure_telemedicine_fields()
	if not appointment_id or not frappe.db.exists("Doctor Appointment", appointment_id):
		return {}
	doc = frappe.get_doc("Doctor Appointment", appointment_id)
	mode = getattr(doc, "consultation_mode", None) or "In-person"
	if not force and mode != "Online" and not getattr(doc, "meeting_link", None):
		return {}
	link, portal = _meeting_link(appointment_id)
	frappe.db.set_value(
		"Doctor Appointment",
		appointment_id,
		{"consultation_mode": "Online", "meeting_link": link},
		update_modified=True,
	)
	return {"meeting_link": link, "portal_join_url": portal, "consultation_mode": "Online"}


@frappe.whitelist(allow_guest=True)
def bootstrap_wellness_sessions(sid=None):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not _is_staff() and "System Manager" not in _user_roles():
		# allow any logged-in user to seed catalog packs (idempotent)
		pass
	ensure_wellness_session_fields()
	created = seed_wellness_session_packs()
	return _success({"seeded": created})
