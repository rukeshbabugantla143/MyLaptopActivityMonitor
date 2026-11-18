# Database schema

File: `%LOCALAPPDATA%\MyLaptopActivityMonitor\activity.db` (SQLite in WAL mode). The source of truth is `collector/schema.sql`. All timestamps are Unix epoch seconds (`REAL`). Day boundaries are computed in local time by the dashboard.

| Table | Purpose | Columns |
|---|---|---|
| `app_sessions` | One row per continuous foreground use of an app | `id, app, exe, start_ts, end_ts, duration, title` (`title` is NULL unless window-title tracking is enabled) |
| `state_sessions` | Active / idle / locked periods | `id, state, start_ts, end_ts, duration` |
| `system_samples` | Whole-system CPU and RAM every resource interval | `ts, cpu_pct, ram_pct, ram_used, ram_total, proc_count` |
| `process_samples` | Top ~60 executables by CPU and by RAM, aggregated by name | `ts, name, cpu_pct, rss, instances, foreground` |
| `battery_samples` | Battery readings | `ts, percent, plugged, secs_left, charge_rate_mw, discharge_rate_mw, remaining_mwh` |
| `app_categories` | Your category overrides | `exe (PK, NOCASE), category` |
| `settings` | JSON-encoded settings | `key, value` |
| `kv` | Live state | `collector` (heartbeat), `current_app`, `processes` (latest full snapshot), `startup_apps`, `battery_detail`, `battery_health`, `battery_available`, `stop_requested` |
| `events` | Audit trail | `collector_start`, `collector_stop`, `gap` (sleep/stall) |

## Retention

The `retention_days` setting (default 90) applies to sessions, battery samples and events. Resource samples (`system_samples`, `process_samples`) are kept for at most 14 days to limit size. Cleanup runs every 6 hours.

## Example queries

```sql
-- Today's top apps (local midnight passed as :d)
SELECT app, SUM(MIN(end_ts, strftime('%s','now')) - MAX(start_ts, :d)) secs
FROM app_sessions WHERE end_ts > :d GROUP BY exe ORDER BY secs DESC;

-- Battery history
SELECT datetime(ts,'unixepoch','localtime'), percent, plugged FROM battery_samples ORDER BY ts;
```

## v2 migration: Chrome website tracking (additive)

Applied automatically by `CREATE TABLE IF NOT EXISTS` in `collector/schema.sql`. No existing table or column is changed, and existing data is untouched. A backup taken before the migration is at `%LOCALAPPDATA%\MyLaptopActivityMonitor\activity.backup-before-websites.db`.

| Table | Purpose | Columns |
|---|---|---|
| `chrome_profiles` | One row per extension install (= Chrome profile) | `profile_id` (UUID, PK), `secret_hash` (SHA-256), `label` (NULL = Unconfigured), `label_ts`, `enabled`, `ext_version`, `first_seen`, `last_seen`, `last_activity` |
| `web_sessions` | Continuous active use of one domain | `id` (UUID from the extension, PK, so re-sends are idempotent), `profile_id`, `profile_label`, `browser`, `domain`, `start_ts`, `end_ts`, `duration`, `day` (local date), `end_reason` |
| `web_domains` | Your category and productivity overrides | `domain` (PK, NOCASE), `category`, `productivity` |

Indexes: `ix_web_time(start_ts,end_ts)`, `ix_web_profile_day(profile_id,day)`, `ix_web_domain(domain)`.

New settings: `website_tracking_enabled` (default true), `monitoring_enabled`, `open_browser_at_login`. `web_sessions` follows the same `retention_days` as app sessions.

Writes: one upsert per segment change, plus one update per open segment every 30 s while Chrome is in front.
