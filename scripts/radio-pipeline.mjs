// Full radio pipeline only: capture -> ASR -> dictionary filter -> Transformer -> Kafka.
import 'reflect-metadata';
import { Module, Logger } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

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
process.env.RADIO_ENABLED = once ? 'false' : 'true';
const { RadioTransformerModule } =
  await import('../dist/radio/radio-transformer.module.js');
const { RadioService } = await import('../dist/radio/radio.service.js');
const { APP_CONFIG } = await import('../dist/config/app-config.js');
const { ApiKeyGuard } = await import('../dist/common/api-key.guard.js');
const { HttpErrorFilter } = await import('../dist/common/http-error.filter.js');
class RadioPipelineModule {}
Module({
  imports: [RadioTransformerModule],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})(RadioPipelineModule);

let app;
try {
  // No AppModule import: Telegram and X are not started by this command.
  app = await NestFactory.create(RadioPipelineModule, new FastifyAdapter(), {
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
  const config = app.get(APP_CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
  const logger = new Logger('RadioPipeline');
  logger.log({
    event: 'radio_pipeline_listening',
    url: `http://localhost:${config.PORT}/api/radio/clips`,
    once,
  });
  if (once) {
    const result = await radio.collectOnce();
    logger.log({
      event: 'radio_cycle_completed',
      captured: result.clips.length,
      noSpeech: result.clips.filter((clip) => clip.status === 'no_speech')
        .length,
      failedStations: result.failedStations,
      archiveFull: result.archiveFull,
    });
    if (result.failedStations.length || result.archiveFull || result.skipped)
      process.exitCode = 1;
    await app.close();
  }
} catch (error) {
  console.error(error);
  await app?.close();
  process.exitCode = 1;
}
