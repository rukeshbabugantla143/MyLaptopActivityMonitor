"use client";
import { useState } from "react";
import { useApi, Card, PageHeader, Empty, Note, fmtDur, fmtTime, colorFor, CAT_COLORS } from "@/components/ui";

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Timeline() {
  const [date, setDate] = useState(todayStr());
  const [minLen, setMinLen] = useState(60);
  const { data: d, error } = useApi<any>(`/api/timeline?date=${date}`, 30000);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const start = d.start, span = 86400;
  const pos = (t: number) => `${((t - start) / span) * 100}%`;
  const w = (s: number, e: number) => `${Math.max(0.08, ((e - s) / span) * 100)}%`;
  const items = d.items.filter((i: any) => i.e - i.s >= minLen);
  // Group consecutive short blocks into readable list
  return (
    <>
      <PageHeader title="Timeline" subtitle="When you used each application — real collected data only"
        right={<div className="flex gap-2 items-center">
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="rounded-xl bg-panel2 border border-line px-3 py-2 text-sm" />
          <select value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} className="rounded-xl bg-panel2 border border-line px-3 py-2 text-sm">
            <option value={0}>All blocks</option><option value={60}>≥ 1 min</option><option value={300}>≥ 5 min</option><option value={900}>≥ 15 min</option>
          </select>
        </div>} />

      <Card title="24-hour view">
        {d.items.length === 0 && d.states.length === 0 ? <Empty>No activity recorded on {d.date}.</Empty> : (
          <>
            <div className="relative h-10 rounded-lg bg-panel2 overflow-hidden">
              {d.states.map((s: any, i: number) => <div key={"s" + i} title={`${s.state} ${fmtTime(s.s)}–${fmtTime(s.e)}`} className="absolute top-0 h-full" style={{ left: pos(s.s), width: w(s.s, s.e), background: s.state === "locked" ? "#1e293b" : "#334155" }} />)}
              {d.items.map((it: any, i: number) => <div key={i} title={`${it.app} ${fmtTime(it.s)}–${fmtTime(it.e)} (${fmtDur(it.e - it.s)})`} className="absolute top-1 bottom-1" style={{ left: pos(it.s), width: w(it.s, it.e), background: CAT_COLORS[it.category] || colorFor(it.exe) }} />)}
            </div>
            <div className="flex justify-between text-[10px] text-mute mt-1 tabular-nums">{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}</div>
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-mute">
              {Object.entries(CAT_COLORS).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />{k}</span>)}
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#334155]" />Idle</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#1e293b]" />Locked</span>
            </div>
          </>
        )}
      </Card>

      <Card title={`Sessions (${items.length})`} className="mt-4">
        {items.length === 0 ? <Empty>No sessions at this filter level.</Empty> : (
          <div className="divide-y divide-line/60">
            {items.map((it: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2 text-sm">
                <span className="tabular-nums text-mute w-32 shrink-0">{fmtTime(it.s)} – {fmtTime(it.e)}</span>
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CAT_COLORS[it.category] || colorFor(it.exe) }} />
                <span className="flex-1 truncate">{it.app}{it.title ? <span className="text-mute text-xs"> · {it.title}</span> : null}</span>
                <span className="tabular-nums text-mute">{fmtDur(it.e - it.s, true)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3"><Note>Consecutive sessions of the same app less than 5 s apart are merged. Gaps with no entries are times the laptop was asleep/off, the collector was stopped or paused, or you were idle/locked.</Note></div>
      </Card>
    </>
  );
}
