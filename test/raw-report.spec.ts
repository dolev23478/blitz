import { describe, expect, it } from 'vitest';
import { reportId, toRawReport } from '../src/reports/raw-report.mapper.js';
import type { StoredMessage } from '../src/types.js';

const base: StoredMessage = {
  id: 1, channelId: 1, channel: 'blitz111222', channelTitle: 'Blitz', messageId: 7,
  postedAt: new Date('2026-01-01T10:00:00Z'), text: ' hello ', views: null, media: [], links: [],
  forwardedFrom: null, edited: false, url: 'https://t.me/blitz111222/7',
  fetchedAt: new Date('2026-01-01T10:00:05Z'), senderName: 'Dana',
};

describe('toRawReport', () => {
  it('maps a message to the contract', () => {
    const r = toRawReport({ ...base, media: [{ type: 'photo', url: '' }, { type: 'photo', url: '' }] });
    expect(r.ok && r.report).toMatchObject({
      schema_version: 1, is_official: false, platform: 'telegram', account_name: 'Dana',
      channel_name: 'Blitz', report_url: base.url, media_type: ['text', 'photo'], content: 'hello',
      language: null, matches: [], published_at: '2026-01-01T10:00:00.000Z', collected_at: '2026-01-01T10:00:05.000Z',
    });
  });

  it('falls back to the channel name when the sender is unknown', () => {
    const r = toRawReport({ ...base, senderName: null });
    expect(r.ok && r.report.account_name).toBe('Blitz');
  });

  it('rejects messages without content', () => {
    expect(toRawReport({ ...base, text: '  ' })).toEqual({ ok: false, reason: 'empty_content', reportUrl: base.url });
    expect(toRawReport({ ...base, text: null }).ok).toBe(false);
  });

  it('builds a stable positive int64 report_id that fits a JS safe integer', () => {
    const id = reportId('telegram', base.url);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(reportId('telegram', base.url)).toBe(id);
    expect(reportId('telegram', base.url + '1')).not.toBe(id);
  });
});
