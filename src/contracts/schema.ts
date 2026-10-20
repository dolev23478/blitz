import type { IS_OFFICIAL, SCHEMA_VERSION } from '../common/constants.js';

export type ReportMediaType = 'text' | 'photo' | 'video';

/** Provisional local report model until DE provides its JSON Schema. */
export interface RawReport {
  /** Non-negative signed-int32-compatible JSON integer. */
  report_id: number;
  schema_version: typeof SCHEMA_VERSION;
  is_official: typeof IS_OFFICIAL;
  platform: string;
  account_name: string | null;
  channel_name: string | null;
  report_url: string;
  media_type: ReportMediaType[];
  report_title: string | null;
  content: string;
  /** ISO 639-1 codes; missing collector language becomes an empty array. */
  languages: string[];
  categories: string[];
  matches: string[];
  published_at: string | null;
  collected_at: string;
}

/** Unvalidated mapping output: values may be missing or have the wrong type. */
export type RawReportCandidate = Partial<Record<keyof RawReport, unknown>> & {
  /** Accepted only before normalization, never on the Kafka wire. */
  language?: unknown;
};
