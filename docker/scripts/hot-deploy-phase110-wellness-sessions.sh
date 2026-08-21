#!/bin/bash
# Hot-deploy Phase 110 wellness session cards + tele/yoga video join (SPA + HEC).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/phase110-wellness}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC_HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
SITE="${SITE:-health.localhost}"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== Sync HEC modules onto host ==="
mkdir -p "$HEC_HOST"
for f in \
  clinical_phase110_wellness_sessions.py \
  clinical_phase31_allied_health.py \
  clinical_phase42_telemedicine.py \
  clinical_yoga_subscriptions.py
do
  if [[ -f "$SRC/$f" ]]; then
    cp -f "$SRC/$f" "$HEC_HOST/$f"
    echo "  synced $f"
  else
    echo "  MISSING $f"
  fi
done

if [[ -d "$SRC/dist" ]]; then
  echo "=== SPA dist ==="
  cp -a "$WEB/dist" "$WEB/dist.pre-phase110-$TS" || true
  rsync -a --delete "$SRC/dist/" "$WEB/dist/"
  rm -f "$WEB/dist/hot-deploy.sh" "$WEB/dist/"*.py 2>/dev/null || true
  chown -R root:www-data "$WEB/dist" || true
  find "$WEB/dist" -type d -exec chmod 755 {} +
  find "$WEB/dist" -type f -exec chmod 644 {} +
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
[[ -n "$BCID" ]] || { echo "backend not running"; exit 1; }

APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core

echo "=== Hot-copy into backend container ==="
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker exec "$BCID" mkdir -p "$TARGET"
  for f in \
    clinical_phase110_wellness_sessions.py \
    clinical_phase31_allied_health.py \
    clinical_phase42_telemedicine.py \
    clinical_yoga_subscriptions.py
  do
    if [[ -f "$HEC_HOST/$f" ]]; then
      docker cp "$HEC_HOST/$f" "$BCID:$TARGET/$f"
    fi
  done
done

echo "=== Bootstrap session packs + clear cache ==="
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions.ensure_wellness_session_fields" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions.seed_wellness_session_packs" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
docker restart "$BCID" >/dev/null || true
sleep 5

echo "=== Verify ==="
docker exec "$BCID" bash -lc "ls -la $SP_PKG/clinical_phase110_wellness_sessions.py $APPS_PKG/clinical_phase110_wellness_sessions.py 2>&1 | head -5"
grep -l 'wellness/sessions\|SessionCards\|teleconsult/join' "$WEB/dist/web-assets/"*.js 2>/dev/null | head -3 || \
  grep -l 'wellness/sessions\|joinVideoSession' "$WEB/dist/assets/"*.js 2>/dev/null | head -3 || true
curl -sS -o /dev/null -w "www_sessions:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/wellness/sessions || true
curl -sS -o /dev/null -w "www_yoga:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/yoga-memberships || true
curl -sk -o /dev/null -w "erp:%{http_code}\n" https://erp.e-remedium.in/ || true
echo PHASE110_WELLNESS_DEPLOY_OK