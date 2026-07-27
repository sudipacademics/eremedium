#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
HOST_DIR=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core

APP_DIR="$(docker compose exec -T backend bash -lc 'find /home/frappe/frappe-bench/apps/health_ecosystem_core -name otp_auth.py | head -1' | tr -d '\r')"
APP_DIR="$(dirname "$APP_DIR")"
echo "APP_DIR=$APP_DIR"
test -n "$APP_DIR"
test -f "$HOST_DIR/otp_auth.py"
docker cp "$HOST_DIR/otp_auth.py" "docker-backend-1:$APP_DIR/otp_auth.py"
docker cp "$HOST_DIR/api.py" "docker-backend-1:$APP_DIR/api.py"
docker compose restart backend
sleep 14

curl -sS -o /tmp/otp.json -w "otp_http=%{http_code}\n" \
  -X POST "http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.verify_otp" \
  -H "Host: health.localhost" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "mobile=9000000000&otp=000000"
head -c 500 /tmp/otp.json; echo

docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
echo RFMS_DONE
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv RFMS_OTP_VIA_ERP FRAPPE_API_BASE_URL
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c sendOtpViaErp /app/apps/local-api/hec-frappe-bridge.mjs
