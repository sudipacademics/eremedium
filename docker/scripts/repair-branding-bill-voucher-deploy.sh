#!/bin/bash
# Repair branding bill/voucher deploy after empty agreement-workflow race.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
SRC="${1:-/tmp/branding-bill-voucher}"

echo "=== Sync sources ==="
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/admin-page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"
cp -f "$SRC/payment-operations.tsx" "$FFMS/apps/admin-dashboard/app/payment-operations.tsx"
cp -f "$SRC/local-api/"*.mjs "$FFMS/apps/local-api/"

echo "=== Verify file sizes ==="
wc -c "$FFMS/apps/local-api/agreement-workflow.mjs" "$FFMS/apps/local-api/server.mjs"
test -s "$FFMS/apps/local-api/agreement-workflow.mjs"
grep -q 'export const AGREEMENT_TEMPLATE_FOCO' "$FFMS/apps/local-api/agreement-workflow.mjs"
grep -q createBrandingPaymentVoucher "$FFMS/apps/local-api/server.mjs"
grep -q 'Submit total amount' "$FFMS/apps/admin-dashboard/app/page.tsx"
grep -q PaymentVouchersPanel "$FFMS/apps/admin-dashboard/app/payment-operations.tsx"

echo "=== Rebuild rfms ==="
"${COMPOSE[@]}" up -d --build rfms
sleep 12
code=000
for i in $(seq 1 45); do
  code=$(curl -sS -o /tmp/rfms_health_bbv2.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health 2>/dev/null || echo 000)
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

CID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$CID" grep -c createBrandingPaymentVoucher /app/apps/local-api/server.mjs
docker exec "$CID" grep -c 'export const AGREEMENT_TEMPLATE_FOCO' /app/apps/local-api/agreement-workflow.mjs
echo "BRANDING_BILL_VOUCHER_DEPLOY_OK"
