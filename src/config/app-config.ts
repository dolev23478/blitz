import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://tg:tg@localhost:5433/telegram'),
  REDIS_URL: z.string().optional().transform((v: string | undefined) => v || undefined),
  PORT: z.coerce.number().int().positive().default(3000),
  POLL_SECONDS: z.coerce.number().positive().default(30),
  BACKFILL_DAYS: z.coerce.number().positive().default(7),
  REQUEST_DELAY_MS: z.coerce.number().nonnegative().default(1000),
  CONCURRENCY: z.coerce.number().int().positive().default(3),
  /** If set, all /api routes (except /api/health) require this key. */
  API_KEY: z.string().optional().transform((v: string | undefined) => v || undefined),
  /** Telegram account (MTProto) for groups / private chats. Needs TG_API_ID, TG_API_HASH and TG_SESSION_STRING. */
  TG_API_ID: z.string().optional().transform((v: string | undefined) => (v ? Number(v) : undefined)),
  TG_API_HASH: z.string().optional().transform((v: string | undefined) => v || undefined),
  /** Headless login: output of `npm run auth` (run locally once). */
  TG_SESSION_STRING: z.string().optional().transform((v: string | undefined) => v || undefined),
  /** Watchdog: how often the Telegram connection is probed. */
  TG_WATCHDOG_SECONDS: z.coerce.number().positive().default(30),
  /** Safety-net catch-up interval for chats, in case live push stalls silently. */
  TG_SYNC_SECONDS: z.coerce.number().nonnegative().default(300),
  CORS_ORIGIN: z.string().default('*'),
});

export type AppConfig = z.output<typeof schema>;

export const CONFIG_KEYS = Object.keys(schema.shape);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => schema.parse(env);

/** Injection token for the validated environment configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
