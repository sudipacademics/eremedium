#!/bin/bash
# MSG91 smoke test â€” never prints auth key.
set -euo pipefail
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== egress IP (what MSG91 sees) ==="
docker compose exec -T backend curl -4 -sS --max-time 10 ifconfig.me || true
echo

echo "=== settings / gates ==="
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && /usr/local/bin/bench --site $SITE console" <<'PY'
import hashlib
import json
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlparse, parse_qs
from urllib.request import Request, urlopen

import frappe

def mask(v):
    v = (v or "").strip()
    if not v:
        return {"set": False, "len": 0}
    return {"set": True, "len": len(v), "sha8": hashlib.sha256(v.encode()).hexdigest()[:8]}

s = frappe.get_single("Health Ecosystem Settings")
print("otp_provider", repr(getattr(s, "otp_provider", None)))
print("notification_channel", repr(getattr(s, "notification_channel", None)))
print("sms_sender_id", repr(getattr(s, "sms_sender_id", None)))
print("sms_enabled_flag", repr(getattr(s, "sms_enabled", None)))

try:
    auth = s.get_password("sms_auth_key", raise_exception=False)
except Exception:
    auth = None
if not auth:
    auth = getattr(s, "sms_auth_key", None)
print("settings.sms_auth_key", mask(auth))

from health_ecosystem_core.health_ecosystem_core import clinical_secrets as secrets
from health_ecosystem_core.health_ecosystem_core import clinical_otp as otp
from health_ecosystem_core.health_ecosystem_core import clinical_msg91 as msg91
from health_ecosystem_core.health_ecosystem_core import clinical_notifications as notif

print("get_otp_provider", repr(secrets.get_otp_provider()))
print("otp_test_mode (clinical_otp)", otp.otp_test_mode())
print("otp_test_mode (clinical_secrets)", secrets.otp_test_mode())
print("notification_channel resolved", repr(secrets.get_notification_channel()))
print("sms_test_mode", secrets.sms_test_mode())
print("sms_configured", msg91.sms_configured())
print("get_sms_auth_key", mask(secrets.get_sms_auth_key()))
print("get_sms_sender_id", repr(secrets.get_sms_sender_id()))

print()
print("=== direct MSG91 API probe (dummy mobile, no OTP flow) ===")
authkey = secrets.get_sms_auth_key()
sender = secrets.get_sms_sender_id() or "HECLAB"
if not authkey:
    print("SKIP_API reason=no_auth_key")
else:
    # Use a clearly invalid destination so we don't spam a real handset;
    # MSG91 still logs/auth-checks the request.
    mobiles = "919999999999"
    message = "Remedium MSG91 smoke test"
    url = (
        "https://control.msg91.com/api/sendhttp.php?"
        f"authkey={quote(authkey)}&mobiles={mobiles}&message={quote(message)}"
        f"&sender={quote(sender)}&route=4&country=91"
    )
    # Redact authkey from any logged URL
    safe_url = re.sub(r"authkey=[^&]+", "authkey=REDACTED", url)
    print("request_url", safe_url)
    try:
        with urlopen(Request(url, method="GET"), timeout=20) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace").strip()
        print("http_status", status)
        print("response_body", body[:500])
        low = body.lower()
        if "whitelist" in low or "ip" in low:
            print("diagnosis", "MSG91 rejected request (IP/auth). Request DID reach MSG91.")
        elif "error" in low:
            print("diagnosis", "MSG91 returned an error body. Request DID reach MSG91.")
        else:
            print("diagnosis", "MSG91 accepted/responded. Request DID reach MSG91.")
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        print("http_status", exc.code)
        print("response_body", err[:500])
        print("diagnosis", "HTTPError from MSG91 â€” request reached their edge.")
    except Exception as exc:
        print("exception", type(exc).__name__, str(exc)[:300])
        print("diagnosis", "Request failed before/without MSG91 response (network/DNS/TLS).")

print()
print("=== OTP dispatch path (would it call MSG91?) ===")
if otp.otp_test_mode():
    print("OTP_PATH", "TEST MODE â€” send_otp logs locally and NEVER calls MSG91")
else:
    print("OTP_PATH", "LIVE â€” send_otp would call send_msg91_sms")

print()
print("=== recent Error Log (MSG91 / send_otp) ===")
rows = frappe.get_all(
    "Error Log",
    filters={"creation": [">", frappe.utils.add_to_date(None, hours=-48)]},
    fields=["creation", "method", "error"],
    order_by="creation desc",
    limit_page_length=30,
)
hits = []
for r in rows:
    blob = f"{r.method or ''} {r.error or ''}".lower()
    if "msg91" in blob or "send_otp" in blob or "sms" in blob or "whitelist" in blob:
        hits.append(r)
print("matching_errors", len(hits))
for r in hits[:5]:
    err = (r.error or "").replace("\n", " ")
    err = re.sub(r"authkey=[^&\s]+", "authkey=REDACTED", err)
    print("-", r.creation, (r.method or "")[:40], err[:220])

print("DONE")
PY
