# Configures / removes automatic start at Windows logon for THIS user only.
# Task Scheduler "At log on" task, non-elevated (RunLevel Limited). No service, no manual registry edits.
param([switch]$Install, [switch]$Remove, [switch]$Status)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = 'My Laptop Activity Monitor'
$StartupDir = [Environment]::GetFolderPath('Startup')
$Lnk = Join-Path $StartupDir 'My Laptop Activity Monitor.lnk'
$LegacyLnk = Join-Path $StartupDir 'My Laptop Activity Monitor (collector).lnk'
$Log = Join-Path $env:LOCALAPPDATA 'MyLaptopActivityMonitor\supervisor.log'

function Write-Log($m) { try { Add-Content -Path $Log -Value ("{0} autostart: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 } catch {} }

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { "Task Scheduler task: $($t.State) (user $($t.Principal.UserId), trigger: at log on)" } else { "Task Scheduler task: not installed" }
  "Startup-folder fallback shortcut: " + $(if (Test-Path $Lnk) { 'present' } else { 'not present' })
  exit 0
}

if ($Install) {
  $py = (& python -c "import sys;print(sys.executable)").Trim()
  $pyw = Join-Path (Split-Path $py) 'pythonw.exe'
  if (-not (Test-Path $pyw)) { throw "pythonw.exe not found next to $py" }
  $sup = Join-Path $Root 'collector\supervisor.py'
  $user = "$env:USERDOMAIN\$env:USERNAME"
  try {
    $action    = New-ScheduledTaskAction -Execute $pyw -Argument "`"$sup`" --login" -WorkingDirectory (Join-Path $Root 'collector')
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $trigger.Delay = 'PT20S'   # let Windows finish logging in first
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                   -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Compatibility Win8
    # WakeToRun is left OFF: the task never wakes the PC. Runs only after you log in.
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
      -Description 'Starts the local activity monitor (collector + dashboard on 127.0.0.1:3939) when you log in.' -Force | Out-Null
    if (Test-Path $LegacyLnk) { Remove-Item $LegacyLnk -Force }
    Write-Log "task installed for $user"
    "OK: Task Scheduler task '$TaskName' created for $user (at log on, no admin rights)."
  } catch {
    Write-Log "task creation failed: $($_.Exception.Message); using Startup-folder shortcut instead"
    "Task Scheduler refused ($($_.Exception.Message))."
    "Falling back to a shortcut in your personal Startup folder."
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($Lnk)
    $s.TargetPath = $pyw; $s.Arguments = "`"$sup`" --login"; $s.WorkingDirectory = (Join-Path $Root 'collector')
    $s.Description = 'Starts the local activity monitor at login'; $s.Save()
    "OK: Startup shortcut created: $Lnk"
  }
  exit 0
}

if ($Remove) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; "Removed Task Scheduler task." } else { "No Task Scheduler task was installed." }
  foreach ($l in @($Lnk, $LegacyLnk)) { if (Test-Path $l) { Remove-Item $l -Force; "Removed $l" } }
  Write-Log "autostart removed"
  exit 0
}
"Usage: autostart.ps1 -Install | -Remove | -Status"
