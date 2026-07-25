#!/bin/bash
# MSG91 OTP path smoke â€” no secrets printed.
cd /opt/health-ecosystem/docker || exit 1
SITE=health.localhost

docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
export PATH="/usr/local/bin:$PATH"
bench --site health.localhost console <<'PY'
import re
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import frappe

from health_ecosystem_core.health_ecosystem_core import clinical_otp as otp
from health_ecosystem_core.health_ecosystem_core import clinical_msg91 as msg91
from health_ecosystem_core.health_ecosystem_core import clinical_secrets as secrets
from health_ecosystem_core.health_ecosystem_core.otp_auth import send_otp

print("otp_provider", secrets.get_otp_provider())
print("otp_test_mode", otp.otp_test_mode())
print("sms_configured", msg91.sms_configured())
print("sender", secrets.get_sms_sender_id())

# 1) Direct helper with a non-customer test number
ok = msg91.send_msg91_sms("9999999999", "Remedium helper smoke")
print("send_msg91_sms_ok", ok)

# 2) Latest Error Log titles matching MSG91
rows = frappe.get_all(
    "Error Log",
    fields=["creation", "method", "error"],
    order_by="creation desc",
    limit_page_length=50,
)
msg_hits = [r for r in rows if "msg91" in ((r.method or "") + (r.error or "")).lower()]
print("recent_msg91_error_count_in_50", len(msg_hits))
for r in msg_hits[:5]:
    err = re.sub(r"authkey=[^&\s]+", "authkey=REDACTED", (r.error or "").replace("\n", " "))
    print("ERR", r.creation, r.method, err[:250])

# 3) Decode whether last direct HTTP style still works and show response class
auth = secrets.get_sms_auth_key()
sender = secrets.get_sms_sender_id() or "HECLAB"
url = (
    "https://control.msg91.com/api/sendhttp.php?"
    f"authkey={quote(auth)}&mobiles=919999999999&message={quote('Remedium probe2')}"
    f"&sender={quote(sender)}&route=4&country=91"
)
try:
    with urlopen(Request(url, method="GET"), timeout=20) as resp:
        body = resp.read().decode("utf-8", errors="replace").strip()
    print("probe2_body", body[:200])
    # MSG91 request ids are usually alphanumeric hex-ish; errors are plain English
    if re.fullmatch(r"[0-9a-fA-F]{10,}", body) or re.fullmatch(r"[A-Za-z0-9]{10,}", body):
        print("probe2_class", "request_id_success")
    else:
        print("probe2_class", "error_or_other")
except HTTPError as e:
    print("probe2_http", e.code, e.read()[:200])
except Exception as e:
    print("probe2_exc", type(e).__name__, str(e)[:200])

print("DONE")
PY
EOS
