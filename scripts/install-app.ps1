# Installs My Laptop Activity Monitor as a normal per-user Windows app:
#   - program files  -> %LOCALAPPDATA%\MyLaptopActivityMonitor\App   (not synced by OneDrive)
#   - your data stays in %LOCALAPPDATA%\MyLaptopActivityMonitor  (untouched)
#   - Desktop + Start Menu shortcuts "Activity Monitor" (with icon), and an "Uninstall Activity Monitor" shortcut
#   - if autostart was enabled, the logon task is re-pointed to the installed copy
# No admin rights, no registry edits, no services.
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$Src = Split-Path -Parent $PSScriptRoot
$Base = Join-Path $env:LOCALAPPDATA 'MyLaptopActivityMonitor'
$Dst = Join-Path $Base 'App'
$Log = Join-Path $Base 'install.log'
function Say($m) { Write-Host $m; try { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 } catch {} }

if ((Resolve-Path $Src).Path -eq $Dst) { throw "Already running from the installed location ($Dst). Run install from the source folder." }
$py = (& python -c "import sys;print(sys.executable)").Trim()
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { throw "pythonw.exe not found next to $py" }
& python -c "import psutil" 2>$null; if ($LASTEXITCODE) { throw "Python package psutil missing: run  pip install psutil" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js not found" }
# Refuse when AppData writes are redirected (started from inside a packaged app): the install would be invisible to Windows.
& python (Join-Path $PSScriptRoot 'check_redirect.py'); if ($LASTEXITCODE -eq 3) { throw "Install aborted: AppData is redirected. Double-click INSTALL-APP.bat from File Explorer." }

Say "Installing from $Src to $Dst"
$hadTask = [bool](Get-ScheduledTask -TaskName 'My Laptop Activity Monitor' -ErrorAction SilentlyContinue)

Say "1/6 Stopping the running monitor (if any)..."
& python (Join-Path $Src 'collector\supervisor.py') --stop | Out-Null

Say "2/6 Copying program files (your data is not touched)..."
New-Item -ItemType Directory -Force -Path $Dst | Out-Null
robocopy $Src $Dst /MIR /XD .next .git /XF *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit $LASTEXITCODE)" }

Say "3/6 Building the dashboard (about a minute, works offline)..."
Push-Location (Join-Path $Dst 'dashboard')
try {
  if (-not (Test-Path node_modules)) { & npm install --no-fund --no-audit; if ($LASTEXITCODE) { throw "npm install failed" } }
  & npm run build 2>&1 | Out-File -FilePath (Join-Path $Base 'build.log') -Encoding utf8
  if ($LASTEXITCODE) { throw "Dashboard build failed - see $Base\build.log" }
} finally { Pop-Location }

Say "4/6 Creating shortcuts..."
$shell = New-Object -ComObject WScript.Shell
$ico = Join-Path $Dst 'assets\app.ico'
$sup = Join-Path $Dst 'collector\supervisor.py'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Activity Monitor'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
function New-Lnk($path, $target, $arguments, $desc, $icon) {
  $s = $shell.CreateShortcut($path); $s.TargetPath = $target; $s.Arguments = $arguments
  $s.WorkingDirectory = (Join-Path $Dst 'collector'); $s.Description = $desc; $s.IconLocation = "$icon,0"; $s.Save()
}
foreach ($p in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Activity Monitor.lnk'), (Join-Path $startMenu 'Activity Monitor.lnk'))) {
  New-Lnk $p $pyw "`"$sup`" --open" 'Open your Activity Monitor dashboard' $ico
}
New-Lnk (Join-Path $startMenu 'Stop Activity Monitor.lnk') $pyw "`"$sup`" --stop" 'Stop tracking and the dashboard server' $ico
New-Lnk (Join-Path $startMenu 'Uninstall Activity Monitor.lnk') 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Dst 'scripts\uninstall-app.ps1')`"" 'Remove the Activity Monitor app' $ico

Say "5/6 Autostart..."
if ($hadTask) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dst 'scripts\autostart.ps1') -Install | ForEach-Object { Say "    $_" }
} else { Say "    (autostart was not enabled; leaving it off)" }

@{ installed = (Get-Date).ToString('o'); source = $Src; path = $Dst } | ConvertTo-Json | Set-Content (Join-Path $Dst 'installed.json') -Encoding utf8

Say "6/6 Starting Activity Monitor..."
Start-Process -FilePath $pyw -ArgumentList "`"$sup`" --open" -WorkingDirectory (Join-Path $Dst 'collector')
Say ""
Say "Done. Open it any time from the 'Activity Monitor' icon on your Desktop or in the Start Menu."
Say "Chrome extension folder (Load unpacked): $Dst\chrome-extension"
