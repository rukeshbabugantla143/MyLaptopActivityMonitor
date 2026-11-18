"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useApi, Card, Stat, PageHeader, Bar, Empty, Note, fmtDur, fmtBytes, fmtTime, CAT_COLORS, colorFor, tooltipStyle } from "@/components/ui";

export default function Overview() {
  const { data: d, error } = useApi<any>("/api/overview", 5000);
  if (error) return <Empty>Could not load data: {error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const goal = d.goalMin * 60, pct = goal ? (d.activeSecs / goal) * 100 : 0;
  const b = d.battery;
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return (
    <>
      <PageHeader title="Today" subtitle={today} right={!d.status.running ? <span className="text-sm text-bad">Collector is not running. Start it from the sidebar.</span> : d.status.paused ? <span className="text-sm text-warn">Tracking paused</span> : null} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active screen time" value={fmtDur(d.activeSecs, true)} sub={`${Math.round(pct)}% of ${fmtDur(goal, true)} goal`} tone={pct > 100 ? "warn" : undefined} />
        <Stat label="Idle time" value={fmtDur(d.idleSecs, true)} sub={`No input for ≥ ${Math.round(d.idleThreshold / 60)} min · locked ${fmtDur(d.lockedSecs, true)}`} />
        <Stat label="Apps used" value={d.appsUsed} sub={`${d.switches} app switches`} />
        <Stat label="Top application" value={d.topApps[0]?.app ?? "—"} sub={d.topApps[0] ? fmtDur(d.topApps[0].secs) : "No data yet"} />
        <Stat label="Current app" value={d.current?.app ?? "—"} sub={d.current ? `since ${fmtTime(d.current.since)}` : d.status.running ? "Idle / locked" : "Not tracking"} />
        <Stat label="CPU" value={d.cpu != null ? `${d.cpu.toFixed(0)}%` : "—"} tone={d.cpu > 85 ? "bad" : d.cpu > 60 ? "warn" : undefined} sub="whole system" />
        <Stat label="RAM" value={d.ram != null ? `${d.ram.toFixed(0)}%` : "—"} sub={d.ramUsed ? `${fmtBytes(d.ramUsed)} of ${fmtBytes(d.ramTotal)}` : undefined} tone={d.ram > 90 ? "bad" : d.ram > 80 ? "warn" : undefined} />
        <Stat label="Battery" value={b ? `${Math.round(b.percent)}%` : "—"} sub={b ? (b.plugged ? "Plugged in" : b.secs_left ? `On battery · ~${fmtDur(b.secs_left, true)} left (Windows estimate)` : "On battery") : "No battery data"} tone={b && !b.plugged && b.percent < 20 ? "bad" : undefined} />
      </div>

      <div className="mt-4">
        <Card title="Daily goal progress">
          <Bar value={d.activeSecs} max={goal} color={pct > 100 ? "#fbbf24" : "#7c9cff"} />
          <div className="mt-2 text-xs text-mute">{fmtDur(d.activeSecs)} active of {fmtDur(goal)} goal{pct > 100 ? ` — ${fmtDur(d.activeSecs - goal)} over` : ""}</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Top applications today" className="lg:col-span-2">
          {d.topApps.length === 0 ? <Empty>No application usage recorded yet today.</Empty> : (
            <div className="space-y-3">
              {d.topApps.map((a: any) => (
                <div key={a.exe}>
                  <div className="flex justify-between text-sm mb-1"><span className="truncate">{a.app} <span className="text-mute text-xs">{a.exe}</span></span><span className="tabular-nums text-mute">{fmtDur(a.secs)}</span></div>
                  <Bar value={a.secs} max={d.topApps[0].secs} color={colorFor(a.exe)} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="By category">
          {d.categories.length === 0 ? <Empty>No data yet.</Empty> : (
            <>
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={d.categories} dataKey="secs" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                      {d.categories.map((c: any) => <Cell key={c.name} fill={CAT_COLORS[c.name] || "#94a3b8"} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmtDur(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {d.categories.map((c: any) => (
                  <div key={c.name} className="flex justify-between text-sm"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: CAT_COLORS[c.name] }} />{c.name}</span><span className="text-mute tabular-nums">{fmtDur(c.secs, true)}</span></div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Note>Active time counts only when an app is in the foreground and you've used the keyboard/mouse within the idle threshold. Watching a video without touching input for longer than the threshold is counted as idle. Battery time remaining is Windows' own estimate.</Note>
      </div>
    </>
  );
}
