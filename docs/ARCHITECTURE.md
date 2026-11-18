# Architecture

```
┌──────────────────────────────┐      SQLite (WAL)       ┌───────────────────────────────┐
│ collector/collector.py       │  ───── writes ─────▶   │ %LOCALAPPDATA%\               │
│ pythonw, user session only   │                        │ MyLaptopActivityMonitor\      │
│ - foreground loop (3 s)      │  ◀── settings/flags ── │ activity.db                   │
│ - resources (15 s)           │                        └───────────────┬───────────────┘
│ - battery (60 s / 5 min)     │                                        │ reads (node:sqlite)
│ - health (daily), startup(1h)│                        ┌───────────────▼───────────────┐
└──────────────────────────────┘                        │ dashboard/ (Next.js 15)        │
                                                        │ app/api/[name]/route.ts        │
                                                        │ pages: / screen-time apps ...  │
                                                        │ http://127.0.0.1:3939          │
                                                        └───────────────────────────────┘
```

The dashboard controls the collector only through the database. Start launches `pythonw collector.py`. Stop sets `kv.stop_requested`. Pause and settings are rows in `settings`, which the collector re-reads every 5 s.

## Collector loop

| Every | Work | Windows API |
|---|---|---|
| 3 s (configurable) | Lock check, idle check, foreground app | `OpenInputDesktop`, `GetLastInputInfo`, `GetForegroundWindow`, `GetWindowThreadProcessId` |
| 30 s | Flush the open session's end time to disk; check usage alerts | — |
| 15 s | Snapshot of all processes: CPU, RAM, start time, session | **one** `NtQuerySystemInformation(SystemProcessInformation)` call, plus `EnumWindows` |
| 60 s | Battery %, plugged state, Windows time estimate | `GetSystemPowerStatus` (via psutil) |
| 5 min | Charge/discharge power (mW), remaining capacity | WMI `root\wmi BatteryStatus` |
| 24 h | Design vs full-charge capacity, cycle count | `powercfg /batteryreport /xml` (read-only, temp file deleted) |
| 1 h | Startup entries | Registry Run keys + Startup folders (read-only) |
| 6 h | Retention cleanup | — |

**Efficiency.** The per-process psutil calls cost about 2.6 s of CPU per sample on this machine, because protected processes fall back to a slow path. The single system-wide syscall takes about 16 ms. Writes are batched: the open session is updated every 30 s, not every tick. Measured footprint is about 25 MB RAM.

**Reliability**
- *Duplicates*: a named mutex in the user's session.
- *Crash*: the open session already has an end time from the last flush, so at most about 30 s is lost. Errors are logged, and the loop continues.
- *Sleep, hibernate or restart*: a gap larger than 5 ticks (at least 30 s) closes sessions at the last tick and is logged as a `gap` event. Sleep time is never counted.
- *Database contention*: WAL mode plus busy timeouts.

## Metric definitions and limitations

| Metric | Definition | Limitations |
|---|---|---|
| **Active time** | An app is foreground, the screen isn't locked, and the last input was within the idle threshold | Passive use (watching video, reading without scrolling) beyond the threshold counts as idle. Raise the threshold if you watch long videos |
| **Idle time** | No keyboard/mouse input ≥ threshold (default 5 min). Back-dated to the last input | Game controllers and some remote-desktop input may not reset the idle timer |
| **Locked time** | The input desktop isn't "Default" (lock screen / secure desktop), or LockApp is foreground | UAC prompts also use the secure desktop and are briefly counted as locked |
| **Screen-off time** | **Not measured.** Detecting it reliably needs a window registered for display-state power notifications. Display-off without sleep usually shows as idle, and sleep shows as a gap | — |
| **Logged-in session time** | Active + idle + locked while the collector runs | Time before the collector started, or while it was stopped, is unknown |
| **App switches** | The count of foreground changes between different executables | — |
| **Process CPU %** | Percentage of the *whole machine* (all logical cores), averaged since the previous sample | A short spike between samples is averaged out |
| **RAM** | Working set (the same as Task Manager's "Memory (active)" column, approximately) | Shared memory is counted in each process |
| **Background** | The process owns no visible titled top-level window | Tray apps count as background, which is correct, but they aren't necessarily wasteful |
| **"Lingering"** | The process had a visible window earlier and has none now | Apps that minimise to the tray look identical |
| **Battery drain %/h** | *Estimate* from your unplugged periods ≥ 10 min | Depends on what you did during those periods |
| **Power (W)** | *Measured* by the battery controller via WMI | Updated every 5 min |
| **Per-app energy** | **Not provided.** Windows has no reliable public API for it | — |

## Categories

The defaults live in `dashboard/lib/categories.ts`, keyed by executable. Browsers are always "Browser", because websites aren't tracked, so their use is never assumed to be entertainment. Your own overrides are stored in `app_categories`.

## Notifications

All notifications are off by default. When enabled, the collector shows Windows toast notifications through the built-in WinRT API (via PowerShell, with no extra modules). Each alert fires at most once per day per rule.

## Supervisor (process management)

`collector/supervisor.py` is the single entry point used by every script and by the logon task.

| Concern | How it's handled |
|---|---|
| Duplicates | Named mutexes: `Local\MyLaptopActivityMonitorSupervisor` and `Local\MyLaptopActivityMonitorCollector`. Before starting a server it calls `/api/health`. |
| Crash recovery | Checks every 10 s. A dead child is restarted after 5, 10, 20, 40 or 80 s. After 5 starts within 30 min it gives up (state `failed`, logged) until you press Start. |
| User intent | Stop Monitoring sets `monitoring_enabled=false`, and the collector isn't restarted until Start is pressed. Pause keeps the process alive but records nothing. |
| Port 3939 occupied | If another program answers, the supervisor logs it, sets state `port_conflict`, and doesn't start a server. `open-dashboard.bat` reports the conflict. |
| Browser | Opened once: by `start-monitor`/`open-dashboard`, or at login only if "Open dashboard at login" is on. It's never reopened automatically. |
| Graceful stop | `stop-monitor.bat` makes the supervisor set `stop_requested`, so the collector flushes and exits. Then the server is ended. |
| Sleep / shutdown | The collector's hidden window receives `PBT_APMSUSPEND` and `WM_ENDSESSION` and closes the open sessions. It always allows shutdown and never keeps the PC awake. |
| Audit | Control actions, crashes, suspend and shutdown are written to the `events` table. |

`GET /api/health` returns server pid and uptime, collector state (`tracking`, `paused`, `stopped`, `starting` or `failed`), supervisor state and restart counts, last data update, current app, and today's active seconds. The server binds to 127.0.0.1 only.

## OneDrive

If the project lives under `OneDrive\Desktop`, about 375 MB / 12,500 files of `node_modules` and `.next` are synced, and re-synced on every build. Tracking data is not affected: the database and logs live in `%LOCALAPPDATA%\MyLaptopActivityMonitor`, which OneDrive doesn't sync.

Recommended location: `%LOCALAPPDATA%\MyLaptopActivityMonitor\App`. Migration (the data stays in place, so nothing needs to be migrated):

1. Run `remove-autostart.bat` (if installed), then `stop-monitor.bat`.
2. `robocopy "<old folder>" "%LOCALAPPDATA%\MyLaptopActivityMonitor\App" /E /XD node_modules .next`
3. In the new folder, run `start-monitor.bat`. It reinstalls and rebuilds automatically. Check that the dashboard shows your history.
4. Run `install-autostart.bat` from the new folder, so the task points at the new path.
5. Delete the old Desktop folder. Optionally create a Desktop shortcut to the new `open-dashboard.bat`.
