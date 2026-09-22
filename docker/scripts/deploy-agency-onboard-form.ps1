# Deploy agency onboard form CMS + SPA to e-remedium.in
$ErrorActionPreference = 'Stop'
$Root = 'C:\develop\My_Lab_System'
$HostName = 'root@167.233.108.90'
$Stage = Join-Path $env:TEMP 'agency-onboard-form'
$Hec = "$Root\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core"
$Web = "$Root\health_web_app"

Write-Host '=== Build SPA ==='
Push-Location $Web
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Pop-Location

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\dist" | Out-Null
Copy-Item "$Hec\clinical_phase115_agency_onboard_form.py" $Stage
Copy-Item -Recurse "$Web\dist\*" "$Stage\dist\"
Copy-Item "$Root\docker\scripts\hot-deploy-agency-onboard-form.sh" "$Stage\hot-deploy.sh"

Write-Host '=== Upload ==='
ssh $HostName 'rm -rf /tmp/agency-onboard-form'
scp -r $Stage "${HostName}:/tmp/agency-onboard-form"

Write-Host '=== Remote deploy ==='
ssh $HostName "sed -i 's/\r`$//' /tmp/agency-onboard-form/hot-deploy.sh; bash /tmp/agency-onboard-form/hot-deploy.sh /tmp/agency-onboard-form"

Write-Host 'Done.'
Write-Host '  Public form: https://www.e-remedium.in/agents'
Write-Host '  Desk forms:  https://erp.e-remedium.in/app/agency-onboard-form'
Write-Host '  Submissions: https://erp.e-remedium.in/app/agency-onboard-submission'
Write-Host '  Agent app:   https://www.e-remedium.in/agents/app'
