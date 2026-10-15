import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

export const EnvSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_CHANNEL_HIGH: z.string().default("#sm-high-conviction"),
    SLACK_CHANNEL_FEED: z.string().default("#sm-feed"),
    SLACK_CHANNEL_CLUSTERS: z.string().default("#sm-clusters"),
    SLACK_CHANNEL_OPS: z.string().default("#sm-ops"),

    HL_API_URL: z.string().url().default("https://api.hyperliquid.xyz"),
    HL_WS_URL: z.string().default("wss://api.hyperliquid.xyz/ws"),
    POLL_BUDGET_WEIGHT_PER_MIN: z.coerce.number().int().min(60).max(1200).default(800),
    POLL_MIN_INTERVAL_SEC: z.coerce.number().int().min(2).default(5),
    ENABLE_PRIORITY_WS: bool.default(false),

    AGG_WINDOW_SEC: z.coerce.number().int().min(5).default(120),
    CONFIG_RELOAD_SEC: z.coerce.number().int().min(10).default(60),
    FILLS_SYNC_INTERVAL_SEC: z.coerce.number().int().min(60).default(900),
    RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    DRY_RUN: bool.default(false),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
    WORKER_ID: z.string().default("worker-1"),
    TZ: z.string().default("Asia/Kolkata"),
  })
  .superRefine((env, ctx) => {
    if (!env.DRY_RUN && !env.SLACK_BOT_TOKEN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SLACK_BOT_TOKEN"], message: "required unless DRY_RUN=true" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Env {
  const merged: Record<string, string | undefined> = { ...raw };
  if (argv.includes("--dry-run")) merged.DRY_RUN = "true";
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  return parsed.data;
}

export function channelsFromEnv(env: Env): Record<"high" | "feed" | "clusters" | "ops", string> {
  return { high: env.SLACK_CHANNEL_HIGH, feed: env.SLACK_CHANNEL_FEED, clusters: env.SLACK_CHANNEL_CLUSTERS, ops: env.SLACK_CHANNEL_OPS };
}
