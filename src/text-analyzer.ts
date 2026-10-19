import { getDictionaryStore } from "./dictionaries/load-dictionaries.js";
import type { DictionaryStore } from "./dictionaries/load-dictionaries.js";
import {
  defaultTermMatcher,
  type TermMatcher,
} from "./match/term-matcher.js";
import { getNormalizer } from "./normalize/registry.js";
import type {
  AnalyzeIssue,
  AnalyzeTextOptions,
  AnalyzeTextResult,
} from "./types.js";

export interface TextAnalyzerDependencies {
  store: DictionaryStore;
  matcher?: TermMatcher;
}

/**
 * Primary analysis entry for a known language. Extra checks can be added
 * later as injected matchers or by wrapping this class.
 */
export class TextAnalyzer {
  private readonly store: DictionaryStore;
  private readonly matcher: TermMatcher;

  constructor(dependencies: TextAnalyzerDependencies) {
    this.store = dependencies.store;
    this.matcher = dependencies.matcher ?? defaultTermMatcher;
  }

  analyze(text: string, language: string): AnalyzeTextResult {
    const normalizedLanguage = language.trim().toLowerCase();
    const issues: AnalyzeIssue[] = [];

    if (normalizedLanguage.length === 0) {
      return emptyResult("", [
        { code: "INVALID_LANGUAGE", message: "language must be a non-empty string" },
      ]);
    }

    const index = this.store.getIndex(normalizedLanguage);
    if (!index) {
      const available = this.store.languages();
      const availableText =
        available.length > 0 ? available.join(", ") : "none";
      issues.push({
        code: "NO_DICTIONARIES",
        message: `no dictionaries loaded for language "${normalizedLanguage}" (available: ${availableText})`,
      });
      return emptyResult(normalizedLanguage, issues);
    }

    const normalizer = getNormalizer(normalizedLanguage);
    const normalizedText = normalizer.normalize(text);
    const tokens = normalizer.tokenize(normalizedText);
    const matches = this.matcher.match(tokens, index, normalizer);

    const terms = [...new Set(matches.map((match) => match.term))];
    const usedSources = [
      ...new Set(matches.map((match) => match.sourceFile)),
    ].sort();

    return {
      language: normalizedLanguage,
      matched: matches.length > 0,
      terms,
      matches,
      usedSources,
      issues,
    };
  }
}

function emptyResult(
  language: string,
  issues: AnalyzeIssue[],
): AnalyzeTextResult {
  return {
    language,
    matched: false,
    terms: [],
    matches: [],
    usedSources: [],
    issues,
  };
}

let cachedAnalyzer: TextAnalyzer | undefined;
let cachedStore: DictionaryStore | undefined;

export function createTextAnalyzer(
  options: AnalyzeTextOptions = {},
): TextAnalyzer {
  const store = getDictionaryStore(options);
  return new TextAnalyzer({ store });
}

export function analyzeText(
  text: string,
  language: string,
  options: AnalyzeTextOptions = {},
): AnalyzeTextResult {
  const store = getDictionaryStore(options);
  if (!cachedAnalyzer || cachedStore !== store) {
    cachedAnalyzer = new TextAnalyzer({ store });
    cachedStore = store;
  }
  return cachedAnalyzer.analyze(text, language);
}
