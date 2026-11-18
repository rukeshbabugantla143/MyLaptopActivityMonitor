"use client";
import { useState } from "react";
import { useApi, post, Card, PageHeader, Empty, Note, Btn, fmtDur } from "@/components/ui";

const PRESETS = ["Personal", "College", "Work", "Other"];

function ago(t: number | null) {
  if (!t) return "never";
  const s = Date.now() / 1000 - t;
  if (s < 90) return "just now";
  if (s < 86400) return `${fmtDur(s, true)} ago`;
  return new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ProfileRow({ p, reload }: { p: any; reload: () => void }) {
  const [name, setName] = useState(p.label || "");
  const [del, setDel] = useState("");
  const save = async (label: string) => { await post("/api/webprofile", { profile_id: p.id, label }); reload(); };
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-good" : "bg-mute"}`} />
            <span className={`text-lg font-semibold ${p.configured ? "" : "text-warn"}`}>{p.label || "Unconfigured"}</span>
            {!p.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-bad/15 text-bad">Tracking off</span>}
          </div>
          <div className="text-xs text-mute mt-1">ID {p.id} · extension v{p.version || "?"}</div>
          <div className="text-xs text-mute">Extension {p.connected ? "connected (Chrome open)" : `last contact ${ago(p.lastSeen)}`} · last activity {ago(p.lastActivity)}</div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><div className="text-xs text-mute">Today</div><div className="font-semibold tabular-nums">{fmtDur(p.todaySecs, true)}</div></div>
          <div><div className="text-xs text-mute">All time</div><div className="font-semibold tabular-nums">{fmtDur(p.totalSecs, true)}</div></div>
          <div><div className="text-xs text-mute">Websites</div><div className="font-semibold tabular-nums">{p.domains}</div></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        {PRESETS.map((l) => <button key={l} onClick={() => { setName(l); save(l); }} className={`text-xs px-3 py-1.5 rounded-lg border cursor-pointer ${p.label === l ? "bg-accent/20 border-accent/50" : "bg-panel2 border-line text-mute hover:text-ink"}`}>{l}</button>)}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Custom name" maxLength={40} className="rounded-lg bg-panel2 border border-line px-3 py-1.5 text-sm w-40" />
        <Btn onClick={() => name.trim() && save(name.trim())}>Rename</Btn>
        <span className="flex-1" />
        <Btn onClick={async () => { await post("/api/webprofile", { profile_id: p.id, enabled: !p.enabled }); reload(); }}>{p.enabled ? "Disable tracking" : "Enable tracking"}</Btn>
      </div>
      <details className="mt-3 text-xs text-mute">
        <summary className="cursor-pointer">Remove this profile and its website history…</summary>
        <div className="flex gap-2 mt-2">
          <input value={del} onChange={(e) => setDel(e.target.value)} placeholder="Type DELETE" className="rounded-lg bg-panel2 border border-line px-3 py-1.5 text-sm" />
          <Btn tone="danger" disabled={del !== "DELETE"} onClick={async () => { await post("/api/webprofile", { profile_id: p.id, delete: true, confirm: "DELETE" }); reload(); }}>Delete profile data</Btn>
        </div>
        <div className="mt-1">If the extension is still installed in that Chrome profile, it'll register again as Unconfigured.</div>
      </details>
    </Card>
  );
}

export default function Profiles() {
  const { data, error, reload } = useApi<any>("/api/webprofiles", 15000);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;
  const unconf = data.profiles.filter((p: any) => !p.configured).length;
  return (
    <>
      <PageHeader title="Chrome Profiles" subtitle="Each Chrome profile with the extension installed reports separately. Data is never mixed between profiles." />
      {!data.globalEnabled && <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 text-warn text-sm px-4 py-3">Website tracking is turned off for all profiles in Settings.</div>}
      {unconf > 0 && <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 text-warn text-sm px-4 py-3">{unconf} profile{unconf > 1 ? "s are" : " is"} Unconfigured. Give {unconf > 1 ? "them names" : "it a name"} below, or in the extension's popup in that Chrome profile. Their data is kept separate and shown as “Unconfigured”.</div>}
      {data.profiles.length === 0 ? (
        <Card title="No Chrome profiles connected yet">
          <ol className="text-sm list-decimal pl-5 space-y-1 text-mute">
            <li>Open the Chrome profile you want to track, then go to <code className="text-ink">chrome://extensions</code>.</li>
            <li>Turn on <b className="text-ink">Developer mode</b>, click <b className="text-ink">Load unpacked</b>, and pick the <code className="text-ink">chrome-extension</code> folder in My_Laptop_Activity_Monitor.</li>
            <li>In the page that opens, choose a name (Personal / College / Work / Other / custom) and Save.</li>
            <li>Repeat for every Chrome profile. Each one shows up here within a minute.</li>
          </ol>
          <div className="mt-3"><Note>Full guide: docs/CHROME_EXTENSION.md</Note></div>
        </Card>
      ) : <div className="space-y-4">{data.profiles.map((p: any) => <ProfileRow key={p.id} p={p} reload={reload} />)}</div>}
    </>
  );
}
