// Run: npm run build
// Then: node --import tsx test/transformer/run-batch-sample.mjs
// Boots the compiled TransformerModule. Only the Kafka network transport is replaced.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { Kafka } from 'kafkajs';
import { mockBatchScrapeResult } from './fixtures/mock-batch-scrape-result.ts';
import {
  createMockScrapedPost,
  createMockBatchResult,
} from './fixtures/mock-generators.ts';
import { TransformerModule } from '../../dist/transformer/transformer.module.js';
import { TransformerWorkflow } from '../../dist/transformer/transformer.workflow.js';
import { ParsingProcessor } from '../../dist/transformer/processors/parsing.processor.js';
import { MappingProcessor } from '../../dist/transformer/processors/mapping.processor.js';
import { ValidationProcessor } from '../../dist/transformer/processors/validation.processor.js';
import { PublishingProcessor } from '../../dist/transformer/processors/publishing.processor.js';
import { CompletionProcessor } from '../../dist/transformer/processors/completion.processor.js';
import { provisionalRawReportSchema } from '../../dist/contracts/provisional-raw-report.schema.js';

const captured = [];
const stages = [];
const originalProducer = Kafka.prototype.producer;
let connections = 0;
let disconnections = 0;
Kafka.prototype.producer = function (options) {
  assert.equal(options.allowAutoTopicCreation, false);
  return {
    async connect() {
      connections += 1;
    },
    async send(record) {
      captured.push(structuredClone(record));
      // Simulated transport acknowledgment, not a real broker ACK.
      return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
    },
    async disconnect() {
      disconnections += 1;
    },
  };
};

const config = new ConfigService({
  KAFKA_BROKERS: 'capture.invalid:9092', // No connection is made to this address.
  KAFKA_SSL: false,
  KAFKA_SASL_USERNAME: '',
  KAFKA_SASL_PASSWORD: '',
  DE_RAW_REPORT_SCHEMA_PATH: '', // No authoritative DE schema is present in the repo.
});
let module;
try {
  module = await Test.createTestingModule({ imports: [TransformerModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  module.useLogger(false);
  await module.init();
  const workflow = module.get(TransformerWorkflow);
  for (const Processor of [
    ParsingProcessor,
    MappingProcessor,
    ValidationProcessor,
    PublishingProcessor,
    CompletionProcessor,
  ]) {
    const processor = module.get(Processor);
    const execute = processor.execute.bind(processor);
    processor.execute = async (context) => {
      stages.push(context.inputId + ':' + processor.stage);
      return execute(context);
    };
  }

  const input = JSON.parse(JSON.stringify(mockBatchScrapeResult));
  const before = structuredClone(input);
  const results = await workflow.run('ProfileScrapeResult', input, {
    inputId: 'original-whole-batch',
  });
  const wholeBatchRecords = structuredClone(captured);
  assert.equal(wholeBatchRecords.length, 2);
  assert.equal(results.length, 2);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(provisionalRawReportSchema);
  const wholeBatchReports = wholeBatchRecords.map((record, index) => {
    assert.equal(record.topic, 'reports.raw');
    assert.equal(record.acks, -1);
    assert.equal(record.messages.length, 1);
    const message = record.messages[0];
    assert.equal(typeof message.value, 'string');
    const report = JSON.parse(message.value);
    assert.ok(validate(report), JSON.stringify(validate.errors));
    assert.deepEqual(
      Object.keys(report).sort(),
      [...provisionalRawReportSchema.required].sort(),
    );
    assert.equal(message.key, String(report.report_id));
    assert.equal(report.report_url, input.posts[index].url);
    assert.equal(report.content, input.posts[index].text);
    assert.equal(report.published_at, input.posts[index].publishedAt);
    assert.equal(report.collected_at, input.scrapedAt);
    assert.deepEqual(results[index], {
      status: 'completed',
      inputId: 'original-whole-batch',
      reportId: report.report_id,
    });
    return report;
  });
  assert.deepEqual(
    wholeBatchReports.map((report) => report.language),
    ['unknown', 'unknown'],
  );
  assert.deepEqual(
    stages.filter((stage) => stage.startsWith('original-whole-batch:')),
    [
      'original-whole-batch:parsing',
      'original-whole-batch:mapping',
      'original-whole-batch:validation',
      'original-whole-batch:publishing',
      'original-whole-batch:completion',
    ],
  );

  // Control run with languages supplied explicitly by the test caller.
  // This is two separate calls, not an unchanged mixed-language batch or language detection.
  captured.length = 0;
  for (const [index, language] of ['en', 'ar'].entries()) {
    await workflow.run(
      'ProfileScrapeResult',
      { ...input, totalPosts: 1, posts: [input.posts[index]] },
      {
        inputId: 'language-specific-' + index,
        language,
      },
    );
  }
  const splitReports = captured.map((record) =>
    JSON.parse(record.messages[0].value),
  );
  assert.deepEqual(
    splitReports.map((report) => report.language),
    ['en', 'ar'],
  );
  for (const report of splitReports) assert.ok(validate(report));
  assert.deepEqual(input, before);

  // Execute the supplied generators repeatedly through the compiled Nest providers.
  const generatedReports = [];
  const invalidCases = [];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const contents = [
      'English generated content',
      'محتوى اختبار عربي',
      'תוכן בדיקה בעברית',
      'Café: 1 < 2 & 3 > 2',
    ];
    const posts = Array.from({ length: (iteration % 5) + 1 }, (_, index) => {
      const post = createMockScrapedPost({
        url: `https://x.com/mock_${iteration}/status/${index}?original=%2F`,
        authorHandle: `mock_${iteration}_${index}`,
        text: `  ${contents[iteration % contents.length]} ${index}  `,
        publishedAt: '2026-10-19T17:30:00+03:00',
        media:
          iteration % 3 === 0
            ? []
            : [
                {
                  type: iteration % 3 === 1 ? 'photo' : 'video',
                  url: 'https://example.com/media',
                },
              ],
      });
      if (index % 2 === 1) post.language = 'ar';
      return post;
    });
    const batch = createMockBatchResult({ posts });
    const snapshot = structuredClone(batch);
    captured.length = 0;
    const outcome = await workflow.run('ProfileScrapeResult', batch);
    assert.equal(outcome.length, posts.length);
    assert.equal(captured.length, posts.length);
    for (const [index, record] of captured.entries()) {
      assert.equal(record.topic, 'reports.raw');
      assert.equal(record.acks, -1);
      const report = JSON.parse(record.messages[0].value);
      assert.ok(validate(report), JSON.stringify(validate.errors));
      assert.deepEqual(
        Object.keys(report).sort(),
        [...provisionalRawReportSchema.required].sort(),
      );
      assert.equal(record.messages[0].key, String(report.report_id));
      assert.equal(report.schema_version, '1.0.0');
      assert.equal(report.is_official, false);
      assert.equal(report.content, posts[index].text.normalize('NFC').trim());
      assert.equal(report.report_url, posts[index].url);
      assert.equal(report.account_name, posts[index].authorHandle);
      assert.equal(report.language, index % 2 ? 'ar' : 'unknown');
      assert.deepEqual(report.media_type, [
        'text',
        ...posts[index].media.map((media) => media.type),
      ]);
      assert.equal(report.collected_at, batch.scrapedAt);
      assert.equal(report.published_at, '2026-10-19T14:30:00.000Z');
      generatedReports.push(report);
    }
    assert.deepEqual(batch, snapshot);
  }
  for (const text of ['', ' ', '\n\t', null, undefined, 42, '<p>HTML</p>']) {
    const batch = createMockBatchResult({
      posts: [createMockScrapedPost(), createMockScrapedPost({ text })],
    });
    captured.length = 0;
    await assert.rejects(() => workflow.run('ProfileScrapeResult', batch), {
      code: 'validation_failed',
    });
    assert.equal(captured.length, 0);
    invalidCases.push({
      field: 'content',
      value: text === undefined ? '(missing)' : text,
      rejected: true,
      kafkaSends: 0,
    });
  }
  for (const language of ['zz', 'eng', 'EN', 42, {}, ['en']]) {
    const post = createMockScrapedPost();
    post.language = language;
    captured.length = 0;
    await assert.rejects(
      () =>
        workflow.run(
          'ProfileScrapeResult',
          createMockBatchResult({ posts: [post] }),
        ),
      { code: 'validation_failed' },
    );
    assert.equal(captured.length, 0);
    invalidCases.push({
      field: 'language',
      value: language,
      rejected: true,
      kafkaSends: 0,
    });
  }
  for (const [fields, code] of [
    [{ url: 'not a URL' }, 'validation_failed'],
    [{ authorHandle: 42 }, 'validation_failed'],
    [
      { media: [{ type: '', url: 'https://example.com/media' }] },
      'validation_failed',
    ],
    [{ publishedAt: 'not a date' }, 'mapping_failed'],
  ]) {
    captured.length = 0;
    await assert.rejects(
      () =>
        workflow.run(
          'ProfileScrapeResult',
          createMockBatchResult({ posts: [createMockScrapedPost(fields)] }),
        ),
      { code },
    );
    assert.equal(captured.length, 0);
    invalidCases.push({ fields, code, rejected: true, kafkaSends: 0 });
  }
  captured.length = 0;
  await assert.rejects(
    () =>
      workflow.run(
        'ProfileScrapeResult',
        createMockBatchResult({ scrapedAt: 'not a date' }),
      ),
    { code: 'mapping_failed' },
  );
  assert.equal(captured.length, 0);
  invalidCases.push({ field: 'collected_at', rejected: true, kafkaSends: 0 });

  await module.close();
  module = undefined;
  assert.equal(connections, 1);
  assert.equal(disconnections, 1);
  const summary = {
    execution:
      'Compiled TransformerModule instantiated through Nest DI; all real processors executed.',
    transport:
      'KafkaJS producer transport captured; no broker contacted and no real broker acknowledgment.',
    schemaUsed: 'src/contracts/provisional-raw-report.schema.ts',
    authoritativeDESchemaAvailable: false,
    missingLanguageDefaultsToUnknown: true,
    generatedRuns: {
      batches: 100,
      reports: generatedReports.length,
      allPassedLocalSchema: true,
      inputUnchanged: true,
    },
    invalidCases: { count: invalidCases.length, allRejectedBeforeKafka: true },
    schemaVersion: '1.0.0',
    unchangedBatch: {
      metadata: {},
      reports: wholeBatchReports.length,
      exactLocalSchemaValidation: true,
      actualLanguages: wholeBatchReports.map((report) => report.language),
      contentLanguagesForReference: ['en', 'ar'],
      languagePolicy:
        'No language detection. Missing collector language is explicitly unknown.',
    },
    separateCallsWithExplicitLanguages: {
      actualLanguages: splitReports.map((report) => report.language),
      exactLocalSchemaValidation: true,
    },
    contractNotes: {
      schema_version: 'Always the string 1.0.0, as confirmed by the user.',
      language: 'ISO 639-1 or unknown, as confirmed by the user.',
      report_id:
        'Signed int32 JSON integer, as confirmed by the user; Kafka key is its decimal string.',
      nullableNames:
        'account_name and channel_name remain nullable in the provisional local rules.',
    },
    inputUnchanged: true,
    stages,
  };
  const directory = new URL('./output/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries({
    'supplied-batch.kafka-records.json': wholeBatchRecords,
    'supplied-batch.raw-reports.json': wholeBatchReports,
    'split-by-language.raw-reports.json': splitReports,
    'sample-run.summary.json': summary,
    'generated-mocks.raw-reports.json': generatedReports,
    'generated-mocks.invalid-cases.json': invalidCases,
  }))
    await writeFile(
      new URL(name, directory),
      JSON.stringify(value, null, 2) + '\n',
      'utf8',
    );
  console.log(
    JSON.stringify(
      {
        summary: {
          ...summary,
          stages: undefined,
          processorExecutions: stages.length,
        },
        actualKafkaValuesForUnchangedBatch: wholeBatchReports,
      },
      null,
      2,
    ),
  );
} finally {
  await module?.close();
  Kafka.prototype.producer = originalProducer;
}
