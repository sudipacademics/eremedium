#!/bin/bash
cd /opt/health-ecosystem/docker || exit 1
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
export PATH="/usr/local/bin:$PATH"
bench --site health.localhost console <<'PY'
import inspect
import frappe
from health_ecosystem_core.health_ecosystem_core import clinical_otp as otp
from health_ecosystem_core.health_ecosystem_core import clinical_msg91 as msg91
from health_ecosystem_core.health_ecosystem_core import clinical_secrets as secrets

print("otp_provider", secrets.get_otp_provider())
print("otp_test_mode", otp.otp_test_mode())
print("sms_configured", msg91.sms_configured())
print("sender", secrets.get_sms_sender_id())
src = inspect.getsource(otp._dispatch_sms)
print("uses_smilecure_template", "Smilecure" in src)
print("uses_old_health_ecosystem_text", "Your Health Ecosystem OTP" in src)
for line in src.splitlines():
    if "message" in line or "Smilecure" in line:
        print("LINE", line.strip())

print("uses_erpnext_sms_center", "sms_settings" in src.lower() or "SMS Center" in src)
print("msg91_calls_erpnext", "frappe.core" in inspect.getsource(msg91.send_msg91_sms))

try:
    ss = frappe.get_single("SMS Settings")
    print("ERPNext_sms_gateway_url", repr(getattr(ss, "sms_gateway_url", None) or ""))
except Exception as e:
    print("ERPNext_SMS_Settings", type(e).__name__, str(e)[:100])

if frappe.db.exists("DocType", "SMS Log"):
    print("SMS_Log_count", frappe.db.count("SMS Log"))
    for r in frappe.get_all("SMS Log", fields=["name", "creation", "message"], order_by="creation desc", limit_page_length=3):
        print("SMS_Log", r.name, r.creation, (r.message or "")[:80])
else:
    print("SMS_Log_doctype", "missing")

# Health settings DLT fields if any
s = frappe.get_single("Health Ecosystem Settings")
for f in dir(s):
    if "dlt" in f.lower() or "template" in f.lower() or "msg91" in f.lower() or "sms" in f.lower():
        if f.startswith("_"):
            continue
        try:
            v = getattr(s, f, None)
            if callable(v):
                continue
            print("settings_field", f, repr(v)[:120])
        except Exception:
            pass

print("DONE")
PY
EOS
