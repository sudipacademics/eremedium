#!/bin/bash
# Import Franchise Google Sheet CSV into Franchisee Profile + Phase 23 wallet opening recharge.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
SITE="${FRAPPE_SITE:-health.localhost}"
CSV_HOST="${1:-/tmp/franchise-sheet.csv}"
GEOCODE="${GEOCODE:-1}"

if [ ! -f "$CSV_HOST" ]; then
  echo "ERROR: CSV not found at $CSV_HOST"
  exit 1
fi

echo "=== Copy CSV into backend ==="
docker compose cp "$CSV_HOST" backend:/tmp/franchise-sheet.csv

echo "=== Import franchise rows (geocode=$GEOCODE) ==="
docker compose exec -T backend bash -lc "
set -e
cd /home/frappe/frappe-bench
bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_franchisee_import.import_franchise_csv --kwargs \"{'csv_path': '/tmp/franchise-sheet.csv', 'geocode': $GEOCODE}\"
"

echo "=== Profiles (sample) ==="
docker compose exec -T backend bash -lc "
cd /home/frappe/frappe-bench
bench --site $SITE mariadb -e \"SELECT name, franchise_name, active_status, wallet_balance, latitude, longitude, linked_user, category FROM \\\`tabFranchisee Profile\\\` ORDER BY franchise_name LIMIT 50;\"
"

echo "IMPORT_DONE"
