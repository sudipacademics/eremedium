"""Phase 133 — Universal Barcode Converter API for participating labs.

Partner labs translate PhleboFirst universal barcodes (PF-0000123<c>) into their own LIS barcodes and push sample events
back. Authentication is the phase 132 HEC API Client signature (X-Api-Key, X-Api-Timestamp, X-Api-Signature =
hex HMAC-SHA256(secret, f"{timestamp}." + raw body)); for GET requests the raw query string is signed instead of the body.
A client only sees barcodes bound to TRFs of its linked lab. Public URLs (nginx rewrites):
/api/v1/barcode/convert and /api/v1/barcode/webhook. See docs/PHLEBOFIRST_CONVERTER_API.md.
"""

from __future__ import annotations

import json
import re
import time

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, now_datetime

from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import (
	API_CLIENT_DT,
	api_signature,
	verify_api_signature,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst import (
	HOOK_DT,
	JOB_DT,
	MAP_DT,
	REQ_DT,
	SETTINGS_DT,
	TRF_DT,
	UB_DT,
	check_code,
	is_pf_code,
	lab_settings,
)

CONVERTER_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase133_pf_converter"
SCOPE_CONVERT = "barcode:convert"
SCOPE_WEBHOOK = "barcode:webhook"
LIS_CODE_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,64}$")
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{6,100}$")
TOKEN_RE = re.compile(r"\{(prefix|seq(?::(\d{1,2}))?|yyyy|yy|mm|dd|tube)\}")
INBOUND_EVENTS = ("mapping.bind", "sample.received", "sample.rejected", "result.ready")
OUTBOUND_BACKOFF_MIN = (1, 2, 5, 15, 30, 60)
OUTBOUND_MAX_ATTEMPTS = len(OUTBOUND_BACKOFF_MIN)
OUTBOUND_TIMEOUT_S = 10


class ApiError(Exception):
	def __init__(self, code, message, http=400):
		super().__init__(message)
		self.code = code
		self.message = message
		self.http = http


def _api_error(exc):
	frappe.local.response["http_status_code"] = exc.http
	return {"status": "error", "message": exc.message, "data": {"error": exc.code}}


def _api(fn, commit=False, on_error=None):
	try:
		data = fn()
		if commit:
			frappe.db.commit()
		return {"status": "success", "message": "OK", "data": data}
	except ApiError as exc:
		frappe.db.rollback()
		if on_error:
			on_error(exc)
		return _api_error(exc)
	except frappe.DoesNotExistError as exc:
		frappe.db.rollback()
		return _api_error(ApiError("not_found", cstr(exc) or "Not found", 404))
	except (frappe.ValidationError, frappe.PermissionError) as exc:
		frappe.db.rollback()
		return _api_error(ApiError("invalid_request", cstr(exc) or "Invalid request", 400))
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase133 converter", message=frappe.get_traceback())
		return _api_error(ApiError("internal_error", "Internal error; retry later", 500))


def authenticate(scope, api_key=None, signature=None, timestamp=None, body=None):
	"""Explicit arguments (smoke / internal) or the current request's headers. Returns the API client row."""
	if api_key is None:
		api_key = frappe.get_request_header("X-Api-Key")
		signature = frappe.get_request_header("X-Api-Signature")
		timestamp = frappe.get_request_header("X-Api-Timestamp")
		request = getattr(frappe.local, "request", None)
		if request is not None:
			body = request.query_string if request.method == "GET" else request.get_data()
	try:
		client = verify_api_signature(api_key, signature, timestamp, body or b"", required_scope=scope)
	except frappe.AuthenticationError as exc:
		raise ApiError("unauthorized", cstr(exc) or "Unauthorized", 401)
	except frappe.PermissionError as exc:
		raise ApiError("forbidden", cstr(exc) or "Forbidden", 403)
	if not client.get("linked_lab"):
		raise ApiError("forbidden", "This API key is not linked to a lab", 403)
	return client


# ---------------------------------------------------------------------------
# LIS barcode formats + mappings
# ---------------------------------------------------------------------------


def render_lis_format(fmt, prefix, seq, tube=None):
	"""Tokens: {prefix} {seq} {seq:8} {yyyy} {yy} {mm} {dd} {tube}; must contain {seq}."""
	fmt = cstr(fmt).strip()
	if not fmt or "{seq" not in fmt:
		frappe.throw(_("The LIS barcode format must contain {seq}"), frappe.ValidationError)
	now = now_datetime()
	fixed = {
		"prefix": cstr(prefix).strip(),
		"yyyy": now.strftime("%Y"),
		"yy": now.strftime("%y"),
		"mm": now.strftime("%m"),
		"dd": now.strftime("%d"),
		"tube": cstr(tube).strip(),
	}

	def sub(match):
		token = match.group(1)
		if token.startswith("seq"):
			return str(cint(seq)).zfill(cint(match.group(2)) or 0)
		return fixed[token]

	value = TOKEN_RE.sub(sub, fmt)
	if "{" in value or "}" in value or not LIS_CODE_RE.match(value):
		frappe.throw(_("The LIS barcode format produces an invalid barcode: {0}").format(value[:64]), frappe.ValidationError)
	return value


def _mapping(universal=None, lab=None, lis_barcode=None):
	if universal:
		key = {"universal_lab_key": f"{universal}::{lab}"}
	else:
		key = {"lab_lis_key": f"{lab}::{lis_barcode}"}
	return frappe.db.get_value(MAP_DT, key, ["name", "universal_barcode", "lab", "lis_barcode", "source", "lis_format"], as_dict=True)


def bind_mapping(universal, lab, lis_barcode, source="API", client=None, fmt=None):
	"""Idempotent for the same pair; 409 when either side is already mapped to something else."""
	lis = cstr(lis_barcode).strip()
	if not LIS_CODE_RE.match(lis):
		raise ApiError("invalid_lis_barcode", "LIS barcode must be 1-64 characters of A-Z a-z 0-9 . _ : / -")
	if is_pf_code(lis):
		raise ApiError("invalid_lis_barcode", "A universal PF- code cannot be used as the LIS barcode")
	existing = _mapping(universal=universal, lab=lab)
	if existing:
		if existing.lis_barcode == lis:
			return existing
		raise ApiError("conflict", f"{universal} is already mapped to {existing.lis_barcode} for this lab", 409)
	clash = _mapping(lab=lab, lis_barcode=lis)
	if clash:
		raise ApiError("conflict", f"LIS barcode {lis} is already mapped to {clash.universal_barcode}", 409)
	doc = frappe.get_doc(
		{
			"doctype": MAP_DT,
			"universal_barcode": universal,
			"lab": lab,
			"lis_barcode": lis,
			"lis_format": cstr(fmt)[:140] or None,
			"source": source,
			"api_client": (client or {}).get("name"),
			"created_by": frappe.session.user,
			"universal_lab_key": f"{universal}::{lab}",
			"lab_lis_key": f"{lab}::{lis}",
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		raise ApiError("conflict", "This mapping was created concurrently; retry", 409)
	return _mapping(universal=universal, lab=lab)


def _auto_lis(lab, universal, tube):
	settings = lab_settings(lab)
	fmt = cstr(settings.lis_barcode_format).strip() if settings else ""
	if not fmt:
		return None, None
	for _attempt in range(10):
		frappe.db.sql(f"update `tab{SETTINGS_DT}` set lis_next_seq = greatest(ifnull(lis_next_seq, 0), 1) + 1 where name = %s", (lab,))
		seq = cint(frappe.db.get_value(SETTINGS_DT, lab, "lis_next_seq")) - 1
		value = render_lis_format(fmt, settings.lis_prefix, seq, tube)
		if not _mapping(lab=lab, lis_barcode=value):
			return value, fmt
	raise ApiError("conflict", "Could not allocate a free LIS barcode; check the format", 409)


def _scoped_barcode(universal, lab):
	row = frappe.db.get_value(UB_DT, universal, ["name", "status", "lab", "tube_code", "bound_trf", "bound_tube_row"], as_dict=True)
	if not row or row.lab != lab or not row.bound_trf:
		raise ApiError("not_found", f"{universal} is not a sample for this lab", 404)
	return row


def _universal_arg(value):
	code, err = check_code(value, "PF")
	if err:
		raise ApiError("invalid_universal", err)
	return code


def barcode_payload(universal, lab):
	bc = frappe.get_doc(UB_DT, universal)
	trf = frappe.get_doc(TRF_DT, bc.bound_trf)
	from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

	tube = frappe.db.get_value("HEC Collection Tube", bc.tube_code, ["cap_color", "specimen_class", "additive"], as_dict=True) or {}
	row = next((r for r in trf.get("collection_tubes") or [] if r.name == bc.bound_tube_row), None)
	job = frappe.db.get_value(JOB_DT, bc.bound_job, ["collected_on", "dropped_on"], as_dict=True) if bc.bound_job else None
	linked = {t.strip().lower() for t in cstr(row.linked_tests if row else "").split(",") if t.strip()}
	lines = [{"code": line["item_code"], "name": line["item_name"]} for line in get_trf_test_lines(trf)]
	tests = [t for t in lines if cstr(t["name"]).strip().lower() in linked or cstr(t["code"]).strip().lower() in linked] or lines
	return {
		"universal": bc.name,
		"status": bc.status,
		"lab": lab,
		"tube": {"code": bc.tube_code, "cap_color": tube.get("cap_color"), "specimen": tube.get("specimen_class"), "additive": tube.get("additive")},
		"trf_id": trf.name,
		"trf_barcode": trf.unique_barcode,
		"accession_id": bc.bound_accession,
		"tests": tests,
		"patient": {
			"name": trf.patient_name,
			"age": cint(trf.age),
			"gender": trf.gender,
			"upi": trf.get("universal_patient_id"),
		},
		"collected_on": cstr(job.collected_on) if job and job.collected_on else None,
		"dropped_on": cstr(bc.dropped_on) if bc.dropped_on else None,
		"drop_hub": bc.drop_hub,
		"received_on": cstr(bc.received_on) if bc.received_on else None,
	}


def convert_core(client, universal=None, lis_barcode=None):
	lab = client["linked_lab"]
	lis_barcode = cstr(lis_barcode).strip() or None
	if universal:
		code = _universal_arg(universal)
		bc = _scoped_barcode(code, lab)
		mapping = _mapping(universal=code, lab=lab)
		created = False
		if not mapping:
			if lis_barcode:
				mapping = bind_mapping(code, lab, lis_barcode, "API", client)
			else:
				value, fmt = _auto_lis(lab, code, bc.tube_code)
				if not value:
					raise ApiError("no_mapping", "No LIS barcode is mapped yet; send lis_barcode to bind one", 404)
				mapping = bind_mapping(code, lab, value, "Auto", client, fmt)
			created = True
		elif lis_barcode and lis_barcode != mapping.lis_barcode:
			raise ApiError("conflict", f"{code} is already mapped to {mapping.lis_barcode} for this lab", 409)
		return {**barcode_payload(code, lab), "lis_barcode": mapping.lis_barcode, "mapping_source": mapping.source, "created": created}
	if lis_barcode:
		mapping = _mapping(lab=lab, lis_barcode=lis_barcode)
		if not mapping:
			raise ApiError("not_found", f"LIS barcode {lis_barcode} is not mapped for this lab", 404)
		_scoped_barcode(mapping.universal_barcode, lab)
		return {**barcode_payload(mapping.universal_barcode, lab), "lis_barcode": mapping.lis_barcode, "mapping_source": mapping.source, "created": False}
	raise ApiError("bad_request", "Send universal or lis_barcode")


# ---------------------------------------------------------------------------
# Inbound webhook
# ---------------------------------------------------------------------------


def _event_barcode(lab, data):
	if data.get("universal"):
		return _scoped_barcode(_universal_arg(data.get("universal")), lab)
	lis = cstr(data.get("lis_barcode")).strip()
	if lis:
		mapping = _mapping(lab=lab, lis_barcode=lis)
		if not mapping:
			raise ApiError("not_found", f"LIS barcode {lis} is not mapped for this lab", 404)
		return _scoped_barcode(mapping.universal_barcode, lab)
	raise ApiError("bad_request", "data.universal or data.lis_barcode is required")


def _accession_of(bc):
	accession = frappe.db.get_value("TRF Collection Tube", bc.bound_tube_row, "accession_id") if bc.bound_tube_row else None
	if not accession:
		raise ApiError("invalid_state", f"{bc.name} has no tube on its TRF", 409)
	return accession


def _handle(client, event, data):
	lab = client["linked_lab"]
	if event == "mapping.bind":
		code = _universal_arg(data.get("universal"))
		_scoped_barcode(code, lab)
		mapping = bind_mapping(code, lab, data.get("lis_barcode"), "API", client)
		return {"universal": code, "lis_barcode": mapping.lis_barcode, "result": "bound"}
	bc = _event_barcode(lab, data)
	from health_ecosystem_core.health_ecosystem_core import clinical_phase89_vial_accession as accession_mod

	if event == "sample.received":
		if bc.status == "Received":
			return {"universal": bc.name, "result": "already_received"}
		if bc.status not in ("Bound", "Dropped"):
			raise ApiError("invalid_state", f"{bc.name} is {bc.status}", 409)
		accession_mod.receive_trf_tube(trf_id=bc.bound_trf, accession_id=_accession_of(bc))
		return {"universal": bc.name, "result": "received", "status": frappe.db.get_value(UB_DT, bc.name, "status"), "received_at": cstr(data.get("received_at") or "")[:40] or None}
	if event == "sample.rejected":
		reason = cstr(data.get("reason")).strip()
		if len(reason) < 3:
			raise ApiError("bad_request", "data.reason is required")
		if bc.status == "Rejected":
			return {"universal": bc.name, "result": "already_rejected"}
		accession_mod.reject_trf_tube(trf_id=bc.bound_trf, accession_id=_accession_of(bc), reason=reason[:140])
		return {"universal": bc.name, "result": "rejected", "status": frappe.db.get_value(UB_DT, bc.name, "status")}
	request = frappe.db.get_value(UB_DT, bc.name, "bound_request")
	if request:
		frappe.db.set_value(REQ_DT, request, "result_ready_on", now_datetime(), update_modified=False)
	return {"universal": bc.name, "result": "noted"}


def _inbound_key(client, event_id):
	return f"in::{client['name']}::{event_id}"


def _save_inbound(client, event_id, event, payload, status, response=None, error=None):
	key = _inbound_key(client, event_id)
	values = {
		"status": status,
		"response_json": json.dumps(response, default=str) if response is not None else None,
		"last_error": cstr(error)[:1000] or None,
	}
	name = frappe.db.get_value(HOOK_DT, {"idem_key": key}, "name")
	if name:
		frappe.db.set_value(HOOK_DT, name, {**values, "attempts": cint(frappe.db.get_value(HOOK_DT, name, "attempts")) + 1})
		return name
	data = payload.get("data") if isinstance(payload, dict) else {}
	doc = frappe.get_doc(
		{
			"doctype": HOOK_DT,
			"direction": "Inbound",
			"event_type": cstr(event)[:140],
			"event_id": event_id,
			"idem_key": key,
			"api_client": client["name"],
			"lab": client["linked_lab"],
			"universal_barcode": cstr((data or {}).get("universal") or (data or {}).get("lis_barcode"))[:140] or None,
			"attempts": 1,
			"payload_json": json.dumps(payload, default=str)[:60000],
			**values,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _parse_event(body):
	try:
		payload = json.loads(body or b"{}")
	except (TypeError, ValueError):
		raise ApiError("bad_json", "Body must be JSON")
	if not isinstance(payload, dict):
		raise ApiError("bad_json", "Body must be a JSON object")
	event_id = cstr(payload.get("event_id")).strip()
	if not EVENT_ID_RE.match(event_id):
		raise ApiError("bad_request", "event_id (6-100 chars of A-Z a-z 0-9 . _ : -) is required")
	event = cstr(payload.get("event")).strip()
	if event not in INBOUND_EVENTS:
		raise ApiError("unsupported_event", f"event must be one of {', '.join(INBOUND_EVENTS)}")
	data = payload.get("data") or {}
	if not isinstance(data, dict):
		raise ApiError("bad_request", "data must be an object")
	return payload, event_id, event, data


def webhook_core(client, body):
	"""Idempotent on (API client, event_id): a processed event is answered from the stored response."""
	payload, event_id, event, data = _parse_event(body)
	existing = frappe.db.get_value(HOOK_DT, {"idem_key": _inbound_key(client, event_id)}, ["status", "response_json"], as_dict=True)
	if existing and existing.status == "Processed":
		stored = json.loads(existing.response_json or "{}")
		return {**stored, "event_id": event_id, "duplicate": True}
	result = _handle(client, event, data)
	result = {**result, "event": event, "event_id": event_id}
	try:
		_save_inbound(client, event_id, event, payload, "Processed", result)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return {**result, "duplicate": True}
	return {**result, "duplicate": False}


# ---------------------------------------------------------------------------
# Outbound events (signed POST to the lab's webhook URL)
# ---------------------------------------------------------------------------


def _outbound_data(code, lab):
	bc = frappe.db.get_value(UB_DT, code, ["name", "status", "tube_code", "bound_trf", "bound_accession", "drop_hub", "dropped_on", "received_on"], as_dict=True) or {}
	mapping = _mapping(universal=code, lab=lab)
	return {
		"universal": code,
		"status": bc.get("status"),
		"tube_code": bc.get("tube_code"),
		"trf_id": bc.get("bound_trf"),
		"accession_id": bc.get("bound_accession"),
		"lis_barcode": mapping.lis_barcode if mapping else None,
		"drop_hub": bc.get("drop_hub"),
	}


def queue_outbound_event(lab, event, code):
	settings = lab_settings(lab)
	if not settings or not cstr(settings.outbound_webhook_url).startswith("https://") or not settings.api_client:
		return None
	event_id = f"pf_{frappe.generate_hash(length=20)}"
	payload = {"event_id": event_id, "event": event, "occurred_at": now_datetime().isoformat(), "lab": lab, "data": _outbound_data(code, lab)}
	doc = frappe.get_doc(
		{
			"doctype": HOOK_DT,
			"direction": "Outbound",
			"event_type": event,
			"event_id": event_id,
			"idem_key": f"out::{event_id}",
			"status": "Pending",
			"api_client": settings.api_client,
			"lab": lab,
			"universal_barcode": code,
			"url": settings.outbound_webhook_url,
			"attempts": 0,
			"next_attempt_on": add_to_date(now_datetime(), minutes=2),
			"payload_json": json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str),
		}
	)
	doc.insert(ignore_permissions=True)
	if not frappe.flags.pf_no_notify:
		frappe.enqueue(f"{CONVERTER_PATH}.deliver_outbound", queue="short", enqueue_after_commit=True, hook=doc.name)
	return doc.name


def outbound_headers(secret, event_id, body, ts=None):
	ts = cint(ts) or int(time.time())
	return {
		"Content-Type": "application/json",
		"User-Agent": "Remedium-PhleboFirst/1",
		"X-Hec-Event-Id": event_id,
		"X-Hec-Timestamp": str(ts),
		"X-Hec-Signature": api_signature(secret, ts, body),
	}


def deliver_outbound(hook=None):
	if not hook or not frappe.db.exists(HOOK_DT, hook):
		return None
	doc = frappe.get_doc(HOOK_DT, hook)
	if doc.direction != "Outbound" or doc.status not in ("Pending", "Failed"):
		return doc.status
	from frappe.utils.password import get_decrypted_password

	secret = get_decrypted_password(API_CLIENT_DT, doc.api_client, "api_secret", raise_exception=False) if doc.api_client else None
	attempts = cint(doc.attempts) + 1
	status, http_status, error = "Failed", None, None
	if not secret:
		error = "API client secret unavailable"
	else:
		try:
			import requests

			body = cstr(doc.payload_json)
			res = requests.post(doc.url, data=body.encode(), headers=outbound_headers(secret, doc.event_id, body), timeout=OUTBOUND_TIMEOUT_S)
			http_status = res.status_code
			if 200 <= res.status_code < 300:
				status = "Delivered"
			else:
				error = f"HTTP {res.status_code}: {cstr(res.text)[:300]}"
		except Exception as exc:
			error = f"{type(exc).__name__}: {cstr(exc)[:300]}"
	if status != "Delivered" and attempts >= OUTBOUND_MAX_ATTEMPTS:
		status = "Abandoned"
	values = {"status": status, "attempts": attempts, "http_status": http_status, "last_error": error}
	if status == "Failed":
		values["next_attempt_on"] = add_to_date(now_datetime(), minutes=OUTBOUND_BACKOFF_MIN[min(attempts, OUTBOUND_MAX_ATTEMPTS) - 1])
	frappe.db.set_value(HOOK_DT, doc.name, values)
	if error:
		frappe.log_error(title="phase133 outbound webhook", message=f"{doc.name} {doc.url}\n{error}")
	frappe.db.commit()
	return status


def retry_outbound_webhooks(limit=50):
	if not frappe.db.exists("DocType", HOOK_DT):
		return 0
	names = frappe.get_all(
		HOOK_DT,
		filters={"direction": "Outbound", "status": ("in", ("Pending", "Failed")), "next_attempt_on": ("<=", now_datetime()), "attempts": ("<", OUTBOUND_MAX_ATTEMPTS)},
		pluck="name",
		order_by="next_attempt_on asc",
		limit=cint(limit) or 50,
	)
	for name in names:
		try:
			deliver_outbound(name)
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="phase133 outbound retry", message=f"{name}\n{frappe.get_traceback()}")
	return len(names)


# ---------------------------------------------------------------------------
# Public endpoints (also served at /api/v1/barcode/convert and /api/v1/barcode/webhook)
# ---------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def barcode_convert(universal=None, lis_barcode=None, **kwargs):
	"""universal -> lab LIS barcode (existing mapping, bind lis_barcode, or auto-generate); lis_barcode -> universal."""
	return _api(lambda: convert_core(authenticate(SCOPE_CONVERT), universal, lis_barcode), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def barcode_webhook(**kwargs):
	"""Lab events: mapping.bind, sample.received, sample.rejected, result.ready (idempotent on event_id)."""
	request = getattr(frappe.local, "request", None)
	body = request.get_data() if request is not None else b""
	state = {}

	def run():
		state["client"] = authenticate(SCOPE_WEBHOOK)
		return webhook_core(state["client"], body)

	def record_failure(exc):
		client = state.get("client")
		if not client or exc.code in ("bad_json",):
			return
		try:
			payload, event_id, event, _data = _parse_event(body)
			_save_inbound(client, event_id, event, payload, "Failed", error=f"{exc.code}: {exc.message}")
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()

	return _api(run, commit=True, on_error=record_failure)
