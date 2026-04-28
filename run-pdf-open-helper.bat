@echo off
setlocal

cd /d C:\PrintGuard\ProcessedPrintOrders-sync

node scripts\pdf-open-helper.js >> C:\PrintGuard\logs\pdf-open-helper.log 2>&1
