#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
BCID=$(docker compose -f docker-compose.yml -f docker-compose.ffms.yml ps -q backend)
echo "backend:$BCID"
docker exec "$BCID" bash -lc 'grep -n "def get_sales_profile_dashboard" /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py | head -3'
echo '--- profile API ---'
docker exec "$BCID" curl -sS \
  -H 'Host: health.localhost' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'seed_if_missing=0' \
  'http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.api.get_sales_profile_dashboard' | head -c 700
echo
echo '--- portal API (control) ---'
docker exec "$BCID" curl -sS \
  -H 'Host: health.localhost' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d '' \
  'http://127.0.0.1:8000/api/method/health_ecosystem_core.health_ecosystem_core.api.get_sales_portal' | head -c 300
echo
