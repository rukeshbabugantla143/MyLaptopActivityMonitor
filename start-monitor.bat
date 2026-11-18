@echo off
REM Starts the supervisor (collector + dashboard server, with crash recovery) and opens the dashboard once.
REM Safe to run repeatedly: duplicates are prevented.
setlocal
cd /d "%~dp0dashboard"
if not exist node_modules (
  echo Installing dashboard dependencies - first run only...
  call npm install --no-fund --no-audit || goto :err
)
if not exist .next\BUILD_ID (
  echo Building dashboard - first run only...
  call npm run build || goto :err
)
cd /d "%~dp0collector"
start "" pythonw "%~dp0collector\supervisor.py" --open
echo Monitor is starting. The dashboard will open at http://127.0.0.1:3939
exit /b 0
:err
echo Setup failed. See docs\TROUBLESHOOTING.md
pause
exit /b 1
