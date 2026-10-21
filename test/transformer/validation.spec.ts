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
describe('provisional updated RAW_REPORT validation', () => {
  it.each([0, 1, 42, 2147483647, -1, '123'])(
    'rejects candidate containing report_id %s because report_id is omitted from schema',
    async (report_id) => {
      await expect(validate({ report_id })).rejects.toThrow();
    },
  );
  it.each([
    { content: '' },
    { content: ' ' },
    { content: '<p>HTML</p>' },
    { languages: null },
    { languages: 'en' },
    { languages: ['en', 'zz'] },
    { languages: ['en', 42] },
    { languages: ['EN'] },
    { languages: ['eng'] },
    { languages: ['unknown'] },
    { languages: ['iw'] },
    { language: 'en' },
    { categories: undefined },
    { categories: 'news' },
    { categories: ['news', 42] },
    { report_url: 'invalid' },
    { collected_at: null },
    { collected_at: 'yesterday' },
    { is_official: true },
    { schema_version: '1.0.0' },
    { schema_version: '1' },
    { schema_version: 2 },
    { media_type: ['text', 'audio'] },
    { media_type: ['gif'] },
    { media_type: ['document'] },
    { matches: ['news', 42] },
  ])('rejects invalid wire case %#', async (fields) => {
    await expect(validate(fields)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
  it('accepts multiple languages, categories and only supported media', async () => {
    const report = await validate({
      languages: ['he', 'en'],
      categories: ['news', 'politics'],
      media_type: ['text', 'photo', 'video'],
    });
    expect(report.languages).toEqual(['he', 'en']);
    expect(report.schema_version).toBe(1);
  });
  it('allows empty arrays for absent language and category metadata', async () => {
    expect(
      (await validate({ languages: [], categories: [] })).languages,
    ).toEqual([]);
  });
  it('normalizes legacy spelling without leaking language to JSON', () => {
    const report = normalizeReport({ language: ' en ', content: ' text ' });
    expect(report.languages).toEqual(['en']);
    expect(report).not.toHaveProperty('language');
    expect(report.categories).toEqual([]);
    expect(report.collected_at).toBeUndefined();
    expect(report.schema_version).toBe(1);
    expect(report.is_official).toBe(false);
  });
  it('does not filter invalid language array items', () => {
    expect(normalizeReport({ languages: ['en', 'invalid'] }).languages).toEqual(
      ['en', 'invalid'],
    );
  });
  it('preserves modern languages when legacy language is also present', () => {
    expect(
      normalizeReport({ languages: ['he', 'en'], language: 'ar' }).languages,
    ).toEqual(['he', 'en']);
  });
  it('rejects malformed source timestamps instead of replacing them', () => {
    expect(() => normalizeReport({ collected_at: 'yesterday' })).toThrow();
    expect(() =>
      normalizeReport({ collected_at: new Date('invalid') }),
    ).toThrow();
  });
});
