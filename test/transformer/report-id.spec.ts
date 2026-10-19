import { describe, expect, it } from 'vitest';
import { reportId } from '../../src/transformer/report-id.js';
import { normalizeReport } from '../../src/transformer/normalization.js';

describe('Transformer signed int32 identity', () => {
  it('produces deterministic numeric IDs for unchanged source identities', () => {
    const url = 'https://x.com/AJEnglish/status/1847321098492019482';
    expect(reportId('twitter', url)).toBe(3047412);
    expect(reportId('twitter', url)).toBe(reportId('twitter', url));
  });

  it('uses the full signed range, including negative IDs', () => {
    const id = reportId(
      'twitter',
      'https://x.com/AJArabic/status/1847318045123984120',
    );
    expect(id).toBe(-886798368);
    expect(JSON.parse(JSON.stringify({ report_id: id })).report_id).toBe(id);
  });

  it.each([2147483648, -2147483649, 1.5, '123'])(
    'does not silently truncate, round or coerce an invalid ID (%s) during normalization',
    (id) => {
      expect(normalizeReport({ report_id: id }).report_id).toBe(id);
    },
  );
});
