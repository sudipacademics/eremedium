#!/bin/bash
# Safe incremental update — does NOT recreate site, does NOT docker compose down.
# Only syncs Python app code, migrates DB, seeds new data, restarts app workers.
#
# On desktop (PowerShell) upload app first:
#   scp -r "C:\Users\91801\OneDrive\Desktop\My_Lab_System\health_ecosystem_core" root@167.233.108.90:/root/My_Lab_System/
#   scp -r "C:\Users\91801\OneDrive\Desktop\My_Lab_System\docker\scripts" root@167.233.108.90:/root/My_Lab_System/docker/
#
# On server:
#   cd /root/My_Lab_System/docker && chmod +x safe-update-app.sh && ./safe-update-app.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SITE="${FRAPPE_SITE:-health.localhost}"

echo "=== Safe update for site: $SITE ==="
echo "This will NOT delete volumes, recreate site, or run docker compose down."

if ! docker compose ps backend 2>/dev/null | grep -q Up; then
  echo "Backend is not running. Starting existing stack only..."
  docker compose up -d backend queue-short queue-long scheduler frontend
  sleep 6
fi

echo "=== 1. Verify app mount ==="
docker compose exec -T backend bash -lc '
  test -f /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/hooks.py \
    || { echo "ERROR: health_ecosystem_core not mounted. SCP it first."; exit 1; }
'

echo "=== 2. Pip install app (no site wipe; self-contained, no /scripts dependency) ==="
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  rm -rf /tmp/hec_reinstall
  cp -a apps/health_ecosystem_core /tmp/hec_reinstall
  ./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
  rm -rf /tmp/hec_reinstall
  ./env/bin/python -c "import health_ecosystem_core; print(\"health_ecosystem_core reinstalled\")"
  grep -q health_ecosystem_core sites/apps.txt || echo health_ecosystem_core >> sites/apps.txt
'

echo "=== 3. Check site exists ==="
if ! docker compose exec -T backend bench --site "$SITE" list-apps >/dev/null 2>&1; then
  echo "ERROR: Site $SITE does not exist. Do NOT run deploy-on-server.sh blindly."
  echo "       Tell the agent your actual site name: docker compose exec backend bench --site all list-sites"
  exit 1
fi

echo "=== 4. Migrate (adds new DocTypes/fields only) ==="
docker compose exec -T backend bench --site "$SITE" migrate

echo "=== 5. Seed operational data (idempotent) ==="
docker compose exec -T backend bench --site "$SITE" execute \
  health_ecosystem_core.health_ecosystem_core.init.setup_system || true

echo "=== 6. Clear cache + restart workers ==="
docker compose exec -T backend bench --site "$SITE" clear-cache
docker compose restart backend queue-short queue-long scheduler

echo ""
echo "=== Safe update complete ==="
echo "Existing site data preserved. Test: curl -s http://localhost:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.get_lab_test_catalog -H \"X-Frappe-Site-Name: $SITE\""
