#!/bin/bash
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi
SRC="${1:-/tmp/care-bookings}"
CARE=/opt/health-ecosystem/care_portal/server
CRM_DIST=/opt/health-ecosystem/crm_portal/dist

cp -f "$SRC/api.mjs" "$CARE/api.mjs"
grep -q "Physiotherapist" "$CARE/api.mjs"

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
fi

systemctl restart care-api
sleep 1
systemctl is-active care-api
echo CARE_BOOKINGS_DEPLOY_OK
