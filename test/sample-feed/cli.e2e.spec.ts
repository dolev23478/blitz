/**
 * End to end through the real Nest application context: builds the app with tsc (so Nest DI gets
 * decorator metadata, which vitest's esbuild does not emit) and runs the CLI as the team would.
 * Skipped in `npm test` (it builds dist/); run it with `npm run test:samples`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const node = process.execPath;
const cli = 'dist/sample-feed/cli.js';
const dir = mkdtempSync(join(tmpdir(), 'blitz-sample-feed-'));

function run(...args: string[]) {
  const report = join(dir, `${Date.now()}-${Math.random()}.json`);
  const res = spawnSync(node, [cli, '--quiet', '--report', report, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KAFKA_BROKERS: '' },
  });
  let json: any;
  try {
    json = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    json = undefined;
  }
  return { code: res.status, out: res.stdout + res.stderr, json };
}

describe.skipIf(!process.env.SAMPLE_FEED_E2E)(
  'sample-feed CLI (Nest application context)',
  () => {
    beforeAll(() => {
      execFileSync(node, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], {
        stdio: 'inherit',
      });
    }, 180_000);

    it('local run of the default samples uses the team modules and sends nothing', () => {
      const { code, json, out } = run();
      expect(out).toMatch(/Mode: LOCAL/);
      expect(json.sources).toMatchObject({
        filter: 'team',
        transformer: 'team',
        publisher: 'stand-in',
        dedup: 'missing',
      });
      expect(json.summary).toMatchObject({
        read: 14,
        filtered: 3,
        failed: 0,
        processed: 11,
        localOnly: 11,
        kafkaConfirmed: 0,
      });
      // The only expectation that fails is the duplicate, because no dedup component exists yet.
      expect(
        json.results
          .filter((r: any) => r.mismatches.length)
          .map((r: any) => r.id),
      ).toEqual(['dup-second']);
      expect(code).toBe(1);
    }, 60_000);

    it('scenario selection runs only the tagged samples', () => {
      const { json } = run('--scenario', 'filtered');
      expect(json.results.map((r: any) => r.status)).toEqual([
        'filtered',
        'filtered',
        'filtered',
      ]);
      expect(json.summary.notSelected).toBe(11);
    }, 60_000);

    it('invalid input is reported per sample and field, valid samples in the file still run', () => {
      const { code, json, out } = run('--file', 'samples/invalid-posts.json');
      expect(code).toBe(1);
      expect(out).toMatch(
        /sample "invalid-x-media-type", field post\.posts\[0\]\.media\[0\]\.type/,
      );
      expect(json.summary.invalidInput).toBe(8);
      expect(json.results.map((r: any) => [r.id, r.status])).toEqual([
        ['transformer-rejects-html', 'failed'],
        ['valid-control', 'processed'],
      ]);
    }, 60_000);

    it('--publish refuses while stand-ins are in the chain, and sends nothing', () => {
      const { code, out } = run('--publish');
      expect(code).toBe(2);
      expect(out).toMatch(/Nothing was sent/);
    }, 60_000);
  },
);
