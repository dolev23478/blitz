import { createHash } from 'node:crypto';
import type { StoredMessage } from '../types.js';

export const RAW_REPORT_SCHEMA_VERSION = 1;
const PLATFORM = 'telegram';

/** The `reports.raw` contract (RAW_REPORT). */
export interface RawReport {
  report_id: number;
  schema_version: number;
  is_official: boolean;
  platform: string;
  account_name: string;
  channel_name: string;
  report_url: string;
  media_type: string[];
  report_title: string | null;
  content: string;
  language: string | null;
  matches: string[];
  published_at: string | null;
  collected_at: string;
}

export type RawReportResult =
  | { ok: true; report: RawReport }
  | { ok: false; reason: 'empty_content'; reportUrl: string };

/**
 * int64 report id, deterministic from platform + URL so re-collecting a message never creates a duplicate.
 * Uses 53 bits (a valid int64 that JSON/JS can carry exactly); never 0, so never NULL-like.
 */
export function reportId(platform: string, reportUrl: string): number {
  const hash = createHash('sha256').update(`${platform}:${reportUrl}`).digest();
  const id = Number(hash.readBigUInt64BE(0) & ((1n << 53n) - 1n));
  return id === 0 ? 1 : id;
}

/** Maps a stored message to RAW_REPORT; a report without content is a contract violation (-> reports.dlq). */
export function toRawReport(m: StoredMessage): RawReportResult {
  const content = m.text?.trim() ?? '';
  if (!content) return { ok: false, reason: 'empty_content', reportUrl: m.url };

  const channelName = m.channelTitle ?? m.channel;
  const media = [...new Set(m.media.map((x) => x.type))];
  return {
    ok: true,
    report: {
      report_id: reportId(PLATFORM, m.url),
      schema_version: RAW_REPORT_SCHEMA_VERSION,
      is_official: false,
      platform: PLATFORM,
      account_name: m.senderName ?? channelName,
      channel_name: channelName,
      report_url: m.url,
      media_type: ['text', ...media],
      report_title: null,
      content,
      language: null,
      matches: [],
      published_at: new Date(m.postedAt).toISOString(),
      collected_at: new Date(m.fetchedAt).toISOString(),
    },
  };
}
