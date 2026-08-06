#!/bin/bash
# Deploy REACH Profile dashboard + seed employee/CTC/target for all sales reps.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/reach-profile}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC=/opt/health-ecosystem/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
SITE="${SITE:-health.localhost}"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== Sync HEC + REACH UI sources ==="
mkdir -p "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$WEB/src/pages/sales" "$WEB/src/components"

[[ -f "$SRC/clinical_phase25_sales_profile.py" ]] && cp -f "$SRC/clinical_phase25_sales_profile.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
[[ -f "$SRC/SalesProfilePage.tsx" ]] && cp -f "$SRC/SalesProfilePage.tsx" "$WEB/src/pages/sales/SalesProfilePage.tsx"
[[ -f "$SRC/sales-profile.css" ]] && cp -f "$SRC/sales-profile.css" "$WEB/src/pages/sales/sales-profile.css"
[[ -f "$SRC/SalesLayout.tsx" ]] && cp -f "$SRC/SalesLayout.tsx" "$WEB/src/components/SalesLayout.tsx"
[[ -f "$SRC/SalesPortalPage.tsx" ]] && cp -f "$SRC/SalesPortalPage.tsx" "$WEB/src/pages/sales/SalesPortalPage.tsx"
[[ -f "$SRC/App.tsx" ]] && cp -f "$SRC/App.tsx" "$WEB/src/App.tsx"
[[ -f "$SRC/api.ts" ]] && cp -f "$SRC/api.ts" "$WEB/src/api.ts"

if [[ -d "$SRC/dist" ]]; then
  echo "=== Publish REACH dist ==="
  cp -a "$WEB/dist" "$WEB/dist.pre-profile-$TS" || true
  rsync -a --delete "$SRC/dist/" "$WEB/dist/"
  if [[ -f /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh ]]; then
    bash /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh || true
  fi
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
[[ -n "$BCID" ]] || { echo "backend not running"; exit 1; }

APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core

echo "=== Hot-copy HEC profile module ==="
docker exec "$BCID" mkdir -p "$APPS_PKG" "$SP_PKG"
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py" "$BCID:$TARGET/clinical_phase25_sales_profile.py"
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$TARGET/api.py"
done
docker exec "$BCID" bash -lc "find $APPS_PKG $SP_PKG -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true"

echo "=== Clear cache + seed all REACH profiles ==="
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache"
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase25_sales_profile.ensure_reach_profiles_seed_all" || true

echo "=== Verify markers ==="
docker exec "$BCID" bash -lc "grep -n 'get_sales_profile_dashboard\|ensure_reach_profiles_seed_all' $APPS_PKG/api.py $APPS_PKG/clinical_phase25_sales_profile.py | head -15"
grep -Rql "Sales earned\|reach-profile\|/sales/profile" "$WEB/dist" && echo DIST_HAS_PROFILE || echo DIST_PROFILE_MISS
curl -sS -o /dev/null -w "reach:%{http_code}\n" -H "Host: reach.e-remedium.in" http://127.0.0.1/sales/profile || true
echo REACH_PROFILE_DEPLOY_OK
