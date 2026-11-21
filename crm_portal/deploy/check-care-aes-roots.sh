#!/bin/bash
set -euo pipefail
echo '=== aesthetics nginx ==='
grep -nE 'root |alias |server_name|location' /etc/nginx/sites-enabled/aesthetics.e-remedium.in | head -80
echo '=== care nginx ==='
grep -nE 'root |alias |server_name|location' /etc/nginx/sites-enabled/care.e-remedium.in | head -80
echo '=== care_portal tree ==='
ls -la /opt/health-ecosystem/care_portal/ | head -30
# Does aesthetics host pull bookings from people-addons or health_web_app?
find /opt/health-ecosystem -path '*aesthetic*' -name 'index.html' 2>/dev/null | head -20
# Live check: does aesthetics.e-remedium.in serve aesthetic-bookings.js?
curl -fsSI https://aesthetics.e-remedium.in/aesthetic-bookings.js?v=17 | head -15 || true
curl -fsSI https://care.e-remedium.in/ | head -15 || true
curl -fsS https://aesthetics.e-remedium.in/ | grep -o 'aesthetic-bookings[^"]*' | head || true
curl -fsS https://crm.e-remedium.in/ | grep -o 'index-[^"]*\.js' | head || true
