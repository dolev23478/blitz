import { describe, expect, it } from 'vitest';
import {
  checkJson,
  MAX_PAYLOAD_BYTES,
} from '../../src/transformer/json-input.js';
import { ParsingProcessor } from '../../src/transformer/processors/parsing.processor.js';
import { context, metadata, telegramInput, twitterInput } from './fixtures.js';

describe('Transformer input boundary', () => {
  it.each([null, undefined, 'HTML or JSON text', []])(
    'rejects non-object collector payloads (%j)',
    async (input) => {
      const ctx = context();
      ctx.input = input;
      await expect(new ParsingProcessor().execute(ctx)).rejects.toMatchObject({
        code: 'parsing_failed',
      });
    },
  );

  it.each([
    { language: 42 },
    { language: [] },
    { language: 'en', matches: [1] },
  ])('rejects invalid supplemental metadata (%j)', async (value) => {
    const ctx = context();
    Reflect.set(ctx, 'metadata', value);
    await expect(new ParsingProcessor().execute(ctx)).rejects.toMatchObject({
      code: 'parsing_failed',
    });
  });

  it('accepts a single ParsedMessage object without wrapping it in an array', async () => {
    await expect(
      new ParsingProcessor().execute(context(telegramInput(), 'ParsedMessage')),
    ).resolves.toBeUndefined();
  });

  it('snapshots metadata separately from the collector object', async () => {
    const values = metadata('ParsedMessage');
    values.channelName = 'Blitz News';
    const ctx = context(telegramInput(), 'ParsedMessage', values);
    await new ParsingProcessor().execute(ctx);
    values.channelName = 'changed';
    expect(ctx.metadata.channelName).toBe('Blitz News');
  });

  it('takes a snapshot so later caller changes cannot modify processor data', async () => {
    const input = twitterInput();
    const ctx = context(input);
    await new ParsingProcessor().execute(ctx);
    input.posts[0]!.text = 'changed by caller';
    expect(ctx.input).not.toBe(input);
    expect(ctx.input).not.toEqual(input);
  });

  it('accepts optional undefined DTO properties from a direct service call', async () => {
    const input = twitterInput();
    input.posts[0]!.authorAvatarUrl = undefined;
    await expect(
      new ParsingProcessor().execute(context(input)),
    ).resolves.toBeUndefined();
  });

  it.each([
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    1n,
    () => 'code',
    Symbol('symbol'),
  ])('rejects unsafe or non-JSON values (%s)', (value) => {
    expect(() => checkJson({ value })).toThrow();
  });

  it('rejects accessors without executing them', () => {
    let calls = 0;
    const payload = {
      get text() {
        calls += 1;
        return 'unexpected';
      },
    };
    expect(() => checkJson(payload)).toThrow('accessors');
    expect(calls).toBe(0);
  });

  it('rejects cyclic object references', () => {
    const value: { child?: unknown } = {};
    value.child = value;
    expect(() => checkJson(value)).toThrow();
  });

  it('bounds input size, depth and number of fields', () => {
    expect(() => checkJson({ text: 'x'.repeat(MAX_PAYLOAD_BYTES) })).toThrow(
      '1 MiB',
    );
    expect(() => checkJson(Array.from({ length: 10001 }, () => 0))).toThrow();
    let nested: unknown = 'text';
    for (let depth = 0; depth < 66; depth += 1) nested = { child: nested };
    expect(() => checkJson(nested)).toThrow('complexity');
  });

  it('rejects invalid Dates before mapping', () => {
    expect(() => checkJson({ timestamp: new Date('invalid') })).toThrow('Date');
  });
});
