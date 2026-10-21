import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNormalizer } from "../normalize/registry.js";
import type { LanguageTermIndex } from "../match/term-matcher.js";
import type { DictionaryLoadIssue, IndexedTerm } from "../types.js";
import { parseDictionaryFile } from "./schema.js";

export interface LoadDictionariesOptions {
  dictionariesDir?: string;
}

export class DictionaryStore {
  constructor(
    readonly byLanguage: Map<string, LanguageTermIndex>,
    readonly issues: DictionaryLoadIssue[],
    readonly dictionariesDir: string,
  ) {}

  getIndex(language: string): LanguageTermIndex | undefined {
    const key = language.toLowerCase();
    if (key === "em") {
      return (
        this.byLanguage.get("em") ??
        this.byLanguage.get("emoji") ??
        this.byLanguage.get("emojis")
      );
    }
    if (key === "emoji" || key === "emojis") {
      return this.byLanguage.get(key) ?? this.byLanguage.get("em");
    }
    return this.byLanguage.get(key);
  }

  languages(): string[] {
    return [...this.byLanguage.keys()].sort();
  }
}

function resolveDictionariesDir(override?: string): string {
  if (override) {
    return override;
  }
  if (process.env.DICTIONARIES_DIR) {
    return process.env.DICTIONARIES_DIR;
  }

  const candidates = [
    join(process.cwd(), "dictionaries"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dictionaries"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return candidates[0] ?? join(process.cwd(), "dictionaries");
}

export function loadDictionaries(
  options: LoadDictionariesOptions = {},
): DictionaryStore {
  const dictionariesDir = resolveDictionariesDir(options.dictionariesDir);
  const issues: DictionaryLoadIssue[] = [];

  if (!existsSync(dictionariesDir) || !statSync(dictionariesDir).isDirectory()) {
    throw new Error(
      `Dictionaries directory not found: ${dictionariesDir}. Set DICTIONARIES_DIR or pass dictionariesDir.`,
    );
  }

  const files = readdirSync(dictionariesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No JSON dictionaries found in ${dictionariesDir}`);
  }

  const buckets = new Map<
    string,
    {
      sourceFiles: string[];
      terms: Map<string, IndexedTerm[]>;
    }
  >();

  for (const fileName of files) {
    const fullPath = join(dictionariesDir, fileName);
    if (!statSync(fullPath).isFile()) {
      continue;
    }

    const raw = readFileSync(fullPath, "utf8");
    if (raw.trim().length === 0) {
      issues.push({
        fileName,
        message: "file is empty and was skipped",
      });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      issues.push({
        fileName,
        message: `invalid JSON: ${detail}`,
      });
      continue;
    }

    let parsed;
    try {
      parsed = parseDictionaryFile(parsedJson, fileName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      issues.push({
        fileName,
        message: detail,
      });
      continue;
    }

    const normalizer = getNormalizer(parsed.language);
    let bucket = buckets.get(parsed.language);
    if (!bucket) {
      bucket = { sourceFiles: [], terms: new Map() };
      buckets.set(parsed.language, bucket);
    }
    bucket.sourceFiles.push(fileName);

    for (const entry of parsed.entries) {
      const normalizedTerm = normalizer.normalize(entry.term);
      if (normalizedTerm.length === 0) {
        continue;
      }

      const existing = bucket.terms.get(normalizedTerm);
      if (existing) {
        const duplicate = existing.find(
          (e) => (e.concept ?? "") === (entry.concept ?? ""),
        );
        if (duplicate) {
          // Prefer canonical term representation without special wrapping punctuation (e.g. 'jews' over '(((jews)))')
          const entryClean = entry.term.trim().toLowerCase();
          const dupClean = duplicate.term.trim().toLowerCase();
          if (entryClean === normalizedTerm && dupClean !== normalizedTerm) {
            duplicate.term = entry.term;
          }
          if (!duplicate.sourceFile.includes(fileName)) {
            duplicate.sourceFile = `${duplicate.sourceFile}, ${fileName}`;
          }
          continue;
        }
      }

      const indexed: IndexedTerm = {
        term: entry.term,
        ...(entry.concept !== undefined ? { concept: entry.concept } : {}),
        sourceFile: fileName,
        language: parsed.language,
      };

      if (existing) {
        existing.push(indexed);
      } else {
        bucket.terms.set(normalizedTerm, [indexed]);
      }
    }
  }

  const byLanguage = new Map<string, LanguageTermIndex>();

  for (const [language, bucket] of buckets) {
    let maxTokenCount = 1;
    let entryCount = 0;

    for (const [normalizedTerm, entries] of bucket.terms) {
      entryCount += entries.length;
      const tokenCount = normalizedTerm.split(" ").length;
      if (tokenCount > maxTokenCount) {
        maxTokenCount = tokenCount;
      }
    }

    byLanguage.set(language, {
      language,
      sourceFiles: bucket.sourceFiles,
      maxTokenCount,
      entryCount,
      byNormalizedTerm: bucket.terms,
    });
  }

  return new DictionaryStore(byLanguage, issues, dictionariesDir);
}

let cachedStore: DictionaryStore | undefined;
let cachedDir: string | undefined;

export function getDictionaryStore(
  options: LoadDictionariesOptions = {},
): DictionaryStore {
  const dictionariesDir = resolveDictionariesDir(options.dictionariesDir);
  if (!cachedStore || cachedDir !== dictionariesDir) {
    cachedStore = loadDictionaries(options);
    cachedDir = dictionariesDir;
  }
  return cachedStore;
}

export function resetDictionaryStoreCache(): void {
  cachedStore = undefined;
  cachedDir = undefined;
}
