// Full radio pipeline only: capture -> ASR -> dictionary filter -> Transformer -> Kafka.
import 'reflect-metadata';
import { Module, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Usage: npm run radio:start -- [--once] [--station=<station-id>]',
  );
  console.log(
    'Runs radio capture, local ASR, dictionary filtering and Kafka publication. Telegram/X are not started.',
  );
  process.exit(0);
}
const once = args.includes('--once');
if (args.some((arg) => arg !== '--once' && !/^--station=[a-z0-9-]+$/.test(arg)))
  throw new Error(
    'Usage: npm run radio:start -- [--once] [--station=<station-id>]',
  );
// Apply station selection before starting the scheduler in this application context.
process.env.RADIO_ENABLED = 'false';
const { RadioTransformerModule } =
  await import('../dist/radio/radio-transformer.module.js');
const { RadioService } = await import('../dist/radio/radio.service.js');
class RadioPipelineModule {}
Module({
  imports: [RadioTransformerModule],
})(RadioPipelineModule);

let app;
try {
  // No AppModule import: Telegram and X are not started by this command.
  app = await NestFactory.createApplicationContext(RadioPipelineModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  const radio = app.get(RadioService);
  const ids = args
    .filter((arg) => arg.startsWith('--station='))
    .map((arg) => arg.slice('--station='.length));
  if (ids.length) {
    radio.settings.stations = ids.map((id) => {
      const station = radio.settings.stations.find((item) => item.id === id);
      if (!station) throw new Error(`Unknown radio station: ${id}`);
      return station;
    });
  }
  const logger = new Logger('RadioPipeline');
  logger.log({
    event: 'radio_pipeline_started',
    once,
  });
  if (!once) {
    radio.settings.RADIO_ENABLED = true;
    radio.onApplicationBootstrap();
  }
  if (once) {
    const result = await radio.collectOnce();
    logger.log({
      event: 'radio_cycle_completed',
      captured: result.clips.length,
      noSpeech: result.clips.filter((clip) => clip.status === 'no_speech')
        .length,
      failedStations: result.failedStations,
    });
    if (result.failedStations.length || result.skipped) process.exitCode = 1;
    await app.close();
  }
} catch (error) {
  console.error(error);
  await app?.close();
  process.exitCode = 1;
}
