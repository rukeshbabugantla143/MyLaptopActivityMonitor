"use client";
import { useEffect, useState } from "react";
import { useApi, post, Card, PageHeader, Empty, Note, Btn, fmtDur, fmtBytes } from "@/components/ui";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!on)} className={`relative h-6 w-11 rounded-full transition cursor-pointer ${on ? "bg-accent" : "bg-panel2 border border-line"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "left-5" : "left-0.5"}`} /></button>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-6 py-3 border-b border-line/50 last:border-0"><div><div className="text-sm">{label}</div>{hint && <div className="text-xs text-mute mt-0.5">{hint}</div>}</div><div className="shrink-0">{children}</div></div>;
}
function Num({ value, onSave, suffix, min, max }: { value: number; onSave: (n: number) => void; suffix: string; min: number; max: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return <div className="flex items-center gap-2"><input type="number" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== value && onSave(Number(v))} className="w-24 rounded-lg bg-panel2 border border-line px-2 py-1.5 text-sm text-right" /><span className="text-xs text-mute w-10">{suffix}</span></div>;
}

export default function Settings() {
  const { data, reload } = useApi<any>("/api/settings", 5000);
  const { data: cats, reload: reloadCats } = useApi<any>("/api/categories");
  const { data: auto } = useApi<any>("/api/autostart");
  const [msg, setMsg] = useState("");
  const [limitExe, setLimitExe] = useState(""); const [limitMin, setLimitMin] = useState("60");
  const [confirm, setConfirm] = useState("");
  if (!data) return <Empty>Loading…</Empty>;
  const s = data.settings, st = data.status;
  const save = async (patch: Record<string, unknown>) => { await post("/api/settings", patch); setMsg("Saved"); setTimeout(() => setMsg(""), 1500); reload(); };
  const ctl = async (action: string) => { await post("/api/collector", { action }); setTimeout(reload, 1500); };
  return (
    <>
      <PageHeader title="Settings" subtitle={msg || "Changes apply to the collector within ~5 seconds"} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Collector">
          <Row label="Status" hint={st.running ? `PID ${st.pid} · running for ${fmtDur(Date.now() / 1000 - st.started, true)}` : "Not running"}>
            <span className={st.running ? (st.paused ? "text-warn" : "text-good") : "text-bad"}>{st.running ? (st.paused ? "Paused" : "Tracking") : "Stopped"}</span>
          </Row>
          <div className="flex flex-wrap gap-2 py-3">
            {!st.running && <Btn tone="primary" onClick={() => ctl("start")}>Start collector</Btn>}
            {st.running && (s.paused ? <Btn onClick={() => ctl("resume")}>Resume tracking</Btn> : <Btn onClick={() => ctl("pause")}>Pause tracking</Btn>)}
            {st.running && <Btn tone="danger" onClick={() => ctl("stop")}>Stop collector</Btn>}
            {st.running && <Btn onClick={() => ctl("restart")}>Restart collector</Btn>}
          </div>
          <Row label="Start automatically at login" hint={auto ? (auto.task ? `Task Scheduler task "My Laptop Activity Monitor" · ${auto.state}` : auto.startupShortcut ? "Startup-folder shortcut (fallback)" : "Not configured. Run install-autostart.bat to enable; remove-autostart.bat to disable.") : "Checking…"}>
            <span className={auto?.task || auto?.startupShortcut ? "text-good text-sm" : "text-mute text-sm"}>{auto?.task || auto?.startupShortcut ? "Enabled" : "Off"}</span>
          </Row>
          <Row label="Open dashboard in browser at login" hint="Opens one tab once per login, only when autostart is enabled"><Toggle on={!!s.open_browser_at_login} onChange={(v) => save({ open_browser_at_login: v })} /></Row>
          <Row label="Idle threshold" hint="No keyboard/mouse input for this long = idle"><Num value={Math.round(s.idle_threshold_sec / 60)} min={1} max={120} suffix="min" onSave={(n) => save({ idle_threshold_sec: n * 60 })} /></Row>
          <Row label="Foreground interval" hint="How often the active app is checked (2–5 s recommended)"><Num value={s.fg_interval_sec} min={1} max={30} suffix="sec" onSave={(n) => save({ fg_interval_sec: n })} /></Row>
          <Row label="Resource interval" hint="CPU / RAM / process snapshot"><Num value={s.res_interval_sec} min={5} max={600} suffix="sec" onSave={(n) => save({ res_interval_sec: n })} /></Row>
          <Row label="Battery interval"><Num value={s.battery_interval_sec} min={15} max={1800} suffix="sec" onSave={(n) => save({ battery_interval_sec: n })} /></Row>
          <Row label="Record window titles" hint="Off by default. Titles can contain document names, email subjects, etc."><Toggle on={!!s.track_window_titles} onChange={(v) => save({ track_window_titles: v })} /></Row>
          <Row label="Website tracking (Chrome extension)" hint="Records domains only, from profiles with the extension installed. Per-profile switches are on the Chrome Profiles page."><Toggle on={s.website_tracking_enabled !== false} onChange={(v) => save({ website_tracking_enabled: v })} /></Row>
        </Card>

        <Card title="Goals & notifications">
          <Row label="Daily screen-time goal"><Num value={s.daily_goal_min / 60} min={1} max={24} suffix="hours" onSave={(n) => save({ daily_goal_min: Math.round(n * 60) })} /></Row>
          <Row label="Enable notifications" hint="Master switch. Windows toast notifications, all off by default."><Toggle on={!!s.notifications_enabled} onChange={(v) => save({ notifications_enabled: v })} /></Row>
          <Row label="Notify when daily goal is reached"><Toggle on={!!s.notify_goal} onChange={(v) => save({ notify_goal: v })} /></Row>
          <Row label="Warn on high CPU / RAM" hint="Once per app per day"><Toggle on={!!s.notify_resources} onChange={(v) => save({ notify_resources: v })} /></Row>
          <Row label="CPU warning threshold" hint="Per process, % of whole machine, sustained ~1 min"><Num value={s.cpu_warn_pct} min={5} max={100} suffix="%" onSave={(n) => save({ cpu_warn_pct: n })} /></Row>
          <Row label="RAM warning threshold"><Num value={s.ram_warn_mb} min={100} max={32000} suffix="MB" onSave={(n) => save({ ram_warn_mb: n })} /></Row>
          <Row label="App usage alerts" hint="Notify when an app exceeds a daily limit"><Toggle on={!!s.notify_app_limits} onChange={(v) => save({ notify_app_limits: v })} /></Row>
          <div className="py-3 space-y-2">
            {Object.entries(s.app_limits || {}).map(([exe, m]) => (
              <div key={exe} className="flex justify-between text-sm rounded-lg bg-panel2/60 px-3 py-1.5"><span>{exe} — {String(m)} min/day</span><button className="text-bad text-xs cursor-pointer" onClick={() => { const n = { ...s.app_limits }; delete n[exe]; save({ app_limits: n }); }}>remove</button></div>
            ))}
            <div className="flex gap-2">
              <select value={limitExe} onChange={(e) => setLimitExe(e.target.value)} className="flex-1 rounded-lg bg-panel2 border border-line px-2 py-1.5 text-sm"><option value="">Choose app…</option>{cats?.apps.map((a: any) => <option key={a.exe} value={a.exe}>{a.app} ({a.exe})</option>)}</select>
              <input type="number" value={limitMin} onChange={(e) => setLimitMin(e.target.value)} className="w-20 rounded-lg bg-panel2 border border-line px-2 py-1.5 text-sm" />
              <Btn onClick={() => limitExe && save({ app_limits: { ...s.app_limits, [limitExe]: Number(limitMin) } })}>Add limit</Btn>
            </div>
          </div>
        </Card>

        <Card title="App categories" className="lg:col-span-2">
          {!cats ? <Empty>Loading…</Empty> : cats.apps.length === 0 ? <Empty>Apps appear here once they've been used.</Empty> : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-96 overflow-auto pr-1">
              {cats.apps.map((a: any) => (
                <div key={a.exe} className="flex items-center justify-between gap-2 rounded-xl bg-panel2/60 border border-line px-3 py-2">
                  <div className="min-w-0"><div className="text-sm truncate">{a.app}</div><div className="text-xs text-mute truncate">{a.exe}</div></div>
                  <select value={a.custom ? a.category : "__default"} onChange={async (e) => { await post("/api/categories", { exe: a.exe, category: e.target.value }); reloadCats(); }} className="rounded-lg bg-panel border border-line px-2 py-1 text-xs">
                    <option value="__default">Default ({a.custom ? "reset" : a.category})</option>
                    {cats.categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Data">
          <Row label="Data retention" hint="Older records are deleted automatically (resource samples kept max 14 days)"><Num value={s.retention_days} min={1} max={3650} suffix="days" onSave={(n) => save({ retention_days: n })} /></Row>
          <Row label="Database" hint={data.dbPath}><span className="text-sm text-mute">{fmtBytes(data.dbSize)}</span></Row>
          <div className="py-3">
            <div className="text-sm mb-2">Export to CSV</div>
            <div className="flex flex-wrap gap-2">
              {[["sessions", "App sessions"], ["websites", "Website sessions"], ["daily", "Daily per-app totals"], ["states", "Active/idle/locked"], ["battery", "Battery history"]].map(([t, l]) => <a key={t} href={`/api/export?type=${t}`}><Btn>{l}</Btn></a>)}
            </div>
          </div>
        </Card>

        <Card title="Delete tracking data">
          <Note>Permanently deletes all recorded usage, resource and battery history from the local database. Settings and categories are kept. This cannot be undone.</Note>
          <div className="flex gap-2 mt-3">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type DELETE to confirm' className="flex-1 rounded-lg bg-panel2 border border-line px-3 py-2 text-sm" />
            <Btn tone="danger" disabled={confirm !== "DELETE"} onClick={async () => { const r = await post("/api/clear", { confirm }); setConfirm(""); setMsg(r.ok ? "All tracking data deleted" : r.error); reload(); }}>Delete all data</Btn>
          </div>
        </Card>
      </div>
    </>
  );
}
