#!/bin/bash
# Complete clean Frappe HRMS install on health.localhost — never leave partial state.
# Safe: does NOT docker compose down -v.
set -e
SITE="${FRAPPE_SITE:-health.localhost}"
ROOT="/opt/health-ecosystem"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd "$ROOT/docker"

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench

if [ ! -d apps/hrms ]; then
  echo "=== get-app hrms (version-15) ==="
  bench get-app hrms --branch version-15 || bench get-app hrms
fi

# apps.txt must include hrms whenever the app is on disk
if ! grep -qx 'hrms' sites/apps.txt 2>/dev/null; then
  echo hrms >> sites/apps.txt
  echo "Added hrms to sites/apps.txt"
fi

echo "=== ensure Module Def for HR / HRMS / Payroll ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.ensure_hrms_modules 2>/dev/null || true

echo "=== install-app hrms ==="
if bench --site "$SITE" list-apps | grep -q hrms; then
  echo "hrms already in list-apps"
else
  bench --site "$SITE" install-app hrms 2>&1 | tee /tmp/hrms-install.log | tail -50
fi

echo "=== migrate ==="
bench --site "$SITE" migrate 2>&1 | tee /tmp/hrms-migrate.log | tail -60

echo "=== repair Employee meta ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.run_repair

echo "=== phase 21 setup ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase21_setup

echo "=== final list-apps ==="
bench --site "$SITE" list-apps
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 10
echo "HRMS install script finished."
