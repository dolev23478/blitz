import { Module } from '@nestjs/common';
import { StorageModule } from '../database/storage.module.js';
import { ScraperModule } from '../scraper/scraper.module.js';
import { BackfillService } from './backfill.service.js';
import { CollectorService } from './collector.service.js';
import { PollerService } from './poller.service.js';

@Module({
  imports: [StorageModule, ScraperModule],
  providers: [PollerService, BackfillService, CollectorService],
  exports: [CollectorService],
})
export class CollectorModule {}
