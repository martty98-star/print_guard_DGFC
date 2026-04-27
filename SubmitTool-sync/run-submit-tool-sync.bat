@echo off
setlocal EnableExtensions

set "APP_DIR=C:\PrintGuard\SubmitTool-sync"
set "LOG_DIR=C:\PrintGuard\logs"
set "LOG_FILE=%LOG_DIR%\submit-tool-sync.log"
set "NODE_EXE=node"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%APP_DIR%"
if errorlevel 1 (
  echo [%date% %time%] ERROR: Cannot cd to %APP_DIR% >> "%LOG_FILE%"
  exit /b 1
)

echo.>> "%LOG_FILE%"
echo [%date% %time%] Submit Tool sync start >> "%LOG_FILE%"

echo [%date% %time%] USER=%USERDOMAIN%\%USERNAME% COMPUTER=%COMPUTERNAME% >> "%LOG_FILE%"
echo [%date% %time%] SUBMIT_TOOL_LOG_ROOT=%SUBMIT_TOOL_LOG_ROOT% >> "%LOG_FILE%"

if "%NEON_DATABASE_URL%"=="" (
  echo [%date% %time%] ERROR: NEON_DATABASE_URL is not configured >> "%LOG_FILE%"
  exit /b 1
)

if "%SUBMIT_TOOL_LOG_ROOT%"=="" (
  echo [%date% %time%] ERROR: SUBMIT_TOOL_LOG_ROOT is not configured >> "%LOG_FILE%"
  exit /b 1
)

if not exist "%SUBMIT_TOOL_LOG_ROOT%" (
  echo [%date% %time%] ERROR: Cannot access SUBMIT_TOOL_LOG_ROOT: %SUBMIT_TOOL_LOG_ROOT% >> "%LOG_FILE%"
  exit /b 1
)

%NODE_EXE% sync-submit-tool-logs.js --days=2 >> "%LOG_FILE%" 2>&1
set "EXITCODE=%ERRORLEVEL%"

echo [%date% %time%] Submit Tool sync exit code %EXITCODE% >> "%LOG_FILE%"
exit /b %EXITCODE%
