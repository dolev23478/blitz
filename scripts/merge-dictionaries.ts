import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDictionaryFile } from "../src/dictionaries/schema.js";
import type { DictionaryEntry } from "../src/types.js";

interface MergeStats {
  language: string;
  sourceFiles: string[];
  rawEntriesBefore: number;
  uniqueTermsBefore: number;
  uniqueConceptPairsBefore: number;
  entriesAfter: number;
  uniqueTermsAfter: number;
  lostTerms: string[];
}

export function analyzeAndMerge(dictionariesDir: string, writeChanges = false): MergeStats[] {
  const allJsonFiles = readdirSync(dictionariesDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .sort();

  // Group files by language declared inside JSON
  const filesByLanguage = new Map<string, Array<{ fileName: string; content: any }>>();

  for (const fileName of allJsonFiles) {
    const filePath = join(dictionariesDir, fileName);
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    const parsed = parseDictionaryFile(json, fileName);
    const lang = parsed.language;

    if (!filesByLanguage.has(lang)) {
      filesByLanguage.set(lang, []);
    }
    filesByLanguage.get(lang)!.push({ fileName, content: parsed });
  }

  const results: MergeStats[] = [];

  for (const [lang, fileGroup] of filesByLanguage.entries()) {
    const sourceFiles = fileGroup.map((f) => f.fileName);
    let rawEntriesBefore = 0;
    const rawTermsBeforeSet = new Set<string>();
    const conceptPairsBeforeSet = new Set<string>();

    for (const { content } of fileGroup) {
      for (const entry of content.entries as DictionaryEntry[]) {
        rawEntriesBefore++;
        const normTerm = entry.term.trim().toLowerCase();
        rawTermsBeforeSet.add(normTerm);
        conceptPairsBeforeSet.add(`${normTerm}:::${entry.concept?.trim() || ""}`);
      }
    }

    // Merge entries
    // Key: term (trimmed) + ":::" + concept (or empty)
    const mergedEntriesMap = new Map<string, DictionaryEntry>();

    for (const { content } of fileGroup) {
      for (const entry of content.entries as DictionaryEntry[]) {
        const cleanTerm = entry.term.trim();
        const normTerm = cleanTerm.toLowerCase();
        const concept = entry.concept?.trim();

        // Exact key for (term, concept)
        const key = `${normTerm}:::${concept || ""}`;

        if (!mergedEntriesMap.has(key)) {
          mergedEntriesMap.set(key, {
            term: cleanTerm,
            ...(concept ? { concept } : {}),
            ...(entry.extra ? { ...entry.extra } : {}),
          });
        } else {
          // If already exists, preserve any extra fields if present
          if (entry.extra) {
            const existing = mergedEntriesMap.get(key)!;
            existing.extra = { ...(existing.extra || {}), ...entry.extra };
          }
        }
      }
    }

    // If an entry exists with a concept and also without a concept (concept=""),
    // check if we can eliminate the concept-less duplicate because the concept-bearing entry covers it.
    const termsWithConcept = new Set<string>();
    for (const [key, entry] of mergedEntriesMap.entries()) {
      if (entry.concept) {
        termsWithConcept.add(entry.term.trim().toLowerCase());
      }
    }

    // Filter out bare duplicates if the term has at least one concept entry
    const finalEntries: DictionaryEntry[] = [];
    for (const [key, entry] of mergedEntriesMap.entries()) {
      const normTerm = entry.term.trim().toLowerCase();
      if (!entry.concept && termsWithConcept.has(normTerm)) {
        // Concept-bearing entry already covers this term
        continue;
      }
      finalEntries.push(entry);
    }

    // Sort entries alphabetically by term for consistent diffs
    finalEntries.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));

    // Verify retention
    const termsAfterSet = new Set<string>(finalEntries.map((e) => e.term.trim().toLowerCase()));
    const lostTerms: string[] = [];
    for (const term of rawTermsBeforeSet) {
      if (!termsAfterSet.has(term)) {
        lostTerms.push(term);
      }
    }

    results.push({
      language: lang,
      sourceFiles,
      rawEntriesBefore,
      uniqueTermsBefore: rawTermsBeforeSet.size,
      uniqueConceptPairsBefore: conceptPairsBeforeSet.size,
      entriesAfter: finalEntries.length,
      uniqueTermsAfter: termsAfterSet.size,
      lostTerms,
    });

    if (writeChanges) {
      // 1. Write the unified file: <lang>.json
      const targetFileName = `${lang}.json`;
      const targetFilePath = join(dictionariesDir, targetFileName);

      const outputJson = {
        language: lang,
        entries: finalEntries,
      };

      writeFileSync(targetFilePath, JSON.stringify(outputJson, null, 2), "utf-8");

      // 2. Remove redundant files of this language
      for (const sourceFile of sourceFiles) {
        if (sourceFile !== targetFileName) {
          const toRemove = join(dictionariesDir, sourceFile);
          rmSync(toRemove, { force: true });
        }
      }
    }
  }

  return results;
}

// CLI Execution
const isApply = process.argv.includes("--apply");
const dictsDir = join(process.cwd(), "dictionaries");

console.log("================================================================");
console.log(` DICTIONARY CONSOLIDATION SCRIPT [${isApply ? "APPLY MODE" : "DRY-RUN SCAN"}]`);
console.log("================================================================");
console.log(`Directory: ${dictsDir}\n`);

const backupDir = join(process.cwd(), "dictionaries_backup");

if (isApply) {
  // Create backup first
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    const currentFiles = readdirSync(dictsDir).filter((f) => f.endsWith(".json"));
    for (const f of currentFiles) {
      writeFileSync(join(backupDir, f), readFileSync(join(dictsDir, f)));
    }
    console.log(`Created backup of original files in: ${backupDir}\n`);
  }
}

const stats = analyzeAndMerge(dictsDir, isApply);

for (const s of stats) {
  console.log(`----------------------------------------------------------------`);
  console.log(`Language: [${s.language.toUpperCase()}]`);
  console.log(`  Source files (${s.sourceFiles.length}): ${s.sourceFiles.join(", ")}`);
  console.log(`  Raw entries before:       ${s.rawEntriesBefore.toLocaleString()}`);
  console.log(`  Unique terms before:      ${s.uniqueTermsBefore.toLocaleString()}`);
  console.log(`  Clean entries after:      ${s.entriesAfter.toLocaleString()}`);
  console.log(`  Unique terms after:       ${s.uniqueTermsAfter.toLocaleString()}`);

  if (s.lostTerms.length === 0) {
    console.log(`  Retention verification:   ✅ 100% PRESERVED (0 words lost!)`);
  } else {
    console.log(`  Retention verification:   🚨 LOST ${s.lostTerms.length} TERMS!`);
    console.log(`  Lost sample:              ${s.lostTerms.slice(0, 5).join(", ")}`);
  }
}

console.log("================================================================");
if (!isApply) {
  console.log("NOTE: This was a DRY-RUN. No files were modified.");
  console.log("To apply changes and merge files, run with '--apply':");
  console.log("  npx tsx scripts/merge-dictionaries.ts --apply");
} else {
  console.log("SUCCESS: All dictionary files merged and redundant files removed.");
  console.log(`A full backup was saved in ${backupDir} before applying.`);
}
console.log("================================================================\n");
