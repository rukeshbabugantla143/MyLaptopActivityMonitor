export const WEB_CATEGORIES = ["Education", "Development", "Social Media", "Entertainment", "Productivity", "Other"] as const;
export const PRODUCTIVITY = ["Productive", "Neutral", "Distracting"] as const;

export const WEB_CAT_COLORS: Record<string, string> = {
  Education: "#34d399", Development: "#7c9cff", "Social Media": "#f472b6", Entertainment: "#fb923c", Productivity: "#38bdf8", Other: "#94a3b8",
};
export const PROD_COLORS: Record<string, string> = { Productive: "#4ade80", Neutral: "#94a3b8", Distracting: "#f87171" };

// Suggested defaults. Every one can be overridden per domain on the Websites page.
const SUGGEST: Record<string, string> = {
  "youtube.com": "Entertainment", "netflix.com": "Entertainment", "primevideo.com": "Entertainment", "hotstar.com": "Entertainment",
  "twitch.tv": "Entertainment", "spotify.com": "Entertainment", "jiocinema.com": "Entertainment", "music.youtube.com": "Entertainment",
  "instagram.com": "Social Media", "facebook.com": "Social Media", "x.com": "Social Media", "twitter.com": "Social Media",
  "reddit.com": "Social Media", "linkedin.com": "Social Media", "web.whatsapp.com": "Social Media", "snapchat.com": "Social Media",
  "discord.com": "Social Media", "telegram.org": "Social Media", "web.telegram.org": "Social Media", "threads.net": "Social Media",
  "github.com": "Development", "gitlab.com": "Development", "stackoverflow.com": "Development", "developer.mozilla.org": "Development",
  "npmjs.com": "Development", "pypi.org": "Development", "vercel.com": "Development", "localhost": "Development", "127.0.0.1": "Development",
  "claude.ai": "Productivity", "chatgpt.com": "Productivity", "gemini.google.com": "Productivity", "docs.google.com": "Productivity",
  "drive.google.com": "Productivity", "mail.google.com": "Productivity", "outlook.live.com": "Productivity", "notion.so": "Productivity",
  "calendar.google.com": "Productivity", "office.com": "Productivity", "figma.com": "Productivity",
  "coursera.org": "Education", "udemy.com": "Education", "khanacademy.org": "Education", "wikipedia.org": "Education",
  "geeksforgeeks.org": "Education", "w3schools.com": "Education", "leetcode.com": "Education", "nptel.ac.in": "Education",
  "edx.org": "Education", "classroom.google.com": "Education", "scholar.google.com": "Education",
};
const PROD_BY_CAT: Record<string, string> = {
  Education: "Productive", Development: "Productive", Productivity: "Productive", "Social Media": "Distracting", Entertainment: "Distracting", Other: "Neutral",
};

/** Suffix match: "en.wikipedia.org" -> "wikipedia.org". */
export function suggestedCategory(domain: string): string {
  let d = domain.toLowerCase();
  while (d) {
    if (SUGGEST[d]) return SUGGEST[d];
    const i = d.indexOf(".");
    if (i < 0) break;
    d = d.slice(i + 1);
  }
  if (d.endsWith(".edu") || d.endsWith(".ac.in")) return "Education";
  return "Other";
}

export type DomainClass = { category: string; productivity: string; customCategory: boolean; customProductivity: boolean };

export function classify(domain: string, overrides: Map<string, { category: string | null; productivity: string | null }>): DomainClass {
  const o = overrides.get(domain.toLowerCase());
  const category = o?.category || suggestedCategory(domain);
  const productivity = o?.productivity || PROD_BY_CAT[category] || "Neutral";
  return { category, productivity, customCategory: !!o?.category, customProductivity: !!o?.productivity };
}
