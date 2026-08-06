#!/bin/bash
# Stage 3b — rebuild frontend (REACH) after host source sync.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
WEB=/opt/health-ecosystem/health_web_app

test -f "$WEB/src/pages/sales/SalesB2bCentresPage.tsx"
test -f "$WEB/src/pages/sales/SalesB2bSalesPage.tsx"
grep -q "b2b-centres" "$WEB/src/App.tsx"
grep -q "B2B Centres" "$WEB/src/components/SalesLayout.tsx"

echo "=== Rebuild frontend (REACH) ==="
"${COMPOSE[@]}" up -d --build frontend
sleep 10
FCID=$("${COMPOSE[@]}" ps -q frontend)
docker exec "$FCID" sh -lc 'grep -R "b2b-centres\|B2B Centres\|B2B Sales" /app/dist /usr/share/nginx/html /var/www 2>/dev/null | head -5 || ls /app 2>/dev/null | head -20 || echo FRONTEND_TREE_UNKNOWN'
echo CURSOR_MOD_STAGE3B_OK
echo "REACH: https://reach.e-remedium.in/sales/b2b-centres"
echo "REACH: https://reach.e-remedium.in/sales/b2b-sales"
