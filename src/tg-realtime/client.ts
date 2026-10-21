import { MemoryStorage, TelegramClient } from '@mtcute/node';

export const MISSING_SESSION_MESSAGE =
  "Missing TG_SESSION_STRING in environment variables. Run 'npm run auth' locally to generate one.";

export interface ClientCredentials {
  apiId: number;
  apiHash: string;
  sessionString?: string;
}

/**
 * Headless client: no files are written and there is never a phone / code prompt. The session is loaded from
 * TG_SESSION_STRING; `storage` (default: in memory only) can persist the update state, e.g. `createRedisStorage`.
 * Network reconnects are handled by mtcute; FLOOD_WAIT by `withFloodWait`; stalls by the watchdog.
 */
export function createClient(cfg: ClientCredentials, storage: MemoryStorage = new MemoryStorage()): TelegramClient {
  if (!cfg.sessionString) throw new Error(MISSING_SESSION_MESSAGE);
  return new TelegramClient({ apiId: cfg.apiId, apiHash: cfg.apiHash, storage });
}

/** Signs in with the session string. A rejected/expired session fails fast instead of asking for a code. */
export async function login(client: TelegramClient, cfg: ClientCredentials): Promise<{ id: number; name: string }> {
  if (!cfg.sessionString) throw new Error(MISSING_SESSION_MESSAGE);
  const refuse = (what: string): Promise<string> =>
    Promise.reject(
      new Error(
        `TG_SESSION_STRING is invalid or expired (Telegram asked for the ${what}). ` +
          "Run 'npm run auth' locally to generate a new one.",
      ),
    );
  const user = await client.start({
    session: cfg.sessionString,
    phone: () => refuse('phone number'),
    code: () => refuse('login code'),
    password: () => refuse('2FA password'),
  });
  return { id: user.id, name: user.displayName };
}

/** Client for the one-time local `npm run auth`; interactive, never used in production. */
export function createAuthClient(apiId: number, apiHash: string): TelegramClient {
  return new TelegramClient({ apiId, apiHash, storage: new MemoryStorage() });
}
