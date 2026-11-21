#!/bin/bash
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-portal-assignees}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
CRM_DIST=/opt/health-ecosystem/crm_portal/dist
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

cp -f "$SRC/api.py" "$HEC/api.py"
grep -q "def _list_crm_portal_assignees_rows" "$HEC/api.py"
grep -q "def list_crm_portal_assignees" "$HEC/api.py"

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
docker cp "$HEC/api.py" "$BCID:$APPS_PKG/api.py"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/api.py" "$SP/api.py"
./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core import api as a
assert hasattr(a, "_list_crm_portal_assignees_rows")
assert callable(a.list_crm_portal_assignees)
print("CRM_PORTAL_ASSIGNEES_API_OK", a.__file__)
PY
bench --site health.localhost clear-cache || true
# Force workers to drop cached api module
pkill -f "gunicorn|frappe serve|frappe.utils.bench_helper" 2>/dev/null || true
sleep 1
'
# Restart backend container so gunicorn reloads api.py
"${COMPOSE[@]}" restart backend
sleep 8
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.api._list_crm_portal_assignees_rows
'

echo CRM_PORTAL_ASSIGNEES_DEPLOY_OK
