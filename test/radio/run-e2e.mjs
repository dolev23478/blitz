// Explicit opt-in: real Python/ASR, analyzer, Nest modules, Redis and Kafka.
// Existing audio is read into RAM; this runner never saves audio or transcripts.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Kafka, logLevel } from 'kafkajs';
import { APP_CONFIG, loadConfig } from '../../dist/config/app-config.js';
import { RadioTransformerModule } from '../../dist/radio/radio-transformer.module.js';
import { RadioService } from '../../dist/radio/radio.service.js';
import { RedisService } from '../../dist/redis/redis.service.js';
import { RedisRetryQueue } from '../../dist/transformer/retry-queue.js';
import { PublishingProcessor } from '../../dist/transformer/processors/publishing.processor.js';
import { ReportValidator } from '../../dist/transformer/report-validator.js';
import { analyzeText } from '../../dist/text-analyzer.js';

const { REDIS_TEST_URL, KAFKA_TEST_BROKERS, RADIO_E2E_AUDIO_PATH } =
  process.env;
assert(
  REDIS_TEST_URL && KAFKA_TEST_BROKERS && RADIO_E2E_AUDIO_PATH,
  'Set REDIS_TEST_URL, KAFKA_TEST_BROKERS and RADIO_E2E_AUDIO_PATH to isolated infrastructure and existing speech audio.',
);
const acceptedAudio = await readFile(RADIO_E2E_AUDIO_PATH);
assert(acceptedAudio.length <= 20 * 1024 * 1024, 'Fixture must be bounded.');
const rejectedAudio = process.env.RADIO_E2E_REJECTED_AUDIO_PATH
  ? await readFile(process.env.RADIO_E2E_REJECTED_AUDIO_PATH)
  : undefined;
const silence = Buffer.alloc(44 + 64000);
silence.write('RIFF');
silence.writeUInt32LE(silence.length - 8, 4);
silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16);
silence.writeUInt16LE(1, 20);
silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24);
silence.writeUInt32LE(32000, 28);
silence.writeUInt16LE(2, 32);
silence.writeUInt16LE(16, 34);
silence.write('data', 36);
silence.writeUInt32LE(64000, 40);
const http = createServer((req, res) => {
  const audio =
    req.url === '/accepted.wav'
      ? acceptedAudio
      : req.url === '/rejected.wav'
        ? rejectedAudio
        : req.url === '/silence.wav'
          ? silence
          : undefined;
  if (!audio) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': audio.length,
  });
  res.end(audio);
});
const unavailable = createTcpServer((socket) => socket.destroy());
const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));
async function until(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

const id = randomUUID();
const prefix = `blitz:{radio-e2e-${id}}:outbox`;
const dataDir = `.tmp/radio-e2e-${id}`;
const settings = loadConfig({
  REDIS_URL: REDIS_TEST_URL,
  KAFKA_BROKERS: KAFKA_TEST_BROKERS,
  KAFKA_SSL: 'false',
  RADIO_ENABLED: 'false',
  RADIO_DATA_DIR: dataDir,
  RADIO_PYTHON_PATH: process.env.RADIO_E2E_PYTHON_PATH,
  RADIO_MODELS_DIR: process.env.RADIO_E2E_MODELS_DIR || 'vendor/radio-models',
  TRANSFORMER_RETRY_PREFIX: prefix,
  KAFKA_RETRY_INTERVAL_MS: '1000',
});
const config = new ConfigService(settings);
const kafka = new Kafka({
  clientId: `radio-e2e-${id}`,
  brokers: KAFKA_TEST_BROKERS.split(','),
  logLevel: logLevel.NOTHING,
  retry: { retries: 0 },
  connectionTimeout: 3000,
});
const admin = kafka.admin();
const consumer = kafka.consumer({ groupId: `radio-e2e-${id}` });
const records = [];
const events = [];
const originalLog = Logger.prototype.log;
const originalWarn = Logger.prototype.warn;
const originalError = Logger.prototype.error;
// Assert log contents in RAM; do not emit rejected content or duplicate accepted text.
const captureLog = function (message) {
  if (message && typeof message === 'object')
    events.push(structuredClone(message));
};
Logger.prototype.log = captureLog;
Logger.prototype.warn = captureLog;
Logger.prototype.error = captureLog;
let app;
let redis;
const publishers = [];
try {
  await listen(http);
  await listen(unavailable);
  const base = `http://127.0.0.1:${http.address().port}`;
  await admin.connect();
  await admin.createTopics({
    topics: [{ topic: 'reports.raw', numPartitions: 1, replicationFactor: 1 }],
  });
  await consumer.connect();
  await consumer.subscribe({ topic: 'reports.raw', fromBeginning: false });
  const joined = new Promise((resolve) =>
    consumer.on(consumer.events.GROUP_JOIN, resolve),
  );
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.key?.toString().startsWith(base))
        records.push({
          key: message.key.toString(),
          value: JSON.parse(message.value.toString()),
        });
    },
  });
  await Promise.race([
    joined,
    delay(20000).then(() => {
      throw new Error('Consumer did not join.');
    }),
  ]);

  app = await Test.createTestingModule({ imports: [RadioTransformerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(settings)
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  app.useLogger(false);
  await app.init();
  const radio = app.get(RadioService);
  const stations = [
    {
      id: 'accepted',
      name: 'Existing Arabic speech fixture',
      streamUrl: `${base}/accepted.wav`,
      language: 'ar',
    },
    ...(rejectedAudio
      ? [
          {
            id: 'rejected',
            name: 'Non-matching speech',
            streamUrl: `${base}/rejected.wav`,
            language: 'en',
          },
        ]
      : []),
    {
      id: 'silence',
      name: 'Silence',
      streamUrl: `${base}/silence.wav`,
      language: 'en',
    },
    {
      id: 'unavailable',
      name: 'Unavailable stream',
      streamUrl: `${base}/missing.wav`,
    },
  ];
  const result = await radio.collectOnce(stations);
  assert.deepEqual(
    result.failedStations,
    ['unavailable'],
    JSON.stringify(
      events
        .filter((e) => e.event === 'radio_station_failed')
        .map(({ stationId, reason }) => ({ stationId, reason })),
    ),
  );
  assert.equal(
    result.clips.length,
    1,
    'Speech fixture must pass the current real dictionaries.',
  );
  const clip = result.clips[0];
  const received = await until(
    () =>
      records.find((r) => r.key === `${base}/accepted.wav#clip=${clip.clipId}`),
    'radio Kafka record',
  );
  const report = new ReportValidator(config).validate(received.value);
  assert.equal(report.platform, 'AM/FM-RADIO');
  assert.equal(report.content, clip.text);
  assert.deepEqual(report.languages, ['ar']);
  assert.deepEqual(
    report.categories,
    analyzeText(clip.text, 'auto').categories,
  );
  assert.deepEqual(report.media_type, ['text']);
  assert.equal(report.schema_version, 1);
  assert.equal(report.published_at, null);
  assert.equal(report.collected_at, clip.endedAt);
  assert.equal('language' in report || 'report_id' in report, false);
  assert.equal(received.key, report.report_url);
  assert.deepEqual(
    events.filter((e) => e.transcript).map((e) => e.transcript),
    [clip.text],
  );
  for (const station of stations.filter(
    (s) => s.id !== 'accepted' && s.id !== 'unavailable',
  )) {
    assert(
      events.some(
        (e) =>
          e.event === 'radio_filter_result' &&
          e.stationId === station.id &&
          e.passed === false,
      ),
    );
  }
  // Metadata stages must not print the transcript again.
  assert.equal(
    events.filter((e) => JSON.stringify(e).includes(clip.text)).length,
    1,
  );
  await assert.rejects(readdir(dataDir), { code: 'ENOENT' });
  redis = app.get(RedisService);
  assert.equal(
    await redis.eval(
      "return redis.call('HLEN',KEYS[1])",
      [prefix + ':jobs'],
      [],
    ),
    0,
  );
  await app.close();
  app = undefined;

  // An actual socket failure must persist the ORIGINAL report and error in real Redis.
  redis = new RedisService(settings);
  await redis.onModuleInit();
  const queue = new RedisRetryQueue(redis, config);
  const recoveryReport = {
    ...report,
    report_url: `${base}/recovery#clip=${id}`,
  };
  const badConfig = new ConfigService({
    ...settings,
    KAFKA_BROKERS: `127.0.0.1:${unavailable.address().port}`,
    KAFKA_RETRY_INTERVAL_MS: 60000,
  });
  const first = new PublishingProcessor(badConfig, queue);
  publishers.push(first);
  const pending = first.execute({ reports: [recoveryReport] });
  // Attach immediately; shutdown intentionally rejects the original caller.
  const pendingOutcome = pending.then(
    () => 'unexpected-success',
    (error) => error.message,
  );
  const saved = await until(async () => {
    const values = await redis.hgetall(prefix + ':jobs');
    const job = Object.values(values)
      .map((v) => JSON.parse(v))
      .find(
        (j) => j.retryCount === 0 && j.status === 'pending' && j.errors?.length,
      );
    return job;
  }, 'persisted Kafka failure');
  assert.deepEqual(JSON.parse(saved.payload), recoveryReport);
  assert.equal(saved.attempts, 1);
  assert(saved.nextRetryAt > Date.now());
  assert.equal(
    await redis.eval(
      "return redis.call('LLEN',KEYS[1])",
      [prefix + ':queue'],
      [],
    ),
    1,
  );
  await first.onModuleDestroy();
  assert.match(await pendingOutcome, /remain persisted in Redis/);
  await redis.onModuleDestroy();

  const restartContainer = process.env.RADIO_E2E_RESTART_REDIS_CONTAINER;
  if (restartContainer) {
    assert(
      /^blitz-radio-e2e-[a-z0-9-]+$/.test(restartContainer),
      'Restart is restricted to an explicitly named blitz-radio-e2e-* test container.',
    );
    await promisify(execFile)('docker', ['restart', restartContainer], {
      windowsHide: true,
    });
  }

  // Fresh Redis client + publisher instances represent application restart.
  redis = new RedisService(settings);
  await redis.onModuleInit();
  const recoveredQueue = new RedisRetryQueue(redis, config);
  const persisted = JSON.parse(await redis.hget(prefix + ':jobs', saved.id));
  assert.equal(persisted.payload, saved.payload);
  assert.equal(persisted.nextRetryAt, saved.nextRetryAt);
  assert.deepEqual(persisted.errors, saved.errors);
  // Preserve the actual scheduling delay, while keeping this diagnostic under a minute.
  const remaining = persisted.nextRetryAt - Date.now();
  assert(remaining > 0);
  const second = new PublishingProcessor(config, recoveredQueue);
  const third = new PublishingProcessor(
    config,
    new RedisRetryQueue(redis, config),
  );
  publishers.push(second, third);
  const a = second.execute({ reports: [recoveryReport] });
  const b = third.execute({ reports: [recoveryReport] });
  await delay(250);
  assert.equal(
    records.filter((r) => r.key === recoveryReport.report_url).length,
    0,
  );
  assert.equal(
    await redis.eval(
      "return redis.call('HLEN',KEYS[1])",
      [prefix + ':jobs'],
      [],
    ),
    1,
  );
  await Promise.all([a, b]);
  await until(
    () => records.some((r) => r.key === recoveryReport.report_url),
    'recovered Kafka record',
  );
  await delay(250);
  assert.equal(
    records.filter((r) => r.key === recoveryReport.report_url).length,
    1,
  );
  assert.equal(
    await redis.eval(
      "return redis.call('HLEN',KEYS[1])",
      [prefix + ':jobs'],
      [],
    ),
    0,
  );
  assert.deepEqual(await recoveredQueue.outcomes([saved.id]), ['confirmed']);
  await assert.rejects(
    second.execute({ reports: [{ ...report, content: '' }] }),
    /Invalid RAW_REPORT/,
  );
  assert.equal(
    await redis.eval(
      "return redis.call('LLEN',KEYS[1])",
      [prefix + ':queue'],
      [],
    ),
    0,
  );

  // The approved terminal policy is exactly four attempts, then discard.
  const discardedReport = {
    ...report,
    report_url: `${base}/discard#clip=${id}`,
  };
  // Stop the healthy workers before testing an unavailable broker.
  await second.onModuleDestroy();
  await third.onModuleDestroy();
  const [discardId] = await recoveredQueue.enqueue([
    new ReportValidator(config).serialize(discardedReport),
  ]);
  const terminal = new PublishingProcessor(
    new ConfigService({
      ...settings,
      KAFKA_BROKERS: `127.0.0.1:${unavailable.address().port}`,
      KAFKA_RETRY_INTERVAL_MS: 5,
    }),
    recoveredQueue,
  );
  publishers.push(terminal);
  const failedEventsBefore = events.filter(
    (e) => e.event === 'kafka_publish_retry',
  ).length;
  await assert.rejects(
    terminal.execute({ reports: [discardedReport] }),
    /initial attempt and 3 retries/,
  );
  assert.deepEqual(await recoveredQueue.outcomes([discardId]), ['discarded']);
  assert.equal(
    events.filter((e) => e.event === 'kafka_publish_retry').length -
      failedEventsBefore,
    3,
  );
  assert.equal(
    records.filter((r) => r.key === discardedReport.report_url).length,
    0,
  );
  assert.equal(
    await redis.eval(
      "return redis.call('HLEN',KEYS[1])",
      [prefix + ':jobs'],
      [],
    ),
    0,
  );

  console.log(
    JSON.stringify(
      {
        actualPythonASR: true,
        actualDictionaries: true,
        actualRedisKafka: true,
        accepted: result.clips.length,
        rejected:
          stations.length - result.clips.length - result.failedStations.length,
        unavailableStreamHandled: true,
        payloadAndKeyValidated: true,
        persistedFailureAndRestartRecovery: true,
        redisServerRestarted: Boolean(restartContainer),
        twoPublishersOneRecoveryRecord: true,
        threeRetriesThenDiscard: true,
        invalidContentRejected: true,
        recordingsWritten: 0,
        transcriptsWritten: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  for (const publisher of publishers) await publisher.onModuleDestroy();
  if (redis?.isEnabled()) {
    // Delete only this unique diagnostic namespace, never other application data.
    await redis.eval(
      "local keys=redis.call('KEYS',ARGV[1]); for _,key in ipairs(keys) do redis.call('DEL',key) end; return #keys",
      [],
      [prefix + ':*'],
    );
    await redis.onModuleDestroy();
  }
  await consumer.stop();
  await consumer.disconnect();
  await admin.disconnect();
  await close(http);
  await close(unavailable);
  Logger.prototype.log = originalLog;
  Logger.prototype.warn = originalWarn;
  Logger.prototype.error = originalError;
}
