import { Injectable } from '@nestjs/common';
import type { ParsedMessage } from '../../types.js';
import { TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { reportId } from '../report-id.js';

@Injectable()
export class TelegramMappingStrategy {
  map(message: ParsedMessage, metadata: ReportMetadata): RawReportCandidate {
    if (!metadata.collectedAt)
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'The workflow must capture Telegram receipt time before mapping.',
      );
    const messageLanguage =
      'language' in message && typeof (message as { language?: unknown }).language === 'string'
        ? (message as { language?: string }).language?.trim()
        : undefined;
    const messageMatches =
      'matches' in message && Array.isArray((message as { matches?: unknown[] }).matches)
        ? (message as { matches?: string[] }).matches ?? []
        : undefined;
    return {
      report_id: reportId('telegram', message.url),
      platform: 'telegram',
      account_name: message.senderName ?? metadata.accountName ?? null,
      channel_name: metadata.channelName ?? null,
      report_url: message.url,
      media_type: [
        'text',
        ...new Set(message.media.map((media) => media.type)),
      ],
      report_title: null,
      content: message.text,
      language: messageLanguage || metadata.language,
      matches: messageMatches && messageMatches.length ? messageMatches : metadata.matches ?? [],
      published_at: message.postedAt,
      collected_at: metadata.collectedAt,
    };
  }
}
