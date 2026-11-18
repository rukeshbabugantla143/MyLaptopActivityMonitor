"""
Merge activity data from older Activity Monitor database file(s) into the live database, without duplicates.

    python scripts\\merge_db.py <old.db> [<old2.db> ...]

- Backs up the live database first (activity.before-merge-<time>.db).
- Only ADDS rows that are not already present; never deletes or changes existing rows.
- Settings, categories and Chrome profile names are copied only where the live database has none.
"""
import os
import sqlite3
import sys
import time

_test_db = os.environ.get("MLAM_DB")  # test mode: only for a database OUTSIDE AppData
if _test_db and "appdata" in os.path.abspath(_test_db).lower():
    sys.exit("MLAM_DB test mode may not point into AppData")
if not _test_db:
    import subprocess
    if subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_redirect.py")]).returncode == 3:
        sys.exit(3)

APP_DIR = os.path.join(os.environ["LOCALAPPDATA"], "MyLaptopActivityMonitor")
LIVE = _test_db or os.path.join(APP_DIR, "activity.db")
if _test_db:
    APP_DIR = os.path.dirname(os.path.abspath(_test_db))
SCHEMA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "collector", "schema.sql")

# table -> columns that identify a duplicate
KEYS = {
    "app_sessions": ("start_ts", "exe"),
    "state_sessions": ("start_ts", "state"),
    "system_samples": ("ts",),
    "process_samples": ("ts", "name"),
    "battery_samples": ("ts",),
    "events": ("ts", "kind"),
    "web_sessions": ("id",),
    "chrome_profiles": ("profile_id",),
    "app_categories": ("exe",),
    "web_domains": ("domain",),
    "settings": ("key",),
}
SKIP_SETTINGS = {"paused", "monitoring_enabled"}


def cols(db, schema, table):
    try:
        return [r[1] for r in db.execute(f"PRAGMA {schema}.table_info({table})")]
    except sqlite3.DatabaseError:
        return []


def main(paths):
    os.makedirs(APP_DIR, exist_ok=True)
    live = sqlite3.connect(LIVE, timeout=30)
    live.execute("PRAGMA journal_mode=WAL")
    with open(SCHEMA, encoding="utf-8") as f:
        live.executescript(f.read())
    backup = os.path.join(APP_DIR, time.strftime("activity.before-merge-%Y%m%d-%H%M%S.db"))
    b = sqlite3.connect(backup); live.backup(b); b.close()
    print(f"Backup of current data: {backup}")
    for p in paths:
        if not os.path.exists(p):
            print(f"skip (not found): {p}"); continue
        check = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
        try:
            ok = check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        except sqlite3.DatabaseError:
            ok = False
        check.close()
        if not ok:
            print(f"skip (damaged file): {p}"); continue
        print(f"\nMerging {p}")
        live.execute("ATTACH DATABASE ? AS old", (p,))
        total = 0
        with live:
            for t, key in KEYS.items():
                oc, lc = cols(live, "old", t), cols(live, "main", t)
                common = [c for c in oc if c in lc and c != "id"] if t != "web_sessions" else [c for c in oc if c in lc]
                if not common:
                    continue
                where = " AND ".join(f"m.{k} IS o.{k}" for k in key)
                extra = " AND o.key NOT IN (%s)" % ",".join("?" * len(SKIP_SETTINGS)) if t == "settings" else ""
                args = tuple(SKIP_SETTINGS) if t == "settings" else ()
                cl = ",".join(common)
                cur = live.execute(
                    f"INSERT INTO main.{t}({cl}) SELECT {','.join('o.' + c for c in common)} FROM old.{t} o "
                    f"WHERE NOT EXISTS (SELECT 1 FROM main.{t} m WHERE {where}){extra}", args)
                if cur.rowcount:
                    print(f"  {t:<16} +{cur.rowcount}")
                    total += cur.rowcount
        live.execute("DETACH DATABASE old")
        print(f"  added {total} rows")
    live.close()
    print("\nMerge finished.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
