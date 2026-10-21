import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import {
  assetDirectory,
  dependencyImage,
  digestSourceFile,
  docker,
  platform,
} from './offline-assets.mjs';

const model = process.env.RADIO_MODEL || 'tiny';
if (!['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'].includes(model))
  throw new Error('Unsupported RADIO_MODEL.');
await mkdir(assetDirectory, { recursive: true });
await mkdir('.offline', { recursive: true });
await docker([
  'build',
  '--platform',
  platform,
  '-f',
  'Dockerfile.dependencies',
  '-t',
  dependencyImage,
  '.',
]);
await docker([
  'run',
  '--pull=never',
  '--rm',
  '-e',
  'HF_HUB_OFFLINE=0',
  '-e',
  'TRANSFORMERS_OFFLINE=0',
  '-v',
  `${process.cwd()}:/workspace`,
  '-w',
  '/workspace',
  '--entrypoint',
  '/app/.venv-radio/bin/python',
  dependencyImage,
  'scripts/prepare-radio-model.py',
  model,
]);
const frozen = await docker(
  [
    'run',
    '--pull=never',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    '/app/.venv-radio/bin/python',
    dependencyImage,
    '-m',
    'pip',
    'freeze',
  ],
  true,
);
await writeFile(
  resolve(assetDirectory, 'python-requirements.txt'),
  frozen + '\n',
);
const archive = resolve('.offline/dependency-image.tar');
await docker(['save', '-o', archive, dependencyImage]);
const gzip = createReadStream(archive).pipe(createGzip({ level: 6 }));
const parts = [];
const total = createHash('sha256');
const limit = 48 * 1024 * 1024; // Each Git file stays below GitHub's 100 MiB limit.
let file, part, digest;
try {
  for await (const chunk of gzip) {
    total.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      if (!file) {
        part = {
          name: `runtime-${String(parts.length + 1).padStart(4, '0')}.part`,
          bytes: 0,
        };
        digest = createHash('sha256');
        file = await open(resolve(assetDirectory, part.name), 'w');
      }
      const block = chunk.subarray(
        offset,
        offset + Math.min(chunk.length - offset, limit - part.bytes),
      );
      await file.writeFile(block);
      digest.update(block);
      part.bytes += block.length;
      offset += block.length;
      if (part.bytes === limit) {
        await file.close();
        file = undefined;
        parts.push({ ...part, sha256: digest.digest('hex') });
      }
    }
  }
  if (file) {
    await file.close();
    file = undefined;
    parts.push({ ...part, sha256: digest.digest('hex') });
  }
} finally {
  await file?.close();
}
const names = new Set(parts.map((entry) => entry.name));
for (const name of await readdir(assetDirectory)) {
  if (/^runtime-\d{4}\.part$/.test(name) && !names.has(name))
    await unlink(resolve(assetDirectory, name));
}
const sources = Object.fromEntries(
  await Promise.all(
    ['Dockerfile.dependencies', 'requirements-radio.txt'].map(async (path) => [
      path,
      await digestSourceFile(path),
    ]),
  ),
);
const imageId = await docker(
  ['image', 'inspect', dependencyImage, '--format', '{{.Id}}'],
  true,
);
await writeFile(
  resolve(assetDirectory, 'manifest.json'),
  JSON.stringify(
    {
      image: dependencyImage,
      imageId,
      platform,
      sha256: total.digest('hex'),
      sources,
      parts,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Offline assets are ready. Commit the small vendor metadata; manually transfer runtime-*.part and model.bin into their vendor paths.',
);
