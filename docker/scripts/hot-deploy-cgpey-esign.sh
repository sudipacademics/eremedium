#!/bin/bash
# Deploy CGPEY Aadhaar OTP Agreement Accept / eSign to live RFMS.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
SRC="${1:-/tmp/cgpey-esign}"

echo "=== Sync sources ==="
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/portal-page.tsx" "$FFMS/apps/franchise-portal/app/page.tsx"
cp -f "$SRC/portal.css" "$FFMS/apps/franchise-portal/app/portal.css"
cp -f "$SRC/docker-compose.ffms.yml" /opt/health-ecosystem/docker/docker-compose.ffms.yml
if [[ -d "$SRC/local-api" ]]; then
  cp -f "$SRC/local-api/"*.mjs "$FFMS/apps/local-api/"
fi

echo "=== Verify markers ==="
grep -q generateAadhaarOtp "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q 'esign/verify-otp' "$FFMS/apps/local-api/server.mjs"
grep -q 'agreement-otp-modal' "$FFMS/apps/franchise-portal/app/page.tsx"
grep -q RFMS_CGPEY_API_KEY /opt/health-ecosystem/docker/docker-compose.ffms.yml

echo "=== Env check (names only) ==="
if [[ -z "${RFMS_CGPEY_API_KEY:-}" ]] && ! grep -q '^RFMS_CGPEY_API_KEY=.\+' /opt/health-ecosystem/docker/.env 2>/dev/null; then
  echo "WARN: RFMS_CGPEY_API_KEY not set in shell or docker/.env — live OTP will use simulate-if-unconfigured behavior (cgpeySimulate=true when missing credentials)."
else
  echo "RFMS_CGPEY_API_KEY is present in environment or docker/.env"
fi

echo "=== Rebuild rfms ==="
"${COMPOSE[@]}" up -d --build rfms
sleep 12
code=000
for i in $(seq 1 45); do
  code=$(curl -sS -o /tmp/rfms_health_cgpey.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health 2>/dev/null || echo 000)
  echo "health_try${i}:${code}"
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 4
done
if [ "$code" != "200" ]; then
  "${COMPOSE[@]}" logs --tail 50 rfms
  exit 1
fi

curl -sS http://127.0.0.1:8090/api/v1/health | tee /tmp/rfms_health_cgpey_body.json
grep -q cgpey_aadhaar_otp /tmp/rfms_health_cgpey_body.json
echo
echo "CGPEY_ESIGN_DEPLOY_OK"
