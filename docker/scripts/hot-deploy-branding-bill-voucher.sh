#!/bin/bash
# Deploy branding vendor amount/bill + accountant payment vouchers.
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
if [[ -d "$SRC/local-api" ]]; then
  cp -f "$SRC/local-api/"*.mjs "$FFMS/apps/local-api/"
fi

echo "=== Verify API markers ==="
grep -q 'createBrandingPaymentVoucher' "$FFMS/apps/local-api/server.mjs"
grep -q 'payment-vouchers' "$FFMS/apps/local-api/server.mjs"
grep -q 'Submit total amount' "$FFMS/apps/admin-dashboard/app/page.tsx"
grep -q 'PaymentVouchersPanel' "$FFMS/apps/admin-dashboard/app/payment-operations.tsx"

echo "=== Rebuild rfms image ==="
"${COMPOSE[@]}" up -d --build rfms
sleep 15
for i in $(seq 1 40); do
  code=$(curl -sS -o /tmp/rfms_health_bbv.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health 2>/dev/null || echo 000)
  echo "health_try${i}:${code}"
  [[ "$code" == "200" ]] && break
  sleep 4
done
[[ "${code:-000}" == "200" ]] || { "${COMPOSE[@]}" logs --tail 50 rfms; exit 1; }

echo "=== Smoke markers in container ==="
CID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$CID" grep -c createBrandingPaymentVoucher /app/apps/local-api/server.mjs
docker exec "$CID" grep -c payment-vouchers /app/apps/local-api/server.mjs || true

echo "BRANDING_BILL_VOUCHER_DEPLOY_OK"
