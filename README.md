# Blitz — Telegram collector

NestJS (Fastify) service that collects Telegram messages in two ways, stores them in PostgreSQL and exposes them as a **REST API** (plus a minimal EN/HE web UI and a Postman-style API console). One module per feature, each with controller → service → repository.

- **Public channels, no account** — reads the public web preview (`https://t.me/s/<channel>`), backfills the last N days (default 7), then polls every 30s.
- **Groups, private chats and any channel, with your Telegram account** — MTProto (`@mtcute`) with live push, a watchdog and photo download on demand.
- **`GET /api/reports`** — messages in the Blitz `RAW_REPORT` shape (`report_id`, `account_name`, `channel_name`, `content`, …).

## Documentation

- **[docs/API.md](docs/API.md)** — REST API (endpoints, models, sync recipes, examples)
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — modules, call flows, database, limits
- **[src/tg-realtime/README.md](src/tg-realtime/README.md)** — the MTProto client code

## Quick start

```bash
cp .env.example .env     # set DATABASE_URL (PostgreSQL 16) and, optionally, the TG_* variables
npm install
npm run start:dev        # http://localhost:3000   (UI: /, API console: /api.html)
```

Add channels in the UI (`durov`, `@durov`, `https://t.me/durov`) or via the API:

```bash
curl -X POST localhost:3000/api/channels -H "Content-Type: application/json" -d '{"username":"durov"}'
curl "localhost:3000/api/messages?channel=durov&limit=5"
```

## Telegram account (groups / private chats)

Set `TG_API_ID` and `TG_API_HASH` (from my.telegram.org), then generate the session **once, locally**:

```bash
npm run auth             # prints TG_SESSION_STRING=... — put it in .env / your secrets
```

Login is headless (no phone/code prompt, no session file). Treat the string like a password and use it in one running instance at a time. Without it the service logs `Missing TG_SESSION_STRING in environment variables. Run 'npm run auth' locally to generate one.` and the web-preview channels keep working. `GET /api/telegram` returns the account state.

## Scripts

| Script | |
|---|---|
| `npm run start:dev` | Nest watch mode |
| `npm run build` · `npm run start:prod` | Compile to `dist/` and run it |
| `npm test` | vitest (`test/*.spec.ts`) |
| `npm run lint` | oxlint |
| `npm run auth` | One-time Telegram login (local only; uses `tsx`) |
| `npm run samples` | Feed fixed sample posts through the real components (Nest context), local by default ([docs/sample-feed.md](docs/sample-feed.md)) |
| `npm run test:samples` | Sample-feed tests, including an end-to-end CLI run |

## Config

See `.env.example` (validated at startup with zod in `src/config`). Main settings: `PORT`, `DATABASE_URL`, `POLL_SECONDS`, `BACKFILL_DAYS`, `REQUEST_DELAY_MS`, `CONCURRENCY`, optional `API_KEY` and `CORS_ORIGIN`.
