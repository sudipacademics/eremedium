#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/cgpey-esign-payload}"
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
grep -q "smilecurelifestyle@gmail.com" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "franchise-agreement" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "trigger_esign_request: 2" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"

CID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs" "$CID:/app/apps/local-api/cgpey-kyc-adapter.mjs"
docker cp "$FFMS/apps/local-api/server.mjs" "$CID:/app/apps/local-api/server.mjs"
"${COMPOSE[@]}" restart rfms
sleep 8
code=$(curl -sS -o /tmp/rfms_health_esign_payload.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
echo "health:$code"
test "$code" = "200"
docker exec "$CID" grep -n "smilecurelifestyle@gmail.com\|franchise-agreement\|bottom-left\|trigger_esign_request: 2" /app/apps/local-api/cgpey-kyc-adapter.mjs | head
echo CGPEY_ESIGN_PAYLOAD_OK
