import { Injectable } from '@nestjs/common';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import {
  radioTranscriptSchema,
  type RadioTranscript,
} from '../../radio/radio.types.js';
import { collectorFields } from '../collector-fields.js';
import { RADIO_PLATFORM } from '../../common/constants.js';

@Injectable()
export class RadioMappingStrategy {
  map(input: RadioTranscript, metadata: ReportMetadata): RawReportCandidate {
    const clip = radioTranscriptSchema.parse(input);
    // The fragment identifies this observation without changing the stream request.
    const separator = clip.station.streamUrl.includes('#') ? '&' : '#';
    const reportUrl = `${clip.station.streamUrl}${separator}clip=${clip.clipId}`;
    return {
      platform: RADIO_PLATFORM,
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
