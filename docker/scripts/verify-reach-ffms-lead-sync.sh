#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
RCID=$(docker compose -f docker-compose.yml -f docker-compose.ffms.yml ps -q rfms)
docker exec "$RCID" grep -c 'sales-visits/ingest' /app/apps/local-api/server.mjs
docker exec "$RCID" sh -c 'grep -R "Log Visit\|LogVisit" /app/apps/admin-dashboard/out 2>/dev/null | head -5 || echo NO_STATIC_MATCH'
curl -sS http://127.0.0.1:8090/api/v1/health
echo
# Confirm ERP has sync helper
BCID=$(docker compose -f docker-compose.yml -f docker-compose.ffms.yml ps -q backend)
docker exec "$BCID" bash -lc 'cd /home/frappe/frappe-bench/sites && ../env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import _sync_sales_lead_to_rfms; print(\"erp_sync_ok\")"'
echo VERIFY_OK
