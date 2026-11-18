# Removes the installed Activity Monitor app. Your tracking data is KEPT unless you choose to delete it.
$ErrorActionPreference = 'Continue'
$Base = Join-Path $env:LOCALAPPDATA 'MyLaptopActivityMonitor'
$Dst = Join-Path $Base 'App'
Write-Host "Uninstall Activity Monitor"
Write-Host "This stops tracking, removes the logon task and the shortcuts, and deletes $Dst."
$a = Read-Host "Continue? (Y/N)"
if ($a -notmatch '^[Yy]') { Write-Host "Cancelled. Nothing was changed."; Start-Sleep 2; exit 0 }

& python (Join-Path $Dst 'collector\supervisor.py') --stop
$t = Get-ScheduledTask -TaskName 'My Laptop Activity Monitor' -ErrorAction SilentlyContinue
if ($t) { Unregister-ScheduledTask -TaskName 'My Laptop Activity Monitor' -Confirm:$false; Write-Host "Removed logon task." }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'My Laptop Activity Monitor.lnk'
foreach ($p in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Activity Monitor.lnk'), $startup)) { if (Test-Path $p) { Remove-Item $p -Force } }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Activity Monitor') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Removed shortcuts."

$d = Read-Host "Also DELETE all your recorded activity data in $Base ? This cannot be undone. Type DELETE to delete, or press Enter to keep it"
# The App folder is in use by this script, so delete it from a short-lived helper after we exit.
$cmd = "Start-Sleep 3; Remove-Item -LiteralPath '$Dst' -Recurse -Force -ErrorAction SilentlyContinue"
if ($d -eq 'DELETE') { $cmd += "; Remove-Item -LiteralPath '$Base' -Recurse -Force -ErrorAction SilentlyContinue" }
Start-Process powershell -ArgumentList "-NoProfile -WindowStyle Hidden -Command $cmd" -WorkingDirectory $env:TEMP
Write-Host ($(if ($d -eq 'DELETE') { "App and data will be deleted." } else { "App removed. Your data is kept in $Base." }))
Write-Host "Remember to remove the extension in chrome://extensions in each Chrome profile."
Start-Sleep 4
