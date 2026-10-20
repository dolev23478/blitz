import { Injectable, Logger } from '@nestjs/common';
import type { NewMessagesEvent } from '../events/message-events.service.js';
import { detectDictionaryMatch } from '../match/detect-dictionary.js';
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

  /** Filters collected messages by dictionary match and forwards the matches to the transformer. */
  private async onTelegramResult(event: NewMessagesEvent): Promise<void> {
    let matched = 0;

    for (const message of event.messages) {
      if (!message.text?.trim()) continue;

      const detection = detectDictionaryMatch(message.text);
      if (!detection) continue;
      this.logger.log(
        `Telegram language match: lang=${detection.language}, terms=${detection.terms.join(', ') || 'none'}, text=${message.text.slice(0, 120)}`,
      );
      matched++;

      await this.transformer.run('ParsedMessage', message, {
        language: detection.language,
        matches: [detection.language],
        channelName: event.channel,
        source: 'telegram',
      });
    }

    this.logger.log(`telegram result: channel=${event.channel}, received=${event.messages.length}, matched=${matched}`);
  }
}
