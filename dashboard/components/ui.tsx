"use client";
import { useCallback, useEffect, useState } from "react";

export function useApi<T = any>(url: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setData(j); setError(null);
    } catch (e: any) { setError(String(e.message || e)); }
  }, [url]);
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}

export async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export const fmtDur = (secs: number | null | undefined, short = false) => {
  if (secs == null || !isFinite(secs)) return "—";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return short ? `${h}h ${m}m` : `${h} h ${m} min`;
  if (m > 0) return short ? `${m}m` : `${m} min`;
  return `${s % 60}s`;
};
export const fmtBytes = (b: number | null | undefined) => {
  if (b == null) return "—";
  if (b > 1073741824) return (b / 1073741824).toFixed(1) + " GB";
  return (b / 1048576).toFixed(0) + " MB";
};
export const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtHours = (secs: number) => Math.round((secs / 3600) * 10) / 10;

export const CAT_COLORS: Record<string, string> = {
  Development: "#7c9cff", Education: "#34d399", Browser: "#38bdf8", Entertainment: "#f472b6",
  Communication: "#fbbf24", System: "#94a3b8", Other: "#a78bfa",
};
const PALETTE = ["#7c9cff", "#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#facc15", "#94a3b8"];
export const colorFor = (key: string) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

export function Card({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel/80 backdrop-blur p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-medium text-mute tracking-wide">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-4 min-w-0">
      <div className="text-xs text-mute uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums truncate ${c}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mute truncate">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-mute mt-1 text-sm">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Bar({ value, max, color = "#7c9cff" }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-panel2 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%`, background: color }} />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-mute py-8 text-center">{children}</div>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-mute leading-relaxed">{children}</p>;
}

export function Btn({ children, onClick, tone = "default", disabled }: { children: React.ReactNode; onClick?: () => void; tone?: "default" | "primary" | "danger"; disabled?: boolean }) {
  const t = tone === "primary" ? "bg-accent text-[#0a0f1f] hover:brightness-110" : tone === "danger" ? "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25" : "bg-panel2 border border-line hover:border-accent/50";
  return <button disabled={disabled} onClick={onClick} className={`px-3.5 py-2 rounded-xl text-sm font-medium transition disabled:opacity-40 cursor-pointer ${t}`}>{children}</button>;
}

export const tooltipStyle = { contentStyle: { background: "#0e121b", border: "1px solid #1f2636", borderRadius: 12, color: "#e7ebf3", fontSize: 12 }, labelStyle: { color: "#8a93a8" }, cursor: { fill: "rgba(124,156,255,0.06)" } };
