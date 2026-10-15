export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) are required");
  return { url, key };
}

export const TIME_ZONE = process.env.TZ || "Asia/Kolkata";

export function slackChannels() {
  return {
    high: process.env.SLACK_CHANNEL_HIGH ?? "#sm-high-conviction",
    feed: process.env.SLACK_CHANNEL_FEED ?? "#sm-feed",
    clusters: process.env.SLACK_CHANNEL_CLUSTERS ?? "#sm-clusters",
    ops: process.env.SLACK_CHANNEL_OPS ?? "#sm-ops",
  };
}

/** Optional allowlist. When set, only these emails may sign in (checked at login and in middleware). */
export function allowedEmails(): string[] | null {
  const raw = process.env.DASHBOARD_ALLOWED_EMAILS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | undefined | null): boolean {
  const list = allowedEmails();
  if (!list) return true;
  return !!email && list.includes(email.toLowerCase());
}
