import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, loadConfig } from '../src/config/app-config.js';
import { RadioModule } from '../src/radio/radio.module.js';
import { LocalRadioWorker } from '../src/radio/local-radio.worker.js';
import {
  PAUSE_SECONDS,
  RADIO_STATIONS,
  RECORDING_SECONDS,
} from '../src/radio/radio.constants.js';
import {
  radioDataDirectory,
  radioStationsSchema,
  readRadioSettings,
} from '../src/radio/radio.config.js';
import * as textAnalyzer from '../src/text-analyzer.js';
import { RadioService } from '../src/radio/radio.service.js';
import { type CaptureResult } from '../src/radio/radio.types.js';

const station = {
  id: 'test-radio',
  name: 'Test Radio',
  streamUrl: 'https://example.com/audio',
  language: 'en' as const,
};
const captured: CaptureResult = {
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T10:00:30.000Z',
  durationSeconds: 30,
  text: 'A public radio report',
  language: 'en',
  segments: [{ start: 0, end: 10, text: 'A public radio report' }],
};
let directory: string;
let radio: RadioService;
let capture: ReturnType<typeof vi.fn>;
let stop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  directory = resolve('.tmp', `radio-test-${randomUUID()}`);
  capture = vi.fn().mockResolvedValue(captured);
  vi.spyOn(textAnalyzer, 'analyzeText').mockReturnValue({
    text: captured.text,
    content: captured.text,
    language: 'en',
    matched: true,
    languages: ['en'],
    terms: ['report'],
    categories: ['פח"ע'],
    issues: [],
    matches: [],
    usedSources: [],
  });
  stop = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  radio = new RadioService(
    loadConfig({ RADIO_ENABLED: 'false', RADIO_DATA_DIR: directory }),
    { capture, onModuleDestroy: stop } as unknown as LocalRadioWorker,
  );
});
afterEach(async () => {
  await radio.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Cleanup only this test's unique directory, never recordings or another workspace.
  expect(relative(resolve('.tmp'), directory)).toMatch(
    /^radio-test-[a-f\d-]+$/,
  );
  await rm(directory, { recursive: true, force: true });
});

describe('radio configuration', () => {
  it('starts with the app by default and uses the three constants', () => {
    const settings = readRadioSettings(loadConfig({}));
    expect(settings.RADIO_ENABLED).toBe(true);
    expect(settings.recordingSeconds).toBe(RECORDING_SECONDS);
    expect(settings.pauseSeconds).toBe(PAUSE_SECONDS);
    expect(settings.stations).toEqual(RADIO_STATIONS);
  });
  it('does not let obsolete ENV durations/station files override the constants', () => {
    const settings = readRadioSettings(
      loadConfig({
        RADIO_CLIP_SECONDS: '1',
        RADIO_INTERVAL_SECONDS: '1',
        RADIO_STATIONS_FILE: 'missing.json',
      }),
    );
    expect(settings.recordingSeconds).toBe(RECORDING_SECONDS);
    expect(settings.pauseSeconds).toBe(PAUSE_SECONDS);
    expect(settings.stations).toEqual(RADIO_STATIONS);
  });
  it.each([
    'file:///c:/secret.wav',
    'ftp://example.com/a',
    'https://user:password@example.com/a',
  ])('rejects unsupported/credentialed station URL %s', (streamUrl) => {
    expect(() =>
      radioStationsSchema.parse([{ ...station, streamUrl }]),
    ).toThrow();
  });
  it('rejects duplicate stations and invalid language hints', () => {
    expect(() => radioStationsSchema.parse([station, station])).toThrow();
    expect(() =>
      radioStationsSchema.parse([{ ...station, language: 'zz' }]),
    ).toThrow();
  });
  it('keeps runtime output inside the project and forbids using its root', () => {
    expect(() => radioDataDirectory('../outside')).toThrow();
    expect(() => radioDataDirectory('.')).toThrow();
    expect(radioDataDirectory('.radio')).toBe(resolve('.radio'));
  });
});

describe('radio memory-only capture', () => {
  it('waits for the Transformer handoff and supports unsubscribing without saving anything', async () => {
    let finish!: () => void;
    const listener = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const unsubscribe = radio.watchTranscripts(listener);
    const active = radio.collectOnce([station]);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await radio.collectOnce([station])).skipped).toBe(true);
    finish();
    await active;
    unsubscribe();
    await radio.collectOnce([station]);
    expect(listener).toHaveBeenCalledOnce();
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('logs only accepted transcript text and never creates an audio or JSON file', async () => {
    const result = await radio.collectOnce([station]);
    expect(result.failedStations).toEqual([]);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]!.station.name).toBe(station.name);
    expect(capture).toHaveBeenCalledWith(
      station,
      expect.objectContaining({ recordingSeconds: RECORDING_SECONDS }),
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'radio_transcribed',
        transcript: captured.text,
      }),
    );
    const transcriptLogs = vi
      .mocked(Logger.prototype.log)
      .mock.calls.filter(([event]) => event?.transcript);
    expect(transcriptLogs).toHaveLength(1);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['', 'Rejected private transcript'])(
    'does not persist or log rejected transcript %s',
    async (text) => {
      vi.mocked(textAnalyzer.analyzeText).mockReturnValue({
        matched: false,
      } as ReturnType<typeof textAnalyzer.analyzeText>);
      capture.mockResolvedValue({
        ...captured,
        text,
        language: text ? 'en' : 'unknown',
        segments: [],
      });
      const listener = vi.fn();
      radio.watchTranscripts(listener);
      const result = await radio.collectOnce([station]);
      expect(result.clips).toEqual([]);
      expect(listener).not.toHaveBeenCalled();
      if (text)
        expect(
          JSON.stringify(vi.mocked(Logger.prototype.log).mock.calls),
        ).not.toContain(text);
      expect(Logger.prototype.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'radio_transcribed' }),
      );
      await expect(readdir(directory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('continues after a failed capture without creating partial files', async () => {
    capture.mockRejectedValueOnce(new Error('ASR failed'));
    const result = await radio.collectOnce([
      station,
      { ...station, id: 'second' },
    ]);
    expect(result.failedStations).toEqual([station.id]);
    expect(result.clips).toHaveLength(1);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not stop at the old archive limit or modify historical saved files', async () => {
    await mkdir(resolve(directory, 'clips'), { recursive: true });
    await writeFile(resolve(directory, 'clips', 'old.json'), 'historical');
    for (let i = 0; i < 3; i++) await radio.collectOnce([station]);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(await readdir(resolve(directory, 'clips'))).toEqual(['old.json']);
    expect(
      await readFile(resolve(directory, 'clips', 'old.json'), 'utf8'),
    ).toBe('historical');
  });

  it('does not hold shutdown open while publication waits for retries', async () => {
    const listener = vi.fn(() => new Promise<void>(() => undefined));
    radio.watchTranscripts(listener);
    const active = radio.collectOnce([station]);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    await radio.onModuleDestroy();
    expect((await active).clips).toHaveLength(1);
  });

  it('uses a fresh UUID for every transient transcript', async () => {
    const first = (await radio.collectOnce([station])).clips[0]!;
    expect((await radio.collectOnce([station])).clips[0]!.clipId).not.toBe(
      first.clipId,
    );
  });

  it('rejects invalid ASR metadata without retaining or logging its text', async () => {
    capture.mockResolvedValue({ ...captured, language: 'zz' });
    const result = await radio.collectOnce([station]);
    expect(result.clips).toEqual([]);
    expect(result.failedStations).toEqual([station.id]);
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.log).mock.calls),
    ).not.toContain(captured.text);
  });
});

describe('radio scheduling and shutdown', () => {
  it('starts through the Nest application lifecycle using validated app config alone', async () => {
    const app = await Test.createTestingModule({ imports: [RadioModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          RADIO_ENABLED: 'true',
          RADIO_DATA_DIR: directory,
        }),
      )
      .overrideProvider(LocalRadioWorker)
      .useValue({ capture, onModuleDestroy: stop })
      .compile();
    try {
      app.get(RadioService).settings.stations = [station];
      await app.init();
      await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
      expect(capture).toHaveBeenCalledOnce();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'radio_started' }),
      );
    } finally {
      await app.close();
    }
  });
  it('does not schedule when disabled', async () => {
    vi.useFakeTimers();
    radio.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(120000);
    expect(capture).not.toHaveBeenCalled();
  });
  it('prevents overlap while a capture is pending', async () => {
    let finish!: (value: CaptureResult) => void;
    capture.mockReturnValueOnce(
      new Promise((accept) => {
        finish = accept;
      }),
    );
    const active = radio.collectOnce([station]);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    expect((await radio.collectOnce([station])).skipped).toBe(true);
    finish(captured);
    await active;
  });
  it('starts immediately and pauses only after all stations finish; shutdown cancels the timer', async () => {
    vi.useFakeTimers();
    radio.settings.RADIO_ENABLED = true;
    radio.settings.stations = [station, { ...station, id: 'second' }];
    const cycle = vi.spyOn(radio, 'collectOnce');
    cycle.mockResolvedValue({
      skipped: false,
      clips: [],
      failedStations: [],
    });
    let complete!: (value: RadioCycleResultForTest) => void;
    type RadioCycleResultForTest = Awaited<
      ReturnType<RadioService['collectOnce']>
    >;
    cycle.mockReturnValueOnce(
      new Promise((accept) => {
        complete = accept;
      }),
    );
    radio.onApplicationBootstrap();
    expect(cycle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync((PAUSE_SECONDS + 1) * 1000);
    expect(cycle).toHaveBeenCalledOnce();
    complete({
      skipped: false,
      clips: [],
      failedStations: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PAUSE_SECONDS * 1000 - 1);
    expect(cycle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);
    await radio.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(100000);
    expect(cycle).toHaveBeenCalledTimes(2);
  });
  it('stops an active worker and does not start the next station on shutdown', async () => {
    let fail!: (error: Error) => void;
    capture.mockReturnValueOnce(
      new Promise((_accept, reject) => {
        fail = reject;
      }),
    );
    stop.mockImplementation(async () => {
      fail?.(new Error('Stopped'));
    });
    const active = radio.collectOnce([station, { ...station, id: 'second' }]);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    await radio.onModuleDestroy();
    await active;
    expect(capture).toHaveBeenCalledOnce();
    expect((await radio.collectOnce([station])).skipped).toBe(true);
  });
});
