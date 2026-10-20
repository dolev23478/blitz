import type { IS_OFFICIAL, SCHEMA_VERSION } from '../common/constants.js';

/** Provisional local report model until DE provides its JSON Schema. */
export interface RawReport {
  /** Signed int32, emitted as a JSON number. */
  report_id: number;
  schema_version: typeof SCHEMA_VERSION;
  is_official: typeof IS_OFFICIAL;
  platform: string;
  account_name: string | null;
  channel_name: string | null;
  report_url: string;
  media_type: string[];
  report_title: string | null;
  content: string;
  /** Collector ISO 639-1 codes; empty when no language was supplied. */
  language: string[];
  matches: string[];
  published_at: string | null;
  collected_at: string;
}

/** Unvalidated mapping output: values may be missing or have the wrong type. */
export type RawReportCandidate = Partial<Record<keyof RawReport, unknown>>;
