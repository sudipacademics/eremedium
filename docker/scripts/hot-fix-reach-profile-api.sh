#!/bin/bash
# Force-reload get_sales_profile_dashboard on live backend.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/reach-profile-api-fix}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC=/opt/health-ecosystem/health_ecosystem_core
SITE="${SITE:-health.localhost}"

mkdir -p "$HEC/health_ecosystem_core/health_ecosystem_core"
[[ -f "$SRC/clinical_phase25_sales_profile.py" ]] && cp -f "$SRC/clinical_phase25_sales_profile.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"

BCID=$("${COMPOSE[@]}" ps -q backend)
[[ -n "$BCID" ]] || { echo "backend not running"; exit 1; }

APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core

echo "=== Hot-copy API + profile module ==="
docker exec "$BCID" mkdir -p "$APPS_PKG" "$SP_PKG"
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py" "$BCID:$TARGET/clinical_phase25_sales_profile.py"
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$TARGET/api.py"
done
docker exec "$BCID" bash -lc "find $APPS_PKG $SP_PKG -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true"
docker exec "$BCID" bash -lc "rm -f $APPS_PKG/api.pyc $SP_PKG/api.pyc $APPS_PKG/clinical_phase25_sales_profile.pyc $SP_PKG/clinical_phase25_sales_profile.pyc 2>/dev/null || true"

echo "=== Verify symbols on disk ==="
docker exec "$BCID" bash -lc "grep -n 'def get_sales_profile_dashboard' $APPS_PKG/api.py $SP_PKG/api.py | head -10"
docker exec "$BCID" bash -lc "test -f $APPS_PKG/clinical_phase25_sales_profile.py && echo PROFILE_MODULE_OK"

echo "=== Restart backend + clear caches ==="
"${COMPOSE[@]}" restart backend
sleep 14
BCID=$("${COMPOSE[@]}" ps -q backend)
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache && bench --site $SITE clear-website-cache" || true

echo "=== Probe whitelisted method ==="
# Guest call should return auth/validation JSON, NOT AttributeError / 404 DoesNotExistError for missing method
code=$(docker exec "$BCID" curl -sS -o /tmp/profile_probe.json -w '%{http_code}' \
  -H "Host: $SITE" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'seed_if_missing=0' \
  'http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.api.get_sales_profile_dashboard' || echo 000)
echo "probe_http:$code"
docker exec "$BCID" python3 - <<'PY'
import json
raw=open('/tmp/profile_probe.json').read()
print(raw[:800])
low=raw.lower()
assert 'doesnotexist' not in low and 'not found' not in low and 'no module named' not in low, raw[:500]
assert 'get_sales_profile_dashboard' not in low or 'exc' in low or 'message' in low or 'data' in low or 'login' in low or 'sales' in low
print('PROFILE_API_REGISTERED')
PY

echo REACH_PROFILE_API_FIX_OK
