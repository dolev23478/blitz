import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createClient, login } from '../tg-realtime/client.js';
import type { Config as TgConfig } from '../tg-realtime/config.js';
import { startMessageListener } from '../tg-realtime/listeners/messageListener.js';
import { ExtractorService } from '../tg-realtime/services/extractorService.js';
import type { MessageDto } from '../tg-realtime/types.js';
import { sleepRandom, withFloodWait } from '../tg-realtime/utils/resilience.js';
import { Watchdog } from '../tg-realtime/utils/watchdog.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MessageEventsService, type NewMessagesEvent } from '../events/message-events.service.js';
import { RedisService } from '../redis/redis.service.js';
import { toParsedMessage } from './telegram.mapper.js';
import { TELEGRAM_CHANNELS, TELEGRAM_CURSOR_KEY } from './telegram-channels.js';

export type TelegramState = 'disabled' | 'connecting' | 'ready' | 'offline' | 'error';

export interface TelegramStatus {
  enabled: boolean;
  state: TelegramState;
  error: string | null;
  user: { id: number; name: string } | null;
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CURSOR_OVERLAP_MS = 60_000;

/** Collects the monitored channels (TELEGRAM_CHANNELS) through the Telegram account (MTProto), headless via TG_SESSION_STRING. */
@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Telegram');
  private client: ReturnType<typeof createClient> | null = null;
  private extractor: ExtractorService | null = null;
  private watchdog: Watchdog | null = null;
  private readonly chatIds = new Set<number>(); // O(1) filter shared with the live listener
  private readonly usernameByChatId = new Map<number, string>();
  private readonly resolved = new Set<string>();
  private pulling = false;
  private state: TelegramState;
  private lastError: string | null = null;
  private me: { id: number; name: string } | null = null;
  readonly enabled: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MessageEventsService) private readonly events: MessageEventsService,
    private readonly redis: RedisService,
  ) {
    this.enabled = Boolean(config.TG_API_ID && config.TG_API_HASH);
    this.state = this.enabled ? 'connecting' : 'disabled';
  }

  status(): TelegramStatus {
    return {
      enabled: this.enabled,
      state: this.state,
      error: this.lastError,
      user: this.state === 'ready' ? this.me : null,
    };
  }

  /** Subscribes once and calls the callback whenever Telegram delivers new messages. */
  watchResults(callback: (event: NewMessagesEvent) => void | Promise<void>): () => void {
    return this.events.subscribe((event) => {
      void Promise.resolve(callback(event)).catch((err) => {
        this.logger.error(`telegram result callback failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  /** Connects once; a missing/invalid session string is logged, network errors are retried in the background. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void this.start().catch((err) =>
      this.logger.error(`failed to start: ${err instanceof Error ? err.message : err}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.teardown();
  }

  async start(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      if (err instanceof Error && /TG_SESSION_STRING/.test(err.message)) throw err;
      this.logger.error(
        `initial connect failed, retrying in the background: ${err instanceof Error ? err.message : err}`,
      );
      void this.reconnectForever();
    }
  }

  /** Last successful pull time from Redis (same key semantics as X's x:last-scrape-at); 24h ago if missing. */
  private async recoverSince(): Promise<Date> {
    const fallback = new Date(Date.now() - DEFAULT_LOOKBACK_MS);
    if (!this.redis.isEnabled()) return fallback;
    const saved = await this.redis.get(TELEGRAM_CURSOR_KEY).catch(() => null);
    const parsed = saved ? new Date(saved) : fallback;
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private async saveCursor(at: number): Promise<void> {
    if (!this.redis.isEnabled()) return;
    await this.redis.set(TELEGRAM_CURSOR_KEY, new Date(at).toISOString()).catch(() => undefined);
  }

  /** Resolves every not-yet-resolved username to its chat id and starts tracking it. */
  private async resolveChannels(): Promise<void> {
    const c = this.client;
    if (!c) return;
    for (const username of TELEGRAM_CHANNELS) {
      if (this.resolved.has(username)) continue;
      try {
        const chat = await withFloodWait(() => c.getChat(username));
        this.chatIds.add(chat.id);
        this.usernameByChatId.set(chat.id, username);
        this.resolved.add(username);
      } catch (err) {
        this.logger.warn(`cannot resolve @${username}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleepRandom(300, 800);
    }
  }

  private publish(chatId: number, dtos: MessageDto[]): void {
    const channel = this.usernameByChatId.get(chatId);
    if (!channel || dtos.length === 0) return;
    const ordered = [...dtos].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    this.events.emit({ channelId: chatId, channel, inserted: ordered.length, messages: ordered.map((dto) => toParsedMessage(dto, channel)) });
  }

  /** Pulls one chat's history since the given time; true when it completed. */
  private async pullChat(chatId: number, since: Date): Promise<boolean> {
    if (!this.extractor) return false;
    try {
      this.publish(chatId, await this.extractor.getHistory(chatId, since));
      return true;
    } catch (err) {
      this.logger.error(`@${this.usernameByChatId.get(chatId)}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Pulls every resolved chat since `since`; the Redis cursor only advances when every pull succeeded. */
  private async pullSince(since: Date): Promise<void> {
    if (this.pulling) return;
    this.pulling = true;
    try {
      const startedAt = Date.now();
      await this.resolveChannels();
      const results: boolean[] = [];
      for (const id of this.chatIds) results.push(await this.pullChat(id, since));
      this.logger.log(`pulled ${results.length} chat(s) since ${since.toISOString()}`);
      if (results.every(Boolean)) await this.saveCursor(startedAt);
    } finally {
      this.pulling = false;
    }
  }

  /** Safety net in case live push stalls silently: re-pull from the saved cursor. */
  private async catchUp(): Promise<void> {
    await this.pullSince(new Date((await this.recoverSince()).getTime() - CURSOR_OVERLAP_MS));
  }

  private async teardown(): Promise<void> {
    this.watchdog?.stop();
    this.watchdog = null;
    const c = this.client;
    this.client = null;
    this.extractor = null;
    this.state = this.enabled ? 'connecting' : 'disabled';
    await c?.destroy().catch(() => undefined);
  }

  /** Logs in headlessly with TG_SESSION_STRING, goes live and arms the watchdog. */
  private async connect(): Promise<void> {
    this.state = 'connecting';
    this.lastError = null;
    const cfg: TgConfig = {
      apiId: this.config.TG_API_ID!,
      apiHash: this.config.TG_API_HASH!,
      sessionString: this.config.TG_SESSION_STRING ?? '',
      targets: [],
      scanDelayMinMs: 1500,
      scanDelayMaxMs: 3000,
    };
    let c: ReturnType<typeof createClient> | null = null;
    let me: { id: number; name: string };
    try {
      c = createClient(cfg);
      me = await login(c, cfg);
    } catch (err) {
      await c?.destroy().catch(() => undefined);
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
    this.me = me;
    this.logger.log(`logged in as ${me.name}`);
    c.onConnectionState.add((s) => this.logger.log(`connection: ${s}`));

    this.client = c;
    this.extractor = new ExtractorService(c, cfg);
    startMessageListener(c, this.chatIds, (dto) => this.publish(dto.chatId, [dto]));

    this.chatIds.clear();
    this.usernameByChatId.clear();
    this.resolved.clear();
    // Resume from the saved cursor (24h fallback) and re-pull everything missed while down.
    const since = new Date((await this.recoverSince()).getTime() - CURSOR_OVERLAP_MS);
    this.logger.log(`recovering missed messages since ${since.toISOString()}`);
    void this.pullSince(since).catch((err) =>
      this.logger.error(`initial pull failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    this.state = 'ready';

    const client = c;
    this.watchdog = new Watchdog({
      intervalMs: this.config.TG_WATCHDOG_SECONDS * 1000,
      syncEveryMs: this.config.TG_SYNC_SECONDS * 1000,
      probe: () => client.call({ _: 'updates.getState' }),
      soft: async () => {
        await client.stopUpdatesLoop();
        await client.startUpdatesLoop();
      },
      hard: () => this.reconnectForever(),
      sync: () => this.catchUp(),
      log: (m) => this.logger.log(`watchdog: ${m}`),
    });
    this.watchdog.start();
  }

  /** Rebuilds the client from the session string, retrying with backoff until Telegram is reachable. */
  private async reconnectForever(): Promise<void> {
    await this.teardown();
    for (let delay = 5_000; ; delay = Math.min(delay * 2, 60_000)) {
      try {
        await this.connect();
        return;
      } catch (err) {
        this.logger.error(`reconnect failed, retrying in ${delay / 1000}s: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
