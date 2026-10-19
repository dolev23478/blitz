import { Module } from '@nestjs/common';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { MessagesRepository } from '../messages/messages.repository.js';

/** Data-access layer shared by the collector, Telegram source and API modules (keeps their dependencies acyclic). */
@Module({
  providers: [ChannelsRepository, MessagesRepository],
  exports: [ChannelsRepository, MessagesRepository],
})
export class StorageModule {}
