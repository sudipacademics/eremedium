"""Shared OpenAI Chat Completions helper for telephony + AI Physician.

Live diagnosis (2026-07-23): API key authenticates; project exposes gpt-4o-mini;
chat fails with HTTP 429 insufficient_quota (billing). Rule-based paths remain.
"""

from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe

DEFAULT_MODEL = "gpt-4o-mini"
STATUS_CACHE_KEY = "hec:openai:runtime_status"
# Avoid hammering OpenAI + Error Log when quota is exhausted.
QUOTA_COOLDOWN_SEC = 300
AUTH_COOLDOWN_SEC = 120


def get_openai_api_key():
	try:
		s = frappe.get_single("Health Ecosystem Settings")
		key = s.get_password("telephony_openai_api_key", raise_exception=False)
		return (key or "").strip()
	except Exception:
		return ""


def get_openai_model():
	try:
		s = frappe.get_single("Health Ecosystem Settings")
		model = (getattr(s, "openai_chat_model", None) or "").strip()
		return model or DEFAULT_MODEL
	except Exception:
		return DEFAULT_MODEL


def _read_status():
	return frappe.cache().get_value(STATUS_CACHE_KEY) or {}


def _write_status(payload, expires_in_sec=QUOTA_COOLDOWN_SEC):
	frappe.cache().set_value(STATUS_CACHE_KEY, payload, expires_in_sec=expires_in_sec)


def clear_openai_status_cache():
	frappe.cache().delete_value(STATUS_CACHE_KEY)


def openai_runtime_status():
	"""Ops-facing status for dashboards / start_ai_physician_journey."""
	key = get_openai_api_key()
	cached = _read_status()
	code = (cached.get("code") or "").strip()
	blocked = bool(code) and code in (
		"insufficient_quota",
		"invalid_api_key",
		"model_not_found",
		"billing_hard_limit",
		"rate_limit_or_quota",
		"auth_or_access",
	)
	until = float(cached.get("until") or 0)
	if until and time.time() > until:
		blocked = False
		code = ""
	return {
		"configured": bool(key),
		"model": get_openai_model(),
		"ready": bool(key) and not blocked,
		"last_error_code": code or None,
		"last_error_message": (cached.get("message") or None) if code else None,
		"cooldown_until": until or None,
		"using_fallback": not bool(key) or blocked,
	}


def _parse_http_error(exc: HTTPError):
	body = ""
	try:
		body = exc.read().decode("utf-8", errors="replace")
	except Exception:
		body = ""
	code = ""
	message = getattr(exc, "reason", None) or str(exc)
	try:
		parsed = json.loads(body) if body else {}
		err = parsed.get("error") or {}
		code = (err.get("code") or err.get("type") or "").strip()
		message = (err.get("message") or message or "").strip()
	except Exception:
		if body and len(body) < 500:
			message = body.strip()
	if not code and exc.code == 429:
		code = "rate_limit_or_quota"
	if not code and exc.code in (401, 403):
		code = "auth_or_access"
	return {
		"http_status": exc.code,
		"code": code or f"http_{exc.code}",
		"message": message[:800],
	}


def _mark_failure(detail, cooldown=QUOTA_COOLDOWN_SEC):
	payload = {
		"code": detail.get("code") or "openai_error",
		"message": detail.get("message") or "OpenAI request failed",
		"http_status": detail.get("http_status"),
		"until": time.time() + cooldown,
		"at": time.time(),
	}
	_write_status(payload, expires_in_sec=max(cooldown, 60))
	title = f"openai:{payload['code']}"
	frappe.log_error(
		title=title[:140],
		message=f"{payload['message']}\nhttp={payload.get('http_status')}\nmodel={get_openai_model()}",
	)
	return payload


def _mark_ok():
	_write_status(
		{"code": "", "message": "", "until": 0, "at": time.time(), "ok": True},
		expires_in_sec=60,
	)


def _should_skip_call():
	st = openai_runtime_status()
	if not st.get("configured"):
		return True, "not_configured"
	if not st.get("ready"):
		return True, st.get("last_error_code") or "cooldown"
	return False, None


def openai_chat_completion(
	messages,
	*,
	tools=None,
	tool_choice=None,
	temperature=None,
	timeout=45,
	log_prefix="openai",
	response_format=None,
):
	"""Call Chat Completions. Returns assistant message dict, or None on failure.

	response_format: optional OpenAI response_format dict, e.g. {"type": "json_object"}.
	"""
	skip, reason = _should_skip_call()
	if skip:
		return None

	key = get_openai_api_key()
	model = get_openai_model()
	payload = {"model": model, "messages": messages}
	if tools is not None:
		payload["tools"] = tools
		payload["tool_choice"] = tool_choice or "auto"
	if temperature is not None:
		payload["temperature"] = temperature
	if response_format is not None:
		payload["response_format"] = response_format

	body = json.dumps(payload).encode("utf-8")
	req = Request(
		"https://api.openai.com/v1/chat/completions",
		data=body,
		headers={
			"Authorization": f"Bearer {key}",
			"Content-Type": "application/json",
		},
		method="POST",
	)
	try:
		with urlopen(req, timeout=timeout) as resp:
			data = json.loads(resp.read().decode("utf-8"))
		_mark_ok()
		return (data.get("choices") or [{}])[0].get("message")
	except HTTPError as exc:
		detail = _parse_http_error(exc)
		cool = QUOTA_COOLDOWN_SEC
		if detail["code"] in ("invalid_api_key", "auth_or_access"):
			cool = AUTH_COOLDOWN_SEC
		elif detail["code"] not in ("insufficient_quota", "billing_hard_limit", "rate_limit_or_quota"):
			cool = 60
		_mark_failure(detail, cooldown=cool)
		return None
	except URLError as exc:
		_mark_failure(
			{"code": "network_error", "message": str(exc.reason or exc), "http_status": None},
			cooldown=60,
		)
		return None
	except Exception:
		frappe.log_error(title=f"{log_prefix}_openai", message=frappe.get_traceback())
		_mark_failure(
			{"code": "unexpected_error", "message": "See Error Log", "http_status": None},
			cooldown=60,
		)
		return None


def openai_json_completion(
	messages,
	*,
	temperature=0.4,
	timeout=35,
	log_prefix="openai_json",
):
	"""Chat Completions with JSON object mode. Returns parsed dict, or None."""
	# OpenAI requires the word "json" in messages when using json_object.
	ensured = list(messages or [])
	if ensured and ensured[0].get("role") == "system":
		sys_content = ensured[0].get("content") or ""
		if "json" not in sys_content.lower():
			ensured[0] = {
				**ensured[0],
				"content": sys_content + "\nRespond with a single JSON object only.",
			}
	else:
		ensured.insert(
			0,
			{"role": "system", "content": "Respond with a single JSON object only."},
		)

	msg = openai_chat_completion(
		ensured,
		temperature=temperature,
		timeout=timeout,
		log_prefix=log_prefix,
		response_format={"type": "json_object"},
	)
	if not msg:
		return None
	raw = (msg.get("content") or "").strip()
	if not raw:
		return None
	try:
		parsed = json.loads(raw)
		return parsed if isinstance(parsed, dict) else None
	except Exception:
		# Tolerate fenced ```json blocks
		start, end = raw.find("{"), raw.rfind("}")
		if start >= 0 and end > start:
			try:
				parsed = json.loads(raw[start : end + 1])
				return parsed if isinstance(parsed, dict) else None
			except Exception:
				pass
		frappe.log_error(
			title=f"{log_prefix}_parse",
			message=f"Unparseable JSON from OpenAI:\n{raw[:1200]}",
		)
		return None


def probe_openai(force=False):
	"""Lightweight live probe for ops/smoke. Does not throw."""
	if force:
		clear_openai_status_cache()
	key = get_openai_api_key()
	if not key:
		return {"ok": False, "configured": False, "error": "not_configured", **openai_runtime_status()}
	msg = openai_chat_completion(
		[
			{"role": "system", "content": "Reply with exactly: ok"},
			{"role": "user", "content": "ping"},
		],
		temperature=0,
		timeout=20,
		log_prefix="openai_probe",
	)
	st = openai_runtime_status()
	if msg and (msg.get("content") or "").strip():
		return {"ok": True, "configured": True, "reply": (msg.get("content") or "").strip()[:80], **st}
	return {
		"ok": False,
		"configured": True,
		"error": st.get("last_error_code") or "no_response",
		**st,
	}
