#!/bin/bash
# Deploy CRM Tag column UI: Aesthetic bookings (www), Care/Aesthetic React UI, CRM portal.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-tag-ui}"
WWW=/opt/health-ecosystem/health_web_app
# Common public roots for the labs site SPA assets
WWW_PUBLICS=(
  /opt/health-ecosystem/health_web_app/public
  /opt/health-ecosystem/health_web_app
  /var/www/remediumlabs
  /var/www/www.remediumlabs.in
)
CARE=/opt/health-ecosystem/care_portal
CRM_DIST=/opt/health-ecosystem/crm_portal/dist

if [[ -f "$SRC/aesthetic-bookings.js" ]]; then
  for root in "${WWW_PUBLICS[@]}"; do
    if [[ -d "$root" ]]; then
      cp -f "$SRC/aesthetic-bookings.js" "$root/aesthetic-bookings.js"
      cp -f "$SRC/aesthetic-bookings.css" "$root/aesthetic-bookings.css"
      if [[ -f "$SRC/index.html" && -f "$root/index.html" ]]; then
        # Bump only the aesthetic-bookings cache query if the file exists
        if grep -q 'aesthetic-bookings.js' "$root/index.html"; then
          sed -i 's/aesthetic-bookings\.css?v=[0-9]*/aesthetic-bookings.css?v=7/' "$root/index.html"
          sed -i 's/aesthetic-bookings\.js?v=[0-9]*/aesthetic-bookings.js?v=17/' "$root/index.html"
        fi
      fi
      echo "Updated aesthetic bookings in $root"
    fi
  done
fi

if [[ -d "$SRC/care-dist" ]]; then
  mkdir -p "$CARE/dist"
  rsync -a --delete "$SRC/care-dist/" "$CARE/dist/"
  find "$CARE/dist" -type d -exec chmod 755 {} \;
  find "$CARE/dist" -type f -exec chmod 644 {} \;
  echo "Updated Care UI dist"
fi

if [[ -d "$SRC/aes-dist" ]]; then
  mkdir -p "$CARE/dist-aesthetic"
  rsync -a --delete "$SRC/aes-dist/" "$CARE/dist-aesthetic/"
  find "$CARE/dist-aesthetic" -type d -exec chmod 755 {} \;
  find "$CARE/dist-aesthetic" -type f -exec chmod 644 {} \;
  echo "Updated Aesthetic UI dist"
fi

if [[ -d "$SRC/crm-dist" ]]; then
  mkdir -p "$CRM_DIST"
  rsync -a --delete "$SRC/crm-dist/" "$CRM_DIST/"
  find "$CRM_DIST" -type d -exec chmod 755 {} \;
  find "$CRM_DIST" -type f -exec chmod 644 {} \;
  echo "Updated CRM portal dist"
fi

# Locate live aesthetic-bookings.js paths nginx actually serves
find /opt/health-ecosystem /var/www -name 'aesthetic-bookings.js' 2>/dev/null | head -20 || true
ls -la "$CARE/dist/assets" 2>/dev/null | head -5 || true
ls -la "$CRM_DIST/assets" 2>/dev/null | head -5 || true

echo CRM_TAG_UI_DEPLOY_OK
