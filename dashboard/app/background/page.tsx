"use client";
import { useMemo, useState } from "react";
import { useApi, Card, Stat, PageHeader, Empty, Note, fmtDur, fmtBytes } from "@/components/ui";

function reasons(p: any, d: any): { tone: "bad" | "warn" | "info"; text: string }[] {
  const r: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  const mb = p.rss / 1048576;
  if (p.cpu >= d.cpuWarn) r.push({ tone: "bad", text: `Using ${p.cpu.toFixed(0)}% of total CPU right now (warning threshold ${d.cpuWarn}%).` });
  else if (p.avg10 != null && p.avg10 >= d.cpuWarn / 2) r.push({ tone: "warn", text: `Averaged ${p.avg10.toFixed(0)}% CPU over the last 10 minutes (all instances combined).` });
  if (mb >= d.ramWarnMb) r.push({ tone: "bad", text: `Using ${mb.toFixed(0)} MB RAM (warning threshold ${d.ramWarnMb} MB).` });
  if (p.lingering) r.push({ tone: "warn", text: "Had a visible window earlier, but its windows are now closed and the process is still running. It may be minimised to the tray, or may not have exited." });
  if (!p.window && p.user && p.startup && (mb > 150 || (p.avg10 ?? 0) > 1)) r.push({ tone: "info", text: "Starts automatically at login and runs with no visible window. If you don't use this app's tray features, you might disable it in Task Manager › Startup apps." });
  return r;
}

export default function Background() {
  const { data: d, error } = useApi<any>("/api/background", 10000);
  const [view, setView] = useState<"all" | "bg" | "flag">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"cpu" | "rss" | "name">("cpu");
  const list = useMemo(() => {
    if (!d) return [];
    let l = d.list.map((p: any) => ({ ...p, why: reasons(p, d) }));
    if (view === "bg") l = l.filter((p: any) => !p.window);
    if (view === "flag") l = l.filter((p: any) => p.why.length);
    if (q) l = l.filter((p: any) => p.name.toLowerCase().includes(q.toLowerCase()));
    return l.sort((a: any, b: any) => sort === "name" ? a.name.localeCompare(b.name) : b[sort] - a[sort]).slice(0, 300);
  }, [d, view, q, sort]);
  if (error) return <Empty>{error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  if (!d.ts) return <><PageHeader title="Background Activity" /><Empty>No process snapshot yet. Start the collector; the first sample arrives within ~15 seconds.</Empty></>;
  const flagged = d.list.filter((p: any) => reasons(p, d).some((x) => x.tone !== "info")).length;
  const bg = d.list.filter((p: any) => !p.window).length;
  return (
    <>
      <PageHeader title="Background Activity" subtitle={`Snapshot ${fmtDur(Date.now() / 1000 - d.ts)} ago · refreshes every 10 s · nothing is ever closed automatically`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="CPU" value={`${d.cpu?.toFixed(0)}%`} sub={`${d.cores} logical cores`} />
        <Stat label="RAM" value={`${d.ram?.toFixed(0)}%`} sub={`${fmtBytes(d.ramUsed)} of ${fmtBytes(d.ramTotal)}`} />
        <Stat label="Processes" value={d.list.length} sub={`${bg} without a visible window`} />
        <Stat label="Resource warnings" value={flagged} tone={flagged ? "warn" : "good"} sub="high CPU / RAM / lingering" />
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="flex gap-1 rounded-xl bg-panel2 p-1 border border-line text-sm">
            {([["all", "All"], ["bg", "Background only"], ["flag", "Flagged"]] as const).map(([k, l]) => <button key={k} onClick={() => setView(k)} className={`px-3 py-1 rounded-lg cursor-pointer ${view === k ? "bg-accent/20" : "text-mute"}`}>{l}</button>)}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name…" className="flex-1 min-w-40 rounded-xl bg-panel2 border border-line px-3 py-2 text-sm outline-none" />
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="rounded-xl bg-panel2 border border-line px-3 py-2 text-sm"><option value="cpu">Sort: CPU</option><option value="rss">Sort: RAM</option><option value="name">Sort: Name</option></select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-mute text-xs uppercase tracking-wider border-b border-line"><tr>
              <th className="text-left py-2 px-3">Process / notes</th><th className="text-right px-3">PID</th><th className="text-right px-3">CPU</th><th className="text-right px-3">RAM</th><th className="text-left px-3">Status</th><th className="text-left px-3">Started</th>
            </tr></thead>
            <tbody>
              {list.map((p: any) => (
                <tr key={p.pid} className="border-b border-line/50 hover:bg-panel2/60 align-top">
                  <td className="py-2 px-3 min-w-56"><div className="font-medium">{p.name}</div>{p.why.map((w: any, i: number) => <div key={i} className={`text-xs mt-0.5 ${w.tone === "bad" ? "text-bad" : w.tone === "warn" ? "text-warn" : "text-mute"}`}>{w.text}</div>)}</td>
                  <td className="py-2 px-3 text-right text-mute tabular-nums">{p.pid}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${p.cpu >= d.cpuWarn ? "text-bad" : p.cpu > 10 ? "text-warn" : ""}`}>{p.cpu.toFixed(1)}%</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${p.rss / 1048576 >= d.ramWarnMb ? "text-bad" : ""}`}>{fmtBytes(p.rss)}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.fg ? "bg-good/15 text-good" : p.window ? "bg-accent/15 text-accent" : "bg-panel2 text-mute"}`}>{p.fg ? "Foreground" : p.window ? "Windowed" : "Background"}</span>
                    {p.startup && <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-warn/10 text-warn">Startup</span>}
                    {!p.user && <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-panel2 text-mute" title="Runs outside your login session (Windows service or system process).">System</span>}
                  </td>
                  <td className="py-2 px-3 text-mute whitespace-nowrap text-xs">{p.start ? new Date(p.start * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Startup applications (${d.startup.length})`} className="mt-4">
        {d.startup.length === 0 ? <Empty>No startup entries found in your Run keys or Startup folders.</Empty> : (
          <div className="grid md:grid-cols-2 gap-2">
            {d.startup.map((s: any, i: number) => (
              <div key={i} className="flex justify-between gap-3 rounded-xl bg-panel2/60 border border-line px-3 py-2 text-sm">
                <div className="min-w-0"><div className="truncate">{s.name}</div><div className="text-xs text-mute truncate">{s.exe} · {s.source}</div></div>
                <span className={`text-xs self-center ${s.enabled ? "text-warn" : "text-mute"}`}>{s.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3"><Note>Read from HKCU/HKLM “Run” registry keys and Startup folders (read-only). Scheduled tasks and services are not listed. This monitor never disables anything; use Task Manager › Startup apps if you choose to.</Note></div>
      </Card>
      <div className="mt-4"><Note>“Background” means the process owns no visible top-level window. Many background processes (drivers, antivirus, Windows services, sync clients) are essential, so nothing is labelled unnecessary without a stated reason.</Note></div>
    </>
  );
}
