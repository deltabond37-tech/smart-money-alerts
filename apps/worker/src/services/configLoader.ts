import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_THRESHOLDS, mergeThresholds, type Thresholds, type Wallet } from "@sma/core";
import type { ConfigBundle, Repo } from "../db/repo.js";
import { errMsg, type Logger } from "../logger.js";

/**
 * Holds the current wallets/rules/coin tiers. Reloads on a timer and (optionally) on Supabase Realtime
 * change notifications, so dashboard edits reach the worker within CONFIG_RELOAD_SEC without a redeploy.
 */
export class ConfigLoader {
  private bundle: ConfigBundle = { wallets: [], rules: [], coinTiers: {} };
  private timer: NodeJS.Timeout | null = null;
  private realtimeUnsub: (() => void) | null = null;
  private reloading: Promise<void> | null = null;
  private dirty = false;
  loadedAt = 0;
  version = 0;

  constructor(
    private readonly repo: Repo,
    private readonly log: Logger,
    private readonly reloadSec: number,
  ) {}

  get current(): ConfigBundle {
    return this.bundle;
  }

  get activeWallets(): Wallet[] {
    return this.bundle.wallets.filter((w) => w.isActive);
  }

  walletById(id: string): Wallet | undefined {
    return this.bundle.wallets.find((w) => w.id === id);
  }

  /** Global thresholds (used for process-wide settings like the aggregation window and cluster params). */
  get globalThresholds(): Thresholds {
    const g = this.bundle.rules.find((r) => r.enabled && r.scope === "global");
    return g ? mergeThresholds({ ...g.thresholds, event_types: g.eventTypes }) : DEFAULT_THRESHOLDS;
  }

  async reload(): Promise<void> {
    if (this.reloading) {
      this.dirty = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      try {
        const next = await this.repo.loadConfig();
        const changed = JSON.stringify(next) !== JSON.stringify(this.bundle);
        this.bundle = next;
        this.loadedAt = Date.now();
        if (changed) {
          this.version++;
          this.log.info({ wallets: next.wallets.length, active: this.activeWallets.length, rules: next.rules.length, version: this.version }, "config loaded");
        }
      } catch (e) {
        this.log.error({ err: errMsg(e) }, "config reload failed; keeping previous config");
      } finally {
        this.reloading = null;
      }
    })();
    await this.reloading;
    if (this.dirty) {
      this.dirty = false;
      await this.reload();
    }
  }

  start(sb?: SupabaseClient): void {
    this.timer = setInterval(() => void this.reload(), this.reloadSec * 1000);
    if (sb) this.subscribeRealtime(sb);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.realtimeUnsub?.();
  }

  private subscribeRealtime(sb: SupabaseClient): void {
    let debounce: NodeJS.Timeout | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void this.reload(), 1500);
    };
    const ch = sb.channel("sma-config");
    for (const table of ["wallets", "alert_rules", "coin_tiers"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    ch.subscribe((status) => this.log.info({ status }, "realtime config channel"));
    this.realtimeUnsub = () => void sb.removeChannel(ch);
  }
}
