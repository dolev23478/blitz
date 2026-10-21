# Architecture

blitz is a NestJS (Fastify) service that collects OSINT posts from **Telegram** and **X**, keeps only those that match a keyword dictionary, and publishes them as `RAW_REPORT` messages to **Kafka**. There is no database: **Redis** only stores the last pull time per source and a short-lived "already seen" marker for Telegram messages.

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
| `match/`, `dictionaries/`, `normalize/`, `text-analyzer.ts` | Keyword dictionaries and text analysis used to decide which posts are kept. |
| `transformer/` | State machine that turns a source payload into a validated `RAW_REPORT` and publishes it. |
| `meta/` | `GET /api/health`. `GET /api/telegram` (in `telegram/`) reports the connection state. |

## Resuming without gaps (Redis)

| Key | Written by | Meaning |
|---|---|---|
| `telegram:cursor:<channelId>` | `TelegramService` only | JSON `{channelId, channel, messageId, date}` of the newest message handed over for that channel. |
| `x:last-scrape-at` | `XScraperCronService` only | Start time of the last X cycle that was handed to the transformer. |
| `telegram:seen:<channel>:<id>:<n\|e>` | `TelegramListenerService` | Claim marker, kept 2 days, so a message is published once. `e` marks an edited message. |

- A cursor is saved only after its batch succeeded, so a failure re-pulls the same window next time.
- **Telegram:** on connect/reconnect and on every watchdog sync (`TG_SYNC_SECONDS`) it re-pulls each channel's messages posted at or after its saved cursor time (ids are not used; the boundary message is re-read and removed by the dedupe claim) (last 24 h when no cursor; at most the newest 5000 per pull). A channel cursor advances only after the listener handled the batch. Channels are pulled one at a time and each channel's messages are emitted oldest to newest. Live messages are accepted by username even if the channel was not resolved yet.
- Live updates don't move the cursor, so the next pull can re-read them; the `telegram:seen:` claim removes those duplicates. If publishing fails, the claim is released so the next pull retries it.
- **X:** each cycle searches posts since the cursor. Handles are split into queries of at most 500 characters (twitterapi.io limit is 512) with a pause between them to avoid 429s.

## Transformer and Kafka

`TransformerWorkflow` runs one input through `parsing → mapping → validation → publishing → completion`. Inputs are `ParsedMessage` (Telegram) and `ProfileScrapeResult` (X). Reports have a deterministic `report_id`, so the same post always maps to the same id.

- **Primary Kafka** (`KAFKA_BROKERS`, optional SASL/SSL): topic `reports.raw`, acks from all replicas. Failed sends stay in an in-memory queue and are retried every `KAFKA_RETRY_INTERVAL_MS`; the queue is lost on restart. The topic must exist (auto-create is off).
- **Remote Kafka mirror** (`KAFKA_REMOTE_*`): every report is also sent to a second cluster over SASL_SSL (SCRAM-SHA-512, optional custom CA via `KAFKA_REMOTE_SSL_CA_FILE`). It has its own bounded in-memory queue (5000 reports) and never blocks the primary publisher. Off unless `KAFKA_REMOTE_BROKERS` is set.

## Operational rules

- Run **one** instance. A Telegram session can only be active in one place; do not run the app locally while it runs in the remote environment.
- Redis is required for gap-free resume. Without it, Telegram and X fall back to a 24 h window on every start.
- Secrets (`TG_SESSION_STRING`, `TWITTERAPI_IO_KEY`, Kafka passwords) live in `.env`, which is git-ignored.
