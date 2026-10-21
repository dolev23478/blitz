import 'dotenv/config';
import { createClient as createRedis } from 'redis';
import { loadConfig } from './config.js';
import { createClient, login } from './client.js';
import { resolveTargets } from './targets.js';
import { startMessageListener } from './listeners/messageListener.js';
import { ExtractorService } from './services/extractorService.js';
import { SessionLock, type LockStore } from '../telegram/session-lock.js';

/** Takes the shared Telegram session lock before anything talks to Telegram; exits when it cannot. */
async function lockSession(): Promise<{ lock: SessionLock; close: () => Promise<void> }> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required: the Telegram session lock cannot be verified without it');
  const redis = createRedis({ url });
  await redis.connect();
  const store: LockStore = {
    setIfAbsent: async (k, v, ttl) => (await redis.set(k, v, { NX: true, EX: ttl })) === 'OK',
    get: (k) => redis.get(k),
    eval: (script, keys, args) => redis.eval(script, { keys, arguments: args }),
  };
  const lock = new SessionLock(store);
  if (!(await lock.acquire())) {
    const holder = (await lock.holder().catch(() => null)) ?? 'unknown';
    await redis.quit();
    throw new Error(`Telegram session lock is held by ${holder}; another instance is using this session`);
  }
  return { lock, close: () => redis.quit().then(() => undefined) };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { lock, close } = await lockSession();
  const client = createClient(cfg);
  const user = await login(client, cfg);
  console.log(`Logged in as ${user.name} (${user.id})`);

  const { ids, failed } = await resolveTargets(client, cfg.targets);
  if (ids.size === 0) throw new Error(`No target could be resolved: ${failed.join(', ')}`);

  startMessageListener(client, ids, (m) => {
    console.log(JSON.stringify(m));
  });

  // Active scans are available via the service, e.g.:
  //   const extractor = new ExtractorService(client, cfg);
  //   for await (const page of extractor.historyPages(chatId, new Date(Date.now() - 7 * 864e5))) { ... }
  void new ExtractorService(client, cfg);

  console.log(`Listening to ${ids.size} chat(s). Ctrl+C to stop.`);
  const stop = async (code = 0): Promise<void> => {
    clearInterval(heartbeat);
    await client.destroy().catch(() => undefined);
    await lock.release();
    await close().catch(() => undefined);
    process.exit(code);
  };
  const heartbeat = setInterval(() => {
    void lock.renew().then((ok) => {
      if (ok) return;
      console.error('Telegram session lock lost; stopping so the session is not used twice');
      void stop(1);
    });
  }, 30_000);
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
