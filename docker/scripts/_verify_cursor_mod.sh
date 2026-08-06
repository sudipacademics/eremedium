#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
bench --site health.localhost mariadb -e "SELECT name FROM tabDocType WHERE name LIKE '\''B2B%'\'' ORDER BY name;"
bench --site health.localhost execute frappe.db.exists --args '\''["DocType", "B2B Collection Centre"]'\''
'
echo "=== compose services ==="
"${COMPOSE[@]}" config --services | sort
echo "=== verify FFMS API markers ==="
RCID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$RCID" sh -lc 'echo hard_delete=$(grep -c hard-delete-workflow /app/apps/local-api/server.mjs); echo b2b_ingest=$(grep -c b2b-centres/ingest /app/apps/local-api/server.mjs); echo admin_b2b=$(grep -Rlc "B2B Operations" /app/apps/admin-dashboard/out 2>/dev/null | wc -l)'
echo "=== REACH host sources ==="
grep -n "b2b-centres\|SalesB2b" /opt/health-ecosystem/health_web_app/src/App.tsx 2>/dev/null | head -5 || echo NO_REACH_APP_TSX
ls /opt/health-ecosystem/health_web_app/src/pages/sales/SalesB2b*.tsx 2>/dev/null || echo NO_REACH_B2B_PAGES
echo VERIFY_OK
