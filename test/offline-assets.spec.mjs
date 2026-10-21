import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';

const exec = promisify(execFile);
const helper = new URL('../scripts/offline-assets.mjs', import.meta.url).href;
const hash = (value) => createHash('sha256').update(value).digest('hex');
let directory;
let assets;
let manifest;
beforeEach(async () => {
  directory = resolve('.tmp', `offline-assets-${randomUUID()}`);
  assets = resolve(directory, 'vendor/offline-base');
  await mkdir(assets, { recursive: true });
  // A Windows checkout must validate against the same source hashes as Linux.
  await writeFile(resolve(directory, 'Dockerfile.dependencies'), 'recipe\r\n');
  await writeFile(
    resolve(directory, 'requirements-radio.txt'),
    'dependencies\r\n',
  );
  await writeFile(resolve(assets, 'runtime-0001.part'), 'binary archive');
  manifest = {
    image: 'blitz-deps:node24-radio-v1',
    platform: 'linux/amd64',
    sources: {
      'Dockerfile.dependencies': hash('recipe\n'),
      'requirements-radio.txt': hash('dependencies\n'),
    },
    parts: [
      { name: 'runtime-0001.part', bytes: 14, sha256: hash('binary archive') },
    ],
    sha256: hash('binary archive'),
  };
});
afterEach(async () => {
  expect(relative(resolve('.tmp'), directory)).toMatch(
    /^offline-assets-[a-f\d-]+$/,
  );
  await rm(directory, { recursive: true, force: true });
});

async function failure() {
  await writeFile(resolve(assets, 'manifest.json'), JSON.stringify(manifest));
  try {
    await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(helper)}); await m.loadDependencyImage();`,
      ],
      {
        cwd: directory,
        windowsHide: true,
        env: { ...process.env, OFFLINE_PLATFORM: 'linux/amd64' },
        timeout: 10000,
      },
    );
    throw new Error('Invalid assets unexpectedly reached Docker');
  } catch (error) {
    return error.stderr || error.message;
  }
}

it('rejects corrupt binary parts before Docker can import them', async () => {
  manifest.parts[0].sha256 = '0'.repeat(64);
  expect(await failure()).toContain('Corrupt/incomplete Git asset');
});
it('rejects a truncated Git transfer', async () => {
  manifest.parts[0].bytes = 100;
  expect(await failure()).toContain('Corrupt/incomplete Git asset');
});
it('rejects archive corruption even when each individual part hash matches', async () => {
  manifest.sha256 = '0'.repeat(64);
  expect(await failure()).toContain('Dependency archive checksum mismatch');
});
it('rejects unsafe part filenames before reading outside the vendor directory', async () => {
  manifest.parts[0].name = '../private-file';
  expect(await failure()).toContain('Invalid vendor part name');
});
it('requires regenerating assets after dependency requirements change', async () => {
  await writeFile(
    resolve(directory, 'requirements-radio.txt'),
    'new version\n',
  );
  expect(await failure()).toContain('requirements-radio.txt changed');
});
it('rejects a bundle for a different CPU architecture', async () => {
  manifest.platform = 'linux/arm64';
  expect(await failure()).toContain('image/platform does not match');
});
