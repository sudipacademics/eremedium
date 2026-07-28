#!/bin/bash
# Phase 81 — deploy Franchisee Hub profile fields + sheet import (no full reset).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

ROOT=/opt/health-ecosystem
HEC="$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
cd "$ROOT/docker"
SITE="${FRAPPE_SITE:-health.localhost}"

echo "=== Verify staged files on host ==="
test -f "$HEC/clinical_franchisee_import.py"
test -f "$HEC/doctype/franchisee_profile/franchisee_profile.json"
test -f import-franchise-sheet.sh

echo "=== Pip force-reinstall health_ecosystem_core from apps mount ==="
docker compose exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_franchisee_import as m; print(\"import_ok\", m.__file__)"
'

echo "=== Migrate ==="
docker compose exec -T backend bench --site "$SITE" migrate

echo "=== Clear cache + restart backend ==="
docker compose exec -T backend bench --site "$SITE" clear-cache
docker compose restart backend
sleep 18

if [ -f /tmp/franchise-sheet.csv ]; then
  echo "=== Import sheet ==="
  bash import-franchise-sheet.sh /tmp/franchise-sheet.csv
else
  echo "=== Skip import (no /tmp/franchise-sheet.csv) ==="
fi

echo "=== HTTP smoke ==="
curl -s -o /tmp/ping.json -w "ping:%{http_code}\n" \
  "http://127.0.0.1:8080/api/method/frappe.ping" \
  -H "X-Frappe-Site-Name: $SITE" || true
curl -s -o /tmp/search.json -w "search:%{http_code}\n" \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.search_franchisees" \
  -H "X-Frappe-Site-Name: $SITE" || true
head -c 500 /tmp/search.json; echo

echo "DEPLOY_FRANCHISEE_HUB_DONE"
