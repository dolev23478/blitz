import { Module } from '@nestjs/common';
import { CollectorModule } from '../collector/collector.module.js';
import { StorageModule } from '../database/storage.module.js';
import { ScraperModule } from '../scraper/scraper.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';

@Module({
  imports: [StorageModule, CollectorModule, ScraperModule, TelegramModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
