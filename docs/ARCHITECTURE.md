# How the system works

A TypeScript service that collects Telegram messages, stores them in PostgreSQL, and exposes them through a REST API (plus a tiny web UI). Two sources feed the same tables: **public channels without an account** (web‑preview scraper) and **groups/private chats with your account** (MTProto, live push).

- [Big picture](#big-picture)
- [Tech stack & libraries](#tech-stack--libraries)
- [Project structure](#project-structure)
- [Data collection](#data-collection) — scraping, parsing, backfill, polling, scheduler
- [Call flows](#call-flows)
- [Database](#database)
- [API layer](#api-layer)
- [Frontend](#frontend)
- [Configuration](#configuration)
- [Running, testing, operating](#running-testing-operating)
- [Design decisions, limits & extending](#design-decisions-limits--extending)

---

## Big picture

```
                     ┌──────────────────────── Nest app (src/main.ts) ─────────────────────────────┐
 t.me/s/<channel>    │                                                                              │
 (public web preview)│   ┌────────────┐   ┌───────────┐   ┌──────────────┐    ┌───────────────┐      │
        ▲            │   │ Collector  │──▶│ backfill/ │──▶│   Scraper    │    │ Controllers   │◀─────┼── your app / UI
        │  HTTP GET  │   │ (timer)    │   │ poller    │   │ http+parser  │    │ + static UI   │      │
        └────────────┼───┴────────────┘   └─────┬─────┘   └──────────────┘    └───────┬───────┘      │
                     │                          │ upsert                              │ services     │
                     │                          ▼                                     ▼              │
                     │                  ┌─────────────────── repositories ───────────────────┐       │
                     │                  │ ChannelsRepository · MessagesRepository (pg)       │       │
                     │                  └──────────────────────────┬─────────────────────────┘       │
                     │      MessageEventsService ──────────────────┼──▶ SSE /api/messages/stream     │
                     └─────────────────────────────────────────────┼────────────────────────────────┘
                                                                   ▼
                                                           PostgreSQL
```

One process does everything: the **collector** (timer‑driven) writes to Postgres; the **API** reads from Postgres. They communicate only through the database and a small in‑memory event bus (used for the live SSE notifications).

**Why no account?** Telegram serves a public, server‑rendered HTML preview of every public channel at `https://t.me/s/<username>`. We fetch and parse that HTML. It needs no login, API ID, or bot token — but it only exists for public channels.

## Telegram account source (MTProto)

For groups, private chats and numeric ids the service logs in as your user via `@mtcute/node` (code reused from `src/tg-realtime/`). Channels with `source = 'mtproto'` are **not polled**; they get a 7‑day backfill, a catch‑up from `lastPolledAt` at startup, and live push through `@mtcute/dispatcher`.

- `src/telegram/telegram.service.ts` — `TelegramService` (injectable): client lifecycle (`onApplicationBootstrap` / `onApplicationShutdown`), `status`, `addChannel`, `backfill`, `untrack`, live listener, watchdog wiring (`catchUp`, `reconnectForever`). `telegram.mapper.ts` holds the pure helpers (`toParsedMessage`, `extractNumericId`). Chat ids are kept in a `Set` for O(1) filtering; messages are mapped to `ParsedMessage` and upserted like scraped ones (extra columns: `sender_id`, `forwards`, `reactions`; channels: `tg_chat_id`, `source` — migration `002_mtproto.sql`).
- `src/tg-realtime/client.ts` — headless client: in-memory storage, session only from `TG_SESSION_STRING`, never prompts (a rejected session fails with a clear error).
- `src/tg-realtime/utils/watchdog.ts` — probe (`updates.getState`) every `TG_WATCHDOG_SECONDS`; soft recovery (restart updates loop) → hard recovery (rebuild client from the string, backoff) → catch‑up sync; plus a periodic safety‑net sync every `TG_SYNC_SECONDS`.
- `scripts/generate-session.ts` — local‑only interactive login (`npm run auth`) that prints `TG_SESSION_STRING`.
- `src/telegram/telegram.controller.ts` — read‑only `GET /api/telegram` status.
- Resilience: FLOOD_WAIT is honoured (`withFloodWait`); mtcute reconnects sockets itself; the watchdog covers silent stalls without exiting the process.

## Tech stack & libraries

| Library | Version | Used for |
|---|---|---|
| **Node.js** | 24 | Runtime; built‑in `fetch`, `AbortSignal.timeout`, `node:crypto`, `node:events` |
| **TypeScript** | 6 | Language; `strict`, ESM (`"module": "NodeNext"`, imports end in `.js`) |
| **tsx** | 4 | Only used for the local `npm run auth` script; the app itself is built/run with the Nest CLI (`nest build`, `nest start`) |
| **NestJS** | 12 | Application framework: modules, controllers, services, guard (API key), exception filter, lifecycle hooks (`@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/platform-fastify`) |
| **Fastify** | 5 | HTTP server (via the Nest Fastify adapter) with `@fastify/static` (UI) and `@fastify/cors` |
| **pg** | 8 | PostgreSQL client (`Pool`, parameterized queries) |
| **cheerio** | 1 | jQuery‑like HTML parsing of the Telegram preview |
| **zod** | 4 | Validation of env config, request bodies and query strings |
| **dotenv** | 18 | Loads `.env` |
| **vitest** | 4 | Unit tests (`*.spec.ts` in `test/`) |
| **PostgreSQL** | 16 | Storage (point `DATABASE_URL` at any Postgres 16; the old setup used host port **5433**) |

Frontend: plain HTML/CSS/ES modules, no framework or build.

## Project structure

```
.env / .env.example         Configuration (loaded by @nestjs/config)
nest-cli.json · tsconfig*.json · vitest.config*.ts · oxlint.json   Blitz tooling
src/                        One Nest module per feature: <name>.module / .controller / .service / .repository
  main.ts                   Bootstrap: Nest + Fastify, JSON parser, CORS, static UI, shutdown hooks
  app.module.ts             Root module; global API-key guard + error filter
  types.ts                  Shared types (ParsedMessage, Channel, StoredMessage, MediaItem…)
  config/                   index.ts (AppConfigModule: @nestjs/config + zod validation, `APP_CONFIG` token) · app-config.ts (zod schema)
  database/                 database.service.ts (pg Pool + migrations on init) · migrate.ts · storage.module.ts
    migrations/             001_init.sql … 004_media_urls.sql (copied to dist by nest build)
  common/                   api-key.guard.ts (+ @Public) · http-error.filter.ts · zod.pipe.ts
  events/                   message-events.service.ts  In‑process bus (“new messages stored”) → SSE
  channels/                 controller (REST) · service (add/find/backfill rules) · repository (SQL) · dto
  messages/                 controller (list, SSE stream, get) · service (cursor/sinceId paging) · repository · dto
  meta/                     controller + service: /health, /stats
  scraper/                  http-client.service (throttled fetch) · scraper.service · parser.ts (pure) · username.ts (pure)
  collector/                collector.service (timer, concurrency, locking) · poller.service · backfill.service
  telegram/                 telegram.service (MTProto source + watchdog) · telegram.controller · media.controller · telegram.mapper (pure)
  tg-realtime/              mtcute client, listener, extractor, watchdog, resilience helpers (+ its own README)
public/                     index.html · app.js · i18n.js · style.css (EN/HE with RTL) · api.html + api.js (API console)
scripts/                    generate-session.ts (`npm run auth`)
test/                       parser.spec.ts · raw-report.spec.ts · tg-realtime/*.spec.ts + fixtures/durov.html (real saved page)
docs/                       API.md · ARCHITECTURE.md
```

Layering rule: **controller → service → repository → database**; the collector and Telegram source use scraper/repositories directly. Controllers never touch SQL, repositories hold all SQL, and the pure helpers (parser, username normalization, Telegram mapper) never touch the network or DB.

---

## Data collection

### 1. Scraping (`src/scraper`)

- **`httpClient.fetchHtml(url)`**
  - **Global throttle:** every request goes through a promise queue that guarantees at least `REQUEST_DELAY_MS` between *any* two requests, no matter how many channels run concurrently.
  - Browser‑like `User-Agent`, 15 s timeout.
  - **Retries** (3×) on network errors, `429` and `5xx` with exponential backoff (2 s, 4 s, 8 s) and `Retry-After` support. Other 4xx fail immediately (`HttpError`).
  - Returns `{ html, finalUrl }` — the final URL matters for the next point.
- **`channelScraper.fetchChannelPage(username, before?)`**
  - Requests `https://t.me/s/<username>` (newest ~20 posts) or `…?before=<messageId>` (the 20 posts before that id) — this is how we page backwards.
  - If a channel has no public preview Telegram **redirects to `https://t.me/<username>`**; we detect that (`finalUrl` no longer starts with `/s/`) and throw “not public”.
- **`normalizeUsername(input)`** accepts `name`, `@name`, `t.me/name`, `t.me/s/name/123`, `web.telegram.org/a/#@name`; validates against the username pattern `^[A-Za-z][A-Za-z0-9_]{3,31}$` (4–32 chars, letter first). Numeric ids (`web.telegram.org/#-100…`) throw `NumericChannelIdError`, since they can't be resolved without an account.
- **`validateChannel`** fetches the first page once on “add channel” to reject bad channels immediately and to read the title.

### 2. Parsing (`parser.ts`)

`parseChannelPage(html)` uses cheerio and returns `{ title, messages }`, sorted ascending by `messageId`. For each `.tgme_widget_message[data-post]`:

| Output field | Source selector / rule |
|---|---|
| `messageId` | last segment of `data-post="channel/123"` |
| `postedAt` | `<time datetime>` inside `.tgme_widget_message_date` |
| `text` | `.tgme_widget_message_text`, `<br>` → `\n`, tags stripped |
| `views` | `.tgme_widget_message_views` — `1.2K`/`5.82M` parsed to numbers (`parseViews`) |
| `media[]` | photos: `background-image` of `.tgme_widget_message_photo_wrap`; videos: `<video src>` + thumbnail; documents; audio |
| `links[]` | `<a href>` inside the text plus the link preview (`http(s)` only, de‑duplicated) |
| `forwardedFrom` | `.tgme_widget_message_forwarded_from_name` |
| `edited` | the word “edited” in `.tgme_widget_message_meta` |
| `url` | `https://t.me/<data-post>` |

Service messages (joins, pins…) are skipped. Because the parser is a pure function it's tested against a saved real page (`test/fixtures/durov.html`). **If Telegram changes its markup, this is the only file that needs updating.**

### 3. Backfill (`collector/backfill.ts`)

Runs once per channel after it's added (and on demand via `POST /channels/:ref/backfill`):

```
cutoff = now − days
before = undefined
repeat (max 500 pages):
    page = fetchChannelPage(channel, before)
    keep messages with postedAt ≥ cutoff → messageRepo.upsertMany → emit "messages" event
    stop if the oldest message on the page is older than cutoff (or id ≤ 1, or no progress)
    before = oldest messageId on the page
finally: channelRepo.markPolled(maxId, title) + markBackfilled
```

### 4. Polling (`collector/poller.service.ts`) — the “real‑time” part

For channels already backfilled, every tick:

```
lastId = channel.lastMessageId
page 0 = newest page
   new rows     = messages with messageId > lastId
   known rows   = messages with messageId ≤ lastId   → refreshMany (update views/text/edited only)
keep paging back (max 20 pages) while the oldest id on the page > lastId + 1
   (this catches bursts of >20 posts between two ticks)
upsertMany(new rows) → markPolled(maxId) → emit "messages" if anything was inserted
```

`lastMessageId` only moves forward (`GREATEST(...)` in SQL), so a failed or partial run never loses its place.

### 5. Scheduler (`collector/collector.service.ts`)

- `start()` runs a tick immediately, then every `POLL_SECONDS`.
- A tick loads active channels and processes them with up to `CONCURRENCY` workers (a shared queue). Actual network speed is still bounded by the global throttle.
- `tick()` is guarded by `running` so ticks never overlap.
- **Per‑channel lock** (`busy` set): the same channel is never processed twice at once (e.g. the timer fires while an add‑triggered backfill is still running). `isBusy(id)` feeds the `busy` field in the API.
- Choice per channel: `backfilledAt ? poll : backfill` — so a channel interrupted mid‑backfill simply restarts it.
- Errors are caught per channel, logged, and saved to `channels.last_error`; one bad channel never stops the others. A successful run clears the error.
- `runNow(channel)` (used right after “add channel”) and `backfillNow(channel, days)` start work immediately.

---

## Call flows

### Adding a channel — `POST /api/channels`

```
routes/channels.ts
  → zod validates body
  → normalizeUsername()                       400 on invalid / numeric id
  → channelRepo.getByUsername()               409 if exists
  → scraper.validateChannel()                 422 if not public (1 HTTP request)
  → channelRepo.create()
  → collector.runNow(channel)                 background: backfill → upsert → emit event
  ← 201 Channel (busy: true)
```

### Periodic collection

```
setInterval(POLL_SECONDS) → collector.tick()
  → channelRepo.listActive()
  → workers (≤ CONCURRENCY) → runExclusive(channel):
        poll(channel)  ─ fetchChannelPage → parser → messageRepo.refreshMany/upsertMany
                       ─ channelRepo.markPolled
                       ─ events.emit('messages')  → every connected SSE client gets a notification
```

### Reading — `GET /api/messages?sinceId=…`

```
routes/messages.ts → zod parses query → messageRepo.query(filters)
   → dynamic WHERE with $n parameters (never string-concatenated values) → rows → { items, lastId, hasMore, … }
```

---

## Database

Migrations live in `src/database/migrations/*.sql`; `migrate.ts` applies unapplied files in filename order inside a transaction and records them in `schema_migrations`. It runs automatically at startup. To change the schema, add `002_xxx.sql`.

```sql
channels(
  id SERIAL PK, username TEXT UNIQUE, title, active BOOL, last_message_id INT,
  backfilled_at, last_polled_at, last_error, created_at )

messages(
  id BIGSERIAL PK,                         -- internal, monotonically increasing → used for sinceId
  channel_id → channels ON DELETE CASCADE,
  message_id INT,                          -- Telegram's number within the channel
  posted_at, text, views, media JSONB, links JSONB, forwarded_from, edited, url, fetched_at,
  UNIQUE (channel_id, message_id) )
-- indexes: posted_at DESC; GIN full-text index on text (available for future ranked search)
```

Key behaviors in `messageRepo`:

- **`upsertMany`**: `INSERT … ON CONFLICT (channel_id, message_id) DO UPDATE` (updates text/views/media/links/edited). `RETURNING (xmax = 0)` distinguishes true inserts from updates, so the “new messages” count is accurate. Idempotent — safe to re‑run any backfill.
- **`refreshMany`**: a single `UPDATE … FROM jsonb_to_recordset(...)` for already‑known rows (never inserts).
- **`query`**: builds `WHERE` from filters. Default order `posted_at DESC, id DESC` with **keyset pagination** — the `cursor` is base64url of `postedAt|id` and the SQL is `(posted_at, id) < ($1, $2)`, which stays fast and stable even as new rows arrive (unlike `OFFSET`). With `sinceId` the order switches to `id ASC`.
- Deleting a channel cascades to its messages.
- `pg.types.setTypeParser(INT8 → Number)` makes `BIGSERIAL` ids come back as numbers instead of strings (safe below 2^53).

---

## API layer

- `server.ts` order: JSON body parser → `/api` CORS + API‑key middleware → routers → `/api` 404 → static UI → error handler (turns invalid JSON into `400`, everything else into a logged `500`).
- `middleware.ts`: CORS headers (`CORS_ORIGIN`), preflight `OPTIONS` → `204`; optional API key compared with `timingSafeEqual`, accepted from `Authorization: Bearer`, `X-API-Key` or `?api_key=`. `/api/health` is always open.
- **SSE** (`/api/messages/stream`): each connection subscribes to the `events` emitter and is removed on `close`; a `: ping` comment every 25 s keeps proxies from closing idle connections. The event bus is in‑memory, so it works for one process (see limits).
- Full endpoint reference: **[API.md](./API.md)**.

## Frontend

`public/` is served statically by Fastify (`@fastify/static`) and talks only to the public API (so it's also a reference client):

- `app.js` — channel list (pause / backfill / delete), message feed with search & channel filter, “Load more” using `nextCursor`, and an `EventSource` that refreshes the feed on new‑message events (only when scrolled to the top).
- `i18n.js` + `applyLanguage()` — English/Hebrew strings; Hebrew sets `<html dir="rtl">`. The choice is stored in `localStorage`. CSS uses logical properties (`border-inline-end`) so the layout mirrors automatically; message text uses `dir="auto"`.
- If the API requires a key, the UI prompts for it once and stores it in `localStorage`.

## Configuration

Validated at startup by `AppConfigModule` (`src/config/index.ts`: `@nestjs/config` + the zod schema in `app-config.ts`; invalid values stop the app with a clear error). See `.env.example`.

| Variable | Default | Effect |
|---|---|---|
| `DATABASE_URL` | `postgres://tg:tg@localhost:5433/telegram` | Postgres connection |
| `PORT` | `3000` | HTTP port |
| `POLL_SECONDS` | `30` | Poll interval (near‑real‑time latency) |
| `BACKFILL_DAYS` | `7` | History loaded when a channel is added |
| `REQUEST_DELAY_MS` | `1000` | Global minimum gap between requests to Telegram |
| `CONCURRENCY` | `3` | Channels processed in parallel |
| `API_KEY` | *(unset)* | Enables API‑key auth |
| `CORS_ORIGIN` | `*` | CORS allowed origin |

## Running, testing, operating

```powershell
npm install
npm run start:dev         # http://localhost:3000   (watch mode; npm start = one-off, npm run build && npm run start:prod = compiled)
npm test                  # vitest (test/*.spec.ts)
npm run lint              # oxlint
```

- **Throughput math:** each channel poll costs ≥ 1 request, and requests are spaced `REQUEST_DELAY_MS` apart. With the defaults (1 s) one tick can service ~30 channels within a 30 s interval. For more channels, raise `POLL_SECONDS` or lower `REQUEST_DELAY_MS` carefully (Telegram may answer `429`).
- **Logs:** `[backfill]`, `[poll]`, `[collector]` (errors), `[api]`. Per‑channel problems also show in `GET /api/channels` → `lastError`.
- **Reset data:** drop/recreate the Postgres database (or its volume).
- **Graceful shutdown:** SIGINT/SIGTERM Nest shutdown hooks stop the collector and Telegram source, close the HTTP server and the pool.

## Design decisions, limits & extending

| Decision | Reason |
|---|---|
| Scrape `t.me/s/` instead of MTProto/Bot API | The only account‑free option; MTProto (e.g. gramjs) needs a user login, bots must be admins of the channel |
| Polling instead of push | The preview has no push; 30 s polling is “as close to real time as possible” without an account |
| Postgres + JSONB for media/links | Variable shape, queried rarely by inner fields; keeps schema simple |
| Keyset cursors + `sinceId` | Stable paging and gap‑free incremental sync under constant inserts |
| Global request throttle | Politeness and fewer `429`s regardless of channel count |
| Pure parser + saved fixture | Fragile part isolated and testable offline |

Known limits: public channels only; media as expiring URLs; deletions not detected; edits/views refreshed only on the newest page; SSE and the scheduler are single‑process (running two instances would duplicate scraping — use one instance, or add a DB lock/queue first); text search is a plain substring (`ILIKE`).

Common extensions:

- **Download media** — after `upsertMany`, fetch `media[].url` to disk/S3 and store the key in `media`.
- **Webhooks** — subscribe to `MessageEventsService.subscribe()` in a new `src/webhooks/webhooks.service.ts` and POST the new rows to a URL.
- **Ranked search** — use the existing GIN index: `to_tsvector('simple', text) @@ plainto_tsquery('simple', $1)`.
- **Another source/markup change** — add or modify a parser in `src/scraper`; the rest of the pipeline only depends on `ParsedMessage`.
