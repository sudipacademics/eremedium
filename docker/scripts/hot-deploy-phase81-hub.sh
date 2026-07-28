#!/bin/bash
# Phase 81 hot deploy — skip full migrate (hec_job_application_education drift).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
SITE="${FRAPPE_SITE:-health.localhost}"

echo "=== Hot-copy Phase 81 modules apps -> site-packages ==="
docker compose exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
for f in clinical_franchisee_import.py api.py init.py; do
  cp -f "$APPS/$f" "$SP/$f"
  echo "synced $f"
done
cp -f "$APPS/doctype/franchisee_profile/franchisee_profile.json" "$SP/doctype/franchisee_profile/franchisee_profile.json"
cp -f "$APPS/doctype/franchisee_profile/franchisee_profile.py" "$SP/doctype/franchisee_profile/franchisee_profile.py"
echo "synced franchisee_profile"
./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_franchisee_import as m; print(\"import_ok\", m.__file__)"
'

echo "=== Reload Franchisee Profile only ==="
docker compose exec -T backend bash -lc "
cd /home/frappe/frappe-bench
bench --site $SITE execute frappe.modules.utils.reload_doc --kwargs \"{'module':'Health Ecosystem Core','dt':'DocType','dn':'Franchisee Profile','force':1}\"
bench --site $SITE clear-cache
"

echo "=== Restart backend ==="
docker compose restart backend
sleep 18

if [ -f /tmp/franchise-sheet.csv ]; then
  echo "=== Import sheet (geocode off for speed; re-run with GEOCODE=1 later) ==="
  GEOCODE=0 bash /opt/health-ecosystem/docker/import-franchise-sheet.sh /tmp/franchise-sheet.csv
else
  echo "WARN: no /tmp/franchise-sheet.csv"
fi

echo "=== Smoke search_franchisees ==="
curl -sS -o /tmp/search.json -w "search:%{http_code}\n" \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.search_franchisees" \
  -H "X-Frappe-Site-Name: $SITE" || true
head -c 600 /tmp/search.json; echo

echo "PHASE81_HOT_DEPLOY_DONE"
