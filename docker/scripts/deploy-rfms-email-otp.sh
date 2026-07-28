#!/bin/bash
# Hot-copy MSG91 email OTP modules into running backend apps path and rebuild RFMS.
set -euo pipefail
cd /opt/health-ecosystem/docker
HOST_DIR=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core

APP_DIR="$(docker compose exec -T backend bash -lc 'find /home/frappe/frappe-bench/apps/health_ecosystem_core -name otp_auth.py | head -1' | tr -d '\r')"
APP_DIR="$(dirname "$APP_DIR")"
echo "APP_DIR=$APP_DIR"
test -n "$APP_DIR"
test -f "$HOST_DIR/otp_auth.py"
test -f "$HOST_DIR/clinical_msg91.py"

docker cp "$HOST_DIR/otp_auth.py" "docker-backend-1:$APP_DIR/otp_auth.py"
docker cp "$HOST_DIR/clinical_msg91.py" "docker-backend-1:$APP_DIR/clinical_msg91.py"
docker cp "$HOST_DIR/clinical_secrets.py" "docker-backend-1:$APP_DIR/clinical_secrets.py"
docker cp "$HOST_DIR/api.py" "docker-backend-1:$APP_DIR/api.py"
# Settings DocType (optional migrate later)
if [ -f "$HOST_DIR/doctype/health_ecosystem_settings/health_ecosystem_settings.json" ]; then
  docker cp "$HOST_DIR/doctype/health_ecosystem_settings/health_ecosystem_settings.json" \
    "docker-backend-1:$APP_DIR/doctype/health_ecosystem_settings/health_ecosystem_settings.json" || true
fi

docker compose restart backend
sleep 12

echo "=== probe send_email_otp (expect validation or success envelope) ==="
curl -sS -o /tmp/email_otp.json -w "http=%{http_code}\n" \
  -X POST "http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.send_email_otp" \
  -H "Host: health.localhost" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=invalid"
head -c 400 /tmp/email_otp.json; echo

docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
echo RFMS_DONE
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c sendEmailOtpViaErp /app/apps/local-api/hec-frappe-bridge.mjs
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c 'channel: .email' /app/apps/local-api/server.mjs || true
