# Blitz web frontend

Run `npm install` from the project root. Start the collector backend with
`npm start` (port 3000), then `npm run dev:web` in another terminal (port 3001).

The dashboard uses the real collector backend, not the optional demo API:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3000
```

It reads `/api/posts`, `/api/posts/stream`, `/api/kafka/analytics/stats` and
`/api/kafka/analytics/stream` (named SSE events: `snapshot`, `kafka_event`).
Set the API URL to an address reachable from the browser in deployment.
Build with `npm run build:web`; serve with `npm run start:web`.
