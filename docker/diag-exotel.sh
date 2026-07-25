#!/bin/bash
# Read-only Exotel / telephony health check (no compose down)
set -e
cd /opt/health-ecosystem/docker
SITE_H="X-Frappe-Site-Name: health.localhost"
BASE="/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"

echo "=== files ==="
ls -la "$BASE"/clinical_phase64* 2>/dev/null || ls -la apps 2>/dev/null | head
find /opt/health-ecosystem -name '*telephony*' -o -name '*exotel*' 2>/dev/null | head -40

echo "=== module present in container ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench; ls apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64* 2>/dev/null; ./env/bin/python - <<"PY"
import importlib
for m in [
  "health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony",
  "health_ecosystem_core.health_ecosystem_core.clinical_phase25_masked_calls",
]:
  try:
    mod = importlib.import_module(m)
    print("OK", m, [x for x in dir(mod) if not x.startswith("_")][:40])
  except Exception as e:
    print("FAIL", m, type(e).__name__, e)
PY'

echo "=== settings (masked, no secrets) ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench; ./env/bin/python - <<"PY"
import frappe
frappe.init(site="health.localhost"); frappe.connect()
fields = [
  "telephony_enabled","exotel_sid","exotel_api_key","exotel_api_token","exotel_virtual_number",
  "exotel_subdomain","exotel_account_sid","telephony_agent_number","telephony_openai_api_key",
  "exotel_app_id","exotel_caller_id"
]
meta = frappe.get_meta("Health Ecosystem Settings")
s = frappe.get_single("Health Ecosystem Settings")
print("doctype_ok", True)
for f in fields:
  has = meta.has_field(f)
  val = getattr(s, f, None) if has else None
  if f.endswith(("key","token","secret")) or "api_token" in f or "api_key" in f:
    shown = "SET" if (val or "").strip() else "EMPTY"
  elif f.endswith("sid") or "number" in f or "subdomain" in f or "caller" in f or "app_id" in f:
    shown = (str(val)[:6] + "…" + str(val)[-4:]) if val and len(str(val))>12 else (val or "EMPTY")
    if val and f.endswith(("key","token")):
      shown = "SET"
  else:
    shown = val if val not in (None,"") else "EMPTY"
    if has and f in ("exotel_api_key","exotel_api_token","telephony_openai_api_key") and val:
      shown = "SET"
  # refine sensitive
  if has and any(x in f for x in ("key","token","secret")):
    shown = "SET" if (val or "").strip() else "EMPTY"
  elif has and f == "exotel_sid":
    shown = ("SET:"+str(val)[:4]+"…") if val else "EMPTY"
  elif has and f in ("exotel_virtual_number","telephony_agent_number","exotel_caller_id"):
    shown = val or "EMPTY"
  elif has and f == "exotel_subdomain":
    shown = val or "EMPTY"
  print(f"{f}: has={has} value={shown}")
# also dump any field with exotel/telephony in name
for df in meta.fields:
  if "exotel" in (df.fieldname or "").lower() or "telephony" in (df.fieldname or "").lower():
    v = getattr(s, df.fieldname, None)
    sens = any(x in df.fieldname for x in ("key","token","secret"))
    print("FIELD", df.fieldname, "SET" if (sens and v) else (v if not sens else ("SET" if v else "EMPTY")))
PY'

echo "=== grep exotel API usage ==="
F=$(docker compose exec -T backend bash -lc 'ls /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py 2>/dev/null; ls /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/*mask* 2>/dev/null; ls /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/*tele* 2>/dev/null' | tr -d '\r')
echo "$F"
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core; rg -n "exotel|api.exotel|Connect|Passthru|masked|telephony_incoming|start_masked" -g "*.py" | head -80'

echo "=== HTTP smoke telephony_incoming (guest) ==="
curl -sS -X POST "https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "$SITE_H" \
  -d "CallFrom=09876543210&CallTo=080XXXXXXX&CallSid=TESTSID123&Direction=incoming" | head -c 1500
echo
curl -sS "https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.get_telephony_dashboard" \
  -H "$SITE_H" | head -c 800
echo
