export const CATEGORIES = ["Development", "Education", "Browser", "Entertainment", "Communication", "System", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

// Default categories by executable name. Users can override any of these in Settings.
// Browsers stay "Browser": we do not know which website was open, so we never guess entertainment vs work.
const DEFAULTS: Record<string, Category> = {
  "code.exe": "Development", "devenv.exe": "Development", "idea64.exe": "Development", "pycharm64.exe": "Development",
  "windowsterminal.exe": "Development", "wt.exe": "Development", "powershell.exe": "Development", "pwsh.exe": "Development",
  "cmd.exe": "Development", "python.exe": "Development", "node.exe": "Development", "git-bash.exe": "Development",
  "sublime_text.exe": "Development", "notepad++.exe": "Development", "cursor.exe": "Development", "claude.exe": "Development",
  "postman.exe": "Development", "docker desktop.exe": "Development", "androidstudio64.exe": "Development", "studio64.exe": "Development",
  "chrome.exe": "Browser", "msedge.exe": "Browser", "firefox.exe": "Browser", "brave.exe": "Browser", "opera.exe": "Browser",
  "vivaldi.exe": "Browser", "arc.exe": "Browser",
  "spotify.exe": "Entertainment", "vlc.exe": "Entertainment", "steam.exe": "Entertainment", "steamwebhelper.exe": "Entertainment",
  "netflix.exe": "Entertainment", "epicgameslauncher.exe": "Entertainment", "music.ui.exe": "Entertainment", "video.ui.exe": "Entertainment",
  "microsoft.media.player.exe": "Entertainment", "primevideo.exe": "Entertainment",
  "teams.exe": "Communication", "ms-teams.exe": "Communication", "slack.exe": "Communication", "discord.exe": "Communication",
  "zoom.exe": "Communication", "whatsapp.exe": "Communication", "whatsapp.root.exe": "Communication", "telegram.exe": "Communication",
  "outlook.exe": "Communication", "olk.exe": "Communication", "thunderbird.exe": "Communication",
  "winword.exe": "Education", "excel.exe": "Education", "powerpnt.exe": "Education", "onenote.exe": "Education",
  "acrord32.exe": "Education", "acrobat.exe": "Education", "notion.exe": "Education", "obsidian.exe": "Education", "anki.exe": "Education",
  "explorer.exe": "System", "taskmgr.exe": "System", "systemsettings.exe": "System", "applicationframehost.exe": "System",
  "searchhost.exe": "System", "startmenuexperiencehost.exe": "System", "shellexperiencehost.exe": "System", "mmc.exe": "System",
  "control.exe": "System", "regedit.exe": "System", "lockapp.exe": "System", "unknown": "System", "notepad.exe": "Other",
};

export function categoryFor(exe: string, overrides: Record<string, string>): string {
  const k = (exe || "").toLowerCase();
  return overrides[k] || DEFAULTS[k] || "Other";
}

export const PRODUCTIVE = new Set(["Development", "Education"]);
