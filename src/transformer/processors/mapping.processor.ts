import { Injectable } from '@nestjs/common';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { ProfileScrapeResult } from '../../x-scraper/contracts/x-scraper.interfaces.js';
import type { ParsedMessage } from '../../types.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import type { TransformContext } from '../transformer.types.js';
import { normalizeReport } from '../normalization.js';
import { TwitterMappingStrategy } from '../strategies/twitter-mapping.strategy.js';
import { TelegramMappingStrategy } from '../strategies/telegram-mapping.strategy.js';

@Injectable()
export class MappingProcessor {
  readonly stage = State.Mapping;

  constructor(
    private readonly twitter: TwitterMappingStrategy,
    private readonly telegram: TelegramMappingStrategy,
  ) {}

  async execute(context: TransformContext): Promise<void> {
    const { input, metadata } = context;
    try {
      let candidates: RawReportCandidate[];
      switch (context.format) {
        case 'ProfileScrapeResult':
          candidates = this.twitter.map(input as ProfileScrapeResult, metadata);
          break;
        case 'ParsedMessage':
          candidates = [this.telegram.map(input as ParsedMessage, metadata)];
          break;
        default:
          throw new TransformerException(
            TransformerErrorCode.UnsupportedFormat,
            'Unsupported collector JSON format.',
          );
      }
      context.candidates = candidates.map(normalizeReport);
    } catch (error) {
      if (error instanceof TransformerException) throw error;
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'Collector JSON mapping or normalization failed.',
      );
    }
  }
}
