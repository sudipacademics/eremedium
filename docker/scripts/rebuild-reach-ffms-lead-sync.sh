#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
SRC=/tmp/reach-ffms-lead-sync
FFMS=/opt/health-ecosystem/apps_external/ffms

mkdir -p "$FFMS/apps/local-api" "$FFMS/apps/admin-dashboard/app" "$FFMS/packages/utils"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/leads-ads-workflow.mjs" "$FFMS/apps/local-api/leads-ads-workflow.mjs"
cp -f "$SRC/admin-rbac.ts" "$FFMS/packages/utils/admin-rbac.ts"
cp -f "$SRC/page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"
cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
cp -f "$SRC/log-visit-directory.css" "$FFMS/apps/admin-dashboard/app/log-visit-directory.css"

grep -q 'sales-visits/ingest' "$FFMS/apps/local-api/server.mjs"
grep -q 'LogVisitDirectory' "$FFMS/apps/admin-dashboard/app/page.tsx"
grep -q 'Log Visit' "$FFMS/packages/utils/admin-rbac.ts"

echo "=== Rebuild rfms image ==="
"${COMPOSE[@]}" up -d --build rfms
for i in $(seq 1 90); do
  code=$(curl -sS -o /tmp/rfms_health_lead3.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  if [[ "$code" == "200" ]]; then
    echo "health:200 after ${i} tries"
    break
  fi
  sleep 4
done

RCID=$("${COMPOSE[@]}" ps -q rfms)
# Ensure runtime API has latest even if build used cache oddly
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/leads-ads-workflow.mjs" "$RCID:/app/apps/local-api/leads-ads-workflow.mjs"
"${COMPOSE[@]}" restart rfms
sleep 8
curl -sS -o /tmp/rfms_health_lead4.json -w "health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health
docker exec "$("${COMPOSE[@]}" ps -q rfms)" grep -c 'sales-visits/ingest' /app/apps/local-api/server.mjs
# Static admin out should include Log Visit after rebuild
docker exec "$("${COMPOSE[@]}" ps -q rfms)" sh -c 'grep -R "Log Visit" /app/apps/admin-dashboard/out 2>/dev/null | head -3 || true'
echo REACH_FFMS_REBUILD_OK
