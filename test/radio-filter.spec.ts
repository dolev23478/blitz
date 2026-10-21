import { Logger } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as textAnalyzer from '../src/text-analyzer.js';
import { RadioTransformerHandoff } from '../src/radio/radio-transformer.service.js';
import type { RadioService } from '../src/radio/radio.service.js';
import type { RadioTranscript } from '../src/radio/radio.types.js';
import type { TransformerWorkflow } from '../src/transformer/transformer.workflow.js';

const dictionariesDir = fileURLToPath(
  new URL('./fixtures/dictionaries/', import.meta.url),
);
const run = vi.fn();
let handoff: RadioTransformerHandoff;
function clip(text: string, language = 'en'): RadioTranscript {
  return {
    clipId: 'c9f51a4a-387c-4f5f-b540-1d3ed20a115d',
    station: {
      id: 'test',
      name: 'Test radio',
      streamUrl: 'https://example.com/live',
    },
    text,
    language,
    status: 'transcribed',
    segments: [],
    durationSeconds: 30,
    startedAt: '2026-10-21T06:00:00.000Z',
    endedAt: '2026-10-21T06:00:30.000Z',
  };
}
beforeEach(() => {
  const analyzer = textAnalyzer.createTextAnalyzer({ dictionariesDir });
  // Run the actual shared normalizers, dictionary matching and decision logic using controlled fixture dictionaries.
  vi.spyOn(textAnalyzer, 'analyzeText').mockImplementation((text, language) =>
    analyzer.analyze(text, language),
  );
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  run.mockReset().mockResolvedValue([{ status: 'completed', inputId: 'test' }]);
  handoff = new RadioTransformerHandoff(
    {} as RadioService,
    { run } as unknown as TransformerWorkflow,
  );
});
afterEach(() => vi.restoreAllMocks());

it('accepts a real English dictionary match and preserves the archive object', async () => {
  const input = clip('I will kill with a bomb.');
  const before = structuredClone(input);
  expect((await handoff.process(input)).status).toBe('published');
  expect(run).toHaveBeenCalledWith(
    'RadioTranscript',
    expect.objectContaining({
      languages: ['en'],
      matches: expect.arrayContaining(['kill', 'bomb']),
    }),
    expect.objectContaining({ inputId: input.clipId, source: 'radio' }),
  );
  expect(input).toEqual(before);
});

it('filters real text without dictionary matches before invoking the Transformer', async () => {
  expect(await handoff.process(clip('Good morning everyone'))).toMatchObject({
    status: 'filtered',
    reason: 'no_dictionary_match',
  });
  expect(run).not.toHaveBeenCalled();
});

it('matches Arabic through the existing analyzer and keeps ASR language', async () => {
  expect((await handoff.process(clip('اقتل', 'ar'))).status).toBe('published');
  expect(run.mock.calls[0]![1]).toMatchObject({
    languages: ['ar'],
    matches: expect.arrayContaining(['اقتل']),
  });
});

it('preserves multilingual collector metadata and categories', async () => {
  const input = {
    ...clip('kill'),
    languages: ['en', 'he'],
    categories: ['collector-category'],
    matches: ['collector-match'],
  };
  await handoff.process(input);
  expect(run.mock.calls[0]![1]).toMatchObject({
    languages: ['en', 'he'],
    categories: ['collector-category'],
    matches: ['collector-match', 'kill'],
  });
});

it('does not announce success when the Transformer rejects a report', async () => {
  run.mockRejectedValue(new Error('Kafka publication failed'));
  await expect(handoff.process(clip('kill'))).rejects.toThrow(
    'Kafka publication failed',
  );
  expect(Logger.prototype.log).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: 'radio_pipeline_completed' }),
  );
  expect(Logger.prototype.error).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'radio_pipeline_failed' }),
  );
});

it('preserves explicit null collector arrays for shared normalization', async () => {
  await handoff.process({ ...clip('kill'), languages: null, categories: null });
  expect(run.mock.calls[0]![1]).toMatchObject({
    languages: null,
    categories: null,
  });
});

it('uses dev report categories, not evaluation concept labels', async () => {
  vi.mocked(textAnalyzer.analyzeText).mockReturnValue({
    text: 'bomb',
    content: 'bomb',
    language: 'en',
    languages: ['en'],
    matched: true,
    terms: ['bomb'],
    categories: ['פח"ע'],
    matches: [],
    usedSources: [],
    issues: [],
    evaluation: {
      mode: 'dictionary_only',
      riskScore: 10,
      riskLevel: 'low',
      threatCategories: ['weapon.explosive'],
      flaggedReasons: [],
    },
  });
  const result = await handoff.process(clip('bomb'));
  expect(result).toEqual({ status: 'published', clipId: clip('bomb').clipId });
  expect(run.mock.calls[0]![1].categories).toEqual(['פח"ע']);
});
