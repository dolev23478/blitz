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

For Linux Docker deployment from Git, use the
[offline deployment guide](../../docs/OFFLINE_DEPLOYMENT.md). Python packages and
model files must be prepared on the connected machine. Git contains the small
metadata; transfer `runtime-*.part` and `model.bin` manually into their vendor
paths. Normal image builds need only npm registry access; runtime does not
install packages or download models.

For development on a connected Windows machine:

```powershell
python -m venv .venv-radio
.\.venv-radio\Scripts\python.exe -m pip install -r requirements-radio.txt
npm ci
npm run radio:prepare-model
npm run build
```

Linux uses `.venv-radio/bin/python`. Model files live in
`vendor/radio-models/<RADIO_MODEL>`. Runtime loads only these local files with
Hugging Face offline mode enabled. Missing files fail before contacting a station;
there is no download fallback or external transcription API. Changing the model
requires preparing its files before deployment.

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
RADIO_MODELS_DIR=vendor/radio-models
RADIO_DATA_DIR=.radio
RADIO_CPU_THREADS=2
RADIO_JOB_TIMEOUT_SECONDS=900
# Windows default; Linux uses .venv-radio/bin/python:
# RADIO_PYTHON_PATH=.venv-radio/Scripts/python.exe
```

Data/model paths must stay inside the project. `RADIO_DATA_DIR` is reserved for
library cache/temp locations, not recordings. `RADIO_MAX_CLIPS`,
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
not a downloadable historical recording. Kafka keys are exactly this URL,
including retries and remote mirroring.

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
| `radio_kafka_sending`                           | Topic, key, publication ID and attempt, without content |
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
.\.venv-radio\Scripts\python.exe -B scripts/check-radio-offline.py
npm run radio:demo
```

The Python tests exercise real PyAV frames and RAM WAV bounds. Offline checking
verifies model hashes and actual silence ASR with socket connections blocked.
`radio:demo` performs real loopback HTTP capture, ASR and filtering. If its public
speech fixture is absent, this explicit diagnostic fetches it into RAM only.

To run real infrastructure tests, configure isolated test services, never
production endpoints:

```powershell
$env:REDIS_TEST_URL='redis://127.0.0.1:16379'
$env:KAFKA_TEST_BROKERS='127.0.0.1:19092'
npm test
# An EXISTING audio fixture whose speech passes the current dictionaries:
$env:RADIO_E2E_AUDIO_PATH='path/to/existing-arabic-speech.wav'
# Optional existing speech that does not pass the dictionaries:
$env:RADIO_E2E_REJECTED_AUDIO_PATH='path/to/existing-nonmatching-speech.wav'
npm run radio:test:e2e
```

`radio:test:e2e` builds, then uses real Python/ASR, dictionaries, Nest modules,
Redis and Kafka. Audio fixtures are read into RAM and never copied or saved.
It checks acceptance, silence, optional non-matching speech, stream failure,
payload/key, logging and absence of output files. It also forces an actual TCP
publication failure, restarts publisher/client instances, verifies the persisted
retry delay and report, and checks concurrent recovery publishes one record.
The retry recovery phase deliberately waits about 60 seconds. Only a unique test
Redis namespace is removed; existing radio files and application queues are left
untouched. Normal unit tests use I/O doubles unless test endpoints are supplied.

The E2E runner also verifies discard after the initial attempt plus three retries.
To additionally restart the isolated Redis server during recovery, explicitly set
`RADIO_E2E_RESTART_REDIS_CONTAINER=blitz-radio-e2e-redis`. Docker must be available
to the runner; only container names beginning with `blitz-radio-e2e-` are accepted.
Redis needs persistence enabled for that server-restart check.

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

## Verification performed on 2026-10-21

- Build, TypeScript checking and lint passed; lint retains two existing spread
  warnings outside radio. All 466 Vitest tests passed with real Redis/Kafka
  integration enabled. Four Python tests passed, including delayed HTTP opening.
- Full real-ASR pipeline accepted one Arabic speech fixture, rejected speech
  without dictionary matches and silence, and handled an unavailable stream.
  Kafka consumption verified the JSON contract fields and exact URL key.
- A real TCP failure retained the report/error/due time in Redis. Publisher/client
  restart and a separate Redis container restart preserved it. Two publishers
  recovered one observed Kafka record. Initial attempt plus three failed retries
  discarded a separate report according to the approved policy.
- The full pipeline also passed inside the final Linux image with a read-only
  filesystem. No recordings or transcript files were written. Model ASR and full
  Nest health checks passed with Docker networking disabled.
- All nine configured live feeds were sampled for three seconds. Intermittent
  opening timeouts recovered on recheck after increasing the bounded opening
  timeout to 20 seconds. This is a connectivity sample, not an availability or
  transcription-accuracy guarantee.
- A source-transfer snapshot without host Node/Python dependencies or radio
  caches rebuilt successfully using the local vendor image and npm registry
  access. A completely network-disabled clean build requires a complete npm
  cache; the optional check initially found a missing npm tarball. Non-npm build
  stages and runtime model loading need no internet access.
