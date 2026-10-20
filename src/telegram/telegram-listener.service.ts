import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import type { ParsedMessage } from '../types.js';

@Injectable()
export class TelegramListenerService {
  private readonly logger = new Logger(TelegramListenerService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
    private readonly transformer: TransformerWorkflow,
  ) {
    this.telegram.watchResults((event) => this.onTelegramResult(event));
  }

  /** Runs automatically every time Telegram emits a stored-message result. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    const now = new Date().toISOString();

    if (this.redis.isEnabled()) {
      await this.redis.set('telegram:last-scrape-at', now);
    }

    const filteredMessages: Array<{ message: ParsedMessage; matchedLanguage: string; matches: string[] }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;

        const analysis = analyzeText(message.text, 'auto');
        if (!analysis.matched) continue;

        const matchedLanguage = analysis.languages?.[0] ?? analysis.language ?? null;
        if (!matchedLanguage) continue;

        this.logger.log(
          `Telegram language match: lang=${matchedLanguage}, terms=${analysis.terms.join(', ') || 'none'}, text=${message.text.slice(0, 120)}`,
        );

        filteredMessages.push({
          message,
          matchedLanguage,
          matches: analysis.terms,
        });
      }
    }

    for (const item of filteredMessages) {
      await this.transformer.run('ParsedMessage', item.message, {
        language: item.matchedLanguage,
        matches: item.matches,
        channelName: event.channel,
        source: 'telegram',
      });
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}; saved timestamp=${now}`,
    );
  }
}
