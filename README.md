# blitz

NestJS (Fastify) service that collects OSINT posts and forwards dictionary matches to the transformer (Kafka).

- **Telegram** — pulls the channels listed in `src/telegram/telegram-channels.ts` (`TELEGRAM_CHANNELS`) through a Telegram account (MTProto, `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`; generate the session with `npm run auth`). Live push plus a watchdog catch-up.
- **X** — polls the handles in `src/x-scraper/constants/monitored-sources.ts` every 5 minutes.
- **No database.** The last successful pull time is kept in Redis (`REDIS_URL`; keys `telegram:last-scrape-at` and `x:last-scrape-at`). On start/reconnect each source re-pulls from that time (24h fallback), so there are no gaps; duplicates are handled downstream (deterministic report ids).

## Run

```
cp .env.example .env
npm install
npm run start:dev
```

Config is validated at startup with zod in `src/config`: `PORT`, `REDIS_URL`, `TG_*`, `KAFKA_*`, optional `API_KEY` and `CORS_ORIGIN`.

`GET /api/health` and `GET /api/telegram` (connection status) are the only HTTP endpoints.
