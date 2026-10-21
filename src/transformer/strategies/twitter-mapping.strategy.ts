import { Injectable } from '@nestjs/common';
import type { ProfileScrapeResult } from '../../x-scraper/contracts/x-scraper.interfaces.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { collectorFields } from '../collector-fields.js';
import { reportMediaTypes } from '../media-types.js';

@Injectable()
export class TwitterMappingStrategy {
  map(
    result: ProfileScrapeResult,
    metadata: ReportMetadata,
  ): RawReportCandidate[] {
    const batchFields = collectorFields(result, metadata);
    return result.posts.map((post) => ({
      platform: 'twitter',
      account_name: post.authorHandle,
      channel_name: null,
      report_url: post.url,
      media_type: reportMediaTypes(post.media),
      report_title: null,
      content: post.text,
      ...collectorFields(post, {
        ...batchFields,
        languages: post.matchedLanguage ?? batchFields.languages,
      }),
      matches:
        Array.isArray(post.matches) && post.matches.length
          ? post.matches
          : (metadata.matches ?? []),
      published_at: post.publishedAt,
      collected_at: result.scrapedAt,
    }));
  }
}
