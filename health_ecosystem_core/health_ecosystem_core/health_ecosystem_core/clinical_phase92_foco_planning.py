"""
Phase 92 — FOCO Sales-Channel Establishment Planning.

Administrator-only module.  Given a target area and number of FOCOs, VPs of
each vertical fill departmental guidance text-boxes.  An AI button calls
OpenAI to expand the guidance into concrete, actionable plans.

DocType: HEC FOCO Channel Plan (auto-created).
"""

from __future__ import annotations

import json
import os

import frappe
from frappe import _
from frappe.utils import cstr, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import _error, _success
from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
	openai_chat_completion,
	openai_runtime_status,
)

ADMIN_ROLES = frozenset({"Administrator", "System Manager"})

VERTICALS = [
	{
		"key": "operations",
		"label": "Operations",
		"default_guidance": (
			"1. FOCO Decor Items\n"
			"2. Costumes\n"
			"3. Consumables\n"
			"4. Office Items"
		),
	},
	{
		"key": "hr",
		"label": "HR",
		"default_guidance": (
			"1. Hiring Ads & Recruitment\n"
			"2. Training of Personnel"
		),
	},
	{
		"key": "crm",
		"label": "CRM",
		"default_guidance": (
			"1. Targeted Lead Generation\n"
			"2. Create Onboarding Differentials"
		),
	},
	{
		"key": "sales",
		"label": "Sales",
		"default_guidance": (
			"1. Take 4 Pronged Sales Approach\n"
			"2. Open Upgradation Call"
		),
	},
	{
		"key": "purchase",
		"label": "Purchase",
		"default_guidance": (
			"1. Create Acquisition Plan, Create Sales Plan\n"
			"2. Monitor ROAS"
		),
	},
	{
		"key": "marketing",
		"label": "Marketing",
		"default_guidance": (
			"1. Create Logistics\n"
			"2. Create Daily SOP with Qm\n"
			"3. Create Network"
		),
	},
]

PLAN_DOCTYPE = "HEC FOCO Channel Plan"


def _require_admin():
	roles = set(frappe.get_roles())
	if not roles & ADMIN_ROLES:
		frappe.throw(_("Only Administrators can access FOCO Planning"), frappe.PermissionError)


# ---------------------------------------------------------------------------
# DocType bootstrap
# ---------------------------------------------------------------------------

def _ensure_doctype():
	if frappe.db.exists("DocType", PLAN_DOCTYPE):
		return
	try:
		_create_doctype()
	except frappe.DuplicateEntryError:
		pass
	except Exception as e:
		if "Duplicate" in str(e):
			pass
		else:
			raise


def _create_doctype():
	fields = [
		{"fieldname": "target_area", "fieldtype": "Data", "label": "Target Area", "reqd": 1, "in_list_view": 1},
		{"fieldname": "foco_count", "fieldtype": "Int", "label": "Number of FOCOs", "reqd": 1, "in_list_view": 1},
		{"fieldname": "status", "fieldtype": "Select", "label": "Status",
		 "options": "Draft\nPlanning\nAI Generated\nApproved", "default": "Draft", "in_list_view": 1},
		{"fieldname": "created_by", "fieldtype": "Link", "label": "Created By", "options": "User"},
		{"fieldname": "sb_context", "fieldtype": "Section Break", "label": "AI Context Files"},
		{"fieldname": "context_files", "fieldtype": "Long Text", "label": "Context Files JSON",
		 "description": "JSON array of attached file URLs for AI context", "hidden": 1},
	]
	for v in VERTICALS:
		fields.append({"fieldname": f"sb_{v['key']}", "fieldtype": "Section Break", "label": v["label"]})
		fields.append({
			"fieldname": f"guidance_{v['key']}",
			"fieldtype": "Small Text",
			"label": f"{v['label']} — Guidance",
			"default": v["default_guidance"],
		})
		fields.append({"fieldname": f"cb_{v['key']}", "fieldtype": "Column Break"})
		fields.append({
			"fieldname": f"plan_{v['key']}",
			"fieldtype": "Long Text",
			"label": f"{v['label']} — AI Plan",
		})

	doc = frappe.get_doc({
		"doctype": "DocType",
		"name": PLAN_DOCTYPE,
		"module": "Health Ecosystem Core",
		"custom": 1,
		"autoname": "format:FOCO-PLAN-{####}",
		"fields": fields,
		"permissions": [
			{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
			{"role": "Administrator", "read": 1, "write": 1, "create": 1, "delete": 1},
		],
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()


# ---------------------------------------------------------------------------
# CRUD API
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def list_plans():
	_require_admin()
	_ensure_doctype()
	plans = frappe.get_all(
		PLAN_DOCTYPE,
		fields=["name", "target_area", "foco_count", "status", "created_by", "creation", "modified"],
		order_by="modified desc",
		limit_page_length=100,
	)
	return _success(plans)


@frappe.whitelist(allow_guest=True)
def get_plan(plan_id=None):
	_require_admin()
	_ensure_doctype()
	plan_id = plan_id or frappe.form_dict.get("plan_id")
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	data = doc.as_dict()
	data["verticals"] = []
	for v in VERTICALS:
		data["verticals"].append({
			"key": v["key"],
			"label": v["label"],
			"guidance": cstr(data.get(f"guidance_{v['key']}") or v["default_guidance"]),
			"plan": cstr(data.get(f"plan_{v['key']}") or ""),
		})
	data["context_files_list"] = _get_context_files(doc)
	return _success(data)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def create_plan():
	_require_admin()
	_ensure_doctype()
	target_area = cstr(frappe.form_dict.get("target_area") or "").strip()
	foco_count = frappe.form_dict.get("foco_count")
	if not target_area:
		return _error("Target Area is required")
	try:
		foco_count = int(foco_count)
	except (TypeError, ValueError):
		return _error("Number of FOCOs must be a valid integer")
	if foco_count < 1:
		return _error("Number of FOCOs must be at least 1")

	doc = frappe.get_doc({
		"doctype": PLAN_DOCTYPE,
		"target_area": target_area,
		"foco_count": foco_count,
		"status": "Draft",
		"created_by": frappe.session.user,
	})
	for v in VERTICALS:
		guidance = cstr(frappe.form_dict.get(f"guidance_{v['key']}") or "").strip()
		doc.set(f"guidance_{v['key']}", guidance or v["default_guidance"])
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"name": doc.name}, f"Plan {doc.name} created")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def update_plan():
	_require_admin()
	_ensure_doctype()
	plan_id = cstr(frappe.form_dict.get("plan_id") or "").strip()
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	for field in ("target_area", "foco_count", "status"):
		val = frappe.form_dict.get(field)
		if val is not None:
			doc.set(field, int(val) if field == "foco_count" else cstr(val).strip())
	for v in VERTICALS:
		for prefix in ("guidance", "plan"):
			key = f"{prefix}_{v['key']}"
			val = frappe.form_dict.get(key)
			if val is not None:
				doc.set(key, cstr(val))
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success({"name": doc.name}, "Plan updated")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def delete_plan():
	_require_admin()
	_ensure_doctype()
	plan_id = cstr(frappe.form_dict.get("plan_id") or "").strip()
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	frappe.delete_doc(PLAN_DOCTYPE, plan_id, ignore_permissions=True, force=True)
	frappe.db.commit()
	return _success(message="Plan deleted")


# ---------------------------------------------------------------------------
# Context Files — uploaded docs that feed into the AI prompt
# ---------------------------------------------------------------------------

def _get_context_files(doc):
	"""Parse context_files JSON from doc, return list of dicts."""
	raw = cstr(doc.get("context_files") or "").strip()
	if not raw:
		return []
	try:
		entries = json.loads(raw)
		return entries if isinstance(entries, list) else []
	except Exception:
		return []


def _set_context_files(doc, entries):
	doc.set("context_files", json.dumps(entries or [], ensure_ascii=False))


def _read_file_text(file_url):
	"""Read text content from an attached Frappe File. Supports txt, csv, md, json, pdf."""
	if not file_url:
		return ""
	try:
		file_doc = frappe.get_doc("File", {"file_url": file_url})
	except Exception:
		return ""
	file_path = file_doc.get_full_path()
	if not file_path or not os.path.isfile(file_path):
		return ""
	ext = os.path.splitext(file_path)[1].lower()
	if ext == ".pdf":
		return _read_pdf_text(file_path)
	try:
		with open(file_path, "r", encoding="utf-8", errors="replace") as f:
			return f.read(200_000)
	except Exception:
		return ""


def _read_pdf_text(path):
	"""Best-effort PDF text extraction."""
	try:
		import subprocess
		result = subprocess.run(
			["pdftotext", "-layout", path, "-"],
			capture_output=True, text=True, timeout=30,
		)
		if result.returncode == 0 and result.stdout.strip():
			return result.stdout[:200_000]
	except Exception:
		pass
	try:
		from PyPDF2 import PdfReader
		reader = PdfReader(path)
		pages = []
		for page in reader.pages[:50]:
			pages.append(page.extract_text() or "")
		return "\n\n".join(pages)[:200_000]
	except Exception:
		pass
	return "(PDF content could not be extracted)"


@frappe.whitelist(allow_guest=True)
def list_context_files(plan_id=None):
	_require_admin()
	_ensure_doctype()
	plan_id = plan_id or frappe.form_dict.get("plan_id")
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	return _success(_get_context_files(doc))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def attach_context_file():
	"""Attach an already-uploaded Frappe File to the plan as AI context."""
	_require_admin()
	_ensure_doctype()
	plan_id = cstr(frappe.form_dict.get("plan_id") or "").strip()
	file_url = cstr(frappe.form_dict.get("file_url") or "").strip()
	file_name = cstr(frappe.form_dict.get("file_name") or "").strip()
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	if not file_url:
		return _error("file_url is required")

	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	entries = _get_context_files(doc)
	if any(e.get("file_url") == file_url for e in entries):
		return _success(entries, "File already attached")
	entries.append({
		"file_url": file_url,
		"file_name": file_name or file_url.rsplit("/", 1)[-1],
		"added_by": frappe.session.user,
		"added_on": str(now_datetime()),
	})
	_set_context_files(doc, entries)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _success(entries, f"File attached")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def remove_context_file():
	_require_admin()
	_ensure_doctype()
	plan_id = cstr(frappe.form_dict.get("plan_id") or "").strip()
	file_url = cstr(frappe.form_dict.get("file_url") or "").strip()
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)
	if not file_url:
		return _error("file_url is required")

	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	entries = _get_context_files(doc)
	entries = [e for e in entries if e.get("file_url") != file_url]
	_set_context_files(doc, entries)
	doc.save(ignore_permissions=True)

	try:
		fdoc = frappe.get_doc("File", {"file_url": file_url})
		fdoc.delete(ignore_permissions=True)
	except Exception:
		pass

	frappe.db.commit()
	return _success(entries, "File removed")


def _build_context_text(doc):
	"""Concatenate all context file contents for the AI prompt."""
	entries = _get_context_files(doc)
	if not entries:
		return ""
	parts = []
	for entry in entries:
		content = _read_file_text(entry.get("file_url", ""))
		if content:
			parts.append(f"=== File: {entry.get('file_name', 'unknown')} ===\n{content}")
	return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# AI Plan Generation
# ---------------------------------------------------------------------------

def _build_ai_prompt(target_area, foco_count, verticals_guidance, context_text=""):
	"""Build the system + user messages for plan generation."""
	vertical_block = "\n\n".join(
		f"### {vg['label']}\nGuidance:\n{vg['guidance']}"
		for vg in verticals_guidance
	)
	system_msg = (
		"You are a senior franchise operations strategist. "
		"Given a target area, the number of FOCO outlets to establish, and "
		"high-level VP guidance for each department/vertical, produce a "
		"detailed, actionable departmental plan for each vertical. "
		"Include specific tasks, timelines, resource estimates, and KPIs. "
		"Respond ONLY with a JSON object with keys matching the vertical keys, "
		"each value being the detailed plan as a markdown-formatted string."
	)
	context_section = ""
	if context_text:
		context_section = (
			"\n\n---\n"
			"The following reference documents describe our FOCO features, "
			"offerings, and operational details. Use this context to make the "
			"plans specific and aligned with our actual business:\n\n"
			f"{context_text}\n\n---\n\n"
		)
	user_msg = (
		f"We are establishing **{foco_count} FOCOs** in **{target_area}**.\n\n"
		f"Below is the VP guidance for each department:\n\n{vertical_block}\n\n"
		f"{context_section}"
		f"Generate a detailed, actionable plan for each department. "
		f"Each plan should reference the specific numbers ({foco_count} FOCOs, "
		f"{target_area} area) and provide concrete steps."
	)
	return [
		{"role": "system", "content": system_msg},
		{"role": "user", "content": user_msg},
	]


@frappe.whitelist(allow_guest=True, methods=["POST"])
def generate_ai_plan():
	"""Call OpenAI to populate all vertical plans from their guidance text."""
	_require_admin()
	_ensure_doctype()

	plan_id = cstr(frappe.form_dict.get("plan_id") or "").strip()
	if not plan_id or not frappe.db.exists(PLAN_DOCTYPE, plan_id):
		return _error("Plan not found", 404)

	status = openai_runtime_status()
	if not status.get("ready"):
		return _error(
			f"AI is not ready: {status.get('last_error_code') or 'not configured'}. "
			"Check Health Ecosystem Settings → OpenAI API Key.",
			503,
		)

	doc = frappe.get_doc(PLAN_DOCTYPE, plan_id)
	verticals_guidance = []
	for v in VERTICALS:
		verticals_guidance.append({
			"key": v["key"],
			"label": v["label"],
			"guidance": cstr(doc.get(f"guidance_{v['key']}") or v["default_guidance"]),
		})

	context_text = _build_context_text(doc)
	messages = _build_ai_prompt(doc.target_area, doc.foco_count, verticals_guidance, context_text)

	ai_msg = openai_chat_completion(
		messages,
		temperature=0.5,
		timeout=90,
		log_prefix="foco_planning",
		response_format={"type": "json_object"},
	)
	if not ai_msg:
		return _error("AI did not return a response. Check OpenAI quota/key.", 502)

	raw = cstr(ai_msg.get("content") or "").strip()
	if not raw:
		return _error("AI returned empty content", 502)

	try:
		plans = json.loads(raw)
	except Exception:
		start, end = raw.find("{"), raw.rfind("}")
		if start >= 0 and end > start:
			try:
				plans = json.loads(raw[start : end + 1])
			except Exception:
				return _error("Failed to parse AI response as JSON", 502)
		else:
			return _error("Failed to parse AI response as JSON", 502)

	if not isinstance(plans, dict):
		return _error("AI returned unexpected format", 502)

	for v in VERTICALS:
		plan_text = plans.get(v["key"]) or plans.get(v["label"]) or ""
		if plan_text:
			doc.set(f"plan_{v['key']}", cstr(plan_text))

	doc.status = "AI Generated"
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	result = get_plan(plan_id)
	return result


@frappe.whitelist(allow_guest=True)
def get_verticals_meta():
	"""Return the list of verticals with their keys, labels, and default guidance."""
	_require_admin()
	return _success([
		{"key": v["key"], "label": v["label"], "default_guidance": v["default_guidance"]}
		for v in VERTICALS
	])
