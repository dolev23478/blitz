# Blitz

One NestJS/Fastify application collects Telegram, X and public internet radio,
filters content with the shared analyzer, and publishes accepted RAW_REPORT JSON
to Kafka. No SQL database is used. Redis stores collector state/session ownership
and the durable publication outbox.

## Run all three collectors

```powershell
Copy-Item .env.example .env
npm install
python -m venv .venv-radio
.\.venv-radio\Scripts\python.exe -m pip install -r requirements-radio.txt
npm run radio:prepare-model
npm run start
```

Populate `.env` before starting:

- Telegram: `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING` (`npm run auth` generates a session), and reachable `REDIS_URL`. Telegram refuses to run without its Redis session lock.
- X: `TWITTERAPI_IO_KEY` for the default provider, or the configured Apify credentials. Handles are in `src/x-scraper/constants/monitored-sources.ts`.
- Publication: `KAFKA_BROKERS`, existing `reports.raw` topic, and any required TLS/SASL credentials. Optional remote mirroring uses `KAFKA_REMOTE_*`.
- Radio: enabled by default; stations and recording/pause durations are in `src/radio/radio.constants.ts`. Prepare the local ASR model with `npm run radio:prepare-model` before starting; runtime never downloads models.

On Linux/macOS, use `.venv-radio/bin/python` for pip. `npm run start:dev` enables
watch mode. Radio-only full pipeline: `npm run radio:start`. Capture/filter-only
check without Redis/Kafka: `npm run build`, then
`npm run radio:once -- --station=radio-al-nour`.

Radio captures and transcribes entirely in RAM. It writes no audio/transcript
files and logs only transcripts accepted by the shared dictionary filter.
Historical archives are left untouched.

For closed-network Linux deployment, run `npm run offline:vendor` once on a
connected machine. Commit the code and small vendor metadata; **transfer the
`runtime-*.part` and `model.bin` binaries manually into their vendor paths**.
After both transfers, `npm run image:build` loads the bundled Linux/Python
libraries/model locally and builds the application. Only npm registry access is
needed during that build; no apt/pip/GitHub/model downloads occur. A prebuilt
image export remains available through `npm run offline:prepare`.
See [offline deployment](docs/OFFLINE_DEPLOYMENT.md).

## Contract and services

All collectors use the same Transformer workflow. Output uses integer
`schema_version: 1`, ISO `languages: string[]`, collector `categories: string[]`,
and supported `media_type` values. Producer `report_id` is omitted; consumers assign IDs. Kafka keys use the exact
`report_url` from each report. Radio platform is `AM/FM-RADIO`. Dev dictionaries and their
report categories remain the shared source of truth.

The backend defaults to port 3000. Routes include `/api/health`, `/api/telegram`,
`/api/posts`, `/api/posts/stream`, and
`/api/kafka/analytics/{stats,stream}`. Route access follows the existing
`ApiKeyGuard` and `@Public` declarations. The dashboard uses this backend: `npm run build:web`, then
`npm run start:web` on port 3001. `apps/api` is a separate demo and is not required
for collectors or the live dashboard.

## Checks

```powershell
npm run build
npx tsc --noEmit
npm run lint
npm test
npm run build:web
```

Redis/Kafka integration suites require explicitly configured isolated test
infrastructure; skipped suites do not establish integration success. See
[architecture](docs/ARCHITECTURE.md), [radio](src/radio/README.md), and
[Transformer contract/retries](src/transformer/README.md) for details.
