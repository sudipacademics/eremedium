#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/reach-profile-fix}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC=/opt/health-ecosystem/health_ecosystem_core
SITE="${SITE:-health.localhost}"
BCID=$("${COMPOSE[@]}" ps -q backend)
cp -f "$SRC/clinical_phase25_sales_profile.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py"
APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25_sales_profile.py" "$BCID:$TARGET/clinical_phase25_sales_profile.py"
done
docker exec "$BCID" bash -lc "find $APPS_PKG $SP_PKG -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true"
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache"
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase25_sales_profile.ensure_reach_profiles_seed_all"
echo REACH_PROFILE_SEED_OK
