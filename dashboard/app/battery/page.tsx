"use client";
import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar as RBar } from "recharts";
import { useApi, Card, Stat, PageHeader, Empty, Note, fmtDur, tooltipStyle } from "@/components/ui";

const axis = { stroke: "#4b5468", fontSize: 11, tickLine: false, axisLine: false };

export default function Battery() {
  const [days, setDays] = useState(1);
  const { data: d, error } = useApi<any>(`/api/battery?days=${days}`, 30000);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  if (d.available === false) return <><PageHeader title="Battery" /><Empty>No battery detected on this device.</Empty></>;
  const l = d.latest, det = d.detail, h = d.health;
  const series = d.samples.map((s: any) => ({ t: s.ts * 1000, pct: s.percent, plugged: s.plugged ? s.percent : null }));
  const rate = det ? (det.discharge_rate > 0 ? -det.discharge_rate : det.charge_rate) : null;
  return (
    <>
      <PageHeader title="Battery" subtitle="Measured values come from Windows; estimates are labelled"
        right={<div className="flex gap-1 rounded-xl bg-panel2 p-1 border border-line">{[1, 2, 7, 14].map((n) => <button key={n} onClick={() => setDays(n)} className={`px-3 py-1 rounded-lg text-sm cursor-pointer ${days === n ? "bg-accent/20" : "text-mute"}`}>{n === 1 ? "24 h" : `${n} d`}</button>)}</div>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Battery" value={l ? `${Math.round(l.percent)}%` : "—"} sub={l ? (l.plugged ? "Plugged in" : "On battery") : "Waiting for first sample"} />
        <Stat label="Power flow (measured)" value={rate != null ? `${rate > 0 ? "+" : ""}${(rate / 1000).toFixed(1)} W` : "—"} sub={rate == null ? "Not reported" : rate < 0 ? "Discharging" : rate > 0 ? "Charging" : "Idle / full"} />
        <Stat label="Avg drain (estimate)" value={d.drainPerHour != null ? `${d.drainPerHour.toFixed(1)} %/h` : "—"} sub={d.drainPerHour != null ? `≈ ${fmtDur((100 / d.drainPerHour) * 3600, true)} full → empty` : "Needs ≥10 min unplugged"} />
        <Stat label="Health (measured)" value={h?.HealthPct ? `${h.HealthPct}%` : "—"} sub={h?.FullChargeCapacity ? `${Number(h.FullChargeCapacity).toLocaleString()} / ${Number(h.DesignCapacity).toLocaleString()} mWh` : "From powercfg report (daily)"} tone={h?.HealthPct < 70 ? "warn" : undefined} />
      </div>

      <Card title="Battery percentage history" className="mt-4">
        {series.length < 2 ? <Empty>Not enough samples yet. One sample is recorded every minute.</Empty> : (
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={series}>
                <defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.35} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#1a2030" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} {...axis} tickFormatter={(t) => new Date(t).toLocaleString([], days > 1 ? { month: "short", day: "numeric", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" })} />
                <YAxis {...axis} domain={[0, 100]} width={30} />
                <Tooltip {...tooltipStyle} labelFormatter={(t) => new Date(t as number).toLocaleString()} formatter={(v: number, n: string) => [`${v}%`, n === "pct" ? "Battery" : "Charging"]} />
                <Area type="stepAfter" dataKey="pct" stroke="#34d399" fill="url(#bg1)" strokeWidth={2} isAnimationActive={false} />
                <Area type="stepAfter" dataKey="plugged" stroke="#fbbf24" fill="#fbbf2415" strokeWidth={0} isAnimationActive={false} connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 text-xs text-mute"><span className="text-good">●</span> battery level &nbsp; <span className="text-warn">●</span> shaded while plugged in</div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="Charging & discharging periods">
          {d.periods.length === 0 ? <Empty>No periods yet.</Empty> : (
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {d.periods.map((p: any, i: number) => (
                <div key={i} className="flex justify-between text-sm rounded-lg bg-panel2/60 px-3 py-2">
                  <span><span className={p.plugged ? "text-warn" : "text-good"}>{p.plugged ? "Charging / plugged" : "Discharging"}</span> <span className="text-mute text-xs">{new Date(p.s * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {fmtDur(p.e - p.s, true)}</span></span>
                  <span className="tabular-nums text-mute">{Math.round(p.p0)}% → {Math.round(p.p1)}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Daily battery usage (% drained while unplugged)">
          {d.daily.length === 0 ? <Empty>No unplugged usage recorded in the last 14 days.</Empty> : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={d.daily.map((x: any) => ({ ...x, label: x.day.slice(5), used: Math.round(x.used) }))}>
                  <CartesianGrid stroke="#1a2030" vertical={false} />
                  <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={30} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Drained"]} />
                  <RBar dataKey="used" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card title="About these numbers" className="mt-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Note><b className="text-ink">Measured:</b> percentage and plugged state (every minute), charge/discharge power in mW and remaining capacity (Windows WMI, every 5 min), design vs full-charge capacity and cycle count (from <code>powercfg /batteryreport</code>, once a day, read-only).</Note>
          <Note><b className="text-ink">Estimated:</b> average drain %/h (computed from your discharge periods) and Windows' time-remaining estimate. Per-application energy use is <b>not</b> shown: Windows does not expose reliable per-app energy data to regular programs.</Note>
          {h?.CycleCount && <Note>Cycle count: {h.CycleCount} · Chemistry: {h.Chemistry || "—"} · Manufacturer: {h.Manufacturer || "—"}</Note>}
        </div>
      </Card>
    </>
  );
}
