#!/bin/bash
# Compare getattr vs get_password for openai key (hashes only).
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost console" <<'PY'
import frappe, hashlib
s = frappe.get_single("Health Ecosystem Settings")
g = (getattr(s, "telephony_openai_api_key", None) or "")
try:
    p = s.get_password("telephony_openai_api_key", raise_exception=False) or ""
except Exception as e:
    p = ""
    print("get_password_err", type(e).__name__)
def info(label, v):
    v = (v or "").strip()
    if not v:
        print(label, "UNSET"); return
    print(label, "len", len(v), "startswith_sk", v.startswith("sk-"), "sha8", hashlib.sha256(v.encode()).hexdigest()[:8], "same_as_stars", v == ("*" * len(v)))
info("getattr", g)
info("get_password", p)
print("identical", (g or "").strip() == (p or "").strip())
print("DONE")
PY
