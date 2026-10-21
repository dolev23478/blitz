// npm run build && node --import tsx test/transformer/run-radio-sample.mjs
// Actual archived JSON and compiled processors; Redis storage and Kafka transport are mocked.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import { FakeRetryQueue } from './fake-retry-queue.ts';
import { RedisService } from '../../dist/redis/redis.service.js';
import { RedisRetryQueue } from '../../dist/transformer/retry-queue.js';
import { TransformerModule } from '../../dist/transformer/transformer.module.js';
import { TransformerWorkflow } from '../../dist/transformer/transformer.workflow.js';
import { ReportValidator } from '../../dist/transformer/report-validator.js';

const directory = resolve('.radio/clips');
const records = [];
const originalProducer = Kafka.prototype.producer;
Kafka.prototype.producer = function () {
  return {
    connect: async () => undefined,
    send: async (record) => {
      records.push(structuredClone(record));
      return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
    },
    disconnect: async () => undefined,
  };
};
const config = new ConfigService({
  KAFKA_BROKERS: 'capture.invalid:9092',
  KAFKA_REMOTE_BROKERS: '',
  KAFKA_SSL: 'false',
  KAFKA_SASL_USERNAME: '',
  KAFKA_SASL_PASSWORD: '',
  DE_RAW_REPORT_SCHEMA_PATH: '',
});
const keepAlive = setInterval(() => undefined, 1000);
let app;
try {
  const names = (await readdir(directory)).filter((name) =>
    /^[a-f\d-]{36}\.json$/i.test(name),
  );
  assert(names.length, 'No radio JSON found; run radio:once first.');
  app = await Test.createTestingModule({ imports: [TransformerModule] })
    .overrideProvider(RedisService)
    .useValue({ isEnabled: () => false })
    .overrideProvider(RedisRetryQueue)
    .useValue(new FakeRetryQueue())
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  app.useLogger(false);
  await app.init();
  const workflow = app.get(TransformerWorkflow);
  const validator = new ReportValidator(config);
  let noSpeech = 0;
  let example;
  for (const name of names) {
    const clip = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
    if (clip.status === 'no_speech' || !clip.text?.trim()) {
      noSpeech++;
      continue;
    }
    example ??= clip;
    const original = JSON.stringify(clip);
    const results = await workflow.run('RadioTranscript', clip, {
      inputId: clip.clipId,
      source: 'radio',
    });
    assert.equal(results[0].status, 'completed');
    assert.equal(JSON.stringify(clip), original);
  }
  assert(records.length > 0, 'No nonempty radio transcripts available.');
  for (const record of records) {
    const message = record.messages[0];
    const report = validator.validate(JSON.parse(message.value));
    assert.equal(record.topic, 'reports.raw');
    assert.equal(Object.hasOwn(report, 'report_id'), false);
    assert.equal(report.platform, 'AM/FM-RADIO');
    assert.deepEqual(report.media_type, ['text']);
    assert(Array.isArray(report.languages));
    assert.equal(report.schema_version, 1);
    assert.equal(report.published_at, null);
    assert(!('language' in report));
  }
  const count = records.length;
  for (const text of ['', '   ', '<div>invalid HTML</div>']) {
    await assert.rejects(
      workflow.run('RadioTranscript', { ...example, text }),
      { code: 'validation_failed' },
    );
  }
  assert.equal(records.length, count, 'Invalid content must not be published.');
  console.log(
    JSON.stringify(
      {
        actualArchivedInputs: names.length,
        reportsMappedAndValidated: count,
        noSpeechSkipped: noSpeech,
        invalidContentRejected: 3,
        recordingsWritten: 0,
        redisAndKafkaMocked: true,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  clearInterval(keepAlive);
  Kafka.prototype.producer = originalProducer;
}
