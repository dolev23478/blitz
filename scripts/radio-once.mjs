// npm run build && npm run radio:once [-- --station=iran-international]
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

const args = process.argv.slice(2);
if (args.some((arg) => !arg.startsWith('--station='))) {
  throw new Error(
    'Usage: npm run radio:once -- --station=<station-id> (optional)',
  );
}
process.env.RADIO_ENABLED = 'false'; // Explicit once mode must not also start a scheduler.
const { RadioModule } = await import('../dist/radio/radio.module.js');
const { RadioService } = await import('../dist/radio/radio.service.js');
class RadioOnceModule {}
Module({ imports: [RadioModule] })(RadioOnceModule);
const app = await NestFactory.createApplicationContext(RadioOnceModule, {
  logger: ['log', 'warn', 'error'],
});
app.enableShutdownHooks();
try {
  const radio = app.get(RadioService);
  const ids = args.map((arg) => arg.slice('--station='.length));
  const stations = ids.length
    ? ids.map((id) => {
        const station = radio.settings.stations.find((item) => item.id === id);
        if (!station) throw new Error(`Unknown radio station: ${id}`);
        return station;
      })
    : undefined;
  const result = await radio.collectOnce(stations);
  console.log(
    JSON.stringify({
      accepted: result.clips.length,
      failedStations: result.failedStations,
      skipped: result.skipped,
    }),
  );
  if (result.failedStations.length || result.skipped) process.exitCode = 1;
} finally {
  await app.close();
}
