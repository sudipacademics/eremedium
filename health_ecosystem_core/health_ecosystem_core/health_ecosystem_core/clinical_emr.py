"""Shared EMR sink (ECOSYSTEM_ROADMAP.md section 6.2), created ahead of Module 4 (Patient IAM / EMR vault).

- EMR Record: one row per source document (unique on source_doctype + source_name). upsert_emr_record is idempotent:
  re-sending unchanged content is a no-op; changed content bumps `version` and is pushed again.
- Outbound push: every active HEC API Client holding the `emr:webhook` scope and a webhook_url gets a signed POST
  (X-Hec-Signature = hex HMAC-SHA256(api_secret, f"{timestamp}." + body), X-Hec-Timestamp, X-Hec-Event,
  X-Hec-Delivery). Each push is an EMR Webhook Delivery row; failures retry with backoff from a scheduler job.

Module 4 (clinical_phase136_emr) feeds it from authorized lab reports, Clinical Prescriptions, vitals, encounters and
patient uploads, and reads it through timeline_query for the patient vault.
Scheduler jobs run in worker containers, so imports stay limited to frappe, api helpers and phase 132.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, getdate, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success
from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	API_CLIENT_DT,
	PATIENT_DT,
	UPI_FIELD,
	_clean_scopes,
	_ensure_doctype,
	_perms,
	_sel,
	api_signature,
)

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_emr"
RETRY_JOB = f"{MODULE_PATH}.emr_retry_webhooks"
SCHEDULED_JOBS = ((RETRY_JOB, "*/5 * * * *"),)

EMR_DT = "EMR Record"
DELIVERY_DT = "EMR Webhook Delivery"

RECORD_TYPES = ("Lab Report", "Prescription", "Encounter", "Vital", "Imaging", "Discharge", "Vaccination", "Patient Upload")
SOURCE_APPS = ("Remedium Lab", "PhleboFirst", "Uber Doc", "Polyclinic", "Clinic", "Patient")
VISIBILITIES = ("Patient", "Shared")
DELIVERY_STATUSES = ("Pending", "Delivered", "Failed")
WEBHOOK_SCOPE = "emr:webhook"
EVENT_UPSERTED = "emr.record.upserted"
MAX_ATTEMPTS = 6
BACKOFF_MINUTES = (1, 5, 15, 60, 240, 720)
TIMEOUT_SECONDS = 10
URL_RE = re.compile(r"^https://[^\s/$.?#][^\s]*$", re.I)
DEV_URL_RE = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?(/[^\s]*)?$", re.I)
MANAGE_ROLES = frozenset({"System Manager", "Health System Admin", "Administrator", "Uber Doc Manager"})


def _fail(message):
	raise frappe.ValidationError(message)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	return [
		(
			EMR_DT,
			[
				{"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1},
				{"fieldname": "patient_name", "label": "Patient Name", "fieldtype": "Data", "read_only": 1, "in_list_view": 1},
				{"fieldname": UPI_FIELD, "label": "Universal Patient ID", "fieldtype": "Data", "read_only": 1, "search_index": 1, "in_standard_filter": 1},
				{"fieldname": "record_type", "label": "Record Type", "fieldtype": "Select", "options": _sel(RECORD_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "source_app", "label": "Source App", "fieldtype": "Select", "options": _sel(SOURCE_APPS), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType", "reqd": 1, "read_only": 1},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Dynamic Link", "options": "source_doctype", "reqd": 1, "read_only": 1, "search_index": 1},
				{"fieldname": "source_key", "label": "Source Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "record_date", "label": "Record Date", "fieldtype": "Date", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "visibility", "label": "Visibility", "fieldtype": "Select", "options": _sel(VISIBILITIES), "default": "Patient"},
				{"fieldname": "summary_json", "label": "Summary", "fieldtype": "Code", "options": "JSON", "read_only": 1},
				{"fieldname": "file", "label": "File", "fieldtype": "Attach", "read_only": 1},
				{"fieldname": "content_hash", "label": "Content Hash", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "version", "label": "Version", "fieldtype": "Int", "default": "1", "read_only": 1},
				{"fieldname": "created", "label": "Created", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "updated_on", "label": "Updated On", "fieldtype": "Datetime", "read_only": 1},
			],
			_perms(managers, (), delete=0),
			"EMR-.YYYY.-.######",
			{"title_field": "title", "sort_field": "creation", "sort_order": "DESC", "search_fields": f"{UPI_FIELD},source_name"},
		),
		(
			DELIVERY_DT,
			[
				{"fieldname": "emr_record", "label": "EMR Record", "fieldtype": "Link", "options": EMR_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "record_version", "label": "Record Version", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "api_client", "label": "API Client", "fieldtype": "Link", "options": API_CLIENT_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "event", "label": "Event", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "webhook_url", "label": "Webhook URL", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(DELIVERY_STATUSES), "default": "Pending", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "attempts", "label": "Attempts", "fieldtype": "Int", "default": "0", "read_only": 1, "in_list_view": 1},
				{"fieldname": "next_attempt_at", "label": "Next Attempt", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "last_attempt_at", "label": "Last Attempt", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "last_status_code", "label": "Last HTTP Status", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "last_error", "label": "Last Error", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "delivered_at", "label": "Delivered At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "delivery_key", "label": "Delivery Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "payload_json", "label": "Payload", "fieldtype": "Code", "options": "JSON", "read_only": 1},
			],
			_perms(managers, (), delete=0),
			"EMRW-.YYYY.-.######",
			{"sort_field": "creation", "sort_order": "DESC"},
		),
	]


def _ensure_client_fields():
	if not frappe.db.exists("DocType", API_CLIENT_DT):
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			API_CLIENT_DT: [
				{
					"fieldname": "webhook_url",
					"label": "Webhook URL (EMR push)",
					"fieldtype": "Data",
					"insert_after": "scopes",
					"description": "HTTPS endpoint that receives signed EMR record pushes when the client holds the emr:webhook scope.",
				}
			]
		},
		update=True,
	)


def ensure_emr_setup():
	_ensure_client_fields()
	created = []
	for name, fields, perms, autoname, extra in _doctype_specs():
		if _ensure_doctype(name, fields, perms, autoname=autoname, extra=extra):
			created.append(name)
	return created


def _ensure_ready():
	client_ready = not frappe.db.exists("DocType", API_CLIENT_DT) or frappe.get_meta(API_CLIENT_DT).has_field("webhook_url")
	if not frappe.db.exists("DocType", DELIVERY_DT) or not client_ready:
		ensure_emr_setup()
		frappe.db.commit()


def ensure_scheduler_jobs():
	cron = (frappe.get_hooks("scheduler_events") or {}).get("cron") or {}
	out = {}
	for method, expr in SCHEDULED_JOBS:
		key = method.rsplit(".", 1)[-1]
		if method not in (cron.get(expr) or []):
			out[key] = "not in hooks"
		elif frappe.db.exists("Scheduled Job Type", {"method": method}):
			out[key] = "present"
		else:
			frappe.get_doc({"doctype": "Scheduled Job Type", "method": method, "frequency": "Cron", "cron_format": expr}).insert(ignore_permissions=True)
			out[key] = "created"
	return out


def setup_emr():
	"""Idempotent: EMR Record + EMR Webhook Delivery DocTypes, HEC API Client.webhook_url, retry job."""
	created = ensure_emr_setup()
	frappe.db.commit()
	out = {"ok": True, "created": created, "scheduler_jobs": ensure_scheduler_jobs(), "webhook_clients": len(webhook_clients())}
	frappe.db.commit()
	return out


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


def canonical_json(value):
	return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _file_digest(file_url):
	if not file_url:
		return ""
	try:
		content = frappe.get_doc("File", {"file_url": file_url}).get_content()
		if isinstance(content, str):
			content = content.encode()
		return hashlib.sha256(content or b"").hexdigest()
	except Exception:
		return f"url:{file_url}"


def content_hash(summary, file_url=None, title=None, record_date=None, record_type=None):
	basis = canonical_json({"summary": summary, "file": _file_digest(file_url), "title": title, "date": cstr(record_date), "type": record_type})
	return hashlib.sha256(basis.encode()).hexdigest()


def source_key(source_doctype, source_name):
	return f"{source_doctype}::{source_name}"


def upsert_emr_record(
	source_doctype,
	source_name,
	record_type,
	source_app,
	patient=None,
	universal_patient_id=None,
	title=None,
	record_date=None,
	summary=None,
	file_url=None,
	visibility="Patient",
	push=True,
):
	"""Idempotent on (source_doctype, source_name). Returns {name, created, changed, version, deliveries}."""
	_ensure_ready()
	if record_type not in RECORD_TYPES:
		_fail(_("Invalid EMR record type {0}").format(record_type))
	if source_app not in SOURCE_APPS:
		_fail(_("Invalid EMR source app {0}").format(source_app))
	if not source_doctype or not source_name:
		_fail(_("EMR source document is required"))
	if patient and not frappe.db.exists(PATIENT_DT, patient):
		_fail(_("Patient {0} not found").format(patient))
	if patient and not universal_patient_id:
		universal_patient_id = frappe.db.get_value(PATIENT_DT, patient, UPI_FIELD)
	if not patient and not universal_patient_id:
		_fail(_("An EMR record needs a patient or a Universal Patient ID"))
	summary = summary if summary is not None else {}
	digest = content_hash(summary, file_url, title, record_date, record_type)
	key = source_key(source_doctype, source_name)
	now = now_datetime()
	values = {
		"patient": patient or None,
		"patient_name": frappe.db.get_value(PATIENT_DT, patient, "patient_name") if patient else None,
		UPI_FIELD: universal_patient_id or None,
		"record_type": record_type,
		"source_app": source_app,
		"title": cstr(title)[:140] or None,
		"record_date": getdate(record_date) if record_date else getdate(now),
		"visibility": visibility if visibility in VISIBILITIES else "Patient",
		"summary_json": canonical_json(summary),
		"file": file_url or None,
		"content_hash": digest,
	}
	existing = frappe.db.sql(f"select name, content_hash, version from `tab{EMR_DT}` where source_key = %s for update", (key,), as_dict=True)
	if existing:
		row = existing[0]
		if row.content_hash == digest:
			return {"name": row.name, "created": False, "changed": False, "version": cint(row.version), "deliveries": []}
		version = cint(row.version) + 1
		frappe.db.set_value(EMR_DT, row.name, {**values, "version": version, "updated_on": now})
		name, created = row.name, False
	else:
		doc = frappe.get_doc(
			{
				"doctype": EMR_DT,
				**values,
				"source_doctype": source_doctype,
				"source_name": source_name,
				"source_key": key,
				"version": 1,
				"created": now,
				"updated_on": now,
			}
		)
		try:
			doc.insert(ignore_permissions=True)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			return upsert_emr_record(
				source_doctype, source_name, record_type, source_app, patient, universal_patient_id, title, record_date, summary, file_url, visibility, push
			)
		name, created, version = doc.name, True, 1
	deliveries = enqueue_webhooks(name) if push else []
	return {"name": name, "created": created, "changed": True, "version": version, "deliveries": deliveries}


def record_payload(name):
	row = frappe.db.get_value(
		EMR_DT,
		name,
		["name", "patient", UPI_FIELD, "record_type", "source_app", "source_doctype", "source_name", "title", "record_date", "visibility", "summary_json", "file", "content_hash", "version", "created", "updated_on"],
		as_dict=True,
	)
	if not row:
		return None
	try:
		summary = json.loads(row.summary_json or "{}")
	except ValueError:
		summary = {}
	return {
		"name": row.name,
		"patient": row.patient,
		"universal_patient_id": row.get(UPI_FIELD),
		"record_type": row.record_type,
		"source_app": row.source_app,
		"source_doctype": row.source_doctype,
		"source_name": row.source_name,
		"title": row.title,
		"record_date": cstr(row.record_date) or None,
		"visibility": row.visibility,
		"summary": summary,
		"has_file": bool(row.file),
		"content_hash": row.content_hash,
		"version": cint(row.version),
		"created": cstr(row.created) or None,
		"updated_on": cstr(row.updated_on) or None,
	}


# ---------------------------------------------------------------------------
# Outbound webhooks
# ---------------------------------------------------------------------------


def webhook_url_ok(url):
	url = cstr(url).strip()
	return bool(URL_RE.match(url) or DEV_URL_RE.match(url))


def webhook_clients():
	if not frappe.db.exists("DocType", API_CLIENT_DT) or not frappe.get_meta(API_CLIENT_DT).has_field("webhook_url"):
		return []
	rows = frappe.get_all(API_CLIENT_DT, filters={"active": 1}, fields=["name", "client_name", "scopes", "webhook_url"], limit=0)
	out = []
	for row in rows:
		try:
			scopes = _clean_scopes(row.scopes)
		except frappe.ValidationError:
			continue
		if WEBHOOK_SCOPE in scopes and webhook_url_ok(row.webhook_url):
			out.append(row)
	return out


def enqueue_webhooks(record_name):
	"""One Pending delivery per webhook client for the record's current version; sent after commit."""
	payload = record_payload(record_name)
	if not payload:
		return []
	created = []
	for client in webhook_clients():
		key = f"{record_name}:{payload['version']}:{client.name}"
		if frappe.db.exists(DELIVERY_DT, {"delivery_key": key}):
			continue
		doc = frappe.get_doc(
			{
				"doctype": DELIVERY_DT,
				"emr_record": record_name,
				"record_version": payload["version"],
				"api_client": client.name,
				"event": EVENT_UPSERTED,
				"webhook_url": cstr(client.webhook_url).strip(),
				"status": "Pending",
				"attempts": 0,
				"next_attempt_at": now_datetime(),
				"delivery_key": key,
			}
		)
		doc.insert(ignore_permissions=True)
		body = canonical_json({"event": EVENT_UPSERTED, "delivery_id": doc.name, "record": payload})
		frappe.db.set_value(DELIVERY_DT, doc.name, "payload_json", body, update_modified=False)
		created.append(doc.name)
		if not frappe.flags.emr_no_dispatch:
			try:
				frappe.enqueue(f"{MODULE_PATH}.emr_deliver_job", queue="short", enqueue_after_commit=True, delivery=doc.name)
			except Exception:
				frappe.log_error(title="EMR webhook enqueue", message=frappe.get_traceback())
	return created


def client_secret(client_name):
	from frappe.utils.password import get_decrypted_password

	return get_decrypted_password(API_CLIENT_DT, client_name, "api_secret", raise_exception=False)


def signed_headers(secret, body, event, delivery, timestamp=None):
	ts = cint(timestamp) or int(time.time())
	return {
		"Content-Type": "application/json",
		"User-Agent": "Remedium-HEC-EMR/1",
		"X-Hec-Event": event,
		"X-Hec-Delivery": delivery,
		"X-Hec-Timestamp": str(ts),
		"X-Hec-Signature": api_signature(secret, ts, body.encode() if isinstance(body, str) else body),
	}


def verify_webhook_signature(secret, timestamp, body, signature):
	"""Receiver-side check (also used by the smoke): same scheme as phase 132 api_signature."""
	import hmac

	return hmac.compare_digest(api_signature(secret, cint(timestamp), body.encode() if isinstance(body, str) else body), cstr(signature).strip().lower())


def _post(url, body, headers):
	req = Request(url, data=body.encode("utf-8"), headers=headers, method="POST")
	try:
		with urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
			return resp.status, ""
	except HTTPError as exc:
		try:
			detail = exc.read()[:300].decode("utf-8", errors="replace")
		except Exception:
			detail = cstr(exc)
		return exc.code, f"HTTP {exc.code}: {detail}"
	except (URLError, TimeoutError, OSError) as exc:
		return 0, cstr(exc)[:300]


def deliver(delivery_name, sender=None):
	"""Send one delivery now. `sender(url, body, headers) -> (status, error)` is injectable for the smoke."""
	rows = frappe.db.sql(f"select name from `tab{DELIVERY_DT}` where name = %s for update", (delivery_name,))
	if not rows:
		return {"status": "missing"}
	doc = frappe.get_doc(DELIVERY_DT, delivery_name)
	if doc.status != "Pending":
		return {"status": doc.status}
	secret = client_secret(doc.api_client)
	active = cint(frappe.db.get_value(API_CLIENT_DT, doc.api_client, "active"))
	now = now_datetime()
	attempts = cint(doc.attempts) + 1
	if not secret or not active:
		code, err = 0, "API client inactive or its secret is unavailable"
	else:
		code, err = (sender or _post)(doc.webhook_url, doc.payload_json, signed_headers(secret, doc.payload_json, doc.event, doc.name))
	values = {"attempts": attempts, "last_attempt_at": now, "last_status_code": cint(code), "last_error": cstr(err)[:1000] or None}
	if 200 <= cint(code) < 300:
		values.update({"status": "Delivered", "delivered_at": now, "next_attempt_at": None, "last_error": None})
	elif attempts >= MAX_ATTEMPTS:
		values.update({"status": "Failed", "next_attempt_at": None})
	else:
		values["next_attempt_at"] = add_to_date(now, minutes=BACKOFF_MINUTES[min(attempts - 1, len(BACKOFF_MINUTES) - 1)])
	frappe.db.set_value(DELIVERY_DT, doc.name, values)
	return {"status": values.get("status", "Pending"), "code": cint(code), "attempts": attempts}


def emr_deliver_job(delivery=None):
	try:
		deliver(delivery)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="EMR webhook delivery", message=f"{delivery}\n{frappe.get_traceback()}")


def emr_retry_webhooks(limit=100):
	"""Every 5 minutes: Pending deliveries whose next attempt is due."""
	if not frappe.db.exists("DocType", DELIVERY_DT):
		return {"skipped": "not installed"}
	names = frappe.get_all(
		DELIVERY_DT,
		filters={"status": "Pending", "next_attempt_at": ("<=", now_datetime())},
		pluck="name",
		order_by="next_attempt_at asc",
		limit=cint(limit) or 100,
	)
	report = {"due": len(names), "delivered": 0, "failed": 0, "errors": 0}
	for name in names:
		try:
			res = deliver(name)
			frappe.db.commit()
			if res.get("status") == "Delivered":
				report["delivered"] += 1
			elif res.get("status") == "Failed":
				report["failed"] += 1
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="EMR webhook retry", message=f"{name}\n{frappe.get_traceback()}")
	return report


def delivery_row(row):
	return {
		"name": row.name,
		"emr_record": row.emr_record,
		"record_version": cint(row.record_version),
		"api_client": row.api_client,
		"client_name": frappe.db.get_value(API_CLIENT_DT, row.api_client, "client_name"),
		"event": row.event,
		"webhook_url": row.webhook_url,
		"status": row.status,
		"attempts": cint(row.attempts),
		"next_attempt_at": cstr(row.next_attempt_at) or None,
		"last_attempt_at": cstr(row.last_attempt_at) or None,
		"last_status_code": cint(row.last_status_code) or None,
		"last_error": row.last_error,
		"delivered_at": cstr(row.delivered_at) or None,
		"creation": cstr(row.creation),
	}


def list_deliveries(status=None, limit=200):
	filters = {"status": status} if status in DELIVERY_STATUSES else {}
	rows = frappe.get_all(
		DELIVERY_DT,
		filters=filters,
		fields=["name", "emr_record", "record_version", "api_client", "event", "webhook_url", "status", "attempts", "next_attempt_at", "last_attempt_at", "last_status_code", "last_error", "delivered_at", "creation"],
		order_by="creation desc",
		limit=min(cint(limit) or 200, 500),
	)
	counts = {s: frappe.db.count(DELIVERY_DT, {"status": s}) for s in DELIVERY_STATUSES}
	return {"rows": [delivery_row(r) for r in rows], "counts": counts, "clients": [{"name": c.name, "client_name": c.client_name, "webhook_url": c.webhook_url} for c in webhook_clients()]}


def retry_delivery(name):
	if not frappe.db.exists(DELIVERY_DT, name):
		raise frappe.DoesNotExistError(_("Delivery {0} not found").format(name))
	frappe.db.set_value(DELIVERY_DT, name, {"status": "Pending", "next_attempt_at": now_datetime(), "attempts": 0})
	frappe.enqueue(f"{MODULE_PATH}.emr_deliver_job", queue="short", enqueue_after_commit=True, delivery=name)
	return delivery_row(frappe.get_doc(DELIVERY_DT, name))


def patient_records(patients, record_type=None, limit=100):
	if not patients:
		return []
	filters = {"patient": ("in", list(patients))}
	if record_type in RECORD_TYPES:
		filters["record_type"] = record_type
	names = frappe.get_all(EMR_DT, filters=filters, pluck="name", order_by="record_date desc, creation desc", limit=min(cint(limit) or 100, 300))
	return [record_payload(n) for n in names]


def timeline_query(patients, record_types=None, source_apps=None, date_from=None, date_to=None, page=1, page_size=30):
	"""Newest first; returns (names, total). Callers pass only patients the viewer may see."""
	if not patients:
		return [], 0
	filters = {"patient": ("in", list(patients))}
	types = [t for t in (record_types or []) if t in RECORD_TYPES]
	apps = [a for a in (source_apps or []) if a in SOURCE_APPS]
	if types:
		filters["record_type"] = ("in", types)
	if apps:
		filters["source_app"] = ("in", apps)
	if date_from and date_to:
		filters["record_date"] = ("between", [getdate(date_from), getdate(date_to)])
	elif date_from:
		filters["record_date"] = (">=", getdate(date_from))
	elif date_to:
		filters["record_date"] = ("<=", getdate(date_to))
	size = min(max(cint(page_size) or 30, 1), 100)
	page = max(cint(page) or 1, 1)
	names = frappe.get_all(EMR_DT, filters=filters, pluck="name", order_by="record_date desc, creation desc", limit_start=(page - 1) * size, limit_page_length=size)
	return names, frappe.db.count(EMR_DT, filters)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _call(sid, manage, fn, commit=False, message="OK"):
	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	roles = set(frappe.get_roles(frappe.session.user))
	if manage and not roles & MANAGE_ROLES:
		return _error(_("Operations access required"), 403)
	try:
		_ensure_ready()
		data = fn()
		if commit:
			frappe.db.commit()
		return _success(data, message=message)
	except frappe.PermissionError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not permitted"), 403)
	except frappe.DoesNotExistError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Not found"), 404)
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return _error(cstr(exc) or _("Invalid request"))


@frappe.whitelist(allow_guest=True)
def emr_deliveries(status=None, limit=200, sid=None):
	return _call(sid, True, lambda: list_deliveries(status, limit))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def emr_delivery_retry(name=None, sid=None):
	return _call(sid, True, lambda: retry_delivery(name), commit=True, message=_("Queued"))


@frappe.whitelist(allow_guest=True)
def emr_my_records(record_type=None, limit=100, sid=None):
	"""Records of the signed-in user's own and linked family profiles (Module 4 builds the full timeline)."""

	def run():
		from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import list_profiles

		patients = [p["patient"] for p in list_profiles(frappe.session.user)]
		return {"records": patient_records(patients, record_type, limit)}

	return _call(sid, False, run)

