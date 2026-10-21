# Internet radio collector

Radio runs inside the same Nest application as Telegram and X. Public HTTP(S)
audio is captured sequentially into bounded RAM, transcribed by local
faster-whisper, filtered by the shared dictionaries, then passed to the shared
Transformer and durable Redis outbox for Kafka publication.

No recordings or JSON/TXT transcripts are written, even temporarily. Only
accepted transcript text is logged, once (`radio_transcribed`). Rejected speech
is not logged. Station metadata, filter decisions, processing stages and errors
remain visible. Historical files are left untouched. There is no clip archive
HTTP API.

## Prepare

Install the Python dependencies into the project environment:

```powershell
python -m venv .venv-radio
.\.venv-radio\Scripts\python.exe -m pip install -r requirements-radio.txt
npm ci
npm run build
```

Linux uses `.venv-radio/bin/python`. The Docker image runs the same pip install
at build time. The first radio job downloads the `RADIO_MODEL` Whisper model from
Hugging Face into `RADIO_DATA_DIR/models` (`.radio/models`); later jobs load the
cached copy without contacting the model hub. Transcription itself is local; there
is no external transcription API.

## Run

```powershell
npm run start
npm run radio:start
npm run radio:start -- --once --station=radio-al-nour
npm run radio:once -- --station=radio-al-nour
```

`start` runs the full application with all three collectors. `radio:start`
builds and runs radio, filtering and Transformer/Kafka publication without
Telegram/X. `radio:once` is a capture/filter diagnostic without Redis/Kafka.
Neither radio command starts an HTTP archive server or installs dependencies.
Publication requires reachable internal `REDIS_URL`, `KAFKA_BROKERS` and the
existing TLS/SASL settings when applicable.

Edit [radio.constants.ts](./radio.constants.ts), then rebuild/restart:

```typescript
export const RECORDING_SECONDS = 30;
export const PAUSE_SECONDS = 60;
export const RADIO_STATIONS: RadioStation[] = [/* sources */];
```

Recording is 1-300 seconds per station; pause is 0-86400 seconds after the entire
cycle, including transcription and publication handoff. Up to ten stations with
unique IDs and HTTP(S) audio URLs are supported. Cycles cannot overlap. Shutdown
cancels timers, stops Python processes and releases pending handoffs; admitted
publication jobs remain in Redis. At 300 seconds, mono PCM occupies approximately
9.6 MB; decoder/model memory is additional.

The configured sources include community radio and public TV feeds captured as
audio only. Availability and speech quality depend on each remote stream. No
video or audio archive is created. Source affiliation and dictionary matches do
not establish that a report is an actual threat.

## Settings

```dotenv
RADIO_ENABLED=true
RADIO_MODEL=tiny
RADIO_DATA_DIR=.radio
RADIO_CPU_THREADS=2
RADIO_JOB_TIMEOUT_SECONDS=900
# Windows default; Linux uses .venv-radio/bin/python:
# RADIO_PYTHON_PATH=.venv-radio/Scripts/python.exe
```

`RADIO_DATA_DIR` must stay inside the project. It holds the model download cache
and library temp locations, not recordings. `RADIO_MAX_CLIPS`,
`RADIO_PUBLIC_BASE_URL`, `RADIO_CLIP_SECONDS`, `RADIO_INTERVAL_SECONDS` and
`RADIO_STATIONS_FILE` no longer control behavior.

## Filtering and output

The collector uses `analyzeText(text, 'auto')`, as Telegram/X do. Silence and
non-matching speech are discarded before transformation. Accepted input receives
matches and report categories from `analysis.categories`; explicitly supplied
collector categories/languages are preserved. ASR language supplies ISO language
metadata when collector languages are absent. Dictionary language labels,
including emoji labels, are not passed as ISO codes.

The handoff calls `TransformerWorkflow.run('RadioTranscript', clip)` and awaits
confirmed publication. RAW_REPORT uses `platform: 'AM/FM-RADIO'`,
`media_type: ['text']`, integer `schema_version: 1`, `languages: string[]` and
`categories: string[]`. Content must be nonblank parsed text. Unknown original
broadcast time is null; `collected_at` is the observed capture end. Consumers
assign report IDs; Blitz does not generate them.

`report_url` is the station stream URL plus `#clip=<UUID>` (or `&clip=<UUID>`
after an existing fragment). This identifies an observation at the live source,
not a downloadable historical recording.

The existing Redis FIFO retains the original validated report and retry errors
until Kafka confirms delivery. Its approved policy is an initial attempt plus
three retries, followed by discard. Multiple instances use token-checked leases.
Delivery is at least once: a crash between Kafka acknowledgment and Redis
completion can still cause a duplicate.

## Logs

| Event                                           | Contents                                                |
| ----------------------------------------------- | ------------------------------------------------------- |
| `radio_capture_started`                         | Station name/ID, clip ID, configured duration           |
| `radio_filter_result`                           | Pass/fail and reason, without rejected text             |
| `radio_transcribed`                             | Accepted transcript, once, with clip/station ID         |
| `radio_analysis_completed`                      | Accepted matches, categories and language metadata      |
| `radio_transformer_input`                       | Accepted clip/station identity                          |
| `radio_transformer_stage_completed`             | Completed processing stage, metadata only               |
| `radio_kafka_sending`                           | Topic, publication ID and attempt, without content      |
| `radio_kafka_acknowledged`                      | Broker acknowledgment                                   |
| `radio_pipeline_completed`                      | Confirmed publication                                   |
| `radio_station_failed`, `radio_pipeline_failed` | Failure and stage metadata                              |

A sending event alone does not confirm Kafka accepted a report. The executable
local schema remains provisional unless the final DE JSON Schema is configured
through `DE_RAW_REPORT_SCHEMA_PATH`.

## Verify

```powershell
npm run build
npx tsc --noEmit
npm run lint
npm test
.\.venv-radio\Scripts\python.exe -B -m unittest discover -s test/radio -p 'test_*.py'
npm run radio:demo
```

The Python tests exercise real PyAV frames, RAM WAV bounds and the cache-first
model download. `radio:demo` performs real loopback HTTP capture, ASR and filtering. If its public
speech fixture is absent, this explicit diagnostic fetches it into RAM only.

To run real infrastructure tests, configure isolated test services, never
production endpoints:

```powershell
$env:REDIS_TEST_URL='redis://127.0.0.1:16379'
$env:KAFKA_TEST_BROKERS='127.0.0.1:19092'
npm test
```

Normal unit tests use I/O doubles unless test endpoints are supplied.

To sample all configured live streams with short RAM-only captures:

```powershell
$env:RADIO_SMOKE_SECONDS='3'
node test/radio/run-live-smoke.mjs
# Optionally restrict the diagnostic:
$env:RADIO_SMOKE_STATIONS='mosaique-fm,al-aqsa-tv-audio'
node test/radio/run-live-smoke.mjs
```

This uses the same isolated test endpoints and real pipeline. Production recording
constants remain unchanged. Three seconds checks connectivity and short ASR, not
speech accuracy or continuous availability. Accepted samples are published only
to the configured test broker. Opening/probing is bounded to 20 seconds; stalled
reads to 15 seconds, in addition to the configured whole-worker timeout.
