#!/bin/bash
# Cursor Modification — Stage 3: B2B DocTypes migrate + REACH UI + closing hooks.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/cursor-mod-stage3}"
HEC=/opt/health-ecosystem/health_ecosystem_core
WEB=/opt/health-ecosystem/health_web_app
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

echo "=== Stage 3: sync HEC DocTypes + phase87 + REACH ==="
DT="$HEC/health_ecosystem_core/health_ecosystem_core/doctype"
mkdir -p \
  "$DT/b2b_collection_centre" \
  "$DT/b2b_logistics_assignment" \
  "$DT/b2b_sales_entry" \
  "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$WEB/src/pages/sales" \
  "$WEB/src/components"

cp -f "$SRC/clinical_phase87_b2b_sales.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase87_b2b_sales.py"
cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
cp -f "$SRC/b2b_collection_centre.json" "$DT/b2b_collection_centre/b2b_collection_centre.json"
cp -f "$SRC/b2b_collection_centre.py" "$DT/b2b_collection_centre/b2b_collection_centre.py"
cp -f "$SRC/b2b_logistics_assignment.json" "$DT/b2b_logistics_assignment/b2b_logistics_assignment.json"
cp -f "$SRC/b2b_logistics_assignment.py" "$DT/b2b_logistics_assignment/b2b_logistics_assignment.py"
cp -f "$SRC/b2b_sales_entry.json" "$DT/b2b_sales_entry/b2b_sales_entry.json"
cp -f "$SRC/b2b_sales_entry.py" "$DT/b2b_sales_entry/b2b_sales_entry.py"
cp -f "$SRC/SalesB2bCentresPage.tsx" "$WEB/src/pages/sales/SalesB2bCentresPage.tsx"
cp -f "$SRC/SalesB2bSalesPage.tsx" "$WEB/src/pages/sales/SalesB2bSalesPage.tsx"
cp -f "$SRC/SalesReportsPage.tsx" "$WEB/src/pages/sales/SalesReportsPage.tsx"
cp -f "$SRC/SalesLayout.tsx" "$WEB/src/components/SalesLayout.tsx"
cp -f "$SRC/App.tsx" "$WEB/src/App.tsx"
cp -f "$SRC/api.ts" "$WEB/src/api.ts"

echo "=== Stage 3: hot-copy ERP + migrate DocTypes ==="
BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG="/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase87_b2b_sales.py" "$BCID:$APPS_PKG/clinical_phase87_b2b_sales.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py" "$BCID:$APPS_PKG/clinical_phase25.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$APPS_PKG/api.py"
docker exec "$BCID" mkdir -p \
  "$APPS_PKG/doctype/b2b_collection_centre" \
  "$APPS_PKG/doctype/b2b_logistics_assignment" \
  "$APPS_PKG/doctype/b2b_sales_entry"
docker cp "$DT/b2b_collection_centre/." "$BCID:$APPS_PKG/doctype/b2b_collection_centre/"
docker cp "$DT/b2b_logistics_assignment/." "$BCID:$APPS_PKG/doctype/b2b_logistics_assignment/"
docker cp "$DT/b2b_sales_entry/." "$BCID:$APPS_PKG/doctype/b2b_sales_entry/"

"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/clinical_phase87_b2b_sales.py" "$SP/clinical_phase87_b2b_sales.py"
cp -f "$APPS/clinical_phase25.py" "$SP/clinical_phase25.py"
cp -f "$APPS/api.py" "$SP/api.py"
mkdir -p "$SP/doctype/b2b_collection_centre" "$SP/doctype/b2b_logistics_assignment" "$SP/doctype/b2b_sales_entry"
cp -rf "$APPS/doctype/b2b_collection_centre/." "$SP/doctype/b2b_collection_centre/"
cp -rf "$APPS/doctype/b2b_logistics_assignment/." "$SP/doctype/b2b_logistics_assignment/"
cp -rf "$APPS/doctype/b2b_sales_entry/." "$SP/doctype/b2b_sales_entry/"
bench --site health.localhost migrate
./env/bin/python <<PY
import frappe
from frappe.utils import get_sites
frappe.init(site=get_sites()[0])
frappe.connect()
for dt in ("B2B Collection Centre", "B2B Logistics Assignment", "B2B Sales Entry"):
    print(dt, "exists" if frappe.db.exists("DocType", dt) else "MISSING")
from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import list_b2b_collection_centres
print("phase87_import_ok")
frappe.destroy()
PY
'
"${COMPOSE[@]}" restart backend

echo "=== Stage 3: REACH web rebuild (if service exists) ==="
if "${COMPOSE[@]}" config --services 2>/dev/null | grep -qx health_web_app; then
  WC=$("${COMPOSE[@]}" ps -q health_web_app || true)
  if [[ -n "${WC}" ]]; then
    docker cp "$WEB/src/pages/sales/SalesB2bCentresPage.tsx" "$WC:/app/src/pages/sales/SalesB2bCentresPage.tsx" || true
    docker cp "$WEB/src/pages/sales/SalesB2bSalesPage.tsx" "$WC:/app/src/pages/sales/SalesB2bSalesPage.tsx" || true
    docker cp "$WEB/src/pages/sales/SalesReportsPage.tsx" "$WC:/app/src/pages/sales/SalesReportsPage.tsx" || true
    docker cp "$WEB/src/components/SalesLayout.tsx" "$WC:/app/src/components/SalesLayout.tsx" || true
    docker cp "$WEB/src/App.tsx" "$WC:/app/src/App.tsx" || true
    docker cp "$WEB/src/api.ts" "$WC:/app/src/api.ts" || true
  fi
  "${COMPOSE[@]}" up -d --build health_web_app || "${COMPOSE[@]}" restart health_web_app || true
else
  echo "health_web_app service not in compose; sources synced on host only"
fi

sleep 8
echo "CURSOR_MOD_STAGE3_OK"
echo "REACH: https://reach.e-remedium.in/sales/b2b-centres"
echo "REACH: https://reach.e-remedium.in/sales/b2b-sales"
