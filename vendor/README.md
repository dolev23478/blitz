# Offline dependencies

Git contains the manifests and small configuration/tokenizer files. Transfer the
large binaries manually, preserving their paths inside this directory before
building on the closed network. `runtime-*.part` and `model.bin` are Git-ignored
so normal pushes do not upload hundreds of MB.

- `offline-base/runtime-*.part`: ordered parts of a gzip-compressed Docker image
  containing Node, Python, the native build toolchain, PyAV, faster-whisper and
  all Python/system dependencies. Parts are at most 48 MiB each.
- `offline-base/manifest.json`: image ID, platform, part sizes and checksums.
- `offline-base/python-requirements.txt`: the exact installed Python versions.
- `radio-models/<model>/`: real model/tokenizer files and their checksum manifest.

These are real binary contents, not Git LFS pointers or links to download later.
`.gitattributes` preserves their exact bytes across Windows/Linux checkouts.

`npm run offline:vendor` prepares/updates these assets on a connected machine.
`npm run image:build` validates and imports them locally before building. Only
the npm dependency installation step has network enabled in the application
Dockerfile. See `docs/OFFLINE_DEPLOYMENT.md` for the complete workflow.
