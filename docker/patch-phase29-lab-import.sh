#!/bin/bash
# Phase 29 — Import FOCO lab test catalog + 1mg-style detail API
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

for f in "$ROOT"/docker/*.sh; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

echo "=== Phase 29 Lab Catalog Import ==="
cd "$ROOT/docker"

docker compose exec -T backend bash -s "$SITE" "$ROOT" <<'EOS'
set -e
SITE="$1"
ROOT="$2"
cd /home/frappe/frappe-bench
CORE=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")

for pyfile in clinical_phase29_lab_import.py api.py init.py; do
  cp -f "$CORE/$pyfile" "$PKG/$pyfile"
  python3 -m py_compile "$PKG/$pyfile"
done

DATA_SRC="apps/health_ecosystem_core/health_ecosystem_core/data/remedium_foco_lab_rates.csv"
DATA_DST="$PKG/../data/remedium_foco_lab_rates.csv"
mkdir -p "$(dirname "$DATA_DST")"
if [ -f "$DATA_SRC" ]; then
  cp -f "$DATA_SRC" "$DATA_DST"
  echo "CSV rows: $(($(wc -l < "$DATA_SRC") - 1))"
elif [ -f "$DATA_DST" ]; then
  echo "CSV rows: $(($(wc -l < "$DATA_DST") - 1))"
else
  echo "WARN: lab rate CSV missing at $DATA_SRC"
fi

bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_lab_import
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase29_smoke_test
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 10

echo ""
echo "DONE — Lab catalog imported."
echo "Deploy web: scp -r health_web_app/dist root@167.233.108.90:$ROOT/health_web_app/"
echo "Verify: curl catalog count + open /diagnostics/test/LAB-CBC"
