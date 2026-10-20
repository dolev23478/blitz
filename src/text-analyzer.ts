import { getDictionaryStore } from "./dictionaries/load-dictionaries.js";
import type { DictionaryStore } from "./dictionaries/load-dictionaries.js";
import {
  defaultTermMatcher,
  type TermMatcher,
} from "./match/term-matcher.js";
import { getNormalizer } from "./normalize/registry.js";
import type {
  AnalyzeIssue,
  AnalyzeMatch,
  AnalyzeTextOptions,
  AnalyzeTextResult,
} from "./types.js";

export interface TextAnalyzerDependencies {
  store: DictionaryStore;
  matcher?: TermMatcher;
}

export function toOutputLanguage(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower === "emoji" || lower === "emojis") {
    return "em";
  }
  return lang;
}

export function toInternalLanguage(lang: string, available: string[]): string {
  const lower = lang.toLowerCase();
  if (lower === "em") {
    if (available.includes("em")) return "em";
    if (available.includes("emoji")) return "emoji";
    if (available.includes("emojis")) return "emojis";
    return "em";
  }
  return lower;
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

  analyze(
    text: string,
    language?: string | string[],
    options?: AnalyzeTextOptions,
  ): AnalyzeTextResult {
    const available = this.store.languages();
    let targetLanguages: string[] = [];

    if (!language || language === "auto") {
      targetLanguages = detectLanguages(text, available);
    } else if (language === "all") {
      targetLanguages = available;
    } else if (Array.isArray(language)) {
      targetLanguages = language
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);
    } else if (typeof language === "string") {
      const trimmed = language.trim().toLowerCase();
      if (trimmed.includes(",")) {
        targetLanguages = trimmed
          .split(",")
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean);
      } else if (trimmed === "auto") {
        targetLanguages = detectLanguages(text, available);
      } else if (trimmed === "all") {
        targetLanguages = available;
      } else {
        targetLanguages = [trimmed];
      }
    }

    // Auto-check emoji dictionary if emojis are present in text and emoji dictionary exists
    const hasEmojiDict =
      available.includes("emoji") ||
      available.includes("emojis") ||
      available.includes("em");

    if (
      /\p{Extended_Pictographic}/u.test(text) &&
      hasEmojiDict &&
      !targetLanguages.includes("emoji") &&
      !targetLanguages.includes("emojis") &&
      !targetLanguages.includes("em")
    ) {
      targetLanguages.push("em");
    }

    if (targetLanguages.length === 0) {
      return emptyResult(text, "", [
        {
          code: "INVALID_LANGUAGE",
          message: "no valid target languages specified or detected",
        },
      ]);
    }

    if (targetLanguages.length === 1) {
      return this.analyzeSingle(text, targetLanguages[0]!, options);
    }

    // Multi-language scan: run against all target languages and merge results
    const allMatches: AnalyzeMatch[] = [];
    const allIssues: AnalyzeIssue[] = [];
    const seenMatchKeys = new Set<string>();
    const matchedLanguages: string[] = [];

    for (const lang of targetLanguages) {
      const single = this.analyzeSingle(text, lang, options);
      for (const issue of single.issues) {
        allIssues.push(issue);
      }
      if (single.matches.length > 0) {
        matchedLanguages.push(lang);
      }
      for (const match of single.matches) {
        const key = `${match.term}\u0000${match.concept ?? ""}\u0000${match.tokenStart}\u0000${match.tokenEnd}`;
        if (!seenMatchKeys.has(key)) {
          seenMatchKeys.add(key);
          allMatches.push(match);
        }
      }
    }

    if (options?.maxMatches !== undefined && options.maxMatches > 0) {
      allMatches.splice(options.maxMatches);
    }

    const terms = [...new Set(allMatches.map((match) => match.term))];
    const usedSources = [
      ...new Set(allMatches.map((match) => match.sourceFile)),
    ].sort();

    // Report only the languages that produced matches; with no matches, report what was scanned.
    const outputLanguages = (
      matchedLanguages.length > 0 ? matchedLanguages : targetLanguages
    ).map(toOutputLanguage);

    return {
      text,
      content: text,
      language: outputLanguages.join(", "),
      languages: outputLanguages,
      matched: allMatches.length > 0,
      terms,
      matches: allMatches,
      usedSources,
      issues: allIssues,
    };
  }

  private analyzeSingle(
    text: string,
    normalizedLanguage: string,
    options?: AnalyzeTextOptions,
  ): AnalyzeTextResult {
    const issues: AnalyzeIssue[] = [];

    if (normalizedLanguage.length === 0) {
      return emptyResult(text, "", [
        {
          code: "INVALID_LANGUAGE",
          message: "language must be a non-empty string",
        },
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
      return emptyResult(text, normalizedLanguage, issues);
    }

    const normalizer = getNormalizer(normalizedLanguage);
    const normalizedText = normalizer.normalize(text);
    const tokens = normalizer.tokenize(normalizedText);
    let matches = this.matcher.match(tokens, index, normalizer);

    if (options?.concepts && options.concepts.length > 0) {
      const allowed = options.concepts;
      matches = matches.filter(
        (m) => m.concept && allowed.some((c) => m.concept!.startsWith(c)),
      );
    }

    if (options?.maxMatches !== undefined && options.maxMatches > 0) {
      matches = matches.slice(0, options.maxMatches);
    }

    const terms = [...new Set(matches.map((match) => match.term))];
    const usedSources = [
      ...new Set(matches.map((match) => match.sourceFile)),
    ].sort();

    const outputLang = toOutputLanguage(normalizedLanguage);

    return {
      text,
      content: text,
      language: outputLang,
      languages: [outputLang],
      matched: matches.length > 0,
      terms,
      matches,
      usedSources,
      issues,
    };
  }

  analyzeBatch(
    texts: string[],
    language?: string | string[],
    options?: AnalyzeTextOptions,
  ): AnalyzeTextResult[] {
    return texts.map((t) => this.analyze(t, language, options));
  }
}

/**
 * Detects languages present in text based on Unicode scripts.
 */
export function detectLanguages(
  text: string,
  availableLanguages: string[],
): string[] {
  const set = new Set<string>();
  const available = new Set(availableLanguages.map((l) => l.toLowerCase()));

  // Arabic script (Arabic, Persian/Farsi)
  if (/\p{Script=Arabic}/u.test(text)) {
    if (available.has("ar")) set.add("ar");
    if (available.has("fa")) set.add("fa");
  }

  // Hebrew script
  if (/\p{Script=Hebrew}/u.test(text)) {
    if (available.has("he")) set.add("he");
  }

  // Latin script
  if (/\p{Script=Latin}/u.test(text)) {
    if (available.has("en")) set.add("en");
  }

  // Emojis / Pictographs
  if (/\p{Extended_Pictographic}/u.test(text)) {
    if (
      available.has("emoji") ||
      available.has("emojis") ||
      available.has("em")
    ) {
      set.add("em");
    }
  }

  if (set.size === 0) {
    if (available.has("en")) {
      set.add("en");
    } else if (availableLanguages.length > 0) {
      set.add(toOutputLanguage(availableLanguages[0]!));
    }
  }

  return [...set];
}

function emptyResult(
  text: string,
  language: string,
  issues: AnalyzeIssue[],
): AnalyzeTextResult {
  const outputLang = toOutputLanguage(language);
  return {
    text,
    content: text,
    language: outputLang,
    languages: outputLang ? [outputLang] : [],
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
  language?: string | string[],
  options: AnalyzeTextOptions = {},
): AnalyzeTextResult {
  const store = getDictionaryStore(options);
  if (!cachedAnalyzer || cachedStore !== store) {
    cachedAnalyzer = new TextAnalyzer({ store });
    cachedStore = store;
  }
  return cachedAnalyzer.analyze(text, language, options);
}

export function analyzeBatch(
  texts: string[],
  language?: string | string[],
  options: AnalyzeTextOptions = {},
): AnalyzeTextResult[] {
  const store = getDictionaryStore(options);
  if (!cachedAnalyzer || cachedStore !== store) {
    cachedAnalyzer = new TextAnalyzer({ store });
    cachedStore = store;
  }
  return cachedAnalyzer.analyzeBatch(texts, language, options);
}
