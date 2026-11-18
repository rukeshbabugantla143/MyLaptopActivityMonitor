@echo off
REM Gracefully stops the supervisor, the collector and the dashboard server. Data is kept.
cd /d "%~dp0collector"
python supervisor.py --stop
ping -n 4 127.0.0.1 >nul
