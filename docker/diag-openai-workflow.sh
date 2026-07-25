#!/bin/bash
# Diagnose OpenAI workflow â€” never prints secrets.
cd /opt/health-ecosystem/docker || exit 1
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
export PATH="/usr/local/bin:$PATH"
bench --site health.localhost console <<'PY'
import hashlib
import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import frappe

def mask(v):
    v = (v or "").strip()
    if not v:
        return {"set": False, "len": 0}
    return {
        "set": True,
        "len": len(v),
        "prefix": v[:7] + "â€¦",
        "sha8": hashlib.sha256(v.encode()).hexdigest()[:8],
        "looks_sk": v.startswith("sk-"),
    }

s = frappe.get_single("Health Ecosystem Settings")
print("telephony_enabled", bool(getattr(s, "telephony_enabled", 0)))
try:
    key_pw = s.get_password("telephony_openai_api_key", raise_exception=False)
except Exception as e:
    key_pw = None
    print("get_password_err", type(e).__name__)
key_attr = getattr(s, "telephony_openai_api_key", None)
print("key_get_password", mask(key_pw))
print("key_getattr", mask(key_attr if isinstance(key_attr, str) else None))

from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t64
from health_ecosystem_core.health_ecosystem_core import clinical_phase66_ai_physician as t66
print("p64_openai_key", mask(t64._openai_key()))
print("p66_openai_key", mask(t66._openai_key()))
print("p64_helper_uses_get_password", "get_password" in open(t64.__file__).read())
print("p66_helper_uses_get_password", "get_password" in open(t66.__file__).read())

# Live Models list (cheap) then chat
key = t64._openai_key()
if not key:
    print("SKIP_LIVE reason=no_key")
else:
    try:
        req = Request(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {key}"},
            method="GET",
        )
        with urlopen(req, timeout=20) as resp:
            print("models_http", resp.status)
            data = json.loads(resp.read().decode())
            print("models_count", len(data.get("data") or []))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        body = re.sub(r"sk-[A-Za-z0-9_-]+", "sk-REDACTED", body)
        print("models_http", e.code)
        print("models_body", body[:400])
        try:
            err = json.loads(body).get("error") or {}
            print("models_error_code", err.get("code") or err.get("type"))
            print("models_error_msg", (err.get("message") or "")[:200])
        except Exception:
            pass
    except Exception as e:
        print("models_exc", type(e).__name__, str(e)[:200])

    out = t64._openai_chat_turn([{"role": "user", "content": "Reply with the single word pong"}])
    print("chat_turn_result", "ok" if out else "None")
    if out:
        print("chat_snip", repr((out.get("content") if isinstance(out, dict) else str(out))[:80]))

# Recent errors
rows = frappe.get_all(
    "Error Log",
    fields=["creation", "method", "error"],
    order_by="creation desc",
    limit_page_length=40,
)
hits = []
for r in rows:
    blob = f"{r.method or ''} {r.error or ''}".lower()
    if "openai" in blob or "ai_physician" in blob or "insufficient_quota" in blob:
        hits.append(r)
print("openai_error_hits", len(hits))
for r in hits[:5]:
    err = re.sub(r"sk-[A-Za-z0-9_-]+", "sk-REDACTED", (r.error or "").replace("\n", " "))
    print("ERR", r.creation, (r.method or "")[:40], err[:280])

# AI physician start (rule path + openai flag)
from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import start_ai_physician_journey
turn = start_ai_physician_journey(symptoms="fever and cough for 2 days")
print("ai_start_ok", bool(turn.get("session_id")))
print("ai_openai_enabled", turn.get("openai_enabled"))
print("ai_phase", turn.get("phase"))
print("ai_msg_snip", repr((turn.get("message") or "")[:100]))

print("DONE")
PY
EOS
