#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost console" <<'PY'
import frappe, json, urllib.request, urllib.error, re
s = frappe.get_single("Health Ecosystem Settings")
key = (s.get_password("telephony_openai_api_key", raise_exception=False) or "").strip()
print("key_set", bool(key), "startswith_sk", key.startswith("sk-"), "len", len(key))
body = json.dumps({"model":"gpt-4o-mini","messages":[{"role":"user","content":"pong"}]}).encode()
req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body, headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode())
    print("ok", True, "snip", repr((((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")[:40]))
except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", errors="replace")
    raw = re.sub(r"sk-[A-Za-z0-9_\\-]+", "sk-REDACTED", raw)
    print("ok", False, "http", e.code)
    print("body", raw[:500])
print("DONE")
PY
