import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createClient, login } from '../tg-realtime/client.js';
import type { Config as TgConfig } from '../tg-realtime/config.js';
import { startMessageListener } from '../tg-realtime/listeners/messageListener.js';
import { ExtractorService } from '../tg-realtime/services/extractorService.js';
import type { MessageDto } from '../tg-realtime/types.js';
import { withFloodWait } from '../tg-realtime/utils/resilience.js';
import { Watchdog } from '../tg-realtime/utils/watchdog.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MessageEventsService } from '../events/message-events.service.js';
import { MessagesRepository } from '../messages/messages.repository.js';
import type { Channel } from '../types.js';
import { privateLinkId, toParsedMessage } from './telegram.mapper.js';

export class TelegramSourceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type TelegramState = 'disabled' | 'connecting' | 'ready' | 'error';

export interface TelegramStatus {
  enabled: boolean;
  state: TelegramState;
  error: string | null;
  user: { id: number; name: string } | null;
}

/** Collects groups / private chats through the Telegram account (MTProto), headless via TG_SESSION_STRING. */
@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Telegram');
  private client: ReturnType<typeof createClient> | null = null;
  private extractor: ExtractorService | null = null;
  private watchdog: Watchdog | null = null;
  private readonly chatIds = new Set<number>(); // O(1) filter shared with the live listener
  private readonly byChatId = new Map<number, Channel>();
  private readonly backfilling = new Set<number>();
  private readonly mediaCache = new Map<string, { data: Uint8Array; mimeType: string | null }>();
  private state: TelegramState;
  private lastError: string | null = null;
  private me: { id: number; name: string } | null = null;
  private lastSyncAt = Date.now();
  readonly enabled: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChannelsRepository) private readonly channels: ChannelsRepository,
    @Inject(MessagesRepository) private readonly messages: MessagesRepository,
    @Inject(MessageEventsService) private readonly events: MessageEventsService,
  ) {
    this.enabled = Boolean(config.TG_API_ID && config.TG_API_HASH);
    this.state = this.enabled ? 'connecting' : 'disabled';
  }

  get ready(): boolean {
    return this.client !== null && this.extractor !== null;
  }

  status(): TelegramStatus {
    return { enabled: this.enabled, state: this.state, error: this.lastError, user: this.state === 'ready' ? this.me : null };
  }

  isBusy(id: number): boolean {
    return this.backfilling.has(id);
  }

  /** Connects once; a missing/invalid session string is logged, network errors are retried in the background. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void this.start().catch((err) => this.logger.error(`failed to start: ${err instanceof Error ? err.message : err}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.teardown();
  }

  async start(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      if (err instanceof Error && /TG_SESSION_STRING/.test(err.message)) throw err;
      this.logger.error(`initial connect failed, retrying in the background: ${err instanceof Error ? err.message : err}`);
      void this.reconnectForever();
    }
  }

  /** Resolves a username / numeric id / link with the account, stores it and starts collecting. */
  async addChannel(ref: string | number): Promise<Channel> {
    const c = this.client;
    if (!c || !this.extractor) throw new TelegramSourceError('Telegram account is not connected', 503);
    let chat;
    try {
      chat = await withFloodWait(() => c.getChat(ref));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new TelegramSourceError(
        `Cannot access ${ref} with the Telegram account (join the chat first): ${reason}`, 422,
      );
    }
    const existing = await this.channels.getByTgChatId(chat.id);
    if (existing) throw new TelegramSourceError(`Chat ${chat.id} already exists`, 409);

    const priv = privateLinkId(chat.id);
    const label = chat.username ?? (priv ? `c${priv}` : `g${Math.abs(chat.id)}`);
    const channel = await this.channels.createTelegram(chat.id, label.toLowerCase(), chat.displayName ?? null);
    this.track(channel);
    void this.runBackfill(channel, new Date(Date.now() - this.config.BACKFILL_DAYS * 86_400_000));
    return channel;
  }

  /** Re-pulls history through the account; false if not connected or already running. */
  backfill(channel: Channel, days = this.config.BACKFILL_DAYS): boolean {
    if (!this.ready || this.backfilling.has(channel.id)) return false;
    void this.runBackfill(channel, new Date(Date.now() - days * 86_400_000));
    return true;
  }

  /** Downloads a message's media through the account, with a small in-memory cache (Telegram files are immutable). */
  async downloadMedia(channelId: number, messageId: number): Promise<{ data: Uint8Array; mimeType: string | null }> {
    const key = `${channelId}:${messageId}`;
    const cached = this.mediaCache.get(key);
    if (cached) return cached;
    if (!this.extractor) throw new TelegramSourceError('Telegram account is not connected', 503);
    const channel = await this.channels.get(channelId);
    if (!channel || channel.tgChatId === null) throw new TelegramSourceError('Media not found', 404);
    const file = await this.extractor.downloadMessageMedia(channel.tgChatId, messageId);
    if (!file) throw new TelegramSourceError('Media not found', 404);
    this.mediaCache.set(key, file);
    if (this.mediaCache.size > 50) this.mediaCache.delete(this.mediaCache.keys().next().value!);
    return file;
  }

  untrack(channel: Channel): void {
    if (channel.tgChatId === null) return;
    this.chatIds.delete(channel.tgChatId);
    this.byChatId.delete(channel.tgChatId);
  }

  private async store(channel: Channel, dtos: MessageDto[]): Promise<number> {
    const inserted = await this.messages.upsertMany(channel.id, dtos.map((d) => toParsedMessage(d, channel)));
    if (dtos.length) {
      const maxId = Math.max(...dtos.map((d) => d.messageId));
      await this.channels.markPolled(channel.id, maxId, null);
    }
    if (inserted) this.events.emit({ channelId: channel.id, channel: channel.username, inserted });
    return inserted;
  }

  private track(channel: Channel): void {
    if (channel.tgChatId === null) return;
    this.chatIds.add(channel.tgChatId);
    this.byChatId.set(channel.tgChatId, channel);
  }

  private async runBackfill(channel: Channel, since: Date, quiet = false): Promise<void> {
    if (!this.extractor || channel.tgChatId === null || this.backfilling.has(channel.id)) return;
    this.backfilling.add(channel.id);
    try {
      const dtos = await this.extractor.getHistory(channel.tgChatId, since);
      const inserted = await this.store(channel, dtos);
      await this.channels.markBackfilled(channel.id);
      if (!quiet || inserted) this.logger.log(`${channel.username}: ${inserted} new messages since ${since.toISOString()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`${channel.username}: ${message}`);
      await this.channels.markError(channel.id, message).catch(() => undefined);
    } finally {
      this.backfilling.delete(channel.id);
    }
  }

  /** Pulls recent history of every tracked chat; fills anything the live push missed. */
  private async catchUp(): Promise<void> {
    const since = new Date(this.lastSyncAt - 120_000);
    this.lastSyncAt = Date.now();
    for (const channel of [...this.byChatId.values()]) await this.runBackfill(channel, since, true);
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
    startMessageListener(c, this.chatIds, async (dto) => {
      const channel = this.byChatId.get(dto.chatId);
      if (channel) await this.store(channel, [dto]);
    });

    this.chatIds.clear();
    this.byChatId.clear();
    for (const channel of await this.channels.listTelegram()) {
      this.track(channel);
      // Catch up on anything missed while the service was offline.
      const since = channel.lastPolledAt
        ? new Date(new Date(channel.lastPolledAt).getTime() - 60_000)
        : new Date(Date.now() - this.config.BACKFILL_DAYS * 86_400_000);
      void this.runBackfill(channel, since);
    }
    this.lastSyncAt = Date.now();
    this.state = 'ready';
    this.logger.log(`live: tracking ${this.chatIds.size} chat(s)`);

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
