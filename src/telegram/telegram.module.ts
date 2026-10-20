import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { TransformerModule } from '../transformer/transformer.module.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramListenerService } from './telegram-listener.service.js';
import { TelegramService } from './telegram.service.js';

@Module({
  imports: [EventsModule, TransformerModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramListenerService],
  exports: [TelegramService],
})
export class TelegramModule {}
