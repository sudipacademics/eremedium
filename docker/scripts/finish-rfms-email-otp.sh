#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

echo "=== wait for backend ==="
for i in $(seq 1 24); do
  code=$(curl -sS -o /tmp/email_otp.json -w '%{http_code}' \
    -X POST 'http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.send_email_otp' \
    -H 'Host: health.localhost' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d 'email=invalid' || true)
  echo "try=$i http=$code"
  if [[ "$code" =~ ^[0-9]{3}$ ]] && [[ "$code" != "000" ]]; then
    break
  fi
  sleep 5
done
echo "=== body ==="
head -c 600 /tmp/email_otp.json; echo

echo "=== source markers ==="
grep -n 'def send_email_otp' /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head
docker compose exec -T backend bash -lc 'grep -n "def send_email_otp" /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head'
docker compose exec -T backend bash -lc 'grep -n "send_msg91_email_otp" /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_msg91.py | head'

echo "=== rebuild rfms ==="
docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c sendEmailOtpViaErp /app/apps/local-api/hec-frappe-bridge.mjs
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c "masked_email" /app/apps/local-api/server.mjs
echo RFMS_DONE
