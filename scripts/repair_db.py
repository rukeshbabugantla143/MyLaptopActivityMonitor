"""
Repair a damaged Activity Monitor database ("database disk image is malformed").

    python scripts\\repair_db.py            (the monitor must be stopped first - REPAIR-DATABASE.bat does that)

1. Keeps the damaged file untouched as activity.corrupt-<time>.db (+ its -wal/-shm).
2. Creates a fresh database with the current schema.
3. Copies every readable row of every table (bulk first, then row by row around damaged pages).
   Temporary live state (kv) is skipped: the app regenerates it within seconds.
4. Checks the new database (integrity_check) and only then puts it in place.
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(os.path.dirname(HERE), "collector", "schema.sql")
_test_db = os.environ.get("MLAM_DB")  # test mode: only for a database OUTSIDE AppData
if _test_db and "appdata" in os.path.abspath(_test_db).lower():
    sys.exit("MLAM_DB test mode may not point into AppData")
if not _test_db and subprocess.run([sys.executable, os.path.join(HERE, "check_redirect.py")]).returncode == 3:
    sys.exit(3)
LIVE = _test_db or os.path.join(os.environ["LOCALAPPDATA"], "MyLaptopActivityMonitor", "activity.db")
TABLES = ["app_sessions", "state_sessions", "web_sessions", "battery_samples", "system_samples", "process_samples",
          "events", "chrome_profiles", "web_domains", "app_categories", "settings"]  # kv deliberately skipped


def main():
    if not os.path.exists(LIVE):
        sys.exit(f"No database at {LIVE}")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    folder = os.path.dirname(LIVE)
    keep = os.path.join(folder, f"activity.corrupt-{stamp}.db")
    for ext in ("", "-wal", "-shm"):
        if os.path.exists(LIVE + ext):
            shutil.copy2(LIVE + ext, keep + ext)
    print(f"Damaged file kept as {keep}")

    new_path = os.path.join(folder, f"activity.repaired-{stamp}.db")
    new = sqlite3.connect(new_path)
    with open(SCHEMA, encoding="utf-8") as f:
        new.executescript(f.read())
    new.execute("ATTACH DATABASE ? AS old", (keep,))
    report = {}
    for t in TABLES:
        try:
            oc = [r[1] for r in new.execute(f"PRAGMA old.table_info({t})")]
        except sqlite3.DatabaseError as e:
            report[t] = f"unreadable schema ({e})"; continue
        nc = [r[1] for r in new.execute(f"PRAGMA main.table_info({t})")]
        common = ",".join(c for c in oc if c in nc)
        if not common:
            report[t] = "missing"; continue
        try:
            with new:
                n = new.execute(f"INSERT OR IGNORE INTO main.{t}({common}) SELECT {common} FROM old.{t}").rowcount
            report[t] = f"{n} rows"
            continue
        except sqlite3.DatabaseError:
            new.rollback()
        # Row by row: walk rowids in chunks and skip the ones on damaged pages
        ok = bad = 0
        try:
            hi = new.execute(f"SELECT MAX(rowid) FROM old.{t}").fetchone()[0] or 0
        except sqlite3.DatabaseError:
            hi = 10_000_000
        rid, step = 0, 500
        while rid <= hi:
            try:
                with new:
                    ok += new.execute(f"INSERT OR IGNORE INTO main.{t}({common}) SELECT {common} FROM old.{t} WHERE rowid BETWEEN ? AND ?", (rid, rid + step - 1)).rowcount
            except sqlite3.DatabaseError:
                for r in range(rid, rid + step):
                    try:
                        with new:
                            ok += new.execute(f"INSERT OR IGNORE INTO main.{t}({common}) SELECT {common} FROM old.{t} WHERE rowid=?", (r,)).rowcount
                    except sqlite3.DatabaseError:
                        bad += 1
            rid += step
        report[t] = f"{ok} rows recovered, {bad} unreadable skipped"
    new.execute("DETACH DATABASE old")
    check = new.execute("PRAGMA integrity_check").fetchone()[0]
    new.close()
    for t, r in report.items():
        print(f"  {t:<16} {r}")
    if check != "ok":
        sys.exit(f"Repaired copy failed its check ({check}); nothing was replaced. Files: {new_path}")
    for ext in ("-wal", "-shm"):
        if os.path.exists(LIVE + ext):
            os.remove(LIVE + ext)
    os.replace(new_path, LIVE)
    print("\nDatabase repaired and checked OK.")


if __name__ == "__main__":
    main()
