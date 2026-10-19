# REST API Guide

Base URL: `http://localhost:3000/api` (configurable via `PORT`). All bodies and responses are JSON (`application/json`), except the SSE stream. Timestamps are ISO‑8601 UTC strings.

- [Quick start](#quick-start)
- [Authentication & CORS](#authentication--cors)
- [Data models](#data-models)
- [Endpoints](#endpoints) — [Health/Stats](#health--stats) · [Channels](#channels) · [Messages](#messages) · [Live stream](#live-stream-sse)
- [Recipes](#recipes) — initial load, incremental sync, paging, search, live
- [Errors](#errors)
- [Code examples](#code-examples) (curl, TypeScript, Python)
- [Behavior notes & limits](#behavior-notes--limits)

---

## Quick start

```bash
# 1. add a public channel (name, @name or t.me link all work)
curl -X POST localhost:3000/api/channels -H "Content-Type: application/json" -d '{"username":"durov"}'

# 2. wait a few seconds (backfill of the last 7 days runs in the background), then read messages
curl "localhost:3000/api/messages?channel=durov&limit=5"
```

Adding a channel validates that it is public, stores it, and immediately starts a **backfill** (last `BACKFILL_DAYS`, default 7). After that the channel is polled every `POLL_SECONDS` (default 30s).

## Authentication & CORS

- **Auth is off by default.** Set `API_KEY=<secret>` in `.env` to require it on every `/api/*` route except `GET /api/health`. Send it as any of:
  - `Authorization: Bearer <key>`
  - `X-API-Key: <key>`
  - `?api_key=<key>` (use this for the SSE stream, since `EventSource` can't set headers)
- Missing/wrong key → `401 {"error":"Missing or invalid API key"}`.
- **CORS:** `Access-Control-Allow-Origin` is `*` by default; restrict with `CORS_ORIGIN=https://your.app`.
- If you expose this beyond localhost, always set `API_KEY` and put it behind HTTPS (e.g. a reverse proxy).

## Data models

### Channel

```json
{
  "id": 5,
  "username": "israel1",
  "title": "חדשות ישראל ללא צנזורה",
  "active": true,
  "lastMessageId": 21345,
  "backfilledAt": "2026-10-18T13:44:41.513Z",
  "lastPolledAt": "2026-10-18T13:46:58.053Z",
  "lastError": null,
  "createdAt": "2026-10-18T13:44:28.493Z",
  "busy": false
}
```

| Field | Meaning |
|---|---|
| `id` | Internal channel id |
| `username` | Lowercase public username (without `@`) |
| `title` | Display name from Telegram |
| `active` | If `false`, the channel is paused (not polled) |
| `lastMessageId` | Highest Telegram message number seen in this channel |
| `backfilledAt` | When the initial history load finished (`null` = still running / not yet) |
| `lastPolledAt` | Last collection attempt (success or error) |
| `lastError` | Error from the last attempt, `null` if OK |
| `busy` | A collection job is running right now |

### Message

```json
{
  "id": 582,
  "channelId": 5,
  "channel": "israel1",
  "messageId": 21345,
  "postedAt": "2026-10-18T13:22:43.000Z",
  "text": "…",
  "views": 6910,
  "media": [
    { "type": "photo", "url": "https://cdn4.telesco.pe/file/…jpg" },
    { "type": "video", "url": "https://…mp4?token=…", "thumbnail": "https://…jpg" }
  ],
  "links": ["https://example.com/article"],
  "forwardedFrom": null,
  "edited": false,
  "url": "https://t.me/israel1/21345",
  "fetchedAt": "2026-10-18T13:46:58.053Z"
}
```

| Field | Meaning |
|---|---|
| `id` | **Internal, globally increasing id** (use for incremental sync and `GET /messages/:id`) |
| `messageId` | Telegram's per‑channel message number (`t.me/<channel>/<messageId>`) |
| `postedAt` | When the post was published |
| `text` | Plain text (line breaks kept as `\n`); `null` for media‑only posts |
| `views` | View count at last refresh (`null` if unknown) |
| `media[]` | `type` is `photo` \| `video` \| `document` \| `audio` \| `other`; `url` (+ optional `thumbnail`). Only URLs are stored — Telegram CDN links may expire |
| `links[]` | http(s) links found in the text and link preview |
| `forwardedFrom` | Original author/channel name if forwarded, else `null` |
| `edited` | Post was edited |
| `url` | Permalink |
| `fetchedAt` | Last time we refreshed this row |

---

## Endpoints

### Health & stats

| | |
|---|---|
| `GET /api/health` | Liveness probe. Never requires the API key. → `{"status":"ok","uptimeSeconds":123}` |
| `GET /api/stats` | Totals and per‑channel counts. |

```json
{
  "channels": 1, "activeChannels": 1, "totalMessages": 327,
  "perChannel": [{ "channel": "israel1", "messages": 327, "oldest": "…", "newest": "…" }],
  "settings": { "pollSeconds": 30, "backfillDays": 7 }
}
```

### Channels

A `:ref` in the path can be the numeric channel `id` **or** the username (`israel1` or `@israel1`).

| Method & path | Description | Success |
|---|---|---|
| `GET /api/channels` | List all channels | `200` array of Channel |
| `POST /api/channels` | Add a channel | `201` Channel (+ `Location` header) |
| `GET /api/channels/:ref` | Get one channel | `200` Channel |
| `PATCH /api/channels/:ref` | Pause/resume | `200` Channel |
| `DELETE /api/channels/:ref` | Delete channel **and all its messages** | `204` |
| `POST /api/channels/:ref/backfill` | Re‑run history load | `202 {"started":true}` |

**`POST /api/channels`** body: `{ "username": "<name | @name | t.me/name | https://t.me/s/name | https://web.telegram.org/a/#@name>" }`

- Groups, numeric ids (`-100…`) and `web.telegram.org` links are accepted when the Telegram account is logged in (channel gets `"source": "mtproto"`); otherwise `400`/`422`
- `400` invalid name/link, or a numeric Telegram ID while the account is not logged in
- `409` channel already exists
- `422` channel doesn't exist / isn't public / has no web preview

**`PATCH /api/channels/:ref`** body: `{ "active": false }` — pauses polling but keeps data.

**`POST /api/channels/:ref/backfill`** body (optional): `{ "days": 14 }` (1–3650). Fetches history back that many days; existing rows are updated, not duplicated. `409` if the channel is currently busy.

### Telegram account (groups / private chats)

| Method & path | Description |
|---|---|
| `GET /api/telegram` | Read-only status: `{enabled, state, error, user}`; `state` is `disabled`, `connecting`, `ready` or `error` (e.g. missing/invalid `TG_SESSION_STRING`) |

Login is headless: generate `TG_SESSION_STRING` locally with `npm run auth`; there are no login endpoints.

Extra channel fields for `"source": "mtproto"`: `source`, `tgChatId`. Extra message fields: `senderId`, `forwards`, `reactions[]` (`{emoji, count}`); `media[]` items may have `fileName`, `mimeType`, `sizeBytes` and an empty `url`.

### Messages

#### `GET /api/messages`

Query parameters (all optional):

| Param | Type | Description |
|---|---|---|
| `channel` | string | One or more usernames, comma‑separated: `channel=durov,telegram` |
| `q` | string | Case‑insensitive substring search in `text` |
| `from`, `to` | ISO date | Filter by `postedAt` (inclusive), e.g. `2026-10-15` or `2026-10-15T08:00:00Z` |
| `hasMedia` | `true`/`false` | Only posts with / without media |
| `limit` | 1–500 (default 50) | Page size |
| `cursor` | string | Pass the previous response's `nextCursor` to get the next (older) page |
| `sinceId` | integer | **Incremental sync**: only rows with `id` greater than this, **oldest first** |

`cursor` and `sinceId` can't be combined (`400`).

Response:

```json
{
  "items": [ /* Message[] */ ],
  "count": 50,
  "nextCursor": "MjAyNi0xMC0x…",   // null when no more pages (newest-first mode)
  "lastId": 582,                    // highest internal id in `items` (sinceId mode: use as next sinceId)
  "hasMore": true                   // a full page was returned, so more may exist
}
```

Two modes:

| Mode | Ordering | Continue with |
|---|---|---|
| Default (no `sinceId`) | newest first (`postedAt DESC`) | `cursor = nextCursor` |
| `sinceId=N` | oldest first (`id ASC`) | `sinceId = lastId` |

#### `GET /api/messages/:id`

Single message by internal `id`. `404` if missing. Use it to re‑read a message to get fresh `views`/edit status.

### Live stream (SSE)

`GET /api/messages/stream` — a [Server‑Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) stream. Whenever new messages are stored, you get:

```
event: messages
data: {"channelId":5,"channel":"israel1","inserted":3}
```

It's a **notification**, not the data: on each event call `GET /api/messages?sinceId=<lastId>` to fetch what's new. Keep‑alive comments (`: ping`) are sent every 25s.

---

### `GET /api/reports`

Same filters and paging as `GET /api/messages`, but each item is in the **RAW_REPORT** contract shape (`reports.raw`):

| Field | Value |
|---|---|
| `report_id` | int64, deterministic from `platform` + `report_url` (53-bit hash, never 0) — re-collecting a message gives the same id |
| `schema_version` | `1` |
| `is_official` | `false` (non-official source) |
| `platform` | `telegram` |
| `account_name` | who sent it (Telegram account sender; falls back to the channel name for web-preview channels) |
| `channel_name` | channel/chat title (falls back to the username) |
| `report_url` | the message URL |
| `media_type` | `["text", ...photo/video/…]` |
| `report_title` | `null` |
| `content` | trimmed text, never empty |
| `language` | `null` (language detection not implemented yet) |
| `matches` | `[]` (trigger keywords not implemented yet) |
| `published_at` / `collected_at` | UTC ISO timestamps |

Messages with no text violate the contract; they are omitted from `items` and listed in `rejected` (`{ reportUrl, reason: "empty_content" }`), i.e. they belong in `reports.dlq`. Publishing to a Kafka topic is not implemented yet.

### `GET /api/media/:channelId/:messageId`

Media (e.g. photos) of messages collected through the Telegram account. It is downloaded on demand and cached in memory. Returns the file with its `Content-Type`; `404` if there is no media, `503` if the account is not connected. When `API_KEY` is set, pass `?api_key=` (the UI does this automatically).

## Recipes

### 1. Full initial load of a channel
```text
POST /api/channels {"username":"durov"}
→ poll GET /api/channels/durov until backfilledAt != null and busy == false
→ page through GET /api/messages?channel=durov&limit=500 using nextCursor until nextCursor == null
```

### 2. Keep your own database in sync (recommended)
Store the highest `id` you've processed, then loop:

```text
cursorId = 0                       # persist this
loop every N seconds (or on each SSE event):
    GET /api/messages?sinceId={cursorId}&limit=500
    process items (upsert by item.id)
    cursorId = lastId
    if hasMore: repeat immediately
```

Because `id` only ever increases and results are oldest‑first, you never miss or reorder messages. **Upsert by `id`**, not insert.

### 3. Page back through history (newest → oldest)
```text
GET /api/messages?limit=100
GET /api/messages?limit=100&cursor=<nextCursor>   # repeat until nextCursor is null
```

### 4. Search / filter
```text
GET /api/messages?q=ceasefire&channel=israel1,durov&from=2026-10-12&hasMedia=true
```

### 5. React to new posts in real time
Open the SSE stream, and on each `messages` event run recipe 2's `sinceId` request.

---

## Errors

Every error is JSON: `{ "error": "human readable message" }`.

| Status | When |
|---|---|
| `400` | Invalid params/body/JSON, bad cursor, `cursor`+`sinceId` together, numeric Telegram id |
| `401` | `API_KEY` is set and the request has no/invalid key |
| `404` | Unknown route, channel, or message |
| `409` | Channel already exists / channel busy |
| `422` | Channel not found or not public |
| `500` | Unexpected server error (details in server log) |

## Code examples

### curl

```bash
BASE=http://localhost:3000/api
KEY="-H X-API-Key:secret"                       # only if API_KEY is set

curl $KEY $BASE/channels
curl $KEY -X POST $BASE/channels -H "Content-Type: application/json" -d '{"username":"@durov"}'
curl $KEY -X PATCH $BASE/channels/durov -H "Content-Type: application/json" -d '{"active":false}'
curl $KEY -X POST  $BASE/channels/durov/backfill -H "Content-Type: application/json" -d '{"days":14}'
curl $KEY -X DELETE $BASE/channels/durov
curl $KEY "$BASE/messages?channel=durov&q=telegram&limit=20"
curl $KEY -N "$BASE/messages/stream"            # live events
```

### TypeScript / Node 18+ (incremental sync)

```ts
const BASE = 'http://localhost:3000/api';
const headers = { 'X-API-Key': process.env.API_KEY ?? '' };

interface Message { id: number; channel: string; messageId: number; postedAt: string; text: string | null; views: number | null; media: { type: string; url: string }[]; url: string }
interface Page { items: Message[]; lastId: number | null; hasMore: boolean; nextCursor: string | null }

let sinceId = 0; // persist between runs

async function sync() {
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(`${BASE}/messages?sinceId=${sinceId}&limit=500`, { headers });
    if (!res.ok) throw new Error(`${res.status} ${(await res.json()).error}`);
    const page = (await res.json()) as Page;
    for (const m of page.items) console.log(m.channel, m.postedAt, m.text?.slice(0, 80));
    sinceId = page.lastId ?? sinceId;
    hasMore = page.hasMore;
  }
}

setInterval(sync, 30_000);
sync();
```

Live notifications from the browser:

```ts
const es = new EventSource(`${BASE}/messages/stream?api_key=${key}`); // api_key only if auth is on
es.addEventListener('messages', () => sync());
```

### Python

```python
import requests, time

BASE = "http://localhost:3000/api"
S = requests.Session()
S.headers["X-API-Key"] = "secret"   # only if API_KEY is set

since_id = 0
while True:
    while True:
        page = S.get(f"{BASE}/messages", params={"sinceId": since_id, "limit": 500}).json()
        for m in page["items"]:
            print(m["channel"], m["postedAt"], (m["text"] or "")[:80])
        since_id = page["lastId"] or since_id
        if not page["hasMore"]:
            break
    time.sleep(30)
```

---

## Behavior notes & limits

- **Web-preview channels** (`t.me/s/<name>`) need no account. Groups, private chats and numeric ids require the Telegram account login (see above).
- **Near‑real‑time = polling.** New posts appear within about `POLL_SECONDS` (+ request throttling when many channels are tracked).
- **Updates to old rows:** views, text edits and `edited` are refreshed only while a post is still on the channel's newest page. Re‑reading such a row (`GET /messages/:id` or a normal query) shows the fresh values, but `sinceId` only returns **new** rows — it does not re‑deliver updated ones.
- **Deleted posts are not detected** and remain in the database.
- **Media are URLs only**; Telegram CDN URLs can expire. Download what you need soon after collection.
- `q` is a substring match (`ILIKE`); results are not ranked.
- No pagination on `/api/channels` (expected to be a small list).
- Be kind to Telegram: the collector throttles to one request per `REQUEST_DELAY_MS` (default 1s) globally and retries `429/5xx` with backoff.
