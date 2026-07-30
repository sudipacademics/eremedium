#!/bin/bash
# Hot-deploy territory search UI (Overview + Territory Directory).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
SRC="${1:-/tmp/territory-search-ui}"

echo "=== Sync territory search sources ==="
cp -f "$SRC/overview-territory-availability.tsx" "$FFMS/apps/admin-dashboard/app/overview-territory-availability.tsx"
cp -f "$SRC/overview-territory-availability.css" "$FFMS/apps/admin-dashboard/app/overview-territory-availability.css"
cp -f "$SRC/territory-setup.tsx" "$FFMS/apps/admin-dashboard/app/territory-setup.tsx"
cp -f "$SRC/territory-setup.css" "$FFMS/apps/admin-dashboard/app/territory-setup.css"

grep -q 'Search territory, PIN, district' "$FFMS/apps/admin-dashboard/app/overview-territory-availability.tsx"
grep -q 'territory-directory-search' "$FFMS/apps/admin-dashboard/app/territory-setup.tsx"

echo "=== Rebuild RFMS admin static (maps key preserved) ==="
bash /opt/health-ecosystem/docker/scripts/rebuild-rfms-with-maps-key.sh

CID=$("${COMPOSE[@]}" ps -q rfms)
[[ -n "$CID" ]] || { echo "rfms not running after rebuild"; exit 1; }
sleep 8
curl -sS -o /tmp/rfms_health_ts.json -w "health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true

echo "=== Verify search strings baked into admin out/ ==="
if docker exec "$CID" sh -c 'grep -Rql "Search territory, PIN, district" /app/apps/admin-dashboard/out 2>/dev/null'; then
  echo TERRITORY_SEARCH_UI_OK
else
  echo TERRITORY_SEARCH_UI_MISS
  exit 1
fi

echo "TERRITORY_SEARCH_HOT_DEPLOY_DONE"
