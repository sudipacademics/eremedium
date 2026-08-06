#!/bin/bash
# Cursor Modification — Stage 2: FFMS Admin UI (Delete / Deboard / B2B Operations). Rebuilds rfms.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/cursor-mod-stage2}"
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

echo "=== Stage 2: sync admin UI sources ==="
mkdir -p "$FFMS/apps/admin-dashboard/app" "$FFMS/packages/utils"

cp -f "$SRC/admin-rbac.ts" "$FFMS/packages/utils/admin-rbac.ts"
cp -f "$SRC/admin-page.tsx" "$FFMS/apps/admin-dashboard/app/page.tsx"
cp -f "$SRC/hard-delete-button.tsx" "$FFMS/apps/admin-dashboard/app/hard-delete-button.tsx"
cp -f "$SRC/hard-delete.css" "$FFMS/apps/admin-dashboard/app/hard-delete.css"
cp -f "$SRC/lead-directory.tsx" "$FFMS/apps/admin-dashboard/app/lead-directory.tsx"
cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
cp -f "$SRC/appointment-directory.tsx" "$FFMS/apps/admin-dashboard/app/appointment-directory.tsx"
cp -f "$SRC/agreement-queue.tsx" "$FFMS/apps/admin-dashboard/app/agreement-queue.tsx"
cp -f "$SRC/payment-operations.tsx" "$FFMS/apps/admin-dashboard/app/payment-operations.tsx"
cp -f "$SRC/franchisee-directory.tsx" "$FFMS/apps/admin-dashboard/app/franchisee-directory.tsx"
cp -f "$SRC/franchisee-directory.css" "$FFMS/apps/admin-dashboard/app/franchisee-directory.css"
cp -f "$SRC/b2b-operations.tsx" "$FFMS/apps/admin-dashboard/app/b2b-operations.tsx"

echo "=== Stage 2: rebuild rfms (admin static) ==="
"${COMPOSE[@]}" build rfms
"${COMPOSE[@]}" up -d rfms
sleep 12

RCID=$("${COMPOSE[@]}" ps -q rfms)
echo "=== Stage 2 verify ==="
docker exec "$RCID" sh -lc 'grep -R "B2B Operations\|Delete permanently\|Deboard Franchise\|hard-delete" /app/apps/admin-dashboard/out 2>/dev/null | head -8 || echo CHECK_STATIC'
curl -sS -o /dev/null -w "ffms_html:%{http_code}\n" http://127.0.0.1:3002/ffms/ || true

echo "CURSOR_MOD_STAGE2_OK"
echo "Admin: https://www.e-remedium.in/ffms/"
