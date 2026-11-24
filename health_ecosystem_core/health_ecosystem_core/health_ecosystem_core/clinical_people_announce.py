"""People HRMS announcements: structured audience, attachments, in-app notifications and PDF.

Builds on the `People Announcement` DocType from clinical_phase90_people_hrms. An announcement targets
everyone, managers, a designation or named employees, optionally narrowed to a business wing and a
department. When it is published (or its scheduled date arrives) every matching active employee gets a
`People Notification`; reading the announcement marks it read.
"""

from __future__ import annotations

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, format_date, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core import clinical_phase90_people_hrms as hrms

ANN_DT = hrms.ANN_DT
NOTIF_DT = "People Notification"
AUDIENCES = ("All Employees", "Managers", "Designation", "Individual")
CORPORATE = "__corporate__"
MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
COMPANY = "Smilecure Lifestyle Pvt Ltd"
MANAGER_WORDS = re.compile(r"manager|lead|head|director|chief|supervisor|incharge|in-charge", re.I)

ANN_FIELDS = [
	{"fieldname": "audience", "label": "Audience", "fieldtype": "Data"},
	{"fieldname": "aud_wing", "label": "Business Wing", "fieldtype": "Data"},
	{"fieldname": "aud_department", "label": "Department", "fieldtype": "Data"},
	{"fieldname": "aud_designation", "label": "Designation", "fieldtype": "Data"},
	{"fieldname": "aud_employees", "label": "Employees", "fieldtype": "Long Text"},
	{"fieldname": "attachments", "label": "Attachments", "fieldtype": "Long Text"},
	{"fieldname": "notified", "label": "Notifications Sent", "fieldtype": "Check"},
	{"fieldname": "notified_on", "label": "Notified On", "fieldtype": "Datetime"},
]
NOTIF_FIELDS = [
	{"fieldname": "employee", "label": "Employee", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "user", "label": "User", "fieldtype": "Data"},
	{"fieldname": "kind", "label": "Kind", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "title", "label": "Title", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "message", "label": "Message", "fieldtype": "Small Text"},
	{"fieldname": "ref_doctype", "label": "Reference Type", "fieldtype": "Data"},
	{"fieldname": "ref_name", "label": "Reference", "fieldtype": "Data"},
	{"fieldname": "is_read", "label": "Read", "fieldtype": "Check", "in_list_view": 1},
	{"fieldname": "read_on", "label": "Read On", "fieldtype": "Datetime"},
]
ANN_LIST_FIELDS = (
	"name", "title", "subtitle", "body", "ann_type", "status", "target_mode", "target_value", "publish_date",
	"publish_time", "end_date", "published_by", "file_url", "file_name", "modified", "creation",
	"audience", "aud_wing", "aud_department", "aud_designation", "aud_employees", "attachments", "notified",
)


# ---------------------------------------------------------------- schema


def ensure():
	if not hrms.ensure_people_announcement_doctypes():
		frappe.throw(_("Announcements desk is not available"))
	have = {f.fieldname for f in frappe.get_meta(ANN_DT).fields}
	first_run = "notified" not in have
	missing = [f for f in ANN_FIELDS if f["fieldname"] not in have]
	if missing:
		doc = frappe.get_doc("DocType", ANN_DT)
		for field in missing:
			doc.append("fields", field)
		doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype=ANN_DT)
	if first_run:
		# Announcements published before notifications existed must not flood everyone's inbox.
		for name in frappe.get_all(ANN_DT, pluck="name"):
			frappe.db.set_value(ANN_DT, name, "notified", 1, update_modified=False)
	hrms._ensure_custom_doctype(NOTIF_DT, NOTIF_FIELDS)


# ---------------------------------------------------------------- people


def _employees():
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "user_id", "department", "designation", "reports_to", "image"]
	fields += [f for f in ("people_wing", "people_division") if meta.has_field(f)]
	rows = frappe.get_all("Employee", filters={"status": "Active"}, fields=fields, order_by="employee_name asc", limit_page_length=5000)
	bosses = {r.reports_to for r in rows if r.reports_to}
	out = []
	for r in rows:
		out.append(
			frappe._dict(
				id=r.name,
				name=r.employee_name or r.name,
				user=r.user_id or "",
				department=r.department or "",
				designation=r.designation or "",
				wing=r.get("people_wing") or "",
				division=r.get("people_division") or "",
				photo=r.image or "",
				manager=bool(r.name in bosses or MANAGER_WORDS.search(r.designation or "")),
			)
		)
	return out


def _me():
	emp = hrms._people_employee_for_user()
	return emp.name if emp else ""


def _list(value):
	if not value:
		return []
	if isinstance(value, list):
		return [cstr(v) for v in value if cstr(v)]
	try:
		data = json.loads(value)
	except ValueError:
		return []
	return [cstr(v) for v in data if cstr(v)] if isinstance(data, list) else []


def _attachments(d):
	try:
		files = json.loads(d.get("attachments") or "[]")
	except ValueError:
		files = []
	files = [f for f in files if isinstance(f, dict) and f.get("file_url")]
	if not files and d.get("file_url"):
		files = [{"file_url": d.get("file_url"), "file_name": d.get("file_name") or "Attachment"}]
	return files


def _matches(d, emp):
	"""Is employee `emp` in the audience of announcement `d`?"""
	wing = cstr(d.get("aud_wing"))
	if wing == CORPORATE and emp.wing:
		return False
	if wing and wing != CORPORATE and emp.wing != wing:
		return False
	dept = cstr(d.get("aud_department"))
	if dept and emp.department != dept:
		return False
	audience = cstr(d.get("audience"))
	if audience:
		if audience == "Managers":
			return emp.manager
		if audience == "Designation":
			return emp.designation == cstr(d.get("aud_designation"))
		if audience == "Individual":
			return emp.id in _list(d.get("aud_employees"))
		return True
	# Announcements created before structured audiences: interpret the free-text target.
	mode = cstr(d.get("target_mode") or "All Employees")
	value = cstr(d.get("target_value"))
	if mode == "All Employees" or value == "All Employees":
		return True
	if mode == "Manager":
		return emp.manager
	if mode == "Department":
		word = re.sub(r"\s+department$", "", value, flags=re.I).strip().lower()
		return bool(word) and word in emp.department.lower()
	if mode == "Designation":
		return bool(value) and value.lower() in emp.designation.lower()
	if mode == "Individual":
		return emp.id in value or (emp.name and emp.name in value)
	return False


def _audience_label(d, names=None):
	if not d.get("audience"):
		return cstr(d.get("target_value")) or "All Employees"
	bits = []
	audience = cstr(d.get("audience") or "All Employees")
	if audience == "Managers":
		bits.append("Managers & team leads")
	elif audience == "Designation":
		bits.append(cstr(d.get("aud_designation")) or "Designation")
	elif audience == "Individual":
		ids = _list(d.get("aud_employees"))
		picked = [names.get(i, i) for i in ids] if names else ids
		bits.append(", ".join(picked[:3]) + (f" +{len(picked) - 3}" if len(picked) > 3 else "") if picked else "Selected employees")
	else:
		bits.append("All Employees")
	wing = cstr(d.get("aud_wing"))
	if wing:
		bits.append("Corporate / Back Office" if wing == CORPORATE else wing)
	if d.get("aud_department"):
		bits.append(_short_dept(d.get("aud_department")))
	return " · ".join(bits)


def _short_dept(name):
	parts = cstr(name).split(" — ")
	return re.sub(r"\s+-\s+[A-Z0-9]{2,8}$", "", parts[-1])


def _live(d):
	status = hrms._ann_display_status(d)
	if status not in ("Published", "Expired"):
		return False
	pub = getdate(d.get("publish_date")) if d.get("publish_date") else None
	return not pub or pub <= getdate(today())


def _row(d, extra=None):
	row = hrms._ann_row(d)
	row.update(
		{
			"audience": cstr(d.get("audience")) or "",
			"aud_wing": cstr(d.get("aud_wing")),
			"aud_department": cstr(d.get("aud_department")),
			"aud_designation": cstr(d.get("aud_designation")),
			"aud_employees": _list(d.get("aud_employees")),
			"attachments": [
				{"index": i, "file_name": f.get("file_name") or "Attachment", "file_url": f.get("file_url")} for i, f in enumerate(_attachments(d))
			],
			"notified": cint(d.get("notified")),
		}
	)
	if extra:
		row.update(extra)
	return row


# ---------------------------------------------------------------- notifications


def deliver(name):
	doc = frappe.get_doc(ANN_DT, name)
	if not _live(doc.as_dict()):
		return 0
	already = set(frappe.get_all(NOTIF_DT, filters={"ref_doctype": ANN_DT, "ref_name": doc.name}, pluck="employee"))
	sent = 0
	summary = cstr(doc.subtitle) or re.sub(r"<[^>]+>", " ", cstr(doc.body)).strip()
	for emp in _employees():
		if emp.id in already or not _matches(doc.as_dict(), emp):
			continue
		frappe.get_doc(
			{
				"doctype": NOTIF_DT,
				"employee": emp.id,
				"user": emp.user,
				"kind": "Announcement",
				"title": cstr(doc.title)[:140],
				"message": summary[:280],
				"ref_doctype": ANN_DT,
				"ref_name": doc.name,
				"is_read": 0,
			}
		).insert(ignore_permissions=True)
		sent += 1
	frappe.db.set_value(ANN_DT, doc.name, {"notified": 1, "notified_on": now_datetime()}, update_modified=False)
	return sent


def deliver_due():
	"""Send notifications for announcements that are published (or whose scheduled date has come) but not yet sent."""
	due = frappe.get_all(
		ANN_DT,
		filters={"status": ("in", ["Published", "Scheduled"]), "notified": 0},
		fields=["name", "publish_date"],
		limit_page_length=50,
	)
	sent = 0
	for row in due:
		if row.publish_date and getdate(row.publish_date) > getdate(today()):
			continue
		sent += deliver(row.name)
	return sent


def _mark_read(ann, employee):
	if not employee:
		return
	for name in frappe.get_all(NOTIF_DT, filters={"ref_doctype": ANN_DT, "ref_name": ann, "employee": employee, "is_read": 0}, pluck="name"):
		frappe.db.set_value(NOTIF_DT, name, {"is_read": 1, "read_on": now_datetime()}, update_modified=False)


# ---------------------------------------------------------------- reads


def _options(emps):
	from health_ecosystem_core.health_ecosystem_core.clinical_people_org import org_tree

	wings, departments, designations = [], {}, set()
	try:
		masters = org_tree().get("masters") or []
	except Exception:
		masters = []
	for m in masters:
		if not m.get("active"):
			continue
		if m.get("kind") == "Wing" and m.get("title") != "Corporate / Back Office" and m.get("area") != "Corporate":
			wings.append(m.get("title"))
		if m.get("kind") == "Department":
			key = m.get("erp_name") or ((m.get("wing") + " — ") if m.get("wing") else "") + m.get("title")
			departments[key] = {"value": key, "label": m.get("title"), "wing": m.get("wing") or "", "division": m.get("division") or ""}
	for e in emps:
		if e.department and e.department not in departments:
			departments[e.department] = {"value": e.department, "label": _short_dept(e.department), "wing": e.wing, "division": ""}
		if e.designation:
			designations.add(e.designation)
	return {
		"wings": wings or sorted({e.wing for e in emps if e.wing}),
		"departments": sorted(departments.values(), key=lambda x: (x["wing"], x["label"])),
		"designations": sorted(designations),
		"types": list(hrms.ANN_TYPES),
		"audiences": list(AUDIENCES),
	}


def desk(roles):
	ensure()
	deliver_due()
	manager = hrms.is_people_manager(roles)
	emps = _employees()
	names = {e.id: e.name for e in emps}
	raw = frappe.get_all(ANN_DT, fields=list(ANN_LIST_FIELDS), order_by="publish_date desc, modified desc", limit_page_length=500)
	stats = {}
	if manager:
		for r in frappe.db.sql(
			f"select ref_name, count(*) total, sum(is_read) read_count from `tab{NOTIF_DT}` where ref_doctype=%s group by ref_name",
			ANN_DT,
			as_dict=True,
		):
			stats[r.ref_name] = {"recipients": cint(r.total), "read": cint(r.read_count)}
		rows = [_row(d, {"audience_label": _audience_label(d, names), **stats.get(d.name, {"recipients": 0, "read": 0})}) for d in raw]
		return {"is_manager": True, "announcements": rows, "options": _options(emps), "employees": [dict(e) for e in emps]}
	me = _me()
	mine = next((e for e in emps if e.id == me), None)
	rows = [_row(d, {"audience_label": _audience_label(d, names)}) for d in raw if _live(d) and mine and _matches(d, mine)]
	return {"is_manager": False, "announcements": rows, "options": {}, "employees": []}


def my_feed(roles):
	ensure()
	deliver_due()
	me = _me()
	if not me:
		return {"employee": None, "announcements": [], "unread": 0}
	emp = next((e for e in _employees() if e.id == me), None)
	notes = {
		n.ref_name: n
		for n in frappe.get_all(NOTIF_DT, filters={"employee": me, "ref_doctype": ANN_DT}, fields=["name", "ref_name", "is_read", "creation"], limit_page_length=1000)
	}
	raw = frappe.get_all(ANN_DT, fields=list(ANN_LIST_FIELDS), order_by="publish_date desc, modified desc", limit_page_length=500)
	rows = []
	for d in raw:
		if not _live(d):
			continue
		note = notes.get(d.name)
		if not note and not (emp and _matches(d, emp)):
			continue
		rows.append(_row(d, {"unread": bool(note and not note.is_read), "audience_label": _audience_label(d)}))
	return {"employee": me, "announcements": rows, "unread": sum(1 for r in rows if r["unread"])}


def notifications(roles):
	ensure()
	deliver_due()
	me = _me()
	if not me:
		return {"unread": 0, "items": []}
	items = frappe.get_all(
		NOTIF_DT,
		filters={"employee": me},
		fields=["name", "kind", "title", "message", "ref_doctype", "ref_name", "is_read", "creation"],
		order_by="creation desc",
		limit_page_length=60,
	)
	live = {}
	for i in items:
		if i.ref_doctype == ANN_DT and i.ref_name not in live:
			d = frappe.db.get_value(ANN_DT, i.ref_name, ["status", "publish_date", "end_date"], as_dict=True)
			live[i.ref_name] = bool(d) and _live(d)
	items = [i for i in items if i.ref_doctype != ANN_DT or live.get(i.ref_name)]
	return {
		"unread": sum(1 for i in items if not i.is_read),
		"items": [
			{
				"id": i.name,
				"kind": i.kind,
				"title": i.title,
				"message": i.message or "",
				"ref": i.ref_name,
				"read": bool(i.is_read),
				"when": cstr(i.creation),
			}
			for i in items[:30]
		],
	}


def mark_read(roles, ids, everything=False):
	me = _me()
	if not me:
		return {"updated": 0}
	filters = {"employee": me, "is_read": 0}
	if not everything:
		ids = _list(ids)
		if not ids:
			return {"updated": 0}
		filters["name"] = ("in", ids)
	names = frappe.get_all(NOTIF_DT, filters=filters, pluck="name")
	for name in names:
		frappe.db.set_value(NOTIF_DT, name, {"is_read": 1, "read_on": now_datetime()}, update_modified=False)
	return {"updated": len(names)}


def _can_view(d, roles):
	if hrms.is_people_manager(roles):
		return True
	if not _live(d):
		return False
	me = _me()
	if not me:
		return False
	if frappe.db.exists(NOTIF_DT, {"employee": me, "ref_doctype": ANN_DT, "ref_name": d.get("name")}):
		return True
	emp = next((e for e in _employees() if e.id == me), None)
	return bool(emp and _matches(d, emp))


def _load(name, roles):
	ensure()
	if not name or not frappe.db.exists(ANN_DT, name):
		frappe.throw(_("Announcement not found"))
	d = frappe.db.get_value(ANN_DT, name, list(ANN_LIST_FIELDS), as_dict=True)
	if not _can_view(d, roles):
		frappe.throw(_("This announcement is not available to you"), frappe.PermissionError)
	return d


def detail(roles, name):
	d = _load(name, roles)
	_mark_read(name, _me())
	extra = {"audience_label": _audience_label(d, {e.id: e.name for e in _employees()})}
	if hrms.is_people_manager(roles):
		total = frappe.db.count(NOTIF_DT, {"ref_doctype": ANN_DT, "ref_name": name})
		extra.update({"recipients": total, "read": frappe.db.count(NOTIF_DT, {"ref_doctype": ANN_DT, "ref_name": name, "is_read": 1})})
	return _row(d, extra)


def attachment(roles, name, index):
	d = _load(name, roles)
	files = _attachments(d)
	index = cint(index)
	if index < 0 or index >= len(files):
		frappe.throw(_("Attachment not found"))
	f = files[index]
	file_name = frappe.db.get_value("File", {"file_url": f["file_url"]}, "name")
	if not file_name:
		frappe.throw(_("Attachment file is missing"))
	content = frappe.get_doc("File", file_name).get_content()
	if isinstance(content, str):
		content = content.encode()
	return {"file_name": f.get("file_name") or "attachment", "data": base64.b64encode(content).decode()}


# ---------------------------------------------------------------- write


def save(roles, data, files):
	hrms._require_manager(roles)
	ensure()
	data = data if isinstance(data, dict) else {}
	title = cstr(data.get("title")).strip()
	if not title:
		frappe.throw(_("Title is required"))
	body = cstr(data.get("body")).strip()
	if not body:
		frappe.throw(_("Description is required"))
	action = cstr(data.get("action") or "draft").lower()
	audience = cstr(data.get("audience") or "All Employees")
	if audience not in AUDIENCES:
		audience = "All Employees"
	designation = cstr(data.get("aud_designation")).strip()
	if audience == "Designation" and not designation:
		frappe.throw(_("Choose the designation"))
	picked = _list(data.get("aud_employees")) if audience == "Individual" else []
	if audience == "Individual" and not picked:
		frappe.throw(_("Choose at least one employee"))
	ann_type = cstr(data.get("ann_type") or "General")
	if ann_type not in hrms.ANN_TYPES:
		ann_type = "General"
	publish_date = getdate(data.get("publish_date")) if data.get("publish_date") else None
	end_date = getdate(data.get("end_date")) if data.get("end_date") else None
	if publish_date and end_date and end_date < publish_date:
		frappe.throw(_("End date cannot be before the publish date"))
	if action == "publish":
		publish_date = publish_date or getdate(today())
		status = "Scheduled" if publish_date > getdate(today()) else "Published"
	else:
		status = "Draft"
	wing = cstr(data.get("aud_wing")).strip()
	department = cstr(data.get("aud_department")).strip()
	values = {
		"title": title[:180],
		"subtitle": cstr(data.get("subtitle")).strip()[:180],
		"body": body,
		"ann_type": ann_type,
		"status": status,
		"audience": audience,
		"aud_wing": wing,
		"aud_department": department,
		"aud_designation": designation if audience == "Designation" else "",
		"aud_employees": json.dumps(picked),
		"target_mode": {"Managers": "Manager", "Designation": "Designation", "Individual": "Individual"}.get(audience) or ("Department" if wing or department else "All Employees"),
		"publish_date": publish_date,
		"end_date": end_date,
	}
	names = {e.id: e.name for e in _employees()} if picked else {}
	values["target_value"] = _audience_label(values, names)[:200]
	if status != "Draft":
		values["published_by"] = (frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user)[:140]
	name = cstr(data.get("id")).strip()
	if name:
		if not frappe.db.exists(ANN_DT, name):
			frappe.throw(_("Announcement not found"))
		doc = frappe.get_doc(ANN_DT, name)
		current = _attachments(doc.as_dict())
		doc.update(values)
	else:
		current = []
		doc = frappe.get_doc({"doctype": ANN_DT, **values})
	# Delivery skips employees already notified, so re-arming after an edit only reaches new recipients.
	doc.notified = 0
	keep = set(_list(data.get("keep_attachments")))
	kept = [f for f in current if f["file_url"] in keep]
	if len(kept) + len(files or []) > MAX_FILES:
		frappe.throw(_("Attach at most {0} files").format(MAX_FILES))
	if not name:
		doc.insert(ignore_permissions=True)
	added = []
	for f in files or []:
		fname = cstr(f.get("name")).strip()[:140]
		raw = cstr(f.get("data"))
		if not fname or not raw:
			continue
		if raw.startswith("data:") and "," in raw:
			raw = raw.split(",", 1)[1]
		try:
			content = base64.b64decode(raw)
		except Exception:
			frappe.throw(_("Invalid file data for {0}").format(fname))
		if len(content) > MAX_FILE_BYTES:
			frappe.throw(_("{0} is larger than 10 MB").format(fname))
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": fname, "content": content, "is_private": 1, "attached_to_doctype": ANN_DT, "attached_to_name": doc.name}
		).insert(ignore_permissions=True)
		added.append({"file_url": file_doc.file_url, "file_name": fname})
	attachments = kept + added
	doc.attachments = json.dumps(attachments)
	doc.file_url = attachments[0]["file_url"] if attachments else ""
	doc.file_name = attachments[0]["file_name"] if attachments else ""
	doc.save(ignore_permissions=True)
	sent = deliver(doc.name) if status == "Published" else 0
	return {"announcement": _row(doc.as_dict()), "notified": sent, "status": status}


# ---------------------------------------------------------------- PDF


def _clean_body(body):
	text = escape_html(cstr(body))
	for tag in ("b", "i", "u", "p", "strong", "em"):
		text = re.sub(rf"&lt;(/?){tag}&gt;", rf"<\1{tag}>", text, flags=re.I)
	text = re.sub(r"&lt;br\s*/?&gt;", "<br>", text, flags=re.I)
	return text.replace("\n", "<br>")


def pdf(roles, name):
	from frappe.utils.pdf import get_pdf

	d = _load(name, roles)
	e = escape_html
	files = _attachments(d)

	def row(label, value):
		return f"<tr><th>{e(label)}</th><td>{e(cstr(value)) if cstr(value) else '&mdash;'}</td></tr>"

	html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 16mm 14mm 18mm; }}
body {{ font-family: 'DejaVu Sans', Arial, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.5; }}
.top {{ border-bottom: 3px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; display: table; width: 100%; }}
.top div {{ display: table-cell; vertical-align: bottom; }}
.brand b {{ font-size: 15pt; color: #0f766e; }} .brand small {{ display: block; color: #64748b; font-size: 8.5pt; }}
.ref {{ text-align: right; font-size: 8.5pt; color: #475569; }}
.tag {{ display: inline-block; background: #e6f2f2; color: #0f766e; border-radius: 10px; padding: 2px 9px; font-size: 8.5pt; font-weight: bold; }}
h1 {{ font-size: 16pt; margin: 8px 0 2px; }} .sub {{ color: #475569; margin: 0 0 12px; }}
table {{ width: 100%; border-collapse: collapse; margin: 6px 0 14px; }}
th {{ width: 30%; text-align: left; font-weight: 600; color: #475569; background: #f1f7f7; }}
th, td {{ border: 1px solid #dbe5ea; padding: 5px 8px; font-size: 9.5pt; }}
h2 {{ font-size: 10.5pt; text-transform: uppercase; letter-spacing: .06em; color: #0f766e; margin: 14px 0 6px; }}
.body {{ border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }}
.foot {{ margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 7.8pt; color: #64748b; }}
</style></head><body>
<div class="top"><div class="brand"><b>{e(COMPANY)}</b><small>People HRMS · Announcement</small></div>
<div class="ref">Ref: <b>{e(d.name)}</b><br>Published: <b>{e(format_date(d.publish_date) if d.publish_date else '—')}</b></div></div>
<span class="tag">{e(d.ann_type or 'General')}</span>
<h1>{e(d.title)}</h1>{f'<p class="sub">{e(d.subtitle)}</p>' if d.subtitle else ''}
<table>{row('Audience', _audience_label(d, {x.id: x.name for x in _employees()}))}{row('Publish date', format_date(d.publish_date) if d.publish_date else '')}{row('Valid until', format_date(d.end_date) if d.end_date else '')}{row('Published by', d.published_by)}{row('Status', hrms._ann_display_status(d))}</table>
<h2>Announcement</h2><div class="body">{_clean_body(d.body)}</div>
{('<h2>Attachments</h2><ol>' + ''.join(f'<li>{e(f.get("file_name") or "Attachment")}</li>' for f in files) + '</ol>') if files else ''}
<div class="foot">{e(COMPANY)} · Generated {e(cstr(now_datetime())[:16])} · Attachments are available in the People HRMS portal.</div>
</body></html>"""
	content = get_pdf(html, {"page-size": "A4", "encoding": "UTF-8"})
	slug = re.sub(r"[^a-z0-9]+", "-", cstr(d.title).lower()).strip("-")[:50] or d.name
	return {"file_name": f"announcement-{slug}.pdf", "data": base64.b64encode(content).decode()}


# ---------------------------------------------------------------- whitelisted API


def _api():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles


def _json(value, fallback):
	if value in (None, ""):
		return fallback
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("Invalid request data"))


def _run(sid, fn):
	_error, _parse, _require, _success, _roles = _api()
	denied = _require(sid)
	if denied:
		return denied
	try:
		return _success(fn(_roles()))
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not allowed"), 403)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(re.sub(r"<[^>]+>", "", cstr(exc)))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="people_announce", message=frappe.get_traceback())
		return _error(cstr(exc) or _("Something went wrong"))


def _arg(name, value):
	return _api()[1](name, value)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_announcement_desk(sid=None):
	return _run(sid, desk)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_announcement(announcement=None, files=None, sid=None):
	return _run(sid, lambda roles: save(roles, _json(_arg("announcement", announcement), {}), _json(_arg("files", files), [])))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_announcement_detail(announcement=None, sid=None):
	return _run(sid, lambda roles: detail(roles, cstr(_arg("announcement", announcement))))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_announcement_pdf(announcement=None, sid=None):
	return _run(sid, lambda roles: pdf(roles, cstr(_arg("announcement", announcement))))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_announcement_attachment(announcement=None, index=None, sid=None):
	return _run(sid, lambda roles: attachment(roles, cstr(_arg("announcement", announcement)), _arg("index", index)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_announcements(sid=None):
	return _run(sid, my_feed)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_notifications(sid=None):
	return _run(sid, notifications)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def mark_notifications_read(ids=None, all=None, sid=None):
	return _run(sid, lambda roles: mark_read(roles, _json(_arg("ids", ids), []), cint(_arg("all", all))))
