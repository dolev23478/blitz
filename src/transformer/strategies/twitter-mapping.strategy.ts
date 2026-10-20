import { Injectable } from '@nestjs/common';
import type { ProfileScrapeResult } from '../../x-scraper/contracts/x-scraper.interfaces.js';
import type { ReportMetadata } from '../../contracts/mappings.js';
import type { RawReportCandidate } from '../../contracts/schema.js';
import { reportId } from '../report-id.js';
import { collectorFields } from '../collector-fields.js';
import { reportMediaTypes } from '../media-types.js';

@Injectable()
export class TwitterMappingStrategy {
  map(
    result: ProfileScrapeResult,
    metadata: ReportMetadata,
  ): RawReportCandidate[] {
    return result.posts.map((post) => ({
      report_id: reportId('twitter', post.url, post.report_id),
      platform: 'twitter',
      account_name: post.authorHandle,
      channel_name: null,
      report_url: post.url,
      media_type: reportMediaTypes(post.media),
      report_title: null,
      content: post.text,
<<<<<<< HEAD
      ...collectorFields(post, {
        languages: metadata.languages ?? metadata.language,
        categories: metadata.categories,
      }),
      matches:
        Array.isArray(post.matches) && post.matches.length
          ? post.matches
          : metadata.matches ?? [],
=======
      language:
        (typeof post.language === 'string' && post.language.trim()) ||
        (typeof post.matchedLanguage === 'string' && post.matchedLanguage.trim()) ||
        metadata.language,
      matches: Array.isArray(post.matches) && post.matches.length
        ? post.matches
        : metadata.matches ?? [],
>>>>>>> d98d5b0edd8c2cf00136ae015c27ee1facd6f801
      published_at: post.publishedAt,
      collected_at: result.scrapedAt,
    }));
  }
}
