import { Injectable } from '@nestjs/common';
import type { MessageDto } from '../../tg-realtime/types.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import { reportId } from '../report-id.js';

@Injectable()
export class TelegramRealtimeMappingStrategy {
  map(message: MessageDto, metadata: ReportMetadata): RawReportCandidate {
    if (!metadata.reportUrl || !metadata.collectedAt)
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'MessageDto requires reportUrl and collectedAt because they are absent from its JSON.',
      );
    return {
      report_id: reportId('telegram', metadata.reportUrl),
      platform: 'telegram',
      account_name: message.senderName ?? message.chatTitle,
      channel_name: message.chatTitle,
      report_url: metadata.reportUrl,
      media_type: message.media ? ['text', message.media.kind] : ['text'],
      report_title: null,
      content: message.text,
      language: 'language' in message ? message.language : metadata.language,
      matches: metadata.matches ?? [],
      published_at: message.date,
      collected_at: metadata.collectedAt,
    };
  }
}
