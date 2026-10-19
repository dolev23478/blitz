# tg-realtime — Telegram real-time collector (MTProto userbot)

Push-based collector built on `@mtcute/node` + `@mtcute/dispatcher`. It logs in as a **user account**, so it can read groups and private chats the account is a member of.

## Setup
1. Get `api_id` / `api_hash` at https://my.telegram.org → *API development tools*.
2. Set `TG_API_ID`, `TG_API_HASH` (and `TG_TARGETS` for the standalone runner) in the Blitz root `.env`.
   - Targets mix usernames (`durov`, `@name`, `t.me/name`) and numeric ids (`-1001234567890`). The account must be able to see numeric-id chats (joined).
3. **Once, locally:** `npm run auth` from the Blitz root (interactive: phone, code, 2FA) prints `TG_SESSION_STRING=...`; add it to `.env` / your secrets. Keep it secret, never commit it.
4. This code now lives inside the Blitz Nest app (`src/telegram/` reuses it); normally just run `npm run start:dev`. The standalone runner is `npx tsx src/tg-realtime/index.ts`. The client is headless: session only from `TG_SESSION_STRING` (in memory, no files, never prompts). Without it: `Missing TG_SESSION_STRING in environment variables. Run 'npm run auth' locally to generate one.` Don't run the app and the standalone runner with the same string at once.

## Layout
| File | Role |
|---|---|
| `src/config.ts` | env loading + target list |
| `src/client.ts` | client, disk session, login |
| `src/targets.ts` | resolves targets → `Set<number>` of chat ids |
| `src/listeners/messageListener.ts` | Dispatcher: new/edited messages, O(1) Set filter |
| `src/services/extractorService.ts` | history, comments, members (+bio, admin rights), media download |
| `src/mappers.ts`, `src/types.ts` | DTOs and mapping (metrics, reactions, media metadata) |
| `src/utils/resilience.ts` | `withFloodWait`, random 1.5–3 s pacing |

## Resilience
- `FLOOD_WAIT_N` is caught, the service sleeps exactly N seconds and retries.
- Active scans pause a random 1.5–3 s between requests (`SCAN_DELAY_*_MS`).
- mtcute reconnects the socket automatically and catches up missed updates.

## Notes
- Automating a user account can violate Telegram's ToS and risk a ban; use a dedicated account and moderate rates.
- Scan members only of groups you own or administer; respect privacy laws.
- Scripts (Blitz root): `npm test`, `npm run lint`.
