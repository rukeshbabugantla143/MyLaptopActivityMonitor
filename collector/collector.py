"""
My Laptop Activity Monitor - background collector.

Local-only. Records foreground application names + durations, idle/lock state,
process resource usage and battery status into a SQLite file under
%LOCALAPPDATA%\\MyLaptopActivityMonitor\\activity.db.

It never records keystrokes, screenshots, typed text, browser history, window
contents, microphone or camera. Window titles are NOT recorded unless the
"track_window_titles" setting is explicitly enabled (off by default).

Run:  pythonw collector.py        (no console window)
      python  collector.py --once (single sample, for testing)
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
import winreg
import xml.etree.ElementTree as ET

import psutil

APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "MyLaptopActivityMonitor")
DB_PATH = os.environ.get("MLAM_DB", os.path.join(APP_DIR, "activity.db"))
LOG_PATH = os.path.join(APP_DIR, "collector.log")
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

DEFAULT_SETTINGS = {
    "idle_threshold_sec": 300,
    "fg_interval_sec": 3,
    "res_interval_sec": 15,
    "battery_interval_sec": 60,
    "retention_days": 90,
    "daily_goal_min": 480,
    "paused": False,
    "track_window_titles": False,
    "notifications_enabled": False,
    "notify_goal": False,
    "notify_resources": False,
    "notify_app_limits": False,
    "app_limits": {},          # {"chrome.exe": 120}  minutes per day
    "cpu_warn_pct": 50,        # per-process CPU (% of whole machine) sustained
    "ram_warn_mb": 1500,       # per-process RSS
    "monitoring_enabled": True,
    "open_browser_at_login": False,
    "website_tracking_enabled": True,
}

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
version = ctypes.WinDLL("version", use_last_error=True)


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]


user32.GetForegroundWindow.restype = wt.HWND
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.OpenInputDesktop.restype = wt.HANDLE
user32.GetUserObjectInformationW.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD)]
user32.CloseDesktop.argtypes = [wt.HANDLE]
kernel32.GetTickCount64.restype = ctypes.c_ulonglong
WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def log(msg):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 1_000_000:
            os.replace(LOG_PATH, LOG_PATH + ".old")
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- Win32 helpers
def idle_seconds():
    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(lii)):
        return 0.0
    now = kernel32.GetTickCount64() & 0xFFFFFFFF
    return ((now - lii.dwTime) & 0xFFFFFFFF) / 1000.0


def is_locked():
    """Locked when the input desktop is not 'Default' (Winlogon/secure desktop) or LockApp is foreground."""
    h = user32.OpenInputDesktop(0, False, 0x0001)  # DESKTOP_READOBJECTS
    if not h:
        return True  # cannot open input desktop -> secure desktop (lock screen / UAC)
    try:
        buf = ctypes.create_unicode_buffer(256)
        n = wt.DWORD()
        user32.GetUserObjectInformationW(h, 2, buf, ctypes.sizeof(buf), ctypes.byref(n))  # UOI_NAME
        return buf.value.lower() != "default"
    finally:
        user32.CloseDesktop(h)


def foreground_pid():
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None, None
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value or None, hwnd


def window_title(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def pids_with_visible_windows():
    pids = set()

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            p = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            pids.add(p.value)
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return pids


ntdll = ctypes.WinDLL("ntdll")
ntdll.NtQuerySystemInformation.argtypes = [ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
_snap_buf = [ctypes.create_string_buffer(1 << 20)]


def process_snapshot():
    """All processes in ONE syscall (SystemProcessInformation): far cheaper than per-process queries.
    Returns {pid: (name, create_unix, cpu_100ns, working_set_bytes, session_id)}."""
    need = ctypes.c_ulong()
    while True:
        buf = _snap_buf[0]
        st = ntdll.NtQuerySystemInformation(5, buf, len(buf), ctypes.byref(need)) & 0xFFFFFFFF
        if st == 0xC0000004:  # STATUS_INFO_LENGTH_MISMATCH
            _snap_buf[0] = ctypes.create_string_buffer(max(need.value, len(buf)) + (256 << 10))
            continue
        if st != 0:
            raise OSError(f"NtQuerySystemInformation failed 0x{st:08x}")
        break
    raw = buf.raw
    out, off = {}, 0
    u32, u64 = (lambda o: int.from_bytes(raw[o:o + 4], "little")), (lambda o: int.from_bytes(raw[o:o + 8], "little"))
    base = ctypes.addressof(buf)
    while True:
        nxt = u32(off)
        ln, ptr = int.from_bytes(raw[off + 56:off + 58], "little"), u64(off + 64)
        name = ctypes.wstring_at(ptr, ln // 2) if ptr and ln else ("System Idle Process" if off == 0 else "System")
        pid = u64(off + 80)
        ct = u64(off + 32)
        out[pid] = (name, (ct / 1e7 - 11644473600) if ct else None, u64(off + 40) + u64(off + 48), u64(off + 144), u32(off + 100))
        if not nxt:
            break
        off += nxt
    del base
    return out


_desc_cache = {}


def file_description(exe_path):
    """Friendly app name from the executable's version resource (e.g. 'Google Chrome')."""
    if not exe_path:
        return None
    if exe_path in _desc_cache:
        return _desc_cache[exe_path]
    desc = None
    try:
        size = version.GetFileVersionInfoSizeW(exe_path, None)
        if size:
            buf = ctypes.create_string_buffer(size)
            if version.GetFileVersionInfoW(exe_path, 0, size, buf):
                ptr = ctypes.c_void_p()
                ln = wt.UINT()
                langs = []
                if version.VerQueryValueW(buf, "\\VarFileInfo\\Translation", ctypes.byref(ptr), ctypes.byref(ln)) and ln.value:
                    arr = (wt.WORD * (ln.value // 2)).from_address(ptr.value)
                    langs = [(arr[i], arr[i + 1]) for i in range(0, len(arr), 2)]
                langs += [(0x0409, 0x04B0), (0x0409, 0x04E4)]
                for lang, cp in langs:
                    key = "\\StringFileInfo\\%04x%04x\\FileDescription" % (lang, cp)
                    if version.VerQueryValueW(buf, key, ctypes.byref(ptr), ctypes.byref(ln)) and ln.value:
                        desc = ctypes.wstring_at(ptr.value, ln.value).rstrip("\x00").strip()
                        if desc:
                            break
    except Exception:
        desc = None
    _desc_cache[exe_path] = desc
    return desc


FRIENDLY = {
    "explorer.exe": "File Explorer", "code.exe": "Visual Studio Code", "chrome.exe": "Google Chrome",
    "msedge.exe": "Microsoft Edge", "firefox.exe": "Firefox", "applicationframehost.exe": "Windows App",
    "windowsterminal.exe": "Windows Terminal", "searchhost.exe": "Windows Search",
    "shellexperiencehost.exe": "Windows Shell", "startmenuexperiencehost.exe": "Start Menu",
}


def app_identity(pid):
    try:
        p = psutil.Process(pid)
        exe_name = p.name()
        try:
            path = p.exe()
        except Exception:
            path = None
    except Exception:
        return None, None
    low = exe_name.lower()
    name = FRIENDLY.get(low) or file_description(path) or exe_name.rsplit(".", 1)[0]
    return name, exe_name


# ---------------------------------------------------------------- database
class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            self.db.executescript(f.read())
        for k, v in DEFAULT_SETTINGS.items():
            self.db.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, json.dumps(v)))

    def settings(self):
        s = dict(DEFAULT_SETTINGS)
        for k, v in self.db.execute("SELECT key,value FROM settings"):
            try:
                s[k] = json.loads(v)
            except Exception:
                pass
        return s

    def set_kv(self, key, value):
        self.db.execute("INSERT INTO kv(key,value,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
                        (key, json.dumps(value), time.time()))

    def get_kv(self, key):
        r = self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(r[0]) if r else None


# ---------------------------------------------------------------- notifications (opt-in)
def toast(title, body):
    """Windows toast via built-in WinRT types through PowerShell. No extra modules."""
    t = title.replace("'", "''").replace("<", "").replace(">", "")
    b = body.replace("'", "''").replace("<", "").replace(">", "")
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;"
        "[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]>$null;"
        f"$x=New-Object Windows.Data.Xml.Dom.XmlDocument;$x.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>{t}</text><text>{b}</text></binding></visual></toast>');"
        "$n=[Windows.UI.Notifications.ToastNotification]::new($x);"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)"
    )
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                         creationflags=0x08000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        log(f"toast failed: {e}")


# ---------------------------------------------------------------- collector
class Collector:
    def __init__(self, store):
        self.st = store
        self.db = store.db
        self.s = store.settings()
        self.cur_app = None      # (row_id, app, exe, start)
        self.cur_state = None    # (row_id, state, start)
        self.last_tick = None
        self.last_flush = 0
        self.last_res = 0
        self.last_batt = 0
        self.last_batt_detail = 0
        self.last_health = 0
        self.last_startup = 0
        self.last_cleanup = 0
        self.last_settings = 0
        self.proc_cache = {}     # pid -> (create_time, cpu_time_100ns, perf_counter) baseline for CPU %
        sid = wt.DWORD()
        kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid))
        self.my_session = sid.value
        self.windowed_ever = {}  # pid -> name, processes seen with a visible window
        self.notified = {}       # key -> day string
        self.hot = {}            # pid -> consecutive high-cpu samples
        self.ncpu = psutil.cpu_count() or 1
        self.started = time.time()
        psutil.cpu_percent(None)

    # ---- session bookkeeping
    def _close_app(self, end):
        if self.cur_app:
            rid, _, _, start = self.cur_app
            self.db.execute("UPDATE app_sessions SET end_ts=?, duration=? WHERE id=?", (end, max(0.0, end - start), rid))
            self.db.execute("DELETE FROM kv WHERE key='current_app'")
            self.cur_app = None

    def _open_app(self, app, exe, start, title=None):
        cur = self.db.execute("INSERT INTO app_sessions(app,exe,start_ts,end_ts,duration,title) VALUES(?,?,?,?,0,?)",
                              (app, exe, start, start, title))
        self.cur_app = (cur.lastrowid, app, exe, start)

    def _set_state(self, state, at):
        if self.cur_state and self.cur_state[1] == state:
            return
        if self.cur_state:
            rid, _, start = self.cur_state
            self.db.execute("UPDATE state_sessions SET end_ts=?, duration=? WHERE id=?", (at, max(0.0, at - start), rid))
        cur = self.db.execute("INSERT INTO state_sessions(state,start_ts,end_ts,duration) VALUES(?,?,?,0)", (state, at, at))
        self.cur_state = (cur.lastrowid, state, at)

    def flush(self, now):
        if self.cur_app:
            rid, _, _, start = self.cur_app
            self.db.execute("UPDATE app_sessions SET end_ts=?, duration=? WHERE id=?", (now, now - start, rid))
        if self.cur_state:
            rid, _, start = self.cur_state
            self.db.execute("UPDATE state_sessions SET end_ts=?, duration=? WHERE id=?", (now, now - start, rid))
        self.last_flush = now

    def stop_all(self, now):
        self._close_app(now)
        if self.cur_state:
            rid, _, start = self.cur_state
            self.db.execute("UPDATE state_sessions SET end_ts=?, duration=? WHERE id=?", (now, now - start, rid))
            self.cur_state = None

    # ---- foreground tick
    def tick_foreground(self, now):
        s = self.s
        # Gap detection: sleep/hibernate/collector stall -> close sessions at last tick
        if self.last_tick and now - self.last_tick > max(30, s["fg_interval_sec"] * 5):
            self.stop_all(self.last_tick)
            self.db.execute("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)",
                            (self.last_tick, "gap", json.dumps({"seconds": round(now - self.last_tick)})))
        self.last_tick = now

        if s["paused"]:
            if self.cur_app or self.cur_state:
                self.stop_all(now)
            return

        if is_locked():
            self._close_app(now)
            self._set_state("locked", now)
            return

        idle = idle_seconds()
        if idle >= s["idle_threshold_sec"]:
            idle_start = max(now - idle, self.cur_app[3] if self.cur_app else now - idle)
            if self.cur_state and self.cur_state[1] == "active":
                idle_start = max(idle_start, self.cur_state[2])
            self._close_app(idle_start)
            self._set_state("idle", idle_start)
            return

        self._set_state("active", now)
        pid, hwnd = foreground_pid()
        app, exe = app_identity(pid) if pid else (None, None)
        if not app:
            app, exe = "Desktop / Unknown", "unknown"
        if exe.lower() == "lockapp.exe":
            self._close_app(now)
            self._set_state("locked", now)
            return
        title = window_title(hwnd) if (s["track_window_titles"] and hwnd) else None
        if not self.cur_app or self.cur_app[2] != exe or self.cur_app[1] != app:
            self._close_app(now)
            self._open_app(app, exe, now, title)
            self.st.set_kv("current_app", {"app": app, "exe": exe, "since": now})

    # ---- resources
    def tick_resources(self, now):
        windowed = pids_with_visible_windows()
        fg_pid, _ = foreground_pid()
        seen = set()
        procs = []
        t_now = time.perf_counter()
        my_session = self.my_session
        for pid, (name, ct, cpu_t, rss, sess) in process_snapshot().items():
            if pid in (0, 4):
                continue
            seen.add(pid)
            prev = self.proc_cache.get(pid)  # (create_time, cpu_100ns, perf_counter)
            cpu = 0.0
            if prev and prev[0] == ct and t_now > prev[2]:
                cpu = max(0.0, (cpu_t - prev[1]) / 1e7 / (t_now - prev[2]) / self.ncpu * 100)
            self.proc_cache[pid] = (ct, cpu_t, t_now)
            has_win = pid in windowed
            if has_win:
                self.windowed_ever[pid] = name
            procs.append({
                "pid": pid, "name": name, "cpu": round(cpu, 2), "rss": rss,
                "start": ct, "fg": pid == fg_pid, "window": has_win,
                "lingering": (not has_win) and pid in self.windowed_ever,
                "user": sess == my_session,
            })
        for pid in list(self.proc_cache):
            if pid not in seen:
                self.proc_cache.pop(pid, None)
                self.windowed_ever.pop(pid, None)
                self.hot.pop(pid, None)

        vm = psutil.virtual_memory()
        sys_cpu = psutil.cpu_percent(None)
        self.db.execute("INSERT INTO system_samples(ts,cpu_pct,ram_pct,ram_used,ram_total,proc_count) VALUES(?,?,?,?,?,?)",
                        (now, sys_cpu, vm.percent, vm.used, vm.total, len(procs)))

        # Aggregate by executable name for history (top 30 by cpu + top 30 by ram)
        agg = {}
        for pr in procs:
            a = agg.setdefault(pr["name"], {"cpu": 0.0, "rss": 0, "n": 0, "fg": False})
            a["cpu"] += pr["cpu"]; a["rss"] += pr["rss"]; a["n"] += 1; a["fg"] |= pr["fg"]
        top = sorted(agg.items(), key=lambda kv: -kv[1]["cpu"])[:30]
        top += [kv for kv in sorted(agg.items(), key=lambda kv: -kv[1]["rss"])[:30] if kv not in top]
        self.db.executemany("INSERT INTO process_samples(ts,name,cpu_pct,rss,instances,foreground) VALUES(?,?,?,?,?,?)",
                            [(now, n, round(a["cpu"], 2), a["rss"], a["n"], int(a["fg"])) for n, a in top])

        self.st.set_kv("processes", {"ts": now, "cpu": sys_cpu, "ram": vm.percent, "ram_used": vm.used,
                                     "ram_total": vm.total, "list": procs})
        self._resource_alerts(procs, now)

    def _resource_alerts(self, procs, now):
        s = self.s
        if not (s["notifications_enabled"] and s["notify_resources"]):
            return
        day = time.strftime("%Y-%m-%d")
        for pr in procs:
            if pr["cpu"] >= s["cpu_warn_pct"]:
                self.hot[pr["pid"]] = self.hot.get(pr["pid"], 0) + 1
            else:
                self.hot[pr["pid"]] = 0
            key = None
            if self.hot.get(pr["pid"], 0) >= 4:  # ~1 min sustained
                key, msg = f"cpu:{pr['name']}", f"{pr['name']} has used ~{pr['cpu']:.0f}% CPU for over a minute."
            elif pr["rss"] >= s["ram_warn_mb"] * 1048576:
                key, msg = f"ram:{pr['name']}", f"{pr['name']} is using {pr['rss'] / 1048576:.0f} MB of RAM."
            if key and self.notified.get(key) != day:
                self.notified[key] = day
                toast("High resource usage", msg)

    # ---- usage alerts
    def check_usage_alerts(self, now):
        s = self.s
        if not s["notifications_enabled"]:
            return
        day = time.strftime("%Y-%m-%d")
        t = time.localtime(now)
        day_start = time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))
        if s["notify_goal"] and self.notified.get("goal") != day:
            r = self.db.execute("SELECT COALESCE(SUM(MIN(end_ts,?)-MAX(start_ts,?)),0) FROM app_sessions WHERE end_ts>? AND start_ts<?",
                                (now, day_start, day_start, now)).fetchone()[0]
            if r / 60 >= s["daily_goal_min"]:
                self.notified["goal"] = day
                toast("Daily screen-time goal reached", f"You've been active for {r / 3600:.1f} h today.")
        if s["notify_app_limits"] and s["app_limits"]:
            for exe, lim in s["app_limits"].items():
                k = f"lim:{exe}"
                if self.notified.get(k) == day:
                    continue
                r = self.db.execute("SELECT COALESCE(SUM(MIN(end_ts,?)-MAX(start_ts,?)),0) FROM app_sessions WHERE lower(exe)=lower(?) AND end_ts>? AND start_ts<?",
                                    (now, day_start, exe, day_start, now)).fetchone()[0]
                if r / 60 >= float(lim):
                    self.notified[k] = day
                    toast("App usage limit", f"{exe}: {r / 60:.0f} min today (limit {lim} min).")

    # ---- battery
    def tick_battery(self, now):
        b = psutil.sensors_battery()
        if b is None:
            self.st.set_kv("battery_available", False)
            return
        self.st.set_kv("battery_available", True)
        detail = self.st.get_kv("battery_detail") or {}
        if now - self.last_batt_detail >= 300:
            self.last_batt_detail = now
            detail = self._battery_wmi() or detail
            self.st.set_kv("battery_detail", detail)
        secs = b.secsleft if isinstance(b.secsleft, int) and b.secsleft >= 0 else None
        self.db.execute("INSERT INTO battery_samples(ts,percent,plugged,secs_left,charge_rate_mw,discharge_rate_mw,remaining_mwh) VALUES(?,?,?,?,?,?,?)",
                        (now, b.percent, int(bool(b.power_plugged)), secs, detail.get("charge_rate"),
                         detail.get("discharge_rate"), detail.get("remaining")))

    def _battery_wmi(self):
        ps = ("$s=Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -EA SilentlyContinue|Select -First 1;"
              "$f=Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -EA SilentlyContinue|Select -First 1;"
              "@{charge_rate=$s.ChargeRate;discharge_rate=$s.DischargeRate;remaining=$s.RemainingCapacity;full=$f.FullChargedCapacity}|ConvertTo-Json -Compress")
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                                 text=True, timeout=20, creationflags=0x08000000).stdout.strip()
            d = json.loads(out) if out else {}
            d["ts"] = time.time()
            return d
        except Exception as e:
            log(f"battery wmi failed: {e}")
            return None

    def tick_battery_health(self, now):
        """Read-only: generates powercfg battery report XML in a temp file to read design capacity."""
        if psutil.sensors_battery() is None:
            return
        path = os.path.join(tempfile.gettempdir(), "mlam_battery.xml")
        try:
            subprocess.run(["powercfg", "/batteryreport", "/xml", "/output", path], capture_output=True, timeout=60,
                           creationflags=0x08000000)
            root = ET.parse(path).getroot()
            ns = {"b": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
            pre = "b:" if ns else ""
            bat = root.find(f".//{pre}Batteries/{pre}Battery", ns)
            info = {}
            if bat is not None:
                for tag in ("Manufacturer", "Id", "Chemistry", "DesignCapacity", "FullChargeCapacity", "CycleCount"):
                    el = bat.find(f"{pre}{tag}", ns)
                    if el is not None and el.text:
                        info[tag] = el.text.strip()
            if info.get("DesignCapacity") and info.get("FullChargeCapacity"):
                info["HealthPct"] = round(100 * float(info["FullChargeCapacity"]) / float(info["DesignCapacity"]), 1)
            info["ts"] = now
            self.st.set_kv("battery_health", info)
        except Exception as e:
            log(f"battery report failed: {e}")
        finally:
            try:
                os.remove(path)
            except Exception:
                pass

    # ---- startup apps
    def tick_startup(self, now):
        items = []
        keys = [(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKCU Run"),
                (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKLM Run"),
                (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "HKLM Run (32-bit)")]
        disabled = set()
        for hive, sub in [(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"),
                          (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run")]:
            try:
                with winreg.OpenKey(hive, sub) as k:
                    i = 0
                    while True:
                        try:
                            n, v, _ = winreg.EnumValue(k, i)
                        except OSError:
                            break
                        if isinstance(v, bytes) and v and v[0] in (3, 1) and v[0] != 2:
                            if v[0] == 3:
                                disabled.add(n.lower())
                        i += 1
            except OSError:
                pass
        for hive, sub, label in keys:
            try:
                with winreg.OpenKey(hive, sub) as k:
                    i = 0
                    while True:
                        try:
                            n, v, _ = winreg.EnumValue(k, i)
                        except OSError:
                            break
                        cmd = str(v)
                        exe = os.path.basename(cmd.strip('"').split('"')[0].split(" -")[0].split(" /")[0]).strip()
                        items.append({"name": n, "exe": exe, "source": label, "enabled": n.lower() not in disabled})
                        i += 1
            except OSError:
                pass
        for folder, label in [(os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup"), "Startup folder (user)"),
                              (os.path.join(os.environ.get("PROGRAMDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup"), "Startup folder (all users)")]:
            try:
                for f in os.listdir(folder):
                    if f.lower() != "desktop.ini":
                        items.append({"name": os.path.splitext(f)[0], "exe": f, "source": label, "enabled": True})
            except OSError:
                pass
        self.st.set_kv("startup_apps", items)

    def cleanup(self, now):
        cutoff = now - float(self.s["retention_days"]) * 86400
        for t in ("app_sessions", "state_sessions", "battery_samples", "events", "web_sessions"):
            col = "end_ts" if t.endswith("sessions") else "ts"
            self.db.execute(f"DELETE FROM {t} WHERE {col} < ?", (cutoff,))
        # high-frequency resource data: keep 14 days max
        res_cut = max(cutoff, now - 14 * 86400)
        self.db.execute("DELETE FROM system_samples WHERE ts < ?", (res_cut,))
        self.db.execute("DELETE FROM process_samples WHERE ts < ?", (res_cut,))

    def heartbeat(self, now):
        self.st.set_kv("collector", {"pid": os.getpid(), "started": self.started, "beat": now, "paused": bool(self.s["paused"])})

    def step(self, now):
        if now - self.last_settings >= 5:
            self.s = self.st.settings()
            self.last_settings = now
        self.tick_foreground(now)
        if now - self.last_flush >= 30:
            self.flush(now)
            self.check_usage_alerts(now)
        self.heartbeat(now)
        if self.s["paused"]:
            return
        if now - self.last_res >= self.s["res_interval_sec"]:
            self.last_res = now
            self.tick_resources(now)
        if now - self.last_batt >= self.s["battery_interval_sec"]:
            self.last_batt = now
            self.tick_battery(now)
        if now - self.last_health >= 86400:
            self.last_health = now
            self.tick_battery_health(now)
        if now - self.last_startup >= 3600:
            self.last_startup = now
            self.tick_startup(now)
        if now - self.last_cleanup >= 21600:
            self.last_cleanup = now
            self.cleanup(now)


def start_power_listener(collector, lock):
    """Hidden top-level window that receives WM_POWERBROADCAST (sleep) and WM_ENDSESSION (shutdown/logoff).
    It only closes open sessions; it never vetoes shutdown and never keeps the PC awake."""
    import threading
    WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
    user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
    user32.DefWindowProcW.restype = ctypes.c_ssize_t

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                    ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", wt.HANDLE), ("hbrBackground", wt.HBRUSH),
                    ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR)]

    def close_now(reason):
        with lock:
            try:
                collector.stop_all(time.time())
                collector.db.execute("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)", (time.time(), reason, "{}"))
                log(f"sessions closed: {reason}")
            except Exception as e:
                log(f"{reason} handler error: {e}")

    def proc(hwnd, msg, wp, lp):
        if msg == 0x0218 and wp == 0x0004:      # WM_POWERBROADCAST / PBT_APMSUSPEND
            close_now("suspend")
        elif msg == 0x0218 and wp == 0x0012:    # PBT_APMRESUMEAUTOMATIC
            log("system resumed")
        elif msg == 0x0011:                     # WM_QUERYENDSESSION -> always allow shutdown
            return 1
        elif msg == 0x0016 and wp:              # WM_ENDSESSION (session really ending)
            close_now("shutdown")
            return 0
        return user32.DefWindowProcW(hwnd, msg, wp, lp)

    def run():
        cb = WNDPROC(proc)
        kernel32.GetModuleHandleW.restype = wt.HMODULE
        kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
        hinst = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSW(lpfnWndProc=cb, lpszClassName="MLAMPowerListener", hInstance=hinst)
        user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
        user32.RegisterClassW(ctypes.byref(wc))
        user32.CreateWindowExW.restype = wt.HWND
        user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                           ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
        user32.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
        user32.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
        user32.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
        hwnd = user32.CreateWindowExW(0, "MLAMPowerListener", "MLAM", 0, 0, 0, 0, 0, None, None, hinst, None)
        if not hwnd:
            log("power listener window could not be created")
            return
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def safe_run():
        try:
            run()
        except Exception:
            log("power listener failed: " + traceback.format_exc())

    threading.Thread(target=safe_run, daemon=True, name="power-listener").start()


def single_instance():
    """Named mutex in the user's session: prevents duplicate collectors."""
    h = kernel32.CreateMutexW(None, False, "Local\\MyLaptopActivityMonitorCollector")
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        return None
    return h


def main():
    once = "--once" in sys.argv
    mutex = None if once else single_instance()
    if not once and mutex is None:
        log("another collector is already running; exiting")
        print("Collector already running.")
        return 0
    store = Store(DB_PATH)
    store.db.execute("DELETE FROM kv WHERE key='stop_requested'")
    c = Collector(store)
    log(f"collector started pid={os.getpid()} db={DB_PATH}")
    store.db.execute("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)", (time.time(), "collector_start", json.dumps({"pid": os.getpid()})))
    if once:
        c.last_res = c.last_batt = 0
        c.step(time.time()); time.sleep(1.5); c.step(time.time())
        c.flush(time.time())
        print(json.dumps({"current": store.get_kv("current_app"), "battery": store.get_kv("battery_detail")}, indent=1))
        return 0
    import threading
    lock = threading.Lock()
    start_power_listener(c, lock)
    errors = 0
    try:
        while True:
            now = time.time()
            try:
                with lock:
                    c.step(now)
                errors = 0
            except sqlite3.OperationalError as e:
                log(f"db busy/err: {e}")
            except Exception:
                errors += 1
                log("step error: " + traceback.format_exc())
                if errors > 50:
                    raise
            if store.get_kv("stop_requested"):
                log("stop requested from dashboard")
                break
            time.sleep(max(1.0, float(c.s["fg_interval_sec"])))
    except KeyboardInterrupt:
        pass
    finally:
        now = time.time()
        try:
            c.stop_all(now)
            store.db.execute("DELETE FROM kv WHERE key IN ('stop_requested','collector')")
            store.db.execute("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)", (now, "collector_stop", "{}"))
        except Exception:
            pass
        log("collector stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
