import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { IS_OFFICIAL, SCHEMA_VERSION } from '../common/constants.js';
import type { RawReportCandidate } from '../contracts/schema.js';

const ajv = new Ajv();
addFormats.default(ajv);
const validTimestamp = ajv.compile({ type: 'string', format: 'date-time' });

function utc(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (!validTimestamp(value)) throw new Error('Invalid collector timestamp.');
  return new Date(value as string).toISOString();
}

/** Wrap a scalar code, preserving array entries for validation without filtering them. */
function languageCodes(value: unknown): unknown {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    const code = value.trim();
    return code ? [code] : [];
  }
  return value;
}

/** Normalize collector values to the report's wire types. */
export function normalizeReport(
  candidate: RawReportCandidate,
): RawReportCandidate {
  let content = candidate.content;
  if (typeof content === 'string') {
    content = content.normalize('NFC').trim();
  }

  return {
    ...candidate,
    schema_version: SCHEMA_VERSION,
    is_official: IS_OFFICIAL,
    account_name: candidate.account_name ?? null,
    channel_name: candidate.channel_name ?? null,
    report_title:
      typeof candidate.report_title === 'string'
        ? candidate.report_title.trim() || null
        : (candidate.report_title ?? null),
    content,
    language: languageCodes(candidate.language),
    media_type:
      typeof candidate.media_type === 'string'
        ? [candidate.media_type]
        : candidate.media_type,
    published_at: utc(candidate.published_at ?? null),
    collected_at: utc(candidate.collected_at),
    // report_url and matches retain the collector's values.
  };
}
