#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_people_access.list_crm_portal_assignees
'
