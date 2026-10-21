# Build and run from Git in a closed network

The normal application Dockerfile needs only npm registry access during build.
It never runs apt/pip, clones GitHub repositories or downloads a model. Runtime
uses local Python packages and Whisper files, with hub access disabled.

## One-time preparation on the connected machine

```sh
npm run offline:vendor
```

This command requires Node 24 and Linux Docker; it does not need host Python or
host npm dependencies. It builds `Dockerfile.dependencies` while internet access
is available, packages Node/Python/system libraries and native build tools into
`vendor/offline-base/runtime-*.part`, and prepares the model in
`vendor/radio-models/<model>`. `RADIO_MODEL` defaults to `tiny`.

**Push the source, Dockerfiles, scripts and small vendor metadata to Git.
Transfer the large binaries manually.** They are deliberately Git-ignored so
ordinary pushes stay small. The current bundle needs these eight files:

- `vendor/offline-base/runtime-0001.part` through `runtime-0007.part`
- `vendor/radio-models/tiny/model.bin`

Keep the exact paths when copying them into the checkout on the target. Each
dependency-image part is at most 48 MiB; the tiny model binary is about 76 MB.
Use the manifests committed alongside them to verify the matching bundle. These
are actual binary files, not LFS pointers; copying them requires no package/model
download on the target. Keep `.offline/`, `.radio/` and `.venv-radio/` ignored.

### Uploading the binaries to GitHub

Use a [GitHub Release](https://github.com/lev03lev/blitz/releases/new?target=experiment)
and attach the files or a ZIP containing the `vendor/` directory as release assets.
The regular repository browser upload is limited to 25 MiB per file; release
assets support files below 2 GiB. See [GitHub's upload limits](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
and [release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

Download and extract the assets before transferring the prepared checkout into
the closed network. Extract the ZIP at the project root so its files end up in
`vendor/offline-base/` and `vendor/radio-models/tiny/`. A source-only Git clone
does not include release assets; the build/runtime never downloads them automatically.

`Dockerfile.dependencies` is ONLY a preparation recipe for the connected machine.
Do not build that file on the closed network. Re-run preparation, commit the
updated manifests and manually transfer the matching binaries when Python/system
dependencies or the target architecture change. `OFFLINE_PLATFORM` defaults to
`linux/amd64`; `linux/arm64` needs its own
prepared bundle. See `vendor/offline-base/python-requirements.txt` for the exact
installed Python dependencies, and `manifest.json` for image ID and checksums.

## Build from the transferred Git checkout

On the target, with Node 24 and Docker already installed:

```sh
npm run image:build
```

This script uses only Node built-ins, so no host `npm install` or Python setup is
required. Copy the manually transferred binaries into their paths first. The
script validates and reconstructs the dependency image from these local files,
loads it into Docker locally, then builds `blitz:offline` from the source.
The only network-enabled build instruction is `npm ci`. The lockfile's download
sources are npm registry tarballs. Lifecycle scripts are disabled to prevent
GitHub/native prebuild downloads. The SQLite native dependency compiles offline
using the vendored compiler, Python and Node headers. Compilation, pruning and
all other RUN instructions have networking disabled.

Npm registry access (public or your approved internal mirror) is the remaining
build requirement. `--offline-npm` is an optional stronger check for a machine
whose Docker npm cache is already populated:

```sh
npm run image:build -- --offline-npm --no-cache
```

This disables networking for the entire Docker build, including npm, and rebuilds
all application layers. An empty npm cache will fail in this optional mode;
normal closed-network builds may contact the allowed npm registry.

On Linux with Docker but no host Node, the equivalent basic path is:

```sh
cat vendor/offline-base/runtime-*.part | docker load
docker build --pull=false -t blitz:offline .
```

The Node wrapper is preferred because it also checks the manifests and hashes.
Loading the vendored image must happen before a direct `docker build`. No image
needs to be pulled from Docker Hub in the target network. Docker/BuildKit itself
must already be installed, just like the deployment's Redis/Kafka infrastructure.

## Verify and run

```sh
docker run --pull=never --rm --network none \
  --entrypoint /app/.venv-radio/bin/python \
  blitz:offline scripts/check-radio-offline.py
```

Configure `.env` for your internal Redis/Kafka and collector credentials. Use
addresses reachable from the container; `localhost` is the container itself.
Keep `RADIO_MODEL` consistent with the prepared local model files.

```sh
docker run --pull=never -d --name blitz --restart unless-stopped \
  --env-file .env -p 3000:3000 blitz:offline
docker logs -f blitz
```

For radio only, without Telegram/X or a compilation step:

```sh
docker run --pull=never --rm --env-file .env \
  blitz:offline node scripts/radio-pipeline.mjs
```

The running collectors still need their approved live-source connections:
Telegram MTProto, the configured X source/provider, radio streams/redirects, and
internal Redis/Kafka. No package registry, GitHub or model hub is needed at runtime.

## Optional prebuilt application image

`npm run offline:prepare` loads the same local vendor assets, builds the application,
checks ASR and Nest startup with `--network none`, and exports the finished image
to `.offline/blitz-image.tar` with a checksum and deployment guide. This is an
alternative to building from Git on the target. Transfer `.offline`, verify the
SHA-256, then `docker load -i blitz-image.tar`. Real credentials are not included.

## Radio retention

Capture, WAV encoding and ASR use bounded RAM. No temporary recordings or JSON/TXT
transcripts are written. Only accepted transcript text is logged; rejected text
is not. Historical archives are left untouched. Existing Redis publication retry
storage is unchanged. Radio URLs/Kafka keys use the source URL with `#clip=<UUID>`
to identify each observation; this is not a historical recording download URL.
