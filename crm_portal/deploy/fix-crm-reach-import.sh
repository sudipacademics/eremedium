#!/bin/bash
# Force CRM→REACH helpers into the live Python package path (no container recreate).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-reach-sync}"
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

test -f "$SRC/api.py"
test -f "$SRC/clinical_phase25.py"
grep -q "def crm_list_reach_reps" "$SRC/clinical_phase25.py"

cp -f "$SRC/api.py" "$HEC/api.py"
cp -f "$SRC/clinical_phase25.py" "$HEC/clinical_phase25.py"

BCID=$("${COMPOSE[@]}" ps -q backend)

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core

# Discover every clinical_phase25.py Python can see and overwrite them from the bind-mounted apps copy.
mapfile -t TARGETS < <(./env/bin/python - <<PY
import importlib.util, os, sys
paths = []
# site-packages / editable locations
for entry in sys.path:
    cand = os.path.join(entry, "health_ecosystem_core", "health_ecosystem_core", "clinical_phase25.py")
    if os.path.isfile(cand):
        paths.append(cand)
# explicit apps tree
apps = "/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
if os.path.isfile(apps):
    paths.append(apps)
print("\n".join(dict.fromkeys(paths)))
PY
)

echo "TARGETS:"
printf " - %s\n" "${TARGETS[@]}"
SRC_FILE="$APPS/clinical_phase25.py"
SRC_API="$APPS/api.py"
test -f "$SRC_FILE"
grep -q "def crm_list_reach_reps" "$SRC_FILE"

for t in "${TARGETS[@]}"; do
  dir=$(dirname "$t")
  if [ "$(realpath "$dir/clinical_phase25.py" 2>/dev/null || echo "$dir/clinical_phase25.py")" = "$(realpath "$SRC_FILE")" ]; then
    echo "skip same-file $dir"
    continue
  fi
  cp -f "$SRC_FILE" "$dir/clinical_phase25.py"
  cp -f "$SRC_API" "$dir/api.py"
  echo "synced $dir"
done

# Drop a .pth so apps package wins on next process start.
PTH=env/lib/python3.11/site-packages/hec_apps_override.pth
echo "/home/frappe/frappe-bench/apps/health_ecosystem_core" > "$PTH"
echo "wrote $PTH"

./env/bin/python <<PY
import importlib
import health_ecosystem_core.health_ecosystem_core.clinical_phase25 as p25
import health_ecosystem_core.health_ecosystem_core.api as api
importlib.reload(p25)
importlib.reload(api)
from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_list_reach_reps
from health_ecosystem_core.health_ecosystem_core.api import list_crm_reach_reps
print("IMPORT_OK", getattr(p25, "crm_list_reach_reps", None) is not None)
print("P25_FILE", p25.__file__)
print("API_FILE", api.__file__)
PY

bench --site health.localhost clear-cache >/dev/null 2>&1 || true
# Reload gunicorn workers in-place (keeps filesystem edits).
pkill -HUP -f "gunicorn.*health.localhost|gunicorn.*frappe|bench serve" 2>/dev/null || true
pkill -HUP -f gunicorn 2>/dev/null || true
sleep 2
./env/bin/python <<PY
from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_list_reach_reps
from health_ecosystem_core.health_ecosystem_core.api import list_crm_reach_reps
print("RELOAD_OK")
PY
'

echo CRM_REACH_IMPORT_FIXED
