@echo off
setlocal EnableExtensions EnableDelayedExpansion
if "%~2"=="" (
  echo Usage: build-isolated-app.cmd ^<app-folder^> ^<npm-workspace^>
  exit /b 1
)
cd /d "%~dp0.."
call :load_env_file ".env.isolated"
set "APP_DIR=%~1"
set "WORKSPACE=%~2"
set "APP_PATH=apps\%APP_DIR%"
set "OUT_ISOLATED=%APP_PATH%\out-isolated"
set "OUT_PRESERVE=%APP_PATH%\out.__preserve"
if exist "%OUT_PRESERVE%" rmdir /s /q "%OUT_PRESERVE%"
if exist "%APP_PATH%\out" (
  move "%APP_PATH%\out" "%OUT_PRESERVE%" >nul
)
call npm.cmd run build --workspace %WORKSPACE% --cache .\work\npm-cache
if errorlevel 1 (
  if exist "%OUT_PRESERVE%" move "%OUT_PRESERVE%" "%APP_PATH%\out" >nul
  exit /b 1
)
if exist "%OUT_ISOLATED%" rmdir /s /q "%OUT_ISOLATED%"
move "%APP_PATH%\out" "%OUT_ISOLATED%" >nul
if exist "%OUT_PRESERVE%" move "%OUT_PRESERVE%" "%APP_PATH%\out" >nul
exit /b 0

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
