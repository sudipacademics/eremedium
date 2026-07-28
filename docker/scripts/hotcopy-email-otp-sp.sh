#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
APP=$(docker compose exec -T backend bash -lc 'dirname "$(find /home/frappe/frappe-bench/apps/health_ecosystem_core -name otp_auth.py | head -1)"' | tr -d '\r')
SP=$(docker compose exec -T backend bash -lc 'dirname "$(find /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core -name otp_auth.py | head -1)"' | tr -d '\r')
echo "APP=$APP"
echo "SP=$SP"
test -n "$APP"
test -n "$SP"

for f in otp_auth.py clinical_msg91.py clinical_secrets.py api.py; do
  test -f "$HOST/$f"
  docker cp "$HOST/$f" "docker-backend-1:$APP/$f"
  docker cp "$HOST/$f" "docker-backend-1:$SP/$f"
  echo "copied $f"
done

docker compose restart backend
sleep 15

docker compose exec -T backend bash -lc '
curl -sS -o /tmp/email_otp.json -w "http=%{http_code}\n" \
  -X POST http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.otp_auth.send_email_otp \
  -H "Host: health.localhost" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=not-an-email"
head -c 500 /tmp/email_otp.json; echo
grep -n "def send_email_otp" /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/otp_auth.py | head
grep -n "def send_msg91_email_otp" /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/clinical_msg91.py | head
'
echo SYNC_OK
