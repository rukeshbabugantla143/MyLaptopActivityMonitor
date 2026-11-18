import fs from "fs";
import path from "path";
import os from "os";

// node:sqlite is built into Node >= 22.5. Loaded at runtime so the bundler never touches it.
type Stmt = { all: (...a: unknown[]) => any[]; get: (...a: unknown[]) => any; run: (...a: unknown[]) => any };
type DB = { prepare: (sql: string) => Stmt; exec: (sql: string) => void };

export const APP_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "MyLaptopActivityMonitor");
export const DB_PATH = process.env.MLAM_DB || path.join(APP_DIR, "activity.db");
export const PROJECT_ROOT = path.resolve(process.cwd(), "..");
export const COLLECTOR_DIR = path.join(PROJECT_ROOT, "collector");

const g = globalThis as unknown as { __mlamDb?: DB };

export function db(): DB {
  if (g.__mlamDb) return g.__mlamDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const { DatabaseSync } = (process as any).getBuiltinModule("node:sqlite");
  const d: DB = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  d.exec(fs.readFileSync(path.join(COLLECTOR_DIR, "schema.sql"), "utf8"));
  g.__mlamDb = d;
  return d;
}

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  idle_threshold_sec: 300, fg_interval_sec: 3, res_interval_sec: 15, battery_interval_sec: 60,
  retention_days: 90, daily_goal_min: 480, paused: false, track_window_titles: false,
  notifications_enabled: false, notify_goal: false, notify_resources: false, notify_app_limits: false,
  app_limits: {}, cpu_warn_pct: 50, ram_warn_mb: 1500, monitoring_enabled: true, open_browser_at_login: false, website_tracking_enabled: true,
};

export function getSettings(): Record<string, any> {
  const s: Record<string, any> = { ...DEFAULT_SETTINGS };
  for (const r of db().prepare("SELECT key,value FROM settings").all()) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  return s;
}

export function setSetting(key: string, value: unknown) {
  db().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}

export function kv<T = any>(key: string): { value: T; updated: number } | null {
  const r = db().prepare("SELECT value,updated FROM kv WHERE key=?").get(key);
  if (!r) return null;
  try { return { value: JSON.parse(r.value), updated: r.updated }; } catch { return null; }
}

export function setKv(key: string, value: unknown) {
  db().prepare("INSERT INTO kv(key,value,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated")
    .run(key, JSON.stringify(value), Date.now() / 1000);
}

// ---------- time helpers (local time)
export const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
export const addDays = (ts: number, n: number) => {
  const d = new Date(ts * 1000); d.setDate(d.getDate() + n); return dayStart(d);
};
export const dayKey = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const nowTs = () => Date.now() / 1000;

export type Seg = { app: string; exe: string; s: number; e: number; title?: string | null };

/** App sessions overlapping [s,e), clipped to the window. */
export function appSegments(s: number, e: number): Seg[] {
  // The open session is only flushed every 30 s; extend it to "now" while the collector is live.
  const cur = kv<any>("current_app");
  const live = cur && collectorStatus().running ? cur.value.since : null;
  const now = nowTs();
  return db().prepare("SELECT app,exe,start_ts,end_ts,title FROM app_sessions WHERE (end_ts>? OR start_ts=?) AND start_ts<? ORDER BY start_ts")
    .all(s, live ?? -1, e)
    .map((r) => {
      const end = live != null && r.start_ts === live ? Math.max(r.end_ts, now) : r.end_ts;
      return { app: r.app, exe: r.exe, s: Math.max(r.start_ts, s), e: Math.min(end, e), title: r.title };
    })
    .filter((x) => x.e > x.s);
}

export function stateSegments(s: number, e: number) {
  return db().prepare("SELECT state,start_ts,end_ts FROM state_sessions WHERE end_ts>? AND start_ts<? ORDER BY start_ts")
    .all(s, e)
    .map((r) => ({ state: r.state as string, s: Math.max(r.start_ts, s), e: Math.min(r.end_ts, e) }))
    .filter((x) => x.e > x.s);
}

export function collectorStatus() {
  const c = kv<any>("collector");
  const s = getSettings();
  const running = !!c && nowTs() - c.value.beat < Math.max(20, s.fg_interval_sec * 5);
  return { running, paused: !!s.paused, pid: running ? c!.value.pid : null, started: running ? c!.value.started : null, lastBeat: c?.value.beat ?? null };
}

export function supervisorStatus() {
  const s = kv<any>("supervisor");
  const alive = !!s && nowTs() - s.value.beat < 40;
  return { alive, ...(alive ? s!.value : {}) };
}

export function categoriesMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of db().prepare("SELECT exe,category FROM app_categories").all()) m[r.exe.toLowerCase()] = r.category;
  return m;
}
