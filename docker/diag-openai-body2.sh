#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost console" <<'PY'
import frappe, json, urllib.request, urllib.error, re
s = frappe.get_single("Health Ecosystem Settings")
key = (s.get_password("telephony_openai_api_key", raise_exception=False) or "").strip()
print("key_ok", bool(key and key.startswith("sk-")), "len", len(key))
body = json.dumps({"model":"gpt-4o-mini","messages":[{"role":"user","content":"pong"}]}).encode()
req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body, headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode())
    snip = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")[:40]
    print("RESULT_OK", snip)
except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", errors="replace")
    raw = re.sub(r"sk-[A-Za-z0-9_\\-]+", "sk-REDACTED", raw)
    code = "unknown"
    for c in ("insufficient_quota", "rate_limit_exceeded", "invalid_api_key", "billing_not_active"):
        if c in raw:
            code = c
    print("RESULT_FAIL", e.code, code)
    print("BODYFLAT", raw.replace("{","(").replace("}",")")[:400])
print("DONE")
PY
