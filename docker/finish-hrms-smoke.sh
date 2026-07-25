#!/bin/bash
# Finish Phase 72/73 + ESS smoke after HRMS installed_apps sync.
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
APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SITE_PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
for f in clinical_hrms_repair.py clinical_phase72_payroll.py clinical_phase21.py clinical_phase73_talent.py; do
  cp -f "$APPS_PKG/$f" "$SITE_PKG/$f"
  python3 -m py_compile "$SITE_PKG/$f"
done

# Re-import salary_component_account from HRMS JSON if present
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.run_repair
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase72_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase72_smoke
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase73_smoke
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.smoke_employee_desk
bench --site "$SITE" list-apps
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 12
bash "$ROOT/docker/test-hr-self-service.sh"
