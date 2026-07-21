#!/bin/bash
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
cd "$ROOT/docker"

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
CORE=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
cp -f "$CORE/api.py" "$PKG/api.py"
python3 -m py_compile "$PKG/api.py"
bench --site health.localhost clear-cache
EOS

docker compose restart backend
sleep 8
bash "$ROOT/docker/test-lab-tech-bookings.sh"
