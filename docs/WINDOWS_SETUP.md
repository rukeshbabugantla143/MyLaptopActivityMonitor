# Windows setup guide

## 1. Prerequisites

```bat
python --version          :: 3.9+   (this laptop: 3.11.0)
python -c "import psutil" :: if this fails: pip install psutil
node --version            :: 22.5+  (this laptop: 24.11.1)
```

Administrator rights aren't needed.

## 2. First start

Double-click `start-monitor.bat`. On the first run it runs `npm install` and `npm run build` in `dashboard\`. After that it starts:

```
pythonw collector\supervisor.py --open
   ├─ pythonw collector\collector.py            (activity collector)
   └─ node next start -p 3939 -H 127.0.0.1      (dashboard, this PC only)
```

None of these processes opens a window. The browser opens once, as soon as the server is healthy.

## 3. Automatic start at login (optional, needs your confirmation)

Run `install-autostart.bat`. It explains what it will configure and asks Y/N twice: once to enable autostart, and once for whether to open the dashboard in your browser once after each login. Then it creates:

| Setting | Value |
|---|---|
| Task name | `My Laptop Activity Monitor` (Task Scheduler Library, top level) |
| Trigger | At log on of *your* account, 20 s delay |
| Action | `pythonw.exe "<project>\collector\supervisor.py" --login` |
| Run level | Limited (normal user, no admin) |
| Battery | Allowed to start on battery and not stopped on battery. It **never wakes the PC** (WakeToRun off) |
| Time limit | None (it runs until you log off) |
| Multiple instances | Ignore new |

If Task Scheduler refuses (some managed PCs do), the script falls back to a shortcut in your personal Startup folder. That fallback doesn't need registry edits either.

You can check the current status in the dashboard under Settings → "Start automatically at login", or with:

```bat
powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Status
```

To disable autostart, run `remove-autostart.bat`. Your history is not touched.

## 4. Sleep, hibernate, shutdown

- The monitor never requests "keep awake" and never vetoes shutdown.
- **On sleep:** Windows sends `PBT_APMSUSPEND`. The collector closes the open session at that exact moment, and then Windows freezes all processes.
- **On resume:** the processes continue and tracking starts again on the next tick. Gaps are never counted as usage.
- **On shutdown or logoff:** `WM_ENDSESSION` makes the collector close its sessions, and Windows then ends all the processes.
- At the next login, the task starts everything again.

## 5. Moving the project out of OneDrive (recommended)

See the "OneDrive" section in [ARCHITECTURE.md](ARCHITECTURE.md).
