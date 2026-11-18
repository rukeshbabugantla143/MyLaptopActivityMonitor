// Activity Monitor – Websites (Manifest V3 service worker)
//
// Records ONLY: the domain (e.g. "youtube.com") of the active tab, while
//   - a Chrome window of THIS profile has OS focus (not minimized, not another app),
//   - the system is not idle and not locked (chrome.idle),
//   - tracking is enabled (here and in the dashboard).
// Never records full URLs, paths, queries, titles, page content, keystrokes or incognito tabs.
// Data is sent only to http://127.0.0.1:3939 (your own PC). Event-driven; a 30 s alarm is the safety net + sync.

const API = "http://127.0.0.1:3939/api/ext";
const VERSION = chrome.runtime.getManifest().version;
const MAX_QUEUE = 5000;

// ---------------------------------------------------------------- storage helpers
const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);
const nowS = () => Date.now() / 1000;
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

async function identity() {
  let { identity } = await get("identity");
  if (!identity) {
    identity = { profile_id: crypto.randomUUID(), secret: hex(32), created: nowS() };
    await set({ identity });
  }
  return identity;
}
async function config() {
  const { cfg } = await get("cfg");
  return { localEnabled: true, tracking: true, label: null, labelTs: 0, labelPending: false, idleSec: 300, ...(cfg || {}) };
}
const saveCfg = async (patch) => set({ cfg: { ...(await config()), ...patch } });

// Serialise all state changes so concurrent events can't double-open or double-close a segment.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn).catch((e) => console.warn("[activity-monitor]", e)));

// ---------------------------------------------------------------- domain extraction (domain only)
function toDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let h = u.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(h)) return null; // drops IPv6 literals and odd hosts
    if ((h === "127.0.0.1" || h === "localhost") && u.port === "3939") return null; // the Activity Monitor dashboard itself
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- core: decide what should be tracked right now
async function desiredState(cfg) {
  if (!cfg.localEnabled || cfg.tracking === false) return null;
  let win;
  try { win = await chrome.windows.getLastFocused({ populate: false }); } catch { return null; }
  if (!win || !win.focused || win.state === "minimized" || win.incognito) return null; // Chrome not the foreground app
  const idle = await chrome.idle.queryState(cfg.idleSec);
  if (idle !== "active") return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab || tab.incognito) return null;
  const domain = toDomain(tab.url || tab.pendingUrl || "");
  return domain ? { domain, tabId: tab.id } : null;
}

async function closeCurrent(cur, end, reason) {
  const { queue = [] } = await get("queue");
  const e = Math.max(cur.start, end);
  if (e - cur.start >= 1) queue.push({ id: cur.id, domain: cur.domain, start: cur.start, end: e, reason });
  while (queue.length > MAX_QUEUE) queue.shift();
  await set({ queue, cur: null });
}

function evaluate(reason) {
  return serial(async () => {
    const cfg = await config();
    const { cur } = await get("cur");
    const want = await desiredState(cfg);
    const now = nowS();
    if (cur && (!want || want.domain !== cur.domain || want.tabId !== cur.tabId)) {
      let end = now;
      if (reason === "idle") end = now - cfg.idleSec; // idle is reported after N s without input
      await closeCurrent(cur, end, reason);
      scheduleFlush();
    }
    const { cur: after } = await get("cur");
    if (!after && want) {
      await set({ cur: { id: crypto.randomUUID(), domain: want.domain, tabId: want.tabId, start: now, lastSeen: now } });
    }
  });
}

// ---------------------------------------------------------------- sync with the local server
let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 5000);
}

function flush() {
  return serial(async () => {
    const id = await identity();
    const cfg = await config();
    const { queue = [], cur } = await get(["queue", "cur"]);
    const now = nowS();
    const segments = queue.slice(0, 500);
    if (cur) segments.push({ id: cur.id, domain: cur.domain, start: cur.start, end: now, reason: null }); // live, not final
    const body = { profile_id: id.profile_id, secret: id.secret, version: VERSION, segments };
    if (cfg.labelPending && cfg.label) { body.label = cfg.label; body.label_ts = cfg.labelTs; }
    let res;
    try {
      const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      res = await r.json();
      if (!r.ok || !res.ok) throw new Error(res.error || "HTTP " + r.status);
    } catch (e) {
      await set({ status: { ok: false, at: now, error: String(e.message || e), queued: queue.length } });
      return; // keep the queue; retried on the next alarm
    }
    const sent = new Set(queue.slice(0, 500).map((s) => s.id));
    const { queue: q2 = [] } = await get("queue");
    await set({ queue: q2.filter((s) => !sent.has(s.id)) });
    const patch = { tracking: !!res.tracking && res.profile.enabled, idleSec: res.idle_sec || cfg.idleSec };
    if ((res.profile.label_ts || 0) >= (cfg.labelTs || 0)) Object.assign(patch, { label: res.profile.label, labelTs: res.profile.label_ts, labelPending: false });
    await saveCfg(patch);
    if (patch.idleSec !== cfg.idleSec) chrome.idle.setDetectionInterval(Math.max(15, patch.idleSec));
    await set({ status: { ok: true, at: now, accepted: res.accepted, rejected: res.rejected, tracking: patch.tracking, serverEnabled: res.profile.enabled, queued: Math.max(0, q2.length - sent.size) } });
    if (patch.tracking !== cfg.tracking) evaluate(patch.tracking ? "enabled" : "disabled");
  });
}

// ---------------------------------------------------------------- recovery after browser restart / crash
async function recover() {
  await serial(async () => {
    const { cur } = await get("cur");
    if (cur && nowS() - cur.lastSeen > 60) await closeCurrent(cur, cur.lastSeen, "startup_recovery");
  });
  const cfg = await config();
  chrome.idle.setDetectionInterval(Math.max(15, cfg.idleSec));
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  await evaluate("startup");
  flush();
}

// ---------------------------------------------------------------- events (no polling)
chrome.runtime.onInstalled.addListener(async (d) => {
  await identity();
  if (d.reason === "install") chrome.runtime.openOptionsPage();
  recover();
});
chrome.runtime.onStartup.addListener(recover);
chrome.tabs.onActivated.addListener(() => evaluate("tab_switch"));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url && tab.active) evaluate("navigate"); });
chrome.tabs.onRemoved.addListener(() => evaluate("closed"));
chrome.windows.onFocusChanged.addListener(() => evaluate("blur"));
chrome.windows.onRemoved.addListener(() => evaluate("closed"));
chrome.idle.onStateChanged.addListener((state) => evaluate(state === "active" ? "active" : state)); // idle | locked
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.cfg) { const o = c.cfg.oldValue || {}, n = c.cfg.newValue || {}; if (o.localEnabled !== n.localEnabled) evaluate("disabled"); if (n.labelPending && !o.labelPending) flush(); } });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "tick") return;
  await serial(async () => { const { cur } = await get("cur"); if (cur) await set({ cur: { ...cur, lastSeen: nowS() } }); });
  await evaluate("checkpoint"); // safety net for any missed event
  flush();
});
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m === "flush") { flush().then(() => get(["status", "queue", "cur"]).then(reply)); return true; }
});
// Service worker woke up for any reason: make sure the alarm exists.
chrome.alarms.get("tick").then((a) => { if (!a) chrome.alarms.create("tick", { periodInMinutes: 0.5 }); });
