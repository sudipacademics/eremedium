@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
echo Closing any older RFMS local services...
for %%P in (8080 3000 3001 3002) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    for /f "tokens=1" %%B in ('tasklist /FI "PID eq %%A" /NH ^| findstr /I "node.exe"') do (
      echo Closing previous RFMS Node service on port %%P...
      taskkill /PID %%A /F >nul 2>nul
    )
  )
)
set "RFMS_PORT_BUSY="
for %%P in (8080 3000 3001 3002) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do set "RFMS_PORT_BUSY=%%P"
)
if defined RFMS_PORT_BUSY (
  echo.
  echo A previous RFMS service still owns port !RFMS_PORT_BUSY! and Windows did not allow it to close.
  echo Right-click run-admin.cmd and choose Run as administrator, then start it once more.
  echo This is required only because the old RFMS process is protected by Windows.
  pause
  exit /b 1
)
echo Preparing RFMS websites...
call npm.cmd run build --workspace @rfms/marketing-web --cache .\work\npm-cache
if errorlevel 1 goto :build_error
call npm.cmd run build --workspace @rfms/franchise-portal --cache .\work\npm-cache
if errorlevel 1 goto :build_error
call npm.cmd run build --workspace @rfms/admin-dashboard --cache .\work\npm-cache
if errorlevel 1 goto :build_error
echo Starting RFMS local API and all websites...
echo Keep this window open while using RFMS.
call npm.cmd run dev:api
if errorlevel 1 goto :service_error
echo.
echo RFMS Local API stopped. Read any message above, then press a key to close this window.
pause >nul
exit /b

:build_error
echo.
echo RFMS websites could not be built. Read the message above.
pause
exit /b 1

:service_error
echo.
echo RFMS could not start because an older local service is still open.
echo Close every earlier RFMS command window, then run run-admin.cmd once more.
pause
exit /b 1
