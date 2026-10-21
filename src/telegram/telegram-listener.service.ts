import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { analyzeText } from '../text-analyzer.js';
import { RedisService } from '../redis/redis.service.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
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
    const filteredMessages: Array<{
      message: ParsedMessage;
      matchedLanguage: string;
      matches: string[];
      categories: string[];
    }> = [];

    if (event.messages?.length) {
      for (const message of event.messages) {
        if (!message || !message.text || !message.text.trim()) continue;
        if (!(await this.claim(event.channel, message))) continue;

        const analysis = analyzeText(message.text, 'auto');
        if (!analysis.matched) continue;

        const matchedLanguage = analysis.languages?.[0] ?? analysis.language ?? null;
        if (!matchedLanguage) continue;

        this.logger.log(
          `Telegram language match: lang=${matchedLanguage}, terms=${analysis.terms.join(', ') || 'none'}, categories=${analysis.categories.join(', ') || 'none'}, text=${message.text.slice(0, 120)}`,
        );

        filteredMessages.push({
          message,
          matchedLanguage,
          matches: analysis.terms,
          categories: analysis.categories,
        });
      }
    }

    if (!filteredMessages.length) {
      this.logger.log(
        `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=0`,
      );
      return;
    }

    let failed = 0;
    for (const item of filteredMessages) {
      try {
        await this.transformer.run('ParsedMessage', item.message, {
          language: item.matchedLanguage,
          matches: item.matches,
          categories: item.categories,
          channelName: event.channel,
          accountName: event.channel,
          source: 'telegram',
        });
      } catch (err) {
        failed++;
        // Free the claim so the next pull retries this message; keep going with the rest.
        await this.release(event.channel, item.message);
        this.logger.error(
          `Telegram message failed: ${item.message.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `telegram result: channel=${event.channel}, inserted=${event.inserted}, matched=${filteredMessages.length}, failed=${failed}`,
    );
    if (failed) throw new Error(`${failed} Telegram message(s) failed to publish on ${event.channel}.`);
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
