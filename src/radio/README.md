# Internet radio collector

Radio runs inside the existing Nest application, alongside Telegram and X.
It records public internet audio and transcribes locally on CPU. This version
only saves local evidence and logs text: it has no Transformer, Kafka, Redis,
database or event-bus handoff. The rebuild guide's old publishing and RAW_REPORT
mapping instructions are deliberately not implemented for this request.

## Run

From the project root, install Python dependencies into the project environment:

```powershell
python -m venv .venv-radio
.\.venv-radio\Scripts\python.exe -m pip install -r requirements-radio.txt
npm run build
npm run radio:once
```

If `.venv-radio` already exists, reuse it and run the pip command. Use `npm.cmd`
if PowerShell blocks npm's script wrapper. On Linux/macOS the Python executable
is `.venv-radio/bin/python`. Tested dependency pins are faster-whisper 1.2.1 and
PyAV 16.0.1; no separate FFmpeg executable is needed. Dependencies/model cache
are local to the project; no global Python installation is modified.

`radio:once` records one cycle and exits. It does not start Telegram/X or require
Redis/Kafka. To check just one configured station:

```powershell
npm run radio:once -- --station=iran-international
```

To run continuously with the entire existing application:

```powershell
npm run start
```

`RadioModule` is imported by `AppModule`. Collection starts immediately after
Nest initializes, and repeats until shutdown. The normal app still needs its
existing collector credentials/infrastructure; use `radio:once` to test radio
independently. No background process is installed by this feature.

## Change recording behavior

Edit [radio.constants.ts](./radio.constants.ts), then rebuild/restart:

```typescript
export const RECORDING_SECONDS = 30;
export const PAUSE_SECONDS = 60;
export const RADIO_STATIONS: RadioStation[] = [/* stations */];
```

The constants are the only source for duration, pause and stations. Old
`RADIO_CLIP_SECONDS`, `RADIO_INTERVAL_SECONDS`, `RADIO_STATIONS_FILE` settings
are ignored. Recording accepts 1–300 seconds; pause accepts 0–86400 seconds;
there can be 1–10 stations with unique IDs and direct HTTP(S) audio URLs.

Stations run sequentially. After ALL stations have finished recording and
transcribing, a full pause begins. There is no recording during the pause,
and a slow station cannot start overlapping cycles. Shutdown cancels the timer,
kills active Python jobs, waits for their exit and preserves partial evidence.

The initial list restores Al-Balad, Nisaa, Hayat, Iran International, Husna,
Voice of Lebanon and Mosaique. Availability/programming can change. Iran
International is a Persian broadcaster based outside Iran; these are public
internet streams, not RF reception or access to private communications.

## Settings

These optional `.env` settings are validated through the app's existing
`APP_CONFIG` provider:

```dotenv
RADIO_ENABLED=true
RADIO_DATA_DIR=.radio
RADIO_MODEL=tiny
RADIO_CPU_THREADS=2
RADIO_JOB_TIMEOUT_SECONDS=900
RADIO_MAX_CLIPS=100
# RADIO_PYTHON_PATH=.venv-radio/Scripts/python.exe
```

Collection is enabled by default, as requested. Set `RADIO_ENABLED=false` to
disable automatic collection. The one-cycle/demo commands disable scheduling
only in their own process and explicitly call collection once.

First transcription downloads the model into `.radio/models`; allow network
access and time for that initial download. Cached models are tried before any
hub access. `tiny` is a quick CPU smoke-test model; Arabic/Persian accuracy can
be poor. `base` or `small` can improve quality at greater download/CPU cost.
Changing `RADIO_MODEL` does not translate speech. The optional station language
is an ASR hint. A nonempty transcript is not evidence of transcription accuracy.

Python jobs have bounded open/read timeouts, a total job deadline, a 2 MiB
stdout/stderr limit, and no shell interpolation. WAV is PCM mono 16 kHz,
bounded by sample count. A stream buffer may yield 30 seconds of audio in less
than 30 seconds of wall time. `startedAt`/`endedAt` are observed capture times,
not verified original broadcast timestamps or ASR completion times.

## Find the recordings and text

Each capture uses a fresh UUID:

```text
.radio/
  clips/
    <uuid>.wav          # recorded audio
    <uuid>.txt          # plain UTF-8 transcript
    <uuid>.json         # station, observed times, language, text and segments
    <uuid>.error.json   # failure diagnostics, only for failed jobs
  models/               # local Whisper cache
  tmp/                  # worker temporary files
```

`radio_transcribed` logs include the complete text, station, UUID and duration.
`radio_no_speech` means no speech was detected: audio/JSON/text are still saved,
with empty text and local `language: "unknown"`. This internal collector model
is separate from RAW_REPORT's `languages: string[]` wire contract.

JSON is written via a temporary file and renamed only when complete. A failed
ASR job can leave a WAV without a completed transcript; its error record explains
the failure. The archive counts each UUID once, including partial/failed jobs.
At `RADIO_MAX_CLIPS`, collection pauses without deleting anything. Move/archive
old captures manually or increase capacity to resume; there is no automatic
cleanup/replay. `.radio/saves`, if you create it, is never managed or deleted.

All output/cache/temp paths stay inside the project. `.radio`, `.venv-radio`
and Python bytecode are gitignored. A path outside the project (including the
Desktop archive from an earlier branch) is not used. Docker deployment requires
Python dependencies, model storage and an archive volume; this change does not
provision them.

While the full app is running:

| Route | Result |
| --- | --- |
| `GET /api/radio/clips` | Completed clips, newest first, including text |
| `GET /api/radio/clips/<uuid>` | One clip's JSON |
| `GET /api/radio/clips/<uuid>/audio` | WAV audio |

These routes inherit the application's API-key guard. If `API_KEY` is set,
send `X-API-Key` or the existing Bearer/query authentication. Invalid UUIDs
return 400; missing clips return 404. No unauthenticated public override is added.

## Verification

```powershell
npm run build
npx tsc --noEmit
npm run lint
npx vitest run test/radio.spec.ts test/radio-worker.spec.ts
npm test
npm run radio:demo
npm run radio:once
```

Unit tests use controlled workers for scheduling, failures, shutdown and archive
rules. `radio:demo` uses actual Python/PyAV/faster-whisper with public recorded
English speech replayed over local HTTP, plus generated silence. It verifies
WAV duration/format, UTF-8 text/JSON files, unique clips and protected HTTP routes.
Evidence is in `.radio/demo/sample-run.json`; it is not a live Arabic/Persian
quality benchmark and never calls Kafka. `radio:once` checks real public streams;
listen to the WAV and compare the text before claiming accuracy. Neither command
deletes existing clips. Both use temporary processes/listeners that close on exit.

Implementation references: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
and [PyAV stream opening/timeouts](https://pyav.org/docs/stable/api/_globals.html).
