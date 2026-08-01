#!/bin/bash
# Deploy Reach (reach.e-remedium.in) Leads + Log visit UI enhancement.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

WEB=/opt/health-ecosystem/health_web_app
SRC="${1:-/tmp/reach-ui}"
TS=$(date +%Y%m%d-%H%M%S)

[[ -d "$SRC/dist" ]] || { echo "Missing $SRC/dist"; exit 1; }

echo "=== Backup current dist ==="
rm -rf "$WEB/dist.pre-reach-$TS"
cp -a "$WEB/dist" "$WEB/dist.pre-reach-$TS"

echo "=== Sync Reach sources ==="
mkdir -p "$WEB/src/pages/sales" "$WEB/src/components"
[[ -f "$SRC/SalesLayout.tsx" ]] && cp -f "$SRC/SalesLayout.tsx" "$WEB/src/components/SalesLayout.tsx"
[[ -f "$SRC/SalesLeadsPage.tsx" ]] && cp -f "$SRC/SalesLeadsPage.tsx" "$WEB/src/pages/sales/SalesLeadsPage.tsx"
[[ -f "$SRC/SalesVisitPage.tsx" ]] && cp -f "$SRC/SalesVisitPage.tsx" "$WEB/src/pages/sales/SalesVisitPage.tsx"
[[ -f "$SRC/reach-portal.css" ]] && cp -f "$SRC/reach-portal.css" "$WEB/src/pages/sales/reach-portal.css"

echo "=== Publish dist ==="
rsync -a --delete "$SRC/dist/" "$WEB/dist/"

if [[ -f /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh ]]; then
  bash /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh || true
fi

echo "=== Verify baked strings ==="
grep -R "reach-shell\|reach-form-grid\|Add new lead\|Log field visit\|Franchise leads" "$WEB/dist" 2>/dev/null | head -12 || true

echo "=== Smoke reach host ==="
curl -sS -o /dev/null -w "reach:%{http_code}\n" -H "Host: reach.e-remedium.in" http://127.0.0.1/ || true
curl -sS -o /dev/null -w "reach_https:%{http_code}\n" --resolve reach.e-remedium.in:443:127.0.0.1 https://reach.e-remedium.in/ || true

echo "REACH_UI_DEPLOY_OK"
