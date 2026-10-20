/**
 * Types for the sample-posts tool. It replaces only the collection step: each sample is a
 * collector's own output object, fed into the same components the collectors feed.
 */
import type { RawReport } from '../contracts/schema.js';
import type { StoredMessage } from '../types.js';
import type { ProfileScrapeResult } from '../x-scraper/contracts/x-scraper.interfaces.js';

/**
 * Collector formats the transformer accepts (`MappingFormat`). `MessageDto` (Telegram realtime)
 * also needs reportUrl/collectedAt options and is not covered by the samples yet.
 */
export type SampleFormat = 'StoredMessage' | 'ProfileScrapeResult';

/** JSON form of the collector objects: dates are ISO strings, as they arrive over JSON. */
export type SamplePost = StoredMessage | ProfileScrapeResult;

/** What a sample is expected to do. Kept apart from `post` and never fed into the pipeline. */
export interface SampleExpectation {
  /** `failed`: a component is expected to reject the post (e.g. transformer validation). */
  outcome: 'processed' | 'filtered' | 'duplicate' | 'failed';
  language?: string;
  matchesInclude?: string[];
}

export interface Sample {
  id: string;
  tags: string[];
  note?: string;
  format: SampleFormat;
  post: SamplePost;
  expect?: SampleExpectation;
}

export type { RawReport };

/** One message as it would be (local) or was (Kafka) published to reports.raw. */
export interface PublishedMessage {
  key: string;
  /** Known locally. With --publish the transformer returns only the report id. */
  json?: string;
  report?: RawReport;
  /** Kafka acknowledged the send (always false locally, where nothing is sent). */
  confirmed: boolean;
}

export type PostOutcome =
  | { status: 'filtered'; language: string; matches: string[] }
  | {
      status: 'processed';
      language: string;
      matches: string[];
      published: PublishedMessage[];
      /** Differences from the RAW_REPORT field list in schemas.html (19.10.2026). */
      contractGaps: string[];
    }
  | { status: 'failed'; stage: string; error: string };

/** Leonid (missing in dev): one ISO 639-1 code for the post, also for mixed-language text. */
export type LanguageDetector = (text: string) => string | Promise<string>;

/** The entry the collectors call (Gal, missing in dev). */
export interface PostPipeline {
  process(sample: Sample): Promise<PostOutcome>;
}

export type ComponentSource = 'team' | 'stand-in' | 'missing';
export type ComponentName =
  | 'integration'
  | 'language'
  | 'filter'
  | 'dictionary'
  | 'transformer'
  | 'dedup'
  | 'publisher';
