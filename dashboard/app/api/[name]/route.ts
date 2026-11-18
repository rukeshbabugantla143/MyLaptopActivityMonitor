import { NextRequest, NextResponse } from "next/server";
import { spawn, execFile } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import {
  db, getSettings, setSetting, kv, setKv, dayStart, addDays, dayKey, nowTs, appSegments, stateSegments,
  collectorStatus, supervisorStatus, categoriesMap, COLLECTOR_DIR, DB_PATH, DEFAULT_SETTINGS, Seg,
} from "@/lib/db";
import { categoryFor, CATEGORIES, PRODUCTIVE } from "@/lib/categories";
import { classify, WEB_CATEGORIES, PRODUCTIVITY } from "@/lib/websites";

// ------------------------------------------------------------------ websites helpers
type WSeg = { domain: string; s: number; e: number; profile_id: string; profile_label: string | null };
type Iv = [number, number];

/** Remove the parts of [s,e) covered by sorted, non-overlapping "bad" intervals. */
function subtract(s: number, e: number, bad: Iv[]): Iv[] {
  const out: Iv[] = []; let cur = s;
  for (const [bs, be] of bad) {
    if (be <= cur) continue;
    if (bs >= e) break;
    if (bs > cur) out.push([cur, Math.min(bs, e)]);
    cur = Math.max(cur, be);
    if (cur >= e) break;
  }
  if (cur < e) out.push([cur, e]);
  return out;
}
function mergeIv(iv: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const x of [...iv].sort((a, b) => a[0] - b[0])) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([...x] as Iv); }
  return out;
}

/**
 * Website segments for [s,e), made consistent and free of double counting:
 *  1. Across ALL profiles only one website can be active at a time: where segments overlap, the most recently
 *     started one wins (it is the window that most recently gained focus).
 *  2. Where the Windows collector was running, time is only kept while chrome.exe was the foreground app
 *     and the user was active (not idle / locked). Outside the collector's coverage the extension's data is used as-is.
 *  3. Then filtered to the requested profile.
 */
function webSegments(s: number, e: number, profile: string): WSeg[] {
  const rows = db().prepare("SELECT domain,start_ts,end_ts,profile_id,profile_label FROM web_sessions WHERE end_ts>? AND start_ts<? ORDER BY start_ts, end_ts")
    .all(s, e).map((r) => ({ domain: r.domain, s: Math.max(r.start_ts, s), e: Math.min(r.end_ts, e), profile_id: r.profile_id, profile_label: r.profile_label }));
  for (let i = 0; i < rows.length - 1; i++) if (rows[i + 1].s < rows[i].e) rows[i].e = rows[i + 1].s; // latest start wins
  const chromeFg = mergeIv(appSegments(s, e).filter((g) => g.exe.toLowerCase() === "chrome.exe").map((g) => [g.s, g.e] as Iv));
  const bad: Iv[] = [];
  for (const st of stateSegments(s, e)) {
    if (st.state !== "active") bad.push([st.s, st.e]);
    else for (const piece of subtract(st.s, st.e, chromeFg)) bad.push(piece);
  }
  const badM = mergeIv(bad);
  const out: WSeg[] = [];
  for (const r of rows) {
    if (r.e <= r.s) continue;
    if (profile === "unconfigured" ? !unconfiguredIds().has(r.profile_id) : profile !== "all" && r.profile_id !== profile) continue;
    for (const [a, b2] of subtract(r.s, r.e, badM)) if (b2 - a >= 1) out.push({ ...r, s: a, e: b2 });
  }
  return out;
}
let _unconf: { at: number; ids: Set<string> } | null = null;
function unconfiguredIds() {
  if (!_unconf || Date.now() - _unconf.at > 2000) _unconf = { at: Date.now(), ids: new Set(db().prepare("SELECT profile_id FROM chrome_profiles WHERE label IS NULL").all().map((r) => r.profile_id)) };
  return _unconf.ids;
}
/** Visits: consecutive segments of the same domain (same profile) less than 30 s apart count as one visit. */
function mergeVisits(segs: WSeg[]) {
  const out: WSeg[] = [];
  for (const g of segs) {
    const l = out[out.length - 1];
    if (l && l.domain === g.domain && l.profile_id === g.profile_id && g.s - l.e < 30) l.e = Math.max(l.e, g.e); else out.push({ ...g });
  }
  return out;
}
function domainOverrides() {
  return new Map<string, { category: string | null; productivity: string | null }>(
    db().prepare("SELECT domain,category,productivity FROM web_domains").all().map((r) => [String(r.domain).toLowerCase(), { category: r.category, productivity: r.productivity }]));
}
function profileLabels() {
  const m = new Map<string, string>();
  for (const r of db().prepare("SELECT profile_id,label FROM chrome_profiles").all()) m.set(r.profile_id, r.label || "Unconfigured");
  return m;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (d: unknown, status = 200) => NextResponse.json(d, { status });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function byApp(segs: Seg[]) {
  const m = new Map<string, { app: string; exe: string; secs: number; sessions: number }>();
  for (const g of segs) {
    const k = g.exe.toLowerCase();
    const v = m.get(k) || { app: g.app, exe: g.exe, secs: 0, sessions: 0 };
    v.secs += g.e - g.s; v.sessions += 1; m.set(k, v);
  }
  return [...m.values()].sort((a, b) => b.secs - a.secs);
}

function stateTotals(s: number, e: number) {
  const t: Record<string, number> = { active: 0, idle: 0, locked: 0 };
  for (const g of stateSegments(s, e)) t[g.state] = (t[g.state] || 0) + (g.e - g.s);
  return t;
}

function latestBattery() {
  return db().prepare("SELECT * FROM battery_samples ORDER BY ts DESC LIMIT 1").get() || null;
}

// ------------------------------------------------------------------ GET handlers
const GET_HANDLERS: Record<string, (q: URLSearchParams) => unknown> = {
  autostart() { return autostartStatus(); },

  overview() {
    const now = nowTs(), s = dayStart(new Date());
    const segs = appSegments(s, now);
    const apps = byApp(segs);
    const st = stateTotals(s, now);
    const status = collectorStatus();
    const procs = kv<any>("processes");
    const cur = kv<any>("current_app");
    const settings = getSettings();
    const live = procs && now - procs.updated < 120;
    let switches = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].exe !== segs[i - 1].exe) switches++;
    const cats = categoriesMap();
    const catTotals: Record<string, number> = {};
    for (const a of apps) { const c = categoryFor(a.exe, cats); catTotals[c] = (catTotals[c] || 0) + a.secs; }
    return {
      status, goalMin: settings.daily_goal_min, idleThreshold: settings.idle_threshold_sec,
      activeSecs: sum(apps.map((a) => a.secs)), idleSecs: st.idle, lockedSecs: st.locked,
      trackedSecs: st.active + st.idle + st.locked, appsUsed: apps.length, topApps: apps.slice(0, 6), switches,
      categories: Object.entries(catTotals).map(([name, secs]) => ({ name, secs })).sort((a, b) => b.secs - a.secs),
      current: status.running && !status.paused && cur ? cur.value : null,
      cpu: live ? procs!.value.cpu : null, ram: live ? procs!.value.ram : null,
      ramUsed: live ? procs!.value.ram_used : null, ramTotal: live ? procs!.value.ram_total : null,
      battery: latestBattery(), bootTime: os.uptime() ? now - os.uptime() : null,
    };
  },

  screentime(q) {
    const days = Math.min(90, Number(q.get("days") || 30));
    const today = dayStart(new Date()), now = nowTs();
    const from = addDays(today, -(days - 1));
    const segs = appSegments(from, now);
    const states = stateSegments(from, now);
    const daily: { day: string; active: number; idle: number; locked: number }[] = [];
    const idx = new Map<string, number>();
    for (let d = from; d <= today; d = addDays(d, 1)) { idx.set(dayKey(d), daily.length); daily.push({ day: dayKey(d), active: 0, idle: 0, locked: 0 }); }
    const addSplit = (s: number, e: number, field: "active" | "idle" | "locked") => {
      for (let d = dayStart(new Date(s * 1000)); d < e; d = addDays(d, 1)) {
        const de = addDays(d, 1), ov = Math.min(e, de) - Math.max(s, d);
        const i = idx.get(dayKey(d)); if (i !== undefined && ov > 0) daily[i][field] += ov;
      }
    };
    for (const g of segs) addSplit(g.s, g.e, "active");
    for (const g of states) if (g.state !== "active") addSplit(g.s, g.e, g.state as "idle" | "locked");
    // hour-by-hour for today and average across period
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, today: 0, avg: 0 }));
    const bucket = (s: number, e: number, field: "today" | "avg") => {
      let t = s;
      while (t < e) {
        const d = new Date(t * 1000);
        const hEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime() / 1000;
        const ov = Math.min(e, hEnd) - t; hourly[d.getHours()][field] += ov; t = hEnd;
      }
    };
    for (const g of segs) { bucket(g.s, g.e, "avg"); if (g.e > today) bucket(Math.max(g.s, today), g.e, "today"); }
    const daysWithData = daily.filter((d) => d.active > 0).length || 1;
    hourly.forEach((h) => (h.avg = h.avg / daysWithData));
    const last7 = daily.slice(-7), prev7 = daily.slice(-14, -7);
    return {
      daily, hourly,
      avg7: sum(last7.map((d) => d.active)) / Math.max(1, last7.filter((d) => d.active > 0).length),
      avg30: sum(daily.slice(-30).map((d) => d.active)) / Math.max(1, daily.slice(-30).filter((d) => d.active > 0).length),
      total7: sum(last7.map((d) => d.active)), totalPrev7: sum(prev7.map((d) => d.active)),
    };
  },

  apps() {
    const now = nowTs(), today = dayStart(new Date()), wk = addDays(today, -6);
    const t = byApp(appSegments(today, now));
    const w = byApp(appSegments(wk, now));
    const cats = categoriesMap();
    const res = db().prepare("SELECT lower(name) n, AVG(cpu_pct) cpu, AVG(rss) rss, MAX(rss) maxrss FROM process_samples WHERE ts>? GROUP BY lower(name)").all(today);
    const rmap = new Map(res.map((r) => [r.n, r]));
    const tmap = new Map(t.map((a) => [a.exe.toLowerCase(), a]));
    return w.map((a) => {
      const k = a.exe.toLowerCase(), r = rmap.get(k), td = tmap.get(k);
      return { app: a.app, exe: a.exe, today: td?.secs || 0, todaySessions: td?.sessions || 0, week: a.secs,
        category: categoryFor(a.exe, cats), cpu: r ? r.cpu : null, rss: r ? r.rss : null, maxRss: r ? r.maxrss : null };
    });
  },

  background() {
    const p = kv<any>("processes");
    const startup = kv<any[]>("startup_apps")?.value || [];
    const s = getSettings();
    const startupExes = new Set(startup.filter((x) => x.enabled).map((x) => String(x.exe).toLowerCase()));
    // Average CPU per name over the last 10 minutes for "sustained" usage
    const since = nowTs() - 600;
    const sustained = new Map(db().prepare("SELECT lower(name) n, AVG(cpu_pct) cpu, COUNT(*) c FROM process_samples WHERE ts>? GROUP BY lower(name)").all(since).map((r) => [r.n, r.cpu]));
    return {
      ts: p?.value.ts ?? null, cpu: p?.value.cpu ?? null, ram: p?.value.ram ?? null, ramUsed: p?.value.ram_used, ramTotal: p?.value.ram_total,
      cpuWarn: s.cpu_warn_pct, ramWarnMb: s.ram_warn_mb, startup, cores: os.cpus().length,
      list: (p?.value.list || []).map((x: any) => ({ ...x, startup: startupExes.has(String(x.name).toLowerCase()), avg10: sustained.get(String(x.name).toLowerCase()) ?? null })),
      status: collectorStatus(),
    };
  },

  battery(q) {
    const days = Math.min(30, Number(q.get("days") || 2));
    const from = nowTs() - days * 86400;
    const samples = db().prepare("SELECT ts,percent,plugged,secs_left,charge_rate_mw,discharge_rate_mw,remaining_mwh FROM battery_samples WHERE ts>? ORDER BY ts").all(from);
    // Charging / discharging periods (consecutive samples with same plug state, broken by gaps > 10 min)
    const periods: { plugged: boolean; s: number; e: number; p0: number; p1: number }[] = [];
    for (const x of samples) {
      const last = periods[periods.length - 1];
      if (last && last.plugged === !!x.plugged && x.ts - last.e < 600) { last.e = x.ts; last.p1 = x.percent; }
      else periods.push({ plugged: !!x.plugged, s: x.ts, e: x.ts, p0: x.percent, p1: x.percent });
    }
    const dis = periods.filter((p) => !p.plugged && p.e - p.s > 600 && p.p0 > p.p1);
    const drainPerHour = dis.length ? sum(dis.map((p) => p.p0 - p.p1)) / (sum(dis.map((p) => p.e - p.s)) / 3600) : null;
    // daily battery usage: sum of percentage drops while unplugged, last 14 days
    const all = db().prepare("SELECT ts,percent,plugged FROM battery_samples WHERE ts>? ORDER BY ts").all(addDays(dayStart(new Date()), -13));
    const daily: Record<string, { used: number; unpluggedSecs: number }> = {};
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      if (!a.plugged && !b.plugged && b.ts - a.ts < 600) {
        const k = dayKey(b.ts); daily[k] ||= { used: 0, unpluggedSecs: 0 };
        if (a.percent > b.percent) daily[k].used += a.percent - b.percent;
        daily[k].unpluggedSecs += b.ts - a.ts;
      }
    }
    return {
      available: kv("battery_available")?.value ?? null, latest: latestBattery(), detail: kv("battery_detail")?.value || null,
      health: kv("battery_health")?.value || null, samples, periods: periods.slice(-40).reverse(), drainPerHour,
      daily: Object.entries(daily).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  },

  timeline(q) {
    const date = q.get("date");
    const base = date ? new Date(date + "T00:00:00") : new Date();
    const s = dayStart(base), e = Math.min(addDays(s, 1), nowTs());
    const segs = appSegments(s, e);
    const merged: Seg[] = [];
    for (const g of segs) {
      const last = merged[merged.length - 1];
      if (last && last.exe === g.exe && g.s - last.e < 5) last.e = g.e; else merged.push({ ...g });
    }
    const cats = categoriesMap();
    return {
      date: dayKey(s), start: s,
      items: merged.map((m) => ({ ...m, category: categoryFor(m.exe, cats) })),
      states: stateSegments(s, e).filter((x) => x.state !== "active"),
      gaps: db().prepare("SELECT ts,detail FROM events WHERE kind='gap' AND ts BETWEEN ? AND ?").all(s, e),
    };
  },

  weekly(q) {
    const offset = Number(q.get("offset") || 0);
    const today = dayStart(new Date());
    const end = offset === 0 ? nowTs() : addDays(today, 1 - offset * 7);
    const start = addDays(today, -6 - offset * 7);
    const pStart = addDays(start, -7);
    const segs = appSegments(start, end), pSegs = appSegments(pStart, start);
    const cats = categoriesMap();
    const apps = byApp(segs).map((a) => ({ ...a, category: categoryFor(a.exe, cats) }));
    const pApps = new Map(byApp(pSegs).map((a) => [a.exe.toLowerCase(), a.secs]));
    const days: { day: string; secs: number }[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) days.push({ day: dayKey(d), secs: sum(appSegments(d, Math.min(addDays(d, 1), end)).map((x) => x.e - x.s)) });
    const total = sum(days.map((d) => d.secs)), prevTotal = sum(pSegs.map((x) => x.e - x.s));
    const daysWithData = days.filter((d) => d.secs > 0).length;
    const catTotals: Record<string, number> = {};
    for (const a of apps) catTotals[a.category] = (catTotals[a.category] || 0) + a.secs;
    const st = stateTotals(start, end);
    const goal = getSettings().daily_goal_min * 60;
    // late-night usage (after 23:00 or before 05:00)
    let late = 0;
    for (const g of segs) { let t = g.s; while (t < g.e) { const h = new Date(t * 1000).getHours(); const step = Math.min(g.e - t, 60); if (h >= 23 || h < 5) late += step; t += step; } }
    let switches = 0; for (let i = 1; i < segs.length; i++) if (segs[i].exe !== segs[i - 1].exe) switches++;
    const recs: string[] = [];
    const highest = [...days].sort((a, b) => b.secs - a.secs)[0];
    if (daysWithData === 0) recs.push("No activity was recorded this week yet. Keep the collector running to get recommendations.");
    else {
      const avg = total / daysWithData;
      const over = days.filter((d) => d.secs > goal).length;
      if (over > 0) recs.push(`You exceeded your daily goal of ${Math.round(goal / 3600 * 10) / 10} h on ${over} of ${daysWithData} tracked day(s).`);
      else recs.push(`You stayed within your ${Math.round(goal / 3600 * 10) / 10} h daily goal on every tracked day.`);
      if (prevTotal > 0) { const ch = ((total - prevTotal) / prevTotal) * 100; recs.push(`Screen time is ${ch >= 0 ? "up" : "down"} ${Math.abs(ch).toFixed(0)}% compared with the previous 7 days.`); }
      if (late > 1800) recs.push(`${(late / 3600).toFixed(1)} h of use happened between 23:00 and 05:00. Consider winding down earlier.`);
      const ent = catTotals["Entertainment"] || 0;
      if (ent > total * 0.25) recs.push(`Apps you categorised as Entertainment took ${Math.round(ent / total * 100)}% of active time.`);
      const perHour = switches / Math.max(1, total / 3600);
      if (perHour > 40) recs.push(`You switched apps about ${Math.round(perHour)} times per active hour, which can indicate fragmented focus.`);
      if (st.idle > total * 0.5) recs.push("Idle time was high relative to active time. The screen may be staying on while you're away; a shorter screen timeout could save battery.");
      if (apps[0] && apps[0].secs > total * 0.5) recs.push(`${apps[0].app} accounted for over half of your active time.`);
      if (avg > 0 && highest) recs.push(`Your busiest day was ${highest.day} with ${(highest.secs / 3600).toFixed(1)} h.`);
    }
    return {
      start, end, days, total, prevTotal, dailyAvg: daysWithData ? total / daysWithData : 0, daysWithData,
      apps: apps.slice(0, 15).map((a) => ({ ...a, prev: pApps.get(a.exe.toLowerCase()) || 0 })),
      categories: Object.entries(catTotals).map(([name, secs]) => ({ name, secs })).sort((a, b) => b.secs - a.secs),
      productive: sum(apps.filter((a) => PRODUCTIVE.has(a.category)).map((a) => a.secs)),
      entertainment: catTotals["Entertainment"] || 0, idle: st.idle, locked: st.locked, late, switches,
      highest: highest && highest.secs > 0 ? highest : null, recommendations: recs, goal,
    };
  },

  settings() {
    return { settings: getSettings(), status: collectorStatus(), dbPath: DB_PATH, dbSize: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0 };
  },

  categories() {
    const cats = categoriesMap();
    const exes = db().prepare("SELECT exe, MAX(app) app, SUM(duration) secs FROM app_sessions GROUP BY lower(exe) ORDER BY secs DESC").all();
    return { categories: CATEGORIES, apps: exes.map((r) => ({ exe: r.exe, app: r.app, secs: r.secs, category: categoryFor(r.exe, cats), custom: !!cats[r.exe.toLowerCase()] })) };
  },

  websites(q) {
    const date = q.get("date"), profile = q.get("profile") || "all";
    const base = date ? new Date(date + "T00:00:00") : new Date();
    const s = dayStart(base), e = Math.min(addDays(s, 1), nowTs());
    const ov = domainOverrides(), labels = profileLabels();
    const segs = webSegments(s, e, profile);
    const visits = mergeVisits(segs);
    const total = sum(segs.map((g) => g.e - g.s));
    const dm = new Map<string, any>();
    for (const g of segs) { const v = dm.get(g.domain) || { domain: g.domain, secs: 0, visits: 0, last: 0 }; v.secs += g.e - g.s; v.last = Math.max(v.last, g.e); dm.set(g.domain, v); }
    for (const v of visits) dm.get(v.domain).visits++;
    const domains = [...dm.values()].map((v) => ({ ...v, avg: v.secs / Math.max(1, v.visits), ...classify(v.domain, ov) })).sort((a, b) => b.secs - a.secs);
    const cat: Record<string, number> = {}, prod: Record<string, number> = { Productive: 0, Neutral: 0, Distracting: 0 };
    for (const v of domains) { cat[v.category] = (cat[v.category] || 0) + v.secs; prod[v.productivity] = (prod[v.productivity] || 0) + v.secs; }
    const chromeFg = sum(appSegments(s, e).filter((g) => g.exe.toLowerCase() === "chrome.exe").map((g) => g.e - g.s));
    const trend: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const ds = addDays(s, -i), de = Math.min(addDays(ds, 1), nowTs());
      const t: any = { day: dayKey(ds), secs: 0, Productive: 0, Neutral: 0, Distracting: 0 };
      if (de > ds) for (const g of webSegments(ds, de, profile)) { const d = g.e - g.s; t.secs += d; t[classify(g.domain, ov).productivity] += d; }
      trend.push(t);
    }
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, secs: 0 }));
    for (const g of segs) { let t = g.s; while (t < g.e) { const d = new Date(t * 1000); const he = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime() / 1000; hourly[d.getHours()].secs += Math.min(g.e, he) - t; t = he; } }
    return {
      date: dayKey(s), start: s, profile, total, chromeForeground: chromeFg, unique: domains.length, visits: visits.length,
      avgVisit: visits.length ? total / visits.length : 0, domains,
      categories: Object.entries(cat).map(([name, secs]) => ({ name, secs })).sort((a, b) => b.secs - a.secs),
      productivity: prod, trend, last7: sum(trend.slice(-7).map((t) => t.secs)), prev7: sum(trend.slice(0, 7).map((t) => t.secs)), hourly,
      timeline: visits.map((v) => ({ ...v, label: labels.get(v.profile_id) || "Unconfigured", ...classify(v.domain, ov) })),
      profiles: db().prepare("SELECT profile_id,label FROM chrome_profiles ORDER BY first_seen").all().map((r) => ({ id: r.profile_id, label: r.label || "Unconfigured" })),
      enabled: getSettings().website_tracking_enabled !== false,
    };
  },

  webprofiles() {
    const now = nowTs(), t0 = dayStart(new Date());
    const rows = db().prepare("SELECT * FROM chrome_profiles ORDER BY first_seen").all();
    const today = new Map(db().prepare("SELECT profile_id, SUM(MIN(end_ts,?)-MAX(start_ts,?)) secs FROM web_sessions WHERE end_ts>? GROUP BY profile_id").all(now, t0, t0).map((r) => [r.profile_id, r.secs]));
    const all = new Map(db().prepare("SELECT profile_id, SUM(duration) secs, COUNT(DISTINCT domain) domains FROM web_sessions GROUP BY profile_id").all().map((r) => [r.profile_id, r]));
    return {
      globalEnabled: getSettings().website_tracking_enabled !== false,
      profiles: rows.map((r) => ({
        id: r.profile_id, label: r.label, configured: !!r.label, enabled: !!r.enabled, version: r.ext_version,
        firstSeen: r.first_seen, lastSeen: r.last_seen, lastActivity: r.last_activity,
        connected: now - r.last_seen < 150, todaySecs: today.get(r.profile_id) || 0, totalSecs: all.get(r.profile_id)?.secs || 0,
        domains: all.get(r.profile_id)?.domains || 0,
      })),
    };
  },

  status() { return { ...collectorStatus(), supervisor: supervisorStatus(), lastData: kv("collector")?.value?.beat ?? null }; },

  health() {
    const c = collectorStatus(), sup = supervisorStatus(), now = nowTs();
    const cur = kv<any>("current_app");
    const today = appSegments(dayStart(new Date()), now);
    return {
      ok: true, app: "my-laptop-activity-monitor", time: now,
      server: { state: "online", pid: process.pid, uptimeSec: Math.round(process.uptime()), host: "127.0.0.1", port: 3939 },
      collector: { ...c, state: !c.running ? (getSettings().monitoring_enabled === false ? "stopped" : sup.alive ? sup.collector?.state : "stopped") : c.paused ? "paused" : "tracking" },
      supervisor: sup,
      lastData: c.lastBeat, currentApp: c.running && !c.paused && cur ? cur.value : null,
      todayActiveSec: Math.round(sum(today.map((g) => g.e - g.s))),
    };
  },
};

// ------------------------------------------------------------------ CSV export
function csv(rows: any[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
const iso = (t: number) => new Date(t * 1000).toISOString();

function exportCsv(type: string) {
  const d = db();
  switch (type) {
    case "websites": return d.prepare("SELECT w.domain, w.start_ts, w.end_ts, w.duration, w.profile_id, COALESCE(p.label,'Unconfigured') label, w.end_reason FROM web_sessions w LEFT JOIN chrome_profiles p USING(profile_id) ORDER BY w.start_ts").all().map((r) => ({ profile: r.label, profile_id: r.profile_id, domain: r.domain, start: iso(r.start_ts), end: iso(r.end_ts), seconds: Math.round(r.duration), end_reason: r.end_reason }));
    case "sessions": return d.prepare("SELECT app,exe,start_ts,end_ts,duration FROM app_sessions ORDER BY start_ts").all().map((r) => ({ app: r.app, exe: r.exe, start: iso(r.start_ts), end: iso(r.end_ts), seconds: Math.round(r.duration) }));
    case "states": return d.prepare("SELECT state,start_ts,end_ts,duration FROM state_sessions ORDER BY start_ts").all().map((r) => ({ state: r.state, start: iso(r.start_ts), end: iso(r.end_ts), seconds: Math.round(r.duration) }));
    case "battery": return d.prepare("SELECT * FROM battery_samples ORDER BY ts").all().map((r) => ({ time: iso(r.ts), percent: r.percent, plugged: r.plugged, secs_left: r.secs_left, charge_rate_mw: r.charge_rate_mw, discharge_rate_mw: r.discharge_rate_mw, remaining_mwh: r.remaining_mwh }));
    case "daily": {
      const rows = d.prepare("SELECT exe, MAX(app) app, start_ts, end_ts FROM app_sessions GROUP BY id ORDER BY start_ts").all();
      const m = new Map<string, any>();
      for (const r of rows) { const k = dayKey(r.start_ts) + "|" + r.exe.toLowerCase(); const v = m.get(k) || { day: dayKey(r.start_ts), app: r.app, exe: r.exe, seconds: 0 }; v.seconds += Math.round(r.end_ts - r.start_ts); m.set(k, v); }
      return [...m.values()];
    }
    default: return null;
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  try {
    if (name === "export") {
      const type = req.nextUrl.searchParams.get("type") || "sessions";
      const rows = exportCsv(type);
      if (!rows) return json({ error: "unknown type" }, 400);
      return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="activity-${type}-${dayKey(nowTs())}.csv"` } });
    }
    const h = GET_HANDLERS[name];
    if (!h) return json({ error: "not found" }, 404);
    return json(await h(req.nextUrl.searchParams));
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

// ------------------------------------------------------------------ POST handlers
const TASK_NAME = "My Laptop Activity Monitor";
const STARTUP_LNK = path.join(process.env.APPDATA || "", "Microsoft\Windows\Start Menu\Programs\Startup\My Laptop Activity Monitor.lnk");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spawnCollectorDirect() {
  const child = spawn("pythonw", [path.join(COLLECTOR_DIR, "collector.py")], { cwd: COLLECTOR_DIR, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

/** Start: record intent; the supervisor (if running) starts it within ~10 s, otherwise start it directly. */
function startCollector() {
  setSetting("monitoring_enabled", true);
  setSetting("paused", false);
  setKv("restart_collector", true); // also clears a "gave up after repeated crashes" state in the supervisor
  if (collectorStatus().running) return { ok: true, already: true };
  if (!supervisorStatus().alive) { db().prepare("DELETE FROM kv WHERE key='restart_collector'").run(); spawnCollectorDirect(); }
  return { ok: true };
}

async function restartCollector() {
  setSetting("monitoring_enabled", true);
  setSetting("paused", false);
  if (supervisorStatus().alive) { setKv("restart_collector", true); setKv("stop_requested", true); return { ok: true }; }
  setKv("stop_requested", true);
  for (let i = 0; i < 20 && collectorStatus().running; i++) { await sleep(500); if (!kv("collector")) break; }
  spawnCollectorDirect();
  return { ok: true };
}

function autostartStatus(): Promise<any> {
  return new Promise((resolve) => {
    const ps = `$t=Get-ScheduledTask -TaskName '${TASK_NAME}' -EA SilentlyContinue; if($t){ @{task=$true;state=[string]$t.State;user=$t.Principal.UserId}|ConvertTo-Json -Compress } else { '{"task":false}' }`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
      let r: any = { task: false };
      try { r = JSON.parse(String(out).trim()); } catch { /* ignore */ }
      resolve({ ...r, startupShortcut: fs.existsSync(STARTUP_LNK), error: err ? String(err.message) : undefined });
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    switch (name) {
      case "collector": {
        const a = body.action;
        db().prepare("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)").run(nowTs(), "control", JSON.stringify({ action: a, source: "dashboard" }));
        if (a === "start") return json(startCollector());
        if (a === "restart") return json(await restartCollector());
        if (a === "stop") { setSetting("monitoring_enabled", false); setKv("stop_requested", true); return json({ ok: true }); }
        if (a === "pause") { setSetting("paused", true); return json({ ok: true }); }
        if (a === "resume") { setSetting("paused", false); return json({ ok: true }); }
        return json({ error: "bad action" }, 400);
      }
      case "settings": {
        const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "monitoring_enabled");
        for (const [k, v] of Object.entries(body || {})) {
          if (!allowed.includes(k)) continue;
          if (typeof DEFAULT_SETTINGS[k] === "number") {
            const n = Number(v); if (!Number.isFinite(n) || n < 0) continue;
            const lim: Record<string, [number, number]> = { idle_threshold_sec: [30, 7200], fg_interval_sec: [1, 30], res_interval_sec: [5, 600], battery_interval_sec: [15, 1800], retention_days: [1, 3650], daily_goal_min: [10, 1440] };
            setSetting(k, lim[k] ? Math.min(lim[k][1], Math.max(lim[k][0], n)) : n);
          } else if (typeof DEFAULT_SETTINGS[k] === "boolean") setSetting(k, !!v);
          else if (k === "app_limits" && typeof v === "object") setSetting(k, v);
        }
        return json({ ok: true, settings: getSettings() });
      }
      case "categories": {
        if (!body.exe) return json({ error: "exe required" }, 400);
        if (!body.category || body.category === "__default") db().prepare("DELETE FROM app_categories WHERE exe=?").run(body.exe);
        else if ((CATEGORIES as readonly string[]).includes(body.category)) db().prepare("INSERT INTO app_categories(exe,category) VALUES(?,?) ON CONFLICT(exe) DO UPDATE SET category=excluded.category").run(body.exe, body.category);
        return json({ ok: true });
      }
      case "webprofile": {
        const id = String(body.profile_id || "");
        if (!db().prepare("SELECT 1 FROM chrome_profiles WHERE profile_id=?").get(id)) return json({ error: "unknown profile" }, 404);
        if (body.delete === true) {
          if (body.confirm !== "DELETE") return json({ error: "confirmation required" }, 400);
          db().prepare("DELETE FROM web_sessions WHERE profile_id=?").run(id);
          db().prepare("DELETE FROM chrome_profiles WHERE profile_id=?").run(id);
          return json({ ok: true });
        }
        if (typeof body.label === "string") {
          const l = body.label.trim().slice(0, 40);
          db().prepare("UPDATE chrome_profiles SET label=?, label_ts=? WHERE profile_id=?").run(l || null, nowTs(), id);
          db().prepare("UPDATE web_sessions SET profile_label=? WHERE profile_id=?").run(l || null, id);
        }
        if (typeof body.enabled === "boolean") db().prepare("UPDATE chrome_profiles SET enabled=? WHERE profile_id=?").run(body.enabled ? 1 : 0, id);
        return json({ ok: true });
      }
      case "webdomain": {
        const domain = String(body.domain || "").toLowerCase();
        if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return json({ error: "bad domain" }, 400);
        const cur = db().prepare("SELECT category,productivity FROM web_domains WHERE domain=?").get(domain) || { category: null, productivity: null };
        const cat = "category" in body ? ((WEB_CATEGORIES as readonly string[]).includes(body.category) ? body.category : null) : cur.category;
        const prod = "productivity" in body ? ((PRODUCTIVITY as readonly string[]).includes(body.productivity) ? body.productivity : null) : cur.productivity;
        if (!cat && !prod) db().prepare("DELETE FROM web_domains WHERE domain=?").run(domain);
        else db().prepare("INSERT INTO web_domains(domain,category,productivity) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET category=excluded.category, productivity=excluded.productivity").run(domain, cat, prod);
        return json({ ok: true });
      }
      case "clear": {
        if (body.confirm !== "DELETE") return json({ error: "confirmation required" }, 400);
        const d = db();
        for (const t of ["app_sessions", "state_sessions", "system_samples", "process_samples", "battery_samples", "events", "web_sessions"]) d.exec(`DELETE FROM ${t}`);
        if (body.everything) { d.exec("DELETE FROM app_categories"); d.exec("DELETE FROM settings"); }
        d.exec("VACUUM");
        return json({ ok: true });
      }
      default: return json({ error: "not found" }, 404);
    }
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
