# Internet radio collector

Radio runs inside the existing Nest application, alongside Telegram and X.
It records public internet audio and transcribes locally on CPU. In the full
application, transcripts pass through the same `analyzeText(text, 'auto')`
dictionary gate used by Telegram and X before archiving. Only accepted
clips are retained and continue through the shared Transformer. Local diagnostic
commands apply the same filter without publishing or starting Redis/Kafka.

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

To run **only radio with the full filter/Transformer/Kafka path** (build included):

```powershell
npm run radio:start
```

For one cycle, or one selected station:

```powershell
npm run radio:start -- --once
npm run radio:start -- --once --station=iran-international
```

This imports the same `RadioTransformerModule` as the full app, starts no Telegram
or X collectors, and serves the protected radio clip routes on `PORT` while it
runs. It uses the existing `REDIS_URL`, `KAFKA_BROKERS`, TLS/SASL and outbox settings
for actual publication. The once mode closes HTTP and workers at the end. Normal
mode repeats according to the recording/pause constants. `radio:once` remains
the separate capture-only diagnostic, with filtering but without publication.

`AppModule` imports `RadioTransformerModule`, connecting radio to the existing
Transformer. Collection starts after Nest initializes and repeats until shutdown.
The normal app still needs its
existing collector credentials/infrastructure; use `radio:once` to test radio
independently. No background process is installed by this feature.

The handoff first applies the shared analyzer's default `dictionary_only` mode,
matching the current Telegram/X integrations. A non-matching clip is discarded, including temporary audio,
and is not submitted to the Transformer. Analyzer errors discard the unapproved
clip and log a failure; they do not bypass filtering. Accepted input receives unique dictionary terms
in `matches` and report categories from `analysis.categories` unless collector
categories were already provided. Existing multilingual metadata is preserved;
otherwise ASR language supplies `languages`. Dictionary languages are logged
separately; emoji dictionary labels are not ISO language codes.

The handoff then calls `transformer.run('RadioTranscript', clip)` and awaits the normal
Kafka publisher. It uses `platform: 'AM/FM-RADIO'`, `media_type: ['text']` and
`languages: [clip.language]`. Original audio remains archived; `audio` is not
added to the RAW_REPORT enum. Unknown original broadcast time becomes
`published_at: null`; observed capture end becomes `collected_at`.

Set `RADIO_PUBLIC_BASE_URL=https://your-reachable-blitz-host.example` for report
URLs reachable by remote consumers; locally it defaults to `http://localhost:PORT`.
Each URL identifies `/api/radio/clips/<uuid>`, not a shared station stream.
Access still follows the API-key guard. No-speech clips are discarded. A failed
handoff preserves evidence without automatic archive replay. Kafka retry storage
and policy remain owned by the existing Transformer publisher.

## Read each processing stage in the logs

| Event                                                     | What it shows                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `radio_capture_started`, `radio_transcribed`              | Station, capture ID, audio duration and original transcript                                                |
| `radio_input_received`                                    | The full collector JSON received by the pipeline                                                           |
| `radio_analysis_completed`                                | ASR/ISO languages, dictionary languages, matches, categories/evaluation and issues                         |
| `radio_filter_result`                                     | `passed: true/false` and the explicit reason (including no speech)                                         |
| `radio_transformer_input`                                 | Accepted JSON with collector-side analysis metadata                                                        |
| `radio_transformer_stage_completed`                       | Parsing, mapping, validation and publishing; mapping/validation include report data                        |
| `radio_kafka_sending`                                     | Exact validated wire payload, topic, internal publication ID and attempt, immediately before producer.send |
| `radio_kafka_acknowledged`                                | Successful Kafka acknowledgment, not just a queued attempt                                                 |
| `radio_pipeline_completed`                                | Workflow completed after the publisher's confirmation                                                      |
| `radio_pipeline_failed`, `radio_transformer_stage_failed` | Failure reason and the stage that failed                                                                   |

`clipId` connects input/filter/Transformer events; the internal `publicationId`
and the UUID in `report_url` connect the publisher events. Reports contain no
`report_id` or Kafka key; consumers assign their own IDs. Report categories are
the dev dictionary labels (`terror`, `civil_emergency`, `riots`, `rockets_aerial`),
not the evaluator's concept labels. Validation logs show the formatted
report even when broker configuration/connectivity prevents a send. A sending
event alone does not mean Kafka accepted the report. Retries log each attempt.

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
and a slow station or pending publication cannot start overlapping cycles. Shutdown cancels the timer,
kills active Python jobs, waits for their exit and removes unaccepted temporary audio.

The list in `radio.constants.ts` includes the existing community stations,
Al-Nour, and two public TV feeds captured as **audio only**. Nothing records or
archives video. The same transcript filter and accepted-only archive policy
apply to all sources. Public reporting/interviews may include statements of
interest; source affiliation does not establish that an individual clip is an
actual threat or that a report about an attack is accurate.

| Source ID             | Source / documented affiliation                                                                                                                      | Capture                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `radio-al-nour`       | Lebanese Al-Nour; [US Treasury identifies it as a Hezbollah media arm](https://home.treasury.gov/news/press-releases/js4134)                         | Radio, Arabic                                              |
| `al-aqsa-tv-audio`    | Al-Aqsa Television; [US Treasury documents Hamas control](https://home.treasury.gov/news/press-releases/tg594)                                       | Public TV audio relay, Arabic; **not** Al-Aqsa Voice Radio |
| `al-masirah-tv-audio` | Al-Masirah; described as Houthi media in [UN Panel of Experts report S/2025/650](https://documents.un.org/doc/undoc/gen/n25/234/10/pdf/n2523410.pdf) | Public TV audio relay, Arabic                              |

The HLS relay URLs were discovered in public player/channel listings and tested
with the actual PyAV worker settings. They are third-party delivery endpoints,
not an authenticity guarantee; URLs and programming may change. Al-Masirah's
[own public channel](https://t.me/s/almasirah2/125578) also advertises audio listening.
To sample the newly added sources without Kafka:

```powershell
npm run build
npm run radio:once -- --station=al-aqsa-tv-audio --station=al-masirah-tv-audio
```

For the complete filter/Transformer/publication path, use `npm run radio:start`
with the same `--station` arguments and `--once`. The full application includes
all configured sources automatically after rebuild/restart.

Al-Balad now uses the HTTPS relay supplied by its
[official player](https://ammannet.net/live); the old port-8964 URL returned
`ICY 401 Service Unavailable` during investigation.

Not enabled: Al-Aqsa Voice Radio (its discovered radio feed did not decode),
Al-Quds Radio (audio host did not resolve), and IRIB Goftogoo/Radio Iran (stream
hosts did not resolve from this environment). Goftogoo is an interview/talk
candidate, but belongs to Iran's **state** broadcaster, unlike Iran International.
No unverified Iranian stream was enabled. Existing stations are not classified
as hostile merely because they are Arabic-speaking or pro-Palestinian.

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
    <uuid>.json         # station, observed times, language, text and segments
  models/               # local Whisper cache
  tmp/                  # worker temporary files
```

`radio_input_received` logs each received transcript; `radio_filter_result`
shows acceptance/rejection. Audio is recorded temporarily under `.radio/tmp`.
Only a nonempty transcript accepted by `analyzeText(text, 'auto')` is moved into
`clips`, alongside one JSON file containing `text`, `station.name` and the other clip metadata. Both `radio:once` and
the full pipeline use this rule. Analysis runs once per captured clip; its result
is passed to the handoff. No-speech, unmatched, invalid or failed captures leave
no recording/transcript archive, and their temporary WAV is removed in `finally`.
A hard process termination can leave a temporary WAV; it is not an archived clip.

JSON is written via a temporary file and renamed only when complete. If Kafka or
Transformer processing fails AFTER filter acceptance, the accepted recording is
kept as the same two files; failure diagnostics go to the logs, without a separate
error file. This is independent of Kafka success.
The archive counts each UUID once; at `RADIO_MAX_CLIPS`, collection pauses.
Existing historical clips and `.radio/saves` are not modified by this change.
Move/archive old captures manually or increase capacity to resume.

All output/cache/temp paths stay inside the project. `.radio`, `.venv-radio`
and Python bytecode are gitignored. A path outside the project (including the
Desktop archive from an earlier branch) is not used. The Dockerfile installs the
Python dependencies; persist `/app/.radio` for model storage and accepted clips.
The first model download and station access still require network connectivity.

While the full app is running:

| Route                               | Result                                        |
| ----------------------------------- | --------------------------------------------- |
| `GET /api/radio/clips`              | Completed clips, newest first, including text |
| `GET /api/radio/clips/<uuid>`       | One clip's JSON                               |
| `GET /api/radio/clips/<uuid>/audio` | WAV audio                                     |

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
node --import tsx test/radio/run-pipeline-sample.mjs
```

The pipeline sample runs actual archived JSON through the actual analyzer and
compiled integration modules, with Redis/Kafka test doubles. Full stage logs,
filtered/published counts and validated wire reports are written under
`.radio/pipeline-verification`. It does not contact real Kafka or prove real
broker integration. Real-analyzer unit tests use controlled fixture dictionaries.

Unit tests use controlled workers for scheduling, failures, shutdown and archive
rules. `radio:demo` uses actual Python/PyAV/faster-whisper with public recorded
English speech replayed over local HTTP, plus generated silence. It verifies
WAV duration/format, UTF-8 JSON transcripts with station names and exactly two files per accepted clip, unique clips and protected HTTP routes.
Evidence is in `.radio/demo/sample-run.json`; it is not a live Arabic/Persian
quality benchmark and never calls Kafka. `radio:once` checks real public streams;
listen to the WAV and compare the text before claiming accuracy. Neither command
deletes existing clips. Both use temporary processes/listeners that close on exit.

Implementation references: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
and [PyAV stream opening/timeouts](https://pyav.org/docs/stable/api/_globals.html).
