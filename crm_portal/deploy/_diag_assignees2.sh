#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
echo SP=$SP
grep -n "def list_crm_portal_assignees" "$SP/clinical_people_access.py" || echo MISSING_IN_SP
grep -n "def list_crm_portal_assignees" apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_people_access.py || echo MISSING_IN_APPS
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_people_access.list_crm_portal_assignees
'
