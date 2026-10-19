import 'dotenv/config';
import { MISSING_SESSION_MESSAGE } from './client.js';

/** A target is either a public username or a numeric (marked) chat id. */
export type Target = string | number;

export interface Config {
  apiId: number;
  apiHash: string;
  /** Exported session (`npm run auth`); the only way to authenticate. */
  sessionString: string;
  targets: Target[];
  scanDelayMinMs: number;
  scanDelayMaxMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example)`);
  return v;
}

/** "@name", "t.me/name" and "-100123" are all accepted. */
export function parseTargets(raw: string): Target[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): Target => {
      if (/^-?\d+$/.test(s)) return Number(s);
      return s.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
    });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, requireTargets = true): Config {
  const apiId = Number(required(env, 'TG_API_ID'));
  if (!Number.isInteger(apiId)) throw new Error('TG_API_ID must be an integer');
  const sessionString = env.TG_SESSION_STRING?.trim();
  if (!sessionString) throw new Error(MISSING_SESSION_MESSAGE);
  const targets = parseTargets(env.TG_TARGETS ?? '');
  if (requireTargets && targets.length === 0) throw new Error('TG_TARGETS is empty');
  const min = Number(env.SCAN_DELAY_MIN_MS ?? 1500);
  const max = Number(env.SCAN_DELAY_MAX_MS ?? 3000);
  if (!(min >= 0 && max >= min)) throw new Error('Invalid SCAN_DELAY_* values');
  return {
    apiId,
    apiHash: required(env, 'TG_API_HASH'),
    sessionString,
    targets,
    scanDelayMinMs: min,
    scanDelayMaxMs: max,
  };
}
