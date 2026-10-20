import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { LANGUAGE_ALIASES, resolveLanguageAlias } from '../normalize/registry.js';
import type { ParsedMessage } from '../types.js';
import { KafkaAnalyticsService } from '../analytics/kafka-analytics.service.js';

@Injectable()
export class TelegramListenerService {
  private readonly logger = new Logger(TelegramListenerService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
    private readonly transformer: TransformerWorkflow,
    @Optional() private readonly analytics?: KafkaAnalyticsService,
  ) {
    this.telegram.watchResults((event) => this.onTelegramResult(event));
  }

  /** Runs automatically every time Telegram emits a stored-message result. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    const now = new Date().toISOString();

    if (this.redis.isEnabled()) {
      await this.redis.set('telegram:last-scrape-at', now);
    }

    const supportedLanguages = getDictionaryStore().languages();
    const aliasAwareLanguages = [...new Set([...supportedLanguages, ...LANGUAGE_ALIASES])]
      .map((language) => resolveLanguageAlias(language));
    const filteredMessages: Array<ParsedMessage & { matchedLanguage?: string; language?: string }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;

        let matchedLanguage: string | null = null;
        for (const language of aliasAwareLanguages) {
          const analysis = analyzeText(message.text, language);
          if (analysis.matched) {
            matchedLanguage = language;
            this.logger.log(
              `Telegram language match: lang=${language}, terms=${analysis.terms.join(', ') || 'none'}, text=${message.text.slice(0, 120)}`,
            );
            break;
          }
        }

        if (matchedLanguage) {
          filteredMessages.push({
            ...message,
            matchedLanguage,
            language: matchedLanguage,
          });
        } else {
          this.analytics?.recordRejected({
            id: String(message.messageId ?? randomUUID()),
            channel: event.channel,
            source: 'telegram',
            content: message.text,
            reason: 'Keyword filter rejected: did not match any threat terms',
            attemptedLanguages: aliasAwareLanguages,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    for (const message of filteredMessages) {
      await this.transformer.run('ParsedMessage', message, {
        language: message.matchedLanguage,
        matches: message.matchedLanguage ? [message.matchedLanguage] : [],
        channelName: event.channel,
        source: 'telegram',
      });
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}; saved timestamp=${now}`,
    );
  }
}
