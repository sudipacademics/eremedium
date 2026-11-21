#!/bin/bash
# Deploy CRM tracking-tag APIs + Care/Aesthetic bill close hook.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-tracking}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
CARE=/opt/health-ecosystem/care_portal/server
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

cp -f "$SRC/api.py" "$HEC/api.py"
cp -f "$SRC/clinical_crm_tracking.py" "$HEC/clinical_crm_tracking.py"
grep -q "def record_crm_sales_close" "$HEC/api.py"
grep -q "def record_crm_sales_close" "$HEC/clinical_crm_tracking.py"

if [[ -f "$SRC/erp.mjs" ]]; then
  mkdir -p "$CARE"
  cp -f "$SRC/erp.mjs" "$CARE/erp.mjs"
  cp -f "$SRC/api.mjs" "$CARE/api.mjs"
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
./env/bin/python <<PY
from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import record_crm_sales_close, extract_crm_tag
from health_ecosystem_core.health_ecosystem_core.api import record_crm_sales_close as api_fn
assert extract_crm_tag("hello [CRM_TAG:CRM-SG-BK0001]") == "CRM-SG-BK0001"
print("CRM_TRACKING_IMPORT_OK")
PY
pkill -HUP -f gunicorn 2>/dev/null || true
'

# Restart Care / Aesthetic API containers if present (bill hook).
for svc in care-api aesthetic-api care aesthetic; do
  if "${COMPOSE[@]}" ps --services 2>/dev/null | grep -qx "$svc"; then
    "${COMPOSE[@]}" restart "$svc" || true
  fi
done

# Also copy into running care containers by common names.
for name in care-api aesthetic-api care_portal aesthetic_portal; do
  CID=$(docker ps -q -f "name=${name}" | head -1 || true)
  if [[ -n "${CID:-}" && -f "$CARE/api.mjs" ]]; then
    docker cp "$CARE/api.mjs" "$CID:/app/server/api.mjs" 2>/dev/null || docker cp "$CARE/api.mjs" "$CID:/app/api.mjs" 2>/dev/null || true
    docker cp "$CARE/erp.mjs" "$CID:/app/server/erp.mjs" 2>/dev/null || docker cp "$CARE/erp.mjs" "$CID:/app/erp.mjs" 2>/dev/null || true
    docker restart "$CID" >/dev/null || true
  fi
done

echo CRM_TRACKING_DEPLOY_OK
