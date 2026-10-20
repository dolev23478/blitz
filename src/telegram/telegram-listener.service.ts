import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { analyzeText } from '../text-analyzer.js';
import { TelegramService } from './telegram.service.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';

@Injectable()
export class TelegramListenerService {
  private readonly logger = new Logger(TelegramListenerService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly transformer: TransformerWorkflow,
  ) {
    this.telegram.watchResults((event) => this.onTelegramResult(event));
  }

  /** Filters collected messages by dictionary language match and forwards the matches to the transformer. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    const supportedLanguages = getDictionaryStore().languages();
    let matched = 0;

    for (const message of event.messages) {
      if (!message.text?.trim()) continue;

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
      if (!matchedLanguage) continue;
      matched++;

      await this.transformer.run('ParsedMessage', message, {
        language: matchedLanguage,
        matches: [matchedLanguage],
        channelName: event.channel,
        source: 'telegram',
      });
    }

    this.logger.log(`telegram result: channel=${event.channel}, received=${event.messages.length}, matched=${matched}`);
  }
}
