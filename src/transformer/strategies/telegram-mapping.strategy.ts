import { Injectable } from '@nestjs/common';
import type { ParsedMessage } from '../../types.js';
import { TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { collectorFields } from '../collector-fields.js';
import { reportMediaTypes } from '../media-types.js';

@Injectable()
export class TelegramMappingStrategy {
  map(message: ParsedMessage, metadata: ReportMetadata): RawReportCandidate {
    if (!metadata.collectedAt)
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'The workflow must capture Telegram receipt time before mapping.',
      );
    return {
      platform: 'telegram',
      account_name: message.senderName ?? metadata.accountName ?? null,
      channel_name: metadata.channelName ?? null,
      report_url: message.url,
      media_type: reportMediaTypes(message.media),
      report_title: null,
      content: message.text,
      ...collectorFields(message, metadata),
      matches:
        Array.isArray(message.matches) && message.matches.length
          ? message.matches
          : (metadata.matches ?? []),
      published_at: message.postedAt,
      collected_at: metadata.collectedAt,
    };
  }
}
