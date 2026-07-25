#!/bin/bash
# Minimal safe reinstall of health_ecosystem_core (no volume wipe).
set -e
cd /opt/health-ecosystem/docker

echo "=== Reinstall health_ecosystem_core from mounted apps ==="
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
API="apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py"
grep -n "def _is_reagent_or_excluded_item" "$API" | head
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
./env/bin/python - <<'PY'
import health_ecosystem_core.health_ecosystem_core.api as m
print("loaded:", m.__file__)
assert hasattr(m, "_is_reagent_or_excluded_item"), "helper missing after install"
print("helper OK")
PY
bench --site health.localhost clear-cache
EOS

echo "=== Restart workers ==="
docker compose restart backend queue-short queue-long scheduler
echo "DONE"
