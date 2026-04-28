@echo off
setlocal

cd /d C:\PrintGuard\print_guard_DGFC

rem Configure these as machine/user environment variables in production.
rem set "NEON_DATABASE_URL=REPLACE_WITH_NEON_DATABASE_URL"
rem set "PROCESSED_PRINT_ORDERS_ROOT=\\10.25.0.20\Data\onyx\orders\processed"

if not exist C:\PrintGuard\logs mkdir C:\PrintGuard\logs

node scripts\sync-processed-print-orders.js --days=2 >> C:\PrintGuard\logs\processed-print-orders-sync.log 2>&1
