#!/bin/bash
# Phase 89 — Bidirectional REACH↔FFMS Lead + Log Visit sync.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/reach-ffms-bidirectional}"
HEC=/opt/health-ecosystem/health_ecosystem_core
FFMS=/opt/health-ecosystem/apps_external/ffms
WEB=/opt/health-ecosystem/health_web_app
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

mkdir -p "$HEC/health_ecosystem_core/health_ecosystem_core" \
  "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/field_sales_visit" \
  "$FFMS/apps/local-api" \
  "$FFMS/apps/admin-dashboard/app" \
  "$WEB/src/pages/sales" \
  "$WEB/src"

[[ -f "$SRC/clinical_phase25.py" ]] && cp -f "$SRC/clinical_phase25.py" "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py"
[[ -f "$SRC/api.py" ]] && cp -f "$SRC/api.py" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
[[ -f "$SRC/field_sales_visit.json" ]] && cp -f "$SRC/field_sales_visit.json" "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/field_sales_visit/field_sales_visit.json"
[[ -f "$SRC/server.mjs" ]] && cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
[[ -f "$SRC/hec-frappe-bridge.mjs" ]] && cp -f "$SRC/hec-frappe-bridge.mjs" "$FFMS/apps/local-api/hec-frappe-bridge.mjs"
[[ -f "$SRC/leads-ads-workflow.mjs" ]] && cp -f "$SRC/leads-ads-workflow.mjs" "$FFMS/apps/local-api/leads-ads-workflow.mjs"
[[ -f "$SRC/admin-users-workflow.mjs" ]] && cp -f "$SRC/admin-users-workflow.mjs" "$FFMS/apps/local-api/admin-users-workflow.mjs"
[[ -f "$SRC/log-visit-directory.tsx" ]] && cp -f "$SRC/log-visit-directory.tsx" "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx"
[[ -f "$SRC/log-visit-directory.css" ]] && cp -f "$SRC/log-visit-directory.css" "$FFMS/apps/admin-dashboard/app/log-visit-directory.css"
[[ -f "$SRC/SalesVisitPage.tsx" ]] && cp -f "$SRC/SalesVisitPage.tsx" "$WEB/src/pages/sales/SalesVisitPage.tsx"
[[ -f "$SRC/api.ts" ]] && cp -f "$SRC/api.ts" "$WEB/src/api.ts"

grep -q "ffms_assign_reach_lead" "$HEC/health_ecosystem_core/health_ecosystem_core/api.py"
grep -q "assignReachLeadViaErp" "$FFMS/apps/local-api/hec-frappe-bridge.mjs"
grep -q "sales-visits/reach-reps" "$FFMS/apps/local-api/server.mjs"
grep -q "Assigned Log Visits" "$WEB/src/pages/sales/SalesVisitPage.tsx"

echo "=== Hot-copy ERP ==="
BCID=$("${COMPOSE[@]}" ps -q backend)
APPS_PKG="/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/clinical_phase25.py" "$BCID:$APPS_PKG/clinical_phase25.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/api.py" "$BCID:$APPS_PKG/api.py"
docker cp "$HEC/health_ecosystem_core/health_ecosystem_core/doctype/field_sales_visit/field_sales_visit.json" \
  "$BCID:$APPS_PKG/doctype/field_sales_visit/field_sales_visit.json"
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APPS/clinical_phase25.py" "$SP/clinical_phase25.py"
cp -f "$APPS/api.py" "$SP/api.py"
mkdir -p "$SP/doctype/field_sales_visit"
cp -f "$APPS/doctype/field_sales_visit/field_sales_visit.json" "$SP/doctype/field_sales_visit/field_sales_visit.json"
./env/bin/python <<PY
import frappe
from frappe.utils import get_sites
frappe.init(site=get_sites()[0])
frappe.connect()
from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
    ensure_reach_ffms_visit_fields,
    ffms_list_reach_reps,
)
ensure_reach_ffms_visit_fields()
print("ensure_ok", len(ffms_list_reach_reps()))
print("bridge_ok")
frappe.destroy()
PY
'
"${COMPOSE[@]}" restart backend

echo "=== Hot-copy RFMS API ==="
RCID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/server.mjs" "$RCID:/app/apps/local-api/server.mjs"
docker cp "$FFMS/apps/local-api/hec-frappe-bridge.mjs" "$RCID:/app/apps/local-api/hec-frappe-bridge.mjs"
docker cp "$FFMS/apps/local-api/leads-ads-workflow.mjs" "$RCID:/app/apps/local-api/leads-ads-workflow.mjs"
docker cp "$FFMS/apps/local-api/admin-users-workflow.mjs" "$RCID:/app/apps/local-api/admin-users-workflow.mjs"
docker cp "$FFMS/apps/admin-dashboard/app/log-visit-directory.tsx" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.tsx"
docker cp "$FFMS/apps/admin-dashboard/app/log-visit-directory.css" "$RCID:/app/apps/admin-dashboard/app/log-visit-directory.css"
"${COMPOSE[@]}" restart rfms

echo "=== Rebuild RFMS admin + health_web_app (REACH) ==="
if [[ "${RFMS_REBUILD:-1}" == "1" ]]; then
  "${COMPOSE[@]}" up -d --build rfms
fi
if [[ "${REACH_REBUILD:-1}" == "1" ]]; then
  # Sync REACH sources into web image volume / rebuild frontend when compose target exists
  if "${COMPOSE[@]}" config --services 2>/dev/null | grep -qx health_web_app; then
    WC=$("${COMPOSE[@]}" ps -q health_web_app || true)
    if [[ -n "${WC}" ]]; then
      docker cp "$WEB/src/pages/sales/SalesVisitPage.tsx" "$WC:/app/src/pages/sales/SalesVisitPage.tsx" || true
      docker cp "$WEB/src/api.ts" "$WC:/app/src/api.ts" || true
      "${COMPOSE[@]}" up -d --build health_web_app || "${COMPOSE[@]}" restart health_web_app || true
    fi
  fi
  # Also copy into common nginx/static build path used by reach portal
  if [[ -d /opt/health-ecosystem/health_web_app ]]; then
    cp -f "$WEB/src/pages/sales/SalesVisitPage.tsx" /opt/health-ecosystem/health_web_app/src/pages/sales/SalesVisitPage.tsx
    cp -f "$WEB/src/api.ts" /opt/health-ecosystem/health_web_app/src/api.ts
  fi
fi

sleep 8
for i in $(seq 1 40); do
  code=$(curl -sS -o /tmp/rfms_health_bi.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  [[ "$code" == "200" ]] && break
  sleep 3
done

# Smoke: ERP method import path
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
./env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.api import ffms_list_reach_reps, ffms_assign_reach_lead, ffms_update_lead_status; print(\"erp_api_ok\")"
'

echo REACH_FFMS_BIDIRECTIONAL_DEPLOY_OK
