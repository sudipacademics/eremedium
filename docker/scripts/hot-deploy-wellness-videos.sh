#!/bin/bash
# Hot-deploy Phase 114 wellness video CMS + SPA.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/wellness-videos}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC_HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
SITE="${SITE:-health.localhost}"
TS=$(date +%Y%m%d-%H%M%S)

HEC_FILES=(
  clinical_phase114_wellness_videos.py
  hooks.py
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

# hooks.py lives one level up in the package root for the app
HOOKS_HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
if [[ -f "$SRC/hooks.py" ]]; then
  cp -f "$SRC/hooks.py" "$HOOKS_HOST/hooks.py"
fi

if [[ -d "$SRC/dist" ]]; then
  echo "=== SPA dist ==="
  cp -a "$WEB/dist" "$WEB/dist.pre-wellness-videos-$TS" || true
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
APPS_HOOKS=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/hooks.py
SP_HOOKS=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/hooks.py

echo "=== Hot-copy into backend container ==="
for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker exec "$BCID" mkdir -p "$TARGET"
  for f in clinical_phase114_wellness_videos.py hooks.py; do
    if [[ -f "$HEC_HOST/$f" ]]; then
      docker cp "$HEC_HOST/$f" "$BCID:$TARGET/$f"
    fi
  done
done

echo "=== Bootstrap DocType + seed ==="
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase114_wellness_videos.ensure_wellness_video_doctype" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase114_wellness_videos.seed_wellness_videos" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-website-cache" || true
docker restart "$BCID" >/dev/null || true
sleep 6

echo "=== Verify ==="
docker exec "$BCID" bash -lc "ls -la $SP_PKG/clinical_phase114_wellness_videos.py 2>&1 | head -3"
curl -sS -o /dev/null -w "api:%{http_code}\n" -X POST \
  -H "Host: www.e-remedium.in" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "wing_id=aesthetics" \
  "http://127.0.0.1/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase114_wellness_videos.list_wellness_videos" || true
curl -sS -o /dev/null -w "www_aesthetics:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/wellness/aesthetics || true
echo WELLNESS_VIDEOS_CMS_DEPLOY_OK
