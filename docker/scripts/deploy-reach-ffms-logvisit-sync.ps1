# Hot-deploy FFMS ↔ Reach Log Visit assign/sync fixes.
$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'
$Stage = Join-Path $env:TEMP 'reach-ffms-logvisit'
$Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
$Pkg = "$Root\health_ecosystem_core\health_ecosystem_core"
$Ffms = "$Root\apps_external\ffms"

Write-Host '=== Stage files ==='
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item "$Hec\clinical_phase25.py" $Stage
Copy-Item "$Pkg\hooks.py" $Stage
Copy-Item "$Ffms\apps\local-api\server.mjs" $Stage

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$Stage\hot-deploy.sh", (@'
#!/usr/bin/env bash
set -euo pipefail
STAGE="${1:-/tmp/reach-ffms-logvisit}"
B="${BACKEND_CONTAINER:-docker-backend-1}"
R="${RFMS_CONTAINER:-docker-rfms-1}"
APP=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core
HOOKS_APP=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/hooks.py
HOOKS_SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/hooks.py
TS=$(date +%Y%m%d-%H%M%S)

echo "== hot-copy ERP clinical_phase25 + hooks =="
docker cp "$STAGE/clinical_phase25.py" "$B:$APP/clinical_phase25.py"
docker cp "$STAGE/clinical_phase25.py" "$B:$SP/clinical_phase25.py"
if docker exec "$B" test -d "$SP/health_ecosystem_core"; then
  docker cp "$STAGE/clinical_phase25.py" "$B:$SP/health_ecosystem_core/clinical_phase25.py"
fi
docker cp "$STAGE/hooks.py" "$B:$HOOKS_APP"
docker cp "$STAGE/hooks.py" "$B:$HOOKS_SP" 2>/dev/null || true
if docker exec "$B" test -d /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core; then
  docker cp "$STAGE/hooks.py" "$B:/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core/hooks.py" 2>/dev/null || true
fi
docker exec "$B" bash -lc 'find /home/frappe/frappe-bench/apps/health_ecosystem_core /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true'
docker restart "$B"

echo "== hot-copy RFMS server =="
docker cp "$STAGE/server.mjs" "$R:/app/apps/local-api/server.mjs"
docker restart "$R"
sleep 20

echo "== clear Frappe cache / reload hooks =="
docker exec -u frappe "$B" bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/bench --site health.localhost clear-cache && ./env/bin/bench --site health.localhost clear-website-cache' || true

echo "== import smoke =="
docker exec -u frappe "$B" bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python -c "
from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
    create_assigned_log_visit,
    resolve_sales_rep_profile_id,
    on_franchise_sales_lead_update,
)
assert callable(on_franchise_sales_lead_update)
assert callable(create_assigned_log_visit)
print(\"ERP_OK\")
"'

echo REACH_FFMS_LOGVISIT_DEPLOY_OK
'@ -replace "`r`n","`n"), $utf8)

Write-Host '=== Upload ==='
ssh $HostName 'rm -rf /tmp/reach-ffms-logvisit'
scp -r $Stage "${HostName}:/tmp/reach-ffms-logvisit"

Write-Host '=== Remote deploy ==='
ssh $HostName "sed -i 's/\r`$//' /tmp/reach-ffms-logvisit/hot-deploy.sh; bash /tmp/reach-ffms-logvisit/hot-deploy.sh /tmp/reach-ffms-logvisit"
Write-Host 'Done.'
