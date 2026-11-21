#!/bin/bash
# Fix Target & Achievement synced-bill count (match CRM-XX tags + portal closes).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-target-fix}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
CARE=/opt/health-ecosystem/care_portal/server
CRM_DIST=/opt/health-ecosystem/crm_portal/dist
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

cp -f "$SRC/clinical_crm_tracking.py" "$HEC/clinical_crm_tracking.py"
cp -f "$SRC/api.mjs" "$CARE/api.mjs"
grep -q "tracking tag CRM-SG" "$HEC/clinical_crm_tracking.py" || grep -q 'tag.startswith("CRM-")' "$HEC/clinical_crm_tracking.py"
grep -q "executive_code" "$CARE/api.mjs"

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
docker cp "$HEC/clinical_crm_tracking.py" "$BCID:$APPS_PKG/clinical_crm_tracking.py"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/clinical_crm_tracking.py" "$SP/clinical_crm_tracking.py"
./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import achievement_from_closes, extract_crm_tag
assert extract_crm_tag("hello [CRM_TAG:CRM-SG-BK0004]") == "CRM-SG-BK0004"
assert callable(achievement_from_closes)
print("CRM_TARGET_FIX_IMPORT_OK")
PY
pkill -HUP -f gunicorn 2>/dev/null || true
'

systemctl restart care-api aes-api
sleep 2
systemctl is-active care-api aes-api

echo CRM_TARGET_FIX_DEPLOY_OK
