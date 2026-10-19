import { loadConfig } from './config.js';
import { createClient, login } from './client.js';
import { resolveTargets } from './targets.js';
import { startMessageListener } from './listeners/messageListener.js';
import { ExtractorService } from './services/extractorService.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
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
  //   await extractor.getHistory(chatId, new Date(Date.now() - 7 * 864e5));
  void new ExtractorService(client, cfg);

  console.log(`Listening to ${ids.size} chat(s). Ctrl+C to stop.`);
  const stop = async (): Promise<void> => {
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
