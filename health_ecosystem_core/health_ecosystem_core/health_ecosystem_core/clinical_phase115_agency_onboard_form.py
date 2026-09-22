"""
Phase 115 — Agency portal onboarding form CMS (admin-driven).

Desk DocType "Agency Onboard Form" + child fields drives the public form on
https://www.e-remedium.in/agents and the franchisee prospect form on /agents/franchisees.
"""

from __future__ import annotations

import json
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_require_mobile_auth,
	_success,
	_user_roles,
)

FORM_DT = "Agency Onboard Form"
FIELD_DT = "Agency Onboard Form Field"
SUB_DT = "Agency Onboard Submission"

FORM_AGENTS = "agents_portal"
FORM_FRANCHISEE = "franchisee_onboard"

FIELD_TYPES = "Data\nText\nEmail\nPhone\nNumber\nSelect\nCheck\nTextarea"


def _is_staff():
	roles = set(_user_roles() or [])
	return bool(
		roles
		& {
			"System Manager",
			"Health System Admin",
			"Agency Manager",
			"Website Manager",
			"Healthcare Admin",
		}
	)


def _ensure_doctype(name, fields, autoname, permissions=None, is_child=False):
	if frappe.db.exists("DocType", name):
		return False
	payload = {
		"doctype": "DocType",
		"name": name,
		"module": "Health Ecosystem Core",
		"custom": 0,
		"autoname": autoname,
		"naming_rule": (
			"Expression"
			if str(autoname).startswith("format:")
			else ("By fieldname" if str(autoname).startswith("field:") else "Random")
		),
		"engine": "InnoDB",
		"track_changes": 1,
		"fields": fields,
		"permissions": permissions
		or [
			{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
			{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "delete": 1},
			{"role": "Agency Manager", "read": 1, "write": 1, "create": 1},
			{"role": "Website Manager", "read": 1, "write": 1, "create": 1, "delete": 0},
		],
	}
	if is_child:
		payload.update({"istable": 1, "editable_grid": 1, "permissions": [], "autoname": "", "naming_rule": ""})
	frappe.get_doc(payload).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=name)
	return True


def ensure_agency_onboard_form_doctypes():
	created = []
	if _ensure_doctype(
		FIELD_DT,
		[
			{"fieldname": "field_key", "label": "Field Key", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "label", "label": "Label", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{
				"fieldname": "fieldtype",
				"label": "Type",
				"fieldtype": "Select",
				"options": FIELD_TYPES,
				"default": "Data",
				"reqd": 1,
				"in_list_view": 1,
			},
			{"fieldname": "options", "label": "Options (Select)", "fieldtype": "Small Text", "description": "One option per line"},
			{"fieldname": "required", "label": "Required", "fieldtype": "Check", "default": "0", "in_list_view": 1},
			{"fieldname": "enabled", "label": "Enabled", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			{"fieldname": "placeholder", "label": "Placeholder", "fieldtype": "Data"},
			{"fieldname": "help_text", "label": "Help Text", "fieldtype": "Small Text"},
			{"fieldname": "sort_order", "label": "Sort Order", "fieldtype": "Int", "default": "10", "in_list_view": 1},
			{
				"fieldname": "span_full",
				"label": "Full Width",
				"fieldtype": "Check",
				"default": "0",
				"description": "Span two columns on the portal grid",
			},
		],
		"",
		is_child=True,
	):
		created.append(FIELD_DT)

	if _ensure_doctype(
		FORM_DT,
		[
			{"fieldname": "form_key", "label": "Form Key", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
			{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "subtitle", "label": "Subtitle", "fieldtype": "Small Text"},
			{"fieldname": "success_message", "label": "Success Message", "fieldtype": "Small Text"},
			{"fieldname": "submit_label", "label": "Submit Button Label", "fieldtype": "Data", "default": "Submit"},
			{"fieldname": "enabled", "label": "Enabled", "fieldtype": "Check", "default": "1", "in_list_view": 1},
			{"fieldname": "allow_guest", "label": "Allow Guest Submit", "fieldtype": "Check", "default": "1"},
			{
				"fieldname": "require_login",
				"label": "Require Login",
				"fieldtype": "Check",
				"default": "0",
				"description": "If set, portal must be authenticated (e.g. franchisee onboard)",
			},
			{"fieldname": "fields", "label": "Fields", "fieldtype": "Table", "options": FIELD_DT},
		],
		"field:form_key",
	):
		created.append(FORM_DT)

	if _ensure_doctype(
		SUB_DT,
		[
			{"fieldname": "form_key", "label": "Form Key", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
			{"fieldname": "form", "label": "Form", "fieldtype": "Link", "options": FORM_DT},
			{"fieldname": "full_name", "label": "Full Name", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "in_list_view": 1},
			{"fieldname": "email", "label": "Email", "fieldtype": "Data"},
			{"fieldname": "city", "label": "City / Territory", "fieldtype": "Data"},
			{
				"fieldname": "status",
				"label": "Status",
				"fieldtype": "Select",
				"options": "New\nReviewed\nAccepted\nRejected\nConverted",
				"default": "New",
				"in_list_view": 1,
			},
			{"fieldname": "answers_json", "label": "Answers JSON", "fieldtype": "Long Text"},
			{"fieldname": "submitted_by", "label": "Submitted By", "fieldtype": "Link", "options": "User"},
			{"fieldname": "submitted_on", "label": "Submitted On", "fieldtype": "Datetime", "default": "Now", "in_list_view": 1},
			{"fieldname": "ip_address", "label": "IP Address", "fieldtype": "Data"},
			{"fieldname": "notes", "label": "Admin Notes", "fieldtype": "Small Text"},
			{"fieldname": "linked_agent", "label": "Linked Agency Agent", "fieldtype": "Link", "options": "Agency Agent"},
			{"fieldname": "linked_request", "label": "Linked Franchise Onboard Request", "fieldtype": "Data"},
		],
		"format:AOS-{YYYY}-{#####}",
		permissions=[
			{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
			{"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
			{"role": "Agency Manager", "read": 1, "write": 1, "create": 1, "report": 1},
			{"role": "Agency Agent", "read": 1, "write": 0, "create": 1},
		],
	):
		created.append(SUB_DT)

	if created:
		frappe.db.commit()
	return created


def _seed_form(form_key, title, subtitle, success_message, submit_label, allow_guest, require_login, field_specs):
	ensure_agency_onboard_form_doctypes()
	if frappe.db.exists(FORM_DT, form_key):
		doc = frappe.get_doc(FORM_DT, form_key)
		# Refresh copy only if no custom fields yet (keep admin edits)
		if doc.fields and len(doc.fields) > 0:
			doc.title = title
			doc.subtitle = subtitle
			doc.success_message = success_message
			doc.submit_label = submit_label
			doc.enabled = 1
			doc.allow_guest = cint(allow_guest)
			doc.require_login = cint(require_login)
			doc.save(ignore_permissions=True)
			frappe.db.commit()
			return form_key
		doc.fields = []
	else:
		doc = frappe.get_doc(
			{
				"doctype": FORM_DT,
				"form_key": form_key,
				"title": title,
				"subtitle": subtitle,
				"success_message": success_message,
				"submit_label": submit_label,
				"enabled": 1,
				"allow_guest": cint(allow_guest),
				"require_login": cint(require_login),
			}
		)
	for spec in field_specs:
		doc.append("fields", spec)
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.title = title
		doc.subtitle = subtitle
		doc.success_message = success_message
		doc.submit_label = submit_label
		doc.enabled = 1
		doc.allow_guest = cint(allow_guest)
		doc.require_login = cint(require_login)
		doc.save(ignore_permissions=True)
	frappe.db.commit()
	return form_key


def seed_agency_onboard_forms():
	"""Default schemas — admins edit fields in Desk afterwards."""
	agents = _seed_form(
		FORM_AGENTS,
		"Become a Remedium Agency Agent",
		"Join the BA / MLM distribution network. Submit your details — our Agency team will review and activate your portal access.",
		"Thanks! Your application was received. Our Agency team will contact you shortly.",
		"Submit application",
		allow_guest=1,
		require_login=0,
		field_specs=[
			{"field_key": "full_name", "label": "Full name", "fieldtype": "Data", "required": 1, "enabled": 1, "sort_order": 10, "placeholder": "Your legal name"},
			{"field_key": "mobile", "label": "Mobile", "fieldtype": "Phone", "required": 1, "enabled": 1, "sort_order": 20, "placeholder": "10-digit mobile"},
			{"field_key": "email", "label": "Email", "fieldtype": "Email", "required": 1, "enabled": 1, "sort_order": 30},
			{"field_key": "city", "label": "City / Territory", "fieldtype": "Data", "required": 1, "enabled": 1, "sort_order": 40},
			{
				"field_key": "experience",
				"label": "Sales / franchise experience",
				"fieldtype": "Select",
				"options": "Fresher\n1–3 years\n3–5 years\n5+ years",
				"required": 0,
				"enabled": 1,
				"sort_order": 50,
			},
			{
				"field_key": "interest",
				"label": "What attracts you to Remedium Agency?",
				"fieldtype": "Textarea",
				"required": 0,
				"enabled": 1,
				"sort_order": 60,
				"span_full": 1,
			},
			{
				"field_key": "sponsor_code",
				"label": "Sponsor / referrer code (optional)",
				"fieldtype": "Data",
				"required": 0,
				"enabled": 1,
				"sort_order": 70,
				"help_text": "If an existing agent referred you, enter their code.",
			},
			{
				"field_key": "consent",
				"label": "I agree to be contacted by Remedium Agency about onboarding",
				"fieldtype": "Check",
				"required": 1,
				"enabled": 1,
				"sort_order": 80,
				"span_full": 1,
			},
		],
	)
	franchisee = _seed_form(
		FORM_FRANCHISEE,
		"Request franchisee onboard",
		"Submit a prospect to FFMS. After approval, complete onboarding from this page.",
		"Request sent to FFMS for review.",
		"Send to FFMS",
		allow_guest=0,
		require_login=1,
		field_specs=[
			{"field_key": "prospect_name", "label": "Prospect name", "fieldtype": "Data", "required": 1, "enabled": 1, "sort_order": 10},
			{"field_key": "mobile", "label": "Mobile", "fieldtype": "Phone", "required": 1, "enabled": 1, "sort_order": 20, "placeholder": "10-digit mobile"},
			{"field_key": "email", "label": "Email", "fieldtype": "Email", "required": 0, "enabled": 1, "sort_order": 30},
			{"field_key": "territory", "label": "Territory / city", "fieldtype": "Data", "required": 0, "enabled": 1, "sort_order": 40},
			{
				"field_key": "franchise_model",
				"label": "Model",
				"fieldtype": "Select",
				"options": "\nFOFO\nFOCO",
				"required": 0,
				"enabled": 1,
				"sort_order": 50,
			},
			{"field_key": "deal_value", "label": "Expected deal value", "fieldtype": "Number", "required": 0, "enabled": 1, "sort_order": 60, "placeholder": "100000"},
			{"field_key": "notes", "label": "Notes", "fieldtype": "Data", "required": 0, "enabled": 1, "sort_order": 70, "span_full": 1},
		],
	)
	return {"forms": [agents, franchisee]}


def _serialize_field(row):
	options = []
	raw = cstr(row.options or "")
	if raw.strip():
		options = [o.strip() for o in raw.replace("\r", "").split("\n") if o.strip()]
	return {
		"field_key": row.field_key,
		"label": row.label,
		"fieldtype": row.fieldtype or "Data",
		"options": options,
		"required": cint(row.required),
		"enabled": cint(row.enabled),
		"placeholder": row.placeholder or "",
		"help_text": row.help_text or "",
		"sort_order": cint(row.sort_order),
		"span_full": cint(getattr(row, "span_full", 0)),
	}


def _serialize_form(doc):
	fields = [_serialize_field(r) for r in (doc.fields or []) if cint(r.enabled)]
	fields.sort(key=lambda f: (f["sort_order"], f["label"]))
	return {
		"form_key": doc.form_key,
		"title": doc.title,
		"subtitle": doc.subtitle or "",
		"success_message": doc.success_message or "Submitted successfully.",
		"submit_label": doc.submit_label or "Submit",
		"enabled": cint(doc.enabled),
		"allow_guest": cint(doc.allow_guest),
		"require_login": cint(doc.require_login),
		"fields": fields,
		"desk_path": f"/app/{frappe.scrub(FORM_DT)}/{doc.name}",
	}


def _json_loads(raw, default=None):
	if default is None:
		default = {}
	if not raw:
		return default
	if isinstance(raw, (dict, list)):
		return raw
	try:
		return json.loads(raw)
	except Exception:
		return default


@frappe.whitelist(allow_guest=True)
def get_agency_onboard_form(form_key=None):
	ensure_agency_onboard_form_doctypes()
	if not frappe.db.exists(FORM_DT, FORM_AGENTS):
		seed_agency_onboard_forms()
	form_key = cstr(_parse_request_value("form_key", form_key) or FORM_AGENTS).strip() or FORM_AGENTS
	if not frappe.db.exists(FORM_DT, form_key):
		return _error(_("Form not found"), 404)
	doc = frappe.get_doc(FORM_DT, form_key)
	if not cint(doc.enabled):
		return _error(_("This form is currently disabled"), 403)
	return _success({"form": _serialize_form(doc)})


def _validate_answers(form_doc, answers: dict):
	clean = {}
	errors = []
	active = [r for r in (form_doc.fields or []) if cint(r.enabled)]
	for row in active:
		key = row.field_key
		val = answers.get(key)
		if isinstance(val, bool):
			val = "1" if val else "0"
		val = "" if val is None else cstr(val).strip()
		if cint(row.required) and not val:
			errors.append(_("{0} is required").format(row.label))
			continue
		ft = row.fieldtype or "Data"
		if ft == "Check":
			val = "1" if val.lower() in ("1", "true", "yes", "on") else "0"
			if cint(row.required) and val != "1":
				errors.append(_("{0} is required").format(row.label))
		elif ft == "Email" and val and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", val):
			errors.append(_("Invalid email for {0}").format(row.label))
		elif ft == "Phone" and val:
			digits = re.sub(r"\D", "", val)
			if len(digits) == 12 and digits.startswith("91"):
				digits = digits[2:]
			if not re.fullmatch(r"[6-9]\d{9}", digits):
				errors.append(_("Invalid mobile for {0}").format(row.label))
			else:
				val = digits
		elif ft == "Number" and val:
			try:
				flt(val)
			except Exception:
				errors.append(_("Invalid number for {0}").format(row.label))
		elif ft == "Select" and val:
			opts = [o.strip() for o in cstr(row.options or "").replace("\r", "").split("\n") if o.strip()]
			if opts and val not in opts:
				errors.append(_("Invalid option for {0}").format(row.label))
		clean[key] = val
	return clean, errors


@frappe.whitelist(allow_guest=True)
def submit_agency_onboard_form(form_key=None, answers=None, answers_json=None, sid=None):
	ensure_agency_onboard_form_doctypes()
	form_key = cstr(_parse_request_value("form_key", form_key) or FORM_AGENTS).strip() or FORM_AGENTS
	if not frappe.db.exists(FORM_DT, form_key):
		return _error(_("Form not found"), 404)
	form = frappe.get_doc(FORM_DT, form_key)
	if not cint(form.enabled):
		return _error(_("This form is currently disabled"), 403)

	authed = False
	try:
		authed = bool(_require_mobile_auth(sid))
	except Exception:
		authed = frappe.session.user not in (None, "Guest")

	if cint(form.require_login) and not authed:
		return _error(_("Please sign in to submit this form"), 401)
	if not cint(form.allow_guest) and not authed:
		return _error(_("Login required"), 401)

	raw = _parse_request_value("answers_json", answers_json) or _parse_request_value("answers", answers) or "{}"
	answers_dict = _json_loads(raw, {})
	if not isinstance(answers_dict, dict):
		return _error(_("answers must be an object"))

	clean, errors = _validate_answers(form, answers_dict)
	if errors:
		return _error("; ".join(errors))

	# Franchisee onboard: bridge into existing phase109 FFMS flow
	linked_request = None
	if form_key == FORM_FRANCHISEE:
		if not authed:
			return _error(_("Login required"), 401)
		try:
			from health_ecosystem_core.health_ecosystem_core.clinical_phase109_agency_agents import (
				get_agent_for_user,
				submit_agency_onboard_request,
			)

			agent_id = get_agent_for_user(frappe.session.user)
			if not agent_id:
				return _error(_("Agency agent profile not found for this user"))
			result = submit_agency_onboard_request(
				agent_id,
				prospect_name=clean.get("prospect_name") or clean.get("full_name"),
				mobile=clean.get("mobile"),
				email=clean.get("email"),
				territory=clean.get("territory") or clean.get("city"),
				franchise_model=clean.get("franchise_model"),
				deal_value=clean.get("deal_value") or 100000,
				notes=clean.get("notes"),
			)
			linked_request = (result or {}).get("request_id")
		except Exception as exc:
			frappe.log_error(title="agency_onboard_form_franchisee", message=frappe.get_traceback())
			return _error(cstr(exc) or _("Could not submit franchisee onboard"))

	sub = frappe.get_doc(
		{
			"doctype": SUB_DT,
			"form_key": form_key,
			"form": form_key,
			"full_name": clean.get("full_name") or clean.get("prospect_name") or "",
			"mobile": clean.get("mobile") or "",
			"email": clean.get("email") or "",
			"city": clean.get("city") or clean.get("territory") or "",
			"status": "New",
			"answers_json": json.dumps(clean, ensure_ascii=False),
			"submitted_by": frappe.session.user if frappe.session.user != "Guest" else None,
			"submitted_on": now_datetime(),
			"ip_address": cstr(frappe.local.request_ip or "") if getattr(frappe.local, "request_ip", None) else "",
			"linked_request": linked_request,
		}
	)
	sub.insert(ignore_permissions=True)
	frappe.db.commit()

	return _success(
		{
			"submission_id": sub.name,
			"form_key": form_key,
			"status": sub.status,
			"linked_request": linked_request,
			"message": form.success_message or _("Submitted successfully."),
		}
	)


@frappe.whitelist(allow_guest=True)
def setup_agency_onboard_forms(sid=None):
	if frappe.session.user in (None, "Guest"):
		try:
			if not _require_mobile_auth(sid) and not _is_staff():
				return _error(_("Not authenticated"), 401)
		except Exception:
			if not _is_staff():
				return _error(_("Not authenticated"), 401)
	created = ensure_agency_onboard_form_doctypes()
	seeded = seed_agency_onboard_forms()
	return _success(
		{
			"doctypes": created,
			"seeded": seeded,
			"desk_list": f"/app/{frappe.scrub(FORM_DT)}",
			"desk_submissions": f"/app/{frappe.scrub(SUB_DT)}",
			"public_url": "/agents",
		}
	)


@frappe.whitelist(allow_guest=True)
def list_agency_onboard_submissions(form_key=None, limit=50, sid=None):
	if not _require_mobile_auth(sid) and not _is_staff():
		if frappe.session.user in (None, "Guest"):
			return _error(_("Not authenticated"), 401)
	if not _is_staff():
		return _error(_("Staff only"), 403)
	ensure_agency_onboard_form_doctypes()
	form_key = cstr(_parse_request_value("form_key", form_key) or "").strip()
	limit = cint(_parse_request_value("limit", limit) or 50)
	filters = {}
	if form_key:
		filters["form_key"] = form_key
	rows = frappe.get_all(
		SUB_DT,
		filters=filters,
		fields=[
			"name",
			"form_key",
			"full_name",
			"mobile",
			"email",
			"city",
			"status",
			"submitted_on",
			"linked_request",
			"answers_json",
		],
		order_by="creation desc",
		limit_page_length=limit,
	)
	for r in rows:
		r["answers"] = _json_loads(r.pop("answers_json", None), {})
	return _success({"submissions": rows})
