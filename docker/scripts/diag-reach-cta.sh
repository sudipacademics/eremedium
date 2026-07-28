#!/bin/bash
set -euo pipefail
echo "=== reach onboard page links ==="
curl -sS "https://reach.e-remedium.in/sales/onboard" -o /tmp/reach_onboard.html || true
# SPA shell may not include strings; check built assets
grep -oE 'src="[^"]+\.js"' /tmp/reach_onboard.html | head -20
echo
echo "=== search reach dist for onboarding session strings ==="
DIST=/opt/health-ecosystem/health_web_app/dist
if [ -d "$DIST" ]; then
  grep -Rola --include='*.js' 'create_onboarding_session\|hec-session\|Start e-Aadhaar\|onboard/hec' "$DIST" 2>/dev/null | head -20 || true
  echo "--- sample url construction ---"
  grep -Roh --include='*.js' 'e-remedium\.in[^"'\'' ]{0,80}' "$DIST" 2>/dev/null | sort -u | head -40 || true
else
  echo "dist missing at $DIST"
  ls /opt/health-ecosystem/health_web_app | head
fi

echo
echo "=== www root vs onboard (first redirect) ==="
curl -sS -o /dev/null -D - "https://www.e-remedium.in/" | head -15
curl -sS -o /dev/null -D - "https://e-remedium.in/" | head -15

echo
echo "=== frontend container / nginx root for reach ==="
grep -nE 'reach\.e-remedium|server_name www|location / \{|root |proxy_pass.*frontend|proxy_pass.*web' /etc/nginx/sites-available/e-remedium | head -60
