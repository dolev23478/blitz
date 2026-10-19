import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';

@Injectable()
export class TelegramListenerService {
  private readonly logger = new Logger(TelegramListenerService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
  ) {
    this.telegram.watchResults((event) => this.onTelegramResult(event));
  }

  /** Runs automatically every time Telegram emits a stored-message result. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    const now = new Date().toISOString();

    if (this.redis.isEnabled()) {
      await this.redis.set('telegram:last-scrape-at', now);
    }

    this.logger.log(`telegram result: ${JSON.stringify(event)}; saved timestamp=${now}`);

    // Future hook: call your next function here.
    // await this.someOtherService.handleTelegramResult(event);
  }
}
