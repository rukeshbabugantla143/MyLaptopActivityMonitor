@echo off
REM Opens the dashboard. If the monitor is not running, starts it first.
powershell -NoProfile -Command "try { $r = Invoke-RestMethod http://127.0.0.1:3939/api/health -TimeoutSec 2; if ($r.app -eq 'my-laptop-activity-monitor') { exit 0 } else { exit 2 } } catch { $c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',3939); exit 2 } catch { exit 1 } finally { $c.Close() } }"
if %errorlevel%==0 (start "" http://127.0.0.1:3939 & exit /b 0)
if %errorlevel%==2 (echo Port 3939 is used by another program. See docs\TROUBLESHOOTING.md & pause & exit /b 1)
call "%~dp0start-monitor.bat"
