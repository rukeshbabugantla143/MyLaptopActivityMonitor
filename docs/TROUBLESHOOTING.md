# Troubleshooting

Logs are in `%LOCALAPPDATA%\MyLaptopActivityMonitor`: `supervisor.log` (starts, crashes, restarts, port conflicts, autostart), `collector.log`, and `server.log`.

**The tracker shows "Crashed (gave up)".** The collector crashed 5 times within 30 minutes. Read `collector.log` and `supervisor.log`, fix the cause, then press **Start Monitoring**. That resets the limit.

**It didn't start at login.** Open Task Scheduler and find **My Laptop Activity Monitor**. Check "Last Run Result" and `supervisor.log`. If you moved the project folder, run `install-autostart.bat` again.

**Port 3939 is used by another program.** The monitor won't start a second server or take over the port. Close the other program (`netstat -ano | findstr :3939` shows its PID), or change `PORT` in `collector/supervisor.py` and the port in `dashboard/package.json`.

**Server "Offline" in the sidebar.** The page can't reach the server. Run `open-dashboard.bat`, which starts it again if needed, and check `server.log`.

**The sidebar says "Stopped".** Click **Start**, or run `start-monitor.bat`. If it stops again, check `%LOCALAPPDATA%\MyLaptopActivityMonitor\collector.log`. Running `python collector\collector.py --once` in a terminal shows errors directly.

**"Collector already running", but the dashboard says stopped.** The heartbeat is older than about 20 s, so the process may be hung. End `pythonw.exe` (with `collector.py` on its command line) in Task Manager, then start it again.

**The dashboard won't open / port 3939 is in use.** Run `stop-monitor.bat`, then `open-dashboard.bat`. To use another port, change it in `collector/supervisor.py`, `dashboard/package.json` and `open-dashboard.bat`.

**`pythonw` is not recognised.** Python isn't on PATH. Reinstall Python with "Add to PATH" ticked, or edit `start-monitor.bat` to use the full path (the autostart task already stores the full path), e.g. `C:\Users\<you>\AppData\Local\Programs\Python\Python311\pythonw.exe`.

**`ModuleNotFoundError: psutil`.** Run `pip install psutil`.

**`getBuiltinModule` / `node:sqlite` error.** Node.js is older than 22.5. Update Node.js.

**Build errors after editing code.** Delete `dashboard\.next` and run `open-dashboard.bat` again.

**Video watching counts as idle.** That's how the threshold works. Raise **Idle threshold** in Settings, e.g. to 15 min.

**Battery page is empty.** The first sample arrives about 1 min after start. Power (W) arrives within 5 min, and health within a few minutes of the first start. Desktops without a battery show "No battery detected".

**Notifications don't appear.** Turn on the master switch *and* the specific rule. Then check that Windows notifications aren't disabled for "Windows PowerShell" (Settings → System → Notifications) and that Focus/Do Not Disturb is off.

**The database is large.** Lower **Data retention** in Settings. Process samples are capped at 14 days. Use *Delete all data* to start over.

**Times look shifted after travelling.** Timestamps are stored in UTC and shown in the PC's current time zone.

**Website tracking problems.** See the troubleshooting table in [CHROME_EXTENSION.md](CHROME_EXTENSION.md).
