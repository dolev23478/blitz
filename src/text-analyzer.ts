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
  RiskLevel,
  ThreatEvaluation,
  ThreatEvaluationMode,
} from "./types.js";

export interface TextAnalyzerDependencies {
  store: DictionaryStore;
  matcher?: TermMatcher;
}

export function extractOrderedTerms(matches: AnalyzeMatch[]): string[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.tokenStart !== b.tokenStart) {
      return a.tokenStart - b.tokenStart;
    }
    return a.tokenEnd - b.tokenEnd;
  });

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const m of sorted) {
    const term = m.normalizedTerm || m.term;
    if (!seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }

  return terms;
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
 * Helper to resolve polymorphic arguments for analyze / analyzeBatch:
 * - analyzeText(text)
 * - analyzeText(text, true) -> smart mode ON
 * - analyzeText(text, false) -> basic dictionary_only mode
 * - analyzeText(text, "smart") -> mode string
 * - analyzeText(text, { smart: true }) -> boolean option
 * - analyzeText(text, { filter: true }) -> category_filter mode
 * - analyzeText(text, "ar", { smart: true })
 */
export function resolveAnalyzeArgs(
  languageOrOptions?:
    | string
    | string[]
    | boolean
    | ThreatEvaluationMode
    | AnalyzeTextOptions,
  options?: AnalyzeTextOptions,
): {
  language: string | string[] | undefined;
  effectiveOptions: AnalyzeTextOptions;
} {
  let language: string | string[] | undefined;
  let effectiveOptions: AnalyzeTextOptions;

  if (typeof languageOrOptions === "boolean") {
    language = "auto";
    effectiveOptions = {
      mode: languageOrOptions ? "smart" : "dictionary_only",
      ...options,
    };
  } else if (
    typeof languageOrOptions === "string" &&
    (languageOrOptions === "smart" ||
      languageOrOptions === "category_filter" ||
      languageOrOptions === "dictionary_only" ||
      languageOrOptions === "basic")
  ) {
    language = "auto";
    effectiveOptions = {
      mode: languageOrOptions as ThreatEvaluationMode,
      ...options,
    };
  } else if (
    languageOrOptions &&
    typeof languageOrOptions === "object" &&
    !Array.isArray(languageOrOptions)
  ) {
    language = "auto";
    effectiveOptions = { ...(languageOrOptions as AnalyzeTextOptions) };
  } else {
    language = languageOrOptions as string | string[] | undefined;
    effectiveOptions = { ...options };
  }

  // Support simple boolean toggles in options:
  if (effectiveOptions.smart === true && !effectiveOptions.mode) {
    effectiveOptions.mode = "smart";
  } else if (effectiveOptions.filter === true && !effectiveOptions.mode) {
    effectiveOptions.mode = "category_filter";
  }

  // Optional alias: smartThreshold -> threatThreshold
  if (
    effectiveOptions.smartThreshold !== undefined &&
    effectiveOptions.threatThreshold === undefined
  ) {
    effectiveOptions.threatThreshold = effectiveOptions.smartThreshold;
  }

  return { language, effectiveOptions };
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
    languageOrOptions?:
      | string
      | string[]
      | boolean
      | ThreatEvaluationMode
      | AnalyzeTextOptions,
    options?: AnalyzeTextOptions,
  ): AnalyzeTextResult {
    const { language, effectiveOptions } = resolveAnalyzeArgs(
      languageOrOptions,
      options,
    );

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
      ], effectiveOptions.mode);
    }

    if (targetLanguages.length === 1) {
      return this.analyzeSingle(text, targetLanguages[0]!, effectiveOptions);
    }

    // Multi-language scan: run against all target languages and merge results
    const allMatches: AnalyzeMatch[] = [];
    const allIssues: AnalyzeIssue[] = [];
    const seenMatchKeys = new Set<string>();

    for (const lang of targetLanguages) {
      const single = this.analyzeSingle(text, lang, effectiveOptions);
      for (const issue of single.issues) {
        allIssues.push(issue);
      }
      for (const match of single.matches) {
        const key = `${match.term}\u0000${match.concept ?? ""}\u0000${match.tokenStart}\u0000${match.tokenEnd}`;
        if (!seenMatchKeys.has(key)) {
          seenMatchKeys.add(key);
          allMatches.push(match);
        }
      }
    }

    if (effectiveOptions.maxMatches !== undefined && effectiveOptions.maxMatches > 0) {
      allMatches.splice(effectiveOptions.maxMatches);
    }

    const terms = extractOrderedTerms(allMatches);
    const usedSources = [
      ...new Set(allMatches.map((match) => match.sourceFile)),
    ].sort();

    const outputLanguages = [...new Set(targetLanguages.map(toOutputLanguage))];
    const matchedLangs = [
      ...new Set(
        allMatches.map((m) =>
          toOutputLanguage(m.sourceFile.replace(/\.json$/, "")),
        ),
      ),
    ];
    const finalLanguages =
      matchedLangs.length > 0 ? matchedLangs : outputLanguages;

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const { matched, evaluation } = evaluateThreat(
      allMatches,
      effectiveOptions.mode,
      effectiveOptions.threatThreshold,
      wordCount,
    );

    return {
      text,
      content: text,
      language: finalLanguages.join(", "),
      languages: finalLanguages,
      matched,
      terms,
      matches: allMatches,
      usedSources,
      issues: allIssues,
      evaluation,
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
      ], options?.mode);
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
      return emptyResult(text, normalizedLanguage, issues, options?.mode);
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

    const terms = extractOrderedTerms(matches);
    const usedSources = [
      ...new Set(matches.map((match) => match.sourceFile)),
    ].sort();

    const outputLang = toOutputLanguage(normalizedLanguage);

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const { matched, evaluation } = evaluateThreat(
      matches,
      options?.mode,
      options?.threatThreshold,
      wordCount,
    );

    return {
      text,
      content: text,
      language: outputLang,
      languages: [outputLang],
      matched,
      terms,
      matches,
      usedSources,
      issues,
      evaluation,
    };
  }

  analyzeBatch(
    texts: string[],
    languageOrOptions?:
      | string
      | string[]
      | boolean
      | ThreatEvaluationMode
      | AnalyzeTextOptions,
    options?: AnalyzeTextOptions,
  ): AnalyzeTextResult[] {
    const { language, effectiveOptions } = resolveAnalyzeArgs(
      languageOrOptions,
      options,
    );
    return texts.map((t) => this.analyze(t, language, effectiveOptions));
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

export function evaluateThreat(
  matches: AnalyzeMatch[],
  mode: ThreatEvaluationMode = "dictionary_only",
  threshold = 40,
  wordCount?: number,
): { matched: boolean; evaluation: ThreatEvaluation } {
  const normMode: "dictionary_only" | "category_filter" | "smart" =
    mode === "basic" ? "dictionary_only" : mode;

  const words = Math.max(1, wordCount ?? 1);
  const threatDensity = Number(((matches.length / words) * 100).toFixed(2));

  if (matches.length === 0) {
    return {
      matched: false,
      evaluation: {
        mode: normMode,
        riskScore: 0,
        riskLevel: "none",
        threatCategories: [],
        flaggedReasons: [],
        wordCount: words,
        threatDensity: 0,
      },
    };
  }

  const concepts = new Set(
    matches.map((m) => m.concept?.toLowerCase() ?? "").filter(Boolean),
  );

  const threatCategories = [...concepts];
  const flaggedReasons: string[] = [];

  const hasWeapon = [...concepts].some((c) => c.startsWith("weapon."));
  const hasViolence = [...concepts].some((c) => c.startsWith("violence."));
  const hasDirectThreat = [...concepts].some(
    (c) => c.startsWith("threat.direct") || c.startsWith("threat.annihilation"),
  );
  const hasIntimidation = [...concepts].some(
    (c) =>
      c.startsWith("threat.intimidation") || c.startsWith("threat.retaliation"),
  );
  const hasHate = [...concepts].some((c) => c.startsWith("hate."));
  const hasTarget = [...concepts].some((c) => c.startsWith("target."));
  const hasDualUse = [...concepts].some((c) => c === "context.dual_use_material");
  const hasTemporal = [...concepts].some((c) => c === "context.temporal");

  // Mode 1: Dictionary Only (Legacy / Default)
  if (normMode === "dictionary_only") {
    let score = 20;
    if (hasWeapon || hasViolence) score += 50;
    if (hasDirectThreat) score += 30;
    const finalScore = Math.min(100, score);
    const riskLevel: RiskLevel =
      finalScore >= 70 ? "critical" : finalScore >= 40 ? "high" : "medium";

    flaggedReasons.push(`Matched ${matches.length} dictionary term(s)`);

    return {
      matched: true,
      evaluation: {
        mode: "dictionary_only",
        riskScore: finalScore,
        riskLevel,
        threatCategories,
        flaggedReasons,
      },
    };
  }

  // Mode 2: Category Filter
  if (normMode === "category_filter") {
    const isThreatDomain =
      hasWeapon || hasViolence || hasDirectThreat || hasIntimidation || hasHate;
    const isDualUseWithViolentAction =
      hasDualUse && (hasWeapon || hasViolence || hasDirectThreat);

    const isOnlyNeutral =
      !isThreatDomain &&
      [...concepts].every(
        (c) =>
          c === "context.dual_use_material" ||
          c === "context.temporal" ||
          c === "context.general" ||
          c === "context.slang" ||
          c === "target.israel_location" ||
          c === "target.general",
      );

    const isFlagged =
      !isOnlyNeutral && (isThreatDomain || isDualUseWithViolentAction);

    if (hasWeapon) flaggedReasons.push("Weapon category matched");
    if (hasViolence) flaggedReasons.push("Violence or terrorism category matched");
    if (hasDirectThreat) flaggedReasons.push("Direct threat or annihilation matched");
    if (hasIntimidation) flaggedReasons.push("Intimidation or retaliation threat matched");
    if (hasHate) flaggedReasons.push("Hate speech or extremist group matched");
    if (isDualUseWithViolentAction)
      flaggedReasons.push("Dual-use material combined with violent action/weapon");
    if (!isFlagged && hasDualUse)
      flaggedReasons.push("Dual-use material alone: not flagged");
    if (!isFlagged && hasTemporal)
      flaggedReasons.push("Temporal reference alone: not flagged");

    const riskScore = isFlagged
      ? hasWeapon || hasViolence
        ? 85
        : 60
      : hasDualUse
        ? 15
        : 5;
    const riskLevel: RiskLevel = !isFlagged
      ? "low"
      : riskScore >= 75
        ? "critical"
        : "high";

    return {
      matched: isFlagged,
      evaluation: {
        mode: "category_filter",
        riskScore,
        riskLevel,
        threatCategories,
        flaggedReasons,
      },
    };
  }

  // Mode 3: Smart Risk Scoring with Text Length & Density Normalization
  let score = 0;

  if (hasWeapon) {
    score += 50;
    flaggedReasons.push("Weapon detected (+50)");
  }
  if (hasViolence) {
    score += 45;
    flaggedReasons.push("Violence/terror action detected (+45)");
  }
  if (hasDirectThreat) {
    score += 40;
    flaggedReasons.push("Direct threat detected (+40)");
  }
  if (hasIntimidation) {
    score += 40;
    flaggedReasons.push("Intimidation/retaliation detected (+40)");
  }
  if (hasHate) {
    score += 25;
    flaggedReasons.push("Hate speech detected (+25)");
  }
  if (hasTarget) {
    score += 15;
    flaggedReasons.push("Specific target identified (+15)");
  }
  if (hasDualUse) {
    if (hasViolence || hasWeapon || hasDirectThreat) {
      score += 40;
      flaggedReasons.push("Dual-use material in violent context (+40)");
    } else {
      score += 5;
      flaggedReasons.push("Dual-use material in neutral context (+5)");
    }
  }

  // Length and Density adjustments:
  // 1. Concentrated short message (e.g. <= 30 words with high threat density):
  if (words <= 30 && threatDensity >= 8.0 && (hasWeapon || hasViolence || hasDirectThreat)) {
    score = Math.min(100, score + 10);
    flaggedReasons.push(`High threat concentration in short text (+10)`);
  }

  // 2. Long text (e.g. news article / long report > 120 words with sparse, isolated matches):
  // If text is long and lacks critical weapon/violence/direct threats, apply dampening to prevent false alarms
  if (words > 120 && threatDensity < 2.0 && !hasWeapon && !hasViolence && !hasDirectThreat) {
    score = Math.round(score * 0.6);
    flaggedReasons.push(`Long text sparsity dampening applied (density: ${threatDensity}%)`);
  }

  const finalScore = Math.min(100, score);
  const isFlagged = finalScore >= threshold;
  const riskLevel: RiskLevel =
    finalScore >= 80
      ? "critical"
      : finalScore >= 50
        ? "high"
        : finalScore >= 25
          ? "medium"
          : finalScore > 0
            ? "low"
            : "none";

  return {
    matched: isFlagged,
    evaluation: {
      mode: "smart",
      riskScore: finalScore,
      riskLevel,
      threatCategories,
      flaggedReasons,
      wordCount: words,
      threatDensity,
    },
  };
}

function emptyResult(
  text: string,
  language: string,
  issues: AnalyzeIssue[],
  mode: ThreatEvaluationMode = "dictionary_only",
): AnalyzeTextResult {
  const outputLang = toOutputLanguage(language);
  const normMode: "dictionary_only" | "category_filter" | "smart" =
    mode === "basic" ? "dictionary_only" : mode;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
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
    evaluation: {
      mode: normMode,
      riskScore: 0,
      riskLevel: "none",
      threatCategories: [],
      flaggedReasons: [],
      wordCount,
      threatDensity: 0,
    },
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
  modeOrOptions?: ThreatEvaluationMode | boolean | AnalyzeTextOptions,
): AnalyzeTextResult;
export function analyzeText(
  text: string,
  language?: string | string[],
  options?: AnalyzeTextOptions,
): AnalyzeTextResult;
export function analyzeText(
  text: string,
  languageOrOptions?:
    | string
    | string[]
    | boolean
    | ThreatEvaluationMode
    | AnalyzeTextOptions,
  options?: AnalyzeTextOptions,
): AnalyzeTextResult {
  const { language, effectiveOptions } = resolveAnalyzeArgs(
    languageOrOptions,
    options,
  );
  const store = getDictionaryStore(effectiveOptions);
  if (!cachedAnalyzer || cachedStore !== store) {
    cachedAnalyzer = new TextAnalyzer({ store });
    cachedStore = store;
  }
  return cachedAnalyzer.analyze(text, language, effectiveOptions);
}

export function analyzeBatch(
  texts: string[],
  modeOrOptions?: ThreatEvaluationMode | boolean | AnalyzeTextOptions,
): AnalyzeTextResult[];
export function analyzeBatch(
  texts: string[],
  language?: string | string[],
  options?: AnalyzeTextOptions,
): AnalyzeTextResult[];
export function analyzeBatch(
  texts: string[],
  languageOrOptions?:
    | string
    | string[]
    | boolean
    | ThreatEvaluationMode
    | AnalyzeTextOptions,
  options?: AnalyzeTextOptions,
): AnalyzeTextResult[] {
  const { language, effectiveOptions } = resolveAnalyzeArgs(
    languageOrOptions,
    options,
  );
  const store = getDictionaryStore(effectiveOptions);
  if (!cachedAnalyzer || cachedStore !== store) {
    cachedAnalyzer = new TextAnalyzer({ store });
    cachedStore = store;
  }
  return cachedAnalyzer.analyzeBatch(texts, language, effectiveOptions);
}
