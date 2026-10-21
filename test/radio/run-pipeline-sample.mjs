// Real archived inputs, shared analyzer and compiled radio/Transformer modules. Redis/Kafka are explicitly mocked.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import { APP_CONFIG, loadConfig } from '../../dist/config/app-config.js';
import {
  RadioTransformerModule,
  RadioTransformerHandoff,
} from '../../dist/radio/radio-transformer.module.js';
import { RedisRetryQueue } from '../../dist/transformer/retry-queue.js';
import { RedisService } from '../../dist/redis/redis.service.js';
import { ReportValidator } from '../../dist/transformer/report-validator.js';
import { FakeRetryQueue } from '../transformer/fake-retry-queue.ts';

const directory = resolve('.radio/clips');
const records = [];
const events = [];
const originalProducer = Kafka.prototype.producer;
const originalLog = Logger.prototype.log;
Logger.prototype.log = function (message, ...args) {
  if (message && typeof message === 'object' && message.event)
    events.push(structuredClone(message));
  originalLog.call(this, message, ...args);
};
Kafka.prototype.producer = () => ({
  connect: async () => undefined,
  disconnect: async () => undefined,
  send: async (record) => {
    const message = record.messages[0];
    assert.equal(message.key, JSON.parse(message.value).report_url);
    records.push(structuredClone(record));
    return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
  },
});
const settings = loadConfig({
  RADIO_ENABLED: 'false',
  KAFKA_BROKERS: 'capture.invalid:9092',
  RADIO_PUBLIC_BASE_URL: 'https://radio-test.invalid',
  REDIS_URL: '',
});
const config = new ConfigService({
  ...settings,
  KAFKA_REMOTE_BROKERS: '',
  DE_RAW_REPORT_SCHEMA_PATH: '',
});
const keepAlive = setInterval(() => undefined, 1000);
let app;
try {
  app = await Test.createTestingModule({ imports: [RadioTransformerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(settings)
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(RedisService)
    .useValue({ isEnabled: () => false })
    .overrideProvider(RedisRetryQueue)
    .useValue(new FakeRetryQueue())
    .compile();
  await app.init();
  const handoff = app.get(RadioTransformerHandoff);
  const validator = new ReportValidator(config);
  const results = [];
  const files = (await readdir(directory)).filter((file) =>
    /^[a-f\d-]{36}\.json$/i.test(file),
  );
  assert(files.length, 'No archived radio clips; use radio:once first.');
  for (const file of files) {
    const input = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
    const original = JSON.stringify(input);
    results.push(await handoff.process(input));
    assert.equal(JSON.stringify(input), original);
  }
  const reports = records.map((record) =>
    validator.validate(JSON.parse(record.messages[0].value)),
  );
  assert.equal(
    records.length,
    results.filter((result) => result.status === 'published').length,
  );
  assert.equal(
    events.filter((event) => event.event === 'radio_filter_result').length,
    files.length,
  );
  const summary = {
    inputs: files.length,
    published: reports.length,
    filtered: results.filter((result) => result.status === 'filtered').length,
    actualAnalyzer: true,
    redisAndKafkaMocked: true,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await app?.close();
  clearInterval(keepAlive);
  Kafka.prototype.producer = originalProducer;
  Logger.prototype.log = originalLog;
}
