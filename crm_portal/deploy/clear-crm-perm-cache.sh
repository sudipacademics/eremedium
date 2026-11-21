#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
grep -o 'crm-gate.js?v=[0-9]*' /opt/health-ecosystem/crm_portal/dist/index.html || true
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
SITE=$(tr -d "\r\n" < sites/currentsite.txt)
cd sites
../env/bin/python <<PY
import frappe
frappe.init(site="$SITE")
frappe.connect()
from health_ecosystem_core.health_ecosystem_core.clinical_people_access import PERM_CACHE
frappe.cache().hdel(PERM_CACHE, "sganguly@gmail.com")
print("CACHE_CLEARED")
frappe.destroy()
PY
'
