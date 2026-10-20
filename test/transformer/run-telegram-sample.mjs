// Run after building: node --import tsx test/transformer/run-telegram-sample.mjs
// Uses the compiled Nest module and real processors; Redis storage and Kafka transport are test doubles.
import 'reflect-metadata';
import { FakeRetryQueue } from './fake-retry-queue.ts';
import { RedisRetryQueue } from '../../dist/transformer/retry-queue.js';
import { RedisService } from '../../dist/redis/redis.service.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { Kafka } from 'kafkajs';
import { TransformerModule } from '../../dist/transformer/transformer.module.js';
import { TransformerWorkflow } from '../../dist/transformer/transformer.workflow.js';
import { provisionalRawReportSchema } from '../../dist/contracts/provisional-raw-report.schema.js';

const attempts = [];
const published = [];
let failures = 0;
const originalProducer = Kafka.prototype.producer;
Kafka.prototype.producer = function () {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    async send(record) {
      attempts.push(structuredClone(record));
      if (failures > 0) {
        failures--;
        throw new Error('Simulated Kafka outage');
      }
      published.push(structuredClone(record));
      return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
    },
  };
};

function message(id, type) {
  return {
    messageId: id,
    postedAt: new Date('2026-10-19T15:30:00+03:00'),
    text: `  Telegram report ${id}  `,
    views: null,
    media: type ? [{ type, url: 'https://example.com/media' }] : [],
    links: [],
    forwardedFrom: null,
    edited: false,
    url: `https://t.me/c/123456/${id}?single&x=%2f`,
    senderName: id % 2 ? 'Dana' : null,
  };
}

// Test doubles have no Redis socket to keep Node alive while retry timers are unrefed.
const keepAlive = setInterval(() => undefined, 1000);
let module;
try {
  module = await Test.createTestingModule({ imports: [TransformerModule] })
    .overrideProvider(RedisRetryQueue).useValue(new FakeRetryQueue())
    .overrideProvider(RedisService).useValue({isEnabled:()=>false})
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        KAFKA_BROKERS: 'capture.invalid:9092',
        KAFKA_RETRY_INTERVAL_MS: 10,
      }),
    )
    .compile();
  module.useLogger(false);
  await module.init();
  const workflow = module.get(TransformerWorkflow);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(provisionalRawReportSchema);

  for (const [index, type] of [
    undefined,
    'photo',
    'video',
    'audio',
    'document',
    'other',
  ].entries()) {
    const original = message(index + 1, type);
    const input = index % 2 ? JSON.parse(JSON.stringify(original)) : original;
    const snapshot = structuredClone(input);
    const receivedBefore = Date.now();
    const result = await workflow.run('ParsedMessage', input);
    const record = published.at(-1);
    const report = JSON.parse(record.messages[0].value);
    assert.ok(validate(report), JSON.stringify(validate.errors));
    assert.equal(record.messages[0].key, String(report.report_id));
    assert.equal(report.report_url, original.url);
    assert.equal(report.published_at, original.postedAt.toISOString());
    assert.equal(report.account_name, original.senderName);
    assert.equal(report.channel_name, null);
    assert.deepEqual(report.languages, []);
    assert.ok(Date.parse(report.collected_at) >= receivedBefore);
    assert.ok(Date.parse(report.collected_at) <= Date.now());
    assert.deepEqual(report.media_type, type === 'photo' || type === 'video' ? ['text', type] : ['text']);
    assert.equal(result[0].status, 'completed');
    assert.deepEqual(input, snapshot);
  }

  const start = attempts.length;
  failures = 1;
  await Promise.all([
    workflow.run('ParsedMessage', message(1001, 'photo')),
    workflow.run('ParsedMessage', message(1002, 'video')),
  ]);
  const retried = attempts.slice(start);
  assert.equal(retried.length, 3);
  assert.deepEqual(retried[0], retried[1]);
  assert.equal(
    JSON.parse(retried[2].messages[0].value).report_url,
    message(1002).url,
  );
  const reports = published.map((record) =>
    JSON.parse(record.messages[0].value),
  );
  for (const report of reports)
    assert.ok(validate(report), JSON.stringify(validate.errors));

  const sentBeforeInvalid = attempts.length;
  for (const text of ['', ' ', null, '<p>HTML</p>']) {
    await assert.rejects(
      workflow.run('ParsedMessage', { ...message(2000), text }),
      { code: 'validation_failed' },
    );
  }
  assert.equal(attempts.length, sentBeforeInvalid);

  const output = new URL('./output/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL('telegram-parsed-message.raw-reports.json', output),
    JSON.stringify(reports, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        module: 'Compiled TransformerModule instantiated through Nest DI',
        telegramReports: reports.length,
        localSchemaValidation: 'passed (provisional schema)',
        kafkaRetryAndFIFO: 'passed',
        invalidReportsRejectedBeforeKafka: 4,
        transport: 'Redis storage and Kafka transport mocked; no real infrastructure contacted',
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(keepAlive);
  await module?.close();
  Kafka.prototype.producer = originalProducer;
}
