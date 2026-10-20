import { Injectable } from '@nestjs/common';
import { State } from '../common/enums.js';
import type { TransformContext } from '../transformer/transformer.types.js';
import type { PublishedMessage, RawReport } from './types.js';

/**
 * Replaces ONLY Yoav's PublishingProcessor in local runs: it records the key and value that
 * PublishingProcessor.send would put on reports.raw (`String(report_id)`, `JSON.stringify(report)`)
 * and sends nothing. Every other transformer step is the real one.
 */
@Injectable()
export class LocalPublishingProcessor {
  readonly stage = State.Publishing;
  private recorded: PublishedMessage[] = [];

  async execute(context: TransformContext): Promise<void> {
    if (!context.reports)
      throw new Error('Validation must produce reports before publishing.');
    for (const report of context.reports) {
      this.recorded.push({
        key: String(report.report_id),
        json: JSON.stringify(report),
        report,
        confirmed: false,
      });
    }
    // CompletionProcessor requires every report to be "published"; here that means recorded locally.
    context.publishedReports = [...context.reports];
  }

  /** Messages recorded since the last call. */
  take(): PublishedMessage[] {
    const out = this.recorded;
    this.recorded = [];
    return out;
  }
}

/** Field order as in schemas.html (19.10.2026). There is no `reality_id` in RAW_REPORT. */
export const RAW_REPORT_FIELDS = [
  'report_id',
  'schema_version',
  'is_official',
  'platform',
  'account_name',
  'channel_name',
  'report_url',
  'media_type',
  'report_title',
  'content',
  'language',
  'matches',
  'published_at',
  'collected_at',
] as const;

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const MEDIA = new Set(['text', 'photo', 'video']);
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;

/**
 * Compares a published RAW_REPORT with the field list in schemas.html (19.10.2026). The transformer
 * already validated it against its own provisional schema; this only reports where the two differ.
 * It is NOT validation against the DE JSON Schema, which is not in this repo.
 */
export function contractGaps(report: RawReport): string[] {
  const r = report as unknown as Record<string, unknown>;
  const gaps: string[] = [];
  const isStr = (v: unknown) => typeof v === 'string';
  const isIso = (v: unknown) =>
    isStr(v) &&
    ISO_UTC.test(v as string) &&
    !Number.isNaN(Date.parse(v as string));

  for (const f of RAW_REPORT_FIELDS) if (!(f in r)) gaps.push(`${f}: missing`);
  for (const f of Object.keys(r)) {
    if (!(RAW_REPORT_FIELDS as readonly string[]).includes(f))
      gaps.push(`${f}: not a RAW_REPORT field`);
  }
  const id = r.report_id;
  if (typeof id === 'bigint') {
    if (id < INT64_MIN || id > INT64_MAX) gaps.push('report_id: outside int64');
  } else if (!Number.isSafeInteger(id)) {
    gaps.push('report_id: must be an int64 integer that JSON carries exactly');
  }
  if (!Number.isInteger(r.schema_version))
    gaps.push(
      `schema_version: contract is an integer major version, got ${JSON.stringify(r.schema_version)}`,
    );
  if (r.is_official !== false)
    gaps.push('is_official: must be false for BLITZ');
  for (const f of ['platform', 'report_url'] as const)
    if (!isStr(r[f]) || !(r[f] as string))
      gaps.push(`${f}: non-empty string required`);
  for (const f of ['account_name', 'channel_name'] as const)
    if (!isStr(r[f]))
      gaps.push(`${f}: contract type is string, got ${JSON.stringify(r[f])}`);
  const media = r.media_type;
  if (
    !Array.isArray(media) ||
    media.length === 0 ||
    !media.every((m) => MEDIA.has(m as string))
  ) {
    gaps.push(
      `media_type: only text, photo, video, got ${JSON.stringify(media)}`,
    );
  }
  if (r.report_title !== null && !isStr(r.report_title))
    gaps.push('report_title: string or null');
  if (!isStr(r.content) || (r.content as string).trim() === '')
    gaps.push('content: required, never empty');
  else if (HTML_TAG.test(r.content as string))
    gaps.push('content: looks like HTML, must be parsed text');
  if (!isStr(r.language) || !/^[a-z]{2}$/.test(r.language as string))
    gaps.push(
      `language: ISO 639-1 code required, got ${JSON.stringify(r.language)}`,
    );
  if (!Array.isArray(r.matches) || !r.matches.every(isStr))
    gaps.push('matches: array of strings');
  if (r.published_at !== null && !isIso(r.published_at))
    gaps.push('published_at: ISO 8601 UTC or null');
  if (!isIso(r.collected_at)) gaps.push('collected_at: ISO 8601 UTC required');
  return gaps;
}
