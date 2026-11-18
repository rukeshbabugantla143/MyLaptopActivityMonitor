@echo off
REM Installs Activity Monitor as an app: Desktop + Start Menu icon, program files in %LOCALAPPDATA%.
echo Installing Activity Monitor as an app (no admin rights needed)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-app.ps1"
echo.
pause
