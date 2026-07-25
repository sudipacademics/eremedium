#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker

echo "=== locate apps mount on host ==="
BACKEND_ID=$(docker compose ps -q backend)
docker inspect "$BACKEND_ID" --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' | tee /tmp/hec-mounts.txt

APPS_HOST=""
while read -r src arrow dest; do
  if [ "$dest" = "/home/frappe/frappe-bench/apps/health_ecosystem_core" ] || [[ "$dest" == *"/apps/health_ecosystem_core" ]]; then
    APPS_HOST="$src"
  fi
  if [[ "$dest" == "/home/frappe/frappe-bench/apps" ]]; then
    APPS_HOST="$src/health_ecosystem_core"
  fi
done < /tmp/hec-mounts.txt

# Fallback: copy via docker cp into running container apps tree
DEST_IN="/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core"
echo "APPS_HOST=${APPS_HOST:-unknown}"
echo "DEST_IN=$DEST_IN"

echo "=== copy staged files into container apps tree ==="
docker compose cp /tmp/hec-journey/clinical_openai.py "backend:$DEST_IN/clinical_openai.py"
docker compose cp /tmp/hec-journey/clinical_phase66_ai_physician.py "backend:$DEST_IN/clinical_phase66_ai_physician.py"

# Also refresh host tree if it exists (for operators)
if [ -d /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core ]; then
  cp -f /tmp/hec-journey/clinical_openai.py /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/
  cp -f /tmp/hec-journey/clinical_phase66_ai_physician.py /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/
fi

echo "=== safe-update ==="
./safe-update-app.sh

echo "=== smoke phase66 ==="
sleep 4
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician.smoke_phase66' || true

echo "=== HTTP start journey ==="
curl -sS -X POST 'http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey' \
  -H 'X-Frappe-Site-Name: health.localhost' \
  -d 'symptoms=I+have+fever+with+body+ache' | head -c 2200
echo
echo DONE
