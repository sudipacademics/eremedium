@echo off
REM Deploy Smilecure CRM to crm.e-remedium.in (same Hetzner host).
REM Run this from a terminal where "ssh root@167.233.108.90" already works.

setlocal
cd /d "%~dp0"

echo Building...
call npm run build
if errorlevel 1 exit /b 1

echo Uploading to server...
ssh eremedium "rm -rf /tmp/crm_portal && mkdir -p /tmp/crm_portal"
if errorlevel 1 (
  echo.
  echo SSH failed. Use the eremedium host alias that already works for care/ops deploys.
  echo Example: ssh eremedium
  exit /b 1
)

scp -r dist nginx deploy eremedium:/tmp/crm_portal/
if errorlevel 1 exit /b 1

echo Installing nginx site + Let's Encrypt certificate...
ssh eremedium "sed -i 's/\r$//' /tmp/crm_portal/deploy/install.sh && bash /tmp/crm_portal/deploy/install.sh"
if errorlevel 1 exit /b 1

echo.
echo Done. Open https://crm.e-remedium.in
endlocal
