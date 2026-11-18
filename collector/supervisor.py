"""
My Laptop Activity Monitor - supervisor.

One lightweight process per Windows user session that keeps two children alive:
  * the activity collector (collector.py)
  * the dashboard server (Next.js on 127.0.0.1:3939)

- Duplicate prevention: named mutex Local\\MyLaptopActivityMonitorSupervisor (+ the collector's own mutex,
  + a health check on the port before starting a server).
- Crash recovery with exponential backoff, capped at MAX_RESTARTS per RESTART_WINDOW. No infinite restart loop.
- Respects user intent: if you press Stop Monitoring, the collector is NOT restarted until you press Start.
- Never keeps the PC awake, never blocks shutdown. Sleep just freezes everything; after resume it carries on.

Usage:
  pythonw supervisor.py            start (or, if already running, just make sure monitoring is enabled)
  pythonw supervisor.py --open     same, then open the dashboard once in the default browser
  pythonw supervisor.py --login    used by the logon task: opens the browser only if the setting is enabled
  python  supervisor.py --stop     stop supervisor, collector and dashboard server gracefully
  python  supervisor.py --status   print health as JSON
"""
import ctypes
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DASH = os.path.join(ROOT, "dashboard")
APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "MyLaptopActivityMonitor")
DB_PATH = os.environ.get("MLAM_DB", os.path.join(APP_DIR, "activity.db"))
LOG = os.path.join(APP_DIR, "supervisor.log")
SERVER_LOG = os.path.join(APP_DIR, "server.log")
HOST, PORT = "127.0.0.1", 3939
URL = f"http://{HOST}:{PORT}"
CHECK_EVERY = 10
MAX_RESTARTS, RESTART_WINDOW = 5, 1800
NO_WINDOW = 0x08000000

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.OpenMutexW.restype = ctypes.c_void_p


def log(msg):
    os.makedirs(APP_DIR, exist_ok=True)
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 1_000_000:
            os.replace(LOG, LOG + ".old")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


def db():
    os.makedirs(APP_DIR, exist_ok=True)
    d = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    d.execute("PRAGMA journal_mode=WAL")
    with open(os.path.join(HERE, "schema.sql"), encoding="utf-8") as f:
        d.executescript(f.read())
    return d


def get_setting(d, key, default):
    r = d.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    try:
        return json.loads(r[0]) if r else default
    except Exception:
        return default


def set_setting(d, key, value):
    d.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


def set_kv(d, key, value):
    d.execute("INSERT INTO kv(key,value,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated",
              (key, json.dumps(value), time.time()))


def get_kv(d, key):
    r = d.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else None


def mutex_exists(name):
    h = kernel32.OpenMutexW(0x00100000, False, name)  # SYNCHRONIZE
    if h:
        kernel32.CloseHandle(ctypes.c_void_p(h))
        return True
    return False


def health(timeout=2):
    try:
        with urllib.request.urlopen(URL + "/api/health", timeout=timeout) as r:
            j = json.loads(r.read())
            return j if j.get("app") == "my-laptop-activity-monitor" else {"foreign": True}
    except urllib.error.HTTPError:
        return {"foreign": True}  # something answered HTTP on our port, but not our health endpoint
    except Exception:
        return None


def port_busy():
    s = socket.socket()
    s.settimeout(1)
    try:
        return s.connect_ex((HOST, PORT)) == 0
    finally:
        s.close()


def pythonw():
    exe = sys.executable
    w = os.path.join(os.path.dirname(exe), "pythonw.exe")
    return w if os.path.exists(w) else exe


def open_app_window():
    """Open the dashboard as a standalone app window (no tabs / address bar), like an installed app."""
    # Prefer the dashboard installed as a Chrome/Edge web app: it gets its own taskbar icon (our logo).
    progs = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\\Windows\\Start Menu\\Programs")
    for folder in ("Chrome Apps", "Edge Apps", ""):
        lnk = os.path.join(progs, folder, "Activity Monitor.lnk") if folder else None
        if lnk and os.path.exists(lnk):
            try:
                os.startfile(lnk)
                return
            except OSError as e:
                log(f"opening installed web app failed: {e}")
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), r"Google\Chrome\Application\chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), r"Google\Chrome\Application\chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), r"Microsoft\Edge\Application\msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), r"Microsoft\Edge\Application\msedge.exe"),
    ]
    for exe in candidates:
        if os.path.exists(exe):
            try:
                subprocess.Popen([exe, f"--app={URL}", "--window-size=1440,920"], creationflags=NO_WINDOW,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except Exception as e:
                log(f"app window via {exe} failed: {e}")
    webbrowser.open(URL)


def wait_and_open(timeout=90):
    t = time.time()
    while time.time() - t < timeout:
        h = health()
        if h and not h.get("foreign"):
            open_app_window()
            return True
        if (h and h.get("foreign")) or (not h and port_busy() and time.time() - t > 20):
            log(f"port {PORT} is used by another program; browser not opened")
            return False
        time.sleep(2)
    log("dashboard did not become healthy in time; browser not opened")
    return False


class Child:
    def __init__(self, name):
        self.name = name
        self.proc = None
        self.restarts = []      # timestamps
        self.next_try = 0
        self.gave_up = False
        self.state = "stopped"
        self.detail = ""

    def can_start(self, now):
        self.restarts = [t for t in self.restarts if now - t < RESTART_WINDOW]
        if len(self.restarts) >= MAX_RESTARTS:
            if not self.gave_up:
                log(f"{self.name}: crashed {MAX_RESTARTS} times within {RESTART_WINDOW // 60} min - giving up until manual restart")
            self.gave_up = True
            self.state = "failed"
            return False
        return now >= self.next_try

    def record_start(self, now):
        self.restarts.append(now)
        self.next_try = now + min(300, 5 * 2 ** (len(self.restarts) - 1))  # 5,10,20,40,80 s ... max 5 min

    def reset(self):
        self.restarts, self.next_try, self.gave_up = [], 0, False


class Supervisor:
    def __init__(self):
        self.d = db()
        self.col = Child("collector")
        self.srv = Child("server")
        self.started = time.time()
        self.last_loop = time.time()

    # ---------- collector
    def manage_collector(self, now):
        c = self.col
        enabled = get_setting(self.d, "monitoring_enabled", True)
        requested = bool(get_kv(self.d, "restart_collector"))
        if requested:
            if mutex_exists("Local\\MyLaptopActivityMonitorCollector"):
                return  # wait for the old collector to finish exiting
            self.d.execute("DELETE FROM kv WHERE key='restart_collector'")
            c.reset()
            log("collector restart requested from dashboard")
        if c.proc and c.proc.poll() is not None:
            code = c.proc.returncode
            c.proc = None
            if enabled and not requested:
                log(f"collector exited unexpectedly (code {code}); will restart with backoff")
                self.d.execute("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)", (now, "collector_crash", json.dumps({"code": code})))
            else:
                log("collector exited for restart" if requested else "collector stopped by user")
        if not enabled:
            c.state = "stopped"
            c.reset()
            return
        if mutex_exists("Local\\MyLaptopActivityMonitorCollector"):
            c.state = "running"
            if c.proc is None:
                c.detail = "started outside supervisor"
            return
        if c.proc is None and c.can_start(now):
            try:
                self.d.execute("DELETE FROM kv WHERE key='stop_requested'")
                c.proc = subprocess.Popen([pythonw(), os.path.join(HERE, "collector.py")], cwd=HERE, creationflags=NO_WINDOW,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                c.record_start(now)
                c.state, c.detail = "starting", f"pid {c.proc.pid}"
                log(f"collector started pid={c.proc.pid}")
            except Exception as e:
                c.record_start(now)
                c.state, c.detail = "error", str(e)
                log(f"collector start failed: {e}")

    # ---------- dashboard server
    def manage_server(self, now):
        s = self.srv
        if get_kv(self.d, "restart_server"):
            self.d.execute("DELETE FROM kv WHERE key='restart_server'")
            s.reset()
        if s.proc and s.proc.poll() is not None:
            log(f"dashboard server exited (code {s.proc.returncode}); will restart with backoff")
            s.proc = None
        h = health()
        if h and not h.get("foreign"):
            s.state, s.detail = "online", "" if s.proc else "started outside supervisor"
            return
        if h and h.get("foreign") or (not h and port_busy() and s.proc is None):
            if s.state != "port_conflict":
                log(f"port {PORT} is used by another program; not starting a second server")
            s.state, s.detail = "port_conflict", f"Port {PORT} is occupied by another program"
            return
        if s.proc is not None:  # running but not healthy yet (booting) - give it time
            s.state = "starting"
            return
        if not os.path.exists(os.path.join(DASH, ".next", "BUILD_ID")):
            if s.state != "not_built":
                log("dashboard is not built - run start-monitor.bat once (it builds automatically)")
            s.state, s.detail = "not_built", "Run start-monitor.bat once to build the dashboard"
            return
        node = shutil.which("node")
        if not node:
            s.state, s.detail = "error", "node.exe not found on PATH"
            return
        if not s.can_start(now):
            return
        try:
            out = open(SERVER_LOG, "ab")
            s.proc = subprocess.Popen([node, os.path.join(DASH, "node_modules", "next", "dist", "bin", "next"), "start", "-p", str(PORT), "-H", HOST],
                                      cwd=DASH, creationflags=NO_WINDOW, stdout=out, stderr=out)
            s.record_start(now)
            s.state, s.detail = "starting", f"pid {s.proc.pid}"
            log(f"dashboard server started pid={s.proc.pid}")
        except Exception as e:
            s.record_start(now)
            s.state, s.detail = "error", str(e)
            log(f"dashboard server start failed: {e}")

    def heartbeat(self, now):
        set_kv(self.d, "supervisor", {
            "pid": os.getpid(), "started": self.started, "beat": now,
            "collector": {"state": self.col.state, "detail": self.col.detail, "restarts": len(self.col.restarts)},
            "server": {"state": self.srv.state, "detail": self.srv.detail, "restarts": len(self.srv.restarts)},
        })

    def shutdown(self):
        log("supervisor shutting down")
        set_setting(self.d, "monitoring_enabled", get_setting(self.d, "monitoring_enabled", True))
        set_kv(self.d, "stop_requested", True)  # collector flushes and exits on its own
        t = time.time()
        while time.time() - t < 10 and mutex_exists("Local\\MyLaptopActivityMonitorCollector"):
            time.sleep(0.5)
        if self.srv.proc and self.srv.proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(self.srv.proc.pid), "/T", "/F"], creationflags=NO_WINDOW, capture_output=True)
        self.d.execute("DELETE FROM kv WHERE key IN ('supervisor','supervisor_stop','stop_requested')")

    def run(self):
        log(f"supervisor started pid={os.getpid()} root={ROOT}")
        try:
            while True:
                now = time.time()
                if now - self.last_loop > CHECK_EVERY * 4:
                    log(f"resumed after ~{int(now - self.last_loop)} s (sleep/hibernate or stall)")
                self.last_loop = now
                try:
                    if get_kv(self.d, "supervisor_stop"):
                        break
                    self.manage_collector(now)
                    self.manage_server(now)
                    self.heartbeat(now)
                except sqlite3.OperationalError as e:
                    log(f"db error: {e}")
                except Exception as e:
                    log(f"loop error: {e!r}")
                time.sleep(CHECK_EVERY)
        finally:
            self.shutdown()


def stop_all():
    d = db()
    if mutex_exists("Local\\MyLaptopActivityMonitorSupervisor"):
        set_kv(d, "supervisor_stop", True)
        t = time.time()
        while time.time() - t < 25 and mutex_exists("Local\\MyLaptopActivityMonitorSupervisor"):
            time.sleep(0.5)
        print("Supervisor stopped." if not mutex_exists("Local\\MyLaptopActivityMonitorSupervisor") else "Supervisor did not stop in time.")
    if mutex_exists("Local\\MyLaptopActivityMonitorCollector"):  # collector started without supervisor
        set_kv(d, "stop_requested", True)
        t = time.time()
        while time.time() - t < 10 and mutex_exists("Local\\MyLaptopActivityMonitorCollector"):
            time.sleep(0.5)
    print("Collector stopped." if not mutex_exists("Local\\MyLaptopActivityMonitorCollector") else "Collector did not stop in time.")
    h = health()
    if h and h.get("foreign"):
        print(f"Port {PORT} is used by another program (not this monitor) - left untouched.")
        return
    if h and h.get("server", {}).get("pid"):  # server started without supervisor
        subprocess.run(["taskkill", "/PID", str(h["server"]["pid"]), "/T", "/F"], creationflags=NO_WINDOW, capture_output=True)
    print("Dashboard server stopped." if not health() else "Dashboard server still running.")


def main():
    args = sys.argv[1:]
    if "--stop" in args:
        stop_all()
        return 0
    if "--set-open-browser" in args:
        v = args[args.index("--set-open-browser") + 1] in ("1", "true", "yes", "y")
        set_setting(db(), "open_browser_at_login", v)
        print(f"Open dashboard at login: {'on' if v else 'off'}")
        return 0
    if "--status" in args:
        print(json.dumps(health() or {"server": "offline"}, indent=1))
        return 0
    d = db()
    d.execute("DELETE FROM kv WHERE key='supervisor_stop'")
    if "--login" not in args:
        set_setting(d, "monitoring_enabled", True)  # manual start = user wants monitoring on
    open_browser = "--open" in args or ("--login" in args and get_setting(d, "open_browser_at_login", False))
    h = kernel32.CreateMutexW(None, False, "Local\\MyLaptopActivityMonitorSupervisor")
    if ctypes.get_last_error() == 183:
        kernel32.CloseHandle(ctypes.c_void_p(h))  # don't keep the running supervisor's mutex alive
        log("supervisor already running; " + ("opening dashboard" if open_browser else "nothing to do"))
        if open_browser:
            wait_and_open()
        return 0
    if open_browser:
        import threading
        threading.Thread(target=wait_and_open, daemon=True).start()
    d.close()
    Supervisor().run()
    kernel32.CloseHandle(ctypes.c_void_p(h))
    return 0


if __name__ == "__main__":
    sys.exit(main())
