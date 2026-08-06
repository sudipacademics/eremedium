#!/bin/bash
# Cursor Modification — Stage 1: HEC bridge + FFMS local-api only (no UI rebuild).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/cursor-mod-stage1}"
HEC=/opt/health-ecosystem/health_ecosystem_core
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

echo "=== Stage 1: sync host trees ==="
mkdir -p \
  "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$FFMS/apps/local-api" \
  "$FFMS/packages/utils"

cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/hec-frappe-bridge.mjs" "$FFMS/apps/local-api/hec-frappe-bridge.mjs"
cp -f "$SRC/hard-delete-workflow.mjs" "$FFMS/apps/local-api/hard-delete-workflow.mjs"
cp -f "$SRC/franchise-deboard-workflow.mjs" "$FFMS/apps/local-api/franchise-deboard-workflow.mjs"
cp -f "$SRC/b2b-operations-workflow.mjs" "$FFMS/apps/local-api/b2b-operations-workflow.mjs"
cp -f "$SRC/admin-users-workflow.mjs" "$FFMS/apps/local-api/admin-users-workflow.mjs"
cp -f "$SRC/franchisee-directory-workflow.mjs" "$FFMS/apps/local-api/franchisee-directory-workflow.mjs"
cp -f "$SRC/admin-rbac.ts" "$FFMS/packages/utils/admin-rbac.ts"

echo "=== Stage 1: hot-copy ERP backend ==="
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
./env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_archive_reach_lead, ffms_deboard_franchisee; print(\"hec_stage1_ok\")"
'
"${COMPOSE[@]}" restart backend

echo "=== Stage 1: hot-copy RFMS API (no rebuild) ==="
RCID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/hec-frappe-bridge.mjs" "$RCID:/app/apps/local-api/hec-frappe-bridge.mjs"
docker cp "$FFMS/apps/local-api/hard-delete-workflow.mjs" "$RCID:/app/apps/local-api/hard-delete-workflow.mjs"
docker cp "$FFMS/apps/local-api/franchise-deboard-workflow.mjs" "$RCID:/app/apps/local-api/franchise-deboard-workflow.mjs"
docker cp "$FFMS/apps/local-api/b2b-operations-workflow.mjs" "$RCID:/app/apps/local-api/b2b-operations-workflow.mjs"
docker cp "$FFMS/apps/local-api/admin-users-workflow.mjs" "$RCID:/app/apps/local-api/admin-users-workflow.mjs"
docker cp "$FFMS/apps/local-api/franchisee-directory-workflow.mjs" "$RCID:/app/apps/local-api/franchisee-directory-workflow.mjs"
"${COMPOSE[@]}" restart rfms
sleep 8

echo "=== Stage 1 verify ==="
docker exec "$RCID" sh -lc 'grep -n "hard-delete-workflow\|franchise-deboard\|b2b-operations\|/admin/franchisees/.*/deboard\|/b2b-centres/ingest" /app/apps/local-api/server.mjs | head -20'
curl -sS -o /dev/null -w "rfms_api:%{http_code}\n" http://127.0.0.1:8090/api/v1/health 2>/dev/null || \
  curl -sS -o /dev/null -w "rfms_leads:%{http_code}\n" http://127.0.0.1:8090/api/v1/leads || true

echo "CURSOR_MOD_STAGE1_OK"
