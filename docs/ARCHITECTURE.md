# Architecture

blitz is a NestJS (based Fastify server) micro-mono-service that collects OSINT from **Telegram**, **X** and **radio**, filters content through the shared text analyzer, and
publishes accepted content as `RAW_REPORT` messages to **Kafka**. There is no
database. Redis stores collector cursors/claims and the Transformer's durable
publication outbox.

Radio flow: public stream -> bounded in-memory WAV capture -> local offline ASR ->
`analyzeText(text, 'auto')` -> accepted transcript log -> `RadioTransformerHandoff`
-> shared `TransformerWorkflow` -> Redis outbox -> Kafka. There are no audio,
JSON/TXT transcript files or archive HTTP routes. Rejected transcript text is not
logged. All collectors use `analysis.categories` from dev dictionaries (`terror`,
`civil_emergency`, `riots`, `rockets_aerial`), not evaluator concept labels.

`npm start` initializes all three integrations. `npm run radio:start` builds and
starts only the radio integration and the Transformer/Kafka path; add
`-- --once --station=<id>` for a bounded cycle. It imports no Telegram/X modules.
`radio:once` remains a capture-only diagnostic. See `src/radio/README.md` for
stage log events and test modes.

```text
Telegram (MTProto)       X (twitterapi.io / Apify)       Radio (HTTP audio + local ASR)
      |                            |                               |
MessageEventsService      XScraperCronService               RadioService
      |                            |                               |
TelegramListenerService     shared analyzer                 shared analyzer
      |                            |                      accepted transcript log
      +----------------------------+-------------------------------+
                                   |
                         TransformerWorkflow
             parsing -> mapping -> validation -> publishing -> completion
                                                     |
                                          durable Redis outbox
                                                     |
                                          primary Kafka reports.raw
                                                     |
                                       optional best-effort Kafka mirror
```

## Modules (`src/`)

| Path                                                        | Role                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts`                                                   | Bootstrap: loads `.env`, Nest + Fastify, JSON parser, CORS, shutdown hooks.                                                                                                                                                    |
| `config/`                                                   | zod-validated environment (`APP_CONFIG`). Only keys declared in the schema reach `ConfigService`.                                                                                                                              |
| `redis/`                                                    | `RedisService`: `get`/`set`, `setIfAbsent` (`SET NX EX`), `del`, hashes. Disabled when `REDIS_URL` is empty.                                                                                                                   |
| `telegram/`                                                 | `TelegramService` (connection, channel resolution, ordered pulls, cursor), `TelegramListenerService` (dedupe, dictionary match, hand-off), `telegram-channels.ts` (the `TELEGRAM_CHANNELS` constant), `telegram.mapper.ts`.    |
| `tg-realtime/`                                              | MTProto helpers: login, message listener, history extractor, watchdog, flood-wait handling.                                                                                                                                    |
| `x-scraper/`                                                | `XScraperCronService` (5-minute cycle), `XScraperService` (query building and chunking), twitterapi.io / Apify providers, monitored handles.                                                                                   |
| `events/`                                                   | `MessageEventsService`: in-process bus between `TelegramService` and the listener.                                                                                                                                             |
| `radio/`                                                    | Sequential in-memory audio capture and local offline ASR, with accepted-only transcript logs. `RadioTransformerHandoff` applies the shared analyzer, logs filter decisions, and hands accepted JSON to the common Transformer. |
| `match/`, `dictionaries/`, `normalize/`, `text-analyzer.ts` | Keyword dictionaries and text analysis used to decide which posts are kept.                                                                                                                                                    |
| `transformer/`                                              | State machine that turns a source payload into a validated `RAW_REPORT` and publishes it.                                                                                                                                      |
| `meta/`                                                     | `GET /api/health`. `GET /api/telegram` (in `telegram/`) reports the connection state.                                                                                                                                          |

## Resuming without gaps (Redis)

| Key                           | Written by             | Meaning                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `telegram:cursor:<channelId>` | `TelegramService` only | JSON `{channelId, channel, messageId, date}` of the newest message handed over for that channel. Only ever moves forward (atomic Lua compare on `date`).                                                                                                                                                                                                                                          |
| `telegram:session-lock`       | `TelegramService`      | `SET NX EX 120` lock holding this process's token. Startup is aborted when it is held elsewhere or Redis is down; the watchdog renews it every tick; it is released on shutdown (SIGTERM/SIGINT). Lost lock = collector stops. `REDIS_URL` is required (fails closed). The standalone `src/tg-realtime/index.ts` runner takes the same lock. TTL is 120 s because the watchdog renews every 30 s. |
| `telegram:peer:<username>`    | `TelegramService`      | `{id}` cache of a resolved channel, 30-day TTL, so restarts don't call ResolveUsername. Dropped when a pull hits a stale-peer error.                                                                                                                                                                                                                                                              |

FloodWait: `withFloodWait` sleeps the requested seconds plus 0.5–2 s jitter. A wait above 300 s is not slept: it starts a cooldown, the pull cycle stops, and the next sync retries.
| `telegram:mtcute-state` | `TelegramService` (mtcute storage) | JSON snapshot of mtcute's storage (update state pts/qts/seq/date, per-channel pts, auth keys, peer cache), written at most every 5 s and on shutdown. After a restart mtcute asks Telegram for the updates it missed. Tied to a hash of `TG_SESSION_STRING`; a different string starts clean. **Contains the auth key: keep Redis private.** |
| `x:last-scrape-at` | `XScraperCronService` only | Start time of the last X cycle that was handed to the transformer. |
| `telegram:seen:<channel>:<id>:<n\|e>` | `TelegramListenerService` | Claim marker, kept 2 days, so a message is published once. `e` marks an edited message. |

- A cursor is saved only after its batch succeeded, so a failure re-pulls the same window next time.
- **Telegram:** on connect/reconnect and on every watchdog sync (`TG_SYNC_SECONDS`) it pulls each channel from its saved cursor time (last 24 h when no cursor). The pull is paginated: pages of 100 messages are read oldest first with a 200-500 ms pause between requests, and the cursor is committed after every page the listener handled, so a failure resumes at the last committed page and there is no size ceiling. A pull stops as soon as a page's newest message precedes the cursor, or equals it (that page is handled once, the dedupe claim removes the repeats). Channels are pulled one at a time. Live messages are accepted by username even if the channel was not resolved yet.
- A live message advances its channel's cursor after the listener succeeded, but only once that channel's catch-up pull has completed on this connection and no pull is running (otherwise a failed pull would leave a permanent gap). The `telegram:seen:` claim still removes the re-read duplicates. If publishing fails, the claim is released so the next pull retries it.
- **X:** each cycle searches posts since the cursor. Handles are split into queries of at most 500 characters (twitterapi.io limit is 512) with a pause between them to avoid 429s. A running cycle skips subsequent timer ticks, preventing overlapping scrapes/publications when a provider or Kafka is slow.

## Transformer and Kafka

`TransformerWorkflow` runs one input through `parsing → mapping → validation → publishing → completion`.
Inputs are `ParsedMessage` (Telegram), `ProfileScrapeResult` (X), and
`RadioTranscript` (radio). Radio identity uses the station stream URL
with a unique `#clip=<UUID>` fragment; no historical recording is retained. Its platform is `AM/FM-RADIO`. Producers do not
assign or publish `report_id`; the consumer owns ID assignment. Kafka records
use the unchanged `report_url` as their string key. Internal outbox job IDs only coordinate retries.
`schema_version` is the integer `1`; `languages` and `categories` are arrays.
Legacy collector `language` is normalized to `languages`. The supplied HTML field
table is not an executable DE JSON Schema; local validation remains provisional.
A trusted final schema can be supplied through `DE_RAW_REPORT_SCHEMA_PATH`.

- **Primary Kafka** (`KAFKA_BROKERS`, optional SASL/SSL): topic `reports.raw`, acks from all replicas. Reports are admitted to the existing Redis outbox before sending. It survives application restarts, uses token-checked processing leases and retries after `KAFKA_RETRY_INTERVAL_MS`. The approved policy is initial attempt plus three retries, then permanent discard. Lost acknowledgments/crashes can cause redelivery; this is at-least-once. The topic must exist (auto-create is off).
- **Remote Kafka mirror** (`KAFKA_REMOTE_*`): every report is also sent to a second cluster over SASL_SSL (SCRAM-SHA-512, optional custom CA via `KAFKA_REMOTE_SSL_CA_FILE`). It has its own bounded in-memory queue (5000 reports) and never blocks the primary publisher. Off unless `KAFKA_REMOTE_BROKERS` is set.

## Operational rules

- Run **one** instance. A Telegram session can only be active in one place; do not run the app locally while it runs in the remote environment.
- Redis is required for Telegram session ownership and durable publication. Telegram refuses to start with configured credentials but unavailable Redis; it does not bypass the session lock. A missing cursor uses a 24 h catch-up window.
- Secrets (`TG_SESSION_STRING`, `TWITTERAPI_IO_KEY`, Kafka passwords) live in `.env`, which is git-ignored.

## HTTP and dashboard

The root Nest application exposes `/api/health`, `/api/telegram`,
`/api/posts`, `/api/posts/stream` and
`/api/kafka/analytics/{stats,stream}`. Legacy `/health` and `/posts` aliases remain
available. Analytics SSE emits named `snapshot` and `kafka_event` events. Counters
start empty and reflect observed activity; they are in-memory operational stats,
not an audit log. Only confirmed primary Kafka publication increments published
counts. Statistics failures cannot retry already acknowledged reports.

`apps/web` connects to the root backend (default port 3000) and runs on port 3001.
`npm run build:web` builds the shared package and dashboard. `apps/api` is an
optional standalone demo API, not the collector backend; it also defaults to
3001, so do not run it alongside the dashboard on that port. Production uses the
root application's collector and analytics endpoints.

## Starting all collectors

`npm run start` builds and boots the root application, including Telegram, X and
radio. Set Telegram credentials, `TWITTERAPI_IO_KEY` (or the selected Apify
provider's credentials), `REDIS_URL` and `KAFKA_BROKERS` in `.env`. Create the
`reports.raw` topic and configure any required TLS/SASL credentials. For local
radio, prepare `vendor/radio-models/<model>` using `npm run radio:prepare-model`
on the connected machine. Runtime always uses local model files and fails clearly
if they are missing; it never downloads a model. Settings, durations and stations
are documented in `src/radio/README.md`.

For Linux closed-network builds from Git, prepare the Linux/Python dependency
image and models with `npm run offline:vendor` on the connected machine. Commit
`vendor/` (real binary files, no external/LFS download) and `.gitattributes` with
the source. `npm run image:build` on the target imports those assets locally;
only npm registry access is allowed/needed during the application build. The
normal Dockerfile does no apt/pip/GitHub/model downloads. A prebuilt image export
is also available through `npm run offline:prepare`. See
`docs/OFFLINE_DEPLOYMENT.md`. Live-source and Redis/Kafka connectivity remain
runtime infrastructure requirements.
