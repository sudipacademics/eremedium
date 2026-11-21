#!/bin/bash
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
BCID=$("${COMPOSE[@]}" ps -q backend)

echo "=== HOST HEC ==="
grep -n "def crm_list_reach_reps" "$HEC/clinical_phase25.py" || echo "MISSING on host HEC"
ls -la "$HEC/clinical_phase25.py" "$HEC/api.py"

echo "=== CONTAINER APPS ==="
docker exec "$BCID" bash -lc '
APPS=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(/home/frappe/frappe-bench/env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
echo APPS=$APPS
echo SP=$SP
echo "apps has:"; grep -n "def crm_list_reach_reps" "$APPS/clinical_phase25.py" || echo MISSING_APPS
echo "sp has:"; grep -n "def crm_list_reach_reps" "$SP/clinical_phase25.py" || echo MISSING_SP
echo "mounts:"; mount | grep -E "health_ecosystem|site-packages" || true
ls -la "$SP/clinical_phase25.py" "$APPS/clinical_phase25.py" 2>/dev/null || true
'

echo "=== COMPOSE VOLUMES for backend ==="
"${COMPOSE[@]}" config 2>/dev/null | awk '/backend:/,/^  [a-z]/ {print}' | head -80
