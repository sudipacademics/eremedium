# Deploy Remedium Care (Phase 113 + immersive SPA) to e-remedium.in
$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'
$Stage = Join-Path $env:TEMP 'remedium-care'
$Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
$Web = "$Root\health_web_app"

Write-Host '=== Build SPA ==='
Push-Location $Web
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Pop-Location

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\dist" | Out-Null

Copy-Item "$Hec\clinical_phase113_remedium_care.py" $Stage
Copy-Item "$Hec\clinical_phase110_wellness_sessions.py" $Stage
Copy-Item "$Hec\clinical_phase31_allied_health.py" $Stage
Copy-Item -Recurse "$Web\dist\*" "$Stage\dist\"
Copy-Item "$Root\docker\scripts\hot-deploy-remedium-care.sh" "$Stage\hot-deploy.sh"

Write-Host '=== Upload ==='
ssh $HostName 'rm -rf /tmp/remedium-care'
scp -r $Stage "${HostName}:/tmp/remedium-care"

Write-Host '=== Remote deploy ==='
ssh $HostName "sed -i 's/\r`$//' /tmp/remedium-care/hot-deploy.sh; bash /tmp/remedium-care/hot-deploy.sh /tmp/remedium-care"

Write-Host 'Done.'
Write-Host '  https://www.e-remedium.in/wellness/care'
Write-Host '  https://e-remedium.in/wellness/care'
Write-Host '  https://www.e-remedium.in/dashboard/care-ops'
