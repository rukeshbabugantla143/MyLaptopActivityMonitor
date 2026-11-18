"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { useApi, post, Card, Stat, PageHeader, Empty, Note, Bar, fmtDur, fmtTime, fmtHours, tooltipStyle } from "@/components/ui";
import { WEB_CATEGORIES, PRODUCTIVITY, WEB_CAT_COLORS, PROD_COLORS } from "@/lib/websites";

const axis = { stroke: "#4b5468", fontSize: 11, tickLine: false, axisLine: false };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Websites() {
  const [date, setDate] = useState(todayStr());
  const [profile, setProfile] = useState("all");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [minLen, setMinLen] = useState(30);
  const { data: d, error, reload } = useApi<any>(`/api/websites?date=${date}&profile=${encodeURIComponent(profile)}`, 30000);
  const rows = useMemo(() => (d?.domains || []).filter((x: any) => (cat === "All" || x.category === cat) && x.domain.includes(q.toLowerCase())), [d, q, cat]);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const setClass = async (domain: string, patch: Record<string, string | null>) => { await post("/api/webdomain", { domain, ...patch }); reload(); };
  const prodTotal = d.productivity.Productive + d.productivity.Neutral + d.productivity.Distracting;
  const top = d.domains.slice(0, 10).map((x: any) => ({ name: x.domain, min: Math.round(x.secs / 6) / 10 }));
  const change = d.prev7 ? ((d.last7 - d.prev7) / d.prev7) * 100 : null;
  const noProfiles = d.profiles.length === 0;
  const sel = "rounded-xl bg-panel2 border border-line px-3 py-2 text-sm";
  return (
    <>
      <PageHeader title="Websites" subtitle="Chrome time per domain while Chrome is in front and you're active. Domains only, never full URLs."
        right={<div className="flex flex-wrap gap-2">
          <select value={profile} onChange={(e) => setProfile(e.target.value)} className={sel}>
            <option value="all">All Profiles</option>
            {d.profiles.map((p: any) => <option key={p.id} value={p.id}>{p.label}{p.label === "Unconfigured" ? ` (${p.id.slice(0, 8)})` : ""}</option>)}
            {d.profiles.some((p: any) => p.label === "Unconfigured") && <option value="unconfigured">All unconfigured</option>}
          </select>
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className={sel} />
        </div>} />

      {!d.enabled && <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 text-warn text-sm px-4 py-3">Website tracking is turned off in Settings. Existing data is still shown.</div>}
      {noProfiles && (
        <Card title="Set up website tracking" className="mb-4">
          <p className="text-sm">No Chrome extension has connected yet. Install the extension once in each Chrome profile you want to track:</p>
          <ol className="text-sm list-decimal pl-5 mt-2 space-y-1 text-mute">
            <li>In Chrome, open <code className="text-ink">chrome://extensions</code> and turn on <b className="text-ink">Developer mode</b> (top right).</li>
            <li>Click <b className="text-ink">Load unpacked</b> and select the <code className="text-ink">chrome-extension</code> folder inside My_Laptop_Activity_Monitor.</li>
            <li>The extension's page opens: choose a profile name (Personal, College, Work…) and click Save.</li>
            <li>Browse for a minute, and this page fills in. Repeat in each Chrome profile.</li>
          </ol>
          <div className="mt-3"><Link href="/profiles" className="text-accent text-sm">Go to Profiles →</Link></div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Website time" value={fmtDur(d.total, true)} sub={`Chrome in front: ${fmtDur(d.chromeForeground, true)} (all profiles)`} />
        <Stat label="Unique websites" value={d.unique} sub={`${d.visits} visits`} />
        <Stat label="Avg time per visit" value={fmtDur(d.avgVisit, true)} sub="visits = continuous use, < 30 s gaps merged" />
        <Stat label="Most visited" value={d.domains[0]?.domain ?? "—"} sub={d.domains[0] ? `${fmtDur(d.domains[0].secs, true)} · ${d.domains[0].visits} visits` : "no data"} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Top websites (minutes)" className="lg:col-span-2">
          {top.length === 0 ? <Empty>No website activity on {d.date}{profile !== "all" ? " for this profile" : ""}.</Empty> : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={top} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid stroke="#1a2030" horizontal={false} />
                  <XAxis type="number" {...axis} />
                  <YAxis type="category" dataKey="name" {...axis} width={130} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} min`, "Time"]} />
                  <RBar dataKey="min" fill="#7c9cff" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Productivity (your classification)">
          {prodTotal === 0 ? <Empty>No data.</Empty> : (
            <div className="space-y-3">
              {PRODUCTIVITY.map((p) => (
                <div key={p}>
                  <div className="flex justify-between text-sm mb-1"><span style={{ color: PROD_COLORS[p] }}>{p}</span><span className="text-mute tabular-nums">{fmtDur(d.productivity[p], true)} · {Math.round((d.productivity[p] / prodTotal) * 100)}%</span></div>
                  <Bar value={d.productivity[p]} max={prodTotal} color={PROD_COLORS[p]} />
                </div>
              ))}
              <Note>Score = productive ÷ (productive + distracting) = <b className="text-ink">{d.productivity.Productive + d.productivity.Distracting ? Math.round((d.productivity.Productive / (d.productivity.Productive + d.productivity.Distracting)) * 100) : 0}%</b>. Neutral time is left out. Each domain's class starts from a suggestion based on its category; change any of them in the table below.</Note>
            </div>
          )}
          <div className="mt-5 space-y-1.5">
            <div className="text-xs text-mute uppercase tracking-wider mb-1">Categories</div>
            {d.categories.map((c: any) => <div key={c.name} className="flex justify-between text-sm"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: WEB_CAT_COLORS[c.name] }} />{c.name}</span><span className="text-mute tabular-nums">{fmtDur(c.secs, true)}</span></div>)}
          </div>
        </Card>
      </div>

      <Card title={`Daily trend: 14 days to ${d.date}`} className="mt-4" right={<span className="text-xs text-mute">last 7 days {fmtDur(d.last7, true)}{change != null ? ` · ${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs previous 7` : ""}</span>}>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={d.trend.map((t: any) => ({ label: t.day.slice(5), Productive: fmtHours(t.Productive), Neutral: fmtHours(t.Neutral), Distracting: fmtHours(t.Distracting) }))}>
              <CartesianGrid stroke="#1a2030" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={30} />
              <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [`${v} h`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {PRODUCTIVITY.map((p, i) => <RBar key={p} dataKey={p} stackId="a" fill={PROD_COLORS[p]} radius={i === 2 ? [4, 4, 0, 0] : 0} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="All websites" className="mt-4">
        <div className="flex flex-wrap gap-3 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains…" className="flex-1 min-w-48 rounded-xl bg-panel2 border border-line px-3 py-2 text-sm outline-none" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={sel}><option>All</option>{WEB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        {rows.length === 0 ? <Empty>No websites match.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-mute text-xs uppercase tracking-wider border-b border-line"><tr>
                <th className="text-left py-2 px-2 w-8">#</th><th className="text-left px-2">Domain</th><th className="text-right px-2">Time</th><th className="text-right px-2">Visits</th><th className="text-right px-2">Avg / visit</th><th className="text-left px-2">Category</th><th className="text-left px-2">Class</th>
              </tr></thead>
              <tbody>{rows.map((x: any, i: number) => (
                <tr key={x.domain} className="border-b border-line/50 hover:bg-panel2/60">
                  <td className="py-2 px-2 text-mute">{i + 1}</td>
                  <td className="px-2 font-medium">{x.domain}</td>
                  <td className="px-2 text-right tabular-nums">{fmtDur(x.secs, true)}</td>
                  <td className="px-2 text-right tabular-nums">{x.visits}</td>
                  <td className="px-2 text-right tabular-nums text-mute">{fmtDur(x.avg, true)}</td>
                  <td className="px-2">
                    <select value={x.customCategory ? x.category : ""} onChange={(e) => setClass(x.domain, { category: e.target.value || null })} className="rounded-lg bg-panel border border-line px-2 py-1 text-xs" style={{ color: WEB_CAT_COLORS[x.category] }}>
                      <option value="">{x.customCategory ? "Reset to suggestion" : `${x.category} (suggested)`}</option>
                      {WEB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2">
                    <select value={x.customProductivity ? x.productivity : ""} onChange={(e) => setClass(x.domain, { productivity: e.target.value || null })} className="rounded-lg bg-panel border border-line px-2 py-1 text-xs" style={{ color: PROD_COLORS[x.productivity] }}>
                      <option value="">{x.customProductivity ? "Reset to suggestion" : `${x.productivity} (suggested)`}</option>
                      {PRODUCTIVITY.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Website timeline" className="mt-4" right={<select value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} className="rounded-lg bg-panel2 border border-line px-2 py-1 text-xs"><option value={0}>All visits</option><option value={30}>≥ 30 s</option><option value={120}>≥ 2 min</option><option value={600}>≥ 10 min</option></select>}>
        {d.timeline.length === 0 ? <Empty>No visits.</Empty> : (
          <>
            <div className="relative h-8 rounded-lg bg-panel2 overflow-hidden mb-1">
              {d.timeline.map((t: any, i: number) => <div key={i} title={`${t.domain} ${fmtTime(t.s)}–${fmtTime(t.e)} · ${t.label}`} className="absolute top-1 bottom-1" style={{ left: `${((t.s - d.start) / 86400) * 100}%`, width: `${Math.max(0.1, ((t.e - t.s) / 86400) * 100)}%`, background: WEB_CAT_COLORS[t.category] }} />)}
            </div>
            <div className="flex justify-between text-[10px] text-mute mb-3 tabular-nums">{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}</div>
            <div className="divide-y divide-line/60 max-h-[28rem] overflow-auto">
              {d.timeline.filter((t: any) => t.e - t.s >= minLen).map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-4 py-2 text-sm">
                  <span className="tabular-nums text-mute w-32 shrink-0">{fmtTime(t.s)} – {fmtTime(t.e)}</span>
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: WEB_CAT_COLORS[t.category] }} />
                  <span className="flex-1 truncate">{t.domain}</span>
                  {profile === "all" && <span className={`text-xs px-2 py-0.5 rounded-full ${t.label === "Unconfigured" ? "bg-warn/10 text-warn" : "bg-panel2 text-mute"}`}>{t.label}</span>}
                  <span className="tabular-nums text-mute w-16 text-right">{fmtDur(t.e - t.s, true)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      <div className="mt-4"><Note>Website time can be a little lower than “Chrome in front”: time on chrome:// pages, the new-tab page, extension pages, profiles without the extension, and idle periods isn't counted as a website. Profiles are separate Chrome extension installs and are never merged, except in “All Profiles”.</Note></div>
    </>
  );
}
