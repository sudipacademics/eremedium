@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\next" (
  echo Dependencies are not installed yet.
  echo Run setup-local.cmd first.
  pause
  exit /b 1
)
echo Starting RFMS local API and all websites...
start "RFMS Local Services" /D "%~dp0" cmd.exe /k run-api.cmd
timeout /t 3 /nobreak >nul
start "RFMS Admin Dashboard" http://localhost:3002
echo.
echo Open these addresses in your browser:
echo   Local API: http://localhost:8080
echo   Admin Dashboard: http://localhost:3002
echo   Marketing: http://localhost:3000
echo   Applicant Portal: http://localhost:3001
echo.
echo Keep the RFMS Local Services window running while you test.
