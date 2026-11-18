@echo off
REM Repairs a damaged database ("database disk image is malformed") and updates the installed app.
REM Double-click this from File Explorer (NOT from inside another app).
setlocal
cd /d "%~dp0"
echo ===== Activity Monitor: repair database + update app =====
python scripts\check_redirect.py
if errorlevel 3 (echo. & echo Please double-click this file from File Explorer instead. & pause & exit /b 1)
echo.
echo [1/3] Stopping the monitor...
python collector\supervisor.py --stop
echo.
echo [2/3] Repairing the database (the damaged file is kept as a copy)...
python scripts\repair_db.py
if errorlevel 1 (echo. & echo Repair did not finish - nothing was replaced. Send a screenshot of this window. & pause & exit /b 1)
echo.
echo [3/3] Updating and starting the app...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-app.ps1"
echo.
echo All done.
pause
