#!/bin/bash
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/popular-diag}"
WEB=/opt/health-ecosystem/health_web_app
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$WEB/src/pages"
[[ -f "$SRC/HomePage.tsx" ]] && cp -f "$SRC/HomePage.tsx" "$WEB/src/pages/HomePage.tsx"
[[ -f "$SRC/styles.css" ]] && cp -f "$SRC/styles.css" "$WEB/src/styles.css"
[[ -d "$SRC/dist" ]] || { echo "Missing dist"; exit 1; }
cp -a "$WEB/dist" "$WEB/dist.pre-popular-diag-$TS"
rsync -a --delete "$SRC/dist/" "$WEB/dist/"
if [[ -f /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh ]]; then
  bash /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh || true
fi
grep -l "popular-diag-scroll\|popular-diag-card" "$WEB/dist/web-assets"/*.{js,css} 2>/dev/null | head -5 || true
curl -sS -o /dev/null -w "www:%{http_code}\n" -H "Host: www.e-remedium.in" http://127.0.0.1/ || true
echo POPULAR_DIAG_CAROUSEL_DEPLOY_OK
