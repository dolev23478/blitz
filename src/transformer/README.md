# Transformer contract and durable publication

The Transformer receives `ParsedMessage`, `ProfileScrapeResult` or `RadioTranscript` directly from
other services. Redis stores publication jobs, not collector input. One shared
`javascript-state-machine` workflow maps, validates, publishes and completes.

Radio uses `workflow.run('RadioTranscript', clip)`. Its mapper accepts the existing
archived JSON and maps `text` to content, ASR language to `languages`, and station
name to account/channel/title. Platform is `AM/FM-RADIO`; media is `['text']`
because RAW_REPORT does not permit audio. Original WAV evidence stays archived.
Optional collector `languages`, categories and matches are
preserved. Caller metadata fills missing fields; absent categories/matches become
empty arrays. The ASR language remains the fallback when no language array exists.

Each report URL is `/api/radio/clips/<clipId>` under `RADIO_PUBLIC_BASE_URL`
(or `http://localhost:PORT` locally), giving separate clips distinct URLs rather
than reusing the live stream address. No producer report ID is assigned.
Capture end becomes `collected_at`; `published_at` is null because original
broadcast time is unknown. Waveforms/segment data are not extra wire fields.

The full application's `RadioTransformerModule` registers the handoff after
filtering and archiving. It applies the same shared auto-language dictionary
analysis used by Telegram/X before invoking the Transformer. No-speech and
unmatched clips are discarded. Analysis terms/categories enrich a copy of the input;
ASR/collector ISO languages are preserved. The handoff awaits the existing
publisher confirmation/retries; invalid content is rejected and archives remain
on failure. Shutdown leaves admitted reports to the publisher's Redis recovery.
Capture-only `radio:once`/`radio:demo` commands import `RadioModule` only and never publish.
`radio:start` imports the same integrated path as the full app; it runs only radio
with filtering and real publication (optionally `--once`). Archives
are not automatically replayed.

To test archived radio JSON through the compiled workflow without infrastructure:
`node --import tsx test/transformer/run-radio-sample.mjs` after building. Outputs
are in `.radio/transformer-verification`; Redis/Kafka are mocked in this runner.

## Wire contract

The current user-requested output includes:

```json
{
  "schema_version": 1,
  "languages": ["he", "en"],
  "categories": ["terror"],
  "media_type": ["text", "photo"]
}
```

This is a partial illustration, not a complete valid report. The complete field
set is in `src/contracts/schema.ts`. Outgoing JSON never includes `language`.
New collector `languages` takes precedence over legacy `language`; per-message
values precede batch/caller fallbacks. Legacy strings are wrapped. Missing/null/
blank language becomes `[]`; invalid nonempty codes or invalid array entries fail.
Categories are passed through as string arrays, with `[]` when absent. The shared
collector analyzer supplies dev dictionary report labels (`terror`,
`civil_emergency`, `riots`, `rockets_aerial`), rather than evaluation concept IDs. The
Transformer does not detect languages, translate content or infer categories.

`schema_version` is the integer major version `1`. The `report_id` field is
omitted from RawReport and generated on the consumer side.

Only `text`, `photo`, `video` are allowed in RAW_REPORT.media_type:

| Collector type               | Mapping policy                                          |
| ---------------------------- | ------------------------------------------------------- |
| `photo`, `video`             | Preserve the supported type                             |
| `gif`, `animated_gif`        | Map animation to `video`                                |
| `audio`, `document`, `other` | Omit the unsupported attachment label; keep parsed text |
| Unrecognized label           | Reject mapping instead of guessing                      |

Every mapped report includes `text`. Empty content still fails even if media is
present. Original collector objects/attachments are not mutated. Direct wire
objects containing unsupported media values fail validation as well.

The supplied `schemas-new-2.html` RAW_REPORT table has been compared with this
contract. Its `categories` has no defined enum. It still lists `language: string`;
the user's explicit `languages: string[]` requirement takes precedence. See the complete
[field comparison](../contracts/raw-report.reference.md), including unresolved
nullability assumptions.

The executable DE JSON Schema has **not yet been supplied**; the new HTML is a
human-readable field table. The local schema is explicitly provisional.
`DE_RAW_REPORT_SCHEMA_PATH` loads a trusted JSON Schema
(draft-07, 2019-09 or 2020-12) and applies it in addition to local safety rules.
Language/category enums, requiredness, media constraints and major
version must be reconciled with that file once received. ISO code membership is
checked locally meanwhile.

## Redis retry storage

Set `REDIS_URL`, `KAFKA_BROKERS` and any required Kafka TLS/SASL credentials.
`TRANSFORMER_RETRY_PREFIX` defaults to `blitz:{reports.raw}:outbox`; all application
instances for the same queue must share it. Keep a common `{...}` hash tag when
using Redis Cluster. Use isolated Redis/Kafka infrastructure and a unique prefix
for tests. No extra Redis client or Redis dependency package is introduced.

- The entire validated batch is atomically admitted before any Kafka send.
- Jobs store the original canonical JSON as an opaque `payload` string, plus
  `attempts`, `retryCount`, `nextRetryAt`, status and bounded error history.
  Keeping JSON opaque prevents Redis Lua/cjson from converting empty arrays to objects.
- Pending jobs have no TTL. Their FIFO list and records survive application restarts.
- Identical serialized submissions share a job/receipt. This is admission
  idempotency, not general upstream report deduplication or an exactly-once guarantee.
- One token-checked Redis-primary lease (120s, renewed every 40s) owns the head.
  All mutations check its token and head ID. Scheduling polls at 250ms; the
  persisted nextRetryAt uses Redis time. Instances do not reset a failed head's
  retry time when new reports arrive.
- Each claimed processing attempt is persisted before calling Kafka. An
  interrupted/uncertain attempt consumes the retry budget, preventing restart loops.
- Acknowledgments require the expected topic and zero error code. Only after
  acknowledgment does an atomic finish operation remove the head and its record.
- Redis finish errors are not treated as Kafka-send failures. An uncertain Redis
  result leaves recovery responsible; the publisher does not immediately resend.
- Default delay is `KAFKA_RETRY_INTERVAL_MS=60000`. The user approved exactly
  **three retries after the initial attempt**, at most four processing attempts.
- After exhaustion, the user explicitly chose permanent discard: remove the job,
  log `kafka_report_discarded`, reject waiting workflow calls, and continue FIFO.
  There is no quarantine, reports.dlq publication or report archive in this policy.
- A 60s terminal receipt (status only, no original report) allows waiting callers
  on different instances to observe confirmation/discard. It is not permanent
  deduplication; after expiry, a deliberate resubmission can create new work.
- Redis unavailable during admission means rejection before any Kafka send. The
  caller must retain/retry its input; there is no fallback in-memory report queue.
- Shutdown waits for active processing, rejects unresolved local callers and
  leaves pending persisted records for a subsequent instance. Startup resumes work
  when both Redis and Kafka are configured.

KafkaJS uses idempotent production and one in-flight request. The queue owns the
three application retries; one bounded producer transport retry is needed for
KafkaJS idempotent mode. This does not make Kafka and Redis one atomic transaction:
a lost Kafka acknowledgment, crash before Redis finish, lease expiry or Redis
failover can cause redelivery. Redis-primary leases do not provide consensus
across asynchronous failover. Consumers must tolerate at-least-once delivery.

Redis server durability is an infrastructure prerequisite: configure persistence
(e.g. AOF), adequate capacity and a non-evicting policy. Application persistence
does not itself guarantee survival of Redis data loss. Keep the queue keys private
to this component and monitor discards, lease loss and Redis availability.

## Verification

```powershell
npm run build
npx tsc --noEmit
npm run lint
npm test
node --import tsx test/transformer/run-batch-sample.mjs
node --import tsx test/transformer/run-telegram-sample.mjs
```

The sample runners use a storage double and a mocked Kafka transport. Unit tests
exercise contract changes, duplicate admission, multi-instance coordination,
restart recovery, bounded retries and acknowledgment-before-removal behavior.
They do not prove actual Redis Lua or Kafka integration.

Opt-in integration tests:

```powershell
$env:REDIS_TEST_URL='redis://localhost:6379'
npx vitest run test/transformer/redis-retry.integration.spec.ts
$env:KAFKA_TEST_BROKERS='localhost:9092'
npx vitest run test/transformer/kafka.integration.spec.ts
```

Only use isolated test infrastructure. The Redis suite runs actual Lua and client
restart checks. The Kafka suite needs both endpoints and checks actual JSON/key
round-trip (with no producer-assigned ID or Kafka key). Both skip when their endpoints are not supplied; a skip is not an
integration success. A test-specific JSON Schema is not the final DE contract.
