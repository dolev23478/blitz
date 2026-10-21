import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export const dependencyImage = 'blitz-deps:node24-radio-v1';
export const assetDirectory = resolve('vendor/offline-base');
export const platform = process.env.OFFLINE_PLATFORM || 'linux/amd64';
if (!['linux/amd64', 'linux/arm64'].includes(platform))
  throw new Error('Unsupported OFFLINE_PLATFORM.');

export function docker(args, capture = false) {
  return new Promise((accept, reject) => {
    const child = spawn('docker', args, {
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? accept(output.trim())
        : reject(new Error(`docker ${args[0]} failed (${code})`)),
    );
  });
}

export async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function digestSourceFile(path) {
  // Git may check out CRLF on Windows; source identity must be platform-independent.
  return createHash('sha256')
    .update((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'))
    .digest('hex');
}

export async function loadDependencyImage() {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(resolve(assetDirectory, 'manifest.json'), 'utf8'),
    );
  } catch {
    throw new Error(
      'Vendor manifests are missing. Prepare them with npm run offline:vendor on a connected machine, commit the metadata and transfer the matching binaries manually.',
    );
  }
  if (manifest.image !== dependencyImage || manifest.platform !== platform)
    throw new Error(
      'Vendored dependency image/platform does not match this build.',
    );
  for (const file of ['Dockerfile.dependencies', 'requirements-radio.txt']) {
    if ((await digestSourceFile(file)) !== manifest.sources[file])
      throw new Error(
        `${file} changed: regenerate vendor assets on the connected machine.`,
      );
  }
  await mkdir('.offline', { recursive: true });
  const archive = resolve('.offline/dependency-image.tar.gz');
  const temporary = archive + '.tmp';
  const output = await open(temporary, 'w');
  const hash = createHash('sha256');
  try {
    for (const part of manifest.parts) {
      if (!/^runtime-\d{4}\.part$/.test(part.name))
        throw new Error('Invalid vendor part name.');
      const digest = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(
        resolve(assetDirectory, part.name),
      )) {
        hash.update(chunk);
        digest.update(chunk);
        bytes += chunk.length;
        await output.writeFile(chunk);
      }
      if (bytes !== part.bytes || digest.digest('hex') !== part.sha256)
        throw new Error(`Corrupt/incomplete Git asset: ${part.name}`);
    }
    if (hash.digest('hex') !== manifest.sha256)
      throw new Error('Dependency archive checksum mismatch.');
  } finally {
    await output.close();
  }
  await rename(temporary, archive);
  await docker(['load', '--input', archive]);
  const id = await docker(
    ['image', 'inspect', dependencyImage, '--format', '{{.Id}}'],
    true,
  );
  if (id !== manifest.imageId)
    throw new Error('Loaded dependency image does not match the Git manifest.');
  return manifest;
}
