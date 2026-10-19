# Transformer

Each mapper accepts the collector's original JSON object directly.

| Format                | Mapper                            | Output                         |
| --------------------- | --------------------------------- | ------------------------------ |
| `ProfileScrapeResult` | `TwitterMappingStrategy`          | One report per post in `posts` |
| `StoredMessage`       | `TelegramMappingStrategy`         | One report from one message    |
| `MessageDto`          | `TelegramRealtimeMappingStrategy` | One report from one message    |

Other Nest services inject `TransformerWorkflow` and select the object's format:

```ts
await transformer.run('StoredMessage', message, { language: 'en' });
await transformer.run('ProfileScrapeResult', profileResult, {
  language: 'he',
  matches: ['news'],
});
await transformer.run('MessageDto', liveMessage, {
  language: 'en',
  reportUrl: originalMessageUrl,
  collectedAt: collectionTimestamp,
});
```

There are no collector envelopes or required `source`, `data` or `inputId`
fields to add to the JSON. A processing ID is generated for logging; callers may
supply `inputId` in the third argument when they already have a correlation ID.

Mappers also work directly, for example
`telegramMapper.map(message, { language: 'en' })`.
Each one imports the existing collector interface rather than defining another
version of it. The Transformer does not call collectors.

Supplemental metadata is separate from the collector object. The current
interfaces omit language, so the caller supplies it; the Transformer does not
detect it. `MessageDto` also lacks the report URL and collection time, so those
are required for that format. Matches default to an empty list.

`ProfileScrapeResult` contains its own array of posts. All posts in one call
use the supplied language and matches; split mixed-language results into calls
with the correct metadata. `StoredMessage` and `MessageDto` are single objects;
call the workflow for each message when consuming a list.

The state machine remains Parsing → Mapping → Validation → Publishing →
Completion. Parsing now only checks input limits and snapshots the objects.
Mapping chooses a typed strategy by source. Text is preserved as text, with NFC
normalization and trimming; `rawHtmlSnippet` is ignored. URLs are preserved.

All mapped reports are validated before any are published. An empty collector
result returns `[]`. Each result contains `inputId`, `reportId`, and status
`completed` after Kafka acknowledges publication.

Publication is sequential and is not atomic for the whole response. If Kafka
fails after some reports were acknowledged, the call rejects. The caller can
decide how to handle that partial outcome. The Transformer sends every supplied
report; input uniqueness and retry policy belong to the calling service.

The Transformer uses no Redis, database or publication cache. Other teams' database
modules in the same application are independent of this component.

Set `KAFKA_BROKERS` in `.env` to the actual broker bootstrap addresses, for example
`KAFKA_BROKERS=broker-1:9092,broker-2:9092`. The value is intentionally empty until
a broker is available. Use native Kafka host:port addresses,
not HTTP URLs. `.env.example` documents the client ID, TLS and optional SASL settings.
`reports.raw` must exist, and the broker's advertised addresses must be reachable.

Run `npx vitest run test/transformer` for the focused mapping, input, validation,
workflow and producer tests. Producer tests use a mocked KafkaJS transport.
The Kafka round-trip integration test is skipped unless `KAFKA_TEST_BROKERS` is
set in the process environment. Use an isolated plaintext test cluster: this test
creates `reports.raw` if necessary and publishes a synthetic report, then consumes
and verifies its key and JSON value. It does not use `KAFKA_BROKERS` implicitly.

Report IDs reuse the existing `reports/raw-report.mapper.ts` helper, based on
platform and unchanged URL. They are emitted as decimal strings under the
Transformer's provisional contract. This hash convention does not establish
global uniqueness across teams. The executable DE schema, final ID policy, and
wire representation remain pending; the retained schema version is `1.0.0`.

Input limits remain 1 MiB, 10,000 visited values/fields and depth 64. Accessors,
custom object types, circular/shared object references and unsafe numeric values
are rejected. Split larger collector results into smaller batches before calling
the Transformer.
