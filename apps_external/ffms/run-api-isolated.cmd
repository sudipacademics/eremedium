@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if not exist "node_modules\next" (
  echo Dependencies are not installed yet.
  echo Run setup-local.cmd first.
  pause
  exit /b 1
)

call :load_env_file ".env.local"
call :load_env_file ".env.isolated"

set "ISOLATED_PORTS=9080 4000 4001 4002"
echo Checking isolated RFMS ports (!ISOLATED_PORTS!)...
for %%P in (!ISOLATED_PORTS!) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    for /f "tokens=1" %%B in ('tasklist /FI "PID eq %%A" /NH ^| findstr /I "node.exe"') do (
      echo Closing previous isolated RFMS Node service on port %%P...
      taskkill /PID %%A /F >nul 2>nul
    )
  )
)
set "RFMS_PORT_BUSY="
for %%P in (!ISOLATED_PORTS!) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do set "RFMS_PORT_BUSY=%%P"
)
if defined RFMS_PORT_BUSY (
  echo.
  echo Port !RFMS_PORT_BUSY! is still in use. Close the process using it, then run start-isolated.cmd again.
  echo Default RFMS ports 8080 and 3000-3002 are not touched by this script.
  pause
  exit /b 1
)

if not exist "work\isolated" mkdir "work\isolated"

echo.
echo Building isolated RFMS websites for ports 4000-4002 / API 9080...
echo This step compiles all three Next.js apps and may take 1-3 minutes.
echo Default out/ folders are preserved; isolated builds are written to out-isolated.
call scripts\build-isolated-app.cmd marketing-web @rfms/marketing-web
if errorlevel 1 goto :build_error
call scripts\build-isolated-app.cmd franchise-portal @rfms/franchise-portal
if errorlevel 1 goto :build_error
call scripts\build-isolated-app.cmd admin-dashboard @rfms/admin-dashboard
if errorlevel 1 goto :build_error

echo.
echo Starting isolated RFMS local API and websites...
echo Keep this window open while using the isolated instance.
echo.
echo   Local API:         http://localhost:9080
echo   Marketing:         http://localhost:4000
echo   Applicant Portal:  http://localhost:4001
echo   Admin Dashboard:   http://localhost:4002
echo.
echo Default instance ports 8080 / 3000-3002 remain available separately.
call npm.cmd run dev:api
if errorlevel 1 goto :service_error
echo.
echo Isolated RFMS stopped. Read any message above, then press a key to close this window.
pause >nul
exit /b 0

:build_error
echo.
echo Isolated RFMS websites could not be built. Read the message above.
pause
exit /b 1

:service_error
echo.
echo Isolated RFMS could not start. Check whether ports 9080 and 4000-4002 are free.
pause
exit /b 1

:load_env_file
set "ENV_FILE=%~1"
if not exist "%ENV_FILE%" exit /b 0
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  set "KEY=%%A"
  set "VAL=%%B"
  if defined KEY (
    for /f "tokens=* delims= " %%K in ("!KEY!") do set "KEY=%%K"
    if not "!KEY!"=="" (
      if defined VAL (
        for /f "tokens=* delims= " %%V in ("!VAL!") do set "VAL=%%V"
      ) else (
        set "VAL="
      )
      set "!KEY!=!VAL!"
    )
  )
)
exit /b 0
