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
