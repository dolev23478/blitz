# blitz

NestJS (Fastify) service that collects OSINT posts and forwards dictionary matches to the transformer (Kafka).

- **Telegram** — pulls the channels listed in `src/telegram/telegram-channels.ts` (`TELEGRAM_CHANNELS`) through a Telegram account (MTProto, `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`; generate the session with `npm run auth`). Live push plus a watchdog catch-up.
- **X** — polls the handles in `src/x-scraper/constants/monitored-sources.ts` every 5 minutes.
- **No database.** Resume points live in Redis (`REDIS_URL`): Telegram keeps one cursor per channel (`telegram:cursor:<channelId>` = channel, time of the last handled message; the resume is by time, not id) and X keeps `x:last-scrape-at`. Each pull continues from the saved point (24h fallback when none), so there are no gaps. Telegram messages are also claimed in Redis (`telegram:seen:*`, 2 days) so overlapping pulls don't publish a message twice.
- **Kafka** — reports go to `reports.raw` on `KAFKA_BROKERS`. Set `KAFKA_REMOTE_BROKERS` (+ `KAFKA_REMOTE_SASL_*`, `KAFKA_REMOTE_SSL_CA_FILE`) to also mirror them to a remote cluster. See `docs/ARCHITECTURE.md`.

## Run

```
cp .env.example .env
npm install
npm run start:dev
```

Config is validated at startup with zod in `src/config`: `PORT`, `REDIS_URL`, `TG_*`, `KAFKA_*`, optional `API_KEY` and `CORS_ORIGIN`.

`GET /api/health` and `GET /api/telegram` (connection status) are the only HTTP endpoints.
