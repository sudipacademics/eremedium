#!/bin/bash
# Hot-deploy Phase 115 agency onboard form CMS + SPA.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/agency-onboard-form}"
COMPOSE=(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml)
HEC_HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
SITE="${SITE:-health.localhost}"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== Sync HEC ==="
mkdir -p "$HEC_HOST"
cp -f "$SRC/clinical_phase115_agency_onboard_form.py" "$HEC_HOST/" || { echo MISSING py; exit 1; }

if [[ -d "$SRC/dist" ]]; then
  echo "=== SPA dist ==="
  cp -a "$WEB/dist" "$WEB/dist.pre-agency-onboard-$TS" || true
  rsync -a --delete "$SRC/dist/" "$WEB/dist/"
  rm -f "$WEB/dist/hot-deploy.sh" "$WEB/dist/"*.py 2>/dev/null || true
  chmod 755 /opt/health-ecosystem /opt/health-ecosystem/health_web_app "$WEB/dist" || true
  chown -R root:www-data "$WEB/dist" || true
  find "$WEB/dist" -type d -exec chmod 755 {} +
  find "$WEB/dist" -type f -exec chmod 644 {} +
fi

BCID=$("${COMPOSE[@]}" ps -q backend)
[[ -n "$BCID" ]] || { echo "backend not running"; exit 1; }

APPS_PKG=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP_PKG=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core

for TARGET in "$APPS_PKG" "$SP_PKG"; do
  docker exec "$BCID" mkdir -p "$TARGET"
  docker cp "$HEC_HOST/clinical_phase115_agency_onboard_form.py" "$BCID:$TARGET/clinical_phase115_agency_onboard_form.py"
done

echo "=== Bootstrap forms ==="
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase115_agency_onboard_form.ensure_agency_onboard_form_doctypes" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase115_agency_onboard_form.seed_agency_onboard_forms" || true
"${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE clear-cache" || true
docker restart "$BCID" >/dev/null || true
sleep 6

echo "=== Verify ==="
curl -sS -o /dev/null -w "form_api:%{http_code}\n" -X POST \
  -H "Host: www.e-remedium.in" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "form_key=agents_portal" \
  "http://127.0.0.1/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase115_agency_onboard_form.get_agency_onboard_form" || true
curl -sS -o /dev/null -w "www_agents:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/agents || true
echo AGENCY_ONBOARD_FORM_DEPLOY_OK
