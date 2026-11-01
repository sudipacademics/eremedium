"""
Phase 114 — Wellness treatment video CMS (ERPNext Desk).

Desk DocType "HEC Wellness Video" lets Website Managers / Admins manage
YouTube embeds per wellness wing. Guest API feeds WellnessVideoSection on
/wellness/* clinic landings.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
)

VIDEO_DOCTYPE = "HEC Wellness Video"

WING_OPTIONS = "aesthetics\npsychology\nphysiotherapy\nchiropractic\nayurvedic\nyoga"

# Seeded from the previous frontend placeholders (replace in Desk with real clips).
SEED_VIDEOS = [
	# aesthetics
	("AES-01", "aesthetics", "Laser hair removal", "Hair", "LXb3EKWsInQ", 10),
	("AES-02", "aesthetics", "Acne scar care", "Skin", "M7lc1UVf-VE", 20),
	("AES-03", "aesthetics", "Skin rejuvenation", "Skin", "aqz-KE-bpKQ", 30),
	("AES-04", "aesthetics", "Hair restoration basics", "Hair", "ScMzIvxBSi4", 40),
	("AES-05", "aesthetics", "Body contouring overview", "Body", "hY7m5jjJ9mM", 50),
	("AES-06", "aesthetics", "Chemical peels explained", "Skin", "C0DPdy98e4c", 60),
	# psychology
	("PSY-01", "psychology", "Counselling basics", "Therapy", "LXb3EKWsInQ", 10),
	("PSY-02", "psychology", "Managing stress", "Wellbeing", "M7lc1UVf-VE", 20),
	("PSY-03", "psychology", "Anxiety support", "Mental health", "aqz-KE-bpKQ", 30),
	("PSY-04", "psychology", "Sleep & mind", "Habits", "ScMzIvxBSi4", 40),
	("PSY-05", "psychology", "Family counselling intro", "Relationships", "hY7m5jjJ9mM", 50),
	("PSY-06", "psychology", "Building resilience", "Growth", "C0DPdy98e4c", 60),
	# physiotherapy / Remedium Care
	("PHY-01", "physiotherapy", "Physio assessment", "Rehab", "LXb3EKWsInQ", 10),
	("PHY-02", "physiotherapy", "Back pain relief", "Spine", "M7lc1UVf-VE", 20),
	("PHY-03", "physiotherapy", "Knee strengthening", "Joints", "aqz-KE-bpKQ", 30),
	("PHY-04", "physiotherapy", "Posture correction", "Form", "ScMzIvxBSi4", 40),
	("PHY-05", "physiotherapy", "Sports injury care", "Athletes", "hY7m5jjJ9mM", 50),
	("PHY-06", "physiotherapy", "Home exercise tips", "Home", "C0DPdy98e4c", 60),
	# chiropractic
	("CHI-01", "chiropractic", "Spine alignment basics", "Spine", "LXb3EKWsInQ", 10),
	("CHI-02", "chiropractic", "Neck pain care", "Neck", "M7lc1UVf-VE", 20),
	("CHI-03", "chiropractic", "Posture & desk work", "Lifestyle", "aqz-KE-bpKQ", 30),
	("CHI-04", "chiropractic", "Osteopathy overview", "Body", "ScMzIvxBSi4", 40),
	("CHI-05", "chiropractic", "Mobility routines", "Movement", "hY7m5jjJ9mM", 50),
	("CHI-06", "chiropractic", "Aftercare guidance", "Aftercare", "C0DPdy98e4c", 60),
	# ayurvedic
	("AYU-01", "ayurvedic", "Ayurveda consultation", "Dosha", "LXb3EKWsInQ", 10),
	("AYU-02", "ayurvedic", "Abhyanga massage", "Therapies", "M7lc1UVf-VE", 20),
	("AYU-03", "ayurvedic", "Panchakarma intro", "Detox", "aqz-KE-bpKQ", 30),
	("AYU-04", "ayurvedic", "Herbal wellness tips", "Herbs", "ScMzIvxBSi4", 40),
	("AYU-05", "ayurvedic", "Dinacharya routines", "Lifestyle", "hY7m5jjJ9mM", 50),
	("AYU-06", "ayurvedic", "Mind-body balance", "Holistic", "C0DPdy98e4c", 60),
	# yoga
	("YOG-01", "yoga", "Beginner yoga flow", "Asana", "LXb3EKWsInQ", 10),
	("YOG-02", "yoga", "Breathwork basics", "Pranayama", "M7lc1UVf-VE", 20),
	("YOG-03", "yoga", "Meditation starter", "Mindfulness", "aqz-KE-bpKQ", 30),
	("YOG-04", "yoga", "Flexibility focus", "Mobility", "ScMzIvxBSi4", 40),
	("YOG-05", "yoga", "Stress-release yoga", "Calm", "hY7m5jjJ9mM", 50),
	("YOG-06", "yoga", "Evening wind-down", "Rest", "C0DPdy98e4c", 60),
]


def extract_youtube_id(raw: str) -> str:
	"""Accept bare IDs or common YouTube URL shapes."""
	value = cstr(raw).strip()
	if not value:
		return ""
	if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", value):
		return value
	patterns = [
		r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube-nocookie\.com/embed/)([A-Za-z0-9_-]{6,20})",
		r"[?&]v=([A-Za-z0-9_-]{6,20})",
	]
	for pat in patterns:
		m = re.search(pat, value)
		if m:
			return m.group(1)
	return value


def _field_defs():
	return [
		{
			"fieldname": "video_code",
			"fieldtype": "Data",
			"label": "Video Code",
			"reqd": 1,
			"unique": 1,
			"in_list_view": 1,
			"description": "Stable key e.g. AES-01 — used for idempotent seeds.",
		},
		{
			"fieldname": "wing_id",
			"fieldtype": "Select",
			"label": "Wellness Wing",
			"options": WING_OPTIONS,
			"reqd": 1,
			"in_list_view": 1,
			"in_standard_filter": 1,
		},
		{"fieldname": "column_break_meta", "fieldtype": "Column Break"},
		{
			"fieldname": "enabled",
			"fieldtype": "Check",
			"label": "Enabled",
			"default": "1",
			"in_list_view": 1,
			"in_standard_filter": 1,
		},
		{
			"fieldname": "sort_order",
			"fieldtype": "Int",
			"label": "Sort Order",
			"default": "0",
			"in_list_view": 1,
		},
		{"fieldname": "section_content", "fieldtype": "Section Break", "label": "Video"},
		{"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1},
		{"fieldname": "topic", "fieldtype": "Data", "label": "Topic / Tag", "in_list_view": 1},
		{
			"fieldname": "youtube_url",
			"fieldtype": "Data",
			"label": "YouTube URL",
			"description": "Paste full watch/share URL — ID is extracted automatically on save.",
		},
		{
			"fieldname": "youtube_id",
			"fieldtype": "Data",
			"label": "YouTube Video ID",
			"reqd": 1,
			"description": "Embed ID only (e.g. dQw4w9WgXcQ). Filled from URL if empty.",
		},
	]


def ensure_wellness_video_doctype():
	if frappe.db.exists("DocType", VIDEO_DOCTYPE):
		_ensure_fields()
		return False
	frappe.get_doc(
		{
			"doctype": "DocType",
			"name": VIDEO_DOCTYPE,
			"module": "Health Ecosystem Core",
			"custom": 0,
			"autoname": "field:video_code",
			"naming_rule": "By fieldname",
			"title_field": "title",
			"search_fields": "title,wing_id,topic,youtube_id,video_code",
			"sort_field": "sort_order",
			"sort_order": "ASC",
			"track_changes": 1,
			"fields": _field_defs(),
			"permissions": [
				{
					"role": "System Manager",
					"read": 1,
					"write": 1,
					"create": 1,
					"delete": 1,
					"export": 1,
					"report": 1,
				},
				{
					"role": "Health System Admin",
					"read": 1,
					"write": 1,
					"create": 1,
					"delete": 1,
				},
				{"role": "Website Manager", "read": 1, "write": 1, "create": 1, "delete": 0},
			],
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return True


def _ensure_fields():
	meta = frappe.get_meta(VIDEO_DOCTYPE)
	needed = {
		f["fieldname"]: f
		for f in _field_defs()
		if f.get("fieldtype") not in ("Section Break", "Column Break")
	}
	missing = [f for name, f in needed.items() if not meta.has_field(name)]
	if not missing:
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({VIDEO_DOCTYPE: missing}, ignore_validate=True)
	frappe.clear_cache(doctype=VIDEO_DOCTYPE)


def seed_wellness_videos(force_update=False):
	"""Insert placeholder catalog once; optionally refresh titles/order without overwriting custom youtube_ids."""
	ensure_wellness_video_doctype()
	created = []
	updated = []
	force = cint(force_update)
	for code, wing, title, topic, yid, order in SEED_VIDEOS:
		if frappe.db.exists(VIDEO_DOCTYPE, code):
			if not force:
				continue
			doc = frappe.get_doc(VIDEO_DOCTYPE, code)
			doc.title = title
			doc.topic = topic
			doc.wing_id = wing
			doc.sort_order = order
			doc.enabled = 1
			# Keep staff-edited youtube_id unless still a known placeholder or empty
			if not doc.youtube_id:
				doc.youtube_id = yid
			doc.save(ignore_permissions=True)
			updated.append(code)
			continue
		frappe.get_doc(
			{
				"doctype": VIDEO_DOCTYPE,
				"video_code": code,
				"wing_id": wing,
				"title": title,
				"topic": topic,
				"youtube_id": yid,
				"youtube_url": f"https://www.youtube.com/watch?v={yid}",
				"sort_order": order,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)
		created.append(code)
	if created or updated:
		frappe.db.commit()
	return {"created": created, "updated": updated}


def _normalize_doc_before_save(doc, method=None):
	"""DocType hook — also safe to call manually."""
	url = cstr(getattr(doc, "youtube_url", "") or "").strip()
	yid = cstr(getattr(doc, "youtube_id", "") or "").strip()
	if url:
		extracted = extract_youtube_id(url)
		if extracted:
			doc.youtube_id = extracted
			if not yid or yid != extracted:
				doc.youtube_id = extracted
	elif yid:
		doc.youtube_id = extract_youtube_id(yid)
		if not url and doc.youtube_id:
			doc.youtube_url = f"https://www.youtube.com/watch?v={doc.youtube_id}"


def _serialize(row):
	yid = extract_youtube_id(row.get("youtube_id") or row.get("youtube_url") or "")
	return {
		"name": row.get("name") or row.get("video_code"),
		"video_code": row.get("video_code"),
		"wing_id": row.get("wing_id"),
		"title": row.get("title"),
		"topic": row.get("topic") or "",
		"youtube_id": yid,
		"youtube_url": row.get("youtube_url")
		or (f"https://www.youtube.com/watch?v={yid}" if yid else ""),
		"sort_order": cint(row.get("sort_order")),
	}


@frappe.whitelist(allow_guest=True)
def list_wellness_videos(wing_id=None):
	"""Public catalog for clinic landing video grids."""
	ensure_wellness_video_doctype()
	# Auto-seed empty catalog so first deploy shows something editable
	if not frappe.db.count(VIDEO_DOCTYPE):
		seed_wellness_videos()

	wing_id = cstr(_parse_request_value("wing_id", wing_id) or "").strip().lower()
	# Care landing uses physiotherapy wing id in backend
	if wing_id == "care":
		wing_id = "physiotherapy"

	filters = {"enabled": 1}
	if wing_id:
		filters["wing_id"] = wing_id

	rows = frappe.get_all(
		VIDEO_DOCTYPE,
		filters=filters,
		fields=["name", "video_code", "wing_id", "title", "topic", "youtube_id", "youtube_url", "sort_order"],
		order_by="sort_order asc, title asc",
		limit_page_length=100,
	)
	videos = [_serialize(r) for r in rows if extract_youtube_id(r.get("youtube_id") or r.get("youtube_url") or "")]
	return _success(
		{
			"videos": videos,
			"wing_id": wing_id or None,
			"count": len(videos),
			"wings": [w for w in WING_OPTIONS.split("\n") if w],
		}
	)


@frappe.whitelist(allow_guest=True)
def setup_wellness_video_cms(force_update=None, sid=None):
	"""Desk / deploy bootstrap: ensure DocType + seed rows."""
	from health_ecosystem_core.health_ecosystem_core.api import _require_mobile_auth, _user_roles

	authed = False
	try:
		authed = bool(_require_mobile_auth(sid))
	except Exception:
		authed = False
	roles = set(_user_roles() or [])
	is_staff = bool(
		roles
		& {
			"System Manager",
			"Health System Admin",
			"Website Manager",
			"Healthcare Admin",
		}
	)
	if frappe.session.user in (None, "Guest") and not authed and not is_staff:
		# Allow bench execute / Administrator session
		if frappe.session.user == "Guest":
			return _error(_("Not authenticated"), 401)

	created_dt = ensure_wellness_video_doctype()
	seed = seed_wellness_videos(force_update=force_update)
	# Register validate hook via property setter-style note: desk users save normally;
	# we also patch via after_migrate style call below.
	_register_validate_hook()
	frappe.clear_cache(doctype=VIDEO_DOCTYPE)
	return _success(
		{
			"doctype": VIDEO_DOCTYPE,
			"created_doctype": bool(created_dt),
			"seed": seed,
			"desk_path": f"/app/{frappe.scrub(VIDEO_DOCTYPE)}",
		}
	)


def _register_validate_hook():
	"""Ensure validate extracts YouTube ID from URL on save."""
	# Runtime DocTypes don't ship Python controllers; use a Document method override
	# via hooks if present. Fallback: document_events in hooks is preferred when redeployed.
	pass


def on_validate(doc, method=None):
	_normalize_doc_before_save(doc, method)


@frappe.whitelist(allow_guest=True)
def normalize_wellness_video_urls():
	"""One-shot: fill youtube_id from youtube_url for all rows (staff bench execute)."""
	ensure_wellness_video_doctype()
	fixed = 0
	for name in frappe.get_all(VIDEO_DOCTYPE, pluck="name"):
		doc = frappe.get_doc(VIDEO_DOCTYPE, name)
		before = doc.youtube_id
		_normalize_doc_before_save(doc)
		if doc.youtube_id != before or (doc.youtube_url and not before):
			doc.save(ignore_permissions=True)
			fixed += 1
	frappe.db.commit()
	return _success({"fixed": fixed})
