import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { MessageEventsService } from '../events/message-events.service.js';
import { MessagesRepository } from '../messages/messages.repository.js';
import { ScraperService } from '../scraper/scraper.service.js';
import type { Channel, ParsedMessage } from '../types.js';

const MAX_CATCHUP_PAGES = 20;

/** Incremental collection of a web-preview channel. */
@Injectable()
export class PollerService {
  private readonly logger = new Logger('Poller');

  constructor(
    @Inject(ScraperService) private readonly scraper: ScraperService,
    @Inject(ChannelsRepository) private readonly channels: ChannelsRepository,
    @Inject(MessagesRepository) private readonly messages: MessagesRepository,
    @Inject(MessageEventsService) private readonly events: MessageEventsService,
  ) {}

  /**
   * Fetches the newest page and keeps paging back until it reaches the last stored message,
   * so bursts of posts between polls aren't missed. Also refreshes views/edits on the latest page.
   */
  async poll(channel: Channel): Promise<number> {
    const lastId = channel.lastMessageId ?? 0;
    const fresh: ParsedMessage[] = [];
    let known: ParsedMessage[] = [];
    let title: string | null = null;
    let before: number | undefined;

    for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
      const result = await this.scraper.fetchChannelPage(channel.username, before);
      title ??= result.title;
      if (result.messages.length === 0) break;
      fresh.push(...result.messages.filter((m) => m.messageId > lastId));
      if (page === 0) known = result.messages.filter((m) => m.messageId <= lastId);

      const oldestId = result.messages[0]!.messageId;
      if (oldestId <= lastId + 1 || (before !== undefined && oldestId >= before)) break;
      before = oldestId;
    }

    await this.messages.refreshMany(channel.id, known);
    const inserted = await this.messages.upsertMany(channel.id, fresh);
    const maxId = fresh.length ? Math.max(...fresh.map((m) => m.messageId)) : null;
    await this.channels.markPolled(channel.id, maxId, title);
    if (inserted) {
      this.events.emit({ channelId: channel.id, channel: channel.username, inserted, messages: fresh });
      this.logger.log(`@${channel.username}: ${inserted} new`);
    }
    return inserted;
  }
}
