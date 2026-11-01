"""Signed employee ID card verification for the QR code on Smilecure ID cards.

The QR carries an HMAC-signed token instead of a portal link. Anyone who scans it
sees only the card holder's public identity and whether they are currently active.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

import frappe
from frappe import _
from frappe.utils import cstr, now_datetime

VERIFY_PAGE = "https://people.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_id_verify.card"
COMPANY = "Smilecure Lifestyle Pvt Ltd"


def _key():
	from frappe.utils.password import get_encryption_key

	return (cstr(get_encryption_key()) + ":people-id-card").encode()


def _b64(raw: bytes) -> str:
	return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
	return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(employee: str) -> str:
	body = _b64(employee.encode())
	sig = hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]
	return f"{body}.{_b64(sig)}"


def read_token(token: str) -> str | None:
	try:
		body, sig = cstr(token).strip().split(".", 1)
		expected = hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]
		if not hmac.compare_digest(_b64(expected), sig):
			return None
		return _unb64(body).decode()
	except Exception:
		return None


def _clean_department(value):
	text = cstr(value).strip()
	if " — " in text:
		text = text.split(" — ")[-1]
	parts = text.rsplit(" - ", 1)
	if len(parts) == 2 and parts[1].isupper() and 2 <= len(parts[1]) <= 8:
		text = parts[0]
	return text.strip()


@frappe.whitelist(allow_guest=True)
def get_people_id_token(employee=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	denied = _require_people_hrms_access(sid)
	if denied:
		return denied
	employee = cstr(_parse_request_value("employee", employee)).strip()
	if not employee or not frappe.db.exists("Employee", employee):
		return _error(_("Employee not found"))
	own = frappe.db.get_value("Employee", employee, "user_id") == frappe.session.user
	if not own and not is_people_manager(_user_roles()):
		return _error(_("Not allowed"), 403)
	token = make_token(employee)
	return _success({"employee": employee, "token": token, "url": f"{VERIFY_PAGE}?t={token}"})


def _verified(raw):
	employee = read_token(raw) if raw else None
	if not employee or not frappe.db.exists("Employee", employee):
		return None
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "status", "department", "designation", "image"]
	for extra in ("people_wing", "people_division", "people_unit", "people_position", "relieving_date"):
		if meta.has_field(extra):
			fields.append(extra)
	row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	if cstr(row.get("status")) != "Active":
		return None
	if row.get("relieving_date") and cstr(row.get("relieving_date")) <= cstr(now_datetime())[:10]:
		return None
	return row


def _page(inner, ok):
	from werkzeug.wrappers import Response

	html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Employee Verification</title>
<style>*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#eef4f6;font-family:"Segoe UI",system-ui,sans-serif;color:#0f172a}}
.c{{width:min(380px,100%);background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,.12)}}
.h{{background:linear-gradient(90deg,#0f766e,#0e8a8a 46%,#0b6fc2);color:#fff;text-align:center;padding:22px 16px {'58px' if ok else '22px'}}}
.h small{{display:block;font-size:.86rem}}.h b{{display:block;margin-top:4px;letter-spacing:.04em}}
.p{{width:104px;height:104px;margin:-52px auto 0;border-radius:50%;border:5px solid #fff;background:#e7f6f3;color:#0f766e;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:2rem;overflow:hidden}}
.p img{{width:100%;height:100%;object-fit:cover}}.b{{padding:14px 22px 22px;text-align:center}}h1{{margin:8px 0 8px;font-size:1.35rem}}
.g{{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:800;font-size:.82rem}}.ok{{background:#dcfce7;color:#15803d}}.no{{background:#fee2e2;color:#b91c1c}}
dl{{margin:16px 0 0;display:grid;gap:8px;text-align:left}}dl div{{background:#f4fbfb;border-radius:12px;padding:9px 12px}}
dt{{font-size:.68rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#64748b}}dd{{margin:2px 0 0;font-weight:700}}
.f{{margin-top:16px;font-size:.74rem;color:#64748b}}</style></head><body><main class="c">
<div class="h"><small>{COMPANY}</small><b>EMPLOYEE VERIFICATION</b></div>{inner}</main></body></html>"""
	resp = Response(html, status=200, mimetype="text/html")
	resp.headers["Cache-Control"] = "no-store"
	resp.headers["X-Robots-Tag"] = "noindex, nofollow"
	resp.headers["Referrer-Policy"] = "no-referrer"
	return resp


@frappe.whitelist(allow_guest=True, methods=["GET"])
def card(t=None):
	from frappe.utils import escape_html

	row = _verified(cstr(t or frappe.form_dict.get("t") or "").strip())
	if not row:
		return _page(
			'<div class="b"><span class="g no">✕ Not a valid ID card</span>'
			'<p class="f">This ID card is not valid or the holder is no longer an active employee of '
			f"{COMPANY}. Do not accept it as proof of employment.</p></div>",
			False,
		)
	name = cstr(row.get("employee_name"))
	photo = cstr(row.get("image"))
	initials = "".join(w[0] for w in name.split()[:2]).upper() or "ID"
	avatar = f'<img alt="" src="{escape_html(photo)}">' if photo.startswith("/files/") else escape_html(initials)
	items = [
		("Employee ID", row.get("name")),
		("Wing", row.get("people_wing")),
		("Division", row.get("people_division")),
		("Department", _clean_department(row.get("department"))),
		("Position", row.get("people_position") or row.get("designation")),
		("Unit / Centre", row.get("people_unit")),
	]
	rows = "".join(f"<div><dt>{label}</dt><dd>{escape_html(cstr(value))}</dd></div>" for label, value in items if cstr(value).strip())
	return _page(
		f'<div class="p">{avatar}</div><div class="b"><h1>{escape_html(name)}</h1>'
		f'<span class="g ok">✓ Verified · Active employee</span><dl>{rows}</dl>'
		f'<p class="f">Verified by {COMPANY} · {cstr(now_datetime())[:16]}</p></div>',
		True,
	)


@frappe.whitelist(allow_guest=True)
def verify_people_id(t=None, token=None):
	frappe.local.response["http_status_code"] = 200
	raw = cstr(t or token or frappe.form_dict.get("t") or "").strip()
	row = _verified(raw)
	if not row:
		return {"valid": False, "reason": "invalid", "company": COMPANY}
	photo = cstr(row.get("image"))
	if not photo.startswith("/files/"):
		photo = ""
	return {
		"valid": True,
		"reason": "",
		"company": COMPANY,
		"employee_id": row.get("name"),
		"name": row.get("employee_name") or "",
		"status": "Active",
		"photo": photo,
		"wing": row.get("people_wing") or "",
		"division": row.get("people_division") or "",
		"department": _clean_department(row.get("department")),
		"position": row.get("people_position") or row.get("designation") or "",
		"unit": row.get("people_unit") or "",
		"checked_at": cstr(now_datetime())[:16],
	}
