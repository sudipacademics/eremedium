#!/bin/bash
# Deploy Company HRMS Phase A–C: sync modules, complete HRMS install, ESS web, KPIs, payroll, talent.
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd "$ROOT/docker"

echo "=== Sync HEC Python modules to site-packages ==="
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SITE_PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
HOOKS_SRC=apps/health_ecosystem_core/health_ecosystem_core/hooks.py
HOOKS_DST=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.join(os.path.dirname(health_ecosystem_core.__file__), 'hooks.py'))")

for f in clinical_hrms_repair.py clinical_phase21.py clinical_phase71_ops_dashboards.py \
         clinical_phase72_payroll.py clinical_phase73_talent.py api.py init.py; do
  if [ -f "$APPS_PKG/$f" ]; then
    cp -f "$APPS_PKG/$f" "$SITE_PKG/$f"
    python3 -m py_compile "$SITE_PKG/$f"
    echo "OK $f"
  else
    echo "WARN missing $APPS_PKG/$f"
  fi
done
if [ -f "$HOOKS_SRC" ]; then
  cp -f "$HOOKS_SRC" "$HOOKS_DST"
  echo "OK hooks.py"
fi
EOS

echo "=== Complete HRMS install ==="
bash "$ROOT/docker/complete-hrms-install.sh"

echo "=== Phase 71 (HR board) + 72 payroll + 73 talent ==="
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase71_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase72_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase73_setup
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 12

echo "=== Smoke HR self-service ==="
if [ -f "$ROOT/docker/test-hr-self-service.sh" ]; then
  bash "$ROOT/docker/test-hr-self-service.sh" || true
fi

echo "=== Smoke phase72/73 ==="
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase72_smoke
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase73_smoke
EOS

echo "Deploy HRMS rollout finished."
