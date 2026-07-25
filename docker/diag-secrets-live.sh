#!/bin/bash
# Verify MSG91 + OpenAI secrets are set and OpenAI accepts the key.
# Never prints secret values.
cd /opt/health-ecosystem/docker
SITE=health.localhost

docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE console" <<'PY'
import hashlib
import frappe

def mask(v):
    v = (v or "").strip()
    if not v:
        return {"set": False, "len": 0, "prefix": "", "sha8": ""}
    return {
        "set": True,
        "len": len(v),
        "prefix": (v[:7] + "…") if len(v) > 7 else (v[:2] + "…"),
        "sha8": hashlib.sha256(v.encode()).hexdigest()[:8],
    }

s = frappe.get_single("Health Ecosystem Settings")
print("=== Health Ecosystem Settings (masked) ===")
print("telephony_enabled", bool(getattr(s, "telephony_enabled", 0)))
print("telephony_openai_api_key", mask(getattr(s, "telephony_openai_api_key", None)))
# Password fields must use get_password
for pf in ("sms_auth_key", "telephony_openai_api_key", "exotel_webhook_secret", "exotel_api_token"):
    try:
        val = s.get_password(pf, raise_exception=False)
    except Exception:
        val = None
    # non-password text fields may not work with get_password; also try getattr
    if not val:
        val = getattr(s, pf, None)
    print(f"field:{pf}", mask(val))

print("sms_sender_id", repr(getattr(s, "sms_sender_id", None) or getattr(s, "msg91_sender_id", None)))

from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_sms_auth_key, get_sms_sender_id
from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import sms_configured
print("get_sms_auth_key", mask(get_sms_auth_key()))
print("get_sms_sender_id", repr(get_sms_sender_id()))
print("sms_configured", sms_configured())

print()
print("=== OpenAI live ping ===")
from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t
print("openai_key_set", bool(t._openai_key()))
print("telephony_enabled", t._telephony_enabled())
out = t._openai_chat_turn([{"role": "user", "content": "Reply with the single word pong"}])
if out is None:
    print("openai_ok False")
    # pull latest error
    rows = frappe.get_all(
        "Error Log",
        filters={"method": "telephony_openai"},
        fields=["creation", "error"],
        order_by="creation desc",
        limit_page_length=1,
    )
    if rows:
        err = (rows[0].error or "").replace("\n", " ")
        # strip any bearer tokens if present
        import re
        err = re.sub(r"sk-[A-Za-z0-9_\-]+", "sk-REDACTED", err)
        err = re.sub(r"Bearer\s+\S+", "Bearer REDACTED", err)
        print("latest_error", rows[0].creation, err[:300])
else:
    content = (out.get("content") if isinstance(out, dict) else str(out)) or ""
    print("openai_ok True")
    print("openai_content_snip", repr(content[:80]))

print("DONE")
PY
