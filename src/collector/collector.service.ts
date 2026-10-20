import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { Channel } from '../types.js';
import { BackfillService } from './backfill.service.js';
import { PollerService } from './poller.service.js';

/** Periodically collects every active web-preview channel, at most one job per channel at a time. */
@Injectable()
export class CollectorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Collector');
  private readonly busy = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChannelsRepository) private readonly channels: ChannelsRepository,
    @Inject(PollerService) private readonly poller: PollerService,
    @Inject(BackfillService) private readonly backfiller: BackfillService,
  ) {}

  onApplicationBootstrap(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.POLL_SECONDS * 1000);
    this.logger.log(`polling every ${this.config.POLL_SECONDS}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Kick off collection for a single channel immediately (e.g. right after it's added). */
  runNow(channel: Channel): void {
    void this.processChannel(channel);
  }

  /** Re-run a backfill for a channel (e.g. with a custom number of days). */
  backfillNow(channel: Channel, days?: number): boolean {
    if (this.busy.has(channel.id)) return false;
    void this.runExclusive(channel, (c) => this.backfiller.backfill(c, days));
    return true;
  }

  isBusy(id: number): boolean {
    return this.busy.has(id);
  }

  /** Runs a job for a channel unless one is already running for it. */
  private async runExclusive(channel: Channel, job: (c: Channel) => Promise<unknown>): Promise<void> {
    if (this.busy.has(channel.id)) return;
    this.busy.add(channel.id);
    try {
      await job(channel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`@${channel.username}: ${message}`);
      await this.channels.markError(channel.id, message).catch(() => undefined);
    } finally {
      this.busy.delete(channel.id);
    }
  }

  private async processChannel(channel: Channel): Promise<void> {
    await this.runExclusive(channel, (c) => (c.backfilledAt ? this.poller.poll(c) : this.backfiller.backfill(c)));
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const channels = (await this.channels.listActive()).filter((c) => c.source === 'web');
      const queue = [...channels];
      const workers = Array.from({ length: Math.min(this.config.CONCURRENCY, queue.length) }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await this.processChannel(c);
      });
      await Promise.all(workers);
    } catch (err) {
      this.logger.error('tick failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }
}
