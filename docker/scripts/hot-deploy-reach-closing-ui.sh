#!/bin/bash
# Deploy REACH Daily & Monthly Closing UI + expense-capable ERP closing APIs.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/reach-closing-ui}"
HEC=/opt/health-ecosystem/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

mkdir -p "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/sales_closing_report" \
  "$WEB/src/pages/sales"

[[ -f "$SRC/clinical_phase25.py" ]] && cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
[[ -f "$SRC/sales_closing_report.json" ]] && cp -f "$SRC/sales_closing_report.json" "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/sales_closing_report/sales_closing_report.json"
[[ -f "$SRC/SalesReportsPage.tsx" ]] && cp -f "$SRC/SalesReportsPage.tsx" "$WEB/src/pages/sales/SalesReportsPage.tsx"
[[ -f "$SRC/reach-portal.css" ]] && cp -f "$SRC/reach-portal.css" "$WEB/src/pages/sales/reach-portal.css"
[[ -f "$SRC/api.ts" ]] && cp -f "$SRC/api.ts" "$WEB/src/api.ts"

grep -q "ensure_closing_report_expense_fields" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
grep -q "expenses_json" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
grep -q "reach-closing-form" "$WEB/src/pages/sales/SalesReportsPage.tsx"

echo "=== Hot-copy ERP ==="
BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG="/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py" "$BCID:$APPS_PKG/clinical_phase25.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$APPS_PKG/api.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/sales_closing_report/sales_closing_report.json" \
  "$BCID:$APPS_PKG/doctype/sales_closing_report/sales_closing_report.json"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/clinical_phase25.py" "$SP/clinical_phase25.py"
cp -f "$APPS/api.py" "$SP/api.py"
mkdir -p "$SP/doctype/sales_closing_report"
cp -f "$APPS/doctype/sales_closing_report/sales_closing_report.json" "$SP/doctype/sales_closing_report/sales_closing_report.json"
./env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_closing_report_expense_fields, submit_closing_report; print(\"erp_ok\")"
'

echo "=== Ensure expense fields ==="
"${COMPOSE[@]}" exec -T backend bash -lc \
  "cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase25.ensure_closing_report_expense_fields" \
  || true

"${COMPOSE[@]}" restart backend

echo "=== Publish REACH dist ==="
if [[ -d "$SRC/dist" ]]; then
  TS=$(date +%Y%m%d-%H%M%S)
  rm -rf "$WEB/dist.pre-closing-$TS"
  cp -a "$WEB/dist" "$WEB/dist.pre-closing-$TS"
  rsync -a --delete "$SRC/dist/" "$WEB/dist/"
  if [[ -f /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh ]]; then
    bash /opt/health-ecosystem/docker/scripts/patch-sw-ffms-denylist.sh || true
  fi
fi

echo "=== Verify ==="
grep -l "reach-closing-form\|Submit Closing Report\|Other Expenses" "$WEB/dist/web-assets"/*.js 2>/dev/null | head -3 || true
curl -sS -o /dev/null -w "reach:%{http_code}\n" -H "Host: reach.e-remedium.in" http://127.0.0.1/ || true

echo REACH_CLOSING_UI_DEPLOY_OK
