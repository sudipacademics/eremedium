#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
CID=$("${COMPOSE[@]}" ps -q backend)

# Ensure site-packages + apps have latest B2B files (from /tmp/cursor-mod-stage3 host sync already done)
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
APPS=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
test -f "$APPS/clinical_phase87_b2b_sales.py"
cp -f "$APPS/clinical_phase87_b2b_sales.py" "$SP/clinical_phase87_b2b_sales.py"
cp -f "$APPS/clinical_phase25.py" "$SP/clinical_phase25.py"
cp -f "$APPS/api.py" "$SP/api.py"
mkdir -p "$SP/doctype/b2b_collection_centre" "$SP/doctype/b2b_logistics_assignment" "$SP/doctype/b2b_sales_entry"
cp -rf "$APPS/doctype/b2b_collection_centre/." "$SP/doctype/b2b_collection_centre/"
cp -rf "$APPS/doctype/b2b_logistics_assignment/." "$SP/doctype/b2b_logistics_assignment/"
cp -rf "$APPS/doctype/b2b_sales_entry/." "$SP/doctype/b2b_sales_entry/"
bench --site health.localhost reload-doc "Health Ecosystem Core" doctype b2b_logistics_assignment
bench --site health.localhost reload-doc "Health Ecosystem Core" doctype b2b_collection_centre
bench --site health.localhost reload-doc "Health Ecosystem Core" doctype b2b_sales_entry
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales.list_b2b_collection_centres --kwargs "{\"user\":\"Administrator\",\"limit\":1}" || \
  ./env/bin/python - <<'"'"'PY'"'"'
import frappe
frappe.init(site="health.localhost", sites_path="sites")
frappe.connect()
print("exists_centre", frappe.db.exists("DocType", "B2B Collection Centre"))
print("exists_sales", frappe.db.exists("DocType", "B2B Sales Entry"))
print("exists_logistics", frappe.db.exists("DocType", "B2B Logistics Assignment"))
from health_ecosystem_core.health_ecosystem_core import clinical_phase87_b2b_sales as m
print("phase87", m.__file__)
frappe.destroy()
PY
'
"${COMPOSE[@]}" restart backend
echo RELOAD_B2B_OK
