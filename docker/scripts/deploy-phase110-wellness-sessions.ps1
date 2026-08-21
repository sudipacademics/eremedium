# Deploy Phase 110: physio/aesthetic session cards + tele/yoga video (SPA + HEC).
$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'
$Stage = Join-Path $env:TEMP 'phase110-wellness'
$Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
$Web = "$Root\health_web_app"

Write-Host '=== Build SPA ==='
Push-Location $Web
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Pop-Location

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\dist" | Out-Null

Copy-Item "$Hec\clinical_phase110_wellness_sessions.py" $Stage
Copy-Item "$Hec\clinical_phase31_allied_health.py" $Stage
Copy-Item "$Hec\clinical_phase42_telemedicine.py" $Stage
Copy-Item "$Hec\clinical_yoga_subscriptions.py" $Stage
Copy-Item -Recurse "$Web\dist\*" "$Stage\dist\"
Copy-Item "$Root\docker\scripts\hot-deploy-phase110-wellness-sessions.sh" "$Stage\hot-deploy.sh"

Write-Host '=== Upload ==='
ssh $HostName 'rm -rf /tmp/phase110-wellness'
scp -r $Stage "${HostName}:/tmp/phase110-wellness"

Write-Host '=== Remote deploy ==='
ssh $HostName "sed -i 's/\r`$//' /tmp/phase110-wellness/hot-deploy.sh; bash /tmp/phase110-wellness/hot-deploy.sh /tmp/phase110-wellness"

Write-Host 'Done.'
Write-Host '  https://www.e-remedium.in/wellness/sessions'
Write-Host '  https://www.e-remedium.in/yoga-memberships'
Write-Host '  https://www.e-remedium.in/dashboard/session-ops'