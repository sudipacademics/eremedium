#!/bin/bash
set -e
SITE_H="X-Frappe-Site-Name: health.localhost"
echo "=== HOME ==="
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.get_home_content" -H "$SITE_H" | python3 -c "import sys,json; d=json.load(sys.stdin); data=(d.get('message') or d).get('data') or {}; print('ok', 'banners',len(data.get('banners') or []), 'packages',len(data.get('health_packages') or []))"
echo "=== WELLNESS ==="
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.appointments.get_allied_health_wings" -H "$SITE_H" | python3 -c "import sys,json; d=json.load(sys.stdin); 
print('exc' if d.get('exception') else 'ok', (d.get('message') or d).get('data',{}).get('wings') and len((d.get('message') or d)['data']['wings']))"
echo "=== AI START ==="
curl -s -X POST "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey" -H "$SITE_H" -d "symptoms=fever+for+2+days" | python3 -c "import sys,json; d=json.load(sys.stdin); data=(d.get('message') or d).get('data') or {}; print('exc' if d.get('exception') else 'ok', 'session' if data.get('session_id') else data, 'openai', data.get('openai_enabled'))"
echo "=== INSURANCE ==="
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance.get_insurance_landing" -H "$SITE_H" | python3 -c "import sys,json; d=json.load(sys.stdin); data=(d.get('message') or d).get('data') or {}; print('ok', len(data.get('products') or []))"
echo "=== OAUTH ==="
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.get_oauth_providers" -H "$SITE_H" | python3 -c "import sys,json; d=json.load(sys.stdin); data=(d.get('message') or d).get('data') or {}; print('ok', [p.get('provider') for p in data.get('providers') or []])"
echo "=== SALES PORTAL (guest expect auth err) ==="
curl -s -X POST "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.get_sales_portal" -H "$SITE_H" | python3 -c "import sys,json; d=json.load(sys.stdin); m=(d.get('message') or d); print(m.get('status'), m.get('message','')[:80] if isinstance(m,dict) else m)"
echo "=== COMPANIES ==="
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc './env/bin/python - <<PY
import frappe
frappe.init(site="health.localhost"); frappe.connect()
rows=frappe.get_all("Company", fields=["name","abbr","is_group"])
print("companies", rows)
print("default", frappe.defaults.get_global_default("company"))
print("openai field", frappe.get_meta("Health Ecosystem Settings").has_field("telephony_openai_api_key"))
s=frappe.get_single("Health Ecosystem Settings")
print("openai configured", bool((getattr(s,"telephony_openai_api_key",None) or "").strip()))
PY'
echo "=== SPA PATHS ==="
for u in / /wellness /insurance /pharmacy /services /login; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://www.e-remedium.in$u")
  echo "www$u => $code"
done
for host in partners.e-remedium.in collect.e-remedium.in reach.e-remedium.in erp.e-remedium.in; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-redirs 2 "https://$host/")
  echo "$host => $code"
done
