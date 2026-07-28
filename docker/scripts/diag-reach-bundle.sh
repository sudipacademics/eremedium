#!/bin/bash
set -euo pipefail
JS=/opt/health-ecosystem/health_web_app/dist/web-assets/index-DAHnP7SC.js
echo "=== strings in live reach bundle ==="
for s in create_onboarding_session hec-session 'Start e-Aadhaar' onboard_base 'e-agreement' window.open franchise_portal; do
  if grep -qo "$s" "$JS"; then echo "FOUND $s"; else echo "MISSING $s"; fi
done
echo
echo "=== context around create_onboarding_session ==="
python3 - <<'PY'
from pathlib import Path
text=Path('/opt/health-ecosystem/health_web_app/dist/web-assets/index-DAHnP7SC.js').read_text(encoding='utf-8',errors='ignore')
needle='create_onboarding_session'
i=text.find(needle)
print('index', i)
print(text[max(0,i-200):i+300] if i>=0 else 'not found')
print('---')
for needle in ['Start e-Aadhaar','hec-session','Opening FFMS']:
  i=text.find(needle)
  print(needle, 'index', i)
  if i>=0:
    print(text[max(0,i-120):i+200])
    print('---')
PY

echo
echo "=== service worker? ==="
ls -la /opt/health-ecosystem/health_web_app/dist/sw.js 2>/dev/null || echo 'no sw.js'
grep -n 'onboard\|navigate\|e-remedium' /opt/health-ecosystem/health_web_app/dist/sw.js 2>/dev/null | head -30 || true

echo
echo "=== sales catalog URLs via bench ==="
cd /opt/health-ecosystem/docker
docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost execute frappe.client.get_single_value --args \"['Health Ecosystem Settings','franchise_portal_url']\"" 2>/dev/null || true
docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost execute frappe.client.get_single_value --args \"['Health Ecosystem Settings','company_public_site_url']\"" 2>/dev/null || true

echo
echo "=== nginx reach host special if ==="
sed -n '235,280p' /etc/nginx/sites-available/e-remedium
echo '--- www location / ---'
sed -n '45,120p' /etc/nginx/sites-available/e-remedium
