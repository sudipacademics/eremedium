#!/bin/bash
# Migrate site after ERPNext bump, then restart workers (no compose down -v).
set -e
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== bench migrate ==="
docker compose exec -T backend bash -lc "
  set -e
  cd /home/frappe/frappe-bench
  bench --site $SITE migrate
  bench --site $SITE clear-cache
" 2>&1 | grep -vE 'version.*obsolete|^time='

echo "=== restart workers ==="
docker compose restart backend queue-short queue-long scheduler
sleep 12
echo "MIGRATE_RESTART_OK"
