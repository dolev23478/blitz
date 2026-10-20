/**
 * Feeds fixed sample posts into the BLITZ components instead of the collectors.
 * Default: local run, nothing is sent to Kafka. See docs/sample-feed.md.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  CannotRunError,
  createSampleFeedContext,
  type SampleFeedContext,
} from './context.js';
import {
  runSamples,
  summarize,
  type RunSummary,
  type SampleResult,
} from './runner.js';
import { loadSamples, selectScenario, type SampleIssue } from './samples.js';

const USAGE = `Usage: npm run samples -- [options]

  --file <path>          samples file (default: samples/posts.json)
  --scenario <tag>       run only samples with this tag, e.g. duplicate, filtered, mixed-language, x
  --dictionaries <dir>   dictionaries for Leonid's filter (default: DICTIONARIES_DIR, else the demo
                         set in samples/dictionaries)
  --publish              really send to reports.raw with the settings in .env (KAFKA_*)
  --report <path>        also write the results as JSON
  --quiet                do not print the message JSON
  --help

Exit codes: 0 all good, 1 invalid input / failures / expectation mismatches, 2 cannot run.`;

function printIssues(issues: SampleIssue[]): void {
  console.log(
    `\nInvalid input (${issues.length} issue(s)); these samples were not run:`,
  );
  for (const i of issues)
    console.log(
      `  ✗ sample "${i.sample}", field ${i.field || '(sample)'}: ${i.message}`,
    );
}

function printResult(
  r: SampleResult,
  index: number,
  total: number,
  quiet: boolean,
): void {
  const o = r.outcome;
  const head = `[${index + 1}/${total}] ${r.sample.id} (${r.sample.format})`;
  if (o.status === 'filtered') {
    console.log(`${head} → filtered out (language=${o.language})`);
  } else if (o.status === 'failed') {
    console.log(`${head} → FAILED at ${o.stage}: ${o.error}`);
  } else {
    const local = o.published.some((p) => !p.confirmed);
    console.log(
      `${head} → processed (${local ? 'local only, NOT sent' : 'confirmed by Kafka'})`,
    );
    console.log(
      `    language=${o.language}  matches=${JSON.stringify(o.matches)}`,
    );
    for (const p of o.published) {
      console.log(`    key: ${p.key}`);
      if (!quiet && p.json) console.log(`    message: ${p.json}`);
    }
    for (const g of o.contractGaps) console.log(`    ≠ schemas.html: ${g}`);
  }
  for (const m of r.mismatches) console.log(`    ! expectation: ${m}`);
}

function printSummary(s: RunSummary, feed: SampleFeedContext): void {
  console.log(`
Summary
  read from file         ${s.read}
  invalid input          ${s.invalidInput}${s.notSelected ? `\n  not in scenario        ${s.notSelected}` : ''}
  filtered out           ${s.filtered}
  duplicates             ${s.duplicates ?? 'not detectable (no dedup component yet)'}
  failed                 ${s.failed}
  processed              ${s.processed}
    local only (not sent)    ${s.localOnly}
    confirmed by Kafka       ${s.kafkaConfirmed}
  with contract gaps     ${s.withContractGaps}  (vs schemas.html 19.10; not the DE JSON Schema)
  expectation mismatches ${s.expectationMismatches}`);
  const notTeam = Object.entries(feed.sources).filter(([, v]) => v !== 'team');
  if (notTeam.length) {
    console.log(
      `\nNot team components: ${notTeam.map(([k, v]) => `${k} (${v})`).join(', ')}.`,
    );
    console.log(
      'Results of these steps are a local demo or absent, not results of the real components.',
    );
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: 'samples/posts.json' },
      scenario: { type: 'string' },
      dictionaries: { type: 'string' },
      publish: { type: 'boolean', default: false },
      report: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const mode = values.publish ? 'publish' : 'local';

  const loaded = await loadSamples(values.file);
  const selected = selectScenario(loaded.valid, values.scenario);
  console.log(
    `Samples: ${values.file}${values.scenario ? `, scenario "${values.scenario}"` : ''} (${selected.length} to run)`,
  );
  if (values.scenario && selected.length === 0 && loaded.issues.length === 0) {
    console.error(`No sample is tagged "${values.scenario}".`);
    return 2;
  }

  const feed = await createSampleFeedContext({
    mode,
    dictionariesDir: values.dictionaries,
  });
  try {
    console.log(
      mode === 'local'
        ? 'Mode: LOCAL (Nest context with the team modules; only PublishingProcessor is replaced, nothing is sent)'
        : 'Mode: PUBLISH to reports.raw with the .env Kafka settings',
    );
    console.log(
      `Components: ${Object.entries(feed.sources)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`,
    );
    console.log(
      `Dictionaries loaded for: ${feed.dictionaryLanguages.join(', ') || 'none'}`,
    );
    console.log(
      `Transformer validation: ${feed.deSchemaConfigured ? 'provisional rules + DE JSON Schema' : 'provisional rules only (DE_RAW_REPORT_SCHEMA_PATH not set)'}\n`,
    );

    const results = await runSamples(feed.pipeline, selected);
    results.forEach((r, i) => printResult(r, i, results.length, values.quiet));
    if (loaded.issues.length) printIssues(loaded.issues);

    const summary = summarize(
      results,
      {
        read: loaded.valid.length + loaded.invalidCount,
        invalidInput: loaded.invalidCount,
        notSelected: loaded.valid.length - selected.length,
      },
      feed.sources.dedup !== 'missing',
    );
    printSummary(summary, feed);
    if (values.report) {
      const rows = results.map(({ sample, outcome, mismatches }) => ({
        id: sample.id,
        ...outcome,
        mismatches,
      }));
      await writeFile(
        values.report,
        JSON.stringify(
          {
            mode,
            sources: feed.sources,
            summary,
            results: rows,
            issues: loaded.issues,
          },
          null,
          2,
        ),
      );
    }
    return summary.invalidInput ||
      summary.failed ||
      summary.expectationMismatches
      ? 1
      : 0;
  } finally {
    await feed.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    if ((err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS'))
      console.error(`\n${USAGE}`);
    else if (!(err instanceof CannotRunError) && process.env.DEBUG)
      console.error(err);
    process.exit(2);
  },
);
