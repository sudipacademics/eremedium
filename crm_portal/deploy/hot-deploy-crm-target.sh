#!/bin/bash
# Deploy CRM Target & Achievement (My Team targets + synced bill achievement).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-target}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
CRM_DIST=/opt/health-ecosystem/crm_portal/dist
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

cp -f "$SRC/api.py" "$HEC/api.py"
cp -f "$SRC/clinical_crm_tracking.py" "$HEC/clinical_crm_tracking.py"
cp -f "$SRC/clinical_people_my_team.py" "$HEC/clinical_people_my_team.py"
grep -q "get_crm_target_achievement" "$HEC/api.py"
grep -q "CRM Sales Target" "$HEC/clinical_crm_tracking.py"
grep -q "save_crm_sales_target_api" "$HEC/clinical_people_my_team.py"

WWW_PUBLICS=(
  /opt/health-ecosystem/people-addons
  /opt/health-ecosystem/health_web_app/public
  /opt/health-ecosystem/health_web_app
  /opt/health-ecosystem/health_web_app/dist
  /var/www/remediumlabs
  /var/www/www.remediumlabs.in
)
if [[ -f "$SRC/people-my-team.js" ]]; then
  for root in "${WWW_PUBLICS[@]}"; do
    if [[ -d "$root" ]]; then
      cp -f "$SRC/people-my-team.js" "$root/people-my-team.js"
      cp -f "$SRC/people-my-team.css" "$root/people-my-team.css"
      if [[ -f "$root/index.html" ]] && grep -q 'people-my-team' "$root/index.html"; then
        sed -i 's/people-my-team\.css?v=[0-9]*/people-my-team.css?v=3/' "$root/index.html" || true
        sed -i 's/people-my-team\.js?v=[0-9]*/people-my-team.js?v=3/' "$root/index.html" || true
      fi
      echo "Updated My Team CRM target UI in $root"
    fi
  done
  grep -q "data-save-crm-target" "$WEB/public/people-my-team.js" 2>/dev/null || grep -q "data-save-crm-target" "$WEB/people-my-team.js"
fi

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
  echo "Updated CRM dist in $CRM_DIST"
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
docker cp "$HEC/api.py" "$BCID:$APPS_PKG/api.py"
docker cp "$HEC/clinical_crm_tracking.py" "$BCID:$APPS_PKG/clinical_crm_tracking.py"
docker cp "$HEC/clinical_people_my_team.py" "$BCID:$APPS_PKG/clinical_people_my_team.py"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/api.py" "$SP/api.py"
cp -f "$APPS/clinical_crm_tracking.py" "$SP/clinical_crm_tracking.py"
cp -f "$APPS/clinical_people_my_team.py" "$SP/clinical_people_my_team.py"
./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core import clinical_crm_tracking as t
from health_ecosystem_core.health_ecosystem_core import clinical_people_my_team as m
from health_ecosystem_core.health_ecosystem_core import api as a
assert callable(t.get_crm_target_achievement)
assert callable(t.set_crm_sales_target)
assert callable(m.save_crm_sales_target_api)
assert callable(a.get_crm_target_achievement)
print("CRM_TARGET_IMPORT_OK")
PY
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking.ensure_crm_sales_target_doctype
echo CRM_TARGET_DOCTYPE_OK
bench --site health.localhost clear-cache || true
pkill -HUP -f gunicorn 2>/dev/null || true
'

echo CRM_TARGET_DEPLOY_OK
