#!/bin/bash
# Phase 23 — B2B franchise portal (dual pricing + walk-in orders)
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"

for f in "$ROOT"/docker/*.sh; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

echo "=== Phase 23 B2B portal ==="
cd "$ROOT/docker"
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
CORE=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")

for pyfile in clinical_phase23.py api.py init.py; do
  cp -f "$CORE/$pyfile" "$PKG/$pyfile"
  python3 -m py_compile "$PKG/$pyfile"
done

bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase23_setup
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 8

echo ""
echo "DONE — deploy web dist/, login as franchise_hub@health.local, open /b2b"
