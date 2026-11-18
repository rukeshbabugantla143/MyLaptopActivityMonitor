const $ = (id) => document.getElementById(id);
const PRESETS = ["Personal", "College", "Work", "Other"];

function ago(t) {
  if (!t) return "never";
  const s = Math.round(Date.now() / 1000 - t);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

async function render() {
  const { identity, cfg = {}, status, queue = [] } = await chrome.storage.local.get(["identity", "cfg", "status", "queue"]);
  $("pid").textContent = identity ? identity.profile_id : "(created on first run)";
  const label = cfg.label || "";
  if (PRESETS.includes(label)) { $("preset").value = label; $("custom").style.display = "none"; }
  else if (label) { $("preset").value = "__custom"; $("custom").style.display = "block"; $("custom").value = label; }
  $("saved").textContent = label ? `Current name: ${label}${cfg.labelPending ? " (sending…)" : ""}` : "Not named yet: shown as “Unconfigured” on the dashboard.";
  $("enabled").checked = cfg.localEnabled !== false;
  const c = $("conn");
  if (!status) { c.textContent = "not contacted yet"; c.className = "warn"; }
  else if (status.ok) {
    c.textContent = status.tracking ? "Connected · tracking" : "Connected · tracking paused";
    c.className = status.tracking ? "ok" : "warn";
  } else { c.textContent = "Cannot reach the monitor"; c.className = "bad"; }
  $("detail").textContent = status
    ? (status.ok ? `Last sync ${ago(status.at)} · ${queue.length} waiting` : `${status.error} · ${queue.length} segments buffered, will retry every minute. Is the Activity Monitor running?`)
    : "";
}

$("preset").addEventListener("change", () => { $("custom").style.display = $("preset").value === "__custom" ? "block" : "none"; });
$("save").addEventListener("click", async () => {
  const v = $("preset").value === "__custom" ? $("custom").value.trim() : $("preset").value;
  if (!v) return;
  const { cfg = {} } = await chrome.storage.local.get("cfg");
  await chrome.storage.local.set({ cfg: { ...cfg, label: v.slice(0, 40), labelTs: Date.now() / 1000, labelPending: true } });
  setTimeout(render, 1500);
});
$("enabled").addEventListener("change", async () => {
  const { cfg = {} } = await chrome.storage.local.get("cfg");
  await chrome.storage.local.set({ cfg: { ...cfg, localEnabled: $("enabled").checked } });
  render();
});
$("test").addEventListener("click", async () => {
  $("conn").textContent = "testing…";
  await chrome.runtime.sendMessage("flush");
  render();
});
chrome.storage.onChanged.addListener(render);
render();
