@echo off
setlocal

set "ROOT=%~dp0"
set "LOG_DIR=C:\PrintGuard\logs"
set "SCAN_HOST=0.0.0.0"
set "SCAN_PORT=17910"
set "SCAN_OUTPUT=\\NAS01\Data\PrintGuard\scans"
set "SCAN_INPUT=\\NAS01\Data\PrintGuard\scans"
set "SCAN_FALLBACK=C:\PrintGuard\ScansFallback"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js or run this from a terminal where node is available.
  pause
  exit /b 1
)

node -e "require('pg')" >nul 2>nul
if errorlevel 1 (
  echo WARNING: The 'pg' module is missing in this runtime folder.
  echo Run: npm install
  echo The capture server can still start, but /pending-scans and /commit-scans will not work until 'pg' is installed.
)

set "PRINTGUARD_SCAN_HOST=%SCAN_HOST%"
set "PRINTGUARD_SCAN_CAPTURE_PORT=%SCAN_PORT%"
set "PRINTGUARD_SCAN_OUTPUT_DIR=%SCAN_OUTPUT%"
set "PRINTGUARD_SCAN_INPUT_DIR=%SCAN_INPUT%"
set "PRINTGUARD_SCAN_FALLBACK_DIR=%SCAN_FALLBACK%"

cd /d "%ROOT%"
echo [%date% %time%] starting scan capture >> "%LOG_DIR%\scan-capture.log"
echo [%date% %time%] PRINTGUARD_SCAN_HOST=%PRINTGUARD_SCAN_HOST% >> "%LOG_DIR%\scan-capture.log"
echo [%date% %time%] PRINTGUARD_SCAN_CAPTURE_PORT=%PRINTGUARD_SCAN_CAPTURE_PORT% >> "%LOG_DIR%\scan-capture.log"
echo [%date% %time%] PRINTGUARD_SCAN_OUTPUT_DIR=%PRINTGUARD_SCAN_OUTPUT_DIR% >> "%LOG_DIR%\scan-capture.log"
echo [%date% %time%] PRINTGUARD_SCAN_INPUT_DIR=%PRINTGUARD_SCAN_INPUT_DIR% >> "%LOG_DIR%\scan-capture.log"
echo [%date% %time%] PRINTGUARD_SCAN_FALLBACK_DIR=%PRINTGUARD_SCAN_FALLBACK_DIR% >> "%LOG_DIR%\scan-capture.log"
node server.js >> "%LOG_DIR%\scan-capture.log" 2>&1
if errorlevel 1 (
  echo.
  echo Scan Capture stopped with an error.
  echo Check: %LOG_DIR%\scan-capture.log
  pause
  exit /b 1
)
