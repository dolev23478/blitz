// Explicit diagnostic: sample all configured live streams without saving audio/text.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../../dist/config/app-config.js';
import { RadioTransformerModule } from '../../dist/radio/radio-transformer.module.js';
import { RadioService } from '../../dist/radio/radio.service.js';
import { RedisService } from '../../dist/redis/redis.service.js';

assert(
  process.env.REDIS_TEST_URL && process.env.KAFKA_TEST_BROKERS,
  'Supply isolated REDIS_TEST_URL and KAFKA_TEST_BROKERS.',
);
const id = randomUUID();
const prefix = `blitz:{radio-live-${id}}:outbox`;
const directory = `.tmp/radio-live-${id}`;
const settings = loadConfig({
  RADIO_ENABLED: 'false',
  RADIO_DATA_DIR: directory,
  RADIO_PYTHON_PATH: process.env.RADIO_E2E_PYTHON_PATH,
  RADIO_MODELS_DIR: process.env.RADIO_E2E_MODELS_DIR || 'vendor/radio-models',
  RADIO_JOB_TIMEOUT_SECONDS: '60',
  REDIS_URL: process.env.REDIS_TEST_URL,
  KAFKA_BROKERS: process.env.KAFKA_TEST_BROKERS,
  KAFKA_SSL: 'false',
  TRANSFORMER_RETRY_PREFIX: prefix,
  KAFKA_RETRY_INTERVAL_MS: '1000',
});
const app = await Test.createTestingModule({
  imports: [RadioTransformerModule],
})
  .overrideProvider(APP_CONFIG)
  .useValue(settings)
  .overrideProvider(ConfigService)
  .useValue(new ConfigService(settings))
  .compile();
try {
  app.useLogger(new ConsoleLogger('RadioLiveSmoke'));
  await app.init();
  const radio = app.get(RadioService);
  const seconds = Number(process.env.RADIO_SMOKE_SECONDS || 3);
  assert(Number.isInteger(seconds) && seconds >= 1 && seconds <= 300);
  // Test-only shorter capture; production constants remain unchanged.
  radio.settings.recordingSeconds = seconds;
  const selectedIds = process.env.RADIO_SMOKE_STATIONS?.split(',');
  const stations = selectedIds
    ? selectedIds.map((id) => {
        const station = radio.settings.stations.find((item) => item.id === id);
        assert(station, `Unknown station: ${id}`);
        return station;
      })
    : radio.settings.stations;
  const result = await radio.collectOnce(stations);
  assert.equal(result.skipped, false);
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
  console.log(
    JSON.stringify(
      {
        liveStations: stations.length,
        secondsPerStation: seconds,
        acceptedAndPublished: result.clips
          .map((clip) => clip.station.id)
          .filter((stationId) => !result.failedStations.includes(stationId)),
        failedStations: result.failedStations,
        recordingsWritten: 0,
        transcriptsWritten: 0,
      },
      null,
      2,
    ),
  );
  if (result.failedStations.length) process.exitCode = 1;
} finally {
  const redis = app.get(RedisService);
  if (redis.isEnabled())
    await redis.eval(
      "local keys=redis.call('KEYS',ARGV[1]); for _,key in ipairs(keys) do redis.call('DEL',key) end; return #keys",
      [],
      [prefix + ':*'],
    );
  await app.close();
}
