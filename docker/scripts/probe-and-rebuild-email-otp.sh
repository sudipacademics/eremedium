#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

docker compose exec -T backend bash -lc '
curl -sS -o /tmp/email_otp.json -w "http=%{http_code}\n" \
  -X POST http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.send_email_otp \
  -H "Host: health.localhost" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=invalid"
head -c 600 /tmp/email_otp.json; echo
echo APP:
grep -n send_email_otp /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head
echo SP:
grep -n send_email_otp /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head
echo MSG91:
grep -n send_msg91_email_otp /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/clinical_msg91.py | head
'

# Ensure host files also exist under apps mount for future syncs
HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
grep -n send_email_otp "$HOST/otp_auth.py" | head || true

echo "=== rebuild rfms ==="
docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c sendEmailOtpViaErp /app/apps/local-api/hec-frappe-bridge.mjs
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c masked_email /app/apps/local-api/server.mjs
echo RFMS_DONE
