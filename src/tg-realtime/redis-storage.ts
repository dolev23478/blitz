import { createHash } from 'node:crypto';
import { MemoryStorage } from '@mtcute/node';

/** The two Redis calls the storage needs; `RedisService` satisfies it. */
export interface SnapshotStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export const MTCUTE_STATE_KEY = 'telegram:mtcute-state';

const SAVE_THROTTLE_MS = 5_000;

type Tagged = { $u8: string } | { $map: [unknown, unknown][] } | { $set: unknown[] };

function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $u8: Buffer.from(value).toString('base64') } satisfies Tagged;
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [encode(k), encode(v)]) } satisfies Tagged;
  if (value instanceof Set) return { $set: [...value].map(encode) } satisfies Tagged;
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.$u8 === 'string') return new Uint8Array(Buffer.from(v.$u8, 'base64'));
    if (Array.isArray(v.$map)) return new Map((v.$map as [unknown, unknown][]).map(([k, x]) => [decode(k), decode(x)]));
    if (Array.isArray(v.$set)) return new Set(v.$set.map(decode));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return value;
}

/** Copies `source` into `target` in place: the mtcute repositories keep references to these exact Map/Set objects. */
function fill(target: unknown, source: unknown): void {
  if (target instanceof Map && source instanceof Map) {
    target.clear();
    for (const [k, v] of source) target.set(k, v);
  } else if (target instanceof Set && source instanceof Set) {
    target.clear();
    for (const v of source) target.add(v);
  } else if (target && source && typeof target === 'object' && typeof source === 'object') {
    for (const [k, v] of Object.entries(source)) {
      const current = (target as Record<string, unknown>)[k];
      if (current instanceof Map || current instanceof Set) fill(current, v);
      else (target as Record<string, unknown>)[k] = v;
    }
  }
}

/** Identifies the session string a snapshot belongs to, without storing the string itself. */
export function fingerprint(sessionString: string): string {
  return createHash('sha256').update(sessionString).digest('hex').slice(0, 16);
}

/**
 * mtcute storage that keeps everything in memory (fast, synchronous repositories) and persists a snapshot to Redis:
 * the update state (pts/qts/seq/date and per-channel pts) lets mtcute ask Telegram for the updates missed while the
 * process was down; auth keys and the peer cache avoid re-resolving every channel after a restart.
 * A snapshot taken for a different session string is ignored, so rotating TG_SESSION_STRING starts clean.
 */
export function createRedisStorage(store: SnapshotStore, sessionFingerprint: string, key = MTCUTE_STATE_KEY): MemoryStorage {
  const storage = new MemoryStorage();
  const driver = storage.driver;
  let lastWritten: string | null = null;
  let lastWriteAt = 0;
  let trailing: NodeJS.Timeout | null = null;

  const write = async (): Promise<void> => {
    const payload = JSON.stringify({ fingerprint: sessionFingerprint, states: encode(Object.fromEntries(driver.states)) });
    if (payload === lastWritten) return;
    await store.set(key, payload);
    lastWritten = payload;
    lastWriteAt = Date.now();
  };

  Object.assign(driver, {
    async load(): Promise<void> {
      let raw: string | null = null;
      try {
        raw = await store.get(key);
      } catch {
        return; // Redis down: start with an empty state, the session string still logs in
      }
      if (!raw) return;
      try {
        const snapshot = JSON.parse(raw) as { fingerprint?: string; states?: Record<string, unknown> };
        if (snapshot.fingerprint !== sessionFingerprint || !snapshot.states) return;
        const states = decode(snapshot.states) as Record<string, unknown>;
        for (const [name, state] of Object.entries(states)) {
          const target = driver.states.get(name);
          if (target) fill(target, state);
        }
        lastWritten = raw;
      } catch {
        // a corrupt snapshot is treated as missing
      }
    },
    async save(): Promise<void> {
      if (Date.now() - lastWriteAt >= SAVE_THROTTLE_MS) {
        await write().catch(() => undefined);
      } else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          void write().catch(() => undefined);
        }, SAVE_THROTTLE_MS);
        trailing.unref();
      }
    },
    async destroy(): Promise<void> {
      if (trailing) clearTimeout(trailing);
      trailing = null;
      await write().catch(() => undefined);
    },
  });
  return storage;
}
