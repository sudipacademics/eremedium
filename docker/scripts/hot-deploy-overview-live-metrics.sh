#!/bin/bash
# Hot-deploy FFMS Overview live metrics fix.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/overview-fix}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms

echo "=== Sync sources ==="
mkdir -p "$FFMS/apps/local-api" "$FFMS/apps/admin-dashboard/app"
[[ -f "$SRC/overview-dashboard-workflow.mjs" ]] && cp -f "$SRC/overview-dashboard-workflow.mjs" "$FFMS/apps/local-api/overview-dashboard-workflow.mjs"
[[ -f "$SRC/server.mjs" ]] && cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
[[ -f "$SRC/page.tsx" ]] && cp -f "$SRC/page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"

RCID=$("${COMPOSE[@]}" ps -q rfms)
[[ -n "$RCID" ]] || { echo "rfms not running"; exit 1; }

echo "=== Hot-copy RFMS API ==="
docker cp "$FFMS/apps/local-api/overview-dashboard-workflow.mjs" "$RCID:/app/apps/local-api/overview-dashboard-workflow.mjs"
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
"${COMPOSE[@]}" restart rfms
sleep 8

echo "=== Verify API markers ==="
docker exec "$RCID" sh -lc 'grep -n "admin/overview\|buildAdminOverview\|TERMINAL_LEAD_STAGES" /app/apps/local-api/server.mjs | head -10'
docker exec "$RCID" sh -lc 'test -f /app/apps/local-api/overview-dashboard-workflow.mjs && echo OVERVIEW_MODULE_OK'

if [[ "${REBUILD_UI:-1}" == "1" ]] && [[ -f /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh ]]; then
  echo "=== Rebuild admin UI ==="
  bash /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh
fi

curl -sS -o /dev/null -w "rfms_health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true
echo OVERVIEW_LIVE_METRICS_OK
