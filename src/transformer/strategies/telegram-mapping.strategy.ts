import { Injectable } from '@nestjs/common';
import type { StoredMessage } from '../../types.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { reportId } from '../../reports/raw-report.mapper.js';

@Injectable()
export class TelegramMappingStrategy {
  map(message: StoredMessage, metadata: ReportMetadata): RawReportCandidate {
    return {
      report_id: String(reportId('telegram', message.url)),
      platform: 'telegram',
      account_name:
        message.senderName ?? message.channelTitle ?? message.channel,
      channel_name: message.channelTitle ?? message.channel,
      report_url: message.url,
      media_type: [
        'text',
        ...new Set(message.media.map((media) => media.type)),
      ],
      report_title: null,
      content: message.text,
      language: metadata.language,
      matches: metadata.matches ?? [],
      published_at: message.postedAt,
      collected_at: message.fetchedAt,
    };
  }
}
