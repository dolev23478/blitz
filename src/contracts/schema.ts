import type { IS_OFFICIAL, SCHEMA_VERSION } from '../common/constants.js';
import type { UtcTimestamp } from '../common/utils.js';

export interface RawReport<TReportId extends string | number> {
  readonly report_id: TReportId;

  // Default values.
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly is_official: typeof IS_OFFICIAL;

  // Free text
  readonly platform: string;

  // Local nullable placeholder
  readonly account_name: string | null;
  readonly channel_name: string | null;

  readonly report_url: string;

  // Examples include text/photo/video; the final allowed values are unconfirmed.
  readonly media_type: readonly string[];

  // Null when no title exists.
  readonly report_title: string | null;

  // Required non-empty parsed text, never HTML;
  readonly content: string;

  // Collector-provided ISO 639-1 language code;
  readonly language: string;

  // Preserve the collector's trigger keywords.
  readonly matches: readonly string[];

  readonly published_at: UtcTimestamp | null;
  readonly collected_at: UtcTimestamp;
}

/** Internal target model; its string ID is not yet an approved wire contract. */
export type NormalizedRawReport = RawReport<string>;

export type RawReportField = keyof NormalizedRawReport;

/** Mapping output is untrusted and may be incomplete or incorrectly typed. */
export type RawReportCandidate = Readonly<
  Partial<Record<RawReportField, unknown>>
>;

/** Both identities participate in dedup; no hashing/retention policy is chosen. */
export type ReportIdentity = Pick<
  NormalizedRawReport,
  'report_id' | 'platform' | 'report_url'
>;
