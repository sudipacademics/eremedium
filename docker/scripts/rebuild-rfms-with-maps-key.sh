#!/bin/bash
# Rebuild RFMS ensuring Google Maps key is passed as a build arg.
set -euo pipefail
cd /opt/health-ecosystem/docker

KEY=""
if [ -f /opt/health-ecosystem/apps_external/ffms/.env.local ]; then
  KEY=$(grep -E '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' /opt/health-ecosystem/apps_external/ffms/.env.local | cut -d= -f2- | tr -d '\r' || true)
fi
if [ -z "$KEY" ] && [ -f .env ]; then
  KEY=$(grep -E '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' .env | cut -d= -f2- | tr -d '\r' || true)
fi

if [ -n "$KEY" ]; then
  if grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' .env 2>/dev/null; then
    sed -i "s|^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=.*|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${KEY}|" .env
  else
    echo "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${KEY}" >> .env
  fi
  export NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$KEY"
  echo "Using Google Maps key (len=${#KEY})"
else
  echo "WARN: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing — maps will fall back to static"
fi

docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms

echo "=== verify bake ==="
if docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms sh -c 'grep -Rql "AIza" /app/apps/admin-dashboard/out 2>/dev/null'; then
  echo MAPS_KEY_BAKED_OK
else
  echo MAPS_KEY_BAKED_MISS
fi

# quick Maps Platform status (server-side; browser-restricted keys may still work in UI)
if [ -n "$KEY" ]; then
  RESP=$(curl -sS "https://maps.googleapis.com/maps/api/geocode/json?address=Kolkata&key=${KEY}" || true)
  echo "$RESP" | grep -oE '"status" *: *"[^"]+"' | head -1 || true
  echo "$RESP" | grep -oE '"error_message" *: *"[^"]+"' | head -1 || true
fi

echo RFMS_MAPS_REBUILD_DONE
