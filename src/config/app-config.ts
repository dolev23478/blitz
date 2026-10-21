import { z } from 'zod';
import { radioEnvironment } from '../radio/radio.config.js';

const schema = z.object({
  ...radioEnvironment,
  REDIS_URL: z
    .string()
    .optional()
    .transform((v: string | undefined) => v || undefined),
  PORT: z.coerce.number().int().positive().default(3000),
  /** If set, all /api routes (except /api/health) require this key. */
  API_KEY: z
    .string()
    .optional()
    .transform((v: string | undefined) => v || undefined),
  /** Telegram account (MTProto) for groups / private chats. Needs TG_API_ID, TG_API_HASH and TG_SESSION_STRING. */
  TG_API_ID: z
    .string()
    .optional()
    .transform((v: string | undefined) => (v ? Number(v) : undefined)),
  TG_API_HASH: z
    .string()
    .optional()
    .transform((v: string | undefined) => v || undefined),
  /** Headless login: output of `npm run auth` (run locally once). */
  TG_SESSION_STRING: z
    .string()
    .optional()
    .transform((v: string | undefined) => v || undefined),
  /** Watchdog: how often the Telegram connection is probed. */
  TG_WATCHDOG_SECONDS: z.coerce.number().positive().default(30),
  /** Safety-net catch-up interval for chats, in case live push stalls silently. */
  TG_SYNC_SECONDS: z.coerce.number().nonnegative().default(300),
  CORS_ORIGIN: z.string().default('*'),
  /** Transformer Kafka settings. An empty broker list is allowed until publishing is needed. */
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_RETRY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1)
    .max(2147483647)
    .default(60000),
  /** Shared across instances; use an isolated namespace for tests. Keep the Redis Cluster hash tag. */
  TRANSFORMER_RETRY_PREFIX: z
    .string()
    .min(1)
    .default('blitz:{reports.raw}:outbox'),
  KAFKA_SSL: z.enum(['true', 'false']).optional(),
  KAFKA_SASL_MECHANISM: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_SASL_USERNAME: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_SASL_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_BROKERS: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_TOPIC: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_SASL_MECHANISM: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_SASL_USERNAME: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_SASL_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  KAFKA_REMOTE_SSL_CA_FILE: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** Media upload (photos). Enabled when S3_BUCKET is set; defaults S3_PUBLIC_BASE_URL to direct S3 URL when omitted. */
  S3_BUCKET: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  S3_REGION: z.string().default('il-central-1'),
  AWS_REGION: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** Custom endpoint for S3-compatible stores (MinIO, etc.); empty = AWS. */
  S3_ENDPOINT: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** Optional: when unset the default AWS credential chain (env, role, profile) is used. */
  S3_ACCESS_KEY_ID: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  S3_SECRET_ACCESS_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  /** Public base of the bucket or CDN; stored URLs are <base>/<key>. */
  S3_PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  S3_KEY_PREFIX: z.string().default('media'),
  MEDIA_MAX_MB: z.coerce.number().positive().default(50),
  DE_RAW_REPORT_SCHEMA_PATH: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});

export type AppConfig = z.output<typeof schema>;

export const CONFIG_KEYS = Object.keys(schema.shape);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const resolvedRegion =
    env.S3_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || process.env.S3_REGION || process.env.AWS_REGION || 'il-central-1';
  return schema.parse({
    ...env,
    S3_REGION: resolvedRegion,
  });
};

/** Injection token for the validated environment configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
