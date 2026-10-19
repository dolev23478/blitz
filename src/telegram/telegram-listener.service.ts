import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';

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
    const filteredMessages: Array<{ chatId: number; messageId: number; text: string; matchedLanguage?: string }> = [];

    if (Array.isArray((event as any).messages) && (event as any).messages.length > 0) {
      for (const message of (event as any).messages) {
        if (!message || !message.text || !message.text.trim()) continue;

        let matchedLanguage: string | null = null;
        for (const language of supportedLanguages) {
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
        }
      }
    }

    for (const message of filteredMessages) {
      const dto = {
        chatId: message.chatId,
        chatTitle: event.channel,
        messageId: message.messageId,
        date: new Date().toISOString(),
        editDate: null,
        isEdit: false,
        senderId: null,
        senderName: null,
        text: message.text,
        metrics: { views: null, forwards: null, reactions: [], commentsCount: null },
        media: null,
      };

      await this.transformer.run('MessageDto', dto as any, {
        language: message.matchedLanguage,
        matches: message.matchedLanguage ? [message.matchedLanguage] : [],
        reportUrl: `https://telegram/${event.channelId}/${message.messageId}`,
        collectedAt: new Date().toISOString(),
        source: 'telegram',
      } as any);
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}; saved timestamp=${now}`,
    );
  }
}
