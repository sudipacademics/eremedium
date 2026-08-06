#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

echo "=== services ==="
"${COMPOSE[@]}" config --services 2>/dev/null | head -40

echo "=== frontend compose snippet ==="
grep -A45 '^  frontend:' docker-compose.yml | head -50 || true

echo "=== host REACH sources ==="
WEB=/opt/health-ecosystem/health_web_app
ls -la "$WEB/src/pages/sales/SalesB2bCentresPage.tsx" "$WEB/src/pages/sales/SalesB2bSalesPage.tsx" 2>&1
grep -n "b2b-centres\|B2B Centres\|SalesB2b" "$WEB/src/App.tsx" "$WEB/src/components/SalesLayout.tsx" 2>&1 | head -20

FCID=$("${COMPOSE[@]}" ps -q frontend)
echo "=== frontend cid=$FCID ==="
docker inspect "$FCID" --format '{{json .Mounts}}' | python3 -m json.tool 2>/dev/null | head -80 || docker inspect "$FCID" --format '{{json .Mounts}}'
echo "=== image ==="
docker inspect "$FCID" --format 'Image={{.Config.Image}} Created={{.Created}}'

echo "=== search built assets ==="
docker exec "$FCID" sh -lc '
  for d in /usr/share/nginx/html /app/dist /var/www/html /app /usr/share/nginx/html/assets; do
    [ -d "$d" ] && echo "DIR $d" && ls -la "$d" | head -15
  done
  echo ---GREP---
  grep -R "b2b-centres\|B2B Centres\|SalesB2b" /usr/share/nginx/html /app/dist /var/www/html 2>/dev/null | head -15 || echo NOT_IN_STATIC
'

echo "=== public curl ==="
curl -sI "https://reach.e-remedium.in/" | head -10 || true
curl -sI "https://reach.e-remedium.in/sales/b2b-centres" | head -10 || true
