@echo off
setlocal
cd /d "%~dp0"
echo.
echo  ===== My Laptop Activity Monitor - enable automatic start =====
echo.
echo  This will create ONE Windows Task Scheduler task:
echo    Name:     My Laptop Activity Monitor
echo    Trigger:  when YOU log on (your account only), 20 s after login
echo    Runs:     pythonw collector\supervisor.py --login   (no window)
echo    Rights:   normal user (no Administrator), never wakes the PC,
echo              does not run when you are logged off or the PC is off.
echo  The supervisor starts the activity collector and the dashboard at
echo  http://127.0.0.1:3939 (this PC only) and restarts them if they crash
echo  (max 5 times per 30 min). No service, no registry edits, no power changes.
echo  If Task Scheduler refuses, a shortcut in your Startup folder is used instead.
echo.
choice /C YN /M "Enable automatic start at login"
if errorlevel 2 (echo Cancelled. Nothing was changed. & pause & exit /b 0)
echo.
choice /C YN /M "Also open the dashboard in your browser once after each login"
if errorlevel 2 (python collector\supervisor.py --set-open-browser 0) else (python collector\supervisor.py --set-open-browser 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Install
echo.
echo To undo at any time run remove-autostart.bat (your history is kept).
pause
