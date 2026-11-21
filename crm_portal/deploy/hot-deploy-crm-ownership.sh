#!/bin/bash
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-ownership}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
CRM_DIST=/opt/health-ecosystem/crm_portal/dist
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

cp -f "$SRC/api.py" "$HEC/api.py"
cp -f "$SRC/clinical_crm_tracking.py" "$HEC/clinical_crm_tracking.py"
grep -q "def transfer_crm_ownership" "$HEC/api.py"
grep -q "def transfer_crm_ownership" "$HEC/clinical_crm_tracking.py"
grep -q "CRM Ownership" "$HEC/clinical_crm_tracking.py"

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
docker cp "$HEC/api.py" "$BCID:$APPS_PKG/api.py"
docker cp "$HEC/clinical_crm_tracking.py" "$BCID:$APPS_PKG/clinical_crm_tracking.py"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/api.py" "$SP/api.py"
cp -f "$APPS/clinical_crm_tracking.py" "$SP/clinical_crm_tracking.py"
./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core import api as a
from health_ecosystem_core.health_ecosystem_core import clinical_crm_tracking as t
assert hasattr(a, "transfer_crm_ownership") and hasattr(a, "list_crm_ownership")
assert hasattr(t, "transfer_crm_ownership") and hasattr(t, "list_crm_ownership")
print("CRM_OWNERSHIP_IMPORT_OK")
PY
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking.ensure_crm_ownership_doctype
bench --site health.localhost clear-cache || true
'

"${COMPOSE[@]}" restart backend
sleep 8
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking.list_crm_ownership
'

echo CRM_OWNERSHIP_DEPLOY_OK
