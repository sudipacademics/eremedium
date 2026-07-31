#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/cgpey-redirect-flow}"
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/page.tsx" "$FFMS/apps/franchise-portal/app/page.tsx"

grep -q "buildEsignReturnUrl" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "redirect_same_tab" "$FFMS/apps/local-api/server.mjs"
grep -q "location.assign(signingUrl)" "$FFMS/apps/franchise-portal/app/page.tsx"
grep -q "esign_return" "$FFMS/apps/franchise-portal/app/page.tsx"
grep -q "public/esign/return" "$FFMS/apps/local-api/server.mjs"

echo "=== rebuild rfms ==="
"${COMPOSE[@]}" up -d --build rfms
code=000
for i in $(seq 1 60); do
  code=$(curl -sS -o /tmp/rfms_health_esign_redirect.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  echo "health_try${i}:${code}"
  [[ "$code" == "200" ]] && break
  sleep 4
done
[[ "$code" == "200" ]] || { "${COMPOSE[@]}" logs --tail 120 rfms; exit 1; }

CID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$CID" node --input-type=module <<'NODE'
import { buildEsignReturnUrl } from '/app/apps/local-api/cgpey-kyc-adapter.mjs';
const returnUrl = buildEsignReturnUrl({
  portalBaseUrl: 'https://www.e-remedium.in/onboard',
  referenceDocId: 'RFMS-1',
  applicationNumber: 'RFMS-2026-0001',
});
if (!/esign_return=1/.test(returnUrl) || !/section=agreement/.test(returnUrl) || !/view=profile/.test(returnUrl)) {
  console.error('RETURN_URL_BAD', returnUrl);
  process.exit(1);
}
console.log(JSON.stringify({ returnUrl_ok: true, returnUrl }));
NODE

docker exec "$CID" sh -lc 'grep -R "location.assign(signingUrl)\|esign_return" /app/apps/franchise-portal/out /app/apps/franchise-portal/app/page.tsx 2>/dev/null | head -8'
curl -sS -o /tmp/esign_return_cb.txt -w "callback:%{http_code}:%{redirect_url}\n" -D - "http://127.0.0.1:8090/api/v1/public/esign/return?application=RFMS-TEST" | head -20

echo CGPEY_REDIRECT_FLOW_OK
