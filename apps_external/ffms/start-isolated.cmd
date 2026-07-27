@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
if not exist "node_modules\next" (
  echo Dependencies are not installed yet.
  echo Run setup-local.cmd first.
  pause
  exit /b 1
)
echo Starting isolated RFMS instance (+1000 port offset)...
echo Your default start-local.cmd / run-admin.cmd setup is not modified.
echo.
echo A separate window will build three websites, then start the API.
echo First launch usually takes 1-3 minutes. Please wait before refreshing the browser.
start "RFMS Isolated Services" /D "%~dp0" cmd.exe /k run-api-isolated.cmd
echo.
echo Waiting for isolated services on port 4002...
set /a ATTEMPTS=0
:wait_for_services
timeout /t 3 /nobreak >nul
set /a ATTEMPTS+=1
netstat -ano | findstr /R /C:":4002 .*LISTENING" >nul && goto services_ready
if !ATTEMPTS! GEQ 40 (
  echo.
  echo Services are not up yet. Check the "RFMS Isolated Services" window for build errors.
  echo When that window shows "Admin Dashboard running at http://localhost:4002", open:
  echo   http://localhost:4002
  echo.
  pause
  exit /b 0
)
echo Still building or starting... [!ATTEMPTS!/40]
goto wait_for_services
:services_ready
start "RFMS Isolated Admin Dashboard" http://localhost:4002
echo.
echo Isolated instance is ready:
echo   Local API:         http://localhost:9080
echo   Admin Dashboard:   http://localhost:4002
echo   Marketing:         http://localhost:4000
echo   Applicant Portal:  http://localhost:4001
echo.
echo Default instance (unchanged):
echo   Local API:         http://localhost:8080
echo   Admin Dashboard:   http://localhost:3002
echo   Marketing:         http://localhost:3000
echo   Applicant Portal:  http://localhost:3001
echo.
echo Keep the RFMS Isolated Services window running while you test.
echo Optional Laravel Docker stack: docker compose -f docker-compose.isolated.yml up --build
