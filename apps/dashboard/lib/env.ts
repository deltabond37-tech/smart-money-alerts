export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) are required");
  return { url, key };
}

function validTimeZone(tz: string | undefined): string | null {
  if (!tz) return null;
  const clean = tz.replace(/^:/, ""); // Vercel sets TZ=":UTC" (POSIX form), which Intl rejects
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: clean });
    return clean;
  } catch {
    return null;
  }
}

/** Display time zone. Set DASHBOARD_TZ to override (TZ is reserved on Vercel). Defaults to IST. */
export const TIME_ZONE = validTimeZone(process.env.DASHBOARD_TZ) ?? validTimeZone(process.env.TZ) ?? "Asia/Kolkata";

export function slackChannels() {
  return {
    high: process.env.SLACK_CHANNEL_HIGH ?? "#sm-high-conviction",
    feed: process.env.SLACK_CHANNEL_FEED ?? "#sm-feed",
    clusters: process.env.SLACK_CHANNEL_CLUSTERS ?? "#sm-clusters",
    ops: process.env.SLACK_CHANNEL_OPS ?? "#sm-ops",
  };
}

/**
 * Optional allowlist. When set, only matching emails may sign in (checked at login and in middleware).
 * Entries are exact emails (`alice@x.com`) or whole domains (`@x.com`).
 */
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
  if (!email) return false;
  const e = email.toLowerCase();
  const domain = e.slice(e.lastIndexOf("@"));
  return list.some((entry) => (entry.startsWith("@") ? entry === domain : entry === e));
}
