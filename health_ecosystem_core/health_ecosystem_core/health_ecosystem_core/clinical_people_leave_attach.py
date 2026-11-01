"""Proof documents attached to People HRMS leave applications.

Files are stored private on the Leave Application. HR / admin, the leave approver,
and the employee who owns the leave can list and open them.
"""

from __future__ import annotations

import base64
import mimetypes

import frappe
from frappe import _
from frappe.utils import add_to_date, cstr, now_datetime

LEAVE_DT = "Leave Application"
ALLOWED_EXT = ("pdf", "jpg", "jpeg", "png", "webp")
MAX_BYTES = 5 * 1024 * 1024


def _helpers():
	from health_ecosystem_core.health_ecosystem_core.api import (
		_error,
		_parse_request_value,
		_require_people_hrms_access,
		_success,
		_user_roles,
	)
	from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

	return _error, _parse_request_value, _require_people_hrms_access, _success, _user_roles, is_people_manager


def _my_employee():
	return frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")


def _can_access(leave, roles, is_people_manager):
	if is_people_manager(roles):
		return True
	row = frappe.db.get_value(LEAVE_DT, leave, ["employee", "leave_approver", "owner"], as_dict=True)
	if not row:
		return False
	if row.leave_approver == frappe.session.user or row.owner == frappe.session.user:
		return True
	me = _my_employee()
	if me and row.employee == me:
		return True
	if me and frappe.db.get_value("Employee", row.employee, "reports_to") == me:
		return True
	return False


def _latest_own_leave():
	me = _my_employee()
	if not me:
		return None
	rows = frappe.get_all(
		LEAVE_DT,
		filters={"employee": me, "creation": (">=", add_to_date(now_datetime(), minutes=-15))},
		fields=["name"],
		order_by="creation desc",
		limit_page_length=1,
	)
	return rows[0].name if rows else None


def _attachments(leave):
	return [
		{"id": f.name, "file_name": f.file_name, "size": f.file_size or 0, "uploaded_on": cstr(f.creation)}
		for f in frappe.get_all(
			"File",
			filters={"attached_to_doctype": LEAVE_DT, "attached_to_name": leave},
			fields=["name", "file_name", "file_size", "creation"],
			order_by="creation asc",
		)
	]


@frappe.whitelist(allow_guest=True)
def upload_people_leave_attachment(leave=None, file_name=None, file_data=None, sid=None):
	_error, _parse, _require, _success, _roles, is_people_manager = _helpers()
	denied = _require(sid)
	if denied:
		return denied
	leave = _parse("leave", leave) or _latest_own_leave()
	file_name = cstr(_parse("file_name", file_name)).strip()
	file_data = _parse("file_data", file_data)
	if not leave or not frappe.db.exists(LEAVE_DT, leave):
		return _error(_("Leave application not found"))
	if not _can_access(leave, _roles(), is_people_manager):
		return _error(_("You cannot attach files to this leave"), 403)
	if not file_name or not file_data:
		return _error(_("Choose a file to upload"))
	ext = (file_name.rsplit(".", 1)[-1] if "." in file_name else "").lower()
	if ext not in ALLOWED_EXT:
		return _error(_("Use a PDF, JPG or PNG file"))
	raw = cstr(file_data)
	if raw.startswith("data:") and "," in raw:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw)
	except Exception:
		return _error(_("Invalid file data"))
	if len(content) > MAX_BYTES:
		return _error(_("Attachment must be 5 MB or less"))
	safe = "".join(ch for ch in file_name if ch.isalnum() or ch in "._- ")[:120] or f"leave-proof.{ext}"
	doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{leave}-{safe}",
			"content": content,
			"is_private": 1,
			"attached_to_doctype": LEAVE_DT,
			"attached_to_name": leave,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"leave": leave, "attachments": _attachments(leave)}, message=_("Attachment uploaded"))


@frappe.whitelist(allow_guest=True)
def get_people_leave_attachments(leave=None, sid=None):
	_error, _parse, _require, _success, _roles, is_people_manager = _helpers()
	denied = _require(sid)
	if denied:
		return denied
	leave = _parse("leave", leave)
	if not leave or not frappe.db.exists(LEAVE_DT, leave):
		return _error(_("Leave application not found"))
	if not _can_access(leave, _roles(), is_people_manager):
		return _error(_("Not allowed"), 403)
	return _success({"leave": leave, "attachments": _attachments(leave)})


@frappe.whitelist(allow_guest=True)
def open_people_leave_attachment(file=None, sid=None):
	_error, _parse, _require, _success, _roles, is_people_manager = _helpers()
	denied = _require(sid)
	if denied:
		return denied
	file = _parse("file", file)
	row = frappe.db.get_value("File", file, ["attached_to_doctype", "attached_to_name", "file_name"], as_dict=True) if file else None
	if not row or row.attached_to_doctype != LEAVE_DT:
		return _error(_("Attachment not found"))
	if not _can_access(row.attached_to_name, _roles(), is_people_manager):
		return _error(_("Not allowed"), 403)
	content = frappe.get_doc("File", file).get_content()
	if isinstance(content, str):
		content = content.encode()
	mime = mimetypes.guess_type(row.file_name or "")[0] or "application/octet-stream"
	return _success({"file_name": row.file_name, "mime": mime, "data": base64.b64encode(content).decode()})
