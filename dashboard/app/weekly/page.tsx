"use client";
import { useState } from "react";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { useApi, Card, Stat, PageHeader, Empty, Bar, fmtDur, fmtHours, tooltipStyle, CAT_COLORS, Btn } from "@/components/ui";

const axis = { stroke: "#4b5468", fontSize: 11, tickLine: false, axisLine: false };

export default function Weekly() {
  const [offset, setOffset] = useState(0);
  const { data: d, error } = useApi<any>(`/api/weekly?offset=${offset}`, 60000);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const range = `${new Date(d.start * 1000).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date((d.end - 1) * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const change = d.prevTotal ? ((d.total - d.prevTotal) / d.prevTotal) * 100 : null;
  const entAccurate = d.categories.some((c: any) => c.name === "Entertainment");
  return (
    <>
      <PageHeader title="Weekly Report" subtitle={range}
        right={<div className="flex gap-2"><Btn onClick={() => setOffset(offset + 1)}>← Previous</Btn><Btn disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 1))}>Next →</Btn><Btn onClick={() => window.print()}>Print</Btn></div>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total screen time" value={fmtDur(d.total, true)} sub={change == null ? "no data for previous week" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs previous week (${fmtDur(d.prevTotal, true)})`} />
        <Stat label="Daily average" value={fmtDur(d.dailyAvg, true)} sub={`over ${d.daysWithData} tracked day(s)`} tone={d.dailyAvg > d.goal ? "warn" : undefined} />
        <Stat label="Highest usage day" value={d.highest ? new Date(d.highest.day + "T00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—"} sub={d.highest ? fmtDur(d.highest.secs) : undefined} />
        <Stat label="Productive apps" value={fmtDur(d.productive, true)} sub={`Development + Education · ${d.total ? Math.round((d.productive / d.total) * 100) : 0}%`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Daily screen time (hours)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d.days.map((x: any) => ({ ...x, label: new Date(x.day + "T00:00").toLocaleDateString([], { weekday: "short" }), h: fmtHours(x.secs) }))}>
                <CartesianGrid stroke="#1a2030" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={30} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} h`, "Active"]} />
                <ReferenceLine y={fmtHours(d.goal)} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "goal", fill: "#fbbf24", fontSize: 11, position: "right" }} />
                <RBar dataKey="h" fill="#7c9cff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="By category">
          {d.categories.length === 0 ? <Empty>No data.</Empty> : (
            <div className="space-y-3">
              {d.categories.map((c: any) => (
                <div key={c.name}>
                  <div className="flex justify-between text-sm mb-1"><span>{c.name}</span><span className="text-mute tabular-nums">{fmtDur(c.secs, true)}</span></div>
                  <Bar value={c.secs} max={d.categories[0].secs} color={CAT_COLORS[c.name]} />
                </div>
              ))}
              <p className="text-xs text-mute pt-2">Entertainment counts only apps categorised as such (e.g. Spotify, VLC, Steam){entAccurate ? "" : " — none used this week"}. Browser time is never counted as entertainment because websites are not tracked.</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="Most-used applications">
          {d.apps.length === 0 ? <Empty>No data.</Empty> : (
            <table className="w-full text-sm">
              <thead className="text-mute text-xs uppercase border-b border-line"><tr><th className="text-left py-2">App</th><th className="text-right">This week</th><th className="text-right">Prev week</th><th className="text-right">Change</th></tr></thead>
              <tbody>{d.apps.map((a: any) => {
                const ch = a.prev ? ((a.secs - a.prev) / a.prev) * 100 : null;
                return <tr key={a.exe} className="border-b border-line/50"><td className="py-2"><span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: CAT_COLORS[a.category] }} />{a.app}</td><td className="text-right tabular-nums">{fmtDur(a.secs, true)}</td><td className="text-right tabular-nums text-mute">{a.prev ? fmtDur(a.prev, true) : "—"}</td><td className={`text-right tabular-nums ${ch == null ? "text-mute" : ch > 0 ? "text-warn" : "text-good"}`}>{ch == null ? "new" : `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`}</td></tr>;
              })}</tbody>
            </table>
          )}
        </Card>
        <Card title="Observations & recommendations">
          <ul className="space-y-2.5 text-sm">{d.recommendations.map((r: string, i: number) => <li key={i} className="flex gap-2"><span className="text-accent">•</span><span>{r}</span></li>)}</ul>
          <div className="grid grid-cols-3 gap-3 mt-5 text-center">
            <div className="rounded-xl bg-panel2/60 p-3"><div className="text-xs text-mute">Idle</div><div className="font-semibold">{fmtDur(d.idle, true)}</div></div>
            <div className="rounded-xl bg-panel2/60 p-3"><div className="text-xs text-mute">Late-night</div><div className="font-semibold">{fmtDur(d.late, true)}</div></div>
            <div className="rounded-xl bg-panel2/60 p-3"><div className="text-xs text-mute">App switches</div><div className="font-semibold">{d.switches}</div></div>
          </div>
        </Card>
      </div>
    </>
  );
}
