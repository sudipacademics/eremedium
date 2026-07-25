#!/bin/bash
# Verify MSG91 + OpenAI without printing secrets.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python -' <<'PY'
import hashlib, json, re, urllib.request, urllib.error
import frappe

frappe.init(site="health.localhost", sites_path="./sites")
frappe.connect()

def mask(v):
    v = (v or "").strip()
    if not v:
        return "UNSET"
    return "set len=%d prefix=%s… sha8=%s" % (
        len(v), v[:4], hashlib.sha256(v.encode()).hexdigest()[:8]
    )

s = frappe.get_single("Health Ecosystem Settings")
print("telephony_enabled", bool(getattr(s, "telephony_enabled", 0)))
print("openai_field", mask(getattr(s, "telephony_openai_api_key", None)))
try:
    sms_pw = s.get_password("sms_auth_key", raise_exception=False)
except Exception:
    sms_pw = None
print("sms_auth_key_password", mask(sms_pw))

from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key, get_sms_sender_id
from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import sms_configured
print("get_sms_auth_key", mask(get_sms_auth_key()))
print("sms_sender", repr(get_sms_sender_id()))
print("sms_configured", sms_configured())

from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t
key = t._openai_key()
print("openai_key_via_helper", mask(key))
print("telephony_enabled_helper", t._telephony_enabled())

if not key:
    print("openai_ok", False)
    print("reason", "empty key")
else:
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Reply with the single word pong"}],
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": "Bearer %s" % key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode())
        content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
        print("openai_ok", True)
        print("openai_http", 200)
        print("openai_snip", repr(content[:80]))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raw = re.sub(r"sk-[A-Za-z0-9_\-]+", "sk-REDACTED", raw)
        print("openai_ok", False)
        print("openai_http", e.code)
        print("openai_body", raw[:400])
    except Exception as e:
        print("openai_ok", False)
        print("openai_exc", type(e).__name__, str(e)[:200])

frappe.destroy()
print("DONE")
PY
