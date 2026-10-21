import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import { AppConfigModule } from './config/index.js';
import { EventsModule } from './events/events.module.js';
import { MetaModule } from './meta/meta.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { RedisModule } from './redis/redis.module.js';
import { XScraperModule } from './x-scraper/x-scraper.module.js';
import { XScraperCronService } from './x-scraper/x-scraper.cron.service.js';
import { TransformerModule } from './transformer/transformer.module.js';
import { RadioTransformerModule } from './radio/radio-transformer.module.js';
import { MediaModule } from './media/media.module.js';

@Module({
  imports: [
    AppConfigModule, RedisModule, MediaModule, EventsModule, TelegramModule, MetaModule,
    XScraperModule,
    TransformerModule,
    RadioTransformerModule,
  ],
  providers: [
    XScraperCronService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
