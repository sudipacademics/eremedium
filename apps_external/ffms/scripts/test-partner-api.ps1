param(
  [string]$ApiBase = 'http://localhost:9080/api/v1',
  [string]$AdminEmail = 'admin@remediumlab.local',
  [string]$AdminPassword = 'Admin@12345',
  [string]$PartnerToken = '',
  [switch]$RegenerateToken,
  [switch]$ExportCsv
)

$ErrorActionPreference = 'Stop'

function Invoke-RfmsJson {
  param(
    [ValidateSet('GET', 'POST', 'PUT')]
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body
  )
  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
  }
  if ($Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }
  return Invoke-RestMethod @params
}

Write-Host "RFMS Partner API test" -ForegroundColor Cyan
Write-Host "API base: $ApiBase"

if (-not $PartnerToken) {
  Write-Host "Signing in as admin..." -ForegroundColor Yellow
  $challenge = Invoke-RfmsJson -Method POST -Url "$ApiBase/auth/otp/request" -Body @{
    email = $AdminEmail
    password = $AdminPassword
    role_type = 'officer'
  }
  $session = Invoke-RfmsJson -Method POST -Url "$ApiBase/auth/otp/verify" -Body @{
    challenge_id = $challenge.data.challenge_id
    otp = '123456'
  }
  $adminToken = $session.data.token
  Write-Host "Admin login OK." -ForegroundColor Green

  $settingsBody = @{
    enabled = $true
    rate_limit_per_minute = 60
    allowed_fields = @(
      'identifiers',
      'basic_details',
      'google_map_location_url',
      'territory',
      'webpage'
    )
    regenerate_token = [bool]$RegenerateToken
  }
  $settings = Invoke-RfmsJson -Method PUT -Url "$ApiBase/admin/franchisee-directory/api-settings" -Headers @{
    Authorization = "Bearer $adminToken"
  } -Body $settingsBody

  if ($settings.data.generated_token) {
    $PartnerToken = $settings.data.generated_token
    Write-Host "New partner token generated. Copy it now:" -ForegroundColor Green
    Write-Host $PartnerToken
  } else {
    Write-Host "Partner API enabled. No new token was generated." -ForegroundColor Yellow
    Write-Host "Re-run with -RegenerateToken to mint a fresh token, or pass -PartnerToken <token>."
    exit 1
  }
}

$headers = @{ Authorization = "Bearer $PartnerToken" }

Write-Host "Testing GET /partner/franchisees ..." -ForegroundColor Yellow
$list = Invoke-RfmsJson -Method GET -Url "$ApiBase/partner/franchisees?page_size=20" -Headers $headers
Write-Host "List OK. Returned $($list.data.items.Count) franchisee(s)." -ForegroundColor Green
$list.data.items | ConvertTo-Json -Depth 10

$firstId = $list.data.items[0].identifiers.franchisee_id
if ($firstId) {
  Write-Host "Testing GET /partner/franchisees/$firstId ..." -ForegroundColor Yellow
  $detail = Invoke-RfmsJson -Method GET -Url "$ApiBase/partner/franchisees/$([uri]::EscapeDataString($firstId))" -Headers $headers
  Write-Host "Detail OK." -ForegroundColor Green
  $detail.data.record | ConvertTo-Json -Depth 10
  if ($detail.data.record.google_map_location_url) {
    Write-Host "google_map_location_url: $($detail.data.record.google_map_location_url)" -ForegroundColor Green
  } else {
    Write-Host "google_map_location_url not present in this record (field disabled, empty, or no location saved)." -ForegroundColor Yellow
  }
} else {
  Write-Host "No onboarded franchisees in the directory yet, so detail endpoint was skipped." -ForegroundColor Yellow
}

if ($ExportCsv) {
  $rows = foreach ($item in $list.data.items) {
    [pscustomobject]@{
      franchisee_id = $item.identifiers.franchisee_id
      application_number = $item.identifiers.application_number
      business_name = $item.basic_details.business_name
      franchise_model = $item.basic_details.franchise_model
      district = $item.basic_details.district
      pincode = $item.basic_details.pincode
      google_map_location_url = $item.google_map_location_url
      territory = $item.territory.allotted_territory
      webpage_url = $item.webpage.public_url
    }
  }
  $csvPath = Join-Path (Get-Location) 'partner-franchisees-export.csv'
  $rows | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
  Write-Host "CSV exported to $csvPath" -ForegroundColor Green
  Write-Host "Open this file in Excel to review partner API data."
}

Write-Host "Partner API test complete." -ForegroundColor Cyan
