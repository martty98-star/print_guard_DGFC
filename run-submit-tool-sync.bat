@echo off
setlocal

cd /d C:\PrintGuard\print_guard_DGFC

rem Configure these as machine/user environment variables in production.
rem set "NEON_DATABASE_URL=REPLACE_WITH_NEON_DATABASE_URL"
rem set "SUBMIT_TOOL_LOG_ROOT=\\10.25.0.20\Data\ST_logs\JobQueue"

if not exist C:\PrintGuard\logs mkdir C:\PrintGuard\logs

node scripts\sync-submit-tool-logs.js --days=2 >> C:\PrintGuard\logs\submit-tool-sync.log 2>&1
