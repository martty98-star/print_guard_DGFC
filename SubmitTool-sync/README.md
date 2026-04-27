# PrintGuard Submit Tool Sync

Server-side sync for Submit Tool JobQueue logs.

It reads logs from NAS and writes lifecycle events into Neon/Postgres.

Recommended server folder:

```text
C:\PrintGuard\SubmitTool-sync
```

## 1. Copy files

Copy this whole folder to:

```text
C:\PrintGuard\SubmitTool-sync
```

Required files:

```text
sync-submit-tool-logs.js
package.json
run-submit-tool-sync.bat
install-task.ps1
README.md
```

## 2. Install Node dependencies

PowerShell:

```powershell
cd C:\PrintGuard\SubmitTool-sync
npm install
```

Check Node:

```powershell
node -v
npm -v
```

## 3. Set machine environment variables

PowerShell as Administrator:

```powershell
[Environment]::SetEnvironmentVariable("NEON_DATABASE_URL", "PASTE_NEON_DATABASE_URL_HERE", "Machine")
[Environment]::SetEnvironmentVariable("SUBMIT_TOOL_LOG_ROOT", "\\NAS01\Data\ST_logs\JobQueue", "Machine")
```

Alternative IP path:

```powershell
[Environment]::SetEnvironmentVariable("SUBMIT_TOOL_LOG_ROOT", "\\10.25.0.20\Data\ST_logs\JobQueue", "Machine")
```

Close PowerShell and open a new Administrator PowerShell.

Verify:

```powershell
echo $env:NEON_DATABASE_URL
echo $env:SUBMIT_TOOL_LOG_ROOT
Test-Path $env:SUBMIT_TOOL_LOG_ROOT
```

`Test-Path` must return:

```text
True
```

## 4. NAS access rule

Do not fight with `net use` if Explorer access already works.

The scheduled task must run under the same Windows user that has access to:

```text
\\NAS01\Data\ST_logs\JobQueue
```

If `Test-Path $env:SUBMIT_TOOL_LOG_ROOT` is false, fix Windows/NAS credentials first.

## 5. Manual test

```powershell
cd C:\PrintGuard\SubmitTool-sync
.\run-submit-tool-sync.bat
```

Check log:

```powershell
Get-Content C:\PrintGuard\logs\submit-tool-sync.log -Tail 80
```

Expected output includes:

```text
[submit-tool] sync start ...
[submit-tool] sync success
[submit-tool] folders=... files=... lines=... parsed=...
[submit-tool] eventsInserted=... ordersUpdated=... unmatched=...
```

## 6. Install scheduled task

PowerShell as Administrator:

```powershell
cd C:\PrintGuard\SubmitTool-sync
.\install-task.ps1
```

The task runs every 5 minutes.

Manual trigger:

```powershell
Start-ScheduledTask -TaskName "PrintGuard Submit Tool Sync"
```

Check task result:

```powershell
Get-ScheduledTaskInfo -TaskName "PrintGuard Submit Tool Sync"
```

Check sync log:

```powershell
Get-Content C:\PrintGuard\logs\submit-tool-sync.log -Tail 120
```

## 7. What this sync does

- Scans date folders under Submit Tool JobQueue, e.g. `2026-04-27`.
- Reads `.txt` files only.
- Parses Submit Tool lines like:

```text
2026-04-27,08.46.02.887,JobQueue,PrintJob PS4755364, status=WorkflowRun
```

- Stores parsed events into `print_lifecycle_events`.
- Uses `PrintJob <ORDER>, status=WorkflowRun` as Submit Tool confirmation.
- Updates matching `print_orders_received` rows:
  - `submit_tool_at`
  - `submit_tool_processed_at`
  - `submit_tool_status = confirmed`
- Keeps unmatched events for later debugging.
- Can be run repeatedly without duplicate events.

## 8. Troubleshooting

### `SUBMIT_TOOL_LOG_ROOT is not configured`

Set the machine env variable and reopen PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("SUBMIT_TOOL_LOG_ROOT", "\\NAS01\Data\ST_logs\JobQueue", "Machine")
```

### `Cannot access Submit Tool log folder`

The Windows user running the script/task cannot access NAS.

Fix:

```powershell
Test-Path $env:SUBMIT_TOOL_LOG_ROOT
```

must return `True` under the same Windows user used by Task Scheduler.

### `Missing NEON_DATABASE_URL`

Set:

```powershell
[Environment]::SetEnvironmentVariable("NEON_DATABASE_URL", "PASTE_NEON_DATABASE_URL_HERE", "Machine")
```

### No rows updated but events parsed

This means log identifiers did not match `print_orders_received` yet.

Check unmatched list in:

```text
C:\PrintGuard\logs\submit-tool-sync.log
```
