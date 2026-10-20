import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ISO_639_1_CODES } from '../common/languages.js';
import {
  PAUSE_SECONDS,
  RADIO_STATIONS,
  RECORDING_SECONDS,
} from './radio.constants.js';

const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const radioEnvironment = {
  RADIO_ENABLED: flag.default(true),
  RADIO_DATA_DIR: z.string().min(1).default('.radio'),
  RADIO_PYTHON_PATH: z
    .string()
    .min(1)
    .default(
      process.platform === 'win32'
        ? '.venv-radio/Scripts/python.exe'
        : '.venv-radio/bin/python',
    ),
  RADIO_MODEL: z
    .enum(['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'])
    .default('tiny'),
  RADIO_CPU_THREADS: z.coerce.number().int().min(1).max(16).default(2),
  RADIO_JOB_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(900),
  RADIO_MAX_CLIPS: z.coerce.number().int().min(1).max(10000).default(100),
};

export const radioStationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(200),
  streamUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, 'Expected a public HTTP(S) audio URL without embedded credentials.'),
  language: z.enum(ISO_639_1_CODES).optional(),
});
export const radioStationsSchema = z
  .array(radioStationSchema)
  .min(1)
  .max(10)
  .refine(
    (stations) =>
      new Set(stations.map((station) => station.id)).size === stations.length,
    'Station IDs must be unique.',
  );
export type RadioStation = z.infer<typeof radioStationSchema>;
type RadioEnvironment = z.output<z.ZodObject<typeof radioEnvironment>>;
export type RadioSettings = RadioEnvironment & {
  recordingSeconds: number;
  pauseSeconds: number;
  stations: RadioStation[];
};

/** Runtime output/cache must stay inside this project's working directory. */
export function radioDataDirectory(value: string): string {
  const directory = resolve(value);
  const part = relative(process.cwd(), directory);
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part))
    throw new Error('RADIO_DATA_DIR must be a directory inside the project.');
  return directory;
}

export function readRadioSettings(config: RadioEnvironment): RadioSettings {
  const settings = {
    ...z.object(radioEnvironment).parse(config),
    recordingSeconds: z.number().int().min(1).max(300).parse(RECORDING_SECONDS),
    pauseSeconds: z.number().int().min(0).max(86400).parse(PAUSE_SECONDS),
    stations: radioStationsSchema.parse(RADIO_STATIONS),
  };
  radioDataDirectory(settings.RADIO_DATA_DIR);
  return settings;
}
