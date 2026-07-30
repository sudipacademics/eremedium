#!/bin/bash
# Phase 85b/85c hot deploy: territory capacity ops + paid→hub activation.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
HEC=/opt/health-ecosystem/health_ecosystem_core
SRC="${1:-/tmp/phase85}"

echo "=== Sync Phase 85 sources ==="
cp -f "$SRC/territory-capacity-workflow.mjs" "$FFMS/apps/local-api/territory-capacity-workflow.mjs"
cp -f "$SRC/hec-frappe-bridge.mjs" "$FFMS/apps/local-api/hec-frappe-bridge.mjs"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/payments-workflow.mjs" "$FFMS/apps/local-api/payments-workflow.mjs"
cp -f "$SRC/clinical_phase85_rfms_activation.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase85_rfms_activation.py"
cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
cp -f "$SRC/territory-capacity-ops.tsx" "$FFMS/apps/admin-dashboard/app/territory-capacity-ops.tsx"
cp -f "$SRC/territory-setup.tsx" "$FFMS/apps/admin-dashboard/app/territory-setup.tsx"
cp -f "$SRC/territory-setup.css" "$FFMS/apps/admin-dashboard/app/territory-setup.css"
cp -f "$SRC/payment-operations.tsx" "$FFMS/apps/admin-dashboard/app/payment-operations.tsx"
cp -f "$SRC/payment-operations.css" "$FFMS/apps/admin-dashboard/app/payment-operations.css"

CID=$("${COMPOSE[@]}" ps -q rfms)
[[ -n "$CID" ]] || { echo "rfms not running"; exit 1; }

echo "=== Hot-copy RFMS API modules ==="
docker cp "$FFMS/apps/local-api/territory-capacity-workflow.mjs" "$CID:/app/apps/local-api/territory-capacity-workflow.mjs"
docker cp "$FFMS/apps/local-api/hec-frappe-bridge.mjs" "$CID:/app/apps/local-api/hec-frappe-bridge.mjs"
docker cp "$FFMS/apps/local-api/server.mjs" "$CID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/payments-workflow.mjs" "$CID:/app/apps/local-api/payments-workflow.mjs"

echo "=== Hot-copy HEC activation module into backend apps tree ==="
BCID=$("${COMPOSE[@]}" ps -q backend)
if [[ -n "$BCID" ]]; then
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase85_rfms_activation.py" \
    "$BCID:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase85_rfms_activation.py" || true
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" \
    "$BCID:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py" || true
  # Prefer site-packages path used at runtime
  docker exec "$BCID" bash -lc '
    SP=$(python -c "import health_ecosystem_core,os; print(os.path.dirname(health_ecosystem_core.__file__))")
    mkdir -p "$SP/health_ecosystem_core"
    cp -f /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase85_rfms_activation.py "$SP/health_ecosystem_core/" || true
    cp -f /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py "$SP/health_ecosystem_core/" || true
  ' || true
  "${COMPOSE[@]}" restart backend
fi

echo "=== Restart rfms API ==="
"${COMPOSE[@]}" restart rfms
sleep 10
curl -sS -o /tmp/rfms_health_p85.json -w "health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true

if [[ "${REBUILD_UI:-1}" == "1" ]]; then
  echo "=== Rebuild RFMS admin UI ==="
  bash /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh
fi

echo "PHASE85_HOT_DEPLOY_DONE"
