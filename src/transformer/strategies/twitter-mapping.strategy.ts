import { Injectable } from '@nestjs/common';
import type { ProfileScrapeResult } from '../../x-scraper/contracts/x-scraper.interfaces.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { reportId } from '../report-id.js';

@Injectable()
export class TwitterMappingStrategy {
  map(
    result: ProfileScrapeResult,
    metadata: ReportMetadata,
  ): RawReportCandidate[] {
    return result.posts.map((post) => ({
      report_id: reportId('twitter', post.url),
      platform: 'twitter',
      account_name: post.authorHandle,
      channel_name: null,
      report_url: post.url,
      media_type: ['text', ...new Set(post.media.map((media) => media.type))],
      report_title: null,
      content: post.text,
      language: 'language' in post ? post.language : metadata.language,
      matches: metadata.matches ?? [],
      published_at: post.publishedAt,
      collected_at: result.scrapedAt,
    }));
  }
}
