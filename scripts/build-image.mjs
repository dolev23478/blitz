import { docker, loadDependencyImage, platform } from './offline-assets.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--offline-npm', '--no-cache'].includes(arg)))
  throw new Error('Usage: npm run image:build -- [--offline-npm] [--no-cache]');
await loadDependencyImage();
const model = process.env.RADIO_MODEL || 'tiny';
await docker([
  'build',
  '--pull=false',
  '--platform',
  platform,
  ...(args.includes('--offline-npm') ? ['--network', 'none'] : []),
  ...(args.includes('--no-cache') ? ['--no-cache'] : []),
  '--build-arg',
  `RADIO_MODEL=${model}`,
  '-t',
  'blitz:offline',
  '.',
]);
