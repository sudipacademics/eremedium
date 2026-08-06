#!/bin/bash
# Publish prebuilt REACH dist from /tmp/cursor-mod-reach-dist
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

WEB=/opt/health-ecosystem/health_web_app
SRC="${1:-/tmp/cursor-mod-reach-dist}"
TS=$(date +%Y%m%d-%H%M%S)

test -d "$SRC/dist" || { echo "MISSING_DIST at $SRC/dist"; ls -la "$SRC" || true; exit 1; }
test -f "$SRC/dist/index.html"

echo "=== Backup + publish REACH dist ==="
cp -a "$WEB/dist" "$WEB/dist.pre-cursor-mod-b2b-$TS" || true
rsync -a --delete "$SRC/dist/" "$WEB/dist/"

if [[ -f /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh ]]; then
  bash /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh || true
fi

echo "=== Verify strings in dist ==="
if grep -Rql "b2b-centres\|B2B Centres\|B2B Sales" "$WEB/dist"; then
  echo DIST_HAS_B2B
else
  echo DIST_MISSING_B2B
  exit 1
fi

curl -sS -o /dev/null -w "reach_root:%{http_code}\n" -H "Host: reach.e-remedium.in" http://127.0.0.1/ || true
curl -sS -o /dev/null -w "reach_b2b:%{http_code}\n" -H "Host: reach.e-remedium.in" http://127.0.0.1/sales/b2b-centres || true

echo CURSOR_MOD_REACH_PUBLISH_OK
