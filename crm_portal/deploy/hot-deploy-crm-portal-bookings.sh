#!/bin/bash
# Deploy Care/Aesthetic CRM telecaller booking rights + CRM portal dist.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-portal-bookings}"
CARE=/opt/health-ecosystem/care_portal/server
CRM_DIST=/opt/health-ecosystem/crm_portal/dist
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)

if [[ -f "$SRC/auth.mjs" ]]; then
  mkdir -p "$CARE"
  cp -f "$SRC/auth.mjs" "$CARE/auth.mjs"
  grep -q "crmBookingGrant" "$CARE/auth.mjs"
  grep -q "crm_booker" "$CARE/auth.mjs"
fi

if [[ -d "$SRC/dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
fi

# Host systemd units (production Care / Aesthetic session engines).
systemctl restart care-api aes-api 2>/dev/null || true
sleep 1
systemctl is-active care-api aes-api 2>/dev/null || true

# Legacy docker compose paths (if still used on a host).
for name in care-api aesthetic-api care_portal aesthetic_portal care aesthetic; do
  CID=$(docker ps -q -f "name=${name}" | head -1 || true)
  if [[ -n "${CID:-}" && -f "$CARE/auth.mjs" ]]; then
    docker cp "$CARE/auth.mjs" "$CID:/app/server/auth.mjs" 2>/dev/null \
      || docker cp "$CARE/auth.mjs" "$CID:/app/auth.mjs" 2>/dev/null \
      || true
    docker restart "$CID" >/dev/null || true
  fi
done

echo CRM_PORTAL_BOOKINGS_DEPLOY_OK
