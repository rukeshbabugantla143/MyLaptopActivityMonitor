@echo off
REM Disables automatic start at login. Does NOT stop the running monitor and does NOT delete any data.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Remove
echo Automatic start disabled. Your usage history is untouched.
echo (Run stop-monitor.bat if you also want to stop it now.)
pause
