import type { TelegramClient } from '@mtcute/node';
import type { Config, Target } from './config.js';
import { withFloodWait } from './utils/resilience.js';

/**
 * Resolves configured targets (usernames / numeric ids) to marked chat ids and
 * returns them as a Set for O(1) membership checks in the listener.
 * Numeric ids require that the logged-in account can see the chat (joined / member).
 */
export async function resolveTargets(
  client: TelegramClient,
  targets: Target[],
): Promise<{ ids: Set<number>; failed: Target[] }> {
  const ids = new Set<number>();
  const failed: Target[] = [];
  for (const t of targets) {
    try {
      const chat = await withFloodWait(() => client.getChat(t), {
        onWait: (s) => console.warn(`FLOOD_WAIT ${s}s while resolving ${t}`),
      });
      ids.add(chat.id);
      console.log(`Target ${t} -> ${chat.id} (${chat.displayName})`);
    } catch (err) {
      failed.push(t);
      console.error(`Cannot resolve target ${t}:`, (err as Error).message);
    }
  }
  return { ids, failed };
}

export type { Config };
