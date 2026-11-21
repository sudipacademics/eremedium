#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
"${COMPOSE[@]}" exec -T backend bash -lc '
cd /home/frappe/frappe-bench
./env/bin/python <<PY
from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_list_reach_reps
reps = crm_list_reach_reps()
print("REPS", len(reps))
if reps:
    print("SAMPLE", reps[0].get("display_name") or reps[0].get("full_name") or reps[0].get("name"))
PY
'
echo VERIFY_OK
