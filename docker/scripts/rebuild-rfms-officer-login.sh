#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

# Keep Maps key across RFMS rebuilds (compose build arg).
if [ -f /opt/health-ecosystem/apps_external/ffms/.env.local ]; then
  KEY=$(grep -E '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' /opt/health-ecosystem/apps_external/ffms/.env.local | cut -d= -f2- | tr -d '\r' || true)
  if [ -n "$KEY" ]; then
    export NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$KEY"
    if grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' .env 2>/dev/null; then
      sed -i "s|^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=.*|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${KEY}|" .env
    else
      echo "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${KEY}" >> .env
    fi
  fi
fi

docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c '/api/v1/auth/login' /app/apps/local-api/server.mjs
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c 'Company ID' /app/apps/admin-dashboard/out/index.html || \
  docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms sh -c 'grep -Rcl "Company ID\|auth/login" /app/apps/admin-dashboard/out | head'
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms sh -c 'grep -Rql "AIza" /app/apps/admin-dashboard/out && echo MAPS_KEY_BAKED_OK || echo MAPS_KEY_BAKED_MISS'
echo RFMS_LOGIN_DONE
