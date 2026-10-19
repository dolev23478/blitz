import { Module } from '@nestjs/common';
import { StorageModule } from '../database/storage.module.js';
import { MediaController } from './media.controller.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

@Module({
  imports: [StorageModule],
  controllers: [TelegramController, MediaController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
