#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'curl -sS -X POST "http://localhost:8000/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey" -H "X-Frappe-Site-Name: health.localhost" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "symptoms=fever and cough for 2 days"' 2>&1 | grep -vE 'version.*obsolete|^time=' | head -c 2000
echo
echo "---"
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician.smoke_phase66' 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -40
