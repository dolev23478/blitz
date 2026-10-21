import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/app-config.js';
import { readRadioSettings } from '../src/radio/radio.config.js';
import { LocalRadioWorker } from '../src/radio/local-radio.worker.js';

const processMock = vi.hoisted(() => ({
  exec: vi.fn(),
  end: vi.fn(),
  kill: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFile: processMock.exec }));
const result = {
  startedAt: '2026-10-20T10:00:00Z',
  endedAt: '2026-10-20T10:00:02Z',
  durationSeconds: 2,
  text: 'News report',
  language: 'en',
  segments: [{ start: 0, end: 2, text: 'News report' }],
};
const station = {
  id: 'test',
  name: 'Test',
  streamUrl: 'https://example.com/live;safe',
  language: 'en' as const,
};
const settings = readRadioSettings(loadConfig({ RADIO_ENABLED: 'false' }));
type Callback = (error: Error | null, stdout: string, stderr: string) => void;
let worker: LocalRadioWorker;
beforeEach(() => {
  vi.resetAllMocks();
  worker = new LocalRadioWorker();
  processMock.exec.mockImplementation(
    (_file, _args, _options, callback: Callback) => {
      queueMicrotask(() => callback(null, JSON.stringify(result), ''));
      return {
        stdin: { on: vi.fn(), end: processMock.end },
        kill: processMock.kill,
      };
    },
  );
});
afterEach(async () => {
  await worker.onModuleDestroy();
});

it('runs Python directly with bounded resources and JSON stdin, keeping caches in the project', async () => {
  await expect(worker.capture(station, settings)).resolves.toEqual(result);
  const [file, args, options] = processMock.exec.mock.calls[0]!;
  expect(file).toBe(resolve(settings.RADIO_PYTHON_PATH));
  expect(args).toHaveLength(1);
  expect(args[0]).toMatch(/local_worker\.py$/);
  expect(options).toMatchObject({
    windowsHide: true,
    timeout: 900000,
    maxBuffer: 2097152,
    killSignal: 'SIGKILL',
  });
  expect(options.shell).toBeUndefined();
  expect(options.env.HF_HOME).toBe(resolve('.radio/models'));
  // The model hub stays reachable: a missing model is downloaded into the project cache.
  expect(options.env.HF_HUB_OFFLINE).toBeUndefined();
  expect(options.env.TRANSFORMERS_OFFLINE).toBeUndefined();
  expect(JSON.parse(processMock.end.mock.calls[0]![0])).not.toHaveProperty(
    'audioPath',
  );
  expect(JSON.parse(processMock.end.mock.calls[0]![0]).modelCache).toBe(
    resolve('.radio/models'),
  );
  expect(JSON.parse(processMock.end.mock.calls[0]![0])).toMatchObject({
    streamUrl: station.streamUrl,
    seconds: settings.recordingSeconds,
  });
});

describe.each([
  'not JSON',
  JSON.stringify({ ...result, durationSeconds: 301 }),
  JSON.stringify({ ...result, language: 'zz' }),
  JSON.stringify({ ...result, language: 'unknown' }),
  JSON.stringify({ ...result, endedAt: '2026-10-19T10:00:00Z' }),
  JSON.stringify({ ...result, segments: [{ start: 3, end: 1, text: 'bad' }] }),
  JSON.stringify({ ...result, segments: [{ start: 1, end: 10, text: 'bad' }] }),
])('invalid worker output %#', (stdout) => {
  it('rejects invalid metadata rather than exposing it as a successful clip', async () => {
    processMock.exec.mockImplementation(
      (_file, _args, _options, callback: Callback) => {
        queueMicrotask(() => callback(null, stdout, ''));
        return {
          stdin: { on: vi.fn(), end: processMock.end },
          kill: processMock.kill,
        };
      },
    );
    await expect(worker.capture(station, settings)).rejects.toThrow(
      'invalid result',
    );
  });
});

it('includes bounded diagnostics for missing dependencies or a broken stream', async () => {
  processMock.exec.mockImplementation(
    (_file, _args, _options, callback: Callback) => {
      queueMicrotask(() =>
        callback(
          new Error('exit 1'),
          '',
          "ModuleNotFoundError: No module named 'av'",
        ),
      );
      return {
        stdin: { on: vi.fn(), end: processMock.end },
        kill: processMock.kill,
      };
    },
  );
  await expect(worker.capture(station, settings)).rejects.toThrow(
    "No module named 'av'",
  );
});

it('kills an active child, awaits its exit and rejects new jobs after shutdown', async () => {
  processMock.exec.mockImplementation(
    (_file, _args, _options, callback: Callback) => {
      processMock.kill.mockImplementation(() =>
        queueMicrotask(() =>
          callback(
            Object.assign(new Error('killed'), { killed: true }),
            '',
            '',
          ),
        ),
      );
      return {
        stdin: { on: vi.fn(), end: processMock.end },
        kill: processMock.kill,
      };
    },
  );
  const running = worker.capture(station, settings);
  const rejection = expect(running).rejects.toThrow('stopped');
  await worker.onModuleDestroy();
  await rejection;
  expect(processMock.kill).toHaveBeenCalledWith('SIGKILL');
  await expect(worker.capture(station, settings)).rejects.toThrow(
    'shutting down',
  );
});
