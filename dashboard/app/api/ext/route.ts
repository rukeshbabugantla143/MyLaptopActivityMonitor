import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db, getSettings, dayKey, nowTs } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint for the "Activity Monitor – Websites" Chrome extension.
 * Security model:
 *   - The server only listens on 127.0.0.1 (see package.json / supervisor.py).
 *   - Host header must be 127.0.0.1:3939 or localhost:3939 (blocks DNS-rebinding from web pages).
 *   - Origin must be a chrome-extension:// origin. Web pages cannot forge that header.
 *   - Each extension install has a random secret; the first contact registers its SHA-256 (trust on first use),
 *     later requests for that profile_id must present the same secret.
 *   - Strict validation: domain names only (no URL, path, query), sane timestamps, bounded batch size.
 */
const EXT_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[0-9a-f]{64}$/;
const DOMAIN = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const REASONS = new Set(["tab_switch", "navigate", "blur", "idle", "locked", "closed", "disabled", "checkpoint", "startup_recovery", "suspend"]);

function cors(origin: string | null): Record<string, string> {
  return origin && EXT_ORIGIN.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" }
    : {};
}
const reply = (origin: string | null, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(origin) });

function guard(req: NextRequest): string | null {
  const host = req.headers.get("host") || "";
  if (!/^(127\.0\.0\.1|localhost):3939$/.test(host)) return "bad host";
  const origin = req.headers.get("origin");
  if (!origin || !EXT_ORIGIN.test(origin)) return "only the Activity Monitor extension may call this endpoint";
  return null;
}

export async function OPTIONS(req: NextRequest) {
  const err = guard(req);
  return new NextResponse(null, { status: err ? 403 : 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const err = guard(req);
  if (err) return reply(origin, { ok: false, error: err }, 403);
  const raw = await req.text();
  if (raw.length > 200_000) return reply(origin, { ok: false, error: "payload too large" }, 413);
  let b: any;
  try { b = JSON.parse(raw); } catch { return reply(origin, { ok: false, error: "invalid json" }, 400); }
  if (!UUID.test(b?.profile_id || "") || !SECRET.test(b?.secret || "")) return reply(origin, { ok: false, error: "invalid identity" }, 400);

  const d = db(), now = nowTs();
  const hash = crypto.createHash("sha256").update(b.secret).digest("hex");
  let p = d.prepare("SELECT * FROM chrome_profiles WHERE profile_id=?").get(b.profile_id);
  if (!p) {
    d.prepare("INSERT INTO chrome_profiles(profile_id,secret_hash,label,label_ts,enabled,ext_version,first_seen,last_seen) VALUES(?,?,?,?,1,?,?,?)")
      .run(b.profile_id, hash, null, 0, String(b.version || "").slice(0, 20), now, now);
    d.prepare("INSERT INTO events(ts,kind,detail) VALUES(?,?,?)").run(now, "chrome_profile_registered", JSON.stringify({ profile_id: b.profile_id }));
    p = d.prepare("SELECT * FROM chrome_profiles WHERE profile_id=?").get(b.profile_id);
  } else if (!crypto.timingSafeEqual(Buffer.from(p.secret_hash), Buffer.from(hash))) {
    return reply(origin, { ok: false, error: "secret mismatch for this profile id" }, 403);
  }

  // Label set in the extension's options page: newest change wins (dashboard renames use the same rule).
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 40) : null;
  const labelTs = Number(b.label_ts) || 0;
  if (label && labelTs > (p.label_ts || 0) && labelTs <= now + 60) {
    d.prepare("UPDATE chrome_profiles SET label=?, label_ts=? WHERE profile_id=?").run(label, labelTs, b.profile_id);
    p.label = label; p.label_ts = labelTs;
  }
  d.prepare("UPDATE chrome_profiles SET last_seen=?, ext_version=? WHERE profile_id=?").run(now, String(b.version || "").slice(0, 20), b.profile_id);

  const s = getSettings();
  const tracking = s.website_tracking_enabled !== false && s.monitoring_enabled !== false && !s.paused && !!p.enabled;
  let accepted = 0, rejected = 0;
  const segs = Array.isArray(b.segments) ? b.segments.slice(0, 500) : [];
  if (tracking && segs.length) {
    const upsert = d.prepare(`INSERT INTO web_sessions(id,profile_id,profile_label,browser,domain,start_ts,end_ts,duration,day,end_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET end_ts=MAX(web_sessions.end_ts, excluded.end_ts), duration=MAX(web_sessions.end_ts, excluded.end_ts)-web_sessions.start_ts,
        end_reason=COALESCE(excluded.end_reason, web_sessions.end_reason)
      WHERE web_sessions.profile_id=excluded.profile_id`);
    // Overlap guard: a new segment may not start before another segment (any profile) has ended.
    const prevEnd = d.prepare("SELECT MAX(end_ts) m FROM web_sessions WHERE id<>? AND start_ts<=? AND end_ts>?");
    const existing = d.prepare("SELECT start_ts FROM web_sessions WHERE id=?");
    for (const g of segs) {
      const start = Number(g?.start), end = Number(g?.end);
      const domain = String(g?.domain || "").toLowerCase();
      const ok = UUID.test(g?.id || "") && DOMAIN.test(domain) && isFinite(start) && isFinite(end) && end >= start
        && end <= now + 60 && start >= now - 7 * 86400 && end - start <= 86400 && (g.reason == null || REASONS.has(g.reason));
      if (!ok) { rejected++; continue; }
      const ex = existing.get(g.id);
      let st = ex ? ex.start_ts : start;
      if (!ex) { const m = prevEnd.get(g.id, start, start)?.m; if (m && m > st) st = m; }
      const en = Math.min(end, now + 5);
      if (en <= st) { rejected++; continue; }
      upsert.run(g.id, b.profile_id, p.label, "chrome", domain, st, en, en - st, dayKey(st), g.reason ?? null);
      accepted++;
    }
    const last = d.prepare("SELECT MAX(end_ts) m FROM web_sessions WHERE profile_id=?").get(b.profile_id)?.m;
    if (last) d.prepare("UPDATE chrome_profiles SET last_activity=? WHERE profile_id=?").run(last, b.profile_id);
  }
  return reply(origin, {
    ok: true, tracking, accepted, rejected, server_time: now,
    profile: { label: p.label, label_ts: p.label_ts, enabled: !!p.enabled },
    idle_sec: Math.max(15, Math.min(7200, Number(s.idle_threshold_sec) || 300)),
  });
}
