#!/bin/bash
# Deploy REACH→FFMS lead sync + Admin Log Visit module.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/reach-ffms-lead-sync}"
HEC=/opt/health-ecosystem/health_ecosystem_core
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

mkdir -p "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$FFMS/apps/local-api" \
  "$FFMS/apps/admin-dashboard/app" \
  "$FFMS/packages/utils"

[[ -f "$SRC/clinical_phase25.py" ]] && cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
[[ -f "$SRC/server.mjs" ]] && cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
[[ -f "$SRC/leads-ads-workflow.mjs" ]] && cp -f "$SRC/leads-ads-workflow.mjs" "$FFMS/apps/local-api/leads-ads-workflow.mjs"
[[ -f "$SRC/admin-rbac.ts" ]] && cp -f "$SRC/admin-rbac.ts" "$FFMS/packages/utils/admin-rbac.ts"
[[ -f "$SRC/page.tsx" ]] && cp -f "$SRC/page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"
[[ -f "$SRC/log-visit-directory.tsx" ]] && cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
[[ -f "$SRC/log-visit-directory.css" ]] && cp -f "$SRC/log-visit-directory.css" "$FFMS/apps/admin-dashboard/app/log-visit-directory.css"

grep -q "_sync_sales_lead_to_rfms" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
grep -q "sales-visits/ingest" "$FFMS/apps/local-api/server.mjs"
grep -q "Log Visit" "$FFMS/packages/utils/admin-rbac.ts"
grep -q "LogVisitDirectory" "$FFMS/apps/admin-dashboard/app/page.tsx"

echo "=== Hot-copy ERP ==="
BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG="/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py" "$BCID:$APPS_PKG/clinical_phase25.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$APPS_PKG/api.py"
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/clinical_phase25.py" "$SP/clinical_phase25.py"
cp -f "$APPS/api.py" "$SP/api.py"
./env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import _sync_sales_lead_to_rfms as f; print(\"ok\")"
'
"${COMPOSE[@]}" restart backend

echo "=== Hot-copy RFMS + rebuild admin ==="
RCID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/leads-ads-workflow.mjs" "$RCID:/app/apps/local-api/leads-ads-workflow.mjs"
docker cp "$FFMS/packages/utils/admin-rbac.ts" "$RCID:/app/packages/utils/admin-rbac.ts"
docker cp "$FFMS/apps/admin-dashboard/app/page.tsx" "$RCID:/app/apps/admin-dashboard/app/page.tsx"
docker cp "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.tsx"
docker cp "$FFMS/apps/admin-dashboard/app/log-visit-directory.css" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.css"

# Rebuild admin static if the image builds from source; otherwise restart is enough for API.
"${COMPOSE[@]}" restart rfms
sleep 10
curl -sS -o /tmp/rfms_health_lead.json -w "health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true

# Prefer rebuild so admin UI picks up Log Visit page
if [[ "${RFMS_REBUILD:-1}" == "1" ]]; then
  echo "=== Rebuild rfms image for admin UI ==="
  "${COMPOSE[@]}" up -d --build rfms
  for i in $(seq 1 60); do
    code=$(curl -sS -o /tmp/rfms_health_lead.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
    [[ "$code" == "200" ]] && break
    sleep 3
  done
fi

echo REACH_FFMS_LEAD_SYNC_DEPLOY_OK
