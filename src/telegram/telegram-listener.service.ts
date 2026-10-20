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
    const candidateLanguages = [...new Set([...supportedLanguages, ...LANGUAGE_ALIASES])]
      .map((language) => resolveLanguageAlias(language));
    const filteredMessages: Array<{ message: ParsedMessage; matchedLanguage: string; matches: string[] }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;

        const analysis = analyzeText(message.text, candidateLanguages);
        if (!analysis.matched || analysis.languages?.length === 0) {
          this.logger.log(`Telegram no match: channel=${event.channel}, text=${message.text.slice(0, 200)}`);
          this.analytics?.recordRejected({
            id: String(message.messageId ?? randomUUID()),
            channel: event.channel,
            source: 'telegram',
            content: message.text,
            reason: 'Keyword filter rejected: did not match any threat terms',
            attemptedLanguages: candidateLanguages,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        const matchedLanguages = analysis.languages?.length
          ? analysis.languages
          : [analysis.language].filter((l): l is string => Boolean(l));
        const matchedLanguage = matchedLanguages[0] ?? null;

        if (!matchedLanguage) {
          this.logger.log(`Telegram no match: channel=${event.channel}, text=${message.text.slice(0, 200)}`);
          this.analytics?.recordRejected({
            id: String(message.messageId ?? randomUUID()),
            channel: event.channel,
            source: 'telegram',
            content: message.text,
            reason: 'Keyword filter rejected: did not match any threat terms',
            attemptedLanguages: candidateLanguages,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

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
