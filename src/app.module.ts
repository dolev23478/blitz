import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ChannelsModule } from './channels/channels.module.js';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import { CollectorModule } from './collector/collector.module.js';
import { AppConfigModule } from './config/index.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { MetaModule } from './meta/meta.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { RedisModule } from './redis/redis.module.js';
import { XScraperModule } from './x-scraper/x-scraper.module.js';
import { XScraperCronService } from './x-scraper/x-scraper.cron.service.js';
import { TransformerModule } from './transformer/transformer.module.js';
import { KafkaAnalyticsModule } from './analytics/kafka-analytics.module.js';

@Module({
  imports: [
    AppConfigModule, DatabaseModule, RedisModule, EventsModule,
    CollectorModule, TelegramModule, ChannelsModule, MessagesModule, MetaModule, ReportsModule,
    XScraperModule,
    TransformerModule,
    KafkaAnalyticsModule,
  ],
  providers: [
    XScraperCronService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
