@echo off
setlocal

echo =====================================
echo START Colorado pipeline
echo =====================================

set ROOT=C:\PrintGuard
set SCRIPT_DIR=%ROOT%\ColoradoAccounting
set NODE_SCRIPT=%SCRIPT_DIR%\colorado-upsert\upsert-colorado-json.js
set LOG_DIR=%ROOT%\logs
set LOGFILE=%LOG_DIR%\run_latest.log

echo ROOT=%ROOT%
echo SCRIPT_DIR=%SCRIPT_DIR%
echo NODE_SCRIPT=%NODE_SCRIPT%
echo LOG_DIR=%LOG_DIR%
echo LOGFILE=%LOGFILE%

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo ===================== START ===================== > "%LOGFILE%"
echo %date% %time% >> "%LOGFILE%"

echo.
echo [1/3] SYNC
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\ColoradoSync_server.ps1" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo SYNC FAILED
    echo SYNC FAILED >> "%LOGFILE%"
    goto :fail
)

echo.
echo [2/3] PARSE
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\Parse-ColoradoSync_server.ps1" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo PARSE FAILED
    echo PARSE FAILED >> "%LOGFILE%"
    goto :fail
)

echo.
echo [3/3] UPSERT
node "%NODE_SCRIPT%" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo UPSERT FAILED
    echo UPSERT FAILED >> "%LOGFILE%"
    goto :fail
)

echo.
echo ALL STEPS OK
echo ===================== END (OK) ===================== >> "%LOGFILE%"
echo Log: %LOGFILE%
pause
exit /b 0

:fail
echo ===================== END (FAIL) ===================== >> "%LOGFILE%"
echo.
echo PIPELINE FAILED
echo Mrkni do logu: %LOGFILE%
pause
exit /b 1