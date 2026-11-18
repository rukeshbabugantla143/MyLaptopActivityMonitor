# Chrome website tracking: extension guide

The `chrome-extension/` folder holds a small Manifest V3 extension. It reports **which domain** is active in Chrome, and for how long, to your own Activity Monitor at `http://127.0.0.1:3939`. Install it once in **each Chrome profile** you want to track. Each install becomes a separate profile on the dashboard.

## Install (per Chrome profile)

1. Open the Chrome profile (Personal, College, Work…).
2. Go to `chrome://extensions` and turn on **Developer mode** (top-right switch).
3. Click **Load unpacked** and select `My_Laptop_Activity_Monitor\chrome-extension`.
4. A setup page opens. Pick a **profile name** (Personal / College / Work / Other / Custom…) and click **Save name**.
5. Optionally pin the extension (puzzle icon → pin). Clicking it shows the same page: connection status, name and on/off switch.

Repeat for every profile. The extension has the same ID in every profile, but each install creates its own random **profile ID**, so the data never mixes.

> Chrome may show "Disable developer mode extensions" at startup. Click the X to keep it. Chrome doesn't allow sideloaded extensions to be installed any other way without the Web Store.

**After updating the files** in `chrome-extension/`, click the reload ↻ icon on the extension's card in `chrome://extensions` in each profile.

## Configure

| Where | What |
|---|---|
| Extension popup | Profile name, tracking on/off for this profile, "Test connection now" |
| Dashboard → **Chrome Profiles** | Rename (the newest change wins, whether made here or in the extension), enable/disable per profile, last activity, connection status, delete a profile's data |
| Dashboard → **Settings** | Master switch "Website tracking (Chrome extension)" |
| Dashboard → **Websites** | Category and Productive / Neutral / Distracting class per domain. Suggestions are marked "(suggested)", and any of them can be changed or reset |

A profile that hasn't been named shows as **Unconfigured**. It's never merged into another profile.

## Verify it works

1. In the extension popup, the status should read **"Connected · tracking"** with "Last sync … ago".
2. Browse a site for a minute with Chrome in front.
3. Dashboard → **Websites**: the domain appears in the table and timeline (it refreshes every 30 s). Dashboard → **Chrome Profiles** shows a green dot and "connected (Chrome open)".

## What counts as website time

Time counts only when **all** of these are true:

- A Chrome window of that profile has OS focus (not minimized, not another app). This comes from the extension's focus events.
- The system isn't idle or locked (`chrome.idle`, using the same idle threshold as the rest of the app).
- The active tab is an `http(s)` page. `chrome://`, the new-tab page and extension pages are not counted.
- On the server: the Windows collector confirms `chrome.exe` was the foreground app and you were active. Where segments from two profiles overlap, the most recently started one wins.

The server-side checks matter. In testing, Chrome sometimes still believed it had focus when Windows had already given focus to another app. Those seconds are discarded.

## Privacy

- **Stored:** domain (e.g. `youtube.com`, with `www.` removed), start, end, profile ID and name, and the reason the segment ended.
- **Never stored or sent:** full URLs, paths, query strings, searches, page titles, page content, form data, passwords, keystrokes, screenshots.
- Incognito windows are **never tracked** (`"incognito": "not_allowed"`).
- The extension can only reach `http://127.0.0.1:3939` (its single host permission). There are no other network calls, analytics or cloud services.
- Chrome's install prompt says the extension can "read your browsing history". That's because the `tabs` permission is needed to read the active tab's address. The extension reduces it to the domain immediately, and nothing else leaves the extension.

## How the connection is secured

- The server listens on `127.0.0.1` only. Requests with any other `Host` header are rejected, which blocks DNS-rebinding attacks from web pages.
- Only requests with a `chrome-extension://` origin are accepted. Normal web pages can't forge that header.
- Each install generates a random 256-bit secret. The server stores its SHA-256 on first contact, and later requests for that profile ID must present the same secret.
- Every field is validated: domain characters only, timestamps within the last 7 days, no future times, at most 24 h per segment, at most 500 segments per request.
- Each segment has a UUID. Re-sending a segment updates it instead of adding to it, so retries never double-count.

## Reliability

- The extension is event-driven (tab switch, navigation, window focus, idle/lock, tab or window close). An alarm every 30 s acts as the safety net and syncs the data.
- If the monitor is down, segments are **buffered** in the extension (up to 5,000) and delivered when it's back. Tested: data recorded during a server outage arrived after the supervisor restarted the server.
- If Chrome is closed or crashes, the open segment is closed at its last checkpoint (at most 30 s later) on the next start, so time is never over-counted.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Popup: "Cannot reach the monitor" | Run `open-dashboard.bat`. Check that http://127.0.0.1:3939/api/health opens. Data is buffered meanwhile |
| "Connected · tracking paused" | Monitoring is paused or stopped, website tracking is off in Settings, or this profile is disabled on the Chrome Profiles page |
| Profile shows "Unconfigured" | Name it in the popup or on the Chrome Profiles page |
| Website time is lower than "Chrome in front" | Expected: new-tab and `chrome://` pages, profiles without the extension, and idle time aren't counted as websites |
| Two entries for one profile | The extension was removed and re-added, which creates a new identity. Delete the old entry on the Chrome Profiles page |
| Changes to the extension don't take effect | Click reload ↻ on its card in `chrome://extensions` |
