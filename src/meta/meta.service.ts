import { Inject, Injectable } from '@nestjs/common';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MessagesRepository, type MessageStats } from '../messages/messages.repository.js';

@Injectable()
export class MetaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChannelsRepository) private readonly channels: ChannelsRepository,
    @Inject(MessagesRepository) private readonly messages: MessagesRepository,
  ) {}

  health(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  async stats(): Promise<
    MessageStats & { channels: number; activeChannels: number; settings: { pollSeconds: number; backfillDays: number } }
  > {
    const [stats, channels] = await Promise.all([this.messages.stats(), this.channels.list()]);
    return {
      channels: channels.length,
      activeChannels: channels.filter((c) => c.active).length,
      ...stats,
      settings: { pollSeconds: this.config.POLL_SECONDS, backfillDays: this.config.BACKFILL_DAYS },
    };
  }
}
