import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'cheerio';
import { IS_OFFICIAL, SCHEMA_VERSION } from '../../common/constants.js';
import type { RawReportCandidate } from '../../contracts/schema.js';

const ajv = new Ajv();
addFormats.default(ajv);
const validTimestamp = ajv.compile({ type: 'string', format: 'date-time' });

function utc(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (!validTimestamp(value)) throw new Error('Invalid collector timestamp.');
  return new Date(value as string).toISOString();
}

/** Convert representations without inventing collection times, IDs or language. */
export function normalizeReport(
  candidate: RawReportCandidate,
): RawReportCandidate {
  let reportId = candidate.report_id;
  if (typeof reportId === 'number') {
    if (!Number.isSafeInteger(reportId)) throw new Error('Unsafe report ID.');
    reportId = String(reportId);
  }

  let content = candidate.content;
  if (typeof content === 'string') {
    const document = load(content);
    document('script, style, template, noscript').remove();
    document('br').replaceWith('\n');
    document('p, div, li').append('\n');
    content = document.root().text().normalize('NFC').trim();
  }

  return {
    ...candidate,
    report_id: reportId,
    schema_version: SCHEMA_VERSION,
    is_official: IS_OFFICIAL,
    account_name: candidate.account_name ?? null,
    channel_name: candidate.channel_name ?? null,
    report_title:
      typeof candidate.report_title === 'string'
        ? candidate.report_title.trim() || null
        : (candidate.report_title ?? null),
    content,
    media_type:
      typeof candidate.media_type === 'string'
        ? [candidate.media_type]
        : candidate.media_type,
    published_at: utc(candidate.published_at ?? null),
    collected_at: utc(candidate.collected_at),
    // report_url, language and matches retain the collector's values.
  };
}
