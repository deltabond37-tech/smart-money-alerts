import { CORE_VERSION, resolveRules, TokenBucket, WindowAggregator } from "@sma/core";
import { HlInfoClient } from "./adapters/hyperliquid/client.js";
import { HyperliquidAdapter } from "./adapters/hyperliquid/HyperliquidAdapter.js";
import { channelsFromEnv, loadEnv } from "./config.js";
import { createSupabase, SupabaseRepo } from "./db/supabaseRepo.js";
import { createLogger, errMsg } from "./logger.js";
import { Alerter } from "./services/alerter.js";
import { ConfigLoader } from "./services/configLoader.js";
import { Periodic } from "./services/periodic.js";
import { Poller } from "./services/poller.js";
import { Processor } from "./services/processor.js";
import { DryRunSlackPoster, MonitoredSlackPoster, WebApiSlackPoster } from "./services/slack.js";

const VERSION = `worker/0.1.0 core/${CORE_VERSION}`;

async function main(): Promise<void> {
  const env = loadEnv();
  process.env.TZ = env.TZ;
  const log = createLogger(env.LOG_LEVEL, env.WORKER_ID);
  log.info({ version: VERSION, dryRun: env.DRY_RUN, budget: env.POLL_BUDGET_WEIGHT_PER_MIN }, "smart-money-alerts worker starting");

  const sb = createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const repo = new SupabaseRepo(sb);
  const bucket = new TokenBucket(env.POLL_BUDGET_WEIGHT_PER_MIN);
  const client = new HlInfoClient({ baseUrl: env.HL_API_URL, bucket, log });
  const adapter = new HyperliquidAdapter(client, log, env.ENABLE_PRIORITY_WS ? env.HL_WS_URL : undefined);

  const slackInner = env.DRY_RUN ? new DryRunSlackPoster(log) : new WebApiSlackPoster(env.SLACK_BOT_TOKEN!, log);
  const slack = new MonitoredSlackPoster(slackInner, log);
  const channels = channelsFromEnv(env);

  const config = new ConfigLoader(repo, log, env.CONFIG_RELOAD_SEC);
  await config.reload();
  if (config.current.wallets.length === 0) log.warn("no wallets configured; add some in the dashboard");

  const aggregator = new WindowAggregator(config.globalThresholds.agg_window_sec * 1000 || env.AGG_WINDOW_SEC * 1000);
  const alerter = new Alerter({ repo, slack, channels, log, timeZone: env.TZ });
  const processor = new Processor({ repo, config, alerter, adapter, aggregator, log });
  await processor.boot();

  const walletsById = new Map(config.current.wallets.map((w) => [w.id, w]));
  await alerter.resume(walletsById, (w, coin) => resolveRules(config.current, w, coin));

  const poller = new Poller({ adapter, config, processor, bucket, log, budgetPerMin: env.POLL_BUDGET_WEIGHT_PER_MIN, minIntervalSec: env.POLL_MIN_INTERVAL_SEC });
  const periodic = new Periodic({
    repo,
    adapter,
    config,
    processor,
    poller,
    alerter,
    slack,
    log,
    workerId: env.WORKER_ID,
    version: VERSION,
    dryRun: env.DRY_RUN,
    fillsSyncSec: env.FILLS_SYNC_INTERVAL_SEC,
    retentionDays: env.RETENTION_DAYS,
    budgetUsed: () => bucket.usedThisMinute(),
  });

  config.start(sb);
  periodic.start();

  let stopWs: (() => void) | null = null;
  const startWs = () => {
    stopWs?.();
    const priority = config.activeWallets.filter((w) => w.isPriority).map((w) => w.address);
    stopWs = env.ENABLE_PRIORITY_WS && priority.length ? adapter.watch(priority, (addr) => poller.trigger(addr)) : null;
  };
  startWs();
  let lastConfigVersion = config.version;
  const wsRefresh = setInterval(() => {
    if (config.version !== lastConfigVersion) {
      lastConfigVersion = config.version;
      startWs();
    }
  }, 30_000);

  await alerter.postOps("info", `Worker started (${env.DRY_RUN ? "DRY RUN" : "live"})`, {
    wallets: config.activeWallets.length,
    interval_sec: poller.stats.intervalSec || "pending",
    version: VERSION,
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    poller.stop();
    periodic.stop();
    config.stop();
    clearInterval(wsRefresh);
    stopWs?.();
    await periodic.heartbeat().catch(() => undefined);
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await poller.runForever();
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "fatal", msg: errMsg(e), stack: e instanceof Error ? e.stack : undefined }));
  process.exit(1);
});
