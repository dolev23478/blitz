import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import {
  radioTranscriptSchema,
  type RadioTranscript,
} from '../../radio/radio.types.js';
import { radioPublicBaseUrlSchema } from '../../radio/radio.config.js';
import { collectorFields } from '../collector-fields.js';
import { reportId } from '../report-id.js';

@Injectable()
export class RadioMappingStrategy {
  constructor(private readonly config: ConfigService) {}

  map(input: RadioTranscript, metadata: ReportMetadata): RawReportCandidate {
    const clip = radioTranscriptSchema.parse(input);
    const baseUrl =
      radioPublicBaseUrlSchema.parse(
        this.config.get<string>('RADIO_PUBLIC_BASE_URL'),
      ) ?? `http://localhost:${this.config.get<number>('PORT') ?? 3000}`;
    const reportUrl = `${baseUrl.replace(/\/+$/, '')}/api/radio/clips/${clip.clipId}`;
    return {
      report_id: reportId('internet_radio', reportUrl, clip.report_id),
      platform: 'internet_radio',
      account_name: clip.station.name,
      channel_name: clip.station.name,
      report_url: reportUrl,
      media_type: ['text'], // RAW_REPORT does not support the original audio attachment.
      report_title: clip.station.name,
      content: clip.text,
      ...collectorFields(clip, metadata),
      matches: clip.matches?.length ? clip.matches : (metadata.matches ?? []),
      // Capture time is observed locally, not the verified original broadcast time.
      published_at: null,
      collected_at: clip.endedAt,
    };
  }
}
