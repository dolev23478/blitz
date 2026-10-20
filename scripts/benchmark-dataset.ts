import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeText } from "../src/index.js";
import type { LanguageInput } from "../src/types.js";

interface DatasetItem {
  id: string;
  text: string;
  lang?: LanguageInput;
  expected?: boolean;
  category?: string;
  note?: string;
}

function parseRawDataset(rawContent: string, filePath: string): DatasetItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // If not valid JSON, treat as newline-delimited text
    const lines = rawContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return lines.map((line, idx) => ({
      id: `LINE-${idx + 1}`,
      text: line,
      expected: true,
    }));
  }

  // Format 1: Array of items
  if (Array.isArray(parsed)) {
    return parsed.map((item, idx) => {
      if (typeof item === "string") {
        return {
          id: `ITEM-${idx + 1}`,
          text: item,
          expected: true,
        };
      }
      if (item && typeof item === "object" && typeof (item as any).text === "string") {
        return {
          id: (item as any).id || `ITEM-${idx + 1}`,
          text: (item as any).text,
          lang: (item as any).lang,
          expected: (item as any).expected !== undefined ? Boolean((item as any).expected) : true,
          category: (item as any).category,
          note: (item as any).note,
        };
      }
      throw new Error(`Invalid item at index ${idx} in ${filePath}`);
    });
  }

  // Format 2: Object grouped by language or category, e.g. { "he": ["..."], "ar": [...] }
  if (parsed && typeof parsed === "object") {
    const items: DatasetItem[] = [];
    let count = 1;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        for (const entry of val) {
          if (typeof entry === "string") {
            items.push({
              id: `ITEM-${count++}`,
              text: entry,
              lang: key as LanguageInput,
              expected: true,
              category: key,
            });
          } else if (entry && typeof entry === "object" && typeof (entry as any).text === "string") {
            items.push({
              id: (entry as any).id || `ITEM-${count++}`,
              text: (entry as any).text,
              lang: (entry as any).lang || (key as LanguageInput),
              expected: (entry as any).expected !== undefined ? Boolean((entry as any).expected) : true,
              category: (entry as any).category || key,
              note: (entry as any).note,
            });
          }
        }
      }
    }
    return items;
  }

  throw new Error(`Unsupported dataset format in ${filePath}`);
}

async function runBenchmark() {
  const customPath = process.argv[2];
  const targetPath = resolve(process.cwd(), customPath || "test/fixtures/terror-dataset.json");

  console.log("================================================================");
  console.log("       TEXT ANALYZER BENCHMARK & DATASET VERIFICATION           ");
  console.log("================================================================");
  console.log(`Loading dataset from: ${targetPath}\n`);

  if (!existsSync(targetPath)) {
    console.error(`Error: Dataset file not found at ${targetPath}`);
    process.exit(1);
  }

  const raw = readFileSync(targetPath, "utf-8");
  const dataset = parseRawDataset(raw, targetPath);

  if (dataset.length === 0) {
    console.warn("Dataset is empty. Add sentences to benchmark.");
    return;
  }

  console.log(`Loaded ${dataset.length} sentences. Running analysis...\n`);

  // Warm-up load
  analyzeText("warmup test", "auto");

  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const conceptCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();

  const missedThreats: Array<{ item: DatasetItem; detectedLangs: string[] }> = [];
  const falseAlarms: Array<{ item: DatasetItem; matches: string[] }> = [];

  const startTime = performance.now();

  for (const item of dataset) {
    const lang = item.lang ?? "auto";
    const result = analyzeText(item.text, lang);

    // Track languages
    if (result.languages) {
      for (const l of result.languages) {
        languageCounts.set(l, (languageCounts.get(l) || 0) + 1);
      }
    }

    // Track concepts
    for (const match of result.matches) {
      const c = match.concept || "unclassified";
      conceptCounts.set(c, (conceptCounts.get(c) || 0) + 1);
    }

    const matched = result.matched;
    const expected = item.expected !== false; // default true if not specified

    if (expected && matched) {
      truePositives++;
    } else if (!expected && !matched) {
      trueNegatives++;
    } else if (expected && !matched) {
      falseNegatives++;
      missedThreats.push({
        item,
        detectedLangs: result.languages || [result.language],
      });
    } else if (!expected && matched) {
      falsePositives++;
      falseAlarms.push({
        item,
        matches: result.terms,
      });
    }
  }

  const totalTimeMs = performance.now() - startTime;
  const avgMsPerItem = totalTimeMs / dataset.length;
  const throughput = Math.round((dataset.length / (totalTimeMs / 1000)));

  console.log("----------------------------------------------------------------");
  console.log("PERFORMANCE BENCHMARK RESULTS:");
  console.log("----------------------------------------------------------------");
  console.log(`Total sentences processed: ${dataset.length}`);
  console.log(`Total elapsed time:        ${totalTimeMs.toFixed(2)} ms`);
  console.log(`Average time per sentence: ${avgMsPerItem.toFixed(3)} ms`);
  console.log(`Throughput:                ~${throughput.toLocaleString()} sentences/sec`);

  console.log("\n----------------------------------------------------------------");
  console.log("DETECTION ACCURACY:");
  console.log("----------------------------------------------------------------");
  const totalPositivesExpected = truePositives + falseNegatives;
  const totalNegativesExpected = trueNegatives + falsePositives;

  console.log(`True Positives  (Detected threats):       ${truePositives}`);
  console.log(`True Negatives  (Clean texts passed):      ${trueNegatives}`);
  console.log(`False Negatives (MISSED threats):          ${falseNegatives} ${falseNegatives > 0 ? "⚠️" : "✅"}`);
  console.log(`False Positives (False alarms on clean):   ${falsePositives} ${falsePositives > 0 ? "⚠️" : "✅"}`);

  if (totalPositivesExpected > 0) {
    const recall = ((truePositives / totalPositivesExpected) * 100).toFixed(1);
    console.log(`Threat Recall Rate:                        ${recall}%`);
  }

  if (truePositives + falsePositives > 0) {
    const precision = ((truePositives / (truePositives + falsePositives)) * 100).toFixed(1);
    console.log(`Precision Rate:                            ${precision}%`);
  }

  const totalCorrect = truePositives + trueNegatives;
  const overallAccuracy = ((totalCorrect / dataset.length) * 100).toFixed(1);
  console.log(`Overall Accuracy:                          ${overallAccuracy}%`);

  console.log("\n----------------------------------------------------------------");
  console.log("DETECTED LANGUAGES BREAKDOWN:");
  console.log("----------------------------------------------------------------");
  for (const [lang, count] of [...languageCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${lang.padEnd(10)}: ${count} occurrences`);
  }

  if (conceptCounts.size > 0) {
    console.log("\n----------------------------------------------------------------");
    console.log("TOP TRIGGERED CONCEPTS:");
    console.log("----------------------------------------------------------------");
    const topConcepts = [...conceptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [concept, count] of topConcepts) {
      console.log(`  - ${concept.padEnd(25)}: ${count} matches`);
    }
  }

  if (missedThreats.length > 0) {
    console.log("\n================================================================");
    console.log("🚨 MISSED THREATS (FALSE NEGATIVES - REQUIRES VOCABULARY UPDATE):");
    console.log("================================================================");
    missedThreats.forEach(({ item, detectedLangs }, idx) => {
      console.log(`\n[${idx + 1}] ID: ${item.id} | Lang: ${item.lang || "auto"} (Detected: ${detectedLangs.join(", ")})`);
      if (item.category) console.log(`    Category: ${item.category}`);
      if (item.note) console.log(`    Note:     ${item.note}`);
      console.log(`    Text:     "${item.text}"`);
    });
  }

  if (falseAlarms.length > 0) {
    console.log("\n================================================================");
    console.log("⚠️ FALSE ALARMS (CLEAN SENTENCES FLAGGED AS THREAT):");
    console.log("================================================================");
    falseAlarms.forEach(({ item, matches }, idx) => {
      console.log(`\n[${idx + 1}] ID: ${item.id} | Matches: [${matches.join(", ")}]`);
      if (item.category) console.log(`    Category: ${item.category}`);
      console.log(`    Text:     "${item.text}"`);
    });
  }

  console.log("\n================================================================");
  if (falseNegatives === 0 && falsePositives === 0) {
    console.log("🎉 ALL TESTS PASSED WITH 100% ACCURACY! 🎉");
  } else {
    console.log(`Finished with ${falseNegatives} missed threats and ${falsePositives} false alarms.`);
  }
  console.log("================================================================\n");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
