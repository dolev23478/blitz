import { describe, expect, it } from 'vitest';
import { createRedisStorage, fingerprint, type SnapshotStore } from '../../src/tg-realtime/redis-storage.js';

function memoryStore(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
  };
}

const peer = { id: 5, accessHash: 'abc', isMin: false, usernames: ['news'], updated: 1, complete: new Uint8Array([1, 2, 3]) };

async function populate(storage: ReturnType<typeof createRedisStorage>): Promise<void> {
  await storage.driver.load();
  storage.kv.set('updates_pts', new Uint8Array([9, 0, 0, 0]));
  storage.authKeys.set(2, new Uint8Array([7, 7]));
  storage.peers.store(peer);
  storage.refMessages.store(5, 100, 42);
  await (storage.driver as unknown as { save(): Promise<void> }).save();
}

describe('createRedisStorage', () => {
  it('restores update state, auth keys, peers and reference messages after a restart', async () => {
    const store = memoryStore();
    await populate(createRedisStorage(store, fingerprint('session-a')));

    const restored = createRedisStorage(store, fingerprint('session-a'));
    await restored.driver.load();
    expect(restored.kv.get('updates_pts')).toEqual(new Uint8Array([9, 0, 0, 0]));
    expect(restored.authKeys.get(2)).toEqual(new Uint8Array([7, 7]));
    expect(restored.peers.getById(5)).toEqual(peer);
    expect(restored.peers.getByUsername('news')?.id).toBe(5);
    expect(restored.refMessages.getByPeer(5)).toEqual([100, 42]);
  });

  it('ignores a snapshot that belongs to another session string', async () => {
    const store = memoryStore();
    await populate(createRedisStorage(store, fingerprint('session-a')));

    const other = createRedisStorage(store, fingerprint('session-b'));
    await other.driver.load();
    expect(other.authKeys.get(2)).toBeNull();
    expect(other.kv.get('updates_pts')).toBeNull();
  });

  it('starts empty when Redis is unavailable or the snapshot is corrupt', async () => {
    const down: SnapshotStore = { get: async () => { throw new Error('down'); }, set: async () => undefined };
    const a = createRedisStorage(down, 'x');
    await a.driver.load();
    expect(a.authKeys.get(2)).toBeNull();

    const corrupt = memoryStore();
    corrupt.data.set('telegram:mtcute-state', '{not json');
    const b = createRedisStorage(corrupt, 'x');
    await b.driver.load();
    expect(b.kv.get('updates_pts')).toBeNull();
  });
});
