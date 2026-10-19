export interface WatchdogOptions {
  /** Cheap liveness call against Telegram (e.g. updates.getState). Must reject on failure. */
  probe: () => Promise<unknown>;
  /** Light recovery: restart the updates loop. Called after `softAfter` consecutive failures. */
  soft: () => Promise<void>;
  /** Heavy recovery: rebuild the whole client from the session string. Called after `hardAfter` failures. */
  hard: () => Promise<void>;
  /** Pulls history for tracked chats to fill anything push missed. Runs after recovery and periodically. */
  sync: () => Promise<void>;
  intervalMs?: number;
  probeTimeoutMs?: number;
  softAfter?: number;
  hardAfter?: number;
  /** Safety-net catch-up even when the probe is healthy (push can stall silently). 0 disables it. */
  syncEveryMs?: number;
  log?: (msg: string) => void;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/** Detects a dead/stalled Telegram connection and recovers without crashing the process. */
export class Watchdog {
  private failures = 0;
  private recovering = false;
  private lastSync = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly o: Required<Omit<WatchdogOptions, 'log'>> & { log: (m: string) => void };

  constructor(opts: WatchdogOptions) {
    this.o = {
      intervalMs: 30_000,
      probeTimeoutMs: 15_000,
      softAfter: 2,
      hardAfter: 4,
      syncEveryMs: 300_000,
      log: (m) => console.log(`[watchdog] ${m}`),
      ...opts,
    };
  }

  start(): void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(() => void loop(), this.o.intervalMs);
    };
    this.timer = setTimeout(() => void loop(), this.o.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One check; exposed for tests. Never throws. */
  async tick(): Promise<void> {
    try {
      await withTimeout(this.o.probe(), this.o.probeTimeoutMs);
      this.failures = 0;
      const periodic = this.o.syncEveryMs > 0 && Date.now() - this.lastSync >= this.o.syncEveryMs;
      if (this.recovering || periodic) {
        this.recovering = false;
        await this.runSync();
      }
    } catch (err) {
      this.failures++;
      this.recovering = true;
      const reason = err instanceof Error ? err.message : String(err);
      this.o.log(`probe failed (${this.failures}): ${reason}`);
      try {
        if (this.failures === this.o.hardAfter) {
          this.o.log('rebuilding the Telegram client');
          this.failures = 0;
          await this.o.hard();
        } else if (this.failures === this.o.softAfter) {
          this.o.log('restarting the updates loop');
          await this.o.soft();
        }
      } catch (e) {
        this.o.log(`recovery failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private async runSync(): Promise<void> {
    this.lastSync = Date.now();
    try {
      await this.o.sync();
    } catch (e) {
      this.o.log(`sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
