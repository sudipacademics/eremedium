#!/bin/bash
set -euo pipefail
SRC=/tmp/crm-tag-ui
cp -f "$SRC/aesthetic-bookings.js" "$SRC/aesthetic-bookings.css" /opt/health-ecosystem/health_web_app/dist/
cp -f "$SRC/aesthetic-bookings.js" "$SRC/aesthetic-bookings.css" /opt/health-ecosystem/people-addons/
cp -f "$SRC/aesthetic-bookings.js" "$SRC/aesthetic-bookings.css" /opt/health-ecosystem/health_web_app/

for f in \
  /opt/health-ecosystem/health_web_app/dist/index.html \
  /opt/health-ecosystem/people-addons/index.html \
  /opt/health-ecosystem/health_web_app/index.html
do
  if [[ -f "$f" ]] && grep -q 'aesthetic-bookings.js' "$f"; then
    sed -i 's/aesthetic-bookings\.css?v=[0-9]*/aesthetic-bookings.css?v=7/' "$f"
    sed -i 's/aesthetic-bookings\.js?v=[0-9]*/aesthetic-bookings.js?v=17/' "$f"
    echo "cache-bumped $f"
  fi
done

grep -n extractCrmTag /opt/health-ecosystem/health_web_app/dist/aesthetic-bookings.js
grep -n 'aesthetic-bookings.js?v=' /opt/health-ecosystem/health_web_app/dist/index.html /opt/health-ecosystem/people-addons/index.html 2>/dev/null || true

# Where Care / Aesthetic React UIs are served from
ls -la /opt/health-ecosystem/care_portal/dist/assets/index-Def5RsPk.js /opt/health-ecosystem/care_portal/dist-aesthetic/assets/index-Djuv55ba.js

# nginx roots for care / aesthetic
ls /etc/nginx/sites-enabled/
grep -Rhs 'root \|server_name\|care\.e-remedium\|aesthetic' /etc/nginx/sites-enabled/ 2>/dev/null | head -60 || true

echo SYNC_AESTHETIC_BOOKINGS_OK
