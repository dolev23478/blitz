import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MessageEventsService } from '../events/message-events.service.js';
import { MessagesRepository } from '../messages/messages.repository.js';
import { ScraperService } from '../scraper/scraper.service.js';
import type { Channel } from '../types.js';

const MAX_PAGES = 500;

/** Historical collection of a web-preview channel. */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger('Backfill');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ScraperService) private readonly scraper: ScraperService,
    @Inject(ChannelsRepository) private readonly channels: ChannelsRepository,
    @Inject(MessagesRepository) private readonly messages: MessagesRepository,
    @Inject(MessageEventsService) private readonly events: MessageEventsService,
  ) {}

  /** Pages backward from the newest post until posts are older than BACKFILL_DAYS. */
  async backfill(channel: Channel, days = this.config.BACKFILL_DAYS): Promise<number> {
    const cutoff = Date.now() - days * 86_400_000;
    let before: number | undefined;
    let total = 0;
    let maxId: number | null = null;
    let title: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.scraper.fetchChannelPage(channel.username, before);
      title ??= result.title;
      const msgs = result.messages.filter((m) => m.postedAt.getTime() >= cutoff);
      if (result.messages.length === 0) break;

      maxId = Math.max(maxId ?? 0, ...result.messages.map((m) => m.messageId));
      const inserted = await this.messages.upsertMany(channel.id, msgs);
      total += inserted;
      if (inserted) this.events.emit({ channelId: channel.id, channel: channel.username, inserted, messages: msgs });

      const oldest = result.messages[0]!;
      if (oldest.postedAt.getTime() < cutoff || oldest.messageId <= 1) break;
      if (before !== undefined && oldest.messageId >= before) break; // no progress guard
      before = oldest.messageId;
    }

    await this.channels.markPolled(channel.id, maxId, title);
    await this.channels.markBackfilled(channel.id);
    this.logger.log(`@${channel.username}: ${total} new messages (${days}d)`);
    return total;
  }
}
