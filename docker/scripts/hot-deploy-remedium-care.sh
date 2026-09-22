#!/bin/bash
# Hot-deploy Remedium Care (Phase 113) + Care SPA routes.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/remedium-care}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC_HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
SITE="${SITE:-health.localhost}"
TS=$(date +%Y%m%d-%H%M%S)

HEC_FILES=(
  clinical_phase113_remedium_care.py
  clinical_phase110_wellness_sessions.py
  clinical_phase31_allied_health.py
)

echo "=== Sync HEC modules onto host ==="
mkdir -p "$HEC_HOST"
for f in "${HEC_FILES[@]}"; do
  if [[ -f "$SRC/$f" ]]; then
    cp -f "$SRC/$f" "$HEC_HOST/$f"
    echo "  synced $f"
  else
    echo "  MISSING $f"
  fi
done

if [[ -d "$SRC/dist" ]]; then
  echo "=== SPA dist ==="
  cp -a "$WEB/dist" "$WEB/dist.pre-remedium-care-$TS" || true
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
  for f in "${HEC_FILES[@]}"; do
    if [[ -f "$HEC_HOST/$f" ]]; then
      docker cp "$HEC_HOST/$f" "$BCID:$TARGET/$f"
    fi
  done
done

echo "=== Bootstrap Care DocTypes / packs / cache ==="
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase113_remedium_care.ensure_phase113_doctypes" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase113_remedium_care.ensure_phase113_fields" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase113_remedium_care.seed_care_session_packs" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase113_remedium_care.seed_care_catalog_items" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase110_wellness_sessions.seed_wellness_session_packs" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
docker restart "$BCID" >/dev/null || true
sleep 6

echo "=== Verify ==="
docker exec "$BCID" bash -lc "ls -la $SP_PKG/clinical_phase113_remedium_care.py $APPS_PKG/clinical_phase113_remedium_care.py 2>&1 | head -5"
grep -l 'Remedium Care\|wellness/care\|care-landing' "$WEB/dist/assets/"*.js 2>/dev/null | head -3 || \
  grep -l 'Remedium Care\|wellness/care' "$WEB/dist/web-assets/"*.js 2>/dev/null | head -3 || true
curl -sS -o /dev/null -w "www_care:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/wellness/care || true
curl -sS -o /dev/null -w "www_physio_redirect_page:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/wellness/physiotherapy || true
curl -sk -o /dev/null -w "erp:%{http_code}\n" https://erp.e-remedium.in/ || true
echo REMEDIUM_CARE_DEPLOY_OK
