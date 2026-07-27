#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

# Wait for backend gunicorn
for i in $(seq 1 20); do
  if docker compose exec -T backend bash -lc 'curl -sS -o /tmp/otp.json -w "%{http_code}" -X POST http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.verify_otp -H "Host: health.localhost" -H "Content-Type: application/x-www-form-urlencoded" -d "mobile=9000000000&otp=000000"' | tee /tmp/otp_code.txt | grep -Eq '^[0-9]+$'; then
    CODE=$(tr -d '\r' </tmp/otp_code.txt)
    echo "otp_http=$CODE"
    docker compose exec -T backend bash -lc 'head -c 500 /tmp/otp.json; echo'
    break
  fi
  echo "waiting backend... $i"
  sleep 3
done

grep -n "def verify_otp" /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head
docker compose exec -T backend bash -lc 'grep -n "def verify_otp" /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head'

docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
echo RFMS_DONE
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv RFMS_OTP_VIA_ERP FRAPPE_API_BASE_URL
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c sendOtpViaErp /app/apps/local-api/hec-frappe-bridge.mjs
