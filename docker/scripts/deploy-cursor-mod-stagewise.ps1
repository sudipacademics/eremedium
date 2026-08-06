# Stagewise deploy Cursor Modification to live e-remedium.
# Usage:
#   .\docker\scripts\deploy-cursor-mod-stagewise.ps1 -Stage 1
#   .\docker\scripts\deploy-cursor-mod-stagewise.ps1 -Stage 2
#   .\docker\scripts\deploy-cursor-mod-stagewise.ps1 -Stage 3
#   .\docker\scripts\deploy-cursor-mod-stagewise.ps1 -Stage all
param(
  [ValidateSet('1', '2', '3', 'all')]
  [string]$Stage = '1'
)

$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'

function Deploy-Stage1 {
  $StageDir = Join-Path $env:TEMP 'cursor-mod-stage1'
  if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  Copy-Item "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core\clinical_phase25.py" "$StageDir\"
  Copy-Item "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core\api.py" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\server.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\hec-frappe-bridge.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\hard-delete-workflow.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\franchise-deboard-workflow.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\b2b-operations-workflow.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\admin-users-workflow.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\local-api\franchisee-directory-workflow.mjs" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\packages\utils\admin-rbac.ts" "$StageDir\"
  Copy-Item "$Root\docker\scripts\hot-deploy-cursor-mod-stage1.sh" "$StageDir\hot-deploy-cursor-mod-stage1.sh"

  Write-Host "=== Uploading Stage 1 (API + HEC, no UI rebuild) ==="
  scp -r $StageDir "${HostName}:/tmp/cursor-mod-stage1"
  scp "$Root\docker\scripts\hot-deploy-cursor-mod-stage1.sh" "${HostName}:/tmp/hot-deploy-cursor-mod-stage1.sh"
  ssh $HostName "sed -i 's/\r`$//' /tmp/hot-deploy-cursor-mod-stage1.sh; bash /tmp/hot-deploy-cursor-mod-stage1.sh /tmp/cursor-mod-stage1"
  Write-Host "=== Stage 1 DONE ==="
}

function Deploy-Stage2 {
  $StageDir = Join-Path $env:TEMP 'cursor-mod-stage2'
  if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  Copy-Item "$Root\apps_external\ffms\packages\utils\admin-rbac.ts" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\page.tsx" "$StageDir\admin-page.tsx"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\hard-delete-button.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\hard-delete.css" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\lead-directory.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\log-visit-directory.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\appointment-directory.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\agreement-queue.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\payment-operations.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\franchisee-directory.tsx" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\franchisee-directory.css" "$StageDir\"
  Copy-Item "$Root\apps_external\ffms\apps\admin-dashboard\app\b2b-operations.tsx" "$StageDir\"
  Copy-Item "$Root\docker\scripts\hot-deploy-cursor-mod-stage2.sh" "$StageDir\hot-deploy-cursor-mod-stage2.sh"

  Write-Host "=== Uploading Stage 2 (Admin UI rebuild) ==="
  scp -r $StageDir "${HostName}:/tmp/cursor-mod-stage2"
  scp "$Root\docker\scripts\hot-deploy-cursor-mod-stage2.sh" "${HostName}:/tmp/hot-deploy-cursor-mod-stage2.sh"
  ssh $HostName "sed -i 's/\r`$//' /tmp/hot-deploy-cursor-mod-stage2.sh; bash /tmp/hot-deploy-cursor-mod-stage2.sh /tmp/cursor-mod-stage2"
  Write-Host "=== Stage 2 DONE ==="
}

function Deploy-Stage3 {
  $StageDir = Join-Path $env:TEMP 'cursor-mod-stage3'
  if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  $Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
  Copy-Item "$Hec\clinical_phase87_b2b_sales.py" "$StageDir\"
  Copy-Item "$Hec\clinical_phase25.py" "$StageDir\"
  Copy-Item "$Hec\api.py" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_collection_centre\b2b_collection_centre.json" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_collection_centre\b2b_collection_centre.py" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_logistics_assignment\b2b_logistics_assignment.json" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_logistics_assignment\b2b_logistics_assignment.py" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_sales_entry\b2b_sales_entry.json" "$StageDir\"
  Copy-Item "$Hec\doctype\b2b_sales_entry\b2b_sales_entry.py" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\pages\sales\SalesB2bCentresPage.tsx" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\pages\sales\SalesB2bSalesPage.tsx" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\pages\sales\SalesReportsPage.tsx" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\components\SalesLayout.tsx" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\App.tsx" "$StageDir\"
  Copy-Item "$Root\health_web_app\src\api.ts" "$StageDir\"
  Copy-Item "$Root\docker\scripts\hot-deploy-cursor-mod-stage3.sh" "$StageDir\hot-deploy-cursor-mod-stage3.sh"

  Write-Host "=== Uploading Stage 3 (DocTypes migrate + REACH) ==="
  scp -r $StageDir "${HostName}:/tmp/cursor-mod-stage3"
  scp "$Root\docker\scripts\hot-deploy-cursor-mod-stage3.sh" "${HostName}:/tmp/hot-deploy-cursor-mod-stage3.sh"
  ssh $HostName "sed -i 's/\r`$//' /tmp/hot-deploy-cursor-mod-stage3.sh; bash /tmp/hot-deploy-cursor-mod-stage3.sh /tmp/cursor-mod-stage3"
  Write-Host "=== Stage 3 DONE ==="
}

switch ($Stage) {
  '1' { Deploy-Stage1 }
  '2' { Deploy-Stage2 }
  '3' { Deploy-Stage3 }
  'all' {
    Deploy-Stage1
    Deploy-Stage2
    Deploy-Stage3
  }
}
