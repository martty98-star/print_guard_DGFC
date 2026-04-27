@echo off
setlocal

set POST_PURCHASE_API_BASE_URL=https://post-purchase.desen.io
set POST_PURCHASE_API_TOKEN=REPLACE_WITH_POST_PURCHASE_API_TOKEN
set "NEON_DATABASE_URL=REPLACE_WITH_NEON_DATABASE_URL"
set POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE=desenio_dgfc_printer

rem Optional: uncomment only if autodiscovery fails.
rem set POST_PURCHASE_API_ORDERS_PATH=/api/orders

set ROOT_DIR=%~dp0
if "%ROOT_DIR:~-1%"=="\" set ROOT_DIR=%ROOT_DIR:~0,-1%

set LOG_DIR=%ROOT_DIR%\logs
set LOG_FILE=%LOG_DIR%\postpurchase-sync.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo ================================================== >> "%LOG_FILE%"
echo [%date% %time%] Post Purchase sync start >> "%LOG_FILE%"

cd /d "%ROOT_DIR%"
node sync-postpurchase-orders.js >> "%LOG_FILE%" 2>&1

if errorlevel 1 (
  echo [%date% %time%] Post Purchase sync FAILED >> "%LOG_FILE%"
  echo Sync failed. Check "%LOG_FILE%".
  exit /b 1
)

echo [%date% %time%] Post Purchase sync OK >> "%LOG_FILE%"
echo Sync finished. Log: "%LOG_FILE%"
exit /b 0

