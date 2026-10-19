import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeReport } from '../../src/transformer/normalization.js';
import { ValidationProcessor } from '../../src/transformer/processors/validation.processor.js';
import { context, rawReport } from './fixtures.js';

let validator: ValidationProcessor;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  validator = new ValidationProcessor(new ConfigService());
});
afterEach(() => vi.restoreAllMocks());

async function validate(overrides: Record<string, unknown>) {
  const ctx = context();
  ctx.candidates = [{ ...rawReport(), ...overrides }];
  await validator.execute(ctx);
  return ctx.reports![0]!;
}

describe('provisional RAW_REPORT validation', () => {
  it.each(['9223372036854775807', '-9223372036854775808', '0'])(
    'preserves signed int64 ID %s exactly without numeric conversion',
    async (report_id) => {
      expect((await validate({ report_id })).report_id).toBe(report_id);
    },
  );

  it.each([
    { report_id: '9223372036854775808' },
    { report_id: '-9223372036854775809' },
    { report_id: '123.5' },
    { report_id: '001' },
    { report_id: 9007199254740992 },
    { content: '' },
    { content: ' \n ' },
    { content: '<p>raw HTML</p>' },
    { language: null },
    { language: 'zz' },
    { language: 'eng' },
    { report_url: 'not a URL' },
    { collected_at: null },
    { collected_at: 'yesterday' },
    { collected_at: '2026-10-19T10:00:00+03:00' },
    { is_official: true },
    { schema_version: 1 },
    { matches: ['valid', 1] },
    { media_type: 'photo' },
  ])('rejects contract-invalid fields (%j)', async (fields) => {
    await expect(validate(fields)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('accepts nullable optional report fields', async () => {
    const report = await validate({
      account_name: null,
      channel_name: null,
      report_title: null,
      published_at: null,
    });
    expect(report.published_at).toBeNull();
  });

  it('does not invent collection timestamps or language', () => {
    const result = normalizeReport({ content: 'text' });
    expect(result.collected_at).toBeUndefined();
    expect(result.language).toBeUndefined();
  });

  it('forces Blitz-owned fixed fields during normalization', () => {
    const result = normalizeReport({
      ...rawReport(),
      is_official: true,
      schema_version: 'untrusted',
    });
    expect(result.is_official).toBe(false);
    expect(result.schema_version).toBe('1.0.0');
  });

  it('rejects invalid source timestamps instead of generating a replacement', () => {
    expect(() => normalizeReport({ collected_at: 'yesterday' })).toThrow();
    expect(() =>
      normalizeReport({ collected_at: new Date('invalid') }),
    ).toThrow();
  });
});
