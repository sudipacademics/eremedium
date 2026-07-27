@echo off
setlocal
cd /d "%~dp0"
echo Installing RFMS local dependencies...
call npm.cmd install --cache .\work\npm-cache
if errorlevel 1 (
  echo.
  echo Installation failed. Check that Node.js 20 or newer is installed and your internet connection is available.
  exit /b 1
)
echo.
echo RFMS is ready. Run start-local.cmd, then open http://localhost:3002
