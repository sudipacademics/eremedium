"""
Phase 112 — West Bengal hiring intake for ~100 volume-role applicants/day.

- Bidirectional map: hec_applicant_status ↔ hec_pipeline_stage
- Volume KPI (frontline/paramedical filter)
- Biodata ingest (photo/PDF/text → Job Applicant) with optional OCR
- WhatsApp knockout screening (vehicle/DL, district, joining)
- Publish Job Opening from Job Requisition + evergreen WB role seed
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
	_user_roles,
)

# Desk ATS status → Careers pipeline stage
ATS_TO_PIPELINE = {
	"New": "Received",
	"Screening": "Screening",
	"Interview 1": "Interview",
	"Interview 2": "Interview",
	"Offer Extended": "Offer",
	"Hired": "Onboarding",
	"Rejected": "Rejected",
}

PIPELINE_TO_ATS = {
	"Received": "New",
	"Screening": "Screening",
	"Interview": "Interview 1",
	"Assessment": "Interview 2",
	"Offer": "Offer Extended",
	"Onboarding": "Hired",
	"Rejected": "Rejected",
}

VOLUME_ROLE_KEYWORDS = (
	"phlebo",
	"lab tech",
	"technician",
	"dmlt",
	"bmlt",
	"sample",
	"runner",
	"logistics",
	"route",
	"field sales",
	"sales rep",
	"billing",
	"reception",
	"front desk",
	"collection",
	"pharmacy",
	"dispenser",
	"courier",
	"rider",
)

WB_EVERGREEN_ROLES = (
	{
		"job_title": "Phlebotomist",
		"department": "Collections",
		"location": "Kolkata / Howrah / 24 Parganas",
		"target_headcount": 15,
		"description": "Home and centre collections across Kolkata cluster. Two-wheeler preferred.",
		"volume_role": 1,
	},
	{
		"job_title": "Lab Technician (DMLT/BMLT)",
		"department": "Laboratory",
		"location": "Astra Tower + regional hubs",
		"target_headcount": 10,
		"description": "Sample processing and QC in NABL-aligned labs. Paramedical diploma preferred.",
		"volume_role": 1,
	},
	{
		"job_title": "B2B Sample Runner / Route Logistics",
		"department": "Logistics",
		"location": "Kolkata metro + Tier-2 WB",
		"target_headcount": 20,
		"description": "Institutional sample pickup across FOCO points. Valid DL + two-wheeler required.",
		"volume_role": 1,
	},
	{
		"job_title": "Field Sales Representative (FOCO)",
		"department": "Sales",
		"location": "West Bengal districts",
		"target_headcount": 12,
		"description": "B2B diagnostics sales and collection centre growth.",
		"volume_role": 1,
	},
	{
		"job_title": "Front Desk / Billing Executive",
		"department": "Front Office",
		"location": "Astra Tower, Kolkata",
		"target_headcount": 6,
		"description": "Patient registration, billing, and centre ops support.",
		"volume_role": 1,
	},
	{
		"job_title": "Pharmacy Dispenser",
		"department": "Pharmacy",
		"location": "Kolkata hubs",
		"target_headcount": 4,
		"description": "Dispensing and inventory support at Remedium pharmacy counters.",
		"volume_role": 1,
	},
)

KNOCKOUT_PROMPT = (
	"Remedium Careers — quick screening (reply with numbers):\n"
	"1) Two-wheeler + valid driving licence? YES or NO\n"
	"2) Preferred base district/cluster? (e.g. Kolkata, Howrah, Hooghly, Nadia)\n"
	"3) Can you join immediately / notice period in days?\n"
	"Reply like: 1) YES  2) Howrah  3) Immediate"
)

HR_ROLES = (
	"System Manager",
	"Health System Admin",
	"HR Manager",
	"HR User",
)


def ensure_wb_hiring_fields():
	"""Extra Job Applicant fields for WB ingest + knockout."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if not frappe.db.exists("DocType", "Job Applicant"):
		return
	create_custom_fields(
		{
			"Job Applicant": [
				{
					"fieldname": "hec_wb_section",
					"label": "WB Intake",
					"fieldtype": "Section Break",
					"insert_after": "hec_employee",
					"collapsible": 1,
				},
				{
					"fieldname": "hec_volume_role",
					"label": "Volume Role Applicant",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "hec_wb_section",
				},
				{
					"fieldname": "hec_preferred_district",
					"label": "Preferred District / Cluster",
					"fieldtype": "Data",
					"insert_after": "hec_volume_role",
				},
				{
					"fieldname": "hec_pincode",
					"label": "Pincode",
					"fieldtype": "Data",
					"insert_after": "hec_preferred_district",
				},
				{
					"fieldname": "hec_has_two_wheeler",
					"label": "Has Two-Wheeler + DL",
					"fieldtype": "Select",
					"options": "\nUnknown\nYes\nNo",
					"default": "Unknown",
					"insert_after": "hec_pincode",
				},
				{
					"fieldname": "hec_joining_notes",
					"label": "Joining / Notice",
					"fieldtype": "Data",
					"insert_after": "hec_has_two_wheeler",
				},
				{
					"fieldname": "hec_knockout_status",
					"label": "Knockout Status",
					"fieldtype": "Select",
					"options": "\nPending\nSent\nPassed\nFailed\nSkipped",
					"default": "Pending",
					"insert_after": "hec_joining_notes",
				},
				{
					"fieldname": "hec_knockout_raw",
					"label": "Knockout Reply Raw",
					"fieldtype": "Small Text",
					"insert_after": "hec_knockout_status",
				},
				{
					"fieldname": "hec_biodata_text",
					"label": "Parsed Biodata Text",
					"fieldtype": "Long Text",
					"insert_after": "hec_knockout_raw",
				},
			],
			"Job Requisition": [
				{
					"fieldname": "volume_role",
					"label": "Volume Role (WB 100/day KPI)",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "status",
				},
				{
					"fieldname": "hec_job_title",
					"label": "Role Title (ATS)",
					"fieldtype": "Data",
					"insert_after": "volume_role",
					"description": "Free-text title when HRMS Designation link is unused.",
				},
				{
					"fieldname": "hec_location",
					"label": "Hiring Location",
					"fieldtype": "Data",
					"insert_after": "hec_job_title",
				},
				{
					"fieldname": "job_opening",
					"label": "Published Job Opening",
					"fieldtype": "Link",
					"options": "Job Opening",
					"insert_after": "hec_location",
				},
			],
		},
		update=True,
	)


def _jr_open_statuses() -> list[str]:
	"""HRMS uses 'Open & Approved'; HEC DocType uses 'Open'."""
	if not frappe.db.exists("DocType", "Job Requisition"):
		return ["Open", "Open & Approved"]
	df = frappe.get_meta("Job Requisition").get_field("status")
	opts = [o for o in (cstr(getattr(df, "options", None) or "").split("\n") if df else []) if o]
	preferred = [s for s in ("Open & Approved", "Open", "Pending") if s in opts]
	return preferred or opts or ["Open", "Open & Approved"]


def _jr_default_open_status() -> str:
	return _jr_open_statuses()[0]


def _jr_title_of(jr) -> str:
	if not jr:
		return ""
	for key in ("hec_job_title", "job_title", "designation"):
		if getattr(jr, "meta", None) and jr.meta.has_field(key):
			val = cstr(getattr(jr, key, None) or "").strip()
			if val:
				return val
	return cstr(getattr(jr, "name", "") or "")


def _jr_find_open_by_title(title: str) -> str | None:
	title = cstr(title or "").strip()
	if not title or not frappe.db.exists("DocType", "Job Requisition"):
		return None
	meta = frappe.get_meta("Job Requisition")
	statuses = _jr_open_statuses()
	for field in ("hec_job_title", "job_title", "designation"):
		if not meta.has_field(field):
			continue
		for st in statuses:
			found = frappe.db.exists("Job Requisition", {field: title, "status": st})
			if found:
				return found
	return None


def _jr_build_seed_doc(spec: dict):
	"""Build Job Requisition for either HEC or HRMS schema."""
	meta = frappe.get_meta("Job Requisition")
	payload: dict[str, Any] = {"doctype": "Job Requisition"}
	title = spec["job_title"]
	if meta.has_field("hec_job_title"):
		payload["hec_job_title"] = title
	if meta.has_field("job_title"):
		payload["job_title"] = title
	if meta.has_field("designation"):
		# HRMS duplicate check keys on designation (+ requested_by); always set a Designation.
		if not frappe.db.exists("Designation", title):
			try:
				frappe.get_doc({"doctype": "Designation", "designation_name": title}).insert(
					ignore_permissions=True
				)
			except Exception:
				frappe.log_error(title="wb_hiring_designation", message=frappe.get_traceback())
		if frappe.db.exists("Designation", title):
			payload["designation"] = title
	if meta.has_field("hec_location"):
		payload["hec_location"] = spec.get("location") or ""
	if meta.has_field("location"):
		payload["location"] = spec.get("location") or ""
	if meta.has_field("target_headcount"):
		payload["target_headcount"] = cint(spec.get("target_headcount") or 1)
	if meta.has_field("no_of_positions"):
		payload["no_of_positions"] = cint(spec.get("target_headcount") or 1)
	if meta.has_field("status"):
		payload["status"] = _jr_default_open_status()
	if meta.has_field("description"):
		payload["description"] = spec.get("description") or ""
	if meta.has_field("department"):
		dept = spec.get("department") or ""
		df = meta.get_field("department")
		if df and df.fieldtype == "Link" and df.options == "Department":
			if dept and not frappe.db.exists("Department", dept):
				dept = ""
		payload["department"] = dept
	if meta.has_field("company"):
		company = (
			frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		if company:
			payload["company"] = company
	if meta.has_field("posting_date"):
		payload["posting_date"] = today()
	if meta.has_field("volume_role"):
		payload["volume_role"] = 1 if cint(spec.get("volume_role", 1)) else 0
	doc = frappe.get_doc(payload)
	doc.flags.ignore_links = True
	doc.flags.ignore_mandatory = True
	doc.flags.ignore_validate = True
	return doc


def sync_ats_pipeline_status(doc, *, prefer: str = "ats"):
	"""Keep Desk ATS status and Careers pipeline stage aligned on a Job Applicant doc."""
	if not doc or not getattr(doc, "meta", None):
		return
	has_ats = doc.meta.has_field("hec_applicant_status")
	has_pipe = doc.meta.has_field("hec_pipeline_stage")
	if not has_ats and not has_pipe:
		return

	ats = cstr(getattr(doc, "hec_applicant_status", None) or "").strip()
	pipe = cstr(getattr(doc, "hec_pipeline_stage", None) or "").strip()

	if prefer == "pipeline" and pipe:
		mapped = PIPELINE_TO_ATS.get(pipe)
		if has_ats and mapped and ats != mapped:
			doc.hec_applicant_status = mapped
	elif prefer == "ats" and ats:
		mapped = ATS_TO_PIPELINE.get(ats)
		if has_pipe and mapped and pipe != mapped:
			doc.hec_pipeline_stage = mapped
	elif prefer == "fill":
		if has_ats and not ats and pipe:
			doc.hec_applicant_status = PIPELINE_TO_ATS.get(pipe, "New")
		if has_pipe and not pipe and ats:
			doc.hec_pipeline_stage = ATS_TO_PIPELINE.get(ats, "Received")
		if has_ats and not getattr(doc, "hec_applicant_status", None):
			doc.hec_applicant_status = "New"
		if has_pipe and not getattr(doc, "hec_pipeline_stage", None):
			doc.hec_pipeline_stage = "Received"


def sync_ats_pipeline_by_name(applicant_name: str, *, prefer: str = "pipeline"):
	if not applicant_name or not frappe.db.exists("Job Applicant", applicant_name):
		return
	doc = frappe.get_doc("Job Applicant", applicant_name)
	sync_ats_pipeline_status(doc, prefer=prefer)
	doc.flags.ignore_validate = True
	doc.save(ignore_permissions=True)


def is_volume_role_title(title: str) -> bool:
	t = (title or "").lower()
	return any(k in t for k in VOLUME_ROLE_KEYWORDS)


def resolve_requisition_for_opening(job_opening: str | None) -> str | None:
	if not job_opening or not frappe.db.exists("DocType", "Job Requisition"):
		return None
	meta = frappe.get_meta("Job Requisition")
	if not meta.has_field("job_opening"):
		return None
	for st in _jr_open_statuses():
		found = frappe.db.get_value("Job Requisition", {"job_opening": job_opening, "status": st}, "name")
		if found:
			return found
	return frappe.db.get_value("Job Requisition", {"job_opening": job_opening}, "name")


def _require_hr():
	roles = set(_user_roles() or [])
	if not (roles & set(HR_ROLES)):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _digits(value: Any) -> str:
	return re.sub(r"\D", "", cstr(value or ""))


def _decode_data_url(payload: str | None) -> tuple[bytes, str]:
	raw = cstr(payload or "")
	if not raw:
		return b"", ""
	if raw.startswith("data:") and "," in raw:
		header, b64 = raw.split(",", 1)
		ext = "bin"
		if "jpeg" in header or "jpg" in header:
			ext = "jpg"
		elif "png" in header:
			ext = "png"
		elif "pdf" in header:
			ext = "pdf"
		return base64.b64decode(b64), ext
	try:
		return base64.b64decode(raw), "bin"
	except Exception:
		return raw.encode("utf-8", errors="ignore"), "txt"


def _ocr_image_bytes(content: bytes) -> str:
	"""Best-effort OCR; returns empty string if libs unavailable."""
	try:
		import pytesseract
		from PIL import Image
		import io

		img = Image.open(io.BytesIO(content))
		return pytesseract.image_to_string(img, lang="eng+ben") or pytesseract.image_to_string(img)
	except Exception:
		return ""


def normalize_biodata_text(text: str) -> dict[str, Any]:
	"""Heuristic normalizer (Bengali/English phonetic names, phone, pincode, quals)."""
	text = cstr(text or "")
	out: dict[str, Any] = {
		"full_name": "",
		"phone": "",
		"email": "",
		"pincode": "",
		"district": "",
		"qualification": "",
		"has_two_wheeler": "Unknown",
		"raw": text[:8000],
	}
	if not text.strip():
		return out

	email_m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
	if email_m:
		out["email"] = email_m.group(0).lower()

	phones = re.findall(r"(?:\+?91[-\s]?)?[6-9]\d{9}", text)
	if phones:
		out["phone"] = _digits(phones[0])[-10:]

	pin_m = re.search(r"\b([1-9]\d{5})\b", text)
	if pin_m:
		out["pincode"] = pin_m.group(1)

	for dist in (
		"Kolkata",
		"Howrah",
		"Hooghly",
		"Nadia",
		"Bardhaman",
		"Burdwan",
		"Murshidabad",
		"Midnapore",
		"Medinipur",
		"North 24",
		"South 24",
		"24 Parganas",
		"Asansol",
		"Durgapur",
		"Siliguri",
	):
		if dist.lower() in text.lower():
			out["district"] = dist
			break

	for qual in ("DMLT", "BMLT", "B.Sc", "BSc", "Diploma", "GNM", "ANM"):
		if qual.lower() in text.lower():
			out["qualification"] = qual
			break

	low = text.lower()
	if any(x in low for x in ("two wheeler", "two-wheeler", "bike", "scooter", "driving licence", "driving license", "dl ")):
		if any(x in low for x in ("no bike", "no dl", "without licence", "without license")):
			out["has_two_wheeler"] = "No"
		else:
			out["has_two_wheeler"] = "Yes"

	# Name: first non-empty line that isn't a label
	for line in text.splitlines():
		line = line.strip()
		if len(line) < 3 or len(line) > 60:
			continue
		if re.search(r"@|\d{6,}|curriculum|biodata|resume|address|mobile|phone|email", line, re.I):
			continue
		if re.match(r"^[A-Za-z][A-Za-z .']+$", line) or re.match(r"^[\u0980-\u09FF ]+$", line):
			out["full_name"] = line
			break

	# Optional LLM pass if configured
	try:
		enriched = _llm_enrich_biodata(text, out)
		if enriched:
			out.update({k: v for k, v in enriched.items() if v})
	except Exception:
		frappe.log_error(title="wb_hiring_llm_normalize", message=frappe.get_traceback())

	return out


def _llm_enrich_biodata(text: str, seed: dict) -> dict | None:
	"""Optional OpenAI-compatible enrich when API key present in conf."""
	api_key = cstr(frappe.conf.get("openai_api_key") or frappe.conf.get("hec_llm_api_key") or "")
	if not api_key or len(text) < 20:
		return None
	try:
		import requests

		base = cstr(frappe.conf.get("hec_llm_base_url") or "https://api.openai.com/v1").rstrip("/")
		model = cstr(frappe.conf.get("hec_llm_model") or "gpt-4o-mini")
		prompt = (
			"Extract hiring biodata as JSON keys: full_name, phone, email, pincode, district, "
			"qualification, has_two_wheeler (Yes/No/Unknown). Text follows:\n"
			+ text[:6000]
		)
		resp = requests.post(
			f"{base}/chat/completions",
			headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
			json={
				"model": model,
				"messages": [{"role": "user", "content": prompt}],
				"temperature": 0,
				"response_format": {"type": "json_object"},
			},
			timeout=40,
		)
		if not resp.ok:
			return None
		data = resp.json()
		content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or "{}"
		parsed = json.loads(content)
		return parsed if isinstance(parsed, dict) else None
	except Exception:
		return None


def create_applicant_from_ingest(
	*,
	parsed: dict,
	source: str,
	job_opening: str | None = None,
	job_requisition: str | None = None,
	attachment_bytes: bytes | None = None,
	attachment_ext: str = "jpg",
	send_knockout: bool = True,
) -> str:
	"""Insert Job Applicant from normalized biodata; optionally send WA knockout."""
	if not frappe.db.exists("DocType", "Job Applicant"):
		frappe.throw(_("Job Applicant DocType missing (HRMS required)"))

	ensure_wb_hiring_fields()
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers import _ensure_custom_fields

		_ensure_custom_fields()
	except Exception:
		pass
	try:
		from health_ecosystem_core.health_ecosystem_core.ats_setup import ensure_ats_custom_fields

		ensure_ats_custom_fields()
	except Exception:
		pass

	phone = _digits(parsed.get("phone") or "")[-10:]
	email = cstr(parsed.get("email") or "").strip().lower()
	full_name = cstr(parsed.get("full_name") or "").strip() or (f"Applicant {phone}" if phone else "WhatsApp Applicant")

	if phone:
		existing = frappe.db.get_value(
			"Job Applicant",
			{"phone_number": ["like", f"%{phone}%"], "creation": [">=", add_days(today(), -14)]},
			"name",
		)
		if not existing:
			existing = frappe.db.get_value(
				"Job Applicant",
				{"hec_mobile": ["like", f"%{phone}%"], "creation": [">=", add_days(today(), -14)]},
				"name",
			)
		if existing:
			return existing

	if not job_requisition and job_opening:
		job_requisition = resolve_requisition_for_opening(job_opening)
	if not job_opening and job_requisition and frappe.db.exists("Job Requisition", job_requisition):
		job_opening = frappe.db.get_value("Job Requisition", job_requisition, "job_opening")

	title_hint = ""
	if job_opening and frappe.db.exists("Job Opening", job_opening):
		title_hint = frappe.db.get_value("Job Opening", job_opening, "job_title") or job_opening
	elif job_requisition:
		jr = frappe.get_doc("Job Requisition", job_requisition)
		title_hint = _jr_title_of(jr)

	meta = frappe.get_meta("Job Applicant")
	doc = frappe.new_doc("Job Applicant")
	if meta.has_field("applicant_name"):
		doc.applicant_name = full_name
	if meta.has_field("hec_first_name"):
		parts = full_name.split(None, 1)
		doc.hec_first_name = parts[0]
		if len(parts) > 1 and meta.has_field("hec_last_name"):
			doc.hec_last_name = parts[1]
	if meta.has_field("email_id"):
		doc.email_id = email or f"{phone or frappe.generate_hash(length=8)}@ingest.local"
	if meta.has_field("phone_number"):
		doc.phone_number = phone
	if meta.has_field("hec_mobile"):
		doc.hec_mobile = phone
	if meta.has_field("job_title") and job_opening:
		doc.job_title = job_opening
	if meta.has_field("hec_applied_for") and job_requisition:
		doc.hec_applied_for = job_requisition
	if meta.has_field("status"):
		doc.status = "Open"
	if meta.has_field("hec_pipeline_stage"):
		doc.hec_pipeline_stage = "Received"
	if meta.has_field("hec_applicant_status"):
		doc.hec_applicant_status = "New"
	if meta.has_field("hec_source"):
		doc.hec_source = source
	if meta.has_field("hec_volume_role"):
		doc.hec_volume_role = 1 if is_volume_role_title(title_hint) or source in ("WhatsApp", "Apna", "WorkIndia", "Indeed") else 0
	if meta.has_field("hec_preferred_district"):
		doc.hec_preferred_district = cstr(parsed.get("district") or "")
	if meta.has_field("hec_pincode"):
		doc.hec_pincode = cstr(parsed.get("pincode") or "")
	if meta.has_field("hec_has_two_wheeler"):
		doc.hec_has_two_wheeler = cstr(parsed.get("has_two_wheeler") or "Unknown")
	if meta.has_field("hec_biodata_text"):
		doc.hec_biodata_text = cstr(parsed.get("raw") or "")[:20000]
	if meta.has_field("operational_route_experience") and parsed.get("qualification"):
		doc.operational_route_experience = f"Qualification: {parsed.get('qualification')}"
	if meta.has_field("hec_knockout_status"):
		doc.hec_knockout_status = "Pending"

	sync_ats_pipeline_status(doc, prefer="fill")
	doc.insert(ignore_permissions=True)

	if attachment_bytes:
		fname = f"biodata-{doc.name}.{attachment_ext or 'jpg'}"
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": fname,
				"content": attachment_bytes,
				"is_private": 1,
				"attached_to_doctype": "Job Applicant",
				"attached_to_name": doc.name,
			}
		)
		file_doc.save(ignore_permissions=True)
		if meta.has_field("resume_attachment"):
			frappe.db.set_value("Job Applicant", doc.name, "resume_attachment", file_doc.file_url)

	frappe.db.commit()

	if send_knockout and phone:
		try:
			send_knockout_prompt(doc.name, phone)
		except Exception:
			frappe.log_error(title="wb_hiring_knockout_send", message=frappe.get_traceback())

	return doc.name


@frappe.whitelist(allow_guest=True)
def ingest_hiring_biodata(
	source=None,
	text=None,
	image_base64=None,
	job_opening=None,
	job_requisition=None,
	phone=None,
	full_name=None,
	send_knockout=None,
	token=None,
):
	"""Public/partner webhook: text or biodata image → Job Applicant."""
	frappe.flags.ignore_csrf = True
	_check_ingest_token(token)

	source = cstr(_parse_request_value("source", source) or "WhatsApp").strip() or "WhatsApp"
	text = cstr(_parse_request_value("text", text) or "")
	image_b64 = _parse_request_value("image_base64", image_base64)
	job_opening = cstr(_parse_request_value("job_opening", job_opening) or "") or None
	job_requisition = cstr(_parse_request_value("job_requisition", job_requisition) or "") or None
	phone_hint = _digits(_parse_request_value("phone", phone))[-10:]
	name_hint = cstr(_parse_request_value("full_name", full_name) or "").strip()
	do_knockout = cint(_parse_request_value("send_knockout", send_knockout) if send_knockout is not None else 1)

	content, ext = _decode_data_url(cstr(image_b64) if image_b64 else "")
	ocr_text = ""
	if content and ext in ("jpg", "jpeg", "png", "bin"):
		ocr_text = _ocr_image_bytes(content)
		if ext == "bin":
			ext = "jpg"

	combined = "\n".join(x for x in (text, ocr_text) if x).strip()
	parsed = normalize_biodata_text(combined)
	if phone_hint and not parsed.get("phone"):
		parsed["phone"] = phone_hint
	if name_hint and not parsed.get("full_name"):
		parsed["full_name"] = name_hint
	if not parsed.get("phone") and not parsed.get("email"):
		return _error(_("Need at least phone or email (or parseable biodata)"))

	applicant = create_applicant_from_ingest(
		parsed=parsed,
		source=source,
		job_opening=job_opening,
		job_requisition=job_requisition,
		attachment_bytes=content or None,
		attachment_ext=ext or "jpg",
		send_knockout=bool(do_knockout),
	)
	return _success(
		{
			"application_id": applicant,
			"parsed": {k: parsed.get(k) for k in ("full_name", "phone", "email", "pincode", "district", "qualification")},
			"source": source,
		},
		message=_("Applicant ingested"),
	)


def _check_ingest_token(token=None):
	"""Allow Guest when matching hec_hiring_ingest_token; else require HR session."""
	expected = cstr(frappe.conf.get("hec_hiring_ingest_token") or "")
	got = cstr(_parse_request_value("token", token) or frappe.get_request_header("X-HEC-Hiring-Token") or "")
	if expected and got and got == expected:
		return
	if frappe.session.user and frappe.session.user != "Guest":
		roles = set(_user_roles() or [])
		if roles & set(HR_ROLES) or "System Manager" in roles:
			return
		# logged-in staff without HR still blocked
		if expected:
			frappe.throw(_("Invalid ingest token"), frappe.AuthenticationError)
		_require_hr()
		return
	if expected:
		frappe.throw(_("Invalid ingest token"), frappe.AuthenticationError)
	# No token configured: guest blocked
	frappe.throw(_("Ingest token not configured"), frappe.AuthenticationError)


def send_knockout_prompt(applicant_name: str, phone: str | None = None):
	phone = phone or frappe.db.get_value("Job Applicant", applicant_name, "hec_mobile")
	phone = phone or frappe.db.get_value("Job Applicant", applicant_name, "phone_number")
	if not phone:
		return False
	from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

	ok = send_whatsapp(phone, KNOCKOUT_PROMPT, context={"hiring": True, "persist": False})
	meta = frappe.get_meta("Job Applicant")
	if meta.has_field("hec_knockout_status"):
		frappe.db.set_value("Job Applicant", applicant_name, "hec_knockout_status", "Sent")
	frappe.db.commit()
	return bool(ok)


def apply_knockout_reply(phone: str, text: str) -> dict | None:
	"""Match latest Pending/Sent applicant by phone and score knockout answers."""
	phone10 = _digits(phone)[-10:]
	if not phone10 or not text:
		return None
	ensure_wb_hiring_fields()
	rows = frappe.get_all(
		"Job Applicant",
		filters={"hec_knockout_status": ["in", ["Pending", "Sent"]], "creation": [">=", add_days(today(), -21)]},
		fields=["name", "phone_number", "hec_mobile"],
		order_by="creation desc",
		limit_page_length=50,
	)
	applicant = None
	for r in rows:
		p = _digits(r.get("hec_mobile") or r.get("phone_number") or "")[-10:]
		if p == phone10:
			applicant = r.name
			break
	if not applicant:
		return None

	low = text.lower()
	has_vehicle = "Unknown"
	if re.search(r"\b(1\)\s*)?(yes|haa|hã|haan|avi)\b", low) or "two wheeler" in low:
		has_vehicle = "Yes"
	if re.search(r"\b(1\)\s*)?(no|na|nei)\b", low) and "yes" not in low.split("2")[0]:
		# crude: if first answer looks like no
		first = low.split("2")[0] if "2" in low else low[:40]
		if re.search(r"\bno\b|\bna\b", first):
			has_vehicle = "No"

	district = ""
	m = re.search(r"2\)\s*([A-Za-z0-9 /-]{2,40})", text)
	if m:
		district = m.group(1).strip()
	joining = ""
	m2 = re.search(r"3\)\s*([^\n]{2,60})", text)
	if m2:
		joining = m2.group(1).strip()

	passed = has_vehicle != "No"
	# Fail if explicit cannot join / long notice > 60 days
	notice_days = re.search(r"(\d+)\s*day", low)
	if notice_days and cint(notice_days.group(1)) > 60:
		passed = False
	if "cannot join" in low or "not interested" in low:
		passed = False

	updates = {
		"hec_knockout_raw": text[:2000],
		"hec_knockout_status": "Passed" if passed else "Failed",
	}
	meta = frappe.get_meta("Job Applicant")
	if meta.has_field("hec_has_two_wheeler"):
		updates["hec_has_two_wheeler"] = has_vehicle
	if meta.has_field("hec_preferred_district") and district:
		updates["hec_preferred_district"] = district
	if meta.has_field("hec_joining_notes") and joining:
		updates["hec_joining_notes"] = joining
	if meta.has_field("hec_pipeline_stage"):
		updates["hec_pipeline_stage"] = "Screening" if passed else "Rejected"
	if meta.has_field("hec_applicant_status"):
		updates["hec_applicant_status"] = "Screening" if passed else "Rejected"

	frappe.db.set_value("Job Applicant", applicant, updates, update_modified=True)
	frappe.db.commit()

	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		if passed:
			send_whatsapp(
				phone10,
				"Thanks — you passed initial screening. Our HR team will contact you for a local interview slot.",
				context={"hiring": True},
			)
		else:
			send_whatsapp(
				phone10,
				"Thank you for applying. Based on screening criteria we cannot proceed right now. We will keep your biodata for future openings.",
				context={"hiring": True},
			)
	except Exception:
		pass

	return {"application_id": applicant, "passed": passed}


def handle_hiring_whatsapp_inbound(phone: str, text: str, raw_msg: dict | None = None) -> dict | None:
	"""Called from Phase 87 inbound path for hiring biodata / knockout replies."""
	text = cstr(text or "").strip()
	phone = cstr(phone or "")
	if not phone:
		return None

	# Knockout reply first
	ko = apply_knockout_reply(phone, text)
	if ko:
		return {"handled": "knockout", **ko}

	# New biodata drop: image caption or long text
	looks_biodata = len(text) >= 40 or any(
		k in text.lower() for k in ("biodata", "resume", "dmlt", "experience", "qualification", "address")
	)
	msg_type = cstr((raw_msg or {}).get("type") or "")
	image_b64 = None
	if msg_type in ("image", "document") and raw_msg:
		# Media download not always available; store placeholder text
		text = text or f"[WhatsApp {msg_type} biodata from {phone}]"

	if looks_biodata or msg_type in ("image", "document"):
		parsed = normalize_biodata_text(text)
		if not parsed.get("phone"):
			parsed["phone"] = _digits(phone)[-10:]
		app_id = create_applicant_from_ingest(
			parsed=parsed,
			source="WhatsApp",
			attachment_bytes=None,
			send_knockout=True,
		)
		return {"handled": "ingest", "application_id": app_id}
	return None


@frappe.whitelist(allow_guest=True)
def get_volume_hiring_kpis(days=7):
	"""Applicants/day KPI for volume roles + knockout + sources."""
	frappe.flags.ignore_csrf = True
	if frappe.session.user in (None, "Guest"):
		return _error(_("Login required"), 401)
	_require_hr()
	ensure_wb_hiring_fields()

	days = max(1, min(cint(_parse_request_value("days", days) or 7), 90))
	since = add_days(today(), -days + 1)
	meta = frappe.get_meta("Job Applicant")
	filters: dict[str, Any] = {"creation": [">=", since]}
	fields = ["name", "creation", "hec_source", "job_title", "applicant_name"]
	for f in (
		"hec_volume_role",
		"hec_knockout_status",
		"hec_pipeline_stage",
		"hec_preferred_district",
		"hec_applicant_status",
	):
		if meta.has_field(f):
			fields.append(f)

	rows = frappe.get_all("Job Applicant", filters=filters, fields=fields, limit_page_length=5000)
	volume_rows = []
	for r in rows:
		title = ""
		if r.get("job_title") and frappe.db.exists("Job Opening", r.job_title):
			title = frappe.db.get_value("Job Opening", r.job_title, "job_title") or cstr(r.job_title)
		else:
			title = cstr(r.get("job_title") or "")
		is_vol = cint(r.get("hec_volume_role")) or is_volume_role_title(title)
		if is_vol:
			volume_rows.append(r)

	by_day: dict[str, int] = {}
	by_source: dict[str, int] = {}
	knockout = {"Pending": 0, "Sent": 0, "Passed": 0, "Failed": 0, "Skipped": 0}
	for r in volume_rows:
		d = str(getdate(r.creation))
		by_day[d] = by_day.get(d, 0) + 1
		src = cstr(r.get("hec_source") or "Unknown")
		by_source[src] = by_source.get(src, 0) + 1
		ks = cstr(r.get("hec_knockout_status") or "Pending")
		if ks in knockout:
			knockout[ks] += 1

	today_count = by_day.get(str(getdate(today())), 0)
	avg = round(sum(by_day.values()) / max(len(by_day), 1), 1) if by_day else 0.0
	passed = knockout.get("Passed", 0)
	failed = knockout.get("Failed", 0)
	ko_done = passed + failed
	pass_rate = round((passed / ko_done) * 100, 1) if ko_done else 0.0

	# Interview stage as proxy for show-up pipeline
	interviewing = sum(
		1
		for r in volume_rows
		if cstr(r.get("hec_pipeline_stage") or "") in ("Interview", "Assessment", "Offer", "Onboarding")
		or cstr(r.get("hec_applicant_status") or "") in ("Interview 1", "Interview 2", "Offer Extended", "Hired")
	)

	return _success(
		{
			"days": days,
			"target_per_day": 100,
			"applicants_today": today_count,
			"applicants_period": len(volume_rows),
			"avg_per_day": avg,
			"on_track": today_count >= 100 or avg >= 100,
			"knockout": knockout,
			"knockout_pass_rate_pct": pass_rate,
			"in_interview_or_later": interviewing,
			"by_day": [{"date": d, "count": by_day[d]} for d in sorted(by_day.keys())],
			"by_source": [
				{"source": s, "count": c} for s, c in sorted(by_source.items(), key=lambda x: -x[1])
			],
		}
	)


@frappe.whitelist()
def publish_requisition_to_opening(requisition=None):
	"""Create/link HRMS Job Opening from Job Requisition and publish for Careers."""
	_require_hr()
	requisition = cstr(_parse_request_value("requisition", requisition) or "")
	if not requisition or not frappe.db.exists("Job Requisition", requisition):
		return _error(_("Job Requisition not found"))
	if not frappe.db.exists("DocType", "Job Opening"):
		return _error(_("HRMS Job Opening not installed"))

	jr = frappe.get_doc("Job Requisition", requisition)
	opening_name = getattr(jr, "job_opening", None) if jr.meta.has_field("job_opening") else None
	title = _jr_title_of(jr)
	if opening_name and frappe.db.exists("Job Opening", opening_name):
		op = frappe.get_doc("Job Opening", opening_name)
	else:
		op = frappe.new_doc("Job Opening")
		if op.meta.has_field("job_title"):
			# Some HRMS versions use job_title as Data; others Link — set designation-like title field carefully
			pass
		op.job_title = title or requisition

	if op.meta.has_field("description") and jr.description:
		op.description = jr.description
	loc = getattr(jr, "hec_location", None) or getattr(jr, "location", None)
	if op.meta.has_field("hec_location") and loc:
		op.hec_location = loc
	if op.meta.has_field("location") and loc:
		df = op.meta.get_field("location")
		# HRMS Job Opening.location is often Link→Location; free-text goes to hec_location only.
		if df and df.fieldtype == "Link":
			if frappe.db.exists(df.options or "Location", loc):
				op.location = loc
		else:
			try:
				op.location = loc
			except Exception:
				pass
	if op.meta.has_field("department") and jr.department:
		try:
			op.department = jr.department
		except Exception:
			pass
	headcount = cint(getattr(jr, "target_headcount", None) or getattr(jr, "no_of_positions", None) or 1)
	if op.meta.has_field("hec_target_headcount"):
		op.hec_target_headcount = headcount or 1
	if op.meta.has_field("publish"):
		op.publish = 1
	if op.meta.has_field("status"):
		op.status = "Open"

	op.flags.ignore_links = True
	op.flags.ignore_mandatory = True
	if op.is_new():
		op.insert(ignore_permissions=True, ignore_mandatory=True)
	else:
		op.save(ignore_permissions=True)

	if jr.meta.has_field("job_opening"):
		frappe.db.set_value("Job Requisition", jr.name, "job_opening", op.name)
	if jr.meta.has_field("volume_role") and not cint(jr.volume_role) and is_volume_role_title(title):
		frappe.db.set_value("Job Requisition", jr.name, "volume_role", 1)
	frappe.db.commit()
	return _success({"requisition": jr.name, "job_opening": op.name, "published": 1})


@frappe.whitelist()
def seed_wb_evergreen_roles():
	"""Seed Open Job Requisitions (+ publish openings) for WB volume hiring."""
	_require_hr()
	ensure_wb_hiring_fields()
	if not frappe.db.exists("DocType", "Job Requisition"):
		return _error(_("Job Requisition missing — run ATS setup / migrate"))

	created = []
	for spec in WB_EVERGREEN_ROLES:
		existing = _jr_find_open_by_title(spec["job_title"])
		if existing:
			if frappe.get_meta("Job Requisition").has_field("volume_role"):
				frappe.db.set_value("Job Requisition", existing, "volume_role", 1)
			created.append({"requisition": existing, "skipped": True})
			continue
		doc = _jr_build_seed_doc(spec)
		doc.insert(ignore_permissions=True)
		pub = None
		try:
			pub = publish_requisition_to_opening(doc.name)
		except Exception:
			frappe.log_error(title="seed_wb_publish", message=frappe.get_traceback())
		created.append(
			{
				"requisition": doc.name,
				"job_opening": (pub or {}).get("data", {}).get("job_opening") if isinstance(pub, dict) else None,
			}
		)
	frappe.db.commit()
	return _success({"seeded": created})


@frappe.whitelist()
def setup_wb_hiring():
	"""Idempotent installer for Phase 112 fields + evergreen roles."""
	_require_hr()
	ensure_wb_hiring_fields()
	try:
		from health_ecosystem_core.health_ecosystem_core.ats_setup import setup_ats

		setup_ats()
	except Exception:
		frappe.log_error(title="setup_wb_hiring_ats", message=frappe.get_traceback())
	seed = seed_wb_evergreen_roles()
	return _success({"fields": True, "seed": (seed or {}).get("data")})
