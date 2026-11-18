"use client";
import { useMemo, useState } from "react";
import { useApi, Card, PageHeader, Empty, Note, fmtDur, fmtBytes, CAT_COLORS } from "@/components/ui";
import { CATEGORIES } from "@/lib/categories";

type SortKey = "today" | "week" | "cpu" | "rss" | "app";

export default function Apps() {
  const { data, error } = useApi<any[]>("/api/apps", 30000);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<SortKey>("today");
  const rows = useMemo(() => {
    let r = (data || []).filter((a) => (cat === "All" || a.category === cat) && (`${a.app} ${a.exe}`.toLowerCase().includes(q.toLowerCase())));
    r = [...r].sort((a, b) => sort === "app" ? a.app.localeCompare(b.app) : (b[sort] ?? -1) - (a[sort] ?? -1));
    return r;
  }, [data, q, cat, sort]);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;
  const th = (k: SortKey, label: string, right = true) => (
    <th onClick={() => setSort(k)} className={`py-2 px-3 font-medium cursor-pointer select-none ${right ? "text-right" : "text-left"} ${sort === k ? "text-ink" : ""}`}>{label}{sort === k ? " ↓" : ""}</th>
  );
  return (
    <>
      <PageHeader title="Applications" subtitle="Ranked by foreground usage. CPU / RAM are today's averages from resource sampling." />
      <Card>
        <div className="flex flex-wrap gap-3 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps…" className="flex-1 min-w-48 rounded-xl bg-panel2 border border-line px-3 py-2 text-sm outline-none focus:border-accent/60" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-xl bg-panel2 border border-line px-3 py-2 text-sm">
            <option>All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {rows.length === 0 ? <Empty>No applications match.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-mute text-xs uppercase tracking-wider border-b border-line">
                <tr><th className="py-2 px-3 text-left w-10">#</th>{th("app", "Application", false)}<th className="py-2 px-3 text-left font-medium">Category</th>{th("today", "Today")}{th("week", "7 Days")}{th("cpu", "CPU")}{th("rss", "RAM")}</tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={a.exe} className="border-b border-line/50 hover:bg-panel2/60">
                    <td className="py-2.5 px-3 text-mute tabular-nums">{i + 1}</td>
                    <td className="py-2.5 px-3"><div className="font-medium">{a.app}</div><div className="text-xs text-mute">{a.exe}{a.todaySessions ? ` · ${a.todaySessions} sessions today` : ""}</div></td>
                    <td className="py-2.5 px-3"><span className="text-xs px-2 py-0.5 rounded-full" style={{ background: (CAT_COLORS[a.category] || "#94a3b8") + "22", color: CAT_COLORS[a.category] }}>{a.category}</span></td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.today ? fmtDur(a.today, true) : "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtDur(a.week, true)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.cpu != null ? `${a.cpu.toFixed(1)}%` : "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtBytes(a.rss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4"><Note>Browser time is tracked as the browser itself; individual websites are not tracked. CPU is a percentage of the whole machine (all cores), summed across all processes with the same executable name. Change categories in Settings.</Note></div>
      </Card>
    </>
  );
}
