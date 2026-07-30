#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
SITE=health.localhost
SRC=/tmp/phase85
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
BCID=$("${COMPOSE[@]}" ps -q backend)
docker cp "$SRC/clinical_phase85_rfms_activation.py" "$BCID:$APPS_PKG/clinical_phase85_rfms_activation.py"
docker cp "$SRC/api.py" "$BCID:$APPS_PKG/api.py"
"${COMPOSE[@]}" exec -T backend bash -lc 'cd /home/frappe/frappe-bench; APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core; SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))"); cp -f "$APPS/clinical_phase85_rfms_activation.py" "$SP/clinical_phase85_rfms_activation.py"; cp -f "$APPS/api.py" "$SP/api.py"; ./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_phase85_rfms_activation as m; print(\"import_ok\", m.__file__)"; ./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as a; print(\"activate_ok\", hasattr(a, \"activate_rfms_paid_franchisee\"))"'
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
"${COMPOSE[@]}" restart backend
sleep 15
bash /opt/health-ecosystem/docker/scripts/smoke-phase85b-capacity.sh
RCID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$RCID" sh -c 'grep -Rql "Capacity operations" /app/apps/admin-dashboard/out && echo CAPACITY_UI_OK'
docker exec "$RCID" sh -c 'grep -c maybeActivateFranchiseeHub /app/apps/local-api/server.mjs'
docker exec "$RCID" sh -c 'grep -c territories/capacities /app/apps/local-api/server.mjs'
curl -sS -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8090/api/v1/health || true
echo PHASE85_HEC_FIX_DONE
