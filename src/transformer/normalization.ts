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

/** Normalize aliases once; legacy language must never survive into the wire object. */
export function normalizeReport(
  candidate: RawReportCandidate,
): RawReportCandidate {
  const { language, ...report } = candidate;
  const incomingLanguages =
    candidate.languages !== undefined ? candidate.languages : language;
  const languages =
    typeof incomingLanguages === 'string'
      ? incomingLanguages.trim()
        ? [incomingLanguages.trim()]
        : []
      : (incomingLanguages ?? []);
  let content = candidate.content;
  if (typeof content === 'string') {
    content = content.normalize('NFC').trim();
  }

  return {
    ...report,
    schema_version: SCHEMA_VERSION,
    is_official: IS_OFFICIAL,
    account_name: candidate.account_name ?? null,
    channel_name: candidate.channel_name ?? null,
    report_title:
      typeof candidate.report_title === 'string'
        ? candidate.report_title.trim() || null
        : (candidate.report_title ?? null),
    content,
    languages,
    categories: candidate.categories ?? [],
    media_type:
      typeof candidate.media_type === 'string'
        ? [candidate.media_type]
        : candidate.media_type,
    published_at: utc(candidate.published_at ?? null),
    collected_at: utc(candidate.collected_at),
    // report_url and matches retain the collector's values.
  };
}
