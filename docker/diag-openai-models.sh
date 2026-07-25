#!/bin/bash
cd /opt/health-ecosystem/docker || exit 1
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
export PATH="/usr/local/bin:$PATH"
bench --site health.localhost console <<'PY'
import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import frappe

from health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony import _openai_key

key = _openai_key()
print("key_set", bool(key), "len", len(key or ""), "prefix", (key[:8] + "â€¦") if key else "")

# List model ids
req = Request("https://api.openai.com/v1/models", headers={"Authorization": "Bearer " + key}, method="GET")
with urlopen(req, timeout=20) as resp:
    data = json.loads(resp.read().decode())
ids = sorted(m.get("id") for m in (data.get("data") or []))
print("model_ids", ids[:40])
print("has_gpt4o_mini", "gpt-4o-mini" in ids)
print("has_gpt35", any("gpt-3.5" in i for i in ids))

# Probe chat with gpt-4o-mini and fallbacks
for model in ("gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "gpt-4.1-mini", "o4-mini"):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the single word pong"}],
        "max_tokens": 16,
    }).encode()
    req = Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read().decode())
        content = (out.get("choices") or [{}])[0].get("message", {}).get("content")
        print("CHAT_OK", model, repr((content or "")[:60]))
        break
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raw = re.sub(r"sk-[A-Za-z0-9_-]+", "sk-REDACTED", raw)
        try:
            err = json.loads(raw).get("error") or {}
        except Exception:
            err = {"message": raw[:200]}
        print("CHAT_FAIL", model, e.code, err.get("code") or err.get("type"), (err.get("message") or "")[:220])
    except Exception as e:
        print("CHAT_EXC", model, type(e).__name__, str(e)[:160])

# Latest telephony_openai error body extract
rows = frappe.get_all("Error Log", filters={"method": "telephony_openai"}, fields=["creation", "error"], order_by="creation desc", limit_page_length=1)
if rows:
    err = rows[0].error or ""
    # pull HTTP Error line / body
    for line in err.splitlines():
        if "HTTP Error" in line or "insufficient" in line.lower() or "model" in line.lower() or "error" in line.lower() and "File" not in line:
            print("LOG_LINE", line[:240])
    # also search JSON snippet
    m = re.search(r'\{[^{}]*"error"[^{}]*\{.*?\}.*?\}', err, re.S)
    if m:
        print("LOG_JSON", re.sub(r"sk-[A-Za-z0-9_-]+", "sk-REDACTED", m.group(0))[:400])

print("DONE")
PY
EOS
