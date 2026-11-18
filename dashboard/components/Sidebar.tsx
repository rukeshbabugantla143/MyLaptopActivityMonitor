"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApi, post, fmtDur } from "./ui";

const NAV = [
  ["/", "Overview"], ["/screen-time", "Screen Time"], ["/apps", "Applications"], ["/websites", "Websites"], ["/profiles", "Chrome Profiles"],["/background", "Background Activity"],
  ["/battery", "Battery"], ["/timeline", "Timeline"], ["/weekly", "Weekly Report"], ["/settings", "Settings"],
];

function ago(ts: number | null) {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  return s < 5 ? "just now" : `${fmtDur(s, true)} ago`;
}

export default function Sidebar() {
  const path = usePathname();
  const { data: h, error, reload } = useApi<any>("/api/health", 4000);
  const [busy, setBusy] = useState(false);
  const act = async (action: string) => {
    setBusy(true);
    try { await post("/api/collector", { action }); } finally { setTimeout(() => { reload(); setBusy(false); }, 2500); }
  };
  const online = !!h && !error;
  const c = h?.collector;
  const state: string = !online ? "unknown" : c?.state || "stopped";
  const tracking = state === "tracking", paused = state === "paused";
  const running = tracking || paused;
  const label: Record<string, string> = { tracking: "Tracking", paused: "Paused", stopped: "Stopped", starting: "Starting…", failed: "Crashed (gave up)", error: "Error", running: "Running", unknown: "Unknown" };
  const dot = tracking ? "bg-good animate-pulse" : paused || state === "starting" ? "bg-warn" : "bg-bad";
  const btn = "text-xs rounded-lg py-1.5 font-medium cursor-pointer disabled:opacity-40";
  return (
    <aside className="w-64 shrink-0 border-r border-line bg-panel/60 hidden md:flex flex-col p-4 sticky top-0 h-screen">
      <div className="px-2 py-3 mb-3">
        <div className="text-[15px] font-semibold tracking-tight">Activity Monitor</div>
        <div className="text-xs text-mute">Local · private · yours</div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(([href, l]) => (
          <Link key={href} href={href} className={`px-3 py-2 rounded-lg text-sm transition ${path === href ? "bg-accent/15 text-ink" : "text-mute hover:text-ink hover:bg-panel2"}`}>{l}</Link>
        ))}
      </nav>
      <div className="mt-auto rounded-xl border border-line bg-panel2/60 p-3 text-xs space-y-1.5">
        <div className="flex justify-between"><span className="text-mute">Tracker</span><span className="flex items-center gap-1.5 text-ink"><span className={`h-2 w-2 rounded-full ${dot}`} />{label[state] || state}</span></div>
        <div className="flex justify-between"><span className="text-mute">Server</span><span className={online ? "text-good" : "text-bad"}>{online ? "Online" : "Offline"}</span></div>
        <div className="flex justify-between"><span className="text-mute">Auto-recovery</span><span className={h?.supervisor?.alive ? "text-good" : "text-mute"}>{h?.supervisor?.alive ? "Active" : "Off"}</span></div>
        <div className="flex justify-between"><span className="text-mute">Last update</span><span>{online ? ago(h.lastData) : "—"}</span></div>
        <div className="flex justify-between gap-2"><span className="text-mute shrink-0">Current app</span><span className="truncate">{h?.currentApp?.app || "—"}</span></div>
        <div className="flex justify-between"><span className="text-mute">Today</span><span>{online ? fmtDur(h.todayActiveSec, true) : "—"}</span></div>
        <div className="grid grid-cols-2 gap-1.5 pt-2">
          {!running && <button disabled={busy || !online} onClick={() => act("start")} className={`${btn} col-span-2 bg-accent text-[#0a0f1f]`}>Start Monitoring</button>}
          {tracking && <button disabled={busy} onClick={() => act("pause")} className={`${btn} bg-warn/15 text-warn`}>Pause</button>}
          {paused && <button disabled={busy} onClick={() => act("resume")} className={`${btn} bg-good/20 text-good`}>Resume</button>}
          {running && <button disabled={busy} onClick={() => act("stop")} className={`${btn} bg-bad/15 text-bad`}>Stop</button>}
          {running && <button disabled={busy} onClick={() => act("restart")} className={`${btn} col-span-2 bg-panel border border-line`}>Restart Monitoring</button>}
          <a href="/" target="_blank" rel="noreferrer" className={`${btn} col-span-2 text-center bg-panel border border-line`}>Open Dashboard in new tab</a>
        </div>
        {state === "failed" && <div className="text-bad pt-1">The collector crashed repeatedly. Check the logs, then press Start.</div>}
        {h?.supervisor?.server?.state === "port_conflict" && <div className="text-bad pt-1">Port 3939 is used by another program.</div>}
      </div>
    </aside>
  );
}
