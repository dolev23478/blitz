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
import { TELEGRAM_CHANNELS, TELEGRAM_CURSOR_PREFIX } from './telegram-channels.js';

export type TelegramState = 'disabled' | 'connecting' | 'ready' | 'offline' | 'error';

export interface TelegramStatus {
  enabled: boolean;
  state: TelegramState;
  error: string | null;
  user: { id: number; name: string } | null;
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Resume point of one channel: the newest message that was handed over. */
interface TelegramCursor {
  channelId: number;
  channel: string;
  messageId: number;
  date: string;
}

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
    return this.events.subscribe(async (event) => {
      try {
        await callback(event);
      } catch (err) {
        this.logger.error(`telegram result callback failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
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

  /** Last processed message of a channel (id + time) from Redis, or null when none was saved yet. */
  private async loadCursor(chatId: number): Promise<TelegramCursor | null> {
    if (!this.redis.isEnabled()) return null;
    try {
      const raw = await this.redis.get(`${TELEGRAM_CURSOR_PREFIX}${chatId}`);
      const cursor = raw ? (JSON.parse(raw) as TelegramCursor) : null;
      return cursor && !Number.isNaN(new Date(cursor.date).getTime()) ? cursor : null;
    } catch {
      return null;
    }
  }

  private async saveCursor(cursor: TelegramCursor): Promise<void> {
    if (!this.redis.isEnabled()) return;
    await this.redis.set(`${TELEGRAM_CURSOR_PREFIX}${cursor.channelId}`, JSON.stringify(cursor)).catch(() => undefined);
  }

  /** Resolves every not-yet-resolved username to its chat id and starts tracking it. */
  private async resolveChannels(): Promise<void> {
    const c = this.client;
    if (!c) return;
    for (const username of TELEGRAM_CHANNELS) {
      if (this.resolved.has(username)) continue;
      try {
        const chat = await withFloodWait(() => c.getChat(username), {
          onWait: (s) => this.logger.warn(`Telegram flood wait: sleeping ${s}s while resolving @${username}`),
        });
        this.chatIds.add(chat.id);
        this.usernameByChatId.set(chat.id, username);
        this.resolved.add(username);
      } catch (err) {
        this.logger.warn(`cannot resolve @${username}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleepRandom(300, 800);
    }
  }

  /** Live messages are best effort; the pull cursor is not moved by them, the next pull re-reads them and the listener dedupes. */
  private publish(chatId: number, dtos: MessageDto[]): Promise<void> {
    const channel = this.usernameByChatId.get(chatId);
    if (!channel || dtos.length === 0) return Promise.resolve();
    const ordered = [...dtos].sort((a, b) => a.messageId - b.messageId);
    return this.events.emit({ channelId: chatId, channel, inserted: ordered.length, messages: ordered.map((dto) => toParsedMessage(dto, channel)) });
  }

  /**
   * Pulls one chat from its saved resume time (messages posted at or after it), or from the last 24h when it has none.
   * The point advances to the newest pulled message only after the listener handled the whole batch; true when it completed.
   */
  private async pullChat(chatId: number): Promise<boolean> {
    const extractor = this.extractor;
    const channel = this.usernameByChatId.get(chatId);
    if (!extractor || !channel) return false;
    try {
      const cursor = await this.loadCursor(chatId);
      const since = cursor ? new Date(cursor.date) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
      // Inclusive on the cursor time (dates have 1s resolution); the listener's seen-claim drops the repeats.
      const dtos = await extractor.getHistory(chatId, since);
      if (dtos.length === 0) return true;
      await this.publish(chatId, dtos);
      const newest = dtos.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a));
      await this.saveCursor({ channelId: chatId, channel, messageId: newest.messageId, date: newest.date });
      return true;
    } catch (err) {
      this.logger.error(`@${channel}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Pulls every resolved chat in order, each from its own resume point. */
  private async pullAll(): Promise<void> {
    if (this.pulling) return;
    this.pulling = true;
    try {
      await this.resolveChannels();
      let ok = 0;
      for (const id of this.chatIds) if (await this.pullChat(id)) ok++;
      this.logger.log(`pulled ${ok}/${this.chatIds.size} chat(s) from their saved resume points`);
    } finally {
      this.pulling = false;
    }
  }

  /** Safety net in case live push stalls silently: re-pull from the saved resume points. */
  private async catchUp(): Promise<void> {
    await this.pullAll();
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
    startMessageListener(
      c,
      this.chatIds,
      (dto) => this.publish(dto.chatId, [dto]),
      (msg) => {
        const username = TELEGRAM_CHANNELS.find((u) => u.toLowerCase() === msg.chat.username?.toLowerCase());
        if (!username) return false;
        this.chatIds.add(msg.chat.id);
        this.usernameByChatId.set(msg.chat.id, username);
        this.resolved.add(username);
        return true;
      },
    );

    this.chatIds.clear();
    this.usernameByChatId.clear();
    this.resolved.clear();
    // Resume every channel from its saved message id (24h fallback) and re-pull what was missed while down.
    this.logger.log('recovering missed messages from the saved per-channel resume points');
    void this.pullAll().catch((err) =>
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
