import { loadDependencyImage } from './offline-assets.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.offline');
const image = 'blitz:offline';
const platform = process.env.OFFLINE_PLATFORM || 'linux/amd64';
if (!['linux/amd64', 'linux/arm64'].includes(platform))
  throw new Error('OFFLINE_PLATFORM must be linux/amd64 or linux/arm64.');
const model = process.env.RADIO_MODEL || 'tiny';
if (!['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'].includes(model))
  throw new Error('Unsupported RADIO_MODEL.');
await readFile(resolve('vendor/radio-models', model, 'manifest.json')); // Fail before an expensive build if preparation was skipped.
await mkdir(directory, { recursive: true });

function run(args) {
  return new Promise((accept, reject) => {
    const child = spawn('docker', args, {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? accept()
        : reject(new Error(`docker ${args[0]} failed (${code})`)),
    );
  });
}

await loadDependencyImage();
await run([
  'build',
  '--pull=false',
  '--platform',
  platform,
  '--build-arg',
  `RADIO_MODEL=${model}`,
  '-t',
  image,
  '.',
]);
await run([
  'run',
  '--pull',
  'never',
  '--rm',
  '--network',
  'none',
  '-e',
  `RADIO_MODEL=${model}`,
  '--entrypoint',
  '/app/.venv-radio/bin/python',
  image,
  'scripts/check-radio-offline.py',
  model,
]);
await run([
  'run',
  '--pull',
  'never',
  '--rm',
  '--network',
  'none',
  '--entrypoint',
  'node',
  image,
  '--input-type=module',
  '-e',
  `
  import 'reflect-metadata';
  import assert from 'node:assert/strict';
  import { NestFactory } from '@nestjs/core';
  import { FastifyAdapter } from '@nestjs/platform-fastify';
  process.env.RADIO_ENABLED = 'false';
  process.env.REDIS_URL = '';
  process.env.TG_API_ID = '';
  process.env.TG_API_HASH = '';
  process.env.TG_SESSION_STRING = '';
  const { AppModule } = await import('./dist/app.module.js');
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const response = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    console.log(JSON.stringify({ offlineNodeStartup: 'passed', healthStatus: response.statusCode, liveCollectorsDisabled: true }));
  } finally { await app.close(); }
`,
]);
await run(['save', '-o', resolve(directory, 'blitz-image.tar'), image]);
const hash = createHash('sha256');
for await (const chunk of createReadStream(
  resolve(directory, 'blitz-image.tar'),
))
  hash.update(chunk);
const checksum = hash.digest('hex');
await writeFile(
  resolve(directory, 'blitz-image.tar.sha256'),
  `${checksum}  blitz-image.tar\n`,
);
await copyFile('.env.example', resolve(directory, '.env.example')); // Never copy real credentials into the bundle.
await copyFile(
  'docs/OFFLINE_DEPLOYMENT.md',
  resolve(directory, 'OFFLINE_DEPLOYMENT.md'),
);
await writeFile(
  resolve(directory, 'manifest.json'),
  JSON.stringify(
    {
      image,
      platform,
      model,
      sha256: checksum,
      verifiedWithoutNetwork: true,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Offline bundle ready: ${directory}. Transfer this directory; do not build/install on the closed network.`,
);
