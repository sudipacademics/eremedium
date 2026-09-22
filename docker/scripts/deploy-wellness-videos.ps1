# Deploy Phase 114 wellness video CMS (DocType + SPA) to e-remedium.in
$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'
$Stage = Join-Path $env:TEMP 'wellness-videos'
$Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
$Web = "$Root\health_web_app"

Write-Host '=== Build SPA ==='
Push-Location $Web
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Pop-Location

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\dist" | Out-Null

Copy-Item "$Hec\clinical_phase114_wellness_videos.py" $Stage
Copy-Item "$Hec\hooks.py" $Stage
Copy-Item -Recurse "$Web\dist\*" "$Stage\dist\"
Copy-Item "$Root\docker\scripts\hot-deploy-wellness-videos.sh" "$Stage\hot-deploy.sh"

Write-Host '=== Upload ==='
ssh $HostName 'rm -rf /tmp/wellness-videos'
scp -r $Stage "${HostName}:/tmp/wellness-videos"

Write-Host '=== Remote deploy ==='
ssh $HostName "sed -i 's/\r`$//' /tmp/wellness-videos/hot-deploy.sh; bash /tmp/wellness-videos/hot-deploy.sh /tmp/wellness-videos"

Write-Host 'Done.'
Write-Host '  Desk: https://erp.e-remedium.in/app/hec-wellness-video'
Write-Host '  Public: https://www.e-remedium.in/wellness/aesthetics#treatment-videos'
