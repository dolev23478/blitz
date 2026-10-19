import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { TelegramService } from './telegram.service.js';

@Injectable()
export class TelegramListenerService {
  private readonly logger = new Logger(TelegramListenerService.name);

  constructor(private readonly telegram: TelegramService) {
    this.telegram.watchResults((event) => this.onTelegramResult(event));
  }

  /** Runs automatically every time Telegram emits a stored-message result. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    this.logger.log(`telegram result: ${JSON.stringify(event)}`);

    // Call your next function here:
    // await this.someOtherService.handleTelegramResult(event);
  }
}
