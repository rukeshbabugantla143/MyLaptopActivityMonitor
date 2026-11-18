"use client";
import { useState } from "react";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, Legend } from "recharts";
import { useApi, Card, Stat, PageHeader, Empty, Note, fmtDur, fmtHours, tooltipStyle } from "@/components/ui";

const axis = { stroke: "#4b5468", fontSize: 11, tickLine: false, axisLine: false };

export default function ScreenTime() {
  const [days, setDays] = useState(30);
  const { data: d, error } = useApi<any>(`/api/screentime?days=${days}`, 30000);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const daily = d.daily.map((x: any) => ({ ...x, label: x.day.slice(5), activeH: fmtHours(x.active), idleH: fmtHours(x.idle), lockedH: fmtHours(x.locked) }));
  const hourly = d.hourly.map((h: any) => ({ ...h, label: `${h.hour}:00`, todayM: Math.round(h.today / 60), avgM: Math.round(h.avg / 60) }));
  const change = d.totalPrev7 ? ((d.total7 - d.totalPrev7) / d.totalPrev7) * 100 : null;
  const today = d.daily[d.daily.length - 1];
  return (
    <>
      <PageHeader title="Screen Time" subtitle="Active foreground usage, separated from idle and locked time"
        right={<div className="flex gap-1 rounded-xl bg-panel2 p-1 border border-line">{[7, 30].map((n) => <button key={n} onClick={() => setDays(n)} className={`px-3 py-1 rounded-lg text-sm cursor-pointer ${days === n ? "bg-accent/20 text-ink" : "text-mute"}`}>{n} days</button>)}</div>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Today active" value={fmtDur(today?.active, true)} sub={`idle ${fmtDur(today?.idle, true)} · locked ${fmtDur(today?.locked, true)}`} />
        <Stat label="7-day total" value={fmtDur(d.total7, true)} sub={change == null ? "no prior week data" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs previous 7 days`} tone={change != null && change > 15 ? "warn" : undefined} />
        <Stat label="7-day daily avg" value={fmtDur(d.avg7, true)} sub="days with activity" />
        <Stat label="30-day daily avg" value={fmtDur(d.avg30, true)} sub="days with activity" />
      </div>

      <Card title={`Day-wise usage (hours) — last ${days} days`} className="mt-4">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={daily} barGap={0}>
              <CartesianGrid stroke="#1a2030" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={30} />
              <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [`${v} h`, n]} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#8a93a8" }} />
              <RBar dataKey="activeH" name="Active" stackId="a" fill="#7c9cff" radius={[0, 0, 0, 0]} />
              <RBar dataKey="idleH" name="Idle" stackId="a" fill="#334155" />
              <RBar dataKey="lockedH" name="Locked" stackId="a" fill="#1e293b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Hour-by-hour activity (minutes)" className="mt-4">
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={hourly}>
              <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c9cff" stopOpacity={0.5} /><stop offset="100%" stopColor="#7c9cff" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#1a2030" vertical={false} />
              <XAxis dataKey="label" {...axis} interval={2} />
              <YAxis {...axis} width={30} domain={[0, 60]} />
              <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [`${v} min`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="todayM" name="Today" stroke="#7c9cff" fill="url(#g1)" strokeWidth={2} />
              <Area type="monotone" dataKey="avgM" name={`Average (${days}d)`} stroke="#a78bfa" fill="none" strokeDasharray="4 4" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="What these metrics mean" className="mt-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Note><b className="text-ink">Active</b> — an app was in the foreground and keyboard/mouse input happened within the idle threshold. Measured every few seconds.</Note>
          <Note><b className="text-ink">Idle</b> — no keyboard/mouse input for longer than the threshold (Windows GetLastInputInfo). Idle time is back-dated to the moment of last input. Passive use such as watching a video without touching anything counts as idle.</Note>
          <Note><b className="text-ink">Locked</b> — the Windows lock screen / secure desktop was showing.</Note>
          <Note><b className="text-ink">Screen off / sleep</b> — not reliably detectable without a system hook, so it is not shown as its own metric. When the laptop sleeps the collector pauses; that gap is excluded from every total.</Note>
          <Note><b className="text-ink">Logged-in session time</b> — approximated as active + idle + locked time while the collector ran. Time before the collector started is unknown.</Note>
        </div>
      </Card>
    </>
  );
}
