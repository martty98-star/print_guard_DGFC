@echo off
setlocal

rem PrintGuard Post Purchase sync runner for Windows Task Scheduler / print server
rem Fill in the values below before running on the target server.

set POST_PURCHASE_API_BASE_URL=https://post-purchase.desen.io
set POST_PURCHASE_API_TOKEN=5|ThZCn26b4xG4M2TE9z8PVxYIxLdv6mBXtIDH5JRbff79ba2f
set "NEON_DATABASE_URL=REPLACE_WITH_NEON_DATABASE_URL"
set POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE=desenio_dgfc_printer

rem Optional: uncomment and set this only if autodiscovery does not find the orders endpoint.
rem set POST_PURCHASE_API_ORDERS_PATH=/api/orders

set ROOT_DIR=C:\PrintGuard\print_guard_DGFC
set LOG_DIR=%ROOT_DIR%\logs
set LOG_FILE=%LOG_DIR%\postpurchase-sync.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo ================================================== >> "%LOG_FILE%"
echo [%date% %time%] Post Purchase sync start >> "%LOG_FILE%"

cd /d "%ROOT_DIR%"
node scripts\sync-postpurchase-orders.js >> "%LOG_FILE%" 2>&1

if errorlevel 1 (
  echo [%date% %time%] Post Purchase sync FAILED >> "%LOG_FILE%"
  echo Sync failed. Check "%LOG_FILE%".
  exit /b 1
)

echo [%date% %time%] Post Purchase sync OK >> "%LOG_FILE%"
echo Sync finished. Log: "%LOG_FILE%"
exit /b 0

