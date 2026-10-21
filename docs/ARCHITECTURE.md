# Architecture

blitz is a NestJS (Fastify) service that collects OSINT from **Telegram**, **X** and
public internet **radio**, filters content through the shared text analyzer, and
publishes accepted content as `RAW_REPORT` messages to **Kafka**. There is no
database. Redis stores collector cursors/claims and the Transformer's durable
publication outbox.

Radio flow: public stream -> bounded WAV capture -> local ASR -> local archive ->
`RadioTransformerHandoff` -> `analyzeText(text, 'auto')` -> accepted metadata ->
the same `TransformerWorkflow` -> existing Redis outbox -> Kafka. Empty or
unmatched transcripts remain archived. Language/dictionary matching is done
before the Transformer; the Transformer maps and validates the contract.

`npm start` initializes all three integrations. `npm run radio:start` builds and
starts only the radio integration and protected clip HTTP routes; add
`-- --once --station=<id>` for a bounded cycle. It imports no Telegram/X modules.
`radio:once` remains a capture-only diagnostic. See `src/radio/README.md` for
stage log events and test modes.

```
 Telegram (MTProto)                         X (twitterapi.io)
   │ live push + catch-up pull                │ cron, every 5 min
   ▼                                          ▼
 TelegramService ──emit──▶ MessageEvents   XScraperCronService
   │ (Redis cursor)            │              │ (Redis cursor)
   │                           ▼              │
   │                  TelegramListenerService │
   │                   dedupe (Redis) ·       │ dictionary match
   │                   dictionary match       │
   └──────────────┬───────────────────────────┘
                  ▼
        TransformerWorkflow
   parsing → mapping → validation → publishing → completion
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
              local Kafka (primary)               remote Kafka (optional mirror)
              reports.raw, retry queue            SASL_SSL, best effort
```

## Modules (`src/`)

| Path | Role |
|---|---|
| `main.ts` | Bootstrap: loads `.env`, Nest + Fastify, JSON parser, CORS, shutdown hooks. |
| `config/` | zod-validated environment (`APP_CONFIG`). Only keys declared in the schema reach `ConfigService`. |
| `redis/` | `RedisService`: `get`/`set`, `setIfAbsent` (`SET NX EX`), `del`, hashes. Disabled when `REDIS_URL` is empty. |
| `telegram/` | `TelegramService` (connection, channel resolution, ordered pulls, cursor), `TelegramListenerService` (dedupe, dictionary match, hand-off), `telegram-channels.ts` (the `TELEGRAM_CHANNELS` constant), `telegram.mapper.ts`. |
| `tg-realtime/` | MTProto helpers: login, message listener, history extractor, watchdog, flood-wait handling. |
| `x-scraper/` | `XScraperCronService` (5-minute cycle), `XScraperService` (query building and chunking), twitterapi.io / Apify providers, monitored handles. |
| `events/` | `MessageEventsService`: in-process bus between `TelegramService` and the listener. |
| `media/` | `MediaStorageService`: uploads photos of matched X posts (downloaded from the X URL) and Telegram messages (downloaded over MTProto) to S3 and returns the public URL, which replaces `MediaItem.url` and fills `media_urls`. Photos only, max `MEDIA_MAX_MB`. Disabled (original URLs kept) unless `S3_BUCKET` is set; `S3_PUBLIC_BASE_URL` defaults to the direct S3 URL (`https://<bucket>.s3.<region>.amazonaws.com`). On Kubernetes (pre-prod/prod), auth is handled seamlessly via IRSA (`s3-uploader-sa`) without static keys; `S3_ENDPOINT` allows MinIO or any S3-compatible store. A failed upload never blocks the report. |
| `radio/` | Sequential internet audio capture/local ASR and WAV/JSON/text archive. `RadioTransformerHandoff` applies the shared analyzer, logs filter decisions, and hands accepted JSON to the common Transformer. |
| `match/`, `dictionaries/`, `normalize/`, `text-analyzer.ts` | Keyword dictionaries and text analysis used to decide which posts are kept. |
| `transformer/` | State machine that turns a source payload into a validated `RAW_REPORT` and publishes it. |
| `meta/` | `GET /api/health`. `GET /api/telegram` (in `telegram/`) reports the connection state. |

## Resuming without gaps (Redis)

| Key | Written by | Meaning |
|---|---|---|
| `telegram:cursor:<channelId>` | `TelegramService` only | JSON `{channelId, channel, messageId, date}` of the newest message handed over for that channel. Only ever moves forward (atomic Lua compare on `date`). |
| `telegram:session-lock` | `TelegramService` | `SET NX EX 120` lock holding this process's token. Startup is aborted when it is held elsewhere or Redis is down; the watchdog renews it every tick; it is released on shutdown (SIGTERM/SIGINT). Lost lock = collector stops. `REDIS_URL` is required (fails closed). The standalone `src/tg-realtime/index.ts` runner takes the same lock. TTL is 120 s because the watchdog renews every 30 s. |
| `telegram:peer:<username>` | `TelegramService` | `{id}` cache of a resolved channel, 30-day TTL, so restarts don't call ResolveUsername. Dropped when a pull hits a stale-peer error. |

FloodWait: `withFloodWait` sleeps the requested seconds plus 0.5–2 s jitter. A wait above 300 s is not slept: it starts a cooldown, the pull cycle stops, and the next sync retries.
| `telegram:mtcute-state` | `TelegramService` (mtcute storage) | JSON snapshot of mtcute's storage (update state pts/qts/seq/date, per-channel pts, auth keys, peer cache), written at most every 5 s and on shutdown. After a restart mtcute asks Telegram for the updates it missed. Tied to a hash of `TG_SESSION_STRING`; a different string starts clean. **Contains the auth key: keep Redis private.** |
| `x:last-scrape-at` | `XScraperCronService` only | Start time of the last X cycle that was handed to the transformer. |
| `telegram:seen:<channel>:<id>:<n\|e>` | `TelegramListenerService` | Claim marker, kept 2 days, so a message is published once. `e` marks an edited message. |

- A cursor is saved only after its batch succeeded, so a failure re-pulls the same window next time.
- **Telegram:** on connect/reconnect and on every watchdog sync (`TG_SYNC_SECONDS`) it pulls each channel from its saved cursor time (last 24 h when no cursor). The pull is paginated: pages of 100 messages are read oldest first with a 200-500 ms pause between requests, and the cursor is committed after every page the listener handled, so a failure resumes at the last committed page and there is no size ceiling. A pull stops as soon as a page's newest message precedes the cursor, or equals it (that page is handled once, the dedupe claim removes the repeats). Channels are pulled one at a time. Live messages are accepted by username even if the channel was not resolved yet.
- A live message advances its channel's cursor after the listener succeeded, but only once that channel's catch-up pull has completed on this connection and no pull is running (otherwise a failed pull would leave a permanent gap). The `telegram:seen:` claim still removes the re-read duplicates. If publishing fails, the claim is released so the next pull retries it.
- **X:** each cycle searches posts since the cursor. Handles are split into queries of at most 500 characters (twitterapi.io limit is 512) with a pause between them to avoid 429s.

## Transformer and Kafka

`TransformerWorkflow` runs one input through `parsing → mapping → validation → publishing → completion`.
Inputs are `ParsedMessage` (Telegram), `ProfileScrapeResult` (X), and
`RadioTranscript` (radio). Radio identity uses the clip's archive URL, not the
station's shared stream URL. Nonnegative int32 hash IDs are deterministic but can
collide; they are not a globally unique allocation service.

- **Primary Kafka** (`KAFKA_BROKERS`, optional SASL/SSL): topic `reports.raw`, acks from all replicas. Reports are admitted to the existing Redis outbox before sending. It survives application restarts, uses token-checked processing leases and retries after `KAFKA_RETRY_INTERVAL_MS`. The approved policy is initial attempt plus three retries, then permanent discard. Lost acknowledgments/crashes can cause redelivery; this is at-least-once. The topic must exist (auto-create is off).
- **Remote Kafka mirror** (`KAFKA_REMOTE_*`): every report is also sent to a second cluster over SASL_SSL (SCRAM-SHA-512, optional custom CA via `KAFKA_REMOTE_SSL_CA_FILE`). It has its own bounded in-memory queue (5000 reports) and never blocks the primary publisher. Off unless `KAFKA_REMOTE_BROKERS` is set.

## Operational rules

- Run **one** instance. A Telegram session can only be active in one place; do not run the app locally while it runs in the remote environment.
- Redis is required for gap-free resume. Without it, Telegram and X fall back to a 24 h window on every start.
- Secrets (`TG_SESSION_STRING`, `TWITTERAPI_IO_KEY`, Kafka passwords) live in `.env`, which is git-ignored.
