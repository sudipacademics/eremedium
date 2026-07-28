#!/bin/bash
# Diagnose Reach → FFMS onboard redirect (no secrets printed).
set -euo pipefail

echo "=== nginx hec-session / onboard ==="
grep -nE 'hec-session|location .*/onboard|rfms_portal|proxy_pass http://rfms' /etc/nginx/sites-available/e-remedium | head -80 || true

echo
echo "=== site_config onboard_base_url ==="
python3 <<'PY'
import json, glob
paths = glob.glob("/opt/health-ecosystem/**/sites/health.localhost/site_config.json", recursive=True)
paths += glob.glob("/root/**/sites/health.localhost/site_config.json", recursive=True)
# also docker volume style
paths += glob.glob("/opt/health-ecosystem/docker/sites/health.localhost/site_config.json")
seen = set()
for p in paths:
    if p in seen:
        continue
    seen.add(p)
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        print(p, "read_error", e)
        continue
    secret = str(d.get("onboard_hmac_secret") or "").strip()
    print(p)
    print("  onboard_base_url=", d.get("onboard_base_url"))
    print("  secret_set=", bool(secret), "secret_len=", len(secret))
if not seen:
    print("no site_config found")
PY

echo
echo "=== rfms portal base env ==="
cd /opt/health-ecosystem/docker
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv RFMS_PORTAL_BASE_URL || true
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv RFMS_PUBLIC_BASE_URL || true
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv RFMS_PUBLIC_ORIGIN || true

echo
echo "=== curl hec-session without token ==="
curl -sS -o /tmp/hec_no_token.txt -w "HTTP %{http_code} loc=%{redirect_url}\n" "https://www.e-remedium.in/onboard/hec-session" || true
head -c 300 /tmp/hec_no_token.txt; echo

echo
echo "=== curl /onboard/ ==="
curl -sS -o /tmp/onboard_idx.txt -w "HTTP %{http_code}\n" "https://www.e-remedium.in/onboard/" || true
grep -oE 'Franchise applicant portal|Select FOFO or FOCO|e-remedium' /tmp/onboard_idx.txt | sort -u | head

echo
echo "=== mint via bench (url host/path only) ==="
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T backend bash -lc '
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge._onboard_base_url
' 2>/dev/null || docker compose -f docker-compose.yml exec -T backend bash -lc '
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge._onboard_base_url
' || true
