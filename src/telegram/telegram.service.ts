import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { createClient, login } from '../tg-realtime/client.js';
import { createRedisStorage, fingerprint } from '../tg-realtime/redis-storage.js';
import type { Config as TgConfig } from '../tg-realtime/config.js';
import { startMessageListener } from '../tg-realtime/listeners/messageListener.js';
import { ExtractorService } from '../tg-realtime/services/extractorService.js';
import type { MessageDto } from '../tg-realtime/types.js';
import { sleepRandom, withFloodWait, FloodWaitTooLongError } from '../tg-realtime/utils/resilience.js';
import { Watchdog } from '../tg-realtime/utils/watchdog.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MessageEventsService, type NewMessagesEvent } from '../events/message-events.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SessionLock, SessionLockError, TELEGRAM_SESSION_LOCK_KEY } from './session-lock.js';
import { toParsedMessage } from './telegram.mapper.js';
import { TELEGRAM_CHANNELS, TELEGRAM_CURSOR_PREFIX, TELEGRAM_PEER_PREFIX, TELEGRAM_PEER_TTL_SECONDS } from './telegram-channels.js';

export type TelegramState = 'disabled' | 'connecting' | 'ready' | 'offline' | 'error';

export interface TelegramStatus {
  enabled: boolean;
  state: TelegramState;
  error: string | null;
  user: { id: number; name: string } | null;
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Pause between two channels of one pull cycle. */
const CHANNEL_PAUSE_MIN_MS = 1000;
const CHANNEL_PAUSE_MAX_MS = 3000;
/** Errors meaning the cached username -> id/access hash is no longer usable. */
const STALE_PEER = /not found in local cache|peer.*not found|CHANNEL_INVALID|PEER_ID_INVALID/i;

// Atomic forward-only write: the stored cursor is replaced only by a strictly later one (ISO dates compare lexicographically).
const ADVANCE_CURSOR_SCRIPT = `local cur = redis.call('get', KEYS[1])
if cur and cjson.decode(cur).date >= ARGV[2] then return 0 end
redis.call('set', KEYS[1], ARGV[1])
return 1`;

/** Resume point of one channel: the newest message that was handed over. */
interface TelegramCursor {
  channelId: number;
  channel: string;
  messageId: number;
  date: string;
}

/** Collects the monitored channels (TELEGRAM_CHANNELS) through the Telegram account (MTProto), headless via TG_SESSION_STRING. */
@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  private client: ReturnType<typeof createClient> | null = null;
  private extractor: ExtractorService | null = null;
  private watchdog: Watchdog | null = null;
  private readonly chatIds = new Set<number>(); // O(1) filter shared with the live listener
  private readonly usernameByChatId = new Map<number, string>();
  private readonly resolved = new Set<string>();
  /** Channels whose catch-up pull completed on this connection; only they may have their cursor moved by live messages. */
  private readonly caughtUp = new Set<number>();
  private lock: SessionLock | null = null;
  private lockLost = false;
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

  /** Takes the session lock first: a failure rejects here and aborts the application startup. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.acquireSessionLock();
    void this.start().catch((err) =>
      this.logger.error(`failed to start: ${err instanceof Error ? err.message : err}`),
    );
  }

  /** Stops the client first, then frees the lock (Redis is still open here) so a replacement instance can start at once. */
  async onModuleDestroy(): Promise<void> {
    this.lockLost = true; // no reconnects or renewals from now on
    await this.teardown();
    await this.lock?.release();
    this.lock = null;
  }

  /** Redis lock: the same session must never run in two places at once, so without a verifiable lock nothing starts. */
  private async acquireSessionLock(): Promise<void> {
    if (!this.config.REDIS_URL) {
      throw new SessionLockError('REDIS_URL is not set: cannot guarantee a single Telegram session; refusing to start');
    }
    if (!this.redis.isEnabled()) {
      throw new SessionLockError('Redis is unavailable, cannot guarantee a single Telegram session; refusing to start');
    }
    const lock = new SessionLock(this.redis);
    if (!(await lock.acquire())) {
      const holder = (await lock.holder().catch(() => null)) ?? 'unknown';
      throw new SessionLockError(
        `Telegram session lock (${TELEGRAM_SESSION_LOCK_KEY}) is held by ${holder}; another instance is using this session`,
      );
    }
    this.lock = lock;
    this.logger.log(`Telegram session lock acquired (${lock.token})`);
  }

  /** Watchdog heartbeat: keeps the lock alive and stops the collector when another instance took the session over. */
  private async renewSessionLock(): Promise<void> {
    if (!this.lock || this.lockLost) return;
    if (await this.lock.renew()) return;
    this.lockLost = true;
    this.state = 'error';
    this.lastError = 'Telegram session lock lost';
    this.logger.error('Telegram session lock lost; stopping the collector so the session is not used twice');
    await this.teardown();
    this.state = 'error';
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
    const normalized = { ...cursor, date: new Date(cursor.date).toISOString() };
    await this.redis
      .eval(ADVANCE_CURSOR_SCRIPT, [`${TELEGRAM_CURSOR_PREFIX}${cursor.channelId}`], [JSON.stringify(normalized), normalized.date])
      .catch((err) => this.logger.warn(`cannot save cursor of @${cursor.channel}: ${err instanceof Error ? err.message : String(err)}`));
  }

  /**
   * Handles one live message and, once the listener succeeded, advances that channel's cursor.
   * Skipped while the channel still has an unfinished catch-up: moving the cursor past messages that were
   * not pulled yet would turn a failed pull into a permanent gap.
   */
  private async handleLive(dto: MessageDto): Promise<void> {
    await this.publish(dto.chatId, [dto]);
    const channel = this.usernameByChatId.get(dto.chatId);
    if (!channel || this.pulling || !this.caughtUp.has(dto.chatId)) return;
    await this.saveCursor({ channelId: dto.chatId, channel, messageId: dto.messageId, date: dto.date });
  }

  /** Registers a resolved channel for pulling and live filtering. */
  private track(chatId: number, username: string): void {
    this.chatIds.add(chatId);
    this.usernameByChatId.set(chatId, username);
    this.resolved.add(username);
  }

  private async loadPeer(username: string): Promise<number | null> {
    if (!this.redis.isEnabled()) return null;
    try {
      const raw = await this.redis.get(`${TELEGRAM_PEER_PREFIX}${username.toLowerCase()}`);
      const id = raw ? (JSON.parse(raw) as { id?: unknown }).id : null;
      return Number.isInteger(id) ? (id as number) : null;
    } catch {
      return null;
    }
  }

  private async savePeer(username: string, chatId: number): Promise<void> {
    if (!this.redis.isEnabled()) return;
    await this.redis
      .setEx(`${TELEGRAM_PEER_PREFIX}${username.toLowerCase()}`, JSON.stringify({ id: chatId }), TELEGRAM_PEER_TTL_SECONDS)
      .catch(() => undefined);
  }

  /** Forgets a cached username -> id mapping so the next cycle resolves it from Telegram again. */
  private async invalidatePeer(chatId: number, username: string): Promise<void> {
    this.chatIds.delete(chatId);
    this.usernameByChatId.delete(chatId);
    this.resolved.delete(username);
    this.caughtUp.delete(chatId);
    if (this.redis.isEnabled()) await this.redis.del(`${TELEGRAM_PEER_PREFIX}${username.toLowerCase()}`).catch(() => undefined);
  }

  /**
   * Makes every channel known without hitting ResolveUsername more than needed: a username is resolved from Telegram
   * once, then served from Redis for 30 days (the access hash lives in the persisted mtcute peer cache).
   */
  private async resolveChannels(): Promise<void> {
    const c = this.client;
    if (!c) return;
    for (const username of TELEGRAM_CHANNELS) {
      if (this.resolved.has(username)) continue;
      const cached = await this.loadPeer(username);
      if (cached !== null) {
        this.logger.debug(`cache hit for @${username} -> ${cached}`);
        this.track(cached, username);
        continue;
      }
      this.logger.debug(`resolving @${username} via RPC`);
      try {
        const chat = await withFloodWait(() => c.getChat(username), {
          onWait: (s) => this.logger.warn(`Telegram flood wait of ${s}s while resolving @${username}`),
        });
        this.track(chat.id, username);
        await this.savePeer(username, chat.id);
      } catch (err) {
        if (err instanceof FloodWaitTooLongError) {
          this.logger.warn(`resolving channels paused: ${err.message}`);
          return;
        }
        this.logger.warn(`cannot resolve @${username}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleepRandom(1000, 2500);
    }
  }

  /** Live messages are best effort; the pull cursor is not moved by them, the next pull re-reads them and the listener dedupes. */
  private publish(chatId: number, dtos: MessageDto[]): Promise<void> {
    const channel = this.usernameByChatId.get(chatId);
    if (!channel || dtos.length === 0) return Promise.resolve();
    const ordered = [...dtos].sort((a, b) => a.messageId - b.messageId);
    return this.events.emit({
      channelId: chatId,
      channel,
      inserted: ordered.length,
      messages: ordered.map((dto) => toParsedMessage(dto, channel)),
      downloadPhoto: (messageId) => this.extractor?.downloadMessageMedia(chatId, messageId) ?? Promise.resolve(null),
    });
  }

  /**
   * Pulls one chat page by page, oldest first, from its saved resume time (24h fallback). The cursor is committed
   * after every page the listener handled, so a failure resumes at the last committed page. The pull ends as soon as
   * a page's newest message is not newer than the cursor: everything up to it was already processed. Returns true
   * when the chat is fully caught up.
   */
  private async pullChat(chatId: number): Promise<boolean> {
    const extractor = this.extractor;
    const channel = this.usernameByChatId.get(chatId);
    if (!extractor || !channel) return false;
    try {
      const cursor = await this.loadCursor(chatId);
      const cursorTime = cursor ? new Date(cursor.date).getTime() : null;
      const since = cursor ? new Date(cursor.date) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
      let pages = 0;
      let messages = 0;
      for await (const page of extractor.historyPages(chatId, since)) {
        const newest = page.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a));
        const newestTime = new Date(newest.date).getTime();
        if (cursorTime !== null && newestTime < cursorTime) break; // already processed
        // Inclusive on the cursor second (dates have 1s resolution); the listener's seen-claim drops the repeats.
        await this.publish(chatId, page);
        await this.saveCursor({ channelId: chatId, channel, messageId: newest.messageId, date: newest.date });
        pages++;
        messages += page.length;
        if (cursorTime !== null && newestTime === cursorTime) break; // nothing newer than the cursor exists
      }
      if (messages > 0) this.logger.log(`@${channel}: pulled ${messages} message(s) in ${pages} page(s)`);
      this.caughtUp.add(chatId);
      return true;
    } catch (err) {
      this.caughtUp.delete(chatId);
      if (err instanceof FloodWaitTooLongError) throw err; // stop the whole cycle, see pullAll
      if (err instanceof Error && STALE_PEER.test(err.message)) {
        this.logger.warn(`@${channel}: cached peer is unusable (${err.message}); it will be resolved again next cycle`);
        await this.invalidatePeer(chatId, channel);
        return false;
      }
      this.logger.error(`@${channel}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Pulls every resolved chat in order with a pause between channels, each from its own resume point. */
  private async pullAll(): Promise<void> {
    if (this.pulling) return;
    this.pulling = true;
    try {
      await this.resolveChannels();
      let ok = 0;
      let first = true;
      for (const id of [...this.chatIds]) {
        if (!first) await sleepRandom(CHANNEL_PAUSE_MIN_MS, CHANNEL_PAUSE_MAX_MS);
        first = false;
        if (await this.pullChat(id)) ok++;
      }
      this.logger.log(`pulled ${ok}/${this.chatIds.size} chat(s) from their saved resume points`);
    } catch (err) {
      if (!(err instanceof FloodWaitTooLongError)) throw err;
      this.logger.warn(`pull cycle stopped: ${err.message}; the next sync retries`);
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
      c = createClient(
        cfg,
        this.redis.isEnabled() ? createRedisStorage(this.redis, fingerprint(cfg.sessionString ?? ''), undefined, (m) => this.logger.debug(m)) : undefined,
      );
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
      (dto) =>
        this.handleLive(dto).catch((err) => {
          // A failed message must not be skipped by a later one moving the cursor: hold the cursor until the next pull succeeds.
          this.caughtUp.delete(dto.chatId);
          this.logger.error(`live message ${dto.chatId}/${dto.messageId} failed: ${err instanceof Error ? err.message : String(err)}`);
        }),
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
    this.caughtUp.clear();
    // Resume every channel from its saved cursor time (24h fallback) and re-pull what was missed while down.
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
      heartbeat: () => this.renewSessionLock(),
      log: (m) => this.logger.log(`watchdog: ${m}`),
    });
    this.watchdog.start();
  }

  /** Rebuilds the client from the session string, retrying with backoff until Telegram is reachable. */
  private async reconnectForever(): Promise<void> {
    await this.teardown();
    for (let delay = 5_000; !this.lockLost; delay = Math.min(delay * 2, 60_000)) {
      try {
        await this.connect();
        return;
      } catch (err) {
        this.logger.error(`reconnect failed, retrying in ${delay / 1000}s: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, delay));
        // The watchdog is stopped while we retry, so keep the lock alive here.
        await this.renewSessionLock();
      }
    }
  }
}
