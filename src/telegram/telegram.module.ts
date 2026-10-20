import { Module } from '@nestjs/common';
import { StorageModule } from '../database/storage.module.js';
import { MediaController } from './media.controller.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramListenerService } from './telegram-listener.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerModule } from '../transformer/transformer.module.js';

@Module({
  imports: [StorageModule, TransformerModule],
  controllers: [TelegramController, MediaController],
  providers: [TelegramService, TelegramListenerService],
  exports: [TelegramService],
})
export class TelegramModule {}
