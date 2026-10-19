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
  it.each([-2147483648, -1, 0, 1, 2147483647])(
    'preserves signed int32 ID %s as a JSON number',
    async (report_id) => {
      expect((await validate({ report_id })).report_id).toBe(report_id);
    },
  );

  it.each([
    { report_id: 2147483648 },
    { report_id: -2147483649 },
    { report_id: 1.5 },
    { report_id: '123' },
    { report_id: null },
    { report_id: undefined },
    { report_id: NaN },
    { report_id: Infinity },
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

  it('rejects bigint IDs because the contract requires a JSON number', async () => {
    await expect(validate({ report_id: 2147483647n })).rejects.toMatchObject({
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

  it('keeps missing collection timestamps and defaults missing language to unknown', () => {
    const result = normalizeReport({ content: 'text' });
    expect(result.collected_at).toBeUndefined();
    expect(result.language).toBe('unknown');
  });

  it('accepts the explicit unknown-language marker', async () => {
    expect((await validate({ language: 'unknown' })).language).toBe('unknown');
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
