#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
SRC=/tmp/reach-ffms-lead-sync
FFMS=/opt/health-ecosystem/apps_external/ffms
RCID=$("${COMPOSE[@]}" ps -q rfms)

docker cp "$SRC/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$SRC/leads-ads-workflow.mjs" "$RCID:/app/apps/local-api/leads-ads-workflow.mjs"
docker cp "$SRC/admin-rbac.ts" "$RCID:/app/packages/utils/admin-rbac.ts"
mkdir -p "$FFMS/apps/admin-dashboard/app"
cp -f "$SRC/page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"
cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
cp -f "$SRC/log-visit-directory.css" "$FFMS/apps/admin-dashboard/app/log-visit-directory.css"
docker cp "$SRC/page.tsx" "$RCID:/app/apps/admin-dashboard/app/page.tsx"
docker cp "$SRC/log-visit-directory.tsx" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.tsx"
docker cp "$SRC/log-visit-directory.css" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.css"

docker exec "$RCID" grep -c 'sales-visits/ingest' /app/apps/local-api/server.mjs
docker exec "$RCID" grep -c 'LogVisitDirectory' /app/apps/admin-dashboard/app/page.tsx

echo "=== Rebuild rfms for admin UI ==="
"${COMPOSE[@]}" up -d --build rfms
for i in $(seq 1 80); do
  code=$(curl -sS -o /tmp/rfms_health_lead2.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  if [[ "$code" == "200" ]]; then
    echo "health:200"
    break
  fi
  sleep 3
done
docker exec "$("${COMPOSE[@]}" ps -q rfms)" grep -c 'sales-visits/ingest' /app/apps/local-api/server.mjs || true
echo REACH_FFMS_FINISH_OK
