"""Lab Technician portal — Settings: reporting pad, WhatsApp report delivery, pathologist signatures."""

from __future__ import annotations

import base64

import frappe
from frappe import _
from frappe.utils import cint, cstr

from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import is_lab_ops_user
from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
	SIGNATORY_DEPARTMENTS,
)

PAD_IMAGE_FIELDS = (
	("nabl_header_banner", "NABL reporting pad (header)"),
	("non_nabl_header_banner", "Non-NABL reporting pad (header)"),
	("footer_banner", "Footer strip"),
	("lab_logo", "Lab logo"),
	("nabl_logo", "NABL mark"),
)

IDENTITY_FIELDS = (
	"lab_name",
	"lab_tagline",
	"lab_address",
	"lab_phone",
	"lab_website",
	"nabl_accreditation",
	"nabl_certificate_no",
	"report_footer",
	"report_primary_color",
)

IMAGE_EXT = {"png", "jpg", "jpeg", "webp"}
IMAGE_MAX_BYTES = 2 * 1024 * 1024
EMP_SIG_FIELD = "hec_pathologist_signature"
WA_ENABLE_FIELD = "lab_whatsapp_report_enabled"
WA_MESSAGE_FIELD = "lab_whatsapp_report_message"
DEFAULT_WA_MESSAGE = (
	"Hello {patient_name}, your Remedium Labs report is ready. "
	"Open your Patient Portal → Reports to view or download it securely."
)


def _require_lab_settings(user=None):
	user = user or frappe.session.user
	if not is_lab_ops_user(user):
		frappe.throw(_("Lab Technician portal access required"), frappe.PermissionError)
	roles = set(frappe.get_roles(user))
	can_manage = bool(
		roles.intersection({"Lab Manager", "Health System Admin", "System Manager"})
	) or user == "Administrator"
	return {"user": user, "roles": roles, "can_manage": can_manage}


def _public_file_url(value):
	url = cstr(value or "").strip()
	if not url:
		return ""
	if url.startswith("http://") or url.startswith("https://") or url.startswith("data:"):
		return url
	if url.startswith("/"):
		return url
	return "/" + url.lstrip("/")


def _decode_image(file_name, file_data, max_bytes=None):
	file_name = cstr(file_name).strip()
	if not file_name or file_data in (None, ""):
		frappe.throw(_("Choose an image (PNG, JPG or WEBP)"))
	ext = (file_name.rsplit(".", 1)[-1] if "." in file_name else "").lower()
	if ext not in IMAGE_EXT:
		frappe.throw(_("Use a PNG, JPG or WEBP image"))
	raw = cstr(file_data)
	if raw.startswith("data:") and "," in raw:
		raw = raw.split(",", 1)[1]
	try:
		content = base64.b64decode(raw)
	except Exception:
		frappe.throw(_("Invalid image file"))
	if not content:
		frappe.throw(_("Image file is empty"))
	limit = int(max_bytes or IMAGE_MAX_BYTES)
	if len(content) > limit:
		frappe.throw(_("Image must be {0} MB or less").format(max(1, limit // (1024 * 1024))))
	safe = "".join(ch for ch in file_name if ch.isalnum() or ch in "._- ")[:80] or f"upload.{ext}"
	return content, safe, ext


def _save_attach(file_name, file_data, *, attached_to_doctype, attached_to_name, attached_to_field=None, max_bytes=None):
	content, safe, _ext = _decode_image(file_name, file_data, max_bytes=max_bytes)
	doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": safe,
			"content": content,
			"is_private": 0,
			"attached_to_doctype": attached_to_doctype,
			"attached_to_name": attached_to_name,
			"attached_to_field": attached_to_field or "",
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.file_url or doc.file_name


def _safe_create_custom_fields(mapping):
	"""Create fields without failing Settings when the target DocType schema is already broken."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	try:
		create_custom_fields(mapping, ignore_validate=True, update=True)
		return True
	except Exception:
		frappe.log_error(title="labtech_settings_custom_fields", message=frappe.get_traceback())
		# Fall back field-by-field so one bad DocType does not block the rest.
		ok = True
		for doctype, fields in (mapping or {}).items():
			for df in fields or []:
				try:
					create_custom_fields({doctype: [df]}, ignore_validate=True, update=True)
				except Exception:
					ok = False
					frappe.log_error(
						title=f"labtech_settings_field_{doctype}_{df.get('fieldname')}",
						message=frappe.get_traceback(),
					)
		return ok


def ensure_labtech_settings_fields():
	"""Custom fields for pathologist signature images + WhatsApp report defaults."""
	_safe_create_custom_fields(
		{
			"Employee": [
				{
					"fieldname": EMP_SIG_FIELD,
					"label": "Pathologist Signature Image",
					"fieldtype": "Attach Image",
					"insert_after": "image",
					"description": "Handwritten signature used on authorised lab reports",
				}
			]
		}
	)
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
			ensure_settings_signatory_defaults,
		)

		ensure_settings_signatory_defaults()
	except Exception:
		frappe.log_error(title="labtech_settings_signatory_defaults", message=frappe.get_traceback())

	if frappe.db.exists("DocType", "Health Ecosystem Settings"):
		hes = [
			{
				"fieldname": "section_lab_whatsapp_reports",
				"fieldtype": "Section Break",
				"label": "Lab Report WhatsApp",
				"insert_after": "critical_alert_level",
			},
			{
				"fieldname": WA_ENABLE_FIELD,
				"label": "Offer WhatsApp when report is authorised",
				"fieldtype": "Check",
				"default": "1",
				"insert_after": "section_lab_whatsapp_reports",
			},
			{
				"fieldname": WA_MESSAGE_FIELD,
				"label": "WhatsApp report message template",
				"fieldtype": "Small Text",
				"insert_after": WA_ENABLE_FIELD,
				"description": "Placeholders: {patient_name}, {report_id}",
			},
		]
		insert_after = WA_MESSAGE_FIELD
		for label, key, _role in SIGNATORY_DEPARTMENTS:
			fname = f"report_sig_{key}_image"
			hes.append(
				{
					"fieldname": fname,
					"label": f"Default {label} Signature Image",
					"fieldtype": "Attach Image",
					"insert_after": insert_after,
				}
			)
			insert_after = fname
		_safe_create_custom_fields({"Health Ecosystem Settings": hes})

	try:
		from health_ecosystem_core.health_ecosystem_core.doctype.lab_report_branding.lab_report_branding import (
			ensure_lab_report_branding,
		)

		ensure_lab_report_branding()
	except Exception:
		frappe.log_error(title="labtech_settings_branding", message=frappe.get_traceback())
	return True


def _whatsapp_status():
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
			whatsapp_delivery_ready,
		)
		from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
			get_meta_whatsapp_access_token,
			get_whatsapp_phone_number_id,
			get_whatsapp_provider,
			get_whatsapp_source_number,
		)

		provider = cstr(get_whatsapp_provider() or "").strip() or "Meta"
		phone_id = cstr(get_whatsapp_phone_number_id() or "").strip()
		sender = cstr(get_whatsapp_source_number() or "").strip()
		token = cstr(get_meta_whatsapp_access_token() or "").strip()
		ready = bool(whatsapp_delivery_ready())
		return {
			"ready": ready,
			"provider": provider,
			"phone_number_id": phone_id,
			"sender_number": sender,
			"token_configured": bool(token),
			"hint": (
				"WhatsApp Cloud is connected — authorised reports can be shared."
				if ready
				else "Configure Meta/Gupshup credentials in Desk (Health Ecosystem Settings / WhatsApp) to enable delivery."
			),
		}
	except Exception:
		frappe.log_error(title="labtech_whatsapp_status", message=frappe.get_traceback())
		return {
			"ready": False,
			"provider": "",
			"phone_number_id": "",
			"sender_number": "",
			"token_configured": False,
			"hint": "WhatsApp status unavailable.",
		}


def _pad_payload():
	from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

	b = get_report_branding() or {}
	images = {}
	for field, label in PAD_IMAGE_FIELDS:
		url = _public_file_url(b.get(field))
		images[field] = {"field": field, "label": label, "url": url}
	identity = {k: cstr(b.get(k) or "") for k in IDENTITY_FIELDS}
	identity["show_authorized_badge"] = cint(b.get("show_authorized_badge") or 0)
	return {"identity": identity, "images": images, "source": b.get("source") or ""}


def _dept_defaults():
	rows = []
	has_hes = frappe.db.exists("DocType", "Health Ecosystem Settings")
	for label, key, role in SIGNATORY_DEPARTMENTS:
		name = ""
		qual = ""
		image = ""
		if has_hes:
			try:
				name = cstr(frappe.db.get_single_value("Health Ecosystem Settings", f"report_sig_{key}_name") or "")
				qual = cstr(frappe.db.get_single_value("Health Ecosystem Settings", f"report_sig_{key}_qual") or "")
				image = _public_file_url(
					frappe.db.get_single_value("Health Ecosystem Settings", f"report_sig_{key}_image")
				)
			except Exception:
				pass
		rows.append(
			{
				"key": key,
				"label": label,
				"role": role,
				"name": name,
				"qualification": qual,
				"signature_url": image,
			}
		)
	return rows


def _pathologists():
	users = frappe.get_all(
		"Has Role",
		filters={"role": "Pathologist", "parenttype": "User"},
		pluck="parent",
	)
	users = [u for u in users if u and u not in ("Guest", "Administrator")]
	if not users:
		return []
	base_fields = ["name", "employee_name", "user_id", "designation", "department", "image"]
	emps = []
	try:
		has_sig = frappe.get_meta("Employee").has_field(EMP_SIG_FIELD)
	except Exception:
		has_sig = False
	try:
		fields = base_fields + ([EMP_SIG_FIELD] if has_sig else [])
		emps = frappe.get_all(
			"Employee",
			filters={"user_id": ("in", users), "status": "Active"},
			fields=fields,
			order_by="employee_name asc",
		)
	except Exception:
		emps = frappe.get_all(
			"Employee",
			filters={"user_id": ("in", users), "status": "Active"},
			fields=base_fields,
			order_by="employee_name asc",
		)
	out = []
	for e in emps:
		sig = ""
		try:
			sig = _public_file_url(e.get(EMP_SIG_FIELD)) if has_sig else ""
		except Exception:
			sig = ""
		out.append(
			{
				"employee": e.name,
				"name": e.employee_name or e.name,
				"user": e.user_id,
				"designation": e.designation or "",
				"department": e.department or "",
				"photo": _public_file_url(e.image),
				"signature_url": sig,
			}
		)
	return out


def get_labtech_settings(user=None):
	access = _require_lab_settings(user)
	try:
		ensure_labtech_settings_fields()
	except Exception:
		frappe.log_error(title="labtech_settings_ensure", message=frappe.get_traceback())
	wa_enabled = 1
	wa_message = DEFAULT_WA_MESSAGE
	if frappe.db.exists("DocType", "Health Ecosystem Settings"):
		try:
			wa_enabled = cint(frappe.db.get_single_value("Health Ecosystem Settings", WA_ENABLE_FIELD) or 1)
			wa_message = cstr(frappe.db.get_single_value("Health Ecosystem Settings", WA_MESSAGE_FIELD) or "") or DEFAULT_WA_MESSAGE
		except Exception:
			pass
	try:
		pad = _pad_payload()
	except Exception:
		frappe.log_error(title="labtech_settings_pad", message=frappe.get_traceback())
		pad = {"identity": {}, "images": {}, "source": ""}
	try:
		depts = _dept_defaults()
	except Exception:
		depts = []
	try:
		people = _pathologists()
	except Exception:
		frappe.log_error(title="labtech_settings_pathologists", message=frappe.get_traceback())
		people = []
	return {
		"can_manage": access["can_manage"],
		"reporting_pad": pad,
		"whatsapp": {
			**_whatsapp_status(),
			"report_enabled": wa_enabled,
			"report_message": wa_message,
		},
		"department_defaults": depts,
		"pathologists": people,
	}


def save_labtech_reporting_pad(user=None, identity=None, images=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can change reporting pad settings"), frappe.PermissionError)
	ensure_labtech_settings_fields()
	from health_ecosystem_core.health_ecosystem_core.doctype.lab_report_branding.lab_report_branding import (
		ensure_lab_report_branding,
	)

	ensure_lab_report_branding()
	doc = frappe.get_single("Lab Report Branding")
	if isinstance(identity, str):
		try:
			identity = frappe.parse_json(identity)
		except Exception:
			identity = {}
	identity = identity or {}
	for key in IDENTITY_FIELDS:
		if key in identity:
			doc.set(key, cstr(identity.get(key) or ""))
	if "show_authorized_badge" in identity:
		doc.set("show_authorized_badge", cint(identity.get("show_authorized_badge")))

	if isinstance(images, str):
		try:
			images = frappe.parse_json(images)
		except Exception:
			images = {}
	images = images or {}
	allowed = {f for f, _ in PAD_IMAGE_FIELDS}
	for field, payload in images.items():
		if field not in allowed or not payload:
			continue
		if isinstance(payload, str):
			continue
		fname = cstr(payload.get("file_name") or "")
		fdata = payload.get("file_data")
		if not fname or fdata in (None, ""):
			continue
		url = _save_attach(
			fname,
			fdata,
			attached_to_doctype="Lab Report Branding",
			attached_to_name="Lab Report Branding",
			attached_to_field=field,
		)
		doc.set(field, url)
		if field == "nabl_header_banner" and not doc.get("header_banner"):
			doc.set("header_banner", url)
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return get_labtech_settings(user)


def save_labtech_whatsapp(user=None, report_enabled=None, report_message=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can change WhatsApp settings"), frappe.PermissionError)
	ensure_labtech_settings_fields()
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		frappe.throw(_("Health Ecosystem Settings is not available"))
	frappe.db.set_single_value("Health Ecosystem Settings", WA_ENABLE_FIELD, cint(report_enabled))
	msg = cstr(report_message or "").strip() or DEFAULT_WA_MESSAGE
	frappe.db.set_single_value("Health Ecosystem Settings", WA_MESSAGE_FIELD, msg)
	frappe.db.commit()
	return get_labtech_settings(user)


def save_pathologist_signature(user=None, employee=None, file_name=None, file_data=None, clear=None):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can upload pathologist signatures"), frappe.PermissionError)
	ensure_labtech_settings_fields()
	employee = cstr(employee).strip()
	if not employee or not frappe.db.exists("Employee", employee):
		frappe.throw(_("Select a valid pathologist"))
	meta = frappe.get_meta("Employee")
	if not meta.has_field(EMP_SIG_FIELD):
		ensure_labtech_settings_fields()
		meta = frappe.get_meta("Employee")
	if not meta.has_field(EMP_SIG_FIELD):
		frappe.throw(_("Pathologist signature field could not be created"))

	if cint(clear):
		frappe.db.set_value("Employee", employee, EMP_SIG_FIELD, "")
		frappe.db.commit()
		return get_labtech_settings(user)

	url = _save_attach(
		file_name,
		file_data,
		attached_to_doctype="Employee",
		attached_to_name=employee,
		attached_to_field=EMP_SIG_FIELD,
	)
	frappe.db.set_value("Employee", employee, EMP_SIG_FIELD, url)
	frappe.db.commit()
	return get_labtech_settings(user)


def save_department_signature_default(
	user=None, department_key=None, name=None, qualification=None, file_name=None, file_data=None, clear_image=None
):
	access = _require_lab_settings(user)
	if not access["can_manage"]:
		frappe.throw(_("Only Lab Managers can change department signature defaults"), frappe.PermissionError)
	ensure_labtech_settings_fields()
	key = cstr(department_key).strip()
	allowed = {k for _label, k, _role in SIGNATORY_DEPARTMENTS}
	if key not in allowed:
		frappe.throw(_("Unknown department"))
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		frappe.throw(_("Health Ecosystem Settings is not available"))
	frappe.db.set_single_value("Health Ecosystem Settings", f"report_sig_{key}_name", cstr(name or "").strip())
	frappe.db.set_single_value(
		"Health Ecosystem Settings", f"report_sig_{key}_qual", cstr(qualification or "").strip()
	)
	img_field = f"report_sig_{key}_image"
	if cint(clear_image):
		frappe.db.set_single_value("Health Ecosystem Settings", img_field, "")
	elif file_name and file_data not in (None, ""):
		url = _save_attach(
			file_name,
			file_data,
			attached_to_doctype="Health Ecosystem Settings",
			attached_to_name="Health Ecosystem Settings",
			attached_to_field=img_field,
		)
		frappe.db.set_single_value("Health Ecosystem Settings", img_field, url)
	frappe.db.commit()
	return get_labtech_settings(user)
