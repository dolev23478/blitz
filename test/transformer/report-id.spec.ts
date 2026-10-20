import { describe, expect, it } from 'vitest';
import { reportId } from '../../src/transformer/report-id.js';
import { normalizeReport } from '../../src/transformer/normalization.js';
describe('non-negative int32 report IDs', () => {
  it('keeps the deterministic identity for already non-negative hashes', () => {
    expect(
      reportId('twitter', 'https://x.com/AJEnglish/status/1847321098492019482'),
    ).toBe(3047412);
  });
  it('bounds previously negative hashes without changing Kafka numeric representation', () => {
    expect(
      reportId('twitter', 'https://x.com/AJArabic/status/1847318045123984120'),
    ).toBe(1260685280);
    for (let i = 0; i < 1000; i++) {
      const id = reportId('telegram', 'https://t.me/news/' + i);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(2147483647);
    }
  });
  it.each([0, 42, 2147483647])('preserves supplied contract ID %s', (id) => {
    expect(reportId('twitter', 'https://x.com/a/1', id)).toBe(id);
  });
  it.each([
    -1,
    2147483648,
    1.5,
    '123',
    null,
    NaN,
    Infinity,
    1847321098492019482n,
    9007199254740992,
  ])('rejects invalid supplied ID %s', (id) => {
    expect(() => reportId('twitter', 'https://x.com/a/1', id)).toThrow();
    expect(normalizeReport({ report_id: id }).report_id).toBe(id);
  });
});
