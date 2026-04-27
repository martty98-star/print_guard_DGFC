$ErrorActionPreference = "Stop"

$TaskName = "PrintGuard Submit Tool Sync"
$WorkDir = "C:\PrintGuard\SubmitTool-sync"
$BatPath = Join-Path $WorkDir "run-submit-tool-sync.bat"
$LogDir = "C:\PrintGuard\logs"

if (-not (Test-Path $BatPath)) {
  throw "Missing runner BAT: $BatPath"
}

if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Write-Host "Checking env variables..."
if (-not [Environment]::GetEnvironmentVariable("NEON_DATABASE_URL", "Machine")) {
  Write-Warning "Machine env NEON_DATABASE_URL is not configured. Set it before relying on the scheduled task."
}
if (-not [Environment]::GetEnvironmentVariable("SUBMIT_TOOL_LOG_ROOT", "Machine")) {
  Write-Warning "Machine env SUBMIT_TOOL_LOG_ROOT is not configured. Set it before relying on the scheduled task."
}

$root = [Environment]::GetEnvironmentVariable("SUBMIT_TOOL_LOG_ROOT", "Machine")
if ($root) {
  Write-Host "Testing NAS path: $root"
  if (-not (Test-Path $root)) {
    Write-Warning "Current user cannot access SUBMIT_TOOL_LOG_ROOT right now. Fix NAS credentials before enabling unattended task."
  }
}

# Run through cmd.exe. This is more reliable than executing .bat directly.
$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$BatPath`"" `
  -WorkingDirectory $WorkDir

# Run every 5 minutes indefinitely after registration.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$Trigger.Repetition.Interval = "PT5M"
$Trigger.Repetition.Duration = "P3650D"

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# Important: this uses the current Windows user. That same user must have NAS access.
$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType InteractiveOrPassword `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description "Sync Submit Tool JobQueue logs from NAS into PrintGuard" `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "User: $env:USERDOMAIN\$env:USERNAME"
Write-Host "Runner: $BatPath"
Write-Host "Log: C:\PrintGuard\logs\submit-tool-sync.log"
Write-Host "Run manually: Start-ScheduledTask -TaskName '$TaskName'"
