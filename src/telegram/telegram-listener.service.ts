import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { LANGUAGE_ALIASES, resolveLanguageAlias } from '../normalize/registry.js';
import type { ParsedMessage } from '../types.js';

/** Longer than the pull overlap and the sync interval, so re-pulled messages are always recognised. */
const SEEN_TTL_SECONDS = 2 * 24 * 60 * 60;

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

  /** Runs automatically every time Telegram emits a stored-message result. The pull cursor is owned by TelegramService only. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    const supportedLanguages = getDictionaryStore().languages();
    const candidateLanguages = [...new Set([...supportedLanguages, ...LANGUAGE_ALIASES])]
      .map((language) => resolveLanguageAlias(language));
    const filteredMessages: Array<{ message: ParsedMessage; matchedLanguage: string; matches: string[] }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;
        if (!(await this.claim(event.channel, message))) continue;
        const analysis = analyzeText(message.text, candidateLanguages);
        if (!analysis.matched || analysis.languages?.length === 0) {
          this.logger.log(`Telegram no match: channel=${event.channel}, text=${message.text.slice(0, 200)}`);
          continue;
        }

        const matchedLanguages = analysis.languages?.length
          ? analysis.languages
          : [analysis.language].filter(Boolean);
        const matchedLanguage = matchedLanguages[0] ?? null;

        if (!matchedLanguage) {
          this.logger.log(`Telegram no match: channel=${event.channel}, text=${message.text.slice(0, 200)}`);
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
      try {
        await this.transformer.run('ParsedMessage', item.message, {
          language: item.matchedLanguage,
          matches: item.matches,
          channelName: event.channel,
          accountName: event.channel,
          source: 'telegram',
        });
      } catch (err) {
        await this.release(event.channel, item.message);
        throw err;
      }
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}`,
    );
  }

  private seenKey(channel: string, message: ParsedMessage): string {
    return `telegram:seen:${channel}:${message.messageId}:${message.edited ? 'e' : 'n'}`;
  }

  /** Claims a message in Redis so overlapping pulls and live updates never publish it twice; true when it is new. */
  private async claim(channel: string, message: ParsedMessage): Promise<boolean> {
    if (!this.redis.isEnabled()) return true;
    try {
      return await this.redis.setIfAbsent(this.seenKey(channel, message), '1', SEEN_TTL_SECONDS);
    } catch {
      return true;
    }
  }

  /** Frees the claim when publishing failed, so the next pull retries the message. */
  private async release(channel: string, message: ParsedMessage): Promise<void> {
    if (this.redis.isEnabled()) await this.redis.del(this.seenKey(channel, message)).catch(() => undefined);
  }
}
