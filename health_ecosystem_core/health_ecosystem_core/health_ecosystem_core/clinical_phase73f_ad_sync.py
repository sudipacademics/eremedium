"""
Phase 73f — Hiring ad analytics sync (Meta + Google) + lead ingest + CSV import.

- Upserts HEC Hiring Campaign from platform APIs (when credentials set)
- Recomputes applications/hired from Job Applicant by job_opening
- Guest webhook + CSV for lead/campaign ingest when APIs are not ready
"""

from __future__ import annotations

import csv
import io
import json
import os

import frappe
import requests
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
	_error,
	_parse_request_value,
	_success,
)
from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
	get_google_ads_client_id,
	get_google_ads_client_secret,
	get_google_ads_customer_id,
	get_google_ads_developer_token,
	get_google_ads_refresh_token,
	get_hiring_ads_webhook_secret,
	get_meta_access_token,
	get_meta_ad_account_id,
	google_ads_configured,
	hiring_ads_sync_enabled,
	meta_ads_configured,
)

MKT_ROLES = (
	"System Manager",
	"Health System Admin",
	"HR Manager",
	"HR User",
	"Sales Manager",
	"Sales Representative",
)

PLATFORM_META_FB = "Facebook Ads"
PLATFORM_META_IG = "Instagram Ads"
PLATFORM_GOOGLE = "Google Ads"

UTM_SOURCE_MAP = {
	"facebook": PLATFORM_META_FB,
	"fb": PLATFORM_META_FB,
	"meta": PLATFORM_META_FB,
	"instagram": PLATFORM_META_IG,
	"ig": PLATFORM_META_IG,
	"google": PLATFORM_GOOGLE,
	"googleads": PLATFORM_GOOGLE,
	"gads": PLATFORM_GOOGLE,
	"linkedin": "LinkedIn Ads",
	"career": "Career Website",
	"careers": "Career Website",
	"website": "Career Website",
}


def _require_marketer():
	user = frappe.session.user
	if user in ("Guest", None):
		frappe.throw(_("Please sign in"), frappe.PermissionError)
	if not set(frappe.get_roles(user)).intersection(MKT_ROLES):
		frappe.throw(_("Marketing / HR access required"), frappe.PermissionError)


def _import_doctype(folder, doctype_name, force=True):
	from frappe.modules.import_file import import_file_by_path

	candidates = []
	app_path = frappe.get_app_path("health_ecosystem_core")
	candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
	try:
		import health_ecosystem_core.health_ecosystem_core.api as api_mod

		pkg_root = os.path.dirname(api_mod.__file__)
		candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
	except Exception:
		pass
	for json_path in candidates:
		if os.path.isfile(json_path):
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype=doctype_name)
			if frappe.db.exists("DocType", doctype_name):
				return True
	return False


def setup_phase73f():
	_import_doctype("hec_hiring_campaign", "HEC Hiring Campaign", force=True)
	_import_doctype("hec_hiring_lead", "HEC Hiring Lead", force=True)
	_import_doctype("health_ecosystem_settings", "Health Ecosystem Settings", force=True)
	return {"ok": True, "phase": "73f"}


def run_daily_hiring_ads_sync():
	"""Scheduler entry — no-op unless sync enabled."""
	if not hiring_ads_sync_enabled():
		return {"ok": True, "skipped": True, "reason": "hiring_ads_sync_enabled=0"}
	return sync_all_hiring_ads()


def sync_all_hiring_ads():
	"""Pull Meta + Google (when configured), then refresh HRMS apps/hired."""
	result = {
		"ok": True,
		"meta": {"synced": 0, "skipped": True},
		"google": {"synced": 0, "skipped": True},
		"hr_metrics": {},
	}
	try:
		if meta_ads_configured():
			result["meta"] = sync_meta_campaigns()
		if google_ads_configured():
			result["google"] = sync_google_campaigns()
		result["hr_metrics"] = refresh_campaign_hr_metrics()
		frappe.db.commit()
	except Exception:
		frappe.log_error(title="hiring_ads_sync")
		result["ok"] = False
		result["error"] = frappe.get_traceback()
	return result


@frappe.whitelist(allow_guest=True)
def run_hiring_ads_sync_now():
	frappe.flags.ignore_csrf = True
	_require_marketer()
	return _success(sync_all_hiring_ads())


def _find_campaign(external_id=None, campaign_name=None):
	if external_id and frappe.db.exists("HEC Hiring Campaign", {"external_campaign_id": external_id}):
		return frappe.get_doc("HEC Hiring Campaign", {"external_campaign_id": external_id})
	if campaign_name and frappe.db.exists("HEC Hiring Campaign", {"campaign_name": campaign_name}):
		return frappe.get_doc("HEC Hiring Campaign", {"campaign_name": campaign_name})
	return None


def _match_job_opening(role_label=None, campaign_name=None):
	if not frappe.db.exists("DocType", "Job Opening"):
		return None
	for candidate in (role_label, campaign_name):
		if not candidate:
			continue
		# Exact job_title
		name = frappe.db.exists("Job Opening", {"job_title": candidate})
		if name:
			return name
		# Contains
		rows = frappe.get_all(
			"Job Opening",
			filters={"job_title": ["like", f"%{candidate}%"]},
			pluck="name",
			limit=1,
		)
		if rows:
			return rows[0]
	# Strip "Hiring - " prefix
	for raw in (campaign_name, role_label):
		if raw and raw.lower().startswith("hiring"):
			cleaned = raw.split("-", 1)[-1].strip()
			name = frappe.db.exists("Job Opening", {"job_title": cleaned})
			if name:
				return name
	return None


def upsert_hiring_campaign(
	*,
	campaign_name,
	platform,
	external_campaign_id=None,
	external_account_id=None,
	impressions=0,
	clicks=0,
	leads=0,
	spend=0,
	status="Active",
	job_role_label=None,
	from_date=None,
	to_date=None,
	mark_from_ads=True,
):
	if not frappe.db.exists("DocType", "HEC Hiring Campaign"):
		frappe.throw(_("HEC Hiring Campaign DocType missing — run setup_phase73f"))

	doc = _find_campaign(external_campaign_id, campaign_name)
	if not doc:
		doc = frappe.new_doc("HEC Hiring Campaign")
		doc.campaign_name = campaign_name
		doc.platform = platform

	doc.platform = platform or doc.platform
	if external_campaign_id:
		doc.external_campaign_id = external_campaign_id
	if external_account_id:
		doc.external_account_id = external_account_id
	doc.impressions = cint(impressions)
	doc.clicks = cint(clicks)
	doc.leads = cint(leads)
	doc.spend = flt(spend)
	doc.status = status or doc.status or "Active"
	if job_role_label:
		doc.job_role_label = job_role_label
	elif not doc.job_role_label and campaign_name:
		# "Hiring - Lab Technician" -> Lab Technician
		doc.job_role_label = campaign_name.split("-", 1)[-1].strip() if "-" in campaign_name else campaign_name
	if from_date:
		doc.from_date = getdate(from_date)
	if to_date:
		doc.to_date = getdate(to_date)
	if not doc.job_opening:
		doc.job_opening = _match_job_opening(doc.job_role_label, doc.campaign_name)
	if mark_from_ads:
		doc.metrics_from_ads = 1
		doc.last_synced_at = now_datetime()
	doc.save(ignore_permissions=True)
	return doc.name


def sync_meta_campaigns(date_preset="last_30d"):
	"""Fetch campaign insights from Meta Marketing API."""
	account = (get_meta_ad_account_id() or "").strip().replace("act_", "")
	token = get_meta_access_token()
	if not account or not token:
		return {"synced": 0, "skipped": True, "reason": "meta credentials missing"}

	url = f"https://graph.facebook.com/v19.0/act_{account}/insights"
	params = {
		"access_token": token,
		"level": "campaign",
		"date_preset": date_preset,
		"fields": "campaign_id,campaign_name,impressions,clicks,spend,actions,publisher_platform",
		"limit": 100,
	}
	synced = []
	errors = []
	try:
		resp = requests.get(url, params=params, timeout=45)
		payload = resp.json() if resp.content else {}
		if resp.status_code >= 400:
			return {
				"synced": 0,
				"skipped": False,
				"error": payload.get("error", {}).get("message") or resp.text[:300],
			}
		for row in payload.get("data") or []:
			leads = _meta_lead_count(row.get("actions"))
			platform = _meta_platform_label(row)
			name = upsert_hiring_campaign(
				campaign_name=row.get("campaign_name") or f"Meta {row.get('campaign_id')}",
				platform=platform,
				external_campaign_id=str(row.get("campaign_id") or ""),
				external_account_id=account,
				impressions=cint(row.get("impressions")),
				clicks=cint(row.get("clicks")),
				leads=leads,
				spend=flt(row.get("spend")),
			)
			synced.append(name)
		# Pagination (one next page is enough for hiring accounts)
		next_url = (payload.get("paging") or {}).get("next")
		if next_url and len(synced) < 200:
			resp2 = requests.get(next_url, timeout=45)
			payload2 = resp2.json() if resp2.content else {}
			for row in payload2.get("data") or []:
				leads = _meta_lead_count(row.get("actions"))
				name = upsert_hiring_campaign(
					campaign_name=row.get("campaign_name") or f"Meta {row.get('campaign_id')}",
					platform=_meta_platform_label(row),
					external_campaign_id=str(row.get("campaign_id") or ""),
					external_account_id=account,
					impressions=cint(row.get("impressions")),
					clicks=cint(row.get("clicks")),
					leads=leads,
					spend=flt(row.get("spend")),
				)
				synced.append(name)
	except Exception as exc:
		frappe.log_error(title="sync_meta_campaigns")
		errors.append(str(exc))

	return {"synced": len(synced), "campaigns": synced, "skipped": False, "errors": errors}


def _meta_lead_count(actions):
	if not actions:
		return 0
	total = 0
	for a in actions:
		action_type = (a.get("action_type") or "").lower()
		if action_type in ("lead", "onsite_conversion.lead_grouped", "leadgen_grouped"):
			total += cint(a.get("value"))
	return total


def _meta_platform_label(row):
	# insights at campaign level rarely break out IG vs FB; default Facebook Ads
	pub = (row.get("publisher_platform") or "").lower()
	if "instagram" in pub or pub == "instagram":
		return PLATFORM_META_IG
	return PLATFORM_META_FB


def _google_access_token():
	"""Exchange refresh token for access token."""
	data = {
		"client_id": get_google_ads_client_id(),
		"client_secret": get_google_ads_client_secret(),
		"refresh_token": get_google_ads_refresh_token(),
		"grant_type": "refresh_token",
	}
	resp = requests.post("https://oauth2.googleapis.com/token", data=data, timeout=30)
	payload = resp.json() if resp.content else {}
	if resp.status_code >= 400 or not payload.get("access_token"):
		raise frappe.ValidationError(
			payload.get("error_description") or payload.get("error") or "Google OAuth token failed"
		)
	return payload["access_token"]


def sync_google_campaigns():
	"""Fetch campaign metrics via Google Ads API searchStream (REST)."""
	customer = (get_google_ads_customer_id() or "").replace("-", "").strip()
	dev_token = get_google_ads_developer_token()
	if not customer or not google_ads_configured():
		return {"synced": 0, "skipped": True, "reason": "google credentials missing"}

	try:
		access = _google_access_token()
	except Exception as exc:
		return {"synced": 0, "skipped": False, "error": str(exc)}

	query = """
		SELECT
			campaign.id,
			campaign.name,
			campaign.status,
			metrics.impressions,
			metrics.clicks,
			metrics.cost_micros,
			metrics.conversions
		FROM campaign
		WHERE segments.date DURING LAST_30_DAYS
			AND campaign.status != 'REMOVED'
	"""
	url = f"https://googleads.googleapis.com/v17/customers/{customer}/googleAds:searchStream"
	headers = {
		"Authorization": f"Bearer {access}",
		"developer-token": dev_token,
		"Content-Type": "application/json",
	}
	synced = []
	try:
		resp = requests.post(url, headers=headers, json={"query": query}, timeout=60)
		if resp.status_code >= 400:
			return {"synced": 0, "skipped": False, "error": resp.text[:400]}
		# searchStream returns a JSON array of result batches
		batches = resp.json() if resp.content else []
		if isinstance(batches, dict):
			batches = [batches]
		agg = {}
		for batch in batches:
			for row in batch.get("results") or []:
				camp = row.get("campaign") or {}
				metrics = row.get("metrics") or {}
				cid = str(camp.get("id") or "")
				if not cid:
					continue
				bucket = agg.setdefault(
					cid,
					{
						"name": camp.get("name") or f"Google {cid}",
						"status": camp.get("status") or "ENABLED",
						"impressions": 0,
						"clicks": 0,
						"cost_micros": 0,
						"conversions": 0.0,
					},
				)
				bucket["impressions"] += cint(metrics.get("impressions"))
				bucket["clicks"] += cint(metrics.get("clicks"))
				bucket["cost_micros"] += cint(metrics.get("costMicros") or metrics.get("cost_micros"))
				bucket["conversions"] += flt(metrics.get("conversions"))
		for cid, b in agg.items():
			status = "Active"
			if str(b["status"]).upper() in ("PAUSED", "PAUSED"):
				status = "Paused"
			name = upsert_hiring_campaign(
				campaign_name=b["name"],
				platform=PLATFORM_GOOGLE,
				external_campaign_id=f"gads:{cid}",
				external_account_id=customer,
				impressions=b["impressions"],
				clicks=b["clicks"],
				leads=cint(round(b["conversions"])),
				spend=flt(b["cost_micros"]) / 1_000_000.0,
				status=status,
			)
			synced.append(name)
	except Exception as exc:
		frappe.log_error(title="sync_google_campaigns")
		return {"synced": 0, "skipped": False, "error": str(exc)}

	return {"synced": len(synced), "campaigns": synced, "skipped": False}


def refresh_campaign_hr_metrics():
	"""Set applications/hired on each campaign from Job Applicants for linked job_opening."""
	if not frappe.db.exists("DocType", "HEC Hiring Campaign"):
		return {"updated": 0}
	if not frappe.db.exists("DocType", "Job Applicant"):
		return {"updated": 0, "reason": "no Job Applicant"}

	meta = frappe.get_meta("Job Applicant")
	has_stage = meta.has_field("hec_pipeline_stage")
	has_title = meta.has_field("job_title")
	campaigns = frappe.get_all(
		"HEC Hiring Campaign",
		fields=["name", "job_opening", "job_role_label", "campaign_name"],
		limit_page_length=500,
	)
	updated = 0
	for c in campaigns:
		opening = c.job_opening
		if not opening:
			opening = _match_job_opening(c.job_role_label, c.campaign_name)
			if opening:
				frappe.db.set_value("HEC Hiring Campaign", c.name, "job_opening", opening)

		filters = {}
		if opening and has_title:
			filters["job_title"] = opening
		elif c.job_role_label and has_title:
			# job_title on Job Applicant often stores Job Opening name, not label
			jo = frappe.db.exists("Job Opening", {"job_title": c.job_role_label})
			if jo:
				filters["job_title"] = jo
			else:
				continue
		else:
			continue

		apps = frappe.get_all(
			"Job Applicant",
			filters=filters,
			fields=["name", "hec_pipeline_stage"] if has_stage else ["name"],
			limit_page_length=5000,
		)
		hired = 0
		if has_stage:
			for a in apps:
				if (a.get("hec_pipeline_stage") or "") in ("Onboarding", "Offer"):
					# Count Onboarding as hired; Offer counted separately in KPIs
					pass
				if (a.get("hec_pipeline_stage") or "") == "Onboarding":
					hired += 1
		doc = frappe.get_doc("HEC Hiring Campaign", c.name)
		doc.applications = len(apps)
		doc.hired = hired
		# Recompute cpl/roi via validate
		doc.save(ignore_permissions=True)
		updated += 1

	frappe.db.commit()
	return {"updated": updated}


def _check_webhook_secret():
	expected = (get_hiring_ads_webhook_secret() or "").strip()
	if not expected:
		# Allow only when sync disabled (dev) — fail closed when sync is on
		if hiring_ads_sync_enabled():
			frappe.throw(_("Hiring ads webhook secret not configured"), frappe.AuthenticationError)
		return
	provided = (
		frappe.get_request_header("X-Hiring-Ads-Secret")
		or frappe.form_dict.get("webhook_secret")
		or ""
	).strip()
	if not provided or provided != expected:
		frappe.throw(_("Invalid hiring ads webhook secret"), frappe.AuthenticationError)


def _normalize_source(raw):
	if not raw:
		return "Others"
	key = str(raw).strip().lower().replace(" ", "").replace("_", "")
	for k, v in UTM_SOURCE_MAP.items():
		if k in key or key == k:
			return v
	# already a valid option
	opts = {"Facebook Ads", "Instagram Ads", "Google Ads", "LinkedIn Ads", "Career Website", "Others"}
	if raw in opts:
		return raw
	return "Others"


@frappe.whitelist(allow_guest=True)
def ingest_ad_lead(
	lead_name=None,
	email=None,
	phone=None,
	source=None,
	job_role=None,
	campaign_external_id=None,
	external_lead_id=None,
	job_opening=None,
	utm_source=None,
	notes=None,
	payload=None,
):
	"""Webhook for Meta/Google Lead Ads or career UTM apply mirror."""
	frappe.flags.ignore_csrf = True
	_check_webhook_secret()

	# Accept JSON body
	if payload and isinstance(payload, str):
		try:
			payload = json.loads(payload)
		except Exception:
			payload = {}
	if not isinstance(payload, dict):
		payload = {}

	# Meta leadgen often posts {entry:[{changes:[{value:{leadgen_id,...}}]}]}
	if payload.get("entry") and not lead_name:
		return _ingest_meta_leadgen_payload(payload)

	lead_name = _parse_request_value("lead_name", lead_name) or payload.get("lead_name") or payload.get("full_name") or payload.get("name")
	email = _parse_request_value("email", email) or payload.get("email")
	phone = _parse_request_value("phone", phone) or payload.get("phone") or payload.get("mobile")
	source = _parse_request_value("source", source) or payload.get("source") or _parse_request_value("utm_source", utm_source) or payload.get("utm_source")
	job_role = _parse_request_value("job_role", job_role) or payload.get("job_role") or payload.get("role")
	campaign_external_id = _parse_request_value("campaign_external_id", campaign_external_id) or payload.get(
		"campaign_external_id"
	) or payload.get("campaign_id")
	external_lead_id = _parse_request_value("external_lead_id", external_lead_id) or payload.get(
		"external_lead_id"
	) or payload.get("lead_id") or payload.get("id")
	job_opening = _parse_request_value("job_opening", job_opening) or payload.get("job_opening")
	notes = _parse_request_value("notes", notes) or payload.get("notes")

	if not lead_name:
		return _error(_("lead_name is required"))

	source = _normalize_source(source)
	return _success(_create_or_update_lead(
		lead_name=lead_name,
		email=email,
		phone=phone,
		source=source,
		job_role=job_role,
		campaign_external_id=campaign_external_id,
		external_lead_id=external_lead_id,
		job_opening=job_opening,
		notes=notes,
	))


def _ingest_meta_leadgen_payload(payload):
	"""Minimal Meta leadgen webhook ack + store lead ids for later fetch."""
	created = []
	for entry in payload.get("entry") or []:
		for change in entry.get("changes") or []:
			value = change.get("value") or {}
			lead_id = value.get("leadgen_id")
			if not lead_id:
				continue
			# Store placeholder; enrich via Graph API if token present
			detail = _fetch_meta_lead(lead_id) if meta_ads_configured() else {}
			field_data = {f.get("name"): f.get("values", [None])[0] for f in (detail.get("field_data") or [])}
			name = field_data.get("full_name") or field_data.get("first_name") or f"Lead {lead_id}"
			created.append(
				_create_or_update_lead(
					lead_name=name,
					email=field_data.get("email"),
					phone=field_data.get("phone_number") or field_data.get("phone"),
					source=PLATFORM_META_FB,
					job_role=field_data.get("job_title") or field_data.get("role"),
					campaign_external_id=str(value.get("campaign_id") or detail.get("campaign_id") or ""),
					external_lead_id=str(lead_id),
					notes="meta_leadgen",
				)
			)
	return _success({"leads": created, "count": len(created)})


def _fetch_meta_lead(lead_id):
	token = get_meta_access_token()
	if not token:
		return {}
	try:
		resp = requests.get(
			f"https://graph.facebook.com/v19.0/{lead_id}",
			params={"access_token": token, "fields": "created_time,field_data,campaign_id,ad_id"},
			timeout=30,
		)
		return resp.json() if resp.ok else {}
	except Exception:
		frappe.log_error(title="fetch_meta_lead")
		return {}


def _create_or_update_lead(
	*,
	lead_name,
	email=None,
	phone=None,
	source="Others",
	job_role=None,
	campaign_external_id=None,
	external_lead_id=None,
	job_opening=None,
	notes=None,
):
	if not frappe.db.exists("DocType", "HEC Hiring Lead"):
		frappe.throw(_("HEC Hiring Lead DocType missing"))

	doc = None
	if external_lead_id and frappe.db.exists("HEC Hiring Lead", {"external_lead_id": external_lead_id}):
		doc = frappe.get_doc("HEC Hiring Lead", {"external_lead_id": external_lead_id})
	else:
		doc = frappe.new_doc("HEC Hiring Lead")
		doc.lead_date = today()

	doc.lead_name = lead_name
	if email:
		doc.email = email
	if phone:
		doc.phone = phone
	doc.source = source or doc.source or "Others"
	if job_role:
		doc.job_role = job_role
	if external_lead_id:
		doc.external_lead_id = external_lead_id
	if notes:
		doc.notes = notes
	if job_opening:
		doc.job_opening = job_opening
	elif not doc.job_opening and job_role:
		doc.job_opening = _match_job_opening(job_role)

	if campaign_external_id:
		camp = frappe.db.exists("HEC Hiring Campaign", {"external_campaign_id": campaign_external_id})
		if camp:
			doc.campaign = camp
			if not doc.job_opening:
				doc.job_opening = frappe.db.get_value("HEC Hiring Campaign", camp, "job_opening")
			if not doc.job_role:
				doc.job_role = frappe.db.get_value("HEC Hiring Campaign", camp, "job_role_label")
	elif not doc.campaign and doc.job_role:
		camp = frappe.db.exists("HEC Hiring Campaign", {"job_role_label": doc.job_role})
		if camp:
			doc.campaign = camp

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"lead_id": doc.name, "external_lead_id": doc.external_lead_id, "status": doc.status}


@frappe.whitelist(allow_guest=True)
def import_campaigns_csv(csv_text=None):
	"""
	CSV columns (header required):
	campaign_name,platform,impressions,clicks,leads,spend[,external_campaign_id,job_role_label]
	"""
	frappe.flags.ignore_csrf = True
	_require_marketer()
	csv_text = _parse_request_value("csv_text", csv_text)
	if not csv_text and frappe.request and frappe.request.data:
		try:
			body = frappe.request.get_data(as_text=True)
			data = json.loads(body) if body.strip().startswith("{") else {}
			csv_text = data.get("csv_text") or csv_text
		except Exception:
			pass
	if not csv_text:
		return _error(_("csv_text is required"))

	reader = csv.DictReader(io.StringIO(csv_text))
	created = []
	for row in reader:
		name = (row.get("campaign_name") or "").strip()
		if not name:
			continue
		platform = _normalize_source(row.get("platform") or "Others")
		if platform == "Career Website":
			platform = "Others"
		if platform not in ("Facebook Ads", "Instagram Ads", "Google Ads", "LinkedIn Ads", "Others"):
			platform = "Others"
		docname = upsert_hiring_campaign(
			campaign_name=name,
			platform=platform,
			external_campaign_id=(row.get("external_campaign_id") or "").strip() or None,
			impressions=cint(row.get("impressions")),
			clicks=cint(row.get("clicks")),
			leads=cint(row.get("leads")),
			spend=flt(row.get("spend")),
			job_role_label=(row.get("job_role_label") or "").strip() or None,
			mark_from_ads=True,
		)
		created.append(docname)
	hr = refresh_campaign_hr_metrics()
	frappe.db.commit()
	return _success({"campaigns": created, "count": len(created), "hr_metrics": hr})


@frappe.whitelist(allow_guest=True)
def import_leads_csv(csv_text=None):
	"""CSV: lead_name,source,job_role,email,phone,external_lead_id,lead_date"""
	frappe.flags.ignore_csrf = True
	_require_marketer()
	csv_text = _parse_request_value("csv_text", csv_text)
	if not csv_text:
		return _error(_("csv_text is required"))
	reader = csv.DictReader(io.StringIO(csv_text))
	created = []
	for row in reader:
		name = (row.get("lead_name") or row.get("name") or "").strip()
		if not name:
			continue
		res = _create_or_update_lead(
			lead_name=name,
			email=(row.get("email") or "").strip() or None,
			phone=(row.get("phone") or "").strip() or None,
			source=_normalize_source(row.get("source") or row.get("utm_source")),
			job_role=(row.get("job_role") or "").strip() or None,
			external_lead_id=(row.get("external_lead_id") or "").strip() or None,
			notes="csv_import",
		)
		if row.get("lead_date") and res.get("lead_id"):
			frappe.db.set_value("HEC Hiring Lead", res["lead_id"], "lead_date", getdate(row["lead_date"]))
		created.append(res)
	frappe.db.commit()
	return _success({"leads": created, "count": len(created)})


def _mirror_applicant_as_lead(job_applicant, utm_source=None):
	"""Create HEC Hiring Lead from a Job Applicant (career apply with UTM)."""
	if not job_applicant or not frappe.db.exists("Job Applicant", job_applicant):
		return {"error": "invalid_applicant"}

	ja = frappe.get_doc("Job Applicant", job_applicant)
	source = _normalize_source(utm_source or getattr(ja, "hec_source", None) or "Career Website")
	ext = f"ja:{ja.name}"
	res = _create_or_update_lead(
		lead_name=ja.applicant_name or ja.name,
		email=getattr(ja, "email_id", None),
		phone=getattr(ja, "hec_mobile", None) or getattr(ja, "phone_number", None),
		source=source,
		job_role=None,
		job_opening=getattr(ja, "job_title", None),
		external_lead_id=ext,
		notes=f"mirrored from {ja.name}",
	)
	frappe.db.set_value("HEC Hiring Lead", res["lead_id"], "job_applicant", ja.name)
	frappe.db.commit()
	return res


@frappe.whitelist(allow_guest=True)
def mirror_applicant_as_lead(job_applicant=None, utm_source=None):
	frappe.flags.ignore_csrf = True
	_require_marketer()
	job_applicant = _parse_request_value("job_applicant", job_applicant)
	utm_source = _parse_request_value("utm_source", utm_source)
	res = _mirror_applicant_as_lead(job_applicant, utm_source=utm_source)
	if res.get("error"):
		return _error(_("Valid job_applicant required"))
	return _success(res)


@frappe.whitelist(allow_guest=True)
def hiring_ads_status():
	frappe.flags.ignore_csrf = True
	_require_marketer()
	synced = 0
	if frappe.db.exists("DocType", "HEC Hiring Campaign") and frappe.get_meta("HEC Hiring Campaign").has_field(
		"metrics_from_ads"
	):
		synced = frappe.db.count("HEC Hiring Campaign", {"metrics_from_ads": 1})
	return _success(
		{
			"sync_enabled": hiring_ads_sync_enabled(),
			"meta_configured": meta_ads_configured(),
			"google_configured": google_ads_configured(),
			"campaigns_from_ads": synced,
			"webhook": "health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync.ingest_ad_lead",
		}
	)


@frappe.whitelist(allow_guest=True)
def smoke_phase73f():
	frappe.flags.ignore_csrf = True
	setup = setup_phase73f()
	has_ext = False
	if frappe.db.exists("DocType", "HEC Hiring Campaign"):
		has_ext = frappe.get_meta("HEC Hiring Campaign").has_field("external_campaign_id")
	return _success(
		{
			"setup": setup,
			"campaign_external_id_field": has_ext,
			"lead_external_id_field": (
				frappe.get_meta("HEC Hiring Lead").has_field("external_lead_id")
				if frappe.db.exists("DocType", "HEC Hiring Lead")
				else False
			),
			"settings_hiring_ads": (
				frappe.get_meta("Health Ecosystem Settings").has_field("hiring_ads_sync_enabled")
				if frappe.db.exists("DocType", "Health Ecosystem Settings")
				else False
			),
			"meta_configured": meta_ads_configured(),
			"google_configured": google_ads_configured(),
		}
	)
