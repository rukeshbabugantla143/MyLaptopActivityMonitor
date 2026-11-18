# My Laptop Activity Monitor

A private, local-only screen-time and system dashboard for your Windows laptop.

- **Supervisor** (Python, tiny): keeps the collector and dashboard running, restarts them after a crash (at most 5 times in 30 min), and never runs two copies.
- **Collector** (Python, ~25 MB RAM, ~0.02% CPU): records which app is in the foreground, idle/locked time, CPU/RAM per process and battery status into a local SQLite file.
- **Dashboard** (Next.js + TypeScript + Tailwind, dark UI): runs at **http://127.0.0.1:3939**. It listens only on your own machine.

Nothing is uploaded anywhere. There's no telemetry, analytics, screenshots, keylogging, typed text, browser history, microphone or camera access.

---

## Install as an app (recommended)

Double-click **`INSTALL-APP.bat`**. It needs no admin rights and works offline. It:
- copies the program to `%LOCALAPPDATA%\MyLaptopActivityMonitor\App`, which OneDrive doesn't sync
- creates an **Activity Monitor** icon on the Desktop and in the Start Menu. The icon opens the dashboard in its own app window
- adds **Stop Activity Monitor** and **Uninstall Activity Monitor** to the Start Menu
- moves autostart (if it was enabled) to the installed copy

Your data in `%LOCALAPPDATA%\MyLaptopActivityMonitor` is never touched by installing or updating. To update after changing the source, run `INSTALL-APP.bat` again. To uninstall, use Start Menu → Activity Monitor → Uninstall (it asks before deleting any data).

The Chrome extension then loads from `%LOCALAPPDATA%\MyLaptopActivityMonitor\App\chrome-extension`. Its ID is fixed by a key in `manifest.json`, so moving the folder later doesn't change the extension's identity.

## Quick start (running from the source folder)

| Script | What it does |
|---|---|
| **`start-monitor.bat`** | Starts the supervisor (collector + dashboard server, with crash recovery) and opens the dashboard once. Safe to run again: no duplicates are created |
| **`open-dashboard.bat`** | Opens http://127.0.0.1:3939. Starts the monitor first if it isn't running |
| **`stop-monitor.bat`** | Stops everything gracefully. Your data is kept |
| **`install-autostart.bat`** | Explains what it will set up, asks for confirmation, then creates a Task Scheduler "At log on" task for your account only |
| **`remove-autostart.bat`** | Removes automatic start. Your usage history is kept |

You can pause, resume, stop, start and restart monitoring from the status panel at the bottom of the dashboard sidebar. It also shows whether the tracker and server are running, the last data update, the current app and today's total.

On the first run, `start-monitor.bat` installs dependencies and builds the dashboard. That takes about a minute.

**Requirements:** Windows 10/11, Python 3.9+ with `psutil` (`pip install psutil`), and Node.js 22.5+ (it uses the built-in `node:sqlite`).

## Dashboard sections

| Page | Shows |
|---|---|
| Overview (today's report) | Active time, idle, apps used, top app, current app, CPU, RAM, battery, goal progress, categories |
| Screen Time | Day-wise active/idle/locked chart, hour-by-hour, 7- and 30-day trends |
| Applications | Ranked table (Today / 7 Days / CPU / RAM) with search, category filter and sorting |
| Websites | Chrome time per domain. Profile selector (All Profiles or one profile) and date selector; top sites, visits, average per visit, categories, Productive / Neutral / Distracting split, 14-day trend, timeline. Requires the extension |
| Chrome Profiles | Every Chrome profile with the extension: name/rename, enable/disable, connection status, last activity, delete data |
| Background Activity | Live process list, foreground/background/startup status, high CPU/RAM warnings with reasons, startup apps |
| Battery | % history, charging/discharging periods, measured power (W), estimated drain, health, daily usage |
| Timeline | Your day as a 24-hour bar plus a session list. You can pick any past date |
| Weekly Report | Totals, daily average, top apps vs last week, categories, busiest day, recommendations based on your data |
| Settings | Idle threshold, intervals, goal, notifications, app limits, categories, retention, CSV export, delete data, autostart |

## What is tracked

- Foreground app **name and executable** (e.g. "Google Chrome", `chrome.exe`), start and end time, and duration
- Active, idle (no keyboard/mouse input for 5 min by default) and locked periods
- Per-process CPU %, RAM, PID, start time, and whether it has a window (sampled every 15 s)
- Battery %, plugged state, charge/discharge power, capacity and health
- Startup entries (read-only, from the registry Run keys and Startup folders)
- **Only if you install the Chrome extension:** the *domain* of the active Chrome tab (e.g. `youtube.com`) and how long it was active, per Chrome profile. See [docs/CHROME_EXTENSION.md](docs/CHROME_EXTENSION.md)

## What is NOT tracked

- Window titles. This is **off by default** and optional in Settings
- Full URLs, paths, searches, page content and incognito browsing. Without the extension, browser time is counted as the browser only
- Keystrokes, typed text, clipboard, screenshots, documents, passwords
- Microphone or camera
- Other user accounts. The collector only sees your own session's foreground window

## Where data lives

`%LOCALAPPDATA%\MyLaptopActivityMonitor\activity.db` (plus `collector.log`)

The data is deliberately **not** stored in the project folder. Your Desktop is synced by OneDrive, and keeping the data outside it means your activity data never gets uploaded.

## Uninstall

1. Run `remove-autostart.bat`, then `stop-monitor.bat`. Remove the extension in `chrome://extensions` in each profile.
2. Delete the `My_Laptop_Activity_Monitor` folder.
3. Delete `%LOCALAPPDATA%\MyLaptopActivityMonitor` to remove all recorded data.

The only system change is the optional Task Scheduler task, and `remove-autostart.bat` removes it. There are no services, registry edits or power-setting changes.

## More docs

- [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md): installation and startup guide
- [docs/CHROME_EXTENSION.md](docs/CHROME_EXTENSION.md): website tracking, Chrome profiles, privacy and security
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works, and the limits of each metric
- [docs/DATABASE.md](docs/DATABASE.md): database schema
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): fixes for common problems
