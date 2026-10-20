import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { LANGUAGE_ALIASES, resolveLanguageAlias } from '../normalize/registry.js';
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

    const supportedLanguages = getDictionaryStore().languages();
    const candidateLanguages = [...new Set([...supportedLanguages, ...LANGUAGE_ALIASES])]
      .map((language) => resolveLanguageAlias(language));
    const filteredMessages: Array<ParsedMessage & { matchedLanguage?: string; matches?: string[] }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;

        const analysis = analyzeText(message.text, candidateLanguages);
        if (!analysis.matched || analysis.languages?.length === 0) continue;

        const matchedLanguages = analysis.languages?.length
          ? analysis.languages
          : [analysis.language].filter(Boolean);
        const matchedLanguage = matchedLanguages[0] ?? null;

        if (!matchedLanguage) continue;

        this.logger.log(
          `Telegram language match: lang=${matchedLanguage}, terms=${analysis.terms.join(', ') || 'none'}, text=${message.text.slice(0, 120)}`,
        );

        filteredMessages.push({
          ...message,
          matchedLanguage,
          matches: analysis.terms,
        });
      }
    }

    for (const message of filteredMessages) {
      await this.transformer.run('ParsedMessage', message, {
        language: message.matchedLanguage,
        matches: message.matches ?? [],
        channelName: event.channel,
        source: 'telegram',
      });
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}; saved timestamp=${now}`,
    );
  }
}
