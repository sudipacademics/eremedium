#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker
echo "=== smoke ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician.smoke_phase66'
echo
echo "=== public start ==="
curl -sS -L -X POST 'https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey' \
  -d 'symptoms=I+have+fever' | head -c 1800
echo
echo DONE
