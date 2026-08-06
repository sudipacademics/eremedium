#!/bin/bash
# Hot-deploy Assign Lead fix: all active FFMS leads + ERP upsert on REACH assign.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/assign-lead-fix}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
HEC=/opt/health-ecosystem/health_ecosystem_core
SITE="${SITE:-health.localhost}"

echo "=== Sync sources ==="
mkdir -p "$FFMS/apps/local-api" "$FFMS/apps/admin-dashboard/app" \
  "$HEC/health_ecosystem_core/health_ecosystem_core"

[[ -f "$SRC/server.mjs" ]] && cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
[[ -f "$SRC/hec-frappe-bridge.mjs" ]] && cp -f "$SRC/hec-frappe-bridge.mjs" "$FFMS/apps/local-api/hec-frappe-bridge.mjs"
[[ -f "$SRC/leads-ads-workflow.mjs" ]] && cp -f "$SRC/leads-ads-workflow.mjs" "$FFMS/apps/local-api/leads-ads-workflow.mjs"
[[ -f "$SRC/log-visit-directory.tsx" ]] && cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
[[ -f "$SRC/clinical_phase25.py" ]] && cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"

RCID=$("${COMPOSE[@]}" ps -q rfms)
BCID=$("${COMPOSE[@]}" ps -q backend)
[[ -n "$RCID" ]] || { echo "rfms not running"; exit 1; }
[[ -n "$BCID" ]] || { echo "backend not running"; exit 1; }

echo "=== Hot-copy RFMS API modules ==="
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/hec-frappe-bridge.mjs" "$RCID:/app/apps/local-api/hec-frappe-bridge.mjs"
docker cp "$FFMS/apps/local-api/leads-ads-workflow.mjs" "$RCID:/app/apps/local-api/leads-ads-workflow.mjs"

echo "=== Hot-copy HEC Python ==="
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core
docker exec "$BCID" mkdir -p "$APPS_PKG" "$SP_PKG"
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py" "$BCID:$TARGET/clinical_phase25.py"
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$TARGET/api.py"
done
docker exec "$BCID" bash -lc "find $APPS_PKG $SP_PKG -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true"

echo "=== Restart rfms + clear ERP cache ==="
"${COMPOSE[@]}" restart rfms
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
sleep 8

echo "=== Verify markers ==="
docker exec "$RCID" sh -lc 'grep -n "TERMINAL_LEAD_STAGES\|ensure_franchise_sales_lead\|lead_json\|all active CRM lead" /app/apps/local-api/server.mjs /app/apps/local-api/hec-frappe-bridge.mjs 2>/dev/null | head -20'
docker exec "$BCID" bash -lc "grep -n 'ensure_franchise_sales_lead_from_ffms' $APPS_PKG/clinical_phase25.py | head -5"

if [[ "${REBUILD_UI:-1}" == "1" ]] && [[ -f /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh ]]; then
  echo "=== Rebuild RFMS admin UI (Assign Lead copy) ==="
  bash /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh || true
fi

curl -sS -o /dev/null -w "rfms_health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true
echo ASSIGN_LEAD_FIX_OK
